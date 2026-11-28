// Webdienste (LPIC-2 Topic 208): Apache 2.4 auf Debian (apache2, /etc/apache2, a2ensite …) und Red Hat (httpd,
// /etc/httpd), virtuelle Hosts, Zugriff mit Require und .htaccess, Anmeldung mit htpasswd, Umleitungen, MPM-Grenzen,
// mod_status, PHP, HTTPS mit mod_ssl und SNI; Squid als Proxy mit ACLs, http_access und Anmeldung; Nginx als Webserver
// und Reverse Proxy vor lagerist-web auf srv1. curl spricht mit allen. Ohne Welt-Option `web` bleibt alles wie bisher.
import type { Welt } from './shell';
import { meta, sha256 } from './shell-dateien';
import { aufloesen, eigeneIps, ns, weg, HOSTS, netzExtraSockets, type Sock } from './shell-netz';
import { pem, zertifikate, schluesselIn, pruefen, namePasst, vertrauteWurzeln, nameText, gmt, tlsServerQuelle, oeffentlicheCa, ausstellen, neuerSchluessel, hashTeil, OPENSSL_VERSION, type Zert } from './shell-tls';

type Ergebnis = { out: string; err?: string; code: number };
type B = (w: Welt, a: string[], stdin: string, root: boolean) => Ergebnis;
const ok = (out = ''): Ergebnis => ({ out, code: 0 });
const fehler = (err: string, code = 1): Ergebnis => ({ out: '', err, code });

export interface WebOptionen {
  apache?: boolean;   // Apache installiert und gestartet (Debian apache2, Red Hat httpd)
  seiten?: boolean;   // Inhalte für www, intern und doku in /var/www, Namen in /etc/hosts
  intern?: boolean;   // virtueller Host intern.lab.example.org eingerichtet (Debian)
  php?: boolean;      // libapache2-mod-php8.2 installiert
  zert?: boolean;     // gekauftes Zertifikat für www.lab.example.org samt Zwischenzertifikat in ~/zert
  https?: boolean;    // www mit eigener CA über HTTPS (ssl, www-ssl.conf)
  squid?: boolean;    // Squid installiert und gestartet
  nginx?: boolean;    // Nginx installiert (Apache dann auf 127.0.0.1:8080)
  app?: boolean | 'eine'; // lagerist-web läuft auf srv1:8080 und :8081 (eine: nur 8080)
  boss?: boolean;     // Relaunch mit mehreren Fehlern
}
interface Dienst { installiert: boolean; laeuft: boolean; enabled: boolean; pid: number; start: number; fehlgeschlagen: boolean; journal: { ms: number; text: string }[] }
interface WebStand { opt: WebOptionen; apache: Dienst & { modell: AModell | null }; nginx: Dienst & { modell: NModell | null }; squid: Dienst & { modell: SModell | null; cache: Record<string, number> }; anfragen: number; rr: Record<string, number>; ca: { key: string } }
type WW = Welt & { web?: WebStand };
const st = (w: Welt) => (w as WW).web!;
export const webAktiv = (w: Welt) => !!(w as WW).web;

let K: { pfad: (w: Welt, p: string) => string; installieren: (w: Welt, namen: string[]) => void; dialog: (w: Welt, prompt: string, weiter: (z: string) => string) => void; schreiben: (w: Welt, p: string, t: string, anh: boolean, root: boolean) => string | null };
export function webKern(k: typeof K) { K = k; }

const rh = (w: Welt) => w.distro !== 'debian';
export const APACHE_VERSION = { debian: '2.4.65', rh: '2.4.62' };
const APV = (w: Welt) => (rh(w) ? APACHE_VERSION.rh : APACHE_VERSION.debian);
const AOS = (w: Welt) => (rh(w) ? 'AlmaLinux' : 'Debian');
export const NGINX_VERSION = '1.22.1';
export const SQUID_VERSION = '5.7';
const CURL_VERSION = '7.88.1';
const ORT = (w: Welt) => rh(w)
  ? { root: '/etc/httpd', conf: '/etc/httpd/conf/httpd.conf', bin: 'httpd', ctl: 'apachectl', user: 'apache', log: '/var/log/httpd', acc: 'access_log', err: 'error_log', dienst: 'httpd', mods: '/usr/lib64/httpd/modules' }
  : { root: '/etc/apache2', conf: '/etc/apache2/apache2.conf', bin: 'apache2', ctl: 'apache2ctl', user: 'www-data', log: '/var/log/apache2', acc: 'access.log', err: 'error.log', dienst: 'apache2', mods: '/usr/lib/apache2/modules' };

// ---------- Dateien ----------
function datei(w: Welt, p: string, c: string, mode = 0o644, owner = 'root', group = owner) {
  const teile = p.split('/').filter(Boolean);
  for (let i = 1; i < teile.length; i++) { const d = '/' + teile.slice(0, i).join('/'); if (!(d in w.fs)) { w.fs[d] = null; const m = meta(w, d); m.mode = 0o755; m.owner = 'root'; m.group = 'root'; } }
  w.fs[p] = c; const m = meta(w, p); m.mode = mode; m.owner = owner; m.group = group; m.mtime = w.uhr;
}
function ordner(w: Welt, p: string, mode = 0o755, owner = 'root', group = owner) {
  const teile = p.split('/').filter(Boolean);
  for (let i = 1; i <= teile.length; i++) { const d = '/' + teile.slice(0, i).join('/'); if (!(d in w.fs)) { w.fs[d] = null; const m = meta(w, d); m.mode = 0o755; m.owner = 'root'; m.group = 'root'; } }
  const m = meta(w, p); m.mode = mode; m.owner = owner; m.group = group;
}
const link = (w: Welt, p: string, ziel: string) => { w.fs[p] = '-> ' + ziel; const m = meta(w, p); m.mode = 0o777; m.owner = 'root'; m.group = 'root'; };
const istLink = (w: Welt, p: string) => typeof w.fs[p] === 'string' && (w.fs[p] as string).startsWith('-> ');
function linkZiel(w: Welt, p: string): string { const z = (w.fs[p] as string).slice(3); let r = z.startsWith('/') ? z : `${p.slice(0, p.lastIndexOf('/'))}/${z}`; while (/\/[^/]+\/\.\.\//.test(r)) r = r.replace(/\/[^/]+\/\.\.\//, '/'); return r.replace(/\/\.\//g, '/'); }
/** Löst symbolische Links in allen Teilen eines Pfads auf. */
function echt(w: Welt, p: string): string {
  let teile = p.split('/').filter(Boolean); let aus = '';
  for (let i = 0, n = 0; i < teile.length && n < 40; i++, n++) {
    const q = `${aus}/${teile[i]}`;
    if (istLink(w, q)) { const z = linkZiel(w, q); teile = [...z.split('/').filter(Boolean), ...teile.slice(i + 1)]; aus = ''; i = -1; continue; }
    aus = q;
  }
  return aus || '/';
}
const inhalt = (w: Welt, p0: string): string | null => { const p = echt(w, p0); let q = p; for (let i = 0; i < 5 && istLink(w, q); i++) q = linkZiel(w, q); const t = w.fs[q]; return typeof t === 'string' ? t : null; };
const ordnerInhalt = (w: Welt, d: string) => Object.keys(w.fs).filter((p) => p.startsWith(d + '/') && !p.slice(d.length + 1).includes('/')).sort();
function glob(w: Welt, muster0: string): string[] {
  const muster = muster0.includes('/') ? echt(w, muster0.slice(0, muster0.lastIndexOf('/'))) + muster0.slice(muster0.lastIndexOf('/')) : muster0;
  if (!/[*?[]/.test(muster)) return echt(w, muster) in w.fs ? [muster] : [];
  const re = new RegExp('^' + muster.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]') + '$');
  return Object.keys(w.fs).filter((p) => re.test(p) && (w.fs[p] !== null || istLink(w, p))).sort();
}
/** Darf der Dienstbenutzer (www-data, apache, proxy) die Datei lesen? */
function leserDarf(w: Welt, p: string, user: string): boolean {
  const teile = p.split('/').filter(Boolean);
  for (let i = 0; i <= teile.length; i++) {
    const q = '/' + teile.slice(0, i).join('/'); if (!(q in w.fs)) return false;
    const m = meta(w, q); const bit = i === teile.length ? 4 : 1;
    const gruppen = (w.fs['/etc/group'] ?? '').split('\n').filter((z) => z.split(':')[3]?.split(',').includes(user) || z.split(':')[0] === user).map((z) => z.split(':')[0]);
    const r = m.owner === user ? (m.mode >> 6) & bit : gruppen.includes(m.group) ? (m.mode >> 3) & bit : m.mode & bit;
    if (!r) return false;
  }
  return true;
}
const zeitStr = (w: Welt) => { const d = new Date(w.uhr + 3600000); const z = (x: number, n = 2) => String(x).padStart(n, '0'); return { d, z }; };
const TAGE = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']; const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const zeitClf = (w: Welt) => { const { d, z } = zeitStr(w); return `${z(d.getUTCDate())}/${MON[d.getUTCMonth()]}/${d.getUTCFullYear()}:${z(d.getUTCHours())}:${z(d.getUTCMinutes())}:${z(d.getUTCSeconds())} +0100`; };
const zeitApache = (w: Welt) => { const { d, z } = zeitStr(w); return `${TAGE[d.getUTCDay()]} ${MON[d.getUTCMonth()]} ${z(d.getUTCDate())} ${z(d.getUTCHours())}:${z(d.getUTCMinutes())}:${z(d.getUTCSeconds())}.${z((w.uhr % 1000) * 1000 + 441829 % 1000, 6)} ${d.getUTCFullYear()}`; };
const zeitNginx = (w: Welt) => { const { d, z } = zeitStr(w); return `${d.getUTCFullYear()}/${z(d.getUTCMonth() + 1)}/${z(d.getUTCDate())} ${z(d.getUTCHours())}:${z(d.getUTCMinutes())}:${z(d.getUTCSeconds())}`; };
const zeitSquid = (w: Welt) => { const { d, z } = zeitStr(w); return `${d.getUTCFullYear()}/${z(d.getUTCMonth() + 1)}/${z(d.getUTCDate())} ${z(d.getUTCHours())}:${z(d.getUTCMinutes())}:${z(d.getUTCSeconds())}|`; };
const httpDatum = (w: Welt) => { const d = new Date(w.uhr); const z = (x: number) => String(x).padStart(2, '0'); return `${TAGE[d.getUTCDay()]}, ${z(d.getUTCDate())} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()} ${z(d.getUTCHours())}:${z(d.getUTCMinutes())}:${z(d.getUTCSeconds())} GMT`; };
function anhaengen(w: Welt, p: string, zeile: string, owner = 'root', group = 'adm') { if (!(p.slice(0, p.lastIndexOf('/')) in w.fs)) return; if (!(p in w.fs)) datei(w, p, '', 0o640, owner, group); w.fs[p] = (w.fs[p] ?? '') + zeile + '\n'; }

// ---------- htpasswd-Dateien ----------
export function htHash(w: Welt, pw: string, art: 'apr1' | 'bcrypt' | 'sha' | 'crypt'): string {
  const salz = sha256(`${w.uhr}:${pw}:${Math.random()}`).slice(0, 8).replace(/[^a-zA-Z0-9]/g, 'x');
  if (art === 'bcrypt') return `$2y$05$${hashTeil(salz, pw, 22)}${hashTeil(salz + 'b', pw, 31)}`.replace('$2y$05$', `$2y$05$`) + `#${salz}`.slice(0, 0) + '';
  if (art === 'sha') return `{SHA}${btoa(sha256(pw).slice(0, 20))}`;
  return `$apr1$${salz}$${hashTeil(salz, pw, 22)}`;
}
/** Prüft ein Passwort gegen einen Eintrag aus htpasswd, openssl passwd oder dem Simulator. */
export function htPruefen(hash: string, pw: string): boolean {
  let m;
  if ((m = hash.match(/^\$(apr1|1)\$([^$]+)\$(.+)$/))) return hashTeil(m[2], pw, 22) === m[3];
  if ((m = hash.match(/^\$(5|6)\$([^$]{8})[^$]*\$(.+)$/))) return hashTeil(m[2], pw, m[1] === '6' ? 86 : 43) === m[3];
  if (hash.startsWith('{SHA}')) return hash === `{SHA}${btoa(sha256(pw).slice(0, 20))}`;
  if ((m = hash.match(/^\$2y\$05\$(.{22})(.{31})$/))) return false;
  return false;
}
const htLesen = (t: string | null) => (t ?? '').split('\n').filter((z) => z.includes(':')).map((z) => ({ user: z.slice(0, z.indexOf(':')), hash: z.slice(z.indexOf(':') + 1).trim() }));

// =====================================================================================================
// Apache: Konfiguration lesen
// =====================================================================================================
interface Dir { n: string; name: string; args: string[]; datei: string; zeile: number; kinder?: Dir[] }
interface Sektion { art: string; arg: string; regex: boolean; d: Dir[]; datei: string; zeile: number }
interface VHost { adr: string[]; d: Dir[]; sek: Sektion[]; datei: string; zeile: number }
interface AModell { global: Dir[]; sek: Sektion[]; vhosts: VHost[]; module: string[]; listen: { ip: string; port: number }[]; warnungen: string[]; mpm: string }

// Direktiven und das Modul, das sie bereitstellt
const DIREKTIVEN: Record<string, string> = {};
const reg = (mod: string, namen: string) => { for (const n of namen.split(' ')) DIREKTIVEN[n.toLowerCase()] = mod; };
reg('core', 'ServerName ServerAlias ServerAdmin DocumentRoot ErrorLog LogLevel Include IncludeOptional Listen User Group PidFile Timeout KeepAlive MaxKeepAliveRequests KeepAliveTimeout HostnameLookups AccessFileName AllowOverride AllowOverrideList Options ServerTokens ServerSignature TraceEnable ErrorDocument AddDefaultCharset EnableSendfile EnableMMAP DefaultRuntimeDir Mutex ServerRoot LoadModule Define UnDefine LimitRequestBody SetHandler ForceType UseCanonicalName ExtendedStatus LogFormat CustomLog TransferLog AuthType AuthName ScriptAlias FileETag ContentDigest LimitRequestFields MaxRanges AcceptPathInfo SetOutputFilter AddOutputFilter');
reg('mpm', 'StartServers MaxRequestWorkers ServerLimit MaxConnectionsPerChild MaxRequestsPerChild ListenBacklog');
reg('mpm_prefork', 'MinSpareServers MaxSpareServers MaxClients');
reg('mpm_event', 'MinSpareThreads MaxSpareThreads ThreadsPerChild ThreadLimit AsyncRequestWorkerFactor');
reg('authz_core', 'Require AuthMerging AuthzSendForbiddenOnFailure');
reg('authz_groupfile', 'AuthGroupFile'); reg('authn_file', 'AuthUserFile'); reg('auth_basic', 'AuthBasicProvider AuthBasicAuthoritative');
reg('access_compat', 'Order Allow Deny Satisfy');
reg('alias', 'Alias AliasMatch Redirect RedirectMatch RedirectPermanent RedirectTemp ScriptAliasMatch');
reg('dir', 'DirectoryIndex DirectorySlash FallbackResource');
reg('mime', 'AddType AddHandler TypesConfig AddCharset AddLanguage AddEncoding RemoveHandler RemoveType');
reg('autoindex', 'IndexOptions IndexIgnore HeaderName ReadmeName AddIcon AddIconByType AddIconByEncoding DefaultIcon AddDescription IndexOrderDefault');
reg('ssl', 'SSLEngine SSLCertificateFile SSLCertificateKeyFile SSLCertificateChainFile SSLCACertificateFile SSLCACertificatePath SSLProtocol SSLCipherSuite SSLHonorCipherOrder SSLRandomSeed SSLPassPhraseDialog SSLSessionCache SSLSessionCacheTimeout SSLSessionTickets SSLOptions SSLVerifyClient SSLVerifyDepth SSLStrictSNIVHostCheck SSLCompression SSLUseStapling SSLProxyEngine SSLProxyCipherSuite SSLProxyProtocol SSLCryptoDevice');
reg('headers', 'Header RequestHeader'); reg('rewrite', 'RewriteEngine RewriteRule RewriteCond RewriteBase RewriteOptions');
reg('proxy', 'ProxyPass ProxyPassReverse ProxyPreserveHost ProxyRequests ProxyStatus ProxyTimeout');
reg('setenvif', 'BrowserMatch BrowserMatchNoCase SetEnvIf SetEnvIfNoCase'); reg('reqtimeout', 'RequestReadTimeout');
reg('filter', 'AddOutputFilterByType FilterDeclare FilterProvider FilterChain'); reg('negotiation', 'LanguagePriority ForceLanguagePriority CacheNegotiatedDocs');
reg('env', 'SetEnv PassEnv UnsetEnv'); reg('php', 'php_value php_flag php_admin_value php_admin_flag'); reg('perl', 'PerlModule PerlResponseHandler PerlRequire PerlOptions PerlSwitches');
reg('userdir', 'UserDir'); reg('unixd', ''); reg('systemd', ''); reg('expires', 'ExpiresActive ExpiresDefault ExpiresByType'); reg('status', '');
const SEKTIONEN = ['directory', 'directorymatch', 'location', 'locationmatch', 'files', 'filesmatch'];
const MPMS = ['mpm_event', 'mpm_prefork', 'mpm_worker'];
// .htaccess: welche AllowOverride-Klasse eine Direktive braucht
const KLASSE: Record<string, string> = {};
for (const n of 'authtype authname authuserfile authgroupfile require authbasicprovider satisfy'.split(' ')) KLASSE[n] = 'authconfig';
for (const n of 'order allow deny'.split(' ')) KLASSE[n] = 'limit';
for (const n of 'redirect redirectmatch redirectpermanent redirecttemp errordocument rewriteengine rewriterule rewritecond rewritebase addtype addhandler sethandler forcetype header requestheader setenvif defaultcharset adddefaultcharset fallbackresource php_value php_flag expiresactive expiresdefault'.split(' ')) KLASSE[n] = 'fileinfo';
for (const n of 'directoryindex indexoptions indexignore headername readmename adddescription addicon defaulticon'.split(' ')) KLASSE[n] = 'indexes';
KLASSE.options = 'options';

const modName = (s: string) => s.replace(/^!/, '').replace(/^mod_(.+)\.c$/, '$1').replace(/_module$/, '');
function envVars(w: Welt): Record<string, string> {
  if (rh(w)) return {};
  const t = w.fs['/etc/apache2/envvars'] ?? '';
  const v: Record<string, string> = {};
  for (const z of t.split('\n')) { const m = z.match(/^\s*export\s+(\w+)=(.*)$/); if (m) v[m[1]] = m[2].replace(/^["']|["']$/g, '').replace(/\$SUFFIX/g, '').replace(/\$\{(\w+)\}|\$(\w+)/g, (_, a, b) => v[a ?? b] ?? ''); }
  return v;
}

type ParseFehler = { text: string };
function apacheLesen(w: Welt, opt: { envvars: boolean; datei?: string; defines?: string[] }): { modell: AModell } | ParseFehler {
  const o = ORT(w); const vars: Record<string, string> = opt.envvars ? envVars(w) : {};
  const defines = new Set(opt.defines ?? []);
  const m: AModell = { global: [], sek: [], vhosts: [], module: [], listen: [], warnungen: [], mpm: '' };
  let serverRoot = o.root;
  const absolut = (p: string) => (p.startsWith('/') ? p : `${serverRoot}/${p}`);
  const prog = o.bin;
  // Ein Fehler in einer eingebundenen Datei: Kette der Include-Zeilen voranstellen (wie apache2 -t)
  class Fehler extends Error { constructor(public text: string, public kette = false) { super(text); } }
  const syntax = (d: string, z: number, text: string) => new Fehler(`AH00526: Syntax error on line ${z} of ${d}:\n${text}`);
  function lesen(pfad: string, ziel: { d: Dir[]; sek: Sektion[] | null; vh: VHost | null; in: string | null }, tiefe: number) {
    const text = inhalt(w, pfad);
    if (text === null) throw new Fehler(`${prog}: Could not open configuration file ${pfad}: No such file or directory`, true);
    const roh = text.split('\n');
    const zeilen: { z: number; t: string }[] = [];
    for (let i = 0; i < roh.length; i++) { let t = roh[i]; const z = i + 1; while (t.endsWith('\\') && i + 1 < roh.length) { t = t.slice(0, -1) + roh[++i]; } zeilen.push({ z, t: t.trim() }); }
    const stapel: { art: string; z: number; d: Dir[]; sek: Sektion | null; vh: VHost | null; gruppe?: Dir }[] = [];
    const aktiv = () => stapel[stapel.length - 1];
    for (let i = 0; i < zeilen.length; i++) {
      const { z, t: t0 } = zeilen[i];
      if (!t0 || t0.startsWith('#')) continue;
      const t = t0.replace(/\$\{(\w+)\}/g, (all, n) => { if (n in vars) return vars[n]; if (!m.warnungen.some((x) => x.includes(`\${${n}}`))) m.warnungen.push(`[core:warn] [pid 4711] AH00111: Config variable \${${n}} is not defined`); return all; });
      const toks = woerter(t);
      const kopf = toks[0];
      if (kopf.startsWith('</')) {
        const art = kopf.slice(2).replace(/>$/, '').toLowerCase();
        const a = aktiv();
        if (!a) throw syntax(pfad, z, `</${kopf.slice(2).replace(/>$/, '')}> without matching <${kopf.slice(2).replace(/>$/, '')}> section`);
        if (a.art !== art) throw syntax(pfad, z, `Expected </${a.art === 'virtualhost' ? 'VirtualHost' : cap(a.art)}> but saw </${kopf.slice(2).replace(/>$/, '')}>`);
        stapel.pop(); continue;
      }
      if (kopf.startsWith('<')) {
        if (!t.endsWith('>')) throw syntax(pfad, z, `${kopf}> directive missing closing '>'`);
        const art = kopf.slice(1).replace(/>$/, '').toLowerCase(); const arg = t.slice(kopf.length, -1).trim().replace(/^"|"$/g, '');
        if (art === 'ifmodule' || art === 'ifdefine') {
          const neg = arg.startsWith('!'); const wahr = art === 'ifmodule' ? m.module.includes(modName(arg)) : defines.has(arg.replace(/^!/, ''));
          if (wahr === neg) { // überspringen bis zum passenden Ende
            let tief = 1; let j = i + 1;
            for (; j < zeilen.length; j++) { const k = zeilen[j].t.toLowerCase(); if (k.startsWith(`<${art}`)) tief++; else if (k.startsWith(`</${art}`)) { tief--; if (!tief) break; } }
            if (j >= zeilen.length) throw syntax(pfad, z, `${pfad}:${z}: <${cap(art)}> was not closed.`);
            i = j; continue;
          }
          stapel.push({ art, z, d: aktiv()?.d ?? ziel.d, sek: aktiv()?.sek ?? null, vh: aktiv()?.vh ?? ziel.vh }); continue;
        }
        if (art === 'virtualhost') {
          if (aktiv()?.vh || ziel.vh) throw syntax(pfad, z, '<VirtualHost> cannot occur within <VirtualHost> section');
          if (!arg) throw syntax(pfad, z, '<VirtualHost> directive requires additional arguments');
          const vh: VHost = { adr: arg.split(/\s+/), d: [], sek: [], datei: pfad, zeile: z };
          m.vhosts.push(vh); stapel.push({ art, z, d: vh.d, sek: null, vh }); continue;
        }
        if (SEKTIONEN.includes(art)) {
          if (aktiv()?.sek && !['files', 'filesmatch'].includes(art)) throw syntax(pfad, z, `<${cap(art)}> cannot occur within <${cap(aktiv()!.sek!.art)}> section`);
          if (!arg) throw syntax(pfad, z, `<${cap(art)}> directive requires additional arguments`);
          const s: Sektion = { art: art.replace(/match$/, ''), arg: arg.replace(/^~\s*/, ''), regex: art.endsWith('match') || arg.startsWith('~'), d: [], datei: pfad, zeile: z };
          const vh = aktiv()?.vh ?? ziel.vh; (vh ? vh.sek : m.sek).push(s);
          stapel.push({ art, z, d: s.d, sek: s, vh }); continue;
        }
        if (['requireall', 'requireany', 'requirenone'].includes(art)) {
          if (!m.module.includes('authz_core')) throw syntax(pfad, z, `Invalid command '<${kopf.slice(1).replace(/>$/, '')}', perhaps misspelled or defined by a module not included in the server configuration`);
          const g: Dir = { n: art, name: kopf.slice(1), args: [], datei: pfad, zeile: z, kinder: [] };
          (aktiv()?.gruppe?.kinder ?? aktiv()?.d ?? ziel.d).push(g); stapel.push({ art, z, d: g.kinder!, sek: aktiv()?.sek ?? null, vh: aktiv()?.vh ?? ziel.vh, gruppe: g }); continue;
        }
        if (['limit', 'limitexcept', 'if', 'elseif', 'else'].includes(art)) { stapel.push({ art, z, d: aktiv()?.d ?? ziel.d, sek: aktiv()?.sek ?? null, vh: aktiv()?.vh ?? ziel.vh }); continue; }
        throw syntax(pfad, z, `Invalid command '${kopf.replace(/>$/, '')}', perhaps misspelled or defined by a module not included in the server configuration`);
      }
      const n = kopf.toLowerCase(); const args = toks.slice(1);
      const ctx = aktiv(); const dListe = ctx?.gruppe?.kinder ?? ctx?.d ?? ziel.d;
      const vh = ctx?.vh ?? ziel.vh; const sek = ctx?.sek ?? null;
      // Laden und Einbinden wirken sofort
      if (n === 'loadmodule') {
        const f = absolut(args[1] ?? '');
        if (!(echt(w, f) in w.fs)) throw syntax(pfad, z, `Cannot load ${f} into server: ${f}: cannot open shared object file: No such file or directory`);
        const mod = args[0].replace(/_module$/, '');
        if (MPMS.includes('mpm_' + mod.replace(/^mpm_/, '')) && mod.startsWith('mpm_')) { if (m.mpm && m.mpm !== mod) throw new Fehler(`AH00534: ${prog}: Configuration error: More than one MPM loaded.`, true); m.mpm = mod; }
        if (!m.module.includes(mod)) m.module.push(mod);
        continue;
      }
      if (n === 'include' || n === 'includeoptional') {
        const muster = absolut(args[0] ?? '');
        const treffer = glob(w, muster);
        if (!treffer.length && n === 'include') {
          if (/[*?]/.test(muster)) throw syntax(pfad, z, `No matches for the wildcard '${muster.split('/').pop()}' in '${muster.slice(0, muster.lastIndexOf('/'))}', failing`);
          throw syntax(pfad, z, `Could not open configuration file ${muster}: No such file or directory`);
        }
        for (const f of treffer) {
          try { lesen(f, { d: dListe, sek: null, vh, in: pfad }, tiefe + 1); }
          catch (e) { if (e instanceof Fehler && e.kette) throw new Fehler(`Syntax error on line ${z} of ${pfad}: ${e.text}`, true); throw e; }
        }
        continue;
      }
      if (n === 'serverroot') { serverRoot = (args[0] ?? '').replace(/^"|"$/g, ''); continue; }
      if (n === 'define') { defines.add(args[0]); if (args[1] !== undefined) vars[args[0]] = args[1]; continue; }
      const mod = DIREKTIVEN[n];
      const geladen = mod === 'core' || (mod === 'mpm' ? !!m.mpm : mod?.startsWith('mpm_') ? m.mpm === mod : mod ? m.module.includes(mod) : false);
      if (!mod || !geladen) throw syntax(pfad, z, `Invalid command '${kopf}', perhaps misspelled or defined by a module not included in the server configuration`);
      if (n === 'defaultruntimedir' && !/^\//.test(args[0] ?? '') ) throw new Fehler(`${prog}: Syntax error on line ${z} of ${pfad}: DefaultRuntimeDir must be a valid directory, absolute or relative to ServerRoot`, true);
      if ((n === 'sslcertificatefile' || n === 'sslcertificatekeyfile' || n === 'sslcertificatechainfile' || n === 'sslcacertificatefile') && !(inhalt(w, absolut(args[0] ?? ''))?.length)) throw syntax(pfad, z, `${kopf}: file '${absolut(args[0] ?? '')}' does not exist or is empty`);
      if (n === 'sslprotocol') for (const p of args) if (!/^[+-]?(all|SSLv3|TLSv1|TLSv1\.1|TLSv1\.2|TLSv1\.3)$/i.test(p)) throw syntax(pfad, z, `SSLProtocol: Illegal protocol '${p.replace(/^[+-]/, '')}'`);
      if (n === 'sslengine' && !/^(on|off|optional|addr:port)$/i.test(args[0] ?? '')) throw syntax(pfad, z, 'Argument must be On, Off, or Optional');
      if (n === 'traceenable' && !/^(on|off|extended)$/i.test(args[0] ?? '')) throw syntax(pfad, z, "TraceEnable must be one of 'on', 'off', or 'extended'");
      if (n === 'servertokens' && !/^(major|minor|min|minimal|prod|productonly|os|full)$/i.test(args[0] ?? '')) throw syntax(pfad, z, `ServerTokens takes 1 argument, Tweak the 'Server' HTTP response header field value (Major, Minor, Minimal, Product/ProductOnly, OS, Full)`);
      if (n === 'require' && !args.length) throw syntax(pfad, z, 'Require takes at least one argument, specifies authorization directives which must be satisfied');
      if (n === 'require') { const prov = (args[0] === 'not' ? args[1] : args[0]) ?? ''; const brauch: Record<string, string> = { ip: 'authz_host', host: 'authz_host', local: 'authz_host', user: 'authz_user', 'valid-user': 'authz_user', group: 'authz_groupfile' }; if (brauch[prov] && !m.module.includes(brauch[prov])) throw syntax(pfad, z, `Unknown Authz provider: ${prov}`); if (!['all', 'ip', 'host', 'local', 'user', 'valid-user', 'group', 'env', 'method', 'expr', 'not'].includes(args[0])) throw syntax(pfad, z, `Unknown Authz provider: ${args[0]}`); }
      if (n === 'listen') {
        if (vh || sek) throw syntax(pfad, z, `Listen cannot occur within <${vh ? "VirtualHost" : cap(sek!.art)}> section`);
        const a = args[0] ?? ''; const mm = a.match(/^(?:\[?([\d.:a-f]+?)\]?:)?(\d+)$/i); if (!mm) throw syntax(pfad, z, `Invalid address or port`);
        const neu = { ip: mm[1] ?? '*', port: Number(mm[2]) };
        if (m.listen.some((x) => x.port === neu.port && (x.ip === neu.ip || x.ip === '*' || neu.ip === '*'))) { m.warnungen.push(`(98)Address already in use: AH00072: make_sock: could not bind to address ${neu.ip === '*' ? '[::]' : neu.ip}:${neu.port}`); }
        else m.listen.push(neu);
        continue;
      }
      if (['servername', 'serveralias', 'documentroot'].includes(n) && sek) throw syntax(pfad, z, `${kopf} not allowed here`);
      dListe.push({ n, name: kopf, args, datei: pfad, zeile: z });
    }
    if (stapel.length) { const a = stapel[stapel.length - 1]; throw new Fehler(`Syntax error on line ${a.z} of ${pfad}: ${pfad}:${a.z}: <${a.art === 'virtualhost' ? 'VirtualHost' : a.art === 'ifmodule' ? 'IfModule' : cap(a.art)}> was not closed.`, true); }
  }
  try {
    const start = opt.datei ?? o.conf;
    lesen(start, { d: m.global, sek: null, vh: null, in: null }, 0);
  } catch (e) {
    if (e instanceof Fehler) return { text: e.kette && !e.text.startsWith(prog + ':') ? `${prog}: ${e.text}` : e.text };
    throw e;
  }
  if (!m.mpm) return { text: `AH00534: ${prog}: Configuration error: No MPM loaded.` };
  if (!m.listen.length) return { text: `no listening sockets available, shutting down\nAH00015: Unable to open logs` };
  // Hinweise wie beim Start
  const dr = [...m.global, ...m.vhosts.flatMap((v) => v.d)].filter((d) => d.n === 'documentroot').map((d) => d.args[0]?.replace(/^"|"$/g, ''));
  for (const d of dr) if (d && w.fs[d] !== null) m.warnungen.push(`AH00112: Warning: DocumentRoot [${d}] does not exist`);
  if (!m.global.some((d) => d.n === 'servername')) m.warnungen.push(`AH00558: ${prog}: Could not reliably determine the server's fully qualified domain name, using ${rh(w) ? 'fe80::5054:ff:fe12:3456%enp1s0' : '127.0.1.1'}. Set the 'ServerName' directive globally to suppress this message`);
  return { modell: m };
}
const cap = (s: string) => ({ directory: 'Directory', location: 'Location', files: 'Files', ifmodule: 'IfModule', ifdefine: 'IfDefine', virtualhost: 'VirtualHost', requireall: 'RequireAll', requireany: 'RequireAny', limit: 'Limit' } as Record<string, string>)[s] ?? s.charAt(0).toUpperCase() + s.slice(1);
function woerter(t: string): string[] {
  const out: string[] = []; let cur = ''; let q = ''; let hat = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '\\' && (t[i + 1] === q || t[i + 1] === '\\')) { cur += t[++i]; continue; } if (c === q) { q = ''; } else cur += c; continue; }
    if (c === '"' || c === "'") { q = c; hat = true; continue; }
    if (/\s/.test(c)) { if (cur || hat) out.push(cur); cur = ''; hat = false; continue; }
    if (c === '#' && !cur && out.length) break;
    cur += c;
  }
  if (cur || hat) out.push(cur);
  return out;
}

// ---------- Werte aus dem Modell ----------
const letzte = (ds: Dir[], n: string) => [...ds].reverse().find((d) => d.n === n);
function wert(m: AModell, n: string, vh?: VHost | null): string[] | undefined { return (vh && letzte(vh.d, n))?.args ?? letzte(m.global, n)?.args; }
function mpmWerte(m: AModell) {
  const zahl = (n: string, std: number) => Number(wert(m, n)?.[0] ?? std);
  if (m.mpm === 'mpm_prefork') { const sl = zahl('serverlimit', 256); let mrw = zahl('maxrequestworkers', zahl('maxclients', 256)); const warn: string[] = []; if (mrw > sl) { warn.push(`AH00180: WARNING: MaxRequestWorkers of ${mrw} exceeds ServerLimit value of ${sl} servers, decreasing MaxRequestWorkers to ${sl}. To increase, please see the ServerLimit directive.`); mrw = sl; } return { start: zahl('startservers', 5), minSpare: zahl('minspareservers', 5), maxSpare: zahl('maxspareservers', 10), mrw, threads: 1, warn, mcpc: zahl('maxconnectionsperchild', zahl('maxrequestsperchild', 0)) }; }
  const tpc = zahl('threadsperchild', 25); let mrw = zahl('maxrequestworkers', 400); const warn: string[] = [];
  if (mrw % tpc) { const neu = Math.floor(mrw / tpc) * tpc; warn.push(`AH00513: WARNING: MaxRequestWorkers of ${mrw} is not an integer multiple of ThreadsPerChild of ${tpc}, decreasing to nearest multiple ${neu}, for a maximum of ${neu / tpc} servers.`); mrw = neu; }
  return { start: zahl('startservers', 3), minSpare: zahl('minsparethreads', 75), maxSpare: zahl('maxsparethreads', 250), mrw, threads: tpc, warn, mcpc: zahl('maxconnectionsperchild', 0) };
}
function serverHeader(w: Welt, m: AModell): string {
  const t = (wert(m, 'servertokens')?.[0] ?? 'Full').toLowerCase(); const v = APV(w);
  if (t.startsWith('prod')) return 'Apache';
  if (t === 'major') return `Apache/${v.split('.')[0]}`;
  if (t === 'minor') return `Apache/${v.split('.').slice(0, 2).join('.')}`;
  if (t.startsWith('min')) return `Apache/${v}`;
  if (t === 'os') return `Apache/${v} (${AOS(w)})`;
  return `Apache/${v} (${AOS(w)})${m.module.includes('ssl') ? ` OpenSSL/${OPENSSL_VERSION.split(' ')[1]}` : ''}${m.module.includes('php') ? '' : ''}`;
}

// =====================================================================================================
// HTTP: Anfragen und Antworten
// =====================================================================================================
export interface Anfrage { methode: string; host: string; pfad: string; port: number; tls: boolean; sni: string | null; client: string; ziel: string; kopf: Record<string, string>; auth?: { user: string; pw: string } }
export interface Antwort { status: number; kopf: [string, string][]; body: string }
const TEXTE: Record<number, string> = { 200: 'OK', 301: 'Moved Permanently', 302: 'Found', 303: 'See Other', 304: 'Not Modified', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 407: 'Proxy Authentication Required', 410: 'Gone', 421: 'Misdirected Request', 500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout' };
const ERKL: Record<number, string> = {
  400: 'Your browser sent a request that this server could not understand.<br />\n', 401: 'This server could not verify that you\nare authorized to access the document\nrequested.  Either you supplied the wrong\ncredentials (e.g., bad password), or your\nbrowser doesn\'t understand how to supply\nthe credentials required.</p>\n',
  403: 'You don\'t have permission to access this resource.</p>\n', 404: 'The requested URL was not found on this server.</p>\n', 405: 'The requested method TRACE is not allowed for this URL.</p>\n',
  410: 'The requested resource is no longer available on this server and there is no forwarding address.\nPlease remove all references to this resource.</p>\n', 421: 'The client needs a new connection for this\nrequest as the requested host name does not match\nthe Server Name Indication (SNI) in use for this\nconnection.</p>\n',
  500: 'The server encountered an internal error or\nmisconfiguration and was unable to complete\nyour request.</p>\n<p>Please contact the server administrator at \n webmaster@localhost to inform them of the time this error occurred,\n and the actions you performed just before this error.</p>\n<p>More information about this error may be available\nin the server error log.</p>\n', 503: 'The server is temporarily unable to service your\nrequest due to maintenance downtime or capacity\nproblems. Please try again later.</p>\n',
};
function apacheFehlerseite(status: number, sig: string): string {
  const t = TEXTE[status];
  return `<!DOCTYPE HTML PUBLIC "-//IETF//DTD HTML 2.0//EN">\n<html><head>\n<title>${status} ${t}</title>\n</head><body>\n<h1>${t}</h1>\n<p>${ERKL[status] ?? '</p>\n'}${sig ? '<hr>\n' + sig + '\n' : ''}</body></html>\n`;
}
const MIME: Record<string, string> = { html: 'text/html', htm: 'text/html', txt: 'text/plain', css: 'text/css', js: 'text/javascript', json: 'application/json', png: 'image/png', jpg: 'image/jpeg', svg: 'image/svg+xml', pdf: 'application/pdf', php: 'application/x-httpd-php', crt: 'application/x-x509-ca-cert' };
const mimeVon = (p: string) => MIME[p.split('.').pop()!.toLowerCase()] ?? 'text/plain';

// ---------- Apache: eine Anfrage beantworten ----------
function apacheErrorLog(w: Welt, m: AModell, vh: VHost | null, modul: string, client: string | null, text: string) {
  const o = ORT(w); const f = (vh && wert({ ...m, global: [] }, 'errorlog', vh)?.[0]) ?? wert(m, 'errorlog')?.[0] ?? `${o.log}/${o.err}`;
  const p = f.startsWith('/') ? f : `${o.root}/${f}`.replace('/etc/httpd/logs', '/var/log/httpd');
  anhaengen(w, p, `[${zeitApache(w)}] [${modul}] [pid ${st(w).apache.pid + 2}:tid 140023752251072] ${client ? `[client ${client}:4${String(29000 + st(w).anfragen).slice(-4)}] ` : ''}${text}`);
}
function logFormat(fmt: string, w: Welt, a: Anfrage, r: Antwort, user: string, vhName: string): string {
  const len = r.body.length;
  return fmt.replace(/%\{([^}]+)\}i/g, (_, h) => (a.kopf[h.toLowerCase()] ?? '-')).replace(/%>s|%s/g, String(r.status)).replace(/%h/g, a.client).replace(/%l/g, '-').replace(/%u/g, user || '-')
    .replace(/%t/g, `[${zeitClf(w)}]`).replace(/%r/g, `${a.methode} ${a.pfad} HTTP/1.1`).replace(/%O/g, String(len + 180 + r.kopf.length * 12)).replace(/%b/g, len ? String(len) : '-').replace(/%B/g, String(len))
    .replace(/%v/g, vhName).replace(/%p/g, String(a.port)).replace(/%U/g, a.pfad.split('?')[0]).replace(/%D/g, '412').replace(/%%/g, '%');
}
function apacheAccessLog(w: Welt, m: AModell, vh: VHost | null, a: Anfrage, r: Antwort, user: string) {
  const o = ORT(w); const formate: Record<string, string> = {};
  for (const d of m.global.filter((x) => x.n === 'logformat')) formate[d.args[1] ?? 'default'] = d.args[0];
  const ziele = (vh && vh.d.some((d) => d.n === 'customlog')) ? vh.d.filter((d) => d.n === 'customlog') : m.global.filter((d) => d.n === 'customlog');
  const vhName = (vh && letzte(vh.d, 'servername')?.args[0]) ?? letzte(m.global, 'servername')?.args[0] ?? (rh(w) ? 'labor-alma' : '127.0.1.1');
  for (const d of ziele) {
    const f = d.args[0]; const p = f.startsWith('/') ? f : `${o.root}/${f}`.replace('/etc/httpd/logs', '/var/log/httpd');
    const fmt = formate[d.args[1]] ?? d.args[1] ?? formate.common ?? '%h %l %u %t "%r" %>s %b';
    anhaengen(w, p, logFormat(fmt, w, a, r, user, vhName));
  }
}
function vhostWaehlen(w: Welt, m: AModell, a: Anfrage): VHost | null {
  const passt = (vh: VHost) => vh.adr.some((x) => { const mm = x.match(/^(?:\[?([^\]]*?)\]?)(?::(\d+|\*))?$/); if (!mm) return false; const ip = mm[1]; const port = mm[2]; const portOk = !port || port === '*' || Number(port) === a.port; const ipOk = ip === '*' || ip === '_default_' || ip === a.ziel || (ip === 'localhost' && a.ziel.startsWith('127.')); return portOk && ipOk; });
  const kand = m.vhosts.filter(passt);
  if (!kand.length) return null;
  const genau = kand.filter((v) => v.adr.some((x) => x.split(':')[0] === a.ziel));
  const liste = genau.length ? genau : kand;
  const h = a.host.toLowerCase().replace(/:\d+$/, '');
  const namen = (v: VHost) => [...v.d.filter((d) => d.n === 'servername').map((d) => d.args[0].replace(/^https?:\/\//, '').replace(/:\d+$/, '')), ...v.d.filter((d) => d.n === 'serveralias').flatMap((d) => d.args)].map((x) => x.toLowerCase());
  const wild = (mu: string) => new RegExp('^' + mu.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
  return liste.find((v) => namen(v).some((n) => n === h || wild(n).test(h))) ?? liste[0];
}
interface DirKonf { d: Dir[]; quelle: string }
function sektionenFuer(m: AModell, vh: VHost | null, art: string, wert2: string): Sektion[] {
  const alle = [...m.sek, ...(vh?.sek ?? [])].filter((s) => s.art === art);
  if (art === 'directory') {
    const passt = (s: Sektion) => (s.regex ? new RegExp(s.arg).test(wert2) : (wert2 + '/').startsWith(s.arg.replace(/\/?$/, '/')) || wert2 === s.arg.replace(/\/$/, ''));
    const nicht = alle.filter((s) => !s.regex && passt(s)).sort((x, y) => x.arg.replace(/\/$/, '').split('/').length - y.arg.replace(/\/$/, '').split('/').length);
    return [...nicht, ...alle.filter((s) => s.regex && passt(s))];
  }
  if (art === 'files') { const base = wert2.split('/').pop()!; return alle.filter((s) => (s.regex ? new RegExp(s.arg).test(base) : new RegExp('^' + s.arg.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.') + '$').test(base))); }
  return alle.filter((s) => (s.regex ? new RegExp(s.arg).test(wert2) : wert2 === s.arg || wert2.startsWith(s.arg.replace(/\/?$/, '/')) || wert2.startsWith(s.arg)));
}
function htaccessLesen(w: Welt, m: AModell, datei: string, erlaubt: string[]): { d: Dir[] } | { fehler: string } {
  const text = inhalt(w, datei) ?? ''; const d: Dir[] = []; const stapel: Dir[] = [];
  const zeilen = text.split('\n');
  for (let i = 0; i < zeilen.length; i++) {
    const t = zeilen[i].trim(); if (!t || t.startsWith('#')) continue;
    const toks = woerter(t); const kopf = toks[0]; const n = kopf.toLowerCase();
    if (n.startsWith('</')) { stapel.pop(); continue; }
    if (n.startsWith('<')) { const art = n.slice(1).replace(/>$/, ''); if (['requireall', 'requireany', 'requirenone'].includes(art)) { const g: Dir = { n: art, name: kopf, args: [], datei, zeile: i + 1, kinder: [] }; (stapel[stapel.length - 1]?.kinder ?? d).push(g); stapel.push(g); } else if (['files', 'filesmatch', 'limit', 'limitexcept', 'ifmodule'].includes(art)) continue; else return { fehler: `${datei}: <${kopf.slice(1).replace(/>$/, '')} not allowed here` }; continue; }
    const mod = DIREKTIVEN[n];
    const geladen = mod === 'core' || (mod && !mod.startsWith('mpm') && m.module.includes(mod));
    if (!mod || !geladen) return { fehler: `${datei}: Invalid command '${kopf}', perhaps misspelled or defined by a module not included in the server configuration` };
    const klasse = KLASSE[n];
    if (!klasse || (!erlaubt.includes('all') && !erlaubt.includes(klasse))) return { fehler: `${datei}: ${kopf} not allowed here` };
    (stapel[stapel.length - 1]?.kinder ?? d).push({ n, name: kopf, args: toks.slice(1), datei, zeile: i + 1 });
  }
  return { d };
}
type Authz = 'granted' | 'denied' | 'auth' | 'neutral';
function requireAuswerten(ds: Dir[], a: Anfrage, user: string | null, gruppen: (u: string) => string[], art = 'requireany'): Authz {
  const res: Authz[] = [];
  for (const d of ds) {
    if (d.kinder) { res.push(requireAuswerten(d.kinder, a, user, gruppen, d.n)); continue; }
    if (d.n !== 'require') continue;
    const nicht = d.args[0] === 'not'; const [prov, ...werte] = nicht ? d.args.slice(1) : d.args;
    let r: Authz;
    if (prov === 'all') r = werte[0] === 'granted' ? 'granted' : 'denied';
    else if (prov === 'ip') r = werte.some((x) => ipPasst(a.client, x)) ? 'granted' : 'denied';
    else if (prov === 'local') r = a.client.startsWith('127.') || a.client === '::1' || a.client === a.ziel ? 'granted' : 'denied';
    else if (prov === 'host') r = 'denied';
    else if (prov === 'valid-user') r = user ? 'granted' : 'auth';
    else if (prov === 'user') r = user ? (werte.includes(user) ? 'granted' : 'denied') : 'auth';
    else if (prov === 'group') r = user ? (gruppen(user).some((g) => werte.includes(g)) ? 'granted' : 'denied') : 'auth';
    else r = 'denied';
    if (nicht) r = r === 'granted' ? 'denied' : r === 'denied' ? 'neutral' : r;
    res.push(r);
  }
  if (!res.length) return 'neutral';
  if (art === 'requireall') return res.includes('denied') ? 'denied' : res.includes('auth') ? 'auth' : res.includes('granted') ? 'granted' : 'neutral';
  if (art === 'requirenone') return res.includes('granted') ? 'denied' : 'neutral';
  return res.includes('granted') ? 'granted' : res.includes('auth') ? 'auth' : res.includes('denied') ? 'denied' : 'neutral';
}
export function ipPasst(ip: string, muster: string): boolean {
  if (muster === 'all') return true;
  if (muster.includes('/')) { const [n, b] = muster.split('/'); const bits = b.includes('.') ? b.split('.').map(Number).reduce((s, x) => s + x.toString(2).replace(/0/g, '').length, 0) : Number(b); const z = (x: string) => x.split('.').reduce((s, y) => s * 256 + Number(y), 0); if (!/^[\d.]+$/.test(ip)) return false; const mask = bits ? (2 ** 32 - 2 ** (32 - bits)) : 0; return ((z(ip) & mask) >>> 0) === ((z(n) & mask) >>> 0); }
  if (/^[\d.]+$/.test(muster) && muster.split('.').length < 4) return ip.startsWith(muster.replace(/\.?$/, '.'));
  return ip === muster || (muster === 'localhost' && ip.startsWith('127.'));
}
function legacyAuswerten(ds: Dir[], client: string): Authz {
  const order = letzte(ds, 'order')?.args.join('').toLowerCase().replace(/\s/g, '');
  const allow = ds.filter((d) => d.n === 'allow').flatMap((d) => d.args.slice(1)); const deny = ds.filter((d) => d.n === 'deny').flatMap((d) => d.args.slice(1));
  if (!order && !allow.length && !deny.length) return 'neutral';
  const a = allow.some((x) => ipPasst(client, x)); const d = deny.some((x) => ipPasst(client, x));
  if (order === 'allow,deny') return a && !d ? 'granted' : 'denied';
  return d && !a ? 'denied' : 'granted';
}
function phpAusfuehren(w: Welt, quelle: string, a: Anfrage): string {
  return quelle.replace(/<\?php([\s\S]*?)(\?>|$)/g, (_, code: string) => {
    let out = '';
    for (const s of code.split(';')) {
      const t = s.trim();
      if (/^phpinfo\(\)$/.test(t)) out += `<html><body><h1>PHP Version 8.2.29</h1><table><tr><td>Server API</td><td>${rh(w) ? 'FPM/FastCGI' : 'Apache 2.0 Handler'}</td></tr><tr><td>Loaded Configuration File</td><td>${rh(w) ? '/etc/php.ini' : '/etc/php/8.2/apache2/php.ini'}</td></tr></table></body></html>\n`;
      const m = t.match(/^(?:echo|print)\s+(.+)$/s);
      if (m) out += m[1].split(/\s*\.\s*/).map((x) => x.trim()).map((x) => /^["'](.*)["']$/s.test(x) ? x.slice(1, -1).replace(/\\n/g, '\n') : x === 'phpversion()' || x === 'PHP_VERSION' ? '8.2.29' : /^\$_SERVER\[['"]REMOTE_ADDR['"]\]$/.test(x) ? a.client : /^\$_SERVER\[['"]SERVER_NAME['"]\]$/.test(x) ? a.host : /^date\(['"]Y['"]\)$/.test(x) ? String(new Date(w.uhr).getUTCFullYear()) : /^php_sapi_name\(\)$/.test(x) ? (rh(w) ? 'fpm-fcgi' : 'apache2handler') : '').join('');
    }
    return out;
  });
}
function autoindexSeite(w: Welt, dir: string, url: string, sig: string): string {
  const eintraege = ordnerInhalt(w, dir.replace(/\/$/, '')).map((p) => p.split('/').pop()!).filter((n) => !n.startsWith('.'));
  const z = eintraege.map((n) => { const p = `${dir.replace(/\/$/, '')}/${n}`; const ist = w.fs[p] === null; return `<tr><td valign="top"><img src="/icons/${ist ? 'folder' : 'text'}.gif" alt="[${ist ? 'DIR' : 'TXT'}]"></td><td><a href="${n}${ist ? '/' : ''}">${n}${ist ? '/' : ''}</a></td><td align="right">2026-11-23 08:40  </td><td align="right">${ist ? '  - ' : String((w.fs[p] as string).length).padStart(4)} </td><td>&nbsp;</td></tr>`; });
  return `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 3.2 Final//EN">\n<html>\n <head>\n  <title>Index of ${url.replace(/\/$/, '') || '/'}</title>\n </head>\n <body>\n<h1>Index of ${url.replace(/\/$/, '') || '/'}</h1>\n  <table>\n   <tr><th valign="top"><img src="/icons/blank.gif" alt="[ICO]"></th><th><a href="?C=N;O=D">Name</a></th><th><a href="?C=M;O=A">Last modified</a></th><th><a href="?C=S;O=A">Size</a></th><th><a href="?C=D;O=A">Description</a></th></tr>\n   <tr><th colspan="5"><hr></th></tr>\n<tr><td valign="top"><img src="/icons/back.gif" alt="[PARENTDIR]"></td><td><a href="/">Parent Directory</a></td><td>&nbsp;</td><td align="right">  - </td><td>&nbsp;</td></tr>\n${z.join('\n')}\n   <tr><th colspan="5"><hr></th></tr>\n</table>\n${sig}\n</body></html>\n`;
}
function statusSeite(w: Welt, m: AModell, auto: boolean): string {
  const s = st(w); const mw = mpmWerte(m); const up = Math.max(1, Math.round((w.uhr - s.apache.start) / 1000));
  const prozesse = Math.max(mw.start, m.mpm === 'mpm_prefork' ? mw.minSpare : 1); const slots = m.mpm === 'mpm_prefork' ? prozesse : prozesse * mw.threads;
  const board = 'W' + '_'.repeat(slots - 1) + '.'.repeat(Math.max(0, (m.mpm === 'mpm_prefork' ? 256 : 400) - slots));
  if (auto) return `localhost\nServerVersion: ${serverHeader(w, { ...m, global: [...m.global, { n: 'servertokens', name: 'ServerTokens', args: ['Full'], datei: '', zeile: 0 }] })}\nServerMPM: ${m.mpm.replace('mpm_', '')}\nServer Built: 2025-07-29T09:59:12\nCurrentTime: (siehe date)\nRestartTime: (Start des Dienstes)\nParentServerConfigGeneration: 1\nParentServerMPMGeneration: 0\nServerUptimeSeconds: ${up}\nServerUptime: ${up} seconds\nLoad1: 0.12\nLoad5: 0.08\nLoad15: 0.05\nTotal Accesses: ${s.anfragen}\nTotal kBytes: ${Math.ceil(s.anfragen * 11)}\nTotal Duration: ${s.anfragen * 2}\nCPUUser: .01\nCPUSystem: .02\nCPUChildrenUser: 0\nCPUChildrenSystem: 0\nCPULoad: .0102\nUptime: ${up}\nReqPerSec: ${(s.anfragen / up).toFixed(4)}\nBusyWorkers: 1\nIdleWorkers: ${slots - 1}\nProcesses: ${prozesse}\nStopping: 0\nScoreboard: ${board}`;
  return `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 3.2 Final//EN">\n<html><head>\n<title>Apache Status</title>\n</head><body>\n<h1>Apache Server Status for localhost (via ${'127.0.0.1'})</h1>\n\n<dl><dt>Server Version: ${serverHeader(w, m)}</dt>\n<dt>Server MPM: ${m.mpm.replace('mpm_', '')}</dt>\n</dl><hr /><dl>\n<dt>Server uptime:  ${up} seconds</dt>\n<dt>Total accesses: ${s.anfragen}</dt>\n<dt>1 requests currently being processed, ${slots - 1} idle workers</dt>\n</dl><pre>${board.slice(0, 64)}</pre>\n</body></html>\n`;
}
function apacheAnfrage(w: Welt, a: Anfrage): Antwort {
  const s = st(w); const m = s.apache.modell!; s.anfragen++;
  const o = ORT(w);
  const vh = vhostWaehlen(w, m, a);
  const sigArt = (wert(m, 'serversignature', vh)?.[0] ?? 'Off').toLowerCase();
  const vhName = (vh && letzte(vh.d, 'servername')?.args[0]) ?? a.host.replace(/:\d+$/, '');
  const sig = sigArt === 'on' || sigArt === 'email' ? `<address>${serverHeader(w, m)} Server at ${vhName} Port ${a.port}</address>` : '';
  const kopfStd = (): [string, string][] => [['Date', httpDatum(w)], ['Server', serverHeader(w, m)]];
  let user = '';
  const fertig = (r: Antwort): Antwort => { apacheAccessLog(w, m, vh, a, r, user); return r; };
  const fehlerseite = (status: number, extra: [string, string][] = []): Antwort => {
    // ErrorDocument
    const ed = [...m.global, ...(vh?.d ?? [])].filter((d) => d.n === 'errordocument' && d.args[0] === String(status)).pop();
    if (ed && ed.args[1]?.startsWith('/')) { const ziel = aliasFs(ed.args[1]); const t = ziel ? inhalt(w, ziel) : null; if (t !== null) return fertig({ status, kopf: [...kopfStd(), ...extra, ['Content-Type', 'text/html; charset=UTF-8']], body: t }); }
    return fertig({ status, kopf: [...kopfStd(), ...extra, ['Content-Type', 'text/html; charset=iso-8859-1']], body: a.methode === 'HEAD' ? '' : apacheFehlerseite(status, sig) });
  };
  const aliasFs = (url: string): string | null => {
    const al = [...m.global, ...(vh?.d ?? [])].filter((d) => d.n === 'alias' || d.n === 'scriptalias').sort((x, y) => y.args[0].length - x.args[0].length).find((d) => url === d.args[0] || url.startsWith(d.args[0].replace(/\/?$/, '/')) || url.startsWith(d.args[0]));
    if (al) return al.args[1].replace(/^"|"$/g, '') + url.slice(al.args[0].length);
    const root = (wert(m, 'documentroot', vh)?.[0] ?? (rh(w) ? '/var/www/html' : '/var/www')).replace(/^"|"$/g, '').replace(/\/$/, '');
    return root + url;
  };
  // HTTP an einen TLS-Port
  if (!a.tls && vh && /^on$/i.test(wert({ ...m, global: [] }, 'sslengine', vh)?.[0] ?? '')) return fertig({ status: 400, kopf: [...kopfStd(), ['Content-Type', 'text/html; charset=iso-8859-1']], body: `<!DOCTYPE HTML PUBLIC "-//IETF//DTD HTML 2.0//EN">\n<html><head>\n<title>400 Bad Request</title>\n</head><body>\n<h1>Bad Request</h1>\n<p>Your browser sent a request that this server could not understand.<br />\nReason: You're speaking plain HTTP to an SSL-enabled server port.<br />\n Instead use the HTTPS scheme to access this URL, please.<br />\n</p>\n${sig ? '<hr>\n' + sig + '\n' : ''}</body></html>\n` });
  if (a.tls && a.sni) { const sniVh = vhostWaehlen(w, m, { ...a, host: a.sni }); if (sniVh !== vh && vh && sniVh) { apacheErrorLog(w, m, vh, 'ssl:error', a.client, `AH02032: Hostname ${a.sni} provided via SNI and hostname ${a.host} provided via HTTP have no compatible SSL setup`); return fehlerseite(421); } }
  // TRACE
  if (a.methode === 'TRACE') { const te = (wert(m, 'traceenable', vh)?.[0] ?? 'on').toLowerCase(); if (te === 'off') return fehlerseite(405, [['Allow', '']]); return fertig({ status: 200, kopf: [...kopfStd(), ['Content-Type', 'message/http']], body: `TRACE ${a.pfad} HTTP/1.1\r\nHost: ${a.host}\r\nUser-Agent: curl/${CURL_VERSION}\r\nAccept: */*\r\n` }); }
  const url = decodeURIComponent(a.pfad.split('?')[0]); const query = a.pfad.includes('?') ? a.pfad.slice(a.pfad.indexOf('?') + 1) : '';
  // Umleitungen (mod_alias)
  const umleitung = (ds: Dir[]): Antwort | null => {
    for (const d of ds) {
      if (!['redirect', 'redirectpermanent', 'redirecttemp', 'redirectmatch'].includes(d.n)) continue;
      let args = [...d.args]; let code = d.n === 'redirectpermanent' ? 301 : 302;
      if (/^(permanent|temp|seeother|gone|\d{3})$/.test(args[0]) && (args.length > 2 || args[0] === 'gone')) { const c = args.shift()!; code = c === 'permanent' ? 301 : c === 'temp' ? 302 : c === 'seeother' ? 303 : c === 'gone' ? 410 : Number(c); }
      if (d.n === 'redirectmatch') { const re = new RegExp(args[0]); const mm = url.match(re); if (!mm) continue; const ziel = (args[1] ?? '').replace(/\$(\d)/g, (_, i) => mm[Number(i)] ?? ''); return fehlerHtml(code, ziel); }
      const [alt, ziel] = args;
      if (url === alt || url.startsWith(alt.replace(/\/?$/, '/'))) { if (code === 410) return fehlerseite(410); return fehlerHtml(code, ziel + url.slice(alt.length) + (query ? '?' + query : '')); }
    }
    return null;
  };
  const fehlerHtml = (code: number, ziel: string): Antwort => fertig({ status: code, kopf: [...kopfStd(), ['Location', ziel], ['Content-Type', 'text/html; charset=iso-8859-1']], body: a.methode === 'HEAD' ? '' : `<!DOCTYPE HTML PUBLIC "-//IETF//DTD HTML 2.0//EN">\n<html><head>\n<title>${code} ${TEXTE[code]}</title>\n</head><body>\n<h1>${TEXTE[code]}</h1>\n<p>The document has moved <a href="${ziel}">here</a>.</p>\n${sig ? '<hr>\n' + sig + '\n' : ''}</body></html>\n` });
  const r0 = umleitung([...m.global, ...(vh?.d ?? [])]); if (r0) return r0;
  // Datei bestimmen und Konfiguration zusammensetzen
  const fs = aliasFs(url)!.replace(/\/+/g, '/');
  const konf: DirKonf[] = [];
  for (const s2 of sektionenFuer(m, vh, 'directory', fs.replace(/\/$/, '') || '/')) konf.push({ d: s2.d, quelle: 'dir' });
  // .htaccess entlang des Pfads
  const htName = wert(m, 'accessfilename')?.[0] ?? '.htaccess';
  const teile = fs.split('/').filter(Boolean);
  for (let i = 0; i < teile.length; i++) {
    const dir = '/' + teile.slice(0, i).join('/');
    if (w.fs[dir] !== null) continue;
    const bis = konf.filter((k) => k.quelle === 'dir');
    const ao = [...bis.filter((k) => sektionenFuer(m, vh, 'directory', dir).some((s2) => s2.d === k.d))].flatMap((k) => k.d).filter((d) => d.n === 'allowoverride').pop()?.args.map((x) => x.toLowerCase()) ?? ['none'];
    if (ao.includes('none')) continue;
    const hp = `${dir === '/' ? '' : dir}/${htName}`;
    if (typeof w.fs[hp] !== 'string') continue;
    if (!leserDarf(w, hp, o.user)) { apacheErrorLog(w, m, vh, 'core:crit', a.client, `(13)Permission denied: ${hp} pcfg_openfile: unable to check htaccess file, ensure it is readable and that '${dir}/' is executable`); return fehlerseite(403); }
    const h = htaccessLesen(w, m, hp, ao);
    if ('fehler' in h) { apacheErrorLog(w, m, vh, 'core:alert', a.client, h.fehler); return fehlerseite(500); }
    konf.push({ d: h.d, quelle: 'ht' });
    const r1 = umleitung(h.d); if (r1) return r1;
  }
  for (const s2 of sektionenFuer(m, vh, 'files', fs)) konf.push({ d: s2.d, quelle: 'files' });
  const loc = sektionenFuer(m, vh, 'location', url);
  for (const s2 of loc) konf.push({ d: s2.d, quelle: 'loc' });
  const alleD = konf.flatMap((k) => k.d);
  const eff = (n: string) => [...alleD].reverse().find((d) => d.n === n)?.args;
  // Zugriff: die letzte Sektion mit Require gewinnt (AuthMerging Off)
  const mitReq = [...konf].reverse().find((k) => k.d.some((d) => d.n === 'require' || !!d.kinder));
  const mitAlt = [...konf].reverse().find((k) => k.d.some((d) => ['order', 'allow', 'deny'].includes(d.n)));
  const authName = eff('authname')?.[0]; const authType = eff('authtype')?.[0];
  const userFile = eff('authuserfile')?.[0]; const groupFile = eff('authgroupfile')?.[0];
  const gruppen = (u: string) => (groupFile ? (inhalt(w, groupFile) ?? '').split('\n').filter((z) => z.includes(':') && z.split(':')[1].trim().split(/\s+/).includes(u)).map((z) => z.split(':')[0].trim()) : []);
  let ergebnis: Authz = mitReq ? requireAuswerten(mitReq.d, a, null, gruppen) : mitAlt ? legacyAuswerten(mitAlt.d, a.client) : 'neutral';
  if (ergebnis === 'auth') {
    if (!authType) { apacheErrorLog(w, m, vh, 'authz_core:error', a.client, `AH01630: client denied by server configuration: ${fs}`); return fehlerseite(500); }
    if (!m.module.includes('auth_basic')) { apacheErrorLog(w, m, vh, 'core:error', a.client, `AH01796: AuthType ${authType} configured without corresponding module`); return fehlerseite(500); }
    const challenge: [string, string] = ['WWW-Authenticate', `Basic realm="${authName ?? ''}"`];
    if (!a.auth) return fehlerseite(401, [challenge]);
    if (!userFile) { apacheErrorLog(w, m, vh, 'auth_basic:error', a.client, `AH01615: No Authn provider configured`); return fehlerseite(500); }
    const t = inhalt(w, userFile);
    if (t === null || !leserDarf(w, userFile, o.user)) { apacheErrorLog(w, m, vh, 'authn_file:error', a.client, `(${t === null ? '2)No such file or directory' : '13)Permission denied'}: AH01620: Could not open password file: ${userFile}`); return fehlerseite(500); }
    const e = htLesen(t).find((x) => x.user === a.auth!.user);
    if (!e) { apacheErrorLog(w, m, vh, 'auth_basic:error', a.client, `AH01618: user ${a.auth.user} not found: ${url}`); return fehlerseite(401, [challenge]); }
    if (!htPruefen(e.hash, a.auth.pw)) { apacheErrorLog(w, m, vh, 'auth_basic:error', a.client, `AH01617: user ${a.auth.user}: authentication failure for "${url}": Password Mismatch`); return fehlerseite(401, [challenge]); }
    user = a.auth.user;
    ergebnis = requireAuswerten(mitReq!.d, a, user, gruppen);
    if (ergebnis !== 'granted') { apacheErrorLog(w, m, vh, 'authz_core:error', a.client, `AH01631: user ${user}: authorization failure for "${url}": `); return fehlerseite(401, [challenge]); }
  }
  if (ergebnis === 'denied') { apacheErrorLog(w, m, vh, 'authz_core:error', a.client, mitReq ? `AH01630: client denied by server configuration: ${fs.replace(/\/$/, '') + (w.fs[fs.replace(/\/$/, '')] === null && !fs.endsWith('/') ? '' : fs.endsWith('/') ? '/' : '')}` : `AH01797: client denied by server configuration: ${fs}`); return fehlerseite(403); }
  // Handler
  const handler = eff('sethandler')?.[0];
  if (handler === 'server-status' && m.module.includes('status')) return fertig({ status: 200, kopf: [...kopfStd(), ['Content-Type', query.includes('auto') ? 'text/plain; charset=ISO-8859-1' : 'text/html; charset=ISO-8859-1']], body: statusSeite(w, m, query.includes('auto')) });
  let pfad = fs;
  if (w.fs[pfad.replace(/\/$/, '')] === null) {
    const d = pfad.replace(/\/$/, '');
    if (!url.endsWith('/')) return fehlerHtml(301, `${a.tls ? 'https' : 'http'}://${a.host}${url}/`);
    const idx = (eff('directoryindex') ?? (m.module.includes('dir') ? (wert(m, 'directoryindex') ?? ['index.html']) : [])).find((x) => typeof w.fs[`${d}/${x}`] === 'string');
    if (idx) pfad = `${d}/${idx}`;
    else {
      const opts = konf.filter((k) => k.quelle !== 'files').flatMap((k) => k.d).filter((x) => x.n === 'options').reduce((set, x) => { for (const o2 of x.args) { if (o2.startsWith('-')) set.delete(o2.slice(1).toLowerCase()); else if (o2.startsWith('+')) set.add(o2.slice(1).toLowerCase()); else { if (x.args.every((y) => !/^[+-]/.test(y)) && o2 === x.args[0]) set.clear(); set.add(o2.toLowerCase()); } } return set; }, new Set<string>(['followsymlinks']));
      if ((opts.has('indexes') || opts.has('all')) && m.module.includes('autoindex')) return fertig({ status: 200, kopf: [...kopfStd(), ['Content-Type', 'text/html;charset=UTF-8']], body: a.methode === 'HEAD' ? '' : autoindexSeite(w, d, url, sig) });
      apacheErrorLog(w, m, vh, 'autoindex:error', a.client, `AH01276: Cannot serve directory ${d}/: No matching DirectoryIndex (${(wert(m, 'directoryindex') ?? ['index.html']).join(',')}) found, and server-generated directory index forbidden by Options directive`);
      return fehlerseite(403);
    }
  }
  const text = inhalt(w, pfad);
  if (text === null) return fehlerseite(404);
  if (!leserDarf(w, pfad, o.user)) { apacheErrorLog(w, m, vh, 'core:error', a.client, `(13)Permission denied: AH00132: file permissions deny server access: ${pfad}`); return fehlerseite(403); }
  if (pfad.endsWith('.php') && (m.module.includes('php') || (rh(w) && m.module.includes('proxy_fcgi') && w.prozesse.some((p) => p.cmd.startsWith('php-fpm'))))) return fertig({ status: 200, kopf: [...kopfStd(), ...((wert(m, 'servertokens')?.[0] ?? 'Full').toLowerCase() !== 'prod' ? [['X-Powered-By', 'PHP/8.2.29'] as [string, string]] : []), ['Content-Type', 'text/html; charset=UTF-8']], body: phpAusfuehren(w, text, a) });
  if (pfad.endsWith('.php') && rh(w) && m.module.includes('proxy_fcgi')) { apacheErrorLog(w, m, vh, 'proxy:error', a.client, `(2)No such file or directory: AH02454: FCGI: attempt to connect to Unix domain socket /run/php-fpm/www.sock (*:80) failed`); return fehlerseite(503); }
  const etag = `"${(text.length).toString(16)}-${sha256(pfad).slice(0, 13)}"`;
  return fertig({ status: 200, kopf: [...kopfStd(), ['Last-Modified', httpDatum({ ...w, uhr: meta(w, pfad).mtime ?? w.uhr } as Welt)], ['ETag', etag], ['Accept-Ranges', 'bytes'], ['Content-Length', String(text.length)], ...(/\.html?$/.test(pfad) ? [['Vary', 'Accept-Encoding'] as [string, string]] : []), ['Content-Type', mimeVon(pfad)]], body: a.methode === 'HEAD' ? '' : text });
}

// ---------- Apache: TLS des virtuellen Hosts ----------
function apacheTls(w: Welt, m: AModell, ziel: string, port: number, sni: string | null): { kette: Zert[]; protokolle: string[]; bits: number } | { fehler: string } | null {
  const vh = vhostWaehlen(w, m, { methode: 'GET', host: sni ?? ziel, pfad: '/', port, tls: true, sni, client: '127.0.0.1', ziel, kopf: {} });
  if (!vh || !/^on$/i.test(wert({ ...m, global: [] }, 'sslengine', vh)?.[0] ?? '')) return { fehler: 'wrong version number' };
  const cf = wert(m, 'sslcertificatefile', vh)?.[0]; const kette = [...zertifikate(cf ? inhalt(w, cf) : ''), ...zertifikate(inhalt(w, wert(m, 'sslcertificatechainfile', vh)?.[0] ?? '') ?? '')];
  return { kette, protokolle: protokolle(wert(m, 'sslprotocol', vh) ?? ['all', '-SSLv3']), bits: kette[0]?.bits ?? 2048 };
}
export function protokolle(args: string[]): string[] {
  let set = new Set<string>();
  for (const a of args) { const n = a.replace(/^[+-]/, '').toLowerCase(); const alle = ['TLSv1', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3']; const liste = n === 'all' ? alle : alle.filter((x) => x.toLowerCase() === n); if (a.startsWith('-')) liste.forEach((x) => set.delete(x)); else if (a.startsWith('+')) liste.forEach((x) => set.add(x)); else set = new Set(liste); }
  // Debian 12 und RHEL 9: OpenSSL lässt unter TLS 1.2 nichts mehr zu
  return ['TLSv1.2', 'TLSv1.3'].filter((x) => set.has(x));
}

// =====================================================================================================
// Nginx
// =====================================================================================================
interface NDir { n: string; args: string[]; kinder?: NDir[]; datei: string; zeile: number }
interface NModell { baum: NDir[]; server: NServer[]; upstreams: Record<string, string[]>; warnungen: string[] }
interface NServer { listen: { ip: string; port: number; def: boolean; ssl: boolean }[]; namen: string[]; d: NDir[]; locs: NDir[] }
const NG: Record<string, { ctx: string[]; args: [number, number]; block?: boolean }> = {};
const ng = (namen: string, ctx: string, min: number, max: number, block = false) => { for (const n of namen.split(' ')) NG[n] = { ctx: ctx.split(','), args: [min, max], block }; };
ng('user', 'main', 1, 2); ng('worker_processes pid load_module worker_rlimit_nofile', 'main', 1, 1); ng('events', 'main', 0, 0, true); ng('http', 'main', 0, 0, true);
ng('worker_connections multi_accept use', 'events', 1, 1);
ng('include', 'main,events,http,server,location,upstream,types', 1, 1);
ng('error_log', 'main,http,server,location', 1, 2);
ng('sendfile tcp_nopush tcp_nodelay types_hash_max_size default_type ssl_prefer_server_ciphers gzip server_tokens client_max_body_size charset keepalive_requests', 'http,server,location', 1, 1);
ng('keepalive_timeout', 'http,server,location', 1, 2); ng('ssl_protocols', 'http,server', 1, 5); ng('ssl_ciphers ssl_certificate ssl_certificate_key ssl_session_cache ssl_session_timeout ssl_dhparam', 'http,server', 1, 2);
ng('access_log', 'http,server,location', 1, 4); ng('log_format', 'http', 2, 20); ng('gzip_types', 'http,server,location', 1, 20);
ng('server', 'http', 0, 0, true); ng('upstream', 'http', 1, 1, true); ng('types', 'http,server,location', 0, 0, true);
ng('listen', 'server', 1, 6); ng('server_name', 'server', 1, 20); ng('root', 'http,server,location', 1, 1); ng('index', 'http,server,location', 1, 10);
ng('location', 'server,location', 1, 2, true); ng('return', 'server,location', 1, 2); ng('rewrite', 'server,location', 2, 3); ng('try_files', 'server,location', 2, 10);
ng('autoindex', 'http,server,location', 1, 1); ng('allow deny', 'http,server,location', 1, 1); ng('auth_basic auth_basic_user_file', 'http,server,location', 1, 1);
ng('add_header', 'http,server,location', 2, 3); ng('error_page', 'http,server,location', 2, 10); ng('expires', 'http,server,location', 1, 2);
ng('proxy_pass', 'location', 1, 1); ng('proxy_set_header', 'http,server,location', 2, 2); ng('proxy_redirect', 'http,server,location', 1, 2); ng('proxy_connect_timeout proxy_read_timeout proxy_http_version proxy_buffering', 'http,server,location', 1, 1);
ng('alias', 'location', 1, 1); ng('internal', 'location', 0, 0); ng('limit_except', 'location', 1, 10, true);
ng('fastcgi_pass', 'location', 1, 1); ng('fastcgi_param', 'http,server,location', 2, 3); ng('fastcgi_index', 'http,server,location', 1, 1);
ng('least_conn ip_hash', 'upstream', 0, 0); ng('keepalive', 'upstream', 1, 1);
function nginxLesen(w: Welt, start = '/etc/nginx/nginx.conf'): { modell: NModell } | { fehler: string } {
  const warn: string[] = [];
  class F extends Error {}
  const err = (msg: string) => { throw new F(msg); };
  function parse(pfad: string, ctx: string, inBlock: string | null): NDir[] {
    const text = inhalt(w, pfad); if (text === null) err(`open() "${pfad}" failed (2: No such file or directory)`);
    const toks: { v: string; z: number; q: boolean }[] = []; let z = 1; let i = 0; const t = text!;
    while (i < t.length) {
      const c = t[i];
      if (c === '\n') { z++; i++; continue; } if (/\s/.test(c)) { i++; continue; }
      if (c === '#') { while (i < t.length && t[i] !== '\n') i++; continue; }
      if ('{};'.includes(c)) { toks.push({ v: c, z, q: false }); i++; continue; }
      if (c === '"' || c === "'") { let v = ''; i++; while (i < t.length && t[i] !== c) { if (t[i] === '\\' && i + 1 < t.length) { v += t[i + 1]; i += 2; continue; } if (t[i] === '\n') z++; v += t[i++]; } i++; toks.push({ v, z, q: true }); continue; }
      let v = ''; while (i < t.length && !/[\s{};]/.test(t[i])) v += t[i++]; toks.push({ v, z, q: false });
    }
    let p = 0;
    const block = (ctx2: string, offen: number | null): NDir[] => {
      const out: NDir[] = [];
      while (p < toks.length) {
        const tk = toks[p];
        if (tk.v === '}' && !tk.q) { if (offen === null) err(`unexpected "}" in ${pfad}:${tk.z}`); p++; return out; }
        if ((tk.v === ';' || tk.v === '{') && !tk.q) err(`unexpected "${tk.v}" in ${pfad}:${tk.z}`);
        const name = tk.v; const z0 = tk.z; p++;
        const args: string[] = [];
        while (p < toks.length && !(['{', ';', '}'].includes(toks[p].v) && !toks[p].q)) args.push(toks[p++].v);
        const ende = toks[p];
        if (!ende) err(`unexpected end of file, expecting ";" or "}" in ${pfad}:${toks[toks.length - 1]?.z ?? z0}`);
        if (ctx2 === 'types') { p++; continue; }
        const spec = ctx2 === 'upstream' && name === 'server' ? { ctx: ['upstream'], args: [1, 8] as [number, number], block: false } : NG[name];
        if (!spec) err(`unknown directive "${name}" in ${pfad}:${z0}`);
        if (!spec!.ctx.includes(ctx2)) err(`"${name}" directive is not allowed here in ${pfad}:${z0}`);
        if (ende.v === '}') err(`unexpected "}" in ${pfad}:${ende.z}`);
        if (spec!.block && ende.v === ';') err(`directive "${name}" has no opening "{" in ${pfad}:${ende.z}`);
        if (!spec!.block && ende.v === '{') err(`directive "${name}" is not terminated by ";" in ${pfad}:${ende.z}`);
        if (args.length < spec!.args[0] || args.length > spec!.args[1]) err(`invalid number of arguments in "${name}" directive in ${pfad}:${z0}`);
        p++;
        if (name === 'include') { const mu = args[0].startsWith('/') ? args[0] : `/etc/nginx/${args[0]}`; const tr = glob(w, mu); if (!tr.length && !/[*?]/.test(mu)) err(`open() "${mu}" failed (2: No such file or directory) in ${pfad}:${z0}`); for (const f of tr) out.push(...parse(f, ctx2, null)); continue; }
        const d: NDir = { n: name, args, datei: pfad, zeile: z0 };
        if (spec!.block) d.kinder = block(name === 'location' || name === 'limit_except' ? 'location' : name, z0);
        out.push(d);
      }
      if (offen !== null) err(`unexpected end of file, expecting "}" in ${pfad}:${(t.match(/\n/g)?.length ?? 0) + 1}`);
      return out;
    };
    void inBlock;
    return block(ctx, null);
  }
  try {
    const baum = parse(start, 'main', null);
    const http = baum.find((d) => d.n === 'http');
    const server: NServer[] = []; const upstreams: Record<string, string[]> = {};
    for (const d of http?.kinder ?? []) {
      if (d.n === 'upstream') upstreams[d.args[0]] = d.kinder!.filter((x) => x.n === 'server').map((x) => x.args[0]);
      if (d.n !== 'server') continue;
      const listen = d.kinder!.filter((x) => x.n === 'listen').map((x) => { const a0 = x.args[0]; const mm = a0.match(/^(?:\[([^\]]+)\]:|([\d.*]+):)?(\d+)$/) ?? a0.match(/^([\d.]+)$/); return { ip: mm?.[1] ? `[${mm[1]}]` : mm?.[2] ?? '0.0.0.0', port: Number(mm?.[3] ?? 80), def: x.args.includes('default_server') || x.args.includes('default'), ssl: x.args.includes('ssl') }; });
      server.push({ listen: listen.length ? listen : [{ ip: '0.0.0.0', port: 80, def: false, ssl: false }], namen: d.kinder!.filter((x) => x.n === 'server_name').flatMap((x) => x.args), d: d.kinder!, locs: d.kinder!.filter((x) => x.n === 'location') });
    }
    // Prüfungen über mehrere Dateien
    const defs: Record<string, NDir> = {};
    for (const s of server) for (const l of s.listen) if (l.def) { const k = `${l.ip}:${l.port}`; const quelle = s.d.find((x) => x.n === 'listen' && x.args.includes('default_server'))!; if (defs[k]) err(`a duplicate default server for ${l.ip === '[::]' ? '[::]' : l.ip}:${l.port} in ${quelle.datei}:${quelle.zeile}`); defs[k] = quelle; }
    const gesehen = new Set<string>();
    for (const s of server) for (const l of s.listen) for (const n of s.namen) { const k = `${n}@${l.ip}:${l.port}`; if (n !== '_' && n !== '""' && gesehen.has(k)) warn.push(`conflicting server name "${n}" on ${l.ip}:${l.port}, ignored`); gesehen.add(k); }
    for (const s of server) for (const d of alleNDir(s.d)) {
      if (d.n === 'proxy_pass') { const h = d.args[0].replace(/^https?:\/\//, '').split(/[/:]/)[0]; if (!d.args[0].match(/^https?:\/\//)) err(`invalid URL prefix in ${d.datei}:${d.zeile}`); if (!upstreams[h] && !/^[\d.]+$/.test(h) && h !== 'localhost' && !aufloesen(w, h).ip) err(`host not found in upstream "${h}" in ${d.datei}:${d.zeile}`); }
      if ((d.n === 'ssl_certificate' || d.n === 'ssl_certificate_key') && !(inhalt(w, d.args[0])?.length)) err(`cannot load certificate${d.n.endsWith('key') ? ' key' : ''} "${d.args[0]}": BIO_new_file() failed (SSL: error:80000002:system library::No such file or directory:calling fopen(${d.args[0]}, r) error:10000080:BIO routines::no such file)`);
      if (d.n === 'auth_basic_user_file' && d.args[0] && false) void 0;
    }
    return { modell: { baum, server, upstreams, warnungen: warn } };
  } catch (e) { if (e instanceof F) return { fehler: e.message }; throw e; }
}
const alleNDir = (ds: NDir[]): NDir[] => ds.flatMap((d) => [d, ...(d.kinder ? alleNDir(d.kinder) : [])]);
function nginxMeldung(w: Welt, stufe: string, text: string) { return `${zeitNginx(w)} [${stufe}] ${st(w).nginx.pid || 4711}#${st(w).nginx.pid || 4711}: ${text}`; }
function nginxLog(w: Welt, datei: string, z: string) { anhaengen(w, datei, z, 'www-data', 'adm'); }
function nginxTls(w: Welt, m: NModell, port: number, sni: string | null) {
  const srv = m.server.filter((s) => s.listen.some((l) => l.port === port));
  const s = srv.find((x) => sni && x.namen.includes(sni)) ?? srv.find((x) => x.listen.some((l) => l.port === port && l.def)) ?? srv[0];
  if (!s || !s.listen.some((l) => l.port === port && l.ssl)) return { fehler: 'wrong version number' };
  const ers = (n: string) => [...s.d].reverse().find((d) => d.n === n)?.args ?? [...(m.baum.find((d) => d.n === 'http')?.kinder ?? [])].reverse().find((d) => d.n === n)?.args;
  const kette = zertifikate(inhalt(w, ers('ssl_certificate')?.[0] ?? '') ?? '');
  return { kette, protokolle: protokolle(['-all', ...(ers('ssl_protocols') ?? ['TLSv1.2', 'TLSv1.3']).map((x) => '+' + x)]), bits: kette[0]?.bits ?? 2048 };
}
function nginxAnfrage(w: Welt, a: Anfrage, tiefe: number): Antwort {
  const m = st(w).nginx.modell!;
  const http = m.baum.find((d) => d.n === 'http')!.kinder!;
  const srv = m.server.filter((s) => s.listen.some((l) => l.port === a.port));
  const h = a.host.replace(/:\d+$/, '').toLowerCase();
  const namePasst2 = (n: string) => n === h || (n.startsWith('*.') && h.endsWith(n.slice(1))) || (n.startsWith('.') && (h === n.slice(1) || h.endsWith(n))) || (n.endsWith('.*') && h.startsWith(n.slice(0, -1))) || (n.startsWith('~') && new RegExp(n.slice(1)).test(h));
  const s = srv.find((x) => x.namen.some(namePasst2)) ?? srv.find((x) => x.listen.some((l) => l.port === a.port && l.def)) ?? srv[0];
  const tokens = [...http].reverse().find((d) => d.n === 'server_tokens')?.args[0] ?? 'on';
  const serverKopf = (tok: string) => (tok === 'off' ? 'nginx' : `nginx/${NGINX_VERSION}`);
  const url = a.pfad.split('?')[0];
  // Location wählen
  const locs = s.locs;
  const genau = locs.find((l) => l.args[0] === '=' && l.args[1] === url);
  const prefix = locs.filter((l) => (l.args.length === 1 || l.args[0] === '^~') && url.startsWith(l.args[l.args.length - 1])).sort((x, y) => y.args[y.args.length - 1].length - x.args[x.args.length - 1].length)[0];
  const regex = locs.find((l) => (l.args[0] === '~' || l.args[0] === '~*') && new RegExp(l.args[1], l.args[0] === '~*' ? 'i' : '').test(url));
  const loc = genau ?? (prefix?.args[0] === '^~' ? prefix : regex ?? prefix);
  const ebenen = [http.filter((d) => !d.kinder), s.d.filter((d) => !d.kinder), loc?.kinder ?? []];
  const erb = (n: string) => { for (let i = ebenen.length - 1; i >= 0; i--) { const d = [...ebenen[i]].reverse().find((x) => x.n === n); if (d) return d.args; } return undefined; };
  const array = (n: string) => { for (let i = ebenen.length - 1; i >= 0; i--) { const ds = ebenen[i].filter((x) => x.n === n); if (ds.length) return ds; } return []; };
  const tok = erb('server_tokens')?.[0] ?? tokens;
  const errLog = erb('error_log')?.[0] ?? '/var/log/nginx/error.log'; const accLog = erb('access_log')?.[0] ?? '/var/log/nginx/access.log';
  let user = '';
  const kopf = (): [string, string][] => [['Server', serverKopf(tok)], ['Date', httpDatum(w)]];
  const zusatz = (): [string, string][] => array('add_header').map((d) => [d.args[0], d.args[1]]);
  const fertig = (r: Antwort): Antwort => { if (accLog !== 'off') nginxLog(w, accLog, `${a.client} - ${user || '-'} [${zeitClf(w)}] "${a.methode} ${a.pfad} HTTP/1.1" ${r.status} ${r.body.length} "-" "${a.kopf['user-agent'] ?? '-'}"`); return r; };
  const ctx = `client: ${a.client}, server: ${s.namen[0] ?? ''}, request: "${a.methode} ${a.pfad} HTTP/1.1"`;
  const seite = (status: number, extra: [string, string][] = []): Antwort => fertig({ status, kopf: [...kopf(), ['Content-Type', 'text/html'], ...extra], body: a.methode === 'HEAD' ? '' : `<html>\r\n<head><title>${status} ${TEXTE[status]}</title></head>\r\n<body>\r\n<center><h1>${status} ${TEXTE[status]}</h1></center>\r\n<hr><center>${serverKopf(tok)}</center>\r\n</body>\r\n</html>\r\n` });
  if (!s) return seite(404);
  // return in server oder location
  const ret = loc?.kinder?.find((d) => d.n === 'return') ?? s.d.find((d) => d.n === 'return');
  const vars = (x: string) => x.replace(/\$host/g, h).replace(/\$request_uri/g, a.pfad).replace(/\$uri/g, url).replace(/\$scheme/g, a.tls ? 'https' : 'http').replace(/\$server_name/g, s.namen[0] ?? '').replace(/\$remote_addr/g, a.client);
  if (ret) { const code = Number(ret.args[0]); const ziel = vars(ret.args[1] ?? ''); if ([301, 302, 303, 307, 308].includes(code)) return seite(code, [['Location', ziel]]); if (ret.args[1]) return fertig({ status: code, kopf: [...kopf(), ['Content-Type', 'application/octet-stream']], body: ziel }); return seite(code); }
  // allow/deny
  for (const d of [...array('allow').concat(array('deny'))].sort((x, y) => x.zeile - y.zeile)) {
    if (ipPasst(a.client, d.args[0])) { if (d.n === 'deny') { nginxLog(w, errLog, nginxMeldung(w, 'error', `*${st(w).anfragen} access forbidden by rule, ${ctx}, host: "${a.host}"`)); return seite(403); } break; }
  }
  // auth_basic
  const ab = erb('auth_basic')?.[0];
  if (ab && ab !== 'off') {
    const f = erb('auth_basic_user_file')?.[0] ?? ''; const ch: [string, string] = ['WWW-Authenticate', `Basic realm="${ab}"`];
    if (!a.auth) { nginxLog(w, errLog, nginxMeldung(w, 'error', `*${st(w).anfragen} no user/password was provided for basic authentication, ${ctx}, host: "${a.host}"`)); return seite(401, [ch]); }
    const t = inhalt(w, f.startsWith('/') ? f : `/etc/nginx/${f}`);
    if (t === null) { nginxLog(w, errLog, nginxMeldung(w, 'crit', `*${st(w).anfragen} open() "${f}" failed (2: No such file or directory), ${ctx}, host: "${a.host}"`)); return seite(500); }
    const e = htLesen(t).find((x) => x.user === a.auth!.user);
    if (!e) { nginxLog(w, errLog, nginxMeldung(w, 'error', `*${st(w).anfragen} user "${a.auth.user}" was not found in "${f}", ${ctx}, host: "${a.host}"`)); return seite(401, [ch]); }
    if (!htPruefen(e.hash, a.auth.pw)) { nginxLog(w, errLog, nginxMeldung(w, 'error', `*${st(w).anfragen} user "${a.auth.user}": password mismatch, ${ctx}, host: "${a.host}"`)); return seite(401, [ch]); }
    user = a.auth.user;
  }
  // proxy_pass
  const pp = loc?.kinder?.find((d) => d.n === 'proxy_pass');
  if (pp) {
    const mm = pp.args[0].match(/^(https?):\/\/([^/:]+)(?::(\d+))?(\/.*)?$/)!;
    const name = mm[2]; const uriTeil = mm[4];
    const ziele = m.upstreams[name] ? m.upstreams[name] : [`${name}:${mm[3] ?? (mm[1] === 'https' ? 443 : 80)}`];
    const lp = loc!.args[loc!.args.length - 1];
    const neuPfad = uriTeil !== undefined ? uriTeil + a.pfad.slice(lp.length) : a.pfad;
    const hdr: Record<string, string> = { ...a.kopf, host: m.upstreams[name] ? name : `${name}${mm[3] ? ':' + mm[3] : ''}` };
    for (const d of array('proxy_set_header')) { const v = d.args[1].replace(/\$proxy_add_x_forwarded_for/g, a.kopf['x-forwarded-for'] ? `${a.kopf['x-forwarded-for']}, ${a.client}` : a.client).replace(/\$proxy_host/g, name); const vv = vars(v); if (vv === '') delete hdr[d.args[0].toLowerCase()]; else hdr[d.args[0].toLowerCase()] = vv; }
    const s0 = st(w).rr[name] ?? 0; st(w).rr[name] = s0 + 1;
    for (let k = 0; k < ziele.length; k++) {
      const z = ziele[(s0 + k) % ziele.length]; const [zh, zp] = z.split(':'); const ip = /^[\d.]+$/.test(zh) ? zh : zh === 'localhost' ? '127.0.0.1' : aufloesen(w, zh).ip;
      const r = ip ? verbinden(w, { methode: a.methode, host: hdr.host, pfad: neuPfad, port: Number(zp ?? 80), tls: mm[1] === 'https', sni: null, client: eigen(w, ip) ? '127.0.0.1' : '192.168.1.23', ziel: ip, kopf: hdr, auth: a.auth }, tiefe + 1) : { fehler: 'aufloesen' as const };
      if ('fehler' in r) { nginxLog(w, errLog, nginxMeldung(w, 'error', `*${st(w).anfragen} connect() failed (111: Connection refused) while connecting to upstream, ${ctx}, upstream: "${mm[1]}://${ip}:${zp ?? 80}${neuPfad}", host: "${a.host}"`)); continue; }
      return fertig({ status: r.status, kopf: [...kopf(), ...r.kopf.filter(([k2]) => !['server', 'date'].includes(k2.toLowerCase())), ...zusatz()], body: r.body });
    }
    return seite(502);
  }
  // statische Dateien
  const root = (erb('root')?.[0] ?? '/usr/share/nginx/html').replace(/\/$/, '');
  const alias = loc?.kinder?.find((d) => d.n === 'alias')?.args[0];
  const fsVon = (u: string) => (alias ? alias.replace(/\/$/, '') + '/' + u.slice((loc!.args[loc!.args.length - 1]).length).replace(/^\//, '') : root + u).replace(/\/{2,}/g, '/');
  const index = erb('index') ?? ['index.html'];
  const liefern = (p: string): Antwort | null => {
    if (w.fs[p.replace(/\/$/, '')] === null) {
      if (!p.endsWith('/')) return seite(301, [['Location', `${a.tls ? 'https' : 'http'}://${a.host}${url}/`]]);
      const i = index.find((x) => typeof w.fs[`${p}${x}`] === 'string');
      if (i) return liefern(p + i);
      if (erb('autoindex')?.[0] === 'on') return fertig({ status: 200, kopf: [...kopf(), ['Content-Type', 'text/html']], body: `<html>\r\n<head><title>Index of ${url}</title></head>\r\n<body>\r\n<h1>Index of ${url}</h1><hr><pre><a href="../">../</a>\r\n${ordnerInhalt(w, p.replace(/\/$/, '')).map((x) => x.split('/').pop()).map((x) => `<a href="${x}">${x}</a>`).join('\r\n')}\r\n</pre><hr></body>\r\n</html>\r\n` });
      nginxLog(w, errLog, nginxMeldung(w, 'error', `*${st(w).anfragen} directory index of "${p}" is forbidden, ${ctx}, host: "${a.host}"`)); return seite(403);
    }
    const t = inhalt(w, p); if (t === null) return null;
    if (!leserDarf(w, p, 'www-data')) { nginxLog(w, errLog, nginxMeldung(w, 'error', `*${st(w).anfragen} open() "${p}" failed (13: Permission denied), ${ctx}, host: "${a.host}"`)); return seite(403); }
    return fertig({ status: 200, kopf: [...kopf(), ['Content-Type', mimeVon(p)], ['Content-Length', String(t.length)], ['Last-Modified', httpDatum(w)], ['Connection', 'keep-alive'], ['ETag', `"${sha256(p).slice(0, 8)}-${t.length.toString(16)}"`], ['Accept-Ranges', 'bytes'], ...zusatz()], body: a.methode === 'HEAD' ? '' : t });
  };
  const tf = loc?.kinder?.find((d) => d.n === 'try_files') ?? s.d.find((d) => d.n === 'try_files');
  if (tf) {
    for (const x of tf.args.slice(0, -1)) { const p = fsVon(x.replace(/\$uri/g, url)); if ((x.endsWith('/') && w.fs[p.replace(/\/$/, '')] === null) || (!x.endsWith('/') && typeof w.fs[p] === 'string')) { const r = liefern(p); if (r) return r; } }
    const last = tf.args[tf.args.length - 1];
    if (/^=\d{3}$/.test(last)) return seite(Number(last.slice(1)));
    return nginxAnfrage(w, { ...a, pfad: last }, tiefe + 1);
  }
  const r = liefern(fsVon(url));
  if (r) return r;
  nginxLog(w, errLog, nginxMeldung(w, 'error', `*${st(w).anfragen} open() "${fsVon(url)}" failed (2: No such file or directory), ${ctx}, host: "${a.host}"`));
  return seite(404);
}

// =====================================================================================================
// Squid
// =====================================================================================================
interface SModell { acls: Record<string, { typ: string; werte: string[] }>; regeln: { allow: boolean; acls: string[] }[]; port: number; auth: { programm?: string; datei?: string; realm: string }; werte: Record<string, string[]>; zeilen: string[] }
const SQUID_DIREKTIVEN = new Set('acl http_access http_port cache_mem cache_dir maximum_object_size minimum_object_size maximum_object_size_in_memory cache_replacement_policy auth_param include coredump_dir refresh_pattern logfile_rotate access_log cache_log cache_store_log visible_hostname cache_effective_user cache_effective_group dns_nameservers forwarded_for via request_header_access reply_header_access cache_peer never_direct always_direct cache delay_pools delay_class delay_access delay_parameters client_lifetime connect_timeout shutdown_lifetime max_filedescriptors workers icp_port htcp_port cache_mgr error_directory pid_filename url_rewrite_program ssl_bump sslcrtd_program http_reply_access'.split(' '));
const SQUID_ACL_TYPEN = new Set('src dst srcdomain dstdomain dstdom_regex srcdom_regex port localport proto method time url_regex urlpath_regex browser proxy_auth proxy_auth_regex maxconn myport myip arp req_header rep_header http_status external note any-of all-of ssl_error server_cert_fingerprint at_step ssl::server_name'.split(' '));
function squidLesen(w: Welt, start = '/etc/squid/squid.conf'): { modell: SModell } | { fehler: string; zeilen: string[] } {
  const m: SModell = { acls: { all: { typ: 'src', werte: ['all'] }, localhost: { typ: 'src', werte: ['127.0.0.1/32', '::1'] }, to_localhost: { typ: 'dst', werte: ['127.0.0.0/8', '0.0.0.0/32', '::1'] }, manager: { typ: 'url_regex', werte: ['-i', '^cache_object://', '+i', '^https?://[^/]+/squid-internal-mgr/'] } }, regeln: [], port: 3128, auth: { realm: 'Squid proxy-caching web server' }, werte: {}, zeilen: [] };
  const z0 = zeitSquid(w);
  function datei2(pfad: string, tiefe: number): string | null {
    const t = inhalt(w, pfad); if (t === null) return `${z0} ERROR: Can not open file ${pfad} for reading\n${z0} FATAL: Unable to open configuration file: ${pfad}: (2) No such file or directory`;
    m.zeilen.push(`${z0} Processing Configuration File: ${pfad} (depth ${tiefe})`);
    const zl = t.split('\n');
    for (let i = 0; i < zl.length; i++) {
      const roh = zl[i].replace(/\s#.*$/, '').trim(); if (!roh || roh.startsWith('#')) continue;
      const [n, ...args] = roh.split(/\s+/);
      if (n === 'include') { for (const f of glob(w, args[0])) { const e = datei2(f, tiefe + 1); if (e) return e; } continue; }
      m.zeilen.push(`${z0} Processing: ${roh}`);
      const bungled = (grund: string) => `${grund}\n${z0} FATAL: Bungled ${pfad} line ${i + 1}: ${roh}`;
      if (!SQUID_DIREKTIVEN.has(n)) return `${z0} ${pfad}(${i + 1}): unrecognized: '${n}'`;
      if (n === 'acl') {
        const [name, typ, ...werte] = args;
        if (!typ) return bungled(`${z0} ERROR: aclParseAclLine: missing ACL type in ${pfad} line ${i + 1}`);
        if (!SQUID_ACL_TYPEN.has(typ)) return bungled(`${z0} ERROR: configuration failure: invalid ACL type '${typ}'`);
        if (['all', 'manager', 'localhost', 'to_localhost'].includes(name) && m.acls[name] && m.acls[name].typ !== typ) return bungled(`${z0} ERROR: ACL '${name}' already exists with different type.`);
        if (m.acls[name] && m.acls[name].typ !== typ) return bungled(`${z0} ERROR: ACL '${name}' already exists with different type.`);
        m.acls[name] = { typ, werte: [...(m.acls[name]?.werte ?? []), ...werte] };
        continue;
      }
      if (n === 'http_access') {
        const [art, ...acls] = args;
        if (art !== 'allow' && art !== 'deny') return bungled(`${z0} ERROR: aclParseAccessLine: ${pfad} line ${i + 1}: ${roh}\n${z0} ERROR: aclParseAccessLine: expecting 'allow' or 'deny', got '${art}'.`);
        for (const a of acls) if (!m.acls[a.replace(/^!/, '')]) return bungled(`${z0} ERROR: ACL not found: ${a.replace(/^!/, '')}`);
        m.regeln.push({ allow: art === 'allow', acls }); continue;
      }
      if (n === 'http_port') { m.port = Number(args[0].split(':').pop()); continue; }
      if (n === 'auth_param') { if (args[1] === 'program') { m.auth.programm = args[2]; m.auth.datei = args[3]; } if (args[1] === 'realm') m.auth.realm = args.slice(2).join(' '); continue; }
      if (n === 'cache_mem' && !/^\d+$/.test(args[0] ?? '')) return bungled(`${z0} ERROR: '${args[0]}' is not a valid number`);
      m.werte[n] = args;
    }
    return null;
  }
  const e = datei2(start, 0);
  if (e) return { fehler: e, zeilen: m.zeilen };
  if (Object.values(m.acls).some((a) => a.typ === 'proxy_auth') && !m.auth.programm) return { fehler: `${z0} ERROR: Invalid Proxy Auth ACL 'acl ${Object.entries(m.acls).find(([, a]) => a.typ === 'proxy_auth')![0]} proxy_auth REQUIRED' because no authentication schemes are fully configured.\n${z0} FATAL: Bungled ${start} line 1: acl`, zeilen: m.zeilen };
  return { modell: m };
}
function squidAclPasst(w: Welt, m: SModell, name: string, r: { client: string; ziel: string; host: string; port: number; methode: string; url: string; user: string | null }): boolean | 'auth' {
  const a = m.acls[name]; if (!a) return false;
  const v = a.werte;
  switch (a.typ) {
    case 'src': return v.some((x) => x === 'all' || ipBereich(r.client, x));
    case 'dst': return v.some((x) => ipBereich(r.ziel, x));
    case 'dstdomain': return v.some((x) => (x.startsWith('.') ? r.host === x.slice(1) || r.host.endsWith(x) : r.host === x));
    case 'dstdom_regex': return v.filter((x) => x !== '-i').some((x) => new RegExp(x, v.includes('-i') ? 'i' : '').test(r.host));
    case 'port': return v.some((x) => { const [lo, hi] = x.split('-').map(Number); return hi ? r.port >= lo && r.port <= hi : r.port === lo; });
    case 'method': return v.includes(r.methode);
    case 'proto': return v.some((x) => r.url.toLowerCase().startsWith(x.toLowerCase() + ':'));
    case 'url_regex': case 'urlpath_regex': { let fl = ''; return v.some((x) => { if (x === '-i') { fl = 'i'; return false; } if (x === '+i') { fl = ''; return false; } const ziel = a.typ === 'url_regex' ? r.url : r.url.replace(/^\w+:\/\/[^/]+/, ''); return new RegExp(x, fl).test(ziel); }); }
    case 'time': { const d = new Date(w.uhr + 3600000); const tage = 'SMTWHFA'; const t0 = v.find((x) => /^[SMTWHFA]+$/.test(x)); const zeit = v.find((x) => /\d/.test(x)); if (t0 && !t0.includes(tage[d.getUTCDay()])) return false; if (zeit) { const [von, bis] = zeit.split('-'); const min = d.getUTCHours() * 60 + d.getUTCMinutes(); const mm = (s: string) => Number(s.split(':')[0]) * 60 + Number(s.split(':')[1]); return min >= mm(von) && min < mm(bis); } return true; }
    case 'proxy_auth': return r.user ? (v.includes('REQUIRED') || v.includes(r.user)) : 'auth';
    case 'browser': return true;
    case 'maxconn': return false;
    default: return false;
  }
}
function ipBereich(ip: string, x: string): boolean {
  if (x === 'all') return true;
  if (!/^[\d.]+$/.test(ip)) return false;
  const z = (s: string) => s.split('.').reduce((a, b) => a * 256 + Number(b), 0);
  if (/^[\d.]+-[\d.]+(\/\d+)?$/.test(x)) { const [lo, hi] = x.replace(/\/\d+$/, '').split('-'); return z(ip) >= z(lo) && z(ip) <= z(hi); }
  if (/^[\d.]+(\/[\d.]+)?$/.test(x)) return ipPasst(ip, x.includes('/') ? x : `${x}/32`);
  return false;
}
function squidAnfrage(w: Welt, a: Anfrage, proxyAuth: { user: string; pw: string } | null, tiefe: number): Antwort {
  const s = st(w); const m = s.squid.modell!;
  const connect = a.methode === 'CONNECT';
  const ziel = connect ? a.pfad : a.pfad;
  const mm = connect ? ziel.match(/^([^:]+):(\d+)$/) : ziel.match(/^(https?|ftp):\/\/([^/:]+)(?::(\d+))?(\/.*)?$/);
  const host = mm ? (connect ? mm[1] : mm[2]) : ''; const port = mm ? Number(connect ? mm[2] : mm[3] ?? (mm[1] === 'https' ? 443 : 80)) : 80;
  const ip = host ? aufloesen(w, host).ip : null;
  // Anmeldung prüfen, wenn eine Regel sie braucht
  let user: string | null = null; let authFehlt = false;
  if (proxyAuth && m.auth.datei) { const e = htLesen(inhalt(w, m.auth.datei)).find((x) => x.user === proxyAuth.user); if (e && htPruefen(e.hash, proxyAuth.pw)) user = proxyAuth.user; else authFehlt = true; }
  const req = { client: a.client, ziel: ip ?? '0.0.0.0', host: host.toLowerCase(), port, methode: a.methode, url: connect ? `${host}:${port}` : ziel, user };
  let erlaubt: boolean | 'auth' = m.regeln.length ? !m.regeln[m.regeln.length - 1].allow : false;
  for (const r of m.regeln) {
    let alle: boolean | 'auth' = true;
    for (const x of r.acls) { const neg = x.startsWith('!'); let t = squidAclPasst(w, m, x.replace(/^!/, ''), req); if (t === 'auth') { alle = 'auth'; break; } if (neg) t = !t; if (!t) { alle = false; break; } }
    if (alle === 'auth') { erlaubt = 'auth'; break; }
    if (alle) { erlaubt = r.allow; break; }
  }
  if (authFehlt && erlaubt === 'auth') erlaubt = 'auth';
  const zeit = `${Math.floor(w.uhr / 1000)}.${String(w.uhr % 1000).padStart(3, '0')}`;
  const log = (code: string, status: number, len: number, hier: string, typ: string) => anhaengen(w, (m.werte.access_log?.[0] ?? '/var/log/squid/access.log').replace(/^daemon:/, ''), `${zeit} ${String(connect ? 31 : code === 'TCP_MEM_HIT' ? 0 : status === 200 || status === 404 ? 87 : 0).padStart(6)} ${a.client} ${code}/${status} ${len} ${a.methode} ${req.url} ${user ?? '-'} ${hier} ${typ}`, 'proxy', 'proxy');
  const fehlerAntwort = (status: number, err: string, extra: [string, string][] = []): Antwort => { const body = `<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01//EN" "http://www.w3.org/TR/html4/strict.dtd">\n<html><head>\n<title>ERROR: The requested URL could not be retrieved</title>\n</head><body id="${err}">\n<div id="titles">\n<h1>ERROR</h1>\n<h2>The requested URL could not be retrieved</h2>\n</div>\n<hr>\n<p>${err === 'ERR_ACCESS_DENIED' ? 'Access control configuration prevents your request from being allowed at this time.' : err === 'ERR_CACHE_ACCESS_DENIED' ? 'Sorry, you are not currently allowed to request ' + req.url + ' from this cache until you have authenticated yourself.' : err === 'ERR_DNS_FAIL' ? 'Unable to determine IP address from host name <q>' + host + '</q>' : 'The system returned: <i>(111) Connection refused</i>'}</p>\n<hr>\n<div id="footer">\n<p>Generated ${httpDatum(w)} by werkstatt (squid/${SQUID_VERSION})</p>\n</div>\n</body></html>\n`; log(status === 407 ? 'TCP_DENIED' : status === 403 ? 'TCP_DENIED' : 'TCP_MISS', status, body.length + 400, 'HIER_NONE/-', 'text/html'); return { status, kopf: [['Server', `squid/${SQUID_VERSION}`], ['Mime-Version', '1.0'], ['Date', httpDatum(w)], ['Content-Type', 'text/html;charset=utf-8'], ['Content-Length', String(body.length)], ['X-Squid-Error', `${err} ${err === 'ERR_CONNECT_FAIL' ? 111 : 0}`], ...extra, ['Vary', 'Accept-Language'], ['Content-Language', 'en'], ['X-Cache', `MISS from werkstatt`], ['Via', `1.1 werkstatt (squid/${SQUID_VERSION})`], ['Connection', 'keep-alive']], body }; };
  if (erlaubt === 'auth') return fehlerAntwort(407, 'ERR_CACHE_ACCESS_DENIED', [['Proxy-Authenticate', `Basic realm="${m.auth.realm}"`]]);
  if (!erlaubt) return fehlerAntwort(403, 'ERR_ACCESS_DENIED');
  if (!ip) return fehlerAntwort(503, 'ERR_DNS_FAIL');
  if (connect) { log('TCP_TUNNEL', 200, 4012, `HIER_DIRECT/${ip}`, '-'); return { status: 200, kopf: [], body: '' }; }
  const schluessel = ziel;
  const r = verbinden(w, { methode: a.methode, host: host + (mm![3] ? ':' + mm![3] : ''), pfad: mm![4] ?? '/', port, tls: mm![1] === 'https', sni: host, client: a.ziel.startsWith('127.') ? '127.0.0.1' : '192.168.1.23', ziel: ip, kopf: { ...a.kopf, via: `1.1 werkstatt (squid/${SQUID_VERSION})`, 'x-forwarded-for': a.client } }, tiefe + 1);
  if ('fehler' in r) return fehlerAntwort(503, 'ERR_CONNECT_FAIL');
  const treffer = a.methode === 'GET' && r.status === 200 && s.squid.cache[schluessel];
  if (a.methode === 'GET' && r.status === 200) s.squid.cache[schluessel] = (s.squid.cache[schluessel] ?? 0) + 1;
  log(treffer ? 'TCP_MEM_HIT' : 'TCP_MISS', r.status, r.body.length + 300, treffer ? 'HIER_NONE/-' : `HIER_DIRECT/${ip}`, (r.kopf.find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? '-').split(';')[0]);
  return { ...r, kopf: [...r.kopf, ['X-Cache', `${treffer ? 'HIT' : 'MISS'} from werkstatt`], ['X-Cache-Lookup', `${treffer ? 'HIT' : 'MISS'} from werkstatt:${m.port}`], ['Via', `1.1 werkstatt (squid/${SQUID_VERSION})`], ['Connection', 'keep-alive']] };
}

// =====================================================================================================
// Verbinden: wer lauscht wo?
// =====================================================================================================
type Ziel = { art: 'apache' | 'nginx' | 'squid' | 'app' | 'extern'; port: number; inst?: number } | null;
const eigen = (w: Welt, ip: string) => ip.startsWith('127.') || ip === '::1' || eigeneIps(ns(w)).includes(ip);
function wer(w: Welt, ip: string, port: number): Ziel {
  const s = st(w);
  if (eigen(w, ip)) {
    if (s.apache.laeuft && s.apache.modell?.listen.some((l) => l.port === port && (l.ip === '*' || l.ip === '0.0.0.0' || l.ip === ip || (l.ip.startsWith('127.') && ip.startsWith('127.'))))) return { art: 'apache', port };
    if (s.nginx.laeuft && s.nginx.modell?.server.some((x) => x.listen.some((l) => l.port === port && (l.ip === '0.0.0.0' || l.ip === '*' || l.ip === '[::]' || l.ip === ip)))) return { art: 'nginx', port };
    if (s.squid.laeuft && s.squid.modell?.port === port) return { art: 'squid', port };
    return null;
  }
  if (['192.168.1.10'].includes(ip)) { const app = s.opt.app; if (app && (port === 8080 || (port === 8081 && app !== 'eine'))) return { art: 'app', port, inst: port === 8080 ? 1 : 2 }; return null; }
  const h = HOSTS.find((x) => x.ip === ip);
  if (h && h.ports.includes(port) && weg(w, ip).art === 'ok') return { art: 'extern', port };
  return null;
}
function verbinden(w: Welt, a: Anfrage, tiefe = 0, proxyAuth: { user: string; pw: string } | null = null): Antwort | { fehler: 'refused' | 'timeout' | 'aufloesen' } {
  if (tiefe > 6) return { status: 508, kopf: [], body: '' };
  const z = wer(w, a.ziel, a.port);
  if (!z) return { fehler: eigen(w, a.ziel) || a.ziel === '192.168.1.10' ? 'refused' : 'timeout' };
  if (z.art === 'apache') return apacheAnfrage(w, a);
  if (z.art === 'nginx') { st(w).anfragen++; return nginxAnfrage(w, a, tiefe); }
  if (z.art === 'squid') return squidAnfrage(w, a, proxyAuth, tiefe);
  if (z.art === 'app') {
    if (a.pfad.startsWith('/api/bestand')) return { status: 200, kopf: [['Server', 'lagerist-web/1.4'], ['Date', httpDatum(w)], ['Content-Type', 'application/json']], body: `{"instanz": "srv1:${a.port}", "artikel": 1200, "lager": "Halle 2"}\n` };
    return { status: 200, kopf: [['Server', 'lagerist-web/1.4'], ['Date', httpDatum(w)], ['Content-Type', 'text/html; charset=utf-8']], body: `<!doctype html>\n<title>lagerist-web</title>\n<h1>Lagerbestand</h1>\n<p>Instanz: srv1:${a.port}</p>\n<p>Host: ${a.kopf.host ?? '-'}</p>\n<p>Client: ${a.client}</p>\n<p>X-Real-IP: ${a.kopf['x-real-ip'] ?? '-'}</p>\n<p>X-Forwarded-For: ${a.kopf['x-forwarded-for'] ?? '-'}</p>\n` };
  }
  // erfundenes Internet
  const ext = a.ziel === '203.0.113.80' ? `<!doctype html>\n<html>\n<head>\n    <title>Example Domain</title>\n</head>\n<body>\n<div>\n    <h1>Example Domain</h1>\n    <p>This domain is for use in illustrative examples in documents.</p>\n</div>\n</body>\n</html>\n` : `<html><body><h1>${HOSTS.find((x) => x.ip === a.ziel)?.name ?? a.ziel}</h1></body></html>\n`;
  return { status: a.pfad === '/' || a.pfad.startsWith('/index') ? 200 : 404, kopf: [['Date', httpDatum(w)], ['Server', 'ECS (nyb/1D2E)'], ['Content-Type', 'text/html; charset=UTF-8'], ['Content-Length', String(ext.length)], ['Cache-Control', 'max-age=604800']], body: a.pfad === '/' || a.pfad.startsWith('/index') ? ext : '' };
}
/** TLS-Gegenstelle für curl und openssl s_client. */
function tlsVon(w: Welt, ip: string, port: number, sni: string | null) {
  const z = wer(w, ip, port);
  if (!z) return null;
  if (z.art === 'apache') return apacheTls(w, st(w).apache.modell!, ip, port, sni);
  if (z.art === 'nginx') return nginxTls(w, st(w).nginx.modell!, port, sni);
  if (z.art === 'extern' && port === 443) { const ca = oeffentlicheCa(); const k = { art: 'key' as const, id: 'e0e1e2e3e4e5e6e7', bits: 2048, alg: 'RSA' as const }; return { kette: [{ ...ausstellen(w, { CN: 'www.example.org' }, ['DNS:www.example.org', 'DNS:example.org'], k, ca.zwischen, ca.zwischenKey, 90, Date.UTC(2026, 9, 1)), serial: '04A1B2C3D4E5F60718293A4B5C6D7E8F9A0B' }, ca.zwischen], protokolle: ['TLSv1.2', 'TLSv1.3'], bits: 2048 }; }
  return { fehler: 'wrong version number' };
}

// =====================================================================================================
// curl
// =====================================================================================================
function curl(w: Welt, a: string[], root: boolean): Ergebnis {
  if (!webAktiv(w)) return fehler('bash: curl: Befehl nicht gefunden', 127);
  if (a.includes('--version') || a.includes('-V')) return ok(`curl ${CURL_VERSION} (x86_64-pc-linux-gnu) libcurl/${CURL_VERSION} OpenSSL/3.0.17 zlib/1.2.13 brotli/1.0.9 zstd/1.5.4 libidn2/2.3.3 libpsl/0.21.2 (+libidn2/2.3.3) libssh2/1.10.0 nghttp2/1.52.0 librtmp/2.3 OpenLDAP/2.5.13\nRelease-Date: 2023-02-20, security patched: ${CURL_VERSION}-10+deb12u14\nProtocols: dict file ftp ftps gopher gophers http https imap imaps ldap ldaps mqtt pop3 pop3s rtmp rtsp scp sftp smb smbs smtp smtps telnet tftp\nFeatures: alt-svc AsynchDNS brotli GSS-API HSTS HTTP2 HTTPS-proxy IDN IPv6 Kerberos Largefile libz NTLM NTLM_WB PSL SPNEGO SSL threadsafe TLS-SRP UnixSockets zstd`);
  const o = { s: false, S: false, i: false, I: false, v: false, k: false, L: false, f: false, o: '', w: '', X: '', H: [] as string[], u: '', U: '', x: '', cacert: '', resolve: [] as string[], tlsMin: '', tlsMax: '', d: '', url: '', A: '', noproxy: '' };
  const kurz: Record<string, keyof typeof o> = { o: 'o', w: 'w', X: 'X', H: 'H', u: 'u', U: 'U', x: 'x', d: 'd', A: 'A' };
  const lang: Record<string, keyof typeof o> = { '--output': 'o', '--write-out': 'w', '--request': 'X', '--header': 'H', '--user': 'u', '--proxy-user': 'U', '--proxy': 'x', '--cacert': 'cacert', '--resolve': 'resolve', '--tls-max': 'tlsMax', '--data': 'd', '--user-agent': 'A', '--noproxy': 'noproxy' };
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    if (lang[x]) { const k = lang[x]; const v = a[++i] ?? ''; if (Array.isArray(o[k])) (o[k] as string[]).push(v); else (o as Record<string, unknown>)[k] = v; continue; }
    if (/^--tlsv1(\.[0-3])?$/.test(x)) { o.tlsMin = x.slice(2).replace('tlsv1', 'TLSv1'); continue; }
    if (x === '--insecure') { o.k = true; continue; } if (x === '--silent') { o.s = true; continue; } if (x === '--show-error') { o.S = true; continue; } if (x === '--include') { o.i = true; continue; } if (x === '--head') { o.I = true; continue; } if (x === '--verbose') { o.v = true; continue; } if (x === '--location') { o.L = true; continue; } if (x === '--fail') { o.f = true; continue; }
    if (x.startsWith('--')) { if (['--compressed', '--http1.1', '--ipv4', '--max-time', '--connect-timeout', '--retry'].includes(x)) { if (['--max-time', '--connect-timeout', '--retry'].includes(x)) i++; continue; } return fehler(`curl: option ${x}: is unknown\ncurl: try 'curl --help' or 'curl --manual' for more information`, 2); }
    if (x.startsWith('-') && x.length > 1) {
      for (let j = 1; j < x.length; j++) {
        const c = x[j];
        if (kurz[c]) { const v = x.slice(j + 1) || a[++i] || ''; const k = kurz[c]; if (Array.isArray(o[k])) (o[k] as string[]).push(v); else (o as Record<string, unknown>)[k] = v; break; }
        if ('sSiIvkLf'.includes(c)) { (o as Record<string, unknown>)[c] = true; continue; }
        if ('4'.includes(c) || c === '#') continue;
        return fehler(`curl: option -${c}: is unknown\ncurl: try 'curl --help' or 'curl --manual' for more information`, 2);
      }
      continue;
    }
    o.url = x;
  }
  if (!o.url) return fehler("curl: try 'curl --help' or 'curl --manual' for more information", 2);
  if (o.u && !o.u.includes(':')) {
    const user = o.u;
    K.dialog(w, `Enter host password for user '${user}':`, (pw) => { const r = curl(w, [...a.filter((y, i) => !(y === '-u' || y === '--user' || a[i - 1] === '-u' || a[i - 1] === '--user')), '-u', `${user}:${pw}`], root); return [r.out, r.err].filter(Boolean).join('\n'); });
    return ok();
  }
  const fehlerAus = (code: number, text: string): Ergebnis => ({ out: '', err: o.s && !o.S ? undefined : `curl: (${code}) ${text}`, code });
  let url = o.url.includes('://') ? o.url : `http://${o.url}`;
  const verbose: string[] = [];
  const ausgabe: string[] = [];
  let letzte: Antwort | null = null;
  for (let sprung = 0; sprung < 20; sprung++) {
    const mm = url.match(/^(https?):\/\/(?:([^@/]+)@)?(\[[^\]]+\]|[^/:?#]+)(?::(\d+))?([^#]*)/);
    if (!mm) return fehlerAus(3, `URL rejected: Malformed input to a URL function`);
    const [, schema, ui, host0, port0, rest] = mm; const host = host0.replace(/^\[|\]$/g, '');
    const port = Number(port0 ?? (schema === 'https' ? 443 : 80)); const pfad = rest || '/';
    const auth = o.u ? { user: o.u.split(':')[0], pw: o.u.slice(o.u.indexOf(':') + 1) } : ui ? { user: decodeURIComponent(ui.split(':')[0]), pw: decodeURIComponent(ui.split(':')[1] ?? '') } : undefined;
    const kopf: Record<string, string> = { host: port0 ? `${host}:${port}` : host, 'user-agent': o.A || `curl/${CURL_VERSION}`, accept: '*/*' };
    for (const h of o.H) { const i = h.indexOf(':'); if (i > 0) kopf[h.slice(0, i).trim().toLowerCase()] = h.slice(i + 1).trim(); }
    const methode = o.X || (o.I ? 'HEAD' : o.d ? 'POST' : 'GET');
    // Proxy aus -x oder der Umgebung
    const proxyRoh = o.x || (schema === 'https' ? w.env.https_proxy ?? w.env.HTTPS_PROXY : w.env.http_proxy) || '';
    const ohneProxy = (o.noproxy || w.env.no_proxy || '').split(',').some((x) => x.trim() === '*' || (x.trim() && host.endsWith(x.trim())));
    let proxy = proxyRoh && !ohneProxy ? proxyRoh.replace(/^https?:\/\//, '').replace(/\/$/, '') : '';
    let proxyUi = ''; if (proxy.includes('@')) { proxyUi = decodeURIComponent(proxy.slice(0, proxy.lastIndexOf('@'))); proxy = proxy.slice(proxy.lastIndexOf('@') + 1); }
    const zielName = proxy ? proxy.split(':')[0] : host;
    const zielPort = proxy ? Number(proxy.split(':')[1] ?? 1080) : port;
    const fest = o.resolve.map((r) => r.split(':')).find((r) => r[0] === zielName && Number(r[1]) === zielPort);
    const ip = fest ? fest[2] : zielName === 'localhost' ? '127.0.0.1' : aufloesen(w, zielName).ip;
    if (!ip) return fehlerAus(proxy ? 5 : 6, proxy ? `Could not resolve proxy: ${zielName}` : `Could not resolve host: ${zielName}`);
    verbose.push(`*   Trying ${ip}:${zielPort}...`);
    const anzeigeName = zielName;
    const client = ip.startsWith('127.') ? '127.0.0.1' : eigen(w, ip) ? ip : '192.168.1.23';
    const zielWer = wer(w, ip, zielPort);
    if (!zielWer) { const t = eigen(w, ip) || ip === '192.168.1.10'; return fehlerAus(t ? 7 : 28, t ? `Failed to connect to ${anzeigeName} port ${zielPort} after 0 ms: Couldn't connect to server` : `Failed to connect to ${anzeigeName} port ${zielPort} after 130232 ms: Couldn't connect to server`); }
    verbose.push(`* Connected to ${anzeigeName} (${ip}) port ${zielPort} (#0)`);
    let r: Antwort | { fehler: string };
    if (proxy) {
      if (zielWer.art !== 'squid') return fehlerAus(56, `Proxy CONNECT aborted`);
      const pu = o.U || proxyUi; const pAuth = pu ? { user: pu.split(':')[0], pw: pu.slice(pu.indexOf(':') + 1) } : null;
      if (schema === 'https') {
        const c = squidAnfrage(w, { methode: 'CONNECT', host: `${host}:${port}`, pfad: `${host}:${port}`, port: zielPort, tls: false, sni: null, client, ziel: ip, kopf }, pAuth, 0);
        if (c.status !== 200) { if (o.v) verbose.push(`> CONNECT ${host}:${port} HTTP/1.1`, `< HTTP/1.1 ${c.status} ${TEXTE[c.status]}`); return { out: '', err: [o.v ? verbose.join('\n') : '', o.s && !o.S ? '' : `curl: (56) CONNECT tunnel failed, response ${c.status}`].filter(Boolean).join('\n') || undefined, code: 56 }; }
        const hip = aufloesen(w, host).ip ?? '';
        const t = tlsPruefen(w, hip, port, host, o, verbose); if ('code' in t) return { ...t, err: o.s && !o.S ? undefined : t.err };
        r = verbinden(w, { methode, host: kopf.host, pfad, port, tls: true, sni: host, client: '192.168.1.23', ziel: hip, kopf, auth }, 0);
      } else r = squidAnfrage(w, { methode, host: kopf.host, pfad: url, port: zielPort, tls: false, sni: null, client, ziel: ip, kopf, auth }, pAuth, 0);
    } else {
      if (schema === 'https') {
        const t = tlsPruefen(w, ip, port, host, o, verbose); if ('code' in t) return { ...t, err: o.s && !o.S ? undefined : [o.v ? verbose.join('\n') : '', t.err].filter(Boolean).join('\n') };
      }
      r = verbinden(w, { methode, host: kopf.host, pfad, port, tls: schema === 'https', sni: schema === 'https' && !/^[\d.]+$/.test(host) ? host : null, client, ziel: ip, kopf, auth }, 0);
    }
    if ('fehler' in r) return fehlerAus(7, `Failed to connect to ${anzeigeName} port ${zielPort} after 0 ms: Couldn't connect to server`);
    letzte = r;
    const kopfText = `HTTP/1.1 ${r.status} ${TEXTE[r.status] ?? ''}\n${r.kopf.map(([k, v]) => `${k}: ${v}`).join('\n')}\n`;
    if (o.v) verbose.push(`> ${methode} ${proxy && schema === 'http' ? url : pfad} HTTP/1.1`, ...Object.entries(kopf).map(([k, v]) => `> ${k === 'host' ? 'Host' : k === 'user-agent' ? 'User-Agent' : k === 'accept' ? 'Accept' : k}: ${v}`), '> ', ...kopfText.trimEnd().split('\n').map((z) => `< ${z}`), '< ');
    if (o.i || o.I) ausgabe.push(kopfText.replace(/\n/g, '\r\n') + '\r\n');
    const loc = r.kopf.find(([k]) => k.toLowerCase() === 'location')?.[1];
    if (o.L && loc && [301, 302, 303, 307, 308].includes(r.status)) { url = loc.startsWith('http') ? loc : `${schema}://${host}${port0 ? ':' + port : ''}${loc}`; if (!o.I) ausgabe.splice(0); continue; }
    if (!o.I) ausgabe.push(r.body);
    break;
  }
  if (!letzte) return fehlerAus(47, 'Maximum (50) redirects followed');
  if (o.f && letzte.status >= 400) return { out: '', err: o.s && !o.S ? undefined : `curl: (22) The requested URL returned error: ${letzte.status}`, code: 22 };
  let out = ausgabe.join('');
  if (o.o && o.o !== '-') { const e = K.schreiben(w, K.pfad(w, o.o), out.replace(/\n$/, ''), false, root); if (e) return fehlerAus(23, `Failure writing output to destination`); out = ''; }
  if (o.w) out += o.w.replace(/%\{http_code\}|%\{response_code\}/g, String(letzte.status).padStart(3, '0')).replace(/%\{size_download\}/g, String(letzte.body.length)).replace(/%\{content_type\}/g, letzte.kopf.find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? '').replace(/%\{redirect_url\}/g, letzte.kopf.find(([k]) => k.toLowerCase() === 'location')?.[1] ?? '').replace(/%\{url_effective\}/g, url).replace(/\\n/g, '\n');
  return { out: out.replace(/\r\n/g, '\n').replace(/\n$/, ''), err: o.v ? verbose.join('\n') : undefined, code: 0 };
}
function tlsPruefen(w: Welt, ip: string, port: number, host: string, o?: { k: boolean; cacert: string; tlsMin: string; tlsMax: string }, verbose?: string[]): { ok: true } | Ergebnis {
  const t = tlsVon(w, ip, port, /^[\d.]+$/.test(host) ? null : host);
  if (!t) return fehler(`curl: (7) Failed to connect to ${host} port ${port} after 0 ms: Couldn't connect to server`, 7);
  if ('fehler' in t) return fehler(`curl: (35) OpenSSL/3.0.17: error:0A00010B:SSL routines::wrong version number`, 35);
  const stufen = ['TLSv1', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3'];
  const min = stufen.indexOf(o?.tlsMin || 'TLSv1.2'); const max = o?.tlsMax ? stufen.indexOf(o.tlsMax.replace(/^1/, 'TLSv1').replace('TLSv1.0', 'TLSv1')) : 3;
  const erlaubt = stufen.filter((_, i) => i >= Math.max(min, 2) && i <= max);
  if (!erlaubt.length) return fehler(`curl: (35) OpenSSL/3.0.17: error:0A0000BF:SSL routines::no protocols available`, 35);
  const proto = [...erlaubt].reverse().find((p) => t.protokolle.includes(p));
  if (!proto) return fehler(`curl: (35) OpenSSL/3.0.17: error:0A00042E:SSL routines::tlsv1 alert protocol version`, 35);
  const leaf = t.kette[0];
  if (verbose) verbose.push('* ALPN: offers h2,http/1.1', `* SSL connection using ${proto} / ${proto === 'TLSv1.3' ? 'TLS_AES_256_GCM_SHA384' : 'ECDHE-RSA-AES256-GCM-SHA384'}`, '* Server certificate:', `*  subject: ${nameText(leaf.subj).replace(/ = /g, '=').replace(/, /g, '; ')}`, `*  start date: ${gmt(leaf.nb)}`, `*  expire date: ${gmt(leaf.na)}`, `*  issuer: ${nameText(leaf.iss).replace(/ = /g, '=').replace(/, /g, '; ')}`);
  if (o?.k) { verbose?.push('*  SSL certificate verify result: (übersprungen mit -k)'); return { ok: true }; }
  let extra: string | undefined;
  if (o?.cacert) { const c = inhalt(w, K.pfad(w, o.cacert)); if (c === null) return fehler(`curl: (77) error setting certificate file: ${o.cacert}`, 77); extra = c; }
  const p = pruefen(w, leaf, t.kette.slice(1), o?.cacert ? zertifikate(extra) : vertrauteWurzeln(w));
  const hinweis = '\nMore details here: https://curl.se/docs/sslcerts.html\n\ncurl failed to verify the legitimacy of the server and therefore could not\nestablish a secure connection to it. To learn more about this situation and\nhow to fix it, please visit the web page mentioned above.';
  if (!p.ok) return fehler(`curl: (60) SSL certificate problem: ${p.text}${hinweis}`, 60);
  const np = namePasst(leaf, host);
  if (np === 'san') return fehler(`curl: (60) SSL: no alternative certificate subject name matches target host name '${host}'${hinweis}`, 60);
  if (np === 'cn') return fehler(`curl: (60) SSL: certificate subject name '${leaf.subj.CN ?? ''}' does not match target host name '${host}'${hinweis}`, 60);
  verbose?.push('*  SSL certificate verify ok.');
  return { ok: true };
}
tlsServerQuelle((w, host, port, sni) => { if (!webAktiv(w)) return null; const ip = host === 'localhost' ? '127.0.0.1' : aufloesen(w, host).ip; return ip ? tlsVon(w, ip, port, sni) : null; });

// =====================================================================================================
// Installation und Startzustand
// =====================================================================================================
const DEB_APACHE2_CONF = `# This is the main Apache server configuration file.  It contains the
# configuration directives that give the server its instructions.
# See http://httpd.apache.org/docs/2.4/ for detailed information about
# the directives and /usr/share/doc/apache2/README.Debian about Debian specific
# hints.
#
# Summary of how the Apache 2 configuration works in Debian:
#
#	/etc/apache2/
#	|-- apache2.conf
#	|	\`--  ports.conf
#	|-- mods-enabled
#	|	|-- *.load
#	|	\`-- *.conf
#	|-- conf-enabled
#	|	\`-- *.conf
#	\`-- sites-enabled
#		\`-- *.conf

DefaultRuntimeDir \${APACHE_RUN_DIR}
PidFile \${APACHE_PID_FILE}
Timeout 300
KeepAlive On
MaxKeepAliveRequests 100
KeepAliveTimeout 5

# These need to be set in /etc/apache2/envvars
User \${APACHE_RUN_USER}
Group \${APACHE_RUN_GROUP}

HostnameLookups Off
ErrorLog \${APACHE_LOG_DIR}/error.log
LogLevel warn

# Include module configuration:
IncludeOptional mods-enabled/*.load
IncludeOptional mods-enabled/*.conf

# Include list of ports to listen on
Include ports.conf

<Directory />
	Options FollowSymLinks
	AllowOverride None
	Require all denied
</Directory>

<Directory /usr/share>
	AllowOverride None
	Require all granted
</Directory>

<Directory /var/www/>
	Options Indexes FollowSymLinks
	AllowOverride None
	Require all granted
</Directory>

AccessFileName .htaccess

<FilesMatch "^\\.ht">
	Require all denied
</FilesMatch>

LogFormat "%v:%p %h %l %u %t \\"%r\\" %>s %O \\"%{Referer}i\\" \\"%{User-Agent}i\\"" vhost_combined
LogFormat "%h %l %u %t \\"%r\\" %>s %O \\"%{Referer}i\\" \\"%{User-Agent}i\\"" combined
LogFormat "%h %l %u %t \\"%r\\" %>s %O" common
LogFormat "%{Referer}i -> %U" referer
LogFormat "%{User-agent}i" agent

# Include of directories ignores editors' and dpkg's backup files,
# see README.Debian for details.

# Include generic snippets of statements
IncludeOptional conf-enabled/*.conf

# Include the virtual host configurations:
IncludeOptional sites-enabled/*.conf
`;
const DEB_PORTS = `# If you just change the port or add more ports here, you will likely also
# have to change the VirtualHost statement in
# /etc/apache2/sites-enabled/000-default.conf

Listen 80

<IfModule ssl_module>
	Listen 443
</IfModule>

<IfModule mod_gnutls.c>
	Listen 443
</IfModule>
`;
const DEB_ENVVARS = `# envvars - default environment variables for apache2ctl

# this won't be correct after changing uid
unset HOME

# for supporting multiple apache2 instances
if [ "\${APACHE_CONFDIR##/etc/apache2-}" != "\${APACHE_CONFDIR}" ] ; then
	SUFFIX="-\${APACHE_CONFDIR##/etc/apache2-}"
else
	SUFFIX=
fi

# Since there is no sane way to get the parsed apache2 config in scripts, some
# settings are defined via environment variables and then used in apache2ctl,
# /etc/init.d/apache2, /etc/logrotate.d/apache2, etc.
export APACHE_RUN_USER=www-data
export APACHE_RUN_GROUP=www-data
# temporary state file location. This might be changed to /run in Wheezy+1
export APACHE_PID_FILE=/var/run/apache2$SUFFIX/apache2.pid
export APACHE_RUN_DIR=/var/run/apache2$SUFFIX
export APACHE_LOCK_DIR=/var/lock/apache2$SUFFIX
# Only /var/log/apache2 is handled by /etc/logrotate.d/apache2.
export APACHE_LOG_DIR=/var/log/apache2$SUFFIX

## The locale used by some modules like mod_dav
export LANG=C
## Uncomment the following line to use the system default locale instead:
#. /etc/default/locale

export LANG
`;
const DEB_DEFAULT_SITE = `<VirtualHost *:80>
	# The ServerName directive sets the request scheme, hostname and port that
	# the server uses to identify itself. This is used when creating
	# redirection URLs. In the context of virtual hosts, the ServerName
	# specifies what hostname must appear in the request's Host: header to
	# match this virtual host. For the default virtual host (this file) this
	# value is not decisive as it is used as a last resort host regardless.
	# However, you must set it for any further virtual host explicitly.
	#ServerName www.example.com

	ServerAdmin webmaster@localhost
	DocumentRoot /var/www/html

	# Available loglevels: trace8, ..., trace1, debug, info, notice, warn,
	# error, crit, alert, emerg.
	# It is also possible to configure the loglevel for particular
	# modules, e.g.
	#LogLevel info ssl:warn

	ErrorLog \${APACHE_LOG_DIR}/error.log
	CustomLog \${APACHE_LOG_DIR}/access.log combined

	# For most configuration files from conf-available/, which are
	# enabled or disabled at a global level, it is possible to
	# include a line for only one particular virtual host. For example the
	# following line enables the CGI configuration for this host only
	# after it has been globally disabled with "a2disconf".
	#Include conf-available/serve-cgi-bin.conf
</VirtualHost>
`;
const DEB_DEFAULT_SSL = `<VirtualHost *:443>
	ServerAdmin webmaster@localhost

	DocumentRoot /var/www/html

	# Available loglevels: trace8, ..., trace1, debug, info, notice, warn,
	# error, crit, alert, emerg.
	# It is also possible to configure the loglevel for particular
	# modules, e.g.
	#LogLevel info ssl:warn

	ErrorLog \${APACHE_LOG_DIR}/error.log
	CustomLog \${APACHE_LOG_DIR}/access.log combined

	#   SSL Engine Switch:
	#   Enable/Disable SSL for this virtual host.
	SSLEngine on

	#   A self-signed (snakeoil) certificate can be created by installing
	#   the ssl-cert package. See
	#   /usr/share/doc/apache2/README.Debian.gz for more info.
	#   If both key and certificate are stored in the same file, only the
	#   SSLCertificateFile directive is needed.
	SSLCertificateFile      /etc/ssl/certs/ssl-cert-snakeoil.pem
	SSLCertificateKeyFile   /etc/ssl/private/ssl-cert-snakeoil.key

	#   Server Certificate Chain:
	#   Point SSLCertificateChainFile at a file containing the
	#   concatenation of PEM encoded CA certificates which form the
	#   certificate chain for the server certificate. Alternatively
	#   the referenced file can be the same as SSLCertificateFile
	#   when the CA certificates are directly appended to the server
	#   certificate for convinience.
	#SSLCertificateChainFile /etc/apache2/ssl.crt/server-ca.crt

	<FilesMatch "\\.(?:cgi|shtml|phtml|php)$">
		SSLOptions +StdEnvVars
	</FilesMatch>
	<Directory /usr/lib/cgi-bin>
		SSLOptions +StdEnvVars
	</Directory>
</VirtualHost>
`;
const DEB_SECURITY = `#
# Disable access to the entire file system except for the directories that
# are explicitly allowed later.
#
# This currently breaks the configurations that come with some web application
# Debian packages.
#
#<Directory />
#   AllowOverride None
#   Require all denied
#</Directory>

# Changing the following options will not really affect the security of the
# server, but might make attacks slightly more difficult in some cases.

#
# ServerTokens
# This directive configures what you return as the Server HTTP response
# Header. The default is 'Full' which sends information about the OS-Type
# and compiled in modules.
# Set to one of:  Full | OS | Minimal | Minor | Major | Prod
# where Full conveys the most information, and Prod the least.
#ServerTokens Minimal
ServerTokens OS
#ServerTokens Full

#
# Optionally add a line containing the server version and virtual host
# name to server-generated pages (internal error documents, FTP directory
# listings, mod_status and mod_info output etc., but not CGI generated
# documents or custom error documents).
# Set to "EMail" to also include a mailto: link to the ServerAdmin.
# Set to one of:  On | Off | EMail
#ServerSignature Off
ServerSignature On

#
# Allow TRACE method
#
# Set to "extended" to also reflect the request body (only for testing and
# diagnostic purposes).
#
# Set to one of:  On | Off | extended
TraceEnable Off
#TraceEnable On
`;
// Module, Abhängigkeiten und ihre .conf-Dateien (gekürzt auf das, was der Kurs braucht)
const DEB_MODULE: Record<string, { conf?: string; dep?: string[]; konflikt?: string[] }> = {
  access_compat: {}, actions: {}, alias: { conf: '<IfModule alias_module>\n\tAlias /icons/ "/usr/share/apache2/icons/"\n\n\t<Directory "/usr/share/apache2/icons">\n\t\tOptions FollowSymlinks\n\t\tAllowOverride None\n\t\tRequire all granted\n\t</Directory>\n</IfModule>\n' },
  auth_basic: { dep: ['authn_core'] }, authn_core: {}, authn_file: {}, authz_core: {}, authz_host: { dep: ['authz_core'] }, authz_user: {}, authz_groupfile: { dep: ['authz_core'] },
  autoindex: { conf: '<IfModule mod_autoindex.c>\n\tIndexOptions FancyIndexing VersionSort HTMLTable NameWidth=* DescriptionWidth=* Charset=UTF-8\n\tIndexIgnore .??* *~ *# RCS CVS *,v *,t\n</IfModule>\n' },
  deflate: { conf: '<IfModule mod_deflate.c>\n\t<IfModule mod_filter.c>\n\t\tAddOutputFilterByType DEFLATE text/html text/plain text/xml text/css text/javascript\n\t</IfModule>\n</IfModule>\n', dep: ['filter'] },
  dir: { conf: '<IfModule mod_dir.c>\n\tDirectoryIndex index.html index.cgi index.pl index.php index.xhtml index.htm\n</IfModule>\n' },
  env: {}, filter: {}, headers: {}, mime: { conf: '<IfModule mod_mime.c>\n\tTypesConfig /etc/mime.types\n\tAddType application/x-compress .Z\n\tAddType application/x-gzip .gz .tgz\n</IfModule>\n' },
  mpm_event: { conf: '# event MPM\n# StartServers: initial number of server processes to start\n# MinSpareThreads: minimum number of worker threads which are kept spare\n# MaxSpareThreads: maximum number of worker threads which are kept spare\n# ThreadsPerChild: constant number of worker threads in each server process\n# MaxRequestWorkers: maximum number of worker threads\n# MaxConnectionsPerChild: maximum number of requests a server process serves\n<IfModule mpm_event_module>\n\tStartServers\t\t\t 2\n\tMinSpareThreads\t\t 25\n\tMaxSpareThreads\t\t 75\n\tThreadLimit\t\t\t 64\n\tThreadsPerChild\t\t 25\n\tMaxRequestWorkers\t  150\n\tMaxConnectionsPerChild   0\n</IfModule>\n', konflikt: ['mpm_prefork', 'mpm_worker'] },
  mpm_prefork: { conf: '# prefork MPM\n# StartServers: number of server processes to start\n# MinSpareServers: minimum number of server processes which are kept spare\n# MaxSpareServers: maximum number of server processes which are kept spare\n# MaxRequestWorkers: maximum number of server processes allowed to start\n# MaxConnectionsPerChild: maximum number of requests a server process serves\n\n<IfModule mpm_prefork_module>\n\tStartServers\t\t\t 5\n\tMinSpareServers\t\t  5\n\tMaxSpareServers\t\t 10\n\tMaxRequestWorkers\t  150\n\tMaxConnectionsPerChild   0\n</IfModule>\n', konflikt: ['mpm_event', 'mpm_worker'] },
  mpm_worker: { konflikt: ['mpm_event', 'mpm_prefork'] },
  negotiation: { conf: '<IfModule mod_negotiation.c>\n\tLanguagePriority en ca cs da de el eo es et fr he hr it ja ko ltz nl nn no pl pt pt-BR ru sv tr zh-CN zh-TW\n\tForceLanguagePriority Prefer Fallback\n</IfModule>\n' },
  reqtimeout: { conf: '<IfModule reqtimeout_module>\n\tRequestReadTimeout header=20-40,minrate=500\n\tRequestReadTimeout body=10,minrate=500\n</IfModule>\n' },
  setenvif: { conf: '<IfModule mod_setenvif.c>\n\tBrowserMatch "Mozilla/2" nokeepalive\n</IfModule>\n' },
  status: { conf: '<IfModule mod_status.c>\n\t# Allow server status reports generated by mod_status,\n\t# with the URL of http://servername/server-status\n\t# Uncomment and change the "192.0.2.0/24" to allow access from other hosts.\n\n\t<Location /server-status>\n\t\tSetHandler server-status\n\t\tRequire local\n\t\t#Require ip 192.0.2.0/24\n\t</Location>\n\n\t# Keep track of extended status information for each request\n\tExtendedStatus On\n\n\t# Determine if mod_status displays the first 63 characters of a request or\n\t# the last 63, assuming the request itself is greater than 63 chars.\n\t# Default: Off\n\t#SeeRequestTail On\n\n\n\t<IfModule mod_proxy.c>\n\t\t# Show Proxy LoadBalancer status in mod_status\n\t\tProxyStatus On\n\t</IfModule>\n\n\n</IfModule>\n' },
  socache_shmcb: {}, ssl: { dep: ['mime', 'socache_shmcb'], conf: '<IfModule mod_ssl.c>\n\n\t# Pseudo Random Number Generator (PRNG):\n\tSSLRandomSeed startup builtin\n\tSSLRandomSeed startup file:/dev/urandom 512\n\tSSLRandomSeed connect builtin\n\tSSLRandomSeed connect file:/dev/urandom 512\n\n\tAddType application/x-x509-ca-cert .crt\n\tAddType application/x-pkcs7-crl\t.crl\n\n\tSSLPassPhraseDialog  exec:/usr/share/apache2/ask-for-passphrase\n\n\tSSLSessionCache\t\tshmcb:${APACHE_RUN_DIR}/ssl_scache(512000)\n\tSSLSessionCacheTimeout  300\n\n\t#   SSL Cipher Suite:\n\t#   List the ciphers that the client is permitted to negotiate. See the\n\t#   ciphers(1) man page from the openssl package for list of all available\n\t#   options.\n\tSSLCipherSuite HIGH:!aNULL\n\n\t#   The protocols to enable.\n\t#   Available values: all, SSLv3, TLSv1, TLSv1.1, TLSv1.2\n\t#   SSL v2  is no longer supported\n\tSSLProtocol all -SSLv3\n\n\tSSLSessionTickets off\n</IfModule>\n' },
  rewrite: {}, proxy: {}, proxy_http: { dep: ['proxy'] }, proxy_fcgi: { dep: ['proxy'] }, userdir: { conf: '<IfModule mod_userdir.c>\n\tUserDir public_html\n\tUserDir disabled root\n\n\t<Directory /home/*/public_html>\n\t\tAllowOverride FileInfo AuthConfig Limit Indexes\n\t\tOptions MultiViews Indexes SymLinksIfOwnerMatch IncludesNoExec\n\t\tRequire method GET POST OPTIONS\n\t</Directory>\n</IfModule>\n' },
  expires: {}, cgi: {}, info: {}, 'php8.2': { dep: ['mpm_prefork'], konflikt: ['mpm_event', 'mpm_worker'], conf: '<FilesMatch ".+\\.ph(?:ar|p|tml)$">\n    SetHandler application/x-httpd-php\n</FilesMatch>\n<FilesMatch ".+\\.phps$">\n    SetHandler application/x-httpd-php-source\n    Require all denied\n</FilesMatch>\n<FilesMatch "^\\.ph(?:ar|p|ps|tml)$">\n    Require all denied\n</FilesMatch>\n<IfModule mod_userdir.c>\n    <Directory /home/*/public_html>\n        php_admin_flag engine Off\n    </Directory>\n</IfModule>\n' },
  perl: {},
};
const DEB_STANDARD_MODS = ['access_compat', 'alias', 'auth_basic', 'authn_core', 'authn_file', 'authz_core', 'authz_host', 'authz_user', 'autoindex', 'deflate', 'dir', 'env', 'filter', 'mime', 'mpm_event', 'negotiation', 'reqtimeout', 'setenvif', 'status'];
const modDatei = (m: string) => (m === 'php8.2' ? 'libphp8.2.so' : `mod_${m}.so`);
const modLoad = (m: string) => `# Depends: ${(DEB_MODULE[m]?.dep ?? []).join(' ')}\nLoadModule ${m === 'php8.2' ? 'php' : m}_module /usr/lib/apache2/modules/${modDatei(m)}\n`.replace('# Depends: \n', '');
function snakeoil(w: Welt) {
  const k = neuerSchluessel(w); const z = ausstellen(w, { CN: w.host }, [`DNS:${w.host}`], k, null, k, 3650);
  datei(w, '/etc/ssl/certs/ssl-cert-snakeoil.pem', pem(z)); datei(w, '/etc/ssl/private/ssl-cert-snakeoil.key', pem(k), 0o640, 'root', 'ssl-cert');
}
function apacheInstallieren(w: Welt) {
  const s = st(w); if (s.apache.installiert) return; s.apache.installiert = true;
  if (rh(w)) return httpdInstallieren(w);
  datei(w, '/etc/apache2/apache2.conf', DEB_APACHE2_CONF); datei(w, '/etc/apache2/ports.conf', DEB_PORTS); datei(w, '/etc/apache2/envvars', DEB_ENVVARS);
  datei(w, '/etc/apache2/magic', '# Magic data for mod_mime_magic\n');
  for (const d of ['mods-available', 'mods-enabled', 'conf-available', 'conf-enabled', 'sites-available', 'sites-enabled']) ordner(w, `/etc/apache2/${d}`);
  for (const [n, v] of Object.entries(DEB_MODULE)) { if (n === 'php8.2' || n === 'perl') continue; datei(w, `/etc/apache2/mods-available/${n}.load`, modLoad(n)); if (v.conf) datei(w, `/etc/apache2/mods-available/${n}.conf`, v.conf); datei(w, `/usr/lib/apache2/modules/${modDatei(n)}`, '\u0007BIN:' + (20000 + n.length * 1000), 0o644); }
  for (const n of DEB_STANDARD_MODS) { link(w, `/etc/apache2/mods-enabled/${n}.load`, `../mods-available/${n}.load`); if (DEB_MODULE[n].conf) link(w, `/etc/apache2/mods-enabled/${n}.conf`, `../mods-available/${n}.conf`); }
  datei(w, '/etc/apache2/conf-available/security.conf', DEB_SECURITY);
  datei(w, '/etc/apache2/conf-available/charset.conf', '# Read the documentation before enabling AddDefaultCharset.\n# In general, it is only a good idea if you know that all your files\n# have this encoding. It will override any encoding given in the files\n# in meta http-equiv or xml encoding tags.\n\n#AddDefaultCharset UTF-8\n');
  datei(w, '/etc/apache2/conf-available/other-vhosts-access-log.conf', '# Define an access log for VirtualHosts that don\'t define their own logfile\nCustomLog ${APACHE_LOG_DIR}/other_vhosts_access.log vhost_combined\n');
  datei(w, '/etc/apache2/conf-available/serve-cgi-bin.conf', '<IfModule mod_alias.c>\n\t<IfModule mod_cgi.c>\n\t\tDefine ENABLE_USR_LIB_CGI_BIN\n\t</IfModule>\n\t<IfDefine ENABLE_USR_LIB_CGI_BIN>\n\t\tScriptAlias /cgi-bin/ /usr/lib/cgi-bin/\n\t\t<Directory "/usr/lib/cgi-bin">\n\t\t\tAllowOverride None\n\t\t\tOptions +ExecCGI -MultiViews +SymLinksIfOwnerMatch\n\t\t\tRequire all granted\n\t\t</Directory>\n\t</IfDefine>\n</IfModule>\n');
  datei(w, '/etc/apache2/conf-available/localized-error-pages.conf', '# Customizable error responses come in three flavors:\n# 1) plain text\n#ErrorDocument 500 "The server made a boo boo."\n');
  for (const c of ['charset', 'localized-error-pages', 'other-vhosts-access-log', 'security', 'serve-cgi-bin']) link(w, `/etc/apache2/conf-enabled/${c}.conf`, `../conf-available/${c}.conf`);
  datei(w, '/etc/apache2/sites-available/000-default.conf', DEB_DEFAULT_SITE); datei(w, '/etc/apache2/sites-available/default-ssl.conf', DEB_DEFAULT_SSL);
  link(w, '/etc/apache2/sites-enabled/000-default.conf', '../sites-available/000-default.conf');
  datei(w, '/var/www/html/index.html', `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">\n<html xmlns="http://www.w3.org/1999/xhtml">\n  <head>\n    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />\n    <title>Apache2 Debian Default Page: It works</title>\n  </head>\n  <body>\n    <div class="main_page">\n      <div class="page_header floating_element">\n        <span class="floating_element">\n          Apache2 Debian Default Page\n        </span>\n      </div>\n      <div class="content_section floating_element">\n        <div class="section_header section_header_red">\n          <div id="about"></div>\n          It works!\n        </div>\n        <div class="content_section_text">\n          <p>\n                This is the default welcome page used to test the correct\n                operation of the Apache2 server after installation on Debian systems.\n                If you can read this page, it means that the Apache HTTP server installed at\n                this site is working properly. You should <b>replace this file</b> (located at\n                <tt>/var/www/html/index.html</tt>) before continuing to operate your HTTP server.\n          </p>\n        </div>\n      </div>\n    </div>\n  </body>\n</html>\n`);
  ordner(w, '/var/log/apache2', 0o750, 'root', 'adm'); ordner(w, '/var/run/apache2'); ordner(w, '/var/lock/apache2', 0o755, 'www-data', 'www-data');
  for (const p of ['/usr/sbin/apache2', '/usr/sbin/apache2ctl', '/usr/sbin/a2enmod', '/usr/sbin/a2dismod', '/usr/sbin/a2ensite', '/usr/sbin/a2dissite', '/usr/sbin/a2enconf', '/usr/sbin/a2disconf', '/usr/sbin/a2query']) datei(w, p, '\u0007BIN:' + (30000 + p.length * 100), 0o755);
  link(w, '/usr/sbin/apachectl', 'apache2ctl');
  if (!(w.fs['/etc/ssl/certs/ssl-cert-snakeoil.pem'])) { if (!/^ssl-cert:/m.test(w.fs['/etc/group'] ?? '')) w.fs['/etc/group'] += 'ssl-cert:x:110:\n'; ordner(w, '/etc/ssl/private', 0o710, 'root', 'ssl-cert'); snakeoil(w); }
  s.apache.enabled = true;
}
function httpdInstallieren(w: Welt) {
  const conf = `#
# This is the main Apache HTTP server configuration file.  It contains the
# configuration directives that give the server its instructions.
# See <URL:http://httpd.apache.org/docs/2.4/> for detailed information.
# In particular, see
# <URL:http://httpd.apache.org/docs/2.4/mod/directives.html>
# for a discussion of each configuration directive.
#
# Do NOT simply read the instructions in here without understanding
# what they do.  They're here only as hints or reminders.  If you are unsure
# consult the online docs. You have been warned.

ServerRoot "/etc/httpd"

#
# Listen: Allows you to bind Apache to specific IP addresses and/or
# ports, instead of the default. See also the <VirtualHost>
# directive.
#
#Listen 12.34.56.78:80
Listen 80

#
# Dynamic Shared Object (DSO) Support
#
Include conf.modules.d/*.conf

User apache
Group apache

ServerAdmin root@localhost

#ServerName www.example.com:80

<Directory />
    AllowOverride none
    Require all denied
</Directory>

DocumentRoot "/var/www/html"

<Directory "/var/www">
    AllowOverride None
    # Allow open access:
    Require all granted
</Directory>

<Directory "/var/www/html">
    Options Indexes FollowSymLinks
    AllowOverride None
    Require all granted
</Directory>

<IfModule dir_module>
    DirectoryIndex index.html
</IfModule>

<Files ".ht*">
    Require all denied
</Files>

ErrorLog "logs/error_log"

LogLevel warn

<IfModule log_config_module>
    LogFormat "%h %l %u %t \\"%r\\" %>s %b \\"%{Referer}i\\" \\"%{User-Agent}i\\"" combined
    LogFormat "%h %l %u %t \\"%r\\" %>s %b" common
    CustomLog "logs/access_log" combined
</IfModule>

<IfModule alias_module>
    ScriptAlias /cgi-bin/ "/var/www/cgi-bin/"
</IfModule>

<Directory "/var/www/cgi-bin">
    AllowOverride None
    Options None
    Require all granted
</Directory>

<IfModule mime_module>
    TypesConfig /etc/mime.types
    AddType application/x-compress .Z
    AddType application/x-gzip .gz .tgz
    AddType text/html .shtml
    AddOutputFilter INCLUDES .shtml
</IfModule>

AddDefaultCharset UTF-8

EnableSendfile on

# Supplemental configuration
#
# Load config files in the "/etc/httpd/conf.d" directory, if any.
IncludeOptional conf.d/*.conf
`;
  datei(w, '/etc/httpd/conf/httpd.conf', conf);
  const base = ['access_compat', 'actions', 'alias', 'auth_basic', 'authn_core', 'authn_file', 'authz_core', 'authz_groupfile', 'authz_host', 'authz_user', 'autoindex', 'deflate', 'dir', 'env', 'expires', 'filter', 'headers', 'log_config', 'mime', 'negotiation', 'reqtimeout', 'rewrite', 'setenvif', 'socache_shmcb', 'status', 'unixd', 'userdir'];
  datei(w, '/etc/httpd/conf.modules.d/00-base.conf', '#\n# This file loads most of the modules included with the Apache HTTP\n# Server itself.\n#\n\n' + base.map((m) => `LoadModule ${m}_module modules/mod_${m}.so`).join('\n') + '\n');
  datei(w, '/etc/httpd/conf.modules.d/00-mpm.conf', '# Select the MPM module which should be used by uncommenting exactly\n# one of the following LoadModule lines.  See the httpd.conf(5) man\n# page for more information on changing the MPM.\n\n# prefork MPM: Implements a non-threaded, pre-forking web server\n# See: http://httpd.apache.org/docs/2.4/mod/prefork.html\n#\n# NOTE: If enabling prefork, the httpd_graceful_shutdown SELinux\n# boolean should be enabled, to allow graceful stop/shutdown.\n#\n#LoadModule mpm_prefork_module modules/mod_mpm_prefork.so\n\n# worker MPM: Multi-Processing Module implementing a hybrid\n# multi-threaded multi-process web server\n# See: http://httpd.apache.org/docs/2.4/mod/worker.html\n#\n#LoadModule mpm_worker_module modules/mod_mpm_worker.so\n\n# event MPM: A variant of the worker MPM with the goal of consuming\n# threads only for connections with active processing\n# See: http://httpd.apache.org/docs/2.4/mod/event.html\n#\nLoadModule mpm_event_module modules/mod_mpm_event.so\n');
  datei(w, '/etc/httpd/conf.modules.d/00-proxy.conf', '# This file configures all the proxy modules:\nLoadModule proxy_module modules/mod_proxy.so\nLoadModule proxy_fcgi_module modules/mod_proxy_fcgi.so\nLoadModule proxy_http_module modules/mod_proxy_http.so\n');
  datei(w, '/etc/httpd/conf.modules.d/00-systemd.conf', '# This file configures systemd module:\nLoadModule systemd_module modules/mod_systemd.so\n');
  for (const m of [...base, 'mpm_prefork', 'mpm_worker', 'mpm_event', 'proxy', 'proxy_fcgi', 'proxy_http', 'systemd']) datei(w, `/usr/lib64/httpd/modules/mod_${m}.so`, '\u0007BIN:40000', 0o755);
  link(w, '/etc/httpd/modules', '../../usr/lib64/httpd/modules'); link(w, '/etc/httpd/logs', '../../var/log/httpd'); link(w, '/etc/httpd/run', '/run/httpd');
  datei(w, '/etc/httpd/conf.d/welcome.conf', '# \n# This configuration file enables the default "Welcome" page if there\n# is no default index page present for the root URL.  To disable the\n# Welcome page, comment out all the lines below. \n#\n# NOTE: if this file is removed, it will be restored on upgrades.\n#\n<LocationMatch "^/+$">\n    Options -Indexes\n    ErrorDocument 403 /.noindex.html\n</LocationMatch>\n\n<Directory /usr/share/httpd/noindex>\n    AllowOverride None\n    Require all granted\n</Directory>\n\nAlias /.noindex.html /usr/share/httpd/noindex/index.html\nAlias /poweredby.png /usr/share/httpd/icons/apache_pb3.png\nAlias /system_noindex_logo.png /usr/share/httpd/icons/system_noindex_logo.png\n');
  datei(w, '/etc/httpd/conf.d/autoindex.conf', '#\n# Directives controlling the display of server-generated directory listings.\n#\nIndexOptions FancyIndexing HTMLTable VersionSort\nAlias /icons/ "/usr/share/httpd/icons/"\n\n<Directory "/usr/share/httpd/icons">\n    Options Indexes MultiViews FollowSymlinks\n    AllowOverride None\n    Require all granted\n</Directory>\n');
  datei(w, '/etc/httpd/conf.d/README', '\nThis directory holds configuration files for the Apache HTTP Server;\nany files in this directory which have the ".conf" extension will be\nprocessed as httpd configuration files.  The directory is used in\naddition to the directory /etc/httpd/conf.modules.d/, which contains\nconfiguration files necessary to load modules.\n');
  datei(w, '/usr/share/httpd/noindex/index.html', '<!doctype html>\n<html>\n  <head>\n    <title>HTTP Server Test Page powered by: AlmaLinux</title>\n  </head>\n  <body>\n    <h1>HTTP Server <strong>Test Page</strong></h1>\n    <p>This page is used to test the proper operation of an HTTP server after it has been installed on a AlmaLinux system. If you can read this page, it means that the software is working correctly.</p>\n  </body>\n</html>\n');
  ordner(w, '/var/www/html'); ordner(w, '/var/www/cgi-bin'); ordner(w, '/var/log/httpd', 0o700); ordner(w, '/run/httpd', 0o710, 'root', 'apache');
  for (const p of ['/usr/sbin/httpd', '/usr/sbin/apachectl']) datei(w, p, '\u0007BIN:520000', 0o755);
  if (!/^apache:/m.test(w.fs['/etc/passwd'] ?? '')) { w.fs['/etc/passwd'] += 'apache:x:48:48:Apache:/usr/share/httpd:/sbin/nologin\n'; w.fs['/etc/group'] += 'apache:x:48:\n'; }
  st(w).apache.enabled = false;
}
function modSslRh(w: Welt) {
  datei(w, '/etc/httpd/conf.modules.d/00-ssl.conf', 'LoadModule ssl_module modules/mod_ssl.so\n'); datei(w, '/usr/lib64/httpd/modules/mod_ssl.so', '\u0007BIN:260000', 0o755);
  datei(w, '/etc/httpd/conf.d/ssl.conf', '#\n# When we also provide SSL we have to listen to the \n# standard HTTPS port in addition.\n#\nListen 443 https\n\nSSLPassPhraseDialog exec:/usr/libexec/httpd-ssl-pass-dialog\nSSLSessionCache         shmcb:/run/httpd/sslcache(512000)\nSSLSessionCacheTimeout  300\nSSLCryptoDevice builtin\n\n<VirtualHost _default_:443>\n\nErrorLog logs/ssl_error_log\nTransferLog logs/ssl_access_log\nLogLevel warn\n\nSSLEngine on\n\nSSLHonorCipherOrder on\n\nSSLCipherSuite PROFILE=SYSTEM\nSSLProxyCipherSuite PROFILE=SYSTEM\n\nSSLCertificateFile /etc/pki/tls/certs/localhost.crt\n\nSSLCertificateKeyFile /etc/pki/tls/private/localhost.key\n\n<FilesMatch "\\.(cgi|shtml|phtml|php)$">\n    SSLOptions +StdEnvVars\n</FilesMatch>\n<Directory "/var/www/cgi-bin">\n    SSLOptions +StdEnvVars\n</Directory>\n\n</VirtualHost>\n');
}
function nginxInstallieren(w: Welt) {
  const s = st(w); if (s.nginx.installiert) return; s.nginx.installiert = true;
  datei(w, '/etc/nginx/nginx.conf', `user www-data;
worker_processes auto;
pid /run/nginx.pid;
include /etc/nginx/modules-enabled/*.conf;

events {
	worker_connections 768;
	# multi_accept on;
}

http {

	##
	# Basic Settings
	##

	sendfile on;
	tcp_nopush on;
	types_hash_max_size 2048;
	# server_tokens off;

	# server_names_hash_bucket_size 64;
	# server_name_in_redirect off;

	include /etc/nginx/mime.types;
	default_type application/octet-stream;

	##
	# SSL Settings
	##

	ssl_protocols TLSv1 TLSv1.1 TLSv1.2 TLSv1.3; # Dropping SSLv3, ref: POODLE
	ssl_prefer_server_ciphers on;

	##
	# Logging Settings
	##

	access_log /var/log/nginx/access.log;
	error_log /var/log/nginx/error.log;

	##
	# Gzip Settings
	##

	gzip on;

	# gzip_vary on;
	# gzip_proxied any;
	# gzip_comp_level 6;
	# gzip_buffers 16 8k;
	# gzip_http_version 1.1;
	# gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;

	##
	# Virtual Host Configs
	##

	include /etc/nginx/conf.d/*.conf;
	include /etc/nginx/sites-enabled/*;
}
`);
  datei(w, '/etc/nginx/mime.types', '\ntypes {\n    text/html                                        html htm shtml;\n    text/css                                         css;\n    text/plain                                       txt;\n    application/json                                 json;\n    image/png                                        png;\n}\n');
  for (const d of ['conf.d', 'modules-available', 'modules-enabled', 'sites-available', 'sites-enabled', 'snippets']) ordner(w, `/etc/nginx/${d}`);
  datei(w, '/etc/nginx/sites-available/default', `##
# You should look at the following URL's in order to grasp a solid understanding
# of Nginx configuration files in order to fully unleash the power of Nginx.
# https://www.nginx.com/resources/wiki/start/
# https://www.nginx.com/resources/wiki/start/topics/tutorials/config_pitfalls/
# https://wiki.debian.org/Nginx/DirectoryStructure
#
# In most cases, administrators will remove this file from sites-enabled/ and
# leave it as reference inside of sites-available where it will continue to be
# updated by the nginx packaging team.
##

# Default server configuration
#
server {
	listen 80 default_server;
	listen [::]:80 default_server;

	# SSL configuration
	#
	# listen 443 ssl default_server;
	# listen [::]:443 ssl default_server;

	root /var/www/html;

	# Add index.php to the list if you are using PHP
	index index.html index.htm index.nginx-debian.html;

	server_name _;

	location / {
		# First attempt to serve request as file, then
		# as directory, then fall back to displaying a 404.
		try_files $uri $uri/ =404;
	}
}
`);
  link(w, '/etc/nginx/sites-enabled/default', '/etc/nginx/sites-available/default');
  datei(w, '/etc/nginx/snippets/fastcgi-php.conf', '# regex to split $uri to $fastcgi_script_name and $fastcgi_path\nfastcgi_index index.php;\n');
  datei(w, '/var/www/html/index.nginx-debian.html', '<!DOCTYPE html>\n<html>\n<head>\n<title>Welcome to nginx!</title>\n</head>\n<body>\n<h1>Welcome to nginx!</h1>\n<p>If you see this page, the nginx web server is successfully installed and\nworking. Further configuration is required.</p>\n</body>\n</html>\n');
  ordner(w, '/var/log/nginx', 0o755, 'root', 'adm'); datei(w, '/usr/sbin/nginx', '\u0007BIN:1250000', 0o755);
  s.nginx.enabled = true;
}
const SQUID_CONF = `#	WELCOME TO SQUID 5.7
#	----------------------------
#
#	This is the documentation for the Squid configuration file.
#	This documentation can also be found online at:
#		http://www.squid-cache.org/Doc/config/
#
#	(Die vollständige Datei mit allen Erklärungen hat über 9000 Zeilen.
#	 Hier stehen nur die aktiven Zeilen mit den wichtigsten Kommentaren.)

#
# Recommended minimum configuration:
#

# Example rule allowing access from your local networks.
# Adapt to list your (internal) IP networks from where browsing
# should be allowed
acl localnet src 0.0.0.1-0.255.255.255	# RFC 1122 "this" network (LAN)
acl localnet src 10.0.0.0/8		# RFC 1918 local private network (LAN)
acl localnet src 100.64.0.0/10		# RFC 6598 shared address space (CGN)
acl localnet src 169.254.0.0/16 	# RFC 3927 link-local (directly plugged) machines
acl localnet src 172.16.0.0/12		# RFC 1918 local private network (LAN)
acl localnet src 192.168.0.0/16		# RFC 1918 local private network (LAN)
acl localnet src fc00::/7       	# RFC 4193 local private network range
acl localnet src fe80::/10      	# RFC 4291 link-local (directly plugged) machines

acl SSL_ports port 443
acl Safe_ports port 80		# http
acl Safe_ports port 21		# ftp
acl Safe_ports port 443		# https
acl Safe_ports port 70		# gopher
acl Safe_ports port 210		# wais
acl Safe_ports port 1025-65535	# unregistered ports
acl Safe_ports port 280		# http-mgmt
acl Safe_ports port 488		# gss-http
acl Safe_ports port 591		# filemaker
acl Safe_ports port 777		# multiling http
acl CONNECT method CONNECT

#
# Recommended minimum Access Permission configuration:
#
# Deny requests to certain unsafe ports
http_access deny !Safe_ports

# Deny CONNECT to other than secure SSL ports
http_access deny CONNECT !SSL_ports

# Only allow cachemgr access from localhost
http_access allow localhost manager
http_access deny manager

# We strongly recommend the following be uncommented to protect innocent
# web applications running on the proxy server who think the only
# one who can access services on "localhost" is a local user
#http_access deny to_localhost

#
# INSERT YOUR OWN RULE(S) HERE TO ALLOW ACCESS FROM YOUR CLIENTS
#
include /etc/squid/conf.d/*.conf

# Example rule allowing access from your local networks.
# Adapt localnet in the ACL section to list your (internal) IP networks
# from where browsing should be allowed
#http_access allow localnet
http_access allow localhost

# And finally deny all other access to this proxy
http_access deny all

#	TAG: http_port
# Squid normally listens to port 3128
http_port 3128

#	TAG: cache_mem	(bytes)
#cache_mem 256 MB

#	TAG: cache_dir
# Uncomment and adjust the following to add a disk cache directory.
#cache_dir ufs /var/spool/squid 100 16 256

#	TAG: maximum_object_size	(bytes)
#maximum_object_size 4 MB

# Leave coredumps in the first cache dir
coredump_dir /var/spool/squid

#
# Add any of your own refresh_pattern entries above these.
#
refresh_pattern ^ftp:		1440	20%	10080
refresh_pattern -i (/cgi-bin/|\\?) 0	0%	0
refresh_pattern .		0	20%	4320
`;
function squidInstallieren(w: Welt) {
  const s = st(w); if (s.squid.installiert) return; s.squid.installiert = true;
  datei(w, '/etc/squid/squid.conf', SQUID_CONF); ordner(w, '/etc/squid/conf.d');
  datei(w, '/etc/squid/conf.d/debian.conf', '#\n# Squid configuration settings for Debian\n#\n\n# Logs are managed by logrotate on Debian\nlogfile_rotate 0\n\n# For extra security Debian packages only allow\n# localhost to use the proxy on new installs\n#\n#http_access allow localnet\n\n');
  datei(w, '/etc/squid/errorpage.css', '/* Fehlerseiten von Squid */\n');
  ordner(w, '/var/log/squid', 0o750, 'proxy', 'proxy'); ordner(w, '/var/spool/squid', 0o750, 'proxy', 'proxy');
  datei(w, '/usr/sbin/squid', '\u0007BIN:4800000', 0o755);
  for (const h of ['basic_ncsa_auth', 'basic_pam_auth', 'basic_ldap_auth', 'basic_fake_auth', 'digest_file_auth', 'ext_unix_group_acl', 'negotiate_kerberos_auth', 'log_file_daemon']) datei(w, `/usr/lib/squid/${h}`, '\u0007BIN:80000', 0o755);
  if (!/^proxy:/m.test(w.fs['/etc/passwd'] ?? '')) w.fs['/etc/passwd'] += 'proxy:x:13:13:proxy:/bin:/usr/sbin/nologin\n';
  s.squid.enabled = true;
}

export function webStarten(w: Welt, o: WebOptionen) {
  const leer = (): Dienst => ({ installiert: false, laeuft: false, enabled: false, pid: 0, start: w.uhr, fehlgeschlagen: false, journal: [] });
  const s: WebStand = { opt: o, apache: { ...leer(), modell: null }, nginx: { ...leer(), modell: null }, squid: { ...leer(), modell: null, cache: {} }, anfragen: 0, rr: {}, ca: { key: '' } };
  (w as WW).web = s;
  if (w.pakete) for (const p of rh(w) ? ['openssl', 'curl'] : ['openssl', 'curl', 'ca-certificates']) w.pakete.installiert[p] = 'ii';
  datei(w, '/usr/bin/openssl', '\u0007BIN:990000', 0o755); datei(w, '/usr/bin/curl', '\u0007BIN:280000', 0o755);
  // Vertrauensspeicher mit einer erfundenen öffentlichen CA
  const ca = oeffentlicheCa();
  const bundle = rh(w) ? '/etc/pki/tls/certs/ca-bundle.crt' : '/etc/ssl/certs/ca-certificates.crt';
  datei(w, bundle, pem(ca.wurzel));
  if (!rh(w)) { ordner(w, '/usr/local/share/ca-certificates'); datei(w, '/usr/sbin/update-ca-certificates', '\u0007BIN:9000', 0o755); ordner(w, '/etc/ssl/private', 0o700); datei(w, '/etc/ssl/openssl.cnf', '#\n# OpenSSL example configuration file.\n# See doc/man5/config.pod for more info.\n[openssl_init]\nssl_conf = ssl_sect\n\n[ssl_sect]\nsystem_default = system_default_sect\n\n[system_default_sect]\nCipherString = DEFAULT:@SECLEVEL=2\n'); datei(w, '/usr/lib/ssl/misc/CA.pl', '#!/usr/bin/perl\n# CA - wrapper around ca, req, x509 und verify (aus dem Paket openssl)\n', 0o755); }
  else { ordner(w, '/etc/pki/ca-trust/source/anchors'); datei(w, '/usr/bin/update-ca-trust', '\u0007BIN:9000', 0o755); ordner(w, '/etc/pki/tls/private', 0o755); ordner(w, '/etc/pki/tls/certs'); datei(w, '/etc/pki/tls/openssl.cnf', '# OpenSSL configuration (crypto-policies)\n'); }
  if (o.seiten) {
    const hosts = w.fs['/etc/hosts'] ?? '';
    if (!hosts.includes('www.lab.example.org')) w.fs['/etc/hosts'] = hosts + '192.168.1.23\twww.lab.example.org lab.example.org intern.lab.example.org lager.lab.example.org\n192.168.1.10\tsrv1.lab.example.org srv1\n';
    datei(w, '/var/www/www/index.html', '<!doctype html>\n<title>Werkstatt</title>\n<h1>Willkommen in der Werkstatt</h1>\n<p>Öffnungszeiten: Mo bis Fr, 7 bis 16 Uhr</p>\n');
    datei(w, '/var/www/www/kontakt.html', '<!doctype html>\n<title>Kontakt</title>\n<p>werkstatt@lab.example.org</p>\n');
    datei(w, '/var/www/intern/index.html', '<!doctype html>\n<title>Intern</title>\n<h1>Interne Seiten der Werkstatt</h1>\n<p>Schichtplan, Maschinenbuch, Doku</p>\n');
    datei(w, '/var/www/intern/schichtplan.txt', 'KW 48: Früh Lena, Spät Max\n');
    datei(w, '/var/www/intern/doku/maschinenbuch.txt', 'Laser: Linse am 20.11. getauscht\nFräse: Spindel läuft rau\n');
    datei(w, '/var/www/intern/doku/wartung.txt', 'Nächste Wartung Fräse: 15.12.\n');
  }
  if (o.zert) {
    // Max hat ein Zertifikat für www.lab.example.org bei Open Trust Lab gekauft
    const k = neuerSchluessel(w); const z = ausstellen(w, { CN: 'www.lab.example.org' }, ['DNS:www.lab.example.org', 'DNS:lab.example.org'], k, ca.zwischen, ca.zwischenKey, 90, w.uhr - 2 * 86400000);
    ordner(w, '/home/lena/zert', 0o700, 'lena');
    datei(w, '/home/lena/zert/www.lab.example.org.crt', pem(z), 0o644, 'lena'); datei(w, '/home/lena/zert/www.lab.example.org.key', pem(k), 0o600, 'lena'); datei(w, '/home/lena/zert/otl-r3.crt', pem(ca.zwischen), 0o644, 'lena');
  }
  if (o.apache) { apacheInstallieren(w); if (w.pakete) for (const p of rh(w) ? ['httpd', 'httpd-tools'] : ['apache2', 'apache2-bin', 'apache2-data', 'apache2-utils', 'ssl-cert']) w.pakete.installiert[p] = 'ii'; datei(w, '/usr/bin/htpasswd', '\u0007BIN:30000', 0o755); }
  if (o.apache && !rh(w)) {
    if (o.seiten || o.intern) {
      datei(w, '/etc/apache2/sites-available/www.conf', '<VirtualHost *:80>\n\tServerName www.lab.example.org\n\tServerAlias lab.example.org\n\tDocumentRoot /var/www/www\n\n\tErrorLog ${APACHE_LOG_DIR}/www-error.log\n\tCustomLog ${APACHE_LOG_DIR}/www-access.log combined\n</VirtualHost>\n');
    }
    if (o.intern) {
      datei(w, '/etc/apache2/sites-available/intern.conf', '<VirtualHost *:80>\n\tServerName intern.lab.example.org\n\tDocumentRoot /var/www/intern\n\n\tErrorLog ${APACHE_LOG_DIR}/intern-error.log\n\tCustomLog ${APACHE_LOG_DIR}/intern-access.log combined\n</VirtualHost>\n');
      link(w, '/etc/apache2/sites-enabled/www.conf', '../sites-available/www.conf'); link(w, '/etc/apache2/sites-enabled/intern.conf', '../sites-available/intern.conf');
    }
    if (o.php) modAktivieren(w, 'php8.2', true);
    if (o.https) {
      ordner(w, '/etc/ssl/werkstatt', 0o755);
      const caKey = neuerSchluessel(w, 4096); const caZ = ausstellen(w, { C: 'DE', O: 'Werkstatt', CN: 'Werkstatt Labor CA' }, [], caKey, null, caKey, 3650);
      const k = neuerSchluessel(w); const z = ausstellen(w, { C: 'DE', O: 'Werkstatt', CN: 'www.lab.example.org' }, ['DNS:www.lab.example.org', 'DNS:lab.example.org'], k, caZ, caKey, 365);
      datei(w, '/etc/ssl/werkstatt/ca.crt', pem(caZ)); datei(w, '/etc/ssl/werkstatt/ca.key', pem(caKey), 0o600); datei(w, '/etc/ssl/certs/www.lab.example.org.crt', pem(z)); datei(w, '/etc/ssl/private/www.lab.example.org.key', pem(k), 0o600);
      datei(w, '/etc/apache2/sites-available/www-ssl.conf', '<VirtualHost *:443>\n\tServerName www.lab.example.org\n\tDocumentRoot /var/www/www\n\n\tSSLEngine on\n\tSSLCertificateFile /etc/ssl/certs/www.lab.example.org.crt\n\tSSLCertificateKeyFile /etc/ssl/private/www.lab.example.org.key\n\n\tErrorLog ${APACHE_LOG_DIR}/www-error.log\n\tCustomLog ${APACHE_LOG_DIR}/www-access.log combined\n</VirtualHost>\n');
      link(w, '/etc/apache2/sites-enabled/www-ssl.conf', '../sites-available/www-ssl.conf');
      if (!(w.fs['/etc/apache2/sites-enabled/www.conf'])) link(w, '/etc/apache2/sites-enabled/www.conf', '../sites-available/www.conf');
      modAktivieren(w, 'ssl', true);
      const hosts = w.fs['/etc/hosts'] ?? ''; if (!hosts.includes('shop.lab.example.org')) w.fs['/etc/hosts'] = hosts.replace('lager.lab.example.org', 'lager.lab.example.org shop.lab.example.org');
    }
    if (o.nginx) {
      // Apache weicht auf 127.0.0.1:8080 aus
      w.fs['/etc/apache2/ports.conf'] = DEB_PORTS.replace('Listen 80\n', 'Listen 127.0.0.1:8080\n');
      w.fs['/etc/apache2/sites-available/000-default.conf'] = DEB_DEFAULT_SITE.replace('<VirtualHost *:80>', '<VirtualHost 127.0.0.1:8080>');
      if (w.fs['/etc/apache2/sites-available/www.conf']) w.fs['/etc/apache2/sites-available/www.conf'] = (w.fs['/etc/apache2/sites-available/www.conf'] as string).replace('<VirtualHost *:80>', '<VirtualHost 127.0.0.1:8080>');
    }
  }
  if (o.squid) { squidInstallieren(w); if (w.pakete) for (const p of ['squid', 'squid-common', 'squid-langpack']) w.pakete.installiert[p] = 'ii'; }
  if (o.nginx) { nginxInstallieren(w); if (w.pakete) for (const p of ['nginx', 'nginx-common']) w.pakete.installiert[p] = 'ii'; }
  if (o.boss) bossWelt(w);
  if (o.apache) { s.apache.enabled = !rh(w) || s.apache.enabled; if (!rh(w)) apacheStarten(w); }
  if (o.squid) squidStarten(w);
  if (o.nginx) nginxStarten(w);
}
function bossWelt(w: Welt) {
  // Relaunch: Max hat am Freitag angefangen, nichts davon läuft
  const caKey = neuerSchluessel(w, 4096); const caZ = ausstellen(w, { C: 'DE', O: 'Werkstatt', CN: 'Werkstatt Labor CA' }, [], caKey, null, caKey, 3650);
  ordner(w, '/etc/ssl/werkstatt'); datei(w, '/etc/ssl/werkstatt/ca.crt', pem(caZ)); datei(w, '/etc/ssl/werkstatt/ca.key', pem(caKey), 0o600);
  const hosts = w.fs['/etc/hosts'] ?? ''; if (!hosts.includes('shop.lab.example.org')) w.fs['/etc/hosts'] = hosts.replace('lager.lab.example.org', 'lager.lab.example.org shop.lab.example.org');
  datei(w, '/etc/apache2/sites-available/shop.conf', '<VirtualHost 127.0.0.1:8080>\n\tServerName shop.lab.example.org\n\tDocumentRoot /var/www/shop\n\t<Directory /var/www/shop/verwaltung>\n\t\tAuthType Basic\n\t\tAuthName "Shop-Verwaltung"\n\t\tAuthUserFile /etc/apache2/shop.htpasswd\n\t\tRequire user max\n\t</Directory>\n</VirtualHost>\n');
  datei(w, '/var/www/shop/index.html', '<!doctype html>\n<title>Shop</title>\n<h1>Ersatzteile der Werkstatt</h1>\n');
  datei(w, '/var/www/shop/verwaltung/index.html', '<!doctype html>\n<title>Verwaltung</title>\n<h1>Bestellungen</h1>\n', 0o600);
  datei(w, '/etc/nginx/sites-available/shop', 'upstream lagerist {\n\tserver 192.168.1.10:8080;\n\tserver 192.168.1.10:8081;\n}\n\nserver {\n\tlisten 443 ssl;\n\tserver_name shop.lab.example.org;\n\n\tssl_certificate /etc/ssl/certs/shop.lab.example.org.crt;\n\tssl_certificate_key /etc/ssl/private/shop.lab.example.org.key;\n\n\tlocation / {\n\t\tproxy_pass http://127.0.0.1:8080\n\t\tproxy_set_header Host $host;\n\t}\n\n\tlocation /lager/ {\n\t\tproxy_pass http://lagerist/;\n\t}\n}\n');
  link(w, '/etc/nginx/sites-enabled/shop', '/etc/nginx/sites-available/shop');
}

// ---------- Dienste ----------
function journal(w: Welt, d: Dienst, prog: string, text: string) { d.journal.push({ ms: w.uhr, text: `${prog}[${prog === 'systemd' ? 1 : d.pid || 4711}]: ${text}` }); }
function apacheStarten(w: Welt): string | null {
  const s = st(w); const d = s.apache; const o = ORT(w);
  if (d.laeuft) return null;
  const r = apacheLesen(w, { envvars: true });
  d.start = w.uhr;
  if ('text' in r) { d.fehlgeschlagen = true; journal(w, d, o.ctl, r.text); journal(w, d, o.ctl, `Action 'start' failed.`); journal(w, d, o.ctl, 'The Apache error log may have more information.'); return r.text; }
  const m = r.modell;
  for (const x of m.warnungen) journal(w, d, o.ctl, x);
  // Ports, die schon belegt sind
  for (const l of m.listen) { if (s.nginx.laeuft && s.nginx.modell?.server.some((x) => x.listen.some((y) => y.port === l.port && (l.ip === '*' || y.ip === '0.0.0.0' || y.ip === l.ip)))) { const t = `(98)Address already in use: AH00072: make_sock: could not bind to address ${l.ip === '*' ? '[::]' : l.ip}:${l.port}\n(98)Address already in use: AH00072: make_sock: could not bind to address ${l.ip === '*' ? '0.0.0.0' : l.ip}:${l.port}\nno listening sockets available, shutting down\nAH00015: Unable to open logs`; for (const z of t.split('\n')) journal(w, d, o.ctl, z); journal(w, d, o.ctl, `Action 'start' failed.`); d.fehlgeschlagen = true; return t; } }
  // Schlüssel und Zertifikat müssen zusammenpassen
  for (const vh of m.vhosts) {
    if (!/^on$/i.test(wert({ ...m, global: [] }, 'sslengine', vh)?.[0] ?? '')) continue;
    const cf = wert(m, 'sslcertificatefile', vh)?.[0]; const kf = wert(m, 'sslcertificatekeyfile', vh)?.[0] ?? cf;
    const name = `${letzte(vh.d, 'servername')?.args[0] ?? w.host}:443:0`;
    if (!cf) { apacheErrorLog(w, m, vh, 'ssl:emerg', null, `AH02572: Failed to configure at least one certificate and key for ${name}`); d.fehlgeschlagen = true; journal(w, d, o.ctl, `AH00016: Configuration Failed`); return `AH00016: Configuration Failed`; }
    const z = zertifikate(inhalt(w, cf))[0]; const k = schluesselIn(inhalt(w, kf!));
    if (k?.pass) { apacheErrorLog(w, m, vh, 'ssl:emerg', null, `AH02564: Failed to configure encrypted (?) private key ${name}, check ${kf}`); apacheErrorLog(w, m, null, 'ssl:emerg', null, 'AH02312: Fatal error initialising mod_ssl, exiting.'); d.fehlgeschlagen = true; journal(w, d, o.ctl, `Enter passphrase for SSL/TLS keys for ${name.replace(/:0$/, '')} (RSA):`); journal(w, d, o.ctl, 'AH00016: Configuration Failed'); return 'AH00016: Configuration Failed'; }
    if (!z || !k || z.key !== k.id) { apacheErrorLog(w, m, vh, 'ssl:emerg', null, !k ? `AH02565: Certificate and private key ${name} from ${cf} and ${kf} do not match` : `AH02565: Certificate and private key ${name} from ${cf} and ${kf} do not match`); apacheErrorLog(w, m, null, 'ssl:emerg', null, 'AH02312: Fatal error initialising mod_ssl, exiting.'); d.fehlgeschlagen = true; journal(w, d, o.ctl, 'AH00016: Configuration Failed'); return 'AH00016: Configuration Failed'; }
  }
  if (rh(w) && m.module.includes('ssl') && !(w.fs['/etc/pki/tls/certs/localhost.crt'])) { const k = neuerSchluessel(w); datei(w, '/etc/pki/tls/private/localhost.key', pem(k), 0o600); datei(w, '/etc/pki/tls/certs/localhost.crt', pem(ausstellen(w, { C: 'US', O: 'Unspecified', CN: w.host }, [`DNS:${w.host}`], k, null, k, 365))); }
  d.modell = m; d.laeuft = true; d.fehlgeschlagen = false; d.pid = w.naechstePid++;
  // RHEL: php-fpm bringt httpd.service.d/php-fpm.conf mit (Wants=php-fpm.service)
  if (rh(w) && w.pakete?.installiert['php-fpm'] === 'ii' && !w.prozesse.some((p) => p.cmd.startsWith('php-fpm'))) { const pid = w.naechstePid++; w.prozesse.push({ pid, user: 'root', cmd: 'php-fpm: master process (/etc/php-fpm.conf)', ppid: 1, ni: 0, tty: '?', stat: 'Ss', start: '08:41', cpu: 0, mem: 0.6, vsz: 210000, rss: 12000 }); }
  const mw = mpmWerte(m);
  for (const x of mw.warn) journal(w, d, o.ctl, x);
  const n = Math.max(mw.start, m.mpm === 'mpm_prefork' ? mw.minSpare : 1);
  w.prozesse = w.prozesse.filter((p) => !p.cmd.startsWith(`/usr/sbin/${o.bin}`));
  w.prozesse.push({ pid: d.pid, user: 'root', cmd: `/usr/sbin/${o.bin} -k start`.replace(' -k start', rh(w) ? ' -DFOREGROUND' : ' -k start'), ppid: 1, ni: 0, tty: '?', stat: 'Ss', start: '08:41', cpu: 0, mem: 0.4, vsz: 6600, rss: 4800 });
  for (let i = 0; i < n; i++) w.prozesse.push({ pid: w.naechstePid++, user: o.user, cmd: `/usr/sbin/${o.bin} -k start`.replace(' -k start', rh(w) ? ' -DFOREGROUND' : ' -k start'), ppid: d.pid, ni: 0, tty: '?', stat: m.mpm === 'mpm_prefork' ? 'S' : 'Sl', start: '08:41', cpu: 0, mem: 0.3, vsz: m.mpm === 'mpm_prefork' ? 6900 : 1210000, rss: 3500 });
  apacheErrorLog(w, m, null, `${m.mpm}:notice`, null, `AH00489: ${serverHeader(w, { ...m, global: [...m.global, { n: 'servertokens', name: '', args: ['Full'], datei: '', zeile: 0 }] })} configured -- resuming normal operations`);
  apacheErrorLog(w, m, null, 'core:notice', null, `AH00094: Command line: '/usr/sbin/${o.bin}${rh(w) ? ' -D FOREGROUND' : ''}'`);
  journal(w, d, 'systemd', `Started ${o.dienst}.service - The Apache HTTP Server.`);
  return null;
}
function apacheAnhalten(w: Welt) { const s = st(w); const d = s.apache; if (!d.laeuft) return; const o = ORT(w); if (d.modell) apacheErrorLog(w, d.modell, null, `${d.modell.mpm}:notice`, null, 'AH00492: caught SIGWINCH, shutting down gracefully'); d.laeuft = false; w.prozesse = w.prozesse.filter((p) => !p.cmd.startsWith(`/usr/sbin/${o.bin}`)); }
function apacheNeuLaden(w: Welt): string | null {
  const s = st(w); const d = s.apache; const r = apacheLesen(w, { envvars: true });
  if ('text' in r) return r.text;
  for (const x of r.modell.warnungen.filter((x) => x.startsWith('AH00558'))) journal(w, d, ORT(w).ctl, x);
  const alt = d.modell; d.modell = r.modell;
  if (alt && alt.mpm !== r.modell.mpm) { d.laeuft = false; const e = apacheStarten(w); if (e) { d.modell = alt; return e; } }
  apacheErrorLog(w, r.modell, null, `${r.modell.mpm}:notice`, null, `AH00493: SIGUSR1 received.  Doing graceful restart`);
  return null;
}
function nginxStarten(w: Welt): string | null {
  const s = st(w); const d = s.nginx; if (d.laeuft) return null;
  const r = nginxLesen(w); d.start = w.uhr;
  if ('fehler' in r) { d.fehlgeschlagen = true; const t = `${nginxMeldung(w, 'emerg', r.fehler)}\nnginx: configuration file /etc/nginx/nginx.conf test failed`; for (const z of t.split('\n')) journal(w, d, 'nginx', z); return t; }
  for (const x of r.modell.warnungen) journal(w, d, 'nginx', `nginx: [warn] ${x}`);
  const ports = [...new Set(r.modell.server.flatMap((x) => x.listen.map((l) => l.port)))];
  const belegt = ports.find((p) => s.apache.laeuft && s.apache.modell?.listen.some((l) => l.port === p && (l.ip === '*' || l.ip === '0.0.0.0'))) ?? ports.find((p) => s.squid.laeuft && s.squid.modell?.port === p);
  if (belegt) { d.fehlgeschlagen = true; const t = Array(5).fill(`nginx: [emerg] bind() to 0.0.0.0:${belegt} failed (98: Address already in use)`).join('\n') + '\nnginx: [emerg] still could not bind()'; for (const z of t.split('\n')) journal(w, d, 'nginx', z); return t; }
  d.modell = r.modell; d.laeuft = true; d.fehlgeschlagen = false; d.pid = w.naechstePid++;
  w.prozesse = w.prozesse.filter((p) => !p.cmd.startsWith('nginx:'));
  w.prozesse.push({ pid: d.pid, user: 'root', cmd: 'nginx: master process /usr/sbin/nginx -g daemon on; master_process on;', ppid: 1, ni: 0, tty: '?', stat: 'Ss', start: '08:41', cpu: 0, mem: 0.1, vsz: 10400, rss: 1800 });
  for (let i = 0; i < 4; i++) w.prozesse.push({ pid: w.naechstePid++, user: 'www-data', cmd: 'nginx: worker process', ppid: d.pid, ni: 0, tty: '?', stat: 'S', start: '08:41', cpu: 0, mem: 0.1, vsz: 11000, rss: 3400 });
  journal(w, d, 'systemd', 'Started nginx.service - A high performance web server and a reverse proxy server.');
  return null;
}
function nginxAnhalten(w: Welt) { const d = st(w).nginx; d.laeuft = false; w.prozesse = w.prozesse.filter((p) => !p.cmd.startsWith('nginx:')); }
function squidStarten(w: Welt): string | null {
  const s = st(w); const d = s.squid; if (d.laeuft) return null;
  const r = squidLesen(w); d.start = w.uhr;
  if ('fehler' in r) { d.fehlgeschlagen = true; for (const z of r.fehler.split('\n')) journal(w, d, 'squid', z); return r.fehler; }
  const p = r.modell.port;
  if ((s.apache.laeuft && s.apache.modell?.listen.some((l) => l.port === p)) || (s.nginx.laeuft && s.nginx.modell?.server.some((x) => x.listen.some((l) => l.port === p)))) { d.fehlgeschlagen = true; const t = `${zeitSquid(w)} commBind Cannot bind socket FD 18 to [::]:${p}: (98) Address already in use\n${zeitSquid(w)} FATAL: Unable to open HTTP Socket`; for (const z of t.split('\n')) journal(w, d, 'squid', z); return t; }
  d.modell = r.modell; d.laeuft = true; d.fehlgeschlagen = false; d.pid = w.naechstePid++; s.squid.cache = {};
  w.prozesse = w.prozesse.filter((x) => !/squid/.test(x.cmd));
  w.prozesse.push({ pid: d.pid, user: 'root', cmd: '/usr/sbin/squid --foreground -sYC', ppid: 1, ni: 0, tty: '?', stat: 'Ss', start: '08:41', cpu: 0, mem: 0.4, vsz: 76000, rss: 26000 });
  w.prozesse.push({ pid: w.naechstePid++, user: 'proxy', cmd: '(squid-1) --kid squid-1 --foreground -sYC', ppid: d.pid, ni: 0, tty: '?', stat: 'S', start: '08:41', cpu: 0, mem: 0.8, vsz: 92000, rss: 50000 });
  anhaengen(w, '/var/log/squid/cache.log', `${zeitSquid(w)} Starting Squid Cache version ${SQUID_VERSION} for x86_64-pc-linux-gnu...`, 'proxy', 'proxy');
  anhaengen(w, '/var/log/squid/cache.log', `${zeitSquid(w)} Accepting HTTP Socket connections at conn3 local=[::]:${p} remote=[::] FD 21 flags=9`, 'proxy', 'proxy');
  journal(w, d, 'systemd', 'Started squid.service - Squid Web Proxy Server.');
  return null;
}
function squidAnhalten(w: Welt) { const d = st(w).squid; d.laeuft = false; w.prozesse = w.prozesse.filter((x) => !/squid/.test(x.cmd)); }

// ---------- a2enmod und Freunde ----------
function modAktivieren(w: Welt, n: string, still = false): string[] {
  const out: string[] = []; const v = DEB_MODULE[n];
  for (const d of v.dep ?? []) { out.push(`Considering dependency ${d} for ${n}:`); if (w.fs[`/etc/apache2/mods-enabled/${d}.load`] !== undefined) out.push(`Module ${d} already enabled`); else { for (const k of DEB_MODULE[d].konflikt ?? []) if (w.fs[`/etc/apache2/mods-enabled/${k}.load`] !== undefined) { out.push(`Considering conflict ${k} for ${d}:`); modWeg(w, k); out.push(`Module ${k} disabled.`); } out.push(...modAktivieren(w, d, true).filter((x) => !x.startsWith('To activate'))); } }
  for (const k of v.konflikt ?? []) if (w.fs[`/etc/apache2/mods-enabled/${k}.load`] !== undefined) { out.push(`Considering conflict ${k} for ${n}:`, `ERROR: Module ${k} is enabled - cannot proceed due to conflicts. It needs to be disabled first!`); return out; }
  if (w.fs[`/etc/apache2/mods-enabled/${n}.load`] !== undefined) { out.push(`Module ${n} already enabled`); return out; }
  if (!(w.fs[`/etc/apache2/mods-available/${n}.load`] !== undefined)) { datei(w, `/etc/apache2/mods-available/${n}.load`, modLoad(n)); if (v.conf) datei(w, `/etc/apache2/mods-available/${n}.conf`, v.conf); datei(w, `/usr/lib/apache2/modules/${modDatei(n)}`, '\u0007BIN:900000', 0o644); }
  link(w, `/etc/apache2/mods-enabled/${n}.load`, `../mods-available/${n}.load`); if (w.fs[`/etc/apache2/mods-available/${n}.conf`] !== undefined) link(w, `/etc/apache2/mods-enabled/${n}.conf`, `../mods-available/${n}.conf`);
  out.push(`Enabling module ${n}.`);
  if (n === 'ssl') out.push('See /usr/share/doc/apache2/README.Debian.gz on how to configure SSL and create self-signed certificates.');
  if (!still) out.push('To activate the new configuration, you need to run:', '  systemctl restart apache2');
  return out;
}
function modWeg(w: Welt, n: string) { delete w.fs[`/etc/apache2/mods-enabled/${n}.load`]; delete w.fs[`/etc/apache2/mods-enabled/${n}.conf`]; }
function a2(w: Welt, cmd: string, a: string[], root: boolean): Ergebnis {
  const art = cmd.endsWith('mod') ? 'mods' : cmd.endsWith('site') ? 'sites' : 'conf';
  const an = cmd.startsWith('a2en');
  const namen = a.filter((x) => !x.startsWith('-'));
  if (!namen.length) { const verf = ordnerInhalt(w, `/etc/apache2/${art}-available`).map((p) => p.split('/').pop()!.replace(/\.(load|conf)$/, '')).filter((x, i, l) => l.indexOf(x) === i); return ok(`Your choices are: ${verf.join(' ')}\nWhich ${art === 'mods' ? 'module(s)' : art === 'sites' ? 'site(s)' : 'conf(s)'} do you want to ${an ? 'enable' : 'disable'} (wildcards ok)?`); }
  if (!root) return fehler(`ERROR: ${cmd} must be run as root`.replace(`${cmd} must be run as root`, `Could not ${an ? 'create' : 'remove'} /etc/apache2/${art}-enabled/${namen[0].replace(/\.conf$/, '')}.${art === 'mods' ? 'load' : 'conf'}: Permission denied`));
  const out: string[] = []; let code = 0; let neu = false;
  for (const n0 of namen) {
    const n = n0.replace(/\.(conf|load)$/, '');
    if (art === 'mods') {
      if (!(w.fs[`/etc/apache2/mods-available/${n}.load`] !== undefined)) { out.push(`ERROR: Module ${n} does not exist!`); code = 1; continue; }
      if (an) { const r = modAktivieren(w, n, true); out.push(...r); if (r.some((x) => x.startsWith('ERROR'))) code = 1; else if (r.some((x) => x.startsWith('Enabling'))) neu = true; }
      else { if (w.fs[`/etc/apache2/mods-enabled/${n}.load`] === undefined) { out.push(`Module ${n} already disabled`); continue; } if (n.startsWith('mpm_') && !a.includes('-f') && false) void 0; modWeg(w, n); out.push(`Module ${n} disabled.`); neu = true; }
      continue;
    }
    const verf = `/etc/apache2/${art}-available/${n}.conf`; const en = `/etc/apache2/${art}-enabled/${n}.conf`;
    if (!(verf in w.fs)) { out.push(`ERROR: ${art === 'sites' ? 'Site' : 'Conf'} ${n} does not exist!`); code = 1; continue; }
    if (an) { if (en in w.fs) { out.push(`${art === 'sites' ? 'Site' : 'Conf'} ${n} already enabled`); continue; } link(w, en, `../${art}-available/${n}.conf`); out.push(`Enabling ${art === 'sites' ? 'site' : 'conf'} ${n}.`); neu = true; }
    else { if (!(en in w.fs)) { out.push(`${art === 'sites' ? 'Site' : 'Conf'} ${n} already disabled`); continue; } delete w.fs[en]; out.push(`${art === 'sites' ? 'Site' : 'Conf'} ${n} disabled.`); neu = true; }
  }
  if (neu) out.push('To activate the new configuration, you need to run:', `  systemctl ${art === 'mods' ? 'restart' : 'reload'} apache2`);
  return { out: code ? '' : out.join('\n'), err: code ? out.join('\n') : undefined, code };
}

// ---------- apache2ctl / httpd ----------
function apacheCtl(w: Welt, prog: string, a: string[], root: boolean): Ergebnis {
  const s = st(w); const o = ORT(w);
  if (!s.apache.installiert) return fehler(`bash: ${prog}: Befehl nicht gefunden`, 127);
  const direkt = prog === 'apache2' || prog === 'httpd';
  const fi = a.indexOf('-f'); const df = fi >= 0 ? a[fi + 1] : undefined;
  const defines = a.flatMap((x, i) => (a[i - 1] === '-D' ? [x] : []));
  const lesen = () => apacheLesen(w, { envvars: !direkt || rh(w), datei: df ? K.pfad(w, df) : undefined, defines });
  const cmd = a.find((x) => !x.startsWith('-') && a[a.indexOf(x) - 1] !== '-f' && a[a.indexOf(x) - 1] !== '-D') ?? (a.includes('-k') ? a[a.indexOf('-k') + 1] : undefined);
  if (a.includes('-v') || cmd === '-v') return ok(`Server version: Apache/${APV(w)} (${AOS(w)})\nServer built:   2025-07-29T09:59:12`);
  if (a.includes('-V')) return ok(`Server version: Apache/${APV(w)} (${AOS(w)})\nServer built:   2025-07-29T09:59:12\nServer's Module Magic Number: 20120211:${rh(w) ? 129 : 130}\nServer loaded:  APR 1.7.2, APR-UTIL 1.6.3, PCRE 10.42 2022-12-11\nCompiled using: APR 1.7.2, APR-UTIL 1.6.3, PCRE 10.42 2022-12-11\nArchitecture:   64-bit\nServer MPM:     ${(s.apache.modell?.mpm ?? 'mpm_event').replace('mpm_', '')}\n  threaded:     ${s.apache.modell?.mpm === 'mpm_prefork' ? 'no' : 'yes (fixed thread count)'}\n    forked:     yes (variable process count)\nServer compiled with....\n -D APR_HAS_SENDFILE\n -D HTTPD_ROOT="${o.root}"\n -D SUEXEC_BIN="/usr/lib/apache2/suexec"\n -D DEFAULT_PIDLOG="/var/run/apache2.pid"\n -D DEFAULT_ERRORLOG="logs/error_log"\n -D AP_TYPES_CONFIG_FILE="mime.types"\n -D SERVER_CONFIG_FILE="${rh(w) ? 'conf/httpd.conf' : 'apache2.conf'}"`);
  const t = a.includes('-t') || cmd === 'configtest' || a.includes('-S') || a.includes('-M') || a.includes('-l') || cmd === '-S';
  if (a.includes('-l')) return ok(`Compiled in modules:\n  core.c\n  mod_so.c\n  mod_watchdog.c\n  http_core.c\n  mod_log_config.c\n  mod_logio.c\n  mod_version.c\n  mod_unixd.c`);
  if (t) {
    if (direkt && !rh(w) && !w.env.APACHE_RUN_DIR) return fehler(`[${zeitApache(w)}] [core:warn] [pid 4711] AH00111: Config variable \${APACHE_RUN_DIR} is not defined\napache2: Syntax error on line 80 of /etc/apache2/apache2.conf: DefaultRuntimeDir must be a valid directory, absolute or relative to ServerRoot`);
    const r = lesen();
    if ('text' in r) return fehler(r.text);
    const m = r.modell; const warn = [...m.warnungen.filter((x) => !x.startsWith('(98)')), ...mpmWerte(m).warn];
    if (a.includes('-M')) return { out: `Loaded Modules:\n core_module (static)\n so_module (static)\n watchdog_module (static)\n http_module (static)\n log_config_module (static)\n logio_module (static)\n version_module (static)\n unixd_module (static)\n${m.module.map((x) => ` ${x === 'php8.2' ? 'php' : x}_module (shared)`).join('\n')}`, err: warn.join('\n') || undefined, code: 0 };
    if (a.includes('-S') || cmd === '-S' || a.includes('DUMP_VHOSTS')) {
      const gruppen: Record<string, VHost[]> = {};
      for (const v of m.vhosts) for (const ad of v.adr) (gruppen[ad.includes(':') ? ad : `${ad}:80`] ??= []).push(v);
      const vn = (v: VHost) => letzte(v.d, 'servername')?.args[0] ?? (rh(w) ? w.host : '127.0.1.1');
      const zeilen = Object.entries(gruppen).map(([ad, vs]) => vs.length === 1 ? `${ad.padEnd(22)} ${vn(vs[0])} (${vs[0].datei}:${vs[0].zeile})` : `${ad.padEnd(22)} is a NameVirtualHost\n         default server ${vn(vs[0])} (${vs[0].datei}:${vs[0].zeile})\n${vs.map((v) => `         port ${ad.split(':').pop()} namevhost ${vn(v)} (${v.datei}:${v.zeile})${v.d.filter((d) => d.n === 'serveralias').flatMap((d) => d.args).map((al) => `\n                 alias ${al}`).join('')}`).join('\n')}`);
      return { out: `VirtualHost configuration:\n${zeilen.join('\n')}\nServerRoot: "${o.root}"\nMain DocumentRoot: "${(wert(m, 'documentroot')?.[0] ?? (rh(w) ? '/var/www/html' : '/var/www')).replace(/^"|"$/g, '')}"\nMain ErrorLog: "${rh(w) ? '/etc/httpd/logs/error_log' : '/var/log/apache2/error.log'}"\nMutex default: dir="/var/run/apache2/" mechanism=default \nPidFile: "${rh(w) ? '/run/httpd/httpd.pid' : '/var/run/apache2/apache2.pid'}"\nDefine: DUMP_VHOSTS\nDefine: DUMP_RUN_CFG\nUser: name="${o.user}" id=${rh(w) ? 48 : 33}\nGroup: name="${o.user}" id=${rh(w) ? 48 : 33}`, err: warn.join('\n') || undefined, code: 0 };
    }
    return { out: '', err: [...warn, 'Syntax OK'].join('\n'), code: 0 };
  }
  if (!root) return fehler(rh(w) ? `httpd: Could not open configuration file /etc/httpd/conf/httpd.conf: Permission denied` : `Action '${cmd}' failed.\nThe Apache error log may have more information.`.replace(`Action '${cmd}' failed.`, `(13)Permission denied: AH00072: make_sock: could not bind to address [::]:80\n(13)Permission denied: AH00072: make_sock: could not bind to address 0.0.0.0:80\nno listening sockets available, shutting down\nAH00015: Unable to open logs\nAction '${cmd}' failed.`));
  switch (cmd) {
    case 'start': { if (s.apache.laeuft) return ok('httpd (pid ' + s.apache.pid + ') already running'); const e = apacheStarten(w); return e ? fehler(`${e}\nAction 'start' failed.\nThe Apache error log may have more information.`) : ok(); }
    case 'stop': case 'graceful-stop': if (!s.apache.laeuft) return fehler(`httpd (no pid file) not running`); apacheAnhalten(w); return ok();
    case 'restart': { const r = lesen(); if ('text' in r) return fehler(r.text); apacheAnhalten(w); const e = apacheStarten(w); return e ? fehler(e) : ok(); }
    case 'graceful': { const r = lesen(); if ('text' in r) return fehler(r.text); if (!s.apache.laeuft) { const e = apacheStarten(w); return e ? fehler(e) : ok(); } const e = apacheNeuLaden(w); return e ? fehler(e) : ok(); }
    case 'status': case 'fullstatus': return fehler(`/usr/sbin/apache2ctl: 101: www-browser: not found\n'www-browser -dump http://localhost:80/server-status' failed.\nMaybe you need to install a package providing www-browser or you\nneed to adjust the APACHE_LYNX variable in /etc/apache2/envvars`);
    default: return fehler(`Usage: /usr/sbin/${o.bin} [-D name] [-d directory] [-f file]\n                         [-C "directive"] [-c "directive"]\n                         [-k start|restart|graceful|graceful-stop|stop]\n                         [-v] [-V] [-h] [-l] [-L] [-t] [-T] [-S] [-X]`);
  }
}

// ---------- nginx ----------
function nginxBefehl(w: Welt, a: string[], root: boolean): Ergebnis {
  const s = st(w);
  if (!s.nginx.installiert) return fehler('bash: nginx: Befehl nicht gefunden', 127);
  if (a.includes('-v')) return { out: '', err: `nginx version: nginx/${NGINX_VERSION}`, code: 0 };
  if (a.includes('-V')) return { out: '', err: `nginx version: nginx/${NGINX_VERSION}\nbuilt with OpenSSL 3.0.17 1 Jul 2025\nTLS SNI support enabled\nconfigure arguments: --with-cc-opt='-g -O2' --prefix=/usr/share/nginx --conf-path=/etc/nginx/nginx.conf --http-log-path=/var/log/nginx/access.log --error-log-path=stderr --lock-path=/var/lock/nginx.lock --pid-path=/run/nginx.pid --with-http_ssl_module --with-http_v2_module --with-http_realip_module --with-http_stub_status_module`, code: 0 };
  const ci = a.indexOf('-c'); const conf = ci >= 0 ? K.pfad(w, a[ci + 1]) : '/etc/nginx/nginx.conf';
  if (a.includes('-t') || a.includes('-T')) {
    if (!root && !a.includes('-c')) return fehler(`nginx: [alert] could not open error log file: open() "/var/log/nginx/error.log" failed (13: Permission denied)\n${nginxMeldung(w, 'warn', 'the "user" directive makes sense only if the master process runs with super-user privileges, ignored in /etc/nginx/nginx.conf:1')}\nnginx: the configuration file /etc/nginx/nginx.conf syntax is ok\n${nginxMeldung(w, 'emerg', 'open() "/run/nginx.pid" failed (13: Permission denied)')}\nnginx: configuration file /etc/nginx/nginx.conf test failed`);
    const r = nginxLesen(w, conf);
    if ('fehler' in r) return fehler(`${nginxMeldung(w, 'emerg', r.fehler)}\nnginx: configuration file ${conf} test failed`);
    const warn = r.modell.warnungen.map((x) => `nginx: [warn] ${x}`);
    const dump = a.includes('-T') ? '\n' + [...new Set(alleNDir(r.modell.baum).map((d) => d.datei))].map((f) => `# configuration file ${f}:\n${inhalt(w, f)}`).join('\n') : '';
    return { out: dump.replace(/^\n/, ''), err: [...warn, `nginx: the configuration file ${conf} syntax is ok`, `nginx: configuration file ${conf} test is successful`].join('\n'), code: 0 };
  }
  if (!root) return fehler(`nginx: [alert] could not open error log file: open() "/var/log/nginx/error.log" failed (13: Permission denied)`);
  const si = a.indexOf('-s');
  if (si >= 0) {
    const sig = a[si + 1];
    if (!s.nginx.laeuft) return fehler(`${nginxMeldung(w, 'notice', 'signal process started')}\n${nginxMeldung(w, 'error', 'open() "/run/nginx.pid" failed (2: No such file or directory)')}`);
    if (sig === 'stop' || sig === 'quit') { nginxAnhalten(w); return { out: '', err: nginxMeldung(w, 'notice', 'signal process started'), code: 0 }; }
    if (sig === 'reload') { const r = nginxLesen(w); if ('fehler' in r) return fehler(`${nginxMeldung(w, 'emerg', r.fehler)}`); s.nginx.modell = r.modell; return { out: '', err: nginxMeldung(w, 'notice', 'signal process started'), code: 0 }; }
    if (sig === 'reopen') return { out: '', err: nginxMeldung(w, 'notice', 'signal process started'), code: 0 };
    return fehler(`nginx: invalid option: "-s ${sig}"`);
  }
  if (s.nginx.laeuft) return fehler(Array(5).fill('nginx: [emerg] bind() to 0.0.0.0:80 failed (98: Address already in use)').join('\n') + '\nnginx: [emerg] still could not bind()');
  const e = nginxStarten(w); return e ? fehler(e) : ok();
}

// ---------- squid ----------
function squidBefehl(w: Welt, a: string[], root: boolean): Ergebnis {
  const s = st(w);
  if (!s.squid.installiert) return fehler('bash: squid: Befehl nicht gefunden', 127);
  if (a.includes('-v')) return ok(`Squid Cache: Version ${SQUID_VERSION}\nService Name: squid\nDebian linux\n\nThis binary uses OpenSSL 3.0.17 1 Jul 2025. For legal restrictions on distribution see https://www.openssl.org/source/license.html\n\nconfigure options:  '--build=x86_64-linux-gnu' '--prefix=/usr' '--sysconfdir=/etc/squid' '--with-default-user=proxy' '--enable-auth-basic=DB,fake,getpwnam,LDAP,NCSA,PAM,POP3,RADIUS,SASL,SMB'`);
  const fi = a.indexOf('-f'); const conf = fi >= 0 ? K.pfad(w, a[fi + 1]) : '/etc/squid/squid.conf';
  const ki = a.indexOf('-k'); const k = ki >= 0 ? a[ki + 1] : null;
  if (k === 'parse' || k === 'check') {
    const r = squidLesen(w, conf);
    if ('fehler' in r) return { out: '', err: [...r.zeilen, ...r.fehler.split('\n')].join('\n'), code: 1 };
    if (k === 'check') return s.squid.laeuft ? ok() : fehler('squid: ERROR: No running copy');
    return { out: '', err: [...r.modell.zeilen, `${zeitSquid(w)} Initializing https:// proxy context`].join('\n'), code: 0 };
  }
  if (!root) return fehler(`${zeitSquid(w)} ERROR: Could not open /run/squid.pid: (13) Permission denied`);
  if (k === 'reconfigure' || k === 'rotate') {
    if (!s.squid.laeuft) return fehler('squid: ERROR: No running copy');
    if (k === 'rotate') return ok();
    const r = squidLesen(w); if ('fehler' in r) { squidAnhalten(w); s.squid.fehlgeschlagen = true; return { out: '', err: r.fehler, code: 0 }; }
    s.squid.modell = r.modell; return ok();
  }
  if (k === 'shutdown' || k === 'kill' || k === 'interrupt') { if (!s.squid.laeuft) return fehler('squid: ERROR: No running copy'); squidAnhalten(w); return ok(); }
  if (a.includes('-z')) return { out: '', err: `${zeitSquid(w)} Created PID file (/run/squid.pid)\n${zeitSquid(w)} Set Current Directory to /var/spool/squid\n${zeitSquid(w)} Creating missing swap directories\n${zeitSquid(w)} No cache_dir stores are configured.\n${zeitSquid(w)} Removing PID file (/run/squid.pid)`, code: 0 };
  if (s.squid.laeuft) return fehler(`${zeitSquid(w)} FATAL: Squid is already running: Found fresh instance PID file (/run/squid.pid) with PID ${s.squid.pid}`);
  const e = squidStarten(w); return e ? fehler(e) : ok();
}

// ---------- htpasswd ----------
function htpasswd(w: Welt, a: string[], root: boolean): Ergebnis {
  const flags = new Set<string>(); const rest: string[] = [];
  for (const x of a) { if (/^-[a-zA-Z]+$/.test(x)) for (const c of x.slice(1)) flags.add(c); else rest.push(x); }
  const usage = 'Usage:\n\thtpasswd [-cimBdpsDv] [-C cost] passwordfile username\n\thtpasswd -b[cmBdpsDv] [-C cost] passwordfile username password\n\n\thtpasswd -n[imBdps] [-C cost] username\n\thtpasswd -nb[mBdps] [-C cost] username password\n -c  Create a new file.\n -n  Don\'t update file; display results on stdout.\n -b  Use the password from the command line rather than prompting for it.\n -i  Read password from stdin without verification (for script usage).\n -m  Force MD5 encryption of the password (default).\n -B  Force bcrypt encryption of the password (very secure).\n -s  Force SHA encryption of the password (insecure).\n -D  Delete the specified user.\n -v  Verify password for the specified user.';
  const n = flags.has('n');
  const [f, user, pw0] = n ? [null, rest[0], rest[1]] : [rest[0], rest[1], rest[2]];
  if (!user || (flags.has('b') && pw0 === undefined)) return fehler(usage, 2);
  const art: 'apr1' | 'bcrypt' | 'sha' = flags.has('B') ? 'bcrypt' : flags.has('s') ? 'sha' : 'apr1';
  const p = f ? K.pfad(w, f) : '';
  const tun = (pw: string): Ergebnis => {
    const zeile = `${user}:${art === 'bcrypt' ? htHash(w, pw, 'apr1').replace('$apr1$', '$2y$05$') : htHash(w, pw, art)}`;
    if (n) return ok(zeile + '\n');
    const alt = typeof w.fs[p] === 'string' ? (w.fs[p] as string) : null;
    if (flags.has('v')) { if (alt === null) return fehler(`htpasswd: cannot open file ${f} for read access`, 1); const e = htLesen(alt).find((x) => x.user === user); if (!e) return fehler(`User ${user} not found`, 6); return htPruefen(e.hash, pw) ? ok(`Password for user ${user} correct.`) : fehler('password verification failed', 3); }
    if (!flags.has('c') && alt === null) return fehler(`htpasswd: cannot modify file ${f}; use '-c' to create it`, 1);
    const liste = flags.has('c') ? [] : htLesen(alt);
    const vorhanden = liste.some((x) => x.user === user);
    const neu = [...liste.filter((x) => x.user !== user).map((x) => `${x.user}:${x.hash}`), zeile];
    const ordner2 = p.slice(0, p.lastIndexOf('/')) || '/';
    if (!(ordner2 in w.fs)) return fehler(`htpasswd: cannot create file ${f}`, 1);
    const e = K.schreiben(w, p, neu.join('\n'), false, root);
    if (e) return fehler(`htpasswd: cannot ${alt === null ? 'create' : 'modify'} file ${f}`, 1);
    return { out: '', err: `${flags.has('c') && !vorhanden ? 'Adding' : vorhanden ? 'Updating' : 'Adding'} password for user ${user}`, code: 0 };
  };
  if (flags.has('D')) {
    const alt = typeof w.fs[p] === 'string' ? (w.fs[p] as string) : null; if (alt === null) return fehler(`htpasswd: cannot modify file ${f}; use '-c' to create it`, 1);
    const l = htLesen(alt); if (!l.some((x) => x.user === user)) return fehler(`User ${user} not found`, 0);
    const e = K.schreiben(w, p, l.filter((x) => x.user !== user).map((x) => `${x.user}:${x.hash}`).join('\n'), false, root); if (e) return fehler(`htpasswd: cannot modify file ${f}`, 1);
    return { out: '', err: `Deleting password for user ${user}`, code: 0 };
  }
  if (flags.has('b')) return tun(pw0!);
  K.dialog(w, 'New password: ', (p1) => { K.dialog(w, 'Re-type new password: ', (p2) => { if (p1 !== p2) return 'htpasswd: password verification error'; const r = tun(p1); return [r.out, r.err].filter(Boolean).join('\n'); }); return ''; });
  return ok();
}

// =====================================================================================================
// Befehle, systemctl, Pakete
// =====================================================================================================
export function webBefehle(alt: Record<string, B>): Record<string, B> {
  const b: Record<string, B> = {};
  const mit = (n: string, f: B): B => (w, a, i, r) => (webAktiv(w) ? f(w, a, i, r) : alt[n] ? alt[n](w, a, i, r) : fehler(`bash: ${n}: Befehl nicht gefunden`, 127));
  b.curl = mit('curl', (w, a, _i, r) => curl(w, a, r));
  for (const p of ['apache2ctl', 'apachectl', 'apache2', 'httpd']) b[p] = mit(p, (w, a, _i, r) => { if ((p === 'apache2' || p === 'apache2ctl') && rh(w)) return fehler(`bash: ${p}: Befehl nicht gefunden`, 127); if (p === 'httpd' && !rh(w)) return fehler('bash: httpd: Befehl nicht gefunden', 127); return apacheCtl(w, p, a, r || w.root); });
  for (const p of ['a2enmod', 'a2dismod', 'a2ensite', 'a2dissite', 'a2enconf', 'a2disconf']) b[p] = mit(p, (w, a, _i, r) => (st(w).apache.installiert && !rh(w) ? a2(w, p, a, r || w.root) : fehler(`bash: ${p}: Befehl nicht gefunden`, 127)));
  b.a2query = mit('a2query', (w, a) => { if (!st(w).apache.installiert || rh(w)) return fehler('bash: a2query: Befehl nicht gefunden', 127); if (a[0] === '-M') return ok((st(w).apache.modell?.mpm ?? 'mpm_event').replace('mpm_', '')); if (a[0] === '-m') { const n = a[1]; if (!n) return ok(ordnerInhalt(w, '/etc/apache2/mods-enabled').filter((x) => x.endsWith('.load')).map((x) => `${x.split('/').pop()!.replace('.load', '')} (enabled by maintainer script)`).join('\n')); return w.fs[`/etc/apache2/mods-enabled/${n}.load`] !== undefined ? ok(`${n} (enabled by maintainer script)`) : { out: `No module matches ${n}`, code: 32 }; } if (a[0] === '-s') { const n = a[1]; return n ? (w.fs[`/etc/apache2/sites-enabled/${n}.conf`] !== undefined ? ok(`${n} (enabled by site administrator)`) : { out: `No site matches ${n}`, code: 32 }) : ok(ordnerInhalt(w, '/etc/apache2/sites-enabled').map((x) => `${x.split('/').pop()!.replace('.conf', '')} (enabled by site administrator)`).join('\n')); } return fehler('Usage: a2query -q -m [MODULE] -s [SITE] -c [CONF] -M -v -d -h'); });
  b['update-ca-certificates'] = mit('update-ca-certificates', (w, _a, _i, r) => {
    if (rh(w)) return fehler('bash: update-ca-certificates: Befehl nicht gefunden', 127);
    if (!(r || w.root)) return fehler('Updating certificates in /etc/ssl/certs...\nln: failed to create symbolic link \'/etc/ssl/certs/ca-certificates.crt\': Permission denied', 1);
    const eigene = glob(w, '/usr/local/share/ca-certificates/*.crt').concat(glob(w, '/usr/local/share/ca-certificates/*/*.crt'));
    const bundle = '/etc/ssl/certs/ca-certificates.crt'; const basis = zertifikate(w.fs['/etc/ssl/certs/.basis'] as string ?? w.fs[bundle] as string);
    if (!w.fs['/etc/ssl/certs/.basis']) datei(w, '/etc/ssl/certs/.basis', w.fs[bundle] as string ?? '');
    const neu = eigene.flatMap((f) => zertifikate(inhalt(w, f)));
    const vorher = zertifikate(w.fs[bundle] as string).length - basis.length;
    w.fs[bundle] = [...basis, ...neu].map((z) => pem(z)).join('');
    return ok(`Updating certificates in /etc/ssl/certs...\nrehash: warning: skipping ca-certificates.crt,it does not contain exactly one certificate or CRL\n${Math.max(0, neu.length - vorher)} added, ${Math.max(0, vorher - neu.length)} removed; done.\nRunning hooks in /etc/ca-certificates/update.d...\ndone.`);
  });
  b['update-ca-trust'] = mit('update-ca-trust', (w, _a, _i, r) => {
    if (!rh(w)) return fehler('bash: update-ca-trust: Befehl nicht gefunden', 127);
    if (!(r || w.root)) return fehler('p11-kit: couldn\'t create file: /etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem: Permission denied', 1);
    const bundle = '/etc/pki/tls/certs/ca-bundle.crt';
    if (!w.fs['/etc/pki/tls/certs/.basis']) datei(w, '/etc/pki/tls/certs/.basis', w.fs[bundle] as string ?? '');
    const neu = glob(w, '/etc/pki/ca-trust/source/anchors/*').flatMap((f) => zertifikate(inhalt(w, f)));
    w.fs[bundle] = [...zertifikate(w.fs['/etc/pki/tls/certs/.basis'] as string), ...neu].map((z) => pem(z)).join('');
    return ok();
  });
  b.nginx = mit('nginx', (w, a, _i, r) => nginxBefehl(w, a, r || w.root));
  b.squid = mit('squid', (w, a, _i, r) => squidBefehl(w, a, r || w.root));
  b.htpasswd = mit('htpasswd', (w, a, _i, r) => (st(w).apache.installiert || w.pakete?.installiert['apache2-utils'] === 'ii' || w.pakete?.installiert['httpd-tools'] === 'ii' ? htpasswd(w, a, r || w.root) : fehler('bash: htpasswd: Befehl nicht gefunden', 127)));
  // Basic-Anmeldung prüfen wie Squid es tut: Benutzer und Passwort auf der Standardeingabe
  b.basic_ncsa_auth = mit('basic_ncsa_auth', (w, a, i) => { const f = a[0]; const t = f ? inhalt(w, K.pfad(w, f)) : null; if (!f) return fehler('Usage: basic_ncsa_auth <pwfile>'); if (t === null) return fehler(`FATAL: cannot stat ${f}`); return ok(i.split('\n').filter(Boolean).map((z) => { const [u, ...p] = z.split(' '); const e = htLesen(t).find((x) => x.user === u); return e && htPruefen(e.hash, p.join(' ')) ? 'OK' : `ERR message="${e ? 'Wrong password' : 'No such user'}"`; }).join('\n')); });
  // journalctl -u apache2|httpd|nginx|squid
  b.journalctl = (w, a, i, r) => {
    if (!webAktiv(w)) return alt.journalctl(w, a, i, r);
    const ui = a.findIndex((x) => x === '-u' || x === '--unit'); const u = (ui >= 0 ? a[ui + 1] : a.find((x) => x.startsWith('--unit='))?.slice(7))?.replace(/\.service$/, '');
    const d = u === 'apache2' || u === 'httpd' ? st(w).apache : u === 'nginx' ? st(w).nginx : u === 'squid' ? st(w).squid : null;
    if (!d) return alt.journalctl(w, a, i, r);
    if (!(r || w.root) && !/adm|systemd-journal/.test((w.fs['/etc/group'] ?? '').split('\n').filter((z) => z.split(':')[3]?.split(',').includes('lena')).map((z) => z.split(':')[0]).join(' '))) return ok('Hint: You are currently not seeing messages from other users and the system.\n      Users in groups \'adm\', \'systemd-journal\' can see all messages.\n      Pass -q to turn off this notice.\n-- No entries --');
    const ni = a.indexOf('-n'); let z = d.journal.map((e) => `${datumKurz(w, e.ms)} ${w.host} ${e.text}`);
    if (ni >= 0) z = z.slice(-Number(a[ni + 1] ?? 10)); else if (a.some((x) => /^-x?e$/.test(x))) z = z.slice(-30);
    return ok(z.length ? z.join('\n') : '-- No entries --');
  };
  // ss: lauschende Webdienste
  for (const n of ['apt', 'apt-get', 'dnf', 'yum']) {
    const vorher = alt[n]; if (!vorher) continue;
    b[n] = (w, a, i, r) => {
      if (!webAktiv(w)) return vorher(w, a, i, r);
      const s = st(w); const vorPakete = { ...(w.pakete?.installiert ?? {}) };
      const x = vorher(w, a, i, r);
      const nach = () => {
        const p = w.pakete?.installiert ?? {};
        const neu = (q: string) => p[q] === 'ii' && vorPakete[q] !== 'ii';
        const zusatz: string[] = [];
        if ((neu('apache2') || neu('httpd')) && !s.apache.installiert) { apacheInstallieren(w); datei(w, '/usr/bin/htpasswd', '\u0007BIN:30000', 0o755); if (!rh(w)) { const e = apacheStarten(w); if (e) zusatz.push(`Job for apache2.service failed because the control process exited with error code.\nSee "systemctl status apache2.service" and "journalctl -xeu apache2.service" for details.\ninvoke-rc.d: initscript apache2, action "start" failed.`); } }
        if ((neu('apache2-utils') || neu('httpd-tools'))) datei(w, '/usr/bin/htpasswd', '\u0007BIN:30000', 0o755);
        if (neu('mod_ssl') && s.apache.installiert) modSslRh(w);
        if (neu('libapache2-mod-php8.2') && s.apache.installiert && !rh(w)) { const r2 = modAktivieren(w, 'php8.2', true); zusatz.push(...r2.filter((y) => /disabled|Enabling module mpm/.test(y)).map((y) => y.replace('Enabling module mpm_prefork.', 'Enabling module mpm_prefork.\napache2_switch_mpm Switch to prefork')), 'apache2_invoke: Enable module php8.2'); if (s.apache.laeuft) { apacheAnhalten(w); apacheStarten(w); } }
        if (neu('libapache2-mod-perl2') && s.apache.installiert) { datei(w, '/etc/apache2/mods-available/perl.load', 'LoadModule perl_module /usr/lib/apache2/modules/mod_perl.so\n'); datei(w, '/usr/lib/apache2/modules/mod_perl.so', '\u0007BIN:1800000'); link(w, '/etc/apache2/mods-enabled/perl.load', '../mods-available/perl.load'); zusatz.push('apache2_invoke: Enable module perl'); }
        if (neu('php') && rh(w)) { datei(w, '/usr/lib/systemd/system/httpd.service.d/php-fpm.conf', '[Unit]\nWants=php-fpm.service\n'); datei(w, '/etc/httpd/conf.d/php.conf', '#\n# Allow php to handle Multiviews\n#\nAddType text/html .php\n\n#\n# Add index.php to the list of files that will be served as directory\n# indexes.\n#\nDirectoryIndex index.php\n\n# Redirect to local php-fpm (no mod_php in default configuration)\n<IfModule !mod_php.c>\n  # Enable http authorization headers\n  SetEnvIfNoCase ^Authorization$ "(.+)" HTTP_AUTHORIZATION=$1\n\n  <FilesMatch \\.(php|phar)$>\n    SetHandler "proxy:unix:/run/php-fpm/www.sock|fcgi://localhost"\n  </FilesMatch>\n</IfModule>\n'); }
        if (neu('squid') && !s.squid.installiert) { squidInstallieren(w); const e = squidStarten(w); if (e) zusatz.push('Job for squid.service failed because the control process exited with error code.'); }
        if (neu('nginx') && !s.nginx.installiert) { nginxInstallieren(w); const e = nginxStarten(w); if (e) zusatz.push(`Job for nginx.service failed because the control process exited with error code.\nSee "systemctl status nginx.service" and "journalctl -xeu nginx.service" for details.\ninvoke-rc.d: initscript nginx, action "start" failed.\n× nginx.service - A high performance web server and a reverse proxy server\n     Loaded: loaded (/lib/systemd/system/nginx.service; enabled; preset: enabled)\n     Active: failed (Result: exit-code)`); }
        return zusatz;
      };
      if (w.wartet) { const wt = w.wartet; const ak = wt.aktion; wt.aktion = () => { const y = ak(); const z2 = nach(); return z2.length ? { ...y, out: [y.out, ...z2].filter(Boolean).join('\n') } : y; }; return x; }
      const z2 = nach();
      return z2.length ? { ...x, out: [x.out, ...z2].filter(Boolean).join('\n') } : x;
    };
  }
  return b;
}
function datumKurz(w: Welt, ms: number) { const d = new Date(ms + 3600000); const z = (x: number) => String(x).padStart(2, '0'); return `${MON[d.getUTCMonth()]} ${z(d.getUTCDate())} ${z(d.getUTCHours())}:${z(d.getUTCMinutes())}:${z(d.getUTCSeconds())}`; void w; }

netzExtraSockets((w): Sock[] => {
  if (!webAktiv(w)) return [];
  const s = st(w); const out: Sock[] = [];
  if (s.apache.laeuft) for (const l of s.apache.modell!.listen) out.push({ p: 'tcp', s: 'LISTEN', l: `${l.ip === '*' ? '*' : l.ip}:${l.port}`, f: '*:*', prog: ORT(w).bin, pid: s.apache.pid });
  if (s.nginx.laeuft) for (const l of new Map(s.nginx.modell!.server.flatMap((x) => x.listen).map((l) => [`${l.ip}:${l.port}`, l])).values()) out.push({ p: 'tcp', s: 'LISTEN', l: `${l.ip}:${l.port}`, f: '0.0.0.0:*', prog: 'nginx', pid: s.nginx.pid });
  if (s.squid.laeuft) out.push({ p: 'tcp', s: 'LISTEN', l: `*:${s.squid.modell!.port}`, f: '*:*', prog: 'squid', pid: s.squid.pid + 1 });
  return out;
});

export function webSystemctl(w: Welt, a: string[], root: boolean): Ergebnis | null {
  if (!webAktiv(w)) return null;
  const rest = a.filter((x) => !x.startsWith('-')); const [cmd, ...units] = rest;
  const norm = (u: string) => u.replace(/\.service$/, '');
  if (units.map(norm).includes('php-fpm') && w.pakete?.installiert['php-fpm'] === 'ii') {
    const laeuft = w.prozesse.some((p) => p.cmd.startsWith('php-fpm'));
    const an = () => { if (!laeuft) { const pid = w.naechstePid++; w.prozesse.push({ pid, user: 'root', cmd: 'php-fpm: master process (/etc/php-fpm.conf)', ppid: 1, ni: 0, tty: '?', stat: 'Ss', start: '08:41', cpu: 0, mem: 0.6, vsz: 210000, rss: 12000 }); for (let i = 0; i < 5; i++) w.prozesse.push({ pid: w.naechstePid++, user: 'apache', cmd: 'php-fpm: pool www', ppid: pid, ni: 0, tty: '?', stat: 'S', start: '08:41', cpu: 0, mem: 0.4, vsz: 212000, rss: 9000 }); } };
    const aus = () => { w.prozesse = w.prozesse.filter((p) => !p.cmd.startsWith('php-fpm')); };
    if (!root && !['status', 'is-active', 'is-enabled'].includes(cmd)) return fehler(`Failed to ${cmd} php-fpm.service: Access denied`);
    if (cmd === 'start' || cmd === 'restart' || cmd === 'reload') { if (cmd === 'restart') aus(); an(); return ok(); }
    if (cmd === 'stop') { aus(); return ok(); }
    if (cmd === 'enable') { if (a.includes('--now')) an(); return ok('Created symlink /etc/systemd/system/multi-user.target.wants/php-fpm.service → /usr/lib/systemd/system/php-fpm.service.'); }
    if (cmd === 'is-active') return laeuft ? ok('active') : { out: 'inactive', code: 3 };
    if (cmd === 'status') return { out: `${laeuft ? '●' : '○'} php-fpm.service - The PHP FastCGI Process Manager\n     Loaded: loaded (/usr/lib/systemd/system/php-fpm.service; disabled; preset: disabled)\n     Active: ${laeuft ? 'active (running)' : 'inactive (dead)'}`, code: laeuft ? 0 : 3 };
  }
  const u = units.map(norm).find((x) => ['apache2', 'httpd', 'nginx', 'squid'].includes(x));
  if (!cmd || !u) return null;
  const s = st(w);
  const d = u === 'nginx' ? s.nginx : u === 'squid' ? s.squid : s.apache;
  if (!d.installiert || (u === 'apache2' && rh(w)) || (u === 'httpd' && !rh(w))) return fehler(`Unit ${u}.service could not be found.`, cmd === 'status' ? 4 : 5);
  const starten = () => (u === 'nginx' ? nginxStarten(w) : u === 'squid' ? squidStarten(w) : apacheStarten(w));
  const anhalten = () => (u === 'nginx' ? nginxAnhalten(w) : u === 'squid' ? squidAnhalten(w) : apacheAnhalten(w));
  const scheitern = () => fehler(`Job for ${u}.service failed because the control process exited with error code.\nSee "systemctl status ${u}.service" and "journalctl -xeu ${u}.service" for details.`);
  const darfNicht = () => fehler(`Failed to ${cmd} ${u}.service: Access denied\nSee system logs and 'systemctl status ${u}.service' for details.`);
  switch (cmd) {
    case 'start': if (!root) return darfNicht(); return starten() ? scheitern() : ok();
    case 'stop': if (!root) return darfNicht(); anhalten(); return ok();
    case 'restart': if (!root) return darfNicht(); anhalten(); return starten() ? scheitern() : ok();
    case 'reload': {
      if (!root) return darfNicht();
      if (!d.laeuft) return fehler(`${u}.service is not active, cannot reload.`);
      let e: string | null = null;
      if (u === 'nginx') { const r = nginxLesen(w); if ('fehler' in r) { e = r.fehler; journal(w, d, 'nginx', nginxMeldung(w, 'emerg', r.fehler)); } else s.nginx.modell = r.modell; }
      else if (u === 'squid') { const r = squidLesen(w); if ('fehler' in r) { e = r.fehler; for (const z of r.fehler.split('\n')) journal(w, d, 'squid', z); squidAnhalten(w); d.fehlgeschlagen = true; } else s.squid.modell = r.modell; }
      else { e = apacheNeuLaden(w); if (e) for (const z of e.split('\n')) journal(w, d, ORT(w).ctl, z); }
      return e ? fehler(`Job for ${u}.service failed.\nSee "systemctl status ${u}.service" and "journalctl -xeu ${u}.service" for details.`) : ok();
    }
    case 'enable': case 'disable': {
      if (!root) return fehler(`Failed to ${cmd} unit: Access denied`);
      d.enabled = cmd === 'enable';
      const pf = rh(w) ? `/usr/lib/systemd/system/${u}.service` : `/lib/systemd/system/${u}.service`;
      const out = cmd === 'enable' ? (rh(w) ? `Created symlink /etc/systemd/system/multi-user.target.wants/${u}.service → ${pf}.` : `Synchronizing state of ${u}.service with SysV service script with /lib/systemd/systemd-sysv-install.\nExecuting: /lib/systemd/systemd-sysv-install enable ${u}`) : `Removed "/etc/systemd/system/multi-user.target.wants/${u}.service".`;
      if (a.includes('--now')) { if (cmd === 'enable') { if (starten()) { const f2 = scheitern(); return { ...f2, out, err: f2.err }; } } else anhalten(); }
      return ok(out);
    }
    case 'is-active': return d.laeuft ? ok('active') : { out: d.fehlgeschlagen ? 'failed' : 'inactive', code: 3 };
    case 'is-enabled': return d.enabled ? ok('enabled') : { out: 'disabled', code: 1 };
    case 'status': {
      const titel = u === 'nginx' ? 'A high performance web server and a reverse proxy server' : u === 'squid' ? 'Squid Web Proxy Server' : 'The Apache HTTP Server';
      const pf = rh(w) ? `/usr/lib/systemd/system/${u}.service` : `/lib/systemd/system/${u}.service`;
      const dd = new Date(d.start + 3600000); const z2 = (x: number) => String(x).padStart(2, '0'); const seit = `${TAGE[dd.getUTCDay()]} ${dd.getUTCFullYear()}-${z2(dd.getUTCMonth() + 1)}-${z2(dd.getUTCDate())} ${z2(dd.getUTCHours())}:${z2(dd.getUTCMinutes())}:${z2(dd.getUTCSeconds())}`;
      const kopf = [`${d.laeuft ? '●' : d.fehlgeschlagen ? '×' : '○'} ${u}.service - ${titel}`, `     Loaded: loaded (${pf}; ${d.enabled ? 'enabled' : 'disabled'}; preset: ${rh(w) ? 'disabled' : 'enabled'})`, `     Active: ${d.laeuft ? `active (running) since ${seit} CET; ${Math.max(1, Math.round((w.uhr - d.start) / 60000))}min ago` : d.fehlgeschlagen ? `failed (Result: exit-code) since ${seit} CET` : 'inactive (dead)'}`, `       Docs: ${u === 'nginx' ? 'man:nginx(8)' : u === 'squid' ? 'man:squid(8)' : 'https://httpd.apache.org/docs/2.4/'}`];
      if (d.laeuft) kopf.push(`   Main PID: ${d.pid} (${u === 'apache2' ? 'apache2' : u === 'httpd' ? 'httpd' : u})`, `      Tasks: ${u === 'nginx' ? 5 : u === 'squid' ? 4 : 55} (limit: 4558)`);
      const log = d.journal.slice(-8).map((e) => `${datumKurz(w, e.ms)} ${w.host} ${e.text}`);
      return { out: [...kopf, '', ...log].join('\n'), code: d.laeuft ? 0 : 3 };
    }
  }
  return null;
}

// =====================================================================================================
// Zustände für Terminal-Aufgaben
// =====================================================================================================
export function zustandWeb(w: Welt, s: string): boolean | undefined {
  if (!/^(apache|nginx|squid|http|cert|htpasswd|tlsproto|tls)[:(~=]/.test(s)) return undefined;
  if (!webAktiv(w)) return false;
  const x = st(w); let m;
  if (s === 'apache:laeuft') return x.apache.laeuft;
  if (s === 'apache:installiert') return x.apache.installiert;
  if (s === 'apache:enabled') return x.apache.enabled;
  if (s === 'apache:konf-ok') return x.apache.installiert && 'modell' in apacheLesen(w, { envvars: true });
  if ((m = s.match(/^apache:mod:([\w.]+)$/))) return !!x.apache.modell?.module.includes(m[1]);
  if ((m = s.match(/^apache:site:([\w.-]+)$/))) return w.fs[`/etc/apache2/sites-enabled/${m[1]}.conf`] !== undefined;
  if ((m = s.match(/^apache:mpm=(\w+)$/))) return x.apache.modell?.mpm === `mpm_${m[1]}`;
  if ((m = s.match(/^apache:wert:(\w+)=(.+)$/))) { const mm = x.apache.modell; if (!mm) return false; if (/^(maxrequestworkers|startservers|minspareservers|maxspareservers|maxconnectionsperchild|threadsperchild)$/i.test(m[1])) { const v = mpmWerte(mm); const k = m[1].toLowerCase(); const z = k === 'maxrequestworkers' ? v.mrw : k === 'startservers' ? v.start : k === 'minspareservers' ? v.minSpare : k === 'maxspareservers' ? v.maxSpare : k === 'threadsperchild' ? v.threads : v.mcpc; return String(z) === m[2]; } return new RegExp(`^${m[2]}$`, 'i').test(wert(mm, m[1].toLowerCase())?.join(' ') ?? ''); }
  if ((m = s.match(/^apache:vhost:([\w.-]+)(?::(\d+))?$/))) return !!x.apache.modell?.vhosts.some((v) => v.d.some((d) => d.n === 'servername' && d.args[0] === m![1]) && (!m![2] || v.adr.some((a) => a.endsWith(':' + m![2]))));
  if ((m = s.match(/^apache:listen:(\d+)$/))) return !!x.apache.modell?.listen.some((l) => l.port === Number(m![1]));
  if (s === 'nginx:laeuft') return x.nginx.laeuft;
  if (s === 'nginx:konf-ok') return x.nginx.installiert && 'modell' in nginxLesen(w);
  if ((m = s.match(/^nginx:site:([\w.-]+)$/))) return w.fs[`/etc/nginx/sites-enabled/${m[1]}`] !== undefined;
  if (s === 'squid:laeuft') return x.squid.laeuft;
  if (s === 'squid:konf-ok') return x.squid.installiert && 'modell' in squidLesen(w);
  if ((m = s.match(/^squid:wert:([\w_]+)~(.+)$/))) return new RegExp(m[2]).test(x.squid.modell?.werte[m[1]]?.join(' ') ?? '');
  if ((m = s.match(/^squid:acl:([\w-]+)~(.+)$/))) { const a = x.squid.modell?.acls[m[1]]; return !!a && new RegExp(m[2]).test(`${a.typ} ${a.werte.join(' ')}`); }
  // http(OPTIONEN):URL=CODE oder ~REGEX gegen Kopf und Inhalt
  if ((m = s.match(/^http(?:\(([^)]*)\))?:(.+?)(=(\d{3})|~(.+))$/))) {
    const o: Record<string, string> = Object.fromEntries((m[1] ?? '').split(',').filter(Boolean).map((p) => [p.split('=')[0], p.slice(p.indexOf('=') + 1)]));
    const w2 = structuredClone(w) as Welt; (w2 as WW).web = structuredClone(x);
    const args = ['-s', '-i', ...(o.u ? ['-u', o.u.replace('/', ':')] : []), ...(o.ca ? ['--cacert', o.ca] : []), ...(o.proxy ? ['-x', o.proxy] : []), ...(o.pu ? ['-U', o.pu.replace('/', ':')] : []), ...(o.k ? ['-k'] : []), ...(o.tls ? ['--tls-max', o.tls] : []), m[2]];
    if (o.von) { const alt = eigeneIps; void alt; }
    const r = o.von ? vonAus(w2, o.von, args) : curl(w2, args, false);
    if (r.code) return false;
    if (m[4]) return new RegExp(`^HTTP/1.1 ${m[4]} `).test(r.out);
    return new RegExp(m[5], 'm').test(r.out);
  }
  if ((m = s.match(/^tlsproto:([\w.-]+):(\d+)=(.+)$/))) { const ip = aufloesen(w, m[1]).ip; const t = ip ? tlsVon(w, ip, Number(m[2]), m[1]) : null; return !!t && !('fehler' in t) && t.protokolle.join(',') === m[3]; }
  if ((m = s.match(/^tls:([\w.-]+):(\d+)~(.+)$/))) { const ip = aufloesen(w, m[1]).ip; const t = ip ? tlsVon(w, ip, Number(m[2]), m[1]) : null; return !!t && !('fehler' in t) && new RegExp(m[3]).test(t.kette.map((z) => `subject=${nameText(z.subj)} issuer=${nameText(z.iss)} san=${z.san.join(',')}`).join('\n')); }
  if ((m = s.match(/^cert:([^~]+)~(.+)$/))) { const z = zertifikate(inhalt(w, m[1])); return !!z.length && new RegExp(m[2]).test(z.map((c) => `subject=${nameText(c.subj)} issuer=${nameText(c.iss)} san=${c.san.join(',')} ca=${c.ca}`).join('\n')); }
  if ((m = s.match(/^cert:([^:]+):key=(.+)$/))) { const z = zertifikate(inhalt(w, m[1]))[0]; const k = schluesselIn(inhalt(w, m[2])); return !!z && !!k && z.key === k.id; }
  if ((m = s.match(/^htpasswd:([^:]+):(\w+)(?:=(.+))?$/))) { const e = htLesen(inhalt(w, m[1])).find((y) => y.user === m![2]); return !!e && (!m[3] || htPruefen(e.hash, m[3])); }
  return false;
}
/** Anfrage, als käme sie von einem anderen Rechner im Labornetz (für Require ip und allow). */
function vonAus(w: Welt, ip: string, args: string[]): Ergebnis {
  const url = args[args.length - 1]; const mm = url.match(/^(https?):\/\/([^/:]+)(?::(\d+))?(.*)$/); if (!mm) return fehler('url');
  const ziel = aufloesen(w, mm[2]).ip ?? mm[2]; const port = Number(mm[3] ?? (mm[1] === 'https' ? 443 : 80));
  const ui = args.indexOf('-u'); const auth = ui >= 0 ? { user: args[ui + 1].split(':')[0], pw: args[ui + 1].split(':')[1] } : undefined;
  const r = verbinden(w, { methode: 'GET', host: mm[2], pfad: mm[4] || '/', port, tls: mm[1] === 'https', sni: mm[2], client: ip, ziel, kopf: { host: mm[2], 'user-agent': `curl/${CURL_VERSION}`, accept: '*/*' }, auth });
  if ('fehler' in r) return fehler('x', 7);
  return ok(`HTTP/1.1 ${r.status} ${TEXTE[r.status]}\n${r.kopf.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n${r.body}`);
}
