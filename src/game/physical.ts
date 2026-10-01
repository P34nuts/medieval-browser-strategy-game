/**
 * Gemeinsame Typen der physischen Simulation (Einwohner, Transportaufträge, Lager, Felder).
 * Logik liegt in storage.ts, economy.ts, logistics.ts, pathing.ts, residents.ts, construction.ts.
 */
import type { ResId } from "./data";

export type ResidentState =
  | "AT_HOME" | "RETURNING_HOME" | "WALKING_TO_WORK" | "WORKING" | "WAITING"
  | "FETCHING_RESOURCE" | "TRANSPORTING" | "DELIVERING_RESOURCE" | "CONSTRUCTION_WORK";

export interface Resident {
  id: number; x: number; y: number;
  homeBuildingId: number | null;
  /** "unassigned" oder eine JobId */
  job: string;
  workplaceId: number | null;
  state: ResidentState;
  targetX: number; targetY: number; speed: number;
  path: [number, number][]; pathIndex: number;
  /** Physisch getragene Ware – existiert nur hier, bis sie abgeliefert wird */
  carrying: { resource: ResId; amount: number } | null;
  workTimer: number; animation: number;
  /** Aktuelle Aufgabe: Kachel-Index (Baum/Vorkommen), Feld- oder Baustellen-ID */
  workTargetId: number | null;
  /** Transportauftrag, den ein Träger gerade bearbeitet */
  orderId: number | null;
  /** Ist der Bewohner am Arbeitsplatz angekommen (zählt für Produktion)? */
  atWork: boolean;
}

export type FieldStage = "EMPTY" | "PLOWED" | "SOWN" | "GROWING" | "RIPE" | "HARVESTING" | "HARVESTED";
export interface FieldState { stage: FieldStage; progress: number; crop: "getreide"; farmerId: number | null; yieldAmount: number; }

export type TransportStatus =
  | "WAITING_FOR_CARRIER" | "TO_PICKUP" | "PICKING_UP" | "IN_TRANSIT" | "DELIVERING" | "DELIVERED"
  | "BLOCKED_NO_ROUTE" | "BLOCKED_TARGET_FULL" | "FAILED" | "CANCELLED";

export const ACTIVE_STATUSES: TransportStatus[] = [
  "WAITING_FOR_CARRIER", "TO_PICKUP", "PICKING_UP", "IN_TRANSIT", "DELIVERING", "BLOCKED_NO_ROUTE", "BLOCKED_TARGET_FULL",
];
export const isActiveStatus = (s: TransportStatus) => ACTIVE_STATUSES.includes(s);

export interface TransportOrder {
  id: number;
  resource: ResId;
  amount: number;
  /** Basispriorität 0 (LOW) .. 3 (CRITICAL); effektive Priorität siehe config.effectivePriority */
  priority: number;
  status: TransportStatus;
  carrierId: number | null;
  createdAt: number;
  /** Wartezeit seit Erstellung bzw. Blockade (Sekunden) – Grundlage des Prioritäts-Agings */
  waited: number;
  blockedFor: number;
  sourceBuildingId: number | null;
  targetBuildingId: number | null;
  /** Ware wurde bereits aufgenommen (Quelle ist dann nicht mehr relevant) */
  loaded: boolean;
  /** Reservierungen, die dieser Auftrag aktuell hält (Quelle: Ware, Ziel: Kapazität) */
  srcReserved: boolean;
  dstReserved: boolean;
  /** Wegenetz-Version, bei der der Auftrag zuletzt blockiert wurde (Wiederaufnahme bei Änderung) */
  routeVersion: number;
  /** Recovery-Lieferung in einen vollen Hub (Überlauf erlaubt) */
  forced?: boolean;
}

export type Storage = Partial<Record<ResId, number>>;

export type ProductionState = "WAITING_FOR_INPUT" | "PRODUCING" | "WAITING_FOR_PICKUP" | "NO_WORKER";

export interface PhysicalBuildingState {
  /** Eingangslager (bei Baustellen: gelieferte Baumaterialien). Hubs nutzen nur `output` als Warenlager. */
  input: Storage;
  output: Storage;
  /** Für eingehende Transporte reservierte Kapazität / für ausgehende Transporte reservierte Ware */
  reservedInput: Storage;
  reservedOutput: Storage;
  production: ProductionState;
  productionProgress: number;
  rotation: 0 | 1 | 2 | 3;
  level: 1 | 2 | 3;
  /** Zeitpunkt (physicalClock) der letzten Ausgabe-Erhöhung */
  lastOutputAt: number;
}

export type PathStatus = "REACHED" | "ALREADY_AT_GOAL" | "UNREACHABLE";
export interface PathResult { status: PathStatus; path: [number, number][] }
export type MovementProfile = "WORKER" | "CARRIER";
