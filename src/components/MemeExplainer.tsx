"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { ACCEPT_ATTR, ImageRejectedError, prepareImage } from "@/lib/client/prepareImage";
import { readEvents } from "@/lib/client/readEvents";
import { CATEGORY_LABELS, KNOWLEDGE_CATEGORY_LABELS, type Category } from "@/lib/category";
import type { Source } from "@/lib/events";
import { StatsCounter } from "./StatsCounter";

type Status = "idle" | "uploading" | "streaming" | "done" | "error";

const CATEGORY_STYLE: Record<Category, { icon: string; className: string }> = {
  1: { icon: "✅", className: "bg-good-bg text-good border-good/30" },
  2: { icon: "🟡", className: "bg-warn-bg text-warn border-warn/30" },
  3: { icon: "❌", className: "bg-bad-bg text-bad border-bad/30" },
};

export function MemeExplainer() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [category, setCategory] = useState<Category | null>(null);
  const [adjusted, setAdjusted] = useState(false);
  const [searched, setSearched] = useState<boolean | null>(null);
  const [text, setText] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [dragging, setDragging] = useState(false);
  const [statsKey, setStatsKey] = useState(0);
  const [canRetry, setCanRetry] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastFileRef = useRef<File | null>(null);

  const busy = status === "uploading" || status === "streaming";

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const explain = useCallback(async (file: File) => {
    lastFileRef.current = file;
    setError(null);
    setCanRetry(false);
    setCategory(null);
    setAdjusted(false);
    setSearched(null);
    setText("");
    setSources([]);

    let prepared;
    try {
      prepared = await prepareImage(file);
    } catch (err) {
      setStatus("error");
      setError(err instanceof ImageRejectedError ? err.message : "That image couldn't be read.");
      return;
    }
    setPreview(prepared.previewUrl || null);
    setStatus("uploading");

    const controller = new AbortController();
    abortRef.current = controller;
    const form = new FormData();
    form.append("image", prepared.blob, "meme.jpg");

    let finished = false;
    try {
      const res = await fetch("/api/explain", { method: "POST", body: form, signal: controller.signal });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Something went wrong. Please try again.");
      }
      setStatus("streaming");
      for await (const event of readEvents(res.body)) {
        switch (event.type) {
          case "mode":
            setSearched(event.search);
            break;
          case "category":
            setCategory(event.value);
            if (event.adjusted) setAdjusted(true);
            break;
          case "text":
            setText((t) => t + event.text);
            break;
          case "sources":
            setSources(event.sources);
            break;
          case "done":
            finished = true;
            setStatus("done");
            setStatsKey((k) => k + 1);
            break;
          case "error":
            throw new Error(event.message);
        }
      }
      if (!finished) throw new Error("The connection dropped before the explanation finished.");
    } catch (err) {
      if (controller.signal.aborted) return;
      setStatus("error");
      setCanRetry(true);
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    }
  }, []);

  const pickFiles = (files: FileList | null) => {
    if (!files || files.length === 0 || busy) return;
    if (files.length > 1) {
      setStatus("error");
      setCanRetry(false);
      setError("Please upload one image at a time.");
      return;
    }
    void explain(files[0]);
  };

  return (
    <>
      <StatsCounter refreshKey={statsKey} />

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 pb-16 pt-20 sm:pt-24">
        <header className="text-center">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Meme Context Finder</h1>
          <p className="mt-2 text-muted">Don&apos;t get a meme? Upload it and get the whole backstory.</p>
        </header>

        <div
          role="button"
          tabIndex={0}
          aria-disabled={busy}
          aria-label="Upload a meme image"
          onClick={() => !busy && inputRef.current?.click()}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === " ") && !busy) {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            if (!busy) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            pickFiles(e.dataTransfer.files);
          }}
          className={`group relative flex min-h-56 cursor-pointer flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl border-2 border-dashed p-6 text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            dragging ? "border-accent bg-accent/10" : "border-line bg-surface hover:border-accent/60"
          } ${busy ? "cursor-wait opacity-80" : ""}`}
        >
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Your uploaded meme" className="max-h-80 w-auto rounded-lg object-contain" />
          ) : (
            <>
              <span className="text-4xl" aria-hidden>🖼️</span>
              <span className="font-medium">Drop a meme here, or click to choose one</span>
            </>
          )}
          <span className="text-xs text-muted">
            {busy ? "Working on it…" : preview ? "Click or drop to try another meme" : "PNG, JPG, JPEG, WEBP, GIF or HEIC · one image at a time"}
          </span>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT_ATTR}
            className="hidden"
            onChange={(e) => {
              pickFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {error && (
          <div role="alert" className="flex items-start justify-between gap-3 rounded-xl border border-bad/30 bg-bad-bg p-4 text-bad">
            <span>{error}</span>
            {canRetry && !busy && (
              <button onClick={() => lastFileRef.current && explain(lastFileRef.current)} className="shrink-0 font-semibold underline">
                Retry
              </button>
            )}
          </div>
        )}

        {(status === "uploading" || (status === "streaming" && !text)) && (
          <div className="flex items-center gap-3 rounded-xl border border-line bg-surface p-4 text-muted" aria-live="polite">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            Working out the context of this meme…
          </div>
        )}

        {(category || text) && (
          <article className="rounded-2xl border border-line bg-surface p-5 shadow-sm sm:p-6" aria-live="polite" aria-busy={status === "streaming"}>
            {category && (
              <div className={`mb-4 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-semibold ${CATEGORY_STYLE[category].className}`}>
                <span aria-hidden>{CATEGORY_STYLE[category].icon}</span>
                {(searched === false ? KNOWLEDGE_CATEGORY_LABELS : CATEGORY_LABELS)[category]}
              </div>
            )}
            {searched === false && (
              <p className="mb-3 text-xs text-muted">
                Web search is unavailable right now, so this explanation is based on the AI&apos;s own knowledge.
                Very recent memes may not be recognized.
              </p>
            )}
            {adjusted && (
              <p className="mb-3 text-xs text-muted">
                Shown as partly guessed: the AI claimed full context, but its web search returned no sources to confirm it.
              </p>
            )}
            <div className="meme-markdown">
              <ReactMarkdown>{text}</ReactMarkdown>
              {status === "streaming" && <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-foreground/60 align-middle" />}
            </div>

            {sources.length > 0 && (
              <div className="mt-6 border-t border-line pt-4">
                <h2 className="mb-2 text-sm font-semibold">Sources</h2>
                <ul className="flex flex-col gap-1 text-sm">
                  {sources.map((s) => (
                    <li key={s.uri} className="truncate">
                      <a href={s.uri} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                        {s.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </article>
        )}

        <footer className="mt-auto pt-6 text-center text-xs text-muted">
          Images aren&apos;t stored. They are sent to Google Gemini to generate the explanation, and Google may use
          free-tier inputs to improve its products. AI explanations can be wrong.
        </footer>
      </main>
    </>
  );
}
