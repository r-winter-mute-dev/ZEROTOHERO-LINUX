// DNS-Server (LPIC-2 Topic 207): BIND 9.18 auf Debian (/etc/bind, Benutzer bind) und 9.16 auf AlmaLinux
// (/etc/named.conf, /var/named, Benutzer named, bind-chroot). Ein Parser für named.conf und Zonendateien mit den
// Meldungen von named-checkconf und named-checkzone, der laufende named mit Zonen, Cache, Rekursion, Weiterleitung,
// Protokoll und Abfrage-Log, rndc, kill -HUP, systemctl, dig/host/nslookup gegen den eigenen Server, Zonentransfer
// zu srv1 (sekundärer Server) mit NOTIFY, Seriennummer und TSIG, dnssec-keygen, dnssec-signzone, tsig-keygen,
// named-compilezone. Ohne Welt-Option `dns` bleibt alles wie bisher.
import type { Welt } from './shell';
import { meta, neuMeta, darf, sha256 } from './shell-dateien';
import { dnsHaken, externAntwort, dnsErreichbar, type DnsAntwort } from './shell-netz';

type Ergebnis = { out: string; err?: string; code: number; errNach?: boolean };
type B = (w: Welt, a: string[], stdin: string, root: boolean) => Ergebnis;
const ok = (out = ''): Ergebnis => ({ out, code: 0 });
const fehler = (err: string, code = 1): Ergebnis => ({ out: '', err, code });

export interface DnsOptionen {
  paket?: boolean;          // BIND ist schon installiert und läuft mit der Standardkonfiguration
  cache?: boolean;          // named.conf.options als Cache fürs Labor eingerichtet
  zone?: boolean | 'ohne-ns2'; // Zone lab.example.org fertig eingerichtet, mit ohne-ns2 fehlen NS und Adresse von srv1
  entwurf?: boolean;        // ~/db.lab.example.org: Max' Entwurf mit drei Fehlern
  rueck?: boolean;          // Rückwärtszone 1.168.192.in-addr.arpa fertig
  sekundaer?: boolean;      // srv1 (192.168.1.10) ist sekundärer Server für lab.example.org
  tsig?: boolean;           // srv1 verlangt den Schlüssel ns1-ns2 für den Transfer, die Datei liegt in /home/lena
  boss?: boolean;           // Montagmorgen: mehrere Fehler auf einmal
}
interface RR { name: string; ttl: number; typ: string; daten: string; zeile: number }
interface Zone { name: string; typ: string; datei?: string; primaries: string[]; allowTransfer?: string[]; allowQuery?: string[]; alsoNotify: string[]; notify?: string; forwarders?: string[]; forward?: string; format?: string; quelle: string; zeile: number }
interface Modell { opt: Record<string, string>; listen: Record<string, string[]>; zonen: Zone[]; acls: Record<string, string[]>; keys: Record<string, { alg: string; secret: string }>; server: Record<string, string[]>; kanaele: Record<string, { datei?: string; zeit: boolean }>; kategorien: Record<string, string[]>; listen6: boolean }
interface Geladen { zone: Zone; rrs: RR[]; serial: number; inhalt: string; signiert: boolean }
interface FernZone { typ: 'primary' | 'secondary'; rrs: RR[]; serial: number; key?: string }
interface DnsStand {
  opt: DnsOptionen;
  installiert: boolean; chrootPaket: boolean;
  laeuft: false | 'named' | 'named-chroot'; enabled: Record<string, boolean>; fehlgeschlagen: boolean;
  start: number; konfiguriert: number;
  modell: Modell | null; zonen: Record<string, Geladen>;
  cache: { name: string; typ: string; antwort: string[] }[];
  querylog: boolean; pid: number; log: { ms: number; text: string }[];
  fern: Record<string, FernZone>; fernKey: { name: string; secret: string } | null;
  schluessel: number;
}
type DW = Welt & { dns?: DnsStand };
const ds = (w: Welt) => (w as DW).dns!;
export const dnsAktiv = (w: Welt) => !!(w as DW).dns;

let K: { pfad: (w: Welt, p: string) => string; installieren: (w: Welt, namen: string[]) => void; benutzer: (w: Welt) => void; datum: (w: Welt, ms: number, fmt?: string) => string };
export function dnsKern(k: typeof K) { K = k; }

// ---------- Orte ----------
const NS1 = ['127.0.0.1', '::1', 'localhost', '192.168.1.23', 'werkstatt', 'werkstatt.lab.example.org', 'ns1.lab.example.org'];
const SRV1 = ['192.168.1.10', 'srv1', 'srv1.lab.example.org', 'ns2.lab.example.org'];
const TSIG = { name: 'ns1-ns2', secret: 'Wq0mK4bXr7hT2c9ZfN1vY8sE3uJ6pL5aD0gH4kR7tQw=' };
const rh = (w: Welt) => w.distro !== 'debian';
const ort = (w: Welt) => rh(w)
  ? { conf: '/etc/named.conf', dir: '/var/named', user: 'named', key: '/etc/rndc.key', version: '9.16.23-RH', exe: '/usr/sbin/named -u named -c /etc/named.conf' }
  : { conf: '/etc/bind/named.conf', dir: '/var/cache/bind', user: 'bind', key: '/etc/bind/rndc.key', version: '9.18.28-1~deb12u2-Debian', exe: '/usr/sbin/named -f -u bind' };
const VERSION_LANG = (w: Welt) => `BIND ${ort(w).version} (Extended Support Version) <id:>`;

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
function protokoll(w: Welt, text: string) { const st = ds(w); st.log.push({ ms: w.uhr, text }); allgemeinInDatei(w, text); }
const zeitBind = (w: Welt) => { const d = new Date(w.uhr + 3600000); const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']; const z = (n: number, l = 2) => String(n).padStart(l, '0'); return `${z(d.getUTCDate())}-${M[d.getUTCMonth()]}-${d.getUTCFullYear()} ${z(d.getUTCHours())}:${z(d.getUTCMinutes())}:${z(d.getUTCSeconds())}.${z(d.getUTCMilliseconds(), 3)}`; };
function inKanal(w: Welt, kat: string, text: string): boolean {
  const m = ds(w).modell; if (!m) return false;
  const kan = m.kategorien[kat]; if (!kan) return false;
  let geschrieben = false;
  for (const k of kan) { const c = m.kanaele[k]; if (!c?.datei) continue; const p = c.datei.startsWith('/') ? c.datei : `${dirVon(w, m)}/${c.datei}`; if (p in w.fs) { w.fs[p] = (w.fs[p] ?? '') + `${c.zeit ? zeitBind(w) + ' ' : ''}${text}\n`; geschrieben = true; } }
  return geschrieben;
}
function allgemeinInDatei(w: Welt, text: string) { inKanal(w, 'default', text) || inKanal(w, 'general', text); }
const dirVon = (w: Welt, m: Modell | null) => (m?.opt.directory ?? ort(w).dir).replace(/\/$/, '');

// ======================= Standarddateien =======================

const DEB_CONF = `// This is the primary configuration file for the BIND DNS server named.
//
// Please read /usr/share/doc/bind9/README.Debian for information on the
// structure of BIND configuration files in Debian, *BEFORE* you customize
// this configuration file.
//
// If you are just adding zones, please do that in /etc/bind/named.conf.local

include "/etc/bind/named.conf.options";
include "/etc/bind/named.conf.local";
include "/etc/bind/named.conf.default-zones";
`;
const DEB_OPTIONS = `options {
\tdirectory "/var/cache/bind";

\t// If there is a firewall between you and nameservers you want
\t// to talk to, you may need to fix the firewall to allow multiple
\t// ports to talk.  See http://www.kb.cert.org/vuls/id/800113

\t// If your ISP provided one or more IP addresses for stable
\t// nameservers, you probably want to use them as forwarders.
\t// Uncomment the following block, and insert the addresses replacing
\t// the all-0's placeholder.

\t// forwarders {
\t// \t0.0.0.0;
\t// };

\t//========================================================================
\t// If BIND logs error messages about the root key being expired,
\t// you will need to update your keys.  See https://www.isc.org/bind-keys
\t//========================================================================
\tdnssec-validation auto;

\tlisten-on-v6 { any; };
};
`;
const CACHE_OPTIONS = `acl labor {
\t192.168.1.0/24;
\tlocalhost;
};

options {
\tdirectory "/var/cache/bind";

\tlisten-on { 127.0.0.1; 192.168.1.23; };
\tlisten-on-v6 { ::1; };

\tallow-query { labor; };
\tallow-recursion { labor; };

\tforwarders { 192.168.1.1; };
\tforward first;

\tdnssec-validation auto;
};
`;
const DEB_LOCAL = `//
// Do any local configuration here
//

// Consider adding the 1918 zones here, if they are not used in your
// organization
//include "/etc/bind/zones.rfc1918";

`;
const DEB_DEFAULT = `// prime the server with knowledge of the root servers
zone "." {
\ttype hint;
\tfile "/usr/share/dns/root.hints";
};

// be authoritative for the localhost forward and reverse zones, and for
// broadcast zones as per RFC 1912

zone "localhost" {
\ttype master;
\tfile "/etc/bind/db.local";
};

zone "127.in-addr.arpa" {
\ttype master;
\tfile "/etc/bind/db.127";
};

zone "0.in-addr.arpa" {
\ttype master;
\tfile "/etc/bind/db.0";
};

zone "255.in-addr.arpa" {
\ttype master;
\tfile "/etc/bind/db.255";
};
`;
const db = (kopf: string, rest: string) => `;\n; ${kopf}\n;\n$TTL\t604800\n@\tIN\tSOA\tlocalhost. root.localhost. (\n\t\t\t      1\t\t; Serial\n\t\t\t 604800\t\t; Refresh\n\t\t\t  86400\t\t; Retry\n\t\t\t2419200\t\t; Expire\n\t\t\t 604800 )\t; Negative Cache TTL\n;\n@\tIN\tNS\tlocalhost.\n${rest}`;
const ROOT_HINTS = `;       This file holds the information on root name servers needed to
;       initialize cache of Internet domain name servers
;       (e.g. reference this file in the "cache  .  <file>"
;       configuration file of BIND domain name servers).
;
;       This file is made available by InterNIC
;       under anonymous FTP as
;           file                /domain/named.cache
;           on server           FTP.INTERNIC.NET
;       -OR-                    RS.INTERNIC.NET
;
;       (gekürzt: im Original stehen alle 13 Root-Server A bis M)
;
.                        3600000      NS    A.ROOT-SERVERS.NET.
A.ROOT-SERVERS.NET.      3600000      A     198.41.0.4
A.ROOT-SERVERS.NET.      3600000      AAAA  2001:503:ba3e::2:30
;
.                        3600000      NS    B.ROOT-SERVERS.NET.
B.ROOT-SERVERS.NET.      3600000      A     170.247.170.2
B.ROOT-SERVERS.NET.      3600000      AAAA  2801:1b8:10::b
;
.                        3600000      NS    M.ROOT-SERVERS.NET.
M.ROOT-SERVERS.NET.      3600000      A     202.12.27.33
M.ROOT-SERVERS.NET.      3600000      AAAA  2001:dc3::35
; End of file
`;
const RH_CONF = `//
// named.conf
//
// Provided by Red Hat bind package to configure the ISC BIND named(8) DNS
// server as a caching only nameserver (as a localhost DNS resolver only).
//
// See /usr/share/doc/bind*/sample/ for example named configuration files.
//

options {
\tlisten-on port 53 { 127.0.0.1; };
\tlisten-on-v6 port 53 { ::1; };
\tdirectory \t"/var/named";
\tdump-file \t"/var/named/data/cache_dump.db";
\tstatistics-file "/var/named/data/named_stats.txt";
\tmemstatistics-file "/var/named/data/named_mem_stats.txt";
\tsecroots-file\t"/var/named/data/named.secroots";
\trecursing-file\t"/var/named/data/named.recursing";
\tallow-query     { localhost; };

\t/*
\t - If you are building an AUTHORITATIVE DNS server, do NOT enable recursion.
\t - If you are building a RECURSIVE (caching) DNS server, you need to enable
\t   recursion.
\t - If your recursive DNS server has a public IP address, you MUST enable access
\t   control to limit queries to your legitimate users. Failing to do so will
\t   cause your server to become part of large scale DNS amplification
\t   attacks. Implementing BCP38 within your network would greatly
\t   reduce such attack surface
\t*/
\trecursion yes;

\tdnssec-validation yes;

\tmanaged-keys-directory "/var/named/dynamic";
\tgeoip-directory "/usr/share/GeoIP";

\tpid-file "/run/named/named.pid";
\tsession-keyfile "/run/named/session.key";

\t/* https://fedoraproject.org/wiki/Changes/CryptoPolicy */
\tinclude "/etc/crypto-policies/back-ends/bind.config";
};

logging {
        channel default_debug {
                file "data/named.run";
                severity dynamic;
        };
};

zone "." IN {
\ttype hint;
\tfile "named.ca";
};

include "/etc/named.rfc1912.zones";
include "/etc/named.root.key";
`;
const RH_RFC1912 = `// named.rfc1912.zones:
//
// Provided by Red Hat caching-nameserver package
//
// ISC BIND named zone configuration for zones recommended by
// RFC 1912 section 4.1 : localhost TLDs and address zones
// and https://tools.ietf.org/html/rfc6303
// (c)2007 R W Franks
//
// See /usr/share/doc/bind*/sample/ for example named configuration files.
//

zone "localhost.localdomain" IN {
\ttype master;
\tfile "named.localhost";
\tallow-update { none; };
};

zone "localhost" IN {
\ttype master;
\tfile "named.localhost";
\tallow-update { none; };
};

zone "1.0.0.127.in-addr.arpa" IN {
\ttype master;
\tfile "named.loopback";
\tallow-update { none; };
};

zone "0.in-addr.arpa" IN {
\ttype master;
\tfile "named.empty";
\tallow-update { none; };
};
`;
const RH_LOCALHOST = `$TTL 1D\n@\tIN SOA\t@ rname.invalid. (\n\t\t\t\t\t0\t; serial\n\t\t\t\t\t1D\t; refresh\n\t\t\t\t\t1H\t; retry\n\t\t\t\t\t1W\t; expire\n\t\t\t\t\t3H )\t; minimum\n\tNS\t@\n\tA\t127.0.0.1\n\tAAAA\t::1\n`;
const RH_LOOPBACK = `$TTL 1D\n@\tIN SOA\t@ rname.invalid. (\n\t\t\t\t\t0\t; serial\n\t\t\t\t\t1D\t; refresh\n\t\t\t\t\t1H\t; retry\n\t\t\t\t\t1W\t; expire\n\t\t\t\t\t3H )\t; minimum\n\tNS\t@\n\tA\t127.0.0.1\n\tAAAA\t::1\n\tPTR\tlocalhost.\n`;
const RH_EMPTY = `$TTL 3H\n@\tIN SOA\t@ rname.invalid. (\n\t\t\t\t\t0\t; serial\n\t\t\t\t\t1D\t; refresh\n\t\t\t\t\t1H\t; retry\n\t\t\t\t\t1W\t; expire\n\t\t\t\t\t3H )\t; minimum\n\tNS\t@\n\tA\t127.0.0.1\n\tAAAA\t::1\n`;

export const LAB_ZONE = `$TTL 3600
@\tIN\tSOA\tns1.lab.example.org. hostmaster.lab.example.org. (
\t\t2026112301 ; Seriennummer
\t\t7200       ; Refresh
\t\t3600       ; Retry
\t\t1209600    ; Expire
\t\t900 )      ; negative TTL
\tIN\tNS\tns1.lab.example.org.
\tIN\tNS\tns2.lab.example.org.
\tIN\tMX\t10 mail.lab.example.org.
ns1\tIN\tA\t192.168.1.23
ns2\tIN\tA\t192.168.1.10
werkstatt\tIN\tA\t192.168.1.23
srv1\tIN\tA\t192.168.1.10
mail\tIN\tA\t192.168.1.25
laser\tIN\tA\t192.168.1.40
www\tIN\tCNAME\tsrv1
`;
const OHNE_NS2 = (t: string) => t.replace('\tIN\tNS\tns2.lab.example.org.\n', '').replace('ns2\tIN\tA\t192.168.1.10\n', '');
const LAB_ALT = LAB_ZONE.replace('2026112301', '2026111601').replace('laser\tIN\tA\t192.168.1.40\n', '');
export const ENTWURF = `; Entwurf von Max für die Zone lab.example.org, bitte prüfen!
$TTL 3600
@\tIN\tSOA\tns1.lab.example.org. hostmaster.lab.example.org. (
\t\t2026112701 ; Seriennummer JJJJMMTTNN
\t\t7200       ; Refresh
\t\t3600       ; Retry
\t\t1209600    ; Expire
\t\t900 )      ; negative TTL
\tIN\tNS\tns1.lab.example.org
\tIN\tMX\t10 mail.lab.example.org.
ns1\tIN\tA\t192.168.1.23
werkstatt\tIN\tA\t192.168.1.23
mail\tIN\tA\t192.168.1.2555
laser\tIN\tA\t192.168.1.40
www\tIN\tCNAME\twerkstatt
www\tIN\tA\t192.168.1.80
info\tIN\tTXT\t"Labor der Werkstatt, Ansprechpartnerin Lena"
`;
const RUECK_ZONE = `$TTL 3600
@\tIN\tSOA\tns1.lab.example.org. hostmaster.lab.example.org. (
\t\t2026112301 7200 3600 1209600 900 )
\tIN\tNS\tns1.lab.example.org.
10\tIN\tPTR\tsrv1.lab.example.org.
23\tIN\tPTR\twerkstatt.lab.example.org.
25\tIN\tPTR\tmail.lab.example.org.
`;
const FERN_WERKHALLE = `$TTL 3600
@\tIN\tSOA\tns.werkhalle.lab.example.org. hostmaster.lab.example.org. 2026110201 7200 3600 1209600 900
\tIN\tNS\tns.werkhalle.lab.example.org.
ns\tIN\tA\t192.168.1.10
presse\tIN\tA\t10.30.0.11
fraese\tIN\tA\t10.30.0.12
`;
const FERN_INTERN = `$TTL 3600
@\tIN\tSOA\tsrv1.firma.intern. hostmaster.firma.intern. 2026100101 7200 3600 1209600 900
\tIN\tNS\tsrv1.firma.intern.
srv1\tIN\tA\t192.168.1.10
wiki\tIN\tA\t192.168.1.10
git\tIN\tA\t192.168.1.11
`;

// ======================= named.conf lesen =======================

interface Tok { v: string; z: number; f: string; q: boolean }
type Teil = { tok: Tok } | { block: Stmt[]; z: number };
interface Stmt { teile: Teil[]; f: string; z: number }

class KonfFehler extends Error { constructor(public text: string) { super(text); } }
function lexen(text: string, f: string): Tok[] {
  const t: Tok[] = []; let i = 0; let z = 1;
  while (i < text.length) {
    const c = text[i];
    if (c === '\n') { z++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '#' || (c === '/' && text[i + 1] === '/')) { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && text[i + 1] === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) { if (text[i] === '\n') z++; i++; } i += 2; continue; }
    if ('{};'.includes(c)) { t.push({ v: c, z, f, q: false }); i++; continue; }
    if (c === '"') { let j = i + 1; let s = ''; while (j < text.length && text[j] !== '"') { if (text[j] === '\n') z++; s += text[j]; j++; } t.push({ v: s, z, f, q: true }); i = j + 1; continue; }
    let s = ''; while (i < text.length && !/[\s{};"#]/.test(text[i]) && !(text[i] === '/' && (text[i + 1] === '/' || text[i + 1] === '*'))) { s += text[i]; i++; }
    t.push({ v: s, z, f, q: false });
  }
  return t;
}
function konfParsen(w: Welt, pfad: string, root: boolean, tiefe = 0): Stmt[] {
  const text = w.fs[pfad];
  if (typeof text !== 'string') throw new KonfFehler(`open: ${pfad}: file not found`);
  if (!darf(w, pfad, 'r', root)) throw new KonfFehler(`open: ${pfad}: permission denied`);
  const toks = lexen(text, pfad); let i = 0;
  const ende = { v: 'end of file', z: (text.match(/\n/g)?.length ?? 0) + 1, f: pfad, q: false };
  const liste = (imBlock: boolean): Stmt[] => {
    const out: Stmt[] = [];
    for (;;) {
      const t = toks[i];
      if (!t) { if (imBlock) throw new KonfFehler(`${pfad}:${ende.z}: '}' expected near end of file`); return out; }
      if (t.v === '}' && !t.q) { if (!imBlock) throw new KonfFehler(`${t.f}:${t.z}: unexpected token near '}'`); i++; return out; }
      if (t.v === ';' && !t.q) { i++; continue; }
      const st: Stmt = { teile: [], f: t.f, z: t.z };
      for (;;) {
        const u = toks[i];
        if (!u) throw new KonfFehler(`${pfad}:${ende.z}: missing ';' at end of file`);
        if (!u.q && u.v === ';') { i++; break; }
        if (!u.q && u.v === '}') throw new KonfFehler(`${u.f}:${u.z}: missing ';' before '}'`);
        if (!u.q && u.v === '{') { i++; st.teile.push({ block: liste(true), z: u.z }); const n = toks[i]; if (n && !n.q && n.v === ';') { i++; break; } if (!n) throw new KonfFehler(`${pfad}:${ende.z}: missing ';' at end of file`); if (!n.q && n.v === '}') throw new KonfFehler(`${n.f}:${n.z}: missing ';' before '}'`); if (!/^(keys|allow|port)$/.test(n.v)) throw new KonfFehler(`${n.f}:${n.z}: missing ';' before '${n.v}'`); continue; }
        st.teile.push({ tok: u }); i++;
      }
      // include sofort einlesen
      const k = (st.teile[0] as { tok: Tok }).tok;
      if (k.v === 'include' && !k.q) {
        const ziel = (st.teile[1] as { tok?: Tok })?.tok?.v ?? '';
        if (tiefe > 8) throw new KonfFehler(`${k.f}:${k.z}: include nesting too deep`);
        try { out.push(...konfParsen(w, ziel.startsWith('/') ? ziel : `${pfad.replace(/\/[^/]*$/, '')}/${ziel}`, root, tiefe + 1)); }
        catch (e) { if (e instanceof KonfFehler && /^open: .*file not found$/.test(e.text)) throw new KonfFehler(`${k.f}:${k.z}: parsing failed: file not found`); throw e; }
        continue;
      }
      out.push(st);
    }
  };
  return liste(false);
}

// ---------- Bedeutung prüfen ----------
type Art = 'w' | 'bool' | 'liste' | 'frei' | 'enum';
interface Spec { art: Art; werte?: string[]; ctx?: string; args?: number }
const W: Spec = { art: 'w' }; const BOOL: Spec = { art: 'bool' }; const LISTE: Spec = { art: 'liste' }; const FREI: Spec = { art: 'frei' };
const E = (...werte: string[]): Spec => ({ art: 'enum', werte });
const OPT_GEMEINSAM: Record<string, Spec> = {
  'allow-query': LISTE, 'allow-query-cache': LISTE, 'allow-recursion': LISTE, 'allow-transfer': LISTE, 'allow-update': LISTE, 'allow-notify': LISTE, 'also-notify': LISTE,
  recursion: BOOL, forwarders: LISTE, forward: E('only', 'first'), notify: E('yes', 'no', 'explicit', 'master-only', 'primary-only'), 'masterfile-format': E('text', 'raw', 'map'),
  'dnssec-validation': E('auto', 'yes', 'no'), 'key-directory': W, 'dnssec-policy': W, 'inline-signing': BOOL, 'check-names': FREI, 'zone-statistics': W, 'auth-nxdomain': BOOL,
  'max-cache-size': W, 'minimal-responses': W, 'match-clients': LISTE, 'match-destinations': LISTE, 'empty-zones-enable': BOOL, 'transfer-source': FREI, 'notify-source': FREI, 'query-source': FREI,
  'max-cache-ttl': W, 'max-ncache-ttl': W, 'validate-except': LISTE,
};
const SPEC: Record<string, Record<string, Spec>> = {
  top: { options: { art: 'frei', ctx: 'options' }, zone: { art: 'frei', ctx: 'zone' }, acl: { art: 'frei', ctx: 'acl' }, key: { art: 'frei', ctx: 'key' }, logging: { art: 'frei', ctx: 'logging' }, controls: FREI, server: { art: 'frei', ctx: 'server' }, view: { art: 'frei', ctx: 'view' }, 'trust-anchors': FREI, 'managed-keys': FREI, 'statistics-channels': FREI, 'dnssec-policy': FREI, tls: FREI, http: FREI, masters: FREI, primaries: FREI },
  options: { ...OPT_GEMEINSAM, directory: W, 'listen-on': LISTE, 'listen-on-v6': LISTE, blackhole: LISTE, version: W, hostname: W, 'server-id': W, querylog: BOOL, 'dump-file': W, 'pid-file': W, 'statistics-file': W, 'memstatistics-file': W, 'session-keyfile': W, 'managed-keys-directory': W, 'bindkeys-file': W, 'secroots-file': W, 'recursing-file': W, 'geoip-directory': W, 'interface-interval': W, 'disable-algorithms': FREI, 'disable-ds-digests': FREI, 'trust-anchor-telemetry': BOOL, include: W, 'disable-empty-zone': W },
  zone: { ...OPT_GEMEINSAM, type: E('primary', 'master', 'secondary', 'slave', 'hint', 'forward', 'stub', 'static-stub', 'redirect', 'mirror', 'delegation-only'), file: W, primaries: LISTE, masters: LISTE, journal: W, 'update-policy': FREI, 'auto-dnssec': W, 'in-view': W },
  key: { algorithm: W, secret: W },
  logging: { channel: { art: 'frei', ctx: 'channel' }, category: FREI },
  channel: { file: FREI, syslog: FREI, stderr: FREI, null: FREI, severity: FREI, 'print-time': W, 'print-severity': W, 'print-category': W, buffered: W },
  server: { keys: LISTE, bogus: BOOL, 'transfer-format': W, 'provide-ixfr': BOOL, 'request-ixfr': BOOL },
  view: { ...OPT_GEMEINSAM, zone: { art: 'frei', ctx: 'zone' }, include: W },
};
const istBool = (s: string) => /^(yes|no|true|false|1|0)$/.test(s);
const tok = (t: Teil | undefined) => (t && 'tok' in t ? t.tok : undefined);
const blk = (s: Stmt) => s.teile.find((t) => 'block' in t) as { block: Stmt[] } | undefined;

function pruefen(stmts: Stmt[], ctx: string, fehler: string[], gesehen = new Set<string>()) {
  for (const s of stmts) {
    const k = tok(s.teile[0])!; const name = k.v;
    if (['acl', 'liste'].includes(ctx)) continue;
    const spec = SPEC[ctx]?.[name];
    if (!spec) { fehler.push(`${k.f}:${k.z}: unknown option '${name}'`); return; }
    const werte = s.teile.slice(1).map(tok).filter(Boolean) as Tok[];
    const b = blk(s);
    if (['w', 'bool', 'enum'].includes(spec.art)) {
      if (gesehen.has(name) && ['options', 'zone', 'key'].includes(ctx)) { fehler.push(`${k.f}:${k.z}: '${name}' redefined near '${name}'`); return; }
      gesehen.add(name);
      if (werte.length > 1) { fehler.push(`${werte[1].f}:${werte[1].z}: missing ';' before '${werte[1].v}'`); return; }
      const v = werte[0]?.v ?? '';
      if (spec.art === 'bool' && !istBool(v)) { fehler.push(`${k.f}:${k.z}: boolean expected near '${v}'`); return; }
      if (spec.art === 'enum' && !spec.werte!.includes(v)) { fehler.push(`${k.f}:${k.z}: '${v}' unexpected`); return; }
    }
    if (spec.art === 'liste' && !b) { const n = werte.find((x) => x.v !== 'port' && !/^\d+$/.test(x.v)); if (n) { fehler.push(`${n.f}:${n.z}: missing '{' near '${n.v}'`); return; } }
    if (spec.ctx && b) {
      if (ctx === 'top' && ['options', 'logging'].includes(name)) { if (gesehen.has(name)) { fehler.push(`${k.f}:${k.z}: '${name}' redefined near '${name}'`); return; } gesehen.add(name); }
      pruefen(b.block, spec.ctx, fehler, new Set());
      if (fehler.length) return;
    }
  }
}

function listeAus(s: Stmt | undefined): string[] {
  const b = s && blk(s); if (!b) return [];
  return b.block.map((x) => x.teile.map((t) => ('tok' in t ? t.tok.v : '{…}')).join(' '));
}
function modellBauen(w: Welt, stmts: Stmt[], fehlerListe: string[]): Modell {
  const m: Modell = { opt: {}, listen: {}, zonen: [], acls: {}, keys: {}, server: {}, kanaele: {}, kategorien: {}, listen6: false };
  const wert = (s: Stmt) => tok(s.teile[1])?.v ?? '';
  const optLesen = (b: Stmt[]) => { for (const s of b) { const n = tok(s.teile[0])!.v; const sp = SPEC.options[n]; if (sp?.art === 'liste') m.listen[n] = listeAus(s); else m.opt[n] = s.teile.slice(1).map((t) => ('tok' in t ? t.tok.v : '')).join(' ').trim(); } };
  const zoneLesen = (s: Stmt) => {
    const n = (tok(s.teile[1])?.v ?? '').replace(/\.$/, '') || '.'; const b = blk(s)?.block ?? [];
    const z: Zone = { name: n.toLowerCase(), typ: '', primaries: [], alsoNotify: [], quelle: s.f, zeile: s.z };
    for (const x of b) {
      const k = tok(x.teile[0])!.v;
      if (k === 'type') z.typ = wert(x); else if (k === 'file') z.datei = wert(x);
      else if (k === 'primaries' || k === 'masters') z.primaries = listeAus(x);
      else if (k === 'allow-transfer') z.allowTransfer = listeAus(x); else if (k === 'allow-query') z.allowQuery = listeAus(x);
      else if (k === 'also-notify') z.alsoNotify = listeAus(x); else if (k === 'notify') z.notify = wert(x);
      else if (k === 'forwarders') z.forwarders = listeAus(x); else if (k === 'forward') z.forward = wert(x);
      else if (k === 'masterfile-format') z.format = wert(x);
    }
    const vorher = m.zonen.find((y) => y.name === z.name);
    if (vorher) fehlerListe.push(`${s.f}:${s.z}: zone '${n}': already exists previous definition: ${vorher.quelle}:${vorher.zeile}`);
    if (['primary', 'master'].includes(z.typ) && !z.datei) fehlerListe.push(`${s.f}:${s.z}: zone '${n}': missing 'file' entry`);
    if (['secondary', 'slave'].includes(z.typ) && !z.primaries.length) fehlerListe.push(`${s.f}:${s.z}: zone '${n}': missing 'primaries' entry`);
    if (z.typ === 'hint' && !z.datei) fehlerListe.push(`${s.f}:${s.z}: zone '${n}': missing 'file' entry`);
    if (!z.typ) fehlerListe.push(`${s.f}:${s.z}: zone '${n}': type not present`);
    m.zonen.push(z);
  };
  let views = false;
  for (const s of stmts) {
    const k = tok(s.teile[0])!.v; const b = blk(s)?.block ?? [];
    if (k === 'options') optLesen(b);
    else if (k === 'zone') zoneLesen(s);
    else if (k === 'acl') m.acls[wert(s)] = listeAus(s);
    else if (k === 'key') { const name = wert(s).replace(/\.$/, ''); m.keys[name] = { alg: b.find((x) => tok(x.teile[0])!.v === 'algorithm') ? wert(b.find((x) => tok(x.teile[0])!.v === 'algorithm')!) : '', secret: b.find((x) => tok(x.teile[0])!.v === 'secret') ? wert(b.find((x) => tok(x.teile[0])!.v === 'secret')!) : '' }; }
    else if (k === 'server') { const ks = b.find((x) => tok(x.teile[0])!.v === 'keys'); m.server[wert(s)] = listeAus(ks).map((x) => x.replace(/\.$/, '')); }
    else if (k === 'view') { views = true; for (const x of b) if (tok(x.teile[0])!.v === 'zone') zoneLesen(x); }
    else if (k === 'logging') {
      for (const x of b) {
        const n = tok(x.teile[0])!.v; const name = wert(x); const xb = blk(x)?.block ?? [];
        if (n === 'channel') { const fs = xb.find((y) => tok(y.teile[0])!.v === 'file'); const pt = xb.find((y) => tok(y.teile[0])!.v === 'print-time'); m.kanaele[name] = { datei: fs ? tok(fs.teile[1])?.v : undefined, zeit: pt ? /^(yes|true|1|local|iso8601.*)$/.test(wert(pt)) : false }; }
        if (n === 'category') m.kategorien[name] = listeAus(x);
      }
      for (const x of b) { if (tok(x.teile[0])!.v !== 'category') continue; for (const c of listeAus(x)) if (!m.kanaele[c] && !['default_syslog', 'default_debug', 'default_stderr', 'default_logfile', 'null'].includes(c)) fehlerListe.push(`${x.f}:${x.z}: undefined channel: '${c}'`); }
    }
  }
  if (views && stmts.some((s) => tok(s.teile[0])!.v === 'zone')) { const z = stmts.find((s) => tok(s.teile[0])!.v === 'zone')!; fehlerListe.push(`${z.f}:${z.z}: when using 'view' statements, all zones must be in views`); }
  // Unbekannte ACL-Namen
  const bekannt = new Set(['any', 'none', 'localhost', 'localnets']);
  const pruefListe = (l: string[] | undefined, s: Stmt | undefined) => { for (const e of l ?? []) { const x = e.replace(/^!\s*/, ''); if (bekannt.has(x) || x.startsWith('key ') || /^[\d.:a-f/]+$/i.test(x) || /^[\d.]+ port \d+$/.test(x) || x === '{…}') continue; if (!m.acls[x]) { fehlerListe.push(`${s?.f ?? ''}:${s?.z ?? 0}: undefined ACL '${x}'`); return; } } };
  const finde = (n: string) => { for (const s of stmts) { const b = blk(s)?.block ?? []; for (const x of b) if (tok(x.teile[0])!.v === n) return x; } return undefined; };
  for (const n of ['allow-query', 'allow-recursion', 'allow-transfer', 'allow-query-cache']) pruefListe(m.listen[n], finde(n));
  for (const z of m.zonen) { pruefListe(z.allowTransfer, finde('allow-transfer')); pruefListe(z.allowQuery, finde('allow-query')); }
  void w;
  return m;
}
/** named-checkconf: Syntax und Bedeutung. Gibt die Fehlerzeilen zurück (leer = in Ordnung). */
function konfPruefen(w: Welt, pfad: string, root: boolean): { modell: Modell | null; fehler: string[] } {
  let stmts: Stmt[];
  try { stmts = konfParsen(w, pfad, root); } catch (e) { if (e instanceof KonfFehler) return { modell: null, fehler: [e.text] }; throw e; }
  const f: string[] = []; pruefen(stmts, 'top', f);
  if (f.length) return { modell: null, fehler: f };
  const m = modellBauen(w, stmts, f);
  return { modell: f.length ? null : m, fehler: f };
}

// ======================= Zonendateien =======================

const TYPEN = ['SOA', 'NS', 'A', 'AAAA', 'CNAME', 'MX', 'PTR', 'TXT', 'SRV', 'CAA', 'TLSA', 'DS', 'DNSKEY', 'RRSIG', 'NSEC', 'NSEC3', 'NSEC3PARAM', 'HINFO', 'SSHFP', 'SPF', 'NAPTR', 'DNAME', 'LOC', 'RP'];
const ttlWert = (s: string): number | null => { if (/^\d+$/.test(s)) return Number(s); const m = s.toLowerCase().match(/^(\d+[smhdw])+$/); if (!m) return null; let t = 0; for (const x of s.toLowerCase().matchAll(/(\d+)([smhdw])/g)) t += Number(x[1]) * ({ s: 1, m: 60, h: 3600, d: 86400, w: 604800 } as Record<string, number>)[x[2]]; return t; };
const istQuad = (s: string) => /^(\d{1,3})(\.\d{1,3}){3}$/.test(s) && s.split('.').every((x) => Number(x) <= 255);
const istV6 = (s: string) => /^[0-9a-f:.]+$/i.test(s) && s.includes(':') && (s.match(/::/g)?.length ?? 0) <= 1 && s.split(':').every((x) => x.length <= 4 || istQuad(x));
interface ZonenLadung { rrs: RR[]; fehler: string[]; warnungen: string[]; serial: number; ok: boolean; ausgabe: string[] }
function absolut(n: string, origin: string) { if (n === '@') return origin; if (n.endsWith('.')) return n.slice(0, -1).toLowerCase() || '.'; return (origin === '.' ? n : `${n}.${origin}`).toLowerCase(); }
const fq = (n: string) => (n === '.' ? '.' : n + '.');

function zoneLesen(w: Welt, zone: string, pfad: string, anzeige: string, root: boolean, format = 'text'): ZonenLadung {
  const l: ZonenLadung = { rrs: [], fehler: [], warnungen: [], serial: 0, ok: false, ausgabe: [] };
  const z = zone.toLowerCase();
  const scheitern = (grund: string) => { l.ausgabe.push(`zone ${zone}/IN: loading from master file ${anzeige} failed: ${grund}`, `zone ${zone}/IN: not loaded due to errors.`); return l; };
  const text = w.fs[pfad];
  if (typeof text !== 'string') return scheitern('file not found');
  if (!darf(w, pfad, 'r', root)) return scheitern('permission denied');
  if (text.startsWith(RAW)) {
    // Als Text gelesen ist eine raw-Datei Zeichensalat: viele Syntaxfehler, dann gibt named auf (gekürzt)
    if (format !== 'raw') { for (let k = 0; k < 3; k++) l.ausgabe.push(`dns_master_load: ${anzeige}:1: syntax error`); l.ausgabe.push(`${anzeige}: file does not end with newline`); return scheitern('syntax error'); }
    try { l.rrs = JSON.parse(decodeURIComponent(escape(atob(text.slice(RAW.length))))); } catch { return scheitern('bad format'); }
  } else {
    if (format === 'raw') return scheitern('bad format');
    let origin = z; let ttlStd: number | null = null; let letzter: string | null = null; let ohneTtlGemeldet = false;
    // Zeilen mit Klammern zusammenfassen, Kommentare entfernen
    const roh = text.split('\n'); const zeilen: { z: number; t: string; einger: boolean }[] = [];
    for (let i = 0; i < roh.length; i++) {
      const start = i; let t = ''; let tiefe = 0; let k = i;
      for (; k < roh.length; k++) {
        let s = ''; let inQ = false;
        for (const c of roh[k]) { if (c === '"') inQ = !inQ; if (c === ';' && !inQ) break; s += c; }
        for (const c of s) { if (c === '(') tiefe++; if (c === ')') tiefe--; }
        t += ' ' + s.replace(/[()]/g, ' ');
        if (tiefe <= 0) break;
      }
      i = k;
      if (t.trim()) zeilen.push({ z: start + 1, t: t.slice(1), einger: /^[ \t]/.test(roh[start]) });
    }
    const minttl = () => { const soa = l.rrs.find((r) => r.typ === 'SOA'); return soa ? Number(soa.daten.split(' ')[6]) : 3600; };
    let ohneOwner = false;
    for (const zl of zeilen) {
      const w0 = zl.t.match(/"[^"]*"|\S+/g) ?? [];
      if (!zl.einger && w0[0]?.startsWith('$')) {
        const d = w0[0].toUpperCase();
        if (d === '$TTL') { const v = ttlWert(w0[1] ?? ''); if (v === null) { l.ausgabe.push(`dns_master_load: ${anzeige}:${zl.z}: unknown directive '${w0[1] ?? ''}'`); return scheitern('bad ttl'); } ttlStd = v; }
        else if (d === '$ORIGIN') origin = absolut(w0[1] ?? '@', origin);
        else if (d === '$INCLUDE') { const inc = w0[1] ?? ''; const ip = inc.startsWith('/') ? inc : K.pfad(w, inc); const x = zoneLesen(w, zone, ip, inc, root); if (!x.ok && !x.rrs.length) return scheitern('file not found'); l.rrs.push(...x.rrs); }
        else { l.ausgabe.push(`${anzeige}:${zl.z}: unknown $directive '${w0[0]}'`); return scheitern('syntax error'); }
        continue;
      }
      let owner: string;
      if (zl.einger) { if (letzter === null) { l.ausgabe.push(`${anzeige}:${zl.z}: no current owner name`); ohneOwner = true; continue; } owner = letzter; }
      else { owner = absolut(w0.shift()!, origin); letzter = owner; }
      let ttl: number | null = null;
      while (w0.length) { const x = w0[0]; const tv = ttlWert(x); if (tv !== null && !TYPEN.includes(x.toUpperCase())) { ttl = tv; w0.shift(); continue; } if (/^(IN|CH|HS)$/i.test(x)) { w0.shift(); continue; } break; }
      const typ = (w0.shift() ?? '').toUpperCase();
      if (!TYPEN.includes(typ)) { l.ausgabe.push(`${anzeige}:${zl.z}: unknown RR type '${typ || '?'}'`); return scheitern('unknown class/type'); }
      const near = (x: string, grund: string) => { l.ausgabe.push(`dns_rdata_fromtext: ${anzeige}:${zl.z}: near '${x}': ${grund}`); return scheitern(grund); };
      const ende = () => { l.ausgabe.push(`dns_rdata_fromtext: ${anzeige}:${zl.z}: near eol: unexpected end of input`); return scheitern('unexpected end of input'); };
      const name = (x: string | undefined) => absolut(x ?? '', origin) + (absolut(x ?? '', origin) === '.' ? '' : '.');
      let daten: string;
      switch (typ) {
        case 'A': { const x = w0[0]; if (!x) return ende(); if (!istQuad(x)) return near(x, 'bad dotted quad'); daten = x; break; }
        case 'AAAA': { const x = w0[0]; if (!x) return ende(); if (!istV6(x)) return near(x, 'bad IPv6 address'); daten = x.toLowerCase(); break; }
        case 'NS': case 'CNAME': case 'PTR': case 'DNAME': if (!w0[0]) return ende(); daten = name(w0[0]); break;
        case 'MX': { if (w0.length < 2) return ende(); if (!/^\d+$/.test(w0[0])) return near(w0[0], 'not a valid number'); daten = `${w0[0]} ${name(w0[1])}`; break; }
        case 'SRV': { if (w0.length < 4) return ende(); for (const x of w0.slice(0, 3)) if (!/^\d+$/.test(x)) return near(x, 'not a valid number'); daten = `${w0.slice(0, 3).join(' ')} ${name(w0[3])}`; break; }
        case 'SOA': {
          if (w0.length < 7) return ende();
          if (!/^\d+$/.test(w0[2])) return near(w0[2], 'not a valid number');
          for (const x of w0.slice(3, 7)) if (ttlWert(x) === null) return near(x, 'not a valid number');
          daten = `${name(w0[0])} ${name(w0[1])} ${w0[2]} ${w0.slice(3, 7).map((x) => ttlWert(x)).join(' ')}`; break;
        }
        case 'TXT': case 'SPF': if (!w0.length) return ende(); daten = w0.map((x) => (x.startsWith('"') ? x : `"${x}"`)).join(' '); break;
        default: if (!w0.length) return ende(); daten = w0.join(' ');
      }
      if (owner !== z && !owner.endsWith('.' + z) && z !== '.') { l.warnungen.push(`${anzeige}:${zl.z}: ignoring out-of-zone data (${owner})`); l.ausgabe.push(`${anzeige}:${zl.z}: ignoring out-of-zone data (${owner})`); continue; }
      if (ttl === null) ttl = ttlStd;
      if (ttl === null) { if (!ohneTtlGemeldet) { l.ausgabe.push(`${anzeige}:${zl.z}: no TTL specified; using SOA MINTTL instead`); ohneTtlGemeldet = true; } ttl = typ === 'SOA' ? Number(daten.split(' ')[6]) : minttl(); }
      // CNAME und andere Daten
      const andere = l.rrs.filter((r) => r.name === owner && !['RRSIG', 'NSEC', 'NSEC3'].includes(r.typ));
      if ((typ === 'CNAME' && andere.length && !['RRSIG', 'NSEC'].includes(typ)) || (typ !== 'CNAME' && !['RRSIG', 'NSEC', 'NSEC3'].includes(typ) && andere.some((r) => r.typ === 'CNAME'))) {
        l.ausgabe.push(`dns_master_load: ${anzeige}:${zl.z}: ${owner}: CNAME and other data`); return scheitern('CNAME and other data');
      }
      l.rrs.push({ name: owner, ttl, typ, daten, zeile: zl.z });
    }
    if (ohneOwner) return scheitern('no owner');
  }
  // Prüfungen nach dem Laden
  const apex = l.rrs.filter((r) => r.name === z);
  const soa = apex.filter((r) => r.typ === 'SOA');
  if (soa.length !== 1) { l.ausgabe.push(`zone ${zone}/IN: has ${soa.length} SOA records`, `zone ${zone}/IN: not loaded due to errors.`); return l; }
  if (z !== '.' && !apex.some((r) => r.typ === 'NS')) { l.ausgabe.push(`zone ${zone}/IN: has no NS records`, `zone ${zone}/IN: not loaded due to errors.`); return l; }
  const imZone = (n: string) => n === z || n.endsWith('.' + z);
  const hatAdresse = (n: string) => l.rrs.some((r) => r.name === n && (r.typ === 'A' || r.typ === 'AAAA'));
  const istCname = (n: string) => l.rrs.some((r) => r.name === n && r.typ === 'CNAME');
  let schlecht = false;
  for (const r of l.rrs.filter((x) => x.typ === 'NS')) { const t = r.daten.replace(/\.$/, ''); if (imZone(t) && !hatAdresse(t)) { l.ausgabe.push(`zone ${zone}/IN: NS '${t}' has no address records (A or AAAA)`); schlecht = true; } }
  for (const r of l.rrs.filter((x) => x.typ === 'MX')) { const t = r.daten.split(' ')[1].replace(/\.$/, ''); if (istCname(t)) l.ausgabe.push(`zone ${zone}/IN: ${r.name}/MX '${t}' is a CNAME (illegal)`); else if (imZone(t) && !hatAdresse(t)) l.ausgabe.push(`zone ${zone}/IN: ${r.name}/MX '${t}' has no address records (A or AAAA)`); }
  if (schlecht) { l.ausgabe.push(`zone ${zone}/IN: not loaded due to errors.`); return l; }
  l.serial = Number(soa[0].daten.split(' ')[2]);
  l.ok = true;
  l.ausgabe.push(`zone ${zone}/IN: loaded serial ${l.serial}${l.rrs.some((r) => r.typ === 'RRSIG') ? ' (DNSSEC signed)' : ''}`);
  return l;
}
const RAW = '\u0007BIN:2048\u0000BINDRAW:';
function rrText(r: RR, breit = false) {
  if (breit) { const n = fq(r.name); return `${n}${'\t'.repeat(Math.max(1, 5 - Math.floor(n.length / 8)))}      ${r.ttl} IN ${r.typ}${r.typ.length < 4 ? '\t\t' : '\t'}${r.daten}`; }
  return `${fq(r.name)}\t${r.ttl}\tIN\t${r.typ}\t${r.daten}`;
}
const sortiert = (rrs: RR[], z: string) => [...rrs].sort((a, b) => {
  const ap = a.name === z ? 0 : 1; const bp = b.name === z ? 0 : 1;
  if (ap !== bp) return ap - bp;
  if (a.name !== b.name) return a.name.localeCompare(b.name);
  return (a.typ === 'SOA' ? 0 : 1) - (b.typ === 'SOA' ? 0 : 1);
});

// ======================= Der laufende Server =======================

function zonenDatei(w: Welt, m: Modell, z: Zone) { const f = z.datei ?? ''; return f.startsWith('/') ? f : `${dirVon(w, m)}/${f}`; }
interface LadeErgebnis { ok: boolean; zeilen: string[] }
/** named startet oder lädt neu. art: start, reload (alles), reconfig (nur neue Zonen), zone (eine Zone). */
function laden(w: Welt, art: 'start' | 'reload' | 'reconfig', nurZone?: string): LadeErgebnis {
  const st = ds(w); const o = ort(w); const zeilen: string[] = [];
  const k = konfPruefen(w, o.conf, true);
  if (!k.modell) {
    const z = [`loading configuration from '${o.conf}'`, ...k.fehler, art === 'start' ? 'loading configuration: failure' : 'reloading configuration failed: failure'];
    if (art === 'start') z.push('exiting (due to fatal error)');
    for (const x of z) protokoll(w, x);
    return { ok: false, zeilen: k.fehler };
  }
  const m = k.modell;
  // Protokolldateien müssen sich öffnen lassen
  for (const c of Object.values(m.kanaele)) {
    if (!c.datei) continue;
    const p = c.datei.startsWith('/') ? c.datei : `${dirVon(w, m)}/${c.datei}`; const dir = p.replace(/\/[^/]*$/, '') || '/';
    const grund = !(dir in w.fs) ? 'file not found' : !(p in w.fs) && !schreibbarFuer(w, dir, o.user) ? 'permission denied' : p in w.fs && !schreibbarFuer(w, p, o.user) ? 'permission denied' : null;
    if (grund) { for (const x of [`loading configuration from '${o.conf}'`, `isc_stdio_open '${p}' failed: ${grund}`, `configuring logging: ${grund}`, `loading configuration: ${grund}`, ...(art === 'start' ? ['exiting (due to fatal error)'] : [])]) protokoll(w, x); return { ok: false, zeilen: [`configuring logging: ${grund}`] }; }
    if (!(p in w.fs)) { w.fs[p] = ''; const mm = meta(w, p); mm.mode = 0o644; mm.owner = o.user; mm.group = o.user; }
  }
  // Red Hat prüft vor dem Start mit named-checkconf -z
  if (art === 'start' && rh(w)) {
    for (const z of m.zonen.filter((x) => ['primary', 'master'].includes(x.typ))) { const l = zoneLesen(w, z.name, zonenDatei(w, m, z), z.datei!, true, z.format); if (!l.ok) { for (const x of l.ausgabe) protokoll(w, x); protokoll(w, `_default/${z.name}/IN: bad zone`); return { ok: false, zeilen: l.ausgabe }; } }
  }
  st.modell = m;
  if (art === 'start') protokoll(w, `starting ${VERSION_LANG(w)}`);
  protokoll(w, `loading configuration from '${o.conf}'`);
  const vorher = st.zonen; const neu: Record<string, Geladen> = {}; const melden: string[] = [];
  for (const z of m.zonen) {
    if (!['primary', 'master'].includes(z.typ)) { if (z.typ === 'hint') { const p = zonenDatei(w, m, z); if (!(p in w.fs)) protokoll(w, `could not configure root hints from '${z.datei}': file not found`); } continue; }
    const p = zonenDatei(w, m, z); const alt = vorher[z.name];
    if (art === 'reconfig' && alt) { neu[z.name] = { ...alt, zone: z }; continue; }
    if (nurZone && z.name !== nurZone && alt) { neu[z.name] = { ...alt, zone: z }; continue; }
    if (art !== 'start' && alt && alt.inhalt === (w.fs[p] ?? null) && !nurZone) { neu[z.name] = { ...alt, zone: z }; continue; }
    const l = zoneLesen(w, z.name, p, z.datei!, true, z.format);
    for (const x of l.ausgabe) protokoll(w, x);
    if (l.ok) {
      neu[z.name] = { zone: z, rrs: l.rrs, serial: l.serial, inhalt: w.fs[p] as string, signiert: l.rrs.some((r) => r.typ === 'RRSIG') };
      if (!alt || alt.serial !== l.serial || art === 'start') melden.push(z.name);
      else if (alt && alt.serial === l.serial && alt.inhalt !== w.fs[p]) protokoll(w, `zone ${z.name}/IN: zone serial (${l.serial}) unchanged. zone may fail to transfer to secondaries.`);
    } else if (alt && art !== 'start') neu[z.name] = alt;
  }
  st.zonen = neu;
  for (const z of melden) benachrichtigen(w, z);
  if (art === 'start') { protokoll(w, 'all zones loaded'); protokoll(w, 'running'); st.start = w.uhr; }
  else if (!nurZone) protokoll(w, art === 'reconfig' ? 'reconfig' : 'reloading configuration succeeded');
  st.konfiguriert = w.uhr;
  if (m.opt.querylog) st.querylog = istBool(m.opt.querylog) && /^(yes|true|1)$/.test(m.opt.querylog);
  else if (m.kategorien.queries) st.querylog = true;
  return { ok: true, zeilen };
}
function schreibbarFuer(w: Welt, p: string, user: string) {
  const m = meta(w, p);
  if (m.owner === user) return (m.mode & 0o200) !== 0;
  if (m.group === user) return (m.mode & 0o020) !== 0;
  return (m.mode & 0o002) !== 0;
}
function starten(w: Welt, unit: 'named' | 'named-chroot'): boolean {
  const st = ds(w);
  if (st.laeuft) return true;
  st.start = w.uhr;
  const r = laden(w, 'start');
  if (!r.ok) { st.fehlgeschlagen = true; return false; }
  st.laeuft = unit; st.fehlgeschlagen = false; st.pid = w.naechstePid++;
  const o = ort(w);
  w.prozesse.push({ pid: st.pid, user: o.user, cmd: o.exe + (unit === 'named-chroot' ? ' -t /var/named/chroot' : ''), ppid: 1, ni: 0, tty: '?', stat: 'Ssl', start: '08:41', cpu: 0.1, mem: 0.7, vsz: 249000, rss: 31000 });
  if (unit === 'named-chroot') chrootEinhaengen(w, true);
  return true;
}
function anhalten(w: Welt) {
  const st = ds(w); if (!st.laeuft) return;
  protokoll(w, 'shutting down'); protokoll(w, 'stopping command channel on 127.0.0.1#953'); protokoll(w, 'exiting');
  if (st.laeuft === 'named-chroot') chrootEinhaengen(w, false);
  st.laeuft = false; w.prozesse = w.prozesse.filter((p) => p.pid !== st.pid); st.cache = [];
}
function chrootEinhaengen(w: Welt, an: boolean) {
  const c = '/var/named/chroot';
  for (const p of ['/etc/named.conf', '/etc/named.rfc1912.zones', '/etc/named.root.key', '/etc/rndc.key']) { if (an && typeof w.fs[p] === 'string') datei(w, c + p, w.fs[p] as string, meta(w, p).mode, meta(w, p).owner, meta(w, p).group); else if (!an) delete w.fs[c + p]; }
  for (const p of Object.keys(w.fs).filter((x) => x.startsWith('/var/named/') && !x.startsWith(c))) { const z = c + p; if (an) { if (w.fs[p] === null) ordner(w, z, meta(w, p).mode, meta(w, p).owner, meta(w, p).group); else datei(w, z, w.fs[p] as string, meta(w, p).mode, meta(w, p).owner, meta(w, p).group); } else if (z !== c + '/var/named') delete w.fs[z]; }
}

// ---------- Transfer zu srv1 ----------
function benachrichtigen(w: Welt, zone: string) {
  const st = ds(w); const g = st.zonen[zone] ?? null; const m = st.modell!;
  const z = m.zonen.find((x) => x.name === zone)!;
  if (z.notify === 'no') return;
  const ziele = new Set<string>(z.alsoNotify.map((x) => x.split(' ')[0]));
  // NOTIFY geht an alle Server aus den NS-Einträgen außer an den Primärserver selbst
  const rrs = g?.rrs ?? [];
  const nsAdr = (n: string) => rrs.filter((r) => r.name === n && r.typ === 'A').map((r) => r.daten);
  for (const r of rrs.filter((x) => x.typ === 'NS' && x.name === zone)) for (const a of nsAdr(r.daten.replace(/\.$/, ''))) if (!['192.168.1.23', '127.0.0.1', '::1'].includes(a)) ziele.add(a);
  if (!ziele.size) return;
  const serial = g ? g.serial : 0;
  protokoll(w, `zone ${zone}/IN: sending notifies (serial ${serial})`);
  if ([...ziele].some((a) => SRV1.includes(a))) srv1Holen(w, zone);
}
function transferErlaubt(w: Welt, zone: string, client: string, key: { name: string; secret: string } | null): 'ok' | 'verboten' | 'badkey' {
  const st = ds(w); const m = st.modell!; const z = m.zonen.find((x) => x.name === zone);
  if (key) { const k = m.keys[key.name]; if (!k || k.secret !== key.secret) return 'badkey'; }
  const liste = z?.allowTransfer ?? m.listen['allow-transfer'] ?? ['any'];
  return passt(w, liste, client, key?.name ?? null) ? 'ok' : 'verboten';
}
function srv1Holen(w: Welt, zone: string) {
  const st = ds(w); const f = st.fern[zone];
  if (!f || f.typ !== 'secondary') return;
  const g = st.zonen[zone]; if (!g) return;
  const key = f.key ? st.fernKey : null;
  const e = transferErlaubt(w, zone, '192.168.1.10', key);
  if (e === 'badkey') { protokoll(w, `client @0x7f3a2c01e168 192.168.1.10#40417: request has invalid signature: TSIG ${key!.name}: tsig verify failure (BADKEY)`); return; }
  if (e === 'verboten') { protokoll(w, `client @0x7f3a2c01e168 192.168.1.10#40417 (${zone}): zone transfer '${zone}/AXFR/IN' denied`); return; }
  if (!(g.serial > f.serial)) return;
  protokoll(w, `client @0x7f3a2c01e168 192.168.1.10#40417${key ? `/key ${key.name}` : ''} (${zone}): transfer of '${zone}/IN': AXFR started (serial ${g.serial})`);
  protokoll(w, `client @0x7f3a2c01e168 192.168.1.10#40417${key ? `/key ${key.name}` : ''} (${zone}): transfer of '${zone}/IN': AXFR ended: 1 messages, ${g.rrs.length + 1} records, ${64 + g.rrs.length * 26} bytes, 0.001 secs (${64 + g.rrs.length * 26}000 bytes/sec) (serial ${g.serial})`);
  f.rrs = g.rrs.map((r) => ({ ...r })); f.serial = g.serial;
}

// ---------- Zugriffslisten ----------
const ipZahl = (ip: string) => ip.split('.').reduce((s, x) => s * 256 + Number(x), 0);
function imNetz(ip: string, cidr: string) { const [n, b] = cidr.split('/'); if (!istQuad(ip) || !istQuad(n.split('.').concat(['0', '0', '0']).slice(0, 4).join('.'))) return ip === n; const netz = n.split('.').concat(['0', '0', '0']).slice(0, 4).join('.'); const bits = b ? Number(b) : n.split('.').length * 8; const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0; return ((ipZahl(ip) & mask) >>> 0) === ((ipZahl(netz) & mask) >>> 0); }
function passt(w: Welt, liste: string[], client: string, key: string | null, tiefe = 0): boolean {
  const m = ds(w).modell!;
  for (const roh of liste) {
    const neg = roh.startsWith('!'); const e = roh.replace(/^!\s*/, '');
    let treffer: boolean;
    if (e === 'any') treffer = true; else if (e === 'none') treffer = false;
    else if (e === 'localhost') treffer = ['127.0.0.1', '::1', '192.168.1.23'].includes(client);
    else if (e === 'localnets') treffer = client === '::1' || imNetz(client, '127.0.0.0/8') || imNetz(client, '192.168.1.0/24');
    else if (e.startsWith('key ')) treffer = key === e.slice(4).replace(/"/g, '').replace(/\.$/, '');
    else if (m.acls[e] && tiefe < 5) treffer = passt(w, m.acls[e], client, key, tiefe + 1) ? true : false;
    else treffer = imNetz(client, e);
    if (treffer) return !neg;
  }
  return false;
}

// ======================= Fragen und Antworten =======================

interface Antwort { status: 'NOERROR' | 'NXDOMAIN' | 'REFUSED' | 'SERVFAIL'; aa: boolean; ra: boolean; ad: boolean; antwort: string[]; autoritaet: string[]; zusatz: string[]; zeit: number; warnung?: boolean }
const leer = (status: Antwort['status'], ra = true): Antwort => ({ status, aa: false, ra, ad: false, antwort: [], autoritaet: [], zusatz: [], zeit: 0 });

function ausZone(rrs: RR[], zone: string, name: string, typ: string, dnssec: boolean): Antwort {
  const r: Antwort = { ...leer('NOERROR', false), aa: true };
  const sig = (n: string, t: string) => (dnssec ? rrs.filter((x) => x.name === n && x.typ === 'RRSIG' && x.daten.startsWith(t + ' ')).map((x) => rrText(x)) : []);
  // Delegation: NS unterhalb der Spitze
  const teile = name.split('.');
  for (let i = 0; i < teile.length; i++) {
    const kand = teile.slice(i).join('.');
    if (kand === zone || !kand.endsWith('.' + zone)) continue;
    const del = rrs.filter((x) => x.name === kand && x.typ === 'NS');
    if (del.length && !(kand === name && typ === 'DS')) {
      r.aa = false; r.autoritaet = del.map((x) => rrText(x));
      for (const d of del) r.zusatz.push(...rrs.filter((x) => x.name === d.daten.replace(/\.$/, '') && (x.typ === 'A' || x.typ === 'AAAA')).map((x) => rrText(x)));
      return { ...r, warnung: true, delegiert: kand } as Antwort & { delegiert: string };
    }
  }
  let n = name;
  for (let schritt = 0; schritt < 8; schritt++) {
    const hier = rrs.filter((x) => x.name === n);
    const cname = hier.find((x) => x.typ === 'CNAME');
    if (cname && typ !== 'CNAME') { r.antwort.push(rrText(cname), ...sig(n, 'CNAME')); n = cname.daten.replace(/\.$/, ''); if (n !== zone && !n.endsWith('.' + zone)) return r; continue; }
    const treffer = typ === 'ANY' ? hier.filter((x) => !['RRSIG', 'NSEC'].includes(x.typ)) : hier.filter((x) => x.typ === typ);
    if (treffer.length) { r.antwort.push(...treffer.map((x) => rrText(x)), ...sig(n, typ)); if (typ === 'MX' || typ === 'NS') for (const t of treffer) { const ziel = t.daten.split(' ').pop()!.replace(/\.$/, ''); r.zusatz.push(...rrs.filter((x) => x.name === ziel && (x.typ === 'A' || x.typ === 'AAAA')).map((x) => rrText(x))); } return r; }
    const soa = rrs.find((x) => x.typ === 'SOA' && x.name === zone)!;
    const soaNeg = { ...soa, ttl: Math.min(soa.ttl, Number(soa.daten.split(' ')[6])) };
    const existiert = rrs.some((x) => x.name === n || x.name.endsWith('.' + n));
    if (!r.antwort.length) { r.status = existiert ? 'NOERROR' : 'NXDOMAIN'; }
    r.autoritaet = [rrText(soaNeg), ...sig(zone, 'SOA')];
    return r;
  }
  return r;
}

function fragen(w: Welt, server: 'ns1' | 'srv1', name0: string, typ: string, client: string, o: { rd: boolean; dnssec: boolean; chaos?: boolean; key?: { name: string; secret: string } | null }): Antwort {
  const st = ds(w); const name = name0.replace(/\.$/, '').toLowerCase() || '.';
  if (server === 'srv1') {
    const zonen = Object.keys(st.fern).filter((z) => (name === z || name.endsWith('.' + z)) && st.fern[z].rrs.length).sort((a, b) => b.length - a.length);
    if (!zonen.length) return leer('REFUSED', false);
    return ausZone(st.fern[zonen[0]].rrs, zonen[0], name, typ, false);
  }
  const m = st.modell!;
  if (o.chaos) {
    if (name === 'version.bind' && typ === 'TXT') {
      const v = m.opt.version;
      if (v === 'none') return { ...leer('NOERROR', false), aa: true, autoritaet: ['version.bind.\t86400\tCH\tNS\tversion.bind.'] };
      return { ...leer('NOERROR', false), aa: true, antwort: [`version.bind.\t0\tCH\tTXT\t"${v ?? ort(w).version}"`], autoritaet: ['version.bind.\t0\tCH\tNS\tversion.bind.'] };
    }
    return leer('REFUSED', false);
  }
  const rekursion = !/^(no|false|0)$/.test(m.opt.recursion ?? 'yes');
  const darfRek = rekursion && passt(w, m.listen['allow-recursion'] ?? m.listen['allow-query-cache'] ?? ['localnets', 'localhost'], client, null);
  if (!passt(w, m.listen['allow-query'] ?? ['any'], client, null)) { protokoll(w, `client @0x7f3a2c03a168 ${client}#53412 (${name}): query (cache) '${name}/${typ}/IN' denied`); return leer('REFUSED', darfRek); }
  if (st.querylog) { const t = `client @0x7f3a2c03a168 ${client}#53412 (${name}): query: ${name} IN ${typ} +${o.rd ? 'E(0)' : 'E(0)'}K (${client === '127.0.0.1' ? '127.0.0.1' : '192.168.1.23'})`; if (!inKanal(w, 'queries', t)) st.log.push({ ms: w.uhr, text: t }); }
  // Eigene Zonen, längster Treffer zuerst
  const eigene = Object.keys(st.zonen).filter((z) => name === z || name.endsWith('.' + z)).sort((a, b) => b.length - a.length);
  if (eigene.length) {
    const z = eigene[0]; const g = st.zonen[z];
    if (g.zone.allowQuery && !passt(w, g.zone.allowQuery, client, null)) return leer('REFUSED', darfRek);
    const r = ausZone(g.rrs, z, name, typ, o.dnssec) as Antwort & { delegiert?: string };
    r.ra = darfRek;
    if (r.delegiert && darfRek && o.rd) {
      // Rekursiv beim zuständigen Server nachfragen (Glue aus der Delegation)
      const glue = r.zusatz.map((x) => x.split('\t').pop()!).find((a) => istQuad(a));
      if (glue && SRV1.includes(glue) && st.fern[r.delegiert]) { const x = ausZone(st.fern[r.delegiert].rrs, r.delegiert, name, typ, false); return { ...x, aa: false, ra: true, zeit: 3 }; }
      return { ...leer('SERVFAIL'), zeit: 2004 };
    }
    return r;
  }
  if (!darfRek) return { ...leer('REFUSED', false), warnung: true };
  if (!o.rd) { const c = st.cache.find((x) => x.name === name && x.typ === typ); return c ? { ...leer('NOERROR'), antwort: c.antwort } : leer('NOERROR'); }
  // Weiterleitungszonen
  const fz = m.zonen.filter((z) => z.typ === 'forward' && (name === z.name || name.endsWith('.' + z.name))).sort((a, b) => b.name.length - a.name.length)[0];
  const cache = st.cache.find((x) => x.name === name && x.typ === typ);
  if (cache) return { ...leer('NOERROR'), antwort: cache.antwort, ad: !/no/.test(m.opt['dnssec-validation'] ?? 'yes') && /example\.org$/.test(name), zeit: 0 };
  let ergebnis: { status: 'NOERROR' | 'NXDOMAIN'; antwort: string[] } | null = null; let zeit = 41;
  const fragFern = (ip: string) => {
    if (SRV1.includes(ip)) { const zs = Object.keys(st.fern).filter((z) => name === z || name.endsWith('.' + z)).sort((a, b) => b.length - a.length); if (!zs.length) return null; const x = ausZone(st.fern[zs[0]].rrs, zs[0], name, typ, false); return { status: x.status === 'NXDOMAIN' ? 'NXDOMAIN' as const : 'NOERROR' as const, antwort: x.antwort }; }
    if (!dnsErreichbar(w, ip)) return null;
    return externAntwort(name, typ);
  };
  const forwarders = (fz ? fz.forwarders : undefined) ?? (m.listen.forwarders ?? []);
  const modus = (fz ? fz.forward : undefined) ?? m.opt.forward ?? 'first';
  for (const f of forwarders.map((x) => x.split(' ')[0])) { ergebnis = fragFern(f); if (ergebnis) { zeit = 12; break; } }
  if (!ergebnis && forwarders.length && modus === 'only') return { ...leer('SERVFAIL'), zeit: 3012 };
  if (!ergebnis && !fz) {
    const hint = m.zonen.find((z) => z.typ === 'hint');
    if (!hint || !(zonenDatei(w, m, hint) in w.fs) || !dnsErreichbar(w, '203.0.113.53')) return { ...leer('SERVFAIL'), zeit: 3008 };
    ergebnis = externAntwort(name, typ); zeit = 87;
  }
  if (!ergebnis) return { ...leer('SERVFAIL'), zeit: 3012 };
  // Private Namen ohne Delegation von der Wurzel: Mit DNSSEC-Prüfung beweist die signierte Wurzel, dass es sie nicht gibt
  const privat = /(^|\.)(intern|internal|local|lan|corp)$/.test(name);
  const ausgenommen = (m.listen['validate-except'] ?? []).map((x) => x.replace(/^"|"$/g, '').replace(/\.$/, '').toLowerCase()).some((x) => name === x || name.endsWith('.' + x));
  if (privat && !/no/.test(m.opt['dnssec-validation'] ?? 'yes') && !ausgenommen) {
    const quelle = forwarders[0]?.split(' ')[0] ?? '192.168.1.1';
    protokoll(w, `validating ${name}/${typ}: got insecure response; parent indicates it should be secure`);
    protokoll(w, `insecurity proof failed resolving '${name}/${typ}/IN': ${quelle}#53`);
    return { ...leer('SERVFAIL'), zeit: 14 };
  }
  if (ergebnis.antwort.length) st.cache.push({ name, typ, antwort: ergebnis.antwort });
  return { ...leer(ergebnis.status), antwort: ergebnis.antwort, ad: !/no/.test(m.opt['dnssec-validation'] ?? 'yes') && /example\.org$/.test(name), zeit, autoritaet: ergebnis.status === 'NXDOMAIN' ? ['example.org.\t900\tIN\tSOA\tns1.example.org. hostmaster.example.org. 2026112301 7200 3600 1209600 900'] : [] };
}
const welcherServer = (w: Welt, s: string): 'ns1' | 'srv1' | null => (dnsAktiv(w) && NS1.includes(s) ? 'ns1' : dnsAktiv(w) && SRV1.includes(s) && Object.keys(ds(w).fern).length ? 'srv1' : null);
function erreichbar(w: Welt, srv: 'ns1' | 'srv1', s: string): boolean {
  if (srv === 'srv1') return true;
  const st = ds(w); if (!st.laeuft || !st.modell) return false;
  const v6 = s === '::1'; const adr = s === 'localhost' ? '127.0.0.1' : NS1.includes(s) && !istQuad(s) && !v6 ? '192.168.1.23' : s;
  const l = v6 ? st.modell.listen['listen-on-v6'] ?? ['any'] : st.modell.listen['listen-on'] ?? ['any'];
  if (v6) return !l.includes('none');
  return l.some((x) => x === 'any' || x === adr || (x.includes('/') && imNetz(adr, x)) || (x === 'localhost' && ['127.0.0.1', '192.168.1.23'].includes(adr)));
}

// Für ping, getent und die alten Befehle: Anfragen an den eigenen Server
dnsHaken.push((w, name, typ, server) => {
  const srv = welcherServer(w, server); if (!srv) return null;
  if (!erreichbar(w, srv, server)) return { fehler: 'refused', server };
  const a = fragen(w, srv, name, typ, server === '127.0.0.1' || server === 'localhost' ? '127.0.0.1' : '192.168.1.23', { rd: true, dnssec: false });
  if (a.status === 'REFUSED' || a.status === 'SERVFAIL') return { status: 'NXDOMAIN', antwort: [], server } as DnsAntwort;
  return { status: a.status, antwort: a.antwort, server } as DnsAntwort;
});

// ---------- dig, host, nslookup ----------
function digAusgabe(w: Welt, args: string, srvAdr: string, typ: string, name: string, a: Antwort, o: { kurz: boolean; nurAntwort: boolean; chaos: boolean; dnssec: boolean; rd: boolean }) {
  if (o.kurz) return a.antwort.filter((x) => !/\tRRSIG\t/.test(x) || o.dnssec).map((x) => x.split('\t').pop()).join('\n');
  if (o.nurAntwort) return a.antwort.join('\n');
  const flags = ['qr', a.aa ? 'aa' : '', o.rd ? 'rd' : '', a.ra ? 'ra' : '', a.ad ? 'ad' : ''].filter(Boolean).join(' ');
  const zeilen = [``, `; <<>> DiG ${ort(w).version} <<>> ${args}`, `; (1 server found)`, `;; global options: +cmd`, `;; Got answer:`, `;; ->>HEADER<<- opcode: QUERY, status: ${a.status}, id: ${4000 + (w.uhr / 20000 % 60000 | 0)}`, `;; flags: ${flags}; QUERY: 1, ANSWER: ${a.antwort.length}, AUTHORITY: ${a.autoritaet.length}, ADDITIONAL: ${a.zusatz.length + 1}`];
  if (o.rd && !a.ra) zeilen.push(';; WARNING: recursion requested but not available');
  zeilen.push('', ';; OPT PSEUDOSECTION:', `; EDNS: version: 0, flags:${o.dnssec ? ' do' : ''}; udp: 1232`, `; COOKIE: 6c9d4f2a8e1b7c35010000006b09${(w.uhr % 0xffffffff).toString(16).padStart(8, '0')}${sha256(String(w.uhr)).slice(0, 12)} (good)`, ';; QUESTION SECTION:', `;${fq(name.replace(/\.$/, '') || '.')}\t\t${o.chaos ? 'CH' : 'IN'}\t${typ}`);
  if (a.antwort.length) zeilen.push('', ';; ANSWER SECTION:', ...a.antwort);
  if (a.autoritaet.length) zeilen.push('', ';; AUTHORITY SECTION:', ...a.autoritaet);
  if (a.zusatz.length) zeilen.push('', ';; ADDITIONAL SECTION:', ...a.zusatz);
  zeilen.push('', `;; Query time: ${a.zeit} msec`, `;; SERVER: ${srvAdr}#53(${srvAdr}) (UDP)`, `;; WHEN: ${K.datum({ ...w, env: { ...w.env, LANG: 'C' } } as Welt, w.uhr)}`, `;; MSG SIZE  rcvd: ${60 + a.antwort.length * 28 + a.autoritaet.length * 50}`);
  return zeilen.join('\n');
}
function keyAus(w: Welt, a: string[], root: boolean): { name: string; secret: string } | null | string {
  const yi = a.indexOf('-y'); const ki = a.indexOf('-k');
  if (yi >= 0) { const t = (a[yi + 1] ?? '').split(':'); const [name, secret] = t.length === 3 ? [t[1], t[2]] : [t[0], t[1]]; return { name: (name ?? '').replace(/\.$/, ''), secret: secret ?? '' }; }
  if (ki >= 0) {
    const p = K.pfad(w, a[ki + 1] ?? ''); const c = w.fs[p];
    if (typeof c !== 'string') return `dig: could not read key from ${a[ki + 1]}: file not found`;
    if (!darf(w, p, 'r', root)) return `dig: could not read key from ${a[ki + 1]}: permission denied`;
    const n = c.match(/key\s+"?([^"\s{]+)"?\s*\{/)?.[1]; const s = c.match(/secret\s+"([^"]+)"/)?.[1];
    if (!n || !s) return `dig: could not read key from ${a[ki + 1]}: unexpected token`;
    return { name: n.replace(/\.$/, ''), secret: s };
  }
  return null;
}
const TYPNAMEN = /^(A|AAAA|MX|NS|CNAME|PTR|SOA|TXT|ANY|SRV|AXFR|IXFR|DNSKEY|DS|RRSIG|TLSA|CAA|HINFO|NSEC)$/i;

// ======================= Werkzeuge =======================

function checkconf(w: Welt, a: string[], root: boolean): Ergebnis {
  if (!hatUtils(w)) return nichtDa('named-checkconf', rh(w) ? 'bind' : 'bind9-utils');
  const z = a.includes('-z'); const p = a.includes('-p');
  const datei0 = a.filter((x, i) => !x.startsWith('-') && !['-t'].includes(a[i - 1] ?? ''))[0];
  const pfad = datei0 ? K.pfad(w, datei0) : ort(w).conf;
  if (!datei0 && !(pfad in w.fs)) return fehler(`open: ${pfad}: file not found`);
  const r = konfPruefen(w, pfad, root);
  if (!r.modell) return fehler(r.fehler.join('\n'));
  if (p) return ok((w.fs[pfad] ?? '').replace(/\/\/.*$/gm, '').replace(/\n{2,}/g, '\n').trim());
  if (!z) return ok();
  const out: string[] = []; let schlecht = false;
  for (const zz of r.modell.zonen.filter((x) => ['primary', 'master'].includes(x.typ))) {
    const l = zoneLesen(w, zz.name, zonenDatei(w, r.modell, zz), zz.datei!, root, zz.format);
    out.push(...l.ausgabe.filter((x) => !/^zone .*: not loaded due to errors\.$/.test(x) || true).map((x) => x.replace(/^zone ([^/]+)\/IN: loaded serial/, 'zone $1/IN: loaded serial')));
    if (!l.ok) { schlecht = true; out.push(`_default/${zz.name}/IN: bad zone`); }
  }
  return schlecht ? { out: '', err: out.join('\n'), code: 1 } : ok(out.join('\n'));
}
function checkzone(w: Welt, a: string[], root: boolean, compile: boolean): Ergebnis {
  const prog = compile ? 'named-compilezone' : 'named-checkzone';
  if (!hatUtils(w)) return nichtDa(prog, rh(w) ? 'bind' : 'bind9-utils');
  let f = 'text'; let F = 'text'; let o: string | undefined; let D = compile; const frei: string[] = [];
  for (let i = 0; i < a.length; i++) { const x = a[i]; if (x === '-f') f = a[++i]; else if (x === '-F') F = a[++i]; else if (x === '-o') o = a[++i]; else if (x === '-D') D = true; else if (['-k', '-i', '-n', '-m', '-M', '-S', '-T', '-W', '-t', '-w', '-c', '-s'].includes(x)) i++; else if (x.startsWith('-')) continue; else frei.push(x); }
  const [zone, dat] = frei;
  if (!zone || !dat) return fehler(`usage: ${prog} [-djqvD] [-c class] [-f inputformat] [-F outputformat] [-J filename] [-s (full|relative)] [-t directory] [-w directory] [-k (ignore|warn|fail)] [-n (ignore|warn|fail)] [-m (ignore|warn|fail)] [-r (ignore|warn|fail)] [-i (full|full-sibling|local|local-sibling|none)] [-M (ignore|warn|fail)] [-S (ignore|warn|fail)] [-W (ignore|warn)] [-o filename] zonename filename`, 1);
  if (compile && !o) return fehler(`${prog}: output file required`, 1);
  const l = zoneLesen(w, zone.replace(/\.$/, ''), K.pfad(w, dat), dat, root, f);
  if (!l.ok) return { out: l.ausgabe.join('\n'), code: 1 };
  const out = [...l.ausgabe];
  const z = zone.replace(/\.$/, '').toLowerCase();
  if (o) {
    const inhalt = F === 'raw' ? RAW + btoa(unescape(encodeURIComponent(JSON.stringify(l.rrs)))) : sortiert(l.rrs, z).map((r) => rrText(r, true)).join('\n') + '\n';
    if (o === '-') return ok([...out, sortiert(l.rrs, z).map((r) => rrText(r, true)).join('\n')].join('\n'));
    const p = K.pfad(w, o);
    const dir = p.replace(/\/[^/]*$/, '') || '/';
    if (!darf(w, dir, 'w', root)) return { out: [...out, `dump zone to ${o}...failed: permission denied`].join('\n'), code: 1 };
    w.fs[p] = inhalt; neuMeta(w, p, root, false);
    out.push(`dump zone to ${o}...done`);
  }
  out.push('OK');
  if (D && !o) out.push(sortiert(l.rrs, z).map((r) => rrText(r, true)).join('\n'));
  return ok(out.join('\n'));
}
const hatUtils = (w: Welt) => typeof w.fs['/usr/bin/named-checkconf'] === 'string' || typeof w.fs['/usr/sbin/named-checkconf'] === 'string';
const nichtDa = (n: string, paket: string) => fehler(`bash: ${n}: Befehl nicht gefunden\n(${n} gehört zum Paket ${paket}: sudo ${paket.startsWith('bind') && paket !== 'bind9-utils' ? 'dnf' : 'apt'} install ${paket})`, 127);

function rndc(w: Welt, a: string[], root: boolean): Ergebnis {
  const st = ds(w); const o = ort(w);
  if (!(o.key in w.fs) || !st.installiert) return nichtDa('rndc', rh(w) ? 'bind' : 'bind9-utils');
  if (!darf(w, o.key, 'r', root)) return fehler(`rndc: error: open: ${o.key}: permission denied\nrndc: could not load rndc configuration`);
  const [cmd, ...rest] = a.filter((x) => !x.startsWith('-'));
  if (!cmd) return fehler('Usage: rndc [-b address] [-c config] [-s server] [-p port]\n\t[-k key-file ] [-y key] [-r] [-V] [-4 | -6] command\n\ncommand is one of the following:\n\n  dumpdb [-all|-cache|-zones|-adb|-bad|-expired|-fail] [view ...]\n  flush [view]\n  flushname name [view]\n  notify zone [class [view]]\n  querylog [ on | off ]\n  reconfig\n  reload\n  reload zone [class [view]]\n  retransfer zone [class [view]]\n  status\n  stop\n  zonestatus zone [class [view]]\n  (gekürzt)', 1);
  if (!st.laeuft) return fehler('rndc: connect failed: 127.0.0.1#953: connection refused');
  const m = st.modell!;
  switch (cmd) {
    case 'status': {
      const zonen = m.zonen.length + (/^(no|false|0)$/.test(m.opt.recursion ?? 'yes') ? 0 : 97); const auto = /^(no|false|0)$/.test(m.opt.recursion ?? 'yes') ? 0 : 97;
      const d = (ms: number) => new Date(ms).toUTCString();
      return ok(`version: ${VERSION_LANG(w)}\nrunning on localhost: Linux x86_64 ${w.kernel} #1 SMP PREEMPT_DYNAMIC ${rh(w) ? "Wed Sep 25 2024" : "Debian 6.1.115-1 (2024-11-01)"}\nboot time: ${d(st.start)}\nlast configured: ${d(st.konfiguriert)}\nconfiguration file: ${o.conf}${st.laeuft === 'named-chroot' ? ' (/var/named/chroot/etc/named.conf)' : ''}\nCPUs found: 4\nworker threads: 4\nUDP listeners per interface: 4\nnumber of zones: ${zonen} (${auto} automatic)\ndebug level: 0\nxfers running: 0\nxfers deferred: 0\nsoa queries in progress: 0\nquery logging is ${st.querylog ? 'ON' : 'OFF'}\nrecursive clients: 0/900/1000\ntcp clients: 0/150\nTCP high-water: 0\nserver is up and running`);
    }
    case 'reload': {
      if (rest[0]) {
        const z = rest[0].replace(/\.$/, '').toLowerCase();
        const zz = m.zonen.find((x) => x.name === z && ['primary', 'master'].includes(x.typ));
        if (!zz) return fehler(`rndc: 'reload' failed: not found\nno matching zone '${rest[0]}' in any view`);
        const g = st.zonen[z]; const neu = w.fs[zonenDatei(w, m, zz)];
        if (g && g.inhalt === neu) return ok('zone reload up-to-date');
        laden(w, 'reload', z); return ok('zone reload queued');
      }
      const r = laden(w, 'reload'); return r.ok ? ok('server reload successful') : fehler("rndc: 'reload' failed: failure");
    }
    case 'reconfig': { const r = laden(w, 'reconfig'); return r.ok ? ok() : fehler("rndc: 'reconfig' failed: failure"); }
    case 'flush': st.cache = []; protokoll(w, 'flushing caches in all views succeeded'); return ok();
    case 'flushname': { const n = (rest[0] ?? '').replace(/\.$/, '').toLowerCase(); st.cache = st.cache.filter((c) => c.name !== n); protokoll(w, `flushing name '${rest[0]}' in all cache views succeeded`); return ok(); }
    case 'querylog': { st.querylog = rest[0] ? /^(on|yes|true)$/.test(rest[0]) : !st.querylog; protokoll(w, `query logging is now ${st.querylog ? 'on' : 'off'}`); return ok(); }
    case 'dumpdb': {
      const ziel = (m.opt['dump-file'] ?? 'named_dump.db'); const p = ziel.startsWith('/') ? ziel : `${dirVon(w, m)}/${ziel}`;
      const zonen = a.includes('-zones') || a.includes('-all');
      const cache = !a.includes('-zones');
      const t = [`;\n; Start view _default\n;\n;\n; Cache dump of view '_default' (cache _default)\n;\n; using a 0 second stale ttl\n$DATE ${K.datum({ ...w, env: { ...w.env, LANG: 'C' } } as Welt, w.uhr, '%Y%m%d%H%M%S')}`,
        ...(cache ? st.cache.flatMap((c) => c.antwort.map((x) => x.replace(/\t/g, ' '))) : []),
        ...(zonen ? Object.values(st.zonen).flatMap((g) => [`;\n; Zone dump of '${g.zone.name}/IN'\n;`, ...sortiert(g.rrs, g.zone.name).map((r) => rrText(r))]) : []), '; Dump complete'];
      w.fs[p] = t.join('\n') + '\n'; const mm = meta(w, p); mm.owner = o.user; mm.group = o.user; mm.mode = 0o644; mm.mtime = w.uhr;
      return ok();
    }
    case 'stop': case 'halt': anhalten(w); return ok();
    case 'zonestatus': {
      const z = (rest[0] ?? '').replace(/\.$/, '').toLowerCase(); const g = st.zonen[z];
      if (!g) return fehler(`rndc: 'zonestatus' failed: not found\nno matching zone '${rest[0] ?? ''}' in any view`);
      return ok(`name: ${z}\ntype: primary\nfiles: ${g.zone.datei}\nserial: ${g.serial}\nnodes: ${new Set(g.rrs.map((r) => r.name)).size}\nlast loaded: ${new Date(st.konfiguriert).toUTCString()}\nsecure: ${g.signiert ? 'yes' : 'no'}\ndynamic: no\nreconfigurable via modzone: no`);
    }
    case 'notify': { const z = (rest[0] ?? '').replace(/\.$/, '').toLowerCase(); if (!st.zonen[z]) return fehler(`rndc: 'notify' failed: not found\nno matching zone '${rest[0] ?? ''}' in any view`); benachrichtigen(w, z); return ok('zone notify queued'); }
    case 'retransfer': return fehler(`rndc: 'retransfer' failed: failure\n'${rest[0] ?? ''}' is not a secondary zone`);
    default: return fehler(`rndc: '${cmd}' failed: unknown command`);
  }
}

// ---------- DNSSEC und TSIG ----------
function b64(s: string, n: number) { let h = sha256(s); while (h.length < n * 2) h += sha256(h); const bytes = h.slice(0, n * 2).match(/../g)!.map((x) => parseInt(x, 16)); return btoa(String.fromCharCode(...bytes)); }
function keygen(w: Welt, a: string[], root: boolean): Ergebnis {
  if (!hatUtils(w)) return nichtDa('dnssec-keygen', rh(w) ? 'bind' : 'bind9-utils');
  let alg = 'ECDSAP256SHA256'; let ksk = false; let bits = 0; let dir = w.cwd; const frei: string[] = [];
  for (let i = 0; i < a.length; i++) { const x = a[i]; if (x === '-a') alg = (a[++i] ?? '').toUpperCase(); else if (x === '-f') ksk = /^ksk$/i.test(a[++i] ?? ''); else if (x === '-b') bits = Number(a[++i]); else if (x === '-K') dir = K.pfad(w, a[++i] ?? '.'); else if (['-n', '-r', '-L', '-T', '-p', '-P', '-A', '-I', '-D', '-c'].includes(x)) i++; else if (x.startsWith('-')) continue; else frei.push(x); }
  const NR: Record<string, number> = { RSASHA256: 8, RSASHA512: 10, ECDSAP256SHA256: 13, ECDSAP384SHA384: 14, ED25519: 15, ED448: 16 };
  if (/^HMAC/.test(alg)) return fehler(`dnssec-keygen: fatal: unknown algorithm ${alg}`);
  if (!NR[alg]) return fehler(`dnssec-keygen: fatal: unknown algorithm ${alg}`);
  if (alg.startsWith('RSA') && !bits) bits = 2048;
  const zone = frei[0]; if (!zone) return fehler('dnssec-keygen: fatal: does not specify a zone name\nUsage:\n    dnssec-keygen [options] name\n(gekürzt)', 1);
  if (!darf(w, dir, 'w', root)) return fehler(`dnssec-keygen: fatal: failed to write key Kxx: permission denied`);
  const st = ds(w); st.schluessel++;
  const tag = 10000 + (parseInt(sha256(zone + st.schluessel + alg).slice(0, 6), 16) % 55000);
  const nr = String(NR[alg]).padStart(3, '0'); const n = `K${zone.replace(/\.$/, '')}.+${nr}+${String(tag).padStart(5, '0')}`;
  const pub = b64(n + 'pub', alg.startsWith('RSA') ? 260 : 64);
  const flag = ksk ? 257 : 256;
  const jetzt = K.datum({ ...w, env: { ...w.env, LANG: 'C' } } as Welt, w.uhr, '%Y%m%d%H%M%S');
  const key = `; This is a ${ksk ? 'key-signing' : 'zone-signing'} key, keyid ${tag}, for ${zone.replace(/\.$/, '')}.\n; Created: ${jetzt} (${K.datum({ ...w, env: { ...w.env, LANG: 'C' } } as Welt, w.uhr, '%a %b %e %T %Y')})\n; Publish: ${jetzt} (${K.datum({ ...w, env: { ...w.env, LANG: 'C' } } as Welt, w.uhr, '%a %b %e %T %Y')})\n; Activate: ${jetzt} (${K.datum({ ...w, env: { ...w.env, LANG: 'C' } } as Welt, w.uhr, '%a %b %e %T %Y')})\n${zone.replace(/\.$/, '')}. IN DNSKEY ${flag} 3 ${NR[alg]} ${pub}\n`;
  for (const [end, c, mode] of [['.key', key, 0o644], ['.private', `Private-key-format: v1.3\nAlgorithm: ${NR[alg]} (${alg})\nPrivateKey: ${b64(n + 'priv', 32)}\nCreated: ${jetzt}\nPublish: ${jetzt}\nActivate: ${jetzt}\n`, 0o600]] as [string, string, number][]) { const p = `${dir}/${n}${end}`; w.fs[p] = c; neuMeta(w, p, root, false); meta(w, p).mode = mode; }
  return { out: n, err: `Generating key pair.${alg.startsWith('RSA') ? '..............+++++ ...........+++++' : ''}`, code: 0, errNach: false };
}
function signzone(w: Welt, a: string[], root: boolean): Ergebnis {
  if (!hatUtils(w)) return nichtDa('dnssec-signzone', rh(w) ? 'bind' : 'bind9-utils');
  let origin: string | undefined; let smart = false; let ksk: string[] = []; const frei: string[] = []; let out: string | undefined;
  for (let i = 0; i < a.length; i++) { const x = a[i]; if (x === '-o') origin = a[++i]; else if (x === '-S') smart = true; else if (x === '-k') ksk.push(a[++i]); else if (x === '-f') out = a[++i]; else if (['-N', '-e', '-s', '-K', '-d', '-j', '-g', '-t', '-3', '-H', '-A'].includes(x)) { if (!['-t', '-g', '-A'].includes(x)) i++; } else if (x.startsWith('-')) continue; else frei.push(x); }
  const [zd, ...zsk] = frei;
  if (!zd) return fehler('Usage:\n\tdnssec-signzone [options] zonefile [keys]\n(gekürzt)', 1);
  const zone = (origin ?? zd.split('/').pop()!.replace(/^db\./, '')).replace(/\.$/, '').toLowerCase();
  const p = K.pfad(w, zd); const dir = p.replace(/\/[^/]*$/, '') || '/';
  const l = zoneLesen(w, zone, p, zd, root);
  if (!l.ok) return fehler([...l.ausgabe, `dnssec-signzone: fatal: failed loading zone from '${zd}': ${l.ausgabe.find((x) => /failed: /.test(x))?.split('failed: ')[1] ?? 'failure'}`].join('\n'));
  // Schlüssel: im Zonenfile, als Argument oder mit -S im Ordner
  const ausDatei = (f: string) => { const q = f.startsWith('/') ? f : `${dir}/${f.endsWith('.key') ? f : f + '.key'}`; const c = w.fs[q] ?? w.fs[K.pfad(w, f.endsWith('.key') ? f : f + '.key')]; return typeof c === 'string' ? c.match(/DNSKEY (\d+) 3 (\d+) (\S+)/) : null; };
  const schl: { flag: number; alg: number; pub: string; tag: string }[] = [];
  for (const r of l.rrs.filter((x) => x.typ === 'DNSKEY')) { const [f, , al, pub] = r.daten.split(' '); schl.push({ flag: Number(f), alg: Number(al), pub, tag: String(10000 + (parseInt(sha256(pub).slice(0, 5), 16) % 55000)) }); }
  for (const f of [...ksk, ...zsk]) { const m = ausDatei(f); if (!m) return fehler(`dnssec-signzone: fatal: cannot load dnskey ${f}: file not found`); schl.push({ flag: Number(m[1]), alg: Number(m[2]), pub: m[3], tag: f.match(/\+(\d{5})/)?.[1] ?? '00000' }); }
  if (smart || !schl.length) for (const k of Object.keys(w.fs).filter((x) => x.startsWith(`${dir}/K${zone}.+`) && x.endsWith('.key'))) { const m = (w.fs[k] as string).match(/DNSKEY (\d+) 3 (\d+) (\S+)/); if (m && !schl.some((s) => s.pub === m[3])) schl.push({ flag: Number(m[1]), alg: Number(m[2]), pub: m[3], tag: k.match(/\+(\d{5})\.key$/)?.[1] ?? '00000' }); }
  if (!schl.length) return fehler('dnssec-signzone: fatal: No signing keys specified or found.');
  for (const s of schl) s.tag = s.tag === '00000' ? String(10000 + (parseInt(sha256(s.pub).slice(0, 5), 16) % 55000)) : s.tag;
  const kskL = schl.filter((s) => s.flag === 257); const zskL = schl.filter((s) => s.flag === 256);
  const signer = (zskL[0] ?? kskL[0]); const ksign = kskL[0] ?? signer;
  const jetzt = K.datum({ ...w, env: { ...w.env, LANG: 'C' } } as Welt, w.uhr, '%Y%m%d%H%M%S');
  const ab = K.datum({ ...w, env: { ...w.env, LANG: 'C' } } as Welt, w.uhr - 3600000, '%Y%m%d%H%M%S');
  const bis = K.datum({ ...w, env: { ...w.env, LANG: 'C' } } as Welt, w.uhr + 30 * 86400000, '%Y%m%d%H%M%S');
  const rrs = l.rrs.filter((r) => !['RRSIG', 'NSEC'].includes(r.typ) && r.typ !== 'DNSKEY');
  for (const s of schl) rrs.push({ name: zone, ttl: 3600, typ: 'DNSKEY', daten: `${s.flag} 3 ${s.alg} ${s.pub}`, zeile: 0 });
  const namen = [...new Set(sortiert(rrs, zone).map((r) => r.name))];
  const signiert: RR[] = [];
  namen.forEach((n, i) => {
    const hier = rrs.filter((r) => r.name === n);
    const typen = [...new Set(hier.map((r) => r.typ))];
    for (const r of hier) signiert.push(r);
    const naechster = namen[(i + 1) % namen.length];
    signiert.push({ name: n, ttl: 900, typ: 'NSEC', daten: `${fq(naechster)} ${[...typen, 'RRSIG', 'NSEC'].join(' ')}`, zeile: 0 });
    for (const t of [...typen, 'NSEC']) { const k = t === 'DNSKEY' ? ksign : signer; signiert.push({ name: n, ttl: t === 'NSEC' ? 900 : 3600, typ: 'RRSIG', daten: `${t} ${k.alg} ${n.split('.').length} ${t === 'NSEC' ? 900 : 3600} ${bis} ${ab} ${k.tag} ${zone}. ${b64(n + t + k.tag, 64)}`, zeile: 0 }); }
  });
  const ziel = out ? K.pfad(w, out) : `${p}.signed`;
  if (!darf(w, ziel.replace(/\/[^/]*$/, '') || '/', 'w', root)) return fehler(`dnssec-signzone: fatal: failed to open temporary output file: permission denied`);
  w.fs[ziel] = `; File written on ${K.datum({ ...w, env: { ...w.env, LANG: 'C' } } as Welt, w.uhr, '%a %b %e %T %Y')}\n; dnssec_signzone version ${ort(w).version}\n` + sortiert(signiert, zone).map((r) => rrText(r)).join('\n') + '\n';
  neuMeta(w, ziel, root, false);
  const ds0 = `${dir}/dsset-${zone}.`;
  w.fs[ds0] = kskL.map((k) => `${zone}.\t\tIN DS ${k.tag} ${k.alg} 2 ${sha256(zone + k.pub).toUpperCase().slice(0, 56)} ${sha256(k.pub).toUpperCase().slice(0, 8)}`).join('\n') + (kskL.length ? '\n' : ''); neuMeta(w, ds0, root, false);
  const algName: Record<number, string> = { 8: 'RSASHA256', 10: 'RSASHA512', 13: 'ECDSAP256SHA256', 14: 'ECDSAP384SHA384', 15: 'ED25519' };
  return { out: ziel.replace(dir + '/', zd.includes('/') ? dir + '/' : ''), err: `Verifying the zone using the following algorithms:\n- ${algName[signer.alg]}\nZone fully signed:\nAlgorithm: ${algName[signer.alg]}: KSKs: ${kskL.length} active, 0 stand-by, 0 revoked\n${' '.repeat(28)}ZSKs: ${zskL.length} active, 0 stand-by, 0 revoked`, code: 0 };
}
function tsigkeygen(w: Welt, a: string[]): Ergebnis {
  if (!hatUtils(w)) return nichtDa('tsig-keygen', rh(w) ? 'bind' : 'bind9-utils');
  let alg = 'hmac-sha256'; const frei: string[] = [];
  for (let i = 0; i < a.length; i++) { if (a[i] === '-a') alg = (a[++i] ?? '').toLowerCase(); else if (!a[i].startsWith('-')) frei.push(a[i]); }
  const name = frei[0] ?? 'tsig-key';
  const laenge: Record<string, number> = { 'hmac-md5': 16, 'hmac-sha1': 20, 'hmac-sha224': 28, 'hmac-sha256': 32, 'hmac-sha384': 48, 'hmac-sha512': 64 };
  if (!laenge[alg]) return fehler(`tsig-keygen: unsupported algorithm '${alg}'`);
  ds(w).schluessel++;
  const secret = name.replace(/\.$/, '') === TSIG.name && !ds(w).opt.tsig ? TSIG.secret : b64(name + ds(w).schluessel + alg, laenge[alg]);
  return ok(`key "${name}" {\n\talgorithm ${alg};\n\tsecret "${secret}";\n};`);
}

// ======================= Installation und Start =======================

function installieren(w: Welt) {
  const st = ds(w); if (st.installiert) return;
  st.installiert = true; const o = ort(w);
  if (!rh(w)) {
    ordner(w, '/etc/bind', 0o2755, 'root', 'bind');
    for (const [p, c] of [['/etc/bind/named.conf', DEB_CONF], ['/etc/bind/named.conf.options', DEB_OPTIONS], ['/etc/bind/named.conf.local', DEB_LOCAL], ['/etc/bind/named.conf.default-zones', DEB_DEFAULT]] as [string, string][]) datei(w, p, c, 0o644, 'root', 'bind');
    datei(w, '/etc/bind/db.local', db('BIND data file for local loopback interface', '@\tIN\tA\t127.0.0.1\n@\tIN\tAAAA\t::1\n'));
    datei(w, '/etc/bind/db.127', db('BIND reverse data file for local loopback interface', '1.0.0\tIN\tPTR\tlocalhost.\n'));
    datei(w, '/etc/bind/db.0', db('BIND reverse data file for broadcast zone', ''));
    datei(w, '/etc/bind/db.255', db('BIND reverse data file for broadcast zone', ''));
    datei(w, '/etc/bind/db.empty', db('BIND reverse data file for empty rfc1918 zone', ''));
    datei(w, '/etc/bind/bind.keys', '# The bind.keys file is used to override the built-in DNSSEC trust anchors\n# which are included as part of BIND 9.\n');
    datei(w, '/etc/bind/rndc.key', `key "rndc-key" {\n\talgorithm hmac-sha256;\n\tsecret "${b64('rndc', 32)}";\n};\n`, 0o640, 'bind', 'bind');
    datei(w, '/etc/default/named', '#\n# run resolvconf?\nRESOLVCONF=no\n\n# startup options for the server\nOPTIONS="-u bind"\n');
    datei(w, '/usr/share/dns/root.hints', ROOT_HINTS);
    ordner(w, '/var/cache/bind', 0o775, 'root', 'bind'); ordner(w, '/var/lib/bind', 0o775, 'root', 'bind');
    datei(w, '/usr/sbin/named', '\u0007BIN:1120344', 0o755);
    if (!/^bind:/m.test(w.fs['/etc/passwd'] ?? '')) { w.fs['/etc/passwd'] += 'bind:x:103:105::/var/cache/bind:/usr/sbin/nologin\n'; w.fs['/etc/group'] += 'bind:x:105:\n'; if (w.fs['/etc/shadow']) w.fs['/etc/shadow'] += 'bind:!:20415::::::\n'; }
  } else {
    datei(w, '/etc/named.conf', RH_CONF, 0o640, 'root', 'named');
    datei(w, '/etc/named.rfc1912.zones', RH_RFC1912, 0o640, 'root', 'named');
    datei(w, '/etc/named.root.key', '/* This file is used by the named root zone DNSSEC trust anchor */\ntrust-anchors {\n\t. initial-key 257 3 8 "AwEAAa…";\n};\n', 0o644, 'root', 'named');
    datei(w, '/etc/crypto-policies/back-ends/bind.config', 'disable-algorithms "." {\nRSAMD5;\nDSA;\n};\n');
    ordner(w, '/var/named', 0o770, 'root', 'named');
    datei(w, '/var/named/named.ca', ROOT_HINTS, 0o640, 'root', 'named');
    datei(w, '/var/named/named.localhost', RH_LOCALHOST, 0o640, 'root', 'named');
    datei(w, '/var/named/named.loopback', RH_LOOPBACK, 0o640, 'root', 'named');
    datei(w, '/var/named/named.empty', RH_EMPTY, 0o640, 'root', 'named');
    for (const d of ['data', 'dynamic', 'slaves']) ordner(w, `/var/named/${d}`, 0o770, 'named', 'named');
    datei(w, '/etc/rndc.key', `key "rndc-key" {\n\talgorithm hmac-sha256;\n\tsecret "${b64('rndc', 32)}";\n};\n`, 0o640, 'root', 'named');
    datei(w, '/etc/sysconfig/named', '# BIND named process options\n# ~~~~~~~~~~~~~~~~~~~~~~~~~~~\n#\n# OPTIONS="whatever"     --  These additional options will be passed to named\n#                            at startup. Don\'t add -t here, enable proper\n#                            -chroot.service unit file.\n#\n# DISABLE_ZONE_CHECKING  --  By default, service file calls named-checkzone\n#                            utility for every zone to ensure all zones are\n#                            valid before named starts. If you set this option\n#                            to \'yes\' then service file doesn\'t perform those\n#                            checks.\n');
    datei(w, '/usr/sbin/named', '\u0007BIN:1093120', 0o755);
    if (!/^named:/m.test(w.fs['/etc/passwd'] ?? '')) { w.fs['/etc/passwd'] += 'named:x:25:25:Named:/var/named:/sbin/nologin\n'; w.fs['/etc/group'] += 'named:x:25:\n'; if (w.fs['/etc/shadow']) w.fs['/etc/shadow'] += 'named:!!:20415::::::\n'; }
  }
  for (const p of ['/usr/bin/named-checkconf', '/usr/bin/named-checkzone', '/usr/bin/named-compilezone', '/usr/bin/dnssec-keygen', '/usr/bin/dnssec-signzone', '/usr/sbin/rndc', '/usr/sbin/tsig-keygen', '/usr/sbin/rndc-confgen']) datei(w, p, '\u0007BIN:' + (40000 + p.length * 700), 0o755);
  K.benutzer(w);
  st.enabled[o.user === 'bind' ? 'named' : 'named'] = !rh(w);
  void o;
}
function chrootInstallieren(w: Welt) {
  const st = ds(w); if (st.chrootPaket) return; st.chrootPaket = true;
  for (const d of ['/var/named/chroot', '/var/named/chroot/etc', '/var/named/chroot/var/named', '/var/named/chroot/run/named', '/var/named/chroot/dev', '/var/named/chroot/usr/lib64/bind']) ordner(w, d, 0o750, 'root', 'named');
  datei(w, '/usr/libexec/setup-named-chroot.sh', '#!/bin/bash\n# Bind-Mounts für named-chroot.service (vom Paket bind-chroot)\n', 0o755);
  datei(w, '/usr/lib/systemd/system/named-chroot.service', '# Don\'t forget to add "$AUTOCONF_LOG" to the beginning of the $OPTIONS list\n[Unit]\nDescription=Berkeley Internet Name Domain (DNS)\nWants=nss-lookup.target\nRequires=named-chroot-setup.service\nBefore=nss-lookup.target\nAfter=named-chroot-setup.service\nAfter=network.target\n\n[Service]\nType=forking\nEnvironment=NAMEDCONF=/etc/named.conf\nEnvironmentFile=-/etc/sysconfig/named\nEnvironment=KRB5_KTNAME=/etc/named.keytab\nPIDFile=/var/named/chroot/run/named/named.pid\n\nExecStartPre=/bin/bash -c \'if [ ! "$DISABLE_ZONE_CHECKING" == "yes" ]; then /usr/sbin/named-checkconf -t /var/named/chroot -z "$NAMEDCONF"; else echo "Checking of zone files is disabled"; fi\'\nExecStart=/usr/sbin/named -u named -c ${NAMEDCONF} -t /var/named/chroot $OPTIONS\n\nExecReload=/bin/sh -c \'if /usr/sbin/rndc null > /dev/null 2>&1; then /usr/sbin/rndc reload; else /bin/kill -HUP $MAINPID; fi\'\n\nExecStop=/bin/sh -c \'/usr/sbin/rndc stop > /dev/null 2>&1 || /bin/kill -TERM $MAINPID\'\n\nPrivateTmp=false\n\n[Install]\nWantedBy=multi-user.target\n');
}

export function dnsStarten(w: Welt, o: DnsOptionen) {
  const st: DnsStand = { opt: o, installiert: false, chrootPaket: false, laeuft: false, enabled: {}, fehlgeschlagen: false, start: w.uhr, konfiguriert: w.uhr, modell: null, zonen: {}, cache: [], querylog: false, pid: 0, log: [], fern: {}, fernKey: null, schluessel: 0 };
  (w as DW).dns = st;
  // srv1 hält eigene Zonen: eine Unterzone für die Werkhalle und die interne Zone der Firma
  const lade = (zone: string, text: string): RR[] => { w.fs['/tmp/.dns-fern'] = text; const l = zoneLesen(w, zone, '/tmp/.dns-fern', zone, true); delete w.fs['/tmp/.dns-fern']; if (w.meta) delete w.meta['/tmp/.dns-fern']; return l.rrs; };
  st.fern['werkhalle.lab.example.org'] = { typ: 'primary', rrs: lade('werkhalle.lab.example.org', FERN_WERKHALLE), serial: 2026110201 };
  st.fern['firma.intern'] = { typ: 'primary', rrs: lade('firma.intern', FERN_INTERN), serial: 2026100101 };
  if (o.sekundaer) st.fern['lab.example.org'] = { typ: 'secondary', rrs: lade('lab.example.org', LAB_ALT), serial: 2026111601, key: o.tsig ? TSIG.name : undefined };
  if (o.tsig) { st.fernKey = { ...TSIG }; datei(w, '/home/lena/ns1-ns2.key', `key "${TSIG.name}" {\n\talgorithm hmac-sha256;\n\tsecret "${TSIG.secret}";\n};\n`, 0o600, 'lena'); }
  if (w.pakete) for (const p of ['bind9-dnsutils', 'bind9-host']) if (!rh(w)) w.pakete.installiert[p] = 'ii';
  if (!o.paket) return;
  if (w.pakete) { if (rh(w)) { w.pakete.installiert.bind = 'ii'; w.pakete.installiert['bind-utils'] = 'ii'; } else { w.pakete.installiert.bind9 = 'ii'; w.pakete.installiert['bind9-utils'] = 'ii'; w.pakete.installiert['dns-root-data'] = 'ii'; } }
  installieren(w);
  if (o.cache && !rh(w)) datei(w, '/etc/bind/named.conf.options', CACHE_OPTIONS, 0o644, 'root', 'bind');
  if (o.entwurf) datei(w, '/home/lena/db.lab.example.org', ENTWURF, 0o644, 'lena');
  if (o.zone && !rh(w)) {
    datei(w, '/etc/bind/db.lab.example.org', o.zone === 'ohne-ns2' ? OHNE_NS2(LAB_ZONE) : LAB_ZONE);
    datei(w, '/etc/bind/named.conf.local', DEB_LOCAL + `zone "lab.example.org" {\n\ttype primary;\n\tfile "/etc/bind/db.lab.example.org";\n${o.sekundaer && o.zone !== 'ohne-ns2' ? '\tallow-transfer { 192.168.1.10; };\n' : ''}};\n` + (o.rueck ? `\nzone "1.168.192.in-addr.arpa" {\n\ttype primary;\n\tfile "/etc/bind/db.192.168.1";\n};\n` : ''), 0o644, 'root', 'bind');
    if (o.rueck) datei(w, '/etc/bind/db.192.168.1', RUECK_ZONE);
  }
  if (o.boss) {
    // Freitagabend hat jemand „schnell noch“ etwas geändert
    datei(w, '/etc/bind/named.conf.options', CACHE_OPTIONS.replace('\tforward first;\n', '\tforward first\n'), 0o644, 'root', 'bind');
    datei(w, '/etc/bind/db.lab.example.org', LAB_ZONE.replace('\tIN\tNS\tns2.lab.example.org.', '\tIN\tNS\tns2.lab.example.org').replace('laser\tIN\tA\t192.168.1.40\n', 'laser\tIN\tA\t192.168.1.40\nplotter\tIN\tA\t192.168.1.41\n'));
    datei(w, '/etc/bind/named.conf.local', DEB_LOCAL + `zone "lab.example.org" {\n\ttype primary;\n\tfile "/etc/bind/db.lab.example.org";\n\tallow-transfer { none; };\n};\n\nzone "1.168.192.in-addr.arpa" {\n\ttype primary;\n\tfile "/etc/bind/db.192.168.1";\n};\n`, 0o644, 'root', 'bind');
    datei(w, '/etc/bind/db.192.168.1', RUECK_ZONE);
    if (st.fern['lab.example.org']) { st.fern['lab.example.org'].serial = 2026112301; st.fern['lab.example.org'].rrs = lade('lab.example.org', LAB_ZONE); }
    w.uhr -= 3600000; st.enabled.named = true; starten(w, 'named'); w.uhr += 3600000;
    return;
  }
  st.enabled.named = true;
  starten(w, 'named');
}

// ======================= Befehle =======================

export function dnsBefehle(alt: Record<string, B>): Record<string, B> {
  const b: Record<string, B> = {};
  const mit = (n: string, f: B): B => (w, a, i, r) => (dnsAktiv(w) ? f(w, a, i, r) : alt[n] ? alt[n](w, a, i, r) : fehler(`bash: ${n}: Befehl nicht gefunden`, 127));
  b['named-checkconf'] = mit('named-checkconf', (w, a, _i, r) => checkconf(w, a, r));
  b['named-checkzone'] = mit('named-checkzone', (w, a, _i, r) => checkzone(w, a, r, false));
  b['named-compilezone'] = mit('named-compilezone', (w, a, _i, r) => checkzone(w, a, r, true));
  b.rndc = mit('rndc', (w, a, _i, r) => rndc(w, a, r));
  b['dnssec-keygen'] = mit('dnssec-keygen', (w, a, _i, r) => keygen(w, a, r));
  b['dnssec-signzone'] = mit('dnssec-signzone', (w, a, _i, r) => signzone(w, a, r));
  b['tsig-keygen'] = mit('tsig-keygen', (w, a) => tsigkeygen(w, a));
  b.named = mit('named', (w, a) => {
    if (!ds(w).installiert) return nichtDa('named', rh(w) ? 'bind' : 'bind9');
    if (a.includes('-v')) return ok(`BIND ${ort(w).version} (Extended Support Version) <id:>`);
    if (a.includes('-V')) return ok(`BIND ${ort(w).version} (Extended Support Version) <id:>\nrunning on Linux x86_64 ${w.kernel}\nbuilt by make with  (gekürzt)\ndefault paths:\n  named configuration:  ${ort(w).conf}\n  rndc configuration:   ${ort(w).conf.replace('named.conf', 'rndc.conf')}\n  nsupdate session key: /run/named/session.key\n  named PID file:       /run/named/named.pid`);
    return fehler('(Im Simulator startest du named über systemctl, etwa: sudo systemctl start named)');
  });
  b.pidof = (w, a) => { const n = a.filter((x) => !x.startsWith('-')); const p = w.prozesse.filter((x) => n.some((y) => x.cmd.split(' ')[0].split('/').pop() === y || x.cmd.replace(/^-/, '').split(' ')[0] === y)); return p.length ? ok(p.map((x) => x.pid).reverse().join(' ')) : { out: '', code: 1 }; };
  // kill: SIGHUP an named lädt neu, SIGTERM beendet ihn
  b.kill = (w, a, i, r) => {
    if (!dnsAktiv(w) || !ds(w).laeuft) return alt.kill(w, a, i, r);
    const st = ds(w); const pids = a.filter((x) => /^\d+$/.test(x)).map(Number);
    if (!pids.includes(st.pid)) return alt.kill(w, a, i, r);
    if (!(r || w.root)) return fehler(`bash: kill: (${st.pid}) - Die Operation ist nicht erlaubt`);
    const s = a.find((x) => /^-/.test(x) && x !== '-s')?.replace(/^-(s\s*)?(SIG)?/i, '').toUpperCase() ?? (a.includes('-s') ? (a[a.indexOf('-s') + 1] ?? '').replace(/^SIG/i, '').toUpperCase() : 'TERM');
    const rest = pids.filter((p) => p !== st.pid);
    if (s === 'HUP' || s === '1') { protokoll(w, 'received SIGHUP signal to reload zones'); laden(w, 'reload'); }
    else if (['TERM', '15', 'INT', '2', 'KILL', '9'].includes(s)) { if (s === 'KILL' || s === '9') { st.laeuft = false; w.prozesse = w.prozesse.filter((p) => p.pid !== st.pid); } else anhalten(w); }
    return rest.length ? alt.kill(w, [...a.filter((x) => !/^\d+$/.test(x)), ...rest.map(String)], i, r) : ok();
  };
  // dig, host, nslookup gegen den eigenen Server und srv1
  b.dig = (w, a, i, r) => {
    if (!dnsAktiv(w)) return alt.dig(w, a, i, r);
    const resolv = (w.fs['/etc/resolv.conf'] ?? '').match(/^nameserver\s+(\S+)/m)?.[1] ?? '127.0.0.1';
    const server = a.find((x) => x.startsWith('@'))?.slice(1) ?? resolv;
    const srv = welcherServer(w, server);
    if (!srv) return alt.dig(w, a, i, r);
    const opts = new Set(a.filter((x) => x.startsWith('+')).map((x) => x.slice(1)));
    const kurz = opts.has('short'); const nurAntwort = opts.has('noall') && opts.has('answer'); const dnssec = opts.has('dnssec'); const rd = !opts.has('norec') && !opts.has('norecurse');
    const xi = a.indexOf('-x'); const ti = a.indexOf('-t');
    const frei = a.filter((x, k) => !x.startsWith('@') && !x.startsWith('+') && !x.startsWith('-') && !['-x', '-t', '-y', '-k', '-p', '-c', '-b'].includes(a[k - 1] ?? ''));
    const chaos = frei.some((x) => /^(CH|CHAOS)$/i.test(x)) || (a.includes('-c') && /^CH/i.test(a[a.indexOf('-c') + 1] ?? ''));
    const woerter = frei.filter((x) => !/^(IN|CH|CHAOS)$/i.test(x));
    let typ = (ti >= 0 ? a[ti + 1] : woerter.find((x) => TYPNAMEN.test(x)))?.toUpperCase() ?? 'A';
    let name = woerter.find((x) => !TYPNAMEN.test(x)) ?? '.';
    if (xi >= 0) { name = (a[xi + 1] ?? '').split('.').reverse().join('.') + '.in-addr.arpa'; typ = 'PTR'; }
    const adr = server === 'localhost' ? '127.0.0.1' : server;
    const argText = a.join(' ');
    if (!erreichbar(w, srv, server)) return { out: `;; communications error to ${adr}#53: connection refused\n;; communications error to ${adr}#53: connection refused\n;; communications error to ${adr}#53: connection refused\n\n; <<>> DiG ${ort(w).version} <<>> ${argText}\n; (1 server found)\n;; global options: +cmd\n;; no servers could be reached`, code: 9 };
    const client = adr === '127.0.0.1' || adr === '::1' ? '127.0.0.1' : '192.168.1.23';
    const key = keyAus(w, a, r); if (typeof key === 'string') return fehler(key, 1);
    if (typ === 'AXFR' || typ === 'IXFR') {
      const z = name.replace(/\.$/, '').toLowerCase(); const kopf = `\n; <<>> DiG ${ort(w).version} <<>> ${argText}\n; (1 server found)\n;; global options: +cmd`;
      const st = ds(w);
      const rrs = srv === 'ns1' ? st.zonen[z]?.rrs : st.fern[z]?.rrs.length ? st.fern[z].rrs : undefined;
      if (!rrs) return ok(`${kopf}\n; Transfer failed.`);
      if (srv === 'ns1') {
        const e = transferErlaubt(w, z, client, key);
        if (e === 'badkey') { protokoll(w, `client @0x7f3a2c01e168 ${client}#40417: request has invalid signature: TSIG ${key!.name}: tsig verify failure (BADKEY)`); return ok(`${kopf}\n;; Couldn't verify signature: expected a TSIG or SIG(0)\n; Transfer failed.`); }
        if (e === 'verboten') { protokoll(w, `client @0x7f3a2c01e168 ${client}#40417 (${z}): zone transfer '${z}/AXFR/IN' denied`); return ok(`${kopf}\n; Transfer failed.`); }
        protokoll(w, `client @0x7f3a2c01e168 ${client}#40417${key ? `/key ${key.name}` : ''} (${z}): transfer of '${z}/IN': AXFR started (serial ${st.zonen[z].serial})`);
      } else return ok(`${kopf}\n; Transfer failed.`);
      const s = sortiert(rrs, z); const soa = s.find((x) => x.typ === 'SOA')!;
      return ok(`${kopf}\n${[...s, soa].map((x) => rrText(x)).join('\n')}\n${key ? `${key.name}.\t\t0\tANY\tTSIG\thmac-sha256. ${Math.floor(w.uhr / 1000)} 300 32 ${b64(key.secret + 'mac', 32)} 4711 NOERROR 0 \n` : ''};; Query time: 0 msec\n;; SERVER: ${adr}#53(${adr}) (TCP)\n;; WHEN: ${K.datum({ ...w, env: { ...w.env, LANG: 'C' } } as Welt, w.uhr)}\n;; XFR size: ${s.length + 1} records (messages 1, bytes ${64 + s.length * 26})\n`);
    }
    const ant = fragen(w, srv, name, typ, client, { rd, dnssec, chaos });
    return ok(digAusgabe(w, argText, adr, typ, name, ant, { kurz, nurAntwort, chaos, dnssec, rd }));
  };
  b.host = (w, a, i, r) => {
    if (!dnsAktiv(w)) return alt.host(w, a, i, r);
    const ti = a.indexOf('-t'); const typ0 = ti >= 0 ? (a[ti + 1] ?? '').toUpperCase() : undefined;
    const frei = a.filter((x, k) => !x.startsWith('-') && (ti < 0 || k !== ti + 1)); const [name, server] = frei;
    const resolv = (w.fs['/etc/resolv.conf'] ?? '').match(/^nameserver\s+(\S+)/m)?.[1] ?? '127.0.0.1';
    const srv = welcherServer(w, server ?? resolv);
    if (!srv || !name) return alt.host(w, a, i, r);
    const s = server ?? resolv;
    const kopf = server ? `Using domain server:\nName: ${server}\nAddress: ${server === 'localhost' ? '127.0.0.1' : server}#53\nAliases: \n\n` : '';
    if (!erreichbar(w, srv, s)) return fehler(`;; communications error to ${s}#53: connection refused\n;; communications error to ${s}#53: connection refused\n;; no servers could be reached`);
    const client = s === '127.0.0.1' || s === 'localhost' ? '127.0.0.1' : '192.168.1.23';
    const istIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(name);
    const n = istIp ? name.split('.').reverse().join('.') + '.in-addr.arpa' : name;
    const typen = istIp ? ['PTR'] : typ0 ? [typ0] : ['A', 'AAAA', 'MX'];
    const out: string[] = [];
    for (const t of typen) {
      const x = fragen(w, srv, n, t, client, { rd: true, dnssec: false });
      if (x.status === 'NXDOMAIN') return fehler(`${kopf}Host ${istIp ? n : name} not found: 3(NXDOMAIN)`);
      if (x.status === 'REFUSED') return fehler(`${kopf}Host ${istIp ? n : name} not found: 5(REFUSED)`);
      if (x.status === 'SERVFAIL') return fehler(`${kopf}Host ${istIp ? n : name} not found: 2(SERVFAIL)`);
      for (const z of x.antwort) { const f = z.split('\t'); const o = f[0].replace(/\.$/, ''); const d = f[4];
        out.push(f[3] === 'A' ? `${o} has address ${d}` : f[3] === 'AAAA' ? `${o} has IPv6 address ${d}` : f[3] === 'MX' ? `${o} mail is handled by ${d}` : f[3] === 'NS' ? `${o} name server ${d}` : f[3] === 'CNAME' ? `${o} is an alias for ${d}` : f[3] === 'PTR' ? `${o} domain name pointer ${d}` : f[3] === 'SOA' ? `${o} has SOA record ${d}` : f[3] === 'TXT' ? `${o} descriptive text ${d}` : `${o} has ${f[3]} record ${d}`); }
    }
    if (typ0 && !out.length) return ok(`${kopf}${name} has no ${typ0} record`);
    return ok(kopf + [...new Set(out)].join('\n'));
  };
  b.nslookup = (w, a, i, r) => {
    if (!dnsAktiv(w)) return alt.nslookup(w, a, i, r);
    const typA = a.find((x) => /^-(type|query|q)=/i.test(x))?.split('=')[1]?.toUpperCase() ?? 'A';
    const [name, server] = a.filter((x) => !x.startsWith('-'));
    const resolv = (w.fs['/etc/resolv.conf'] ?? '').match(/^nameserver\s+(\S+)/m)?.[1] ?? '127.0.0.1';
    const s = server ?? resolv; const srv = welcherServer(w, s);
    if (!srv || !name) return alt.nslookup(w, a, i, r);
    const adr = s === 'localhost' ? '127.0.0.1' : s;
    if (!erreichbar(w, srv, s)) return { out: `;; communications error to ${adr}#53: connection refused\n;; communications error to ${adr}#53: connection refused\n;; no servers could be reached\n`, code: 1 };
    const istIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(name);
    const x = fragen(w, srv, istIp ? name.split('.').reverse().join('.') + '.in-addr.arpa' : name, istIp ? 'PTR' : typA, adr === '127.0.0.1' ? '127.0.0.1' : '192.168.1.23', { rd: true, dnssec: false });
    const kopf = `Server:\t\t${adr}\nAddress:\t${adr}#53\n`;
    if (x.status !== 'NOERROR') return { out: `${kopf}\n** server can't find ${name}: ${x.status}\n`, code: 1 };
    const zeilen = x.antwort.map((z) => { const f = z.split('\t'); const o = f[0].replace(/\.$/, ''); return f[3] === 'A' || f[3] === 'AAAA' ? `Name:\t${o}\nAddress: ${f[4]}` : f[3] === 'CNAME' ? `${o}\tcanonical name = ${f[4]}` : f[3] === 'PTR' ? `${f[0]}\tname = ${f[4]}` : f[3] === 'MX' ? `${o}\tmail exchanger = ${f[4]}` : `${o}\t${f[3].toLowerCase()} = ${f[4]}`; });
    return ok(`${kopf}\n${x.aa ? '' : 'Non-authoritative answer:\n'}${zeilen.join('\n')}\n`);
  };
  // journalctl -u named
  b.journalctl = (w, a, i, r) => {
    if (!dnsAktiv(w)) return alt.journalctl(w, a, i, r);
    const ui = a.findIndex((x) => x === '-u' || x === '--unit'); const u = ui >= 0 ? a[ui + 1] : a.find((x) => x.startsWith('--unit='))?.slice(7);
    const ti = a.indexOf('-t');
    if (!(u && /^(named|bind9|named-chroot)(\.service)?$/.test(u)) && !(ti >= 0 && a[ti + 1] === 'named')) return alt.journalctl(w, a, i, r);
    if (!(r || w.root) && !/adm|systemd-journal/.test(gruppenLena(w))) return ok('Hint: You are currently not seeing messages from other users and the system.\n      Users in groups \'adm\', \'systemd-journal\' can see all messages.\n      Pass -q to turn off this notice.\n-- No entries --');
    const ni = a.indexOf('-n'); let z = ds(w).log.map((e) => `${K.datum({ ...w, env: { ...w.env, LANG: 'C' } } as Welt, e.ms, '%b %d %T')} ${w.host} named[${ds(w).pid || 4120}]: ${e.text}`);
    if (ni >= 0) z = z.slice(-Number(a[ni + 1] ?? 10)); else if (a.includes('-e') || a.includes('-xe')) z = z.slice(-30);
    if (a.includes('-r')) z.reverse();
    return ok(z.length ? z.join('\n') : '-- No entries --');
  };
  // Pakete: nach der Installation liegen Konfiguration und Benutzer bereit
  for (const n of ['apt', 'apt-get', 'dnf', 'yum']) {
    const vorher = alt[n]; if (!vorher) continue;
    b[n] = (w, a, i, r) => {
      const x = vorher(w, a, i, r);
      if (!dnsAktiv(w)) return x;
      const nach = () => { const p = w.pakete?.installiert ?? {}; const st = ds(w); if ((p.bind9 === 'ii' || p.bind === 'ii') && !st.installiert) { installieren(w); if (!rh(w)) { st.enabled.named = true; starten(w, 'named'); } } if (p['bind-chroot'] === 'ii') chrootInstallieren(w); if (p['bind9-utils'] === 'ii' || p['bind-utils'] === 'ii') for (const q of ['/usr/bin/named-checkconf', '/usr/bin/named-checkzone', '/usr/bin/named-compilezone', '/usr/bin/dnssec-keygen', '/usr/bin/dnssec-signzone', '/usr/sbin/tsig-keygen']) if (!(q in w.fs)) datei(w, q, '\u0007BIN:61000', 0o755); };
      if (w.wartet) { const wt = w.wartet; const ak = wt.aktion; wt.aktion = () => { const y = ak(); nach(); return y; }; }
      else nach();
      return x;
    };
  }
  return b;
}
function gruppenLena(w: Welt) { return (w.fs['/etc/group'] ?? '').split('\n').filter((z) => z.split(':')[3]?.split(',').includes('lena')).map((z) => z.split(':')[0]).join(' '); }

// ---------- systemctl ----------
export function dnsSystemctl(w: Welt, a: string[], root: boolean): Ergebnis | null {
  if (!dnsAktiv(w)) return null;
  const rest = a.filter((x) => !x.startsWith('-')); const [cmd, ...units] = rest;
  const st = ds(w);
  const norm = (u: string) => u.replace(/\.service$/, '').replace(/^bind9$/, 'named');
  const unser = units.map(norm).filter((u) => u === 'named' || (u === 'named-chroot' && rh(w)));
  if (!cmd || !unser.length) return null;
  if (!st.installiert || (unser[0] === 'named-chroot' && !st.chrootPaket)) return fehler(`Unit ${units[0].endsWith('.service') ? units[0] : units[0] + '.service'} could not be found.`, cmd === 'status' ? 4 : 5);
  const u = unser[0]; const jetzt = a.includes('--now');
  const darfNicht = () => fehler(`Failed to ${cmd} ${u}.service: Access denied\nSee system logs and 'systemctl status ${u}.service' for details.`);
  const scheitern = () => fehler(`Job for ${u}.service failed because the control process exited with error code.\nSee "systemctl status ${u}.service" and "journalctl -xeu ${u}.service" for details.`);
  switch (cmd) {
    case 'start': case 'restart': case 'reload': case 'reload-or-restart': case 'try-restart': {
      if (!root) return darfNicht();
      if (cmd === 'reload') { if (st.laeuft !== u) return fehler(`${u}.service is not active, cannot reload.`); const r2 = laden(w, 'reload'); return r2.ok ? ok() : fehler(`Job for ${u}.service failed.\nSee "systemctl status ${u}.service" and "journalctl -xeu ${u}.service" for details.`); }
      if (st.laeuft && st.laeuft !== u) { if (cmd === 'start' || cmd === 'restart') anhalten(w); }
      if (cmd !== 'start' && st.laeuft === u) anhalten(w);
      if (st.laeuft === u) return ok();
      return starten(w, u as 'named' | 'named-chroot') ? ok() : scheitern();
    }
    case 'stop': if (!root) return darfNicht(); if (st.laeuft === u) anhalten(w); return ok();
    case 'enable': case 'disable': {
      if (!root) return fehler(`Failed to ${cmd} unit: Access denied`);
      st.enabled[u] = cmd === 'enable';
      const out = cmd === 'enable' ? `Created symlink /etc/systemd/system/multi-user.target.wants/${u}.service → /usr/lib/systemd/system/${u}.service.` : `Removed "/etc/systemd/system/multi-user.target.wants/${u}.service".`;
      if (jetzt) { if (cmd === 'enable') { if (st.laeuft && st.laeuft !== u) anhalten(w); if (!starten(w, u as 'named' | 'named-chroot')) return { out, ...scheitern() }; } else if (st.laeuft === u) anhalten(w); }
      return ok(out);
    }
    case 'is-active': return st.laeuft === u ? ok('active') : { out: st.fehlgeschlagen ? 'failed' : 'inactive', code: 3 };
    case 'is-enabled': return st.enabled[u] ? ok('enabled') : { out: 'disabled', code: 1 };
    case 'status': {
      const ein = st.enabled[u] ? 'enabled' : 'disabled';
      const pfad = rh(w) ? `/usr/lib/systemd/system/${u}.service` : '/lib/systemd/system/named.service';
      const seit = K.datum({ ...w, env: { ...w.env, LANG: 'C' } } as Welt, st.start, '%a %Y-%m-%d %T CET');
      const aktiv = st.laeuft === u ? `active (running) since ${seit}; ${Math.max(1, Math.round((w.uhr - st.start) / 60000))}min ago` : st.fehlgeschlagen ? `failed (Result: exit-code) since ${seit}; 1h ago` : 'inactive (dead)';
      const log = st.log.slice(-8).map((e) => `${K.datum({ ...w, env: { ...w.env, LANG: 'C' } } as Welt, e.ms, '%b %d %T')} ${w.host} named[${st.pid || 4120}]: ${e.text}`);
      const kopf = [`${st.laeuft === u ? '●' : st.fehlgeschlagen ? '×' : '○'} ${u}.service - ${rh(w) ? 'Berkeley Internet Name Domain (DNS)' : 'BIND Domain Name Server'}`, `     Loaded: loaded (${pfad}; ${ein}; preset: ${rh(w) ? 'disabled' : 'enabled'})`, `     Active: ${aktiv}`, '       Docs: man:named(8)'];
      if (st.laeuft === u) kopf.push(`   Main PID: ${st.pid} (named)`, '      Tasks: 8 (limit: 18920)', '     Memory: 21.4M', '        CPU: 52ms', `     CGroup: /system.slice/${u}.service`, `             └─${st.pid} ${w.prozesse.find((p) => p.pid === st.pid)?.cmd ?? ort(w).exe}`);
      else if (st.fehlgeschlagen) kopf.push(`    Process: 4120 ExecStart=${ort(w).exe} (code=exited, status=1/FAILURE)`, '   Main PID: 4120 (code=exited, status=1/FAILURE)');
      return { out: [...kopf, '', ...log].join('\n'), code: st.laeuft === u ? 0 : 3 };
    }
    default: return null;
  }
}

// ======================= Zustand =======================

export function zustandDns(w: Welt, s: string): boolean | undefined {
  let m;
  if (!/^(named|dnszone|dnsfrage|srv1zone|dnscache)[:=~]/.test(s)) return undefined;
  if (!dnsAktiv(w)) return false;
  const st = ds(w);
  if (s === 'named:laeuft') return !!st.laeuft;
  if (s === 'named:chroot') return st.laeuft === 'named-chroot';
  if (s === 'named:installiert') return st.installiert;
  if ((m = s.match(/^named:enabled=(\S+)$/))) return !!st.enabled[m[1]];
  if (s === 'named:querylog') return st.querylog;
  if (s === 'named:konf-ok') return !!konfPruefen(w, ort(w).conf, true).modell;
  if ((m = s.match(/^named:opt:([\w-]+)~(.+)$/))) { const mm = st.modell; if (!mm) return false; const v = mm.listen[m[1]]?.join('; ') ?? mm.opt[m[1]]; return v !== undefined && new RegExp(m[2]).test(v); }
  if ((m = s.match(/^named:acl:([\w-]+)~(.+)$/))) return !!st.modell?.acls[m[1]] && new RegExp(m[2]).test(st.modell.acls[m[1]].join('; '));
  if ((m = s.match(/^named:kanal:(\S+)$/))) { const mm = st.modell; return !!mm && Object.values(mm.kategorien).flat().some((k) => mm.kanaele[k]?.datei && (mm.kanaele[k].datei === m![1] || `${dirVon(w, mm)}/${mm.kanaele[k].datei}` === m![1])); }
  if ((m = s.match(/^named:key:(\S+)$/))) return !!st.modell?.keys[m[1].replace(/\.$/, '')];
  if ((m = s.match(/^dnszone:([^=~:]+)=(geladen|signiert|weg)$/))) { const z = st.zonen[m[1]]; return m[2] === 'weg' ? !z : m[2] === 'signiert' ? !!z?.signiert : !!z; }
  if ((m = s.match(/^dnszone:([^=~:]+)>=(\d+)$/))) return (st.zonen[m[1]]?.serial ?? 0) >= Number(m[2]);
  if ((m = s.match(/^dnszone:([^=~:]+)~(.+)$/))) { const z = st.zonen[m[1]]; const re = new RegExp(m[2], 'i'); return !!z && z.rrs.some((r) => re.test(`${r.name} ${r.typ} ${r.daten}`)); }
  if ((m = s.match(/^dnszone:([^=~:]+):typ=(\S+)$/))) return st.modell?.zonen.some((z) => z.name === m![1] && z.typ === m![2]) ?? false;
  if ((m = s.match(/^dnszone:([^=~:]+):transfer~(.+)$/))) { const z = st.modell?.zonen.find((x) => x.name === m![1]); return !!z && new RegExp(m[2]).test((z.allowTransfer ?? st.modell!.listen['allow-transfer'] ?? ['any']).join('; ')); }
  if ((m = s.match(/^srv1zone:([^=~]+)>=(\d+)$/))) return (st.fern[m[1]]?.serial ?? 0) >= Number(m[2]);
  if ((m = s.match(/^srv1zone:([^=~]+)~(.+)$/))) { const z = st.fern[m[1]]; const re = new RegExp(m[2], 'i'); return !!z && z.rrs.some((r) => re.test(`${r.name} ${r.typ} ${r.daten}`)); }
  if ((m = s.match(/^dnsfrage:(\S+)\/(\w+)~(.+)$/))) { if (!st.laeuft) return false; const x = fragen(structuredClone(w) as Welt, 'ns1', m[1], m[2].toUpperCase(), '127.0.0.1', { rd: true, dnssec: false }); return new RegExp(m[3]).test(`${x.status} ${x.antwort.join(' ')}`); }
  if ((m = s.match(/^dnscache:(\S+)$/))) return st.cache.some((c) => c.name === m![1]);
  return undefined;
}
