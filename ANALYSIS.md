# Technische Bestandsaufnahme – Burgfried (verifiziert gegen den Code)

Quelle der Wahrheit ist der Code; frühere Dokumente und Abschlussmeldungen wurden geprüft und teilweise widerlegt.

## Befunde der Verifikation (vor dem Umbau)

| Behauptung (README/ROADMAP) | Realität im Code | Status jetzt |
|---|---|---|
| „Träger / Transport-State-Machine fertig“ | Fehlte ein freier Träger, wurde ein **neuer Einwohner mit Beruf `träger` erzeugt** (Bevölkerung wuchs durch Transporte). | Behoben: Träger sind endliche Einwohner an Lagerhäusern. |
| „Lokale Lager, keine Teleportation“ | Lieferungen an Lagerhäuser erhöhten **lokales Lager UND globales `res`** (Doppelbuchung); Kosten/Forschung/Handel/Quests mutierten `res` direkt. | Behoben: Hub-Lager sind die einzige Wahrheit, `res` ist abgeleitet (`economy.ts`). |
| „Pfadfindung A*“ | Leeres Array bedeutete sowohl „am Ziel“ als auch „kein Weg“; Gebäude wurden als 1×1 behandelt; jeder Nachbar scannte alle Gebäude (O(n)); Berg-Ziele waren unbegehbar → `movePhysical` **teleportierte** auf das Ziel. | Behoben: `PathResult` mit `REACHED / ALREADY_AT_GOAL / UNREACHABLE`, Belegungsraster mit echten Footprints, Min-Heap, Cache. |
| „Holzfäller trägt Holz“ | Holz wurde **am Baum** direkt ins Gebäudelager geschrieben. | Behoben: Holz wandert in der Hand des Arbeiters. |
| „Landwirtschaft/Mining physisch“ | Ernte/Erz ebenfalls direkt im Lager; Schmiede, Kaserne und Wachstum liefen weiter aggregiert; Felder wuchsen nur bei anwesendem Bauern. | Behoben (Schmiede physisch; Kaserne bleibt bewusst Hub-Dienstleistung). |
| „Bauen mit Ressourcen“ | Gebäude entstanden per Timer, Kosten sofort global abgezogen. | Behoben: Baustellen mit Materiallieferung und Bauarbeitern. |
| Saves | Einwohner/Aufträge mit Pfaden gespeichert, IDs verschoben sich bei übersprungenen Gebäuden. | Save v4 mit stabilen IDs, Reservierungen werden aus Aufträgen abgeleitet. |

## Architektur (Ist-Zustand)

- `data.ts` Spieldaten · `config.ts` Zeiten/Radien/Flüsse/Kapazitäten der physischen Simulation
- `storage.ts` Lager-API (Bestand, Kapazität, Quell-/Zielreservierungen, commitPickup/commitDelivery)
- `economy.ts` Wirtschafts-API (`getSpendableResource`, `canAfford`, `consumeCost`, `depositResource`, …)
- `logistics.ts` Transportaufträge: Zustandsmaschine, Prioritäten + Aging, Blockaden, Recovery, Archiv
- `pathing.ts` Zugänge (rotierte Eingangsseiten), A* (WORKER offroad / CARRIER nur Straße), Pfad-Cache
- `residents.ts` Bevölkerung, Wohnungen, Arbeitsplätze, Alltagszyklus · `jobs.ts` Forst/Farm/Bergbau/Verarbeitung
- `construction.ts` Baustellen und Bauarbeiter · `engine.ts` Koordination, Save/Load, `audit()`
- Renderer/HUD lesen die Engine; `res` im HUD = Summe der Hub-Lager.

## Invarianten (durch `audit()` und `scripts/sim-test.ts` geprüft)

Keine negativen/überlaufenden Lager · jede Reservierung gehört zu genau einem aktiven Auftrag · Einwohner = floor(Bevölkerung) ·
Träger/Bauarbeiter nur aus dem Bestand · Haus-Belegung ≤ Kapazität · Wirtschaftssumme ist in jedem Tick konstant (Quelle → Träger → Ziel) ·
abgeschlossene Aufträge werden archiviert.

## Bekannte Grenzen

- Server validiert Saves nur strukturell (Größenlimits), nicht die Spielregeln.
- Kaserne, Markt, Forschung und Handel arbeiten als Hub-Dienstleistungen (kein physischer Transport).
- Keine Tag/Nacht-Routinen, keine Scouts/Soldaten-Einheiten, kein Gegner.
- Bergarbeiter gehen zu Fuß über Berge (Kosten ×3,5); Brücken existieren nicht.
