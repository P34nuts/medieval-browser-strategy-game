# Burgfried – mittelalterliches Browser-Aufbaustrategiespiel

Vom kleinen Weiler zur großen Stadt: Landschaft erkunden, Gebäude bauen, Rohstoffe gewinnen, Produktionsketten
aufbauen, Bevölkerung versorgen, Technologien erforschen, Handel treiben und Militär entwickeln.
Läuft im Browser (Desktop: Windows/Mac, Mobil: iPhone Safari, Android Chrome, Tablets).

## Installation & Start

Voraussetzungen: Node.js ≥ 20, PostgreSQL (lokal).

```bash
npm install
# .env enthält: DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_db
npx drizzle-kit push --config drizzle.config.json   # Tabellen anlegen (users, sessions, saves)
npm run build
npm run start                                        # http://localhost:3000
# Entwicklung: npm run dev
```

Tests der Spiellogik (headless, ohne Browser): `npx tsx scripts/sim-test.ts` · Stresstest: `npx tsx scripts/stress-test.ts`

## Architektur

```
src/
  db/schema.ts            users, sessions (Token-Hash), saves (JSON-Spielstand)
  lib/auth.ts             scrypt-Passwort-Hash, Bearer-Sessions, Rate-Limit
  lib/client-api.ts       fetch-Wrapper + Token im localStorage
  app/api/auth/*          register, login, logout, me
  app/api/save            GET = Laden, PUT = Speichern (ein Slot pro Account)
  game/data.ts            ALLE Spieldaten: Ressourcen, Gebäude, Berufe, Forschung, Aufgaben, Level
  game/mapgen.ts          Kartengenerator (deterministisch aus Seed)
  game/engine.ts          Simulation (ohne DOM): Bauen, Straßennetz, Arbeiter, Produktion, Bevölkerung,
                          Forschung, Handel, Aufgaben, Level, Save/Load
  game/sprites.ts         Prozedurale isometrische Gebäude-Sprites (gecacht)
  game/renderer.ts        Canvas-Renderer, Kamera, Chunk-Baking, Maus-/Touch-Eingabe
  components/             React-HUD (TopBar, Bau-/Aufgabenpanel, Schnellmenü, Fenster, Login)
scripts/sim-test.ts       Automatisierte Logiktests
```

Prinzipien:
* **Datengetrieben** – neue Gebäude/Ressourcen/Aufgaben = Einträge in `data.ts`, keine Engine-Änderung nötig.
* **Engine ≠ UI** – die Engine kennt kein DOM; React liest den Zustand über `useSyncExternalStore` (~4×/s).
* **Kleine Saves** – gespeichert werden nur Seed, Gebäudeliste und Zahlen; die Karte wird aus dem Seed neu erzeugt.
* **Performance** – Gelände wird in 8×8-Chunks einmalig gebacken; Sprites gecacht; nur sichtbare Objekte werden
  gezeichnet; DPR auf 2 begrenzt; Simulation in festen 0,5-s-Schritten.
* **Sicherheit** – Passwörter mit scrypt + Salt, Session-Tokens nur als SHA-256 in der DB, Rate-Limit für
  Login/Registrierung, Eingabevalidierung, Größenlimit für Saves, defensives Laden von Spielständen.

## Spielmechanik (Kurzfassung)

* **Physische Wirtschaft:** Ware existiert in Lagerhäusern/Burgen, in Produktionslagern, auf Baustellen oder auf dem Rücken eines Trägers – es gibt keinen globalen Zähler. Die HUD-Zahlen sind die Summe der Hub-Lager.
* **Straßen & Eingänge:** Jedes Gebäude hat einen Eingang (Seite; dreht mit). Nur wenn der Eingang an einer mit einem Lagerhaus verbundenen Straße liegt, funktioniert das Gebäude. Träger gehen ausschließlich auf Straßen; ohne Route wartet der Auftrag (`BLOCKED_NO_ROUTE`).
* **Bevölkerung:** Jeder Einwohner ist eine Figur mit Haus, Beruf und Arbeitsplatz. 85 % können arbeiten. Träger und Bauarbeiter sind Berufe am Lagerhaus – zu wenige Träger sind ein echter Engpass (Lagerhaus ausbauen/zweites Lagerhaus).
* **Bauen:** Platzieren erzeugt eine Baustelle. Träger liefern das Material, Bauarbeiter bauen; Fortschritt braucht beides. Straßen und Felder werden sofort bezahlt.
* **Ketten:** Holzfäller (trägt Holz) → Sägewerk → Lager; Förster pflanzt nach; Bauer (Feld-Lifecycle) → Mühle → Bäckerei → Lager; Mine/Steinbruch mit endlichen Vorkommen; Schmiede.
* **Nahrung:** 0,12 Brot/Getreide pro Einwohner und Minute aus den Lagern (Brot bevorzugt, beschleunigt das Wachstum).
* **Level:** Erfahrung durch Bauen, Aufgaben und Forschung. Freischaltungen: L1 Grundgebäude, L5 Landwirtschaft, L10 Industrie, L15 Militär, L20 Fortgeschrittene Gebäude.

## Funktionen

Siehe Abschnitt „Liste aller Funktionen“ in der Abschlussmeldung; Kurzform: automatische Karte (Gras, Wald, Berge,
Flüsse, Seen, Erzvorkommen), 18 Gebäude mit Vorschau/Kostenanzeige/Gültigkeitsprüfung/Bauanimation, 10 simulierte
Ressourcen mit Bestand/Produktion/Verbrauch/Lagerlimit, Produktionsketten-Ansicht mit Engpass-Analyse, Bevölkerung
mit 6 Berufen, Levelsystem, Aufgaben, Forschung, Handel, Account/Login, Speichern/Laden (Autosave).

## Bekannte Einschränkungen

* Der Spielstand wird clientseitig berechnet (Single-Player); der Server prüft nur die Struktur, nicht die
  Spielregeln – Manipulation des eigenen Spielstands ist möglich.
* Wälder wachsen nur durch Förster (oder sehr langsam natürlich) nach.
* Keine Offline-Produktion: die Simulation läuft nur, solange das Spiel geöffnet ist.
* Straßen können Wasser, Berge und Wälder nicht kreuzen (keine Brücken).
* Kein Gegner/Kampfsystem: Militär wirkt über „Militärstärke“ (Soldaten, Türme, Burg) und Aufgaben.
* Das Sitzungs-Token liegt im localStorage (kein Cookie), damit Login auch in eingebetteten Vorschauen funktioniert.
