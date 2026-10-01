import { MAP_SIZE, T, type BuildingId, type ResId } from "./data";
import type { Building } from "./engine";
import type { MapData } from "./mapgen";

export type ResidentState =
  | "IDLE" | "WALKING_TO_WORK" | "WORKING" | "WAITING"
  | "TRANSPORTING" | "FETCHING_RESOURCE" | "DELIVERING_RESOURCE";

export type FieldStage = "EMPTY" | "PLOWED" | "SOWN" | "GROWING" | "RIPE" | "HARVESTING";
export interface FieldState { stage: FieldStage; progress: number; crop: "getreide"; farmerId: number | null; yieldAmount: number; }

export interface Resident {
  id: number; x: number; y: number; homeBuildingId: number | null; job: string; workplaceId: number | null;
  state: ResidentState; targetX: number; targetY: number; speed: number; path: [number, number][]; pathIndex: number;
  carrying: { resource: ResId; amount: number } | null; workTimer: number; animation: number; workTargetId?: number | null;
}

export type TransportStatus = "WAITING" | "WAITING_FOR_CARRIER" | "ASSIGNED" | "TO_PICKUP" | "PICKING_UP" | "IN_TRANSIT" | "DELIVERING" | "DELIVERED" | "BLOCKED_NO_ROUTE" | "BLOCKED_TARGET_FULL" | "FAILED" | "CANCELLED";
export interface TransportOrder { id: number; resource: ResId; amount: number; start: [number, number]; target: [number, number]; priority: number; status: TransportStatus; carrierId: number | null; createdAt: number; sourceBuildingId: number | null; targetBuildingId: number | null; reservedAmount?: number; }
export type Storage = Partial<Record<ResId, number>>;
export interface PhysicalBuildingState { input: Storage; output: Storage; production: "WAITING_FOR_INPUT" | "READY" | "PRODUCING" | "OUTPUT_READY" | "WAITING_FOR_PICKUP"; productionProgress: number; rotation: 0 | 1 | 2 | 3; level: 1 | 2 | 3; reservedOutput?: Storage; reservedInput?: Storage; }
export function storageAmount(storage: Storage, resource: ResId): number { return Math.max(0, storage[resource] ?? 0); }
export function addStorage(storage: Storage, resource: ResId, amount: number): void { storage[resource] = storageAmount(storage, resource) + amount; }
export function takeStorage(storage: Storage, resource: ResId, amount: number): number { const taken = Math.min(storageAmount(storage, resource), Math.max(0, amount)); storage[resource] = storageAmount(storage, resource) - taken; return taken; }
export function reserveStorage(storage: Storage, resource: ResId, amount: number): boolean { const available = storageAmount(storage, resource); if (available < amount) return false; storage[resource] = available - amount; return true; }
export function releaseStorage(storage: Storage, resource: ResId, amount: number): void { storage[resource] = storageAmount(storage, resource) + amount; }

function normalizePoint(point: [number, number]): [number, number] { return [Math.max(0, Math.min(MAP_SIZE - 1, Math.round(point[0]))), Math.max(0, Math.min(MAP_SIZE - 1, Math.round(point[1])))] as [number, number]; }
function reconstruct(came: Map<number, number>, start: [number, number], goal: [number, number]): [number, number][] { const key = (x: number, y: number) => y * MAP_SIZE + x; const out: [number, number][] = []; let k = key(goal[0], goal[1]); while (k !== key(start[0], start[1])) { out.push([k % MAP_SIZE, Math.floor(k / MAP_SIZE)]); const previous = came.get(k); if (previous === undefined) return []; k = previous; } out.reverse(); return out; }

/** A* für Arbeiter: natürliche Flächen bleiben erreichbar. */
export function findPath(map: MapData, buildings: Building[], from: [number, number], to: [number, number]): [number, number][] {
  const start = normalizePoint(from), goal = normalizePoint(to), key = (x: number, y: number) => y * MAP_SIZE + x;
  const walkable = (x: number, y: number) => { if (x < 0 || y < 0 || x >= MAP_SIZE || y >= MAP_SIZE) return false; const terrain = map.terrain[key(x, y)]; if (terrain === T.LAKE || terrain === T.RIVER || terrain === T.MOUNTAIN) return false; const b = buildings.find((item) => item.built && x >= item.x && y >= item.y && x < item.x + 1 && y < item.y + 1); return !b || b.type === "road" || key(x, y) === key(goal[0], goal[1]); };
  const open: { x: number; y: number; f: number }[] = [{ x: start[0], y: start[1], f: 0 }], came = new Map<number, number>(), g = new Map<number, number>([[key(start[0], start[1]), 0]]);
  while (open.length) { open.sort((a, b) => a.f - b.f); const current = open.shift()!; if (current.x === goal[0] && current.y === goal[1]) return reconstruct(came, start, goal); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = current.x + dx, ny = current.y + dy; if (!walkable(nx, ny)) continue; const nk = key(nx, ny), tile = map.terrain[nk], road = buildings.some((item) => item.built && item.type === "road" && item.x === nx && item.y === ny), next = (g.get(key(current.x, current.y)) ?? Infinity) + (road ? 1 : tile === T.FOREST ? 2.4 : 1.7); if (next < (g.get(nk) ?? Infinity)) { came.set(nk, key(current.x, current.y)); g.set(nk, next); open.push({ x: nx, y: ny, f: next + Math.abs(nx - goal[0]) + Math.abs(ny - goal[1]) }); } } }
  return [];
}

/** Carrier-Routing: ausschließlich gebaute Straßen, keine Gras-Abkürzung. */
export function findRoadPath(map: MapData, buildings: Building[], from: [number, number], to: [number, number]): [number, number][] {
  const start = normalizePoint(from), goal = normalizePoint(to), key = (x: number, y: number) => y * MAP_SIZE + x;
  const road = (x: number, y: number) => buildings.some((b) => b.built && b.type === "road" && b.x === x && b.y === y);
  const walkable = (x: number, y: number) => (x === start[0] && y === start[1]) || (x === goal[0] && y === goal[1]) || road(x, y);
  const open: { x: number; y: number; f: number }[] = [{ x: start[0], y: start[1], f: 0 }], came = new Map<number, number>(), g = new Map<number, number>([[key(start[0], start[1]), 0]]);
  while (open.length) { open.sort((a, b) => a.f - b.f); const current = open.shift()!; if (current.x === goal[0] && current.y === goal[1]) return reconstruct(came, start, goal); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = current.x + dx, ny = current.y + dy; if (nx < 0 || ny < 0 || nx >= MAP_SIZE || ny >= MAP_SIZE || !walkable(nx, ny)) continue; const nk = key(nx, ny), next = (g.get(key(current.x, current.y)) ?? Infinity) + 1; if (next < (g.get(nk) ?? Infinity)) { came.set(nk, key(current.x, current.y)); g.set(nk, next); open.push({ x: nx, y: ny, f: next + Math.abs(nx - goal[0]) + Math.abs(ny - goal[1]) }); } } }
  return [];
}
