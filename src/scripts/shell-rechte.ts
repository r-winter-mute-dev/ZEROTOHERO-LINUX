// Rechte, Besitz, Links und Dateisuche für den Simulator (Lernziele 104.5 bis 104.7).
// Meldungen nach coreutils, glibc und plocate von Debian 12 mit LANG=de_DE.UTF-8.
import type { Welt } from './shell';
import { GRUPPEN_LENA, meta, groesse } from './shell-dateien';

export interface Ergebnis { out: string; code: number; err?: string; }
type Befehl = (w: Welt, args: string[], stdin: string, root: boolean) => Ergebnis;
export interface RechteHelfer {
  ok: (out?: string) => Ergebnis;
  fehler: (msg: string, code?: number) => Ergebnis;
  pfad: (w: Welt, p: string) => string;
  kinder: (w: Welt, dir: string) => string[];
}

// ---------- Inodes und harte Links ----------
// Jeder Pfad hat eine Inode-Nummer. Harte Links teilen sich Nummer, Inhalt und Metadaten.
export function inode(w: Welt, p: string): number {
  if (!w.inodes) w.inodes = {};
  if (w.inodes[p] === undefined) { let h = 0; for (const c of p) h = (h * 31 + c.charCodeAt(0)) >>> 0; w.inodes[p] = p === '/' ? 2 : 131072 + (h % 3900000); }
  return w.inodes[p];
}
export function linkZahl(w: Welt, p: string): number {
  if (w.fs[p] === null) return 2 + Object.keys(w.fs).filter((k) => k.startsWith(p === '/' ? '/' : p + '/') && !k.slice(p === '/' ? 1 : p.length + 1).includes('/') && w.fs[k] === null).length;
  const n = inode(w, p); return Object.keys(w.inodes ?? {}).filter((k) => w.inodes![k] === n && k in w.fs).length || 1;
}
/** Nach jedem Befehl: Änderungen an einem harten Link auf alle anderen übertragen. */
export function linksAbgleichen(w: Welt) {
  if (!w.hardlinkInhalt) return;
  const gruppen: Record<number, string[]> = {};
  for (const [p, n] of Object.entries(w.inodes ?? {})) if (p in w.fs && w.hardlinkInhalt[n] !== undefined) (gruppen[n] ??= []).push(p);
  for (const [nStr, pfade] of Object.entries(gruppen)) {
    const n = Number(nStr); const alt = w.hardlinkInhalt[n];
    const geaendert = pfade.find((p) => w.fs[p] !== alt);
    if (geaendert !== undefined) { const neu = w.fs[geaendert]; for (const p of pfade) w.fs[p] = neu; w.hardlinkInhalt[n] = neu as string; }
    const m = w.meta?.[pfade[0]]; if (m) for (const p of pfade) w.meta![p] = m;
  }
}

/** Liegt der Pfad auf einem nur lesbar eingehängten Dateisystem? */
export function nurLesbar(w: Welt, p: string): boolean {
  const m = w.platten?.mounts.filter((x) => p === x.ziel || p.startsWith(x.ziel === '/' ? '/' : x.ziel + '/')).sort((a, b) => b.ziel.length - a.ziel.length)[0];
  return !!m && m.optionen.split(',')[0] === 'ro';
}
export function geraetVon(w: Welt, p: string): string {
  return w.platten?.mounts.filter((x) => p === x.ziel || p.startsWith(x.ziel === '/' ? '/' : x.ziel + '/')).sort((a, b) => b.ziel.length - a.ziel.length)[0]?.quelle ?? '/';
}

const benutzerDa = (w: Welt, u: string) => u === 'root' || new RegExp(`^${u}:`, 'm').test(w.fs['/etc/passwd'] ?? '') || /^\d+$/.test(u);
const gruppeDa = (w: Welt, g: string) => g === 'root' || new RegExp(`^${g}:`, 'm').test(w.fs['/etc/group'] ?? '') || /^\d+$/.test(g);
const hauptgruppe = (w: Welt, u: string) => { const z = (w.fs['/etc/passwd'] ?? '').split('\n').find((l) => l.startsWith(u + ':')); const gid = z?.split(':')[3]; return (w.fs['/etc/group'] ?? '').split('\n').find((l) => l.split(':')[2] === gid)?.split(':')[0] ?? u; };

// ---------- chmod ----------
function neuerModus(alt: number, spez: string, dir: boolean, umask: number): number | null {
  if (/^[0-7]{1,5}$/.test(spez)) { const n = parseInt(spez, 8); return dir && spez.length <= 4 ? (alt & 0o6000) | n : n; }   // Verzeichnisse behalten SUID/SGID bei Zahlen (GNU)
  let m = alt;
  for (const teil of spez.split(',')) {
    const t = teil.match(/^([ugoa]*)([-+=])([rwxXst]*|[ugo])$/);
    if (!t) return null;
    const wer = t[1] || 'a'; const op = t[2]; let rechte = t[3];
    if (/^[ugo]$/.test(rechte)) { const quelle = { u: (m >> 6) & 7, g: (m >> 3) & 7, o: m & 7 }[rechte as 'u']; rechte = (quelle & 4 ? 'r' : '') + (quelle & 2 ? 'w' : '') + (quelle & 1 ? 'x' : ''); }
    let bits = 0; let spezial = 0;
    for (const r of rechte) {
      const b = r === 'r' ? 4 : r === 'w' ? 2 : r === 'x' || (r === 'X' && (dir || (alt & 0o111))) ? 1 : 0;
      if (wer.includes('u') || wer.includes('a')) bits |= b << 6;
      if (wer.includes('g') || wer.includes('a')) bits |= b << 3;
      if (wer.includes('o') || wer.includes('a')) bits |= b;
      if (r === 's') { if (wer.includes('u') || wer.includes('a')) spezial |= 0o4000; if (wer.includes('g') || wer.includes('a')) spezial |= 0o2000; }
      if (r === 't') spezial |= 0o1000;
    }
    // ohne u/g/o/a wirkt die umask: chmod +w setzt nur, was die umask erlaubt
    if (!t[1] && op !== '=') bits &= ~umask;
    const maske = (wer.includes('u') || wer.includes('a') ? 0o4700 : 0) | (wer.includes('g') || wer.includes('a') ? 0o2070 : 0) | (wer.includes('o') || wer.includes('a') ? 0o1007 : 0);
    if (op === '+') m |= bits | spezial;
    else if (op === '-') m &= ~(bits | spezial);
    else m = (m & ~(maske & ~(dir ? 0o2000 : 0))) | bits | spezial;
  }
  return m;
}
const rwx = (m: number) => { const r = (b: number, s: boolean, z: string) => `${b & 4 ? 'r' : '-'}${b & 2 ? 'w' : '-'}${s ? (b & 1 ? z : z.toUpperCase()) : b & 1 ? 'x' : '-'}`; return r(m >> 6, !!(m & 0o4000), 's') + r(m >> 3, !!(m & 0o2000), 's') + r(m, !!(m & 0o1000), 't'); };

export function rechteBefehle(h: RechteHelfer): Record<string, Befehl> {
  const { ok, fehler, pfad } = h;
  const b: Record<string, Befehl> = {};
  const rekursiv = (w: Welt, p: string, r: boolean) => r && w.fs[p] === null ? Object.keys(w.fs).filter((k) => k === p || k.startsWith(p + '/')).sort() : [p];

  b.chmod = (w, a, _i, root) => {
    const R = a.some((x) => /^-\w*R/.test(x)); const v = a.some((x) => /^-\w*v/.test(x)); const c = a.some((x) => /^-\w*c/.test(x));
    const rest = a.filter((x) => !/^-[Rvcf]+$/.test(x) && x !== '--recursive' && x !== '--verbose');
    const [spez, ...dateien] = rest;
    if (!spez) return fehler('chmod: Fehlender Operand\n„chmod --help“ liefert weitere Informationen.');
    if (!dateien.length) return fehler(`chmod: fehlender Operand nach '${spez}'\n„chmod --help“ liefert weitere Informationen.`);
    const out: string[] = []; const err: string[] = [];
    for (const d of dateien) {
      const p0 = pfad(w, d);
      if (!(p0 in w.fs)) { err.push(`chmod: Zugriff auf '${d}' nicht möglich: Datei oder Verzeichnis nicht gefunden`); continue; }
      for (const p of rekursiv(w, p0, R)) {
        const m = meta(w, p); const anzeige = d + p.slice(p0.length);
        if (!root && m.owner !== 'lena') { err.push(`chmod: Beim Setzen der Zugriffsrechte für '${anzeige}': Vorgang nicht zulässig`); continue; }
        if (nurLesbar(w, p)) { err.push(`chmod: Beim Setzen der Zugriffsrechte für '${anzeige}': Das Dateisystem ist nur lesbar`); continue; }
        if (typeof w.fs[p] === 'string' && w.fs[p]!.startsWith('-> ')) continue;
        const neu = neuerModus(m.mode, spez, w.fs[p] === null, w.umask ?? 0o022);
        if (neu === null) return fehler(`chmod: Ungültiger Modus: '${spez}'\n„chmod --help“ liefert weitere Informationen.`);
        // Ein normaler Benutzer kann SGID nur für Gruppen setzen, in denen er ist
        const ergebnis = !root && (neu & 0o2000) && !GRUPPEN_LENA.includes(m.group) && w.fs[p] !== null ? neu & ~0o2000 : neu;
        if ((v || (c && ergebnis !== m.mode))) out.push(ergebnis !== m.mode ? `der Modus von '${anzeige}' wurde von ${m.mode.toString(8).padStart(4, '0')} (${rwx(m.mode)}) in ${ergebnis.toString(8).padStart(4, '0')} (${rwx(ergebnis)}) geändert` : `Der Modus von '${anzeige}' wurde als ${m.mode.toString(8).padStart(4, '0')} (${rwx(m.mode)}) beibehalten`);
        m.mode = ergebnis;
      }
    }
    return { out: out.join('\n'), err: err.join('\n') || undefined, code: err.length ? 1 : 0 };
  };

  function besitz(w: Welt, a: string[], root: boolean, nurGruppe: boolean): Ergebnis {
    const name = nurGruppe ? 'chgrp' : 'chown';
    const R = a.some((x) => /^-\w*R/.test(x)); const v = a.some((x) => /^-\w*v/.test(x));
    const rest = a.filter((x) => !/^-[Rvch]+$/.test(x));
    const [spez, ...dateien] = rest;
    if (!spez) return fehler(`${name}: Fehlender Operand\n„${name} --help“ liefert weitere Informationen.`);
    if (!dateien.length) return fehler(`${name}: fehlender Operand nach '${spez}'\n„${name} --help“ liefert weitere Informationen.`);
    let user: string | undefined; let gruppe: string | undefined;
    if (nurGruppe) gruppe = spez;
    else { const m = spez.match(/^([^:.]*)(?:[:.](.*))?$/)!; user = m[1] || undefined; gruppe = m[2]; if (m[2] === '' && user) gruppe = hauptgruppe(w, user); }
    if (user && !benutzerDa(w, user)) return fehler(`chown: ungültiger Benutzer: '${spez}'`);
    if (gruppe && !gruppeDa(w, gruppe)) return fehler(nurGruppe ? `chgrp: ungültige Gruppe: '${gruppe}'` : `chown: ungültige Gruppe: '${spez}'`);
    const out: string[] = []; const err: string[] = [];
    for (const d of dateien) {
      const p0 = pfad(w, d);
      if (!(p0 in w.fs)) { err.push(`${name}: Zugriff auf '${d}' nicht möglich: Datei oder Verzeichnis nicht gefunden`); continue; }
      for (const p of rekursiv(w, p0, R)) {
        const m = meta(w, p); const anzeige = d + p.slice(p0.length);
        // Den Besitzer ändert nur root. Die Gruppe darf der Besitzer auf eine eigene Gruppe setzen.
        const erlaubt = root || (!user && m.owner === 'lena' && GRUPPEN_LENA.includes(gruppe!)) || (user === m.owner && !gruppe);
        if (!erlaubt) { err.push(user && user !== m.owner ? `chown: der Eigentümer von '${anzeige}' wird geändert: Vorgang nicht zulässig` : `${name}: die Gruppe von '${anzeige}' wird geändert: Vorgang nicht zulässig`); continue; }
        const alt = `${m.owner}:${m.group}`;
        if (user) m.owner = user;
        if (gruppe) m.group = gruppe;
        // Wechselt der Besitzer, löscht der Kernel SUID und SGID bei Dateien
        if (user && w.fs[p] !== null) m.mode &= ~0o6000;
        if (v) out.push(nurGruppe ? `die Gruppe von '${anzeige}' wurde von ${alt.split(':')[1]} in ${m.group} geändert` : `der Eigentümer von '${anzeige}' wurde von ${alt} in ${m.owner}:${m.group} geändert`);
      }
    }
    return { out: out.join('\n'), err: err.join('\n') || undefined, code: err.length ? 1 : 0 };
  }
  b.chown = (w, a, _i, root) => besitz(w, a, root, false);
  b.chgrp = (w, a, _i, root) => besitz(w, a, root, true);

  // ---------- ln ----------
  b.ln = (w, a, _i, root) => {
    const s = a.some((x) => /^-\w*s/.test(x)); const f = a.some((x) => /^-\w*f/.test(x)); const v = a.some((x) => /^-\w*v/.test(x));
    const rest = a.filter((x) => !/^-[sfvn]+$/.test(x));
    if (!rest.length) return fehler('ln: Fehlender Dateioperand\n„ln --help“ liefert weitere Informationen.');
    const ziel = rest[0]; let name = rest[1] ?? ziel.split('/').pop()!;
    let np = pfad(w, name);
    if (w.fs[np] === null) { name = (name.replace(/\/$/, '') + '/' + ziel.split('/').pop()); np = pfad(w, name); }
    const dir = np.slice(0, np.lastIndexOf('/')) || '/';
    if (!(dir in w.fs)) return fehler(`ln: Die ${s ? 'symbolische' : 'harte'} Verknüpfung '${name}' konnte nicht angelegt werden: Datei oder Verzeichnis nicht gefunden`);
    if (np in w.fs && !f) return fehler(s ? `ln: die symbolische Verknüpfung '${name}' konnte nicht angelegt werden: Die Datei existiert bereits` : `ln: Die harte Verknüpfung '${name}' konnte nicht angelegt werden: Die Datei existiert bereits`);
    const m = meta(w, dir);
    if (!root && !(m.owner === 'lena' ? m.mode & 0o200 : GRUPPEN_LENA.includes(m.group) ? m.mode & 0o020 : m.mode & 0o002)) return fehler(`ln: Die ${s ? 'symbolische' : 'harte'} Verknüpfung '${name}' konnte nicht angelegt werden: Keine Berechtigung`);
    if (s) {
      // Ein symbolischer Link speichert nur den Text des Ziels. Das Ziel muss nicht existieren.
      w.fs[np] = '-> ' + ziel; w.meta![np] = { mode: 0o777, owner: root ? 'root' : 'lena', group: root ? 'root' : 'lena', mtime: w.uhr };
      delete w.inodes?.[np];
      return ok(v ? `'${name}' -> '${ziel}'` : '');
    }
    const zp = pfad(w, ziel);
    if (!(zp in w.fs)) return fehler(`ln: Zugriff auf '${ziel}' nicht möglich: Datei oder Verzeichnis nicht gefunden`);
    if (w.fs[zp] === null) return fehler(`ln: ${ziel}: harte Verknüpfung für Verzeichnisse ist nicht erlaubt`);
    if (geraetVon(w, zp) !== geraetVon(w, np)) return fehler(`ln: Die harte Verknüpfung '${name}' => '${ziel}' konnte nicht angelegt werden: Ungültiger Link über Gerätegrenzen hinweg`);
    const n = inode(w, zp);
    w.fs[np] = w.fs[zp]; if (!w.inodes) w.inodes = {}; w.inodes[np] = n;
    meta(w, zp); w.meta![np] = w.meta![zp];
    if (!w.hardlinkInhalt) w.hardlinkInhalt = {};
    w.hardlinkInhalt[n] = w.fs[zp] as string;
    return ok(v ? `'${name}' => '${ziel}'` : '');
  };
  b.readlink = (w, a) => {
    const f = a.includes('-f') || a.includes('-e'); const d = a.find((x) => !x.startsWith('-')) ?? '';
    const p = pfad(w, d); const c = w.fs[p];
    if (f) { let q = p; for (let i = 0; i < 40 && typeof w.fs[q] === 'string' && w.fs[q]!.startsWith('-> '); i++) { const t = w.fs[q]!.slice(3); q = t.startsWith('/') ? pfad(w, t) : pfad(w, (q.slice(0, q.lastIndexOf('/')) || '/') + '/' + t); } return ok(q); }
    return typeof c === 'string' && c.startsWith('-> ') ? ok(c.slice(3)) : { out: '', code: 1 };
  };
  b.unlink = (w, a, _i, root) => { const p = pfad(w, a[0] ?? ''); if (!(p in w.fs)) return fehler(`unlink: '${a[0] ?? ''}' kann nicht gelöscht werden: Datei oder Verzeichnis nicht gefunden`); if (w.fs[p] === null) return fehler(`unlink: '${a[0]}' kann nicht gelöscht werden: Ist ein Verzeichnis`); void root; delete w.fs[p]; return ok(); };
  b.stat = (w, a) => {
    const out: string[] = []; const err: string[] = [];
    for (const d of a.filter((x) => !x.startsWith('-'))) {
      const p = pfad(w, d); if (!(p in w.fs)) { err.push(`stat: '${d}' kann nicht statusermittelt werden: Datei oder Verzeichnis nicht gefunden`); continue; }
      const m = meta(w, p); const c = w.fs[p]; const link = typeof c === 'string' && c.startsWith('-> ');
      const typ = c === null ? 'Verzeichnis' : link ? 'symbolische Verknüpfung' : groesse(c) ? 'reguläre Datei' : 'reguläre leere Datei';
      const zeit = new Date(m.mtime + 3600000).toISOString().replace('T', ' ').slice(0, 19) + '.000000000 +0100';
      out.push(`  Datei: ${d}${link ? ' -> ' + c!.slice(3) : ''}\n  Größe: ${groesse(c)}\tBlöcke: ${Math.ceil(groesse(c) / 4096) * 8}\tEA Block: 4096   ${typ}\nGerät: ${geraetVon(w, p) === '/dev/sdb1' ? '8/17' : '259/2'}\tInode: ${inode(w, p)}\tVerknüpfungen: ${linkZahl(w, p)}\nZugriff: (${(link ? 0o777 : m.mode).toString(8).padStart(4, '0')}/${(c === null ? 'd' : link ? 'l' : '-') + rwx(link ? 0o777 : m.mode)})  Uid: (${String(m.owner === 'root' ? 0 : m.owner === 'lena' ? 1000 : 1001).padStart(5)}/${m.owner.padStart(8)})   Gid: (${String(m.group === 'root' ? 0 : m.group === 'lena' ? 1000 : 1001).padStart(5)}/${m.group.padStart(8)})\nZugriff    : ${zeit}\nModifiziert: ${zeit}\nGeändert   : ${zeit}\n Geburt    : ${zeit}`);
    }
    return { out: out.join('\n'), err: err.join('\n') || undefined, code: err.length ? 1 : 0 };
  };

  // ---------- locate und updatedb (plocate) ----------
  void 0;
  const PRUNE = (w: Welt) => ((w.fs['/etc/updatedb.conf'] ?? '').match(/^PRUNEPATHS="([^"]*)"/m)?.[1] ?? '/tmp /var/spool /media').split(/\s+/).filter(Boolean);
  b.updatedb = (w, _a, _i, root) => {
    if (!root) return fehler('updatedb: /var/lib/plocate/plocate.db: Keine Berechtigung\n(updatedb läuft auf Debian als root, normalerweise einmal am Tag über einen systemd-Timer.)');
    const prune = PRUNE(w);
    w.locateDb = Object.keys(w.fs).filter((p) => !prune.some((x) => p === x || p.startsWith(x + '/'))).sort();
    w.verlauf.push({ zeile: '#updatedb', code: 0, ausgabe: '' });
    return ok();
  };
  b.locate = (w, a, _i, root) => {
    const i = a.includes('-i'); const c = a.includes('-c'); const basis = a.includes('-b'); const nl = a.find((x) => /^-?-?l(imit)?=?\d+$/.test(x)); void nl;
    const muster = a.filter((x) => !x.startsWith('-'));
    if (!muster.length) return fehler('plocate: no pattern to search for specified');
    if (!w.locateDb) { const prune = PRUNE(w); w.locateDb = Object.keys(w.fs).filter((p) => !prune.some((x) => p === x || p.startsWith(x + '/'))).sort(); }
    const pruefe = (p: string, m: string) => {
      const ziel = basis ? p.split('/').pop()! : p;
      if (/[*?[]/.test(m)) { const re = new RegExp('^' + m.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', i ? 'i' : ''); return re.test(ziel); }
      return i ? ziel.toLowerCase().includes(m.toLowerCase()) : ziel.includes(m);
    };
    // plocate zeigt nur Treffer, deren Verzeichnisse der Benutzer betreten darf
    const sichtbar = (p: string) => root || p.split('/').slice(1, -1).every((_, k, arr) => { const d = '/' + arr.slice(0, k + 1).join('/'); const m = meta(w, d); return !(d in w.fs) || (m.owner === 'lena' ? m.mode & 0o100 : GRUPPEN_LENA.includes(m.group) ? m.mode & 0o010 : m.mode & 0o001); });
    const t = w.locateDb.filter((p) => muster.every((m) => pruefe(p, m)) && sichtbar(p));
    if (c) return ok(String(t.length));
    return { out: t.join('\n'), code: t.length ? 0 : 1 };
  };
  b.plocate = b.locate;
  return b;
}

/** Die Datenbank von locate: Stand vom letzten nächtlichen updatedb, also beim Start der Welt. */
export function locateDbAnlegen(w: Welt) {
  const prune = ((w.fs['/etc/updatedb.conf'] ?? '').match(/^PRUNEPATHS="([^"]*)"/m)?.[1] ?? '/tmp /var/spool /media').split(/\s+/).filter(Boolean);
  w.locateDb = Object.keys(w.fs).filter((p) => !prune.some((x) => p === x || p.startsWith(x + '/'))).sort();
}

export function zustandRechte(w: Welt, s: string, pfad: (w: Welt, p: string) => string): boolean | undefined {
  let m;
  if ((m = s.match(/^besitzer:(.+)=([\w-]+)(?::([\w-]+))?$/))) { const p = pfad(w, m[1]); if (!(p in w.fs)) return false; const x = meta(w, p); return x.owner === m[2] && (!m[3] || x.group === m[3]); }
  if ((m = s.match(/^gruppe:(.+)=([\w-]+)$/))) { const p = pfad(w, m[1]); return p in w.fs && meta(w, p).group === m[2]; }
  if ((m = s.match(/^symlink:(.+)=(.+)$/))) { const c = w.fs[pfad(w, m[1])]; return typeof c === 'string' && c === '-> ' + m[2]; }
  if ((m = s.match(/^hardlink:(.+)=(.+)$/))) { const a = pfad(w, m[1]); const b = pfad(w, m[2]); return a in w.fs && b in w.fs && a !== b && w.inodes?.[a] !== undefined && w.inodes[a] === w.inodes[b]; }
  if (s === 'updatedb') return w.verlauf.some((v) => v.zeile === '#updatedb');
  return undefined;
}
