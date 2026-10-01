import { performance } from "node:perf_hooks";
import { GameEngine } from "../src/game/engine";

const g = GameEngine.newGame(20261001);
g.pop = 250;
const warehouse = g.buildings.find((b) => b.type === "warehouse")!;
for (let i = 0; i < 300; i++) {
  g.transportOrders.push({ id: 10000 + i, resource: "holz", amount: 1, start: [warehouse.x + 0.5, warehouse.y + 0.5], target: [warehouse.x + 0.5, warehouse.y + 0.5], priority: i % 5, status: "WAITING", carrierId: null, createdAt: i, sourceBuildingId: warehouse.id, targetBuildingId: warehouse.id });
}
const start = performance.now();
g.simulate(60);
const elapsed = performance.now() - start;
if (g.residents.length < 250) throw new Error(`Expected at least 250 residents, got ${g.residents.length}`);
if (elapsed > 5000) throw new Error(`Stress test too slow: ${elapsed.toFixed(0)} ms`);
console.log(`Stress test OK: ${g.residents.length} residents, ${g.transportOrders.length} orders, ${elapsed.toFixed(0)} ms`);
