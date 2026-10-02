"use client";
/** Vollbild-/Dialogfenster: Wirtschaft (Ketten + Engpässe), Bevölkerung, Forschung, Handel, Menü */
import { useState } from "react";
import {
  BUILDINGS, CHAINS, JOB_IDS, JOBS, LEVEL_UNLOCKS, RESOURCES, RES_IDS, STATUS_TEXT, TECHS,
  type BStatus, type ResId,
} from "@/game/data";
import { Bar, Cost, Modal, rate, useEngine, type GameCtx } from "./common";

/* ------------------------------------------------------------------ Wirtschaft */

const STATUS_PRIO: BStatus[] = ["no_input", "no_site", "no_road", "no_workers", "storage_full", "ok"];

export function EconomyModal({ g }: { g: GameCtx }) {
  const e = g.engine;
  useEngine(e);
  const bn = e.bottlenecks();
  return (
    <Modal title="Wirtschaft" icon="📊" onClose={() => g.setPanel(null)}>
      <h3 className="mb-2 font-display text-lg text-amber-200">Produktionsketten</h3>
      <div className="space-y-2">
        {CHAINS.map((ch) => (
          <div key={ch.name} className="parchment p-2">
            <div className="mb-1 text-xs font-bold uppercase tracking-wide text-amber-300/80">{ch.name}</div>
            <div className="flex flex-wrap items-center gap-1.5">
              {ch.nodes.map((n, i) => {
                const arrow = i > 0 ? <span className="text-amber-400/70">➜</span> : null;
                if (n.t === "b") {
                  const list = e.buildings.filter((b) => b.type === n.id && b.built);
                  const def = BUILDINGS[n.id];
                  let worst: BStatus = "ok";
                  for (const s of STATUS_PRIO) if (list.some((b) => b.status === s)) { worst = s; break; }
                  const locked = e.level < def.unlock;
                  const col = list.length ? STATUS_TEXT[worst].color : "#77684f";
                  return (
                    <span key={i} className="flex items-center gap-1.5">
                      {arrow}
                      <span className="rounded-lg border-2 bg-black/35 px-2 py-1 text-xs font-semibold" style={{ borderColor: col }} title={list.length ? STATUS_TEXT[worst].label : "Nicht gebaut"}>
                        {locked ? "🔒 " : ""}
                        {list.length}× {def.name}
                        {list.length > 0 && worst !== "ok" && <span className="block text-[10px] font-normal" style={{ color: col }}>{STATUS_TEXT[worst].label}</span>}
                      </span>
                    </span>
                  );
                }
                if (n.t === "r") {
                  const net = e.prod[n.id] - e.cons[n.id];
                  return (
                    <span key={i} className="flex items-center gap-1.5">
                      {arrow}
                      <span className="rounded-full bg-amber-100/10 px-2.5 py-1 text-xs font-semibold">
                        {RESOURCES[n.id].icon} {Math.floor(e.res[n.id])}
                        <span className={net > 0.05 ? "text-green-400" : net < -0.05 ? "text-red-400" : "text-amber-200/50"}> {rate(net)}</span>
                      </span>
                    </span>
                  );
                }
                return (
                  <span key={i} className="flex items-center gap-1.5">
                    {arrow}
                    <span className={`rounded-lg border-2 bg-black/35 px-2 py-1 text-xs font-semibold ${e.foodStatus === "ok" ? "border-green-500" : "border-red-500"}`}>
                      👥 Bevölkerung
                    </span>
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <h3 className="mb-2 mt-5 font-display text-lg text-amber-200">Engpässe</h3>
      <div className="space-y-1">
        {bn.length === 0 && <p className="parchment p-2 text-sm text-green-300">✔ Keine Engpässe – die Wirtschaft läuft rund.</p>}
        {bn.map((b, i) => (
          <p key={i} className={`rounded-lg border px-2.5 py-1.5 text-sm ${b.sev === "bad" ? "border-red-500/60 bg-red-950/50 text-red-100" : "border-amber-500/50 bg-amber-950/40 text-amber-100"}`}>
            {b.sev === "bad" ? "⛔" : "⚠️"} {b.text}
          </p>
        ))}
      </div>

      <h3 className="mb-2 mt-5 font-display text-lg text-amber-200">Ressourcen</h3>
      <div className="scroll-thin overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="text-left text-xs text-amber-300/80">
              <th className="p-1.5">Ressource</th>
              <th className="p-1.5">Lager</th>
              <th className="p-1.5 text-right">Produktion</th>
              <th className="p-1.5 text-right">Verbrauch</th>
              <th className="p-1.5 text-right">Saldo</th>
              <th className="p-1.5">Status</th>
            </tr>
          </thead>
          <tbody>
            {RES_IDS.map((r) => {
              const net = e.prod[r] - e.cons[r];
              let label = "–", cls = "text-amber-200/50";
              if (e.res[r] >= e.limit[r] * 0.98) { label = "Voll"; cls = "text-amber-300"; }
              else if (e.res[r] < 1 && e.cons[r] > 0.05) { label = "Engpass"; cls = "text-red-400"; }
              else if (net < -0.05) { label = e.res[r] < e.limit[r] * 0.2 ? "Knapp" : "Sinkt"; cls = "text-red-300"; }
              else if (net > 0.05) { label = "Wächst"; cls = "text-green-400"; }
              return (
                <tr key={r} className="border-t border-amber-900/50">
                  <td className="p-1.5 font-semibold">{RESOURCES[r].icon} {RESOURCES[r].name}</td>
                  <td className="w-40 p-1.5">
                    <div className="text-xs tabular-nums">{Math.floor(e.res[r])} / {e.limit[r]}</div>
                    <Bar value={e.res[r]} max={e.limit[r]} h={6} color={e.res[r] >= e.limit[r] * 0.98 ? "#e0b34a" : "#6fbf5a"} />
                  </td>
                  <td className="p-1.5 text-right tabular-nums text-green-300">{e.prod[r] > 0.05 ? `+${e.prod[r].toFixed(1)}` : "0"}</td>
                  <td className="p-1.5 text-right tabular-nums text-red-300">{e.cons[r] > 0.05 ? `−${e.cons[r].toFixed(1)}` : "0"}</td>
                  <td className={`p-1.5 text-right font-bold tabular-nums ${net > 0.05 ? "text-green-400" : net < -0.05 ? "text-red-400" : "text-amber-200/60"}`}>{rate(net)}</td>
                  <td className={`p-1.5 text-xs font-bold ${cls}`}>{label}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-amber-100/50">Alle Werte pro Minute (gleitender Durchschnitt).</p>
    </Modal>
  );
}

/* ---------------------------------------------------------------- Bevölkerung */

export function PopulationModal({ g }: { g: GameCtx }) {
  const e = g.engine;
  useEngine(e);
  const foodNeed = Math.floor(e.pop) * 0.12;
  const food = { ok: ["Versorgt", "text-green-400"], low: ["Knapp", "text-amber-300"], starving: ["Hunger!", "text-red-400"] }[e.foodStatus];
  const stat = (label: string, value: string, sub?: string, cls = "") => (
    <div className="parchment p-2.5">
      <div className="text-[11px] uppercase tracking-wide text-amber-300/70">{label}</div>
      <div className={`text-xl font-bold ${cls}`}>{value}</div>
      {sub && <div className="text-[11px] text-amber-100/60">{sub}</div>}
    </div>
  );
  return (
    <Modal title="Bevölkerung" icon="👥" onClose={() => g.setPanel(null)}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stat("Einwohner", `${Math.floor(e.pop)} / ${e.popCap}`, "Kapazität durch angebundene Häuser")}
        {stat("Wachstum", `${e.growthPerMin >= 0 ? "+" : ""}${e.growthPerMin.toFixed(1)}/min`, e.pop >= e.popCap ? "Wohnraum voll" : "Nahrung + freier Wohnraum")}
        {stat("Nahrung", food[0], `Bedarf ${foodNeed.toFixed(1)}/min (Brot bevorzugt)`, food[1])}
        {stat("Arbeitskräfte", `${Math.round(e.workforce)}`, "85 % der Einwohner")}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stat("🍞 Brot", String(Math.floor(e.res.brot)), `${rate(e.prod.brot - e.cons.brot)}/min`)}
        {stat("🌾 Getreide", String(Math.floor(e.res.getreide)), `${rate(e.prod.getreide - e.cons.getreide)}/min`)}
        {stat("🛡️ Soldaten", String(Math.floor(e.soldiers)), "Kaserne nötig")}
        {stat("⚔️ Militärstärke", String(e.military), "Soldaten, Türme, Burg")}
      </div>

      <h3 className="mb-2 mt-5 font-display text-lg text-amber-200">Berufe & Arbeitsplätze</h3>
      <div className="space-y-2">
        {JOB_IDS.map((j) => {
          const d = e.byJob[j];
          const short = d.needed - d.filled >= 0.5;
          return (
            <div key={j} className="parchment flex items-center gap-3 p-2.5">
              <span className="w-8 text-2xl">{JOBS[j].icon}</span>
              <div className="min-w-0 flex-1">
                <div className="flex justify-between text-sm font-semibold">
                  <span>{JOBS[j].name}</span>
                  <span className={short ? "text-red-300" : "text-green-300"}>
                    {d.filled.toFixed(1)} / {d.needed} Stellen
                  </span>
                </div>
                <Bar value={d.filled} max={Math.max(d.needed, 1)} color={short ? "#d9603a" : "#6fbf5a"} h={7} />
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-amber-100/60">
        Häuser (mit Straßenanbindung) erhöhen die Kapazität. Die Bevölkerung wächst nur, wenn genug Nahrung da ist. Gebäude werden in der Reihenfolge ihres
        Baus mit Arbeitern besetzt – fehlen Einwohner, bleiben neuere Betriebe unbesetzt.
      </p>
    </Modal>
  );
}

/* ------------------------------------------------------------------ Forschung */

export function ResearchModal({ g }: { g: GameCtx }) {
  const e = g.engine;
  useEngine(e);
  const act = e.research.active;
  return (
    <Modal title="Forschung" icon="📜" onClose={() => g.setPanel(null)}>
      {act && (() => {
        const t = TECHS.find((x) => x.id === act.id)!;
        return (
          <div className="parchment mb-3 p-3">
            <div className="text-sm font-bold text-amber-200">In Arbeit: {t.icon} {t.name}</div>
            <Bar value={t.time - act.remaining} max={t.time} color="#8fb9ff" h={10} />
            <div className="mt-1 text-xs text-amber-100/70">noch {Math.ceil(act.remaining)} s</div>
          </div>
        );
      })()}
      <div className="grid gap-2 sm:grid-cols-2">
        {TECHS.map((t) => {
          const done = e.research.done.includes(t.id);
          const why = e.canResearch(t.id);
          return (
            <div key={t.id} className={`parchment flex flex-col gap-2 p-3 ${done ? "!border-green-500/60" : ""}`}>
              <div className="flex items-start gap-2">
                <span className="text-3xl">{t.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-amber-100">{t.name}</div>
                  <div className="text-xs text-amber-100/70">{t.desc}</div>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <Cost cost={t.cost} engine={e} />
                <span className="shrink-0 text-xs text-amber-200/70">⏱ {t.time}s · Lv {t.minLevel}</span>
              </div>
              {done ? (
                <div className="text-center text-sm font-bold text-green-400">✔ Erforscht</div>
              ) : (
                <button className="btn btn-primary h-11" disabled={!!why && why !== "Nicht genug Gold"} onClick={() => e.startResearch(t.id)}>
                  {why && act?.id !== t.id ? (why.startsWith("Nicht genug") || why.startsWith("Ab") ? `Erforschen (${why})` : why) : "Erforschen"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------------- Handel */

export function TradeModal({ g }: { g: GameCtx }) {
  const e = g.engine;
  useEngine(e);
  const [msg, setMsg] = useState<string | null>(null);
  const active = e.marketActive();
  const go = (r: ResId, n: number, mode: "buy" | "sell") => setMsg(e.trade(r, n, mode));
  const hasMarket = e.count("market") > 0;
  return (
    <Modal title="Handel" icon="⚖️" onClose={() => g.setPanel(null)}>
      <div className="mb-3 flex items-center justify-between rounded-lg bg-black/30 px-3 py-2">
        <span className="font-semibold">🪙 Gold: {Math.floor(e.res.gold)}</span>
        <span className="text-xs text-amber-100/60">Geschäfte: {e.tradeCount}</span>
      </div>
      {!active && (
        <p className="mb-3 rounded-lg border border-amber-500/50 bg-amber-950/40 p-3 text-sm">
          {e.level < BUILDINGS.market.unlock
            ? `Der Marktplatz wird ab Level ${BUILDINGS.market.unlock} freigeschaltet.`
            : !hasMarket
              ? "Baue einen Marktplatz, um Waren zu kaufen und zu verkaufen."
              : "Der Marktplatz muss fertig gebaut, an die Straße angebunden und mit Händlern besetzt sein."}
        </p>
      )}
      {msg && <p className="mb-2 rounded bg-red-900/60 px-2 py-1 text-sm">{msg}</p>}
      <div className="space-y-1.5">
        {RES_IDS.filter((r) => r !== "gold").map((r) => (
          <div key={r} className="parchment flex flex-wrap items-center gap-2 p-2">
            <div className="w-36 shrink-0">
              <div className="text-sm font-bold">{RESOURCES[r].icon} {RESOURCES[r].name}</div>
              <div className="text-[11px] text-amber-100/60">Lager {Math.floor(e.res[r])}</div>
            </div>
            <div className="flex flex-1 flex-wrap items-center justify-end gap-1.5">
              <span className="mr-1 text-right text-[11px] leading-tight text-amber-100/70">
                Verkauf {e.tradePrice(r, "sell").toFixed(1)}🪙<br />Kauf {e.tradePrice(r, "buy").toFixed(1)}🪙
              </span>
              <button className="btn h-11 min-w-[72px] px-2 text-sm" disabled={!active} onClick={() => go(r, 10, "sell")}>Verk. 10</button>
              <button className="btn h-11 min-w-[72px] px-2 text-sm" disabled={!active} onClick={() => go(r, 50, "sell")}>Verk. 50</button>
              <button className="btn btn-primary h-11 min-w-[72px] px-2 text-sm" disabled={!active} onClick={() => go(r, 10, "buy")}>Kauf 10</button>
              <button className="btn btn-primary h-11 min-w-[72px] px-2 text-sm" disabled={!active} onClick={() => go(r, 50, "buy")}>Kauf 50</button>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------------ Menü */

export function MenuModal({ g }: { g: GameCtx }) {
  const e = g.engine;
  useEngine(e);
  const [sure, setSure] = useState(false);
  const [playerCount, setPlayerCount] = useState(Math.max(2, Math.min(8, e.players.length)));
  const mins = Math.floor(e.playTime / 60);
  return (
    <Modal title="Spielmenü" icon="⚙️" onClose={() => g.setPanel(null)}>
      <div className="parchment mb-3 p-3">
        <div className="text-sm">👤 Angemeldet als <b className="text-amber-200">{g.username}</b></div>
        <div className="text-xs text-amber-100/60">Spielzeit {mins} min · Kartennummer {e.seed}</div>
        <div className="mt-1 text-xs text-amber-100/80">{g.saveInfo}</div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <button className="btn btn-primary h-12 text-base" onClick={() => void g.save()}>💾 Speichern</button>
        <button className="btn h-12 text-base" onClick={() => void g.load()}>📂 Laden</button>
        {sure ? (
          <div className="flex gap-2">
            <button className="btn btn-danger h-12 flex-1" onClick={() => { setSure(false); g.newGame(playerCount); }}>Ja, neue Karte</button>
            <button className="btn h-12 flex-1" onClick={() => setSure(false)}>Nein</button>
          </div>
        ) : (
          <button className="btn h-12 text-base" onClick={() => setSure(true)}>🗺️ Neue Karte</button>
        )}
        <button className="btn btn-danger h-12 text-base" onClick={g.logout}>🚪 Abmelden</button>
      </div>

      <div className="parchment mt-3 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="font-semibold text-amber-200">🏰 Spieler</span>
          <label className="flex items-center gap-2 text-sm">
            <span>Neue Karte</span>
            <select className="rounded bg-black/40 px-2 py-1 text-amber-100" value={playerCount} onChange={(ev) => setPlayerCount(Number(ev.target.value))}>
              {Array.from({ length: 7 }, (_, i) => i + 2).map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>
        <div className="grid gap-1 sm:grid-cols-2">
          {e.players.map((p) => <div key={p.id} className="flex items-center justify-between rounded bg-black/20 px-2 py-1 text-sm">
            <span><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: p.color }} />{p.name}</span>
            <span className="text-xs text-amber-100/70">{p.kind === "computer" ? "Computergegner" : "Du"} · {p.score} Punkte</span>
          </div>)}
        </div>
        <p className="mt-2 text-xs text-amber-100/60">Bis zu 8 Spieler. Im Solomodus ist automatisch ein Computergegner dabei.</p>
      </div>

      <h3 className="mb-2 mt-5 font-display text-lg text-amber-200">Steuerung</h3>
      <ul className="parchment space-y-1 p-3 text-sm text-amber-100/90">
        <li>🖱️ <b>Desktop:</b> Linke Maustaste ziehen oder rechte Maustaste ziehen = Karte verschieben · Mausrad = Zoom · WASD/Pfeiltasten · Esc = Abbrechen</li>
        <li>📱 <b>Touch:</b> Ein Finger ziehen = verschieben · Zwei Finger = Zoom · Beim Bauen: antippen = Vorschau, erneut antippen oder „Bauen“ = platzieren</li>
        <li>🛣️ Gebäude brauchen eine <b>Straßenanbindung</b> an ein Lagerhaus (oder eine Burg), sonst arbeiten sie nicht.</li>
        <li>🧑‍🤝‍🧑 Arbeitsplätze brauchen Einwohner, Einwohner brauchen Häuser und Nahrung.</li>
      </ul>

      <h3 className="mb-2 mt-5 font-display text-lg text-amber-200">Freischaltungen</h3>
      <div className="space-y-1">
        {LEVEL_UNLOCKS.map((u) => (
          <div key={u.level} className={`parchment flex justify-between p-2 text-sm ${e.level >= u.level ? "!border-green-500/60" : "opacity-70"}`}>
            <span>Level {u.level}: <b>{u.name}</b></span>
            <span>{e.level >= u.level ? "✔" : "🔒"}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
