# Tests

| Befehl | Was er prüft | Braucht |
|---|---|---|
| `npm run test:fragen` | Fragen für Probeprüfungen: doppelte IDs und Fragen, kaputte Indizes, auffällig lange richtige Antworten | Node |
| `npm run test:e2e` | Spielt jede spielbare Mission im Browser mit den Lösungen aus `loesungen.json` durch | gebaute Seite unter `LTH_URL` (Standard `http://localhost:4321`, also `npm run build && npx astro preview`), Python mit `playwright`, optional `CHROME` |
| `npm run test:vergleich` | Führt die Fälle aus `vergleich/faelle/` in einem echten Debian 12 aus und vergleicht die Rückgabecodes mit dem Simulator | Docker |
| `node tests/rep.mjs 'BEFEHLE' '{WELT}'` | Befehle im Simulator abspielen, `#z ZUSTAND` prüft einen Zustand | Node |

`tests/e2e.py l2-5-1,l2-5-2` spielt nur diese Missionen. Die Missionen davor gelten dabei als abgeschlossen.

## Lösungen für Terminal-Aufgaben

`loesungen.json` enthält für jede Terminal-Aufgabe (`MISSION/CHECK`) die Befehle und die Antworten auf die Fragen in der Reihenfolge der Aufgaben. Wer eine Terminal-Aufgabe schreibt oder ändert, trägt die Lösung dort ein. Sonderzeilen: `#neustart`, `#strg-c`, `#strg-z`, `#strg-d`, `#vi:TEXT` (Tasten im Editor, `#vi:Escape`, `#vi:Enter`).

## Vergleich mit echten Systemen

Ein Fall schreibt Dateien nach `/tmp` und ruft ein Prüfprogramm mit `-f` auf, etwa `sshd -t -f` oder `visudo -c -f`. So verändert er die Konfiguration des Systems nicht. Verglichen wird nur der Rückgabecode, also ob das Programm annimmt oder ablehnt. Die GitHub-Action `vergleich.yml` führt alle Fälle auf Debian 12 und AlmaLinux 9 aus und schreibt die Abweichungen in die Zusammenfassung des Laufs.

`echt.py` läuft als root und darf nur in einem Wegwerf-Container oder einer Wegwerf-VM laufen: Die Vorbereitung eines Falls kann Pakete einrichten oder Host-Schlüssel erzeugen.

Neue Fälle: eine JSON-Datei in `vergleich/faelle/` mit `version` (Befehl, der die Version zeigt), `vorbereitung` (Befehle vor allen Fällen) und `faelle` (je `name`, `dateien` mit `inhalt` und `modus`, `befehl`). Programme, die vom Kernel abhängen (mdadm, LVM, mount, Module, SELinux), gehören nicht hierher, sondern in eine VM. Eine Ausnahme sind die Fälle für `ip`: Sie legen nur veth-Paare an und laufen mit `--cap-add NET_ADMIN`. Weil ein Container den Kernel des Rechners nutzt, auf dem er läuft, prüfen sie die Antworten dieses Kernels, nicht die von Debian 12 oder AlmaLinux 9. Fälle, deren Ergebnis von der Kernelversion abhängt (etwa Umbenennen einer laufenden Schnittstelle), gehören nicht hinein. Mit `"ausgabe": true` vergleicht ein Fall zusätzlich die Ausgabe, etwa bei `wpa_passphrase`.
