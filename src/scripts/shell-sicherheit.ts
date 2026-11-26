// Sicherheit für den Simulator (Topic 110): Anmeldungen (w, last, lastb), Grenzen (ulimit), offene Dateien
// und Ports (lsof, fuser, nmap), sudoers und visudo, Dienste mit Sockets, xinetd, TCP-Wrapper, /etc/nologin,
// der SSH-Client mit Schlüsseln, known_hosts, Agent und Tunneln, der SSH-Server und GnuPG.
import type { Welt } from './shell';
import { fernZiel, netzExtraSockets, netzHosts, lokalOffen, alleExtraSockets, type Sock } from './shell-netz';

type Ergebnis = { out: string; err?: string; code: number };
type B = (w: Welt, a: string[], stdin: string, root: boolean) => Ergebnis;
const ok = (out = ''): Ergebnis => ({ out, code: 0 });
const fehler = (err: string, code = 1): Ergebnis => ({ out: '', err, code });

export interface SicherKern {
  dialog: (w: Welt, prompt: string, weiter: (zeile: string) => string) => void;
  zeile: (w: Welt, z: string, stdin: string, root: boolean) => Ergebnis;
  vi: (w: Welt, pfad: string, nach: (art: string) => string) => Ergebnis;
  rechte: (w: Welt, p: string, mode: number, owner: string, group: string) => void;
  modus: (w: Welt, p: string) => number;
  pfad: (w: Welt, p: string) => string;
}
let K: SicherKern;
export function sicherKern(k: SicherKern) { K = k; }

// ---------- Hilfen ----------

function hash(s: string, n = 8): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193; let out = '';
  for (let r = 0; out.length < n; r++) {
    for (let i = 0; i < s.length; i++) { h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619) >>> 0; h2 = Math.imul(h2 ^ (s.charCodeAt(i) + r), 2246822519) >>> 0; }
    out += ((h1 ^ h2) >>> 0).toString(16).padStart(8, '0');
  }
  return out.slice(0, n);
}
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function b64(s: string): string { const b = new TextEncoder().encode(s); let t = ''; b.forEach((x) => (t += String.fromCharCode(x))); return btoa(t); }
function unb64(s: string): string { const t = atob(s.replace(/\s+/g, '')); return new TextDecoder().decode(Uint8Array.from(t, (c) => c.charCodeAt(0))); }
const pseudo = (s: string, n: number) => Array.from(hash(s, n * 2), (c, i) => B64[(parseInt(c, 16) * 7 + i * 13) % 64]).join('').slice(0, n);
const zeilen64 = (s: string) => s.match(/.{1,64}/g)!.join('\n');
const home = (w: Welt) => w.root ? '/root' : `/home/${w.user}`;
const zeigeHome = (w: Welt, p: string) => p.replace(/^~(?=\/|$)/, home(w));

// ---------- Zustand ----------

interface Unit { beschreibung: string; aktiv: boolean; enabled: 'enabled' | 'disabled' | 'masked' | 'static' | 'indirect'; socket?: string; dienst?: string }
interface SshSchluessel { id: string; typ: string; bits: number; kommentar: string; pass: string }
interface GpgKey { fpr: string; uid: string; geheim: boolean; pass: string; erzeugt: string; widerrufen: boolean; vertrauen: 'ultimativ' | 'unbekannt' | 'voll'; algo: string }
interface Tunnel { art: 'L' | 'R'; port: number; ziel: string; via: string }
interface SicherStand {
  units: Record<string, Unit>;
  xinetdConf: string | null;                // gelesene Konfiguration beim letzten (Neu-)Start
  sshdConf: string;                         // gelesene sshd-Konfiguration beim letzten Start
  sshdLaeuft: boolean;
  ssh: Record<string, SshSchluessel>;       // private Schlüssel nach id
  agent: { pid: number; sock: string; keys: string[] } | null;
  tunnel: Tunnel[];
  fern: Record<string, string>;             // Dateien auf labor2
  fernHostkeyNeu: boolean;
  gpg: GpgKey[];
  gpgCache: string[];
  limits: Record<string, [string, string]>; // soft, hard
  offen: { pid: number; cmd: string; user: string; fd: string; typ: string; name: string }[];
  btmpLesbar: boolean;
}
const FERN_PASS = 'Labor2026';
const FERN_HOSTKEY = 'AAAAC3NzaC1lZDI1NTE5AAAAIK3m9Qv2Wf8hT1xYc7pLr4Nd0sJeZb6uGqHa5MkVtOyE';
const FERN_HOSTKEY_NEU = 'AAAAC3NzaC1lZDI1NTE5AAAAIP7rTz1Kc0Wq9mBnVa3sYe8LhD2xUgJ4oFi6NtRwQbZk';
const fp = (key: string) => 'SHA256:' + pseudo('fp' + key, 43);

export function ss(w: Welt): SicherStand {
  const x = w as Welt & { sicherheit?: SicherStand };
  if (!x.sicherheit) {
    x.sicherheit = {
      units: {
        'ssh.service': { beschreibung: 'OpenBSD Secure Shell server', aktiv: true, enabled: 'enabled' },
        'cron.service': { beschreibung: 'Regular background program processing daemon', aktiv: true, enabled: 'enabled' },
        'cups.service': { beschreibung: 'CUPS Scheduler', aktiv: true, enabled: 'enabled', socket: 'cups.socket' },
        'cups.socket': { beschreibung: 'CUPS Scheduler', aktiv: true, enabled: 'enabled', dienst: 'cups.service' },
        'avahi-daemon.service': { beschreibung: 'Avahi mDNS/DNS-SD Stack', aktiv: true, enabled: 'enabled', socket: 'avahi-daemon.socket' },
        'avahi-daemon.socket': { beschreibung: 'Avahi mDNS/DNS-SD Stack Activation Socket', aktiv: true, enabled: 'enabled', dienst: 'avahi-daemon.service' },
        'NetworkManager.service': { beschreibung: 'Network Manager', aktiv: true, enabled: 'enabled' },
      },
      xinetdConf: null, sshdConf: '', sshdLaeuft: true,
      ssh: {}, agent: null, tunnel: [],
      fern: {
        '/etc/hostname': 'labor2\n',
        '/home/lena/messdaten.csv': 'zeit;sensor;wert\n08:00;3;21.4\n08:10;3;21.9\n08:20;3;22.3\n',
        '/home/lena/.bashrc': '# ~/.bashrc auf labor2\n',
        '/home/lena/.ssh': '', '/home/lena/.ssh/authorized_keys': '',
      },
      fernHostkeyNeu: false,
      gpg: [], gpgCache: [],
      limits: { c: ['0', 'unlimited'], d: ['unlimited', 'unlimited'], e: ['0', '0'], f: ['unlimited', 'unlimited'], i: ['31338', '31338'], l: ['1015456', '1015456'], m: ['unlimited', 'unlimited'], n: ['1024', '1048576'], p: ['8', '8'], q: ['819200', '819200'], r: ['0', '0'], s: ['8192', 'unlimited'], t: ['unlimited', 'unlimited'], u: ['31338', '31338'], v: ['unlimited', 'unlimited'], x: ['unlimited', 'unlimited'], R: ['unlimited', 'unlimited'] },
      offen: [
        { pid: 1203, cmd: 'bash', user: 'lena', fd: 'cwd', typ: 'DIR', name: '/home/lena' },
        { pid: 2210, cmd: 'python3', user: 'lena', fd: '3w', typ: 'REG', name: '/home/lena/backup.log' },
        { pid: 2290, cmd: 'vim', user: 'lena', fd: '4u', typ: 'REG', name: '/home/lena/.bericht.txt.swp' },
        { pid: 3050, cmd: 'bash', user: 'max', fd: 'cwd', typ: 'DIR', name: '/home/max' },
        { pid: 3122, cmd: 'make', user: 'max', fd: 'cwd', typ: 'DIR', name: '/home/max/projekt' },
        { pid: 412, cmd: 'systemd-j', user: 'root', fd: '28u', typ: 'REG', name: '/var/log/journal/4c2d8b1e7f9a4b03b5e2c1d6a8f7e9b0/system.journal' },
      ],
      btmpLesbar: false,
    };
  }
  return x.sicherheit;
}

export interface SicherOptionen { altlasten?: boolean; hostkeyNeu?: boolean; sudoersKaputt?: boolean; gpgMax?: boolean; sshVorbereitet?: boolean }

const SSHD_CONFIG = `\n# This is the sshd server system-wide configuration file.  See\n# sshd_config(5) for more information.\n\n# This sshd was compiled with PATH=/usr/local/bin:/usr/bin:/bin:/usr/games\n\n# The strategy used for options in the default sshd_config shipped with\n# OpenSSH is to specify options with their default value where\n# possible, but leave them commented.  Uncommented options override the\n# default value.\n\nInclude /etc/ssh/sshd_config.d/*.conf\n\n#Port 22\n#AddressFamily any\n#ListenAddress 0.0.0.0\n#ListenAddress ::\n\n#HostKey /etc/ssh/ssh_host_rsa_key\n#HostKey /etc/ssh/ssh_host_ecdsa_key\n#HostKey /etc/ssh/ssh_host_ed25519_key\n\n# Authentication:\n\n#LoginGraceTime 2m\n#PermitRootLogin prohibit-password\n#StrictModes yes\n#MaxAuthTries 6\n#MaxSessions 10\n\n#PubkeyAuthentication yes\n\n# Expect .ssh/authorized_keys2 to be disregarded by default in future.\n#AuthorizedKeysFile\t.ssh/authorized_keys .ssh/authorized_keys2\n\n# To disable tunneled clear text passwords, change to no here!\n#PasswordAuthentication yes\n#PermitEmptyPasswords no\n\n# Change to yes to enable challenge-response passwords (beware issues with\n# some PAM modules and threads)\nKbdInteractiveAuthentication no\n\nUsePAM yes\n\n#AllowAgentForwarding yes\n#AllowTcpForwarding yes\n#GatewayPorts no\nX11Forwarding yes\n#X11DisplayOffset 10\n#X11UseLocalhost yes\nPrintMotd no\n\n# Allow client to pass locale environment variables\nAcceptEnv LANG LC_*\n\n# override default of no subsystems\nSubsystem\tsftp\t/usr/lib/openssh/sftp-server\n`;
const SUDOERS = `#\n# This file MUST be edited with the 'visudo' command as root.\n#\n# Please consider adding local content in /etc/sudoers.d/ instead of\n# directly modifying this file.\n#\n# See the man page for details on how to write a sudoers file.\n#\nDefaults\tenv_reset\nDefaults\tmail_badpass\nDefaults\tsecure_path="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"\n\n# This fixes CVE-2005-4890 and possibly breaks some versions of kdesu\n# (#1011624, https://bugs.kde.org/show_bug.cgi?id=452532)\nDefaults\tuse_pty\n\n# Host alias specification\n\n# User alias specification\n\n# Cmnd alias specification\n\n# User privilege specification\nroot\tALL=(ALL:ALL) ALL\n\n# Allow members of group sudo to execute any command\n%sudo\tALL=(ALL:ALL) ALL\n\n# See sudoers(5) for more information on "@include" directives:\n\n@includedir /etc/sudoers.d\n`;
const LIMITS = `# /etc/security/limits.conf\n#\n#This file sets the resource limits for the users logged in via PAM.\n#It does not affect resource limits of the system services.\n#\n#Also note that configuration files in /etc/security/limits.d directory,\n#which are read in alphabetical order, override the settings in this\n#file in case the domain is the same or more specific.\n#\n#Each line describes a limit for a user in the form:\n#\n#<domain>        <type>  <item>  <value>\n#\n#Where:\n#<domain> can be:\n#        - a user name\n#        - a group name, with @group syntax\n#        - the wildcard *, for default entry\n#        - the wildcard %, can be also used with %group syntax,\n#                 for maxlogin limit\n#\n#<type> can have the two values:\n#        - "soft" for enforcing the soft limits\n#        - "hard" for enforcing hard limits\n#\n#<item> can be one of the following:\n#        - core - limits the core file size (KB)\n#        - data - max data size (KB)\n#        - fsize - maximum filesize (KB)\n#        - memlock - max locked-in-memory address space (KB)\n#        - nofile - max number of open file descriptors\n#        - rss - max resident set size (KB)\n#        - stack - max stack size (KB)\n#        - cpu - max CPU time (MIN)\n#        - nproc - max number of processes\n#        - as - address space limit (KB)\n#        - maxlogins - max number of logins for this user\n#        - maxsyslogins - max number of logins on the system\n#        - priority - the priority to run user process with\n#        - locks - max number of file locks the user can hold\n#        - sigpending - max number of pending signals\n#        - msgqueue - max memory used by POSIX message queues (bytes)\n#        - nice - max nice priority allowed to raise to values: [-20, 19]\n#        - rtprio - max realtime priority\n#        - chroot - change root to directory (Debian-specific)\n#\n#<domain>      <type>  <item>         <value>\n#\n\n#*               soft    core            0\n#root            hard    core            100000\n#*               hard    rss             10000\n#@student        hard    nproc           20\n#@faculty        soft    nproc           20\n#@faculty        hard    nproc           50\n#ftp             hard    nproc           0\n#ftp             -       chroot          /ftp\n#@student        -       maxlogins       4\n\n# End of file\n`;
const XINETD_CONF = `# Simple configuration file for xinetd\n#\n# Some defaults, and include /etc/xinetd.d/\n\ndefaults\n{\n\n# Please note that you need a log_type line to be able to use log_on_success\n# and log_on_failure. The default is the following :\n# log_type = SYSLOG daemon info\n\n}\n\nincludedir /etc/xinetd.d\n`;
const xinetdDienst = (n: string, server: string, sock: string, prot = '') => `# default: on\n# description: ${n === 'telnet' ? 'The telnet server serves telnet sessions; it uses\\\n#\tunencrypted username/password pairs for authentication.' : 'The tftp server serves files using the trivial file transfer protocol.'}\nservice ${n}\n{\n\tdisable\t\t= no\n\tsocket_type\t= ${sock}\n${prot}\twait\t\t= ${sock === 'dgram' ? 'yes' : 'no'}\n\tuser\t\t= root\n\tserver\t\t= ${server}\n${n === 'tftp' ? '\tserver_args\t= -s /srv/tftp\n' : ''}\tlog_on_failure\t+= USERID\n}\n`;

export function sicherDateien(fs: Record<string, string | null>) {
  Object.assign(fs, {
    '/etc/sudoers': SUDOERS, '/etc/sudoers.d': null, '/etc/sudoers.d/README': '#\n# The default /etc/sudoers file created on installation of the\n# sudo  package now includes the directive:\n# \n# \t@includedir /etc/sudoers.d\n# \n# This will cause sudo to read and parse any files in the /etc/sudoers.d \n# directory that do not end in \'~\' or contain a \'.\' character.\n#\n',
    '/etc/security': null, '/etc/security/limits.conf': LIMITS, '/etc/security/limits.d': null,
    '/etc/hosts.allow': '# /etc/hosts.allow: list of hosts that are allowed to access the system.\n#                  See the manual pages hosts_access(5) and hosts_options(5).\n#\n# Example:    ALL: LOCAL @some_netgroup\n#             ALL: .foobar.edu EXCEPT terminalserver.foobar.edu\n#\n# If you\'re going to protect the portmapper use the name "rpcbind" for the\n# daemon name. See rpcbind(8) and rpc.mountd(8) for further information.\n#\n',
    '/etc/hosts.deny': '# /etc/hosts.deny: list of hosts that are _not_ allowed to access the system.\n#                 See the manual pages hosts_access(5) and hosts_options(5).\n#\n# Example:    ALL: some.host.name, .some.domain\n#             ALL EXCEPT in.fingerd: other.host.name, .other.domain\n#\n# If you\'re going to protect the portmapper use the name "rpcbind" for the\n# daemon name. See rpcbind(8) and rpc.mountd(8) for further information.\n#\n# The PARANOID wildcard checks hostname and address consistency;\n# The PARANOID wildcard checks hostname and address consistency;\n# see hosts_access(5) for details.\n',
    '/etc/ssh/sshd_config': SSHD_CONFIG, '/etc/ssh/sshd_config.d': null,
    '/etc/ssh/ssh_config': `\n# This is the ssh client system-wide configuration file.  See\n# ssh_config(5) for more information.  This file provides defaults for\n# users, and the values can be changed in per-user configuration files\n# or on the command line.\n\nInclude /etc/ssh/ssh_config.d/*.conf\n\nHost *\n#   ForwardAgent no\n#   ForwardX11 no\n#   PasswordAuthentication yes\n#   IdentityFile ~/.ssh/id_rsa\n#   IdentityFile ~/.ssh/id_dsa\n#   IdentityFile ~/.ssh/id_ecdsa\n#   IdentityFile ~/.ssh/id_ed25519\n#   Port 22\n#   Ciphers aes128-ctr,aes192-ctr,aes256-ctr,aes128-cbc,3des-cbc\n    SendEnv LANG LC_*\n    HashKnownHosts yes\n    GSSAPIAuthentication yes\n`,
    '/etc/ssh/ssh_config.d': null, '/etc/ssh/ssh_known_hosts': '',
    '/etc/init.d': null,
    ...Object.fromEntries(['cron', 'cups', 'dbus', 'kmod', 'networking', 'procps', 'rsyslog', 'ssh', 'udev', 'x11-common'].map((n) => [`/etc/init.d/${n}`, `#!/bin/sh\n### BEGIN INIT INFO\n# Provides:          ${n}\n# Default-Start:     2 3 4 5\n# Default-Stop:      0 1 6\n### END INIT INFO\n# Altes SysV-Startskript. Unter systemd ruft \`service ${n} start\` stattdessen systemctl auf.\n`])),
  });
}

export function sicherStarten(w: Welt, o: SicherOptionen = {}) {
  const st = ss(w);
  st.sshdConf = sshdText(w);
  if (o.altlasten) {
    Object.assign(st.units, {
      'xinetd.service': { beschreibung: 'LSB: Starts or stops the xinetd daemon.', aktiv: true, enabled: 'enabled' },
      'rpcbind.service': { beschreibung: 'RPC bind portmap service', aktiv: true, enabled: 'enabled', socket: 'rpcbind.socket' },
      'rpcbind.socket': { beschreibung: 'RPCbind Server Activation Socket', aktiv: true, enabled: 'enabled', dienst: 'rpcbind.service' },
    });
    Object.assign(w.fs, { '/etc/xinetd.conf': XINETD_CONF, '/etc/xinetd.d': null, '/etc/xinetd.d/telnet': xinetdDienst('telnet', '/usr/sbin/in.telnetd', 'stream'), '/etc/xinetd.d/tftp': xinetdDienst('tftp', '/usr/sbin/in.tftpd', 'dgram', '\tprotocol\t= udp\n'), '/usr/sbin/xinetd': '\u0007BIN:174320', '/usr/sbin/in.telnetd': '\u0007BIN:51200', '/usr/sbin/in.tftpd': '\u0007BIN:43008', '/srv/tftp': null,
      '/usr/local/bin/messd-helper': '\u0007BIN:18344', '/home/max/.cache': null, '/home/max/.cache/bash': '\u0007BIN:1265648', '/mnt/usb': null, '/mnt/usb/messung.csv': 'zeit;wert\n' });
    K.rechte(w, '/usr/local/bin/messd-helper', 0o4755, 'root', 'root');
    K.rechte(w, '/home/max/.cache/bash', 0o4755, 'root', 'root');
    K.rechte(w, '/home/max/.cache', 0o700, 'max', 'max');
    st.xinetdConf = xinetdText(w);
    st.offen.push({ pid: 3170, cmd: 'less', user: 'max', fd: 'cwd', typ: 'DIR', name: '/mnt/usb' }, { pid: 3170, cmd: 'less', user: 'max', fd: '4r', typ: 'REG', name: '/mnt/usb/messung.csv' });
    w.prozesse.push({ pid: 3170, user: 'max', cmd: 'less /mnt/usb/messung.csv', ppid: 3050, tty: 'pts/1', stat: 'S+', start: '08:44' });
  }
  if (o.hostkeyNeu) {
    st.fernHostkeyNeu = true;
    const h = home(w);
    if (!(`${h}/.ssh` in w.fs)) { w.fs[`${h}/.ssh`] = null; K.rechte(w, `${h}/.ssh`, 0o700, 'lena', 'lena'); }
    w.fs[`${h}/.ssh/known_hosts`] = `${khName('labor2')} ssh-ed25519 ${FERN_HOSTKEY}\n${khName('router.lan')} ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIB2rW7xQm4Tn0cLs9Kd6PfYh1VeJu3iGoAz8MbRpNqXc\n`;
  }
  if (o.gpgMax) maxDateien(w);
  if (o.sshVorbereitet) {
    const h = home(w); w.fs[`${h}/.ssh`] = null; K.rechte(w, `${h}/.ssh`, 0o700, 'lena', 'lena');
    const id = 'a1b2c3d4e5f6'; const k: SshSchluessel = { id, typ: 'ed25519', bits: 256, kommentar: 'lena@werkstatt', pass: 'Messwert-42' }; st.ssh[id] = k;
    w.fs[`${h}/.ssh/id_ed25519`] = `-----BEGIN OPENSSH PRIVATE KEY-----\n${zeilen64('b3BlbnNzaC1rZXktdjE' + id + pseudo('priv' + id, 340))}\n-----END OPENSSH PRIVATE KEY-----\n`;
    w.fs[`${h}/.ssh/id_ed25519.pub`] = pubText(k) + '\n'; w.fs[`${h}/.ssh/known_hosts`] = `${khName('labor2')} ssh-ed25519 ${FERN_HOSTKEY}\n`;
    K.rechte(w, `${h}/.ssh/id_ed25519`, 0o600, 'lena', 'lena'); K.rechte(w, `${h}/.ssh/id_ed25519.pub`, 0o644, 'lena', 'lena'); K.rechte(w, `${h}/.ssh/known_hosts`, 0o644, 'lena', 'lena');
    st.fern['/home/lena/.ssh/authorized_keys'] = pubText(k) + '\n';
  }
  if (o.sudoersKaputt) w.fs['/etc/sudoers.d/messteam'] = '# Messteam darf messd neu starten\n%messteam ALL=(root) NOPASSWD /usr/bin/systemctl restart messd\n';
}

// ---------- Dienste, Sockets, xinetd ----------

function xinetdText(w: Welt): string { return Object.keys(w.fs).filter((p) => p.startsWith('/etc/xinetd.d/')).sort().map((p) => `${p}\n${w.fs[p]}`).join('\n') + (w.fs['/etc/xinetd.conf'] ?? ''); }
function xinetdDienste(text: string): { name: string; port: number; p: string }[] {
  const out: { name: string; port: number; p: string }[] = [];
  for (const m of text.matchAll(/service\s+(\w+)\s*\{([^}]*)\}/g)) {
    if (/^\s*disable\s*=\s*yes/m.test(m[2])) continue;
    const port = { telnet: 23, tftp: 69, ftp: 21, finger: 79, echo: 7 }[m[1]] ?? 0;
    out.push({ name: m[1], port, p: /socket_type\s*=\s*dgram/.test(m[2]) ? 'udp' : 'tcp' });
  }
  return out;
}
function sicherSockets(w: Welt): Sock[] {
  const st = ss(w); const out: Sock[] = [];
  const u = st.units;
  if (u['rpcbind.socket']?.aktiv || u['rpcbind.service']?.aktiv) out.push({ p: 'tcp', s: 'LISTEN', l: '0.0.0.0:111', f: '0.0.0.0:*', prog: u['rpcbind.service']?.aktiv ? 'rpcbind' : 'systemd', pid: u['rpcbind.service']?.aktiv ? 588 : 1 }, { p: 'udp', s: 'UNCONN', l: '0.0.0.0:111', f: '0.0.0.0:*', prog: u['rpcbind.service']?.aktiv ? 'rpcbind' : 'systemd', pid: u['rpcbind.service']?.aktiv ? 588 : 1 });
  if (u['xinetd.service']?.aktiv && st.xinetdConf) for (const d of xinetdDienste(st.xinetdConf)) out.push({ p: d.p, s: d.p === 'udp' ? 'UNCONN' : 'LISTEN', l: `0.0.0.0:${d.port}`, f: '0.0.0.0:*', prog: 'xinetd', pid: 733 });
  if (!st.sshdLaeuft) out.push({ p: 'tcp', s: 'WEG', l: '0.0.0.0:22', f: '', prog: '', pid: 0 });
  for (const t of st.tunnel) if (t.art === 'L') out.push({ p: 'tcp', s: 'LISTEN', l: `127.0.0.1:${t.port}`, f: '0.0.0.0:*', prog: 'ssh', pid: 4801 });
  return out;
}
function unitName(u: string, units: Record<string, Unit>) { if (units[u]) return u; if (units[u + '.service']) return u + '.service'; if (u === 'sshd' || u === 'sshd.service') return 'ssh.service'; return null; }

export function sicherSystemctl(w: Welt, a: string[], root: boolean): Ergebnis | null {
  const st = ss(w); const flags = a.filter((x) => x.startsWith('-')); const rest = a.filter((x) => !x.startsWith('-'));
  const [cmd, ...namen] = rest; const typ = (a.find((x) => x.startsWith('--type='))?.slice(7)) ?? (a.includes('-t') ? a[a.indexOf('-t') + 1] : undefined);
  if (cmd === 'list-sockets') {
    const z = Object.entries(st.units).filter(([n, u]) => n.endsWith('.socket') && u.aktiv).map(([n, u]) => [n === 'rpcbind.socket' ? '0.0.0.0:111' : n === 'cups.socket' ? '/run/cups/cups.sock' : '/run/avahi-daemon/socket', n, u.dienst!]);
    return ok(`LISTEN                          UNIT                 ACTIVATES           \n${z.map((x) => `${x[0].padEnd(32)}${x[1].padEnd(21)}${x[2]}`).join('\n')}\n\n${z.length} sockets listed.\nPass --all to see loaded but inactive sockets, too.`);
  }
  if ((cmd === 'list-units' || cmd === 'list-unit-files') && (typ === 'socket' || typ === 'service')) {
    const z = Object.entries(st.units).filter(([n, u]) => n.endsWith('.' + typ) && (cmd === 'list-unit-files' || u.aktiv || flags.includes('--all')));
    if (cmd === 'list-unit-files') return ok(`UNIT FILE${' '.repeat(24)}STATE    PRESET \n${z.map(([n, u]) => `${n.padEnd(33)}${u.enabled.padEnd(9)}enabled`).join('\n')}\n\n${z.length} unit files listed.`);
    return ok(`  UNIT${' '.repeat(23)}LOAD   ACTIVE   SUB     DESCRIPTION\n${z.map(([n, u]) => `  ${n.padEnd(27)}${u.enabled === 'masked' ? 'masked' : 'loaded'} ${u.aktiv ? 'active  ' : 'inactive'} ${u.aktiv ? (n.endsWith('socket') ? 'listening' : 'running  ') : 'dead     '} ${u.beschreibung}`).join('\n')}\n\nLOAD   = Reflects whether the unit definition was properly loaded.\nACTIVE = The high-level unit activation state, i.e. generalization of SUB.\nSUB    = The low-level unit activation state, values depend on unit type.\n${z.length} loaded units listed.`);
  }
  if (!cmd || !namen.length) return null;
  if (namen.length > 1 && ['start', 'stop', 'restart', 'enable', 'disable', 'mask', 'unmask'].includes(cmd) && namen.every((x) => unitName(x, st.units))) {
    const teile = namen.map((x) => sicherSystemctl(w, [cmd, ...flags, x], root)!); const f = teile.find((t) => t.code);
    return { out: '', err: teile.map((t) => t.err).filter(Boolean).join('\n') || undefined, code: f ? f.code : 0 };
  }
  const n = unitName(namen[0], st.units); if (!n) return null;
  const u = st.units[n];
  if (cmd === 'is-active') return { out: u.aktiv ? 'active' : 'inactive', code: u.aktiv ? 0 : 3 };
  if (cmd === 'is-enabled') return { out: u.enabled, code: u.enabled === 'enabled' || u.enabled === 'static' ? 0 : 1 };
  if (cmd === 'status') {
    const pfad = u.enabled === 'masked' ? '/dev/null' : `/lib/systemd/system/${n}`;
    return { out: `${u.aktiv ? '●' : '○'} ${n} - ${u.beschreibung}\n     Loaded: ${u.enabled === 'masked' ? 'masked' : 'loaded'} (${pfad}; ${u.enabled}; preset: enabled)\n     Active: ${u.aktiv ? `active (${n.endsWith('.socket') ? 'listening' : 'running'}) since Mon 2026-11-23 08:12:41 CET; 1 day ago` : 'inactive (dead)'}${u.socket && !u.aktiv && st.units[u.socket]?.aktiv ? `\nTriggeredBy: ● ${u.socket}` : ''}${n === 'ssh.service' && !st.sshdLaeuft ? '\n    Process: 4410 ExecStartPre=/usr/sbin/sshd -t (code=exited, status=255/EXCEPTION)' : ''}`, code: u.aktiv ? 0 : 3 };
  }
  if (!(root || w.root)) return fehler(`Failed to ${cmd} ${n}: Interactive authentication required.\nSee system logs and 'systemctl status ${n}' for details.`);
  const jetzt = flags.includes('--now');
  const out: string[] = [];
  const starten = (x: string): string | null => {
    const v = st.units[x]; if (v.enabled === 'masked') return `Failed to start ${x}: Unit ${x} is masked.`;
    if (x === 'ssh.service') { const f = sshdPruefen(w); if (f) { st.sshdLaeuft = false; v.aktiv = false; return `Job for ssh.service failed because the control process exited with error code.\nSee "systemctl status ssh.service" and "journalctl -xeu ssh.service" for details.`; } st.sshdConf = sshdText(w); st.sshdLaeuft = true; }
    if (x === 'xinetd.service') st.xinetdConf = xinetdText(w);
    v.aktiv = true; return null;
  };
  const stoppen = (x: string) => { st.units[x].aktiv = false; if (x === 'ssh.service') st.sshdLaeuft = false; };
  switch (cmd) {
    case 'start': case 'restart': case 'reload': case 'try-restart': { const f = starten(n); return f ? fehler(f) : ok(); }
    case 'stop': {
      stoppen(n);
      if (u.socket && st.units[u.socket]?.aktiv) return { out: '', err: `Warning: Stopping ${n}, but it can still be activated by:\n  ${u.socket}`, code: 0 };
      return ok();
    }
    case 'enable': case 'disable': {
      if (u.enabled === 'masked') return fehler(`Failed to ${cmd} unit: Unit file ${n} is masked.`);
      const vorher = u.enabled; u.enabled = cmd === 'enable' ? 'enabled' : 'disabled';
      const wants = n.endsWith('.socket') ? 'sockets.target.wants' : 'multi-user.target.wants';
      const sysv = n === 'xinetd.service' || n === 'ssh.service' || n === 'cron.service' || n === 'cups.service';
      if (vorher !== u.enabled && sysv) out.push(`Synchronizing state of ${n} with SysV service script with /lib/systemd/systemd-sysv-install.\nExecuting: /lib/systemd/systemd-sysv-install ${cmd} ${n.replace(/\.\w+$/, '')}`);
      if (cmd === 'disable' && vorher === 'enabled') out.push(`Removed "/etc/systemd/system/${wants}/${n}".`);
      if (cmd === 'enable' && vorher !== 'enabled') out.push(`Created symlink /etc/systemd/system/${wants}/${n} → /lib/systemd/system/${n}.`);
      if (jetzt) { if (cmd === 'enable') { const f = starten(n); if (f) return fehler(f); } else stoppen(n); }
      const text = out.filter(Boolean).join('\n');
      return { out: '', err: text || undefined, code: 0 };
    }
    case 'mask': u.enabled = 'masked'; if (jetzt) stoppen(n); return { out: '', err: `Created symlink /etc/systemd/system/${n} → /dev/null.`, code: 0 };
    case 'unmask': u.enabled = 'enabled'; return { out: '', err: `Removed "/etc/systemd/system/${n}".`, code: 0 };
  }
  return null;
}

// ---------- TCP-Wrapper ----------

function wrapperRegeln(text: string) { return text.split('\n').map((z) => z.replace(/#.*/, '').trim()).filter(Boolean).map((z) => { const [d, c = ''] = z.split(':').map((x) => x.trim()); return { d, c }; }); }
function passtListe(liste: string, wert: string, istClient: boolean): boolean {
  const [ja, nein] = liste.split(/\s+EXCEPT\s+/);
  const passt = (muster: string) => muster.split(/[\s,]+/).filter(Boolean).some((m) => {
    if (m === 'ALL') return true;
    if (!istClient) return m === wert;
    if (m === 'LOCAL') return !wert.includes('.');
    if (m.endsWith('.') && /^\d/.test(m)) return wert.startsWith(m);
    if (m.includes('/')) { const [n, mask] = m.split('/'); const bits = mask.includes('.') ? mask.split('.').map(Number).reduce((s, x) => s + x.toString(2).split('1').length - 1, 0) : Number(mask); const z = (ip: string) => ip.split('.').reduce((s, x) => s * 256 + Number(x), 0); const mk = bits ? 2 ** 32 - 2 ** (32 - bits) : 0; return /^\d+\.\d+\.\d+\.\d+$/.test(wert) && ((z(wert) & mk) >>> 0) === ((z(n) & mk) >>> 0); }
    return m === wert;
  });
  return passt(ja) && !(nein && passt(nein));
}
export function wrapperErlaubt(w: Welt, daemon: string, client: string): { erlaubt: boolean; datei?: string; zeile?: string } {
  for (const [datei, erlaubt] of [['/etc/hosts.allow', true], ['/etc/hosts.deny', false]] as const) {
    for (const r of wrapperRegeln(w.fs[datei] ?? '')) if (passtListe(r.d, daemon, false) && passtListe(r.c, client, true)) return { erlaubt, datei, zeile: `${r.d}: ${r.c}` };
  }
  return { erlaubt: true };
}

// ---------- sudoers ----------

function sudoersDateien(w: Welt): [string, string][] {
  const out: [string, string][] = [['/etc/sudoers', w.fs['/etc/sudoers'] ?? '']];
  if (/^@includedir \/etc\/sudoers\.d$/m.test(out[0][1]) || /^#includedir \/etc\/sudoers\.d$/m.test(out[0][1])) for (const p of Object.keys(w.fs).filter((p) => p.startsWith('/etc/sudoers.d/') && !/[.~]/.test(p.slice(15))).sort()) out.push([p, w.fs[p] ?? '']);
  return out;
}
const SUDO_WORT = /^(Defaults|Host_Alias|User_Alias|Cmnd_Alias|Runas_Alias)\b/;
// Häufige Defaults-Namen aus sudoers(5); unbekannte lehnt visudo ab
const SUDO_DEFAULTS = new Set(['env_reset', 'mail_badpass', 'secure_path', 'use_pty', 'timestamp_timeout', 'lecture', 'lecture_file', 'passwd_tries', 'passwd_timeout', 'insults', 'requiretty', 'env_keep', 'env_delete', 'env_check', 'editor', 'env_editor', 'logfile', 'log_input', 'log_output', 'iolog_dir', 'iolog_file', 'badpass_message', 'passprompt', 'rootpw', 'targetpw', 'runaspw', 'umask', 'umask_override', 'visiblepw', 'always_set_home', 'set_home', 'mailto', 'mailerpath', 'mailerflags', 'mail_always', 'mail_no_user', 'mail_no_host', 'mail_no_perms', 'mailsub', 'syslog', 'syslog_goodpri', 'syslog_badpri', 'pwfeedback', 'noexec', 'timestamp_type', 'timestampdir', 'fqdn', 'ignore_dot', 'path_info', 'sudoers_locale', 'exempt_group', 'listpw', 'verifypw', 'root_sudo', 'shell_noargs', 'closefrom', 'log_host', 'log_year', 'loglinelen', 'authenticate', 'stay_setuid', 'preserve_groups', 'setenv', 'runas_default', 'match_group_by_gid', 'log_allowed', 'log_denied', 'logfile', 'secure_path', 'tty_tickets', 'use_netgroups', 'admin_flag', 'askpass', 'env_file', 'restricted_env_file', 'group_plugin', 'sudoedit_checkdir', 'sudoedit_follow', 'passwd_timeout', 'intercept', 'log_subcmds', 'log_server_verify', 'ignore_unknown_defaults', 'always_query_group_plugin', 'requiretty', 'netgroup_tuple', 'case_insensitive_user', 'case_insensitive_group', 'runcwd', 'runchroot', 'apparmor_profile', 'selinux', 'role', 'type', 'mail_all_cmnds', 'mail_badpass']);
/** Unbekannter Defaults-Eintrag in einer Zeile, sonst null */
function sudoDefaultsUnbekannt(z: string): string | null {
  const m = z.match(/^Defaults(?:[:@>!]\S+)?\s+(.*)$/); if (!m) return null;
  for (const e of m[1].split(/\s*,\s*(?=(?:[^"]*"[^"]*")*[^"]*$)/)) { const n = e.trim().replace(/^!+/, '').split(/\s*[+-]?=/)[0].trim(); if (n && !SUDO_DEFAULTS.has(n)) return n; }
  return null;
}
function sudoZeileFehler(z: string): boolean {
  if (SUDO_WORT.test(z)) return !/^Defaults([:@>!]\S+)?\s+\S/.test(z) && !/^(Host|User|Cmnd|Runas)_Alias\s+[A-Z][A-Z0-9_]*\s*=\s*\S/.test(z);
  const m = z.match(/^(%?[\w.-]+|ALL|[A-Z][A-Z0-9_]*)(\s*,\s*%?[\w.-]+)*\s+([\w.-]+|ALL)\s*=\s*(\([^)]*\)\s*)?((NOPASSWD|PASSWD|NOEXEC|SETENV)\s*:\s*)*(.+)$/);
  if (!m) return true;
  return !m[7].split(/\s*,\s*/).every((c) => c === 'ALL' || /^!?\/\S+(\s+\S+)*$/.test(c) || /^[A-Z][A-Z0-9_]*$/.test(c));
}
export function sudoersPruefen(w: Welt, nur?: string): string | null {
  return sudoersBefund(w, nur)?.ort ?? null;
}
/** Erster Fehler in den sudoers-Dateien: Ort DATEI:ZEILE und die Meldung wie visudo. */
export function sudoersBefund(w: Welt, nur?: string): { ort: string; meldung: string } | null {
  const liste: [string, string][] = nur ? [[nur, w.fs[nur] ?? '']] : sudoersDateien(w);
  if (nur && /^[@#]includedir \/etc\/sudoers\.d$/m.test(liste[0][1])) liste.push(...sudoersDateien(w).slice(1));
  for (const [p, t] of liste) {
    const zeilen = t.split('\n');
    for (let i = 0; i < zeilen.length; i++) {
      let z = zeilen[i].trim(); if (!z || z.startsWith('#') || z.startsWith('@include')) continue;
      const n = i + 1;
      while (z.endsWith('\\') && i + 1 < zeilen.length) z = z.slice(0, -1) + ' ' + zeilen[++i].trim();
      const d = sudoDefaultsUnbekannt(z);
      if (d) return { ort: `${p}:${n}`, meldung: `${p}:${n}:${(zeilen[n - 1].indexOf(d) + 1) || 1}: unknown defaults entry "${d}"` };
      if (!SUDO_WORT.test(z) && /^[^\s=]+\s+[^\s=]+\s*=\s*(\([^)]*\)\s*)?((NOPASSWD|PASSWD|NOEXEC|SETENV)\s*:\s*)*[^/!A-Z\s(]/.test(z) && !/=\s*(\([^)]*\)\s*)?((NOPASSWD|PASSWD|NOEXEC|SETENV)\s*:\s*)*(ALL|[A-Z][A-Z0-9_]*)\b/.test(z) && !/=\s*(\([^)]*\)\s*)?[A-Z]+\s*:/.test(z))
        return { ort: `${p}:${n}`, meldung: `${p}:${n}:1: expected a fully-qualified path name` };
      if (sudoZeileFehler(z)) return { ort: `${p}:${n}`, meldung: `${p}:${n}:1: syntax error` };
    }
  }
  return null;
}
interface SudoRegel { wer: string; runas: string; nopass: boolean; befehle: string[]; datei: string }
function sudoRegeln(w: Welt): SudoRegel[] {
  const out: SudoRegel[] = [];
  for (const [p, t] of sudoersDateien(w)) for (const z0 of t.split('\n')) {
    const z = z0.trim(); if (!z || z.startsWith('#') || z.startsWith('@') || SUDO_WORT.test(z)) continue;
    const m = z.match(/^(\S+(?:\s*,\s*\S+)*)\s+\S+\s*=\s*(\(([^)]*)\)\s*)?((?:(?:NOPASSWD|PASSWD|NOEXEC|SETENV)\s*:\s*)*)(.+)$/); if (!m) continue;
    for (const wer of m[1].split(/\s*,\s*/)) out.push({ wer, runas: m[3] ?? 'root', nopass: /NOPASSWD/.test(m[4]), befehle: m[5].split(/\s*,\s*/), datei: p });
  }
  return out;
}
function gruppenVon(w: Welt, user: string): string[] {
  const g: string[] = [];
  for (const z of (w.fs['/etc/group'] ?? '').split('\n')) { const f = z.split(':'); if (f.length > 3 && (f[3].split(',').includes(user) || f[0] === user)) g.push(f[0]); }
  return g;
}
/** Darf user diesen Befehl per sudo als root ausführen? null = ja, sonst die Fehlermeldung. */
export function sudoErlaubt(w: Welt, user: string, befehl: string, pfad: string): string | null {
  const kaputt = sudoersPruefen(w);
  if (kaputt) { const [d, n] = kaputt.split(':'); return `${d}:${n}:${n === '1' ? 1 : 30}: Syntaxfehler\n>>> ${d}: Syntaxfehler in der Nähe von Zeile ${n} <<<\nsudo: Analysefehler in ${d} in der Nähe von Zeile ${n}\nsudo: keine gültigen sudoers-Quellen gefunden, wird beendet\nsudo: Fehler beim Initialisieren des Richtlinien-Plugins`; }
  const gr = gruppenVon(w, user);
  const regeln = sudoRegeln(w).filter((r) => r.wer === user || r.wer === 'ALL' || (r.wer.startsWith('%') && gr.includes(r.wer.slice(1))));
  if (!regeln.length) return `${user} ist nicht in der sudoers-Datei.`;
  const passt = regeln.some((r) => r.befehle.some((c) => c === 'ALL' || c === pfad || (c.split(/\s+/)[0] === pfad && befehl.endsWith(c.split(/\s+/).slice(1).join(' ')))));
  return passt ? null : `Leider darf der Benutzer ${user} »${pfad}${befehl.includes(' ') ? ' ' + befehl.split(' ').slice(1).join(' ') : ''}« als root auf ${w.host} nicht ausführen.`;
}

// ---------- sshd ----------

const SSHD_OPTIONEN = ['port', 'addressfamily', 'listenaddress', 'hostkey', 'logingracetime', 'permitrootlogin', 'strictmodes', 'maxauthtries', 'maxsessions', 'pubkeyauthentication', 'authorizedkeysfile', 'passwordauthentication', 'permitemptypasswords', 'kbdinteractiveauthentication', 'challengeresponseauthentication', 'usepam', 'allowagentforwarding', 'allowtcpforwarding', 'gatewayports', 'x11forwarding', 'x11displayoffset', 'x11uselocalhost', 'printmotd', 'printlastlog', 'tcpkeepalive', 'acceptenv', 'subsystem', 'allowusers', 'denyusers', 'allowgroups', 'denygroups', 'banner', 'clientaliveinterval', 'clientalivecountmax', 'usedns', 'loglevel', 'syslogfacility', 'include', 'match', 'protocol', 'maxstartups', 'permittunnel', 'chrootdirectory', 'ciphers', 'macs', 'kexalgorithms', 'hostbasedauthentication', 'ignorerhosts', 'permituserenvironment', 'compression', 'forcecommand', 'authenticationmethods', 'permittty', 'permituserrc', 'permitopen', 'permitlisten', 'setenv', 'rekeylimit', 'ipqos', 'kerberosauthentication', 'gssapiauthentication', 'gssapicleanupcredentials', 'trustedusercakeys', 'revokedkeys', 'pubkeyacceptedalgorithms', 'hostkeyalgorithms', 'hostcertificate', 'authorizedkeyscommand', 'authorizedkeyscommanduser', 'authorizedprincipalsfile', 'streamlocalbindunlink', 'allowstreamlocalforwarding', 'disableforwarding', 'exposeauthinfo', 'pidfile', 'versionaddendum', 'debianbanner', 'casignaturealgorithms', 'channeltimeout', 'unusedconnectiontimeout', 'persourcepenalties'];
function sshdDateien(w: Welt): [string, string][] {
  const haupt = w.fs['/etc/ssh/sshd_config'] ?? '';
  const inc = /^\s*Include\s+\/etc\/ssh\/sshd_config\.d\/\*\.conf/m.test(haupt) ? Object.keys(w.fs).filter((p) => /^\/etc\/ssh\/sshd_config\.d\/[^/]+\.conf$/.test(p)).sort() : [];
  // Include steht oben: Was dort steht, gilt zuerst
  return [...inc.map((p) => [p, w.fs[p] ?? ''] as [string, string]), ['/etc/ssh/sshd_config', haupt]];
}
function sshdText(w: Welt) { return sshdDateien(w).map((x) => x[1]).join('\n'); }
// Werte prüfen wie sshd (servconf.c): Ja/Nein-Optionen, Zahlen, Zeiten, Ports, LogLevel, Chiffren, Match-Blöcke
const SSHD_JANEIN = ['pubkeyauthentication', 'passwordauthentication', 'permitemptypasswords', 'kbdinteractiveauthentication', 'challengeresponseauthentication', 'usepam', 'x11forwarding', 'x11uselocalhost', 'printmotd', 'printlastlog', 'tcpkeepalive', 'strictmodes', 'hostbasedauthentication', 'ignorerhosts', 'compression', 'permituserenvironment', 'usedns', 'gssapiauthentication', 'kerberosauthentication', 'permittty', 'permituserrc', 'exposeauthinfo', 'disableforwarding'];
const SSHD_JANEIN_MEHR: Record<string, string[]> = { permitrootlogin: ['yes', 'no', 'prohibit-password', 'without-password', 'forced-commands-only'], allowtcpforwarding: ['yes', 'no', 'all', 'local', 'remote'], allowagentforwarding: ['yes', 'no'], gatewayports: ['yes', 'no', 'clientspecified'], permittunnel: ['yes', 'no', 'point-to-point', 'ethernet'], compression: ['yes', 'no', 'delayed'], addressfamily: ['any', 'inet', 'inet6'], permituserenvironment: ['yes', 'no'] };
const SSHD_ZAHL = ['maxauthtries', 'maxsessions', 'clientalivecountmax', 'x11displayoffset'];
const SSHD_ZEIT = ['logingracetime', 'clientaliveinterval'];
const SSHD_LOGLEVEL = ['quiet', 'fatal', 'error', 'info', 'verbose', 'debug', 'debug1', 'debug2', 'debug3'];
const SSHD_CIPHERS = ['3des-cbc', 'aes128-cbc', 'aes192-cbc', 'aes256-cbc', 'aes128-ctr', 'aes192-ctr', 'aes256-ctr', 'aes128-gcm@openssh.com', 'aes256-gcm@openssh.com', 'chacha20-poly1305@openssh.com'];
const SSHD_VERALTET = ['useprivilegeseparation', 'rsaauthentication', 'rhostsrsaauthentication', 'useLogin'.toLowerCase(), 'keyregenerationinterval', 'serverkeybits'];
const SSHD_IN_MATCH = ['acceptenv', 'allowagentforwarding', 'allowgroups', 'allowstreamlocalforwarding', 'allowtcpforwarding', 'allowusers', 'authenticationmethods', 'authorizedkeyscommand', 'authorizedkeyscommanduser', 'authorizedkeysfile', 'authorizedprincipalscommand', 'authorizedprincipalscommanduser', 'authorizedprincipalsfile', 'banner', 'casignaturealgorithms', 'channeltimeout', 'chrootdirectory', 'clientalivecountmax', 'clientaliveinterval', 'denygroups', 'denyusers', 'disableforwarding', 'exposeauthinfo', 'forcecommand', 'gatewayports', 'gssapiauthentication', 'hostbasedacceptedalgorithms', 'hostbasedauthentication', 'hostbasedusesnamefrompacketonly', 'ignorerhosts', 'include', 'ipqos', 'kbdinteractiveauthentication', 'challengeresponseauthentication', 'kerberosauthentication', 'loglevel', 'maxauthtries', 'maxsessions', 'passwordauthentication', 'permitemptypasswords', 'permitlisten', 'permitopen', 'permitrootlogin', 'permittty', 'permittunnel', 'permituserrc', 'pubkeyacceptedalgorithms', 'pubkeyauthentication', 'pubkeyauthoptions', 'rekeylimit', 'revokedkeys', 'rdomain', 'setenv', 'streamlocalbindmask', 'streamlocalbindunlink', 'trustedusercakeys', 'unusedconnectiontimeout', 'x11displayoffset', 'x11forwarding', 'x11uselocalhost', 'match'];
const ipv4Gut = (a: string) => { const t = a.split('.'); return t.length === 4 && t.every((x) => /^\d{1,3}$/.test(x) && Number(x) <= 255); };
/** Prüft sshd-Konfigurationsdateien. Fehler im Wortlaut von sshd, Warnungen (veraltete Optionen) gesondert. */
function sshdPruefenDateien(dateien: [string, string][]): { fehler: string | null; warnungen: string[] } {
  const warnungen: string[] = []; const falsch: string[] = [];
  for (const [p, t] of dateien) {
    const z = t.split('\n'); let imMatch = false;
    for (let i = 0; i < z.length; i++) {
      const roh = z[i].replace(/#.*/, '').trim(); if (!roh) continue;
      const m = roh.match(/^(\S+?)(?:\s*=\s*|\s+)(.*)$/) ?? [roh, roh, ''];
      const kw = m[1]; const k = kw.toLowerCase(); const wert = (m[2] ?? '').trim(); const w1 = wert.split(/\s+/)[0] ?? '';
      const pz = `${p} line ${i + 1}`;
      if (SSHD_VERALTET.includes(k)) { warnungen.push(`${pz}: Deprecated option ${kw}`); continue; }
      if (!SSHD_OPTIONEN.includes(k)) { falsch.push(`${p}: line ${i + 1}: Bad configuration option: ${kw}`); continue; }
      if (!wert) { falsch.push(`${pz}: no argument after keyword "${kw}"`); continue; }
      if (k === 'match') { imMatch = !/^all$/i.test(w1); continue; }
      if (imMatch && !SSHD_IN_MATCH.includes(k)) return { fehler: `${pz}: Directive '${kw}' is not allowed within a Match block`, warnungen };
      const v = w1.toLowerCase();
      if (SSHD_JANEIN_MEHR[k] && !SSHD_JANEIN_MEHR[k].includes(v)) return { fehler: `${pz}: unsupported option "${w1}".`, warnungen };
      if (!SSHD_JANEIN_MEHR[k] && SSHD_JANEIN.includes(k) && v !== 'yes' && v !== 'no') return { fehler: `${pz}: unsupported option "${w1}".`, warnungen };
      if (k === 'port' && !(/^\d+$/.test(w1) && Number(w1) >= 1 && Number(w1) <= 65535)) return { fehler: `${pz}: Badly formatted port number.`, warnungen };
      if (SSHD_ZAHL.includes(k) && !/^\d+$/.test(w1)) return { fehler: `${pz}: ${kw} integer value invalid.`, warnungen };
      if (SSHD_ZEIT.includes(k) && !/^(\d+[sSmMhHdDwW]?)+$/.test(w1)) return { fehler: `${pz}: invalid time value.`, warnungen };
      if (k === 'loglevel' && !SSHD_LOGLEVEL.includes(v)) return { fehler: `${pz}: unsupported log level '${w1}'`, warnungen };
      if (k === 'ciphers' && !w1.replace(/^[+^-]/, '').split(',').every((c) => SSHD_CIPHERS.includes(c.toLowerCase()))) return { fehler: `${pz}: Bad SSH2 cipher spec '${w1}'.`, warnungen };
      if (k === 'listenaddress') { const h = w1.replace(/^\[(.*)\](:\d+)?$/, '$1').replace(/^([\d.]+):\d+$/, '$1'); if (/^[\d.]+$/.test(h) && !ipv4Gut(h)) return { fehler: `bad addr or host: ${h} (Name or service not known)`, warnungen }; }
    }
    if (falsch.length) return { fehler: `${falsch.join('\n')}\n${p}: terminating, ${falsch.length} bad configuration options`, warnungen };
  }
  return { fehler: null, warnungen };
}
function sshdPruefen(w: Welt): string | null { return sshdPruefenDateien(sshdDateien(w)).fehler; }
/** Wirksamer Wert einer sshd-Option: Der erste Eintrag gewinnt. */
function sshdWert(text: string, opt: string): string {
  const STD: Record<string, string> = { port: '22', permitrootlogin: 'without-password', passwordauthentication: 'yes', pubkeyauthentication: 'yes', x11forwarding: 'no', permitemptypasswords: 'no', maxauthtries: '6', allowtcpforwarding: 'yes', usepam: 'no' };
  for (const z of text.split('\n')) { const t = z.replace(/#.*/, '').trim().split(/\s+/); if (t[0] && t[0].toLowerCase() === opt && t[1]) { const v = t[1].toLowerCase(); return v === 'prohibit-password' ? 'without-password' : v; } }
  return STD[opt] ?? '';
}

// ---------- SSH-Client ----------

const KEYTYP: Record<string, { name: string; bits: number; prefix: string; anzeige: string }> = {
  ed25519: { name: 'ssh-ed25519', bits: 256, prefix: 'AAAAC3NzaC1lZDI1NTE5AAAAI', anzeige: 'ED25519' },
  rsa: { name: 'ssh-rsa', bits: 3072, prefix: 'AAAAB3NzaC1yc2EAAAADAQABAAABgQ', anzeige: 'RSA' },
  ecdsa: { name: 'ecdsa-sha2-nistp256', bits: 256, prefix: 'AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBB', anzeige: 'ECDSA' },
  dsa: { name: 'ssh-dss', bits: 1024, prefix: 'AAAAB3NzaC1kc3MAAACBA', anzeige: 'DSA' },
};
function pubText(k: SshSchluessel) { const t = KEYTYP[k.typ]; return `${t.name} ${t.prefix}${pseudo('pub' + k.id, k.typ === 'rsa' ? 340 : k.typ === 'ed25519' ? 43 : 80)} ${k.kommentar}`; }
function schluesselAus(w: Welt, p: string): SshSchluessel | null { const t = w.fs[p]; const m = t?.match(/^-----BEGIN OPENSSH PRIVATE KEY-----\n([\s\S]*?)\n-----END/); if (!m) return null; const id = m[1].replace(/\s/g, '').match(/^b3BlbnNzaC1rZXktdjE(\w{12})/)?.[1]; return id ? ss(w).ssh[id] ?? null : null; }
function khName(h: string) { return `|1|${pseudo('salt' + h, 27)}=|${pseudo('hmac' + h, 27)}=`; }
function randomart(k: SshSchluessel) {
  const t = KEYTYP[k.typ]; const kopf = `+--[${t.anzeige} ${t.bits}]`; const zeichen = ' .o+=*BOX@%&#/^';
  const reihen = Array.from({ length: 9 }, (_, r) => '|' + Array.from({ length: 17 }, (_, c) => (r === 4 && c === 8 ? 'S' : ((v) => (v < 175 ? ' ' : zeichen[1 + (v % 14)]))(parseInt(hash(k.id + r + ':' + c, 2), 16)))).join('') + '|');
  return `${kopf}${'-'.repeat(18 - kopf.length)}+\n${reihen.join('\n')}\n+----[SHA256]-----+`;
}
interface SshCfg { host: string; user: string; port: number; ids: string[]; x11: boolean; locals: string[] }
function sshConfig(w: Welt, alias: string): Partial<SshCfg> & { hostname?: string } {
  const t = w.fs[`${home(w)}/.ssh/config`] ?? ''; const out: Partial<SshCfg> & { hostname?: string } = {}; let aktiv = false;
  for (const z of t.split('\n')) {
    const [k0, ...v] = z.replace(/#.*/, '').trim().split(/\s+/); if (!k0) continue; const k = k0.toLowerCase(); const wert = v.join(' ');
    if (k === 'host') { aktiv = v.some((m) => new RegExp('^' + m.replace(/[.]/g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.') + '$').test(alias)); continue; }
    if (!aktiv) continue;
    if (k === 'hostname' && !out.hostname) out.hostname = wert;
    if (k === 'user' && !out.user) out.user = wert;
    if (k === 'port' && !out.port) out.port = Number(wert);
    if (k === 'identityfile') out.ids = [...(out.ids ?? []), zeigeHome(w, wert)];
    if (k === 'forwardx11' && out.x11 === undefined) out.x11 = /^yes$/i.test(wert);
    if (k === 'localforward') out.locals = [...(out.locals ?? []), wert.replace(/\s+/, ':')];
  }
  return out;
}

type Fertig = (r: { ok: boolean; text: string; user: string; host: string; anzeige: string }) => string;
/** Verbindungsaufbau mit Host-Prüfung und Anmeldung. Ruft fertig, sobald klar ist, ob es geklappt hat. */
function verbinden(w: Welt, ziel0: string, o: { user?: string; port?: number; ids?: string[]; nurPasswort?: boolean }, fertig: Fertig): Ergebnis {
  const st = ss(w); const h = home(w);
  const [u1, host0] = ziel0.includes('@') ? ziel0.split('@') : [undefined, ziel0];
  const cfg = sshConfig(w, host0);
  const host = cfg.hostname ?? host0; const user = u1 ?? o.user ?? cfg.user ?? w.user; const port = o.port ?? cfg.port ?? 22;
  const z = fernZiel(w, host);
  if (!z.ip) return fehler(`ssh: Could not resolve hostname ${host}: ${z.fehler === 'temporaer' ? 'Temporary failure in name resolution' : 'Name or service not known'}`, 255);
  if (!z.erreichbar && !z.lokal) return fehler(`ssh: connect to host ${host} port ${port}: ${fernZiel(w, host).ip?.startsWith('10.') ? 'Connection timed out' : 'No route to host'}`, 255);
  const istLabor2 = z.ip === '192.168.1.24'; const lokal = z.lokal;
  const offen = lokal ? lokalOffen(w, z.ip, port) && st.sshdLaeuft : z.ports.includes(port);
  if (!offen) return fehler(`ssh: connect to host ${host} port ${port}: Connection refused`, 255);
  if (!istLabor2 && !lokal) return fehler(`${user}@${host}: Permission denied (publickey).\n(Im Simulator kannst du dich nur bei labor2 und bei werkstatt selbst anmelden.)`, 255);
  const anzeige = `${user}@${host}`;
  const hostKey = lokal ? (w.fs['/etc/ssh/ssh_host_ed25519_key.pub'] ?? 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGw3rk').split(' ')[1] : st.fernHostkeyNeu ? FERN_HOSTKEY_NEU : FERN_HOSTKEY;
  const kh = `${h}/.ssh/known_hosts`;
  const khZeilen = [...(w.fs[kh] ?? '').split('\n'), ...(w.fs['/etc/ssh/ssh_known_hosts'] ?? '').split('\n')];
  const namen = [host, ...(port !== 22 ? [`[${host}]:${port}`] : [])];
  const eintrag = khZeilen.findIndex((l) => { const f = l.split(' '); return f[0] && f[0].split(',').some((n) => namen.includes(n) || n === khName(host)); });
  const ausgaben: string[] = [];
  const anmelden = (): string => {
    // Öffentliche Schlüssel: zuerst die im Agenten, dann die Dateien
    const autorisiert = lokal ? (w.fs[`/home/${user}/.ssh/authorized_keys`] ?? '') : (st.fern[`/home/${user}/.ssh/authorized_keys`] ?? '');
    const pubOk = sshdWert(lokal ? st.sshdConf : '', 'pubkeyauthentication') !== 'no';
    const kandidaten = (o.ids?.length ? o.ids : cfg.ids?.length ? cfg.ids : ['id_rsa', 'id_ecdsa', 'id_ed25519', 'id_dsa'].map((n) => `${h}/.ssh/${n}`));
    const warnungen: string[] = [];
    if (!o.nurPasswort && pubOk && user !== 'root') {
      for (const id of st.agent && w.env.SSH_AUTH_SOCK === st.agent.sock ? st.agent.keys : []) { const k = st.ssh[id]; if (k && autorisiert.includes(pubText(k).split(' ')[1])) return fertig({ ok: true, text: [...ausgaben, ...warnungen].join('\n'), user, host, anzeige }); }
      for (const p of kandidaten) {
        const k = schluesselAus(w, p); if (!k) continue;
        const mode = K.modus(w, p);
        if (mode & 0o077) { warnungen.push(`@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\n@         WARNING: UNPROTECTED PRIVATE KEY FILE!          @\n@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\nPermissions 0${(mode & 0o777).toString(8)} for '${p}' are too open.\nIt is required that your private key files are NOT accessible by others.\nThis private key will be ignored.\nLoad key "${p}": bad permissions`); continue; }
        if (!autorisiert.includes(pubText(k).split(' ')[1])) continue;
        if (!k.pass) return fertig({ ok: true, text: [...ausgaben, ...warnungen].join('\n'), user, host, anzeige });
        const vorher = [...ausgaben, ...warnungen].join('\n');
        K.dialog(w, (vorher ? vorher + '\n' : '') + `Enter passphrase for key '${p}': `, (pw) => pw === k.pass ? fertig({ ok: true, text: '', user, host, anzeige }) : (passwortFragen(1, 'Load key "' + p + '": incorrect passphrase supplied to decrypt private key'), ''));
        return '';
      }
    }
    return passwortFragen(1, [...ausgaben, ...warnungen].join('\n'));
  };
  const passwortFragen = (n: number, vorher: string): string => {
    const pwAuth = lokal ? sshdWert(st.sshdConf, 'passwordauthentication') !== 'no' : true;
    if (!pwAuth) return fertig({ ok: false, text: [vorher, `${anzeige}: Permission denied (publickey).`].filter(Boolean).join('\n'), user, host, anzeige });
    K.dialog(w, (vorher ? vorher + '\n' : '') + `${anzeige}'s password: `, (pw) => {
      const rootVerboten = user === 'root' && (lokal ? sshdWert(st.sshdConf, 'permitrootlogin') !== 'yes' : true);
      const richtig = !rootVerboten && (lokal ? pw.length > 0 && user === 'lena' : pw === FERN_PASS && user === 'lena');
      if (richtig) {
        if (lokal && w.fs['/etc/nologin'] !== undefined && user !== 'root') return fertig({ ok: false, text: `${(w.fs['/etc/nologin'] ?? '').trim()}\nConnection closed by ${z.ip} port ${port}`, user, host, anzeige });
        return fertig({ ok: true, text: '', user, host, anzeige });
      }
      if (n >= 3) return fertig({ ok: false, text: `${anzeige}: Permission denied (publickey,password).`, user, host, anzeige });
      return passwortFragen(n + 1, 'Permission denied, please try again.');
    });
    return '';
  };
  const weiter = (): Ergebnis => {
    const r = anmelden();
    return w.dialog ? { out: '', code: 0 } : { out: r, code: 0 };
  };
  if (eintrag >= 0) {
    const gespeichert = khZeilen[eintrag].split(' ')[2];
    if (gespeichert !== hostKey) {
      const zeile = (w.fs[kh] ?? '').split('\n').findIndex((l) => l === khZeilen[eintrag]) + 1;
      return fehler(`@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\n@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @\n@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\nIT IS POSSIBLE THAT SOMEONE IS DOING SOMETHING NASTY!\nSomeone could be eavesdropping on you right now (man-in-the-middle attack)!\nIt is also possible that a host key has just been changed.\nThe fingerprint for the ED25519 key sent by the remote host is\n${fp(hostKey)}.\nPlease contact your system administrator.\nAdd correct host key in ${kh} to get rid of this message.\nOffending ED25519 key in ${kh}:${zeile}\n  remove with:\n  ssh-keygen -f "${kh}" -R "${host}"\nHost key for ${host} has changed and you have requested strict checking.\nHost key verification failed.`, 255);
    }
    return weiter();
  }
  K.dialog(w, `The authenticity of host '${host} (${z.ip})' can't be established.\nED25519 key fingerprint is ${fp(hostKey)}.\nThis key is not known by any other names.\nAre you sure you want to continue connecting (yes/no/[fingerprint])? `, (antwort) => {
    if (antwort !== 'yes' && antwort !== fp(hostKey)) return 'Host key verification failed.';
    if (!(`${h}/.ssh` in w.fs)) { w.fs[`${h}/.ssh`] = null; K.rechte(w, `${h}/.ssh`, 0o700, w.user, w.user); }
    w.fs[kh] = (w.fs[kh] ?? '') + `${khName(port === 22 ? host : `[${host}]:${port}`)} ssh-ed25519 ${hostKey}\n`;
    if (K.modus(w, kh) === 0o644 || true) K.rechte(w, kh, 0o644, w.user, w.user);
    ausgaben.push(`Warning: Permanently added '${host}' (ED25519) to the list of known hosts.`);
    return anmelden();
  });
  return ok();
}

function fernBefehl(w: Welt, user: string, cmd: string, x11: boolean): string {
  const st = ss(w); const t = cmd.trim().split(/\s+/); const hm = `/home/${user}`;
  const p = (x?: string) => (x ?? hm).replace(/^~/, hm).replace(/^(?!\/)/, hm + '/');
  switch (t[0]) {
    case 'hostname': return 'labor2';
    case 'whoami': return user;
    case 'id': return `uid=1000(${user}) gid=1000(${user}) Gruppen=1000(${user}),100(users)`;
    case 'uptime': return ' 09:15:02 up 12 days,  3:40,  0 users,  load average: 0,02, 0,04, 0,01';
    case 'uname': return t[1] === '-a' ? 'Linux labor2 6.1.0-27-amd64 #1 SMP PREEMPT_DYNAMIC Debian 6.1.115-1 (2024-11-01) x86_64 GNU/Linux' : t[1] === '-r' ? '6.1.0-27-amd64' : t[1] === '-n' ? 'labor2' : 'Linux';
    case 'cat': { const f = p(t[1]); return f in st.fern && st.fern[f] !== '' || f.endsWith('authorized_keys') ? st.fern[f].replace(/\n$/, '') : `cat: ${t[1]}: Datei oder Verzeichnis nicht gefunden`; }
    case 'ls': { const alle = t.includes('-a') || t.includes('-la') || t.includes('-al'); const d = p(t.find((x, i) => i > 0 && !x.startsWith('-'))); const kinder = Object.keys(st.fern).filter((f) => f.startsWith(d + '/') && !f.slice(d.length + 1).includes('/')).map((f) => f.slice(d.length + 1)).filter((n) => alle || !n.startsWith('.')); return kinder.sort().join('  '); }
    case 'echo': return t.slice(1).join(' ');
    case 'xclock': case 'xeyes': case 'xterm': return x11 ? `(${t[0]} läuft auf labor2. Das Fenster erscheint auf deinem Bildschirm, getunnelt durch SSH. DISPLAY auf labor2: localhost:10.0)` : `Error: Can't open display: \n(Ohne -X gibt es auf labor2 keinen Bildschirm. Mit ssh -X leitet SSH die Fenster zu dir weiter.)`;
    case 'exit': return '';
    default: return `bash: ${t[0]}: Befehl nicht gefunden (Im Simulator kennt labor2 nur einige Befehle: hostname, whoami, id, uptime, uname, ls, cat, echo, xclock.)`;
  }
}

// ---------- GnuPG ----------

const GPG_HOME = (w: Welt) => `${home(w)}/.gnupg`;
const kid = (k: GpgKey) => k.fpr.slice(-16);
const fprSchoen = (f: string) => f.match(/.{4}/g)!.join(' ').replace(/^((?:\S+ ){4}\S+) /, '$1  ');
const datum = (w: Welt, plusJahre = 0) => { const d = new Date(w.uhr); d.setFullYear(d.getFullYear() + plusJahre); return d.toISOString().slice(0, 10); };
function gpgFinden(w: Welt, s: string, geheim = false): GpgKey | undefined {
  const t = s.toLowerCase().replace(/^0x/, '');
  return ss(w).gpg.find((k) => (!geheim || k.geheim) && (k.uid.toLowerCase().includes(t) || k.fpr.toLowerCase().endsWith(t)));
}
function armor(art: string, inhalt: object, kommentar?: string) { return `-----BEGIN PGP ${art}-----\n${kommentar ? `Comment: ${kommentar}\n` : ''}\n${zeilen64(b64(JSON.stringify(inhalt)))}\n=${pseudo(JSON.stringify(inhalt), 4)}\n-----END PGP ${art}-----\n`; }
function gpgLesen(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  if (text.startsWith('\u0007GPG:')) { try { out.push(JSON.parse(unb64(text.slice(5)))); } catch { /* kaputt */ } return out; }
  for (const m of text.matchAll(/^-----BEGIN PGP (PUBLIC KEY BLOCK|PRIVATE KEY BLOCK|MESSAGE|SIGNATURE)-----\n(?:[\w-]+: .*\n)*\n([\s\S]*?)\n=[\w+/]+\n-----END/gm)) { try { out.push(JSON.parse(unb64(m[2]))); } catch { /* kaputt */ } }
  return out;
}
function gpgListe(w: Welt, geheim: boolean, nur?: GpgKey[]): string {
  const st = ss(w); const keys = (nur ?? st.gpg).filter((k) => !geheim || k.geheim);
  if (!keys.length) return '';
  const d = `${GPG_HOME(w)}/pubring.kbx`;
  return `${d}\n${'-'.repeat(d.length)}\n` + keys.map((k) => `${geheim ? 'sec' : 'pub'}   ${k.algo} ${k.erzeugt} [SC]${k.widerrufen ? ` [widerrufen: ${datum(w)}]` : ` [verfällt: ${k.erzeugt.replace(/^\d{4}/, (y) => String(Number(y) + 3))}]`}\n      ${k.fpr}\nuid        [${k.widerrufen ? ' widerrufen ' : k.vertrauen === 'ultimativ' ? ' ultimativ ' : '  unbekannt '}] ${k.uid}\n${k.widerrufen ? '' : `${geheim ? 'ssb' : 'sub'}   cv25519 ${k.erzeugt} [E] [verfällt: ${k.erzeugt.replace(/^\d{4}/, (y) => String(Number(y) + 3))}]\n`}`).join('\n');
}
function gpgOrdner(w: Welt): string[] {
  const g = GPG_HOME(w); const out: string[] = [];
  if (!(g in w.fs)) { w.fs[g] = null; K.rechte(w, g, 0o700, w.user, w.user); out.push(`gpg: Verzeichnis \`${g}' erzeugt`); }
  if (!(`${g}/pubring.kbx` in w.fs)) { w.fs[`${g}/pubring.kbx`] = '\u0007BIN:32'; out.push(`gpg: Die "Keybox" \`${g}/pubring.kbx' wurde erstellt`); }
  return out;
}
function gpgSpeichern(w: Welt) { const g = GPG_HOME(w); w.fs[`${g}/pubring.kbx`] = '\u0007BIN:' + (32 + ss(w).gpg.length * 1300); if (ss(w).gpg.some((k) => k.geheim)) { w.fs[`${g}/private-keys-v1.d`] = null; w.fs[`${g}/trustdb.gpg`] = '\u0007BIN:1280'; } }
const pruef = (s: string) => hash('inhalt' + s, 16);

export function sicherBefehle(alt: Record<string, (w: Welt, a: string[], stdin: string, root: boolean) => Ergebnis>): Record<string, B> {
  const b: Record<string, B> = {};

  // --- Anmeldungen ---
  b.who = (w, a, i, r) => a.length ? alt.who(w, a, i, r) : ok('lena     tty2         2026-11-23 08:13 (tty2)\nlena     pts/0        2026-11-23 08:20 (:0)\nmax      pts/1        2026-11-23 08:31 (192.168.1.17)');
  b.w = (w, a) => ok(`${a.includes('-h') ? '' : ' 09:14:02 up 1 day,  1:02,  3 users,  load average: 0,08, 0,12, 0,10\nUSER     TTY      FROM             LOGIN@   IDLE   JCPU   PCPU WHAT\n'}lena     tty2     tty2             Mo08    25:01m  2:13   0.04s /usr/libexec/gnome-session-binary\nlena     pts/0    :0               Mo08     0.00s  0.11s  0.00s w${a.length ? ' ' + a.join(' ') : ''}\nmax      pts/1    192.168.1.17     Mo08     3:12   0.40s  0.38s make -j8`);
  const LAST = [
    ['lena', 'pts/0', ':0', 'Mon Nov 23 08:20', '  still logged in'], ['max', 'pts/1', '192.168.1.17', 'Mon Nov 23 08:31', '  still logged in'], ['lena', 'tty2', 'tty2', 'Mon Nov 23 08:13', '  still logged in'],
    ['reboot', 'system boot', '6.1.0-27-amd64', 'Mon Nov 23 08:12', '  still running'], ['max', 'pts/1', '192.168.1.17', 'Fri Nov 20 16:02', ' - 17:45  (01:43)'], ['lena', 'tty2', 'tty2', 'Fri Nov 20 07:55', ' - 17:30  (09:35)'],
    ['root', 'tty1', '', 'Thu Nov 19 22:41', ' - 22:43  (00:02)'], ['reboot', 'system boot', '6.1.0-27-amd64', 'Thu Nov 19 22:40', ' - 17:31  (18:51)'],
  ];
  b.last = (w, a) => {
    const n = a.find((x) => /^-\d+$/.test(x)) ?? (a.includes('-n') ? '-' + a[a.indexOf('-n') + 1] : undefined);
    const wer = a.filter((x, k) => !x.startsWith('-') && a[k - 1] !== '-n');
    let z = LAST.filter((l) => !wer.length || wer.includes(l[0]) || wer.some((x) => l[1] === x));
    if (n) z = z.slice(0, Number(n.slice(1)));
    return ok(`${z.map((l) => `${l[0].padEnd(8)} ${l[1].padEnd(12)} ${l[2].padEnd(16)} ${l[3]}${l[4]}`).join('\n')}\n\nwtmp beginnt Sun Nov  1 09:02:11 2026`);
  };
  b.lastb = (w, a, _i, root) => {
    if (!(root || w.root)) return fehler('lastb: /var/log/btmp kann nicht geöffnet werden: Keine Berechtigung');
    const z = [['root', 'ssh:notty', '203.0.113.66', 'Mon Nov 23 03:12'], ['admin', 'ssh:notty', '203.0.113.66', 'Mon Nov 23 03:12'], ['root', 'ssh:notty', '203.0.113.66', 'Mon Nov 23 03:11'], ['pi', 'ssh:notty', '198.51.100.7', 'Sun Nov 22 21:40'], ['max', 'pts/1', '192.168.1.17', 'Fri Nov 20 16:01']];
    return ok(`${z.filter((l) => !a.filter((x) => !x.startsWith('-')).length || a.includes(l[0])).map((l) => `${l[0].padEnd(8)} ${l[1].padEnd(12)} ${l[2].padEnd(16)} ${l[3]} - ${l[3].slice(-5)}  (00:00)`).join('\n')}\n\nbtmp beginnt Sun Nov  1 09:02:11 2026`);
  };
  b.lastlog = (w, a) => {
    const nutzer = (w.fs['/etc/passwd'] ?? '').split('\n').filter(Boolean).map((z) => z.split(':')[0]);
    const info: Record<string, string> = { root: 'tty1                      Do Nov 19 22:41:07 +0100 2026', lena: 'pts/0    :0               Mo Nov 23 08:20:13 +0100 2026', max: 'pts/1    192.168.1.17     Mo Nov 23 08:31:44 +0100 2026' };
    const u = a.includes('-u') ? [a[a.indexOf('-u') + 1]] : nutzer;
    return ok(`Benutzername Port von               Letzte\n${u.map((n) => `${n.padEnd(16)} ${info[n] ?? '**Noch nie angemeldet**'}`).join('\n')}`);
  };

  // --- Grenzen ---
  const LIM: [string, string, string][] = [['R', 'real-time non-blocking time', 'microseconds'], ['c', 'core file size', 'blocks'], ['d', 'data seg size', 'kbytes'], ['e', 'scheduling priority', ''], ['f', 'file size', 'blocks'], ['i', 'pending signals', ''], ['l', 'max locked memory', 'kbytes'], ['m', 'max memory size', 'kbytes'], ['n', 'open files', ''], ['p', 'pipe size', '512 bytes'], ['q', 'POSIX message queues', 'bytes'], ['r', 'real-time priority', ''], ['s', 'stack size', 'kbytes'], ['t', 'cpu time', 'seconds'], ['u', 'max user processes', ''], ['v', 'virtual memory', 'kbytes'], ['x', 'file locks', '']];
  b.ulimit = (w, a, _i, root) => {
    const st = ss(w); let hart = false, weich = false; const zeigen: string[] = []; let wert: string | undefined;
    for (const x of a) { if (x.startsWith('-')) { for (const c of x.slice(1)) { if (c === 'H') hart = true; else if (c === 'S') weich = true; else if (c === 'a') zeigen.push(...LIM.map((l) => l[0])); else if (st.limits[c]) zeigen.push(c); else return fehler(`bash: ulimit: -${c}: Ungültige Option.\nulimit: Aufruf: ulimit [-SHabcdefiklmnpqrstuvxPRT] [Grenze]`, 2); } } else wert = x; }
    if (!zeigen.length) zeigen.push('f');
    const idx = hart && !weich ? 1 : 0;
    if (wert === undefined) {
      if (zeigen.length === 1 && !a.some((x) => x.includes('a'))) return ok(st.limits[zeigen[0]][idx]);
      return ok(zeigen.map((c) => { const l = LIM.find((x) => x[0] === c)!; const u = l[2] ? `(${l[2]}, -${c})` : `(-${c})`; return `${l[1]}${' '.repeat(Math.max(2, 40 - l[1].length - u.length))}${u} ${st.limits[c][idx]}`; }).join('\n'));
    }
    const c = zeigen[0]; const [s0, h0] = st.limits[c]; const num = (v: string) => (v === 'unlimited' ? Infinity : Number(v));
    if (!/^(\d+|unlimited)$/.test(wert)) return fehler(`bash: ulimit: ${wert}: Ungültige Zahl.`);
    const setzeH = hart || !weich; const setzeS = weich || !hart;
    if (setzeH && num(wert) > num(h0) && !(root || w.root)) return fehler(`bash: ulimit: ${LIM.find((x) => x[0] === c)![1]}: Kann die Grenze nicht ändern: Die Operation ist nicht erlaubt`);
    if (setzeS && !setzeH && num(wert) > num(h0)) return fehler(`bash: ulimit: ${LIM.find((x) => x[0] === c)![1]}: Kann die Grenze nicht ändern: Das Argument ist ungültig`);
    st.limits[c] = [setzeS ? wert : s0, setzeH ? wert : h0];
    return ok();
  };

  // --- Offene Dateien und Ports ---
  const lsofSockets = (w: Welt) => {
    const basis: Sock[] = [{ p: 'tcp', s: 'LISTEN', l: '*:22', f: '', prog: 'sshd', pid: 901 }, { p: 'tcp', s: 'LISTEN', l: 'localhost:25', f: '', prog: 'master', pid: 1301 }, { p: 'tcp', s: 'LISTEN', l: 'localhost:631', f: '', prog: 'cupsd', pid: 1712 }, { p: 'udp', s: 'UNCONN', l: '*:5353', f: '', prog: 'avahi-dae', pid: 601 }, { p: 'tcp', s: 'ESTABLISHED', l: 'werkstatt.lab.example.org:22->192.168.1.17:51122', f: '', prog: 'sshd', pid: 3048 }, { p: 'tcp', s: 'ESTABLISHED', l: 'werkstatt.lab.example.org:43110->www.example.org:443', f: '', prog: 'firefox-e', pid: 1450 }];
    const extra = alleExtraSockets(w).filter((x) => x.s !== 'WEG').map((x) => (x.s === 'ESTAB' ? { ...x, s: 'ESTABLISHED', l: `${x.l.replace(/^192\.168\.1\.23:/, 'werkstatt.lab.example.org:')}->${x.f}`, f: '' } : { ...x, l: x.l.replace(/^0\.0\.0\.0/, '*').replace(/^127\.0\.0\.1/, 'localhost') }));
    const sshAus = sicherSockets(w).some((x) => x.s === 'WEG');
    return [...basis.filter((x) => !(sshAus && x.pid === 901)), ...extra];
  };
  const dienst: Record<string, string> = { 22: 'ssh', 23: 'telnet', 25: 'smtp', 53: 'domain', 69: 'tftp', 80: 'http', 111: 'sunrpc', 443: 'https', 631: 'ipp', 5353: 'mdns', 8080: 'http-alt' };
  b.lsof = (w, a, _i, root) => {
    const r = root || w.root; const st = ss(w);
    const kopf = 'COMMAND    PID USER   FD   TYPE DEVICE SIZE/OFF    NODE NAME';
    const iArg = a.includes('-i') ? (a[a.indexOf('-i') + 1]?.startsWith('-') ? '' : a[a.indexOf('-i') + 1] ?? '') : a.find((x) => x.startsWith('-i') && x.length > 2)?.slice(2);
    const zahl = a.some((x) => /^-\w*n/.test(x)) || a.includes('-P');
    if (iArg !== undefined) {
      const port = iArg.match(/:(\d+)$/)?.[1]; const prot = iArg.match(/^(tcp|udp)/i)?.[1].toLowerCase();
      const z = lsofSockets(w).filter((x) => (r || x.prog.startsWith('firefox')) && (!port || x.l.includes(':' + port)) && (!prot || x.p === prot));
      if (!z.length) return { out: '', code: 1 };
      const userVon = (p: number) => (p === 1450 ? 'lena' : w.prozesse.find((q) => q.pid === p)?.user ?? 'root');
      return ok(`COMMAND    PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME\n${z.map((x) => `${x.prog.slice(0, 9).padEnd(9)} ${String(x.pid).padStart(5)} ${userVon(x.pid).padEnd(6)} ${'3u'.padEnd(4)} IPv4  ${String(18000 + x.pid).padEnd(6)}      0t0  ${x.p.toUpperCase()} ${zahl ? x.l : x.l.replace(/:(\d+)/g, (m, p) => ':' + (dienst[p] ?? p))}${x.s === 'LISTEN' ? ' (LISTEN)' : x.s === 'ESTABLISHED' ? ' (ESTABLISHED)' : ''}`).join('\n')}`);
    }
    const uArg = a.includes('-u') ? a[a.indexOf('-u') + 1] : undefined;
    const pArg = a.includes('-p') ? Number(a[a.indexOf('-p') + 1]) : undefined;
    const dArg = a.includes('+D') ? K.pfad(w, a[a.indexOf('+D') + 1]) : undefined;
    const pfade = a.filter((x, k) => !x.startsWith('-') && !x.startsWith('+') && !['-u', '-p', '+D'].includes(a[k - 1])).map((x) => K.pfad(w, x));
    const z = st.offen.filter((o) => w.prozesse.some((p) => p.pid === o.pid && !p.weg) && (r || o.user === w.user) && (!uArg || o.user === uArg) && (!pArg || o.pid === pArg) && (!dArg || o.name === dArg || o.name.startsWith(dArg + '/')) && (!pfade.length || pfade.some((p) => o.name === p || o.name.startsWith(p + '/'))));
    if (!z.length) return { out: '', code: 1, err: !r && (pfade.length || uArg) ? undefined : undefined };
    return ok(`${kopf}\n${z.map((o) => `${o.cmd.padEnd(9)} ${String(o.pid).padStart(5)} ${o.user.padEnd(6)} ${o.fd.padEnd(4)} ${o.typ.padEnd(4)}  ${'254,1'.padEnd(6)} ${String(o.typ === 'DIR' ? 4096 : 2048).padStart(8)} ${String(130000 + o.pid).padStart(7)} ${o.name}`).join('\n')}`);
  };
  b.fuser = (w, a, _i, root) => {
    const r = root || w.root; const st = ss(w);
    const v = a.some((x) => /^-\w*v/.test(x)); const kill = a.some((x) => /^-\w*k/.test(x)); const m = a.some((x) => /^-\w*m/.test(x));
    const ni = a.indexOf('-n'); const ns = ni >= 0 ? a[ni + 1] : undefined;
    const ziele = a.filter((x, k) => !x.startsWith('-') && (ni < 0 || k !== ni + 1));
    if (!ziele.length) return fehler('Keine Prozessspezifikation angegeben\nAufruf: fuser [-fIMuvw] [-a|-s] [-4|-6] [-c|-m|-n SPACE]\n             [-k [-i] [-SIGNAL]] NAME...');
    const zeilen: string[] = []; const stderr: string[] = []; let gefunden = false;
    for (const z of ziele) {
      const sm = z.match(/^(\d+)\/(tcp|udp)$/) ?? (ns ? [z, z, ns] : null);
      let treffer: { pid: number; user: string; cmd: string; zug: string }[] = [];
      if (sm) treffer = lsofSockets(w).filter((x) => x.p === sm[2] && x.s !== 'ESTABLISHED' && x.l.endsWith(':' + sm[1])).map((x) => ({ pid: x.pid, user: x.pid === 1450 ? 'lena' : 'root', cmd: x.prog, zug: 'F' }));
      else {
        const p = K.pfad(w, z); if (!(p in w.fs)) { stderr.push(`${z}: Datei oder Verzeichnis nicht gefunden`); continue; }
        treffer = st.offen.filter((o) => w.prozesse.some((q) => q.pid === o.pid && !q.weg) && (o.name === p || (m && o.name.startsWith(p + '/')))).map((o) => ({ pid: o.pid, user: o.user, cmd: o.cmd, zug: o.fd === 'cwd' ? 'c' : 'f' }));
        // fuser fasst mehrere Zugriffe eines Prozesses zusammen
        const zus: typeof treffer = []; for (const t of treffer) { const x = zus.find((y) => y.pid === t.pid); if (x) { if (!x.zug.includes(t.zug)) x.zug += t.zug; } else zus.push({ ...t }); } treffer = zus;
      }
      if (!r) treffer = treffer.filter((t) => t.user === w.user);
      const name = sm ? `${sm[1]}/${sm[2]}` : z;
      if (!treffer.length) continue;
      gefunden = true;
      if (v) { zeilen.push(...treffer.map((t, k) => `${k === 0 ? (name + ':').padEnd(21) : ' '.repeat(21)}${t.user.padEnd(10)}${String(t.pid).padStart(5)} ${(t.zug.includes('F') ? 'F' : t.zug.includes('f') ? 'f' : '.') + '.' + (t.zug.includes('c') ? 'c' : '.') + '..'}  ${t.cmd}`)); }
      else zeilen.push(`${name}:`.padEnd(21) + treffer.map((t) => `${t.pid}${t.zug.replace('F', '')}`).join(' '));
      if (kill) for (const t of treffer) { const p = w.prozesse.find((q) => q.pid === t.pid); if (p) p.weg = true; st.offen = st.offen.filter((o) => o.pid !== t.pid); }
    }
    const kopf = v && zeilen.length ? '                     BEN.        PID ZUGR.  BEFEHL\n' : '';
    return { out: kopf + zeilen.join('\n'), err: stderr.join('\n') || undefined, code: gefunden ? 0 : 1 };
  };
  b.nmap = (w, a, _i, root) => {
    if (!('/usr/bin/nmap' in w.fs)) return fehler('bash: nmap: Befehl nicht gefunden\n(nmap ist auf Debian nicht vorinstalliert: sudo apt install nmap)', 127);
    const r = root || w.root;
    const pi = a.indexOf('-p'); const portArg = pi >= 0 ? a[pi + 1] : a.find((x) => /^-p\d/.test(x))?.slice(2);
    const udp = a.includes('-sU'); const nurPing = a.includes('-sn') || a.includes('-sP');
    if (udp && !r) return fehler('You requested a scan type which requires root privileges.\nQUITTING!');
    const ziel = a.filter((x, k) => !x.startsWith('-') && (pi < 0 || k !== pi + 1)).pop();
    const kopf = `Starting Nmap 7.93 ( https://nmap.org ) at 2026-11-24 09:14 CET`;
    if (!ziel) return ok('Nmap 7.93 ( https://nmap.org )\nUsage: nmap [Scan Type(s)] [Options] {target specification}\n(Beispiele: nmap localhost · nmap -p 1-1000 192.168.1.24 · sudo nmap -sU localhost · nmap -sn 192.168.1.0/24)');
    const ports = portArg ? portArg.split(',').flatMap((x) => { const [v, bis] = x.split('-').map(Number); return bis ? Array.from({ length: bis - v + 1 }, (_, k) => v + k) : [v]; }) : null;
    const anzahl = ports ? ports.length : 1000;
    const scan = (ip: string, name: string): string => {
      const z = fernZiel(w, ip);
      if (!z.erreichbar && !z.lokal) return '';
      let offen: { port: number; p: string }[];
      if (z.lokal) {
        const s = [{ p: 'tcp', s: 'LISTEN', l: '0.0.0.0:22' }, { p: 'tcp', s: 'LISTEN', l: '127.0.0.1:25' }, { p: 'tcp', s: 'LISTEN', l: '127.0.0.1:631' }, { p: 'udp', s: 'UNCONN', l: '0.0.0.0:5353' }, { p: 'udp', s: 'UNCONN', l: '127.0.0.1:323' }, ...sicherSockets(w)];
        const sshWeg = s.some((x) => x.s === 'WEG');
        offen = s.filter((x) => x.s !== 'WEG' && !(sshWeg && x.l === '0.0.0.0:22') && (udp ? x.p === 'udp' : x.p === 'tcp') && (x.l.startsWith('0.0.0.0') || (ip.startsWith('127.') && x.l.startsWith('127.')))).map((x) => ({ port: Number(x.l.split(':').pop()), p: x.p }));
      } else offen = udp ? [] : z.ports.map((port) => ({ port, p: 'tcp' }));
      offen = offen.filter((o) => !ports || ports.includes(o.port)).filter((o, k, l) => l.findIndex((y) => y.port === o.port) === k).sort((x, y) => x.port - y.port);
      const gefiltert = !z.lokal && !ip.startsWith('192.168.');
      const rest = anzahl - offen.length;
      const zeilen = offen.map((o) => `${`${o.port}/${o.p}`.padEnd(udp ? 9 : 8)}${udp ? 'open|filtered ' : 'open  '}${dienst[o.port] ?? 'unknown'}`);
      return `Nmap scan report for ${name}${name !== ip ? ` (${ip})` : ''}\nHost is up (${z.lokal ? '0.000080' : '0.00041'}s latency).\n${rest > 0 ? (rest <= 25 ? `` : `Not shown: ${rest} ${gefiltert ? 'filtered' : 'closed'} ${udp ? 'udp' : 'tcp'} ports (${gefiltert ? 'no-response' : r ? 'reset' : 'conn-refused'})\n`) : ''}${zeilen.length ? `PORT${' '.repeat(udp ? 5 : 4)}STATE${udp ? '         ' : ' '}SERVICE\n${zeilen.join('\n')}${!udp && !gefiltert && rest > 0 && rest <= 25 ? '\n' + (ports ?? []).filter((p) => !offen.some((o) => o.port === p)).map((p) => `${`${p}/tcp`.padEnd(8)}closed ${dienst[p] ?? 'unknown'}`).join('\n') : ''}\n` : !nurPing && rest > 0 && rest <= 25 ? `PORT    STATE  SERVICE\n${(ports ?? []).map((p) => `${`${p}/tcp`.padEnd(8)}closed ${dienst[p] ?? 'unknown'}`).join('\n')}\n` : ''}`;
    };
    if (ziel.includes('/')) {
      const ips = netzHosts(w, ziel);
      const teile = ips.map((ip) => { const z = fernZiel(w, ip); const n = z.lokal ? `${w.host}.lab.example.org` : z.name; return nurPing ? `Nmap scan report for ${n} (${ip})\nHost is up (0.00041s latency).` : scan(ip, n).replace(/\n$/, ''); });
      const groesse = 2 ** (32 - Number(ziel.split('/')[1]));
      return ok(`${kopf}\n${teile.join('\n')}\nNmap done: ${groesse} IP addresses (${ips.length} hosts up) scanned in ${(groesse / 100 + 1.5).toFixed(2)} seconds`);
    }
    const z = fernZiel(w, ziel);
    if (!z.ip) return { out: `${kopf}\nFailed to resolve "${ziel}".\nWARNING: No targets were specified, so 0 hosts scanned.\nNmap done: 0 IP addresses (0 hosts up) scanned in 0.04 seconds`, code: 0 };
    const t = scan(z.ip, z.lokal ? (z.ip.startsWith('127.') ? 'localhost' : `${w.host}.lab.example.org`) : ziel);
    if (!t) return ok(`${kopf}\nNote: Host seems down. If it is really up, but blocking our ping probes, try -Pn\nNmap done: 1 IP address (0 hosts up) scanned in 3.04 seconds`);
    return ok(`${kopf}\n${nurPing ? t.split('\n').slice(0, 2).join('\n') + '\n' : t}\nNmap done: 1 IP address (1 host up) scanned in ${udp ? '1.24' : '0.12'} seconds`);
  };

  // --- Dienste ---
  b.service = (w, a, i, root) => {
    if (a[0] === '--status-all') return ok(Object.entries(ss(w).units).filter(([n]) => n.endsWith('.service')).map(([n, u]) => ` [ ${u.aktiv ? '+' : '-'} ]  ${n.replace('.service', '')}`).sort((x, y) => x.slice(8).localeCompare(y.slice(8))).join('\n'));
    const [d, cmd] = a; if (!d || !cmd) return fehler('Usage: service < option > | --status-all | [ service_name [ command | --full-restart ] ]');
    return (alt.systemctl as B)(w, [cmd, d], i, root);
  };
  b.tcpdmatch = (w, a) => {
    const [d, c] = a.filter((x) => !x.startsWith('-')); if (!d || !c) return fehler('usage: tcpdmatch [-d] [-i inet_conf] daemon[@host] [user@]host');
    const e = wrapperErlaubt(w, d, c);
    return ok(`client:   address  ${c}\nserver:   process  ${d}\n${e.zeile ? `matched:  ${e.datei} line ${(w.fs[e.datei!] ?? '').split('\n').findIndex((z) => z.trim().startsWith(e.zeile!.split(':')[0])) + 1}\n` : ''}access:   ${e.erlaubt ? 'granted' : 'denied'}`);
  };
  b.telnet = (w, a) => {
    const [ziel, port = '23'] = a.filter((x) => !x.startsWith('-')); if (!ziel) return fehler('Usage: telnet [-4] [-6] [-8] [-E] [-L] [-a] [-d] [-e char] [-l user] [-n tracefile] [ -b addr ] [-r] [host [port]]');
    const z = fernZiel(w, ziel);
    if (!z.ip) return fehler(`telnet: could not resolve ${ziel}/${port}: Name or service not known`);
    const offen = z.lokal ? lokalOffen(w, z.ip, Number(port)) : z.ports.includes(Number(port));
    if (!offen) return fehler(`Trying ${z.ip}...\ntelnet: Unable to connect to remote host: Connection refused`);
    if (z.lokal && port === '23') { const e = wrapperErlaubt(w, 'in.telnetd', z.ip); if (!e.erlaubt) return fehler(`Trying ${z.ip}...\nConnected to ${ziel}.\nEscape character is '^]'.\nConnection closed by foreign host.\n(TCP-Wrapper: ${e.datei} verbietet in.telnetd für ${z.ip}.)`); return ok(`Trying ${z.ip}...\nConnected to ${ziel}.\nEscape character is '^]'.\nDebian GNU/Linux 12\nwerkstatt login: \n(Achtung: Telnet schickt Benutzername und Passwort unverschlüsselt. Der Simulator trennt hier.)\nConnection closed by foreign host.`); }
    return ok(`Trying ${z.ip}...\nConnected to ${ziel}.\nEscape character is '^]'.\n(Verbindung zu Port ${port} steht. Der Simulator trennt hier.)\nConnection closed by foreign host.`);
  };

  // --- sudo ---
  b.visudo = (w, a, _i, root) => {
    if (!(root || w.root)) return fehler('visudo: /etc/sudoers: Keine Berechtigung\nvisudo: /etc/sudoers wird nicht verändert');
    const fi = a.indexOf('-f'); const datei = fi >= 0 ? K.pfad(w, a[fi + 1]) : '/etc/sudoers';
    if (a.includes('-c')) {
      if (fi >= 0 && typeof w.fs[datei] !== 'string') return fehler(`visudo: ${datei}: Datei oder Verzeichnis nicht gefunden`);
      const f = sudoersBefund(w, fi >= 0 ? datei : undefined);
      if (f) { const [d, n] = f.ort.split(':'); return fehler(`${f.meldung}\n>>> ${d}: Syntaxfehler in der Nähe von Zeile ${n} <<<\nAnalysefehler in ${d} in der Nähe von Zeile ${n}`); }
      const geprueft = fi >= 0 ? [datei, ...(/^[@#]includedir \/etc\/sudoers\.d$/m.test(w.fs[datei] ?? '') ? sudoersDateien(w).slice(1).map(([p]) => p) : [])] : sudoersDateien(w).map(([p]) => p);
      return ok(geprueft.map((p) => `${p}: Analyse OK`).join('\n'));
    }
    const tmp = datei + '.tmp';
    w.fs[tmp] = w.fs[datei] ?? '';
    return K.vi(w, tmp, (art) => {
      if (art !== 'gespeichert' && w.fs[tmp] === w.fs[datei]) { delete w.fs[tmp]; return ''; }
      const neu = w.fs[tmp] ?? ''; const alt = w.fs[datei]; w.fs[datei] = neu;
      const f = sudoersPruefen(w);
      if (f) { if (alt === undefined) delete w.fs[datei]; else w.fs[datei] = alt; delete w.fs[tmp]; const [, n] = f.split(':'); return `${datei}:${n}:30: Syntaxfehler\n>>> ${datei}: Syntaxfehler in der Nähe von Zeile ${n} <<<\nWas jetzt? x\n(visudo hat deine Änderung verworfen. Im echten visudo wählst du hier e zum erneuten Bearbeiten, x zum Verwerfen, Q zum Speichern trotz Fehler. Q kann dich aussperren.)`; }
      delete w.fs[tmp]; K.rechte(w, datei, 0o440, 'root', 'root'); return '';
    });
  };
  b.__sudo_l = (w, a) => {
    const ui = a.indexOf('-U'); const user = ui >= 0 ? a[ui + 1] : w.user;
    const f = sudoersPruefen(w); if (f) return fehler(sudoErlaubt(w, user, 'x', '/x')!);
    const gr = gruppenVon(w, user);
    const regeln = sudoRegeln(w).filter((r) => r.wer === user || r.wer === 'ALL' || (r.wer.startsWith('%') && gr.includes(r.wer.slice(1))));
    if (!regeln.length) return ok(`Der Benutzer ${user} darf sudo auf ${w.host} nicht ausführen.`);
    return ok(`Passende Defaults-Einträge für ${user} auf ${w.host}:\n    env_reset, mail_badpass, secure_path=/usr/local/sbin\\:/usr/local/bin\\:/usr/sbin\\:/usr/bin\\:/sbin\\:/bin, use_pty\n\nDer Benutzer ${user} darf die folgenden Befehle auf ${w.host} ausführen:\n${regeln.map((r) => `    (${r.runas}) ${r.nopass ? 'NOPASSWD: ' : ''}${r.befehle.join(', ')}`).join('\n')}`);
  };

  // --- SSH ---
  b['ssh-keygen'] = (w, a0, i, root) => {
    const a = a0.flatMap((x) => (/^-[a-zA-Z]{2,}$/.test(x) ? x.slice(1).split('').map((c) => '-' + c) : [x]));
    if (a.includes('-A')) return alt['ssh-keygen'](w, a, i, root);
    const st = ss(w); const h = home(w);
    const opt = (k: string) => { const x = a.indexOf(k); return x >= 0 ? a[x + 1] : undefined; };
    if (a.includes('-R')) {
      const host = opt('-R')!; const datei = opt('-f') ? zeigeHome(w, opt('-f')!) : `${h}/.ssh/known_hosts`;
      const z = (w.fs[datei] ?? '').split('\n'); const treffer = z.map((l, k) => [l, k] as const).filter(([l]) => l.split(' ')[0].split(',').some((n) => n === host || n === khName(host)));
      if (!treffer.length) return ok(`Host ${host} not found in ${datei}`);
      w.fs[datei + '.old'] = w.fs[datei]!; w.fs[datei] = z.filter((_, k) => !treffer.some(([, t]) => t === k)).join('\n');
      return ok(`${treffer.map(([, k]) => `# Host ${host} found: line ${k + 1}`).join('\n')}\n${datei} updated.\nOriginal contents retained as ${datei}.old`);
    }
    if (a.includes('-F')) { const host = opt('-F')!; const z = (w.fs[`${h}/.ssh/known_hosts`] ?? '').split('\n'); const k = z.findIndex((l) => l.split(' ')[0].split(',').some((n) => n === host || n === khName(host))); return k < 0 ? { out: '', code: 1 } : ok(`# Host ${host} found: line ${k + 1} \n${z[k]}`); }
    if (a.includes('-l')) {
      const f = opt('-f'); if (!f) return fehler('Enter file in which the key is (/home/lena/.ssh/id_rsa): (im Simulator: gib die Datei mit -f an)');
      const p = zeigeHome(w, f); const t = w.fs[K.pfad(w, p)];
      if (t === undefined) return fehler(`${f}: No such file or directory`);
      const k = schluesselAus(w, K.pfad(w, p)) ?? schluesselAus(w, K.pfad(w, p).replace(/\.pub$/, ''));
      if (k) return ok(`${KEYTYP[k.typ].bits} ${fp(pubText(k))} ${k.kommentar} (${KEYTYP[k.typ].anzeige})`);
      const m = t?.match(/^(ssh-\w+|ecdsa-\S+) (\S+)\s*(.*)$/m); if (!m) return fehler(`${f} is not a public key file.`);
      const typ = Object.values(KEYTYP).find((x) => x.name === m[1]); return ok(`${typ?.bits ?? 256} ${fp(m[2])} ${m[3] || 'no comment'} (${typ?.anzeige ?? 'ED25519'})`);
    }
    const typ = (opt('-t') ?? 'rsa').toLowerCase();
    if (!KEYTYP[typ]) return fehler(`unknown key type ${typ}`);
    const bits = Number(opt('-b') ?? KEYTYP[typ].bits);
    const kommentar = opt('-C') ?? `${w.user}@${w.host}`;
    const erzeugen = (datei: string, pass: string): string => {
      const out: string[] = [];
      const dir = datei.slice(0, datei.lastIndexOf('/'));
      if (!(dir in w.fs)) { w.fs[dir] = null; K.rechte(w, dir, 0o700, w.user, w.user); out.push(`Created directory '${dir}'.`); }
      const id = hash(datei + kommentar + Object.keys(st.ssh).length, 12);
      const k: SshSchluessel = { id, typ, bits, kommentar, pass };
      st.ssh[id] = k;
      w.fs[datei] = `-----BEGIN OPENSSH PRIVATE KEY-----\n${zeilen64('b3BlbnNzaC1rZXktdjE' + id + pseudo('priv' + id, typ === 'rsa' ? 2400 : 340))}\n-----END OPENSSH PRIVATE KEY-----\n`;
      w.fs[datei + '.pub'] = pubText(k) + '\n';
      K.rechte(w, datei, 0o600, w.user, w.user); K.rechte(w, datei + '.pub', 0o644, w.user, w.user);
      out.push(`Your identification has been saved in ${datei}`, `Your public key has been saved in ${datei}.pub`, 'The key fingerprint is:', `${fp(pubText(k))} ${kommentar}`, "The key's randomart image is:", randomart(k));
      return out.join('\n');
    };
    const kopf = `Generating public/private ${typ} key pair.`;
    const mitDatei = (datei: string) => {
      const weiter = () => {
        const n = opt('-N');
        if (n !== undefined) return erzeugen(datei, n);
        K.dialog(w, 'Enter passphrase (empty for no passphrase): ', (p1) => { K.dialog(w, 'Enter same passphrase again: ', (p2) => (p1 === p2 ? erzeugen(datei, p1) : 'Passphrases do not match.  Try again.')); return ''; });
        return '';
      };
      if (datei in w.fs) { K.dialog(w, `${datei} already exists.\nOverwrite (y/n)? `, (j) => (j.startsWith('y') ? weiter() : '')); return ''; }
      return weiter();
    };
    const f = opt('-f');
    if (f) { const r = mitDatei(K.pfad(w, zeigeHome(w, f))); return w.dialog ? { out: kopf, code: 0 } : ok(`${kopf}\n${r}`); }
    const std = `${h}/.ssh/id_${typ}`;
    K.dialog(w, `${kopf}\nEnter file in which to save the key (${std}): `, (z) => mitDatei(z ? K.pfad(w, zeigeHome(w, z)) : std));
    return ok();
  };
  const sshOptionen = (a: string[]) => {
    const mitWert = new Set(['-p', '-i', '-l', '-L', '-R', '-D', '-o', '-F', '-b', '-c', '-E', '-e', '-m', '-O', '-Q', '-S', '-W', '-w', '-J', '-P']);
    const o: Record<string, string[]> = {}; const flags = new Set<string>(); const frei: string[] = [];
    for (let k = 0; k < a.length; k++) {
      const x = a[k];
      if (frei.length) { frei.push(x); continue; }
      if (mitWert.has(x)) { (o[x] ??= []).push(a[++k] ?? ''); continue; }
      if (/^-[pilLRD].+/.test(x)) { (o[x.slice(0, 2)] ??= []).push(x.slice(2)); continue; }
      if (x.startsWith('-')) { for (const c of x.slice(1)) flags.add(c); continue; }
      frei.push(x);
    }
    return { o, flags, frei };
  };
  b.ssh = (w, a) => {
    const st = ss(w);
    const { o, flags, frei } = sshOptionen(a);
    if (!frei.length) return fehler('usage: ssh [-46AaCfGgKkMNnqsTtVvXxYy] [-B bind_interface] [-b bind_address]\n           [-c cipher_spec] [-D [bind_address:]port] [-E log_file]\n           [-e escape_char] [-F configfile] [-I pkcs11] [-i identity_file]\n           [-J destination] [-L address] [-l login_name] [-m mac_spec]\n           [-O ctl_cmd] [-o option] [-P tag] [-p port] [-R address]\n           [-S ctl_path] [-W host:port] [-w local_tun[:remote_tun]]\n           destination [command [argument ...]]', 255);
    const [ziel, ...befehl] = frei;
    const cfg = sshConfig(w, ziel.split('@').pop()!);
    const x11 = flags.has('X') || flags.has('Y') || !!cfg.x11;
    const locals = [...(o['-L'] ?? []), ...(cfg.locals ?? [])]; const remotes = o['-R'] ?? [];
    return verbinden(w, ziel, { user: o['-l']?.[0], port: o['-p'] ? Number(o['-p'][0]) : undefined, ids: o['-i']?.map((x) => K.pfad(w, zeigeHome(w, x))) }, (r) => {
      if (!r.ok) return r.text;
      const teile = r.text ? [r.text] : [];
      for (const l of locals) { const m = l.match(/^(?:[\w.]+:)?(\d+):([\w.-]+):(\d+)$/); if (!m) { teile.push(`Bad local forwarding specification '${l}'`); continue; } if (lokalOffen(w, '127.0.0.1', Number(m[1]))) teile.push(`bind [127.0.0.1]:${m[1]}: Address already in use\nchannel_setup_fwd_listener_tcpip: cannot listen to port: ${m[1]}\nCould not request local forwarding.`); else st.tunnel.push({ art: 'L', port: Number(m[1]), ziel: `${m[2]}:${m[3]}`, via: r.host }); }
      for (const l of remotes) { const m = l.match(/^(\d+):([\w.-]+):(\d+)$/); if (m) st.tunnel.push({ art: 'R', port: Number(m[1]), ziel: `${m[2]}:${m[3]}`, via: r.host }); }
      if (flags.has('N')) {
        if (flags.has('f')) return teile.join('\n');
        (w as Welt & { langlaeufer: string | null }).langlaeufer = 'ssh';
        return [...teile, `(Der Tunnel läuft, solange ssh läuft. Mit -f ginge ssh in den Hintergrund. Strg+C beendet ihn.)`].join('\n');
      }
      const lokal = fernZiel(w, r.host).lokal;
      if (befehl.length) return [...teile, lokal ? K.zeile(w, befehl.join(' '), '', false).out.replace(/\n$/, '') : fernBefehl(w, r.user, befehl.join(' '), x11)].filter((x) => x !== '').join('\n');
      return [...teile, `Linux ${lokal ? w.host : 'labor2'} 6.1.0-27-amd64 #1 SMP PREEMPT_DYNAMIC Debian 6.1.115-1 (2024-11-01) x86_64\n\nThe programs included with the Debian GNU/Linux system are free software;\nthe exact distribution terms for each program are described in the\nindividual files in /usr/share/doc/*/copyright.\n\nLast login: Fri Nov 20 16:02:11 2026 from 192.168.1.23\n(Im Simulator endet die Sitzung hier gleich wieder. Hänge den Befehl an, zum Beispiel: ssh ${ziel} hostname)\nConnection to ${r.host} closed.`].join('\n');
    });
  };
  b.scp = (w, a) => {
    const st = ss(w); const frei = a.filter((x) => !x.startsWith('-'));
    if (frei.length < 2) return fehler('usage: scp [-346ABCOpqRrsTv] [-c cipher] [-D sftp_server_path] [-F ssh_config]\n           [-i identity_file] [-J destination] [-l limit] [-o ssh_option]\n           [-P port] [-S program] [-X sftp_option] source ... target');
    const ziel = frei[frei.length - 1]; const quellen = frei.slice(0, -1);
    const fernTeil = (s: string) => s.match(/^((?:[\w.-]+@)?[\w.-]+):(.*)$/);
    const zf = fernTeil(ziel); const qf = quellen.map(fernTeil).find(Boolean);
    const host = (zf ?? qf)?.[1]; if (!host) { return fehler('(Für Kopien ohne Rechnername nimm cp.)'); }
    return verbinden(w, host, {}, (r) => {
      if (!r.ok) return r.text; const teile = r.text ? [r.text] : [];
      const hm = `/home/${r.user}`;
      if (zf) {
        for (const q of quellen) { const p = K.pfad(w, q); const t = w.fs[p]; if (t === undefined || t === null) { teile.push(`scp: ${q}: No such file or directory`); continue; } let d = (zf[2] || '~').replace(/^~/, hm).replace(/^(?!\/)/, hm + '/'); if (d.endsWith('/') || d === hm || st.fern[d] === '') d = d.replace(/\/$/, '') + '/' + p.split('/').pop(); st.fern[d] = t; teile.push(`${p.split('/').pop()!.padEnd(40)} 100%  ${String(t.length).padStart(4)}     ${(t.length / 1024).toFixed(1)}KB/s   00:00`); }
      } else {
        const q = qf![2].replace(/^~/, hm).replace(/^(?!\/)/, hm + '/'); const t = st.fern[q];
        if (t === undefined || t === '') teile.push(`scp: ${qf![2]}: No such file or directory`);
        else { let d = K.pfad(w, ziel); if (w.fs[d] === null) d = d.replace(/\/$/, '') + '/' + q.split('/').pop(); w.fs[d] = t; teile.push(`${q.split('/').pop()!.padEnd(40)} 100%  ${String(t.length).padStart(4)}     ${(t.length / 1024).toFixed(1)}KB/s   00:00`); }
      }
      return teile.join('\n');
    });
  };
  b['ssh-copy-id'] = (w, a) => {
    const st = ss(w); const ii = a.indexOf('-i'); const h = home(w);
    const ziel = a.filter((x, k) => !x.startsWith('-') && (ii < 0 || k !== ii + 1)).pop();
    if (!ziel) return fehler('Usage: /usr/bin/ssh-copy-id [-h|-?|-f|-n|-s|-x] [-i [identity_file]] [-p port] [-F alternative ssh_config file] [-t target_path] [[-o <ssh -o options>] ...] [user@]hostname');
    const pubs = ii >= 0 ? [K.pfad(w, zeigeHome(w, a[ii + 1])).replace(/(\.pub)?$/, '.pub')] : ['id_ed25519', 'id_ecdsa', 'id_rsa', 'id_dsa'].map((n) => `${h}/.ssh/${n}.pub`).filter((p) => p in w.fs).slice(0, 1);
    if (!pubs.length || !(pubs[0] in w.fs)) return fehler('/usr/bin/ssh-copy-id: ERROR: No identities found');
    const kopf = `/usr/bin/ssh-copy-id: INFO: Source of key(s) to be installed: "${pubs[0]}"\n/usr/bin/ssh-copy-id: INFO: attempting to log in with the new key(s), to filter out any that are already installed`;
    const pub = (w.fs[pubs[0]] ?? '').trim();
    const user = ziel.includes('@') ? ziel.split('@')[0] : w.user;
    if ((st.fern[`/home/${user}/.ssh/authorized_keys`] ?? '').includes(pub.split(' ')[1])) return ok(`${kopf}\n\n/usr/bin/ssh-copy-id: WARNING: All keys were skipped because they already exist on the remote system.\n\t\t(if you think this is a mistake, you may want to use -f option)`);
    const r = verbinden(w, ziel, { nurPasswort: true }, (v) => {
      if (!v.ok) return v.text;
      const ak = `/home/${v.user}/.ssh/authorized_keys`; st.fern[`/home/${v.user}/.ssh`] = ''; st.fern[ak] = (st.fern[ak] ?? '') + pub + '\n';
      return `${v.text ? v.text + '\n' : ''}\nNumber of key(s) added: 1\n\nNow try logging into the machine, with:   "ssh '${ziel}'"\nand check to make sure that only the key(s) you wanted were added.\n`;
    });
    const zwischen = `${kopf}\n/usr/bin/ssh-copy-id: INFO: 1 key(s) remain to be installed -- if you are prompted now it is to install the new keys`;
    if (w.dialog) { const d = w.dialog; w.dialog = { prompt: `${zwischen}\n${d.prompt}`, eingabe: d.eingabe }; return { ...r, out: '' }; }
    return { ...r, out: `${zwischen}\n${r.out}` };
  };
  b['ssh-agent'] = (w, a) => {
    const st = ss(w);
    if (a.includes('-k')) { if (!st.agent) return fehler('SSH_AGENT_PID not set, cannot kill agent'); const pid = st.agent.pid; st.agent = null; return ok(`unset SSH_AUTH_SOCK;\nunset SSH_AGENT_PID;\necho Agent pid ${pid} killed;`); }
    const pid = 4712 + (st.agent ? 7 : 0); const sock = `/tmp/ssh-XXXX${pseudo('s' + pid, 6)}/agent.${pid - 1}`;
    st.agent = { pid, sock, keys: [] };
    w.prozesse.push({ pid, user: w.user, cmd: 'ssh-agent', ppid: 1, tty: '?', stat: 'Ss', start: '09:14' });
    if (a.includes('-c')) return ok(`setenv SSH_AUTH_SOCK ${sock};\nsetenv SSH_AGENT_PID ${pid};\necho Agent pid ${pid};`);
    return ok(`SSH_AUTH_SOCK=${sock}; export SSH_AUTH_SOCK;\nSSH_AGENT_PID=${pid}; export SSH_AGENT_PID;\necho Agent pid ${pid};`);
  };
  b['ssh-add'] = (w, a) => {
    const st = ss(w); const h = home(w);
    if (!st.agent || w.env.SSH_AUTH_SOCK !== st.agent.sock) return fehler('Could not open a connection to your authentication agent.', 2);
    const ag = st.agent;
    if (a.includes('-l') || a.includes('-L')) { if (!ag.keys.length) return { out: 'The agent has no identities.', code: 1 }; return ok(ag.keys.map((id) => { const k = st.ssh[id]; return a.includes('-L') ? pubText(k) : `${KEYTYP[k.typ].bits} ${fp(pubText(k))} ${k.kommentar} (${KEYTYP[k.typ].anzeige})`; }).join('\n')); }
    if (a.includes('-D')) { ag.keys = []; return { out: '', err: 'All identities removed.', code: 0 }; }
    const dateien = a.filter((x, k) => !x.startsWith('-') && a[k - 1] !== '-t').map((x) => K.pfad(w, zeigeHome(w, x)));
    if (a.includes('-d')) { for (const p of dateien) { const k = schluesselAus(w, p.replace(/\.pub$/, '')); if (k) ag.keys = ag.keys.filter((x) => x !== k.id); } return { out: '', err: dateien.map((p) => `Identity removed: ${p} (${schluesselAus(w, p.replace(/\.pub$/, ''))?.kommentar ?? ''})`).join('\n'), code: 0 }; }
    const liste = dateien.length ? dateien : ['id_rsa', 'id_ecdsa', 'id_ed25519', 'id_dsa'].map((n) => `${h}/.ssh/${n}`).filter((p) => p in w.fs);
    if (!liste.length) return { out: '', code: 1 };
    const out: string[] = [];
    const naechste = (i: number): string => {
      if (i >= liste.length) return out.join('\n');
      const p = liste[i]; const k = schluesselAus(w, p);
      if (!k) { out.push(`${p}: No such file or directory`); return naechste(i + 1); }
      if (K.modus(w, p) & 0o077) { out.push(`@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\n@         WARNING: UNPROTECTED PRIVATE KEY FILE!          @\n@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\nPermissions 0${(K.modus(w, p) & 0o777).toString(8)} for '${p}' are too open.\nIt is required that your private key files are NOT accessible by others.\nThis private key will be ignored.`); return naechste(i + 1); }
      const dazu = () => { if (!ag.keys.includes(k.id)) ag.keys.push(k.id); out.push(`Identity added: ${p} (${k.kommentar})`); };
      if (!k.pass) { dazu(); return naechste(i + 1); }
      const fragen = (n: number): void => K.dialog(w, (out.length ? out.splice(0).join('\n') + '\n' : '') + `Enter passphrase for ${p}: `, (pw) => { if (pw === k.pass) { dazu(); return naechste(i + 1); } if (n >= 3) return naechste(i + 1); fragen(n + 1); return 'Bad passphrase, try again.'; });
      fragen(1); return '';
    };
    const r = naechste(0);
    return w.dialog ? ok() : { out: '', err: r || undefined, code: 0 };
  };
  b.sshd = (w, a, _i, root) => {
    if (!(root || w.root)) return fehler('sshd: no hostkeys available -- exiting.\n(sshd -t braucht Root-Rechte, um die Host-Schlüssel zu lesen.)');
    const fi = a.indexOf('-f'); const eigene = fi >= 0 ? K.pfad(w, a[fi + 1] ?? '') : null;
    if (eigene !== null && typeof w.fs[eigene] !== 'string') return fehler(`${eigene}: No such file or directory`, 255);
    const pr = sshdPruefenDateien(eigene !== null ? [[eigene, w.fs[eigene] as string]] : sshdDateien(w));
    const f = pr.fehler;
    if (a.includes('-t')) return f ? fehler([...pr.warnungen, f].join('\n'), 255) : { out: '', err: pr.warnungen.join('\n') || undefined, code: 0 };
    if (a.includes('-T')) { if (f) return fehler(f, 255); const t = sshdText(w); return ok(['port', 'permitrootlogin', 'pubkeyauthentication', 'passwordauthentication', 'permitemptypasswords', 'x11forwarding', 'allowtcpforwarding', 'maxauthtries', 'usepam'].map((k) => `${k} ${sshdWert(t, k)}`).join('\n')); }
    return fehler('(sshd startest du mit systemctl start ssh. Zum Prüfen der Konfiguration: sshd -t, für die wirksamen Werte: sshd -T)');
  };
  b.eval = (w, a, i, root) => K.zeile(w, a.join(' '), i, root);

  // --- GnuPG ---
  b.gpg = (w, a, stdin) => {
    const st = ss(w); const h = home(w);
    const lang: Record<string, string> = { '-k': '--list-keys', '-K': '--list-secret-keys', '-e': '--encrypt', '-d': '--decrypt', '-c': '--symmetric', '-s': '--sign', '-b': '--detach-sign', '-a': '--armor', '-r': '--recipient', '-o': '--output', '-u': '--local-user' };
    const args: string[] = []; for (const x of a) { if (/^-[a-zA-Z]{2,}$/.test(x) && x.split('').slice(1).every((c) => lang['-' + c])) args.push(...x.slice(1).split('').map((c) => lang['-' + c])); else args.push(lang[x] ?? x); }
    const has = (x: string) => args.includes(x); const wert = (x: string) => { const k = args.indexOf(x); return k >= 0 ? args[k + 1] : undefined; };
    const empf = args.flatMap((x, k) => (x === '--recipient' ? [args[k + 1]] : []));
    const mitWert = new Set(['--recipient', '--output', '--local-user', '--trust-model', '--default-key', '--homedir']);
    const frei = args.filter((x, k) => !x.startsWith('--') && !mitWert.has(args[k - 1]));
    const vorspann = gpgOrdner(w);
    const fertig = (r: Ergebnis): Ergebnis => ({ ...r, err: [...vorspann.map((x) => x), r.err].filter(Boolean).join('\n') || undefined });
    const ausgabe = (inhalt: string, standard: string | null): Ergebnis => {
      const o = wert('--output') ?? standard;
      if (!o || o === '-') return ok(inhalt.replace(/\n$/, ''));
      const p = K.pfad(w, o); if (p in w.fs && !has('--yes')) { /* gpg fragt nach, der Simulator überschreibt */ }
      w.fs[p] = inhalt; return ok();
    };
    const passwort = (k: GpgKey, weiter: () => string, text = `Sie benötigen ein Passwort, um den geheimen OpenPGP Schlüssel zu entsperren:\n"${k.uid}"\n${k.algo === 'ed25519' ? '255-bit EDDSA' : '3072-bit RSA'} Schlüssel, ID ${kid(k)}, erzeugt ${k.erzeugt}.`): Ergebnis => {
      if (!k.pass || st.gpgCache.includes(k.fpr)) return { out: weiter(), code: 0 };
      K.dialog(w, `┌──────────────────────────────────────────────┐\n${text}\n└──────────────────────────────────────────────┘\n(pinentry) Passwort: `, (pw) => { if (pw !== k.pass) return 'gpg: Falsches Passwort.\ngpg: Signieren fehlgeschlagen: Falsche Passphrase'; st.gpgCache.push(k.fpr); return weiter(); });
      return ok();
    };
    const datei = (x?: string) => { if (!x) return { p: '', t: stdin }; const p = K.pfad(w, x); return { p, t: w.fs[p] }; };
    const keyLabel = (k: GpgKey) => `"${k.uid}"`;

    if (has('--version')) return ok('gpg (GnuPG) 2.2.40\nlibgcrypt 1.10.1\nHome: ' + GPG_HOME(w));
    if (has('--list-keys') || has('--list-public-keys') || has('--fingerprint')) {
      const l = gpgListe(w, false);
      if (frei.length) { const k = gpgFinden(w, frei[0]); if (!k) return fertig(fehler(`gpg: Fehler beim Auflisten der Schlüssel: Kein öffentlicher Schlüssel`, 2)); return fertig(ok(gpgListe(w, false, [k]).split('\n').slice(2).join('\n').replace(/\n$/, '').replace(new RegExp(k.fpr), has('--fingerprint') ? fprSchoen(k.fpr) : k.fpr))); }
      return fertig(ok(has('--fingerprint') ? l.replace(/^ {6}([0-9A-F]{40})$/gm, (_m, f: string) => '      ' + fprSchoen(f)) : l.replace(/\n$/, '')));
    }
    if (has('--list-secret-keys')) return fertig(ok(gpgListe(w, true).replace(/\n$/, '')));
    if (has('--gen-key') || has('--generate-key') || has('--full-generate-key') || has('--full-gen-key') || has('--quick-gen-key') || has('--quick-generate-key')) {
      const anlegen = (uid: string, pass: string): string => {
        const fpr = hash('gpg' + uid + st.gpg.length, 40).toUpperCase();
        const k: GpgKey = { fpr, uid, geheim: true, pass, erzeugt: datum(w), widerrufen: false, vertrauen: 'ultimativ', algo: 'ed25519' };
        st.gpg.push(k); st.gpgCache.push(fpr); gpgSpeichern(w);
        const rev = `${GPG_HOME(w)}/openpgp-revocs.d`; w.fs[rev] = null; K.rechte(w, rev, 0o700, w.user, w.user);
        w.fs[`${rev}/${fpr}.rev`] = `Dies ist ein Widerrufszertifikat für den OpenPGP-Schlüssel:\n\npub   ed25519 ${k.erzeugt} [SC]\n      ${fpr}\nuid          ${uid}\n\nEin Widerrufszertifikat ist eine Art "Notschalter", um öffentlich\nbekanntzugeben, dass ein Schlüssel nicht mehr benutzt werden soll.\n\nUm ein versehentliches Verwenden dieser Datei zu verhindern, wurde\nvor die 5 Bindestriche unten ein Doppelpunkt eingefügt. Entfernen Sie\ndiesen Doppelpunkt, bevor Sie dieses Zertifikat importieren.\n\n:${armor('PUBLIC KEY BLOCK', { t: 'rev', fpr }, 'This is a revocation certificate')}`;
        return `gpg: Schlüssel ${kid(k)} ist als ultimativ vertrauenswürdig gekennzeichnet\ngpg: Verzeichnis \`${rev}' erzeugt\ngpg: Widerrufzertifikat wurde als '${rev}/${fpr}.rev' gespeichert.\nÖffentlichen und geheimen Schlüssel erzeugt und signiert.\n\npub   ed25519 ${k.erzeugt} [SC] [verfällt: ${datum(w, 3)}]\n      ${fpr}\nuid                      ${uid}\nsub   cv25519 ${k.erzeugt} [E] [verfällt: ${datum(w, 3)}]`;
      };
      const pw = (uid: string) => { K.dialog(w, `Bitte geben Sie das Passwort ein,\num Ihren Schlüssel zu schützen.\n(pinentry) Passwort: `, (p1) => { K.dialog(w, '(pinentry) Bitte geben Sie dieses Passwort nochmals ein: ', (p2) => (p1 === p2 ? 'Es müssen sehr viele Zufallswerte erzeugt werden. Sie sollten in der Zeit\nirgendetwas anderes tun (Tippen, Maus bewegen, Festplatte benutzen).\n' + anlegen(uid, p1) : 'Die Passwörter stimmen nicht überein. Bitte versuch es noch einmal.')); return ''; }); };
      if (has('--quick-gen-key') || has('--quick-generate-key')) { const uid = frei[0]; if (!uid) return fertig(fehler('Aufruf: gpg [Optionen] --quick-generate-key User-ID [Algo [Verwendung [Verfallsdatum]]]', 2)); pw(uid); return fertig(ok()); }
      K.dialog(w, `${vorspann.length ? '' : ''}Hinweis: "gpg --full-generate-key" ruft den erweiterten Dialog auf.\n\nGnuPG muss eine User-ID konstruieren, um Ihren Schlüssel identifizierbar zu machen.\n\nIhr Name: `, (name) => {
        if (name.length < 5) return 'Der Name muss mindestens 5 Zeichen lang sein\n(Starte gpg --gen-key noch einmal.)';
        K.dialog(w, 'Email-Adresse: ', (mail) => {
          const uid = `${name} <${mail}>`;
          K.dialog(w, `Sie haben diese User-ID gewählt:\n    "${uid}"\n\nÄndern: (N)ame, (E)-Mail oder (F)ertig/(A)bbrechen? `, (x) => { if (/^[fF]/.test(x)) { pw(uid); return ''; } return 'Abgebrochen.'; });
          return '';
        });
        return '';
      });
      return fertig(ok());
    }
    if (has('--export') || has('--export-secret-keys')) {
      const keys = frei.length ? frei.map((x) => gpgFinden(w, x)).filter(Boolean) as GpgKey[] : st.gpg;
      if (!keys.length) return fertig({ out: '', err: 'gpg: WARNUNG: Nichts exportiert', code: 0 });
      if (has('--export-secret-keys')) { const k = keys[0]; if (!k.geheim) return fertig(fehler('gpg: WARNUNG: Nichts exportiert')); return fertig(passwort(k, () => { const r = ausgabe(has('--armor') ? armor('PRIVATE KEY BLOCK', { t: 'sec', k }) : '\u0007GPG:' + b64(JSON.stringify({ t: 'sec', k })), null); return r.out; }, 'Sie benötigen ein Passwort, um den geheimen OpenPGP Schlüssel zu exportieren:')); }
      const inhalt = keys.map((k) => ({ t: 'pub', k: { ...k, geheim: false, pass: '', vertrauen: 'unbekannt' } }));
      return fertig(ausgabe(has('--armor') ? inhalt.map((x) => armor('PUBLIC KEY BLOCK', x)).join('') : '\u0007GPG:' + b64(JSON.stringify(inhalt[0])), null));
    }
    if (has('--import')) {
      const { t } = datei(frei[0]); if (t === undefined || t === null) return fertig(fehler(`gpg: Öffnen von '${frei[0]}' fehlgeschlagen: Datei oder Verzeichnis nicht gefunden`, 2));
      const bloecke = gpgLesen(t);
      if (!bloecke.length) return fertig(fehler('gpg: keine gültigen OpenPGP-Daten gefunden.\ngpg: Anzahl insgesamt bearbeiteter Schlüssel: 0', 2));
      const out: string[] = []; let neu = 0, rev = 0;
      for (const bl of bloecke) {
        if (bl.t === 'rev') { const k = st.gpg.find((x) => x.fpr === bl.fpr); if (!k) { out.push(`gpg: Schlüssel ${String(bl.fpr).slice(-16)}: Kein öffentlicher Schlüssel - der Widerruf kann nicht angebracht werden`); continue; } k.widerrufen = true; rev++; out.push(`gpg: Schlüssel ${kid(k)}: "${k.uid}" Widerrufzertifikat importiert`); continue; }
        const k = bl.k as GpgKey; const da = st.gpg.find((x) => x.fpr === k.fpr);
        if (da) { if (bl.t === 'sec') da.geheim = true; if (k.widerrufen && !da.widerrufen) { da.widerrufen = true; rev++; } out.push(`gpg: Schlüssel ${kid(k)}: "${k.uid}" nicht geändert`); continue; }
        st.gpg.push({ ...k, vertrauen: bl.t === 'sec' ? 'unbekannt' : 'unbekannt' }); neu++;
        out.push(`gpg: Schlüssel ${kid(k)}: Öffentlicher Schlüssel "${k.uid}" importiert`);
      }
      gpgSpeichern(w);
      out.push(`gpg: Anzahl insgesamt bearbeiteter Schlüssel: ${bloecke.length}`, ...(neu ? [`gpg:               importiert: ${neu}`] : []), ...(rev ? [`gpg:         neue Schlüsselwiderrufe: ${rev}`] : []), ...(!neu && !rev ? [`gpg:              unverändert: ${bloecke.length}`] : []));
      return fertig({ out: '', err: out.join('\n'), code: 0 });
    }
    if (has('--gen-revoke') || has('--generate-revocation')) {
      const k = gpgFinden(w, frei[0] ?? '', true); if (!k) return fertig(fehler(`gpg: Geheimer Schlüssel "${frei[0] ?? ''}" ist nicht vorhanden: Kein geheimer Schlüssel`, 2));
      K.dialog(w, `\nsec  ed25519/${kid(k)} ${k.erzeugt} ${k.uid}\n\nEin Widerrufszertifikat für diesen Schlüssel erzeugen? (j/N) `, (j) => {
        if (!/^[jy]/i.test(j)) return '';
        K.dialog(w, 'Grund für den Widerruf:\n  0 = Kein Grund angegeben\n  1 = Hinweis: Schlüssel ist kompromittiert\n  2 = Schlüssel ist überholt\n  3 = Schlüssel wird nicht mehr benutzt\n  Q = Abbruch\n(Wahrscheinlich möchten Sie hier 1 auswählen)\nIhre Auswahl? ', (g) => {
          if (!/^[0-3]$/.test(g)) return '';
          K.dialog(w, 'Geben Sie eine optionale Beschreibung ein. Beenden mit einer leeren Zeile:\n> ', (_b) => {
            K.dialog(w, `Grund für Widerruf: ${['Kein Grund angegeben', 'Hinweis: Schlüssel ist kompromittiert', 'Schlüssel ist überholt', 'Schlüssel wird nicht mehr benutzt'][Number(g)]}\nIst das OK? (j/N) `, (ja) => {
              if (!/^[jy]/i.test(ja)) return '';
              const r = passwort(k, () => { ausgabe(armor('PUBLIC KEY BLOCK', { t: 'rev', fpr: k.fpr }, 'This is a revocation certificate'), null); return wert('--output') ? 'ASCII-geschütztes Ausgabe erzwungen.\nWiderrufszertifikat wurde erzeugt.\n\nBitte speichern Sie es auf einem Medium, welches Sie wegschließen können.' : armor('PUBLIC KEY BLOCK', { t: 'rev', fpr: k.fpr }, 'This is a revocation certificate'); });
              return r.out;
            });
            return '';
          });
          return '';
        });
        return '';
      });
      return fertig(ok());
    }
    if (has('--delete-key') || has('--delete-secret-key') || has('--delete-keys')) { const k = gpgFinden(w, frei[0] ?? ''); if (!k) return fertig(fehler(`gpg: Schlüssel "${frei[0]}" nicht gefunden: Kein öffentlicher Schlüssel`)); if (k.geheim && !has('--delete-secret-key')) return fertig(fehler(`gpg: Es gibt einen geheimen Schlüssel zum öffentlichen Schlüssel "${frei[0]}"!\ngpg: Bitte zuerst mit "--delete-secret-key" löschen.`)); if (has('--delete-secret-key')) k.geheim = false; else st.gpg = st.gpg.filter((x) => x !== k); gpgSpeichern(w); return fertig(ok()); }
    if (has('--sign-key') || has('--lsign-key')) { const k = gpgFinden(w, frei[0] ?? ''); const ich = st.gpg.find((x) => x.geheim && !x.widerrufen); if (!k || !ich) return fertig(fehler('gpg: Kein geheimer Schlüssel zum Beglaubigen vorhanden.')); K.dialog(w, `pub  ed25519/${kid(k)}\n     erzeugt: ${k.erzeugt}  verfällt: ${datum(w, 3)}  Nutzung: SC\n     Vertrauen: unbekannt     Gültigkeit: unbekannt\n[ unbekannt] (1). ${k.uid}\n\nWirklich unterschreiben? (j/N) `, (j) => { if (!/^[jy]/i.test(j)) return ''; return passwort(ich, () => { k.vertrauen = 'voll'; return ''; }).out; }); return fertig(ok()); }
    if (has('--verify')) {
      const [sigDatei, daten] = frei; const sig = datei(sigDatei);
      if (sig.t === undefined || sig.t === null) return fertig(fehler(`gpg: Öffnen von '${sigDatei}' fehlgeschlagen: Datei oder Verzeichnis nicht gefunden`, 2));
      const bl = gpgLesen(sig.t).find((x) => x.t === 'sig' || x.t === 'clear' || x.t === 'signed');
      if (!bl) return fertig(fehler('gpg: keine signierten Daten\ngpg: can\'t hash datafile: Keine Daten', 2));
      let inhalt: string | null | undefined;
      if (bl.t === 'sig') { const d = daten ?? sigDatei.replace(/\.(sig|asc)$/, ''); inhalt = w.fs[K.pfad(w, d)]; if (inhalt === undefined || inhalt === null) return fertig(fehler(`gpg: keine signierten Daten\ngpg: can't hash datafile: Datei oder Verzeichnis nicht gefunden`, 2)); }
      else if (bl.t === 'clear') { inhalt = sig.t.match(/^-----BEGIN PGP SIGNED MESSAGE-----\nHash: \w+\n\n([\s\S]*?)\n?-----BEGIN PGP SIGNATURE-----/)?.[1] ?? ''; inhalt = inhalt.replace(/^- -/gm, '-') + '\n'; }
      else inhalt = String(bl.inhalt);
      const k = st.gpg.find((x) => x.fpr === bl.von);
      const kopf = `gpg: Signatur vom ${String(bl.datum)}\ngpg:                mittels EDDSA Schlüssel ${String(bl.von)}`;
      if (!k) return fertig(fehler(`${kopf}\ngpg: Signatur kann nicht geprüft werden: Kein öffentlicher Schlüssel`, 2));
      if (pruef(inhalt) !== bl.hash) return fertig(fehler(`${kopf}\ngpg: FALSCHE Signatur von "${k.uid}" [${k.vertrauen === 'ultimativ' ? 'ultimativ' : 'unbekannt'}]`, 1));
      return fertig({ out: '', err: `${kopf}\ngpg: Korrekte Signatur von "${k.uid}" [${k.vertrauen === 'ultimativ' ? 'ultimativ' : k.vertrauen === 'voll' ? 'vollständig' : 'unbekannt'}]${k.widerrufen ? '\ngpg: WARNUNG: Dieser Schlüssel wurde von seinem Besitzer widerrufen!' : ''}${k.vertrauen === 'unbekannt' && !k.widerrufen ? `\ngpg: WARNUNG: Dieser Schlüssel trägt keine vertrauenswürdige Signatur!\ngpg:          Es gibt keinen Hinweis, daß die Signatur wirklich dem vorgeblichen Besitzer gehört.\nHaupt-Fingerabdruck  = ${fprSchoen(k.fpr)}` : ''}`, code: 0 });
    }
    if (has('--decrypt')) {
      const d = datei(frei[0]); if (d.t === undefined || d.t === null) return fertig(fehler(`gpg: ${frei[0]}: Öffnen fehlgeschlagen: Datei oder Verzeichnis nicht gefunden`, 2));
      const bl = gpgLesen(d.t)[0]; if (!bl) return fertig(fehler('gpg: keine gültigen OpenPGP-Daten gefunden.\ngpg: decrypt_message failed: Unbekanntes Systemfehler', 2));
      if (bl.t === 'sym') {
        if (st.gpgCache.includes('sym:' + bl.pass)) return fertig({ ...ausgabe(String(bl.inhalt), null), err: 'gpg: AES256.CFB verschlüsselte Daten\ngpg: Verschlüsselt mit einem Passwort' });
        K.dialog(w, '┌──────────────────────────────────────────────┐\nBitte geben Sie das Passwort zur Entschlüsselung ein:\n└──────────────────────────────────────────────┘\n(pinentry) Passwort: ', (pw) => { if (pw !== bl.pass) return 'gpg: AES256.CFB verschlüsselte Daten\ngpg: Verschlüsselt mit einem Passwort\ngpg: Entschlüsselung fehlgeschlagen: Falscher Schlüssel'; st.gpgCache.push('sym:' + pw); const r = ausgabe(String(bl.inhalt), null); return 'gpg: AES256.CFB verschlüsselte Daten\ngpg: Verschlüsselt mit einem Passwort' + (r.out ? '\n' + r.out : ''); });
        return fertig(ok());
      }
      if (bl.t === 'signed') { const k = st.gpg.find((x) => x.fpr === bl.von); const r = ausgabe(String(bl.inhalt), null); return fertig({ ...r, err: `gpg: Signatur vom ${String(bl.datum)}\ngpg:                mittels EDDSA Schlüssel ${String(bl.von)}\ngpg: ${k ? `Korrekte Signatur von "${k.uid}" [${k.vertrauen === 'ultimativ' ? 'ultimativ' : 'unbekannt'}]` : 'Signatur kann nicht geprüft werden: Kein öffentlicher Schlüssel'}` }); }
      if (bl.t !== 'enc') return fertig(fehler('gpg: keine gültigen OpenPGP-Daten gefunden.', 2));
      const an = bl.an as string[];
      const zeilen = an.map((f) => { const k = st.gpg.find((x) => x.fpr === f); return `gpg: verschlüsselt mit cv25519 Schlüssel, ID ${f.slice(-16)}, erzeugt ${k?.erzeugt ?? '2026-11-02'}\n      "${k?.uid ?? f.slice(-16)}"`; }).join('\n');
      const k = st.gpg.find((x) => x.geheim && an.includes(x.fpr));
      if (!k) return fertig(fehler(`${zeilen}\ngpg: Entschlüsselung fehlgeschlagen: Kein geheimer Schlüssel`, 2));
      const klar = () => ausgabe(String(bl.inhalt), null).out;
      if (!k.pass || st.gpgCache.includes(k.fpr)) return fertig({ out: klar(), err: zeilen, code: 0 });
      return fertig(passwort(k, () => [zeilen, klar()].filter(Boolean).join('\n'), `Sie benötigen ein Passwort, um den geheimen OpenPGP Schlüssel zu entsperren:\n"${k.uid}"\n255-bit ECDH Schlüssel, ID ${kid(k).replace(/^.{4}/, 'E2A1')}, erzeugt ${k.erzeugt}`));
    }
    if (has('--symmetric') && !has('--encrypt')) {
      const d = datei(frei[0]); if (d.t === undefined || d.t === null) return fertig(fehler(`gpg: ${frei[0]}: Öffnen fehlgeschlagen: Datei oder Verzeichnis nicht gefunden`, 2));
      K.dialog(w, 'Bitte geben Sie das Passwort ein\n(pinentry) Passwort: ', (p1) => { K.dialog(w, '(pinentry) Bitte geben Sie dieses Passwort nochmals ein: ', (p2) => { if (p1 !== p2) return 'Die Passwörter stimmen nicht überein.'; st.gpgCache.push('sym:' + p1); const inhalt = { t: 'sym', pass: p1, inhalt: d.t }; return ausgabe(has('--armor') ? armor('MESSAGE', inhalt) : '\u0007GPG:' + b64(JSON.stringify(inhalt)), d.p ? d.p + (has('--armor') ? '.asc' : '.gpg') : null).out; }); return ''; });
      return fertig(ok());
    }
    if (has('--encrypt')) {
      const d = datei(frei[0]); if (d.t === undefined || d.t === null) return fertig(fehler(`gpg: ${frei[0]}: Öffnen fehlgeschlagen: Datei oder Verzeichnis nicht gefunden`, 2));
      if (!empf.length) return fertig(fehler('gpg: Sie haben keine User-ID angegeben (Sie können die Option "-r" verwenden).\n(Im echten gpg fragt es jetzt nach. Gib den Empfänger mit -r an.)', 2));
      const keys: GpgKey[] = [];
      for (const e of empf) { const k = gpgFinden(w, e); if (!k) return fertig(fehler(`gpg: ${e}: übersprungen: Kein öffentlicher Schlüssel\ngpg: ${frei[0] ?? '[stdin]'}: Verschlüsselung fehlgeschlagen: Kein öffentlicher Schlüssel`, 2)); if (k.widerrufen) return fertig(fehler(`gpg: ${e}: übersprungen: Unbrauchbarer öffentlicher Schlüssel\ngpg: ${frei[0]}: Verschlüsselung fehlgeschlagen: Unbrauchbarer öffentlicher Schlüssel`, 2)); keys.push(k); }
      const schreiben = () => { const inhalt = { t: 'enc', an: keys.map((k) => k.fpr), inhalt: d.t }; return ausgabe(has('--armor') ? armor('MESSAGE', inhalt) : '\u0007GPG:' + b64(JSON.stringify(inhalt)), d.p ? d.p + (has('--armor') ? '.asc' : '.gpg') : null).out; };
      const unsicher = keys.filter((k) => k.vertrauen === 'unbekannt');
      if (unsicher.length && wert('--trust-model') !== 'always') {
        const k = unsicher[0];
        K.dialog(w, `gpg: ${kid(k)}: Es gibt keine Garantie, daß dieser Schlüssel wirklich dem angegebenen Besitzer gehört.\nsub  cv25519/${kid(k).replace(/^.{4}/, 'E7C0')} ${k.erzeugt} ${k.uid}\n Haupt-Fingerabdruck  = ${fprSchoen(k.fpr)}\n\nEs ist NICHT sicher, daß der Schlüssel zu dem in der User-ID\nGenannten gehört.  Wenn Sie *wirklich* wissen, was Sie tun,\nkönnen Sie die nächste Frage mit ja beantworten\n\nDiesen Schlüssel trotzdem benutzen? (j/N) `, (j) => (/^[jy]/i.test(j) ? schreiben() : `gpg: ${frei[0]}: Verschlüsselung fehlgeschlagen: Unbrauchbarer öffentlicher Schlüssel`));
        return fertig(ok());
      }
      return fertig({ out: schreiben(), code: 0 });
    }
    if (has('--sign') || has('--clearsign') || has('--clear-sign') || has('--detach-sign')) {
      const lu = wert('--local-user'); const k = lu ? gpgFinden(w, lu, true) : st.gpg.find((x) => x.geheim && !x.widerrufen);
      if (!k) return fertig(fehler('gpg: kein geheimer Standardschlüssel: Kein geheimer Schlüssel\ngpg: signing failed: Kein geheimer Schlüssel', 2));
      const d = datei(frei[0]); if (d.t === undefined || d.t === null) return fertig(fehler(`gpg: ${frei[0]}: Öffnen fehlgeschlagen: Datei oder Verzeichnis nicht gefunden`, 2));
      const dt = new Date(w.uhr + 3600000); const zeit = `${['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][dt.getUTCDay()]} ${String(dt.getUTCDate()).padStart(2, '0')} ${['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'][dt.getUTCMonth()]} ${dt.getUTCFullYear()} ${dt.toISOString().slice(11, 19)} CET`;
      const meta = { von: k.fpr, datum: zeit, hash: pruef(d.t) };
      return fertig(passwort(k, () => {
        if (has('--clearsign') || has('--clear-sign')) return ausgabe(`-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA512\n\n${d.t!.replace(/^-/gm, '- -').replace(/\n$/, '')}\n${armor('SIGNATURE', { t: 'clear', ...meta })}`, d.p ? d.p + '.asc' : null).out;
        if (has('--detach-sign')) return ausgabe(has('--armor') ? armor('SIGNATURE', { t: 'sig', ...meta }) : '\u0007GPG:' + b64(JSON.stringify({ t: 'sig', ...meta })), d.p ? d.p + (has('--armor') ? '.asc' : '.sig') : null).out;
        return ausgabe(has('--armor') ? armor('MESSAGE', { t: 'signed', ...meta, inhalt: d.t }) : '\u0007GPG:' + b64(JSON.stringify({ t: 'signed', ...meta, inhalt: d.t })), d.p ? d.p + (has('--armor') ? '.asc' : '.gpg') : null).out;
      }));
    }
    if (!args.length && stdin) return fertig(ok('gpg: WARNUNG: Keine Befehle angegeben – rate, was gemeint ist …'));
    return fertig(fehler('gpg: Befehl nicht erkannt. Im Simulator: --gen-key, --quick-gen-key, -k, -K, --fingerprint, --export, --import, -e -r, -d, -c, -s, --clearsign, -b, --verify, --gen-revoke, --sign-key, --delete-key.', 2));
  };
  b.gpgconf = (w, a) => { if (a.includes('--kill') && a.includes('gpg-agent')) { ss(w).gpgCache = []; return ok(); } if (a.includes('--list-dirs')) return ok(`sysconfdir:/etc/gnupg\nbindir:/usr/bin\nlibexecdir:/usr/lib/gnupg\nhomedir:${GPG_HOME(w)}\nagent-socket:/run/user/1000/gnupg/S.gpg-agent`); return fehler('gpgconf: Im Simulator: gpgconf --kill gpg-agent · gpgconf --list-dirs'); };
  b['gpg-agent'] = (w) => ok(`gpg-agent[${4890}]: gpg-agent läuft bereits - es wird kein neuer gestartet\n(gpg startet den Agenten selbst. Er merkt sich Passwörter eine Weile, gpgconf --kill gpg-agent beendet ihn.)`);
  b['gpg-connect-agent'] = (w, a) => { if (a.join(' ').includes('reloadagent')) { ss(w).gpgCache = []; return ok('OK'); } return ok('OK'); };
  return b;
}

/** Vorbereitete Dateien von Max: sein öffentlicher Schlüssel und signierte Messwerte. */
export function maxDateien(w: Welt) {
  const fpr = '7D3A9C41E28B5F06A1C4D9E2B7F3605A9E4C1B8D';
  const k: GpgKey = { fpr, uid: 'Max Weber <max@lab.example.org>', geheim: false, pass: '', erzeugt: '2026-11-02', widerrufen: false, vertrauen: 'unbekannt', algo: 'ed25519' };
  const csv = 'zeit;sensor;wert\n08:00;3;21.4\n08:10;3;21.9\n08:20;3;22.3\n';
  const meta = { von: fpr, datum: 'Mo 23 Nov 2026 07:58:12 CET', hash: pruef(csv) };
  Object.assign(w.fs, {
    '/home/lena/max.asc': armor('PUBLIC KEY BLOCK', { t: 'pub', k }),
    '/home/lena/messwerte.csv': csv,
    '/home/lena/messwerte.csv.sig': '\u0007GPG:' + b64(JSON.stringify({ t: 'sig', ...meta })),
    '/home/lena/kalibrierung.csv': 'sensor;offset\n3;-0.4\n',
    '/home/lena/kalibrierung.csv.sig': '\u0007GPG:' + b64(JSON.stringify({ t: 'sig', ...meta, hash: pruef('sensor;offset\n3;-0.2\n') })),
  });
}

netzExtraSockets(sicherSockets);

export function zustandSicherheit(w: Welt, s: string): boolean | undefined {
  const st = ss(w); let m;
  if ((m = s.match(/^unit:(\S+)=(aktiv|inaktiv)$/))) { const n = unitName(m[1], st.units); return !!n && st.units[n].aktiv === (m[2] === 'aktiv'); }
  if ((m = s.match(/^unit:(\S+)=(enabled|disabled|masked)$/))) { const n = unitName(m[1], st.units); return !!n && st.units[n].enabled === m[2]; }
  if ((m = s.match(/^port:(tcp|udp)\/(\d+)=(offen|zu)$/))) { const offen = sicherSockets(w).some((x) => x.p === m![1] && x.s !== 'WEG' && x.s !== 'ESTAB' && x.l.endsWith(':' + m![2])) || (m[1] === 'tcp' && ['22', '25', '631'].includes(m[2]) && !(m[2] === '22' && !st.sshdLaeuft)); return offen === (m[3] === 'offen'); }
  if ((m = s.match(/^wrapper:(\S+)@(\S+)=(erlaubt|verboten)$/))) return wrapperErlaubt(w, m[1], m[2]).erlaubt === (m[3] === 'erlaubt');
  if (s === 'sudoers:gueltig') return !sudoersPruefen(w);
  if ((m = s.match(/^sudo:(\S+)=(.+)$/))) { const [p, ...rest] = m[2].split(' '); return sudoErlaubt(w, m[1], [p.split('/').pop(), ...rest].join(' '), p) === null; }
  if ((m = s.match(/^keinsudo:(\S+)=(.+)$/))) { const [p, ...rest] = m[2].split(' '); return sudoErlaubt(w, m[1], [p.split('/').pop(), ...rest].join(' '), p) !== null; }
  if ((m = s.match(/^sshd:(\w+)=(\S+)$/))) return st.sshdLaeuft && sshdWert(st.sshdConf, m[1].toLowerCase()) === m[2];
  if (s === 'sshd:laeuft') return st.sshdLaeuft;
  if ((m = s.match(/^sshkey:(\S+)$/))) return !!schluesselAus(w, K.pfad(w, zeigeHome(w, m[1])));
  if ((m = s.match(/^sshkeypass:(\S+)$/))) return !!schluesselAus(w, K.pfad(w, zeigeHome(w, m[1])))?.pass;
  if ((m = s.match(/^fern:(\S+?)~(.*)$/))) return new RegExp(m[2], 'm').test(st.fern[m[1]] ?? '');
  if ((m = s.match(/^knownhost:(\S+)=(alt|neu|fehlt)$/))) { const t = w.fs[`${home(w)}/.ssh/known_hosts`] ?? ''; const z = t.split('\n').find((l) => l.split(' ')[0] === khName(m![1]) || l.split(' ')[0] === m![1]); return m[2] === 'fehlt' ? !z : !!z && z.includes(m[2] === 'neu' ? FERN_HOSTKEY_NEU : FERN_HOSTKEY); }
  if ((m = s.match(/^agent:(\d+)$/))) return !!st.agent && w.env.SSH_AUTH_SOCK === st.agent.sock && st.agent.keys.length >= Number(m[1]);
  if ((m = s.match(/^tunnel:(\d+)$/))) return st.tunnel.some((t) => t.port === Number(m![1]));
  if ((m = s.match(/^gpgkey:(.+?)(=geheim|=widerrufen|=vertraut)?$/))) { const k = gpgFinden(w, m[1]); if (!k) return false; return m[2] === '=geheim' ? k.geheim : m[2] === '=widerrufen' ? k.widerrufen : m[2] === '=vertraut' ? k.vertrauen !== 'unbekannt' : true; }
  if ((m = s.match(/^gpgdatei:(\S+)=(enc|sym|sig|clear|signed)(?::(.+))?$/))) { const t = w.fs[K.pfad(w, m[1])]; if (!t) return false; const bl = gpgLesen(t)[0]; if (!bl || bl.t !== m[2]) return false; if (!m[3]) return true; const k = gpgFinden(w, m[3]); return !!k && ((bl.an as string[] | undefined)?.includes(k.fpr) || bl.von === k.fpr); }
  if ((m = s.match(/^limit:(\w)=(\S+)$/))) return st.limits[m[1]]?.[0] === m[2];
  if ((m = s.match(/^prozess-offen:(\S+)=(da|weg)$/))) { const p = K.pfad(w, m[1]); const da = st.offen.some((o) => o.name === p || o.name.startsWith(p + '/')); return da === (m[2] === 'da'); }
  return undefined;
}
