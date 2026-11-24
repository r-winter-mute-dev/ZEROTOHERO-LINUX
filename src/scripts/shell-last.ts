// Last und Kapazität für den Simulator (LPIC-2 Topic 200): Ein Lastmodell, das CPU, Speicher, Swap,
// Platten-I/O und Netzverkehr aus den laufenden Prozessen berechnet. Dazu uptime, top, htop, free, vmstat,
// iostat, iotop, sar (mit Verlauf), iptraf-ng, iftop, ifstat, pstree, nproc, lscpu, ethtool.
// Ohne Welt-Option `last` bleiben die alten Befehle aus Kampagne 1 unverändert.
import type { Welt, Prozess } from './shell';
import { netzExtraSockets, type Sock } from './shell-netz';

type Ergebnis = { out: string; err?: string; code: number };
type B = (w: Welt, a: string[], stdin: string, root: boolean) => Ergebnis;
const ok = (out = ''): Ergebnis => ({ out, code: 0 });
const fehler = (err: string, code = 1): Ergebnis => ({ out: '', err, code });

export interface LastKern { datum: (w: Welt, ms: number, fmt?: string) => string; dialog: (w: Welt, prompt: string, weiter: (z: string) => string) => void; rechte: (w: Welt, p: string, mode: number, owner: string, group: string) => void }
let K: LastKern;
export function lastKern(k: LastKern) { K = k; }

// ---------- Modell ----------

/** Was ein Prozess zur Last beiträgt. cpu in % eines Kerns, rss in KiB, io in kB/s, netz in kB/s. */
interface Beitrag { pid: number; cpu?: number; rss?: number; lesen?: number; schreiben?: number; platte?: string; senden?: number; empfangen?: number; nif?: string; gegen?: string; blockiert?: boolean; dienst?: string; leck?: boolean }
export type Szenario = 'ruhig' | 'cpu' | 'speicher' | 'platte' | 'netz' | 'montag' | 'router';
export interface LastOptionen { szenario: Szenario; sysstat?: 'fehlt' | 'aus' | 'an' }
interface Platte { dev: string; maxMB: number; ssd: boolean }
interface LastStand {
  szenario: Szenario; cpus: number; ramKiB: number; swapKiB: number;
  beitraege: Beitrag[]; platten: Platte[]; ifs: { name: string; mbit: number }[];
  last15: number; last5: number; seitStart: number;  // Verlauf für load average
  sysstat: 'fehlt' | 'aus' | 'an'; leckStart: number; sammeltSeit: number;   // 0 = Verlauf liegt schon vor
}
const BASIS_RSS = 1_850_000;   // KiB, Kernel und Grunddienste
export function ls(w: Welt): LastStand | null { return (w as Welt & { lastmodell?: LastStand }).lastmodell ?? null; }

const SERVER: Prozess[] = [
  { pid: 1, user: 'root', cmd: '/sbin/init', ppid: 0, cpu: 0, mem: 0.1, vsz: 168000, rss: 12800, tty: '?', stat: 'Ss', start: 'Nov20', zeit: '00:00:09' },
  { pid: 2, user: 'root', cmd: '[kthreadd]', ppid: 0, tty: '?', stat: 'S', start: 'Nov20' },
  { pid: 61, user: 'root', cmd: '[kswapd0]', ppid: 2, tty: '?', stat: 'S', start: 'Nov20' },
  { pid: 388, user: 'root', cmd: '/lib/systemd/systemd-journald', ppid: 1, cpu: 0, mem: 0.3, vsz: 49000, rss: 24000, tty: '?', stat: 'Ss', start: 'Nov20' },
  { pid: 402, user: 'root', cmd: '/lib/systemd/systemd-udevd', ppid: 1, mem: 0.1, vsz: 26000, rss: 7000, tty: '?', stat: 'Ss', start: 'Nov20' },
  { pid: 610, user: 'root', cmd: '/usr/sbin/cron -f', ppid: 1, mem: 0, vsz: 6600, rss: 2700, tty: '?', stat: 'Ss', start: 'Nov20' },
  { pid: 615, user: 'root', cmd: '/usr/sbin/rsyslogd -n -iNONE', ppid: 1, mem: 0.1, vsz: 222000, rss: 5800, tty: '?', stat: 'Ssl', start: 'Nov20' },
  { pid: 690, user: '_chrony', cmd: '/usr/sbin/chronyd -F 1', ppid: 1, mem: 0, vsz: 18900, rss: 3200, tty: '?', stat: 'S', start: 'Nov20' },
  { pid: 812, user: 'root', cmd: 'sshd: /usr/sbin/sshd -D [listener] 0 of 10-100 startups', ppid: 1, mem: 0.1, vsz: 15400, rss: 9100, tty: '?', stat: 'Ss', start: 'Nov20' },
  { pid: 905, user: 'root', cmd: 'nginx: master process /usr/sbin/nginx', ppid: 1, mem: 0.1, vsz: 10600, rss: 2100, tty: '?', stat: 'Ss', start: 'Nov20' },
  { pid: 906, user: 'www-data', cmd: 'nginx: worker process', ppid: 905, cpu: 0.2, mem: 0.1, vsz: 11200, rss: 5200, tty: '?', stat: 'S', start: 'Nov20' },
  { pid: 1020, user: 'postgres', cmd: '/usr/lib/postgresql/15/bin/postgres -D /var/lib/postgresql/15/main', ppid: 1, cpu: 0.3, mem: 1.4, vsz: 218000, rss: 112000, tty: '?', stat: 'Ss', start: 'Nov20' },
  { pid: 3301, user: 'root', cmd: 'sshd: lena [priv]', ppid: 812, mem: 0.1, vsz: 17800, rss: 10800, tty: '?', stat: 'Ss', start: '08:02' },
  { pid: 3305, user: 'lena', cmd: 'sshd: lena@pts/0', ppid: 3301, mem: 0, vsz: 18000, rss: 6600, tty: '?', stat: 'S', start: '08:02' },
  { pid: 3306, user: 'lena', cmd: '-bash', ppid: 3305, mem: 0.1, vsz: 8600, rss: 5200, tty: 'pts/0', stat: 'Ss', start: '08:02' },
];

interface Szene { prozesse: Prozess[]; beitraege: Beitrag[]; last15: number; last5: number }
function szene(s: Szenario, w: Welt): Szene {
  const P = (p: Prozess): Prozess => ({ tty: '?', start: '06:10', ...p });
  switch (s) {
    case 'cpu': return {
      prozesse: [P({ pid: 4120, user: 'mess', cmd: '/opt/messd/bin/auswerten --jahr 2026 --threads 4', ppid: 1, cpu: 389.4, mem: 3.0, vsz: 982000, rss: 240000, stat: 'Rl', zeit: '10:01:12', start: '06:10' })],
      beitraege: [{ pid: 4120, cpu: 389, rss: 240000, lesen: 120, platte: 'sda' }], last15: 3.6, last5: 4.1,
    };
    case 'speicher': return {
      prozesse: [P({ pid: 2870, user: 'mess', cmd: 'java -Xmx12g -jar /opt/messd/messd.jar', ppid: 1, cpu: 31.2, mem: 76.8, vsz: 14200000, rss: 6290000, stat: 'Sl', zeit: '06:52:03', start: 'Nov21' })],
      beitraege: [{ pid: 2870, cpu: 31, rss: 6290000, dienst: 'messd', leck: true }], last15: 1.8, last5: 2.4,
    };
    case 'platte': return {
      prozesse: [
        P({ pid: 4410, user: 'root', cmd: 'rsync -a --delete /srv/daten/ /mnt/backup/daten/', ppid: 4402, cpu: 9.8, mem: 0.5, vsz: 41000, rss: 38000, stat: 'D', zeit: '00:18:20', start: '02:00' }),
        P({ pid: 4402, user: 'root', cmd: '/bin/sh /usr/local/sbin/sicherung', ppid: 1, mem: 0, vsz: 2600, rss: 900, stat: 'S', start: '02:00' }),
        P({ pid: 4415, user: 'root', cmd: 'rsync -a --delete /srv/daten/ /mnt/backup/daten/', ppid: 4410, cpu: 4.1, mem: 0.3, vsz: 41000, rss: 22000, stat: 'D', zeit: '00:06:01', start: '02:00' }),
        P({ pid: 1022, user: 'postgres', cmd: 'postgres: 15/main: checkpointer', ppid: 1020, cpu: 0.4, mem: 0.6, vsz: 218000, rss: 48000, stat: 'Ds', start: 'Nov20' }),
      ],
      beitraege: [{ pid: 4410, cpu: 10, rss: 38000, lesen: 58000, schreiben: 4000, platte: 'sda', blockiert: true, dienst: 'sicherung' }, { pid: 4415, cpu: 4, rss: 22000, schreiben: 61000, platte: 'sdb', blockiert: true, dienst: 'sicherung' }, { pid: 1022, rss: 48000, schreiben: 1800, platte: 'sda', blockiert: true }],
      last15: 4.6, last5: 4.9,
    };
    case 'netz': return {
      prozesse: [
        P({ pid: 5120, user: 'www-data', cmd: 'nginx: worker process', ppid: 905, cpu: 6.2, mem: 0.1, vsz: 11800, rss: 6100, stat: 'S', start: 'Nov20' }),
        P({ pid: 5240, user: 'root', cmd: 'rsync -a /srv/daten/ backup@192.168.50.30:/sicherung/srv1/', ppid: 1, cpu: 12.4, mem: 0.4, vsz: 43000, rss: 31000, stat: 'S', zeit: '00:04:12', start: '08:30' }),
        P({ pid: 5241, user: 'root', cmd: 'ssh -l backup 192.168.50.30 rsync --server -logDtpre.iLsfxCIvu . /sicherung/srv1/', ppid: 5240, cpu: 22.1, mem: 0.1, vsz: 18000, rss: 9000, stat: 'S', start: '08:30' }),
      ],
      beitraege: [
        { pid: 5241, cpu: 22, rss: 9000, senden: 84000, empfangen: 900, nif: 'enp0s8', gegen: '192.168.50.30:22', dienst: 'nachtsicherung' },
        { pid: 5240, cpu: 12, rss: 31000, lesen: 82000, platte: 'nvme0n1' },
        { pid: 5120, cpu: 6, senden: 31000, empfangen: 450, nif: 'enp0s8', gegen: '192.168.50.20:50414' },
      ],
      last15: 0.7, last5: 0.8,
    };
    case 'montag': return {
      prozesse: [
        ...szene('platte', w).prozesse,
        P({ pid: 2870, user: 'mess', cmd: 'java -Xmx12g -jar /opt/messd/messd.jar', ppid: 1, cpu: 28.5, mem: 74.1, vsz: 14200000, rss: 6070000, stat: 'Sl', zeit: '06:28:41', start: 'Nov21' }),
      ],
      beitraege: [...szene('platte', w).beitraege, { pid: 2870, cpu: 28, rss: 6070000, dienst: 'messd', leck: true }],
      last15: 5.1, last5: 5.6,
    };
    case 'router': return {
      prozesse: [],
      beitraege: [{ pid: 0, senden: 0, empfangen: 0 }], last15: 0.4, last5: 0.5,
    };
    default: return { prozesse: [], beitraege: [], last15: 0.18, last5: 0.21 };
  }
}

function modellOhneSzenario(w: Welt) {
  (w as Welt & { lastmodell?: LastStand }).lastmodell = { szenario: 'ruhig', cpus: 8, ramKiB: 16_303_428, swapKiB: 2_000_892, beitraege: [], last15: 0.4, last5: 0.61, seitStart: 0, platten: [{ dev: 'nvme0n1', maxMB: 1800, ssd: true }], ifs: [{ name: 'enp0s31f6', mbit: 1000 }], sysstat: 'fehlt', leckStart: w.uhr, sammeltSeit: 0 };
}
/** Fehlt nach apt install noch die echte Konfiguration von sysstat, wird sie jetzt angelegt. */
export function sysstatPruefen(w: Welt) {
  if (!('/usr/bin/sar' in w.fs)) return;
  if (!ls(w)) modellOhneSzenario(w);
  const st = ls(w)!;
  if (!/^ENABLED=/m.test(w.fs['/etc/default/sysstat'] ?? '')) sysstatInstallieren(w, false);
  else st.sysstat = /^ENABLED="true"/m.test(w.fs['/etc/default/sysstat'] ?? '') && st.sysstat === 'an' ? 'an' : st.sysstat === 'fehlt' ? 'aus' : st.sysstat;
}
export function lastStarten(w: Welt, o: LastOptionen) {
  const s = szene(o.szenario, w);
  const router = o.szenario === 'router';
  const st: LastStand = {
    szenario: o.szenario, cpus: router ? 2 : 4, ramKiB: router ? 2_000_000 : 8_148_000, swapKiB: 2_097_148,
    beitraege: s.beitraege, last15: s.last15, last5: s.last5, seitStart: 0,
    platten: router ? [{ dev: 'sda', maxMB: 400, ssd: true }] : [{ dev: 'sda', maxMB: 62, ssd: false }, { dev: 'sdb', maxMB: 64, ssd: false }, { dev: 'nvme0n1', maxMB: 1800, ssd: true }],
    ifs: router ? [{ name: 'enp0s3', mbit: 1000 }, { name: 'enp0s8', mbit: 1000 }] : [{ name: 'enp0s3', mbit: 1000 }, { name: 'enp0s8', mbit: 1000 }],
    sysstat: o.sysstat ?? 'fehlt', leckStart: w.uhr - 3 * 86400000, sammeltSeit: 0,
  };
  (w as Welt & { lastmodell?: LastStand }).lastmodell = st;
  w.prozesse = [...SERVER.map((p) => ({ ...p })), ...s.prozesse];
  if (router) w.prozesse = w.prozesse.filter((p) => ![905, 906, 1020].includes(p.pid));
  if (st.sysstat !== 'fehlt') sysstatInstallieren(w, st.sysstat === 'an');
  for (const d of ['/srv', '/srv/daten', '/mnt/backup', '/mnt/backup/daten', '/opt/messd', '/usr/local/sbin']) if (!(d in w.fs)) w.fs[d] = null;
  w.fs['/usr/local/sbin/sicherung'] = '#!/bin/sh\n# Nächtliche Sicherung, gestartet von sicherung.timer um 02:00\nrsync -a --delete /srv/daten/ /mnt/backup/daten/\n';
  w.fs['/var/log/kapazitaet'] = null;
  w.fs['/var/log/kapazitaet/srv-daten.csv'] = KAPAZITAET;
  K.rechte(w, '/var/log/kapazitaet', 0o755, 'root', 'root'); K.rechte(w, '/var/log/kapazitaet/srv-daten.csv', 0o644, 'root', 'root');
}
/** Monatliche Belegung von /srv/daten (GiB) auf einer 2-TiB-Platte (1863 GiB nutzbar). */
const KAPAZITAET = 'monat;belegt_gib\n2025-12;1012\n2026-01;1048\n2026-02;1081\n2026-03;1119\n2026-04;1152\n2026-05;1190\n2026-06;1221\n2026-07;1258\n2026-08;1293\n2026-09;1327\n2026-10;1366\n2026-11;1399\n';

function sysstatInstallieren(w: Welt, an: boolean) {
  w.fs['/etc/default/sysstat'] = `#\n# Default settings for /etc/init.d/sysstat, /etc/cron.d/sysstat\n# and /etc/cron.daily/sysstat files\n#\n\n# Should sadc collect system activity informations? Valid values\n# are "true" and "false". Please do not put other values, they\n# will be overwritten by debconf!\nENABLED="${an ? 'true' : 'false'}"\n`;
  w.fs['/etc/sysstat'] = null;
  w.fs['/etc/sysstat/sysstat'] = '# sysstat configuration file. See sysstat(5) manual page.\n\n# How long to keep log files (in days).\n# Used by sa2(8) script\n# If value is greater than 28, then use sadc\'s option -D to prevent older\n# data files from being overwritten. See sadc(8) and sysstat(5) manual pages.\nHISTORY=7\n\n# Compress (using xz, gzip or bzip2) sa and sar files older than (in days):\nCOMPRESSAFTER=10\n\n# Parameters for the system activity data collector (see sadc(8) manual page)\n# which are used for the generation of log files.\n# By default contains the `-S DISK\' option responsible for generating disk\n# statisitcs. Use `-S XALL\' to collect all available statistics.\nSADC_OPTIONS="-S DISK"\n';
  w.fs['/var/log/sysstat'] = null; K.rechte(w, '/var/log/sysstat', 0o755, 'root', 'root');
  for (const n of ['sar', 'iostat', 'mpstat', 'pidstat', 'sadf']) w.fs[`/usr/bin/${n}`] = '\u0007BIN:' + (40000 + n.length * 911);
  if (an) for (let k = 0; k < 7; k++) { const d = new Date(w.uhr - k * 86400000); w.fs[`/var/log/sysstat/sa${String(d.getDate()).padStart(2, '0')}`] = '\u0007BIN:' + (400000 + k * 1111); }
  const x = w as Welt & { lastmodell?: LastStand }; if (x.lastmodell) x.lastmodell.sysstat = an ? 'an' : 'aus';
}

interface Werte {
  busy: number; us: number; sy: number; ni: number; id: number; wa: number; st: number;
  memUsed: number; memFree: number; buff: number; cache: number; avail: number; swapUsed: number; si: number; so: number;
  bi: number; bo: number; r: number; b: number; inter: number; cs: number;
  platten: { dev: string; rkB: number; wkB: number; rs: number; ws: number; util: number; await: number; aqu: number }[];
  netz: { name: string; rx: number; tx: number; rxp: number; txp: number }[];
  load: [number, number, number];
}
function aktiv(w: Welt): Beitrag[] { const st = ls(w)!; return st.beitraege.filter((b) => b.pid === 0 || w.prozesse.some((p) => p.pid === b.pid && !p.weg)); }
function werte(w: Welt, jitter = 0): Werte {
  const st = ls(w)!; const bs = aktiv(w);
  const j = (x: number, f = 0.04) => x * (1 + Math.sin(jitter * 2.3 + x) * f * (jitter ? 1 : 0));
  // Platten zuerst, weil I/O-Wartezeit die CPU-Anzeige beeinflusst
  const platten = st.platten.map((pl) => {
    const rkB = j(bs.filter((b) => b.platte === pl.dev).reduce((s, b) => s + (b.lesen ?? 0), pl.dev === 'nvme0n1' ? 40 : 12));
    const wkB = j(bs.filter((b) => b.platte === pl.dev || (b.schreiben && !b.platte && pl.dev === 'sda')).reduce((s, b) => s + (b.platte === pl.dev ? b.schreiben ?? 0 : 0), pl.dev === 'nvme0n1' ? 90 : 35));
    const mb = (rkB + wkB) / 1024; const util = Math.min(99.8, (mb / pl.maxMB) * 100 + (pl.ssd ? 0.3 : 1.2));
    const awaitMs = pl.ssd ? 0.3 + util / 60 : util > 90 ? 120 + (util - 90) * 12 : 4 + util / 6;
    const rs = rkB / (pl.ssd ? 16 : 128) + 0.4; const ws = wkB / (pl.ssd ? 24 : 256) + 1.1;
    return { dev: pl.dev, rkB, wkB, rs, ws, util, await: awaitMs, aqu: ((rs + ws) * awaitMs) / 1000 };
  });
  const blockiert = bs.filter((b) => b.blockiert && (platten.find((p) => p.dev === b.platte)?.util ?? 0) > 70).length;
  const ioDruck = Math.max(0, ...platten.map((p) => p.util)) / 100;
  // Speicher
  const rss = bs.reduce((s, b) => s + (b.rss ?? 0), 0) + BASIS_RSS - 1_600_000 * (st.szenario === 'router' ? 1 : 0);
  const ueber = Math.max(0, rss - st.ramKiB * 0.94);
  const swapUsed = Math.min(st.swapKiB, Math.round(ueber * 1.05 + (bs.some((b) => b.leck) ? 0 : 0)));
  const memUsed = Math.min(st.ramKiB * 0.95, rss);
  const cache = Math.max(90_000, st.ramKiB - memUsed - 120_000 - (ueber ? st.ramKiB * 0.03 : 900_000)) * (ueber ? 0.3 : 1);
  const buff = ueber ? 4_100 : 182_344;
  const memFree = Math.max(62_000, st.ramKiB - memUsed - cache - buff);
  const avail = memFree + cache * 0.7;
  const swapDruck = ueber > 0 ? Math.min(1, ueber / 1_500_000) : 0;
  const si = Math.round(j(swapDruck * 2400)); const so = Math.round(j(swapDruck * 3100));
  // CPU
  const cpuSum = bs.reduce((s, b) => s + (b.cpu ?? 0), 0) + 3 + swapDruck * 25;
  const busy = Math.min(st.cpus * 100, cpuSum) / st.cpus;
  const wa = Math.min(100 - busy, ioDruck > 0.8 ? 38 + blockiert * 4 : ioDruck * 6 + swapDruck * 14);
  const sy = Math.min(busy, 1.2 + swapDruck * 6 + ioDruck * 3 + (bs.some((b) => b.senden && b.senden > 50000) ? 6 : 0));
  const us = Math.max(0, busy - sy); const ni = 0; const id = Math.max(0, 100 - busy - wa);
  const r = Math.round(Math.min(cpuSum / 100, st.cpus * 2)) + (cpuSum > 50 ? 1 : 0);
  const b = blockiert + (swapDruck > 0.3 ? 1 : 0);
  const netz = st.ifs.map((i) => {
    let tx = bs.filter((x) => x.nif === i.name).reduce((s, x) => s + (x.senden ?? 0), 0);
    let rx = bs.filter((x) => x.nif === i.name).reduce((s, x) => s + (x.empfangen ?? 0), 0);
    if (st.szenario === 'router') { const fluss = 94_000; if (i.name === 'enp0s3') { tx = 3_100; rx = fluss; } else { tx = fluss * 0.995; rx = 3_100; } }
    tx = j(tx + 1.2); rx = j(rx + 2.4);
    return { name: i.name, rx, tx, rxp: rx / 1.4 + 3, txp: tx / 1.45 + 2 };
  });
  const ursacheDa = bs.some((x) => (x.cpu ?? 0) > 20 || x.blockiert || x.leck);
  const jetzt = Math.max(busy * st.cpus / 100 + blockiert + swapDruck * 2, ursacheDa ? st.last5 * 1.02 : 0);
  const bo = platten.reduce((s, p) => s + p.wkB, 0) + so; const bi = platten.reduce((s, p) => s + p.rkB, 0) + si;
  return {
    busy, us, sy, ni, id, wa, st: 0, memUsed, memFree, buff, cache, avail, swapUsed, si, so, bi, bo, r, b,
    inter: Math.round(180 + bi / 40 + bo / 40 + netz.reduce((s, n) => s + n.rxp + n.txp, 0) / 8), cs: Math.round(320 + r * 140 + b * 60 + netz.reduce((s, n) => s + n.txp, 0) / 20),
    platten, netz, load: [Math.max(0.02, jetzt), st.last5, st.last15],
  };
}
const k = (x: number, n = 2) => x.toFixed(n).replace('.', ',');
const uhrzeit = (w: Welt) => new Date(w.uhr + 3600000).toISOString().slice(11, 19);
const datumDE = (w: Welt, plus = 0) => { const d = new Date(w.uhr + 3600000 + plus * 86400000); return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`; };
function lastText(w: Welt) { const v = werte(w); return `load average: ${k(v.load[0])}, ${k(v.load[1])}, ${k(v.load[2])}`; }
const UP = ' up 3 days,  2:51';

// ---------- Verlauf für sar ----------

interface Stunde { ifs: { name: string; rx: number; tx: number }[]; h: string; us: number; sy: number; wa: number; id: number; memPct: number; memUsed: number; tps: number; rkB: number; wkB: number; rxkB: number; txkB: number; q: number; l1: number; swpPct: number }
function verlauf(w: Welt, tagZurueck: number): Stunde[] {
  const st = ls(w)!; const s = st.szenario;
  const stunden = tagZurueck === 0 ? Number(uhrzeit(w).slice(0, 2)) + 1 : 24;
  const out: Stunde[] = [];
  for (let h = 0; h < stunden; h++) {
    const backup = (s === 'platte' || s === 'montag') ? (h >= 2 && (tagZurueck > 0 ? h < 5 : true)) : h >= 2 && h < 4;
    const arbeit = h >= 8 && h < 18;
    const leck = s === 'speicher' || s === 'montag';
    // Speicherleck: heute früh fast voll, seit dem Neustart von messd vor drei Tagen um etwa 0,73 % pro Stunde gewachsen
    const stundenZurueck = tagZurueck * 24 + Number(uhrzeit(w).slice(0, 2)) - h;
    let memPct = 24 + (arbeit ? 4 : 0);
    if (leck) memPct = Math.max(memPct, Math.min(94.5, 94.5 - stundenZurueck * 0.73));
    memPct = Math.min(96.8, memPct);
    const swpPct = memPct > 92 ? (memPct - 92) * 14 : 0;
    const cpuLast = s === 'cpu' && tagZurueck === 0 && h >= 6 ? 96 : arbeit ? 18 + (h % 3) * 2 : 3;
    const wa = backup ? 41 : leck && swpPct > 20 ? 9 : 0.4;
    const us = Math.min(100 - wa - 1, cpuLast); const sy = 1.1 + (backup ? 3 : 0);
    const netz = s === 'netz' && tagZurueck === 0 && h >= 8 ? 84000 : backup && s !== 'platte' && s !== 'montag' ? 70000 : arbeit ? 2400 : 90;
    const ifs = st.szenario === 'router'
      ? [{ name: 'lo', rx: 0.4, tx: 0.4 }, { name: 'enp0s3', rx: arbeit ? 71000 + (h % 4) * 6000 : 900, tx: arbeit ? 3100 : 60 }, { name: 'enp0s8', rx: arbeit ? 3100 : 60, tx: arbeit ? 70600 + (h % 4) * 6000 : 890 }]
      : [{ name: 'lo', rx: 0.4, tx: 0.4 }, { name: 'enp0s3', rx: 40, tx: 30 }, { name: 'enp0s8', rx: arbeit ? 2600 : 40, tx: netz }];
    out.push({ ifs, h: `${String(h).padStart(2, '0')}:00:01`, us, sy, wa, id: Math.max(0, 100 - us - sy - wa), memPct, memUsed: Math.round(st.ramKiB * memPct / 100), tps: backup ? 690 : arbeit ? 42 : 6, rkB: backup ? 58000 : arbeit ? 900 : 30, wkB: backup ? 63000 : arbeit ? 1500 : 80, rxkB: arbeit ? 2600 : 40, txkB: netz, q: backup ? 5 : s === 'cpu' && h >= 6 && tagZurueck === 0 ? 4 : arbeit ? 1 : 0, l1: backup ? 4.8 : s === 'cpu' && h >= 6 && tagZurueck === 0 ? 4.2 : arbeit ? 0.9 : 0.1, swpPct });
  }
  return out;
}

// ---------- Befehle ----------

export function lastBefehle(alt: Record<string, B>): Record<string, B> {
  const b: Record<string, B> = {};
  // Befehle, die es schon gab, bleiben ohne Lastszenario wie in Kampagne 1. Neue Befehle bekommen dann ein ruhiges Modell.
  const mit = (name: string, f: B): B => (w, a, i, r) => { if (ls(w)) return f(w, a, i, r); if (alt[name]) return alt[name](w, a, i, r); modellOhneSzenario(w); return f(w, a, i, r); };
  const installiert = (w: Welt, n: string) => `/usr/bin/${n}` in w.fs || `/usr/sbin/${n}` in w.fs;
  const fehlt = (n: string, paket: string) => fehler(`bash: ${n}: Befehl nicht gefunden\n(${n} gehört zum Paket ${paket}: sudo apt install ${paket})`, 127);

  b.uptime = mit('uptime', (w, a) => a.includes('-p') ? ok('up 3 days, 2 hours, 51 minutes') : ok(` ${uhrzeit(w)}${UP},  1 user,  ${lastText(w)}`));
  // Auf dem Server ist nur lena per SSH angemeldet
  b.who = (w, a, i, r) => (ls(w)?.szenario && ls(w)!.szenario !== 'ruhig' && !a.length ? ok('lena     pts/0        2026-11-23 08:02 (192.168.50.20)') : alt.who(w, a, i, r));
  b.w = (w, a, i, r) => {
    const st = ls(w);
    if (!st || st.szenario === 'ruhig') { const x = alt.w(w, a, i, r); return a.includes('-h') ? x : { ...x, out: x.out.replace(/^.*\n/, (alt.uptime(w, [], i, r).out + '\n')) }; }
    return ok(`${a.includes('-h') ? '' : ` ${uhrzeit(w)}${UP},  1 user,  ${lastText(w)}\nUSER     TTY      FROM             LOGIN@   IDLE   JCPU   PCPU WHAT\n`}lena     pts/0    192.168.50.20    08:02    0.00s  0.08s  0.00s w`);
  };
  b.nproc = (w) => ok(String(ls(w)?.cpus ?? 8));
  b.lscpu = (w) => { const n = ls(w)?.cpus ?? 8; return ok(`Architektur:                     x86_64\n  CPU Operationsmodus:           32-bit, 64-bit\n  Adressgrößen:                  39 bits physical, 48 bits virtual\n  Byte-Reihenfolge:              Little Endian\nCPU(s):                          ${n}\n  Liste der Online-CPU(s):       0-${n - 1}\nAnbieterkennung:                 GenuineIntel\n  Modellname:                    Intel(R) Xeon(R) E-2224 CPU @ 3.40GHz\n    Thread(s) pro Kern:          1\n    Kern(e) pro Sockel:          ${n}\n    Sockel:                      1`); };
  b.free = mit('free', (w, a) => {
    const st = ls(w)!; const v = werte(w); const h = a.some((x) => /^-\w*h/.test(x) || x === '--human'); const m = a.some((x) => /^-\w*m/.test(x));
    const f = (x: number) => h ? (x >= 1_048_576 ? `${k(x / 1_048_576, 1)}Gi` : `${Math.round(x / 1024)}Mi`) : String(Math.round(m ? x / 1024 : x));
    const z = [st.ramKiB, v.memUsed, v.memFree, 52_000, v.buff + v.cache, v.avail].map(f);
    const s = [st.swapKiB, v.swapUsed, st.swapKiB - v.swapUsed].map(f);
    return ok(`               total        used        free      shared  buff/cache   available\nMem:   ${z.map((x) => x.padStart(12)).join('')}\nSwap:  ${s.map((x) => x.padStart(12)).join('')}${a.includes('-t') ? `\nTotal: ${[st.ramKiB + st.swapKiB, v.memUsed + v.swapUsed, v.memFree + st.swapKiB - v.swapUsed].map(f).map((x) => x.padStart(12)).join('')}` : ''}`);
  });
  b.swapon = mit('swapon', (w, a, i, r) => { const st = ls(w)!; if (!a.includes('--show') && !a.includes('-s')) return alt.swapon(w, a, i, r); const v = werte(w); const g = (x: number) => (x >= 1_048_576 ? `${k(x / 1_048_576, 1)}G` : `${Math.round(x / 1024)}M`); return ok(`NAME      TYPE      SIZE  USED PRIO\n/dev/sda3 partition   ${g(st.swapKiB)} ${g(v.swapUsed).padStart(5)}   -2`); });
  const prozessZeilen = (w: Welt, n: number) => {
    const st = ls(w)!; const bs = aktiv(w);
    const ps = w.prozesse.filter((p) => !p.weg).map((p) => { const bt = bs.find((x) => x.pid === p.pid); return { p, cpu: bt?.cpu ?? p.cpu ?? 0, rss: bt?.rss ?? p.rss ?? 4000 }; });
    if (werte(w).si > 0) { const ks = ps.find((x) => x.p.pid === 61); if (ks) ks.cpu = 18.4; }
    return ps.sort((x, y) => y.cpu - x.cpu || y.rss - x.rss).slice(0, n).map(({ p, cpu, rss }) => `${String(p.pid).padStart(7)} ${p.user.slice(0, 8).padEnd(9)} ${p.cmd.startsWith('[') ? ' rt' : String(20 + (p.ni ?? 0)).padStart(3)} ${String(p.ni ?? 0).padStart(3)} ${String(p.vsz ?? 12000).padStart(8)} ${String(rss).padStart(7)} ${String(Math.round(rss * 0.2)).padStart(6)} ${(p.stat ?? 'S')[0]} ${cpu.toFixed(1).padStart(5)} ${((rss / st.ramKiB) * 100).toFixed(1).padStart(5)} ${(() => { const t = (p.zeit ?? '00:00:00').split(':').map(Number); return `${t[0] * 60 + t[1]}:${String(t[2] ?? 0).padStart(2, '0')}.${String((p.pid * 7) % 100).padStart(2, '0')}`; })().padStart(9)} ${p.cmd.replace(/^\/\S*\//, '').split(' ')[0].replace(/:$/, '')}`);
  };
  b.top = mit('top', (w, a) => {
    const st = ls(w)!; const v = werte(w); const batch = a.some((x) => x.includes('b'));
    const lauf = v.r; const n = w.prozesse.filter((p) => !p.weg).length + 96;
    const mi = (x: number) => (x / 1024).toFixed(1).replace('.', ',');
    const kopf = `top - ${uhrzeit(w)}${UP},  1 user,  ${lastText(w)}\nTasks: ${n} total,   ${lauf} running, ${n - lauf - v.b} sleeping,   0 stopped,   0 zombie\n%Cpu(s): ${k(v.us, 1).padStart(4)} us, ${k(v.sy, 1).padStart(4)} sy, ${k(v.ni, 1)} ni, ${k(v.id, 1).padStart(4)} id, ${k(v.wa, 1).padStart(4)} wa,  0,0 hi,  ${k(0.1 + v.busy / 200, 1)} si,  0,0 st\nMiB Mem : ${mi(st.ramKiB).padStart(8)} total, ${mi(v.memFree).padStart(8)} free, ${mi(v.memUsed).padStart(8)} used, ${mi(v.buff + v.cache).padStart(8)} buff/cache\nMiB Swap: ${mi(st.swapKiB).padStart(8)} total, ${mi(st.swapKiB - v.swapUsed).padStart(8)} free, ${mi(v.swapUsed).padStart(8)} used. ${mi(v.avail).padStart(8)} avail Mem\n\n    PID USER      PR  NI     VIRT     RES    SHR S  %CPU  %MEM     TIME+ COMMAND`;
    if (!batch) (w as Welt & { langlaeufer: string | null }).langlaeufer = 'top';
    return ok(`${kopf}\n${prozessZeilen(w, 12).join('\n')}${batch ? '' : '\n(top aktualisiert sich alle 3 Sekunden. 1 zeigt jeden Kern einzeln, M sortiert nach Speicher, P nach CPU, q beendet. Im Simulator: Strg+C.)'}`);
  });
  b.htop = mit('htop', (w) => {
    if (!installiert(w, 'htop')) return fehlt('htop', 'htop');
    const st = ls(w)!; const v = werte(w);
    const balken = (pct: number, breite = 25) => '|'.repeat(Math.round((pct / 100) * breite)).padEnd(breite);
    const kerne = Array.from({ length: st.cpus }, (_, i) => `  ${i}[${balken(Math.min(100, v.busy + v.wa * 0.3 + Math.sin(i * 1.7) * 3))}${k(Math.min(100, v.busy + Math.sin(i * 1.7) * 3), 1).padStart(6)}%]`);
    const g = (x: number) => `${k(x / 1_048_576, 2)}G`;
    (w as Welt & { langlaeufer: string | null }).langlaeufer = 'htop';
    return ok(`${kerne.join('   ')}\n  Mem[${balken((v.memUsed / st.ramKiB) * 100, 35)}${g(v.memUsed)}/${g(st.ramKiB)}]   Tasks: ${w.prozesse.length + 80}, 112 thr; ${v.r} running\n  Swp[${balken((v.swapUsed / st.swapKiB) * 100, 35)}${g(v.swapUsed)}/${g(st.swapKiB)}]   Load average: ${v.load.map((x) => k(x)).join(' ')}\n                                                Uptime: 3 days, 02:51:12\n\n    PID USER      PRI  NI   VIRT    RES    SHR S CPU% MEM%   TIME+  Command\n${prozessZeilen(w, 10).join('\n')}\nF1Help  F2Setup F3Search F4Filter F5Tree  F6SortBy F7Nice -F8Nice +F9Kill  F10Quit\n(htop ist interaktiv: Pfeiltasten wählen einen Prozess, F9 beendet ihn, F10 beendet htop. Im Simulator: Strg+C.)`);
  });
  b.vmstat = mit('vmstat', (w, a) => {
    const st = ls(w)!; const zahlen = a.filter((x) => /^\d+$/.test(x)).map(Number);
    const mb = a.includes('-S') && /^[mM]$/.test(a[a.indexOf('-S') + 1] ?? ''); const wide = a.includes('-w');
    if (a.includes('-s')) { const v = werte(w); return ok([`${String(st.ramKiB).padStart(13)} K total memory`, `${String(Math.round(v.memUsed)).padStart(13)} K used memory`, `${String(Math.round(v.cache)).padStart(13)} K active memory`, `${String(Math.round(v.memFree)).padStart(13)} K free memory`, `${String(st.swapKiB).padStart(13)} K total swap`, `${String(v.swapUsed).padStart(13)} K used swap`, `${String(st.swapKiB - v.swapUsed).padStart(13)} K free swap`].join('\n')); }
    if (a.includes('-d')) { const v = werte(w); return ok(`disk- ------------reads------------ ------------writes----------- -----IO------\n       total merged sectors      ms  total merged sectors      ms    cur    sec\n${v.platten.map((p) => `${p.dev.padEnd(7)}${String(Math.round(p.rs * 91000)).padStart(6)} ${String(Math.round(p.rs * 300)).padStart(6)} ${String(Math.round(p.rkB * 2 * 26000)).padStart(9)} ${String(Math.round(p.rs * 91000 * p.await)).padStart(8)} ${String(Math.round(p.ws * 91000)).padStart(6)} ${String(Math.round(p.ws * 400)).padStart(6)} ${String(Math.round(p.wkB * 2 * 26000)).padStart(9)} ${String(Math.round(p.ws * 91000 * p.await)).padStart(8)} ${String(Math.round(p.aqu)).padStart(6)} ${String(Math.round(p.util * 2400)).padStart(6)}`).join('\n')}`); }
    const [delay, count0] = zahlen; const count = delay ? count0 ?? 3 : 1;
    const zeile = (v: Werte, seitBoot: boolean) => {
      const div = mb ? 1024 : 1; const f = (x: number, n: number) => String(Math.round(x / div)).padStart(n);
      const sb = seitBoot ? 0.08 : 1; // erste Zeile: Mittelwerte seit dem Start
      const c = seitBoot ? { us: 4, sy: 1, id: 94, wa: 1 } : { us: Math.round(v.us), sy: Math.round(v.sy), id: Math.round(v.id), wa: Math.round(v.wa) };
      return `${String(seitBoot ? Math.min(v.r, 1) : v.r).padStart(2)} ${String(seitBoot ? 0 : v.b).padStart(2)} ${f(v.swapUsed, wide ? 12 : 6)} ${f(v.memFree, wide ? 12 : 6)} ${f(v.buff, wide ? 12 : 6)} ${f(v.cache, wide ? 12 : 6)} ${String(Math.round(v.si * sb)).padStart(4)} ${String(Math.round(v.so * sb)).padStart(4)} ${String(Math.round(v.bi * sb)).padStart(5)} ${String(Math.round(v.bo * sb)).padStart(5)} ${String(Math.round(v.inter * (seitBoot ? 0.6 : 1))).padStart(4)} ${String(Math.round(v.cs * (seitBoot ? 0.6 : 1))).padStart(4)} ${String(c.us).padStart(2)} ${String(c.sy).padStart(2)} ${String(c.id).padStart(2)} ${String(c.wa).padStart(2)}  0`;
    };
    const kopf = `procs -----------memory---------- ---swap-- -----io---- -system-- ------cpu-----\n r  b   swpd   free   buff  cache   si   so    bi    bo   in   cs us sy id wa st`;
    const zeilen = [zeile(werte(w), true), ...Array.from({ length: count - 1 }, (_, i) => zeile(werte(w, i + 1), false))];
    return ok(`${kopf}\n${zeilen.join('\n')}${!delay ? '\n(Ohne Intervall zeigt vmstat nur eine Zeile: Mittelwerte seit dem Start. Für aktuelle Werte: vmstat 1 5)' : ''}`);
  });
  const kopfSysstat = (w: Welt) => `Linux 6.1.0-27-amd64 (${w.host}) \t${datumDE(w)} \t_x86_64_\t(${ls(w)!.cpus} CPU)`;
  b.iostat = mit('iostat', (w, a) => {
    if (!installiert(w, 'iostat')) return fehlt('iostat', 'sysstat');
    const x = a.some((y) => /^-\w*x/.test(y)); const nurD = a.some((y) => /^-\w*d/.test(y)); const nurC = a.some((y) => /^-\w*c/.test(y)); const m = a.some((y) => /^-\w*m/.test(y));
    const zahlen = a.filter((y) => /^\d+$/.test(y)).map(Number); const devs = a.filter((y) => /^(sd[a-z]|nvme\d+n\d+)$/.test(y));
    const [delay, count0] = zahlen; const count = delay ? count0 ?? 2 : 1;
    const bericht = (v: Werte, seitBoot: boolean) => {
      const f = seitBoot ? 0.09 : 1; const out: string[] = [];
      if (!nurD) out.push(`avg-cpu:  %user   %nice %system %iowait  %steal   %idle\n${k(seitBoot ? 4.2 : v.us).padStart(14)} ${k(0.01).padStart(7)} ${k(seitBoot ? 1.1 : v.sy).padStart(7)} ${k(seitBoot ? 0.9 : v.wa).padStart(7)} ${k(0).padStart(7)} ${k(seitBoot ? 93.8 : v.id).padStart(7)}\n`);
      if (!nurC) {
        const ps = v.platten.filter((p) => !devs.length || devs.includes(p.dev)); const u = m ? 'MB' : 'kB'; const d = m ? 1024 : 1;
        if (x) out.push(`Device            r/s     r${u}/s   rrqm/s  %rrqm r_await rareq-sz     w/s     w${u}/s   wrqm/s  %wrqm w_await wareq-sz     d/s     d${u}/s   drqm/s  %drqm d_await dareq-sz     f/s f_await  aqu-sz  %util\n${ps.map((p) => `${p.dev.padEnd(12)} ${k(p.rs * f).padStart(7)} ${k(p.rkB * f / d).padStart(9)} ${k(p.rs * 0.2 * f).padStart(8)} ${k(8.1).padStart(6)} ${k(seitBoot ? 3.1 : p.await).padStart(7)} ${k(p.rkB / Math.max(p.rs, 0.01)).padStart(8)} ${k(p.ws * f).padStart(7)} ${k(p.wkB * f / d).padStart(9)} ${k(p.ws * 0.6 * f).padStart(8)} ${k(31.4).padStart(6)} ${k(seitBoot ? 6.2 : p.await * 1.2).padStart(7)} ${k(p.wkB / Math.max(p.ws, 0.01)).padStart(8)} ${k(0).padStart(7)} ${k(0).padStart(9)} ${k(0).padStart(8)} ${k(0).padStart(6)} ${k(0).padStart(7)} ${k(0).padStart(8)} ${k(0.4).padStart(7)} ${k(1.2).padStart(7)} ${k(seitBoot ? 0.02 : p.aqu).padStart(7)} ${k(seitBoot ? Math.min(p.util, 3.1) : p.util).padStart(6)}`).join('\n')}\n`);
        else out.push(`Device             tps    ${u}_read/s    ${u}_wrtn/s    ${u}_dscd/s    ${u}_read    ${u}_wrtn    ${u}_dscd\n${ps.map((p) => `${p.dev.padEnd(12)} ${k((p.rs + p.ws) * f).padStart(9)} ${k(p.rkB * f / d).padStart(12)} ${k(p.wkB * f / d).padStart(12)} ${k(0).padStart(12)} ${String(Math.round(p.rkB * 21600 / d)).padStart(10)} ${String(Math.round(p.wkB * 21600 / d)).padStart(10)} ${'0'.padStart(10)}`).join('\n')}\n`);
      }
      return out.join('\n');
    };
    const teile = [bericht(werte(w), true), ...Array.from({ length: count - 1 }, (_, i) => bericht(werte(w, i + 1), false))];
    return ok(`${kopfSysstat(w)}\n\n${teile.join('\n')}${!delay ? '(Ohne Intervall: Mittelwerte seit dem Start. Für aktuelle Werte: iostat -x 1 2, und dann den zweiten Bericht lesen.)' : ''}`);
  });
  b.iotop = mit('iotop', (w, a, _i, root) => {
    if (!installiert(w, 'iotop')) return fehlt('iotop', 'iotop');
    if (!(root || w.root)) return fehler('Netlink error: Operation not permitted (1)\n\nThe Linux kernel interfaces that iotop relies on now require root priviliges\nor the NET_ADMIN capability. This change occurred because a security issue\n(CVE-2011-2494) was found that allows leak of sensitive data across user\nboundaries.\n\nIf you require the ability to run iotop as a non-root user, please configure\nsudo to allow you to run iotop as root.\n\nPlease do not file bugs on iotop about this.');
    const bs = aktiv(w); const nurAktiv = a.some((x) => /^-\w*o/.test(x)) || a.includes('--only'); const batch = a.some((x) => /^-\w*b/.test(x));
    const mb = (kb: number) => (kb >= 1024 ? `${(kb / 1024).toFixed(2)} M/s` : `${kb.toFixed(2)} K/s`);
    const lese = bs.reduce((s, x) => s + (x.lesen ?? 0), 0); const schreib = bs.reduce((s, x) => s + (x.schreiben ?? 0), 0);
    const zeilen = w.prozesse.filter((p) => !p.weg).map((p) => { const bt = bs.find((x) => x.pid === p.pid); const l = bt?.lesen ?? 0; const s = bt?.schreiben ?? 0; const io = bt?.blockiert ? 96 - (p.pid % 7) : l + s > 0 ? 4.1 : 0; return { p, l, s, io }; }).filter((z) => !nurAktiv || z.l + z.s > 0 || z.io > 0).sort((x, y) => y.io - x.io || y.l + y.s - x.l - x.s).slice(0, 12);
    if (!batch) (w as Welt & { langlaeufer: string | null }).langlaeufer = 'iotop';
    return ok(`Total DISK READ:     ${mb(lese).padStart(12)} | Total DISK WRITE:     ${mb(schreib).padStart(12)}\nCurrent DISK READ:   ${mb(lese * 0.98).padStart(12)} | Current DISK WRITE:   ${mb(schreib * 1.04).padStart(12)}\n    TID  PRIO  USER     DISK READ  DISK WRITE  SWAPIN     IO>    COMMAND\n${zeilen.map((z) => `${String(z.p.pid).padStart(7)} be/4 ${z.p.user.slice(0, 8).padEnd(8)} ${mb(z.l).padStart(11)} ${mb(z.s).padStart(11)}  0.00 % ${z.io.toFixed(2).padStart(6)} % ${z.p.cmd}`).join('\n')}${batch ? '' : '\n(iotop aktualisiert sich jede Sekunde. o zeigt nur Prozesse mit I/O, q beendet. Im Simulator: Strg+C. Mit -b -n 1 gibt iotop einen Bericht aus und endet.)'}`);
  });
  b.pstree = (w, a) => {
    const lebend = w.prozesse.filter((p) => !p.weg);
    const zeigPid = a.some((x) => /^-\w*p/.test(x)); const zeigArg = a.some((x) => /^-\w*a/.test(x));
    const name = (p: Prozess) => { const c = p.cmd.replace(/^\[|\]$/g, ''); let n = c.startsWith('-') ? c.slice(1).split(' ')[0] : c.startsWith('sshd:') ? 'sshd' : c.startsWith('nginx:') ? 'nginx' : c.startsWith('postgres:') ? 'postgres' : c.split(' ')[0].split('/').pop()!; if (p.pid === 1) n = 'systemd'; return `${n}${zeigPid ? `(${p.pid})` : ''}${zeigArg && c.includes(' ') && p.pid !== 1 ? ' ' + c.split(' ').slice(1).join(' ') : ''}`; };
    const start = a.find((x) => /^\d+$/.test(x)); const wurzel = start ? lebend.find((p) => p.pid === Number(start)) : lebend.find((p) => p.pid === 1);
    if (!wurzel) return { out: '', code: 1 };
    const kinder = (pid: number) => lebend.filter((p) => (p.ppid ?? 1) === pid && p.pid !== pid && !(p.pid === 2 || p.ppid === 2 || p.cmd.startsWith('[')));
    if (zeigArg) {
      // pstree -a: eine Zeile pro Prozess, PID mit Komma, Argumente dahinter
      const z: string[] = [];
      const nameA = (p: Prozess) => { const c = p.cmd.replace(/^\[|\]$/g, ''); const n = p.pid === 1 ? 'systemd' : c.startsWith('-') ? c.slice(1).split(' ')[0] : c.startsWith('sshd:') ? 'sshd' : c.startsWith('nginx:') ? 'nginx' : c.startsWith('postgres:') ? 'postgres' : c.split(' ')[0].split('/').pop()!; const args = p.pid === 1 || /^(sshd|nginx|postgres):/.test(c) ? '' : c.split(' ').slice(1).join(' '); return `${n}${zeigPid ? ',' + p.pid : ''}${args ? ' ' + args : ''}`; };
      const geh = (p: Prozess, einr: string) => { const ks = kinder(p.pid); ks.forEach((kd, i) => { const letzt = i === ks.length - 1; z.push(`${einr}${letzt ? '└─' : '├─'}${nameA(kd)}`); geh(kd, einr + (letzt ? '    ' : '│   ')); }); };
      z.push(nameA(wurzel)); geh(wurzel, '  ');
      return ok(z.join('\n'));
    }
    const zeilen: string[] = [];
    const baum = (p: Prozess, praefix: string, erster: boolean) => {
      const n = name(p); const ks = kinder(p.pid);
      const kopf = praefix + n;
      if (!ks.length) { zeilen.push(kopf); return; }
      ks.forEach((kd, i) => {
        const conn = ks.length === 1 ? '───' : i === 0 ? '─┬─' : i === ks.length - 1 ? ' └─' : ' ├─';
        const linkerRand = i === 0 ? kopf + conn : ' '.repeat(kopf.length) + conn;
        const weiterPraefix = ' '.repeat(kopf.length) + (ks.length === 1 ? '   ' : i === ks.length - 1 ? '   ' : ' │ ');
        const vorher = zeilen.length; baum(kd, '', false);
        const neu = zeilen.splice(vorher);
        zeilen.push(linkerRand + neu[0], ...neu.slice(1).map((z) => weiterPraefix + z));
      });
      void erster;
    };
    baum(wurzel, '', true);
    return ok(zeilen.join('\n'));
  };
  b.ethtool = (w, a, _i, root) => {
    const d = a.find((x) => !x.startsWith('-')); if (!d) return fehler('ethtool: bad command line argument(s)\nFor more information run ethtool -h');
    const mbit = ls(w)?.ifs.find((i) => i.name === d)?.mbit ?? 1000;
    return ok(`Settings for ${d}:\n\tSupported ports: [ TP ]\n\tSupported link modes:   10baseT/Half 10baseT/Full\n\t                        100baseT/Half 100baseT/Full\n\t                        1000baseT/Full\n\tSpeed: ${mbit}Mb/s\n\tDuplex: Full\n\tAuto-negotiation: on\n\tPort: Twisted Pair\n${root || w.root ? '\tWake-on: d\n' : ''}\tLink detected: yes`);
  };
  b.iftop = mit('iftop', (w, a, _i, root) => {
    if (!installiert(w, 'iftop')) return fehlt('iftop', 'iftop');
    if (!(root || w.root)) return fehler('interface: enp0s8\npcap_open_live(enp0s8): enp0s8: You don\'t have permission to capture on that device (socket: Operation not permitted)');
    const st = ls(w)!; const ii = a.indexOf('-i'); const ifn = ii >= 0 ? a[ii + 1] : st.ifs[1]?.name ?? 'enp0s8'; const text = a.includes('-t');
    const bs = aktiv(w).filter((x) => x.nif === ifn && x.gegen);
    const eigen = st.szenario === 'router' ? '203.0.113.7' : '192.168.50.10';
    const ratenText = (kB: number) => { const bit = kB * 8 * 1024; return bit >= 1e6 ? `${(bit / 1e6).toFixed(1)}Mb` : `${(bit / 1e3).toFixed(1)}Kb`; };
    const paare = st.szenario === 'router' ? [{ von: a.includes('-n') ? '198.51.100.44' : 'cdn.example.net', nach: '192.168.50.20', tx: 90000, rx: 1400 }, { von: a.includes('-n') ? '203.0.113.80' : 'www.example.org', nach: '192.168.50.21', tx: 3200, rx: 120 }] : bs.map((x) => ({ von: eigen, nach: a.includes('-n') ? x.gegen!.split(':')[0] : x.gegen!.startsWith('192.168.50.30') ? 'backup.lab.example.org' : x.gegen!.startsWith('192.168.50.20') ? 'client1.lab.example.org' : x.gegen!.split(':')[0], tx: x.senden ?? 0, rx: x.empfangen ?? 0, port: a.includes('-P') ? ':' + x.gegen!.split(':')[1] : '' }));
    const zeilen = paare.sort((x, y) => y.tx - x.tx).map((p, i) => `${String(i + 1).padStart(4)} ${(p.von + ('port' in p ? (p as { port: string }).port ? ':ssh' : '' : '')).padEnd(42)} =>  ${ratenText(p.tx).padStart(9)} ${ratenText(p.tx).padStart(9)} ${ratenText(p.tx * 0.97).padStart(9)} ${`${(p.tx * 120 / 1024).toFixed(1)}MB`.padStart(10)}\n     ${(p.nach + ('port' in p ? (p as { port: string }).port : '')).padEnd(42)} <=  ${ratenText(p.rx).padStart(9)} ${ratenText(p.rx).padStart(9)} ${ratenText(p.rx).padStart(9)} ${`${(p.rx * 120).toFixed(0)}KB`.padStart(10)}`);
    const tx = paare.reduce((s, p) => s + p.tx, 0); const rx = paare.reduce((s, p) => s + p.rx, 0);
    const body = `   # Host name (port/service if enabled)            last 2s   last 10s   last 40s cumulative\n--------------------------------------------------------------------------------------------\n${zeilen.join('\n')}\n--------------------------------------------------------------------------------------------\nTotal send rate:                                     ${ratenText(tx).padStart(9)} ${ratenText(tx).padStart(9)} ${ratenText(tx).padStart(9)}\nTotal receive rate:                                  ${ratenText(rx).padStart(9)} ${ratenText(rx).padStart(9)} ${ratenText(rx).padStart(9)}\nTotal send and receive rate:                         ${ratenText(tx + rx).padStart(9)} ${ratenText(tx + rx).padStart(9)} ${ratenText(tx + rx).padStart(9)}\n--------------------------------------------------------------------------------------------\nPeak rate (sent/received/total):                     ${ratenText(tx * 1.02)} ${ratenText(rx * 1.1)} ${ratenText((tx + rx) * 1.02)}\nCumulative (sent/received/total):                    ${(tx * 120 / 1024).toFixed(1)}MB ${(rx * 120 / 1024).toFixed(1)}MB ${((tx + rx) * 120 / 1024).toFixed(1)}MB\n============================================================================================`;
    if (!text) (w as Welt & { langlaeufer: string | null }).langlaeufer = 'iftop';
    return ok(`interface: ${ifn}\nIP address is: ${eigen}\nMAC address is: 08:00:27:5e:2a:1c\n${text ? 'Listening on ' + ifn + '\n' : ''}${body}${text ? '' : '\n(iftop ist interaktiv: n schaltet Namen ab, p zeigt Ports, q beendet. Im Simulator: Strg+C. Für reinen Text: iftop -t -s 10)'}`);
  });
  b.ifstat = mit('ifstat', (w, a) => {
    if (!installiert(w, 'ifstat')) return fehlt('ifstat', 'ifstat');
    const st = ls(w)!; const ii = a.indexOf('-i'); const nur = ii >= 0 ? a[ii + 1].split(',') : st.ifs.map((i) => i.name);
    const zahlen = a.filter((x, k2) => /^\d+(\.\d+)?$/.test(x) && a[k2 - 1] !== '-i').map(Number); const anzahl = zahlen[1] ?? 3;
    const kopf = nur.map((n) => n.padStart(14).padEnd(20)).join('');
    const zeilen = Array.from({ length: anzahl }, (_, z) => { const v = werte(w, z + 1); return nur.map((n) => { const i = v.netz.find((x) => x.name === n); return `${(i?.rx ?? 0).toFixed(2).padStart(9)} ${(i?.tx ?? 0).toFixed(2).padStart(9)} `; }).join(' '); });
    return ok(`${kopf}\n${nur.map(() => ' KB/s in  KB/s out').join('  ')}\n${zeilen.join('\n')}`);
  });
  b['iptraf-ng'] = mit('iptraf-ng', (w, a, _i, root) => {
    if (!installiert(w, 'iptraf-ng')) return fehlt('iptraf-ng', 'iptraf-ng');
    if (!(root || w.root)) return fehler('iptraf-ng: This program can be run only by the system administrator');
    const st = ls(w)!; const di = a.indexOf('-d'); const ii = a.indexOf('-i');
    const v = werte(w);
    if (di >= 0) { const n = a[di + 1] ?? st.ifs[0].name; const i = v.netz.find((x) => x.name === n); return ok(`┌ Statistics for ${n} ──────────────────────────────────────────┐\n│               Total      Total    Incoming   Incoming    Outgoing   Outgoing\n│             Packets      Bytes     Packets      Bytes     Packets      Bytes\n│ Total:     ${String(Math.round((i!.rxp + i!.txp) * 60)).padStart(8)} ${String(Math.round((i!.rx + i!.tx) * 60 * 1024)).padStart(10)} ${String(Math.round(i!.rxp * 60)).padStart(10)} ${String(Math.round(i!.rx * 61440)).padStart(10)} ${String(Math.round(i!.txp * 60)).padStart(10)} ${String(Math.round(i!.tx * 61440)).padStart(10)}\n│ IPv4:      (wie Total)\n│\n│ Total rates:      ${((i!.rx + i!.tx) * 8.192).toFixed(1).padStart(10)} kbps     Broadcast packets:  12\n│                   ${String(Math.round(i!.rxp + i!.txp)).padStart(10)} pps      Broadcast bytes:  1440\n│ Incoming rates:   ${(i!.rx * 8.192).toFixed(1).padStart(10)} kbps\n│ Outgoing rates:   ${(i!.tx * 8.192).toFixed(1).padStart(10)} kbps\n└ Elapsed time:   0:01 ─────────────────────────────────────────────┘\n(iptraf-ng ist ein Vollbildprogramm. x beendet. Im Simulator siehst du einen Schnappschuss.)`); }
    const ifn = ii >= 0 ? a[ii + 1] : 'all'; const bs = aktiv(w).filter((x) => x.gegen && (ifn === 'all' || x.nif === ifn));
    if (ii < 0 && !a.includes('-g')) return ok('┌ iptraf-ng 1.2.1 ──────────────────────┐\n│ IP traffic monitor                    │\n│ General interface statistics          │\n│ Detailed interface statistics         │\n│ Statistical breakdowns...             │\n│ LAN station monitor                   │\n│ Filters...                            │\n│ Configure...                          │\n│ Exit                                  │\n└───────────────────────────────────────┘\n(Das Hauptmenü. Direkt starten: iptraf-ng -i enp0s8 für den IP traffic monitor, -d enp0s8 für Details einer Schnittstelle, -g für die Übersicht aller Schnittstellen.)');
    if (a.includes('-g')) return ok(`┌ iptraf-ng ── General interface statistics ─────────────────────┐\n│ Iface        Total      IPv4      IPv6     NonIP    BadIP   Activity\n${v.netz.map((i) => `│ ${i.name.padEnd(10)} ${String(Math.round((i.rxp + i.txp) * 60)).padStart(8)} ${String(Math.round((i.rxp + i.txp) * 60)).padStart(9)} ${'0'.padStart(9)} ${'0'.padStart(9)} ${'0'.padStart(8)} ${((i.rx + i.tx) * 8.192).toFixed(2).padStart(10)} kbps`).join('\n')}\n│ lo               84        84         0         0        0       0.42 kbps\n└──────────────────────────────────────────────────────────────────┘\n(Schnappschuss. x beendet iptraf-ng.)`);
    return ok(`┌ TCP Connections (Source Host:Port) ─────────────── Packets ── Bytes ── Flag ─ Iface ─┐\n${bs.map((x) => `│┌192.168.50.10:${x.gegen!.startsWith('192.168.50.30') ? '43712' : '80'}            >  ${String(Math.round((x.senden ?? 0) * 0.7 * 60)).padStart(9)} ${String(Math.round((x.senden ?? 0) * 61440)).padStart(12)}  -PA-  ${x.nif}\n│└${x.gegen!.padEnd(20)}  >  ${String(Math.round((x.empfangen ?? 0) * 2 * 60)).padStart(9)} ${String(Math.round((x.empfangen ?? 0) * 61440)).padStart(12)}  --A-  ${x.nif}`).join('\n') || '│ (keine TCP-Verbindungen)'}\n├ TCP: ${bs.length} entries ─────────────────────────────────────────────── Active ─┤\n│ UDP (96 bytes) from 192.168.50.1:67 to 255.255.255.255:68 on ${ifn === 'all' ? 'enp0s8' : ifn}\n└ Packets captured: ${Math.round(v.netz.reduce((s, i) => s + i.rxp + i.txp, 0) * 60)} ── TCP flow rate: ${(bs.reduce((s, x) => s + (x.senden ?? 0), 0) * 8.192).toFixed(2)} kbps ─┘\n(iptraf-ng ist ein Vollbildprogramm. Mit den Pfeiltasten wählst du eine Verbindung, x beendet. Im Simulator siehst du einen Schnappschuss.)`);
  });
  b.sar = mit('sar', (w, a) => {
    if (!installiert(w, 'sar')) return fehlt('sar', 'sysstat');
    sysstatPruefen(w);
    const st = ls(w)!; const zahlen = a.filter((x, k2) => /^\d+$/.test(x) && !['-f', '-s', '-e', '-n', '-P'].includes(a[k2 - 1])).map(Number);
    const fi = a.indexOf('-f'); let tag = 0;
    if (fi >= 0) { const f = a[fi + 1] ?? ''; const m = f.match(/sa(\d\d)$/); if (!m || !(f in w.fs)) return fehler(`${f} kann nicht geöffnet werden: Datei oder Verzeichnis nicht gefunden`, 2); tag = Math.round((new Date(w.uhr).getDate() - Number(m[1]) + 31) % 31); }
    const live = zahlen.length > 0 && fi < 0;
    if (!live && st.sysstat !== 'an') return fehler(`/var/log/sysstat/sa${String(new Date(w.uhr).getDate()).padStart(2, '0')} kann nicht geöffnet werden: Datei oder Verzeichnis nicht gefunden\nBitte prüfen Sie, ob die Datensammlung aktiviert ist`, 2);
    if (!live && !(`/var/log/sysstat/sa${String(new Date(w.uhr - tag * 86400000).getDate()).padStart(2, '0')}` in w.fs)) return fehler('Datei kann nicht geöffnet werden: Datei oder Verzeichnis nicht gefunden', 2);
    const si = a.indexOf('-s'); const ei = a.indexOf('-e'); const von = si >= 0 ? a[si + 1] : '00:00'; const bis = ei >= 0 ? a[ei + 1] : '23:59';
    const ni = a.indexOf('-n'); const netzArt = ni >= 0 ? a[ni + 1] : undefined;
    const art = a.includes('-r') ? 'r' : a.includes('-b') ? 'b' : a.includes('-d') ? 'd' : netzArt ? 'n' : a.includes('-q') ? 'q' : a.includes('-S') ? 'S' : a.includes('-W') ? 'W' : 'u';
    let reihen: Stunde[];
    if (live) { const [iv, n = 1] = zahlen; const v = werte(w); reihen = Array.from({ length: n }, (_, i) => { const vv = werte(w, i + 1); const t = new Date(w.uhr + 3600000 + (i + 1) * iv * 1000).toISOString().slice(11, 19); return { ifs: [{ name: 'lo', rx: 0.4, tx: 0.4 }, ...vv.netz.map((n) => ({ name: n.name, rx: n.rx, tx: n.tx }))], h: t, us: vv.us, sy: vv.sy, wa: vv.wa, id: vv.id, memPct: (vv.memUsed / st.ramKiB) * 100, memUsed: vv.memUsed, tps: vv.platten.reduce((s, p) => s + p.rs + p.ws, 0), rkB: vv.bi, wkB: vv.bo, rxkB: vv.netz[1]?.rx ?? 0, txkB: vv.netz[1]?.tx ?? 0, q: vv.r, l1: vv.load[0], swpPct: (vv.swapUsed / st.swapKiB) * 100 }; }); void v; }
    else reihen = verlauf(w, tag).filter((r) => r.h.slice(0, 5) >= von && r.h.slice(0, 5) <= bis && !st.sammeltSeit);   // frisch eingeschaltet: noch kein Verlauf
    if (!live && st.sammeltSeit && !reihen.length) return ok(`${kopfSysstat(w)}\n\n(Noch keine Messwerte. Der Sammler sadc schreibt erst ab jetzt alle 10 Minuten einen Eintrag. Einen Verlauf gibt es erst, wenn er eine Weile gelaufen ist. Für Messungen jetzt: sar ${art === 'u' ? '' : '-' + art + ' '}1 5)`);
    const mittel = (f: (r: Stunde) => number) => reihen.reduce((s, r) => s + f(r), 0) / Math.max(1, reihen.length);
    const kopf = `${kopfSysstat(w).replace(datumDE(w), datumDE(w, -tag))}\n`;
    const z = (h: string) => h.padEnd(11);
    let tab = '';
    if (art === 'u') tab = `${z('')}     CPU     %user     %nice   %system   %iowait    %steal     %idle\n${reihen.map((r) => `${z(r.h)}     all ${k(r.us).padStart(9)} ${k(0).padStart(9)} ${k(r.sy).padStart(9)} ${k(r.wa).padStart(9)} ${k(0).padStart(9)} ${k(r.id).padStart(9)}`).join('\n')}\n${z('Durchschnitt:')}     all ${k(mittel((r) => r.us)).padStart(9)} ${k(0).padStart(9)} ${k(mittel((r) => r.sy)).padStart(9)} ${k(mittel((r) => r.wa)).padStart(9)} ${k(0).padStart(9)} ${k(mittel((r) => r.id)).padStart(9)}`;
    if (art === 'r') tab = `${z('')} kbmemfree   kbavail kbmemused  %memused kbbuffers  kbcached  kbcommit   %commit  kbactive   kbinact   kbdirty\n${reihen.map((r) => `${z(r.h)} ${String(Math.max(60000, st.ramKiB - r.memUsed - 900000)).padStart(9)} ${String(Math.max(90000, st.ramKiB - r.memUsed)).padStart(9)} ${String(r.memUsed).padStart(9)} ${k(r.memPct).padStart(9)} ${'182344'.padStart(9)} ${String(Math.round(Math.max(80000, 3200000 - r.memUsed / 3))).padStart(9)} ${String(Math.round(r.memUsed * 1.3)).padStart(9)} ${k(r.memPct * 1.1).padStart(9)} ${String(Math.round(r.memUsed * 0.8)).padStart(9)} ${'612000'.padStart(9)} ${'220'.padStart(9)}`).join('\n')}\n${z('Durchschnitt:')} ${String(Math.round(st.ramKiB - mittel((r) => r.memUsed) - 900000)).padStart(9)} ${String(Math.round(st.ramKiB - mittel((r) => r.memUsed))).padStart(9)} ${String(Math.round(mittel((r) => r.memUsed))).padStart(9)} ${k(mittel((r) => r.memPct)).padStart(9)}`;
    if (art === 'S') tab = `${z('')} kbswpfree kbswpused  %swpused  kbswpcad   %swpcad\n${reihen.map((r) => `${z(r.h)} ${String(Math.round(st.swapKiB * (1 - r.swpPct / 100))).padStart(9)} ${String(Math.round(st.swapKiB * r.swpPct / 100)).padStart(9)} ${k(r.swpPct).padStart(9)} ${'0'.padStart(9)} ${k(0).padStart(9)}`).join('\n')}`;
    if (art === 'W') tab = `${z('')}  pswpin/s pswpout/s\n${reihen.map((r) => `${z(r.h)} ${k(r.swpPct * 9).padStart(9)} ${k(r.swpPct * 12).padStart(9)}`).join('\n')}`;
    if (art === 'b') tab = `${z('')}       tps      rtps      wtps      dtps   bread/s   bwrtn/s   bdscd/s\n${reihen.map((r) => `${z(r.h)} ${k(r.tps).padStart(9)} ${k(r.tps * 0.46).padStart(9)} ${k(r.tps * 0.54).padStart(9)} ${k(0).padStart(9)} ${k(r.rkB * 2).padStart(9)} ${k(r.wkB * 2).padStart(9)} ${k(0).padStart(9)}`).join('\n')}\n${z('Durchschnitt:')} ${k(mittel((r) => r.tps)).padStart(9)}`;
    if (art === 'd') tab = `${z('')}       DEV       tps     rkB/s     wkB/s     dkB/s   areq-sz    aqu-sz     await     %util\n${reihen.map((r) => `${z(r.h)} ${'sda'.padStart(9)} ${k(r.tps * 0.6).padStart(9)} ${k(r.rkB).padStart(9)} ${k(r.wkB * 0.1).padStart(9)} ${k(0).padStart(9)} ${k(64).padStart(9)} ${k(r.tps > 100 ? 18 : 0.1).padStart(9)} ${k(r.tps > 100 ? 140 : 4.2).padStart(9)} ${k(Math.min(99.6, r.rkB / 1640 + 0.4)).padStart(9)}\n${z(r.h)} ${'sdb'.padStart(9)} ${k(r.tps * 0.4).padStart(9)} ${k(0).padStart(9)} ${k(r.wkB * 0.9).padStart(9)} ${k(0).padStart(9)} ${k(256).padStart(9)} ${k(r.tps > 100 ? 21 : 0).padStart(9)} ${k(r.tps > 100 ? 190 : 0).padStart(9)} ${k(Math.min(99.8, r.wkB / 1540)).padStart(9)}`).join('\n')}`;
    if (art === 'q') tab = `${z('')}   runq-sz  plist-sz   ldavg-1   ldavg-5  ldavg-15   blocked\n${reihen.map((r) => `${z(r.h)} ${String(r.q).padStart(9)} ${'312'.padStart(9)} ${k(r.l1).padStart(9)} ${k(r.l1 * 0.92).padStart(9)} ${k(r.l1 * 0.8).padStart(9)} ${String(r.wa > 30 ? 3 : 0).padStart(9)}`).join('\n')}`;
    if (art === 'n') {
      if (netzArt !== 'DEV') return fehler(`(Im Simulator nur sar -n DEV.)`);
      tab = `${z('')}     IFACE   rxpck/s   txpck/s    rxkB/s    txkB/s   rxcmp/s   txcmp/s  rxmcst/s   %ifutil\n${reihen.map((r) => r.ifs.map(({ name: n, rx, tx }) => `${z(r.h)} ${String(n).padStart(9)} ${k((rx as number) / 1.4 + 1).padStart(9)} ${k((tx as number) / 1.45 + 1).padStart(9)} ${k(rx as number).padStart(9)} ${k(tx as number).padStart(9)} ${k(0).padStart(9)} ${k(0).padStart(9)} ${k(0).padStart(9)} ${k(n === 'lo' ? 0 : Math.max(rx as number, tx as number) / 1250).padStart(9)}`).join('\n')).join('\n')}`;
    }
    return ok(`${kopf}\n${tab}`);
  });
  b.sadf = mit('sadf', (w, a) => {
    if (!installiert(w, 'sadf')) return fehlt('sadf', 'sysstat');
    const st = ls(w)!; if (st.sysstat !== 'an') return fehler('Bitte prüfen Sie, ob die Datensammlung aktiviert ist', 2);
    const reihen = verlauf(w, 0); const d = a.includes('-d');
    if (!d) return ok('(Im Simulator: sadf -d -- -r gibt die Speicherwerte als CSV mit Semikolon aus, zum Beispiel für ein Diagramm in einer Tabellenkalkulation.)');
    return ok(`# hostname;interval;timestamp;kbmemfree;kbavail;kbmemused;%memused\n${reihen.map((r) => `${w.host};3600;${new Date(w.uhr).toISOString().slice(0, 10)} ${r.h.slice(0, 5)}:01 UTC;${Math.max(60000, st.ramKiB - r.memUsed - 900000)};${st.ramKiB - r.memUsed};${r.memUsed};${r.memPct.toFixed(2)}`).join('\n')}`);
  });
  return b;
}

/** systemctl für die Dienste der Lastszenarien und für sysstat. */
export function lastSystemctl(w: Welt, a: string[], root: boolean): Ergebnis | null {
  const st = ls(w); const rest = a.filter((x) => !x.startsWith('-')); const [cmd, unit0] = rest; const unit = (unit0 ?? '').replace(/\.(service|timer)$/, '');
  if (!['sysstat', 'messd', 'sicherung', 'nachtsicherung'].includes(unit)) return null;
  if (unit === 'sysstat') {
    sysstatPruefen(w);
    if (!st || !('/etc/default/sysstat' in w.fs)) return fehler(`Unit ${unit0}.service could not be found.`, 4);
    const an = /^ENABLED="true"/m.test(w.fs['/etc/default/sysstat'] ?? '');
    if (cmd === 'status' || cmd === 'is-active') return { out: cmd === 'is-active' ? (st.sysstat === 'an' ? 'active' : 'inactive') : `${st.sysstat === 'an' ? '●' : '○'} sysstat.service - Resets System Activity Logs\n     Loaded: loaded (/lib/systemd/system/sysstat.service; ${st.sysstat === 'an' ? 'enabled' : 'disabled'}; preset: enabled)\n     Active: ${st.sysstat === 'an' ? 'active (exited)' : 'inactive (dead)'}`, code: st.sysstat === 'an' ? 0 : 3 };
    if (!(root || w.root)) return fehler(`Failed to ${cmd} sysstat.service: Interactive authentication required.`);
    if (['enable', 'start', 'restart'].includes(cmd)) {
      if (!an && cmd !== 'enable') return ok();
      if (an || a.includes('--now')) { if (st.sysstat !== 'an') st.sammeltSeit = w.uhr; st.sysstat = 'an'; const tag = `/var/log/sysstat/sa${String(new Date(w.uhr).getDate()).padStart(2, '0')}`; if (!(tag in w.fs)) w.fs[tag] = '\u0007BIN:2368'; }
      return { out: '', err: cmd === 'enable' ? 'Synchronizing state of sysstat.service with SysV service script with /lib/systemd/systemd-sysv-install.\nExecuting: /lib/systemd/systemd-sysv-install enable sysstat\nCreated symlink /etc/systemd/system/multi-user.target.wants/sysstat.service → /lib/systemd/system/sysstat.service.' : undefined, code: 0 };
    }
    return ok();
  }
  if (!st) return null;
  const bt = st.beitraege.filter((x) => x.dienst === unit);
  if (cmd === 'status' || cmd === 'is-active') {
    const laeuft = bt.some((x) => w.prozesse.some((p) => p.pid === x.pid && !p.weg));
    const p = w.prozesse.find((q) => bt.some((x) => x.pid === q.pid) && !q.weg);
    const titel: Record<string, string> = { messd: 'Messdaten-Dienst', sicherung: 'Nächtliche Sicherung von /srv/daten', nachtsicherung: 'Sicherung auf backup.lab.example.org' };
    if (cmd === 'is-active') return { out: laeuft ? 'active' : 'inactive', code: laeuft ? 0 : 3 };
    return { out: `${laeuft ? '●' : '○'} ${unit}.service - ${titel[unit]}\n     Loaded: loaded (/etc/systemd/system/${unit}.service; ${unit === 'messd' ? 'enabled' : 'static'}; preset: enabled)\n     Active: ${laeuft ? `active (running) since ${p?.start === 'Nov21' ? 'Sat 2026-11-21 06:12:03 CET; 2 days ago' : 'Mon 2026-11-23 02:00:01 CET; 6h ago'}` : 'inactive (dead)'}${laeuft && p ? `\n   Main PID: ${p.pid} (${p.cmd.split(' ')[0].split('/').pop()})\n     Memory: ${((bt.reduce((s, x) => s + (x.rss ?? 0), 0)) / 1_048_576).toFixed(1)}G` : ''}`, code: laeuft ? 0 : 3 };
  }
  if (!(root || w.root)) return fehler(`Failed to ${cmd} ${unit}.service: Interactive authentication required.`);
  const stopp = () => { for (const x of bt) { const p = w.prozesse.find((q) => q.pid === x.pid); if (p) p.weg = true; } if (unit === 'sicherung') { const sh = w.prozesse.find((q) => q.pid === 4402); if (sh) sh.weg = true; } };
  if (cmd === 'stop') { stopp(); return ok(); }
  if (cmd === 'restart' || cmd === 'start') {
    if (unit !== 'messd') { if (cmd === 'restart') stopp(); return ok(); }
    stopp(); const neu = 2870 + 2000 + Math.floor(Math.random() * 0);
    w.prozesse.push({ pid: neu, user: 'mess', cmd: 'java -Xmx12g -jar /opt/messd/messd.jar', ppid: 1, cpu: 4.1, mem: 4.9, vsz: 14200000, rss: 410000, stat: 'Sl', tty: '?', start: uhrzeit(w).slice(0, 5), zeit: '00:00:08' });
    st.beitraege.push({ pid: neu, cpu: 4, rss: 410000, dienst: 'messd' });
    st.last5 = Math.max(0.4, st.last5 * 0.7); return ok();
  }
  return null;
}

/** Wenn sysstat per apt kommt: Pakete lassen sich über dieses Modul nachinstallieren. */
export function lastPaket(w: Welt, name: string): boolean {
  const st = ls(w); if (!st) return false;
  if (name === 'sysstat') { sysstatInstallieren(w, false); return true; }
  const bins: Record<string, string> = { htop: '/usr/bin/htop', iotop: '/usr/sbin/iotop', iftop: '/usr/sbin/iftop', ifstat: '/usr/bin/ifstat', 'iptraf-ng': '/usr/sbin/iptraf-ng' };
  if (bins[name]) { w.fs[bins[name]] = '\u0007BIN:98000'; return true; }
  return false;
}

netzExtraSockets((w) => {
  const st = ls(w); if (!st) return [];
  return aktiv(w).filter((x) => x.gegen).map((x): Sock => ({ p: 'tcp', s: 'ESTAB', l: x.gegen!.startsWith('192.168.50.30') ? '192.168.50.10:43712' : '192.168.50.10:80', f: x.gegen!, prog: x.gegen!.startsWith('192.168.50.30') ? 'ssh' : 'nginx', pid: x.pid }));
});

export function zustandLast(w: Welt, s: string): boolean | undefined {
  const st = ls(w); let m;
  if ((m = s.match(/^last:(\w+)<([\d.]+)$/))) { if (!st) return false; const v = werte(w); const x: Record<string, number> = { wa: v.wa, load1: v.load[0], swap: v.swapUsed / 1024, util: Math.max(...v.platten.map((p) => p.util)), cpu: v.busy, si: v.si }; return x[m[1]] !== undefined && x[m[1]] < Number(m[2]); }
  if ((m = s.match(/^lastprozess:(\d+)=(da|weg)$/))) { const p = w.prozesse.find((q) => q.pid === Number(m![1])); return (!!p && !p.weg) === (m[2] === 'da'); }
  if (s === 'sysstat:an') return st?.sysstat === 'an';
  if ((m = s.match(/^paket-da:(\S+)$/))) return [`/usr/bin/${m[1]}`, `/usr/sbin/${m[1]}`].some((p) => p in w.fs);
  return undefined;
}
