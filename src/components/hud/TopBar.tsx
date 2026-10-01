"use client";
/** Obere Leiste: Level/EP, Bevölkerung und alle Ressourcen (Bestand, Limit, Saldo pro Minute) */
import { RESOURCES, RES_IDS } from "@/game/data";
import { Bar, fmt, rate, useEngine, type GameCtx } from "./common";

export default function TopBar({ g }: { g: GameCtx }) {
  const e = g.engine;
  useEngine(e);
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 p-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
      <div className="wood pointer-events-auto flex flex-col gap-1.5 rounded-xl px-2 py-1.5 lg:flex-row lg:items-center lg:gap-3">
        {/* Level + Bevölkerung */}
        <div className="flex items-center gap-2 lg:shrink-0">
          <div
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 border-amber-300 bg-gradient-to-b from-amber-600 to-amber-900 font-display text-lg font-bold text-amber-50"
            title="Level"
          >
            {e.level}
          </div>
          <div className="min-w-[110px] flex-1 lg:w-36 lg:flex-none">
            <div className="flex justify-between text-[11px] font-semibold text-amber-200">
              <span>Level {e.level}</span>
              <span>
                {Math.floor(e.xp)}/{e.nextXp} EP
              </span>
            </div>
            <Bar value={e.xp} max={e.nextXp} color="linear-gradient(90deg,#e0b34a,#f5d98a)" h={9} />
          </div>
          <button
            className="btn h-11 gap-1 px-2.5 text-sm"
            onClick={() => g.setPanel("population")}
            title="Bevölkerung"
          >
            <span className="text-lg">👥</span>
            <span className="leading-tight">
              {Math.floor(e.pop)}
              <span className="text-amber-300/70">/{e.popCap}</span>
            </span>
          </button>
          <button className="btn h-11 w-11 text-xl lg:hidden" onClick={() => g.setPanel("menu")} aria-label="Menü">
            ⚙️
          </button>
        </div>

        {/* Ressourcen */}
        <div className="no-scrollbar -mx-0.5 flex flex-1 gap-1.5 overflow-x-auto">
          {RES_IDS.map((r) => {
            const net = e.prod[r] - e.cons[r];
            const full = e.res[r] >= e.limit[r] * 0.98;
            const empty = e.res[r] < 1;
            return (
              <button
                key={r}
                onClick={() => g.setPanel("economy")}
                className={`flex h-11 min-w-[78px] shrink-0 items-center gap-1.5 rounded-lg border px-2 text-left ${
                  empty ? "border-red-500/70 bg-red-950/50" : full ? "border-amber-400/70 bg-amber-900/40" : "border-amber-900/60 bg-black/30"
                }`}
                title={`${RESOURCES[r].name}: ${Math.floor(e.res[r])}/${e.limit[r]}`}
              >
                <span className="text-xl leading-none">{RESOURCES[r].icon}</span>
                <span className="leading-tight">
                  <span className="block text-[14px] font-bold">
                    {fmt(e.res[r])}
                    <span className="text-[10px] font-normal text-amber-200/60">/{fmt(e.limit[r])}</span>
                  </span>
                  <span className={`block text-[10px] font-semibold ${net > 0.05 ? "text-green-400" : net < -0.05 ? "text-red-400" : "text-amber-200/50"}`}>
                    {rate(net)}/min
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <button className="btn hidden h-11 w-11 text-xl lg:inline-flex" onClick={() => g.setPanel("menu")} aria-label="Menü">
          ⚙️
        </button>
      </div>
    </div>
  );
}
