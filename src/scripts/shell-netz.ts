// Netzwerk für den Simulator (Topic 109): Schnittstellen und Routen mit iproute2 und net-tools,
// ping, traceroute, tracepath, nc, ss, netstat, hostname, hostnamectl, NetworkManager (nmcli), ifup/ifdown,
// Namensauflösung über /etc/nsswitch.conf, /etc/hosts und /etc/resolv.conf, host, dig, getent hosts.
import type { Welt } from './shell';

type Ergebnis = { out: string; err?: string; code: number };
type B = (w: Welt, a: string[], stdin: string, root: boolean) => Ergebnis;
const ok = (out = ''): Ergebnis => ({ out, code: 0 });
const fehler = (err: string, code = 1): Ergebnis => ({ out: '', err, code });

export interface NetzKern { datum: (w: Welt, ms: number, fmt?: string) => string }
export interface Sock { p: string; s: string; l: string; f: string; prog: string; pid: number }
/** Weitere Sockets (Dienste aus Topic 110, SSH-Tunnel), von anderen Modulen gemeldet. */
const quellen: ((w: Welt) => Sock[])[] = [];
const extraSockets = (w: Welt): Sock[] => quellen.flatMap((q) => q(w));
export function netzExtraSockets(f: (w: Welt) => Sock[]) { quellen.push(f); }
let K: NetzKern;
export function netzKern(k: NetzKern) { K = k; }

// ---------- Das erfundene Netz ----------

interface Host { ip: string; name: string; ports: number[]; ip6?: string; lan?: string }
const HOSTS: Host[] = [
  { ip: '192.168.1.1', name: 'router.lan', ports: [53, 80], lan: '192.168.1.0/24' },
  { ip: '192.168.1.254', name: 'labor-gw.lan', ports: [22], lan: '192.168.1.0/24' },
  { ip: '192.168.1.24', name: 'labor2.lab.example.org', ports: [22], lan: '192.168.1.0/24' },
  { ip: '192.168.1.40', name: 'laser.lan', ports: [80, 631, 9100], lan: '192.168.1.0/24' },
  { ip: '192.168.2.1', name: 'wlan-router.lan', ports: [53, 80], lan: '192.168.2.0/24' },
  { ip: '203.0.113.80', name: 'www.example.org', ports: [80, 443], ip6: '2001:db8:80::80' },
  { ip: '203.0.113.25', name: 'mail.example.org', ports: [25, 465, 993, 995] },
  { ip: '203.0.113.53', name: 'ns1.example.org', ports: [53] },
  { ip: '10.20.0.5', name: 'logserver.example.org', ports: [22, 514] },
];
const DNS: Record<string, { A?: string[]; AAAA?: string[]; MX?: string[]; NS?: string[]; CNAME?: string }> = {
  'example.org': { A: ['203.0.113.10'], MX: ['10 mail.example.org'], NS: ['ns1.example.org'] },
  'www.example.org': { A: ['203.0.113.80'], AAAA: ['2001:db8:80::80'] },
  'web.example.org': { CNAME: 'www.example.org' },
  'mail.example.org': { A: ['203.0.113.25'] },
  'ns1.example.org': { A: ['203.0.113.53'] },
  'logserver.example.org': { A: ['10.20.0.5'] },
  'labor2.lab.example.org': { A: ['192.168.1.24'] },
  'werkstatt.lab.example.org': { A: ['192.168.1.23'] },
  'router.lan': { A: ['192.168.1.1'] },
  'laser.lan': { A: ['192.168.1.40'] },
  'labor-gw.lan': { A: ['192.168.1.254'] },
};
const PTR: Record<string, string> = { '203.0.113.80': 'www.example.org', '203.0.113.25': 'mail.example.org', '192.168.1.24': 'labor2.lab.example.org', '192.168.1.23': 'werkstatt.lab.example.org' };
// Welcher Router erreicht welche Netze?
const ROUTER: Record<string, string[]> = { '192.168.1.1': ['0.0.0.0/0'], '192.168.2.1': ['0.0.0.0/0'], '192.168.1.254': ['10.20.0.0/16'] };
const BLOCKIERT_UEBER: Record<string, string[]> = { '192.168.1.1': ['10.0.0.0/8'], '192.168.2.1': ['10.0.0.0/8'] };

// ---------- IP-Rechnerei ----------

export const ipZahl = (ip: string) => ip.split('.').reduce((s, x) => s * 256 + Number(x), 0);
const zahlIp = (n: number) => [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join('.');
const istIp = (s: string) => /^(\d{1,3})(\.\d{1,3}){3}$/.test(s) && s.split('.').every((x) => Number(x) <= 255);
export function imNetz(ip: string, cidr: string) {
  const [n, p] = cidr.split('/'); const bits = Number(p ?? 32);
  if (bits === 0) return true;
  const m = 2 ** 32 - 2 ** (32 - bits);
  return (ipZahl(ip) & m) >>> 0 === (ipZahl(n) & m) >>> 0;
}
const netzVon = (cidr: string) => { const [ip, p] = cidr.split('/'); const b = Number(p); const m = b ? 2 ** 32 - 2 ** (32 - b) : 0; return `${zahlIp((ipZahl(ip) & m) >>> 0)}/${b}`; };
const maske = (b: number) => zahlIp(b ? 2 ** 32 - 2 ** (32 - b) : 0);
const bcast = (cidr: string) => { const [ip, p] = cidr.split('/'); const b = Number(p); return zahlIp(((ipZahl(ip) | (2 ** (32 - b) - 1)) >>> 0)); };
const maskeBits = (m: string) => m.split('.').map(Number).reduce((s, x) => s + x.toString(2).split('').filter((c) => c === '1').length, 0);

// ---------- Zustand ----------

interface If { mac: string; up: boolean; addr: string[]; addr6: string[]; typ: 'loopback' | 'ethernet' | 'wifi'; kabel: boolean }
interface Route { ziel: string; via?: string; dev: string; proto: string; metric?: number; src?: string }
interface Profil { typ: 'ethernet' | 'wifi'; ifname: string; method: 'auto' | 'manual' | 'disabled'; addresses: string[]; gateway?: string; dns: string[]; autoconnect: boolean; ssid?: string; psk?: string; uuid: string }
export interface NetzStand { ifs: Record<string, If>; routes: Route[]; route6: boolean; profile: Record<string, Profil>; aktiv: Record<string, string>; wlan: boolean; ifupdown: string[] }
const KABEL = 'Kabelgebundene Verbindung 1';
export function ns(w: Welt): NetzStand {
  const x = w as Welt & { netz?: NetzStand };
  if (!x.netz) {
    x.netz = {
      ifs: {
        lo: { mac: '00:00:00:00:00:00', up: true, addr: ['127.0.0.1/8'], addr6: ['::1/128'], typ: 'loopback', kabel: true },
        enp0s31f6: { mac: '3c:7c:3f:1a:2b:4d', up: true, addr: ['192.168.1.23/24'], addr6: ['2001:db8:1::23/64', 'fe80::3e7c:3fff:fe1a:2b4d/64'], typ: 'ethernet', kabel: true },
        wlp2s0: { mac: 'a4:c3:f0:5e:91:07', up: true, addr: [], addr6: [], typ: 'wifi', kabel: false },
      },
      routes: [], route6: true,
      profile: { [KABEL]: { typ: 'ethernet', ifname: 'enp0s31f6', method: 'auto', addresses: [], dns: [], autoconnect: true, uuid: '5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d' } },
      aktiv: { enp0s31f6: KABEL }, wlan: true, ifupdown: [],
    };
    x.netz.routes = [{ ziel: 'default', via: '192.168.1.1', dev: 'enp0s31f6', proto: 'dhcp', metric: 100, src: '192.168.1.23' }, { ziel: '192.168.1.0/24', dev: 'enp0s31f6', proto: 'kernel', metric: 100, src: '192.168.1.23' }];
  }
  return x.netz;
}

export function netzDateien(fs: Record<string, string | null>) {
  Object.assign(fs, {
    '/etc/hosts': '127.0.0.1\tlocalhost\n127.0.1.1\twerkstatt\n\n# The following lines are desirable for IPv6 capable hosts\n::1     localhost ip6-localhost ip6-loopback\nff02::1 ip6-allnodes\nff02::2 ip6-allrouters\n',
    '/etc/resolv.conf': '# Generated by NetworkManager\nsearch lab.example.org\nnameserver 192.168.1.1\n',
    '/etc/nsswitch.conf': '# /etc/nsswitch.conf\n#\n# Example configuration of GNU Name Service Switch functionality.\n# If you have the `glibc-doc-reference\' and `info\' packages installed, try:\n# `info libc "Name Service Switch"\' for information about this file.\n\npasswd:         files systemd\ngroup:          files systemd\nshadow:         files\ngshadow:        files\n\nhosts:          files mdns4_minimal [NOTFOUND=return] dns myhostname\nnetworks:       files\n\nprotocols:      db files\nservices:       db files\nethers:         db files\nrpc:            db files\n\nnetgroup:       nis\n',
    '/etc/services': '# Network services, Internet style\n#\n# Updated from https://www.iana.org/assignments/service-names-port-numbers/service-names-port-numbers.xhtml .\n#\n# New ports will be added on request if they have been officially assigned\n# by IANA and used in the real-world or are needed by a debian package.\n\ntcpmux\t\t1/tcp\t\t\t\t# TCP port service multiplexer\necho\t\t7/tcp\nftp-data\t20/tcp\nftp\t\t21/tcp\nfsp\t\t21/udp\t\tfspd\nssh\t\t22/tcp\t\t\t\t# SSH Remote Login Protocol\ntelnet\t\t23/tcp\nsmtp\t\t25/tcp\t\tmail\ntime\t\t37/tcp\t\ttimserver\nwhois\t\t43/tcp\t\tnicname\ndomain\t\t53/tcp\t\t\t\t# Domain Name Server\ndomain\t\t53/udp\nbootps\t\t67/udp\nbootpc\t\t68/udp\ntftp\t\t69/udp\nhttp\t\t80/tcp\t\twww\t\t# WorldWideWeb HTTP\nkerberos\t88/tcp\t\tkerberos5 krb5 kerberos-sec\npop3\t\t110/tcp\t\tpop-3\t\t# POP version 3\nsunrpc\t\t111/tcp\t\tportmapper\t# RPC 4.0 portmapper\nauth\t\t113/tcp\t\tauthentication tap ident\nnntp\t\t119/tcp\t\treadnews untp\t# USENET News Transfer Protocol\nntp\t\t123/udp\t\t\t\t# Network Time Protocol\nepmap\t\t135/tcp\t\tloc-srv\t\t# DCE endpoint resolution\nnetbios-ns\t137/udp\t\t\t\t# NETBIOS Name Service\nnetbios-dgm\t138/udp\t\t\t\t# NETBIOS Datagram Service\nnetbios-ssn\t139/tcp\t\t\t\t# NETBIOS session service\nimap2\t\t143/tcp\t\timap\t\t# Interim Mail Access P 2 and 4\nsnmp\t\t161/tcp\t\t\t\t# Simple Net Mgmt Protocol\nsnmp\t\t161/udp\nsnmp-trap\t162/tcp\t\tsnmptrap\nsnmp-trap\t162/udp\t\tsnmptrap\t# Traps for SNMP\nldap\t\t389/tcp\t\t\t# Lightweight Directory Access Protocol\nldap\t\t389/udp\nhttps\t\t443/tcp\t\t\t\t# http protocol over TLS/SSL\nhttps\t\t443/udp\t\t\t\t# HTTP/3\nmicrosoft-ds\t445/tcp\t\t\t\t# Microsoft Naked CIFS\nsubmissions\t465/tcp\t\tssmtp smtps urd # Submission over TLS [RFC8314]\nsyslog\t\t514/udp\nprinter\t\t515/tcp\t\tspooler\t\t# line printer spooler\nsubmission\t587/tcp\t\t\t\t# Submission [RFC4409]\nipp\t\t631/tcp\t\t\t\t# Internet Printing Protocol\nldaps\t\t636/tcp\t\t\t\t# LDAP over SSL\nldaps\t\t636/udp\nimaps\t\t993/tcp\t\t\t\t# IMAP over SSL\npop3s\t\t995/tcp\t\t\t\t# POP-3 over SSL\n',
    '/etc/network': null, '/etc/network/interfaces.d': null,
    '/etc/network/interfaces': '# This file describes the network interfaces available on your system\n# and how to activate them. For more information, see interfaces(5).\n\nsource /etc/network/interfaces.d/*\n\n# The loopback network interface\nauto lo\niface lo inet loopback\n',
    '/etc/NetworkManager': null, '/etc/NetworkManager/NetworkManager.conf': '[main]\nplugins=ifupdown,keyfile\n\n[ifupdown]\nmanaged=false\n',
    '/etc/NetworkManager/system-connections': null,
    '/etc/systemd/network': null,
  });
}

export interface NetzOptionen { keinDefault?: boolean; dnsFalsch?: boolean; kabelAus?: boolean; maskeFalsch?: boolean; nsswitchOhneDns?: boolean; hostsFalsch?: boolean }
export function netzStarten(w: Welt, o: NetzOptionen = {}) {
  const st = ns(w);
  if (o.keinDefault) st.routes = st.routes.filter((r) => r.ziel !== 'default');
  if (o.dnsFalsch) w.fs['/etc/resolv.conf'] = '# Generated by NetworkManager\nsearch lab.example.org\nnameserver 192.168.1.9\n';
  if (o.kabelAus) { st.ifs.enp0s31f6.up = false; st.routes = st.routes.filter((r) => r.dev !== 'enp0s31f6'); delete st.aktiv.enp0s31f6; }
  if (o.maskeFalsch) { st.ifs.enp0s31f6.addr = ['192.168.1.23/28']; st.routes = st.routes.filter((r) => r.ziel !== '192.168.1.0/24'); st.routes.push({ ziel: '192.168.1.16/28', dev: 'enp0s31f6', proto: 'kernel', metric: 100, src: '192.168.1.23' }); }
  if (o.nsswitchOhneDns) w.fs['/etc/nsswitch.conf'] = (w.fs['/etc/nsswitch.conf'] ?? '').replace(/^hosts:.*$/m, 'hosts:          files');
  if (o.hostsFalsch) w.fs['/etc/hosts'] = (w.fs['/etc/hosts'] ?? '') + '\n# Testserver, vorübergehend\n192.168.1.99\twww.example.org\n';
}

// ---------- Erreichbarkeit ----------

function eigeneIps(st: NetzStand) { return Object.values(st.ifs).filter((i) => i.up).flatMap((i) => i.addr.map((a) => a.split('/')[0])); }
function routeFuer(st: NetzStand, ip: string): Route | null {
  let best: Route | null = null; let bits = -1;
  for (const r of st.routes) {
    const ziel = r.ziel === 'default' ? '0.0.0.0/0' : r.ziel; const b = Number(ziel.split('/')[1] ?? 32);
    if (imNetz(ip, ziel) && b > bits && st.ifs[r.dev]?.up) { best = r; bits = b; }
  }
  return best;
}
type Weg = { art: 'ok'; hops: string[] } | { art: 'kein-netz' } | { art: 'nicht-da'; von: string } | { art: 'still'; hops: string[] };
function weg(w: Welt, ip: string): Weg {
  const st = ns(w);
  if (ip.startsWith('127.') || eigeneIps(st).includes(ip)) return { art: 'ok', hops: [ip] };
  const r = routeFuer(st, ip); if (!r) return { art: 'kein-netz' };
  const src = st.ifs[r.dev].addr.find((a) => !r.src || a.startsWith(r.src))?.split('/')[0] ?? '';
  const lanHost = (x: string) => HOSTS.find((h) => h.ip === x && h.lan && imNetz(x, h.lan) && st.ifs[r.dev].addr.some((a) => imNetz(x, netzVon(a))));
  if (!r.via) {
    // direkt erreichbar: Der Host muss wirklich in diesem Netz stehen und die Schnittstelle Kabel haben
    const h = HOSTS.find((x) => x.ip === ip && x.lan && st.ifs[r.dev].addr.some((a) => imNetz(ip, netzVon(a))) && (r.dev === 'wlp2s0' ? x.lan === '192.168.2.0/24' : x.lan === '192.168.1.0/24'));
    return h && st.ifs[r.dev].kabel ? { art: 'ok', hops: [ip] } : { art: 'nicht-da', von: src };
  }
  if (!lanHost(r.via) || !st.ifs[r.dev].kabel || !ROUTER[r.via]) return { art: 'nicht-da', von: src };
  if ((BLOCKIERT_UEBER[r.via] ?? []).some((n) => imNetz(ip, n)) || !ROUTER[r.via].some((n) => imNetz(ip, n))) return { art: 'still', hops: [r.via] };
  const h = HOSTS.find((x) => x.ip === ip);
  if (!h) return { art: 'still', hops: [r.via, ...(ip.startsWith('10.') ? [] : ['100.64.0.1', '198.51.100.1'])] };
  return { art: 'ok', hops: [r.via, ...(ip.startsWith('10.') ? [] : ['100.64.0.1', '198.51.100.1']), ip] };
}
const nameVon = (ip: string) => HOSTS.find((h) => h.ip === ip)?.name ?? ip;

/** Lauscht auf dem eigenen Rechner etwas an diesem TCP-Port, für diese Adresse? */
export function lokalOffen(w: Welt, ip: string, port: number): boolean {
  const extra = extraSockets(w); const sshWeg = extra.some((x) => x.s === 'WEG');
  const alle = [...(sshWeg ? [] : [{ p: 'tcp', s: 'LISTEN', l: '0.0.0.0:22' }]), { p: 'tcp', s: 'LISTEN', l: '127.0.0.1:25' }, { p: 'tcp', s: 'LISTEN', l: '127.0.0.1:631' }, ...extra];
  return alle.some((x) => x.p === 'tcp' && x.s === 'LISTEN' && Number(x.l.split(':').pop()) === port && (x.l.startsWith('0.0.0.0') || x.l.startsWith('[::]') || x.l.startsWith('*') || (ip.startsWith('127.') && x.l.startsWith('127.')) || x.l.startsWith(ip + ':')));
}
/** Für nmap und ssh: Wohin führt ein Name, ist das Ziel erreichbar, welche Ports sind offen? */
export function fernZiel(w: Welt, name: string): { ip: string | null; name: string; fehler?: string; erreichbar: boolean; lokal: boolean; ports: number[] } {
  const r = aufloesen(w, name);
  if (!r.ip) return { ip: null, name, fehler: r.fehler, erreichbar: false, lokal: false, ports: [] };
  const lokal = r.ip.startsWith('127.') || eigeneIps(ns(w)).includes(r.ip);
  const wg = weg(w, r.ip);
  const h = HOSTS.find((x) => x.ip === r.ip);
  return { ip: r.ip, name: lokal ? (r.ip.startsWith('127.') ? 'localhost' : w.host) : h?.name ?? name, erreichbar: wg.art === 'ok', lokal, ports: lokal ? [] : h?.ports ?? [] };
}
export function netzHosts(w: Welt, cidr: string): string[] { return [...eigeneIps(ns(w)).filter((ip) => imNetz(ip, cidr)), ...HOSTS.filter((h) => imNetz(h.ip, cidr) && weg(w, h.ip).art === 'ok').map((h) => h.ip)]; }

// ---------- Namensauflösung ----------

interface DnsAntwort { status: 'NOERROR' | 'NXDOMAIN'; antwort: string[]; server: string }
function dnsServer(w: Welt): string[] { return (w.fs['/etc/resolv.conf'] ?? '').split('\n').map((z) => z.match(/^nameserver\s+(\S+)/)?.[1]).filter(Boolean) as string[]; }
function suchdomains(w: Welt): string[] { const z = (w.fs['/etc/resolv.conf'] ?? '').match(/^(search|domain)\s+(.+)$/m); return z ? z[2].split(/\s+/) : []; }
const istDnsServer = (w: Welt, ip: string) => HOSTS.some((h) => h.ip === ip && h.ports.includes(53)) && weg(w, ip).art === 'ok';
function frage(w: Welt, name: string, typ: string, server?: string): DnsAntwort | { fehler: string; server: string } {
  const liste = server ? [server] : dnsServer(w);
  const s = liste.find((x) => istDnsServer(w, x));
  if (!s) return { fehler: 'timeout', server: liste[0] ?? '127.0.0.1' };
  const n = name.replace(/\.$/, '').toLowerCase();
  if (typ === 'PTR') { const ip = n.replace(/\.in-addr\.arpa$/, '').split('.').reverse().join('.'); return PTR[ip] ? { status: 'NOERROR', antwort: [`${ip.split('.').reverse().join('.')}.in-addr.arpa.\t3600\tIN\tPTR\t${PTR[ip]}.`], server: s } : { status: 'NXDOMAIN', antwort: [], server: s }; }
  const e = DNS[n]; if (!e) return { status: 'NXDOMAIN', antwort: [], server: s };
  const out: string[] = [];
  if (e.CNAME) { out.push(`${n}.\t3600\tIN\tCNAME\t${e.CNAME}.`); const z = DNS[e.CNAME]; for (const a of (z?.[typ as 'A'] ?? []) as string[]) out.push(`${e.CNAME}.\t3600\tIN\t${typ}\t${a}${typ === 'MX' || typ === 'NS' ? '.' : ''}`); }
  else for (const a of ((e as Record<string, string[] | undefined>)[typ] ?? [])) out.push(`${n}.\t3600\tIN\t${typ}\t${a}${typ === 'MX' || typ === 'NS' ? '.' : ''}`);
  return { status: 'NOERROR', antwort: out, server: s };
}
/** Wie glibc: Reihenfolge aus /etc/nsswitch.conf (files, dns, myhostname). */
export function aufloesen(w: Welt, name: string): { ip: string | null; fehler?: 'unbekannt' | 'temporaer' } {
  if (istIp(name)) return { ip: name };
  const zeile = (w.fs['/etc/nsswitch.conf'] ?? '').match(/^hosts:\s*(.+)$/m)?.[1] ?? 'files dns';
  let temporaer = false;
  for (const q of zeile.split(/\s+/)) {
    if (q === 'files') { for (const z of (w.fs['/etc/hosts'] ?? '').split('\n')) { const t = z.replace(/#.*/, '').trim().split(/\s+/); if (t.length > 1 && t.slice(1).includes(name) && istIp(t[0])) return { ip: t[0] }; } }
    if (q === 'dns') {
      const namen = name.includes('.') ? [name] : [...suchdomains(w).map((d) => `${name}.${d}`), name];
      for (const n of namen) { const r = frage(w, n, 'A'); if ('fehler' in r) { temporaer = true; break; } const a = r.antwort.map((x) => x.split('\t').pop()!).find(istIp); if (a) return { ip: a }; }
    }
    if (q === 'myhostname' && (name === w.host || name === 'localhost')) return { ip: name === 'localhost' ? '127.0.0.1' : '127.0.1.1' };
  }
  return { ip: null, fehler: temporaer ? 'temporaer' : 'unbekannt' };
}

// ---------- Befehle ----------

const NUR_ROOT = 'RTNETLINK answers: Operation not permitted';
function ipZeigen(w: Welt, nurDev?: string, kurz = false, mitAdr = true, v6 = true, v4 = true): string {
  const st = ns(w); const out: string[] = []; let k = 0;
  for (const [n, i] of Object.entries(st.ifs)) {
    k++; if (nurDev && n !== nurDev) continue;
    const zustand = n === 'lo' ? 'UNKNOWN' : i.up && i.kabel ? 'UP' : i.up ? 'DOWN' : 'DOWN';
    if (kurz) { out.push(`${n.padEnd(16)} ${zustand.padEnd(14)} ${mitAdr ? [...(v4 ? i.addr : []), ...(v6 ? i.addr6 : [])].join(' ') : i.mac + ' <' + (i.up ? 'BROADCAST,MULTICAST,UP,LOWER_UP' : 'BROADCAST,MULTICAST') + '>'} `); continue; }
    const flags = n === 'lo' ? 'LOOPBACK,UP,LOWER_UP' : i.up ? (i.kabel ? 'BROADCAST,MULTICAST,UP,LOWER_UP' : 'NO-CARRIER,BROADCAST,MULTICAST,UP') : 'BROADCAST,MULTICAST';
    out.push(`${k}: ${n}: <${flags}> mtu ${n === 'lo' ? 65536 : 1500} qdisc ${n === 'lo' ? 'noqueue' : i.typ === 'wifi' ? 'noqueue' : 'fq_codel'} state ${zustand} group default qlen 1000`);
    out.push(`    link/${n === 'lo' ? 'loopback' : 'ether'} ${i.mac} brd ${n === 'lo' ? '00:00:00:00:00:00' : 'ff:ff:ff:ff:ff:ff'}`);
    if (!mitAdr) continue;
    if (v4) for (const a of i.addr) out.push(`    inet ${a}${n === 'lo' ? '' : ' brd ' + bcast(a)} scope ${n === 'lo' ? 'host' : 'global'}${st.aktiv[n] && st.profile[st.aktiv[n]]?.method === 'auto' ? ' dynamic noprefixroute' : st.aktiv[n] ? ' noprefixroute' : ''} ${n}`, `       valid_lft ${st.aktiv[n] && st.profile[st.aktiv[n]]?.method === 'auto' ? '85231sec preferred_lft 85231sec' : 'forever preferred_lft forever'}`);
    if (v6) for (const a of i.addr6) out.push(`    inet6 ${a} scope ${a === '::1/128' ? 'host' : a.startsWith('fe80') ? 'link' : 'global dynamic mngtmpaddr'} ${a.startsWith('fe80') || a === '::1/128' ? 'noprefixroute ' : ''}`, `       valid_lft forever preferred_lft forever`);
  }
  return out.join('\n');
}
function routeText(r: Route) { return `${r.ziel}${r.via ? ` via ${r.via}` : ''} dev ${r.dev} proto ${r.proto}${r.via ? '' : ' scope link'}${r.src ? ` src ${r.src}` : ''}${r.metric !== undefined ? ` metric ${r.metric}` : ''} `; }
function adrHinzu(st: NetzStand, dev: string, cidr: string) {
  st.ifs[dev].addr.push(cidr);
  const net = netzVon(cidr); if (!st.routes.some((r) => r.ziel === net && r.dev === dev)) st.routes.push({ ziel: net, dev, proto: 'kernel', src: cidr.split('/')[0] });
}
function adrWeg(st: NetzStand, dev: string, cidr?: string) {
  const weg = cidr ? st.ifs[dev].addr.filter((a) => a === cidr) : st.ifs[dev].addr;
  st.ifs[dev].addr = st.ifs[dev].addr.filter((a) => !weg.includes(a));
  for (const a of weg) { const net = netzVon(a); st.routes = st.routes.filter((r) => !(r.dev === dev && (r.ziel === net || (r.via && imNetz(r.via, net))))); }
}

function profilAnwenden(w: Welt, name: string): string | null {
  const st = ns(w); const p = st.profile[name]; if (!p) return `Error: unknown connection '${name}'.`;
  const i = st.ifs[p.ifname]; if (!i) return `Error: Connection activation failed: No suitable device found for this connection (device ${p.ifname} not available).`;
  if (p.typ === 'wifi' && !st.wlan) return 'Error: Connection activation failed: No suitable device found for this connection (device wlp2s0 not available because device is not available).';
  if (p.typ === 'ethernet' && !i.kabel) return 'Error: Connection activation failed: No suitable device found for this connection (device enp0s31f6 not available because device has no carrier).';
  // altes Profil auf dieser Schnittstelle abräumen
  adrWeg(st, p.ifname); st.routes = st.routes.filter((r) => r.dev !== p.ifname); i.up = true;
  if (p.typ === 'wifi') i.kabel = true;
  let dns: string[] = p.dns; let gw = p.gateway;
  if (p.method === 'auto') {
    const lan = p.typ === 'wifi' ? '192.168.2' : '192.168.1';
    const ip = p.typ === 'wifi' ? `${lan}.31/24` : `${lan}.23/24`;
    adrHinzu(st, p.ifname, ip); gw = `${lan}.1`; if (!dns.length) dns = [`${lan}.1`];
    st.routes.find((r) => r.dev === p.ifname)!.metric = p.typ === 'wifi' ? 600 : 100; st.routes.find((r) => r.dev === p.ifname)!.proto = 'kernel';
  } else if (p.method === 'manual') { for (const a of p.addresses) adrHinzu(st, p.ifname, a); }
  if (gw) st.routes.unshift({ ziel: 'default', via: gw, dev: p.ifname, proto: p.method === 'auto' ? 'dhcp' : 'static', metric: p.typ === 'wifi' ? 600 : 100, src: st.ifs[p.ifname].addr[0]?.split('/')[0] });
  st.aktiv[p.ifname] = name;
  const such = p.typ === 'ethernet' ? 'search lab.example.org\n' : '';
  if (dns.length) w.fs['/etc/resolv.conf'] = `# Generated by NetworkManager\n${such}${dns.map((d) => `nameserver ${d}`).join('\n')}\n`;
  w.fs[`/etc/NetworkManager/system-connections/${name}.nmconnection`] = `[connection]\nid=${name}\nuuid=${p.uuid}\ntype=${p.typ}\ninterface-name=${p.ifname}\n${p.ssid ? `\n[wifi]\nmode=infrastructure\nssid=${p.ssid}\n\n[wifi-security]\nkey-mgmt=wpa-psk\npsk=${p.psk}\n` : ''}\n[ipv4]\nmethod=${p.method}\n${p.addresses.length ? `address1=${p.addresses[0]}${p.gateway ? ',' + p.gateway : ''}\n` : ''}${p.dns.length ? `dns=${p.dns.join(';')};\n` : ''}\n[ipv6]\nmethod=auto\n`;
  return null;
}

export function netzBefehle(alt: Record<string, B>): Record<string, B> {
  const b: Record<string, B> = {};

  b.ip = (w, a, _i, root) => {
    const st = ns(w); const r = root || w.root;
    const opt = a.filter((x) => /^-[46a-z]+$/.test(x) && !['-c'].includes(x)); const rest = a.filter((x) => !opt.includes(x));
    const v4 = !opt.includes('-6'); const v6 = !opt.includes('-4'); const kurz = opt.some((x) => /^-b(r|rief)?$/.test(x)) || opt.includes('-br');
    const [obj = 'help', cmd = 'show', ...args] = rest;
    const devArg = () => { const k = args.indexOf('dev'); return k >= 0 ? args[k + 1] : args.find((x) => st.ifs[x]); };
    if (/^a(d(dr?)?)?$|^address$/.test(obj)) {
      if (cmd === 'show' || cmd === 'list' || cmd === 'ls' || st.ifs[cmd]) { const d = st.ifs[cmd] ? cmd : devArg(); if (d && !st.ifs[d]) return fehler(`Device "${d}" does not exist.`); return ok(ipZeigen(w, d, kurz, true, v6, v4)); }
      if (!r) return fehler(NUR_ROOT, 2);
      const d = devArg(); if (!d || !st.ifs[d]) return fehler(`Cannot find device "${d ?? ''}"`);
      if (cmd === 'add') { let c = args[0]; if (!c.includes('/')) c += '/32'; if (!istIp(c.split('/')[0])) return fehler(`Error: inet prefix is expected rather than "${args[0]}".`); if (st.ifs[d].addr.includes(c)) return fehler('RTNETLINK answers: File exists', 2); adrHinzu(st, d, c); return ok(); }
      if (cmd === 'del' || cmd === 'delete') { let c = args[0]; if (!c.includes('/')) c += '/32'; if (!st.ifs[d].addr.includes(c)) return fehler('RTNETLINK answers: Cannot assign requested address', 2); adrWeg(st, d, c); return ok(); }
      if (cmd === 'flush') { adrWeg(st, d); return ok(); }
    }
    if (/^l(i(nk?)?)?$/.test(obj)) {
      if (cmd === 'show' || cmd === 'list' || st.ifs[cmd]) { const d = st.ifs[cmd] ? cmd : devArg(); return ok(ipZeigen(w, d, kurz, false)); }
      if (cmd === 'set') {
        if (!r) return fehler(NUR_ROOT, 2);
        const d = devArg(); if (!d || !st.ifs[d]) return fehler(`Cannot find device "${d ?? args[0] ?? ''}"`);
        if (args.includes('up')) { st.ifs[d].up = true; for (const x of st.ifs[d].addr) { const net = netzVon(x); if (!st.routes.some((q) => q.ziel === net && q.dev === d)) st.routes.push({ ziel: net, dev: d, proto: 'kernel', src: x.split('/')[0] }); } }
        if (args.includes('down')) { st.ifs[d].up = false; st.routes = st.routes.filter((q) => q.dev !== d); delete st.aktiv[d]; }
        return ok();
      }
    }
    if (/^r(o(u(te?)?)?)?$/.test(obj)) {
      if (cmd === 'show' || cmd === 'list') { if (opt.includes('-6')) return ok(st.route6 ? '2001:db8:1::/64 dev enp0s31f6 proto ra metric 100 pref medium\nfe80::/64 dev enp0s31f6 proto kernel metric 1024 pref medium\ndefault via fe80::1 dev enp0s31f6 proto ra metric 100 expires 1785sec pref medium' : 'fe80::/64 dev enp0s31f6 proto kernel metric 1024 pref medium'); return ok(st.routes.filter((q) => st.ifs[q.dev]?.up).map(routeText).join('\n')); }
      if (cmd === 'get') { const ziel = args[0]; const q = routeFuer(st, ziel); if (!q) return fehler('RTNETLINK answers: Network is unreachable', 2); return ok(`${ziel} ${q.via ? `via ${q.via} ` : ''}dev ${q.dev} src ${q.src ?? st.ifs[q.dev].addr[0]?.split('/')[0]} uid ${r ? 0 : 1000} \n    cache `); }
      if (!r) return fehler(NUR_ROOT, 2);
      const ziel0 = args[0]; const ziel = ziel0 === 'default' || ziel0 === '0.0.0.0/0' ? 'default' : ziel0?.includes('/') ? netzVon(ziel0) : ziel0 + '/32';
      const k = args.indexOf('via'); const via = k >= 0 ? args[k + 1] : undefined; let dev = devArg();
      if (cmd === 'add' || cmd === 'replace') {
        if (via) { const direkt = st.routes.find((q) => !q.via && q.ziel !== 'default' && imNetz(via, q.ziel) && st.ifs[q.dev]?.up); if (!direkt) return fehler('Error: Nexthop has invalid gateway.', 2); dev = dev ?? direkt.dev; }
        if (!dev) return fehler('Error: Device for nexthop is not up.', 2);
        if (cmd === 'add' && st.routes.some((q) => q.ziel === ziel && q.dev === dev && (q.metric ?? 0) === Number(args[args.indexOf('metric') + 1] ?? 0))) return fehler('RTNETLINK answers: File exists', 2);
        if (cmd === 'replace') st.routes = st.routes.filter((q) => q.ziel !== ziel);
        st.routes.push({ ziel, via, dev, proto: 'static', ...(args.includes('metric') ? { metric: Number(args[args.indexOf('metric') + 1]) } : {}) });
        return ok();
      }
      if (cmd === 'del' || cmd === 'delete') { const n = st.routes.length; st.routes = st.routes.filter((q) => !(q.ziel === ziel && (!via || q.via === via))); return n === st.routes.length ? fehler('RTNETLINK answers: No such process', 2) : ok(); }
    }
    if (/^n(e(i(gh?)?)?)?$/.test(obj)) return ok(`192.168.1.1 dev enp0s31f6 lladdr 9c:c9:eb:12:34:56 REACHABLE\n192.168.1.40 dev enp0s31f6 lladdr 00:1f:29:aa:bb:cc STALE\nfe80::1 dev enp0s31f6 lladdr 9c:c9:eb:12:34:56 router REACHABLE`);
    return fehler('Usage: ip [ OPTIONS ] OBJECT { COMMAND | help }\nwhere  OBJECT := { address | link | neighbour | route | rule | … }');
  };

  // --- net-tools (veraltet, aber Prüfungsstoff) ---
  b.ifconfig = (w, a, _i, root) => {
    const st = ns(w); const [d, ...rest] = a.filter((x) => x !== '-a');
    if (d && !st.ifs[d]) return fehler(`${d}: Fehler beim Auslesen der Schnittstelleninformation: Gerät nicht gefunden`);
    if (d && rest.length) {
      if (!(root || w.root)) return fehler('SIOCSIFFLAGS: Vorgang nicht zulässig');
      if (rest[0] === 'up' || rest[0] === 'down') return b.ip(w, ['link', 'set', d, rest[0]], '', true);
      const k = rest.indexOf('netmask'); const bits = k >= 0 ? maskeBits(rest[k + 1]) : 24;
      adrWeg(st, d); adrHinzu(st, d, `${rest[0]}/${bits}`); return ok();
    }
    const out: string[] = [];
    for (const [n, i] of Object.entries(st.ifs)) {
      if (d && n !== d) continue; if (!d && !i.up && !a.includes('-a')) continue;
      const fl = n === 'lo' ? '73<UP,LOOPBACK,RUNNING>' : i.up && i.kabel ? '4163<UP,BROADCAST,RUNNING,MULTICAST>' : i.up ? '4099<UP,BROADCAST,MULTICAST>' : '4098<BROADCAST,MULTICAST>';
      out.push(`${n}: flags=${fl}  mtu ${n === 'lo' ? 65536 : 1500}`);
      for (const x of i.addr) { const [ip, p] = x.split('/'); out.push(`        inet ${ip}  netmask ${maske(Number(p))}${n === 'lo' ? '' : `  broadcast ${bcast(x)}`}`); }
      for (const x of i.addr6) { const [ip, p] = x.split('/'); out.push(`        inet6 ${ip}  prefixlen ${p}  scopeid ${ip.startsWith('fe80') ? '0x20<link>' : ip === '::1' ? '0x10<host>' : '0x0<global>'}`); }
      out.push(n === 'lo' ? '        loop  txqueuelen 1000  (Lokale Schleife)' : `        ether ${i.mac}  txqueuelen 1000  (Ethernet)`, `        RX packets ${n === 'lo' ? 4120 : i.addr.length ? 182344 : 0}  bytes ${n === 'lo' ? 401233 : i.addr.length ? 201233412 : 0}`, `        TX packets ${n === 'lo' ? 4120 : i.addr.length ? 98211 : 0}  bytes ${n === 'lo' ? 401233 : i.addr.length ? 12873411 : 0}`, '');
    }
    return ok(out.join('\n').replace(/\n$/, ''));
  };
  const routeTabelle = (w: Welt) => `Kernel-IP-Routentabelle\nZiel            Router          Genmask         Flags Metric Ref    Use Iface\n${ns(w).routes.filter((r) => ns(w).ifs[r.dev]?.up).map((r) => { const z = r.ziel === 'default' ? '0.0.0.0/0' : r.ziel; const [n, p] = z.split('/'); return `${n.padEnd(16)}${(r.via ?? '0.0.0.0').padEnd(16)}${maske(Number(p)).padEnd(16)}${(r.via ? 'UG' : 'U').padEnd(6)}${String(r.metric ?? 0).padEnd(7)}0        0 ${r.dev}`; }).join('\n')}`;
  b.route = (w, a, _i, root) => {
    if (!a.length || a.every((x) => x.startsWith('-'))) return ok(routeTabelle(w));
    if (!(root || w.root)) return fehler('SIOCADDRT: Vorgang nicht zulässig');
    const cmd = a[0]; const gi = a.indexOf('gw'); const gw = gi >= 0 ? a[gi + 1] : undefined;
    let ziel = 'default';
    if (a.includes('-net')) { ziel = a[a.indexOf('-net') + 1]; const mi = a.indexOf('netmask'); if (mi >= 0) ziel += '/' + maskeBits(a[mi + 1]); }
    if (a.includes('-host')) ziel = a[a.indexOf('-host') + 1];
    const r = b.ip(w, ['route', cmd === 'add' ? 'add' : 'del', ziel, ...(gw ? ['via', gw] : [])], '', true);
    return r.code ? fehler(cmd === 'add' ? 'SIOCADDRT: Das Netzwerk ist nicht erreichbar' : 'SIOCDELRT: Kein passender Prozess gefunden') : r;
  };
  const sockets = (w: Welt, root: boolean, alle: boolean) => [...[
    ['udp', 'UNCONN', '127.0.0.1:323', '0.0.0.0:*', 'chronyd', 690], ['udp', 'UNCONN', '0.0.0.0:5353', '0.0.0.0:*', 'avahi-daemon', 601],
    ['tcp', 'LISTEN', '0.0.0.0:22', '0.0.0.0:*', 'sshd', 901], ['tcp', 'LISTEN', '127.0.0.1:25', '0.0.0.0:*', 'master', 1301], ['tcp', 'LISTEN', '127.0.0.1:631', '0.0.0.0:*', 'cupsd', 1712],
    ['tcp', 'LISTEN', '[::]:22', '[::]:*', 'sshd', 901],
    ...(alle ? [['tcp', 'ESTAB', '192.168.1.23:22', '192.168.1.17:51122', 'sshd', 3048], ['tcp', 'ESTAB', '192.168.1.23:43110', '203.0.113.80:443', 'firefox-esr', 1450]] : []),
  ].map(([p, s, l, f, prog, pid]) => ({ p, s, l, f, prog, pid } as Sock)), ...extraSockets(w)].filter((x, _k, alle) => x.s !== 'WEG' && !alle.some((y) => y.s === 'WEG' && y.p === x.p && x.l.split(':').pop() === y.l.split(':').pop() && x.prog === 'sshd')).map(({ p, s, l, f, prog, pid }) => ({ p: p as string, s: s as string, l: l as string, f: f as string, prog: root ? `users:(("${prog}",pid=${pid},fd=3))` : '', np: root ? `${pid}/${prog}` : '-' }));
  b.ss = (w, a, _i, root) => {
    const f = a.join(''); const tcp = !/[tu]/.test(f) || f.includes('t'); const udp = !/[tu]/.test(f) || f.includes('u');
    const nurListen = f.includes('l'); const alle = f.includes('a');
    const z = sockets(w, (root || w.root) && f.includes('p'), alle || !nurListen).filter((x) => ((x.p === 'tcp' && tcp) || (x.p === 'udp' && udp)) && (nurListen ? x.s !== 'ESTAB' : alle || x.s === 'ESTAB'));
    return ok(`Netid State  Recv-Q Send-Q Local Address:Port  Peer Address:Port Process\n${z.map((x) => `${x.p.padEnd(5)} ${x.s.padEnd(6)} 0      ${x.s === 'LISTEN' ? '128' : '0'}    ${x.l.padEnd(19)} ${x.f.padEnd(17)} ${x.prog}`).join('\n')}`);
  };
  b.netstat = (w, a, _i, root) => {
    const f = a.join('');
    if (f.includes('r')) return ok(routeTabelle(w));
    if (f.includes('i')) return ok('Kernel-Schnittstellentabelle\nIface             MTU    RX-OK RX-ERR RX-DRP RX-OVR    TX-OK TX-ERR TX-DRP TX-OVR Flg\nenp0s31f6        1500   182344      0      0 0         98211      0      0      0 BMRU\nlo              65536     4120      0      0 0          4120      0      0      0 LRU');
    const nurListen = f.includes('l'); const z = sockets(w, (root || w.root) && f.includes('p'), true).filter((x) => (nurListen ? x.s !== 'ESTAB' : x.s === 'ESTAB' || f.includes('a')) && (!/[tu]/.test(f) || f.includes(x.p[0])));
    return ok(`Aktive Internetverbindungen ${nurListen ? '(Nur Server)' : '(ohne Server)'}\nProto Recv-Q Send-Q Local Address           Foreign Address         State       PID/Program name    \n${z.map((x) => `${x.p.padEnd(6)}0      0 ${x.l.replace('[::]', ':::').padEnd(24)}${x.f.replace('[::]:*', ':::*').padEnd(24)}${(x.s === 'UNCONN' ? '' : x.s === 'ESTAB' ? 'VERBUNDEN' : 'LISTEN').padEnd(12)}${x.np}`).join('\n')}`);
  };

  // --- Erreichbarkeit ---
  const pingKern = (prog: string, sechs: boolean): B => (w, a, _i, root) => {
    const ci = a.findIndex((x) => /^-c\d*$/.test(x)); const n = ci >= 0 ? Number(a[ci].slice(2) || a[ci + 1] || 4) : 4; const ziel = a.filter((x, k) => !x.startsWith('-') && !(ci >= 0 && a[ci] === '-c' && k === ci + 1)).pop();
    if (!ziel) return fehler(`${prog}: usage error: Zieladresse benötigt`, 1);
    if (sechs || a.includes('-6')) {
      const h = HOSTS.find((x) => x.name === ziel || x.ip6 === ziel) ?? (ziel === 'localhost' || ziel === '::1' ? { ip6: '::1', name: 'localhost' } as Host : undefined);
      if (!h?.ip6) return fehler(`${prog}: ${ziel}: Name or service not known`, 2);
      const st = ns(w); if (!st.ifs.enp0s31f6.up || !st.route6) return fehler(`${prog}: connect: Network is unreachable`, 2);
      const z = Array.from({ length: n }, (_, k) => `64 bytes from ${h.name} (${h.ip6}): icmp_seq=${k + 1} ttl=57 time=${(15.1 + k * 0.3).toFixed(1)} ms`);
      return ok(`PING ${ziel} (${h.ip6}) 56 data bytes\n${z.join('\n')}\n\n--- ${ziel} ping statistics ---\n${n} Pakete übertragen, ${n} empfangen, 0% packet loss, Zeit ${(n - 1) * 1001}ms\nrtt min/avg/max/mdev = 15.100/15.550/16.000/0.300 ms`);
    }
    const r = aufloesen(w, ziel);
    if (!r.ip) return fehler(r.fehler === 'temporaer' ? `${prog}: ${ziel}: Temporary failure in name resolution` : `${prog}: ${ziel}: Name or service not known`, 2);
    const wg = weg(w, r.ip); const kopf = `PING ${ziel} (${r.ip}) 56(84) bytes of data.`;
    const lang = ci < 0 && !(root && false);
    if (wg.art === 'kein-netz') return fehler(`${prog}: connect: Network is unreachable`, 2);
    if (wg.art === 'nicht-da') return { out: `${kopf}\n${Array.from({ length: Math.min(n, 3) }, (_, k) => `From ${wg.von} icmp_seq=${k + 1} Destination Host Unreachable`).join('\n')}\n\n--- ${ziel} ping statistics ---\n${n} Pakete übertragen, 0 empfangen, +${Math.min(n, 3)} errors, 100% packet loss, Zeit ${(n - 1) * 1012}ms\n`, code: 1 };
    if (wg.art === 'still') return { out: `${kopf}\n\n--- ${ziel} ping statistics ---\n${n} Pakete übertragen, 0 empfangen, 100% packet loss, Zeit ${(n - 1) * 1024}ms\n`, code: 1 };
    const t = r.ip.startsWith('127.') ? 0.04 : wg.hops.length === 1 ? 0.5 : 14.2;
    const name = r.ip.startsWith('127.') ? 'localhost' : nameVon(r.ip);
    const z = Array.from({ length: n }, (_, k) => `64 bytes from ${name} (${r.ip}): icmp_seq=${k + 1} ttl=${wg.hops.length === 1 ? 64 : 64 - wg.hops.length} time=${(t + k * 0.1).toFixed(t < 1 ? 3 : 1)} ms`);
    const stat = `\n\n--- ${ziel} ping statistics ---\n${n} Pakete übertragen, ${n} empfangen, 0% packet loss, Zeit ${(n - 1) * 1001}ms\nrtt min/avg/max/mdev = ${t.toFixed(3)}/${(t + 0.15).toFixed(3)}/${(t + 0.3).toFixed(3)}/0.112 ms`;
    if (lang) return ok(`${kopf}\n${z.join('\n')}\n(ping läuft weiter, bis du Strg+C drückst. Mit -c 4 hört es nach vier Paketen von selbst auf.)${stat}`);
    return ok(`${kopf}\n${z.join('\n')}${stat}`);
  };
  b.ping = pingKern('ping', false); b.ping6 = pingKern('ping6', true);
  const spur = (prog: string, art: 'traceroute' | 'tracepath', sechs: boolean): B => (w, a) => {
    const ziel = a.filter((x) => !x.startsWith('-')).pop(); if (!ziel) return fehler(`Usage: ${prog} [OPTIONS] host`);
    if (sechs || a.includes('-6')) {
      const h = HOSTS.find((x) => x.name === ziel || x.ip6 === ziel); if (!h?.ip6) return fehler(`${ziel}: Name or service not known`, 2);
      return ok(art === 'traceroute' ? `traceroute to ${ziel} (${h.ip6}), 30 hops max, 80 byte packets\n 1  2001:db8:1::1 (2001:db8:1::1)  0.611 ms  0.582 ms  0.560 ms\n 2  2001:db8:ffff::1 (2001:db8:ffff::1)  9.214 ms  9.198 ms  9.240 ms\n 3  ${h.name} (${h.ip6})  15.102 ms  15.087 ms  15.311 ms` : ` 1?: [LOCALHOST]                        0.010ms pmtu 1500\n 1:  2001:db8:1::1                                         0.611ms \n 2:  2001:db8:ffff::1                                      9.214ms \n 3:  ${h.name}                                       15.102ms reached\n     Resume: pmtu 1500 hops 3 back 3 `);
    }
    const r = aufloesen(w, ziel); if (!r.ip) return fehler(`${ziel}: ${r.fehler === 'temporaer' ? 'Temporary failure in name resolution' : 'Name or service not known'}\nCannot handle "host" cmdline arg \`${ziel}' on position 1 (argc 1)`, 2);
    const wg = weg(w, r.ip);
    if (wg.art === 'kein-netz') return fehler(art === 'traceroute' ? 'connect: Network is unreachable' : `${prog}: ${ziel}: Network is unreachable`, 1);
    const hops = wg.art === 'nicht-da' ? [] : wg.hops; const fertig = wg.art === 'ok';
    const zeilen = hops.map((h, k) => ({ k: k + 1, n: h.startsWith('10') || h.startsWith('19') || h.startsWith('2') ? nameVon(h) : h, ip: h, t: (0.4 + k * 4.6).toFixed(3) }));
    if (art === 'traceroute') {
      const out = [`traceroute to ${ziel} (${r.ip}), 30 hops max, 60 byte packets`, ...zeilen.map((z) => ` ${z.k}  ${z.n} (${z.ip})  ${z.t} ms  ${z.t} ms  ${z.t} ms`)];
      if (wg.art === 'nicht-da') out.push(` 1  ${wg.von} (${wg.von})  3071.2 ms !H  3071.1 ms !H  3071.0 ms !H`);
      if (!fertig && wg.art !== 'nicht-da') { for (let k = zeilen.length + 1; k <= zeilen.length + 3; k++) out.push(` ${k}  * * *`); out.push(' …\n(Bis Hop 30 nur noch Sterne: Ab hier antwortet niemand mehr. Der Simulator kürzt ab.)'); }
      return { out: out.join('\n'), code: 0 };
    }
    const out = [' 1?: [LOCALHOST]                      pmtu 1500', ...zeilen.map((z) => ` ${z.k}:  ${z.n.padEnd(50)} ${z.t}ms ${z.k === zeilen.length && fertig ? 'reached' : ''}`)];
    if (!fertig) out.push(` ${zeilen.length + 1}:  no reply`, ` ${zeilen.length + 2}:  no reply`, '     Too many hops: pmtu 1500', `     Resume: pmtu 1500 `);
    else out.push(`     Resume: pmtu 1500 hops ${zeilen.length} back ${zeilen.length} `);
    return { out: out.join('\n'), code: 0 };
  };
  b.traceroute = spur('traceroute', 'traceroute', false); b.traceroute6 = spur('traceroute6', 'traceroute', true);
  b.tracepath = spur('tracepath', 'tracepath', false); b.tracepath6 = spur('tracepath6', 'tracepath', true);
  b.nc = (w, a) => {
    const zv = a.some((x) => /^-\w*z/.test(x)); const lauschen = a.some((x) => /^-\w*l/.test(x));
    const frei = a.filter((x, k) => !x.startsWith('-') && a[k - 1] !== '-p' && a[k - 1] !== '-w');
    if (lauschen) { (w as Welt & { langlaeufer: string | null }).langlaeufer = 'nc'; return ok(`(nc lauscht jetzt auf Port ${a[a.indexOf('-p') + 1] ?? frei[0]}. Strg+C beendet es.)`); }
    const [ziel, port] = frei; if (!ziel || !port) return fehler('usage: nc [-46CDdFhklNnrStUuvZz] [-I length] [-i interval] [-M ttl] … [destination] [port]');
    const dienst: Record<string, string> = { 22: 'ssh', 25: 'smtp', 53: 'domain', 80: 'http', 443: 'https', 465: 'submissions', 514: 'syslog', 631: 'ipp', 993: 'imaps', 995: 'pop3s', 9100: 'jetdirect' };
    const r = aufloesen(w, ziel); if (!r.ip) return fehler(`nc: getaddrinfo for host "${ziel}" port ${port}: ${r.fehler === 'temporaer' ? 'Temporary failure in name resolution' : 'Name or service not known'}`);
    const wg = weg(w, r.ip); const t = `${ziel}${ziel === r.ip ? '' : ` (${r.ip})`} port ${port} (tcp)`;
    if (wg.art === 'kein-netz') return fehler(`nc: connect to ${t} failed: Network is unreachable`);
    if (wg.art === 'nicht-da') return fehler(`nc: connect to ${t} failed: No route to host`);
    if (wg.art === 'still') return fehler(`nc: connect to ${t} failed: Connection timed out`);
    const offen = r.ip.startsWith('127.') || eigeneIps(ns(w)).includes(r.ip) ? lokalOffen(w, r.ip, Number(port)) : HOSTS.find((h) => h.ip === r.ip)?.ports.includes(Number(port));
    if (!offen) return fehler(`nc: connect to ${t} failed: Connection refused`);
    return zv ? { out: '', err: `Connection to ${ziel}${ziel === r.ip ? '' : ` (${r.ip})`} ${port} port [tcp/${dienst[port] ?? '*'}] succeeded!`, code: 0 } : ok(`(Verbunden mit ${ziel} Port ${port}. Im Simulator endet die Verbindung sofort. Mit -zv prüfst du nur, ob der Port offen ist.)`);
  };
  b.netcat = b.nc;

  // --- Rechnername ---
  b.hostname = (w, a, _i, root) => {
    const st = ns(w);
    if (a.includes('-I') || a.includes('--all-ip-addresses')) return ok(Object.entries(st.ifs).filter(([n, i]) => n !== 'lo' && i.up).flatMap(([, i]) => [...i.addr, ...i.addr6.filter((x) => !x.startsWith('fe80'))].map((x) => x.split('/')[0])).join(' ') + ' ');
    if (a.includes('-i')) return ok('127.0.1.1');
    if (a.includes('-f') || a.includes('--fqdn')) { const z = (w.fs['/etc/hosts'] ?? '').split('\n').find((l) => l.split(/\s+/).includes(w.host)); const n = z?.split(/\s+/).slice(1).find((x) => x.includes('.')); return ok(n ?? w.host); }
    if (a.includes('-d') || a.includes('--domain')) return ok('');
    const neu = a.find((x) => !x.startsWith('-'));
    if (neu) { if (!(root || w.root)) return fehler('hostname: Sie müssen root sein, um den Rechnernamen zu ändern'); w.host = neu; return ok(); }
    return ok(w.host);
  };
  b.hostnamectl = (w, a, _i, root) => {
    const cmd = a.find((x) => !x.startsWith('-'));
    if (cmd === 'set-hostname' || cmd === 'hostname' && a.length > 1) {
      const n = a[a.indexOf(cmd) + 1]; if (!n) return ok(w.host);
      if (!(root || w.root)) return fehler('Could not set static hostname: Interactive authentication required.');
      w.host = n; w.fs['/etc/hostname'] = n + '\n'; return ok();
    }
    return ok(` Static hostname: ${(w.fs['/etc/hostname'] ?? w.host).trim()}\n${(w.fs['/etc/hostname'] ?? '').trim() !== w.host ? `Transient hostname: ${w.host}\n` : ''}       Icon name: computer-desktop\n         Chassis: desktop 🖥️\n      Machine ID: 6b1d2c3e4f5a4b6c8d7e9f0a1b2c3d4e\n         Boot ID: 4c2d8b1e7f9a4b03b5e2c1d6a8f7e9b0\nOperating System: Debian GNU/Linux 12 (bookworm)\n          Kernel: Linux 6.1.0-27-amd64\n    Architecture: x86-64\n Hardware Vendor: Fujitsu\n  Hardware Model: ESPRIMO P558\nFirmware Version: V5.0.0.13 R1.24.0 for D3511-A1x`);
  };

  // --- NetworkManager ---
  b.nmcli = (w, a) => {
    const st = ns(w);
    const t = a.filter((x) => !['-p', '-t', '--pretty', '--terse'].includes(x));
    const [obj = 'general', cmd, ...rest] = t;
    const tabelle = (kopf: string[], zeilen: string[][]) => { const br = kopf.map((k, i) => Math.max(k.length, ...zeilen.map((z) => (z[i] ?? '').length)) + 2); return [kopf, ...zeilen].map((z) => z.map((x, i) => x.padEnd(br[i])).join('')).join('\n'); };
    if (/^g(e(n(e(r(al?)?)?)?)?)?$/.test(obj)) return ok(tabelle(['STATE', 'CONNECTIVITY', 'WIFI-HW', 'WIFI', 'WWAN-HW', 'WWAN'], [[Object.keys(st.aktiv).length ? 'verbunden' : 'nicht verbunden', Object.keys(st.aktiv).length && st.routes.some((r) => r.ziel === 'default') ? 'vollständig' : 'keine', 'aktiviert', st.wlan ? 'aktiviert' : 'deaktiviert', 'fehlt', 'aktiviert']]));
    if (/^r(a(d(io?)?)?)?$/.test(obj)) { if (cmd === 'wifi' && rest[0]) { st.wlan = rest[0] === 'on'; if (!st.wlan) { st.ifs.wlp2s0.kabel = false; delete st.aktiv.wlp2s0; adrWeg(st, 'wlp2s0'); st.routes = st.routes.filter((r) => r.dev !== 'wlp2s0'); } return ok(); } return ok(`WIFI-HW   WIFI      WWAN-HW  WWAN      \naktiviert  ${st.wlan ? 'aktiviert ' : 'deaktiviert'}  fehlt   aktiviert`); }
    if (/^d(e(v(i(ce?)?)?)?)?$/.test(obj)) {
      if (!cmd || cmd === 'status') return ok(tabelle(['DEVICE', 'TYPE', 'STATE', 'CONNECTION'], Object.entries(st.ifs).map(([n, i]) => [n, i.typ, n === 'lo' ? 'nicht verwaltet' : st.aktiv[n] ? 'verbunden' : i.typ === 'wifi' && !st.wlan ? 'nicht verfügbar' : 'nicht verbunden', st.aktiv[n] ?? '--'])));
      if (cmd === 'show') return ok(Object.entries(st.ifs).filter(([n]) => !rest[0] || n === rest[0]).map(([n, i]) => `GENERAL.DEVICE:                         ${n}\nGENERAL.TYPE:                           ${i.typ}\nGENERAL.HWADDR:                         ${i.mac.toUpperCase()}\nGENERAL.STATE:                          ${st.aktiv[n] ? '100 (verbunden)' : '30 (nicht verbunden)'}\nGENERAL.CONNECTION:                     ${st.aktiv[n] ?? '--'}\n${i.addr.map((x, k) => `IP4.ADDRESS[${k + 1}]:                         ${x}`).join('\n')}\nIP4.GATEWAY:                            ${st.routes.find((r) => r.dev === n && r.ziel === 'default')?.via ?? '--'}\n${dnsServer(w).map((d, k) => `IP4.DNS[${k + 1}]:                             ${d}`).join('\n')}`).join('\n\n'));
      if (cmd === 'disconnect') { const d = rest[0]; if (!st.ifs[d]) return fehler(`Error: Device '${d}' not found.`, 10); delete st.aktiv[d]; adrWeg(st, d); st.routes = st.routes.filter((r) => r.dev !== d); return ok(`Gerät »${d}« wurde erfolgreich getrennt.`); }
      if (cmd === 'wifi') {
        const sub = rest[0] ?? 'list';
        if (!st.wlan) return fehler('Error: Wi-Fi is disabled.');
        if (sub === 'list') return ok(`IN-USE  BSSID              SSID          MODE   CHAN  RATE        SIGNAL  BARS  SECURITY  \n${st.aktiv.wlp2s0 === 'Labor-WLAN' ? '*' : ' '}       9C:C9:EB:12:34:58  Labor-WLAN    Infra  36    270 Mbit/s  78      ▂▄▆_  WPA2      \n        9C:C9:EB:12:34:59  Gast-WLAN     Infra  6     130 Mbit/s  64      ▂▄▆_  WPA2      \n        3A:10:D5:7E:21:09  FRITZ!Box 7590  Infra  11    195 Mbit/s  31      ▂▄__  WPA2 WPA3 `);
        if (sub === 'connect') {
          const ssid = rest[1]; const pi = rest.indexOf('password'); const pw = pi >= 0 ? rest[pi + 1] : undefined;
          if (!['Labor-WLAN', 'Gast-WLAN'].includes(ssid ?? '')) return fehler(`Error: No network with SSID '${ssid ?? ''}' found.`, 10);
          if (pw !== (ssid === 'Labor-WLAN' ? 'Werkstatt2026' : 'Gast-1234')) return fehler('Error: Connection activation failed: Secrets were required, but not provided.', 4);
          st.profile[ssid!] = { typ: 'wifi', ifname: 'wlp2s0', method: 'auto', addresses: [], dns: [], autoconnect: true, ssid, psk: pw, uuid: '7c3e9a12-5b4d-4f6e-9a8b-1c2d3e4f5a6b' };
          const f = profilAnwenden(w, ssid!); if (f) return fehler(f);
          return ok(`Gerät »wlp2s0« wurde erfolgreich mit »${'7c3e9a12-5b4d-4f6e-9a8b-1c2d3e4f5a6b'}« aktiviert.`);
        }
      }
    }
    if (/^c(o(n(n(e(c(t(i(on?)?)?)?)?)?)?)?)?$/.test(obj)) {
      if (!cmd || cmd === 'show' && !rest.length) return ok(tabelle(['NAME', 'UUID', 'TYPE', 'DEVICE'], Object.entries(st.profile).map(([n, p]) => [n, p.uuid, p.typ, Object.entries(st.aktiv).find(([, v]) => v === n)?.[0] ?? '--'])));
      const name = rest[0]; const p = name ? st.profile[name] : undefined;
      if (cmd === 'show') { if (!p) return fehler(`Error: ${name} - no such connection profile.`, 10); return ok(`connection.id:                          ${name}\nconnection.uuid:                        ${p.uuid}\nconnection.type:                        ${p.typ === 'wifi' ? '802-11-wireless' : '802-3-ethernet'}\nconnection.interface-name:              ${p.ifname}\nconnection.autoconnect:                 ${p.autoconnect ? 'ja' : 'nein'}\nipv4.method:                            ${p.method}\nipv4.dns:                               ${p.dns.join(',') || '--'}\nipv4.addresses:                         ${p.addresses.join(', ') || '--'}\nipv4.gateway:                           ${p.gateway ?? '--'}\n${st.aktiv[p.ifname] === name ? st.ifs[p.ifname].addr.map((x, k) => `IP4.ADDRESS[${k + 1}]:                         ${x}`).join('\n') + `\nIP4.GATEWAY:                            ${st.routes.find((r) => r.dev === p.ifname && r.ziel === 'default')?.via ?? '--'}` : ''}`); }
      if (cmd === 'up') { const f = profilAnwenden(w, name ?? ''); return f ? fehler(f, 10) : ok('Verbindung wurde erfolgreich aktiviert (aktiver D-Bus-Pfad: /org/freedesktop/NetworkManager/ActiveConnection/7)'); }
      if (cmd === 'down') { if (!p) return fehler(`Error: '${name}' is not an active connection.\nError: no active connection provided.`, 10); delete st.aktiv[p.ifname]; adrWeg(st, p.ifname); st.routes = st.routes.filter((r) => r.dev !== p.ifname); return ok(`Verbindung »${name}« wurde erfolgreich deaktiviert (aktiver D-Bus-Pfad: /org/freedesktop/NetworkManager/ActiveConnection/7)`); }
      if (cmd === 'delete' || cmd === 'del') { if (!p) return fehler(`Error: unknown connection '${name}'.`, 10); if (st.aktiv[p.ifname] === name) b.nmcli(w, ['con', 'down', name], '', false); delete st.profile[name]; return ok(`Verbindung »${name}« (${p.uuid}) erfolgreich gelöscht.`); }
      const setzen = (q: Profil, args: string[]): string | null => {
        for (let k = 0; k < args.length; k += 2) {
          const key = args[k]; const v = args[k + 1] ?? ''; const plus = key.startsWith('+'); const kk = key.replace(/^[+-]/, '');
          if (kk === 'ipv4.method') { if (!['auto', 'manual', 'disabled'].includes(v)) return `Error: failed to modify ipv4.method: '${v}' not among [auto, link-local, manual, shared, disabled].`; q.method = v as Profil['method']; }
          else if (kk === 'ipv4.addresses' || kk === 'ip4') { const l = v.split(',').map((x) => x.trim()).filter(Boolean); for (const x of l) if (!/^\d+\.\d+\.\d+\.\d+\/\d+$/.test(x)) return `Error: failed to modify ipv4.addresses: invalid IP address: Invalid IPv4 address '${x}'.`; q.addresses = plus ? [...q.addresses, ...l] : l; }
          else if (kk === 'ipv4.gateway' || kk === 'gw4') q.gateway = v || undefined;
          else if (kk === 'ipv4.dns') { const l = v.split(/[ ,]+/).filter(Boolean); q.dns = plus ? [...q.dns, ...l] : l; }
          else if (kk === 'connection.autoconnect' || kk === 'autoconnect') q.autoconnect = /^(yes|ja|true|1)$/.test(v);
          else if (kk === 'ifname' || kk === 'connection.interface-name') q.ifname = v;
          else if (kk === 'con-name' || kk === 'type') continue;
          else return `Error: invalid or not allowed setting '${kk.split('.')[0]}': '${kk}' not among [connection, 802-3-ethernet, ipv4, ipv6, …].`;
        }
        if (q.method === 'manual' && !q.addresses.length) return 'Error: Failed to modify connection: ipv4.addresses: this property cannot be empty for \'method=manual\'';
        return null;
      };
      if (cmd === 'modify' || cmd === 'mod') { if (!p) return fehler(`Error: unknown connection '${name}'.`, 10); const kopie = { ...p, addresses: [...p.addresses], dns: [...p.dns] }; const f = setzen(kopie, rest.slice(1)); if (f) return fehler(f, 2); st.profile[name!] = kopie; return ok(); }
      if (cmd === 'add') {
        const args = t.slice(2); const get = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
        const typ = get('type'); const ifname = get('ifname'); const cn = get('con-name') ?? `${typ}-${ifname}`;
        if (typ !== 'ethernet' && typ !== 'wifi') return fehler(`Error: invalid connection type; '${typ ?? ''}' not among [ethernet, wifi, …].`, 2);
        if (!ifname) return fehler("Error: 'ifname' argument is required.", 2);
        const q: Profil = { typ, ifname, method: 'auto', addresses: [], dns: [], autoconnect: true, uuid: '3f2e1d0c-9b8a-4765-a4b3-c2d1e0f9a8b7' };
        const f = setzen(q, args.filter((x, k) => !['type', 'ifname', 'con-name'].includes(x) && !['type', 'ifname', 'con-name'].includes(args[k - 1]))); if (f) return fehler(f, 2);
        st.profile[cn] = q; return ok(`Verbindung »${cn}« (${q.uuid}) erfolgreich hinzugefügt.`);
      }
    }
    return fehler(`Error: argument '${cmd ?? obj}' not understood. Try passing --help instead.`, 2);
  };
  b.networkctl = () => ok('WARNING: systemd-networkd is not running, output will be incomplete.\n\nIDX LINK      TYPE     OPERATIONAL SETUP    \n  1 lo        loopback n/a         unmanaged\n  2 enp0s31f6 ether    n/a         unmanaged\n  3 wlp2s0    wlan     n/a         unmanaged\n\n3 links listed.');
  b.resolvectl = () => fehler('Failed to get global data: Unit dbus-org.freedesktop.resolve1.service not found.\n(systemd-resolved läuft auf werkstatt nicht. Die Nameserver stehen direkt in /etc/resolv.conf.)');
  const ifupdown = (auf: boolean): B => (w, a, _i, root) => {
    const st = ns(w); const d = a.find((x) => !x.startsWith('-'));
    if (!(root || w.root)) return fehler(`${auf ? 'ifup' : 'ifdown'}: failed to open lockfile /run/network/.ifstate.lock: Permission denied`);
    if (!d) return fehler(`Usage: ${auf ? 'ifup' : 'ifdown'} <options> <ifaces...>`);
    const text = w.fs['/etc/network/interfaces'] ?? '';
    const m = text.match(new RegExp(`^iface ${d} inet (\\w+)\\n((?:[ \\t]+.*\\n?)*)`, 'm'));
    if (!m) return fehler(`${auf ? 'ifup' : 'ifdown'}: unknown interface ${d}`);
    if (d === 'lo') return ok();
    if (!auf) { if (!st.ifupdown.includes(d)) return fehler(`ifdown: interface ${d} not configured`); st.ifupdown = st.ifupdown.filter((x) => x !== d); adrWeg(st, d); st.routes = st.routes.filter((r) => r.dev !== d); st.ifs[d].up = false; return ok(); }
    if (st.ifupdown.includes(d)) return fehler(`ifup: interface ${d} already configured`);
    delete st.aktiv[d]; adrWeg(st, d); st.routes = st.routes.filter((r) => r.dev !== d); st.ifs[d].up = true;
    if (m[1] === 'dhcp') adrHinzu(st, d, '192.168.1.23/24'), st.routes.unshift({ ziel: 'default', via: '192.168.1.1', dev: d, proto: 'dhcp' });
    else {
      const wert = (k: string) => m[2].match(new RegExp(`^\\s*${k}\\s+(\\S+)`, 'm'))?.[1];
      const adr = wert('address'); if (!adr) return fehler(`/etc/network/interfaces:${text.slice(0, text.indexOf(m[0])).split('\n').length}: option with empty value\nifup: couldn't read interfaces file "/etc/network/interfaces"`);
      const bits = adr.includes('/') ? '' : '/' + maskeBits(wert('netmask') ?? '255.255.255.0');
      adrHinzu(st, d, adr + bits);
      const gw = wert('gateway'); if (gw) st.routes.unshift({ ziel: 'default', via: gw, dev: d, proto: 'static', metric: 0 });
    }
    st.ifupdown.push(d); return ok();
  };
  b.ifup = ifupdown(true); b.ifdown = ifupdown(false);

  // --- DNS ---
  b.host = (w, a) => {
    const ti = a.indexOf('-t'); const typ0 = ti >= 0 ? a[ti + 1].toUpperCase() : undefined;
    const frei = a.filter((x, k) => !x.startsWith('-') && (ti < 0 || k !== ti + 1)); const [name, server] = frei;
    if (!name) return fehler('Usage: host [-aCdilrTvVw] [-c class] [-N ndots] [-t type] [-W time]\n            [-R number] [-m flag] [-p port] hostname [server]');
    const kopf = server ? `Using domain server:\nName: ${server}\nAddress: ${server}#53\nAliases: \n\n` : '';
    if (istIp(name)) { const r = frage(w, name.split('.').reverse().join('.') + '.in-addr.arpa', 'PTR', server); if ('fehler' in r) return fehler(`;; communications error to ${r.server}#53: timed out\n;; communications error to ${r.server}#53: timed out\n;; no servers could be reached`); return r.antwort.length ? ok(kopf + r.antwort.map((x) => `${x.split('\t')[0].replace(/\.$/, '')} domain name pointer ${x.split('\t').pop()}`).join('\n')) : fehler(`Host ${name.split('.').reverse().join('.')}.in-addr.arpa. not found: 3(NXDOMAIN)`); }
    const typen = typ0 ? [typ0] : ['A', 'AAAA', 'MX'];
    const voll = name.includes('.') ? name : `${name}.${suchdomains(w)[0] ?? ''}`.replace(/\.$/, '');
    const out: string[] = [];
    for (const t of typen) {
      const r = frage(w, voll, t, server);
      if ('fehler' in r) return fehler(`;; communications error to ${r.server}#53: timed out\n;; communications error to ${r.server}#53: timed out\n;; no servers could be reached`);
      if (r.status === 'NXDOMAIN') return fehler(`${kopf}Host ${name} not found: 3(NXDOMAIN)`);
      for (const x of r.antwort) { const f = x.split('\t'); const n = f[0].replace(/\.$/, ''); out.push(f[3] === 'A' ? `${n} has address ${f[4]}` : f[3] === 'AAAA' ? `${n} has IPv6 address ${f[4]}` : f[3] === 'MX' ? `${n} mail is handled by ${f[4]}` : f[3] === 'NS' ? `${n} name server ${f[4]}` : f[3] === 'CNAME' ? `${n} is an alias for ${f[4]}` : `${n} ${f[3]} ${f[4]}`); }
    }
    if (typ0 && !out.length) return ok(`${kopf}${voll} has no ${typ0} record`);
    return ok(kopf + [...new Set(out)].join('\n'));
  };
  b.dig = (w, a) => {
    const server = a.find((x) => x.startsWith('@'))?.slice(1);
    const kurz = a.includes('+short'); const xi = a.indexOf('-x');
    const frei = a.filter((x, k) => !x.startsWith('@') && !x.startsWith('+') && !x.startsWith('-') && (xi < 0 || k !== xi + 1));
    let name = frei[0] ?? '.'; let typ = (frei.find((x) => /^(A|AAAA|MX|NS|CNAME|PTR|SOA|TXT|ANY)$/i.test(x)) ?? 'A').toUpperCase();
    if (frei[0] && /^(A|AAAA|MX|NS|CNAME|PTR|SOA|TXT|ANY)$/i.test(frei[0])) name = frei[1] ?? '.';
    if (xi >= 0) { name = a[xi + 1].split('.').reverse().join('.') + '.in-addr.arpa'; typ = 'PTR'; }
    const r = frage(w, name, typ, server);
    if ('fehler' in r) return { out: `;; communications error to ${r.server}#53: timed out\n;; communications error to ${r.server}#53: timed out\n;; communications error to ${r.server}#53: timed out\n\n; <<>> DiG 9.18.28-1~deb12u2-Debian <<>> ${a.join(' ')}\n;; global options: +cmd\n;; no servers could be reached`, code: 9 };
    if (kurz) return ok(r.antwort.map((x) => x.split('\t').pop()).join('\n'));
    const fq = name.replace(/\.?$/, '.');
    return ok(`\n; <<>> DiG 9.18.28-1~deb12u2-Debian <<>> ${a.join(' ')}\n;; global options: +cmd\n;; Got answer:\n;; ->>HEADER<<- opcode: QUERY, status: ${r.status}, id: 41235\n;; flags: qr rd ra; QUERY: 1, ANSWER: ${r.antwort.length}, AUTHORITY: ${r.status === 'NXDOMAIN' ? 1 : 0}, ADDITIONAL: 1\n\n;; OPT PSEUDOSECTION:\n; EDNS: version: 0, flags:; udp: 1232\n;; QUESTION SECTION:\n;${fq}\t\t\tIN\t${typ}\n${r.antwort.length ? `\n;; ANSWER SECTION:\n${r.antwort.join('\n')}\n` : r.status === 'NXDOMAIN' ? `\n;; AUTHORITY SECTION:\nexample.org.\t\t900\tIN\tSOA\tns1.example.org. hostmaster.example.org. 2026112301 7200 3600 1209600 900\n` : ''}\n;; Query time: 12 msec\n;; SERVER: ${r.server}#53(${r.server}) (UDP)\n;; WHEN: ${K.datum({ ...w, env: { ...w.env, LANG: 'C' } } as Welt, w.uhr)}\n;; MSG SIZE  rcvd: ${48 + r.antwort.length * 16}`);
  };
  b.nslookup = (w, a) => {
    const [name, server] = a.filter((x) => !x.startsWith('-'));
    const srv = server ?? dnsServer(w)[0] ?? '127.0.0.1';
    const r = frage(w, name ?? '', 'A', server);
    if ('fehler' in r) return fehler(';; connection timed out; no servers could be reached');
    if (r.status === 'NXDOMAIN') return { out: `Server:\t\t${srv}\nAddress:\t${srv}#53\n\n** server can't find ${name}: NXDOMAIN`, code: 1 };
    return ok(`Server:\t\t${srv}\nAddress:\t${srv}#53\n\nNon-authoritative answer:\n${r.antwort.map((x) => `Name:\t${x.split('\t')[0].replace(/\.$/, '')}\nAddress: ${x.split('\t').pop()}`).join('\n')}`);
  };
  b.getent = (w, a, i, root) => {
    if (a[0] !== 'hosts' && a[0] !== 'ahosts') return alt.getent(w, a, i, root);
    const name = a[1]; if (!name) return alt.getent(w, ['hosts'], i, root);
    const r = aufloesen(w, name); if (!r.ip) return { out: '', code: 2 };
    if (a[0] === 'ahosts') return ok(`${r.ip}       STREAM ${name}\n${r.ip}       DGRAM  \n${r.ip}       RAW    `);
    return ok(`${r.ip.padEnd(15)} ${name}`);
  };
  return b;
}

export function zustandNetz(w: Welt, s: string): boolean | undefined {
  const st = ns(w); let m;
  if ((m = s.match(/^addr:(\w+)=(\S+)$/))) return !!st.ifs[m[1]]?.addr.includes(m[2]);
  if ((m = s.match(/^keinaddr:(\w+)=(\S+)$/))) return !st.ifs[m[1]]?.addr.includes(m[2]);
  if ((m = s.match(/^link:(\w+)=(up|down)$/))) return !!st.ifs[m[1]] && st.ifs[m[1]].up === (m[2] === 'up');
  if ((m = s.match(/^route:(\S+)=(\S+)$/))) return st.routes.some((r) => (r.ziel === m![1] || (m![1] !== 'default' && r.ziel === netzVon(m![1]))) && (m![2] === '*' || r.via === m![2]) && st.ifs[r.dev]?.up);
  if ((m = s.match(/^erreichbar:(\S+)$/))) { const r = aufloesen(w, m[1]); return !!r.ip && weg(w, r.ip).art === 'ok'; }
  if ((m = s.match(/^aufloesbar:(\S+)$/))) return !!aufloesen(w, m[1]).ip;
  if ((m = s.match(/^aufloesung:(\S+)=(\S+)$/))) return aufloesen(w, m[1]).ip === m[2];
  if ((m = s.match(/^nm:aktiv=(.+)$/))) return Object.values(st.aktiv).includes(m[1]);
  if ((m = s.match(/^nm:(.+?)~(\S+)=(.*)$/))) { const p = st.profile[m[1]] as unknown as Record<string, unknown> | undefined; if (!p) return false; const v = p[m[2]]; return new RegExp(m[3]).test(Array.isArray(v) ? v.join(',') : String(v ?? '')); }
  if ((m = s.match(/^hostname=(\S+)$/))) return w.host === m[1];
  if (s === 'wlan:aus') return !st.wlan;
  if ((m = s.match(/^ifup:(\w+)$/))) return st.ifupdown.includes(m[1]);
  return undefined;
}
