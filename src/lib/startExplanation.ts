import type { ModelPool } from "./modelPool";
import { retryDelayMs } from "./modelPool";
import type { SearchGate } from "./searchMode";

// Gets the first chunk of an explanation from whichever model can answer.
//
// - A model that's over quota (429), overloaded (503) or gone (404) is put on
//   cooldown and the next model in the list is tried.
// - If search is refused, the same model is retried without search.
// - If the first chunk hasn't arrived after `hedgeAfterMs`, a backup request
//   to the next model starts in parallel and the first to answer wins. The
//   slower one is cancelled.

export type ExplainFn<C> = (model: string, withSearch: boolean, signal: AbortSignal) => AsyncGenerator<C>;

export type Started<C> = {
  iterator: AsyncGenerator<C>;
  first: IteratorResult<C>;
  model: string;
  withSearch: boolean;
};

export class AllModelsBusyError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("All models are busy");
  }
}

type Options<C> = {
  explain: ExplainFn<C>;
  pool: ModelPool;
  gate: SearchGate;
  signal: AbortSignal;
  hedgeAfterMs: number;
  /** Status code of a Gemini error, if it has one. */
  statusOf: (err: unknown) => number | undefined;
  log?: (msg: string) => void;
};

const COOLDOWN_GONE_MS = 60 * 60_000;
const COOLDOWN_OVERLOADED_MS = 30_000;

export async function startExplanation<C>(opts: Options<C>): Promise<Started<C>> {
  const { explain, pool, gate, signal, hedgeAfterMs, statusOf, log = () => {} } = opts;
  const cooling = pool.cooldowns();
  if (cooling.length) log(`on cooldown: ${cooling.map((c) => `${c.model} (${c.seconds}s left)`).join(", ")}`);
  const queue = pool.available();
  if (queue.length === 0) throw new AllModelsBusyError(pool.secondsUntilAvailable());

  const controllers = new Set<AbortController>();
  const abortAll = () => controllers.forEach((c) => c.abort());
  signal.addEventListener("abort", abortAll, { once: true });

  type Attempt = Started<C> & { controller: AbortController };

  /** One model, with a single retry without search if search is refused. */
  async function attempt(model: string): Promise<Attempt> {
    let withSearch = gate.shouldSearch();
    for (;;) {
      const controller = new AbortController();
      controllers.add(controller);
      const iterator = explain(model, withSearch, controller.signal);
      try {
        const first = await iterator.next();
        return { iterator, first, model, withSearch, controller };
      } catch (err) {
        controllers.delete(controller);
        const status = statusOf(err);
        if (withSearch && (status === 429 || status === 403) && gate.reportRefused()) {
          log(`search refused on ${model}; answering from model knowledge for a while`);
          withSearch = false;
          continue;
        }
        const cooldown =
          status === 429 ? retryDelayMs(err) : status === 503 ? COOLDOWN_OVERLOADED_MS : status === 404 ? COOLDOWN_GONE_MS : 0;
        if (cooldown) {
          pool.markBusy(model, cooldown);
          log(`${model} returned ${status}; skipping it for ${Math.round(cooldown / 1000)}s`);
        }
        throw err;
      }
    }
  }

  const isRetryable = (err: unknown) => [429, 503, 404].includes(statusOf(err) ?? 0);

  return new Promise<Started<C>>((resolve, reject) => {
    let running = 0;
    let settled = false;
    let lastError: unknown = null;

    const finish = (fn: () => void) => {
      settled = true;
      clearTimeout(hedgeTimer);
      fn();
    };

    const launch = (): boolean => {
      const model = queue.shift();
      if (!model) return false;
      running++;
      attempt(model).then(
        (started) => {
          running--;
          if (settled) {
            // A faster model already won: cancel this one.
            started.controller.abort();
            controllers.delete(started.controller);
            void started.iterator.return(undefined as never).catch(() => {});
            return;
          }
          if (running > 0) log(`${started.model} answered first; cancelling the other request`);
          finish(() => {
            // Cancel the request(s) still waiting. The winner's controller
            // stays registered, so a client disconnect still cancels it.
            for (const c of controllers) {
              if (c !== started.controller) {
                c.abort();
                controllers.delete(c);
              }
            }
            const { controller: _controller, ...result } = started;
            void _controller;
            resolve(result);
          });
        },
        (err) => {
          running--;
          if (settled) return;
          lastError = err;
          if (!isRetryable(err)) {
            for (const c of controllers) c.abort();
            return finish(() => reject(err));
          }
          if (!launch() && running === 0) {
            finish(() =>
              reject(statusOf(err) === 429 || statusOf(err) === 503 ? new AllModelsBusyError(pool.secondsUntilAvailable()) : lastError),
            );
          }
        },
      );
      return true;
    };

    launch();
    // finish() only runs after an await, so this is assigned before it's used.
    const hedgeTimer = setTimeout(() => {
      if (!settled && running === 1 && queue.length > 0) {
        log(`no answer after ${hedgeAfterMs}ms; starting a backup model`);
        launch();
      }
    }, hedgeAfterMs);
  });
}
