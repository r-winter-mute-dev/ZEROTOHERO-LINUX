// Dateisysteme und Geräte für den Simulator (LPIC-2 Topic 203): /proc/mounts und /etc/mtab, Swap-Dateien mit
// Prioritäten, dumpe2fs, debugfs, Sicherungskopien des Superblocks, Btrfs mit Subvolumes und Snapshots,
// btrfs-convert, XFS mit xfs_info, xfsdump und xfsrestore, SMART mit smartctl und smartd, AutoFS mit
// auto.master und Maps, systemd-Automount, ISO-9660- und UDF-Abbilder mit Loop-Mount, LUKS mit cryptsetup.
// Ohne Welt-Option `dsys` bleibt alles wie bisher.
import type { Welt } from './shell';
import { meta } from './shell-dateien';
import { finden, nachKennung, neuesFs, fsBytes, menschGroesse, type Dateisystem, type Partition, type Einhaengung } from './shell-platten';

type Ergebnis = { out: string; err?: string; code: number };
type B = (w: Welt, a: string[], stdin: string, root: boolean) => Ergebnis;
const ok = (out = ''): Ergebnis => ({ out, code: 0 });
const fehler = (err: string, code = 1): Ergebnis => ({ out: '', err, code });

export interface FsKern {
  pfad: (w: Welt, p: string) => string;
  dialog: (w: Welt, prompt: string, weiter: (z: string) => string) => void;
}
let K: FsKern;
export function fsKern(k: FsKern) { K = k; }

export interface DsysOptionen {
  superblock?: boolean;     // primärer Superblock von /dev/sdb1 zerstört
  btrfs?: boolean;          // /dev/sdb4 mit Btrfs und Subvolumes
  smart?: 'gut' | 'warnung';
  autofs?: boolean;         // Paket autofs installiert
  autofsKaputt?: boolean;   // Map mit Tippfehler
  swapDatei?: 'fehlt' | 'rechte';
  luks?: boolean;           // /dev/sdb1 ist schon mit LUKS verschlüsselt
  nfs?: boolean;            // srv1 exportiert /srv/projekte und /home
  iso?: boolean;            // Material für ein ISO unter ~/handbuch
}

interface SwapDatei { uuid: string; label?: string }
interface AutoEintrag { mp: string; key: string; quelle: string; art: string; optionen: string; direkt: boolean }
interface DsysStand {
  opt: DsysOptionen;
  prio: Record<string, number>;
  swapDateien: Record<string, SwapDatei>;
  autofs: { laeuft: boolean; aktiviert: boolean; maps: AutoEintrag[]; indirekt: { mp: string; timeout: number; map: string }[] };
  automount: Record<string, string>;   // Where -> Mount-Unit (systemd)
  smartdConf: string | null;
  smartTest: string[];
  inventar: { id: string; label: string; quelle: string; level: number; datei: string }[];
}
type SW = Welt & { dsys?: DsysStand };
const st = (w: Welt): DsysStand => (w as SW).dsys!;
export const dsysAktiv = (w: Welt) => !!(w as SW).dsys;

function ordner(w: Welt, p: string) { const t = p.split('/').filter(Boolean); for (let i = 1; i <= t.length; i++) { const d = '/' + t.slice(0, i).join('/'); if (!(d in w.fs)) { w.fs[d] = null; const m = meta(w, d); m.mode = 0o755; m.owner = 'root'; m.group = 'root'; } } }
function datei(w: Welt, p: string, c: string, mode = 0o644, owner = 'root') { ordner(w, p.slice(0, p.lastIndexOf('/')) || '/'); w.fs[p] = c; const m = meta(w, p); m.mode = mode; m.owner = owner; m.group = owner; m.mtime = w.uhr; }
const bytesVon = (c: string | null | undefined) => { if (typeof c !== 'string') return 0; const m = c.match(/^\u0007(?:BIN|SWAP):(\d+)/); return m ? Number(m[1]) : c.length; };
function groesseLesen(s: string): number { const m = s.match(/^(\d+(?:\.\d+)?)([KMGT]?)i?B?$/i); if (!m) return NaN; return Math.round(Number(m[1]) * ({ '': 1, K: 1024, M: 1048576, G: 1073741824, T: 1099511627776 } as Record<string, number>)[m[2].toUpperCase()]); }
let zahl = 41;
const uuid = () => { const h = (n: number, l: number) => Array.from({ length: l }, (_, i) => '0123456789abcdef'[(n * 2654435761 + i * 40503) >>> (i % 13) & 15]).join(''); zahl += 7; return `${h(zahl, 8)}-${h(zahl + 1, 4)}-4${h(zahl + 2, 3)}-9${h(zahl + 3, 3)}-${h(zahl + 4, 12)}`; };

// ---------- Start ----------
const AUTO_MASTER = `#
# Sample auto.master file
# This is a 'master' automounter map and it has the following format:
# mount-point [map-type[,format]:]map [options]
# For details of the format look at auto.master(5).
#
#/misc	/etc/auto.misc
#
# NOTE: mounts done from a hosts map will be mounted with the
#	"nosuid" and "nodev" options unless the "suid" and "dev"
#	options are explicitly given.
#
#/net	-hosts
#
# Include /etc/auto.master.d/*.autofs
# To add an extra map using this mechanism you will need to add
# two configuration items - one /etc/auto.master.d/extra.autofs file
# (using the same line format as the auto.master file)
# and a separate mount map (e.g. /etc/auto.extra or an auto.extra NIS map)
# that will be called upon to create the mount.
#
+dir:/etc/auto.master.d
`;
const AUTO_MISC = `#
# This is an automounter map and it has the following format
# key [ -mount-options-separated-by-comma ] location
# Details may be found in the autofs(5) manpage

cd		-fstype=iso9660,ro,nosuid,nodev	:/dev/cdrom

# the following entries are samples to pique your imagination
#linux		-ro,soft		ftp.example.org:/pub/linux
#boot		-fstype=ext2		:/dev/hda1
#floppy		-fstype=auto		:/dev/fd0
#e2floppy	-fstype=ext2		:/dev/fd0
#jaz		-fstype=ext2		:/dev/sdc1
#removable	-fstype=ext2		:/dev/hdd
`;
const SMARTD_CONF = `# Sample configuration file for smartd.  See man smartd.conf.

# Home page is: https://www.smartmontools.org

# smartd will re-read the configuration file if it receives a HUP
# signal

# The file gives a list of devices to monitor using smartd, with one
# device per line. Text after a hash (#) is ignored, and you may use
# spaces and tabs for white space. You may use '\\' to continue lines.

# The word DEVICESCAN will cause any remaining lines in this
# configuration file to be ignored: it tells smartd to scan for all
# ATA and SCSI devices.  DEVICESCAN may be followed by any of the
# Directives listed below, which will be applied to all devices that
# are found.  Most users should comment out DEVICESCAN and explicitly
# list the devices that they wish to monitor.
DEVICESCAN -d removable -n standby -m root -M exec /usr/share/smartmontools/smartd-runner
`;

// NFS-Freigaben auf srv1, die AutoFS einhängen kann
const NFS: Record<string, Record<string, string | null>> = {
  'srv1:/srv/projekte': { '/messreihe-a': null, '/messreihe-a/protokoll.txt': 'Messreihe A, Start 03.11.2026\n', '/messreihe-b': null, '/messreihe-b/protokoll.txt': 'Messreihe B, Start 17.11.2026\n', '/LIESMICH.txt': 'Freigabe des Messteams auf srv1\n' },
  'srv1:/home/lena': { '/notizen.txt': 'Notizen von Lena auf srv1\n', '/auswertung.ods': '\u0007BIN:48211' },
  'srv1:/home/max': { '/skript.sh': '#!/bin/bash\necho Hallo von max\n' },
};

export function dsysStarten(w: Welt, o: DsysOptionen) {
  const s: DsysStand = { opt: o, prio: {}, swapDateien: {}, autofs: { laeuft: false, aktiviert: false, maps: [], indirekt: [] }, automount: {}, smartdConf: null, smartTest: [], inventar: [] };
  (w as SW).dsys = s;
  datei(w, '/etc/mtab', '-> ../proc/self/mounts', 0o777);
  datei(w, '/etc/smartd.conf', SMARTD_CONF);
  s.smartdConf = SMARTD_CONF;
  const pl = w.platten!;
  const sdb = pl.platten.find((x) => x.name === 'sdb');
  // Das Archiv auf /dev/sdb3 (XFS) bekommt Inhalt
  const archiv = sdb?.partitionen[2]?.fs;
  if (archiv?.art === 'xfs' && !Object.keys(archiv.dateien).length) {
    archiv.dateien = { '/2024': null, '/2024/messreihe-2024.csv': '\u0007BIN:7340032', '/2025': null, '/2025/messreihe-2025.csv': '\u0007BIN:9437184', '/2025/bericht-2025.pdf': '\u0007BIN:1258291', '/LIESMICH.txt': 'Archiv der Messreihen. Nur lesen, nicht ändern.\n' };
    archiv.metas = {};
  }
  ordner(w, '/dev/mapper'); datei(w, '/dev/mapper/control', '', 0o600);
  if (o.superblock && sdb?.partitionen[0]?.fs) sdb.partitionen[0].fs.superKaputt = true;
  if (o.btrfs && sdb) {
    const p: Partition = { nr: 4, start: 323993600, ende: 488397134, typ: 'Linux-Dateisystem', partuuid: 'c0ffee04-1111-4222-8333-444455556664' };
    const fs = neuesFs('btrfs', w.uhr - 86400000 * 30, 'projekte', '7d1e2f3a-4b5c-4d6e-8f70-81a2b3c4d5e6');
    fs.dateien = { '/@daten': null, '/@daten/messreihe-a.csv': '\u0007BIN:2097152', '/@daten/messreihe-b.csv': '\u0007BIN:1048576', '/@daten/auswertung.ods': '\u0007BIN:524288', '/@home': null, '/@home/lena': null, '/@home/lena/notizen.txt': 'Messreihe C startet am Montag.\n' };
    fs.metas = {};
    fs.zusatz = { subvols: [{ id: 256, pfad: '@daten', uuid: 'a1b2c3d4-0256-4e5f-8a9b-c0d1e2f3a4b5', ro: false, gen: 41 }, { id: 257, pfad: '@home', uuid: 'a1b2c3d4-0257-4e5f-8a9b-c0d1e2f3a4b5', ro: false, gen: 38 }], naechste: 258 };
    p.fs = fs; sdb.partitionen.push(p); w.fs['/dev/sdb4'] = '';
  }
  if (o.luks && sdb?.partitionen[0]) {
    const inhalt = { ...neuesFs('ext4', w.uhr - 86400000 * 60, 'tresor', '3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f') };
    inhalt.dateien = { '/lost+found': null, '/vertraege': null, '/vertraege/miete-labor.pdf': '\u0007BIN:183211', '/zugaenge.kdbx': '\u0007BIN:20480' };
    const fs = neuesFs('crypto_LUKS', w.uhr - 86400000 * 60, undefined, '8e9f0a1b-2c3d-4e5f-9a6b-7c8d9e0f1a2b');
    fs.zusatz = { pw: ['Tresor-2026', ''], inhalt, cipher: 'aes-xts-plain64' };
    sdb.partitionen[0].fs = fs;
  }
  if (o.autofs) autofsInstallieren(w);
  if (o.autofsKaputt) {
    datei(w, '/etc/auto.master.d/labor.autofs', '/mnt/labor  /etc/auto.labor  --timeout=60\n');
    datei(w, '/etc/auto.labor', '# Maps für das Labor (Kollege, 18.11.)\ndaten     -fstype=ext4,rw     :/dev/sdb1\narchiv    -fstype=ext4,ro     :/dev/sdb3\nprojekte  -fstype=nfs4,rw     srv1:/srv/projekte\n');
    autofsStart(w);
  }
  if (o.swapDatei) {
    datei(w, '/swapfile', '\u0007BIN:2147483648', o.swapDatei === 'rechte' ? 0o644 : 0o600);
    s.swapDateien['/swapfile'] = { uuid: 'f00dcafe-1234-4a5b-9c6d-7e8f9a0b1c2d' };
    w.fs['/etc/fstab'] = (w.fs['/etc/fstab'] ?? '') + '# Zusätzlicher Auslagerungsspeicher (Kollege)\n/swapfil  none  swap  sw,pri=5  0  0\n';
    if (o.swapDatei === 'fehlt') delete w.fs['/swapfile'];
  }
  if (o.iso) {
    const h = '/home/lena/handbuch';
    datei(w, h + '/LIESMICH.txt', 'Handbuch der Messbox, Ausgabe 2026\n', 0o644, 'lena');
    datei(w, h + '/kapitel-01-einrichtung.txt', 'Kapitel 1: Einrichtung\n', 0o644, 'lena');
    datei(w, h + '/kapitel-02-kalibrierung.txt', 'Kapitel 2: Kalibrierung\n', 0o644, 'lena');
    datei(w, h + '/bilder/anschluss-vorderseite.png', '\u0007BIN:84211', 0o644, 'lena');
    for (const d of [h, h + '/bilder']) { const m = meta(w, d); m.owner = 'lena'; m.group = 'lena'; }
  }
  sync(w);
}

const platzhalter = (c: string | null | undefined) => !c || /^# \S+ aus \S+\n$/.test(c);
function autofsInstallieren(w: Welt) {
  if (platzhalter(w.fs['/etc/auto.master'])) datei(w, '/etc/auto.master', AUTO_MASTER);
  if (platzhalter(w.fs['/etc/auto.misc'])) datei(w, '/etc/auto.misc', AUTO_MISC);
  ordner(w, '/etc/auto.master.d');
  datei(w, '/usr/sbin/automount', '\u0007BIN:301224', 0o755);
  if (w.pakete) w.pakete.installiert['autofs'] = 'ii';
  st(w).autofs.aktiviert = true;
}
export function dsysNachApt(w: Welt) {
  if (!dsysAktiv(w) || !w.pakete) return;
  if (w.pakete.installiert['autofs'] === 'ii' && !st(w).autofs.aktiviert) { autofsInstallieren(w); autofsStart(w); }
  if (w.pakete.installiert['cryptsetup'] === 'ii' && platzhalter(w.fs['/etc/crypttab'])) datei(w, '/etc/crypttab', '# <target name>\t<source device>\t\t<key file>\t<options>\n');
  for (const n of ['btrfs-progs', 'xfsdump', 'genisoimage', 'udftools', 'cryptsetup']) if (w.pakete.installiert[n] === 'ii') { const b = { 'btrfs-progs': ['btrfs', 'btrfs-convert'], xfsdump: ['xfsdump', 'xfsrestore'], genisoimage: ['genisoimage', 'mkisofs', 'isoinfo'], udftools: ['mkudffs'], cryptsetup: ['cryptsetup'] }[n]!; for (const x of b) if (!(`/usr/sbin/${x}` in w.fs) && !(`/usr/bin/${x}` in w.fs)) datei(w, `/usr/sbin/${x}`, '\u0007BIN:184211', 0o755); }
}
const hat = (w: Welt, prog: string) => ['/usr/sbin/', '/usr/bin/', '/sbin/', '/bin/'].some((d) => typeof w.fs[d + prog] === 'string');

// ---------- /proc/mounts, /proc/swaps ----------
function procMounts(w: Welt): string {
  const z = ['sysfs /sys sysfs rw,nosuid,nodev,noexec,relatime 0 0', 'proc /proc proc rw,nosuid,nodev,noexec,relatime 0 0', 'udev /dev devtmpfs rw,nosuid,relatime,size=8124092k,nr_inodes=2031023,mode=755,inode64 0 0', 'tmpfs /run tmpfs rw,nosuid,nodev,noexec,relatime,size=1630344k,mode=755,inode64 0 0'];
  for (const m of w.platten!.mounts) z.push(`${m.quelle} ${m.ziel} ${m.art} ${m.optionen} 0 0`);
  for (const mp of st(w).autofs.laeuft ? st(w).autofs.indirekt.map((x) => x.mp) : []) z.push(`${st(w).autofs.indirekt.find((x) => x.mp === mp)!.map} ${mp} autofs rw,relatime,fd=7,pgrp=1412,timeout=${st(w).autofs.indirekt.find((x) => x.mp === mp)!.timeout},minproto=5,maxproto=5,indirect,pipe_ino=21380 0 0`);
  for (const where of Object.keys(st(w).automount)) z.push(`systemd-1 ${where} autofs rw,relatime,fd=52,pgrp=1,timeout=0,minproto=5,maxproto=5,direct,pipe_ino=18431 0 0`);
  return z.join('\n') + '\n';
}
function procSwaps(w: Welt): string {
  const s = st(w); const z = ['Filename\t\t\t\tType\t\tSize\t\tUsed\t\tPriority'];
  swapListe(w).forEach((x) => z.push(`${x.name.padEnd(40)}${x.typ.padEnd(16)}${String(Math.round(x.bytes / 1024)).padEnd(16)}0\t\t${x.prio}`));
  void s; return z.join('\n') + '\n';
}
function swapListe(w: Welt) {
  const s = st(w);
  let standard = -2;
  return w.platten!.swaps.map((d) => {
    const datei = d in s.swapDateien;
    const bytes = datei ? bytesVon(w.fs[d]) - 4096 : fsBytes(finden(w, d)!.p!) - 4096;
    return { name: d, typ: datei ? 'file' : 'partition', bytes, prio: s.prio[d] ?? standard-- };
  });
}
function sync(w: Welt) {
  if (!dsysAktiv(w)) return;
  ordner(w, '/proc/self');
  w.fs['/proc/mounts'] = procMounts(w); w.fs['/proc/self/mounts'] = w.fs['/proc/mounts'];
  w.fs['/proc/swaps'] = procSwaps(w);
  for (const p of ['/proc/mounts', '/proc/self/mounts', '/proc/swaps']) meta(w, p).mode = 0o444;
}

// ---------- vor jeder Zeile: AutoFS auslösen, Zeitablauf ----------
export function dsysVorZeile(w: Welt, zeile: string) {
  if (!dsysAktiv(w)) return;
  const s = st(w);
  // Zeitablauf: unbenutzte automatische Einhängungen wieder lösen
  for (const m of [...w.platten!.mounts]) {
    if (m.extra !== 'auto' || m.seit === undefined) continue;
    const e = s.autofs.indirekt.find((x) => m.ziel.startsWith(x.mp + '/'));
    const t = (e?.timeout ?? 600) * 1000;
    if (w.uhr - m.seit > t && !(w.cwd === m.ziel || w.cwd.startsWith(m.ziel + '/'))) aushaengen(w, m);
  }
  const tokens = zeile.split(/[\s;|&<>"'=]+/).filter((x) => x.startsWith('/') || x.startsWith('.') || /^[\w.-]+\//.test(x));
  const cdZiel = zeile.match(/(?:^|;|&&)\s*cd\s+(\S+)/)?.[1];
  for (const roh of [...tokens, ...(cdZiel ? [cdZiel] : [])]) {
    const p = K.pfad(w, roh);
    ausloesen(w, p);
  }
  for (const m of w.platten!.mounts) if (m.extra === 'auto' && (zeile.includes(m.ziel) || w.cwd.startsWith(m.ziel))) m.seit = w.uhr;
  sync(w);
}
function ausloesen(w: Welt, p: string) {
  const s = st(w);
  if (w.platten!.mounts.some((m) => m.ziel !== '/' && (p === m.ziel || p.startsWith(m.ziel + '/')))) return;
  if (s.autofs.laeuft) {
    for (const e of s.autofs.maps) {
      const ziel = e.direkt ? e.key : `${e.mp}/${e.key}`;
      const wild = !e.direkt && e.key === '*';
      const sub = wild ? p.slice(e.mp.length + 1).split('/')[0] : '';
      const trifft = wild ? p.startsWith(e.mp + '/') && sub && !s.autofs.maps.some((x) => x.mp === e.mp && x.key === sub) : p === ziel || p.startsWith(ziel + '/');
      if (!trifft) continue;
      const echtZiel = wild ? `${e.mp}/${sub}` : ziel;
      if (w.platten!.mounts.some((m) => m.ziel === echtZiel)) return;
      autoEinhaengen(w, echtZiel, wild ? e.quelle.replace(/&/g, sub) : e.quelle, e.art, e.optionen);
      return;
    }
  }
  for (const [where, unit] of Object.entries(s.automount)) {
    if (p === where || p.startsWith(where + '/')) {
      if (w.platten!.mounts.some((m) => m.ziel === where)) return;
      const fu = dsysMountUnit(w, unit);
      const r = fu ? BEF.mount(w, ['-t', fu.type, ...(fu.opt ? ['-o', fu.opt] : []), fu.what, fu.where], '', true) : BEF.systemctl(w, ['start', unit], '', true);
      const m = w.platten!.mounts.find((x) => x.ziel === where); if (m && !r.code) { m.extra = 'auto-systemd'; }
      return;
    }
  }
}
function autoEinhaengen(w: Welt, ziel: string, quelle: string, art: string, optionen: string) {
  ordner(w, ziel);
  if (/^[\w.-]+:\//.test(quelle)) {
    const dateien = NFS[quelle];
    if (!dateien) { journal(w, `automount[1412]: mount(nfs): nfs: mount failure ${quelle} on ${ziel}`); return; }
    mountFremd(w, quelle, ziel, art.startsWith('nfs') ? art : 'nfs4', `${optionen.includes('ro') ? 'ro' : 'rw'},relatime,vers=4.2,rsize=1048576,wsize=1048576,hard,proto=tcp,sec=sys,clientaddr=192.168.50.20,addr=192.168.50.10`, dateien, 'auto');
    return;
  }
  const dev = quelle.replace(/^:/, '');
  const r = BEF.mount(w, ['-t', art || 'auto', ...(optionen ? ['-o', optionen] : []), dev, ziel], '', true);
  if (r.code) { journal(w, `automount[1412]: >> ${(r.err ?? '').split('\n')[0]}`, `automount[1412]: mount(generic): failed to mount ${dev} (type ${art}) on ${ziel}`); return; }
  const m = w.platten!.mounts.find((x) => x.ziel === ziel); if (m) { m.extra = 'auto'; m.seit = w.uhr; }
}
function journal(w: Welt, ...z: string[]) { const j = (w as Welt & { autofsJournal?: string[] }); (j.autofsJournal ??= []).push(...z); }

// Einhängungen, die nicht von einer Partition kommen: NFS, Loop-Abbilder
function mountFremd(w: Welt, quelle: string, ziel: string, art: string, optionen: string, dateien: Record<string, string | null>, extra: string) {
  const verdeckt = { fs: {} as Record<string, string | null>, meta: {} as Record<string, ReturnType<typeof meta>> };
  for (const k of Object.keys(w.fs).filter((k) => k.startsWith(ziel + '/'))) { verdeckt.fs[k] = w.fs[k]; verdeckt.meta[k] = { ...meta(w, k) }; delete w.fs[k]; }
  for (const [rel, c] of Object.entries(dateien)) { w.fs[ziel + rel] = c; const m = meta(w, ziel + rel); m.mode = c === null ? 0o755 : 0o644; m.owner = art.startsWith('nfs') ? 'lena' : 'root'; m.group = m.owner; }
  w.platten!.mounts.push({ quelle, ziel, art, optionen, extra, seit: w.uhr, verdeckt } as Einhaengung);
}
function aushaengen(w: Welt, m: Einhaengung): string | null {
  if (!m.extra) return null;
  if (m.extra.startsWith('auto') && !m.quelle.includes(':/')) { const r = ALT.umount(w, [m.ziel], '', true); return r.code ? r.err ?? 'umount failed' : null; }
  // Abbild zurückschreiben, wenn es beschreibbar war
  if (m.extra?.startsWith('loop:')) {
    const bild = m.extra.slice(5); const alt = abbild(w.fs[bild] ?? '');
    if (alt && !m.optionen.startsWith('ro')) {
      const neu: Record<string, string | null> = {};
      for (const k of Object.keys(w.fs).filter((k) => k.startsWith(m.ziel + '/'))) neu[k.slice(m.ziel.length)] = w.fs[k];
      w.fs[bild] = abbildText({ ...alt, dateien: neu });
    }
  }
  for (const k of Object.keys(w.fs).filter((k) => k.startsWith(m.ziel + '/'))) { delete w.fs[k]; delete w.meta![k]; }
  for (const [k, c] of Object.entries(m.verdeckt?.fs ?? {})) { w.fs[k] = c; w.meta![k] = m.verdeckt!.meta[k]; }
  w.platten!.mounts = w.platten!.mounts.filter((x) => x !== m);
  return null;
}

// ---------- Abbilder (ISO 9660, UDF) ----------
interface Abbild { art: 'iso9660' | 'udf' | 'leer'; label: string; joliet?: boolean; rr?: boolean; boot?: string; dateien: Record<string, string | null>; bytes: number }
const ABB = '\u0007IMG:';
function abbild(c: string | null): Abbild | null {
  if (typeof c !== 'string') return null;
  if (c.startsWith(ABB)) { try { return JSON.parse(c.slice(ABB.length)); } catch { return null; } }
  if (c.startsWith('\u0007ISO:')) return { art: 'iso9660', label: 'ISOIMAGE', rr: true, joliet: false, boot: c.split(':')[2] || undefined, dateien: {}, bytes: 600 * 1048576 };
  return null;
}
const abbildText = (a: Abbild) => ABB + JSON.stringify(a);
/** Dateinamen nach ISO 9660 Stufe 1: 8.3, Großbuchstaben, ;1 */
function isoName(n: string, dir: boolean): string {
  const t = n.toUpperCase().replace(/[^A-Z0-9._]/g, '_');
  if (dir) return t.replace(/\./g, '_').slice(0, 8);
  const i = t.lastIndexOf('.'); const stamm = (i > 0 ? t.slice(0, i) : t).replace(/\./g, '_').slice(0, 8); const end = i > 0 ? t.slice(i + 1, i + 4) : '';
  return `${stamm}.${end};1`;
}

// ---------- Befehle ----------
let ALT: Record<string, B>; let BEF: Record<string, B>;
export function dsysBefehle(alt: Record<string, B>, alle: Record<string, B>): Record<string, B> {
  ALT = alt; BEF = alle;
  const b: Record<string, B> = {};
  const mit = (n: string, f: B): B => (w, a, i, r) => (dsysAktiv(w) ? f(w, a, i, r) : alt[n] ? alt[n](w, a, i, r) : fehler(`bash: ${n}: Befehl nicht gefunden`, 127));
  const nur = (n: string, paket: string, f: B): B => mit(n, (w, a, i, r) => hat(w, n) ? f(w, a, i, r) : fehler(`bash: ${n}: Befehl nicht gefunden\n(${n} gehört zum Paket ${paket}: sudo apt install ${paket})`, 127));

  b.sync = () => ok();
  b.fallocate = (w, a, _i, r) => {
    const li = a.indexOf('-l'); const z = a.filter((x, i) => !x.startsWith('-') && i !== li + 1).pop();
    if (li < 0 || !z) return fehler('fallocate: keine Länge angegeben\nAufruf: fallocate [Optionen] <Dateiname>');
    const n = groesseLesen(a[li + 1]); if (!n) return fehler(`fallocate: ungültige Länge: »${a[li + 1]}«`);
    const p = K.pfad(w, z); const dir = p.slice(0, p.lastIndexOf('/')) || '/';
    if (!(r || w.root) && !dir.startsWith('/home/lena') && dir !== '/tmp') return fehler(`fallocate: ${z}: open fehlgeschlagen: Keine Berechtigung`);
    datei(w, p, '\u0007BIN:' + n, 0o644, r || w.root ? 'root' : 'lena');
    return ok();
  };

  // ----- Swap -----
  b.mkswap = mit('mkswap', (w, a, i, r) => {
    const z = a.find((x) => !x.startsWith('-') && a[a.indexOf(x) - 1] !== '-L');
    if (!z || z.startsWith('/dev/')) { const x = alt.mkswap(w, a, i, r); sync(w); return x; }
    const p = K.pfad(w, z);
    if (typeof w.fs[p] !== 'string') return fehler(`mkswap: ${z} kann nicht geöffnet werden: Datei oder Verzeichnis nicht gefunden`);
    if (!(r || w.root)) return fehler(`mkswap: ${z} kann nicht geöffnet werden: Keine Berechtigung`);
    if (w.platten!.swaps.includes(p)) return fehler(`mkswap: Fehler: ${z} ist eingehängt; es wird kein Auslagerungsbereich angelegt`);
    const n = bytesVon(w.fs[p]); if (n < 40960) return fehler(`mkswap: Fehler: Auslagerungsbereich muss mindestens 40 KiB groß sein`);
    const li = a.indexOf('-L');
    const sd = { uuid: uuid(), label: li >= 0 ? a[li + 1] : undefined }; st(w).swapDateien[p] = sd;
    const mode = meta(w, p).mode & 0o777;
    const warn = mode & 0o077 ? `mkswap: ${z}: unsichere Zugriffsrechte ${mode.toString(8).padStart(4, '0')}, korrigieren Sie dies mit: chmod 0600 ${z}\n` : '';
    return { out: `Auslagerungsbereich Version 1 wird angelegt, Größe = ${menschGroesse(n - 4096).replace(/([KMGT])$/, ' $1iB')} (${n - 4096} Bytes)\n${sd.label ? `LABEL=${sd.label}, ` : 'keine Bezeichnung, '}UUID=${sd.uuid}`, err: warn ? warn.trim() : undefined, code: 0 };
  });
  b.swapon = mit('swapon', (w, a, _i, r) => {
    const s = st(w); const pl = w.platten!;
    if (!a.filter((x) => !x.startsWith('-')).length && !a.includes('-a')) {
      if (a.includes('-s') || a.includes('--summary')) return ok(procSwaps(w).trimEnd());
      const l = swapListe(w); return ok(l.length ? ['NAME           TYPE      SIZE USED PRIO', ...l.map((x) => `${x.name.padEnd(14)} ${x.typ.padEnd(9)} ${menschGroesse(x.bytes).padStart(4)}   0B ${String(x.prio).padStart(4)}`)].join('\n') : '');
    }
    if (!(r || w.root)) return fehler('swapon: Keine Berechtigung');
    const pi = a.findIndex((x) => x === '-p' || x === '--priority'); const prioOpt = pi >= 0 ? Number(a[pi + 1]) : undefined;
    let ziele: { d: string; prio?: number }[] = [];
    if (a.includes('-a')) {
      for (const z of (w.fs['/etc/fstab'] ?? '').split('\n').map((x) => x.trim()).filter((x) => x && !x.startsWith('#'))) {
        const f = z.split(/\s+/); if (f[2] !== 'swap') continue;
        const pr = (f[3] ?? '').match(/pri=(-?\d+)/)?.[1];
        ziele.push({ d: f[0].startsWith('/dev/') || /^(UUID|LABEL)=/.test(f[0]) ? (nachKennung(w, f[0]) ?? f[0]) : f[0], prio: pr !== undefined ? Number(pr) : undefined });
      }
    } else ziele = a.filter((x, i) => !x.startsWith('-') && (pi < 0 || i !== pi + 1)).map((x) => ({ d: x.startsWith('/dev/') || /^(UUID|LABEL)=/.test(x) ? (nachKennung(w, x) ?? x) : K.pfad(w, x), prio: prioOpt }));
    const err: string[] = [];
    for (const { d, prio } of ziele) {
      if (pl.swaps.includes(d)) { if (!a.includes('-a')) err.push(`swapon: ${d}: swapon fehlgeschlagen: Das Gerät oder die Ressource ist belegt`); continue; }
      if (d.startsWith('/dev/')) {
        const t = finden(w, d);
        if (!t?.p) { err.push(`swapon: ${d}: stat fehlgeschlagen: Datei oder Verzeichnis nicht gefunden`); continue; }
        if (t.p.fs?.art !== 'swap') { err.push(`swapon: ${d}: Lesen der Swap-Signatur fehlgeschlagen`); continue; }
      } else {
        if (typeof w.fs[d] !== 'string') { err.push(`swapon: ${d}: stat fehlgeschlagen: Datei oder Verzeichnis nicht gefunden`); continue; }
        if (!s.swapDateien[d]) { err.push(`swapon: ${d}: Lesen der Swap-Signatur fehlgeschlagen`); continue; }
        const mode = meta(w, d).mode & 0o777;
        if (mode & 0o077) err.push(`swapon: ${d}: unsichere Zugriffsrechte ${mode.toString(8).padStart(4, '0')}, 0600 wird empfohlen.`);
      }
      pl.swaps.push(d); if (prio !== undefined) s.prio[d] = prio; else delete s.prio[d];
    }
    sync(w);
    const hart = err.filter((x) => !x.includes('unsichere'));
    return { out: '', err: err.join('\n') || undefined, code: hart.length ? 255 : 0 };
  });
  b.swapoff = mit('swapoff', (w, a, _i, r) => {
    if (!(r || w.root)) return fehler('swapoff: Keine Berechtigung');
    const pl = w.platten!;
    if (a.includes('-a')) { pl.swaps = []; sync(w); return ok(); }
    for (const x of a.filter((y) => !y.startsWith('-'))) { const d = x.startsWith('/dev/') || /^(UUID|LABEL)=/.test(x) ? (nachKennung(w, x) ?? x) : K.pfad(w, x); if (!pl.swaps.includes(d)) return fehler(`swapoff: ${x}: swapoff fehlgeschlagen: Das Argument ist ungültig`); pl.swaps = pl.swaps.filter((y) => y !== d); }
    sync(w); return ok();
  });

  // ----- mount / umount: Abbilder, LUKS, NFS -----
  b.mount = mit('mount', (w, a, i, r) => {
    const rest = a.filter((x, j) => !x.startsWith('-') && !['-t', '-o'].includes(a[j - 1]));
    const oi = a.indexOf('-o'); const opt = oi >= 0 ? a[oi + 1] ?? '' : '';
    const ti = a.indexOf('-t'); const art = ti >= 0 ? a[ti + 1] : undefined;
    if (rest.length === 2 && !rest[0].startsWith('/dev/') && !/^(UUID|LABEL|PARTUUID)=/.test(rest[0]) && !rest[0].includes(':/')) {
      const bild = K.pfad(w, rest[0]); const ab = abbild(w.fs[bild] ?? null);
      if (typeof w.fs[bild] === 'string') {
        if (!(r || w.root)) return fehler(`mount: ${K.pfad(w, rest[1])}: »mount« darf nur der Administrator verwenden.`, 32);
        const ziel = K.pfad(w, rest[1]);
        if (w.fs[ziel] !== null) return fehler(`mount: ${ziel}: der Einhängepunkt ist nicht vorhanden.`, 32);
        if (!ab || ab.art === 'leer') return fehler(`mount: ${ziel}: Falscher Dateisystemtyp, ungültige Optionen, der Superblock von /dev/loop0 ist beschädigt, fehlende Kodierungsseite oder ein anderer Fehler.`, 32);
        if (art && art !== 'auto' && art !== ab.art) return fehler(`mount: ${ziel}: Falscher Dateisystemtyp, ungültige Optionen, der Superblock von /dev/loop0 ist beschädigt, fehlende Kodierungsseite oder ein anderer Fehler.`, 32);
        const ro = ab.art === 'iso9660' || opt.split(',').includes('ro');
        // Ohne Rock Ridge und Joliet sieht man die kurzen Namen nach ISO 9660
        const dateien: Record<string, string | null> = {};
        for (const [k, c] of Object.entries(ab.dateien)) {
          let n = ab.art === 'iso9660' && !ab.rr && !ab.joliet ? k.split('/').map((t, j, l) => (t ? isoName(t, j < l.length - 1 || c === null) : t)).join('/') : k;
          for (let z = 0; n in dateien && z < 10; z++) n = n.replace(/.(\.[A-Z0-9]*;1)$/, `${z}$1`);
          dateien[n] = c;
        }
        const loop = '/dev/loop' + w.platten!.mounts.filter((m) => m.extra?.startsWith('loop:')).length;
        mountFremd(w, loop, ziel, ab.art, `${ro ? 'ro' : 'rw'},relatime${ab.art === 'iso9660' ? ',nojoliet,check=s,map=n,blocksize=2048'.replace(',nojoliet', ab.joliet ? '' : ',nojoliet') : ''}`, dateien, 'loop:' + bild);
        sync(w);
        return { out: '', err: ab.art === 'iso9660' && !opt.includes('ro') ? `mount: ${ziel}: WARNUNG: Quelle schreibgeschützt, wird schreibgeschützt eingehängt.` : undefined, code: 0 };
      }
    }
    const x = alt.mount(w, a, i, r); sync(w); return x;
  });
  b.umount = mit('umount', (w, a, i, r) => {
    const ziele = a.filter((x) => !x.startsWith('-')); const erledigt = new Set<string>();
    for (const z of ziele) {
      const p = z.startsWith('/dev/loop') || z.includes(':/') ? z : K.pfad(w, z);
      const m = w.platten!.mounts.find((x) => (x.ziel === p || x.quelle === p) && x.extra && !x.extra.startsWith('auto'));
      if (!m) continue;
      if (!(r || w.root)) return fehler(`umount: ${m.ziel}: nur der Administrator kann umount ausführen.`, 32);
      if (w.cwd === m.ziel || w.cwd.startsWith(m.ziel + '/')) return fehler(`umount: ${m.ziel}: das Ziel wird gerade benutzt.`, 32);
      aushaengen(w, m); erledigt.add(z);
    }
    const rest = ziele.filter((z) => !erledigt.has(z));
    if (ziele.length && !rest.length) { sync(w); return ok(); }
    const x = alt.umount(w, [...a.filter((y) => y.startsWith('-')), ...rest], i, r); sync(w); return x;
  });
  for (const n of ['mkfs', 'mkfs.ext4', 'mkfs.ext3', 'mkfs.ext2', 'mkfs.xfs', 'mkfs.btrfs', 'mkfs.vfat', 'blkid', 'tune2fs', 'xfs_repair']) if (alt[n]) b[n] = (w, a, i, r) => { const x = alt[n](w, a, i, r); if (dsysAktiv(w)) sync(w); return x; };

  // ----- ext: Superblock, dumpe2fs, debugfs -----
  const backups = [32768, 98304, 163840, 229376, 294912, 819200, 884736, 1605632, 2654208, 4096000, 7962624, 11239424];
  const extPart = (w: Welt, dev: string) => { const d = nachKennung(w, dev) ?? dev; const t = finden(w, d); return t?.p?.fs && t.p.fs.art.startsWith('ext') ? { d, p: t.p, fs: t.p.fs } : null; };
  const backupsFuer = (p: Partition) => backups.filter((x) => x < fsBytes(p) / 4096);
  b.mke2fs = mit('mke2fs', (w, a, i, r) => {
    if (!a.includes('-n')) { const x = alt.mke2fs(w, a, i, r); sync(w); return x; }
    const dev = a.filter((x) => x.startsWith('/dev/')).pop() ?? ''; const t = finden(w, dev);
    if (!t?.p) return fehler(`mke2fs: Die Datei ${dev} existiert nicht und es wurde keine Größe angegeben.`);
    const bl = Math.floor(fsBytes(t.p) / 4096);
    return ok(`mke2fs 1.47.0 (5-Feb-2023)\nEin Dateisystem mit ${bl} (4k) Blöcken und ${Math.round(fsBytes(t.p) / 16384)} Inodes wird erzeugt.\nUUID des Dateisystems: ${uuid()}\nSuperblock-Sicherungskopien gespeichert in den Blöcken: \n\t${backupsFuer(t.p).join(', ')}\n\n(Mit -n zeigt mke2fs nur an, was es täte. Es wurde nichts geschrieben.)`);
  });
  b['mkfs.ext4'] = mit('mkfs.ext4', (w, a, i, r) => a.includes('-n') ? b.mke2fs(w, ['-t', 'ext4', ...a], i, r) : (() => { const x = alt['mkfs.ext4'](w, a, i, r); sync(w); return x; })());
  b.e2fsck = mit('e2fsck', (w, a, i, r) => {
    const dev = a.find((x) => x.startsWith('/dev/') || /^(UUID|LABEL)=/.test(x)) ?? ''; const e = extPart(w, dev);
    if (!e?.fs.superKaputt || !(r || w.root)) return alt.e2fsck(w, a, i, r);
    const bi = a.indexOf('-b'); const bnr = bi >= 0 ? Number(a[bi + 1]) : NaN;
    if (bi < 0) return { out: `e2fsck 1.47.0 (5-Feb-2023)\next2fs_open2: Ungültige magische Zahl im Superblock\ne2fsck: Superblock ungültig, Sicherungsblöcke werden versucht ...\ne2fsck: Ungültige magische Zahl im Superblock beim Versuch, ${e.d} zu öffnen\n\nDer Superblock ist nicht lesbar oder beschreibt kein gültiges ext2/ext3/ext4-\nDateisystem. Wenn das Gerät gültig ist und tatsächlich ein ext2/ext3/ext4-\nDateisystem enthält (und kein swap oder ufs oder etwas anderes), dann ist der\nSuperblock beschädigt, und Sie könnten e2fsck mit einem anderen Superblock\nausführen:\n    e2fsck -b 8193 <Gerät>\n oder\n    e2fsck -b 32768 <Gerät>\n`, code: 8 };
    if (!backupsFuer(e.p).includes(bnr)) return { out: `e2fsck 1.47.0 (5-Feb-2023)\ne2fsck: Ungültige magische Zahl im Superblock beim Versuch, ${e.d} zu öffnen\n(An Block ${a[bi + 1]} liegt keine Sicherungskopie. dumpe2fs oder mke2fs -n zeigen, wo sie liegen.)`, code: 8 };
    e.fs.superKaputt = false;
    return { out: `e2fsck 1.47.0 (5-Feb-2023)\nDer Superblock hat ein ungültiges Journal (Inode 8).\nLöschen<j>? ja\n*** Journal wurde gelöscht ***\nDurchgang 1: Inodes, Blöcke und Größen werden geprüft\nDurchgang 2: Verzeichnisstruktur wird geprüft\nDurchgang 3: Verzeichnisverknüpfungen werden geprüft\nDurchgang 4: Referenzzähler werden überprüft\nDurchgang 5: Zusammengefasste Gruppeninformation wird geprüft\nFreie Blöcke zählen ist falsch für Gruppe #0 (8167, gezählt=8168).\nKorrigieren<j>? ja\nDas Journal wird neu erzeugt.\n\n${e.d}: ***** DATEISYSTEM WURDE VERÄNDERT *****\n${e.d}: ${11 + Object.keys(e.fs.dateien).length}/${Math.round(fsBytes(e.p) / 16384)} Dateien (0.0% nicht zusammenhängend), 1093415/${Math.floor(fsBytes(e.p) / 4096)} Blöcke`, code: 1 };
  });
  b['fsck.ext4'] = b.e2fsck; b['fsck.ext3'] = b.e2fsck; b['fsck.ext2'] = b.e2fsck;
  b.fsck = mit('fsck', (w, a, i, r) => { const dev = a.find((x) => x.startsWith('/dev/') || /^(UUID|LABEL)=/.test(x)) ?? ''; const e = extPart(w, dev); if (e?.fs.superKaputt) { const x = b.e2fsck(w, a, i, r); return { ...x, out: 'fsck from util-linux 2.38.1\n' + x.out }; } return alt.fsck(w, a, i, r); });
  b.tune2fs = mit('tune2fs', (w, a, i, r) => { const e = extPart(w, a.find((x) => x.startsWith('/dev/')) ?? ''); if (e?.fs.superKaputt) return fehler(`tune2fs 1.47.0 (5-Feb-2023)\ntune2fs: Ungültige magische Zahl im Superblock beim Versuch, ${e.d} zu öffnen\n${e.d} enthält kein gültiges Dateisystem`); const x = alt.tune2fs(w, a, i, r); sync(w); return x; });
  b.dumpe2fs = mit('dumpe2fs', (w, a, _i, r) => {
    const dev = a.filter((x) => x.startsWith('/dev/')).pop() ?? ''; const e = extPart(w, dev);
    const kopf = 'dumpe2fs 1.47.0 (5-Feb-2023)';
    if (!e) return fehler(`${kopf}\ndumpe2fs: Datei oder Verzeichnis nicht gefunden beim Versuch, ${dev} zu öffnen\n${dev} konnte nicht gefunden werden, kein gültiges Dateisystem`);
    if (!(r || w.root)) return fehler(`${kopf}\ndumpe2fs: Keine Berechtigung beim Versuch, ${e.d} zu öffnen`);
    const sb = a.find((x) => x.startsWith('superblock='))?.slice(11) ?? (a.includes('-o') && a[a.indexOf('-o') + 1]?.startsWith('superblock=') ? a[a.indexOf('-o') + 1].slice(11) : undefined);
    if (e.fs.superKaputt && !sb) return fehler(`${kopf}\ndumpe2fs: Ungültige magische Zahl im Superblock beim Versuch, ${e.d} zu öffnen\n${e.d} enthält kein gültiges Dateisystem\n(Eine Sicherungskopie liest du mit dumpe2fs -o superblock=32768 -o blocksize=4096 ${e.d})`);
    const bl = Math.floor(fsBytes(e.p) / 4096); const inodes = Math.round(fsBytes(e.p) / 16384);
    const h = `Filesystem volume name:   ${e.fs.label ?? '<none>'}\nLast mounted on:          <not available>\nFilesystem UUID:          ${e.fs.uuid}\nFilesystem magic number:  0xEF53\nFilesystem revision #:    1 (dynamic)\nFilesystem features:      ${e.fs.art === 'ext4' ? 'has_journal ext_attr resize_inode dir_index filetype extent 64bit flex_bg sparse_super large_file huge_file dir_nlink extra_isize metadata_csum' : e.fs.art === 'ext3' ? 'has_journal ext_attr resize_inode dir_index filetype sparse_super large_file' : 'ext_attr resize_inode dir_index filetype sparse_super large_file'}\nFilesystem state:         ${e.fs.kaputt ? 'not clean' : 'clean'}\nErrors behavior:          Continue\nInode count:              ${inodes}\nBlock count:              ${bl}\nReserved block count:     ${Math.round(bl * e.fs.reserviert / 100)}\nFree blocks:              ${bl - 1093415}\nFree inodes:              ${inodes - 11 - Object.keys(e.fs.dateien).length}\nFirst block:              0\nBlock size:               4096\nBlocks per group:         32768\nInodes per group:         8192\nMount count:              ${e.fs.einhaengungen}\nMaximum mount count:      ${e.fs.maxEinhaengungen}\nCheck interval:           ${e.fs.intervall} (<none>)\nInode size:               256\n${e.fs.art !== 'ext2' ? 'Journal inode:            8\nJournal size:             256M\n' : ''}`;
    if (a.includes('-h')) return ok(`${kopf}\n${h}`);
    const gruppen: string[] = [];
    for (let g = 0; g < 6; g++) {
      const start = g * 32768; const bk = g === 0 || backupsFuer(e.p).includes(start);
      gruppen.push(`Gruppe ${g}: (Blöcke ${start}-${start + 32767}) csum 0x${(0x1a2b + g * 977).toString(16)} [ITABLE_ZEROED]\n  ${bk ? `${g === 0 ? 'Primärer' : 'Reserve-'}Superblock bei ${start}, Gruppendeskriptoren bei ${start + 1}-${start + 1}\n  ` : ''}Block-Bitmap bei ${1025 + g} (+${1025 + g - start}), Inode-Bitmap bei ${1041 + g}\n  Inode-Tabelle bei ${1057 + g * 512}-${1568 + g * 512}\n  ${g === 0 ? 8167 : 32768 - (bk ? 1 : 0)} freie Blöcke, 8181 freie Inodes, 2 Verzeichnisse`);
    }
    return ok(`${kopf}\n${h}\n\n${gruppen.join('\n')}\n(… insgesamt ${Math.ceil(bl / 32768)} Gruppen, im Simulator gekürzt)`);
  });
  b.debugfs = mit('debugfs', (w, a, _i, r) => {
    const dev = a.filter((x) => x.startsWith('/dev/')).pop() ?? ''; const e = extPart(w, dev);
    if (!e) return fehler(`debugfs 1.47.0 (5-Feb-2023)\ndebugfs: Datei oder Verzeichnis nicht gefunden beim Öffnen des Dateisystems ${dev}`);
    if (!(r || w.root)) return fehler(`debugfs 1.47.0 (5-Feb-2023)\ndebugfs: Keine Berechtigung beim Öffnen des Dateisystems ${e.d}`);
    if (e.fs.superKaputt) return fehler(`debugfs 1.47.0 (5-Feb-2023)\ndebugfs: Ungültige magische Zahl im Superblock beim Öffnen des Dateisystems ${e.d}`);
    const schreib = a.includes('-w');
    const eing = w.platten!.mounts.find((m) => m.quelle === e.d);
    const quelle = (): Record<string, string | null> => eing ? Object.fromEntries(Object.entries(w.fs).filter(([k]) => k.startsWith(eing.ziel + '/')).map(([k, v]) => [k.slice(eing.ziel.length), v])) : e.fs.dateien;
    const ino = (p: string) => (p === '/' ? 2 : p === '/lost+found' ? 11 : 12 + Object.keys(quelle()).sort().indexOf(p));
    let cwd = '/';
    const absolut = (p: string) => (p.startsWith('/') ? p : (cwd === '/' ? '' : cwd) + '/' + p).replace(/\/+$/, '') || '/';
    const befehl = (z: string): string => {
      const [c, ...x] = z.trim().split(/\s+/); const q = quelle();
      if (!c) return '';
      if (c === 'q' || c === 'quit') { w.dialog = null; return ''; }
      if (c === 'pwd') return `[pwd]   INODE: ${String(ino(cwd)).padStart(6)}  PATH: ${cwd}\n[root]  INODE:      2  PATH: /`;
      if (c === 'cd') { const p = absolut(x[0] ?? '/'); if (p !== '/' && q[p] !== null) return `cd: Datei nicht gefunden durch ext2_lookup bei ${x[0]}`; cwd = p; return ''; }
      if (c === 'ls') {
        const lang = x.includes('-l'); const d = absolut(x.find((y) => !y.startsWith('-')) ?? cwd);
        const kinder = Object.keys(q).filter((k) => k.slice(0, k.lastIndexOf('/') || 1) === d && k !== d).sort();
        const liste = ['.', '..', ...kinder.map((k) => k.slice(k.lastIndexOf('/') + 1))];
        if (!lang) return liste.map((n, j) => ` ${j < 2 ? (j ? 2 : ino(d)) : ino(kinder[j - 2])}  (12) ${n}   `).join('');
        return liste.map((n, j) => { const k = j < 2 ? d : kinder[j - 2]; const dir = j < 2 || q[k] === null; return ` ${String(j < 2 ? (j ? 2 : ino(d)) : ino(k)).padStart(7)}  ${dir ? '40755' : '100644'} (${dir ? 2 : 1})      0      0   ${String(dir ? 4096 : bytesVon(q[k])).padStart(8)} 23-Nov-2026 08:41 ${n}`; }).join('\n');
      }
      if (c === 'stat') {
        const p = absolut((x[0] ?? '').replace(/^<(\d+)>$/, (_m, n) => Object.keys(q).sort()[Number(n) - 12] ?? ''));
        if (p !== '/' && !(p in q)) return `${x[0]}: Datei nicht gefunden durch ext2_lookup`;
        const dir = p === '/' || q[p] === null; const n = dir ? 4096 : bytesVon(q[p]);
        return `Inode: ${ino(p)}   Typ: ${dir ? 'Verzeichnis' : 'reguläre Datei'}    Modus:  0${dir ? '755' : '644'}   Flags: 0x80000\nGeneration: ${1813462 + ino(p)}    Version: 0x00000000:00000001\nBenutzer:     0   Gruppe:     0   Projekt:     0   Größe: ${n}\nDatei-ACL: 0\nLinks: ${dir ? 2 : 1}   Blockanzahl: ${Math.ceil(n / 512)}\nFragment:  Adresse: 0    Nummer: 0    Größe: 0\n ctime: 0x6741a1c4:5d3e2a10 -- Mon Nov 23 08:41:24 2026\n atime: 0x6741a1c4:5d3e2a10 -- Mon Nov 23 08:41:24 2026\n mtime: 0x6741a1c4:5d3e2a10 -- Mon Nov 23 08:41:24 2026\ncrtime: 0x6741a1c4:5d3e2a10 -- Mon Nov 23 08:41:24 2026\nGröße der zusätzlichen Inode-Felder: 32\nEXTENTS:\n(0-${Math.max(0, Math.ceil(n / 4096) - 1)}):${34816 + ino(p) * 300}-${34816 + ino(p) * 300 + Math.max(0, Math.ceil(n / 4096) - 1)}`;
      }
      if (c === 'stats') return `Filesystem volume name:   ${e.fs.label ?? '<none>'}\nFilesystem UUID:          ${e.fs.uuid}\nFilesystem state:         clean\nBlock count:              ${Math.floor(fsBytes(e.p) / 4096)}\nMount count:              ${e.fs.einhaengungen}\nMaximum mount count:      ${e.fs.maxEinhaengungen}\n(gekürzt, mehr mit dumpe2fs -h)`;
      if (c === 'lsdel') return e.fs.art === 'ext4' ? ' Inode  Owner  Mode    Size      Blocks   Time deleted\n0 deleted inodes found.\n(Bei ext4 löscht der Kernel die Blockzuordnung gelöschter Dateien. lsdel und undel helfen vor allem bei ext2.)' : ' Inode  Owner  Mode    Size      Blocks   Time deleted\n    21   1000 100644   183211   45/  45 Mon Nov 23 07:58:12 2026\n1 deleted inodes found.';
      if (c === 'cat' || c === 'dump') {
        const p = absolut(x[0] ?? ''); if (typeof q[p] !== 'string') return `${x[0]}: Datei nicht gefunden durch ext2_lookup`;
        if (c === 'cat') return String(q[p]).startsWith('\u0007') ? '(Binärdaten)' : String(q[p]);
        const ziel = x[1]; if (!ziel) return 'dump: Usage: dump_inode [-p] <file> <output_file>';
        const zp = K.pfad(w, ziel); w.fs[zp] = q[p]; const m = meta(w, zp); m.mode = 0o644; m.owner = 'root'; m.group = 'root'; return '';
      }
      if (c === 'set_super_value' || c === 'ssv') { if (!schreib) return 'set_super_value: Das Dateisystem ist nur zum Lesen geöffnet'; if (x[0] === 'mnt_count') e.fs.einhaengungen = Number(x[1]); return ''; }
      if (c === 'help' || c === '?') return 'Bekannt im Simulator: ls [-l] [Verz.], cd, pwd, stat DATEI, stats, cat DATEI, dump DATEI ZIEL, lsdel, set_super_value mnt_count N (nur mit -w), quit';
      return `debugfs: Befehl nicht gefunden: ${c}`;
    };
    const ri = a.indexOf('-R'); const kopf = 'debugfs 1.47.0 (5-Feb-2023)';
    if (ri >= 0) return ok(`${kopf}\n${befehl(a[ri + 1] ?? '')}`);
    const schleife = () => K.dialog(w, 'debugfs:  ', (z) => { const out = befehl(z); if (!/^\s*(q|quit)\s*$/.test(z)) schleife(); return out; });
    schleife();
    return ok(kopf);
  });

  // ----- Btrfs -----
  interface Subvol { id: number; pfad: string; uuid: string; ro: boolean; gen: number; von?: string }
  const btrfsVon = (w: Welt, p: string) => {
    const m = w.platten!.mounts.filter((x) => x.art === 'btrfs' && (p === x.ziel || p.startsWith(x.ziel + '/'))).sort((x, y) => y.ziel.length - x.ziel.length)[0];
    if (!m) return null; const t = finden(w, m.quelle)!; const z = t.p!.fs!.zusatz as { subvols: Subvol[]; naechste: number };
    return { m, fs: t.p!.fs!, z, rel: p.slice(m.ziel.length).replace(/^\//, '') };
  };
  b.btrfs = nur('btrfs', 'btrfs-progs', (w, a, _i, r) => {
    const [g, c, ...x] = a.filter((y) => !/^-[a-z]$/.test(y) || ['-r'].includes(y)).filter((y) => y !== '-r');
    const ro = a.includes('-r');
    const gruppe = (g ?? '').replace(/^fi$|^filesystem$/, 'filesystem').replace(/^sub$|^su$|^subvol$|^subvolume$/, 'subvolume');
    if (gruppe === 'filesystem' && (c === 'show' || !c)) {
      const liste = w.platten!.platten.flatMap((pl) => pl.partitionen.filter((p) => p.fs?.art === 'btrfs').map((p) => ({ pl, p })));
      if (!liste.length) return ok();
      return ok(liste.map(({ pl, p }) => `Label: '${p.fs!.label ?? 'none'}'  uuid: ${p.fs!.uuid}\n\tTotal devices 1 FS bytes used 3.47GiB\n\tdevid    1 size ${menschGroesse(fsBytes(p)).replace(',', '.')}iB used 6.03GiB path /dev/${pl.name}${p.nr}`).join('\n\n'));
    }
    if (gruppe === 'filesystem' && (c === 'df' || c === 'usage')) {
      const v = btrfsVon(w, K.pfad(w, x[0] ?? '')); if (!v) return fehler(`ERROR: not a btrfs filesystem: ${x[0] ?? ''}`);
      if (c === 'df') return ok('Data, single: total=5.01GiB, used=3.46GiB\nSystem, DUP: total=8.00MiB, used=16.00KiB\nMetadata, DUP: total=512.00MiB, used=5.48MiB\nGlobalReserve, single: total=5.50MiB, used=0.00B');
      return ok(`Overall:\n    Device size:\t\t ${menschGroesse(fsBytes(finden(w, v.m.quelle)!.p!)).replace(',', '.')}iB\n    Device allocated:\t\t   6.03GiB\n    Used:\t\t\t   3.47GiB\n    Free (estimated):\t\t  71.84GiB\t(min: 71.84GiB)\n    Data ratio:\t\t\t      1.00\n    Metadata ratio:\t\t      2.00`);
    }
    if (gruppe === 'subvolume') {
      if (c === 'list') {
        const v = btrfsVon(w, K.pfad(w, x[0] ?? '')); if (!v) return fehler(`ERROR: not a btrfs filesystem: ${x[0] ?? ''}`);
        const nurSnap = a.includes('-s');
        return ok(v.z.subvols.filter((s) => !nurSnap || s.von).map((s) => `ID ${s.id} gen ${s.gen} top level 5 path ${s.pfad}`).join('\n'));
      }
      if (c === 'create' || c === 'snapshot' || c === 'delete' || c === 'show') {
        if (c !== 'show' && !(r || w.root)) return fehler(`ERROR: cannot access '${x[x.length - 1]}': Permission denied`);
        if (c === 'create') {
          const p = K.pfad(w, x[0] ?? ''); const v = btrfsVon(w, p); if (!v) return fehler(`ERROR: not a btrfs filesystem: ${p.slice(0, p.lastIndexOf('/')) || '/'}`);
          if (p in w.fs) return fehler(`ERROR: target path already exists: ${p}`);
          w.fs[p] = null; meta(w, p).mode = 0o755;
          v.z.subvols.push({ id: v.z.naechste++, pfad: v.rel, uuid: uuid(), ro: false, gen: 42 });
          return ok(`Create subvolume '${p.slice(0, p.lastIndexOf('/'))}/${p.split('/').pop()}'`);
        }
        if (c === 'snapshot') {
          const q = K.pfad(w, x[0] ?? ''); let z = K.pfad(w, x[1] ?? '');
          const vq = btrfsVon(w, q); if (!vq || !vq.z.subvols.some((s) => s.pfad === vq.rel) && vq.rel !== '') return fehler(`ERROR: Not a Btrfs subvolume: ${q}`);
          if (w.fs[z] === null) z = z + '/' + q.split('/').pop();
          if (z in w.fs) return fehler(`ERROR: target path already exists: ${z}`);
          const vz = btrfsVon(w, z); if (!vz || vz.m !== vq.m) return fehler('ERROR: cannot snapshot across filesystems');
          for (const k of Object.keys(w.fs).filter((k) => k === q || k.startsWith(q + '/'))) { const n = z + k.slice(q.length); w.fs[n] = w.fs[k]; w.meta![n] = { ...meta(w, k) }; }
          const quelleSv = vq.z.subvols.find((s) => s.pfad === vq.rel);
          vq.z.subvols.push({ id: vq.z.naechste++, pfad: vz.rel, uuid: uuid(), ro, gen: 43, von: quelleSv?.uuid ?? vq.fs.uuid });
          return ok(`Create ${ro ? 'a readonly' : 'a'} snapshot of '${q}' in '${z}'`);
        }
        if (c === 'delete') {
          const p = K.pfad(w, x[0] ?? ''); const v = btrfsVon(w, p); const sv = v?.z.subvols.find((s) => s.pfad === v.rel);
          if (!v || !sv) return fehler(`ERROR: Not a Btrfs subvolume: ${p}`);
          for (const k of Object.keys(w.fs).filter((k) => k === p || k.startsWith(p + '/'))) { delete w.fs[k]; delete w.meta![k]; }
          v.z.subvols = v.z.subvols.filter((s) => s !== sv);
          return ok(`Delete subvolume ${sv.id} (no-commit): '${p}'`);
        }
        const p = K.pfad(w, x[0] ?? ''); const v = btrfsVon(w, p); const sv = v?.z.subvols.find((s) => s.pfad === v.rel);
        if (!v || !sv) return fehler(`ERROR: Not a Btrfs subvolume: ${p}`);
        const kinder = v.z.subvols.filter((s) => s.von === sv.uuid).map((s) => s.pfad);
        return ok(`${sv.pfad}\n\tName: \t\t\t${sv.pfad.split('/').pop()}\n\tUUID: \t\t\t${sv.uuid}\n\tParent UUID: \t\t${sv.von ?? '-'}\n\tReceived UUID: \t\t-\n\tCreation time: \t\t2026-11-23 08:41:00 +0100\n\tSubvolume ID: \t\t${sv.id}\n\tGeneration: \t\t${sv.gen}\n\tFlags: \t\t\t${sv.ro ? 'readonly' : '-'}\n\tSnapshot(s):\n${kinder.map((k) => `\t\t\t\t${k}`).join('\n')}`);
      }
    }
    if (gruppe === 'scrub' && (c === 'start' || c === 'status')) return ok(c === 'start' ? `scrub started on ${x[0]}, fsid ${btrfsVon(w, K.pfad(w, x[0] ?? ''))?.fs.uuid ?? '?'} (pid=4211)` : `UUID:             ${btrfsVon(w, K.pfad(w, x[0] ?? ''))?.fs.uuid ?? '?'}\nScrub started:    Mon Nov 23 08:41:00 2026\nStatus:           finished\nDuration:         0:00:12\nTotal to scrub:   3.47GiB\nRate:             296.11MiB/s\nError summary:    no errors found`);
    return fehler(`(Im Simulator kennt btrfs: filesystem show|df|usage, subvolume create|list|snapshot [-r]|delete|show, scrub start|status.)`);
  });
  b['btrfs-convert'] = nur('btrfs-convert', 'btrfs-progs', (w, a, _i, r) => {
    const dev = a.find((x) => x.startsWith('/dev/')) ?? ''; const t = finden(w, dev);
    if (!(r || w.root)) return fehler(`ERROR: cannot open ${dev}: Permission denied`);
    if (!t?.p?.fs) return fehler(`ERROR: cannot open ${dev}: No such file or directory`);
    if (w.platten!.mounts.some((m) => m.quelle === dev)) return fehler(`ERROR: ${dev} is mounted`);
    const fs = t.p.fs;
    if (a.includes('-r')) {
      const z = fs.zusatz as { vorher?: Dateisystem } | undefined;
      if (fs.art !== 'btrfs' || !z?.vorher) return fehler('ERROR: unable to find ext2 image file, has it been deleted?');
      t.p.fs = z.vorher; return ok('Rollback to ext4 succeeded');
    }
    if (!fs.art.startsWith('ext')) return fehler(`ERROR: no file system found to convert`);
    const vorher = JSON.parse(JSON.stringify(fs)) as Dateisystem;
    const neu = neuesFs('btrfs', w.uhr, fs.label, uuid());
    neu.dateien = { ...fs.dateien, '/ext2_saved': null, '/ext2_saved/image': '\u0007BIN:' + fsBytes(t.p) }; neu.metas = { ...fs.metas };
    neu.zusatz = { subvols: [{ id: 256, pfad: 'ext2_saved', uuid: uuid(), ro: true, gen: 1 }], naechste: 257, vorher };
    t.p.fs = neu;
    return ok(`btrfs-convert from btrfs-progs v6.2\n\nSource filesystem:\n  Type:           ${fs.art}\n  Label:          ${fs.label ?? ''}\n  Blocksize:      4096\n  UUID:           ${fs.uuid}\nTarget filesystem:\n  Label:          ${fs.label ?? ''}\n  Blocksize:      4096\n  Nodesize:       16384\n  UUID:           ${neu.uuid}\n  Checksum:       crc32c\n  Features:       extref, skinny-metadata, no-holes, free-space-tree (default)\n    Data csum:    yes\n    Inline data:  yes\n    Copy xattr:   yes\nReported stats:\n  Total space:    ${fsBytes(t.p)}\n  Free space:     ${fsBytes(t.p) - 1093415 * 4096} (${Math.round(100 - 1093415 * 4096 / fsBytes(t.p) * 100)}%)\nCreate initial btrfs filesystem\nCreate ext2 image file\nCreate btrfs metadata\nCopy inodes [o] [         2/        ${11 + Object.keys(fs.dateien).length}]\nConversion complete`);
  });

  // ----- XFS -----
  const xfsVon = (w: Welt, x: string) => { const p = x.startsWith('/dev/') ? x : K.pfad(w, x); const m = w.platten!.mounts.find((y) => (y.ziel === p || y.quelle === p) && y.art === 'xfs'); const t = finden(w, m?.quelle ?? p); return t?.p?.fs?.art === 'xfs' ? { m, p: t.p, d: m?.quelle ?? p } : null; };
  b.xfs_info = mit('xfs_info', (w, a) => {
    const x = xfsVon(w, a[a.length - 1] ?? ''); if (!x) return fehler(`xfs_info: ${a[a.length - 1] ?? ''} is not a mounted XFS filesystem`);
    const bl = Math.floor(fsBytes(x.p) / 4096);
    return ok(`meta-data=${x.d.padEnd(15)} isize=512    agcount=4, agsize=${Math.floor(bl / 4)} blks\n         =                       sectsz=512   attr=2, projid32bit=1\n         =                       crc=1        finobt=1, sparse=1, rmapbt=0\n         =                       reflink=1    bigtime=1 inobtcount=1 nrext64=0\ndata     =                       bsize=4096   blocks=${bl}, imaxpct=25\n         =                       sunit=0      swidth=0 blks\nnaming   =version 2              bsize=4096   ascii-ci=0, ftype=1\nlog      =internal log           bsize=4096   blocks=16384, version=2\n         =                       sectsz=512   sunit=0 blks, lazy-count=1\nrealtime =none                   extsz=4096   blocks=0, rtextents=0`);
  });
  b.xfs_check = mit('xfs_check', () => fehler('bash: xfs_check: Befehl nicht gefunden\n(xfs_check wurde aus den xfsprogs entfernt. Heute prüft man mit xfs_repair -n, das nichts verändert.)', 127));
  b.xfsdump = nur('xfsdump', 'xfsdump', (w, a, _i, r) => {
    const fi = a.indexOf('-f'); const li = a.indexOf('-l'); const Li = a.indexOf('-L'); const Mi = a.indexOf('-M');
    const quelle = a.filter((x, i) => !x.startsWith('-') && ![fi, li, Li, Mi].includes(i - 1)).pop() ?? '';
    const x = xfsVon(w, quelle);
    if (!(r || w.root)) return fehler('xfsdump: ERROR: unable to open inventory: Permission denied');
    if (fi < 0) return fehler('xfsdump: usage: xfsdump [ -f DATEI ] [ -l STUFE ] [ -L SITZUNG ] [ -M MEDIUM ] QUELLE\n(Im Simulator schreibt xfsdump immer in eine Datei: -f.)');
    if (!x?.m) return fehler(`xfsdump: ERROR: ${quelle} does not identify a file system`);
    const datei_ = K.pfad(w, a[fi + 1]); const dir = datei_.slice(0, datei_.lastIndexOf('/')) || '/';
    if (w.fs[dir] !== null) return fehler(`xfsdump: ERROR: unable to create ${datei_}: No such file or directory`);
    const level = li >= 0 ? Number(a[li + 1]) : 0; const label = Li >= 0 ? a[Li + 1] : 'sitzung'; const medium = Mi >= 0 ? a[Mi + 1] : 'medium';
    const dateien: Record<string, string | null> = {};
    for (const k of Object.keys(w.fs).filter((k) => k.startsWith(x.m!.ziel + '/'))) dateien[k.slice(x.m!.ziel.length)] = w.fs[k];
    const id = uuid();
    datei(w, datei_, '\u0007XFSDUMP:' + JSON.stringify({ id, label, medium, level, quelle: x.m.ziel, dev: x.d, dateien }));
    st(w).inventar.push({ id, label, quelle: `${w.host}:${x.m.ziel}`, level, datei: datei_ });
    const n = Object.keys(dateien).length;
    return ok(`xfsdump: using file dump (drive_simple) strategy\nxfsdump: version 3.1.11 (dump format 3.0) - type ^C for status and control\nxfsdump: level ${level} dump of ${w.host}:${x.m.ziel}\nxfsdump: dump date: Mon Nov 23 08:41:00 2026\nxfsdump: session id: ${id}\nxfsdump: session label: "${label}"\nxfsdump: ino map phase 1: constructing initial dump list\nxfsdump: ino map phase 2: skipping (no pruning necessary)\nxfsdump: ino map phase 3: skipping (only one dump stream)\nxfsdump: ino map construction complete\nxfsdump: estimated dump size: ${n * 1052672} bytes\nxfsdump: creating dump session media file 0 (media 0, file 0)\nxfsdump: dumping ino map\nxfsdump: dumping directories\nxfsdump: dumping non-directory files\nxfsdump: ending media file\nxfsdump: media file size ${n * 1052672 + 21640} bytes\nxfsdump: dump size (non-dir files) : ${n * 1048576} bytes\nxfsdump: dump complete: 2 seconds elapsed\nxfsdump: Dump Summary:\nxfsdump:   stream 0 ${datei_} OK (success)\nxfsdump: Dump Status: SUCCESS`);
  });
  b.xfsrestore = nur('xfsrestore', 'xfsdump', (w, a, _i, r) => {
    if (a.includes('-I')) {
      const inv = st(w).inventar; if (!inv.length) return ok('file system 0:\n\t(keine Sicherungen im Inventar)\nxfsrestore: Restore Status: SUCCESS');
      return ok(inv.map((s, i) => `file system ${i}:\n\tfs id:\t\t${s.id.slice(0, 8)}-…\n\tsession ${i}:\n\t\tmount point:\t${s.quelle}\n\t\tdevice:\t\t${s.quelle}\n\t\ttime:\t\tMon Nov 23 08:41:00 2026\n\t\tsession label:\t"${s.label}"\n\t\tsession id:\t${s.id}\n\t\tlevel:\t\t${s.level}\n\t\tresumed:\tNO\n\t\tsubtree:\tNO\n\t\tstreams:\t1\n\t\tstream 0:\n\t\t\tpathname:\t${s.datei}`).join('\n') + '\nxfsrestore: Restore Status: SUCCESS');
    }
    const fi = a.indexOf('-f'); if (fi < 0) return fehler('xfsrestore: usage: xfsrestore -f DATEI [ -t ] ZIEL\n(Im Simulator liest xfsrestore aus einer Datei: -f.)');
    const q = K.pfad(w, a[fi + 1]); const c = w.fs[q];
    if (typeof c !== 'string' || !c.startsWith('\u0007XFSDUMP:')) return fehler(`xfsrestore: ERROR: ${a[fi + 1]}: kein xfsdump-Datenstrom`);
    const d = JSON.parse(c.slice(9)) as { label: string; level: number; quelle: string; dateien: Record<string, string | null> };
    if (a.includes('-t')) return ok(`xfsrestore: using file dump (drive_simple) strategy\nxfsrestore: session label: "${d.label}"\nxfsrestore: level: ${d.level}\nxfsrestore: reading directories\n${Object.keys(d.dateien).filter((k) => d.dateien[k] !== null).map((k) => k.slice(1)).join('\n')}\nxfsrestore: Restore Status: SUCCESS`);
    if (!(r || w.root)) return fehler('xfsrestore: ERROR: Permission denied');
    const ziel = K.pfad(w, a.filter((x, i) => !x.startsWith('-') && i !== fi + 1).pop() ?? '');
    if (w.fs[ziel] !== null) return fehler(`xfsrestore: ERROR: destination directory ${ziel} invalid: No such file or directory`);
    for (const [k, v] of Object.entries(d.dateien)) { w.fs[ziel + k] = v; const m = meta(w, ziel + k); m.mode = v === null ? 0o755 : 0o644; m.owner = 'root'; m.group = 'root'; }
    return ok(`xfsrestore: using file dump (drive_simple) strategy\nxfsrestore: version 3.1.11 (dump format 3.0)\nxfsrestore: searching media for dump\nxfsrestore: examining media file 0\nxfsrestore: dump description:\nxfsrestore: hostname: ${w.host}\nxfsrestore: mount point: ${d.quelle}\nxfsrestore: session label: "${d.label}"\nxfsrestore: media label: "medium"\nxfsrestore: searching media for directory dump\nxfsrestore: reading directories\nxfsrestore: ${Object.values(d.dateien).filter((v) => v === null).length + 1} directories and ${Object.values(d.dateien).filter((v) => v !== null).length} entries processed\nxfsrestore: directory post-processing\nxfsrestore: restoring non-directory files\nxfsrestore: restore complete: 1 seconds elapsed\nxfsrestore: Restore Summary:\nxfsrestore:   stream 0 ${q} OK (success)\nxfsrestore: Restore Status: SUCCESS`);
  });

  // ----- SMART -----
  b.smartctl = mit('smartctl', (w, a, _i, r) => {
    const dev = a.filter((x) => x.startsWith('/dev/')).pop() ?? '';
    const kopf = 'smartctl 7.3 2022-02-28 r5338 [x86_64-linux-6.1.0-27-amd64] (local build)\nCopyright (C) 2002-22, Bruce Allen, Christian Franke, www.smartmontools.org\n';
    if (!dev) return fehler(kopf + '\nERROR: smartctl requires a device name as the final command-line argument.');
    if (!(r || w.root)) return fehler(kopf + `\nSmartctl open device: ${dev} failed: Permission denied`, 2);
    const t = finden(w, dev); if (!t || t.p) return fehler(kopf + `\nSmartctl open device: ${dev} failed: No such device`, 2);
    const pl = t.pl; const nvme = pl.name.startsWith('nvme'); const krank = st(w).opt.smart === 'warnung' && pl.name === 'sdb';
    const info = `=== START OF INFORMATION SECTION ===\n${nvme ? `Model Number:                       ${pl.modell}\nSerial Number:                      S4EWNX0R812345K\nFirmware Version:                   2B2QEXM7\nTotal NVM Capacity:                 500.107.862.016 [500 GB]` : `Device Model:     ${pl.modell}\nSerial Number:    S5SVNG0N912345A\nFirmware Version: SVT02B6Q\nUser Capacity:    250.059.350.016 bytes [250 GB]\nSector Size:      512 bytes logical/physical\nRotation Rate:    Solid State Device\nSATA Version is:  SATA 3.3, 6.0 Gb/s (current: 6.0 Gb/s)\nSMART support is: Available - device has SMART capability.\nSMART support is: Enabled`}\n`;
    const gesund = `=== START OF READ SMART DATA SECTION ===\nSMART overall-health self-assessment test result: PASSED\n`;
    const attr = nvme ? 'SMART/Health Information (NVMe Log 0x02)\nCritical Warning:                   0x00\nTemperature:                        38 Celsius\nAvailable Spare:                    100%\nPercentage Used:                    2%\nPower On Hours:                     4.211\nUnsafe Shutdowns:                   37\nMedia and Data Integrity Errors:    0\n' : `SMART Attributes Data Structure revision number: 1\nVendor Specific SMART Attributes with Thresholds:\nID# ATTRIBUTE_NAME          FLAG     VALUE WORST THRESH TYPE      UPDATED  WHEN_FAILED RAW_VALUE\n  5 Reallocated_Sector_Ct   0x0033   ${krank ? '092' : '100'}   ${krank ? '092' : '100'}   010    Pre-fail  Always       -       ${krank ? 312 : 0}\n  9 Power_On_Hours          0x0032   097   097   000    Old_age   Always       -       12873\n 12 Power_Cycle_Count       0x0032   099   099   000    Old_age   Always       -       211\n177 Wear_Leveling_Count     0x0013   096   096   000    Pre-fail  Always       -       41\n187 Reported_Uncorrect      0x0032   ${krank ? '097' : '100'}   ${krank ? '097' : '100'}   000    Old_age   Always       -       ${krank ? 14 : 0}\n194 Temperature_Celsius     0x0022   064   051   000    Old_age   Always       -       36\n197 Current_Pending_Sector  0x0012   ${krank ? '099' : '100'}   ${krank ? '099' : '100'}   000    Old_age   Always       -       ${krank ? 27 : 0}\n198 Offline_Uncorrectable   0x0010   ${krank ? '099' : '100'}   ${krank ? '099' : '100'}   000    Old_age   Offline      -       ${krank ? 27 : 0}\n199 UDMA_CRC_Error_Count    0x003e   100   100   000    Old_age   Always       -       0\n`;
    const tests = st(w).smartTest.filter((x) => x.startsWith(pl.name + '|')).map((x) => x.split('|')[1]);
    const log = `SMART Self-test log structure revision number 1\nNum  Test_Description    Status                  Remaining  LifeTime(hours)  LBA_of_first_error\n${tests.map((tt, i) => `# ${i + 1}  ${tt === 'long' ? 'Extended offline' : 'Short offline   '}    ${krank ? 'Completed: read failure       90%' : 'Completed without error       00%'}     12873         ${krank ? '183447216' : '-'}`).reverse().join('\n') || 'No self-tests have been logged.  [To run self-tests, use: smartctl -t]'}\n`;
    if (a.includes('-t')) {
      const art = a[a.indexOf('-t') + 1]; if (!['short', 'long', 'conveyance'].includes(art)) return fehler(kopf + `\n=======> INVALID ARGUMENT TO -t: ${art}`);
      st(w).smartTest.push(`${pl.name}|${art}`);
      return ok(kopf + `\n=== START OF OFFLINE IMMEDIATE AND SELF-TEST SECTION ===\nSending command: "Execute SMART ${art === 'long' ? 'Extended' : 'Short'} self-test routine immediately in off-line mode".\nDrive command "Execute SMART ${art === 'long' ? 'Extended' : 'Short'} self-test routine immediately in off-line mode" successful.\nTesting has begun.\nPlease wait ${art === 'long' ? 42 : 2} minutes for test to complete.\n(Im Simulator ist der Test sofort fertig. Ergebnis: smartctl -l selftest ${dev})`);
    }
    const teile: string[] = [kopf];
    const flags = a.filter((x) => x.startsWith('-'));
    const voll = flags.includes('-a') || flags.includes('-x') || flags.includes('--all');
    if (voll || flags.includes('-i') || flags.includes('--info')) teile.push(info);
    if (voll || flags.includes('-H') || flags.includes('--health')) teile.push(gesund);
    if (voll || flags.includes('-A') || flags.includes('--attributes')) teile.push(attr);
    if (voll || a.includes('selftest')) teile.push(log);
    if (teile.length === 1) return fehler(kopf + '\n(Sag smartctl, was du sehen willst: -i, -H, -A, -a oder -l selftest.)');
    return { out: teile.join('\n'), code: krank && (voll || a.includes('selftest')) ? 64 : 0 };
  });
  b.smartd = mit('smartd', (w, a) => {
    if (a.includes('-q') && a.includes('onecheck')) { const c = (w.fs['/etc/smartd.conf'] ?? '').split('\n').filter((z) => z.trim() && !z.trim().startsWith('#')); return ok(`smartd 7.3 2022-02-28 r5338 [x86_64-linux-6.1.0-27-amd64] (local build)\nOpened configuration file /etc/smartd.conf\nConfiguration file /etc/smartd.conf parsed.\n${c.map((z) => `Device: ${z.split(/\s+/)[0]}, opened`).join('\n')}\nMonitoring ${c.length} ATA/SATA, 0 SCSI/SAS and 0 NVMe devices`); }
    return fehler('(smartd läuft als Dienst: systemctl restart smartd. Zum Prüfen der Konfiguration: smartd -q onecheck)');
  });

  // ----- AutoFS und systemctl -----
  b.automount = nur('automount', 'autofs', (w, a) => {
    if (a.includes('-m')) { autofsLaden(w); return ok(st(w).autofs.indirekt.map((x) => `\nMount point: ${x.mp}\n\nsource(s):\n\n  type: file map: ${x.map}\n\n${st(w).autofs.maps.filter((e) => e.mp === x.mp).map((e) => `  ${e.key} | ${[e.art && e.art !== 'auto' ? `fstype=${e.art}` : '', e.optionen].filter(Boolean).length ? '-' + [e.art && e.art !== 'auto' ? `fstype=${e.art}` : '', e.optionen].filter(Boolean).join(',') : ''} ${e.quelle}`).join('\n')}`).join('\n') + (st(w).autofs.maps.some((e) => e.direkt) ? `\nMount point: /-\n\n${st(w).autofs.maps.filter((e) => e.direkt).map((e) => `  ${e.key} | ${e.quelle}`).join('\n')}` : '')); }
    return fehler('(automount läuft als Dienst: systemctl start autofs. Die geladenen Maps zeigt automount -m.)');
  });
  b.systemctl = (w, a, i, r) => {
    if (!dsysAktiv(w)) return alt.systemctl(w, a, i, r);
    const rest = a.filter((x) => !x.startsWith('-')); const [cmd, unit] = rest;
    const n = (unit ?? '').replace(/\.service$/, '');
    if (n === 'autofs' && hat(w, 'automount')) {
      const s = st(w).autofs;
      if (cmd === 'status') return { out: `${s.laeuft ? '●' : '○'} autofs.service - Automounts filesystems on demand\n     Loaded: loaded (/lib/systemd/system/autofs.service; ${s.aktiviert ? 'enabled' : 'disabled'}; preset: enabled)\n     Active: ${s.laeuft ? 'active (running) since Mon 2026-11-23 08:41:00 CET' : 'inactive (dead)'}\n${((w as Welt & { autofsJournal?: string[] }).autofsJournal ?? []).slice(-4).map((z) => `Nov 23 08:41:00 ${w.host} ${z}`).join('\n')}`, code: s.laeuft ? 0 : 3 };
      if (cmd === 'is-active') return { out: s.laeuft ? 'active' : 'inactive', code: s.laeuft ? 0 : 3 };
      if (!(r || w.root)) return fehler(`Failed to ${cmd} autofs.service: Access denied`);
      if (cmd === 'start' || cmd === 'restart' || cmd === 'reload' || cmd === 'try-restart') { if (cmd === 'reload' && !s.laeuft) return fehler('autofs.service is not active, cannot reload.'); if (cmd === 'restart') autofsStop(w); autofsStart(w); sync(w); return ok(); }
      if (cmd === 'stop') { autofsStop(w); sync(w); return ok(); }
      if (cmd === 'enable' || cmd === 'disable') { s.aktiviert = cmd === 'enable'; if (a.includes('--now')) { if (cmd === 'enable') autofsStart(w); else autofsStop(w); } sync(w); return ok(cmd === 'enable' ? 'Synchronizing state of autofs.service with SysV service script with /lib/systemd/systemd-sysv-install.' : ''); }
    }
    if ((n === 'smartd' || n === 'smartmontools') && hat(w, 'smartctl')) {
      if (cmd === 'status') return ok(`● smartmontools.service - Self Monitoring and Reporting Technology (SMART) Daemon\n     Loaded: loaded (/lib/systemd/system/smartmontools.service; enabled; preset: enabled)\n     Active: active (running) since Mon 2026-11-23 08:41:00 CET\n${smartdMeldungen(w).map((z) => `Nov 23 08:41:00 ${w.host} smartd[611]: ${z}`).join('\n')}`);
      if (!(r || w.root)) return fehler(`Failed to ${cmd} smartmontools.service: Access denied`);
      if (['restart', 'reload', 'start'].includes(cmd)) { st(w).smartdConf = w.fs['/etc/smartd.conf'] ?? ''; return ok(); }
    }
    if (unit?.endsWith('.automount')) {
      const datei_ = ['/etc/systemd/system/', '/usr/lib/systemd/system/'].map((d) => d + unit).find((p) => typeof w.fs[p] === 'string');
      if (cmd === 'status') { const where = Object.entries(st(w).automount).find(([, u]) => u === unit.replace(/\.automount$/, '.mount'))?.[0]; return { out: `${where ? '●' : '○'} ${unit}\n     Loaded: ${datei_ ? `loaded (${datei_})` : 'not-found'}\n     Active: ${where ? `active (${w.platten!.mounts.some((m) => m.ziel === where) ? 'running' : 'waiting'})` : 'inactive (dead)'}${where ? `\n   Triggers: ● ${unit.replace(/\.automount$/, '.mount')}\n      Where: ${where}` : ''}`, code: where ? 0 : 3 }; }
      if (!(r || w.root)) return fehler(`Failed to ${cmd} ${unit}: Access denied`);
      if (!datei_) return fehler(`Failed to ${cmd} ${unit}: Unit ${unit} not found.`);
      const where = (w.fs[datei_] ?? '').match(/^Where=(.+)$/m)?.[1]?.trim();
      if (!where) return fehler(`Failed to ${cmd} ${unit}: Unit ${unit} has a bad unit file setting.`);
      const mu = unit.replace(/\.automount$/, '.mount');
      if (['start', 'restart'].includes(cmd) || (cmd === 'enable' && a.includes('--now'))) { ordner(w, where); st(w).automount[where] = mu; sync(w); }
      if (cmd === 'stop') { delete st(w).automount[where]; sync(w); }
      return ok(cmd === 'enable' ? `Created symlink /etc/systemd/system/local-fs.target.wants/${unit} → ${datei_}.` : '');
    }
    if (unit?.endsWith('.mount') && (cmd === 'enable' || cmd === 'disable') && a.includes('--now')) {
      const e = alt.systemctl(w, [cmd, unit], i, r); if (e.code) return e;
      const s2 = alt.systemctl(w, [cmd === 'enable' ? 'start' : 'stop', unit], i, r); sync(w);
      return s2.code ? s2 : e;
    }
    const x = alt.systemctl(w, a, i, r);
    if (cmd === 'daemon-reload') fstabAutomount(w);
    sync(w); return x;
  };

  // ----- ISO, UDF -----
  const iso: B = (w, a, _i, r) => {
    const wert = (o: string) => { const i = a.indexOf(o); return i >= 0 ? a[i + 1] : undefined; };
    const o = wert('-o'); const quelle = a.filter((x, i) => !x.startsWith('-') && !['-o', '-V', '-b', '-c', '-A', '-p', '-boot-load-size', '-eltorito-boot', '-volid'].includes(a[i - 1])).pop();
    if (!o || !quelle) return fehler('I: -input-charset not specified, using utf-8 (detected in locale settings)\ngenisoimage: Missing pathspec.\nUsage: genisoimage [options] -o file directory ...');
    const q = K.pfad(w, quelle); if (w.fs[q] !== null) return fehler(`genisoimage: No such file or directory. Invalid node - '${quelle}'.`);
    const z = K.pfad(w, o); const dir = z.slice(0, z.lastIndexOf('/')) || '/';
    if (!(r || w.root) && !dir.startsWith('/home/lena') && !dir.startsWith('/tmp')) return fehler(`genisoimage: Permission denied. Unable to open disc image file '${o}'.`);
    const dateien: Record<string, string | null> = {};
    for (const k of Object.keys(w.fs).filter((k) => k.startsWith(q + '/'))) dateien[k.slice(q.length)] = w.fs[k];
    const boot = wert('-b');
    if (boot && typeof dateien['/' + boot] !== 'string') return fehler(`genisoimage: Uh oh, I cant find the boot image '${boot}' !`);
    const rr = a.includes('-R') || a.includes('-r') || a.includes('-rock'); const joliet = a.includes('-J') || a.includes('-joliet');
    const label = wert('-V') ?? 'CDROM';
    const bytes = Object.values(dateien).reduce((s, c) => s + Math.ceil(bytesVon(c) / 2048) * 2048, 0) + 374784;
    datei(w, z, abbildText({ art: 'iso9660', label, rr, joliet, boot, dateien, bytes }), 0o644, r || w.root ? 'root' : 'lena');
    return { out: `Total translation table size: ${boot ? 2048 : 0}\nTotal rockridge attributes bytes: ${rr ? 1062 : 0}\nTotal directory bytes: ${Object.values(dateien).filter((v) => v === null).length * 2048 + 2048}\nPath table size(bytes): 26\nMax brk space used ${rr ? '22000' : '0'}\n${Math.ceil(bytes / 2048)} extents written (${Math.round(bytes / 1048576)} MB)`, err: `I: -input-charset not specified, using utf-8 (detected in locale settings)${!rr && !joliet ? '\nWarning: creating filesystem that does not conform to ISO-9660.\n(Ohne -R oder -J gelten die kurzen Dateinamen nach ISO 9660.)' : ''}${boot ? `\nSize of boot image is 4 sectors -> No emulation` : ''}`, code: 0 };
  };
  b.genisoimage = nur('genisoimage', 'genisoimage', iso);
  b.mkisofs = nur('mkisofs', 'genisoimage', iso);
  b.isoinfo = nur('isoinfo', 'genisoimage', (w, a) => {
    const i = a.indexOf('-i'); const ab = abbild(w.fs[K.pfad(w, a[i + 1] ?? '')] ?? null);
    if (i < 0 || !ab || ab.art !== 'iso9660') return fehler(`isoinfo: Unable to open file ${a[i + 1] ?? ''}`);
    if (a.includes('-d')) return ok(`CD-ROM is in ISO 9660 format\nSystem id: LINUX\nVolume id: ${ab.label}\nVolume set id: \nPublisher id: \nData preparer id: \nApplication id: GENISOIMAGE ISO 9660/HFS FILESYSTEM CREATOR (C) 1993 E.YOUNGDALE (C) 1997-2006 J.PEARSON/J.SCHILLING (C) 2006-2007 CDRKIT TEAM\nCopyright File id: \nAbstract File id: \nBibliographic File id: \nVolume set size is: 1\nVolume set sequence number is: 1\nLogical block size is: 2048\nVolume size is: ${Math.ceil(ab.bytes / 2048)}\n${ab.boot ? `El Torito VD version 1 found, boot catalog is in sector 33\n` : ''}${ab.joliet ? 'Joliet with UCS level 3 found\n' : 'NO Joliet present\n'}${ab.rr ? 'Rock Ridge signatures version 1 found\nRock Ridge id \'RRIP_1991A\'\n' : 'NO Rock Ridge present\n'}${ab.boot ? `Eltorito validation header:\n    Hid 1\n    Arch 0 (x86)\n    ID ''\n    Key 55 AA\n    Eltorito defaultboot header:\n        Bootid 88 (bootable)\n        Boot media 0 (No Emulation Boot)\n        Load segment 0\n        Sys type 0\n        Nsect 4` : ''}`);
    if (a.includes('-l') || a.includes('-f')) return ok(Object.keys(ab.dateien).map((k) => ab.rr || ab.joliet ? k : k.split('/').map((t, j, l) => (t ? isoName(t, j < l.length - 1 || ab.dateien[k] === null) : t)).join('/')).join('\n'));
    return fehler('(isoinfo kennt im Simulator -d -i DATEI und -f -i DATEI.)');
  });
  b.mkudffs = nur('mkudffs', 'udftools', (w, a, _i, r) => {
    const li = a.findIndex((x) => x === '-l' || x.startsWith('--label=') || x === '--vid'); const label = li >= 0 ? (a[li].includes('=') ? a[li].split('=')[1] : a[li + 1]) : 'LinuxUDF';
    const z = a.filter((x, i) => !x.startsWith('-') && (li < 0 || i !== li + 1)).pop() ?? '';
    const p = K.pfad(w, z);
    if (typeof w.fs[p] !== 'string') return fehler(`mkudffs: Error: Cannot open device '${z}': No such file or directory`);
    if (!(r || w.root) && meta(w, p).owner !== 'lena') return fehler(`mkudffs: Error: Cannot open device '${z}': Permission denied`);
    const n = bytesVon(w.fs[p]);
    w.fs[p] = abbildText({ art: 'udf', label, dateien: {}, bytes: n });
    return ok(`filename=${z}\nlabel=${label}\nuuid=${uuid().replace(/-/g, '').slice(0, 16)}\nblocksize=2048\nblocks=${Math.floor(n / 2048)}\nudfrev=2.01\nvatblock=0\nstart=0, blocks=16, type=ERASE \nstart=16, blocks=4, type=VRS \nstart=20, blocks=12, type=ERASE \nstart=32, blocks=16, type=MVDS \n…`);
  });

  // ----- LUKS -----
  b.cryptsetup = nur('cryptsetup', 'cryptsetup', (w, a, _i, r) => {
    const rest = a.filter((x, i) => !x.startsWith('-') && !['--type', '-c', '--cipher', '-s', '--key-size', '-d', '--key-file'].includes(a[i - 1]));
    let [cmd, x1, x2] = rest;
    if (cmd === 'luksOpen') { cmd = 'open'; }
    if (!cmd) return fehler('Usage: cryptsetup [OPTION...] <action> <action-specific>\n(Im Simulator: luksFormat, open, close, status, luksDump, luksAddKey, luksRemoveKey, isLuks)');
    if (cmd !== 'status' && cmd !== 'isLuks' && !(r || w.root)) return fehler(`Gerät ${x1 ?? ''} existiert nicht oder Zugriff verweigert.`, 4);
    const pl = w.platten!; pl.mapper ??= {};
    const geraet = (d: string) => { const t = finden(w, d); return t?.p ? t.p : null; };
    const luksVon = (p: Partition) => (p.fs?.art === 'crypto_LUKS' ? p.fs.zusatz as { pw: string[]; inhalt?: Dateisystem; cipher: string } : null);
    if (cmd === 'isLuks') { const p = geraet(x1 ?? ''); return { out: '', code: p && luksVon(p) ? 0 : 1 }; }
    if (cmd === 'luksFormat') {
      const p = geraet(x1 ?? ''); if (!p) return fehler(`Gerät ${x1 ?? ''} existiert nicht oder Zugriff verweigert.`, 4);
      if (pl.mounts.some((m) => m.quelle === x1)) return fehler(`Kann Gerät ${x1} nicht exklusiv öffnen: Das Gerät oder die Ressource ist belegt (es ist eingehängt).`, 5);
      const los = () => { K.dialog(w, `Geben Sie die Passphrase für »${x1}« ein: `, (p1) => { K.dialog(w, 'Passphrase bestätigen: ', (p2) => { if (p1 !== p2) return 'Passphrasen stimmen nicht überein.'; if (!p1) return 'Leere Passphrase.'; const fs = neuesFs('crypto_LUKS', w.uhr, undefined, uuid()); fs.zusatz = { pw: [p1], cipher: 'aes-xts-plain64' }; p.fs = fs; w.verlauf.push({ zeile: '#luksFormat ' + x1, code: 0, ausgabe: '' }); return ''; }); return ''; }); };
      if (a.includes('-q') || a.includes('--batch-mode')) { los(); return ok(); }
      K.dialog(w, `\nWARNUNG!\n========\nHiermit werden die Daten auf »${x1}« unwiderruflich überschrieben.\n\nAre you sure? (Type 'yes' in capital letters): `, (z) => { if (z.trim() !== 'YES') return 'Vorgang abgebrochen.'; los(); return ''; });
      return ok();
    }
    if (cmd === 'open') {
      const p = geraet(x1 ?? ''); const l = p && luksVon(p);
      if (!p) return fehler(`Gerät ${x1 ?? ''} existiert nicht oder Zugriff verweigert.`, 4);
      if (!l) return fehler(`Gerät ${x1} ist kein gültiges LUKS-Gerät.`, 1);
      if (!x2) return fehler('Command open requires device and mapped name as arguments.\n(cryptsetup open GERÄT NAME)');
      if (pl.mapper[x2]) return fehler(`Gerät ${x2} existiert bereits.`, 5);
      K.dialog(w, `Geben Sie die Passphrase für »${x1}« ein: `, (z) => {
        if (!l.pw.filter(Boolean).includes(z)) return 'Keine Schlüssel mit dieser Passphrase verfügbar.';
        const inhalt: Partition = { nr: 1, start: 0, ende: p.ende - p.start - 32768, typ: 'Linux-Dateisystem', partuuid: '', fs: l.inhalt };
        pl.mapper![x2] = inhalt; const dm = 'dm-' + (Object.keys(pl.mapper!).length - 1); w.fs['/dev/' + dm] = ''; meta(w, '/dev/' + dm).mode = 0o660; w.fs['/dev/mapper/' + x2] = '-> ../' + dm; meta(w, '/dev/mapper/' + x2).mode = 0o777;
        (pl as unknown as { mapQuelle?: Record<string, string> }).mapQuelle = { ...((pl as unknown as { mapQuelle?: Record<string, string> }).mapQuelle ?? {}), [x2]: x1 };
        return '';
      });
      return ok();
    }
    if (cmd === 'close' || cmd === 'luksClose') {
      const m = pl.mapper[x1 ?? '']; if (!m) return fehler(`Gerät ${x1 ?? ''} ist nicht aktiv.`, 4);
      if (pl.mounts.some((y) => y.quelle === '/dev/mapper/' + x1)) return fehler(`Gerät ${x1} ist noch in Benutzung.`, 5);
      const quelle = (pl as unknown as { mapQuelle?: Record<string, string> }).mapQuelle?.[x1!]; const p = quelle ? geraet(quelle) : null; const l = p && luksVon(p);
      if (l) l.inhalt = m.fs;
      const link = w.fs['/dev/mapper/' + x1]; if (typeof link === 'string' && link.startsWith('-> ../')) delete w.fs['/dev/' + link.slice(6)];
      delete pl.mapper[x1!]; delete w.fs['/dev/mapper/' + x1];
      return ok();
    }
    if (cmd === 'status') {
      const m = pl.mapper[x1 ?? '']; if (!m) return { out: `/dev/mapper/${x1 ?? ''} is inactive.`, code: 4 };
      const quelle = (pl as unknown as { mapQuelle?: Record<string, string> }).mapQuelle?.[x1!] ?? '?';
      return ok(`/dev/mapper/${x1} is active${pl.mounts.some((y) => y.quelle === '/dev/mapper/' + x1) ? ' and is in use' : ''}.\n  type:    LUKS2\n  cipher:  aes-xts-plain64\n  keysize: 512 bits\n  key location: keyring\n  device:  ${quelle}\n  sector size:  512\n  offset:  32768 sectors\n  size:    ${m.ende + 1} sectors\n  mode:    read/write`);
    }
    if (cmd === 'luksDump') {
      const p = geraet(x1 ?? ''); const l = p && luksVon(p); if (!l) return fehler(`Gerät ${x1 ?? ''} ist kein gültiges LUKS-Gerät.`, 1);
      return ok(`LUKS header information\nVersion:       \t2\nEpoch:         \t${3 + l.pw.length}\nMetadata area: \t16384 [bytes]\nKeyslots area: \t16744448 [bytes]\nUUID:          \t${p!.fs!.uuid}\nLabel:         \t(no label)\nSubsystem:     \t(no subsystem)\nFlags:       \t(no flags)\n\nData segments:\n  0: crypt\n\toffset: 16777216 [bytes]\n\tlength: (whole device)\n\tcipher: ${l.cipher}\n\tsector: 512 [bytes]\n\nKeyslots:\n${l.pw.map((pw, i) => (pw ? `  ${i}: luks2\n\tKey:        512 bits\n\tPriority:   normal\n\tCipher:     aes-xts-plain64\n\tCipher key: 512 bits\n\tPBKDF:      argon2id` : '')).filter(Boolean).join('\n')}\nTokens:\nDigests:\n  0: pbkdf2\n\tHash:       sha256`);
    }
    if (cmd === 'luksAddKey' || cmd === 'luksRemoveKey') {
      const p = geraet(x1 ?? ''); const l = p && luksVon(p); if (!l) return fehler(`Gerät ${x1 ?? ''} ist kein gültiges LUKS-Gerät.`, 1);
      if (cmd === 'luksRemoveKey') { K.dialog(w, `Geben Sie die zu löschende Passphrase ein: `, (z) => { const i = l.pw.indexOf(z); if (i < 0 || !z) return 'Keine Schlüssel mit dieser Passphrase verfügbar.'; if (l.pw.filter(Boolean).length === 1) return 'WARNUNG: Das ist der letzte Schlüssel. Im Simulator wird er nicht gelöscht, sonst wären die Daten verloren.'; l.pw[i] = ''; return ''; }); return ok(); }
      K.dialog(w, 'Geben Sie irgendeine bestehende Passphrase ein: ', (alt_) => {
        if (!l.pw.filter(Boolean).includes(alt_)) return 'Keine Schlüssel mit dieser Passphrase verfügbar.';
        K.dialog(w, `Geben Sie die neue Passphrase für das Schlüsselfach ein: `, (n1) => { K.dialog(w, 'Passphrase bestätigen: ', (n2) => { if (n1 !== n2) return 'Passphrasen stimmen nicht überein.'; const frei = l.pw.indexOf(''); if (frei >= 0) l.pw[frei] = n1; else l.pw.push(n1); return ''; }); return ''; });
        return '';
      });
      return ok();
    }
    return fehler(`Unbekannte Aktion: ${cmd}`);
  });

  return b;
}

// ---------- AutoFS ----------
function autofsLaden(w: Welt) {
  const s = st(w).autofs; s.maps = []; s.indirekt = [];
  const master = [w.fs['/etc/auto.master'] ?? '', ...Object.keys(w.fs).filter((k) => k.startsWith('/etc/auto.master.d/') && k.endsWith('.autofs')).sort().map((k) => w.fs[k] ?? '')].join('\n');
  for (const z of master.split('\n').map((x) => x.trim()).filter((x) => x && !x.startsWith('#') && !x.startsWith('+'))) {
    const [mp, map, ...opt] = z.split(/\s+/);
    if (!map || map === '-hosts') continue;
    const timeout = Number((opt.join(' ').match(/--timeout[= ](\d+)/) ?? [])[1] ?? 300);
    const text = w.fs[map] ?? null;
    if (typeof text !== 'string') { journal(w, `automount[1412]: lookup(file): file map ${map} missing or not readable`); continue; }
    if (mp !== '/-') { s.indirekt.push({ mp, timeout, map }); ordner(w, mp); }
    for (const e of text.split('\n').map((x) => x.trim()).filter((x) => x && !x.startsWith('#'))) {
      const teile = e.split(/\s+/); const key = teile[0]; const optT = teile.find((x) => x.startsWith('-')) ?? ''; const quelle = teile[teile.length - 1];
      const o = optT.replace(/^-/, '').split(',').filter(Boolean);
      const art = o.find((x) => x.startsWith('fstype='))?.slice(7) ?? (quelle.startsWith(':') ? 'auto' : 'nfs');
      if (!['ext2', 'ext3', 'ext4', 'xfs', 'btrfs', 'vfat', 'nfs', 'nfs4', 'auto', 'iso9660', 'udf'].includes(art)) journal(w, `automount[1412]: >> mount: ${mp}/${key}: unbekannter Dateisystemtyp »${art}«.`);
      s.maps.push({ mp, key, quelle, art, optionen: o.filter((x) => !x.startsWith('fstype=')).join(','), direkt: mp === '/-' });
    }
  }
}
function autofsStart(w: Welt) { const s = st(w).autofs; autofsLaden(w); s.laeuft = true; journal(w, 'systemd[1]: Started autofs.service - Automounts filesystems on demand.'); }
function autofsStop(w: Welt) {
  const s = st(w).autofs; s.laeuft = false;
  for (const m of [...w.platten!.mounts]) if (m.extra === 'auto') aushaengen(w, m);
}
function fstabAutomount(w: Welt) {
  const s = st(w);
  for (const k of Object.keys(s.automount)) if (s.automount[k].startsWith('fstab:')) delete s.automount[k];
  for (const z of (w.fs['/etc/fstab'] ?? '').split('\n').map((x) => x.trim()).filter((x) => x && !x.startsWith('#'))) {
    const f = z.split(/\s+/); if (!(f[3] ?? '').includes('x-systemd.automount')) continue;
    ordner(w, f[1]); s.automount[f[1]] = 'fstab:' + f[1];
  }
}
function smartdMeldungen(w: Welt): string[] {
  const conf = st(w).smartdConf ?? ''; const z: string[] = [];
  const zeilen = conf.split('\n').map((x) => x.trim()).filter((x) => x && !x.startsWith('#'));
  if (zeilen.some((x) => x.startsWith('DEVICESCAN'))) z.push('Device: /dev/sdb [SAT], opened', 'Device: /dev/nvme0, opened');
  else for (const x of zeilen) z.push(`Device: ${x.split(/\s+/)[0]}, opened`);
  if (st(w).opt.smart === 'warnung' && z.some((x) => x.includes('/dev/sdb'))) z.push('Device: /dev/sdb [SAT], 27 Currently unreadable (pending) sectors', 'Device: /dev/sdb [SAT], 27 Offline uncorrectable sectors', 'Device: /dev/sdb [SAT], SMART Prefailure Attribute: 5 Reallocated_Sector_Ct changed from 100 to 92', ...(/\s-m\s+\S+/.test(conf) ? ['Sending warning via /usr/share/smartmontools/smartd-runner to root ...', 'Warning via /usr/share/smartmontools/smartd-runner to root: successful'] : []));
  return z;
}

// automount über fstab: systemctl start mit Pseudo-Unit
export function dsysMountUnit(w: Welt, unit: string): { what: string; where: string; type: string; opt: string } | null {
  if (!unit.startsWith('fstab:')) return null;
  const where = unit.slice(6);
  const f = (w.fs['/etc/fstab'] ?? '').split('\n').map((x) => x.trim().split(/\s+/)).find((x) => x[1] === where);
  return f ? { what: f[0], where, type: f[2], opt: (f[3] ?? '').split(',').filter((o) => !o.startsWith('x-systemd') && o !== 'noauto' && o !== 'defaults').join(',') } : null;
}

// ---------- Zustand ----------
export function zustandDsys(w: Welt, s: string): boolean | undefined {
  let m;
  if (!/^(swapdatei|swapprio|superblock|subvol|snapshot|btrfs|xfsdump|smarttest|smartd|autofs|automount|luks|mapper|isobild|udfbild|loop|nfs)[:=~]/.test(s)) return undefined;
  if (!dsysAktiv(w)) return false;
  const d = st(w);
  if ((m = s.match(/^swapdatei:(.+)=(an|aus|bereit)$/))) return m[2] === 'bereit' ? !!d.swapDateien[m[1]] : w.platten!.swaps.includes(m[1]) === (m[2] === 'an');
  if ((m = s.match(/^swapprio:(.+)=(-?\d+)$/))) return w.platten!.swaps.includes(m[1]) && d.prio[m[1]] === Number(m[2]);
  if ((m = s.match(/^superblock:(\/dev\/\w+)=(heil|kaputt)$/))) { const t = finden(w, m[1]); return !!t?.p?.fs && !t.p.fs.superKaputt === (m[2] === 'heil'); }
  if ((m = s.match(/^(subvol|snapshot):(.+?)(=ro)?$/))) {
    const p = m[2]; const mm = w.platten!.mounts.filter((x) => x.art === 'btrfs' && (p === x.ziel || p.startsWith(x.ziel + '/'))).sort((x, y) => y.ziel.length - x.ziel.length)[0];
    if (!mm) return false; const z = finden(w, mm.quelle)!.p!.fs!.zusatz as { subvols: { pfad: string; ro: boolean; von?: string }[] };
    const sv = z.subvols.find((x) => x.pfad === p.slice(mm.ziel.length + 1)); if (!sv) return false;
    if (m[1] === 'snapshot' && !sv.von) return false; if (m[3] && !sv.ro) return false; return true;
  }
  if ((m = s.match(/^btrfs:(\/dev\/\w+)$/))) return finden(w, m[1])?.p?.fs?.art === 'btrfs';
  if ((m = s.match(/^xfsdump:(.+)$/))) return typeof w.fs[m[1]] === 'string' && String(w.fs[m[1]]).startsWith('\u0007XFSDUMP:');
  if ((m = s.match(/^smarttest:(\w+)$/))) return d.smartTest.some((x) => x.startsWith(m![1] + '|'));
  if ((m = s.match(/^smartd~(.+)$/))) return new RegExp(m[1], 'm').test(d.smartdConf ?? '');
  if (s === 'autofs:laeuft') return d.autofs.laeuft;
  if ((m = s.match(/^autofs:map=(.+)$/))) return d.autofs.maps.some((e) => (e.direkt ? e.key : `${e.mp}/${e.key}`) === m![1]);
  if ((m = s.match(/^automount:(.+)=(bereit|eingehaengt)$/))) { const ein = w.platten!.mounts.find((x) => x.ziel === m![1]); return m[2] === 'eingehaengt' ? !!ein && !!ein.extra?.startsWith('auto') : !!d.automount[m[1]] || d.autofs.maps.some((e) => (e.direkt ? e.key : `${e.mp}/${e.key}`) === m![1]); }
  if ((m = s.match(/^luks:(\/dev\/\w+)$/))) return finden(w, m[1])?.p?.fs?.art === 'crypto_LUKS';
  if ((m = s.match(/^luks:(\/dev\/\w+)=(\d+)schluessel$/))) { const z = finden(w, m[1])?.p?.fs?.zusatz as { pw?: string[] } | undefined; return (z?.pw ?? []).filter(Boolean).length === Number(m[2]); }
  if ((m = s.match(/^mapper:(\w+)=(\/.*)$/))) return w.platten!.mounts.some((x) => x.quelle === '/dev/mapper/' + m![1] && x.ziel === m![2]);
  if ((m = s.match(/^mapper:(\w+)=(offen|zu)$/))) return !!w.platten!.mapper?.[m[1]] === (m[2] === 'offen');
  if ((m = s.match(/^(isobild|udfbild):(.+?)(=rr|=joliet|=boot|=rrjoliet)?$/))) { const ab = abbild(w.fs[m[2]] ?? null); if (!ab || ab.art !== (m[1] === 'isobild' ? 'iso9660' : 'udf')) return false; if (m[3] === '=rr') return !!ab.rr; if (m[3] === '=joliet') return !!ab.joliet; if (m[3] === '=rrjoliet') return !!ab.rr && !!ab.joliet; if (m[3] === '=boot') return !!ab.boot; return true; }
  if ((m = s.match(/^loop:(.+)$/))) return w.platten!.mounts.some((x) => x.ziel === m![1] && x.extra?.startsWith('loop:'));
  if ((m = s.match(/^nfs:(.+)$/))) return w.platten!.mounts.some((x) => x.ziel === m![1] && x.art.startsWith('nfs'));
  return undefined;
}
