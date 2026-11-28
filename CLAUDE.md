# Arbeitsanweisungen für Claude

Kurs „Linux to Hero“: interaktive Vorbereitung auf LPIC-1, LPIC-2 und LPIC-3 Security, auf Deutsch. Astro mit MDX, statisch auf GitHub Pages (`.github/workflows/deploy.yml`). Inhalt und Regeln für Beiträge stehen in `CONTRIBUTING.md`, die Tests in `tests/README.md`. Diese Datei ergänzt beides um den Arbeitsablauf und die Fallen, die beim Bauen aufgefallen sind.

## Mit dem Maintainer

- Antworten auf Deutsch, sachlich, ohne Füllwörter. Fakten zu Lernzielen, Programmen und Verhalten nachprüfen oder als nicht geprüft kennzeichnen.
- Commits als `Winter-Mute <198657640+r-winter-mute-dev@users.noreply.github.com>`. In einem frischen Klon zuerst `git config user.name "Winter-Mute"` und `git config user.email "198657640+r-winter-mute-dev@users.noreply.github.com"`. Am Ende jeder Commit-Nachricht die Attributionszeilen, die die Sitzung vorgibt.
- Commit-Nachrichten auf Deutsch: eine Betreffzeile, dann Stichpunkte. Direkt auf `main`, danach den Deploy prüfen (`gh run list -R r-winter-mute-dev/ZEROTOHERO-LINUX -L 3`).
- Keine echten Prüfungsfragen, nichts von LPI abschreiben (siehe CONTRIBUTING).

## Stand

- LPIC-1: alle Akte fertig.
- LPIC-2: Akt 0 bis 9 fertig (Topics 200 bis 208), dazu die Generalprobe 201 (`l2-7-probe`). Akt 7 nutzt das Modul `shell-wartung.ts` (Welt-Option `wartung`) mit dem erfundenen Autoconf-Projekt lagerist, Akt 8 das Modul `shell-dns.ts` (Welt-Option `dns`) mit werkstatt als BIND-Server (192.168.1.23) und srv1 (192.168.1.10) als zweitem Nameserver, Akt 9 die Module `shell-web.ts` (Welt-Option `web`: Apache, Squid, Nginx, curl, lagerist-web auf srv1:8080/8081) und `shell-tls.ts` (openssl).
- **Als Nächstes Akt 10, Topic 209 (Samba und NFS)**, danach Akt 11 bis 13 (Topics 210 bis 212). Akt 13 enthält die Generalprobe 202 (`l2-13-probe`).
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
- tar läuft in jeder Welt durch den Wrapper aus `shell-wartung.ts` (-d, -g, --exclude, Zeiten beim Auspacken, `Nicht im Archiv gefunden`, Bandgeräte). Optionen, die der Wrapper nicht kennt, gehen unverändert an das einfache tar aus `shell-text.ts`.
- patch begrenzt einen Hunk über die Zeilenzahlen im Kopf `@@ -a,b +c,d @@`. Leere Kontextzeilen in Patches, die als Template-Literal im Code stehen, brauchen ihr führendes Leerzeichen.
- Umleitungen öffnet die Shell, die die Zeile ausführt (`rootStart || w.root` in `einfachAusfuehren`): `sudo echo x > datei` scheitert wie echt, `sudo sh -c 'echo x > datei'` und Skripte unter sudo schreiben als root.
- Ein frisches Debian im Simulator hat weder gcc noch make noch patch (`which` findet sie trotzdem, weil die Befehle registriert sind). Wer bauen lässt, installiert build-essential oder setzt `wartung: { werkzeuge: true }`.
- Der Abgleich mit echten Systemen vergleicht Rückgabecodes. Fälle für `ip` laufen auf dem Kernel des Runners. Was von der Kernelversion abhängt, gehört nicht hinein.
- Ohne Zugriff auf Docker Hub lassen sich die Vergleichsfälle lokal in einem eigenen Netz-Namensraum gegen das installierte System laufen lassen: `sudo unshare -n python3 tests/vergleich/echt.py lokal /tmp/echt.json`, dann `node tests/vergleich/simulator.mjs debian /tmp/sim.json` und `node tests/vergleich/vergleiche.mjs /tmp/echt.json /tmp/sim.json`.

- sed im Simulator trennt Skripte an `;` nur außerhalb von `/RE/` und `s///` und kennt `\t` in der Ersetzung. Lösungen in `loesungen.json` dürfen das nutzen, `grep -A`/`-B` aber nicht (fehlt).
- In Zonendateien gilt eine Zeile, die mit Leerraum beginnt, für den Namen der Zeile davor, wie in echtem BIND. Wer NS-Einträge anhängt, schreibt `@ IN NS …`.
- `shell-dns.ts` hängt sich über `dnsHaken` in `frage()` aus `shell-netz.ts`: Der Haken beantwortet Fragen an werkstatt und srv1, bevor der normale Resolver greift. Ohne Welt-Option `dns` bleibt `frage()` unverändert.
- Zustände `dnszone:ZONE~…` vergleichen Namen ohne Punkt am Ende, Daten aber mit (`lab.example.org NS ns2.lab.example.org.`). `dnsfrage:` gibt die ganze Antwortzeile, also nicht mit `^` verankern.
- Private Namen (intern, local, lan …) über eine Weiterleitungszone scheitern mit `dnssec-validation auto` wie echt mit SERVFAIL, bis `validate-except` sie ausnimmt.
- BIND-Versionen im Simulator folgen dem Stand der Vergleichs-Action (Debian 12: 1:9.18.49-1~deb12u3, Alma 9: 9.16.50-12.el9_9.1, Ausgabe `9.16.50-RH`). Nach Sicherheitsupdates zieht die Action neuere Versionen; Abweichungen zeigt `named-checkconf -v` im Kopf der Gruppe dns. Nicht nachgebildet: Auf Red Hat liegen named-checkconf und dnssec-* in /usr/sbin, dnssec-* im Paket bind-dnssec-utils.
- In MDX-Fließtext (`<Merke>`, Absätze) sind `{` und `}` Ausdrücke. In Prosa als `\{ \}` schreiben oder in Backticks setzen. Einfache Anführungszeichen in Quiz-Texten mit `\'` maskieren.

- Symbolische Links sind Dateien mit dem Inhalt `-> ZIEL`. `shell-web.ts` löst sie mit `echt()` auch in Verzeichnisteilen auf (`/etc/httpd/modules`, `sites-enabled`). Neue Module, die Links lesen, brauchen dasselbe.
- In der Web-Welt laufen Prüfungen `http(…)` auf einer Kopie und schreiben nichts in die Protokolle. Aufgaben, die ein Protokoll lesen lassen, müssen den Aufruf mit curl selbst verlangen.
- Ab dem ersten `<VirtualHost *:80>` beantwortet Apache auch `localhost` mit dem ersten Host, wie echt. Auf Red Hat zeigt `http://localhost/` nach einer eigenen Datei in conf.d also diese Seite statt der Testseite.
- Der Simulator verschlüsselt Schlüssel nicht wirklich. Ohne `-noenc` fragt openssl nach einer Passphrase und startet den Befehl mit `-passout`/`-passin pass:…` neu, Apache startet mit einem verschlüsselten Schlüssel nicht (AH02564).
- Versionen für Apache, Nginx, Squid, OpenSSL und curl stehen als Konstanten in `shell-web.ts` und `shell-tls.ts` und als Pakete in `shell-pakete.ts` (Stand November 2026: Debian Apache 2.4.71, OpenSSL 3.0.22, Nginx 1.22.1, Squid 5.7, curl 7.88.1; Alma httpd 2.4.62, OpenSSL 3.5.9, Nginx 1.20.1, Squid 5.5, curl 7.76.1). Der Kopf der Vergleichsgruppe web zeigt die Versionen der Action. Auf Alma ist curl-minimal installiert, das Paket curl nicht nachinstallieren.

## Testbefehle

| Befehl | Zweck |
|---|---|
| `node tests/rep.mjs 'BEFEHLE' '{WELT}'` | Befehle im Simulator abspielen, `#z ZUSTAND` prüft einen Zustand |
| `npm run test:fragen` | Prüfungsfragen prüfen |
| `npm run build && npx astro preview --port 4321` | Seite bauen und lokal ausliefern |
| `CHROME=/usr/bin/google-chrome python3 tests/e2e.py [ID,ID,…]` | Missionen im Browser durchspielen, IDs mit Komma getrennt, ohne IDs alle (dauert einige Minuten) |
| `npm run test:vergleich` | Vergleichsfälle in Debian 12 per Docker |
