# Mitmachen

Danke, dass du helfen willst. Diese Seite erklärt, wie eine Mission aufgebaut ist und welche Regeln für Inhalte gelten.

## Regeln für Inhalte

1. **Belege.** Jeder Befehl und jede Option wird gegen die Handbuchseite (`man`) geprüft, jede Zuordnung zu einem Lernziel gegen die [Lernziele des LPI](https://www.lpi.org/our-certifications/exam-101-102-objectives/). Aussagen zur Lernforschung brauchen eine Quelle, bevorzugt eine Meta-Analyse.
2. **Keine echten Prüfungsfragen.** Fragen aus Prüfungen oder sogenannten „Braindumps“ dürfen nicht hinein. Das verletzt die Regeln des LPI und hilft beim Lernen auch nicht.
3. **Nichts aus den Lernmaterialien des LPI kopieren.** Sie stehen unter CC BY-NC-ND 4.0, Bearbeitungen sind dort nicht erlaubt. Verlinken ist in Ordnung.
4. **Sprache.** Kurze Sätze, ein Gedanke pro Absatz, kein Fachwort ohne Erklärung. Beim ersten Auftreten das englische Wort in Klammern, weil Befehle und viele Prüfungen englisch sind.

## Aufbau einer Mission

Eine Mission ist eine Datei `src/missionen/<id>.mdx`. Die ID steht auch in `src/data/kampagne.ts` und ändert sich **nie**, weil der gespeicherte Fortschritt daran hängt. Sobald die Datei fertig ist, bekommt die Mission dort `bereit: true`.

```mdx
---
id: l1-1-3
checks:            # alle Prüfungen der Mission, in der Reihenfolge auf der Seite
  - id: k1
  - id: laden
  - id: labor
    hardware: true # Aufgabe im eigenen Labor, darf übersprungen werden
spick:             # Spickzettel neben der Mission
  - t: "Laden"
    v: "modprobe name"
karten:            # Karteikarten für das Wiederholsystem
  - f: "Welcher Befehl zeigt alle geladenen Module?"
    a: ["lsmod"]                     # erlaubte Antworten, getippt
  - f: "Was bewirkt blacklist?"
    a: ["Nur das automatische Laden wird verhindert."]
    aufdecken: true                  # Antwort wird aufgedeckt und selbst bewertet
---
```

> [!IMPORTANT]
> Karteikarten werden über ihre Position gezählt (`k:<mission>:<nummer>`). Neue Karten nur **hinten anhängen**, nie mitten hinein, sonst verrutscht der Lernstand aller Nutzer.

Der Text folgt immer demselben Muster: **Karte** (eine Erklärung, höchstens etwa 120 Wörter) → **Merke** (ein Satz) → **Prüfung**. Jede `## Überschrift`, jede Karte und jede Prüfung wird im Modus „Schritt für Schritt“ zu einem eigenen Bildschirm.

## Bausteine

| Baustein | Wofür | Wichtige Eigenschaften |
| --- | --- | --- |
| `Quiz` | Verständnisfragen | `fragen: [{ frage, richtig, falsch: [], erklaerung }]` |
| `Terminal` | Übung im simulierten Terminal | `aufgaben`, optional `welt`, `einleitung` |
| `Labor` | Ausgabe aus der eigenen VM prüfen | `befehl`, `aufgabe`, `muster: []` (reguläre Ausdrücke), `nicht`, `hilfe` |
| `Zuordnung` | Begriffe zuordnen | `paare: [{ links, rechts }]`, `extra` (Ablenker) |
| `Reihenfolge` | Schritte ordnen | `schritte` in richtiger Reihenfolge |
| `Lueckentext` | Konfiguration oder Befehl ergänzen | `code` mit `___`, `luecken: [{ loesungen, tipp }]` |
| `Logdiagnose` | Bosskampf | `faelle: [{ symptom, log, richtig, falsch, erklaerung }]`, `anzahl` |
| `Probe` | Probeprüfung | `ziele`, `anzahl`, optional `minuten`, `richtwert` |
| `Bestaetigung` | etwas bestätigen | `text`, `hardware` |

### Aufgaben im Terminal

```js
{ text: 'Entlade pcspkr.',               // HTML erlaubt
  befehl: '^modprobe -r pcspkr$',         // regulärer Ausdruck, geprüft mit und ohne führendes sudo
  auchFehler: true,                       // zählt auch, wenn der Befehl scheitert
  zustand: 'modul:pcspkr=aus',            // Zustand, der irgendwann erreicht sein muss
  frage: 'Was meldet modprobe?', antwort: ['…'], tipp: '…' }
```

Zustände (mehrere mit `&&` verbinden, `nicht:` davor kehrt einen um):

- System: `modul:NAME=an|aus`, `default=TARGET`, `target=TARGET`, `shutdown=geplant|keiner|reboot|poweroff`, `aus=poweroff|reboot|halt`, `wall`, `root`, `neustart`, `host=NAME`
- Dateien: `datei:/pfad~regex` (Pfad darf mit `*` enden), `da:/pfad`, `ordner:/pfad`, `fehlt:/muster*`, `leer:/pfad`, `modus:/pfad=0640`, `cwd=/pfad`
- Shell: `var:NAME~regex`, `export:NAME`, `alias:NAME~regex`, `umask=0027`, `historie~regex`, `roh~regex` (Eingabe vor der Verlaufserweiterung, etwa `!!`), `ohneVerlauf:BEFEHL`, `ausgabe~regex`
- Prozesse und Jobs: `prozess:PID=weg|da`, `signal:PID=NR`, `laeuft:regex`, `ni:PID|regex=WERT`, `nohup:regex`, `job:regex=Running|Stopped|weg`, `strg-c`, `strg-z`
- vi: `vi:gespeichert|verworfen|unveraendert|ohne[:/pfad]`
- Platten: `tabelle:sdb=gpt|dos|keine`, `partitionen:sdb=N`, `partgroesse:/dev/sdb1=49-51G`, `parttyp:/dev/sdb2~regex`, `fs:/dev/sdb1=ext4`, `fslabel:/dev/sdb1=NAME`, `eingehaengt:/dev/sdb1=/pfad`, `ausgehaengt:/dev/sdb1`, `mountopt:/dev/sdb1~regex`, `swapan:/dev/sdb2`, `fsdatei:/dev/sdb1:/datei`, `maxmount:…=N`, `reserviert:…=N`, `heil:/dev/sdb1`, `unitaktiv:mnt-x.mount`
- Rechte und Links: `modus:/pfad=2770`, `besitzer:/pfad=user[:gruppe]`, `gruppe:/pfad=NAME`, `symlink:/pfad=ziel`, `hardlink:/a=/b`, `updatedb`
- Pakete: siehe `zustandPakete` in `src/scripts/shell-pakete.ts`
- Shells und Skripte: `funktion:name`, `gelesen:/pfad` (Startdatei seit dem letzten Shell-Start gelesen), `shlvl=N`, `login`, `post:root~regex` (Mail an root), `code=N` (letzter Rückgabewert), `option:x|e|u`
- Grafik (Welt-Option `grafik: 'x11' | 'wayland'`): `xhost:offen|zu`, `xhost:+rechner`, `gsetting:schema schlüssel=wert`, `fenster:programm`
- Konten: `konto:name[~regex]`, `shadow:name~regex`, `gruppe-da:name`, `mitglied:gruppe=benutzer`
- Zeit und Sprache: `cron:benutzer~regex`, `keincron:benutzer`, `atjob~regex`, `keinatjob`, `timer:name.timer=aktiv|enabled|beides`, `zone=Europe/Berlin`, `systemlocale=regex`
- Dienste (Welt-Option `dienste: { rsyslog, uhrFalsch, rtcFalsch, journalFluechtig, druckerAngehalten, druckJobs }`): `uhr:richtig`, `rtc:richtig`, `ntp:an`, `rsyslog:aktuell`, `fernlog:host`, `journal~regex`, `journal:dauerhaft`, `aliasdb:name=ziel`, `mailq:leer`, `mailq~regex`, `drucker:name=aktiv|deaktiviert|akzeptiert|abgelehnt|standard|da|weg`, `druckjob:drucker~regex`, `gedruckt~regex`, `keinjob:drucker`

Startzustand einer Station (`welt`): `dateien` (Inhalt `'/'` legt ein Verzeichnis an), `rechte` (`'/pfad': '755 besitzer gruppe'`), `zeiten` (Alter in Tagen), `extraProzesse`, `pathStandard` (Debian-PATH ohne /usr/sbin), `cwd`, `host`, `distro`, `virt`, `neuePlatte` (`true` leer, `'partitioniert'`, `'formatiert'`), `kaputt` (Liste von Partitionen mit Dateisystemfehlern).

Aufbau des Simulators: `shell.ts` (Parser, Umleitungen, PATH, Jobs, Systembefehle), `shell-text.ts` (Textfilter, Dateien, Archive, Prozesse), `shell-pakete.ts` (Pakete, Platten, Bootloader), `shell-dateien.ts` (Rechte, Zeiten, Prüfsummen), `shell-man.ts` (Handbuchseiten), `shell-platten.ts` (Platten, Dateisysteme, mount), `shell-rechte.ts` (chmod, chown, Links, locate), `shell-skript.ts` (if, for, while, case, Funktionen, test, read, Arithmetik, neue Shells mit Startdateien), `shell-x11.ts` (X11, Wayland, xhost, xauth, gsettings), `shell-admin.ts` (Konten und Gruppen), `shell-zeit.ts` (cron, at, Timer, date, Locales, Zeitzonen, iconv), `shell-dienste.ts` (hwclock, chrony, rsyslog, Journal, logrotate, Mail-Zustellung, CUPS), `vi.ts` (der Editor). Fehlermeldungen folgen den deutschen Übersetzungskatalogen der GNU-Werkzeuge (`LANG=de_DE.UTF-8`). Wo Debian keine Übersetzung mitliefert (vim.tiny, gzip), bleiben sie englisch.

Der Simulator (`src/scripts/shell.ts`) kennt nur die Befehle, die in Missionen vorkommen. Neue Befehle dort ergänzen und dabei das Verhalten eines echten Debian nachbilden, auch die Fehlermeldungen. Testen lässt sich der Simulator auch ohne Browser:

```bash
npx esbuild src/scripts/shell.ts --bundle --format=esm --platform=node --outfile=/tmp/shell.mjs
node -e "import('/tmp/shell.mjs').then(({neueWelt,ausfuehren})=>{const w=neueWelt();console.log(ausfuehren(w,'lsmod | grep snd').ausgabe)})"
```

## Fragen für Probeprüfungen

Fragen stehen in `src/data/fragen.ts`, jede mit Lernziel, Typ (`einfach`, `mehrfach`, `eingabe`) und Erklärung. Die ID ändert sich nie. Gute Fragen prüfen Anwendung statt Wortlaut, haben plausible Ablenker und eine Erklärung, die auch erklärt, warum die falschen Antworten falsch sind.

## Ein neuer Akt

In `src/data/kampagne.ts` erzeugt `geplanterAkt()` aus den Lernzielen automatisch eine Mission pro Lernziel. Wird ein Akt ausgeschrieben, ersetzt eine Liste von Hand die Automatik. Dabei dürfen Lernziele auf mehrere Missionen aufgeteilt werden. Jede Mission bekommt `ziele: ['101.1']`, damit die Lernziel-Karte stimmt.
