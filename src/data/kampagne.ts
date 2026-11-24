// Alle Kampagnen. Reihenfolge = Lernreihenfolge.
// IDs ändern sich nie (gespeicherter Fortschritt hängt daran).
// "bereit: true" heißt: Es gibt eine ausgeschriebene Datei in src/missionen/<id>.mdx.
import { ZERTIFIKATE, type Lernziel } from './lernziele';

export type TeilKey = string;

export interface Mission {
  id: string;
  nr: string;          // Anzeige, z. B. "1.1" oder "Boss 1"
  titel: string;
  kurz: string;        // ein Satz: was man tut
  theorie: string;     // Theorie genau hier
  pruefung: string;    // wie geprüft wird
  xp: number;
  ziele?: string[];    // abgedeckte LPI-Lernziele, z. B. ["101.1"]
  boss?: boolean;
  probe?: boolean;     // Prüfungssimulation
  bereit?: boolean;
}

export interface Akt {
  nr: number;
  titel: string;
  teil: TeilKey;       // eindeutiger Schlüssel des Akts
  teilName: string;    // was der Akt abdeckt, z. B. "Topic 101"
  ziel: string;
  missionen: Mission[];
}

const m = (
  id: string, nr: string, titel: string, kurz: string, theorie: string, pruefung: string,
  extra: Partial<Mission> = {},
): Mission => ({ id, nr, titel, kurz, theorie, pruefung, xp: extra.boss || extra.probe ? 100 : 50, ...extra });

// Geplante Akte: eine Mission pro offiziellem Lernziel, dazu ein Bosskampf.
// Wird ein Akt ausgeschrieben, ersetzt eine Liste von Hand diese Automatik.
function geplanterAkt(prefix: string, nr: number, titel: string, thema: string, ziel: string, zertId: string, extra: Mission[] = []): Akt {
  const ziele = ZERTIFIKATE.find((x) => x.id === zertId)!.ziele.filter((x) => x.thema.startsWith(thema));
  const missionen = ziele.map((l: Lernziel, i) => m(
    `${prefix}-${nr}-${i + 1}`, `${nr}.${i + 1}`, l.titel,
    `Lernziel ${l.nr}: ${l.titel}.`,
    `Alle Wissensgebiete aus Lernziel ${l.nr} (Gewichtung ${l.gewicht})`,
    'Quiz, Terminal-Simulator und Aufgabe im eigenen Labor',
    { ziele: [l.nr] },
  ));
  missionen.push(m(`${prefix}-${nr}-boss`, `Boss ${nr}`, 'Fehlersuche', `Ein kaputtes System aus dem Bereich ${thema} reparieren.`, 'Systematische Fehlersuche', 'Logdiagnose', { boss: true, ziele: ziele.map((x) => x.nr) }));
  return { nr, titel, teil: `${prefix}-${nr}`, teilName: `Topic ${thema}`, ziel, missionen: [...missionen, ...extra] };
}

// ---------------- Kampagne 1: LPIC-1 ----------------

const LPIC1: Akt[] = [
  {
    nr: 0, titel: 'Das Labor', teil: 'l1-0', teilName: 'Vorbereitung',
    ziel: 'Verstehen, wie du hier lernst, ein eigenes Übungs-Linux bauen und im Terminal überleben.',
    missionen: [
      m('l1-0-1', '0.1', 'Das Ziel', 'Die Prüfung kennenlernen und verstehen, warum dieser Kurs so aufgebaut ist.', 'Aufbau der LPIC-Prüfungen, Abrufen, Verteilen, Mischen', 'Quiz', { bereit: true }),
      m('l1-0-2', '0.2', 'Dein Labor', 'Zwei virtuelle Maschinen einrichten: eine mit Debian, eine mit einem RPM-System.', 'Virtualisierung, Snapshots, warum zwei Distributionen', 'Quiz und Ausgabe aus deiner VM', { bereit: true }),
      m('l1-0-3', '0.3', 'Überleben im Terminal', 'Die zehn Befehle, die du ab jetzt in jeder Mission brauchst.', 'Befehl, Option, Argument, Hilfe, Root-Rechte', 'Terminal-Simulator', { bereit: true }),
    ],
  },
  {
    nr: 1, titel: 'Systemarchitektur', teil: 'l1-1', teilName: 'Topic 101',
    ziel: 'Hardware erkennen, den Bootvorgang verstehen und Runlevel bzw. Targets sicher wechseln. 8 von 60 Fragen in Prüfung 101.',
    missionen: [
      m('l1-1-1', '1.1', 'Was steckt im Rechner?', 'Hardware mit lspci und lsusb auflisten und Geräte zuordnen.', 'PCI und USB, Geräteklassen, Treiber eines Geräts', 'Terminal-Simulator, Quiz, Ausgabe aus deiner VM', { ziele: ['101.1'], bereit: true }),
      m('l1-1-2', '1.2', '/proc, /sys und /dev', 'Die drei besonderen Verzeichnisse erkunden, in denen der Kernel über sich selbst berichtet.', 'procfs, sysfs, Gerätedateien, udev, D-Bus, Massenspeicher, Hot- und Coldplug', 'Terminal-Simulator und Quiz', { ziele: ['101.1'], bereit: true }),
      m('l1-1-3', '1.3', 'Kernelmodule', 'Treiber laden, entladen und dauerhaft sperren.', 'lsmod, modinfo, modprobe, insmod, rmmod, /etc/modprobe.d', 'Terminal-Simulator, Code-Puzzle, Quiz', { ziele: ['101.1'], bereit: true }),
      m('l1-1-4', '1.4', 'Vom Einschalten bis zum Login', 'Den Bootvorgang Schritt für Schritt nachvollziehen.', 'BIOS und UEFI, Bootloader, Kernel, initramfs, init, SysVinit, systemd, Upstart', 'Reihenfolge-Quiz und Quiz', { ziele: ['101.2'], bereit: true }),
      m('l1-1-5', '1.5', 'Dem Kernel beim Booten etwas sagen', 'Kernelparameter im Bootloader setzen und die Bootmeldungen lesen.', 'GRUB-Menü, Kernelparameter, dmesg, journalctl', 'Terminal-Simulator, Quiz, Ausgabe aus deiner VM', { ziele: ['101.2'], bereit: true }),
      m('l1-1-6', '1.6', 'Runlevel und Targets', 'Zwischen Betriebsarten wechseln und den Standard festlegen.', 'SysV-Runlevel, /etc/inittab, systemd-Targets, systemctl, telinit', 'Terminal-Simulator, Zuordnung, Ausgabe aus deiner VM', { ziele: ['101.3'], bereit: true }),
      m('l1-1-7', '1.7', 'Sauber herunterfahren', 'Das System geplant herunterfahren, Nutzer warnen und Prozesse richtig beenden.', 'shutdown, wall, systemctl poweroff, Signale, acpid', 'Terminal-Simulator und Quiz', { ziele: ['101.3'], bereit: true }),
      m('l1-1-boss', 'Boss 1', 'Der Server startet nicht richtig', 'Vier kaputte Systeme anhand ihrer Meldungen diagnostizieren.', 'Systematische Fehlersuche beim Booten', 'Logdiagnose', { boss: true, ziele: ['101.1', '101.2', '101.3'], bereit: true }),
      m('l1-1-probe', 'Probe 1', 'Probeprüfung Topic 101', 'Gemischte Fragen im Format der echten Prüfung, mit Zeitlimit.', 'Alles aus Topic 101', 'Prüfungssimulation', { probe: true, ziele: ['101.1', '101.2', '101.3'], bereit: true }),
    ],
  },
  {
    nr: 2, titel: 'Installation und Pakete', teil: 'l1-2', teilName: 'Topic 102',
    ziel: 'Platten sinnvoll aufteilen, GRUB einrichten, Bibliotheken finden und Software auf Debian, Red Hat und SUSE verwalten. 12 von 60 Fragen in Prüfung 101.',
    missionen: [
      m('l1-2-1', '2.1', 'Die Platte aufteilen', 'Partitionen und Einhängepunkte für einen Rechner planen.', '/, /boot, ESP, /home, /var, Swap, LVM-Grundlagen', 'Terminal-Simulator, Zuordnung, Ausgabe aus deiner VM', { ziele: ['102.1'], bereit: true }),
      m('l1-2-2', '2.2', 'GRUB einrichten', 'Den Bootloader dauerhaft umstellen und installieren.', 'GRUB Legacy, GRUB 2, /etc/default/grub, grub-mkconfig, grub-install, Rückfalloptionen', 'Terminal-Simulator, Code-Puzzle, Quiz', { ziele: ['102.2'], bereit: true }),
      m('l1-2-3', '2.3', 'Gemeinsame Bibliotheken', 'Herausfinden, welche Bibliotheken ein Programm braucht, und eine fehlende einbinden.', 'ldd, ldconfig, /etc/ld.so.conf, LD_LIBRARY_PATH', 'Terminal-Simulator und Quiz', { ziele: ['102.3'], bereit: true }),
      m('l1-2-4', '2.4', 'Debian-Pakete mit dpkg', 'Paketdateien installieren, untersuchen und entfernen.', 'dpkg -i, -r, -P, -l, -L, -S, -s, -I, -c, -V, dpkg-reconfigure', 'Terminal-Simulator und Quiz', { ziele: ['102.4'], bereit: true }),
      m('l1-2-5', '2.5', 'apt: Pakete aus dem Netz', 'Software aus Repositories suchen, installieren und aktuell halten.', 'sources.list, apt-get, apt-cache, apt-file, apt', 'Terminal-Simulator, Zuordnung, Ausgabe aus deiner VM', { ziele: ['102.4'], bereit: true }),
      m('l1-2-6', '2.6', 'RPM-Pakete mit rpm', 'RPM-Dateien installieren, abfragen und prüfen.', 'rpm -i, -U, -F, -e, -q mit Varianten, -V, -K, rpm2cpio', 'Terminal-Simulator und Quiz', { ziele: ['102.5'], bereit: true }),
      m('l1-2-7', '2.7', 'dnf, yum und zypper', 'Software auf Red-Hat- und SUSE-Systemen aus Repositories verwalten.', 'dnf und yum, /etc/yum.repos.d, EPEL, zypper', 'Terminal-Simulator, Zuordnung, Ausgabe aus deiner VM', { ziele: ['102.5'], bereit: true }),
      m('l1-2-8', '2.8', 'Linux als Gast', 'Eine VM zur Vorlage machen und verstehen, was sich beim Klonen ändern muss.', 'VMs, Container, Cloud, Gasttreiber, machine-id, SSH-Host-Schlüssel, cloud-init', 'Terminal-Simulator und Quiz', { ziele: ['102.6'], bereit: true }),
      m('l1-2-boss', 'Boss 2', 'Die Installation klemmt', 'Fünf kaputte Installationen anhand ihrer Meldungen reparieren.', 'Fehlersuche bei Paketen, Bibliotheken und Bootloader', 'Logdiagnose', { boss: true, ziele: ['102.1', '102.2', '102.3', '102.4', '102.5', '102.6'], bereit: true }),
      m('l1-2-probe', 'Probe 2', 'Probeprüfung Topic 101 und 102', 'Gemischte Fragen aus beiden Topics, mit Zeitlimit.', 'Alles aus Topic 101 und 102', 'Prüfungssimulation', { probe: true, ziele: ['101.1', '101.2', '101.3', '102.1', '102.2', '102.3', '102.4', '102.5', '102.6'], bereit: true }),
    ],
  },
  {
    nr: 3, titel: 'GNU- und Unix-Befehle', teil: 'l1-3', teilName: 'Topic 103',
    ziel: 'Sicher auf der Kommandozeile arbeiten: Texte filtern, Dateien verwalten, Ströme umleiten, Prozesse steuern, reguläre Ausdrücke und vi. Der größte Block: 26 von 60 Fragen in Prüfung 101.',
    missionen: [
      m('l1-3-1', '3.1', 'Die Shell und ihre Variablen', 'Verstehen, was die Shell mit deiner Eingabe macht, bevor ein Befehl startet.', 'Variablen, export, env, set, unset, Anführungszeichen, Escape-Zeichen', 'Terminal-Simulator und Quiz', { ziele: ['103.1'], bereit: true }),
      m('l1-3-2', '3.2', 'Befehle finden und wiederholen', 'Herausfinden, was ein Befehl ist, wo er liegt und wie du frühere Befehle wiederholst.', 'PATH, type, which, Aliase, history, !!, man und seine Abschnitte, uname', 'Terminal-Simulator, Zuordnung, Quiz', { ziele: ['103.1'], bereit: true }),
      m('l1-3-3', '3.3', 'Text filtern I', 'Lange Ausgaben auf das Wesentliche zusammenschneiden.', 'cat, head, tail, less, wc, nl, sort, uniq, cut, paste', 'Terminal-Simulator und Quiz', { ziele: ['103.2'], bereit: true }),
      m('l1-3-4', '3.4', 'Text filtern II', 'Zeichen umwandeln, Dateien zerlegen, Prüfsummen bilden und komprimierte Logs lesen.', 'tr, od, split, sed-Grundlagen, md5sum, sha256sum, sha512sum, zcat, bzcat, xzcat', 'Terminal-Simulator und Quiz', { ziele: ['103.2'], bereit: true }),
      m('l1-3-5', '3.5', 'Dateien und Verzeichnisse', 'Ordnung schaffen mit Kopieren, Verschieben, Löschen und Platzhaltern.', 'ls, cp, mv, rm, mkdir, rmdir, touch, file, Globbing', 'Terminal-Simulator und Quiz', { ziele: ['103.3'], bereit: true }),
      m('l1-3-6', '3.6', 'Finden und archivieren', 'Dateien nach Eigenschaften suchen und sie sichern.', 'find, tar, gzip, bzip2, xz, cpio, dd', 'Terminal-Simulator und Quiz', { ziele: ['103.3'], bereit: true }),
      m('l1-3-7', '3.7', 'Ströme, Pipes und Umleitungen', 'Ausgaben in Dateien, Fehler getrennt und Befehle zu Ketten verbinden.', 'stdin, stdout, stderr, >, >>, 2>, 2>&1, <, |, tee, xargs, $( )', 'Terminal-Simulator, Code-Puzzle, Quiz', { ziele: ['103.4'], bereit: true }),
      m('l1-3-8', '3.8', 'Prozesse beobachten und beenden', 'Sehen, was auf dem Rechner läuft, und gezielt eingreifen.', 'ps, top, free, uptime, pgrep, pkill, killall, kill, watch, Signale', 'Terminal-Simulator und Quiz', { ziele: ['103.5'], bereit: true }),
      m('l1-3-9', '3.9', 'Jobs und Sitzungen', 'Befehle im Hintergrund laufen lassen und Sitzungen überdauern lassen.', '&, jobs, fg, bg, Strg+Z, nohup, screen, tmux', 'Terminal-Simulator und Quiz', { ziele: ['103.5'], bereit: true }),
      m('l1-3-10', '3.10', 'Prioritäten', 'Rechenzeit gerecht verteilen.', 'nice, renice, Nettigkeit -20 bis 19, ps und top', 'Terminal-Simulator und Quiz', { ziele: ['103.6'], bereit: true }),
      m('l1-3-11', '3.11', 'Reguläre Ausdrücke', 'Muster beschreiben statt Text aufzählen.', 'BRE und ERE, grep, egrep, fgrep, sed, regex(7)', 'Terminal-Simulator, Lückentext, Quiz', { ziele: ['103.7'], bereit: true }),
      m('l1-3-12', '3.12', 'Überleben in vi', 'Eine Datei mit vi öffnen, ändern, speichern und wieder herauskommen.', 'Modi, Navigation, i a o, x dd yy p, / ?, :w :q :q! :wq ZZ, EDITOR', 'vi im Terminal-Simulator und Quiz', { ziele: ['103.8'], bereit: true }),
      m('l1-3-boss', 'Boss 3', 'Der Logfile-Detektiv', 'Ein Einbruchsversuch steckt in den Logs. Nur Filter, Pipes und reguläre Ausdrücke helfen.', 'Alles aus Topic 103 zusammen', 'Terminal-Simulator', { boss: true, ziele: ['103.1', '103.2', '103.3', '103.4', '103.5', '103.6', '103.7', '103.8'], bereit: true }),
      m('l1-3-probe', 'Probe 3', 'Probeprüfung Topic 101 bis 103', 'Gemischte Fragen aus drei Topics, mit Zeitlimit.', 'Alles aus Topic 101 bis 103', 'Prüfungssimulation', { probe: true, ziele: ['101.1', '101.2', '101.3', '102.1', '102.2', '102.3', '102.4', '102.5', '102.6', '103.1', '103.2', '103.3', '103.4', '103.5', '103.6', '103.7', '103.8'], bereit: true }),
    ],
  },
  {
    nr: 4, titel: 'Geräte und Dateisysteme', teil: 'l1-4', teilName: 'Topic 104',
    ziel: 'Eine neue Platte vom leeren Blech bis zum eingehängten Dateisystem einrichten, Rechte sauber vergeben, Links verstehen und Dateien finden. 14 von 60 Fragen in Prüfung 101. Am Ende steht die Generalprobe für Prüfung 101.',
    missionen: [
      m('l1-4-1', '4.1', 'Eine neue Platte partitionieren', 'Mit fdisk eine GPT-Tabelle und Partitionen anlegen.', 'MBR und GPT, fdisk, gdisk, parted, Partitionstypen', 'Terminal-Simulator mit fdisk und Quiz', { ziele: ['104.1'], bereit: true }),
      m('l1-4-2', '4.2', 'Dateisysteme anlegen', 'Ext4, XFS, VFAT und Swap auf die Partitionen bringen.', 'mkfs, mke2fs, mkfs.xfs, mkfs.vfat, exFAT, Btrfs, mkswap, swapon', 'Terminal-Simulator, Zuordnung, Quiz', { ziele: ['104.1'], bereit: true }),
      m('l1-4-3', '4.3', 'Einhängen und aushängen', 'Dateisysteme von Hand, beim Start und per systemd einhängen.', 'mount, umount, /etc/fstab, UUID und LABEL, blkid, lsblk, systemd-Mount-Units', 'Terminal-Simulator, Code-Puzzle, Quiz', { ziele: ['104.3'], bereit: true }),
      m('l1-4-4', '4.4', 'Dateisysteme pflegen', 'Platz überwachen, Dateisysteme prüfen und reparieren.', 'df, du, fsck, e2fsck, tune2fs, xfs_repair, xfs_db, xfs_fsr', 'Terminal-Simulator und Quiz', { ziele: ['104.2'], bereit: true }),
      m('l1-4-5', '4.5', 'Zugriffsrechte', 'Lesen, schreiben, ausführen für Besitzer, Gruppe und alle anderen.', 'rwx, oktal und symbolisch, chmod, umask', 'Terminal-Simulator, Lückentext, Quiz', { ziele: ['104.5'], bereit: true }),
      m('l1-4-6', '4.6', 'Besitz und besondere Bits', 'Besitzer ändern und ein Team-Verzeichnis einrichten.', 'chown, chgrp, SUID, SGID, Sticky Bit', 'Terminal-Simulator und Quiz', { ziele: ['104.5'], bereit: true }),
      m('l1-4-7', '4.7', 'Harte und symbolische Links', 'Verstehen, was Inodes sind und wann welcher Link passt.', 'Inodes, ln, ln -s, ls -li, Links über Dateisystemgrenzen', 'Terminal-Simulator und Quiz', { ziele: ['104.6'], bereit: true }),
      m('l1-4-8', '4.8', 'Alles an seinem Platz', 'Die Verzeichnisstruktur kennen und Dateien schnell finden.', 'FHS, find, locate, updatedb, whereis, which, type', 'Terminal-Simulator, Zuordnung, Quiz', { ziele: ['104.7'], bereit: true }),
      m('l1-4-boss', 'Boss 4', 'Die neue Archivplatte', 'Eine Platte für das Team vollständig einrichten, von der Partition bis zur gemeinsamen Ablage.', 'Alles aus Topic 104 zusammen', 'Terminal-Simulator', { boss: true, ziele: ['104.1', '104.2', '104.3', '104.5', '104.6', '104.7'], bereit: true }),
      m('l1-4-probe', 'Probe 101', 'Generalprobe Prüfung 101', '60 Fragen, 90 Minuten, gewichtet wie die echte Prüfung 101-500.', 'Topics 101 bis 104', 'Prüfungssimulation', { probe: true, ziele: ['101.1', '101.2', '101.3', '102.1', '102.2', '102.3', '102.4', '102.5', '102.6', '103.1', '103.2', '103.3', '103.4', '103.5', '103.6', '103.7', '103.8', '104.1', '104.2', '104.3', '104.5', '104.6', '104.7'], bereit: true }),
    ],
  },
  {
    nr: 5, titel: 'Shells und Skripte', teil: 'l1-5', teilName: 'Topic 105',
    ziel: 'Die eigene Shell einrichten, Variablen, Startdateien, Aliase und Funktionen verstehen und Skripte schreiben, die prüfen, wiederholen und melden. 8 von 60 Fragen in Prüfung 102.',
    missionen: [
      m('l1-5-1', '5.1', 'Variablen und Umgebung', 'Verstehen, was eine Shell an ihre Kinder weitergibt, und den Suchpfad erweitern.', 'Shell- und Umgebungsvariablen, export, env, set, unset, PATH, env -i', 'Terminal-Simulator und Quiz', { ziele: ['105.1'], bereit: true }),
      m('l1-5-2', '5.2', 'Startdateien', 'Herausfinden, welche Shell welche Datei liest, und neuen Benutzern Vorlagen geben.', 'Login- und interaktive Shell, /etc/profile, ~/.bash_profile, ~/.profile, ~/.bashrc, ~/.bash_logout, source, /etc/skel, /etc/profile.d', 'Terminal-Simulator, Code-Puzzle, Quiz', { ziele: ['105.1'], bereit: true }),
      m('l1-5-3', '5.3', 'Aliase und Funktionen', 'Häufige Befehlsfolgen abkürzen und dauerhaft speichern.', 'alias, unalias, Funktionen, local, declare -f, unset -f, type, ~/.bashrc', 'Terminal-Simulator und Quiz', { ziele: ['105.1'], bereit: true }),
      m('l1-5-4', '5.4', 'Das erste Skript', 'Ein Skript mit Shebang, Argumenten und Rückgabewert schreiben und richtig ablegen.', 'Shebang, chmod +x, $0 $1 $# $@ $?, exit, shift, ~/bin, /usr/local/bin, SUID bei Skripten', 'Terminal-Simulator, Lückentext, Quiz', { ziele: ['105.2'], bereit: true }),
      m('l1-5-5', '5.5', 'Entscheidungen', 'Bedingungen prüfen und je nach Ergebnis verzweigen.', 'test, [ ], Datei-, Text- und Zahlentests, if, elif, else, case, &&, ||', 'Terminal-Simulator, Zuordnung, Quiz', { ziele: ['105.2'], bereit: true }),
      m('l1-5-6', '5.6', 'Schleifen und Eingaben', 'Wiederholen, rechnen und Zeilen lesen.', 'for, while, until, seq, $(( )), expr, read, while read, break, continue', 'Terminal-Simulator, Code-Puzzle, Quiz', { ziele: ['105.2'], bereit: true }),
      m('l1-5-boss', 'Boss 5', 'Der Nachtwächter', 'Ein fehlerhaftes Überwachungsskript reparieren, erweitern und für alle einrichten.', 'Alles aus Topic 105 zusammen', 'Terminal-Simulator', { boss: true, ziele: ['105.1', '105.2'], bereit: true }),
      m('l1-5-probe', 'Probe 5', 'Probeprüfung Topic 105', 'Topic 105 gemischt mit der Befehlszeile aus Topic 103, mit Zeitlimit.', 'Topic 105 und Wiederholung von 103.1, 103.4, 103.7', 'Prüfungssimulation', { probe: true, ziele: ['105.1', '105.2', '103.1', '103.4', '103.7'], bereit: true }),
    ],
  },
  {
    nr: 6, titel: 'Benutzeroberflächen', teil: 'l1-6', teilName: 'Topic 106',
    ziel: 'Verstehen, wie X11 und Wayland Fenster auf den Bildschirm bringen, Fenster sicher über das Netz holen, Desktops und Fernzugriffe einordnen und einen Arbeitsplatz barrierefrei einrichten. 4 von 60 Fragen in Prüfung 102.',
    missionen: [
      m('l1-6-1', '6.1', 'X11 und Wayland', 'Den Aufbau der grafischen Oberfläche verstehen und ihre Konfiguration und Logs lesen.', 'X-Server, Clients, Fenster- und Display-Manager, DISPLAY, Wayland, XWayland, xorg.conf, xorg.conf.d, Xorg.0.log, ~/.xsession-errors, xdpyinfo, xwininfo, X -configure', 'Terminal-Simulator, Zuordnung, Quiz', { ziele: ['106.1'], bereit: true }),
      m('l1-6-2', '6.2', 'X über das Netz', 'Fremde Fenster auf die eigene Anzeige lassen, ohne die Tür für alle zu öffnen.', 'xhost, xauth, ~/.Xauthority, MIT-MAGIC-COOKIE, ssh -X, X11Forwarding', 'Terminal-Simulator, Reihenfolge, Quiz', { ziele: ['106.1'], bereit: true }),
      m('l1-6-3', '6.3', 'Desktops und Fernzugriff', 'Die großen Desktops und die Protokolle für entfernte Desktops kennen.', 'GNOME, KDE Plasma, Xfce, GDM, SDDM, LightDM, XDMCP, VNC, RDP, Spice', 'Terminal-Simulator, Zuordnung, Quiz', { ziele: ['106.2'], bereit: true }),
      m('l1-6-4', '6.4', 'Barrierefreiheit', 'Einen Arbeitsplatz für Menschen mit Einschränkungen einrichten.', 'Sticky, Slow, Bounce, Toggle, Repeat und Mouse Keys, hoher Kontrast, große Schrift, Lupe, Orca, BRLTTY, Bildschirmtastatur, gsettings', 'Terminal-Simulator, Zuordnung, Quiz', { ziele: ['106.3'], bereit: true }),
      m('l1-6-boss', 'Boss 6', 'Der Arbeitsplatz für Jonas', 'Tastatur, Zugriffsschutz und Hilfen eines Arbeitsplatzes reparieren und in einem Skript festhalten.', 'Alles aus Topic 106, dazu Skripte aus Topic 105', 'Terminal-Simulator', { boss: true, ziele: ['106.1', '106.2', '106.3'], bereit: true }),
    ],
  },
  {
    nr: 7, titel: 'Administration', teil: 'l1-7', teilName: 'Topic 107',
    ziel: 'Konten und Gruppen verwalten, Passwortregeln setzen, Aufträge mit cron, at und systemd-Timern planen und Sprache, Kodierung und Zeitzone einstellen. 12 von 60 Fragen in Prüfung 102.',
    missionen: [
      m('l1-7-1', '7.1', 'Benutzerkonten', 'Kontodateien lesen und Konten anlegen, ändern und löschen.', '/etc/passwd, /etc/shadow, UIDs, useradd, usermod, userdel, passwd, getent, id, /etc/skel', 'Terminal-Simulator und Quiz', { ziele: ['107.1'], bereit: true }),
      m('l1-7-2', '7.2', 'Gruppen und Passwortregeln', 'Gruppen verwalten und festlegen, wie lange Passwörter und Konten gelten.', '/etc/group, /etc/gshadow, groupadd, groupmod, groupdel, gpasswd, chage, /etc/login.defs', 'Terminal-Simulator und Quiz', { ziele: ['107.1'], bereit: true }),
      m('l1-7-3', '7.3', 'cron', 'Wiederkehrende Aufträge für Benutzer und System planen.', 'crontab, Zeitfelder, /etc/crontab, /etc/cron.d, cron.daily, run-parts, cron.allow, cron.deny', 'Terminal-Simulator, Lückentext, Quiz', { ziele: ['107.2'], bereit: true }),
      m('l1-7-4', '7.4', 'at und systemd-Timer', 'Einmalige Aufträge planen und Timer-Units schreiben.', 'at, atq, atrm, batch, at.allow, at.deny, Timer-Units, OnCalendar, Persistent, systemctl list-timers, systemd-run', 'Terminal-Simulator, Zuordnung, Quiz', { ziele: ['107.2'], bereit: true }),
      m('l1-7-5', '7.5', 'Sprache und Zeitzone', 'Locale, Kodierung und Zeitzone für System und einzelne Befehle einstellen.', 'locale, LANG, LC_*, LC_ALL, localectl, ASCII, ISO-8859, UTF-8, iconv, timedatectl, tzselect, TZ, /etc/localtime, /etc/timezone', 'Terminal-Simulator und Quiz', { ziele: ['107.3'], bereit: true }),
      m('l1-7-boss', 'Boss 7', 'Anas erster Tag', 'Ein Konto mit Fristen, Gruppen, Aufträgen, Zeitzone und umgewandelten Daten einrichten.', 'Alles aus Topic 107, dazu Startdateien aus Topic 105', 'Terminal-Simulator', { boss: true, ziele: ['107.1', '107.2', '107.3'], bereit: true }),
      m('l1-7-probe', 'Probe 7', 'Probeprüfung Topic 106 und 107', 'Topic 106 und 107 gemischt mit Topic 105, mit Zeitlimit.', 'Topic 106, 107 und Wiederholung von 105', 'Prüfungssimulation', { probe: true, ziele: ['106.1', '106.2', '106.3', '107.1', '107.2', '107.3', '105.1', '105.2'], bereit: true }),
    ],
  },
  geplanterAkt('l1', 8, 'Systemdienste', '108', 'Zeit, Protokollierung, Mail und Drucken.', 'lpic1'),
  geplanterAkt('l1', 9, 'Netzwerk', '109', 'IP-Grundlagen, dauerhafte Konfiguration, Fehlersuche und DNS auf dem Client.', 'lpic1'),
  geplanterAkt('l1', 10, 'Sicherheit', '110', 'Rechner absichern und Daten mit SSH und GnuPG schützen.', 'lpic1', [
    m('l1-10-probe', 'Probe 102', 'Generalprobe Prüfung 102', '60 Fragen, 90 Minuten, gewichtet wie die echte Prüfung 102-500.', 'Topics 105 bis 110', 'Prüfungssimulation', { probe: true }),
  ]),
];

// ---------------- Kampagne 2: LPIC-2 ----------------

const LPIC2: Akt[] = [
  {
    nr: 0, titel: 'Das Netzwerk-Labor', teil: 'l2-0', teilName: 'Vorbereitung',
    ziel: 'Aus einer VM wird ein kleines Firmennetz: Server, Client und Router in einem eigenen virtuellen Netz.',
    missionen: [
      m('l2-0-1', '0.1', 'Das Ziel', 'Was LPIC-2 von LPIC-1 unterscheidet und wie die Prüfungen 201 und 202 aufgebaut sind.', 'Prüfungsaufbau, Voraussetzungen', 'Quiz'),
      m('l2-0-2', '0.2', 'Drei Maschinen, ein Netz', 'Ein isoliertes virtuelles Netz mit Server, Client und Router aufbauen.', 'Virtuelle Netze, NAT, internes Netz', 'Ausgabe aus deinem Labor'),
    ],
  },
  geplanterAkt('l2', 1, 'Kapazitätsplanung', '200', 'Engpässe messen und den Bedarf von morgen abschätzen.', 'lpic2'),
  geplanterAkt('l2', 2, 'Der Kernel', '201', 'Kernel verstehen, bauen und im Betrieb verwalten.', 'lpic2'),
  geplanterAkt('l2', 3, 'Systemstart', '202', 'Den Start anpassen und ein kaputtes System retten.', 'lpic2'),
  geplanterAkt('l2', 4, 'Dateisysteme', '203', 'Dateisysteme betreiben, warten und einstellen.', 'lpic2'),
  geplanterAkt('l2', 5, 'Speicher für Fortgeschrittene', '204', 'RAID, Gerätezugriff und LVM.', 'lpic2'),
  geplanterAkt('l2', 6, 'Netzwerkkonfiguration', '205', 'Netzwerke einrichten und Fehler finden.', 'lpic2'),
  geplanterAkt('l2', 7, 'Systemwartung', '206', 'Aus dem Quellcode bauen, sichern und Nutzer informieren.', 'lpic2', [
    m('l2-7-probe', 'Probe 201', 'Generalprobe Prüfung 201', '60 Fragen, 90 Minuten, gewichtet wie die echte Prüfung 201-450.', 'Topics 200 bis 206', 'Prüfungssimulation', { probe: true }),
  ]),
  geplanterAkt('l2', 8, 'DNS', '207', 'Einen eigenen Nameserver betreiben und absichern.', 'lpic2'),
  geplanterAkt('l2', 9, 'Webserver', '208', 'Apache, HTTPS, Squid und Nginx.', 'lpic2'),
  geplanterAkt('l2', 10, 'Dateifreigaben', '209', 'Samba und NFS.', 'lpic2'),
  geplanterAkt('l2', 11, 'Clients verwalten', '210', 'DHCP, PAM und LDAP.', 'lpic2'),
  geplanterAkt('l2', 12, 'E-Mail', '211', 'Mailserver, Zustellung und Postfächer.', 'lpic2'),
  geplanterAkt('l2', 13, 'Systemsicherheit', '212', 'Router, FTP, SSH, Sicherheitsaufgaben und OpenVPN.', 'lpic2', [
    m('l2-13-probe', 'Probe 202', 'Generalprobe Prüfung 202', '60 Fragen, 90 Minuten, gewichtet wie die echte Prüfung 202-450.', 'Topics 207 bis 212', 'Prüfungssimulation', { probe: true }),
  ]),
];

// ---------------- Kampagne 3: LPIC-3 Security ----------------

const LPIC3: Akt[] = [
  {
    nr: 0, titel: 'Das Sicherheitslabor', teil: 'l3-0', teilName: 'Vorbereitung',
    ziel: 'Ein abgeschottetes Labor, in dem du angreifen und verteidigen darfst, ohne jemandem zu schaden.',
    missionen: [
      m('l3-0-1', '0.1', 'Das Ziel', 'Aufbau der Prüfung 303 und was "Security" im Sinne des LPI bedeutet.', 'Prüfungsaufbau, Voraussetzungen', 'Quiz'),
      m('l3-0-2', '0.2', 'Regeln und Labor', 'Ein isoliertes Netz bauen und die rechtlichen Grenzen von Angriffswerkzeugen kennen.', 'Isolation, Snapshots, §202a–c StGB', 'Quiz und Ausgabe aus deinem Labor'),
    ],
  },
  geplanterAkt('l3', 1, 'Kryptografie', '331', 'PKI, TLS, verschlüsselte Dateisysteme und DNSSEC.', 'lpic3'),
  geplanterAkt('l3', 2, 'Rechnersicherheit', '332', 'Härtung, Intrusion Detection und Ressourcenkontrolle.', 'lpic3'),
  geplanterAkt('l3', 3, 'Zugriffskontrolle', '333', 'Rechte, ACLs, SELinux und AppArmor.', 'lpic3'),
  geplanterAkt('l3', 4, 'Netzwerksicherheit', '334', 'Netz härten, Angriffe erkennen, filtern und tunneln.', 'lpic3'),
  geplanterAkt('l3', 5, 'Bedrohungen', '335', 'Typische Schwachstellen kennen und die eigene Abwehr testen.', 'lpic3', [
    m('l3-5-probe', 'Probe 303', 'Generalprobe Prüfung 303', '60 Fragen, 90 Minuten, gewichtet wie die echte Prüfung 303-300.', 'Topics 331 bis 335', 'Prüfungssimulation', { probe: true }),
  ]),
];

export interface Kampagne {
  id: string;
  nr: number;
  titel: string;
  zertifikat: string;     // ID aus lernziele.ts
  kurz: string;
  voraussetzung?: string;
  ueberschrift: string;   // große Überschrift auf der Kampagnenseite
  einstieg: string;       // ein Absatz darunter
  akte: Akt[];
}

export const KAMPAGNEN: Kampagne[] = [
  { id: 'lpic1', nr: 1, titel: 'LPIC-1: Linux Administrator', zertifikat: 'lpic1',
    kurz: 'Von der ersten Zeile im Terminal bis zu den Prüfungen 101-500 und 102-500.',
    ueberschrift: 'Werde Linux-Administrator, auch wenn du heute noch nie ein Terminal geöffnet hast.',
    einstieg: 'Du baust dir ein eigenes Übungs-Linux und lernst genau das, was die Prüfungen verlangen: Hardware, Bootvorgang, Pakete, Kommandozeile, Dateisysteme, Benutzer, Netzwerk und Sicherheit. Jede Mission endet mit einer Prüfung, jede Antwort wird später wiederholt, bis sie sitzt.',
    akte: LPIC1 },
  { id: 'lpic2', nr: 2, titel: 'LPIC-2: Linux Engineer', zertifikat: 'lpic2',
    kurz: 'Kernel, Speicher, Netz und die wichtigsten Serverdienste für die Prüfungen 201-450 und 202-450.',
    voraussetzung: 'Für das Zertifikat brauchst du ein gültiges LPIC-1. Spiel Kampagne 1 am besten komplett.',
    ueberschrift: 'Betreibe das Netz einer kleinen Firma.',
    einstieg: 'Aus einer VM wird ein kleines Firmennetz mit Router, Server und Client. Du baust einen Kernel, rettest Systeme, die nicht mehr starten, und richtest DNS, Web, Samba, NFS, LDAP, Mail und VPN ein.',
    akte: LPIC2 },
  { id: 'lpic3', nr: 3, titel: 'LPIC-3: Security', zertifikat: 'lpic3',
    kurz: 'Kryptografie, Härtung, Zugriffskontrolle und Netzwerksicherheit für die Prüfung 303-300.',
    voraussetzung: 'Für das Zertifikat brauchst du ein gültiges LPIC-2. Kampagne 2 sollte komplett sein.',
    ueberschrift: 'Sichere Linux-Systeme im ganzen Unternehmen ab.',
    einstieg: 'In einem abgeschotteten Labor baust du eine eigene Zertifizierungsstelle, härtest Rechner, sperrst Prozesse mit SELinux ein, filterst Pakete mit nftables und prüfst deine Abwehr mit den Werkzeugen der Angreifer.',
    akte: LPIC3 },
];

export const GEPLANT: { nr: number; titel: string; kurz: string }[] = [];

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

// XP zählen über alle Kampagnen. Die Schwellen orientieren sich am Umfang der Kampagnen
// (Mission 50 XP, Bosskampf und Probeprüfung 100 XP, ohne Erstversuchs-Bonus).
const xpVon = (k: Kampagne) => missionenVon(k).reduce((s, x) => s + x.xp, 0);
const X1 = xpVon(KAMPAGNEN[0]), X2 = xpVon(KAMPAGNEN[1]), X3 = xpVon(KAMPAGNEN[2]);
export const LEVEL = [
  { ab: 0, name: 'Neuling' },
  { ab: 300, name: 'Terminal-Tourist' },
  { ab: 800, name: 'Boot-Bändiger' },
  { ab: Math.round(X1 * 0.4), name: 'Pipe-Pilot' },
  { ab: Math.round(X1 * 0.7), name: 'Rechte-Richter' },
  { ab: X1, name: 'LPIC-1 bereit' },
  { ab: X1 + Math.round(X2 * 0.5), name: 'Kernel-Koch' },
  { ab: X1 + X2, name: 'LPIC-2 bereit' },
  { ab: X1 + X2 + Math.round(X3 * 0.5), name: 'Härter' },
  { ab: X1 + X2 + X3, name: 'Root' },
];
