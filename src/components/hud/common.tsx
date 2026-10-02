"use client";
/** Gemeinsame UI-Bausteine und Hooks für das HUD */
import { useSyncExternalStore, type ReactNode } from "react";
import { RESOURCES, type ResAmounts, type ResId } from "@/game/data";
import type { GameEngine } from "@/game/engine";
import type { GameRenderer } from "@/game/renderer";

export type Panel = "build" | "quests" | "economy" | "population" | "research" | "trade" | "menu" | null;

export interface GameCtx {
  engine: GameEngine;
  renderer: GameRenderer | null;
  panel: Panel;
  setPanel: (p: Panel) => void;
  username: string;
  saveInfo: string;
  save: () => Promise<void>;
  load: () => Promise<void>;
  newGame: (playerCount?: number) => void;
  logout: () => void;
}

/** Re-rendert die Komponente bei jeder Engine-Änderung (ca. 4× pro Sekunde) */
export function useEngine(engine: GameEngine): number {
  return useSyncExternalStore(engine.subscribe, () => engine.version, () => 0);
}

export function fmt(n: number): string {
  if (n >= 10000) return `${(n / 1000).toFixed(0)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.floor(n));
}

export function rate(n: number): string {
  const v = Math.round(n * 10) / 10;
  return (v > 0 ? "+" : "") + v.toFixed(1);
}

/** Kosten-Chips (rot, wenn nicht genug vorhanden) */
export function Cost({ cost, engine }: { cost: ResAmounts; engine: GameEngine }) {
  return (
    <span className="flex flex-wrap gap-1">
      {(Object.entries(cost) as [ResId, number][]).map(([r, n]) => {
        const lack = engine.res[r] < n;
        return (
          <span
            key={r}
            className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[12px] font-semibold leading-none ${
              lack ? "bg-red-900/70 text-red-200" : "bg-black/35 text-amber-100"
            }`}
            title={RESOURCES[r].name}
          >
            {RESOURCES[r].icon}
            {n}
          </span>
        );
      })}
    </span>
  );
}

export function Bar({ value, max, color = "#e0b34a", h = 8 }: { value: number; max: number; color?: string; h?: number }) {
  const p = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div className="w-full overflow-hidden rounded-full bg-black/45" style={{ height: h }}>
      <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${p * 100}%`, background: color }} />
    </div>
  );
}

export function Modal({ title, icon, onClose, children }: { title: string; icon: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="wood flex max-h-[94dvh] w-full flex-col rounded-t-2xl sm:max-h-[88vh] sm:max-w-3xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-amber-900/60 px-4 py-2">
          <h2 className="font-display text-xl text-amber-200">
            <span className="mr-2">{icon}</span>
            {title}
          </h2>
          <button className="btn h-11 w-11 text-xl" onClick={onClose} aria-label="Schließen">
            ✕
          </button>
        </div>
        <div className="overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>
  );
}
