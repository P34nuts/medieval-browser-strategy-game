/**
 * Logistik-Engine V2: Transportaufträge als Zustandsmaschine mit Quell- und Zielreservierungen.
 *
 * Lebenszyklus eines Auftrags:
 *   WAITING_FOR_CARRIER → TO_PICKUP → PICKING_UP → IN_TRANSIT → DELIVERING → DELIVERED
 *   (Seitenzustände: BLOCKED_NO_ROUTE, BLOCKED_TARGET_FULL; Endzustände: FAILED, CANCELLED)
 *
 * Invarianten (siehe `GameEngine.audit()`):
 *  - Jede Reservierung gehört zu genau einem aktiven Auftrag (`srcReserved` / `dstReserved`).
 *  - Ware wird nie erzeugt oder vernichtet: Quelle → Träger-Fracht → Ziel.
 *  - Träger sind endliche Einwohner; kein Träger frei = der Auftrag wartet (echter Engpass).
 *  - Abgeschlossene Aufträge werden archiviert (begrenzt), nie unbegrenzt gesammelt.
 */
import { BUILDINGS, type ResId } from "./data";
import {
  FLOWS, PRIORITY, PROCESSORS, PULL_RESERVE, TRANSPORT, effectivePriority,
} from "./config";
import type { Building, GameEngine } from "./engine";
import { findPath, findPathToBuilding, pathStillWalkable, roadAccess, setPath, stepAlong } from "./pathing";
import { isActiveStatus, type Resident, type TransportOrder, type TransportStatus } from "./physical";
import {
  commitDelivery, commitPickup, getAvailableInputCapacity, getAvailableOutput, getCapacity, getStored, isHub,
  releaseInputReservation, releaseOutputReservation, reserveInput, reserveOutput, amountOf,
} from "./storage";
import { depositResource, getSpendableResource, syncRes } from "./economy";

const EPS = 1e-6;
const dist = (a: Building, b: Building) => Math.hypot(a.x - b.x, a.y - b.y);
export const isCarrier = (r: Resident) => r.job === "traeger";

/* ------------------------------------------------------------ Erzeugen */

export function createOrder(eng: GameEngine, source: Building, target: Building, resource: ResId, amount: number, priority: number): TransportOrder | null {
  if (!source.physical || !target.physical || source.id === target.id) return null;
  amount = Math.min(amount, TRANSPORT.carryCapacity);
  if (amount < 1 - EPS) return null;
  if (!reserveOutput(source, resource, amount)) return null;
  if (!reserveInput(eng, target, resource, amount)) { releaseOutputReservation(source, resource, amount); return null; }
  const o: TransportOrder = {
    id: eng.nextTransportId++, resource, amount, priority, status: "WAITING_FOR_CARRIER", carrierId: null,
    createdAt: eng.physicalClock, waited: 0, blockedFor: 0, sourceBuildingId: source.id, targetBuildingId: target.id,
    loaded: false, srcReserved: true, dstReserved: true, routeVersion: -1,
  };
  eng.transportOrders.push(o);
  return o;
}

/* ------------------------------------------------------- Abschluss/Abbruch */

function releaseReservations(eng: GameEngine, o: TransportOrder) {
  if (o.srcReserved) { releaseOutputReservation(o.sourceBuildingId ? eng.getBuilding(o.sourceBuildingId) : undefined, o.resource, o.amount); o.srcReserved = false; }
  if (o.dstReserved) { releaseInputReservation(o.targetBuildingId ? eng.getBuilding(o.targetBuildingId) : undefined, o.resource, o.amount); o.dstReserved = false; }
}

function finish(eng: GameEngine, o: TransportOrder, status: "DELIVERED" | "FAILED" | "CANCELLED") {
  releaseReservations(eng, o);
  o.status = status;
  const c = o.carrierId !== null ? eng.getResident(o.carrierId) : undefined;
  if (c && c.orderId === o.id) { c.orderId = null; c.state = "WAITING"; c.path = []; c.pathIndex = 0; c.workTimer = 0; }
  o.carrierId = null;
  const st = eng.transportStats;
  if (status === "DELIVERED") { st.delivered++; st.goods += o.amount; } else if (status === "FAILED") st.failed++; else st.cancelled++;
  eng.transportOrders = eng.transportOrders.filter((x) => x !== o);
  eng.transportArchive.push(o);
  if (eng.transportArchive.length > TRANSPORT.archiveSize) eng.transportArchive.shift();
}

/** Fracht eines Trägers, dessen Ziel weggefallen ist, wird zum nächsten Hub weitergetragen (Überlauf erlaubt). */
function rerouteLoaded(eng: GameEngine, o: TransportOrder, carrier: Resident) {
  if (o.dstReserved) { releaseInputReservation(o.targetBuildingId ? eng.getBuilding(o.targetBuildingId) : undefined, o.resource, o.amount); o.dstReserved = false; }
  const from = eng.getBuilding(o.sourceBuildingId ?? -1);
  const hubs = [...eng.hubs].sort((a, b) => Math.hypot(a.x - carrier.x, a.y - carrier.y) - Math.hypot(b.x - carrier.x, b.y - carrier.y));
  void from;
  const withRoom = hubs.find((h) => getAvailableInputCapacity(eng, h, o.resource) >= o.amount - EPS);
  const hub = withRoom ?? hubs[0];
  if (!hub) { eng.lostGoods[o.resource] = (eng.lostGoods[o.resource] ?? 0) + o.amount; carrier.carrying = null; finish(eng, o, "FAILED"); return; }
  o.targetBuildingId = hub.id;
  o.forced = !withRoom;
  if (withRoom) { reserveInput(eng, hub, o.resource, o.amount); o.dstReserved = true; }
  o.status = "IN_TRANSIT"; o.blockedFor = 0; carrier.path = []; carrier.pathIndex = 0;
}

/** Spieler/Planer bricht einen Auftrag ab. Vor der Aufnahme: Reservierungen frei. Danach: Fracht wird umgeleitet. */
export function cancelOrder(eng: GameEngine, id: number): boolean {
  const o = eng.transportOrders.find((x) => x.id === id);
  if (!o || !isActiveStatus(o.status)) return false;
  const carrier = o.carrierId !== null ? eng.getResident(o.carrierId) : undefined;
  if (o.loaded && carrier?.carrying) rerouteLoaded(eng, o, carrier);
  else finish(eng, o, "CANCELLED");
  return true;
}

/** Gebäude wird entfernt: betroffene Aufträge sauber auflösen. Muss VOR dem Entfernen aufgerufen werden. */
export function onBuildingRemoved(eng: GameEngine, id: number) {
  for (const o of [...eng.transportOrders]) {
    if (!isActiveStatus(o.status)) continue;
    const carrier = o.carrierId !== null ? eng.getResident(o.carrierId) : undefined;
    if (o.targetBuildingId === id) {
      if (o.loaded && carrier?.carrying) { o.targetBuildingId = null; rerouteLoaded(eng, o, carrier); }
      else { o.targetBuildingId = null; finish(eng, o, "CANCELLED"); }
    } else if (o.sourceBuildingId === id) {
      if (!o.loaded) { o.sourceBuildingId = null; o.srcReserved = false; finish(eng, o, "CANCELLED"); } else o.sourceBuildingId = null;
    }
  }
}

/** Ein Träger verschwindet (Bevölkerungsrückgang, Entlassung): Auftrag und Fracht wiederherstellen. */
export function onCarrierReleased(eng: GameEngine, carrier: Resident) {
  const o = carrier.orderId !== null ? eng.transportOrders.find((x) => x.id === carrier.orderId) : undefined;
  if (o && !o.loaded) { finish(eng, o, "CANCELLED"); }
  else if (o) { const c = carrier.carrying; if (c) { const put = depositResource(eng, c.resource, c.amount); if (c.amount - put > EPS) eng.lostGoods[c.resource] = (eng.lostGoods[c.resource] ?? 0) + (c.amount - put); } carrier.carrying = null; finish(eng, o, "FAILED"); }
  carrier.orderId = null;
}

/** Nach dem Laden: Reservierungen strikt aus den Aufträgen ableiten – keine verwaisten Reservierungen. */
export function rebuildReservations(eng: GameEngine) {
  for (const b of eng.buildings) if (b.physical) { b.physical.reservedInput = {}; b.physical.reservedOutput = {}; }
  for (const o of [...eng.transportOrders]) {
    const src = o.sourceBuildingId !== null ? eng.getBuilding(o.sourceBuildingId) : undefined;
    const dst = o.targetBuildingId !== null ? eng.getBuilding(o.targetBuildingId) : undefined;
    const carrier = o.carrierId !== null ? eng.getResident(o.carrierId) : undefined;
    if (o.loaded && !(carrier?.carrying)) { o.srcReserved = false; o.dstReserved = false; finish(eng, o, "FAILED"); continue; }
    if (!o.loaded && (!src?.physical || !dst?.physical)) { o.srcReserved = false; o.dstReserved = false; finish(eng, o, "CANCELLED"); continue; }
    if (!o.loaded && src?.physical) { src.physical.reservedOutput[o.resource] = amountOf(src.physical.reservedOutput, o.resource) + o.amount; o.srcReserved = true; } else o.srcReserved = false;
    if (dst?.physical && o.dstReserved) dst.physical.reservedInput[o.resource] = amountOf(dst.physical.reservedInput, o.resource) + o.amount;
    else if (!dst?.physical) { o.dstReserved = false; if (o.loaded && carrier) { o.targetBuildingId = null; rerouteLoaded(eng, o, carrier); } }
  }
}

/* ------------------------------------------------------------ Planung */

interface Target { b: Building; room: number; hub: boolean }

function pickTarget(eng: GameEngine, src: Building, r: ResId, amount: number): Target | null {
  const prefer = FLOWS[src.type]?.[r] ?? [];
  let best: Target | null = null, bestD = Infinity;
  for (const t of eng.buildings) {
    if (!t.built || !t.physical || !t.connected || t.id === src.id || !prefer.includes(t.type)) continue;
    const room = Math.floor(getAvailableInputCapacity(eng, t, r));
    if (room < 1) continue;
    const d = dist(src, t);
    if (d < bestD) { bestD = d; best = { b: t, room: Math.min(room, Math.floor(amount)), hub: false }; }
  }
  if (best) return best;
  for (const h of eng.hubs) {
    if (h.id === src.id || !h.connected) continue;
    const room = Math.floor(getAvailableInputCapacity(eng, h, r));
    if (room < 1) continue;
    const d = dist(src, h);
    if (d < bestD) { bestD = d; best = { b: h, room: Math.min(room, Math.floor(amount)), hub: true }; }
  }
  return best;
}

/** Wählt den nächsten Hub mit ausgebbarem Bestand (abzüglich Reserve). */
function pickSourceHub(eng: GameEngine, dst: Building, r: ResId, reserve: number): { hub: Building; spend: number } | null {
  let best: { hub: Building; spend: number } | null = null, bestD = Infinity;
  for (const h of eng.hubs) {
    if (!h.connected) continue;
    const spend = Math.floor(getAvailableOutput(h, r) - reserve);
    if (spend < 1) continue;
    const d = dist(h, dst);
    if (d < bestD) { bestD = d; best = { hub: h, spend }; }
  }
  return best;
}

/** Bedarfsgetriebene Transportplanung: Erzeuger schieben, Verbraucher/Baustellen ziehen aus Hubs. */
export function planTransports(eng: GameEngine) {
  const cap = TRANSPORT.carryCapacity;
  const active = new Map<number, number>();
  for (const o of eng.transportOrders) {
    if (o.sourceBuildingId !== null) active.set(o.sourceBuildingId, (active.get(o.sourceBuildingId) ?? 0) + 1);
    if (o.targetBuildingId !== null) active.set(o.targetBuildingId, (active.get(o.targetBuildingId) ?? 0) + 1);
  }
  const bump = (id: number) => active.set(id, (active.get(id) ?? 0) + 1);

  for (const b of eng.buildings) {
    if (!b.built || !b.physical || isHub(b) || !b.connected) continue;
    for (const key of Object.keys(b.physical.output) as ResId[]) {
      const avail = Math.floor(getAvailableOutput(b, key) + EPS);
      if (avail < 1 || (active.get(b.id) ?? 0) >= 4) continue;
      const total = getCapacity(eng, b, "output", key) || 1;
      const fill = getStored(b, "output", key) / total;
      const ready = avail >= Math.min(cap, 2) || fill >= TRANSPORT.urgentFill || eng.physicalClock - b.physical.lastOutputAt >= TRANSPORT.partialShipAfter;
      if (!ready) continue;
      const tgt = pickTarget(eng, b, key, Math.min(avail, cap));
      if (!tgt) continue;
      const prio = fill >= TRANSPORT.urgentFill ? PRIORITY.HIGH : tgt.hub ? PRIORITY.LOW : PRIORITY.NORMAL;
      const o = createOrder(eng, b, tgt.b, key, Math.min(avail, cap, tgt.room), prio);
      if (o) { bump(b.id); bump(tgt.b.id); }
    }
  }

  for (const b of eng.buildings) {
    if (!b.physical || !b.connected || isHub(b)) continue;
    const need: [ResId, number, number, number][] = []; // res, free, reserve, priority
    if (!b.built) {
      for (const r of Object.keys(BUILDINGS[b.type].cost) as ResId[]) need.push([r, getAvailableInputCapacity(eng, b, r), 0, PRIORITY.NORMAL]);
    } else if (PROCESSORS.includes(b.type) && b.workers > 0) {
      for (const r of Object.keys(BUILDINGS[b.type].recipe?.inputs ?? {}) as ResId[]) {
        const stored = getStored(b, "input", r);
        need.push([r, getAvailableInputCapacity(eng, b, r), PULL_RESERVE[r] ?? 0, stored < 1 ? PRIORITY.HIGH : PRIORITY.NORMAL]);
      }
    }
    for (const [r, free, reserve, prio] of need) {
      if (Math.floor(free) < 1 || (active.get(b.id) ?? 0) >= 4) continue;
      const src = pickSourceHub(eng, b, r, reserve);
      if (!src) continue;
      const o = createOrder(eng, src.hub, b, r, Math.min(Math.floor(free), src.spend, cap), prio);
      if (o) { bump(b.id); bump(src.hub.id); }
    }
  }
}

/* ------------------------------------------------------------ Ausführung */

type Move = "MOVING" | "ARRIVED" | "NO_ROUTE";

function advanceCarrier(eng: GameEngine, c: Resident, b: Building, dt: number): Move {
  const exhausted = c.pathIndex >= c.path.length;
  if (exhausted || !pathStillWalkable(eng, "CARRIER", c)) {
    const res = findPathToBuilding(eng, "CARRIER", [c.x, c.y], b);
    if (res.status === "UNREACHABLE") { c.path = []; c.pathIndex = 0; return "NO_ROUTE"; }
    if (res.status === "ALREADY_AT_GOAL") { c.path = []; c.pathIndex = 0; return "ARRIVED"; }
    setPath(c, res);
  }
  return stepAlong(c, dt) ? "ARRIVED" : "MOVING";
}

function block(eng: GameEngine, o: TransportOrder, status: TransportStatus, c?: Resident) {
  o.status = status; o.routeVersion = eng.pathVersion;
  if (c) c.state = "WAITING";
}

function advance(eng: GameEngine, o: TransportOrder, dt: number) {
  const c = eng.getResident(o.carrierId ?? -1);
  if (!c) { o.carrierId = null; if (o.loaded) { o.status = "FAILED"; } else { finish(eng, o, "CANCELLED"); } return; }
  const src = eng.getBuilding(o.sourceBuildingId ?? -1), dst = eng.getBuilding(o.targetBuildingId ?? -1);
  switch (o.status) {
    case "TO_PICKUP": {
      if (!src?.physical) { finish(eng, o, "CANCELLED"); return; }
      c.state = "TRANSPORTING";
      const m = advanceCarrier(eng, c, src, dt);
      if (m === "NO_ROUTE") block(eng, o, "BLOCKED_NO_ROUTE", c);
      else if (m === "ARRIVED") { o.status = "PICKING_UP"; c.workTimer = 0; }
      return;
    }
    case "PICKING_UP": {
      c.workTimer += dt;
      if (c.workTimer < TRANSPORT.handlingTime) return;
      if (!src?.physical) { finish(eng, o, "CANCELLED"); return; }
      const taken = commitPickup(src, o.resource, o.amount, o.srcReserved);
      o.srcReserved = false;
      if (taken <= EPS) { finish(eng, o, "FAILED"); return; }
      if (taken < o.amount - EPS) { releaseInputReservation(dst, o.resource, o.amount - taken); o.amount = taken; }
      c.carrying = { resource: o.resource, amount: taken };
      o.loaded = true; o.status = "IN_TRANSIT"; c.state = "TRANSPORTING"; c.path = []; c.pathIndex = 0; c.workTimer = 0;
      return;
    }
    case "IN_TRANSIT": {
      if (!dst?.physical) { o.targetBuildingId = null; rerouteLoaded(eng, o, c); return; }
      c.state = "TRANSPORTING";
      const m = advanceCarrier(eng, c, dst, dt);
      if (m === "NO_ROUTE") block(eng, o, "BLOCKED_NO_ROUTE", c);
      else if (m === "ARRIVED") { o.status = "DELIVERING"; c.state = "DELIVERING_RESOURCE"; c.workTimer = 0; }
      return;
    }
    case "DELIVERING": {
      c.workTimer += dt;
      if (c.workTimer < TRANSPORT.handlingTime) return;
      if (!dst?.physical || !c.carrying) { o.targetBuildingId = null; rerouteLoaded(eng, o, c); return; }
      const amount = c.carrying.amount;
      const put = commitDelivery(eng, dst, o.resource, amount, o.dstReserved, !!o.forced);
      o.dstReserved = false;
      if (put < amount - EPS) { c.carrying.amount = amount - put; o.amount = amount - put; o.status = "BLOCKED_TARGET_FULL"; o.blockedFor = 0; c.state = "WAITING"; eng.transportStats.goods += put; if (isHub(dst)) syncRes(eng); return; }
      c.carrying = null; syncResIfHub(eng, dst);
      finish(eng, o, "DELIVERED");
      return;
    }
    case "BLOCKED_NO_ROUTE": {
      o.blockedFor += dt;
      if (o.routeVersion !== eng.pathVersion) { o.status = o.loaded ? "IN_TRANSIT" : "TO_PICKUP"; return; }
      if (!o.loaded && o.blockedFor > TRANSPORT.blockedGiveUp) finish(eng, o, "CANCELLED");
      return;
    }
    case "BLOCKED_TARGET_FULL": {
      o.blockedFor += dt;
      if (c.carrying && Math.floor(o.blockedFor * 2) % 4 === 0) { o.targetBuildingId = null; rerouteLoaded(eng, o, c); }
      return;
    }
    default: return;
  }
}

const syncResIfHub = (eng: GameEngine, b: Building) => { if (isHub(b)) syncRes(eng); };

/** Verfügbare Träger: Einwohner mit Beruf Träger, am Dienst, ohne Auftrag und ohne Fracht */
export function idleCarriers(eng: GameEngine): Resident[] {
  return eng.residents.filter((r) => isCarrier(r) && r.atWork && r.orderId === null && !r.carrying);
}

function assign(eng: GameEngine, o: TransportOrder, idle: Resident[]): boolean {
  const src = eng.getBuilding(o.sourceBuildingId ?? -1), dst = eng.getBuilding(o.targetBuildingId ?? -1);
  if (!src?.physical || !dst?.physical) { finish(eng, o, "CANCELLED"); return true; }
  const srcRoad = roadAccess(eng, src), dstRoad = roadAccess(eng, dst);
  // Route Quelle → Ziel muss existieren, sonst ist der Auftrag blockiert (kein Teleport, keine Abkürzung).
  if (!srcRoad.length || !dstRoad.length || findPath(eng, "CARRIER", srcRoad[0], dstRoad).status === "UNREACHABLE") { o.status = "BLOCKED_NO_ROUTE"; o.routeVersion = eng.pathVersion; return false; }
  const cands = idle.map((c) => ({ c, d: Math.hypot(c.x - src.x, c.y - src.y) })).sort((a, b) => a.d - b.d).slice(0, 4);
  for (const { c } of cands) {
    if (findPathToBuilding(eng, "CARRIER", [c.x, c.y], src).status === "UNREACHABLE") continue;
    o.carrierId = c.id; c.orderId = o.id; c.state = "TRANSPORTING"; c.path = []; c.pathIndex = 0; c.workTimer = 0; o.status = "TO_PICKUP";
    idle.splice(idle.indexOf(c), 1);
    return true;
  }
  o.status = "BLOCKED_NO_ROUTE"; o.routeVersion = eng.pathVersion;
  return false;
}

export function updateOrders(eng: GameEngine, dt: number) {
  for (const o of eng.transportOrders) if (o.status === "WAITING_FOR_CARRIER" || o.status === "BLOCKED_NO_ROUTE" || o.status === "BLOCKED_TARGET_FULL") o.waited += dt;
  const idle = idleCarriers(eng);
  if (idle.length) {
    const queue = eng.transportOrders
      .filter((o) => o.carrierId === null && (o.status === "WAITING_FOR_CARRIER" || (o.status === "BLOCKED_NO_ROUTE" && o.routeVersion !== eng.pathVersion)))
      .sort((a, b) => effectivePriority(b.priority, b.waited) - effectivePriority(a.priority, a.waited) || a.createdAt - b.createdAt);
    for (const o of queue) { if (!idle.length) break; assign(eng, o, idle); }
  }
  for (const o of [...eng.transportOrders]) {
    if (o.carrierId !== null) advance(eng, o, dt);
    else if (o.status === "BLOCKED_NO_ROUTE" && !o.loaded) { o.blockedFor += dt; if (o.blockedFor > TRANSPORT.blockedGiveUp) finish(eng, o, "CANCELLED"); }
  }
}

/** Anzeige: Engpass-Übersicht der Logistik */
export function logisticsSummary(eng: GameEngine) {
  const carriers = eng.residents.filter(isCarrier);
  const idle = idleCarriers(eng).length;
  const count = (s: TransportStatus) => eng.transportOrders.filter((o) => o.status === s).length;
  return {
    carriers: carriers.length, idle, busy: carriers.filter((c) => c.orderId !== null).length,
    waiting: count("WAITING_FOR_CARRIER"), blockedRoute: count("BLOCKED_NO_ROUTE"), blockedFull: count("BLOCKED_TARGET_FULL"),
    active: eng.transportOrders.length, stats: eng.transportStats,
  };
}

export { getSpendableResource };
