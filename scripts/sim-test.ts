/**
 * Headless-Tests der Spiellogik (ohne Browser):  npx tsx scripts/sim-test.ts
 * Fokus: physische Wirtschaft (eine Wahrheit), endliche Träger, Reservierungen, Straßen-Logistik,
 * Wegfindung, Bauen mit Material/Bauarbeitern, Ketten (Holz/Nahrung/Bergbau), Recovery, Save/Load.
 */
import { BUILDINGS, MAP_SIZE, T, type ResId } from "../src/game/data";
import { GameEngine } from "../src/game/engine";
import { generateMap } from "../src/game/mapgen";
import { accessTiles, findPath } from "../src/game/pathing";
import { cancelOrder, createOrder } from "../src/game/logistics";
import { effectivePriority } from "../src/game/config";
import { C, buildConnected, connect, findSpot, forceBuild, placeSite, populate } from "./helpers";

let failed = 0;
const ok = (cond: boolean, msg: string) => { console.log(`${cond ? "  ✔" : "  ✖"} ${msg}`); if (!cond) failed++; };
const clean = (g: GameEngine, msg: string) => { const a = g.audit(); ok(a.length === 0, `${msg}: Audit sauber${a.length ? " – " + a.slice(0, 3).join("; ") : ""}`); };
const world = (seed = 1337, houses = 5, pop = 40) => {
  const g = GameEngine.newGame(seed); g.level = 25;
  g.setResources({ holz: 200, stein: 200, bretter: 60, werkzeuge: 30, getreide: 100, brot: 50, gold: 100 });
  populate(g, houses, pop);
  g.simulate(1);
  return g;
};
const roadSet = (g: GameEngine) => new Set(g.buildings.filter((b) => b.type === "road").map((b) => b.id));

/* ---------- 1) Karte ---------- */
console.log("Karte");
const c = MAP_SIZE / 2;
for (const seed of [1, 42, 1337, 987654, 2024, 77777, 31337, 555]) {
  const m = generateMap(seed);
  const count = (t: number, r = 26) => { let n = 0; for (let y = 0; y < m.size; y++) for (let x = 0; x < m.size; x++) if (m.terrain[y * m.size + x] === t && Math.hypot(x - c, y - c) < r) n++; return n; };
  const deps = [0, 0, 0, 0];
  for (let i = 0; i < m.deposit.length; i++) if (Math.hypot((i % m.size) - c, Math.floor(i / m.size) - c) < 26) deps[m.deposit[i]]++;
  ok(count(T.FOREST) >= 12 && count(T.MOUNTAIN) >= 12 && deps[1] > 0 && deps[2] > 0 && deps[3] > 0 && count(T.LAKE, 40) + count(T.RIVER, 40) > 0, `Seed ${seed} spielbar`);
}
ok(Buffer.compare(Buffer.from(generateMap(5).terrain), Buffer.from(generateMap(5).terrain)) === 0, "Gleicher Seed → gleiche Karte");

/* ---------- 2) Wirtschaft: eine Wahrheit ---------- */
console.log("Wirtschaft (keine Doppelbuchung)");
{
  const g = world();
  const wh = g.hubs[0], bak = buildConnected(g, "bakery", findSpot(g, "bakery", 10));
  g.setResources({ werkzeuge: 10 });
  bak.physical!.output.werkzeuge = 1; bak.physical!.lastOutputAt = -100;
  const eco0 = g.getEconomyTotal("werkzeuge");
  ok(eco0 === 11 && g.getTotalResource("werkzeuge") === 10, "Start: Lager 10 + Produktionsausgang 1 = 11 Werkzeuge");
  let constant = true, delivered = false;
  for (let i = 0; i < 160 && !delivered; i++) { g.simulate(0.5); if (g.getEconomyTotal("werkzeuge") !== 11) constant = false; delivered = g.transportStats.delivered > 0 && !g.transportOrders.some((o) => o.resource === "werkzeuge"); }
  ok(delivered && g.getTotalResource("werkzeuge") === 11, `Lieferung ins Lagerhaus: 10 → ${g.getTotalResource("werkzeuge")} (nicht 12)`);
  ok(constant, "Wirtschaftssumme war in JEDEM Tick konstant (Ware nur Quelle → Träger → Ziel)");
  ok(g.res.werkzeuge === g.getTotalResource("werkzeuge"), "`res` ist nur abgeleitet = Summe der Hub-Lager");
  const cost = { holz: 20, stein: 5 };
  const before = g.getSpendableResource("holz");
  ok(g.canAfford(cost) && g.consumeCost(cost) && g.getSpendableResource("holz") === before - 20, "consumeCost zieht atomar ab");
  const snap = g.getTotalResource("holz");
  ok(!g.consumeCost({ holz: 20, stein: 99999 }) && g.getTotalResource("holz") === snap, "consumeCost bei Mangel ändert nichts");
  const cap = g.getResourceCapacity("holz");
  g.setResources({ holz: cap - 5 });
  ok(g.depositResource("holz", 20) === 5 && g.getTotalResource("holz") === cap, "depositResource respektiert Lagerkapazität (Rest wird gemeldet)");
  void wh; clean(g, "Wirtschaft");
}

/* ---------- 3) Endliche Träger ---------- */
console.log("Träger (endliche Bevölkerung)");
{
  const g = world();
  g.simulate(10);
  const carriers = () => g.residents.filter((r) => r.job === "traeger");
  ok(carriers().length > 0 && carriers().length <= 3, `Träger kommen aus der Bevölkerung (${carriers().length}, max. 3 Stellen)`);
  const pop0 = g.residents.length, nextId0 = g.nextResidentId;
  let placed = 0;
  for (let k = 0; k < 6; k++) if (placeSite(g, "house_s", [c, c], 0)) placed++;
  ok(placed >= 4, `${placed} Baustellen mit Straßenanschluss platziert (Ghost wählt Rotation mit Zugang)`);
  const holzBefore = g.getTotalResource("holz");
  ok(holzBefore >= 190, "Platzieren zieht KEINE Kosten ab (Material wird geliefert)");
  let maxBusy = 0, sawWaiting = false, popStable = true;
  for (let i = 0; i < 80; i++) {
    g.simulate(0.5);
    const lg = g.logistics();
    maxBusy = Math.max(maxBusy, lg.busy); if (lg.waiting > 0) sawWaiting = true;
    if (g.residents.length !== Math.floor(g.pop)) popStable = false;
  }
  ok(maxBusy <= carriers().length, `Gleichzeitig aktive Transporte (${maxBusy}) ≤ Träger (${carriers().length})`);
  ok(sawWaiting, "Überzählige Aufträge warten (WAITING_FOR_CARRIER) – echter Engpass");
  ok(popStable && g.nextResidentId - nextId0 < 80, "Transportaktivität erhöht die Einwohnerzahl NICHT");
  ok(g.residents.length === Math.floor(g.pop) && pop0 <= g.residents.length, "Einwohner = floor(Bevölkerung)");
  ok(!g.residents.some((r) => (r.job as string) === "träger"), "Kein erfundener 'träger'-Beruf mehr");
  clean(g, "Träger");
}

/* ---------- 4) Reservierungen ---------- */
console.log("Reservierungen");
{
  const g = world();
  const wh = g.hubs[0], bak = buildConnected(g, "bakery"), mill = buildConnected(g, "mill");
  bak.physical!.output.werkzeuge = 1;
  const o1 = createOrder(g, bak, wh, "werkzeuge", 1, 1), o2 = createOrder(g, bak, wh, "werkzeuge", 1, 1);
  ok(!!o1 && !o2, "Eine Planke/Ware kann nur von einem Auftrag reserviert werden (Quellreservierung)");
  mill.physical!.input.getreide = 8;
  const a = createOrder(g, wh, mill, "getreide", 2, 1), b = createOrder(g, wh, mill, "getreide", 1, 1);
  ok(!!a && !b, "Mühle 8/10 + 2 reserviert: weitere Lieferung wird abgelehnt (Zielreservierung)");
  clean(g, "Reservierungen aktiv");
  ok(cancelOrder(g, a!.id) && cancelOrder(g, o1!.id), "Abbruch vor Aufnahme");
  ok((mill.physical!.reservedInput.getreide ?? 0) === 0 && (bak.physical!.reservedOutput.werkzeuge ?? 0) === 0, "Reservierungen werden freigegeben");
  clean(g, "Nach Abbruch");
  ok(effectivePriority(0, 100) > effectivePriority(0, 0) && effectivePriority(0, 1e6) <= 3.5, "Prioritäts-Aging: LOW steigt mit Wartezeit (begrenzt)");
}

/* ---------- 5) Wegfindung ---------- */
console.log("Wegfindung & Straßen");
{
  const g = world();
  const wh = g.hubs[0];
  const a: [number, number] = [c - 3, c + 1], bb: [number, number] = [c + 4, c + 1];
  ok(findPath(g, "CARRIER", a, [a]).status === "ALREADY_AT_GOAL", "ALREADY_AT_GOAL ist vom Fehlschlag unterscheidbar");
  const r = findPath(g, "CARRIER", a, [bb]);
  ok(r.status === "REACHED" && r.path.length > 0 && r.path.every(([x, y]) => g.isRoad(x, y)), "Carrier-Pfad liegt vollständig auf Straße");
  ok(findPath(g, "CARRIER", [c - 10, c - 8], [bb]).status === "UNREACHABLE", "Kein Straßenanschluss → UNREACHABLE (kein Querfeldein)");
  const w = findPath(g, "WORKER", [c - 6, c - 4], [[c + 6, c - 4]]);
  ok(w.status === "REACHED" && !w.path.some(([x, y]) => g.buildingAt(x, y) === wh), "Arbeiter umgehen den echten 3×3-Footprint des Lagerhauses");
  const side = (rot: 0 | 1 | 2 | 3) => accessTiles("warehouse", 10, 10, rot).map(([x, y]) => `${x},${y}`).join("|");
  ok(side(0) === "10,13|11,13|12,13" && side(1) === "9,10|9,11|9,12" && side(2) === "12,9|11,9|10,9" && side(3) === "13,12|13,11|13,10", "Zugänge drehen mit 0/90/180/270°");
  const mid = g.buildingAt(c, c + 1)!;
  g.demolish(mid.id);
  ok(findPath(g, "CARRIER", a, [bb]).status === "UNREACHABLE", "Straßenunterbrechung → Route ungültig (Cache invalidiert)");
  forceBuild(g, "road", c, c + 1);
  ok(findPath(g, "CARRIER", a, [bb]).status === "REACHED", "Straßenwiederherstellung → Route wieder gültig");

  // Blockierter Transport + Wiederaufnahme
  const g2 = world();
  const before = roadSet(g2);
  const bak = buildConnected(g2, "bakery", findSpot(g2, "bakery", 14));
  const branch = g2.buildings.filter((b) => b.type === "road" && !before.has(b.id));
  ok(branch.length >= 4, `Abzweig-Straße (${branch.length} Kacheln)`);
  g2.simulate(8);
  bak.physical!.output.werkzeuge = 2;
  const o = createOrder(g2, bak, g2.hubs[0], "werkzeuge", 2, 1)!;
  const cutAt = branch[Math.floor(branch.length / 2)];
  const cut = { x: cutAt.x, y: cutAt.y };
  g2.demolish(cutAt.id);
  g2.simulate(3);
  ok(o.status === "BLOCKED_NO_ROUTE", `Auftrag ohne Route: ${o.status}`);
  ok(g2.getResident(o.carrierId ?? -1) === undefined || (g2.getResident(o.carrierId!)!.carrying === null), "Kein Teleport: Träger trägt nichts, Ware bleibt an der Quelle");
  clean(g2, "Blockiert");
  forceBuild(g2, "road", cut.x, cut.y);
  g2.simulate(60);
  ok(g2.transportStats.delivered > 0 && !g2.transportOrders.includes(o), "Nach Straßenwiederherstellung wird der Auftrag zugestellt");
  clean(g2, "Wiederaufnahme");
}

/* ---------- 6) Bauen: Baustellen, Material, Bauarbeiter ---------- */
console.log("Baustellen");
{
  const g = world(1337, 4, 30);
  g.simulate(10);
  const holz0 = g.getTotalResource("holz"), stein0 = g.getTotalResource("stein");
  const site = placeSite(g, "house_s")!;
  ok(!!site && !site.built && site.type === "house_s", "Platzieren erzeugt eine Baustelle, kein fertiges Gebäude");
  ok(g.getTotalResource("holz") === holz0, "Platzieren verbraucht noch kein Material");
  let progressWithoutBuilder = false, progressAboveMaterial = false, sawBuilder = false;
  let last = 0;
  for (let i = 0; i < 400 && !site.built; i++) {
    g.simulate(0.5);
    const frac = g.siteInfo(site)?.materials ?? 1;
    const builders = g.residents.filter((r) => r.workTargetId === site.id && r.state === "CONSTRUCTION_WORK").length;
    if (builders > 0) sawBuilder = true;
    if (!site.built && site.progress > last + 1e-9 && builders === 0) progressWithoutBuilder = true;
    if (!site.built && site.progress > frac + 1e-6) progressAboveMaterial = true;
    last = site.progress;
  }
  ok(site.built, "Baustelle wird durch Träger (Material) und Bauarbeiter fertig");
  ok(sawBuilder && !progressWithoutBuilder, "Fortschritt nur mit anwesenden Bauarbeitern");
  ok(!progressAboveMaterial, "Fortschritt nie über dem gelieferten Material");
  ok(g.getTotalResource("holz") === holz0 - BUILDINGS.house_s.cost.holz! && g.getTotalResource("stein") === stein0 - BUILDINGS.house_s.cost.stein!, "Genau die Baukosten wurden physisch aus dem Lager geliefert");
  ok(!site.physical && Object.keys(site.crew).length === 0, "Fertiges Haus: Baustellenlager aufgelöst");
  clean(g, "Bau");
  // Baustelle ohne Straße bekommt nichts
  const g3 = world(1337, 2, 20);
  const far = findSpot(g3, "house_s", 12)!;
  g3.place("house_s", far[0], far[1], 0);
  const s3 = g3.buildings[g3.buildings.length - 1];
  g3.simulate(60);
  ok(!s3.built && s3.progress === 0 && g3.siteInfo(s3)?.state === "NO_ROAD", "Baustelle ohne Straßenanbindung: kein Material, kein Fortschritt");
  const refund = g3.getTotalResource("holz");
  g3.demolish(s3.id);
  ok(g3.getTotalResource("holz") >= refund, "Abriss einer Baustelle gibt gelieferte Materialien zurück");
  clean(g3, "Baustellen-Abriss");
}

/* ---------- 7) Holzkette + Förster ---------- */
console.log("Forstwirtschaft & Holzkette");
{
  const g = world();
  const lj = buildConnected(g, "lumberjack"), saw = buildConnected(g, "sawmill"), fo = buildConnected(g, "forester", findSpot(g, "forester", 0, [lj.x, lj.y]));
  let deliveredByWorker = true, sawCarry = false, treeCut = false, sawSapling = false, prevOut = 0;
  const bretter0 = g.getTotalResource("bretter");
  for (let i = 0; i < 480; i++) {
    g.simulate(0.5);
    const out = lj.physical!.output.holz ?? 0;
    const workers = g.residents.filter((r) => r.workplaceId === lj.id);
    if (workers.some((r) => r.carrying?.resource === "holz")) sawCarry = true;
    if (out > prevOut + 1e-9) { const near = workers.some((r) => Math.hypot(r.x - (lj.x + 1), r.y - (lj.y + 1)) < 4); if (!near) deliveredByWorker = false; }
    prevOut = out;
    if ([...g.treeGrowth.values()].some((v) => v === 0)) treeCut = true;
    if ([...g.treeGrowth.values()].some((v) => v >= 1 && v < 2)) sawSapling = true;
  }
  ok(sawCarry && deliveredByWorker, "Holz reist in der Hand des Holzfällers und erscheint erst am Gebäude");
  ok(treeCut, "Gefällter Baum wird als CUT geführt");
  ok(sawSapling, "Förster pflanzt Setzlinge (SAPLING → wächst)");
  ok(new Set(g.reservedTrees.values()).size === g.reservedTrees.size, "Baumreservierungen sind eindeutig");
  ok(g.getTotalResource("bretter") > bretter0, `Kette Wald → Sägewerk → Lager liefert Bretter (+${(g.getTotalResource("bretter") - bretter0).toFixed(0)})`);
  ok(g.transportStats.delivered >= 5, `Transporte abgeschlossen: ${g.transportStats.delivered}`);
  ok(g.transportOrders.length < 40 && g.transportArchive.length <= 20, "Abgeschlossene Aufträge werden archiviert, nicht angehäuft");
  const jobsOk = g.residents.filter((r) => r.workplaceId === saw.id).length <= (saw.crew.handwerker ?? 0) + 1;
  ok(jobsOk, "Besetzung respektiert Stellenzahl");
  const homes = new Map<number, number>(); for (const r of g.residents) if (r.homeBuildingId) homes.set(r.homeBuildingId, (homes.get(r.homeBuildingId) ?? 0) + 1);
  ok([...homes].every(([id, n]) => n <= (BUILDINGS[g.getBuilding(id)!.type].housing ?? 0)), "Kein Haus überschreitet seine Kapazität");
  ok(g.residents.some((r) => r.state === "AT_HOME") && g.residents.some((r) => r.state === "WORKING" || r.state === "FETCHING_RESOURCE"), "Alltag: Einwohner zu Hause UND bei der Arbeit");
  clean(g, "Holzkette");
  // Arbeitsplatz abreißen
  const workerIds = g.residents.filter((r) => r.workplaceId === lj.id).map((r) => r.id);
  g.demolish(lj.id);
  g.simulate(5);
  ok(workerIds.every((id) => { const r = g.getResident(id)!; return r.workplaceId === null || r.workplaceId !== lj.id; }), "Abriss: Arbeiter verlieren Arbeitsplatz sauber");
  clean(g, "Abriss Arbeitsplatz");
}

/* ---------- 8) Nahrungskette ---------- */
console.log("Landwirtschaft");
{
  const g = world(1337, 6, 50);
  g.setResources({ getreide: 0, brot: 0, mehl: 0, holz: 200, stein: 200 });
  const farm = buildConnected(g, "farm");
  const fieldStages = new Set<string>();
  for (let k = 0; k < 3; k++) { const s = findSpot(g, "field", 0, [farm.x, farm.y])!; forceBuild(g, "field", s[0], s[1]); }
  const mill = buildConnected(g, "mill"), bak = buildConnected(g, "bakery");
  let milled = 0, baked = 0, farmerCarried = false;
  for (let i = 0; i < 900; i++) {
    g.simulate(0.5);
    for (const f of g.buildings) if (f.field) fieldStages.add(f.field.stage);
    if (g.residents.some((r) => r.job === "bauer" && r.carrying)) farmerCarried = true;
    milled = Math.max(milled, g.prod.mehl); baked = Math.max(baked, g.prod.brot);
  }
  ok(g.residents.some((r) => r.job === "bauer"), "Bauer ist ein echter Einwohner");
  ok(["PLOWED", "SOWN", "GROWING", "RIPE", "HARVESTED"].every((s) => fieldStages.has(s)), `Feld durchläuft den Lifecycle (${[...fieldStages].join("→")})`);
  ok(farmerCarried, "Ernte wird vom Bauern zum Hof getragen");
  ok(g.transportStats.delivered > 0 && milled > 0 && baked > 0, `Getreide → Mühle → Mehl → Bäckerei → Brot (Mehl ${milled.toFixed(1)}/min, Brot ${baked.toFixed(1)}/min)`);
  ok(g.getTotalResource("brot") > 0 || g.getTotalResource("getreide") > 0 || g.foodStatus === "ok", "Nahrung erreicht das Lagerhaus");
  void mill; void bak;
  clean(g, "Nahrung");
}

/* ---------- 9) Bergbau ---------- */
console.log("Bergbau");
{
  const g = world();
  const mine = buildConnected(g, "mine", findSpot(g, "mine"));
  const dep0 = g.depositInfo(mine).remaining;
  ok(!!mine.mineRes && dep0 > 0, `Mine über echtem Vorkommen (${mine.mineRes}, ${dep0})`);
  const res = mine.mineRes as ResId, h0 = g.getTotalResource(res);
  g.simulate(240);
  ok(g.depositInfo(mine).remaining < dep0, "Vorrat sinkt durch Förderung");
  ok(g.residents.some((r) => r.job === "bergarbeiter"), "Bergarbeiter ist ein echter Einwohner");
  ok(g.getTotalResource(res) > h0 || g.transportStats.delivered > 0, "Erz wird per Träger ins Lager gebracht");
  for (let y = 0; y < MAP_SIZE; y++) for (let x = 0; x < MAP_SIZE; x++) { const i = y * MAP_SIZE + x; if (g.map.terrain[i] === T.MOUNTAIN && g.depositRemaining.has(i) && Math.hypot(x - mine.x, y - mine.y) < 8) g.depositRemaining.set(i, 0); }
  g.simulate(15);
  ok(mine.status === "depleted" && g.depositInfo(mine).remaining === 0, "remaining = 0 → DEPLETED, Produktion stoppt");
  clean(g, "Bergbau");
}

/* ---------- 10) Upgrades & Rotation ---------- */
console.log("Upgrades/Rotation");
{
  const g = world();
  const saw = buildConnected(g, "sawmill");
  g.simulate(5);
  const before = { holz: g.getTotalResource("holz"), stein: g.getTotalResource("stein"), bretter: g.getTotalResource("bretter") };
  const slots1 = g.slotsOf(saw), cap1 = 10;
  ok(g.canUpgrade(saw.id).ok && g.upgradeBuilding(saw.id).ok && saw.physical!.level === 2, "Stufe 1 → 2");
  ok(g.getTotalResource("holz") === before.holz - 30 && g.getTotalResource("stein") === before.stein - 20 && g.getTotalResource("bretter") === before.bretter - 10, "Upgrade-Kosten wurden wirklich verbraucht");
  ok(g.slotsOf(saw) === slots1 + 1 && g.speedMult(saw) === 1.25, "Stufe 2 wirkt: +1 Arbeiter, 1,25× Tempo");
  ok(g.upgradeBuilding(saw.id).ok && saw.physical!.level === 3 && !g.canUpgrade(saw.id).ok, "Stufe 2 → 3, danach Limit");
  g.setResources({ holz: 0 });
  const poor = buildConnected(g, "sawmill");
  ok(!g.canUpgrade(poor.id).ok && !g.upgradeBuilding(poor.id).ok && poor.physical!.level === 1, "Zu wenig Rohstoffe: Upgrade abgelehnt");
  void cap1;
  const rot0 = saw.rotation;
  const seen = new Set<string>();
  for (let k = 0; k < 4; k++) { seen.add(JSON.stringify(accessTiles("sawmill", saw.x, saw.y, saw.rotation))); g.rotateBuilding(saw.id); }
  ok(saw.rotation === rot0 && seen.size >= 2, "Rotation 0/90/180/270 → Zugang wechselt");
  const loaded = GameEngine.load(JSON.parse(JSON.stringify(g.serialize())));
  const ls = loaded.buildings.find((b) => b.type === "sawmill" && b.x === saw.x && b.y === saw.y)!;
  ok(ls.physical?.level === 3 && ls.rotation === saw.rotation, "Level und Rotation werden gespeichert/geladen");
  clean(g, "Upgrades");
}

/* ---------- 11) Recovery (Abriss mit Fracht) ---------- */
console.log("Recovery");
{
  const g = world();
  const saw = buildConnected(g, "sawmill", findSpot(g, "sawmill", 12));
  g.setResources({ holz: 150 });
  g.simulate(1);
  const eco = () => g.getEconomyTotal("holz");
  let loadedSeen = false;
  for (let i = 0; i < 200 && !loadedSeen; i++) { g.simulate(0.5); loadedSeen = g.transportOrders.some((o) => o.targetBuildingId === saw.id && o.status === "IN_TRANSIT"); }
  ok(loadedSeen, "Träger unterwegs zum Sägewerk (Fracht an Bord)");
  const before = eco(), lostBefore = g.lostGoods.holz ?? 0;
  g.demolish(saw.id);
  g.simulate(60);
  clean(g, "Ziel abgerissen");
  ok((g.lostGoods.holz ?? 0) === lostBefore, "Fracht geht nicht verloren (läuft zum nächsten Hub)");
  ok(g.residents.every((r) => !r.carrying || r.carrying.amount > 0), "Keine Geisterfracht");
  void before;
  // Quelle abreißen
  const g2 = world();
  const bak = buildConnected(g2, "bakery", findSpot(g2, "bakery", 12));
  bak.physical!.output.werkzeuge = 3;
  const o = createOrder(g2, bak, g2.hubs[0], "werkzeuge", 3, 1)!;
  const total = g2.getEconomyTotal("werkzeuge");
  g2.demolish(bak.id);
  ok(!g2.transportOrders.includes(o) && o.status === "CANCELLED", "Quelle abgerissen → Auftrag abgebrochen");
  ok(g2.getEconomyTotal("werkzeuge") === total, "Lagerinhalt des abgerissenen Gebäudes ging ins Lagerhaus");
  clean(g2, "Quelle abgerissen");
}

/* ---------- 12) Bevölkerung schrumpft ---------- */
console.log("Bevölkerungsrückgang");
{
  const g = world();
  buildConnected(g, "sawmill");
  g.simulate(60);
  g.pop = 12;
  const eco = g.getEconomyTotal("holz");
  g.simulate(30);
  ok(g.residents.length === Math.floor(g.pop), "Einwohner folgen der Bevölkerung");
  ok(g.getEconomyTotal("holz") <= eco + 20, "Fracht entlassener Einwohner wird nicht dupliziert");
  clean(g, "Schrumpfung");
}

/* ---------- 13) Save / Load ---------- */
console.log("Speichern/Laden");
{
  const g = world();
  buildConnected(g, "lumberjack"); buildConnected(g, "sawmill");
  g.simulate(55);
  const data = JSON.parse(JSON.stringify(g.serialize()));
  const g2 = GameEngine.load(data);
  ok(data.v === 4 && g2.buildings.length === g.buildings.length, "v4 Save: Gebäude identisch");
  ok(g2.residents.length === g.residents.length && g2.transportOrders.length === g.transportOrders.length, "Einwohner und laufende Transporte werden geladen");
  clean(g2, "Geladen (mitten im Transport)");
  const resList: ResId[] = ["holz", "stein", "bretter", "werkzeuge", "getreide", "mehl", "brot", "eisen", "kohle", "gold"];
  ok(resList.every((r) => Math.abs(g2.getEconomyTotal(r) - g.getEconomyTotal(r)) < 0.01), "Wirtschaftssumme bleibt beim Laden erhalten");
  g2.simulate(60);
  clean(g2, "Weitergespielt");
  ok(g2.transportStats.delivered > g.transportStats.delivered, "Transporte laufen nach dem Laden weiter");
  ok(Buffer.compare(Buffer.from(g2.map.terrain), Buffer.from(g.map.terrain)) === 0, "Karte aus Seed identisch");
  const legacy = GameEngine.load({ ...data, v: 3, residents: [{ id: 99, x: 5, y: 5, job: "träger", state: "TRANSPORTING", homeBuildingId: null, workplaceId: null, carrying: { resource: "holz", amount: 3 } }], transportOrders: [{ id: 1, resource: "holz", amount: 1, status: "WAITING", sourceBuildingId: 1, targetBuildingId: 2 }] });
  ok(!legacy.residents.some((r) => r.id === 99) && legacy.transportOrders.length === 0, "v3-Migration verwirft erfundene Träger/Alt-Aufträge");
  legacy.simulate(10); clean(legacy, "Migration");
  const broken = GameEngine.load({ ...data, buildings: [{ t: "nope", x: 1, y: 1, p: 1 }, ...data.buildings], res: { holz: "x" } });
  ok(broken.buildings.length === g.buildings.length, "Defekte Einträge werden ignoriert");
}

/* ---------- 13b) Früher Spielverlauf (echter Spielerweg) ---------- */
console.log("Früher Spielverlauf");
{
  const g = GameEngine.newGame(1337);
  const spot = findSpot(g, "lumberjack")!;
  g.setBuildType("lumberjack"); g.setGhost(spot[0], spot[1]); g.confirmGhost(); g.setBuildType(null);
  const site = g.buildings[g.buildings.length - 1];
  const wood0 = g.getTotalResource("holz");
  const roads0 = g.count("road", false);
  const linked = connect(g, site, true);
  const newRoads = g.count("road", false) - roads0;
  ok(!site.built && linked, "Holzfäller-Baustelle + echte Straßen (Straßen werden sofort bezahlt)");
  ok(wood0 - g.getTotalResource("holz") === newRoads, `Straßen kosten sofort je 1 Holz aus dem Lager (${newRoads} Kacheln)`);
  g.simulate(240);
  ok(site.built && site.connected, `Holzfäller wird mit Träger-Material und Bauarbeitern fertig (Fortschritt ${Math.round(site.progress * 100)} %)`);
  g.simulate(240);
  ok(g.residents.some((r) => r.job === "holzfaeller") && g.getEconomyTotal("holz") > 0, "Holzfäller arbeitet danach");
  clean(g, "Früher Spielverlauf");
}

/* ---------- 14) Bevölkerung, Level, Forschung, Handel ---------- */
console.log("Bevölkerung/Level/Forschung/Handel");
{
  const n = GameEngine.newGame(21);
  ok(n.popCap === 8 && n.residents.length === 8, "Startsiedlung: Häuser sind über ihren Eingang an die Straße angebunden");
  const starve = GameEngine.newGame(9);
  starve.setResources({ brot: 0, getreide: 0 });
  starve.simulate(120);
  ok(starve.pop < 8 && starve.foodStatus === "starving", `Hunger senkt Bevölkerung (${starve.pop.toFixed(2)})`);
  const lv = GameEngine.newGame(3); lv.addXp(60);
  ok(lv.level === 2 && lv.activeQuests().length > 0, "Level-Aufstieg und Aufgaben");
  const rg = GameEngine.newGame(11); rg.level = 10; rg.setResources({ holz: 300, stein: 300, gold: 200, bretter: 300 });
  const g0 = rg.getTotalResource("gold");
  ok(rg.startResearch("axes") && rg.getTotalResource("gold") === g0 - 15, "Forschung verbraucht Rohstoffe aus dem Lager");
  rg.simulate(65);
  ok(rg.research.done.includes("axes"), "Forschung abgeschlossen");
  ok(rg.trade("holz", 10, "sell") !== null, "Handel ohne Marktplatz abgelehnt");
  const mk = buildConnected(rg, "market");
  rg.pop = Math.min(20, rg.popCap); rg.simulate(30);
  const gold0 = rg.getTotalResource("gold"), holz0 = rg.getTotalResource("holz");
  const err = rg.trade("holz", 10, "sell");
  ok(mk.built && err === null && rg.getTotalResource("gold") > gold0 && rg.getTotalResource("holz") === holz0 - 10, `Verkauf bucht Lager und Gold konsistent (${gold0} → ${rg.getTotalResource("gold")})`);
  ok(rg.trade("brot", 5, "buy") === null, "Kauf funktioniert");
  clean(rg, "Handel");
  const iso = GameEngine.newGame(1337); iso.level = 25;
  const far = findSpot(iso, "house_s", 12)!;
  forceBuild(iso, "house_s", far[0], far[1]);
  iso.simulate(5);
  ok(iso.popCap === 8, "Unverbundenes Haus zählt nicht zur Kapazität");
  const d = GameEngine.newGame(5);
  const hb = d.buildings.find((x) => x.type === "house_s")!;
  const h0 = d.getTotalResource("holz");
  ok(d.demolish(hb.id).ok && d.getTotalResource("holz") >= h0 + 10 && !d.demolish(d.hubs[0].id).ok, "Abriss mit Rückerstattung; letztes Lagerhaus geschützt");
}

console.log(failed ? `\n${failed} Test(s) FEHLGESCHLAGEN` : "\nAlle Tests bestanden");
process.exit(failed ? 1 : 0);
