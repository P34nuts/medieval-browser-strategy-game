"use client";
/**
 * Links: Bauoptionen (Kategorien, Kosten, Sperren)   |   Rechts: Aufgaben
 * Auf dem Desktop dauerhaft angedockt, auf Mobilgeräten als Sheet über die untere Leiste.
 */
import { useMemo, useState } from "react";
import { BUILDINGS, CATEGORIES, LEVEL_UNLOCKS, RESOURCES, type BuildingId, type Category, type ResId } from "@/game/data";
import { spriteThumb } from "@/game/sprites";
import { Bar, Cost, useEngine, type GameCtx } from "./common";

export function BuildMenu({ g }: { g: GameCtx }) {
  const e = g.engine;
  useEngine(e);
  const [cat, setCat] = useState<Category>("wohnen");
  const list = useMemo(() => Object.values(BUILDINGS).filter((b) => b.category === cat), [cat]);
  const open = g.panel === "build";
  return (
    <div
      className={`${open ? "flex" : "hidden lg:flex"} wood absolute inset-x-2 bottom-[88px] z-30 max-h-[58dvh] flex-col rounded-xl lg:bottom-[88px] lg:left-2 lg:right-auto lg:top-[92px] lg:max-h-none lg:w-[310px]`}
    >
      <div className="flex items-center justify-between px-3 pt-2">
        <h2 className="font-display text-lg text-amber-200">🔨 Bauen</h2>
        <button className="btn h-10 w-10 lg:hidden" onClick={() => g.setPanel(null)} aria-label="Schließen">
          ✕
        </button>
      </div>
      <div className="no-scrollbar flex gap-1 overflow-x-auto px-2 py-2">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            onClick={() => setCat(c.id)}
            className={`btn h-12 min-w-[56px] shrink-0 flex-col gap-0 px-2 text-[10px] leading-tight ${cat === c.id ? "!border-amber-200 brightness-125" : ""}`}
            title={c.name}
          >
            <span className="text-xl leading-none">{c.icon}</span>
            {c.name.length > 9 ? c.name.slice(0, 8) + "." : c.name}
          </button>
        ))}
      </div>
      <div className="scroll-thin flex-1 space-y-2 overflow-y-auto px-2 pb-2">
        {list.map((b) => {
          const locked = e.level < b.unlock;
          const active = e.ui.buildType === b.id;
          return (
            <button
              key={b.id}
              onClick={() => {
                if (locked) { e.toast(`${b.name}: ab Level ${b.unlock}`, "warn"); return; }
                e.setBuildType(active ? null : (b.id as BuildingId));
                if (!active) g.setPanel(null);
              }}
              className={`parchment flex w-full items-center gap-3 p-2 text-left ${active ? "!border-green-400 bg-green-900/30" : ""} ${locked ? "opacity-60" : "hover:bg-amber-200/10"}`}
            >
              <span className="relative grid h-[60px] w-[60px] shrink-0 place-items-center rounded-lg bg-black/30">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={spriteThumb(b.id)} alt="" width={56} height={56} className={locked ? "grayscale" : ""} />
                {locked && <span className="absolute inset-0 grid place-items-center text-2xl">🔒</span>}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-bold text-amber-100">{b.name}</span>
                {locked ? (
                  <span className="text-xs font-semibold text-red-300">Ab Level {b.unlock}</span>
                ) : (
                  <>
                    <Cost cost={b.cost} engine={e} />
                    <span className="mt-1 block text-[11px] leading-snug text-amber-100/70">{b.desc}</span>
                  </>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function QuestPanel({ g }: { g: GameCtx }) {
  const e = g.engine;
  useEngine(e);
  const quests = e.activeQuests(5);
  const next = LEVEL_UNLOCKS.find((u) => u.level > e.level);
  const open = g.panel === "quests";
  return (
    <div
      className={`${open ? "flex" : "hidden lg:flex"} wood absolute inset-x-2 bottom-[88px] z-30 max-h-[58dvh] flex-col rounded-xl lg:inset-x-auto lg:bottom-auto lg:right-2 lg:top-[92px] lg:max-h-[calc(100dvh-190px)] lg:w-[300px]`}
    >
      <div className="flex items-center justify-between px-3 pt-2">
        <h2 className="font-display text-lg text-amber-200">📋 Aufgaben</h2>
        <span className="text-xs text-amber-200/70">
          {e.questsDone.length} erledigt
        </span>
        <button className="btn h-10 w-10 lg:hidden" onClick={() => g.setPanel(null)} aria-label="Schließen">
          ✕
        </button>
      </div>
      <div className="scroll-thin space-y-2 overflow-y-auto p-2">
        {quests.length === 0 && <p className="p-3 text-sm text-amber-100/70">Alle verfügbaren Aufgaben sind erledigt. Steige im Level auf, um neue zu erhalten.</p>}
        {quests.map((q) => {
          const p = e.questProgress(q);
          return (
            <div key={q.id} className="parchment p-2.5">
              <div className="text-[14px] font-bold text-amber-100">{q.title}</div>
              <div className="mt-1.5 flex items-center gap-2">
                <Bar value={p.cur} max={p.target} color="#6fbf5a" h={8} />
                <span className="shrink-0 text-xs font-semibold tabular-nums text-amber-200">
                  {Math.floor(p.cur * 10) / 10}/{p.target}
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px] text-amber-100/80">
                <span className="rounded bg-amber-700/60 px-1.5 py-0.5 font-bold">+{q.xp} EP</span>
                {(Object.entries(q.reward ?? {}) as [ResId, number][]).map(([r, n]) => (
                  <span key={r} className="rounded bg-black/35 px-1.5 py-0.5">
                    {RESOURCES[r].icon}
                    {n}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
        {next && (
          <div className="rounded-lg border border-dashed border-amber-700/60 p-2 text-xs text-amber-100/70">
            🔓 Level {next.level}: <b className="text-amber-200">{next.name}</b>
          </div>
        )}
      </div>
    </div>
  );
}
