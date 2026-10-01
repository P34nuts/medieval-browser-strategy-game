/**
 * Einwohner: endliche Bevölkerung, Wohnungen, Arbeitsplatzvergabe und Alltagszyklus.
 *
 * Es gibt genau `floor(pop)` Einwohner-Entitäten. Berufe (auch Träger und Bauarbeiter) werden nur aus
 * diesem Bestand vergeben – nie entstehen Einwohner durch Transport- oder Bauaufträge.
 *
 * Alltag:  AT_HOME → WALKING_TO_WORK → (WAITING/WORKING/…) → RETURNING_HOME → AT_HOME
 * Zuweisungen werden bei Gebäudeabriss, Straßenverlust oder Personalmangel sauber aufgelöst.
 */
import { BUILDINGS, type JobId, type ResId } from "./data";
import { SPEED } from "./config";
import type { Building, GameEngine } from "./engine";
import { advanceTo, buildingAccess, entrancePoint } from "./pathing";
import type { Resident } from "./physical";
import { depositResource } from "./economy";
import { onCarrierReleased } from "./logistics";
import { tickBuilder } from "./construction";
import { releaseGatherTask, tickFarmer, tickLumberjack, tickForester, tickMiner } from "./jobs";

export function newResident(eng: GameEngine, x: number, y: number): Resident {
  return {
    id: eng.nextResidentId++, x, y, homeBuildingId: null, job: "unassigned", workplaceId: null,
    state: "WAITING", targetX: x, targetY: y, speed: SPEED.worker, path: [], pathIndex: 0, carrying: null,
    workTimer: 0, animation: 0, workTargetId: null, orderId: null, atWork: false,
  };
}

const retarget = (r: Resident) => { r.path = []; r.pathIndex = 0; };

/** Anzahl der Einwohner an die Bevölkerungszahl anpassen (nur dort entstehen/verschwinden Einwohner). */
export function syncPopulation(eng: GameEngine) {
  const wanted = Math.floor(eng.pop);
  const hub = eng.hubs[0];
  while (eng.residents.length < wanted && hub) {
    const [x, y] = entrancePoint(eng, hub);
    eng.addResident(newResident(eng, x, y));
  }
  while (eng.residents.length > wanted) {
    // Zuerst Arbeitslose ohne Fracht, dann untätige Arbeiter, zuletzt Beschäftigte
    const score = (r: Resident) => (r.carrying || r.orderId !== null ? 3 : r.workplaceId === null ? 0 : r.workTargetId === null ? 1 : 2);
    let victim = eng.residents[0];
    for (const r of eng.residents) if (score(r) < score(victim)) victim = r;
    releaseResident(eng, victim);
    eng.removeResident(victim);
  }
}

/** Löst Arbeit, Aufgaben, Reservierungen und Fracht eines Einwohners auf. */
export function releaseResident(eng: GameEngine, r: Resident) {
  if (r.job === "traeger") onCarrierReleased(eng, r);
  releaseGatherTask(eng, r);
  if (r.carrying) {
    const c = r.carrying;
    const put = depositResource(eng, c.resource as ResId, c.amount);
    if (c.amount - put > 1e-6) eng.lostGoods[c.resource] = (eng.lostGoods[c.resource] ?? 0) + (c.amount - put);
    r.carrying = null;
  }
  r.job = "unassigned"; r.workplaceId = null; r.atWork = false; r.workTargetId = null; r.orderId = null;
  r.workTimer = 0; retarget(r); r.state = "WAITING"; r.speed = SPEED.worker;
}

export function assignHomes(eng: GameEngine) {
  const used = new Map<number, number>();
  const homes = eng.buildings.filter((b) => b.built && b.connected && (BUILDINGS[b.type].housing ?? 0) > 0);
  const home = new Map(homes.map((h) => [h.id, h]));
  for (const r of eng.residents) {
    if (r.homeBuildingId === null) continue;
    const h = home.get(r.homeBuildingId);
    if (!h || (used.get(h.id) ?? 0) >= (BUILDINGS[h.type].housing ?? 0)) { r.homeBuildingId = null; continue; }
    used.set(h.id, (used.get(h.id) ?? 0) + 1);
  }
  for (const r of eng.residents) {
    if (r.homeBuildingId !== null) continue;
    let best: Building | null = null, bd = Infinity;
    for (const h of homes) {
      if ((used.get(h.id) ?? 0) >= (BUILDINGS[h.type].housing ?? 0)) continue;
      const d = Math.hypot(h.x - r.x, h.y - r.y);
      if (d < bd) { bd = d; best = h; }
    }
    if (best) { r.homeBuildingId = best.id; used.set(best.id, (used.get(best.id) ?? 0) + 1); }
  }
}

/** Arbeitsplätze mit Einwohnern besetzen – `b.crew` (aus computeStats) gibt vor, wie viele je Beruf erlaubt sind. */
export function assignWorkplaces(eng: GameEngine) {
  const assigned = new Map<number, Map<string, Resident[]>>();
  for (const r of eng.residents) {
    if (r.workplaceId === null) continue;
    const b = eng.getBuilding(r.workplaceId);
    if (!b || !b.built || !(b.crew[r.job as JobId] ?? 0)) { if (!r.carrying && r.orderId === null) releaseResident(eng, r); continue; }
    const m = assigned.get(b.id) ?? new Map<string, Resident[]>();
    m.set(r.job, [...(m.get(r.job) ?? []), r]); assigned.set(b.id, m);
  }
  const free = eng.residents.filter((r) => r.job === "unassigned");
  for (const b of eng.buildings) {
    if (!b.built) continue;
    for (const [job, n] of Object.entries(b.crew) as [JobId, number][]) {
      const have = assigned.get(b.id)?.get(job) ?? [];
      for (let k = have.length - 1; k >= n; k--) {
        const r = have[k];
        if (r.carrying || r.orderId !== null || r.workTargetId !== null) continue; // erst fertig arbeiten
        releaseResident(eng, r);
      }
      for (let k = have.length; k < n && free.length; k++) {
        let bi = 0, bd = Infinity;
        free.forEach((r, i) => { const d = Math.hypot(r.x - b.x, r.y - b.y); if (d < bd) { bd = d; bi = i; } });
        const r = free.splice(bi, 1)[0];
        r.job = job; r.workplaceId = b.id; r.atWork = false; r.state = "WALKING_TO_WORK"; retarget(r);
        r.speed = job === "traeger" ? SPEED.carrier : SPEED.worker;
      }
    }
  }
}

function idleLife(eng: GameEngine, r: Resident, dt: number) {
  const home = r.homeBuildingId !== null ? eng.getBuilding(r.homeBuildingId) : undefined;
  if (!home) { r.state = "WAITING"; return; }
  if (r.state === "AT_HOME") return;
  if (r.state !== "RETURNING_HOME") { r.state = "RETURNING_HOME"; retarget(r); }
  const m = advanceTo(eng, r, "WORKER", () => buildingAccess(home), dt);
  if (m === "ARRIVED") { r.state = "AT_HOME"; retarget(r); }
  else if (m === "NO_ROUTE") r.state = "WAITING";
}

export function updateResidents(eng: GameEngine, dt: number) {
  for (const r of eng.residents) {
    r.animation += dt;
    if (r.job === "unassigned") { idleLife(eng, r, dt); continue; }
    const wp = r.workplaceId !== null ? eng.getBuilding(r.workplaceId) : undefined;
    if (!wp) { if (!r.carrying && r.orderId === null) releaseResident(eng, r); continue; }
    if (r.job === "traeger" && r.orderId !== null) continue; // Logistik steuert den Träger
    if (!r.atWork) {
      if (r.state !== "WALKING_TO_WORK") { r.state = "WALKING_TO_WORK"; retarget(r); }
      const m = advanceTo(eng, r, "WORKER", () => buildingAccess(wp), dt);
      if (m === "ARRIVED") { r.atWork = true; r.state = "WAITING"; retarget(r); r.workTimer = 0; }
      else if (m === "NO_ROUTE") r.state = "WAITING";
      continue;
    }
    switch (r.job) {
      case "holzfaeller": tickLumberjack(eng, r, wp, dt); break;
      case "foerster": tickForester(eng, r, wp, dt); break;
      case "bauer": tickFarmer(eng, r, wp, dt); break;
      case "bergarbeiter": tickMiner(eng, r, wp, dt); break;
      case "baumeister": tickBuilder(eng, r, wp, dt); break;
      case "traeger": r.state = "WAITING"; break;
      default: r.state = BUILDINGS[wp.type].recipe || BUILDINGS[wp.type].jobs ? "WORKING" : "WAITING";
    }
  }
}
