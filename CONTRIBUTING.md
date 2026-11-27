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
- Netzwerk (Welt-Option `netz: { keinDefault, dnsFalsch, kabelAus, maskeFalsch, nsswitchOhneDns, hostsFalsch }`): `addr:dev=A/P`, `keinaddr:dev=A/P`, `link:dev=up|down`, `route:ziel=gateway|*` (ziel `default` oder Netz), `erreichbar:name|ip`, `aufloesbar:name`, `aufloesung:name=ip`, `nm:aktiv=profil`, `nm:profil~feld=regex` (Felder method, addresses, gateway, dns, autoconnect), `hostname=name`, `wlan:aus`, `ifup:dev`
- Kernel (Welt-Option `kern: { quelle: 'download'|'entpackt'|'konfiguriert'|'gebaut', werkzeuge, sensor, dkms: 'quelle'|'installiert', regel: 'kaputt', sysctlFluechtig, fehlinstalliert, tippfehler }`): `sysctl:SCHLÜSSEL=WERT` (jetzt), `sysctlstart:SCHLÜSSEL=WERT` (nach Neustart), `sysmod:MODUL.PARAM=WERT` (/sys/module), `modopt:MODUL.PARAM=WERT`, `kernel=VERSION`, `kernelinst:VERSION`, `initrd:VERSION=mit|ohne|fehlt`, `dkms:added|built|installed[@KERNEL]`, `udev:link=NAME`, `udev:gruppe=G`, `udev:modus=0660`, `dep:MODUL[@KERNEL]`, `baum:6.18.65`, `konfig:SYMBOL=WERT`, `gebaut:RELEASE`, `taint=N`, `modulgeladen:MODUL`
- Systemstart (Welt-Option `start: { sysv: 'debian'|'chkconfig', units, dropinKaputt, efiWeg, grub: 'menue'|'cfgweg', fstabKaputt, rootVergessen, live, pxe, pxeZuerst, aus }`): `rl=N`, `sysvlauf:DIENST=an|aus`, `unit:NAME=aktiv|fehler|aus|enabled|disabled|masked|neugeladen`, `efi:erster=NAME`, `efi:next=NAME`, `efi:eintrag~REGEX`, `efi:datei=/EFI/…`, `startmodus=bash|emergency|rescue|normal`, `chroot:drin`, `bind:/mnt/dev`, `gebootet~REGEX` (Kernel und Parameter jedes Starts), `live:nein`, `rootpw:neu`, `iso:PFAD=bios|uefi|hybrid`. Allgemein neu: `dialog~REGEX` (Eingaben in Dialogen wie GRUB-Menü und GRUB-Befehlszeile), `neustarts>=N`.
- Dateisysteme (Welt-Option `dsys: { superblock, btrfs, smart: 'gut'|'warnung', autofs, autofsKaputt, swapDatei: 'fehlt'|'rechte', luks, iso }`, meist zusammen mit `neuePlatte: 'formatiert'`): `swapdatei:PFAD=an|aus|bereit`, `swapprio:PFAD=N`, `superblock:/dev/X=heil|kaputt`, `subvol:PFAD`, `snapshot:PFAD[=ro]`, `btrfs:/dev/X`, `xfsdump:DATEI`, `smarttest:sdb`, `smartd~REGEX` (gelesene smartd.conf nach Neustart), `autofs:laeuft`, `autofs:map=PFAD`, `automount:PFAD=bereit|eingehaengt`, `luks:/dev/X[=Nschluessel]`, `mapper:NAME=offen|zu|/ziel`, `isobild:DATEI[=rr|joliet|rrjoliet|boot]`, `udfbild:DATEI`, `loop:ZIEL`, `nfs:ZIEL`.
- Speicher (Welt-Option `speicher: { platten: N, partitioniert, raid: 'raid1'|'kaputt'|'raid5', lvm: 'fertig'|'voll', iscsi }`, neue Platten ab sdc): `md:md0=raid1|laeuft|gestoppt|sauber|degradiert|sync|Ngeraete`, `md:md0:/dev/X=aktiv|faulty|spare|neu|weg` (Gerät als regulärer Ausdruck erlaubt), `raid:conf~REGEX`, `pv:/dev/X[=VG|frei]`, `vg:NAME[=aktiv|inaktiv|Npvs]`, `lv:VG/LV[=weg|aktiv|inaktiv]`, `lv:VG/LV>=Ng` und `<=Ng`, `lvfs:VG/LV=voll|heil|kaputt|ext4|xfs`, `lvfs:VG/LV>=Ng`, `lvfs:VG/LV~REGEX` (Dateien im LV), `lvsnap:VG/LV=von:ORIGINAL|gueltig|ungueltig`, `iscsi:node|auto|chap|sitzung`, `sched:sdX=NAME`, `einh:ZIEL` (irgendetwas ist dort eingehängt).
- Netzwerk für Fortgeschrittene (Welt-Option `netzwerk: { zweiteKarte, wlan: 'blockiert', arpFalsch, geheim, nmDns, interfacesFehler, hostsDeny, ifcfg: 'gut'|'gatewayFalsch' }`): `neigh:ADRESSE=permanent|weg|ok|falsch`, `vlan:SCHNITTSTELLE=ID`, `mtu:SCHNITTSTELLE=N`, `label:CIDR=NAME`, `addr6:SCHNITTSTELLE=CIDR`, `wlan:verbunden[=SSID]`, `wlan:wpa`, `rfkill:wlan=frei|blockiert`, `dhcp:SCHNITTSTELLE`, `forward:an`, `geheim:weg`, `ifcfg:NAME~REGEX`. Dazu aus dem Grundmodul `addr:`, `link:`, `route:ZIEL=GATEWAY`, `erreichbar:NAME`, `aufloesbar:NAME`, `nm:PROFIL~FELD=REGEX`, `ifup:SCHNITTSTELLE`.
- Last (Welt-Option `last: { szenario: 'ruhig'|'cpu'|'speicher'|'platte'|'netz'|'montag'|'router', sysstat: 'fehlt'|'aus'|'an' }`): `last:wa<10`, `last:load1<2`, `last:swap<100` (MiB), `last:util<50`, `last:cpu<50`, `last:si<1`, `lastprozess:PID=da|weg`, `sysstat:an`, `paket-da:programm`
- Sicherheit (Welt-Option `sicherheit: { altlasten, hostkeyNeu, sudoersKaputt, gpgMax, sshVorbereitet }`): `unit:name=aktiv|inaktiv|enabled|disabled|masked`, `port:tcp/23=offen|zu`, `wrapper:daemon@client=erlaubt|verboten`, `sudoers:gueltig`, `sudo:benutzer=/pfad args`, `keinsudo:…`, `sshd:option=wert` (wirksam nach Neustart), `sshd:laeuft`, `sshkey:~/.ssh/id_x`, `sshkeypass:…`, `fern:/pfad~regex` (Dateien auf labor2), `knownhost:rechner=alt|neu|fehlt`, `agent:N`, `tunnel:port`, `gpgkey:name[=geheim|widerrufen|vertraut]`, `gpgdatei:datei=enc|sym|sig|clear|signed[:name]`, `limit:buchstabe=wert`, `prozess-offen:/pfad=da|weg`
- Wartung (Welt-Option `wartung: { quelle: 'download'|'entpackt', werkzeuge, patch, sicherung, band: 'leer'|'nacht', fern }`): `lager:entpackt`, `lager:konfiguriert[=PREFIX]`, `lager:tui=an|aus`, `lager:gebaut`, `lager:installiert=PREFIX`, `lager:csv=ok|kaputt` (installiertes lagerist mit oder ohne CSV-Patch), `lager:tests=ok|fehler` (make check), `lager:staging=DESTDIR`, `lager:weg=PREFIX`, `archiv:DATEI~REGEX` (Name im Archiv), `archiv:DATEI=N` (Dateien ohne Verzeichnisse), `inkrementell:DATEI` (mit tar -g auf eine bestehende Snapshot-Datei), `band:N~REGEX` (Archiv Nummer N auf dem Band, ab 0), `band:dateien=N`, `band:pos=N`, `band:gelesen=N`, `band:aus`, `band:drin`, `srv1:PFAD[~REGEX]` (Dateien auf srv1, Ziel von rsync). Dazu aus dem Grundmodul `wall`, `shutdown=…`, `da:/run/nologin`, `datei:/etc/issue~…` und aus der Sicherheit `sshd:banner=/etc/issue.net`.
- DNS (Welt-Option `dns: { paket, cache, zone: true|'ohne-ns2', entwurf, rueck, sekundaer, tsig, boss }`, auf Debian und Red Hat): `named:laeuft`, `named:chroot`, `named:installiert`, `named:enabled=UNIT`, `named:querylog`, `named:konf-ok`, `named:opt:OPTION~REGEX`, `named:acl:NAME~REGEX`, `named:kanal:PFAD` (Datei eines logging-Kanals), `named:key:NAME`, `dnszone:ZONE=geladen|signiert|weg`, `dnszone:ZONE>=SERIAL`, `dnszone:ZONE~REGEX` (Einträge als `name TYP daten`, Namen ohne Punkt am Ende), `dnszone:ZONE:typ=TYP`, `dnszone:ZONE:transfer~REGEX` (allow-transfer der Zone), `srv1zone:ZONE>=SERIAL`, `srv1zone:ZONE~REGEX` (Kopie auf srv1), `dnsfrage:NAME/TYP~REGEX` (Antwort von werkstatt an 127.0.0.1), `dnscache:NAME`.

Startzustand einer Station (`welt`): `dateien` (Inhalt `'/'` legt ein Verzeichnis an), `rechte` (`'/pfad': '755 besitzer gruppe'`), `zeiten` (Alter in Tagen), `extraProzesse`, `pathStandard` (Debian-PATH ohne /usr/sbin), `cwd`, `host`, `distro`, `virt`, `neuePlatte` (`true` leer, `'partitioniert'`, `'formatiert'`), `kaputt` (Liste von Partitionen mit Dateisystemfehlern).

Aufbau des Simulators: `shell.ts` (Parser, Umleitungen, PATH, Jobs, Systembefehle), `shell-text.ts` (Textfilter, Dateien, Archive, Prozesse), `shell-pakete.ts` (Pakete, Platten, Bootloader), `shell-dateien.ts` (Rechte, Zeiten, Prüfsummen), `shell-man.ts` (Handbuchseiten), `shell-platten.ts` (Platten, Dateisysteme, mount), `shell-rechte.ts` (chmod, chown, Links, locate), `shell-skript.ts` (if, for, while, case, Funktionen, test, read, Arithmetik, neue Shells mit Startdateien), `shell-x11.ts` (X11, Wayland, xhost, xauth, gsettings), `shell-admin.ts` (Konten und Gruppen), `shell-zeit.ts` (cron, at, Timer, date, Locales, Zeitzonen, iconv), `shell-dienste.ts` (hwclock, chrony, rsyslog, Journal, logrotate, Mail-Zustellung, CUPS), `shell-last.ts` (Lastmodell: uptime, top, htop, free, vmstat, iostat, iotop, sar mit Verlauf, sadf, iftop, ifstat, iptraf-ng, pstree, ethtool; die Werte entstehen aus den laufenden Prozessen), `shell-fs.ts` (/proc/mounts und /etc/mtab, Swap-Dateien mit Prioritäten, dumpe2fs, debugfs, Sicherungs-Superblock, Btrfs mit Subvolumes und Snapshots, btrfs-convert, xfs_info, xfsdump und xfsrestore, smartctl und smartd, AutoFS mit Maps und Zeitablauf, systemd-Automount, ISO 9660 und UDF als Loop-Abbild, LUKS mit cryptsetup und /dev/mapper), `shell-speicher.ts` (Software-RAID mit mdadm, /proc/mdstat, Wiederaufbau mit speed_limit_min, sfdisk -d, LVM mit PVs, VGs, LVs, lvextend und lvreduce samt resize2fs und xfs_growfs, Snapshots mit Copy-on-Write und Merge, vgchange, pvmove, lsblk als Baum, hdparm, sdparm, nvme, fstrim, I/O-Scheduler, iSCSI mit iscsiadm, CHAP, /dev/disk/by-id und scsi_id), `shell-netzwerk.ts` (VLAN, veth und dummy, MTU, Labels und Alias-Schnittstellen, ip neigh und arp mit /etc/ethers, rfkill, iw, iwconfig, iwlist, wpa_passphrase mit echtem PBKDF2, wpa_supplicant, dhclient, zweite Netzwerkkarte, tcpdump mit pcap-Filtern und Mitschnitten, mtr, ifcfg-Dateien für NetworkManager auf Red Hat), `shell-start.ts` (SysV-init mit inittab, rc-Links, update-rc.d und chkconfig, systemd-Units mit Drop-ins, systemd-delta und Generatoren, UEFI-Firmware mit NVRAM und efibootmgr, ESP, GRUB-Menü, Bearbeiten und GRUB-Befehlszeile, init=/bin/bash, Rescue- und Emergency-Modus, fstab-Prüfung beim Start, Live-System mit chroot und grub-install, SYSLINUX, TFTP und xorriso), `shell-kernel.ts` (Kernelquellen, patch, make im Kernelbaum mit Kconfig, modules_install und install mit Haken, initramfs und dracut, DKMS, modprobe.d, modules.dep, sysctl und /proc/sys, lsdev, lshw, udev-Regeln und udevadm, Neustart in einen anderen Kernel samt Kernel-Panic), `shell-sicherheit.ts` (w, last, ulimit, lsof, fuser, nmap, sudoers, Dienste und Sockets, xinetd, TCP-Wrapper, SSH-Client und -Server, GnuPG), `shell-wartung.ts` (das Programm lagerist als Autoconf-Projekt mit configure, make, make check, make install und uninstall, DESTDIR und config.log, install aus coreutils, tar mit -g, -d, --exclude und Zeiten, Bandlaufwerke /dev/st0 und /dev/nst0 mit mt und Dateimarken, rsync lokal und zu srv1 mit --delete und -n, agetty --show-issue mit Escapes, run-parts für update-motd.d, wall mit Datei, /run/nologin bei shutdown), `shell-dns.ts` (BIND 9.18 auf Debian und 9.16 auf Red Hat: Parser für named.conf mit Fehlermeldungen wie named-checkconf, Zonendateien mit $TTL, $ORIGIN, $INCLUDE und Klammern, named-checkzone und named-compilezone mit raw, named als Dienst mit Journal und logging-Kanälen, rndc, SIGHUP, Cache, Weiterleitung und Rekursion über die Wurzel, eigene, delegierte und Weiterleitungszonen, DNSSEC-Prüfung privater Namen mit validate-except, srv1 als zuständiger und sekundärer Server mit NOTIFY, AXFR und TSIG, bind-chroot und named-chroot, version.bind, dnssec-keygen, dnssec-signzone, tsig-keygen; dig, host und nslookup gegen werkstatt und srv1), `shell-netz.ts` (Schnittstellen, Routen, Erreichbarkeit, ping, traceroute, nc, ss, NetworkManager, ifupdown, DNS und Namensauflösung), `vi.ts` (der Editor). Fehlermeldungen folgen den deutschen Übersetzungskatalogen der GNU-Werkzeuge (`LANG=de_DE.UTF-8`). Wo Debian keine Übersetzung mitliefert (vim.tiny, gzip), bleiben sie englisch.

Der Simulator (`src/scripts/shell.ts`) kennt nur die Befehle, die in Missionen vorkommen. Neue Befehle dort ergänzen und dabei das Verhalten eines echten Debian nachbilden, auch die Fehlermeldungen. Testen lässt sich der Simulator auch ohne Browser:

```bash
npx esbuild src/scripts/shell.ts --bundle --format=esm --platform=node --outfile=/tmp/shell.mjs
node -e "import('/tmp/shell.mjs').then(({neueWelt,ausfuehren})=>{const w=neueWelt();console.log(ausfuehren(w,'lsmod | grep snd').ausgabe)})"
```

## Fragen für Probeprüfungen

Fragen stehen in `src/data/fragen.ts`, jede mit Lernziel, Typ (`einfach`, `mehrfach`, `eingabe`) und Erklärung. Die ID ändert sich nie. Gute Fragen prüfen Anwendung statt Wortlaut, haben plausible Ablenker und eine Erklärung, die auch erklärt, warum die falschen Antworten falsch sind.

## Ein neuer Akt

In `src/data/kampagne.ts` erzeugt `geplanterAkt()` aus den Lernzielen automatisch eine Mission pro Lernziel. Wird ein Akt ausgeschrieben, ersetzt eine Liste von Hand die Automatik. Dabei dürfen Lernziele auf mehrere Missionen aufgeteilt werden. Jede Mission bekommt `ziele: ['101.1']`, damit die Lernziel-Karte stimmt.

## Labore

Ein Labor läuft immer in **echten virtuellen Maschinen**, nie in Containern (Docker, Podman, LXC) und nicht in WSL. Container teilen sich den Kernel des Rechners, auf dem sie laufen: SELinux, AppArmor, auditd, Kernel-Parameter außerhalb von `net.*`, Module, Platten, Bootloader und Teile von nftables verhalten sich darin nicht wie auf einem echten System oder fehlen ganz. Für LPIC-3 ist das zwingend, für LPIC-2 die Regel.

Jeder Akt nennt am Anfang, welche Maschinen sein Labor gleichzeitig braucht und wie viel Arbeitsspeicher das mindestens kostet (etwa „3 VMs mit je 1 GB, zusammen 3 GB“). Startkonfigurationen werden als cloud-init für Images auf x86_64 und arm64 geliefert, betreibbar mit QEMU/libvirt, UTM oder anderen Hypervisoren. VirtualBox auf Apple-Silicon-Macs startet keine x86_64-Gäste, darum darf kein Labor nur auf x86-Images oder nur auf Vagrant mit VirtualBox beruhen.

Prüfskripte für ein Labor sagen in erster Linie, **was fehlt** („getenforce meldet Permissive, erwartet Enforcing“). Der Code am Ende schaltet nur den Fortschritt frei und ist an Mission und einen Zufallswert der Seite gebunden. Er ist kein Schutz gegen Schummeln: Die Seite ist statisch, das Verfahren steht offen im Skript. Prüfskripte lesen nur, ändern nichts am System und bauen keine Netzverbindungen auf.

## Der Simulator gegen echte Systeme

Was der Simulator annimmt oder ablehnt, soll sich mit einem echten Debian und einem echten AlmaLinux decken. Vergleichstests führen dieselben Befehle und Konfigurationen dort aus und vergleichen vor allem Rückgabecode und die Entscheidung (etwa `sshd -t`, `nft -c`, `visudo -c`, `named-checkconf`), nicht den vollen Wortlaut. Für alles, was nicht vom Kernel abhängt, genügen Container. Platten, RAID, LVM, Module und Zugriffskontrolle brauchen eine VM. Hinweise des Simulators in Klammern („(Im Simulator: …)“) sind von diesem Vergleich ausgenommen. Die Fälle liegen in `tests/vergleich/faelle/`, die GitHub-Action `vergleich.yml` führt sie bei jedem Push aus. Wie man Tests lokal startet und neue Fälle schreibt, steht in [`tests/README.md`](tests/README.md). Wer eine Terminal-Aufgabe schreibt, trägt ihre Lösung in `tests/loesungen.json` ein, sonst schlägt `npm run test:e2e` fehl.

In LPIC-3-Missionen laufen die englischen Fachbegriffe immer mit, denn die Prüfung 303 gibt es nur auf Englisch und Japanisch.
