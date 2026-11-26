# Arbeitsanweisungen für Claude

Kurs „Linux to Hero“: interaktive Vorbereitung auf LPIC-1, LPIC-2 und LPIC-3 Security, auf Deutsch. Astro mit MDX, statisch auf GitHub Pages (`.github/workflows/deploy.yml`). Inhalt und Regeln für Beiträge stehen in `CONTRIBUTING.md`, die Tests in `tests/README.md`. Diese Datei ergänzt beides um den Arbeitsablauf und die Fallen, die beim Bauen aufgefallen sind.

## Mit dem Maintainer

- Antworten auf Deutsch, sachlich, ohne Füllwörter. Fakten zu Lernzielen, Programmen und Verhalten nachprüfen oder als nicht geprüft kennzeichnen.
- Commits als `Winter-Mute <198657640+r-winter-mute-dev@users.noreply.github.com>`. In einem frischen Klon zuerst `git config user.name "Winter-Mute"` und `git config user.email "198657640+r-winter-mute-dev@users.noreply.github.com"`. Am Ende jeder Commit-Nachricht die Attributionszeilen, die die Sitzung vorgibt.
- Commit-Nachrichten auf Deutsch: eine Betreffzeile, dann Stichpunkte. Direkt auf `main`, danach den Deploy prüfen (`gh run list -R r-winter-mute-dev/ZEROTOHERO-LINUX -L 3`).
- Keine echten Prüfungsfragen, nichts von LPI abschreiben (siehe CONTRIBUTING).

## Stand

- LPIC-1: alle Akte fertig.
- LPIC-2: Akt 0 bis 6 fertig (Topics 200 bis 205). **Als Nächstes Akt 7, Topic 206** (206.1 aus dem Quellcode bauen, 206.2 Datensicherung, 206.3 Benutzer informieren). Akt 7 enthält schon die Mission `l2-7-probe`, die Generalprobe für Prüfung 201 (Topics 200 bis 206). Sie bleibt beim Ausschreiben des Akts erhalten und wird mit fertig gemacht.
- Danach Akt 8 bis 13 (Topics 207 bis 212, Prüfung 202). Akt 13 enthält die Generalprobe 202 (`l2-13-probe`).
- LPIC-3: nur geplant. Labore dort nur in echten VMs (siehe CONTRIBUTING, Abschnitt Labore). Vor dem ersten Akt prüfen, welche Version der Lernziele gilt: Die LPI-Übersichtsseite nannte im November 2026 andere Themen als das Wiki (303-300 v3.0).
- Zuordnung LPIC-2: Prüfung 201 = Topics 200 bis 206, Prüfung 202 = Topics 207 bis 212. In Texten nicht verwechseln.

## Ablauf für einen neuen Akt

1. Offizielle Lernziele 4.5 holen (Wiki `wiki.lpi.org/wiki/LPIC-202_Objectives_V4.5` bzw. `…201…`, Ersatz: `lpi.org/10xu`). Gewichte, Wissensgebiete und die Liste der Dateien, Begriffe und Werkzeuge notieren. Was im Entwurf 5.0 wegfällt oder umzieht, in den Missionen kennzeichnen. Nicht Geprüftes als nicht geprüft kennzeichnen.
2. Simulator erweitern: in der Regel ein neues Modul `src/scripts/shell-THEMA.ts` mit eigener Welt-Option (Muster: `shell-speicher.ts`, `shell-netzwerk.ts`). Jeden Ablauf mit `node tests/rep.mjs` durchspielen.
3. Missionen `src/missionen/l2-N-1.mdx` … mit Karten, Quiz, Zuordnung oder Reihenfolge, Lückentext, Terminal, Labor, Hinweis. Dazu Bosskampf `l2-N-boss.mdx` und Probe `l2-N-probe.mdx` (Lernziele des Akts plus passende LPIC-1-Wiederholung).
4. Fragen in `src/data/fragen.ts`: mindestens drei je Gewichtspunkt eines Lernziels.
5. Eintrag in `src/data/kampagne.ts` (ersetzt `geplanterAkt(…)`), Handbuchseiten in `src/scripts/shell-man.ts`, Pakete in `src/scripts/shell-pakete.ts`, Lösungen für jede Terminal-Aufgabe in `tests/loesungen.json`, Zeile in der Tabelle im README, Zustandsschlüssel und Modul in CONTRIBUTING.
6. Prüfen: `npm run build`, `npm run test:fragen`, `npm run test:e2e` (alle Missionen), Vergleichsfälle für neue Prüfprogramme in `tests/vergleich/faelle/` anlegen.
7. Commit, Push, Deploy und Action „Simulator gegen echte Systeme“ prüfen.

## Ein neues Simulator-Modul einhängen

In `src/scripts/shell.ts`, genau wie bei `shell-speicher.ts` und `shell-netzwerk.ts`:

- Import und Feld in `WeltOptionen`, Start in `neueWelt` (`if (o.x) xStarten(w, o.x)`).
- Befehle mit `Object.assign(befehle, xBefehle({ ...befehle }))` nach den Modulen, deren Befehle umhüllt werden. Die Reihenfolge entscheidet, wer wen umhüllt.
- Zustandsprüfung `zustandX(w, s)` in die Kette in `zustandStimmt`. Sie gibt `undefined` zurück, wenn der Schlüssel nicht zu ihr gehört.
- Programme brauchen eine Datei im Dateisystem (`/usr/sbin/…` oder `/usr/bin/…`). Liegt sie in `/usr/sbin`, gehört der Name in das Set `SBIN`, sonst findet die Shell den eingebauten Befehl nicht.
- Ohne Welt-Option muss alles wie vorher bleiben (Muster `mit(name, f)`), damit ältere Missionen nicht kippen.

## Fallen

- Jeder Befehl läuft auf einer Kopie der Welt (`structuredClone`). Nie Funktionen im Zustand speichern.
- Zustandsschlüssel: Präfixe dürfen sich nicht überschneiden. `zustandStart` beansprucht `rl|sysvlauf|unit|efi|startmodus|chroot|bind|gebootet|live|rootpw|iso` und gibt in anderen Welten `false` zurück. Darum heißen die Schlüssel in Akt 4 `isobild:` und `udfbild:`.
- Regex für Schnittstellen und Geräte mit `[\w.-]+`, nicht `\w+` (Namen wie `enp0s31f6.20`).
- Zustandsprüfungen in Terminal-Aufgaben bleiben erfüllt, sobald sie einmal galten. `befehl` zählt nur mit Rückgabecode 0, außer mit `auchFehler: true`. Beim Vergleich der Befehle wird ein führendes `sudo` entfernt.
- Fragen in Terminal-Aufgaben (`frage`, `antwort`) füllt `tests/e2e.py` in der Reihenfolge der Aufgaben aus `tests/loesungen.json`.
- MDX entfernt in Template-Literalen von Lückentexten zwei Leerzeichen Einrückung. Eingerückte Zeilen dort um zwei Leerzeichen mehr einrücken.
- Indexfilter wie `a.filter((x, i) => i !== idx + 1)` mit `idx = -1` schneiden das erste Argument ab. Immer `(idx < 0 || …)` prüfen.
- Dialoge (Passwortabfragen) laufen über `w.dialog`, Rückfragen wie `[y/N]` über `w.wartet`.
- Fragen in `fragen.ts`: Die richtige Antwort steht immer an Index 0, die Seite mischt. `tests/fragen.mjs` meldet richtige Antworten, die auffällig länger sind als die falschen. Solche Hinweise beheben, indem die falschen Antworten länger werden. IDs nie ändern.
- Der Abgleich mit echten Systemen vergleicht Rückgabecodes. Fälle für `ip` laufen auf dem Kernel des Runners. Was von der Kernelversion abhängt, gehört nicht hinein.
- Ohne Zugriff auf Docker Hub lassen sich die Vergleichsfälle lokal in einem eigenen Netz-Namensraum gegen das installierte System laufen lassen: `sudo unshare -n python3 tests/vergleich/echt.py lokal /tmp/echt.json`, dann `node tests/vergleich/simulator.mjs debian /tmp/sim.json` und `node tests/vergleich/vergleiche.mjs /tmp/echt.json /tmp/sim.json`.

## Testbefehle

| Befehl | Zweck |
|---|---|
| `node tests/rep.mjs 'BEFEHLE' '{WELT}'` | Befehle im Simulator abspielen, `#z ZUSTAND` prüft einen Zustand |
| `npm run test:fragen` | Prüfungsfragen prüfen |
| `npm run build && npx astro preview --port 4321` | Seite bauen und lokal ausliefern |
| `CHROME=/usr/bin/google-chrome python3 tests/e2e.py [IDS]` | Missionen im Browser durchspielen, ohne IDs alle (dauert einige Minuten) |
| `npm run test:vergleich` | Vergleichsfälle in Debian 12 per Docker |
