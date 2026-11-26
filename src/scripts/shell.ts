// Ein kleiner, absichtlich begrenzter Linux-Simulator für die Übungen im Browser.
// Er kennt nur die Befehle, die in den Missionen vorkommen, verhält sich bei diesen aber wie ein echtes System:
// Rechte (sudo), Pipes, Umleitungen, Kernelmodule mit Abhängigkeiten, systemd-Targets, geplanter Shutdown.
// Der Rechner ist erfunden ("werkstatt"), die Ausgaben sind an echte Systeme angelehnt und gekürzt.

import { paketBefehle, programmStarten, neustartPakete, startStand, zustandPakete, paketeSetzen, paketHinzu, grubSchreiben, type PaketStand } from './shell-pakete';
import { netzwerkBefehle, netzwerkKern, netzwerkStarten, zustandNetzwerk, type NetzwerkOptionen } from './shell-netzwerk';
import { spKern, speicherStarten, speicherBefehle, speicherVorZeile, speicherNachApt, zustandSpeicher, type SpeicherOptionen } from './shell-speicher';
import { fsKern, dsysStarten, dsysBefehle, dsysVorZeile, dsysNachApt, zustandDsys, type DsysOptionen } from './shell-fs';
import { startNachApt, initExec, startBefehle, startKern, startStarten, startVorKernel, startNachKernel, startProgramm, chrootVerlassen, zustandStart, startAktiv, type StartOptionen } from './shell-start';
import { kernBefehle, kernBefehleRef, kernGrub, kernKern, kernNachApt, kernNeustart, kernProgramm, kernStarten, zustandKern, MODUL_ORT, type KernOptionen } from './shell-kernel';
import { textBefehle } from './shell-text';
import { SEITEN, EINGEBAUT_OHNE_SEITE, whatis, apropos } from './shell-man';
import { locateDbAnlegen, rechteBefehle, linksAbgleichen, nurLesbar, zustandRechte, inode, linkZahl } from './shell-rechte';
import { START_FSTAB, plattenBefehle, startPlatten, zustandPlatten, plattenKaputt, type PlattenStand } from './shell-platten';
import { skriptKern, programm, funktionAufrufen, istZusammengesetzt, zerlegenProgramm, BrauchtEingabe, stand, rechnen, RechenFehler, parameter, skriptEingebaut, skriptBefehle, suBefehl, shellStarten, shellBeenden, zustandSkript } from './shell-skript';
import { adminBefehle, adminKern, idFuer, zustandAdmin, gruppenVon } from './shell-admin';
import { zeitBefehle, zeitDateien, zeitKern, timerSystemctl, zustandZeit, datumFormat } from './shell-zeit';
import { lastBefehle, lastKern, lastStarten, lastSystemctl, sysstatPruefen, zustandLast, type LastOptionen } from './shell-last';
import { sicherBefehle, sicherDateien, sicherKern, sicherStarten, sicherSystemctl, sudoErlaubt, zustandSicherheit, type SicherOptionen } from './shell-sicherheit';
import { netzBefehle, netzDateien, netzKern, netzStarten, zustandNetz, type NetzOptionen } from './shell-netz';
import { dienstBefehle, dienstDateien, dienstKern, dienstStarten, dienstSystemctl, zustandDienste, type DienstOptionen } from './shell-dienste';
import { x11Befehle, x11Dateien, grafikStarten, zustandX11 } from './shell-x11';
import { START_UHR, beruehren, darf, darfImOrdner, meta, neuMeta, type Meta } from './shell-dateien';

export interface Modul { name: string; groesse: number; abh: string[]; beschreibung: string; parameter?: Record<string, string>; datei?: string; }
export interface Prozess { pid: number; user: string; cmd: string; ignoriertTerm?: boolean; ppid?: number; ni?: number; cpu?: number; mem?: number; vsz?: number; rss?: number; tty?: string; stat?: string; start?: string; zeit?: string; weg?: boolean; nohup?: boolean; }
export interface Job { nr: number; pid: number; cmd: string; status: 'Running' | 'Stopped' | 'Done'; }

export interface Welt {
  host: string;
  user: string;
  root: boolean;                 // Root-Shell (nach sudo -i)
  cwd: string;
  fs: Record<string, string | null>;   // Pfad -> Inhalt, null = Verzeichnis
  verfuegbar: Record<string, Modul>;   // Module unter /lib/modules
  geladen: Record<string, string[]>;   // geladenes Modul -> wer es benutzt (Module)
  inBenutzung: Record<string, number>; // zusätzliche Nutzer (z. B. eingehängter USB-Stick)
  defaultTarget: string;
  target: string;
  runlevelVorher: string;
  shutdown: null | { art: 'poweroff' | 'reboot' | 'halt'; zeit: string; text: string };
  aus: null | string;            // System ist heruntergefahren / startet neu
  walls: string[];
  prozesse: Prozess[];
  verlauf: { zeile: string; code: number; ausgabe: string }[];
  kernel: string;
  cmdline: string;
  distro: 'debian' | 'alma' | 'suse';
  virt: string;                  // Ausgabe von systemd-detect-virt, "none" = echte Hardware
  env: Record<string, string>;   // exportierte Umgebungsvariablen
  vars: Record<string, string>;  // Shell-Variablen (nicht exportiert)
  pakete?: PaketStand;
  wartet: null | { standardJa: boolean; aktion: () => { out: string; code: number; err?: string }; nein?: string };   // offene Rückfrage [Y/n]
  meta?: Record<string, Meta>;   // Rechte, Besitzer, Zeit
  umask: number;
  uhr: number;                   // simulierte Zeit in ms
  jobs: Job[];
  vordergrund: null | { pid: number; cmd: string; nr?: number };
  langlaeufer: string | null;    // ein Befehl läuft weiter (sleep, top, tail -f …)
  historie: string[];
  histGespeichert?: number;
  aliase: Record<string, string>;
  nice: number;
  nohup: boolean;
  naechstePid: number;
  letzterCode: number;
  args: string[][];              // Positionsparameter von Skripten ($0, $1 …)
  meldungen: string[];           // „[1]+  Fertig …“ vor dem nächsten Prompt
  vi?: boolean;
  langNice?: number;
  stdoutTty?: boolean;
  platten?: PlattenStand;
  inodes?: Record<string, number>;
  hardlinkInhalt?: Record<number, string>;
  locateDb?: string[];
  mountUnitsGeladen?: boolean;
  mountUnitsAktiv?: string[];
  fstabStand?: string | null;
  unitStand?: Record<string, string | null>;
  dialog?: null | { prompt: string; eingabe: (zeile: string) => string };   // interaktive Programme wie fdisk
}

const KERNEL = '6.1.0-27-amd64';

// ---------- Die erfundene Hardware ----------

const PCI = [
  { slot: '00:00.0', klasse: 'Host bridge', name: 'Intel Corporation 8th Gen Core Processor Host Bridge/DRAM Registers (rev 07)', ids: '[0600]: Intel Corporation [8086:3e9b]', treiber: 'skl_uncore', module: [] as string[] },
  { slot: '00:02.0', klasse: 'VGA compatible controller', name: 'Intel Corporation CoffeeLake-S GT2 [UHD Graphics 630]', ids: '[0300]: Intel Corporation [8086:3e92]', treiber: 'i915', module: ['i915'] },
  { slot: '00:14.0', klasse: 'USB controller', name: 'Intel Corporation Cannon Lake PCH USB 3.1 xHCI Host Controller (rev 10)', ids: '[0c03]: Intel Corporation [8086:a36d]', treiber: 'xhci_hcd', module: ['xhci_pci'] },
  { slot: '00:17.0', klasse: 'SATA controller', name: 'Intel Corporation Cannon Lake PCH SATA AHCI Controller (rev 10)', ids: '[0106]: Intel Corporation [8086:a352]', treiber: 'ahci', module: ['ahci'] },
  { slot: '00:1f.3', klasse: 'Audio device', name: 'Intel Corporation Cannon Lake PCH cAVS (rev 10)', ids: '[0403]: Intel Corporation [8086:a348]', treiber: 'snd_hda_intel', module: ['snd_hda_intel'] },
  { slot: '00:1f.6', klasse: 'Ethernet controller', name: 'Intel Corporation Ethernet Connection (7) I219-V (rev 10)', ids: '[0200]: Intel Corporation [8086:15bc]', treiber: 'e1000e', module: ['e1000e'] },
  { slot: '01:00.0', klasse: 'Non-Volatile memory controller', name: 'Samsung Electronics Co Ltd NVMe SSD Controller SM981/PM981/PM983', ids: '[0108]: Samsung Electronics Co Ltd [144d:a808]', treiber: 'nvme', module: ['nvme'] },
  { slot: '02:00.0', klasse: 'Network controller', name: 'Intel Corporation Wi-Fi 6 AX200 (rev 1a)', ids: '[0280]: Intel Corporation [8086:2723]', treiber: 'iwlwifi', module: ['iwlwifi'] },
];

const USB = [
  { bus: '001', dev: '001', id: '1d6b:0002', name: 'Linux Foundation 2.0 root hub' },
  { bus: '001', dev: '002', id: '046d:c52b', name: 'Logitech, Inc. Unifying Receiver' },
  { bus: '001', dev: '003', id: '0781:5583', name: 'SanDisk Corp. Ultra Fit' },
  { bus: '001', dev: '004', id: '046d:0825', name: 'Logitech, Inc. Webcam C270' },
  { bus: '001', dev: '005', id: '8087:0029', name: 'Intel Corp. AX200 Bluetooth' },
  { bus: '002', dev: '001', id: '1d6b:0003', name: 'Linux Foundation 3.0 root hub' },
];

const MODULE: Modul[] = [
  { name: 'i915', groesse: 3911680, abh: ['drm_kms_helper', 'drm', 'video'], beschreibung: 'Intel Graphics' },
  { name: 'drm_kms_helper', groesse: 212992, abh: ['drm'], beschreibung: 'DRM KMS helper' },
  { name: 'drm', groesse: 708608, abh: [], beschreibung: 'DRM shared core routines' },
  { name: 'video', groesse: 65536, abh: [], beschreibung: 'ACPI Video Driver' },
  { name: 'xhci_pci', groesse: 24576, abh: ['xhci_hcd'], beschreibung: 'xHCI PCI Host Controller Driver' },
  { name: 'xhci_hcd', groesse: 348160, abh: ['usbcore'], beschreibung: "'eXtensible' Host Controller (xHC) Driver" },
  { name: 'usbcore', groesse: 348160, abh: ['usb_common'], beschreibung: 'USB core' },
  { name: 'usb_common', groesse: 16384, abh: [], beschreibung: 'Common code for host and device side USB' },
  { name: 'usb_storage', groesse: 81920, abh: ['usbcore', 'scsi_mod'], beschreibung: 'USB Mass Storage driver for Linux', parameter: { delay_use: 'seconds to delay before using a new device (uint)', quirks: 'supplemental list of device IDs and their quirks (string)' } },
  { name: 'uas', groesse: 32768, abh: ['usb_storage', 'usbcore', 'scsi_mod'], beschreibung: 'USB Attached SCSI driver' },
  { name: 'scsi_mod', groesse: 278528, abh: [], beschreibung: 'SCSI core' },
  { name: 'ahci', groesse: 49152, abh: ['libahci'], beschreibung: 'AHCI SATA low-level driver' },
  { name: 'libahci', groesse: 53248, abh: [], beschreibung: 'Common AHCI SATA low-level routines' },
  { name: 'nvme', groesse: 57344, abh: ['nvme_core'], beschreibung: 'NVMe host PCIe transport driver' },
  { name: 'nvme_core', groesse: 196608, abh: [], beschreibung: 'NVMe host core framework' },
  { name: 'snd_hda_intel', groesse: 57344, abh: ['snd_hda_codec', 'snd'], beschreibung: 'Intel HDA driver', parameter: { power_save: 'Automatic power-saving timeout (in second, 0 = disable). (xint)', enable_msi: 'Enable Message Signaled Interrupt (MSI) (bint)' } },
  { name: 'snd_hda_codec', groesse: 184320, abh: ['snd'], beschreibung: 'HDA codec core' },
  { name: 'snd', groesse: 126976, abh: ['soundcore'], beschreibung: 'Advanced Linux Sound Architecture driver for soundcards.' },
  { name: 'soundcore', groesse: 16384, abh: [], beschreibung: 'Core sound module' },
  { name: 'e1000e', groesse: 323584, abh: [], beschreibung: 'Intel(R) PRO/1000 Network Driver', parameter: { InterruptThrottleRate: 'Interrupt Throttling Rate (array of int)', SmartPowerDownEnable: 'Enable PHY smart power down (array of int)' } },
  { name: 'iwlwifi', groesse: 380928, abh: ['cfg80211'], beschreibung: 'Intel(R) Wireless WiFi driver for Linux', parameter: { power_save: 'enable WiFi power management (default: disable) (bool)', '11n_disable': 'disable 11n functionality, bitmap: 1: full, 2: disable agg TX, 4: disable agg RX, 8 enable agg TX (uint)' } },
  { name: 'cfg80211', groesse: 1105920, abh: ['rfkill'], beschreibung: 'wireless configuration support' },
  { name: 'rfkill', groesse: 36864, abh: [], beschreibung: 'RF switch support' },
  { name: 'uvcvideo', groesse: 135168, abh: ['videodev', 'usbcore'], beschreibung: 'USB Video Class driver' },
  { name: 'videodev', groesse: 307200, abh: [], beschreibung: 'Video4Linux2 core driver' },
  { name: 'btusb', groesse: 69632, abh: ['bluetooth', 'usbcore'], beschreibung: 'Generic Bluetooth USB driver' },
  { name: 'bluetooth', groesse: 999424, abh: ['rfkill'], beschreibung: 'Bluetooth Core ver 2.22' },
  { name: 'pcspkr', groesse: 16384, abh: [], beschreibung: 'PC Speaker beeper driver' },
  { name: 'floppy', groesse: 135168, abh: [], beschreibung: 'Floppy disk driver' },
  { name: 'vfat', groesse: 24576, abh: ['fat'], beschreibung: 'VFAT filesystem support' },
  { name: 'fat', groesse: 94208, abh: [], beschreibung: 'FAT filesystem support' },
];

// Was nach dem Start geladen ist (Name -> Module, die es benutzen, werden berechnet)
const START_GELADEN = ['i915', 'drm_kms_helper', 'drm', 'video', 'xhci_pci', 'xhci_hcd', 'usbcore', 'usb_common', 'usb_storage', 'uas', 'scsi_mod', 'ahci', 'libahci', 'nvme', 'nvme_core', 'snd_hda_intel', 'snd_hda_codec', 'snd', 'soundcore', 'e1000e', 'iwlwifi', 'cfg80211', 'rfkill', 'uvcvideo', 'videodev', 'btusb', 'bluetooth', 'pcspkr', 'vfat', 'fat'];

const DMESG = `[    0.000000] Linux version ${KERNEL} (debian-kernel@lists.debian.org) (gcc-12 (Debian 12.2.0-14) 12.2.0) #1 SMP PREEMPT_DYNAMIC Debian 6.1.115-1
[    0.000000] Command line: BOOT_IMAGE=/boot/vmlinuz-${KERNEL} root=UUID=3f1c0d6e-8a2b-4c51-9a0e-2d7b1e5c9f40 ro quiet
[    0.000000] BIOS-provided physical RAM map:
[    0.004512] efi: EFI v2.70 by American Megatrends
[    0.112345] ACPI: Early table checksum verification disabled
[    0.401233] PCI: Using configuration type 1 for base access
[    0.913377] pci 0000:00:02.0: vgaarb: setting as boot VGA device
[    1.204511] Freeing initrd memory: 61040K
[    1.893021] usbcore: registered new interface driver usbfs
[    1.902114] xhci_hcd 0000:00:14.0: xHCI Host Controller
[    2.004887] nvme nvme0: pci function 0000:01:00.0
[    2.118392] nvme0n1: p1 p2 p3
[    2.201230] ahci 0000:00:17.0: AHCI 0001.0301 32 slots 6 ports 6 Gbps 0x3f impl SATA mode
[    2.733104] EXT4-fs (nvme0n1p2): mounted filesystem with ordered data mode. Quota mode: none.
[    3.110982] systemd[1]: systemd 252.31-1~deb12u1 running in system mode
[    3.402177] e1000e 0000:00:1f.6 eth0: Intel(R) PRO/1000 Network Connection
[    3.415550] e1000e 0000:00:1f.6 enp0s31f6: renamed from eth0
[    3.887611] iwlwifi 0000:02:00.0: loaded firmware version 77.f92b5fed.0 cc-a0-77.ucode op_mode iwlmvm
[    4.002315] usb 1-3: new high-speed USB device number 3 using xhci_hcd
[    4.155302] usb-storage 1-3:1.0: USB Mass Storage device detected
[    4.290017] scsi 0:0:0:0: Direct-Access     SanDisk  Ultra Fit        1.00 PQ: 0 ANSI: 6
[    4.511829] sd 0:0:0:0: [sda] 60063744 512-byte logical blocks: (30.8 GB/28.6 GiB)
[    4.600210]  sda: sda1
[    4.700911] uvcvideo: Found UVC 1.00 device C270 HD WEBCAM (046d:0825)
[    5.301234] snd_hda_intel 0000:00:1f.3: enabling device (0000 -> 0002)
[    6.004010] i915 0000:00:02.0: [drm] Finished loading DMC firmware i915/kbl_dmc_ver1_04.bin (v1.4)
[    7.812001] e1000e 0000:00:1f.6 enp0s31f6: NIC Link is Up 1000 Mbps Full Duplex, Flow Control: Rx/Tx
[   12.443870] ata3: SATA link down (SStatus 0 SControl 300)
[   15.002871] EXT4-fs (sda1): VFS: Can't find ext4 filesystem
[   15.012309] FAT-fs (sda1): Volume was not properly unmounted. Some data may be corrupt. Please run fsck.`;

const JOURNAL_VORHER = `Nov 22 21:58:03 werkstatt systemd[1]: Reached target graphical.target - Graphical Interface.
Nov 22 22:41:17 werkstatt systemd-logind[612]: The system will power off now!
Nov 22 22:41:17 werkstatt systemd[1]: Stopping user@1000.service - User Manager for UID 1000...
Nov 22 22:41:19 werkstatt systemd[1]: Reached target poweroff.target - System Power Off.`;

const JOURNAL_JETZT = `Nov 23 08:12:01 werkstatt kernel: Linux version ${KERNEL} (debian-kernel@lists.debian.org) #1 SMP PREEMPT_DYNAMIC Debian 6.1.115-1
Nov 23 08:12:01 werkstatt kernel: Command line: BOOT_IMAGE=/boot/vmlinuz-${KERNEL} root=UUID=3f1c0d6e-8a2b-4c51-9a0e-2d7b1e5c9f40 ro quiet
Nov 23 08:12:02 werkstatt kernel: nvme0n1: p1 p2 p3
Nov 23 08:12:04 werkstatt systemd[1]: systemd 252.31-1~deb12u1 running in system mode
Nov 23 08:12:05 werkstatt systemd[1]: Reached target local-fs.target - Local File Systems.
Nov 23 08:12:06 werkstatt kernel: e1000e 0000:00:1f.6 enp0s31f6: renamed from eth0
Nov 23 08:12:08 werkstatt systemd[1]: Started NetworkManager.service - Network Manager.
Nov 23 08:12:09 werkstatt systemd[1]: Reached target multi-user.target - Multi-User System.
Nov 23 08:12:10 werkstatt systemd[1]: Started gdm.service - GNOME Display Manager.
Nov 23 08:12:11 werkstatt systemd[1]: Reached target graphical.target - Graphical Interface.
Nov 23 08:12:16 werkstatt kernel: FAT-fs (sda1): Volume was not properly unmounted. Some data may be corrupt. Please run fsck.
Nov 23 08:12:30 werkstatt systemd[1]: smartd.service: Failed with result 'exit-code'.
Nov 23 08:12:30 werkstatt systemd[1]: Failed to start smartd.service - Self Monitoring and Reporting Technology (SMART) Daemon.`;

const TARGETS: Record<string, string> = {
  'poweroff.target': 'System Power Off', 'rescue.target': 'Rescue Mode', 'multi-user.target': 'Multi-User System',
  'graphical.target': 'Graphical Interface', 'reboot.target': 'Reboot', 'emergency.target': 'Emergency Mode',
};
const RUNLEVEL_ZU_TARGET: Record<string, string> = { '0': 'poweroff.target', '1': 'rescue.target', s: 'rescue.target', S: 'rescue.target', '2': 'multi-user.target', '3': 'multi-user.target', '4': 'multi-user.target', '5': 'graphical.target', '6': 'reboot.target' };
const TARGET_ZU_RUNLEVEL: Record<string, string> = { 'poweroff.target': '0', 'rescue.target': '1', 'multi-user.target': '3', 'graphical.target': '5', 'reboot.target': '6' };

function grundFs(): Record<string, string | null> {
  const fs: Record<string, string | null> = {
    '/': null, '/home': null, '/home/lena': null, '/etc': null, '/etc/modprobe.d': null, '/etc/systemd': null, '/etc/systemd/system': null,
    '/usr': null, '/usr/lib': null, '/usr/lib/systemd': null, '/usr/lib/systemd/system': null, '/lib': null, '/lib/modules': null,
    [`/lib/modules/${KERNEL}`]: null, '/proc': null, '/sys': null, '/sys/bus': null, '/sys/bus/pci': null, '/sys/bus/pci/devices': null,
    '/sys/bus/usb': null, '/sys/bus/usb/devices': null, '/sys/class': null, '/sys/class/net': null, '/sys/class/block': null, '/sys/module': null,
    '/dev': null, '/dev/input': null, '/dev/disk': null, '/var': null, '/var/log': null, '/boot': null, '/run': null, '/tmp': null,
    '/etc/hosts': "127.0.0.1\tlocalhost\n127.0.1.1\twerkstatt\n\n# The following lines are desirable for IPv6 capable hosts\n::1     localhost ip6-localhost ip6-loopback\nff02::1 ip6-allnodes\nff02::2 ip6-allrouters\n",
    '/etc/motd': "\nThe programs included with the Debian GNU/Linux system are free software;\nthe exact distribution terms for each program are described in the\nindividual files in /usr/share/doc/*/copyright.\n\nDebian GNU/Linux comes with ABSOLUTELY NO WARRANTY, to the extent\npermitted by applicable law.\n",
    '/etc/passwd': "root:x:0:0:root:/root:/bin/bash\ndaemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin\nbin:x:2:2:bin:/bin:/usr/sbin/nologin\nsys:x:3:3:sys:/dev:/usr/sbin/nologin\nsync:x:4:65534:sync:/bin:/bin/sync\ngames:x:5:60:games:/usr/games:/usr/sbin/nologin\nman:x:6:12:man:/var/cache/man:/usr/sbin/nologin\nlp:x:7:7:lp:/var/spool/lpd:/usr/sbin/nologin\nmail:x:8:8:mail:/var/mail:/usr/sbin/nologin\nnews:x:9:9:news:/var/spool/news:/usr/sbin/nologin\nwww-data:x:33:33:www-data:/var/www:/usr/sbin/nologin\nbackup:x:34:34:backup:/var/backups:/usr/sbin/nologin\n_apt:x:42:65534::/nonexistent:/usr/sbin/nologin\nnobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin\nsystemd-network:x:998:998:systemd Network Management:/:/usr/sbin/nologin\nmessagebus:x:100:107::/nonexistent:/usr/sbin/nologin\nsshd:x:101:65534::/run/sshd:/usr/sbin/nologin\nlena:x:1000:1000:Lena,,,:/home/lena:/bin/bash\nmax:x:1001:1001:Max,,,:/home/max:/bin/bash\n",
    '/etc/group': "root:x:0:\ndaemon:x:1:\nbin:x:2:\nsys:x:3:\nadm:x:4:\ntty:x:5:\ndisk:x:6:\nlp:x:7:\nmail:x:8:\ncdrom:x:24:lena\nsudo:x:27:lena\naudio:x:29:\nwww-data:x:33:\nbackup:x:34:\nplugdev:x:46:lena\nusers:x:100:lena\nshadow:x:42:\nmessagebus:x:107:\nlena:x:1000:\nmax:x:1001:\n",
    '/etc/shadow': "root:*:20050:0:99999:7:::\ndaemon:*:20050:0:99999:7:::\nbin:*:20050:0:99999:7:::\nsys:*:20050:0:99999:7:::\nsync:*:20050:0:99999:7:::\ngames:*:20050:0:99999:7:::\nman:*:20050:0:99999:7:::\nlp:*:20050:0:99999:7:::\nmail:*:20050:0:99999:7:::\nnews:*:20050:0:99999:7:::\nwww-data:*:20050:0:99999:7:::\nbackup:*:20050:0:99999:7:::\n_apt:*:20050:0:99999:7:::\nnobody:*:20050:0:99999:7:::\nsystemd-network:*:20050:0:99999:7:::\nmessagebus:*:20050:0:99999:7:::\nsshd:*:20050:0:99999:7:::\nlena:$y$j9T$Qm1kP0aZ$hVq0cW8yZr4tLx2nE7bD5sKfA1uJ3gM9pR6oT0vX2Y.:20050:0:99999:7:::\nmax:$y$j9T$a8Lw2Rt5$kN3pQ7mZx1cV9bF4gH6jD2sA0eR8tY5uI3oP7lK1M2/:20050:0:99999:7:::\n",
    '/home/lena/.bashrc': "# ~/.bashrc: executed by bash(1) for non-login shells.\n# If not running interactively, don't do anything\ncase $- in\n    *i*) ;;\n      *) return;;\nesac\n\n# don't put duplicate lines or lines starting with space in the history.\nHISTCONTROL=ignoreboth\n\n# append to the history file, don't overwrite it\nshopt -s histappend\n\n# for setting history length see HISTSIZE and HISTFILESIZE in bash(1)\nHISTSIZE=1000\nHISTFILESIZE=2000\n\n# enable color support of ls\nif [ -x /usr/bin/dircolors ]; then\n    alias ls='ls --color=auto'\n    #alias grep='grep --color=auto'\nfi\n\n# some more ls aliases\n#alias ll='ls -l'\n#alias la='ls -A'\n#alias l='ls -CF'\n",
    '/home/lena/.profile': "# ~/.profile: executed by the command interpreter for login shells.\n# if running bash\nif [ -n \"$BASH_VERSION\" ]; then\n    # include .bashrc if it exists\n    if [ -f \"$HOME/.bashrc\" ]; then\n\t. \"$HOME/.bashrc\"\n    fi\nfi\n\n# set PATH so it includes user's private bin if it exists\nif [ -d \"$HOME/bin\" ] ; then\n    PATH=\"$HOME/bin:$PATH\"\nfi\n",
    '/home/lena/.bash_history': "ls\ncd downloads\nls -l\ncd\nsudo apt update\nsudo apt upgrade\ncat notizen.txt\nlsusb\nsudo dmesg | tail\n",
    '/home/lena/.bash_logout': "# ~/.bash_logout: executed by bash(1) when login shell exits.\n\n# when leaving the console clear the screen to increase privacy\n\nif [ \"$SHLVL\" = 1 ]; then\n    [ -x /usr/bin/clear_console ] && /usr/bin/clear_console -q\nfi\n",
    '/etc/profile': "# /etc/profile: system-wide .profile file for the Bourne shell (sh(1))\n# and Bourne compatible shells (bash(1), ksh(1), ash(1), ...).\n\nif [ \"$(id -u)\" -eq 0 ]; then\n  PATH=\"/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\"\nelse\n  PATH=\"/usr/local/bin:/usr/bin:/bin:/usr/local/games:/usr/games\"\nfi\nexport PATH\n\nif [ \"${PS1-}\" ]; then\n  if [ \"${BASH-}\" ] && [ \"$BASH\" != \"/bin/sh\" ]; then\n    # The file bash.bashrc already sets the default PS1.\n    # PS1='\\h:\\w\\$ '\n    if [ -f /etc/bash.bashrc ]; then\n      . /etc/bash.bashrc\n    fi\n  else\n    if [ \"$(id -u)\" -eq 0 ]; then\n      PS1='# '\n    else\n      PS1='$ '\n    fi\n  fi\nfi\n\nif [ -d /etc/profile.d ]; then\n  for i in /etc/profile.d/*.sh; do\n    if [ -r $i ]; then\n      . $i\n    fi\n  done\n  unset i\nfi\n",
    '/etc/bash.bashrc': "# System-wide .bashrc file for interactive bash(1) shells.\n\n# To enable the settings / commands in this file for login shells as well,\n# this file has to be sourced in /etc/profile.\n\n# If not running interactively, don't do anything\n[ -z \"${PS1-}\" ] && return\n\n# check the window size after each command and, if necessary,\n# update the values of LINES and COLUMNS.\nshopt -s checkwinsize\n\n# set a fancy prompt (non-color, overwrite the one in /etc/profile)\nPS1='${debian_chroot:+($debian_chroot)}\\u@\\h:\\w\\$ '\n",
    '/etc/profile.d': null, '/etc/skel': null,
    '/etc/skel/.bash_logout': "# ~/.bash_logout: executed by bash(1) when login shell exits.\n\n# when leaving the console clear the screen to increase privacy\n\nif [ \"$SHLVL\" = 1 ]; then\n    [ -x /usr/bin/clear_console ] && /usr/bin/clear_console -q\nfi\n",
    '/var/mail': null,
    '/home/max': null,
    '/root': null,
    '/home/lena/notizen.txt': 'Labor-Notizen\nUSB-Stick nicht einfach abziehen!\n',
    '/etc/hostname': 'werkstatt\n',
    '/etc/fstab': '# /etc/fstab: static file system information.\n# <file system>                           <mount point> <type> <options>         <dump> <pass>\nUUID=3f1c0d6e-8a2b-4c51-9a0e-2d7b1e5c9f40 /             ext4   errors=remount-ro 0      1\nUUID=6A1F-2B3C                            /boot/efi     vfat   umask=0077        0      1\nUUID=9d8e7f60-1a2b-4c3d-8e9f-0a1b2c3d4e5f none          swap   sw                0      0\n',
    '/etc/os-release': 'PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"\nNAME="Debian GNU/Linux"\nVERSION_ID="12"\nID=debian\n',
    '/etc/modprobe.d/alsa-base.conf': '# Autoloader aliases\noptions snd-hda-intel power_save=1\n',
    '/etc/modprobe.d/iwlwifi.conf': '# /etc/modprobe.d/iwlwifi.conf\nremove iwlwifi \\\n(/sbin/lsmod | grep -o -e ^iwlmvm -e ^iwldvm -e ^iwlwifi | xargs /sbin/rmmod) \\\n&& /sbin/modprobe -r mac80211\n',
    '/proc/cpuinfo': 'processor\t: 0\nvendor_id\t: GenuineIntel\ncpu family\t: 6\nmodel name\t: Intel(R) Core(TM) i5-8500 CPU @ 3.00GHz\ncpu MHz\t\t: 3000.000\ncache size\t: 9216 KB\ncpu cores\t: 6\nflags\t\t: fpu vme de pse tsc msr pae mce cx8 apic sep mtrr pge mca cmov pat pse36 clflush lm vmx ssse3 sse4_1 sse4_2 avx avx2\n\nprocessor\t: 1\nvendor_id\t: GenuineIntel\nmodel name\t: Intel(R) Core(TM) i5-8500 CPU @ 3.00GHz\n(… Einträge für Kern 2 bis 5 gekürzt …)\n',
    '/proc/meminfo': 'MemTotal:       16303428 kB\nMemFree:         9874112 kB\nMemAvailable:   13502236 kB\nBuffers:          201344 kB\nCached:          3489012 kB\nSwapTotal:       2097148 kB\nSwapFree:        2097148 kB\n',
    '/proc/interrupts': '            CPU0       CPU1       CPU2       CPU3       CPU4       CPU5\n   0:         33          0          0          0          0          0  IR-IO-APIC    2-edge      timer\n   8:          0          0          1          0          0          0  IR-IO-APIC    8-edge      rtc0\n   9:          0          4          0          0          0          0  IR-IO-APIC    9-fasteoi   acpi\n 120:          0          0          0      48211          0          0  IR-PCI-MSI 327680-edge      xhci_hcd\n 121:          0          0          0          0      30112          0  IR-PCI-MSI 1048576-edge      nvme0q0\n 125:          0          0          0          0          0      91822  IR-PCI-MSI 520192-edge      enp0s31f6\n 127:       1022          0          0          0          0          0  IR-PCI-MSI 32768-edge      i915\n 129:          0        355          0          0          0          0  IR-PCI-MSI 514048-edge      snd_hda_intel:card0\n',
    '/proc/ioports': '0000-0cf7 : PCI Bus 0000:00\n  0000-001f : dma1\n  0020-0021 : pic1\n  0040-0043 : timer0\n  0060-0060 : keyboard\n  0070-0077 : rtc0\n  0080-008f : dma page reg\n  00f0-00ff : fpu\n0cf8-0cff : PCI conf1\nf000-f03f : 0000:00:02.0\nf060-f07f : 0000:00:17.0\n  f060-f07f : ahci\n',
    '/proc/dma': ' 4: cascade\n',
    '/proc/version': `Linux version ${KERNEL} (debian-kernel@lists.debian.org) (gcc-12 (Debian 12.2.0-14) 12.2.0) #1 SMP PREEMPT_DYNAMIC Debian 6.1.115-1\n`,
    '/proc/cmdline': `BOOT_IMAGE=/boot/vmlinuz-${KERNEL} root=UUID=3f1c0d6e-8a2b-4c51-9a0e-2d7b1e5c9f40 ro quiet\n`,
    '/proc/partitions': 'major minor  #blocks  name\n\n 259        0  500107608 nvme0n1\n 259        1     524288 nvme0n1p1\n 259        2  497582080 nvme0n1p2\n 259        3    2000896 nvme0n1p3\n   8        0   30031872 sda\n   8        1   30030848 sda1\n',
    '/sys/class/net/enp0s31f6': null, '/sys/class/net/lo': null, '/sys/class/net/wlp2s0': null,
    '/sys/class/net/enp0s31f6/address': '3c:7c:3f:1a:2b:4d\n', '/sys/class/net/enp0s31f6/operstate': 'up\n', '/sys/class/net/enp0s31f6/speed': '1000\n',
    '/sys/class/net/wlp2s0/operstate': 'down\n',
    '/sys/class/block/nvme0n1': null, '/sys/class/block/nvme0n1p1': null, '/sys/class/block/nvme0n1p2': null, '/sys/class/block/nvme0n1p3': null, '/sys/class/block/sda': null, '/sys/class/block/sda1': null,
    '/sys/class/block/sda/removable': '1\n', '/sys/class/block/nvme0n1/removable': '0\n', '/sys/class/block/sda/size': '60063744\n',
    '/dev/nvme0n1': '', '/dev/nvme0n1p1': '', '/dev/nvme0n1p2': '', '/dev/nvme0n1p3': '', '/dev/sda': '', '/dev/sda1': '', '/dev/sr0': '',
    '/dev/null': '', '/dev/zero': '', '/dev/random': '', '/dev/tty1': '', '/dev/input/event0': '', '/dev/input/mice': '',
    '/var/log/syslog': '(Debian 12 schreibt standardmäßig ins Journal. Nutze journalctl.)\n',
    '/etc/inittab': '# /etc/inittab: Wird auf diesem System mit systemd nicht mehr ausgewertet.\n# Auf SysVinit-Systemen stünde hier zum Beispiel:\n# id:3:initdefault:\n',
    '/boot/grub': null, '/boot/grub/grub.cfg': '# Automatisch erzeugt von grub-mkconfig. Nicht von Hand bearbeiten.\nmenuentry \'Debian GNU/Linux\' {\n\tlinux\t/vmlinuz-' + KERNEL + ' root=UUID=3f1c0d6e-8a2b-4c51-9a0e-2d7b1e5c9f40 ro quiet\n\tinitrd\t/initrd.img-' + KERNEL + '\n}\n',
    [`/boot/vmlinuz-${KERNEL}`]: '', [`/boot/initrd.img-${KERNEL}`]: '', [`/boot/config-${KERNEL}`]: '',
    '/etc/default': null, '/etc/default/grub': 'GRUB_DEFAULT=0\nGRUB_TIMEOUT=5\nGRUB_DISTRIBUTOR=`lsb_release -i -s 2> /dev/null || echo Debian`\nGRUB_CMDLINE_LINUX_DEFAULT="quiet"\nGRUB_CMDLINE_LINUX=""\n',
    '/usr/lib/systemd/system/graphical.target': '[Unit]\nDescription=Graphical Interface\nRequires=multi-user.target\nWants=display-manager.service\nConflicts=rescue.service rescue.target\nAfter=multi-user.target rescue.service rescue.target display-manager.service\nAllowIsolate=yes\n',
    '/usr/lib/systemd/system/multi-user.target': '[Unit]\nDescription=Multi-User System\nRequires=basic.target\nConflicts=rescue.service rescue.target\nAfter=basic.target rescue.service rescue.target\nAllowIsolate=yes\n',
    '/usr/lib/systemd/system/rescue.target': '[Unit]\nDescription=Rescue Mode\nRequires=sysinit.target rescue.service\nAfter=sysinit.target rescue.service\nAllowIsolate=yes\n',
    '/usr/lib/systemd/system/runlevel3.target': '-> multi-user.target', '/usr/lib/systemd/system/runlevel5.target': '-> graphical.target',
    '/etc/systemd/system/default.target': '-> /usr/lib/systemd/system/graphical.target',
  };
  x11Dateien(fs);
  zeitDateien(fs);
  dienstDateien(fs);
  netzDateien(fs);
  sicherDateien(fs);
  // Gruppen-Schatten, Vorgaben für useradd und login.defs (Debian 12)
  fs['/etc/gshadow'] = (fs['/etc/group'] ?? '').split('\n').filter(Boolean).map((z) => { const g = z.split(':'); return `${g[0]}:${g[0] === 'sudo' || g[0] === 'users' ? '*' : '!'}::${g[3] ?? ''}`; }).join('\n') + '\n';
  fs['/etc/default/useradd'] = '# Default values for useradd(8)\n#\n# The SHELL variable specifies the default login shell on your\n# system.\n# Similar to DSHELL in adduser. However, we use "sh" here because\n# useradd is a low level utility and should be as general\n# as possible\nSHELL=/bin/sh\n#\n# The default group for users\n# 100=users on Debian systems\n# Same as USERS_GID in adduser\n# This argument is used when the -n flag is specified.\n# The default behavior (when -n and -g are not specified) is to create a\n# primary user group with the same name as the user being added to the\n# system.\n# GROUP=100\n#\n# The default home directory. Same as DHOME for adduser\n# HOME=/home\n#\n# The number of days after a password expires until the account\n# is permanently disabled\n# INACTIVE=-1\n#\n# The default expire date\n# EXPIRE=\n#\n# The SKEL variable specifies the directory containing "skeletal" user\n# files; in other words, files such as a sample .profile that will be\n# copied to the new user\'s home directory when it is created.\n# SKEL=/etc/skel\n#\n# Defines whether the mail spool should be created while\n# creating the account\n# CREATE_MAIL_SPOOL=no\n';
  fs['/etc/login.defs'] = '#\n# /etc/login.defs - Configuration control definitions for the login package.\n#\nMAIL_DIR        /var/mail\n\n# Password aging controls:\n#\n#\tPASS_MAX_DAYS\tMaximum number of days a password may be used.\n#\tPASS_MIN_DAYS\tMinimum number of days allowed between password changes.\n#\tPASS_WARN_AGE\tNumber of days warning given before a password expires.\n#\nPASS_MAX_DAYS\t99999\nPASS_MIN_DAYS\t0\nPASS_WARN_AGE\t7\n\n#\n# Min/max values for automatic uid selection in useradd(8)\n#\nUID_MIN\t\t\t 1000\nUID_MAX\t\t\t60000\n#SYS_UID_MIN\t\t  100\n#SYS_UID_MAX\t\t  999\nGID_MIN\t\t\t 1000\nGID_MAX\t\t\t60000\n\n#\n# If useradd(8) should create home directories for users by default (non\n# system users only).\n# This option is overridden with the -M or -m flags on the useradd(8)\n# command-line.\n#\n#CREATE_HOME     yes\n\n# HOME_MODE is used by useradd(8) and newusers(8) to set the mode for new\n# home directories.\n# If HOME_MODE is not set, the value of UMASK is used to create the mode.\nHOME_MODE\t0700\n\nUMASK\t\t022\n\nENCRYPT_METHOD YESCRYPT\n';
  // Vorlagen für neue Benutzer und die Startdateien von root
  for (const n of ['.bashrc', '.profile']) { fs['/etc/skel/' + n] = fs['/home/lena/' + n]; fs['/root/' + n] = fs['/home/lena/' + n]; }
  for (const p of PCI) {
    fs[`/sys/bus/pci/devices/0000:${p.slot}`] = null;
    fs[`/sys/bus/pci/devices/0000:${p.slot}/vendor`] = '0x' + p.ids.match(/\[(\w{4}):/)![1] + '\n';
    fs[`/sys/bus/pci/devices/0000:${p.slot}/device`] = '0x' + p.ids.match(/:(\w{4})\]$/)![1] + '\n';
  }
  for (const u of ['1-0:1.0', '1-2', '1-3', '1-4', '1-5', '2-0:1.0', 'usb1', 'usb2']) fs[`/sys/bus/usb/devices/${u}`] = null;
  for (const mod of MODULE) fs[`/lib/modules/${KERNEL}/${modulPfad(mod.name)}`] = '';
  return fs;
}

function modulPfad(name: string) {
  if (MODUL_ORT[name]) return MODUL_ORT[name];
  const ordner: Record<string, string> = { usb_storage: 'kernel/drivers/usb/storage', uas: 'kernel/drivers/usb/storage', e1000e: 'kernel/drivers/net/ethernet/intel/e1000e', iwlwifi: 'kernel/drivers/net/wireless/intel/iwlwifi', pcspkr: 'kernel/drivers/input/misc', floppy: 'kernel/drivers/block', i915: 'kernel/drivers/gpu/drm/i915', snd_hda_intel: 'kernel/sound/pci/hda', uvcvideo: 'kernel/drivers/media/usb/uvc', btusb: 'kernel/drivers/bluetooth', vfat: 'kernel/fs/fat', fat: 'kernel/fs/fat', nvme: 'kernel/drivers/nvme/host', nvme_core: 'kernel/drivers/nvme/host', scsi_mod: 'kernel/drivers/scsi', ahci: 'kernel/drivers/ata', libahci: 'kernel/drivers/ata', xhci_pci: 'kernel/drivers/usb/host', xhci_hcd: 'kernel/drivers/usb/host', usbcore: 'kernel/drivers/usb/core', usb_common: 'kernel/drivers/usb/common', cfg80211: 'kernel/net/wireless', rfkill: 'kernel/net/rfkill', bluetooth: 'kernel/net/bluetooth', snd: 'kernel/sound/core', soundcore: 'kernel/sound', snd_hda_codec: 'kernel/sound/pci/hda', drm: 'kernel/drivers/gpu/drm', drm_kms_helper: 'kernel/drivers/gpu/drm', video: 'kernel/drivers/acpi', videodev: 'kernel/drivers/media/v4l2-core' };
  return `${ordner[name] ?? 'kernel/drivers/misc'}/${name.replace(/_/g, name === 'usb_storage' ? '-' : '_')}.ko`;
}

export interface WeltOptionen { netzwerk?: NetzwerkOptionen; speicher?: SpeicherOptionen; dsys?: DsysOptionen; start?: StartOptionen; kern?: KernOptionen; last?: LastOptionen; sicherheit?: SicherOptionen; netz?: NetzOptionen; dienste?: DienstOptionen; grafik?: 'x11' | 'wayland'; defaultTarget?: string; target?: string; ohne?: string[]; dateien?: Record<string, string>; prozesse?: Prozess[]; root?: boolean; distro?: 'debian' | 'alma' | 'suse'; virt?: string; host?: string; aptVeraltet?: boolean; geaendert?: string[]; pathStandard?: boolean; cwd?: string; rechte?: Record<string, string>; zeiten?: Record<string, number>; aliase?: Record<string, string>; extraProzesse?: Prozess[]; neuePlatte?: boolean | 'leer' | 'partitioniert' | 'formatiert'; kaputt?: string[]; }

export function neueWelt(o: WeltOptionen = {}): Welt {
  const verfuegbar = Object.fromEntries(MODULE.map((x) => [x.name, x]));
  const w: Welt = {
    host: 'werkstatt', user: 'lena', root: !!o.root, cwd: '/home/lena', fs: grundFs(), verfuegbar, geladen: {}, inBenutzung: { usb_storage: 1, vfat: 1, snd: 2, i915: 3 },
    defaultTarget: o.defaultTarget ?? 'graphical.target', target: o.target ?? o.defaultTarget ?? 'graphical.target', runlevelVorher: 'N',
    shutdown: null, aus: null, walls: [], verlauf: [], kernel: KERNEL, cmdline: `BOOT_IMAGE=/boot/vmlinuz-${KERNEL} root=UUID=3f1c0d6e-8a2b-4c51-9a0e-2d7b1e5c9f40 ro quiet`,
    distro: o.distro ?? 'debian', virt: o.virt ?? 'none',
    // Auf „werkstatt“ hat lena /usr/sbin im PATH. Der Debian-Standard für normale Benutzer hat es nicht (Mission 3.2).
    env: { HOME: '/home/lena', USER: 'lena', LOGNAME: 'lena', PATH: o.pathStandard ? '/usr/local/bin:/usr/bin:/bin:/usr/local/games:/usr/games' : '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/games', SHELL: '/bin/bash', LANG: 'de_DE.UTF-8', PWD: '/home/lena', TERM: 'xterm-256color', SHLVL: '1' },
    vars: { HISTSIZE: '1000', HISTFILESIZE: '2000', HISTCONTROL: 'ignoreboth', BASH: '/usr/bin/bash', BASH_VERSION: '5.2.15(1)-release', PS1: '\\u@\\h:\\w\\$ ' }, wartet: null,
    umask: 0o022, uhr: START_UHR, jobs: [], vordergrund: null, langlaeufer: null, historie: [], aliase: o.aliase ?? { ls: 'ls --color=auto' },
    nice: 0, nohup: false, naechstePid: 4012, letzterCode: 0, args: [], meldungen: [],
    prozesse: [...(o.prozesse ?? STANDARD_PROZESSE), ...(o.extraProzesse ?? [])].map((p) => ({ ...p })),
  };
  for (const n of START_GELADEN) if (!o.ohne?.includes(n)) w.geladen[n] = [];
  if (w.distro !== 'debian') {
    w.fs['/etc/os-release'] = w.distro === 'alma'
      ? 'NAME="AlmaLinux"\nVERSION="9.4 (Seafoam Ocelot)"\nID="almalinux"\nID_LIKE="rhel centos fedora"\nVERSION_ID="9.4"\nPRETTY_NAME="AlmaLinux 9.4 (Seafoam Ocelot)"\n'
      : 'NAME="openSUSE Leap"\nVERSION="15.6"\nID="opensuse-leap"\nID_LIKE="suse opensuse"\nVERSION_ID="15.6"\nPRETTY_NAME="openSUSE Leap 15.6"\n';
  }
  startStand(w);
  if (o.host) { w.host = o.host; w.fs['/etc/hostname'] = o.host + '\n'; }
  if (o.aptVeraltet) w.pakete!.aptAktuell = false;
  if (o.geaendert) w.pakete!.geaendert = o.geaendert;
  for (const [p, c] of Object.entries(o.dateien ?? {})) {
    const teile = p.split('/').filter(Boolean);
    for (let i = 1; i < teile.length; i++) { const d = '/' + teile.slice(0, i).join('/'); if (!(d in w.fs)) w.fs[d] = null; }
    w.fs[p] = c === '/' ? null : c;   // „/“ als Inhalt steht für ein Verzeichnis
  }
  for (const [p, r] of Object.entries(o.rechte ?? {})) { const [mode, owner, group] = r.split(' '); const m = meta(w, p); m.mode = parseInt(mode, 8); if (owner) m.owner = owner; if (group) m.group = group; }
  for (const [p, t] of Object.entries(o.zeiten ?? {})) meta(w, p).mtime = START_UHR - t * 86400000;
  if (o.cwd) { w.cwd = o.cwd; w.env.PWD = o.cwd; }
  if (o.dienste) dienstStarten(w, o.dienste);
  if (o.netz) netzStarten(w, o.netz);
  sicherStarten(w, o.sicherheit ?? {});
  if (o.last) lastStarten(w, o.last);
  if (o.grafik) { grafikStarten(w, o.grafik); if ('/var/log/Xorg.0.log' in w.fs) meta(w, '/var/log/Xorg.0.log').mode = 0o644; }
  w.historie = (w.fs['/home/lena/.bash_history'] ?? '').split('\n').filter(Boolean);
  programmeAblegen(w);
  // Verzeichnisse nach dem Filesystem Hierarchy Standard, die noch fehlen
  if (w.distro === 'debian') for (const d of ['/mnt', '/media', '/srv', '/opt', '/usr/local', '/usr/local/bin', '/usr/local/sbin', '/usr/share', '/usr/share/doc', '/usr/share/man', '/usr/lib', '/usr/include', '/var/tmp', '/var/lib', '/var/cache', '/var/spool', '/var/mail', '/run', '/boot', '/proc', '/sys', '/lib', '/home', '/root', '/etc/default', '/etc/opt']) if (!(d in w.fs)) w.fs[d] = null;
  w.platten = startPlatten({ neuePlatte: o.neuePlatte }, START_UHR);
  START_FSTAB.set(w, w.fs['/etc/fstab'] ?? undefined);
  if (o.kern) kernStarten(w, o.kern);
  if (o.start) startStarten(w, o.start);
  if (o.dsys) dsysStarten(w, o.dsys);
  if (o.speicher) speicherStarten(w, o.speicher);
  if (o.netzwerk) netzwerkStarten(w, o.netzwerk);
  locateDbAnlegen(w);
  for (const d of o.kaputt ?? []) plattenKaputt(w, d);
  if (o.neuePlatte) { w.fs['/dev/sdb'] = ''; for (const p of w.platten.platten.find((x) => x.name === 'sdb')!.partitionen) w.fs['/dev/sdb' + p.nr] = ''; }
  w.fs['/etc/systemd/system/default.target'] = `-> /usr/lib/systemd/system/${w.defaultTarget}`;
  benutzerBerechnen(w);
  return w;
}

// Die wichtigsten Programme liegen als Platzhalter in /usr/bin und /usr/sbin, damit ls, file, find und which sie finden.
const PROGRAMME = ['fallocate', 'sync', 'passwd', 'su', 'chsh', 'chfn', 'newgrp', 'gpasswd', 'chage', 'expiry', 'crontab', 'stat', 'readlink', 'mount', 'umount', 'df', 'du', 'findmnt', 'lsblk', 'ln', 'chgrp', 'locate', 'plocate', 'bash', 'cat', 'cp', 'mv', 'rm', 'ls', 'mkdir', 'rmdir', 'touch', 'ln', 'chmod', 'chown', 'head', 'tail', 'wc', 'sort', 'uniq', 'cut', 'paste', 'tr', 'od', 'split', 'nl', 'tac', 'sed', 'grep', 'find', 'xargs', 'tar', 'gzip', 'gunzip', 'zcat', 'bzip2', 'bunzip2', 'bzcat', 'xz', 'unxz', 'xzcat', 'cpio', 'dd', 'md5sum', 'sha256sum', 'sha512sum', 'file', 'ps', 'top', 'free', 'uptime', 'pgrep', 'pkill', 'killall', 'kill', 'watch', 'nice', 'renice', 'nohup', 'sleep', 'tee', 'env', 'printenv', 'uname', 'which', 'whereis', 'man', 'date', 'echo', 'printf', 'pwd', 'less', 'more', 'vim.tiny', 'nano', 'screen', 'tmux', 'basename', 'dirname', 'id', 'whoami', 'hostname', 'sudo', 'lspci', 'lsusb', 'lsblk', 'dmesg', 'journalctl', 'systemctl', 'apt', 'apt-get', 'apt-cache', 'dpkg', 'ldd', 'seq', 'expr', 'mail', 'dircolors', 'dash', 'test', '[', 'diff', 'xclock', 'xeyes', 'xterm', 'xcalc', 'gnome-calculator', 'orca', 'onboard', 'xdpyinfo', 'xwininfo', 'xhost', 'xauth', 'X', 'Xorg', 'setxkbmap', 'gsettings', 'getent', 'crontab', 'at', 'atq', 'atrm', 'batch', 'run-parts', 'systemd-run', 'locale', 'localectl', 'timedatectl', 'tzselect', 'iconv', 'chronyc', 'ntpdate', 'ntpq', 'logger', 'systemd-cat', 'mailq', 'postqueue', 'newaliases', 'postalias', 'lp', 'lpr', 'lpq', 'lprm', 'cancel', 'lpstat', 'lpoptions', 'ip', 'ss', 'netstat', 'ping', 'ping6', 'traceroute', 'traceroute6', 'tracepath', 'tracepath6', 'nc', 'netcat', 'host', 'dig', 'nslookup', 'hostnamectl', 'nmcli', 'networkctl', 'resolvectl', 'w', 'last', 'lastb', 'lastlog', 'lsof', 'fuser', 'ssh', 'scp', 'ssh-add', 'ssh-agent', 'ssh-copy-id', 'gpg', 'gpgconf', 'gpg-agent', 'gpg-connect-agent', 'telnet', 'vmstat', 'pstree', 'nproc', 'lscpu', 'uptime'];
const SBIN_PROGRAMME = ['dumpe2fs', 'debugfs', 'xfs_info', 'smartd', 'mkfs', 'mkfs.ext2', 'mkfs.ext3', 'mkfs.ext4', 'mkfs.xfs', 'mkfs.vfat', 'mkfs.fat', 'mkfs.exfat', 'mkswap', 'swapoff', 'blkid', 'e2fsck', 'fsck', 'fsck.ext4', 'tune2fs', 'xfs_repair', 'xfs_fsr', 'xfs_db', 'parted', 'gdisk', 'fdisk', 'modprobe', 'insmod', 'rmmod', 'lsmod', 'modinfo', 'shutdown', 'reboot', 'poweroff', 'halt', 'ldconfig', 'update-grub', 'grub-install', 'swapon', 'dpkg-reconfigure', 'sshd', 'telinit', 'runlevel', 'useradd', 'usermod', 'userdel', 'groupadd', 'groupmod', 'groupdel', 'hwclock', 'rsyslogd', 'logrotate', 'sendmail', 'postsuper', 'lpadmin', 'cupsenable', 'cupsdisable', 'cupsaccept', 'cupsreject', 'lpinfo', 'ifconfig', 'route', 'ifup', 'ifdown', 'visudo', 'tcpdmatch', 'service', 'ethtool'];
function programmeAblegen(w: Welt) {
  if (w.distro !== 'debian') return;
  for (const d of ['/usr', '/usr/bin', '/usr/sbin']) if (!(d in w.fs)) w.fs[d] = null;
  const groesse = (n: string) => 20000 + ((n.length * 7919) % 120000);
  for (const n of PROGRAMME) if (!w.fs[`/usr/bin/${n}`]) w.fs[`/usr/bin/${n}`] = '\u0007BIN:' + groesse(n);
  for (const n of SBIN_PROGRAMME) if (!w.fs[`/usr/sbin/${n}`]) w.fs[`/usr/sbin/${n}`] = '\u0007BIN:' + groesse(n);
  w.fs['/usr/bin/vi'] = '-> /etc/alternatives/vi';
  w.fs['/usr/bin/sh'] = '-> dash';
  w.fs['/usr/bin/dash'] = '\u0007BIN:125560';
  // merged /usr: /bin und /sbin sind Verweise
  if (!('/bin' in w.fs)) w.fs['/bin'] = '-> usr/bin';
  if (!('/sbin' in w.fs)) w.fs['/sbin'] = '-> usr/sbin';
}

const STANDARD_PROZESSE: Prozess[] = [
  { pid: 1, user: 'root', cmd: '/sbin/init', ppid: 0, cpu: 0.0, mem: 0.1, vsz: 168000, rss: 12800, tty: '?', stat: 'Ss', start: '08:12', zeit: '00:00:02' },
  { pid: 2, user: 'root', cmd: '[kthreadd]', ppid: 0, cpu: 0, mem: 0, vsz: 0, rss: 0, tty: '?', stat: 'S', start: '08:12' },
  { pid: 412, user: 'root', cmd: '/lib/systemd/systemd-journald', ppid: 1, cpu: 0.0, mem: 0.2, vsz: 49000, rss: 21000, tty: '?', stat: 'Ss', start: '08:12' },
  { pid: 612, user: 'root', cmd: '/lib/systemd/systemd-logind', ppid: 1, cpu: 0.0, mem: 0.1, vsz: 17000, rss: 8000, tty: '?', stat: 'Ss', start: '08:12' },
  { pid: 640, user: 'root', cmd: '/usr/sbin/cron -f', ppid: 1, cpu: 0.0, mem: 0.0, vsz: 6600, rss: 2700, tty: '?', stat: 'Ss', start: '08:12' },
  { pid: 845, user: 'root', cmd: '/usr/sbin/NetworkManager --no-daemon', ppid: 1, cpu: 0.1, mem: 0.1, vsz: 260000, rss: 19000, tty: '?', stat: 'Ssl', start: '08:12' },
  { pid: 901, user: 'root', cmd: 'sshd: /usr/sbin/sshd -D', ppid: 1, cpu: 0.0, mem: 0.0, vsz: 15400, rss: 9000, tty: '?', stat: 'Ss', start: '08:12' },
  { pid: 1203, user: 'lena', cmd: '-bash', ppid: 1190, cpu: 0.0, mem: 0.0, vsz: 8600, rss: 5200, tty: 'pts/0', stat: 'Ss', start: '08:20' },
  { pid: 1450, user: 'lena', cmd: '/usr/lib/firefox-esr/firefox-esr', ppid: 1100, cpu: 6.3, mem: 8.1, vsz: 3200000, rss: 1320000, tty: '?', stat: 'Sl', start: '08:21', zeit: '00:01:42' },
  { pid: 2210, user: 'lena', cmd: 'python3 backup.py', ppid: 1203, cpu: 0.4, mem: 0.3, vsz: 31000, rss: 22000, tty: 'pts/0', stat: 'S', start: '08:30' },
  { pid: 2290, user: 'lena', cmd: 'vim bericht.txt', ppid: 1203, cpu: 0.0, mem: 0.1, vsz: 22000, rss: 11000, tty: 'pts/0', stat: 'T', start: '08:33' },
  { pid: 3050, user: 'max', cmd: '-bash', ppid: 3040, cpu: 0.0, mem: 0.0, vsz: 8600, rss: 5100, tty: 'pts/1', stat: 'Ss', start: '08:31' },
  { pid: 3122, user: 'max', cmd: 'make -j8', ppid: 3050, cpu: 38.5, mem: 1.9, vsz: 98000, rss: 310000, tty: 'pts/1', stat: 'R+', start: '08:35', zeit: '00:02:10' },
];

function benutzerBerechnen(w: Welt) {
  for (const n of Object.keys(w.geladen)) w.geladen[n] = [];
  for (const n of Object.keys(w.geladen)) for (const a of w.verfuegbar[n]?.abh ?? []) if (w.geladen[a]) w.geladen[a].push(n);
}

// ---------- Hilfen ----------

function zerlegen(zeile: string): string[] {
  const out: string[] = []; let cur = ''; let q: string | null = null; let hat = false;
  for (let i = 0; i < zeile.length; i++) {
    const c = zeile[i];
    if (q) { if (c === q) q = null; else cur += c; continue; }
    if (c === '"' || c === "'") { q = c; hat = true; continue; }
    if (c === '\\' && i + 1 < zeile.length) { cur += zeile[++i]; hat = true; continue; }
    if (/\s/.test(c)) { if (cur || hat) out.push(cur); cur = ''; hat = false; continue; }
    cur += c;
  }
  if (cur || hat) out.push(cur);
  return out;
}

function aufteilen(zeile: string, zeichen: string): string[] {
  const teile: string[] = []; let cur = ''; let q: string | null = null;
  for (const c of zeile) {
    if (q) { if (c === q) q = null; cur += c; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === zeichen) { teile.push(cur); cur = ''; continue; }
    cur += c;
  }
  teile.push(cur);
  return teile;
}

const norm = (n: string) => n.replace(/-/g, '_');
function pfad(w: Welt, p: string): string {
  if (!p) return w.cwd;
  if (p === '~' || p.startsWith('~/')) p = '/home/lena' + p.slice(1);
  const teile = (p.startsWith('/') ? p : `${w.cwd}/${p}`).split('/');
  const st: string[] = [];
  for (const t of teile) { if (!t || t === '.') continue; if (t === '..') st.pop(); else st.push(t); }
  // merged /usr: /bin/x ist /usr/bin/x
  if (st.length > 1 && (st[0] === 'bin' || st[0] === 'sbin') && w.fs['/' + st[0]] === '-> usr/' + st[0]) st.unshift('usr');
  // Symbolische Links auf Verzeichnisse in der Mitte des Pfades folgen (das letzte Glied bleibt der Link selbst)
  for (let i = 0, runden = 0; i < st.length - 1 && runden < 40; i++) {
    const vor = '/' + st.slice(0, i + 1).join('/'); const c = w.fs[vor];
    if (typeof c === 'string' && c.startsWith('-> ')) { const ziel = c.slice(3); const neu = pfad(w, ziel.startsWith('/') ? ziel : (vor.slice(0, vor.lastIndexOf('/')) || '/') + '/' + ziel); st.splice(0, i + 1, ...neu.split('/').filter(Boolean)); i = -1; runden++; }
  }
  return '/' + st.join('/');
}
const kinder = (w: Welt, dir: string) => Object.keys(w.fs).filter((k) => k !== dir && k.startsWith(dir === '/' ? '/' : dir + '/') && !k.slice(dir === '/' ? 1 : dir.length + 1).includes('/')).map((k) => k.split('/').pop()!).sort();

interface Ergebnis { out: string; code: number; err?: string; ende?: unknown }
const ok = (out = ''): Ergebnis => ({ out, code: 0 });
// Fehlermeldungen gehen auf stderr: Sie landen nicht in Pipes und nicht in „> datei“, wohl aber in „2> datei“.
const fehler = (msg: string, code = 1): Ergebnis => ({ out: '', err: msg || undefined, code });
const KEIN_ROOT = (b: string) => fehler(`${b}: Diese Aktion braucht Root-Rechte. Versuche es mit sudo.`, 1);

function optionen(args: string[]) {
  const flags = new Set<string>(); const rest: string[] = [];
  for (const a of args) {
    if (a.startsWith('--')) flags.add(a);
    else if (a.startsWith('-') && a.length > 1 && !/^-\d/.test(a)) for (const c of a.slice(1)) flags.add('-' + c);
    else rest.push(a);
  }
  return { flags, rest };
}

function blacklist(w: Welt): { schwarz: Set<string>; install: Record<string, string> } {
  const schwarz = new Set<string>(); const install: Record<string, string> = {};
  for (const [p, inhalt] of Object.entries(w.fs)) {
    if (!p.startsWith('/etc/modprobe.d/') || !p.endsWith('.conf') || inhalt == null) continue;
    for (const raw of inhalt.split('\n')) {
      const z = raw.trim(); if (!z || z.startsWith('#')) continue;
      const [k, n, ...r] = z.split(/\s+/);
      if (k === 'blacklist' && n) schwarz.add(norm(n));
      if (k === 'install' && n) install[norm(n)] = r.join(' ');
    }
  }
  return { schwarz, install };
}

// ---------- Befehle ----------

type Befehl = (w: Welt, args: string[], stdin: string, root: boolean) => Ergebnis;

const HILFE = `Dieser Simulator kennt nur einige Befehle. Die wichtigsten:
  ls cd pwd cat head tail grep wc less echo tee uname whoami clear history man
  lspci lsusb lsblk lsmod modinfo modprobe insmod rmmod
  dmesg journalctl systemctl runlevel who telinit init shutdown wall
  ps kill pkill killall sudo exit
Mit den Pfeiltasten holst du frühere Befehle zurück. Pipes (|) und Umleitungen (>, >>) funktionieren.`;

const MAN: Record<string, string> = {
  lspci: 'lspci – PCI-Geräte auflisten\n  -k   Kerneltreiber und mögliche Module je Gerät zeigen\n  -v   ausführlich (-vv, -vvv noch ausführlicher)\n  -nn  Hersteller- und Gerätenummern zusätzlich zu den Namen\n  -s   nur ein Gerät, z. B. -s 00:1f.6\n  -t   als Baum',
  lsusb: 'lsusb – USB-Geräte auflisten\n  -t   als Baum mit Treibern und Geschwindigkeit\n  -v   ausführlich\n  -s   nur Bus:Gerät, z. B. -s 001:003\n  -d   nur Hersteller:Produkt, z. B. -d 0781:5583',
  lsmod: 'lsmod – geladene Kernelmodule anzeigen (liest /proc/modules)\n  Spalten: Module, Size, Used by (Anzahl und benutzende Module)',
  modinfo: 'modinfo – Informationen über ein Kernelmodul\n  -p   nur die Parameter\n  -F feld   nur ein Feld, z. B. -F filename',
  modprobe: 'modprobe – Module laden oder entladen, samt Abhängigkeiten\n  modprobe NAME [param=wert]   laden\n  -r   entladen (auch nicht mehr benötigte Abhängigkeiten)\n  -n   nur so tun (--dry-run), mit -v sieht man, was passieren würde\n  -v   ausführlich\n  --show-depends   Abhängigkeiten zeigen\n  Konfiguration: /etc/modprobe.d/*.conf',
  insmod: 'insmod – ein einzelnes Modul aus einer Datei laden\n  Braucht den vollständigen Pfad zur .ko-Datei und löst keine Abhängigkeiten auf.',
  rmmod: 'rmmod – ein einzelnes Modul entladen\n  Schlägt fehl, wenn das Modul noch benutzt wird. Entlädt keine Abhängigkeiten.',
  dmesg: 'dmesg – den Ringpuffer des Kernels anzeigen\n  -H   lesbar mit Pager und Farben\n  -T   Zeitstempel als Uhrzeit\n  -l   nur bestimmte Stufen, z. B. -l err,warn\n  -w   neue Meldungen weiter anzeigen',
  journalctl: 'journalctl – das systemd-Journal lesen\n  -b      nur der aktuelle Start (-b -1 der vorige)\n  -k      nur Kernelmeldungen (wie dmesg)\n  -p err  nur Meldungen ab Stufe err\n  -u UNIT nur eine Unit\n  --list-boots   alle gespeicherten Starts\n  -r      neueste zuerst\n  -f      laufend mitlesen',
  systemctl: 'systemctl – systemd steuern\n  get-default          Standard-Target zeigen\n  set-default TARGET   Standard-Target setzen\n  isolate TARGET       jetzt in ein Target wechseln\n  list-units --type=target   aktive Targets\n  rescue | emergency | default\n  poweroff | reboot | halt',
  shutdown: 'shutdown [OPTIONEN] [ZEIT] [NACHRICHT]\n  -h, -P  ausschalten (Standard)\n  -H      anhalten (halt)\n  -r      neu starten\n  -k      nur Nachricht schicken, nicht herunterfahren\n  -c      geplanten Shutdown abbrechen\n  --show  geplanten Shutdown zeigen\n  ZEIT: now, +MINUTEN oder hh:mm. Ohne Zeit gilt +1.',
  wall: 'wall NACHRICHT – Nachricht an alle angemeldeten Benutzer',
  telinit: 'telinit N – in Runlevel N wechseln (unter systemd übersetzt in ein Target)',
  runlevel: 'runlevel – vorigen und aktuellen Runlevel zeigen (N = keiner)',
  kill: 'kill [-SIGNAL] PID – Signal an Prozess schicken\n  Standard: 15 (SIGTERM, bitte beenden)\n  -9 (SIGKILL, sofort beenden, nicht abfangbar)\n  -1 (SIGHUP), -2 (SIGINT)\n  -l  Signale auflisten',
  lsblk: 'lsblk – Blockgeräte als Baum',
};

const befehle: Record<string, Befehl> = {
  help: (_w, a) => {
    if (!a[0]) return ok(HILFE);
    const kurz: Record<string, string> = { cd: 'cd [-L|[-P [-e]] [-@]] [Verzeichnis]\n    Wechselt das Arbeitsverzeichnis. Ohne Argument nach $HOME, mit - zurück nach $OLDPWD.', export: 'export [-fn] [Name[=Wert] ...] oder export -p\n    Markiert Variablen für die Weitergabe an Kindprozesse.', history: 'history [-c] [-d Offset] [n] oder history -anrw [Datei]\n    Zeigt den Verlauf. -c löscht ihn, -w schreibt ihn in die Datei, -a hängt neue Einträge an.', type: 'type [-afptP] Name [Name ...]\n    Zeigt, wie ein Name interpretiert würde: Alias, Schlüsselwort, Funktion, eingebaut oder Datei.', jobs: 'jobs [-lnprs] [Jobbezeichnung ...]\n    Zeigt die Jobs dieser Shell.', alias: 'alias [-p] [Name[=Wert] ... ]\n    Definiert oder zeigt Aliase.', umask: 'umask [-p] [-S] [Modus]\n    Zeigt oder setzt die Maske für neue Dateien.' };
    if (kurz[a[0]]) return ok(`${a[0]}: ${kurz[a[0]]}\n(Gekürzt im Simulator.)`);
    if (EINGEBAUT[a[0]]) return ok(`${a[0]} ist in die Bash eingebaut. (Ausführliche Hilfe gibt es im Simulator nicht.)`);
    return fehler(`bash: help: Kein passendes Hilfethema für »${a[0]}«. Probieren Sie »help help«, »man -k ${a[0]}« oder »info ${a[0]}«.`);
  },
  hilfe: () => ok(HILFE),
  clear: () => ok('\u001bclear'),
  whoami: (w, _a, _i, root) => ok(root ? 'root' : w.user),
  id: (w, a, _i, root) => {
    const r = root || w.root; const opt = a.filter((x) => x.startsWith('-')).join('').replace(/-/g, '');
    if (opt.includes('u')) return ok(opt.includes('n') ? (r ? 'root' : 'lena') : r ? '0' : '1000');
    if (opt.includes('g')) return ok(opt.includes('n') ? (r ? 'root' : 'lena') : r ? '0' : '1000');
    if (opt.includes('G')) return ok(opt.includes('n') ? (r ? 'root' : 'lena cdrom sudo plugdev users') : r ? '0' : '1000 24 27 46 100');
    return ok(r ? 'uid=0(root) gid=0(root) Gruppen=0(root)' : 'uid=1000(lena) gid=1000(lena) Gruppen=1000(lena),24(cdrom),27(sudo),46(plugdev),100(users)');
  },
  hostname: (w) => ok(w.host),
  pwd: (w) => ok(w.cwd),
  groups: (_w, a, _i, root) => ok(a[0] && a[0] !== 'lena' ? `${a[0]} : ${a[0]}` : root ? 'root' : 'lena cdrom sudo plugdev users'),
  history: (w) => ok(w.verlauf.map((v, i) => `${String(i + 1).padStart(5)}  ${v.zeile}`).join('\n')),
  echo: (_w, a) => ok(a.filter((x) => x !== '-e').join(' ')),
  man: (_w, a) => {
    if (a[0] === '-k') { const t = apropos(a[1] ?? ''); return t.length ? ok(t.join('\n')) : fehler(`${a[1] ?? ''}: nichts Passendes.`, 16); }
    if (a[0] === '-f') { const t = whatis(a[1] ?? ''); return t.length ? ok(t.join('\n')) : fehler(`${a[1] ?? ''}: nichts Passendes.`, 16); }
    const sek = /^\d$/.test(a[0] ?? '') ? Number(a[0]) : undefined;
    const name = sek ? a[1] : a[0];
    if (!name) return fehler('Welche Handbuchseiten möchten Sie haben?\nZum Beispiel: »man man«.', 1);
    const seiten = SEITEN[name] ?? [];
    const seite = sek ? seiten.find((x) => x.sek === sek) : seiten[0];
    const alt = !seite && !sek && MAN[name] ? MAN[name] : null;
    if (!seite && !alt) return fehler(sek ? `Kein Handbucheintrag für ${name} im Abschnitt ${sek} vorhanden` : `Kein Handbucheintrag für ${name} vorhanden${EINGEBAUT_OHNE_SEITE.has(name) ? `\n(${name} ist in die Bash eingebaut. Die Hilfe dazu zeigt „help ${name}“ oder „man bash“.)` : ''}`, 16);
    const k = seite ? seite.sek : 1; const kopf = `${name.toUpperCase()}(${k})`;
    const titel = ({ 1: 'User Commands', 5: 'File Formats Manual', 7: 'Miscellaneous Information Manual', 8: 'System Administration' } as Record<number, string>)[k] ?? '';
    return ok(`${kopf}${' '.repeat(10)}${titel}${' '.repeat(10)}${kopf}\n\nNAME\n       ${name} - ${seite?.kurz ?? ''}\n\nKURZHILFE DES SIMULATORS\n       ${(seite?.text ?? alt ?? '').split('\n').join('\n       ')}\n\n(Gekürzt. Auf deinem Labor-System zeigt „man ${sek ? sek + ' ' : ''}${name}“ die vollständige Seite. q beendet dort die Anzeige.)`);
  },
  whatis: (_w, a) => { const t = a.flatMap((n) => whatis(n)); return t.length ? ok(t.join('\n')) : fehler(`${a[0] ?? ''}: nichts Passendes.`, 16); },
  apropos: (_w, a) => { const t = apropos(a[0] ?? ''); return t.length ? ok(t.join('\n')) : fehler(`${a[0] ?? ''}: nichts Passendes.`, 16); },
  uname: (w, a) => {
    const { flags } = optionen(a);
    if (flags.has('-a')) return ok(`Linux ${w.host} ${w.kernel} #1 SMP PREEMPT_DYNAMIC Debian 6.1.115-1 (2024-11-01) x86_64 GNU/Linux`);
    const t: string[] = [];
    if (flags.has('-s') || !flags.size) t.push('Linux');
    if (flags.has('-n')) t.push(w.host);
    if (flags.has('-r')) t.push(w.kernel);
    if (flags.has('-m')) t.push('x86_64');
    return ok(t.join(' '));
  },
  cd: (w, a) => {
    const z = pfad(w, a[0] ?? '~');
    if (!(z in w.fs)) return fehler(`bash: cd: ${a[0]}: Datei oder Verzeichnis nicht gefunden`);
    if (w.fs[z] !== null) return fehler(`bash: cd: ${a[0]}: Ist kein Verzeichnis`);
    w.cwd = z; return ok();
  },
  ls: (w, a) => {
    const { flags, rest } = optionen(a);
    const ziele = rest.length ? rest : ['.'];
    const out: string[] = [];
    for (const r of ziele) {
      const z = pfad(w, r);
      if (!(z in w.fs)) { out.push(`ls: Zugriff auf '${r}' nicht möglich: Datei oder Verzeichnis nicht gefunden`); continue; }
      if (w.fs[z] !== null) {
        const c = w.fs[z] as string; const link = c.startsWith('-> ');
        out.push(flags.has('-l') ? `${link ? 'l' : '-'}rw${link ? 'xrwx' : '-r--'}r${link ? 'wx' : '--'} 1 root root ${String(link ? c.length - 3 : c.length).padStart(6)} Nov 23 08:12 ${r}${link ? ' ' + c : ''}` : r);
        continue;
      }
      const k = kinder(w, z);
      if (ziele.length > 1) out.push(`${r}:`);
      if (flags.has('-l')) for (const n of k) { const full = z === '/' ? `/${n}` : `${z}/${n}`; const c = w.fs[full]; const link = typeof c === 'string' && c.startsWith('-> '); out.push(`${c === null ? 'd' : link ? 'l' : '-'}rw-r--r-- 1 root root ${String(c?.length ?? 4096).padStart(6)} Nov 23 08:12 ${n}${link ? ' ' + c : ''}`); }
      else out.push(k.join('  '));
    }
    return ok(out.join('\n'));
  },
  cat: (w, a, stdin) => {
    if (!a.length) return ok(stdin);
    const out: string[] = [];
    for (const r of a) {
      const z = pfad(w, r);
      if (z === '/proc/modules') { out.push(Object.keys(w.geladen).map((n) => `${n} ${w.verfuegbar[n].groesse} ${w.geladen[n].length + (w.inBenutzung[n] ?? 0)} ${w.geladen[n].join(',') || '-'}, Live 0x0000000000000000`).join('\n')); continue; }
      if (!(z in w.fs)) return fehler(`cat: ${r}: Datei oder Verzeichnis nicht gefunden`);
      if (w.fs[z] === null) return fehler(`cat: ${r}: Ist ein Verzeichnis`);
      let inhalt = w.fs[z] as string;
      if (inhalt.startsWith('-> ')) { const ziel = inhalt.slice(3); inhalt = (w.fs[ziel] ?? `cat: ${r}: Datei oder Verzeichnis nicht gefunden`) as string; }
      out.push(inhalt.replace(/\n$/, ''));
    }
    return ok(out.join('\n'));
  },
  head: (w, a, stdin) => zeilenSchnitt(w, a, stdin, 'head'),
  tail: (w, a, stdin) => zeilenSchnitt(w, a, stdin, 'tail'),
  wc: (w, a, stdin) => {
    const { flags, rest } = optionen(a);
    const t = rest.length ? (w.fs[pfad(w, rest[0])] ?? '') : stdin;
    const zeilen = t ? t.replace(/\n$/, '').split('\n').length : 0;
    return ok(flags.has('-l') ? String(zeilen) : `${zeilen} ${t.split(/\s+/).filter(Boolean).length} ${t.length}`);
  },
  grep: (w, a, stdin) => {
    const { flags, rest } = optionen(a.filter((x) => x !== '--color=auto'));
    const [muster, datei] = rest;
    if (muster === undefined) return fehler('Aufruf: grep [OPTION]… MUSTER [DATEI]…', 2);
    const text = datei ? w.fs[pfad(w, datei)] : stdin;
    if (datei && (text === undefined || text === null)) return fehler(`grep: ${datei}: Datei oder Verzeichnis nicht gefunden`, 2);
    let re: RegExp;
    try { re = new RegExp(flags.has('-E') ? muster : muster.replace(/\\\|/g, '|'), flags.has('-i') ? 'i' : ''); } catch { return fehler('grep: ungültiger regulärer Ausdruck', 2); }
    const zeilen = (text ?? '').split('\n').filter((z) => z !== '' && (re.test(z) !== flags.has('-v')));
    if (flags.has('-c')) return { out: String(zeilen.length), code: zeilen.length ? 0 : 1 };
    return { out: zeilen.join('\n'), code: zeilen.length ? 0 : 1 };
  },
  less: (w, a, stdin) => befehle.cat(w, a, stdin, false),
  more: (w, a, stdin) => befehle.cat(w, a, stdin, false),
  tee: (w, a, stdin, root) => {
    const { flags, rest } = optionen(a);
    for (const r of rest) { const e = schreiben(w, r, stdin, flags.has('-a'), root); if (e) return fehler(`tee: ${r}: ${e}`); }
    return ok(stdin.replace(/\n$/, ''));
  },
  lspci: (_w, a) => {
    const { flags, rest } = optionen(a);
    let liste = PCI;
    const si = a.indexOf('-s');
    if (si >= 0) { const s = a[si + 1] ?? ''; liste = PCI.filter((p) => p.slot === s || p.slot.endsWith(s)); }
    if (flags.has('-t')) return ok('-[0000:00]-+-00.0\n           +-02.0\n           +-14.0\n           +-17.0\n           +-1b.0-[01]----00.0\n           +-1c.0-[02]----00.0\n           +-1f.3\n           \\-1f.6');
    void rest;
    return ok(liste.map((p) => {
      const rev = p.name.match(/ \(rev.*\)$/)?.[0] ?? '';
      const klassenNr = p.ids.match(/^\[(\w{4})\]/)![1];
      const idPaar = p.ids.match(/\[(\w{4}:\w{4})\]/)![1];
      let z = `${p.slot} ${p.klasse}: ${p.name}`;
      if (a.some((x) => /^-[a-z]*n/.test(x))) z = `${p.slot} ${klassenNr}: ${idPaar}${rev}`;
      if (a.some((x) => /^-[a-z]*nn/.test(x))) z = `${p.slot} ${p.klasse} [${klassenNr}]: ${p.name.replace(/ \(rev.*\)$/, '')} [${idPaar}]${rev}`;
      if (flags.has('-v')) z += `\n\tSubsystem: ${p.name.split(' ')[0]} ${p.name.split(' ')[1]}\n\tFlags: bus master, fast devsel, latency 0\n\tMemory at d1${p.slot.replace(/\W/g, '')}0000 (64-bit, non-prefetchable)`;
      if (flags.has('-k') || flags.has('-v')) { z += `\n\tKernel driver in use: ${p.treiber}`; if (p.module.length) z += `\n\tKernel modules: ${p.module.join(', ')}`; }
      return z;
    }).join(flags.has('-v') ? '\n\n' : '\n'));
  },
  lsusb: (_w, a) => {
    const { flags } = optionen(a);
    if (flags.has('-t')) return ok(`/:  Bus 02.Port 1: Dev 1, Class=root_hub, Driver=xhci_hcd/10p, 10000M
/:  Bus 01.Port 1: Dev 1, Class=root_hub, Driver=xhci_hcd/16p, 480M
    |__ Port 2: Dev 2, If 0, Class=Human Interface Device, Driver=usbhid, 12M
    |__ Port 3: Dev 3, If 0, Class=Mass Storage, Driver=usb-storage, 480M
    |__ Port 4: Dev 4, If 0, Class=Video, Driver=uvcvideo, 480M
    |__ Port 4: Dev 4, If 1, Class=Video, Driver=uvcvideo, 480M
    |__ Port 5: Dev 5, If 0, Class=Wireless, Driver=btusb, 12M`);
    let liste = USB;
    const si = a.indexOf('-s'); if (si >= 0) { const [b, d] = (a[si + 1] ?? '').split(':'); liste = liste.filter((u) => (!b || u.bus === b.padStart(3, '0')) && (!d || u.dev === d.padStart(3, '0'))); }
    const di = a.indexOf('-d'); if (di >= 0) liste = liste.filter((u) => u.id.startsWith(a[di + 1] ?? ''));
    return ok(liste.map((u) => `Bus ${u.bus} Device ${u.dev}: ID ${u.id} ${u.name}${flags.has('-v') ? `\n  bDeviceClass ${u.name.includes('hub') ? '9 Hub' : '0 [unknown]'}\n  idVendor 0x${u.id.split(':')[0]}\n  idProduct 0x${u.id.split(':')[1]}` : ''}`).join('\n'));
  },
  lsblk: () => ok(`NAME        MAJ:MIN RM   SIZE RO TYPE MOUNTPOINTS
sda           8:0    1  28,6G  0 disk
└─sda1        8:1    1  28,6G  0 part /media/lena/STICK
sr0          11:0    1  1024M  0 rom
nvme0n1     259:0    0 476,9G  0 disk
├─nvme0n1p1 259:1    0   512M  0 part /boot/efi
├─nvme0n1p2 259:2    0 474,5G  0 part /
└─nvme0n1p3 259:3    0   1,9G  0 part [SWAP]`),
  lsmod: (w) => ok('Module                  Size  Used by\n' + Object.keys(w.geladen).map((n) => {
    const u = w.geladen[n]; const anz = u.length + (w.inBenutzung[n] ?? 0);
    return `${n.padEnd(24)}${String(w.verfuegbar[n].groesse).padStart(7)}  ${anz}${u.length ? ' ' + u.join(',') : ''}`;
  }).join('\n')),
  modinfo: (w, a) => {
    const { flags, rest } = optionen(a);
    const fi = a.indexOf('-F');
    const name = norm(fi >= 0 ? a.filter((_, i) => i !== fi && i !== fi + 1).filter((x) => !x.startsWith('-'))[0] ?? '' : rest[0] ?? '');
    const mod = w.verfuegbar[name];
    if (!mod) return fehler(`modinfo: ERROR: Module ${rest[0] ?? ''} not found.`);
    const datei = `/lib/modules/${w.kernel}/${modulPfad(name)}`;
    if (fi >= 0) { const f = a[fi + 1]; return ok(f === 'filename' ? datei : f === 'depends' ? mod.abh.join(',') : f === 'description' ? mod.beschreibung : ''); }
    const parm = Object.entries(mod.parameter ?? {}).map(([k, v]) => `parm:           ${k}:${v}`);
    if (flags.has('-p')) return ok(Object.entries(mod.parameter ?? {}).map(([k, v]) => `${k}:${v}`).join('\n'));
    return ok([`filename:       ${datei}`, `description:    ${mod.beschreibung}`, 'license:        GPL', `depends:        ${mod.abh.join(',')}`, 'intree:         Y', `name:           ${name}`, `vermagic:       ${w.kernel} SMP preempt mod_unload modversions`, ...parm].join('\n'));
  },
  modprobe: (w, a, _i, root) => {
    const { flags, rest } = optionen(a);
    const name = norm(rest[0] ?? '');
    if (flags.has('-c')) return ok(Object.entries(w.fs).filter(([p, c]) => p.startsWith('/etc/modprobe.d/') && c).map(([, c]) => c!.split('\n').filter((z) => z && !z.startsWith('#')).join('\n')).join('\n'));
    if (!name) return fehler('modprobe: ERROR: missing module name.');
    const mod = w.verfuegbar[name];
    if (!mod) return fehler(`modprobe: FATAL: Module ${rest[0]} not found in directory /lib/modules/${w.kernel}`);
    const trocken = flags.has('-n') || flags.has('--dry-run') || flags.has('--show');
    if (flags.has('--show-depends')) return ok(alleAbh(w, name).reverse().map((n) => `insmod /lib/modules/${w.kernel}/${modulPfad(n)}`).join('\n'));
    if (flags.has('-r') || flags.has('--remove')) {
      if (!w.geladen[name]) return ok(flags.has('-v') ? '' : '');
      const benutzt = w.geladen[name].length + (w.inBenutzung[name] ?? 0);
      if (benutzt) return fehler(`modprobe: FATAL: Module ${name} is in use.`);
      if (!root && !trocken) return fehler(`modprobe: ERROR: could not remove module ${name}: Operation not permitted`);
      const weg = [name];
      if (!trocken) { delete w.geladen[name]; benutzerBerechnen(w); }
      for (const d of mod.abh) {
        if (w.geladen[d] && w.geladen[d].length === 0 && !(w.inBenutzung[d] ?? 0)) { weg.push(d); if (!trocken) { delete w.geladen[d]; benutzerBerechnen(w); } }
      }
      return ok(flags.has('-v') ? weg.map((n) => `rmmod ${n}`).join('\n') : '');
    }
    const { install } = blacklist(w);
    if (install[name] && !flags.has('-i')) {
      if (/\/bin\/(false|true)/.test(install[name])) {
        if (!root && !trocken) return fehler(`modprobe: ERROR: could not insert '${name}': Operation not permitted`);
        return install[name].includes('false') ? fehler(`modprobe: ERROR: Error running install command '${install[name]}' for module ${name}: retcode 1\nmodprobe: ERROR: could not insert '${name}': Invalid argument`) : ok(flags.has('-v') ? `install ${install[name]}` : '');
      }
    }
    if (w.geladen[name]) return ok(flags.has('-v') ? '' : '');
    if (!root && !trocken) return fehler(`modprobe: ERROR: could not insert '${name}': Operation not permitted`);
    const neu = alleAbh(w, name).reverse().filter((n) => !w.geladen[n]);
    if (!trocken) { for (const n of neu) w.geladen[n] = []; benutzerBerechnen(w); }
    return ok(flags.has('-v') ? neu.map((n) => `insmod /lib/modules/${w.kernel}/${modulPfad(n)}${n === name && rest.length > 1 ? ' ' + rest.slice(1).join(' ') : ''}`).join('\n') : '');
  },
  insmod: (w, a, _i, root) => {
    const p = a[0] ?? '';
    if (!p) return fehler('insmod: ERROR: missing filename.');
    if (!p.includes('/') || !p.endsWith('.ko')) return fehler(`insmod: ERROR: could not load module ${p}: No such file or directory`);
    const datei = pfad(w, p);
    if (!(datei in w.fs)) return fehler(`insmod: ERROR: could not load module ${p}: No such file or directory`);
    const name = norm(datei.split('/').pop()!.replace(/\.ko$/, ''));
    if (!root) return fehler(`insmod: ERROR: could not insert module ${p}: Operation not permitted`);
    if (w.geladen[name]) return fehler(`insmod: ERROR: could not insert module ${p}: File exists`);
    const fehlt = w.verfuegbar[name].abh.filter((d) => !w.geladen[d]);
    if (fehlt.length) return fehler(`insmod: ERROR: could not insert module ${p}: Unknown symbol in module`);
    w.geladen[name] = []; benutzerBerechnen(w); return ok();
  },
  rmmod: (w, a, _i, root) => {
    const name = norm(a.filter((x) => !x.startsWith('-'))[0] ?? '');
    if (!name) return fehler('rmmod: ERROR: missing module name.');
    if (!w.geladen[name]) return fehler(`rmmod: ERROR: Module ${name} is not currently loaded`);
    if (!root) return fehler(`rmmod: ERROR: could not remove module ${name}: Operation not permitted`);
    const u = w.geladen[name];
    if (u.length || w.inBenutzung[name]) return fehler(`rmmod: ERROR: Module ${name} is in use${u.length ? ' by: ' + u.join(' ') : ''}`);
    delete w.geladen[name]; benutzerBerechnen(w); return ok();
  },
  dmesg: (w, a, _i, root) => {
    const { flags } = optionen(a);
    // Debian und viele andere Distributionen setzen kernel.dmesg_restrict=1: Nur root darf den Ringpuffer lesen.
    if (!root) return fehler('dmesg: read kernel buffer failed: Operation not permitted');
    if (flags.has('-C') || flags.has('-c')) return ok();
    let t = DMESG;
    const li = a.findIndex((x) => x === '-l' || x.startsWith('--level'));
    if (li >= 0) { const st = (a[li].includes('=') ? a[li].split('=')[1] : a[li + 1]) ?? ''; t = t.split('\n').filter((z) => (/err|warn/.test(st) && /Can't find|not properly|link down/.test(z))).join('\n'); }
    if (flags.has('-T')) t = t.replace(/^\[\s*(\d+)\.\d+\]/gm, (_m, s) => `[Mo Nov 23 08:12:${String(1 + Number(s)).padStart(2, '0')} 2026]`);
    return ok(t);
  },
  journalctl: (_w, a) => {
    const { flags } = optionen(a);
    if (flags.has('--list-boots')) return ok('IDX BOOT ID                          FIRST ENTRY                 LAST ENTRY\n -1 9a3e1f0c2b7d4e58a1c6f3b2d9e04a71 Sun 2026-11-22 18:03:44 CET Sun 2026-11-22 22:41:19 CET\n  0 4c2d8b1e7f9a4b03b5e2c1d6a8f7e9b0 Mon 2026-11-23 08:12:01 CET Mon 2026-11-23 08:15:42 CET');
    const bi = a.findIndex((x) => x === '-b' || x === '--boot');
    const vorher = bi >= 0 && a[bi + 1] === '-1';
    let t = vorher ? JOURNAL_VORHER : JOURNAL_JETZT;
    if (flags.has('-k') || a.includes('--dmesg')) t = t.split('\n').filter((z) => z.includes(' kernel: ')).join('\n');
    const pi = a.findIndex((x) => x === '-p' || x.startsWith('--priority'));
    if (pi >= 0) t = t.split('\n').filter((z) => /Failed|not properly/.test(z)).join('\n');
    const ui = a.findIndex((x) => x === '-u' || x.startsWith('--unit'));
    if (ui >= 0) { const u = (a[ui].includes('=') ? a[ui].split('=')[1] : a[ui + 1]) ?? ''; t = t.split('\n').filter((z) => z.includes(u.replace(/\.service$/, ''))).join('\n') || '-- No entries --'; }
    if (flags.has('-r')) t = t.split('\n').reverse().join('\n');
    return ok(t);
  },
  systemctl: (w, a, _i, root) => {
    const [cmd, arg] = a.filter((x) => !x.startsWith('--') || x.startsWith('--type'));
    const tgt = (x?: string) => (x ? (x.includes('.') ? x : `${x}.target`) : '');
    switch (cmd) {
      case 'get-default': return ok(w.defaultTarget);
      case 'set-default': {
        const t = tgt(arg);
        if (!t) return fehler('Too few arguments.');
        if (!TARGETS[t] && !/^runlevel\d\.target$/.test(t)) return fehler(`Failed to set default target: Unit file ${t} does not exist.`);
        if (!root) return fehler('Failed to set default target: Access denied');
        const echt = /^runlevel(\d)\.target$/.test(t) ? RUNLEVEL_ZU_TARGET[t[8]] : t;
        const alt = w.defaultTarget; w.defaultTarget = echt;
        w.fs['/etc/systemd/system/default.target'] = `-> /usr/lib/systemd/system/${echt}`;
        return ok(`Removed "/etc/systemd/system/default.target".\nCreated symlink /etc/systemd/system/default.target → /usr/lib/systemd/system/${echt}.${alt === echt ? '' : ''}`);
      }
      case 'isolate': {
        const t = tgt(arg);
        if (!TARGETS[t] && !/^runlevel\d\.target$/.test(t) && t !== 'default.target') return fehler(`Failed to start ${t}: Unit ${t} not found.`);
        if (!root) return fehler(`Failed to start ${t}: Access denied`);
        return zuTarget(w, t === 'default.target' ? w.defaultTarget : /^runlevel(\d)\.target$/.test(t) ? RUNLEVEL_ZU_TARGET[t[8]] : t);
      }
      case 'rescue': case 'emergency': case 'default':
        if (!root) return fehler(`Failed to start ${cmd}.target: Access denied`);
        return zuTarget(w, cmd === 'default' ? w.defaultTarget : `${cmd}.target`);
      case 'poweroff': case 'reboot': case 'halt':
        if (!root) return fehler(`Call to ${cmd[0].toUpperCase() + cmd.slice(1)} failed: Access denied`);
        w.walls.push(`The system will ${cmd === 'reboot' ? 'reboot' : cmd === 'halt' ? 'halt' : 'power off'} now!`);
        w.aus = cmd; return ok(`Broadcast message from root@${w.host} on pts/0:\n\nThe system will ${cmd === 'reboot' ? 'reboot' : cmd === 'halt' ? 'halt' : 'power off'} now!`);
      case 'list-units': {
        const aktiv = ['basic.target', 'local-fs.target', 'network.target', 'sysinit.target', 'timers.target', ...(['multi-user.target', 'graphical.target'].includes(w.target) ? ['multi-user.target'] : []), ...(w.target === 'graphical.target' ? ['graphical.target'] : []), ...(w.target === 'rescue.target' ? ['rescue.target'] : [])].sort();
        return ok('  UNIT                   LOAD   ACTIVE SUB    DESCRIPTION\n' + aktiv.map((u) => `  ${u.padEnd(22)} loaded active active ${TARGETS[u] ?? u.replace('.target', '')}`).join('\n') + `\n\n${aktiv.length} loaded units listed.`);
      }
      case 'status': return ok(arg ? `● ${arg}\n     Loaded: loaded\n     Active: active (running)` : `● ${w.host}\n    State: running\n    Units: 312 loaded (incl. loaded aliases)`);
      default: return fehler(`Unknown command verb '${cmd ?? ''}'. (Der Simulator kennt nur einige systemctl-Befehle, siehe "man systemctl".)`);
    }
  },
  runlevel: (w) => ok(`${w.runlevelVorher} ${TARGET_ZU_RUNLEVEL[w.target] ?? 'unknown'}`),
  who: (w, a) => a.includes('-r') ? ok(`         run-level ${TARGET_ZU_RUNLEVEL[w.target] ?? '?'}  2026-11-23 08:12`) : ok('lena     tty2         2026-11-23 08:13 (tty2)\nlena     pts/0        2026-11-23 08:20 (:0)\nmax      pts/1        2026-11-23 08:31 (192.168.1.23)'),
  telinit: (w, a, _i, root) => {
    const n = a[0];
    if (!n || !RUNLEVEL_ZU_TARGET[n]) return fehler('telinit: Unbekannter Runlevel. Erlaubt: 0 1 2 3 4 5 6 S');
    if (!root) return fehler('Failed to change runlevel: Access denied');
    return zuTarget(w, RUNLEVEL_ZU_TARGET[n]);
  },
  init: (w, a, i, root) => befehle.telinit(w, a, i, root),
  shutdown: (w, a, _i, root) => {
    const { flags, rest } = optionen(a);
    if (flags.has('--show')) return w.shutdown ? ok(`${w.shutdown.art === 'reboot' ? 'Reboot' : 'Shutdown'} scheduled for ${w.shutdown.zeit}, use 'shutdown -c' to cancel.`) : fehler('No scheduled shutdown.');
    if (!root) return fehler('Failed to set wall message, ignoring: Access denied\nCall to ScheduleShutdown failed: Access denied');
    if (flags.has('-c')) { if (!w.shutdown) return ok(); w.shutdown = null; w.walls.push('The system shutdown has been cancelled'); return ok(`Broadcast message from root@${w.host} on pts/0:\n\nThe system shutdown has been cancelled`); }
    const zeit = rest[0] ?? '+1';
    if (!/^(now|\+\d+|\d{1,2}:\d{2})$/.test(zeit)) return fehler(`Failed to parse time specification: ${zeit}`);
    const text = rest.slice(1).join(' ');
    if (flags.has('-k')) { w.walls.push(text || 'The system will power off (nur Warnung mit -k)'); return ok(`Broadcast message from root@${w.host} on pts/0:\n\n${text || 'The system will power off!'}`); }
    const art = flags.has('-r') ? 'reboot' : flags.has('-H') && !flags.has('-h') ? 'halt' : 'poweroff';
    if (zeit === 'now' || zeit === '+0') { w.aus = art; w.walls.push(text || `The system will ${art === 'reboot' ? 'reboot' : 'power off'} now!`); return ok(`Broadcast message from root@${w.host} on pts/0:\n\nThe system will ${art === 'reboot' ? 'reboot' : art === 'halt' ? 'halt' : 'power off'} now!`); }
    const uhr = zeit.startsWith('+') ? `Mon 2026-11-23 ${minPlus(Number(zeit.slice(1)))} CET` : `Mon 2026-11-23 ${zeit.padStart(5, '0')}:00 CET`;
    w.shutdown = { art, zeit: uhr, text };
    w.walls.push(text || `The system will ${art === 'reboot' ? 'reboot' : 'power off'} at ${uhr}!`);
    return ok(`${art === 'reboot' ? 'Reboot' : 'Shutdown'} scheduled for ${uhr}, use 'shutdown -c' to cancel.`);
  },
  poweroff: (w, a, i, root) => befehle.systemctl(w, ['poweroff'], i, root),
  reboot: (w, a, i, root) => befehle.systemctl(w, ['reboot'], i, root),
  halt: (w, a, i, root) => befehle.systemctl(w, ['halt'], i, root),
  wall: (w, a, stdin) => {
    const text = a.length ? a.join(' ') : stdin;
    if (!text) return fehler('wall: keine Nachricht');
    w.walls.push(text);
    return ok(`Broadcast message from ${w.root ? 'root' : 'lena'}@${w.host} (pts/0) (Mon Nov 23 08:40:12 2026):\n\n${text}`);
  },
  ps: (w, a) => {
    const lang = a.some((x) => /aux|-ef|-e/.test(x));
    const liste = lang ? w.prozesse : w.prozesse.filter((p) => p.user === 'lena');
    return ok((lang ? 'USER         PID COMMAND\n' : '    PID TTY          TIME CMD\n') + liste.map((p) => lang ? `${p.user.padEnd(8)} ${String(p.pid).padStart(7)} ${p.cmd}` : `${String(p.pid).padStart(7)} pts/0    00:00:00 ${p.cmd.split(' ')[0].replace(/^-/, '')}`).join('\n'));
  },
  pgrep: (w, a) => { const r = w.prozesse.filter((p) => p.cmd.includes(a[a.length - 1] ?? '')); return { out: r.map((p) => String(p.pid)).join('\n'), code: r.length ? 0 : 1 }; },
  kill: (w, a, _i, root) => {
    if (a[0] === '-l' || a[0] === '-L') return ok(' 1) SIGHUP\t 2) SIGINT\t 3) SIGQUIT\t 4) SIGILL\t 5) SIGTRAP\n 6) SIGABRT\t 7) SIGBUS\t 8) SIGFPE\t 9) SIGKILL\t10) SIGUSR1\n11) SIGSEGV\t12) SIGUSR2\t13) SIGPIPE\t14) SIGALRM\t15) SIGTERM\n16) SIGSTKFLT\t17) SIGCHLD\t18) SIGCONT\t19) SIGSTOP\t20) SIGTSTP\n(gekürzt, es folgen weitere bis 64)');
    let sig = 15; const pids: number[] = [];
    for (const x of a) {
      const m = x.match(/^-(?:s\s*)?(?:SIG)?(\w+)$/i);
      if (m) { const n = m[1].toUpperCase(); sig = /^\d+$/.test(n) ? Number(n) : ({ HUP: 1, INT: 2, QUIT: 3, KILL: 9, USR1: 10, USR2: 12, TERM: 15, CONT: 18, STOP: 19, TSTP: 20 } as Record<string, number>)[n] ?? -1; if (sig < 0) return fehler(`bash: kill: ${m[1]}: Ungültige Signalbezeichnung.`); }
      else if (/^\d+$/.test(x)) pids.push(Number(x));
    }
    if (!pids.length) return fehler('kill: Aufruf: kill [-s SIGNAL | -SIGNAL] PID …', 2);
    const out: string[] = [];
    for (const pid of pids) out.push(signal(w, pid, sig, root));
    const f = out.filter(Boolean);
    return f.length ? fehler(f.join('\n')) : ok();
  },
  pkill: (w, a, _i, root) => pkillKern(w, a, root, 'pkill'),
  killall: (w, a, _i, root) => pkillKern(w, a, root, 'killall'),
};

// pkill sucht im Namen (Teilstring, regulärer Ausdruck), killall nur nach dem genauen Namen
function pkillKern(w: Welt, a: string[], root: boolean, art: 'pkill' | 'killall'): Ergebnis {
  let sig = 15; let user: string | undefined; const rest: string[] = [];
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    if (x === '-u') { user = a[++i]; continue; }
    if (x === '-s' || x === '--signal') { sig = signalZahl(a[++i] ?? 'TERM'); continue; }
    const m = x.match(/^-(?:SIG)?(\w+)$/i);
    if (m) { sig = signalZahl(m[1]); continue; }
    rest.push(x);
  }
  const name = rest[0];
  const prozName = (p: Prozess) => { if (p.cmd.startsWith('[')) return p.cmd.slice(1, -1); const t = p.cmd.split(' '); if (/^\/(usr\/)?bin\/(ba)?sh$/.test(t[0]) && t[1] && !t[1].startsWith('-')) return t[1].split('/').pop()!; return t[0].split('/').pop()!.replace(/^-/, ''); };
  const ziele = w.prozesse.filter((p) => p.pid !== 1203 && (!user || p.user === user) && (!name || (art === 'killall' ? prozName(p) === name : new RegExp(name).test(prozName(p)))));
  if (!name && !user) return fehler(art === 'pkill' ? 'pkill: kein Abgleichkriterium angegeben\nGeben Sie »pkill --help« ein, um weitere Informationen zu erhalten.' : 'Aufruf: killall [OPTION]... [--] NAME...', 2);
  if (!ziele.length) return art === 'killall' ? fehler(`${name}: Kein Prozess gefunden`) : { out: '', code: 1 };
  const err: string[] = []; let geschafft = 0;
  for (const p of ziele) { const e = signal(w, p.pid, sig, root); if (e) err.push(art === 'pkill' ? `pkill: Abwürgen von Prozess-ID ${p.pid} fehlgeschlagen: Vorgang nicht zulässig` : `${prozName(p)}(${p.pid}): Vorgang nicht zulässig`); else geschafft++; }
  return { out: '', err: err.join('\n') || undefined, code: geschafft ? 0 : 1 };
}
function signalZahl(s: string) { const n = s.toUpperCase().replace(/^SIG/, ''); return /^\d+$/.test(n) ? Number(n) : ({ HUP: 1, INT: 2, QUIT: 3, KILL: 9, USR1: 10, USR2: 12, TERM: 15, CONT: 18, STOP: 19, TSTP: 20 } as Record<string, number>)[n] ?? 15; }

function signal(w: Welt, pid: number, sig: number, root: boolean): string {
  const p = w.prozesse.find((x) => x.pid === pid);
  if (!p) return `bash: kill: (${pid}) - Kein passender Prozess gefunden`;
  if (p.user !== 'lena' && !root) return `bash: kill: (${pid}) - Vorgang nicht zulässig`;
  w.verlauf.push({ zeile: `#signal ${pid} ${sig}`, code: 0, ausgabe: '' });
  // Jobs der Shell: angehaltene Jobs mit SIGCONT weiterlaufen lassen, beendete melden
  const job = w.jobs.find((j) => j.pid === pid);
  if (sig === 18) { p.stat = 'S'; if (job) job.status = 'Running'; return ''; }
  if (sig === 19 || sig === 20) { p.stat = 'T'; if (job) job.status = 'Stopped'; return ''; }
  if (job && !(sig === 15 && p.ignoriertTerm) && sig !== 1) { w.jobs = w.jobs.filter((j) => j !== job); w.meldungen.push(`[${job.nr}]+  ${(sig === 9 ? 'Abgewürgt (Killed)' : sig === 2 ? 'Unterbrochen (Interrupt)' : 'Abgebrochen (Terminated)').padEnd(23)} ${job.cmd}`); }
  if (sig === 1 && p.nohup) return '';
  if (sig === 1 && job) { w.prozesse = w.prozesse.filter((x) => x.pid !== pid); w.jobs = w.jobs.filter((j) => j !== job); w.meldungen.push(`[${job.nr}]+  ${'Aufgelegt'.padEnd(24)}${job.cmd}`); return ''; }
  if (pid === 1) return '';
  if (sig === 15 && p.ignoriertTerm) return '';
  if (sig === 1) return '';
  w.prozesse = w.prozesse.filter((x) => x.pid !== pid);
  return '';
}

function minPlus(n: number) { const t = 8 * 60 + 40 + n; return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}:00`; }

function zuTarget(w: Welt, t: string): Ergebnis {
  if (t === 'poweroff.target' || t === 'reboot.target') { w.aus = t === 'reboot.target' ? 'reboot' : 'poweroff'; return ok(`Broadcast message from root@${w.host}:\n\nThe system will ${t === 'reboot.target' ? 'reboot' : 'power off'} now!`); }
  w.runlevelVorher = TARGET_ZU_RUNLEVEL[w.target] ?? 'N';
  w.target = t;
  if (t === 'rescue.target' || t === 'emergency.target') return ok(`You are in ${t === 'rescue.target' ? 'rescue' : 'emergency'} mode. After logging in, type "journalctl -xb" to view\nsystem logs, "systemctl reboot" to reboot, or "exit"\nto continue bootup.\n(Der Simulator lässt dich weiterarbeiten. Grafische Sitzungen und Netzwerkdienste sind jetzt gestoppt.)`);
  return ok(t === 'multi-user.target' ? '(Die grafische Oberfläche wurde beendet. Du arbeitest jetzt nur noch im Textmodus.)' : '');
}

function alleAbh(w: Welt, name: string, seen = new Set<string>()): string[] {
  if (seen.has(name)) return []; seen.add(name);
  const r = [name];
  for (const d of w.verfuegbar[name]?.abh ?? []) r.push(...alleAbh(w, d, seen));
  return [...new Set(r)];
}

function zeilenSchnitt(w: Welt, a: string[], stdin: string, art: 'head' | 'tail'): Ergebnis {
  let n = 10; const rest: string[] = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '-n') n = Number(a[++i]); else if (/^-\d+$/.test(a[i])) n = Number(a[i].slice(1)); else rest.push(a[i]);
  }
  const t = rest.length ? w.fs[pfad(w, rest[0])] : stdin;
  if (t === undefined || t === null) return fehler(`${art}: '${rest[0]}' kann nicht zum Lesen geöffnet werden: Datei oder Verzeichnis nicht gefunden`);
  const z = t.replace(/\n$/, '').split('\n');
  return ok((art === 'head' ? z.slice(0, n) : z.slice(-n)).join('\n'));
}

function schreiben(w: Welt, ziel: string, text: string, anhaengen: boolean, root: boolean): string | null {
  const p = pfad(w, ziel);
  if (p === '/dev/null') return null;
  const dir = p.slice(0, p.lastIndexOf('/')) || '/';
  if (!(dir in w.fs) || w.fs[dir] !== null) return 'Datei oder Verzeichnis nicht gefunden';
  if (w.fs[p] === null) return 'Ist ein Verzeichnis';
  if (nurLesbar(w, p)) return 'Das Dateisystem ist nur lesbar';
  if (p in w.fs) { if (!darf(w, p, 'w', root)) return 'Keine Berechtigung'; }
  else { if (!darfImOrdner(w, p, root)) return 'Keine Berechtigung'; w.fs[p] = ''; neuMeta(w, p, root, false); }
  const t = text.endsWith('\n') || !text ? text : text + '\n';
  w.fs[p] = anhaengen ? (w.fs[p] ?? '') + t : t;
  beruehren(w, p);
  return null;
}

// ---------- Zerlegen: Wörter und Operatoren ----------

type Token = { t: 'w'; v: string } | { t: 'op'; v: string };
const OPS = ['2>&1', '1>&2', '>&2', '&>>', '2>>', '1>>', '&&', '||', '|&', '>>', '&>', '2>', '1>', '|', '&', ';', '>', '<<<', '<'];

function lexen(zeile: string): Token[] {
  const out: Token[] = []; let cur = ''; let hat = false;
  const push = () => { if (cur || hat) out.push({ t: 'w', v: cur }); cur = ''; hat = false; };
  for (let i = 0; i < zeile.length; i++) {
    const c = zeile[i];
    if (c === "'" ) { const e = zeile.indexOf("'", i + 1); const ende = e < 0 ? zeile.length : e; cur += zeile.slice(i, ende + 1); i = ende; hat = true; continue; }
    if (c === '"') { let j = i + 1; while (j < zeile.length && zeile[j] !== '"') { if (zeile[j] === '\\') j++; j++; } cur += zeile.slice(i, j + 1); i = j; hat = true; continue; }
    if (c === '\\' && i + 1 < zeile.length) { cur += c + zeile[++i]; continue; }
    if (c === '$' && zeile[i + 1] === '(') { let tiefe = 0; let j = i + 1; for (; j < zeile.length; j++) { if (zeile[j] === '(') tiefe++; else if (zeile[j] === ')' && --tiefe === 0) break; } cur += zeile.slice(i, j + 1); i = j; continue; }
    if (c === '`') { const e = zeile.indexOf('`', i + 1); const ende = e < 0 ? zeile.length : e; cur += zeile.slice(i, ende + 1); i = ende; continue; }
    if (c === '#' && !cur && !hat) break;
    if (/\s/.test(c)) { push(); continue; }
    const op = OPS.find((o) => zeile.startsWith(o, i) && (!/^[12]/.test(o) || (!cur && !hat)));
    if (op) { push(); out.push({ t: 'op', v: op }); i += op.length - 1; continue; }
    cur += c;
  }
  push();
  return out;
}

// ---------- Erweitern: Klammern, Variablen, Befehlsersetzung, Tilde, Wildcards ----------

const Q = { '*': '\uE000', '?': '\uE001', '[': '\uE002' } as Record<string, string>;
const unQ = (s: string) => s.replace(/\uE000/g, '*').replace(/\uE001/g, '?').replace(/\uE002/g, '[');

function klammern(wort: string): string[] {
  // Erste ungeschützte {a,b} oder {1..5} suchen (nicht ${...}, nicht in Anführungszeichen)
  let q: string | null = null;
  for (let i = 0; i < wort.length; i++) {
    const c = wort[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === "'" || c === '"') { q = c; continue; }
    if (c === '\\') { i++; continue; }
    if (c !== '{' || wort[i - 1] === '$') continue;
    let tiefe = 0; let j = i; const kommas: number[] = [];
    for (; j < wort.length; j++) { if (wort[j] === '{') tiefe++; else if (wort[j] === '}') { if (--tiefe === 0) break; } else if (wort[j] === ',' && tiefe === 1) kommas.push(j); }
    if (j >= wort.length) return [wort];
    const innen = wort.slice(i + 1, j); const vor = wort.slice(0, i); const nach = wort.slice(j + 1);
    let teile: string[] | null = null;
    if (kommas.length) { teile = []; let s = i + 1; for (const k of [...kommas, j]) { teile.push(wort.slice(s, k)); s = k + 1; } }
    else { const m = innen.match(/^(-?\d+)\.\.(-?\d+)$|^([a-zA-Z])\.\.([a-zA-Z])$/); if (m) { teile = []; const a = m[1] !== undefined ? Number(m[1]) : m[3].charCodeAt(0); const b = m[2] !== undefined ? Number(m[2]) : m[4].charCodeAt(0); const breite = m[1] && /^-?0\d/.test(m[1]) ? m[1].length : 0; for (let k = a; a <= b ? k <= b : k >= b; k += a <= b ? 1 : -1) teile.push(m[1] !== undefined ? String(k).padStart(breite, '0') : String.fromCharCode(k)); } }
    if (!teile) continue;
    return teile.flatMap((t) => klammern(vor + t + nach));
  }
  return [wort];
}

function variable(w: Welt, n: string): string {
  if (n === '?') return String(w.letzterCode);
  if (n === '-') return stand(w).skript ? 'hB' : 'himBHs';
  if (n === '$') return '1203';
  if (n === '!') return String(w.jobs[w.jobs.length - 1]?.pid ?? '');
  const a = w.args[w.args.length - 1];
  if (n === '#') return String(a ? a.length - 1 : 0);
  if (n === '@' || n === '*') return a ? a.slice(1).join(' ') : '';
  if (/^\d$/.test(n)) return n === '0' ? (a?.[0] ?? (stand(w).login ? '-bash' : 'bash')) : (a?.[Number(n)] ?? '');
  if (n === 'PWD') return w.cwd;
  if (n === 'RANDOM') return String(Math.floor(Math.random() * 32768));
  return w.env[n] ?? w.vars[n] ?? '';
}

function erweitern(w: Welt, roh: string, root: boolean, globben = true): string[] {
  const ergebnis: string[] = [];
  // In Zuweisungen ersetzt die Bash ~ auch nach = und :, etwa in PATH=$PATH:~/bin
  if (/^[A-Za-z_]\w*=/.test(roh)) roh = roh.replace(/(^[A-Za-z_]\w*=|:)~(?=\/|:|$)/g, '$1/home/lena');
  for (const wort of klammern(roh)) {
    if (wort === '"$@"' || wort === '"${@}"') { ergebnis.push(...(w.args[w.args.length - 1]?.slice(1) ?? [])); continue; }
    const felder: string[] = []; let cur = ''; let hat = false; let glob = false;
    const anhaengen = (s: string, geteilt: boolean) => {
      if (!geteilt) { cur += s; return; }
      const teile = s.split(/[ \t\n]+/);
      if (teile.length === 1) { cur += s; return; }
      teile.forEach((t, k) => { if (k === 0) { cur += t; if (cur || hat) felder.push(cur); } else if (k === teile.length - 1) cur = t; else if (t) felder.push(t); });
      hat = false;
    };
    const ersetzung = (befehl: string) => intern(w, befehl, '', root).out.replace(/\n+$/, '');
    const dollar = (s: string, i: number): [string, number] | null => {
      if (s[i + 1] === '(' && s[i + 2] === '(') {
        let tiefe = 0; let j = i + 1; for (; j < s.length; j++) { if (s[j] === '(') tiefe++; else if (s[j] === ')' && --tiefe === 0) break; }
        const innen = s.slice(i + 3, j - 1).replace(/\$\(([^()]*)\)/g, (_, b) => ersetzung(b));
        try { return [String(rechnen(w, innen)), j]; } catch (e) { if (e instanceof RechenFehler) { w.meldungen.push('bash: ' + e.text); return ['', j]; } throw e; }
      }
      if (s[i + 1] === '(') { let tiefe = 0; let j = i + 1; for (; j < s.length; j++) { if (s[j] === '(') tiefe++; else if (s[j] === ')' && --tiefe === 0) break; } return [ersetzung(s.slice(i + 2, j)), j]; }
      const m = s.slice(i + 1).match(/^\{([^}]+)\}|^([A-Za-z_]\w*)|^([?$#@*!0-9-])/);
      if (!m) return null;
      if (m[1]) { try { const p = parameter(w, m[1], root); if (p !== null) return [p, i + m[0].length]; } catch (e) { if (e instanceof RechenFehler) { w.meldungen.push('bash: ' + e.text); return ['', i + m[0].length]; } throw e; } const k = m[1].match(/^#(\w+)$/); if (k) return [String(variable(w, k[1]).length), i + m[0].length]; const d = m[1].match(/^(\w+):-(.*)$/); if (d) return [variable(w, d[1]) || d[2], i + m[0].length]; return [variable(w, m[1]), i + m[0].length]; }
      return [variable(w, m[2] ?? m[3]), i + m[0].length];
    };
    if (/^~(\/|$)/.test(wort)) { cur = '/home/lena'; hat = true; }
    for (let i = /^~(\/|$)/.test(wort) ? 1 : 0; i < wort.length; i++) {
      const c = wort[i];
      if (c === "'") { const e = wort.indexOf("'", i + 1); const s = wort.slice(i + 1, e < 0 ? wort.length : e); cur += s.replace(/[*?[]/g, (x) => Q[x]); i = e < 0 ? wort.length : e; hat = true; continue; }
      if (c === '"') {
        hat = true; let j = i + 1;
        for (; j < wort.length && wort[j] !== '"'; j++) {
          const d = wort[j];
          if (d === '\\' && '"$`\\'.includes(wort[j + 1] ?? '')) { cur += wort[++j]; continue; }
          if (d === '$') { const r = dollar(wort, j); if (r) { cur += r[0].replace(/[*?[]/g, (x) => Q[x]); j = r[1]; continue; } }
          if (d === '`') { const e = wort.indexOf('`', j + 1); cur += ersetzung(wort.slice(j + 1, e)).replace(/[*?[]/g, (x) => Q[x]); j = e; continue; }
          cur += Q[d] ?? d;
        }
        i = j; continue;
      }
      if (c === '\\' && i + 1 < wort.length) { const n = wort[++i]; cur += Q[n] ?? n; hat = true; continue; }
      if (c === '$') { const r = dollar(wort, i); if (r) { anhaengen(r[0], true); i = r[1]; continue; } }
      if (c === '`') { const e = wort.indexOf('`', i + 1); anhaengen(ersetzung(wort.slice(i + 1, e < 0 ? wort.length : e)), true); i = e < 0 ? wort.length : e; continue; }
      if ('*?['.includes(c)) glob = true;
      cur += c;
    }
    if (cur || hat) felder.push(cur);
    for (const f of felder) {
      if (globben && glob && /[*?[]/.test(f)) { const t = wildcards(w, f); if (t.length) { ergebnis.push(...t.map(unQ)); continue; } }
      ergebnis.push(unQ(f));
    }
  }
  return ergebnis;
}

/** Shell-Muster (*, ?, [abc], [!abc], [a-z]) in einen regulären Ausdruck übersetzen. */
function musterRegex(m: string): RegExp {
  let r = '';
  for (let i = 0; i < m.length; i++) {
    const c = m[i];
    if (c === '*') r += '[^/]*';
    else if (c === '?') r += '[^/]';
    else if (c === '[') { const e = m.indexOf(']', i + 2); if (e < 0) { r += '\\['; continue; } let innen = m.slice(i + 1, e); if (innen[0] === '!' || innen[0] === '^') innen = '^' + innen.slice(1); r += '[' + innen.replace(/\\/g, '\\\\').replace(/\uE000/g, '*').replace(/\uE001/g, '?').replace(/\uE002/g, '\\[') + ']'; i = e; }
    else r += unQ(c).replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + r + '$');
}

/** Wildcards gegen das Dateisystem auflösen. Ohne Treffer bleibt das Wort stehen (wie in der Bash). */
function wildcards(w: Welt, muster: string): string[] {
  const absolut = muster.startsWith('/');
  const teile = muster.split('/').filter((t, i) => t !== '' || i === 0);
  let kandidaten: { p: string; a: string }[] = [{ p: absolut ? '/' : w.cwd, a: absolut ? '/' : '' }];
  for (const [k, teil] of teile.entries()) {
    if (k === 0 && absolut) continue;
    const neu: { p: string; a: string }[] = [];
    for (const { p, a } of kandidaten) {
      const unter = (n: string) => ({ p: (p === '/' ? '' : p) + '/' + n, a: a === '' ? n : a === '/' ? '/' + n : a + '/' + n });
      if (!/[*?[]/.test(teil)) { const x = unter(unQ(teil)); if (x.p in w.fs || teil === '.' || teil === '..') neu.push(teil === '..' || teil === '.' ? { p: pfad(w, x.p), a: x.a } : x); continue; }
      if (w.fs[p] !== null) continue;
      const re = musterRegex(teil);
      for (const n of kinder(w, p)) if (re.test(n) && (!n.startsWith('.') || teil.startsWith('.'))) neu.push(unter(n));
    }
    kandidaten = neu;
  }
  return kandidaten.map((x) => x.a).sort((x, y) => x.localeCompare(y, 'de'));
}

// ---------- Befehlssuche über PATH ----------

// Wo die Programme auf Debian 12 liegen (merged /usr: /bin -> usr/bin, /sbin -> usr/sbin)
const SBIN = new Set(['mkfs', 'mkfs.ext2', 'mkfs.ext3', 'mkfs.ext4', 'mkfs.xfs', 'mkfs.vfat', 'mkfs.fat', 'mkfs.exfat', 'mkfs.btrfs', 'mke2fs', 'mkswap', 'swapoff', 'blkid', 'e2fsck', 'fsck.ext2', 'fsck.ext3', 'fsck.ext4', 'tune2fs', 'e2label', 'xfs_repair', 'xfs_fsr', 'xfs_db', 'xfs_admin', 'parted', 'gdisk', 'updatedb', 'chroot', 'fdisk', 'modprobe', 'insmod', 'rmmod', 'lsmod', 'modinfo', 'depmod', 'shutdown', 'reboot', 'poweroff', 'halt', 'telinit', 'init', 'runlevel', 'ldconfig', 'update-grub', 'grub-install', 'grub-mkconfig', 'swapon', 'swapoff', 'dpkg-reconfigure', 'sshd', 'mkfs', 'fsck', 'blkid', 'parted', 'useradd', 'usermod', 'userdel', 'groupadd', 'groupmod', 'groupdel', 'hwclock', 'rsyslogd', 'logrotate', 'sendmail', 'postsuper', 'lpadmin', 'cupsenable', 'cupsdisable', 'cupsaccept', 'cupsreject', 'lpinfo', 'ifconfig', 'route', 'ifup', 'ifdown', 'visudo', 'tcpdmatch', 'service', 'ethtool', 'sshd', 'iotop', 'iftop', 'iptraf-ng', 'sysctl', 'update-initramfs', 'mkinitramfs', 'dkms', 'installkernel', 'update-rc.d', 'chkconfig', 'smartctl', 'smartd', 'xfsdump', 'xfsrestore', 'cryptsetup', 'automount', 'dumpe2fs', 'debugfs', 'xfs_info', 'mdadm', 'pvcreate', 'pvs', 'pvdisplay', 'pvremove', 'pvmove', 'pvscan', 'pvresize', 'vgcreate', 'vgs', 'vgdisplay', 'vgextend', 'vgreduce', 'vgrename', 'vgremove', 'vgchange', 'vgscan', 'lvcreate', 'lvs', 'lvdisplay', 'lvextend', 'lvreduce', 'lvresize', 'lvrename', 'lvremove', 'lvconvert', 'lvchange', 'lvscan', 'lvm', 'hdparm', 'resize2fs', 'xfs_growfs', 'sfdisk', 'fstrim', 'iscsiadm', 'iscsid', 'nvme', 'arp', 'iw', 'rfkill', 'wpa_supplicant', 'wpa_cli', 'dhclient', 'iwconfig', 'iwlist']);
const ROOT_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
const AUCH_EXTERN = new Set(['echo', 'pwd', 'kill', 'true', 'false', 'printf', 'test', '[']);   // gibt es auch als Programm in /usr/bin
const EIGENER_ORT: Record<string, string> = { 'apt-file': '/usr/bin' };
function ortVon(name: string) { return EIGENER_ORT[name] ?? (SBIN.has(name) ? '/usr/sbin' : '/usr/bin'); }
const gleichwertig = (dir: string) => dir === '/bin' ? '/usr/bin' : dir === '/sbin' ? '/usr/sbin' : dir.replace(/\/$/, '');

/** Alle Fundstellen eines Namens in PATH, in der Reihenfolge von PATH. */
function imPath(w: Welt, name: string, suchPfad = w.env.PATH): string[] {
  const treffer: string[] = [];
  for (const dir of (suchPfad ?? '').split(':').filter(Boolean)) {
    const p = dir.replace(/\/$/, '') + '/' + name;
    if (befehle[name] && gleichwertig(dir) === ortVon(name)) { treffer.push(p); continue; }
    if (typeof w.fs[p] === 'string' && meta(w, p).mode & 0o111) treffer.push(p);
  }
  return treffer;
}

// ---------- Eingebaute Befehle der Shell ----------

const EINGEBAUT: Record<string, (w: Welt, a: string[], stdin: string, root: boolean) => Ergebnis> = {
  cd: (w, a, _i, root) => {
    if (a.length > 1) return fehler('bash: cd: Zu viele Argumente.');
    let ziel = a[0] ?? w.env.HOME;
    if (ziel === '-') { ziel = w.env.OLDPWD; if (!ziel) return fehler('bash: cd: OLDPWD ist nicht zugewiesen.'); }
    let z = pfad(w, ziel);
    // Symbolischen Link auf ein Verzeichnis folgen (der Simulator wechselt in das echte Ziel, wie cd -P)
    for (let i = 0; i < 40 && typeof w.fs[z] === 'string' && w.fs[z]!.startsWith('-> '); i++) { const t = w.fs[z]!.slice(3); z = pfad(w, t.startsWith('/') ? t : (z.slice(0, z.lastIndexOf('/')) || '/') + '/' + t); }
    if (!(z in w.fs)) return fehler(`bash: cd: ${ziel}: Datei oder Verzeichnis nicht gefunden`);
    if (w.fs[z] !== null) return fehler(`bash: cd: ${ziel}: Ist kein Verzeichnis`);
    if (!darf(w, z, 'x', root || w.root)) return fehler(`bash: cd: ${ziel}: Keine Berechtigung`);
    w.env.OLDPWD = w.cwd; w.cwd = z; w.env.PWD = z;
    return ok(a[0] === '-' ? z : '');
  },
  pwd: (w) => ok(w.cwd),
  echo: (_w, a) => {
    let i = 0; let neu = true; let esc = false;
    while (i < a.length && /^-[neE]+$/.test(a[i])) { if (a[i].includes('n')) neu = false; if (a[i].includes('e')) esc = true; if (a[i].includes('E')) esc = false; i++; }
    let t = a.slice(i).join(' ');
    if (esc) t = t.replace(/\\(n|t|\\|e|a)/g, (_, c) => ({ n: '\n', t: '\t', '\\': '\\', e: '\u001b', a: '' } as Record<string, string>)[c]);
    return { out: neu ? t : t + '\u0000ohneNL', code: 0 };
  },
  export: (w, a) => {
    if (!a.length || a[0] === '-p') return ok(Object.entries(w.env).sort().map(([k, v]) => `declare -x ${k}="${v}"`).join('\n'));
    for (const t of a) {
      const m = t.match(/^([A-Za-z_]\w*)(?:=(.*))?$/s);
      if (!m) return fehler(`bash: export: »${t}«: Ist kein gültiger Bezeichner`);
      w.env[m[1]] = m[2] ?? w.vars[m[1]] ?? w.env[m[1]] ?? ''; delete w.vars[m[1]];
    }
    return ok();
  },
  unset: (w, a) => {
    const st = stand(w);
    if (a.includes('-f')) { for (const n of a.filter((x) => !x.startsWith('-'))) { delete st.funktionen[n]; delete st.funkText[n]; } return ok(); }
    for (const n of a.filter((x) => !x.startsWith('-'))) { if (!/^[A-Za-z_]\w*$/.test(n)) return fehler(`bash: unset: »${n}«: Ist kein gültiger Bezeichner`); if (n in w.env || n in w.vars || a.includes('-v')) { delete w.env[n]; delete w.vars[n]; } else { delete st.funktionen[n]; delete st.funkText[n]; } }
    return ok();
  },
  set: (w, a) => {
    const st = stand(w);
    if (!a.length) return ok([...[...Object.entries(w.env), ...Object.entries(w.vars)].sort(([x], [y]) => x.localeCompare(y)).map(([k, v]) => `${k}=${/[\s'\\]/.test(v) ? `'${v.replace(/\t/g, '\\t').replace(/\n/g, '\\n')}'` : v}`), ...Object.keys(st.funkText).sort().map((n) => st.funkText[n])].join('\n'));
    for (let i = 0; i < a.length; i++) {
      const x = a[i];
      if (x === '--') { const top = w.args[w.args.length - 1]; const neu = [top?.[0] ?? 'bash', ...a.slice(i + 1)]; if (top) w.args[w.args.length - 1] = neu; else w.args.push(neu); return ok(); }
      if (x === '-o' || x === '+o') { const n = a[++i]; const k = ({ xtrace: 'x', errexit: 'e', nounset: 'u' } as Record<string, 'x' | 'e' | 'u'>)[n]; if (!n) return ok(['errexit', 'nounset', 'xtrace'].map((o) => `${o.padEnd(15)}\t${st.optionen[({ errexit: 'e', nounset: 'u', xtrace: 'x' } as Record<string, 'x' | 'e' | 'u'>)[o]] ? 'on' : 'off'}`).join('\n')); if (!k) return fehler(`bash: set: ${n}: Ungültiger Optionsname.`); st.optionen[k] = x === '-o'; continue; }
      const m = x.match(/^([-+])([a-zA-Z]+)$/);
      if (!m) { const top = w.args[w.args.length - 1]; const neu = [top?.[0] ?? 'bash', ...a.slice(i)]; if (top) w.args[w.args.length - 1] = neu; else w.args.push(neu); return ok(); }
      for (const c of m[2]) { if ('xeu'.includes(c)) st.optionen[c as 'x'] = m[1] === '-'; else if (!'vhBHmCfnab'.includes(c)) return fehler(`bash: set: ${m[1]}${c}: Ungültige Option.`, 2); }
    }
    return ok();
  },
  alias: (w, a) => {
    if (!a.length) return ok(Object.entries(w.aliase).sort().map(([k, v]) => `alias ${k}='${v}'`).join('\n'));
    const out: string[] = []; const err: string[] = [];
    for (const t of a) { const m = t.match(/^([^=]+)=(.*)$/s); if (m) w.aliase[m[1]] = m[2]; else if (w.aliase[t] !== undefined) out.push(`alias ${t}='${w.aliase[t]}'`); else err.push(`bash: alias: ${t}: Nicht gefunden.`); }
    return { out: out.join('\n'), err: err.join('\n') || undefined, code: err.length ? 1 : 0 };
  },
  unalias: (w, a) => { if (a[0] === '-a') { w.aliase = {}; return ok(); } for (const n of a) { if (!(n in w.aliase)) return fehler(`bash: unalias: ${n}: Nicht gefunden.`); delete w.aliase[n]; } return ok(); },
  type: (w, a) => {
    const alle = a.includes('-a'); const kurz = a.includes('-t'); const nurPfad = a.includes('-p') || a.includes('-P');
    const out: string[] = []; const err: string[] = [];
    for (const n of a.filter((x) => !x.startsWith('-'))) {
      const f: string[] = [];
      if (!nurPfad && w.aliase[n] !== undefined) f.push(kurz ? 'alias' : `${n} ist ein Alias von »${w.aliase[n]}«.`);
      if (!nurPfad && stand(w).funkText[n]) f.push(kurz ? 'function' : `${n} ist eine Funktion.\n${stand(w).funkText[n]}`);
      if (!nurPfad && ['if', 'then', 'else', 'fi', 'for', 'while', 'do', 'done', 'case', 'esac', 'function', 'time', '!', '[['].includes(n)) f.push(kurz ? 'keyword' : `${n} Ist ein reserviertes Schlüsselwort der Shell.`);
      if (!nurPfad && EINGEBAUT[n]) f.push(kurz ? 'builtin' : `${n} ist eine von der Shell mitgelieferte Funktion.`);
      for (const p of imPath(w, n)) f.push(kurz ? 'file' : nurPfad ? p : `${n} ist ${p}`);
      if (!f.length) { err.push(`bash: type: ${n}: Nicht gefunden.`); continue; }
      out.push(...(alle ? f : f.slice(0, 1)));
    }
    return { out: out.join('\n'), err: err.join('\n') || undefined, code: err.length ? 1 : 0 };
  },
  history: (w, a) => {
    if (a[0] === '-c') { w.historie = []; return ok(); }
    if (a[0] === '-w') { w.fs['/home/lena/.bash_history'] = w.historie.join('\n') + '\n'; beruehren(w, '/home/lena/.bash_history'); return ok(); }
    if (a[0] === '-a') { w.fs['/home/lena/.bash_history'] = (w.fs['/home/lena/.bash_history'] ?? '') + w.historie.slice(w.histGespeichert ?? 0).join('\n') + '\n'; w.histGespeichert = w.historie.length; return ok(); }
    if (a[0] === '-d') { w.historie.splice(Number(a[1]) - 1, 1); return ok(); }
    const n = a[0] ? Number(a[0]) : w.historie.length;
    return ok(w.historie.map((z, i) => `${String(i + 1).padStart(5)}  ${z}`).slice(-n).join('\n'));
  },
  umask: (w, a) => {
    if (a[0] === '-S') { const r = (m: number) => (m & 4 ? '' : 'r') + (m & 2 ? '' : 'w') + (m & 1 ? '' : 'x'); return ok(`u=${r(w.umask >> 6 & 7)},g=${r(w.umask >> 3 & 7)},o=${r(w.umask & 7)}`); }
    if (!a.length) return ok(w.umask.toString(8).padStart(4, '0'));
    if (!/^[0-7]{1,4}$/.test(a[0])) return fehler(`bash: umask: ${a[0]}: Oktalzahl außerhalb des Wertebereichs`);
    w.umask = parseInt(a[0], 8); return ok();
  },
  true: () => ok(), false: () => ({ out: '', code: 1 }),
  printf: (_w, a) => {
    if (!a.length) return fehler('bash: printf: Aufruf: printf [-v var] Format [Argumente]', 2);
    const fmt = a[0]; let args = a.slice(1); let out = '';
    const esc = (t: string) => t.replace(/\\(n|t|\\)/g, (_, c) => (c === 'n' ? '\n' : c === 't' ? '\t' : '\\'));
    do {
      out += esc(fmt).replace(/%(-?\d*)([sdbf%])/g, (_, br, c) => { if (c === '%') return '%'; const v = args.shift() ?? ''; const t = c === 'd' ? String(parseInt(v) || 0) : c === 'f' ? (parseFloat(v) || 0).toFixed(6) : c === 'b' ? esc(v) : v; return br ? (br.startsWith('-') ? t.padEnd(Number(br.slice(1))) : t.padStart(Number(br))) : t; });
    } while (args.length && /%[sdbf]/.test(fmt));
    return { out: out.endsWith('\n') ? out.slice(0, -1) : out + '\u0000ohneNL', code: 0 };
  },
  source: (w, a, stdin, root) => skript(w, a[0], a, stdin, root, true),
  '.': (w, a, stdin, root) => skript(w, a[0], a, stdin, root, true),
  exit: (w, a) => {
    if (a[0] !== undefined && !/^-?\d+$/.test(a[0])) return { out: '', err: `bash: exit: ${a[0]}: Ein numerischer Parameter ist erforderlich.`, code: 2, ende: 'exit' };
    const code = a[0] !== undefined ? Number(a[0]) & 255 : w.letzterCode;
    if (w.args.length) return { out: '', code, ende: 'exit' };
    if (stand(w).shells.length) return shellBeenden(w, code, false);
    if (w.root) { w.root = false; return ok('abgemeldet'); }
    return ok('exit\n(Das wäre die letzte Shell dieses Terminals. Im Simulator bleibst du angemeldet.)');
  },
  jobs: (w, a, i, r) => SHELL_INTERN.jobs(w, a, i, r), fg: (w, a, i, r) => SHELL_INTERN.fg(w, a, i, r), bg: (w, a, i, r) => SHELL_INTERN.bg(w, a, i, r),
  kill: (w, a, i, r) => {
    const fehlt = a.find((x) => /^%/.test(x) && !jobAus(w, x));
    if (fehlt) return fehler(`bash: kill: ${fehlt}: Kein solcher Job.`);
    return befehle.kill(w, a.map((x) => (/^%/.test(x) ? String(jobAus(w, x)!.pid) : x)), i, r);
  },
};
EINGEBAUT.logout = (w, a) => (stand(w).shells.length ? shellBeenden(w, a[0] ? Number(a[0]) & 255 : w.letzterCode, true) : fehler('bash: logout: Keine Loginshell: Mit »exit« abmelden!'));
Object.assign(EINGEBAUT, skriptEingebaut());
function jobAus(w: Welt, x: string) { const m = x.match(/^%(\d+|[+%-]?)$/); if (!m) return undefined; return m[1] && /^\d+$/.test(m[1]) ? w.jobs.find((j) => j.nr === Number(m[1])) : m[1] === '-' ? w.jobs[w.jobs.length - 2] : w.jobs[w.jobs.length - 1]; }
const SHELL_INTERN: Record<string, Befehl> = {};
const PROGRAMME_SHELL: Record<string, Befehl> = {
  which: (w: Welt, a: string[]) => {
    const alle = a.includes('-a'); const out: string[] = []; let code = 0;
    for (const n of a.filter((x) => !x.startsWith('-'))) { const f = n.includes('/') ? (typeof w.fs[pfad(w, n)] === 'string' ? [n] : []) : imPath(w, n); if (!f.length) code = 1; out.push(...(alle ? f : f.slice(0, 1))); }
    return { out: out.join('\n'), code };
  },
  whereis: (w: Welt, a: string[]) => ok(a.filter((x) => !x.startsWith('-')).map((n) => { const p = befehle[n] ? [ortVon(n) + '/' + n, ...(SEITEN[n] ?? (MAN[n] ? [{ sek: SBIN.has(n) ? 8 : 1 }] : [])).map((x) => `/usr/share/man/man${x.sek}/${n}.${x.sek}.gz`)] : []; return `${n}:${p.map((x) => ' ' + x).join('')}`; }).join('\n')),
};

/** Ein Skript Zeile für Zeile ausführen. source/. laufen in der aktuellen Shell, sonst in einer Kopie der Variablen. */
function skript(w: Welt, datei: string | undefined, args: string[], stdin: string, root: boolean, quelle: boolean): Ergebnis {
  if (!datei) return fehler('bash: source: Dateiname als Argument erforderlich.', 2);
  const p = datei.includes('/') ? pfad(w, datei) : (quelle ? (imPathDatei(w, datei) ?? pfad(w, datei)) : pfad(w, datei));
  if (!(p in w.fs)) return fehler(`bash: ${datei}: Datei oder Verzeichnis nicht gefunden`, quelle ? 1 : 127);
  if (w.fs[p] === null) return fehler(`bash: ${datei}: ist ein Verzeichnis.`, quelle ? 1 : 126);
  if (!darf(w, p, 'r', root)) return fehler(`bash: ${datei}: Keine Berechtigung`, 126);
  const text = w.fs[p] ?? '';
  const st = stand(w);
  const alt = { vars: w.vars, env: w.env, cwd: w.cwd, aliase: w.aliase, funktionen: st.funktionen, funkText: st.funkText, optionen: st.optionen };
  // Ein Skript läuft in einer eigenen Shell: Es erbt nur die Umgebung, keine Shell-Variablen, Aliase oder Funktionen
  if (!quelle) { w.vars = {}; w.env = { ...w.env }; w.aliase = {}; st.funktionen = {}; st.funkText = {}; st.optionen = { ...(st.startOptionen ?? {}) }; st.startOptionen = undefined; st.skript++; }
  else { st.quelle++; if (!st.gelesen.includes(p)) st.gelesen.push(p); }
  const name = args[0] ?? datei;
  if (!quelle || args.length > 1) w.args.push([quelle ? (w.args[w.args.length - 1]?.[0] ?? 'bash') : name, ...args.slice(1)]);
  else w.args.push([...(w.args[w.args.length - 1] ?? ['bash'])]);
  let r: ReturnType<typeof programm>;
  try { r = programm(w, text, stdin, root, { name: quelle ? `bash: ${datei}` : name }); }
  finally {
    w.args.pop();
    if (!quelle) { Object.assign(w, { vars: alt.vars, env: alt.env, cwd: alt.cwd, aliase: alt.aliase }); st.funktionen = alt.funktionen; st.funkText = alt.funkText; st.optionen = alt.optionen; st.skript--; }
    else st.quelle--;
  }
  // exit in einer mit source gelesenen Datei beendet auch das Skript, das sie gelesen hat
  const ende = quelle && r.ende === 'exit' && (st.skript > 0 || st.funk > 0) ? 'exit' : undefined;
  return { out: r.out, err: r.err, code: r.code, misch: r.misch, ...(ende ? { ende } : {}) } as Ergebnis;
}
function skriptMitOptionen(w: Welt, datei: string, args: string[], stdin: string, root: boolean, opts: { x?: boolean; e?: boolean }): Ergebnis {
  stand(w).startOptionen = opts;
  try { return skript(w, datei, args, stdin, root, false); } finally { stand(w).startOptionen = undefined; }
}
function imPathDatei(w: Welt, n: string) { for (const d of (w.env.PATH ?? '').split(':')) { const p = d + '/' + n; if (typeof w.fs[p] === 'string') return p; } return null; }

/** Ein Programm über seinen Pfad starten: Skript mit Shebang oder bekanntes Programm. */
function pfadStarten(w: Welt, name: string, z: string, args: string[], stdin: string, root: boolean): Ergebnis {
  if (!(z in w.fs)) return fehler(`bash: ${name}: Datei oder Verzeichnis nicht gefunden`, 127);
  if (w.fs[z] === null) return fehler(`bash: ${name}: Ist ein Verzeichnis`, 126);
  let c = w.fs[z] as string;
  if (c.startsWith('-> ')) { const ziel = c.slice(3); const zp = ziel.startsWith('/') ? ziel : z.replace(/[^/]+$/, '') + ziel; if (befehle[zp.split('/').pop()!]) return befehle[zp.split('/').pop()!](w, args, stdin, root); c = w.fs[zp] ?? ''; }
  if (!darf(w, z, 'x', root)) return fehler(`bash: ${name}: Keine Berechtigung`, 126);
  const basis = z.split('/').pop()!;
  if (c.startsWith(BIN_MARKE) && befehle[basis]) return befehle[basis](w, args, stdin, root);
  const kp = kernProgramm(w, z, args, root); if (kp) return kp;
  const sp = startProgramm(w, z, args, root); if (sp) return sp;
  const prog = programmStarten(w, z);
  if (prog) return prog.code ? { out: '', err: prog.out, code: prog.code } : prog;
  if (c.startsWith('#!')) {
    // Die Shebang-Zeile bestimmt den Interpreter
    const interp = c.slice(2).split('\n')[0].trim().split(/\s+/)[0];
    const ip = pfad(w, interp);
    if (!(ip in w.fs)) return fehler(`bash: ${name}: ${interp}: Defekter Interpreter: Datei oder Verzeichnis nicht gefunden`, 126);
    const basis = interp.split('/').pop()!;
    if (basis === 'env') { const n = c.slice(2).split('\n')[0].trim().split(/\s+/)[1] ?? ''; if (!['bash', 'sh', 'dash'].includes(n)) return fehler(`(Der Simulator führt nur Shell-Skripte aus. ${n || 'Dieser Interpreter'} läuft hier nicht.)`, 126); }
    else if (!['bash', 'sh', 'dash'].includes(basis)) return fehler(`(Der Simulator führt nur Shell-Skripte aus. ${interp} läuft hier nicht.)`, 126);
  }
  if (c.startsWith('#!') || !c.startsWith('\u0007')) return skript(w, z, [name, ...args], stdin, root, false);
  return fehler(`bash: ${name}: Kann die Binärdatei nicht ausführen: Fehler im Format der Programmdatei`, 126);
}

// ---------- Ausführen ----------

export interface Lauf { ausgabe: string; code: number; clear?: boolean; }
interface Umleitung { fd: 0 | 1 | 2 | 3; op: string; ziel?: string; }   // fd 3: beide (&>)
interface Einfach { woerter: string[]; umleitungen: Umleitung[]; }
interface Kette { pipeline: Einfach[]; verbinder: string; hintergrund: boolean; text: string; }

/** Tokens in Befehlsketten (;, &&, ||, &) und Pipelines (|) aufteilen. */
function parsen(w: Welt, zeile: string): Kette[] | string {
  const tokens = lexen(zeile);
  const ketten: Kette[] = []; let pipeline: Einfach[] = []; let cmd: Einfach = { woerter: [], umleitungen: [] }; let start = 0;
  const textTeile: string[] = [];
  const abschluss = (verb: string, hg = false) => {
    if (cmd.woerter.length || cmd.umleitungen.length) pipeline.push(cmd);
    if (pipeline.length) ketten.push({ pipeline, verbinder: ketten.length ? verb : ';', hintergrund: hg, text: textTeile.join(' ') });
    pipeline = []; cmd = { woerter: [], umleitungen: [] }; textTeile.length = 0;
  };
  let naechsterVerb = ';';
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.t === 'w') { cmd.woerter.push(t.v); textTeile.push(t.v); continue; }
    if (['>', '>>', '<', '<<<', '2>', '2>>', '1>', '1>>', '&>', '&>>'].includes(t.v)) {
      const z = tokens[i + 1]; if (!z || z.t !== 'w') return `bash: Syntaxfehler beim unerwarteten Symbol »${z ? z.v : 'newline'}«`;
      const fd = t.v.startsWith('2') ? 2 : t.v.startsWith('&') ? 3 : t.v.startsWith('<') ? 0 : 1;
      cmd.umleitungen.push({ fd, op: t.v.replace(/^[12&]/, '') || '>', ziel: z.v }); textTeile.push(t.v, z.v); i++; continue;
    }
    if (t.v === '2>&1') { cmd.umleitungen.push({ fd: 2, op: 'dup1' }); textTeile.push(t.v); continue; }
    if (t.v === '1>&2' || t.v === '>&2') { cmd.umleitungen.push({ fd: 1, op: 'dup2' }); textTeile.push(t.v); continue; }
    if (t.v === '|&') { cmd.umleitungen.push({ fd: 2, op: 'dup1' }); t.v = '|'; }
    if (t.v === '|') { if (!cmd.woerter.length) return 'bash: Syntaxfehler beim unerwarteten Symbol »|«'; pipeline.push(cmd); cmd = { woerter: [], umleitungen: [] }; textTeile.push('|'); continue; }
    if (!cmd.woerter.length && !pipeline.length) return `bash: Syntaxfehler beim unerwarteten Symbol »${t.v}«`;
    const verb = naechsterVerb;
    if (t.v === '&') { abschluss(verb, true); naechsterVerb = ';'; }
    else { abschluss(verb); naechsterVerb = t.v; }
    void start;
  }
  abschluss(naechsterVerb);
  if (naechsterVerb !== ';' && ketten.length && !tokens.length) return 'bash: Syntaxfehler';
  const letzter = tokens[tokens.length - 1];
  if (letzter && letzter.t === 'op' && (letzter.v === '&&' || letzter.v === '||' || letzter.v === '|')) return `bash: Syntaxfehler beim unerwarteten Dateiende`;
  return ketten;
}

const BIN_MARKE = '\u0007BIN:';
const frueh = (msg: string) => ({ out: '', err: msg, code: 1, tty: msg });

/** Einen einfachen Befehl mit Umleitungen ausführen. stdout geht in die Pipe oder aufs Terminal. */
function einfachAusfuehren(w: Welt, c: Einfach, stdin: string, rootStart: boolean, letzter: boolean): Ergebnis & { tty: string } {
  // Aliase: nur das erste Wort, nur wenn es nicht in Anführungszeichen steht
  let woerter = [...c.woerter];
  const erstes = woerter[0];
  if (erstes && w.aliase[erstes] !== undefined && !/["'\\]/.test(erstes)) woerter = [...lexen(w.aliase[erstes]).filter((t) => t.t === 'w').map((t) => t.v), ...woerter.slice(1)];
  if (woerter[0] === 'sudo' && woerter[1] && w.aliase[woerter[1]] !== undefined && w.aliase.sudo !== undefined) { /* sudo-Alias-Trick wird nicht simuliert */ }
  let root = rootStart;
  // Zuweisungen am Anfang
  const temp: Record<string, string> = {};
  while (woerter.length && /^[A-Za-z_]\w*=/.test(woerter[0])) { const k = woerter[0].indexOf('='); temp[woerter[0].slice(0, k)] = erweitern(w, woerter[0].slice(k + 1).replace(/(^|:)~(?=\/|:|$)/g, '$1/home/lena'), root, false).join(' '); woerter.shift(); }
  let args = woerter.flatMap((x) => erweitern(w, x, root));
  if (!woerter.length) {
    for (const [k, v] of Object.entries(temp)) { if (k in w.env) w.env[k] = v; else w.vars[k] = v; }
  }
  // Umleitungen öffnen (von links nach rechts). Die Shell des Benutzers öffnet sie, nicht sudo.
  type Ziel = { art: 'tty' | 'pipe' | 'datei'; datei?: string; anh?: boolean };
  let fd1: Ziel = letzter ? { art: 'tty' } : { art: 'pipe' }; let fd2: Ziel = { art: 'tty' };
  const offen: Record<string, string[]> = {};
  for (const u of c.umleitungen) {
    if (u.op === 'dup1') { fd2 = { ...fd1 }; continue; }
    if (u.op === 'dup2') { fd1 = { ...fd2 }; continue; }
    if (u.op === '<<<') { stdin = erweitern(w, u.ziel!, root, false).join(' ') + '\n'; stand(w).eingabeTty = false; continue; }
    const ziele = erweitern(w, u.ziel!, w.root);
    if (ziele.length !== 1) return frueh(`bash: ${u.ziel}: Mehrdeutige Umlenkung.`);
    const z = ziele[0];
    if (u.fd === 0) {
      const p = pfad(w, z);
      if (!(p in w.fs)) return frueh(`bash: ${z}: Datei oder Verzeichnis nicht gefunden`);
      if (w.fs[p] === null) return frueh(`bash: ${z}: Ist ein Verzeichnis`);
      if (!darf(w, p, 'r', w.root)) return frueh(`bash: ${z}: Keine Berechtigung`);
      stdin = w.fs[p] ?? ''; stand(w).eingabeTty = false; continue;
    }
    const anh = u.op === '>>';
    const p = pfad(w, z);
    // Beim Öffnen mit > wird die Datei sofort geleert, noch bevor der Befehl läuft
    const e = p === '/dev/null' ? null : schreiben(w, z, anh ? '' : '', anh, w.root);
    if (e) return frueh(`bash: ${z}: ${e}`);
    if (!anh && p !== '/dev/null' && !(p in offen)) w.fs[p] = '';
    offen[p] = offen[p] ?? [];
    const ziel: Ziel = { art: 'datei', datei: p, anh: true };
    if (u.fd === 1 || u.fd === 3) fd1 = ziel;
    if (u.fd === 2 || u.fd === 3) fd2 = ziel;
  }
  // set -x: Die Shell zeigt jeden Befehl nach der Erweiterung mit „+ “ davor
  const spur = stand(w).optionen.x ? (args.length ? '+ ' + args.map((x) => (/[\s'"]/.test(x) || x === '' ? `'${x}'` : x)).join(' ') : Object.entries(temp).map(([k, v]) => `+ ${k}=${v}`).join('\n')) : '';
  let r: Ergebnis;
  // Manche Programme (ls) verhalten sich anders, wenn ihre Ausgabe nicht im Terminal landet
  w.stdoutTty = fd1.art === 'tty';
  if (!args.length) r = ok();
  else {
    if (args[0] === 'sudo') {
      args = args.slice(1);
      // sudo -l [-U benutzer]: Rechte aus /etc/sudoers anzeigen
      if (args.includes('-l') && args.every((x, k) => x.startsWith('-') || args[k - 1] === '-U')) { const l = befehle.__sudo_l(w, args, '', true); return l.code ? frueh(l.err ?? '') : { out: l.out, err: '', code: 0, tty: l.out }; }
      while (args[0]?.startsWith('-') && args[0] !== '-i' && args[0] !== '-s') args.shift();
      // sudo liest /etc/sudoers bei jedem Aufruf. Eine kaputte Datei sperrt alle aus.
      if (!rootStart && args.length) {
        const prog = args[0] === '-i' || args[0] === '-s' ? '/bin/bash' : args[0].startsWith('/') ? args[0] : ['/usr/bin/', '/usr/sbin/', '/usr/local/bin/', '/usr/local/sbin/'].map((d) => d + args[0]).find((p) => p in w.fs) ?? '/usr/bin/' + args[0];
        const f = sudoErlaubt(w, w.user, args.join(' '), prog);
        if (f) return frueh(f);
      }
      if (args[0] === '-i' || args[0] === '-s' || (args[0] === 'su' && args.length <= 2 && (!args[1] || ['-', '-l', '--login', 'root'].includes(args[1])))) {
        const login = args[0] === '-i' || args[1] === '-' || args[1] === '-l' || args[1] === '--login';
        const st = shellStarten(w, { login, root: true });
        const t = ['[sudo] Passwort für lena: (im Simulator nicht nötig)', st.err, st.out, 'Du bist jetzt root. Mit "exit" kommst du zurück.'].filter(Boolean).join('\n');
        return { ...ok(t), tty: t };
      }
      if (!args.length) return frueh('usage: sudo -h | -K | -k | -V');
      root = true;
      // sudo nutzt secure_path und kennt keine Aliase und keine eingebauten Befehle der Shell
      if (EINGEBAUT[args[0]] && !befehle[args[0]]) return { out: '', err: `sudo: ${args[0]}: Befehl nicht gefunden`, code: 1, tty: '' };
    }
    const name = args[0]; const viaSudo = root && !rootStart;
    const altEnv = w.env;
    if (Object.keys(temp).length) w.env = { ...w.env, ...temp };
    try {
      const fn = !viaSudo ? funktionAufrufen(w, name, args.slice(1), stdin, root) : null;
      if (fn) r = fn;
      else if (EINGEBAUT[name] && (!viaSudo || AUCH_EXTERN.has(name))) r = EINGEBAUT[name](w, args.slice(1), stdin, root);
      // sudo startet Programme und kennt die eingebauten Befehle der Shell nicht
      else if (EINGEBAUT[name]) r = fehler(`sudo: ${name}: Befehl nicht gefunden`);
      else if (['bash', 'sh', 'dash'].includes(name) && (!args[1] || ['-l', '--login', '-i'].includes(args[1]))) {
        if (viaSudo) { const st = shellStarten(w, { login: args[1] === '-l' || args[1] === '--login', root: true }); r = { ...st, out: [st.out, 'Du bist jetzt root. Mit "exit" kommst du zurück.'].filter(Boolean).join('\n') }; }
        else r = shellStarten(w, { login: args[1] === '-l' || args[1] === '--login' });
      }
      else if (['bash', 'sh'].includes(name) && args[1] === '-c') {
        // Eine neue Shell erbt nur exportierte Variablen, keine Shell-Variablen und keine Aliase
        const alt = { vars: w.vars, env: w.env, cwd: w.cwd, aliase: w.aliase };
        w.vars = {}; w.env = { ...w.env }; w.aliase = {};
        const sk = stand(w); const altF = { f: sk.funktionen, t: sk.funkText }; sk.funktionen = {}; sk.funkText = {}; sk.skript++;
        w.args.push([args[3] ?? name, ...args.slice(4)]);
        try { const p = programm(w, args[2] ?? '', stdin, root, { name: `${name}: -c` }); r = { out: p.out, err: p.err, code: p.code }; }
        finally { Object.assign(w, alt); w.args.pop(); sk.funktionen = altF.f; sk.funkText = altF.t; sk.skript--; }
      }
      else if (['bash', 'sh', 'dash'].includes(name) && args[1]) {
        // bash -x skript zeigt jede Zeile, bash -n prüft nur die Syntax
        const opt = new Set<string>(); let k = 1;
        while (args[k] && /^-[xnev]+$/.test(args[k])) { for (const c of args[k].slice(1)) opt.add(c); k++; }
        if (!args[k]) r = shellStarten(w, { login: false });
        else if (opt.has('n')) {
          const p = pfad(w, args[k]);
          if (!(p in w.fs) || w.fs[p] === null) r = fehler(`${name}: ${args[k]}: Datei oder Verzeichnis nicht gefunden`, 127);
          else { const z = zerlegenProgramm(w.fs[p] ?? ''); r = 'fehler' in z ? fehler(`${args[k]}: Zeile ${z.z}: ${z.fehler}`, 2) : ok(); }
        } else r = skriptMitOptionen(w, args[k], args.slice(k), stdin, root, { x: opt.has('x'), e: opt.has('e') });
      }
      else if (name.includes('/')) r = pfadStarten(w, name, pfad(w, name), args.slice(1), stdin, root);
      else {
        // root (sudo, sudo -i) sucht in secure_path, lena in ihrem eigenen PATH
        const fund = imPath(w, name, root ? ROOT_PATH : w.env.PATH)[0];
        if (!fund) r = viaSudo ? fehler(`sudo: ${name}: Befehl nicht gefunden`) : fehler(`bash: ${name}: Befehl nicht gefunden${name === 'vim' ? ' (Debian 12 bringt nur vim.tiny als vi mit. Tippe vi.)' : ''}`, 127);
        else if (befehle[name] && gleichwertig(fund.replace(/\/[^/]+$/, '')) === ortVon(name)) r = befehle[name](w, args.slice(1), stdin, root);
        else r = pfadStarten(w, name, fund, args.slice(1), stdin, root);
      }
    } finally { if (Object.keys(temp).length) w.env = altEnv; }
  }
  if (r.out === '\u001bclear') return { ...r, tty: '\u001bclear' };
  // Ausgaben verteilen
  let tty = ''; let pipe = '';
  const ohneNL = r.out.endsWith('\u0000ohneNL'); const out = r.out.replace('\u0000ohneNL', '');
  const ablegen = (z: Ziel, text: string, stdout: boolean) => {
    if (!text) return;
    if (z.art === 'tty') tty += (tty && !tty.endsWith('\n') ? '\n' : '') + text;
    else if (z.art === 'pipe') pipe += (pipe && !pipe.endsWith('\n') ? '\n' : '') + text + (stdout && ohneNL ? '' : '\n');
    else if (z.datei !== '/dev/null') { w.fs[z.datei!] = (w.fs[z.datei!] ?? '') + text + (stdout && ohneNL ? '' : '\n'); beruehren(w, z.datei!); }
  };
  // Meist erscheint stderr zuerst (ungepuffert). Manche Befehle melden ihre Zusammenfassung erst am Ende.
  if (spur) ablegen(fd2, spur, false);
  // Skripte und Funktionen: Ausgabe und Fehler erscheinen im Terminal in der Reihenfolge, in der sie entstanden
  if (fd1.art === 'tty' && fd2.art === 'tty' && typeof (r as any).misch === 'string') ablegen(fd1, (r as any).misch.replace(/\u0000ohneNL/g, ''), true);
  else if ((r as any).errNach) { ablegen(fd1, out, true); ablegen(fd2, r.err ?? '', false); }
  else { ablegen(fd2, r.err ?? '', false); ablegen(fd1, out, true); }
  // Harte Links: Was über einen Namen geschrieben wurde, gilt für alle
  linksAbgleichen(w);
  return { out: pipe, code: r.code, tty, ende: (r as any).ende } as Ergebnis & { tty: string };
}

/** Eine ganze Zeile ausführen (Ketten, Pipelines, Hintergrund). Gibt stdout und stderr getrennt zurück. */
/** Wie der Prozess in ps heißt: Skripte unter ihrem Namen, nohup und nice verschwinden. */
function prozessName(text: string, lang: string) {
  const t = text.replace(/^(nohup|nice(\s+-n\s*-?\d+|\s+-\d+)?)\s+/, '').replace(/^(nohup)\s+/, '').replace(/\s*[<>]+.*$/, '');
  if (/^(\.\/|\/|bash\s|sh\s)/.test(t) && !t.startsWith(lang.split(' ')[0])) return /^(bash|sh)\s/.test(t) ? t : '/bin/bash ' + t;
  return lang;
}

type ZeilenErgebnis = { tty: string; out: string; err: string; code: number; ende?: unknown };
function vordergrundBelegen(w: Welt, text: string, root: boolean, tty: string[]) {
  const pid = w.naechstePid++;
  w.prozesse.push({ pid, user: root || w.root ? 'root' : 'lena', cmd: prozessName(text, w.langlaeufer!), ppid: 1203, ni: w.langNice ?? w.nice, tty: 'pts/0', stat: 'S+', start: '08:41', cpu: /render|yes/.test(text) ? 49.8 : 0.3, mem: 0.1 });
  w.vordergrund = { pid, cmd: text };
  w.langlaeufer = null;
  tty.push(`(${text} läuft im Vordergrund. Strg+Z hält den Befehl an, Strg+C bricht ihn ab.)`);
}
function zeileAusfuehren(w: Welt, zeile: string, stdin: string, root: boolean, interaktiv: boolean, roh = false, schlicht = false): ZeilenErgebnis {
  // Kontrollstrukturen (if, for, while, case, Funktionen) übernimmt der Interpreter in shell-skript.ts
  if (!schlicht && istZusammengesetzt(zeile)) {
    w.langlaeufer = null;
    const r = programm(w, zeile, stdin, root, interaktiv ? { tty: stand(w).eingabeTty } : {});
    if (interaktiv) {
      const tty = [r.misch.replace(/\u0000ohneNL/g, '')];
      if (w.langlaeufer) vordergrundBelegen(w, zeile.split('\n')[0], root, tty);
      return { tty: tty.filter(Boolean).join('\n'), out: '', err: '', code: r.code, ende: r.ende };
    }
    const o = r.out.endsWith('\u0000ohneNL') ? r.out.slice(0, -7) : r.out;
    return { tty: '', out: roh ? (r.out.endsWith('\u0000ohneNL') ? o : o ? o + '\n' : '') : o, err: r.err ?? '', code: r.code, ende: r.ende };
  }
  const ketten = parsen(w, zeile);
  if (typeof ketten === 'string') return { tty: ketten, out: '', err: ketten, code: 2 };
  const tty: string[] = []; let code = w.letzterCode; const outs: string[] = []; const errs: string[] = [];
  const st = stand(w); const ttyVorher = st.eingabeTty;
  try {
  for (const k of ketten) {
    if (k.verbinder === '&&' && code !== 0) continue;
    if (k.verbinder === '||' && code === 0) continue;
    let eingabe = stdin; let ende: unknown = false;
    if (k.hintergrund) {
      const nr = (w.jobs.length ? Math.max(...w.jobs.map((j) => j.nr)) : 0) + 1; const pid = w.naechstePid++;
      w.langlaeufer = null; w.langNice = undefined;
      const altNohup = w.nohup;
      const tt: string[] = [];
      for (const [i, c] of k.pipeline.entries()) { st.eingabeTty = i === 0 && ttyVorher; const r = einfachAusfuehren(w, c, eingabe, root, i === k.pipeline.length - 1); if (r.tty) tt.push(r.tty); eingabe = r.out; code = r.code; }
      st.eingabeTty = ttyVorher;
      const laeuft = w.langlaeufer;
      const job: Job = { nr, pid, cmd: k.text, status: laeuft ? 'Running' : 'Done' };
      if (laeuft) { w.prozesse.push({ pid, user: root || w.root ? 'root' : 'lena', cmd: prozessName(k.text, laeuft), ppid: 1203, ni: w.langNice ?? w.nice, tty: 'pts/0', stat: 'S', start: '08:41', cpu: /render|yes|make/.test(k.text) ? 49.8 : 0, mem: 0.1, nohup: w.nohup }); }
      w.jobs.push(job); w.nohup = altNohup; w.langlaeufer = null;
      tty.push(`[${nr}] ${pid}`, ...tt);
      if (!laeuft) w.meldungen.push(`[${nr}]+  Fertig                  ${k.text}`);
      code = 0; w.letzterCode = 0;
      continue;
    }
    w.langNice = undefined;
    const nicht = k.pipeline[0]?.woerter[0] === '!';
    if (nicht) k.pipeline[0].woerter.shift();
    for (const [i, c] of k.pipeline.entries()) {
      w.langlaeufer = null;
      st.eingabeTty = i === 0 && ttyVorher;
      const r = einfachAusfuehren(w, c, eingabe, root, i === k.pipeline.length - 1 && interaktiv);
      st.eingabeTty = ttyVorher;
      if (r.tty === '\u001bclear') return { tty: '\u001bclear', out: '', err: '', code: 0 };
      if (r.tty) { if (interaktiv) tty.push(r.tty); else errs.push(r.tty); }
      eingabe = r.out; code = r.code; if ((r as any).ende) ende = (r as any).ende;
    }
    if (nicht) code = code ? 0 : 1;
    if (!interaktiv) outs.push(roh ? eingabe : eingabe.replace(/\n$/, ''));
    w.letzterCode = code;
    // Ein Befehl, der weiterläuft (sleep 100, top, tail -f), belegt jetzt den Vordergrund
    if (interaktiv && w.langlaeufer) { vordergrundBelegen(w, k.text, root, tty); break; }
    if (ende) return { tty: tty.join('\n'), out: roh ? outs.join('') : outs.join('\n'), err: errs.join('\n'), code, ende };
  }
  } catch (e) {
    st.eingabeTty = ttyVorher;
    if (e instanceof BrauchtEingabe) e.bisher = [...tty, ...errs, ...outs].filter(Boolean).map((x) => x.replace(/\n$/, '')).join('\n') + (tty.length + errs.length + outs.length ? '\n' : '') + e.bisher;
    throw e;
  }
  return { tty: tty.filter((x) => x !== '').join('\n'), out: roh ? outs.join('') : outs.filter(Boolean).join('\n'), err: errs.join('\n'), code };
}

/** Für Befehlsersetzung, xargs, find -exec, Skripte: stdout getrennt von stderr. */
function intern(w: Welt, zeile: string, stdin: string, root: boolean): Ergebnis {
  const r = zeileAusfuehren(w, zeile, stdin, root, false);
  return { out: r.out, err: r.err || undefined, code: r.code, ...(r.ende ? { ende: true } : {}) } as Ergebnis;
}

/** Verlaufserweiterung: !!, !n, !-n, !text, !$ */
function verlaufErweitern(w: Welt, zeile: string): string | { fehler: string } {
  if (!zeile.includes('!')) return zeile;
  let out = ''; let q: string | null = null;
  for (let i = 0; i < zeile.length; i++) {
    const c = zeile[i];
    if (c === "'" && q !== '"') { q = q ? null : "'"; out += c; continue; }
    if (c === '"' && q !== "'") { q = q ? null : '"'; out += c; continue; }
    if (c !== '!' || q === "'" || /[\s=(]/.test(zeile[i + 1] ?? ' ')) { out += c; continue; }
    // Wie die Bash: [!…] in Mustern und ${!var} sind keine Verlaufserweiterung
    if ((zeile[i - 1] === '[' && zeile.slice(i + 1).includes(']')) || (zeile[i - 1] === '{' && zeile[i - 2] === '$')) { out += c; continue; }
    const rest = zeile.slice(i + 1); let m: RegExpMatchArray | null = null; let treffer: string | undefined;
    if (rest[0] === '!') { treffer = w.historie[w.historie.length - 1]; i += 1; }
    else if (rest[0] === '$') { treffer = lexen(w.historie[w.historie.length - 1] ?? '').filter((t) => t.t === 'w').pop()?.v; i += 1; }
    else if ((m = rest.match(/^-(\d+)/))) { treffer = w.historie[w.historie.length - Number(m[1])]; i += m[0].length; }
    else if ((m = rest.match(/^(\d+)/))) { treffer = w.historie[Number(m[1]) - 1]; i += m[0].length; }
    else if ((m = rest.match(/^([^\s;|&]+)/))) { const t = m[1]; treffer = [...w.historie].reverse().find((h) => h.startsWith(t)); i += m[0].length; }
    if (treffer === undefined) return { fehler: `bash: !${rest.match(/^[^\s;|&]+/)?.[0] ?? ''}: event not found` };
    out += treffer;
  }
  return out;
}

export function ausfuehren(w: Welt, zeile: string): Lauf {
  w.uhr += 20000; w.nohup = false;
  // Strg+C und Strg+Z aus dem Terminal
  if (zeile === '\u0003' || zeile === '\u001a') {
    const v = w.vordergrund;
    if (!v) {
      const sk = stand(w);
      if (zeile === '\u0003' && (sk.fortsetzung !== undefined || w.dialog)) { sk.fortsetzung = undefined; w.dialog = null; w.letzterCode = 130; }
      w.verlauf.push({ zeile: zeile === '\u0003' ? '#strg-c' : '#strg-z', code: 0, ausgabe: '' }); return { ausgabe: zeile === '\u0003' ? '^C' : '', code: 0 };
    }
    w.vordergrund = null;
    const p = w.prozesse.find((x) => x.pid === v.pid);
    if (zeile === '\u0003') {
      w.prozesse = w.prozesse.filter((x) => x.pid !== v.pid);
      w.jobs = w.jobs.filter((j) => j.pid !== v.pid);
      w.letzterCode = 130;
      w.verlauf.push({ zeile: '#strg-c', code: 130, ausgabe: '' });
      return { ausgabe: '^C', code: 130 };
    }
    if (p) p.stat = 'T';
    let j = w.jobs.find((x) => x.pid === v.pid);
    if (!j) { j = { nr: (w.jobs.length ? Math.max(...w.jobs.map((x) => x.nr)) : 0) + 1, pid: v.pid, cmd: v.cmd, status: 'Stopped' }; w.jobs.push(j); }
    j.status = 'Stopped';
    w.letzterCode = 148;
    w.verlauf.push({ zeile: '#strg-z', code: 148, ausgabe: '' });
    return { ausgabe: `^Z\n[${j.nr}]+  Angehalten              ${j.cmd}`, code: 148 };
  }
  // Strg+D: Ende der Eingabe für at und andere Programme, die bis Dateiende lesen
  if (zeile === '\u0004') {
    if (w.dialog) { const out = w.dialog.eingabe('\u0004'); w.verlauf.push({ zeile: '#strg-d', code: 0, ausgabe: out }); return { ausgabe: out.replace(/^\n+/, ''), code: 0 }; }
    return { ausgabe: '(Strg+D an einer leeren Zeile würde die Shell beenden. Im Simulator bleibst du angemeldet.)', code: 0 };
  }
  // Interaktives Programm (fdisk): Die Zeile geht an das Programm, nicht an die Shell
  if (w.dialog) {
    const out = w.dialog.eingabe(zeile);
    w.verlauf.push({ zeile: '#dialog ' + zeile.trim(), code: 0, ausgabe: out });
    return { ausgabe: out.replace(/^\n+/, ''), code: 0 };
  }
  dsysVorZeile(w, zeile); speicherVorZeile(w);
  let roh = zeile.replace(/\s+$/, '');
  // Unvollständige Eingabe (if ohne fi, offene Anführungszeichen): weiter mit dem Prompt „> “
  const sk = stand(w);
  let fortsetzungAlt: string | undefined;
  if (sk.fortsetzung !== undefined && !w.wartet && !w.vordergrund) { fortsetzungAlt = sk.fortsetzung; sk.fortsetzung = undefined; }
  if (w.vordergrund && !w.wartet) return { ausgabe: `(${w.vordergrund.cmd} läuft noch im Vordergrund. Drücke Strg+Z zum Anhalten oder Strg+C zum Abbrechen.)`, code: 0 };
  if (!roh.trim() && !w.wartet && fortsetzungAlt === undefined) return { ausgabe: meldungenAbholen(w), code: 0 };
  if (w.aus === 'firmware' || w.aus === 'grub') return { ausgabe: `${w.aus === 'firmware' ? 'No bootable device found.' : 'GRUB wartet.'}\n\n(Mit "Neu starten" unter dem Terminal beginnt der Start von vorn.)`, code: 1 };
  if (w.aus === 'kernelfehler') return { ausgabe: `${(w as Welt & { kernelMeldung?: string }).kernelMeldung ?? 'Kernel panic'}\n\n(Der Start ist gescheitert. Mit "Neu starten" unter dem Terminal wählst du im GRUB-Menü den alten Kernel.)`, code: 1 };
  if (w.aus) return { ausgabe: `Das System ist ${w.aus === 'reboot' ? 'gerade beim Neustart' : 'heruntergefahren'}. Mit "Neu starten" unter dem Terminal geht es weiter.`, code: 1 };
  // Offene Rückfrage wie „Do you want to continue? [Y/n]“
  if (w.wartet) {
    const { standardJa, aktion, nein } = w.wartet; w.wartet = null;
    const a = roh.trim().toLowerCase();
    const ja = a === 'y' || a === 'j' || a === 'yes' || a === 'ja' || (a === '' && standardJa);
    const r = ja ? aktion() : { out: nein ?? 'Abort.\n(Abgebrochen. Mit -y beantwortet der Befehl die Rückfrage selbst.)', code: 1 };
    const text = [r.err, r.out].filter(Boolean).join('\n');
    w.verlauf.push({ zeile: `#antwort ${ja ? 'ja' : 'nein'}`, code: r.code, ausgabe: text });
    return { ausgabe: text, code: r.code };
  }
  // Verlauf: !! und Co. erweitern; die Bash zeigt die erweiterte Zeile vorher an
  // In Fortsetzungszeilen gilt das nur für die neue Zeile, in Here-Dokumenten gar nicht
  const imHereDok = fortsetzungAlt !== undefined && /Here-Dokument/.test(((zerlegenProgramm(fortsetzungAlt) as { fehler?: string }).fehler) ?? '');
  const erw = imHereDok ? roh : verlaufErweitern(w, roh);
  if (typeof erw !== 'string') { w.verlauf.push({ zeile: roh, code: 1, ausgabe: erw.fehler }); w.letzterCode = 1; return { ausgabe: erw.fehler, code: 1 }; }
  const vorspann = erw !== roh ? erw + '\n' : '';
  if (erw !== roh) w.verlauf.push({ zeile: '#roh ' + roh.trim(), code: 0, ausgabe: '' });
  roh = fortsetzungAlt !== undefined ? fortsetzungAlt + '\n' + erw : erw;
  // Unvollständige Eingabe (if ohne fi, offene Anführungszeichen, Here-Dokument): weiter mit dem Prompt „> “
  if (roh.trim() && !w.aus && istZusammengesetzt(roh)) {
    const p = zerlegenProgramm(roh);
    if ('fehler' in p && p.eof) { sk.fortsetzung = roh; return { ausgabe: vorspann.replace(/\n$/, ''), code: 0 }; }
  }
  // HISTCONTROL=ignoreboth: Zeilen mit Leerzeichen am Anfang und direkte Wiederholungen kommen nicht in den Verlauf
  const hc = w.vars.HISTCONTROL ?? w.env.HISTCONTROL ?? '';
  const ignSpace = /ignorespace|ignoreboth/.test(hc); const ignDup = /ignoredups|ignoreboth/.test(hc);
  // Mehrzeilige Befehle speichert die Bash als eine Zeile im Verlauf
  const histZeile = roh.trim().split('\n').map((x) => x.trim()).filter(Boolean).reduce((a, x) => (!a ? x : /(\bdo|\bthen|\belse|\bin|[{|]|&&|\|\|)$/.test(a) || x === ';;' ? a + ' ' + x : a + '; ' + x), '');
  if (!(ignSpace && roh.startsWith(' ')) && !(ignDup && w.historie[w.historie.length - 1] === histZeile)) w.historie.push(histZeile);
  // read darf im Terminal nach einer Eingabe fragen. Dann läuft die Zeile mit der Antwort noch einmal von vorn.
  const { dialog: _d, wartet: _wt, ...rest } = w; void _d; void _wt;
  const sicherung = structuredClone(rest);
  const lauf = (antworten: string[], gezeigt: number): { r: ZeilenErgebnis } | { warte: string; text: string } => {
    for (const k of Object.keys(w)) if (!(k in sicherung) && k !== 'dialog' && k !== 'wartet') delete (w as any)[k];
    Object.assign(w, structuredClone(sicherung));
    const s2 = stand(w); s2.terminal = { antworten: [...antworten] }; s2.eingabeTty = true;
    try { return { r: zeileAusfuehren(w, roh.trim(), '', w.root, true) }; }
    catch (e) {
      if (!(e instanceof BrauchtEingabe)) throw e;
      const text = e.bisher.slice(gezeigt);
      w.dialog = { prompt: e.prompt, eingabe: (z: string) => {
        w.dialog = null;
        const neu = [...antworten, z];
        const weiter = lauf(neu, gezeigt + text.length);
        if ('warte' in weiter) return weiter.text.replace(/\n$/, '');
        const r2 = weiter.r;
        const alles = [r2.tty, meldungenAbholen(w)].filter(Boolean).join('\n');
        w.verlauf.push({ zeile: roh.trim(), code: r2.code, ausgabe: alles });
        return alles.slice(gezeigt + text.length).replace(/^\n/, '');
      } };
      return { warte: e.prompt, text };
    }
    finally { stand(w).terminal = null; stand(w).eingabeTty = false; }
  };
  const erster = lauf([], 0);
  if ('warte' in erster) return { ausgabe: vorspann + erster.text.replace(/\n$/, ''), code: 0 };
  const r = erster.r;
  if (r.tty === '\u001bclear') { w.verlauf.push({ zeile: roh.trim(), code: 0, ausgabe: '' }); return { ausgabe: '', code: 0, clear: true }; }
  const ausgabe = vorspann + [r.tty, meldungenAbholen(w)].filter(Boolean).join('\n');
  w.verlauf.push({ zeile: roh.trim(), code: r.code, ausgabe });
  return { ausgabe: ausgabe.replace(/\n$/, ''), code: r.code };
}

function meldungenAbholen(w: Welt) {
  const m = w.meldungen.join('\n'); w.meldungen = [];
  w.jobs = w.jobs.filter((j) => j.status !== 'Done');
  return m;
}

export function prompt(w: Welt) {
  if (w.dialog) return w.dialog.prompt;
  if (stand(w).fortsetzung !== undefined) return '> ';
  if (w.wartet || w.vordergrund) return '';
  const ort = w.cwd === '/home/lena' ? '~' : w.cwd.startsWith('/home/lena/') ? '~' + w.cwd.slice('/home/lena'.length) : w.cwd;
  const user = w.root ? 'root' : 'lena';
  if (w.distro === 'alma') return `[${user}@${w.host} ${w.root && ort.startsWith('~') ? ort.replace(/^~/, '/home/lena').split('/').pop() : ort === '~' ? '~' : ort.split('/').pop() || '/'}]${w.root ? '#' : '$'} `;
  if (w.distro === 'suse') return `${user}@${w.host}:${w.root ? ort.replace(/^~/, '/home/lena') : ort}${w.root ? ' #' : '>'} `;
  return w.root ? `root@${w.host}:${ort.replace(/^~/, '/home/lena')}# ` : `lena@${w.host}:${ort}$ `;
}

export function neuStarten(w: Welt): string | undefined {
  neustartPakete(w);
  w.wartet = null;
  w.aus = null; w.shutdown = null; w.root = false;
  w.runlevelVorher = 'N'; w.target = w.defaultTarget;
  // Nach dem Neustart lädt udev die Module neu – außer gesperrten.
  const { schwarz, install } = blacklist(w);
  for (const n of START_GELADEN) if (!schwarz.has(n) && !install[n]) w.geladen[n] = [];
  for (const n of Object.keys(w.geladen)) if (schwarz.has(n) || install[n]) delete w.geladen[n];
  // Nach dem Neustart sind alle Sitzungen, Jobs und gestarteten Prozesse weg
  w.jobs = []; w.vordergrund = null; w.langlaeufer = null; w.meldungen = [];
  // Nach dem Neustart gibt es nur noch die erste Shell
  const sk = stand(w);
  while (sk.shells.length) { const f = sk.shells.shift()!; if (!sk.shells.length) { w.vars = f.vars; w.env = f.env; w.aliase = f.aliase; sk.funktionen = f.funktionen; sk.funkText = f.funkText; w.cwd = f.cwd; } }
  sk.funktionen = {}; sk.funkText = {}; sk.fortsetzung = undefined; sk.optionen = {}; sk.login = false; w.dialog = null;
  w.env.SHLVL = '1';
  w.prozesse = w.prozesse.filter((p) => p.pid < 4000 && p.user !== 'max');
  benutzerBerechnen(w);
  if (startAktiv(w)) {
    const v = startVorKernel(w);
    if (v?.startsWith('__WEITER__')) return v.slice(10);
    if (w.aus || w.dialog) return v;
    return [v, bootWeiter(w)].filter(Boolean).join('\n');
  }
  return kernNeustart(w, START_GELADEN);
}
/** Teil des Starts nach dem Bootloader: Kernel, Module, dann Dienste und fstab. */
function bootWeiter(w: Welt): string {
  const k = kernNeustart(w, START_GELADEN);
  if (w.aus) return k ?? '';
  return [k, startNachKernel(w)].filter(Boolean).join('\n');
}

Object.assign(befehle, paketBefehle({ ok, fehler, optionen, pfad, schreiben }));
Object.assign(befehle, skriptBefehle());
Object.assign(befehle, x11Befehle());
Object.assign(befehle, adminBefehle());
adminKern({
  rechte: (w, p, mode, owner, group) => { const m = meta(w, p); m.mode = mode; m.owner = owner; m.group = group; },
  dialog: (w, prompt, weiter) => { w.dialog = { prompt, eingabe: (z) => { w.dialog = null; return weiter(z); } }; },
  heute: (w) => Math.floor(w.uhr / 86400000),
});
{
  const altId = befehle.id; const altGroups = befehle.groups;
  befehle.id = (w, a, i, r) => idFuer(w, a, r) ?? altId(w, a, i, r);
  befehle.groups = (w, a, i, r) => { const n = a.find((x) => !x.startsWith('-')); if (!n || n === 'lena') return altGroups(w, a, i, r); const g = gruppenVon(w, n); return g.length ? ok(`${n} : ${g.join(' ')}`) : fehler(`groups: »${n}«: Diesen Benutzer gibt es nicht`); };
}
befehle.su = (w, a, _i, root) => {
  const r = suBefehl(w, a, root);
  if (r.dialog) { const d = r.dialog; w.dialog = { prompt: 'Passwort: ', eingabe: (z) => { w.dialog = null; return d(z); } }; return ok(''); }
  return r;
};
for (const n of ['test', '[']) befehle[n] = (w, a, i, r) => EINGEBAUT[n](w, a, i, r);
skriptKern({
  zeile: (w, text, stdin, root) => zeileAusfuehren(w, text, stdin, root, false, true, true),
  woerter: (w, text, root) => lexen(text).filter((t) => t.t === 'w').flatMap((t) => erweitern(w, t.v, root)),
  erweitern, variable, pfad, darf, schreiben,
  muster: (m) => new RegExp(musterRegex(m).source.replace(/\[\^\/\]\*/g, '.*').replace(/\[\^\/\]/g, '.'), 's'),
  mtime: (w, p) => meta(w, p).mtime,
  quelle: (w, p, root) => skript(w, p, [p], '', root, true),
  rechte: (w, p, mode, owner, group) => { const m = meta(w, p); m.mode = mode; m.owner = owner; m.group = group; },
});
Object.assign(befehle, plattenBefehle({ ok, fehler, pfad, kinder }));
Object.assign(befehle, rechteBefehle({ ok, fehler, pfad, kinder }));
// systemctl: Mount-Units und daemon-reload gehen an das Plattenmodell
const altSystemctl = befehle.systemctl;
befehle.systemctl = (w, a, i, r) => {
  const rest = a.filter((x) => !x.startsWith('-'));
  if (rest[0] === 'daemon-reload' || rest.some((x) => x.endsWith('.mount'))) return befehle.__mountunit(w, rest, i, r);
  return altSystemctl(w, a, i, r);
};
const procCat = befehle.cat;
Object.assign(befehle, textBefehle({ ok, fehler, optionen, pfad, kinder, schreiben, intern: (w, zeile, stdin, root) => intern(w, zeile, stdin, root), frage: (w, text, standardJa, aktion) => { w.wartet = { standardJa, aktion }; return ok(text); } }));
const textCat = befehle.cat;
// Geplante Aufgaben, Zeitzonen und Sprache (ersetzt auch das einfache date aus shell-text)
Object.assign(befehle, zeitBefehle());
zeitKern({
  dialog: (w, prompt, weiter) => { w.dialog = { prompt, eingabe: (z) => { w.dialog = null; return weiter(z); } }; },
  vi: (w, p, nach) => { (w as Welt & { viNach?: unknown }).viNach = { pfad: p, nach }; return viStart(w, [p], w.root); },
  rechte: (w, p, mode, owner, group) => { const m = meta(w, p); m.mode = mode; m.owner = owner; m.group = group; },
  pfad,
});
{
  const vorher = befehle.systemctl;
  befehle.systemctl = (w, a, i, r) => timerSystemctl(w, a, r || w.root) ?? dienstSystemctl(w, a, r || w.root) ?? vorher(w, a, i, r);
}
// Systemdienste aus Topic 108: Uhr, Protokolle, Mail, Drucken
dienstKern({
  rechte: (w, p, mode, owner, group) => { const m = meta(w, p); m.mode = mode; m.owner = owner; m.group = group; },
  pfad, datum: (w, ms, fmt) => datumFormat(w, ms, fmt),
  muster: (m) => new RegExp(musterRegex(m).source.replace(/\[\^\/\]\*/g, '.*').replace(/\[\^\/\]/g, '.'), 's'),
});
Object.assign(befehle, dienstBefehle({ ...befehle }));
// Netzwerk aus Topic 109
netzKern({ datum: (w, ms, fmt) => datumFormat(w, ms, fmt) });
Object.assign(befehle, netzBefehle({ ...befehle }));
// Sicherheit aus Topic 110
sicherKern({
  dialog: (w, prompt, weiter) => { w.dialog = { prompt, eingabe: (z) => { w.dialog = null; return weiter(z); } }; },
  zeile: (w, z, stdin, root) => zeileAusfuehren(w, z, stdin, root, false, true, true),
  vi: (w, p, nach) => { (w as Welt & { viNach?: unknown }).viNach = { pfad: p, nach }; return viStart(w, [p], true); },
  rechte: (w, p, mode, owner, group) => { const m = meta(w, p); m.mode = mode; m.owner = owner; m.group = group; },
  modus: (w, p) => meta(w, p).mode,
  pfad,
});
Object.assign(befehle, sicherBefehle({ ...befehle }));
{
  const vorher = befehle.systemctl;
  befehle.systemctl = (w, a, i, r) => sicherSystemctl(w, a, r || w.root) ?? vorher(w, a, i, r);
  // ulimit und eval sind eingebaute Befehle der Shell
  EINGEBAUT.ulimit = befehle.ulimit; EINGEBAUT.eval = befehle.eval; delete befehle.ulimit; delete befehle.eval;
}
// Last und Kapazität aus LPIC-2 Topic 200
lastKern({ rechte: (w, p, mode, owner, group) => { const m = meta(w, p); m.mode = mode; m.owner = owner; m.group = group; }, datum: (w, ms, fmt) => datumFormat(w, ms, fmt), dialog: (w, prompt, weiter) => { w.dialog = { prompt, eingabe: (z) => { w.dialog = null; return weiter(z); } }; } });
Object.assign(befehle, lastBefehle({ ...befehle }));
{
  const vorher = befehle.systemctl;
  befehle.systemctl = (w, a, i, r) => lastSystemctl(w, a, r || w.root) ?? vorher(w, a, i, r);
  // Nach apt install sysstat liegt die echte /etc/default/sysstat bereit
  for (const n of ['apt', 'apt-get']) { const alt = befehle[n]; befehle[n] = (w, a, i, r) => { const x = alt(w, a, i, r); sysstatPruefen(w); return x; }; }
}
// Kernel aus LPIC-2 Topic 201
kernKern({ pfad, dialog: (w, prompt, weiter) => { w.dialog = { prompt, eingabe: (z) => { w.dialog = null; return weiter(z); } }; }, benutzer: benutzerBerechnen, modulPfad, installieren: paketeSetzen, paketExtra: paketHinzu });
kernGrub(grubSchreiben);
Object.assign(befehle, kernBefehle({ ...befehle }));
kernBefehleRef(befehle);
for (const n of ['apt', 'apt-get']) {
  const alt = befehle[n];
  befehle[n] = (w, a, i, r) => {
    const x = alt(w, a, i, r);
    // Mit Rückfrage [Y/n] wird erst nach der Antwort installiert
    if (w.wartet) { const wt = w.wartet; const ak = wt.aktion; wt.aktion = () => { const y = ak(); startNachApt(w); dsysNachApt(w); speicherNachApt(w); const e = kernNachApt(w); return e ? { ...y, out: [y.out, e].filter(Boolean).join('\n') } : y; }; }
    startNachApt(w); dsysNachApt(w); speicherNachApt(w);
    const extra = kernNachApt(w); return extra ? { ...x, out: [x.out, extra].filter(Boolean).join('\n') } : x;
  };
}
// Systemstart aus LPIC-2 Topic 202
startKern({
  pfad, dialog: (w, prompt, weiter) => { w.dialog = { prompt, eingabe: (z) => { w.dialog = null; return weiter(z); } }; },
  vi: (w, p, nach) => { (w as Welt & { viNach?: unknown }).viNach = { pfad: p, nach }; return viStart(w, [p], true); },
  weiterStarten: (w) => bootWeiter(w), grub: (w) => grubSchreiben(w), installieren: paketeSetzen,
});
Object.assign(befehle, startBefehle({ ...befehle }));
{ const altExec = EINGEBAUT.exec; EINGEBAUT.exec = (w, a, i, r) => initExec(w, a) ?? altExec(w, a, i, r); }
// Dateisysteme aus LPIC-2 Topic 203
fsKern({ pfad, dialog: (w, prompt, weiter) => { w.dialog = { prompt, eingabe: (z) => { w.dialog = null; return weiter(z); } }; } });
Object.assign(befehle, dsysBefehle({ ...befehle }, befehle));
spKern({ pfad, dialog: (w, prompt, weiter) => { w.dialog = { prompt, eingabe: (z) => { w.dialog = null; return weiter(z); } }; } });
Object.assign(befehle, speicherBefehle({ ...befehle }, befehle));
netzwerkKern({ pfad });
Object.assign(befehle, netzwerkBefehle({ ...befehle }));
{ const altExit = EINGEBAUT.exit; EINGEBAUT.exit = (w, a, i, r) => chrootVerlassen(w) ?? altExit(w, a, i, r); }
// /proc/modules wird aus dem Zustand der Module erzeugt
befehle.cat = (w, a, i, r) => a.some((x) => pfad(w, x) === '/proc/modules') ? procCat(w, a, i, r) : textCat(w, a, i, r);
// vi öffnet im Terminal den Editor. Die Komponente erkennt die Markierung und übernimmt die Tastatur.
const VI = '\u001bvi:';
function viStart(w: Welt, a: string[], root: boolean, nurLesen = false): Ergebnis {
  const d = a.filter((x) => !x.startsWith('-') && !x.startsWith('+'))[0] ?? '';
  const p = d ? pfad(w, d) : '';
  if (p && w.fs[p] === null) return fehler(`"${d}" is a directory`);
  return ok(VI + JSON.stringify({ p, d, root, nurLesen }));
}
export function viOeffnen(w: Welt, p: string, root: boolean): { text: string; neu: boolean; schreibbar: boolean; lesbar: boolean } {
  if (!p) return { text: '', neu: true, schreibbar: true, lesbar: true };
  if (!(p in w.fs)) return { text: '', neu: true, schreibbar: darfImOrdner(w, p, root), lesbar: true };
  const lesbar = darf(w, p, 'r', root);
  return { text: lesbar ? (w.fs[p] ?? '') : '', neu: false, schreibbar: darf(w, p, 'w', root), lesbar };
}
export function viSpeichern(w: Welt, ziel: string, text: string, root: boolean, erzwingen: boolean): string | null {
  const p = pfad(w, ziel);
  // :w! überschreibt nur den Schreibschutz der Sitzung, nicht die Rechte im Dateisystem
  if (p in w.fs && !darf(w, p, 'w', root) && !(erzwingen && meta(w, p).owner === (root ? 'root' : 'lena'))) return "E212: Can't open file for writing";
  if (!(p in w.fs) && !darfImOrdner(w, p, root)) return "E212: Can't open file for writing";
  const alt = w.fs[p];
  w.fs[p] = ''; if (alt === undefined) neuMeta(w, p, root, false);
  w.fs[p] = text; beruehren(w, p);
  if (w.pakete && !w.pakete.geaendert.includes(p)) w.pakete.geaendert.push(p);
  return null;
}
/** Nach dem Schließen von vi: Programme wie crontab -e werten die Datei aus. */
export function viBeendet(w: Welt, art: string, p: string): string {
  const x = w as Welt & { viNach?: { pfad: string; nach: (art: string) => string } | null };
  if (!x.viNach || x.viNach.pfad !== p) return '';
  const h = x.viNach; x.viNach = null;
  return h.nach(art);
}
export function istVi(ausgabe: string) { const i = ausgabe.indexOf(VI); return i < 0 ? null : JSON.parse(ausgabe.slice(i + VI.length).split('\n')[0]) as { p: string; d: string; root: boolean; nurLesen: boolean }; }

Object.assign(befehle, PROGRAMME_SHELL, {
  vi: (w: Welt, a: string[], _i: string, root: boolean) => viStart(w, a, root),
  'vim.tiny': (w: Welt, a: string[], _i: string, root: boolean) => viStart(w, a, root),
  view: (w: Welt, a: string[], _i: string, root: boolean) => viStart(w, a, root, true),
  nano: () => fehler('(nano ist auf Debian installiert, im Simulator aber nicht nachgebaut. Die Prüfung verlangt vi, nano musst du nur kennen.)'),
  truncate: (w: Welt, a: string[], _i: string, root: boolean) => {
    const si = a.indexOf('-s'); const groesse = si >= 0 ? a[si + 1] : undefined;
    const dateien = a.filter((x, i) => !x.startsWith('-') && i !== si + 1);
    if (groesse !== '0') return fehler('truncate: Im Simulator nur „truncate -s 0 datei“ (Datei leeren).');
    for (const d of dateien) { const e = schreiben(w, d, '', false, root); if (e) return fehler(`truncate: '${d}' kann nicht zum Schreiben geöffnet werden: ${e}`); }
    return ok();
  },
  env: (w: Welt, a: string[], stdin: string, root: boolean) => {
    let neu = { ...w.env }; let i = 0;
    for (; i < a.length; i++) {
      const x = a[i];
      if (x === '-i' || x === '-' || x === '--ignore-environment') neu = {};
      else if (x === '-u') delete neu[a[++i] ?? ''];
      else if (/^[A-Za-z_]\w*=/.test(x)) { const k = x.indexOf('='); neu[x.slice(0, k)] = x.slice(k + 1); }
      else break;
    }
    if (i >= a.length) return ok(Object.entries(neu).map(([k, v]) => `${k}=${v}`).join('\n'));
    const alt = w.env; const altVars = w.vars; w.env = neu; w.vars = {};
    const zitiert = a.slice(i).map((x) => (/^[\w./@%+:,-]+$/.test(x) ? x : `'${x.replace(/'/g, `'\\''`)}'`)).join(' ');
    try { return intern(w, zitiert, stdin, root); } finally { w.env = alt; w.vars = altVars; }
  },
  printenv: (w: Welt, a: string[]) => a[0] ? (w.env[a[0]] !== undefined ? ok(w.env[a[0]]) : { out: '', code: 1 }) : ok(Object.entries(w.env).map(([k, v]) => `${k}=${v}`).join('\n')),
});
// Diese Namen sind nur in der Shell eingebaut und liegen nicht in /usr/bin
for (const n of ['jobs', 'fg', 'bg']) SHELL_INTERN[n] = befehle[n];
for (const n of ['cd', 'history', 'export', 'unset', 'jobs', 'fg', 'bg', 'alias', 'unalias', 'type', 'umask', 'source']) delete befehle[n];

export const BEFEHLSNAMEN = [...new Set([...Object.keys(befehle).filter((n) => !n.startsWith('__')), ...Object.keys(EINGEBAUT), 'sudo'])].sort();

// ---------- Prüfen von Aufgaben ----------

export interface Aufgabe {
  text: string;
  befehl?: string;        // regulärer Ausdruck für die Befehlszeile (ohne "sudo ")
  auchFehler?: boolean;   // zählt auch, wenn der Befehl einen Fehler meldet
  zustand?: string;       // z. B. "modul:pcspkr=aus", "default=multi-user.target", "datei:/etc/x~muster"
  frage?: string;         // Frage, deren Antwort man aus einer Ausgabe abliest
  antwort?: string[];     // erlaubte Antworten
  tipp?: string;
}

export function zustandStimmt(w: Welt, z: string): boolean {
  return z.split('&&').every((teil) => {
    const s = teil.trim();
    if (s.startsWith('nicht:')) return !zustandStimmt(w, s.slice(6));
    let m;
    if ((m = s.match(/^modul:(\w+)=(an|aus)$/))) return (m[2] === 'an') === !!w.geladen[m[1]];
    if ((m = s.match(/^default=(.+)$/))) return w.defaultTarget === m[1];
    if ((m = s.match(/^target=(.+)$/))) return w.target === m[1];
    if ((m = s.match(/^datei:([^~]+)~(.+)$/))) {
      const re = new RegExp(m[2], 'm');
      return Object.entries(w.fs).some(([p, c]) => (m![1].endsWith('*') ? p.startsWith(m![1].slice(0, -1)) : p === m![1]) && typeof c === 'string' && re.test(c));
    }
    if ((m = s.match(/^shutdown=(geplant|keiner|reboot|poweroff)$/))) return m[1] === 'keiner' ? !w.shutdown : m[1] === 'geplant' ? !!w.shutdown : w.shutdown?.art === m[1];
    if ((m = s.match(/^aus=(.+)$/))) return w.aus === m[1];
    if (s === 'wall') return w.walls.length > 0;
    if ((m = s.match(/^prozess:(\d+)=(weg|da)$/))) return (m[2] === 'weg') === !w.prozesse.some((p) => p.pid === Number(m![1]));
    if ((m = s.match(/^signal:(\d+)=(\d+)$/))) return w.verlauf.some((v) => v.zeile === `#signal ${m![1]} ${m![2]}`);
    if (s === 'root') return w.root;
    if ((m = s.match(/^fehlt:(.+)$/))) { const re = new RegExp('^' + m[1].replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'); return !Object.keys(w.fs).some((p) => re.test(p)); }
    if ((m = s.match(/^leer:(.+)$/))) return w.fs[m[1]] === '';
    if ((m = s.match(/^host=(.+)$/))) return w.host === m[1];
    if (s === 'antwort:ja') return w.verlauf.some((v) => v.zeile === '#antwort ja');
    const p = zustandPakete(w, s); if (p !== undefined) return p;
    const pl = zustandPlatten(w, s); if (pl !== undefined) return pl;
    const re = zustandRechte(w, s, pfad); if (re !== undefined) return re;
    const sz = zustandSkript(w, s); if (sz !== undefined) return sz;
    const zx = zustandX11(w, s); if (zx !== undefined) return zx;
    const za = zustandAdmin(w, s); if (za !== undefined) return za;
    const zz = zustandZeit(w, s); if (zz !== undefined) return zz;
    const zd = zustandDienste(w, s); if (zd !== undefined) return zd;
    const zn = zustandNetz(w, s); if (zn !== undefined) return zn;
    const zst = zustandStart(w, s); if (zst !== undefined) return zst;
    const zds = zustandDsys(w, s); if (zds !== undefined) return zds;
    const zsp = zustandSpeicher(w, s); if (zsp !== undefined) return zsp;
    const znw = zustandNetzwerk(w, s); if (znw !== undefined) return znw;
    const zs2 = zustandSicherheit(w, s); if (zs2 !== undefined) return zs2;
    const zl = zustandLast(w, s); if (zl !== undefined) return zl;
    const zk = zustandKern(w, s); if (zk !== undefined) return zk;
    if ((m = s.match(/^neustarts>=(\d+)$/))) return w.verlauf.filter((v) => v.zeile === '#neustart').length >= Number(m[1]);
    if (s === 'neustart') return w.verlauf.some((v) => v.zeile === '#neustart');
    // ---- ab Topic 103 ----
    // vi:ohne = beendet, ohne zu speichern (mit oder ohne Änderungen)
    if ((m = s.match(/^vi:(gespeichert|verworfen|unveraendert|ohne)(?::(.+))?$/))) return w.verlauf.some((v) => (m![1] === 'ohne' ? /^#vi (verworfen|unveraendert) /.test(v.zeile) : v.zeile.startsWith(`#vi ${m![1]} `)) && (!m![2] || v.zeile.endsWith(' ' + m![2])));
    if ((m = s.match(/^job:(.+)=(Running|Stopped|weg)$/))) { const re = new RegExp(m[1]); const j = w.jobs.find((x) => re.test(x.cmd)); return m[2] === 'weg' ? !j : j?.status === m[2]; }
    if ((m = s.match(/^ni:(.+)=(-?\d+)$/))) { const re = new RegExp(m[1]); return w.prozesse.some((p) => (/^\d+$/.test(m![1]) ? p.pid === Number(m![1]) : re.test(p.cmd)) && (p.ni ?? 0) === Number(m![2])); }
    if ((m = s.match(/^laeuft:(.+)$/))) { const re = new RegExp(m[1]); return w.prozesse.some((p) => re.test(p.cmd)); }
    if ((m = s.match(/^nohup:(.+)$/))) { const re = new RegExp(m[1]); return w.prozesse.some((p) => p.nohup && re.test(p.cmd)); }
    if ((m = s.match(/^var:(\w+)~(.*)$/))) { const v = w.vars[m[1]] ?? w.env[m[1]]; return v !== undefined && new RegExp(m[2]).test(v); }
    if ((m = s.match(/^export:(\w+)$/))) return m[1] in w.env;
    if ((m = s.match(/^alias:([^~]+)~(.*)$/))) return w.aliase[m[1]] !== undefined && new RegExp(m[2]).test(w.aliase[m[1]]);
    if ((m = s.match(/^umask=(\d+)$/))) return w.umask === parseInt(m[1], 8);
    if ((m = s.match(/^modus:(.+)=([0-7]{3,4})$/))) return pfad(w, m[1]) in w.fs && (meta(w, pfad(w, m[1])).mode & 0o7777) === parseInt(m[2], 8);
    if ((m = s.match(/^da:(.+)$/))) return pfad(w, m[1]) in w.fs;
    if ((m = s.match(/^ordner:(.+)$/))) return w.fs[pfad(w, m[1])] === null;
    if ((m = s.match(/^cwd=(.+)$/))) return w.cwd === m[1];
    if ((m = s.match(/^historie~(.+)$/))) { const re = new RegExp(m[1]); return w.historie.some((h) => re.test(h)); }
    if ((m = s.match(/^ausgabe~(.+)$/))) { const re = new RegExp(m[1], 'm'); return w.verlauf.some((v) => re.test(v.ausgabe)); }
    if ((m = s.match(/^dialog~(.+)$/))) { const re = new RegExp(m[1]); return w.verlauf.some((v) => v.zeile.startsWith('#dialog ') && re.test(v.zeile.slice(8))); }
    if ((m = s.match(/^roh~(.+)$/))) { const re = new RegExp(m[1]); return w.verlauf.some((v) => v.zeile.startsWith('#roh ') && re.test(v.zeile.slice(5))); }
    if ((m = s.match(/^ohneVerlauf:(.+)$/))) return w.verlauf.some((v) => v.zeile === m![1]) && !w.historie.includes(m![1]);
    if (s === 'strg-z') return w.verlauf.some((v) => v.zeile === '#strg-z' && v.code === 148);
    if (s === 'strg-c') return w.verlauf.some((v) => v.zeile === '#strg-c' && v.code === 130);
    return false;
  });
}

export function befehlStimmt(w: Welt, a: Aufgabe): boolean {
  if (!a.befehl) return true;
  const re = new RegExp(a.befehl);
  return w.verlauf.some((v) => {
    if (v.zeile.startsWith('#') || !(a.auchFehler || v.code === 0)) return false;
    const roh = v.zeile.replace(/\s+/g, ' ');
    return re.test(roh) || re.test(roh.replace(/^sudo /, ''));
  });
}
