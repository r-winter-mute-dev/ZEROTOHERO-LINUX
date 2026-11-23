// Erweiterung des Simulators für Topic 103: Textfilter, Dateiverwaltung, Archive, Prozesse, Jobs, Prioritäten,
// reguläre Ausdrücke. Ausgaben und Fehlermeldungen folgen GNU coreutils, grep, findutils, tar und procps
// (Fehlermeldungen auf Deutsch wie bei LANG=de_DE.UTF-8), gekürzt wo nötig.
import type { Welt, Prozess } from './shell';
import { BIN, CPIO, KOMP, TAR, darf, darfImOrdner, dateityp, datumText, groesse, istText, md5, menschlich, meta, neuMeta, rechteText, sha256, sha512, zeitText, beruehren } from './shell-dateien';

export interface Ergebnis { out: string; code: number; err?: string; }
export type Befehl = (w: Welt, args: string[], stdin: string, root: boolean) => Ergebnis;
export interface TextHelfer {
  ok: (out?: string) => Ergebnis;
  fehler: (msg: string, code?: number) => Ergebnis;
  optionen: (a: string[]) => { flags: Set<string>; rest: string[] };
  pfad: (w: Welt, p: string) => string;
  kinder: (w: Welt, dir: string) => string[];
  schreiben: (w: Welt, ziel: string, text: string, anh: boolean, root: boolean) => string | null;
  intern: (w: Welt, zeile: string, stdin: string, root: boolean) => Ergebnis;
  frage: (w: Welt, text: string, standardJa: boolean, aktion: () => Ergebnis) => Ergebnis;
}

// ---------- Reguläre Ausdrücke: POSIX BRE/ERE nach JavaScript ----------

const KLASSEN: Record<string, string> = {
  alpha: 'a-zA-ZäöüÄÖÜß', digit: '0-9', alnum: 'a-zA-Z0-9äöüÄÖÜß', upper: 'A-ZÄÖÜ', lower: 'a-zäöüß', space: ' \\t\\n\\r\\f\\v',
  blank: ' \\t', punct: '!-\\/:-@\\[-`{-~', xdigit: '0-9A-Fa-f', print: ' -~äöüÄÖÜß', graph: '!-~', cntrl: '\\x00-\\x1f',
};

export function regexAus(muster: string, o: { ere?: boolean; fest?: boolean; i?: boolean; wort?: boolean; zeile?: boolean; global?: boolean } = {}): RegExp {
  let js = '';
  if (o.fest) js = muster.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  else {
    for (let i = 0; i < muster.length; i++) {
      const c = muster[i];
      if (c === '[') {
        // Klammerausdruck bis zur schließenden Klammer übernehmen, POSIX-Klassen übersetzen
        let j = i + 1; let inhalt = '';
        if (muster[j] === '^') { inhalt += '^'; j++; }
        if (muster[j] === ']') { inhalt += '\\]'; j++; }
        while (j < muster.length && muster[j] !== ']') {
          const m = muster.slice(j).match(/^\[:(\w+):\]/);
          if (m) { inhalt += KLASSEN[m[1]] ?? ''; j += m[0].length; continue; }
          inhalt += muster[j] === '\\' ? '\\\\' : muster[j]; j++;
        }
        js += `[${inhalt}]`; i = j; continue;
      }
      if (c === '\\' && i + 1 < muster.length) {
        const n = muster[++i];
        if (!o.ere && '(){}|+?'.includes(n)) js += n;          // BRE: \( \) \{ \} \| \+ \? sind Sonderzeichen
        else if (n === '<' || n === '>') js += '\\b';
        else js += '\\' + n;
        continue;
      }
      if (!o.ere && '(){}|+?'.includes(c)) { js += '\\' + c; continue; }  // BRE: ( ) { } | + ? sind normale Zeichen
      if (c === '/') { js += '\\/'; continue; }
      js += c;
    }
  }
  if (o.wort) js = `(?<![\\wäöüÄÖÜß])(?:${js})(?![\\wäöüÄÖÜß])`;
  if (o.zeile) js = `^(?:${js})$`;
  return new RegExp(js, (o.i ? 'i' : '') + (o.global ? 'g' : '') + 'u');
}

// ---------- Hilfen ----------

const zeilen = (t: string) => (t === '' ? [] : t.replace(/\n$/, '').split('\n'));
const LANG_LAUFEND = new Set(['sleep', 'top', 'watch', 'ping', 'yes', 'firefox', 'render.sh', './render.sh', 'make']);

function liste(spez: string): (n: number) => boolean {
  const teile = spez.split(',').map((t) => { const m = t.match(/^(\d*)(-?)(\d*)$/); if (!m) return () => false; const a = m[1] ? Number(m[1]) : 1; const b = m[2] ? (m[3] ? Number(m[3]) : Infinity) : a; return (n: number) => n >= a && n <= b; });
  return (n) => teile.some((f) => f(n));
}

function trMenge(s: string): string[] {
  const out: string[] = []; let i = 0;
  while (i < s.length) {
    const kl = s.slice(i).match(/^\[:(\w+):\]/);
    if (kl) {
      const r: Record<string, string> = { lower: 'abcdefghijklmnopqrstuvwxyz', upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', digit: '0123456789', space: ' \t\n\r\f\v', blank: ' \t', punct: '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~' };
      r.alpha = r.lower + r.upper; r.alnum = r.alpha + r.digit;
      out.push(...(r[kl[1]] ?? '')); i += kl[0].length; continue;
    }
    let c = s[i];
    if (c === '\\' && i + 1 < s.length) { const n = s[++i]; c = n === 'n' ? '\n' : n === 't' ? '\t' : n === 'r' ? '\r' : n; }
    if (s[i + 1] === '-' && i + 2 < s.length) { const e = s[i + 2]; for (let k = c.charCodeAt(0); k <= e.charCodeAt(0); k++) out.push(String.fromCharCode(k)); i += 3; continue; }
    out.push(c); i++;
  }
  return out;
}

function globZuRegex(g: string, i = false) { return new RegExp('^' + g.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.').replace(/\[!/g, '[^') + '$', i ? 'i' : ''); }

function signalNr(s: string): number {
  const n = s.replace(/^-/, '').replace(/^SIG/i, '').toUpperCase();
  return /^\d+$/.test(n) ? Number(n) : ({ HUP: 1, INT: 2, QUIT: 3, KILL: 9, TERM: 15, CONT: 18, STOP: 19, TSTP: 20 } as Record<string, number>)[n] ?? 15;
}

// ---------- Befehle ----------

export function textBefehle(h: TextHelfer): Record<string, Befehl> {
  const { ok, fehler, optionen, pfad, kinder, schreiben, intern, frage } = h;

  /** Datei lesen mit Rechteprüfung. Gibt den Text oder eine Fehlermeldung zurück. */
  function lesen(w: Welt, name: string, root: boolean, befehl: string): { text: string } | { err: string } {
    if (name === '-') return { text: '' };
    const p = pfad(w, name);
    if (!(p in w.fs)) return { err: `${befehl}: ${name}: Datei oder Verzeichnis nicht gefunden` };
    let c = w.fs[p];
    if (c === null) return { err: `${befehl}: ${name}: Ist ein Verzeichnis` };
    if (!darf(w, p, 'r', root)) return { err: `${befehl}: ${name}: Keine Berechtigung` };
    if (c.startsWith('-> ')) { const z = c.slice(3); c = w.fs[z.startsWith('/') ? z : p.replace(/[^/]+$/, '') + z] ?? ''; }
    return { text: c ?? '' };
  }
  /** Mehrere Dateien oder stdin lesen. */
  function eingaben(w: Welt, dateien: string[], stdin: string, root: boolean, befehl: string): { texte: { name: string; text: string }[]; err: string[] } {
    if (!dateien.length) return { texte: [{ name: '-', text: stdin }], err: [] };
    const texte: { name: string; text: string }[] = []; const err: string[] = [];
    for (const d of dateien) { if (d === '-') { texte.push({ name: '-', text: stdin }); continue; } const r = lesen(w, d, root, befehl); if ('err' in r) err.push(r.err); else texte.push({ name: d, text: r.text }); }
    return { texte, err };
  }
  const mitFehlern = (out: string, err: string[], code = 1): Ergebnis => err.length ? { out, err: err.join('\n'), code } : ok(out);
  const textInhalt = (t: string) => t.startsWith(KOMP) ? t : t;

  // Optionen mit Wert erkennen, etwa -n 5, -n5, -d: oder -d ':'
  function mitWert(a: string[], kurz: string[], lang: string[] = []): { werte: Record<string, string>; flags: Set<string>; rest: string[] } {
    const werte: Record<string, string> = {}; const flags = new Set<string>(); const rest: string[] = [];
    for (let i = 0; i < a.length; i++) {
      const x = a[i];
      if (x === '--') { rest.push(...a.slice(i + 1)); break; }
      const lm = x.match(/^--([\w-]+)(?:=(.*))?$/);
      if (lm) { if (lang.includes(lm[1])) werte[lm[1]] = lm[2] ?? a[++i] ?? ''; else flags.add('--' + lm[1]); continue; }
      if (/^-[^-]/.test(x) && !/^-\d+$/.test(x)) {
        for (let k = 1; k < x.length; k++) {
          const c = x[k];
          if (kurz.includes(c)) { werte[c] = x.slice(k + 1) || a[++i] || ''; break; }
          flags.add('-' + c);
        }
        continue;
      }
      if (/^-\d+$/.test(x) && kurz.includes('n')) { werte.n = x.slice(1); continue; }
      rest.push(x);
    }
    return { werte, flags, rest };
  }

  const b: Record<string, Befehl> = {};

  // ===================== 103.2 Textfilter =====================

  b.cat = (w, a, stdin, root) => {
    const { flags, rest } = optionen(a);
    const { texte, err } = eingaben(w, rest, stdin, root, 'cat');
    let out = texte.map((t) => t.text).join('');
    if (flags.has('-n')) out = zeilen(out).map((z, i) => `${String(i + 1).padStart(6)}\t${z}`).join('\n') + '\n';
    if (flags.has('-A')) out = zeilen(out).map((z) => z.replace(/\t/g, '^I').replace(/\r/g, '^M') + '$').join('\n') + '\n';
    return mitFehlern(out.replace(/\n$/, ''), err);
  };
  b.tac = (w, a, stdin, root) => { const { texte, err } = eingaben(w, a, stdin, root, 'tac'); return mitFehlern(texte.flatMap((t) => zeilen(t.text).reverse()).join('\n'), err); };
  b.head = (w, a, stdin, root) => kopfFuss(w, a, stdin, root, 'head');
  b.tail = (w, a, stdin, root) => kopfFuss(w, a, stdin, root, 'tail');
  function kopfFuss(w: Welt, a: string[], stdin: string, root: boolean, art: 'head' | 'tail'): Ergebnis {
    const { werte, flags, rest } = mitWert(a, ['n', 'c']);
    const { texte, err } = eingaben(w, rest, stdin, root, art);
    const out: string[] = [];
    for (const t of texte) {
      if (texte.length > 1) out.push(`==> ${t.name} <==`);
      if (werte.c !== undefined) { const n = Number(werte.c); out.push(art === 'head' ? t.text.slice(0, n) : t.text.slice(-n)); continue; }
      const z = zeilen(t.text); const nRoh = werte.n ?? '10';
      if (art === 'tail' && nRoh.startsWith('+')) { out.push(...z.slice(Number(nRoh.slice(1)) - 1)); continue; }
      const n = Math.abs(Number(nRoh));
      out.push(...(art === 'head' ? (nRoh.startsWith('-') ? z.slice(0, -n) : z.slice(0, n)) : z.slice(-n)));
    }
    if (art === 'tail' && flags.has('-f')) w.langlaeufer = ['tail', ...a].join(' ');
    return mitFehlern(out.join('\n'), err);
  }
  b.wc = (w, a, stdin, root) => {
    const { flags, rest } = optionen(a);
    const { texte, err } = eingaben(w, rest, stdin, root, 'wc');
    const alle = !flags.has('-l') && !flags.has('-w') && !flags.has('-c') && !flags.has('-m');
    const z = (t: string) => { const f: number[] = []; if (alle || flags.has('-l')) f.push((t.match(/\n/g) ?? []).length); if (alle || flags.has('-w')) f.push(t.split(/\s+/).filter(Boolean).length); if (flags.has('-m')) f.push([...t].length); if (alle || flags.has('-c')) f.push(groesse(t)); return f; };
    const breite = rest.length > 1 || alle ? 7 : 0;
    const out = texte.map((t) => { const f = z(t.text + (t.text && !t.text.endsWith('\n') ? '\n' : '')); return f.map((x) => String(x).padStart(breite)).join(' ') + (t.name !== '-' ? ' ' + t.name : ''); });
    if (texte.length > 1) { const summe = texte.map((t) => z(t.text + (t.text && !t.text.endsWith('\n') ? '\n' : ''))).reduce((s, f) => s.map((x, i) => x + f[i])); out.push(summe.map((x) => String(x).padStart(breite)).join(' ') + ' insgesamt'); }
    return mitFehlern(out.join('\n'), err);
  };
  b.nl = (w, a, stdin, root) => {
    const { werte, rest } = mitWert(a, ['b', 's', 'w']);
    const { texte, err } = eingaben(w, rest, stdin, root, 'nl');
    let n = 0; const alle = werte.b === 'a';
    const out = texte.flatMap((t) => zeilen(t.text)).map((z) => (z.trim() || alle) ? `${String(++n).padStart(Number(werte.w ?? 6))}${werte.s ?? '\t'}${z}` : '');
    return mitFehlern(out.join('\n'), err);
  };
  b.sort = (w, a, stdin, root) => {
    const { werte, flags, rest } = mitWert(a, ['k', 't', 'o']);
    const { texte, err } = eingaben(w, rest, stdin, root, 'sort');
    let z = texte.flatMap((t) => zeilen(t.text));
    const schluessel = (s: string) => {
      if (!werte.k) return s;
      const [von, bis] = werte.k.split(',').map((x) => Number(x.replace(/\D.*$/, '')));
      const felder = werte.t ? s.split(werte.t) : s.trim().split(/\s+/);
      return felder.slice(von - 1, bis ? bis : felder.length).join(werte.t ?? ' ');
    };
    // -h: menschliche Größen wie 2K, 1,5M, 3G
    const einheit = (s: string) => { const m = s.trim().match(/^([\d.,]+)\s*([KMGT]?)/i); if (!m) return 0; const e = m[2] ? 'KMGT'.indexOf(m[2].toUpperCase()) + 1 : 0; return parseFloat(m[1].replace(',', '.')) * 1024 ** e; };
    const vergleich = (x: string, y: string) => {
      const a1 = schluessel(x), b1 = schluessel(y);
      if (flags.has('-n')) return (parseFloat(a1) || 0) - (parseFloat(b1) || 0);
      if (flags.has('-h')) return einheit(a1) - einheit(b1);
      return flags.has('-f') ? a1.localeCompare(b1, 'de', { sensitivity: 'base' }) : a1.localeCompare(b1, 'de');
    };
    z = [...z].sort(vergleich);
    if (flags.has('-r')) z.reverse();
    if (flags.has('-u')) z = z.filter((x, i) => i === 0 || vergleich(x, z[i - 1]) !== 0);
    if (werte.o) { const e = schreiben(w, werte.o, z.join('\n'), false, root); return e ? fehler(`sort: ${werte.o}: ${e}`, 2) : ok(); }
    return mitFehlern(z.join('\n'), err);
  };
  b.uniq = (w, a, stdin, root) => {
    const { flags, rest } = optionen(a);
    const { texte, err } = eingaben(w, rest.slice(0, 1), stdin, root, 'uniq');
    const z = texte.flatMap((t) => zeilen(t.text));
    const gruppen: { z: string; n: number }[] = [];
    for (const x of z) { const l = gruppen[gruppen.length - 1]; if (l && (flags.has('-i') ? l.z.toLowerCase() === x.toLowerCase() : l.z === x)) l.n++; else gruppen.push({ z: x, n: 1 }); }
    const gefiltert = gruppen.filter((g) => (flags.has('-d') ? g.n > 1 : flags.has('-u') ? g.n === 1 : true));
    return mitFehlern(gefiltert.map((g) => (flags.has('-c') ? `${String(g.n).padStart(7)} ${g.z}` : g.z)).join('\n'), err);
  };
  b.cut = (w, a, stdin, root) => {
    const { werte, flags, rest } = mitWert(a, ['d', 'f', 'c', 'b'], ['output-delimiter']);
    const { texte, err } = eingaben(w, rest, stdin, root, 'cut');
    if (!werte.f && !werte.c && !werte.b) return fehler('cut: Sie müssen eine Liste von Bytes, Zeichen oder Feldern angeben\n„cut --help“ liefert weitere Informationen.');
    const d = werte.d ?? '\t';
    if (d.length > 1) return fehler('cut: Trenner muss ein einzelnes Zeichen sein');
    const out = texte.flatMap((t) => zeilen(t.text)).flatMap((z) => {
      if (werte.c || werte.b) { const f = liste(werte.c ?? werte.b); return [[...z].filter((_, i) => f(i + 1)).join('')]; }
      if (!z.includes(d)) return flags.has('-s') ? [] : [z];
      const f = liste(werte.f); return [z.split(d).filter((_, i) => f(i + 1)).join(werte['output-delimiter'] ?? d)];
    });
    return mitFehlern(out.join('\n'), err);
  };
  b.paste = (w, a, stdin, root) => {
    const { werte, flags, rest } = mitWert(a, ['d']);
    const { texte, err } = eingaben(w, rest, stdin, root, 'paste');
    const d = (werte.d ?? '\t').replace(/\\t/g, '\t');
    const spalten = texte.map((t) => zeilen(t.text));
    if (flags.has('-s')) return mitFehlern(spalten.map((s) => s.join(d)).join('\n'), err);
    const n = Math.max(0, ...spalten.map((s) => s.length));
    return mitFehlern(Array.from({ length: n }, (_, i) => spalten.map((s) => s[i] ?? '').join(d)).join('\n'), err);
  };
  b.tr = (_w, a, stdin) => {
    const { flags, rest } = optionen(a);
    if (rest.length > 2 || (!rest.length)) return fehler('tr: fehlender Operand\n„tr --help“ liefert weitere Informationen.');
    const s1 = trMenge(rest[0]); const s2 = rest[1] !== undefined ? trMenge(rest[1]) : [];
    let t = stdin;
    if (flags.has('-d')) t = [...t].filter((c) => !s1.includes(c)).join('');
    else if (s2.length) t = [...t].map((c) => { const i = s1.indexOf(c); return i < 0 ? c : s2[Math.min(i, s2.length - 1)]; }).join('');
    if (flags.has('-s')) { const m = s2.length ? s2 : s1; t = [...t].filter((c, i, arr) => !(i > 0 && c === arr[i - 1] && m.includes(c))).join(''); }
    return ok(t.replace(/\n$/, ''));
  };
  b.od = (w, a, stdin, root) => {
    const { werte, flags, rest } = mitWert(a, ['t', 'A', 'N']);
    const { texte, err } = eingaben(w, rest, stdin, root, 'od');
    let bytes = [...new TextEncoder().encode(texte.map((t) => t.text).join(''))];
    if (werte.N) bytes = bytes.slice(0, Number(werte.N));
    const adr = (n: number) => werte.A === 'd' ? String(n).padStart(7, '0') : werte.A === 'x' ? n.toString(16).padStart(6, '0') : werte.A === 'n' ? '' : n.toString(8).padStart(7, '0');
    const out: string[] = [];
    for (let i = 0; i < bytes.length; i += 16) {
      const blk = bytes.slice(i, i + 16); let z: string;
      if (flags.has('-c') || werte.t === 'c') z = blk.map((x) => ({ 10: '\\n', 9: '\\t', 13: '\\r', 0: '\\0' } as Record<number, string>)[x] ?? (x >= 32 && x < 127 ? String.fromCharCode(x) : x.toString(8).padStart(3, '0'))).map((s) => s.padStart(4)).join('');
      else if (werte.t === 'x1') z = blk.map((x) => ' ' + x.toString(16).padStart(2, '0')).join('');
      else if (flags.has('-x') || werte.t === 'x2') { const w2: string[] = []; for (let k = 0; k < blk.length; k += 2) w2.push(' ' + ((blk[k + 1] ?? 0) * 256 + blk[k]).toString(16).padStart(4, '0')); z = w2.join(''); }
      else { const w2: string[] = []; for (let k = 0; k < blk.length; k += 2) w2.push(' ' + ((blk[k + 1] ?? 0) * 256 + blk[k]).toString(8).padStart(6, '0')); z = w2.join(''); }
      out.push(adr(i) + z);
    }
    out.push(adr(bytes.length));
    return mitFehlern(out.join('\n'), err);
  };
  b.split = (w, a, stdin, root) => {
    const { werte, flags, rest } = mitWert(a, ['l', 'b', 'n', 'a']);
    const [quelle = '-', praefix = 'x'] = rest;
    const r = quelle === '-' ? { text: stdin } : lesen(w, quelle, root, 'split');
    if ('err' in r) return fehler(r.err);
    const teile: string[] = [];
    if (werte.b) { const m = werte.b.match(/^(\d+)([kKmM]?)/); const n = Number(m?.[1] ?? 0) * (m?.[2] ? (m[2].toLowerCase() === 'k' ? 1024 : 1048576) : 1); for (let i = 0; i < r.text.length; i += n) teile.push(r.text.slice(i, i + n)); }
    else { const n = Number(werte.l ?? 1000); const z = zeilen(r.text); for (let i = 0; i < z.length; i += n) teile.push(z.slice(i, i + n).join('\n') + '\n'); }
    const len = Number(werte.a ?? 2);
    const name = (i: number) => flags.has('-d') ? String(i).padStart(len, '0') : Array.from({ length: len }, (_, k) => String.fromCharCode(97 + Math.floor(i / 26 ** (len - 1 - k)) % 26)).join('');
    for (const [i, t] of teile.entries()) { const e = schreiben(w, praefix + name(i), t, false, root); if (e) return fehler(`split: ${praefix + name(i)}: ${e}`); }
    return ok();
  };
  const summe = (algo: (s: string) => string, name: string): Befehl => (w, a, stdin, root) => {
    const { flags, rest } = optionen(a);
    if (flags.has('-c') || flags.has('--check')) {
      const { texte, err } = eingaben(w, rest, stdin, root, name);
      const out: string[] = []; let falsch = 0;
      for (const z of texte.flatMap((t) => zeilen(t.text))) {
        const m = z.match(/^([0-9a-f]+)\s+\*?(.+)$/); if (!m) continue;
        const r = lesen(w, m[2], root, name);
        if ('err' in r) { out.push(`${m[2]}: FEHLSCHLAG öffnen oder lesen`); falsch++; continue; }
        const gut = algo(r.text) === m[1]; if (!gut) falsch++;
        out.push(`${m[2]}: ${gut ? 'OK' : 'GESCHEITERT'}`);
      }
      if (falsch) err.push(`${name}: WARNUNG: ${falsch} berechnete ${falsch === 1 ? 'Prüfsumme passte' : 'Prüfsummen passten'} NICHT`);
      return { out: out.join('\n'), err: err.length ? err.join('\n') : undefined, code: falsch || err.length ? 1 : 0, errNach: true } as Ergebnis;
    }
    const { texte, err } = eingaben(w, rest, stdin, root, name);
    return mitFehlern(texte.map((t) => `${algo(t.text)}  ${t.name}`).join('\n'), err);
  };
  b.md5sum = summe(md5, 'md5sum');
  b.sha256sum = summe(sha256, 'sha256sum');
  b.sha512sum = summe(sha512, 'sha512sum');

  // ---------- Kompression ----------
  const ENDUNG: Record<string, string> = { gz: '.gz', bz2: '.bz2', xz: '.xz' };
  const PROG: Record<string, string> = { gz: 'gzip', bz2: 'bzip2', xz: 'xz' };
  const packen = (art: 'gz' | 'bz2' | 'xz', entpacken: boolean): Befehl => (w, a, stdin, root) => {
    const { flags, rest } = optionen(a);
    const aus = entpacken || flags.has('-d') || flags.has('--decompress');
    const zuStdout = flags.has('-c') || flags.has('--stdout');
    const prog = PROG[art];
    if (!rest.length) {
      if (aus) return stdin.startsWith(KOMP) ? ok(stdin.slice(KOMP.length).split(':').slice(1).join(':')) : fehler(`${prog}: stdin: not in ${prog} format`);
      return ok(`${KOMP}${art}:${stdin}`);
    }
    const outs: string[] = []; const err: string[] = [];
    for (const d of rest) {
      const p = pfad(w, d); const c = w.fs[p];
      if (c === undefined) { err.push(`${prog}: ${d}: No such file or directory`); continue; }
      if (c === null) { err.push(`${prog}: ${d} is a directory -- ignored`); continue; }
      if (aus) {
        if (!p.endsWith(ENDUNG[art]) && !zuStdout) { err.push(`${prog}: ${d}: unknown suffix -- ignored`); continue; }
        if (!c.startsWith(KOMP + art + ':')) { err.push(`${prog}: ${d}: not in ${prog} format`); continue; }
        const roh = c.slice(KOMP.length + art.length + 1);
        if (zuStdout) { outs.push(roh); continue; }
        const ziel = p.slice(0, -ENDUNG[art].length);
        const e = schreiben(w, ziel, roh, false, root); if (e) { err.push(`${prog}: ${ziel}: ${e}`); continue; }
        if (!flags.has('-k') && !flags.has('--keep')) delete w.fs[p];
      } else {
        if (p.endsWith(ENDUNG[art])) { err.push(`${prog}: ${d} already has ${ENDUNG[art]} suffix -- unchanged`); continue; }
        if (zuStdout) { outs.push(`${KOMP}${art}:${c}`); continue; }
        const e = schreiben(w, p + ENDUNG[art], `${KOMP}${art}:${c}`, false, root); if (e) { err.push(`${prog}: ${d}${ENDUNG[art]}: ${e}`); continue; }
        // gzip und xz löschen das Original, außer mit -k
        if (!flags.has('-k') && !flags.has('--keep')) delete w.fs[p];
      }
    }
    return mitFehlern(outs.join(''), err);
  };
  b.gzip = packen('gz', false); b.gunzip = packen('gz', true);
  b.bzip2 = packen('bz2', false); b.bunzip2 = packen('bz2', true);
  b.xz = packen('xz', false); b.unxz = packen('xz', true);
  const xcat = (art: string, prog: string): Befehl => (w, a, stdin, root) => {
    const { texte, err } = eingaben(w, a.filter((x) => !x.startsWith('-')), stdin, root, prog);
    const out: string[] = [];
    for (const t of texte) { if (!t.text.startsWith(KOMP + art + ':')) { err.push(`${prog.replace('cat', '')}: ${t.name}: not in ${art === 'gz' ? 'gzip' : art === 'bz2' ? 'bzip2' : 'xz'} format`); continue; } out.push(t.text.slice(KOMP.length + art.length + 1)); }
    return mitFehlern(out.join('').replace(/\n$/, ''), err);
  };
  b.zcat = xcat('gz', 'zcat'); b.bzcat = xcat('bz2', 'bzcat'); b.xzcat = xcat('xz', 'xzcat');

  // ===================== 103.3 Dateiverwaltung =====================

  b.ls = (w, a, _i, root) => {
    const { flags, rest } = optionen(a.filter((x) => !x.startsWith('--color')));
    const lang = flags.has('-l') || flags.has('-n'); const alle = flags.has('-a'); const fast = flags.has('-A');
    const ziele = rest.length ? rest : ['.'];
    const out: string[] = []; const err: string[] = [];
    const zeile = (p: string, name: string) => {
      const m = meta(w, p); const c = w.fs[p];
      const links = c === null ? 2 + kinder(w, p).filter((k) => w.fs[(p === '/' ? '' : p) + '/' + k] === null).length : 1;
      const g = groesse(c);
      return `${rechteText(w, p)} ${String(links).padStart(2)} ${(flags.has('-n') ? (m.owner === 'root' ? '0' : '1000') : m.owner).padEnd(5)} ${(flags.has('-n') ? (m.group === 'root' ? '0' : '1000') : m.group).padEnd(5)} ${(flags.has('-h') ? menschlich(g) : String(g)).padStart(flags.has('-h') ? 4 : 6)} ${zeitText(m.mtime, w.uhr)} ${name}${typeof c === 'string' && c.startsWith('-> ') ? ' -> ' + c.slice(3) : ''}`;
    };
    const sortiere = (ps: { p: string; n: string }[]) => {
      let l = [...ps];
      if (flags.has('-t')) l.sort((x, y) => meta(w, y.p).mtime - meta(w, x.p).mtime);
      else if (flags.has('-S')) l.sort((x, y) => groesse(w.fs[y.p]) - groesse(w.fs[x.p]));
      else l.sort((x, y) => x.n.replace(/^\./, '').localeCompare(y.n.replace(/^\./, ''), 'de'));
      if (flags.has('-r')) l.reverse();
      return l;
    };
    const ordner = (p: string, anzeige: string, kopf: boolean) => {
      if (!darf(w, p, 'r', root)) { err.push(`ls: Öffnen von Verzeichnis '${anzeige}' nicht möglich: Keine Berechtigung`); return; }
      if (kopf) out.push(`${anzeige}:`);
      let eintraege = kinder(w, p).filter((n) => alle || fast || !n.startsWith('.')).map((n) => ({ p: (p === '/' ? '' : p) + '/' + n, n }));
      if (alle) eintraege = [{ p, n: '.' }, { p: p.replace(/\/[^/]+$/, '') || '/', n: '..' }, ...eintraege];
      eintraege = sortiere(eintraege);
      if (lang) { out.push(`insgesamt ${eintraege.filter((e) => e.n !== '.' && e.n !== '..' || true).reduce((s, e) => s + Math.ceil(groesse(w.fs[e.p]) / 4096) * 4, 0)}`); out.push(...eintraege.map((e) => zeile(e.p, e.n))); }
      else out.push(eintraege.map((e) => e.n + (flags.has('-F') && w.fs[e.p] === null ? '/' : '')).join(flags.has('-1') || !w.stdoutTty ? '\n' : '  '));
      if (flags.has('-R')) for (const e of eintraege) if (w.fs[e.p] === null && e.n !== '.' && e.n !== '..') { out.push(''); ordner(e.p, `${anzeige === '.' ? '.' : anzeige}/${e.n}`, true); }
    };
    const dateien = ziele.filter((r) => { const p = pfad(w, r); return p in w.fs && (w.fs[p] !== null || flags.has('-d')); });
    const ordnerZiele = ziele.filter((r) => { const p = pfad(w, r); return p in w.fs && w.fs[p] === null && !flags.has('-d'); });
    for (const r of ziele) if (!(pfad(w, r) in w.fs)) err.push(`ls: Zugriff auf '${r}' nicht möglich: Datei oder Verzeichnis nicht gefunden`);
    if (dateien.length) { if (lang) out.push(...dateien.map((r) => zeile(pfad(w, r), r))); else out.push(dateien.join(flags.has('-1') || !w.stdoutTty ? '\n' : '  ')); }
    for (const [i, r] of ordnerZiele.entries()) { if (dateien.length || i > 0) out.push(''); ordner(pfad(w, r), r, ziele.length > 1 || flags.has('-R')); }
    return { out: out.join('\n'), err: err.length ? err.join('\n') : undefined, code: err.length ? 2 : 0 };
  };

  b.touch = (w, a, _i, root) => {
    const { werte, rest } = mitWert(a, ['t', 'd']);
    let zeit = w.uhr;
    if (werte.t) { const m = werte.t.match(/^(\d{2})?(\d{2})?(\d{2})(\d{2})(\d{2})(\d{2})(?:\.(\d{2}))?$/); if (!m) return fehler(`touch: Ungültiges Datumsformat '${werte.t}'`); const jahr = m[2] ? Number((m[1] ?? '20') + m[2]) : 2026; zeit = Date.UTC(jahr, Number(m[3]) - 1, Number(m[4]), Number(m[5]) - 1, Number(m[6]), Number(m[7] ?? 0)); }
    if (werte.d) { const m = werte.d.match(/(\d+)\s*(days?|tage?|hours?|minutes?)\s*(ago)?/i); if (m) zeit = w.uhr - Number(m[1]) * (/^d|^t/i.test(m[2]) ? 86400000 : /^h/i.test(m[2]) ? 3600000 : 60000); }
    const err: string[] = [];
    for (const d of rest) {
      const p = pfad(w, d);
      if (!(p in w.fs)) { const e = schreiben(w, p, '', false, root); if (e) { err.push(`touch: '${d}' kann nicht angelegt werden: ${e}`); continue; } }
      else if (!darf(w, p, 'w', root) && meta(w, p).owner !== (root ? 'root' : 'lena')) { err.push(`touch: Setzen der Zeitstempel von '${d}': Keine Berechtigung`); continue; }
      meta(w, p).mtime = zeit;
    }
    if (!rest.length) return fehler('touch: Fehlender Dateioperand\n„touch --help“ liefert weitere Informationen.');
    return mitFehlern('', err);
  };
  b.mkdir = (w, a, _i, root) => {
    const { werte, flags, rest } = mitWert(a, ['m']);
    if (!rest.length) return fehler('mkdir: fehlender Operand\n„mkdir --help“ liefert weitere Informationen.');
    const out: string[] = []; const err: string[] = [];
    for (const d of rest) {
      const p = pfad(w, d);
      const kette = p.split('/').filter(Boolean).map((_, i, arr) => '/' + arr.slice(0, i + 1).join('/'));
      for (const [i, k] of kette.entries()) {
        const letzt = i === kette.length - 1;
        if (k in w.fs) { if (letzt && !flags.has('-p')) err.push(`mkdir: das Verzeichnis '${d}' kann nicht angelegt werden: Die Datei existiert bereits`); continue; }
        if (!letzt && !flags.has('-p')) { err.push(`mkdir: das Verzeichnis '${d}' kann nicht angelegt werden: Datei oder Verzeichnis nicht gefunden`); break; }
        if (!darfImOrdner(w, k, root)) { err.push(`mkdir: das Verzeichnis '${d}' kann nicht angelegt werden: Keine Berechtigung`); break; }
        w.fs[k] = null; neuMeta(w, k, root, true);
        if (werte.m && letzt) meta(w, k).mode = parseInt(werte.m, 8);
        if (flags.has('-v')) out.push(`mkdir: Verzeichnis '${k}' angelegt`);
      }
    }
    return mitFehlern(out.join('\n'), err);
  };
  b.rmdir = (w, a, _i, root) => {
    const { flags, rest } = optionen(a); const err: string[] = [];
    for (const d of rest) {
      let p = pfad(w, d);
      do {
        if (!(p in w.fs)) { err.push(`rmdir: '${d}' konnte nicht entfernt werden: Datei oder Verzeichnis nicht gefunden`); break; }
        if (w.fs[p] !== null) { err.push(`rmdir: '${d}' konnte nicht entfernt werden: Ist kein Verzeichnis`); break; }
        if (kinder(w, p).length) { err.push(`rmdir: '${d}' konnte nicht entfernt werden: Das Verzeichnis ist nicht leer`); break; }
        if (!darfImOrdner(w, p, root, true)) { err.push(`rmdir: '${d}' konnte nicht entfernt werden: Keine Berechtigung`); break; }
        delete w.fs[p];
        p = p.replace(/\/[^/]+$/, '');
      } while (flags.has('-p') && p && p !== pfad(w, '.') && rest.length && p.startsWith(pfad(w, '.')) && p !== '/');
    }
    return mitFehlern('', err);
  };
  b.rm = (w, a, _i, root) => {
    const { flags, rest } = optionen(a);
    if (!rest.length) return fehler('rm: fehlender Operand\n„rm --help“ liefert weitere Informationen.');
    const rek = flags.has('-r') || flags.has('-R') || flags.has('--recursive');
    const out: string[] = []; const err: string[] = [];
    const weg = (p: string, d: string) => {
      if (!(p in w.fs)) { if (!flags.has('-f')) err.push(`rm: das Entfernen von '${d}' ist nicht möglich: Datei oder Verzeichnis nicht gefunden`); return; }
      if (w.fs[p] === null && !rek) { err.push(`rm: das Entfernen von '${d}' ist nicht möglich: Ist ein Verzeichnis`); return; }
      if (!darfImOrdner(w, p, root, true)) { err.push(`rm: das Entfernen von '${d}' ist nicht möglich: Keine Berechtigung`); return; }
      for (const k of Object.keys(w.fs).filter((k) => k === p || k.startsWith(p + '/')).sort().reverse()) { const dir = w.fs[k] === null; delete w.fs[k]; if (flags.has('-v')) { const anz = d + k.slice(p.length); out.push(dir ? `Verzeichnis '${anz}' wurde entfernt` : `'${anz}' wurde entfernt`); } }
    };
    const ausf = () => { for (const d of rest) weg(pfad(w, d), d); return mitFehlern(out.join('\n'), err); };
    if (flags.has('-i') && rest.length) return frage(w, `rm: reguläre Datei '${rest[0]}' entfernen?`, false, ausf);
    return ausf();
  };
  function kopieren(w: Welt, a: string[], root: boolean, verschieben: boolean): Ergebnis {
    const name = verschieben ? 'mv' : 'cp';
    const { flags, rest } = optionen(a);
    if (rest.length < 2) return fehler(rest.length ? `${name}: Fehlender Zieldatei\u2010Operand hinter '${rest[0]}'` : `${name}: Fehlender Dateioperand`);
    const ziel = pfad(w, rest[rest.length - 1]); const quellen = rest.slice(0, -1);
    const zielIstOrdner = w.fs[ziel] === null;
    if (quellen.length > 1 && !zielIstOrdner) return fehler(`${name}: das angegebene Ziel '${rest[rest.length - 1]}' ist kein Verzeichnis`);
    const rek = verschieben || flags.has('-r') || flags.has('-R') || flags.has('-a');
    const behalten = flags.has('-p') || flags.has('-a') || verschieben;
    const out: string[] = []; const err: string[] = [];
    const tun = () => {
      for (const q of quellen) {
        const qp = pfad(w, q);
        if (!(qp in w.fs)) { err.push(`${name}: Aufruf von stat für '${q}' nicht möglich: Datei oder Verzeichnis nicht gefunden`); continue; }
        if (w.fs[qp] === null && !rek) { err.push(`cp: -r wurde nicht angegeben, daher wird das Verzeichnis '${q}' ausgelassen`); continue; }
        if (!verschieben && !darf(w, qp, 'r', root)) { err.push(`cp: '${q}' kann nicht zum Lesen geöffnet werden: Keine Berechtigung`); continue; }
        const zp = zielIstOrdner ? (ziel === '/' ? '' : ziel) + '/' + qp.split('/').pop() : ziel;
        if (zp === qp || zp.startsWith(qp + '/')) { err.push(`${name}: '${q}' und '${rest[rest.length - 1]}' sind dieselbe Datei`); continue; }
        if (!darfImOrdner(w, zp, root) || (verschieben && !darfImOrdner(w, qp, root, true))) { err.push(verschieben ? `mv: das Verschieben von '${q}' nach '${rest[rest.length - 1]}' ist nicht möglich: Keine Berechtigung` : `cp: reguläre Datei '${rest[rest.length - 1]}' kann nicht angelegt werden: Keine Berechtigung`); continue; }
        if (flags.has('-n') && zp in w.fs) continue;
        const alle = Object.keys(w.fs).filter((k) => k === qp || k.startsWith(qp + '/')).sort();
        for (const k of alle) {
          const neu = zp + k.slice(qp.length);
          w.fs[neu] = w.fs[k];
          if (behalten) w.meta![neu] = { ...meta(w, k) }; else neuMeta(w, neu, root, w.fs[k] === null);
          if (!behalten && w.fs[k] !== null) meta(w, neu).mode = meta(w, k).mode & ~(w.umask ?? 0o022) & 0o777 | (meta(w, k).mode & 0o111 ? 0o111 & ~(w.umask ?? 0o022) : 0);
        }
        if (verschieben) for (const k of alle.reverse()) delete w.fs[k];
        if (flags.has('-v')) out.push(`${verschieben ? 'Datei umbenannt ' : ''}'${q}' -> '${zielAnzeige(q)}'`);
      }
      return mitFehlern(out.join('\n'), err);
    };
    const zielAnzeige = (q: string) => zielIstOrdner ? rest[rest.length - 1].replace(/\/$/, '') + '/' + pfad(w, q).split('/').pop() : rest[rest.length - 1];
    const zielDatei = zielIstOrdner ? (ziel === '/' ? '' : ziel) + '/' + pfad(w, quellen[0]).split('/').pop() : ziel;
    if (flags.has('-i') && zielDatei in w.fs) return frage(w, `${name}: '${rest[rest.length - 1]}' überschreiben?`, false, tun);
    return tun();
  }
  b.cp = (w, a, _i, root) => kopieren(w, a, root, false);
  b.mv = (w, a, _i, root) => kopieren(w, a, root, true);
  b.file = (w, a) => {
    const { rest } = optionen(a);
    if (!rest.length) return fehler('Usage: file [-bcCdEhikLlNnprsSvzZ0] [--apple] [--extension] [--mime-encoding] [--mime-type] [-e <testname>] [-F <separator>]  [-f <namefile>] [-m <magicfiles>] [-P <parameter=value>] [--exclude-quiet] <file> ...');
    return ok(rest.map((d) => `${d}: ${dateityp(w, pfad(w, d))}`).join('\n'));
  };
  b.basename = (_w, a) => ok((a[0] ?? '').replace(/\/+$/, '').split('/').pop()!.replace(a[1] ? new RegExp(a[1].replace(/[.]/g, '\\.') + '$') : /$^/, ''));
  b.dirname = (_w, a) => ok((a[0] ?? '').replace(/\/[^/]*\/?$/, '') || '.');

  // ---------- find ----------
  b.find = (w, a, _i, root) => {
    let i = 0; const starts: string[] = [];
    while (i < a.length && !a[i].startsWith('-') && a[i] !== '!' && a[i] !== '(') starts.push(a[i++]);
    if (!starts.length) starts.push('.');
    type Test = (p: string, tiefe: number) => boolean;
    const tests: Test[] = []; const aktionen: ((p: string, anzeige: string) => void)[] = [];
    let maxT = Infinity, minT = 0; let nicht = false;
    const out: string[] = []; const err: string[] = [];
    const tage = (p: string) => (w.uhr - meta(w, p).mtime) / 86400000;
    const zahlTest = (s: string, wert: number) => { const n = Number(s.replace(/^[+-]/, '')); return s.startsWith('+') ? wert > n : s.startsWith('-') ? wert < n : wert === n; };
    const add = (t: Test) => { const neg = nicht; nicht = false; tests.push(neg ? (p, d) => !t(p, d) : t); };
    while (i < a.length) {
      const x = a[i++];
      switch (x) {
        case '!': case '-not': nicht = true; break;
        case '-name': { const re = globZuRegex(a[i++] ?? ''); add((p) => re.test(p.split('/').pop() || '/')); break; }
        case '-iname': { const re = globZuRegex(a[i++] ?? '', true); add((p) => re.test(p.split('/').pop() || '/')); break; }
        case '-path': { const re = globZuRegex(a[i++] ?? ''); add((p) => re.test(p)); break; }
        case '-type': { const t = a[i++]; add((p) => { const c = w.fs[p]; return t === 'd' ? c === null : t === 'l' ? typeof c === 'string' && c.startsWith('-> ') : t === 'f' ? typeof c === 'string' && !c.startsWith('-> ') && !p.startsWith('/dev/') : t === 'b' || t === 'c' ? p.startsWith('/dev/') && c !== null : false; }); break; }
        case '-size': { const s = a[i++] ?? ''; const m = s.match(/^([+-]?)(\d+)([ckMGb]?)$/); if (!m) { return fehler(`find: Ungültiges Argument »${s}« für -size.`); } const einheit = ({ c: 1, k: 1024, M: 1048576, G: 1073741824, b: 512, '': 512 } as Record<string, number>)[m[3]]; add((p) => { if (w.fs[p] === null) return false; const n = Math.ceil(groesse(w.fs[p]) / einheit); return zahlTest(m[1] + m[2], n); }); break; }
        case '-mtime': { const s = a[i++] ?? '0'; add((p) => zahlTest(s, Math.floor(tage(p)))); break; }
        case '-mmin': { const s = a[i++] ?? '0'; add((p) => zahlTest(s, Math.ceil((w.uhr - meta(w, p).mtime) / 60000))); break; }
        case '-newer': { const r = pfad(w, a[i++] ?? ''); const t = meta(w, r).mtime; add((p) => meta(w, p).mtime > t); break; }
        case '-user': { const u = a[i++]; add((p) => meta(w, p).owner === u); break; }
        case '-group': { const g = a[i++]; add((p) => meta(w, p).group === g); break; }
        case '-perm': { const s = a[i++] ?? ''; const art = s[0] === '-' ? 'alle' : s[0] === '/' ? 'eine' : 'genau'; const m = parseInt(s.replace(/^[-/]/, ''), 8); add((p) => { const x = meta(w, p).mode & 0o7777; return art === 'genau' ? x === m : art === 'alle' ? (x & m) === m : (x & m) !== 0; }); break; }
        case '-empty': add((p) => w.fs[p] === null ? !kinder(w, p).length : groesse(w.fs[p]) === 0); break;
        case '-maxdepth': maxT = Number(a[i++]); break;
        case '-mindepth': minT = Number(a[i++]); break;
        case '-print': aktionen.push((_p, d) => out.push(d)); break;
        case '-ls': aktionen.push((p, d) => out.push(`${rechteText(w, p)} ${meta(w, p).owner} ${groesse(w.fs[p])} ${d}`)); break;
        case '-delete': aktionen.push((p) => { if (darfImOrdner(w, p, root, true)) { if (w.fs[p] === null && kinder(w, p).length) err.push(`find: '${p}' kann nicht gelöscht werden.: Das Verzeichnis ist nicht leer`); else delete w.fs[p]; } else err.push(`find: '${p}' kann nicht gelöscht werden.: Keine Berechtigung`); }); break;
        case '-exec': case '-ok': {
          const cmd: string[] = []; while (i < a.length && a[i] !== ';' && a[i] !== '\\;' && a[i] !== '+') cmd.push(a[i++]);
          const plus = a[i] === '+'; i++;
          if (plus) { const gesammelt: string[] = []; aktionen.push((_p, d) => gesammelt.push(d)); aktionen.push(Object.assign(() => {}, { _ende: () => { const r = intern(w, cmd.map((t) => (t === '{}' ? gesammelt.map((g) => `'${g}'`).join(' ') : t)).join(' '), '', root); if (r.out) out.push(r.out); if (r.err) err.push(r.err); } })); }
          else aktionen.push((_p, d) => { const r = intern(w, cmd.map((t) => (t === '{}' ? `'${d}'` : t)).join(' '), '', root); if (r.out) out.push(r.out); if (r.err) err.push(r.err); });
          break;
        }
        case '-a': case '-and': break;
        default: return fehler(`find: unbekannte Option »${x}«`);
      }
    }
    if (!aktionen.length) aktionen.push((_p, d) => out.push(d));
    for (const s of starts) {
      const sp = pfad(w, s);
      if (!(sp in w.fs)) { err.push(`find: '${s}': Datei oder Verzeichnis nicht gefunden`); continue; }
      const besuche = (p: string, anzeige: string, tiefe: number) => {
        if (tiefe >= minT && tests.every((t) => t(p, tiefe))) for (const ak of aktionen) ak(p, anzeige);
        if (w.fs[p] !== null || tiefe >= maxT) return;
        if (!darf(w, p, 'r', root) || !darf(w, p, 'x', root)) { err.push(`find: '${anzeige}': Keine Berechtigung`); return; }
        for (const k of kinder(w, p)) besuche((p === '/' ? '' : p) + '/' + k, (anzeige === '/' ? '' : anzeige) + '/' + k, tiefe + 1);
      };
      besuche(sp, s.replace(/\/$/, '') || '/', 0);
    }
    for (const ak of aktionen) (ak as any)._ende?.();
    return { out: out.join('\n'), err: err.length ? err.join('\n') : undefined, code: err.length ? 1 : 0 };
  };

  // ---------- tar ----------
  b.tar = (w, a, _i, root) => {
    let opts = ''; const rest: string[] = []; let datei: string | undefined; let ordner: string | undefined;
    const liste = [...a];
    if (liste[0] && !liste[0].startsWith('-') && /^[cxtvfzjJCpa]+$/.test(liste[0])) liste[0] = '-' + liste[0];
    for (let i = 0; i < liste.length; i++) {
      const x = liste[i];
      if (x === '-C' || x === '--directory') { ordner = liste[++i]; continue; }
      if (x.startsWith('--file=')) { datei = x.slice(7); continue; }
      if (x === '--gzip') { opts += 'z'; continue; } if (x === '--bzip2') { opts += 'j'; continue; } if (x === '--xz') { opts += 'J'; continue; }
      if (x === '--create') { opts += 'c'; continue; } if (x === '--extract') { opts += 'x'; continue; } if (x === '--list') { opts += 't'; continue; }
      if (/^-[a-zA-Z]+$/.test(x)) { for (let k = 1; k < x.length; k++) { if (x[k] === 'f') { datei = x.slice(k + 1) || liste[++i]; break; } if (x[k] === 'C') { ordner = x.slice(k + 1) || liste[++i]; break; } opts += x[k]; } continue; }
      rest.push(x);
    }
    const modus = ['c', 'x', 't'].filter((m) => opts.includes(m));
    if (modus.length !== 1) return fehler('tar: Eine der Optionen „-Acdtrux“, „--delete“ oder „--test-label“ ist notwendig\n„tar --help“ oder „tar --usage“ liefert weitere Informationen.', 2);
    const v = opts.includes('v'); const komp = opts.includes('z') ? 'gz' : opts.includes('j') ? 'bz2' : opts.includes('J') ? 'xz' : null;
    if (!datei) return fehler('tar: Archiv auf Standardausgabe wird nicht geschrieben. (Im Simulator immer mit f arbeiten.)', 2);
    const basis = ordner ? pfad(w, ordner) : w.cwd;
    if (modus[0] === 'c') {
      if (!rest.length) return fehler('tar: Anlegen eines leeren Archivs wird feige verweigert\n„tar --help“ oder „tar --usage“ liefert weitere Informationen.', 2);
      const eintraege: { p: string; c: string | null; m: number }[] = []; const err: string[] = [];
      for (const r of rest) {
        const qp = r.startsWith('/') ? pfad(w, r) : (basis === '/' ? '' : basis) + '/' + r.replace(/^\.\//, '');
        if (!(qp in w.fs)) { err.push(`tar: ${r}: Funktion stat fehlgeschlagen: Datei oder Verzeichnis nicht gefunden`); continue; }
        for (const k of Object.keys(w.fs).filter((k) => k === qp || k.startsWith(qp + '/')).sort()) {
          if (!darf(w, k, 'r', root)) { err.push(`tar: ${k}: Funktion open fehlgeschlagen: Keine Berechtigung`); continue; }
          const rel = (r.startsWith('/') ? r.replace(/^\/+/, '') : r.replace(/^\.\//, '')) + k.slice(qp.length);
          eintraege.push({ p: rel + (w.fs[k] === null ? '/' : ''), c: w.fs[k], m: meta(w, k).mode });
        }
      }
      if (rest.some((r) => r.startsWith('/'))) err.unshift('tar: Entferne führende „/“ von Elementnamen');
      let inhalt = TAR + JSON.stringify(eintraege);
      if (komp) inhalt = `${KOMP}${komp}:${inhalt}`;
      const e = schreiben(w, datei, inhalt, false, root); if (e) return fehler(`tar: ${datei}: Funktion open fehlgeschlagen: ${e}`, 2);
      return { out: v ? eintraege.map((x) => x.p).join('\n') : '', err: err.length ? err.join('\n') : undefined, code: err.some((x) => !x.includes('führende')) ? 2 : 0 };
    }
    const r = lesen(w, datei, root, 'tar'); if ('err' in r) return fehler(r.err.replace(/^tar: (.*): (.*)$/, 'tar: $1: Funktion open fehlgeschlagen: $2') + '\ntar: Error is not recoverable: exiting now', 2);
    let c = r.text; if (c.startsWith(KOMP)) c = c.slice(KOMP.length).split(':').slice(1).join(':');
    if (!c.startsWith(TAR)) return fehler('tar: Das sieht nicht wie ein „tar“-Archiv aus.\ntar: Beende mit Fehlerstatus aufgrund vorheriger Fehler', 2);
    const eintraege = JSON.parse(c.slice(TAR.length)) as { p: string; c: string | null; m: number }[];
    const filter = rest.length ? eintraege.filter((e) => rest.some((x) => e.p === x || e.p.startsWith(x.replace(/\/$/, '') + '/'))) : eintraege;
    if (modus[0] === 't') return ok(filter.map((e) => v ? `${(e.c === null ? 'd' : '-')}${rechteText({ fs: { x: '' }, meta: { x: { mode: e.m, owner: 'lena', group: 'lena', mtime: 0 } } } as any, 'x').slice(1)} lena/lena ${String(groesse(e.c)).padStart(6)} 2026-11-23 08:40 ${e.p}` : e.p).join('\n'));
    if (!darf(w, basis, 'w', root)) return fehler(`tar: ${filter[0]?.p ?? ''}: Funktion open fehlgeschlagen: Keine Berechtigung`, 2);
    for (const e of filter) {
      const ziel = (basis === '/' ? '' : basis) + '/' + e.p.replace(/\/$/, '');
      const teile = ziel.split('/').filter(Boolean);
      for (let k = 1; k < teile.length; k++) { const d = '/' + teile.slice(0, k).join('/'); if (!(d in w.fs)) { w.fs[d] = null; neuMeta(w, d, root, true); } }
      w.fs[ziel] = e.c; neuMeta(w, ziel, root, e.c === null); meta(w, ziel).mode = e.m;
    }
    return ok(v ? filter.map((e) => e.p).join('\n') : '');
  };

  // ---------- cpio ----------
  b.cpio = (w, a, stdin, root) => {
    const kurz = a.filter((x) => x.startsWith('-')).join('').replace(/-/g, '');
    if (kurz.includes('o')) {
      const eintraege = zeilen(stdin).map((p) => p.trim()).filter(Boolean).map((p) => ({ p: p.replace(/^\.\//, ''), c: w.fs[pfad(w, p)] ?? '' }));
      const n = Math.max(1, Math.ceil(eintraege.reduce((s, e) => s + groesse(e.c), 0) / 512));
      return { out: CPIO + JSON.stringify(eintraege), err: [...(kurz.includes('v') ? eintraege.map((e) => e.p) : []), `${n} ${n === 1 ? 'Block' : 'Blöcke'}`].join('\n'), code: 0, errNach: true } as Ergebnis;
    }
    if (!stdin.startsWith(CPIO)) return fehler('cpio: Vorzeitiges Ende des Archivs');
    const rohdaten = stdin.slice(CPIO.length);
    const eintraege: { p: string; c: string | null }[] = rohdaten.startsWith('[') ? JSON.parse(rohdaten) : rohdaten.split(',').map((p) => ({ p: '.' + p, c: p.endsWith('.conf') ? '# Beispielkonfiguration\n' : '(ELF-Programm)' }));
    const nb = Math.max(1, Math.ceil(eintraege.reduce((s, e) => s + groesse(e.c), 0) / 512));
    const bloecke = `${nb} ${nb === 1 ? 'Block' : 'Blöcke'}`;
    if (kurz.includes('t')) return { out: eintraege.map((e) => e.p).join('\n'), err: bloecke, code: 0, errNach: true } as Ergebnis;
    if (!kurz.includes('i')) return fehler('cpio: Sie müssen eine der Optionen -o, -i, -p, -t angeben.\n„cpio --help“ oder „cpio --usage“ liefert weitere Informationen.');
    for (const e of eintraege) {
      const ziel = pfad(w, e.p);
      const teile = ziel.split('/').filter(Boolean);
      if (kurz.includes('d')) for (let k = 1; k < teile.length; k++) { const d = '/' + teile.slice(0, k).join('/'); if (!(d in w.fs)) { w.fs[d] = null; neuMeta(w, d, root, true); } }
      const parent = '/' + teile.slice(0, -1).join('/');
      if (!(parent in w.fs)) return fehler(`cpio: ${e.p}: Funktion open fehlgeschlagen: Datei oder Verzeichnis nicht gefunden (mit -d werden Verzeichnisse angelegt)`);
      w.fs[ziel] = e.c; neuMeta(w, ziel, root, e.c === null);
    }
    return { out: '', err: [...(kurz.includes('v') ? eintraege.map((e) => e.p) : []), bloecke].join('\n'), code: 0 };
  };

  // ---------- dd ----------
  b.dd = (w, a, _i, root) => {
    const o: Record<string, string> = {}; for (const x of a) { const m = x.match(/^(\w+)=(.*)$/); if (m) o[m[1]] = m[2]; }
    const zahl = (s?: string) => { if (!s) return 512; const m = s.match(/^(\d+)([KMG]?)/i); return Number(m?.[1] ?? 0) * ({ '': 1, K: 1024, M: 1048576, G: 1073741824 } as Record<string, number>)[(m?.[2] ?? '').toUpperCase()]; };
    const bs = zahl(o.bs); const count = o.count ? Number(o.count) : undefined;
    if (!o.if || !o.of) return fehler('dd: Im Simulator immer mit if=QUELLE und of=ZIEL arbeiten.');
    const quelle = pfad(w, o.if); const ziel = pfad(w, o.of);
    if (!(quelle in w.fs)) return fehler(`dd: '${o.if}' konnte nicht geöffnet werden: Datei oder Verzeichnis nicht gefunden`);
    if (!darf(w, quelle, 'r', root)) return fehler(`dd: '${o.if}' konnte nicht geöffnet werden: Keine Berechtigung`);
    let inhalt: string; let bytes: number;
    if (['/dev/zero', '/dev/urandom', '/dev/random'].includes(quelle) || quelle.startsWith('/dev/sd') || quelle.startsWith('/dev/nvme')) {
      bytes = count !== undefined ? bs * count : quelle.startsWith('/dev/sd') ? 30752636928 : 0;
      if (count === undefined && !quelle.startsWith('/dev/sd')) return fehler('dd: Ohne count= würde /dev/zero endlos lesen. Gib count= an.');
      inhalt = BIN + bytes;
    } else {
      const c = w.fs[quelle] ?? '';
      inhalt = count !== undefined ? (istText(c) ? c.slice(0, bs * count) : BIN + Math.min(groesse(c), bs * count)) : c;
      bytes = groesse(inhalt);
    }
    if (ziel.startsWith('/dev/')) { if (!root) return fehler(`dd: '${o.of}' konnte nicht geöffnet werden: Keine Berechtigung`); }
    else { const e = schreiben(w, o.of, inhalt, false, root); if (e) return fehler(`dd: '${o.of}' konnte nicht geöffnet werden: ${e}`); }
    const bl = Math.ceil(bytes / bs);
    const mb = bytes >= 1e6 ? `${Math.round(bytes / 1e6)} MB, ${menschlich(bytes).replace(/([KMG])$/, ' $1iB')}` : `${bytes} B`;
    return { out: '', err: `${bl}+0 Datensätze ein\n${bl}+0 Datensätze aus\n${bytes} Bytes${bytes >= 1e6 ? ` (${mb})` : ''} kopiert, 0,0213 s, ${Math.max(1, Math.round(bytes / 1e6 / 0.0213))} MB/s`, code: 0 };
  };

  // ===================== 103.4 Pipes und Umleitungen =====================

  b.tee = (w, a, stdin, root) => {
    const { flags, rest } = optionen(a); const err: string[] = [];
    for (const r of rest) { const e = schreiben(w, r, stdin, flags.has('-a'), root); if (e) err.push(`tee: ${r}: ${e}`); }
    return mitFehlern(stdin.replace(/\n$/, ''), err);
  };
  b.xargs = (w, a, stdin, root) => {
    const { werte, flags, rest } = mitWert(a, ['n', 'I', 'd']);
    const cmd = rest.length ? rest : ['echo'];
    const woerter = werte.I ? zeilen(stdin).filter((z) => z.trim()) : (flags.has('-0') ? stdin.split('\0') : stdin.split(werte.d ? werte.d.replace('\\n', '\n') : /\s+/)).filter(Boolean);
    const out: string[] = []; const err: string[] = []; let code = 0;
    const lauf = (args: string[]) => { const r = intern(w, [...cmd, ...args.map((x) => `'${x}'`)].join(' '), '', root); if (r.out) out.push(r.out); if (r.err) err.push(r.err); if (r.code) code = 123; };
    if (werte.I) for (const x of woerter) { const r = intern(w, cmd.map((t) => t.split(werte.I).join(`'${x}'`)).join(' '), '', root); if (r.out) out.push(r.out); if (r.err) err.push(r.err); if (r.code) code = 123; }
    else if (werte.n) for (let i = 0; i < woerter.length; i += Number(werte.n)) lauf(woerter.slice(i, i + Number(werte.n)));
    else if (woerter.length || !flags.has('-r')) lauf(woerter);
    return { out: out.join('\n'), err: err.length ? err.join('\n') : undefined, code };
  };

  // ===================== 103.7 grep =====================

  const grepKern = (w: Welt, a: string[], stdin: string, root: boolean, art: 'grep' | 'egrep' | 'fgrep'): Ergebnis => {
    const { werte, flags, rest } = mitWert(a.filter((x) => !x.startsWith('--color')), ['e', 'm', 'A', 'B', 'C']);
    const muster = werte.e !== undefined ? werte.e : rest.shift();
    if (muster === undefined) return fehler('Aufruf: grep [OPTION]… MUSTER [DATEI]…\n„grep --help“ liefert weitere Informationen.', 2);
    const re = regexAus(muster, { ere: art === 'egrep' || flags.has('-E'), fest: art === 'fgrep' || flags.has('-F'), i: flags.has('-i'), wort: flags.has('-w'), zeile: flags.has('-x'), global: flags.has('-o') });
    const rek = flags.has('-r') || flags.has('-R');
    let dateien = rest;
    if (rek) { dateien = []; for (const r of rest.length ? rest : ['.']) { const p = pfad(w, r); for (const k of Object.keys(w.fs).filter((k) => (k === p || k.startsWith(p === '/' ? '/' : p + '/')) && typeof w.fs[k] === 'string').sort()) dateien.push(r === '.' ? '.' + k.slice(p.length) : (r.replace(/\/$/, '') + k.slice(p.length))); } }
    const { texte, err } = eingaben(w, dateien, stdin, root, art);
    const mitName = flags.has('-H') || (!flags.has('-h') && (texte.length > 1 || rek));
    const out: string[] = []; let treffer = 0;
    for (const t of texte) {
      if (!istText(t.text)) { if (t.text && re.test(t.text)) out.push(`${art}: ${t.name}: Übereinstimmungen in Binärdatei`); continue; }
      const z = zeilen(t.text); let n = 0;
      const passend = z.map((x, i) => ({ x, i })).filter(({ x }) => { re.lastIndex = 0; return re.test(x) !== flags.has('-v'); });
      n = passend.length; treffer += n;
      if (flags.has('-l')) { if (n) out.push(t.name); continue; }
      if (flags.has('-L')) { if (!n) out.push(t.name); continue; }
      if (flags.has('-c')) { out.push((mitName ? t.name + ':' : '') + n); continue; }
      const max = werte.m ? Number(werte.m) : Infinity;
      for (const { x, i } of passend.slice(0, max)) {
        const vor = (mitName ? t.name + ':' : '') + (flags.has('-n') ? (i + 1) + ':' : '');
        if (flags.has('-o')) { re.lastIndex = 0; for (const m of x.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))) out.push(vor + m[0]); }
        else out.push(vor + x);
      }
    }
    const warnung = art !== 'grep' ? `${art}: warning: ${art} is obsolescent; using grep ${art === 'egrep' ? '-E' : '-F'}` : '';
    const fehlerText = [warnung, ...(flags.has('-s') ? [] : err)].filter(Boolean);
    return { out: out.join('\n'), err: fehlerText.length ? fehlerText.join('\n') : undefined, code: err.length && !treffer ? 2 : treffer || (flags.has('-L') && out.length) ? 0 : 1 };
  };
  b.grep = (w, a, i, r) => grepKern(w, a, i, r, 'grep');
  b.egrep = (w, a, i, r) => grepKern(w, a, i, r, 'egrep');
  b.fgrep = (w, a, i, r) => grepKern(w, a, i, r, 'fgrep');

  // ---------- sed ----------
  b.sed = (w, a, stdin, root) => {
    let inplace = false; let still = false; let ere = false; const skripte: string[] = []; const dateien: string[] = [];
    for (let i = 0; i < a.length; i++) {
      const x = a[i];
      if (x === '-i' || x.startsWith('-i.') || x === '--in-place') inplace = true;
      else if (x === '-n' || x === '--quiet') still = true;
      else if (x === '-E' || x === '-r') ere = true;
      else if (x === '-e') skripte.push(a[++i] ?? '');
      else if (/^-[nEri]+$/.test(x)) { if (x.includes('i')) inplace = true; if (x.includes('n')) still = true; if (/[Er]/.test(x)) ere = true; }
      else if (!skripte.length) skripte.push(x);
      else dateien.push(x);
    }
    if (!skripte.length) return fehler('Aufruf: sed [OPTION] … {Skript-falls-kein-anderes-Skript} [Eingabedatei] …', 1);
    type Cmd = { adr?: { re?: RegExp; nr?: number; bis?: number; reBis?: RegExp }; art: string; re?: RegExp; ersatz?: string; druck?: boolean; text?: string };
    const cmds: Cmd[] = [];
    for (const sk of skripte.flatMap((x) => x.split(/;(?=\s*(?:\/|\d|\$|[sdpqaic]\b|y))/).flatMap((y) => y.split('\n')))) {
      let t = sk.trim(); if (!t) continue; let adr: Cmd['adr'];
      let m = t.match(/^\/((?:\\\/|[^/])*)\/(?:,\s*\/((?:\\\/|[^/])*)\/)?/);
      if (m) { adr = { re: regexAus(m[1].replace(/\\\//g, '/'), { ere }), reBis: m[2] !== undefined ? regexAus(m[2].replace(/\\\//g, '/'), { ere }) : undefined }; t = t.slice(m[0].length).trim(); }
      else if ((m = t.match(/^(\d+|\$)(?:,(\d+|\$))?/))) { adr = { nr: m[1] === '$' ? -1 : Number(m[1]), bis: m[2] === '$' ? Infinity : m[2] ? Number(m[2]) : undefined }; t = t.slice(m[0].length).trim(); }
      if (t[0] === 's') {
        const tr = t[1]; const teile: string[] = []; let cur = ''; let k = 2;
        for (; k < t.length && teile.length < 2; k++) { if (t[k] === '\\' && t[k + 1] === tr) { cur += (tr === '/' ? '/' : '\\' + tr); k++; continue; } if (t[k] === tr) { teile.push(cur); cur = ''; continue; } cur += t[k]; }
        if (teile.length < 2) return fehler(`sed: -e Ausdruck #1, Zeichen ${t.length}: Nicht beendeter »s«-Befehl`);
        const fl = t.slice(k);
        cmds.push({ adr, art: 's', re: regexAus(teile[0], { ere, i: /[iI]/.test(fl), global: fl.includes('g') }), ersatz: teile[1].replace(/\\(\d)/g, '$$$1').replace(/(^|[^\\])&/g, '$1$$&').replace(/\\&/g, '&').replace(/\\n/g, '\n'), druck: fl.includes('p') });
      } else if (/^[dpq=]$/.test(t)) cmds.push({ adr, art: t });
      else if (/^[aic]\\?\s*/.test(t) && /^[aic]/.test(t)) cmds.push({ adr, art: t[0], text: t.slice(1).replace(/^\\?\s*/, '') });
      else if (t[0] === 'y') { const [, von, nach] = t.split(t[1]); cmds.push({ adr, art: 'y', text: von + '\u0000' + nach }); }
      else return fehler(`sed: -e Ausdruck #1, Zeichen 1: Unbekannter Befehl: »${t[0] ?? ''}«`);
    }
    const bearbeite = (text: string) => {
      const aus: string[] = []; const z = zeilen(text); const imBereich = new Map<Cmd, boolean>();
      for (const [i, z0] of z.entries()) {
        let x = z0; let weg = false; let stop = false; const n = i + 1; const letzte = i === z.length - 1;
        for (const c of cmds) {
          let passt = true;
          if (c.adr?.re) { if (c.adr.reBis) { if (imBereich.get(c)) { passt = true; if (c.adr.reBis.test(x)) imBereich.set(c, false); } else if (c.adr.re.test(x)) { passt = true; imBereich.set(c, !c.adr.reBis.test(x) || true); } else passt = false; } else passt = c.adr.re.test(x); }
          else if (c.adr?.nr !== undefined) { const start = c.adr.nr === -1 ? z.length : c.adr.nr; passt = c.adr.bis !== undefined ? n >= start && n <= (c.adr.bis === Infinity ? z.length : c.adr.bis) : n === start || (c.adr.nr === -1 && letzte); }
          if (!passt) continue;
          if (c.art === 's') { c.re!.lastIndex = 0; const neu = x.replace(c.re!, c.ersatz!); if (neu !== x && c.druck) aus.push(neu); x = neu; }
          else if (c.art === 'd') { weg = true; break; }
          else if (c.art === 'p') aus.push(x);
          else if (c.art === '=') aus.push(String(n));
          else if (c.art === 'q') { stop = true; break; }
          else if (c.art === 'a') { aus.push(x); x = c.text!; }
          else if (c.art === 'i') aus.push(c.text!);
          else if (c.art === 'c') { x = c.text!; }
          else if (c.art === 'y') { const [von, nach] = c.text!.split('\u0000'); x = [...x].map((ch) => { const k = von.indexOf(ch); return k < 0 ? ch : nach[k]; }).join(''); }
        }
        if (!weg && !still) aus.push(x);
        if (stop) break;
      }
      return aus.join('\n');
    };
    if (!dateien.length) { if (inplace) return fehler('sed: Keine Eingabedateien'); return ok(bearbeite(stdin)); }
    const out: string[] = []; const err: string[] = [];
    for (const d of dateien) {
      const r = lesen(w, d, root, 'sed');
      if ('err' in r) { err.push(r.err.replace(/^sed: (.*): (.*)$/, 'sed: $1 kann nicht gelesen werden: $2')); continue; }
      const neu = bearbeite(r.text);
      if (inplace) {
        const p = pfad(w, d);
        if (!darfImOrdner(w, p, root)) { err.push(`sed: Temporäre Datei ${p.replace(/[^/]+$/, '')}sedAbC12 kann nicht geöffnet werden: Keine Berechtigung`); continue; }
        w.fs[p] = neu + '\n'; beruehren(w, p);
        if (w.pakete && !w.pakete.geaendert.includes(p)) w.pakete.geaendert.push(p);
      } else out.push(neu);
    }
    return mitFehlern(out.join('\n'), err);
  };

  // ===================== 103.5 und 103.6 Prozesse =====================

  const sichtbar = (w: Welt) => w.prozesse.filter((p) => !p.weg);
  // Wie der Kernel den Prozess nennt (comm): bei Skripten der Name des Skripts
  const kurzname = (p: Prozess) => { if (p.cmd.startsWith('[')) return p.cmd; const t = p.cmd.split(' '); if (/^\/(usr\/)?bin\/(ba)?sh$/.test(t[0]) && t[1] && !t[1].startsWith('-')) return t[1].split('/').pop()!; return t[0].split('/').pop()!.replace(/^-/, ''); };
  const zeitVon = (p: Prozess) => p.zeit ?? '00:00:00';
  b.ps = (w, a) => {
    const roh = a.join(' ');
    const { werte, rest } = mitWert(a.filter((x) => !/^(aux|axu|ef|-ef|-e|-A|a|x|ax|-aux|u)$/.test(x)), ['o', 'u', 'p', 'C'], ['sort', 'pid', 'user']);
    void rest;
    const bsd = /\baux\b|\baxu\b|\bax\b/.test(roh) && !roh.includes('-ef');
    const alle = bsd || /(^|\s)-(e|ef|A)(\s|$)/.test(roh) || /-e/.test(roh) && !roh.includes('--');
    let liste = sichtbar(w).filter((p) => alle || werte.u || werte.user || werte.p || werte.pid || werte.C ? true : p.tty === 'pts/0');
    if (werte.u || werte.user) liste = liste.filter((p) => p.user === (werte.u ?? werte.user));
    if (werte.p || werte.pid) { const ids = (werte.p ?? werte.pid).split(',').map(Number); liste = liste.filter((p) => ids.includes(p.pid)); }
    if (werte.C) liste = liste.filter((p) => p.cmd.split(' ')[0].split('/').pop() === werte.C);
    const leer = (werte.p || werte.pid || werte.C) && !liste.length;
    if (werte.sort) { const s = werte.sort; const feld = s.replace(/^[-+]/, ''); const f = (p: Prozess) => feld === '%cpu' || feld === 'pcpu' ? p.cpu ?? 0 : feld === '%mem' || feld === 'pmem' ? p.mem ?? 0 : feld === 'ni' ? p.ni ?? 0 : feld === 'pid' ? p.pid : 0; liste = [...liste].sort((x, y) => (s.startsWith('-') ? f(y) - f(x) : f(x) - f(y))); }
    const comm = (p: Prozess) => kurzname(p);
    if (werte.o) {
      const felder = werte.o.split(',').map((x) => x.split('=')[0]);
      const kopf: Record<string, string> = { pid: '    PID', ppid: '   PPID', ni: ' NI', pri: 'PRI', user: 'USER    ', comm: 'COMMAND', cmd: 'CMD', args: 'COMMAND', '%cpu': '%CPU', pcpu: '%CPU', '%mem': '%MEM', stat: 'STAT', tty: 'TT      ', etime: '    ELAPSED' };
      const wert = (p: Prozess, f: string) => ({ pid: String(p.pid).padStart(7), ppid: String(p.ppid ?? 1).padStart(7), ni: String(p.ni ?? 0).padStart(3), pri: String(19 - (p.ni ?? 0)).padStart(3), user: p.user.padEnd(8), comm: comm(p), cmd: p.cmd, args: p.cmd, '%cpu': (p.cpu ?? 0).toFixed(1).padStart(4), pcpu: (p.cpu ?? 0).toFixed(1).padStart(4), '%mem': (p.mem ?? 0).toFixed(1).padStart(4), stat: (p.stat ?? 'S').padEnd(4), tty: (p.tty ?? '?').padEnd(8), etime: '      28:14' } as Record<string, string>)[f] ?? '?';
      return ok([felder.map((f) => kopf[f] ?? f.toUpperCase()).join(' '), ...liste.map((p) => felder.map((f) => wert(p, f)).join(' '))].join('\n'));
    }
    // ps -l: lange Liste mit PRI (80 + Nettigkeit) und NI
    if (/(^|\s)-\w*l/.test(roh) && !bsd) return ok(['F S   UID     PID    PPID  C PRI  NI ADDR SZ WCHAN  TTY          TIME CMD', ...liste.map((p) => `${p.user === 'root' ? 4 : 0} ${(p.stat ?? 'S')[0]} ${String(p.user === 'root' ? 0 : p.user === 'max' ? 1001 : 1000).padStart(5)} ${String(p.pid).padStart(7)} ${String(p.ppid ?? 1).padStart(7)}  0 ${String(80 + (p.ni ?? 0)).padStart(3)} ${String(p.ni ?? 0).padStart(3)} - ${String(Math.round((p.vsz ?? 12000) / 4)).padStart(5)} -      ${(p.tty ?? '?').padEnd(8)} ${zeitVon(p)} ${comm(p)}`)].join('\n'));
    if (bsd || roh.includes(' u') || roh === 'u') return ok(['USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND', ...liste.map((p) => `${p.user.padEnd(8)} ${String(p.pid).padStart(7)} ${(p.cpu ?? 0).toFixed(1).padStart(4)} ${(p.mem ?? 0).toFixed(1).padStart(4)} ${String(p.vsz ?? 12000).padStart(6)} ${String(p.rss ?? 4000).padStart(5)} ${(p.tty ?? '?').padEnd(8)} ${(p.stat ?? 'S').padEnd(4)} ${(p.start ?? '08:12').padStart(5)} ${((t) => `${Number(t[0]) * 60 + Number(t[1])}:${t[2]}`)(zeitVon(p).split(':')).padStart(6)} ${p.cmd}`)].join('\n'));
    if (/-ef|-e.*-f|-f/.test(roh)) return ok(['UID          PID    PPID  C STIME TTY          TIME CMD', ...liste.map((p) => `${p.user.padEnd(8)} ${String(p.pid).padStart(7)} ${String(p.ppid ?? 1).padStart(7)}  ${Math.round(p.cpu ?? 0) > 9 ? 9 : Math.round(p.cpu ?? 0)} ${(p.start ?? '08:12').padStart(5)} ${(p.tty ?? '?').padEnd(8)} ${zeitVon(p)} ${p.cmd}`)].join('\n'));
    const r = ok(['    PID TTY          TIME CMD', ...liste.map((p) => `${String(p.pid).padStart(7)} ${(p.tty ?? '?').padEnd(8)} ${zeitVon(p)} ${comm(p)}`)].join('\n'));
    return leer ? { ...r, code: 1 } : r;
  };
  b.top = (w, a) => {
    const batch = a.some((x) => x.includes('b'));
    const nach = [...sichtbar(w)].sort((x, y) => (y.cpu ?? 0) - (x.cpu ?? 0));
    const lauf = nach.filter((p) => p.stat?.startsWith('R')).length;
    const kopf = `top - ${datumText(w.uhr).split(' ')[3].slice(0, 8)} up 28 min,  2 users,  load average: 0,82, 0,61, 0,40\nTasks: ${nach.length + 180} total,   ${lauf} running, ${nach.length + 180 - lauf} sleeping,   0 stopped,   0 zombie\n%Cpu(s): 14,2 us,  2,1 sy,  3,9 ni, 79,6 id,  0,1 wa,  0,0 hi,  0,1 si,  0,0 st\nMiB Mem :  15921,3 total,   9642,7 free,   2355,5 used,   3604,0 buff/cache\nMiB Swap:   1953,9 total,   1953,9 free,      0,0 used.  13185,8 avail Mem\n\n    PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND`;
    const z = nach.slice(0, 15).map((p) => `${String(p.pid).padStart(7)} ${p.user.padEnd(9)} ${String(p.cmd.startsWith('[') ? 'rt' : 20 + (p.ni ?? 0)).padStart(3)} ${String(p.ni ?? 0).padStart(3)} ${String(p.vsz ?? 12000).padStart(7)} ${String(p.rss ?? 4000).padStart(6)} ${String(Math.round((p.rss ?? 4000) * 0.6)).padStart(6)} ${(p.stat ?? 'S')[0]} ${(p.cpu ?? 0).toFixed(1).padStart(5)} ${(p.mem ?? 0).toFixed(1).padStart(5)} ${((t) => `${Number(t[0]) * 60 + Number(t[1])}:${t[2]}.${String(p.pid % 97).padStart(2, '0')}`)(zeitVon(p).split(':')).padStart(9)} ${p.cmd.startsWith('[') ? p.cmd.slice(1, -1) : kurzname(p)}`);
    if (!batch) w.langlaeufer = 'top';
    return ok(kopf + '\n' + z.join('\n') + (batch ? '' : '\n(top aktualisiert sich jetzt alle 3 Sekunden. q oder Strg+C beendet. Im Simulator: Strg+C.)'));
  };
  b.uptime = (w, a) => a.includes('-p') ? ok('up 28 minutes') : ok(` ${datumText(w.uhr).split(' ')[3]} up 28 min,  2 users,  load average: 0,82, 0,61, 0,40`);
  b.pgrep = (w, a) => {
    const { werte, flags, rest } = mitWert(a, ['u']);
    const muster = rest[0] ?? ''; const re = regexAus(muster, { ere: true });
    const t = sichtbar(w).filter((p) => (!werte.u || p.user === werte.u) && re.test(flags.has('-f') ? p.cmd : kurzname(p)));
    return { out: t.map((p) => flags.has('-l') ? `${p.pid} ${kurzname(p)}` : flags.has('-a') ? `${p.pid} ${p.cmd}` : String(p.pid)).join('\n'), code: t.length ? 0 : 1 };
  };
  b.watch = (w, a, _i, root) => {
    const { werte, rest } = mitWert(a, ['n']);
    const r = intern(w, rest.join(' '), '', root);
    w.langlaeufer = ['watch', ...a].join(' ');
    return ok(`Alle ${Number(werte.n ?? 2).toFixed(1).replace('.', ',')}s: ${rest.join(' ')}${' '.repeat(10)}werkstatt: ${datumText(w.uhr)}\n\n${r.out}`);
  };
  b.nice = (w, a, _i, root) => {
    // Alte Schreibweise: nice -10 befehl heißt +10, nice --10 befehl heißt -10
    if (/^--?\d+$/.test(a[0] ?? '')) a = ['-n', a[0].startsWith('--') ? '-' + a[0].slice(2) : a[0].slice(1), ...a.slice(1)];
    const { werte, rest } = mitWert(a, ['n']);
    if (!rest.length) return ok(String(w.nice ?? 0));
    const n = Number(werte.n ?? 10);
    if (n < 0 && !root) return { ...intern(w, rest.join(' '), '', root), err: 'nice: die Nettigkeit kann nicht gesetzt werden: Keine Berechtigung' };
    const alt = w.nice ?? 0; w.nice = Math.max(-20, Math.min(19, alt + n));
    try { const r = intern(w, rest.join(' '), '', root); if (w.langlaeufer) w.langNice = w.nice; return r; } finally { w.nice = alt; }
  };
  b.renice = (w, a, _i, root) => {
    const { werte, rest } = mitWert(a, ['n', 'p', 'u', 'g']);
    let prio = werte.n; const ziele = [...(werte.p ? [werte.p] : []), ...rest];
    if (prio === undefined && ziele.length) prio = ziele.shift()!;
    if (prio === undefined || (!ziele.length && !werte.u)) return fehler('renice: zu wenige Argumente\nGeben Sie „renice --help“ ein, um weitere Informationen zu erhalten.');
    const neu = Number(prio);
    const out: string[] = []; const err: string[] = [];
    const prozesse = werte.u ? sichtbar(w).filter((p) => p.user === werte.u) : ziele.map((z) => sichtbar(w).find((p) => p.pid === Number(z)) ?? ({ pid: Number(z) } as Prozess));
    for (const p of prozesse) {
      if (!p.cmd) { err.push(`renice: Priorität für ${p.pid} konnte nicht ermittelt werden (Prozesskennung): Kein passender Prozess gefunden`); continue; }
      const alt = p.ni ?? 0;
      if (!root && (p.user !== 'lena' || neu < alt)) { err.push(`renice: Priorität für ${p.pid} konnte nicht gesetzt werden (Prozesskennung): Keine Berechtigung`); continue; }
      p.ni = Math.max(-20, Math.min(19, neu));
      out.push(`${p.pid} (Prozesskennung) alte Priorität ${alt}, neue Priorität ${p.ni}`);
    }
    return mitFehlern(out.join('\n'), err);
  };
  b.sleep = (w, a) => { const n = parseFloat(a[0] ?? ''); if (isNaN(n)) return fehler('sleep: fehlender Operand\n„sleep --help“ liefert weitere Informationen.'); if (n > 2) w.langlaeufer = `sleep ${a[0]}`; return ok(); };
  b.yes = (w, a) => { w.langlaeufer = 'yes'; return ok(Array(5).fill(a[0] ?? 'y').join('\n') + '\n…'); };
  b.date = (w, a) => a[0]?.startsWith('+') ? ok(a[0].slice(1).replace(/%Y/g, '2026').replace(/%m/g, '11').replace(/%d/g, '23').replace(/%H/g, datumText(w.uhr).split(' ')[3].slice(0, 2)).replace(/%M/g, datumText(w.uhr).split(' ')[3].slice(3, 5)).replace(/%F/g, '2026-11-23')) : ok(datumText(w.uhr));

  // ---------- Jobs ----------
  b.jobs = (w, a) => ok((w.jobs ?? []).map((j, i, l) => `[${j.nr}]${i === l.length - 1 ? '+' : i === l.length - 2 ? '-' : ' '}  ${a.includes('-l') ? j.pid + ' ' : ''}${(j.status === 'Running' ? 'Läuft' : j.status === 'Stopped' ? 'Angehalten' : 'Fertig').padEnd(24)}${j.cmd}${j.status === 'Running' ? ' &' : ''}`).join('\n'));
  const jobFinden = (w: Welt, s?: string) => { const l = w.jobs ?? []; if (!s || s === '%' || s === '%+' || s === '%%') return l[l.length - 1]; const n = Number(s.replace('%', '')); return l.find((j) => j.nr === n); };
  b.fg = (w, a) => {
    const j = jobFinden(w, a[0]); if (!j) return fehler(`bash: fg: ${a[0] ?? 'aktuell'}: Kein solcher Job.`);
    j.status = 'Running'; const p = w.prozesse.find((x) => x.pid === j.pid); if (p) p.stat = 'S+';
    w.vordergrund = { pid: j.pid, cmd: j.cmd, nr: j.nr };
    return ok(j.cmd);
  };
  b.bg = (w, a) => {
    const j = jobFinden(w, a[0]); if (!j) return fehler(`bash: bg: ${a[0] ?? 'aktuell'}: Kein solcher Job.`);
    if (j.status === 'Running') return fehler(`bash: bg: Job ${j.nr} läuft bereits im Hintergrund`);
    j.status = 'Running'; const p = w.prozesse.find((x) => x.pid === j.pid); if (p) p.stat = 'S';
    return ok(`[${j.nr}]+ ${j.cmd} &`);
  };
  b.nohup = (w, a, _i, root) => {
    if (!a.length) return fehler('nohup: fehlender Operand');
    w.nohup = true;
    const r = intern(w, a.join(' '), '', root);
    // nohup.out im aktuellen Verzeichnis, sonst im Heimatverzeichnis
    const ziel = darfImOrdner(w, (w.cwd === '/' ? '' : w.cwd) + '/nohup.out', root) ? (w.cwd === '/' ? '' : w.cwd) + '/nohup.out' : '/home/lena/nohup.out';
    if (r.out) schreiben(w, ziel, r.out, true, root); else if (!(ziel in w.fs)) schreiben(w, ziel, '', false, root);
    return { out: '', err: "nohup: Eingabe wird ignoriert und Ausgabe an 'nohup.out' angehängt", code: r.code };
  };
  b.screen = (w, a) => a.includes('-ls') || a.includes('-list') ? ok(`There is a screen on:\n\t2871.backup\t(Detached)\n1 Socket in /run/screen/S-lena.`) : a.includes('-r') ? ok(`(Im echten Terminal hängst du dich jetzt an die Sitzung ${a[a.indexOf('-r') + 1] ?? '2871.backup'} an. Mit Strg+A, D löst du dich wieder.)`) : ok('(Im echten Terminal startet jetzt eine neue screen-Sitzung. Mit Strg+A, D löst du dich von ihr, mit screen -r kommst du zurück.)');
  b.tmux = (w, a) => a[0] === 'ls' || a[0] === 'list-sessions' ? ok('build: 1 windows (created Mon Nov 23 08:15:02 2026)') : a[0] === 'attach' || a[0] === 'a' || a[0] === 'attach-session' ? ok(`(Im echten Terminal hängst du dich jetzt an die Sitzung ${a[a.indexOf('-t') + 1] ?? 'build'} an. Mit Strg+B, D löst du dich wieder.)`) : ok('(Im echten Terminal startet jetzt eine neue tmux-Sitzung. Mit Strg+B, D löst du dich von ihr, mit tmux attach kommst du zurück.)');

  return b;
}

export { LANG_LAUFEND, signalNr };
