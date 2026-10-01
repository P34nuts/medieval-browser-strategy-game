/**
 * Datengetriebene Konfiguration der physischen Simulation.
 * Alle Dauern in Sekunden Spielzeit, alle Radien in Kacheln.
 * Keine Zahlenwerte dieser Art gehören in die Engine-Logik.
 */
import { BUILDINGS, UPGRADE_LEVELS, type BuildingId, type ResAmounts, type ResId } from "./data";

/* ---------------------------------------------------------------- Transport */
export const PRIORITY = { LOW: 0, NORMAL: 1, HIGH: 2, CRITICAL: 3 } as const;
export type Priority = (typeof PRIORITY)[keyof typeof PRIORITY];

export const TRANSPORT = {
  /** Maximale Menge pro Trägerfahrt */
  carryCapacity: 4,
  /** Sekunden Wartezeit, nach denen ein Auftrag eine Prioritätsstufe aufsteigt (Aging) */
  agingSeconds: 45,
  /** Obergrenze der effektiven Priorität durch Aging */
  maxEffectivePriority: 3.5,
  /** Aufnehmen / Abladen dauern kurz */
  handlingTime: 0.5,
  /** Restmengen im Ausgang werden nach dieser Zeit auch als kleine Fracht verschickt */
  partialShipAfter: 6,
  /** Wie viele abgeschlossene Aufträge für die Anzeige behalten werden */
  archiveSize: 20,
  /** Blockierte Aufträge ohne Fracht werden nach dieser Zeit abgebrochen und neu geplant */
  blockedGiveUp: 90,
  /** Ausgangslager ab diesem Füllstand → Priorität HIGH */
  urgentFill: 0.8,
};

/** Tragende Bewohner: Gehgeschwindigkeit (Kacheln/s) */
export const SPEED = { worker: 2.2, carrier: 2.8, builder: 2.2 };

/* ------------------------------------------------------------------ Lager */
/** Basiskapazität lokaler Gebäudelager je Ware (Stufe 1); Stufen 2/3 siehe UPGRADE_LEVELS */
export const BASE_STORAGE = { input: 10, output: 10 };

/** Welche Gebäude besitzen lokale Lager (und damit physische Wirtschaft)? */
export const PHYSICAL_TYPES: BuildingId[] = [
  "lumberjack", "forester", "sawmill", "warehouse", "castle", "farm", "mill", "bakery", "smithy", "quarry", "mine",
];
/** Verarbeiter mit Rezept aus `BUILDINGS[..].recipe` */
export const PROCESSORS: BuildingId[] = ["sawmill", "mill", "bakery", "smithy"];
/** Sammler (Arbeiter holen Material außerhalb des Gebäudes) */
export const GATHERERS: BuildingId[] = ["lumberjack", "forester", "farm", "quarry", "mine"];

/**
 * Warenfluss: wohin liefert ein Erzeuger seine Ausgangsware bevorzugt?
 * Reihenfolge = Priorität; Lagerhäuser (Hubs) sind immer der letzte Ausweg.
 */
export const FLOWS: Partial<Record<BuildingId, Partial<Record<ResId | "*", BuildingId[]>>>> = {
  lumberjack: { holz: ["sawmill"] },
  farm: { getreide: ["mill"] },
  mill: { mehl: ["bakery"] },
  mine: { eisen: ["smithy"], kohle: ["smithy"] },
};
/** Ausgangswaren der Sammler/Verarbeiter, die in Hubs wandern */
export const HUB_SINK = true;

/* ---------------------------------------------------------------- Gelände */
export const FORESTRY = {
  /** Arbeitsradius um das Gebäude */
  workRadius: { lumberjack: 8, forester: 7 } as Record<string, number>,
  harvestTime: 3,
  plantTime: 2.5,
  /** Dauer je Wachstumsstufe: SAPLING → YOUNG → MATURE */
  stageDuration: 50,
  /** Ohne Förster wächst ein abgeholzter Platz erst nach dieser Zeit natürlich nach */
  naturalRegrowthAfter: 600,
  woodPerTree: 2,
};

export const FARMING = {
  workRadius: 7,
  plowTime: 3,
  sowTime: 2,
  germinateTime: 4,
  growTime: 30,
  harvestTime: 4,
  yieldPerField: 4,
};

export const MINING = {
  workRadius: { quarry: 6, mine: 4 } as Record<string, number>,
  extractTime: { quarry: 3, mine: 4 } as Record<string, number>,
  /** Menge pro Förderzyklus */
  yieldPerTrip: { stein: 2, eisen: 2, kohle: 2, gold: 1 } as Record<string, number>,
  /** Anfangsvorrat je Gebirgskachel */
  depositAmount: { stein: 900, eisen: 600, kohle: 600, gold: 250 } as Record<string, number>,
};

/* ---------------------------------------------------------------- Bau */
export const CONSTRUCTION = {
  /** Diese Typen werden sofort bezahlt und ohne Bauarbeiter fertiggestellt (Straßen, Felder). */
  instant: ["road", "field"] as BuildingId[],
  /** Baustellen-Slots für gleichzeitig arbeitende Bauarbeiter */
  buildersPerSite: 2,
  /** Rückerstattung beim Abriss fertiger Gebäude */
  demolishRefund: 0.5,
};

export function constructionMaterials(type: BuildingId): ResAmounts {
  return CONSTRUCTION.instant.includes(type) ? {} : BUILDINGS[type].cost;
}

/* ------------------------------------------------------------------ Bevölkerung */
export const POPULATION = {
  workerShare: 0.85,
  foodPerCapitaPerMin: 0.12,
};

/** Verarbeiter ziehen Rohstoffe nur aus Hubs, wenn dort mehr als diese Reserve liegt (Baumaterial hat Vorrang). */
export const PULL_RESERVE: Partial<Record<ResId, number>> = { holz: 40, stein: 20, getreide: 30, mehl: 0, eisen: 0, kohle: 0 };

/* ----------------------------------------------------------------- Helfer */
export function storageCapacity(type: BuildingId, level: 1 | 2 | 3, side: "input" | "output"): number {
  if (level === 1) return BASE_STORAGE[side];
  const spec = UPGRADE_LEVELS[type]?.[level];
  if (!spec) return BASE_STORAGE[side];
  return side === "input" ? spec.inputCapacity : spec.outputCapacity;
}

/** Nach Aging: effektive Priorität */
export function effectivePriority(base: number, waited: number): number {
  return Math.min(TRANSPORT.maxEffectivePriority, base + Math.floor(waited / TRANSPORT.agingSeconds));
}
