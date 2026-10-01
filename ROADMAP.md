# Burgfried Roadmap

## DONE

- Version-0.1-Basis vollständig inventarisiert und Baseline dokumentiert.
- Deterministische isometrische 64×64-Karte, Gebäudeplatzierung, Straßen-Reachability, aggregierte Ressourcen-/Produktionsketten, Bevölkerung, Forschung, Handel, Quests, Auth und Save/Load erhalten.
- Versionierte Save-Struktur von `v: 1` auf `v: 2` erweitert; alte Saves bleiben defensiv ladbar.
- Individuelle Canvas-Einwohner und Träger als Engine-Entities ergänzt.
- Lokale Lager, Produktionszustände, A*-Pfadfindung und Transportaufträge ergänzt.
- Erster Holz-Vertical-Slice technisch angeschlossen: Wald → Holzfäller → Holz → Transport → Sägewerk → Bretter → Transport → Lager.
- Pause/1×/2× sowie Produktions-/Transportdetails im Inspektor ergänzt.
- Bestehende Simulationstests und neue Slice-Assertions bestehen.
- Living Settlement V1: Population-Entities, Home Assignments, erreichbare Gebäudezugänge, eindeutige Baumreservationen, Baumwachstum und Förster-Placeholder umgesetzt.
- Save v3 mit v2→v3-Migration ergänzt.
- Agriculture V1: echte Felder mit Lifecycle, Bauern als Einwohner, Aussaat/Wachstum/Ernte sowie physische Getreide-, Mehl- und Brotlogistik umgesetzt.
- Mining V1: endliche Eisen-/Kohle-/Gold-/Stein-Vorkommen, Bergarbeiter-Entities, lokale Extraction, Mine-zu-Lager-Logistik, Depletion-Status und Save-Persistenz umgesetzt.
- Building Upgrades & Rotation: datengetriebene Stufen 1–3, echte Ressourcen-Kosten, zusätzliche Worker-Slots, Produktionsgeschwindigkeit, gedrehte Footprints, Eingänge und Save-Persistenz umgesetzt.
- Road-Network & Transport Hardening: Carrier-Routing ausschließlich auf Straßen, echte Transport-State-Machine, Source-/Target-Reservierungen, `BLOCKED_NO_ROUTE`, Cancellation und Road Removal/Restoration umgesetzt.

## IN PROGRESS

- Physical Slice weiter härten: belastbare lokale Kapazitäten und Target-Full-Fälle.
- Population-/Housing-/Carrier-Tests ausbauen; Development-Stresstest mit 250 Einwohnern.
- Server-Save-Prüfung von Struktur- zu regelbewusster Validierung erweitern.

## NEXT

1. Lokale Lagerkapazitäten und `BLOCKED_TARGET_FULL` mit datengetriebenen Upgrade-Limits.
2. Sichtbare Baumwachstumsstufen und Logistik-Overlay.
3. Pathfinding-/Road-Network-Härtung: blockierte Wege, Road Removal/Restoration und `BLOCKED_NO_ROUTE`-Zustände.

## LATER

- Dritter Vertical Slice für Bergbau/Schmelze/Schmiede.
- Fog of War, Scouts und Territorium.
- Echte militärische Einheiten und Gegner-KI.
- Lebendige Welt (Tiere, Rauch-/Wasser-/Vegetationsdetails) unter Performance-Grenzen.
- Skalierung auf mehrere hundert sichtbare bzw. 1.000+ simulierte Einheiten.
