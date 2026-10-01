/**
 * Wegfindung & Gebäudezugänge.
 *
 *  - Zwei Bewegungsprofile: WORKER (darf abseits der Straße gehen, Gebäude sind Hindernisse)
 *    und CARRIER (ausschließlich gebaute Straßen: Zugang → Straßennetz → Zugang).
 *  - Ergebnis ist explizit: REACHED / ALREADY_AT_GOAL / UNREACHABLE (+ Pfad). Ein leerer Pfad
 *    bedeutet NIE „Fehlschlag“.
 *  - Kollision stammt aus dem Belegungsraster (`eng.occ`), das die echten, gedrehten Footprints enthält.
 *  - Pfad-Cache wird über `eng.pathVersion` (jede Strukturänderung) invalidiert.
 */
import { BUILDINGS, MAP_SIZE, T } from "./data";
import type { Building, GameEngine } from "./engine";
import type { MovementProfile, PathResult, Resident } from "./physical";

const N = MAP_SIZE;
const idx = (x: number, y: number) => y * N + x;
const inb = (x: number, y: number) => x >= 0 && y >= 0 && x < N && y < N;

/* --------------------------------------------------------------- Zugänge */

/** Dreht eine lokale Kachel um 90° im Uhrzeigersinn innerhalb eines w×h-Footprints. */
function rot90(x: number, y: number, w: number, h: number): [number, number, number, number] { return [h - 1 - y, x, h, w]; }

/** Lokale Zugangskacheln (Rotation 0) für eine Seite: 0 Norden, 1 Osten, 2 Süden, 3 Westen. */
export function localAccessTiles(type: Building["type"]): { tiles: [number, number][]; w: number; h: number } {
  const [w, h] = BUILDINGS[type].size;
  const side = BUILDINGS[type].accessSide ?? 2;
  const tiles: [number, number][] = [];
  if (side === 0) for (let i = 0; i < w; i++) tiles.push([i, -1]);
  else if (side === 1) for (let j = 0; j < h; j++) tiles.push([w, j]);
  else if (side === 2) for (let i = 0; i < w; i++) tiles.push([i, h]);
  else for (let j = 0; j < h; j++) tiles.push([-1, j]);
  return { tiles, w, h };
}

/** Zugangskacheln eines Gebäudes in Weltkoordinaten – drehen mit dem Gebäude mit. */
export function accessTiles(type: Building["type"], x: number, y: number, rotation: number): [number, number][] {
  const loc = localAccessTiles(type);
  let { w, h } = loc;
  let tiles = loc.tiles;
  for (let k = 0; k < (rotation & 3); k++) {
    tiles = tiles.map(([tx, ty]) => { const [nx, ny] = rot90(tx, ty, w, h); return [nx, ny] as [number, number]; });
    [w, h] = [h, w];
  }
  return tiles.map(([tx, ty]) => [x + tx, y + ty] as [number, number]).filter(([tx, ty]) => inb(tx, ty));
}

export const buildingAccess = (b: Building) => accessTiles(b.type, b.x, b.y, b.rotation);

/** Ist die Kachel eine gebaute Straße? */
export const isRoadTile = (eng: GameEngine, x: number, y: number) => inb(x, y) && eng.roadGrid[idx(x, y)] === 1;

/** Zugangskacheln, die an gebauter Straße liegen */
export function roadAccess(eng: GameEngine, b: Building): [number, number][] {
  return buildingAccess(b).filter(([x, y]) => isRoadTile(eng, x, y));
}

/** Ziel für Bewohner: Zugangskacheln (Straße bevorzugt) – Fallback: alle Zugänge */
export function entrancePoint(eng: GameEngine, b: Building): [number, number] {
  const acc = buildingAccess(b);
  const road = acc.find(([x, y]) => isRoadTile(eng, x, y));
  const t = road ?? acc[0] ?? [b.x, b.y];
  return [t[0] + 0.5, t[1] + 0.5];
}

/* -------------------------------------------------------------- Wegfindung */

class MinHeap {
  private k: number[] = [];
  private v: number[] = [];
  get size() { return this.k.length; }
  push(key: number, val: number) {
    const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop(): number {
    const k = this.k, v = this.v, top = v[0], lk = k.pop()!, lv = v.pop()!;
    if (k.length) {
      let i = 0; const n = k.length;
      for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && k[c + 1] < k[c]) c++; if (k[c] >= lk) break; k[i] = k[c]; v[i] = v[c]; i = c; }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

function tileCost(eng: GameEngine, i: number, profile: MovementProfile, goal: boolean): number {
  if (profile === "CARRIER") return eng.roadGrid[i] === 1 || goal ? 1 : Infinity;
  const t = eng.map.terrain[i];
  if (t === T.LAKE || t === T.RIVER) return Infinity;
  const occ = eng.occ[i];
  if (occ && !goal) {
    const b = eng.getBuilding(occ);
    if (!b || (b.type !== "road" && b.type !== "field")) return Infinity;
    return b.type === "road" ? 1 : 1.5;
  }
  return t === T.FOREST ? 2.4 : t === T.MOUNTAIN ? 3.5 : 1.7;
}

/**
 * A* von `from` zu einer Zielmenge.
 * CARRIER: Start und Ziele dürfen Nicht-Straße sein (Zugang), alle Zwischenkacheln müssen gebaute Straße sein.
 */
export function findPath(eng: GameEngine, profile: MovementProfile, from: [number, number], goals: [number, number][]): PathResult {
  const sx = Math.floor(from[0]), sy = Math.floor(from[1]);
  const goalSet = new Set<number>();
  for (const [gx, gy] of goals) { const gxf = Math.floor(gx), gyf = Math.floor(gy); if (inb(gxf, gyf)) goalSet.add(idx(gxf, gyf)); }
  if (!inb(sx, sy) || goalSet.size === 0) return { status: "UNREACHABLE", path: [] };
  const start = idx(sx, sy);
  if (goalSet.has(start)) return { status: "ALREADY_AT_GOAL", path: [] };

  const cacheKey = `${profile}|${start}|${[...goalSet].sort((a, b) => a - b).join(",")}`;
  const cache = eng.pathCache;
  if (cache.version !== eng.pathVersion) { cache.map.clear(); cache.version = eng.pathVersion; }
  const hit = cache.map.get(cacheKey);
  if (hit) return { status: hit.status, path: hit.path.map((p) => [p[0], p[1]] as [number, number]) };

  const goalArr = [...goalSet].map((i) => [i % N, (i / N) | 0]);
  const h = (x: number, y: number) => { let best = Infinity; for (const [gx, gy] of goalArr) best = Math.min(best, Math.abs(x - gx) + Math.abs(y - gy)); return best; };
  const g = new Float64Array(N * N).fill(Infinity);
  const came = new Int32Array(N * N).fill(-1);
  const heap = new MinHeap();
  g[start] = 0; heap.push(h(sx, sy), start);
  let found = -1;
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (heap.size) {
    const cur = heap.pop();
    if (goalSet.has(cur)) { found = cur; break; }
    const cx = cur % N, cy = (cur / N) | 0;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (!inb(nx, ny)) continue;
      const ni = idx(nx, ny);
      const c = tileCost(eng, ni, profile, goalSet.has(ni));
      if (c === Infinity) continue;
      const ng = g[cur] + c;
      if (ng < g[ni]) { g[ni] = ng; came[ni] = cur; heap.push(ng + h(nx, ny), ni); }
    }
  }
  let result: PathResult;
  if (found < 0) result = { status: "UNREACHABLE", path: [] };
  else {
    const path: [number, number][] = [];
    for (let c = found, guard = 0; c !== start; c = came[c]) { if (c < 0 || guard++ > N * N) throw new Error("findPath: ungültige Vorgängerkette"); path.push([c % N, (c / N) | 0]); }
    path.reverse();
    result = { status: "REACHED", path };
  }
  if (cache.map.size > 600) cache.map.clear();
  cache.map.set(cacheKey, result);
  return { status: result.status, path: result.path.map((p) => [p[0], p[1]] as [number, number]) };
}

/** Pfad zu einem Gebäude (über dessen Zugänge). CARRIER nutzt nur Straßenzugänge. */
export function findPathToBuilding(eng: GameEngine, profile: MovementProfile, from: [number, number], b: Building): PathResult {
  const goals = profile === "CARRIER" ? roadAccess(eng, b) : buildingAccess(b);
  return findPath(eng, profile, from, goals);
}

/* ---------------------------------------------------------------- Bewegung */

/** Bewohner einen Schritt entlang seines Pfades bewegen. true = Ziel erreicht. */
export function stepAlong(r: Resident, dt: number): boolean {
  let budget = r.speed * dt;
  while (budget > 0) {
    const p = r.path[r.pathIndex];
    if (!p) return true;
    const dx = p[0] + 0.5 - r.x, dy = p[1] + 0.5 - r.y, d = Math.hypot(dx, dy);
    if (d <= budget) { r.x = p[0] + 0.5; r.y = p[1] + 0.5; r.pathIndex++; budget -= d; continue; }
    r.x += (dx / d) * budget; r.y += (dy / d) * budget; return false;
  }
  return r.pathIndex >= r.path.length;
}

export function setPath(r: Resident, res: PathResult): boolean {
  if (res.status === "UNREACHABLE") { r.path = []; r.pathIndex = 0; return false; }
  r.path = res.path; r.pathIndex = 0;
  return true;
}

/** Sind die noch zu gehenden Kacheln (außer dem Ziel) für das Profil weiterhin begehbar? */
export function pathStillWalkable(eng: GameEngine, profile: MovementProfile, r: Resident): boolean {
  for (let i = r.pathIndex; i < r.path.length - 1; i++) {
    const [x, y] = r.path[i];
    if (tileCost(eng, idx(x, y), profile, false) === Infinity) return false;
  }
  return true;
}

/**
 * Ein Schritt in Richtung Ziel: berechnet bei Bedarf den Pfad (bzw. validiert ihn) und bewegt den Bewohner.
 * Ergebnis: MOVING | ARRIVED | NO_ROUTE – kein stilles Teleportieren, kein Fallback abseits des Profils.
 */
export function advanceTo(eng: GameEngine, r: Resident, profile: MovementProfile, goals: () => [number, number][], dt: number): "MOVING" | "ARRIVED" | "NO_ROUTE" {
  if (r.pathIndex >= r.path.length || !pathStillWalkable(eng, profile, r)) {
    const res = findPath(eng, profile, [r.x, r.y], goals());
    if (res.status === "UNREACHABLE") { r.path = []; r.pathIndex = 0; return "NO_ROUTE"; }
    if (res.status === "ALREADY_AT_GOAL") { r.path = []; r.pathIndex = 0; return "ARRIVED"; }
    setPath(r, res);
  }
  return stepAlong(r, dt) ? "ARRIVED" : "MOVING";
}
