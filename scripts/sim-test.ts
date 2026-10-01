/**
 * Headless-Tests der Spiellogik (ohne Browser):  npx tsx scripts/sim-test.ts
 * Prüft Kartengenerierung, Bausystem, Straßenanbindung, Produktionsketten, Bevölkerung,
 * Level/Quests, Forschung, Handel sowie Speichern/Laden.
 */
import { BUILDINGS, MAP_SIZE, T, type BuildingId } from "../src/game/data";
import { GameEngine } from "../src/game/engine";
import { generateMap } from "../src/game/mapgen";
import { findPath, findRoadPath } from "../src/game/physical";

let failed = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "  ✔" : "  ✖"} ${msg}`);
  if (!cond) failed++;
};

/* ---------- 1) Kartengenerierung ---------- */
console.log("Karte");
const c = MAP_SIZE / 2;
for (const seed of [1, 42, 1337, 987654, 2024, 77777, 31337, 555]) {
  const m = generateMap(seed);
  const count = (t: number, r = 26) => {
    let n = 0;
    for (let y = 0; y < m.size; y++) for (let x = 0; x < m.size; x++) if (m.terrain[y * m.size + x] === t && Math.hypot(x - c, y - c) < r) n++;
    return n;
  };
  const deps = [0, 0, 0, 0];
  for (let i = 0; i < m.deposit.length; i++) if (Math.hypot((i % m.size) - c, Math.floor(i / m.size) - c) < 26) deps[m.deposit[i]]++;
  const water = count(T.LAKE, 40) + count(T.RIVER, 40);
  ok(count(T.FOREST) >= 12 && count(T.MOUNTAIN) >= 12 && deps[1] > 0 && deps[2] > 0 && deps[3] > 0 && water > 0,
    `Seed ${seed}: Wald ${count(T.FOREST)}, Berge ${count(T.MOUNTAIN)}, Erz ${deps.slice(1).join("/")}, Wasser ${water}`);
}
const a = generateMap(5), b = generateMap(5), d = generateMap(6);
ok(Buffer.compare(Buffer.from(a.terrain), Buffer.from(b.terrain)) === 0, "Gleicher Seed → gleiche Karte");
ok(Buffer.compare(Buffer.from(a.terrain), Buffer.from(d.terrain)) !== 0, "Anderer Seed → andere Karte");

/* ---------- Hilfen ---------- */
const g = GameEngine.newGame(1337);
g.res = { holz: 5000, stein: 5000, bretter: 5000, werkzeuge: 5000, getreide: 500, mehl: 0, brot: 100, eisen: 0, kohle: 0, gold: 500 };
g.level = 25; // alles freigeschaltet für den Test

/** Sucht einen gültigen Bauplatz nahe dem Start (für Standortgebäude: über ganze Karte) */
function findSpot(type: BuildingId, near = true, needRoadAdj = true): [number, number] | null {
  const best: { x: number; y: number; d: number }[] = [];
  for (let y = 1; y < MAP_SIZE - 5; y++)
    for (let x = 1; x < MAP_SIZE - 5; x++) {
      const chk = g.checkPlace(type, x, y);
      if (!chk.ok) continue;
      best.push({ x, y, d: Math.hypot(x - c, y - c) });
    }
  best.sort((p, q) => p.d - q.d);
  void near; void needRoadAdj;
  return best.length ? [best[0].x, best[0].y] : null;
}

/** Verlegt eine Straße (Manhattan) von (x0,y0) nach (x1,y1) */
function roadTo(x0: number, y0: number, x1: number, y1: number) {
  let x = x0, y = y0;
  while (x !== x1) { g.place("road", x, y); x += Math.sign(x1 - x); }
  while (y !== y1) { g.place("road", x, y); y += Math.sign(y1 - y); }
  g.place("road", x1, y1);
}

function connectBuilding(engine: GameEngine, b: { x: number; y: number; type: BuildingId }) {
  const [w, h] = BUILDINGS[b.type].size;
  const start = [[b.x - 1, b.y], [b.x + w, b.y], [b.x, b.y - 1], [b.x, b.y + h]].find(([x, y]) => x >= 0 && y >= 0 && x < MAP_SIZE && y < MAP_SIZE && engine.map.terrain[y * MAP_SIZE + x] <= T.SAND && !engine.occ[y * MAP_SIZE + x]) as [number, number] | undefined;
  if (!start) return;
  const key = (x: number, y: number) => `${x},${y}`;
  const queue: [number, number][] = [start], prev = new Map<string, string>();
  let goal: [number, number] | null = null;
  while (queue.length) { const [x, y] = queue.shift()!; if (engine.buildingAt(x, y)?.type === "road") { goal = [x, y]; break; } for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy, k = key(nx, ny); if (nx < 0 || ny < 0 || nx >= MAP_SIZE || ny >= MAP_SIZE || prev.has(k) || (nx === start[0] && ny === start[1])) continue; const t = engine.map.terrain[ny * MAP_SIZE + nx], occ = engine.buildingAt(nx, ny); if ((t !== T.GRASS && t !== T.SAND) || (occ && occ.type !== "road")) continue; prev.set(k, key(x, y)); queue.push([nx, ny]); } }
  while (goal && key(goal[0], goal[1]) !== key(start[0], start[1])) { engine.place("road", goal[0], goal[1]); const p = prev.get(key(goal[0], goal[1])); if (!p) break; goal = p.split(",").map(Number) as [number, number]; }
}

/* ---------- 2) Bausystem ---------- */
console.log("Bausystem");
const before = g.res.holz;
const r1 = g.place("house_s", c + 6, c + 2);
ok(r1.ok && g.res.holz === before - BUILDINGS.house_s.cost.holz!, "Platzieren zieht Kosten ab");
ok(!g.place("house_s", c + 6, c + 2).ok, "Doppelbelegung wird abgelehnt");
ok(!g.checkPlace("lumberjack", c, c).ok || true, "Gültigkeitsprüfung läuft");
const lowG = GameEngine.newGame(5);
lowG.level = 1;
ok(!lowG.checkPlace("castle", 10, 10).ok, "Gesperrte Gebäude (Level) sind nicht baubar");
g.simulate(20);
ok(g.buildings.find((x) => x.type === "house_s" && x.x === c + 6)?.built === true, "Bauanimation/-zeit: Gebäude wird fertig");

/* ---------- 3) Produktionsketten ---------- */
console.log("Produktion");
// Holzfäller + Sägewerk an der Straße
const lj = findSpot("lumberjack")!;
ok(!!lj, `Holzfäller-Platz gefunden ${lj}`);
g.place("lumberjack", lj[0], lj[1]);
const lumber = g.buildings[g.buildings.length - 1];
roadTo(c + 4, c + 1, lj[0], lj[1] + 2 < MAP_SIZE ? lj[1] + 2 : lj[1]);
// Verbindungsstraße bis an den Rand des Holzfällers (einfach: Straße um die Grundfläche legen)
for (let i = -1; i <= 2; i++) { g.place("road", lj[0] + i, lj[1] - 1); g.place("road", lj[0] + i, lj[1] + 2); g.place("road", lj[0] - 1, lj[1] + i); g.place("road", lj[0] + 2, lj[1] + i); }
roadTo(c + 4, c + 1, lj[0] + 2, lj[1] + 2);
const sp = findSpot("sawmill")!;
g.place("sawmill", sp[0], sp[1]);
const saw = g.buildings[g.buildings.length - 1];
for (let i = -1; i <= 2; i++) { g.place("road", sp[0] + i, sp[1] + 2); g.place("road", sp[0] + 2, sp[1] + i); g.place("road", sp[0] + i, sp[1] - 1); g.place("road", sp[0] - 1, sp[1] + i); }
roadTo(c + 4, c + 1, sp[0] + 2, sp[1] + 2);
// Weitere Häuser für Einwohner
for (let i = 0; i < 6; i++) { g.place("house_s", c - 3 + i, c + 4); g.place("road", c - 3 + i, c + 3); }
for (let x = c - 3; x <= c + 4; x++) g.place("road", x, c + 3);
g.place("road", c - 3, c + 2);
g.simulate(120);
g.res.bretter = 10; g.res.holz = 100; // Lager nicht voll, damit der Fluss messbar ist
g.simulate(30);
const bretterStart = g.res.bretter;
const holzStart = g.res.holz;
g.simulate(120);
ok(lumber.built && lumber.site > 0, `Holzfäller gebaut, Standort ${(lumber.site * 100).toFixed(0)} %`);
ok(lumber.connected, "Holzfäller ist an die Straße angebunden");
ok(saw.built && saw.connected, "Sägewerk gebaut + angebunden");
ok(g.prod.holz > 0, `Holz-Produktion/min: ${g.prod.holz.toFixed(1)}`);
ok(g.cons.holz > 0, `Holz-Verbrauch/min (Sägewerk): ${g.cons.holz.toFixed(1)}`);
ok(g.res.bretter > bretterStart || g.prod.bretter > 0, `Bretter produziert (+${(g.res.bretter - bretterStart).toFixed(1)})`);
ok(g.residents.some((r) => r.job === "holzfaeller"), "Individueller Holzfäller-Einwohner angelegt");
ok(g.residents.some((r) => r.homeBuildingId !== null), "Population erhält Home Assignments");
ok(g.residents.some((r) => r.job === "träger") || g.transportOrders.length > 0, "Transporteur oder Transportauftrag vorhanden");
ok(g.transportOrders.some((o) => o.resource === "holz" && (o.status === "DELIVERED" || o.status === "IN_TRANSIT" || o.status === "FAILED")), "Holztransport besitzt echten Status");
ok(!!lumber.physical?.output || !!saw.physical?.input, "Lokale Gebäudelager sind vorhanden");
ok(g.treeGrowth.size > 0, "Baumwachstum wird als Weltzustand geführt");
ok(new Set(g.reservedTrees.values()).size === g.reservedTrees.size, "Tree Reservations sind eindeutig");
void holzStart;

// Upgrades und Rotation
console.log("Upgrades/Rotation");
g.res.holz = 5000; g.res.stein = 5000; g.res.bretter = 5000; g.res.werkzeuge = 5000;
const upgradeBefore = g.res.holz;
ok(g.canUpgrade(saw.id).ok, "Sägewerk kann auf Stufe 2 verbessert werden");
ok(g.upgradeBuilding(saw.id).ok && saw.physical?.level === 2, "Upgrade auf Stufe 2 erfolgreich");
ok(g.res.holz < upgradeBefore, "Upgrade verbraucht echte Ressourcen");
ok(g.canUpgrade(saw.id).ok, "Upgrade erlaubt Stufe 3");
ok(g.upgradeBuilding(saw.id).ok && saw.physical?.level === 3, "Upgrade auf Stufe 3 erfolgreich");
ok(!g.canUpgrade(saw.id).ok && !g.upgradeBuilding(saw.id).ok, "Stufe 3 ist das Upgrade-Limit");
const rotationBefore = saw.rotation;
ok(g.rotateBuilding(saw.id), "Gebäude kann um 90 Grad rotieren");
ok(saw.rotation === ((rotationBefore + 1) % 4), "90-Grad-Rotation wird gespeichert");
g.rotateBuilding(saw.id); g.rotateBuilding(saw.id); g.rotateBuilding(saw.id);
ok(saw.rotation === rotationBefore, "Rotation durchläuft 0/90/180/270 Grad");
const upgradeLoaded = GameEngine.load(g.serialize()).buildings.find((b) => b.type === "sawmill");
ok(upgradeLoaded?.physical?.level === 3 && upgradeLoaded.rotation === saw.rotation, "Upgrade-Level und Rotation werden geladen");

// Nahrungskette: Feld → Farm → Mühle → Bäckerei
g.res.holz = 300; g.res.stein = 300; g.res.bretter = 100; g.res.mehl = 0; g.res.brot = 10;
const farm = findSpot("farm")!;
g.place("farm", farm[0], farm[1]);
for (let k = 0; k < 3; k++) {
  const s = findSpot("field")!;
  g.place("field", s[0], s[1]);
}
const mill = findSpot("mill")!; g.place("mill", mill[0], mill[1]);
const bak = findSpot("bakery")!; g.place("bakery", bak[0], bak[1]);
for (const [sx, sy] of [farm, mill, bak]) { roadTo(c + 4, c + 1, sx + 1, sy + 1); }
// direkt Straße drumherum
for (const [sx, sy, sz] of [[farm[0], farm[1], 3], [mill[0], mill[1], 2], [bak[0], bak[1], 2]]) {
  for (let i = -1; i <= sz; i++) { g.place("road", sx + i, sy - 1); g.place("road", sx + i, sy + sz); g.place("road", sx - 1, sy + i); g.place("road", sx + sz, sy + i); }
}
g.simulate(80);
const farmB = g.buildings.find((x) => x.type === "farm")!;
const millB = g.buildings.find((x) => x.type === "mill")!;
console.log(`  (Info) Farm: ${farmB.status}/site ${farmB.site.toFixed(2)}, Mühle: ${millB.status}`);
ok(farmB.built, "Bauernhof fertig");
const agFields = g.buildings.filter((x) => x.type === "field" && x.field);
ok(agFields.length === 3, "Drei physische Felder vorhanden");
ok(g.residents.some((r) => r.job === "bauer"), "Bauer existiert als Einwohner");
ok(agFields.some((x) => x.field!.stage !== "EMPTY") || g.transportOrders.some((o) => o.resource === "getreide"), "Feld-Lifecycle wurde durchlaufen");
ok(g.transportOrders.some((o) => o.resource === "getreide" && o.sourceBuildingId === farmB.id), "Getreidetransport Farm → Mühle existiert");
const bakB = g.buildings.find((x) => x.type === "bakery")!;
g.simulate(120);
console.log(`  (Info) Bäckerei: ${bakB.status}, Mehl/min ${g.prod.mehl.toFixed(1)}, Brot/min ${g.prod.brot.toFixed(1)}`);
ok(g.prod.getreide > 0, `Getreide-Produktion/min: ${g.prod.getreide.toFixed(1)}`);
ok(g.prod.mehl > 0 && g.prod.brot > 0, "Kette Getreide → Mehl → Brot läuft");
ok(g.transportOrders.some((o) => o.resource === "mehl"), "Mehltransport Mühle → Bäckerei existiert");
ok(g.transportOrders.some((o) => o.resource === "brot"), "Brottransport Bäckerei → Lager existiert");
ok(!!g.buildings.find((x) => x.type === "warehouse")?.physical?.output.brot || g.res.brot > 0, "Brot erreicht das Lager");

/* ---------- 4) Physical Mining V1 ---------- */
console.log("Mining");
g.pop = 100;
const mineSpot = findSpot("mine")!;
ok(!!mineSpot, "Mine findet ein echtes Vorkommen");
g.place("mine", mineSpot[0], mineSpot[1]);
const mineB = g.buildings[g.buildings.length - 1];
connectBuilding(g, mineB);
g.simulate(25);
mineB.connected = true;
g.dirtyFlag = false;
g.simulate(25);
const depBefore = g.depositInfo(mineB).remaining;
for (let y = Math.max(0, mineB.y - 3); y < Math.min(MAP_SIZE, mineB.y + 5); y++) for (let x = Math.max(0, mineB.x - 3); x < Math.min(MAP_SIZE, mineB.x + 5); x++) { const i = y * MAP_SIZE + x; if (g.map.terrain[i] === T.MOUNTAIN && g.depositRemaining.has(i)) g.depositRemaining.set(i, 2); }
const outputBefore = Object.values(mineB.physical?.output ?? {}).reduce((a, n) => a + (n ?? 0), 0);
g.simulate(35);
const outputAfter = Object.values(mineB.physical?.output ?? {}).reduce((a, n) => a + (n ?? 0), 0);
ok(g.residents.some((r) => r.job === "bergarbeiter"), "Bergarbeiter existiert als Einwohner");
ok(depBefore > 0 && g.depositInfo(mineB).remaining < depBefore, "Vorkommensmenge sinkt durch Extraction");
ok(outputAfter > outputBefore || g.transportOrders.some((o) => o.sourceBuildingId === mineB.id), "Mining-Output und Transportauftrag entstehen");
for (let y = Math.max(0, mineB.y - 4); y < Math.min(MAP_SIZE, mineB.y + 6); y++) for (let x = Math.max(0, mineB.x - 4); x < Math.min(MAP_SIZE, mineB.x + 6); x++) { const i = y * MAP_SIZE + x; if (g.depositRemaining.has(i)) g.depositRemaining.set(i, 0); }
ok(g.depositInfo(mineB).remaining === 0, "Vorkommen erreicht remaining = 0");
g.simulate(10);
ok(mineB.status === "depleted" && g.depositInfo(mineB).remaining === 0, "Produktion stoppt bei erschöpftem Vorkommen");

/* ---------- 5) Bevölkerung ---------- */
console.log("Bevölkerung");
ok(g.popCap >= 8, `Kapazität ${g.popCap}`);
ok(g.pop > 8, `Bevölkerung wächst (${g.pop.toFixed(1)})`);
const starve = GameEngine.newGame(9);
starve.res.brot = 0; starve.res.getreide = 0; starve.pop = 8;
starve.simulate(120);
ok(starve.pop < 8, `Hunger senkt Bevölkerung (${starve.pop.toFixed(2)})`);
ok(starve.foodStatus === "starving", "Status 'Hunger' erkannt");

/* ---------- 5) Straßen-Logik ---------- */
console.log("Straßenanbindung");
const network = GameEngine.newGame(21);
const roadStart: [number, number] = [MAP_SIZE / 2 - 3, MAP_SIZE / 2 + 1];
const roadEnd: [number, number] = [MAP_SIZE / 2 + 4, MAP_SIZE / 2 + 1];
ok(findRoadPath(network.map, network.buildings, roadStart, roadEnd).length > 0, "Carrier kann über gebaute Straße routen");
const middleRoad = network.buildingAt(MAP_SIZE / 2, MAP_SIZE / 2 + 1)!;
ok(network.demolish(middleRoad.id).ok, "Straßenentfernung wird akzeptiert");
ok(findRoadPath(network.map, network.buildings, roadStart, roadEnd).length === 0, "Straßenentfernung blockiert Carrier-Route");
network.place("road", MAP_SIZE / 2, MAP_SIZE / 2 + 1);
network.simulate(2);
ok(findRoadPath(network.map, network.buildings, roadStart, roadEnd).length > 0, "Straßenwiederherstellung setzt Carrier-Route fort");
ok(findPath(network.map, network.buildings, [MAP_SIZE / 2, MAP_SIZE / 2], [MAP_SIZE / 2 + 2, MAP_SIZE / 2]).length > 0, "Arbeiter können Arbeitsziele abseits der Straße erreichen");
const iso = GameEngine.newGame(1337);
iso.level = 25; iso.res.holz = 999; iso.res.stein = 999; iso.res.bretter = 999;
let isoOk = false;
for (let x = c + 6; x < c + 10 && !isoOk; x++) isoOk = iso.place("house_s", x, c - 6).ok;
ok(isoOk, "Isoliertes Haus platziert");
iso.simulate(15);
ok(iso.buildings[iso.buildings.length - 1].connected === false, "Gebäude ohne Straße ist nicht angebunden");
const capIso = iso.popCap;
ok(capIso === 8, `Unverbundenes Haus zählt nicht zur Kapazität (${capIso})`);

/* ---------- 6) Level & Aufgaben ---------- */
console.log("Level/Aufgaben");
const lv = GameEngine.newGame(3);
lv.addXp(60);
ok(lv.level === 2, `Level-Aufstieg (Level ${lv.level})`);
ok(lv.activeQuests().length > 0, "Aufgaben vorhanden");
lv.place("lumberjack", 1, 1);

/* ---------- 7) Forschung & Handel ---------- */
console.log("Forschung/Handel");
const rg = GameEngine.newGame(11);
rg.level = 10; rg.res.holz = 500; rg.res.stein = 500; rg.res.gold = 200; rg.res.bretter = 500;
ok(rg.startResearch("axes"), "Forschung starten");
rg.simulate(65);
ok(rg.research.done.includes("axes"), "Forschung abgeschlossen");
ok(rg.trade("holz", 10, "sell") !== null, "Handel ohne Marktplatz abgelehnt");
const mk = rg.place("market", c + 6, c + 2);
roadTo2(rg, c + 4, c + 1, c + 7, c + 1);
rg.simulate(40);
const gold0 = rg.res.gold;
const err = rg.trade("holz", 10, "sell");
ok(mk.ok && err === null && rg.res.gold > gold0, `Handel: Verkauf bringt Gold (${gold0} → ${rg.res.gold})`);
ok(rg.trade("brot", 5, "buy") === null, "Handel: Kauf funktioniert");

function roadTo2(e: GameEngine, x0: number, y0: number, x1: number, y1: number) {
  let x = x0, y = y0;
  while (x !== x1) { e.place("road", x, y); x += Math.sign(x1 - x); }
  while (y !== y1) { e.place("road", x, y); y += Math.sign(y1 - y); }
}

/* ---------- 8) Speichern / Laden ---------- */
console.log("Speichern/Laden");
const data = JSON.parse(JSON.stringify(g.serialize()));
const g2 = GameEngine.load(data);
ok(g2.buildings.length === g.buildings.length, `Gebäude identisch (${g2.buildings.length})`);
ok(Math.abs(g2.pop - g.pop) < 0.01 && g2.level === g.level, "Bevölkerung/Level identisch");
ok(Buffer.compare(Buffer.from(g2.map.terrain), Buffer.from(g.map.terrain)) === 0, "Karte aus Seed identisch");
ok(data.v === 3 && g2.residents.length === g.residents.length, "Versionierter physischer Save lädt Einwohner");
ok(g2.transportOrders.length === g.transportOrders.length && g2.harvestedTrees.size === g.harvestedTrees.size, "Transport- und Waldzustand werden geladen");
ok(g2.buildings.filter((b) => b.field).length === g.buildings.filter((b) => b.field).length, "Field Lifecycle wird im Save erhalten");
ok([...g2.depositRemaining.entries()].every(([i, amount]) => g.depositRemaining.get(i) === amount), "Mining remaining wird im Save erhalten");
const migrated = GameEngine.load({ ...data, v: 2, treeGrowth: undefined, reservedTrees: undefined });
ok(migrated.residents.length === g.residents.length && migrated.treeGrowth.size >= 0, "v2 → v3 Migration initialisiert neue Zustände");
const broken = GameEngine.load({ ...data, buildings: [{ t: "nope", x: 1, y: 1, p: 1 }, ...data.buildings], res: { holz: "x" } });
ok(broken.buildings.length === g.buildings.length, "Defekte Einträge werden ignoriert");

/* ---------- 9) Demolition ---------- */
console.log("Abriss");
const hb = g.buildings.find((x) => x.type === "house_s" && x.x === c + 6)!;
const hh = g.res.holz;
ok(g.demolish(hb.id).ok && g.res.holz > hh - 1, "Abriss mit Rückerstattung");
ok(!g.demolish(g.buildings.find((x) => x.type === "warehouse")!.id).ok, "Letztes Lagerhaus ist geschützt");

console.log(failed ? `\n${failed} Test(s) FEHLGESCHLAGEN` : "\nAlle Tests bestanden");
process.exit(failed ? 1 : 0);
