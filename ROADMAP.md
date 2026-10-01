# Burgfried Roadmap

## DONE (im Code verifiziert, durch `scripts/sim-test.ts` abgesichert)

- Simulationsfundament: endliche Träger/Bauarbeiter aus der Bevölkerung, Hub-Lager als einzige Wirtschaftswahrheit, zentrale Economy-API, `res` nur abgeleitet.
- Logistik V2: Zustandsmaschine, Quell-/Zielreservierungen, Prioritäten + Aging, `BLOCKED_NO_ROUTE` mit Wiederaufnahme, Cancellation/Recovery (Quelle/Ziel abgerissen, Fracht-Umleitung), Archivierung, Save/Load mitten im Transport.
- Pfadfindung: explizites Ergebnis, WORKER/CARRIER-Profile, echte rotierte Footprints, datengetriebene Eingangsseiten, Straßen-Invalidierung, Min-Heap-A* mit Cache.
- Einwohner: Wohnung, Arbeitsplatz, Alltag (zu Hause → Arbeit → zurück), saubere Auflösung bei Abriss/Straßenverlust/Bevölkerungsrückgang.
- Forstwirtschaft (Bäume: CUT/SAPLING/YOUNG/MATURE, Reservierung, Fracht am Arbeiter, Förster), Landwirtschaft (Feld-Lifecycle, Feldreservierung), Bergbau (endliche Vorkommen, Erschöpfung), Verarbeitung (Säge, Mühle, Bäckerei, Schmiede) – alles physisch.
- Baustellen: Material per Träger, Bauarbeiter, Fortschritt nur mit Material + Arbeitern; Straßen/Felder sofort bezahlt.
- Upgrades (Stufe 1–3 wirken auf Stellen, Lager, Tempo, Reichweite) und Rotation (Footprint, Eingang, Renderer, Save).
- Save v4 inkl. Migration v1–v3, Server-Größenlimits, `audit()`-Invarianten, Stresstest (300+ Einwohner).

## NEXT

1. Logistik-Overlay im Renderer (Träger-Engpässe, blockierte Straßen, Auftragslinien).
2. Straßen-Prioritäten / mehrere Lagerhaus-Zuständigkeiten, Träger-Rückkehr zum Lagerhaus bei Leerlauf.
3. Tag/Nacht-Routinen (Essen, Schlafen) auf Basis des Resident-Zustandsmodells.
4. Barracks/Markt als physische Lieferziele (Brot/Werkzeuge per Träger).

## LATER

- Fog of War, Scouts (eigenes Bewegungsprofil), Territorium.
- Soldaten-Einheiten und Gegner-KI.
- Brücken, Tiere, Rauch-/Wasser-Details; Skalierung auf 1.000+ Einheiten.
