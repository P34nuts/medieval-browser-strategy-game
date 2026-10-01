/** Gemeinsame Hilfen für Headless-Tests (Szenarien schnell aufbauen). */
import { BUILDINGS, MAP_SIZE, T, type BuildingId } from "../src/game/data";
import { GameEngine, type Building } from "../src/game/engine";
import { accessTiles, buildingAccess } from "../src/game/pathing";

export const C = MAP_SIZE / 2;
type Rot = 0 | 1 | 2 | 3;

/** Gebäude sofort fertig platzieren (Test-Setup, umgeht Baustelle/Kosten) */
export function forceBuild(g: GameEngine, type: BuildingId, x: number, y: number, rot: Rot = 0): Building {
  const b = (g as unknown as { addBuilding(t: BuildingId, x: number, y: number, built: boolean, r: Rot): Building | null }).addBuilding(type, x, y, true, rot);
  if (!b) throw new Error(`forceBuild ${type} @${x},${y} fehlgeschlagen`);
  g.recompute(); g.computeStats();
  return b;
}

export function freeTile(g: GameEngine, x: number, y: number) {
  return x >= 0 && y >= 0 && x < MAP_SIZE && y < MAP_SIZE && (g.map.terrain[y * MAP_SIZE + x] === T.GRASS || g.map.terrain[y * MAP_SIZE + x] === T.SAND) && !g.occ[y * MAP_SIZE + x];
}

/** Nächster freier Bauplatz zum Siedlungszentrum */
export function findSpot(g: GameEngine, type: BuildingId, minDist = 0, around: [number, number] = [C, C]): [number, number] | null {
  let best: [number, number] | null = null, bd = Infinity;
  for (let y = 1; y < MAP_SIZE - 5; y++) for (let x = 1; x < MAP_SIZE - 5; x++) {
    const chk = g.checkPlace(type, x, y, 0);
    if (!chk.ok && chk.reason !== "Nicht genug Holz" && chk.reason !== "Nicht genug Stein") continue;
    if (!chk.ok) continue;
    const d = Math.hypot(x - around[0], y - around[1]);
    if (d >= minDist && d < bd) { bd = d; best = [x, y]; }
  }
  return best;
}

/** Straße (sofort fertig) von einem Zugang des Gebäudes zum bestehenden Netz (BFS über freie Kacheln) */
export function connect(g: GameEngine, b: Building, real = false): boolean {
  const q: [number, number][] = [], prev = new Map<number, number>();
  const key = (x: number, y: number) => y * MAP_SIZE + x;
  for (const [x, y] of buildingAccess(b)) { if (g.isRoad(x, y)) return true; if (freeTile(g, x, y)) { q.push([x, y]); prev.set(key(x, y), -1); } }
  while (q.length) {
    const [x, y] = q.shift()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (g.isRoad(nx, ny)) {
        let k = key(x, y);
        while (k !== -1) { if (real) g.place("road", k % MAP_SIZE, Math.floor(k / MAP_SIZE), 0); else forceBuild(g, "road", k % MAP_SIZE, Math.floor(k / MAP_SIZE)); k = prev.get(k)!; }
        g.recompute(); g.computeStats();
        return true;
      }
      if (!freeTile(g, nx, ny) || prev.has(key(nx, ny))) continue;
      prev.set(key(nx, ny), key(x, y)); q.push([nx, ny]);
    }
  }
  return false;
}

/** Gebäude bauen + anbinden: probiert Plätze (nach Entfernung) und Drehungen, bis ein Zugang anbindbar ist */
export function buildConnected(g: GameEngine, type: BuildingId, spot?: [number, number] | null, rot?: Rot): Building {
  const cands: [number, number][] = [];
  if (spot) cands.push(spot);
  else {
    const all: { x: number; y: number; d: number }[] = [];
    for (let y = 1; y < MAP_SIZE - 5; y++) for (let x = 1; x < MAP_SIZE - 5; x++) if (g.checkPlace(type, x, y, 0).ok) all.push({ x, y, d: Math.hypot(x - C, y - C) });
    all.sort((a, b) => a.d - b.d);
    for (const a of all.slice(0, 80)) cands.push([a.x, a.y]);
  }
  for (const [x, y] of cands) for (const r of (rot !== undefined ? [rot] : [0, 1, 2, 3]) as Rot[]) {
    if (!g.checkPlace(type, x, y, r).ok) continue;
    const acc = accessTiles(type, x, y, r);
    if (!acc.some(([ax, ay]) => freeTile(g, ax, ay) || g.isRoad(ax, ay))) continue;
    const b = forceBuild(g, type, x, y, r);
    if (connect(g, b)) return b;
    g.demolish(b.id);
  }
  throw new Error(`kein anbindbarer Platz für ${type}`);
}

/** Genug Wohnraum + Bevölkerung für Tests */
export function populate(g: GameEngine, houses = 6, pop = 30) {
  for (let i = 0; i < houses; i++) { try { buildConnected(g, "house_m"); } catch { /* ok */ } }
  g.pop = Math.min(pop, g.popCap || pop);
  g.recompute(); g.computeStats();
}

export const total = (g: GameEngine, r: Parameters<GameEngine["getEconomyTotal"]>[0]) => g.getEconomyTotal(r);
export { BUILDINGS };

/** Baustelle über den UI-Weg (Ghost + Bestätigen, automatische Rotation) an einem Platz mit Straßenanschluss */
export function placeSite(g: GameEngine, type: BuildingId, near: [number, number] = [C, C], skip = 0): Building | null {
  const all: { x: number; y: number; d: number }[] = [];
  for (let y = 1; y < MAP_SIZE - 5; y++) for (let x = 1; x < MAP_SIZE - 5; x++) if (g.checkPlace(type, x, y, 0).ok) all.push({ x, y, d: Math.hypot(x - near[0], y - near[1]) });
  all.sort((a, b) => a.d - b.d);
  let skipped = 0;
  for (const a of all.slice(0, 400)) {
    g.setBuildType(type); g.setGhost(a.x, a.y);
    const before = g.buildings.length;
    const r = g.confirmGhost();
    g.setBuildType(null);
    if (!r?.ok || g.buildings.length === before) continue;
    const site = g.buildings[g.buildings.length - 1];
    g.recompute(); g.computeStats();
    if (site.connected && skipped++ >= skip) return site;
    if (!site.connected) g.demolish(site.id);
  }
  return null;
}
