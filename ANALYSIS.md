# Technische Bestandsaufnahme – Burgfried v0.1

## Existing architecture

- **Next.js 16 / React 19 / TypeScript 5.9** mit App Router.
- `src/game/data.ts` ist die datengetriebene Definition für Terrain, Ressourcen, Gebäude, Rezepte, Forschung, Quests und Freischaltungen.
- `src/game/mapgen.ts` erzeugt deterministisch aus `seed` eine 64×64-Karte mit Terrain, Flüssen und Erzvorkommen.
- `src/game/engine.ts` ist der zentrale, DOM-freie Game State. `update(dt)` begrenzt Frame-Zeit, führt einen festen 0,5-s-Tick aus und berechnet Bauen, Straßen-Reachability, aggregierte Produktion, Nahrung, Forschung, Quests, Handel und Save/Load.
- `src/game/renderer.ts` trennt Canvas-Rendering/Kamera/Input von der Engine und backt Terrain in 8×8-Chunks; `requestAnimationFrame` ruft aktuell Simulation und Rendering auf.
- React verbindet über `useSyncExternalStore` (Engine-Version) die Engine mit HUD-Komponenten. `GameView` erzeugt/ersetzt Engine und Renderer, autospeichert alle 60 Sekunden sowie bei `visibilitychange/pagehide`.
- API: Bearer-Sessions (`scrypt` + SHA-256 Token-Hash), PostgreSQL/Drizzle, ein JSON-Save pro Account. `src/app/api/save/route.ts` prüft aktuell nur eine minimale Save-Struktur.

## Call graph / data flow

`Canvas/React input → GameEngine.place/select/update → recompute/step → abgeleitete Ressourcen-/Gebäudewerte → Engine notify/version → HUD + Renderer`.

`GameEngine.serialize → PUT /api/save → Drizzle jsonb saves → GET /api/save → GameEngine.load(seed + buildings + Zahlen)`.

## Feature matrix

| Bereich | Status | Befund |
|---|---|---|
| Kartengenerierung | IMPLEMENTED | Deterministisches 64×64 Terrain, Wasser, Wald, Berge, Flüsse, Deposits; Tests vorhanden. |
| Gebäudeplatzierung/Bauzeit | IMPLEMENTED | Kosten, Terrain, Footprints, Level, Baufortschritt, Abriss. |
| Straßen | PARTIALLY IMPLEMENTED | BFS-Netz vom Hub und Anbindungsstatus; noch kein Wegnetz für Einwohner/Transporte. |
| Ressourcen | PARTIALLY IMPLEMENTED | Globale Mengen und Limits; keine lokalen Gebäudelager. |
| Produktion | PARTIALLY IMPLEMENTED | Rezept-/Effizienzrechnung teleportiert Inputs/Outputs global. |
| Bevölkerung | PARTIALLY IMPLEMENTED | Populationszahl, Kapazität, Nahrung und Arbeitszuweisung; keine individuellen Einwohner. |
| Forschung/Quests/Handel/Level | IMPLEMENTED | Funktionierende aggregierte Systeme mit Headless-Abdeckung. |
| Rendering/Kamera/Input | IMPLEMENTED | Isometrischer Canvas, Chunk-Baking, Mouse/Touch, Pinch-Zoom, WASD/Pfeile; keine Figuren/Waren. |
| Mobile UI | PARTIALLY IMPLEMENTED | Responsive HUD und Touch-Eingabe; weitere sichere Touch-Ziele/Produktionsdetails nötig. |
| Auth/API/DB | IMPLEMENTED / RISK | Login/Register/Logout/Me und Save-Endpunkt vorhanden; Save-Regeln serverseitig nicht vollständig validiert. |
| Savegame | PARTIALLY IMPLEMENTED | Seed + Gebäude + aggregierter State; keine Versionmigration für Einwohner, Lager, Transporte, Fog/Territorium. |
| Tests | PARTIALLY IMPLEMENTED | Ein umfangreicher Headless-Smoketest, aber keine Tests für Pathfinding, Einwohner, Transport, lokale Lager, Rotation oder Migration. |
| Militär/Gegner | PLACEHOLDER / ABSTRACT | Militärstärke und Kasernen existieren; keine Einheiten oder Gegner-KI. |

## Baseline

- `npm install --no-audit --no-fund`: erfolgreich.
- `npm run typecheck`: erfolgreich.
- `npm run lint`: erfolgreich.
- `npx tsx scripts/sim-test.ts`: erfolgreich, alle bestehenden Assertions bestanden.
- `npm run build`: Kompilierung und TypeScript erfolgreich, Page-Data-Phase scheitert ohne `DATABASE_URL` mit `DATABASE_URL is required`. Das ist ein Umgebungs-/Datenbankvoraussetzungsfehler, kein gemessener TypeScript- oder Simulationsfehler.

## Technical debt and risks

- `GameEngine` bündelt weiterhin viele Systeme; deshalb wird der erste Slice als klar abgegrenztes physisches Subsystem ergänzt, ohne funktionierende Quests/Forschung/Handel zu verwerfen.
- Produktion arbeitet bislang mit globalem Lager und muss für den Holz-Slice lokal werden.
- Save-Version ist konstant `v: 1`; alte Saves müssen defensiv in ein erweitertes Format migriert werden.
- Server-Save akzeptiert beliebige zusätzliche JSON-Felder und validiert keine Gebäude-Positionen/Spielregeln; die Engine lädt defensiv, aber Manipulation eigener Saves bleibt möglich.
- Datenbank wird beim Import von API-Modulen benötigt; dadurch ist ein Build ohne gesetzte `DATABASE_URL` nicht vollständig ausführbar.
- Der Renderer zeichnet sichtbare Weltobjekte, aber noch keine Entities. Eine Entity pro DOM-Knoten wird vermieden; Figuren/Waren bleiben Canvas-Daten.

## Keep / refactor / replace

- **Keep:** datengetriebene `data.ts`, deterministischer `mapgen.ts`, Canvas-/Chunk-Renderer, React-HUD, Auth-/DB-Grundlage, bestehende Tests.
- **Refactor:** Engine-Simulation schrittweise um physische Lager-, Job-, Transport- und Produktionszustände erweitern; Save-Versionierung und Migration ergänzen.
- **Replace only where needed:** aggregierter Holz-/Sägewerk-Transfer wird im Vertical Slice durch lokale Lager und Transportaufträge ersetzt. Andere Ketten bleiben bis zu ihren eigenen Slices kompatibel aggregiert.

## Current milestone

Phase 0 ist abgeschlossen. Phase 1/2 implementiert zuerst ein testbares, sichtbares Holz-/Bretter-Subsystem. Landwirtschaft, Bergbau, Fog of War, Territory, echte Militär-/Gegner-KI und umfassende Upgrades bleiben danach priorisierte Folgeschritte gemäß `ROADMAP.md`.
