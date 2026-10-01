/**
 * Zentrale, datengetriebene Spieldefinition.
 * Alles Balancing (Kosten, Raten, Freischaltungen, Aufgaben, Forschung) liegt hier –
 * die Engine selbst enthält keine Zahlenwerte zu einzelnen Gebäuden.
 */

/* ------------------------------------------------------------------ Karte */
export const MAP_SIZE = 64;
/** Geländetypen */
export const T = { GRASS: 0, FOREST: 1, MOUNTAIN: 2, LAKE: 3, RIVER: 4, SAND: 5 } as const;
/** Rohstoffvorkommen in Bergen */
export const DEP = { NONE: 0, IRON: 1, COAL: 2, GOLD: 3 } as const;

/* -------------------------------------------------------------- Ressourcen */
export type ResId =
  | "holz" | "stein" | "bretter" | "werkzeuge" | "getreide"
  | "mehl" | "brot" | "eisen" | "kohle" | "gold";

export const RES_IDS: ResId[] = [
  "holz", "stein", "bretter", "werkzeuge", "getreide", "mehl", "brot", "eisen", "kohle", "gold",
];

export type ResAmounts = Partial<Record<ResId, number>>;

export const RESOURCES: Record<ResId, { name: string; icon: string; limit: number; price: number }> = {
  holz: { name: "Holz", icon: "🪵", limit: 200, price: 1 },
  stein: { name: "Stein", icon: "🪨", limit: 200, price: 1.5 },
  bretter: { name: "Bretter", icon: "📏", limit: 150, price: 3 },
  werkzeuge: { name: "Werkzeuge", icon: "🔨", limit: 100, price: 8 },
  getreide: { name: "Getreide", icon: "🌾", limit: 200, price: 1 },
  mehl: { name: "Mehl", icon: "🥣", limit: 150, price: 1.6 },
  brot: { name: "Brot", icon: "🍞", limit: 150, price: 2.5 },
  eisen: { name: "Eisen (Erz)", icon: "⛓️", limit: 150, price: 3 },
  kohle: { name: "Kohle", icon: "⚫", limit: 150, price: 2.5 },
  gold: { name: "Gold", icon: "🪙", limit: 500, price: 1 },
};

/** Was ein Mine je nach Vorkommen fördert und wie ergiebig es ist */
export const DEPOSIT_RES: Record<number, ResId> = { 1: "eisen", 2: "kohle", 3: "gold" };
export const DEPOSIT_YIELD: Record<number, number> = { 1: 1, 2: 1, 3: 0.4 };

/* ---------------------------------------------------------------- Berufe */
export type JobId = "holzfaeller" | "foerster" | "bauer" | "bergarbeiter" | "handwerker" | "haendler" | "soldat";
export const JOB_IDS: JobId[] = ["holzfaeller", "foerster", "bauer", "bergarbeiter", "handwerker", "haendler", "soldat"];
export const JOBS: Record<JobId, { name: string; icon: string }> = {
  holzfaeller: { name: "Holzfäller", icon: "🪓" },
  foerster: { name: "Förster", icon: "🌱" },
  bauer: { name: "Bauer", icon: "🧑‍🌾" },
  bergarbeiter: { name: "Bergarbeiter", icon: "⛏️" },
  handwerker: { name: "Handwerker", icon: "🛠️" },
  haendler: { name: "Händler", icon: "⚖️" },
  soldat: { name: "Soldat", icon: "🛡️" },
};

/* --------------------------------------------------------------- Gebäude */
export type BuildingId =
  | "house_s" | "house_m" | "house_l"
  | "lumberjack" | "forester" | "quarry" | "mine"
  | "sawmill" | "smithy" | "bakery"
  | "farm" | "mill" | "field"
  | "road" | "warehouse" | "market"
  | "barracks" | "tower" | "castle";

export type Category = "wohnen" | "ressourcen" | "verarbeitung" | "landwirtschaft" | "infrastruktur" | "militaer";

export const CATEGORIES: { id: Category; name: string; icon: string }[] = [
  { id: "wohnen", name: "Wohnen", icon: "🏠" },
  { id: "ressourcen", name: "Rohstoffe", icon: "⛏️" },
  { id: "verarbeitung", name: "Verarbeitung", icon: "⚒️" },
  { id: "landwirtschaft", name: "Landwirtschaft", icon: "🌾" },
  { id: "infrastruktur", name: "Infrastruktur", icon: "🛣️" },
  { id: "militaer", name: "Militär", icon: "🏰" },
];

export interface BuildingDef {
  id: BuildingId;
  name: string;
  category: Category;
  desc: string;
  size: [number, number];
  cost: ResAmounts;
  /** Bauzeit in Sekunden */
  buildTime: number;
  /** Freischaltung (Spielerlevel) */
  unlock: number;
  /** Erfahrungspunkte bei Fertigstellung */
  xp: number;
  /** Sprite-Höhe in Pixeln (Klick-Erkennung, Statusblase) */
  height: number;
  /** Benötigt Straßenanbindung an ein Lagerhaus/eine Burg */
  needsRoad: boolean;
  /** Arbeitsplätze */
  jobs?: { job: JobId; count: number };
  /** Wohnplätze */
  housing?: number;
  /** Produktionsrezept pro Zyklus (bei 100 % Effizienz) */
  recipe?: { inputs: ResAmounts; outputs: ResAmounts; cycle: number; special?: "soldier" };
  /** Standortbedingung in der Umgebung */
  site?: { kind: "forest" | "mountain" | "deposit" | "fields"; radius: number; full: number; label: string };
  /** Zusätzliches Lagerlimit pro Ressource */
  storage?: number;
  /** Quelle des Straßennetzes */
  hub?: boolean;
  /** Militärische Stärke */
  military?: number;
  /** Schornstein-Position (lokale Sprite-Koordinaten) für Rauchanimation */
  smoke?: [number, number, number];
  /** Flach gezeichnet (Straße, Feld) */
  flat?: boolean;
  /** Bevorzugte Eingangsseite: 0 Norden, 1 Osten, 2 Süden, 3 Westen. */
  accessSide?: 0 | 1 | 2 | 3;
}

export const BUILDINGS: Record<BuildingId, BuildingDef> = {
  house_s: {
    id: "house_s", name: "Kleines Wohnhaus", category: "wohnen", size: [1, 1], unlock: 1, xp: 8, height: 30,
    desc: "Einfache Hütte für 4 Einwohner.", cost: { holz: 20, stein: 5 }, buildTime: 8, needsRoad: true, housing: 4,
  },
  house_m: {
    id: "house_m", name: "Mittleres Wohnhaus", category: "wohnen", size: [2, 2], unlock: 5, xp: 22, height: 50,
    desc: "Stabiles Haus für 10 Einwohner.", cost: { holz: 15, stein: 20, bretter: 20 }, buildTime: 15, needsRoad: true,
    housing: 10, smoke: [1.4, 0.5, 40],
  },
  house_l: {
    id: "house_l", name: "Großes Wohnhaus", category: "wohnen", size: [3, 3], unlock: 10, xp: 60, height: 62,
    desc: "Stattliches Bürgerhaus für 24 Einwohner.", cost: { stein: 50, bretter: 40, werkzeuge: 10 }, buildTime: 25,
    needsRoad: true, housing: 24, smoke: [2.3, 0.7, 52],
  },
  lumberjack: {
    id: "lumberjack", name: "Holzfäller", category: "ressourcen", size: [2, 2], unlock: 1, xp: 8, height: 34,
    desc: "Fällt Bäume in der Umgebung und liefert Holz. Benötigt Wald in der Nähe.",
    cost: { holz: 15, stein: 5 }, buildTime: 10, needsRoad: true, jobs: { job: "holzfaeller", count: 2 },
    recipe: { inputs: {}, outputs: { holz: 1 }, cycle: 6 },
    site: { kind: "forest", radius: 4, full: 8, label: "Waldfelder" },
  },
  forester: {
    id: "forester", name: "Förster", category: "ressourcen", size: [2, 2], unlock: 1, xp: 10, height: 34,
    desc: "Pflanzt abgeerntete Waldflächen neu. Benötigt Wald in der Nähe.",
    cost: { holz: 18, stein: 5 }, buildTime: 12, needsRoad: true, jobs: { job: "foerster", count: 1 },
    site: { kind: "forest", radius: 6, full: 6, label: "Waldpflege" },
  },
  quarry: {
    id: "quarry", name: "Steinbruch", category: "ressourcen", size: [2, 2], unlock: 1, xp: 10, height: 40,
    desc: "Bricht Stein aus nahen Bergen. Benötigt Berge in der Nähe.",
    cost: { holz: 20, stein: 10 }, buildTime: 12, needsRoad: true, jobs: { job: "bergarbeiter", count: 2 },
    recipe: { inputs: {}, outputs: { stein: 1 }, cycle: 7 },
    site: { kind: "mountain", radius: 3, full: 6, label: "Bergfelder" },
  },
  mine: {
    id: "mine", name: "Mine", category: "ressourcen", size: [2, 2], unlock: 10, xp: 30, height: 40,
    desc: "Fördert Erz (Eisen, Kohle oder Gold) – je nach Vorkommen in Reichweite.",
    cost: { holz: 30, stein: 20, bretter: 15 }, buildTime: 20, needsRoad: true, jobs: { job: "bergarbeiter", count: 3 },
    recipe: { inputs: {}, outputs: { eisen: 1 }, cycle: 8 },
    site: { kind: "deposit", radius: 2, full: 3, label: "Vorkommen" },
  },
  sawmill: {
    id: "sawmill", name: "Sägewerk", category: "verarbeitung", size: [2, 2], unlock: 1, xp: 12, height: 40,
    desc: "Verarbeitet Holz zu Brettern.", cost: { holz: 30, stein: 15 }, buildTime: 14, needsRoad: true,
    jobs: { job: "handwerker", count: 2 }, recipe: { inputs: { holz: 2 }, outputs: { bretter: 1 }, cycle: 8 },
  },
  smithy: {
    id: "smithy", name: "Schmiede", category: "verarbeitung", size: [2, 2], unlock: 10, xp: 35, height: 56,
    desc: "Schmilzt Eisen mit Kohle zu Werkzeugen.", cost: { stein: 30, bretter: 25 }, buildTime: 22, needsRoad: true,
    jobs: { job: "handwerker", count: 2 },
    recipe: { inputs: { eisen: 2, kohle: 1 }, outputs: { werkzeuge: 1 }, cycle: 10 }, smoke: [0.6, 1.3, 52],
  },
  bakery: {
    id: "bakery", name: "Bäckerei", category: "verarbeitung", size: [2, 2], unlock: 5, xp: 20, height: 46,
    desc: "Backt aus Mehl Brot – die beste Nahrung.", cost: { holz: 20, stein: 20, bretter: 15 }, buildTime: 16,
    needsRoad: true, jobs: { job: "handwerker", count: 2 },
    recipe: { inputs: { mehl: 1 }, outputs: { brot: 1 }, cycle: 6 }, smoke: [1.4, 0.6, 44],
  },
  farm: {
    id: "farm", name: "Bauernhof", category: "landwirtschaft", size: [3, 3], unlock: 5, xp: 22, height: 50,
    desc: "Erntet Getreide von Feldern in der Nähe (3 Felder = volle Leistung).",
    cost: { holz: 30, stein: 10, bretter: 10 }, buildTime: 18, needsRoad: true, jobs: { job: "bauer", count: 2 },
    recipe: { inputs: {}, outputs: { getreide: 1 }, cycle: 4 },
    site: { kind: "fields", radius: 6, full: 3, label: "Felder" },
  },
  mill: {
    id: "mill", name: "Mühle", category: "landwirtschaft", size: [2, 2], unlock: 5, xp: 22, height: 62,
    desc: "Mahlt Getreide zu Mehl.", cost: { holz: 30, stein: 20, bretter: 10 }, buildTime: 16, needsRoad: true,
    jobs: { job: "handwerker", count: 1 }, recipe: { inputs: { getreide: 1 }, outputs: { mehl: 1 }, cycle: 3 },
  },
  field: {
    id: "field", name: "Feld", category: "landwirtschaft", size: [2, 2], unlock: 5, xp: 3, height: 4,
    desc: "Ackerland. Bauernhöfe in 6 Feldern Umkreis ernten hier.", cost: { holz: 8 }, buildTime: 5,
    needsRoad: false, flat: true,
  },
  road: {
    id: "road", name: "Straße", category: "infrastruktur", size: [1, 1], unlock: 1, xp: 1, height: 2,
    desc: "Verbindet Gebäude mit Lagerhaus. Ziehen mit der Maus zum Bauen.", cost: { holz: 1 }, buildTime: 1.2,
    needsRoad: false, flat: true,
  },
  warehouse: {
    id: "warehouse", name: "Lagerhaus", category: "infrastruktur", size: [3, 3], unlock: 1, xp: 25, height: 48,
    desc: "Erhöht alle Lagerlimits um 150 und ist Zentrum des Straßennetzes.", cost: { holz: 50, stein: 40 },
    buildTime: 20, needsRoad: false, hub: true, storage: 150, jobs: { job: "haendler", count: 1 },
  },
  market: {
    id: "market", name: "Marktplatz", category: "infrastruktur", size: [3, 3], unlock: 5, xp: 30, height: 40,
    desc: "Ermöglicht Handel (Kaufen/Verkaufen gegen Gold) und erhöht das Lager um 50.",
    cost: { holz: 40, stein: 40, bretter: 30 }, buildTime: 22, needsRoad: true, storage: 50,
    jobs: { job: "haendler", count: 3 },
  },
  barracks: {
    id: "barracks", name: "Kaserne", category: "militaer", size: [3, 3], unlock: 15, xp: 80, height: 54,
    desc: "Bildet Soldaten aus (2 Brot + 1 Werkzeug je Soldat, max. 10 pro Kaserne).",
    cost: { stein: 60, bretter: 40, werkzeuge: 20 }, buildTime: 30, needsRoad: true,
    jobs: { job: "soldat", count: 4 },
    recipe: { inputs: { brot: 2, werkzeuge: 1 }, outputs: {}, cycle: 60, special: "soldier" },
  },
  tower: {
    id: "tower", name: "Wachturm", category: "militaer", size: [1, 1], unlock: 15, xp: 35, height: 76,
    desc: "Bemannter Turm. Stärke +5.", cost: { stein: 40, holz: 20, bretter: 15, werkzeuge: 5 }, buildTime: 18,
    needsRoad: true, jobs: { job: "soldat", count: 1 }, military: 5,
  },
  castle: {
    id: "castle", name: "Burg", category: "militaer", size: [4, 4], unlock: 20, xp: 300, height: 110,
    desc: "Mächtige Festung. Stärke +30, Lager +100 und Zentrum des Straßennetzes.",
    cost: { stein: 200, bretter: 100, werkzeuge: 40, gold: 100 }, buildTime: 60, needsRoad: false, hub: true,
    storage: 100, jobs: { job: "soldat", count: 6 }, military: 30,
  },
};

export const BUILDING_IDS = Object.keys(BUILDINGS) as BuildingId[];

export interface UpgradeSpec {
  cost: ResAmounts;
  workerSlots: number;
  inputCapacity: number;
  outputCapacity: number;
  speed: number;
  range: number;
}

/** Level 2/3 sind bewusst zentral und datengetrieben definiert. */
export const UPGRADE_LEVELS: Partial<Record<BuildingId, { 2: UpgradeSpec; 3: UpgradeSpec }>> = Object.fromEntries(
  (["lumberjack", "forester", "sawmill", "warehouse", "farm", "mill", "bakery", "mine", "quarry"] as BuildingId[]).map((id) => [id, {
    2: { cost: { holz: 30, stein: 20, bretter: 10 }, workerSlots: 1, inputCapacity: 20, outputCapacity: 20, speed: 1.25, range: 1 },
    3: { cost: { holz: 60, stein: 40, bretter: 25, werkzeuge: 5 }, workerSlots: 2, inputCapacity: 35, outputCapacity: 35, speed: 1.5, range: 2 },
  }]),
) as Partial<Record<BuildingId, { 2: UpgradeSpec; 3: UpgradeSpec }>>;

/** Freischaltungs-Stufen (Anzeige) */
export const LEVEL_UNLOCKS: { level: number; name: string }[] = [
  { level: 1, name: "Grundgebäude" },
  { level: 5, name: "Landwirtschaft" },
  { level: 10, name: "Industrie" },
  { level: 15, name: "Militär" },
  { level: 20, name: "Fortgeschrittene Gebäude" },
];

/** Erfahrung, die für den Aufstieg von Level `l` auf `l+1` nötig ist */
export function xpToNext(l: number): number {
  return Math.round(50 + 30 * Math.pow(l - 1, 1.4));
}

/* -------------------------------------------------------------- Forschung */
export type TechEffect =
  | { kind: "prod"; buildings: BuildingId[]; mult: number }
  | { kind: "storage"; mult: number }
  | { kind: "trade"; discount: number }
  | { kind: "drill"; mult: number };

export interface TechDef {
  id: string; name: string; icon: string; desc: string; cost: ResAmounts; time: number; minLevel: number; effect: TechEffect;
}

export const TECHS: TechDef[] = [
  { id: "axes", name: "Schärfere Äxte", icon: "🪓", desc: "Holzfäller produzieren 25 % mehr.", cost: { holz: 80, stein: 40, gold: 15 }, time: 60, minLevel: 2, effect: { kind: "prod", buildings: ["lumberjack"], mult: 0.25 } },
  { id: "masonry", name: "Steinmetzkunst", icon: "🪨", desc: "Steinbrüche produzieren 25 % mehr.", cost: { stein: 100, bretter: 20, gold: 20 }, time: 90, minLevel: 3, effect: { kind: "prod", buildings: ["quarry"], mult: 0.25 } },
  { id: "threefield", name: "Dreifelderwirtschaft", icon: "🌾", desc: "Bauernhöfe ernten 25 % mehr Getreide.", cost: { bretter: 40, stein: 60, gold: 30 }, time: 120, minLevel: 6, effect: { kind: "prod", buildings: ["farm"], mult: 0.25 } },
  { id: "logistics", name: "Lagerwesen", icon: "📦", desc: "Alle Lagerlimits +50 %.", cost: { bretter: 60, stein: 80, gold: 40 }, time: 150, minLevel: 8, effect: { kind: "storage", mult: 0.5 } },
  { id: "tradelaw", name: "Handelsrechte", icon: "⚖️", desc: "Bessere Preise beim Handel (Kauf −15 %, Verkauf +15 %).", cost: { gold: 100, bretter: 40 }, time: 150, minLevel: 8, effect: { kind: "trade", discount: 0.15 } },
  { id: "deepmining", name: "Tiefbau", icon: "⛏️", desc: "Minen fördern 25 % mehr.", cost: { werkzeuge: 15, bretter: 40, gold: 60 }, time: 180, minLevel: 10, effect: { kind: "prod", buildings: ["mine"], mult: 0.25 } },
  { id: "craft", name: "Handwerkskunst", icon: "🛠️", desc: "Sägewerk, Mühle, Bäckerei und Schmiede arbeiten 20 % schneller.", cost: { werkzeuge: 20, bretter: 60, gold: 80 }, time: 200, minLevel: 12, effect: { kind: "prod", buildings: ["sawmill", "mill", "bakery", "smithy"], mult: 0.2 } },
  { id: "drill", name: "Militärdrill", icon: "🛡️", desc: "Kasernen bilden Soldaten doppelt so schnell aus.", cost: { werkzeuge: 30, gold: 120 }, time: 240, minLevel: 15, effect: { kind: "drill", mult: 1 } },
];

/* ------------------------------------------------------ Produktionsketten */
export type ChainNode = { t: "b"; id: BuildingId } | { t: "r"; id: ResId } | { t: "pop" };
export const CHAINS: { name: string; nodes: ChainNode[] }[] = [
  { name: "Holz", nodes: [{ t: "b", id: "lumberjack" }, { t: "r", id: "holz" }, { t: "b", id: "sawmill" }, { t: "r", id: "bretter" }] },
  { name: "Stein", nodes: [{ t: "b", id: "quarry" }, { t: "r", id: "stein" }] },
  { name: "Nahrung", nodes: [{ t: "b", id: "farm" }, { t: "r", id: "getreide" }, { t: "b", id: "mill" }, { t: "r", id: "mehl" }, { t: "b", id: "bakery" }, { t: "r", id: "brot" }, { t: "pop" }] },
  { name: "Erz & Werkzeug", nodes: [{ t: "b", id: "mine" }, { t: "r", id: "eisen" }, { t: "b", id: "smithy" }, { t: "r", id: "werkzeuge" }] },
];

/* ---------------------------------------------------------------- Aufgaben */
export type QuestCond =
  | { type: "build"; building: BuildingId; count: number }
  | { type: "pop"; n: number }
  | { type: "stock"; res: ResId; n: number }
  | { type: "level"; n: number }
  | { type: "prod"; res: ResId; n: number }
  | { type: "military"; n: number }
  | { type: "research"; n: number }
  | { type: "trade"; n: number };

export interface QuestDef {
  id: string; title: string; minLevel: number; cond: QuestCond; xp: number; reward?: ResAmounts;
}

const q = (id: string, title: string, minLevel: number, cond: QuestCond, xp: number, reward?: ResAmounts): QuestDef =>
  ({ id, title, minLevel, cond, xp, reward });

export const QUESTS: QuestDef[] = [
  q("q1", "Baue einen Holzfäller", 1, { type: "build", building: "lumberjack", count: 1 }, 25, { holz: 30 }),
  q("q2", "Baue einen Steinbruch", 1, { type: "build", building: "quarry", count: 1 }, 25, { stein: 20 }),
  q("q3", "Verlege 16 Straßen", 1, { type: "build", building: "road", count: 16 }, 25, { holz: 20 }),
  q("q4", "Baue ein Sägewerk", 1, { type: "build", building: "sawmill", count: 1 }, 35, { bretter: 10 }),
  q("q5", "Baue 4 kleine Wohnhäuser", 1, { type: "build", building: "house_s", count: 4 }, 35, { holz: 40 }),
  q("q6", "Erreiche 20 Einwohner", 1, { type: "pop", n: 20 }, 45, { getreide: 40 }),
  q("q7", "Lagere 50 Bretter", 1, { type: "stock", res: "bretter", n: 50 }, 45, { stein: 40 }),
  q("q8", "Baue ein zweites Lagerhaus", 2, { type: "build", building: "warehouse", count: 2 }, 50, { holz: 60, stein: 40 }),
  q("q9", "Schließe eine Forschung ab", 2, { type: "research", n: 1 }, 50, { gold: 20 }),
  q("q10", "Erreiche 35 Einwohner", 3, { type: "pop", n: 35 }, 70, { bretter: 20 }),
  q("q11", "Erreiche Level 5", 3, { type: "level", n: 5 }, 120, { bretter: 40, gold: 30 }),
  q("q12", "Baue einen Bauernhof", 5, { type: "build", building: "farm", count: 1 }, 50, { holz: 40 }),
  q("q13", "Lege 3 Felder an", 5, { type: "build", building: "field", count: 3 }, 50, { holz: 30 }),
  q("q14", "Baue eine Mühle", 5, { type: "build", building: "mill", count: 1 }, 60, { stein: 30 }),
  q("q15", "Baue eine Bäckerei", 5, { type: "build", building: "bakery", count: 1 }, 70, { bretter: 20 }),
  q("q16", "Produziere 6 Brot pro Minute", 5, { type: "prod", res: "brot", n: 6 }, 120, { gold: 30 }),
  q("q17", "Baue einen Marktplatz", 5, { type: "build", building: "market", count: 1 }, 80, { gold: 30 }),
  q("q18", "Führe 3 Handelsgeschäfte durch", 5, { type: "trade", n: 3 }, 80, { gold: 30 }),
  q("q19", "Baue 3 mittlere Wohnhäuser", 5, { type: "build", building: "house_m", count: 3 }, 100, { bretter: 30 }),
  q("q20", "Erreiche 60 Einwohner", 6, { type: "pop", n: 60 }, 160, { bretter: 40 }),
  q("q21", "Erreiche Level 10", 8, { type: "level", n: 10 }, 300, { gold: 100, bretter: 60 }),
  q("q22", "Baue eine Mine", 10, { type: "build", building: "mine", count: 1 }, 100, { holz: 50 }),
  q("q23", "Baue eine Schmiede", 10, { type: "build", building: "smithy", count: 1 }, 120, { stein: 50 }),
  q("q24", "Produziere 3 Werkzeuge pro Minute", 10, { type: "prod", res: "werkzeuge", n: 3 }, 200, { gold: 60 }),
  q("q25", "Baue 2 große Wohnhäuser", 10, { type: "build", building: "house_l", count: 2 }, 220, { bretter: 50 }),
  q("q26", "Erreiche 150 Einwohner", 11, { type: "pop", n: 150 }, 300, { werkzeuge: 15 }),
  q("q27", "Lagere 200 Gold", 11, { type: "stock", res: "gold", n: 200 }, 250, { werkzeuge: 10 }),
  q("q28", "Baue eine Kaserne", 15, { type: "build", building: "barracks", count: 1 }, 250, { werkzeuge: 10 }),
  q("q29", "Baue 2 Wachtürme", 15, { type: "build", building: "tower", count: 2 }, 300, { stein: 80 }),
  q("q30", "Erreiche 20 Militärstärke", 15, { type: "military", n: 20 }, 400, { gold: 100 }),
  q("q31", "Erreiche Level 20", 17, { type: "level", n: 20 }, 600, { gold: 150 }),
  q("q32", "Errichte eine Burg", 20, { type: "build", building: "castle", count: 1 }, 800, { gold: 200 }),
  q("q33", "Erreiche 400 Einwohner", 20, { type: "pop", n: 400 }, 1000, { gold: 300 }),
  q("q34", "Erreiche 100 Militärstärke", 20, { type: "military", n: 100 }, 1200, { gold: 400 }),
];

/* --------------------------------------------------- Status-Beschreibungen */
export type BStatus =
  | "constructing" | "ok" | "no_road" | "no_workers" | "no_input" | "storage_full" | "no_site" | "depleted";

export const STATUS_TEXT: Record<BStatus, { label: string; color: string }> = {
  constructing: { label: "Im Bau", color: "#d4a84b" },
  ok: { label: "Arbeitet", color: "#5fbf6a" },
  no_road: { label: "Keine Straßenanbindung", color: "#e0703a" },
  no_workers: { label: "Keine Arbeiter", color: "#e0703a" },
  no_input: { label: "Rohstoffe fehlen", color: "#e04a4a" },
  storage_full: { label: "Lager voll", color: "#d4c84b" },
  no_site: { label: "Standort ungeeignet", color: "#e04a4a" },
  depleted: { label: "Vorkommen erschöpft", color: "#e04a4a" },
};
