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
  geplanterAkt('l1', 2, 'Installation und Pakete', '102', 'Festplatten planen, Bootloader installieren und Software mit dpkg, apt, rpm und dnf verwalten.', 'lpic1'),
  geplanterAkt('l1', 3, 'GNU- und Unix-Befehle', '103', 'Der größte Block der Prüfung 101: Kommandozeile, Filter, Pipes, Prozesse, reguläre Ausdrücke und vi.', 'lpic1'),
  geplanterAkt('l1', 4, 'Geräte und Dateisysteme', '104', 'Partitionieren, formatieren, einhängen, Rechte vergeben und Dateien finden.', 'lpic1', [
    m('l1-4-probe', 'Probe 101', 'Generalprobe Prüfung 101', '60 Fragen, 90 Minuten, gewichtet wie die echte Prüfung 101-500.', 'Topics 101 bis 104', 'Prüfungssimulation', { probe: true }),
  ]),
  geplanterAkt('l1', 5, 'Shells und Skripte', '105', 'Die Shell-Umgebung anpassen und eigene Skripte schreiben.', 'lpic1'),
  geplanterAkt('l1', 6, 'Benutzeroberflächen', '106', 'X11, Desktops und Barrierefreiheit.', 'lpic1'),
  geplanterAkt('l1', 7, 'Administration', '107', 'Benutzer und Gruppen, geplante Aufgaben, Sprache und Zeitzone.', 'lpic1'),
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
