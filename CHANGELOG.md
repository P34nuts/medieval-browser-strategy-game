# Changelog

## 0.5.0 – Physische Wirtschaft (Simulationsfundament neu gelegt)

- **Entfernt:** Träger, die bei Auftragsmangel aus dem Nichts entstanden. Träger und Bauarbeiter sind jetzt Berufe endlicher Einwohner (Stellen an Lagerhaus/Burg; Upgrades erhöhen sie).
- **Entfernt:** Doppelbuchung Lager/`res`. Hub-Lager sind die einzige Wahrheit; `engine.res` ist abgeleitet. Neue Module `economy.ts`, `storage.ts`.
- **Neu:** Logistik V2 (`logistics.ts`): Reservierungen, Prioritäten + Aging, blockierte Routen, Recovery, Archiv.
- **Neu:** Pfadfindung (`pathing.ts`): `PathResult`, WORKER/CARRIER, echte Footprints, rotierte Eingänge, Cache, Min-Heap.
- **Neu:** Einwohner-Alltag (`residents.ts`), Gatherer/Verarbeitung (`jobs.ts`), Baustellen + Bauarbeiter (`construction.ts`), Konfiguration (`config.ts`).
- **Geändert:** Gebäude haben einen Eingang (Seite, mit Rotation); Anbindung = Eingang an angebundener Straße. Beim Platzieren wird die Rotation automatisch zur Straße gedreht.
- **Geändert:** Baukosten werden physisch geliefert (Straßen/Felder weiter sofort). Aggregierte Produktion nur noch für die Kaserne.
- **Geändert:** Save v4 (stabile Gebäude-IDs, keine Pfade, Reservierungen abgeleitet), Migration älterer Saves, Server-Größenlimits.
- **Behoben:** Pfadfinder-Endlosschleife durch Float32-Kosten, mehrdeutiges leeres Pfad-Array, Berg-Teleport, Holz am Baum statt am Arbeiter, Felder wuchsen nur mit Bauer.
- **Tests:** `npx tsx scripts/sim-test.ts` (Invarianten, Ketten, Recovery, Save/Load), `npx tsx scripts/stress-test.ts`.


## Unreleased – Agriculture V1

Agriculture produziert jetzt nicht mehr parallel über das alte aggregierte Farm-/Mühlen-/Bäckereisystem. Felder besitzen die Zustände `EMPTY`, `PLOWED`, `SOWN`, `GROWING`, `RIPE` und `HARVESTING`; Bauern sind echte Einwohner mit Arbeitsplatz und Feldziel. Die Farm erzeugt Getreide in ihrem lokalen Output, Carrier liefern es physisch zur Mühle, die daraus Mehl produziert. Ein weiterer Transport bringt Mehl zur Bäckerei, die Brot produziert und über einen Carrier ins Lager liefert. Der Gebäudeinspektor und der Canvas zeigen Lifecycle- und Produktionszustände.

Die Regressionstests beweisen jetzt den vollständigen Ablauf: Feld-Lifecycle, Bauer, Farm-Output, Getreidetransport, Mühlen-Input, Mehltransport, Brotproduktion und Brotankunft im Lager. Field States werden zusammen mit dem bestehenden Save-v3-Zustand persistiert.

## Unreleased – Living Settlement V1

Die bestehende Engine-Architektur bleibt erhalten. Der nächste Prompt-Meilenstein erweitert den physischen Holz-Slice um eine belastbare Siedlungsgrundlage: Population-Entities werden bis zur Einwohnerzahl erzeugt, Wohnhäuser vergeben Home Assignments kapazitätsbewusst, Arbeitsplätze übernehmen verfügbare Einwohner und Gebäudezugänge bevorzugen erreichbare Straßenkacheln am Gebäuderand. Transportaufträge werden nach Priorität verarbeitet und können sicher abgebrochen werden.

Bäume besitzen nun autoritativen Wachstumszustand, werden während der Ernte reserviert und wachsen nach der Ernte wieder nach. Ein datengetriebenes Förstergebäude mit eigenem Beruf pflanzt abgeerntete Waldflächen neu. Ein Save-v3-Format speichert Einwohner, Transportaufträge, lokale Gebäudelager, Baumwachstum und Reservationen; v2-Saves werden weiterhin defensiv geladen.

Die Headless-Suite deckt jetzt zusätzlich Home Assignments, Baumwachstum, Tree Reservations und v2→v3-Migration ab. Ein separater Development-Stresstest prüft 250 Einwohner und 300 Transportaufträge.

## Unreleased – Physical Economy Foundation

- Bestehende Engine-Architektur und datengetriebene Definitionen als Grundlage beibehalten.
- Engine-State um individuelle Einwohner, lokale Gebäudelager und Transportaufträge erweitert.
- A*-Pfadfinder mit Straßenpräferenz für sichtbare Arbeiter- und Trägerbewegung ergänzt.
- Holzfäller nutzt erschöpfbare Waldkacheln; geerntete Bäume werden im Save festgehalten.
- Sägewerk verarbeitet lokales Holz in Produktionszyklen zu lokalen Brettern.
- Transportaufträge besitzen ID, Ressource, Menge, Start, Ziel, Priorität, Status, Träger und Erstellungszeitpunkt.
- Sichtbare Canvas-Figuren und transportierte Waren ergänzt.
- Gebäudeinspektor zeigt lokale Inputs/Outputs, Produktionsstatus und betroffene Transportaufträge.
- Pause/1×/2× ergänzt.
- Save-Format zunächst auf Version 2 erweitert und bestehende v1-Saves defensiv kompatibel gehalten.
- Headless-Regressionstest um den Holz-Vertical-Slice erweitert.

## Version 0.1 baseline

- Initiale Burgfried-Version mit isometrischer Canvas-Welt, Gebäuden, aggregierten Produktionsketten, Bevölkerung, Forschung, Handel, Quests, Auth und PostgreSQL-Saves.

## Unreleased – Physical Mining V1

Mining ist als echter physischer Kreislauf angeschlossen: Eisen-, Kohle- und Goldvorkommen sowie Stein besitzen endliche `remaining`-Mengen. Bergarbeiter sind Einwohner mit Home, Mine-/Steinbruch-Arbeitsplatz, Bewegung und Extraction. Die Ausbeute landet im lokalen Gebäude-Output und wird per Transportauftrag ins Lager geliefert. Bei `remaining = 0` stoppt die Produktion, der Gebäudeinspektor zeigt `Vorkommen erschöpft`, und die Menge wird in Save v3 erhalten.

Die Headless-Suite prüft jetzt Vorkommensabnahme, erzeugten Output, Transportauftrag, vollständige Erschöpfung, Produktionsstopp und Save/Load-Persistenz.

## Unreleased – Building Upgrades & Rotation

Die zehn geforderten Gebäude (`lumberjack`, `forester`, `sawmill`, `warehouse`, `farm`, `mill`, `bakery`, `mine`, `quarry`) besitzen jetzt datengetriebene Stufe-2-/Stufe-3-Profile. Upgrades kosten echte Ressourcen, erhöhen Worker-Slots und Produktionsgeschwindigkeit und sind bei Stufe 3 beendet. Die API `canUpgrade`/`upgradeBuilding` wird vom Inspector genutzt und bleibt in Save v3 erhalten.

Gebäude verfügen jetzt über echte 0°/90°/180°/270°-Rotation. Gedrehte Footprints werden bei Platzierung, Occupancy, Abriss, Ghost, Renderer und Zugangsberechnung berücksichtigt. Im Baumodus gibt es einen mobilen Rotieren-Button und den Desktop-Shortcut `R`; der Inspector erlaubt Rotation bestehender Gebäude. Rotation und Upgrade-Level werden gespeichert und geladen.

Die Regression prüft Ressourcenverbrauch, erfolgreiche Stufen 2/3, Stufe-3-Limit, alle vier Rotationsstufen sowie Save/Load.

## Unreleased – Road Network & Transport Hardening

Carrier bewegen sich jetzt ausschließlich über gebaute Straßen. Arbeiter behalten ihre natürliche Offroad-Erreichbarkeit für Wälder, Felder und Vorkommen. Transportaufträge nutzen eine echte State Machine mit `WAITING`, `WAITING_FOR_CARRIER`, `ASSIGNED`, `TO_PICKUP`, `PICKING_UP`, `IN_TRANSIT`, `DELIVERING`, `DELIVERED`, `BLOCKED_NO_ROUTE`, `BLOCKED_TARGET_FULL`, `FAILED` und `CANCELLED`.

Quell- und Zielreservierungen werden beim Erzeugen eines Auftrags geführt. Bei Abbruch werden Reservierungen und gegebenenfalls getragene Waren sicher freigegeben. Laufende Carrier-Pfade werden bei Straßenentfernung invalidiert und nach Wiederherstellung neu berechnet.

Die Regression deckt gebaute Straßenrouten, blockierende Straßenentfernung, Road Restoration und die weiterhin mögliche Offroad-Arbeit von Einwohnern ab.
