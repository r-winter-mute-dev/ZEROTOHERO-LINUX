// Netzwerk für Fortgeschrittene (LPIC-2 Topic 205): virtuelle Schnittstellen (VLAN, veth, dummy), MTU,
// Adressen mit Labels, die Nachbartabelle mit ip neigh und arp, WLAN mit rfkill, iw, iwconfig, iwlist,
// wpa_supplicant und dhclient, eine zweite Netzwerkkarte, tcpdump, mtr und ifcfg-Dateien von Red Hat.
// Ohne Welt-Option `netzwerk` bleibt alles wie bisher.
import type { Welt } from './shell';
import { meta } from './shell-dateien';
import { ns, adrHinzu, adrWeg, netzVon, imNetz, istIp, routeFuer, weg, aufloesen, wegPruefer, ifLan, HOSTS, nameVon, alleExtraSockets, netzExtraSockets, maskeBits, type If, type Sock } from './shell-netz';

type Ergebnis = { out: string; err?: string; code: number };
type B = (w: Welt, a: string[], stdin: string, root: boolean) => Ergebnis;
const ok = (out = ''): Ergebnis => ({ out, code: 0 });
const fehler = (err: string, code = 1): Ergebnis => ({ out: '', err, code });

export interface NetzwerkOptionen {
  zweiteKarte?: boolean;              // enp3s0 hängt am Labornetz 10.20.0.0/16, ist aber nicht eingerichtet
  wlan?: 'blockiert' | 'frei';        // blockiert: rfkill soft block, NetworkManager verwaltet wlp2s0 nicht
  arpFalsch?: boolean;                // fester ARP-Eintrag für den ausgetauschten Drucker, auch in /etc/ethers
  geheim?: boolean;                   // ein Prozess schickt Daten nach 203.0.113.66:4444
  nmDns?: boolean;                    // NetworkManager-Profil mit falschem DNS-Server, überschreibt resolv.conf
  interfacesFehler?: boolean;         // Tippfehler in /etc/network/interfaces (Stanza für enp3s0)
  hostsDeny?: boolean;                // sshd: ALL in /etc/hosts.deny, ohne Ausnahme
  ifcfg?: 'gut' | 'gatewayFalsch';    // Red Hat: /etc/sysconfig/network-scripts/ifcfg-enp0s31f6
}
interface Nachbar { ip: string; dev: string; mac?: string; nud: 'REACHABLE' | 'STALE' | 'PERMANENT' | 'FAILED' | 'INCOMPLETE'; router?: boolean }
interface NwStand {
  opt: NetzwerkOptionen;
  neigh: Nachbar[];
  rfkill: { wlanSoft: boolean; btSoft: boolean };
  wpa: { laeuft: boolean; datei: string; ssid: string | null };
  dhcp: Record<string, boolean>;
  geheimPid: number;
}
type NW = Welt & { netzwerk?: NwStand };
const nw = (w: Welt) => (w as NW).netzwerk!;
export const netzwerkAktiv = (w: Welt) => !!(w as NW).netzwerk;

export const MAC: Record<string, string> = {
  '192.168.1.1': '9c:c9:eb:12:34:56', '192.168.1.254': '9c:c9:eb:12:34:60', '192.168.1.24': '52:54:00:3a:11:24', '192.168.1.40': '00:1f:29:aa:bb:cc',
  '192.168.1.17': '3c:7c:3f:aa:01:17', '192.168.2.1': '9c:c9:eb:12:34:58', '10.20.0.5': '52:54:00:10:20:05', '10.20.0.1': '52:54:00:10:20:01',
};
const DRUCKER_NEU = '00:1f:29:dd:ee:01';
const echteMac = (w: Welt, ip: string) => (ip === '192.168.1.40' && nw(w).opt.arpFalsch ? DRUCKER_NEU : MAC[ip]);

interface Wlan { ssid: string; bssid: string; freq: number; kanal: number; signal: number; pass: string | null }
const WLANS: Wlan[] = [
  { ssid: 'Labor-WLAN', bssid: '9c:c9:eb:12:34:58', freq: 5180, kanal: 36, signal: -52, pass: 'Werkstatt2026' },
  { ssid: 'Gast-WLAN', bssid: '9c:c9:eb:12:34:59', freq: 2437, kanal: 6, signal: -61, pass: 'Gast-1234' },
  { ssid: 'Nachbar-5G', bssid: '64:66:b3:01:02:03', freq: 5500, kanal: 100, signal: -84, pass: null },
];

// ---------- PBKDF2-HMAC-SHA1, wie wpa_passphrase den PSK berechnet ----------
function sha1(m: Uint8Array): Uint8Array {
  const l = m.length; const n = ((l + 9 + 63) >> 6) << 6; const b = new Uint8Array(n); b.set(m); b[l] = 0x80;
  const dv = new DataView(b.buffer); dv.setUint32(n - 4, l * 8); dv.setUint32(n - 8, Math.floor(l / 0x20000000));
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0; const W = new Uint32Array(80);
  for (let o = 0; o < n; o += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 80; i++) { const x = W[i - 3] ^ W[i - 8] ^ W[i - 14] ^ W[i - 16]; W[i] = (x << 1) | (x >>> 31); }
    let a = h0, bb = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      const f = i < 20 ? (bb & c) | (~bb & d) : i < 40 ? bb ^ c ^ d : i < 60 ? (bb & c) | (bb & d) | (c & d) : bb ^ c ^ d;
      const k = i < 20 ? 0x5a827999 : i < 40 ? 0x6ed9eba1 : i < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const t = (((a << 5) | (a >>> 27)) + f + e + k + W[i]) >>> 0; e = d; d = c; c = (bb << 30) | (bb >>> 2); bb = a; a = t;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + bb) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  const r = new Uint8Array(20); const rv = new DataView(r.buffer); [h0, h1, h2, h3, h4].forEach((x, i) => rv.setUint32(i * 4, x)); return r;
}
function hmac(k: Uint8Array, m: Uint8Array): Uint8Array {
  const key = new Uint8Array(64); key.set(k.length > 64 ? sha1(k) : k);
  const i = new Uint8Array(64 + m.length); const o = new Uint8Array(84);
  for (let j = 0; j < 64; j++) { i[j] = key[j] ^ 0x36; o[j] = key[j] ^ 0x5c; }
  i.set(m, 64); o.set(sha1(i), 64); return sha1(o);
}
const utf8 = (s: string) => new TextEncoder().encode(s);
export function wpaPsk(pass: string, ssid: string): string {
  const p = utf8(pass); const s = utf8(ssid); let out = '';
  for (let blk = 1; out.length < 64; blk++) {
    const salt = new Uint8Array(s.length + 4); salt.set(s); new DataView(salt.buffer).setUint32(s.length, blk);
    let u = hmac(p, salt); const t = u.slice();
    for (let i = 1; i < 4096; i++) { u = hmac(p, u); for (let j = 0; j < 20; j++) t[j] ^= u[j]; }
    out += Array.from(t, (x) => x.toString(16).padStart(2, '0')).join('');
  }
  return out.slice(0, 64);
}

// ---------- Start ----------
function datei(w: Welt, p: string, c: string, mode = 0o644) {
  const t = p.split('/').filter(Boolean); for (let i = 1; i < t.length; i++) { const d = '/' + t.slice(0, i).join('/'); if (!(d in w.fs)) { w.fs[d] = null; meta(w, d).mode = 0o755; } }
  w.fs[p] = c; const m = meta(w, p); m.mode = mode; m.owner = 'root'; m.group = 'root';
}
const PROG_SBIN = ['arp', 'iw', 'rfkill', 'wpa_supplicant', 'wpa_cli', 'dhclient'];
const PROG_BIN = ['wpa_passphrase', 'mtr'];
export function netzwerkStarten(w: Welt, o: NetzwerkOptionen) {
  const st = ns(w);
  const s: NwStand = { opt: o, neigh: [{ ip: '192.168.1.1', dev: 'enp0s31f6', mac: MAC['192.168.1.1'], nud: 'REACHABLE', router: true }, { ip: '192.168.1.40', dev: 'enp0s31f6', mac: MAC['192.168.1.40'], nud: o.arpFalsch ? 'PERMANENT' : 'STALE' }], rfkill: { wlanSoft: o.wlan === 'blockiert', btSoft: false }, wpa: { laeuft: false, datei: '', ssid: null }, dhcp: {}, geheimPid: 2777 };
  (w as NW).netzwerk = s;
  for (const x of PROG_SBIN) datei(w, '/usr/sbin/' + x, '\u0007BIN:' + (30000 + x.length * 811), 0o755);
  for (const x of PROG_BIN) datei(w, '/usr/bin/' + x, '\u0007BIN:' + (30000 + x.length * 811), 0o755);
  if (w.pakete) for (const p of ['iw', 'rfkill', 'wpasupplicant', 'isc-dhcp-client', 'mtr-tiny', 'net-tools']) w.pakete.installiert[p] = 'ii';
  if (!w.fs['/etc/wpa_supplicant']) { w.fs['/etc/wpa_supplicant'] = null; meta(w, '/etc/wpa_supplicant').mode = 0o755; }
  if (o.wlan) { const i = st.ifs.wlp2s0; i.up = false; i.kabel = false; delete st.aktiv.wlp2s0; w.fs['/etc/NetworkManager/conf.d/99-wlan-unmanaged.conf'] = '[keyfile]\nunmanaged-devices=interface-name:wlp2s0\n'; }
  if (o.zweiteKarte) {
    st.ifs.enp3s0 = { mac: '00:1b:21:3a:4f:10', up: false, addr: [], addr6: [], typ: 'ethernet', kabel: true, lan: '10.20.0.0/16' };
    w.fs['/etc/network/interfaces'] = (w.fs['/etc/network/interfaces'] ?? '') + (o.interfacesFehler ? '\n# Labornetz, zweite Karte\nauto enp3s0\niface enp3s0 inet static\n    adress 10.20.0.23/16\n' : '');
  }
  if (o.arpFalsch) datei(w, '/etc/ethers', '# Feste Zuordnung für den Laserdrucker, damit niemand seine Adresse übernimmt (2019)\n00:1f:29:aa:bb:cc 192.168.1.40\n');
  if (o.geheim) {
    w.prozesse.push({ pid: s.geheimPid, user: 'lena', cmd: '/home/lena/.cache/.sync/updater --quiet', ppid: 1, ni: 0, tty: '?', stat: 'Sl', start: '07:58', cpu: 0.4, mem: 0.3 });
    datei(w, '/home/lena/.cache/.sync/updater', '\u0007BIN:844211', 0o755); meta(w, '/home/lena/.cache/.sync/updater').owner = 'lena';
    datei(w, `/proc/${s.geheimPid}/cmdline`, '/home/lena/.cache/.sync/updater\u0000--quiet\u0000', 0o444); w.fs[`/proc/${s.geheimPid}/exe`] = '-> /home/lena/.cache/.sync/updater'; meta(w, `/proc/${s.geheimPid}/exe`).mode = 0o777;
    datei(w, '/home/lena/.config/autostart/updater.desktop', '[Desktop Entry]\nType=Application\nName=Updater\nExec=/home/lena/.cache/.sync/updater --quiet\nHidden=false\n'); meta(w, '/home/lena/.config/autostart/updater.desktop').owner = 'lena';
  }
  if (o.nmDns) { const p = st.profile['Kabelgebundene Verbindung 1']; p.dns = ['192.168.1.9']; w.fs['/etc/resolv.conf'] = '# Generated by NetworkManager\nsearch lab.example.org\nnameserver 192.168.1.9\n'; }
  if (o.hostsDeny) { w.fs['/etc/hosts.deny'] = (w.fs['/etc/hosts.deny'] ?? '') + '\n# Nach dem Vorfall im März\nsshd: ALL\n'; }
  if (o.ifcfg) {
    const gw = o.ifcfg === 'gatewayFalsch' ? '192.168.1.11' : '192.168.1.1';
    datei(w, '/etc/sysconfig/network-scripts/ifcfg-enp0s31f6', `TYPE=Ethernet\nBOOTPROTO=none\nNAME=enp0s31f6\nDEVICE=enp0s31f6\nONBOOT=yes\nIPADDR=192.168.1.23\nPREFIX=24\nGATEWAY=${gw}\nDNS1=192.168.1.1\nDOMAIN=lab.example.org\n`);
    ifcfgLaden(w);
    const p = st.profile['System enp0s31f6'];
    if (p) { st.aktiv.enp0s31f6 = 'System enp0s31f6'; delete st.profile['Kabelgebundene Verbindung 1']; st.routes = st.routes.filter((r) => r.ziel !== 'default'); st.routes.unshift({ ziel: 'default', via: gw, dev: 'enp0s31f6', proto: 'static', metric: 100, src: '192.168.1.23' }); }
  }
}
/** Liest ifcfg-Dateien wie das ifcfg-rh-Plugin von NetworkManager. */
function ifcfgLaden(w: Welt): string[] {
  const st = ns(w); const namen: string[] = [];
  for (const p of Object.keys(w.fs).filter((x) => /^\/etc\/sysconfig\/network-scripts\/ifcfg-[\w.-]+$/.test(x) && !x.endsWith('ifcfg-lo'))) {
    const t = w.fs[p] ?? ''; const v = (k: string) => t.match(new RegExp(`^${k}=["']?([^"'\\n]*)["']?$`, 'm'))?.[1];
    const dev = v('DEVICE') ?? p.split('ifcfg-')[1]; const name = `System ${v('NAME') ?? dev}`;
    const proto = (v('BOOTPROTO') ?? 'none').toLowerCase();
    const pre = v('PREFIX') ?? (v('NETMASK') ? String(maskeBits(v('NETMASK')!)) : '24');
    st.profile[name] = { typ: 'ethernet', ifname: dev, method: proto === 'dhcp' ? 'auto' : 'manual', addresses: v('IPADDR') ? [`${v('IPADDR')}/${pre}`] : [], gateway: v('GATEWAY'), dns: ['DNS1', 'DNS2'].map(v).filter(Boolean) as string[], autoconnect: (v('ONBOOT') ?? 'yes') === 'yes', uuid: '5fb06bd0-0bb0-7ffb-45f1-d6edd65f3e03' };
    namen.push(name);
  }
  return namen;
}

// ---------- ARP auf dem Weg ----------
wegPruefer.push((w, ip, r, naechster) => {
  if (!netzwerkAktiv(w)) return null;
  const s = nw(w); const st = ns(w);
  const lan = ifLan(r.dev, st.ifs[r.dev]); if (!lan || !imNetz(naechster, lan)) return null;
  const e = s.neigh.find((x) => x.ip === naechster && x.dev === r.dev);
  const da = HOSTS.some((h) => h.ip === naechster && h.lan === lan) || (naechster === '192.168.1.17' && lan === '192.168.1.0/24');
  const mac = echteMac(w, naechster);
  if (e?.nud === 'PERMANENT' && e.mac !== mac) return { art: 'still', hops: [] };
  if (!e) s.neigh.push(da ? { ip: naechster, dev: r.dev, mac, nud: 'REACHABLE' } : { ip: naechster, dev: r.dev, nud: 'FAILED' });
  else if (e.nud !== 'PERMANENT') { if (da) { e.mac = mac; e.nud = 'REACHABLE'; } else e.nud = 'FAILED'; }
  return null;
});

// ---------- verdeckte Verbindung ----------
const geheimLebt = (w: Welt) => netzwerkAktiv(w) && !!nw(w).opt.geheim && w.prozesse.some((p) => p.pid === nw(w).geheimPid && !p.weg);
netzExtraSockets((w): Sock[] => (geheimLebt(w) && ns(w).ifs.enp0s31f6.up ? [{ p: 'tcp', s: 'ESTAB', l: '192.168.1.23:50644', f: '203.0.113.66:4444', prog: 'updater', pid: nw(w).geheimPid }] : []));

// ---------- Verkehr für tcpdump ----------
interface Paket { t: number; dev: string; proto: 'tcp' | 'udp' | 'icmp' | 'arp'; src: string; dst: string; sp?: number; dp?: number; text: string; textN?: string; smac: string; dmac: string }
const DIENSTNAME: Record<number, string> = { 22: 'ssh', 53: 'domain', 80: 'http', 123: 'ntp', 443: 'https', 514: 'syslog', 5353: 'mdns' };
function verkehr(w: Welt, dev: string): Paket[] {
  const st = ns(w); const s = nw(w); const i = st.ifs[dev]; const out: Paket[] = [];
  if (dev === 'any') return ['enp0s31f6', 'enp3s0', 'wlp2s0', 'lo'].filter((d) => st.ifs[d]).flatMap((d) => verkehr(w, d)).sort((a, b) => a.t - b.t);
  if (!i || !i.up) return out;
  const eigen = i.addr[0]?.split('/')[0]; const me = i.mac;
  if (dev === 'lo') { out.push({ t: 0.21, dev, proto: 'tcp', src: '127.0.0.1', dst: '127.0.0.1', sp: 41822, dp: 631, text: 'Flags [S], seq 1033412871, win 65495, options [mss 65495,sackOK,TS val 1182 ecr 0,nop,wscale 7], length 0', smac: '00:00:00:00:00:00', dmac: '00:00:00:00:00:00' }); return out; }
  if (!eigen || !i.kabel) return out;
  const gw = st.routes.find((r) => r.dev === dev && r.ziel === 'default')?.via;
  const ns1 = (w.fs['/etc/resolv.conf'] ?? '').match(/^nameserver\s+(\S+)/m)?.[1] ?? '192.168.1.1';
  if (dev === 'enp0s31f6') {
    out.push({ t: 0.103, dev, proto: 'tcp', src: '192.168.1.17', dst: eigen, sp: 51122, dp: 22, text: 'Flags [P.], seq 2881:2917, ack 4410, win 501, length 36', smac: MAC['192.168.1.17'], dmac: me });
    out.push({ t: 0.104, dev, proto: 'tcp', src: eigen, dst: '192.168.1.17', sp: 22, dp: 51122, text: 'Flags [P.], seq 4410:4462, ack 2917, win 501, length 52', smac: me, dmac: MAC['192.168.1.17'] });
    if (imNetz(ns1, '192.168.1.0/24')) {
      out.push({ t: 0.412, dev, proto: 'udp', src: eigen, dst: ns1, sp: 51734, dp: 53, text: '41235+ A? www.example.org. (33)', smac: me, dmac: echteMac(w, ns1) ?? '00:00:00:00:00:00' });
      if (MAC[ns1]) out.push({ t: 0.418, dev, proto: 'udp', src: ns1, dst: eigen, sp: 53, dp: 51734, text: '41235 1/0/0 A 203.0.113.80 (49)', smac: MAC[ns1], dmac: me });
      else out.push({ t: 1.412, dev, proto: 'arp', src: eigen, dst: ns1, text: `Request who-has ${ns1} tell ${eigen}, length 28`, smac: me, dmac: 'ff:ff:ff:ff:ff:ff' });
    }
    if (gw) out.push({ t: 0.533, dev, proto: 'tcp', src: eigen, dst: '203.0.113.80', sp: 43110, dp: 443, text: 'Flags [P.], seq 1:518, ack 1, win 502, length 517', smac: me, dmac: MAC[gw] ?? '00:00:00:00:00:00' });
    out.push({ t: 0.871, dev, proto: 'arp', src: '192.168.1.1', dst: eigen, text: `Request who-has ${eigen} tell 192.168.1.1, length 46`, smac: MAC['192.168.1.1'], dmac: 'ff:ff:ff:ff:ff:ff' });
    out.push({ t: 0.872, dev, proto: 'arp', src: eigen, dst: '192.168.1.1', text: `Reply ${eigen} is-at ${me}, length 28`, smac: me, dmac: MAC['192.168.1.1'] });
    out.push({ t: 1.204, dev, proto: 'udp', src: eigen, dst: '192.168.1.1', sp: 123, dp: 123, text: 'NTPv4, Client, length 48', smac: me, dmac: MAC['192.168.1.1'] });
    out.push({ t: 1.511, dev, proto: 'udp', src: '192.168.1.40', dst: '224.0.0.251', sp: 5353, dp: 5353, text: '0 PTR (QM)? _ipp._tcp.local. (35)', smac: echteMac(w, '192.168.1.40'), dmac: '01:00:5e:00:00:fb' });
    if (s.opt.arpFalsch) out.push({ t: 1.733, dev, proto: 'tcp', src: eigen, dst: '192.168.1.40', sp: 39810, dp: 9100, text: 'Flags [S], seq 2211345511, win 64240, options [mss 1460,sackOK,TS val 99012 ecr 0,nop,wscale 7], length 0', smac: me, dmac: '00:1f:29:aa:bb:cc' });
    if (geheimLebt(w)) {
      out.push({ t: 0.301, dev, proto: 'tcp', src: eigen, dst: '203.0.113.66', sp: 50644, dp: 4444, text: 'Flags [P.], seq 88321:88449, ack 1, win 502, length 128', smac: me, dmac: MAC[gw ?? '192.168.1.1'] ?? '00:00:00:00:00:00' });
      out.push({ t: 1.302, dev, proto: 'tcp', src: eigen, dst: '203.0.113.66', sp: 50644, dp: 4444, text: 'Flags [P.], seq 88449:88577, ack 1, win 502, length 128', smac: me, dmac: MAC[gw ?? '192.168.1.1'] ?? '00:00:00:00:00:00' });
    }
  }
  if (dev === 'enp3s0') {
    out.push({ t: 0.22, dev, proto: 'udp', src: '10.20.0.5', dst: '10.20.255.255', sp: 514, dp: 514, text: 'SYSLOG local0.info, length 92', smac: MAC['10.20.0.5'], dmac: 'ff:ff:ff:ff:ff:ff' });
    out.push({ t: 0.95, dev, proto: 'arp', src: '10.20.0.1', dst: eigen, text: `Request who-has ${eigen} tell 10.20.0.1, length 46`, smac: MAC['10.20.0.1'], dmac: 'ff:ff:ff:ff:ff:ff' });
  }
  if (dev === 'wlp2s0') out.push({ t: 0.66, dev, proto: 'udp', src: eigen, dst: '192.168.2.1', sp: 51900, dp: 53, text: '5012+ AAAA? www.example.org. (33)', smac: me, dmac: MAC['192.168.2.1'] });
  return out.sort((a, b) => a.t - b.t);
}
/** Filterausdruck von tcpdump (pcap-filter) für die simulierten Pakete. */
function filterBauen(t: string[]): ((p: Paket) => boolean) | string {
  let i = 0;
  const peek = () => t[i]; const next = () => t[i++];
  const prim = (): ((p: Paket) => boolean) | string => {
    const x = next(); if (x === undefined) return 'syntax error';
    if (x === 'not' || x === '!') { const f = prim(); return typeof f === 'string' ? f : (p) => !f(p); }
    if (x === '(') { const f = oder(); if (next() !== ')') return 'syntax error'; return f; }
    if (['tcp', 'udp', 'icmp', 'arp'].includes(x)) { if (peek() === 'port') { next(); const n = Number(next()); return (p) => p.proto === x && (p.sp === n || p.dp === n); } return (p) => p.proto === x; }
    if (x === 'ip') return (p) => p.proto !== 'arp';
    const richt = x === 'src' || x === 'dst' ? x : null; const art = richt ? next() : x;
    const wert = art === 'host' || art === 'net' || art === 'port' ? next() : art === undefined ? undefined : (richt ? (i--, next()) : undefined);
    const passt = (sv: string | number | undefined, dv: string | number | undefined, f: (v: string | number) => boolean) => (richt === 'src' ? sv !== undefined && f(sv) : richt === 'dst' ? dv !== undefined && f(dv) : (sv !== undefined && f(sv)) || (dv !== undefined && f(dv)));
    if (art === 'host') { if (!wert) return 'syntax error'; const ip = istIp(wert) ? wert : aufloesenFuerFilter(wert); if (!ip) return `can't resolve host '${wert}'`; return (p) => passt(p.src, p.dst, (v) => v === ip); }
    if (art === 'net') { if (!wert) return 'syntax error'; return (p) => passt(p.src, p.dst, (v) => imNetz(String(v), wert)); }
    if (art === 'port') { const n = Number(wert) || Object.entries(DIENSTNAME).find(([, v]) => v === wert)?.[0]; if (!n) return `unknown port '${wert}'`; return (p) => passt(p.sp, p.dp, (v) => Number(v) === Number(n)); }
    if (richt && art && (istIp(art))) return (p) => passt(p.src, p.dst, (v) => v === art);
    return `syntax error in filter expression`;
  };
  let aufloesenFuerFilter = (_n: string): string | null => null;
  const und = (): ((p: Paket) => boolean) | string => { let f = prim(); while (typeof f !== 'string' && (peek() === 'and' || peek() === '&&')) { next(); const g = prim(); if (typeof g === 'string') return g; const a = f; f = (p) => a(p) && g(p); } return f; };
  const oder = (): ((p: Paket) => boolean) | string => { let f = und(); while (typeof f !== 'string' && (peek() === 'or' || peek() === '||')) { next(); const g = und(); if (typeof g === 'string') return g; const a = f; f = (p) => a(p) || g(p); } return f; };
  const bauen = (w: Welt) => { aufloesenFuerFilter = (n) => aufloesen(w, n).ip; if (!t.length) return () => true; const f = oder(); if (typeof f !== 'string' && i < t.length) return 'syntax error'; return f; };
  return bauen as unknown as string;
}
function filter(w: Welt, ausdruck: string[]): ((p: Paket) => boolean) | string {
  const t = ausdruck.join(' ').replace(/([()])/g, ' $1 ').split(/\s+/).filter(Boolean);
  const b = filterBauen(t) as unknown as (w: Welt) => ((p: Paket) => boolean) | string; return b(w);
}
function paketZeile(w: Welt, p: Paket, o: { n: number; e: boolean; any: boolean }, t0: string): string {
  const name = (ip: string) => (o.n ? ip : ip === ns(w).ifs[p.dev]?.addr[0]?.split('/')[0] ? 'werkstatt.lab.example.org' : nameVon(ip));
  const port = (x?: number) => (x === undefined ? '' : `.${o.n >= 2 || !DIENSTNAME[x] ? x : DIENSTNAME[x]}`);
  const kopf = `${t0} ${o.any ? `${p.dev.padEnd(6)} ${p.src === ns(w).ifs[p.dev]?.addr[0]?.split('/')[0] ? 'Out' : 'In '}  ` : ''}${o.e ? `${p.smac} > ${p.dmac}, ethertype ${p.proto === 'arp' ? 'ARP (0x0806)' : 'IPv4 (0x0800)'}, length ${p.proto === 'arp' ? 42 : 98}: ` : ''}`;
  if (p.proto === 'arp') return `${kopf}ARP, ${p.text.replace(/(\d+\.\d+\.\d+\.\d+)/g, (m) => (o.n ? m : name(m)))}`;
  return `${kopf}IP ${name(p.src)}${port(p.sp)} > ${name(p.dst)}${port(p.dp)}: ${p.proto === 'tcp' ? '' : p.proto === 'udp' && p.dp !== 53 && p.sp !== 53 && p.sp !== 123 && p.sp !== 5353 && p.sp !== 514 ? 'UDP, ' : ''}${p.text}`;
}

// ---------- Befehle ----------
export function netzwerkBefehle(alt: Record<string, B>): Record<string, B> {
  const b: Record<string, B> = {};
  const mit = (n: string, f: B): B => (w, a, i, r) => (netzwerkAktiv(w) ? f(w, a, i, r) : alt[n] ? alt[n](w, a, i, r) : fehler(`bash: ${n}: Befehl nicht gefunden`, 127));
  const hat = (w: Welt, p: string) => ['/usr/sbin/', '/usr/bin/', '/sbin/', '/bin/'].some((d) => typeof w.fs[d + p] === 'string');
  const fehlt = (n: string, paket: string) => fehler(`bash: ${n}: Befehl nicht gefunden\n(${n} gehört zum Paket ${paket}: sudo apt install ${paket})`, 127);
  const NUR_ROOT = 'RTNETLINK answers: Operation not permitted';
  const macGut = (m: string) => /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(m);
  const zufallsMac = (n: string) => { let h = 7; for (const c of n) h = (h * 31 + c.charCodeAt(0)) >>> 0; return `${((h & 0xfc) | 0x02).toString(16).padStart(2, '0')}:${Array.from({ length: 5 }, (_, k) => ((h >>> (k * 5)) & 0xff).toString(16).padStart(2, '0')).join(':')}`; };

  b.ip = (w, a, i, root) => {
    if (!netzwerkAktiv(w)) return alt.ip(w, a, i, root);
    const st = ns(w); const s = nw(w); const r = root || w.root;
    const opt = a.filter((x) => /^-[46a-z]+$/.test(x)); const rest = a.filter((x) => !opt.includes(x));
    const det = opt.some((x) => x === '-d' || x === '-details');
    const [obj = '', cmd = 'show', ...args] = rest;
    const wert = (k: string) => { const j = args.indexOf(k); return j >= 0 ? args[j + 1] : undefined; };
    const devName = () => wert('dev') ?? args.find((x) => !['dev', 'up', 'down', 'mtu', 'name', 'address', 'link', 'type', 'peer', 'id', 'label', 'lladdr', 'nud'].includes(x) && args[args.indexOf(x) - 1] !== 'mtu' && args[args.indexOf(x) - 1] !== 'name' && args[args.indexOf(x) - 1] !== 'address');
    // ----- link -----
    if (/^l(i(nk?)?)?$/.test(obj)) {
      if (cmd === 'add') {
        if (!r) return fehler(NUR_ROOT, 2);
        const ti = args.indexOf('type'); const vor = ti >= 0 ? args.slice(0, ti) : args; const nach = ti >= 0 ? args.slice(ti + 1) : [];
        const typ = nach[0]; const w2 = (l: string[], k: string) => { const j = l.indexOf(k); return j >= 0 ? l[j + 1] : undefined; };
        const parent = w2(vor, 'link');
        const name = w2(vor, 'name') ?? w2(vor, 'dev') ?? vor.find((x, k) => !['link', 'name', 'dev'].includes(x) && !['link', 'name', 'dev'].includes(vor[k - 1] ?? ''));
        if (!typ) return fehler('Not enough information: "type" argument is required');
        if (!['vlan', 'dummy', 'veth'].includes(typ)) return fehler('Error: Unknown device type.', 2);
        if (parent && !st.ifs[parent]) return fehler(`Cannot find device "${parent}"`);
        if (!name) return fehler('Not enough information: "dev" argument is required.');
        if (st.ifs[name]) return fehler('RTNETLINK answers: File exists', 2);
        const neu = (n: string): If => ({ mac: zufallsMac(n), up: false, addr: [], addr6: [], typ: 'ethernet', kabel: false, lan: '' });
        if (typ === 'vlan') {
          if (!parent) return fehler('Not enough information: "link" argument is required.', 2);
          const idW = w2(nach, 'id'); const id = Number(idW); if (!idW) return fehler('Error: 8021q: VLAN device needs id.', 2); if (!(id >= 1 && id <= 4094)) return fehler(id > 4095 ? `Error: argument "${idW}" is wrong: id is invalid` : 'Error: 8021q: Invalid VLAN id.', id > 4095 ? 1 : 2);
          st.ifs[name] = { ...neu(name), mac: st.ifs[parent].mac, art: 'vlan', vlan: { von: parent, id }, kabel: st.ifs[parent].kabel, lan: parent === 'enp0s31f6' && id === 20 ? '10.20.20.0/24' : '' };
        } else if (typ === 'dummy') st.ifs[name] = { ...neu(name), art: 'dummy', kabel: true };
        else { const pi = nach.indexOf('peer'); const peer = pi >= 0 ? (nach[pi + 1] === 'name' ? nach[pi + 2] : nach[pi + 1]) ?? '' : `veth${Object.keys(st.ifs).length}`; if (st.ifs[peer]) return fehler('RTNETLINK answers: File exists', 2); st.ifs[name] = { ...neu(name), art: 'veth', peer }; st.ifs[peer] = { ...neu(peer), art: 'veth', peer: name }; }
        return ok();
      }
      if (cmd === 'del' || cmd === 'delete') {
        if (!r) return fehler(NUR_ROOT, 2);
        const d = wert('dev') ?? args[0]; if (!d || !st.ifs[d]) return fehler(`Cannot find device "${d ?? ''}"`);
        if (!st.ifs[d].art) return fehler('RTNETLINK answers: Operation not supported', 2);
        const weg = [d, ...(st.ifs[d].peer ? [st.ifs[d].peer!] : []), ...Object.entries(st.ifs).filter(([, x]) => x.vlan?.von === d).map(([n]) => n)];
        for (const n of [...new Set(weg)]) { if (!st.ifs[n]) continue; adrWeg(st, n); st.routes = st.routes.filter((q) => q.dev !== n); delete st.ifs[n]; }
        return ok();
      }
      if (cmd === 'set') {
        const d = devName(); if (!d || !st.ifs[d]) return fehler(`Cannot find device "${d ?? ''}"`);
        if (!r) return fehler(NUR_ROOT, 2);
        const x = st.ifs[d];
        const m = wert('mtu'); if (m !== undefined) { const n = Number(m); if (!/^\d+$/.test(m)) return fehler(`Error: argument "${m}" is wrong: Invalid "mtu" value`, 255); const max = x.art === 'veth' || x.art === 'dummy' ? 65535 : x.typ === 'wifi' ? 2304 : x.art === 'vlan' ? (st.ifs[x.vlan!.von].mtu ?? 1500) : 9000; if (n > max) return fehler('Error: mtu greater than device maximum.', 2); if (n < 68) return fehler('Error: mtu less than device minimum.', 2); x.mtu = n; }
        const ad = wert('address'); if (ad !== undefined) { if (!macGut(ad)) return fehler(`"${ad.split(':').find((t) => !/^[0-9a-f]{1,2}$/i.test(t)) ?? ad}" is invalid lladdr.`); x.mac = ad.toLowerCase(); }
        const nn = wert('name'); if (nn !== undefined) { if (x.up) return fehler('RTNETLINK answers: Device or resource busy', 2); if (st.ifs[nn]) return fehler('RTNETLINK answers: File exists', 2); st.ifs[nn] = x; delete st.ifs[d]; for (const q of st.routes) if (q.dev === d) q.dev = nn; for (const y of Object.values(st.ifs)) { if (y.peer === d) y.peer = nn; if (y.vlan?.von === d) y.vlan.von = nn; } return ok(); }
        if (args.includes('up') && d === 'wlp2s0' && s.rfkill.wlanSoft) return fehler('RTNETLINK answers: Operation not possible due to RF-kill', 2);
        if (args.includes('up') || args.includes('down')) {
          const e = alt.ip(w, ['link', 'set', d, args.includes('up') ? 'up' : 'down'], '', true); if (e.code) return e;
          if (args.includes('up')) { if (x.art === 'veth') x.kabel = !!st.ifs[x.peer!]?.up; if (x.art === 'veth' && st.ifs[x.peer!]?.up) st.ifs[x.peer!].kabel = true; if (x.art === 'vlan') x.kabel = st.ifs[x.vlan!.von].kabel && st.ifs[x.vlan!.von].up; if (d === 'wlp2s0') x.kabel = !!s.wpa.ssid; }
          else if (x.art === 'veth' && st.ifs[x.peer!]) st.ifs[x.peer!].kabel = false;
        }
        return ok();
      }
      if (cmd === 'show' || cmd === 'list' || cmd === 'ls' || st.ifs[cmd]) {
        const d = st.ifs[cmd] ? cmd : wert('dev') ?? args[0]; if (d && !st.ifs[d]) return fehler(`Device "${d}" does not exist.`);
        const e = alt.ip(w, opt.filter((x) => x !== '-d' && x !== '-details').concat(['link', 'show', ...(d ? [d] : [])]), '', root); if (e.code || !det) return e;
        return ok(e.out.split('\n').map((z) => { const n = z.match(/^\d+: ([\w.-]+)(@[\w.-]+)?:/)?.[1]; const x = n ? st.ifs[n] : undefined; return x ? `${z}\n    ${x.vlan ? `vlan protocol 802.1Q id ${x.vlan.id} <REORDER_HDR> ` : x.art === 'veth' ? 'veth ' : x.art === 'dummy' ? 'dummy ' : ''}addrgenmode eui64 numtxqueues 1 numrxqueues 1 gso_max_size 65536 gso_max_segs 65535` : z; }).join('\n').replace(/\n(    vlan[^\n]*|    veth[^\n]*|    dummy[^\n]*|    addrgenmode[^\n]*)\n(    link\/[^\n]*)/g, '\n$2\n$1'));
      }
    }
    // ----- address mit Label, Fehlermeldungen wie iproute2 6.x -----
    if (/^a(d(dr?)?)?$|^address$/.test(obj) && (cmd === 'add' || cmd === 'del' || cmd === 'delete')) {
      const d = wert('dev'); const c0 = args[0] ?? '';
      if (!r) return fehler(NUR_ROOT, 2);
      if (opt.includes('-6') || c0.includes(':')) { if (!d || !st.ifs[d]) return fehler(`Cannot find device "${d ?? ''}"`); const c = c0.includes('/') ? c0 : c0 + '/128'; const l = st.ifs[d].addr6; if (cmd === 'add') { if (l.includes(c)) return fehler('RTNETLINK answers: File exists', 2); l.push(c); } else { if (!l.includes(c)) return fehler('RTNETLINK answers: Cannot assign requested address', 2); st.ifs[d].addr6 = l.filter((x) => x !== c); } return ok(); }
      const [ip, pre = '32'] = c0.split('/');
      if (!istIp(ip) || !/^\d+$/.test(pre) || Number(pre) > 32) return fehler(`Error: any valid prefix is expected rather than "${c0}".`);
      if (!d || !st.ifs[d]) return fehler(`Cannot find device "${d ?? ''}"`);
      const c = `${ip}/${pre}`; const x = st.ifs[d];
      if (cmd === 'add') {
        if (x.addr.includes(c)) return fehler('Error: ipv4: Address already assigned.', 2);
        const lab = wert('label'); adrHinzu(st, d, c); if (lab) (x.labels ??= {})[c] = lab;
        if (!x.up) st.routes = st.routes.filter((q) => !(q.dev === d && q.proto === 'kernel' && q.ziel === netzVon(c)) || true);
        return ok();
      }
      if (!x.addr.includes(c)) return fehler('Error: ipv4: Address not found.', 2);
      adrWeg(st, d, c); if (x.labels) delete x.labels[c]; return ok();
    }
    // ----- route: Präfixe prüfen, dann wie bisher -----
    if (/^r(o(u(te?)?)?)?$/.test(obj) && ['add', 'del', 'delete', 'replace'].includes(cmd)) {
      const z = args[0] ?? '';
      if (z !== 'default' && z !== '0.0.0.0/0') { const [ip, pre = '32'] = z.split('/'); if (!istIp(ip) || !/^\d+$/.test(pre) || Number(pre) > 32) return fehler(`Error: any valid prefix is expected rather than "${z}".`); }
      const via = wert('via'); if (via && !istIp(via)) return fehler(`Error: inet address is expected rather than "${via}".`);
      const dv = wert('dev'); if (dv && !st.ifs[dv]) return fehler(`Cannot find device "${dv}"`);
      if (cmd === 'add' && via && !st.routes.some((q) => !q.via && q.ziel !== 'default' && imNetz(via, q.ziel) && (!dv || q.dev === dv))) return fehler('Error: Nexthop has invalid gateway.', 2);
      return alt.ip(w, a, i, root);
    }
    // ----- neighbour -----
    if (/^n(e(i(g(h(b(o(ur?)?)?)?)?)?)?)?$/.test(obj)) {
      const d = wert('dev'); if (d && !st.ifs[d]) return fehler(`Cannot find device "${d}"`);
      if (cmd === 'show' || cmd === 'list' || cmd === 'ls') {
        const z = s.neigh.filter((x) => !d || x.dev === d).filter((x) => !opt.includes('-6') || x.ip.includes(':'));
        const v6 = opt.includes('-4') ? [] : [`fe80::1 ${d ? '' : 'dev enp0s31f6 '}lladdr 9c:c9:eb:12:34:56 router REACHABLE`];
        return ok([...z.map((x) => `${x.ip} ${d ? '' : `dev ${x.dev} `}${x.mac ? `lladdr ${x.mac} ` : ''}${x.router ? 'router ' : ''}${x.nud}`), ...(opt.includes('-6') || !d || d === 'enp0s31f6' ? v6 : [])].filter((zz) => !opt.includes('-6') || zz.includes(':')).join('\n'));
      }
      if (!r) return fehler(NUR_ROOT, 2);
      if (cmd === 'flush') { s.neigh = s.neigh.filter((x) => (d && x.dev !== d) || x.nud === 'PERMANENT' && !args.includes('all')); return ok(); }
      const ip = args.find((x) => istIp(x)); if (!ip) return fehler('Error: an inet address is expected rather than "' + (args[0] ?? '') + '".');
      if (!d) return fehler('Device and destination are required arguments.', 255);
      const mac = wert('lladdr'); const nud = (wert('nud') ?? 'permanent').toUpperCase() as Nachbar['nud'];
      const e = s.neigh.find((x) => x.ip === ip && x.dev === d);
      if (cmd === 'add' || cmd === 'replace' || cmd === 'change') {
        if (mac && !macGut(mac)) return fehler('Error: Invalid link address.', 2);
        if (cmd === 'add' && e) return fehler('RTNETLINK answers: File exists', 2);
        if (cmd === 'change' && !e) return fehler('RTNETLINK answers: No such file or directory', 2);
        s.neigh = s.neigh.filter((x) => x !== e); s.neigh.push({ ip, dev: d, mac: mac?.toLowerCase(), nud: nud === 'STALE' || nud === 'REACHABLE' ? nud : 'PERMANENT' }); return ok();
      }
      if (cmd === 'del' || cmd === 'delete') { if (!e) return fehler('RTNETLINK answers: No such file or directory', 2); s.neigh = s.neigh.filter((x) => x !== e); return ok(); }
    }
    return alt.ip(w, a, i, root);
  };

  // ----- ifconfig mit Alias-Schnittstellen (enp0s31f6:web) -----
  b.ifconfig = (w, a, i, root) => {
    const st = ns(w); const [d, ...rest] = a.filter((x) => x !== '-a');
    if (!netzwerkAktiv(w) || !d?.includes(':')) return alt.ifconfig(w, a, i, root);
    const basis = d.split(':')[0]; const x = st.ifs[basis];
    if (!x) return fehler(`${d}: Fehler beim Auslesen der Schnittstelleninformation: Gerät nicht gefunden`);
    const vorhanden = x.addr.find((c) => x.labels?.[c] === d);
    if (!rest.length) return vorhanden ? alt.ifconfig(w, [], i, root).out.split('\n\n').filter((blk) => blk.startsWith(d + ':')).length ? ok(alt.ifconfig(w, [], i, root).out.split('\n\n').find((blk) => blk.startsWith(d + ':'))!) : ok() : fehler(`${d}: Fehler beim Auslesen der Schnittstelleninformation: Gerät nicht gefunden`);
    if (!(root || w.root)) return fehler('SIOCSIFADDR: Vorgang nicht zulässig');
    if (rest[0] === 'down') { if (vorhanden) { adrWeg(st, basis, vorhanden); delete x.labels![vorhanden]; } return ok(); }
    if (rest[0] === 'up') return ok();
    if (!istIp(rest[0])) return fehler(`${rest[0]}: Unbekannter Rechner\nifconfig: »--help« gibt Benutzungshinweise aus.`);
    const k = rest.indexOf('netmask'); const bits = k >= 0 ? maskeBits(rest[k + 1]) : 24;
    if (vorhanden) { adrWeg(st, basis, vorhanden); delete x.labels![vorhanden]; }
    const c = `${rest[0]}/${bits}`; adrHinzu(st, basis, c); (x.labels ??= {})[c] = d; return ok();
  };

  // ----- arp (net-tools) -----
  b.arp = mit('arp', (w, a, _i, root) => {
    const s = nw(w); const st = ns(w); const r = root || w.root;
    const nummerisch = a.some((x) => /^-\w*n/.test(x));
    if (a.some((x) => /^-\w*s$/.test(x) || x === '--set')) {
      if (!r) return fehler('SIOCSARP: Die Operation ist nicht erlaubt');
      const [ip, mac] = a.filter((x) => !x.startsWith('-')); if (!ip || !mac) return fehler('arp: need host name');
      const ziel = istIp(ip) ? ip : aufloesen(w, ip).ip; if (!ziel) return fehler(`${ip}: Unbekannter Rechner`);
      if (!macGut(mac)) return fehler(`arp: invalid hardware address`);
      const q = routeFuer(st, ziel); if (!q || q.via) return fehler('SIOCSARP: Das Netzwerk ist nicht erreichbar');
      s.neigh = s.neigh.filter((x) => !(x.ip === ziel && x.dev === q.dev)); s.neigh.push({ ip: ziel, dev: q.dev, mac: mac.toLowerCase(), nud: 'PERMANENT' }); return ok();
    }
    if (a.some((x) => /^-\w*d$/.test(x) || x === '--delete')) {
      if (!r) return fehler('SIOCDARP(dontpub): Die Operation ist nicht erlaubt');
      const ip0 = a.find((x) => !x.startsWith('-')) ?? ''; const ip = istIp(ip0) ? ip0 : aufloesen(w, ip0).ip ?? ip0;
      const e = s.neigh.find((x) => x.ip === ip); if (!e) return fehler(`No ARP entry for ${ip0}`);
      s.neigh = s.neigh.filter((x) => x !== e); return ok();
    }
    if (a.some((x) => /^-\w*f$/.test(x) || x === '--file')) {
      if (!r) return fehler('SIOCSARP: Die Operation ist nicht erlaubt');
      const f = a.find((x) => !x.startsWith('-')) ?? '/etc/ethers'; const t = w.fs[f];
      if (typeof t !== 'string') return fehler(`arp: cannot open etherfile ${f} !`);
      for (const z of t.split('\n')) { const [mac, ip0] = z.replace(/#.*/, '').trim().split(/\s+/); if (!mac || !ip0) continue; const ip = istIp(ip0) ? ip0 : aufloesen(w, ip0).ip; const q = ip ? routeFuer(st, ip) : null; if (!ip || !q) continue; s.neigh = s.neigh.filter((x) => !(x.ip === ip && x.dev === q.dev)); s.neigh.push({ ip, dev: q.dev, mac: mac.toLowerCase(), nud: 'PERMANENT' }); }
      return ok();
    }
    const z = s.neigh.filter((x) => !x.ip.includes(':'));
    const kurzName = (ip: string) => (nummerisch ? '?' : nameVon(ip) !== ip ? nameVon(ip) : ip === '192.168.1.17' ? 'pc-tom.lab.example.org' : '?');
    if (a.some((x) => /^-\w*a/.test(x))) return ok(z.map((x) => `${kurzName(x.ip)} (${x.ip}) at ${x.mac ?? '<incomplete>'}${x.mac ? ' [ether]' : ''}${x.nud === 'PERMANENT' ? ' PERM' : ''} on ${x.dev}`).join('\n'));
    return ok(['Address                  HWtype  HWaddress           Flags Mask            Iface', ...z.map((x) => `${(nummerisch || kurzName(x.ip) === '?' ? x.ip : kurzName(x.ip)).padEnd(25)}${x.mac ? 'ether   ' + x.mac.padEnd(20) + (x.nud === 'PERMANENT' ? 'CM' : 'C ').padEnd(6) : '        (incomplete)              '}${''.padEnd(16)}${x.dev}`)].join('\n'));
  });

  // ----- WLAN -----
  const wlanFrei = (w: Welt) => !nw(w).rfkill.wlanSoft;
  b.rfkill = mit('rfkill', (w, a, _i, root) => {
    const s = nw(w); const [cmd, ziel] = a.filter((x) => !x.startsWith('-'));
    if (cmd === 'block' || cmd === 'unblock') {
      if (!(root || w.root)) return fehler('rfkill: cannot open /dev/rfkill: Keine Berechtigung');
      if (!ziel) return fehler('rfkill: Zu wenige Argumente.');
      const an = cmd === 'block';
      if (['wifi', 'wlan', 'all', '1'].includes(ziel)) { s.rfkill.wlanSoft = an; if (an) { const i = ns(w).ifs.wlp2s0; i.up = false; i.kabel = false; s.wpa.ssid = null; } }
      if (['bluetooth', 'all', '0'].includes(ziel)) s.rfkill.btSoft = an;
      if (!['wifi', 'wlan', 'all', '1', 'bluetooth', '0'].includes(ziel)) return fehler(`rfkill: invalid identifier: ${ziel}`);
      return ok();
    }
    const z = (x: boolean) => (x ? 'blocked' : 'unblocked');
    if (cmd === 'list') return ok(`0: hci0: Bluetooth\n\tSoft blocked: ${s.rfkill.btSoft ? 'yes' : 'no'}\n\tHard blocked: no\n1: phy0: Wireless LAN\n\tSoft blocked: ${s.rfkill.wlanSoft ? 'yes' : 'no'}\n\tHard blocked: no`);
    return ok(`ID TYPE      DEVICE      SOFT      HARD\n 0 bluetooth hci0   ${z(s.rfkill.btSoft).padStart(9)} unblocked\n 1 wlan      phy0   ${z(s.rfkill.wlanSoft).padStart(9)} unblocked`);
  });
  const bssBlock = (x: Wlan) => `BSS ${x.bssid}(on wlp2s0)\n\tTSF: 1234567890 usec (0d, 00:20:34)\n\tfreq: ${x.freq}\n\tbeacon interval: 100 TUs\n\tcapability: ESS Privacy ShortSlotTime (0x0411)\n\tsignal: ${x.signal}.00 dBm\n\tlast seen: 120 ms ago\n\tSSID: ${x.ssid}\n\tSupported rates: 6.0* 9.0 12.0* 18.0 24.0* 36.0 48.0 54.0 \n\tDS Parameter set: channel ${x.kanal}\n\tRSN:\t * Version: 1\n\t\t * Group cipher: CCMP\n\t\t * Pairwise ciphers: CCMP\n\t\t * Authentication suites: PSK\n\t\t * Capabilities: 16-PTKSA-RC 1-GTKSA-RC (0x000c)`;
  b.iw = mit('iw', (w, a, _i, root) => {
    const s = nw(w); const st = ns(w); const i = st.ifs.wlp2s0; const x = WLANS.find((y) => y.ssid === s.wpa.ssid);
    const t = a.filter((y) => !y.startsWith('-'));
    if (t[0] === 'dev' && !t[1]) return ok(`phy#0\n\tInterface wlp2s0\n\t\tifindex 3\n\t\twdev 0x1\n\t\taddr ${i.mac}\n${x ? `\t\tssid ${x.ssid}\n` : ''}\t\ttype managed\n${x ? `\t\tchannel ${x.kanal} (${x.freq} MHz), width: 80 MHz, center1: ${x.freq + 30} MHz\n` : ''}\t\ttxpower 22.00 dBm\n\t\tmulticast TXQ:\n\t\t\tqsz-byt\tqsz-pkt\tflows\tdrops\tmarks\toverlmt\thashcol\ttx-bytes\ttx-packets\n\t\t\t0\t0\t0\t0\t0\t0\t0\t0\t\t0`);
    if (t[0] === 'list' || t[0] === 'phy') return ok('Wiphy phy0\n\twiphy index: 0\n\tmax # scan SSIDs: 20\n\tSupported Ciphers:\n\t\t* WEP40 (00-0f-ac:1)\n\t\t* CCMP-128 (00-0f-ac:4)\n\t\t* GCMP-256 (00-0f-ac:9)\n\tSupported interface modes:\n\t\t * IBSS\n\t\t * managed\n\t\t * AP\n\t\t * monitor\n\tBand 1:\n\t\tFrequencies:\n\t\t\t* 2412 MHz [1] (22.0 dBm)\n\t\t\t* 2437 MHz [6] (22.0 dBm)\n\tBand 2:\n\t\tFrequencies:\n\t\t\t* 5180 MHz [36] (22.0 dBm)\n\t\t\t* 5500 MHz [100] (22.0 dBm) (radar detection)\n(gekürzt)');
    if (t[0] === 'reg' && t[1] === 'get') return ok('global\ncountry DE: DFS-ETSI\n\t(2400 - 2483 @ 40), (N/A, 20), (N/A)\n\t(5150 - 5250 @ 80), (N/A, 23), (N/A), NO-OUTDOOR, AUTO-BW\n\t(5470 - 5725 @ 160), (N/A, 26), (0 ms), DFS');
    if (t[0] === 'reg' && t[1] === 'set') return (root || w.root) ? ok() : fehler('command failed: Operation not permitted (-1)', 1);
    const dev = t[0] === 'dev' ? t[1] : t[0] === 'wlp2s0' ? 'wlp2s0' : undefined; const op = t[0] === 'dev' ? t[2] : t[1];
    if (dev && dev !== 'wlp2s0') return fehler(`command failed: No such device (-19)`, 237);
    if (op === 'link') return ok(x && i.up ? `Connected to ${x.bssid} (on wlp2s0)\n\tSSID: ${x.ssid}\n\tfreq: ${x.freq}\n\tRX: 1843201 bytes (9122 packets)\n\tTX: 212034 bytes (1401 packets)\n\tsignal: ${x.signal} dBm\n\trx bitrate: 433.3 MBit/s VHT-MCS 9 80MHz short GI VHT-NSS 1\n\ttx bitrate: 270.0 MBit/s VHT-MCS 6 80MHz VHT-NSS 1\n\n\tbss flags:\tshort-slot-time\n\tdtim period:\t1\n\tbeacon int:\t100` : 'Not connected.');
    if (op === 'info') return ok(`Interface wlp2s0\n\tifindex 3\n\twdev 0x1\n\taddr ${i.mac}\n${x ? `\tssid ${x.ssid}\n` : ''}\ttype managed\n\twiphy 0\n\ttxpower 22.00 dBm`);
    if (op === 'scan') {
      if (!(root || w.root)) return fehler('command failed: Operation not permitted (-1)', 255);
      if (!wlanFrei(w)) return fehler('command failed: Operation not possible due to RF-kill (-132)', 240);
      if (!i.up) return fehler('command failed: Network is down (-100)', 156);
      return ok(WLANS.map(bssBlock).join('\n'));
    }
    if (op === 'connect') {
      if (!(root || w.root)) return fehler('command failed: Operation not permitted (-1)', 255);
      if (!i.up) return fehler('command failed: Network is down (-100)', 156);
      const y = WLANS.find((z) => z.ssid === t[t.indexOf('connect') + 1]);
      return ok(y ? `(${y.ssid} ist mit WPA2 geschützt. iw connect kann nur offene Netze oder WEP. Für WPA2 braucht es wpa_supplicant.)` : '');
    }
    if (op === 'disconnect') { s.wpa.ssid = null; i.kabel = false; adrWeg(st, 'wlp2s0'); st.routes = st.routes.filter((q) => q.dev !== 'wlp2s0'); return ok(); }
    return fehler('Usage:\tiw [options] command\n(Im Simulator: iw dev, iw dev wlp2s0 link|info|scan|connect, iw list, iw reg get)', 1);
  });
  b.iwconfig = mit('iwconfig', (w, a, _i, root) => {
    if (!hat(w, 'iwconfig')) return fehlt('iwconfig', 'wireless-tools');
    const s = nw(w); const st = ns(w); const x = WLANS.find((y) => y.ssid === s.wpa.ssid);
    const [d, k, v] = a;
    if (d && k) { if (!(root || w.root)) return fehler(`Error for wireless request "Set ESSID" (8B1A) :\n    SET failed on device ${d} ; Operation not permitted.`); if (k === 'essid') return ok(`(Gespeichert: ESSID "${v ?? ''}". Bei WPA2-Netzen kümmert sich wpa_supplicant um die Verbindung, iwconfig allein reicht nicht.)`); return ok(); }
    const wl = `wlp2s0    IEEE 802.11  ESSID:${x ? `"${x.ssid}"` : 'off/any'}  \n          Mode:Managed  ${x ? `Frequency:${(x.freq / 1000).toFixed(3).replace(/0+$/, '')} GHz  Access Point: ${x.bssid.toUpperCase()}` : 'Access Point: Not-Associated'}   \n          ${x ? 'Bit Rate=270 Mb/s   ' : ''}Tx-Power=${s.rfkill.wlanSoft ? 'off' : '22 dBm'}   \n          Retry short limit:7   RTS thr:off   Fragment thr:off\n          Power Management:on\n${x ? `          Link Quality=58/70  Signal level=${x.signal} dBm  \n` : ''}`;
    const rest = Object.keys(st.ifs).filter((n) => n !== 'wlp2s0').map((n) => `${n.padEnd(10)}no wireless extensions.\n`).join('\n');
    if (d === 'wlp2s0') return ok(wl);
    if (d && st.ifs[d]) return fehler(`${d}        no wireless extensions.`);
    return ok(`${rest}\n${wl}`.trim());
  });
  b.iwlist = mit('iwlist', (w, a, _i, root) => {
    if (!hat(w, 'iwlist')) return fehlt('iwlist', 'wireless-tools');
    const [d, op] = a;
    if (!d || !op) return fehler('Usage: iwlist [interface] scanning [essid NNN] [last]\n(Im Simulator: iwlist wlp2s0 scan)');
    if (d !== 'wlp2s0') return fehler(`${d}     Interface doesn't support scanning.`);
    if (!/^scan/.test(op)) return ok(`wlp2s0    ${op}: (im Simulator nicht nachgebildet)`);
    if (!wlanFrei(w)) return fehler('wlp2s0    Interface doesn\'t support scanning : Operation not possible due to RF-kill');
    if (!ns(w).ifs.wlp2s0.up) return fehler('wlp2s0    Interface doesn\'t support scanning : Network is down');
    if (!(root || w.root)) return ok('wlp2s0    Interface doesn\'t support scanning : Operation not permitted\n(Ohne root zeigt iwlist nur, was zuletzt gefunden wurde. Hier ist noch nichts gespeichert.)');
    return ok(`wlp2s0    Scan completed :\n${WLANS.map((x, k) => `          Cell 0${k + 1} - Address: ${x.bssid.toUpperCase()}\n                    Channel:${x.kanal}\n                    Frequency:${(x.freq / 1000).toFixed(3)} GHz (Channel ${x.kanal})\n                    Quality=${70 + x.signal + 40}/70  Signal level=${x.signal} dBm  \n                    Encryption key:on\n                    ESSID:"${x.ssid}"\n                    Mode:Master\n                    IE: IEEE 802.11i/WPA2 Version 1\n                        Group Cipher : CCMP\n                        Pairwise Ciphers (1) : CCMP\n                        Authentication Suites (1) : PSK`).join('\n')}`);
  });
  b.wpa_passphrase = mit('wpa_passphrase', (w, a, stdin) => {
    const [ssid, pass0] = a; if (!ssid) return fehler('usage: wpa_passphrase <ssid> [passphrase]\n\nIf passphrase is left out, it will be read from stdin', 1);
    const pass = pass0 ?? stdin.split('\n')[0] ?? '';
    if (pass.length < 8 || pass.length > 63) return fehler('Passphrase must be 8..63 characters', 1);
    return ok(`network={\n\tssid="${ssid}"\n\t#psk="${pass}"\n\tpsk=${wpaPsk(pass, ssid)}\n}`);
  });
  b.wpa_supplicant = mit('wpa_supplicant', (w, a, _i, root) => {
    const s = nw(w); const st = ns(w);
    const opt = (k: string) => { const j = a.findIndex((x) => x === k || x.startsWith(k) && x.length > 2); if (j < 0) return undefined; return a[j].length > 2 ? a[j].slice(2) : a[j + 1]; };
    const dev = opt('-i'); const conf = opt('-c');
    if (!dev || !conf) return fehler('wpa_supplicant v2.10\nusage:\n  wpa_supplicant [-BddhKLqqtvW] [-P<pid file>] [-g<global ctrl>] \\\n        -i<ifname> -c<config file> [-D<driver>] [-p<driver_param>] \\\n(Im Simulator: wpa_supplicant -B -i wlp2s0 -c DATEI)', 1);
    if (!(root || w.root)) return fehler(`Successfully initialized wpa_supplicant\nCould not set interface ${dev} flags (UP): Operation not permitted\nnl80211: Could not set interface '${dev}' UP\nFailed to initialize driver interface`, 255);
    if (dev !== 'wlp2s0') return fehler(`Successfully initialized wpa_supplicant\nCould not read interface ${dev} flags: No such device\nnl80211: Driver does not support authentication/association or connect commands\nwlp2s0: Failed to initialize driver interface`, 255);
    const t = w.fs[K.pfad(w, conf)]; if (typeof t !== 'string') return fehler(`Successfully initialized wpa_supplicant\nFailed to open config file '${conf}', error: No such file or directory\nFailed to read or parse configuration '${conf}'.`, 255);
    if (s.wpa.laeuft) return fehler(`Successfully initialized wpa_supplicant\nctrl_iface exists and seems to be in use - cannot override it\nDelete '/var/run/wpa_supplicant/wlp2s0' manually if it is not used anymore\nFailed to initialize control interface '/var/run/wpa_supplicant'.`, 255);
    if (!wlanFrei(w)) return fehler('Successfully initialized wpa_supplicant\nrfkill: WLAN soft blocked\nCould not set interface wlp2s0 flags (UP): Operation not possible due to RF-kill\nwlp2s0: Failed to initialize driver interface', 255);
    const bloecke = [...t.matchAll(/network\s*=\s*\{([^}]*)\}/g)].map((m) => ({ ssid: m[1].match(/^\s*ssid\s*=\s*"([^"]*)"/m)?.[1], psk: m[1].match(/^\s*psk\s*=\s*("?)([^"\s]*)\1/m)?.[2], quoted: /^\s*psk\s*=\s*"/m.test(m[1]) }));
    if (!bloecke.length) return fehler(`Successfully initialized wpa_supplicant\nLine 1: no network block found\nFailed to read or parse configuration '${conf}'.`, 255);
    if (!a.includes('-B')) return ok(`Successfully initialized wpa_supplicant\n(Ohne -B bleibt wpa_supplicant im Vordergrund und belegt das Terminal. Im Simulator: mit -B im Hintergrund starten.)`);
    s.wpa = { laeuft: true, datei: conf, ssid: null }; st.ifs.wlp2s0.up = true;
    for (const bl of bloecke) { const x = WLANS.find((y) => y.ssid === bl.ssid); if (!x?.pass || !bl.psk) continue; if ((bl.quoted && bl.psk === x.pass) || (!bl.quoted && bl.psk.toLowerCase() === wpaPsk(x.pass, x.ssid))) { s.wpa.ssid = x.ssid; st.ifs.wlp2s0.kabel = true; break; } }
    w.prozesse.push({ pid: 3911, user: 'root', cmd: `wpa_supplicant -B -i wlp2s0 -c ${conf}`, ppid: 1, tty: '?', stat: 'Ss', start: '09:02', cpu: 0, mem: 0.1 });
    return ok('Successfully initialized wpa_supplicant');
  });
  b.wpa_cli = mit('wpa_cli', (w, a) => {
    const s = nw(w); const x = WLANS.find((y) => y.ssid === s.wpa.ssid); const cmd = a.filter((y) => !y.startsWith('-') && y !== 'wlp2s0')[0] ?? 'status';
    if (!s.wpa.laeuft) return fehler("Failed to connect to non-global ctrl_ifname: wlp2s0  error: No such file or directory", 255);
    if (cmd === 'status') return ok(`Selected interface 'wlp2s0'\n${x ? `bssid=${x.bssid}\nfreq=${x.freq}\nssid=${x.ssid}\nid=0\nmode=station\npairwise_cipher=CCMP\ngroup_cipher=CCMP\nkey_mgmt=WPA2-PSK\nwpa_state=COMPLETED\n` : 'wpa_state=SCANNING\n'}address=${ns(w).ifs.wlp2s0.mac}`);
    if (cmd === 'list_networks') return ok(`Selected interface 'wlp2s0'\nnetwork id / ssid / bssid / flags\n0\t${x?.ssid ?? '(Netz aus der Datei)'}\tany\t${x ? '[CURRENT]' : '[DISABLED]'}`);
    if (cmd === 'terminate') { s.wpa = { laeuft: false, datei: '', ssid: null }; ns(w).ifs.wlp2s0.kabel = false; return ok("Selected interface 'wlp2s0'\nOK"); }
    return ok(`Selected interface 'wlp2s0'\nOK`);
  });
  b.dhclient = mit('dhclient', (w, a, _i, root) => {
    const s = nw(w); const st = ns(w); const v = a.includes('-v'); const freigeben = a.includes('-r');
    if (!(root || w.root)) return fehler("Can't create /var/lib/dhcp/dhclient.leases: Permission denied", 1);
    const devs = a.filter((x) => !x.startsWith('-')); const liste = devs.length ? devs : Object.keys(st.ifs).filter((n) => n !== 'lo' && !st.ifs[n].art);
    const out: string[] = [];
    for (const d of liste) {
      const i = st.ifs[d]; if (!i) return fehler(`Cannot find device "${d}"`, 1);
      if (freigeben) { adrWeg(st, d); st.routes = st.routes.filter((q) => q.dev !== d); delete s.dhcp[d]; if (v) out.push(`Listening on LPF/${d}/${i.mac}\nSending on   LPF/${d}/${i.mac}\nDHCPRELEASE of ${'…'} on ${d} to 192.168.1.1 port 67`); continue; }
      i.up = d === 'wlp2s0' && !wlanFrei(w) ? false : true;
      const lan = ifLan(d, i); const gw = d === 'wlp2s0' ? '192.168.2.1' : d === 'enp0s31f6' ? '192.168.1.1' : undefined;
      const kopf = `Internet Systems Consortium DHCP Client 4.4.3-P1\nCopyright 2004-2022 Internet Systems Consortium.\nAll rights reserved.\nFor info, please visit https://www.isc.org/software/dhcp/\n\nListening on LPF/${d}/${i.mac}\nSending on   LPF/${d}/${i.mac}\nSending on   Socket/fallback\nDHCPDISCOVER on ${d} to 255.255.255.255 port 67 interval 3`;
      if (!i.kabel || !gw || !lan) { if (v || devs.length) return { out: v ? kopf + '\nDHCPDISCOVER on ' + d + ' to 255.255.255.255 port 67 interval 7\nNo DHCPOFFERS received.\nNo working leases in persistent database - sleeping.' : '', err: v ? undefined : undefined, code: 2 }; continue; }
      const ip = d === 'wlp2s0' ? '192.168.2.31/24' : '192.168.1.23/24';
      adrWeg(st, d); adrHinzu(st, d, ip); st.routes = st.routes.filter((q) => !(q.dev === d && q.ziel === 'default'));
      st.routes.unshift({ ziel: 'default', via: gw, dev: d, proto: 'dhcp', src: ip.split('/')[0] }); s.dhcp[d] = true;
      if (d === 'wlp2s0') w.fs['/etc/resolv.conf'] = 'domain lan\nsearch lan\nnameserver 192.168.2.1\n';
      if (v) out.push(`${kopf}\nDHCPOFFER of ${ip.split('/')[0]} from ${gw}\nDHCPREQUEST for ${ip.split('/')[0]} on ${d} to 255.255.255.255 port 67\nDHCPACK of ${ip.split('/')[0]} from ${gw}\nbound to ${ip.split('/')[0]} -- renewal in 41820 seconds.`);
    }
    return ok(out.join('\n'));
  });

  // ----- tcpdump -----
  b.tcpdump = mit('tcpdump', (w, a, _i, root) => {
    if (!hat(w, 'tcpdump')) return fehlt('tcpdump', 'tcpdump');
    const st = ns(w); let dev = 'enp0s31f6'; let anzahl = 0; let n = 0; let e = false; let datei: string | undefined; let lesen: string | undefined; const rest: string[] = [];
    for (let k = 0; k < a.length; k++) {
      const x = a[k];
      if (x === '-i') dev = a[++k]; else if (x.startsWith('-i') && x.length > 2) dev = x.slice(2);
      else if (x === '-c') anzahl = Number(a[++k]); else if (/^-c\d+$/.test(x)) anzahl = Number(x.slice(2));
      else if (x === '-w') datei = a[++k]; else if (x === '-r') lesen = a[++k];
      else if (x === '-D' || x === '--list-interfaces') return ok(['1.enp0s31f6 [Up, Running, Connected]', ...(st.ifs.enp3s0 ? [`2.enp3s0 [Up${st.ifs.enp3s0.up ? ', Running' : ''}, Connected]`] : []), '3.any (Pseudo-device that captures on all interfaces) [Up, Running]', '4.lo [Up, Running, Loopback]', '5.wlp2s0 [Wireless]'].join('\n'));
      else if (/^-[nevqtAXlS]+$/.test(x)) { n += (x.match(/n/g) ?? []).length; if (x.includes('e')) e = true; }
      else rest.push(x);
    }
    const f = filter(w, rest); if (typeof f === 'string') return fehler(`tcpdump: ${f}`, 1);
    if (lesen) {
      const t = w.fs[K.pfad(w, lesen)]; if (typeof t !== 'string') return fehler(`tcpdump: ${lesen}: No such file or directory`, 1);
      const m = t.match(/^\u0007PCAP:(.*)$/s); if (!m) return fehler(`tcpdump: bad dump file format`, 1);
      const p = (JSON.parse(m[1]) as Paket[]).filter(f).slice(0, anzahl || undefined);
      return { out: p.map((x, k) => paketZeile(w, x, { n, e, any: false }, `08:41:${String(Math.floor(x.t + 12)).padStart(2, '0')}.${String(Math.round((x.t % 1) * 1e6)).padStart(6, '0')}`)).join('\n'), err: `reading from file ${lesen}, link-type EN10MB (Ethernet), snapshot length 262144`, code: 0 };
    }
    if (!(root || w.root)) return fehler(`tcpdump: ${dev}: You don't have permission to perform this capture on that device\n(socket: Operation not permitted)`, 1);
    if (dev !== 'any' && !st.ifs[dev]) return fehler(`tcpdump: ${dev}: No such device exists\n(No such device exists)`, 1);
    if (dev !== 'any' && !st.ifs[dev].up) return fehler(`tcpdump: ${dev}: That device is not up`, 1);
    const pakete = verkehr(w, dev).filter(f);
    const zeigen = pakete.slice(0, anzahl || 12);
    const kopf = `tcpdump: verbose output suppressed, use -v[v]... for full protocol decode\nlistening on ${dev}, link-type ${dev === 'any' ? 'LINUX_SLL2 (Linux cooked v2)' : 'EN10MB (Ethernet)'}, snapshot length 262144 bytes`;
    if (datei) {
      const ziel = K.pfad(w, datei); w.fs[ziel] = '\u0007PCAP:' + JSON.stringify(zeigen); const m = meta(w, ziel); m.mode = 0o644; m.owner = w.root || root ? 'tcpdump' : w.user; m.mtime = w.uhr;
      return { out: anzahl ? '' : '(tcpdump schreibt jetzt in die Datei, bis du Strg+C drückst. Im Simulator ist nach einem Moment Schluss.)', err: `tcpdump: listening on ${dev}, link-type EN10MB (Ethernet), snapshot length 262144 bytes\n${zeigen.length} packets captured\n${pakete.length} packets received by filter\n0 packets dropped by kernel`, code: 0 };
    }
    const z = zeigen.map((x) => paketZeile(w, x, { n, e, any: dev === 'any' }, `08:41:${String(Math.floor(x.t + 12)).padStart(2, '0')}.${String(Math.round((x.t % 1) * 1e6)).padStart(6, '0')}`));
    const ende = `${zeigen.length} packets captured\n${pakete.length + (anzahl ? 0 : 3)} packets received by filter\n0 packets dropped by kernel`;
    return { out: z.join('\n') + (anzahl ? '' : `${z.length ? '\n' : ''}^C\n(tcpdump läuft weiter, bis du Strg+C drückst. Mit -c ANZAHL hört es von selbst auf.)`) + `${z.length || !anzahl ? '\n' : ''}${ende}`, err: kopf, code: 0 };
  });

  // ----- mtr -----
  b.mtr = mit('mtr', (w, a) => {
    const n = a.some((x) => /^-\w*n/.test(x)); const ziel = a.filter((x, k) => !x.startsWith('-') && !['-c', '--report-cycles'].includes(a[k - 1])).pop();
    const ci = a.findIndex((x) => x === '-c' || x === '--report-cycles'); const zyklen = ci >= 0 ? Number(a[ci + 1]) : 10;
    if (!ziel) return fehler('mtr: No destination host given', 1);
    const r = aufloesen(w, ziel); if (!r.ip) return fehler(`mtr: Failed to resolve host: ${ziel}: Name or service not known`, 1);
    const wg = weg(w, r.ip); if (wg.art === 'kein-netz') return fehler('mtr: Unable to get raw sockets.\n(Kein Weg ins Netz: Network is unreachable)', 1);
    const hops = wg.art === 'nicht-da' ? [] : wg.hops;
    const zeilen = hops.map((h, k) => ({ name: n ? h : nameVon(h), loss: wg.art !== 'ok' && k === hops.length - 1 && false ? 100 : 0, t: 0.4 + k * 4.6 }));
    if (wg.art !== 'ok') zeilen.push({ name: '???', loss: 100, t: 0 });
    const kopf = `Start: 2026-11-26T09:12:44+0100\nHOST: ${w.host.padEnd(28)}Loss%   Snt   Last   Avg  Best  Wrst StDev`;
    const text = [kopf, ...zeilen.map((z, k) => `  ${String(k + 1).padStart(2)}.|-- ${z.name.padEnd(27)}${z.loss.toFixed(1).padStart(5)}%${String(zyklen).padStart(6)}${(z.loss ? 0 : z.t).toFixed(1).padStart(7)}${(z.loss ? 0 : z.t + 0.1).toFixed(1).padStart(6)}${(z.loss ? 0 : z.t - 0.1).toFixed(1).padStart(6)}${(z.loss ? 0 : z.t + 0.6).toFixed(1).padStart(6)}${(z.loss ? 0 : 0.2).toFixed(1).padStart(6)}`)].join('\n');
    if (a.some((x) => /^-\w*r/.test(x) || x === '--report' || x === '-w' || x === '--report-wide')) return ok(text);
    return ok(`${text}\n(mtr zeigt das sonst als Vollbild und aktualisiert es laufend. Mit --report gibt es den Bericht einmal aus.)`);
  });

  // ----- zweite Karte und Hardware -----
  b.lspci = (w, a, i, r) => { const e = alt.lspci(w, a, i, r); if (!netzwerkAktiv(w) || !nw(w).opt.zweiteKarte || e.code) return e; return { ...e, out: e.out + (a.includes('-k') ? '\n03:00.0 Ethernet controller: Intel Corporation 82574L Gigabit Network Connection\n\tSubsystem: Intel Corporation Gigabit CT Desktop Adapter\n\tKernel driver in use: e1000e\n\tKernel modules: e1000e' : '\n03:00.0 Ethernet controller: Intel Corporation 82574L Gigabit Network Connection') }; };
  b.dmesg = (w, a, i, r) => {
    const e = alt.dmesg(w, a, i, r); if (!netzwerkAktiv(w) || e.code) return e; const s = nw(w); const st = ns(w); const z: string[] = [];
    if (s.opt.zweiteKarte) z.push('[    2.311804] e1000e 0000:03:00.0 eth1: (PCI Express:2.5GT/s:Width x1) 00:1b:21:3a:4f:10', '[    2.311812] e1000e 0000:03:00.0 eth1: Intel(R) PRO/1000 Network Connection', '[    2.402211] e1000e 0000:03:00.0 enp3s0: renamed from eth1');
    if (s.opt.wlan) z.push('[    3.002117] iwlwifi 0000:02:00.0: Detected Intel(R) Wi-Fi 6 AX200 160MHz, REV=0x340', '[    3.410388] iwlwifi 0000:02:00.0: base HW address: a4:c3:f0:5e:91:07', '[    3.512230] rfkill: input handler disabled');
    if (st.ifs.enp3s0?.up) z.push('[ 4102.881240] e1000e 0000:03:00.0 enp3s0: NIC Link is Up 1000 Mbps Full Duplex, Flow Control: Rx/Tx');
    if (s.wpa.ssid) z.push(`[ 4210.004181] wlp2s0: authenticate with ${WLANS.find((x) => x.ssid === s.wpa.ssid)!.bssid}`, `[ 4210.031552] wlp2s0: associated`, '[ 4210.090311] IPv6: ADDRCONF(NETDEV_CHANGE): wlp2s0: link becomes ready');
    return { ...e, out: [e.out, ...z].filter(Boolean).join('\n') };
  };
  // ifup: zusätzliche Zeilen up/post-up ip route add …
  b.ifup = (w, a, i, r) => {
    const e = alt.ifup(w, a, i, r); if (!netzwerkAktiv(w) || e.code) return e;
    const d = a.find((x) => !x.startsWith('-')); const text = w.fs['/etc/network/interfaces'] ?? '';
    const m = text.match(new RegExp(`^iface ${d} inet \\w+\\n((?:[ \\t]+.*\\n?)*)`, 'm'));
    for (const z of m?.[1].split('\n') ?? []) { const t = z.trim().match(/^(?:post-)?up\s+(?:\/s?bin\/|\/usr\/s?bin\/)?ip\s+(.+)$/); if (t) b.ip(w, t[1].split(/\s+/), '', true); }
    return e;
  };
  // Neustart von NetworkManager schreibt resolv.conf aus den aktiven Profilen neu
  b.systemctl = (w, a, i, r) => {
    const e = alt.systemctl(w, a, i, r); if (!netzwerkAktiv(w) || e.code) return e;
    const [cmd, unit] = a.filter((x) => !x.startsWith('-'));
    if (['restart', 'reload', 'start'].includes(cmd) && /^NetworkManager(\.service)?$/.test(unit ?? '')) { if (w.distro === 'alma') ifcfgLaden(w); for (const name of Object.values(ns(w).aktiv)) alt.nmcli(w, ['con', 'up', name], '', true); }
    return e;
  };
  // NetworkManager mit ifcfg-Dateien (Red Hat)
  b.nmcli = (w, a, i, r) => {
    if (!netzwerkAktiv(w)) return alt.nmcli(w, a, i, r);
    const t = a.filter((x) => !x.startsWith('-'));
    if (/^c/.test(t[0] ?? '') && (t[1] === 'reload' || t[1] === 'load')) { if (!(r || w.root)) return fehler('Error: failed to reload connections: Not authorized to reload connections.', 1); ifcfgLaden(w); return ok(); }
    return alt.nmcli(w, a, i, r);
  };
  return b;
}
let K: { pfad: (w: Welt, p: string) => string };
export function netzwerkKern(k: { pfad: (w: Welt, p: string) => string }) { K = k; }

// ---------- Zustand ----------
export function zustandNetzwerk(w: Welt, s: string): boolean | undefined {
  let m;
  if (!/^(neigh|vlan|mtu|label|wlan|rfkill|dhcp|geheim|ifcfg|addr6|forward)[:=~]/.test(s)) return undefined;
  if (!netzwerkAktiv(w)) return false;
  const n = nw(w); const st = ns(w);
  if ((m = s.match(/^neigh:(\S+)=(permanent|weg|ok|falsch)$/))) { const e = n.neigh.find((x) => x.ip === m![1]); if (m[2] === 'weg') return !e; if (m[2] === 'permanent') return e?.nud === 'PERMANENT'; if (m[2] === 'ok') return !!e && e.mac === echteMac(w, m[1]); return !!e && e.mac !== echteMac(w, m[1]); }
  if ((m = s.match(/^vlan:([\w.-]+)=(\d+)$/))) return st.ifs[m[1]]?.vlan?.id === Number(m[2]);
  if ((m = s.match(/^mtu:([\w.-]+)=(\d+)$/))) return (st.ifs[m[1]]?.mtu ?? 1500) === Number(m[2]);
  if ((m = s.match(/^label:(\S+)=(\S+)$/))) return Object.values(st.ifs).some((x) => x.labels?.[m![1]] === m![2]);
  if ((m = s.match(/^wlan:(verbunden|wpa)(?:=(.+))?$/))) return m[1] === 'wpa' ? n.wpa.laeuft : !!n.wpa.ssid && (!m[2] || n.wpa.ssid === m[2]);
  if ((m = s.match(/^rfkill:wlan=(frei|blockiert)$/))) return n.rfkill.wlanSoft === (m[1] === 'blockiert');
  if ((m = s.match(/^dhcp:(\w+)$/))) return !!n.dhcp[m[1]];
  if (s === 'geheim:weg') return !geheimLebt(w);
  if ((m = s.match(/^addr6:([\w.-]+)=(\S+)$/))) return !!st.ifs[m[1]]?.addr6.includes(m[2]);
  if (s === 'forward:an') return (w.fs['/proc/sys/net/ipv4/ip_forward'] ?? '0').trim() === '1';
  if ((m = s.match(/^ifcfg:(\S+?)~(.+)$/))) return new RegExp(m[2], 'm').test(w.fs[`/etc/sysconfig/network-scripts/ifcfg-${m[1]}`] ?? '');
  return undefined;
}
