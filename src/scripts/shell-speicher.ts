// Fortgeschrittene Speicherverwaltung für den Simulator (LPIC-2 Topic 204): Software-RAID mit mdadm und
// /proc/mdstat, sfdisk zum Kopieren von Partitionstabellen, hdparm, sdparm, nvme, fstrim, iSCSI mit iscsiadm,
// LVM mit physischen Volumes, Volume Groups, logischen Volumes, Größenänderung, Snapshots und Aktivierung.
// Ohne Welt-Option `speicher` bleibt alles wie bisher.
import type { Welt } from './shell';
import { meta } from './shell-dateien';
import { VIRT, finden, neuesFs, fsBytes, menschGroesse, teilName, type Dateisystem, type Partition, type Platte } from './shell-platten';

type Ergebnis = { out: string; err?: string; code: number };
type B = (w: Welt, a: string[], stdin: string, root: boolean) => Ergebnis;
const ok = (out = ''): Ergebnis => ({ out, code: 0 });
const fehler = (err: string, code = 1): Ergebnis => ({ out: '', err, code });

export interface SpKern { pfad: (w: Welt, p: string) => string; dialog: (w: Welt, prompt: string, weiter: (z: string) => string) => void }
let K: SpKern;
export function spKern(k: SpKern) { K = k; }

export interface SpeicherOptionen {
  platten?: number;                         // so viele leere 1-TB-Platten (sdc, sdd, …)
  partitioniert?: boolean;                  // jede neue Platte hat eine Partition (Typ 83)
  raid?: 'raid1' | 'kaputt' | 'raid5';      // fertiges Array /dev/md0; kaputt: ein Mitglied ausgefallen
  lvm?: 'fertig' | 'voll';                  // VG daten mit LV messungen (ext4) und archiv (xfs)
  iscsi?: boolean;                          // srv1 bietet ein iSCSI-Ziel an
}

interface MdGeraet { dev: string; rolle: 'aktiv' | 'faulty' | 'spare' | 'neu'; nr: number }
interface Md { name: string; level: number; uuid: string; n: number; chunk: number; devs: MdGeraet[]; p: Partition; laeuft: boolean; sync: null | { art: 'resync' | 'recovery' | 'reshape'; start: number; dauer: number }; zeit: number }
interface Pv { vg?: string; uuid: string; bytes: number }
interface Vg { uuid: string; pvs: string[]; aktiv: boolean }
interface Lv { vg: string; name: string; uuid: string; segs: { pv: string; n: number }[]; aktiv: boolean; p: Partition; snap?: { von: string; cow: number; basis: Record<string, string | null> }; merge?: boolean; ungueltig?: boolean }
interface IscsiNode { iqn: string; portal: string; startup: 'manual' | 'automatic'; methode?: string; user?: string; pass?: string }
interface SpStand {
  opt: SpeicherOptionen;
  md: Record<string, Md>;
  pvs: Record<string, Pv>; vgs: Record<string, Vg>; lvs: Record<string, Lv>;
  iscsi: { nodes: Record<string, IscsiNode>; session: null | { iqn: string; dev: string; sid: number } };
  dmesg: string[];
  dm: Record<string, number>;
}
type SW = Welt & { speicher?: SpStand };
const sp = (w: Welt): SpStand => (w as SW).speicher!;
export const speicherAktiv = (w: Welt) => !!(w as SW).speicher;

const PE = 4194304;
const GIB = 1073741824;
let zahl = 7;
const uuid = () => { const h = (n: number, l: number) => Array.from({ length: l }, (_, i) => '0123456789abcdef'[(n * 2654435761 + i * 40503) >>> (i % 13) & 15]).join(''); zahl += 11; return `${h(zahl, 8)}-${h(zahl + 1, 4)}-${h(zahl + 2, 4)}-${h(zahl + 3, 4)}-${h(zahl + 4, 12)}`; };
const lvmUuid = () => { const z = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'; let s = ''; zahl += 13; for (let i = 0; i < 32; i++) s += z[(zahl * 7919 + i * 104729) % z.length]; return `${s.slice(0, 6)}-${s.slice(6, 10)}-${s.slice(10, 14)}-${s.slice(14, 18)}-${s.slice(18, 22)}-${s.slice(22, 26)}-${s.slice(26, 32)}`; };
function ordner(w: Welt, p: string) { const t = p.split('/').filter(Boolean); for (let i = 1; i <= t.length; i++) { const d = '/' + t.slice(0, i).join('/'); if (!(d in w.fs)) { w.fs[d] = null; const m = meta(w, d); m.mode = 0o755; m.owner = 'root'; m.group = 'root'; } } }
function datei(w: Welt, p: string, c: string, mode = 0o644) { ordner(w, p.slice(0, p.lastIndexOf('/')) || '/'); w.fs[p] = c; const m = meta(w, p); m.mode = mode; m.owner = 'root'; m.group = 'root'; m.mtime = w.uhr; }
const hat = (w: Welt, prog: string) => ['/usr/sbin/', '/usr/bin/', '/sbin/', '/bin/'].some((d) => typeof w.fs[d + prog] === 'string');
const gerBytes = (w: Welt, dev: string) => { const t = finden(w, dev); if (!t) return 0; return t.p ? fsBytes(t.p) : t.pl.sektoren * 512; };
/** Größe wie LVM: 10,00g */
const lg = (b: number) => { const g = b / GIB; return g >= 1024 ? (g / 1024).toFixed(2).replace('.', ',') + 't' : g >= 1 ? g.toFixed(2).replace('.', ',') + 'g' : (b / 1048576).toFixed(2).replace('.', ',') + 'm'; };
const lgLang = (b: number) => lg(b).replace(/g$/, ' GiB').replace(/m$/, ' MiB').replace(/t$/, ' TiB');
function groesse(s: string, basis = 'm'): number { const m = s.match(/^\+?(\d+(?:[.,]\d+)?)([kmgtKMGT]?)(i?B)?$/); if (!m) return NaN; const e = (m[2] || basis).toLowerCase(); return Math.round(Number(m[1].replace(',', '.')) * ({ k: 1024, m: 1048576, g: GIB, t: GIB * 1024 } as Record<string, number>)[e]); }

// ---------- Start ----------
const PLATTE_1TB = 1953525168;
export function speicherStarten(w: Welt, o: SpeicherOptionen) {
  const s: SpStand = { opt: o, md: {}, pvs: {}, vgs: {}, lvs: {}, iscsi: { nodes: {}, session: null }, dmesg: [], dm: {} };
  (w as SW).speicher = s;
  const pl = w.platten!;
  const frei = 'cdefghij'.split('').filter((c) => !pl.platten.some((x) => x.name === 'sd' + c));
  const anzahl = o.platten ?? ((o.raid === 'raid5' ? 3 : o.raid ? 2 : 0) + (o.lvm === 'voll' ? 1 : o.lvm ? 2 : 0) + 1);
  const neu: Platte[] = [];
  for (let i = 0; i < anzahl; i++) {
    const name = 'sd' + frei[i];
    const p: Platte = { name, sektoren: PLATTE_1TB, modell: 'WDC WD10EFRX-68FYTN0', rm: false, maj: 8, label: null, id: '', partitionen: [] };
    const nRaid = o.raid === 'raid5' ? 3 : o.raid ? 2 : 0; const nLvm = o.lvm === 'voll' ? 1 : o.lvm ? 2 : 0;
    if (o.partitioniert || i < nRaid + nLvm) { p.label = 'dos'; p.id = '0x' + (0x5e1d0a00 + i).toString(16); p.partitionen = [{ nr: 1, start: 2048, ende: PLATTE_1TB - 1, typ: i < nRaid ? 'fd' : i < nRaid + nLvm ? '8e' : '83', partuuid: `${p.id.slice(2)}-01` }]; }
    pl.platten.push(p); neu.push(p); w.fs['/dev/' + name] = ''; for (const q of p.partitionen) w.fs['/dev/' + name + q.nr] = '';
  }
  pl.platten.sort((x, y) => x.name.localeCompare(y.name));
  if (o.raid) {
    const n = o.raid === 'raid5' ? 3 : 2;
    const devs = neu.slice(0, n).map((p, i) => ({ dev: `/dev/${p.name}1`, rolle: 'aktiv' as const, nr: i }));
    const md = mdAnlegen(w, 'md0', o.raid === 'raid5' ? 5 : 1, devs.map((d) => d.dev), w.uhr - 86400000 * 90);
    md.sync = null;
    const fs = neuesFs('ext4', w.uhr - 86400000 * 90, 'spiegel', '1c2d3e4f-5a6b-4c7d-8e9f-a0b1c2d3e4f5');
    fs.dateien = { '/lost+found': null, '/messreihen': null, '/messreihen/2025.csv': '\u0007BIN:83886080', '/messreihen/2026.csv': '\u0007BIN:52428800', '/LIESMICH.txt': 'Gespiegelte Messdaten. Nicht direkt auf die Platten schreiben.\n' };
    md.p.fs = fs;
    if (o.raid === 'kaputt') { md.devs[1].rolle = 'faulty'; s.dmesg.push(`[ 4021.338211] ata4.00: failed command: READ FPDMA QUEUED`, `[ 4021.338244] blk_update_request: I/O error, dev ${md.devs[1].dev.slice(5, 8)}, sector 183447216 op 0x0:(READ)`, `[ 4021.402117] md/raid1:md0: Disk failure on ${md.devs[1].dev.slice(5)}, disabling device.`, `[ 4021.402119] md/raid1:md0: Operation continuing on 1 devices.`); }
    datei(w, '/etc/mdadm/mdadm.conf', MDADM_CONF + `\n# definitions of existing MD arrays\nARRAY /dev/md0 metadata=1.2 UUID=${md.uuid.replace(/-/g, '').replace(/(.{8})(?=.)/g, '$1:')} name=${w.host}:0\n\nMAILADDR root\n`);
    datei(w, '/srv/spiegel', '', 0o755); w.fs['/srv/spiegel'] = null;
    w.fs['/etc/fstab'] = (w.fs['/etc/fstab'] ?? '') + `UUID=${fs.uuid}  /srv/spiegel  ext4  defaults  0  2\n`;
    BEF.mount(w, ['/dev/md0', '/srv/spiegel'], '', true);
  }
  if (o.lvm) {
    const pvs = neu.slice(o.raid ? (o.raid === 'raid5' ? 3 : 2) : 0).map((p) => `/dev/${p.name}1`).slice(0, o.lvm === 'voll' ? 1 : 2);
    for (const d of pvs) pvAnlegen(w, d);
    s.vgs.daten = { uuid: lvmUuid(), pvs: [], aktiv: true };
    for (const d of pvs) { s.pvs[d].vg = 'daten'; s.vgs.daten.pvs.push(d); }
    const m = lvAnlegen(w, 'daten', 'messungen', Math.round((o.lvm === 'voll' ? 900 : 200) * GIB / PE));
    const fs = neuesFs('ext4', w.uhr - 86400000 * 60, 'messungen', '6e7f8091-a2b3-4c4d-9e5f-60718293a4b5');
    fs.dateien = { '/lost+found': null, '/2026': null, '/2026/messreihe-a.csv': '\u0007BIN:3145728', '/2026/messreihe-b.csv': '\u0007BIN:2097152' };
    if (o.lvm === 'voll') fs.basis = Math.round(0.97 * 900 * GIB);
    m.p.fs = fs;
    if (o.lvm === 'fertig') { const a = lvAnlegen(w, 'daten', 'archiv', Math.round(300 * GIB / PE)); const f2 = neuesFs('xfs', w.uhr - 86400000 * 60, 'archiv', '7f8091a2-b3c4-4d5e-8f60-718293a4b5c6'); f2.dateien = { '/2024.tar': '\u0007BIN:5368709120', '/2025.tar': '\u0007BIN:7516192768' }; a.p.fs = f2; }
    for (const z of ['/srv/messungen', '/srv/archiv']) w.fs[z] = null;
    w.fs['/etc/fstab'] = (w.fs['/etc/fstab'] ?? '') + '/dev/daten/messungen  /srv/messungen  ext4  defaults  0  2\n' + (o.lvm === 'fertig' ? '/dev/daten/archiv     /srv/archiv     xfs   defaults  0  0\n' : '');
    BEF.mount(w, ['/dev/daten/messungen', '/srv/messungen'], '', true);
    if (o.lvm === 'fertig') BEF.mount(w, ['/dev/daten/archiv', '/srv/archiv'], '', true);
  }
  (w as Welt & { fstabStand?: string }).fstabStand = w.fs['/etc/fstab'] ?? undefined;
  if (w.pakete) { w.pakete.installiert['mdadm'] = 'ii'; w.pakete.installiert['lvm2'] = 'ii'; w.pakete.installiert['hdparm'] = 'ii'; }
  for (const x of ['mdadm', 'pvcreate', 'pvs', 'pvdisplay', 'pvremove', 'pvmove', 'pvscan', 'pvresize', 'vgcreate', 'vgs', 'vgdisplay', 'vgextend', 'vgreduce', 'vgrename', 'vgremove', 'vgchange', 'vgscan', 'lvcreate', 'lvs', 'lvdisplay', 'lvextend', 'lvreduce', 'lvresize', 'lvrename', 'lvremove', 'lvconvert', 'lvchange', 'lvscan', 'lvm', 'hdparm', 'resize2fs', 'xfs_growfs', 'sfdisk', 'fstrim'])
    datei(w, `/usr/sbin/${x}`, '\u0007BIN:' + (40000 + x.length * 977), 0o755);
  if (!w.fs['/proc/sys/dev/raid/speed_limit_min']) { datei(w, '/proc/sys/dev/raid/speed_limit_min', '1000\n'); datei(w, '/proc/sys/dev/raid/speed_limit_max', '200000\n'); }
  if (!w.fs['/etc/lvm/lvm.conf']) datei(w, '/etc/lvm/lvm.conf', LVM_CONF);
  for (const d of ['/usr/lib/udev/scsi_id', ...(w.fs['/lib'] === null ? ['/lib/udev/scsi_id'] : [])]) datei(w, d, '\u0007BIN:59432', 0o755);
  if (!w.fs['/etc/mdadm/mdadm.conf']) datei(w, '/etc/mdadm/mdadm.conf', MDADM_CONF + '\nMAILADDR root\n');
  ordner(w, '/dev/disk/by-id'); ordner(w, '/dev/disk/by-path'); ordner(w, '/dev/disk/by-uuid');
  for (const pl2 of pl.platten) {
    const sched = pl2.name.startsWith('nvme') ? '[none] mq-deadline kyber bfq' : '[mq-deadline] kyber bfq none';
    datei(w, `/sys/block/${pl2.name}/queue/scheduler`, sched + '\n');
    datei(w, `/sys/block/${pl2.name}/queue/rotational`, (pl2.modell.startsWith('WDC') ? '1' : '0') + '\n');
  }
  sync(w);
}
const MDADM_CONF = `# mdadm.conf
#
# !NB! Run update-initramfs -u after updating this file.
# !NB! This will ensure that initramfs has an uptodate copy.
#
# Please refer to mdadm.conf(5) for information about this file.
#

# by default (built-in), scan all partitions (/proc/partitions) and all
# containers for MD superblocks. alternatively, specify devices to scan, using
# wildcards if desired.
#DEVICE partitions containers

# automatically tag new arrays as belonging to the local system
HOMEHOST <system>

# instruct the monitoring daemon where to send mail alerts
`;
const LVM_CONF = `# This is an example configuration file for the LVM2 system.
# It contains the default settings that would be used if there was no
# /etc/lvm/lvm.conf file.
#
# Refer to 'man lvm.conf' for further information including the file layout.

config {
	checks = 1
}

devices {
	dir = "/dev"
	scan = [ "/dev" ]
	# Example: accept all loop devices and ide drives except hdc
	# filter = [ "a|loop|", "r|/dev/hdc|", "a|/dev/ide|", "r|.*|" ]
	# filter = [ "a|.*|" ]
}

activation {
	udev_sync = 1
	udev_rules = 1
	# Configuration option activation/snapshot_autoextend_threshold.
	# Auto-extend a snapshot when its usage exceeds this percent.
	# Setting this to 100 disables automatic extension.
	snapshot_autoextend_threshold = 100
	snapshot_autoextend_percent = 20
}

global {
	umask = 077
	use_lvmetad = 0
}
`;

// ---------- Zustand anlegen ----------
function mdBytes(w: Welt, md: Pick<Md, 'level' | 'n'> & { devs: { dev: string }[] }): number {
  const min = Math.min(...md.devs.map((d) => gerBytes(w, d.dev))) - 134217728;
  return md.level === 0 ? min * md.devs.length : md.level === 1 ? min : md.level === 5 ? min * (md.n - 1) : md.level === 6 ? min * (md.n - 2) : min * md.n / 2;
}
function mdAnlegen(w: Welt, name: string, level: number, devs: string[], zeit: number): Md {
  const s = sp(w); const u = uuid();
  const md: Md = { name, level, uuid: u, n: devs.length, chunk: 512, devs: devs.map((d, i) => ({ dev: d, rolle: 'aktiv', nr: i })), p: { nr: 1, start: 0, ende: 0, typ: '', partuuid: '' }, laeuft: true, sync: level >= 1 ? { art: 'resync', start: w.uhr, dauer: 300000 } : null, zeit };
  md.p.ende = Math.floor(mdBytes(w, md) / 512) - 1;
  for (const d of devs) { const t = finden(w, d); const f = neuesFs('linux_raid_member', zeit, `${w.host}:${name.slice(2)}`, u); if (t?.p) t.p.fs = f; else if (t) (t.pl as Platte & { fs?: Dateisystem }).fs = f; }
  s.md[name] = md; w.fs['/dev/' + name] = '';
  return md;
}
function pvAnlegen(w: Welt, dev: string) { const t = finden(w, dev)!; const u = lvmUuid(); sp(w).pvs[dev] = { uuid: u, bytes: t.p ? fsBytes(t.p) : t.pl.sektoren * 512 }; const f = neuesFs('LVM2_member', w.uhr, undefined, u); if (t.p) t.p.fs = f; }
const peGesamt = (pv: Pv) => Math.floor((pv.bytes - 1048576) / PE);
const peBelegt = (w: Welt, dev: string) => Object.values(sp(w).lvs).reduce((n, lv) => n + lv.segs.filter((x) => x.pv === dev).reduce((m, x) => m + x.n, 0), 0);
const vgFrei = (w: Welt, vg: string) => sp(w).vgs[vg].pvs.reduce((n, d) => n + peGesamt(sp(w).pvs[d]) - peBelegt(w, d), 0);
const vgGesamt = (w: Welt, vg: string) => sp(w).vgs[vg].pvs.reduce((n, d) => n + peGesamt(sp(w).pvs[d]), 0);
const lvPe = (lv: Lv) => lv.segs.reduce((n, x) => n + x.n, 0);
function zuteilen(w: Welt, vg: string, n: number, nur?: string[]): { pv: string; n: number }[] | null {
  const segs: { pv: string; n: number }[] = []; let rest = n;
  for (const d of (nur ?? sp(w).vgs[vg].pvs)) { const f = peGesamt(sp(w).pvs[d]) - peBelegt(w, d); if (f <= 0) continue; const k = Math.min(f, rest); segs.push({ pv: d, n: k }); rest -= k; if (!rest) break; }
  return rest ? null : segs;
}
function lvAnlegen(w: Welt, vg: string, name: string, pe: number): Lv {
  const lv: Lv = { vg, name, uuid: lvmUuid(), segs: zuteilen(w, vg, pe)!, aktiv: true, p: { nr: 1, start: 0, ende: pe * PE / 512 - 1, typ: '', partuuid: '' } };
  sp(w).lvs[`${vg}/${name}`] = lv; return lv;
}
const mapperName = (vg: string, lv: string) => `${vg.replace(/-/g, '--')}-${lv.replace(/-/g, '--')}`;

// ---------- virtuelle Geräte für finden() ----------
VIRT.finden = (w, n) => {
  if (!speicherAktiv(w)) return undefined;
  const s = sp(w);
  if (s.md[n]?.laeuft) return s.md[n].p;
  for (const lv of Object.values(s.lvs)) if (lv.aktiv && !lv.ungueltig && (n === `${lv.vg}/${lv.name}` || n === 'mapper/' + mapperName(lv.vg, lv.name))) return lv.p;
  return undefined;
};
VIRT.liste = (w) => {
  if (!speicherAktiv(w)) return [];
  const s = sp(w);
  return [...Object.values(s.md).filter((m) => m.laeuft).map((m) => ({ dev: '/dev/' + m.name, p: m.p })), ...Object.values(s.lvs).filter((l) => l.aktiv && !l.ungueltig).map((l) => ({ dev: '/dev/mapper/' + mapperName(l.vg, l.name), p: l.p }))];
};

// ---------- Fortschritt, /proc/mdstat, Gerätedateien ----------
function syncFortschritt(w: Welt, md: Md) {
  if (!md.sync) return;
  const minK = Number((w.fs['/proc/sys/dev/raid/speed_limit_min'] ?? '1000').trim()) || 1000;
  const faktor = minK >= 100000 ? 5 : minK >= 50000 ? 3 : 1;
  const anteil = (w.uhr - md.sync.start) * faktor / md.sync.dauer;
  if (anteil >= 1) {
    for (const d of md.devs) if (d.rolle === 'neu') d.rolle = 'aktiv';
    if (md.sync.art === 'reshape') { md.p.ende = Math.floor(mdBytes(w, { ...md, devs: md.devs.filter((d) => d.rolle === 'aktiv') }) / 512) - 1; }
    md.sync = null;
    sp(w).dmesg.push(`[ ${(4100 + w.uhr / 1000 % 900).toFixed(6)}] md: ${md.name}: ${md.level >= 1 ? 'recovery' : 'resync'} done.`);
  }
}
function mdstat(w: Welt): string {
  const s = sp(w); const z = ['Personalities : [raid1] [raid6] [raid5] [raid4] [raid0] [raid10] [linear]'];
  for (const md of Object.values(s.md)) {
    if (!md.laeuft) continue;
    syncFortschritt(w, md);
    const aktiv = md.devs.filter((d) => d.rolle === 'aktiv').length;
    const glieder = md.devs.map((d) => `${d.dev.slice(5)}[${d.nr}]${d.rolle === 'faulty' ? '(F)' : d.rolle === 'spare' ? '(S)' : ''}`).reverse().join(' ');
    const blk = Math.floor(fsBytes(md.p) / 1024);
    const muster = Array.from({ length: md.n }, (_, i) => (md.devs.find((d) => d.nr === i && d.rolle === 'aktiv') ? 'U' : '_')).join('');
    z.push(`${md.name} : active ${md.level === 10 ? 'raid10' : 'raid' + md.level} ${glieder}`);
    z.push(`      ${blk} blocks super 1.2${md.level >= 4 ? ` level ${md.level}, ${md.chunk}k chunk, algorithm 2` : md.level === 0 ? ` ${md.chunk}k chunks` : ''}${md.level >= 1 ? ` [${md.n}/${aktiv}] [${muster}]` : ''}`);
    if (md.sync) {
      const minK = Number((w.fs['/proc/sys/dev/raid/speed_limit_min'] ?? '1000').trim()) || 1000; const faktor = minK >= 100000 ? 5 : minK >= 50000 ? 3 : 1;
      const p = Math.min(99.9, (w.uhr - md.sync.start) * faktor / md.sync.dauer * 100);
      const balken = '='.repeat(Math.floor(p / 5)) + '>' + '.'.repeat(Math.max(0, 19 - Math.floor(p / 5)));
      z.push(`      [${balken}]  ${md.sync.art} = ${p.toFixed(1)}% (${Math.round(blk * p / 100)}/${blk}) finish=${Math.max(0.1, (100 - p) / faktor * 0.9).toFixed(1)}min speed=${(minK >= 100000 ? 523411 : minK >= 50000 ? 312004 : 104857)}K/sec`);
    }
    if (md.level >= 1) z.push(`      bitmap: 0/8 pages [0KB], 65536KB chunk`);
    z.push('');
  }
  z.push('unused devices: <none>');
  return z.join('\n') + '\n';
}
function sync(w: Welt) {
  if (!speicherAktiv(w)) return;
  const s = sp(w);
  w.fs['/proc/mdstat'] = mdstat(w); meta(w, '/proc/mdstat').mode = 0o444;
  // echo bfq > /sys/block/sdX/queue/scheduler: die Auswahl steht danach in Klammern
  for (const k of Object.keys(w.fs).filter((x) => /^\/sys\/block\/\w+\/queue\/scheduler$/.test(x))) {
    const c = (w.fs[k] ?? '').trim(); if (c.includes('[')) continue;
    const alle = k.includes('nvme') ? ['none', 'mq-deadline', 'kyber', 'bfq'] : ['mq-deadline', 'kyber', 'bfq', 'none'];
    const wahl = alle.includes(c) ? c : alle[0];
    w.fs[k] = alle.map((x) => (x === wahl ? `[${x}]` : x)).join(' ') + '\n';
  }
  // Gerätedateien für LVM: /dev/VG/LV und /dev/mapper/VG-LV
  for (const k of Object.keys(w.fs)) if (/^\/dev\/dm-\d+$/.test(k) || (k.startsWith('/dev/mapper/') && k !== '/dev/mapper/control' && !(w.platten!.mapper ?? {})[k.slice(12)])) delete w.fs[k];
  for (const vg of Object.keys(s.vgs)) if (w.fs['/dev/' + vg] === null && !Object.values(s.lvs).some((l) => l.vg === vg && l.aktiv)) { for (const k of Object.keys(w.fs).filter((x) => x.startsWith(`/dev/${vg}/`))) delete w.fs[k]; delete w.fs['/dev/' + vg]; }
  let n = Object.keys(w.platten!.mapper ?? {}).length;
  ordner(w, '/dev/mapper');
  for (const lv of Object.values(s.lvs)) {
    for (const k of Object.keys(w.fs).filter((x) => x === `/dev/${lv.vg}/${lv.name}`)) delete w.fs[k];
    if (!lv.aktiv) continue;
    const dm = 'dm-' + (s.dm[`${lv.vg}/${lv.name}`] ??= n++);
    w.fs['/dev/' + dm] = ''; meta(w, '/dev/' + dm).mode = 0o660;
    w.fs['/dev/mapper/' + mapperName(lv.vg, lv.name)] = '-> ../' + dm; meta(w, '/dev/mapper/' + mapperName(lv.vg, lv.name)).mode = 0o777;
    ordner(w, '/dev/' + lv.vg); w.fs[`/dev/${lv.vg}/${lv.name}`] = '-> ../' + dm; meta(w, `/dev/${lv.vg}/${lv.name}`).mode = 0o777;
  }
  // Textkopie der Metadaten wie /etc/lvm/backup/VG
  for (const k of Object.keys(w.fs)) if (k.startsWith('/etc/lvm/backup/') && !s.vgs[k.slice(16)]) delete w.fs[k];
  for (const [n, vg] of Object.entries(s.vgs)) {
    const txt = `# Generated by LVM2 version 2.03.16(2) (2022-05-18)\n\ncontents = "Text Format Volume Group"\nversion = 1\n\ndescription = "Created *after* executing the last LVM command"\n\n${n} {\n\tid = "${vg.uuid}"\n\textent_size = 8192\t\t# 4 Megabytes\n\n\tphysical_volumes {\n${vg.pvs.map((d, i) => `\t\tpv${i} {\n\t\t\tid = "${s.pvs[d]?.uuid}"\n\t\t\tdevice = "${d}"\n\t\t\tpe_count = ${peGesamt(s.pvs[d])}\n\t\t}\n`).join('')}\t}\n\n\tlogical_volumes {\n${Object.values(s.lvs).filter((l) => l.vg === n).map((l) => `\t\t${l.name} {\n\t\t\tid = "${l.uuid}"\n\t\t\tsegment_count = ${l.segs.length}\n\t\t}\n`).join('')}\t}\n}\n`;
    if (w.fs['/etc/lvm/backup/' + n] !== txt) { datei(w, '/etc/lvm/backup/' + n, txt, 0o600); ordner(w, '/etc/lvm/archive'); }
  }
  for (const md of Object.values(s.md)) { if (md.laeuft) w.fs['/dev/' + md.name] = ''; else delete w.fs['/dev/' + md.name]; }
  // Snapshot: Belegung des Copy-on-Write-Bereichs
  for (const lv of Object.values(s.lvs)) if (lv.snap && !lv.ungueltig && cowProzent(w, lv) >= 100) { lv.ungueltig = true; s.dmesg.push(`[ ${(4200 + w.uhr / 1000 % 900).toFixed(6)}] device-mapper: snapshots: Invalidating snapshot: Unable to allocate exception.`); }
}
export function speicherVorZeile(w: Welt) { if (speicherAktiv(w)) sync(w); }

// Inhalt eines LV: eingehängt aus w.fs, sonst aus dem Dateisystem
function inhalt(w: Welt, lv: Lv): Record<string, string | null> {
  const dev = '/dev/mapper/' + mapperName(lv.vg, lv.name);
  const m = w.platten!.mounts.find((x) => x.quelle === dev || x.quelle === `/dev/${lv.vg}/${lv.name}`);
  if (m) return Object.fromEntries(Object.entries(w.fs).filter(([k]) => k.startsWith(m.ziel + '/')).map(([k, v]) => [k.slice(m.ziel.length), v]));
  return { ...(lv.p.fs?.dateien ?? {}) };
}
const groesseVon = (c: string | null) => (typeof c === 'string' ? Number(c.match(/^\u0007BIN:(\d+)/)?.[1] ?? c.length) : 4096);
function cowProzent(w: Welt, snap: Lv): number {
  const o = sp(w).lvs[`${snap.vg}/${snap.snap!.von}`]; if (!o) return 0;
  const jetzt = inhalt(w, o); const vorher = snap.snap!.basis; let b = 0;
  for (const k of new Set([...Object.keys(jetzt), ...Object.keys(vorher)])) if (jetzt[k] !== vorher[k]) b += Math.max(groesseVon(jetzt[k] ?? null), groesseVon(vorher[k] ?? null));
  return Math.min(100, 0.02 + b / snap.snap!.cow * 100);
}

// ---------- Befehle ----------
let ALT: Record<string, B>; let BEF: Record<string, B>;
export function speicherBefehle(alt: Record<string, B>, alle: Record<string, B>): Record<string, B> {
  ALT = alt; BEF = alle;
  const b: Record<string, B> = {};
  const mit = (n: string, f: B): B => (w, a, i, r) => (speicherAktiv(w) ? f(w, a, i, r) : alt[n] ? alt[n](w, a, i, r) : fehler(`bash: ${n}: Befehl nicht gefunden`, 127));
  const nurRoot = (r: boolean, w: Welt) => r || w.root;
  const lvmRoot = '  WARNING: Running as a non-root user. Functionality may be unavailable.\n  /run/lock/lvm/P_global:aux: open failed: Keine Berechtigung';

  // ----- mdadm -----
  b.mdadm = mit('mdadm', (w, a, _i, r) => {
    const s = sp(w);
    const wert = (lang: string, kurz: string) => { for (let i = 0; i < a.length; i++) { if (a[i].startsWith(lang + '=')) return a[i].slice(lang.length + 1); if (a[i] === lang || a[i] === kurz) return a[i + 1]; if (kurz.length === 2 && a[i].startsWith(kurz) && a[i].length > 2 && !a[i].startsWith('--')) return a[i].slice(2); } return undefined; };
    const geraete = a.filter((x) => x.startsWith('/dev/'));
    const hatOpt = (...o: string[]) => a.some((x) => o.includes(x) || o.some((y) => y.length > 2 && x.startsWith(y + '=')));
    const mdName = (d: string) => d.replace(/^\/dev\//, '').replace(/^md\//, 'md');
    if (hatOpt('--detail', '-D') && hatOpt('--scan', '-s')) return ok(Object.values(s.md).filter((m) => m.laeuft).map((m) => `ARRAY /dev/${m.name} metadata=1.2 name=${w.host}:${m.name.slice(2)} UUID=${m.uuid.replace(/-/g, '').replace(/(.{8})(?=.)/g, '$1:')}`).join('\n'));
    if (hatOpt('--detail', '-D')) {
      const md = s.md[mdName(geraete[0] ?? '')]; if (!md?.laeuft) return fehler(`mdadm: cannot open ${geraete[0] ?? ''}: No such file or directory`);
      if (!nurRoot(r, w)) return fehler(`mdadm: must be super-user to perform this action`);
      syncFortschritt(w, md);
      const aktiv = md.devs.filter((d) => d.rolle === 'aktiv').length; const faulty = md.devs.filter((d) => d.rolle === 'faulty').length; const spare = md.devs.filter((d) => d.rolle === 'spare' || d.rolle === 'neu').length;
      const zustand = [md.level >= 1 && aktiv < md.n ? 'degraded' : 'clean', md.sync?.art === 'recovery' ? 'recovering' : md.sync?.art === 'resync' ? 'resyncing' : md.sync?.art === 'reshape' ? 'reshaping' : ''].filter(Boolean).join(', ');
      return ok(`/dev/${md.name}:\n           Version : 1.2\n     Creation Time : Mon Aug 24 09:12:44 2026\n        Raid Level : ${md.level === 10 ? 'raid10' : 'raid' + md.level}\n        Array Size : ${Math.floor(fsBytes(md.p) / 1024)} (${lgLang(fsBytes(md.p))})\n${md.level >= 1 ? `     Used Dev Size : ${Math.floor((Math.min(...md.devs.map((d) => gerBytes(w, d.dev))) - 134217728) / 1024)}\n` : ''}      Raid Devices : ${md.n}\n     Total Devices : ${md.devs.length}\n       Persistence : Superblock is persistent\n\n       Update Time : Mon Nov 23 08:41:00 2026\n             State : ${zustand}\n    Active Devices : ${aktiv}\n   Working Devices : ${aktiv + spare}\n    Failed Devices : ${faulty}\n     Spare Devices : ${spare}\n${md.level >= 4 ? `\n            Layout : left-symmetric\n        Chunk Size : ${md.chunk}K\n` : ''}${md.sync ? `\n    ${md.sync.art === 'recovery' ? 'Rebuild' : md.sync.art === 'reshape' ? 'Reshape' : 'Resync'} Status : ${Math.floor((w.uhr - md.sync.start) / md.sync.dauer * 100)}% complete\n` : ''}\n              Name : ${w.host}:${md.name.slice(2)}  (local to host ${w.host})\n              UUID : ${md.uuid.replace(/-/g, '').replace(/(.{8})(?=.)/g, '$1:')}\n\n    Number   Major   Minor   RaidDevice State\n${Array.from({ length: md.n }, (_, i) => { const d = md.devs.find((x) => x.nr === i && (x.rolle === 'aktiv' || x.rolle === 'neu')); return d ? `       ${i}       8       ${String(i * 16 + 33).padStart(3)}        ${i}      ${d.rolle === 'neu' ? 'spare rebuilding' : 'active sync'}   ${d.dev}` : `       -       0        0        ${i}      removed`; }).join('\n')}${md.devs.filter((d) => d.rolle === 'faulty' || d.rolle === 'spare').map((d) => `\n\n       ${d.nr}       8       ${String(d.nr * 16 + 33).padStart(3)}        -      ${d.rolle === 'faulty' ? 'faulty' : 'spare'}   ${d.dev}`).join('')}`);
    }
    if (hatOpt('--examine', '-E')) {
      if (!nurRoot(r, w)) return fehler(`mdadm: cannot open ${geraete[0] ?? ''}: Permission denied`);
      const t = finden(w, geraete[0] ?? ''); const fs = t?.p?.fs;
      if (!fs || fs.art !== 'linux_raid_member') return fehler(`mdadm: No md superblock detected on ${geraete[0] ?? ''}.`);
      const md = Object.values(s.md).find((m) => m.uuid === fs.uuid);
      return ok(`${geraete[0]}:\n          Magic : a92b4efc\n        Version : 1.2\n    Feature Map : 0x1\n     Array UUID : ${fs.uuid.replace(/-/g, '').replace(/(.{8})(?=.)/g, '$1:')}\n           Name : ${fs.label}\n  Creation Time : Mon Aug 24 09:12:44 2026\n     Raid Level : ${md ? (md.level === 10 ? 'raid10' : 'raid' + md.level) : 'raid1'}\n   Raid Devices : ${md?.n ?? 2}\n\n    Data Offset : 264192 sectors\n          State : clean\n    Device UUID : ${uuid().replace(/-/g, '').replace(/(.{8})(?=.)/g, '$1:')}\n\n    Device Role : Active device ${md?.devs.find((d) => d.dev === geraete[0])?.nr ?? 0}\n    Array State : ${md ? Array.from({ length: md.n }, (_, i) => (md.devs.find((d) => d.nr === i && d.rolle === 'aktiv') ? 'A' : '.')).join('') : 'AA'} ('A' == active, '.' == missing, 'R' == replacing)`);
    }
    if (!nurRoot(r, w)) return fehler('mdadm: must be super-user to perform this action');
    if (hatOpt('--create', '-C')) {
      const ziel = mdName(geraete[0] ?? ''); const glieder = geraete.slice(1);
      const lvlRoh = wert('--level', '-l') ?? ''; const level = Number(lvlRoh.replace(/^raid/, '').replace(/^mirror$/, '1').replace(/^stripe$/, '0'));
      const n = Number(wert('--raid-devices', '-n'));
      const ersatz = Number(wert('--spare-devices', '-x') ?? 0);
      if (!/^md\d+$/.test(ziel)) return fehler('mdadm: an md device must be given in this mode');
      if (s.md[ziel]?.laeuft) return fehler(`mdadm: ${ziel} is already in use.`);
      if (![0, 1, 4, 5, 6, 10].includes(level)) return fehler(`mdadm: invalid raid level: ${lvlRoh || '(keins)'}\n(Gib das Level mit --level=1, --level=5 usw. an.)`);
      if (!n) return fehler('mdadm: no raid-devices specified.');
      if (glieder.length !== n + ersatz) return fehler(`mdadm: You have listed ${glieder.length} devices but ${n + ersatz} were expected (--raid-devices=${n}${ersatz ? ` --spare-devices=${ersatz}` : ''}).`);
      if (level === 5 && n < 3) return fehler('mdadm: at least 3 raid-devices needed for level 5');
      if (level === 6 && n < 4) return fehler('mdadm: at least 4 raid-devices needed for level 6');
      for (const g of glieder) {
        const t = finden(w, g); if (!t) return fehler(`mdadm: cannot open ${g}: No such file or directory`);
        if (w.platten!.mounts.some((m) => m.quelle === g)) return fehler(`mdadm: cannot open ${g}: Device or resource busy`);
        if (t.p?.fs?.art === 'linux_raid_member' && Object.values(s.md).some((m) => m.laeuft && m.devs.some((d) => d.dev === g))) return fehler(`mdadm: cannot open ${g}: Device or resource busy`);
      }
      const warn = glieder.map((g) => { const f = finden(w, g)?.p?.fs; return f && f.art !== 'linux_raid_member' ? `mdadm: ${g} appears to contain an ${f.art === 'xfs' ? 'xfs' : 'ext2fs'} file system\n       size=${Math.floor(gerBytes(w, g) / 1024)}K  mtime=Mon Nov 23 08:41:00 2026` : ''; }).filter(Boolean);
      const anlegen = (): Ergebnis => {
        const md = mdAnlegen(w, ziel, level, glieder.slice(0, n), w.uhr); md.n = n;
        glieder.slice(n).forEach((g, i) => { md.devs.push({ dev: g, rolle: 'spare', nr: n + i }); const t = finden(w, g); if (t?.p) t.p.fs = neuesFs('linux_raid_member', w.uhr, `${w.host}:${ziel.slice(2)}`, md.uuid); });
        md.p.ende = Math.floor(mdBytes(w, { level, n, devs: md.devs.slice(0, n) }) / 512) - 1;
        if (level === 0) md.sync = null;
        sync(w);
        return ok(`mdadm: Defaulting to version 1.2 metadata\nmdadm: array /dev/${ziel} started.`);
      };
      const hinweis = level === 1 ? 'mdadm: Note: this array has metadata at the start and\n    may not be suitable as a boot device.  If you plan to\n    store \'/boot\' on this device please ensure that\n    your boot-loader understands md/v1.x metadata, or use\n    --metadata=0.90\n' : '';
      if ((hinweis || warn.length) && !a.includes('--run') && !a.includes('-R')) { w.wartet = { standardJa: false, aktion: anlegen, nein: 'mdadm: create aborted.' }; return ok(`${warn.join('\n')}${warn.length ? '\n' : ''}${hinweis}Continue creating array? [y/N] `); }
      return anlegen();
    }
    if (hatOpt('--assemble', '-A')) {
      const conf = w.fs['/etc/mdadm/mdadm.conf'] ?? '';
      const kandidaten = hatOpt('--scan', '-s') ? Object.values(s.md).filter((m) => !m.laeuft && new RegExp(`^ARRAY\\s+/dev/(md/)?${m.name.slice(2)}\\b|^ARRAY\\s+/dev/${m.name}\\b|UUID=${m.uuid.replace(/-/g, '').replace(/(.{8})(?=.)/g, '$1:')}`, 'm').test(conf) || !/^ARRAY/m.test(conf) && !m.laeuft) : [s.md[mdName(geraete[0] ?? '')]].filter(Boolean);
      if (!kandidaten.length) return fehler(hatOpt('--scan', '-s') ? 'mdadm: No arrays found in config file or automatically' : `mdadm: ${geraete[0] ?? ''} not identified in config file.`);
      const out: string[] = [];
      for (const md of kandidaten) { md.laeuft = true; const n = md.devs.filter((d) => d.rolle === 'aktiv').length; out.push(`mdadm: /dev/${md.name} has been started with ${n} drive${n === 1 ? '' : 's'}${n < md.n ? ` (out of ${md.n})` : ''}.`); }
      sync(w); return ok(out.join('\n'));
    }
    if (hatOpt('--stop', '-S')) {
      const md = s.md[mdName(geraete[0] ?? '')]; if (!md?.laeuft) return fehler(`mdadm: error opening ${geraete[0] ?? ''}: No such file or directory`);
      if (w.platten!.mounts.some((m) => m.quelle === '/dev/' + md.name) || s.pvs['/dev/' + md.name]?.vg && s.vgs[s.pvs['/dev/' + md.name].vg!]?.aktiv) return fehler(`mdadm: Cannot get exclusive access to /dev/${md.name}:Perhaps a running process, mounted filesystem or active volume group?`);
      md.laeuft = false; sync(w); return ok(`mdadm: stopped /dev/${md.name}`);
    }
    if (hatOpt('--zero-superblock')) {
      for (const g of geraete) { const t = finden(w, g); if (Object.values(s.md).some((m) => m.laeuft && m.devs.some((d) => d.dev === g && d.rolle !== 'faulty'))) return fehler(`mdadm: Couldn't open ${g} for write - not zeroing`); if (t?.p?.fs?.art === 'linux_raid_member') t.p.fs = undefined; }
      return ok();
    }
    if (hatOpt('--monitor', '-F')) {
      const mail = (w.fs['/etc/mdadm/mdadm.conf'] ?? '').match(/^MAILADDR\s+(\S+)/m)?.[1];
      const z: string[] = [];
      for (const md of Object.values(s.md)) if (md.laeuft && md.level >= 1 && md.devs.filter((d) => d.rolle === 'aktiv').length < md.n) z.push(`Nov 23 ${new Date(w.uhr).toISOString().slice(11, 19)}: DegradedArray on /dev/${md.name} unknown device`);
      if (!z.length) return ok('');
      return ok(z.join('\n') + (mail ? `\n(mdadm hat eine Mail an ${mail} geschickt.)` : '\nmdadm: No mail address or alert command - not monitoring.'));
    }
    if (hatOpt('--grow', '-G')) {
      const md = s.md[mdName(geraete[0] ?? '')]; if (!md?.laeuft) return fehler(`mdadm: cannot open ${geraete[0] ?? ''}: No such file or directory`);
      const n = Number(wert('--raid-devices', '-n'));
      if (!n || n <= md.n) return fehler('(Im Simulator vergrößert --grow nur die Zahl der Geräte: --raid-devices=N mit N größer als bisher.)');
      const reserven = md.devs.filter((d) => d.rolle === 'spare');
      if (reserven.length < n - md.n) return fehler(`mdadm: Need ${n - md.n} spare${n - md.n > 1 ? 's' : ''} to avoid degraded array, and only have ${reserven.length}.\nmdadm: Use --force to over-ride this check.`);
      reserven.slice(0, n - md.n).forEach((d, i) => { d.rolle = 'neu'; d.nr = md.n + i; });
      md.n = n; md.sync = { art: 'reshape', start: w.uhr, dauer: 600000 };
      sync(w); return ok('');
    }
    // Verwaltung: mdadm /dev/md0 --fail X --remove X --add Y
    const md = s.md[mdName(a[0] ?? '')] ?? (hatOpt('--manage') ? s.md[mdName(geraete[0] ?? '')] : undefined);
    if (md) {
      if (!md.laeuft) return fehler(`mdadm: error opening /dev/${md.name}: No such file or directory`);
      const out: string[] = [];
      for (let i = 0; i < a.length; i++) {
        const op = a[i]; const g = a[i + 1];
        if (['--fail', '-f', '--set-faulty'].includes(op)) { const d = md.devs.find((x) => x.dev === g); if (!d) return fehler(`mdadm: ${g} does not appear to be a component of /dev/${md.name}`); d.rolle = 'faulty'; out.push(`mdadm: set ${g} faulty in /dev/${md.name}`); i++;
          if (md.level >= 1) { const ers = md.devs.find((x) => x.rolle === 'spare'); if (ers) { ers.rolle = 'neu'; ers.nr = d.nr; md.sync = { art: 'recovery', start: w.uhr, dauer: 300000 }; sp(w).dmesg.push(`[ ${(4100 + w.uhr / 1000 % 900).toFixed(6)}] md: recovery of RAID array ${md.name}`); } else if (md.sync?.art !== 'reshape') md.sync = null; } }
        else if (['--remove', '-r'].includes(op)) { const d = md.devs.find((x) => x.dev === g); if (!d) return fehler(`mdadm: ${g} does not appear to be a component of /dev/${md.name}`); if (d.rolle === 'aktiv' || d.rolle === 'neu') return fehler(`mdadm: hot remove failed for ${g}: Device or resource busy\n(Ein aktives Mitglied musst du zuerst mit --fail als defekt markieren.)`); md.devs = md.devs.filter((x) => x !== d); out.push(`mdadm: hot removed ${g} from /dev/${md.name}`); i++; }
        else if (['--add', '-a', '--re-add'].includes(op)) {
          const t = finden(w, g ?? ''); if (!t) return fehler(`mdadm: cannot find ${g}: No such file or directory`);
          if (md.devs.some((x) => x.dev === g)) return fehler(`mdadm: Cannot open ${g}: Device or resource busy`);
          if (gerBytes(w, g) < Math.min(...md.devs.map((x) => gerBytes(w, x.dev)))) return fehler(`mdadm: ${g} not large enough to join array`);
          const frei = Array.from({ length: md.n }, (_, k) => k).find((k) => !md.devs.some((x) => x.nr === k && (x.rolle === 'aktiv' || x.rolle === 'neu')));
          if (t.p) t.p.fs = neuesFs('linux_raid_member', w.uhr, `${w.host}:${md.name.slice(2)}`, md.uuid);
          if (frei !== undefined && md.level >= 1) { md.devs.push({ dev: g, rolle: 'neu', nr: frei }); md.sync = { art: 'recovery', start: w.uhr, dauer: 300000 }; sp(w).dmesg.push(`[ ${(4100 + w.uhr / 1000 % 900).toFixed(6)}] md: recovery of RAID array ${md.name}`); }
          else md.devs.push({ dev: g, rolle: 'spare', nr: Math.max(...md.devs.map((x) => x.nr)) + 1 });
          out.push(`mdadm: added ${g}`); i++;
        }
      }
      if (out.length) { sync(w); return ok(out.join('\n')); }
    }
    return fehler('(Im Simulator kennt mdadm: --create, --detail [--scan], --examine, /dev/mdX --fail/--remove/--add, --grow --raid-devices, --stop, --assemble [--scan], --zero-superblock, --monitor --scan --oneshot.)');
  });

  // ----- sfdisk: Partitionstabelle kopieren -----
  b.sfdisk = mit('sfdisk', (w, a, stdin, r) => {
    const dev = a.find((x) => x.startsWith('/dev/')) ?? ''; const t = finden(w, dev);
    if (!t || t.p) return fehler(`sfdisk: cannot open ${dev}: No such file or directory`);
    if (!nurRoot(r, w)) return fehler(`sfdisk: cannot open ${dev}: Keine Berechtigung`);
    const pl = t.pl;
    if (a.includes('--part-type')) { const [, nr, typ] = a.filter((x) => !x.startsWith('-')); const p = pl.partitionen.find((x) => x.nr === Number(nr)); if (!p) return fehler(`sfdisk: ${dev}: partition ${nr}: partition table contains only ${pl.partitionen.length} partitions`); p.typ = pl.label === 'gpt' ? ({ fd: 'Linux RAID', '8e': 'Linux LVM', '83': 'Linux-Dateisystem', raid: 'Linux RAID', lvm: 'Linux LVM' } as Record<string, string>)[typ.toLowerCase()] ?? typ : typ.toLowerCase(); return ok(`\nThe partition table has been altered.\nCalling ioctl() to re-read partition table.\nSyncing disks.`); }
    if (a.includes('-d') || a.includes('--dump')) {
      if (!pl.label) return fehler(`sfdisk: ${dev}: does not contain a recognized partition table`);
      return ok(`label: ${pl.label}\nlabel-id: ${pl.id}\ndevice: ${dev}\nunit: sectors\nsector-size: 512\n\n${pl.partitionen.map((p) => `${dev}${p.nr} : start=${String(p.start).padStart(12)}, size=${String(p.ende - p.start + 1).padStart(12)}, type=${p.typ.length <= 2 ? p.typ : p.typ === 'Linux RAID' ? 'A19D880F-05FC-4D3B-A006-743F0F84911E' : '0FC63DAF-8483-4772-8E79-3D69D8477DE4'}${p.boot ? ', bootable' : ''}`).join('\n')}`);
    }
    if (!stdin.trim()) return fehler('(Im Simulator: sfdisk -d /dev/QUELLE | sfdisk /dev/ZIEL oder sfdisk --part-type /dev/sdX 1 fd)');
    const label = stdin.match(/^label:\s*(\w+)/m)?.[1] as 'dos' | 'gpt' | undefined;
    const teile = [...stdin.matchAll(/^\S+?(\d+)\s*:\s*start=\s*(\d+),\s*size=\s*(\d+),\s*type=([\w-]+)/gm)];
    if (!label || !teile.length) return fehler('sfdisk: failed to parse script');
    const neuePart = teile.map((m) => ({ nr: Number(m[1]), start: Number(m[2]), ende: Number(m[2]) + Number(m[3]) - 1, typ: m[4].length <= 2 ? m[4] : m[4].startsWith('A19D') ? 'Linux RAID' : 'Linux-Dateisystem', partuuid: '' }));
    if (neuePart.some((p) => p.ende >= pl.sektoren)) return fehler(`sfdisk: ${dev}: Partition passt nicht auf das Gerät.`);
    pl.label = label; pl.id = label === 'dos' ? '0x' + (0x7a3b0000 + pl.name.charCodeAt(2)).toString(16) : uuid().toUpperCase();
    pl.partitionen = neuePart.map((p) => ({ ...p, partuuid: label === 'dos' ? `${pl.id.slice(2)}-0${p.nr}` : uuid() }));
    for (const p of pl.partitionen) w.fs[`/dev/${pl.name}${p.nr}`] = '';
    return ok(`Checking that no-one is using this disk right now ... OK\n\nDisk ${dev}: ${lgLang(pl.sektoren * 512).replace(',00', '')}, ${pl.sektoren * 512} bytes, ${pl.sektoren} sectors\nDisk model: ${pl.modell}\n\n>>> Script header accepted.\n${pl.partitionen.map((p) => `${dev}${p.nr}: Created a new partition ${p.nr} of type '${p.typ === 'fd' ? 'Linux raid autodetect' : p.typ}' and of size ${lgLang(fsBytes(p))}.`).join('\n')}\n${dev}${pl.partitionen.length + 1}: Done.\n\nThe partition table has been altered.\nCalling ioctl() to re-read partition table.\nSyncing disks.`);
  });

  // ----- LVM -----
  const lvAusArg = (w: Welt, x: string): Lv | undefined => { const s = sp(w); const y = x.replace(/^\/dev\/mapper\//, '').replace(/^\/dev\//, ''); return s.lvs[y] ?? Object.values(s.lvs).find((l) => mapperName(l.vg, l.name) === y); };
  b.pvcreate = mit('pvcreate', (w, a, _i, r) => {
    if (!nurRoot(r, w)) return fehler(lvmRoot, 5);
    const out: string[] = [];
    for (const d of a.filter((x) => x.startsWith('/dev/'))) {
      const t = finden(w, d); if (!t) return fehler(`  No device found for ${d}.`, 5);
      if (sp(w).pvs[d]) return fehler(`  Can't initialize physical volume "${d}" of volume group "${sp(w).pvs[d].vg ?? ''}" without -ff\n  ${d}: physical volume not initialized.`, 5);
      if (w.platten!.mounts.some((m) => m.quelle === d)) return fehler(`  Can't open ${d} exclusively.  Mounted filesystem?\n  Error opening device ${d} for reading at 0 length 512.`, 5);
      if (t.p?.fs?.art === 'linux_raid_member') return fehler(`  Cannot use ${d}: device is an md component`, 5);
      if (!t.p && t.pl.partitionen.length) return fehler(`  Cannot use ${d}: device is partitioned`, 5);
      pvAnlegen(w, d); out.push(`  Physical volume "${d}" successfully created.`);
    }
    return out.length ? ok(out.join('\n')) : fehler('  Please enter a physical volume path.\n  Run `pvcreate --help\' for more information.', 3);
  });
  b.vgcreate = mit('vgcreate', (w, a, _i, r) => {
    if (!nurRoot(r, w)) return fehler(lvmRoot, 5);
    const s = sp(w); const [name, ...devs] = a.filter((x) => !x.startsWith('-') && a[a.indexOf(x) - 1] !== '-s');
    if (!name || !devs.length) return fehler('  No command with matching syntax recognised.  Run \'vgcreate --help\' for more information.\n  Correct command syntax is:\n  vgcreate VG_new PV ...', 3);
    if (s.vgs[name]) return fehler(`  A volume group called ${name} already exists.`, 5);
    const out: string[] = [];
    for (const d of devs) {
      if (!s.pvs[d]) { const t = finden(w, d); if (!t) return fehler(`  No device found for ${d}.`, 5); pvAnlegen(w, d); out.push(`  Physical volume "${d}" successfully created.`); }
      if (s.pvs[d].vg) return fehler(`  Physical volume '${d}' is already in volume group '${s.pvs[d].vg}'\n  Unable to add physical volume '${d}' to volume group '${name}'`, 5);
    }
    s.vgs[name] = { uuid: lvmUuid(), pvs: [...devs], aktiv: true }; for (const d of devs) s.pvs[d].vg = name;
    out.push(`  Volume group "${name}" successfully created`); sync(w); return ok(out.join('\n'));
  });
  b.vgextend = mit('vgextend', (w, a, _i, r) => {
    if (!nurRoot(r, w)) return fehler(lvmRoot, 5);
    const s = sp(w); const [name, ...devs] = a.filter((x) => !x.startsWith('-'));
    if (!s.vgs[name]) return fehler(`  Volume group "${name}" not found\n  Cannot process volume group ${name}`, 5);
    const out: string[] = [];
    for (const d of devs) { if (!s.pvs[d]) { if (!finden(w, d)) return fehler(`  No device found for ${d}.`, 5); pvAnlegen(w, d); out.push(`  Physical volume "${d}" successfully created.`); } if (s.pvs[d].vg) return fehler(`  Physical volume '${d}' is already in volume group '${s.pvs[d].vg}'`, 5); s.pvs[d].vg = name; s.vgs[name].pvs.push(d); }
    out.push(`  Volume group "${name}" successfully extended`); return ok(out.join('\n'));
  });
  b.vgreduce = mit('vgreduce', (w, a, _i, r) => {
    if (!nurRoot(r, w)) return fehler(lvmRoot, 5);
    const s = sp(w); const [name, d] = a.filter((x) => !x.startsWith('-'));
    if (!s.vgs[name]) return fehler(`  Volume group "${name}" not found`, 5);
    if (s.pvs[d]?.vg !== name) return fehler(`  Physical Volume "${d}" not found in Volume Group "${name}".`, 5);
    if (peBelegt(w, d)) return fehler(`  Physical volume "${d}" still in use\n(Mit pvmove ${d} verschiebst du die Daten vorher auf die anderen PVs.)`, 5);
    if (s.vgs[name].pvs.length === 1) return fehler(`  Can't remove final physical volume "${d}" from volume group "${name}"`, 5);
    s.vgs[name].pvs = s.vgs[name].pvs.filter((x) => x !== d); delete s.pvs[d].vg;
    return ok(`  Removed "${d}" from volume group "${name}"`);
  });
  b.pvmove = mit('pvmove', (w, a, _i, r) => {
    if (!nurRoot(r, w)) return fehler(lvmRoot, 5);
    const s = sp(w); const [q, z] = a.filter((x) => x.startsWith('/dev/'));
    const vg = s.pvs[q]?.vg; if (!vg) return fehler(`  Physical volume ${q ?? ''} not found`, 5);
    const n = peBelegt(w, q); if (!n) return fehler(`  No data to move for ${vg}.`, 5);
    const ziele = z ? [z] : s.vgs[vg].pvs.filter((x) => x !== q);
    if (z && s.pvs[z]?.vg !== vg) return fehler(`  Physical volume ${z} not in volume group ${vg}`, 5);
    const frei = ziele.reduce((m, d) => m + peGesamt(s.pvs[d]) - peBelegt(w, d), 0);
    if (frei < n) return fehler(`  Insufficient free space: ${n} extents needed, but only ${frei} available\n  Unable to allocate mirror extents for ${vg}/pvmove0.\n  Failed to convert pvmove LV to mirrored.`, 5);
    for (const lv of Object.values(s.lvs).filter((l) => l.vg === vg)) {
      const weg = lv.segs.filter((x) => x.pv === q).reduce((m, x) => m + x.n, 0); if (!weg) continue;
      lv.segs = lv.segs.filter((x) => x.pv !== q); const neu = zuteilen(w, vg, weg, ziele)!; lv.segs.push(...neu);
    }
    return ok(`  ${q}: Moved: 23,45%\n  ${q}: Moved: 71,02%\n  ${q}: Moved: 100,00%`);
  });
  b.pvremove = mit('pvremove', (w, a, _i, r) => {
    if (!nurRoot(r, w)) return fehler(lvmRoot, 5);
    const s = sp(w); const out: string[] = [];
    for (const d of a.filter((x) => x.startsWith('/dev/'))) { if (!s.pvs[d]) return fehler(`  No PV found on device ${d}.`, 5); if (s.pvs[d].vg) return fehler(`  PV ${d} is used by VG ${s.pvs[d].vg} so please use vgreduce first.\n  (If you are certain you need pvremove, then confirm by using --force twice.)\n  ${d}: physical volume label not removed.`, 5); delete s.pvs[d]; const t = finden(w, d); if (t?.p) t.p.fs = undefined; out.push(`  Labels on physical volume "${d}" successfully wiped.`); }
    return ok(out.join('\n'));
  });
  b.pvresize = mit('pvresize', (w, a, _i, r) => { if (!nurRoot(r, w)) return fehler(lvmRoot, 5); const d = a.find((x) => x.startsWith('/dev/')) ?? ''; const pv = sp(w).pvs[d]; if (!pv) return fehler(`  Failed to find physical volume "${d}".`, 5); pv.bytes = gerBytes(w, d); return ok(`  Physical volume "${d}" changed\n  1 physical volume(s) resized or updated / 0 physical volume(s) not resized`); });
  b.vgrename = mit('vgrename', (w, a, _i, r) => {
    if (!nurRoot(r, w)) return fehler(lvmRoot, 5);
    const s = sp(w); const [alt_, neu] = a.filter((x) => !x.startsWith('-'));
    if (!s.vgs[alt_]) return fehler(`  Volume group "${alt_}" not found`, 5); if (s.vgs[neu]) return fehler(`  New volume group "${neu}" already exists`, 5);
    if (Object.values(s.lvs).some((l) => l.vg === alt_ && w.platten!.mounts.some((m) => m.quelle.includes(`/${alt_}/`) || m.quelle.includes(mapperName(alt_, l.name))))) { /* LVM erlaubt das, die Einhängung zeigt aber den alten Namen */ }
    s.vgs[neu] = s.vgs[alt_]; delete s.vgs[alt_];
    for (const pv of Object.values(s.pvs)) if (pv.vg === alt_) pv.vg = neu;
    for (const [k, lv] of Object.entries(s.lvs)) if (lv.vg === alt_) { delete s.lvs[k]; lv.vg = neu; s.lvs[`${neu}/${lv.name}`] = lv; s.dm[`${neu}/${lv.name}`] = s.dm[k]; }
    sync(w); return ok(`  Volume group "${alt_}" successfully renamed to "${neu}"`);
  });
  b.lvrename = mit('lvrename', (w, a, _i, r) => {
    if (!nurRoot(r, w)) return fehler(lvmRoot, 5);
    const s = sp(w); const x = a.filter((y) => !y.startsWith('-'));
    let vg: string, alt_: string, neu: string;
    if (x.length === 3) [vg, alt_, neu] = x; else { const l = lvAusArg(w, x[0] ?? ''); if (!l) return fehler(`  Existing logical volume "${x[0] ?? ''}" not found in volume group`, 5); vg = l.vg; alt_ = l.name; neu = (x[1] ?? '').split('/').pop()!; }
    const lv = s.lvs[`${vg}/${alt_}`]; if (!lv) return fehler(`  Existing logical volume "${alt_}" not found in volume group "${vg}"`, 5);
    if (s.lvs[`${vg}/${neu}`]) return fehler(`  Logical Volume "${neu}" already exists in volume group "${vg}"`, 5);
    delete s.lvs[`${vg}/${alt_}`]; lv.name = neu; s.lvs[`${vg}/${neu}`] = lv; s.dm[`${vg}/${neu}`] = s.dm[`${vg}/${alt_}`];
    for (const o of Object.values(s.lvs)) if (o.snap?.von === alt_ && o.vg === vg) o.snap.von = neu;
    sync(w); return ok(`  Renamed "${alt_}" to "${neu}" in volume group "${vg}"`);
  });
  b.lvcreate = mit('lvcreate', (w, a, _i, r) => {
    if (!nurRoot(r, w)) return fehler(lvmRoot, 5);
    const s = sp(w);
    const opt = (k: string[]) => { for (let i = 0; i < a.length; i++) { for (const o of k) { if (a[i] === o) return a[i + 1]; if (o.startsWith('--') && a[i].startsWith(o + '=')) return a[i].slice(o.length + 1); if (!o.startsWith('--') && a[i].startsWith(o) && a[i].length > o.length) return a[i].slice(o.length); } } return undefined; };
    const L = opt(['-L', '--size']); const l = opt(['-l', '--extents']); const n = opt(['-n', '--name']); const snap = a.includes('-s') || a.includes('--snapshot');
    const pos = a.filter((x, i) => !x.startsWith('-') && !['-L', '--size', '-l', '--extents', '-n', '--name'].includes(a[i - 1]));
    if (snap) {
      const o = lvAusArg(w, pos[0] ?? ''); if (!o) return fehler(`  Failed to find LV ${pos[0] ?? ''} for snapshot.`, 5);
      if (!L && !l) return fehler('  Please specify either size or extents with snapshots.', 3);
      const cow = L ? groesse(L) : Math.round(Number(l) * PE);
      const pe = Math.ceil(cow / PE); if (vgFrei(w, o.vg) < pe) return fehler(`  Volume group "${o.vg}" has insufficient free space (${vgFrei(w, o.vg)} extents): ${pe} required.`, 5);
      const name = n ?? `lvol${Object.keys(s.lvs).length}`;
      if (s.lvs[`${o.vg}/${name}`]) return fehler(`  Logical Volume "${name}" already exists in volume group "${o.vg}"`, 5);
      const basis = inhalt(w, o);
      const lv: Lv = { vg: o.vg, name, uuid: lvmUuid(), segs: zuteilen(w, o.vg, pe)!, aktiv: true, p: { nr: 1, start: 0, ende: o.p.ende, typ: '', partuuid: '' }, snap: { von: o.name, cow, basis } };
      if (o.p.fs) { lv.p.fs = JSON.parse(JSON.stringify(o.p.fs)) as Dateisystem; lv.p.fs.dateien = { ...basis }; lv.p.fs.metas = {}; }
      s.lvs[`${o.vg}/${name}`] = lv; sync(w);
      return ok(`  Logical volume "${name}" created.`);
    }
    const vg = pos[0]?.replace(/^\/dev\//, ''); if (!vg || !s.vgs[vg]) return fehler(vg ? `  Volume group "${vg}" not found\n  Cannot process volume group ${vg}` : '  Please specify a volume group.', 5);
    if (!n) return fehler('  Please specify a name with -n.\n(Ohne Namen vergibt LVM lvol0, lvol1 … Im Simulator gib ihn bitte an.)', 3);
    if (s.lvs[`${vg}/${n}`]) return fehler(`  Logical Volume "${n}" already exists in volume group "${vg}"`, 5);
    let pe: number;
    if (L) pe = Math.ceil(groesse(L) / PE);
    else if (l) { const m = l.match(/^(\d+)%(FREE|VG)$/i); pe = m ? Math.floor((m[2].toUpperCase() === 'FREE' ? vgFrei(w, vg) : vgGesamt(w, vg)) * Number(m[1]) / 100) : Number(l); }
    else return fehler('  Please specify either size or extents (not both).', 3);
    if (!pe || isNaN(pe)) return fehler('  Invalid argument for --size', 3);
    if (vgFrei(w, vg) < pe) return fehler(`  Volume group "${vg}" has insufficient free space (${vgFrei(w, vg)} extents): ${pe} required.`, 5);
    lvAnlegen(w, vg, n, pe); sync(w);
    return ok(`  Logical volume "${n}" created.`);
  });
  function fsAnpassen(w: Welt, lv: Lv, neuBytes: number, vergroessern: boolean): string | null {
    const fs = lv.p.fs; if (!fs) return null;
    const dev = `/dev/mapper/${mapperName(lv.vg, lv.name)}`;
    const ein = w.platten!.mounts.find((m) => m.quelle === dev || m.quelle === `/dev/${lv.vg}/${lv.name}`);
    if (fs.art === 'xfs') { if (!vergroessern) return 'fsadm: Xfs filesystem shrinking is unsupported.\n  /usr/sbin/fsadm failed: 1\n  Filesystem resize failed.'; if (!ein) return 'fsadm: Cannot get FSTYPE of "/dev/mapper/…" (XFS lässt sich nur eingehängt vergrößern.)'; fs.bytes = undefined; return null; }
    if (fs.art.startsWith('ext')) { if (!vergroessern && ein) return `fsadm: Cannot proceed with mounted filesystem "${ein.ziel}".\n  /usr/sbin/fsadm failed: 1\n  Filesystem resize failed.\n(ext4 verkleinert man nur ausgehängt.)`; fs.bytes = neuBytes < fsBytes(lv.p) ? neuBytes : undefined; return null; }
    return null;
  }
  const lvGroesse = (name: string): B => mit(name, (w, a, _i, r) => {
    if (!nurRoot(r, w)) return fehler(lvmRoot, 5);
    const s = sp(w);
    const opt = (k: string[]) => { for (let i = 0; i < a.length; i++) for (const o of k) { if (a[i] === o) return a[i + 1]; if (o.startsWith('--') && a[i].startsWith(o + '=')) return a[i].slice(o.length + 1); if (!o.startsWith('--') && a[i].startsWith(o) && a[i].length > o.length) return a[i].slice(o.length); } return undefined; };
    const L = opt(['-L', '--size']); const l = opt(['-l', '--extents']); const mitFs = a.includes('-r') || a.includes('--resizefs');
    const pos = a.filter((x, i) => !x.startsWith('-') && !['-L', '--size', '-l', '--extents'].includes(a[i - 1]));
    const lv = lvAusArg(w, pos[0] ?? ''); if (!lv) return fehler(`  Failed to find logical volume "${pos[0] ?? ''}"`, 5);
    const alt_ = lvPe(lv); let neu: number;
    if (L) { const b2 = Math.ceil(groesse(L.replace(/^[+-]/, '')) / PE); neu = L.startsWith('+') ? alt_ + b2 : L.startsWith('-') ? alt_ - b2 : b2; }
    else if (l) { const m = l.match(/^([+-]?)(\d+)%(FREE|VG|PVS)?$/i); const basis = m ? Math.floor((m[3]?.toUpperCase() === 'VG' ? vgGesamt(w, lv.vg) : vgFrei(w, lv.vg)) * Number(m[2]) / 100) : Number(l.replace(/^[+-]/, '')); neu = (m?.[1] ?? l[0]) === '+' ? alt_ + basis : (m?.[1] ?? l[0]) === '-' ? alt_ - basis : (m?.[3]?.toUpperCase() === 'FREE' && !m[1] ? alt_ + basis : basis); }
    else return fehler('  Please specify either size or extents.', 3);
    const art = name === 'lvresize' ? (neu > alt_ ? 'lvextend' : 'lvreduce') : name;
    if (art === 'lvextend' && neu <= alt_) return fehler(`  New size given (${neu} extents) not larger than existing size (${alt_} extents)`, 5);
    if (art === 'lvreduce' && neu >= alt_) return fehler(`  New size given (${neu} extents) not less than existing size (${alt_} extents)`, 5);
    if (art === 'lvextend' && neu - alt_ > vgFrei(w, lv.vg)) return fehler(`  Insufficient free space: ${neu - alt_} extents needed, but only ${vgFrei(w, lv.vg)} available`, 5);
    const altBytes = fsBytes(lv.p); const neuBytes = neu * PE;
    const anwenden = (): Ergebnis => {
      if (art === 'lvreduce' && mitFs) { const e = fsAnpassen(w, lv, neuBytes, false); if (e) return fehler(e, 5); }
      if (art === 'lvextend') { const mehr = zuteilen(w, lv.vg, neu - alt_)!; for (const x of mehr) { const last = lv.segs.find((y) => y.pv === x.pv); if (last) last.n += x.n; else lv.segs.push(x); } }
      else { let weg = alt_ - neu; for (let i = lv.segs.length - 1; i >= 0 && weg > 0; i--) { const k = Math.min(lv.segs[i].n, weg); lv.segs[i].n -= k; weg -= k; } lv.segs = lv.segs.filter((x) => x.n > 0); }
      lv.p.ende = neuBytes / 512 - 1;
      const vorher: string[] = [];
      if (art === 'lvreduce' && mitFs && lv.p.fs?.art.startsWith('ext')) { const d = `/dev/mapper/${mapperName(lv.vg, lv.name)}`; vorher.push(`fsck from util-linux 2.38.1\n${d}: 15/${Math.round(altBytes / 16384)} Dateien (0.0% nicht zusammenhängend), 630428/${altBytes / 4096} Blöcke`, `resize2fs 1.47.0 (5-Feb-2023)\nDie Größe des Dateisystems auf ${d} wird auf ${neuBytes / 4096} (4k) Blöcke geändert.\nDas Dateisystem auf ${d} ist nun ${neuBytes / 4096} (4k) Blöcke lang.\n`); }
      const z = [`  Size of logical volume ${lv.vg}/${lv.name} changed from ${lgLang(altBytes)} (${alt_} extents) to ${lgLang(neuBytes)} (${neu} extents).`, `  Logical volume ${lv.vg}/${lv.name} successfully resized.`];
      if (lv.p.fs) {
        if (art === 'lvextend' && mitFs) { const e = fsAnpassen(w, lv, neuBytes, true); if (e) z.push(e); else z.push(lv.p.fs.art === 'xfs' ? `meta-data=/dev/mapper/${mapperName(lv.vg, lv.name)} isize=512    agcount=4\ndata blocks changed from ${altBytes / 4096} to ${neuBytes / 4096}` : `resize2fs 1.47.0 (5-Feb-2023)\nDas Dateisystem auf /dev/mapper/${mapperName(lv.vg, lv.name)} ist auf ${w.platten!.mounts.find((m) => m.quelle.endsWith(mapperName(lv.vg, lv.name)) || m.quelle === `/dev/${lv.vg}/${lv.name}`)?.ziel ?? '(nicht eingehängt)'} eingehängt; Online-Größenänderung ist\nerforderlich\nDas Dateisystem auf /dev/mapper/${mapperName(lv.vg, lv.name)} ist nun ${neuBytes / 4096} (4k) Blöcke lang.`); }
        else if (art === 'lvextend') { if (lv.p.fs.bytes === undefined) lv.p.fs.bytes = altBytes; }
        else if (art === 'lvreduce' && !mitFs && (lv.p.fs.bytes ?? altBytes) > neuBytes) { lv.p.fs.kaputt = true; lv.p.fs.bytes = undefined; }
      }
      sync(w); return ok([...vorher, ...z].join('\n'));
    };
    if (art === 'lvreduce' && !mitFs) {
      w.wartet = { standardJa: false, aktion: anwenden, nein: `  Logical volume ${lv.vg}/${lv.name} NOT reduced.` };
      return ok(`  WARNING: Reducing active${w.platten!.mounts.some((m) => m.quelle.endsWith(mapperName(lv.vg, lv.name)) || m.quelle === `/dev/${lv.vg}/${lv.name}`) ? ' and open' : ''} logical volume to ${lgLang(neuBytes)}.\n  THIS MAY DESTROY YOUR DATA (filesystem etc.)\nDo you really want to reduce ${lv.vg}/${lv.name}? [y/n]: `);
    }
    return anwenden();
  });
  b.lvextend = lvGroesse('lvextend'); b.lvreduce = lvGroesse('lvreduce'); b.lvresize = lvGroesse('lvresize');
  b.lvremove = mit('lvremove', (w, a, _i, r) => {
    if (!nurRoot(r, w)) return fehler(lvmRoot, 5);
    const s = sp(w); const lv = lvAusArg(w, a.filter((x) => !x.startsWith('-'))[0] ?? ''); if (!lv) return fehler(`  Failed to find logical volume "${a.filter((x) => !x.startsWith('-'))[0] ?? ''}"`, 5);
    if (w.platten!.mounts.some((m) => m.quelle.endsWith(mapperName(lv.vg, lv.name)) || m.quelle === `/dev/${lv.vg}/${lv.name}`)) return fehler(`  Logical volume ${lv.vg}/${lv.name} contains a filesystem in use.`, 5);
    if (Object.values(s.lvs).some((x) => x.snap?.von === lv.name && x.vg === lv.vg)) return fehler(`  Can't remove logical volume ${lv.name} with snapshots. Remove them first.\n(Im echten LVM fragt lvremove, ob es die Snapshots mitlöschen soll.)`, 5);
    const weg = (): Ergebnis => { delete s.lvs[`${lv.vg}/${lv.name}`]; sync(w); return ok(`  Logical volume "${lv.name}" successfully removed.`); };
    if (a.includes('-f') || a.includes('-y') || a.includes('--yes') || !lv.aktiv) return weg();
    w.wartet = { standardJa: false, aktion: weg, nein: `  Logical volume ${lv.name} not removed.` };
    return ok(`Do you really want to remove active logical volume ${lv.vg}/${lv.name}? [y/n]: `);
  });
  b.vgremove = mit('vgremove', (w, a, _i, r) => {
    if (!nurRoot(r, w)) return fehler(lvmRoot, 5);
    const s = sp(w); const name = a.filter((x) => !x.startsWith('-'))[0] ?? '';
    if (!s.vgs[name]) return fehler(`  Volume group "${name}" not found`, 5);
    if (Object.values(s.lvs).some((l) => l.vg === name)) return fehler(`  Volume group "${name}" still contains ${Object.values(s.lvs).filter((l) => l.vg === name).length} logical volume(s)\n(Lösch die LVs vorher mit lvremove.)`, 5);
    for (const d of s.vgs[name].pvs) delete s.pvs[d].vg; delete s.vgs[name];
    return ok(`  Volume group "${name}" successfully removed`);
  });
  const aktivieren = (w: Welt, lvs: Lv[], an: boolean): string | null => {
    const s = sp(w);
    for (const lv of lvs) {
      if (!an && w.platten!.mounts.some((m) => m.quelle.endsWith(mapperName(lv.vg, lv.name)) || m.quelle === `/dev/${lv.vg}/${lv.name}`)) return `  Logical volume ${lv.vg}/${lv.name} contains a filesystem in use.\n  Can't deactivate volume group "${lv.vg}" with 1 open logical volume(s)`;
    }
    for (const lv of lvs) {
      lv.aktiv = an;
      // Ein verzögertes Zusammenführen geschieht bei der nächsten Aktivierung
      if (an) for (const sn of Object.values(s.lvs).filter((x) => x.merge && x.snap && x.vg === lv.vg && (x.snap.von === lv.name || x === lv))) { const o = s.lvs[`${sn.vg}/${sn.snap!.von}`]; if (o && !w.platten!.mounts.some((m) => m.quelle.endsWith(mapperName(o.vg, o.name)) || m.quelle === `/dev/${o.vg}/${o.name}`)) { o.p.fs = sn.p.fs; delete s.lvs[`${sn.vg}/${sn.name}`]; s.dmesg.push(`[ ${(4300 + w.uhr / 1000 % 900).toFixed(6)}] device-mapper: snapshots: Merging of ${sn.vg}-${sn.name} into ${sn.vg}-${o.name} finished.`); } }
    }
    sync(w); return null;
  };
  b.vgchange = mit('vgchange', (w, a, _i, r) => {
    if (!nurRoot(r, w)) return fehler(lvmRoot, 5);
    const s = sp(w); const ai = a.findIndex((x) => /^-a[yn]$|^--activate$/.test(x)); const wert = a[ai] === '--activate' ? a[ai + 1] : a[ai]?.slice(2);
    if (ai < 0) return fehler('(Im Simulator kennt vgchange -ay und -an.)');
    const an = wert === 'y'; const namen = a.filter((x, i) => !x.startsWith('-') && i !== ai + 1); const vgs = namen.length ? namen : Object.keys(s.vgs);
    for (const v of vgs) if (!s.vgs[v]) return fehler(`  Volume group "${v}" not found`, 5);
    const e = aktivieren(w, Object.values(s.lvs).filter((l) => vgs.includes(l.vg)), an); if (e) return fehler(e, 5);
    for (const v of vgs) s.vgs[v].aktiv = an;
    return ok(vgs.map((v) => `  ${an ? Object.values(s.lvs).filter((l) => l.vg === v).length : 0} logical volume(s) in volume group "${v}" now active`).join('\n'));
  });
  b.lvchange = mit('lvchange', (w, a, _i, r) => {
    if (!nurRoot(r, w)) return fehler(lvmRoot, 5);
    const ai = a.findIndex((x) => /^-a[yn]$/.test(x)); if (ai < 0) return fehler('(Im Simulator kennt lvchange -ay und -an.)');
    const lv = lvAusArg(w, a.filter((x) => !x.startsWith('-'))[0] ?? ''); if (!lv) return fehler('  Failed to find logical volume', 5);
    const e = aktivieren(w, [lv], a[ai] === '-ay'); return e ? fehler(e, 5) : ok();
  });
  b.lvconvert = mit('lvconvert', (w, a, _i, r) => {
    if (!nurRoot(r, w)) return fehler(lvmRoot, 5);
    const s = sp(w); if (!a.includes('--merge') && !a.includes('--mergesnapshot')) return fehler('(Im Simulator kennt lvconvert nur --merge für Snapshots.)');
    const lv = lvAusArg(w, a.filter((x) => !x.startsWith('-'))[0] ?? ''); if (!lv?.snap) return fehler(`  Command on LV ${a.filter((x) => !x.startsWith('-'))[0] ?? ''} does not accept LV type linear.`, 5);
    if (lv.ungueltig) return fehler(`  Unable to merge invalidated snapshot LV "${lv.name}".`, 5);
    const o = s.lvs[`${lv.vg}/${lv.snap.von}`];
    const offen = (x: Lv) => w.platten!.mounts.some((m) => m.quelle.endsWith(mapperName(x.vg, x.name)) || m.quelle === `/dev/${x.vg}/${x.name}`);
    if (offen(lv)) return fehler(`  Can't merge snapshot that is open. Unmount it first.`, 5);
    if (offen(o)) { lv.merge = true; return ok(`  Delaying merge since origin is open.\n  Merging of snapshot ${lv.vg}/${lv.name} will occur on next activation of ${lv.vg}/${o.name}.`); }
    o.p.fs = lv.p.fs; delete s.lvs[`${lv.vg}/${lv.name}`]; sync(w);
    return ok(`  Merging of volume ${lv.vg}/${lv.name} started.\n  ${lv.vg}/${o.name}: Merged: 100,00%`);
  });
  // Anzeigen
  b.pvs = mit('pvs', (w, a, _i, r) => { if (!nurRoot(r, w)) return fehler(lvmRoot, 5); const s = sp(w); const z = Object.entries(s.pvs); if (!z.length) return ok(''); return ok(['  PV         VG     Fmt  Attr PSize   PFree  ', ...z.map(([d, pv]) => `  ${d.padEnd(10)} ${(pv.vg ?? '').padEnd(6)} lvm2 ${pv.vg ? 'a--' : '---'}  ${lg(pv.vg ? peGesamt(pv) * PE : pv.bytes).padStart(7)} ${lg(pv.vg ? (peGesamt(pv) - peBelegt(w, d)) * PE : pv.bytes).padStart(7)}`)].join('\n')); });
  b.vgs = mit('vgs', (w, a, _i, r) => { if (!nurRoot(r, w)) return fehler(lvmRoot, 5); const s = sp(w); const z = Object.entries(s.vgs); if (!z.length) return ok(''); return ok(['  VG     #PV #LV #SN Attr   VSize   VFree  ', ...z.map(([n, vg]) => `  ${n.padEnd(6)} ${String(vg.pvs.length).padStart(3)} ${String(Object.values(s.lvs).filter((l) => l.vg === n).length).padStart(3)} ${String(Object.values(s.lvs).filter((l) => l.vg === n && l.snap).length).padStart(3)} wz--n- ${lg(vgGesamt(w, n) * PE).padStart(7)} ${lg(vgFrei(w, n) * PE).padStart(7)}`)].join('\n')); });
  b.lvs = mit('lvs', (w, a, _i, r) => {
    if (!nurRoot(r, w)) return fehler(lvmRoot, 5); const s = sp(w); sync(w); const z = Object.values(s.lvs); if (!z.length) return ok('');
    const attr = (l: Lv) => { const origin = z.some((x) => x.snap?.von === l.name && x.vg === l.vg); const offen = w.platten!.mounts.some((m) => m.quelle.endsWith(mapperName(l.vg, l.name)) || m.quelle === `/dev/${l.vg}/${l.name}`); return `${l.snap ? 's' : origin ? 'o' : '-'}wi-${l.ungueltig ? 'I' : l.aktiv ? 'a' : '-'}${l.snap ? 's' : '-'}${offen ? 'o' : '-'}--`; };
    const bn = Math.max(9, ...z.map((l) => l.name.length)); const bv = Math.max(6, ...z.map((l) => l.vg.length));
    return ok([`  ${'LV'.padEnd(bn)} ${'VG'.padEnd(bv)} Attr       LSize   Pool Origin    Data%  Meta%  Move Log Cpy%Sync Convert`, ...z.map((l) => `  ${l.name.padEnd(bn)} ${l.vg.padEnd(bv)} ${attr(l)} ${lg(l.snap ? lvPe(l) * PE : fsBytes(l.p)).padStart(7)}      ${(l.snap?.von ?? '').padEnd(9)} ${l.snap ? (l.ungueltig ? '100.00' : cowProzent(w, l).toFixed(2)).padStart(6) : '      '}`.trimEnd())].join('\n'));
  });
  b.pvdisplay = mit('pvdisplay', (w, a, _i, r) => { if (!nurRoot(r, w)) return fehler(lvmRoot, 5); const s = sp(w); const ziel = a.find((x) => x.startsWith('/dev/')); return ok(Object.entries(s.pvs).filter(([d]) => !ziel || d === ziel).map(([d, pv]) => `  --- Physical volume ---\n  PV Name               ${d}\n  VG Name               ${pv.vg ?? ''}\n  PV Size               ${lgLang(pv.bytes)} / not usable 3,00 MiB\n  Allocatable           ${pv.vg ? 'yes' : 'NO'}\n  PE Size               4,00 MiB\n  Total PE              ${peGesamt(pv)}\n  Free PE               ${peGesamt(pv) - peBelegt(w, d)}\n  Allocated PE          ${peBelegt(w, d)}\n  PV UUID               ${pv.uuid}\n`).join('\n')); });
  b.vgdisplay = mit('vgdisplay', (w, a, _i, r) => { if (!nurRoot(r, w)) return fehler(lvmRoot, 5); const s = sp(w); const ziel = a.find((x) => !x.startsWith('-')); return ok(Object.entries(s.vgs).filter(([n]) => !ziel || n === ziel).map(([n, vg]) => `  --- Volume group ---\n  VG Name               ${n}\n  System ID             \n  Format                lvm2\n  Metadata Areas        ${vg.pvs.length}\n  VG Access             read/write\n  VG Status             resizable\n  Cur LV                ${Object.values(s.lvs).filter((l) => l.vg === n).length}\n  Open LV               ${Object.values(s.lvs).filter((l) => l.vg === n && w.platten!.mounts.some((m) => m.quelle.endsWith(mapperName(l.vg, l.name)) || m.quelle === `/dev/${l.vg}/${l.name}`)).length}\n  Cur PV                ${vg.pvs.length}\n  Act PV                ${vg.pvs.length}\n  VG Size               ${lgLang(vgGesamt(w, n) * PE)}\n  PE Size               4,00 MiB\n  Total PE              ${vgGesamt(w, n)}\n  Alloc PE / Size       ${vgGesamt(w, n) - vgFrei(w, n)} / ${lgLang((vgGesamt(w, n) - vgFrei(w, n)) * PE)}\n  Free  PE / Size       ${vgFrei(w, n)} / ${lgLang(vgFrei(w, n) * PE)}\n  VG UUID               ${vg.uuid}\n`).join('\n')); });
  b.lvdisplay = mit('lvdisplay', (w, a, _i, r) => { if (!nurRoot(r, w)) return fehler(lvmRoot, 5); const s = sp(w); sync(w); const ziel = a.find((x) => !x.startsWith('-')); const l0 = ziel ? lvAusArg(w, ziel) : undefined; return ok(Object.values(s.lvs).filter((l) => !ziel || l === l0 || l.vg === ziel).map((l) => `  --- Logical volume ---\n  LV Path                /dev/${l.vg}/${l.name}\n  LV Name                ${l.name}\n  VG Name                ${l.vg}\n  LV UUID                ${l.uuid}\n  LV Write Access        read/write\n  LV Status              ${l.aktiv ? 'available' : 'NOT available'}${l.snap ? `\n  LV snapshot status     ${l.ungueltig ? 'INACTIVE destination for' : 'active destination for'} ${l.snap.von}` : Object.values(s.lvs).some((x) => x.snap?.von === l.name && x.vg === l.vg) ? `\n  LV snapshot status     source of\n                         ${Object.values(s.lvs).filter((x) => x.snap?.von === l.name && x.vg === l.vg).map((x) => `${x.name} [${x.ungueltig ? 'INACTIVE' : 'active'}]`).join('\n                         ')}` : ''}\n  # open                 ${w.platten!.mounts.some((m) => m.quelle.endsWith(mapperName(l.vg, l.name)) || m.quelle === `/dev/${l.vg}/${l.name}`) ? 1 : 0}\n  LV Size                ${lgLang(fsBytes(l.p))}\n  Current LE             ${fsBytes(l.p) / PE}${l.snap ? `\n  COW-table size         ${lgLang(l.snap.cow)}\n  Allocated to snapshot  ${l.ungueltig ? '100,00' : cowProzent(w, l).toFixed(2).replace('.', ',')}%` : ''}\n  Segments               ${l.segs.length}\n  Allocation             inherit\n  Block device           254:${s.dm[`${l.vg}/${l.name}`] ?? 0}\n`).join('\n')); });
  b.pvscan = mit('pvscan', (w, a, _i, r) => { if (!nurRoot(r, w)) return fehler(lvmRoot, 5); const s = sp(w); return ok(Object.entries(s.pvs).map(([d, pv]) => `  PV ${d.padEnd(10)} ${pv.vg ? `VG ${pv.vg.padEnd(10)} lvm2 [${lgLang(peGesamt(pv) * PE)} / ${lgLang((peGesamt(pv) - peBelegt(w, d)) * PE)} free]` : `             lvm2 [${lgLang(pv.bytes)}]`}`).join('\n') + `\n  Total: ${Object.keys(s.pvs).length} [${lgLang(Object.values(s.pvs).reduce((n, p) => n + p.bytes, 0))}] / in use: ${Object.values(s.pvs).filter((p) => p.vg).length} / in no VG: ${Object.values(s.pvs).filter((p) => !p.vg).length}`); });
  b.vgscan = mit('vgscan', (w, a, _i, r) => { if (!nurRoot(r, w)) return fehler(lvmRoot, 5); return ok(Object.keys(sp(w).vgs).map((n) => `  Found volume group "${n}" using metadata type lvm2`).join('\n')); });
  b.lvscan = mit('lvscan', (w, a, _i, r) => { if (!nurRoot(r, w)) return fehler(lvmRoot, 5); return ok(Object.values(sp(w).lvs).map((l) => `  ${l.aktiv ? 'ACTIVE  ' : 'inactive'}  ${l.snap ? 'Snapshot' : Object.values(sp(w).lvs).some((x) => x.snap?.von === l.name) ? 'Original' : '        '} '/dev/${l.vg}/${l.name}' [${lgLang(fsBytes(l.p))}] inherit`).join('\n')); });
  b.lvm = mit('lvm', (w, a, i, r) => { const [c, ...rest] = a; if (c && b[c]) return b[c](w, rest, i, r); if (c === 'version') return ok('  LVM version:     2.03.16(2) (2022-05-18)\n  Library version: 1.02.185 (2022-05-18)\n  Driver version:  4.47.0'); return fehler('(Im Simulator: lvm mit einem LVM-Befehl, etwa lvm pvs, oder lvm version.)'); });

  // Dateisystem vergrößern und verkleinern
  b.resize2fs = mit('resize2fs', (w, a, _i, r) => {
    const dev = a.find((x) => x.startsWith('/dev/')) ?? ''; const t = finden(w, dev); const kopf = 'resize2fs 1.47.0 (5-Feb-2023)';
    if (!t?.p?.fs?.art.startsWith('ext')) return fehler(`${kopf}\nresize2fs: Datei oder Verzeichnis nicht gefunden beim Versuch, ${dev} zu öffnen\nSuperblock konnte nicht gefunden werden.`);
    if (!nurRoot(r, w)) return fehler(`${kopf}\nresize2fs: Keine Berechtigung beim Versuch, ${dev} zu öffnen`);
    const fs = t.p.fs; const ziel = a.filter((x) => !x.startsWith('-') && !x.startsWith('/dev/'))[0];
    const geraet = fsBytes(t.p); const alt_ = fs.bytes ?? geraet; const neu = ziel ? groesse(ziel, 'k') : geraet;
    if (neu > geraet) return fehler(`${kopf}\nDie angeforderte neue Größe ist größer als das Gerät.`);
    const ein = w.platten!.mounts.find((m) => m.quelle === dev || finden(w, m.quelle)?.p === t.p);
    if (neu === alt_) return ok(`${kopf}\nDas Dateisystem ist schon ${alt_ / 4096} (4k) Blöcke lang.  Nichts zu tun!`);
    if (neu < alt_) {
      if (ein) return fehler(`${kopf}\nDas Dateisystem auf ${dev} ist auf ${ein.ziel} eingehängt; Online-Größenänderung ist\nerforderlich\nresize2fs: Online-Verkleinern wird nicht unterstützt`);
      if (!(fs.zusatz as { geprueft?: boolean } | undefined)?.geprueft) return fehler(`${kopf}\nBitte zuerst »e2fsck -f ${dev}« laufen lassen.`);
    }
    fs.bytes = neu >= geraet ? undefined : neu;
    return ok(`${kopf}\n${ein ? `Das Dateisystem auf ${dev} ist auf ${ein.ziel} eingehängt; Online-Größenänderung ist\nerforderlich\nold_desc_blocks = 25, new_desc_blocks = 50\n` : 'Die Größe des Dateisystems auf ' + dev + ' wird auf ' + neu / 4096 + ' (4k) Blöcke geändert.\n'}Das Dateisystem auf ${dev} ist nun ${neu / 4096} (4k) Blöcke lang.`);
  });
  b.e2fsck = (w, a, i, r) => { const x = alt.e2fsck(w, a, i, r); if (speicherAktiv(w) && a.some((y) => /^-\w*f/.test(y)) && x.code < 4) { const t = finden(w, a.find((y) => y.startsWith('/dev/')) ?? ''); if (t?.p?.fs) t.p.fs.zusatz = { ...(t.p.fs.zusatz ?? {}), geprueft: true }; } return x; };
  b['fsck.ext4'] = b.e2fsck;
  b.xfs_growfs = mit('xfs_growfs', (w, a, _i, r) => {
    const z = K.pfad(w, a.filter((x) => !x.startsWith('-'))[0] ?? ''); const m = w.platten!.mounts.find((x) => x.ziel === z || x.quelle === z);
    if (!m || m.art !== 'xfs') return fehler(`xfs_growfs: ${z} is not a mounted XFS filesystem`);
    if (!nurRoot(r, w)) return fehler(`xfs_growfs: ${z}: Permission denied`);
    const t = finden(w, m.quelle)!; const alt_ = t.p!.fs!.bytes ?? fsBytes(t.p!); t.p!.fs!.bytes = undefined;
    return ok(`meta-data=${m.quelle.padEnd(15)} isize=512    agcount=4, agsize=${Math.floor(alt_ / 16384)} blks\ndata     =                       bsize=4096   blocks=${alt_ / 4096}, imaxpct=25\ndata blocks changed from ${alt_ / 4096} to ${fsBytes(t.p!) / 4096}`);
  });
  b.mount = (w, a, i, r) => { if (speicherAktiv(w)) sync(w); const x = alt.mount(w, a, i, r); if (speicherAktiv(w)) { const d = a.find((y) => y.startsWith('/dev/')); const t = d ? finden(w, d) : null; if (t?.p?.fs && !x.code) t.p.fs.zusatz = { ...(t.p.fs.zusatz ?? {}), geprueft: false }; sync(w); } return x; };
  b.umount = (w, a, i, r) => { const x = alt.umount(w, a, i, r); if (speicherAktiv(w)) sync(w); return x; };

  // ----- Geräte: lsblk mit RAID und LVM -----
  b.lsblk = mit('lsblk', (w, a, i, r) => {
    const s = sp(w); const pl = w.platten!; const fsSp = a.includes('-f') || a.includes('--fs'); const disc = a.includes('-D') || a.includes('--discard');
    if (a.some((x) => x === '-o' || x === '--output' || x === '-d' || x === '--nodeps') || a.filter((x) => x.startsWith('/dev/')).length) return alt.lsblk(w, a, i, r);
    const mp = (dev: string) => pl.swaps.includes(dev) ? '[SWAP]' : (pl.mounts.find((m) => m.quelle === dev || (finden(w, m.quelle)?.p && finden(w, m.quelle)?.p === finden(w, dev)?.p))?.ziel ?? '');
    type R = { name: string; dev: string; mm: string; rm: string; size: string; typ: string; fs?: Dateisystem; tief: number; rot: boolean };
    const zeilen: R[] = [];
    const kinder = (dev: string, tief: number, rot: boolean) => {
      for (const md of Object.values(s.md)) if (md.laeuft && md.devs.some((d) => d.dev === dev && d.rolle !== 'faulty')) { zeilen.push({ name: md.name, dev: '/dev/' + md.name, mm: `9:${md.name.slice(2)}`, rm: '0', size: menschGroesse(fsBytes(md.p)), typ: md.level === 10 ? 'raid10' : 'raid' + md.level, fs: md.p.fs, tief, rot }); kinder('/dev/' + md.name, tief + 1, rot); }
      for (const lv of Object.values(s.lvs)) if (lv.aktiv && lv.segs.some((x) => x.pv === dev)) zeilen.push({ name: mapperName(lv.vg, lv.name), dev: `/dev/mapper/${mapperName(lv.vg, lv.name)}`, mm: `254:${s.dm[`${lv.vg}/${lv.name}`] ?? 0}`, rm: '0', size: menschGroesse(lv.snap ? fsBytes(lv.p) : fsBytes(lv.p)), typ: 'lvm', fs: lv.p.fs, tief, rot });
    };
    for (const p of [...pl.platten].sort((x, y) => (x.maj === 259 ? 1 : 0) - (y.maj === 259 ? 1 : 0) || x.name.localeCompare(y.name))) {
      const rot = p.modell.startsWith('WDC');
      zeilen.push({ name: p.name, dev: '/dev/' + p.name, mm: `${p.maj}:${p.maj === 8 ? (p.name.charCodeAt(2) - 97) * 16 : 0}`, rm: p.rm ? '1' : '0', size: menschGroesse(p.sektoren * 512), typ: 'disk', tief: 0, rot });
      kinder('/dev/' + p.name, 1, rot);
      for (const q of p.partitionen) { const dev = '/dev/' + teilName(p, q.nr); zeilen.push({ name: teilName(p, q.nr), dev, mm: `${p.maj}:${p.maj === 8 ? (p.name.charCodeAt(2) - 97) * 16 + q.nr : q.nr}`, rm: p.rm ? '1' : '0', size: menschGroesse(fsBytes(q)), typ: 'part', fs: q.fs, tief: 1, rot }); kinder(dev, 2, rot); }
    }
    // Baumzeichen
    const namen = zeilen.map((z, k) => { if (!z.tief) return z.name; let pre = ''; for (let t = 1; t <= z.tief; t++) { const weitere = zeilen.slice(k + 1).findIndex((y) => y.tief < t); const ende = weitere < 0 ? zeilen.length : k + 1 + weitere; const nochEiner = zeilen.slice(k + 1, ende).some((y) => y.tief === t); pre += t === z.tief ? (nochEiner ? '├─' : '└─') : (nochEiner ? '│ ' : '  '); } return pre + z.name; });
    if (disc) return ok(['NAME        DISC-ALN DISC-GRAN DISC-MAX DISC-ZERO', ...zeilen.map((z, k) => `${namen[k].padEnd(11)}        0 ${z.rot || z.typ.startsWith('raid') ? '       0B' : '     512B'} ${z.rot || z.typ.startsWith('raid') ? '      0B' : '      2T'}         0`)].join('\n'));
    if (fsSp) { const br = Math.max(4, ...namen.map((x) => x.length)); return ok([`${'NAME'.padEnd(br)} FSTYPE            LABEL      UUID                                   MOUNTPOINTS`, ...zeilen.map((z, k) => `${namen[k].padEnd(br)} ${(z.fs?.art ?? '').padEnd(17)} ${(z.fs?.label ?? '').padEnd(10)} ${(z.fs?.uuid ?? '').padEnd(38)} ${mp(z.dev)}`.trimEnd())].join('\n')); }
    const br = Math.max(11, ...namen.map((x) => x.length));
    return ok([`${'NAME'.padEnd(br)} MAJ:MIN RM   SIZE RO TYPE  MOUNTPOINTS`, ...zeilen.map((z, k) => { const [ma, mi] = z.mm.split(':'); return `${namen[k].padEnd(br)} ${ma.padStart(3)}:${mi.padEnd(3)} ${z.rm.padStart(2)} ${z.size.padStart(6)}  0 ${z.typ.padEnd(5)} ${mp(z.dev)}`.trimEnd(); })].join('\n'));
  });

  // ----- hdparm, sdparm, nvme, fstrim -----
  b.hdparm = mit('hdparm', (w, a, _i, r) => {
    const dev = a.filter((x) => x.startsWith('/dev/')).pop() ?? ''; const t = finden(w, dev);
    if (!t || t.p) return fehler(`${dev}: No such file or directory`);
    if (!nurRoot(r, w)) return fehler(`${dev}: Permission denied`);
    const p = t.pl; const iscsi = p.modell === 'speicher';
    if (p.name.startsWith('nvme')) return fehler(`\n${dev}:\n SG_IO: bad/missing sense data, sb[]:  70 00 05 00 00 00 00 0a 00 00 00 00 20 00 01 cf 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00\n(Für NVMe nimmt man nvme-cli: nvme id-ctrl ${dev.replace(/n\d+$/, '')})`);
    if (iscsi) return fehler(`\n${dev}:\n SG_IO: bad/missing sense data\n HDIO_DRIVE_CMD(identify) failed: Invalid argument\n(Für SCSI- und iSCSI-Geräte nimmt man sdparm.)`);
    const ssd = !p.modell.startsWith('WDC');
    const out: string[] = [`\n${dev}:`];
    if (a.includes('-I')) return ok(`\n${dev}:\n\nATA device, with non-removable media\n\tModel Number:       ${p.modell}\n\tSerial Number:      ${ssd ? 'S5SVNG0N912345A' : 'WD-WCC4J2KL5X3R'}\n\tFirmware Revision:  ${ssd ? 'SVT02B6Q' : '82.00A82'}\n\tTransport:          Serial, ATA8-AST, SATA 1.0a, SATA II Extensions, SATA Rev 2.5, SATA Rev 2.6, SATA Rev 3.0\nStandards:\n\tUsed: unknown (minor revision code 0x0039)\n\tSupported: 11 8 7 6 5\nConfiguration:\n\tLogical\t\tmax\tcurrent\n\tLBA48  user addressable sectors: ${p.sektoren}\n\tLogical  Sector size:                   512 bytes\n\tPhysical Sector size:                  ${ssd ? '512' : '4096'} bytes\n\tdevice size with M = 1000*1000:      ${Math.round(p.sektoren * 512 / 1e6)} MBytes\n\tNominal Media Rotation Rate: ${ssd ? 'Solid State Device' : '5400'}\nCapabilities:\n\tLBA, IORDY(can be disabled)\n\tQueue depth: 32\n\tDMA: mdma0 mdma1 mdma2 udma0 udma1 udma2 udma3 udma4 udma5 *udma6\n\t     Cycle time: min=120ns recommended=120ns\nCommands/features:\n\tEnabled\tSupported:\n\t   *\tSMART feature set\n\t   *\tPower Management feature set\n\t   *\tWrite cache\n\t   *\tLook-ahead\n\t   *\t48-bit Address feature set\n\t   *\tNative Command Queueing (NCQ)\n${ssd ? '\t   *\tData Set Management TRIM supported (limit 8 blocks)\n\t   *\tDeterministic read ZEROs after TRIM\n' : ''}(gekürzt)`);
    if (a.includes('-i')) return ok(`\n${dev}:\n\n Model=${p.modell}, FwRev=${ssd ? 'SVT02B6Q' : '82.00A82'}, SerialNo=${ssd ? 'S5SVNG0N912345A' : 'WD-WCC4J2KL5X3R'}\n Config={ HardSect NotMFM HdSw>15uSec Fixed DTR>10Mbs RotSpdTol>.5% }\n RawCHS=16383/16/63, TrkSize=0, SectSize=0, ECCbytes=0\n BuffType=unknown, BuffSize=unknown, MaxMultSect=16, MultSect=16\n CurCHS=16383/16/63, CurSects=16514064, LBA=yes, LBAsects=${p.sektoren}\n IORDY=on/off, tPIO={min:120,w/IORDY:120}, tDMA={min:120,rec:120}\n PIO modes:  pio0 pio3 pio4\n DMA modes:  mdma0 mdma1 mdma2\n UDMA modes: udma0 udma1 udma2 udma3 udma4 udma5 *udma6\n AdvancedPM=yes: unknown setting WriteCache=enabled`);
    if (a.some((x) => /^-\w*[tT]/.test(x))) { if (a.some((x) => /^-\w*T/.test(x))) out.push(` Timing cached reads:   21458 MB in  1.99 seconds = 10781.22 MB/sec`); if (a.some((x) => /^-\w*t/.test(x))) out.push(` Timing buffered disk reads: ${ssd ? '1592 MB in  3.00 seconds = 530.47' : ' 548 MB in  3.01 seconds = 182.21'} MB/sec`); return ok(out.join('\n')); }
    if (a.some((x) => /^-d\d?$/.test(x))) return fehler(`\n${dev}:\n HDIO_GET_DMA failed: Inappropriate ioctl for device\n(Bei SATA-Platten mit dem Treiber libata ist DMA immer an. hdparm -d gilt für alte IDE-Geräte /dev/hd*.)`);
    const wi = a.findIndex((x) => /^-W[01]?$/.test(x));
    if (wi >= 0) { const v = a[wi].slice(2) || (a[wi + 1]?.match(/^[01]$/) ? a[wi + 1] : ''); if (v) { (p as Platte & { wcache?: boolean }).wcache = v === '1'; out.push(` setting drive write-caching to ${v} (${v === '1' ? 'on' : 'off'})`); } out.push(` write-caching =  ${(p as Platte & { wcache?: boolean }).wcache === false ? '0 (off)' : '1 (on)'}`); return ok(out.join('\n')); }
    if (a.includes('-C')) return ok(`\n${dev}:\n drive state is:  active/idle`);
    const si = a.findIndex((x) => /^-S\d*$/.test(x)); if (si >= 0) { const v = a[si].slice(2) || a[si + 1]; return ok(`\n${dev}:\n setting standby to ${v} (${Number(v) <= 240 ? Number(v) * 5 + ' seconds' : (Number(v) - 240) * 30 + ' minutes'})`); }
    if (a.includes('-y')) return ok(`\n${dev}:\n issuing standby command`);
    if (a.some((x) => /^-B\d*$/.test(x))) return ok(`\n${dev}:\n APM_level\t= 254`);
    return ok(`\n${dev}:\n multcount     = 16 (on)\n IO_support    =  1 (32-bit)\n readonly      =  0 (off)\n readahead     = 256 (on)\n geometry      = ${Math.floor(p.sektoren / 16065)}/255/63, sectors = ${p.sektoren}, start = 0`);
  });
  b.sdparm = mit('sdparm', (w, a, _i, r) => {
    if (!hat(w, 'sdparm')) return fehler('bash: sdparm: Befehl nicht gefunden\n(sdparm gehört zum Paket sdparm: sudo apt install sdparm)', 127);
    const dev = a.filter((x) => x.startsWith('/dev/')).pop() ?? ''; const t = finden(w, dev);
    if (!t || t.p) return fehler(`unable to access ${dev}, ERROR: No such file or directory`);
    if (!nurRoot(r, w)) return fehler(`unable to access ${dev}, ERROR: Permission denied`);
    const p = t.pl; const v = p.modell === 'speicher' ? 'LIO-ORG ' : p.modell.startsWith('WDC') ? 'ATA     ' : 'ATA     ';
    const kopf = `    ${dev}: ${v} ${p.modell.slice(0, 16).padEnd(16)}  ${p.modell === 'speicher' ? '4.0 ' : '0A82'}`;
    if (a.includes('--inquiry') || a.includes('-i')) return ok(`${kopf}\nDevice identification VPD page:\n  Addressed logical unit:\n    designator type: NAA,  code set: Binary\n      0x6001405a1b2c3d4e5f60718293a4b5c6\n    designator type: T10 vendor identification,  code set: ASCII\n      vendor id: LIO-ORG\n      vendor specific: speicher:a1b2c3d4-e5f6-4071-8293-a4b5c6d7e8f9`);
    const gi = a.find((x) => x.startsWith('--get=')); if (gi) return ok(`${kopf}\n${gi.slice(6).toUpperCase()}         1  [cha: y, def:  1, sav:  1]`);
    return ok(`${kopf}\nDirect access device specific parameters: WP=0  DPOFUA=1\nCaching (SBC) mode page:\n  WCE           1  [cha: y, def:  1, sav:  1]\n  RCD           0  [cha: n, def:  0, sav:  0]\nControl mode page:\n  TST           0  [cha: n, def:  0, sav:  0]\n(gekürzt)`);
  });
  b.nvme = mit('nvme', (w, a, _i, r) => {
    if (!hat(w, 'nvme')) return fehler('bash: nvme: Befehl nicht gefunden\n(nvme gehört zum Paket nvme-cli: sudo apt install nvme-cli)', 127);
    if (!nurRoot(r, w)) return fehler('Permission denied\n(nvme braucht root: sudo nvme …)');
    const [c] = a;
    if (c === 'list') return ok(`Node                  Generic               SN                   Model                                    Namespace Usage                      Format           FW Rev  \n--------------------- --------------------- -------------------- ---------------------------------------- --------- -------------------------- ---------------- --------\n/dev/nvme0n1          /dev/ng0n1            S4EWNX0R812345K      Samsung SSD 970 EVO Plus 500GB           1         199,04  GB / 500,11  GB    512   B +  0 B   2B2QEXM7`);
    if (c === 'id-ctrl') return ok(`NVME Identify Controller:\nvid       : 0x144d\nssvid     : 0x144d\nsn        : S4EWNX0R812345K\nmn        : Samsung SSD 970 EVO Plus 500GB\nfr        : 2B2QEXM7\nrab       : 2\nieee      : 002538\nmdts      : 9\nver       : 0x10300\noacs      : 0x17\nnn        : 1\noncs      : 0x5f\ntnvmcap   : 500.107.862.016\n(gekürzt)`);
    if (c === 'smart-log') return ok(`Smart Log for NVME device:nvme0 namespace-id:ffffffff\ncritical_warning\t\t\t: 0\ntemperature\t\t\t\t: 38 °C (311 K)\navailable_spare\t\t\t\t: 100%\navailable_spare_threshold\t\t: 10%\npercentage_used\t\t\t\t: 2%\ndata_units_read\t\t\t\t: 18.432.211\ndata_units_written\t\t\t: 21.004.977\npower_cycles\t\t\t\t: 412\npower_on_hours\t\t\t\t: 4.211\nunsafe_shutdowns\t\t\t: 37\nmedia_errors\t\t\t\t: 0\nnum_err_log_entries\t\t\t: 0`);
    if (c === 'id-ns') return ok(`NVME Identify Namespace 1:\nnsze    : 0x3a386030\nncap    : 0x3a386030\nnuse    : 0x172bd338\nnlbaf   : 0\nflbas   : 0\nlbaf  0 : ms:0   lbads:9  rp:0 (in use)`);
    if (c === 'error-log') return ok('Error Log Entries for device:nvme0 entries:64\n.................\n Entry[ 0]\n.................\nerror_count\t: 0');
    return fehler('(Im Simulator kennt nvme: list, id-ctrl, id-ns, smart-log, error-log.)');
  });
  b.fstrim = mit('fstrim', (w, a, _i, r) => {
    if (!nurRoot(r, w)) return fehler('fstrim: /: das Ermitteln der Dateisystem-Informationen ist fehlgeschlagen: Keine Berechtigung');
    const alleFs = a.some((x) => /^-[a-zA-Z]*[aA]/.test(x) || x === '--all');
    const ziele = alleFs ? w.platten!.mounts.map((m) => m.ziel) : a.filter((x) => !x.startsWith('-')).map((x) => K.pfad(w, x));
    if (!ziele.length) return fehler('fstrim: kein Einhängepunkt angegeben');
    const out: string[] = []; const err: string[] = [];
    for (const z of ziele) {
      const m = w.platten!.mounts.find((x) => x.ziel === z); if (!m) { err.push(`fstrim: ${z}: kein Einhängepunkt`); continue; }
      const t = finden(w, m.quelle); const disk = t ? (t.pl.name.startsWith('nvme') || t.pl.name === 'sdb' || t.pl.name === 'sda' ? t.pl : null) : null;
      const rot = !disk || t!.pl.modell.startsWith('WDC') || m.quelle.startsWith('/dev/md') || t!.pl.rm;
      if (rot) { if (!alleFs) err.push(`fstrim: ${z}: Verwerfen-Operation wird nicht unterstützt`); continue; }
      const frei = Math.round(fsBytes(t!.p!) * 0.37);
      out.push(`${z}: ${(frei / GIB).toFixed(1).replace('.', ',')} GiB (${frei} Bytes) getrimmt${alleFs ? ` auf ${m.quelle}` : ''}`);
    }
    if (!a.some((x) => /^-\w*v|--verbose/.test(x))) return { out: '', err: err.join('\n') || undefined, code: err.length && !out.length ? 1 : 0 };
    return { out: out.join('\n'), err: err.join('\n') || undefined, code: err.length && !out.length ? 1 : 0 };
  });

  // ----- iSCSI -----
  const IQN = 'iqn.2026-11.lan.labor:speicher'; const PORTAL = '192.168.50.10:3260,1';
  const conf = (w: Welt, k: string) => (w.fs['/etc/iscsi/iscsid.conf'] ?? '').match(new RegExp(`^\\s*${k.replace(/\./g, '\\.')}\\s*=\\s*(\\S+)`, 'm'))?.[1];
  b.iscsiadm = mit('iscsiadm', (w, a, _i, r) => {
    if (!hat(w, 'iscsiadm')) return fehler('bash: iscsiadm: Befehl nicht gefunden\n(iscsiadm gehört zum Paket open-iscsi: sudo apt install open-iscsi)', 127);
    if (!nurRoot(r, w)) return fehler('iscsiadm: Could not open /run/lock/iscsi: Permission denied\niscsiadm: Could not add new discovery record.');
    const s = sp(w).iscsi; const wert = (k: string[]) => { for (let i = 0; i < a.length; i++) for (const o of k) { if (a[i] === o) return a[i + 1]; if (o.startsWith('--') && a[i].startsWith(o + '=')) return a[i].slice(o.length + 1); } return undefined; };
    const modus = wert(['-m', '--mode']); const T = wert(['-T', '--targetname']); const P = wert(['-p', '--portal']);
    if (modus === 'discovery' || modus === 'discoverydb') {
      const typ = wert(['-t', '--type']);
      if (!P) return fehler('iscsiadm: Please specify portal (-p) for discovery.');
      if (typ !== 'sendtargets' && typ !== 'st') return fehler('iscsiadm: Invalid discovery type.\n(Im Simulator: -t sendtargets)');
      if (!/^(192\.168\.50\.10|srv1)(:3260)?$/.test(P)) return fehler(`iscsiadm: cannot make connection to ${P}: Connection refused\niscsiadm: connection login retries (reopen_max) 5 exceeded\niscsiadm: Could not perform SendTargets discovery: iSCSI PDU timed out`, 4);
      s.nodes[IQN] = { iqn: IQN, portal: PORTAL, startup: conf(w, 'node.startup') === 'automatic' ? 'automatic' : 'manual', methode: conf(w, 'node.session.auth.authmethod'), user: conf(w, 'node.session.auth.username'), pass: conf(w, 'node.session.auth.password') };
      knotenDatei(w, s.nodes[IQN]);
      return ok(`${PORTAL} ${IQN}`);
    }
    if (modus === 'node') {
      const n = T ? s.nodes[T] : Object.values(s.nodes)[0];
      if (a.includes('-o') || a.includes('--op')) {
        const op = wert(['-o', '--op']); const nm = wert(['-n', '--name']); const v = wert(['-v', '--value']);
        if (!n) return fehler('iscsiadm: No records found');
        if (op === 'show') return ok(`# BEGIN RECORD 2.1.8\nnode.name = ${n.iqn}\nnode.tpgt = 1\nnode.startup = ${n.startup}\nnode.session.auth.authmethod = ${n.methode ?? 'None'}\nnode.session.auth.username = ${n.user ?? '<empty>'}\nnode.session.auth.password = ${n.pass ? '********' : '<empty>'}\nnode.conn[0].address = 192.168.50.10\nnode.conn[0].port = 3260\n# END RECORD`);
        if (op === 'update') {
          if (nm === 'node.startup') n.startup = v === 'automatic' ? 'automatic' : 'manual';
          else if (nm === 'node.session.auth.authmethod') n.methode = v; else if (nm === 'node.session.auth.username') n.user = v; else if (nm === 'node.session.auth.password') n.pass = v;
          else return fehler(`iscsiadm: Cannot modify ${nm ?? '(kein -n)'}.\n(Im Simulator: node.startup und node.session.auth.*)`);
          knotenDatei(w, n); return ok();
        }
        if (op === 'delete') { delete s.nodes[n.iqn]; for (const k of Object.keys(w.fs).filter((x) => x.startsWith('/etc/iscsi/nodes/' + n.iqn))) delete w.fs[k]; return ok(); }
      }
      if (a.includes('--login') || a.includes('-l')) {
        if (!n) return fehler('iscsiadm: No records found\n(Erst die Ziele mit iscsiadm -m discovery -t sendtargets -p 192.168.50.10 finden.)', 21);
        if (s.session) return fehler(`iscsiadm: default: 1 session requested, but 1 already present.\niscsiadm: Could not log into all portals`, 15);
        const kopf = `Logging in to [iface: default, target: ${n.iqn}, portal: 192.168.50.10,3260]`;
        if ((n.methode ?? '').toUpperCase() !== 'CHAP' || n.user !== 'werkstatt' || n.pass !== 'Speicher-2026') return { out: kopf, err: `iscsiadm: Could not login to [iface: default, target: ${n.iqn}, portal: 192.168.50.10,3260].\niscsiadm: initiator reported error (24 - iSCSI login failed due to authorization failure)\niscsiadm: Could not log into all portals`, code: 24 };
        const name = 'sd' + 'cdefghijk'.split('').find((c) => !w.platten!.platten.some((p) => p.name === 'sd' + c));
        w.platten!.platten.push({ name, sektoren: 104857600, modell: 'speicher', rm: false, maj: 8, label: null, id: '', partitionen: [] });
        w.platten!.platten.sort((x, y) => x.name.localeCompare(y.name));
        w.fs['/dev/' + name] = '';
        s.session = { iqn: n.iqn, dev: name, sid: 1 };
        const wwn = '6001405a1b2c3d4e5f60718293a4b5c6';
        datei(w, `/dev/disk/by-path/ip-192.168.50.10:3260-iscsi-${n.iqn}-lun-0`, `-> ../../${name}`, 0o777);
        datei(w, `/dev/disk/by-id/wwn-0x${wwn}`, `-> ../../${name}`, 0o777);
        datei(w, `/dev/disk/by-id/scsi-3${wwn}`, `-> ../../${name}`, 0o777);
        datei(w, `/sys/block/${name}/queue/scheduler`, '[mq-deadline] kyber bfq none\n'); datei(w, `/sys/block/${name}/queue/rotational`, '1\n');
        sp(w).dmesg.push(`[ 5122.004113] scsi host3: iSCSI Initiator over TCP/IP`, `[ 5122.031877] scsi 3:0:0:0: Direct-Access     LIO-ORG  speicher         4.0  PQ: 0 ANSI: 6`, `[ 5122.032544] sd 3:0:0:0: Attached scsi generic sg3 type 0`, `[ 5122.033012] sd 3:0:0:0: [${name}] 104857600 512-byte logical blocks: (53.7 GB/50.0 GiB)`, `[ 5122.035991] sd 3:0:0:0: [${name}] Attached SCSI disk`);
        return ok(`${kopf}\nLogin to [iface: default, target: ${n.iqn}, portal: 192.168.50.10,3260] successful.`);
      }
      if (a.includes('--logout') || a.includes('-u')) {
        if (!s.session) return fehler('iscsiadm: No matching sessions found', 21);
        const d = '/dev/' + s.session.dev;
        if (w.platten!.mounts.some((m) => m.quelle.startsWith(d) || Object.values(sp(w).lvs).some((l) => l.segs.some((x) => x.pv.startsWith(d)) && (m.quelle.endsWith(mapperName(l.vg, l.name)) || m.quelle === `/dev/${l.vg}/${l.name}`)))) return fehler(`(Im Simulator: Auf ${d} ist noch etwas eingehängt. Häng es vorher aus, sonst gehen Daten verloren.)`);
        w.platten!.platten = w.platten!.platten.filter((p) => p.name !== s.session!.dev); delete w.fs[d];
        for (const k of Object.keys(w.fs).filter((x) => x.startsWith('/dev/disk/') && w.fs[x] === `-> ../../${s.session!.dev}`)) delete w.fs[k];
        const iqn = s.session.iqn; s.session = null;
        return ok(`Logging out of session [sid: 1, target: ${iqn}, portal: 192.168.50.10,3260]\nLogout of [sid: 1, target: ${iqn}, portal: 192.168.50.10,3260] successful.`);
      }
      if (!Object.keys(s.nodes).length) return fehler('iscsiadm: No records found', 21);
      return ok(Object.values(s.nodes).map((x) => `192.168.50.10:3260,1 ${x.iqn}`).join('\n'));
    }
    if (modus === 'session') {
      if (!s.session) return fehler('iscsiadm: No active sessions.', 21);
      if (a.includes('-P')) return ok(`iSCSI Transport Class version 2.0-870\nversion 2.1.8\nTarget: ${s.session.iqn} (non-flash)\n\tCurrent Portal: 192.168.50.10:3260,1\n\tPersistent Portal: 192.168.50.10:3260,1\n\t\t**********\n\t\tInterface:\n\t\t**********\n\t\tIface Name: default\n\t\tIface Transport: tcp\n\t\tIface Initiatorname: ${(w.fs['/etc/iscsi/initiatorname.iscsi'] ?? '').match(/InitiatorName=(\S+)/)?.[1] ?? ''}\n\t\tIface IPaddress: 192.168.50.20\n\t\tiSCSI Connection State: LOGGED IN\n\t\tiSCSI Session State: LOGGED_IN\n\t\t************************\n\t\tAttached SCSI devices:\n\t\t************************\n\t\tHost Number: 3\tState: running\n\t\tscsi3 Channel 00 Id 0 Lun: 0\n\t\t\tAttached scsi disk ${s.session.dev}\t\tState: running`);
      return ok(`tcp: [1] 192.168.50.10:3260,1 ${s.session.iqn} (non-flash)`);
    }
    return fehler('(Im Simulator kennt iscsiadm: -m discovery -t sendtargets -p IP, -m node [--login|--logout|-o show|update|delete], -m session [-P 3].)');
  });
  b.lsscsi = mit('lsscsi', (w) => {
    if (!hat(w, 'lsscsi')) return fehler('bash: lsscsi: Befehl nicht gefunden\n(lsscsi gehört zum Paket lsscsi: sudo apt install lsscsi)', 127);
    const z = [`[0:0:0:0]    disk    ATA      ${'Ultra Fit'.padEnd(16)} 1.00  /dev/sda`, ...w.platten!.platten.filter((p) => p.name.startsWith('sd') && p.name !== 'sda').map((p, i) => p.modell === 'speicher' ? `[${i + 3}:0:0:0]    disk    LIO-ORG  speicher         4.0   /dev/${p.name}` : `[${i + 1}:0:0:0]    disk    ATA      ${p.modell.slice(0, 16).padEnd(16)} ${p.modell.startsWith('WDC') ? '0A82' : '2B6Q'}  /dev/${p.name}`), `[N:0:4:1]    disk    Samsung SSD 970 EVO Plus 500GB__1          /dev/nvme0n1`];
    return ok(z.join('\n'));
  });
  b.scsi_id = mit('scsi_id', (w, a, _i, r) => {
    const d = a.find((x) => x.startsWith('--device='))?.slice(9) ?? a.find((x) => x.startsWith('/dev/')) ?? '';
    const t = finden(w, d); if (!t) return fehler('', 1);
    if (!nurRoot(r, w)) return fehler('', 1);
    if (t.pl.modell === 'speicher') return ok('36001405a1b2c3d4e5f60718293a4b5c6');
    return ok(`1ATA_${t.pl.modell.replace(/\s+/g, '_')}_${t.pl.modell.startsWith('WDC') ? 'WD-WCC4J2KL5X3R' : 'S5SVNG0N912345A'}`);
  });
  b.dmesg = (w, a, i, r) => { const x = alt.dmesg(w, a, i, r); if (!speicherAktiv(w) || x.code) return x; const z = sp(w).dmesg; return z.length ? { ...x, out: [x.out, ...z].filter(Boolean).join('\n') } : x; };
  b.systemctl = (w, a, i, r) => {
    if (!speicherAktiv(w)) return alt.systemctl(w, a, i, r);
    const [cmd, unit] = a.filter((x) => !x.startsWith('-'));
    if (unit === 'fstrim.timer' && cmd === 'status') return ok(`● fstrim.timer - Discard unused blocks once a week\n     Loaded: loaded (/lib/systemd/system/fstrim.timer; enabled; preset: enabled)\n     Active: active (waiting) since Mon 2026-11-23 08:12:41 CET\n    Trigger: Mon 2026-11-30 00:41:12 CET; 4 days left\n   Triggers: ● fstrim.service\n       Docs: man:fstrim`);
    if ((unit === 'iscsid' || unit === 'iscsid.service' || unit === 'open-iscsi' || unit === 'open-iscsi.service') && hat(w, 'iscsiadm')) { if (cmd === 'status') return ok(`● ${unit.replace(/\.service$/, '')}.service - ${unit.startsWith('iscsid') ? 'iSCSI initiator daemon (iscsid)' : 'Login to default iSCSI targets'}\n     Loaded: loaded (/lib/systemd/system/${unit.replace(/\.service$/, '')}.service; enabled; preset: enabled)\n     Active: active (running) since Mon 2026-11-23 08:41:00 CET`); return ok(); }
    if (unit?.startsWith('mdmonitor') || unit?.startsWith('mdadm')) { if (cmd === 'status') return ok(`● mdmonitor.service - MD array monitor\n     Loaded: loaded (/lib/systemd/system/mdmonitor.service; static)\n     Active: active (running) since Mon 2026-11-23 08:12:41 CET`); return ok(); }
    return alt.systemctl(w, a, i, r);
  };
  return b;
}
function knotenDatei(w: Welt, n: IscsiNode) {
  datei(w, `/etc/iscsi/nodes/${n.iqn}/192.168.50.10,3260,1/default`, `# BEGIN RECORD 2.1.8\nnode.name = ${n.iqn}\nnode.tpgt = 1\nnode.startup = ${n.startup}\nnode.session.auth.authmethod = ${n.methode ?? 'None'}\n${n.user ? `node.session.auth.username = ${n.user}\n` : ''}${n.pass ? `node.session.auth.password = ${n.pass}\n` : ''}node.conn[0].address = 192.168.50.10\nnode.conn[0].port = 3260\n# END RECORD\n`, 0o600);
}
const ISCSID_CONF = `#
# Open-iSCSI default configuration.
# Could be located at /etc/iscsi/iscsid.conf or ~/.iscsid.conf
#
# Note: To set any of these values for a specific node/session run
# the iscsiadm --mode node --op command for the value. See the README
# and man page for iscsiadm for details on the --op command.
#

#*************
# Startup settings
#*************

# To request that the iscsi service scripts startup a session, use "automatic":
# node.startup = automatic
#
# To manually startup the session, use "manual". The default is manual.
node.startup = manual

# *************
# CHAP Settings
# *************

# To enable CHAP authentication set node.session.auth.authmethod
# to CHAP. The default is None.
#node.session.auth.authmethod = CHAP

# To set a CHAP username and password for initiator
# authentication by the target(s), uncomment the following lines:
#node.session.auth.username = username
#node.session.auth.password = password
`;
export function speicherNachApt(w: Welt) {
  if (!speicherAktiv(w) || !w.pakete) return;
  const platz = (c: string | null | undefined) => !c || /^# \S+ aus \S+\n$/.test(c);
  if (w.pakete.installiert['open-iscsi'] === 'ii') {
    if (platz(w.fs['/etc/iscsi/iscsid.conf'])) datei(w, '/etc/iscsi/iscsid.conf', ISCSID_CONF, 0o600);
    if (platz(w.fs['/etc/iscsi/initiatorname.iscsi'])) datei(w, '/etc/iscsi/initiatorname.iscsi', '## DO NOT EDIT OR REMOVE THIS FILE!\n## If you remove this file, the iSCSI daemon will not start.\n## If you change the InitiatorName, existing access control lists\n## may reject this initiator.  The InitiatorName must be unique\n## for each iSCSI initiator.  Do NOT duplicate iSCSI InitiatorNames.\nInitiatorName=iqn.1993-08.org.debian:01:3c7c3f1a2b4d\n', 0o600);
    ordner(w, '/etc/iscsi/nodes');
  }
  for (const [pk, progs] of Object.entries({ 'open-iscsi': ['iscsiadm', 'iscsid'], 'nvme-cli': ['nvme'], sdparm: ['sdparm'], lsscsi: ['lsscsi'] })) if (w.pakete.installiert[pk] === 'ii') for (const x of progs) if (!(`/usr/sbin/${x}` in w.fs) && !(`/usr/bin/${x}` in w.fs)) datei(w, `/usr/sbin/${x}`, '\u0007BIN:211044', 0o755);
}

// ---------- Zustand ----------
export function zustandSpeicher(w: Welt, s: string): boolean | undefined {
  let m;
  if (!/^(md|raid|pv|vg|lv|lvsnap|lvfs|iscsi|sched|einh)[:=~]/.test(s)) return undefined;
  if (!speicherAktiv(w)) return false;
  const st = sp(w); sync(w);
  if ((m = s.match(/^md:(md\d+)=(raid\d+|laeuft|gestoppt|sauber|degradiert|sync)$/))) {
    const md = st.md[m[1]]; if (!md) return false; syncFortschritt(w, md);
    if (m[2] === 'laeuft') return md.laeuft; if (m[2] === 'gestoppt') return !md.laeuft; if (m[2] === 'sync') return !!md.sync;
    const voll = md.devs.filter((d) => d.rolle === 'aktiv').length >= md.n;
    if (m[2] === 'sauber') return md.laeuft && voll && !md.sync; if (m[2] === 'degradiert') return md.laeuft && !voll;
    return md.laeuft && `raid${md.level}` === m[2];
  }
  if ((m = s.match(/^md:(md\d+):(\/dev\/[\w[\]|()]+)=(aktiv|faulty|spare|neu|weg)$/))) { const md = st.md[m[1]]; if (!md) return false; syncFortschritt(w, md); const re = new RegExp(`^(${m[2]})$`); const d = md.devs.find((x) => re.test(x.dev)); return m[3] === 'weg' ? !d : d?.rolle === m[3]; }
  if ((m = s.match(/^md:(md\d+)=(\d+)geraete$/))) return st.md[m[1]]?.n === Number(m[2]);
  if ((m = s.match(/^raid:conf~(.+)$/))) return new RegExp(m[1], 'm').test(w.fs['/etc/mdadm/mdadm.conf'] ?? '');
  if ((m = s.match(/^pv:(\/dev\/\w+)(=(\w+))?$/))) { const pv = st.pvs[m[1]]; return !!pv && (!m[3] || (m[3] === 'frei' ? !pv.vg : pv.vg === m[3])); }
  if ((m = s.match(/^pv:(\/dev\/\w+)=leer$/))) return !!st.pvs[m[1]] && !peBelegt(w, m[1]);
  if ((m = s.match(/^vg:(\w+)$/))) return !!st.vgs[m[1]];
  if ((m = s.match(/^vg:(\w+)=(aktiv|inaktiv)$/))) return !!st.vgs[m[1]] && Object.values(st.lvs).filter((l) => l.vg === m![1]).every((l) => l.aktiv === (m![2] === 'aktiv'));
  if ((m = s.match(/^vg:(\w+)=(\d+)pvs$/))) return st.vgs[m[1]]?.pvs.length === Number(m[2]);
  if ((m = s.match(/^lv:(\w+)\/([\w-]+)$/))) return !!st.lvs[`${m[1]}/${m[2]}`];
  if ((m = s.match(/^lv:(\w+)\/([\w-]+)=(weg|aktiv|inaktiv)$/))) { const lv = st.lvs[`${m[1]}/${m[2]}`]; return m[3] === 'weg' ? !lv : !!lv && lv.aktiv === (m[3] === 'aktiv'); }
  if ((m = s.match(/^lv:(\w+)\/([\w-]+)>=(\d+)g$/))) { const lv = st.lvs[`${m[1]}/${m[2]}`]; return !!lv && fsBytes(lv.p) >= Number(m[3]) * GIB; }
  if ((m = s.match(/^lv:(\w+)\/([\w-]+)<=(\d+)g$/))) { const lv = st.lvs[`${m[1]}/${m[2]}`]; return !!lv && fsBytes(lv.p) <= Number(m[3]) * GIB; }
  if ((m = s.match(/^lvfs:(\w+)\/([\w-]+)=(voll|heil|kaputt)$/))) { const lv = st.lvs[`${m[1]}/${m[2]}`]; const fs = lv?.p.fs; if (!fs) return false; return m[3] === 'voll' ? fs.bytes === undefined && !fs.kaputt : m[3] === 'heil' ? !fs.kaputt : !!fs.kaputt; }
  if ((m = s.match(/^lvfs:(\w+)\/([\w-]+)>=(\d+)g$/))) { const lv = st.lvs[`${m[1]}/${m[2]}`]; const fs = lv?.p.fs; return !!fs && (fs.bytes ?? fsBytes(lv.p)) >= Number(m[3]) * GIB; }
  if ((m = s.match(/^lvfs:(\w+)\/([\w-]+)~(.+)$/))) { const lv = st.lvs[`${m[1]}/${m[2]}`]; if (!lv) return false; const re = new RegExp(m[3]); return Object.keys(inhalt(w, lv)).some((k) => re.test(k)); }
  if ((m = s.match(/^lvsnap:(\w+)\/([\w-]+)=(von:[\w-]+|gueltig|ungueltig)$/))) { const lv = st.lvs[`${m[1]}/${m[2]}`]; if (!lv?.snap) return false; if (m[3] === 'ungueltig') return !!lv.ungueltig; if (m[3] === 'gueltig') return !lv.ungueltig; return lv.snap.von === m[3].slice(4); }
  if ((m = s.match(/^einh:(\/\S*)$/))) return w.platten!.mounts.some((x) => x.ziel === m![1]);
  if ((m = s.match(/^lvfs:(\w+)\/([\w-]+)=(ext4|xfs|ext3|ext2|btrfs)$/))) return st.lvs[`${m[1]}/${m[2]}`]?.p.fs?.art === m[3];
  if (s === 'iscsi:sitzung') return !!st.iscsi.session;
  if ((m = s.match(/^iscsi:(node|auto|chap)$/))) { const n = Object.values(st.iscsi.nodes)[0]; if (!n) return false; return m[1] === 'node' ? true : m[1] === 'auto' ? n.startup === 'automatic' : (n.methode ?? '').toUpperCase() === 'CHAP' && !!n.user && !!n.pass; }
  if ((m = s.match(/^sched:(\w+)=(\S+)$/))) return new RegExp(`\\[${m[2]}\\]`).test(w.fs[`/sys/block/${m[1]}/queue/scheduler`] ?? '');
  return undefined;
}
