/**
 * Physische Arbeit: Forstwirtschaft, Landwirtschaft, Bergbau und Verarbeitung.
 *
 * Grundsatz: Ware entsteht am Arbeitsort NUR in der Hand des Arbeiters (`resident.carrying`) und
 * erreicht das Gebäudelager erst, wenn er zum Gebäude zurückgekehrt ist (DELIVERING_RESOURCE).
 * Alle Zeiten/Radien stammen aus config.ts.
 */
import { BUILDINGS, DEPOSIT_RES, MAP_SIZE, T, type ResId } from "./data";
import { FARMING, FORESTRY, MINING } from "./config";
import type { Building, GameEngine } from "./engine";
import { advanceTo, buildingAccess } from "./pathing";
import type { Resident } from "./physical";
import { consumeInput, getCapacity, getStored, produceOutput, amountOf } from "./storage";

const idx = (x: number, y: number) => y * MAP_SIZE + x;
const wait = (r: Resident, seconds: number) => { r.state = "WAITING"; r.workTimer = -seconds; };
const clearPath = (r: Resident) => { r.path = []; r.pathIndex = 0; };

/* ================================================================ Bäume */

export type TreeStage = "NONE" | "CUT" | "SAPLING" | "YOUNG" | "MATURE";
/** CUT = abgeholzt (Wert 0), SAPLING/YOUNG wachsen (1..3), MATURE = ausgewachsen (nicht in der Map) */
export function treeStage(eng: GameEngine, i: number): TreeStage {
  if (eng.map.terrain[i] !== T.FOREST) return "NONE";
  const v = eng.treeGrowth.get(i);
  if (v === undefined || v >= 3) return "MATURE";
  return v <= 0 ? "CUT" : v < 2 ? "SAPLING" : "YOUNG";
}

export function updateTrees(eng: GameEngine, dt: number) {
  for (const [i, v] of [...eng.treeGrowth]) {
    if (v <= 0) {
      const t = (eng.treeEmpty.get(i) ?? 0) + dt;
      if (t >= FORESTRY.naturalRegrowthAfter) { eng.treeGrowth.set(i, 1); eng.treeEmpty.delete(i); } else eng.treeEmpty.set(i, t);
    } else {
      const nv = v + dt / FORESTRY.stageDuration;
      if (nv >= 3) { eng.treeGrowth.delete(i); eng.markTreeDirty(i); } else eng.treeGrowth.set(i, nv);
    }
  }
}

function workRadius(eng: GameEngine, b: Building, table: Record<string, number>): number { return (table[b.type] ?? 5) + eng.rangeBonus(b); }

function* tilesAround(b: Building, radius: number) {
  const [w, h] = BUILDINGS[b.type].size;
  for (let y = Math.max(0, b.y - radius); y < Math.min(MAP_SIZE, b.y + h + radius); y++)
    for (let x = Math.max(0, b.x - radius); x < Math.min(MAP_SIZE, b.x + w + radius); x++) yield [x, y] as const;
}

function nearestTile(eng: GameEngine, b: Building, r: Resident, radius: number, ok: (i: number) => boolean): number | null {
  let best: number | null = null, bd = Infinity;
  for (const [x, y] of tilesAround(b, radius)) {
    const i = idx(x, y);
    if (!ok(i)) continue;
    const d = Math.hypot(x + 0.5 - r.x, y + 0.5 - r.y);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/** Aufgabenreservierungen (Baum, Feld) eines Einwohners freigeben */
export function releaseGatherTask(eng: GameEngine, r: Resident) {
  for (const [i, id] of [...eng.reservedTrees]) if (id === r.id) eng.reservedTrees.delete(i);
  if (r.job === "bauer" && r.workTargetId !== null) {
    const f = eng.getBuilding(r.workTargetId);
    if (f?.field && f.field.farmerId === r.id) { f.field.farmerId = null; if (f.field.stage === "HARVESTING") f.field.stage = "RIPE"; }
  }
  r.workTargetId = null;
}

/* ============================================================== Ablieferung */

/** Fracht im Arbeitsgebäude ablegen. Gibt true zurück, wenn alles eingelagert wurde. */
function deliverCargo(eng: GameEngine, r: Resident, wp: Building, dt: number): boolean {
  if (!r.carrying) return true;
  r.state = "DELIVERING_RESOURCE";
  const m = advanceTo(eng, r, "WORKER", () => buildingAccess(wp), dt);
  if (m === "MOVING") return false;
  if (m === "NO_ROUTE") return false;
  const c = r.carrying;
  const put = produceOutput(eng, wp, c.resource, c.amount);
  if (put > 0) eng.flowProd[c.resource] += put;
  if (put >= c.amount - 1e-9) { r.carrying = null; return true; }
  c.amount -= put; // Ausgang voll: Arbeiter wartet mit der Ware am Gebäude
  return false;
}

function startWalk(r: Resident, state: Resident["state"]) { r.state = state; clearPath(r); r.workTimer = 0; }

/* ============================================================ Holzfäller */

export function tickLumberjack(eng: GameEngine, r: Resident, wp: Building, dt: number) {
  const speed = eng.speedMult(wp);
  if (r.carrying || r.state === "DELIVERING_RESOURCE") { if (deliverCargo(eng, r, wp, dt)) wait(r, 0); return; }
  if (r.workTimer < 0 && r.state === "WAITING") { r.workTimer += dt; return; }
  if (r.workTargetId === null) {
    const tile = nearestTile(eng, wp, r, workRadius(eng, wp, FORESTRY.workRadius), (i) => treeStage(eng, i) === "MATURE" && !eng.reservedTrees.has(i));
    if (tile === null) { wait(r, 3); return; }
    eng.reservedTrees.set(tile, r.id); r.workTargetId = tile; startWalk(r, "FETCHING_RESOURCE"); return;
  }
  const tile = r.workTargetId;
  if (treeStage(eng, tile) !== "MATURE" || eng.reservedTrees.get(tile) !== r.id) { releaseGatherTask(eng, r); wait(r, 1); return; }
  if (r.state === "FETCHING_RESOURCE") {
    const m = advanceTo(eng, r, "WORKER", () => [[tile % MAP_SIZE, Math.floor(tile / MAP_SIZE)]], dt);
    if (m === "NO_ROUTE") { releaseGatherTask(eng, r); wait(r, 4); }
    else if (m === "ARRIVED") startWalk(r, "WORKING");
    return;
  }
  if (r.state === "WORKING") {
    r.workTimer += dt * speed;
    if (r.workTimer >= FORESTRY.harvestTime) {
      eng.treeGrowth.set(tile, 0); eng.treeEmpty.set(tile, 0); eng.reservedTrees.delete(tile); eng.markTreeDirty(tile);
      r.workTargetId = null; r.carrying = { resource: "holz", amount: FORESTRY.woodPerTree };
      startWalk(r, "DELIVERING_RESOURCE");
    }
    return;
  }
  startWalk(r, "FETCHING_RESOURCE");
}

/* =============================================================== Förster */

export function tickForester(eng: GameEngine, r: Resident, wp: Building, dt: number) {
  const speed = eng.speedMult(wp);
  if (r.workTimer < 0 && r.state === "WAITING") { r.workTimer += dt; return; }
  if (r.workTargetId === null) {
    const tile = nearestTile(eng, wp, r, workRadius(eng, wp, FORESTRY.workRadius), (i) => treeStage(eng, i) === "CUT" && !eng.reservedTrees.has(i));
    if (tile === null) { wait(r, 3); return; }
    eng.reservedTrees.set(tile, r.id); r.workTargetId = tile; startWalk(r, "FETCHING_RESOURCE"); return;
  }
  const tile = r.workTargetId;
  if (treeStage(eng, tile) !== "CUT" || eng.reservedTrees.get(tile) !== r.id) { releaseGatherTask(eng, r); wait(r, 1); return; }
  if (r.state === "FETCHING_RESOURCE") {
    const m = advanceTo(eng, r, "WORKER", () => [[tile % MAP_SIZE, Math.floor(tile / MAP_SIZE)]], dt);
    if (m === "NO_ROUTE") { releaseGatherTask(eng, r); wait(r, 4); }
    else if (m === "ARRIVED") startWalk(r, "WORKING");
    return;
  }
  if (r.state === "WORKING") {
    r.workTimer += dt * speed;
    if (r.workTimer >= FORESTRY.plantTime) {
      eng.treeGrowth.set(tile, 1); eng.treeEmpty.delete(tile); eng.reservedTrees.delete(tile);
      r.workTargetId = null; r.atWork = false; startWalk(r, "WALKING_TO_WORK"); // zurück zum Gebäude, dann nächste Aufgabe
    }
    return;
  }
  startWalk(r, "FETCHING_RESOURCE");
}

/* ============================================================== Landwirtschaft */

export function updateFields(eng: GameEngine, dt: number) {
  const growMult = 1 + eng.techProdMult("farm");
  for (const b of eng.buildings) {
    const f = b.field;
    if (!f || !b.built) continue;
    if (f.stage === "SOWN") { f.progress += dt / FARMING.germinateTime; if (f.progress >= 1) { f.stage = "GROWING"; f.progress = 0; } }
    else if (f.stage === "GROWING") { f.progress += dt / FARMING.growTime; if (f.progress >= 1) { f.stage = "RIPE"; f.progress = 0; f.yieldAmount = FARMING.yieldPerField * growMult; } }
  }
}

function fieldWork(stage: string): number { return stage === "PLOWED" ? FARMING.sowTime : stage === "HARVESTING" ? FARMING.harvestTime : FARMING.plowTime; }

export function tickFarmer(eng: GameEngine, r: Resident, wp: Building, dt: number) {
  const speed = eng.speedMult(wp);
  if (r.carrying || r.state === "DELIVERING_RESOURCE") { if (deliverCargo(eng, r, wp, dt)) wait(r, 0); return; }
  if (r.workTimer < 0 && r.state === "WAITING") { r.workTimer += dt; return; }
  if (r.workTargetId === null) {
    const radius = FARMING.workRadius + eng.rangeBonus(wp);
    const rank = (s: string) => (s === "RIPE" ? 0 : s === "EMPTY" || s === "HARVESTED" ? 1 : s === "PLOWED" ? 2 : 9);
    let best: Building | null = null;
    for (const f of eng.buildings) {
      if (!f.built || !f.field || f.field.farmerId !== null || rank(f.field.stage) > 2) continue;
      if (Math.hypot(f.x - wp.x, f.y - wp.y) > radius) continue;
      if (!best || rank(f.field.stage) < rank(best.field!.stage) || (rank(f.field.stage) === rank(best.field!.stage) && Math.hypot(f.x - wp.x, f.y - wp.y) < Math.hypot(best.x - wp.x, best.y - wp.y))) best = f;
    }
    if (!best?.field) { wait(r, 3); return; }
    best.field.farmerId = r.id; if (best.field.stage === "RIPE") { best.field.stage = "HARVESTING"; best.field.progress = 0; }
    r.workTargetId = best.id; startWalk(r, "FETCHING_RESOURCE"); return;
  }
  const field = eng.getBuilding(r.workTargetId);
  if (!field?.field || field.field.farmerId !== r.id) { r.workTargetId = null; wait(r, 1); return; }
  if (r.state === "FETCHING_RESOURCE") {
    const m = advanceTo(eng, r, "WORKER", () => [[field.x, field.y]], dt);
    if (m === "NO_ROUTE") { releaseGatherTask(eng, r); wait(r, 4); }
    else if (m === "ARRIVED") startWalk(r, "WORKING");
    return;
  }
  if (r.state === "WORKING") {
    const f = field.field;
    r.workTimer += dt * speed;
    if (r.workTimer < fieldWork(f.stage)) return;
    f.farmerId = null; r.workTargetId = null;
    if (f.stage === "EMPTY" || f.stage === "HARVESTED") { f.stage = "PLOWED"; f.progress = 0; wait(r, 0); }
    else if (f.stage === "PLOWED") { f.stage = "SOWN"; f.progress = 0; wait(r, 0); }
    else if (f.stage === "HARVESTING") { f.stage = "HARVESTED"; r.carrying = { resource: "getreide", amount: f.yieldAmount }; startWalk(r, "DELIVERING_RESOURCE"); }
    return;
  }
  startWalk(r, "FETCHING_RESOURCE");
}

/* ================================================================= Bergbau */

export function depositResourceOf(eng: GameEngine, i: number): ResId { const d = eng.map.deposit[i]; return d ? DEPOSIT_RES[d] : "stein"; }

export function initialDeposit(eng: GameEngine, i: number): number { return MINING.depositAmount[depositResourceOf(eng, i)] ?? 500; }

export function initDeposits(eng: GameEngine) {
  for (let i = 0; i < MAP_SIZE * MAP_SIZE; i++)
    if (eng.map.terrain[i] === T.MOUNTAIN && !eng.depositRemaining.has(i)) eng.depositRemaining.set(i, initialDeposit(eng, i));
}

function matchesDeposit(eng: GameEngine, b: Building, i: number): boolean {
  if (eng.map.terrain[i] !== T.MOUNTAIN || (eng.depositRemaining.get(i) ?? 0) <= 0) return false;
  return b.type === "quarry" ? eng.map.deposit[i] === 0 : !!b.mineRes && depositResourceOf(eng, i) === b.mineRes;
}

/** Restvorrat in Reichweite eines Steinbruchs/einer Mine */
export function depositInfo(eng: GameEngine, b: Building): { resource: ResId; remaining: number } {
  const radius = workRadius(eng, b, MINING.workRadius);
  let remaining = 0;
  for (const [x, y] of tilesAround(b, radius)) { const i = idx(x, y); if (matchesDeposit(eng, b, i)) remaining += eng.depositRemaining.get(i) ?? 0; }
  return { resource: b.type === "quarry" ? "stein" : b.mineRes ?? "eisen", remaining };
}

export function tickMiner(eng: GameEngine, r: Resident, wp: Building, dt: number) {
  const speed = eng.speedMult(wp);
  if (r.carrying || r.state === "DELIVERING_RESOURCE") { if (deliverCargo(eng, r, wp, dt)) wait(r, 0); return; }
  if (r.workTimer < 0 && r.state === "WAITING") { r.workTimer += dt; return; }
  if (r.workTargetId === null) {
    const tile = nearestTile(eng, wp, r, workRadius(eng, wp, MINING.workRadius), (i) => matchesDeposit(eng, wp, i));
    if (tile === null) { wait(r, 3); return; }
    r.workTargetId = tile; startWalk(r, "FETCHING_RESOURCE"); return;
  }
  const tile = r.workTargetId;
  if (!matchesDeposit(eng, wp, tile)) { r.workTargetId = null; wait(r, 1); return; }
  if (r.state === "FETCHING_RESOURCE") {
    const m = advanceTo(eng, r, "WORKER", () => [[tile % MAP_SIZE, Math.floor(tile / MAP_SIZE)]], dt);
    if (m === "NO_ROUTE") { r.workTargetId = null; wait(r, 4); }
    else if (m === "ARRIVED") startWalk(r, "WORKING");
    return;
  }
  if (r.state === "WORKING") {
    r.workTimer += dt * speed;
    if (r.workTimer >= (MINING.extractTime[wp.type] ?? 3)) {
      const res = wp.type === "quarry" ? "stein" : depositResourceOf(eng, tile);
      const amount = Math.min(eng.depositRemaining.get(tile) ?? 0, MINING.yieldPerTrip[res] ?? 1);
      eng.depositRemaining.set(tile, Math.max(0, (eng.depositRemaining.get(tile) ?? 0) - amount));
      r.workTargetId = null; r.carrying = { resource: res, amount };
      startWalk(r, "DELIVERING_RESOURCE");
    }
    return;
  }
  startWalk(r, "FETCHING_RESOURCE");
}

/* ============================================================= Verarbeitung */

/** Produktion der Verarbeiter: nur mit anwesenden Arbeitern, Eingangsware und freiem Ausgang. */
export function updateProcessors(eng: GameEngine, dt: number) {
  for (const b of eng.buildings) {
    const def = BUILDINGS[b.type];
    if (!b.built || !b.physical || !def.recipe || def.recipe.special || !eng.isProcessor(b)) continue;
    const p = b.physical, recipe = def.recipe;
    b.missing = null; b.eff = 0;
    const present = eng.workersAt(b.id).filter((r) => r.atWork).length;
    if (b.workers <= 0 || present === 0) { p.production = "NO_WORKER"; continue; }
    const inputs = Object.entries(recipe.inputs) as [ResId, number][], outputs = Object.entries(recipe.outputs) as [ResId, number][];
    const lacking = inputs.find(([r, n]) => getStored(b, "input", r) + 1e-9 < n);
    if (lacking) { p.production = "WAITING_FOR_INPUT"; b.missing = lacking[0]; continue; }
    if (outputs.some(([r, n]) => getCapacity(eng, b, "output", r) - getStored(b, "output", r) + 1e-9 < n)) { p.production = "WAITING_FOR_PICKUP"; continue; }
    p.production = "PRODUCING";
    b.eff = (present / Math.max(1, eng.slotsOf(b))) * eng.speedMult(b);
    p.productionProgress += (dt * b.eff) / recipe.cycle;
    if (p.productionProgress >= 1) {
      for (const [r, n] of inputs) { consumeInput(b, r, n); eng.flowCons[r] += n; }
      for (const [r, n] of outputs) { produceOutput(eng, b, r, n); eng.flowProd[r] += n; }
      p.productionProgress = 0;
    }
  }
}

export { amountOf };
