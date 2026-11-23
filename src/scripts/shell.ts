// Ein kleiner, absichtlich begrenzter Linux-Simulator für die Übungen im Browser.
// Er kennt nur die Befehle, die in den Missionen vorkommen, verhält sich bei diesen aber wie ein echtes System:
// Rechte (sudo), Pipes, Umleitungen, Kernelmodule mit Abhängigkeiten, systemd-Targets, geplanter Shutdown.
// Der Rechner ist erfunden ("werkstatt"), die Ausgaben sind an echte Systeme angelehnt und gekürzt.

import { paketBefehle, programmStarten, neustartPakete, startStand, zustandPakete, type PaketStand } from './shell-pakete';

export interface Modul { name: string; groesse: number; abh: string[]; beschreibung: string; parameter?: Record<string, string>; datei?: string; }
export interface Prozess { pid: number; user: string; cmd: string; ignoriertTerm?: boolean; }

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
  wartet: null | { standardJa: boolean; aktion: () => { out: string; code: number } };   // offene Rückfrage [Y/n]
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
  const ordner: Record<string, string> = { usb_storage: 'kernel/drivers/usb/storage', uas: 'kernel/drivers/usb/storage', e1000e: 'kernel/drivers/net/ethernet/intel/e1000e', iwlwifi: 'kernel/drivers/net/wireless/intel/iwlwifi', pcspkr: 'kernel/drivers/input/misc', floppy: 'kernel/drivers/block', i915: 'kernel/drivers/gpu/drm/i915', snd_hda_intel: 'kernel/sound/pci/hda', uvcvideo: 'kernel/drivers/media/usb/uvc', btusb: 'kernel/drivers/bluetooth', vfat: 'kernel/fs/fat', fat: 'kernel/fs/fat', nvme: 'kernel/drivers/nvme/host', nvme_core: 'kernel/drivers/nvme/host' };
  return `${ordner[name] ?? 'kernel/drivers/misc'}/${name.replace(/_/g, name === 'usb_storage' ? '-' : '_')}.ko`;
}

export interface WeltOptionen { defaultTarget?: string; target?: string; ohne?: string[]; dateien?: Record<string, string>; prozesse?: Prozess[]; root?: boolean; distro?: 'debian' | 'alma' | 'suse'; virt?: string; host?: string; aptVeraltet?: boolean; geaendert?: string[]; }

export function neueWelt(o: WeltOptionen = {}): Welt {
  const verfuegbar = Object.fromEntries(MODULE.map((x) => [x.name, x]));
  const w: Welt = {
    host: 'werkstatt', user: 'lena', root: !!o.root, cwd: '/home/lena', fs: grundFs(), verfuegbar, geladen: {}, inBenutzung: { usb_storage: 1, vfat: 1, snd: 2, i915: 3 },
    defaultTarget: o.defaultTarget ?? 'graphical.target', target: o.target ?? o.defaultTarget ?? 'graphical.target', runlevelVorher: 'N',
    shutdown: null, aus: null, walls: [], verlauf: [], kernel: KERNEL, cmdline: `BOOT_IMAGE=/boot/vmlinuz-${KERNEL} root=UUID=3f1c0d6e-8a2b-4c51-9a0e-2d7b1e5c9f40 ro quiet`,
    distro: o.distro ?? 'debian', virt: o.virt ?? 'none', env: { HOME: '/home/lena', USER: 'lena', PATH: '/usr/local/bin:/usr/bin:/bin:/usr/local/games:/usr/games', SHELL: '/bin/bash', LANG: 'de_DE.UTF-8' }, vars: {}, wartet: null,
    prozesse: o.prozesse ?? [
      { pid: 1, user: 'root', cmd: '/sbin/init' }, { pid: 612, user: 'root', cmd: '/lib/systemd/systemd-logind' },
      { pid: 845, user: 'root', cmd: '/usr/sbin/NetworkManager --no-daemon' }, { pid: 1203, user: 'lena', cmd: '-bash' },
      { pid: 2210, user: 'lena', cmd: 'python3 backup.py' }, { pid: 2290, user: 'lena', cmd: 'vim bericht.txt' },
    ],
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
  for (const [p, c] of Object.entries(o.dateien ?? {})) w.fs[p] = c;
  w.fs['/etc/systemd/system/default.target'] = `-> /usr/lib/systemd/system/${w.defaultTarget}`;
  benutzerBerechnen(w);
  return w;
}

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
  return '/' + st.join('/');
}
const kinder = (w: Welt, dir: string) => Object.keys(w.fs).filter((k) => k !== dir && k.startsWith(dir === '/' ? '/' : dir + '/') && !k.slice(dir === '/' ? 1 : dir.length + 1).includes('/')).map((k) => k.split('/').pop()!).sort();

interface Ergebnis { out: string; code: number; }
const ok = (out = ''): Ergebnis => ({ out, code: 0 });
const fehler = (out: string, code = 1): Ergebnis => ({ out, code });
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
  help: () => ok(HILFE),
  hilfe: () => ok(HILFE),
  clear: () => ok('\u001bclear'),
  whoami: (w, _a, _i, root) => ok(root ? 'root' : w.user),
  id: (w, _a, _i, root) => ok(root ? 'uid=0(root) gid=0(root) groups=0(root)' : 'uid=1000(lena) gid=1000(lena) groups=1000(lena),24(cdrom),27(sudo),46(plugdev)'),
  hostname: (w) => ok(w.host),
  pwd: (w) => ok(w.cwd),
  history: (w) => ok(w.verlauf.map((v, i) => `${String(i + 1).padStart(5)}  ${v.zeile}`).join('\n')),
  echo: (_w, a) => ok(a.filter((x) => x !== '-e').join(' ')),
  man: (_w, a) => a[0] && MAN[a[0]] ? ok(MAN[a[0]] + '\n\n(Gekürzte Hilfe des Simulators. Auf deinem Labor-System zeigt "man ' + a[0] + '" die vollständige Seite.)') : fehler(`Kein Handbucheintrag für ${a[0] ?? ''} im Simulator.`, 16),
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
    if (a[0] === '-l') return ok(' 1) SIGHUP\t 2) SIGINT\t 3) SIGQUIT\t 9) SIGKILL\t15) SIGTERM\t18) SIGCONT\t19) SIGSTOP');
    let sig = 15; const pids: number[] = [];
    for (const x of a) {
      const m = x.match(/^-(?:s\s*)?(?:SIG)?(\w+)$/i);
      if (m) { const n = m[1].toUpperCase(); sig = /^\d+$/.test(n) ? Number(n) : ({ HUP: 1, INT: 2, QUIT: 3, KILL: 9, TERM: 15 } as Record<string, number>)[n] ?? 15; }
      else if (/^\d+$/.test(x)) pids.push(Number(x));
    }
    if (!pids.length) return fehler('kill: Aufruf: kill [-s SIGNAL | -SIGNAL] PID …', 2);
    const out: string[] = [];
    for (const pid of pids) out.push(signal(w, pid, sig, root));
    const f = out.filter(Boolean);
    return f.length ? fehler(f.join('\n')) : ok();
  },
  pkill: (w, a, _i, root) => {
    const name = a.filter((x) => !x.startsWith('-')).pop() ?? '';
    const sigArg = a.find((x) => x.startsWith('-'));
    const sig = sigArg ? (/9|KILL/i.test(sigArg) ? 9 : /1$|HUP/i.test(sigArg) ? 1 : 15) : 15;
    const ziele = w.prozesse.filter((p) => p.cmd.split(' ').some((t) => t === name || t.endsWith('/' + name)) || p.cmd.startsWith(name));
    if (!ziele.length) return fehler('', 1);
    for (const p of ziele) signal(w, p.pid, sig, root);
    return ok();
  },
  killall: (w, a, i, root) => befehle.pkill(w, a, i, root),
};

function signal(w: Welt, pid: number, sig: number, root: boolean): string {
  const p = w.prozesse.find((x) => x.pid === pid);
  if (!p) return `bash: kill: (${pid}) - Kein passender Prozess gefunden`;
  if (p.user !== 'lena' && !root) return `bash: kill: (${pid}) - Die Operation ist nicht erlaubt`;
  w.verlauf.push({ zeile: `#signal ${pid} ${sig}`, code: 0, ausgabe: '' });
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
  if (!root && !p.startsWith('/home/lena') && !p.startsWith('/tmp')) return 'Keine Berechtigung';
  const t = text.endsWith('\n') || !text ? text : text + '\n';
  w.fs[p] = anhaengen ? (w.fs[p] ?? '') + t : t;
  return null;
}

// ---------- Ausführen ----------

export interface Lauf { ausgabe: string; code: number; clear?: boolean; }

export function ausfuehren(w: Welt, zeile: string): Lauf {
  const roh = zeile.trim();
  if (!roh) return { ausgabe: '', code: 0 };
  if (w.aus) return { ausgabe: `Das System ist ${w.aus === 'reboot' ? 'gerade beim Neustart' : 'heruntergefahren'}. Mit "Neu starten" unter dem Terminal geht es weiter.`, code: 1 };
  if (roh === 'exit' || roh === 'logout') {
    if (w.root) { w.root = false; return { ausgabe: 'abgemeldet', code: 0 }; }
    return { ausgabe: '(Im Simulator bleibst du angemeldet.)', code: 0 };
  }
  // Offene Rückfrage wie „Do you want to continue? [Y/n]“
  if (w.wartet) {
    const { standardJa, aktion } = w.wartet; w.wartet = null;
    const a = roh.toLowerCase();
    const ja = a === 'y' || a === 'j' || a === 'yes' || a === 'ja' || (a === '' && standardJa);
    const r = ja ? aktion() : { out: 'Abort.\n(Abgebrochen. Mit -y beantwortet der Befehl die Rückfrage selbst.)', code: 1 };
    w.verlauf.push({ zeile: `#antwort ${ja ? 'ja' : 'nein'}`, code: r.code, ausgabe: r.out });
    return { ausgabe: r.out, code: r.code };
  }
  if (/^export(\s|$)/.test(roh)) {
    const teile = zerlegen(variablen(w, roh)).slice(1);
    if (!teile.length) { w.verlauf.push({ zeile: roh, code: 0, ausgabe: '' }); return { ausgabe: Object.entries(w.env).map(([k, v]) => `declare -x ${k}="${v}"`).join('\n'), code: 0 }; }
    for (const t of teile) { const m = t.match(/^([A-Za-z_]\w*)(?:=(.*))?$/); if (!m) continue; w.env[m[1]] = m[2] ?? w.vars[m[1]] ?? ''; delete w.vars[m[1]]; }
    w.verlauf.push({ zeile: roh, code: 0, ausgabe: '' });
    return { ausgabe: '', code: 0 };
  }
  const nurZuweisung = roh.match(/^([A-Za-z_]\w*)=(\S*)$/);
  if (nurZuweisung) {
    const wert = zerlegen(variablen(w, nurZuweisung[2]))[0] ?? '';
    if (nurZuweisung[1] in w.env) w.env[nurZuweisung[1]] = wert; else w.vars[nurZuweisung[1]] = wert;
    w.verlauf.push({ zeile: roh, code: 0, ausgabe: '' });
    return { ausgabe: '', code: 0 };
  }
  const stufen = aufteilen(roh, '|');
  let eingabe = ''; let code = 0; let ausgabe = ''; let clear = false; const fehlerText: string[] = [];
  for (const [i, stufe] of stufen.entries()) {
    // Umleitungen am Ende einer Stufe
    let cmd = stufe; let ziel: string | null = null; let anh = false;
    const um = cmd.match(/\s(\d?)(>>?)\s*(\S+)\s*$/);
    if (um && i === stufen.length - 1) { cmd = cmd.slice(0, um.index); if (um[1] !== '2') { ziel = um[3]; anh = um[2] === '>>'; } }
    cmd = cmd.replace(/\s2>\s*\/dev\/null/g, '');
    let t = zerlegen(variablen(w, cmd)).flatMap((x) => wildcard(w, x));
    // VAR=wert befehl: Variable nur für diesen Befehl
    const tempEnv: Record<string, string> = {};
    while (t.length > 1 && /^[A-Za-z_]\w*=/.test(t[0])) { const k = t[0].indexOf('='); tempEnv[t[0].slice(0, k)] = t[0].slice(k + 1); t = t.slice(1); }
    let root = w.root;
    if (t[0] === 'sudo') {
      t = t.slice(1);
      if (t[0] === '-i' || (t[0] === 'su' && t.length <= 2)) { w.root = true; return { ausgabe: '[sudo] Passwort für lena: (im Simulator nicht nötig)\nDu bist jetzt root. Mit "exit" kommst du zurück.', code: 0 }; }
      root = true;
    }
    const name = t[0];
    let f = befehle[name];
    if (!f && name?.includes('/')) {
      const z = pfad(w, name);
      f = (welt) => {
        const altEnv = welt.env; welt.env = { ...welt.env, ...tempEnv };
        try {
          if (!(z in welt.fs)) return fehler(`bash: ${name}: Datei oder Verzeichnis nicht gefunden`, 127);
          if (welt.fs[z] === null) return fehler(`bash: ${name}: Ist ein Verzeichnis`, 126);
          return programmStarten(welt, z) ?? fehler(`bash: ${name}: Keine Berechtigung`, 126);
        } finally { welt.env = altEnv; }
      };
    }
    if (!f) { code = 127; ausgabe = `bash: ${name}: Befehl nicht gefunden${['nano', 'vi', 'vim'].includes(name) ? ' (Editoren gibt es im Simulator nicht. Nutze echo und tee.)' : ''}`; eingabe = ''; break; }
    const r = f(w, t.slice(1), eingabe, root);
    if (r.out === '\u001bclear') { clear = true; ausgabe = ''; code = 0; break; }
    code = r.code;
    if (ziel) {
      // Die Umleitung macht die Shell des Benutzers, nicht sudo: "sudo echo x > /etc/datei" scheitert.
      const e = schreiben(w, ziel, r.out, anh, w.root);
      if (e) { ausgabe = `bash: ${ziel}: ${e}`; code = 1; } else ausgabe = '';
      break;
    }
    // Fehlermeldungen gehen bei einer echten Shell auf stderr, nicht in die Pipe
    if (r.code !== 0 && i < stufen.length - 1) { fehlerText.push(r.out); eingabe = ''; ausgabe = ''; continue; }
    eingabe = r.out;
    ausgabe = r.out;
  }
  if (fehlerText.length) ausgabe = [...fehlerText, ausgabe].filter(Boolean).join('\n');
  w.verlauf.push({ zeile: roh, code, ausgabe });
  return { ausgabe, code, clear };
}

export function prompt(w: Welt) {
  if (w.wartet) return '';
  const ort = w.cwd === '/home/lena' ? '~' : w.cwd.startsWith('/home/lena/') ? '~' + w.cwd.slice('/home/lena'.length) : w.cwd;
  const user = w.root ? 'root' : 'lena';
  if (w.distro === 'alma') return `[${user}@${w.host} ${w.root && ort.startsWith('~') ? ort.replace(/^~/, '/home/lena').split('/').pop() : ort === '~' ? '~' : ort.split('/').pop() || '/'}]${w.root ? '#' : '$'} `;
  if (w.distro === 'suse') return `${user}@${w.host}:${w.root ? ort.replace(/^~/, '/home/lena') : ort}${w.root ? ' #' : '>'} `;
  return w.root ? `root@${w.host}:${ort.replace(/^~/, '/home/lena')}# ` : `lena@${w.host}:${ort}$ `;
}

// $VAR und ${VAR} ersetzen, außer in einfachen Anführungszeichen
function variablen(w: Welt, s: string): string {
  let out = ''; let einfach = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'") { einfach = !einfach; out += c; continue; }
    if (c === '$' && !einfach) {
      const m = s.slice(i + 1).match(/^\{(\w+)\}|^(\w+)|^\?/);
      if (m) {
        const n = m[1] ?? m[2];
        out += m[0] === '?' ? String(w.verlauf.filter((v) => !v.zeile.startsWith('#')).slice(-1)[0]?.code ?? 0) : (w.env[n] ?? w.vars[n] ?? '');
        i += m[0].length; continue;
      }
    }
    out += c;
  }
  return out;
}

// Wildcards * und ? gegen das Dateisystem auflösen. Ohne Treffer bleibt das Wort stehen, wie in der Bash.
function wildcard(w: Welt, wort: string): string[] {
  if (wort === '~' || wort.startsWith('~/')) wort = '/home/lena' + wort.slice(1);
  if (!/[*?]/.test(wort) || wort.includes('/^') || /^[-s]\//.test(wort)) return [wort];
  const absolut = wort.startsWith('/');
  const basis = absolut ? '' : w.cwd === '/' ? '' : w.cwd;
  const muster = new RegExp('^' + (absolut ? '' : basis.replace(/[.+^${}()|[\]\\]/g, '\\$&') + '/') + wort.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]') + '$');
  const treffer = Object.keys(w.fs).filter((p) => muster.test(p) && !p.split('/').pop()!.startsWith('.')).sort();
  if (!treffer.length) return [wort];
  return treffer.map((p) => absolut ? p : p.slice(basis.length + 1));
}

export function neuStarten(w: Welt) {
  neustartPakete(w);
  w.wartet = null;
  w.aus = null; w.shutdown = null; w.root = false;
  w.runlevelVorher = 'N'; w.target = w.defaultTarget;
  // Nach dem Neustart lädt udev die Module neu – außer gesperrten.
  const { schwarz, install } = blacklist(w);
  for (const n of START_GELADEN) if (!schwarz.has(n) && !install[n]) w.geladen[n] = [];
  for (const n of Object.keys(w.geladen)) if (schwarz.has(n) || install[n]) delete w.geladen[n];
  benutzerBerechnen(w);
}

Object.assign(befehle, paketBefehle({ ok, fehler, optionen, pfad, schreiben }));

// Ein paar allgemeine Befehle, die ab Topic 102 gebraucht werden
Object.assign(befehle, {
  rm: (w: Welt, a: string[], _i: string, root: boolean) => {
    const { flags, rest } = optionen(a);
    if (!rest.length) return fehler('rm: Operand fehlt');
    const out: string[] = [];
    for (const r of rest) {
      const z = pfad(w, r);
      if (!(z in w.fs)) { if (!flags.has('-f')) out.push(`rm: das Entfernen von '${r}' ist nicht möglich: Datei oder Verzeichnis nicht gefunden`); continue; }
      if (w.fs[z] === null && !flags.has('-r') && !flags.has('-R')) { out.push(`rm: das Entfernen von '${r}' ist nicht möglich: Ist ein Verzeichnis`); continue; }
      if (!root && !z.startsWith('/home/lena') && !z.startsWith('/tmp')) { out.push(`rm: das Entfernen von '${r}' ist nicht möglich: Keine Berechtigung`); continue; }
      for (const k of Object.keys(w.fs)) if (k === z || k.startsWith(z + '/')) delete w.fs[k];
    }
    return out.length ? fehler(out.join('\n')) : ok();
  },
  truncate: (w: Welt, a: string[], _i: string, root: boolean) => {
    const si = a.indexOf('-s'); const groesse = si >= 0 ? a[si + 1] : undefined;
    const dateien = a.filter((x, i) => !x.startsWith('-') && i !== si + 1);
    if (groesse !== '0') return fehler('truncate: Im Simulator nur „truncate -s 0 datei“ (Datei leeren).');
    for (const d of dateien) { const e = schreiben(w, d, '', false, root); if (e) return fehler(`truncate: '${d}' kann nicht zum Schreiben geöffnet werden: ${e}`); }
    return ok();
  },
  sed: (w: Welt, a: string[], stdin: string, root: boolean) => sedBefehl(w, a, stdin, root),
  env: (w: Welt) => ok(Object.entries(w.env).map(([k, v]) => `${k}=${v}`).join('\n')),
  printenv: (w: Welt, a: string[]) => a[0] ? (w.env[a[0]] !== undefined ? ok(w.env[a[0]]) : fehler('', 1)) : ok(Object.entries(w.env).map(([k, v]) => `${k}=${v}`).join('\n')),
  unset: (w: Welt, a: string[]) => { for (const n of a) { delete w.env[n]; delete w.vars[n]; } return ok(); },
});

function sedBefehl(w: Welt, a: string[], stdin: string, root: boolean): Ergebnis {
  let inplace = false; let still = false; let ere = false; const skripte: string[] = []; const dateien: string[] = [];
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    if (x === '-i' || x.startsWith('-i.')) inplace = true;
    else if (x === '-n') still = true;
    else if (x === '-E' || x === '-r') ere = true;
    else if (x === '-e') skripte.push(a[++i] ?? '');
    else if (/^-[nEri]+$/.test(x)) { if (x.includes('i')) inplace = true; if (x.includes('n')) still = true; if (/[Er]/.test(x)) ere = true; }
    else if (!skripte.length) skripte.push(x);
    else dateien.push(x);
  }
  if (!skripte.length) return fehler('Aufruf: sed [OPTION]… {Skript} [Eingabedatei]…');
  const regex = (r: string, fl = '') => { let q = r; if (!ere) q = q.replace(/\\\(/g, '\u0001').replace(/\\\)/g, '\u0002').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/\u0001/g, '(').replace(/\u0002/g, ')').replace(/\\\{/g, '{').replace(/\\\}/g, '}').replace(/\\\+/g, '+').replace(/\\\?/g, '?'); return new RegExp(q, fl); };
  type Cmd = { adr?: { re?: RegExp; nr?: number; bis?: number }; art: string; re?: RegExp; ersatz?: string; global?: boolean; druck?: boolean };
  const cmds: Cmd[] = [];
  for (const sk of skripte.flatMap((x) => x.split(/;(?=\s*(?:\/|\d|s|p|d|q))/))) {
    let t = sk.trim(); let adr: Cmd['adr'];
    let m = t.match(/^\/((?:\\\/|[^/])*)\//);
    if (m) { adr = { re: regex(m[1].replace(/\\\//g, '/')) }; t = t.slice(m[0].length).trim(); }
    else if ((m = t.match(/^(\d+)(?:,(\d+|\$))?/))) { adr = { nr: Number(m[1]), bis: m[2] === '$' ? Infinity : m[2] ? Number(m[2]) : undefined }; t = t.slice(m[0].length).trim(); }
    if (t[0] === 's') {
      const tr = t[1]; const teile: string[] = []; let cur = ''; let k = 2;
      for (; k < t.length && teile.length < 2; k++) { if (t[k] === '\\' && t[k + 1] === tr) { cur += tr; k++; continue; } if (t[k] === tr) { teile.push(cur); cur = ''; continue; } cur += t[k]; }
      if (teile.length < 2) return fehler(`sed: -e Ausdruck #1, Zeichen ${t.length}: nicht beendeter „s“-Befehl`);
      const fl = t.slice(k);
      cmds.push({ adr, art: 's', re: regex(teile[0], (fl.includes('g') ? 'g' : '') + (/[iI]/.test(fl) ? 'i' : '')), ersatz: teile[1].replace(/\\(\d)/g, '$$$1').replace(/(^|[^\\])&/g, '$1$$&').replace(/\\&/g, '&'), druck: fl.includes('p') });
    } else if (t === 'd' || t === 'p' || t === 'q') cmds.push({ adr, art: t });
    else return fehler(`sed: -e Ausdruck #1, Zeichen 1: unbekannter Befehl: „${t[0] ?? ''}“ (der Simulator kennt s, d, p und q)`);
  }
  const bearbeite = (text: string) => {
    const aus: string[] = [];
    const zeilen = text.replace(/\n$/, '').split('\n');
    for (const [i, z0] of zeilen.entries()) {
      let z = z0; let weg = false; let stop = false;
      for (const c of cmds) {
        const n = i + 1;
        const passt = !c.adr || (c.adr.re ? c.adr.re.test(z) : c.adr.bis !== undefined ? n >= c.adr.nr! && n <= c.adr.bis : n === c.adr.nr);
        if (!passt) continue;
        if (c.art === 's') { const neu = z.replace(c.re!, c.ersatz!); if (neu !== z && c.druck) aus.push(neu); z = neu; }
        else if (c.art === 'd') { weg = true; break; }
        else if (c.art === 'p') aus.push(z);
        else if (c.art === 'q') { stop = true; break; }
      }
      if (!weg && !still) aus.push(z);
      if (stop) break;
    }
    return aus.join('\n');
  };
  if (!dateien.length) { if (inplace) return fehler('sed: keine Eingabedateien'); return ok(bearbeite(stdin)); }
  const out: string[] = [];
  for (const d of dateien) {
    const z = pfad(w, d);
    const inhalt = w.fs[z];
    if (typeof inhalt !== 'string') return fehler(`sed: ${d} kann nicht gelesen werden: Datei oder Verzeichnis nicht gefunden`, 2);
    const neu = bearbeite(inhalt);
    if (inplace) {
      if (!root && !z.startsWith('/home/lena') && !z.startsWith('/tmp')) return fehler(`sed: temporäre Datei ${z.replace(/[^/]+$/, '')}sedAbC12 konnte nicht geöffnet werden: Keine Berechtigung`, 4);
      w.fs[z] = neu + '\n';
      if (w.pakete && !w.pakete.geaendert.includes(z)) w.pakete.geaendert.push(z);
    } else out.push(neu);
  }
  return ok(out.join('\n'));
}

export const BEFEHLSNAMEN = Object.keys(befehle).concat(['sudo', 'exit', 'export']);

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
    if (s === 'neustart') return w.verlauf.some((v) => v.zeile === '#neustart');
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
