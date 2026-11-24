// Systemdienste für den Simulator (Topic 108): Uhr und NTP (hwclock, chronyc, ntpdate, date -s),
// Protokollierung (rsyslog-Regeln, logger, systemd-cat, Journal, logrotate),
// Mail (Aliase, ~/.forward, sendmail, mailq, newaliases) und Drucken (CUPS mit lp, lpr, lpq, lprm, lpstat, lpadmin).
import type { Welt } from './shell';
import { stand } from './shell-skript';
import { KOMP } from './shell-dateien';

type Ergebnis = { out: string; err?: string; code: number };
type B = (w: Welt, a: string[], stdin: string, root: boolean) => Ergebnis;
const ok = (out = ''): Ergebnis => ({ out, code: 0 });
const fehler = (err: string, code = 1): Ergebnis => ({ out: '', err, code });

export interface DienstKern {
  rechte: (w: Welt, p: string, mode: number, owner: string, group: string) => void;
  pfad: (w: Welt, p: string) => string;
  datum: (w: Welt, ms: number, fmt?: string) => string;
  muster: (m: string) => RegExp;
}
let K: DienstKern;
export function dienstKern(k: DienstKern) { K = k; }

interface Job { nr: number; ziel: string; user: string; datei: string; groesse: number }
interface Drucker { uri: string; modell: string; aktiv: boolean; akzeptiert: boolean; grund: string }
export interface DienstStand {
  uhrAbw: number; rtcAbw: number; ntp: boolean; rtcLokal: boolean;
  rsyslog: boolean; rsyslogConf: Record<string, string> | null; fern: string[];
  journal: { ms: number; tag: string; prio: number; text: string }[]; journalFluechtig: boolean;
  aliasDb: Record<string, string[]>; queue: { id: string; von: string; an: string; groesse: number; grund: string }[];
  drucker: Record<string, Drucker>; standard: string; jobs: Job[]; jobNr: number; gedruckt: Job[];
}
export function ds(w: Welt): DienstStand {
  const x = w as Welt & { dienste?: DienstStand };
  if (!x.dienste) {
    x.dienste = { uhrAbw: 0, rtcAbw: 1200, ntp: true, rtcLokal: false, rsyslog: false, rsyslogConf: null, fern: [], journal: [], journalFluechtig: false, aliasDb: {}, queue: [], drucker: { laser: { uri: 'ipp://192.168.1.40/ipp/print', modell: 'HP LaserJet Pro M404n, driverless', aktiv: true, akzeptiert: true, grund: '' } }, standard: 'laser', jobs: [], jobNr: 11, gedruckt: [] };
    x.dienste.aliasDb = aliasLesen(w.fs['/etc/aliases'] ?? '').db;
  }
  return x.dienste;
}

// ---------- Dateien ----------

const RSYSLOG_CONF = `# /etc/rsyslog.conf configuration file for rsyslog
#
# For more information install rsyslog-doc and see
# /usr/share/doc/rsyslog-doc/html/configuration/index.html


#################
#### MODULES ####
#################

module(load="imuxsock") # provides support for local system logging
module(load="imklog")   # provides kernel logging support
#module(load="immark")  # provides --MARK-- message capability

# provides UDP syslog reception
#module(load="imudp")
#input(type="imudp" port="514")

# provides TCP syslog reception
#module(load="imtcp")
#input(type="imtcp" port="514")


###########################
#### GLOBAL DIRECTIVES ####
###########################

#
# Set the default permissions for all log files.
#
$FileOwner root
$FileGroup adm
$FileCreateMode 0640
$DirCreateMode 0755
$Umask 0022

#
# Where to place spool and state files
#
$WorkDirectory /var/spool/rsyslog

#
# Include all config files in /etc/rsyslog.d/
#
$IncludeConfig /etc/rsyslog.d/*.conf


###############
#### RULES ####
###############

#
# Log anything besides private authentication messages to a single log file
#
*.*;auth,authpriv.none		-/var/log/syslog

#
# Log commonly used facilities to their own log file
#
auth,authpriv.*			/var/log/auth.log
cron.*				-/var/log/cron.log
kern.*				-/var/log/kern.log
mail.*				-/var/log/mail.log
user.*				-/var/log/user.log

#
# Emergencies are sent to everybody logged in.
#
*.emerg				:omusrmsg:*
`;
const LOGROTATE_CONF = `# see "man logrotate" for details

# global options do not affect preceding include directives

# rotate log files weekly
weekly

# keep 4 weeks worth of backlogs
rotate 4

# create new (empty) log files after rotating old ones
create

# use date as a suffix of the rotated file
#dateext

# uncomment this if you want your log files compressed
#compress

# packages drop log rotation information into this directory
include /etc/logrotate.d

# system-specific logs may also be configured here.
`;
export function dienstDateien(fs: Record<string, string | null>) {
  Object.assign(fs, {
    '/etc/adjtime': '0.000000 1763884321 0.000000\n1763884321\nUTC\n',
    '/etc/chrony': null, '/etc/chrony/chrony.conf': '# Welcome to the chrony configuration file. See chrony.conf(5) for more\n# information about usable directives.\n\n# Include configuration files found in /etc/chrony/conf.d.\nconfdir /etc/chrony/conf.d\n\n# Use Debian vendor zone.\npool 2.debian.pool.ntp.org iburst\n\n# This directive specify the location of the file containing ID/key pairs for\n# NTP authentication.\nkeyfile /etc/chrony/chrony.keys\n\n# This directive specify the file into which chronyd will store the rate\n# information.\ndriftfile /var/lib/chrony/chrony.drift\n\n# Save NTS keys and cookies.\nntsdumpdir /var/lib/chrony\n\n# Uncomment the following line to turn logging on.\n#log tracking measurements statistics\n\n# Log files location.\nlogdir /var/log/chrony\n\n# Stop bad estimates upsetting machine clock.\nmaxupdateskew 100.0\n\n# This directive enables kernel synchronisation (every 11 minutes) of the\n# real-time clock. Note that it can\'t be used along with the \'rtcfile\' directive.\nrtcsync\n\n# Step the system clock instead of slewing it if the adjustment is larger than\n# one second, but only in the first three clock updates.\nmakestep 1 3\n',
    '/etc/chrony/conf.d': null,
    '/etc/systemd/journald.conf': '#  This file is part of systemd.\n#\n# Entries in this file show the compile time defaults. Local configuration\n# should be created by either modifying this file (or a copy of it placed in\n# /etc/ if the original file is shipped in /usr/), or by creating "drop-ins" in\n# the /etc/systemd/journald.conf.d/ directory. The latter is generally\n# recommended. Defaults can be restored by simply deleting the main\n# configuration file of systemd-journald.\n\n[Journal]\n#Storage=auto\n#Compress=yes\n#Seal=yes\n#SplitMode=uid\n#SyncIntervalSec=5m\n#RateLimitIntervalSec=30s\n#RateLimitBurst=10000\n#SystemMaxUse=\n#SystemKeepFree=\n#SystemMaxFileSize=\n#SystemMaxFiles=100\n#RuntimeMaxUse=\n#MaxRetentionSec=\n#MaxFileSec=1month\n#ForwardToSyslog=yes\n#ForwardToKMsg=no\n#ForwardToConsole=no\n#ForwardToWall=yes\n#MaxLevelStore=debug\n#MaxLevelSyslog=debug\n',
    '/var/log/journal': null, '/var/log/journal/4c2d8b1e7f9a4b03b5e2c1d6a8f7e9b0': null, '/var/log/journal/4c2d8b1e7f9a4b03b5e2c1d6a8f7e9b0/system.journal': '\u0007BIN:8388608',
    '/etc/logrotate.conf': LOGROTATE_CONF, '/etc/logrotate.d': null,
    '/etc/logrotate.d/apt': '/var/log/apt/term.log {\n  rotate 12\n  monthly\n  compress\n  missingok\n  notifempty\n}\n\n/var/log/apt/history.log {\n  rotate 12\n  monthly\n  compress\n  missingok\n  notifempty\n}\n',
    '/etc/logrotate.d/dpkg': '/var/log/dpkg.log {\n\tmonthly\n\trotate 12\n\tcompress\n\tdelaycompress\n\tmissingok\n\tnotifempty\n\tcreate 644 root root\n}\n',
    '/var/lib/logrotate': null, '/var/lib/logrotate/status': 'logrotate state -- version 2\n"/var/log/dpkg.log" 2026-11-1-0:0:0\n',
    '/etc/aliases': '# See man 5 aliases for format\npostmaster:    root\n',
    '/etc/aliases.db': '\u0007BIN:12288', '/etc/mailname': 'werkstatt\n',
    '/etc/postfix': null, '/etc/postfix/main.cf': '# See /usr/share/postfix/main.cf.dist for a commented, more complete version\n\nmyhostname = werkstatt\nalias_maps = hash:/etc/aliases\nalias_database = hash:/etc/aliases\nmyorigin = /etc/mailname\nmydestination = $myhostname, werkstatt, localhost.localdomain, localhost\nrelayhost =\nmynetworks = 127.0.0.0/8 [::ffff:127.0.0.0]/104 [::1]/128\nmailbox_size_limit = 0\nrecipient_delimiter = +\ninet_interfaces = loopback-only\ninet_protocols = all\n',
    '/etc/cups': null, '/etc/cups/cupsd.conf': '#\n# Configuration file for the CUPS scheduler.  See "man cupsd.conf" for a\n# complete description of this file.\n#\n\n# Log general information in error_log - change "warn" to "debug"\n# for troubleshooting...\nLogLevel warn\nPageLogFormat\n\n# Only listen for connections from the local machine.\nListen localhost:631\nListen /run/cups/cups.sock\n\n# Show shared printers on the local network.\nBrowsing No\nBrowseLocalProtocols dnssd\n\n# Default authentication type, when authentication is required...\nDefaultAuthType Basic\n\n# Web interface setting...\nWebInterface Yes\n\n# Restrict access to the server...\n<Location />\n  Order allow,deny\n</Location>\n\n# Restrict access to the admin pages...\n<Location /admin>\n  Order allow,deny\n</Location>\n',
    '/etc/cups/printers.conf': '', '/var/log/cups': null, '/var/log/cups/error_log': 'E [23/Nov/2026:08:12:15 +0100] [cups-deviced] PID 1712 (gutenprint53+usb) stopped with status 1!\n', '/var/log/cups/access_log': '', '/var/spool/cups': null,
  });
}
function druckerConf(w: Welt) {
  const st = ds(w);
  w.fs['/etc/cups/printers.conf'] = '# Printer configuration file for CUPS v2.4.2\n# Written by cupsd\n# DO NOT EDIT THIS FILE WHEN CUPSD IS RUNNING\n' + Object.entries(st.drucker).map(([n, d]) => `<${n === st.standard ? 'DefaultPrinter' : 'Printer'} ${n}>\nInfo ${d.modell}\nDeviceURI ${d.uri}\nState ${d.aktiv ? 'Idle' : 'Stopped'}\n${d.grund ? `StateMessage ${d.grund}\n` : ''}Accepting ${d.akzeptiert ? 'Yes' : 'No'}\nShared No\n</${n === st.standard ? 'DefaultPrinter' : 'Printer'}>`).join('\n') + '\n';
}

export interface DienstOptionen { rsyslog?: boolean; uhrFalsch?: number; rtcFalsch?: number; journalFluechtig?: boolean; druckerAngehalten?: boolean; druckJobs?: number }
export function dienstStarten(w: Welt, o: DienstOptionen = {}) {
  const st = ds(w);
  if (o.rsyslog) {
    st.rsyslog = true; w.fs['/etc/rsyslog.conf'] = RSYSLOG_CONF; w.fs['/etc/rsyslog.d'] = null; st.rsyslogConf = rsyslogSchnappschuss(w);
    for (const [f, t] of [['syslog', 'systemd[1]: Started rsyslog.service - System Logging Service.'], ['auth.log', 'sshd[1622]: Accepted publickey for lena from 192.168.1.23 port 51122 ssh2'], ['kern.log', 'kernel: e1000e 0000:00:1f.6 enp0s31f6: NIC Link is Up 1000 Mbps Full Duplex'], ['cron.log', 'CRON[2210]: (root) CMD (command -v debian-sa1 > /dev/null && debian-sa1 1 1)'], ['mail.log', 'postfix/master[1301]: daemon started -- version 3.7.11, configuration /etc/postfix'], ['user.log', '']] as const) {
      w.fs['/var/log/' + f] = t ? `2026-11-23T08:12:${f.length + 10}.104511+01:00 werkstatt ${t}\n` : '';
      K.rechte(w, '/var/log/' + f, 0o640, 'root', 'adm');
    }
  }
  if (o.uhrFalsch) { st.uhrAbw = o.uhrFalsch * 60000; w.uhr += st.uhrAbw; }
  if (o.rtcFalsch) st.rtcAbw = o.rtcFalsch * 60000;
  if (o.journalFluechtig) { st.journalFluechtig = true; for (const k of Object.keys(w.fs)) if (k.startsWith('/var/log/journal')) delete w.fs[k]; }
  if (o.druckerAngehalten) { st.drucker.laser.aktiv = false; st.drucker.laser.grund = 'Papierstau in Fach 2'; }
  for (let i = 0; i < (o.druckJobs ?? 0); i++) st.jobs.push({ nr: st.jobNr++, ziel: 'laser', user: i % 2 ? 'max' : 'lena', datei: ['messbericht-11.pdf', 'kalibrierung.txt', 'messbericht-12.pdf'][i % 3], groesse: [48210, 1203, 51833][i % 3] });
  druckerConf(w);
}

// ---------- Protokollierung ----------

const FACS = ['kern', 'user', 'mail', 'daemon', 'auth', 'syslog', 'lpr', 'news', 'uucp', 'cron', 'authpriv', 'ftp', 'local0', 'local1', 'local2', 'local3', 'local4', 'local5', 'local6', 'local7'];
const PRIOS: Record<string, number> = { emerg: 0, panic: 0, alert: 1, crit: 2, err: 3, error: 3, warning: 4, warn: 4, notice: 5, info: 6, debug: 7 };
const PRIO_NAME = ['emerg', 'alert', 'crit', 'err', 'warning', 'notice', 'info', 'debug'];
interface Regel { sel: string; ziel: string; zeile: number; datei: string }
/** rsyslog liest seine Konfiguration nur beim Start. Darum merkt sich der Simulator den Stand beim letzten Neustart. */
function rsyslogSchnappschuss(w: Welt): Record<string, string> {
  const r: Record<string, string> = {};
  for (const [k, v] of Object.entries(w.fs)) if (typeof v === 'string' && (k === '/etc/rsyslog.conf' || k.startsWith('/etc/rsyslog.d/'))) r[k] = v;
  return r;
}
function regeln(w: Welt, text: string, datei = '/etc/rsyslog.conf', quelle: Record<string, string | null> = w.fs): Regel[] {
  const r: Regel[] = [];
  text.split('\n').forEach((z, i) => {
    const t = z.trim();
    if (!t || t.startsWith('#')) return;
    const inc = t.match(/^\$IncludeConfig\s+(\S+)/) ?? t.match(/^include\(file="([^"]+)"/);
    if (inc) { const re = K.muster(inc[1]); for (const p of Object.keys(quelle).filter((k) => re.test(k) && typeof quelle[k] === 'string').sort()) r.push(...regeln(w, quelle[p] ?? '', p, quelle)); return; }
    if (t.startsWith('$') || /^(module|input|template|global|ruleset)\(/.test(t)) return;
    const m = t.match(/^(\S+)\s+(\S+)/); if (m) r.push({ sel: m[1], ziel: m[2], zeile: i + 1, datei });
  });
  return r;
}
function passt(sel: string, fac: string, prio: number): boolean {
  let ja = false;
  for (const teil of sel.split(';')) {
    const [facs, p] = teil.split('.'); if (p === undefined) continue;
    const trifft = facs === '*' || facs.split(',').includes(fac);
    if (!trifft) continue;
    if (p === 'none') { ja = false; continue; }
    if (p === '*') { ja = true; continue; }
    const neg = p.startsWith('!'); const gleich = p.replace('!', '').startsWith('=');
    const n = PRIOS[p.replace(/^!?=?/, '')]; if (n === undefined) continue;
    const ok2 = gleich ? prio === n : prio <= n;
    ja = neg ? (ok2 ? false : ja) : ok2 ? true : ja;
  }
  return ja;
}
export function regelFehler(w: Welt, text: string): string | null {
  for (const r of regeln(w, text)) {
    for (const teil of r.sel.split(';')) {
      const [facs, p] = teil.split('.');
      if (p === undefined) return `rsyslogd: error during parsing file ${r.datei}, on or before line ${r.zeile}: warnings occurred in file '${r.datei}' around line ${r.zeile} [v8.2302.0]`;
      for (const f of facs.split(',')) if (f !== '*' && !FACS.includes(f)) return `rsyslogd: invalid or yet-unknown config file command '${f}' - have you forgotten to load a module? [v8.2302.0 try https://www.rsyslog.com/e/3003 ]\nrsyslogd: unknown facility name "${f}" [${r.datei}:${r.zeile}]`;
      if (!['*', 'none'].includes(p) && PRIOS[p.replace(/^!?=?/, '')] === undefined) return `rsyslogd: unknown priority name "${p}" [${r.datei}:${r.zeile}]`;
    }
  }
  return null;
}
export function protokollieren(w: Welt, fac: string, prio: number, tag: string, text: string) {
  const st = ds(w);
  st.journal.push({ ms: w.uhr, tag, prio, text });
  if (!st.rsyslog || st.rsyslogConf === null) return;
  const zeile = `${K.datum(w, w.uhr, '%Y-%m-%dT%H:%M:%S')}.${String(w.uhr % 1000).padStart(3, '0')}511${K.datum(w, w.uhr, '%z').replace(/(\d\d)$/, ':$1')} werkstatt ${tag}: ${text}\n`;
  for (const r of regeln(w, st.rsyslogConf['/etc/rsyslog.conf'] ?? '', '/etc/rsyslog.conf', st.rsyslogConf)) {
    if (!passt(r.sel, fac, prio)) continue;
    if (r.ziel.startsWith('@')) { const h = r.ziel.replace(/^@@?/, ''); if (!st.fern.includes(h)) st.fern.push(h); continue; }
    if (r.ziel.startsWith(':') || r.ziel === '~' || r.ziel === 'stop') continue;
    const p = r.ziel.replace(/^-/, '');
    if (!p.startsWith('/')) continue;
    const neu = !(p in w.fs);
    w.fs[p] = (w.fs[p] ?? '') + zeile;
    if (neu) K.rechte(w, p, 0o640, 'root', 'adm');
  }
}

// ---------- logrotate ----------

interface LrBlock { pfade: string[]; opt: Record<string, string> }
function lrLesen(w: Welt, p: string, global: Record<string, string> = {}): { bloecke: LrBlock[]; global: Record<string, string> } {
  const text = w.fs[p] ?? ''; const bloecke: LrBlock[] = []; let g = { ...global };
  const zeilen = text.split('\n').map((z) => z.trim()); let offen: LrBlock | null = null; let skript = false;
  for (const z of zeilen) {
    if (!z || z.startsWith('#')) continue;
    if (skript) { if (z === 'endscript') skript = false; continue; }
    if (/^(postrotate|prerotate|firstaction|lastaction)$/.test(z)) { skript = true; continue; }
    const inc = z.match(/^include\s+(\S+)/);
    if (inc && !offen) { const d = inc[1]; const dateien = w.fs[d] === null ? Object.keys(w.fs).filter((k) => k.startsWith(d + '/') && !k.slice(d.length + 1).includes('/') && typeof w.fs[k] === 'string').sort() : [d]; for (const f of dateien) bloecke.push(...lrLesen(w, f, g).bloecke); continue; }
    const kopf = z.match(/^(.+?)\s*\{$/);
    if (kopf) { offen = { pfade: kopf[1].split(/\s+/), opt: { ...g } }; continue; }
    if (z === '}') { if (offen) bloecke.push(offen); offen = null; continue; }
    const [k, ...v] = z.split(/\s+/);
    if (offen) offen.opt[k] = v.join(' '); else g = { ...g, [k]: v.join(' ') };
  }
  return { bloecke, global: g };
}

// ---------- Mail ----------

function aliasLesen(text: string): { db: Record<string, string[]>; fehler: string[] } {
  const db: Record<string, string[]> = {}; const f: string[] = [];
  text.split('\n').forEach((z, i) => {
    const t = z.trim(); if (!t || t.startsWith('#')) return;
    const m = t.match(/^([^:\s]+)\s*:\s*(.+)$/);
    if (!m) { f.push(`postalias: warning: /etc/aliases, line ${i + 1}: need name:value pair`); return; }
    db[m[1].toLowerCase()] = m[2].split(',').map((x) => x.trim()).filter(Boolean);
  });
  return { db, fehler: f };
}
const LOKALE_DOMAIN = /@(werkstatt|localhost)$/;
export function zustellen(w: Welt, an: string, von: string, betreff: string, text: string): string[] {
  const st = ds(w); const zugestellt: string[] = [];
  const benutzer = (n: string) => (w.fs['/etc/passwd'] ?? '').split('\n').some((z) => z.split(':')[0] === n);
  const home = (n: string) => (w.fs['/etc/passwd'] ?? '').split('\n').map((z) => z.split(':')).find((z) => z[0] === n)?.[5] ?? `/home/${n}`;
  const besucht = new Set<string>();
  const ab = (ziel: string, tiefe: number) => {
    if (tiefe > 10) return;
    let z = ziel.trim(); const direkt = z.startsWith('\\'); z = z.replace(/^\\/, '').replace(LOKALE_DOMAIN, '');
    if (z.startsWith('|') || z.startsWith('/')) return;
    if (z.includes('@')) { st.queue.push({ id: (0xA1B2C3D4E5 + st.queue.length * 7919).toString(16).toUpperCase().slice(0, 10), von: `${von}@werkstatt`, an: z, groesse: 380 + text.length, grund: `connect to ${z.split('@')[1]}[192.0.2.20]:25: Connection refused` }); zugestellt.push(z); return; }
    const key = z.toLowerCase();
    if (!direkt && st.aliasDb[key] && !besucht.has(key)) { besucht.add(key); for (const x of st.aliasDb[key]) ab(x, tiefe + 1); return; }
    if (!benutzer(key)) return;
    // ~/.forward leitet weiter, außer die Mail kommt schon aus der eigenen Weiterleitung (\name)
    const fw = w.fs[`${home(key)}/.forward`];
    if (!direkt && typeof fw === 'string' && fw.trim() && !besucht.has('fw:' + key)) { besucht.add('fw:' + key); for (const x of fw.split(/[\n,]/).map((y) => y.trim()).filter(Boolean)) ab(x, tiefe + 1); return; }
    stand(w).post.push({ an: key, von, betreff, text });
    const p = `/var/mail/${key}`; const neu = !(p in w.fs);
    w.fs[p] = (w.fs[p] ?? '') + `From ${von}@werkstatt  Mon Nov 23 08:41:00 2026\nReturn-path: <${von}@werkstatt>\nTo: ${an}\nSubject: ${betreff}\nFrom: ${von}@werkstatt\nDate: Mon, 23 Nov 2026 08:41:00 +0100\n\n${text.replace(/\n?$/, '\n')}\n`;
    if (neu) K.rechte(w, p, 0o660, key, 'mail');
    zugestellt.push(key);
  };
  ab(an, 0);
  protokollieren(w, 'mail', 6, 'postfix/local[3412]', `A1B2C3D4E5: to=<${an}>, relay=local, status=${zugestellt.length ? 'sent' : 'bounced (unknown user)'} (${zugestellt.join(', ') || an})`);
  return zugestellt;
}

// ---------- Befehle ----------

const ich = (w: Welt, root: boolean) => (root || w.root ? 'root' : 'lena');
const tagText = (w: Welt) => K.datum(w, w.uhr - 30 * 60000);

export function dienstBefehle(alt: Record<string, B>): Record<string, B> {
  const b: Record<string, B> = {};

  // --- Uhr ---
  b.hwclock = (w, a, _i, root) => {
    const st = ds(w);
    if (!(root || w.root)) return fehler('hwclock: Cannot access the Hardware Clock via any known method.\nhwclock: Use the --verbose option to see the details of our search for an access method.');
    if (a.includes('--systohc') || a.includes('-w')) { st.rtcAbw = 0; if (a.includes('--localtime')) st.rtcLokal = true; if (a.includes('--utc') || a.includes('-u')) st.rtcLokal = false; w.fs['/etc/adjtime'] = `0.000000 1763884321 0.000000\n1763884321\n${st.rtcLokal ? 'LOCAL' : 'UTC'}\n`; return ok(); }
    if (a.includes('--hctosys') || a.includes('-s')) { w.uhr += st.rtcAbw; st.uhrAbw += st.rtcAbw; st.rtcAbw = 0; return ok(); }
    const rtc = w.uhr + st.rtcAbw;
    return ok(`${K.datum(w, rtc, '%F %T')}.${String(rtc % 1000).padStart(3, '0')}412${K.datum(w, rtc, '%z').replace(/(\d\d)$/, ':$1')}`);
  };
  b.chronyc = (w, a, _i, root) => {
    const st = ds(w); const cmd = a.find((x) => !x.startsWith('-')) ?? '';
    if (!st.ntp) return fehler('506 Cannot talk to daemon');
    const sek = (st.uhrAbw / 1000).toFixed(9);
    if (cmd === 'sources') return ok(`MS Name/IP address         Stratum Poll Reach LastRx Last sample               \n===============================================================================\n^* time1.example-ntp.de          2   6   377    21   ${st.uhrAbw ? '-' + sek.slice(0, 7) + 's' : '+215us'}[ +241us] +/-   14ms\n^+ ntp2.example-pool.net         2   6   377    20   -1032us[-1006us] +/-   25ms\n^- pool-3.example.org            3   6   377    22   +3871us[+3897us] +/-   58ms\n^? 2001:db8::123                 0   6     0     -     +0ns[   +0ns] +/-    0ns`);
    if (cmd === 'tracking') return ok(`Reference ID    : C0000217 (time1.example-ntp.de)\nStratum         : 3\nRef time (UTC)  : ${K.datum(w, w.uhr - 3600000 - 21000, '%a %b %d %T %Y')}\nSystem time     : ${st.uhrAbw ? Math.abs(st.uhrAbw / 1000).toFixed(9) + ' seconds ' + (st.uhrAbw > 0 ? 'fast' : 'slow') : '0.000004211 seconds slow'} of NTP time\nLast offset     : +0.000002164 seconds\nRMS offset      : 0.000183917 seconds\nFrequency       : 7.811 ppm slow\nResidual freq   : +0.001 ppm\nSkew            : 0.037 ppm\nRoot delay      : 0.012871209 seconds\nRoot dispersion : 0.000412917 seconds\nUpdate interval : 64.4 seconds\nLeap status     : Normal`);
    if (cmd === 'sourcestats') return ok('Name/IP Address            NP  NR  Span  Frequency  Freq Skew  Offset  Std Dev\n==============================================================================\ntime1.example-ntp.de       12   7   710     -0.004      0.063   +215us    48us\nntp2.example-pool.net      12   6   711     +0.051      0.102  -1032us    73us');
    if (cmd === 'makestep') { if (!(root || w.root)) return fehler('501 Not authorised'); w.uhr -= st.uhrAbw; st.uhrAbw = 0; return ok('200 OK'); }
    return fehler(`Unrecognized command`);
  };
  b.ntpdate = (w, a, _i, root) => {
    const st = ds(w); const host = a.filter((x) => !x.startsWith('-')).pop();
    if (!host) return fehler('ntpdate: no servers can be used, exiting');
    const off = (-st.uhrAbw / 1000).toFixed(6);
    const zeile = `${K.datum(w, w.uhr, '%d %b %T')} ntpdate[${4400 + st.queue.length}]: ${a.includes('-q') ? 'adjust' : 'step'} time server 192.0.2.17 offset ${off} sec`;
    if (a.includes('-q')) return ok(`server 192.0.2.17, stratum 2, offset ${off}, delay 0.02591\n${zeile}`);
    if (!(root || w.root)) return fehler('ntpdate: step-systime: Operation not permitted');
    if (st.ntp) return fehler(`ntpdate: the NTP socket is in use, exiting\n(Auf werkstatt läuft schon chronyd. Mit chronyc makestep stellst du die Uhr sofort.)`);
    w.uhr -= st.uhrAbw; st.uhrAbw = 0; return ok(zeile);
  };
  b.ntpq = () => fehler('ntpq: read: Connection refused\n(Auf werkstatt läuft chrony, nicht ntpd. Die Entsprechung von ntpq -p ist chronyc sources.)');
  b.date = (w, a, i, root) => {
    const si = a.findIndex((x) => x === '-s' || x === '--set');
    if (si < 0) return alt.date(w, a, i, root);
    if (!(root || w.root)) return fehler('date: Datum kann nicht gesetzt werden: Vorgang nicht zulässig');
    const v = a[si + 1] ?? ''; const m = v.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/) ?? v.match(/^()()()(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!m) return fehler(`date: ungültiges Datum »${v}«`);
    const off = Number(K.datum(w, w.uhr, '%z').slice(0, 3));
    const jetzt = new Date(w.uhr + off * 3600000);
    const ziel = Date.UTC(m[1] ? +m[1] : jetzt.getUTCFullYear(), m[2] ? +m[2] - 1 : jetzt.getUTCMonth(), m[3] ? +m[3] : jetzt.getUTCDate(), +m[4], +m[5], +(m[6] ?? 0)) - off * 3600000;
    const st = ds(w); st.uhrAbw += ziel - w.uhr; w.uhr = ziel;
    return ok(K.datum(w, w.uhr));
  };

  // --- Protokolle ---
  b.logger = (w, a, stdin, root) => {
    let fac = 'user'; let prio = 6; let tag = ich(w, root); const text: string[] = [];
    for (let i = 0; i < a.length; i++) {
      const x = a[i];
      if (x === '-p' || x === '--priority') { const [f, p] = (a[++i] ?? '').split('.'); if (p === undefined) { if (PRIOS[f] === undefined) return fehler(`logger: Unbekannte Priorität: ${f}`); prio = PRIOS[f]; continue; } if (!FACS.includes(f)) return fehler(`logger: Unbekannte Einrichtung: ${f}`); if (PRIOS[p] === undefined) return fehler(`logger: Unbekannte Priorität: ${p}`); fac = f; prio = PRIOS[p]; }
      else if (x === '-t' || x === '--tag') tag = a[++i] ?? tag;
      else if (x === '-i') continue;
      else text.push(x);
    }
    const nachrichten = text.length ? [text.join(' ')] : stdin.split('\n').filter(Boolean);
    for (const n of nachrichten) protokollieren(w, fac, prio, tag, n);
    return ok();
  };
  b['systemd-cat'] = (w, a, stdin, root) => {
    let tag = 'cat'; let prio = 6; let i = 0;
    for (; i < a.length && a[i].startsWith('-'); i++) { if (a[i] === '-t') tag = a[++i] ?? tag; else if (a[i] === '-p') { const p = a[++i] ?? ''; prio = /^\d$/.test(p) ? Number(p) : PRIOS[p] ?? 6; } }
    const cmd = a.slice(i);
    if (!cmd.length) { for (const z of stdin.split('\n').filter(Boolean)) ds(w).journal.push({ ms: w.uhr, tag, prio, text: z }); return ok(); }
    const r = alt[cmd[0]] ? alt[cmd[0]](w, cmd.slice(1), stdin, root) : fehler(`Failed to execute ${cmd[0]}: No such file or directory`);
    for (const z of [r.out, r.err ?? ''].join('\n').split('\n').filter(Boolean)) ds(w).journal.push({ ms: w.uhr, tag: tag === 'cat' ? cmd[0] : tag, prio, text: z });
    return { out: '', err: r.code ? r.err : undefined, code: r.code };
  };
  b.rsyslogd = (w, a) => {
    if (!('/etc/rsyslog.conf' in w.fs)) return fehler('bash: rsyslogd: Befehl nicht gefunden', 127);
    if (a.includes('-N1') || (a.includes('-N') && a.includes('1'))) { const f = regelFehler(w, w.fs['/etc/rsyslog.conf'] ?? ''); return f ? fehler(`rsyslogd: version 8.2302.0, config validation run (level 1), master config /etc/rsyslog.conf\n${f}`) : ok('rsyslogd: version 8.2302.0, config validation run (level 1), master config /etc/rsyslog.conf\nrsyslogd: End of config validation run. Bye.'); }
    return ok('(rsyslogd läuft als Dienst. Starte ihn mit systemctl restart rsyslog neu.)');
  };
  b.logrotate = (w, a, _i, root) => {
    const debug = a.includes('-d') || a.includes('--debug'); const force = a.includes('-f') || a.includes('--force');
    const conf = a.filter((x) => !x.startsWith('-'))[0];
    if (!conf) return fehler('logrotate 3.21.0 - Copyright (C) 1995-2001 Red Hat, Inc.\nUsage: logrotate [OPTION...] <configfile>');
    if (!(root || w.root) && !debug) return fehler(`error: error creating state file /var/lib/logrotate/status: Permission denied`);
    const p = K.pfad(w, conf); if (!(p in w.fs)) return fehler(`error: cannot stat ${conf}: No such file or directory`);
    const { bloecke } = lrLesen(w, p, conf.endsWith('logrotate.conf') ? {} : lrLesen(w, '/etc/logrotate.conf').global);
    const out: string[] = [`reading config file ${conf}`];
    for (const bl of bloecke) {
      const n = Number(bl.opt.rotate ?? '1'); const periode = 'daily' in bl.opt ? 'daily' : 'monthly' in bl.opt ? 'monthly' : 'yearly' in bl.opt ? 'yearly' : 'weekly';
      out.push(`\nrotating pattern: ${bl.pfade.join(' ')}  ${'size' in bl.opt ? bl.opt.size + ' bytes' : periode} (${n} rotations)`, `empty log files are ${'notifempty' in bl.opt ? 'not ' : ''}rotated, old logs are removed`);
      for (const muster of bl.pfade) {
        const re = K.muster(muster);
        const treffer = Object.keys(w.fs).filter((k) => re.test(k) && typeof w.fs[k] === 'string');
        if (!treffer.length) { out.push(`considering log ${muster}`, `  log ${muster} does not exist -- ${'missingok' in bl.opt ? 'skipping' : 'error'}`); continue; }
        for (const f of treffer) {
          out.push(`considering log ${f}`);
          const leer = (w.fs[f] ?? '') === '';
          if (leer && 'notifempty' in bl.opt) { out.push('  log does not need rotating (log is empty)'); continue; }
          if (!force) { out.push(`  log does not need rotating (log has been rotated at ${K.datum(w, w.uhr - 3 * 3600000, '%Y-%m-%d %H:%M')}, which is less than a ${periode === 'daily' ? 'day' : periode.replace('ly', '')} ago)`); continue; }
          out.push(`  log needs rotating`, `rotating log ${f}, log->rotateCount is ${n}`);
          if (debug) continue;
          const gz = 'compress' in bl.opt; const verz = 'delaycompress' in bl.opt;
          const name = (k: number) => `${f}.${k}${gz && !(verz && k === 1) ? '.gz' : ''}`;
          for (const k of [n, n + 1]) for (const x of [`${f}.${k}`, `${f}.${k}.gz`]) if (k >= n && x in w.fs) delete w.fs[x];
          for (let k = n - 1; k >= 1; k--) {
            const quelle = [`${f}.${k}`, `${f}.${k}.gz`].find((x) => x in w.fs); if (!quelle) continue;
            let inhalt = w.fs[quelle] ?? ''; delete w.fs[quelle];
            if (gz && !inhalt.startsWith(KOMP)) inhalt = `${KOMP}gz:${inhalt}`;
            w.fs[name(k + 1)] = inhalt;
          }
          const alt1 = w.fs[f] ?? ''; w.fs[name(1)] = gz && !verz ? `${KOMP}gz:${alt1}` : alt1;
          const cr = bl.opt.create;
          if (cr !== undefined || 'create' in bl.opt) { const [m, o, g] = (cr ?? '').split(/\s+/); w.fs[f] = ''; K.rechte(w, f, m ? parseInt(m, 8) : 0o640, o || 'root', g || 'adm'); }
          else delete w.fs[f];
        }
      }
    }
    if (!debug) w.fs['/var/lib/logrotate/status'] = 'logrotate state -- version 2\n';
    return debug || a.includes('-v') ? { out: '', err: out.join('\n'), code: 0 } : ok();
  };
  b.journalctl = (w, a, i, root) => {
    const st = ds(w);
    if (a.includes('--disk-usage')) return ok(`Archived and active journals take up ${st.journalFluechtig ? '1.5M in the file system.' : '24.0M in the file system.'}`);
    const vac = a.find((x) => x.startsWith('--vacuum-')); if (vac) { if (!(root || w.root)) return fehler('Failed to open journal: Permission denied'); return ok(`Vacuuming done, freed 0B of archived journals from /var/log/journal/4c2d8b1e7f9a4b03b5e2c1d6a8f7e9b0.\nVacuuming done, freed 0B of archived journals from /run/log/journal.`); }
    if (a.includes('--list-boots') && st.journalFluechtig) return ok('IDX BOOT ID                          FIRST ENTRY                 LAST ENTRY\n  0 4c2d8b1e7f9a4b03b5e2c1d6a8f7e9b0 Mon 2026-11-23 08:12:01 CET Mon 2026-11-23 08:15:42 CET');
    const bi = a.findIndex((x) => x === '-b' || x === '--boot');
    if (bi >= 0 && a[bi + 1] === '-1' && st.journalFluechtig) return fehler('Data from the specified boot (-1) is not available: No such boot ID in journal');
    const ti = a.findIndex((x) => x === '-t' || x === '--identifier'); const tag = ti >= 0 ? a[ti + 1] : undefined;
    const pi = a.findIndex((x) => x === '-p' || x === '--priority'); const pw = pi >= 0 ? a[pi + 1] ?? '' : '';
    const pmax = pw ? (/^\d$/.test(pw) ? Number(pw) : PRIOS[pw.split('..').pop()!] ?? 7) : 7;
    const eigene = st.journal.filter((e) => (!tag || e.tag === tag) && e.prio <= pmax).map((e) => `${K.datum({ ...w, env: { ...w.env, LANG: 'C' } } as Welt, e.ms, '%b %d %T')} werkstatt ${e.tag}: ${e.text}`);
    if (tag) { const ni = a.indexOf('-n'); const z = ni >= 0 ? eigene.slice(-Number(a[ni + 1] ?? 10)) : eigene; return ok(z.length ? z.join('\n') : '-- No entries --'); }
    const basis = alt.journalctl(w, a, i, root);
    let zeilen = [...(basis.out ? basis.out.split('\n').filter((z) => z !== '-- No entries --') : []), ...(a.some((x) => x === '-u' || x.startsWith('--unit') || x === '-k') ? [] : eigene)];
    const ni = a.indexOf('-n'); if (ni >= 0) zeilen = zeilen.slice(-Number(a[ni + 1] ?? 10));
    if (a.includes('-r')) zeilen.reverse();
    return ok(zeilen.length ? zeilen.join('\n') : '-- No entries --');
  };

  // --- Mail ---
  b.mail = (w, a, stdin, root) => {
    let betreff = ''; const an: string[] = [];
    for (let i = 0; i < a.length; i++) { if (a[i] === '-s') betreff = a[++i] ?? ''; else if (!a[i].startsWith('-')) an.push(a[i]); }
    if (!an.length) return alt.mail(w, a, stdin, root);
    if (!stdin) return alt.mail(w, a, stdin, root);
    for (const z of an) zustellen(w, z, ich(w, root), betreff, stdin);
    return ok();
  };
  b.sendmail = (w, a, stdin, root) => {
    let an = a.filter((x) => !x.startsWith('-'));
    const kopf = stdin.split('\n\n')[0]; const hatKopf = /^(To|Subject|From):/im.test(kopf);
    if (a.includes('-t')) an = (kopf.match(/^To:\s*(.+)$/im)?.[1] ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    if (a.includes('-bp')) return b.mailq(w, [], '', root);
    if (!an.length) return fehler('sendmail: fatal: lena(1000): No recipient addresses found in message header');
    const betreff = hatKopf ? kopf.match(/^Subject:\s*(.+)$/im)?.[1] ?? '' : '';
    const text = hatKopf ? stdin.split('\n\n').slice(1).join('\n\n') : stdin;
    for (const z of an) zustellen(w, z, ich(w, root), betreff, text);
    return ok();
  };
  b.mailq = (w) => {
    const q = ds(w).queue;
    if (!q.length) return ok('Mail queue is empty');
    return ok(`-Queue ID-  --Size-- ----Arrival Time---- -Sender/Recipient-------\n${q.map((m) => `${m.id}      ${String(m.groesse).padStart(4)} ${K.datum({ ...w, env: { ...w.env, LANG: 'C' } } as Welt, w.uhr, '%a %b %d %T')}  ${m.von}\n(${m.grund})\n                                         ${m.an}\n`).join('\n')}\n-- ${Math.ceil(q.reduce((s, m) => s + m.groesse, 0) / 1024)} Kbytes in ${q.length} Request${q.length > 1 ? 's' : ''}.`);
  };
  b.postqueue = (w, a, i, r) => (a.includes('-p') ? b.mailq(w, a, i, r) : a.includes('-f') ? ok() : fehler('postqueue: fatal: usage: postqueue -f | postqueue -i queueid | postqueue -j | postqueue -p | postqueue -s site'));
  b.postsuper = (w, a, _i, root) => {
    if (!(root || w.root)) return fehler('postsuper: fatal: use of this command is reserved for the superuser');
    const di = a.indexOf('-d'); if (di < 0) return ok();
    const id = a[di + 1]; const st = ds(w); const n = st.queue.length;
    st.queue = id === 'ALL' ? [] : st.queue.filter((m) => m.id !== id);
    return { out: '', err: `postsuper: Deleted: ${n - st.queue.length} message${n - st.queue.length === 1 ? '' : 's'}`, code: 0 };
  };
  b.newaliases = (w, _a, _i, root) => {
    if (!(root || w.root)) return fehler('postalias: fatal: open database /etc/aliases.db: Permission denied');
    const { db, fehler: f } = aliasLesen(w.fs['/etc/aliases'] ?? '');
    ds(w).aliasDb = db; w.fs['/etc/aliases.db'] = '\u0007BIN:12288';
    return f.length ? { out: '', err: f.join('\n'), code: 0 } : ok();
  };
  b.postalias = (w, a, i, r) => (a.some((x) => x.includes('/etc/aliases')) ? b.newaliases(w, a, i, r) : ok());

  // --- Drucken ---
  const ziel = (w: Welt, name?: string) => name ?? ((w.fs['/home/lena/.cups/lpoptions'] ?? '').match(/^Default (\S+)/m)?.[1]) ?? ds(w).standard;
  const datumC = (w: Welt) => tagText(w);
  const drucken = (w: Welt) => { const st = ds(w); for (const j of [...st.jobs]) { const d = st.drucker[j.ziel]; if (d?.aktiv) { st.jobs = st.jobs.filter((x) => x !== j); st.gedruckt.push(j); } } };
  const auftrag = (prog: string) => (w: Welt, a: string[], stdin: string, root: boolean): Ergebnis => {
    const st = ds(w); let dest: string | undefined; let kopien = 1; const dateien: string[] = [];
    for (let i = 0; i < a.length; i++) { const x = a[i]; if ((prog === 'lp' && x === '-d') || (prog === 'lpr' && x === '-P')) dest = a[++i]; else if (prog === 'lpr' && x.startsWith('-P')) dest = x.slice(2); else if (x === '-n' || x.startsWith('-#')) kopien = Number(x === '-n' ? a[++i] : x.slice(2) || a[++i]); else if (x === '-o') i++; else dateien.push(x); }
    const z = ziel(w, dest);
    if (!st.drucker[z]) return fehler(`${prog}: Fehler - unbekanntes Druckziel "${z}".`);
    if (!st.drucker[z].akzeptiert) return fehler(`${prog}: Destination "${z}" is not accepting jobs.`);
    const namen = dateien.length ? dateien : ['(stdin)'];
    for (const d of dateien) { const p = K.pfad(w, d); if (!(p in w.fs)) return fehler(`${prog}: Error - unable to access "${d}" - No such file or directory`); }
    const nr = st.jobNr++;
    st.jobs.push({ nr, ziel: z, user: ich(w, root), datei: namen.map((n) => n.split('/').pop()).join(', '), groesse: dateien.reduce((s, d) => s + (w.fs[K.pfad(w, d)] ?? '').length, 0) * kopien || stdin.length });
    drucken(w);
    return prog === 'lp' ? ok(`Anfrage-ID ist ${z}-${nr} (${namen.length} Datei(en))`) : ok();
  };
  b.lp = auftrag('lp'); b.lpr = auftrag('lpr');
  b.lpq = (w, a) => {
    const st = ds(w); const pi = a.findIndex((x) => x.startsWith('-P')); const z = ziel(w, pi >= 0 ? (a[pi].slice(2) || a[pi + 1]) : undefined);
    const d = st.drucker[z]; if (!d) return fehler(`lpq: Fehler - unbekanntes Druckziel "${z}".`);
    const jobs = st.jobs.filter((j) => j.ziel === z);
    const kopf = d.aktiv ? `${z} ist bereit` : `${z} ist nicht bereit`;
    if (!jobs.length) return ok(`${kopf}\nkeine Einträge`);
    return ok(`${kopf}\nRang    Besitz. Auftrag Datei(en)                       Gesamtgröße\n${jobs.map((j, k) => `${(k === 0 && d.aktiv ? 'active' : k + 1 + (k === 0 ? 'st' : k === 1 ? 'nd' : k === 2 ? 'rd' : 'th')).padEnd(8)}${j.user.padEnd(8)}${String(j.nr).padEnd(8)}${j.datei.padEnd(32)}${j.groesse} Byte`).join('\n')}`);
  };
  const entfernen = (prog: string) => (w: Welt, a: string[], _i: string, root: boolean): Ergebnis => {
    const st = ds(w); const user = ich(w, root); const err: string[] = [];
    const alle = a.includes('-') || a.includes('-a');
    const ids = a.filter((x) => !x.startsWith('-') && !/^-P/.test(x)).map((x) => Number(x.replace(/^.*-/, '')));
    const treffer = alle ? st.jobs.filter((j) => user === 'root' || j.user === user) : st.jobs.filter((j) => ids.includes(j.nr));
    for (const j of treffer) { if (user !== 'root' && j.user !== user) { err.push(`${prog}: Not authorized to cancel job ${j.nr}.`); continue; } st.jobs = st.jobs.filter((x) => x !== j); }
    for (const n of ids) if (!treffer.some((j) => j.nr === n)) err.push(`${prog}: Job ${n} does not exist.`);
    if (!ids.length && !alle && prog === 'lprm') { const eig = st.jobs.filter((j) => j.user === user); if (eig.length) st.jobs = st.jobs.filter((j) => j !== eig[0]); }
    return { out: '', err: err.join('\n') || undefined, code: err.length ? 1 : 0 };
  };
  b.lprm = entfernen('lprm'); b.cancel = entfernen('cancel');
  b.lpstat = (w, a) => {
    const st = ds(w); const out: string[] = []; const flags = a.join(' ');
    const alle = flags.includes('-t'); const seit = datumC(w);
    if (alle || flags.includes('-r')) out.push('Zeitplandienst läuft');
    if (alle || flags.includes('-d') || flags.includes('-s')) out.push(st.standard ? `systemvoreingestelltes Ziel: ${st.standard}` : 'keine systemvoreingestellten Ziele');
    if (alle || flags.includes('-v') || flags.includes('-s')) for (const [n, d] of Object.entries(st.drucker)) out.push(`Gerät für ${n}: ${d.uri}`);
    if (alle || flags.includes('-a')) for (const [n, d] of Object.entries(st.drucker)) out.push(d.akzeptiert ? `${n} akzeptiert Anfragen seit ${seit}` : `${n} akzeptiert keine Anfragen seit ${seit} -\n\tRejecting Jobs`);
    if (alle || flags.includes('-p') || !a.length) for (const [n, d] of Object.entries(st.drucker)) out.push(d.aktiv ? `Drucker ${n} ist im Leerlauf.  Aktiviert seit ${seit}` : `Drucker ${n} ist deaktiviert seit ${seit} -\n\t${d.grund || 'Paused'}`);
    if (alle || flags.includes('-o') || !a.length) for (const j of st.jobs) out.push(`${(j.ziel + '-' + j.nr).padEnd(23)}${j.user.padEnd(15)}${String(j.groesse).padStart(6)}   ${seit}`);
    return ok(out.join('\n'));
  };
  const nurAdmin = (w: Welt, root: boolean, prog: string) => (root || w.root ? null : fehler(`${prog}: Forbidden`));
  b.lpadmin = (w, a, _i, root) => {
    const f = nurAdmin(w, root, 'lpadmin'); if (f) return f;
    const st = ds(w); const o: Record<string, string> = {};
    for (let i = 0; i < a.length; i++) { if (/^-[pdxvmPDLE]$/.test(a[i])) o[a[i][1]] = a[i] === '-E' ? '' : a[++i] ?? ''; }
    if ('x' in o) { if (!st.drucker[o.x]) return fehler(`lpadmin: The printer or class does not exist.`); delete st.drucker[o.x]; if (st.standard === o.x) st.standard = ''; druckerConf(w); return ok(); }
    if ('d' in o) { if (!st.drucker[o.d]) return fehler(`lpadmin: The printer or class does not exist.`); st.standard = o.d; druckerConf(w); return ok(); }
    if ('p' in o) {
      if (!/^[A-Za-z0-9_-]+$/.test(o.p)) return fehler('lpadmin: Printer name can only contain printable characters.');
      const d = st.drucker[o.p] ?? { uri: '', modell: 'Local Raw Printer', aktiv: false, akzeptiert: false, grund: '' };
      if (o.v) d.uri = o.v; if (o.m) d.modell = o.m === 'everywhere' ? 'IPP Everywhere' : o.m; if (o.D) d.modell = o.D;
      if (!d.uri) return fehler('lpadmin: Unable to set the printer options:\n(Für einen neuen Drucker braucht lpadmin ein Gerät mit -v, etwa -v ipp://192.168.1.41/ipp/print.)');
      if ('E' in o) { d.aktiv = true; d.akzeptiert = true; }
      st.drucker[o.p] = d; druckerConf(w); drucken(w); return ok();
    }
    return fehler('lpadmin: Usage: lpadmin -p NAME -E -v URI -m MODELL | lpadmin -d NAME | lpadmin -x NAME');
  };
  const schalter = (prog: string, f: (d: Drucker, grund: string) => void, root = true) => (w: Welt, a: string[], _i: string, r: boolean): Ergebnis => {
    if (root) { const x = nurAdmin(w, r, prog); if (x) return x; }
    const st = ds(w); const ri = a.indexOf('-r'); const grund = ri >= 0 ? a[ri + 1] ?? '' : '';
    const namen = a.filter((x, k) => !x.startsWith('-') && k !== ri + 1 || (ri < 0 && !x.startsWith('-')));
    if (!namen.length) return fehler(`${prog}: Usage: ${prog} [-c] [-r reason] destination(s)`);
    for (const n of namen) { const d = st.drucker[n]; if (!d) return fehler(`${prog}: Fehler - unbekanntes Druckziel "${n}".`); f(d, grund); if (prog === 'cupsdisable' && a.includes('-c')) st.jobs = st.jobs.filter((j) => j.ziel !== n); }
    druckerConf(w); drucken(w); return ok();
  };
  b.cupsenable = schalter('cupsenable', (d) => { d.aktiv = true; d.grund = ''; });
  b.cupsdisable = schalter('cupsdisable', (d, g) => { d.aktiv = false; d.grund = g || 'Paused'; });
  b.cupsaccept = schalter('cupsaccept', (d) => { d.akzeptiert = true; });
  b.cupsreject = schalter('cupsreject', (d, g) => { d.akzeptiert = false; d.grund = g || d.grund; });
  b.lpoptions = (w, a) => {
    const st = ds(w); const di = a.indexOf('-d');
    if (di >= 0) { const n = a[di + 1] ?? ''; if (!st.drucker[n]) return fehler(`lpoptions: Unknown printer or class.`); w.fs['/home/lena/.cups'] = null; w.fs['/home/lena/.cups/lpoptions'] = `Default ${n}\n`; return ok(`device-uri=${st.drucker[n].uri} printer-info='${st.drucker[n].modell}' printer-is-accepting-jobs=${st.drucker[n].akzeptiert} printer-state=${st.drucker[n].aktiv ? 3 : 5}`); }
    if (a.includes('-l')) return ok('PageSize/Media Size: A4 *Letter Legal\nDuplex/2-Sided Printing: *None DuplexNoTumble DuplexTumble\nColorModel/Output Mode: *Gray');
    return ok(`job-sheets=none,none media=iso_a4_210x297mm number-up=1 printer-info='${st.drucker[ziel(w)]?.modell ?? ''}'`);
  };
  b.lpinfo = (w, a, _i, root) => {
    const f = nurAdmin(w, root, 'lpinfo'); if (f) return f;
    if (a.includes('-v')) return ok('network ipp\nnetwork https\nnetwork socket\nnetwork lpd\nnetwork ipps\nnetwork http\nnetwork beh\nserial serial:/dev/ttyS0?baud=115200\ndirect usb://Brother/HL-L2350DW?serial=E78123A4N123456\nnetwork dnssd://HP%20LaserJet%20Pro%20M404n._ipp._tcp.local/?uuid=0d5c8e5a-1b2c-4d3e-8f90-a1b2c3d4e5f6');
    return ok('everywhere IPP Everywhere\ndrv:///sample.drv/generic.ppd Generic PostScript Printer\nlsb/usr/cupsfilters/textonly.ppd Generic text-only printer');
  };
  return b;
}

/** systemctl für rsyslog, cups, chrony und postfix. null = nicht zuständig. */
export function dienstSystemctl(w: Welt, a: string[], root: boolean): Ergebnis | null {
  const st = ds(w); const rest = a.filter((x) => !x.startsWith('-'));
  const [cmd, unit0] = rest; const unit = (unit0 ?? '').replace(/\.service$/, '');
  if (!['rsyslog', 'syslog', 'cups', 'chrony', 'chronyd', 'postfix', 'systemd-journald'].includes(unit)) return null;
  const name = unit === 'syslog' ? 'rsyslog' : unit === 'chronyd' ? 'chrony' : unit;
  if (name === 'rsyslog' && !('/etc/rsyslog.conf' in w.fs)) return fehler(`Unit ${unit0}.service could not be found.`, 4);
  const laeuft = name === 'rsyslog' ? st.rsyslog : name === 'chrony' ? st.ntp : true;
  if (cmd === 'status' || cmd === 'is-active') {
    if (cmd === 'is-active') return { out: laeuft ? 'active' : 'inactive', code: laeuft ? 0 : 3 };
    const titel: Record<string, string> = { rsyslog: 'System Logging Service', cups: 'CUPS Scheduler', chrony: 'chrony, an NTP client/server', postfix: 'Postfix Mail Transport Agent', 'systemd-journald': 'Journal Service' };
    return { out: `● ${name}.service - ${titel[name]}\n     Loaded: loaded (/lib/systemd/system/${name}.service; enabled; preset: enabled)\n     Active: ${laeuft ? 'active (running) since Mon 2026-11-23 08:12:05 CET; 29min ago' : 'inactive (dead)'}`, code: laeuft ? 0 : 3 };
  }
  if (!(root || w.root)) return fehler(`Failed to ${cmd} ${name}.service: Interactive authentication required.\nSee system logs and 'systemctl status ${name}.service' for details.`);
  if (name === 'rsyslog') {
    if (cmd === 'stop') { st.rsyslog = false; return ok(); }
    if (['restart', 'start', 'reload', 'force-reload', 'try-restart'].includes(cmd)) {
      const text = w.fs['/etc/rsyslog.conf'] ?? '';
      const f = regelFehler(w, text);
      st.rsyslog = true; st.rsyslogConf = rsyslogSchnappschuss(w);
      if (f) protokollieren(w, 'syslog', 3, 'rsyslogd', f.split('\n').pop()!.replace(/^rsyslogd: /, ''));
      return ok();
    }
  }
  if (name === 'chrony') { if (cmd === 'stop') st.ntp = false; if (['start', 'restart'].includes(cmd)) st.ntp = true; return ok(); }
  if (name === 'systemd-journald' && ['restart', 'reload'].includes(cmd)) {
    const conf = w.fs['/etc/systemd/journald.conf'] ?? '';
    const storage = conf.match(/^Storage=(\w+)/m)?.[1] ?? 'auto';
    st.journalFluechtig = storage === 'volatile' || storage === 'none' || (storage === 'auto' && !('/var/log/journal' in w.fs));
    if (!st.journalFluechtig && !('/var/log/journal' in w.fs)) w.fs['/var/log/journal'] = null;
    if (!st.journalFluechtig) { w.fs['/var/log/journal/4c2d8b1e7f9a4b03b5e2c1d6a8f7e9b0'] = null; w.fs['/var/log/journal/4c2d8b1e7f9a4b03b5e2c1d6a8f7e9b0/system.journal'] = '\u0007BIN:8388608'; }
    return ok();
  }
  return ok();
}

export function zustandDienste(w: Welt, s: string): boolean | undefined {
  const st = ds(w); let m;
  if (s === 'uhr:richtig') return Math.abs(st.uhrAbw) < 120000;
  if (s === 'rtc:richtig') return Math.abs(st.rtcAbw) < 1000;
  if (s === 'ntp:an') return st.ntp;
  if (s === 'rsyslog:aktuell') return st.rsyslog && JSON.stringify(st.rsyslogConf) === JSON.stringify(rsyslogSchnappschuss(w));
  if ((m = s.match(/^fernlog:(\S+)$/))) return st.fern.some((h) => h.split(':')[0] === m![1].split(':')[0]);
  if ((m = s.match(/^journal~(.+)$/))) { const re = new RegExp(m[1]); return st.journal.some((e) => re.test(`${e.tag}: ${e.text}`)); }
  if (s === 'journal:dauerhaft') return !st.journalFluechtig;
  if ((m = s.match(/^aliasdb:(\S+)=(\S+)$/))) return (st.aliasDb[m[1]] ?? []).includes(m[2]);
  if (s === 'mailq:leer') return st.queue.length === 0;
  if ((m = s.match(/^mailq~(.+)$/))) { const re = new RegExp(m[1]); return st.queue.some((q) => re.test(q.an)); }
  if ((m = s.match(/^drucker:(\S+)=(aktiv|deaktiviert|akzeptiert|abgelehnt|standard|da|weg)$/))) {
    const d = st.drucker[m[1]];
    return { aktiv: !!d?.aktiv, deaktiviert: !!d && !d.aktiv, akzeptiert: !!d?.akzeptiert, abgelehnt: !!d && !d.akzeptiert, standard: st.standard === m[1], da: !!d, weg: !d }[m[2]];
  }
  if ((m = s.match(/^druckjob:(\S+)~(.+)$/))) { const re = new RegExp(m[2]); return st.jobs.some((j) => j.ziel === m![1] && re.test(j.datei)); }
  if ((m = s.match(/^gedruckt~(.+)$/))) { const re = new RegExp(m[1]); return st.gedruckt.some((j) => re.test(j.datei)); }
  if ((m = s.match(/^keinjob:(\S+)$/))) return !st.jobs.some((j) => j.ziel === m![1]);
  return undefined;
}
