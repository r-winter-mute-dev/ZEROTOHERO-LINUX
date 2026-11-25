// Benutzer und Gruppen für den Simulator (Topic 107.1): /etc/passwd, /etc/shadow, /etc/group, /etc/gshadow,
// useradd, usermod, userdel, passwd, chage, groupadd, groupmod, groupdel, gpasswd, getent, id, groups.
// Meldungen nach den deutschen Katalogen von shadow und Linux-PAM.
import type { Welt } from './shell';

type Ergebnis = { out: string; err?: string; code: number };
type B = (w: Welt, a: string[], stdin: string, root: boolean) => Ergebnis;
const ok = (out = ''): Ergebnis => ({ out, code: 0 });
const fehler = (err: string, code = 1): Ergebnis => ({ out: '', err, code });

export interface AdminKern {
  rechte: (w: Welt, p: string, mode: number, owner: string, group: string) => void;
  dialog: (w: Welt, prompt: string, weiter: (zeile: string) => string) => void;
  heute: (w: Welt) => number;   // Tage seit 1970
}
let K: AdminKern;
export function adminKern(k: AdminKern) { K = k; }

// ---------- Dateien lesen und schreiben ----------

const zeilen = (w: Welt, p: string) => (w.fs[p] ?? '').split('\n').filter(Boolean).map((z) => z.split(':'));
const schreib = (w: Welt, p: string, z: string[][]) => { w.fs[p] = z.map((x) => x.join(':')).join('\n') + '\n'; };
export const passwd = (w: Welt) => zeilen(w, '/etc/passwd');
export const gruppen = (w: Welt) => zeilen(w, '/etc/group');
const shadow = (w: Welt) => zeilen(w, '/etc/shadow');
const gshadow = (w: Welt) => zeilen(w, '/etc/gshadow');
export function benutzer(w: Welt, n: string) { return passwd(w).find((x) => x[0] === n); }
export function gruppe(w: Welt, n: string) { return gruppen(w).find((x) => x[0] === n || x[2] === n); }
export function gruppenVon(w: Welt, n: string): string[] {
  const u = benutzer(w, n); if (!u) return [];
  const prim = gruppen(w).find((g) => g[2] === u[3])?.[0] ?? u[3];
  return [prim, ...gruppen(w).filter((g) => g[0] !== prim && (g[3] ?? '').split(',').includes(n)).map((g) => g[0])];
}
export function idText(w: Welt, n: string) {
  const u = benutzer(w, n); if (!u) return null;
  const gs = gruppenVon(w, n).map((g) => { const x = gruppe(w, g); return `${x?.[2] ?? '?'}(${g})`; });
  return `uid=${u[2]}(${n}) gid=${u[3]}(${gruppenVon(w, n)[0]}) Gruppen=${gs.join(',')}`;
}

const datumTage = (s: string): number | null => {
  if (s === '-1' || s === '') return -1;
  if (/^\d+$/.test(s)) return Number(s);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/); if (!m) return null;
  return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000);
};
const MONATE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const tageText = (t: number) => { const d = new Date(t * 86400000); return `${MONATE[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, '0')}, ${d.getUTCFullYear()}`; };
const isoText = (t: number) => new Date(t * 86400000).toISOString().slice(0, 10);

function hash(n: string) { let h = 0; for (const c of n + Date.now()) h = (h * 31 + c.charCodeAt(0)) >>> 0; return `$y$j9T$${h.toString(36).padStart(8, 'x')}$${(h * 7919 >>> 0).toString(36)}Qm2vZ8kP0rT5wY1aB3cD6eF9gH`; }

function optionen(a: string[], mitWert: string) {
  const o: Record<string, string> = {}; const rest: string[] = [];
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    if (/^--/.test(x)) { const [k, v] = x.slice(2).split('='); o['--' + k] = v ?? (mitWert.includes(k[0]) ? a[++i] ?? '' : ''); continue; }
    if (/^-\w/.test(x)) { for (let j = 1; j < x.length; j++) { const c = x[j]; if (mitWert.includes(c)) { o[c] = x.slice(j + 1) || a[++i] || ''; break; } o[c] = ''; } continue; }
    rest.push(x);
  }
  return { o, rest };
}
const nurRoot = (prog: string, datei = '/etc/passwd') => fehler(`${prog}: Erlaubnis verweigert.\n${prog}: ${datei} konnte nicht gesperrt werden; versuchen Sie es später noch einmal.`);
const NAME = /^[a-z_][a-z0-9_-]*\$?$/;

function homeAnlegen(w: Welt, home: string, user: string, grp: string, skel = '/etc/skel') {
  w.fs[home] = null; K.rechte(w, home, 0o700, user, grp);
  for (const p of Object.keys(w.fs).filter((x) => x.startsWith(skel + '/'))) {
    const z = home + p.slice(skel.length); w.fs[z] = w.fs[p]; K.rechte(w, z, w.fs[p] === null ? 0o755 : 0o644, user, grp);
  }
}

// ---------- Befehle ----------

export function adminBefehle(): Record<string, B> {
  const b: Record<string, B> = {};

  b.useradd = (w, a, _i, root) => {
    if (!root) return nurRoot('useradd');
    const { o, rest } = optionen(a, 'dsgGcueKk');
    const n = rest[0];
    if (!n) return fehler('Aufruf: useradd [Optionen] BENUTZER', 2);
    if (!NAME.test(n)) return fehler(`useradd: invalid user name '${n}'`, 3);
    if (benutzer(w, n)) return fehler(`useradd: Benutzer »${n}« existiert bereits`, 9);
    const sys = 'r' in o;
    const belegt = new Set(passwd(w).map((x) => Number(x[2])));
    let uid = o.u ? Number(o.u) : 0;
    if (!o.u) { uid = sys ? 999 : 1000; if (sys) { while (belegt.has(uid)) uid--; } else while (belegt.has(uid) || uid === 65534) uid++; }
    let gid: string;
    if (o.g) { const g = gruppe(w, o.g); if (!g) return fehler(`useradd: Gruppe »${o.g}« existiert nicht.`, 6); gid = g[2]; }
    else {
      if (gruppe(w, n)) return fehler(`useradd: Gruppe ${n} existiert – wenn Sie diesen Benutzer zu dieser Gruppe hinzufügen wollen, verwenden Sie -g.`, 9);
      const gbelegt = new Set(gruppen(w).map((x) => Number(x[2]))); let g = uid; while (gbelegt.has(g)) g++;
      gid = String(g);
      w.fs['/etc/group'] = (w.fs['/etc/group'] ?? '') + `${n}:x:${gid}:\n`;
      w.fs['/etc/gshadow'] = (w.fs['/etc/gshadow'] ?? '') + `${n}:!::\n`;
    }
    const zusatz = o.G ? o.G.split(',') : [];
    for (const g of zusatz) if (!gruppe(w, g)) return fehler(`useradd: Gruppe »${g}« existiert nicht.`, 6);
    const home = o.d ?? `/home/${n}`;
    // Debian 12: /etc/default/useradd setzt SHELL=/bin/sh
    const shell = o.s ?? ((w.fs['/etc/default/useradd'] ?? '').match(/^SHELL=(.+)$/m)?.[1] ?? '/bin/sh');
    w.fs['/etc/passwd'] = (w.fs['/etc/passwd'] ?? '') + `${n}:x:${uid}:${gid}:${o.c ?? ''}:${home}:${shell}\n`;
    const ablauf = o.e ? datumTage(o.e) : -1;
    if (ablauf === null) return fehler(`useradd: Ungültiges Datum »${o.e}«`, 3);
    w.fs['/etc/shadow'] = (w.fs['/etc/shadow'] ?? '') + `${n}:!:${K.heute(w)}:0:99999:7::${ablauf >= 0 ? ablauf : ''}:\n`;
    if (zusatz.length) { const gs = gruppen(w).map((g) => (zusatz.includes(g[0]) ? [g[0], g[1], g[2], [...(g[3] ? g[3].split(',') : []), n].join(',')] : g)); schreib(w, '/etc/group', gs); }
    if ('m' in o) { if (home in w.fs) return { out: '', err: `useradd: warning: the home directory ${home} already exists.\nuseradd: Not copying any file from skel directory into it.`, code: 0 }; homeAnlegen(w, home, n, gruppe(w, gid)?.[0] ?? n, o.k ?? '/etc/skel'); }
    w.fs[`/var/mail/${n}`] = ''; K.rechte(w, `/var/mail/${n}`, 0o660, n, 'mail');
    return ok();
  };

  b.usermod = (w, a, _i, root) => {
    if (!root) return nurRoot('usermod');
    const { o, rest } = optionen(a, 'dsgGcueKlLU'.replace('L', '').replace('U', '') );
    const n = rest[0];
    if (!n) return fehler('Aufruf: usermod [Optionen] BENUTZER', 2);
    const u = benutzer(w, n); if (!u) return fehler(`usermod: Benutzer »${n}« ist nicht vorhanden.`, 6);
    if ('G' in o) {
      const neu = o.G ? o.G.split(',') : [];
      for (const g of neu) if (!gruppe(w, g)) return fehler(`usermod: Gruppe »${g}« existiert nicht.`, 6);
      schreib(w, '/etc/group', gruppen(w).map((g) => {
        const m = (g[3] ? g[3].split(',') : []).filter((x) => x !== n || ('a' in o));
        if (neu.includes(g[0]) && !m.includes(n)) m.push(n);
        return [g[0], g[1], g[2], m.join(',')];
      }));
    }
    const p = passwd(w).map((x) => {
      if (x[0] !== n) return x;
      const y = [...x];
      if ('g' in o) { const g = gruppe(w, o.g); if (g) y[3] = g[2]; }
      if ('s' in o) y[6] = o.s; if ('c' in o) y[4] = o.c; if ('u' in o) y[2] = o.u;
      if ('d' in o) { if ('m' in o && x[5] in w.fs) { for (const k of Object.keys(w.fs).filter((q) => q === x[5] || q.startsWith(x[5] + '/'))) { w.fs[o.d + k.slice(x[5].length)] = w.fs[k]; delete w.fs[k]; } } y[5] = o.d; }
      if ('l' in o) y[0] = o.l;
      return y;
    });
    if ('g' in o && !gruppe(w, o.g)) return fehler(`usermod: Gruppe »${o.g}« existiert nicht.`, 6);
    schreib(w, '/etc/passwd', p);
    const sh = shadow(w).map((x) => {
      if (x[0] !== n) return x;
      const y = [...x];
      if ('L' in o && !y[1].startsWith('!')) y[1] = '!' + y[1];
      if ('U' in o) { if (y[1] === '!') return y; y[1] = y[1].replace(/^!/, ''); }
      if ('e' in o) { const t = o.e === '' ? -1 : datumTage(o.e); if (t !== null) y[7] = t < 0 ? '' : String(t); }
      if ('l' in o) y[0] = o.l;
      return y;
    });
    if ('U' in o && shadow(w).find((x) => x[0] === n)?.[1] === '!') return fehler(`usermod: unlocking the password would result in a passwordless account.\nYou should set a password with usermod -p to unlock this user's password.`);
    if ('e' in o && o.e !== '' && datumTage(o.e) === null) return fehler(`usermod: Ungültiges Datum »${o.e}«`, 3);
    schreib(w, '/etc/shadow', sh);
    if ('l' in o) for (const m of Object.values((w as Welt & { meta?: Record<string, { owner: string }> }).meta ?? {})) if (m.owner === n) m.owner = o.l;
    if ('l' in o) schreib(w, '/etc/group', gruppen(w).map((g) => [g[0], g[1], g[2], (g[3] ?? '').split(',').filter(Boolean).map((x) => (x === n ? o.l : x)).join(',')]));
    return ok();
  };

  b.userdel = (w, a, _i, root) => {
    if (!root) return nurRoot('userdel');
    const { o, rest } = optionen(a, '');
    const n = rest[0];
    const u = n ? benutzer(w, n) : undefined;
    if (!n) return fehler('Aufruf: userdel [Optionen] BENUTZER', 2);
    if (!u) return fehler(`userdel: Benutzer »${n}« ist nicht vorhanden.`, 6);
    if (n === 'lena' || n === 'root') return fehler(`userdel: Benutzer ${n} wird derzeit von Prozess ${n === 'root' ? 1 : 1203} verwendet`, 8);
    schreib(w, '/etc/passwd', passwd(w).filter((x) => x[0] !== n));
    schreib(w, '/etc/shadow', shadow(w).filter((x) => x[0] !== n));
    const andere = passwd(w).some((x) => x[3] === u[3]);
    schreib(w, '/etc/group', gruppen(w).filter((g) => !(g[0] === n && g[2] === u[3] && !andere)).map((g) => [g[0], g[1], g[2], (g[3] ?? '').split(',').filter((x) => x && x !== n).join(',')]));
    schreib(w, '/etc/gshadow', gshadow(w).filter((g) => !(g[0] === n && !andere)));
    const meld: string[] = [];
    if ('r' in o) {
      if (!(u[5] in w.fs)) meld.push(`userdel: ${n}-Home-Verzeichnis (${u[5]}) nicht gefunden`);
      for (const k of Object.keys(w.fs)) if (k === u[5] || k.startsWith(u[5] + '/')) delete w.fs[k];
      if (`/var/mail/${n}` in w.fs) delete w.fs[`/var/mail/${n}`]; else meld.push(`userdel: ${n} Mail-Warteschlange (/var/mail/${n}) nicht gefunden`);
    }
    return { out: '', err: meld.join('\n') || undefined, code: 0 };
  };

  b.groupadd = (w, a, _i, root) => {
    if (!root) return nurRoot('groupadd', '/etc/group');
    const { o, rest } = optionen(a, 'g'); const n = rest[0];
    if (!n) return fehler('Aufruf: groupadd [Optionen] GRUPPE', 2);
    if (gruppe(w, n)) return fehler(`groupadd: Gruppe »${n}« existiert bereits.`, 9);
    const belegt = new Set(gruppen(w).map((x) => Number(x[2])));
    let gid = o.g ? Number(o.g) : ('r' in o ? 999 : 1000);
    if (!o.g) while (belegt.has(gid)) gid += 'r' in o ? -1 : 1;
    else if (belegt.has(gid)) return fehler(`groupadd: GID »${gid}« existiert bereits.`, 4);
    w.fs['/etc/group'] = (w.fs['/etc/group'] ?? '') + `${n}:x:${gid}:\n`;
    w.fs['/etc/gshadow'] = (w.fs['/etc/gshadow'] ?? '') + `${n}:!::\n`;
    return ok();
  };
  b.groupmod = (w, a, _i, root) => {
    if (!root) return nurRoot('groupmod', '/etc/group');
    const { o, rest } = optionen(a, 'gn'); const n = rest[0];
    if (!n || !gruppe(w, n)) return fehler(`groupmod: Gruppe »${n ?? ''}« existiert nicht.`, 6);
    if (o.n && gruppe(w, o.n)) return fehler(`groupmod: Gruppe »${o.n}« existiert bereits.`, 9);
    schreib(w, '/etc/group', gruppen(w).map((g) => (g[0] === n ? [o.n ?? g[0], g[1], o.g ?? g[2], g[3] ?? ''] : g)));
    // Dateien speichern nur die GID: ls zeigt danach sofort den neuen Namen
    if (o.n) for (const m of Object.values((w as Welt & { meta?: Record<string, { group: string }> }).meta ?? {})) if (m.group === n) m.group = o.n;
    schreib(w, '/etc/gshadow', gshadow(w).map((g) => (g[0] === n ? [o.n ?? g[0], ...g.slice(1)] : g)));
    return ok();
  };
  b.groupdel = (w, a, _i, root) => {
    if (!root) return nurRoot('groupdel', '/etc/group');
    const n = a.find((x) => !x.startsWith('-')); const g = n ? gruppe(w, n) : undefined;
    if (!g) return fehler(`groupdel: Gruppe »${n ?? ''}« existiert nicht.`, 6);
    const prim = passwd(w).find((u) => u[3] === g[2]);
    if (prim) return fehler(`groupdel: Primäre Gruppe des Benutzers »${prim[0]}« konnte nicht entfernt werden.`, 8);
    schreib(w, '/etc/group', gruppen(w).filter((x) => x[0] !== g[0]));
    schreib(w, '/etc/gshadow', gshadow(w).filter((x) => x[0] !== g[0]));
    return ok();
  };
  b.gpasswd = (w, a, _i, root) => {
    if (!root) return fehler('gpasswd: Erlaubnis verweigert.');
    const { o, rest } = optionen(a, 'ad');
    const g = rest[0]; if (!g || !gruppe(w, g)) return fehler(`gpasswd: Gruppe »${g ?? ''}« existiert nicht.`, 3);
    const u = o.a ?? o.d; if (!u) return fehler('Aufruf: gpasswd [Option] GRUPPE', 2);
    if (!benutzer(w, u)) return fehler(`gpasswd: Benutzer »${u}« ist nicht vorhanden.`, 3);
    let meldung = '';
    schreib(w, '/etc/group', gruppen(w).map((x) => {
      if (x[0] !== g) return x;
      let m = (x[3] ?? '').split(',').filter(Boolean);
      if (o.a) { if (!m.includes(u)) m.push(u); meldung = `Benutzer ${u} wird zur Gruppe ${g} hinzugefügt.`; }
      else { if (!m.includes(u)) { meldung = `!gpasswd: Benutzer »${u}« ist kein Mitglied von »${g}«.`; return x; } m = m.filter((y) => y !== u); meldung = `Benutzer ${u} wird aus der Gruppe ${g} entfernt.`; }
      return [x[0], x[1], x[2], m.join(',')];
    }));
    return meldung.startsWith('!') ? fehler(meldung.slice(1), 3) : ok(meldung);
  };

  b.passwd = (w, a, _i, root) => {
    const { o, rest } = optionen(a, 'nxwi');
    const ich = root || w.root ? 'root' : 'lena';
    const n = rest[0] ?? ich;
    if (n !== ich && !(root || w.root)) return fehler(`passwd: Sie dürfen die Passwortinformationen für ${n} nicht anzeigen oder ändern.`);
    const s = shadow(w).find((x) => x[0] === n); if (!s) return fehler(`passwd: Benutzer »${n}« ist nicht vorhanden.`);
    const aendern = (f: (y: string[]) => void) => schreib(w, '/etc/shadow', shadow(w).map((x) => { if (x[0] !== n) return x; const y = [...x]; while (y.length < 9) y.push(''); f(y); return y; }));
    if ('S' in o) { const st = s[1].startsWith('!') || s[1] === '*' ? 'L' : s[1] === '' ? 'NP' : 'P'; return ok(`${n} ${st} ${isoText(Number(s[2] || 0))} ${s[3] || 0} ${s[4] || 99999} ${s[5] || 7} ${s[6] || -1}`); }
    if ('l' in o || 'u' in o || 'd' in o || 'e' in o || 'x' in o || 'n' in o) {
      if (!(root || w.root)) return fehler('passwd: Erlaubnis verweigert.');
      if ('l' in o) aendern((y) => { if (!y[1].startsWith('!')) y[1] = '!' + y[1]; });
      if ('u' in o) aendern((y) => { y[1] = y[1].replace(/^!/, ''); });
      if ('d' in o) aendern((y) => { y[1] = ''; });
      if ('e' in o) aendern((y) => { y[2] = '0'; });
      if ('x' in o) aendern((y) => { y[4] = o.x; }); if ('n' in o) aendern((y) => { y[3] = o.n; });
      return ok('passwd: Passwortablauf-Informationen geändert.');
    }
    const setzen = (zeile: string) => { aendern((y) => { y[1] = hash(n + zeile); y[2] = String(K.heute(w)); }); const ss = (w as { startstand?: { rootPw: string } }).startstand; if (n === 'root' && ss) ss.rootPw = zeile; };
    const neu = (weiter: () => void) => K.dialog(w, 'Geben Sie ein neues Passwort ein: ', (p1) => {
      K.dialog(w, 'Geben Sie das neue Passwort erneut ein: ', (p2) => {
        if (p1 !== p2) return 'Die Passwörter stimmen nicht überein.\npasswd: Bearbeitungssfehler des Legitimierungszeichens\npasswd: Passwort nicht geändert';
        if (!p1) return 'Kein Passwort angegeben.\npasswd: Bearbeitungssfehler des Legitimierungszeichens\npasswd: Passwort nicht geändert';
        setzen(p1); weiter(); return 'passwd: Passwort erfolgreich geändert';
      });
      return '';
    });
    if (root || w.root) { neu(() => {}); return ok(); }
    K.dialog(w, 'Geben Sie das aktuelle Passwort ein: ', () => { neu(() => {}); return ''; });
    return ok(`Ändern des Passworts für ${n}.`);
  };

  b.chage = (w, a, _i, root) => {
    const { o, rest } = optionen(a, 'mMWIEd');
    const n = rest[0]; const ich = root || w.root ? 'root' : 'lena';
    if (!n) return fehler('Aufruf: chage [Optionen] BENUTZER', 2);
    const s = shadow(w).find((x) => x[0] === n);
    if (!s) return fehler(`chage: Unbekannter Benutzer ${n}`, 1);
    if ('l' in o) {
      if (!(root || w.root) && n !== ich) return fehler('chage: Erlaubnis verweigert.');
      const letzte = Number(s[2] || 0); const max = Number(s[4] || 99999); const inakt = s[6] ? Number(s[6]) : -1; const abl = s[7] ? Number(s[7]) : -1;
      const laeuft = letzte === 0 ? 'Passwort muss geändert werden' : max >= 99999 ? 'nie' : tageText(letzte + max);
      return ok([
        `Letzte Passwortänderung\t\t\t\t\t: ${letzte === 0 ? 'Passwort muss geändert werden' : tageText(letzte)}`,
        `Passwort läuft ab\t\t\t\t\t: ${laeuft}`,
        `Passwort inaktiv\t\t\t\t\t: ${inakt < 0 || max >= 99999 ? 'nie' : tageText(letzte + max + inakt)}`,
        `Benutzerzugang läuft ab\t\t\t\t\t: ${abl < 0 ? 'nie' : tageText(abl)}`,
        `Minimum number of days between password change\t\t: ${s[3] || 0}`,
        `Maximum number of days between password change\t\t: ${s[4] || 99999}`,
        `Number of days of warning before password expires\t: ${s[5] || 7}`,
      ].join('\n'));
    }
    if (!(root || w.root)) return fehler('chage: Erlaubnis verweigert.\nchage: /etc/shadow konnte nicht gesperrt werden; versuchen Sie es später noch einmal.');
    if (!Object.keys(o).length) return ok(`Passwortalterung für ${n} wird geändert.\n(Im Simulator fragt chage nicht nach. Nutze die Optionen -m, -M, -W, -I, -E oder -d.)`);
    let fehlerText = '';
    schreib(w, '/etc/shadow', shadow(w).map((x) => {
      if (x[0] !== n) return x; const y = [...x]; while (y.length < 9) y.push('');
      if ('m' in o) y[3] = o.m; if ('M' in o) y[4] = o.M; if ('W' in o) y[5] = o.W; if ('I' in o) y[6] = o.I === '-1' ? '' : o.I;
      if ('E' in o) { const t = datumTage(o.E); if (t === null) fehlerText = `chage: Ungültiges Datum »${o.E}«`; else y[7] = t < 0 ? '' : String(t); }
      if ('d' in o) { const t = datumTage(o.d); if (t === null) fehlerText = `chage: Ungültiges Datum »${o.d}«`; else y[2] = String(t); }
      return y;
    }));
    return fehlerText ? fehler(fehlerText) : ok();
  };

  b.getent = (w, a, _i, root) => {
    const [db, key] = a;
    const dateien: Record<string, string> = { passwd: '/etc/passwd', group: '/etc/group', shadow: '/etc/shadow', gshadow: '/etc/gshadow', hosts: '/etc/hosts' };
    if (!db || !dateien[db]) return fehler(`Unbekannte Datenbank: ${db ?? ''}\n„getent --help“ oder „getent --usage“ gibt weitere Informationen.`, 1);
    if ((db === 'shadow' || db === 'gshadow') && !(root || w.root)) return { out: '', code: 2 };
    const z = (w.fs[dateien[db]] ?? '').split('\n').filter((x) => x && !x.startsWith('#'));
    if (!key) return ok(z.join('\n'));
    const t = z.filter((x) => (db === 'hosts' ? x.split(/\s+/).includes(key) : x.split(':')[0] === key || x.split(':')[2] === key));
    return t.length ? ok(t.join('\n')) : { out: '', code: 2 };
  };

  return b;
}

/** Eingebaute Antworten für id und groups mit beliebigen Benutzern. */
export function idFuer(w: Welt, a: string[], root: boolean): Ergebnis | null {
  const n = a.find((x) => !x.startsWith('-'));
  if (!n) return null;
  if (!benutzer(w, n)) return fehler(`id: »${n}«: Diesen Benutzer gibt es nicht`);
  const opt = a.filter((x) => x.startsWith('-')).join('').replace(/-/g, '');
  const u = benutzer(w, n)!;
  if (opt.includes('u')) return ok(opt.includes('n') ? n : u[2]);
  if (opt.includes('g')) return ok(opt.includes('n') ? gruppenVon(w, n)[0] : u[3]);
  if (opt.includes('G')) return ok(opt.includes('n') ? gruppenVon(w, n).join(' ') : gruppenVon(w, n).map((g) => gruppe(w, g)?.[2]).join(' '));
  void root;
  return ok(idText(w, n)!);
}

export function zustandAdmin(w: Welt, s: string): boolean | undefined {
  let m;
  if ((m = s.match(/^konto:([\w.-]+)$/))) return !!benutzer(w, m[1]);
  if ((m = s.match(/^konto:([\w.-]+)~(.+)$/))) { const u = benutzer(w, m[1]); return !!u && new RegExp(m[2]).test(u.join(':')); }
  if ((m = s.match(/^shadow:([\w.-]+)~(.+)$/))) { const u = shadow(w).find((x) => x[0] === m![1]); return !!u && new RegExp(m[2]).test(u.join(':')); }
  if ((m = s.match(/^gruppe-da:([\w.-]+)$/))) return !!gruppen(w).find((g) => g[0] === m![1]);
  if ((m = s.match(/^mitglied:([\w.-]+)=([\w.-]+)$/))) return gruppenVon(w, m[2]).includes(m[1]);
  return undefined;
}
