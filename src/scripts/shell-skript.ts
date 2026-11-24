// Kontrollstrukturen der Bash für den Simulator (Topic 105):
// if/elif/else, for, while/until, case, Funktionen, { … }, test/[ ], read, Arithmetik, set -x/-e,
// neue Shells (bash, bash -l, su -) mit ihren Startdateien.
// Das Modul kennt shell.ts nur über den Kern, den shell.ts beim Laden einträgt.
import type { Welt } from './shell';

type Ergebnis = { out: string; err?: string; code: number; ende?: unknown };

export interface SkriptKern {
  /** Eine einfache Zeile ohne Kontrollstrukturen ausführen. out bleibt roh (mit Zeilenumbrüchen). */
  zeile: (w: Welt, text: string, stdin: string, root: boolean) => { out: string; err: string; code: number; ende?: unknown };
  /** Wörter einer Zeile lexen und erweitern (Variablen, Befehlsersetzung, Wildcards). */
  woerter: (w: Welt, text: string, root: boolean) => string[];
  erweitern: (w: Welt, roh: string, root: boolean, globben?: boolean) => string[];
  variable: (w: Welt, n: string) => string;
  pfad: (w: Welt, p: string) => string;
  darf: (w: Welt, p: string, art: 'r' | 'w' | 'x', root: boolean) => boolean;
  mtime: (w: Welt, p: string) => number;
  muster: (m: string) => RegExp;
  schreiben: (w: Welt, ziel: string, text: string, anhaengen: boolean, root: boolean) => string | null;
  quelle: (w: Welt, p: string, root: boolean) => Ergebnis;
  rechte: (w: Welt, p: string, mode: number, owner: string, group: string) => void;
}
let K: SkriptKern;
export function skriptKern(k: SkriptKern) { K = k; }

// ---------- Zustand, der zur Welt gehört ----------

export interface ShellRahmen { vars: Record<string, string>; env: Record<string, string>; aliase: Record<string, string>; funktionen: Record<string, Knoten[]>; funkText: Record<string, string>; cwd: string; root: boolean; login: boolean; optionen: Optionen }
export interface Optionen { x?: boolean; e?: boolean; u?: boolean }
export interface SkriptStand {
  funktionen: Record<string, Knoten[]>;
  funkText: Record<string, string>;
  lokal: Record<string, [string | undefined, boolean]>[];   // gesicherte Werte für local: [alter Wert, war exportiert]
  funk: number; quelle: number; schleife: number; skript: number;
  optionen: Optionen;
  shells: ShellRahmen[];
  login: boolean;
  gelesen: string[];             // Startdateien der zuletzt gestarteten Shell
  terminal: null | { antworten: string[] };   // ein Befehl läuft gerade im Terminal und darf nach Eingaben fragen
  eingabeTty: boolean;           // stdin des aktuellen Befehls ist das Terminal
  fortsetzung?: string;          // unvollständige Eingabe (PS2-Prompt „> “)
  post: { an: string; von: string; betreff: string; text: string }[];
}
export function stand(w: Welt): SkriptStand {
  const x = w as Welt & { skript?: SkriptStand };
  if (!x.skript) x.skript = { funktionen: {}, funkText: {}, lokal: [], funk: 0, quelle: 0, schleife: 0, skript: 0, optionen: {}, shells: [], login: false, gelesen: [], terminal: null, eingabeTty: false, post: [] };
  return x.skript;
}

/** read wartet auf eine Eingabe im Terminal. Der Befehl wird mit der Antwort noch einmal von vorn ausgeführt. */
export class BrauchtEingabe { bisher = ''; constructor(public prompt: string, public still: boolean) {} }
class Sprung { constructor(public art: 'break' | 'continue' | 'return' | 'exit' | 'halt', public n: number, public code: number) {} }

// ---------- Zerlegen in Fragmente ----------

interface Frag { text: string; z: number; vor?: string; bedVor?: { text: string; op: '&&' | '||' } }
type ZerlegFehler = { fehler: string; eof: boolean; z: number };

function fragmente(text: string): Frag[] | ZerlegFehler {
  const out: Frag[] = []; let cur = ''; let z = 1; let start = 1; let tiefe = 0;
  const offeneHd: { ende: string; quote: boolean; strip: boolean; marke: string }[] = [];
  const hdTexte: Record<string, string> = {};
  const push = () => {
    let t = cur.trim();
    for (const [m, v] of Object.entries(hdTexte)) t = t.split(m).join(v);
    if (t) out.push({ text: t, z: start });
    cur = ''; start = z;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (!cur.trim()) start = z;
    if (c === "'") { const e = text.indexOf("'", i + 1); if (e < 0) return { fehler: `Dateiende beim Suchen nach »'« erreicht.`, eof: true, z }; const s = text.slice(i, e + 1); z += (s.match(/\n/g) ?? []).length; cur += s; i = e; continue; }
    if (c === '"' || c === '`') {
      let j = i + 1; while (j < text.length && text[j] !== c) { if (text[j] === '\\') j++; j++; }
      if (j >= text.length) return { fehler: `Dateiende beim Suchen nach »${c}« erreicht.`, eof: true, z };
      const s = text.slice(i, j + 1); z += (s.match(/\n/g) ?? []).length; cur += s; i = j; continue;
    }
    if (c === '\\') { if (text[i + 1] === '\n') { i++; z++; continue; } cur += c + (text[i + 1] ?? ''); i++; continue; }
    if (c === '#' && (!cur || /\s$/.test(cur)) && tiefe === 0) { while (i < text.length && text[i] !== '\n') i++; i--; continue; }
    if (c === '(') { tiefe++; cur += c; continue; }
    if (c === ')' && tiefe > 0) { tiefe--; cur += c; continue; }
    if (c === '<' && text[i + 1] === '<' && text[i + 2] !== '<' && tiefe === 0) {
      const m = text.slice(i + 2).match(/^(-?)\s*(['"]?)([A-Za-z_][\w]*)\2/);
      if (m) { const marke = `\u0005${Object.keys(hdTexte).length + offeneHd.length}\u0005`; offeneHd.push({ ende: m[3], quote: !!m[2], strip: !!m[1], marke }); cur += '<<< ' + marke; i += 1 + m[0].length; continue; }
    }
    if (c === '\n' || (c === ';' && tiefe === 0)) {
      if (c === '\n') z++;
      if (c === '\n' && offeneHd.length) {
        // Here-Dokumente: die folgenden Zeilen bis zur Endmarke
        let j = i + 1;
        for (const hd of offeneHd.splice(0)) {
          const zeilen: string[] = []; let gefunden = false;
          while (j < text.length || (j === text.length && false)) {
            const e = text.indexOf('\n', j); const zl = text.slice(j, e < 0 ? text.length : e); j = e < 0 ? text.length : e + 1; z++;
            const v = hd.strip ? zl.replace(/^\t+/, '') : zl;
            if (v === hd.ende) { gefunden = true; break; }
            zeilen.push(v);
            if (e < 0) break;
          }
          if (!gefunden) return { fehler: `Das Here-Dokument geht bis zum Dateiende (erwartet wird »${hd.ende}«).`, eof: true, z };
          const k = zeilen.join('\n');
          hdTexte[hd.marke] = hd.quote ? `'${k.replace(/'/g, `'\\''`)}'` : `"${k.replace(/"/g, '\\"')}"`;
        }
        push(); i = j - 1; continue;
      }
      if (tiefe > 0) { cur += c === '\n' ? ' ' : c; continue; }
      if (c === ';' && text[i + 1] === ';') { push(); out.push({ text: ';;', z }); i++; continue; }
      push(); continue;
    }
    cur += c;
  }
  if (offeneHd.length) return { fehler: 'Here-Dokument ohne Ende.', eof: true, z };
  if (tiefe > 0) return { fehler: 'Dateiende beim Suchen nach »)« erreicht.', eof: true, z };
  push();
  // „befehl | while read …“: Die Ausgabe des Befehls wird zur Eingabe der Schleife
  for (const f of out) {
    const i = pipeVorSchluesselwort(f.text);
    if (i >= 0) {
      const op = f.text[i] === '|' && f.text[i + 1] === '|' ? '||' : f.text[i] === '&' ? '&&' : '|';
      if (op === '|') { f.vor = f.text.slice(0, i).trim(); f.text = f.text.slice(i + 1).trim(); }
      else { f.bedVor = { text: f.text.slice(0, i).trim(), op }; f.text = f.text.slice(i + 2).trim(); }
    }
  }
  return out;
}

const SCHLUESSEL = new Set(['if', 'then', 'elif', 'else', 'fi', 'for', 'while', 'until', 'do', 'done', 'case', 'esac', '{', '}', 'function', ';;']);
function pipeVorSchluesselwort(t: string): number {
  let q = ''; let tiefe = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === q) q = ''; else if (c === '\\' && q === '"') i++; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '\\') { i++; continue; }
    if (c === '(') tiefe++; else if (c === ')') tiefe = Math.max(0, tiefe - 1);
    if (c === '|' && tiefe === 0 && t[i + 1] !== '|' && t[i - 1] !== '|' && t[i + 1] !== '&') {
      if (/^\s*(while|until|for|if|case|\{)(\s|$)/.test(t.slice(i + 1))) return i;
    }
    if ((c === '&' || c === '|') && t[i + 1] === c && tiefe === 0) {
      if (/^\s*(while|until|for|if|case|\{)(\s|$)/.test(t.slice(i + 2))) return i;
      i++;
    }
  }
  return -1;
}

// ---------- Parser ----------

export type Knoten =
  | { t: 'cmd'; text: string; z: number }
  | { t: 'if'; zweige: { bed: Knoten[]; rumpf: Knoten[] }[]; sonst?: Knoten[]; nach: string; z: number; vor?: string; bedVor?: { text: string; op: '&&' | '||' } }
  | { t: 'for'; name: string; woerter: string | null; rumpf: Knoten[]; nach: string; z: number; vor?: string; bedVor?: { text: string; op: '&&' | '||' } }
  | { t: 'forc'; init: string; bed: string; schritt: string; rumpf: Knoten[]; nach: string; z: number; vor?: string; bedVor?: { text: string; op: '&&' | '||' } }
  | { t: 'while'; bis: boolean; bed: Knoten[]; rumpf: Knoten[]; nach: string; z: number; vor?: string; bedVor?: { text: string; op: '&&' | '||' } }
  | { t: 'case'; wort: string; faelle: { muster: string[]; rumpf: Knoten[] }[]; nach: string; z: number; vor?: string; bedVor?: { text: string; op: '&&' | '||' } }
  | { t: 'func'; name: string; rumpf: Knoten[]; text: string; z: number }
  | { t: 'gruppe'; rumpf: Knoten[]; nach: string; z: number; vor?: string; bedVor?: { text: string; op: '&&' | '||' } };

class Unfertig { constructor(public z: number) {} }
class Syntax { constructor(public wort: string, public z: number) {} }

class Parser {
  i = 0;
  constructor(public f: Frag[]) {}
  erstes(fr = this.f[this.i]) { return fr ? (fr.text === ';;' ? ';;' : (fr.text.match(/^(\S+)/)?.[1] ?? '')) : ''; }
  rest(fr: Frag, kw: string) { return fr.text.slice(kw.length).trim(); }
  letzteZeile() { return this.f[this.f.length - 1]?.z ?? 1; }
  liste(enden: Set<string> | null): Knoten[] {
    const k: Knoten[] = [];
    while (this.i < this.f.length) {
      const w = this.erstes();
      if (enden && enden.has(w)) return k;
      if (['then', 'elif', 'else', 'fi', 'do', 'done', 'esac', '}', ';;'].includes(w)) throw new Syntax(w, this.f[this.i].z);
      k.push(this.anweisung());
    }
    if (enden) throw new Unfertig(this.letzteZeile());
    return k;
  }
  erwarte(kw: string) {
    const fr = this.f[this.i];
    if (!fr) throw new Unfertig(this.letzteZeile());
    if (this.erstes(fr) !== kw) throw new Syntax(this.erstes(fr), fr.z);
    const r = this.rest(fr, kw);
    if (r) this.f[this.i] = { text: r, z: fr.z }; else this.i++;
  }
  abschluss(kw: string): string {
    const fr = this.f[this.i];
    if (!fr) throw new Unfertig(this.letzteZeile());
    if (this.erstes(fr) !== kw) throw new Syntax(this.erstes(fr), fr.z);
    const r = this.rest(fr, kw); this.i++;
    if (r && !/^(\d?>>?|&>>?|<<?<?|\||&&|&|2>&1)/.test(r)) throw new Syntax(r.split(/\s+/)[0], fr.z);
    return r;
  }
  anweisung(): Knoten {
    const fr = this.f[this.i]; const w = this.erstes(fr); const vor = fr.vor;
    if (fr.bedVor) { const b = fr.bedVor; this.f[this.i] = { text: fr.text, z: fr.z, vor: fr.vor }; const k = this.anweisung(); if ('nach' in k) k.bedVor = b; else return { t: 'cmd', text: `${b.text} ${b.op} ${fr.text}`, z: fr.z }; return k; }
    if (w === 'if') {
      this.erwarte('if');
      const zweige: { bed: Knoten[]; rumpf: Knoten[] }[] = [];
      let bed = this.liste(new Set(['then'])); this.erwarte('then');
      let rumpf = this.liste(new Set(['elif', 'else', 'fi'])); zweige.push({ bed, rumpf });
      while (this.erstes() === 'elif') { this.erwarte('elif'); bed = this.liste(new Set(['then'])); this.erwarte('then'); rumpf = this.liste(new Set(['elif', 'else', 'fi'])); zweige.push({ bed, rumpf }); }
      let sonst: Knoten[] | undefined;
      if (this.erstes() === 'else') { this.erwarte('else'); sonst = this.liste(new Set(['fi'])); }
      return { t: 'if', zweige, sonst, nach: this.abschluss('fi'), z: fr.z, vor };
    }
    if (w === 'for') {
      const c = fr.text.match(/^for\s*\(\((.*)\)\)\s*(.*)$/s);
      let k: Knoten;
      if (c) {
        const teile = c[1].split(';');
        if (teile.length !== 3) throw new Syntax('((', fr.z);
        if (c[2]) this.f[this.i] = { text: c[2], z: fr.z }; else this.i++;
        k = { t: 'forc', init: teile[0].trim(), bed: teile[1].trim(), schritt: teile[2].trim(), rumpf: [], nach: '', z: fr.z, vor };
      } else {
        const m = fr.text.match(/^for\s+([A-Za-z_]\w*)(?:\s+in(?:\s+(.*))?)?$/s);
        if (!m) { const n = fr.text.split(/\s+/)[1]; throw new Syntax(n ?? 'newline', fr.z); }
        this.i++;
        k = { t: 'for', name: m[1], woerter: /\sin(\s|$)/.test(fr.text) ? (m[2] ?? '') : null, rumpf: [], nach: '', z: fr.z, vor };
      }
      this.erwarte('do'); k.rumpf = this.liste(new Set(['done'])); k.nach = this.abschluss('done');
      return k;
    }
    if (w === 'while' || w === 'until') {
      this.erwarte(w); const bed = this.liste(new Set(['do'])); this.erwarte('do');
      const rumpf = this.liste(new Set(['done']));
      return { t: 'while', bis: w === 'until', bed, rumpf, nach: this.abschluss('done'), z: fr.z, vor };
    }
    if (w === 'case') {
      const m = fr.text.match(/^case\s+(.+?)\s+in(?:\s+(.*))?$/s);
      if (!m) throw new Unfertig(fr.z);
      if (m[2]) this.f[this.i] = { text: m[2], z: fr.z }; else this.i++;
      const faelle: { muster: string[]; rumpf: Knoten[] }[] = [];
      while (true) {
        const g = this.f[this.i];
        if (!g) throw new Unfertig(this.letzteZeile());
        if (this.erstes(g) === 'esac') break;
        const t = g.text.replace(/^\(/, '');
        const k = schliessendeKlammer(t);
        if (k < 0) throw new Syntax(this.erstes(g), g.z);
        const muster = t.slice(0, k).split('|').map((x) => x.trim());
        const r = t.slice(k + 1).trim();
        if (r) this.f[this.i] = { text: r, z: g.z }; else this.i++;
        const rumpf = this.liste(new Set([';;', 'esac']));
        faelle.push({ muster, rumpf });
        if (this.erstes() === ';;') this.i++;
      }
      return { t: 'case', wort: m[1], faelle, nach: this.abschluss('esac'), z: fr.z, vor };
    }
    if (w === '{') {
      this.erwarte('{'); const rumpf = this.liste(new Set(['}']));
      return { t: 'gruppe', rumpf, nach: this.abschluss('}'), z: fr.z, vor };
    }
    const fm = fr.text.match(/^function\s+([A-Za-z_][\w.:-]*)\s*(?:\(\s*\))?\s*(.*)$/s) ?? fr.text.match(/^([A-Za-z_][\w.:-]*)\s*\(\s*\)\s*(.*)$/s);
    if (fm) {
      if (fm[2]) this.f[this.i] = { text: fm[2], z: fr.z }; else this.i++;
      if (this.i >= this.f.length) throw new Unfertig(fr.z);
      const anfang = this.i;
      this.erwarte('{');
      const rumpf = this.liste(new Set(['}']));
      const zeilen = this.f.slice(anfang, this.i).map((x) => x.text.replace(/^\{\s*/, '')).filter(Boolean);
      this.abschluss('}');
      return { t: 'func', name: fm[1], rumpf, text: `${fm[1]} () \n{ \n${zeilen.map((x) => '    ' + x).join('\n')}\n}`, z: fr.z };
    }
    this.i++;
    let text = fr.text;
    const ar = text.match(/^\(\((.*?)\)\)(.*)$/s);
    if (ar) text = `let '${ar[1].trim().replace(/'/g, '')}'${ar[2]}`;
    return { t: 'cmd', text, z: fr.z };
  }
}
function schliessendeKlammer(t: string) {
  let q = '';
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === q) q = ''; continue; }
    if (c === "'" || c === '"') { q = c; continue; }
    if (c === '\\') { i++; continue; }
    if (c === ')') return i;
  }
  return -1;
}

type Zerlegt = { knoten: Knoten[] } | { fehler: string; eof: boolean; z: number };
export function zerlegenProgramm(text: string): Zerlegt {
  const f = fragmente(text);
  if (!Array.isArray(f)) return f;
  const p = new Parser(f);
  try { return { knoten: p.liste(null) }; }
  catch (e) {
    if (e instanceof Unfertig) return { fehler: 'Syntaxfehler: Unerwartetes Dateiende.', eof: true, z: e.z };
    if (e instanceof Syntax) return { fehler: `Syntaxfehler beim unerwarteten Wort »${e.wort}«`, eof: false, z: e.z };
    throw e;
  }
}

/** Braucht die Zeile den Interpreter für Kontrollstrukturen? */
export function istZusammengesetzt(text: string): boolean {
  if (text.includes('\n')) return true;
  if (/['"`]/.test(text)) { const f = fragmente(text); if (!Array.isArray(f) && f.eof) return true; }
  if (/^\s*\(\(/.test(text)) return true;
  if (!/\b(if|then|else|elif|fi|for|while|until|do|done|case|esac|function)\b|[{}]|\(\s*\)|<</.test(text)) return false;
  const f = fragmente(text);
  if (!Array.isArray(f)) return f.eof;
  return f.some((x) => x.vor !== undefined || SCHLUESSEL.has(x.text === ';;' ? ';;' : (x.text.match(/^(\S+)/)?.[1] ?? '')) || /^[A-Za-z_][\w.:-]*\s*\(\s*\)/.test(x.text) || /^\(\(/.test(x.text) || x.text.includes('<<< \u0005'));
}

// ---------- Ausführen ----------

interface Ctx { root: boolean; ein: { rest: string }; tty: boolean; out: string; err: string; misch: string; name?: string; bedingung: number }

function neuCtx(stdin: string, root: boolean, tty: boolean, name?: string): Ctx {
  return { root, ein: { rest: stdin }, tty, out: '', err: '', misch: '', name, bedingung: 0 };
}
const mitNL = (s: string) => (s && !s.endsWith('\n') ? s + '\n' : s);

function setzen(w: Welt, n: string, v: string) { if (n in w.env) w.env[n] = v; else w.vars[n] = v; }

function einfach(w: Welt, k: { text: string; z: number }, ctx: Ctx): number {
  const st = stand(w);
  let text = k.text; let neg = false;
  if (/^!\s/.test(text)) { neg = true; text = text.slice(1).trim(); }
  st.eingabeTty = ctx.tty;
  let r: ReturnType<SkriptKern['zeile']>;
  try { r = K.zeile(w, text, ctx.ein.rest, ctx.root); }
  catch (e) { if (e instanceof BrauchtEingabe) e.bisher = ctx.misch + e.bisher; throw e; }
  // read verbraucht eine Zeile der gemeinsamen Eingabe (while read … done < datei)
  if (/^(\w+=\S*\s+)*read(\s|$)/.test(text) && !/[|<]/.test(text)) ctx.ein.rest = ctx.ein.rest.replace(/^[^\n]*(\n|$)/, '');
  let err = r.err;
  if (err && ctx.name) err = err.split('\n').map((l) => (l.startsWith('bash: ') ? `${ctx.name}: Zeile ${k.z}: ${l.slice(6)}` : l)).join('\n');
  if (err) { ctx.err += mitNL(err); ctx.misch += mitNL(err); }
  if (r.out) { ctx.out += r.out; ctx.misch += r.out; }
  const code = neg ? (r.code ? 0 : 1) : r.code;
  w.letzterCode = code;
  const ende = r.ende;
  if (ende) {
    const m = String(ende).match(/^(break|continue|return):?(\d*)$/);
    if (m) throw new Sprung(m[1] as 'break', Number(m[2] || 1), code);
    throw new Sprung('exit', 0, code);
  }
  if (w.langlaeufer) throw new Sprung('halt', 0, code);
  if (code !== 0 && st.optionen.e && !ctx.bedingung && !neg && !/&&|\|\|/.test(text)) throw new Sprung('exit', 0, code);
  return code;
}

function liste(w: Welt, ks: Knoten[], ctx: Ctx): number {
  let code = 0;
  for (const k of ks) code = knoten(w, k, ctx);
  return code;
}
function bedingung(w: Welt, ks: Knoten[], ctx: Ctx): number {
  ctx.bedingung++;
  try { return liste(w, ks, ctx); } finally { ctx.bedingung--; }
}

const MAX_RUNDEN = 10000;
function schleife(w: Welt, ctx: Ctx, runde: () => boolean, rumpf: Knoten[]): number {
  const st = stand(w); let code = 0; let n = 0;
  st.schleife++;
  try {
    while (runde()) {
      if (++n > MAX_RUNDEN) { const m = `(Der Simulator bricht die Schleife nach ${MAX_RUNDEN} Durchläufen ab. Eine echte Shell liefe weiter, bis du Strg+C drückst.)\n`; ctx.err += m; ctx.misch += m; return 130; }
      try { code = liste(w, rumpf, ctx); }
      catch (e) {
        if (e instanceof Sprung && (e.art === 'break' || e.art === 'continue')) {
          if (e.n > 1) { e.n--; throw e; }
          code = 0;
          if (e.art === 'break') break; else continue;
        }
        throw e;
      }
    }
  } finally { st.schleife--; }
  return code;
}

function knoten(w: Welt, k: Knoten, ctx: Ctx): number {
  if (k.t === 'cmd') return einfach(w, k, ctx);
  if (k.t === 'func') { const st = stand(w); st.funktionen[k.name] = k.rumpf; st.funkText[k.name] = k.text; return 0; }
  // a && { …; } bzw. a || while …: erst die Bedingung davor
  if ('bedVor' in k && k.bedVor) {
    const c = einfach(w, { text: k.bedVor.text, z: k.z }, { ...ctx, bedingung: ctx.bedingung + 1, get out() { return ctx.out; }, set out(v) { ctx.out = v; }, get err() { return ctx.err; }, set err(v) { ctx.err = v; }, get misch() { return ctx.misch; }, set misch(v) { ctx.misch = v; } } as Ctx);
    if ((k.bedVor.op === '&&') !== (c === 0)) return c;
  }
  // Umleitungen und Pipes rund um eine Kontrollstruktur
  let ctxInnen = ctx;
  const vor = 'vor' in k ? k.vor : undefined; const nach = 'nach' in k ? k.nach : '';
  let alt: { vars: Record<string, string>; env: Record<string, string> } | null = null;
  if (vor) {
    const r = K.zeile(w, vor, ctx.ein.rest, ctx.root);
    if (r.err) { ctx.err += mitNL(r.err); ctx.misch += mitNL(r.err); }
    ctxInnen = { ...neuCtx(r.out, ctx.root, false, ctx.name), bedingung: ctx.bedingung };
    // Die Schleife hinter einer Pipe läuft in einer Subshell: Variablen gehen danach verloren
    alt = { vars: { ...w.vars }, env: { ...w.env } };
  }
  const u = nachZerlegen(nach);
  if (u.ein !== undefined) {
    const z = K.erweitern(w, u.ein, ctx.root)[0] ?? ''; const p = K.pfad(w, z);
    if (!(p in w.fs)) { const m = `bash: ${z}: Datei oder Verzeichnis nicht gefunden\n`; ctx.err += m; ctx.misch += m; return 1; }
    if (!K.darf(w, p, 'r', ctx.root || w.root)) { const m = `bash: ${z}: Keine Berechtigung\n`; ctx.err += m; ctx.misch += m; return 1; }
    ctxInnen = { ...neuCtx(w.fs[p] ?? '', ctx.root, false, ctx.name), bedingung: ctx.bedingung };
  }
  if (u.hier !== undefined) ctxInnen = { ...neuCtx(K.erweitern(w, u.hier, ctx.root, false).join(' ') + '\n', ctx.root, false, ctx.name), bedingung: ctx.bedingung };
  const fangen = u.aus !== undefined || u.pipe !== undefined || u.err !== undefined;
  if (fangen && ctxInnen === ctx) ctxInnen = { ...neuCtx(ctx.ein.rest, ctx.root, ctx.tty, ctx.name), ein: ctx.ein, bedingung: ctx.bedingung };
  else if (fangen) ctxInnen = { ...ctxInnen, out: '', err: '', misch: '' };
  let code: number;
  try { code = struktur(w, k, ctxInnen); }
  catch (e) { if (e instanceof BrauchtEingabe && ctxInnen !== ctx) e.bisher = ctx.misch + e.bisher; throw e; }
  finally {
    if (alt) { w.vars = alt.vars; w.env = alt.env; }
    if (ctxInnen !== ctx && !fangen) { ctx.out += ctxInnen.out; ctx.err += ctxInnen.err; ctx.misch += ctxInnen.misch; }
  }
  if (fangen) {
    let out = ctxInnen.out; let err = ctxInnen.err;
    if (u.err === '&1') { out = ctxInnen.misch; err = ''; }
    else if (u.err !== undefined) { const z = K.erweitern(w, u.err, ctx.root)[0]; if (z !== '/dev/null') K.schreiben(w, z, err, u.errAnh, ctx.root || w.root); err = ''; }
    if (err) { ctx.err += err; ctx.misch += err; }
    if (u.aus !== undefined) {
      const z = K.erweitern(w, u.aus, ctx.root)[0] ?? '';
      const e = K.schreiben(w, z, out, u.anh, ctx.root || w.root);
      if (e) { const m = `bash: ${z}: ${e}\n`; ctx.err += m; ctx.misch += m; return 1; }
    } else if (u.pipe !== undefined) {
      const r = K.zeile(w, u.pipe, out, ctx.root);
      if (r.err) { ctx.err += mitNL(r.err); ctx.misch += mitNL(r.err); }
      ctx.out += r.out; ctx.misch += r.out; code = r.code;
    } else { ctx.out += out; ctx.misch += out; }
  }
  w.letzterCode = code;
  if (u.und !== undefined && code === 0) return einfach(w, { text: u.und, z: k.z }, ctx);
  if (u.oder !== undefined && code !== 0) return einfach(w, { text: u.oder, z: k.z }, ctx);
  return code;
}

function nachZerlegen(nach: string) {
  const u: { ein?: string; hier?: string; aus?: string; anh: boolean; err?: string; errAnh: boolean; pipe?: string; und?: string; oder?: string } = { anh: false, errAnh: false };
  let r = nach.trim();
  while (r) {
    let m;
    if ((m = r.match(/^&&\s*(.*)$/s))) { u.und = m[1]; break; }
    if ((m = r.match(/^\|\|\s*(.*)$/s))) { u.oder = m[1]; break; }
    if ((m = r.match(/^\|\s*(.*)$/s))) { u.pipe = m[1]; break; }
    if ((m = r.match(/^2>&1\s*/))) { u.err = '&1'; r = r.slice(m[0].length); continue; }
    if ((m = r.match(/^<<<\s*("(?:[^"\\]|\\.)*"|'[^']*'|[^\s|&;<>]+)\s*/s))) { u.hier = m[1]; r = r.slice(m[0].length); continue; }
    if ((m = r.match(/^(&>>?|2>>?|1?>>?|<)\s*("[^"]*"|'[^']*'|[^\s|&;<>]+)\s*/))) {
      const op = m[1]; const z = m[2];
      if (op === '<') u.ein = z;
      else if (op.startsWith('2')) { u.err = z; u.errAnh = op.endsWith('>>'); }
      else { u.aus = z; u.anh = op.endsWith('>>'); if (op.startsWith('&')) u.err = '&1'; }
      r = r.slice(m[0].length); continue;
    }
    if (r === '&') break;
    break;
  }
  return u;
}

function struktur(w: Welt, k: Knoten, ctx: Ctx): number {
  switch (k.t) {
    case 'if':
      for (const z of k.zweige) if (bedingung(w, z.bed, ctx) === 0) return liste(w, z.rumpf, ctx);
      return k.sonst ? liste(w, k.sonst, ctx) : 0;
    case 'for': {
      const werte = k.woerter === null ? (w.args[w.args.length - 1]?.slice(1) ?? []) : K.woerter(w, k.woerter, ctx.root);
      let i = 0;
      return schleife(w, ctx, () => { if (i >= werte.length) return false; setzen(w, k.name, werte[i++]); return true; }, k.rumpf);
    }
    case 'forc': {
      if (k.init) rechnen(w, k.init);
      let erste = true;
      return schleife(w, ctx, () => { if (!erste && k.schritt) rechnen(w, k.schritt); erste = false; return !k.bed || rechnen(w, k.bed) !== 0; }, k.rumpf);
    }
    case 'while':
      return schleife(w, ctx, () => { const c = bedingung(w, k.bed, ctx); return k.bis ? c !== 0 : c === 0; }, k.rumpf);
    case 'case': {
      const wort = K.erweitern(w, k.wort, ctx.root, false).join(' ');
      for (const f of k.faelle) {
        if (f.muster.some((m) => K.muster(K.erweitern(w, m, ctx.root, false).join(' ')).test(wort))) return liste(w, f.rumpf, ctx);
      }
      return 0;
    }
    case 'gruppe': return liste(w, k.rumpf, ctx);
    default: return 0;
  }
}

function sprungAuswerten(e: unknown, ctx: Ctx): { code: number; ende?: string } {
  if (e instanceof Sprung) {
    if (e.art === 'exit') return { code: e.code, ende: 'exit' };
    if (e.art === 'return') return { code: e.code, ende: 'return' };
    return { code: e.code };
  }
  throw e;
}
function ergebnis(ctx: Ctx, code: number, ende?: string): Ergebnis & { misch: string } {
  const o = ctx.out;
  const out = o.endsWith('\n') ? o.slice(0, -1) : o ? o + '\u0000ohneNL' : '';
  return { out, err: ctx.err.replace(/\n$/, '') || undefined, code, misch: ctx.misch.replace(/\n$/, ''), ...(ende ? { ende } : {}) };
}

/** Einen ganzen Programmtext ausführen (Skript, source, bash -c, mehrzeilige Eingabe im Terminal). */
export function programm(w: Welt, text: string, stdin: string, root: boolean, o: { name?: string; tty?: boolean } = {}): Ergebnis & { misch: string } {
  const p = zerlegenProgramm(text);
  const ctx = neuCtx(stdin, root, o.tty ?? stand(w).eingabeTty, o.name);
  if ('fehler' in p) {
    const m = o.name ? `${o.name}: Zeile ${p.z}: ${p.fehler}` : `bash: ${p.fehler}`;
    return { out: '', err: m, code: 2, misch: m };
  }
  let code = 0; let ende: string | undefined;
  try { code = liste(w, p.knoten, ctx); }
  catch (e) { ({ code, ende } = sprungAuswerten(e, ctx)); }
  w.letzterCode = code;
  return ergebnis(ctx, code, ende);
}

/** Eine Shell-Funktion aufrufen. Sie sieht ihre Argumente als $1, $2 … */
export function funktionAufrufen(w: Welt, name: string, args: string[], stdin: string, root: boolean): Ergebnis | null {
  const st = stand(w); const rumpf = st.funktionen[name];
  if (!rumpf) return null;
  if (st.funk > 100) return { out: '', err: `bash: ${name}: Zu tiefe Rekursion. (Der Simulator bricht nach 100 Aufrufen ab.)`, code: 1 };
  const ctx = neuCtx(stdin, root, st.eingabeTty);
  w.args.push([w.args[w.args.length - 1]?.[0] ?? 'bash', ...args]);
  st.lokal.push({}); st.funk++;
  let code = 0; let ende: string | undefined;
  try { code = liste(w, rumpf, ctx); }
  catch (e) { ({ code, ende } = sprungAuswerten(e, ctx)); if (ende === 'return') ende = undefined; }
  finally {
    w.args.pop(); st.funk--;
    for (const [n, [v, exp]] of Object.entries(st.lokal.pop() ?? {})) {
      delete w.vars[n]; delete w.env[n];
      if (v !== undefined) { if (exp) w.env[n] = v; else w.vars[n] = v; }
    }
  }
  const r = ergebnis(ctx, code, ende);
  return { out: r.out, err: r.err, code: r.code, misch: r.misch, ...(ende ? { ende } : {}) } as Ergebnis;
}

// ---------- Arithmetik: $(( )), (( )), let ----------

export class RechenFehler { constructor(public text: string) {} }
export function rechnen(w: Welt, ausdruck: string): number {
  const toks = ausdruck.match(/\s+|0[xX][0-9a-fA-F]+|\d+|[A-Za-z_]\w*|\$\{?[A-Za-z_]\w*\}?|\$[0-9#?]|\*\*=?|<<=?|>>=?|\+\+|--|&&|\|\||[<>=!]=|[-+*/%&|^]=|[-+*/%<>=!~&|^?:(),]/g) ?? [];
  const t = toks.filter((x) => !/^\s+$/.test(x));
  if (t.join('').replace(/\s/g, '') !== ausdruck.replace(/\s/g, '')) throw new RechenFehler(`${ausdruck.trim()}: Syntaxfehler im Ausdruck.`);
  let i = 0;
  const wert = (n: string): number => { const v = K.variable(w, n).trim(); if (!v) return 0; if (/^-?\d+$/.test(v)) return parseInt(v, 10); if (/^[A-Za-z_]\w*$/.test(v)) return wert(v); return rechnen(w, v); };
  const zahl = (s: string) => (/^0[xX]/.test(s) ? parseInt(s, 16) : /^0\d/.test(s) ? parseInt(s, 8) : parseInt(s, 10));
  const PRIO: Record<string, number> = { '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '>': 7, '<=': 7, '>=': 7, '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10, '**': 11 };
  const bin = (a: number, op: string, b: number): number => {
    switch (op) {
      case '+': return a + b; case '-': return a - b; case '*': return a * b;
      case '/': case '%': if (b === 0) throw new RechenFehler(`${ausdruck.trim()}: Division durch 0.`); return op === '/' ? Math.trunc(a / b) : a % b;
      case '**': return a ** b; case '<<': return a << b; case '>>': return a >> b;
      case '<': return +(a < b); case '>': return +(a > b); case '<=': return +(a <= b); case '>=': return +(a >= b);
      case '==': return +(a === b); case '!=': return +(a !== b); case '&': return a & b; case '|': return a | b; case '^': return a ^ b;
      case '&&': return +(!!a && !!b); case '||': return +(!!a || !!b);
    }
    throw new RechenFehler(`${ausdruck.trim()}: Syntaxfehler im Ausdruck.`);
  };
  const name = (s: string) => s.replace(/^\$\{?|\}$/g, '');
  const primaer = (): number => {
    const x = t[i++];
    if (x === undefined) throw new RechenFehler(`${ausdruck.trim()}: Syntaxfehler: Operator erwartet`);
    if (x === '(') { const v = komma(); if (t[i++] !== ')') throw new RechenFehler(`${ausdruck.trim()}: »)« erwartet.`); return v; }
    if (x === '-') return -primaer(); if (x === '+') return primaer(); if (x === '!') return +!primaer(); if (x === '~') return ~primaer();
    if (x === '++' || x === '--') { const n = t[i++]; const v = wert(name(n)) + (x === '++' ? 1 : -1); setzen(w, name(n), String(v)); return v; }
    if (/^\d/.test(x)) return zahl(x);
    if (/^\$?\{?[A-Za-z_#?0-9]/.test(x)) {
      const n = name(x);
      if (t[i] === '++' || t[i] === '--') { const v = wert(n); setzen(w, n, String(v + (t[i] === '++' ? 1 : -1))); i++; return v; }
      if (t[i] === '=' || /^([-+*/%&|^]|\*\*|<<|>>)=$/.test(t[i] ?? '')) {
        const op = t[i++]; const r = zuweisung();
        const v = op === '=' ? r : bin(wert(n), op.slice(0, -1), r);
        setzen(w, n, String(v)); return v;
      }
      return wert(n);
    }
    throw new RechenFehler(`${ausdruck.trim()}: Syntaxfehler: Operator erwartet`);
  };
  const ausd = (min: number): number => {
    let a = primaer();
    while (t[i] && PRIO[t[i]] && PRIO[t[i]] >= min) { const op = t[i++]; const b = ausd(op === '**' ? PRIO[op] : PRIO[op] + 1); a = bin(a, op, b); }
    return a;
  };
  const zuweisung = (): number => { const c = ausd(1); if (t[i] === '?') { i++; const a = zuweisung(); if (t[i++] !== ':') throw new RechenFehler(`${ausdruck.trim()}: Syntaxfehler im Ausdruck.`); const b = zuweisung(); return c ? a : b; } return c; };
  const komma = (): number => { let v = zuweisung(); while (t[i] === ',') { i++; v = zuweisung(); } return v; };
  if (!t.length) return 0;
  const v = komma();
  if (i < t.length) throw new RechenFehler(`${ausdruck.trim()}: Syntaxfehler im Ausdruck. (Fehlerverursachendes Zeichen ist \"${t.slice(i).join(' ')}\").`);
  return v;
}

// ---------- Parametererweiterung ${…} ----------

export function parameter(w: Welt, innen: string, root: boolean): string | null {
  let m;
  const wert = (n: string) => K.variable(w, n);
  const gesetzt = (n: string) => /^[0-9#?$@*!-]$/.test(n) ? true : n in w.env || n in w.vars;
  const wort = (s: string) => K.erweitern(w, s, root, false).join(' ');
  if ((m = innen.match(/^#([A-Za-z_]\w*|[0-9@*])$/))) return String(m[1] === '@' || m[1] === '*' ? (w.args[w.args.length - 1]?.length ?? 1) - 1 : wert(m[1]).length);
  if ((m = innen.match(/^([A-Za-z_]\w*|[0-9])(:?)([-=+?])(.*)$/s))) {
    const [, n, doppel, op, rest] = m; const v = wert(n);
    const leer = doppel ? v === '' : !gesetzt(n);
    if (op === '-') return leer ? wort(rest) : v;
    if (op === '=') { if (leer) { const x = wort(rest); setzen(w, n, x); return x; } return v; }
    if (op === '+') return leer ? '' : wort(rest);
    if (op === '?') { if (leer) throw new RechenFehler(`${n}: ${rest ? wort(rest) : 'Parameter ist leer oder nicht gesetzt.'}`); return v; }
  }
  if ((m = innen.match(/^([A-Za-z_]\w*|[0-9])(##?|%%?)(.*)$/s))) {
    const [, n, op, mu] = m; const v = wert(n);
    const re = K.muster(wort(mu)).source.replace(/^\^|\$$/g, '');
    const gierig = op.length === 2; const q = gierig ? re : re.replace(/\.\*/g, '.*?');
    if (op[0] === '#') { const r = v.match(new RegExp('^(' + q + ')')); return r ? v.slice(r[1].length) : v; }
    // Vom Ende: kürzestes bzw. längstes passendes Ende suchen
    for (let k = gierig ? 0 : v.length; gierig ? k <= v.length : k >= 0; k += gierig ? 1 : -1) if (new RegExp('^(?:' + re + ')$').test(v.slice(k))) return v.slice(0, k);
    return v;
  }
  if ((m = innen.match(/^([A-Za-z_]\w*)(\/\/?)([^/]*)(?:\/(.*))?$/s))) {
    const [, n, op, mu, ers] = m; const re = K.muster(wort(mu)).source.replace(/^\^|\$$/g, '');
    return wert(n).replace(new RegExp(re, op === '//' ? 'g' : ''), wort(ers ?? ''));
  }
  if ((m = innen.match(/^([A-Za-z_]\w*):(-?\d+)(?::(\d+))?$/))) {
    const v = wert(m[1]); const a = Number(m[2]); const s = a < 0 ? Math.max(0, v.length + a) : a;
    return m[3] !== undefined ? v.substr(s, Number(m[3])) : v.slice(s);
  }
  if ((m = innen.match(/^([A-Za-z_]\w*|[0-9@*#?$!-])$/))) return wert(m[1]);
  return null;
}

// ---------- test und [ ] ----------

function zielAufloesen(w: Welt, p: string): string | null {
  let z = K.pfad(w, p);
  for (let i = 0; i < 40; i++) {
    if (!(z in w.fs)) return null;
    const c = w.fs[z];
    if (typeof c === 'string' && c.startsWith('-> ')) { const t = c.slice(3); z = K.pfad(w, t.startsWith('/') ? t : (z.slice(0, z.lastIndexOf('/')) || '/') + '/' + t); continue; }
    return z;
  }
  return null;
}
const UNAER = new Set(['-e', '-f', '-d', '-r', '-w', '-x', '-s', '-L', '-h', '-z', '-n', '-b', '-c', '-p', '-S', '-u', '-g', '-k', '-O', '-G', '-t', '-a']);
const BINAER = new Set(['=', '==', '!=', '-eq', '-ne', '-lt', '-le', '-gt', '-ge', '-nt', '-ot', '-ef', '<', '>']);
class TestFehler { constructor(public text: string) {} }

function testUnaer(w: Welt, op: string, a: string, root: boolean): boolean {
  if (op === '-z') return a === ''; if (op === '-n') return a !== '';
  if (op === '-t') return false;
  if (op === '-L' || op === '-h') { const p = K.pfad(w, a); return typeof w.fs[p] === 'string' && w.fs[p]!.startsWith('-> '); }
  const p = zielAufloesen(w, a);
  if (p === null) return false;
  const c = w.fs[p];
  switch (op) {
    case '-e': case '-a': return true;
    case '-f': return typeof c === 'string' && !p.startsWith('/dev/') && !p.startsWith('/proc/') || (typeof c === 'string' && p.startsWith('/proc/'));
    case '-d': return c === null;
    case '-b': return /^\/dev\/(sd[a-z]\d*|nvme\d+n\d+(p\d+)?|sr\d|vd[a-z]\d*)$/.test(p);
    case '-c': return /^\/dev\/(null|zero|random|urandom|tty\d*)$/.test(p);
    case '-s': return c === null || (typeof c === 'string' && c.length > 0);
    case '-r': return K.darf(w, p, 'r', root); case '-w': return K.darf(w, p, 'w', root); case '-x': return K.darf(w, p, 'x', root);
    default: return false;
  }
}
function testBinaer(w: Welt, a: string, op: string, b: string): boolean {
  if (op === '=' || op === '==') return a === b; if (op === '!=') return a !== b;
  if (op === '<') return a < b; if (op === '>') return a > b;
  if (op === '-nt' || op === '-ot' || op === '-ef') {
    const pa = zielAufloesen(w, a); const pb = zielAufloesen(w, b);
    if (op === '-ef') return !!pa && pa === pb;
    if (!pa || !pb) return op === '-nt' ? !!pa : !!pb;
    return op === '-nt' ? K.mtime(w, pa) > K.mtime(w, pb) : K.mtime(w, pa) < K.mtime(w, pb);
  }
  const zahl = (x: string) => { if (!/^\s*-?\d+\s*$/.test(x)) throw new TestFehler(`${x}: Ganzzahliger Ausdruck erwartet.`); return parseInt(x, 10); };
  const x = zahl(a); const y = zahl(b);
  return { '-eq': x === y, '-ne': x !== y, '-lt': x < y, '-le': x <= y, '-gt': x > y, '-ge': x >= y }[op] ?? false;
}
function testAuswerten(w: Welt, a: string[], root: boolean): boolean {
  const n = a.length;
  if (n === 0) return false;
  if (n === 1) return a[0] !== '';
  if (n === 2) {
    if (a[0] === '!') return a[1] === '';
    if (UNAER.has(a[0])) return testUnaer(w, a[0], a[1], root);
    throw new TestFehler(`${a[0]}: Einstelliger (unärer) Operator erwartet.`);
  }
  if (n === 3) {
    if (BINAER.has(a[1])) return testBinaer(w, a[0], a[1], a[2]);
    if (a[1] === '-a') return a[0] !== '' && a[2] !== '';
    if (a[1] === '-o') return a[0] !== '' || a[2] !== '';
    if (a[0] === '!') return !testAuswerten(w, a.slice(1), root);
    if (a[0] === '(' && a[2] === ')') return a[1] !== '';
    throw new TestFehler(`${a[1]}: Zweistelliger (binärer) Operator erwartet.`);
  }
  if (n === 4 && a[0] === '!') return !testAuswerten(w, a.slice(1), root);
  // Mehr Argumente: -o bindet schwächer als -a
  const o = a.lastIndexOf('-o'); if (o > 0 && o < n - 1) return testAuswerten(w, a.slice(0, o), root) || testAuswerten(w, a.slice(o + 1), root);
  const u = a.lastIndexOf('-a'); if (u > 0 && u < n - 1) return testAuswerten(w, a.slice(0, u), root) && testAuswerten(w, a.slice(u + 1), root);
  if (a[0] === '(' && a[n - 1] === ')') return testAuswerten(w, a.slice(1, -1), root);
  throw new TestFehler('Zu viele Argumente.');
}
function testBefehl(w: Welt, name: string, a: string[], root: boolean): Ergebnis {
  let args = a;
  if (name === '[') { if (a[a.length - 1] !== ']') return { out: '', err: `bash: [: Fehlende »]«`, code: 2 }; args = a.slice(0, -1); }
  if (name === '[[') {
    if (a[a.length - 1] !== ']]') return { out: '', err: `bash: Bedingter binärer Operator erwartet`, code: 2 };
    args = a.slice(0, -1);
    // [[ ]] kennt Muster bei == und reguläre Ausdrücke bei =~, und leere Variablen stören nicht
    if (args.length === 3 && (args[1] === '==' || args[1] === '=' || args[1] === '!=')) { const t = K.muster(args[2]).test(args[0]); return { out: '', code: (args[1] === '!=' ? !t : t) ? 0 : 1 }; }
    if (args.length === 3 && args[1] === '=~') { try { return { out: '', code: new RegExp(args[2]).test(args[0]) ? 0 : 1 }; } catch { return { out: '', code: 2 }; } }
  }
  try { return { out: '', code: testAuswerten(w, args, root) ? 0 : 1 }; }
  catch (e) { if (e instanceof TestFehler) return { out: '', err: `bash: ${name === '[[' ? '' : name + ': '}${e.text}`, code: 2 }; throw e; }
}

// ---------- read ----------

function lesen(w: Welt, a: string[], stdin: string): Ergebnis {
  const st = stand(w);
  let prompt = ''; let roh = false; let still = false; const namen: string[] = [];
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    if (x === '-p') { prompt = a[++i] ?? ''; continue; }
    if (x === '-t' || x === '-n' || x === '-N' || x === '-d' || x === '-u') { i++; continue; }
    if (/^-[rs]+$/.test(x)) { if (x.includes('r')) roh = true; if (x.includes('s')) still = true; continue; }
    if (x.startsWith('-') && x.length > 1) {
      if (/^-[rsp]+$/.test(x.replace(/p$/, ''))) { roh ||= x.includes('r'); still ||= x.includes('s'); if (x.endsWith('p')) prompt = a[++i] ?? ''; continue; }
      return { out: '', err: `bash: read: ${x}: Ungültige Option.\nread: Aufruf: read [-ers] [-a Feld] [-d Begrenzer] [-i Text] [-n Zeichen] [-N Zeichen] [-p Prompt] [-t Zeitlimit] [-u fd] [Name …]`, code: 2 };
    }
    if (!/^[A-Za-z_]\w*$/.test(x)) return { out: '', err: `bash: read: »${x}«: Ist kein gültiger Bezeichner`, code: 1 };
    namen.push(x);
  }
  let zeile: string;
  if (st.eingabeTty) {
    if (st.terminal?.antworten.length) zeile = st.terminal.antworten.shift()!;
    else if (st.terminal) throw new BrauchtEingabe(prompt, still);
    else return { out: '', code: 1 };
  } else {
    if (stdin === '') return { out: '', code: 1 };
    const e = stdin.indexOf('\n'); zeile = e < 0 ? stdin : stdin.slice(0, e);
  }
  if (!roh) zeile = zeile.replace(/\\(.)/g, '$1');
  const ifs = 'IFS' in w.env ? w.env.IFS : 'IFS' in w.vars ? w.vars.IFS : ' \t\n';
  if (!namen.length) { setzen(w, 'REPLY', zeile); return { out: '', code: 0 }; }
  const weiss = ifs.replace(/[^ \t\n]/g, ''); const hart = ifs.replace(/[ \t\n]/g, '');
  const istWeiss = (c: string) => weiss.includes(c); const istHart = (c: string) => hart.includes(c);
  let rest = zeile;
  const trim = (s: string) => { let x = s; while (x && istWeiss(x[0])) x = x.slice(1); while (x && istWeiss(x[x.length - 1])) x = x.slice(0, -1); return x; };
  rest = trim(rest);
  for (let k = 0; k < namen.length; k++) {
    if (k === namen.length - 1) { setzen(w, namen[k], trim(rest)); break; }
    let j = 0; while (j < rest.length && !istWeiss(rest[j]) && !istHart(rest[j])) j++;
    setzen(w, namen[k], rest.slice(0, j));
    rest = rest.slice(j);
    while (rest && istWeiss(rest[0])) rest = rest.slice(1);
    if (rest && istHart(rest[0])) { rest = rest.slice(1); while (rest && istWeiss(rest[0])) rest = rest.slice(1); }
  }
  return { out: '', code: 0 };
}

// ---------- Neue Shells und ihre Startdateien ----------

const HOME = (root: boolean, user = 'lena') => (root ? '/root' : `/home/${user}`);
function startdateiLesen(w: Welt, p: string, root: boolean): string {
  const st = stand(w);
  if (!(p in w.fs) || w.fs[p] === null) return '';
  if (!K.darf(w, p, 'r', root)) return '';
  st.gelesen.push(p);
  const r = K.quelle(w, p, root);
  return [r.err, r.out.replace('\u0000ohneNL', '')].filter(Boolean).join('\n');
}
function startdateien(w: Welt, login: boolean, root: boolean): string {
  const st = stand(w); const h = w.env.HOME;
  st.gelesen = [];
  const teile: string[] = [];
  if (login) {
    teile.push(startdateiLesen(w, '/etc/profile', root));
    const eigene = [`${h}/.bash_profile`, `${h}/.bash_login`, `${h}/.profile`].find((p) => p in w.fs && w.fs[p] !== null);
    if (eigene) teile.push(startdateiLesen(w, eigene, root));
  } else {
    teile.push(startdateiLesen(w, '/etc/bash.bashrc', root));
    teile.push(startdateiLesen(w, `${h}/.bashrc`, root));
  }
  return teile.filter(Boolean).join('\n');
}
function grundVars(_w: Welt): Record<string, string> {
  return { HISTSIZE: '1000', HISTFILESIZE: '2000', BASH: '/usr/bin/bash', BASH_VERSION: '5.2.15(1)-release', PS1: '\\u@\\h:\\w\\$ ', };
}

/** bash, bash -l, su, su -: Eine neue Shell startet über der alten. exit kehrt zurück. */
export function shellStarten(w: Welt, o: { login: boolean; root?: boolean; user?: string; ersetzen?: boolean }): Ergebnis {
  const st = stand(w);
  const root = o.root ?? w.root;
  if (!o.ersetzen) st.shells.push({ vars: w.vars, env: w.env, aliase: w.aliase, funktionen: st.funktionen, funkText: st.funkText, cwd: w.cwd, root: w.root, login: st.login, optionen: st.optionen });
  const shlvl = String(Number(w.env.SHLVL ?? '1') + (o.ersetzen ? 0 : 1));
  // Die neue Shell erbt nur die Umgebung: keine Shell-Variablen, keine Aliase, keine Funktionen
  w.env = { ...w.env, SHLVL: shlvl };
  if (o.login) {
    const user = root ? 'root' : (o.user ?? 'lena');
    w.env = { TERM: w.env.TERM ?? 'xterm-256color', LANG: w.env.LANG ?? 'de_DE.UTF-8', HOME: HOME(root, user), USER: user, LOGNAME: user, SHELL: '/bin/bash', PATH: root ? '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' : '/usr/local/bin:/usr/bin:/bin:/usr/local/games:/usr/games', SHLVL: shlvl, PWD: HOME(root, user) };
    w.cwd = HOME(root, user);
  }
  w.vars = grundVars(w); w.aliase = {}; st.funktionen = {}; st.funkText = {}; st.optionen = {};
  w.root = root; st.login = o.login;
  const alt = w.args; w.args = [];
  try { return { out: startdateien(w, o.login, root), code: 0 }; }
  finally { w.args = alt; }
}
function shellBeenden(w: Welt, code: number, logout: boolean): Ergebnis {
  const st = stand(w);
  if (logout && !st.login) return { out: '', err: 'bash: logout: Keine Loginshell: Mit »exit« abmelden!', code: 1 };
  const teile: string[] = [st.login ? 'Abgemeldet' : 'exit'];
  if (st.login) { const p = `${w.env.HOME}/.bash_logout`; const t = startdateiLesen(w, p, w.root); if (t) teile.push(t); }
  const f = st.shells.pop()!;
  w.vars = f.vars; w.env = f.env; w.aliase = f.aliase; st.funktionen = f.funktionen; st.funkText = f.funkText; w.cwd = f.cwd; w.root = f.root; st.login = f.login; st.optionen = f.optionen;
  w.letzterCode = code;
  return { out: teile.join('\n'), code };
}

// ---------- Befehle ----------

type B = (w: Welt, a: string[], stdin: string, root: boolean) => Ergebnis;
const fehler = (t: string, code = 1): Ergebnis => ({ out: '', err: t, code });

/** Eingebaute Befehle der Shell (kein Programm in /usr/bin). */
export function skriptEingebaut(): Record<string, B> {
  const b: Record<string, B> = {};
  b.test = (w, a, _i, r) => testBefehl(w, 'test', a, r || w.root);
  b['['] = (w, a, _i, r) => testBefehl(w, '[', a, r || w.root);
  b['[['] = (w, a, _i, r) => testBefehl(w, '[[', a, r || w.root);
  b.read = (w, a, stdin) => lesen(w, a, stdin);
  b.let = (w, a) => {
    if (!a.length) return fehler('bash: let: Ausdruck erwartet.');
    let v = 0;
    try { for (const x of a) v = rechnen(w, x); } catch (e) { if (e instanceof RechenFehler) return fehler(`bash: let: ${e.text}`); throw e; }
    return { out: '', code: v === 0 ? 1 : 0 };
  };
  b.break = (w, a) => { if (!stand(w).schleife) return { out: '', err: 'bash: break: nur in einer for-, while- oder until-Schleife sinnvoll', code: 0 }; return { out: '', code: 0, ende: 'break:' + (a[0] ?? '1') }; };
  b.continue = (w, a) => { if (!stand(w).schleife) return { out: '', err: 'bash: continue: nur in einer for-, while- oder until-Schleife sinnvoll', code: 0 }; return { out: '', code: 0, ende: 'continue:' + (a[0] ?? '1') }; };
  b.return = (w, a) => {
    const st = stand(w);
    if (!st.funk && !st.quelle) return fehler('bash: return: »Return« ist nur aus einer Funktion oder einem mit »source« ausgeführten Skript möglich.');
    if (a[0] !== undefined && !/^-?\d+$/.test(a[0])) return { out: '', err: `bash: return: ${a[0]}: Ein numerischer Parameter ist erforderlich.`, code: 2, ende: 'return' };
    return { out: '', code: a[0] !== undefined ? (Number(a[0]) & 255) : w.letzterCode, ende: 'return' };
  };
  b.shift = (w, a) => {
    const top = w.args[w.args.length - 1]; const n = Number(a[0] ?? '1');
    if (!top || n > top.length - 1) return { out: '', code: 1 };
    top.splice(1, n); return { out: '', code: 0 };
  };
  b.local = (w, a) => {
    const st = stand(w);
    if (!st.funk) return fehler('bash: local: Kann nur innerhalb einer Funktion benutzt werden');
    const rahmen = st.lokal[st.lokal.length - 1];
    for (const x of a) {
      const m = x.match(/^([A-Za-z_]\w*)(?:=(.*))?$/s); if (!m) return fehler(`bash: local: »${x}«: Ist kein gültiger Bezeichner`);
      if (!(m[1] in rahmen)) rahmen[m[1]] = [w.env[m[1]] ?? w.vars[m[1]], m[1] in w.env];
      delete w.env[m[1]]; w.vars[m[1]] = m[2] ?? '';
    }
    return { out: '', code: 0 };
  };
  b.declare = (w, a) => {
    const st = stand(w);
    if (a.includes('-f') || a.includes('-F')) {
      const namen = a.filter((x) => !x.startsWith('-'));
      const liste = (namen.length ? namen : Object.keys(st.funkText).sort());
      const fehlt = liste.find((n) => !st.funkText[n]); if (fehlt) return { out: '', code: 1 };
      return { out: liste.map((n) => (a.includes('-F') ? `declare -f ${n}` : st.funkText[n])).join('\n'), code: 0 };
    }
    const exp = a.includes('-x');
    const zuw = a.filter((x) => !x.startsWith('-'));
    if (!zuw.length) return { out: [...Object.entries(w.env).map(([k, v]) => `declare -x ${k}="${v}"`), ...Object.entries(w.vars).map(([k, v]) => `declare -- ${k}="${v}"`)].sort().join('\n'), code: 0 };
    for (const x of zuw) { const m = x.match(/^([A-Za-z_]\w*)(?:=(.*))?$/s); if (!m) return fehler(`bash: declare: »${x}«: Ist kein gültiger Bezeichner`); const v = m[2] ?? w.env[m[1]] ?? w.vars[m[1]] ?? ''; if (exp) { delete w.vars[m[1]]; w.env[m[1]] = v; } else setzen(w, m[1], v); }
    return { out: '', code: 0 };
  };
  b.typeset = b.declare;
  b.shopt = (_w, a) => ({ out: a.length ? '' : 'checkwinsize  \ton\ncmdhist        \ton\nexpand_aliases \ton\nhistappend     \ton\nlogin_shell    \toff', code: 0 });
  b.exec = (w, a, stdin, root) => {
    if (!a.length) return { out: '', code: 0 };
    if (a[0] === 'bash' || a[0] === 'sh') { const r = shellStarten(w, { login: a.includes('-l') || a.includes('--login'), ersetzen: true }); return r; }
    const r = K.zeile(w, a.map((x) => (/[\s'"$]/.test(x) ? `'${x.replace(/'/g, `'\\''`)}'` : x)).join(' '), stdin, root);
    const im = w.args.length > 0;
    return { out: r.out.replace(/\n$/, ''), err: r.err || undefined, code: r.code, ...(im ? { ende: 'exit' } : {}), ...(!im ? { err: [r.err, `(exec ersetzt die Shell durch ${a[0]}. Danach wäre dieses Terminal geschlossen. Der Simulator lässt dich weiterarbeiten.)`].filter(Boolean).join('\n') } : {}) };
  };
  return b;
}

/** Programme in /usr/bin, die zu Topic 105 gehören. */
export function skriptBefehle(): Record<string, B> {
  const b: Record<string, B> = {};
  b.seq = (_w, a) => {
    let sep = '\n'; let breit = false; const z: string[] = [];
    for (let i = 0; i < a.length; i++) { if (a[i] === '-s') sep = a[++i] ?? ''; else if (a[i].startsWith('-s')) sep = a[i].slice(2); else if (a[i] === '-w') breit = true; else z.push(a[i]); }
    if (!z.length) return fehler('seq: fehlender Operand\n„seq --help“ liefert weitere Informationen.');
    const bad = z.find((x) => !/^-?\d+(\.\d+)?$/.test(x)); if (bad) return fehler(`seq: ungültiges Gleitkommaargument: »${bad}«\n„seq --help“ liefert weitere Informationen.`);
    const n = z.map(Number); const [von, schritt, bis] = n.length === 1 ? [1, 1, n[0]] : n.length === 2 ? [n[0], 1, n[1]] : [n[0], n[1], n[2]];
    if (schritt === 0) return fehler(`seq: ungültiges Argument »0« für Schrittweite`);
    const nk = Math.max(...z.map((x) => (x.split('.')[1] ?? '').length));
    const out: string[] = [];
    for (let v = von, k = 0; schritt > 0 ? v <= bis + 1e-9 : v >= bis - 1e-9; v = von + ++k * schritt) { out.push(v.toFixed(nk)); if (out.length > 100000) break; }
    const br = Math.max(...out.map((x) => x.length));
    return { out: (breit ? out.map((x) => x.padStart(br, '0')) : out).join(sep), code: 0 };
  };
  b.expr = (_w, a) => {
    const fehl = (t: string) => fehler(`expr: ${t}`, 2);
    if (!a.length) return fehl('fehlender Operand');
    if (a[0] === 'length' && a.length === 2) return { out: String(a[1].length), code: a[1].length ? 0 : 1 };
    if (a.length === 1) return { out: a[0], code: a[0] === '' || a[0] === '0' ? 1 : 0 };
    if (a.length !== 3) return fehl(a.length === 2 ? `Syntaxfehler: fehlendes Argument hinter »${a[1]}«` : `Syntaxfehler: unerwartetes Argument »${a[3]}«`);
    const [x, op, y] = a; const zx = /^-?\d+$/.test(x); const zy = /^-?\d+$/.test(y);
    let v: string;
    if (['+', '-', '*', '/', '%'].includes(op)) {
      if (!zx || !zy) return fehl('Argument, das keine Zahl ist');
      const p = BigInt(x); const q = BigInt(y);
      if ((op === '/' || op === '%') && q === 0n) return fehl('Teilung durch Null');
      v = String(op === '+' ? p + q : op === '-' ? p - q : op === '*' ? p * q : op === '/' ? p / q : p % q);
    } else if (['=', '!=', '<', '>', '<=', '>='].includes(op)) {
      const c = zx && zy ? Number(x) - Number(y) : x < y ? -1 : x > y ? 1 : 0;
      v = String(+({ '=': c === 0, '!=': c !== 0, '<': c < 0, '>': c > 0, '<=': c <= 0, '>=': c >= 0 } as Record<string, boolean>)[op]);
    } else if (op === ':') { const m = x.match(new RegExp('^(?:' + y + ')')); v = m ? (m[1] ?? String(m[0].length)) : '0'; }
    else return fehl(`Syntaxfehler: unerwartetes Argument »${op}«`);
    return { out: v, code: v === '0' || v === '' ? 1 : 0 };
  };
  b.mail = (w, a, stdin, root) => {
    const st = stand(w);
    let betreff = ''; const an: string[] = [];
    for (let i = 0; i < a.length; i++) { if (a[i] === '-s') betreff = a[++i] ?? ''; else if (!a[i].startsWith('-')) an.push(a[i]); }
    const ich = root || w.root ? 'root' : 'lena';
    if (!an.length) {
      const meine = st.post.filter((p) => p.an === ich);
      if (!meine.length) return fehler(`No mail for ${ich}`);
      return { out: `Mail version 8.1.2 01/15/2001.  Type ? for help.\n"/var/mail/${ich}": ${meine.length} message${meine.length > 1 ? 's' : ''} ${meine.length} new\n` + meine.map((p, i) => `>N  ${i + 1} ${p.von}@werkstatt  Mon Nov 23 08:41  14/420   ${p.betreff}`).join('\n') + `\n(Im Simulator beendet sich mail hier. Den Inhalt zeigt cat /var/mail/${ich}${ich === 'root' && !root && !w.root ? ' mit sudo' : ''}.)`, code: 0 };
    }
    if (!stdin && !st.eingabeTty) return fehler('Null message body; hope that\'s ok', 0);
    if (st.eingabeTty && !stdin) return fehler('(Im Simulator gibst du den Text über eine Pipe oder Umleitung ein, etwa: echo "Text" | mail -s "Betreff" root)', 1);
    for (const ziel of an) {
      const user = ziel.replace(/@.*$/, '');
      st.post.push({ an: user, von: ich, betreff, text: stdin });
      const p = `/var/mail/${user}`;
      const neu = !(p in w.fs);
      const datum = 'Mon Nov 23 08:41:00 2026';
      w.fs[p] = (w.fs[p] ?? '') + `From ${ich}@werkstatt  ${datum}\nReturn-path: <${ich}@werkstatt>\nTo: ${ziel}\nSubject: ${betreff}\nFrom: ${ich}@werkstatt\nDate: Mon, 23 Nov 2026 08:41:00 +0100\n\n${stdin.replace(/\n?$/, '\n')}\n`;
      if (neu) K.rechte(w, p, 0o660, user, 'mail');
    }
    return { out: '', code: 0 };
  };
  b.dircolors = () => ({ out: "LS_COLORS='rs=0:di=01;34:ln=01;36:mh=00:pi=40;33:so=01;35:do=01;35:bd=40;33;01:cd=40;33;01:ex=01;32';\nexport LS_COLORS", code: 0 });
  return b;
}

/** su: Benutzer wechseln. su - startet eine Login-Shell. */
export function suBefehl(w: Welt, a: string[], root: boolean): Ergebnis & { dialog?: (zeile: string) => string } {
  let login = false; let user = 'root'; let cmd: string | undefined;
  for (let i = 0; i < a.length; i++) { const x = a[i]; if (x === '-' || x === '-l' || x === '--login') login = true; else if (x === '-c') cmd = a[++i]; else if (!x.startsWith('-')) user = x; }
  if (!['root', 'lena', 'max'].includes(user)) return fehler(`su: Benutzer ${user} existiert nicht oder der Benutzereintrag enthält keine Shell.`);
  const ziel = user === 'root';
  const weiter = () => {
    if (cmd !== undefined) { const r = K.zeile(w, cmd, '', ziel); return { out: r.out.replace(/\n$/, ''), err: r.err || undefined, code: r.code }; }
    return shellStarten(w, { login, root: ziel, user });
  };
  if (root || w.root) return weiter();
  // Ohne Root-Rechte fragt su nach dem Passwort des Zielkontos. Auf diesem System ist root gesperrt.
  return { out: 'Passwort: ', code: 0, dialog: (_z: string) => {
    if (ziel) return 'su: Legitimierungsfehler';
    const r = weiter(); return [r.err, r.out].filter(Boolean).join('\n');
  } };
}

export { shellBeenden };

/** zustand-Schlüssel für Missionen ab Topic 105. */
export function zustandSkript(w: Welt, s: string): boolean | undefined {
  const st = stand(w); let m;
  if ((m = s.match(/^funktion:([\w.:-]+)$/))) return !!st.funktionen[m[1]];
  if ((m = s.match(/^gelesen:(.+)$/))) return st.gelesen.includes(m[1]);
  if ((m = s.match(/^shlvl=(\d+)$/))) return Number(w.env.SHLVL ?? '1') === Number(m[1]);
  if (s === 'login') return st.login;
  if ((m = s.match(/^post:(\w+)~(.*)$/))) { const re = new RegExp(m[2], 'm'); return st.post.some((p) => p.an === m![1] && (re.test(p.betreff) || re.test(p.text))); }
  if ((m = s.match(/^code=(\d+)$/))) return w.letzterCode === Number(m[1]);
  if ((m = s.match(/^option:([xeu])$/))) return !!st.optionen[m[1] as 'x'];
  return undefined;
}
