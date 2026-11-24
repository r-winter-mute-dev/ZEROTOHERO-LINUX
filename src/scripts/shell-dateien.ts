// Rechte, Besitzer und Zeitstempel für das simulierte Dateisystem.
// Nur Typ-Import aus dem Kern, damit kein Import-Kreis entsteht.
import type { Welt } from './shell';

export interface Meta { mode: number; owner: string; group: string; mtime: number; }

export const GRUPPEN_LENA = ['lena', 'cdrom', 'sudo', 'plugdev', 'users'];
// Simulierte Uhr: Montag, 23.11.2026, 08:40 Uhr (MEZ)
export const START_UHR = Date.UTC(2026, 10, 23, 7, 40, 0);
const SYSTEMZEIT = Date.UTC(2026, 10, 20, 9, 0, 0);

const BIN_ORDNER = /^\/(usr\/)?(local\/)?s?bin\/|^\/usr\/games\/|^\/opt\/[^/]+\/bin\//;

function standard(w: Welt, p: string): Meta {
  const dir = w.fs[p] === null;
  const imHome = p === '/home/lena' || p.startsWith('/home/lena/');
  const owner = imHome ? 'lena' : p.startsWith('/home/max') ? 'max' : 'root';
  let group = owner;
  let mode = dir ? 0o755 : 0o644;
  if (dir && p === '/tmp') mode = 0o1777;
  else if (dir && (p === '/root' || p === '/home/lena' || p === '/home/max')) mode = 0o700;
  else if (!dir && BIN_ORDNER.test(p)) mode = 0o755;
  else if (p === '/etc/shadow' || p === '/etc/gshadow') { mode = 0o640; group = 'shadow'; }
  else if (p === '/etc/sudoers') mode = 0o440;
  else if (/^\/etc\/ssh\/ssh_host_.*_key$/.test(p)) mode = 0o600;
  else if (p.startsWith('/var/log/')) { group = 'adm'; mode = 0o640; }
  // SUID- und SGID-Programme wie auf Debian 12
  if (['/usr/bin/passwd', '/usr/bin/sudo', '/usr/bin/su', '/usr/bin/mount', '/usr/bin/umount', '/usr/bin/chsh', '/usr/bin/chfn', '/usr/bin/newgrp', '/usr/bin/gpasswd'].includes(p)) mode = 0o4755;
  if (['/usr/bin/chage', '/usr/bin/expiry'].includes(p)) { mode = 0o2755; group = 'shadow'; }
  if (p === '/usr/bin/crontab') { mode = 0o2755; group = 'crontab'; }
  if (p.startsWith('/proc/') || p.startsWith('/sys/')) mode = dir ? 0o555 : 0o444;
  if (p.startsWith('/dev/')) { mode = 0o660; group = p.startsWith('/dev/tty') ? 'tty' : 'disk'; if (['/dev/null', '/dev/zero', '/dev/random', '/dev/urandom'].includes(p)) mode = 0o666; }
  return { mode, owner, group, mtime: imHome ? SYSTEMZEIT + 2 * 86400000 : SYSTEMZEIT };
}

export function meta(w: Welt, p: string): Meta {
  if (!w.meta) w.meta = {};
  if (!w.meta[p]) w.meta[p] = standard(w, p);
  return w.meta[p];
}

/** Neu angelegte Datei oder Verzeichnis bekommt Besitzer, umask und aktuelle Zeit. */
export function neuMeta(w: Welt, p: string, root: boolean, dir: boolean) {
  if (!w.meta) w.meta = {};
  const basis = dir ? 0o777 : 0o666;
  const eltern = p.slice(0, p.lastIndexOf('/')) || '/';
  const em = p in w.fs || eltern in w.fs ? meta(w, eltern) : null;
  // SGID am Verzeichnis: Neues erbt die Gruppe, neue Verzeichnisse auch das SGID-Bit
  const sgid = !!em && (em.mode & 0o2000) !== 0;
  w.meta[p] = { mode: (basis & ~(w.umask ?? 0o022)) | (sgid && dir ? 0o2000 : 0), owner: root ? 'root' : 'lena', group: sgid ? em!.group : root ? 'root' : 'lena', mtime: w.uhr };
  if (w.inodes) delete w.inodes[p];
}

export function beruehren(w: Welt, p: string) { meta(w, p).mtime = w.uhr; }

/** Darf lena (oder root) die Datei lesen (r), schreiben (w) oder ausführen bzw. betreten (x)? */
export function darf(w: Welt, p: string, recht: 'r' | 'w' | 'x', root: boolean): boolean {
  if (!(p in w.fs)) return false;
  const m = meta(w, p);
  const bit = recht === 'r' ? 4 : recht === 'w' ? 2 : 1;
  if (root) return recht !== 'x' || w.fs[p] === null || (m.mode & 0o111) !== 0;
  const wer = m.owner === 'lena' ? (m.mode >> 6) & 7 : GRUPPEN_LENA.includes(m.group) ? (m.mode >> 3) & 7 : m.mode & 7;
  return (wer & bit) !== 0;
}

/** Darf in diesem Verzeichnis eine Datei angelegt oder gelöscht werden? Beachtet das Sticky-Bit. */
export function darfImOrdner(w: Welt, p: string, root: boolean, loeschen = false): boolean {
  const dir = p.slice(0, p.lastIndexOf('/')) || '/';
  if (!darf(w, dir, 'w', root) || !darf(w, dir, 'x', root)) return false;
  if (loeschen && !root && (meta(w, dir).mode & 0o1000) && p in w.fs && meta(w, p).owner !== 'lena' && meta(w, dir).owner !== 'lena') return false;
  return true;
}

// ---------- Platzhalter für Binärdaten, Archive und Kompression ----------
// Inhalte, die mit \u0007 beginnen, sind keine Textdateien, sondern Platzhalter.

export const BIN = '\u0007BIN:';           // \u0007BIN:<größe>
export const KOMP = '\u0007KOMP:';         // \u0007KOMP:<art>:<originalinhalt>
export const TAR = '\u0007TAR:';           // \u0007TAR:<JSON der Einträge>
export const CPIO = '\u0007CPIO:';

export function groesse(c: string | null | undefined): number {
  if (c == null) return 4096;
  if (c.startsWith('-> ')) return c.length - 3;
  if (c.startsWith(BIN)) return Number(c.slice(BIN.length)) || 0;
  if (c.startsWith(KOMP)) { const [art, ...r] = c.slice(KOMP.length).split(':'); const roh = groesse(r.join(':')); return Math.max(20, Math.round(roh * ({ gz: 0.42, bz2: 0.38, xz: 0.33 } as Record<string, number>)[art])); }
  if (c.startsWith(TAR)) { try { return 10240 * Math.max(1, Math.ceil((JSON.parse(c.slice(TAR.length)) as { c: string | null }[]).reduce((a, e) => a + 512 + groesse(e.c ?? ''), 0) / 10240)); } catch { return 10240; } }
  if (c.startsWith(CPIO)) return 512 * 2;
  return new TextEncoder().encode(c).length;
}

export function istText(c: string | null | undefined) { return typeof c === 'string' && !c.startsWith('\u0007') && !c.startsWith('-> '); }

export function dateityp(w: Welt, p: string): string {
  const c = w.fs[p];
  if (c === null) return 'directory';
  if (c === undefined) return `cannot open \`${p}' (No such file or directory)`;
  if (c.startsWith('-> ')) return `symbolic link to ${c.slice(3)}`;
  if (c.startsWith(KOMP)) { const art = c.slice(KOMP.length).split(':')[0]; return art === 'gz' ? 'gzip compressed data, from Unix' : art === 'bz2' ? 'bzip2 compressed data, block size = 900k' : 'XZ compressed data, checksum CRC64'; }
  if (/[\uF780-\uF7FF]/.test(c)) return 'ISO-8859 text';
  if (c.startsWith(TAR)) return 'POSIX tar archive (GNU)';
  if (c.startsWith(CPIO)) return 'ASCII cpio archive (SVR4 with no CRC)';
  if (c.startsWith(BIN) && /\.jpe?g$/i.test(p)) return 'JPEG image data, JFIF standard 1.01, aspect ratio, density 1x1, segment length 16, baseline, precision 8, 4032x3024, components 3';
  if (c.startsWith(BIN) && /\.png$/i.test(p)) return 'PNG image data, 1920 x 1080, 8-bit/color RGB, non-interlaced';
  if (c.startsWith(BIN) && /\.pdf$/i.test(p)) return 'PDF document, version 1.7, 2 page(s)';
  if (c.startsWith(BIN)) return p.startsWith('/dev/') ? 'block special' : BIN_ORDNER.test(p) ? 'ELF 64-bit LSB pie executable, x86-64, version 1 (SYSV), dynamically linked, interpreter /lib64/ld-linux-x86-64.so.2, for GNU/Linux 3.2.0, stripped' : 'data';
  if (c === '' ) return 'empty';
  if (c.startsWith('(ELF') || /(bin|sbin)\//.test(p) && !c.startsWith('#!')) return 'ELF 64-bit LSB pie executable, x86-64, version 1 (SYSV), dynamically linked, interpreter /lib64/ld-linux-x86-64.so.2, stripped';
  if (c.startsWith('#!/bin/bash') || c.startsWith('#!/usr/bin/env bash')) return 'Bourne-Again shell script, UTF-8 Unicode text executable';
  if (c.startsWith('#!/bin/sh')) return 'POSIX shell script, ASCII text executable';
  if (c.startsWith('#!/usr/bin/python3') || c.startsWith('#!/usr/bin/env python3')) return 'Python script, ASCII text executable';
  const crlf = c.includes('\r\n') ? ', with CRLF line terminators' : '';
  if (/[^\x00-\x7f]/.test(c)) return 'Unicode text, UTF-8 text' + crlf;
  return 'ASCII text' + crlf;
}

// ---------- Darstellung ----------

export function rechteText(w: Welt, p: string): string {
  const m = meta(w, p); const c = w.fs[p];
  const typ = c === null ? 'd' : typeof c === 'string' && c.startsWith('-> ') ? 'l' : p.startsWith('/dev/') && c !== null ? (p.match(/tty|null|zero|random/) ? 'c' : 'b') : '-';
  const r = (b: number, s: boolean, sZeichen: string) => `${b & 4 ? 'r' : '-'}${b & 2 ? 'w' : '-'}${s ? (b & 1 ? sZeichen : sZeichen.toUpperCase()) : (b & 1 ? 'x' : '-')}`;
  const mode = typ === 'l' ? 0o777 : m.mode;
  return typ + r(mode >> 6, !!(mode & 0o4000), 's') + r(mode >> 3, !!(mode & 0o2000), 's') + r(mode, !!(mode & 0o1000), 't');
}

const MONATE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
export function zeitText(ms: number, jetzt = ms): string {
  const d = new Date(ms + 3600000); // MEZ
  // Wie GNU ls: Älter als ein halbes Jahr oder in der Zukunft, dann Jahr statt Uhrzeit
  const alt = jetzt - ms > 182.5 * 86400000 || ms - jetzt > 3600000;
  return `${String(d.getUTCDate()).padStart(2)}. ${MONATE[d.getUTCMonth()]} ${alt ? ' ' + d.getUTCFullYear() : String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0')}`;
}
export function datumText(ms: number): string {
  const d = new Date(ms + 3600000);
  const tage = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  return `${tage[d.getUTCDay()]} ${d.getUTCDate()}. ${MONATE[d.getUTCMonth()]} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')} CET ${d.getUTCFullYear()}`;
}

export function menschlich(n: number): string {
  if (n < 1024) return String(n);
  const e = ['K', 'M', 'G', 'T']; let i = -1; let x = n;
  do { x /= 1024; i++; } while (x >= 1024 && i < e.length - 1);
  return (x < 10 ? x.toFixed(1).replace('.', ',') : String(Math.round(x))) + e[i];
}

// ---------- Prüfsummen (echte Algorithmen, damit Ergebnisse mit echten Systemen übereinstimmen) ----------

function utf8(s: string): number[] { return [...new TextEncoder().encode(s)]; }

export function md5(text: string): string {
  const b = utf8(text); const bitLen = b.length * 8;
  b.push(0x80); while (b.length % 64 !== 56) b.push(0);
  for (let i = 0; i < 8; i++) b.push(i < 4 ? (bitLen >>> (8 * i)) & 0xff : 0);
  const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  let [a0, b0, c0, d0] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  for (let o = 0; o < b.length; o += 64) {
    const M = Array.from({ length: 16 }, (_, i) => b[o + 4 * i] | (b[o + 4 * i + 1] << 8) | (b[o + 4 * i + 2] << 16) | (b[o + 4 * i + 3] << 24));
    let [A, B, C, D] = [a0, b0, c0, d0];
    for (let i = 0; i < 64; i++) {
      let F: number, g: number;
      if (i < 16) { F = (B & C) | (~B & D); g = i; } else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; } else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; } else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      const tmp = D; D = C; C = B;
      const x = (A + F + K[i] + M[g]) | 0; const s = S[(i >> 4) * 4 + (i % 4)];
      B = (B + ((x << s) | (x >>> (32 - s)))) | 0; A = tmp;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }
  return [a0, b0, c0, d0].map((v) => [0, 8, 16, 24].map((s) => ((v >>> s) & 0xff).toString(16).padStart(2, '0')).join('')).join('');
}

export function sha256(text: string): string {
  const b = utf8(text); const bitLen = b.length * 8;
  b.push(0x80); while (b.length % 64 !== 56) b.push(0);
  for (let i = 7; i >= 0; i--) b.push(i >= 4 ? 0 : (bitLen >>> (8 * i)) & 0xff);
  const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < b.length; o += 64) {
    const W = new Array<number>(64);
    for (let i = 0; i < 16; i++) W[i] = (b[o + 4 * i] << 24) | (b[o + 4 * i + 1] << 16) | (b[o + 4 * i + 2] << 8) | b[o + 4 * i + 3];
    for (let i = 16; i < 64; i++) { const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3); const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10); W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0; }
    let [a, bb, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25); const ch = (e & f) ^ (~e & g); const t1 = (h + S1 + ch + K[i] + W[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22); const mj = (a & bb) ^ (a & c) ^ (bb & c); const t2 = (S0 + mj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
    }
    [a, bb, c, d, e, f, g, h].forEach((v, i) => (H[i] = (H[i] + v) | 0));
  }
  return H.map((v) => (v >>> 0).toString(16).padStart(8, '0')).join('');
}

export function sha512(text: string): string {
  const b = utf8(text); const bitLen = BigInt(b.length * 8);
  b.push(0x80); while (b.length % 128 !== 112) b.push(0);
  for (let i = 15; i >= 0; i--) b.push(Number((bitLen >> BigInt(8 * i)) & 0xffn));
  const M64 = (1n << 64n) - 1n;
  const K = ['428a2f98d728ae22', '7137449123ef65cd', 'b5c0fbcfec4d3b2f', 'e9b5dba58189dbbc', '3956c25bf348b538', '59f111f1b605d019', '923f82a4af194f9b', 'ab1c5ed5da6d8118', 'd807aa98a3030242', '12835b0145706fbe', '243185be4ee4b28c', '550c7dc3d5ffb4e2', '72be5d74f27b896f', '80deb1fe3b1696b1', '9bdc06a725c71235', 'c19bf174cf692694', 'e49b69c19ef14ad2', 'efbe4786384f25e3', '0fc19dc68b8cd5b5', '240ca1cc77ac9c65', '2de92c6f592b0275', '4a7484aa6ea6e483', '5cb0a9dcbd41fbd4', '76f988da831153b5', '983e5152ee66dfab', 'a831c66d2db43210', 'b00327c898fb213f', 'bf597fc7beef0ee4', 'c6e00bf33da88fc2', 'd5a79147930aa725', '06ca6351e003826f', '142929670a0e6e70', '27b70a8546d22ffc', '2e1b21385c26c926', '4d2c6dfc5ac42aed', '53380d139d95b3df', '650a73548baf63de', '766a0abb3c77b2a8', '81c2c92e47edaee6', '92722c851482353b', 'a2bfe8a14cf10364', 'a81a664bbc423001', 'c24b8b70d0f89791', 'c76c51a30654be30', 'd192e819d6ef5218', 'd69906245565a910', 'f40e35855771202a', '106aa07032bbd1b8', '19a4c116b8d2d0c8', '1e376c085141ab53', '2748774cdf8eeb99', '34b0bcb5e19b48a8', '391c0cb3c5c95a63', '4ed8aa4ae3418acb', '5b9cca4f7763e373', '682e6ff3d6b2b8a3', '748f82ee5defb2fc', '78a5636f43172f60', '84c87814a1f0ab72', '8cc702081a6439ec', '90befffa23631e28', 'a4506cebde82bde9', 'bef9a3f7b2c67915', 'c67178f2e372532b', 'ca273eceea26619c', 'd186b8c721c0c207', 'eada7dd6cde0eb1e', 'f57d4f7fee6ed178', '06f067aa72176fba', '0a637dc5a2c898a6', '113f9804bef90dae', '1b710b35131c471b', '28db77f523047d84', '32caab7b40c72493', '3c9ebe0a15c9bebc', '431d67c49c100d4c', '4cc5d4becb3e42b6', '597f299cfc657e2a', '5fcb6fab3ad6faec', '6c44198c4a475817'].map((x) => BigInt('0x' + x));
  const H = ['6a09e667f3bcc908', 'bb67ae8584caa73b', '3c6ef372fe94f82b', 'a54ff53a5f1d36f1', '510e527fade682d1', '9b05688c2b3e6c1f', '1f83d9abfb41bd6b', '5be0cd19137e2179'].map((x) => BigInt('0x' + x));
  const rotr = (x: bigint, n: bigint) => ((x >> n) | (x << (64n - n))) & M64;
  for (let o = 0; o < b.length; o += 128) {
    const W: bigint[] = [];
    for (let i = 0; i < 16; i++) { let v = 0n; for (let j = 0; j < 8; j++) v = (v << 8n) | BigInt(b[o + 8 * i + j]); W.push(v); }
    for (let i = 16; i < 80; i++) { const s0 = rotr(W[i - 15], 1n) ^ rotr(W[i - 15], 8n) ^ (W[i - 15] >> 7n); const s1 = rotr(W[i - 2], 19n) ^ rotr(W[i - 2], 61n) ^ (W[i - 2] >> 6n); W.push((W[i - 16] + s0 + W[i - 7] + s1) & M64); }
    let [a, bb, c, d, e, f, g, h] = H;
    for (let i = 0; i < 80; i++) {
      const S1 = rotr(e, 14n) ^ rotr(e, 18n) ^ rotr(e, 41n); const ch = (e & f) ^ (~e & M64 & g); const t1 = (h + S1 + ch + K[i] + W[i]) & M64;
      const S0 = rotr(a, 28n) ^ rotr(a, 34n) ^ rotr(a, 39n); const mj = (a & bb) ^ (a & c) ^ (bb & c); const t2 = (S0 + mj) & M64;
      h = g; g = f; f = e; e = (d + t1) & M64; d = c; c = bb; bb = a; a = (t1 + t2) & M64;
    }
    [a, bb, c, d, e, f, g, h].forEach((v, i) => (H[i] = (H[i] + v) & M64));
  }
  return H.map((v) => v.toString(16).padStart(16, '0')).join('');
}
