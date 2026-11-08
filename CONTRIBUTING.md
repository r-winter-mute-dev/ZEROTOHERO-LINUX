# Mitmachen bei 0 to Hero: Linux

Danke, dass du helfen willst. Hier steht, wie das Projekt aufgebaut ist und wie du eine Mission schreibst.

## Fehler melden

Öffne ein Issue und beschreib, auf welcher Mission du warst und was nicht gestimmt hat. Bei Nachweisen hilft es, wenn du dazuschreibst, ob du WSL oder eine VM benutzt und was `uname -r` ausgibt.

## Aufbau des Projekts

```
src/
  config.ts              Name der Seite, Link zum Repository
  data/kampagne.ts       Alle Akte und Missionen (IDs, Titel, XP, Level)
  missionen/*.mdx        Ausgeschriebene Missionen, eine Datei pro Mission
  components/            Prüfungen und interaktive Bausteine
  scripts/engine.ts      Fortschritt, Punkte, Freischaltung, Export/Import
  scripts/station.ts     Gemeinsame Logik aller Prüfungen
  scripts/shell.ts       Mini-Shell und virtuelles Dateisystem für den Simulator
  pages/                 Startseite, Missionsseiten, Fortschritt, Über
tests/befehle.sh         Befehle aus den Missionen, monatlich in frischen Debian-Containern geprüft
```

## Eine Mission schreiben

1. In `src/data/kampagne.ts` bei der Mission `bereit: true` setzen. Die **ID nie ändern**, der gespeicherte Fortschritt der Lernenden hängt daran.
2. Die Datei `src/missionen/<id>.mdx` anlegen. Als Vorlage eignet sich `l-0-4.mdx`.
3. Im Frontmatter alle Prüfungen unter `checks` auflisten. `hardware: true` heißt: Diese Prüfung braucht ein echtes Linux und wird im Modus „ohne Linux“ übersprungen. Der Name des Feldes stammt aus dem Elektronik-Kurs und bleibt gleich, damit beide Kurse dieselbe Engine nutzen.
4. Jede Prüfungskomponente bekommt eine `id`, die genau so in `checks` steht.
5. Unter `spick` die Befehle und Begriffe eintragen, die man in dieser Mission braucht. Sie stehen neben jeder Aufgabe, damit niemand sich etwas merken muss. In Bosskämpfen keine Lösungen hineinschreiben.

```mdx
---
id: l-1-1
abzeichen: Pfadfinder
checks:
  - id: sim
  - id: echt
    hardware: true
spick:
  - t: Wo bin ich?
    v: "<code>pwd</code>"
---
import Terminal from '../components/Terminal.astro';
import Nachweis from '../components/Nachweis.astro';

Text der Mission …

<Terminal id="sim" ziele={[
  { text: 'Finde heraus, wo du bist.', befehl: '^pwd$' },
  { text: 'Geh in den Ordner Dokumente.', ort: '~/Dokumente', tipp: '<code>cd Dokumente</code>' },
]} />
<Nachweis id="echt" befehl="pwd; whoami" muster={['^/home/[a-z_][a-z0-9_-]*$']} />
```

## Bausteine

| Komponente | Zweck |
| --- | --- |
| `Karte` | Theorie-Karte (höchstens etwa 120 Wörter) |
| `Merke` | Der eine Satz, der hängen bleiben soll. Höchstens einer pro Abschnitt |
| `Checkliste` | Abhakliste für Arbeitsschritte, der Stand wird im Browser gemerkt |
| `Hinweis` | Kasten für Sicherheit, Hintergrund oder vorläufige Angaben |
| `Quiz` | Multiple Choice, alle Antworten müssen stimmen |
| `Bestaetigung` | Abhaken, zum Beispiel „Ich habe einen Snapshot angelegt“ |
| `Terminal` | Terminal-Simulator mit Zielen. Ein Ziel kann `befehl` (Regex auf die Eingabe), `ausgabe` (Regex auf die Ausgabe), `ort` (Ordner danach), `code` (Exit-Code) und `existiert` (Pfad) prüfen, dazu ein `tipp` nach zwei Fehlversuchen. `start` legt Startordner und zusätzliche Dateien fest |
| `Nachweis` | Ein Befehl läuft im echten Linux, die Ausgabe wird eingefügt und mit Regex geprüft. `{code}` wird durch einen persönlichen Zufallscode ersetzt, `{sha}` steht für `sha256(code + "\n")`, also die Ausgabe von `echo <code> \| sha256sum`. `hilfe` gibt passende Tipps bei falschen Ausgaben |
| `Lueckentext` | Code-Puzzle: Jede Lücke `___` im Code wird ein Eingabefeld. Den Code in `src/data/puzzles.ts` ablegen, weil MDX die Einrückung in mehrzeiligen Attributen entfernt |
| `Logdiagnose` | Fehlersuche anhand von Fehlermeldungen und Logs, zeigt zufällige Fälle nacheinander. Ideal für Bosskämpfe |
| `Zahl` | Ein Zahlenwert wird gegen ein Toleranzband geprüft, zum Beispiel eine Dateigröße |
| `Rack` | Das Server-Rack auf Start- und Kampagnenseite |

## Der Simulator

Die Mini-Shell in `src/scripts/shell.ts` bildet einen kleinen Teil von bash und GNU coreutils nach. Regeln:

1. Ausgaben und Fehlermeldungen so, wie sie unter Debian wirklich erscheinen (englisch, gleiche Form). Wer sie im Simulator gesehen hat, soll sie im echten Terminal wiedererkennen.
2. Darunter darf ein deutscher Hinweis stehen (zweites Argument von `ctx.fehler`).
3. Neue Befehle kommen erst, wenn eine Mission sie braucht. Unbekannte Optionen melden einen Fehler statt sie still zu ignorieren.
4. Was im Simulator nicht geht (zum Beispiel `sudo`), sagt das ehrlich und verweist auf die Mission, in der es drankommt.

## Regeln für jede Mission

1. Gliederung: Einstieg → Theorie-Karten → Übung oder Simulator → realer Aufbau → Prüfung → typische Fehler → Vertiefung.
2. Der Einstieg beginnt mit einem Problem am Server, nie mit einer Definition.
3. Höchstens vier Theorie-Karten. Eine neue Idee pro Mission.
4. Mindestens eine Prüfung mit echtem Bezug (Terminal-Nachweis), nicht nur ein Quiz. Dazu eine Übung im Simulator für den Weg ohne Linux.
5. Falsche Quizantworten sind echte Fehlvorstellungen, keine Scherzantworten.
6. Jede technische Angabe ist belegt (man-Page, Debian-Dokumentation, offizielle Doku des Programms) oder als ungeprüft markiert.
7. Der Weg ohne Linux bleibt immer möglich.
8. Sprache: kurze Sätze, Du-Form, Fachbegriffe beim ersten Auftreten erklären.
9. Kleine Schritte: Die Seite zeigt jede Zwischenüberschrift und jede Theorie-Karte als eigenen Bildschirm. Eine Übung steht auf demselben Bildschirm wie die Erklärung davor. Lieber kurz erklären und gleich fragen, als lange erklären und am Ende viel abfragen (Vorlage: `l-0-2.mdx`).
10. Keine Zeitlimits, keine Serien, die man verlieren kann, keine blinkenden Belohnungen. Fortschritt soll sichtbar sein, nicht Druck machen.

## Befehle prüfen

Jeder Befehl, den eine Mission im echten Terminal ausführen lässt, gehört zusätzlich in `tests/befehle.sh`. Die GitHub Action `befehle.yml` führt das Skript jeden Monat in frischen Containern mit `debian:13` und `debian:stable` aus. Schlägt ein Befehl fehl, wird der Lauf rot, und die betroffene Mission muss angepasst werden. Spätestens wenn Debian 14 erscheint, zeigt der Lauf mit `debian:stable`, was sich geändert hat. Das Skript gibt außerdem das echte `/etc/os-release` aus, damit der Simulator aktuell bleibt. Lokal geht das mit Docker oder Podman:

```bash
docker run --rm -v "$PWD/tests:/tests:ro" debian:13 bash /tests/befehle.sh
```

## Lokal testen

```bash
npm install
npm run dev      # Entwicklungsserver auf http://localhost:4321
npm run build    # baut die Seite nach dist/
npm run preview  # zeigt den Build lokal an
```

## Lizenz von Beiträgen

Mit einem Beitrag stimmst du zu, dass Inhalte unter CC BY-SA 4.0 und Code unter MIT veröffentlicht werden.
