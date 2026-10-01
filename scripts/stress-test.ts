/** Stresstest:  npx tsx scripts/stress-test.ts – 250+ Einwohner, viele Transporte, Zeitlimit und Invarianten. */
import { performance } from "node:perf_hooks";
import { GameEngine } from "../src/game/engine";
import { buildConnected, placeSite, populate } from "./helpers";

const g = GameEngine.newGame(20261001);
g.level = 25;
g.setResources({ holz: 350, stein: 350, bretter: 150, werkzeuge: 100, getreide: 200, brot: 150, gold: 100 });
populate(g, 30, 250);
for (const t of ["lumberjack", "lumberjack", "forester", "sawmill", "sawmill", "quarry", "mill", "bakery", "farm"] as const) { try { buildConnected(g, t); } catch { /* kein Platz */ } }
g.simulate(2);
let sites = 0;
for (let i = 0; i < 12; i++) if (placeSite(g, "house_s")) sites++;
const start = performance.now();
let maxOrders = 0;
for (let i = 0; i < 240; i++) { g.simulate(0.5); maxOrders = Math.max(maxOrders, g.transportOrders.length); }
const elapsed = performance.now() - start;
const lg = g.logistics();
const problems = g.audit();
if (g.residents.length < 200) throw new Error(`Zu wenige Einwohner: ${g.residents.length}`);
if (problems.length) throw new Error(`Audit: ${problems.slice(0, 5).join("; ")}`);
if (elapsed > 6000) throw new Error(`Zu langsam: ${elapsed.toFixed(0)} ms für 120 s Spielzeit`);
if (maxOrders > 400 || g.transportArchive.length > 20) throw new Error("Auftragslisten wachsen unbegrenzt");
console.log(`Stress OK: ${g.residents.length} Einwohner, ${lg.carriers} Träger, ${sites} Baustellen, max. ${maxOrders} aktive Aufträge, ${lg.stats.delivered} geliefert, ${elapsed.toFixed(0)} ms / 120 s Spielzeit`);
