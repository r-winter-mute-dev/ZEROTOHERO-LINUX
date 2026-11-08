<p align="center">
  <img src="docs/banner.svg" alt="0 to Hero: Linux – Linux von null an, Befehl für Befehl" width="100%">
</p>

<p align="center">
  <a href="https://r-winter-mute-dev.github.io/ZEROTOHERO-LINUX/"><img src="https://img.shields.io/badge/Zum_Kurs-starten-cba6f7?style=for-the-badge&labelColor=1a1a1a" alt="Zum Kurs"></a>
</p>

<p align="center">
  <a href="https://github.com/r-winter-mute-dev/ZEROTOHERO-LINUX/actions/workflows/deploy.yml"><img src="https://github.com/r-winter-mute-dev/ZEROTOHERO-LINUX/actions/workflows/deploy.yml/badge.svg" alt="Veröffentlichung"></a>
  <a href="https://github.com/r-winter-mute-dev/ZEROTOHERO-LINUX/actions/workflows/befehle.yml"><img src="https://github.com/r-winter-mute-dev/ZEROTOHERO-LINUX/actions/workflows/befehle.yml/badge.svg" alt="Befehle auf aktuellem Arch geprüft"></a>
  <img src="https://img.shields.io/badge/spielbar-Akt_0-a6e3a1?labelColor=2a2a2a" alt="Spielbar: Akt 0">
  <img src="https://img.shields.io/badge/kostenlos-ohne_Anmeldung-cba6f7?labelColor=2a2a2a" alt="Kostenlos, ohne Anmeldung">
  <img src="https://img.shields.io/badge/Inhalte-CC_BY--SA_4.0-a0a0a0?labelColor=2a2a2a" alt="Inhalte: CC BY-SA 4.0">
  <img src="https://img.shields.io/badge/Code-MIT-a0a0a0?labelColor=2a2a2a" alt="Code: MIT">
</p>

<p align="center">
  <em>Diese Website wurde gebaut, um jedem Menschen die Möglichkeit zu geben, das System zu verstehen,<br>auf dem Webserver, Router und Supercomputer laufen: vom ersten Befehl bis zum eigenen, abgesicherten Server.</em>
</p>

---

**0 to Hero: Linux** ist ein kostenloser, interaktiver Linux-Kurs für alle, die bei null anfangen. Du lernst keine Befehlslisten auswendig. Du richtest von Anfang an ein echtes System ein, und jeder Befehl kommt genau dann, wenn du ihn brauchst.

Es ist der Schwesterkurs zu **[0 to Hero](https://github.com/r-winter-mute-dev/ZEROTOHERO)** (Elektronik) und funktioniert genauso.

Willkommen und viel Spaß beim Lernen.

## Kampagne 1: Dein eigener Server

> Am Ende läuft auf deinem **Arch Linux** ein Server, den du komplett im Terminal eingerichtet hast: eine eigene **Statusseite**, ein **Backup**, das jede Nacht von allein startet, Anmeldung nur per **SSH-Schlüssel** und eine **Firewall**.

Der Weg dorthin beginnt mit `whoami`.

## So funktioniert der Kurs

| | |
| --- | --- |
| **Zehn Akte, ein Rack** | Jeder Akt füllt einen Einschub im Server-Rack. Auf der Startseite füllt es sich Einschub für Einschub. |
| **Kleine Schritte** | Eine Erklärung, ein Merksatz, eine kurze Frage. Ein Spickzettel steht immer daneben. |
| **Echte Prüfungen** | Quiz, Code-Puzzle, Terminal-Simulator oder ein **Nachweis**: Du führst einen Befehl in deinem echten Linux aus, und die Seite prüft die Ausgabe direkt im Browser. |
| **Bosskämpfe** | Am Ende jedes Akts wartet eine Fehlersuche: Etwas funktioniert nicht, und du findest anhand der Fehlermeldung heraus, warum. |
| **Auch ohne Linux** | Wer noch kein Linux hat oder nichts installieren darf, kommt im Terminal-Simulator weiter und holt die Nachweise später nach. |
| **Anpassbar** | Schriftgröße, Zeilenabstand, Bewegung und ein Fokusmodus lassen sich einstellen. |
| **Kein Konto, kein Tracking** | Der Fortschritt bleibt in deinem Browser und lässt sich als Code sichern oder übertragen. |

## Lehrplan

| Akt | Einschub | Du lernst | Stand |
| :---: | --- | --- | :---: |
| 0 | Rack | Sicherheit, Arch in WSL oder VM einrichten, das Terminal: Prompt, Befehl, Option, Argument, Tab, Fehlermeldungen lesen | ✅ |
| 1 | Festplatte | `pwd`, `ls`, `cd`, Pfade, Verzeichnisbaum, Dateien anlegen und sicher löschen, man-Pages und Arch Wiki lesen | 🛠️ |
| 2 | Werkzeugkasten | `cat`, `less`, `tail`, nano, Umleitungen, Pipes, `grep`, `find`, `sort`, `uniq`, reguläre Ausdrücke, `sed` und `awk` | 🛠️ |
| 3 | Schloss | Benutzer und Gruppen, rwx, `chmod`, `chown`, root und `sudo`, `PATH` | 🛠️ |
| 4 | Prozessor | Prozesse, `top`, Signale, Hintergrundjobs, Speicher und Platten, Umgebungsvariablen | 🛠️ |
| 5 | Lager | `pacman`, das Update-Ritual, das AUR sicher nutzen, Archive | 🛠️ |
| 6 | Netzwerkkarte | IP und DNS, Ports, `curl`, SSH und Schlüssel, `rsync` | 🛠️ |
| 7 | Steuerplatine | Shell-Skripte: Variablen, Quoting, Bedingungen, Schleifen, Funktionen, robuste Skripte. Ergebnis: dein Backup-Skript | 🛠️ |
| 8 | Wachturm | systemd, `journalctl`, eigene Dienste und Timer. Ergebnis: das Backup läuft jede Nacht | 🛠️ |
| 9 | Schutzschild | Update-Wächter, Firewall, SSH härten, Statusseite, Finale | 🛠️ |

✅ spielbar · 🛠️ geplant, Missionen stehen fest

**Danach geplant:** Kampagne 2 *Arch von Hand* (Installation ohne Installer) und Kampagne 3 *Das Homelab* (Git, Container, Reverse Proxy, Monitoring).

## Warum Arch Linux?

Ein frisches Arch enthält fast nichts. Alles, was auf deinem Server läuft, hast du selbst installiert und verstanden. Dazu kommt das [Arch Wiki](https://wiki.archlinux.org/), eine der gründlichsten Linux-Dokumentationen. Arch ist eine Rolling-Release-Distribution und ändert sich laufend. Damit die Anleitungen im Kurs nicht veralten, prüft eine [GitHub Action](.github/workflows/befehle.yml) jeden Monat die Befehle des Kurses in einem frischen Arch-Container.

## Was du brauchst

Einen Rechner mit Windows 10/11, Linux oder einem Intel-Mac und etwa 20 GB freien Speicher. Unter Windows reicht WSL, sonst eine virtuelle Maschine. Ohne eigenes Linux geht es im Simulator weiter. Die Übersicht steht im Kurs auf der Seite **Einrichtung**.

## Mitmachen

Fehler gefunden, eine Erklärung unverständlich oder Lust, eine Mission zu schreiben? Beiträge sind willkommen. Wie eine Mission aufgebaut ist und welche Bausteine es gibt, steht in [CONTRIBUTING.md](CONTRIBUTING.md).

Am meisten hilft gerade:

- [ ] **Akt 0 mit echtem WSL und echter VM durchspielen.** Stimmen die Schritte mit der aktuellen Version von archinstall und dem WSL-Image überein?
- [ ] **Feedback von Einsteigern.** Wo bist du hängen geblieben?
- [ ] **Missionen für Akt 1 schreiben.** Der Simulator kann schon `cd`, `ls`, `mkdir`, `touch`, `cat` und Umleitungen.

## Entstehung

> [!NOTE]
> Dieser Kurs entsteht mit Unterstützung von **Claude**, einer KI von Anthropic. Die KI ist für dieses Projekt verändert und auf wissenschaftliches Arbeiten ausgelegt.

- **Belege zuerst:** Technische Angaben stützen sich auf die offizielle Dokumentation: man-Pages, Arch Wiki, GNU-Handbücher. Foren, Blogs und soziale Medien gelten nicht als Beleg.
- **Kennzeichnung:** Angaben, die nicht geprüft werden konnten, sind im Kurs markiert.
- **Lernpsychologie:** Der Aufbau der Missionen (kurze Schritte, Merksätze, Fragen direkt nach jeder Erklärung, Spickzettel, wenig Ablenkung) folgt dem Elektronik-Kurs und damit der Forschung zu Arbeitsgedächtnis, Segmentierung und ADHS. Wo es keine direkte Studie zu einem Linux-Kurs gibt, ist das eine begründete Übertragung, kein Nachweis.

Die Idee, die Ziele und die Entscheidungen kommen von einem Menschen. Texte, Übungen und der Simulator stammen von der KI, ein Mensch prüft sie und gibt sie frei. Auch so können Fehler drinstecken. Wenn dir etwas falsch vorkommt, [öffne ein Issue](https://github.com/r-winter-mute-dev/ZEROTOHERO-LINUX/issues). Hinweise mit Quelle helfen am meisten.

## Für Entwickler

<details>
<summary><strong>Lokal starten</strong></summary>

Voraussetzung: Node.js 22.23.4 oder neuer (empfohlen: Node 24).

```bash
npm install
npm run dev
```

Die Seite läuft dann unter http://localhost:4321.
</details>

<details>
<summary><strong>Technik</strong></summary>

Statische Seite mit [Astro](https://astro.build) und MDX, ohne Server und ohne externe Dienste. Engine, Layout und Prüfungsbausteine stammen aus [0 to Hero](https://github.com/r-winter-mute-dev/ZEROTOHERO). Neu sind der Terminal-Simulator (`src/scripts/shell.ts`, `src/components/Terminal.astro`), der Terminal-Nachweis (`src/components/Nachweis.astro`) und das Rack (`src/components/Rack.astro`). Der Fortschritt liegt unter einem eigenen Schlüssel im Browser, weil beide Kurse unter derselben github.io-Adresse laufen. Die Seite wird über GitHub Actions automatisch auf GitHub Pages veröffentlicht.
</details>
