/**
 * GameEngine – die komplette Spielsimulation (ohne DOM, daher headless testbar).
 *
 * Die Engine koordiniert die Subsysteme:
 *  economy.ts (Wirtschafts-API, Hub-Lager als einzige Wahrheit) · storage.ts (lokale Lager/Reservierungen)
 *  logistics.ts (Transportaufträge) · pathing.ts (Wegfindung, Zugänge) · residents.ts (Einwohner)
 *  jobs.ts (Forst/Farm/Bergbau/Verarbeitung) · construction.ts (Baustellen, Bauarbeiter).
 *
 * Simulation in festen Schritten (SIM_STEP); `update(dt)` wird vom Renderer pro Frame aufgerufen.
 */
import {
  BUILDINGS, JOBS, JOB_IDS, QUESTS, RESOURCES, RES_IDS, T, TECHS, UPGRADE_LEVELS, xpToNext,
  LEVEL_UNLOCKS, MAP_SIZE, STATUS_TEXT,
  type BStatus, type BuildingDef, type BuildingId, type JobId, type QuestDef, type ResAmounts, type ResId,
} from "./data";
import { CONSTRUCTION, PHYSICAL_TYPES, PROCESSORS, POPULATION, TRANSPORT, constructionMaterials } from "./config";
import { generateMap, type MapData } from "./mapgen";
import {
  ACTIVE_STATUSES, type FieldState, type PathResult, type PhysicalBuildingState, type Resident, type ResidentState, type TransportOrder,
} from "./physical";
import {
  amountOf, getCapacity, getAvailableInputCapacity, getStored, isHub, newPhysicalState, totalStored,
} from "./storage";
import {
  canAfford, consumeCost, consumeResource, depositCost, depositResource, getEconomyTotal, getResourceCapacity,
  getSpendableResource, getTotalResource, setHubStock, syncRes,
} from "./economy";
import { accessTiles, buildingAccess, isRoadTile, roadAccess } from "./pathing";
import {
  cancelOrder, logisticsSummary, onBuildingRemoved, planTransports, rebuildReservations, updateOrders,
} from "./logistics";
import { assignHomes, assignWorkplaces, releaseResident, syncPopulation, updateResidents } from "./residents";
import { depositInfo, initDeposits, initialDeposit, updateFields, updateProcessors, updateTrees, treeStage } from "./jobs";
import { isInstant, materialFraction, siteState, updateConstruction } from "./construction";
import { advanceComputerPlayers, createPlayers, normalizePlayers, type GamePlayer } from "./players";

const SIM_STEP = 0.5;
const SOLDIERS_PER_BARRACKS = 10;
export const SAVE_VERSION = 4;

export interface Building {
  id: number;
  type: BuildingId;
  x: number;
  y: number;
  /** Baufortschritt 0..1 */
  progress: number;
  built: boolean;
  /* --- abgeleitet (nicht gespeichert) --- */
  status: BStatus;
  workers: number;
  /** Besetzte Stellen je Beruf (aus computeStats) */
  crew: Partial<Record<JobId, number>>;
  connected: boolean;
  site: number;
  eff: number;
  mineRes: ResId | null;
  missing: ResId | null;
  /** Lokale Lager, Produktionszustand – auch Baumaterial-Lager von Baustellen */
  physical?: PhysicalBuildingState;
  field?: FieldState;
  rotation: 0 | 1 | 2 | 3;
  siteState?: string;
}

export interface Toast { id: number; text: string; kind: "info" | "good" | "warn" | "level"; t: number }
export interface PlaceCheck { ok: boolean; reason: string | null; site: number | null; mineRes: ResId | null }
export interface Ghost { x: number; y: number; check: PlaceCheck }
export interface Bottleneck { sev: "bad" | "warn"; text: string }

export interface SaveData {
  v: number;
  seed: number;
  buildings: { i?: number; t: BuildingId; x: number; y: number; p: number; r?: 0 | 1 | 2 | 3 }[];
  res: Record<string, number>;
  xp: number; level: number; pop: number; soldiers: number; playTime: number;
  research: { done: string[]; active: { id: string; remaining: number } | null };
  questsDone: string[];
  tradeCount: number;
  residents?: Resident[];
  transportOrders?: TransportOrder[];
  localStorage?: Record<string, Partial<PhysicalBuildingState>>;
  harvestedTrees?: number[];
  treeGrowth?: Record<string, number>;
  treeEmpty?: Record<string, number>;
  reservedTrees?: Record<string, number>;
  fieldStates?: Record<string, FieldState>;
  depositRemaining?: Record<string, number>;
  transportStats?: { delivered: number; cancelled: number; failed: number; goods: number };
  lostGoods?: Record<string, number>;
  players?: GamePlayer[];
}

type ResMap = Record<ResId, number>;
const zeroRes = (): ResMap => Object.fromEntries(RES_IDS.map((r) => [r, 0])) as ResMap;
const RESIDENT_STATES: ResidentState[] = ["AT_HOME", "RETURNING_HOME", "WALKING_TO_WORK", "WORKING", "WAITING", "FETCHING_RESOURCE", "TRANSPORTING", "DELIVERING_RESOURCE", "CONSTRUCTION_WORK"];
type Rot = 0 | 1 | 2 | 3;

export class GameEngine {
  map: MapData;
  seed: number;
  buildings: Building[] = [];
  /** Belegung: Gebäude-ID je Kachel (0 = frei) – enthält die echten, gedrehten Footprints */
  occ: Int32Array;
  /** 1 = gebaute Straße */
  roadGrid: Uint8Array;
  private roadReach: Uint8Array;
  private byId = new Map<number, Building>();
  private residentById = new Map<number, Resident>();
  private workerIndex = new Map<number, Resident[]>();
  nextId = 1;

  /** Wegenetz-Version: steigt bei jeder Strukturänderung (invalidiert Pfad-Cache, weckt blockierte Aufträge) */
  pathVersion = 0;
  pathCache: { version: number; map: Map<string, PathResult> } = { version: -1, map: new Map() };

  /** Abgeleiteter HUD-Cache (Summe der Hub-Lager). NICHT unabhängig veränderbar – siehe economy.ts */
  resCache: ResMap = zeroRes();
  get res(): Readonly<ResMap> { return this.resCache; }
  hubs: Building[] = [];

  xp = 0;
  level = 1;
  pop = 8;
  soldiers = 0;
  playTime = 0;
  research: { done: string[]; active: { id: string; remaining: number } | null } = { done: [], active: null };
  questsDone: string[] = [];
  tradeCount = 0;

  /* --- abgeleitete Werte --- */
  limit: ResMap = zeroRes();
  prod: ResMap = zeroRes();
  cons: ResMap = zeroRes();
  popCap = 0;
  workforce = 0;
  byJob = Object.fromEntries(JOB_IDS.map((j) => [j, { needed: 0, filled: 0 }])) as Record<JobId, { needed: number; filled: number }>;
  foodStatus: "ok" | "low" | "starving" = "ok";
  growthPerMin = 0;
  military = 0;

  /* --- UI-Zustand --- */
  ui: { buildType: BuildingId | null; selectedId: number | null; ghost: Ghost | null; buildRotation: Rot } = {
    buildType: null, selectedId: null, ghost: null, buildRotation: 0,
  };
  toasts: Toast[] = [];
  version = 0;
  dirtyFlag = true;

  private listeners = new Set<() => void>();
  private acc = 0;
  private notifyAcc = 0;
  private toastId = 1;
  flowProd = zeroRes();
  flowCons = zeroRes();
  private clock = 0;
  physicalClock = 0;
  simulationSpeed: 0 | 1 | 2 = 1;

  residents: Resident[] = [];
  /** Lokale Mehrspieler-Lobby: Spieler 0 ist der Mensch, weitere Spieler sind Computergegner. */
  players: GamePlayer[] = createPlayers(2);
  nextResidentId = 1;
  transportOrders: TransportOrder[] = [];
  transportArchive: TransportOrder[] = [];
  nextTransportId = 1;
  transportStats = { delivered: 0, cancelled: 0, failed: 0, goods: 0 };
  /** Ware, die bei Recovery nirgends untergebracht werden konnte (wird nie still vernichtet) */
  lostGoods: Partial<Record<ResId, number>> = {};

  /** Baumzustand: nur nicht-ausgewachsene Kacheln (0 = abgeholzt, 1..3 wachsend); fehlt = ausgewachsen */
  treeGrowth = new Map<number, number>();
  treeEmpty = new Map<number, number>();
  reservedTrees = new Map<number, number>();
  /** Terrain-Chunks (Schlüssel cy*100+cx), die der Renderer neu backen muss (Baum gefällt/nachgewachsen) */
  treeDirtyChunks = new Set<number>();
  markTreeDirty(i: number) { this.treeDirtyChunks.add(Math.floor(Math.floor(i / MAP_SIZE) / 8) * 100 + Math.floor((i % MAP_SIZE) / 8)); }
  depositRemaining = new Map<number, number>();

  private constructor(seed: number) {
    this.seed = seed;
    this.map = generateMap(seed);
    this.occ = new Int32Array(MAP_SIZE * MAP_SIZE);
    this.roadGrid = new Uint8Array(MAP_SIZE * MAP_SIZE);
    this.roadReach = new Uint8Array(MAP_SIZE * MAP_SIZE);
    initDeposits(this);
  }

  /* ================================================================ Erzeugen */

  /** Neues Spiel: kleine Siedlung mit Lagerhaus, Straße und zwei Häusern (Eingang zur Straße gedreht) */
  static newGame(seed: number, playerCount = 2): GameEngine {
    const g = new GameEngine(seed);
    g.players = createPlayers(playerCount);
    const c = MAP_SIZE / 2;
    g.addBuilding("warehouse", c - 1, c - 2, true);
    for (let x = c - 3; x <= c + 4; x++) g.addBuilding("road", x, c + 1, true);
    g.addBuilding("house_s", c - 2, c + 2, true, 2);
    g.addBuilding("house_s", c, c + 2, true, 2);
    g.pop = 8;
    g.recompute();
    depositResource(g, "holz", 150); depositResource(g, "stein", 80); depositResource(g, "bretter", 20);
    depositResource(g, "getreide", 150); depositResource(g, "brot", 50); depositResource(g, "gold", 50);
    syncPopulation(g);
    g.computeStats();
    return g;
  }

  /** Spielstand laden (validiert; ältere Versionen werden migriert) */
  static load(data: SaveData): GameEngine {
    const g = new GameEngine(Math.floor(Number(data.seed)) || 1);
    const legacy = !(Number(data.v) >= SAVE_VERSION);
    const num = (v: unknown, d: number) => (typeof v === "number" && isFinite(v) ? v : d);
    const tileOk = (i: number) => Number.isInteger(i) && i >= 0 && i < MAP_SIZE * MAP_SIZE;
    g.xp = Math.max(0, num(data.xp, 0));
    g.level = Math.max(1, Math.floor(num(data.level, 1)));
    g.pop = Math.max(0, num(data.pop, 0));
    g.soldiers = Math.max(0, num(data.soldiers, 0));
    g.playTime = Math.max(0, num(data.playTime, 0));
    g.tradeCount = Math.max(0, Math.floor(num(data.tradeCount, 0)));
    g.players = normalizePlayers(data.players);
    if (data.treeGrowth && typeof data.treeGrowth === "object") for (const [k, v] of Object.entries(data.treeGrowth)) { const i = Number(k), n = Number(v); if (tileOk(i) && Number.isFinite(n)) g.treeGrowth.set(i, Math.max(0, Math.min(3, n))); }
    if (Array.isArray(data.harvestedTrees)) for (const i of data.harvestedTrees) if (tileOk(i) && !g.treeGrowth.has(i)) g.treeGrowth.set(i, 0);
    if (data.treeEmpty && typeof data.treeEmpty === "object") for (const [k, v] of Object.entries(data.treeEmpty)) { const i = Number(k), n = Number(v); if (tileOk(i) && Number.isFinite(n) && g.treeGrowth.get(i) === 0) g.treeEmpty.set(i, Math.max(0, n)); }
    if (data.depositRemaining && typeof data.depositRemaining === "object") for (const [k, v] of Object.entries(data.depositRemaining)) { const i = Number(k), n = Number(v); if (tileOk(i) && Number.isFinite(n)) g.depositRemaining.set(i, Math.max(0, n)); }
    g.questsDone = Array.isArray(data.questsDone) ? data.questsDone.filter((x) => QUESTS.some((q) => q.id === x)) : [];
    const done = Array.isArray(data.research?.done) ? data.research.done.filter((id) => TECHS.some((t) => t.id === id)) : [];
    const act = data.research?.active;
    g.research = { done, active: act && TECHS.some((t) => t.id === act.id) ? { id: act.id, remaining: Math.max(0, num(act.remaining, 1)) } : null };

    // Gebäude (IDs bleiben erhalten, damit Einwohner/Aufträge/Lager ihre Bezüge behalten)
    const idMap = new Map<number, number>();
    let seq = 0;
    for (const b of Array.isArray(data.buildings) ? data.buildings : []) {
      seq++;
      if (!b || !BUILDINGS[b.t]) continue;
      const rotation: Rot = b.r === 1 || b.r === 2 || b.r === 3 ? b.r : 0;
      if (!g.terrainFree(b.t, Math.floor(b.x), Math.floor(b.y), rotation)) continue;
      const nb = g.addBuilding(b.t, Math.floor(b.x), Math.floor(b.y), num(b.p, 1) >= 1, rotation);
      if (!nb) continue;
      idMap.set(Number.isInteger(b.i) ? (b.i as number) : seq, nb.id);
      if (!nb.built) {
        nb.progress = Math.max(0, Math.min(0.99, num(b.p, 0)));
        if (legacy && nb.physical) { for (const [r, n] of Object.entries(constructionMaterials(nb.type)) as [ResId, number][]) nb.physical.input[r] = n; } // früher bereits bezahlt
      }
    }
    g.recompute();

    // Lager
    const saved = data.localStorage && typeof data.localStorage === "object" ? data.localStorage : {};
    for (const [oldId, st] of Object.entries(saved)) {
      const b = g.getBuilding(idMap.get(Number(oldId)) ?? -1);
      if (!b?.physical || !st || typeof st !== "object") continue;
      if (legacy && (BUILDINGS[b.type].hub || !b.built)) continue;
      const clean = (s: unknown) => { const o: Partial<Record<ResId, number>> = {}; if (s && typeof s === "object") for (const r of RES_IDS) { const n = Number((s as Record<string, unknown>)[r]); if (Number.isFinite(n) && n > 0) o[r] = n; } return o; };
      b.physical.input = clean(st.input); b.physical.output = clean(st.output);
      if (Number.isFinite(st.productionProgress)) b.physical.productionProgress = Math.max(0, Math.min(1, Number(st.productionProgress)));
      if (st.level === 1 || st.level === 2 || st.level === 3) b.physical.level = st.level;
      if (Number.isFinite(st.lastOutputAt)) b.physical.lastOutputAt = 0;
    }
    if (legacy) { g.recompute(); setHubStock(g, Object.fromEntries(RES_IDS.map((r) => [r, Math.max(0, num(data.res?.[r], 0))]))); }
    for (const b of g.buildings) if (b.physical) b.physical.rotation = b.rotation;
    if (data.fieldStates && typeof data.fieldStates === "object") for (const [oldId, f] of Object.entries(data.fieldStates)) {
      const b = g.getBuilding(idMap.get(Number(oldId)) ?? -1);
      if (!b?.field || !f) continue;
      const stages = ["EMPTY", "PLOWED", "SOWN", "GROWING", "RIPE", "HARVESTING", "HARVESTED"];
      const stage = stages.includes(f.stage) ? f.stage : "EMPTY";
      b.field = { ...b.field, stage: (stage === "HARVESTING" ? "RIPE" : stage) as FieldState["stage"], progress: Math.max(0, Math.min(1, Number(f.progress) || 0)), farmerId: null, yieldAmount: Math.max(1, Number(f.yieldAmount) || 4) };
    }

    // Einwohner & Transporte (erst ab v4 – ältere Saves enthielten erfundene Träger)
    if (!legacy) {
      if (Array.isArray(data.residents)) {
        for (const r of data.residents) {
          if (!r || !Number.isFinite(r.id) || !Number.isFinite(r.x) || !Number.isFinite(r.y) || g.residentById.has(r.id)) continue;
          const wp = r.workplaceId !== null && r.workplaceId !== undefined ? idMap.get(r.workplaceId) ?? null : null;
          const home = r.homeBuildingId !== null && r.homeBuildingId !== undefined ? idMap.get(r.homeBuildingId) ?? null : null;
          const carrying = r.carrying && RES_IDS.includes(r.carrying.resource) && Number(r.carrying.amount) > 0 ? { resource: r.carrying.resource, amount: Number(r.carrying.amount) } : null;
          const isC = r.job === "traeger";
          g.addResident({
            id: Math.floor(r.id), x: r.x, y: r.y, homeBuildingId: home, job: typeof r.job === "string" ? r.job : "unassigned", workplaceId: wp,
            state: carrying && !isC ? "DELIVERING_RESOURCE" : RESIDENT_STATES.includes(r.state) ? (isC && r.orderId !== null ? r.state : "WAITING") : "WAITING",
            targetX: r.x, targetY: r.y, speed: Math.max(0.5, Math.min(6, num(r.speed, 2.2))), path: [], pathIndex: 0, carrying,
            workTimer: 0, animation: 0, workTargetId: null, orderId: isC && Number.isInteger(r.orderId) ? r.orderId : null, atWork: false,
          });
        }
        g.nextResidentId = Math.max(1, ...g.residents.map((r) => r.id + 1));
      }
      if (Array.isArray(data.transportOrders)) {
        for (const o of data.transportOrders) {
          if (!o || !Number.isFinite(o.id) || !RES_IDS.includes(o.resource) || !(ACTIVE_STATUSES as string[]).includes(o.status)) continue;
          const s = o.sourceBuildingId !== null ? idMap.get(o.sourceBuildingId as number) ?? null : null, t = o.targetBuildingId !== null ? idMap.get(o.targetBuildingId as number) ?? null : null;
          g.transportOrders.push({ ...o, amount: Math.max(0, Number(o.amount) || 0), sourceBuildingId: s, targetBuildingId: t, waited: Math.max(0, Number(o.waited) || 0), blockedFor: 0, routeVersion: -1 });
        }
        g.nextTransportId = Math.max(1, ...g.transportOrders.map((o) => o.id + 1));
      }
      if (data.transportStats && typeof data.transportStats === "object") for (const k of ["delivered", "cancelled", "failed", "goods"] as const) g.transportStats[k] = Math.max(0, num(data.transportStats[k], 0));
      for (const r of g.residents) { const o = r.orderId !== null ? g.transportOrders.find((x) => x.id === r.orderId && x.carrierId === r.id) : undefined; if (!o) { r.orderId = null; } else r.atWork = true; }
      for (const o of g.transportOrders) if (o.carrierId !== null && g.getResident(o.carrierId)?.orderId !== o.id) o.carrierId = null;
      rebuildReservations(g);
    }
    g.recompute(); g.computeStats(); syncRes(g);
    return g;
  }

  serialize(): SaveData {
    const physical: Record<string, Partial<PhysicalBuildingState>> = {};
    for (const b of this.buildings) if (b.physical) { const p = b.physical; physical[b.id] = { input: p.input, output: p.output, production: p.production, productionProgress: p.productionProgress, rotation: p.rotation, level: p.level, lastOutputAt: 0 }; }
    return {
      v: SAVE_VERSION,
      seed: this.seed,
      buildings: this.buildings.map((b) => ({ i: b.id, t: b.type, x: b.x, y: b.y, p: b.built ? 1 : Math.round(b.progress * 1000) / 1000, r: b.rotation })),
      res: Object.fromEntries(RES_IDS.map((r) => [r, Math.round(this.resCache[r] * 100) / 100])),
      xp: Math.round(this.xp * 100) / 100,
      level: this.level,
      pop: Math.round(this.pop * 100) / 100,
      soldiers: Math.round(this.soldiers * 100) / 100,
      playTime: Math.round(this.playTime),
      research: this.research,
      questsDone: this.questsDone,
      tradeCount: this.tradeCount,
      residents: this.residents.map((r) => ({ ...r, path: [], x: Math.round(r.x * 100) / 100, y: Math.round(r.y * 100) / 100 })),
      transportOrders: this.transportOrders,
      localStorage: physical,
      treeGrowth: Object.fromEntries([...this.treeGrowth].map(([k, v]) => [k, Math.round(v * 1000) / 1000])),
      treeEmpty: Object.fromEntries([...this.treeEmpty].map(([k, v]) => [k, Math.round(v)])),
      fieldStates: Object.fromEntries(this.buildings.filter((b) => b.field).map((b) => [b.id, b.field!])),
      depositRemaining: Object.fromEntries([...this.depositRemaining].filter(([i, v]) => v !== initialDeposit(this, i))),
      transportStats: this.transportStats,
      lostGoods: this.lostGoods as Record<string, number>,
      players: this.players,
    };
  }

  /* ============================================================ Abonnements */
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private notify() { this.version++; this.listeners.forEach((l) => l()); }
  setSimulationSpeed(speed: 0 | 1 | 2) { this.simulationSpeed = speed; this.notify(); }
  toast(text: string, kind: Toast["kind"] = "info") {
    this.toasts.push({ id: this.toastId++, text, kind, t: this.clock });
    if (this.toasts.length > 5) this.toasts.shift();
  }

  /* ============================================================ Einwohner-Index */
  addResident(r: Resident) { this.residents.push(r); this.residentById.set(r.id, r); }
  removeResident(r: Resident) { this.residents = this.residents.filter((x) => x !== r); this.residentById.delete(r.id); }
  getResident(id: number): Resident | undefined { return this.residentById.get(id); }
  workersAt(id: number): Resident[] { return this.workerIndex.get(id) ?? []; }
  private indexWorkers() {
    this.workerIndex.clear();
    for (const r of this.residents) if (r.workplaceId !== null) { const l = this.workerIndex.get(r.workplaceId); if (l) l.push(r); else this.workerIndex.set(r.workplaceId, [r]); }
  }

  /* ================================================================ Wirtschaft (API) */
  getTotalResource(r: ResId) { return getTotalResource(this, r); }
  getEconomyTotal(r: ResId) { return getEconomyTotal(this, r); }
  getSpendableResource(r: ResId) { return getSpendableResource(this, r); }
  getResourceCapacity(r: ResId) { return getResourceCapacity(this, r); }
  canAfford(cost: ResAmounts) { return canAfford(this, cost); }
  consumeResource(r: ResId, n: number) { return consumeResource(this, r, n); }
  consumeCost(cost: ResAmounts) { return consumeCost(this, cost); }
  depositResource(r: ResId, n: number) { return depositResource(this, r, n); }
  /** Test/Debug: Hub-Bestand direkt setzen */
  setResources(stock: Partial<Record<ResId, number>>) { setHubStock(this, stock); }
  hubCapacity(r: ResId): number { return Math.floor(this.limit[r] / Math.max(1, this.hubs.length)); }
  logistics() { return logisticsSummary(this); }

  /* ================================================================== Bauen */
  private idx(x: number, y: number) { return y * MAP_SIZE + x; }
  private inb(x: number, y: number) { return x >= 0 && y >= 0 && x < MAP_SIZE && y < MAP_SIZE; }
  footprint(type: BuildingId, rotation: Rot = 0): [number, number] { const [w, h] = BUILDINGS[type].size; return rotation % 2 ? [h, w] : [w, h]; }
  private terrainFree(type: BuildingId, x: number, y: number, rotation: Rot = 0): boolean {
    const [w, h] = this.footprint(type, rotation);
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        if (!this.inb(x + i, y + j)) return false;
        const t = this.map.terrain[this.idx(x + i, y + j)];
        if (t !== T.GRASS && t !== T.SAND) return false;
        if (this.occ[this.idx(x + i, y + j)]) return false;
      }
    return true;
  }

  private addBuilding(type: BuildingId, x: number, y: number, built: boolean, rotation: Rot = 0): Building | null {
    if (!this.terrainFree(type, x, y, rotation)) return null;
    const b: Building = {
      id: this.nextId++, type, x, y, progress: built ? 1 : 0, built,
      status: built ? "ok" : "constructing", workers: 0, crew: {}, connected: false, site: 1, eff: 0, mineRes: null, missing: null, rotation,
    };
    const needsState = PHYSICAL_TYPES.includes(type) || (!built && !CONSTRUCTION.instant.includes(type));
    if (needsState) b.physical = newPhysicalState(rotation);
    if (type === "field") b.field = { stage: "EMPTY", progress: 0, crop: "getreide", farmerId: null, yieldAmount: 4 };
    this.buildings.push(b);
    this.byId.set(b.id, b);
    const [w, h] = this.footprint(type, rotation);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.occ[this.idx(x + i, y + j)] = b.id;
    this.dirtyFlag = true;
    return b;
  }

  /** Baustelle abschließen: Material verbraucht, Gebäude funktionsfähig */
  completeBuilding(b: Building) {
    if (b.built) return;
    const def = BUILDINGS[b.type];
    b.built = true; b.progress = 1; b.status = "ok"; b.siteState = undefined;
    if (b.physical) { b.physical.input = {}; b.physical.reservedInput = {}; if (!PHYSICAL_TYPES.includes(b.type)) b.physical = undefined; }
    for (const r of this.residents) if (r.workTargetId === b.id && r.job === "baumeister") { r.workTargetId = null; r.atWork = false; r.state = "WAITING"; r.path = []; r.pathIndex = 0; }
    this.addXp(def.xp);
    if (def.id !== "road") this.toast(`${def.name} fertiggestellt`, "good");
    this.dirtyFlag = true;
  }

  getBuilding(id: number): Building | undefined { return this.byId.get(id); }
  buildingAt(x: number, y: number): Building | undefined {
    if (!this.inb(x, y)) return undefined;
    const id = this.occ[this.idx(x, y)];
    return id ? this.byId.get(id) : undefined;
  }
  count(type: BuildingId, builtOnly = true): number {
    let n = 0;
    for (const b of this.buildings) if (b.type === type && (!builtOnly || b.built)) n++;
    return n;
  }
  isProcessor(b: Building) { return PROCESSORS.includes(b.type); }

  private upgradeSpec(b: Building) { const lvl = b.physical?.level; return lvl === 2 || lvl === 3 ? UPGRADE_LEVELS[b.type]?.[lvl] : undefined; }
  /** Produktions-/Arbeitsgeschwindigkeit: Forschung × Upgrade-Stufe */
  speedMult(b: Building): number { return (1 + this.techProdMult(b.type)) * (this.upgradeSpec(b)?.speed ?? 1); }
  rangeBonus(b: Building): number { return this.upgradeSpec(b)?.range ?? 0; }
  /** Stellen des Hauptberufs (inkl. Upgrade-Stufe) */
  slotsOf(b: Building): number { const d = BUILDINGS[b.type]; return d.jobs ? d.jobs.count + (this.upgradeSpec(b)?.workerSlots ?? 0) : 0; }

  canUpgrade(id: number): { ok: boolean; reason?: string; level?: 2 | 3; cost?: ResAmounts } {
    const b = this.getBuilding(id), current = b?.physical?.level ?? 1, next = (current + 1) as 2 | 3, spec = b ? UPGRADE_LEVELS[b.type]?.[next] : undefined;
    if (!b || !b.built || !b.physical || !spec) return { ok: false, reason: current >= 3 ? "Maximale Stufe erreicht" : "Gebäude nicht upgradefähig" };
    for (const [r, n] of Object.entries(spec.cost) as [ResId, number][]) if (this.getSpendableResource(r) < n) return { ok: false, reason: `Nicht genug ${RESOURCES[r].name}`, level: next, cost: spec.cost };
    return { ok: true, level: next, cost: spec.cost };
  }
  upgradeBuilding(id: number): { ok: boolean; reason?: string } {
    const check = this.canUpgrade(id);
    if (!check.ok || !check.level || !check.cost) return { ok: false, reason: check.reason };
    if (!this.consumeCost(check.cost)) return { ok: false, reason: "Nicht genug Rohstoffe" };
    const b = this.getBuilding(id)!;
    b.physical!.level = check.level; this.dirtyFlag = true; this.recompute(); this.toast(`${BUILDINGS[b.type].name} auf Stufe ${check.level} verbessert`, "good"); this.notify();
    return { ok: true };
  }

  /** Standortqualität für ein (auch noch nicht gebautes) Gebäude */
  computeSite(type: BuildingId, x: number, y: number): { factor: number; mineRes: ResId | null } {
    const def = BUILDINGS[type];
    const s = def.site;
    if (!s) return { factor: 1, mineRes: null };
    const [w, h] = def.size;
    if (s.kind === "fields") {
      const cx = x + w / 2, cy = y + h / 2;
      let n = 0;
      for (const b of this.buildings) {
        if (b.type !== "field" || !b.built) continue;
        if (Math.hypot(b.x + 1 - cx, b.y + 1 - cy) <= s.radius) n++;
      }
      return { factor: Math.min(1, n / s.full), mineRes: null };
    }
    const counts = [0, 0, 0, 0];
    let forest = 0, mountain = 0;
    for (let yy = y - s.radius; yy < y + h + s.radius; yy++)
      for (let xx = x - s.radius; xx < x + w + s.radius; xx++) {
        if (!this.inb(xx, yy)) continue;
        const i = this.idx(xx, yy);
        const t = this.map.terrain[i];
        if (t === T.FOREST) forest++;
        else if (t === T.MOUNTAIN) { mountain++; counts[this.map.deposit[i]]++; }
      }
    if (s.kind === "forest") return { factor: Math.min(1, forest / s.full), mineRes: null };
    if (s.kind === "mountain") return { factor: Math.min(1, mountain / s.full), mineRes: null };
    let best = 1;
    for (const k of [1, 2, 3]) if (counts[k] > counts[best]) best = k;
    const n = counts[best];
    const DEPRES: Record<number, ResId> = { 1: "eisen", 2: "kohle", 3: "gold" };
    return { factor: Math.min(1, n / s.full), mineRes: n > 0 ? DEPRES[best] : null };
  }

  checkPlace(type: BuildingId, x: number, y: number, rotation: Rot = this.ui.buildRotation): PlaceCheck {
    const def = BUILDINGS[type];
    if (this.level < def.unlock) return { ok: false, reason: `Ab Level ${def.unlock} verfügbar`, site: null, mineRes: null };
    const [w, h] = this.footprint(type, rotation);
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        if (!this.inb(x + i, y + j)) return { ok: false, reason: "Außerhalb der Karte", site: null, mineRes: null };
        const t = this.map.terrain[this.idx(x + i, y + j)];
        if (t !== T.GRASS && t !== T.SAND) return { ok: false, reason: "Gelände nicht bebaubar", site: null, mineRes: null };
        if (this.occ[this.idx(x + i, y + j)]) return { ok: false, reason: "Bereits bebaut", site: null, mineRes: null };
      }
    const { factor, mineRes } = this.computeSite(type, x, y);
    if (def.site && def.site.kind !== "fields" && factor <= 0) return { ok: false, reason: `Keine ${def.site.label} in Reichweite`, site: 0, mineRes };
    // Straßen/Felder werden sofort bezahlt; alle anderen Gebäude erhalten ihr Material per Träger auf der Baustelle.
    if (CONSTRUCTION.instant.includes(type)) {
      for (const [r, n] of Object.entries(def.cost) as [ResId, number][]) if (this.getSpendableResource(r) < n) return { ok: false, reason: `Nicht genug ${RESOURCES[r].name}`, site: def.site ? factor : null, mineRes };
    }
    return { ok: true, reason: null, site: def.site ? factor : null, mineRes };
  }

  /** Dreht so, dass ein Zugang auf eine angebundene Straße trifft (sonst aktuelle Rotation). */
  bestRotation(type: BuildingId, x: number, y: number): Rot {
    const cur = this.ui.buildRotation;
    if (type === "road" || type === "field") return cur;
    for (let k = 0; k < 4; k++) {
      const rot = ((cur + k) % 4) as Rot;
      if (!this.terrainFree(type, x, y, rot)) continue;
      if (accessTiles(type, x, y, rot).some(([ax, ay]) => this.roadReach[this.idx(ax, ay)] === 1)) return rot;
    }
    return cur;
  }

  /** Baustelle platzieren (Straße/Feld: sofort bezahlt). Kosten für Gebäude werden physisch geliefert. */
  place(type: BuildingId, x: number, y: number, rotation: Rot = this.ui.buildRotation): PlaceCheck {
    const check = this.checkPlace(type, x, y, rotation);
    if (!check.ok) return check;
    if (CONSTRUCTION.instant.includes(type) && !this.consumeCost(BUILDINGS[type].cost)) return { ...check, ok: false, reason: "Nicht genug Rohstoffe" };
    this.addBuilding(type, x, y, false, rotation);
    this.notify();
    return check;
  }

  /** Abriss: Baustellen geben gelieferte Materialien zurück, fertige Gebäude 50 % der Kosten; Lagerinhalte gehen in die Hubs. */
  demolish(id: number): { ok: boolean; reason?: string } {
    const b = this.byId.get(id);
    if (!b) return { ok: false, reason: "Nicht gefunden" };
    const def = BUILDINGS[b.type];
    if (def.hub && b.built && this.buildings.filter((o) => BUILDINGS[o.type].hub && o.built && o.id !== id).length === 0)
      return { ok: false, reason: "Das letzte Lagerhaus kann nicht abgerissen werden." };
    onBuildingRemoved(this, id);
    for (const r of [...this.residents]) {
      if (r.workplaceId === id && !(r.job === "traeger" && r.orderId !== null)) releaseResident(this, r);
      else if (r.workplaceId === id) { r.workplaceId = null; }
      if (r.homeBuildingId === id) r.homeBuildingId = null;
      if (r.workTargetId === id && r.job === "baumeister") { r.workTargetId = null; r.state = "WAITING"; r.path = []; r.pathIndex = 0; }
    }
    if (b.field?.farmerId) { const f = this.getResident(b.field.farmerId); if (f) { f.workTargetId = null; f.state = "WAITING"; } }
    const contents: ResAmounts = {};
    if (b.physical) for (const s of [b.physical.input, b.physical.output]) for (const [r, n] of Object.entries(s) as [ResId, number][]) if (n > 0) contents[r] = (contents[r] ?? 0) + n;
    const [w, h] = this.footprint(b.type, b.rotation);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.occ[this.idx(b.x + i, b.y + j)] = 0;
    this.buildings = this.buildings.filter((o) => o.id !== id);
    this.byId.delete(id);
    if (this.ui.selectedId === id) this.ui.selectedId = null;
    this.dirtyFlag = true;
    this.recompute();
    for (const [r, n] of Object.entries(contents) as [ResId, number][]) { const put = depositResource(this, r, n); if (n - put > 1e-6) this.lostGoods[r] = (this.lostGoods[r] ?? 0) + (n - put); }
    if (b.built) depositCost(this, def.cost, CONSTRUCTION.demolishRefund);
    this.computeStats();
    this.notify();
    return { ok: true };
  }

  /* ======================================================== UI-Interaktion */

  setBuildType(t: BuildingId | null) {
    this.ui.buildType = t;
    if (!t) this.ui.buildRotation = 0;
    this.ui.ghost = null;
    if (t) this.ui.selectedId = null;
    this.notify();
  }
  select(id: number | null) { this.ui.selectedId = id; this.notify(); }
  rotateBuild() { this.ui.buildRotation = ((this.ui.buildRotation + 1) % 4) as Rot; const g = this.ui.ghost; if (g && this.ui.buildType) g.check = this.checkPlace(this.ui.buildType, g.x, g.y); this.notify(); }
  /** Gebäude um 90° drehen (Footprint, Zugang und Belegung folgen; Wegenetz wird neu berechnet) */
  rotateBuilding(id: number): boolean {
    const b = this.getBuilding(id);
    if (!b || b.type === "road" || b.type === "field") return false;
    const next = ((b.rotation + 1) % 4) as Rot;
    const [oldW, oldH] = this.footprint(b.type, b.rotation);
    for (let j = 0; j < oldH; j++) for (let i = 0; i < oldW; i++) this.occ[this.idx(b.x + i, b.y + j)] = 0;
    const ok = this.terrainFree(b.type, b.x, b.y, next);
    const [w, h] = ok ? this.footprint(b.type, next) : [oldW, oldH];
    if (ok) { b.rotation = next; if (b.physical) b.physical.rotation = next; }
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.occ[this.idx(b.x + i, b.y + j)] = b.id;
    if (!ok) return false;
    this.dirtyFlag = true; this.recompute(); this.notify();
    return true;
  }

  setGhost(x: number, y: number) {
    const t = this.ui.buildType;
    if (!t) return;
    const g = this.ui.ghost;
    if (g && g.x === x && g.y === y) { g.check = this.checkPlace(t, x, y); return; }
    this.ui.ghost = { x, y, check: this.checkPlace(t, x, y) };
    this.notify();
  }
  clearGhost() { if (this.ui.ghost) { this.ui.ghost = null; this.notify(); } }

  confirmGhost(): PlaceCheck | null {
    const t = this.ui.buildType, g = this.ui.ghost;
    if (!t || !g) return null;
    const rot = this.bestRotation(t, g.x, g.y);
    if (rot !== this.ui.buildRotation) this.ui.buildRotation = rot;
    const r = this.place(t, g.x, g.y, rot);
    if (!r.ok && r.reason) this.toast(r.reason, "warn");
    g.check = this.checkPlace(t, g.x, g.y);
    return r;
  }

  /* ==================================================== Netz & Ableitungen */

  /** Straßennetz, Anbindung, Standortqualität, Hubs und Limits neu berechnen (bei jeder Strukturänderung) */
  recompute() {
    const N = MAP_SIZE;
    const reach = this.roadReach;
    reach.fill(0);
    this.roadGrid.fill(0);
    for (const b of this.buildings) if (b.type === "road" && b.built) this.roadGrid[this.idx(b.x, b.y)] = 1;
    this.hubs = this.buildings.filter((b) => b.built && BUILDINGS[b.type].hub && !!b.physical);
    const queue: number[] = [];
    for (const b of this.hubs) for (const [ax, ay] of roadAccess(this, b)) { const i = this.idx(ax, ay); if (!reach[i]) { reach[i] = 1; queue.push(i); } }
    while (queue.length) {
      const i = queue.pop()!;
      const x = i % N, y = (i / N) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!this.inb(nx, ny)) continue;
        const ni = this.idx(nx, ny);
        if (!reach[ni] && this.roadGrid[ni]) { reach[ni] = 1; queue.push(ni); }
      }
    }
    for (const b of this.buildings) {
      const def = BUILDINGS[b.type];
      if (b.type === "road") b.connected = !!reach[this.idx(b.x, b.y)];
      else if (def.hub && b.built) b.connected = true;
      else if (b.type === "field") b.connected = false;
      else b.connected = buildingAccess(b).some(([ax, ay]) => !!reach[this.idx(ax, ay)]);
      const s = this.computeSite(b.type, b.x, b.y);
      b.site = s.factor;
      b.mineRes = s.mineRes;
    }
    let storage = 0;
    for (const b of this.buildings) if (b.built) storage += BUILDINGS[b.type].storage ?? 0;
    let mult = 1;
    for (const id of this.research.done) {
      const t = TECHS.find((x) => x.id === id);
      if (t?.effect.kind === "storage") mult += t.effect.mult;
    }
    for (const r of RES_IDS) this.limit[r] = Math.round((RESOURCES[r].limit + storage) * mult);
    this.pathVersion++;
    this.dirtyFlag = false;
    syncRes(this);
  }

  techProdMult(type: BuildingId): number {
    let m = 0;
    for (const id of this.research.done) {
      const t = TECHS.find((x) => x.id === id);
      if (t?.effect.kind === "prod" && t.effect.buildings.includes(type)) m += t.effect.mult;
    }
    return m;
  }
  private hasTech(kind: "trade" | "drill"): boolean {
    return this.research.done.some((id) => TECHS.find((t) => t.id === id)?.effect.kind === kind);
  }

  /** Bevölkerungskapazität, Arbeitsplätze (aus dem endlichen Bestand) und Militärstärke ableiten */
  computeStats() {
    let cap = 0;
    for (const b of this.buildings) { const def = BUILDINGS[b.type]; if (b.built && def.housing && b.connected) cap += def.housing; }
    this.popCap = cap;
    this.workforce = Math.floor(Math.floor(this.pop) * POPULATION.workerShare);
    for (const j of JOB_IDS) this.byJob[j] = { needed: 0, filled: 0 };
    const sites = this.buildings.filter((b) => !b.built && !isInstant(b) && b.connected).length;
    let remaining = this.workforce;
    let mil = Math.floor(this.soldiers) * 2;
    for (const b of this.buildings) {
      b.workers = 0; b.crew = {};
      if (!b.built) continue;
      const def = BUILDINGS[b.type];
      const list: [JobId, number][] = [];
      if (def.jobs) list.push([def.jobs.job, this.slotsOf(b)]);
      for (const [job, n] of Object.entries(def.crew ?? {}) as [JobId, number][]) list.push([job, job === "baumeister" ? Math.min(n, sites * CONSTRUCTION.buildersPerSite) : n]);
      for (const [job, n] of list) {
        this.byJob[job].needed += n;
        if (def.needsRoad && !b.connected) continue;
        const w = Math.min(n, remaining);
        if (w > 0) { b.crew[job] = w; b.workers += w; remaining -= w; this.byJob[job].filled += w; }
      }
      if (def.military && def.jobs) { const slots = this.slotsOf(b); mil += def.military * ((b.crew[def.jobs.job] ?? 0) / Math.max(1, slots)); }
    }
    this.military = Math.round(mil);
  }

  /* ============================================================= Simulation */

  /** Pro Frame aufrufen. dt in Sekunden. */
  update(dt: number) {
    if (this.simulationSpeed === 0) return;
    dt *= this.simulationSpeed;
    dt = Math.min(dt, 0.5);
    this.clock += dt;
    this.playTime += dt;
    this.toasts = this.toasts.filter((t) => this.clock - t.t < 5);
    this.acc += dt;
    let guard = 0;
    while (this.acc >= SIM_STEP && guard++ < 6) { this.acc -= SIM_STEP; this.step(SIM_STEP); }
    if (this.acc > SIM_STEP) this.acc = 0;
    this.notifyAcc += dt;
    if (this.notifyAcc >= 0.25) { this.notifyAcc = 0; this.notify(); }
  }

  /** Headless: Simulation um `seconds` vorspulen (Tests) */
  simulate(seconds: number) { for (let t = 0; t < seconds; t += SIM_STEP) this.update(SIM_STEP); }

  private step(dt: number) {
    if (this.dirtyFlag) this.recompute();
    this.physicalClock += dt;
    advanceComputerPlayers(this.players, dt);
    this.computeStats();
    syncPopulation(this);
    assignHomes(this);
    assignWorkplaces(this);
    this.indexWorkers();
    const flowP = this.flowProd, flowC = this.flowCons;

    updateTrees(this, dt);
    updateFields(this, dt);
    updateResidents(this, dt);
    updateProcessors(this, dt);
    updateConstruction(this, dt);
    if (this.dirtyFlag) { this.recompute(); this.computeStats(); }
    planTransports(this);
    updateOrders(this, dt);
    this.updateStatuses();
    const barracks = this.count("barracks");

    /* ---- Kaserne (Dienstleistung, entnimmt Brot/Werkzeuge aus den Hubs) ---- */
    for (const b of this.buildings) {
      const def = BUILDINGS[b.type];
      if (!b.built || def.recipe?.special !== "soldier" || b.status !== "ok") continue;
      const slots = Math.max(1, this.slotsOf(b));
      let eff = ((b.crew.soldat ?? 0) / slots) * (this.hasTech("drill") ? 2 : 1);
      b.eff = eff;
      const cap = Math.min(barracks * SOLDIERS_PER_BARRACKS, Math.floor(this.pop * 0.5));
      let cycles = Math.min((eff * dt) / def.recipe.cycle, Math.max(0, cap - this.soldiers));
      for (const [r, n] of Object.entries(def.recipe.inputs) as [ResId, number][]) { const avail = this.getSpendableResource(r) / n; if (avail < cycles) { cycles = avail; b.missing = r; b.status = "no_input"; } }
      if (cycles <= 0) { eff = 0; continue; }
      for (const [r, n] of Object.entries(def.recipe.inputs) as [ResId, number][]) { this.consumeResource(r, n * cycles); flowC[r] += n * cycles; }
      this.soldiers += cycles;
    }

    /* ---- Bevölkerung: Verbrauch + Wachstum (Nahrung wird aus den Hubs entnommen) ---- */
    const need = (Math.floor(this.pop) * POPULATION.foodPerCapitaPerMin * dt) / 60;
    let fed = 1, usedBrot = 0;
    if (need > 0) {
      usedBrot = Math.min(this.getSpendableResource("brot"), need);
      const usedGrain = Math.min(this.getSpendableResource("getreide"), need - usedBrot);
      this.consumeResource("brot", usedBrot); this.consumeResource("getreide", usedGrain);
      flowC.brot += usedBrot; flowC.getreide += usedGrain;
      fed = (usedBrot + usedGrain) / need;
    }
    this.foodStatus = fed >= 0.98 ? "ok" : fed > 0.4 ? "low" : "starving";
    const perMin = (0.8 + 0.08 * this.pop) * (usedBrot > 0 ? 1.5 : 1);
    this.growthPerMin = 0;
    if (this.foodStatus === "ok" && this.pop < this.popCap) { this.growthPerMin = perMin; this.pop = Math.min(this.popCap, this.pop + (perMin * dt) / 60); }
    else if (this.foodStatus === "starving" && this.pop > 2) { this.growthPerMin = -0.6; this.pop = Math.max(2, this.pop - (0.6 * dt) / 60); }
    if (this.pop > this.popCap + 0.5) { this.pop = Math.max(this.popCap, this.pop - dt / 60); this.growthPerMin = -1; }
    if (this.soldiers > this.pop * 0.5) this.soldiers = Math.max(0, this.pop * 0.5);
    syncPopulation(this); // Einwohner-Entitäten folgen sofort der Bevölkerungszahl

    /* ---- Raten glätten (gleitender Mittelwert pro Minute) ---- */
    for (const r of RES_IDS) {
      this.prod[r] += ((flowP[r] / dt) * 60 - this.prod[r]) * 0.12;
      this.cons[r] += ((flowC[r] / dt) * 60 - this.cons[r]) * 0.12;
      flowP[r] = 0; flowC[r] = 0;
    }

    /* ---- Forschung ---- */
    const act = this.research.active;
    if (act) {
      act.remaining -= dt;
      if (act.remaining <= 0) {
        const t = TECHS.find((x) => x.id === act.id)!;
        this.research.done.push(t.id);
        this.research.active = null;
        this.toast(`Erforscht: ${t.name}`, "good");
        this.addXp(40 + t.minLevel * 6);
        this.dirtyFlag = true;
      }
    }
    syncRes(this);
    this.computeStats();
    this.checkQuests();
  }

  /** Gebäudestatus für HUD/Inspektor aus dem physischen Zustand ableiten */
  private updateStatuses() {
    for (const b of this.buildings) {
      const def = BUILDINGS[b.type];
      if (!b.built) { b.status = "constructing"; continue; }
      if (def.recipe?.special) { b.status = def.needsRoad && !b.connected ? "no_road" : b.workers <= 0 ? "no_workers" : "ok"; b.missing = null; continue; }
      if (def.needsRoad && !b.connected && def.id !== "road") { b.status = "no_road"; continue; }
      if (def.jobs && b.workers <= 0) { b.status = "no_workers"; continue; }
      if (def.site && def.site.kind !== "fields" && b.site <= 0) { b.status = "no_site"; continue; }
      b.status = "ok";
      if (b.type === "mine" || b.type === "quarry") { if (depositInfo(this, b).remaining <= 0) { b.status = "depleted"; continue; } }
      const p = b.physical;
      if (!p) continue;
      if (this.isProcessor(b)) {
        b.status = p.production === "WAITING_FOR_INPUT" ? "no_input" : p.production === "WAITING_FOR_PICKUP" ? "storage_full" : p.production === "NO_WORKER" ? "no_workers" : "ok";
      } else if (!isHub(b)) {
        for (const r of Object.keys(p.output) as ResId[]) if (getStored(b, "output", r) >= getCapacity(this, b, "output", r) - 1e-9 && getCapacity(this, b, "output", r) > 0) b.status = "storage_full";
      }
    }
  }

  /* ============================================================ Level / XP */

  addXp(n: number) {
    this.xp += n;
    while (this.xp >= xpToNext(this.level)) {
      this.xp -= xpToNext(this.level);
      this.level++;
      const unlocked = LEVEL_UNLOCKS.find((u) => u.level === this.level);
      const newB = Object.values(BUILDINGS).filter((b) => b.unlock === this.level).map((b) => b.name);
      this.toast(`Level ${this.level}!${unlocked ? ` ${unlocked.name} freigeschaltet.` : ""}${newB.length ? ` Neu: ${newB.join(", ")}` : ""}`, "level");
    }
  }

  /* ============================================================== Aufgaben */

  questProgress(qd: QuestDef): { cur: number; target: number } {
    const c = qd.cond;
    switch (c.type) {
      case "build": return { cur: Math.min(c.count, this.count(c.building)), target: c.count };
      case "pop": return { cur: Math.min(c.n, Math.floor(this.pop)), target: c.n };
      case "stock": return { cur: Math.min(c.n, Math.floor(this.getTotalResource(c.res))), target: c.n };
      case "level": return { cur: Math.min(c.n, this.level), target: c.n };
      case "prod": return { cur: Math.min(c.n, Math.round(this.prod[c.res] * 10) / 10), target: c.n };
      case "military": return { cur: Math.min(c.n, this.military), target: c.n };
      case "research": return { cur: Math.min(c.n, this.research.done.length), target: c.n };
      case "trade": return { cur: Math.min(c.n, this.tradeCount), target: c.n };
    }
  }

  activeQuests(max = 5): QuestDef[] {
    return QUESTS.filter((q) => !this.questsDone.includes(q.id) && q.minLevel <= this.level).slice(0, max);
  }

  private checkQuests() {
    for (const qd of this.activeQuests(8)) {
      const p = this.questProgress(qd);
      if (p.cur >= p.target) {
        this.questsDone.push(qd.id);
        for (const [r, n] of Object.entries(qd.reward ?? {}) as [ResId, number][]) this.depositResource(r, n);
        this.toast(`Aufgabe erfüllt: ${qd.title} (+${qd.xp} EP)`, "good");
        this.addXp(qd.xp);
      }
    }
  }

  /* ========================================================= Forschung/Handel */

  canResearch(id: string): string | null {
    const t = TECHS.find((x) => x.id === id);
    if (!t) return "Unbekannt";
    if (this.research.done.includes(id)) return "Bereits erforscht";
    if (this.research.active) return "Es wird bereits geforscht";
    if (this.level < t.minLevel) return `Ab Level ${t.minLevel}`;
    for (const [r, n] of Object.entries(t.cost) as [ResId, number][]) if (this.getSpendableResource(r) < n) return `Nicht genug ${RESOURCES[r].name}`;
    return null;
  }

  startResearch(id: string): boolean {
    const why = this.canResearch(id);
    if (why) { this.toast(why, "warn"); this.notify(); return false; }
    const t = TECHS.find((x) => x.id === id)!;
    this.consumeCost(t.cost);
    this.research.active = { id, remaining: t.time };
    this.toast(`Forschung gestartet: ${t.name}`, "info");
    this.notify();
    return true;
  }

  marketActive(): boolean { return this.buildings.some((b) => b.type === "market" && b.built && b.connected && b.workers > 0); }
  tradePrice(res: ResId, mode: "buy" | "sell"): number {
    const d = this.hasTech("trade") ? 0.15 : 0;
    const base = RESOURCES[res].price;
    return mode === "buy" ? base * 1.4 * (1 - d) : base * 0.7 * (1 + d);
  }
  trade(res: ResId, amount: number, mode: "buy" | "sell"): string | null {
    if (res === "gold") return "Gold ist die Handelswährung.";
    if (!this.marketActive()) return "Kein besetzter Marktplatz vorhanden.";
    const unit = this.tradePrice(res, mode);
    if (mode === "sell") {
      const n = Math.min(amount, Math.floor(this.getSpendableResource(res)));
      if (n <= 0) return `Kein ${RESOURCES[res].name} im Lager.`;
      const gain = Math.floor(unit * n);
      if (gain <= 0) return "Menge zu klein.";
      this.consumeResource(res, n);
      this.depositResource("gold", gain);
    } else {
      let free = 0;
      for (const h of this.hubs) free += getAvailableInputCapacity(this, h, res);
      const n = Math.min(amount, Math.floor(free));
      if (n <= 0) return "Lager voll.";
      const cost = Math.ceil(unit * n);
      if (!this.consumeResource("gold", cost)) return "Nicht genug Gold.";
      this.depositResource(res, n);
    }
    this.tradeCount++;
    this.notify();
    return null;
  }

  /* ========================================================== Auswertungen */

  depositInfo(b: Building) { return depositInfo(this, b); }
  treeStage(i: number) { return treeStage(this, i); }
  siteInfo(b: Building) { return b.built ? null : { state: siteState(this, b), materials: materialFraction(b), required: constructionMaterials(b.type) }; }
  cancelTransport(id: number): boolean { const ok = cancelOrder(this, id); if (ok) this.notify(); return ok; }
  /** Aufträge, die ein Gebäude betreffen (aktiv + zuletzt abgeschlossene) */
  ordersOf(id: number): TransportOrder[] {
    return [...this.transportArchive.filter((o) => o.sourceBuildingId === id || o.targetBuildingId === id).slice(-2), ...this.transportOrders.filter((o) => o.sourceBuildingId === id || o.targetBuildingId === id).slice(0, 4)];
  }

  /** Verbrauchs-/Produktionsraten eines Verarbeiters (pro Minute) bei aktueller Effizienz */
  buildingRates(b: Building): { inputs: [ResId, number][]; outputs: [ResId, number][] } {
    const def = BUILDINGS[b.type];
    if (!def.recipe || !b.built) return { inputs: [], outputs: [] };
    const f = (60 / def.recipe.cycle) * Math.max(b.eff, 0);
    return {
      inputs: (Object.entries(def.recipe.inputs) as [ResId, number][]).map(([r, n]) => [r, n * f]),
      outputs: (Object.entries(def.recipe.outputs) as [ResId, number][]).map(([r, n]) => [r, n * f]),
    };
  }

  /** Engpass-Analyse für die Wirtschaftsübersicht */
  bottlenecks(): Bottleneck[] {
    const out: Bottleneck[] = [];
    const groups = new Map<string, { def: BuildingDef; status: BStatus; n: number; missing: ResId | null }>();
    for (const b of this.buildings) {
      if (b.status === "ok" || b.status === "constructing") continue;
      const key = `${b.type}|${b.status}|${b.missing ?? ""}`;
      const g = groups.get(key);
      if (g) g.n++;
      else groups.set(key, { def: BUILDINGS[b.type], status: b.status, n: 1, missing: b.missing });
    }
    groups.forEach((g) => {
      const miss = g.missing ? `: ${RESOURCES[g.missing].name} fehlt` : "";
      out.push({ sev: g.status === "no_input" || g.status === "no_site" || g.status === "no_road" ? "bad" : "warn", text: `${g.n}× ${g.def.name} – ${STATUS_TEXT[g.status].label}${miss}` });
    });
    if (this.foodStatus !== "ok") out.push({ sev: "bad", text: this.foodStatus === "starving" ? "Die Bevölkerung hungert! Brot/Getreide fehlt." : "Nahrung reicht nicht für alle." });
    const unfilled = JOB_IDS.reduce((s, j) => s + Math.max(0, this.byJob[j].needed - this.byJob[j].filled), 0);
    if (unfilled >= 1) out.push({ sev: "warn", text: `${Math.round(unfilled)} Arbeitsplätze unbesetzt – mehr Wohnraum/Einwohner nötig.` });
    if (this.pop >= this.popCap - 0.5 && this.popCap > 0 && this.foodStatus === "ok") out.push({ sev: "warn", text: "Wohnraum voll – baue weitere Häuser." });
    const lg = this.logistics();
    if (lg.waiting > Math.max(2, lg.carriers)) out.push({ sev: "warn", text: `Träger-Engpass: ${lg.waiting} Transporte warten, nur ${lg.carriers} Träger (Lagerhaus ausbauen / mehr Einwohner).` });
    if (lg.blockedRoute > 0) out.push({ sev: "bad", text: `${lg.blockedRoute} Transport(e) ohne Straßenverbindung blockiert.` });
    for (const b of this.buildings) if (!b.built && !isInstant(b) && b.siteState === "NO_ROAD") { out.push({ sev: "bad", text: `Baustelle ${BUILDINGS[b.type].name}: keine Straßenanbindung für Material.` }); break; }
    for (const r of RES_IDS) {
      if (this.res[r] < 1 && this.cons[r] > 0.05) out.push({ sev: "bad", text: `${RESOURCES[r].name}: Bestand leer (Verbrauch ${this.cons[r].toFixed(1)}/min)` });
      else if (this.res[r] >= this.limit[r] * 0.98 && this.prod[r] > 0.05) out.push({ sev: "warn", text: `${RESOURCES[r].name}: Lager voll – Lagerhaus bauen oder verarbeiten.` });
    }
    return out;
  }

  get jobsSummary() { return JOB_IDS.map((j) => ({ id: j, name: JOBS[j].name, icon: JOBS[j].icon, ...this.byJob[j] })); }
  get nextXp() { return xpToNext(this.level); }

  /* ================================================================ Audit */

  /**
   * Prüft die Invarianten der physischen Simulation und liefert Verstöße (leer = konsistent):
   * keine negativen/überlaufenden Lager, keine verwaisten Reservierungen, endliche Einwohner, Kapazität von Wohnungen.
   */
  audit(): string[] {
    const bad: string[] = [];
    const expOut = new Map<number, Partial<Record<ResId, number>>>(), expIn = new Map<number, Partial<Record<ResId, number>>>();
    for (const o of this.transportOrders) {
      if (o.srcReserved && o.sourceBuildingId !== null) { const m = expOut.get(o.sourceBuildingId) ?? {}; m[o.resource] = (m[o.resource] ?? 0) + o.amount; expOut.set(o.sourceBuildingId, m); }
      if (o.dstReserved && o.targetBuildingId !== null) { const m = expIn.get(o.targetBuildingId) ?? {}; m[o.resource] = (m[o.resource] ?? 0) + o.amount; expIn.set(o.targetBuildingId, m); }
    }
    for (const b of this.buildings) {
      const p = b.physical;
      if (!p) continue;
      for (const [side, s] of [["input", p.input], ["output", p.output]] as const) for (const r of RES_IDS) {
        const n = amountOf(s, r);
        if ((s[r] ?? 0) < -1e-9) bad.push(`#${b.id} ${b.type} ${side} ${r} negativ`);
        if (!isHub(b) && n > getCapacity(this, b, side, r) + 1e-6 && !(side === "output" && !b.built)) bad.push(`#${b.id} ${b.type} ${side} ${r} über Kapazität (${n})`);
      }
      for (const r of RES_IDS) {
        if (Math.abs(amountOf(p.reservedOutput, r) - amountOf(expOut.get(b.id) ?? {}, r)) > 1e-6) bad.push(`#${b.id} ${b.type} verwaiste Ausgangsreservierung ${r}`);
        if (Math.abs(amountOf(p.reservedInput, r) - amountOf(expIn.get(b.id) ?? {}, r)) > 1e-6) bad.push(`#${b.id} ${b.type} verwaiste Eingangsreservierung ${r}`);
        if (amountOf(p.reservedOutput, r) > getStored(b, "output", r) + 1e-6) bad.push(`#${b.id} ${b.type} mehr Reservierung als Bestand ${r}`);
      }
    }
    if (this.residents.length !== Math.floor(this.pop)) bad.push(`Einwohnerzahl ${this.residents.length} ≠ Bevölkerung ${Math.floor(this.pop)}`);
    const live = new Set(this.residents.map((r) => r.id));
    for (const o of this.transportOrders) if (o.carrierId !== null && !live.has(o.carrierId)) bad.push(`Auftrag #${o.id} ohne lebenden Träger`);
    const homeUse = new Map<number, number>();
    for (const r of this.residents) if (r.homeBuildingId !== null) homeUse.set(r.homeBuildingId, (homeUse.get(r.homeBuildingId) ?? 0) + 1);
    for (const [id, n] of homeUse) { const h = this.getBuilding(id); if (!h || n > (BUILDINGS[h.type].housing ?? 0)) bad.push(`Haus #${id} überbelegt (${n})`); }
    const work = new Map<string, number>();
    for (const r of this.residents) if (r.workplaceId !== null) work.set(`${r.workplaceId}|${r.job}`, (work.get(`${r.workplaceId}|${r.job}`) ?? 0) + 1);
    for (const [k, n] of work) { const [id, job] = k.split("|"); const b = this.getBuilding(Number(id)); if (!b) bad.push(`Arbeitsplatz #${id} existiert nicht`); else if (n > (b.crew[job as JobId] ?? 0) + 2) bad.push(`Arbeitsplatz #${id} ${job} überbesetzt (${n})`); }
    if (this.transportOrders.some((o) => !ACTIVE_STATUSES.includes(o.status))) bad.push("Abgeschlossene Aufträge im aktiven Array");
    if (this.transportArchive.length > TRANSPORT.archiveSize) bad.push("Archiv wächst unbegrenzt");
    return bad;
  }

  /** Straßen-Kachel-Test für Tests/Renderer */
  isRoad(x: number, y: number) { return isRoadTile(this, x, y); }
}
