// Die komplette Kampagne. Reihenfolge = Lernreihenfolge.
// IDs ändern sich nie (gespeicherter Fortschritt hängt daran).
// "bereit: true" heißt: Es gibt eine ausgeschriebene Datei in src/missionen/<id>.mdx.

// Jeder Akt füllt einen Einschub im Server-Rack auf der Startseite.
export type TeilKey =
  | 'rack' | 'festplatte' | 'werkzeug' | 'schloss' | 'prozessor'
  | 'lager' | 'netz' | 'steuerung' | 'wachturm' | 'schild';

export interface Mission {
  id: string;
  nr: string;          // Anzeige, z. B. "1.1" oder "Boss 1"
  titel: string;
  kurz: string;        // ein Satz: was man tut
  theorie: string;     // Theorie genau hier
  pruefung: string;    // wie geprüft wird
  xp: number;
  boss?: boolean;
  bereit?: boolean;
}

export interface Akt {
  nr: number;
  titel: string;
  teil: TeilKey;
  teilName: string;
  ziel: string;
  missionen: Mission[];
}

const m = (
  id: string, nr: string, titel: string, kurz: string, theorie: string, pruefung: string,
  extra: Partial<Mission> = {},
): Mission => ({ id, nr, titel, kurz, theorie, pruefung, xp: extra.boss ? 100 : 50, ...extra });

// ---------- Kampagne 1: Dein eigener Server ----------
export const SERVER: Akt[] = [
  {
    nr: 0, titel: 'Basislager', teil: 'rack', teilName: 'Rack',
    ziel: 'Ein eigenes Linux haben und sicher im Terminal arbeiten.',
    missionen: [
      m('l-0-1', '0.1', 'Das Ziel', 'Den fertigen Server kennenlernen und verstehen, wie der Kurs funktioniert.', 'Was ein Server ist, alle Einschübe im Überblick', 'Bestätigen', { bereit: true }),
      m('l-0-2', '0.2', 'Sicherheit', 'Die Regeln lernen, die dich und deine Daten schützen.', 'root, rm, fremde Befehle, Backups und Snapshots', 'Sicherheitsquiz, alles richtig', { bereit: true }),
      m('l-0-3', '0.3', 'Dein Linux', 'Arch Linux in WSL oder einer VM einrichten.', 'Distribution, Kernel, WSL, virtuelle Maschine, archinstall', 'Terminal-Nachweis mit /etc/os-release', { bereit: true }),
      m('l-0-4', '0.4', 'Das Terminal', 'Den Prompt lesen und die ersten Befehle eintippen.', 'Prompt, Befehl, Option, Argument, Tab, Verlauf, Strg+C', 'Simulator und Terminal-Nachweis', { bereit: true }),
    ],
  },
  {
    nr: 1, titel: 'Die Karte', teil: 'festplatte', teilName: 'Festplatte',
    ziel: 'Sich im Dateisystem bewegen, Dateien anlegen und sicher löschen.',
    missionen: [
      m('l-1-1', '1.1', 'Wo bin ich?', 'Den eigenen Standort finden und sich umsehen.', 'pwd, ls, cd, Arbeitsverzeichnis', 'Simulator und Terminal-Nachweis'),
      m('l-1-2', '1.2', 'Pfade', 'Absolute und relative Pfade lesen und schreiben.', '/, ~, ., .., Tab-Vervollständigung', 'Pfadtrainer und Simulator'),
      m('l-1-3', '1.3', 'Der Verzeichnisbaum', 'Herausfinden, wo Linux was ablegt.', '/etc, /home, /usr, /var, /tmp, /dev, /proc', 'Quiz und Terminal-Nachweis'),
      m('l-1-4', '1.4', 'Anlegen und verschieben', 'Eine Ordnerstruktur für den Server bauen.', 'mkdir -p, touch, cp, mv, Umbenennen', 'Simulator und Terminal-Nachweis mit Prüfsumme'),
      m('l-1-5', '1.5', 'Löschen ohne Reue', 'Dateien gezielt löschen, ohne aus Versehen zu viel zu erwischen.', 'rm, rmdir, -i, Platzhalter *, erst mit echo testen', 'Simulator'),
      m('l-1-6', '1.6', 'Hilfe holen', 'Antworten in man-Pages und im Arch Wiki finden statt zu raten.', '--help, man, Abschnitte einer man-Page, Arch Wiki', 'man-Page-Übung mit echten Seiten'),
      m('l-1-7', '1.7', 'Unsichtbare Dateien', 'Versteckte Dateien finden und ls -l lesen.', 'Punktdateien, ls -la, Dateityp, Größe, Datum', 'Quiz und Terminal-Nachweis'),
      m('l-1-boss', 'Boss 1', 'Die Datei ist weg', 'Verlorene Dateien wiederfinden und Pfadfehler aufklären.', 'No such file or directory, falsches Verzeichnis, Tippfehler', 'Fehlerszenarien', { boss: true }),
    ],
  },
  {
    nr: 2, titel: 'Der Werkzeugkasten', teil: 'werkzeug', teilName: 'Werkzeugkasten',
    ziel: 'Text lesen, bearbeiten, durchsuchen und mit Pipes verketten.',
    missionen: [
      m('l-2-1', '2.1', 'Dateien lesen', 'Kurze und lange Dateien und laufende Logs ansehen.', 'cat, less, head, tail, tail -f', 'Simulator'),
      m('l-2-2', '2.2', 'Editieren', 'Eine Konfigurationsdatei im Terminal ändern.', 'nano, Speichern und Beenden, Notausgang aus vim', 'Terminal-Nachweis mit Prüfsumme'),
      m('l-2-3', '2.3', 'Umleiten', 'Ausgaben in Dateien schreiben und Fehler getrennt auffangen.', '>, >>, <, 2>, 2>&1, /dev/null', 'Code-Puzzle und Simulator'),
      m('l-2-4', '2.4', 'Pipes', 'Kleine Werkzeuge zu einer Kette verbinden.', '|, Standardeingabe und -ausgabe, Filter', 'Pipe-Baukasten'),
      m('l-2-5', '2.5', 'Suchen in Text', 'Zeilen finden, die ein Wort enthalten.', 'grep, -i, -v, -n, -r', 'Simulator'),
      m('l-2-6', '2.6', 'Dateien finden', 'Dateien nach Name, Größe und Alter suchen.', 'find, -name, -size, -mtime, -exec', 'Simulator und Terminal-Nachweis'),
      m('l-2-7', '2.7', 'Zählen und sortieren', 'Aus einem Log eine Rangliste bauen.', 'sort, uniq -c, wc, cut, tr', 'Pipe-Baukasten'),
      m('l-2-8', '2.8', 'Muster', 'Mit regulären Ausdrücken gezielt suchen.', 'Zeichenklassen, ^ und $, *, +, grep -E', 'Regex-Trainer'),
      m('l-2-9', '2.9', 'sed und awk', 'Text automatisch ersetzen und Spalten auswerten.', 'sed s///, awk mit Spalten und Bedingungen', 'Code-Puzzle und Simulator'),
      m('l-2-boss', 'Boss 2', 'Der Log-Detektiv', 'In einem echten Zugriffslog den Angreifer finden.', 'Alles aus Akt 2 kombiniert', 'Fehlerszenarien', { boss: true }),
    ],
  },
  {
    nr: 3, titel: 'Das Schloss', teil: 'schloss', teilName: 'Schloss (Rechte)',
    ziel: 'Verstehen, wer was darf, und Rechte gezielt vergeben.',
    missionen: [
      m('l-3-1', '3.1', 'Wer bin ich?', 'Benutzer, Gruppen und IDs anzeigen.', 'whoami, id, groups, UID und GID', 'Terminal-Nachweis'),
      m('l-3-2', '3.2', 'rwx lesen', 'Die Rechte-Spalte von ls -l entschlüsseln.', 'Besitzer, Gruppe, andere; lesen, schreiben, ausführen; Ordnerrechte', 'Rechte-Trainer'),
      m('l-3-3', '3.3', 'chmod', 'Rechte symbolisch und als Zahl setzen.', 'u+x, go-w, 644, 755, 600', 'Rechte-Trainer und Terminal-Nachweis'),
      m('l-3-4', '3.4', 'Besitz und Gruppen', 'Dateien einem anderen Besitzer und einer Gruppe geben.', 'chown, chgrp, Gruppen anlegen', 'Simulator'),
      m('l-3-5', '3.5', 'root und sudo', 'Mit Adminrechten arbeiten, ohne dauerhaft root zu sein.', 'root, sudo, wheel-Gruppe, Prinzip minimaler Rechte', 'Quiz und Terminal-Nachweis'),
      m('l-3-6', '3.6', 'Benutzer anlegen', 'Einen eigenen Dienstbenutzer für den Server anlegen.', 'useradd, passwd, /etc/passwd, /etc/shadow', 'Terminal-Nachweis'),
      m('l-3-7', '3.7', 'Ausführbar', 'Ein eigenes Programm von überall starten.', 'Shebang, x-Recht, PATH, ~/.local/bin', 'Terminal-Nachweis'),
      m('l-3-boss', 'Boss 3', 'Permission denied', 'Fünf Rechteprobleme anhand der Fehlermeldung lösen.', 'Datei-, Ordner- und sudo-Rechte', 'Fehlerszenarien', { boss: true }),
    ],
  },
  {
    nr: 4, titel: 'Der Motor', teil: 'prozessor', teilName: 'Prozessor',
    ziel: 'Laufende Programme sehen, steuern und Ressourcen im Blick behalten.',
    missionen: [
      m('l-4-1', '4.1', 'Prozesse', 'Herausfinden, was gerade alles läuft.', 'Programm gegen Prozess, PID, Elternprozess, ps', 'Simulator und Terminal-Nachweis'),
      m('l-4-2', '4.2', 'Der Taskmanager', 'top und htop lesen.', 'CPU-Last, Arbeitsspeicher, Load Average', 'Quiz mit echten Ausgaben'),
      m('l-4-3', '4.3', 'Signale', 'Hängende Programme sauber und notfalls hart beenden.', 'Strg+C, kill, SIGTERM gegen SIGKILL', 'Simulator'),
      m('l-4-4', '4.4', 'Vorder- und Hintergrund', 'Programme im Hintergrund weiterlaufen lassen.', '&, jobs, fg, bg, Strg+Z, nohup', 'Simulator'),
      m('l-4-5', '4.5', 'Speicher und Platten', 'Herausfinden, was den Speicherplatz frisst.', 'free, df -h, du -sh', 'Terminal-Nachweis'),
      m('l-4-6', '4.6', 'Umgebungsvariablen', 'Die Shell dauerhaft einrichten.', 'env, export, PATH, ~/.bashrc, alias', 'Terminal-Nachweis'),
      m('l-4-boss', 'Boss 4', 'Der Server ist lahm', 'Volle Platte, Speicherfresser oder Endlosschleife finden.', 'Alles aus Akt 4 kombiniert', 'Fehlerszenarien', { boss: true }),
    ],
  },
  {
    nr: 5, titel: 'Das Lager', teil: 'lager', teilName: 'Lager (Pakete)',
    ziel: 'Software sicher installieren, aktuell halten und wieder entfernen.',
    missionen: [
      m('l-5-1', '5.1', 'Was ein Paketmanager tut', 'Verstehen, woher Software unter Linux kommt.', 'Paketquellen, Spiegelserver, Signaturen, Abhängigkeiten', 'Quiz'),
      m('l-5-2', '5.2', 'pacman', 'Pakete suchen, installieren und entfernen.', 'pacman -Ss, -S, -Qi, -Ql, -Rns', 'Terminal-Nachweis'),
      m('l-5-3', '5.3', 'Das Update-Ritual', 'Das System richtig aktualisieren.', 'Rolling Release, Arch-News lesen, pacman -Syu, keine Teil-Upgrades', 'Quiz und Terminal-Nachweis'),
      m('l-5-4', '5.4', 'Woher kommt der Befehl?', 'Herausfinden, welches Paket welche Datei liefert.', 'which, type, pacman -Qo, /usr/bin', 'Terminal-Nachweis'),
      m('l-5-5', '5.5', 'Das AUR', 'Fremde Bauanleitungen lesen, bevor du sie ausführst.', 'AUR, PKGBUILD, makepkg, Vertrauen', 'Code-Review'),
      m('l-5-6', '5.6', 'Archive', 'Dateien packen und entpacken.', 'tar, gzip, zstd', 'Terminal-Nachweis mit Prüfsumme'),
      m('l-5-boss', 'Boss 5', 'Das Update hat etwas kaputt gemacht', 'Fehlgeschlagene Installationen und Updates reparieren.', 'Sperrdatei, Schlüsselring, Dateikonflikte, kein Platz, Teil-Upgrade', 'Fehlerszenarien', { boss: true }),
    ],
  },
  {
    nr: 6, titel: 'Das Netz', teil: 'netz', teilName: 'Netzwerkkarte',
    ziel: 'Netzwerkverbindungen verstehen und sich per SSH anmelden.',
    missionen: [
      m('l-6-1', '6.1', 'Adressen', 'Die eigene IP-Adresse und das Gateway finden.', 'IP, Netzmaske, ip a, ip r', 'Terminal-Nachweis'),
      m('l-6-2', '6.2', 'Namen auflösen', 'Prüfen, ob ein Name zur richtigen Adresse führt.', 'DNS, ping, dig, /etc/hosts', 'Simulator und Terminal-Nachweis'),
      m('l-6-3', '6.3', 'Ports und Dienste', 'Sehen, welche Programme auf Verbindungen warten.', 'Ports, TCP und UDP, ss -tulpn', 'Quiz mit echten Ausgaben'),
      m('l-6-4', '6.4', 'Daten holen', 'Webseiten und Dateien aus dem Terminal laden.', 'curl, Statuscodes, Header', 'Terminal-Nachweis'),
      m('l-6-5', '6.5', 'SSH', 'Sich auf einem anderen Rechner anmelden.', 'openssh, sshd starten, Fingerabdruck', 'Terminal-Nachweis'),
      m('l-6-6', '6.6', 'Schlüssel statt Passwort', 'Mit einem SSH-Schlüssel anmelden und Dateien kopieren.', 'ssh-keygen, authorized_keys, scp, rsync', 'Terminal-Nachweis'),
      m('l-6-boss', 'Boss 6', 'Keine Verbindung', 'DNS, Route, Firewall oder abgeschalteten Dienst als Ursache finden.', 'Systematische Netzwerk-Fehlersuche', 'Fehlerszenarien', { boss: true }),
    ],
  },
  {
    nr: 7, titel: 'Der Autopilot', teil: 'steuerung', teilName: 'Steuerplatine (Skripte)',
    ziel: 'Eigene Shell-Skripte schreiben. Ergebnis: dein Backup-Skript.',
    missionen: [
      m('l-7-1', '7.1', 'Das erste Skript', 'Mehrere Befehle in eine Datei schreiben und starten.', 'Shebang, Exit-Code, $?', 'Terminal-Nachweis'),
      m('l-7-2', '7.2', 'Variablen und Anführungszeichen', 'Werte speichern, ohne über Leerzeichen zu stolpern.', 'Variablen, "$var", einfache gegen doppelte Anführungszeichen, $(...)', 'Code-Puzzle'),
      m('l-7-3', '7.3', 'Bedingungen', 'Das Skript Entscheidungen treffen lassen.', 'if, [[ ]], Dateitests, && und ||', 'Code-Puzzle und Terminal-Nachweis'),
      m('l-7-4', '7.4', 'Schleifen', 'Viele Dateien in einem Rutsch bearbeiten.', 'for, while, Zeilen einlesen', 'Code-Puzzle und Terminal-Nachweis'),
      m('l-7-5', '7.5', 'Funktionen und Argumente', 'Ein Skript mit Optionen von außen steuern.', 'Funktionen, $1, $@, $#, Hilfetext', 'Code-Puzzle'),
      m('l-7-6', '7.6', 'Robust', 'Skripte so schreiben, dass Fehler nicht unbemerkt bleiben.', 'set -euo pipefail, shellcheck, trap', 'Code-Review'),
      m('l-7-7', '7.7', 'Das Backup-Skript', 'Ein Skript, das deine Daten mit Datum sichert und alte Sicherungen aufräumt.', 'Alles aus Akt 7, rsync, Datumsformat', 'Terminal-Nachweis'),
      m('l-7-boss', 'Boss 7', 'Das Skript macht Unsinn', 'Fehlerhafte Skripte mit bash -x untersuchen.', 'Quoting, Leerzeichen, Exit-Codes, Pfade', 'Fehlerszenarien', { boss: true }),
    ],
  },
  {
    nr: 8, titel: 'Der Wächter', teil: 'wachturm', teilName: 'Wachturm (Dienste)',
    ziel: 'Dienste steuern, Logs lesen. Das Backup läuft jede Nacht von allein.',
    missionen: [
      m('l-8-1', '8.1', 'systemd', 'Dienste starten, stoppen und beim Booten aktivieren.', 'Units, systemctl status, start, enable', 'Terminal-Nachweis'),
      m('l-8-2', '8.2', 'Logs lesen', 'Die Ursache eines Fehlers im Journal finden.', 'journalctl -u, -b, -f, -p', 'Simulator und Quiz'),
      m('l-8-3', '8.3', 'Ein eigener Dienst', 'Das Backup-Skript als systemd-Dienst einrichten.', 'Service-Unit, Benutzer, Arbeitsverzeichnis', 'Terminal-Nachweis'),
      m('l-8-4', '8.4', 'Zeitpläne', 'Aufgaben zu festen Zeiten starten.', 'systemd-Timer, OnCalendar, cron im Vergleich', 'Zeitplan-Trainer'),
      m('l-8-5', '8.5', 'Jede Nacht', 'Das Backup automatisch laufen lassen und das Ergebnis prüfen.', 'Timer aktivieren, list-timers, Erfolg im Journal prüfen', 'Terminal-Nachweis'),
      m('l-8-boss', 'Boss 8', 'Der Dienst startet nicht', 'Kaputte Units anhand von Statusmeldung und Journal reparieren.', 'Pfade, Rechte, Tippfehler, Abhängigkeiten', 'Fehlerszenarien', { boss: true }),
    ],
  },
  {
    nr: 9, titel: 'Die Festung', teil: 'schild', teilName: 'Schutzschild',
    ziel: 'Den Server absichern und online bringen.',
    missionen: [
      m('l-9-1', '9.1', 'Update-Wächter', 'Benachrichtigt werden, wenn Updates oder Arch-News warten.', 'Timer, checkupdates, Warum Arch nicht automatisch aktualisiert', 'Terminal-Nachweis'),
      m('l-9-2', '9.2', 'Die Firewall', 'Nur die Ports öffnen, die wirklich gebraucht werden.', 'Paketfilter, ufw, Standard verbieten', 'Terminal-Nachweis'),
      m('l-9-3', '9.3', 'SSH härten', 'Anmeldung nur per Schlüssel, kein root-Login.', 'sshd_config, Drop-in-Dateien, testen ohne sich auszusperren', 'Terminal-Nachweis'),
      m('l-9-4', '9.4', 'Die Statusseite', 'Ein Webserver zeigt eine Seite, die dein Skript erzeugt.', 'Webserver, statische Seite, Timer', 'Terminal-Nachweis mit curl'),
      m('l-9-5', '9.5', 'Abnahme', 'Den ganzen Server mit einer Checkliste prüfen.', 'Wiederholung aller Akte', 'Abschlussprüfung'),
      m('l-9-boss', 'Finale', 'Der Einbruchsversuch', 'In auth.log einen Angriff erkennen und den Server prüfen.', 'Alles aus Kampagne 1', 'Fehlerszenarien', { boss: true }),
    ],
  },
];

export interface Kampagne {
  id: string;
  nr: number;
  titel: string;
  kurz: string;
  voraussetzung?: string;
  ueberschrift: string;   // große Überschrift auf der Kampagnenseite
  einstieg: string;       // ein Absatz darunter
  akte: Akt[];
}

export const KAMPAGNEN: Kampagne[] = [
  { id: 'server', nr: 1, titel: 'Dein eigener Server', kurz: 'Vom ersten Befehl bis zum abgesicherten Server mit nächtlichem Backup.',
    ueberschrift: 'Richte einen Linux-Server ein, ganz allein im Terminal.',
    einstieg: 'Du fängst bei null an: Was ist ein Terminal, wo bin ich gerade? Mission für Mission füllst du einen Einschub im Rack und lernst genau die Befehle, die du dafür brauchst. Am Ende läuft auf deinem Arch Linux eine eigene Statusseite, jede Nacht startet ein Backup, und anmelden kann man sich nur mit deinem SSH-Schlüssel.',
    akte: SERVER },
];

// Kampagnen, die geplant, aber noch nicht begonnen sind. Erscheinen auf der Startseite als Vorschau.
export const GEPLANT = [
  { nr: 2, titel: 'Arch von Hand', kurz: 'Ohne Installer: Partitionen, Dateisysteme, fstab, Bootloader und chroot. Du baust jede Schicht selbst.' },
  { nr: 3, titel: 'Das Homelab', kurz: 'Git, Container, Reverse Proxy und Monitoring: mehrere Dienste auf einem Rechner.' },
];

export const ALLE_MISSIONEN: Mission[] = KAMPAGNEN.flatMap((k) => k.akte.flatMap((a) => a.missionen));
export const missionenVon = (k: Kampagne): Mission[] => k.akte.flatMap((a) => a.missionen);

export function kampagneVon(missionId: string): Kampagne {
  return KAMPAGNEN.find((k) => k.akte.some((a) => a.missionen.some((x) => x.id === missionId))) ?? KAMPAGNEN[0];
}

export function aktVon(missionId: string): Akt | undefined {
  return kampagneVon(missionId).akte.find((a) => a.missionen.some((x) => x.id === missionId));
}

// Freischaltung innerhalb einer Kampagne: Die erste Mission jeder Kampagne ist immer offen.
export function vorherige(missionId: string): Mission | undefined {
  const liste = missionenVon(kampagneVon(missionId));
  const i = liste.findIndex((x) => x.id === missionId);
  return i > 0 ? liste[i - 1] : undefined;
}

export function naechste(missionId: string): Mission | undefined {
  const liste = missionenVon(kampagneVon(missionId));
  const i = liste.findIndex((x) => x.id === missionId);
  return i >= 0 && i < liste.length - 1 ? liste[i + 1] : undefined;
}

export const LEVEL = [
  // Grundwert Kampagne 1: 62 Missionen + 9 Bosse = 62 × 50 + 9 × 100 = 4000 XP (ohne Erstversuchs-Bonus).
  { ab: 0, name: 'Neuling' },
  { ab: 200, name: 'Prompt-Leser' },
  { ab: 600, name: 'Pfadfinder' },
  { ab: 1100, name: 'Pipe-Bauer' },
  { ab: 1500, name: 'Schlüsselmeister' },
  { ab: 1900, name: 'Prozess-Bändiger' },
  { ab: 2300, name: 'Paketwart' },
  { ab: 2700, name: 'Netzläufer' },
  { ab: 3150, name: 'Skript-Schmied' },
  { ab: 3500, name: 'Systemwächter' },
  { ab: 4000, name: 'root' },              // Kampagne 1 komplett
];
