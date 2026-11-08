// Mini-Shell für den Terminal-Simulator (Modus „ohne Linux“).
// Bildet einen kleinen Teil von bash und GNU coreutils nach, so wie sie unter Debian reagieren.
// Fehlermeldungen bleiben im Original (englisch), damit man sie später im echten Terminal wiedererkennt.
// Darunter steht auf Wunsch ein deutscher Hinweis.
//
// Neue Befehle: unten in BEFEHLE eintragen. Jeder Befehl bekommt die Argumente (ohne Befehlsnamen)
// und schreibt über ctx.aus() und ctx.fehler(). Rückgabe ist der Exit-Code.

export const BENUTZER = 'hero';
export const RECHNER = 'server';
export const HEIM = `/home/${BENUTZER}`;

interface Knoten {
  typ: 'd' | 'f' | 'l';
  rechte: string;           // z. B. "rwxr-xr-x"
  besitzer: string;
  inhalt?: string;          // nur Dateien
  ziel?: string;            // nur Links
  kinder?: Map<string, Knoten>;
  zeit: Date;
}

const STARTZEIT = new Date('2026-11-08T09:12:00');

function ordner(besitzer = 'root', rechte = 'rwxr-xr-x'): Knoten {
  return { typ: 'd', rechte, besitzer, kinder: new Map(), zeit: STARTZEIT };
}
function datei(inhalt: string, besitzer = 'root', rechte = 'rw-r--r--'): Knoten {
  return { typ: 'f', rechte, besitzer, inhalt, zeit: STARTZEIT };
}

// Debian 13 „trixie“. tests/befehle.sh gibt das echte /etc/os-release zum Vergleich aus.
const OS_RELEASE = `PRETTY_NAME="Debian GNU/Linux 13 (trixie)"
NAME="Debian GNU/Linux"
VERSION_ID="13"
VERSION="13 (trixie)"
VERSION_CODENAME=trixie
DEBIAN_VERSION_FULL=13.1
ID=debian
HOME_URL="https://www.debian.org/"
SUPPORT_URL="https://www.debian.org/support"
BUG_REPORT_URL="https://bugs.debian.org/"
`;

/** Standard-Dateisystem: ein frisch installiertes Debian mit Benutzer „hero“. */
function standardBaum(): Knoten {
  const wurzel = ordner();
  const plan: [string, Knoten][] = [
    ['/bin', { typ: 'l', ziel: 'usr/bin', rechte: 'rwxrwxrwx', besitzer: 'root', zeit: STARTZEIT }],
    ['/boot', ordner()],
    ['/dev', ordner()],
    ['/etc', ordner()],
    ['/etc/hostname', datei(`${RECHNER}\n`)],
    ['/etc/os-release', datei(OS_RELEASE)],
    ['/etc/hosts', datei('# Static table lookup for hostnames.\n# See hosts(5) for details.\n127.0.0.1 localhost\n::1       localhost\n')],
    ['/etc/passwd', datei(`root:x:0:0:root:/root:/bin/bash\n${BENUTZER}:x:1000:1000:${BENUTZER}:${HEIM}:/bin/bash\n`)],
    ['/etc/debian_version', datei('13.1\n')],
    ['/home', ordner()],
    [HEIM, ordner(BENUTZER, 'rwx------')],
    [`${HEIM}/.bash_logout`, datei('# ~/.bash_logout: executed by bash(1) when login shell exits.\n', BENUTZER)],
    [`${HEIM}/.bashrc`, datei("# ~/.bashrc: executed by bash(1) for non-login shells.\n\n# If not running interactively, don't do anything\ncase $- in\n    *i*) ;;\n      *) return;;\nesac\n\nPS1='${debian_chroot:+($debian_chroot)}\\u@\\h:\\w\\$ '\n", BENUTZER)],
    [`${HEIM}/.profile`, datei('# ~/.profile: executed by the command interpreter for login shells.\n', BENUTZER)],
    [`${HEIM}/Dokumente`, ordner(BENUTZER)],
    [`${HEIM}/Downloads`, ordner(BENUTZER)],
    [`${HEIM}/notiz.txt`, datei('Willkommen auf deinem Server.\nHier entsteht in den nächsten Akten alles Schritt für Schritt.\n', BENUTZER)],
    ['/proc', ordner('root', 'r-xr-xr-x')],
    ['/root', ordner('root', 'rwxr-x---')],
    ['/tmp', ordner('root', 'rwxrwxrwt')],
    ['/usr', ordner()],
    ['/usr/bin', ordner()],
    ['/var', ordner()],
    ['/var/log', ordner()],
    ['/var/log/apt', ordner()],
    ['/var/log/apt/history.log', datei('\nStart-Date: 2026-11-08  09:10:02\nCommandline: apt full-upgrade\nRequested-By: hero (1000)\nUpgrade: openssh-client:amd64 (1:10.0p1-7, 1:10.0p1-7+deb13u1)\nEnd-Date: 2026-11-08  09:10:41\n')],
  ];
  for (const [pfad, k] of plan) einhaengen(wurzel, pfad, k);
  return wurzel;
}

function einhaengen(wurzel: Knoten, pfad: string, k: Knoten) {
  const teile = pfad.split('/').filter(Boolean);
  let o = wurzel;
  for (const t of teile.slice(0, -1)) {
    if (!o.kinder!.has(t)) o.kinder!.set(t, ordner());
    o = o.kinder!.get(t)!;
  }
  o.kinder!.set(teile[teile.length - 1], k);
}

export function normalisieren(pfad: string): string {
  const teile: string[] = [];
  for (const t of pfad.split('/')) {
    if (!t || t === '.') continue;
    if (t === '..') teile.pop(); else teile.push(t);
  }
  return '/' + teile.join('/');
}

export interface Ergebnis {
  befehl: string;     // eingegebene Zeile
  ausgabe: string;    // reine Textausgabe (stdout + stderr) für Ziele
  code: number;       // Exit-Code
}

export interface Start {
  ort?: string;
  /** Pfad → Inhalt. null legt einen Ordner an. Pfade mit ~ beginnen im Heimatordner. */
  dateien?: Record<string, string | null>;
}

type Zeile = { html: string; art?: 'fehler' | 'hinweis' };

interface Ctx {
  sh: Shell;
  aus(text: string, html?: boolean): void;
  fehler(text: string, hinweis?: string): void;
  stdout: string[];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export class Shell {
  wurzel: Knoten;
  ort: string;
  vorher: string;
  verlauf: string[] = [];
  letzterCode = 0;
  hinweise: boolean;

  constructor(start: Start = {}, hinweise = true) {
    this.wurzel = standardBaum();
    this.hinweise = hinweise;
    for (const [p, inhalt] of Object.entries(start.dateien ?? {})) {
      const pfad = normalisieren(p.replace(/^~/, HEIM));
      einhaengen(this.wurzel, pfad, inhalt === null ? ordner(BENUTZER) : datei(inhalt, BENUTZER));
    }
    this.ort = normalisieren((start.ort ?? HEIM).replace(/^~/, HEIM));
    this.vorher = this.ort;
  }

  /** Ort für den Prompt wie \\w in bash: ganzer Pfad, der Heimatordner wird zu ~. */
  kurzOrt(): string {
    if (this.ort === HEIM || this.ort.startsWith(HEIM + '/')) return '~' + this.ort.slice(HEIM.length);
    return this.ort;
  }
  /** Debian-Standard aus /etc/skel/.bashrc: benutzer@rechner:ort$ */
  prompt(): string { return `${BENUTZER}@${RECHNER}:${this.kurzOrt()}$`; }

  absolut(pfad: string): string {
    if (pfad === '~' || pfad.startsWith('~/')) pfad = HEIM + pfad.slice(1);
    return normalisieren(pfad.startsWith('/') ? pfad : `${this.ort}/${pfad}`);
  }

  /** Knoten zu einem Pfad suchen. Links werden aufgelöst. */
  finden(pfad: string, linkFolgen = true): Knoten | undefined {
    const teile = this.absolut(pfad).split('/').filter(Boolean);
    let k: Knoten = this.wurzel;
    let bisher = '';
    for (let i = 0; i < teile.length; i++) {
      if (k.typ !== 'd') return undefined;
      const n = k.kinder!.get(teile[i]);
      if (!n) return undefined;
      bisher += '/' + teile[i];
      if (n.typ === 'l' && (linkFolgen || i < teile.length - 1)) {
        const ziel = this.finden(normalisieren(`${bisher}/../${n.ziel}`));
        if (!ziel) return undefined;
        k = ziel;
      } else k = n;
    }
    return k;
  }

  darfLesen(k: Knoten): boolean {
    const r = k.besitzer === BENUTZER ? k.rechte.slice(0, 3) : k.rechte.slice(6, 9);
    return r[0] === 'r';
  }
  darfBetreten(k: Knoten): boolean {
    const r = k.besitzer === BENUTZER ? k.rechte.slice(0, 3) : k.rechte.slice(6, 9);
    return r[2] === 'x' || r[2] === 't';
  }
  darfSchreiben(k: Knoten): boolean {
    const r = k.besitzer === BENUTZER ? k.rechte.slice(0, 3) : k.rechte.slice(6, 9);
    return r[1] === 'w';
  }

  elternUndName(pfad: string): { eltern?: Knoten; name: string } {
    const abs = this.absolut(pfad);
    const name = abs.split('/').pop()!;
    return { eltern: this.finden(abs.slice(0, abs.length - name.length - 1) || '/'), name };
  }

  /** Eine Zeile ausführen. Gibt die Ausgabe als HTML-Zeilen und das Ergebnis für Ziele zurück. */
  ausfuehren(zeile: string): { zeilen: Zeile[]; ergebnis: Ergebnis; leeren?: boolean } {
    const zeilen: Zeile[] = [];
    const roh: string[] = [];
    const befehlZeile = zeile.trim();
    if (befehlZeile) this.verlauf.push(befehlZeile);
    if (!befehlZeile || befehlZeile.startsWith('#')) return { zeilen, ergebnis: { befehl: befehlZeile, ausgabe: '', code: this.letzterCode } };

    let woerter: string[];
    try { woerter = zerlegen(befehlZeile, this); }
    catch (e) {
      const t = (e as Error).message;
      zeilen.push({ html: esc(t), art: 'fehler' });
      if (this.hinweise) zeilen.push({ html: 'Ein Anführungszeichen ist nicht geschlossen. Im echten Terminal wartet bash dann mit <code>&gt;</code> auf den Rest. Abbrechen mit Strg+C.', art: 'hinweis' });
      this.letzterCode = 2;
      return { zeilen, ergebnis: { befehl: befehlZeile, ausgabe: t, code: 2 } };
    }

    // Umleitung > und >> (nur einfache Form, eine Datei am Ende)
    let umleiten: { pfad: string; anhaengen: boolean } | undefined;
    const ui = woerter.findIndex((w) => w === '>' || w === '>>');
    if (ui >= 0) {
      const pfad = woerter[ui + 1];
      if (!pfad) {
        const t = "bash: syntax error near unexpected token `newline'";
        zeilen.push({ html: esc(t), art: 'fehler' });
        if (this.hinweise) zeilen.push({ html: 'Nach <code>&gt;</code> fehlt der Dateiname.', art: 'hinweis' });
        this.letzterCode = 2;
        return { zeilen, ergebnis: { befehl: befehlZeile, ausgabe: t, code: 2 } };
      }
      umleiten = { pfad, anhaengen: woerter[ui] === '>>' };
      woerter = woerter.slice(0, ui).concat(woerter.slice(ui + 2));
    }

    const [name, ...args] = woerter;
    const ctx: Ctx = {
      sh: this,
      stdout: [],
      aus(text, html = false) {
        ctx.stdout.push(html ? text.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') : text);
        if (!umleiten) { zeilen.push({ html: html ? text : esc(text) }); roh.push(ctx.stdout[ctx.stdout.length - 1]); }
      },
      fehler(text, hinweis) {
        zeilen.push({ html: esc(text), art: 'fehler' });
        roh.push(text);
        if (hinweis && this.sh.hinweise) zeilen.push({ html: hinweis, art: 'hinweis' });
      },
    };

    let code: number;
    let leeren = false;
    const b = BEFEHLE[name];
    if (name === 'clear') { leeren = true; code = 0; }
    else if (b) code = b.lauf(args, ctx);
    else {
      ctx.fehler(`bash: ${name}: command not found`, hinweisUnbekannt(name));
      code = 127;
    }

    if (umleiten) {
      const text = ctx.stdout.map((s) => s + '\n').join('');
      const { eltern, name: dname } = this.elternUndName(umleiten.pfad);
      const vorhanden = this.finden(umleiten.pfad);
      if (!eltern || eltern.typ !== 'd') ctx.fehler(`bash: ${umleiten.pfad}: No such file or directory`);
      else if (vorhanden?.typ === 'd') ctx.fehler(`bash: ${umleiten.pfad}: Is a directory`);
      else if (!this.darfSchreiben(vorhanden ?? eltern)) ctx.fehler(`bash: ${umleiten.pfad}: Permission denied`);
      else if (vorhanden) { vorhanden.inhalt = (umleiten.anhaengen ? vorhanden.inhalt : '') + text; vorhanden.zeit = new Date(); }
      else eltern.kinder!.set(dname, { ...datei(text, BENUTZER), zeit: new Date() });
    }

    this.letzterCode = code;
    return { zeilen, leeren, ergebnis: { befehl: befehlZeile, ausgabe: roh.join('\n'), code } };
  }

  /** Vorschläge für Tab-Vervollständigung. */
  vervollstaendigen(zeile: string): { neu: string; liste?: string[] } {
    const m = zeile.match(/^(.*?)(\S*)$/)!;
    const davor = m[1], wort = m[2];
    const erstesWort = !davor.trim();
    let kandidaten: string[];
    let basis = '';
    if (erstesWort) {
      kandidaten = [...Object.keys(BEFEHLE), 'clear'].filter((b) => b.startsWith(wort)).sort();
    } else {
      const schnitt = wort.lastIndexOf('/');
      basis = schnitt >= 0 ? wort.slice(0, schnitt + 1) : '';
      const teil = wort.slice(schnitt + 1);
      const o = this.finden(basis || '.');
      if (!o || o.typ !== 'd') return { neu: zeile };
      kandidaten = [...o.kinder!.entries()]
        .filter(([n]) => n.startsWith(teil) && (teil.startsWith('.') || !n.startsWith('.')))
        .map(([n, k]) => n + (this.finden(`${basis || '.'}/${n}`)?.typ === 'd' && k ? '/' : ''))
        .sort();
    }
    if (!kandidaten.length) return { neu: zeile };
    if (kandidaten.length === 1) {
      const k = kandidaten[0];
      return { neu: davor + (erstesWort ? '' : basis) + k + (k.endsWith('/') ? '' : ' ') };
    }
    // gemeinsamen Anfang ergänzen, sonst Liste zeigen
    let gemein = kandidaten[0];
    for (const k of kandidaten) while (!k.startsWith(gemein)) gemein = gemein.slice(0, -1);
    const bisher = erstesWort ? wort : wort.slice(basis.length);
    if (gemein.length > bisher.length) return { neu: davor + (erstesWort ? '' : basis) + gemein };
    return { neu: zeile, liste: kandidaten };
  }
}

/** Zeile in Wörter zerlegen: Leerzeichen trennen, Anführungszeichen schützen, $VAR wird ersetzt. */
function zerlegen(zeile: string, sh: Shell): string[] {
  const vars: Record<string, string> = { HOME: HEIM, USER: BENUTZER, PWD: sh.ort, SHELL: '/usr/bin/bash', HOSTNAME: RECHNER, '?': String(sh.letzterCode) };
  const raus: string[] = [];
  let akt = '', hat = false, i = 0;
  const ersetze = () => {
    const m = zeile.slice(i + 1).match(/^(\?|[A-Za-z_][A-Za-z0-9_]*|\{[A-Za-z_][A-Za-z0-9_]*\})/);
    if (!m) { akt += '$'; i++; return; }
    const n = m[1].replace(/[{}]/g, '');
    akt += vars[n] ?? '';
    i += 1 + m[1].length;
  };
  while (i < zeile.length) {
    const c = zeile[i];
    if (c === "'") {
      const e = zeile.indexOf("'", i + 1);
      if (e < 0) throw new Error("bash: unexpected EOF while looking for matching `''");
      akt += zeile.slice(i + 1, e); hat = true; i = e + 1;
    } else if (c === '"') {
      hat = true; i++;
      while (i < zeile.length && zeile[i] !== '"') {
        if (zeile[i] === '$') ersetze();
        else if (zeile[i] === '\\' && i + 1 < zeile.length) { akt += zeile[i + 1]; i += 2; }
        else { akt += zeile[i]; i++; }
      }
      if (i >= zeile.length) throw new Error('bash: unexpected EOF while looking for matching `"\'');
      i++;
    } else if (c === '\\' && i + 1 < zeile.length) { akt += zeile[i + 1]; hat = true; i += 2; }
    else if (c === '$') { ersetze(); hat = true; }
    else if (c === ' ' || c === '\t') { if (hat) raus.push(akt); akt = ''; hat = false; i++; }
    else if (c === '>') {
      if (hat) raus.push(akt); akt = ''; hat = false;
      if (zeile[i + 1] === '>') { raus.push('>>'); i += 2; } else { raus.push('>'); i++; }
    } else if (c === '~' && !hat && (i + 1 >= zeile.length || zeile[i + 1] === '/' || zeile[i + 1] === ' ')) {
      akt += HEIM; hat = true; i++;
    } else { akt += c; hat = true; i++; }
  }
  if (hat) raus.push(akt);
  return raus;
}

// Gibt es unter Linux, ist aber bei einem frischen Debian nicht dabei. Eintrag: Name → Hinweis.
const NICHT_VORINSTALLIERT: Record<string, string> = {
};
const AEHNLICH: Record<string, string> = {
  dir: 'ls', cls: 'clear', copy: 'cp', move: 'mv', del: 'rm', md: 'mkdir', sl: 'ls', pdw: 'pwd', claer: 'clear', whoiam: 'whoami',
};
function hinweisUnbekannt(name: string): string {
  if (NICHT_VORINSTALLIERT[name]) return NICHT_VORINSTALLIERT[name];
  if (AEHNLICH[name]) return `Diesen Befehl gibt es so nicht. Meintest du <code>${AEHNLICH[name]}</code>?`;
  if (name !== name.toLowerCase()) return 'Linux unterscheidet Groß- und Kleinschreibung. Befehle schreibt man fast immer klein.';
  const nah = Object.keys(BEFEHLE).find((b) => abstand(b, name) === 1);
  if (nah) return `Tippfehler? Meintest du <code>${nah}</code>?`;
  return 'Diesen Befehl kennt die Shell nicht. Entweder ein Tippfehler, oder das Programm ist nicht installiert. Im Simulator gibt es nur die Befehle aus dem Kurs, <code>help</code> zeigt sie.';
}
function abstand(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** Optionen wie -la in einzelne Buchstaben zerlegen. Gibt Optionen und restliche Argumente zurück. */
function optionen(args: string[]): { opt: Set<string>; rest: string[]; lang: string[] } {
  const opt = new Set<string>(); const rest: string[] = []; const lang: string[] = [];
  let ende = false;
  for (const a of args) {
    if (ende || a === '-' || !a.startsWith('-')) rest.push(a);
    else if (a === '--') ende = true;
    else if (a.startsWith('--')) lang.push(a.slice(2));
    else for (const c of a.slice(1)) opt.add(c);
  }
  return { opt, rest, lang };
}

function unbekannteOption(ctx: Ctx, befehl: string, opt: Set<string>, erlaubt: string): boolean {
  const falsch = [...opt].find((o) => !erlaubt.includes(o));
  if (!falsch) return false;
  ctx.fehler(`${befehl}: invalid option -- '${falsch}'\nTry '${befehl} --help' for more information.`,
    `Die Option <code>-${esc(falsch)}</code> kennt <code>${befehl}</code> nicht. Achte auf Groß- und Kleinschreibung: <code>-a</code> und <code>-A</code> sind verschiedene Optionen.`);
  return true;
}

const MONATE = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function lsZeit(d: Date) {
  return `${MONATE[d.getMonth()]} ${String(d.getDate()).padStart(2, ' ')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function groesse(k: Knoten): number {
  return k.typ === 'd' ? 4096 : k.typ === 'l' ? (k.ziel?.length ?? 0) : new TextEncoder().encode(k.inhalt ?? '').length;
}
function lesbar(n: number): string {
  if (n < 1024) return String(n);
  const e = ['K', 'M', 'G']; let i = -1; let x = n;
  do { x /= 1024; i++; } while (x >= 1024 && i < 2);
  return (x < 10 ? x.toFixed(1) : String(Math.round(x))) + e[i];
}
function farbig(name: string, k: Knoten): string {
  const n = esc(name);
  if (k.typ === 'd') return `<span class="t-dir">${n}</span>`;
  if (k.typ === 'l') return `<span class="t-link">${n}</span>`;
  if (k.rechte.includes('x')) return `<span class="t-exe">${n}</span>`;
  return n;
}

interface Befehl { kurz: string; lauf(args: string[], ctx: Ctx): number; }

export const BEFEHLE: Record<string, Befehl> = {
  help: {
    kurz: 'zeigt alle Befehle im Simulator',
    lauf(_a, ctx) {
      ctx.aus('Befehle im Simulator (die echte Shell kann viel mehr):');
      for (const [n, b] of Object.entries(BEFEHLE).sort()) ctx.aus(`  ${n.padEnd(9)} ${b.kurz}`);
      ctx.aus(`  ${'clear'.padEnd(9)} leert den Bildschirm (auch Strg+L)`);
      return 0;
    },
  },
  pwd: {
    kurz: 'zeigt, in welchem Ordner du gerade bist',
    lauf(_a, ctx) { ctx.aus(ctx.sh.ort); return 0; },
  },
  hostname: {
    kurz: 'zeigt den Namen des Rechners',
    lauf(_a, ctx) { ctx.aus(RECHNER); return 0; },
  },
  man: {
    kurz: 'zeigt die Anleitung zu einem Befehl (im Simulator nur kurz)',
    lauf(args, ctx) {
      if (!args.length) { ctx.fehler('What manual page do you want?\nFor example, try \'man man\'.'); return 1; }
      const b = BEFEHLE[args[0]];
      if (!b) { ctx.fehler(`No manual entry for ${args[0]}`); return 16; }
      ctx.aus(`${args[0].toUpperCase()}(1)    (Kurzfassung im Simulator)`);
      ctx.aus(`  ${args[0]} – ${b.kurz}`);
      ctx.aus('Echte man-Pages sind viel länger. Wie man sie liest, lernst du in Mission 1.6.');
      return 0;
    },
  },
  whoami: {
    kurz: 'zeigt deinen Benutzernamen',
    lauf(_a, ctx) { ctx.aus(BENUTZER); return 0; },
  },
  uname: {
    kurz: 'zeigt Infos zum Kernel (-a für alles)',
    lauf(args, ctx) {
      const { opt } = optionen(args);
      if (unbekannteOption(ctx, 'uname', opt, 'asnrvmo')) return 1;
      const t = { s: 'Linux', n: RECHNER, r: '6.12.48+deb13-amd64', v: '#1 SMP PREEMPT_DYNAMIC Debian 6.12.48-1 (2025-09-20)', m: 'x86_64', o: 'GNU/Linux' };
      if (opt.has('a')) { ctx.aus(`${t.s} ${t.n} ${t.r} ${t.v} ${t.m} ${t.o}`); return 0; }
      const w = (['s', 'n', 'r', 'v', 'm', 'o'] as const).filter((x) => opt.has(x));
      ctx.aus((w.length ? w : ['s' as const]).map((x) => t[x]).join(' '));
      return 0;
    },
  },
  date: {
    kurz: 'zeigt Datum und Uhrzeit',
    lauf(_a, ctx) {
      const d = new Date();
      const tag = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
      ctx.aus(`${tag} ${MONATE[d.getMonth()]} ${String(d.getDate()).padStart(2, ' ')} ${d.toTimeString().slice(0, 8)} CET ${d.getFullYear()}`);
      return 0;
    },
  },
  echo: {
    kurz: 'gibt Text aus',
    lauf(args, ctx) {
      let a = args; let neu = true;
      if (a[0] === '-n') { neu = false; a = a.slice(1); }
      ctx.aus(a.join(' '));
      void neu; // -n (kein Zeilenumbruch) spielt im Simulator keine Rolle
      return 0;
    },
  },
  history: {
    kurz: 'zeigt die zuletzt eingegebenen Befehle',
    lauf(_a, ctx) {
      ctx.sh.verlauf.forEach((z, i) => ctx.aus(`${String(i + 1).padStart(5, ' ')}  ${z}`));
      return 0;
    },
  },
  cd: {
    kurz: 'wechselt den Ordner (cd .. geht eine Ebene hoch)',
    lauf(args, ctx) {
      const sh = ctx.sh;
      if (args.length > 1) { ctx.fehler('bash: cd: too many arguments', 'cd nimmt genau einen Ordner. Enthält ein Name Leerzeichen, setze ihn in Anführungszeichen.'); return 1; }
      let ziel = args[0] ?? HEIM;
      if (ziel === '-') { ziel = sh.vorher; ctx.aus(ziel); }
      const k = sh.finden(ziel);
      if (!k) { ctx.fehler(`bash: cd: ${args[0]}: No such file or directory`, 'Diesen Ordner gibt es hier nicht. Prüfe mit <code>ls</code>, was es an deinem Ort gibt, und achte auf Groß- und Kleinschreibung.'); return 1; }
      if (k.typ !== 'd') { ctx.fehler(`bash: cd: ${args[0]}: Not a directory`, 'Das ist eine Datei, kein Ordner. In eine Datei kann man nicht hineingehen. Lesen kannst du sie mit <code>cat</code>.'); return 1; }
      if (!sh.darfBetreten(k)) { ctx.fehler(`bash: cd: ${args[0]}: Permission denied`, 'Diesen Ordner darf nur sein Besitzer betreten. Mehr dazu in Akt 3.'); return 1; }
      sh.vorher = sh.ort;
      sh.ort = sh.absolut(ziel);
      // Links im Pfad wie bash im logischen Modus beibehalten
      return 0;
    },
  },
  ls: {
    kurz: 'listet den Inhalt eines Ordners (-l ausführlich, -a mit versteckten)',
    lauf(args, ctx) {
      const sh = ctx.sh;
      const { opt, rest } = optionen(args);
      if (unbekannteOption(ctx, 'ls', opt, 'lahA1d')) return 2;
      const ziele = rest.length ? rest : ['.'];
      let code = 0;
      const zeigeOrdner = ziele.length > 1;
      ziele.forEach((z, zi) => {
        const k = sh.finden(z, false);
        if (!k) { ctx.fehler(`ls: cannot access '${z}': No such file or directory`, zi === 0 ? 'Diesen Pfad gibt es nicht. Achte auf Groß- und Kleinschreibung.' : undefined); code = 2; return; }
        const echt = k.typ === 'l' ? sh.finden(z) : k;
        if (echt?.typ !== 'd' || opt.has('d')) { ctx.aus(eintrag(z, k), true); return; }
        if (!sh.darfLesen(echt)) { ctx.fehler(`ls: cannot open directory '${z}': Permission denied`, 'Diesen Ordner darfst du nicht lesen. Mehr dazu in Akt 3.'); code = 2; return; }
        if (zeigeOrdner) ctx.aus(`${zi ? '\n' : ''}${z}:`);
        const eintraege: [string, Knoten][] = [...echt.kinder!.entries()]
          .filter(([n]) => opt.has('a') || opt.has('A') || !n.startsWith('.'))
          .sort(([a], [b]) => a.replace(/^\./, '').localeCompare(b.replace(/^\./, ''), 'en'));
        if (opt.has('a')) eintraege.unshift(['.', echt], ['..', sh.finden(`${z}/..`) ?? echt]);
        if (opt.has('l')) {
          ctx.aus(`total ${eintraege.length * 4}`);
          for (const [n, kk] of eintraege) ctx.aus(eintrag(n, kk), true);
        } else if (eintraege.length) {
          ctx.aus(eintraege.map(([n, kk]) => farbig(n, kk)).join('  '), true);
        }
      });
      return code;

      function eintrag(n: string, kk: Knoten): string {
        if (!opt.has('l')) return farbig(n, kk);
        const typ = kk.typ === 'f' ? '-' : kk.typ;
        const g = opt.has('h') ? lesbar(groesse(kk)) : String(groesse(kk));
        const links = kk.typ === 'd' ? 2 + [...kk.kinder!.values()].filter((x) => x.typ === 'd').length : 1;
        const pfeil = kk.typ === 'l' ? ` -&gt; ${esc(kk.ziel!)}` : '';
        return `${typ}${kk.rechte} ${String(links).padStart(2)} ${kk.besitzer.padEnd(5)} ${kk.besitzer.padEnd(5)} ${g.padStart(5)} ${lsZeit(kk.zeit)} ${farbig(n, kk)}${pfeil}`;
      }
    },
  },
  cat: {
    kurz: 'zeigt den Inhalt einer Datei',
    lauf(args, ctx) {
      const sh = ctx.sh;
      if (!args.length) { ctx.fehler('cat: (Simulator) ohne Datei wartet cat auf Eingabe von der Tastatur.', 'Im echten Terminal wartet <code>cat</code> jetzt auf deine Eingabe. Beenden mit Strg+D oder Strg+C. Gib eine Datei an, zum Beispiel <code>cat notiz.txt</code>.'); return 1; }
      let code = 0;
      for (const a of args) {
        const k = sh.finden(a);
        if (!k) { ctx.fehler(`cat: ${a}: No such file or directory`, 'Diese Datei gibt es hier nicht. Prüfe mit <code>ls</code> den genauen Namen.'); code = 1; continue; }
        if (k.typ === 'd') { ctx.fehler(`cat: ${a}: Is a directory`, 'Das ist ein Ordner. Seinen Inhalt zeigt <code>ls</code>.'); code = 1; continue; }
        if (!sh.darfLesen(k)) { ctx.fehler(`cat: ${a}: Permission denied`); code = 1; continue; }
        const t = (k.inhalt ?? '').replace(/\n$/, '');
        if (t) for (const z of t.split('\n')) ctx.aus(z);
      }
      return code;
    },
  },
  mkdir: {
    kurz: 'legt einen Ordner an (-p auch mit Zwischenordnern)',
    lauf(args, ctx) {
      const sh = ctx.sh;
      const { opt, rest } = optionen(args);
      if (unbekannteOption(ctx, 'mkdir', opt, 'pv')) return 1;
      if (!rest.length) { ctx.fehler("mkdir: missing operand\nTry 'mkdir --help' for more information.", 'Sag mkdir, wie der neue Ordner heißen soll: <code>mkdir backup</code>.'); return 1; }
      let code = 0;
      for (const p of rest) {
        const abs = sh.absolut(p);
        if (sh.finden(abs)) { if (!opt.has('p')) { ctx.fehler(`mkdir: cannot create directory ‘${p}’: File exists`); code = 1; } continue; }
        const teile = abs.split('/').filter(Boolean);
        let o = sh.wurzel; let ok = true;
        for (let i = 0; i < teile.length; i++) {
          let n = o.kinder!.get(teile[i]);
          if (n?.typ === 'l') n = sh.finden('/' + teile.slice(0, i + 1).join('/'));
          if (!n) {
            if (i < teile.length - 1 && !opt.has('p')) { ctx.fehler(`mkdir: cannot create directory ‘${p}’: No such file or directory`, 'Der Ordner darüber existiert noch nicht. Mit <code>mkdir -p</code> legt mkdir alle fehlenden Ordner auf einmal an.'); ok = false; break; }
            if (!sh.darfSchreiben(o)) { ctx.fehler(`mkdir: cannot create directory ‘${p}’: Permission denied`, 'Hier darfst du nichts anlegen. In deinem Heimatordner <code>~</code> darfst du alles.'); ok = false; break; }
            n = { ...ordner(BENUTZER), zeit: new Date() };
            o.kinder!.set(teile[i], n);
          } else if (n.typ !== 'd') { ctx.fehler(`mkdir: cannot create directory ‘${p}’: Not a directory`); ok = false; break; }
          o = n;
        }
        if (!ok) code = 1;
        else if (opt.has('v')) ctx.aus(`mkdir: created directory '${p}'`);
      }
      return code;
    },
  },
  touch: {
    kurz: 'legt eine leere Datei an oder aktualisiert ihre Zeit',
    lauf(args, ctx) {
      const sh = ctx.sh;
      if (!args.length) { ctx.fehler("touch: missing file operand\nTry 'touch --help' for more information."); return 1; }
      let code = 0;
      for (const p of args) {
        const k = sh.finden(p);
        if (k) { k.zeit = new Date(); continue; }
        const { eltern, name } = sh.elternUndName(p);
        if (!eltern || eltern.typ !== 'd') { ctx.fehler(`touch: cannot touch '${p}': No such file or directory`, 'Der Ordner, in den die Datei soll, existiert nicht. Lege ihn vorher mit <code>mkdir</code> an.'); code = 1; continue; }
        if (!sh.darfSchreiben(eltern)) { ctx.fehler(`touch: cannot touch '${p}': Permission denied`); code = 1; continue; }
        eltern.kinder!.set(name, { ...datei('', BENUTZER), zeit: new Date() });
      }
      return code;
    },
  },
  sudo: {
    kurz: 'führt einen Befehl mit Adminrechten aus (im Simulator gesperrt)',
    lauf(_a, ctx) {
      ctx.fehler(`[sudo] password for ${BENUTZER}: \nsudo: (Simulator) Adminrechte gibt es hier nicht.`, 'Mit sudo arbeitest du ab Akt 3. Bis dahin brauchst du keine Adminrechte, alles passiert in deinem Heimatordner.');
      return 1;
    },
  },
  exit: {
    kurz: 'beendet die Shell',
    lauf(_a, ctx) { ctx.aus('(Simulator) Im echten Terminal schließt sich jetzt das Fenster oder die SSH-Verbindung.'); return 0; },
  },
};
