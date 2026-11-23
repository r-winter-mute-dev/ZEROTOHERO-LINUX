// Offizielle Lernziele des Linux Professional Institute (LPI) mit Gewichtung.
// Die Gewichtung entspricht ungefähr der Zahl der Prüfungsfragen zu diesem Lernziel.
// Quellen (abgerufen am 23.11.2026):
//   LPIC-1 v5.0:  https://www.lpi.org/our-certifications/exam-101-102-objectives/
//   LPIC-2 v4.5:  https://www.lpi.org/our-certifications/exam-201-202-objectives/
//   LPIC-3 303 v3.0: https://www.lpi.org/our-certifications/exam-303-objectives/
// Ändert das LPI eine Version, wird diese Datei angepasst. IDs von Missionen ändern sich dabei nie.

export interface Lernziel { nr: string; titel: string; gewicht: number; pruefung: string; thema: string; }

const z = (pruefung: string, thema: string, liste: [string, string, number][]): Lernziel[] =>
  liste.map(([nr, titel, gewicht]) => ({ nr, titel, gewicht, pruefung, thema }));

export interface Zertifikat {
  id: string;
  name: string;
  version: string;
  pruefungen: { code: string; name: string; fragen: number; minuten: number }[];
  quelle: string;
  hinweis?: string;
  ziele: Lernziel[];
}

export const ZERTIFIKATE: Zertifikat[] = [
  {
    id: 'lpic1', name: 'LPIC-1', version: '5.0',
    pruefungen: [
      { code: '101-500', name: 'Prüfung 101', fragen: 60, minuten: 90 },
      { code: '102-500', name: 'Prüfung 102', fragen: 60, minuten: 90 },
    ],
    quelle: 'https://www.lpi.org/our-certifications/exam-101-102-objectives/',
    ziele: [
      ...z('101', '101 Systemarchitektur', [
        ['101.1', 'Hardwareeinstellungen ermitteln und konfigurieren', 2],
        ['101.2', 'Das System starten', 3],
        ['101.3', 'Runlevel und Boot-Targets wechseln, das System herunterfahren oder neu starten', 3],
      ]),
      ...z('101', '102 Installation und Paketverwaltung', [
        ['102.1', 'Festplattenaufteilung planen', 2],
        ['102.2', 'Einen Bootmanager installieren', 2],
        ['102.3', 'Shared Libraries verwalten', 1],
        ['102.4', 'Debian-Paketverwaltung verwenden', 3],
        ['102.5', 'RPM- und YUM-Paketverwaltung verwenden', 3],
        ['102.6', 'Linux als Gast einer Virtualisierung', 1],
      ]),
      ...z('101', '103 GNU- und Unix-Befehle', [
        ['103.1', 'Auf der Kommandozeile arbeiten', 4],
        ['103.2', 'Textströme mit Filtern verarbeiten', 2],
        ['103.3', 'Grundlegende Dateiverwaltung', 4],
        ['103.4', 'Ströme, Pipes und Umleitungen verwenden', 4],
        ['103.5', 'Prozesse erzeugen, überwachen und beenden', 4],
        ['103.6', 'Prozess-Ausführungsprioritäten ändern', 2],
        ['103.7', 'Textdateien mit regulären Ausdrücken durchsuchen', 3],
        ['103.8', 'Grundlegendes Editieren von Dateien', 3],
      ]),
      ...z('101', '104 Geräte, Dateisysteme, FHS', [
        ['104.1', 'Partitionen und Dateisysteme anlegen', 2],
        ['104.2', 'Die Integrität von Dateisystemen sichern', 2],
        ['104.3', 'Das Mounten und Unmounten von Dateisystemen steuern', 3],
        ['104.5', 'Zugriffsrechte und Eigentümerschaft verwalten', 3],
        ['104.6', 'Harte und symbolische Links anlegen und ändern', 2],
        ['104.7', 'Systemdateien finden und Dateien am richtigen Ort ablegen', 2],
      ]),
      ...z('102', '105 Shells und Shell-Skripte', [
        ['105.1', 'Die Shell-Umgebung anpassen und verwenden', 4],
        ['105.2', 'Einfache Skripte anpassen oder schreiben', 4],
      ]),
      ...z('102', '106 Benutzerschnittstellen und Desktops', [
        ['106.1', 'X11 installieren und konfigurieren', 2],
        ['106.2', 'Grafische Desktops', 1],
        ['106.3', 'Barrierefreiheit', 1],
      ]),
      ...z('102', '107 Administrative Aufgaben', [
        ['107.1', 'Benutzer- und Gruppenkonten und dazugehörige Systemdateien verwalten', 5],
        ['107.2', 'Systemadministrationsaufgaben durch Einplanen von Jobs automatisieren', 4],
        ['107.3', 'Lokalisierung und Internationalisierung', 3],
      ]),
      ...z('102', '108 Grundlegende Systemdienste', [
        ['108.1', 'Die Systemzeit verwalten', 3],
        ['108.2', 'Systemprotokollierung', 4],
        ['108.3', 'Grundlagen von Mail Transfer Agents (MTA)', 3],
        ['108.4', 'Drucker und Druckvorgänge verwalten', 2],
      ]),
      ...z('102', '109 Netzwerkgrundlagen', [
        ['109.1', 'Grundlagen von Internetprotokollen', 4],
        ['109.2', 'Persistente Netzwerkkonfiguration', 4],
        ['109.3', 'Grundlegende Netzwerkfehlerbehebung', 4],
        ['109.4', 'Clientseitiges DNS konfigurieren', 2],
      ]),
      ...z('102', '110 Sicherheit', [
        ['110.1', 'Administrationsaufgaben für Sicherheit durchführen', 3],
        ['110.2', 'Einen Rechner absichern', 3],
        ['110.3', 'Daten durch Verschlüsselung schützen', 4],
      ]),
    ],
  },
  {
    id: 'lpic2', name: 'LPIC-2', version: '4.5',
    pruefungen: [
      { code: '201-450', name: 'Prüfung 201', fragen: 60, minuten: 90 },
      { code: '202-450', name: 'Prüfung 202', fragen: 60, minuten: 90 },
    ],
    quelle: 'https://www.lpi.org/our-certifications/exam-201-202-objectives/',
    hinweis: 'Im LPI-Wiki steht ein Entwurf für Version 5.0 (u. a. mit Ansible, ZFS und systemd-Sicherheit). Er ist ausdrücklich als Entwurf markiert und noch keine gültige Prüfung. Sobald das LPI Version 5.0 veröffentlicht, wird Kampagne 2 umgestellt.',
    ziele: [
      ...z('201', '200 Kapazitätsplanung', [
        ['200.1', 'Ressourcennutzung messen und Fehler beheben', 6],
        ['200.2', 'Zukünftigen Ressourcenbedarf vorhersagen', 2],
      ]),
      ...z('201', '201 Linux-Kernel', [
        ['201.1', 'Kernel-Komponenten', 2],
        ['201.2', 'Einen Linux-Kernel kompilieren', 3],
        ['201.3', 'Kernel zur Laufzeit verwalten und Fehler beheben', 4],
      ]),
      ...z('201', '202 Systemstart', [
        ['202.1', 'Den Systemstart anpassen', 3],
        ['202.2', 'Systemwiederherstellung', 4],
        ['202.3', 'Alternative Bootloader', 2],
      ]),
      ...z('201', '203 Dateisysteme und Geräte', [
        ['203.1', 'Mit dem Linux-Dateisystem arbeiten', 4],
        ['203.2', 'Ein Linux-Dateisystem warten', 3],
        ['203.3', 'Dateisystemoptionen anlegen und konfigurieren', 2],
      ]),
      ...z('201', '204 Erweiterte Speicherverwaltung', [
        ['204.1', 'RAID konfigurieren', 3],
        ['204.2', 'Zugriff auf Speichergeräte anpassen', 2],
        ['204.3', 'Logical Volume Manager', 3],
      ]),
      ...z('201', '205 Netzwerkkonfiguration', [
        ['205.1', 'Grundlegende Netzwerkkonfiguration', 3],
        ['205.2', 'Erweiterte Netzwerkkonfiguration', 4],
        ['205.3', 'Netzwerkprobleme beheben', 4],
      ]),
      ...z('201', '206 Systemwartung', [
        ['206.1', 'Programme aus dem Quellcode bauen und installieren', 2],
        ['206.2', 'Datensicherung', 3],
        ['206.3', 'Benutzer über Systemereignisse informieren', 1],
      ]),
      ...z('202', '207 DNS-Server', [
        ['207.1', 'Grundkonfiguration eines DNS-Servers', 3],
        ['207.2', 'DNS-Zonen anlegen und pflegen', 3],
        ['207.3', 'Einen DNS-Server absichern', 2],
      ]),
      ...z('202', '208 HTTP-Dienste', [
        ['208.1', 'Grundkonfiguration von Apache', 4],
        ['208.2', 'Apache für HTTPS konfigurieren', 3],
        ['208.3', 'Squid als Caching-Proxy einrichten', 2],
        ['208.4', 'Nginx als Webserver und Reverse Proxy einrichten', 2],
      ]),
      ...z('202', '209 Dateifreigaben', [
        ['209.1', 'Samba-Server konfigurieren', 5],
        ['209.2', 'NFS-Server konfigurieren', 3],
      ]),
      ...z('202', '210 Verwaltung von Netzwerk-Clients', [
        ['210.1', 'DHCP konfigurieren', 2],
        ['210.2', 'PAM-Authentifizierung', 3],
        ['210.3', 'LDAP-Clients verwenden', 2],
        ['210.4', 'Einen OpenLDAP-Server konfigurieren', 4],
      ]),
      ...z('202', '211 E-Mail-Dienste', [
        ['211.1', 'E-Mail-Server verwenden', 4],
        ['211.2', 'E-Mail-Zustellung verwalten', 2],
        ['211.3', 'Postfachzugriff verwalten', 2],
      ]),
      ...z('202', '212 Systemsicherheit', [
        ['212.1', 'Einen Router konfigurieren', 3],
        ['212.2', 'FTP-Server verwalten', 2],
        ['212.3', 'Secure Shell (SSH)', 4],
        ['212.4', 'Sicherheitsaufgaben', 3],
        ['212.5', 'OpenVPN', 2],
      ]),
    ],
  },
  {
    id: 'lpic3', name: 'LPIC-3 Security', version: '3.0',
    pruefungen: [{ code: '303-300', name: 'Prüfung 303', fragen: 60, minuten: 90 }],
    quelle: 'https://www.lpi.org/our-certifications/exam-303-objectives/',
    hinweis: 'Für das Zertifikat LPIC-3 Security brauchst du ein gültiges LPIC-2 und die bestandene Prüfung 303.',
    ziele: [
      ...z('303', '331 Kryptografie', [
        ['331.1', 'X.509-Zertifikate und Public-Key-Infrastrukturen', 5],
        ['331.2', 'X.509-Zertifikate für Verschlüsselung, Signatur und Authentifizierung', 4],
        ['331.3', 'Verschlüsselte Dateisysteme', 3],
        ['331.4', 'DNS und Kryptografie', 5],
      ]),
      ...z('303', '332 Rechnersicherheit', [
        ['332.1', 'Härtung eines Rechners', 5],
        ['332.2', 'Host-Intrusion-Detection', 5],
        ['332.3', 'Ressourcenkontrolle', 3],
      ]),
      ...z('303', '333 Zugriffskontrolle', [
        ['333.1', 'Benutzerbestimmbare Zugriffskontrolle (DAC)', 3],
        ['333.2', 'Verpflichtende Zugriffskontrolle (MAC)', 5],
      ]),
      ...z('303', '334 Netzwerksicherheit', [
        ['334.1', 'Härtung des Netzwerks', 4],
        ['334.2', 'Network-Intrusion-Detection', 4],
        ['334.3', 'Paketfilterung', 5],
        ['334.4', 'Virtuelle private Netzwerke', 4],
      ]),
      ...z('303', '335 Bedrohungen und Schwachstellenanalyse', [
        ['335.1', 'Häufige Sicherheitslücken und Bedrohungen', 2],
        ['335.2', 'Penetrationstests', 3],
      ]),
    ],
  },
];

export const zertifikat = (id: string) => ZERTIFIKATE.find((x) => x.id === id)!;
export const lernziel = (nr: string) => ZERTIFIKATE.flatMap((x) => x.ziele).find((x) => x.nr === nr);
