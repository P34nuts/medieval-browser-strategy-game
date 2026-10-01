/**
 * Zentrale Wirtschafts-API.
 *
 * EINE Wahrheit: Ware existiert physisch – in Hub-Lagern (Lagerhaus/Burg), in lokalen Gebäudelagern,
 * in Baustellen oder auf dem Rücken eines Trägers. Das frühere globale Zähler-Objekt `engine.res`
 * ist nur noch ein abgeleiteter Cache (Summe der Hub-Lager) für HUD/Quests und wird NIE unabhängig verändert.
 *
 * „Ausgebbar“ (spendable) ist nur, was in Hubs liegt und nicht bereits für einen Transport reserviert ist.
 */
import { RES_IDS, type ResAmounts, type ResId } from "./data";
import type { GameEngine } from "./engine";
import { amountOf, commitPickup, getAvailableInputCapacity, getAvailableOutput, getStored } from "./storage";

const EPS = 1e-9;
const entries = (c: ResAmounts) => Object.entries(c) as [ResId, number][];

/** Bestand in allen Hub-Lagern (das, was das HUD anzeigt) */
export function getTotalResource(eng: GameEngine, r: ResId): number {
  let n = 0;
  for (const h of eng.hubs) n += getStored(h, "output", r);
  return n;
}

/** Gesamte Ware der Wirtschaft: Hubs + Produktionslager + Baustellen + getragene Fracht */
export function getEconomyTotal(eng: GameEngine, r: ResId): number {
  let n = 0;
  for (const b of eng.buildings) if (b.physical) n += amountOf(b.physical.input, r) + amountOf(b.physical.output, r);
  for (const res of eng.residents) if (res.carrying?.resource === r) n += res.carrying.amount;
  return n;
}

/** Jetzt ausgebbar: Hub-Bestand abzüglich Transportreservierungen */
export function getSpendableResource(eng: GameEngine, r: ResId): number {
  let n = 0;
  for (const h of eng.hubs) n += getAvailableOutput(h, r);
  return n;
}

export function getResourceCapacity(eng: GameEngine, r: ResId): number { return eng.limit[r]; }

export function canAfford(eng: GameEngine, cost: ResAmounts): boolean {
  return entries(cost).every(([r, n]) => getSpendableResource(eng, r) + EPS >= n);
}

/** Entnimmt `amount` aus den Hubs (alles oder nichts). */
export function consumeResource(eng: GameEngine, r: ResId, amount: number): boolean {
  if (amount <= 0) return true;
  if (getSpendableResource(eng, r) + EPS < amount) return false;
  let left = amount;
  for (const h of eng.hubs) {
    if (left <= EPS) break;
    const take = Math.min(getAvailableOutput(h, r), left);
    if (take > 0) { commitPickup(h, r, take, false); left -= take; }
  }
  syncRes(eng);
  return true;
}

/** Zieht Kosten atomar ab (bei Mangel passiert nichts). */
export function consumeCost(eng: GameEngine, cost: ResAmounts): boolean {
  if (!canAfford(eng, cost)) return false;
  for (const [r, n] of entries(cost)) consumeResource(eng, r, n);
  return true;
}

/**
 * Lagert Ware in Hubs ein (Erlöse, Belohnungen, Rückerstattungen, Handel). Liefert die tatsächlich
 * eingelagerte Menge – was nicht passt, geht verloren (explizit zurückgemeldet statt still vernichtet).
 */
export function depositResource(eng: GameEngine, r: ResId, amount: number): number {
  let left = amount;
  const hubs = [...eng.hubs].sort((a, b) => getAvailableInputCapacity(eng, b, r) - getAvailableInputCapacity(eng, a, r));
  for (const h of hubs) {
    if (left <= EPS) break;
    const put = Math.min(getAvailableInputCapacity(eng, h, r), left);
    if (put > 0) { h.physical!.output[r] = amountOf(h.physical!.output, r) + put; left -= put; }
  }
  syncRes(eng);
  return amount - Math.max(0, left);
}

export function depositCost(eng: GameEngine, c: ResAmounts, factor = 1): ResAmounts {
  const lost: ResAmounts = {};
  for (const [r, n] of entries(c)) { const want = Math.floor(n * factor), put = depositResource(eng, r, want); if (want - put > EPS) lost[r] = want - put; }
  return lost;
}

/** Test-/Debug-Zugriff: Hub-Bestand exakt setzen (Rest wird verteilt, Kapazität ignoriert). */
export function setHubStock(eng: GameEngine, stock: Partial<Record<ResId, number>>) {
  for (const [r, n] of Object.entries(stock) as [ResId, number][]) {
    for (const h of eng.hubs) h.physical!.output[r] = 0;
    if (eng.hubs[0]) eng.hubs[0].physical!.output[r] = Math.max(0, n);
  }
  syncRes(eng);
}

/** Abgeleiteten HUD-Cache aktualisieren */
export function syncRes(eng: GameEngine) {
  for (const r of RES_IDS) eng.resCache[r] = getTotalResource(eng, r);
}
