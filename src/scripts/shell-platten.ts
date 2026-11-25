// Platten, Partitionen, Dateisysteme und Einhängepunkte für den Simulator (Topic 102 und 104).
// Meldungen folgen util-linux 2.38 und e2fsprogs 1.47 von Debian 12 mit LANG=de_DE.UTF-8.
import type { Welt } from './shell';
import type { Meta } from './shell-dateien';
import { groesse, meta } from './shell-dateien';

export interface Ergebnis { out: string; code: number; err?: string; }
type Befehl = (w: Welt, args: string[], stdin: string, root: boolean) => Ergebnis;
export interface PlattenHelfer {
  ok: (out?: string) => Ergebnis;
  fehler: (msg: string, code?: number) => Ergebnis;
  pfad: (w: Welt, p: string) => string;
  kinder: (w: Welt, dir: string) => string[];
}

export type FsArt = 'ext2' | 'ext3' | 'ext4' | 'xfs' | 'vfat' | 'exfat' | 'btrfs' | 'swap';
export interface Dateisystem {
  art: FsArt; uuid: string; label?: string; erstellt: number;
  einhaengungen: number; maxEinhaengungen: number; intervall: number; reserviert: number;
  dateien: Record<string, string | null>; metas: Record<string, Meta>; wurzel: Meta;
  basis: number;               // belegte Bytes, die nicht aus simulierten Dateien stammen
  kaputt?: boolean; gesehen?: number;
}
export interface Partition { nr: number; start: number; ende: number; typ: string; partuuid: string; boot?: boolean; fs?: Dateisystem; }
export interface Platte { name: string; sektoren: number; modell: string; rm: boolean; maj: number; label: 'gpt' | 'dos' | null; id: string; partitionen: Partition[]; tabelle?: Partition[]; }
export interface Einhaengung { quelle: string; ziel: string; art: string; optionen: string; virtuell?: boolean; verdeckt?: { fs: Record<string, string | null>; meta: Record<string, Meta> }; }
export interface PlattenStand { platten: Platte[]; mounts: Einhaengung[]; swaps: string[]; }

const GIB = 1073741824;
/** fstab beim Start der Welt, damit mount Änderungen erkennt */
export const START_FSTAB = new WeakMap<Welt, string | undefined>();
const hex = (n: number, len: number) => Array.from({ length: len }, (_, i) => '0123456789abcdef'[(n * (i + 7) * 2654435761 >>> (i % 24)) % 16]).join('');
let zaehler = 1;
function neueUuid(art: FsArt) {
  const n = zaehler++ * 977 + Date.now() % 1000;
  if (art === 'vfat' || art === 'exfat') return (hex(n, 4) + '-' + hex(n + 1, 4)).toUpperCase();
  return `${hex(n, 8)}-${hex(n + 2, 4)}-4${hex(n + 3, 3)}-a${hex(n + 4, 3)}-${hex(n + 5, 12)}`;
}
const WURZEL: Meta = { mode: 0o755, owner: 'root', group: 'root', mtime: 0 };
function neuesFs(art: FsArt, uhr: number, label?: string, uuid?: string): Dateisystem {
  const ext = art.startsWith('ext');
  return {
    art, uuid: uuid ?? neueUuid(art), label, erstellt: uhr, einhaengungen: 0, maxEinhaengungen: -1, intervall: 0, reserviert: ext ? 5 : 0,
    dateien: ext ? { '/lost+found': null } : {}, metas: ext ? { '/lost+found': { mode: 0o700, owner: 'root', group: 'root', mtime: uhr } } : {},
    wurzel: { ...WURZEL, mode: art === 'vfat' || art === 'exfat' ? 0o755 : 0o755, mtime: uhr }, basis: ext ? 0.016 : art === 'xfs' ? 0.007 : 0.0001,
  };
}

export function startPlatten(o: { neuePlatte?: boolean | 'leer' | 'partitioniert' | 'formatiert' } = {}, uhr: number): PlattenStand {
  const sys = (art: FsArt, uuid: string, label?: string, belegt = 0) => ({ ...neuesFs(art, uhr - 400 * 86400000, label, uuid), basis: belegt });
  const platten: Platte[] = [
    { name: 'sda', sektoren: 60063744, modell: 'Ultra Fit', rm: true, maj: 8, label: 'dos', id: '0x4b1d2a3e', partitionen: [
      { nr: 1, start: 2048, ende: 60063743, typ: 'c', partuuid: '4b1d2a3e-01', fs: sys('vfat', '4E21-9A07', 'STICK', 4298112 * 1024) },
    ] },
    { name: 'nvme0n1', sektoren: 1000215216, modell: 'Samsung SSD 970 EVO Plus 500GB', rm: false, maj: 259, label: 'gpt', id: '5C3B9E21-7A44-4F0B-9D1E-2E6A0C8F7B13', partitionen: [
      { nr: 1, start: 2048, ende: 1050623, typ: 'EFI-System', partuuid: '1d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e51', fs: sys('vfat', '6A1F-2B3C', undefined, 6012 * 1024) },
      { nr: 2, start: 1050624, ende: 996214783, typ: 'Linux-Dateisystem', partuuid: '7e8f9a0b-1c2d-4e3f-8a5b-6c7d8e9f0a12', fs: sys('ext4', '3f1c0d6e-8a2b-4c51-9a0e-2d7b1e5c9f40', undefined, 39012876 * 1024) },
      { nr: 3, start: 996214784, ende: 1000215182, typ: 'Linux Swap', partuuid: '2b3c4d5e-6f70-4a81-9b2c-3d4e5f6a7b83', fs: sys('swap', '9d8e7f60-1a2b-4c3d-8e9f-0a1b2c3d4e5f') },
    ] },
  ];
  if (o.neuePlatte) {
    const sdb: Platte = { name: 'sdb', sektoren: 488397168, modell: 'Samsung SSD 870 EVO 250GB', rm: false, maj: 8, label: null, id: '', partitionen: [] };
    if (o.neuePlatte === 'partitioniert' || o.neuePlatte === 'formatiert') {
      sdb.label = 'gpt'; sdb.id = 'A1F3C2D4-5B6E-4F70-8192-A3B4C5D6E7F8';
      sdb.partitionen = [
        { nr: 1, start: 2048, ende: 104859647, typ: 'Linux-Dateisystem', partuuid: 'c0ffee01-1111-4222-8333-444455556661' },
        { nr: 2, start: 104859648, ende: 113248255, typ: 'Linux Swap', partuuid: 'c0ffee02-1111-4222-8333-444455556662' },
        { nr: 3, start: 113248256, ende: 323993599, typ: 'Linux-Dateisystem', partuuid: 'c0ffee03-1111-4222-8333-444455556663' },
      ];
      if (o.neuePlatte === 'formatiert') {
        sdb.partitionen[0].fs = { ...neuesFs('ext4', uhr - 3600000, 'daten', 'b7e1c2d3-4f5a-4b6c-9d7e-8f9a0b1c2d3e'), dateien: { '/lost+found': null, '/messung-2025.csv': '\u0007BIN:3145728', '/messung-2026.csv': '\u0007BIN:524288' }, metas: { '/lost+found': { mode: 0o700, owner: 'root', group: 'root', mtime: uhr - 3600000 }, '/messung-2025.csv': { mode: 0o644, owner: 'lena', group: 'lena', mtime: uhr - 3000000 }, '/messung-2026.csv': { mode: 0o644, owner: 'lena', group: 'lena', mtime: uhr - 2000000 } } };
        sdb.partitionen[1].fs = neuesFs('swap', uhr - 3600000, undefined, 'e4d3c2b1-a090-4f8e-9d7c-6b5a4f3e2d1c');
        sdb.partitionen[2].fs = neuesFs('xfs', uhr - 3600000, 'archiv', '5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d');
      }
    }
    platten.splice(1, 0, sdb);
  }
  return {
    platten,
    mounts: [
      { quelle: '/dev/nvme0n1p2', ziel: '/', art: 'ext4', optionen: 'rw,relatime,errors=remount-ro', virtuell: true },
      { quelle: '/dev/nvme0n1p1', ziel: '/boot/efi', art: 'vfat', optionen: 'rw,relatime,fmask=0077,dmask=0077,codepage=437,iocharset=ascii,shortname=mixed,utf8,errors=remount-ro', virtuell: true },
      { quelle: '/dev/sda1', ziel: '/media/lena/STICK', art: 'vfat', optionen: 'rw,nosuid,nodev,relatime,uid=1000,gid=1000,fmask=0022,dmask=0022,codepage=437,iocharset=ascii,shortname=mixed,showexec,utf8,flush,errors=remount-ro,uhelper=udisks2', virtuell: true },
    ],
    swaps: ['/dev/nvme0n1p3'],
  };
}

// ---------- Hilfen ----------
const teilName = (pl: Platte, nr: number) => pl.name + (/\d$/.test(pl.name) ? 'p' : '') + nr;
function finden(w: Welt, dev: string): { pl: Platte; p?: Partition } | null {
  const s = w.platten!; const n = dev.replace(/^\/dev\//, '');
  for (const pl of s.platten) { if (pl.name === n) return { pl }; for (const p of pl.partitionen) if (teilName(pl, p.nr) === n) return { pl, p }; }
  return null;
}
function nachKennung(w: Welt, spez: string): string | null {
  const by = spez.match(/^\/dev\/disk\/by-(uuid|label|partuuid)\/(.+)$/); if (by) spez = `${by[1].toUpperCase()}=${by[2]}`;
  const m = spez.match(/^(UUID|LABEL|PARTUUID)=["']?([^"']+)["']?$/);
  if (!m) return spez.startsWith('/dev/') ? spez : null;
  for (const pl of w.platten!.platten) for (const p of pl.partitionen) {
    if ((m[1] === 'UUID' && p.fs?.uuid.toLowerCase() === m[2].toLowerCase()) || (m[1] === 'LABEL' && p.fs?.label === m[2]) || (m[1] === 'PARTUUID' && p.partuuid === m[2])) return '/dev/' + teilName(pl, p.nr);
  }
  return null;
}
/** Größe wie lsblk und fdisk: 512M, 28,6G, 476,9G */
export function menschGroesse(bytes: number, nachkomma = true): string {
  const e = ['B', 'K', 'M', 'G', 'T']; let v = bytes; let i = 0;
  while (v >= 1024 && i < e.length - 1) { v /= 1024; i++; }
  const r = Math.round(v * 10) / 10;
  return (Number.isInteger(r) || !nachkomma ? String(Math.round(r)) : r.toFixed(1).replace('.', ',')) + e[i];
}
/** Größe wie df -h: aufrunden, unter 10 mit einer Nachkommastelle */
function dfGroesse(bytes: number): string {
  if (bytes < 1024) return bytes ? '1,0K' : '0';
  const e = ['K', 'M', 'G', 'T']; let v = bytes / 1024; let i = 0;
  while (v >= 1024 && i < e.length - 1) { v /= 1024; i++; }
  return v < 10 ? (Math.ceil(v * 10) / 10).toFixed(1).replace('.', ',') + e[i] : Math.ceil(v) + e[i];
}
const fsBytes = (p: Partition) => (p.ende - p.start + 1) * 512;
function belegt(w: Welt, p: Partition, ziel?: string): number {
  const fs = p.fs!; let b = fs.basis < 1 ? Math.round(fs.basis * fsBytes(p)) : fs.basis;
  const quelle = ziel && !w.platten!.mounts.find((m) => m.ziel === ziel)?.virtuell ? Object.entries(w.fs).filter(([k]) => k.startsWith(ziel === '/' ? '/' : ziel + '/')).map(([, v]) => v) : Object.values(fs.dateien);
  for (const c of quelle) b += c === null ? 4096 : Math.ceil(groesse(c) / 4096) * 4096;
  return b;
}
function istEingehaengt(w: Welt, dev: string) { return w.platten!.mounts.find((m) => m.quelle === dev); }

// ---------- Befehle ----------
export function plattenBefehle(h: PlattenHelfer): Record<string, Befehl> {
  const { ok, fehler, pfad, kinder } = h;
  const b: Record<string, Befehl> = {};

  // ----- lsblk -----
  b.lsblk = (w, a) => {
    const s = w.platten!; const f = a.includes('-f') || a.includes('--fs');
    const oi = a.indexOf('-o'); const spalten = oi >= 0 ? a[oi + 1].toUpperCase().split(',') : null;
    const ziele = a.filter((x, i) => x.startsWith('/dev/') && a[i - 1] !== '-o');
    const mp = (dev: string) => s.swaps.includes(dev) ? '[SWAP]' : (s.mounts.find((m) => m.quelle === dev)?.ziel ?? '');
    const zeilen: string[][] = [];
    const reihen: { name: string; dev: string; maj: string; rm: string; size: string; typ: string; fs?: Dateisystem; p?: Partition }[] = [];
    const sortiert = [...s.platten].sort((x, y) => (x.maj === 259 ? 1 : 0) - (y.maj === 259 ? 1 : 0) || x.name.localeCompare(y.name));
    for (const pl of sortiert) {
      if (ziele.length && !ziele.includes('/dev/' + pl.name)) continue;
      reihen.push({ name: pl.name, dev: '/dev/' + pl.name, maj: `${pl.maj}:${pl.maj === 8 ? (pl.name.charCodeAt(2) - 97) * 16 : 0}`, rm: pl.rm ? '1' : '0', size: menschGroesse(pl.sektoren * 512), typ: 'disk' });
      pl.partitionen.forEach((p, i) => reihen.push({ name: (i === pl.partitionen.length - 1 ? '└─' : '├─') + teilName(pl, p.nr), dev: '/dev/' + teilName(pl, p.nr), maj: `${pl.maj}:${pl.maj === 8 ? (pl.name.charCodeAt(2) - 97) * 16 + p.nr : p.nr}`, rm: pl.rm ? '1' : '0', size: menschGroesse(fsBytes(p)), typ: 'part', fs: p.fs, p }));
      if (pl.name === 'sda' && !ziele.length) reihen.push({ name: 'sr0', dev: '/dev/sr0', maj: '11:0', rm: '1', size: '1024M', typ: 'rom' });
    }
    if (f || spalten) {
      const sp = spalten ?? ['NAME', 'FSTYPE', 'FSVER', 'LABEL', 'UUID', 'FSAVAIL', 'FSUSE%', 'MOUNTPOINTS'];
      const wert = (r: typeof reihen[0], c: string) => {
        const m = s.mounts.find((x) => x.quelle === r.dev);
        const ver = r.fs ? ({ ext4: '1.0', ext3: '1.0', ext2: '1.0', vfat: 'FAT32', xfs: '', exfat: '1.0', btrfs: '', swap: '1' } as Record<string, string>)[r.fs.art] : '';
        const frei = m && r.p && r.fs ? dfGroesse(fsBytes(r.p) - belegt(w, r.p, m.ziel)) : '';
        const proz = m && r.p && r.fs ? Math.ceil(belegt(w, r.p, m.ziel) / fsBytes(r.p) * 100) + '%' : '';
        return ({ NAME: r.name, FSTYPE: r.fs?.art ?? '', FSVER: ver, LABEL: r.fs?.label ?? '', UUID: r.fs?.uuid ?? '', FSAVAIL: frei, 'FSUSE%': proz, MOUNTPOINTS: mp(r.dev), MOUNTPOINT: mp(r.dev), SIZE: r.size, TYPE: r.typ, RM: r.rm, 'MAJ:MIN': r.maj, MODEL: '' } as Record<string, string>)[c] ?? '';
      };
      zeilen.push(sp);
      for (const r of reihen) zeilen.push(sp.map((c) => wert(r, c)));
      const br = sp.map((_, i) => Math.max(...zeilen.map((z) => z[i].length)));
      return ok(zeilen.map((z) => z.map((x, i) => i === z.length - 1 ? x : x.padEnd(br[i])).join(' ').trimEnd()).join('\n'));
    }
    // MAJ:MIN ist am Doppelpunkt ausgerichtet
    const mm = (x: string) => { const [ma, mi] = x.split(':'); return ma.padStart(3) + ':' + mi.padEnd(3); };
    return ok(['NAME        MAJ:MIN RM   SIZE RO TYPE MOUNTPOINTS', ...reihen.map((r) => `${r.name.padEnd(11)} ${mm(r.maj)} ${r.rm.padStart(2)} ${r.size.padStart(6)}  0 ${r.typ.padEnd(4)} ${mp(r.dev)}`.trimEnd())].join('\n'));
  };

  // ----- blkid -----
  b.blkid = (w, a, _i, root) => {
    const out: string[] = [];
    for (const pl of w.platten!.platten) for (const p of pl.partitionen) {
      const dev = '/dev/' + teilName(pl, p.nr);
      if (a.length && !a.filter((x) => !x.startsWith('-')).includes(dev)) continue;
      const fs = p.fs; const teile: string[] = [];
      if (fs) { if (fs.label) teile.push(`LABEL="${fs.label}"`); teile.push(`UUID="${fs.uuid}"`); if (fs.art !== 'swap' && fs.art !== 'vfat' && fs.art !== 'exfat') teile.push('BLOCK_SIZE="4096"'); if (fs.art === 'vfat') teile.push('BLOCK_SIZE="512"'); teile.push(`TYPE="${fs.art}"`); }
      if (pl.label === 'gpt' && p.typ.startsWith('EFI')) teile.push('PARTLABEL="EFI System Partition"');
      teile.push(`PARTUUID="${p.partuuid}"`);
      out.push(`${dev}: ${teile.join(' ')}`);
    }
    void root;
    return out.length ? ok(out.join('\n')) : { out: '', code: 2 };
  };

  // ----- df -----
  b.df = (w, a) => {
    const hum = a.some((x) => /^-\w*h/.test(x)); const typ = a.some((x) => /^-\w*T/.test(x)); const inodes = a.some((x) => /^-\w*i/.test(x));
    const ziele = a.filter((x) => !x.startsWith('-')).map((x) => pfad(w, x));
    const kopf = ['Dateisystem', ...(typ ? ['Typ'] : []), ...(inodes ? ['Inodes', 'IBenutzt', 'IFrei', 'IUse%'] : hum ? ['Größe', 'Benutzt', 'Verf.', 'Verw%'] : ['1K-Blöcke', 'Benutzt', 'Verfügbar', 'Verw%']), 'Eingehängt auf'];
    const zeilen: string[][] = [kopf];
    for (const m of w.platten!.mounts) {
      // df DATEI zeigt nur das Dateisystem, auf dem die Datei liegt (den längsten passenden Einhängepunkt)
      const zustaendig = (z: string) => w.platten!.mounts.filter((x) => z === x.ziel || z.startsWith(x.ziel === '/' ? '/' : x.ziel + '/')).sort((x, y) => y.ziel.length - x.ziel.length)[0];
      if (ziele.length && !ziele.some((z) => zustaendig(z) === m)) continue;
      const t = finden(w, m.quelle); if (!t?.p?.fs) continue;
      const gesamt = fsBytes(t.p); const res = gesamt * t.p.fs.reserviert / 100; const bel = belegt(w, t.p, m.ziel);
      const verf = Math.max(0, gesamt - res - bel);
      const proz = Math.ceil(bel / (bel + verf) * 100) + '%';
      let werte: string[];
      if (inodes) { const n = t.p.fs.art === 'vfat' ? 0 : Math.round(gesamt / 16384); const u = n ? 11 + Object.keys(t.p.fs.dateien).length + Math.round(bel / 300000) : 0; werte = n ? [String(n), String(u), String(n - u), Math.ceil(u / n * 100) + '%'] : ['0', '0', '0', '-']; }
      else werte = hum ? [dfGroesse(gesamt), dfGroesse(bel), dfGroesse(verf), proz] : [String(Math.round(gesamt / 1024)), String(Math.round(bel / 1024)), String(Math.round(verf / 1024)), proz];
      zeilen.push([m.quelle, ...(typ ? [m.art] : []), ...werte, m.ziel]);
    }
    if (!ziele.length) zeilen.splice(1, 0, ['udev', ...(typ ? ['devtmpfs'] : []), ...(inodes ? ['2031023', '512', '2030511', '1%'] : hum ? ['7,8G', '0', '7,8G', '0%'] : ['8124092', '0', '8124092', '0%']), '/dev'], ['tmpfs', ...(typ ? ['tmpfs'] : []), ...(inodes ? ['2037928', '1094', '2036834', '1%'] : hum ? ['1,6G', '1,9M', '1,6G', '1%'] : ['1630344', '1888', '1628456', '1%']), '/run']);
    const br = kopf.map((_, i) => Math.max(...zeilen.map((z) => z[i].length)));
    return ok(zeilen.map((z) => z.map((x, i) => i === 0 ? x.padEnd(br[i]) : i === z.length - 1 ? x : x.padStart(br[i])).join(' ')).join('\n'));
  };

  // ----- du -----
  b.du = (w, a, _i, root) => {
    const s = a.some((x) => /^-\w*s/.test(x)); const hum = a.some((x) => /^-\w*h/.test(x)); const alle = a.some((x) => /^-\w*a/.test(x)); const sum = a.some((x) => /^-\w*c/.test(x));
    const tm = a.find((x) => x.startsWith('--max-depth=')) ?? (a.includes('-d') ? '--max-depth=' + a[a.indexOf('-d') + 1] : '');
    const tiefeMax = tm ? Number(tm.split('=')[1]) : Infinity;
    const ziele = a.filter((x, i) => !x.startsWith('-') && a[i - 1] !== '-d'); if (!ziele.length) ziele.push('.');
    const out: string[] = []; const err: string[] = []; let total = 0;
    const fmt = (k: number) => hum ? (k === 0 ? '0' : dfGroesse(k * 1024)) : String(k);
    for (const z of ziele) {
      const p = pfad(w, z);
      if (!(p in w.fs)) { err.push(`du: Zugriff auf '${z}' nicht möglich: Datei oder Verzeichnis nicht gefunden`); continue; }
      const gehe = (q: string, anzeige: string, tiefe: number): number => {
        const c = w.fs[q];
        if (c !== null) { const k = typeof c === 'string' && c.startsWith('-> ') ? 0 : Math.ceil(groesse(c) / 4096) * 4; if ((alle || tiefe === 0) && !s) out.push(`${fmt(k)}\t${anzeige}`); return k; }
        const m = meta(w, q);
        if (!root && q !== '/' && !((m.owner === 'lena' ? m.mode >> 6 : m.mode) & 5)) { err.push(`du: Verzeichnis '${anzeige}' kann nicht gelesen werden: Keine Berechtigung`); return 4; }
        let k = 4;
        for (const n of kinder(w, q)) k += gehe((q === '/' ? '' : q) + '/' + n, (anzeige === '/' ? '' : anzeige) + '/' + n, tiefe + 1);
        if ((!s || tiefe === 0) && tiefe <= tiefeMax) out.push(`${fmt(k)}\t${anzeige}`);
        return k;
      };
      total += gehe(p, z.replace(/\/$/, '') || '/', 0);
    }
    if (sum) out.push(`${fmt(total)}\tinsgesamt`);
    return { out: out.join('\n'), err: err.join('\n') || undefined, code: err.length ? 1 : 0 };
  };

  // ----- fdisk -----
  b.fdisk = (w, a, _i, root) => {
    if (a.includes('-l') || a.includes('--list')) {
      const ziel = a.find((x) => x.startsWith('/dev/'));
      const liste = w.platten!.platten.filter((pl) => !ziel || '/dev/' + pl.name === ziel).sort((x, y) => (y.maj === 259 ? 1 : 0) - (x.maj === 259 ? 1 : 0));
      if (!root) return fehler(`fdisk: ${ziel ?? '/dev/' + liste[0].name} kann nicht geöffnet werden: Keine Berechtigung`);
      return ok(liste.map((pl) => tabelleText(pl)).join('\n\n'));
    }
    const dev = a.find((x) => x.startsWith('/dev/'));
    if (!dev) return fehler('Aufruf:\n fdisk [Optionen] <Festplatte>         Partitionstabelle ändern\n fdisk [Optionen] -l [<Festplatte>…]   Partitionstabelle(n) auflisten', 1);
    const t = finden(w, dev);
    if (!t) return fehler(`fdisk: ${dev} kann nicht geöffnet werden: Datei oder Verzeichnis nicht gefunden`);
    if (t.p) return fehler(`fdisk: ${dev} ist eine Partition, keine ganze Festplatte. Gib das Gerät ohne Nummer an, etwa /dev/${t.pl.name}.`);
    if (!root) return fehler(`fdisk: ${dev} kann nicht geöffnet werden: Keine Berechtigung`);
    return fdiskDialog(w, t.pl);
  };

  function tabelleText(pl: Platte): string {
    const gb = pl.sektoren * 512 / GIB;
    const z = [`Festplatte /dev/${pl.name}: ${gb.toFixed(2).replace('.', ',')} GiB, ${pl.sektoren * 512} Bytes, ${pl.sektoren} Sektoren`,
      `Festplattenmodell: ${pl.modell}`, 'Einheiten: Sektoren von 1 * 512 = 512 Bytes', 'Sektorgröße (logisch/physikalisch): 512 Bytes / 512 Bytes', 'E/A-Größe (minimal/optimal): 512 Bytes / 512 Bytes'];
    if (!pl.label) return z.join('\n');
    z.push(`Festplattenbezeichnungstyp: ${pl.label}`, `Festplattenbezeichner: ${pl.id}`);
    if (!pl.partitionen.length) return z.join('\n');
    const kopf = pl.label === 'gpt' ? ['Gerät', 'Anfang', 'Ende', 'Sektoren', 'Größe', 'Typ'] : ['Gerät', 'Boot', 'Anfang', 'Ende', 'Sektoren', 'Größe', 'Kn', 'Typ'];
    const zeilen = [kopf, ...pl.partitionen.map((p) => pl.label === 'gpt'
      ? ['/dev/' + teilName(pl, p.nr), String(p.start), String(p.ende), String(p.ende - p.start + 1), menschGroesse(fsBytes(p)), p.typ]
      : ['/dev/' + teilName(pl, p.nr), p.boot ? '*' : '', String(p.start), String(p.ende), String(p.ende - p.start + 1), menschGroesse(fsBytes(p)), p.typ, DOS_NAME[p.typ] ?? 'Linux'])];
    const br = kopf.map((_, i) => Math.max(...zeilen.map((r) => r[i].length)));
    z.push('', ...zeilen.map((r) => r.map((x, i) => i === 0 || i === r.length - 1 || (pl.label === 'dos' && i === 1) ? x.padEnd(i === r.length - 1 ? 0 : br[i]) : x.padStart(br[i])).join(' ').trimEnd()));
    return z.join('\n');
  }
  const DOS_NAME: Record<string, string> = { '83': 'Linux', '82': 'Linux Swap / Solaris', '8e': 'Linux LVM', 'c': 'W95 FAT32 (LBA)', 'b': 'W95 FAT32', '7': 'HPFS/NTFS/exFAT', 'ef': 'EFI (FAT-12/16/32)', '5': 'Erweiterte', 'fd': 'Linux raid autodetect' };
  const GPT_TYP: Record<string, string> = { '1': 'EFI-System', '19': 'Linux Swap', '20': 'Linux-Dateisystem', '30': 'Linux LVM', '29': 'Linux RAID', '23': 'Linux root (x86-64)', '42': 'Linux home', linux: 'Linux-Dateisystem', swap: 'Linux Swap', uefi: 'EFI-System', lvm: 'Linux LVM', raid: 'Linux RAID', home: 'Linux home' };
  const DOS_ALIAS: Record<string, string> = { linux: '83', swap: '82', lvm: '8e', raid: 'fd', uefi: 'ef', extended: '5' };

  /** Interaktives fdisk: Befehle werden erst mit w auf die Platte geschrieben. */
  function fdiskDialog(w: Welt, pl: Platte): Ergebnis {
    let entwurf: Partition[] = pl.partitionen.map((p) => ({ ...p }));
    let label = pl.label; let id = pl.id; let geaendert = false;
    const erster = 2048; const letzter = () => label === 'gpt' ? pl.sektoren - 34 : pl.sektoren - 1;
    const frei = () => { const belegt = entwurf.filter((p) => p.typ !== '5').map((p) => [p.start, p.ende]).sort((x, y) => x[0] - y[0]); let s = erster; for (const [a, e] of belegt) { if (a > s) break; s = e + 1; } return s; };
    const groesseAus = (t: string, start: number) => { const m = t.match(/^\+(\d+(?:[.,]\d+)?)([KMGT])?$/i); if (!m) return Number(t); const f = { K: 1024, M: 1048576, G: GIB, T: GIB * 1024 }[(m[2] ?? '').toUpperCase() as 'K'] ?? 512; return start + Math.round(parseFloat(m[1].replace(',', '.')) * f / 512) - 1; };
    const hilfe = `\nHilfe:\n\n  Allgemein\n   d   Eine Partition löschen\n   l   Die bekannten Dateisystemtypen anzeigen\n   n   Eine neue Partition anlegen\n   p   Die Partitionstabelle ausgeben\n   t   Einen Partitionstyp ändern\n\n  Sonstiges\n   m   Dieses Menü anzeigen\n\n  Speichern und beenden\n   w   Die Tabelle auf die Festplatte schreiben und das Programm beenden\n   q   Beenden ohne Speichern der Änderungen\n\n  Eine neue Festplattenbezeichnung erstellen\n   g   Eine neue leere GPT-Partitionstabelle erstellen\n   o   Eine neue leere MBR-(DOS-)Partitionstabelle erstellen\n`;
    type Schritt = { prompt: string; weiter: (e: string) => string };
    const BEFEHL = 'Befehl (m für Hilfe): ';
    let schritt: Schritt;
    const haupt = (): Schritt => ({ prompt: BEFEHL, weiter: befehl });
    function befehl(e: string): string {
      const c = e.trim();
      if (c === '') return '';
      if (c === 'm') return hilfe;
      if (c === 'q') { w.dialog = null; return ''; }
      if (c === 'p') { const kopie = { ...pl, label, id, partitionen: entwurf }; return tabelleText(kopie); }
      if (c === 'g') { label = 'gpt'; id = `${hex(7, 8)}-${hex(9, 4)}-4${hex(11, 3)}-8${hex(13, 3)}-${hex(17, 12)}`.toUpperCase(); entwurf = []; geaendert = true; return `Eine neue GPT-Festplattenbezeichnung wurde erstellt (GUID: ${id}).`; }
      if (c === 'o') { label = 'dos'; id = '0x' + hex(5, 8); entwurf = []; geaendert = true; return `Eine neue DOS-(MBR-)Festplattenbezeichnung ${id} wurde erstellt.`; }
      if (c === 'l') return label === 'gpt' ? '  1 EFI-System\n 19 Linux Swap\n 20 Linux-Dateisystem\n 23 Linux root (x86-64)\n 29 Linux RAID\n 30 Linux LVM\n 42 Linux home\n(gekürzt)\nAliase:\n   linux - 0FC63DAF-8483-4772-8E79-3D69D8477DE4\n   swap  - 0657FD6D-A4AB-43C4-84E5-0933C84B4F4F\n   uefi  - C12A7328-F81F-11D2-BA4B-00A0C93EC93B\n   lvm   - E6D6D379-F507-44C2-A23C-238F2A3DF928' : ' 5  Erweiterte\n 7  HPFS/NTFS/exFAT\n b  W95 FAT32\n c  W95 FAT32 (LBA)\n82  Linux Swap / Solaris\n83  Linux\n8e  Linux LVM\nef  EFI (FAT-12/16/32)\nfd  Linux raid autodetect\n(gekürzt)\nAliase:\n   linux    - 83\n   swap     - 82\n   extended - 05\n   uefi     - EF\n   lvm      - 8E';
      if (c === 'w') {
        pl.label = label; pl.id = id; pl.partitionen = entwurf;
        for (const p of entwurf) if (!p.partuuid) p.partuuid = label === 'gpt' ? neueUuid('ext4') : `${id.slice(2)}-0${p.nr}`;
        w.dialog = null;
        w.verlauf.push({ zeile: `#fdisk geschrieben /dev/${pl.name}`, code: 0, ausgabe: '' });
        return 'Die Partitionstabelle wurde verändert.\nioctl() wird aufgerufen, um die Partitionstabelle neu einzulesen.\nFestplatten werden synchronisiert.';
      }
      if (!label) return 'Gerät enthält keine erkennbare Partitionstabelle.\n(Lege zuerst mit g eine GPT- oder mit o eine MBR-Tabelle an.)';
      if (c === 'n') {
        const nummern = entwurf.map((p) => p.nr);
        const maxNr = label === 'gpt' ? 128 : 4;
        const naechste = Array.from({ length: maxNr }, (_, i) => i + 1).find((n) => !nummern.includes(n));
        if (!naechste) return 'Alle primären Partitionen sind in Benutzung.';
        if (frei() > letzter()) return 'Es sind keine freien Sektoren verfügbar.';
        let typDos = 'p';
        const nummer = (): Schritt => ({ prompt: `Partitionsnummer (${naechste}-${maxNr}, Standard ${naechste}): `, weiter: (x) => { const n = x.trim() ? Number(x) : naechste; if (!n || nummern.includes(n) || n > maxNr) { schritt = nummer(); return 'Wert außerhalb des Bereichs.'; } schritt = anfang(n); return ''; } });
        const anfang = (n: number): Schritt => { const s0 = frei(); return { prompt: `Erster Sektor (${s0}-${letzter()}, Standard ${s0}): `, weiter: (x) => { const s = x.trim() ? Number(x) : s0; if (!(s >= erster && s <= letzter())) { schritt = anfang(n); return 'Wert außerhalb des Bereichs.'; } schritt = ende(n, s); return ''; } }; };
        const ende = (n: number, s: number): Schritt => {
          const naechsteBelegt = entwurf.filter((p) => p.start > s).map((p) => p.start - 1); const max = Math.min(letzter(), ...naechsteBelegt);
          return { prompt: `Letzter Sektor, +/-Sektoren oder +/-Größe{K,M,G,T,P} (${s}-${max}, Standard ${max}): `, weiter: (x) => {
            const e2 = x.trim() ? groesseAus(x.trim(), s) : max;
            if (!(e2 > s && e2 <= max)) { schritt = ende(n, s); return 'Wert außerhalb des Bereichs.'; }
            const p: Partition = { nr: n, start: s, ende: e2, typ: label === 'gpt' ? 'Linux-Dateisystem' : (typDos === 'e' ? '5' : '83'), partuuid: '' };
            entwurf.push(p); entwurf.sort((x2, y) => x2.nr - y.nr); geaendert = true; schritt = haupt();
            return `\nEine neue Partition ${n} des Typs »${label === 'gpt' ? p.typ : DOS_NAME[p.typ]}« und der Größe ${menschGroesse(fsBytes(p)).replace(/([KMGT])$/, ' $1iB')} wurde erstellt.`;
          } };
        };
        if (label === 'dos') {
          schritt = { prompt: 'Wählen (Vorgabe p): ', weiter: (x) => { typDos = x.trim() || 'p'; if (!/^[pe]$/.test(typDos)) { schritt = haupt(); return `${typDos}: unbekannter Befehl`; } schritt = nummer(); return x.trim() ? '' : 'Standardantwort p wird verwendet.'; } };
          return `Partitionstyp\n   p   Primär (${entwurf.length} primary, ${entwurf.filter((p) => p.typ === '5').length} extended, ${4 - entwurf.length} free)\n   e   Erweitert (Container für logische Partitionen)`;
        }
        schritt = nummer(); return '';
      }
      if (c === 'd' || c === 't') {
        if (!entwurf.length) return 'Es sind noch keine Partitionen definiert!';
        const nrs = entwurf.map((p) => p.nr);
        const wahl = (aktion: (p: Partition) => string): string => {
          if (nrs.length === 1) { const p = entwurf[0]; return `Partition ${p.nr} ausgewählt\n` + aktion(p); }
          schritt = { prompt: `Partitionsnummer (${nrs.join(',')}, Standard ${nrs[nrs.length - 1]}): `, weiter: (x) => { const n = x.trim() ? Number(x) : nrs[nrs.length - 1]; const p = entwurf.find((q) => q.nr === n); schritt = haupt(); if (!p) return 'Wert außerhalb des Bereichs.'; return aktion(p); } };
          return '';
        };
        if (c === 'd') return wahl((p) => { entwurf = entwurf.filter((q) => q !== p); geaendert = true; schritt = haupt(); return `Partition ${p.nr} wurde gelöscht.`; });
        return wahl((p) => {
          schritt = { prompt: 'Hexadezimalcode oder Alias (geben Sie L ein, um alle Codes aufzulisten): ', weiter: (x) => {
            const k = x.trim().toLowerCase(); schritt = haupt();
            const alt = label === 'gpt' ? p.typ : DOS_NAME[p.typ];
            if (label === 'gpt') { const neu = GPT_TYP[k]; if (!neu) return 'Wert außerhalb des Bereichs.'; p.typ = neu; }
            else { const code = DOS_ALIAS[k] ?? k.replace(/^0+/, ''); if (!DOS_NAME[code]) return 'Wert außerhalb des Bereichs.'; p.typ = code; }
            geaendert = true;
            return `Partitionstyp von »${alt}« nach »${label === 'gpt' ? p.typ : DOS_NAME[p.typ]}« geändert.`;
          } };
          return '';
        });
      }
      return `${c[0]}: unbekannter Befehl`;
    }
    schritt = haupt();
    w.dialog = { get prompt() { return schritt.prompt; }, eingabe: (e: string) => { const s = schritt; const out = s.weiter(e); if (w.dialog && schritt === s && s.prompt !== BEFEHL) schritt = haupt(); return out; } };
    void geaendert;
    const start = `Willkommen bei fdisk (util-linux 2.38.1).\nÄnderungen werden vorerst nur im Speicher vorgenommen, bis Sie sich\nentscheiden, sie zu schreiben.\nSeien Sie vorsichtig, bevor Sie den Schreibbefehl anwenden.\n`;
    return ok(start + (pl.label ? '' : `\nGerät enthält keine erkennbare Partitionstabelle.\n`));
  }

  // ----- gdisk und parted (nur Anzeige und einfache Aufrufe) -----
  b.gdisk = (w, a, _i, root) => {
    const dev = a.find((x) => x.startsWith('/dev/')); const t = dev ? finden(w, dev) : null;
    if (!t) return fehler('Usage: gdisk [-l] device_file');
    if (!root) return fehler(`Problem opening ${dev} for reading! Error is 13.\nYou must run this program as root or use sudo!`);
    if (!a.includes('-l')) return fehler('(Der Simulator kann gdisk nur mit -l. Zum Partitionieren nimm fdisk: Es kann GPT genauso.)');
    const pl = t.pl;
    return ok(`GPT fdisk (gdisk) version 1.0.9\n\nPartition table scan:\n  MBR: ${pl.label === 'gpt' ? 'protective' : pl.label === 'dos' ? 'MBR only' : 'not present'}\n  BSD: not present\n  APM: not present\n  GPT: ${pl.label === 'gpt' ? 'present' : 'not present'}\n\n${pl.label === 'gpt' ? 'Found valid GPT with protective MBR; using GPT.' : 'Creating new GPT entries in memory.'}\nDisk /dev/${pl.name}: ${pl.sektoren} sectors, ${menschGroesse(pl.sektoren * 512).replace(/([KMGT])$/, ' $1iB').replace(',', '.')}\n\nNumber  Start (sector)    End (sector)  Size       Code  Name\n` + pl.partitionen.map((p) => `${String(p.nr).padStart(4)}  ${String(p.start).padStart(14)}  ${String(p.ende).padStart(14)}   ${menschGroesse(fsBytes(p)).replace(/([KMGT])$/, ' $1iB').replace(',', '.').padEnd(10)} ${p.typ.startsWith('EFI') ? 'EF00' : p.typ.includes('Swap') ? '8200' : '8300'}  ${p.typ.startsWith('EFI') ? 'EFI System Partition' : ''}`).join('\n'));
  };
  b.parted = (w, a, _i, root) => {
    const rest = a.filter((x) => x !== '-s' && x !== '--script');
    const dev = rest.find((x) => x.startsWith('/dev/')); const t = dev ? finden(w, dev) : null;
    if (!dev || !t) return fehler('(Im Simulator: parted /dev/sdX print, oder parted -s /dev/sdX mklabel gpt bzw. mkpart … mit allen Angaben in einer Zeile.)');
    if (!root) return fehler(`Fehler: Fehler beim Öffnen von ${dev}: Keine Berechtigung`);
    const cmd = rest.slice(rest.indexOf(dev) + 1); const pl = t.pl;
    const zahl = (s: string) => { const m = s.match(/^([\d.]+)(MiB|GiB|MB|GB|%|s)?$/); if (!m) return NaN; const v = parseFloat(m[1]); return m[2] === '%' ? Math.round(pl.sektoren * v / 100) : m[2] === 'GiB' ? v * GIB / 512 : m[2] === 'GB' ? v * 1e9 / 512 : m[2] === 'MB' ? v * 1e6 / 512 : m[2] === 's' ? v : v * 1048576 / 512; };
    if (cmd[0] === 'mklabel') { pl.label = cmd[1] === 'msdos' ? 'dos' : 'gpt'; pl.id = pl.label === 'dos' ? '0x' + hex(3, 8) : neueUuid('ext4').toUpperCase(); pl.partitionen = []; return ok(); }
    if (cmd[0] === 'mkpart') {
      if (!pl.label) return fehler(`Fehler: ${dev}: Festplattenbezeichnung nicht erkannt`);
      const werte = cmd.slice(1); const anfang = werte[werte.length - 2]; const ende = werte[werte.length - 1];
      const s = Math.max(2048, Math.round(zahl(anfang))); const e = Math.min(pl.sektoren - 34, Math.round(zahl(ende)) - 1);
      if (!(e > s)) return fehler('Fehler: Ungültiger Bereich.');
      const nr = (pl.partitionen.length ? Math.max(...pl.partitionen.map((p) => p.nr)) : 0) + 1;
      pl.partitionen.push({ nr, start: s, ende: e, typ: werte.includes('linux-swap') ? (pl.label === 'gpt' ? 'Linux Swap' : '82') : pl.label === 'gpt' ? 'Linux-Dateisystem' : '83', partuuid: neueUuid('ext4') });
      return ok();
    }
    if (cmd[0] === 'rm') { pl.partitionen = pl.partitionen.filter((p) => p.nr !== Number(cmd[1])); return ok(); }
    if (!cmd.length || cmd[0] === 'print') {
      if (!pl.label) return { out: `Modell: ${pl.modell} (scsi)\nFestplatte  ${dev}: ${Math.round(pl.sektoren * 512 / 1e9)}GB\nFehler: ${dev}: Festplattenbezeichnung nicht erkannt`, code: 1 };
      return ok(`Modell: ${pl.modell} (${pl.maj === 259 ? 'nvme' : 'scsi'})\nFestplatte  ${dev}:  ${Math.round(pl.sektoren * 512 / 1e9)}GB\nSektorgröße (logisch/physisch): 512B/512B\nPartitionstabelle: ${pl.label === 'dos' ? 'msdos' : 'gpt'}\n\nNummer  Anfang  Ende    Größe   Dateisystem  Name  Flags\n` + pl.partitionen.map((p) => `${String(p.nr).padStart(2)}      ${(Math.round(p.start * 512 / 1e6 * 10) / 10 + 'MB').padEnd(7)} ${(Math.round(p.ende * 512 / 1e9 * 10) / 10 + 'GB').padEnd(7)} ${(Math.round(fsBytes(p) / 1e9 * 10) / 10 + 'GB').padEnd(7)} ${(p.fs?.art === 'swap' ? 'linux-swap(v1)' : p.fs?.art ?? '').padEnd(12)}`).join('\n'));
    }
    return fehler(`(Diesen parted-Befehl kennt der Simulator nicht: ${cmd[0]})`);
  };

  // ----- mkfs und mkswap -----
  function mkfs(w: Welt, art: FsArt, a: string[], root: boolean, prog: string): Ergebnis {
    const dev = a.filter((x) => x.startsWith('/dev/')).pop();
    const labelOpt = art === 'vfat' ? '-n' : '-L';
    const li = a.indexOf(labelOpt); const label = li >= 0 ? a[li + 1] : undefined;
    const force = a.includes('-f') || a.includes('-F');
    if (!dev) return fehler(`Aufruf: ${prog} [Optionen] Gerät`);
    const t = finden(w, dev);
    if (!t) return fehler(`${prog}: Die Datei ${dev} existiert nicht und es wurde keine Größe angegeben.`);
    if (!root) return fehler(art.startsWith('ext') ? `${prog}: Keine Berechtigung beim Versuch, ${dev} zu öffnen\nDas Gerät ${dev} kann nicht exklusiv geöffnet werden: Keine Berechtigung` : `${prog}: cannot open ${dev}: Permission denied`);
    if (!t.p) return fehler(art.startsWith('ext') ? `(Achtung: ${dev} ist die ganze Platte. Im Simulator legst du Dateisysteme auf Partitionen an, etwa ${dev}1.)` : `${prog}: ${dev} ist die ganze Platte, nimm eine Partition.`);
    if (istEingehaengt(w, dev) || w.platten!.swaps.includes(dev)) return fehler(art.startsWith('ext') ? `${dev} ist eingehängt; hier wird kein Dateisystem angelegt!` : `${prog}: ${dev} contains a mounted filesystem`);
    const p = t.p;
    const anlegen = (): Ergebnis => {
      p.fs = neuesFs(art, w.uhr, label);
      const bloecke = Math.floor(fsBytes(p) / 4096);
      w.verlauf.push({ zeile: `#mkfs ${art} ${dev}`, code: 0, ausgabe: '' });
      if (art.startsWith('ext')) {
        const inodes = Math.round(fsBytes(p) / 16384);
        return ok(`mke2fs 1.47.0 (5-Feb-2023)\nGeräteblöcke werden verworfen: erledigt                            \nEin Dateisystem mit ${bloecke} (4k) Blöcken und ${inodes} Inodes wird erzeugt.\nUUID des Dateisystems: ${p.fs.uuid}\nSuperblock-Sicherungskopien gespeichert in den Blöcken: \n\t32768, 98304, 163840, 229376, 294912, 819200, 884736, 1605632\n\nbeim Anfordern von Speicher für die Gruppentabellen: erledigt                            \nInode-Tabellen werden geschrieben: erledigt                            \n${art !== 'ext2' ? 'Das Journal (65536 Blöcke) wird angelegt: fertig\n' : ''}Die Superblöcke und die Informationen über die Dateisystemnutzung werden\ngeschrieben: erledigt\n`);
      }
      if (art === 'xfs') return ok(`meta-data=${dev.padEnd(15)} isize=512    agcount=4, agsize=${Math.floor(bloecke / 4)} blks\n         =                       sectsz=512   attr=2, projid32bit=1\n         =                       crc=1        finobt=1, sparse=1, rmapbt=0\n         =                       reflink=1    bigtime=1 inobtcount=1 nrext64=0\ndata     =                       bsize=4096   blocks=${bloecke}, imaxpct=25\n         =                       sunit=0      swidth=0 blks\nnaming   =version 2              bsize=4096   ascii-ci=0, ftype=1\nlog      =internal log           bsize=4096   blocks=16384, version=2\n         =                       sectsz=512   sunit=0 blks, lazy-count=1\nrealtime =none                   extsz=4096   blocks=0, rtextents=0\nDiscarding blocks...Done.`);
      if (art === 'vfat') return ok('mkfs.fat 4.2 (2021-01-31)');
      if (art === 'exfat') return ok(`exfatprogs version : 1.2.0\nCreating exFAT filesystem(${dev}, cluster size=131072)\n\nWriting volume boot record: done\nWriting backup volume boot record: done\nFat table creation: done\nAllocation bitmap creation: done\nUpcase table creation: done\nWriting root directory entry: done\nSynchronizing...\n\nexFAT format complete!`);
      return ok(`btrfs-progs v6.2\nSee http://btrfs.wiki.kernel.org for more information.\n\nLabel:              ${label ?? '(null)'}\nUUID:               ${p.fs.uuid}\nNode size:          16384\nSector size:        4096\nFilesystem size:    ${menschGroesse(fsBytes(p)).replace(',', '.')}iB\nBlock group profiles:\n  Data:             single            8.00MiB\n  Metadata:         DUP             256.00MiB\n  System:           DUP               8.00MiB`);
    };
    if (p.fs && p.fs.art !== art && !force && art.startsWith('ext')) {
      w.wartet = { standardJa: false, aktion: anlegen, nein: '' };
      return ok(`mke2fs 1.47.0 (5-Feb-2023)\n${dev} hat ein ${p.fs.art}-Dateisystem${p.fs.label ? ` mit Namen „${p.fs.label}“` : ''}\nTrotzdem fortfahren? (j,n) `);
    }
    if (p.fs && art === 'xfs' && !force) return fehler(`mkfs.xfs: ${dev} appears to contain an existing filesystem (${p.fs.art}).\nmkfs.xfs: Use the -f option to force overwrite.`);
    return anlegen();
  }
  for (const art of ['ext2', 'ext3', 'ext4', 'xfs', 'vfat', 'exfat', 'btrfs'] as FsArt[]) b['mkfs.' + art] = (w, a, _i, root) => mkfs(w, art, a, root, 'mkfs.' + art);
  b['mkfs.fat'] = b['mkfs.vfat'];
  b.mke2fs = (w, a, _i, root) => { const ti = a.indexOf('-t'); const art = (ti >= 0 ? a[ti + 1] : 'ext2') as FsArt; return mkfs(w, art, a.filter((_, i) => i !== ti && i !== ti + 1), root, 'mke2fs'); };
  b.mkfs = (w, a, _i, root) => { const ti = a.indexOf('-t'); const art = (ti >= 0 ? a[ti + 1] : 'ext2') as FsArt; if (!['ext2', 'ext3', 'ext4', 'xfs', 'vfat', 'exfat', 'btrfs'].includes(art)) return fehler(`mkfs: mkfs.${art} konnte nicht gefunden werden`); return mkfs(w, art, a.filter((_, i) => i !== ti && i !== ti + 1), root, 'mkfs.' + art); };
  b.mkswap = (w, a, _i, root) => {
    const dev = a.find((x) => x.startsWith('/dev/')); const li = a.indexOf('-L');
    const t = dev ? finden(w, dev) : null;
    if (!t?.p) return fehler(`mkswap: ${dev ?? ''} kann nicht geöffnet werden: Datei oder Verzeichnis nicht gefunden`);
    if (!root) return fehler(`mkswap: ${dev} kann nicht geöffnet werden: Keine Berechtigung`);
    if (w.platten!.swaps.includes(dev!) || istEingehaengt(w, dev!)) return fehler(`mkswap: Fehler: ${dev} ist eingehängt; es wird kein Auslagerungsbereich angelegt`);
    t.p.fs = neuesFs('swap', w.uhr, li >= 0 ? a[li + 1] : undefined);
    return ok(`Auslagerungsbereich Version 1 wird angelegt, Größe = ${menschGroesse(fsBytes(t.p) - 4096).replace(/([KMGT])$/, ' $1iB')} (${fsBytes(t.p) - 4096} Bytes)\n${t.p.fs.label ? `LABEL=${t.p.fs.label}, ` : 'keine Bezeichnung, '}UUID=${t.p.fs.uuid}`);
  };
  b.swapon = (w, a, _i, root) => {
    const s = w.platten!;
    if (!a.length || a.includes('--show') || a.includes('-s')) {
      if (a.includes('-s')) return ok('Dateiname\t\t\t\tTyp\t\tGröße\t\tBenutzt\t\tPriorität\n' + s.swaps.map((d, i) => `${d.padEnd(40)}partition\t${Math.round(fsBytes(finden(w, d)!.p!) / 1024)}\t\t0\t\t${-2 - i}`).join('\n'));
      return ok(s.swaps.length ? ['NAME           TYPE      SIZE USED PRIO', ...s.swaps.map((d, i) => `${d.padEnd(14)} partition ${menschGroesse(fsBytes(finden(w, d)!.p!)).padStart(4)}   0B   ${-2 - i}`)].join('\n') : '');
    }
    if (!root) return fehler('swapon: Keine Berechtigung');
    const ziele = a.includes('-a') ? (w.fs['/etc/fstab'] ?? '').split('\n').filter((z) => /\sswap\s/.test(z) && !z.startsWith('#')).map((z) => nachKennung(w, z.split(/\s+/)[0])).filter(Boolean) as string[] : a.filter((x) => !x.startsWith('-')).map((x) => nachKennung(w, x) ?? x);
    for (const d of ziele) {
      const t = finden(w, d);
      if (!t?.p) return fehler(`swapon: ${d}: stat fehlgeschlagen: Datei oder Verzeichnis nicht gefunden`);
      if (t.p.fs?.art !== 'swap') return fehler(`swapon: ${d}: Lesen der Swap-Signatur fehlgeschlagen`);
      if (s.swaps.includes(d)) { if (!a.includes('-a')) return fehler(`swapon: ${d}: swapon fehlgeschlagen: Das Gerät oder die Ressource ist belegt`); continue; }
      s.swaps.push(d);
    }
    return ok();
  };
  b.swapoff = (w, a, _i, root) => {
    if (!root) return fehler('swapoff: Keine Berechtigung');
    const s = w.platten!;
    if (a.includes('-a')) { s.swaps = []; return ok(); }
    for (const x of a) { const d = nachKennung(w, x) ?? x; if (!s.swaps.includes(d)) return fehler(`swapoff: ${x}: swapoff fehlgeschlagen: Das Argument ist ungültig`); s.swaps = s.swaps.filter((y) => y !== d); }
    return ok();
  };

  // ----- mount und umount -----
  const PSEUDO = 'sysfs on /sys type sysfs (rw,nosuid,nodev,noexec,relatime)\nproc on /proc type proc (rw,nosuid,nodev,noexec,relatime)\nudev on /dev type devtmpfs (rw,nosuid,relatime,size=8124092k,nr_inodes=2031023,mode=755,inode64)\ntmpfs on /run type tmpfs (rw,nosuid,nodev,noexec,relatime,size=1630344k,mode=755,inode64)';
  function einhaengen(w: Welt, quelle: string, ziel: string, artWunsch: string | undefined, optionen: string, root: boolean): string | null {
    const s = w.platten!; const zp = pfad(w, ziel);
    if (!root) return `mount: ${zp}: »mount« darf nur der Administrator verwenden.`;
    const dev = nachKennung(w, quelle);
    if (!dev) return `mount: ${zp}: ${quelle} kann nicht gefunden werden.`;
    const t = finden(w, dev);
    if (!t) return `mount: ${zp}: Spezialgerät ${dev} ist nicht vorhanden.`;
    if (!(zp in w.fs)) return `mount: ${zp}: der Einhängepunkt ist nicht vorhanden.\n       dmesg(1) könnte nach einem fehlgeschlagenen mount-Systemaufruf\n       weitere Informationen liefern.`;
    if (w.fs[zp] !== null) return `mount: ${zp}: der Einhängepunkt ist kein Verzeichnis.`;
    const fs = t.p?.fs;
    const art = artWunsch && artWunsch !== 'auto' ? artWunsch : fs?.art;
    if (!t.p || !fs || fs.art === 'swap' || (artWunsch && artWunsch !== 'auto' && artWunsch !== fs.art && !(fs.art === 'ext3' && artWunsch === 'ext4'))) return `mount: ${zp}: Falscher Dateisystemtyp, ungültige Optionen, der Superblock von ${dev} ist beschädigt, fehlende Kodierungsseite oder ein anderer Fehler.\n       dmesg(1) könnte nach einem fehlgeschlagenen mount-Systemaufruf\n       weitere Informationen liefern.`;
    if (s.mounts.find((m) => m.quelle === dev)) return `mount: ${zp}: ${dev} ist bereits auf ${s.mounts.find((m) => m.quelle === dev)!.ziel} eingehängt.`;
    if (fs.kaputt) return `mount: ${zp}: Falscher Dateisystemtyp, ungültige Optionen, der Superblock von ${dev} ist beschädigt, fehlende Kodierungsseite oder ein anderer Fehler.\n       dmesg(1) könnte nach einem fehlgeschlagenen mount-Systemaufruf\n       weitere Informationen liefern.`;
    // Was vorher im Einhängepunkt lag, ist jetzt verdeckt
    const verdeckt = { fs: {} as Record<string, string | null>, meta: {} as Record<string, Meta> };
    for (const k of Object.keys(w.fs).filter((k) => k === zp || k.startsWith(zp + '/'))) { verdeckt.fs[k] = w.fs[k]; verdeckt.meta[k] = { ...meta(w, k) }; if (k !== zp) delete w.fs[k]; }
    for (const [rel, c] of Object.entries(fs.dateien)) { w.fs[zp + rel] = c; w.meta![zp + rel] = { ...(fs.metas[rel] ?? { mode: c === null ? 0o755 : 0o644, owner: 'root', group: 'root', mtime: w.uhr }) }; }
    w.meta![zp] = { ...fs.wurzel };
    const opt = (optionen ? optionen.split(',') : []);
    const ro = opt.includes('ro');
    const zeit = opt.find((o) => /^(no|rel|strict)?atime$/.test(o)) ?? 'relatime';
    s.mounts.push({ quelle: dev, ziel: zp, art: art!, optionen: [ro ? 'ro' : 'rw', ...opt.filter((o) => o !== 'ro' && o !== 'rw' && o !== 'defaults' && o !== zeit), zeit].join(','), verdeckt });
    fs.einhaengungen++;
    return null;
  }
  function aushaengen(w: Welt, ziel: string, root: boolean): string | null {
    const s = w.platten!; const zp = ziel.startsWith('/dev/') || /^(UUID|LABEL)=/.test(ziel) ? (s.mounts.find((m) => m.quelle === nachKennung(w, ziel))?.ziel ?? ziel) : pfad(w, ziel);
    const m = s.mounts.find((x) => x.ziel === zp);
    if (!m) return `umount: ${ziel}: nicht eingehängt.`;
    if (!root) return `umount: ${zp}: nur der Administrator kann umount ausführen.`;
    if (w.cwd === zp || w.cwd.startsWith(zp + '/') || m.virtuell && m.ziel === '/') return `umount: ${zp}: das Ziel wird gerade benutzt.`;
    if (m.virtuell) return `umount: ${zp}: das Ziel wird gerade benutzt.`;
    const t = finden(w, m.quelle)!; const fs = t.p!.fs!;
    fs.dateien = {}; fs.metas = {};
    for (const k of Object.keys(w.fs).filter((k) => k.startsWith(zp + '/'))) { const rel = k.slice(zp.length); fs.dateien[rel] = w.fs[k]; fs.metas[rel] = { ...meta(w, k) }; delete w.fs[k]; delete w.meta![k]; }
    fs.wurzel = { ...meta(w, zp) };
    for (const [k, c] of Object.entries(m.verdeckt?.fs ?? {})) { w.fs[k] = c; w.meta![k] = m.verdeckt!.meta[k]; }
    s.mounts = s.mounts.filter((x) => x !== m);
    return null;
  }
  const fstabZeilen = (w: Welt) => (w.fs['/etc/fstab'] ?? '').split('\n').filter((z) => z.trim() && !z.trim().startsWith('#')).map((z) => z.trim().split(/\s+/));
  b.mount = (w, a, i, root) => {
    const r = mountKern(w, a, i, root);
    if (w.fstabStand === undefined) w.fstabStand = START_FSTAB.get(w) ?? w.fs['/etc/fstab'];
    if (root && a.length && w.fs['/etc/fstab'] !== w.fstabStand) return { ...r, err: [r.err, 'mount: (Hinweis) Ihre Fstab-Datei wurde geändert, aber Systemd nutzt\n       noch die alte Version; verwenden Sie »systemctl daemon-reload«\n       zum Neuladen'].filter(Boolean).join('\n') };
    return r;
  };
  const mountKern: Befehl = (w, a, _i, root) => {
    const s = w.platten!;
    let art: string | undefined; let opt = ''; const rest: string[] = []; let alle = false;
    for (let i = 0; i < a.length; i++) { const x = a[i]; if (x === '-t') art = a[++i]; else if (x === '-o') opt = a[++i] ?? ''; else if (x === '-a') alle = true; else if (x === '-v' || x === '-l') continue; else rest.push(x); }
    if (!rest.length && !alle) {
      const liste = s.mounts.filter((m) => !art || m.art === art).map((m) => `${m.quelle} on ${m.ziel} type ${m.art} (${m.optionen})${a.includes('-l') && finden(w, m.quelle)?.p?.fs?.label ? ` [${finden(w, m.quelle)!.p!.fs!.label}]` : ''}`);
      return ok((art ? '' : PSEUDO + '\n') + liste.join('\n'));
    }
    if (alle) {
      if (!root) return fehler('mount: »mount« darf nur der Administrator verwenden.');
      const err: string[] = [];
      for (const z of fstabZeilen(w)) {
        if (z[1] === 'none' || z[2] === 'swap' || (z[3] ?? '').split(',').includes('noauto')) continue;
        const d = nachKennung(w, z[0]); if (d && s.mounts.some((m) => m.quelle === d)) continue;
        if (s.mounts.some((m) => m.ziel === z[1])) continue;
        const e = einhaengen(w, z[0], z[1], z[2], (z[3] ?? '').replace(/(^|,)defaults(,|$)/, '$1'), root); if (e) err.push(e);
      }
      return err.length ? fehler(err.join('\n'), 32) : ok();
    }
    // remount: Optionen eines eingehängten Dateisystems ändern, etwa ro oder rw
    if (opt.split(',').includes('remount')) {
      if (!root) return fehler('mount: »mount« darf nur der Administrator verwenden.', 32);
      const zp = pfad(w, rest[0]); const m = s.mounts.find((x) => x.ziel === zp || x.quelle === rest[0]);
      if (!m) return fehler(`mount: ${zp}: Einhängepunkt ist noch nicht eingehängt oder es wurden ungültige Optionen angegeben.`, 32);
      const neu = opt.split(',').filter((o) => o !== 'remount');
      const teile = m.optionen.split(',');
      if (neu.includes('ro')) teile[0] = 'ro'; if (neu.includes('rw')) teile[0] = 'rw';
      m.optionen = [...new Set([...teile, ...neu.filter((o) => o !== 'ro' && o !== 'rw')])].join(',');
      return ok();
    }
    let quelle = rest[0]; let ziel = rest[1];
    if (!ziel) {
      const z = fstabZeilen(w).find((f) => f[1] === pfad(w, quelle) || nachKennung(w, f[0]) === nachKennung(w, quelle));
      if (!z) return fehler(`mount: ${quelle}: konnte nicht in /etc/fstab gefunden werden.`, 1);
      quelle = z[0]; ziel = z[1]; art = art ?? z[2]; opt = opt || (z[3] ?? '').replace(/(^|,)defaults(,|$)/, '$1');
    }
    const e = einhaengen(w, quelle, ziel, art, opt, root);
    return e ? fehler(e, 32) : ok();
  };
  b.umount = (w, a, _i, root) => {
    const ziele = a.filter((x) => !x.startsWith('-'));
    if (!ziele.length) return fehler('Aufruf:\n umount [-hV]\n umount -a [Optionen]\n umount [Optionen] <Quelle> | <Verzeichnis>', 1);
    const err = ziele.map((z) => aushaengen(w, z, root)).filter(Boolean) as string[];
    return err.length ? fehler(err.join('\n'), 32) : ok();
  };
  b.findmnt = (w, a) => { const ziel = a.find((x, i) => !x.startsWith('-') && !/^-[otOSTN]$/.test(a[i - 1] ?? '')); const ms = w.platten!.mounts.filter((m) => !ziel || m.ziel === ziel || m.quelle === ziel); if (ziel && !ms.length) return { out: '', err: '', code: 1 }; return ok(['TARGET              SOURCE         FSTYPE OPTIONS', ...ms.map((m) => `${m.ziel.padEnd(19)} ${m.quelle.padEnd(14)} ${m.art.padEnd(6)} ${m.optionen.slice(0, 40)}`)].join('\n')); }

  // ----- fsck, e2fsck, tune2fs, xfs-Werkzeuge -----
  b.fsck = (w, a, i, root) => {
    const dev = a.find((x) => x.startsWith('/dev/') || /^(UUID|LABEL)=/.test(x));
    const t = dev ? finden(w, nachKennung(w, dev) ?? dev) : null;
    if (!t?.p?.fs) return fehler(`fsck from util-linux 2.38.1\nfsck.ext2: Datei oder Verzeichnis nicht gefunden beim Versuch, ${dev ?? ''} zu öffnen`, 8);
    const art = t.p.fs.art;
    if (art === 'xfs') return { out: 'fsck from util-linux 2.38.1\nIf you wish to check the consistency of an XFS filesystem or\nrepair a damaged filesystem, see xfs_repair(8).', code: 0 };
    if (art === 'vfat') return { out: `fsck from util-linux 2.38.1\nfsck.fat 4.2 (2021-01-31)\n${dev}: ${Object.keys(t.p.fs.dateien).length} files, 1024/7495232 clusters`, code: 0 };
    const r = b.e2fsck(w, a, i, root);
    return { ...r, out: 'fsck from util-linux 2.38.1\n' + r.out };
  };
  b.e2fsck = (w, a, _i, root) => {
    const devRoh = a.find((x) => x.startsWith('/dev/') || /^(UUID|LABEL)=/.test(x)) ?? '';
    const dev = nachKennung(w, devRoh) ?? devRoh; const t = finden(w, dev);
    const kurz = a.filter((x) => x.startsWith('-')).join('');
    if (!t?.p?.fs || !t.p.fs.art.startsWith('ext')) return fehler(`e2fsck 1.47.0 (5-Feb-2023)\ne2fsck: Datei oder Verzeichnis nicht gefunden beim Versuch, ${devRoh} zu öffnen`, 8);
    if (!root) return fehler(`e2fsck 1.47.0 (5-Feb-2023)\ne2fsck: Keine Berechtigung beim Versuch, ${dev} zu öffnen\nSie müssen root-Zugriff haben, um das Dateisystem zu prüfen.`, 8);
    const fs = t.p.fs; const kopf = 'e2fsck 1.47.0 (5-Feb-2023)\n';
    if (istEingehaengt(w, dev) && !kurz.includes('n')) return { out: kopf + `${dev} ist eingehängt.\ne2fsck: Abbruch, weil das Weitermachen das Dateisystem beschädigen würde.\n(Erst aushängen, dann prüfen.)`, code: 8 };
    const dateien = 11 + Object.keys(fs.dateien).length; const gesamt = Math.round(fsBytes(t.p) / 16384); const bl = Math.floor(fsBytes(t.p) / 4096); const benutzt = Math.round(belegt(w, t.p) / 4096);
    if (!fs.kaputt && !kurz.includes('f')) return ok(kopf + `${dev}: sauber, ${dateien}/${gesamt} Dateien, ${benutzt}/${bl} Blöcke`);
    const durch = 'Durchgang 1: Inodes, Blöcke und Größen werden geprüft\nDurchgang 2: Verzeichnisstruktur wird geprüft\nDurchgang 3: Verzeichnisverknüpfungen werden geprüft\nDurchgang 4: Referenzzähler werden überprüft\nDurchgang 5: Zusammengefasste Gruppeninformation wird geprüft\n';
    if (fs.kaputt) {
      if (kurz.includes('n')) return { out: kopf + `${dev} wurde nicht ordnungsgemäß ausgehängt, Prüfung erzwungen.\n` + durch.replace('Durchgang 5', 'Freie Blöcke zählen ist falsch für Gruppe #0 (8167, gezählt=8168).\nKorrigieren? nein\n\nDurchgang 5') + `\n${dev}: ********** WARNUNG: Dateisystem hat noch Fehler **********\n\n${dev}: ${dateien}/${gesamt} Dateien, ${benutzt}/${bl} Blöcke`, code: 4 };
      if (!kurz.includes('y') && !kurz.includes('p')) { w.wartet = { standardJa: true, aktion: () => { fs.kaputt = false; return ok(`\n${durch}\n${dev}: ***** DATEISYSTEM WURDE VERÄNDERT *****\n${dev}: ${dateien}/${gesamt} Dateien, ${benutzt}/${bl} Blöcke`); } }; return ok(kopf + `${dev} wurde nicht ordnungsgemäß ausgehängt, Prüfung erzwungen.\nDurchgang 1: Inodes, Blöcke und Größen werden geprüft\nInode 12 hat einen ungültigen Zähler.\nKorrigieren<j>? `); }
      fs.kaputt = false;
      return { out: kopf + `${dev} wurde nicht ordnungsgemäß ausgehängt, Prüfung erzwungen.\n` + durch.replace('Durchgang 5', 'Inode 12 hat einen ungültigen Zähler. Korrigiert.\nDurchgang 5') + `\n${dev}: ***** DATEISYSTEM WURDE VERÄNDERT *****\n${dev}: ${dateien}/${gesamt} Dateien, ${benutzt}/${bl} Blöcke`, code: 1 };
    }
    return ok(kopf + durch + `${dev}: ${dateien}/${gesamt} Dateien (0.0% nicht zusammenhängend), ${benutzt}/${bl} Blöcke`);
  };
  b['fsck.ext4'] = b.e2fsck; b['fsck.ext3'] = b.e2fsck; b['fsck.ext2'] = b.e2fsck;
  b.tune2fs = (w, a, _i, root) => {
    const devRoh = a.find((x) => x.startsWith('/dev/')) ?? ''; const t = finden(w, devRoh);
    if (!t?.p?.fs?.art.startsWith('ext')) return fehler(`tune2fs 1.47.0 (5-Feb-2023)\ntune2fs: Datei oder Verzeichnis nicht gefunden beim Versuch, ${devRoh} zu öffnen\n${devRoh} konnte nicht gefunden werden, kein gültiges Dateisystem`, 1);
    if (!root) return fehler(`tune2fs 1.47.0 (5-Feb-2023)\ntune2fs: Keine Berechtigung beim Versuch, ${devRoh} zu öffnen\n${devRoh} konnte nicht gefunden werden, kein gültiges Dateisystem`, 1);
    const fs = t.p.fs; const out = ['tune2fs 1.47.0 (5-Feb-2023)'];
    const wert = (o: string) => { const i = a.indexOf(o); return i >= 0 ? a[i + 1] : undefined; };
    if (a.includes('-l')) {
      const bl = Math.floor(fsBytes(t.p) / 4096);
      return ok(`tune2fs 1.47.0 (5-Feb-2023)\nFilesystem volume name:   ${fs.label ?? '<none>'}\nLast mounted on:          <not available>\nFilesystem UUID:          ${fs.uuid}\nFilesystem magic number:  0xEF53\nFilesystem revision #:    1 (dynamic)\nFilesystem features:      ${fs.art === 'ext4' ? 'has_journal ext_attr resize_inode dir_index filetype extent 64bit flex_bg sparse_super large_file huge_file dir_nlink extra_isize metadata_csum' : fs.art === 'ext3' ? 'has_journal ext_attr resize_inode dir_index filetype sparse_super large_file' : 'ext_attr resize_inode dir_index filetype sparse_super large_file'}\nFilesystem state:         ${fs.kaputt ? 'not clean' : 'clean'}\nErrors behavior:          Continue\nFilesystem OS type:       Linux\nInode count:              ${Math.round(fsBytes(t.p) / 16384)}\nBlock count:              ${bl}\nReserved block count:     ${Math.round(bl * fs.reserviert / 100)}\nBlock size:               4096\nMount count:              ${fs.einhaengungen}\nMaximum mount count:      ${fs.maxEinhaengungen}\nCheck interval:           ${fs.intervall} (${fs.intervall ? Math.round(fs.intervall / 86400) + ' days' : '<none>'})\nReserved blocks uid:      0 (user root)\nReserved blocks gid:      0 (group root)\nInode size:\t          256\n${fs.art !== 'ext2' ? 'Journal inode:            8\n' : ''}(gekürzt)`);
    }
    if (wert('-L') !== undefined) fs.label = wert('-L');
    if (wert('-c') !== undefined) { fs.maxEinhaengungen = Number(wert('-c')); out.push(`Die maximale Anzahl von Einhängungen wird auf ${fs.maxEinhaengungen} gesezt`); }
    if (wert('-i') !== undefined) { const m = wert('-i')!.match(/^(\d+)([dwm]?)$/); const s = m ? Number(m[1]) * ({ d: 86400, w: 604800, m: 2592000, '': 86400 } as Record<string, number>)[m[2]] : 0; fs.intervall = s; out.push(`Der Abstand zwischen den Prüfläufen wird auf ${s} Sekunden gesetzt`); }
    if (wert('-m') !== undefined) { fs.reserviert = Number(wert('-m')); out.push(`Der prozentuelle Anteil reservierter Blöcke wird auf ${fs.reserviert}% (${Math.round(fsBytes(t.p) / 4096 * fs.reserviert / 100)} Blöcke) gesetzt`); }
    if (a.includes('-j') && fs.art === 'ext2') { fs.art = 'ext3'; out.push('Das Journal-Inode wird erzeugt: erledigt'); }
    return ok(out.join('\n'));
  };
  b.e2label = (w, a, i, root) => a[1] !== undefined ? b.tune2fs(w, ['-L', a[1], a[0]], i, root) : ok(finden(w, a[0] ?? '')?.p?.fs?.label ?? '');
  b.xfs_repair = (w, a, _i, root) => {
    const dev = a.find((x) => x.startsWith('/dev/')) ?? ''; const t = finden(w, dev);
    if (!t?.p?.fs || t.p.fs.art !== 'xfs') return fehler(`xfs_repair: ${dev} ist kein XFS-Dateisystem (Superblock nicht gefunden)`, 1);
    if (!root) return fehler(`xfs_repair: cannot open ${dev}: Permission denied`, 1);
    if (istEingehaengt(w, dev)) return fehler(`xfs_repair: ${dev} contains a mounted filesystem\n\nfatal error -- couldn't initialize XFS library`, 1);
    const nur = a.includes('-n'); const phasen = 'Phase 1 - find and verify superblock...\nPhase 2 - using internal log\n        - zero log...\n        - scan filesystem freespace and inode maps...\nPhase 3 - for each AG...\nPhase 4 - check for duplicate blocks...\nPhase 5 - rebuild AG headers and trees...\nPhase 6 - check inode connectivity...\nPhase 7 - verify and correct link counts...\n';
    if (!nur && t.p.fs.kaputt) t.p.fs.kaputt = false;
    return ok((nur ? phasen.replace('Phase 5 - rebuild AG headers and trees...\n', 'Phase 5 is skipped in no-modify mode.\n') + 'No modify flag set, skipping filesystem flush and exiting.' : phasen + 'done'));
  };
  b.xfs_fsr = (w, a, _i, root) => root ? ok(a.length ? `${a[a.length - 1]} start inode=0` : '/dev/nvme0n1p2: kein XFS-Dateisystem, übersprungen') : fehler('xfs_fsr: Keine Berechtigung');
  b.xfs_db = (w, a, _i, root) => {
    const dev = a.find((x) => x.startsWith('/dev/')) ?? ''; const t = finden(w, dev);
    if (!t?.p?.fs || t.p.fs.art !== 'xfs') return fehler(`xfs_db: ${dev} is not a valid XFS filesystem (unexpected SB magic number 0x00000000)`, 1);
    if (!root) return fehler(`xfs_db: ${dev}: Permission denied`, 1);
    const ci = a.indexOf('-c'); const c = ci >= 0 ? a[ci + 1] : '';
    if (c === 'frag') return ok('actual 42, ideal 40, fragmentation factor 4.76%\nNote, this number is largely meaningless.\nFiles on this filesystem average 1.05 extents per file');
    if (/^sb\b/.test(c) || c === 'print label') return ok(`label = "${t.p.fs.label ?? ''}"`);
    return ok('(Im Simulator kennt xfs_db nur -c frag und -c "sb 0" -c "p label".)');
  };
  b.xfs_admin = (w, a, i, root) => { const li = a.indexOf('-L'); const t = finden(w, a[a.length - 1] ?? ''); if (!root) return fehler('xfs_admin: Keine Berechtigung'); if (!t?.p?.fs) return fehler('xfs_admin: kein Dateisystem'); if (li >= 0) { t.p.fs.label = a[li + 1]; return ok(`writing all SBs\nnew label = "${a[li + 1]}"`); } return ok(`label = "${t.p.fs.label ?? ''}"`); };

  // ----- systemd-Mount-Units -----
  // Der Name der Unit muss zum Einhängepunkt passen: /mnt/daten -> mnt-daten.mount
  const unitName = (ziel: string) => ziel.replace(/^\/+|\/+$/g, '').replace(/-/g, '\\x2d').replace(/\//g, '-') + '.mount';
  b['systemd-escape'] = (_w, a) => { const p = a.includes('-p') || a.includes('--path'); const sfx = a.find((x) => x.startsWith('--suffix='))?.slice(9); const t = a.filter((x) => !x.startsWith('-')).pop() ?? ''; return ok(p ? unitName(t).replace(/\.mount$/, sfx ? '.' + sfx : '') : t.replace(/-/g, '\\x2d').replace(/\//g, '-')); };
  b.__mountunit = (w, a, _i, root) => {
    const s = w.platten!; const [aktion, unit] = a;
    if (aktion === 'daemon-reload') { if (!root) return fehler('Failed to reload daemon: Access denied'); w.mountUnitsGeladen = true; w.fstabStand = w.fs['/etc/fstab']; w.unitStand = Object.fromEntries(Object.keys(w.unitStand ?? {}).map((u) => [u, w.fs['/etc/systemd/system/' + u] ?? ''])); w.verlauf.push({ zeile: '#daemon-reload', code: 0, ausgabe: '' }); return ok(); }
    const datei = ['/etc/systemd/system/' + unit, '/usr/lib/systemd/system/' + unit].find((p) => typeof w.fs[p] === 'string');
    if (aktion === 'status') {
      const m = s.mounts.find((x) => unitName(x.ziel) === unit);
      return { out: `${m ? '●' : '○'} ${unit} - ${unit.replace('.mount', '').replace(/-/g, '/')}
     Loaded: ${datei ? `loaded (${datei}; ${w.mountUnitsAktiv?.includes(unit) ? 'enabled' : 'disabled'}; preset: enabled)` : 'not-found (Reason: Unit ' + unit + ' not found.)'}
     Active: ${m ? `active (mounted) since Mon 2026-11-23 08:41:00 CET` : 'inactive (dead)'}${m ? `
      Where: ${m.ziel}
       What: ${m.quelle}` : ''}`, code: m ? 0 : 3 };
    }
    if (!root) return fehler(`Failed to ${aktion} ${unit}: Access denied
See system logs and 'systemctl status ${unit}' for details.`);
    if (!datei) return fehler(`Failed to ${aktion} ${unit}: Unit ${unit} not found.`);
    // Eine geänderte Unit-Datei liest systemd erst nach daemon-reload neu
    const warnung = w.unitStand?.[unit] !== undefined && w.unitStand[unit] !== w.fs[datei] ? `Warning: The unit file, source configuration file or drop-ins of ${unit} changed on disk. Run 'systemctl daemon-reload' to reload units.` : '';
    if (warnung && aktion !== 'enable') return { out: '', err: warnung, code: 0 };
    (w.unitStand ??= {})[unit] = w.fs[datei]!;
    const text = w.fs[datei]!;
    const feld = (n: string) => text.match(new RegExp('^' + n + '=(.*)$', 'm'))?.[1]?.trim();
    const what = feld('What'); const where = feld('Where'); const type = feld('Type'); const opt = feld('Options') ?? '';
    if (!where || !what) return fehler(`Failed to ${aktion} ${unit}: Unit ${unit} has a bad unit file setting.
See system logs and 'systemctl status ${unit}' for details.`);
    if (unitName(where) !== unit) return fehler(`Failed to ${aktion} ${unit}: Unit ${unit} has a bad unit file setting.
(Im Journal stünde: Where= setting doesn't match unit name. Refusing.)`);
    if (aktion === 'enable' || aktion === 'disable') {
      w.mountUnitsAktiv = (w.mountUnitsAktiv ?? []).filter((x) => x !== unit); if (aktion === 'enable') w.mountUnitsAktiv.push(unit);
      return ok(aktion === 'enable' ? `Created symlink /etc/systemd/system/multi-user.target.wants/${unit} → /etc/systemd/system/${unit}.` : `Removed "/etc/systemd/system/multi-user.target.wants/${unit}".`);
    }
    if (aktion === 'start' || aktion === 'restart') {
      if (s.mounts.some((x) => x.ziel === where)) return ok();
      if (!(where in w.fs)) { w.fs[where] = null; }
      const e = b.mount(w, ['-t', type ?? 'auto', ...(opt ? ['-o', opt.replace(/(^|,)defaults(,|$)/, '$1')] : []), what, where], '', true);
      return e.code ? fehler(`Job for ${unit} failed.
See "systemctl status ${unit}" and "journalctl -xeu ${unit}" for details.`) : ok();
    }
    if (aktion === 'stop') { const e = b.umount(w, [where], '', true); return e.code ? fehler(`Job for ${unit} failed.`) : ok(); }
    return fehler(`(Für Mount-Units kennt der Simulator start, stop, status, enable und disable.)`);
  };

  return b;
}

export function zustandPlatten(w: Welt, s: string): boolean | undefined {
  let m;
  if ((m = s.match(/^tabelle:(\w+)=(gpt|dos|keine)$/))) { const pl = w.platten!.platten.find((p) => p.name === m![1]); return (pl?.label ?? 'keine') === m[2]; }
  if ((m = s.match(/^partitionen:(\w+)=(\d+)$/))) return w.platten!.platten.find((p) => p.name === m![1])?.partitionen.length === Number(m[2]);
  if ((m = s.match(/^partgroesse:(\/dev\/\w+)=([\d.]+)-([\d.]+)G$/))) { const t = finden(w, m[1]); if (!t?.p) return false; const g = fsBytes(t.p) / GIB; return g >= Number(m[2]) - 0.01 && g <= Number(m[3]) + 0.01; }
  if ((m = s.match(/^parttyp:(\/dev\/\w+)~(.+)$/))) { const t = finden(w, m[1]); return !!t?.p && new RegExp(m[2], 'i').test(t.p.typ); }
  if ((m = s.match(/^fs:(\/dev\/\w+)=(\w+)$/))) return finden(w, m[1])?.p?.fs?.art === m[2];
  if ((m = s.match(/^fslabel:(\/dev\/\w+)=(.+)$/))) return finden(w, m[1])?.p?.fs?.label === m[2];
  if ((m = s.match(/^eingehaengt:(\/dev\/\w+)=(.+)$/))) return w.platten!.mounts.some((x) => x.quelle === m![1] && (m![2] === '*' || x.ziel === m![2]));
  if ((m = s.match(/^ausgehaengt:(\/dev\/\w+)$/))) return !w.platten!.mounts.some((x) => x.quelle === m![1]);
  if ((m = s.match(/^mountopt:(\/dev\/\w+)~(.+)$/))) return w.platten!.mounts.some((x) => x.quelle === m![1] && new RegExp(m![2]).test(x.optionen));
  if ((m = s.match(/^swapan:(\/dev\/\w+)$/))) return w.platten!.swaps.includes(m[1]);
  if ((m = s.match(/^fsdatei:(\/dev\/\w+):(.+)$/))) { const t = finden(w, m[1]); if (!t?.p?.fs) return false; const ein = w.platten!.mounts.find((x) => x.quelle === m![1]); return ein ? (ein.ziel + m[2]) in w.fs : m[2] in t.p.fs.dateien; }
  if ((m = s.match(/^maxmount:(\/dev\/\w+)=(-?\d+)$/))) return finden(w, m[1])?.p?.fs?.maxEinhaengungen === Number(m[2]);
  if ((m = s.match(/^reserviert:(\/dev\/\w+)=(\d+)$/))) return finden(w, m[1])?.p?.fs?.reserviert === Number(m[2]);
  if ((m = s.match(/^unitaktiv:(.+)$/))) return !!w.mountUnitsAktiv?.includes(m[1]);
  if ((m = s.match(/^heil:(\/dev\/\w+)$/))) return finden(w, m[1])?.p?.fs?.kaputt === false;
  return undefined;
}
export function plattenKaputt(w: Welt, dev: string) { const t = finden(w, dev); if (t?.p?.fs) t.p.fs.kaputt = true; }
