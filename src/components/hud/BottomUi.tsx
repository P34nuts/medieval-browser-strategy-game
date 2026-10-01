"use client";
/** Schnellmenü unten, Bau-Hinweis mit Bestätigen/Abbrechen, Gebäude-Inspektor, Toasts, Zoom-Buttons */
import { useState } from "react";
import { BUILDINGS, JOBS, RESOURCES, STATUS_TEXT, type JobId, type ResId } from "@/game/data";
import { getCapacity } from "@/game/storage";
import { Bar, Cost, rate, useEngine, type GameCtx, type Panel } from "./common";

const ITEMS: { id: Panel; icon: string; label: string; cls?: string }[] = [
  { id: "build", icon: "🔨", label: "Bauen", cls: "lg:hidden" },
  { id: "economy", icon: "📊", label: "Wirtschaft" },
  { id: "population", icon: "👥", label: "Volk" },
  { id: "research", icon: "📜", label: "Forschung" },
  { id: "trade", icon: "⚖️", label: "Handel" },
  { id: "quests", icon: "📋", label: "Aufgaben", cls: "lg:hidden" },
  { id: "menu", icon: "⚙️", label: "Menü" },
];

export function BottomBar({ g }: { g: GameCtx }) {
  const e = g.engine;
  useEngine(e);
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      <div className="pointer-events-auto mx-auto mb-1 flex w-fit gap-1 rounded-lg bg-black/45 p-1">
        {([0, 1, 2] as const).map((speed) => <button key={speed} className={`btn h-9 min-w-12 px-2 text-xs ${e.simulationSpeed === speed ? "!border-amber-200 brightness-125" : ""}`} onClick={() => e.setSimulationSpeed(speed)}>{speed === 0 ? "Ⅱ" : `${speed}×`}</button>)}
      </div>
      <div className="wood pointer-events-auto mx-auto flex max-w-xl justify-around gap-1 rounded-xl p-1">
        {ITEMS.map((i) => (
          <button
            key={i.id}
            onClick={() => g.setPanel(g.panel === i.id ? null : i.id)}
            className={`btn h-[58px] min-w-0 flex-1 flex-col gap-0 px-0.5 text-[11px] leading-tight ${i.cls ?? ""} ${g.panel === i.id ? "!border-amber-200 brightness-125" : ""}`}
          >
            <span className="text-2xl leading-none">{i.icon}</span>
            <span className="truncate">{i.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Erscheint im Baumodus: Name, Kosten, Gültigkeit, Bestätigen/Abbrechen */
export function BuildHint({ g }: { g: GameCtx }) {
  const e = g.engine;
  useEngine(e);
  const t = e.ui.buildType;
  if (!t) return null;
  const def = BUILDINGS[t];
  const ghost = e.ui.ghost;
  const chk = ghost?.check;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[88px] z-40 flex justify-center px-2">
      <div className="wood pointer-events-auto w-full max-w-[540px] rounded-xl p-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-display text-lg leading-tight text-amber-200">{def.name}</div>
            <Cost cost={def.cost} engine={e} />
          </div>
          <div className="text-right text-xs">
            {!ghost && <span className="text-amber-100/70">Tippe auf die Karte, um zu platzieren.</span>}
            {chk && chk.ok && <span className="font-bold text-green-400">✔ Platz frei</span>}
            {chk && !chk.ok && <span className="font-bold text-red-400">✖ {chk.reason}</span>}
            {chk && chk.site !== null && (
              <div className="mt-0.5 text-amber-100/80">
                {def.site?.label}: <b className={chk.site > 0.6 ? "text-green-300" : chk.site > 0 ? "text-amber-300" : "text-red-300"}>{Math.round(chk.site * 100)} %</b>
                {chk.mineRes && <span> · {RESOURCES[chk.mineRes].icon} {RESOURCES[chk.mineRes].name}</span>}
              </div>
            )}
          </div>
        </div>
        <div className="mt-2 flex gap-2">
          {t !== "road" && <button className="btn h-12 px-4 text-base" onClick={() => e.rotateBuild()}>↻ {e.ui.buildRotation * 90}°</button>}
          {t !== "road" && (
            <button className="btn btn-primary h-12 flex-1 text-base" disabled={!chk?.ok} onClick={() => e.confirmGhost()}>
              ✔ Bauen
            </button>
          )}
          <button className="btn btn-danger h-12 flex-1 text-base" onClick={() => e.setBuildType(null)}>
            ✖ {t === "road" ? "Fertig" : "Abbrechen"}
          </button>
        </div>
        <p className="mt-1.5 hidden text-[11px] text-amber-100/60 lg:block">
          Linksklick: platzieren{t === "road" ? " (gedrückt halten zum Ziehen)" : ""} · Rechte Maustaste ziehen: Karte verschieben · Esc: abbrechen
        </p>
      </div>
    </div>
  );
}

/** Info-Karte des gewählten Gebäudes */
export function Inspector({ g }: { g: GameCtx }) {
  const e = g.engine;
  useEngine(e);
  const [confirm, setConfirm] = useState<number | null>(null);
  const id = e.ui.selectedId;
  const b = id ? e.getBuilding(id) : undefined;
  if (!b || e.ui.buildType) return null;
  const def = BUILDINGS[b.type];
  const st = STATUS_TEXT[b.status];
  const rates = e.buildingRates(b);
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[88px] z-40 flex justify-center px-2">
      <div className="wood pointer-events-auto w-full max-w-[460px] rounded-xl p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-display text-lg leading-tight text-amber-200">{def.name}</div>
            <div className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: st.color }}>
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: st.color }} />
              {st.label}
              {b.missing && b.status === "no_input" ? `: ${RESOURCES[b.missing].name} fehlt` : ""}
            </div>
          </div>
          <button className="btn h-10 w-10" onClick={() => e.select(null)} aria-label="Schließen">
            ✕
          </button>
        </div>

        {!b.built && (() => {
          const info = e.siteInfo(b);
          const stateText: Record<string, string> = { NO_ROAD: "⛔ Keine Straßenanbindung – Material kann nicht geliefert werden", WAITING_MATERIAL: "📦 Wartet auf Baumaterial (Träger unterwegs)", WAITING_BUILDERS: "🧱 Wartet auf Bauarbeiter", BUILDING: "🔨 Bauarbeiter arbeiten" };
          const instant = !info || Object.keys(info.required).length === 0;
          const builders = e.residents.filter((r) => r.workTargetId === b.id && r.state === "CONSTRUCTION_WORK").length;
          return (
            <div className="mt-2">
              <Bar value={b.progress} max={1} color="#e8b64a" h={10} />
              <div className="mt-1 text-xs text-amber-100/70">{instant ? `Bauzeit: noch ${Math.ceil((1 - b.progress) * def.buildTime)} s` : `Baufortschritt ${Math.round(b.progress * 100)} % · Bauarbeiter vor Ort: ${builders}`}</div>
              {!instant && info && (
                <div className="mt-1 space-y-0.5 rounded-lg border border-amber-200/15 bg-black/20 p-2 text-xs">
                  <div className="font-semibold text-amber-200">{stateText[info.state]}</div>
                  <div>Material: {(Object.entries(info.required) as [ResId, number][]).map(([r, n]) => `${RESOURCES[r].icon} ${Math.floor(b.physical?.input[r] ?? 0)}/${n}`).join(" · ")}</div>
                </div>
              )}
            </div>
          );
        })()}

        {b.built && (
          <div className="mt-2 space-y-1 text-[13px] text-amber-100/90">
            <p className="text-xs text-amber-100/60">{def.desc}</p>
            {def.needsRoad && (
              <div>
                🛣️ Straße: <b className={b.connected ? "text-green-400" : "text-red-400"}>{b.connected ? "angebunden" : "keine Anbindung an ein Lagerhaus"}</b>
              </div>
            )}
            {(def.jobs || def.crew) && (
              <div>
                {(Object.entries(b.crew) as [JobId, number][]).length === 0 ? "👷 Keine Arbeiter zugewiesen" : (Object.entries(b.crew) as [JobId, number][]).map(([j, n]) => `${JOBS[j].icon} ${JOBS[j].name}: ${n}`).join(" · ")}
                {def.jobs && <span className="text-amber-100/60"> (Stellen: {e.slotsOf(b)})</span>}
              </div>
            )}
            {BUILDINGS[b.type].hub && (() => { const lg = e.logistics(); return <div className="rounded-lg border border-sky-200/15 bg-black/20 p-2 text-xs"><div className="font-semibold text-sky-200">Logistik</div><div>Träger: <b>{lg.busy}</b> aktiv / <b>{lg.idle}</b> frei / {lg.carriers} gesamt</div><div>Aufträge: {lg.active} aktiv · <b className={lg.waiting > lg.carriers ? "text-red-300" : ""}>{lg.waiting} warten auf Träger</b>{lg.blockedRoute > 0 && <span className="text-red-300"> · {lg.blockedRoute} ohne Route</span>}</div><div className="text-amber-100/60">Geliefert: {lg.stats.delivered} · Waren: {Math.round(lg.stats.goods)}</div></div>; })()}
            {def.housing && <div>🏠 Wohnplätze: <b>{def.housing}</b></div>}
            {def.site && (
              <div>
                🎯 {def.site.label}: <b className={b.site > 0.6 ? "text-green-400" : b.site > 0 ? "text-amber-300" : "text-red-400"}>{Math.round(b.site * 100)} %</b>
                {b.type === "mine" && b.mineRes && <span> · fördert {RESOURCES[b.mineRes].icon} {RESOURCES[b.mineRes].name}</span>}
              </div>
            )}
            {def.recipe && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {rates.inputs.length > 0 && (
                  <span>Verbraucht: {rates.inputs.map(([r, n]) => `${RESOURCES[r as ResId].icon}${rate(-n)}`).join(" ")}/min</span>
                )}
                {rates.outputs.length > 0 && (
                  <span>Produziert: {rates.outputs.map(([r, n]) => `${RESOURCES[r as ResId].icon}${rate(n)}`).join(" ")}/min</span>
                )}
                {def.recipe.special === "soldier" && <span>Soldaten: <b>{Math.floor(e.soldiers)}</b></span>}
              </div>
            )}
            {b.physical && (
              <div className="rounded-lg border border-amber-200/15 bg-black/20 p-2 text-xs">
                <div className="font-semibold text-amber-200">Physische Wirtschaft · Stufe {b.physical.level}</div>
                {!BUILDINGS[b.type].hub && b.physical.production && (e.isProcessor(b)) && <div>Produktion: <b>{b.physical.production.replaceAll("_", " ")}</b> · {Math.round(b.physical.productionProgress * 100)} %</div>}
                {(["input", "output"] as const).map((side) => {
                  const list = (Object.entries(b.physical![side]) as [ResId, number][]).filter(([, n]) => n > 0);
                  if (BUILDINGS[b.type].hub && side === "input") return null;
                  return <div key={side}>{BUILDINGS[b.type].hub ? "Lager" : side === "input" ? "Eingang" : "Ausgang"}: {list.map(([r, n]) => `${RESOURCES[r].icon} ${Math.floor(n)}${BUILDINGS[b.type].hub ? "" : `/${getCapacity(e, b, side, r)}`}`).join(" · ") || "leer"}</div>;
                })}
                {e.ordersOf(b.id).map((o) => <div key={o.id} className="text-amber-100/70">↔ #{o.id} {RESOURCES[o.resource].icon}{o.amount} · {o.status.replaceAll("_", " ")}</div>)}
              </div>
            )}
            {b.field && (
              <div className="rounded-lg border border-lime-200/15 bg-black/20 p-2 text-xs">
                <div className="font-semibold text-lime-200">Feld-Lifecycle · {b.field.stage}</div>
                <div>Fortschritt: <b>{Math.round(b.field.progress * 100)} %</b> · Ertrag: <b>🌾 {b.field.yieldAmount}</b></div>
                <div>{b.field.farmerId ? "Bauer arbeitet auf diesem Feld" : "Feld wartet auf einen Bauern"}</div>
              </div>
            )}
            {(b.type === "mine" || b.type === "quarry") && (() => { const dep = e.depositInfo(b); return <div className="rounded-lg border border-stone-200/15 bg-black/20 p-2 text-xs"><div className="font-semibold text-stone-200">Vorkommen · {RESOURCES[dep.resource].name}</div><div>Verbleibend: <b>{Math.floor(dep.remaining).toLocaleString("de-DE")}</b></div><div>{dep.remaining <= 0 ? "Produktion gestoppt: Vorkommen erschöpft" : "Bergarbeiter fördern aus dem tatsächlichen Vorrat"}</div></div>; })()}
            {def.storage && <div>📦 Lager: <b>+{def.storage}</b> je Ressource</div>}
            {def.military && <div>🛡️ Militärstärke: <b>+{def.military}</b></div>}
          </div>
        )}

        <div className="mt-3">
          {b.built && b.type !== "road" && b.type !== "field" && (
            <div className="mb-2 flex gap-2">
              <button className="btn h-11 flex-1" onClick={() => { if (!e.rotateBuilding(b.id)) e.toast("Rotation am Standort nicht möglich", "warn"); }}>↻ Drehen ({b.rotation * 90}°)</button>
              {e.canUpgrade(b.id).level && <button className="btn btn-primary h-11 flex-1" onClick={() => { const r = e.upgradeBuilding(b.id); if (!r.ok && r.reason) e.toast(r.reason, "warn"); }}>⬆ Stufe {e.canUpgrade(b.id).level} · {Object.entries(e.canUpgrade(b.id).cost ?? {}).map(([r, n]) => `${RESOURCES[r as ResId].icon}${n}`).join(" ")}</button>}
            </div>
          )}
          {confirm === b.id ? (
            <div className="flex gap-2">
              <button
                className="btn btn-danger h-11 flex-1"
                onClick={() => {
                  const r = e.demolish(b.id);
                  if (!r.ok && r.reason) e.toast(r.reason, "warn");
                  setConfirm(null);
                }}
              >
                Wirklich abreißen
              </button>
              <button className="btn h-11 flex-1" onClick={() => setConfirm(null)}>
                Behalten
              </button>
            </div>
          ) : (
            <button className="btn h-11 w-full" onClick={() => setConfirm(b.id)}>
              🧨 Abreißen (50 % Rückerstattung)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function Toasts({ g }: { g: GameCtx }) {
  const e = g.engine;
  useEngine(e);
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[112px] z-40 flex flex-col items-center gap-1.5 px-2 lg:top-[84px]">
      {e.toasts.map((t) => (
        <div
          key={t.id}
          className={`toast max-w-[92vw] rounded-lg border px-3 py-1.5 text-sm font-semibold shadow-lg ${
            t.kind === "level"
              ? "border-amber-200 bg-amber-600 text-white"
              : t.kind === "good"
                ? "border-green-400/70 bg-green-900/90 text-green-50"
                : t.kind === "warn"
                  ? "border-red-400/70 bg-red-900/90 text-red-50"
                  : "border-amber-700 bg-stone-900/90 text-amber-50"
          }`}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function ZoomButtons({ g }: { g: GameCtx }) {
  return (
    <div className="absolute bottom-[92px] right-2 z-20 flex flex-col gap-1.5">
      <button className="btn wood h-11 w-11 text-2xl" onClick={() => g.renderer?.zoomBy(1.25)} aria-label="Vergrößern">
        +
      </button>
      <button className="btn wood h-11 w-11 text-2xl" onClick={() => g.renderer?.zoomBy(0.8)} aria-label="Verkleinern">
        −
      </button>
      <button className="btn wood h-11 w-11 text-xl" onClick={() => g.renderer?.centerOnTile(32, 34)} aria-label="Zur Siedlung">
        🏘️
      </button>
    </div>
  );
}
