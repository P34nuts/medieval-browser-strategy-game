/**
 * Physisches Bausystem.
 *
 * Platzieren erzeugt eine BAUSTELLE (kein funktionsfähiges Gebäude). Sie braucht
 *  1. Baumaterial, das Träger vom Lagerhaus über Straßen liefern (Lager der Baustelle = `physical.input`),
 *  2. Bauarbeiter (Einwohner mit Beruf „baumeister“), die zur Baustelle gehen und dort arbeiten.
 * Fortschritt wächst nur, solange Bauarbeiter anwesend sind – und höchstens so weit, wie Material geliefert wurde.
 * Straßen und Felder sind davon ausgenommen (sofort bezahlt, config.CONSTRUCTION.instant).
 */
import { BUILDINGS, type ResId } from "./data";
import { CONSTRUCTION, constructionMaterials } from "./config";
import type { Building, GameEngine } from "./engine";
import { advanceTo, buildingAccess } from "./pathing";
import type { Resident } from "./physical";
import { amountOf } from "./storage";

export const isInstant = (b: Building) => CONSTRUCTION.instant.includes(b.type) || Object.keys(constructionMaterials(b.type)).length === 0;

/** Anteil des gelieferten Materials (0..1) */
export function materialFraction(b: Building): number {
  const req = constructionMaterials(b.type) as Partial<Record<ResId, number>>;
  let need = 0, have = 0;
  for (const [r, n] of Object.entries(req) as [ResId, number][]) { need += n; have += Math.min(n, amountOf(b.physical?.input ?? {}, r)); }
  return need > 0 ? have / need : 1;
}

export type SiteState = "NO_ROAD" | "WAITING_MATERIAL" | "WAITING_BUILDERS" | "BUILDING";

export function siteState(eng: GameEngine, b: Building): SiteState {
  if (!b.connected) return "NO_ROAD";
  const frac = materialFraction(b), present = eng.residents.filter((r) => r.workTargetId === b.id && r.state === "CONSTRUCTION_WORK").length;
  if (present === 0) return b.progress < frac - 1e-6 || frac >= 1 ? "WAITING_BUILDERS" : "WAITING_MATERIAL";
  return b.progress >= frac - 1e-6 && frac < 1 ? "WAITING_MATERIAL" : "BUILDING";
}

export function updateConstruction(eng: GameEngine, dt: number) {
  const present = new Map<number, number>();
  for (const r of eng.residents) if (r.job === "baumeister" && r.state === "CONSTRUCTION_WORK" && r.workTargetId !== null) present.set(r.workTargetId, (present.get(r.workTargetId) ?? 0) + 1);
  for (const b of [...eng.buildings]) {
    if (b.built) continue;
    const def = BUILDINGS[b.type];
    if (isInstant(b)) { b.progress = Math.min(1, b.progress + dt / def.buildTime); if (b.progress >= 1) eng.completeBuilding(b); continue; }
    const frac = materialFraction(b), n = present.get(b.id) ?? 0;
    b.siteState = siteState(eng, b);
    if (n > 0) b.progress = Math.min(frac, b.progress + (dt / def.buildTime) * (n / CONSTRUCTION.buildersPerSite));
    if (b.progress >= 1 - 1e-9 && frac >= 1 - 1e-9) eng.completeBuilding(b);
  }
}

function chooseSite(eng: GameEngine, r: Resident): Building | null {
  const assigned = new Map<number, number>();
  for (const o of eng.residents) if (o.job === "baumeister" && o.workTargetId !== null) assigned.set(o.workTargetId, (assigned.get(o.workTargetId) ?? 0) + 1);
  let best: Building | null = null, bd = Infinity;
  for (const s of eng.buildings) {
    if (s.built || isInstant(s) || !s.connected) continue;
    if ((assigned.get(s.id) ?? 0) >= CONSTRUCTION.buildersPerSite) continue;
    const frac = materialFraction(s);
    if (!(frac - s.progress > 0.001 || (frac >= 1 && s.progress < 1))) continue; // keine Arbeit möglich: Material fehlt noch
    const d = Math.hypot(s.x - r.x, s.y - r.y);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

/** Bauarbeiter: am Lagerhaus bereit → zur Baustelle gehen → arbeiten → zurück */
export function tickBuilder(eng: GameEngine, r: Resident, _base: Building, dt: number) {
  const reset = () => { r.path = []; r.pathIndex = 0; r.workTimer = 0; };
  if (r.workTargetId === null) {
    if (r.workTimer < 0) { r.workTimer += dt; r.state = "WAITING"; return; }
    const site = chooseSite(eng, r);
    if (!site) { r.state = "WAITING"; r.workTimer = -1.5; return; }
    r.workTargetId = site.id; r.state = "WALKING_TO_WORK"; reset(); return;
  }
  const site = eng.getBuilding(r.workTargetId);
  if (!site || site.built) { r.workTargetId = null; r.atWork = false; r.state = "WAITING"; reset(); return; }
  if (r.state === "WALKING_TO_WORK") {
    const m = advanceTo(eng, r, "WORKER", () => buildingAccess(site), dt);
    if (m === "ARRIVED") { r.state = "CONSTRUCTION_WORK"; reset(); }
    else if (m === "NO_ROUTE") { r.workTargetId = null; r.state = "WAITING"; r.workTimer = -3; }
    return;
  }
  if (r.state === "CONSTRUCTION_WORK") {
    const stalled = site.progress >= materialFraction(site) - 1e-6 && materialFraction(site) < 1;
    if (stalled) { r.workTimer += dt; if (r.workTimer > 8) { r.workTargetId = null; r.atWork = false; r.state = "WAITING"; reset(); } } else r.workTimer = 0;
    return;
  }
  r.state = "WALKING_TO_WORK"; reset();
}
