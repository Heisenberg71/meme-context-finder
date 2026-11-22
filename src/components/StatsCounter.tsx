"use client";

import { useEffect, useState } from "react";
import type { Stats } from "@/lib/store";

const REFRESH_MS = 30_000;

export function StatsCounter({ refreshKey }: { refreshKey: number }) {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/stats", { cache: "no-store" });
        if (res.ok && !cancelled) setStats(await res.json());
      } catch {
        // Keep the last known numbers.
      }
    };
    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [refreshKey]);

  const fmt = (n: number | undefined) => (n === undefined ? "–" : n.toLocaleString());

  return (
    <div className="fixed left-3 top-3 z-10 flex gap-2 text-xs sm:left-4 sm:top-4 sm:text-sm" aria-live="polite">
      <Pill label="Memes explained" value={fmt(stats?.memes)} />
      <Pill label="Users" value={fmt(stats?.users)} />
    </div>
  );
}

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5 rounded-full border border-line bg-surface/90 px-3 py-1.5 shadow-sm backdrop-blur">
      <span className="font-semibold tabular-nums">{value}</span>
      <span className="text-muted">{label}</span>
    </div>
  );
}
