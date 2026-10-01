/**
 * Zentrale Lager-API. Alle Lagerarithmetik (Bestand, Kapazität, Reservierungen) steht hier –
 * Engine, Logistik und UI rechnen nie selbst mit `physical.input/output`.
 *
 * Konvention:
 *  - Normale Gebäude: `input` (Eingang) und `output` (Ausgang) getrennt.
 *  - Hubs (Lagerhaus, Burg): das gesamte Warenlager liegt in `output`.
 *  - Baustellen: `input` = gelieferte Baumaterialien, Kapazität = benötigte Menge.
 */
import { BUILDINGS, type BuildingId, type ResId } from "./data";
import { constructionMaterials, storageCapacity } from "./config";
import type { Building, GameEngine } from "./engine";
import type { PhysicalBuildingState, Storage } from "./physical";

export type Side = "input" | "output";

export function newPhysicalState(rotation: 0 | 1 | 2 | 3 = 0): PhysicalBuildingState {
  return {
    input: {}, output: {}, reservedInput: {}, reservedOutput: {},
    production: "WAITING_FOR_INPUT", productionProgress: 0, rotation, level: 1, lastOutputAt: 0,
  };
}

export const amountOf = (s: Storage, r: ResId) => Math.max(0, s[r] ?? 0);
const EPS = 1e-9;

function bucket(b: Building, side: Side): Storage {
  const p = b.physical!;
  if (BUILDINGS[b.type].hub && b.built) return p.output;
  return side === "input" ? p.input : p.output;
}
const reservedBucket = (b: Building, side: Side): Storage => (side === "input" ? b.physical!.reservedInput : b.physical!.reservedOutput);

export const isHub = (b: Building) => !!BUILDINGS[b.type].hub && b.built;

/** Bestand einer Ware auf der gegebenen Seite */
export function getStored(b: Building, side: Side, r: ResId): number {
  return b.physical ? amountOf(bucket(b, side), r) : 0;
}

/** Kapazität je Ware auf der gegebenen Seite */
export function getCapacity(eng: GameEngine, b: Building, side: Side, r: ResId): number {
  if (!b.physical) return 0;
  if (!b.built) return side === "input" ? (constructionMaterials(b.type)[r] ?? 0) : 0;
  if (isHub(b)) return eng.hubCapacity(r);
  const def = BUILDINGS[b.type];
  if (side === "input") {
    const wanted = def.recipe?.inputs?.[r];
    return wanted ? Math.max(storageCapacity(b.type, b.physical.level, "input"), wanted) : 0;
  }
  return storageCapacity(b.type, b.physical.level, "output");
}

/** Freie Ausgangsware, die noch nicht für einen Transport reserviert ist */
export function getAvailableOutput(b: Building, r: ResId): number {
  if (!b.physical) return 0;
  return Math.max(0, amountOf(bucket(b, "output"), r) - amountOf(b.physical.reservedOutput, r));
}

/** Freie Aufnahmekapazität (Kapazität − Bestand − bereits reservierte Zulieferung) */
export function getAvailableInputCapacity(eng: GameEngine, b: Building, r: ResId): number {
  if (!b.physical) return 0;
  const cap = getCapacity(eng, b, "input", r);
  return Math.max(0, cap - amountOf(bucket(b, "input"), r) - amountOf(b.physical.reservedInput, r));
}

export function reserveOutput(b: Building, r: ResId, amount: number): boolean {
  if (amount <= 0 || getAvailableOutput(b, r) + EPS < amount) return false;
  b.physical!.reservedOutput[r] = amountOf(b.physical!.reservedOutput, r) + amount;
  return true;
}
export function reserveInput(eng: GameEngine, b: Building, r: ResId, amount: number): boolean {
  if (amount <= 0 || getAvailableInputCapacity(eng, b, r) + EPS < amount) return false;
  b.physical!.reservedInput[r] = amountOf(b.physical!.reservedInput, r) + amount;
  return true;
}
export function releaseOutputReservation(b: Building | undefined, r: ResId, amount: number) {
  if (!b?.physical) return;
  const left = amountOf(b.physical.reservedOutput, r) - amount;
  b.physical.reservedOutput[r] = left > EPS ? left : 0;
}
export function releaseInputReservation(b: Building | undefined, r: ResId, amount: number) {
  if (!b?.physical) return;
  const left = amountOf(b.physical.reservedInput, r) - amount;
  b.physical.reservedInput[r] = left > EPS ? left : 0;
}

/** Ware aus dem Ausgang nehmen (Reservierung wird dabei eingelöst). Gibt die tatsächlich entnommene Menge zurück. */
export function commitPickup(b: Building, r: ResId, amount: number, reserved = true): number {
  const out = bucket(b, "output");
  const taken = Math.min(amountOf(out, r), amount);
  out[r] = amountOf(out, r) - taken;
  if (reserved) releaseOutputReservation(b, r, amount);
  return taken;
}

/** Ware einlagern (Reservierung wird eingelöst). `force` erlaubt Überlauf (nur Recovery-Pfad in Hubs). */
export function commitDelivery(eng: GameEngine, b: Building, r: ResId, amount: number, reserved = true, force = false): number {
  if (reserved) releaseInputReservation(b, r, amount);
  const into = bucket(b, "input");
  const room = force ? amount : Math.max(0, getCapacity(eng, b, "input", r) - amountOf(into, r));
  const put = Math.min(amount, room);
  into[r] = amountOf(into, r) + put;
  return put;
}

/** Direkte Erzeugung im Ausgang (Produktion) – nur wenn Platz ist. */
export function produceOutput(eng: GameEngine, b: Building, r: ResId, amount: number): number {
  const out = bucket(b, "output");
  const room = Math.max(0, getCapacity(eng, b, "output", r) - amountOf(out, r));
  const put = Math.min(room, amount);
  if (put > 0) { out[r] = amountOf(out, r) + put; b.physical!.lastOutputAt = eng.physicalClock; }
  return put;
}
export function consumeInput(b: Building, r: ResId, amount: number): boolean {
  const inp = bucket(b, "input");
  if (amountOf(inp, r) + EPS < amount) return false;
  inp[r] = Math.max(0, amountOf(inp, r) - amount);
  return true;
}

export function totalStored(b: Building): number {
  if (!b.physical) return 0;
  let n = 0;
  for (const s of [b.physical.input, b.physical.output]) for (const v of Object.values(s)) n += v ?? 0;
  return n;
}
