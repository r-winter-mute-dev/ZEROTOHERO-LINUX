// Kernel für den Simulator (LPIC-2 Topic 201): Kernelquellen, Patches, Konfiguration und Bau, Installation
// mit initramfs, dracut und GRUB, DKMS, Module zur Laufzeit, sysctl und /proc, Hardware-Abfragen, udev.
// Ohne Welt-Option `kern` bleiben die Befehle aus Kampagne 1 unverändert. Neue Befehle (sysctl, udevadm, …)
// legen ihren Zustand beim ersten Aufruf selbst an.
import type { Welt, Modul } from './shell';
import { meta, darf, darfImOrdner, KOMP, TAR, CPIO } from './shell-dateien';

type Ergebnis = { out: string; err?: string; code: number };
type B = (w: Welt, a: string[], stdin: string, root: boolean) => Ergebnis;
const ok = (out = ''): Ergebnis => ({ out, code: 0 });
const fehler = (err: string, code = 1): Ergebnis => ({ out: '', err, code });

export interface KernKern {
  pfad: (w: Welt, p: string) => string;
  dialog: (w: Welt, prompt: string, weiter: (z: string) => string) => void;
  benutzer: (w: Welt) => void;
  modulPfad: (name: string) => string;
  installieren: (w: Welt, namen: string[]) => void;
  paketExtra: (w: Welt, name: string, version: string, text: string, dateien: string[]) => void;
}
let K: KernKern;
export function kernKern(k: KernKern) { K = k; }
/** Abweichende Ablageorte von Modulen (relativ zu /lib/modules/VERSION). */
export const MODUL_ORT: Record<string, string> = {};

// ---------- Feste Daten ----------

const DEB_K = '6.1.0-27-amd64';
const ALMA_K = '5.14.0-427.13.1.el9_4.x86_64';
const ALT = '6.18.64';
const NEU = '6.18.65';
const BAUM = `/usr/src/linux-${ALT}`;
const DL = '/home/lena/downloads';
const TARBALL = `${DL}/linux-${ALT}.tar.xz`;
const PATCHDATEI = `${DL}/patch-${ALT}-65.xz`;
const LAB = 'labsensor';
const LABV = '1.2';
const LABQ = `/usr/src/${LAB}-${LABV}`;
const ROOT_UUID = '3f1c0d6e-8a2b-4c51-9a0e-2d7b1e5c9f40';
const BAU_INFO: Record<string, string> = {
  '6.1.0-27-amd64': '#1 SMP PREEMPT_DYNAMIC Debian 6.1.115-1 (2024-11-01)',
  '6.1.0-26-amd64': '#1 SMP PREEMPT_DYNAMIC Debian 6.1.112-1 (2024-09-30)',
  [ALMA_K]: '#1 SMP PREEMPT_DYNAMIC Tue May 7 09:31:57 EDT 2024',
};
const LABMODUL: Modul = { name: LAB, groesse: 20480, abh: ['usbcore'], beschreibung: 'Treiber für die Messbox LS-2 (Labor Mess GmbH)', parameter: { intervall: 'Messintervall in Millisekunden (uint)', kanaele: 'Anzahl aktiver Kanäle, 1 bis 4 (uint)' } };
const PARAM_STD: Record<string, Record<string, string>> = {
  iwlwifi: { power_save: 'N', '11n_disable': '0' },
  snd_hda_intel: { power_save: '0', enable_msi: '-1' },
  e1000e: { InterruptThrottleRate: '(null)', SmartPowerDownEnable: '(null)' },
  usb_storage: { delay_use: '1', quirks: '' },
  labsensor: { intervall: '1000', kanaele: '4' },
};

// Kconfig-Symbole, die im Simulator vorkommen. std = Vorgabe (defconfig), deb = Debian-Konfiguration.
interface Sym { n: string; t: 'bool' | 'tristate' | 'string'; p: string; ort: string; std: string; deb?: string; mod?: string; neu?: boolean; wahl?: boolean; hilfe: string }
const GS = 'General setup';
const SYMBOLE: Sym[] = [
  { n: 'LOCALVERSION', t: 'string', p: 'Local version - append to kernel release', ort: GS, std: '', deb: '', hilfe: 'Wird an die Versionsnummer angehängt, zum Beispiel -lab. Erscheint in uname -r, in /boot und in /lib/modules/.' },
  { n: 'LOCALVERSION_AUTO', t: 'bool', p: 'Automatically append version information to the version string', ort: GS, std: 'y', deb: 'n', hilfe: 'Hängt bei einem Git-Baum die Revision an die Version an.' },
  { n: 'KERNEL_GZIP', t: 'bool', p: 'Gzip', ort: `${GS} -> Kernel compression mode`, std: 'y', deb: 'n', wahl: true, hilfe: 'Kernel mit gzip packen. Der alte Standard.' },
  { n: 'KERNEL_BZIP2', t: 'bool', p: 'Bzip2', ort: `${GS} -> Kernel compression mode`, std: 'n', deb: 'n', wahl: true, hilfe: 'Kernel mit bzip2 packen. Kleiner als gzip, aber langsamer beim Entpacken.' },
  { n: 'KERNEL_LZMA', t: 'bool', p: 'LZMA', ort: `${GS} -> Kernel compression mode`, std: 'n', deb: 'n', wahl: true, hilfe: 'Kernel mit LZMA packen.' },
  { n: 'KERNEL_XZ', t: 'bool', p: 'XZ', ort: `${GS} -> Kernel compression mode`, std: 'n', deb: 'y', wahl: true, hilfe: 'Kernel mit xz packen. Sehr klein, entpackt etwas langsamer als gzip.' },
  { n: 'KERNEL_LZO', t: 'bool', p: 'LZO', ort: `${GS} -> Kernel compression mode`, std: 'n', deb: 'n', wahl: true, hilfe: 'Kernel mit LZO packen. Groß, aber sehr schnell entpackt.' },
  { n: 'KERNEL_LZ4', t: 'bool', p: 'LZ4', ort: `${GS} -> Kernel compression mode`, std: 'n', deb: 'n', wahl: true, hilfe: 'Kernel mit LZ4 packen. Am schnellsten entpackt.' },
  { n: 'KERNEL_ZSTD', t: 'bool', p: 'ZSTD', ort: `${GS} -> Kernel compression mode`, std: 'n', deb: 'n', wahl: true, hilfe: 'Kernel mit zstd packen. Gutes Verhältnis von Größe und Tempo.' },
  { n: 'IKCONFIG', t: 'tristate', p: 'Kernel .config support', ort: GS, std: 'n', deb: 'n', hilfe: 'Legt die Konfiguration in den Kernel selbst.' },
  { n: 'IKCONFIG_PROC', t: 'bool', p: 'Enable access to .config through /proc/config.gz', ort: GS, std: 'n', deb: 'n', hilfe: 'Macht die eingebaute Konfiguration unter /proc/config.gz lesbar. Braucht IKCONFIG.' },
  { n: 'SCHED_CLASS_EXT', t: 'bool', p: 'Extensible Scheduling Class', ort: GS, std: 'n', neu: true, hilfe: 'Erlaubt Scheduler, die als BPF-Programm geladen werden (sched_ext). Neu seit 6.12.' },
  { n: 'BLK_DEV_INITRD', t: 'bool', p: 'Initial RAM filesystem and RAM disk (initramfs/initrd) support', ort: GS, std: 'y', deb: 'y', hilfe: 'Ohne diese Option kann der Kernel kein initramfs laden.' },
  { n: 'X86_USER_SHADOW_STACK', t: 'bool', p: 'X86 userspace shadow stack', ort: 'Processor type and features', std: 'n', neu: true, hilfe: 'Schattenstapel für Programme, schützt Rücksprungadressen. Neu seit 6.6.' },
  { n: 'MODULES', t: 'bool', p: 'Enable loadable module support', ort: 'Enable loadable module support', std: 'y', deb: 'y', hilfe: 'Ohne diese Option gibt es keine ladbaren Module, alles muss fest eingebaut sein.' },
  { n: 'MODULE_UNLOAD', t: 'bool', p: 'Module unloading', ort: 'Enable loadable module support', std: 'y', deb: 'y', hilfe: 'Erlaubt rmmod.' },
  { n: 'MODULE_SIG', t: 'bool', p: 'Module signature verification', ort: 'Enable loadable module support', std: 'n', deb: 'y', hilfe: 'Prüft Signaturen von Modulen. Unsignierte Module laden trotzdem, markieren den Kernel aber als „tainted“.' },
  { n: 'SYSTEM_TRUSTED_KEYS', t: 'string', p: 'Additional X.509 keys for default system keyring', ort: 'Cryptographic API -> Certificates for signature checking', std: '', deb: 'debian/certs/debian-uefi-certs.pem', hilfe: 'Datei mit zusätzlichen Schlüsseln. Die Debian-Konfiguration verweist auf eine Datei, die es nur im Debian-Quellpaket gibt.' },
  { n: 'SYSTEM_REVOCATION_KEYS', t: 'string', p: 'X.509 certificates to be preloaded into the system blacklist keyring', ort: 'Cryptographic API -> Certificates for signature checking', std: '', deb: '', hilfe: 'Datei mit gesperrten Schlüsseln.' },
  { n: 'SCSI', t: 'tristate', p: 'SCSI device support', ort: 'Device Drivers -> SCSI device support', std: 'y', deb: 'm', mod: 'scsi_mod', hilfe: 'SCSI-Kern, auch für USB-Sticks nötig.' },
  { n: 'SATA_AHCI', t: 'tristate', p: 'AHCI SATA support', ort: 'Device Drivers -> Serial ATA and Parallel ATA drivers (libata)', std: 'y', deb: 'm', mod: 'ahci,libahci', hilfe: 'Treiber für SATA-Controller im AHCI-Modus.' },
  { n: 'BLK_DEV_NVME', t: 'tristate', p: 'NVM Express block device', ort: 'Device Drivers -> NVME Support', std: 'y', deb: 'm', mod: 'nvme,nvme_core', hilfe: 'Treiber für NVMe-SSDs. Liegt die Wurzel auf einer NVMe-SSD, muss er fest eingebaut oder im initramfs sein.' },
  { n: 'E1000E', t: 'tristate', p: 'Intel(R) PRO/1000 PCI-Express Gigabit Ethernet support', ort: 'Device Drivers -> Network device support -> Ethernet driver support', std: 'y', deb: 'm', mod: 'e1000e', hilfe: 'Treiber für Intel-Netzwerkkarten wie die I219-V.' },
  { n: 'CFG80211', t: 'tristate', p: 'cfg80211 - wireless configuration API', ort: 'Networking support -> Wireless', std: 'y', deb: 'm', mod: 'cfg80211', hilfe: 'Gemeinsame Schnittstelle der WLAN-Treiber.' },
  { n: 'RFKILL', t: 'tristate', p: 'RF switch subsystem support', ort: 'Networking support', std: 'y', deb: 'm', mod: 'rfkill', hilfe: 'Funk ein- und ausschalten.' },
  { n: 'IWLWIFI', t: 'tristate', p: 'Intel Wireless WiFi Next Gen AGN (iwlwifi)', ort: 'Device Drivers -> Network device support -> Wireless LAN', std: 'n', deb: 'm', mod: 'iwlwifi', hilfe: 'Treiber für Intel-WLAN wie die AX200.' },
  { n: 'BT', t: 'tristate', p: 'Bluetooth subsystem support', ort: 'Networking support', std: 'n', deb: 'm', mod: 'bluetooth', hilfe: 'Bluetooth-Kern.' },
  { n: 'BT_HCIBTUSB', t: 'tristate', p: 'HCI USB driver', ort: 'Networking support -> Bluetooth subsystem support -> Bluetooth device drivers', std: 'n', deb: 'm', mod: 'btusb', hilfe: 'Bluetooth über USB.' },
  { n: 'USB', t: 'tristate', p: 'Support for Host-side USB', ort: 'Device Drivers -> USB support', std: 'y', deb: 'm', mod: 'usbcore,usb_common', hilfe: 'USB-Kern.' },
  { n: 'USB_XHCI_HCD', t: 'tristate', p: 'xHCI HCD (USB 3.0) support', ort: 'Device Drivers -> USB support', std: 'y', deb: 'm', mod: 'xhci_hcd,xhci_pci', hilfe: 'Treiber für USB-3-Controller.' },
  { n: 'USB_STORAGE', t: 'tristate', p: 'USB Mass Storage support', ort: 'Device Drivers -> USB support', std: 'y', deb: 'm', mod: 'usb_storage', hilfe: 'USB-Sticks und -Platten.' },
  { n: 'USB_UAS', t: 'tristate', p: 'USB Attached SCSI', ort: 'Device Drivers -> USB support', std: 'n', deb: 'm', mod: 'uas', hilfe: 'Schnelleres Protokoll für USB-Platten.' },
  { n: 'SOUND', t: 'tristate', p: 'Sound card support', ort: 'Device Drivers -> Sound card support', std: 'y', deb: 'm', mod: 'soundcore', hilfe: 'Grundlage für Ton.' },
  { n: 'SND', t: 'tristate', p: 'Advanced Linux Sound Architecture', ort: 'Device Drivers -> Sound card support', std: 'y', deb: 'm', mod: 'snd', hilfe: 'ALSA.' },
  { n: 'SND_HDA_INTEL', t: 'tristate', p: 'HD Audio PCI', ort: 'Device Drivers -> Sound card support -> ALSA -> HD-Audio', std: 'y', deb: 'm', mod: 'snd_hda_intel,snd_hda_codec', hilfe: 'Eingebauter Ton der meisten PCs.' },
  { n: 'DRM', t: 'tristate', p: 'Direct Rendering Manager (XFree86 4.1.0 and higher DRI support)', ort: 'Device Drivers -> Graphics support', std: 'y', deb: 'm', mod: 'drm,drm_kms_helper', hilfe: 'Grundlage der Grafiktreiber.' },
  { n: 'DRM_I915', t: 'tristate', p: 'Intel 8xx/9xx/G3x/G4x/HD Graphics', ort: 'Device Drivers -> Graphics support', std: 'y', deb: 'm', mod: 'i915', hilfe: 'Intel-Grafik.' },
  { n: 'ACPI_VIDEO', t: 'tristate', p: 'Video', ort: 'Power management and ACPI options -> ACPI Support', std: 'y', deb: 'm', mod: 'video', hilfe: 'Helligkeit und Bildschirmumschaltung über ACPI.' },
  { n: 'VIDEO_DEV', t: 'tristate', p: 'Video4Linux core', ort: 'Device Drivers -> Multimedia support', std: 'n', deb: 'm', mod: 'videodev', hilfe: 'Grundlage für Kameras.' },
  { n: 'USB_VIDEO_CLASS', t: 'tristate', p: 'USB Video Class (UVC)', ort: 'Device Drivers -> Multimedia support -> Media drivers -> Media USB Adapters', std: 'n', deb: 'm', mod: 'uvcvideo', hilfe: 'USB-Kameras wie die Webcam C270.' },
  { n: 'INPUT_PCSPKR', t: 'tristate', p: 'PC Speaker support', ort: 'Device Drivers -> Input device support -> Miscellaneous devices', std: 'n', deb: 'm', mod: 'pcspkr', hilfe: 'Der Piepser im Gehäuse.' },
  { n: 'BLK_DEV_FD', t: 'tristate', p: 'Normal floppy disk support', ort: 'Device Drivers -> Block devices', std: 'n', deb: 'm', mod: 'floppy', hilfe: 'Diskettenlaufwerke.' },
  { n: 'FAT_FS', t: 'tristate', p: 'FAT filesystem support', ort: 'File systems -> DOS/FAT/EXFAT/NT Filesystems', std: 'y', deb: 'm', mod: 'fat', hilfe: 'Gemeinsamer Teil von MSDOS- und VFAT-Dateisystem.' },
  { n: 'VFAT_FS', t: 'tristate', p: 'VFAT (Windows-95) fs support', ort: 'File systems -> DOS/FAT/EXFAT/NT Filesystems', std: 'y', deb: 'm', mod: 'vfat', hilfe: 'Lange Dateinamen auf FAT, etwa auf USB-Sticks und der EFI-Partition.' },
];
const SYM = Object.fromEntries(SYMBOLE.map((s) => [s.n, s]));
const KOMP_ART: Record<string, [string, string, number]> = { KERNEL_GZIP: ['GZIP', 'gz', 9.6], KERNEL_BZIP2: ['BZIP2', 'bz2', 9.1], KERNEL_LZMA: ['LZMA', 'lzma', 8.0], KERNEL_XZ: ['XZKERN', 'xz', 7.9], KERNEL_LZO: ['LZO', 'lzo', 10.9], KERNEL_LZ4: ['LZ4', 'lz4', 11.3], KERNEL_ZSTD: ['ZSTD22', 'zst', 8.4] };

// ---------- Zustand ----------

export interface KernOptionen {
  quelle?: 'download' | 'entpackt' | 'konfiguriert' | 'gebaut';   // Kernelquellen von kernel.org
  werkzeuge?: boolean;          // Build-Abhängigkeiten installiert
  sensor?: boolean;             // Messbox LS-2 steckt am USB
  dkms?: 'quelle' | 'installiert';   // Treiberquelle in /usr/src, oder schon per DKMS installiert und geladen
  regel?: 'kaputt';             // fehlerhafte udev-Regel liegt bereit
  sysctlFluechtig?: boolean;    // ip_forward wurde nur zur Laufzeit gesetzt
  fehlinstalliert?: boolean;    // make install lief vor make modules_install
  tippfehler?: boolean;         // Parametername in /etc/modprobe.d/e1000e.conf falsch geschrieben
}
interface Dk { hinzu: boolean; gebaut: string[]; inst: string[] }
interface Bau { release: string; info: string; nr: number; kernel: boolean; module: boolean; konfig: string; mods: string[]; builtin: string[]; komp: string }
interface KStand {
  dkms: Dk;
  sensor: boolean;
  taint: number;
  dmesg: string[];
  sek: number;
  bau: Record<string, Bau>;
  fallback: string | null;
  gut: string;                 // zuletzt erfolgreich gestarteter Kernel
  links: string[];
  infos: Record<string, string>;
  fehlstart: string | null;
  param: Record<string, Record<string, string>>;
}
type KW = Welt & { kernstand?: KStand };
export function kernAktiv(w: Welt): boolean { return !!(w as KW).kernstand; }
function ks(w: Welt): KStand { basis(w); return (w as KW).kernstand!; }

const SYSCTL_STD: [string, string, boolean?][] = [
  ['dev.raid.speed_limit_max', '200000'], ['dev.raid.speed_limit_min', '1000'],
  ['fs.file-max', '9223372036854775807'], ['fs.file-nr', '9344\t0\t9223372036854775807', true], ['fs.protected_fifos', '1'], ['fs.protected_hardlinks', '1'], ['fs.protected_regular', '2'], ['fs.protected_symlinks', '1'], ['fs.suid_dumpable', '0'],
  ['kernel.core_pattern', 'core'], ['kernel.core_uses_pid', '0'], ['kernel.dmesg_restrict', '1'], ['kernel.domainname', '(none)'], ['kernel.hostname', '@host'], ['kernel.modules_disabled', '0'],
  ['kernel.osrelease', '@kernel', true], ['kernel.ostype', 'Linux', true], ['kernel.panic', '0'], ['kernel.panic_on_oops', '0'], ['kernel.pid_max', '4194304'], ['kernel.printk', '4\t4\t1\t7'],
  ['kernel.randomize_va_space', '2'], ['kernel.sysrq', '438'], ['kernel.tainted', '0', true], ['kernel.threads-max', '126473'], ['kernel.version', '@version', true],
  ['net.core.default_qdisc', 'pfifo_fast'], ['net.core.somaxconn', '4096'],
  ['net.ipv4.conf.all.accept_redirects', '1'], ['net.ipv4.conf.all.forwarding', '0'], ['net.ipv4.conf.all.rp_filter', '0'], ['net.ipv4.conf.all.send_redirects', '1'], ['net.ipv4.conf.default.rp_filter', '0'],
  ['net.ipv4.icmp_echo_ignore_all', '0'], ['net.ipv4.icmp_echo_ignore_broadcasts', '1'], ['net.ipv4.ip_default_ttl', '64'], ['net.ipv4.ip_forward', '0'], ['net.ipv4.ip_local_port_range', '32768\t60999'],
  ['net.ipv4.tcp_fin_timeout', '60'], ['net.ipv4.tcp_syncookies', '1'],
  ['net.ipv6.conf.all.disable_ipv6', '0'], ['net.ipv6.conf.all.forwarding', '0'],
  ['vm.dirty_background_ratio', '10'], ['vm.dirty_ratio', '20'], ['vm.drop_caches', '0'], ['vm.max_map_count', '65530'], ['vm.overcommit_memory', '0'], ['vm.swappiness', '60'], ['vm.vfs_cache_pressure', '100'],
];
const SYSCTL_NUR_LESEN = new Set(SYSCTL_STD.filter((x) => x[2]).map((x) => x[0]));
const sysPfad = (k: string) => '/proc/sys/' + k.replace(/\./g, '/');
const sysKey = (p: string) => p.replace(/^\/proc\/sys\//, '').replace(/\//g, '.');

function ordnerAnlegen(w: Welt, p: string, besitzer = 'root') {
  const teile = p.split('/').filter(Boolean);
  for (let i = 1; i <= teile.length; i++) {
    const d = '/' + teile.slice(0, i).join('/');
    if (!(d in w.fs)) { w.fs[d] = null; const m = meta(w, d); m.mode = 0o755; m.owner = besitzer; m.group = besitzer; }
  }
}
function datei(w: Welt, p: string, inhalt: string, mode = 0o644, besitzer = 'root') {
  ordnerAnlegen(w, p.slice(0, p.lastIndexOf('/')) || '/');
  w.fs[p] = inhalt; const m = meta(w, p); m.mode = mode; m.owner = besitzer; m.group = besitzer; m.mtime = w.uhr;
}
function loeschen(w: Welt, p: string) { for (const k of Object.keys(w.fs)) if (k === p || k.startsWith(p + '/')) { delete w.fs[k]; if (w.meta) delete w.meta[k]; } }

function sysctlStandard(w: Welt) {
  for (const [k, v0] of SYSCTL_STD) {
    const v = v0 === '@host' ? w.host : v0 === '@kernel' ? w.kernel : v0 === '@version' ? (ks0(w)?.infos[w.kernel] ?? BAU_INFO[w.kernel] ?? '#1 SMP') : v0;
    datei(w, sysPfad(k), v + '\n', SYSCTL_NUR_LESEN.has(k) ? 0o444 : k === 'vm.drop_caches' ? 0o200 : 0o644);
  }
}
const ks0 = (w: Welt) => (w as KW).kernstand;

/** Legt einmalig alles an, was die Kernel-Befehle brauchen. */
function basis(w: Welt) {
  const x = w as KW; if (x.kernstand) return;
  x.kernstand = { dkms: { hinzu: false, gebaut: [], inst: [] }, sensor: false, taint: 0, dmesg: [], sek: 1520, bau: {}, fallback: null, gut: w.kernel, links: [], infos: { ...BAU_INFO }, fehlstart: null, param: {} };
  sysctlStandard(w);
  datei(w, '/proc/ioports', '0000-0cf7 : PCI Bus 0000:00\n  0000-001f : dma1\n  0020-0021 : pic1\n  0040-0043 : timer0\n  0050-0053 : timer1\n  0060-0060 : keyboard\n  0064-0064 : keyboard\n  0070-0077 : rtc0\n  0080-008f : dma page reg\n  00a0-00a1 : pic2\n  00c0-00df : dma2\n  00f0-00ff : fpu\n  03c0-03df : vga+\n0cf8-0cff : PCI conf1\n1000-ffff : PCI Bus 0000:00\n  f000-f03f : 0000:00:02.0\n  f040-f05f : 0000:00:1f.4\n  f060-f07f : 0000:00:17.0\n    f060-f07f : ahci\n  f080-f083 : 0000:00:17.0\n    f080-f083 : ahci\n  f090-f097 : 0000:00:17.0\n    f090-f097 : ahci\n', 0o444);
  datei(w, '/proc/dma', ' 4: cascade\n', 0o444);
  if (!('/proc/interrupts' in w.fs)) datei(w, '/proc/interrupts', '            CPU0\n   0:         33  IR-IO-APIC    2-edge      timer\n', 0o444);
  datei(w, '/proc/sys/kernel/random/boot_id', 'b0e2c4a1-6f3d-4e8b-9a71-2c5d8e0f1a34\n', 0o444);
  if (w.distro === 'debian') {
    // /etc/sysctl.conf auf Debian 12: eine auskommentierte Vorlage
    datei(w, '/etc/sysctl.conf', '#\n# /etc/sysctl.conf – Kernelparameter beim Start setzen\n# Mehr in /etc/sysctl.d/ und in sysctl.conf(5).\n# (Auf Debian 12 steht hier eine englisch kommentierte Vorlage.)\n#\n\n#kernel.domainname = example.com\n\n# Weniger Kernelmeldungen auf der Konsole\n#kernel.printk = 3 4 1 3\n\n# IPv4-Pakete weiterleiten (Router)\n#net.ipv4.ip_forward=1\n\n# IPv6-Pakete weiterleiten\n#net.ipv6.conf.all.forwarding=1\n\n# Keine ICMP-Umleitungen annehmen\n#net.ipv4.conf.all.accept_redirects = 0\n');
    datei(w, '/etc/sysctl.d/README.sysctl', 'Dateien mit der Endung .conf in diesem Verzeichnis liest systemd-sysctl beim Start\nin der Reihenfolge ihrer Namen. Eigene Einstellungen gehören hierher, etwa nach\n/etc/sysctl.d/90-eigene.conf. Sofort anwenden: sysctl --system oder sysctl -p DATEI.\n');
    datei(w, '/etc/sysctl.d/99-sysctl.conf', '-> ../sysctl.conf', 0o777);
    datei(w, '/usr/lib/sysctl.d/50-pid-max.conf', '# Mehr Prozess-IDs für große Systeme (aus systemd)\nkernel.pid_max = 4194304\n');
    datei(w, '/usr/lib/sysctl.d/50-default.conf', '# Voreinstellungen von systemd (gekürzt)\nkernel.sysrq = 0x01b6\nkernel.core_uses_pid = 1\nnet.ipv4.conf.default.rp_filter = 2\nnet.ipv4.conf.all.rp_filter = 2\nnet.core.default_qdisc = fq_codel\nfs.protected_hardlinks = 1\nfs.protected_symlinks = 1\nfs.protected_regular = 1\nfs.protected_fifos = 1\n');
    if (!('/etc/modules' in w.fs)) datei(w, '/etc/modules', '# /etc/modules: Kernelmodule, die beim Start geladen werden.\n#\n# Ein Modulname pro Zeile. Zeilen mit „#“ werden ignoriert.\n');
    datei(w, '/etc/modules-load.d/modules.conf', '-> ../modules', 0o777);
    datei(w, '/etc/kernel/postinst.d/initramfs-tools', '#!/bin/sh\n# erzeugt das initramfs für einen neuen Kernel (update-initramfs -c -k VERSION)\n', 0o755);
    datei(w, '/etc/kernel/postinst.d/zz-update-grub', '#!/bin/sh\n# erzeugt grub.cfg neu, wenn ein Kernel installiert wurde\n', 0o755);
    datei(w, '/etc/kernel/postrm.d/initramfs-tools', '#!/bin/sh\n# löscht das initramfs eines entfernten Kernels\n', 0o755);
    datei(w, '/etc/kernel/postrm.d/zz-update-grub', '#!/bin/sh\n', 0o755);
    datei(w, '/etc/initramfs-tools/initramfs.conf', '#\n# initramfs.conf – Einstellungen für mkinitramfs (gekürzt)\n#\n\n# most: die meisten Treiber für Platten und Dateisysteme, dep: nur, was dieser Rechner braucht\nMODULES=most\n\n# Packverfahren: gzip, bzip2, lz4, lzma, lzop, xz, zstd\nCOMPRESS=zstd\n');
    datei(w, '/etc/initramfs-tools/modules', '# Zusätzliche Module für das initramfs, eines pro Zeile.\n');
    ordnerAnlegen(w, '/etc/initramfs-tools/hooks'); ordnerAnlegen(w, '/etc/initramfs-tools/scripts');
    for (const v of ['6.1.0-27-amd64', '6.1.0-26-amd64']) {
      const p = `/boot/vmlinuz-${v}`;
      if (p in w.fs) datei(w, p, kernelBild(v === '6.1.0-27-amd64' ? 8193984 : 8188672, `${v} (debian-kernel@lists.debian.org) ${BAU_INFO[v]}`));
      if (`/boot/initrd.img-${v}` in w.fs && !w.fs[`/boot/initrd.img-${v}`]) datei(w, `/boot/initrd.img-${v}`, initrdInhalt(w, v, true));
      datei(w, `/boot/config-${v}`, konfigText(debKonfig(), '6.1.' + (v.includes('27') ? '115' : '112')));
      datei(w, `/boot/System.map-${v}`, 'ffffffff81000000 T _stext\nffffffff81000000 T _text\n(… gekürzt …)\n');
    }
  }
  ordnerAnlegen(w, '/usr/src');
  datei(w, '/etc/udev/udev.conf', '# udev.conf – Einstellungen für systemd-udevd\n#udev_log=info\n');
  ordnerAnlegen(w, '/etc/udev/rules.d'); ordnerAnlegen(w, '/run/udev/rules.d');
  datei(w, '/lib/udev/rules.d/50-udev-default.rules', '# Grundregeln für Gerätedateien (gekürzt)\nSUBSYSTEM=="tty", KERNEL=="ptmx", GROUP="tty", MODE="0666"\nSUBSYSTEM=="tty", KERNEL=="tty", GROUP="tty", MODE="0666"\nSUBSYSTEM=="tty", KERNEL=="ttyACM[0-9]*|ttyUSB[0-9]*", GROUP="dialout"\nSUBSYSTEM=="sound", GROUP="audio"\nSUBSYSTEM=="video4linux", GROUP="video"\nSUBSYSTEM=="block", GROUP="disk"\nSUBSYSTEM=="usb", ENV{DEVTYPE}=="usb_device", MODE="0664"\n');
  datei(w, '/lib/udev/rules.d/60-persistent-storage.rules', '# Feste Namen unter /dev/disk/by-* (gekürzt)\nACTION=="remove", GOTO="persistent_storage_end"\nSUBSYSTEM!="block", GOTO="persistent_storage_end"\nKERNEL=="nvme*", ENV{DEVTYPE}=="disk", SYMLINK+="disk/by-id/nvme-$env{ID_SERIAL}"\nLABEL="persistent_storage_end"\n');
  datei(w, '/lib/udev/rules.d/80-drivers.rules', '# Treiber zu neuen Geräten laden (gekürzt)\nACTION!="add", GOTO="drivers_end"\nENV{MODALIAS}=="?*", RUN{builtin}+="kmod load"\nLABEL="drivers_end"\n');
  datei(w, '/lib/udev/rules.d/99-systemd.rules', '# Geräte für systemd markieren (gekürzt)\nSUBSYSTEM=="net", KERNEL!="lo", TAG+="systemd"\nSUBSYSTEM=="block", TAG+="systemd"\n');
  // Module des laufenden Kernels
  const k = w.kernel;
  ordnerAnlegen(w, `/lib/modules/${k}`);
  if (!(`/lib/modules/${k}/modules.dep` in w.fs)) depmodSchreiben(w, k);
  if (!(`/lib/modules/${k}/modules.builtin` in w.fs)) datei(w, `/lib/modules/${k}/modules.builtin`, 'kernel/drivers/tty/serial/8250/8250.ko\nkernel/drivers/base/firmware_loader/firmware_class.ko\nkernel/lib/zlib_inflate/zlib_inflate.ko\n');
  for (const [m, ps] of Object.entries(PARAM_STD)) if (w.geladen[m]) paramSetzen(w, m, ps);
}

export function kernelBild(groesse: number, text: string) { return `\u0007KERNEL:${groesse}:${text}`; }

// ---------- Kconfig ----------

type Konfig = Record<string, string>;   // Symbol -> y/m/n oder Text
function debKonfig(): Konfig { return Object.fromEntries(SYMBOLE.filter((s) => s.deb !== undefined).map((s) => [s.n, s.deb!])); }
function stdKonfig(): Konfig { return Object.fromEntries(SYMBOLE.map((s) => [s.n, s.std])); }
function konfigLesen(t: string): Konfig {
  const k: Konfig = {};
  for (const z of t.split('\n')) {
    let m;
    if ((m = z.match(/^CONFIG_(\w+)=(.*)$/))) { const v = m[2].trim(); k[m[1]] = v.startsWith('"') ? v.replace(/^"|"$/g, '') : v; }
    else if ((m = z.match(/^# CONFIG_(\w+) is not set/))) k[m[1]] = SYM[m[1]]?.t === 'string' ? '' : 'n';
  }
  // Bei einer Auswahl gilt die letzte gesetzte Option
  const wahl = SYMBOLE.filter((s) => s.wahl && k[s.n] === 'y');
  if (wahl.length > 1) for (const s of wahl.slice(0, -1)) k[s.n] = 'n';
  return k;
}
function konfigText(k: Konfig, version: string): string {
  const z = ['#', '# Automatically generated file; DO NOT EDIT.', `# Linux/x86 ${version} Kernel Configuration`, '#', 'CONFIG_CC_VERSION_TEXT="gcc (Debian 12.2.0-14+deb12u1) 12.2.0"', '# (Im Simulator gekürzt auf die Optionen, die in den Missionen vorkommen. Die echte Datei hat über 10 000 Zeilen.)'];
  let ort = '';
  for (const s of SYMBOLE) {
    if (!(s.n in k)) continue;
    if (s.ort.split(' -> ')[0] !== ort) { ort = s.ort.split(' -> ')[0]; z.push('', '#', `# ${ort}`, '#'); }
    const v = k[s.n];
    z.push(s.t === 'string' ? `CONFIG_${s.n}="${v}"` : v === 'n' ? `# CONFIG_${s.n} is not set` : `CONFIG_${s.n}=${v}`);
  }
  return z.join('\n') + '\n';
}
function komp(k: Konfig) { return SYMBOLE.find((s) => s.wahl && k[s.n] === 'y')?.n ?? 'KERNEL_GZIP'; }
function setzen(k: Konfig, n: string, v: string) {
  k[n] = v;
  if (SYM[n]?.wahl && v === 'y') for (const s of SYMBOLE) if (s.wahl && s.n !== n) k[s.n] = 'n';
  if (n === 'IKCONFIG' && v === 'n') k.IKCONFIG_PROC = 'n';
}
const fehlend = (k: Konfig) => SYMBOLE.filter((s) => !(s.n in k));

// ---------- Quellbaum ----------

function makefile(sub: string) { return `# SPDX-License-Identifier: GPL-2.0\nVERSION = 6\nPATCHLEVEL = 18\nSUBLEVEL = ${sub}\nEXTRAVERSION =\n# (Im Simulator gekürzt. Das echte Makefile hat rund 2000 Zeilen.)\n\n# Die Ziele zeigt: make help\n`; }
function baumEintraege(): { p: string; c: string | null; m: number }[] {
  const r = `linux-${ALT}`;
  const d = (p: string) => ({ p: `${r}/${p}/`.replace(/\/\/$/, '/'), c: null, m: 0o775 });
  const f = (p: string, c: string, m = 0o664) => ({ p: `${r}/${p}`, c, m });
  return [
    { p: `${r}/`, c: null, m: 0o775 },
    ...['arch', 'arch/x86', 'arch/x86/boot', 'arch/x86/configs', 'block', 'certs', 'crypto', 'Documentation', 'Documentation/admin-guide', 'Documentation/admin-guide/sysctl', 'Documentation/kbuild', 'Documentation/process', 'drivers', 'drivers/net', 'drivers/usb', 'fs', 'include', 'init', 'io_uring', 'ipc', 'kernel', 'lib', 'mm', 'net', 'rust', 'samples', 'scripts', 'scripts/kconfig', 'security', 'sound', 'tools', 'usr', 'virt'].map(d),
    f('Makefile', makefile(String(ALT.split('.')[2]))),
    f('Kconfig', '# SPDX-License-Identifier: GPL-2.0\n#\n# Wurzel der Kconfig-Beschreibung. Jede Option steht in einer Kconfig-Datei im passenden Unterordner.\nmainmenu "Linux/$(ARCH) $(KERNELVERSION) Kernel Configuration"\nsource "init/Kconfig"\nsource "kernel/Kconfig.freezer"\nsource "fs/Kconfig.binfmt"\n(… gekürzt …)\n'),
    f('README', 'Linux-Kernel\n============\n\nDie Dokumentation liegt im Ordner Documentation/ und lässt sich mit\n„make htmldocs“ oder „make pdfdocs“ aufbereiten. Online: https://docs.kernel.org/\n\nZum Einstieg: Documentation/admin-guide/README.rst\nMindestversionen der Werkzeuge: Documentation/process/changes.rst\n(Im Simulator gekürzt und übersetzt.)\n'),
    f('COPYING', 'Der Linux-Kernel steht unter der GNU General Public License Version 2 (GPL-2.0),\nmit der Ausnahme für Systemaufrufe in LICENSES/exceptions/Linux-syscall-note.\n(Im Simulator gekürzt.)\n'),
    f('MAINTAINERS', 'Liste der Betreuer jedes Teilsystems mit Mailingliste und Git-Baum.\nscripts/get_maintainer.pl findet zu einem Patch die richtigen Empfänger.\n(Im Simulator gekürzt.)\n'),
    f('CREDITS', '(Liste der Mitwirkenden, im Simulator gekürzt.)\n'),
    f('Documentation/index.rst', 'Die Dokumentation des Linux-Kernels\n===================================\n\nadmin-guide/   Für Administratoren: Kernel bauen, Parameter, sysctl, Fehlersuche\nprocess/       Wie die Entwicklung abläuft, Mindestversionen (changes.rst)\nkbuild/        Das Bausystem: Kconfig, Makefiles, externe Module\n(Im Simulator gekürzt. Online: https://docs.kernel.org/)\n'),
    f('Documentation/admin-guide/README.rst', 'Linux-Kernel – Hinweise für Administratoren\n==========================================\n\nKernel bauen in Kurzform:\n  make menuconfig        (oder: cp /boot/config-$(uname -r) .config && make olddefconfig)\n  make -j$(nproc)\n  sudo make modules_install\n  sudo make install\n\nNicht als root bauen. Nur die Installation braucht root.\n(Im Simulator gekürzt und übersetzt.)\n'),
    f('Documentation/admin-guide/kernel-parameters.txt', 'Parameter auf der Kernel-Befehlszeile (Auszug, im Simulator gekürzt)\n\n\tinit=\t\tProgramm, das statt /sbin/init als erster Prozess startet.\n\tquiet\t\tWeniger Meldungen beim Start.\n\troot=\t\tGerät mit dem Wurzeldateisystem, z. B. root=UUID=…\n\tro\t\tWurzel zuerst nur lesend einhängen.\n\tsingle\t\tStart in den Rettungsmodus.\n\t<modul>.<parameter>=\tParameter für ein Modul, z. B. e1000e.InterruptThrottleRate=3000\n\tmodule_blacklist=\tModule, die nicht geladen werden dürfen, durch Kommas getrennt.\n'),
    f('Documentation/admin-guide/sysctl/kernel.rst', 'Dokumentation für /proc/sys/kernel/ (Auszug, im Simulator gekürzt)\n\npanic\t\tSekunden bis zum Neustart nach einem Kernel-Panic, 0 = nie.\npid_max\t\tHöchste Prozess-ID plus eins.\nsysrq\t\tWelche SysRq-Funktionen erlaubt sind (Bitmaske).\ntainted\t\tWarum der Kernel als verunreinigt gilt (Bitmaske).\n'),
    f('Documentation/admin-guide/sysctl/vm.rst', 'Dokumentation für /proc/sys/vm/ (Auszug, im Simulator gekürzt)\n\nswappiness\tWie bereitwillig der Kernel auslagert, 0 bis 200.\ndirty_ratio\tAnteil des Speichers, ab dem Schreiber selbst auf die Platte schreiben müssen.\n'),
    f('Documentation/kbuild/modules.rst', 'Externe Module bauen (Auszug, im Simulator gekürzt)\n\n  make -C /lib/modules/$(uname -r)/build M=$PWD\n  make -C /lib/modules/$(uname -r)/build M=$PWD modules_install\n\nOhne INSTALL_MOD_DIR landen externe Module unter /lib/modules/VERSION/updates/.\n'),
    f('Documentation/kbuild/kconfig.rst', 'Kconfig bedienen (Auszug, im Simulator gekürzt)\n\nmake oldconfig      fragt nur nach neuen Optionen\nmake olddefconfig   setzt neue Optionen still auf ihre Vorgabe\nmake localmodconfig schaltet Module ab, die gerade nicht geladen sind\n'),
    f('Documentation/process/changes.rst', 'Mindestversionen der Werkzeuge zum Bauen des Kernels.\n(Im Simulator gekürzt. Die genaue Tabelle steht online unter https://docs.kernel.org/process/changes.html)\n'),
    f('arch/x86/configs/x86_64_defconfig', '(Vorgaben für make defconfig auf x86_64, im Simulator gekürzt)\n'),
    f('scripts/config', '#!/bin/bash\n# Ändert Optionen in .config von der Befehlszeile aus.\n# scripts/config --enable X | --disable X | --module X | --set-str X TEXT | --set-val X WERT | --state X\n', 0o775),
    f('scripts/kconfig/Makefile', '# Ziele für die Konfiguration: config, menuconfig, oldconfig, olddefconfig, defconfig, localmodconfig …\n'),
    f('certs/Makefile', '# Schlüssel für signierte Module\n'),
    f('init/main.c', '// Hier startet der Kernel: start_kernel() und später der erste Prozess.\n// (Im Simulator gekürzt.)\n'),
    f('kernel/fork.c', '// Neue Prozesse anlegen. (Im Simulator gekürzt.)\n'),
  ];
}
const PATCH_TEXT = `diff --git a/Makefile b/Makefile
index 8e1d4b3a2c71..c4f02e9b6d15 100644
--- a/Makefile
+++ b/Makefile
@@ -1,7 +1,7 @@
 # SPDX-License-Identifier: GPL-2.0
 VERSION = 6
 PATCHLEVEL = 18
-SUBLEVEL = 64
+SUBLEVEL = 65
 EXTRAVERSION =
 # (Im Simulator gekürzt. Das echte Makefile hat rund 2000 Zeilen.)

`;
function baumAuspacken(w: Welt, ziel: string, besitzer: string) {
  for (const e of baumEintraege()) {
    const p = `${ziel}/${e.p.replace(/^linux-[\d.]+\/?/, '')}`.replace(/\/$/, '');
    if (e.c === null) { if (!(p in w.fs)) w.fs[p] = null; } else w.fs[p] = e.c;
    const m = meta(w, p); m.mode = e.c === null ? 0o775 : e.m; m.owner = besitzer; m.group = besitzer; m.mtime = w.uhr;
  }
}
const istBaum = (w: Welt, d: string) => /^PATCHLEVEL = /m.test(w.fs[`${d}/Makefile`] ?? '') && `${d}/Kconfig` in w.fs;
function version(w: Welt, d: string) {
  const mf = w.fs[`${d}/Makefile`] ?? '';
  const g = (n: string) => mf.match(new RegExp(`^${n} = ?(.*)$`, 'm'))?.[1]?.trim() ?? '';
  return { ver: `${g('VERSION')}.${g('PATCHLEVEL')}.${g('SUBLEVEL')}`, extra: g('EXTRAVERSION') };
}

// ---------- Module, modules.dep, Parameter ----------

function modName(p: string) { return p.split('/').pop()!.replace(/\.ko(\.xz|\.zst)?$/, '').replace(/-/g, '_'); }
function depmodSchreiben(w: Welt, k: string): string {
  const basisP = `/lib/modules/${k}/`;
  const dateien = Object.keys(w.fs).filter((p) => p.startsWith(basisP) && /\.ko(\.xz)?$/.test(p) && typeof w.fs[p] === 'string').map((p) => p.slice(basisP.length)).sort();
  const wo: Record<string, string> = {};
  // updates/ hat Vorrang vor kernel/
  for (const d of dateien) { const n = modName(d); if (!wo[n] || d.startsWith('updates/')) wo[n] = d; }
  const alle = (n: string, s = new Set<string>()): string[] => { for (const a of (w.verfuegbar[n]?.abh ?? [])) if (!s.has(a) && wo[a]) { s.add(a); alle(a, s); } return [...s]; };
  const text = Object.entries(wo).map(([n, d]) => `${d}:${alle(n).map((a) => ' ' + wo[a]).join('')}`).join('\n') + '\n';
  datei(w, `${basisP}modules.dep`, text);
  datei(w, `${basisP}modules.alias`, '# Aliases extracted from modules themselves.\n' + Object.keys(wo).map((n) => n === LAB ? 'alias usb:v1209p0001d*dc*dsc*dp*ic*isc*ip*in* labsensor' : n === 'e1000e' ? 'alias pci:v00008086d000015BCsv*sd*bc*sc*i* e1000e' : n === 'usb_storage' ? 'alias usb:v*p*d*dc*dsc*dp*ic08isc06ip50in* usb_storage' : '').filter(Boolean).join('\n') + '\n');
  datei(w, `${basisP}modules.dep.bin`, '\u0007BIN:' + text.length * 2);
  for (const [n, d] of Object.entries(wo)) if (n === LAB) MODUL_ORT[n] = d;
  return text;
}
function imDep(w: Welt, n: string, k = w.kernel): boolean {
  const t = w.fs[`/lib/modules/${k}/modules.dep`];
  if (typeof t !== 'string') return false;
  return t.split('\n').some((z) => z && modName(z.split(':')[0]) === n);
}
function eingebaut(w: Welt, k = w.kernel): Set<string> {
  return new Set((w.fs[`/lib/modules/${k}/modules.builtin`] ?? '').split('\n').filter(Boolean).map(modName));
}
function paramSetzen(w: Welt, m: string, ps: Record<string, string>) {
  ks(w).param[m] = { ...ps };
  // e1000e legt seine Parameter nicht unter /sys/module ab (Rechte 0 im Treiber)
  if (m === 'e1000e') return;
  for (const [k, v] of Object.entries(ps)) datei(w, `/sys/module/${m}/parameters/${k}`, v + '\n', k === 'power_save' || k === 'intervall' ? 0o644 : 0o444);
}
interface ModKfg { alias: Record<string, string>; optionen: Record<string, string[]>; schwarz: Set<string>; install: Record<string, string>; zeilen: string[] }
function modKonfig(w: Welt): ModKfg {
  const r: ModKfg = { alias: {}, optionen: {}, schwarz: new Set(), install: {}, zeilen: [] };
  const dateien = Object.keys(w.fs).filter((p) => /^\/(etc|run|lib|usr\/lib)\/modprobe\.d\/[^/]+\.conf$/.test(p)).sort((a, b) => a.split('/').pop()!.localeCompare(b.split('/').pop()!));
  for (const p of dateien) for (const roh of (w.fs[p] ?? '').split('\n')) {
    const z = roh.trim(); if (!z || z.startsWith('#')) continue;
    const [b, n, ...rest] = z.split(/\s+/); if (!n) continue;
    r.zeilen.push(z);
    const nn = n.replace(/-/g, '_');
    if (b === 'alias' && rest[0]) r.alias[nn] = rest[0].replace(/-/g, '_');
    else if (b === 'options') r.optionen[nn] = [...(r.optionen[nn] ?? []), ...rest];
    else if (b === 'blacklist') r.schwarz.add(nn);
    else if (b === 'install') r.install[nn] = rest.join(' ');
  }
  return r;
}
function zeit(st: KStand) { st.sek += 3 + Math.floor(Math.random() * 40) / 10; return `[${st.sek.toFixed(6).padStart(12)}]`; }
function meld(w: Welt, ...t: string[]) { const st = ks(w); t.forEach((x, i) => { if (i) st.sek += 0.0004 + Math.floor(Math.random() * 900) / 100000; else zeit(st); st.dmesg.push(`[${st.sek.toFixed(6).padStart(12)}] ${x}`); }); }

/** Nach dem Laden eines Moduls: Parameter, Kernelmeldungen, Gerätedateien. */
function nachLaden(w: Welt, n: string, args: string[]) {
  const st = ks(w);
  const kfg = modKonfig(w);
  const werte: Record<string, string> = { ...(PARAM_STD[n] ?? {}) };
  for (const a of [...(kfg.optionen[n] ?? []), ...args]) {
    const [k, ...v] = a.split('='); if (!k) continue;
    const bekannt = Object.keys(w.verfuegbar[n]?.parameter ?? {});
    if (!bekannt.includes(k)) { meld(w, `${n}: unknown parameter '${k}' ignored`); continue; }
    const wert = v.join('=');
    werte[k] = /^(1|y|Y|true|on)$/.test(wert) && ['power_save'].includes(k) && n === 'iwlwifi' ? 'Y' : /^(0|n|N|false|off)$/.test(wert) && n === 'iwlwifi' && k === 'power_save' ? 'N' : wert;
  }
  if (Object.keys(werte).length) paramSetzen(w, n, werte);
  if (n === 'e1000e' && /^\d+$/.test(werte.InterruptThrottleRate ?? '')) meld(w, `e1000e 0000:00:1f.6: Interrupt Throttling Rate (ints/sec) set to ${werte.InterruptThrottleRate}`);
  if (n === LAB) {
    const modsig = w.fs[`/boot/config-${w.kernel}`]?.includes('CONFIG_MODULE_SIG=y') ?? true;
    const z: string[] = [];
    if (!(st.taint & 4096)) z.push(`${LAB}: loading out-of-tree module taints kernel.`);
    if (modsig && !(st.taint & 8192)) z.push(`${LAB}: module verification failed: signature and/or required key missing - tainting kernel`);
    st.taint |= 4096 | (modsig ? 8192 : 0);
    datei(w, sysPfad('kernel.tainted'), st.taint + '\n', 0o444);
    if (st.sensor) z.push(`${LAB} 1-6:1.0: Messbox LS-2 erkannt, Seriennummer LS2-26-0042, 4 Kanäle`);
    meld(w, ...z, 'usbcore: registered new interface driver labsensor');
  }
  geraetPruefen(w, 'add');
}
function nachEntladen(w: Welt, n: string) { loeschen(w, `/sys/module/${n}`); if (n === LAB) { meld(w, 'usbcore: deregistering interface driver labsensor'); geraetPruefen(w, 'remove'); } }

// ---------- udev ----------

interface Geraet { devpath: string; kernel: string; subsystem: string; driver: string; attr: Record<string, string> }
const USB_PFAD = '/devices/pci0000:00/0000:00:14.0/usb1';
function kette(): Geraet[] {
  return [
    { devpath: `${USB_PFAD}/1-6/1-6:1.0/labsensor/labsensor0`, kernel: 'labsensor0', subsystem: 'labsensor', driver: '', attr: { dev: '240:0', intervall: '1000', kanaele: '4', power_async: 'disabled' } },
    { devpath: `${USB_PFAD}/1-6/1-6:1.0`, kernel: '1-6:1.0', subsystem: 'usb', driver: 'labsensor', attr: { bInterfaceClass: 'ff', bInterfaceNumber: '00', bInterfaceProtocol: '00', bInterfaceSubClass: '00', bNumEndpoints: '02', modalias: 'usb:v1209p0001d0100dc00dsc00dp00icFFisc00ip00in00' } },
    { devpath: `${USB_PFAD}/1-6`, kernel: '1-6', subsystem: 'usb', driver: 'usb', attr: { bcdDevice: '0100', bDeviceClass: '00', busnum: '1', devnum: '6', idProduct: '0001', idVendor: '1209', manufacturer: 'Labor Mess GmbH', maxchild: '0', product: 'Messbox LS-2', serial: 'LS2-26-0042', speed: '12' } },
    { devpath: USB_PFAD, kernel: 'usb1', subsystem: 'usb', driver: 'usb', attr: { idProduct: '0002', idVendor: '1d6b', manufacturer: `Linux ${'6.1.0-27-amd64'} xhci-hcd`, product: 'xHCI Host Controller', serial: '0000:00:14.0' } },
    { devpath: '/devices/pci0000:00/0000:00:14.0', kernel: '0000:00:14.0', subsystem: 'pci', driver: 'xhci_hcd', attr: { class: '0x0c0330', device: '0xa36d', vendor: '0x8086' } },
    { devpath: '/devices/pci0000:00', kernel: 'pci0000:00', subsystem: '', driver: '', attr: {} },
  ];
}
function glob(muster: string, wert: string) {
  return muster.split('|').some((m) => new RegExp('^' + m.replace(/[.+^${}()\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$').test(wert));
}
interface UdevErgebnis { owner: string; group: string; mode: number; links: string[]; run: string[]; log: string[]; fehler: string[] }
const NUR_ABFRAGE = new Set(['ACTION', 'DEVPATH', 'KERNEL', 'KERNELS', 'SUBSYSTEM', 'SUBSYSTEMS', 'DRIVER', 'DRIVERS', 'ATTRS', 'TAGS', 'TEST', 'PROGRAM', 'RESULT']);
const NUR_SETZEN = new Set(['OWNER', 'GROUP', 'MODE', 'RUN', 'LABEL', 'GOTO', 'OPTIONS', 'IMPORT', 'SECLABEL']);
const BEIDES = new Set(['NAME', 'SYMLINK', 'ENV', 'TAG', 'ATTR', 'SYSCTL', 'CONST']);
function regelDateien(w: Welt): string[] {
  const n: Record<string, string> = {};
  for (const d of ['/lib/udev/rules.d', '/run/udev/rules.d', '/etc/udev/rules.d']) for (const p of Object.keys(w.fs)) if (p.startsWith(d + '/') && !p.slice(d.length + 1).includes('/') && p.endsWith('.rules') && typeof w.fs[p] === 'string') n[p.split('/').pop()!] = p;
  return Object.keys(n).sort().map((k) => n[k]);
}
function udevAuswerten(w: Welt, aktion: string): UdevErgebnis {
  const r: UdevErgebnis = { owner: 'root', group: 'root', mode: 0o600, links: [], run: [], log: [], fehler: [] };
  const k = kette(); const dev = k[0];
  const gruppen = (w.fs['/etc/group'] ?? '').split('\n').map((z) => z.split(':')[0]);
  for (const p of regelDateien(w)) {
    const zeilen = (w.fs[p] ?? '').replace(/\\\n/g, ' ').split('\n');
    let springe: string | null = null;
    zeilen.forEach((roh, i) => {
      const z = roh.trim(); const ort = `${p}:${i + 1}`;
      if (!z || z.startsWith('#')) return;
      const teile: { key: string; arg: string; op: string; wert: string }[] = [];
      let rest = z; let kaputt = false;
      while (rest.length) {
        const m = rest.match(/^\s*([A-Z_]+)(?:\{([^}]*)\})?\s*(==|!=|\+=|-=|:=|=)\s*"([^"]*)"\s*(,|$)/);
        if (!m) { kaputt = true; break; }
        teile.push({ key: m[1], arg: m[2] ?? '', op: m[3], wert: m[4] }); rest = rest.slice(m[0].length);
      }
      if (kaputt) { r.fehler.push(`${ort} Invalid key/value pair, ignoring.`); return; }
      for (const t of teile) {
        const abfrage = t.op === '==' || t.op === '!=';
        if (!NUR_ABFRAGE.has(t.key) && !NUR_SETZEN.has(t.key) && !BEIDES.has(t.key)) { r.fehler.push(`${ort} Invalid key '${t.key}'.`); kaputt = true; }
        else if ((abfrage && NUR_SETZEN.has(t.key) && t.key !== 'LABEL') || (!abfrage && NUR_ABFRAGE.has(t.key))) { r.fehler.push(`${ort} Invalid operator for ${t.key}.`); kaputt = true; }
      }
      if (kaputt) return;
      if (springe) { const l = teile.find((t) => t.key === 'LABEL'); if (l && l.wert === springe) springe = null; return; }
      // Abfragen am Gerät selbst
      const env: Record<string, string> = { DEVTYPE: '', SUBSYSTEM: dev.subsystem, ACTION: aktion, MODALIAS: '' };
      const passt = (t: typeof teile[number], g: Geraet): boolean | null => {
        const ist = t.key === 'KERNEL' || t.key === 'KERNELS' ? g.kernel : t.key === 'SUBSYSTEM' || t.key === 'SUBSYSTEMS' ? g.subsystem : t.key === 'DRIVER' || t.key === 'DRIVERS' ? g.driver : t.key === 'ATTR' || t.key === 'ATTRS' ? g.attr[t.arg] : t.key === 'ACTION' ? aktion : t.key === 'DEVPATH' ? g.devpath : t.key === 'ENV' ? env[t.arg] ?? '' : null;
        if (ist === null) return null;
        const treffer = ist !== undefined && glob(t.wert, ist);
        return t.op === '==' ? treffer : !treffer;
      };
      const abfr = teile.filter((t) => t.op === '==' || t.op === '!=');
      const eigen = abfr.filter((t) => !['KERNELS', 'SUBSYSTEMS', 'DRIVERS', 'ATTRS'].includes(t.key));
      const eltern = abfr.filter((t) => ['KERNELS', 'SUBSYSTEMS', 'DRIVERS', 'ATTRS'].includes(t.key));
      if (!eigen.every((t) => passt(t, dev) !== false)) return;
      // Alle Eltern-Schlüssel müssen an ein und demselben Gerät der Kette passen
      if (eltern.length && !k.some((g) => eltern.every((t) => passt(t, g) === true))) return;
      for (const t of teile.filter((x) => !(x.op === '==' || x.op === '!='))) {
        if (t.key === 'GOTO') { springe = t.wert; continue; }
        if (t.key === 'OWNER') { r.owner = t.wert; r.log.push(`${dev.kernel}: ${ort} OWNER ${t.wert}`); }
        if (t.key === 'GROUP') { if (!gruppen.includes(t.wert)) { r.fehler.push(`${ort} Unknown group '${t.wert}', ignoring.`); continue; } r.group = t.wert; r.log.push(`${dev.kernel}: ${ort} GROUP ${t.wert}`); }
        if (t.key === 'MODE') { r.mode = parseInt(t.wert, 8); r.log.push(`${dev.kernel}: ${ort} MODE ${t.wert}`); }
        if (t.key === 'SYMLINK') { if (t.op === '=') r.links = []; for (const l of t.wert.split(/\s+/).filter(Boolean)) { r.links.push(l); r.log.push(`${dev.kernel}: ${ort} LINK '${l}'`); } }
        if (t.key === 'NAME') r.fehler.push(`${ort} NAME="${t.wert}" ignoriert: Umbenennen geht nur bei Netzwerkschnittstellen.`);
        if (t.key === 'RUN') { r.run.push(t.wert); r.log.push(`${dev.kernel}: ${ort} RUN '${t.wert}'`); }
      }
    });
  }
  return r;
}
const sensorDa = (w: Welt) => ks(w).sensor && !!w.geladen[LAB];
/** Legt /dev/labsensor0 an oder entfernt es und wendet dabei die udev-Regeln an. */
function geraetPruefen(w: Welt, aktion: string): UdevErgebnis | null {
  const st = ks(w);
  for (const l of st.links) delete w.fs['/dev/' + l];
  st.links = [];
  if (!sensorDa(w)) { delete w.fs['/dev/labsensor0']; loeschen(w, '/sys/class/labsensor'); return null; }
  ordnerAnlegen(w, '/sys/class/labsensor/labsensor0');
  datei(w, '/sys/class/labsensor/labsensor0/dev', '240:0\n', 0o444);
  datei(w, '/sys/class/labsensor/labsensor0/intervall', (w.fs['/sys/module/labsensor/parameters/intervall'] ?? '1000\n'), 0o644);
  const r = udevAuswerten(w, aktion);
  w.fs['/dev/labsensor0'] = ''; const m = meta(w, '/dev/labsensor0'); m.owner = r.owner; m.group = r.group; m.mode = r.mode; m.mtime = w.uhr;
  for (const l of r.links) { datei(w, '/dev/' + l, '-> ' + '../'.repeat(l.split('/').length - 1) + 'labsensor0', 0o777); st.links.push(l); }
  return r;
}

// ---------- initramfs und Start ----------

const INITRD_MODULE = ['nvme', 'nvme_core', 'ahci', 'libahci', 'scsi_mod', 'usb_storage', 'uas', 'xhci_pci', 'xhci_hcd', 'usbcore', 'usb_common', 'vfat', 'fat'];
function initrdInhalt(w: Welt, v: string, alles = false): string {
  const basisE = ['.', 'bin', 'conf', 'conf/initramfs.conf', 'etc', 'etc/modprobe.d', 'init', 'scripts', 'scripts/local', 'usr', 'usr/bin', 'usr/bin/busybox', 'usr/bin/kmod', 'usr/lib', `usr/lib/modules/${v}`];
  const mods = INITRD_MODULE.filter((n) => alles || Object.keys(w.fs).some((p) => p.startsWith(`/lib/modules/${v}/`) && modName(p) === n && /\.ko/.test(p)));
  const e = [...basisE, ...mods.map((n) => `usr/lib/modules/${v}/${K.modulPfad(n)}`), ...(mods.length ? [`usr/lib/modules/${v}/modules.dep`] : [])];
  return CPIO + JSON.stringify(e.map((p) => ({ p, c: p.endsWith('/') || !p.includes('.') && !p.includes('busybox') && !p.includes('init') && !p.includes('kmod') ? null : '' })));
}
function initrdModule(w: Welt, v: string): string[] | null {
  const c = w.fs[`/boot/initrd.img-${v}`] ?? w.fs[`/boot/initramfs-${v}.img`];
  if (c === undefined || c === null) return null;
  if (c === '' || !c.startsWith(CPIO)) return INITRD_MODULE;
  try { return (JSON.parse(c.slice(CPIO.length)) as { p: string }[]).filter((e) => /\.ko/.test(e.p)).map((e) => modName(e.p)); } catch { return INITRD_MODULE; }
}
function initramfsErzeugen(w: Welt, v: string): string {
  const z: string[] = [`update-initramfs: Generating /boot/initrd.img-${v}`];
  if (!(`/lib/modules/${v}` in w.fs)) z.push(`W: missing /lib/modules/${v}`, 'W: Ensure all necessary drivers are built into the linux image!', `depmod: ERROR: could not open directory /lib/modules/${v}: No such file or directory`, 'depmod: FATAL: could not search modules: No such file or directory');
  datei(w, `/boot/initrd.img-${v}`, initrdInhalt(w, v));
  return z.join('\n');
}
function versionVergleich(a: string, b: string) {
  const x = a.split(/[.-]/); const y = b.split(/[.-]/);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const p = x[i] ?? ''; const q = y[i] ?? ''; const np = Number(p), nq = Number(q); if (!isNaN(np) && !isNaN(nq) && p !== '' && q !== '') { if (np !== nq) return np - nq; } else if (p !== q) return p < q ? -1 : 1; }
  return 0;
}
export function kernelImBoot(w: Welt): string[] {
  return Object.keys(w.fs).filter((p) => /^\/boot\/vmlinuz-/.test(p)).map((p) => p.slice('/boot/vmlinuz-'.length)).sort((a, b) => versionVergleich(b, a));
}
function grubStartKernel(w: Welt): string {
  const cfg = w.fs['/boot/grub/grub.cfg'] ?? '';
  const eintraege = [...cfg.matchAll(/menuentry '([^']*)'[^{]*\{\s*\n\s*linux\s+(?:\/boot)?\/vmlinuz-(\S+)/g)].map((m) => ({ titel: m[1], v: m[2] }));
  if (!eintraege.length) return w.kernel;
  const def = (cfg.match(/set default="([^"]*)"/)?.[1] ?? '0');
  if (/^\d+$/.test(def)) return eintraege[0].v;
  const t = def.split('>').pop()!;
  return eintraege.find((e) => e.titel === t)?.v ?? eintraege[0].v;
}

/** Nach dem Neustart: Kernel wählen, Module, sysctl und Geräte neu aufsetzen. */
export function kernNeustart(w: Welt, startGeladen: string[]): string | undefined {
  if (!kernAktiv(w)) return;
  const st = ks(w);
  let v = st.fallback ?? (w as Welt & { startKernel?: string }).startKernel ?? grubStartKernel(w);
  const hinweis = st.fallback ? `Im GRUB-Menü hast du unter „Advanced options for Debian GNU/Linux“ den Kernel ${st.fallback} gewählt.` : '';
  st.fallback = null; st.fehlstart = null;
  if (!(`/boot/vmlinuz-${v}` in w.fs)) v = w.kernel;
  // Findet der Kernel seine Wurzel? Der NVMe-Treiber muss eingebaut oder im initramfs sein.
  const nvmeFest = eingebaut(w, v).has('nvme');
  const im = initrdModule(w, v);
  if (!nvmeFest && (im === null || !im.includes('nvme'))) {
    st.fallback = st.gut; st.fehlstart = v;
    w.aus = 'kernelfehler';
    const text = im === null
      ? `[    1.912345] VFS: Cannot open root device "UUID=${ROOT_UUID}" or unknown-block(0,0): error -6\n[    1.912401] Please append a correct "root=" boot option; here are the available partitions:\n[    1.912455] Kernel panic - not syncing: VFS: Unable to mount root fs on unknown-block(0,0)`
      : `Gave up waiting for root file system device.  Common problems:\n - Boot args (cat /proc/cmdline)\n   - Check rootdelay= (did the system wait long enough?)\n - Missing modules (cat /proc/modules; ls /dev)\nALERT!  UUID=${ROOT_UUID} does not exist.  Dropping to a shell!\n\n\nBusyBox v1.35.0 (Debian 1:1.35.0-4+b3) built-in shell (ash)\nEnter 'help' for a list of built-in commands.\n\n(initramfs)`;
    (w as Welt & { kernelMeldung?: string }).kernelMeldung = text;
    return `Start mit Linux ${v} …\n${text}\n\n(Der Start ist gescheitert. Mit „Neu starten“ wählst du im GRUB-Menü den alten Kernel ${st.gut}.)`;
  }
  w.kernel = v; st.gut = v;
  w.cmdline = `BOOT_IMAGE=/boot/vmlinuz-${v} root=UUID=${ROOT_UUID} ro quiet`;
  w.fs['/proc/cmdline'] = w.cmdline + '\n';
  w.fs['/proc/version'] = `Linux version ${v} (${st.infos[v] && !BAU_INFO[v] ? 'lena@' + w.host : 'debian-kernel@lists.debian.org'}) (gcc (Debian 12.2.0-14+deb12u1) 12.2.0, GNU ld (GNU Binutils for Debian) 2.40) ${st.infos[v] ?? '#1 SMP'}\n`;
  // Module: nur was es für diesen Kernel gibt
  const fest = eingebaut(w, v);
  for (const n of Object.keys(w.geladen)) delete w.geladen[n];
  for (const n of startGeladen) if (imDep(w, n, v) && !fest.has(n) && !modKonfig(w).schwarz.has(n) && !w.geladen[n]) w.geladen[n] = [];
  loeschen(w, '/sys/module');
  st.taint = 0; st.dmesg = []; st.sek = 18; st.param = {};
  sysctlStandard(w);
  K.benutzer(w);
  for (const m of Object.keys(w.geladen)) nachLaden(w, m, []);
  const laden = (n: string) => { const e = n.replace(/-/g, '_'); const echt = modKonfig(w).alias[e] ?? e; if (imDep(w, echt, v) && !w.geladen[echt]) { for (const d of [...(w.verfuegbar[echt]?.abh ?? []), echt]) if (!w.geladen[d]) w.geladen[d] = []; nachLaden(w, echt, []); } };
  for (const p of Object.keys(w.fs).filter((x) => /^\/(etc|run|usr\/lib)\/modules-load\.d\/[^/]+\.conf$/.test(x)).sort()) {
    let c = w.fs[p] ?? ''; if (c.startsWith('-> ')) c = w.fs[K.pfad(w, p.replace(/[^/]+$/, '') + c.slice(3))] ?? '';
    for (const z of c.split('\n')) { const n = z.trim(); if (n && !n.startsWith('#') && !n.startsWith(';')) laden(n); }
  }
  if (st.sensor) {
    meld(w, 'usb 1-6: new full-speed USB device number 6 using xhci_hcd', 'usb 1-6: New USB device found, idVendor=1209, idProduct=0001, bcdDevice= 1.00', 'usb 1-6: Product: Messbox LS-2', 'usb 1-6: Manufacturer: Labor Mess GmbH', 'usb 1-6: SerialNumber: LS2-26-0042');
    if (!modKonfig(w).schwarz.has(LAB)) laden(LAB);
  }
  K.benutzer(w);
  sysctlSystem(w, false);
  geraetPruefen(w, 'add');
  return `${hinweis ? hinweis + ' ' : ''}Linux ${v} gestartet.`;
}

// ---------- sysctl ----------

function sysctlDateien(w: Welt): string[] {
  const n: Record<string, string> = {};
  for (const d of ['/etc/sysctl.d', '/run/sysctl.d', '/usr/local/lib/sysctl.d', '/usr/lib/sysctl.d', '/lib/sysctl.d']) for (const p of Object.keys(w.fs).sort()) if (p.startsWith(d + '/') && p.endsWith('.conf') && !p.slice(d.length + 1).includes('/')) { const b = p.split('/').pop()!; if (!n[b]) n[b] = p; }
  const r = Object.keys(n).sort().map((b) => n[b]);
  if ('/etc/sysctl.conf' in w.fs) r.push('/etc/sysctl.conf');
  return r;
}
function lies(w: Welt, p: string): string | null {
  let c = w.fs[p]; if (c === undefined || c === null) return null;
  if (c.startsWith('-> ')) { const z = c.slice(3); c = w.fs[z.startsWith('/') ? z : K.pfad(w, p.replace(/[^/]+$/, '') + z)] ?? null; }
  return c;
}
function sysctlZeilen(t: string): [string, string, boolean][] {
  const r: [string, string, boolean][] = [];
  for (const roh of t.split('\n')) {
    const z = roh.trim(); if (!z || z.startsWith('#') || z.startsWith(';')) continue;
    const i = z.indexOf('='); if (i < 0) continue;
    let k = z.slice(0, i).trim(); const ignorieren = k.startsWith('-'); if (ignorieren) k = k.slice(1);
    r.push([k.replace(/\//g, '.'), z.slice(i + 1).trim().replace(/\s+/g, '\t'), ignorieren]);
  }
  return r;
}
function sysctlSchreiben(w: Welt, k: string, v0: string, root: boolean): string | null {
  let v = v0;
  const p = sysPfad(k);
  if (!(p in w.fs) || w.fs[p] === null) return `sysctl: der Aufruf von stat für ${p} ist nicht möglich: Datei oder Verzeichnis nicht gefunden`;
  if (!root || SYSCTL_NUR_LESEN.has(k)) return `sysctl: Zugriff verweigert auf Schlüssel »${k}«`;
  if (/^0x[0-9a-f]+$/i.test(v)) v = String(parseInt(v, 16));
  if ((/^(net|vm|dev)\./.test(k) || /^kernel\.(pid_max|panic|panic_on_oops|sysrq|dmesg_restrict|randomize_va_space|core_uses_pid|threads-max)$/.test(k)) && !/^-?\d+(\t-?\d+)*$/.test(v) && k !== 'net.core.default_qdisc') return `sysctl: Schlüssel »${k}« kann nicht gesetzt werden: Das Argument ist ungültig`;
  w.fs[p] = (k === 'vm.drop_caches' ? '0' : v) + '\n';
  if (k === 'kernel.hostname') w.host = v;
  return null;
}
function sysctlSystem(w: Welt, ausgabe: boolean): string {
  const z: string[] = [];
  for (const d of sysctlDateien(w)) {
    const t = lies(w, d); if (t === null) continue;
    if (ausgabe) z.push(`* ${d} wird angewendet …`);
    for (const [k, v, ign] of sysctlZeilen(t)) {
      if (k.includes('*')) { const re = new RegExp('^' + k.replace(/\./g, '\\.').replace(/\*/g, '[^.]+') + '$'); for (const [kk] of SYSCTL_STD) if (re.test(kk)) { sysctlSchreiben(w, kk, v, true); if (ausgabe) z.push(`${kk} = ${v}`); } continue; }
      const e = sysctlSchreiben(w, k, v, true);
      if (e) { if (ausgabe && !ign) z.push(e); } else if (ausgabe) z.push(`${k} = ${v.replace(/\t/g, '\t')}`);
    }
  }
  return z.join('\n');
}
/** Was nach einem Neustart für einen Schlüssel gelten würde. */
function sysctlBeimStart(w: Welt, k: string): string | undefined {
  let v: string | undefined = SYSCTL_STD.find((x) => x[0] === k)?.[1];
  for (const d of sysctlDateien(w)) { const t = lies(w, d); if (t) for (const [kk, vv] of sysctlZeilen(t)) if (kk === k) v = vv; }
  return v;
}

// ---------- Hilfen ----------

const hat = (w: Welt, p: string) => typeof w.fs[p] === 'string';
const paketDa = (w: Welt, n: string) => w.pakete?.installiert[n] === 'ii';
const nichtDa = (n: string, paket: string) => fehler(`bash: ${n}: Befehl nicht gefunden${paket ? `\n(${n} gehört zum Paket ${paket}: sudo apt install ${paket})` : ''}`, 127);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TAG = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function englischesDatum(ms: number) { const d = new Date(ms + 3600000); const p = (n: number) => String(n).padStart(2, '0'); return `${TAG[d.getUTCDay()]} ${MON[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} CET ${d.getUTCFullYear()}`; }
function makeZeile(n: number, ort: string, ziel: string, code: number) { return `make[${n}]: *** [${ort}: ${ziel}] Fehler ${code}`; }

// ---------- make im Kernelbaum ----------

interface MakeAuftrag { dir: string; ziele: string[]; vars: Record<string, string>; jobs: number; leise: boolean; root: boolean }
function werkzeugFehlt(w: Welt, stufe: 'konfig' | 'menu' | 'bau'): string | null {
  if (!hat(w, '/usr/bin/gcc')) return `/bin/sh: 1: gcc: not found\n${makeZeile(2, 'scripts/Makefile.host:114', 'scripts/basic/fixdep', 127)}\n${makeZeile(1, `${BAUM}/Makefile:648`, 'scripts_basic', 2)}\nmake: *** [Makefile:248: __sub-make] Fehler 2`;
  if (!hat(w, '/usr/bin/flex')) return `  HOSTCC  scripts/basic/fixdep\n  LEX     scripts/kconfig/lexer.lex.c\n/bin/sh: 1: flex: not found\n${makeZeile(2, 'scripts/Makefile.host:9', 'scripts/kconfig/lexer.lex.c', 127)}\nmake: *** [Makefile:248: __sub-make] Fehler 2`;
  if (!hat(w, '/usr/bin/bison')) return `  HOSTCC  scripts/basic/fixdep\n  YACC    scripts/kconfig/parser.tab.[ch]\n/bin/sh: 1: bison: not found\n${makeZeile(2, 'scripts/Makefile.host:17', 'scripts/kconfig/parser.tab.h', 127)}\nmake: *** [Makefile:248: __sub-make] Fehler 2`;
  if (stufe === 'menu' && !hat(w, '/usr/include/ncurses.h')) return ` *\n * Unable to find the ncurses package.\n * Install ncurses (ncurses-devel or libncurses-dev\n * depending on your distribution).\n *\n * You may also need to install pkg-config to find the\n * ncurses installed in a non-default location.\n *\n${makeZeile(2, 'scripts/kconfig/Makefile:232', 'scripts/kconfig/mconf-cfg', 1)}\n${makeZeile(1, `${BAUM}/Makefile:693`, 'menuconfig', 2)}\nmake: *** [Makefile:248: __sub-make] Fehler 2`;
  if (stufe !== 'bau') return null;
  if (!hat(w, '/usr/bin/bc')) return `  SYNC    include/config/auto.conf\n  HOSTCC  scripts/kallsyms\n  BC      include/generated/timeconst.h\n/bin/sh: 1: bc: not found\n${makeZeile(2, 'Kbuild:24', 'include/generated/timeconst.h', 127)}\n${makeZeile(1, `${BAUM}/Makefile:1281`, 'prepare0', 2)}\nmake: *** [Makefile:248: __sub-make] Fehler 2`;
  if (!hat(w, '/usr/include/gelf.h')) return `  SYNC    include/config/auto.conf\nerror: Cannot generate ORC metadata for CONFIG_UNWINDER_ORC=y, please install libelf-dev, libelf-devel or elfutils-libelf-devel\n${makeZeile(1, `${BAUM}/Makefile:1361`, 'prepare-objtool', 1)}\nmake: *** [Makefile:248: __sub-make] Fehler 2`;
  if (!hat(w, '/usr/include/openssl/opensslv.h')) return `  HOSTCC  scripts/sign-file\nscripts/sign-file.c:25:10: fatal error: openssl/opensslv.h: No such file or directory\n   25 | #include <openssl/opensslv.h>\n      |          ^~~~~~~~~~~~~~~~~~~~\ncompilation terminated.\n${makeZeile(2, 'scripts/Makefile.host:116', 'scripts/sign-file', 1)}\n${makeZeile(1, `${BAUM}/Makefile:1210`, 'scripts', 2)}\nmake: *** [Makefile:248: __sub-make] Fehler 2`;
  return null;
}
function hilfeText() {
  return `Cleaning targets:
  clean           - Erzeugtes löschen, .config bleibt
  mrproper        - Alles Erzeugte löschen, auch .config
  distclean       - mrproper und zusätzlich Sicherungs- und Patch-Reste

Configuration targets:
  config          - Jede Option einzeln abfragen (zeilenweise)
  menuconfig      - Menü im Terminal (braucht ncurses)
  nconfig         - Menü im Terminal, neuere Fassung
  xconfig         - Grafisch mit Qt
  gconfig         - Grafisch mit GTK
  oldconfig       - Vorhandene .config übernehmen, nur nach neuen Optionen fragen
  olddefconfig    - Wie oldconfig, neue Optionen still auf ihre Vorgabe
  localmodconfig  - Module abschalten, die gerade nicht geladen sind
  defconfig       - Neue .config aus den Vorgaben der Architektur
  allnoconfig, allyesconfig, allmodconfig

Other generic targets:
  all             - Alles mit [*] bauen
* vmlinux         - Den nackten Kernel bauen
* modules         - Alle Module bauen
  modules_install - Module nach /lib/modules/VERSION installieren
  kernelversion   - Version aus dem Makefile ausgeben
  kernelrelease   - Vollständige Release-Bezeichnung ausgeben

Kernel packaging:
  rpm-pkg         - Quell- und Binärpakete im RPM-Format
  binrpm-pkg      - Nur das RPM-Binärpaket
  deb-pkg         - Quell- und Binärpakete im Debian-Format
  bindeb-pkg      - Nur die Debian-Binärpakete

Architecture-specific targets (x86):
* bzImage         - Gepackter Kernel (arch/x86/boot/bzImage)
  install         - Kernel mit installkernel nach /boot installieren

  make -jN        - N Aufgaben gleichzeitig, meist N = $(nproc)
  make V=1        - Jeden Befehl vollständig zeigen
(Im Simulator gekürzt und übersetzt.)`;
}
function release(w: Welt, d: string, vars: Record<string, string>): string {
  const { ver, extra } = version(w, d);
  const k = konfigLesen(w.fs[`${d}/.config`] ?? '');
  return `${ver}${extra}${k.LOCALVERSION ?? ''}${vars.LOCALVERSION ?? ''}`;
}
function konfigSpeichern(w: Welt, d: string, k: Konfig) {
  const p = `${d}/.config`;
  if (hat(w, p)) datei(w, `${d}/.config.old`, w.fs[p]!, 0o664, meta(w, p).owner);
  datei(w, p, konfigText(k, version(w, d).ver), 0o664, meta(w, d).owner);
}
const GESCHRIEBEN = '#\n# configuration written to .config\n#';
function frageText(s: Sym, wert: string) {
  if (s.t === 'string') return `${s.p} (${s.n}) [${wert}] ${s.neu ? '(NEW) ' : ''}`;
  const opts = s.t === 'tristate' ? ['n', 'm', 'y'] : ['n', 'y'];
  return `${s.p} (${s.n}) [${opts.map((o) => (o === wert ? o.toUpperCase() : o)).join('/')}/?] ${s.neu ? '(NEW) ' : ''}`;
}
/** Fragt Symbole nacheinander ab (config, oldconfig, syncconfig). */
function abfragen(w: Welt, d: string, k: Konfig, liste: Sym[], kopf: string, danach: () => string): string {
  const reihe = [...liste];
  const naechste = (vorher: string): string => {
    const s = reihe[0];
    if (!s) { konfigSpeichern(w, d, k); return [vorher, GESCHRIEBEN, danach()].filter(Boolean).join('\n'); }
    const std = k[s.n] ?? s.std;
    K.dialog(w, frageText(s, std), (z) => {
      const e = z.trim();
      if (e === '?') return naechste(`\nCONFIG_${s.n}:\n\n${s.hilfe}\n\nSymbol: ${s.n} [=${std}]\nType  : ${s.t}\nPrompt: ${s.p}\n  Location:\n    -> ${s.ort.split(' -> ').join('\n      -> ')}\n`);
      if (s.t === 'string') { setzen(k, s.n, e === '' ? std : e.replace(/^"|"$/g, '')); reihe.shift(); return naechste(''); }
      const v = e === '' ? std : e.toLowerCase();
      if (!['y', 'n', 'm'].includes(v) || (v === 'm' && s.t !== 'tristate')) return naechste('');
      setzen(k, s.n, v); reihe.shift(); return naechste('');
    });
    return vorher;
  };
  return naechste(kopf);
}
/** menuconfig als Zeilenmenü */
function menuconfig(w: Welt, d: string, k: Konfig, danach: () => string): string {
  let geaendert = false;
  const kopf = ` .config - Linux/x86 ${version(w, d).ver} Kernel Configuration\n ${'─'.repeat(58)}\n  (Der Simulator zeigt menuconfig als Zeilenmenü. Im echten menuconfig\n   bewegst du dich mit den Pfeiltasten, / sucht, y, m, n setzen, ? hilft.)\n\n  Eingaben:  /TEXT suchen  ·  SYMBOL=y, SYMBOL=m oder SYMBOL=n  ·  SYMBOL="text"\n             ? SYMBOL Hilfe  ·  s speichern  ·  q beenden`;
  const runde = (vorher: string): string => {
    K.dialog(w, 'menuconfig> ', (z) => {
      const e = z.trim(); let m;
      if (e === 'q' || e === 'Q') {
        if (!geaendert) return `\n\n*** End of the configuration.\n*** Execute 'make' to start the build or try 'make help'.\n${danach()}`;
        K.dialog(w, 'Do you wish to save your new configuration? (y/n) ', (a) => {
          if (/^[yYjJ]/.test(a.trim())) { konfigSpeichern(w, d, k); return `\n\n*** End of the configuration.\n*** Execute 'make' to start the build or try 'make help'.\n${danach()}`; }
          return `\n\nYour configuration changes were NOT saved.\n${danach()}`;
        });
        return '';
      }
      if (e === 's' || e === 'S') { konfigSpeichern(w, d, k); geaendert = false; return runde('Konfiguration in .config gespeichert.'); }
      if ((m = e.match(/^\/(.+)$/))) {
        const q = m[1].toUpperCase().replace(/^CONFIG_/, '');
        const t = SYMBOLE.filter((s) => s.n.includes(q) || s.p.toUpperCase().includes(q) || s.ort.toUpperCase().includes(q));
        return runde(t.length ? t.map((s) => `Symbol: ${s.n} [=${k[s.n] ?? s.std}]\nType  : ${s.t}\nPrompt: ${s.p}\n  Location:\n    -> ${s.ort.split(' -> ').join('\n      -> ')}`).join('\n\n') : 'No matches found.');
      }
      if ((m = e.match(/^\?\s*(?:CONFIG_)?(\w+)$/))) { const s = SYM[m[1].toUpperCase()]; return runde(s ? `CONFIG_${s.n}:\n\n${s.hilfe}` : 'Unbekanntes Symbol.'); }
      if ((m = e.match(/^(?:CONFIG_)?(\w+)\s*=\s*(.+)$/))) {
        const s = SYM[m[1].toUpperCase()]; if (!s) return runde(`Unbekanntes Symbol ${m[1]}. Suche mit /TEXT.`);
        const v = m[2].trim();
        if (s.t === 'string') setzen(k, s.n, v.replace(/^"|"$/g, ''));
        else { const x = v.toLowerCase(); if (!['y', 'm', 'n'].includes(x) || (x === 'm' && s.t !== 'tristate')) return runde(`${s.n} ist ${s.t}: erlaubt ${s.t === 'tristate' ? 'y, m, n' : 'y, n'}.`); setzen(k, s.n, x); }
        geaendert = true;
        return runde(`${s.n} = ${s.t === 'string' ? `"${k[s.n]}"` : k[s.n]}`);
      }
      return runde('Eingaben: /TEXT · SYMBOL=y|m|n · ? SYMBOL · s · q');
    });
    return vorher;
  };
  return runde(kopf);
}

function bauen(w: Welt, a: MakeAuftrag, was: 'alles' | 'kernel' | 'module'): Ergebnis {
  const st = ks(w); const d = a.dir;
  const k = konfigLesen(w.fs[`${d}/.config`] ?? '');
  const rel = release(w, d, a.vars);
  const keys = k.SYSTEM_TRUSTED_KEYS ?? '';
  if (keys && !hat(w, `${d}/${keys}`)) return fehler(`  SYNC    include/config/auto.conf\n  HOSTCC  scripts/basic/fixdep\n  CC      scripts/mod/empty.o\n  HOSTCC  scripts/kallsyms\n  CC      init/main.o\n  CC      certs/system_keyring.o\nmake[3]: *** Keine Regel vorhanden, um das Ziel „${keys}“, benötigt von „certs/x509_certificate_list“, zu erstellen.  Schluss.\n${makeZeile(2, 'scripts/Makefile.build:478', 'certs', 2)}\n${makeZeile(1, `${BAUM}/Makefile:1990`, '.', 2)}\nmake: *** [Makefile:248: __sub-make] Fehler 2`, 2);
  const mods = SYMBOLE.filter((s) => s.mod && k[s.n] === 'm').flatMap((s) => s.mod!.split(','));
  const fest = SYMBOLE.filter((s) => s.mod && k[s.n] === 'y').flatMap((s) => s.mod!.split(','));
  const kp = komp(k); const [tag, endung, mb] = KOMP_ART[kp];
  const alt = st.bau[d];
  const nr = (alt?.nr ?? 0) + (alt && alt.konfig === w.fs[`${d}/.config`] ? 0 : 1);
  const info = alt && alt.konfig === w.fs[`${d}/.config`] && alt.info ? alt.info : `#${nr} SMP PREEMPT_DYNAMIC ${englischesDatum(w.uhr)}`;
  const z: string[] = [];
  if (!a.leise) {
    z.push('  SYNC    include/config/auto.conf', '  HOSTCC  scripts/basic/fixdep', '  WRAP    arch/x86/include/generated/uapi/asm/bpf_perf_event.h', '  UPD     include/generated/uapi/linux/version.h', '  UPD     include/config/kernel.release', '  HOSTCC  scripts/kallsyms', '  CC      scripts/mod/empty.o', '  HOSTCC  scripts/sign-file');
    if (was !== 'module') z.push('  CC      init/main.o', '  CC      init/version.o', '  CC      kernel/fork.o', '  CC      kernel/sched/core.o', '  CC      mm/memory.o', '  CC      fs/open.o', '  CC      drivers/base/core.o', '  (… der Simulator zeigt nur einige von über 20 000 Zeilen …)', '  LD      vmlinux.o', '  LD      vmlinux', '  NM      System.map');
    if (was !== 'kernel') { for (const m of mods.slice(0, 4)) z.push(`  CC [M]  ${K.modulPfad(m).replace(/^kernel\//, '').replace(/\.ko$/, '.o')}`); z.push('  MODPOST Module.symvers'); for (const m of mods.slice(0, 4)) z.push(`  LD [M]  ${K.modulPfad(m).replace(/^kernel\//, '')}`); if (mods.length > 4) z.push(`  (… und ${mods.length - 4} weitere Module …)`); }
    if (was !== 'module') z.push(`  ${tag.padEnd(7)} arch/x86/boot/compressed/vmlinux.bin.${endung}`, '  LD      arch/x86/boot/compressed/vmlinux', '  OBJCOPY arch/x86/boot/vmlinux.bin', '  BUILD   arch/x86/boot/bzImage', `Kernel: arch/x86/boot/bzImage is ready  (#${nr})`);
  }
  const owner = meta(w, d).owner;
  const groesse = Math.round(mb * 1024 * 1024 * (0.96 + mods.length / 600));
  datei(w, `${d}/include/config/kernel.release`, rel + '\n', 0o664, owner);
  datei(w, `${d}/.version`, nr + '\n', 0o664, owner);
  if (was !== 'module') {
    datei(w, `${d}/vmlinux`, '\u0007BIN:' + groesse * 7, 0o775, owner);
    datei(w, `${d}/System.map`, 'ffffffff81000000 T _stext\n(… gekürzt …)\n', 0o664, owner);
    datei(w, `${d}/arch/x86/boot/bzImage`, kernelBild(groesse, `${rel} (${owner}@${w.host}) ${info}`), 0o664, owner);
  }
  if (was !== 'kernel') { datei(w, `${d}/modules.order`, mods.map((m) => K.modulPfad(m).replace(/^kernel\//, '')).join('\n') + '\n', 0o664, owner); datei(w, `${d}/Module.symvers`, '(Symboltabelle der Module)\n', 0o664, owner); }
  st.bau[d] = { release: rel, info, nr, kernel: (alt?.kernel && alt.konfig === w.fs[`${d}/.config`]) || was !== 'module', module: (alt?.module && alt.konfig === w.fs[`${d}/.config`]) || was !== 'kernel', konfig: w.fs[`${d}/.config`] ?? '', mods, builtin: fest, komp: kp };
  st.infos[rel] = info;
  // Dauer: grob nach Zahl der Module und Aufgaben
  const minuten = Math.round((was === 'kernel' ? 8 : 10 + mods.length * 2.2) * 6 / Math.max(1, Math.min(a.jobs, 12)));
  w.uhr += minuten * 60000;
  z.push(`(Im Simulator sofort fertig. Echt dauert das je nach Konfiguration und Rechner einige Minuten bis über eine Stunde.${a.jobs <= 1 ? ' Ohne -j baut make nur mit einer Aufgabe. Schneller: make -j$(nproc)' : ''})`);
  return ok(z.join('\n'));
}
function hookLauf(w: Welt, rel: string): string {
  const z: string[] = [];
  const hooks = Object.keys(w.fs).filter((p) => p.startsWith('/etc/kernel/postinst.d/') && typeof w.fs[p] === 'string').sort();
  for (const h of hooks) {
    z.push(`run-parts: executing ${h} ${rel} /boot/vmlinuz-${rel}`);
    const n = h.split('/').pop();
    if (n === 'initramfs-tools') z.push(initramfsErzeugen(w, rel));
    else if (n === 'dkms') z.push(dkmsAuto(w, rel, true));
    else if (n === 'zz-update-grub') z.push(grubNeu(w));
  }
  return z.filter(Boolean).join('\n');
}
let grubNeu: (w: Welt) => string = () => '';
export function kernGrub(f: (w: Welt) => string) { grubNeu = f; }

function modulesInstall(w: Welt, d: string, rel: string, mods: string[], fest: string[], quelle: string): string[] {
  const z: string[] = [];
  const ziel = `/lib/modules/${rel}`;
  ordnerAnlegen(w, ziel);
  for (const m of mods) { const p = `${ziel}/${K.modulPfad(m)}`; datei(w, p, `\u0007KO:${m}:${rel}:${(w.verfuegbar[m]?.groesse ?? 40000) * 3}`); if (z.length < 5) z.push(`  INSTALL ${p}`); }
  if (mods.length > 5) z.push(`  (… ${mods.length - 5} weitere …)`);
  datei(w, `${ziel}/modules.builtin`, fest.map((m) => K.modulPfad(m)).join('\n') + '\n');
  datei(w, `${ziel}/modules.order`, mods.map((m) => K.modulPfad(m)).join('\n') + '\n');
  datei(w, `${ziel}/build`, '-> ' + quelle, 0o777);
  z.push(`  DEPMOD  ${ziel}`);
  depmodSchreiben(w, rel);
  void d;
  return z;
}

function kernelMake(w: Welt, a: MakeAuftrag): Ergebnis {
  const d = a.dir; const st = ks(w);
  const out: string[] = [];
  const ziele = a.ziele.length ? a.ziele : ['all'];
  const schreibbar = darf(w, d, 'w', a.root);
  for (let i = 0; i < ziele.length; i++) {
    const z = ziele[i];
    const weiter = () => { if (i + 1 >= ziele.length) return ''; const r = kernelMake(w, { ...a, ziele: ziele.slice(i + 1) }); return [r.out, r.err].filter(Boolean).join('\n'); };
    if (z === 'help') { out.push(hilfeText()); continue; }
    if (z === 'kernelversion') { out.push(version(w, d).ver); continue; }
    if (z === 'kernelrelease') { out.push(release(w, d, a.vars)); continue; }
    if (!schreibbar) return fehler([...out, `  HOSTCC  scripts/basic/fixdep\n/usr/bin/ld: cannot open output file scripts/basic/fixdep: Keine Berechtigung\ncollect2: error: ld returned 1 exit status\n${makeZeile(2, 'scripts/Makefile.host:114', 'scripts/basic/fixdep', 1)}\n${makeZeile(1, `${d}/Makefile:648`, 'scripts_basic', 2)}\nmake: *** [Makefile:248: __sub-make] Fehler 2`].join('\n'), 2);
    if (['clean', 'mrproper', 'distclean'].includes(z)) {
      const weg = ['vmlinux', 'vmlinux.o', 'System.map', 'arch/x86/boot/bzImage', 'modules.order', 'Module.symvers', '.version', 'include/config', 'include/generated', 'debian'];
      if (z !== 'clean') weg.push('.config', '.config.old');
      const da = weg.filter((x) => `${d}/${x}` in w.fs);
      for (const x of weg) loeschen(w, `${d}/${x}`);
      if (st.bau[d]) { if (z === 'clean') st.bau[d] = { ...st.bau[d], kernel: false, module: false }; else delete st.bau[d]; }
      if (da.length) out.push(z === 'clean' ? '  CLEAN   arch/x86/boot\n  CLEAN   .\n  CLEAN   modules.builtin modules.order' : `  CLEAN   scripts/basic\n  CLEAN   scripts/kconfig\n  CLEAN   include/config include/generated arch/x86/include/generated\n  CLEAN   ${da.filter((x) => !x.includes('/')).join(' ')}`);
      continue;
    }
    const konfigZiele = ['config', 'oldconfig', 'olddefconfig', 'defconfig', 'localmodconfig', 'localyesconfig', 'allnoconfig', 'allyesconfig', 'allmodconfig', 'menuconfig', 'nconfig', 'xconfig', 'gconfig', 'syncconfig'];
    if (konfigZiele.includes(z)) {
      if (z === 'xconfig' || z === 'gconfig') return fehler([...out, `(${z} braucht eine grafische Sitzung und die Entwicklerpakete von ${z === 'xconfig' ? 'Qt' : 'GTK'}. Im Simulator: make menuconfig. Auf einem Rechner mit Desktop: sudo apt install ${z === 'xconfig' ? 'qt6-base-dev' : 'libgtk-3-dev libglib2.0-dev libglade2-dev'}, dann make ${z}.)`].join('\n'), 2);
      const wf = werkzeugFehlt(w, z === 'menuconfig' || z === 'nconfig' ? 'menu' : 'konfig'); if (wf) return fehler([...out, wf].join('\n'), 2);
      out.push('  HOSTCC  scripts/basic/fixdep', '  HOSTCC  scripts/kconfig/conf.o', '  LEX     scripts/kconfig/lexer.lex.c', '  YACC    scripts/kconfig/parser.tab.[ch]', `  HOSTLD  scripts/kconfig/${z === 'menuconfig' ? 'mconf' : z === 'nconfig' ? 'nconf' : 'conf'}`);
      const vorhanden = hat(w, `${d}/.config`);
      let k: Konfig = vorhanden ? konfigLesen(w.fs[`${d}/.config`]!) : stdKonfig();
      if (!vorhanden && !['defconfig', 'allnoconfig', 'allyesconfig', 'allmodconfig'].includes(z)) out.push('#\n# using defaults found in arch/x86/configs/x86_64_defconfig\n#');
      if (z === 'defconfig') { k = stdKonfig(); konfigSpeichern(w, d, k); out.push("*** Default configuration is based on 'x86_64_defconfig'", GESCHRIEBEN); continue; }
      if (z.startsWith('all')) { k = Object.fromEntries(SYMBOLE.map((s) => [s.n, s.t === 'string' ? s.std : z === 'allnoconfig' ? (s.n === 'MODULES' || s.n === 'KERNEL_GZIP' ? s.std : 'n') : z === 'allyesconfig' || s.t === 'bool' ? (s.wahl ? s.std : 'y') : 'm'])); konfigSpeichern(w, d, k); out.push(GESCHRIEBEN); continue; }
      if (z === 'olddefconfig' || z === 'syncconfig') { for (const s of fehlend(k)) k[s.n] = s.std; konfigSpeichern(w, d, k); out.push(GESCHRIEBEN); continue; }
      if (z === 'localmodconfig' || z === 'localyesconfig') {
        out.push(`using config: '${vorhanden ? '.config' : 'arch/x86/configs/x86_64_defconfig'}'`);
        for (const s of SYMBOLE) if (s.mod && k[s.n] === 'm') { if (!s.mod.split(',').some((m) => w.geladen[m])) k[s.n] = 'n'; else if (z === 'localyesconfig') k[s.n] = 'y'; }
        for (const s of fehlend(k)) k[s.n] = s.std;
        konfigSpeichern(w, d, k); out.push(GESCHRIEBEN); continue;
      }
      if (z === 'oldconfig') { const neu = fehlend(k); if (!neu.length) { konfigSpeichern(w, d, k); out.push(GESCHRIEBEN); continue; } return ok(abfragen(w, d, k, neu, out.join('\n') + '\n*\n* Restart config...\n*', weiter)); }
      if (z === 'config') return ok(abfragen(w, d, k, SYMBOLE, out.join('\n') + '\n*\n* Linux/x86 ' + version(w, d).ver + ' Kernel Configuration\n*', weiter));
      return ok(menuconfig(w, d, k, weiter).replace(/^/, out.join('\n') + '\n'));
    }
    if (['all', 'vmlinux', 'bzImage', 'modules', 'bindeb-pkg', 'deb-pkg'].includes(z)) {
      if (!hat(w, `${d}/.config`)) return fehler([...out, `***\n*** Configuration file ".config" not found!\n***\n*** Please run some configurator (e.g. "make oldconfig" or\n*** "make menuconfig" or "make xconfig").\n***\n${makeZeile(2, 'Makefile:765', 'include/config/auto.conf.cmd', 1)}\nmake: *** [Makefile:248: __sub-make] Fehler 2`].join('\n'), 2);
      const wf = werkzeugFehlt(w, 'bau'); if (wf) return fehler([...out, wf].join('\n'), 2);
      const k = konfigLesen(w.fs[`${d}/.config`]!);
      const neu = fehlend(k).filter((s) => s.neu);
      if (neu.length) return ok(abfragen(w, d, k, neu, [...out, '*\n* Restart config...\n*'].join('\n'), () => { const r = kernelMake(w, { ...a, ziele: ziele.slice(i) }); return [r.out, r.err].filter(Boolean).join('\n'); }));
      for (const s of fehlend(k)) k[s.n] = s.std;
      const r = bauen(w, a, z === 'bzImage' || z === 'vmlinux' ? 'kernel' : z === 'modules' ? 'module' : 'alles');
      if (r.code) return fehler([...out, r.err ?? ''].join('\n'), r.code);
      out.push(r.out);
      if (z === 'bindeb-pkg' || z === 'deb-pkg') {
        const b = st.bau[d]; const eltern = d.replace(/\/[^/]+$/, '') || '/';
        const vers = `${version(w, d).ver}-${b.nr}`;
        const pk = [`linux-image-${b.release}_${vers}_amd64.deb`, `linux-headers-${b.release}_${vers}_amd64.deb`, `linux-libc-dev_${vers}_amd64.deb`];
        if (!darfImOrdner(w, `${eltern}/x`, a.root)) return fehler([...out, `dpkg-deb: building package 'linux-image-${b.release}' in '../${pk[0]}'.\ndpkg-deb: error: unable to create '../${pk[0]}': Permission denied\n${makeZeile(2, 'scripts/Makefile.package:121', 'bindeb-pkg', 2)}\nmake: *** [Makefile:248: __sub-make] Fehler 2\n(Die Pakete landen im Ordner über dem Quellbaum, hier ${eltern}. Dort darfst du nicht schreiben.)`].join('\n'), 2);
        const inhalt = JSON.stringify({ rel: b.release, mods: b.mods, fest: b.builtin, info: b.info, konfig: b.konfig, vers });
        datei(w, `${eltern}/${pk[0]}`, '\u0007DEB:image:' + inhalt, 0o644, meta(w, d).owner);
        datei(w, `${eltern}/${pk[1]}`, '\u0007DEB:headers:' + inhalt, 0o644, meta(w, d).owner);
        datei(w, `${eltern}/${pk[2]}`, '\u0007DEB:libc:' + inhalt, 0o644, meta(w, d).owner);
        if (z === 'deb-pkg') { datei(w, `${eltern}/linux-upstream_${vers}.dsc`, '(Quellpaket)\n', 0o644, meta(w, d).owner); datei(w, `${eltern}/linux-upstream_${version(w, d).ver}.orig.tar.gz`, '\u0007BIN:221000000', 0o644, meta(w, d).owner); }
        out.push(...pk.map((p) => `dpkg-deb: building package '${p.split('_')[0]}' in '../${p}'.`), 'dpkg-genchanges: info: binary-only upload (no source code included)');
      }
      continue;
    }
    if (z === 'modules_install') {
      const b = st.bau[d];
      if (!b?.module) return fehler([...out, `cat: modules.order: Datei oder Verzeichnis nicht gefunden\n${makeZeile(1, `${d}/Makefile:1880`, 'modules_install', 1)}\nmake: *** [Makefile:248: __sub-make] Fehler 2\n(Erst die Module bauen: make -j$(nproc))`].join('\n'), 2);
      if (!a.root) return fehler([...out, `mkdir: das Verzeichnis »/lib/modules/${b.release}« kann nicht angelegt werden: Keine Berechtigung\n${makeZeile(2, 'scripts/Makefile.modinst:126', `/lib/modules/${b.release}/kernel`, 1)}\n${makeZeile(1, `${d}/Makefile:1880`, 'modules_install', 2)}\nmake: *** [Makefile:248: __sub-make] Fehler 2`].join('\n'), 2);
      out.push(...modulesInstall(w, d, b.release, b.mods, b.builtin, d));
      continue;
    }
    if (z === 'install') {
      const b = st.bau[d];
      if (!b?.kernel) return fehler([...out, `cat: arch/x86/boot/bzImage: Datei oder Verzeichnis nicht gefunden\n${makeZeile(1, 'arch/x86/Makefile:297', 'install', 1)}\nmake: *** [Makefile:248: __sub-make] Fehler 2\n(Erst den Kernel bauen: make -j$(nproc))`].join('\n'), 2);
      if (!a.root) return fehler([...out, `  INSTALL /boot\ncp: reguläre Datei '/boot/vmlinuz-${b.release}' kann nicht angelegt werden: Keine Berechtigung\n${makeZeile(1, 'arch/x86/Makefile:297', 'install', 1)}\nmake: *** [Makefile:248: __sub-make] Fehler 2`].join('\n'), 2);
      out.push('  INSTALL /boot');
      out.push(kernelInstallieren(w, b.release, w.fs[`${d}/arch/x86/boot/bzImage`] ?? '', b.konfig));
      continue;
    }
    if (z === 'rpm-pkg' || z === 'binrpm-pkg') return fehler([...out, `/bin/sh: 1: rpmbuild: not found\n${makeZeile(2, 'scripts/Makefile.package:68', z, 127)}\nmake: *** [Makefile:248: __sub-make] Fehler 2\n(RPM-Pakete baut man auf einem Red-Hat- oder SUSE-System. Auf Debian: make bindeb-pkg)`].join('\n'), 2);
    return fehler([...out, `make[1]: *** Keine Regel, um „${z}“ zu erstellen.  Schluss.\nmake: *** [Makefile:248: __sub-make] Fehler 2`].join('\n'), 2);
  }
  return ok(out.join('\n'));
}
function kernelInstallieren(w: Welt, rel: string, bild: string, konfig: string): string {
  const alt = `/boot/vmlinuz-${rel}`;
  if (alt in w.fs) { w.fs[`${alt}.old`] = w.fs[alt]; }
  datei(w, `/boot/vmlinuz-${rel}`, bild);
  datei(w, `/boot/config-${rel}`, konfig);
  datei(w, `/boot/System.map-${rel}`, 'ffffffff81000000 T _stext\n(… gekürzt …)\n');
  return hookLauf(w, rel);
}

/** Externes Modul mit obj-m im Makefile */
function extMake(w: Welt, a: MakeAuftrag): Ergebnis {
  const d = a.dir; const ziel = a.ziele[0] ?? 'all';
  const kdir = (a.vars.KDIR ?? `/lib/modules/${w.kernel}/build`);
  const kopf = `make -C ${kdir} M=${d} ${ziel === 'install' ? 'modules_install' : ziel === 'clean' ? 'clean' : 'modules'}`;
  const kc = w.fs[kdir]; const build = kc === null ? kdir : typeof kc === 'string' && kc.startsWith('-> ') ? K.pfad(w, kc.slice(3).startsWith('/') ? kc.slice(3) : kdir.replace(/[^/]+$/, '') + kc.slice(3)) : null;
  if (build === null || w.fs[build] !== null) return fehler(`${kopf}\nmake[1]: *** ${kdir}: Datei oder Verzeichnis nicht gefunden.  Schluss.\nmake: *** [Makefile:6: ${ziel}] Fehler 2\n(Zum Bauen fehlen die Header des laufenden Kernels: sudo apt install linux-headers-$(uname -r))`, 2);
  const kver = kdir.match(/\/lib\/modules\/([^/]+)\/build/)?.[1] ?? w.kernel;
  const rein = `make[1]: Verzeichnis „${build}“ wird betreten`; const raus = `make[1]: Verzeichnis „${build}“ wird verlassen`;
  if (ziel === 'clean') { for (const x of ['labsensor.ko', 'labsensor.o', 'labsensor.mod', 'labsensor.mod.c', 'labsensor.mod.o', 'Module.symvers', 'modules.order']) delete w.fs[`${d}/${x}`]; return ok(`${kopf}\n${rein}\n  CLEAN   ${d}\n${raus}`); }
  if (ziel === 'install') {
    if (!hat(w, `${d}/labsensor.ko`)) return fehler(`${kopf}\n${rein}\n  INSTALL /lib/modules/${kver}/updates/labsensor.ko\ncp: der Aufruf von stat für '${d}/labsensor.ko' ist nicht möglich: Datei oder Verzeichnis nicht gefunden\n${raus}\nmake: *** [Makefile:12: install] Fehler 2`, 2);
    if (!a.root) return fehler(`${kopf}\n${rein}\n  INSTALL /lib/modules/${kver}/updates/labsensor.ko\nmkdir: das Verzeichnis »/lib/modules/${kver}/updates« kann nicht angelegt werden: Keine Berechtigung\n${raus}\nmake: *** [Makefile:12: install] Fehler 2`, 2);
    datei(w, `/lib/modules/${kver}/updates/labsensor.ko`, w.fs[`${d}/labsensor.ko`]!);
    depmodSchreiben(w, kver);
    return ok(`${kopf}\n${rein}\n  INSTALL /lib/modules/${kver}/updates/labsensor.ko\n  DEPMOD  /lib/modules/${kver}\n${raus}`);
  }
  if (!darf(w, d, 'w', a.root)) return fehler(`${kopf}\n${rein}\n  CC [M]  ${d}/labsensor.o\nAssembler messages:\nFatal error: can't create ${d}/labsensor.o: Keine Berechtigung\n${raus}\nmake: *** [Makefile:6: all] Fehler 2\n(In ${d} darfst du nicht schreiben. Kopier den Ordner zu dir: cp -r ${d} ~/)`, 2);
  if (!hat(w, '/usr/bin/gcc')) return fehler(`${kopf}\n${rein}\n  CC [M]  ${d}/labsensor.o\n/bin/sh: 1: gcc: not found\n${raus}\nmake: *** [Makefile:6: all] Fehler 2`, 2);
  const o = meta(w, d).owner;
  datei(w, `${d}/labsensor.o`, '\u0007BIN:61440', 0o664, o); datei(w, `${d}/labsensor.mod.c`, '// erzeugt von modpost\n', 0o664, o);
  datei(w, `${d}/labsensor.ko`, `\u0007KO:labsensor:${kver}:61440`, 0o664, o); datei(w, `${d}/modules.order`, `${d}/labsensor.o\n`, 0o664, o); datei(w, `${d}/Module.symvers`, '', 0o664, o);
  return ok(`${kopf}\n${rein}\n  CC [M]  ${d}/labsensor.o\n  MODPOST ${d}/Module.symvers\n  CC [M]  ${d}/labsensor.mod.o\n  LD [M]  ${d}/labsensor.ko\n  BTF [M] ${d}/labsensor.ko\nSkipping BTF generation for ${d}/labsensor.ko due to unavailability of vmlinux\n${raus}`);
}

// ---------- DKMS ----------

function dkmsHeaders(w: Welt, k: string): boolean { const b = `/lib/modules/${k}/build`; const c = w.fs[b]; if (c === undefined) return false; if (c === null) return true; return c.startsWith('-> ') && (c.slice(3) in w.fs); }
function dkmsBauen(w: Welt, k: string): string | null {
  const st = ks(w);
  if (!dkmsHeaders(w, k)) return `Error! Your kernel headers for kernel ${k} cannot be found at /lib/modules/${k}/build or /lib/modules/${k}/source.\nPlease install the linux-headers-${k} package or use the --kernelsourcedir option to tell DKMS where it's located.`;
  if (!st.dkms.gebaut.includes(k)) st.dkms.gebaut.push(k);
  datei(w, `/var/lib/dkms/${LAB}/${LABV}/${k}/x86_64/module/${LAB}.ko`, `\u0007KO:${LAB}:${k}:61440`);
  datei(w, `/var/lib/dkms/${LAB}/${LABV}/build/make.log`, `DKMS make.log for ${LAB}-${LABV} for kernel ${k} (x86_64)\n${englischesDatum(w.uhr)}\nmake: Verzeichnis „/var/lib/dkms/${LAB}/${LABV}/build“ wird betreten\n  CC [M]  /var/lib/dkms/${LAB}/${LABV}/build/${LAB}.o\n  LD [M]  /var/lib/dkms/${LAB}/${LABV}/build/${LAB}.ko\n`);
  return null;
}
function dkmsInstallieren(w: Welt, k: string): string {
  const st = ks(w);
  datei(w, `/lib/modules/${k}/updates/dkms/${LAB}.ko`, `\u0007KO:${LAB}:${k}:61440`);
  if (!st.dkms.inst.includes(k)) st.dkms.inst.push(k);
  depmodSchreiben(w, k);
  return `\n${LAB}.ko:\nRunning module version sanity check.\n - Original module\n   - No original module exists within this kernel\n - Installation\n   - Installing to /lib/modules/${k}/updates/dkms/\ndepmod...`;
}
const DKMS_BAU = (k: string) => `\nBuilding module:\nCleaning build area...\nmake -j6 KERNELRELEASE=${k} -C /lib/modules/${k}/build M=/var/lib/dkms/${LAB}/${LABV}/build....\nCleaning build area...`;
function dkmsAuto(w: Welt, k: string, hook: boolean): string {
  const st = ks(w);
  if (!st.dkms.hinzu) return hook ? `dkms: running auto installation service for kernel ${k}.\n ...done.` : '';
  if (st.dkms.inst.includes(k)) return hook ? `dkms: running auto installation service for kernel ${k}.\n${LAB}/${LABV} autoinstall: Installed.\n ...done.` : '';
  const e = dkmsBauen(w, k);
  if (e) return `${hook ? `dkms: running auto installation service for kernel ${k}.\n` : ''}${e}\n${hook ? ' ...failed!' : ''}`.trim();
  return `${hook ? `dkms: running auto installation service for kernel ${k}.\n` : ''}${DKMS_BAU(k)}${dkmsInstallieren(w, k)}${hook ? '\n ...done.' : ''}`;
}
function dkms(w: Welt, a: string[], root: boolean): Ergebnis {
  if (!hat(w, '/usr/sbin/dkms')) return nichtDa('dkms', 'dkms');
  const st = ks(w); const dk = st.dkms;
  const [sub, ...r] = a;
  const ki = r.indexOf('-k'); const kern = ki >= 0 ? r[ki + 1] : w.kernel;
  const mi = r.indexOf('-m'); const vi = r.indexOf('-v');
  const spec = mi >= 0 ? `${r[mi + 1]}/${vi >= 0 ? r[vi + 1] : ''}` : r.find((x, i) => !x.startsWith('-') && (ki < 0 || i !== ki + 1) && (mi < 0 || i !== mi + 1) && (vi < 0 || i !== vi + 1)) ?? '';
  const istLab = (s: string) => s === `${LAB}/${LABV}` || s.replace(/\/$/, '') === LABQ || s === LAB || s === `${LAB}-${LABV}`;
  if (!sub || sub === '--help' || sub === '-h') return ok('Usage: /usr/sbin/dkms [action] [options]\n  [action]  = { add | remove | build | install | uninstall | match | autoinstall | mkdeb | mkrpm | status | ... }\n  [options] = [-m module] [-v module-version] [-k kernel-version] [--all] ...');
  if (sub === 'status') {
    const z: string[] = [];
    if (dk.hinzu) {
      const alle = [...new Set([...dk.gebaut, ...dk.inst])];
      if (!alle.length) z.push(`${LAB}/${LABV}: added`);
      for (const k of alle.sort((x, y) => versionVergleich(x, y))) z.push(`${LAB}/${LABV}, ${k}, x86_64: ${dk.inst.includes(k) ? 'installed' : 'built'}`);
    }
    return ok(z.join('\n'));
  }
  if (!root) return fehler('Error! You must be root to use this command.');
  if (sub === 'add') {
    if (!spec || !istLab(spec)) return fehler(`Error! Could not find module source directory.\nDirectory: /usr/src/${spec.replace('/', '-')} does not exist.`);
    if (!hat(w, `${LABQ}/dkms.conf`)) return fehler(`Error! Arguments <module> and <module-version> are not specified.\nUsage: add <module>/<module-version> or\n       add -m <module>/<module-version> or\n       add -m <module> -v <module-version>`);
    if (dk.hinzu) return fehler(`Error! DKMS tree already contains: ${LAB}-${LABV}\nYou cannot add the same module/version combo more than once.`);
    dk.hinzu = true; datei(w, `/var/lib/dkms/${LAB}/${LABV}/source`, '-> ' + LABQ, 0o777);
    return ok(`Creating symlink /var/lib/dkms/${LAB}/${LABV}/source -> ${LABQ}`);
  }
  if (['build', 'install', 'remove', 'uninstall'].includes(sub)) {
    if (!spec || !istLab(spec)) return fehler(`Error! The module/version combo: ${spec || '(keins)'} is not located in the DKMS tree.`);
    if (!dk.hinzu) return fehler(`Error! The module/version combo: ${LAB}-${LABV} is not located in the DKMS tree.`);
  }
  if (sub === 'build') { const e = dkmsBauen(w, kern); return e ? fehler(e, 1) : ok(DKMS_BAU(kern)); }
  if (sub === 'install') {
    if (dk.inst.includes(kern)) return fehler(`Module ${LAB}/${LABV} already installed on kernel ${kern} (x86_64), skip. You may override by specifying --force.`, 0);
    const neuGebaut = !dk.gebaut.includes(kern);
    if (neuGebaut) { const e = dkmsBauen(w, kern); if (e) return fehler(e); }
    return ok(`${neuGebaut ? DKMS_BAU(kern) + '\n' : ''}${dkmsInstallieren(w, kern).replace(/^\n/, '')}`);
  }
  if (sub === 'autoinstall') return ok(dkmsAuto(w, kern, false));
  if (sub === 'remove' || sub === 'uninstall') {
    const alle = r.includes('--all') ? [...new Set([...dk.gebaut, ...dk.inst])] : [kern];
    const z: string[] = [];
    for (const k of alle) {
      if (dk.inst.includes(k)) { delete w.fs[`/lib/modules/${k}/updates/dkms/${LAB}.ko`]; depmodSchreiben(w, k); z.push(`Module ${LAB}-${LABV} for kernel ${k} (x86_64).\nBefore uninstall, this module version was ACTIVE on this kernel.\n\n${LAB}.ko:\n - Uninstallation\n   - Deleting from: /lib/modules/${k}/updates/dkms/\n - Original module\n   - No original module was found for this module on this kernel.\n   - Use the dkms install command to reinstall any previous module version.\ndepmod...`); }
      dk.inst = dk.inst.filter((x) => x !== k); if (sub === 'remove') dk.gebaut = dk.gebaut.filter((x) => x !== k);
    }
    if (sub === 'remove' && (r.includes('--all') || !dk.gebaut.length)) { dk.hinzu = false; loeschen(w, `/var/lib/dkms/${LAB}`); z.push(`Deleting module ${LAB}-${LABV} completely from the DKMS tree.`); }
    return ok(z.join('\n'));
  }
  return fehler(`Error! Unknown action specified: "${sub}"`);
}

// ---------- patch ----------

interface Hunk { altStart: number; alt: string[]; neu: string[] }
interface Teil { altName: string; neuName: string; hunks: Hunk[]; kopf: string[] }
function patchLesen(t: string): Teil[] {
  const z = t.split('\n'); const r: Teil[] = []; let kopf: string[] = [];
  for (let i = 0; i < z.length; i++) {
    if (z[i].startsWith('--- ') && z[i + 1]?.startsWith('+++ ')) {
      const teil: Teil = { altName: z[i].slice(4).split('\t')[0].trim(), neuName: z[i + 1].slice(4).split('\t')[0].trim(), hunks: [], kopf: [...kopf, z[i], z[i + 1]] }; kopf = []; i += 2;
      while (i < z.length && z[i].startsWith('@@')) {
        const m = z[i].match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/); if (!m) break;
        const h: Hunk = { altStart: Number(m[1]), alt: [], neu: [] }; i++;
        while (i < z.length && /^[ +-]/.test(z[i]) && !z[i].startsWith('--- ')) { const c = z[i][0]; const s = z[i].slice(1); if (c !== '+') h.alt.push(s); if (c !== '-') h.neu.push(s); i++; }
        // Leere Kontextzeile am Dateiende
        while (i < z.length && z[i] === '' && h.alt.length < Number(m[2] ?? 1)) { h.alt.push(''); h.neu.push(''); i++; }
        teil.hunks.push(h);
      }
      i--; r.push(teil);
    } else kopf.push(z[i]);
  }
  return r;
}
function finde(zeilen: string[], block: string[], ab: number): number {
  for (let off = 0; off < zeilen.length; off++) for (const s of [ab + off, ab - off]) if (s >= 0 && s + block.length <= zeilen.length && block.every((b, j) => zeilen[s + j] === b)) return s;
  return -1;
}
function patch(w: Welt, a: string[], stdin: string, root: boolean): Ergebnis {
  if (!hat(w, '/usr/bin/patch')) return nichtDa('patch', 'patch');
  let strip = -1; let datei2: string | null = null; let trocken = false; let rueck = false; let ordner = w.cwd; const ziele: string[] = [];
  for (let i = 0; i < a.length; i++) {
    const x = a[i]; let m;
    if ((m = x.match(/^-p(\d+)$/))) strip = Number(m[1]); else if (x === '-p') strip = Number(a[++i]);
    else if ((m = x.match(/^--strip=(\d+)$/))) strip = Number(m[1]);
    else if (x === '-i') datei2 = a[++i]; else if (x.startsWith('--input=')) datei2 = x.slice(8);
    else if (x === '--dry-run') trocken = true; else if (x === '-R' || x === '--reverse') rueck = true;
    else if (x === '-d') ordner = K.pfad(w, a[++i]); else if (x === '-N' || x === '--forward' || x === '-s' || x === '--quiet') { /* ignoriert */ }
    else if (!x.startsWith('-')) ziele.push(x);
  }
  let text = stdin;
  if (datei2) { const p = K.pfad(w, datei2); const c = w.fs[p]; if (typeof c !== 'string') return fehler(`patch: **** Can't open patch file ${datei2} : No such file or directory`, 2); text = c; }
  if (text.startsWith(KOMP)) return fehler('patch: **** Only garbage was found in the patch input.\n(Der Patch ist noch gepackt. Entpacken und weiterreichen: xz -dc DATEI | patch -p1)', 2);
  const teile = patchLesen(text);
  if (!teile.length) return fehler('patch: **** Only garbage was found in the patch input.', 2);
  const out: string[] = []; let fehlschlag = false;
  for (const t of teile) {
    const roh = t.neuName === '/dev/null' ? t.altName : t.neuName;
    const name = ziele[0] ?? (strip < 0 ? roh.split('/').pop()! : roh.split('/').slice(strip).join('/'));
    const p = K.pfad(w, name.startsWith('/') ? name : `${ordner}/${name}`);
    if (typeof w.fs[p] !== 'string') {
      out.push(`can't find file to patch at input line ${t.kopf.length + 1}\nPerhaps you used the wrong -p or --strip option?\nThe text leading up to this was:\n--------------------------\n${t.kopf.map((x) => '|' + x).join('\n')}\n--------------------------\nNo file to patch.  Skipping patch.\n${t.hunks.length} out of ${t.hunks.length} hunk${t.hunks.length > 1 ? 's' : ''} ignored`);
      fehlschlag = true; continue;
    }
    if (!trocken && !darf(w, p, 'w', root)) { out.push(`patching file ${name}\npatch: **** Can't create temporary file ${name}.oXXXXXX : Permission denied`); return fehler(out.join('\n'), 2); }
    let zeilen = (w.fs[p] as string).split('\n');
    const vorwaerts = (zs: string[], hs: Hunk[], rev: boolean) => { let z2 = [...zs]; const fehlt: number[] = []; hs.forEach((h, j) => { const von = rev ? h.neu : h.alt; const nach = rev ? h.alt : h.neu; const s = finde(z2, von, h.altStart - 1); if (s < 0) fehlt.push(j + 1); else z2 = [...z2.slice(0, s), ...nach, ...z2.slice(s + von.length)]; }); return { z2, fehlt }; };
    const v = vorwaerts(zeilen, t.hunks, rueck);
    out.push(`${trocken ? 'checking' : 'patching'} file ${name}`);
    if (v.fehlt.length) {
      const r2 = vorwaerts(zeilen, t.hunks, !rueck);
      if (!r2.fehlt.length) { out.push(`Reversed (or previously applied) patch detected!  Assume -R? [n] \nApply anyway? [n] \nSkipping patch.\n${t.hunks.length} out of ${t.hunks.length} hunk${t.hunks.length > 1 ? 's' : ''} ignored${trocken ? '' : ` -- saving rejects to file ${name}.rej`}\n(Der Patch ist hier schon eingespielt. Zurücknehmen ginge mit -R.)`); if (!trocken) datei(w, p + '.rej', t.kopf.slice(-2).join('\n') + '\n', 0o644, meta(w, p).owner); fehlschlag = true; continue; }
      for (const f of v.fehlt) out.push(`Hunk #${f} FAILED at ${t.hunks[f - 1].altStart}.`);
      out.push(`${v.fehlt.length} out of ${t.hunks.length} hunk${t.hunks.length > 1 ? 's' : ''} FAILED${trocken ? '' : ` -- saving rejects to file ${name}.rej`}`);
      fehlschlag = true; continue;
    }
    zeilen = v.z2;
    if (!trocken) { w.fs[p] = zeilen.join('\n'); meta(w, p).mtime = w.uhr; }
  }
  return fehlschlag ? { out: out.join('\n'), code: 1 } : ok(out.join('\n'));
}

// ---------- Befehle ----------

export function kernBefehle(alt: Record<string, B>): Record<string, B> {
  const b: Record<string, B> = {};
  const mit = (name: string, f: B): B => (w, a, i, r) => (kernAktiv(w) ? f(w, a, i, r) : alt[name](w, a, i, r));

  b.uname = mit('uname', (w, a) => {
    const lang: Record<string, string> = { '--all': 'a', '--kernel-name': 's', '--nodename': 'n', '--kernel-release': 'r', '--kernel-version': 'v', '--machine': 'm', '--processor': 'p', '--hardware-platform': 'i', '--operating-system': 'o' };
    const f = new Set<string>();
    for (const x of a) { if (lang[x]) f.add(lang[x]); else if (/^-[a-z]+$/.test(x)) for (const c of x.slice(1)) f.add(c); else return fehler(`uname: zusätzlicher Operand „${x}“\n„uname --help“ liefert weitere Informationen.`); }
    const alma = w.distro !== 'debian';
    const v = ks(w).infos[w.kernel] ?? BAU_INFO[w.kernel] ?? '#1 SMP';
    const teile: [string, string][] = [['s', 'Linux'], ['n', w.host], ['r', w.kernel], ['v', v], ['m', 'x86_64'], ['p', alma ? 'x86_64' : 'unknown'], ['i', alma ? 'x86_64' : 'unknown'], ['o', 'GNU/Linux']];
    if (f.has('a')) return ok(teile.filter(([c, x]) => !(['p', 'i'].includes(c) && x === 'unknown')).map(([, x]) => x).join(' '));
    if (!f.size) f.add('s');
    return ok(teile.filter(([c]) => f.has(c)).map(([, x]) => x).join(' '));
  });

  b.make = (w, a, _i, root) => {
    if (!hat(w, '/usr/bin/make')) return nichtDa('make', 'make');
    const auftrag: MakeAuftrag = { dir: w.cwd, ziele: [], vars: {}, jobs: 1, leise: false, root };
    for (let i = 0; i < a.length; i++) {
      const x = a[i]; let m;
      if (x === '-C') auftrag.dir = K.pfad(w, a[++i] ?? '.');
      else if ((m = x.match(/^-C(.+)$/))) auftrag.dir = K.pfad(w, m[1]);
      else if ((m = x.match(/^-j(\d*)$/))) { if (m[1]) auftrag.jobs = Number(m[1]); else if (/^\d+$/.test(a[i + 1] ?? '')) auftrag.jobs = Number(a[++i]); else auftrag.jobs = 16; }
      else if ((m = x.match(/^--jobs=(\d+)$/))) auftrag.jobs = Number(m[1]);
      else if (x === '-s' || x === '--silent' || x === '--quiet') auftrag.leise = true;
      else if ((m = x.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/))) auftrag.vars[m[1]] = m[2];
      else if (!x.startsWith('-')) auftrag.ziele.push(x);
    }
    let d = auftrag.dir; const c = w.fs[d]; if (typeof c === 'string' && c.startsWith('-> ')) d = K.pfad(w, d.replace(/[^/]+$/, '') + c.slice(3));
    auftrag.dir = d;
    const mf = w.fs[`${d}/Makefile`] ?? w.fs[`${d}/makefile`];
    if (typeof mf !== 'string') return fehler(auftrag.ziele.length ? `make: *** Keine Regel, um „${auftrag.ziele[0]}“ zu erstellen.  Schluss.` : 'make: *** Es wurden keine Ziele angegeben und keine Makedatei gefunden.  Schluss.', 2);
    if (/^obj-m/m.test(mf)) return extMake(w, auftrag);
    if (istBaum(w, d)) { basis(w); return kernelMake(w, auftrag); }
    return fehler('(Dieses Makefile kann der Simulator noch nicht ausführen. Programme aus dem Quellcode baust du in Akt 7.)', 2);
  };

  b.patch = (w, a, i, r) => patch(w, a, i, r);
  // Werkzeuge, die der Bau des Kernels braucht. Direkt aufgerufen tun sie im Simulator wenig.
  for (const [n, paket, text] of [['gcc', 'gcc', 'gcc: fatal error: no input files\ncompilation terminated.'], ['cc', 'gcc', 'cc: fatal error: no input files\ncompilation terminated.'], ['flex', 'flex', 'flex: kann nicht von der Standardeingabe lesen (im Simulator)'], ['bison', 'bison', 'bison: Fehlende Operanden\nRufen Sie »bison --help« auf, um weitere Informationen zu erhalten.'], ['pahole', 'dwarves', 'pahole: file \'a.out\' has no dwarf info.']] as [string, string, string][]) {
    b[n] = (w, a) => {
      if (!hat(w, `/usr/bin/${n}`)) return nichtDa(n, paket);
      if (a.includes('--version')) return ok(n === 'gcc' || n === 'cc' ? `${n} (Debian 12.2.0-14+deb12u1) 12.2.0\nCopyright (C) 2022 Free Software Foundation, Inc.` : n === 'flex' ? 'flex 2.6.4' : n === 'bison' ? 'bison (GNU Bison) 3.8.2' : 'v1.24');
      return fehler(text);
    };
  }
  b.bc = (w, a, stdin) => {
    if (!hat(w, '/usr/bin/bc')) return nichtDa('bc', 'bc');
    let scale = a.includes('-l') ? 20 : 0; const out: string[] = [];
    for (const roh of stdin.split(/[\n;]/)) {
      const z = roh.trim(); if (!z) continue; let m;
      if ((m = z.match(/^scale\s*=\s*(\d+)$/))) { scale = Number(m[1]); continue; }
      if (!/^[\d\s+\-*/().^%]+$/.test(z)) { out.push('(standard_in) 1: syntax error'); continue; }
      try { const v = Function(`return (${z.replace(/\^/g, '**')})`)() as number; out.push(scale ? (Math.trunc(v * 10 ** scale) / 10 ** scale).toFixed(scale).replace(/^0\./, '.').replace(/^-0\./, '-.') : String(Math.trunc(v))); } catch { out.push('(standard_in) 1: syntax error'); }
    }
    return ok(out.join('\n'));
  };
  b.dkms = (w, a, _i, r) => dkms(w, a, r);

  // ---- Module ----
  const zielName = (a: string[]) => { const ohne = a.filter((x, j) => !x.startsWith('-') && !(a[j - 1] === '-C' || a[j - 1] === '-S' || a[j - 1] === '-d')); return ohne; };
  b.modprobe = mit('modprobe', (w, a, i, r) => {
    const rest = zielName(a); const roh = rest[0];
    if (!roh || a.includes('-c') || a.includes('--showconfig')) {
      if (a.includes('-c') || a.includes('--showconfig')) return ok(modKonfig(w).zeilen.join('\n'));
      return alt.modprobe(w, a, i, r);
    }
    const kfg = modKonfig(w); const n0 = roh.replace(/-/g, '_'); const n = kfg.alias[n0] ?? n0;
    const entfernen = a.includes('-r') || a.includes('--remove');
    if (eingebaut(w).has(n)) return entfernen ? fehler(`modprobe: FATAL: Module ${n} is builtin.`) : ok(a.includes('-v') ? '' : '');
    if (!imDep(w, n)) return fehler(entfernen && !w.geladen[n] ? `modprobe: FATAL: Module ${roh} not found.` : `modprobe: FATAL: Module ${roh} not found in directory /lib/modules/${w.kernel}`);
    if (!w.verfuegbar[n] && n === LAB) w.verfuegbar[LAB] = LABMODUL;
    const vorher = new Set(Object.keys(w.geladen));
    const res = alt.modprobe(w, a.map((x) => (x === roh ? n : x)), i, r);
    if (res.code) return res;
    for (const m of Object.keys(w.geladen)) if (!vorher.has(m)) nachLaden(w, m, m === n ? rest.slice(1) : []);
    for (const m of vorher) if (!w.geladen[m]) nachEntladen(w, m);
    return res;
  });
  b.insmod = mit('insmod', (w, a, i, r) => {
    const p = a.find((x) => !x.startsWith('-')); if (!p) return alt.insmod(w, a, i, r);
    const pp = K.pfad(w, p); const c = w.fs[pp];
    const n = modName(pp);
    if (typeof c === 'string' && c.startsWith('\u0007KO:')) {
      const [, , vermagic] = c.split(':');
      if (!r) return fehler(`insmod: ERROR: could not insert module ${p}: Operation not permitted`);
      if (vermagic !== w.kernel) { meld(w, `${n}: version magic '${vermagic} SMP preempt mod_unload modversions ' should be '${w.kernel} SMP preempt mod_unload modversions '`); return fehler(`insmod: ERROR: could not insert module ${p}: Invalid module format`); }
      if (!w.verfuegbar[n] && n === LAB) w.verfuegbar[LAB] = LABMODUL;
      if (!w.verfuegbar[n]) return fehler(`insmod: ERROR: could not insert module ${p}: Unknown symbol in module`);
      if (w.geladen[n]) return fehler(`insmod: ERROR: could not insert module ${p}: File exists`);
      if (w.verfuegbar[n].abh.some((x) => !w.geladen[x])) { meld(w, `${n}: Unknown symbol usb_register_driver (err -2)`); return fehler(`insmod: ERROR: could not insert module ${p}: Unknown symbol in module`); }
      w.geladen[n] = []; K.benutzer(w); nachLaden(w, n, a.filter((x) => x.includes('=')));
      return ok();
    }
    const vorher = !!w.geladen[n];
    const res = alt.insmod(w, a, i, r);
    if (!res.code && !vorher && w.geladen[n]) nachLaden(w, n, a.filter((x) => x.includes('=')));
    return res;
  });
  b.rmmod = mit('rmmod', (w, a, i, r) => {
    const n = (a.find((x) => !x.startsWith('-')) ?? '').replace(/-/g, '_').replace(/\.ko$/, '').split('/').pop()!;
    if (eingebaut(w).has(n)) return fehler(`rmmod: ERROR: Module ${n} is builtin.`);
    const res = alt.rmmod(w, a, i, r);
    if (!res.code) nachEntladen(w, n);
    return res;
  });
  b.modinfo = mit('modinfo', (w, a, i, r) => {
    const fi = a.indexOf('-F'); const feld = fi >= 0 ? a[fi + 1] : null;
    const ziel = a.find((x, j) => !x.startsWith('-') && (fi < 0 || j !== fi + 1));
    if (!ziel) return fehler('modinfo: ERROR: missing module or filename.');
    const kfg = modKonfig(w);
    let datei2: string | null = null; let n: string; let vermagic = w.kernel;
    if (ziel.includes('/') || ziel.endsWith('.ko')) {
      const p = K.pfad(w, ziel); const c = w.fs[p];
      if (typeof c !== 'string') return fehler(`modinfo: ERROR: Module ${ziel} not found.`);
      n = modName(p); datei2 = p; if (c.startsWith('\u0007KO:')) vermagic = c.split(':')[2];
    } else {
      n = kfg.alias[ziel.replace(/-/g, '_')] ?? ziel.replace(/-/g, '_');
      if (eingebaut(w).has(n)) return ok(feld ? (feld === 'filename' ? '(builtin)' : feld === 'name' ? n : '') : `name:           ${n}\nfilename:       (builtin)\nlicense:        GPL\nfile:           ${K.modulPfad(n).replace(/^kernel\//, '').replace(/\/[^/]+$/, '')}\ndescription:    ${w.verfuegbar[n]?.beschreibung ?? ''}`);
      const t = w.fs[`/lib/modules/${w.kernel}/modules.dep`] ?? '';
      const z = t.split('\n').find((x) => x && modName(x.split(':')[0]) === n);
      if (!z) return fehler(`modinfo: ERROR: Module ${ziel} not found.`);
      datei2 = `/lib/modules/${w.kernel}/${z.split(':')[0]}`;
    }
    const mod = w.verfuegbar[n] ?? (n === LAB ? LABMODUL : undefined);
    if (!mod) return alt.modinfo(w, a, i, r);
    const parm = Object.entries(mod.parameter ?? {});
    const felder: [string, string][] = [['filename', datei2!], ...(n === LAB ? [['version', LABV] as [string, string], ['author', 'Labor Mess GmbH <treiber@labor-mess.example>'] as [string, string]] : []), ['description', mod.beschreibung], ['license', 'GPL'], ...(n === LAB ? [['alias', 'usb:v1209p0001d*dc*dsc*dp*ic*isc*ip*in*'] as [string, string]] : []), ['depends', mod.abh.join(',')], ['retpoline', 'Y'], ['intree', n === LAB ? '' : 'Y'], ['name', n], ['vermagic', `${vermagic} SMP preempt mod_unload modversions `], ...parm.map(([k, v]) => ['parm', `${k}:${v}`] as [string, string])];
    if (a.includes('-p')) return ok(parm.map(([k, v]) => `${k}:${v}`).join('\n'));
    if (feld) return ok(felder.filter(([k]) => k === feld).map(([, v]) => v).join('\n'));
    return ok(felder.filter(([k, v]) => !(k === 'intree' && !v)).map(([k, v]) => `${(k + ':').padEnd(16)}${v}`).join('\n'));
  });
  b.depmod = (w, a, _i, root) => {
    basis(w);
    const v = a.find((x) => !x.startsWith('-') && /^\d/.test(x)) ?? w.kernel;
    if (!(`/lib/modules/${v}` in w.fs)) return fehler(`depmod: ERROR: could not open directory /lib/modules/${v}: No such file or directory\ndepmod: FATAL: could not search modules: No such file or directory`);
    if (a.includes('-n') || a.includes('--dry-run')) { const alt2 = w.fs[`/lib/modules/${v}/modules.dep`]; const t = depmodSchreiben(w, v); if (alt2 !== undefined) w.fs[`/lib/modules/${v}/modules.dep`] = alt2; return ok(`# modules.dep\n${t}`); }
    if (!root) return fehler(`depmod: ERROR: openat(/lib/modules/${v}, modules.dep.${Math.floor(Math.random() * 9000 + 1000)}.tmp, 1101, 644): Permission denied`);
    depmodSchreiben(w, v);
    return ok();
  };
  b.kmod = (w, a, i, r) => {
    if (a[0] === 'list') return befehleRef.lsmod(w, [], i, r);
    if (a[0] === 'static-nodes') return ok('Module: snd-timer\n\tDevname: snd/timer\n\tType: character device\n\tMajor: 116\n\tMinor: 33\nModule: fuse\n\tDevname: fuse\n\tType: character device\n\tMajor: 10\n\tMinor: 229');
    if (a[0] === '--version' || a[0] === '-V') return ok('kmod version 30\n+ZSTD +XZ -ZLIB +LIBCRYPTO -EXPERIMENTAL');
    return ok('kmod - Manage kernel modules: list, load, unload, etc\nUsage:\n\tkmod [options] command [command_options]\n\nCommands:\n  help         Show help message\n  list         list currently loaded modules\n  static-nodes outputs the static-node information installed with the currently running kernel\n\nkmod also handles gracefully if called from following symlinks:\n  lsmod        compat lsmod command\n  rmmod        compat rmmod command\n  insmod       compat insmod command\n  modinfo      compat modinfo command\n  modprobe     compat modprobe command\n  depmod       compat depmod command');
  };

  // ---- initramfs ----
  b['update-initramfs'] = (w, a, _i, root) => {
    if (w.distro !== 'debian') return nichtDa('update-initramfs', '');
    basis(w);
    const ki = a.indexOf('-k'); const kv = ki >= 0 ? a[ki + 1] : null;
    const op = a.find((x) => ['-c', '-u', '-d'].includes(x));
    if (!op) return fehler('Usage: update-initramfs {-c|-d|-u} [-k version] [-v] [-b directory]\n\nOptions:\n -k version     Specify kernel version or \'all\'\n -c             Create a new initramfs\n -u             Update an existing initramfs\n -d             Remove an existing initramfs', 2);
    if (!root) return fehler(`update-initramfs: ${op === '-d' ? 'Deleting' : 'Generating'} /boot/initrd.img-${kv ?? w.kernel}\n/usr/sbin/mkinitramfs: 1: cannot create /boot/initrd.img-${kv ?? w.kernel}.new: Permission denied`);
    const liste = kv === 'all' ? kernelImBoot(w) : [kv ?? (op === '-u' ? kernelImBoot(w).find((v) => `/boot/initrd.img-${v}` in w.fs) ?? w.kernel : w.kernel)];
    const z: string[] = [];
    for (const v of liste) {
      if (op === '-d') { delete w.fs[`/boot/initrd.img-${v}`]; z.push(`update-initramfs: Deleting /boot/initrd.img-${v}`); continue; }
      if (op === '-u' && !(`/boot/initrd.img-${v}` in w.fs)) { z.push(`update-initramfs: /boot/initrd.img-${v} does not exist. Cannot update.`); continue; }
      if (op === '-c' && `/boot/initrd.img-${v}` in w.fs && kv !== 'all') { z.push(`update-initramfs: /boot/initrd.img-${v} exists, doing update`); }
      z.push(initramfsErzeugen(w, v));
    }
    return ok(z.join('\n'));
  };
  b.mkinitramfs = (w, a, _i, root) => {
    if (w.distro !== 'debian') return nichtDa('mkinitramfs', '');
    basis(w);
    const oi = a.indexOf('-o'); const ziel = oi >= 0 ? a[oi + 1] : null;
    const v = a.filter((x, j) => !x.startsWith('-') && (oi < 0 || j !== oi + 1))[0] ?? w.kernel;
    if (!ziel) return fehler('(mkinitramfs schreibt sonst auf die Standardausgabe. Üblich: mkinitramfs -o /boot/initrd.img-VERSION VERSION)');
    const p = K.pfad(w, ziel);
    if (!darfImOrdner(w, p, root)) return fehler(`/usr/sbin/mkinitramfs: 1: cannot create ${ziel}.new: Permission denied`);
    if (!(`/lib/modules/${v}` in w.fs)) return fehler(`W: missing /lib/modules/${v}\nW: Ensure all necessary drivers are built into the linux image!\ndepmod: ERROR: could not open directory /lib/modules/${v}: No such file or directory\ndepmod: FATAL: could not search modules: No such file or directory`);
    datei(w, p, initrdInhalt(w, v));
    return ok();
  };
  b.lsinitramfs = (w, a) => {
    if (w.distro !== 'debian') return nichtDa('lsinitramfs', '');
    basis(w);
    const p = a.find((x) => !x.startsWith('-')); if (!p) return fehler('Usage: lsinitramfs [-l] initramfs-file...');
    const c = w.fs[K.pfad(w, p)];
    if (typeof c !== 'string') return fehler(`${p}: No such file or directory`);
    let e: { p: string }[] = [];
    try { e = c.startsWith(CPIO) ? JSON.parse(c.slice(CPIO.length)) : []; } catch { e = []; }
    if (!e.length) e = JSON.parse(initrdInhalt(w, w.kernel, true).slice(CPIO.length));
    return ok(['kernel', 'kernel/x86', 'kernel/x86/microcode', 'kernel/x86/microcode/GenuineIntel.bin', ...e.map((x) => x.p)].join('\n'));
  };
  b.dracut = (w, a, _i, root) => {
    if (w.distro !== 'alma') return nichtDa('dracut', 'dracut');
    basis(w);
    if (a.includes('--list-modules')) return ok('bash\nsystemd\nsystemd-initrd\nkernel-modules\nkernel-modules-extra\nlvm\nmdraid\ncrypt\nresume\nrootfs-block\nterminfo\nudev-rules\nbase\nfs-lib\nshutdown\n(… gekürzt …)');
    const frei = a.filter((x) => !x.startsWith('-'));
    const v = frei[1] ?? w.kernel; const ziel = frei[0] ?? `/boot/initramfs-${v}.img`;
    const p = K.pfad(w, ziel);
    if (!root) return fehler(`dracut: Can't write to /boot: Directory /boot does not exist or is not accessible.`);
    if (p in w.fs && !(a.includes('-f') || a.includes('--force'))) return fehler(`dracut: Will not override existing initramfs (${p}) without --force`);
    datei(w, p, initrdInhalt(w, v));
    return ok(a.includes('-v') || a.includes('--verbose') ? `dracut: Executing: /usr/bin/dracut ${a.join(' ')}\ndracut: *** Including module: bash ***\ndracut: *** Including module: systemd ***\ndracut: *** Including module: kernel-modules ***\ndracut: *** Including module: rootfs-block ***\ndracut: *** Including module: udev-rules ***\n(… gekürzt …)\ndracut: *** Creating image file '${p}' ***\ndracut: *** Creating initramfs image file '${p}' done ***` : '');
  };
  b.mkinitrd = (w, a, i, r) => {
    if (w.distro !== 'alma') return nichtDa('mkinitrd', '');
    const frei = a.filter((x) => !x.startsWith('-'));
    if (frei.length < 2) return fehler('usage: mkinitrd [--version] [--help] [-v] [-f] [--preload <module>]\n       [--image-version] [--with=<module>]\n       [--nocompress]\n       <initrd-image> <kernel-version>\n\n(ex: mkinitrd /boot/initramfs-$(uname -r).img $(uname -r))');
    return b.dracut(w, ['-f', ...frei.slice(0, 2)], i, r);
  };
  b.lsinitrd = (w, a) => {
    if (w.distro !== 'alma') return nichtDa('lsinitrd', '');
    basis(w);
    const p = a.find((x) => !x.startsWith('-')) ?? `/boot/initramfs-${w.kernel}.img`;
    const c = w.fs[K.pfad(w, p)];
    if (typeof c !== 'string') return fehler(`No <initramfs file> specified and the default image '${p}' cannot be accessed!`);
    let e: { p: string }[] = []; try { e = c.startsWith(CPIO) ? JSON.parse(c.slice(CPIO.length)) : JSON.parse(initrdInhalt(w, w.kernel, true).slice(CPIO.length)); } catch { e = []; }
    return ok(`Image: ${p}: 34M\n${'='.repeat(72)}\nEarly CPIO image\n${'='.repeat(72)}\ndrwxr-xr-x   3 root     root            0 May  7 09:40 kernel\n${'='.repeat(72)}\nVersion: dracut-057-53.git20240104.el9\n\nArguments: --kver '${w.kernel}' -f\n\ndracut modules:\nbash\nsystemd\nkernel-modules\nrootfs-block\nudev-rules\nbase\n${'='.repeat(72)}\n${e.map((x) => x.p).join('\n')}\n${'='.repeat(72)}`);
  };
  b.installkernel = (w, a, _i, root) => {
    if (a.length < 2) return fehler('Usage: installkernel <version> <image> [<System.map> <directory>]');
    if (!root) return fehler(`cp: reguläre Datei '/boot/vmlinuz-${a[0]}' kann nicht angelegt werden: Keine Berechtigung`);
    const c = w.fs[K.pfad(w, a[1])]; if (typeof c !== 'string') return fehler(`installkernel: ${a[1]}: Datei oder Verzeichnis nicht gefunden`);
    return ok(kernelInstallieren(w, a[0], c, ''));
  };

  // ---- sysctl ----
  b.sysctl = (w, a, _i, root) => {
    basis(w);
    const f = new Set<string>(); const args: string[] = []; let datei2: string | null = null;
    for (let i = 0; i < a.length; i++) {
      const x = a[i];
      if (x === '-p' || x === '--load') { f.add('p'); if (a[i + 1] && !a[i + 1].startsWith('-')) datei2 = a[++i]; }
      else if (x.startsWith('-p') && x.length > 2) { f.add('p'); datei2 = x.slice(2); }
      else if (x.startsWith('--load=')) { f.add('p'); datei2 = x.slice(7); }
      else if (x === '--system') f.add('system');
      else if (x === '-a' || x === '-A' || x === '-X' || x === '--all') f.add('a');
      else if (x.startsWith('--')) f.add(x.slice(2));
      else if (/^-[a-zA-Z]+$/.test(x)) for (const c of x.slice(1)) f.add(c);
      else args.push(x);
    }
    const nurWert = f.has('n') || f.has('values'); const nurName = f.has('N') || f.has('names'); const still = f.has('q') || f.has('quiet');
    const zeige = (k: string) => { const v = (w.fs[sysPfad(k)] ?? '').replace(/\n$/, ''); return nurWert ? v : nurName ? k : `${k} = ${v}`; };
    if (f.has('system')) return ok(sysctlSystem(w, !still));
    if (f.has('p')) {
      const p = datei2 ? K.pfad(w, datei2) : '/etc/sysctl.conf';
      const t = lies(w, p); if (t === null) return fehler(`sysctl: »${datei2 ?? '/etc/sysctl.conf'}« kann nicht geöffnet werden: Datei oder Verzeichnis nicht gefunden`);
      const z: string[] = []; let code = 0;
      for (const [k, v, ign] of sysctlZeilen(t)) { const e = sysctlSchreiben(w, k, v, root); if (e) { if (!ign) { z.push(e); code = 255; } } else if (!still) z.push(`${k} = ${v}`); }
      return { out: z.filter((x) => !x.startsWith('sysctl:')).join('\n'), err: z.filter((x) => x.startsWith('sysctl:')).join('\n') || undefined, code };
    }
    if (f.has('a') || (!args.length && f.has('r'))) {
      const alle = Object.keys(w.fs).filter((p) => p.startsWith('/proc/sys/') && typeof w.fs[p] === 'string' && (meta(w, p).mode & 0o444)).map(sysKey).sort();
      const ri = a.indexOf('-r'); const muster = ri >= 0 ? new RegExp(a[ri + 1] ?? '') : null;
      return ok(alle.filter((k) => !muster || muster.test(k)).map(zeige).join('\n'));
    }
    if (!args.length) return fehler('\nUsage:\n sysctl [options] [variable[=value] ...]\n\nOptions:\n  -a, --all            display all variables\n  -n, --values         print only values of the given variable(s)\n  -N, --names          print variable names without values\n  -p, --load[=<file>]  read values from file\n  -w, --write          enable writing a value to variable\n      --system         read values from all system directories\n  -q, --quiet          do not echo variable set', 255);
    const out: string[] = []; const err: string[] = [];
    for (const x of args) {
      const i = x.indexOf('=');
      if (i > 0) { const k = x.slice(0, i).replace(/\//g, '.'); const v = x.slice(i + 1).trim().replace(/\s+/g, '\t'); const e = sysctlSchreiben(w, k, v, root); if (e) err.push(e); else if (!still) out.push(`${k} = ${v}`); continue; }
      if (f.has('w')) { err.push(`sysctl: »${x}« muss die Form Name=Wert haben`); continue; }
      const k = x.replace(/\//g, '.'); const p = sysPfad(k);
      if (w.fs[p] === null) { const unter = Object.keys(w.fs).filter((q) => q.startsWith(p + '/') && typeof w.fs[q] === 'string').map(sysKey).sort(); out.push(...unter.map(zeige)); continue; }
      if (!(p in w.fs)) { err.push(`sysctl: der Aufruf von stat für ${p} ist nicht möglich: Datei oder Verzeichnis nicht gefunden`); continue; }
      out.push(zeige(k));
    }
    return { out: out.join('\n'), err: err.length ? err.join('\n') : undefined, code: err.length ? 255 : 0 };
  };

  // ---- Hardware ----
  b.lsusb = mit('lsusb', (w, a, i, r) => {
    const x = alt.lsusb(w, a, i, r); const st = ks(w);
    if (!st.sensor || x.code) return x;
    const treiber = w.geladen[LAB] ? LAB : '[none]';
    if (a.includes('-t')) return ok(x.out.replace(/(\|__ Port 5: .*)$/m, `$1\n    |__ Port 6: Dev 6, If 0, Class=Vendor Specific Class, Driver=${treiber}, 12M`));
    const si = a.indexOf('-s'); const di = a.indexOf('-d');
    const passt = (si < 0 || /^0*0*1:0*6$|^:?0*6$/.test(a[si + 1] ?? '')) && (di < 0 || '1209:0001'.startsWith(a[di + 1] ?? ''));
    if (!passt) return x;
    const zeile = `Bus 001 Device 006: ID 1209:0001 Generic pid.codes Test PID${a.includes('-v') ? '\n  bDeviceClass 0 [unknown]\n  idVendor 0x1209 Generic\n  idProduct 0x0001 pid.codes Test PID\n  iManufacturer 1 Labor Mess GmbH\n  iProduct 2 Messbox LS-2\n  iSerial 3 LS2-26-0042\n  bInterfaceClass 255 Vendor Specific Class' : ''}`;
    if (si >= 0 || di >= 0) return ok(zeile);
    return ok(x.out.replace(/(Bus 001 Device 005: [^\n]*(?:\n  [^\n]*)*)/, `$1\n${zeile}`));
  });
  b.dmesg = mit('dmesg', (w, a, i, r) => {
    const x = alt.dmesg(w, a, i, r); if (x.code) return x;
    const st = ks(w);
    let t = x.out.replace(/6\.1\.0-27-amd64/g, w.kernel);
    if (st.infos[w.kernel] && !BAU_INFO[w.kernel]) t = t.replace(/\(debian-kernel@lists\.debian\.org\) \(gcc-12[^)]*\) 12\.2\.0\) #1 SMP PREEMPT_DYNAMIC Debian 6\.1\.115-1/, `(lena@${w.host}) (gcc (Debian 12.2.0-14+deb12u1) 12.2.0) ${st.infos[w.kernel]}`);
    let extra = st.dmesg;
    const li = a.findIndex((y) => y === '-l' || y.startsWith('--level'));
    if (li >= 0) extra = extra.filter((z) => /unknown parameter|taints|verification failed|version magic|Unknown symbol/.test(z));
    if (a.includes('-T')) extra = extra.map((z) => z.replace(/^\[\s*(\d+)\.\d+\]/, (_m, s) => `[Mo Nov 23 ${String(8 + Math.floor(Number(s) / 3600)).padStart(2, '0')}:${String(12 + Math.floor((Number(s) % 3600) / 60)).padStart(2, '0') }:${String(Number(s) % 60).padStart(2, '0')} 2026]`));
    if (a.includes('-C') || a.includes('-c')) st.dmesg = [];
    return ok([t, ...extra].filter(Boolean).join('\n'));
  });
  b.lsdev = (w) => {
    if (!hat(w, '/usr/bin/lsdev')) return nichtDa('lsdev', 'procinfo');
    basis(w);
    const g: Record<string, { dma: string; irq: string[]; io: string[] }> = {};
    const e = (n: string) => (g[n] ??= { dma: '', irq: [], io: [] });
    for (const z of (w.fs['/proc/interrupts'] ?? '').split('\n').slice(1)) { const m = z.match(/^\s*(\d+):.*\s(\S+)\s*$/); if (m) e(m[2]).irq.push(m[1]); }
    for (const z of (w.fs['/proc/ioports'] ?? '').split('\n')) { const m = z.match(/^\s*([0-9a-f]+-[0-9a-f]+) : (.+)$/); if (m && !m[2].startsWith('PCI')) e(m[2].trim()).io.push(m[1]); }
    for (const z of (w.fs['/proc/dma'] ?? '').split('\n')) { const m = z.match(/^\s*(\d+): (.+)$/); if (m) e(m[2].trim()).dma = m[1]; }
    return ok('Device            DMA   IRQ  I/O Ports\n------------------------------------------------\n' + Object.keys(g).sort().map((n) => `${n.padEnd(18)}${g[n].dma.padStart(3)}${g[n].irq.join(' ').padStart(6)}   ${g[n].io.join('   ')}`.trimEnd()).join('\n'));
  };
  b.lshw = (w, a, _i, root) => {
    if (!hat(w, '/usr/bin/lshw')) return nichtDa('lshw', 'lshw');
    basis(w);
    const warn = root ? '' : 'WARNING: you should run this program as super-user.\n';
    const st = ks(w);
    const ci = a.findIndex((x) => x === '-C' || x === '-c' || x === '-class' || x === '--class'); const klasse = ci >= 0 ? a[ci + 1] : null;
    const geraete: [string, string, string, string][] = [
      ['', '', 'system', 'Desktop Computer'], ['/0', '', 'bus', 'Motherboard'], ['/0/0', '', 'memory', '16GiB System Memory'], ['/0/1', '', 'processor', 'Intel(R) Core(TM) i5-8500 CPU @ 3.00GHz'],
      ['/0/100/2', '/dev/fb0', 'display', 'CoffeeLake-S GT2 [UHD Graphics 630]'], ['/0/100/14', '', 'bus', 'Cannon Lake PCH USB 3.1 xHCI Host Controller'], ['/0/100/14/0/2', '', 'input', 'Unifying Receiver'], ['/0/100/14/0/3', 'scsi0', 'storage', 'Ultra Fit'], ['/0/100/14/0/4', '', 'multimedia', 'Webcam C270'],
      ...(st.sensor ? [['/0/100/14/0/6', '', 'generic', 'Messbox LS-2'] as [string, string, string, string]] : []),
      ['/0/100/17', '', 'storage', 'Cannon Lake PCH SATA AHCI Controller'], ['/0/100/1d/0', '/dev/nvme0', 'storage', 'Samsung SSD 970 EVO Plus 500GB'], ['/0/100/1d/0/0/1', '/dev/nvme0n1', 'disk', '500GB NVMe disk'],
      ['/0/100/1f.3', 'card0', 'multimedia', 'Cannon Lake PCH cAVS'], ['/0/100/1f.6', 'enp0s31f6', 'network', 'Ethernet Connection (7) I219-V'], ['/0/100/1c/0', 'wlp2s0', 'network', 'Wi-Fi 6 AX200'],
    ];
    if (a.includes('-short')) {
      const l = klasse ? geraete.filter((x) => x[2] === klasse) : geraete;
      const bp = Math.max(8, ...l.map((x) => x[0].length)) + 2; const bd = Math.max(6, ...l.map((x) => x[1].length)) + 2;
      return ok(warn + `${'H/W path'.padEnd(bp)}${'Device'.padEnd(bd)}${'Class'.padEnd(15)}Description\n` + '='.repeat(bp + bd + 15 + 24) + '\n' + l.map(([p, d, c, t]) => `${p.padEnd(bp)}${d.padEnd(bd)}${c.padEnd(15)}${t}`).join('\n'));
    }
    if (klasse === 'network') return ok(warn + `  *-network\n       description: Ethernet interface\n       product: Ethernet Connection (7) I219-V\n       vendor: Intel Corporation\n       physical id: 1f.6\n       bus info: pci@0000:00:1f.6\n       logical name: enp0s31f6\n       version: 10\n       serial: 3c:7c:3f:1a:2b:4d\n       size: 1Gbit/s\n       capacity: 1Gbit/s\n       width: 32 bits\n       clock: 33MHz\n       capabilities: pm msi bus_master cap_list ethernet physical tp 10bt 10bt-fd 100bt 100bt-fd 1000bt-fd autonegotiation\n       configuration: autonegotiation=on broadcast=yes driver=e1000e driverversion=${w.kernel} duplex=full firmware=0.4-4 ip=192.168.1.23 latency=0 link=yes multicast=yes port=twisted pair speed=1Gbit/s\n       resources: irq:125 memory:d1300000-d131ffff\n  *-network\n       description: Wireless interface\n       product: Wi-Fi 6 AX200\n       vendor: Intel Corporation\n       bus info: pci@0000:02:00.0\n       logical name: wlp2s0\n       configuration: broadcast=yes driver=iwlwifi driverversion=${w.kernel} firmware=77.f92b5fed.0 cc-a0-77.ucode latency=0 link=no multicast=yes wireless=IEEE 802.11\n       resources: irq:16 memory:d1000000-d1003fff`);
    if (klasse) return ok(warn + geraete.filter((x) => x[2] === klasse).map(([p, d, c, t]) => `  *-${c}\n       description: ${t}\n       physical id: ${p.split('/').pop()}${d ? `\n       logical name: ${d}` : ''}`).join('\n'));
    return ok(warn + `${w.host}\n    description: Desktop Computer\n    width: 64 bits\n    capabilities: smbios-3.2.1 dmi-3.2.1 smp vsyscall32\n  *-core\n       description: Motherboard\n     *-memory\n          description: System Memory\n          size: 16GiB\n     *-cpu\n          product: Intel(R) Core(TM) i5-8500 CPU @ 3.00GHz\n          vendor: Intel Corp.\n          size: 3000MHz\n          configuration: cores=6 enabledcores=6 threads=6\n(… gekürzt. Übersichtlicher: lshw -short, nur eine Klasse: lshw -C network …)`);
  };

  // ---- udev ----
  b.udevadm = (w, a, _i, root) => {
    basis(w);
    const st = ks(w); const [sub, ...r] = a;
    const geraetArg = () => { const ni = r.findIndex((x) => x === '-n' || x === '--name'); const pi = r.findIndex((x) => x === '-p' || x === '--path'); const lang = r.find((x) => x.startsWith('--name=') || x.startsWith('--path=')); return ni >= 0 ? r[ni + 1] : pi >= 0 ? r[pi + 1] : lang ? lang.split('=')[1] : r.find((x) => !x.startsWith('-') && !['property', 'path', 'name', 'symlink', 'all'].includes(x)); };
    const istSensor = (x: string | undefined) => !!x && (/^(\/dev\/)?labsensor0$/.test(x) || /labsensor0$/.test(x) || st.links.some((l) => x === '/dev/' + l || x === l));
    if (!sub || sub === '--help' || sub === '-h') return ok('udevadm [--help] [--version] [--debug] COMMAND [COMMAND OPTIONS]\n\nSend control commands or test the device manager.\n\nCommands:\n  info          Query sysfs or the udev database\n  trigger       Request events from the kernel\n  settle        Wait for pending udev events\n  control       Control the udev daemon\n  monitor       Listen to kernel and udev events\n  test          Test an event run\n  test-builtin  Test a built-in command');
    if (sub === '--version') return ok('252');
    if (sub === 'info') {
      const g = geraetArg();
      if (!g) return fehler('Bad request.');
      if (!istSensor(g) || !sensorDa(w)) return fehler(`Unknown device "${g}": No such device`);
      const k = kette(); const ich = k[0];
      if (r.includes('-a') || r.includes('--attribute-walk')) {
        const bl = (x: Geraet, eltern: boolean) => `  looking at ${eltern ? 'parent ' : ''}device '${x.devpath}':\n    ${eltern ? 'KERNELS' : 'KERNEL'}=="${x.kernel}"\n    ${eltern ? 'SUBSYSTEMS' : 'SUBSYSTEM'}=="${x.subsystem}"\n    ${eltern ? 'DRIVERS' : 'DRIVER'}=="${x.driver}"\n${Object.entries(x.attr).map(([kk, v]) => `    ${eltern ? 'ATTRS' : 'ATTR'}{${kk}}=="${v}"`).join('\n')}`;
        return ok(`\nUdevadm info starts with the device specified by the devpath and then\nwalks up the chain of parent devices. It prints for every device\nfound, all possible attributes in the udev rules key format.\nA rule to match, can be composed by the attributes of the device\nand the attributes from one single parent device.\n\n${k.filter((x) => x.subsystem).map((x, j) => bl(x, j > 0)).join('\n\n')}\n`);
      }
      const m = meta(w, '/dev/labsensor0');
      const env = [`DEVPATH=${ich.devpath}`, 'DEVNAME=/dev/labsensor0', 'MAJOR=240', 'MINOR=0', 'SUBSYSTEM=labsensor', 'USEC_INITIALIZED=24131887', ...(st.links.length ? [`DEVLINKS=${st.links.map((l) => '/dev/' + l).join(' ')}`] : [])];
      const qi = r.findIndex((x) => x === '-q' || x === '--query'); const q = qi >= 0 ? r[qi + 1] : r.find((x) => x.startsWith('--query='))?.split('=')[1];
      if (q === 'property') return ok(env.join('\n'));
      if (q === 'path') return ok(ich.devpath);
      if (q === 'name') return ok('labsensor0');
      if (q === 'symlink') return ok(st.links.join(' '));
      void m;
      return ok([`P: ${ich.devpath}`, 'M: labsensor0', 'R: 0', 'U: labsensor', 'D: c 240:0', 'N: labsensor0', 'L: 0', ...st.links.map((l) => `S: ${l}`), ...env.map((x) => `E: ${x}`)].join('\n'));
    }
    if (sub === 'control') {
      if (!root) return fehler('Failed to send reload request: Permission denied');
      if (r.some((x) => /^(-R|--reload|--reload-rules)$/.test(x))) return ok();
      return ok();
    }
    if (sub === 'settle') return ok();
    if (sub === 'trigger') {
      if (!root) return fehler(st.sensor ? `Failed to write 'change' to '/sys${kette()[0].devpath}/uevent': Permission denied` : '');
      const ai = r.find((x) => x.startsWith('--action=')); const aktion = ai ? ai.split('=')[1] : r.includes('-c') ? r[r.indexOf('-c') + 1] : 'change';
      const sm = r.find((x) => x.startsWith('--subsystem-match='))?.split('=')[1] ?? (r.includes('-s') ? r[r.indexOf('-s') + 1] : null);
      if (sm && !glob(sm, 'labsensor')) return ok();
      geraetPruefen(w, aktion);
      return ok(r.includes('-v') || r.includes('--verbose') ? (sensorDa(w) ? `/sys${kette()[0].devpath}` : '') : '');
    }
    if (sub === 'test') {
      const g = r.find((x) => !x.startsWith('-'));
      if (!g) return fehler('syspath parameter missing.');
      if (!/labsensor0$/.test(g) || !sensorDa(w)) return fehler(`Failed to open device '${g}': No such device`);
      const ai = r.find((x) => x.startsWith('--action=')); const aktion = ai ? ai.split('=')[1] : r.includes('-a') ? r[r.indexOf('-a') + 1] : 'add';
      const res = udevAuswerten(w, aktion);
      const dateien = regelDateien(w);
      return ok(`This program is for debugging only, it does not run any program\nspecified by a RUN key. It may show incorrect results, because\nsome values may be different, or not available at a simulation run.\n\nLoad module index\n${dateien.map((p) => `Reading rules file: ${p}`).join('\n')}\n${res.fehler.join('\n')}${res.fehler.length ? '\n' : ''}${res.log.join('\n')}${res.log.length ? '\n' : ''}labsensor0: Handling device node '/dev/labsensor0', devnum=c240:0, mode=0${res.mode.toString(8)}, uid=${res.owner === 'root' ? 0 : 1000}, gid=${res.group === 'root' ? 0 : res.group === 'messteam' ? 1002 : 100}\n${res.links.map((l) => `labsensor0: Creating symlink '/dev/${l}' to '${'../'.repeat(l.split('/').length - 1)}labsensor0'`).join('\n')}${res.links.length ? '\n' : ''}DEVPATH=${kette()[0].devpath}\nDEVNAME=/dev/labsensor0\nSUBSYSTEM=labsensor\nACTION=${aktion}\nMAJOR=240\nMINOR=0\n${res.links.length ? `DEVLINKS=${res.links.map((l) => '/dev/' + l).join(' ')}\n` : ''}${res.run.map((x) => `run: '${x}'`).join('\n')}${res.run.length ? '\n' : ''}Unload module index`);
    }
    if (sub === 'monitor') {
      const nurK = r.includes('-k') || r.includes('--kernel'); const nurU = r.includes('-u') || r.includes('--udev');
      const prop = r.includes('-p') || r.includes('--property');
      const kopf = `monitor will print the received events for:\n${nurK ? '' : 'UDEV - the event which udev sends out after rule processing\n'}${nurU ? '' : 'KERNEL - the kernel uevent\n'}`;
      (w as Welt & { langlaeufer: string | null }).langlaeufer = 'udevadm';
      if (!st.sensor) return ok(`${kopf}\n(Es passiert nichts: Gerade wird kein Gerät angesteckt oder entfernt. Strg+C beendet udevadm monitor.)`);
      const mit = !!w.geladen[LAB];
      const ev: [string, string, string][] = [
        ...(mit ? [['remove', kette()[0].devpath, 'labsensor'] as [string, string, string]] : []),
        ...(mit ? [['unbind', `${USB_PFAD}/1-6/1-6:1.0`, 'usb'] as [string, string, string]] : []),
        ['remove', `${USB_PFAD}/1-6/1-6:1.0`, 'usb'], ['unbind', `${USB_PFAD}/1-6`, 'usb'], ['remove', `${USB_PFAD}/1-6`, 'usb'],
        ['add', `${USB_PFAD}/1-6`, 'usb'], ['add', `${USB_PFAD}/1-6/1-6:1.0`, 'usb'],
        ...(mit ? [['add', kette()[0].devpath, 'labsensor'] as [string, string, string], ['bind', `${USB_PFAD}/1-6/1-6:1.0`, 'usb'] as [string, string, string]] : []),
        ['bind', `${USB_PFAD}/1-6`, 'usb'],
      ];
      let t = 3412.5;
      const zeilen: string[] = [];
      for (const [ak, p, sub2] of ev) {
        t += 0.0031;
        const props = prop ? `\nACTION=${ak}\nDEVPATH=${p}\nSUBSYSTEM=${sub2}\n${sub2 === 'labsensor' ? 'DEVNAME=/dev/labsensor0\nMAJOR=240\nMINOR=0\n' : p.endsWith('1-6') ? 'DEVTYPE=usb_device\nPRODUCT=1209/1/100\n' : 'DEVTYPE=usb_interface\nMODALIAS=usb:v1209p0001d0100dc00dsc00dp00icFFisc00ip00in00\n'}SEQNUM=${5200 + zeilen.length}\n` : '';
        if (!nurU) zeilen.push(`KERNEL[${t.toFixed(6)}] ${ak.padEnd(8)} ${p} (${sub2})${props}`);
        if (!nurK) zeilen.push(`UDEV  [${(t + 0.0127).toFixed(6)}] ${ak.padEnd(8)} ${p} (${sub2})${props}`);
      }
      meld(w, 'usb 1-6: USB disconnect, device number 6', 'usb 1-6: new full-speed USB device number 7 using xhci_hcd', 'usb 1-6: New USB device found, idVendor=1209, idProduct=0001, bcdDevice= 1.00', 'usb 1-6: Product: Messbox LS-2');
      geraetPruefen(w, 'add');
      return ok(`(Der Simulator spielt vor, dass du die Messbox jetzt absteckst und wieder ansteckst. Strg+C beendet udevadm monitor.)\n${kopf}\n${zeilen.join('\n')}`);
    }
    return fehler(`Unknown command verb '${sub}'.`);
  };
  b.udevmonitor = () => fehler('bash: udevmonitor: Befehl nicht gefunden\n(udevmonitor ist der alte Name. Heute heißt es: udevadm monitor)', 127);

  // ---- Pakete aus deb-pkg ----
  b.dpkg = (w, a, i, r) => {
    const ii = a.findIndex((x) => x === '-i' || x === '--install');
    if (ii < 0 || !kernAktiv(w)) return alt.dpkg(w, a, i, r);
    const dateien = a.slice(ii + 1).filter((x) => !x.startsWith('-'));
    const kern = dateien.map((d) => ({ d, c: w.fs[K.pfad(w, d)] })).filter((x) => typeof x.c === 'string' && x.c.startsWith('\u0007DEB:'));
    if (!kern.length) return alt.dpkg(w, a, i, r);
    if (!r) return fehler('dpkg: error: requested operation requires superuser privilege');
    const out: string[] = []; const nach: string[] = [];
    for (const { d, c } of kern.sort((x, y) => (x.c!.includes(':headers:') ? -1 : y.c!.includes(':headers:') ? 1 : 0))) {
      const art = c!.split(':')[1]; const j = JSON.parse(c!.slice(`\u0007DEB:${art}:`.length)) as { rel: string; mods: string[]; fest: string[]; info: string; konfig: string; vers: string };
      const name = art === 'image' ? `linux-image-${j.rel}` : art === 'headers' ? `linux-headers-${j.rel}` : 'linux-libc-dev';
      out.push(`Selecting previously unselected package ${name}.`, '(Reading database ... 182340 files and directories currently installed.)', `Preparing to unpack .../${d.split('/').pop()} ...`, `Unpacking ${name} (${j.vers}) ...`);
      if (art === 'headers') { const h = `/usr/src/linux-headers-${j.rel}`; ordnerAnlegen(w, h); datei(w, `${h}/Makefile`, makefile('65')); datei(w, `${h}/.config`, j.konfig); ordnerAnlegen(w, `/lib/modules/${j.rel}`); datei(w, `/lib/modules/${j.rel}/build`, '-> ' + h, 0o777); }
      if (art === 'image') { ks(w).infos[j.rel] = j.info; modulesInstall(w, '', j.rel, j.mods, j.fest, `/usr/src/linux-headers-${j.rel}`); if (!(`/usr/src/linux-headers-${j.rel}` in w.fs)) delete w.fs[`/lib/modules/${j.rel}/build`]; }
      K.paketExtra(w, name, j.vers, art === 'image' ? `Linux kernel, version ${j.rel}` : art === 'headers' ? `Linux kernel headers for ${j.rel} on amd64` : 'Linux support headers for userspace development', []);
      out.push(`Setting up ${name} (${j.vers}) ...`);
      if (art === 'image') nach.push(kernelInstallieren(w, j.rel, kernelBild(8300000, `${j.rel} (lena@${w.host}) ${j.info}`), j.konfig));
      if (art === 'headers' && ks(w).dkms.hinzu && hat(w, '/usr/sbin/dkms')) nach.push(`/etc/kernel/header_postinst.d/dkms:\n${dkmsAuto(w, j.rel, true)}`);
    }
    return ok([...out, ...nach].join('\n'));
  };
  return b;
}
let befehleRef: Record<string, B> = {};
export function kernBefehleRef(b: Record<string, B>) { befehleRef = b; }

/** Ausführbare Dateien im Kernelbaum (scripts/config). */
export function kernProgramm(w: Welt, z: string, args: string[], root: boolean): Ergebnis | null {
  if (!z.endsWith('/scripts/config')) return null;
  const d = z.replace(/\/scripts\/config$/, '');
  if (!istBaum(w, d)) return null;
  const fi = args.indexOf('--file'); const ziel = fi >= 0 ? K.pfad(w, args[fi + 1]) : K.pfad(w, `${w.cwd}/.config`);
  const a = args.filter((_, j) => fi < 0 || (j !== fi && j !== fi + 1));
  if (!a.length) return fehler('Manipulate options in a .config file from the command line.\nUsage:\nconfig options command ...\ncommands:\n\t--enable|-e option   Enable option\n\t--disable|-d option  Disable option\n\t--module|-m option   Turn option into a module\n\t--set-str option string\n\t                     Set option to "string"\n\t--set-val option value\n\t                     Set option to value\n\t--undefine|-u option Undefine option\n\t--state|-s option    Print state of option (n,y,m,undef)', 1);
  const t = w.fs[ziel];
  if (typeof t !== 'string') return fehler(`grep: ${ziel.split('/').pop()}: Datei oder Verzeichnis nicht gefunden\n(Erst eine .config anlegen, zum Beispiel: cp /boot/config-$(uname -r) .config)`, 2);
  if (!darf(w, ziel, 'w', root) && !a.every((x, j) => x === '--state' || x === '-s' || a[j - 1] === '--state' || a[j - 1] === '-s')) return fehler(`sed: kann ${ziel} nicht öffnen: Keine Berechtigung`, 4);
  const k = konfigLesen(t); const zeilen: string[] = [];
  for (let i = 0; i < a.length; i++) {
    const c = a[i]; const n = (a[i + 1] ?? '').replace(/^CONFIG_/, '');
    const s = (v: string) => { setzen(k, n, v); i++; };
    if (c === '--enable' || c === '-e') s('y');
    else if (c === '--disable' || c === '-d') s(SYM[n]?.t === 'string' ? '' : 'n');
    else if (c === '--module' || c === '-m') s('m');
    else if (c === '--set-str') { setzen(k, n, a[i + 2] ?? ''); i += 2; }
    else if (c === '--set-val') { setzen(k, n, a[i + 2] ?? ''); i += 2; }
    else if (c === '--undefine' || c === '-u') { delete k[n]; i++; }
    else if (c === '--state' || c === '-s') { zeilen.push(n in k ? (SYM[n]?.t === 'string' ? k[n] : k[n]) : 'undef'); i++; }
    else if (c === '--keep-case' || c === '-k') continue;
    else return fehler(`bad command: ${c}`, 1);
  }
  if (a.some((x) => !['--state', '-s'].includes(x) && x.startsWith('-'))) datei(w, ziel, konfigText(k, version(w, d).ver), 0o664, meta(w, ziel).owner);
  return ok(zeilen.join('\n'));
}

// ---------- Welt vorbereiten ----------

export function kernStarten(w: Welt, o: KernOptionen) {
  if (w.distro === 'alma') {
    const alt = w.kernel; w.kernel = ALMA_K;
    for (const p of Object.keys(w.fs)) if (p.includes(alt)) { const n = p.replace(alt, ALMA_K).replace('/initrd.img-' + ALMA_K, '/initramfs-' + ALMA_K + '.img'); w.fs[n] = w.fs[p]; delete w.fs[p]; }
    w.fs['/proc/version'] = `Linux version ${ALMA_K} (mockbuild@x64-builder02.almalinux.org) (gcc (GCC) 11.4.1 20231218 (Red Hat 11.4.1-3), GNU ld version 2.35.2-43.el9) ${BAU_INFO[ALMA_K]}\n`;
    w.cmdline = `BOOT_IMAGE=(hd0,gpt2)/vmlinuz-${ALMA_K} root=/dev/mapper/almalinux-root ro crashkernel=1G-4G:192M,4G-64G:256M,64G-:512M resume=/dev/mapper/almalinux-swap rd.lvm.lv=almalinux/root rd.lvm.lv=almalinux/swap rhgb quiet`;
    w.fs['/proc/cmdline'] = w.cmdline + '\n';
    datei(w, `/boot/vmlinuz-${ALMA_K}`, kernelBild(13963320, `${ALMA_K} (mockbuild@x64-builder02.almalinux.org) ${BAU_INFO[ALMA_K]}`), 0o755);
    datei(w, `/boot/initramfs-${ALMA_K}.img`, '', 0o600);
    datei(w, `/boot/config-${ALMA_K}`, konfigText({ ...debKonfig(), KERNEL_XZ: 'n', KERNEL_ZSTD: 'y', SYSTEM_TRUSTED_KEYS: '' }, '5.14.0'));
    datei(w, '/usr/bin/dracut', '', 0o755); datei(w, '/usr/bin/lsinitrd', '', 0o755); datei(w, '/usr/bin/mkinitrd', '', 0o755);
    datei(w, '/etc/dracut.conf', '# Einstellungen für dracut. Eigene Ergänzungen besser nach /etc/dracut.conf.d/*.conf\n');
    ordnerAnlegen(w, '/etc/dracut.conf.d');
    if (w.pakete) w.pakete.installiert.dracut = 'ii';
  }
  basis(w);
  const st = ks(w);
  if (w.distro === 'debian') K.installieren(w, ['kmod', 'udev', 'procps', 'initramfs-tools', 'linux-image-6.1.0-27-amd64', 'linux-image-6.1.0-26-amd64', 'linux-image-amd64', 'xz-utils']);
  // Gruppe für die Messbox
  if (!/^messteam:/m.test(w.fs['/etc/group'] ?? '')) w.fs['/etc/group'] = (w.fs['/etc/group'] ?? '') + 'messteam:x:1002:lena\n';
  if (o.werkzeuge) K.installieren(w, ['build-essential', 'bc', 'bison', 'flex', 'libelf-dev', 'libssl-dev', 'libncurses-dev', 'dwarves', 'patch']);
  if (o.quelle) {
    datei(w, TARBALL, `${KOMP}xz:${TAR}${JSON.stringify(baumEintraege())}`, 0o644, 'lena');
    datei(w, `${DL}/linux-${ALT}.tar.sign`, '-----BEGIN PGP SIGNATURE-----\n(Signatur über das entpackte .tar, im Simulator gekürzt)\n-----END PGP SIGNATURE-----\n', 0o644, 'lena');
    datei(w, PATCHDATEI, `${KOMP}xz:${PATCH_TEXT}`, 0o644, 'lena');
    if (o.quelle !== 'download') {
      ordnerAnlegen(w, '/usr/src');
      baumAuspacken(w, BAUM, 'lena');
      w.fs[`${BAUM}/Makefile`] = makefile('65');
      datei(w, '/usr/src/linux', `-> linux-${ALT}`, 0o777);
    }
    if (o.quelle === 'konfiguriert' || o.quelle === 'gebaut') {
      const k: Konfig = { ...debKonfig(), LOCALVERSION: '-lab', SYSTEM_TRUSTED_KEYS: '' };
      for (const s of fehlend(k)) k[s.n] = s.std;
      datei(w, `${BAUM}/.config`, konfigText(k, NEU), 0o664, 'lena');
    }
    if (o.quelle === 'gebaut') bauen(w, { dir: BAUM, ziele: [], vars: {}, jobs: 6, leise: true, root: false }, 'alles');
  }
  if (o.sensor) st.sensor = true;
  if (o.dkms) {
    w.verfuegbar[LAB] = LABMODUL;
    datei(w, `${LABQ}/dkms.conf`, `PACKAGE_NAME="${LAB}"\nPACKAGE_VERSION="${LABV}"\nBUILT_MODULE_NAME[0]="${LAB}"\nDEST_MODULE_LOCATION[0]="/updates/dkms"\nAUTOINSTALL="yes"\n`);
    datei(w, `${LABQ}/Makefile`, `obj-m += ${LAB}.o\n\nKDIR ?= /lib/modules/$(shell uname -r)/build\n\nall:\n\t$(MAKE) -C $(KDIR) M=$(PWD) modules\n\nclean:\n\t$(MAKE) -C $(KDIR) M=$(PWD) clean\n\ninstall:\n\t$(MAKE) -C $(KDIR) M=$(PWD) modules_install\n`);
    datei(w, `${LABQ}/${LAB}.c`, `// SPDX-License-Identifier: GPL-2.0\n// Treiber für die Messbox LS-2 der Labor Mess GmbH (im Simulator gekürzt)\n#include <linux/module.h>\n#include <linux/usb.h>\n\nstatic unsigned int intervall = 1000;\nmodule_param(intervall, uint, 0644);\nMODULE_PARM_DESC(intervall, "Messintervall in Millisekunden");\n\nstatic const struct usb_device_id ls2_ids[] = {\n\t{ USB_DEVICE(0x1209, 0x0001) },\n\t{ }\n};\nMODULE_DEVICE_TABLE(usb, ls2_ids);\nMODULE_LICENSE("GPL");\nMODULE_VERSION("${LABV}");\n`);
    datei(w, `${LABQ}/README`, `Treiber für die Messbox LS-2\n\nMit DKMS installieren:\n  sudo dkms add ${LAB}/${LABV}\n  sudo dkms install ${LAB}/${LABV}\n\nVon Hand bauen (zum Testen):\n  make\n  sudo insmod ./${LAB}.ko\n`);
    if (o.dkms === 'installiert') {
      K.installieren(w, ['dkms', `linux-headers-${DEB_K}`]);
      kernNachApt(w);
      st.dkms.hinzu = true; datei(w, `/var/lib/dkms/${LAB}/${LABV}/source`, '-> ' + LABQ, 0o777);
      dkmsBauen(w, w.kernel); dkmsInstallieren(w, w.kernel);
      if (st.sensor) { w.geladen[LAB] = []; K.benutzer(w); st.dmesg = []; nachLaden(w, LAB, []); }
    }
  }
  if (o.regel === 'kaputt') datei(w, '/etc/udev/rules.d/70-messbox.rules', '# Messbox LS-2 für das Messteam (vom Kollegen, geht nicht)\nKERNEL="labsensor[0-9]*", GROUP="messteam", MODE="0660"\nSUBSYSTEM=="labsensor", ATTR{serial}=="LS2-26-0042", SYMLINK+="messbox-0042"\n');
  if (o.sysctlFluechtig) w.fs[sysPfad('net.ipv4.ip_forward')] = '1\n';
  if (o.fehlinstalliert && st.bau[BAUM]) { const b = st.bau[BAUM]; kernelInstallieren(w, b.release, w.fs[`${BAUM}/arch/x86/boot/bzImage`] ?? '', b.konfig); }
  if (o.tippfehler) { datei(w, '/etc/modprobe.d/e1000e.conf', '# Weniger Interrupts bei hoher Last (Kollege, Oktober)\noptions e1000e InterruptThrottelRate=3000\n'); meld(w, "e1000e: unknown parameter 'InterruptThrottelRate' ignored"); }
  if (st.sensor) geraetPruefen(w, 'add');
}

/** Nach apt: Header-Pakete verlinken, DKMS-Haken anlegen. */
export function kernNachApt(w: Welt): string {
  if (!w.pakete || w.distro !== 'debian') return '';
  const z: string[] = [];
  for (const [n, s] of Object.entries(w.pakete.installiert)) {
    const m = n.match(/^linux-headers-(\d.*-amd64)$/);
    if (s === 'ii' && m) {
      const h = `/usr/src/linux-headers-${m[1]}`;
      if (!(h in w.fs)) { ordnerAnlegen(w, h); datei(w, `${h}/Makefile`, makefile('115').replace(/PATCHLEVEL = 18/, 'PATCHLEVEL = 1').replace('SUBLEVEL = 115', 'SUBLEVEL = 115')); }
      if (!(`/lib/modules/${m[1]}/build` in w.fs)) {
        datei(w, `/lib/modules/${m[1]}/build`, '-> ' + h, 0o777);
        const st = (w as KW).kernstand;
        if (st?.dkms.hinzu && !st.dkms.inst.includes(m[1]) && hat(w, '/usr/sbin/dkms')) z.push(`/etc/kernel/header_postinst.d/dkms:\n${dkmsAuto(w, m[1], true)}`);
      }
    }
  }
  // Entfernte Kernel: initramfs, Module und GRUB-Eintrag aufräumen (Haken in /etc/kernel/postrm.d)
  for (const p of Object.keys(w.fs).filter((x) => /^\/boot\/initrd\.img-/.test(x))) {
    const v = p.slice('/boot/initrd.img-'.length);
    if (`/boot/vmlinuz-${v}` in w.fs) continue;
    delete w.fs[p]; loeschen(w, `/lib/modules/${v}`);
    z.push(`run-parts: executing /etc/kernel/postrm.d/initramfs-tools ${v} /boot/vmlinuz-${v}`, `update-initramfs: Deleting /boot/initrd.img-${v}`, `run-parts: executing /etc/kernel/postrm.d/zz-update-grub ${v} /boot/vmlinuz-${v}`, grubNeu(w));
  }
  if (w.pakete.installiert.dkms === 'ii') { if (!('/etc/kernel/postinst.d/dkms' in w.fs)) datei(w, '/etc/kernel/postinst.d/dkms', '#!/bin/sh\n# baut DKMS-Module für einen neu installierten Kernel (dkms autoinstall)\n', 0o755); ordnerAnlegen(w, '/var/lib/dkms'); }
  return z.join('\n');
}

// ---------- Prüfen ----------

export function zustandKern(w: Welt, s: string): boolean | undefined {
  let m;
  if (!/^(sysctl|sysctlstart|sysmod|modopt|kernel|kernelinst|initrd|dkms|udev|dep|baum|konfig|gebaut|taint|modulgeladen)[:=]/.test(s)) return undefined;
  if (!kernAktiv(w)) return false;
  const st = ks(w);
  if ((m = s.match(/^sysctl:([\w.-]+)=(.+)$/))) return (w.fs[sysPfad(m[1])] ?? '').trim().replace(/\s+/g, ' ') === m[2];
  if ((m = s.match(/^sysctlstart:([\w.-]+)=(.+)$/))) return (sysctlBeimStart(w, m[1]) ?? '').replace(/\s+/g, ' ') === m[2];
  if ((m = s.match(/^sysmod:(\w+)\.(\w+)=(.+)$/))) return (w.fs[`/sys/module/${m[1]}/parameters/${m[2]}`] ?? '').trim() === m[3];
  if ((m = s.match(/^kernel=(.+)$/))) return w.kernel === m[1];
  if ((m = s.match(/^kernelinst:(.+)$/))) { const v = m[1]; return hat(w, `/boot/vmlinuz-${v}`) && (w.fs[`/boot/vmlinuz-${v}`] ?? '').startsWith('\u0007KERNEL') && imDep(w, 'e1000e', v) || hat(w, `/boot/vmlinuz-${v}`) && eingebaut(w, v).has('e1000e'); }
  if ((m = s.match(/^initrd:(.+)=(mit|ohne|fehlt)$/))) { const im = initrdModule(w, m[1]); return m[2] === 'fehlt' ? im === null : m[2] === 'mit' ? !!im && im.includes('nvme') : !!im && !im.includes('nvme'); }
  if ((m = s.match(/^dkms:(added|built|installed)(?:@(.+))?$/))) { const k = m[2] ?? w.kernel; return m[1] === 'added' ? st.dkms.hinzu : m[1] === 'built' ? st.dkms.gebaut.includes(k) : st.dkms.inst.includes(k); }
  if ((m = s.match(/^udev:link=(.+)$/))) return st.links.includes(m[1]) && sensorDa(w);
  if ((m = s.match(/^udev:(gruppe|modus)=(.+)$/))) { if (!sensorDa(w)) return false; const x = meta(w, '/dev/labsensor0'); return m[1] === 'gruppe' ? x.group === m[2] : (x.mode & 0o777) === parseInt(m[2], 8); }
  if ((m = s.match(/^dep:(\w+)(?:@(.+))?$/))) return imDep(w, m[1], m[2] ?? w.kernel);
  if ((m = s.match(/^baum:(\d+\.\d+\.\d+)$/))) return istBaum(w, BAUM) && version(w, BAUM).ver === m[1];
  if ((m = s.match(/^konfig:(\w+)=(.*)$/))) { const k = konfigLesen(w.fs[`${BAUM}/.config`] ?? ''); return (k[m[1]] ?? 'undef') === m[2]; }
  if ((m = s.match(/^gebaut:(.+)$/))) return st.bau[BAUM]?.release === m[1] && st.bau[BAUM].kernel && st.bau[BAUM].module;
  if ((m = s.match(/^taint=(\d+)$/))) return st.taint === Number(m[1]);
  if ((m = s.match(/^modopt:(\w+)\.(\w+)=(.+)$/))) return !!w.geladen[m[1]] && st.param[m[1]]?.[m[2]] === m[3];
  if ((m = s.match(/^modulgeladen:(\w+)$/))) return !!w.geladen[m[1]];
  return undefined;
}
