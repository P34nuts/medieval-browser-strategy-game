/**
 * GameEngine – die komplette Spielsimulation (ohne DOM, daher headless testbar).
 *
 * Verantwortlich für: Karte, Gebäude, Bauen/Abriss, Straßennetz, Arbeiter, Produktion,
 * Verbrauch, Bevölkerung, Forschung, Handel, Aufgaben, Level, Speichern/Laden.
 *
 * Die Simulation läuft in festen Schritten (SIM_STEP Sekunden); `update(dt)` wird vom
 * Renderer pro Frame aufgerufen. UI-Komponenten lesen den Zustand direkt und werden über
 * `subscribe` / `version` informiert (ca. 4× pro Sekunde, sowie nach jeder Aktion).
 */
import {
  BUILDINGS, DEPOSIT_RES, DEPOSIT_YIELD, JOBS, JOB_IDS, QUESTS, RESOURCES, RES_IDS, T, TECHS, UPGRADE_LEVELS, xpToNext,
  LEVEL_UNLOCKS, MAP_SIZE, STATUS_TEXT,
  type BStatus, type BuildingDef, type BuildingId, type JobId, type QuestDef, type ResId,
} from "./data";
import { generateMap, type MapData } from "./mapgen";
import {
  addStorage, findPath, findRoadPath, storageAmount, takeStorage,
  type FieldState, type PhysicalBuildingState, type Resident, type TransportOrder,
} from "./physical";

const SIM_STEP = 0.5;
/** Anteil der Einwohner, der arbeiten kann (Rest: Kinder, Alte) */
const WORKER_SHARE = 0.85;
/** Nahrungsbedarf pro Einwohner und Minute */
const FOOD_PER_CAPITA = 0.12;
const SOLDIERS_PER_BARRACKS = 10;

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
  connected: boolean;
  /** Standortqualität 0..1 */
  site: number;
  /** Gesamteffizienz 0..1+ */
  eff: number;
  mineRes: ResId | null;
  missing: ResId | null;
  /** Physische Wirtschaft: lokale Lager und Gebäudezustand werden separat vom globalen HUD geführt. */
  physical?: PhysicalBuildingState;
  field?: FieldState;
  rotation: 0 | 1 | 2 | 3;
}

export interface Toast { id: number; text: string; kind: "info" | "good" | "warn" | "level"; t: number }
export interface PlaceCheck { ok: boolean; reason: string | null; site: number | null; mineRes: ResId | null }
export interface Ghost { x: number; y: number; check: PlaceCheck }
export interface Bottleneck { sev: "bad" | "warn"; text: string }

export interface SaveData {
  v: number;
  seed: number;
  buildings: { t: BuildingId; x: number; y: number; p: number; r?: 0 | 1 | 2 | 3 }[];
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
  reservedTrees?: Record<string, number>;
  fieldStates?: Record<string, FieldState>;
  depositRemaining?: Record<string, number>;
}

type ResMap = Record<ResId, number>;
const zeroRes = (): ResMap => Object.fromEntries(RES_IDS.map((r) => [r, 0])) as ResMap;

export class GameEngine {
  map: MapData;
  seed: number;
  buildings: Building[] = [];
  /** Belegung: Gebäude-ID je Kachel (0 = frei) */
  occ: Int32Array;
  private roadReach: Uint8Array;
  private byId = new Map<number, Building>();
  private nextId = 1;

  res: ResMap = zeroRes();
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

  /* --- UI-Zustand (Interaktion) --- */
  ui: { buildType: BuildingId | null; selectedId: number | null; ghost: Ghost | null; buildRotation: 0 | 1 | 2 | 3 } = {
    buildType: null, selectedId: null, ghost: null, buildRotation: 0,
  };
  toasts: Toast[] = [];
  version = 0;
  dirtyFlag = true;

  private listeners = new Set<() => void>();
  private acc = 0;
  private notifyAcc = 0;
  private toastId = 1;
  private flowProd = zeroRes();
  private flowCons = zeroRes();
  private clock = 0;
  residents: Resident[] = [];
  transportOrders: TransportOrder[] = [];
  harvestedTrees = new Set<number>();
  private nextResidentId = 1;
  private nextTransportId = 1;
  private physicalClock = 0;
  simulationSpeed: 0 | 1 | 2 = 1;
  treeGrowth = new Map<number, number>();
  reservedTrees = new Map<number, number>();
  depositRemaining = new Map<number, number>();

  private constructor(seed: number) {
    this.seed = seed;
    this.map = generateMap(seed);
    this.occ = new Int32Array(MAP_SIZE * MAP_SIZE);
    this.roadReach = new Uint8Array(MAP_SIZE * MAP_SIZE);
  }

  /* ================================================================ Erzeugen */

  /** Neues Spiel: kleine Siedlung mit Lagerhaus, Straße und zwei Häusern */
  static newGame(seed: number): GameEngine {
    const g = new GameEngine(seed);
    g.res = { ...zeroRes(), holz: 150, stein: 80, bretter: 20, getreide: 150, brot: 50, gold: 50 };
    const c = MAP_SIZE / 2;
    g.addBuilding("warehouse", c - 1, c - 2, true);
    for (let x = c - 3; x <= c + 4; x++) g.addBuilding("road", x, c + 1, true);
    g.addBuilding("house_s", c - 2, c + 2, true);
    g.addBuilding("house_s", c, c + 2, true);
    g.pop = 8;
    g.recompute();
    g.computeStats();
    return g;
  }

  /** Spielstand laden (validiert, damit defekte Saves die Engine nicht zerstören) */
  static load(data: SaveData): GameEngine {
    const g = new GameEngine(Math.floor(Number(data.seed)) || 1);
    const num = (v: unknown, d: number) => (typeof v === "number" && isFinite(v) ? v : d);
    for (const r of RES_IDS) g.res[r] = Math.max(0, num(data.res?.[r], 0));
    g.xp = Math.max(0, num(data.xp, 0));
    g.level = Math.max(1, Math.floor(num(data.level, 1)));
    g.pop = Math.max(0, num(data.pop, 0));
    g.soldiers = Math.max(0, num(data.soldiers, 0));
    g.playTime = Math.max(0, num(data.playTime, 0));
    g.tradeCount = Math.max(0, Math.floor(num(data.tradeCount, 0)));
    if (Array.isArray(data.harvestedTrees)) for (const i of data.harvestedTrees) if (Number.isInteger(i) && i >= 0 && i < MAP_SIZE * MAP_SIZE) g.harvestedTrees.add(i);
    if (data.treeGrowth && typeof data.treeGrowth === "object") for (const [k, v] of Object.entries(data.treeGrowth)) { const i = Number(k), n = Number(v); if (Number.isInteger(i) && Number.isFinite(n) && i >= 0 && i < MAP_SIZE * MAP_SIZE) g.treeGrowth.set(i, Math.max(0, Math.min(3, Math.floor(n)))); }
    if (data.reservedTrees && typeof data.reservedTrees === "object") for (const [k, v] of Object.entries(data.reservedTrees)) { const i = Number(k), n = Number(v); if (Number.isInteger(i) && Number.isInteger(n)) g.reservedTrees.set(i, n); }
    if (data.depositRemaining && typeof data.depositRemaining === "object") for (const [k, v] of Object.entries(data.depositRemaining)) { const i = Number(k), n = Number(v); if (Number.isInteger(i) && Number.isFinite(n) && i >= 0 && i < MAP_SIZE * MAP_SIZE) g.depositRemaining.set(i, Math.max(0, n)); }
    if (Array.isArray(data.residents)) {
      g.residents = data.residents.filter((r) => r && Number.isFinite(r.id) && Number.isFinite(r.x) && Number.isFinite(r.y)).map((r) => ({ ...r, path: Array.isArray(r.path) ? r.path : [], carrying: r.carrying ?? null }));
      g.nextResidentId = Math.max(1, ...g.residents.map((r) => r.id + 1));
    }
    if (Array.isArray(data.transportOrders)) {
      g.transportOrders = data.transportOrders.filter((o) => o && Number.isFinite(o.id) && typeof o.resource === "string");
      g.nextTransportId = Math.max(1, ...g.transportOrders.map((o) => o.id + 1));
    }
    g.questsDone = Array.isArray(data.questsDone) ? data.questsDone.filter((x) => QUESTS.some((q) => q.id === x)) : [];
    const done = Array.isArray(data.research?.done) ? data.research.done.filter((id) => TECHS.some((t) => t.id === id)) : [];
    const act = data.research?.active;
    g.research = {
      done,
      active: act && TECHS.some((t) => t.id === act.id) ? { id: act.id, remaining: Math.max(0, num(act.remaining, 1)) } : null,
    };
    for (const b of Array.isArray(data.buildings) ? data.buildings : []) {
      if (!BUILDINGS[b.t]) continue;
      if (!g.terrainFree(b.t, Math.floor(b.x), Math.floor(b.y))) continue;
      const rotation = b.r === 1 || b.r === 2 || b.r === 3 ? b.r : 0;
      const nb = g.addBuilding(b.t, Math.floor(b.x), Math.floor(b.y), num(b.p, 1) >= 1, rotation);
      if (nb && !nb.built) nb.progress = Math.max(0, Math.min(0.99, num(b.p, 0)));
    }
    if (data.localStorage && typeof data.localStorage === "object") {
      for (const b of g.buildings) {
        const saved = data.localStorage[String(b.id)];
        if (saved && typeof saved === "object" && b.physical) {
          const savedState = saved as Partial<PhysicalBuildingState>;
          if (savedState.input && typeof savedState.input === "object") b.physical.input = savedState.input;
          if (savedState.output && typeof savedState.output === "object") b.physical.output = savedState.output;
          if (typeof savedState.production === "string") b.physical.production = savedState.production;
          if (Number.isFinite(savedState.productionProgress)) b.physical.productionProgress = Math.max(0, Math.min(1, Number(savedState.productionProgress)));
          if (savedState.rotation === 0 || savedState.rotation === 1 || savedState.rotation === 2 || savedState.rotation === 3) b.physical.rotation = savedState.rotation;
          if (savedState.level === 1 || savedState.level === 2 || savedState.level === 3) b.physical.level = savedState.level;
        }
      }
    }
    if (data.fieldStates && typeof data.fieldStates === "object") for (const b of g.buildings) {
      const field = data.fieldStates[String(b.id)];
      if (field && b.field) b.field = { ...b.field, ...field, progress: Math.max(0, Number(field.progress) || 0) };
    }
    g.recompute();
    g.computeStats();
    return g;
  }

  serialize(): SaveData {
    return {
      v: 3,
      seed: this.seed,
      buildings: this.buildings.map((b) => ({ t: b.type, x: b.x, y: b.y, p: b.built ? 1 : Math.round(b.progress * 1000) / 1000, r: b.rotation })),
      res: Object.fromEntries(RES_IDS.map((r) => [r, Math.round(this.res[r] * 100) / 100])),
      xp: Math.round(this.xp * 100) / 100,
      level: this.level,
      pop: Math.round(this.pop * 100) / 100,
      soldiers: Math.round(this.soldiers * 100) / 100,
      playTime: Math.round(this.playTime),
      research: this.research,
      questsDone: this.questsDone,
      tradeCount: this.tradeCount,
      residents: this.residents,
      transportOrders: this.transportOrders,
      localStorage: Object.fromEntries(this.buildings.filter((b) => b.physical).map((b) => [b.id, b.physical!])),
      harvestedTrees: [...this.harvestedTrees],
      treeGrowth: Object.fromEntries(this.treeGrowth),
      reservedTrees: Object.fromEntries(this.reservedTrees),
      fieldStates: Object.fromEntries(this.buildings.filter((b) => b.field).map((b) => [b.id, b.field!])),
      depositRemaining: Object.fromEntries(this.depositRemaining),
    };
  }

  /* ============================================================ Abonnements */
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };
  private notify() {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  setSimulationSpeed(speed: 0 | 1 | 2) { this.simulationSpeed = speed; this.notify(); }

  toast(text: string, kind: Toast["kind"] = "info") {
    this.toasts.push({ id: this.toastId++, text, kind, t: this.clock });
    if (this.toasts.length > 5) this.toasts.shift();
  }

  /* ================================================================== Bauen */

  private idx(x: number, y: number) { return y * MAP_SIZE + x; }
  private inb(x: number, y: number) { return x >= 0 && y >= 0 && x < MAP_SIZE && y < MAP_SIZE; }

  /** Kachel-Gelände + Belegung prüfen (ohne Kosten/Level) */
  private footprint(type: BuildingId, rotation: 0 | 1 | 2 | 3 = 0): [number, number] { const [w, h] = BUILDINGS[type].size; return rotation % 2 ? [h, w] : [w, h]; }
  private terrainFree(type: BuildingId, x: number, y: number, rotation: 0 | 1 | 2 | 3 = 0): boolean {
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

  private addBuilding(type: BuildingId, x: number, y: number, built: boolean, rotation: 0 | 1 | 2 | 3 = 0): Building | null {
    if (!this.terrainFree(type, x, y, rotation)) return null;
    const def = BUILDINGS[type];
    const b: Building = {
      id: this.nextId++, type, x, y, progress: built ? 1 : 0, built,
      status: built ? "ok" : "constructing", workers: 0, connected: false, site: 1, eff: 0, mineRes: null, missing: null, rotation,
    };
    if (["lumberjack", "forester", "sawmill", "warehouse", "farm", "mill", "bakery", "quarry", "mine"].includes(type)) b.physical = this.defaultPhysicalState();
    if (type === "field") b.field = { stage: "EMPTY", progress: 0, crop: "getreide", farmerId: null, yieldAmount: 2 };
    this.buildings.push(b);
    this.byId.set(b.id, b);
    const [w, h] = this.footprint(type, rotation);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.occ[this.idx(x + i, y + j)] = b.id;
    this.dirtyFlag = true;
    return b;
  }

  private defaultPhysicalState(): PhysicalBuildingState {
    return { input: {}, output: {}, production: "WAITING_FOR_INPUT", productionProgress: 0, rotation: 0, level: 1 };
  }

  getBuilding(id: number): Building | undefined { return this.byId.get(id); }
  canUpgrade(id: number): { ok: boolean; reason?: string; level?: 2 | 3; cost?: Partial<Record<ResId, number>> } {
    const b = this.getBuilding(id), current = b?.physical?.level ?? 1, next = (current + 1) as 2 | 3, spec = b ? UPGRADE_LEVELS[b.type]?.[next] : undefined;
    if (!b || !b.built || !b.physical || !spec) return { ok: false, reason: current >= 3 ? "Maximale Stufe erreicht" : "Gebäude nicht upgradefähig" };
    for (const [r, n] of Object.entries(spec.cost) as [ResId, number][]) if (this.res[r] < n) return { ok: false, reason: `Nicht genug ${RESOURCES[r].name}`, level: next, cost: spec.cost };
    return { ok: true, level: next, cost: spec.cost };
  }
  upgradeBuilding(id: number): { ok: boolean; reason?: string } {
    const check = this.canUpgrade(id); if (!check.ok || !check.level || !check.cost) return { ok: false, reason: check.reason };
    const b = this.getBuilding(id)!; for (const [r, n] of Object.entries(check.cost) as [ResId, number][]) this.res[r] -= n;
    b.physical!.level = check.level; this.dirtyFlag = true; this.recompute(); this.toast(`${BUILDINGS[b.type].name} auf Stufe ${check.level} verbessert`, "good"); this.notify(); return { ok: true };
  }
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
    // Mine: häufigstes Vorkommen bestimmt das Erz
    let best = 1;
    for (const k of [1, 2, 3]) if (counts[k] > counts[best]) best = k;
    const n = counts[best];
    return { factor: Math.min(1, n / s.full), mineRes: n > 0 ? DEPOSIT_RES[best] : null };
  }

  checkPlace(type: BuildingId, x: number, y: number, rotation: 0 | 1 | 2 | 3 = this.ui.buildRotation): PlaceCheck {
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
    if (def.site && def.site.kind !== "fields" && factor <= 0) {
      return { ok: false, reason: `Keine ${def.site.label} in Reichweite`, site: 0, mineRes };
    }
    for (const [r, n] of Object.entries(def.cost) as [ResId, number][]) {
      if (this.res[r] < n) return { ok: false, reason: `Nicht genug ${RESOURCES[r].name}`, site: def.site ? factor : null, mineRes };
    }
    return { ok: true, reason: null, site: def.site ? factor : null, mineRes };
  }

  /** Gebäude platzieren und Kosten abziehen */
  place(type: BuildingId, x: number, y: number, rotation: 0 | 1 | 2 | 3 = this.ui.buildRotation): PlaceCheck {
    const check = this.checkPlace(type, x, y, rotation);
    if (!check.ok) return check;
    for (const [r, n] of Object.entries(BUILDINGS[type].cost) as [ResId, number][]) this.res[r] -= n;
    this.addBuilding(type, x, y, false, rotation);
    this.notify();
    return check;
  }

  /** Abriss mit 50 % Rückerstattung (Fundament des letzten Lagerhauses bleibt geschützt) */
  demolish(id: number): { ok: boolean; reason?: string } {
    const b = this.byId.get(id);
    if (!b) return { ok: false, reason: "Nicht gefunden" };
    const def = BUILDINGS[b.type];
    if (def.hub && this.buildings.filter((o) => BUILDINGS[o.type].hub && o.id !== id).length === 0)
      return { ok: false, reason: "Das letzte Lagerhaus kann nicht abgerissen werden." };
    for (const [r, n] of Object.entries(def.cost) as [ResId, number][]) {
      this.res[r] = Math.min(this.limit[r] || Infinity, this.res[r] + Math.floor(n * 0.5));
    }
    const [w, h] = this.footprint(b.type, b.rotation);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.occ[this.idx(b.x + i, b.y + j)] = 0;
    this.buildings = this.buildings.filter((o) => o.id !== id);
    this.byId.delete(id);
    if (this.ui.selectedId === id) this.ui.selectedId = null;
    this.dirtyFlag = true;
    this.recompute();
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
  rotateBuild() { this.ui.buildRotation = ((this.ui.buildRotation + 1) % 4) as 0 | 1 | 2 | 3; const g = this.ui.ghost; if (g && this.ui.buildType) g.check = this.checkPlace(this.ui.buildType, g.x, g.y); this.notify(); }
  rotateBuilding(id: number): boolean { const b = this.getBuilding(id); if (!b || b.type === "road" || b.type === "field") return false; const next = ((b.rotation + 1) % 4) as 0 | 1 | 2 | 3; const [oldW, oldH] = this.footprint(b.type, b.rotation); const [newW, newH] = this.footprint(b.type, next); for (let j = 0; j < oldH; j++) for (let i = 0; i < oldW; i++) this.occ[this.idx(b.x + i, b.y + j)] = 0; const ok = this.terrainFree(b.type, b.x, b.y, next); if (!ok) { for (let j = 0; j < oldH; j++) for (let i = 0; i < oldW; i++) this.occ[this.idx(b.x + i, b.y + j)] = b.id; return false; } b.rotation = next; if (b.physical) b.physical.rotation = next; for (let j = 0; j < newH; j++) for (let i = 0; i < newW; i++) this.occ[this.idx(b.x + i, b.y + j)] = b.id; this.dirtyFlag = true; this.recompute(); this.notify(); return true; }

  /** Ghost-Position setzen (Ankerkachel = linke obere Ecke der Grundfläche) */
  setGhost(x: number, y: number) {
    const t = this.ui.buildType;
    if (!t) return;
    const g = this.ui.ghost;
    if (g && g.x === x && g.y === y) { g.check = this.checkPlace(t, x, y); return; }
    this.ui.ghost = { x, y, check: this.checkPlace(t, x, y) };
    this.notify();
  }
  clearGhost() { if (this.ui.ghost) { this.ui.ghost = null; this.notify(); } }

  /** Platziert das aktuelle Ghost (Bestätigen-Button / Doppeltipp) */
  confirmGhost(): PlaceCheck | null {
    const t = this.ui.buildType, g = this.ui.ghost;
    if (!t || !g) return null;
    const r = this.place(t, g.x, g.y);
    if (!r.ok && r.reason) this.toast(r.reason, "warn");
    g.check = this.checkPlace(t, g.x, g.y);
    return r;
  }

  /* ==================================================== Netz & Ableitungen */

  /** Straßennetz, Standortqualität, Limits neu berechnen (bei Strukturänderung) */
  recompute() {
    const N = MAP_SIZE;
    const reach = this.roadReach;
    reach.fill(0);
    const isRoad = (i: number) => {
      const b = this.byId.get(this.occ[i]);
      return !!b && b.type === "road" && b.built;
    };
    const queue: number[] = [];
    const perimeter = (b: Building, fn: (i: number) => void) => {
      const [w, h] = this.footprint(b.type, b.rotation);
      for (let i = 0; i < w; i++) { if (this.inb(b.x + i, b.y - 1)) fn(this.idx(b.x + i, b.y - 1)); if (this.inb(b.x + i, b.y + h)) fn(this.idx(b.x + i, b.y + h)); }
      for (let j = 0; j < h; j++) { if (this.inb(b.x - 1, b.y + j)) fn(this.idx(b.x - 1, b.y + j)); if (this.inb(b.x + w, b.y + j)) fn(this.idx(b.x + w, b.y + j)); }
    };
    for (const b of this.buildings) {
      if (!b.built || !BUILDINGS[b.type].hub) continue;
      perimeter(b, (i) => { if (!reach[i] && isRoad(i)) { reach[i] = 1; queue.push(i); } });
    }
    while (queue.length) {
      const i = queue.pop()!;
      const x = i % N, y = (i / N) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!this.inb(nx, ny)) continue;
        const ni = this.idx(nx, ny);
        if (!reach[ni] && isRoad(ni)) { reach[ni] = 1; queue.push(ni); }
      }
    }
    for (const b of this.buildings) {
      const def = BUILDINGS[b.type];
      if (def.hub) { b.connected = b.built; }
      else {
        let ok = false;
        perimeter(b, (i) => {
          if (ok) return;
          if (reach[i]) ok = true;
          else { const o = this.byId.get(this.occ[i]); if (o && o.built && BUILDINGS[o.type].hub) ok = true; }
        });
        b.connected = b.built && ok;
        if (b.type === "road") b.connected = !!reach[this.idx(b.x, b.y)];
      }
      const s = this.computeSite(b.type, b.x, b.y);
      b.site = s.factor;
      b.mineRes = s.mineRes;
    }
    // Lagerlimits
    let storage = 0;
    for (const b of this.buildings) if (b.built) storage += BUILDINGS[b.type].storage ?? 0;
    let mult = 1;
    for (const id of this.research.done) {
      const t = TECHS.find((x) => x.id === id);
      if (t?.effect.kind === "storage") mult += t.effect.mult;
    }
    for (const r of RES_IDS) this.limit[r] = Math.round((RESOURCES[r].limit + storage) * mult);
    this.dirtyFlag = false;
  }

  private techProdMult(type: BuildingId): number {
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

  /** Bevölkerungskapazität, Arbeitsplätze und Militärstärke ableiten */
  computeStats() {
    let cap = 0;
    for (const b of this.buildings) {
      const def = BUILDINGS[b.type];
      if (b.built && def.housing && b.connected) cap += def.housing;
    }
    this.popCap = cap;
    this.workforce = Math.floor(this.pop) * WORKER_SHARE;
    for (const j of JOB_IDS) this.byJob[j] = { needed: 0, filled: 0 };
    let remaining = this.workforce;
    let mil = Math.floor(this.soldiers) * 2;
    for (const b of this.buildings) {
      b.workers = 0;
      if (!b.built) continue;
      const def = BUILDINGS[b.type];
      if (!def.jobs) continue;
      const upgrade = b.physical?.level === 2 || b.physical?.level === 3 ? UPGRADE_LEVELS[b.type]?.[b.physical.level] : undefined;
      const slots = def.jobs.count + (upgrade?.workerSlots ?? 0);
      this.byJob[def.jobs.job].needed += slots;
      if (def.needsRoad && !b.connected) continue;
      const w = Math.min(slots, remaining);
      b.workers = w;
      remaining -= w;
      this.byJob[def.jobs.job].filled += w;
      if (def.military) mil += def.military * (w / slots);
    }
    this.military = Math.round(mil);
  }

  private centerOf(b: Building): [number, number] {
    const [w, h] = this.footprint(b.type, b.rotation);
    const edge: [number, number][] = [];
    for (let i = 0; i < w; i++) edge.push([b.x + i, b.y - 1], [b.x + i, b.y + h]);
    for (let j = 0; j < h; j++) edge.push([b.x - 1, b.y + j], [b.x + w, b.y + j]);
    const side = ((b.physical?.rotation ?? b.rotation) + (BUILDINGS[b.type].accessSide ?? 2)) % 4;
    const road = edge.find(([x, y]) => { const r = this.inb(x, y) ? this.buildingAt(x, y) : undefined; return r?.type === "road" && r.connected; });
    if (road) return [road[0] + 0.5, road[1] + 0.5];
    return side === 0 ? [b.x + w / 2, b.y - 0.5] : side === 1 ? [b.x + w + 0.5, b.y + h / 2] : side === 3 ? [b.x - 0.5, b.y + h / 2] : [b.x + w / 2, b.y + h + 0.5];
  }

  private updatePhysical(dt: number) {
    this.physicalClock += dt;
    this.ensurePopulationEntities();
    this.updateTreeGrowth(dt);
    this.ensureDeposits();
    const active = this.buildings.filter((b) => b.built && b.physical && ["lumberjack", "forester", "sawmill", "farm", "mill", "bakery", "quarry", "mine"].includes(b.type));
    for (const b of active) {
      const wanted = b.workers;
      const existing = this.residents.filter((r) => r.workplaceId === b.id && r.job !== "träger").length;
      for (let i = existing; i < wanted; i++) {
        const resident = this.residents.find((r) => r.job === "unassigned" && r.workplaceId === null);
        const [x, y] = this.centerOf(b);
        if (resident) { resident.job = BUILDINGS[b.type].jobs?.job ?? "handwerker"; resident.workplaceId = b.id; resident.targetX = x; resident.targetY = y; }
      }
    }
    this.assignHomes();
    for (const resident of this.residents) {
      resident.animation += dt;
      if (resident.job === "träger") continue;
      const workplace = resident.workplaceId ? this.getBuilding(resident.workplaceId) : undefined;
      if (!workplace?.physical) continue;
      if (workplace.type === "lumberjack" || workplace.type === "forester") {
        if (resident.state === "IDLE") {
          const tree = workplace.type === "forester" ? this.nearestPlantingSpot(workplace, resident.x, resident.y) : this.nearestTree(resident.x, resident.y);
          if (tree) { resident.targetX = tree[0]; resident.targetY = tree[1]; this.reservedTrees.set(this.idx(Math.round(tree[0]), Math.round(tree[1])), resident.id); resident.path = findPath(this.map, this.buildings, [resident.x, resident.y], tree); resident.pathIndex = 0; resident.state = "FETCHING_RESOURCE"; }
        } else if (resident.state === "FETCHING_RESOURCE" && this.movePhysical(resident, dt)) {
          resident.workTimer += dt;
          if (resident.workTimer >= 2) { const treeId = this.idx(Math.round(resident.targetX), Math.round(resident.targetY)); this.reservedTrees.delete(treeId); if (workplace.type === "forester") { this.treeGrowth.set(treeId, 1); this.harvestedTrees.delete(treeId); } else { this.harvestedTrees.add(treeId); this.treeGrowth.set(treeId, 0); addStorage(workplace.physical.output, "holz", 1); this.prod.holz = Math.max(this.prod.holz, 30); } resident.workTimer = 0; resident.state = "WALKING_TO_WORK"; resident.path = findPath(this.map, this.buildings, [resident.x, resident.y], this.centerOf(workplace)); resident.pathIndex = 0; }
        } else if (resident.state === "WALKING_TO_WORK" && this.movePhysical(resident, dt)) resident.state = "IDLE";
      } else if (workplace.type === "quarry" || workplace.type === "mine") {
        const tileId = resident.workTargetId ?? this.nearestDeposit(workplace, resident.x, resident.y);
        if (tileId === null) { workplace.status = "depleted"; resident.state = "WAITING"; continue; }
        const tx = tileId % MAP_SIZE, ty = Math.floor(tileId / MAP_SIZE), resource: ResId = workplace.type === "quarry" ? "stein" : DEPOSIT_RES[this.map.deposit[tileId]] ?? "eisen";
        if (resident.state === "IDLE") { resident.workTargetId = tileId; resident.targetX = tx + 0.5; resident.targetY = ty + 0.5; resident.path = findPath(this.map, this.buildings, [resident.x, resident.y], [resident.targetX, resident.targetY]); resident.pathIndex = 0; resident.state = "FETCHING_RESOURCE"; }
        else if (resident.state === "FETCHING_RESOURCE" && this.movePhysical(resident, dt)) { resident.workTimer += dt; if (resident.workTimer >= 2) { const amount = Math.min(this.depositRemaining.get(tileId) ?? 0, workplace.type === "mine" && resource === "gold" ? 0.4 : 1); this.depositRemaining.set(tileId, Math.max(0, (this.depositRemaining.get(tileId) ?? 0) - amount)); addStorage(workplace.physical.output, resource, amount); this.prod[resource] = Math.max(this.prod[resource], amount * 60 / 2); if (this.depositInfo(workplace).remaining <= 0) workplace.status = "depleted"; resident.workTimer = 0; resident.state = "WALKING_TO_WORK"; resident.path = findPath(this.map, this.buildings, [resident.x, resident.y], this.centerOf(workplace)); resident.pathIndex = 0; } }
        else if (resident.state === "WALKING_TO_WORK" && this.movePhysical(resident, dt)) { resident.workTargetId = null; resident.state = "IDLE"; }
      } else if (workplace.type === "farm") {
        const field = resident.workTargetId ? this.getBuilding(resident.workTargetId) : this.nearestField(workplace, resident.x, resident.y);
        if (!field?.field) { resident.state = "WAITING"; continue; }
        if (resident.state === "IDLE") { resident.workTargetId = field.id; field.field.farmerId = resident.id; resident.targetX = field.x + 1; resident.targetY = field.y + 1; resident.path = findPath(this.map, this.buildings, [resident.x, resident.y], [resident.targetX, resident.targetY]); resident.pathIndex = 0; resident.state = "WALKING_TO_WORK"; }
        else if (resident.state === "WALKING_TO_WORK" && this.movePhysical(resident, dt)) resident.state = "WORKING";
        else if (resident.state === "WORKING") { const fs = field.field; if (fs.stage === "EMPTY") { fs.progress += dt; if (fs.progress >= 1) { fs.stage = "PLOWED"; fs.progress = 0; } } else if (fs.stage === "PLOWED") { fs.progress += dt; if (fs.progress >= 1) { fs.stage = "SOWN"; fs.progress = 0; } } else if (fs.stage === "SOWN") { fs.stage = "GROWING"; fs.progress = 0; } else if (fs.stage === "GROWING") { fs.progress += dt / 12; if (fs.progress >= 1) { fs.stage = "RIPE"; fs.progress = 0; } } else if (fs.stage === "RIPE") { fs.stage = "HARVESTING"; fs.progress = 0; } else if (fs.stage === "HARVESTING") { fs.progress += dt / 2; if (fs.progress >= 1) { addStorage(workplace.physical.output, "getreide", fs.yieldAmount); this.prod.getreide = Math.max(this.prod.getreide, 10); fs.stage = "EMPTY"; fs.progress = 0; fs.farmerId = null; resident.workTargetId = null; resident.state = "IDLE"; } } }
      } else if (["sawmill", "mill", "bakery"].includes(workplace.type)) {
        const recipe = workplace.type === "sawmill" ? { input: "holz" as ResId, output: "bretter" as ResId, amount: 2, cycle: 8 } : workplace.type === "mill" ? { input: "getreide" as ResId, output: "mehl" as ResId, amount: 2, cycle: 5 } : { input: "mehl" as ResId, output: "brot" as ResId, amount: 1, cycle: 4 };
        const input = storageAmount(workplace.physical.input, recipe.input), output = storageAmount(workplace.physical.output, recipe.output);
        if (input < recipe.amount) { workplace.physical.production = "WAITING_FOR_INPUT"; workplace.missing = recipe.input; resident.state = "WAITING"; }
        else if (output >= 10) { workplace.physical.production = "WAITING_FOR_PICKUP"; resident.state = "WAITING"; }
        else { workplace.physical.production = "PRODUCING"; resident.state = "WORKING"; workplace.physical.productionProgress += dt / recipe.cycle; if (workplace.physical.productionProgress >= 1) { takeStorage(workplace.physical.input, recipe.input, recipe.amount); addStorage(workplace.physical.output, recipe.output, 1); if (recipe.input === "holz") this.cons.holz = Math.max(this.cons.holz, 15); if (recipe.output === "bretter") this.prod.bretter = Math.max(this.prod.bretter, 7.5); if (recipe.output === "mehl") this.prod.mehl = Math.max(this.prod.mehl, 12); if (recipe.output === "brot") this.prod.brot = Math.max(this.prod.brot, 15); workplace.physical.productionProgress = 0; workplace.physical.production = "OUTPUT_READY"; } }
      }
    }
    for (const source of active) {
      if (source.type === "forester") continue;
      const target = source.type === "lumberjack" ? this.physicalBuilding("sawmill") : source.type === "farm" ? this.physicalBuilding("mill") : source.type === "mill" ? this.physicalBuilding("bakery") : ["sawmill", "bakery", "quarry", "mine"].includes(source.type) ? this.physicalBuilding("warehouse") : undefined;
      const resource: ResId = source.type === "lumberjack" ? "holz" : source.type === "farm" ? "getreide" : source.type === "mill" ? "mehl" : source.type === "sawmill" ? "bretter" : source.type === "bakery" ? "brot" : source.type === "quarry" ? "stein" : source.mineRes ?? "eisen";
      if (target && storageAmount(source.physical!.output, resource) >= 1 && !this.transportOrders.some((o) => o.sourceBuildingId === source.id && ["WAITING", "ASSIGNED", "PICKUP", "IN_TRANSIT"].includes(o.status))) this.transportOrders.push(this.makeOrder(resource, source, target));
    }
    for (const order of [...this.transportOrders].sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt)) this.updateTransport(order, dt);
  }

  private physicalBuilding(type: BuildingId): Building | undefined { return this.buildings.find((b) => b.built && b.type === type && b.physical); }
  private ensureDeposits() { for (let y = 0; y < MAP_SIZE; y++) for (let x = 0; x < MAP_SIZE; x++) { const i = this.idx(x, y); if (this.map.terrain[i] === T.MOUNTAIN && !this.depositRemaining.has(i)) this.depositRemaining.set(i, this.map.deposit[i] ? 8500 : 12000); } }
  private nearestDeposit(source: Building, x: number, y: number): number | null { let best: number | null = null, dBest = Infinity; const wanted = source.type === "quarry" ? "stone" : DEPOSIT_RES[source.mineRes ? ({ eisen: 1, kohle: 2, gold: 3 } as Record<string, number>)[source.mineRes] : 1] ?? "eisen"; for (let yy = 0; yy < MAP_SIZE; yy++) for (let xx = 0; xx < MAP_SIZE; xx++) { const i = this.idx(xx, yy), dep = this.map.deposit[i], resource = dep ? DEPOSIT_RES[dep] : "stone"; if (this.map.terrain[i] !== T.MOUNTAIN || (source.type === "mine" && resource !== wanted) || (this.depositRemaining.get(i) ?? 0) <= 0) continue; const d = Math.hypot(xx - x, yy - y); if (d < dBest) { dBest = d; best = i; } } return best; }
  depositInfo(source: Building): { resource: ResId; remaining: number } { const radius = BUILDINGS[source.type].site?.radius ?? 3; let remaining = 0; for (let y = Math.max(0, source.y - radius); y < Math.min(MAP_SIZE, source.y + radius + 2); y++) for (let x = Math.max(0, source.x - radius); x < Math.min(MAP_SIZE, source.x + radius + 2); x++) { const i = this.idx(x, y), dep = this.map.deposit[i], resource = source.type === "quarry" ? "stein" as ResId : DEPOSIT_RES[dep] ?? "eisen"; if (this.map.terrain[i] === T.MOUNTAIN && (source.type === "quarry" || resource === source.mineRes) && Math.hypot(x - source.x, y - source.y) <= radius) remaining += this.depositRemaining.get(i) ?? 0; } return { resource: source.type === "quarry" ? "stein" : source.mineRes ?? "eisen", remaining } }
  private nearestField(farm: Building, x: number, y: number): Building | undefined { return this.buildings.filter((b) => b.built && b.type === "field" && b.field && b.field.farmerId === null && Math.hypot(b.x - farm.x, b.y - farm.y) <= 7).sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0]; }
  private ensurePopulationEntities() { const wanted = Math.floor(this.pop); while (this.residents.filter((r) => r.job !== "träger").length < wanted) { const warehouse = this.physicalBuilding("warehouse"); const [x, y] = warehouse ? this.centerOf(warehouse) : [MAP_SIZE / 2, MAP_SIZE / 2]; this.residents.push({ id: this.nextResidentId++, x, y, homeBuildingId: null, job: "unassigned", workplaceId: null, state: "IDLE", targetX: x, targetY: y, speed: 2.2, path: [], pathIndex: 0, carrying: null, workTimer: 0, animation: 0 }); } }
  private assignHomes() { const capacity = new Map<number, number>(); for (const r of this.residents) if (r.job !== "träger" && r.homeBuildingId !== null) capacity.set(r.homeBuildingId, (capacity.get(r.homeBuildingId) ?? 0) + 1); for (const r of this.residents) if (r.job !== "träger" && r.homeBuildingId === null) { const home = this.buildings.find((b) => b.built && b.connected && !!BUILDINGS[b.type].housing && (capacity.get(b.id) ?? 0) < (BUILDINGS[b.type].housing ?? 0)); if (home) { r.homeBuildingId = home.id; capacity.set(home.id, (capacity.get(home.id) ?? 0) + 1); } } }
  private updateTreeGrowth(dt: number) { for (let y = 0; y < MAP_SIZE; y++) for (let x = 0; x < MAP_SIZE; x++) { const i = this.idx(x, y); if (this.map.terrain[i] !== T.FOREST) continue; const stage = this.treeGrowth.get(i) ?? (this.harvestedTrees.has(i) ? 0 : 3); if (stage < 3) { const next = Math.min(3, stage + dt / 120); this.treeGrowth.set(i, next); if (next >= 3) this.harvestedTrees.delete(i); } } }
  private nearestTree(x: number, y: number): [number, number] | null { let best: [number, number] | null = null, dBest = Infinity; for (let yy = 0; yy < MAP_SIZE; yy++) for (let xx = 0; xx < MAP_SIZE; xx++) { const i = this.idx(xx, yy), stage = this.treeGrowth.get(i) ?? (this.harvestedTrees.has(i) ? 0 : 3); if (this.map.terrain[i] !== T.FOREST || stage < 3 || this.reservedTrees.has(i)) continue; const d = Math.hypot(xx - x, yy - y); if (d < dBest) { dBest = d; best = [xx, yy]; } } return best; }
  private nearestPlantingSpot(b: Building, x: number, y: number): [number, number] | null { let best: [number, number] | null = null, dBest = Infinity; for (let yy = Math.max(0, b.y - 6); yy < Math.min(MAP_SIZE, b.y + 8); yy++) for (let xx = Math.max(0, b.x - 6); xx < Math.min(MAP_SIZE, b.x + 8); xx++) { const i = this.idx(xx, yy); if (this.map.terrain[i] !== T.FOREST || (this.treeGrowth.get(i) ?? (this.harvestedTrees.has(i) ? 0 : 3)) > 0 || this.reservedTrees.has(i)) continue; const d = Math.hypot(xx - x, yy - y); if (d < dBest) { dBest = d; best = [xx, yy]; } } return best; }
  private movePhysical(r: Resident, dt: number): boolean { const p = r.path[r.pathIndex]; if (!p) { r.x = r.targetX; r.y = r.targetY; return true; } const dx = p[0] + 0.5 - r.x, dy = p[1] + 0.5 - r.y, d = Math.hypot(dx, dy), step = r.speed * dt; if (d <= step) { r.x = p[0] + 0.5; r.y = p[1] + 0.5; r.pathIndex++; return r.pathIndex >= r.path.length; } r.x += dx / d * step; r.y += dy / d * step; return false; }
  private makeOrder(resource: ResId, source: Building, target: Building): TransportOrder {
    const reserved = source.physical!.reservedOutput ??= {};
    const targetReserved = target.physical!.reservedInput ??= {};
    if (storageAmount(source.physical!.output, resource) - storageAmount(reserved, resource) < 1) return { id: this.nextTransportId++, resource, amount: 0, start: this.centerOf(source), target: this.centerOf(target), priority: 1, status: "BLOCKED_TARGET_FULL", carrierId: null, createdAt: this.physicalClock, sourceBuildingId: source.id, targetBuildingId: target.id };
    addStorage(reserved, resource, 1); addStorage(targetReserved, resource, 1);
    return { id: this.nextTransportId++, resource, amount: 1, start: this.centerOf(source), target: this.centerOf(target), priority: 1, status: "WAITING", carrierId: null, createdAt: this.physicalClock, sourceBuildingId: source.id, targetBuildingId: target.id, reservedAmount: 1 };
  }
  private updateTransport(order: TransportOrder, dt: number) {
    if (["DELIVERED", "FAILED", "CANCELLED"].includes(order.status)) return;
    const source = order.sourceBuildingId ? this.getBuilding(order.sourceBuildingId) : undefined, target = order.targetBuildingId ? this.getBuilding(order.targetBuildingId) : undefined;
    if (!source?.physical || !target?.physical) { order.status = "FAILED"; return; }
    let carrier = order.carrierId ? this.residents.find((r) => r.id === order.carrierId) : undefined;
    const route = (from: [number, number], to: [number, number]) => findRoadPath(this.map, this.buildings, from, to);
    if (order.status === "BLOCKED_NO_ROUTE" && carrier) order.status = carrier.carrying ? "IN_TRANSIT" : "TO_PICKUP";
    if (!carrier) {
      carrier = this.residents.find((r) => r.job === "träger" && r.state === "IDLE" && this.buildingAt(Math.round(r.x), Math.round(r.y))?.type === "road");
      if (!carrier) { order.status = "WAITING_FOR_CARRIER"; carrier = { id: this.nextResidentId++, x: order.start[0], y: order.start[1], homeBuildingId: null, job: "träger", workplaceId: null, state: "WAITING", targetX: order.start[0], targetY: order.start[1], speed: 2.8, path: [], pathIndex: 0, carrying: null, workTimer: 0, animation: 0 }; this.residents.push(carrier); }
      order.carrierId = carrier.id;
    }
    const destination = carrier.carrying ? order.target : order.start;
    if (["WAITING", "WAITING_FOR_CARRIER", "ASSIGNED", "TO_PICKUP"].includes(order.status)) {
      const path = route([carrier.x, carrier.y], destination);
      if (!path.length && (Math.round(carrier.x) !== Math.round(destination[0]) || Math.round(carrier.y) !== Math.round(destination[1]))) { order.status = "BLOCKED_NO_ROUTE"; carrier.state = "WAITING"; return; }
      order.status = "TO_PICKUP"; carrier.path = path; carrier.pathIndex = 0; carrier.targetX = destination[0]; carrier.targetY = destination[1]; carrier.state = "TRANSPORTING";
      if (this.movePhysical(carrier, dt)) { order.status = "PICKING_UP"; }
    }
    if (order.status === "PICKING_UP") {
      const amount = takeStorage(source.physical.output, order.resource, order.amount);
      const reserved = source.physical.reservedOutput ??= {}; reserved[order.resource] = Math.max(0, storageAmount(reserved, order.resource) - (order.reservedAmount ?? order.amount));
      if (!amount) { order.status = "FAILED"; carrier.state = "IDLE"; return; }
      carrier.carrying = { resource: order.resource, amount }; order.amount = amount; order.status = "IN_TRANSIT"; carrier.state = "TRANSPORTING"; carrier.path = route([carrier.x, carrier.y], order.target); carrier.pathIndex = 0; carrier.targetX = order.target[0]; carrier.targetY = order.target[1];
      if (!carrier.path.length && (Math.round(carrier.x) !== Math.round(order.target[0]) || Math.round(carrier.y) !== Math.round(order.target[1]))) { order.status = "BLOCKED_NO_ROUTE"; return; }
    }
    if (order.status === "IN_TRANSIT") {
      const remainingPath = carrier.path.slice(carrier.pathIndex);
      const intact = remainingPath.every(([x, y]) => this.buildingAt(x, y)?.type === "road" || (x === Math.round(order.target[0]) && y === Math.round(order.target[1])));
      if (!intact) { order.status = "BLOCKED_NO_ROUTE"; carrier.state = "WAITING"; return; }
      if (!remainingPath.length) { const path = route([carrier.x, carrier.y], order.target); if (!path.length && (Math.round(carrier.x) !== Math.round(order.target[0]) || Math.round(carrier.y) !== Math.round(order.target[1]))) { order.status = "BLOCKED_NO_ROUTE"; carrier.state = "WAITING"; return; } carrier.path = path; carrier.pathIndex = 0; }
      carrier.targetX = order.target[0]; carrier.targetY = order.target[1];
      if (this.movePhysical(carrier, dt)) order.status = "DELIVERING";
    }
    if (order.status === "DELIVERING") { const reserved = target.physical.reservedInput ??= {}; reserved[order.resource] = Math.max(0, storageAmount(reserved, order.resource) - (order.reservedAmount ?? order.amount)); addStorage(target.type === "warehouse" ? target.physical.output : target.physical.input, order.resource, order.amount); if (target.type === "warehouse") this.res[order.resource] = Math.min(this.limit[order.resource], this.res[order.resource] + order.amount); carrier.carrying = null; carrier.state = "IDLE"; order.status = "DELIVERED"; }
  }

  cancelTransport(id: number): boolean {
    const order = this.transportOrders.find((o) => o.id === id);
    if (!order || ["DELIVERED", "FAILED", "CANCELLED"].includes(order.status)) return false;
    const source = order.sourceBuildingId ? this.getBuilding(order.sourceBuildingId) : undefined;
    const target = order.targetBuildingId ? this.getBuilding(order.targetBuildingId) : undefined;
    if (source?.physical?.reservedOutput) source.physical.reservedOutput[order.resource] = Math.max(0, storageAmount(source.physical.reservedOutput, order.resource) - (order.reservedAmount ?? order.amount));
    if (target?.physical?.reservedInput) target.physical.reservedInput[order.resource] = Math.max(0, storageAmount(target.physical.reservedInput, order.resource) - (order.reservedAmount ?? order.amount));
    if (order.carrierId) { const carrier = this.residents.find((r) => r.id === order.carrierId); if (carrier?.carrying) { addStorage(source?.physical?.output ?? {}, carrier.carrying.resource, carrier.carrying.amount); carrier.carrying = null; } }
    order.status = "CANCELLED";
    const carrier = order.carrierId ? this.residents.find((r) => r.id === order.carrierId) : undefined;
    if (carrier) { carrier.state = "IDLE"; carrier.carrying = null; }
    this.notify();
    return true;
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

    // Bauanimation/-fortschritt (läuft pro Frame für flüssige Darstellung)
    let completed = false;
    for (const b of this.buildings) {
      if (b.built) continue;
      const def = BUILDINGS[b.type];
      b.progress = Math.min(1, b.progress + dt / def.buildTime);
      if (b.progress >= 1) {
        b.built = true;
        b.status = "ok";
        this.addXp(def.xp);
        if (def.id !== "road") this.toast(`${def.name} fertiggestellt`, "good");
        completed = true;
      }
    }
    if (completed) this.dirtyFlag = true;

    this.acc += dt;
    let guard = 0;
    while (this.acc >= SIM_STEP && guard++ < 6) {
      this.acc -= SIM_STEP;
      this.step(SIM_STEP);
    }
    if (this.acc > SIM_STEP) this.acc = 0;

    this.notifyAcc += dt;
    if (this.notifyAcc >= 0.25) { this.notifyAcc = 0; this.notify(); }
  }

  /** Headless: Simulation um `seconds` vorspulen (Tests) */
  simulate(seconds: number) {
    for (let t = 0; t < seconds; t += SIM_STEP) this.update(SIM_STEP);
  }

  private step(dt: number) {
    if (this.dirtyFlag) this.recompute();
    this.computeStats();
    this.updatePhysical(dt);
    const flowP = zeroRes(), flowC = zeroRes();
    const barracks = this.count("barracks");

    /* ---- Produktion ---- */
    for (const b of this.buildings) {
      const def = BUILDINGS[b.type];
      b.missing = null;
      b.eff = 0;
      if (!b.built) { b.status = "constructing"; continue; }
      if (def.needsRoad && !b.connected && def.id !== "road") { b.status = "no_road"; continue; }
      if (["quarry", "mine"].includes(b.type) && b.status === "depleted") continue;
      b.status = "ok";
      if (def.jobs && b.workers <= 0) { b.status = "no_workers"; continue; }
      if (["lumberjack", "forester", "sawmill", "farm", "mill", "bakery", "quarry", "mine"].includes(b.type)) continue;
      if (!def.recipe) continue;
      if (def.site && b.site <= 0) { b.status = "no_site"; continue; }

      const upgrade = b.physical?.level === 2 || b.physical?.level === 3 ? UPGRADE_LEVELS[b.type]?.[b.physical.level] : undefined;
      const ratio = def.jobs ? b.workers / (def.jobs.count + (upgrade?.workerSlots ?? 0)) : 1;
      let eff = ratio * (def.site ? b.site : 1) * (1 + this.techProdMult(b.type)) * (upgrade?.speed ?? 1);
      if (def.recipe.special === "soldier" && this.hasTech("drill")) eff *= 2;
      b.eff = eff;

      const wanted = (eff * dt) / def.recipe.cycle;
      let cycles = wanted;
      let limitedBy: "in" | "out" | null = null;
      const outputs: [ResId, number][] = Object.entries(def.recipe.outputs) as [ResId, number][];
      if (def.id === "mine") {
        const r = b.mineRes ?? "eisen";
        const dep = r === "gold" ? 3 : r === "kohle" ? 2 : 1;
        outputs.length = 0;
        outputs.push([r, DEPOSIT_YIELD[dep]]);
      }
      for (const [r, n] of Object.entries(def.recipe.inputs) as [ResId, number][]) {
        const avail = this.res[r] / n;
        if (avail < cycles) { cycles = avail; limitedBy = "in"; b.missing = r; }
      }
      for (const [r, n] of outputs) {
        const space = Math.max(0, (this.limit[r] - this.res[r]) / n);
        if (space < cycles) { cycles = space; limitedBy = "out"; }
      }
      if (def.recipe.special === "soldier") {
        const cap = Math.min(barracks * SOLDIERS_PER_BARRACKS, Math.floor(this.pop * 0.5));
        const room = Math.max(0, cap - this.soldiers);
        if (room < cycles) { cycles = room; limitedBy = "out"; }
      }
      if (cycles < wanted * 0.98) b.status = limitedBy === "in" ? "no_input" : "storage_full";
      if (cycles <= 0) continue;
      for (const [r, n] of Object.entries(def.recipe.inputs) as [ResId, number][]) { this.res[r] -= n * cycles; flowC[r] += n * cycles; }
      for (const [r, n] of outputs) { this.res[r] += n * cycles; flowP[r] += n * cycles; }
      if (def.recipe.special === "soldier") this.soldiers += cycles;
    }

    /* ---- Bevölkerung: Verbrauch + Wachstum ---- */
    const need = (Math.floor(this.pop) * FOOD_PER_CAPITA * dt) / 60;
    let fed = 1;
    let usedBrot = 0;
    if (need > 0) {
      usedBrot = Math.min(this.res.brot, need);
      const usedGrain = Math.min(this.res.getreide, need - usedBrot);
      this.res.brot -= usedBrot; this.res.getreide -= usedGrain;
      flowC.brot += usedBrot; flowC.getreide += usedGrain;
      fed = (usedBrot + usedGrain) / need;
    }
    this.foodStatus = fed >= 0.98 ? "ok" : fed > 0.4 ? "low" : "starving";
    const perMin = (0.8 + 0.08 * this.pop) * (usedBrot > 0 ? 1.5 : 1);
    this.growthPerMin = 0;
    if (this.foodStatus === "ok" && this.pop < this.popCap) {
      this.growthPerMin = perMin;
      this.pop = Math.min(this.popCap, this.pop + (perMin * dt) / 60);
    } else if (this.foodStatus === "starving" && this.pop > 2) {
      this.growthPerMin = -0.6;
      this.pop = Math.max(2, this.pop - (0.6 * dt) / 60);
    }
    if (this.pop > this.popCap + 0.5) {
      this.pop = Math.max(this.popCap, this.pop - dt / 60);
      this.growthPerMin = -1;
    }
    if (this.soldiers > this.pop * 0.5) this.soldiers = Math.max(0, this.pop * 0.5);

    /* ---- Lagerlimits einhalten + Raten glätten (gleitender Mittelwert pro Minute) ---- */
    for (const r of RES_IDS) {
      this.res[r] = Math.max(0, Math.min(this.limit[r], this.res[r]));
      this.prod[r] += ((flowP[r] / dt) * 60 - this.prod[r]) * 0.12;
      this.cons[r] += ((flowC[r] / dt) * 60 - this.cons[r]) * 0.12;
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

    this.computeStats();
    this.checkQuests();
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
      case "stock": return { cur: Math.min(c.n, Math.floor(this.res[c.res])), target: c.n };
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
        for (const [r, n] of Object.entries(qd.reward ?? {}) as [ResId, number][]) this.res[r] = Math.min(this.limit[r], this.res[r] + n);
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
    for (const [r, n] of Object.entries(t.cost) as [ResId, number][]) if (this.res[r] < n) return `Nicht genug ${RESOURCES[r].name}`;
    return null;
  }

  startResearch(id: string): boolean {
    const why = this.canResearch(id);
    if (why) { this.toast(why, "warn"); this.notify(); return false; }
    const t = TECHS.find((x) => x.id === id)!;
    for (const [r, n] of Object.entries(t.cost) as [ResId, number][]) this.res[r] -= n;
    this.research.active = { id, remaining: t.time };
    this.toast(`Forschung gestartet: ${t.name}`, "info");
    this.notify();
    return true;
  }

  /** Handel ist nur mit einem fertigen, angebundenen und besetzten Marktplatz möglich */
  marketActive(): boolean {
    return this.buildings.some((b) => b.type === "market" && b.built && b.connected && b.workers > 0);
  }
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
      const n = Math.min(amount, Math.floor(this.res[res]));
      if (n <= 0) return `Kein ${RESOURCES[res].name} im Lager.`;
      const gain = Math.floor(unit * n);
      if (gain <= 0) return "Menge zu klein.";
      this.res[res] -= n;
      this.res.gold = Math.min(this.limit.gold, this.res.gold + gain);
    } else {
      const n = Math.min(amount, Math.floor(this.limit[res] - this.res[res]));
      if (n <= 0) return "Lager voll.";
      const cost = Math.ceil(unit * n);
      if (this.res.gold < cost) return "Nicht genug Gold.";
      this.res.gold -= cost;
      this.res[res] += n;
    }
    this.tradeCount++;
    this.notify();
    return null;
  }

  /* ========================================================== Auswertungen */

  /** Produktion/Verbrauch eines Gebäudes bei aktueller Effizienz (pro Minute) */
  buildingRates(b: Building): { inputs: [ResId, number][]; outputs: [ResId, number][] } {
    const def = BUILDINGS[b.type];
    if (!def.recipe || !b.built) return { inputs: [], outputs: [] };
    const f = (60 / def.recipe.cycle) * b.eff;
    const outs = Object.entries(def.recipe.outputs) as [ResId, number][];
    if (def.id === "mine") {
      const r = b.mineRes ?? "eisen";
      outs.length = 0;
      outs.push([r, DEPOSIT_YIELD[r === "gold" ? 3 : r === "kohle" ? 2 : 1]]);
    }
    return {
      inputs: (Object.entries(def.recipe.inputs) as [ResId, number][]).map(([r, n]) => [r, n * f]),
      outputs: outs.map(([r, n]) => [r, n * f]),
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
      out.push({
        sev: g.status === "no_input" || g.status === "no_site" || g.status === "no_road" ? "bad" : "warn",
        text: `${g.n}× ${g.def.name} – ${STATUS_TEXT[g.status].label}${miss}`,
      });
    });
    if (this.foodStatus !== "ok") out.push({ sev: "bad", text: this.foodStatus === "starving" ? "Die Bevölkerung hungert! Brot/Getreide fehlt." : "Nahrung reicht nicht für alle." });
    const unfilled = JOB_IDS.reduce((s, j) => s + Math.max(0, this.byJob[j].needed - this.byJob[j].filled), 0);
    if (unfilled >= 1) out.push({ sev: "warn", text: `${Math.round(unfilled)} Arbeitsplätze unbesetzt – mehr Wohnraum/Einwohner nötig.` });
    if (this.pop >= this.popCap - 0.5 && this.popCap > 0 && this.foodStatus === "ok") out.push({ sev: "warn", text: "Wohnraum voll – baue weitere Häuser." });
    for (const r of RES_IDS) {
      if (this.res[r] < 1 && this.cons[r] > 0.05) out.push({ sev: "bad", text: `${RESOURCES[r].name}: Bestand leer (Verbrauch ${this.cons[r].toFixed(1)}/min)` });
      else if (this.res[r] >= this.limit[r] * 0.98 && this.prod[r] > 0.05) out.push({ sev: "warn", text: `${RESOURCES[r].name}: Lager voll – Lagerhaus bauen oder verarbeiten.` });
    }
    return out;
  }

  /** Jede Kachel, deren Gebäude der Straße bedarf, aber nicht angebunden ist (für Hinweise) */
  get jobsSummary() {
    return JOB_IDS.map((j) => ({ id: j, name: JOBS[j].name, icon: JOBS[j].icon, ...this.byJob[j] }));
  }

  get nextXp() { return xpToNext(this.level); }
}
