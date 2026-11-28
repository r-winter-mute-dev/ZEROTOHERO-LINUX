// Schlüssel und Zertifikate (LPIC-2 Topic 208.2): openssl genrsa, genpkey, req, x509, verify, rsa, s_client,
// passwd und rand. Schlüssel, Anträge und Zertifikate sind PEM-Dateien, deren Inhalt der Simulator lesen kann.
// Ein Zertifikat ist gültig, wenn der Aussteller mit seinem Schlüssel unterschrieben hat, die Zeit stimmt und
// eine Kette bis zu einer vertrauten Wurzel führt. Den Server für s_client und curl liefert das Web-Modul.
import type { Welt } from './shell';
import { meta, darf, sha256 } from './shell-dateien';

type Ergebnis = { out: string; err?: string; code: number; errNach?: boolean };
type B = (w: Welt, a: string[], stdin: string, root: boolean) => Ergebnis;
const ok = (out = ''): Ergebnis => ({ out, code: 0 });
const fehler = (err: string, code = 1): Ergebnis => ({ out: '', err, code });

export interface Name { [feld: string]: string }
export interface Schluessel { art: 'key'; id: string; bits: number; alg: 'RSA' | 'EC'; pass?: string }
export interface Zert { art: 'cert'; subj: Name; iss: Name; san: string[]; serial: string; nb: number; na: number; key: string; signer: string; ca: boolean; bits: number }
export interface Antrag { art: 'csr'; subj: Name; key: string; san: string[]; bits: number }
type Obj = Schluessel | Zert | Antrag;

let K: { pfad: (w: Welt, p: string) => string; schreiben: (w: Welt, p: string, t: string, anh: boolean, root: boolean) => string | null; dialog: (w: Welt, prompt: string, weiter: (z: string) => string) => void };
export function tlsKern(k: typeof K) { K = k; }

// ---------- PEM ----------
const MARKE = 'LTH1:';
const KOPF: Record<Obj['art'], string> = { key: 'PRIVATE KEY', cert: 'CERTIFICATE', csr: 'CERTIFICATE REQUEST' };
const b64 = (s: string) => btoa(unescape(encodeURIComponent(s)));
const unb64 = (s: string) => decodeURIComponent(escape(atob(s)));
export function pem(o: Obj): string {
  const body = b64(MARKE + JSON.stringify(o)).replace(/(.{64})/g, '$1\n').replace(/\n$/, '');
  const k = o.art === 'key' && o.pass ? 'ENCRYPTED PRIVATE KEY' : KOPF[o.art];
  return `-----BEGIN ${k}-----\n${body}\n-----END ${k}-----\n`;
}
/** Alle PEM-Blöcke einer Datei, in der Reihenfolge, in der sie stehen. */
export function pemLesen(text: string | null | undefined): Obj[] {
  if (typeof text !== 'string') return [];
  const out: Obj[] = [];
  for (const m of text.matchAll(/-----BEGIN ([A-Z ]+)-----\n([\s\S]*?)\n-----END \1-----/g)) {
    try { const t = unb64(m[2].replace(/\s+/g, '')); if (t.startsWith(MARKE)) out.push(JSON.parse(t.slice(MARKE.length))); } catch { /* fremder Inhalt */ }
  }
  return out;
}
export const zertifikate = (t: string | null | undefined) => pemLesen(t).filter((o): o is Zert => o.art === 'cert');
export const schluesselIn = (t: string | null | undefined) => pemLesen(t).find((o): o is Schluessel => o.art === 'key') ?? null;

// ---------- Namen ----------
export const nameText = (n: Name) => Object.entries(n).map(([k, v]) => `${k} = ${v}`).join(', ');
function subjLesen(s: string): Name | string {
  if (!s.startsWith('/')) return `subject name is expected to be in the format /type0=value0/type1=value1/type2=... where characters may be escaped by \\. This name is not in that format: '${s}'`;
  const n: Name = {};
  for (const teil of s.slice(1).split(/(?<!\\)\//).filter(Boolean)) {
    const i = teil.indexOf('='); if (i < 1) return `Hit end of string before finding the '='`;
    const k = teil.slice(0, i); const v = teil.slice(i + 1).replace(/\\\//g, '/');
    if (!['C', 'ST', 'L', 'O', 'OU', 'CN', 'emailAddress'].includes(k)) return `Subject Attribute ${k} has no known NID, skipped`;
    if (k === 'C' && v.length !== 2) return `string too long`;
    n[k] = v;
  }
  return n;
}
const sanLesen = (s: string) => s.replace(/^\s*subjectAltName\s*=\s*/, '').split(',').map((x) => x.trim()).filter(Boolean).map((x) => x.replace(/^DNS\s*:\s*/i, 'DNS:').replace(/^IP\s*:\s*/i, 'IP Address:'));

// ---------- Zeit, Zufall ----------
type TW = Welt & { tls?: { zaehler: number } };
function zufall(w: Welt, n: number): string { const t = (w as TW).tls ?? ((w as TW).tls = { zaehler: 0 }); t.zaehler++; let h = ''; while (h.length < n) h += sha256(`${w.uhr}:${t.zaehler}:${h.length}`); return h.slice(0, n); }
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function gmt(ms: number) { const d = new Date(ms); const z = (x: number) => String(x).padStart(2, '0'); return `${MON[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, ' ')} ${z(d.getUTCHours())}:${z(d.getUTCMinutes())}:${z(d.getUTCSeconds())} ${d.getUTCFullYear()} GMT`; }
const modulus = (keyId: string) => sha256('mod' + keyId).repeat(8).slice(0, 512).toUpperCase();
const doppel = (hex: string) => hex.match(/../g)!.join(':');

// ---------- Prüfen ----------
export interface Pruefung { ok: boolean; nr?: number; text?: string; tiefe?: number; kette: Zert[] }
/** Baut die Kette vom ersten Zertifikat bis zu einer vertrauten Wurzel. mitgeliefert: Zwischenzertifikate des Servers. */
export function pruefen(w: Welt, leaf: Zert, mitgeliefert: Zert[], vertraut: Zert[]): Pruefung {
  const kette: Zert[] = [leaf];
  let akt = leaf;
  for (let tiefe = 0; tiefe < 8; tiefe++) {
    if (w.uhr > akt.na) return { ok: false, nr: 10, text: 'certificate has expired', tiefe, kette };
    if (w.uhr < akt.nb) return { ok: false, nr: 9, text: 'certificate is not yet valid', tiefe, kette };
    const anker = vertraut.find((v) => v.key === akt.signer && nameText(v.subj) === nameText(akt.iss));
    if (anker) { if (anker.key !== akt.key) kette.push(anker); return { ok: true, kette }; }
    const selbst = akt.signer === akt.key && nameText(akt.subj) === nameText(akt.iss);
    if (selbst) return { ok: false, nr: tiefe === 0 ? 18 : 19, text: tiefe === 0 ? 'self-signed certificate' : 'self-signed certificate in certificate chain', tiefe, kette };
    const weiter = mitgeliefert.find((v) => v.key === akt.signer && nameText(v.subj) === nameText(akt.iss) && v.ca);
    if (!weiter) return { ok: false, nr: tiefe === 0 ? 20 : 20, text: 'unable to get local issuer certificate', tiefe, kette };
    kette.push(weiter); akt = weiter;
  }
  return { ok: false, nr: 20, text: 'unable to get local issuer certificate', tiefe: 0, kette };
}
/** Passt das Zertifikat zum Namen? Wie OpenSSL: zuerst die DNS-Einträge im SAN, ohne SAN der CN. */
export function namePasst(z: Zert, host: string): 'ok' | 'san' | 'cn' {
  const h = host.toLowerCase();
  const passt = (muster: string) => { const m = muster.toLowerCase(); return m === h || (m.startsWith('*.') && h.split('.').length === m.split('.').length && h.endsWith(m.slice(1))); };
  const dns = z.san.filter((s) => s.startsWith('DNS:')).map((s) => s.slice(4));
  const ips = z.san.filter((s) => s.startsWith('IP Address:')).map((s) => s.slice(11));
  if (dns.length || ips.length) return dns.some(passt) || ips.includes(h) ? 'ok' : 'san';
  return z.subj.CN && passt(z.subj.CN) ? 'ok' : 'cn';
}

// ---------- Dateien ----------
function lesen(w: Welt, f: string, root: boolean): { text: string } | { fehler: string } {
  const p = K.pfad(w, f);
  if (!(p in w.fs)) return { fehler: `Could not open file or uri for loading` };
  if (w.fs[p] === null) return { fehler: 'Is a directory' };
  if (!darf(w, p, 'r', root)) return { fehler: `Could not open file or uri for loading` };
  return { text: w.fs[p] as string };
}
function schreiben(w: Welt, f: string, text: string, root: boolean, modus?: number): string | null {
  const p = K.pfad(w, f); const neu = !(p in w.fs);
  const e = K.schreiben(w, p, text, false, root); if (e) return e;
  if (neu && modus !== undefined) meta(w, p).mode = modus;
  return null;
}
const ladeFehler = (_cmd: string, f: string, was: string) => `Could not open file or uri for loading ${was} from ${f}\n40D7B1E1A47F0000:error:16000069:STORE routines:ossl_store_get0_loader_int:unregistered scheme:../crypto/store/store_register.c:237:scheme=file\n40D7B1E1A47F0000:error:80000002:system library:file_open:No such file or directory:../providers/implementations/storemgmt/file_store.c:267:calling stat(${f})`;

function optWert(a: string[], n: string): string | undefined { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; }

// ---------- Passphrasen ----------
let lauf: { w: Welt; a: string[]; root: boolean; befehl: B } | null = null;
const passWert = (a: string[], n: string) => { const v = optWert(a, n); return v === undefined ? undefined : v.replace(/^pass:/, ''); };
/** Schlüssel lesen. Ist er verschlüsselt und fehlt -passin, fragt openssl nach der Passphrase und startet den Befehl neu. */
function schluesselLesen(text: string, datei: string): Schluessel | Ergebnis {
  const k = schluesselIn(text); if (!k) return fehler(`Could not read private key from ${datei}`);
  if (!k.pass || !lauf) return k;
  const pi = passWert(lauf.a, '-passin');
  if (pi === undefined) { const l = lauf; K.dialog(l.w, `Enter pass phrase for ${datei}:`, (pw) => { const r = l.befehl(l.w, [...l.a, '-passin', `pass:${pw}`], '', l.root); return [r.out, r.err].filter(Boolean).join('\n'); }); return ok(); }
  if (sha256(pi) !== k.pass) return fehler(`Could not read private key from ${datei}\n40C7B5C1F17F0000:error:1C800064:Provider routines:ossl_cipher_unpadblock:bad decrypt:../providers/implementations/ciphers/ciphercommon_block.c:124:`);
  return k;
}
/** Neuen Schlüssel verschlüsseln? Fragt bei Bedarf zweimal nach der Passphrase und startet neu. */
function verschluesseln(k: Schluessel, noetig: boolean): Schluessel | Ergebnis {
  if (!noetig || !lauf) return k;
  const po = passWert(lauf.a, '-passout');
  if (po !== undefined) { if (po.length < 4) return fehler('Passphrase must be at least 4 characters.'); return { ...k, pass: sha256(po) }; }
  const l = lauf;
  K.dialog(l.w, 'Enter PEM pass phrase:', (p1) => { if (p1.length < 4) return 'Passphrase must be at least 4 characters.\nUser interface error'; K.dialog(l.w, 'Verifying - Enter PEM pass phrase:', (p2) => { if (p1 !== p2) return 'Verify failure\nUser interface error'; const r = l.befehl(l.w, [...l.a, '-passout', `pass:${p1}`], '', l.root); return [r.out, r.err].filter(Boolean).join('\n'); }); return ''; });
  return ok();
}
const istErg = (x: unknown): x is Ergebnis => typeof x === 'object' && x !== null && 'code' in x;

// ---------- openssl ----------
export const OPENSSL_VERSION = 'OpenSSL 3.0.22 25 Aug 2026 (Library: OpenSSL 3.0.22 25 Aug 2026)';
export const opensslVersion = (w: Welt) => (w.distro === 'debian' ? OPENSSL_VERSION : 'OpenSSL 3.5.9 29 Sep 2026 (Library: OpenSSL 3.5.9 29 Sep 2026)');
export type TlsServer = (w: Welt, host: string, port: number, sni: string | null) => { kette: Zert[]; protokolle: string[]; bits: number } | { fehler: string } | null;
let serverQuelle: TlsServer = () => null;
export function tlsServerQuelle(f: TlsServer) { serverQuelle = f; }

export function vertrauteWurzeln(w: Welt, extra?: string): Zert[] {
  const sys = w.distro === 'debian' ? '/etc/ssl/certs/ca-certificates.crt' : '/etc/pki/tls/certs/ca-bundle.crt';
  return [...zertifikate(w.fs[sys] as string), ...(extra !== undefined ? zertifikate(extra) : [])];
}

function zertText(z: Zert): string {
  const ext = [z.san.length ? `            X509v3 Subject Alternative Name: \n                ${z.san.join(', ')}` : '', `            X509v3 Subject Key Identifier: \n                ${doppel(sha256('ski' + z.key).slice(0, 40).toUpperCase())}`, z.ca ? '            X509v3 Basic Constraints: critical\n                CA:TRUE' : ''].filter(Boolean).join('\n');
  return `Certificate:\n    Data:\n        Version: 3 (0x2)\n        Serial Number:\n            ${doppel(z.serial)}\n        Signature Algorithm: sha256WithRSAEncryption\n        Issuer: ${nameText(z.iss)}\n        Validity\n            Not Before: ${gmt(z.nb)}\n            Not After : ${gmt(z.na)}\n        Subject: ${nameText(z.subj)}\n        Subject Public Key Info:\n            Public Key Algorithm: rsaEncryption\n                Public-Key: (${z.bits} bit)\n                Modulus:\n                    00:${doppel(modulus(z.key).slice(0, 30).toLowerCase())}:\n                    (gekürzt)\n                Exponent: 65537 (0x10001)\n        X509v3 extensions:\n${ext}\n    Signature Algorithm: sha256WithRSAEncryption\n    Signature Value:\n        ${doppel(sha256('sig' + z.serial).slice(0, 36))}:\n        (gekürzt)`;
}

export function opensslBefehl(): B {
  const befehl: B = (w, a, stdin, root) => {
    lauf = { w, a, root, befehl };
    const [cmd, ...r] = a;
    switch (cmd) {
      case undefined: return fehler('help:\n\nStandard commands\nasn1parse ca ciphers cms crl crl2pkcs7 dgst dhparam dsaparam ec ecparam enc engine errstr gendsa genpkey genrsa help info kdf list mac nseq ocsp passwd pkcs12 pkcs7 pkcs8 pkey pkeyparam pkeyutl prime rand rehash req rsa rsautl s_client s_server s_time sess_id smime speed spkac srp storeutl ts verify version x509');
      case 'version': return ok(r.includes('-a') ? `${opensslVersion(w)}\nbuilt on: (siehe Paket)\nplatform: debian-amd64\nOPENSSLDIR: "${w.distro === 'debian' ? '/usr/lib/ssl' : '/etc/pki/tls'}"` : opensslVersion(w));
      case 'genrsa': case 'genpkey': {
        let bits = 2048;
        if (cmd === 'genrsa') { const z = r.filter((x, i) => /^\d+$/.test(x) && r[i - 1] !== '-out'); if (z.length) bits = Number(z[z.length - 1]); }
        else { const alg = optWert(r, '-algorithm'); if (!alg) return fehler('genpkey: No algorithm or parameters given'); if (!/^(RSA|rsa|EC|ED25519)$/.test(alg)) return fehler(`genpkey: Algorithm ${alg} not found`); const o = optWert(r, '-pkeyopt'); if (o?.startsWith('rsa_keygen_bits:')) bits = Number(o.split(':')[1]); }
        if (bits < 512) return fehler(`Warning: It is not recommended to use less than 2048 bits for RSA keys.\n         Your key size is ${bits}! Larger key size may behave not as expected.\nError generating RSA key\n40C7B5C1F17F0000:error:1C8000AF:Provider routines:rsa_gen_set_params:key size too small:../providers/implementations/keymgmt/rsa_kmgmt.c:524:`);
        const k0: Schluessel = { art: 'key', id: zufall(w, 16), bits, alg: optWert(r, '-algorithm')?.toUpperCase() === 'EC' ? 'EC' : 'RSA' };
        const k = verschluesseln(k0, r.some((x) => /^-(aes128|aes192|aes256|des3|aes-256-cbc)$/.test(x))); if (istErg(k)) return k;
        const out = optWert(r, '-out');
        const warn = bits < 2048 ? `Warning: It is not recommended to use less than 2048 bits for RSA keys.\n         Your key size is ${bits}! Larger key size may behave not as expected.\n` : '';
        if (!out) return { out: pem(k), err: warn || undefined, code: 0 };
        const e = schreiben(w, out, pem(k), root, 0o600); if (e) return fehler(`${cmd}: Can't open "${out}" for writing, ${e === 'Keine Berechtigung' ? 'Permission denied' : 'No such file or directory'}`);
        return warn ? { out: '', err: warn, code: 0 } : ok();
      }
      case 'rsa': case 'pkey': {
        const f = optWert(r, '-in'); if (!f) return fehler(`${cmd}: no input file given (-in)`);
        const t = lesen(w, f, root); if ('fehler' in t) return fehler(ladeFehler(cmd, f, 'Private Key'));
        const k = schluesselLesen(t.text, f); if (istErg(k)) return k;
        const ko: Schluessel = r.some((x) => /^-(aes128|aes256|des3)$/.test(x)) ? k : { ...k, pass: undefined };
        const teile: string[] = [];
        if (r.includes('-check')) teile.push('RSA key ok');
        if (r.includes('-modulus')) teile.push(`Modulus=${modulus(k.id)}`);
        if (r.includes('-text')) teile.push(`Private-Key: (${k.bits} bit, 2 primes)\nmodulus:\n    00:${doppel(modulus(k.id).slice(0, 30).toLowerCase())}:\n    (gekürzt)\npublicExponent: 65537 (0x10001)\nprivateExponent:\n    (gekürzt)`);
        if (r.includes('-pubout')) teile.push(`-----BEGIN PUBLIC KEY-----\n${b64('pub' + k.id).slice(0, 64)}\n-----END PUBLIC KEY-----`);
        else if (!r.includes('-noout')) teile.push(pem(ko).trimEnd());
        const out = optWert(r, '-out');
        if (out && !r.includes('-noout')) { const e = schreiben(w, out, pem(ko), root, 0o600); if (e) return fehler(`${cmd}: Can't open "${out}" for writing`); return { out: teile.filter((x) => !x.startsWith('-----')).join('\n'), err: 'writing RSA key', code: 0 }; }
        return ok(teile.join('\n'));
      }
      case 'req': return req(w, r, root);
      case 'x509': return x509(w, r, stdin, root);
      case 'verify': {
        const ca = optWert(r, '-CAfile'); const unt = optWert(r, '-untrusted');
        const dateien = r.filter((x, i) => !x.startsWith('-') && !['-CAfile', '-untrusted', '-CApath'].includes(r[i - 1]));
        const vertraut = [...vertrauteWurzeln(w)]; const zwischen: Zert[] = [];
        if (ca) { const t = lesen(w, ca, root); if ('fehler' in t) return fehler(`Error loading file ${ca}`, 2); vertraut.push(...zertifikate(t.text)); }
        if (unt) { const t = lesen(w, unt, root); if ('fehler' in t) return fehler(`Error loading untrusted file ${unt}`, 2); zwischen.push(...zertifikate(t.text)); }
        const out: string[] = []; let code = 0;
        for (const f of dateien) {
          const t = lesen(w, f, root); const z = 'fehler' in t ? undefined : zertifikate(t.text)[0];
          if (!z) { out.push(`Could not open file or uri for loading certificate from ${f}`); code = 2; continue; }
          const p = pruefen(w, z, zwischen, vertraut);
          if (p.ok) out.push(`${f}: OK`);
          else { out.push(`${nameText(p.kette[p.tiefe ?? 0].subj)}\nerror ${p.nr} at ${p.tiefe} depth lookup: ${p.text}\nerror ${f}: verification failed`); code = 2; }
        }
        return code ? { out: out.filter((x) => x.endsWith(': OK')).join('\n'), err: out.filter((x) => !x.endsWith(': OK')).join('\n'), code } : ok(out.join('\n'));
      }
      case 's_client': return sClient(w, r, root);
      case 'passwd': {
        const pw = r.filter((x) => !x.startsWith('-')).pop();
        if (!pw) return fehler('passwd: Passwort bitte als Argument angeben (im Simulator ohne Rückfrage).');
        const salz = zufall(w, 8).replace(/[^a-zA-Z0-9]/g, 'x');
        if (r.includes('-apr1') || r.includes('-1')) return ok(`$${r.includes('-1') ? '1' : 'apr1'}$${salz}$${hashTeil(salz, pw, 22)}`);
        if (r.includes('-6')) return ok(`$6$${salz}${salz}$${hashTeil(salz, pw, 86)}`);
        if (r.includes('-5')) return ok(`$5$${salz}${salz}$${hashTeil(salz, pw, 43)}`);
        return ok(`$1$${salz}$${hashTeil(salz, pw, 22)}`);
      }
      case 'rand': {
        const n = Number(r.find((x) => /^\d+$/.test(x)) ?? 16);
        const hex = zufall(w, n * 2);
        if (r.includes('-hex')) return ok(hex);
        return ok(btoa(hex.match(/../g)!.map((x) => String.fromCharCode(parseInt(x, 16))).join('')));
      }
      case 'dgst': case 'sha256': {
        const f = r.filter((x) => !x.startsWith('-')).pop();
        const text = f ? ((lesen(w, f, root) as { text?: string }).text ?? null) : stdin;
        if (text === null) return fehler(`${f}: No such file or directory`);
        return ok(`SHA2-256(${f ?? 'stdin'})= ${sha256(text)}`);
      }
      default: return fehler(`Invalid command '${cmd}'; type "help" for a list.`);
    }
  };
  return befehl;
}
export function hashTeil(salz: string, pw: string, n: number) { const zeichen = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'; return sha256(`${salz}$${pw}`).repeat(3).slice(0, n).split('').map((c, i) => zeichen[(parseInt(c, 16) * 4 + i) % 64]).join(''); }

const DN_FRAGEN: [string, string, string][] = [
  ['C', 'Country Name (2 letter code) [AU]:', 'AU'], ['ST', 'State or Province Name (full name) [Some-State]:', 'Some-State'], ['L', 'Locality Name (eg, city) []:', ''],
  ['O', 'Organization Name (eg, company) [Internet Widgits Pty Ltd]:', 'Internet Widgits Pty Ltd'], ['OU', 'Organizational Unit Name (eg, section) []:', ''],
  ['CN', 'Common Name (e.g. server FQDN or YOUR name) []:', ''], ['emailAddress', 'Email Address []:', ''],
];
const DN_VORSPANN = "You are about to be asked to enter information that will be incorporated\ninto your certificate request.\nWhat you are about to enter is what is called a Distinguished Name or a DN.\nThere are quite a few fields but you can leave some blank\nFor some fields there will be a default value,\nIf you enter '.', the field will be left blank.\n-----";

function req(w: Welt, r: string[], root: boolean): Ergebnis {
  const inF = optWert(r, '-in'); const out = optWert(r, '-out');
  // Vorhandenen Antrag ansehen
  if (inF && !r.includes('-x509')) {
    const t = lesen(w, inF, root); if ('fehler' in t) return fehler(ladeFehler('req', inF, 'X509 request'));
    const c = pemLesen(t.text).find((o): o is Antrag => o.art === 'csr'); if (!c) return fehler(`Unable to load X509 request`);
    const teile: string[] = [];
    if (r.includes('-verify')) teile.push('Certificate request self-signature verify OK');
    if (r.includes('-subject')) teile.push(`subject=${nameText(c.subj)}`);
    if (r.includes('-text')) teile.push(`Certificate Request:\n    Data:\n        Version: 1 (0x0)\n        Subject: ${nameText(c.subj)}\n        Subject Public Key Info:\n            Public Key Algorithm: rsaEncryption\n                Public-Key: (${c.bits} bit)\n                (gekürzt)\n        Attributes:${c.san.length ? `\n            Requested Extensions:\n                X509v3 Subject Alternative Name: \n                    ${c.san.join(', ')}` : '\n            (none)\n            Requested Extensions:'}\n    Signature Algorithm: sha256WithRSAEncryption\n    Signature Value:\n        (gekürzt)`);
    if (!r.includes('-noout')) teile.push(pem(c).trimEnd());
    return ok(teile.join('\n'));
  }
  if (!r.includes('-new') && !r.includes('-x509') && !r.includes('-newkey')) return fehler('req: Use -help for summary.');
  // Schlüssel: vorhanden (-key) oder neu (-newkey)
  let key: Schluessel; let neuerSchluessel = false; let stderr = '';
  const kf = optWert(r, '-key'); const nk = optWert(r, '-newkey');
  if (kf) { const t = lesen(w, kf, root); if ('fehler' in t) return fehler(ladeFehler('req', kf, 'private key')); const k = schluesselLesen(t.text, kf); if (istErg(k)) return k; key = k; }
  else { const bits = Number(nk?.match(/rsa:(\d+)/)?.[1] ?? 2048); key = { art: 'key', id: zufall(w, 16), bits, alg: 'RSA' }; neuerSchluessel = true; stderr = '..+.....+.+++++++++++++++++++++++++*..+....+...+++++++++++++++++++++++++*...+....+\n-----'; }
  if (neuerSchluessel) { const k2 = verschluesseln(key, !r.includes('-nodes') && !r.includes('-noenc')); if (istErg(k2)) return k2.code || !lauf || passWert(lauf.a, '-passout') !== undefined ? k2 : { ...k2, out: stderr }; key = k2; }
  const san = (r.flatMap((x, i) => (r[i - 1] === '-addext' && /subjectAltName/.test(x) ? sanLesen(x) : [])));
  const fertig = (subj: Name, vorspann: string): Ergebnis => {
    const x509 = r.includes('-x509');
    const tage = Number(optWert(r, '-days') ?? 30);
    const obj: Obj = x509
      ? { art: 'cert', subj, iss: subj, san, serial: zufall(w, 40), nb: w.uhr, na: w.uhr + tage * 86400000, key: key.id, signer: key.id, ca: true, bits: key.bits }
      : { art: 'csr', subj, key: key.id, san, bits: key.bits };
    if (neuerSchluessel) { const ko = optWert(r, '-keyout') ?? 'privkey.pem'; const e = schreiben(w, ko, pem(key), root, 0o600); if (e) return fehler(`req: Can't open "${ko}" for writing, Permission denied`); }
    if (out) { const e = schreiben(w, out, pem(obj), root); if (e) return fehler(`req: Can't open "${out}" for writing, ${e === 'Keine Berechtigung' ? 'Permission denied' : 'No such file or directory'}`); return { out: vorspann, err: stderr || undefined, code: 0 }; }
    return { out: vorspann + pem(obj), err: stderr || undefined, code: 0 };
  };
  const s = optWert(r, '-subj');
  if (s !== undefined) { const n = subjLesen(s); if (typeof n === 'string') return fehler(`req: ${n}\nreq: Error making certificate request`); return fertig(n, ''); }
  // Ohne -subj fragt req die Felder einzeln ab
  const antworten: Name = {};
  const frage = (i: number, vorher: string): void => {
    const [feld, prompt, std] = DN_FRAGEN[i];
    K.dialog(w, (vorher ? vorher + '\n' : '') + prompt, (z) => {
      const v = z.trim() === '' ? std : z.trim() === '.' ? '' : z.trim();
      if (v) antworten[feld] = v;
      if (i + 1 < DN_FRAGEN.length) { frage(i + 1, ''); return ''; }
      if (!r.includes('-x509')) {
        K.dialog(w, "\nPlease enter the following 'extra' attributes\nto be sent with your certificate request\nA challenge password []:", () => { K.dialog(w, 'An optional company name []:', () => { const e = fertig(antworten, ''); return e.code ? e.err ?? '' : e.out; }); return ''; });
        return '';
      }
      const e = fertig(antworten, ''); return e.code ? e.err ?? '' : e.out;
    });
  };
  frage(0, (stderr ? stderr + '\n' : '') + DN_VORSPANN);
  return ok();
}

function x509(w: Welt, r: string[], stdin: string, root: boolean): Ergebnis {
  const inF = optWert(r, '-in');
  const text = inF ? lesen(w, inF, root) : { text: stdin };
  if ('fehler' in text) return fehler(ladeFehler('x509', inF!, r.includes('-req') ? 'certificate request' : 'certificate') + (r.includes('-req') ? '' : '\nUnable to load certificate'));
  const out = optWert(r, '-out'); const tage = Number(optWert(r, '-days') ?? 30);
  if (r.includes('-req')) {
    const c = pemLesen(text.text).find((o): o is Antrag => o.art === 'csr'); if (!c) return fehler('x509: Unable to load X509 request');
    let iss = c.subj; let signer = c.key;
    const caF = optWert(r, '-CA'); const caK = optWert(r, '-CAkey'); const sign = optWert(r, '-signkey') ?? optWert(r, '-key');
    let serial = zufall(w, 40);
    if (caF) {
      const t1 = lesen(w, caF, root); if ('fehler' in t1) return fehler(ladeFehler('x509', caF, 'CA certificate'));
      const ca = zertifikate(t1.text)[0]; if (!ca) return fehler(`x509: unable to load CA certificate from ${caF}`);
      const kf = caK ?? caF; const t2 = lesen(w, kf, root); if ('fehler' in t2) return fehler(ladeFehler('x509', kf, 'CA private key'));
      const k = schluesselLesen(t2.text, kf); if (istErg(k)) return k;
      if (k.id !== ca.key) return fehler(`Warning: Signature key and public key of cert do not match\nx509: Error while signing certificate with CA key`);
      iss = ca.subj; signer = k.id;
      const srl = (optWert(r, '-CAserial') ?? caF.replace(/\.[^./]+$/, '') + '.srl');
      const altSrl = w.fs[K.pfad(w, srl)];
      if (typeof altSrl === 'string') serial = (BigInt('0x' + altSrl.trim()) + 1n).toString(16).toUpperCase().padStart(40, '0');
      // OpenSSL 3: ohne Seriennummerndatei und ohne -CAcreateserial gibt es eine zufällige Nummer
      if (typeof altSrl === 'string' || r.includes('-CAcreateserial') || optWert(r, '-CAserial')) { const e = schreiben(w, srl, serial.toUpperCase() + '\n', root); if (e) return fehler(`x509: Can't open "${srl}" for writing`); }
    } else if (sign) {
      const t2 = lesen(w, sign, root); if ('fehler' in t2) return fehler(ladeFehler('x509', sign, 'private key'));
      const k = schluesselLesen(t2.text, sign); if (istErg(k)) return k; signer = k.id;
    }
    let san: string[] = r.includes('-copy_extensions') && optWert(r, '-copy_extensions') !== 'none' ? c.san : [];
    const ext = optWert(r, '-extfile');
    if (ext) { const t3 = lesen(w, ext, root); if ('fehler' in t3) return fehler(ladeFehler('x509', ext, 'extensions')); const z = t3.text.split('\n').find((l) => /^\s*subjectAltName\s*=/.test(l)); if (z) san = sanLesen(z); }
    const cert: Zert = { art: 'cert', subj: c.subj, iss, san, serial, nb: w.uhr, na: w.uhr + tage * 86400000, key: c.key, signer, ca: false, bits: c.bits };
    const meld = `Certificate request self-signature ok\nsubject=${nameText(c.subj)}`;
    if (out) { const e = schreiben(w, out, pem(cert), root); if (e) return fehler(`x509: Can't open "${out}" for writing, ${e === 'Keine Berechtigung' ? 'Permission denied' : 'No such file or directory'}`); return { out: '', err: meld, code: 0 }; }
    return { out: pem(cert), err: meld, code: 0 };
  }
  const z = zertifikate(text.text)[0];
  if (!z) return fehler(`Could not read certificate from ${inF ?? '<stdin>'}\nUnable to load certificate`);
  const teile: string[] = [];
  for (const o of r) {
    if (o === '-subject') teile.push(`subject=${nameText(z.subj)}`);
    else if (o === '-issuer') teile.push(`issuer=${nameText(z.iss)}`);
    else if (o === '-dates') teile.push(`notBefore=${gmt(z.nb)}\nnotAfter=${gmt(z.na)}`);
    else if (o === '-startdate') teile.push(`notBefore=${gmt(z.nb)}`);
    else if (o === '-enddate') teile.push(`notAfter=${gmt(z.na)}`);
    else if (o === '-serial') teile.push(`serial=${z.serial.toUpperCase()}`);
    else if (o === '-modulus') teile.push(`Modulus=${modulus(z.key)}`);
    else if (o === '-fingerprint') teile.push(`${r.includes('-sha256') ? 'sha256' : 'SHA1'} Fingerprint=${doppel(sha256('fp' + z.serial).slice(0, r.includes('-sha256') ? 64 : 40).toUpperCase())}`);
    else if (o === '-text') teile.push(zertText(z));
    else if (o === '-ext') { const e = r[r.indexOf('-ext') + 1]; if (/subjectAltName/.test(e)) teile.push(z.san.length ? `X509v3 Subject Alternative Name: \n    ${z.san.join(', ')}` : 'No extensions in certificate'); }
    else if (o === '-checkend') { const s = Number(r[r.indexOf('-checkend') + 1] ?? 0); const abl = w.uhr + s * 1000 > z.na; return { out: abl ? 'Certificate will expire' : 'Certificate will not expire', code: abl ? 1 : 0 }; }
  }
  if (!r.includes('-noout')) teile.push(pem(z).trimEnd());
  if (out) { const e = schreiben(w, out, pem(z), root); if (e) return fehler(`x509: Can't open "${out}" for writing`); }
  return ok(teile.join('\n'));
}

function sClient(w: Welt, r: string[], root: boolean): Ergebnis {
  const ziel = optWert(r, '-connect') ?? 'localhost:4433';
  const m = ziel.match(/^\[?([^\]]+?)\]?:(\d+)$/); const host = m ? m[1] : ziel; const port = m ? Number(m[2]) : 443;
  const sni = optWert(r, '-servername') ?? (/^[\d.]+$/.test(host) ? null : host);
  const s = serverQuelle(w, host, port, r.includes('-noservername') ? null : sni);
  if (!s) return { out: '', err: `40F7A3C1B07F0000:error:8000006F:system library:BIO_connect:Connection refused:../crypto/bio/bio_sock2.c:114:calling connect()\n40F7A3C1B07F0000:error:10000067:BIO routines:BIO_connect:connect error:../crypto/bio/bio_sock2.c:116:\nconnect:errno=111`, code: 1 };
  if ('fehler' in s) return { out: 'CONNECTED(00000003)', err: s.fehler, code: 1 };
  const wunsch = ['-tls1_3', '-tls1_2', '-tls1_1', '-tls1'].find((x) => r.includes(x));
  const proto = wunsch ? { '-tls1_3': 'TLSv1.3', '-tls1_2': 'TLSv1.2', '-tls1_1': 'TLSv1.1', '-tls1': 'TLSv1' }[wunsch]! : ['TLSv1.3', 'TLSv1.2'].find((p) => s.protokolle.includes(p));
  if (!proto || !s.protokolle.includes(proto) || ['TLSv1', 'TLSv1.1'].includes(proto)) {
    if (proto && ['TLSv1', 'TLSv1.1'].includes(proto)) return { out: 'CONNECTED(00000003)', err: `40F7A3C1B07F0000:error:0A0000BF:SSL routines:tls_setup_handshake:no protocols available:../ssl/statem/statem_lib.c:104:`, code: 1 };
    return { out: `CONNECTED(00000003)\n---\nno peer certificate available\n---\nNo client certificate CA names sent\n---\nSSL handshake has read 7 bytes and written 241 bytes\nVerification: OK\n---\nNew, (NONE), Cipher is (NONE)\nSecure Renegotiation IS NOT supported\nNo ALPN negotiated\nEarly data was not sent\nVerify return code: 0 (ok)\n---`, err: `40F7A3C1B07F0000:error:0A00042E:SSL routines:ssl3_read_bytes:tlsv1 alert protocol version:../ssl/record/rec_layer_s3.c:1586:SSL alert number 70`, code: 1 };
  }
  const caF = optWert(r, '-CAfile'); let extra: string | undefined;
  if (caF) { const t = lesen(w, caF, root); if (!('fehler' in t)) extra = t.text; }
  const leaf = s.kette[0];
  const p = pruefen(w, leaf, s.kette.slice(1), vertrauteWurzeln(w, extra));
  const tiefe = p.ok ? p.kette.length - 1 : p.tiefe ?? 0;
  const zeilen: string[] = ['CONNECTED(00000003)'];
  for (let i = Math.min(tiefe, p.kette.length - 1); i >= 0; i--) {
    zeilen.push(`depth=${i} ${nameText(p.kette[i].subj)}`);
    if (!p.ok && i === p.tiefe) zeilen.push(`verify error:num=${p.nr}:${p.text}`);
    zeilen.push('verify return:1');
  }
  if (!p.ok && p.tiefe === 0 && p.nr === 20) { zeilen.push(`depth=0 ${nameText(leaf.subj)}`, 'verify error:num=21:unable to verify the first certificate', 'verify return:1'); }
  zeilen.push('---', 'Certificate chain');
  s.kette.forEach((z, i) => zeilen.push(` ${i} s:${nameText(z.subj)}`, `   i:${nameText(z.iss)}`, `   a:PKEY: rsaEncryption, ${z.bits} (bit); sigalg: RSA-SHA256`, `   v:NotBefore: ${gmt(z.nb).replace(' GMT', ' GMT')}; NotAfter: ${gmt(z.na)}`, ...(r.includes('-showcerts') ? [pem(z).trimEnd()] : [])));
  const code = p.ok ? '0 (ok)' : p.nr === 20 && p.tiefe === 0 ? '21 (unable to verify the first certificate)' : `${p.nr} (${p.text})`;
  zeilen.push('---', 'Server certificate', ...(r.includes('-showcerts') ? [] : [pem(leaf).trimEnd()]), `subject=${nameText(leaf.subj)}`, `issuer=${nameText(leaf.iss)}`, '---', 'No client certificate CA names sent',
    `Peer signing digest: SHA256`, `Peer signature type: RSA-PSS`, `Server Temp Key: X25519, 253 bits`, '---', `SSL handshake has read ${1400 + 1300 * s.kette.length} bytes and written 393 bytes`, `Verification${p.ok ? ': OK' : ' error: ' + (p.nr === 20 && p.tiefe === 0 ? 'unable to verify the first certificate' : p.text)}`, '---',
    `New, ${proto}, Cipher is ${proto === 'TLSv1.3' ? 'TLS_AES_256_GCM_SHA384' : 'ECDHE-RSA-AES256-GCM-SHA384'}`, `Server public key is ${leaf.bits} bit`, 'Secure Renegotiation IS NOT supported', 'Compression: NONE', 'Expansion: NONE', 'No ALPN negotiated', 'Early data was not sent', `Verify return code: ${code}`, '---',
    'SSL-Session:', `    Protocol  : ${proto}`, `    Cipher    : ${proto === 'TLSv1.3' ? 'TLS_AES_256_GCM_SHA384' : 'ECDHE-RSA-AES256-GCM-SHA384'}`, `    Verify return code: ${code}`, '---', 'DONE');
  return ok(zeilen.join('\n'));
}

// ---------- Vorbereitete Zertifikate ----------
/** Erzeugt eine erfundene öffentliche CA mit Zwischenzertifikat für den Vertrauensspeicher. */
export function oeffentlicheCa(): { wurzel: Zert; zwischen: Zert; wurzelKey: Schluessel; zwischenKey: Schluessel } {
  const wurzelKey: Schluessel = { art: 'key', id: 'a1b2c3d4e5f60718', bits: 4096, alg: 'RSA' };
  const zwischenKey: Schluessel = { art: 'key', id: '1829304a5b6c7d8e', bits: 2048, alg: 'RSA' };
  const wn = { C: 'US', O: 'Open Trust Lab', CN: 'Open Trust Root X1' };
  const zn = { C: 'US', O: 'Open Trust Lab', CN: 'OTL R3' };
  const t0 = Date.UTC(2020, 8, 4); const t1 = Date.UTC(2035, 5, 4);
  return {
    wurzel: { art: 'cert', subj: wn, iss: wn, san: [], serial: '8210CFB0D240E3594463E0BB63828B00', nb: t0, na: t1, key: wurzelKey.id, signer: wurzelKey.id, ca: true, bits: 4096 },
    zwischen: { art: 'cert', subj: zn, iss: wn, san: [], serial: '00912B084ACF0C18A753F6D62E25A75F5A', nb: Date.UTC(2024, 2, 13), na: Date.UTC(2027, 2, 12), key: zwischenKey.id, signer: wurzelKey.id, ca: true, bits: 2048 },
    wurzelKey, zwischenKey,
  };
}
export const neuerSchluessel = (w: Welt, bits = 2048): Schluessel => ({ art: 'key', id: zufall(w, 16), bits, alg: 'RSA' });
export function ausstellen(w: Welt, subj: Name, san: string[], key: Schluessel, ausst: Zert | null, ausstKey: Schluessel, tage: number, ab = w.uhr): Zert {
  return { art: 'cert', subj, iss: ausst ? ausst.subj : subj, san, serial: zufall(w, 40), nb: ab, na: ab + tage * 86400000, key: key.id, signer: ausstKey.id, ca: !ausst, bits: key.bits };
}
