// Systemstart für den Simulator (LPIC-2 Topic 202): SysV-init mit inittab, rc-Verzeichnissen, update-rc.d und
// chkconfig; systemd-Units mit Drop-ins, systemctl cat/edit/show, systemd-delta; der Weg von der Firmware über
// GRUB zum Kernel mit efibootmgr, GRUB-Menü und GRUB-Shell; Rettung über init=/bin/bash, emergency.target und
// ein Live-System mit chroot; PXE und SYSLINUX.
// Ohne Welt-Option `start` bleibt alles wie bisher.
import type { Welt } from './shell';
import { meta } from './shell-dateien';

type Ergebnis = { out: string; err?: string; code: number; ende?: unknown };
type B = (w: Welt, a: string[], stdin: string, root: boolean) => Ergebnis;
const ok = (out = ''): Ergebnis => ({ out, code: 0 });
const fehler = (err: string, code = 1): Ergebnis => ({ out: '', err, code });

export interface StartKern {
  pfad: (w: Welt, p: string) => string;
  dialog: (w: Welt, prompt: string, weiter: (z: string) => string) => void;
  vi: (w: Welt, p: string, nach: (art: string) => string) => Ergebnis;
  weiterStarten: (w: Welt) => string;
  grub: (w: Welt) => string;
  installieren: (w: Welt, namen: string[]) => void;
}
let K: StartKern;
export function startKern(k: StartKern) { K = k; }

export interface StartOptionen {
  sysv?: 'debian' | 'chkconfig';  // SysV-init auf Debian (sysvinit-core) oder SysV-Skripte unter AlmaLinux
  units?: boolean;                // messd.service vom Hersteller
  dropinKaputt?: boolean;         // ein Drop-in setzt einen Benutzer, den es nicht gibt
  efiWeg?: boolean;               // EFI/debian und der NVRAM-Eintrag fehlen
  grub?: 'menue' | 'cfgweg';      // menue: der Rechner steht im GRUB-Menü · cfgweg: /boot/grub/grub.cfg fehlt
  fstabKaputt?: boolean;          // Eintrag für eine ausgebaute Sicherungsplatte ohne nofail
  rootVergessen?: boolean;        // niemand kennt das Root-Passwort
  live?: boolean;                 // gestartet vom Live-Stick, das System liegt auf nvme0n1
  pxe?: boolean;                  // srv1 wird PXE-Server
  aus?: boolean;                  // Rechner ist aus und startet mit „Neu starten“
  pxeZuerst?: boolean;            // BootOrder beginnt mit PXE
}
interface Eintrag { name: string; datei?: string; pxe?: boolean; usb?: boolean; aktiv: boolean }
interface UnitStand { aktiv: boolean; geladen: string; fehler?: string; seit?: number }
interface StStand {
  opt: StartOptionen;
  laeuft: string[];               // SysV-Dienste
  rl: string; rlVorher: string;
  units: Record<string, UnitStand>;
  efi: { order: string[]; next: string | null; current: string; e: Record<string, Eintrag> };
  modus: null | 'bash' | 'emergency' | 'rescue';
  chroot: { dir: string; fs: Record<string, string | null>; meta: NonNullable<Welt['meta']>; root: boolean; cwd: string }[];
  binds: string[];
  live: boolean;
  hostAlt: string;
  fstabGeladen: string;
  journal: string[];
  grubMenue: boolean;
  manuell: null | { kernel?: string; args?: string; initrd?: string; root?: string };
  gebootet: string[];             // Protokoll: wie gestartet wurde
  rootPw: string;
}
type SW = Welt & { startstand?: StStand };
export function startAktiv(w: Welt): boolean { return !!(w as SW).startstand; }
const ss = (w: Welt) => (w as SW).startstand!;
const ROOT_UUID = '3f1c0d6e-8a2b-4c51-9a0e-2d7b1e5c9f40';
const ESP_UUID = '6A1F-2B3C';
const hat = (w: Welt, p: string) => typeof w.fs[p] === 'string';

function ordner(w: Welt, p: string) { const t = p.split('/').filter(Boolean); for (let i = 1; i <= t.length; i++) { const d = '/' + t.slice(0, i).join('/'); if (!(d in w.fs)) { w.fs[d] = null; const m = meta(w, d); m.mode = 0o755; m.owner = 'root'; m.group = 'root'; } } }
function datei(w: Welt, p: string, c: string, mode = 0o644) { ordner(w, p.slice(0, p.lastIndexOf('/')) || '/'); w.fs[p] = c; const m = meta(w, p); m.mode = mode; m.owner = 'root'; m.group = 'root'; m.mtime = w.uhr; }
function weg(w: Welt, p: string) { for (const k of Object.keys(w.fs)) if (k === p || k.startsWith(p + '/')) { delete w.fs[k]; if (w.meta) delete w.meta[k]; } }

// ---------- SysV-init ----------

const INITTAB = `# /etc/inittab: Konfiguration von init (SysV)
# Aufbau jeder Zeile: Kennung:Runlevel:Aktion:Befehl

# Standard-Runlevel. Debian nutzt 2 für den normalen Betrieb.
id:2:initdefault:

# Beim Start zuerst alles aus /etc/rcS.d
si::sysinit:/etc/init.d/rcS

# Einzelbenutzer: nach dem Root-Passwort fragen
~~:S:wait:/sbin/sulogin --force

# Beim Wechsel in einen Runlevel dessen Skripte ausführen
l0:0:wait:/etc/init.d/rc 0
l1:1:wait:/etc/init.d/rc 1
l2:2:wait:/etc/init.d/rc 2
l3:3:wait:/etc/init.d/rc 3
l4:4:wait:/etc/init.d/rc 4
l5:5:wait:/etc/init.d/rc 5
l6:6:wait:/etc/init.d/rc 6

# Strg+Alt+Entf
ca:12345:ctrlaltdel:/sbin/shutdown -t1 -a -r now

# Anmeldung auf den Konsolen, nach dem Abmelden neu starten
1:2345:respawn:/sbin/getty --noclear 38400 tty1
2:23:respawn:/sbin/getty 38400 tty2
3:23:respawn:/sbin/getty 38400 tty3
`;
const lsb = (name: string, text: string, start = '2 3 4 5', stop = '0 1 6', req = '$remote_fs $syslog') => `#!/bin/sh
### BEGIN INIT INFO
# Provides:          ${name}
# Required-Start:    ${req}
# Required-Stop:     ${req}
# Default-Start:     ${start}
# Default-Stop:      ${stop}
# Short-Description: ${text}
### END INIT INFO

. /lib/lsb/init-functions
case "$1" in
  start)   log_daemon_msg "Starting ${text}" "${name}" ;;
  stop)    log_daemon_msg "Stopping ${text}" "${name}" ;;
  restart|force-reload) $0 stop; $0 start ;;
  status)  status_of_proc /usr/sbin/${name} ${name} ;;
  *)       echo "Usage: /etc/init.d/${name} {start|stop|restart|force-reload|status}"; exit 1 ;;
esac
`;
const SYSV_DIENSTE: Record<string, [string, string]> = { rsyslog: ['enhanced multi-threaded syslogd', '01'], cron: ['periodic command scheduler', '02'], ssh: ['OpenBSD Secure Shell server', '02'], messd: ['Messdienst der Labor Mess GmbH', '02'] };
function rcLinks(w: Welt, basis: string, name: string, start: string[], stopp: string[], sNr: string, kNr: string) {
  for (const rl of ['0', '1', '2', '3', '4', '5', '6']) {
    for (const p of Object.keys(w.fs)) if (new RegExp(`^${basis}/rc${rl}\\.d/[SK]\\d\\d${name}$`).test(p)) delete w.fs[p];
    if (start.includes(rl)) datei(w, `${basis}/rc${rl}.d/S${sNr}${name}`, `-> ../init.d/${name}`, 0o777);
    if (stopp.includes(rl)) datei(w, `${basis}/rc${rl}.d/K${kNr}${name}`, `-> ../init.d/${name}`, 0o777);
  }
}
function lsbFeld(t: string, f: string): string[] { return (t.match(new RegExp(`^# ${f}:\\s*(.*)$`, 'm'))?.[1] ?? '').split(/\s+/).filter(Boolean); }
const initd = (w: Welt) => (ss(w).opt.sysv === 'chkconfig' ? '/etc/rc.d/init.d' : '/etc/init.d');
const rcBasis = (w: Welt) => (ss(w).opt.sysv === 'chkconfig' ? '/etc/rc.d' : '/etc');
function startLinks(w: Welt, rl: string) {
  return Object.keys(w.fs).filter((p) => p.startsWith(`${rcBasis(w)}/rc${rl}.d/`)).map((p) => p.split('/').pop()!).sort();
}
function rcWechsel(w: Welt, rl: string): string {
  const st = ss(w); const z: string[] = [];
  for (const l of startLinks(w, rl)) {
    const m = l.match(/^([SK])(\d\d)(.+)$/); if (!m) continue;
    const n = m[3]; const t = SYSV_DIENSTE[n]?.[0] ?? n;
    if (m[1] === 'K' && st.laeuft.includes(n)) { st.laeuft = st.laeuft.filter((x) => x !== n); z.push(`Stopping ${t}: ${n}.`); }
    if (m[1] === 'S' && !st.laeuft.includes(n) && hat(w, `${initd(w)}/${n}`)) { st.laeuft.push(n); z.push(`Starting ${t}: ${n}.`); }
  }
  st.rlVorher = st.rl; st.rl = rl;
  respawn(w);
  return z.join('\n');
}
function inittabZeilen(w: Welt) { return (w.fs['/etc/inittab'] ?? '').split('\n').filter((z) => z && !z.startsWith('#')).map((z) => z.split(':')).filter((x) => x.length >= 4); }
function respawn(w: Welt) {
  const st = ss(w);
  const soll = inittabZeilen(w).filter(([, rls, akt]) => akt === 'respawn' && rls.includes(st.rl));
  const ids = new Set(soll.map((x) => x[0]));
  w.prozesse = w.prozesse.filter((p) => { const k = (p as { inittab?: string }).inittab; return !k || ids.has(k); });
  for (const [id, , , ...bef] of soll) {
    if (w.prozesse.some((p) => (p as { inittab?: string }).inittab === id)) continue;
    const pid = w.naechstePid++;
    w.prozesse.push({ pid, user: 'root', cmd: bef.join(':'), ppid: 1, tty: bef.join(':').match(/tty\d/)?.[0] ?? '?', stat: 'Ss', start: '08:12', inittab: id } as Welt['prozesse'][number]);
  }
}

// ---------- systemd-Units ----------

const UDIR = ['/etc/systemd/system', '/run/systemd/system', '/usr/lib/systemd/system'];
const MESSD_UNIT = `[Unit]
Description=Messdienst der Labor Mess GmbH
Documentation=man:messd(8)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=mess
ExecStart=/usr/sbin/messd --config /etc/messd.conf
Restart=on-failure

[Install]
WantedBy=multi-user.target
`;
const BT_UNIT = `[Unit]
Description=Bluetooth service
Documentation=man:bluetoothd(8)

[Service]
Type=dbus
BusName=org.bluez
ExecStart=/usr/libexec/bluetooth/bluetoothd

[Install]
WantedBy=bluetooth.target
Alias=dbus-org.bluez.service
`;
const name = (u: string) => (u.includes('.') ? u : u + '.service');
function fragment(w: Welt, u: string): string | null { for (const d of UDIR) { const p = `${d}/${u}`; if (p in w.fs) return p; } return null; }
function dropins(w: Welt, u: string): string[] {
  const n: Record<string, string> = {};
  for (const d of [...UDIR].reverse()) for (const p of Object.keys(w.fs)) if (p.startsWith(`${d}/${u}.d/`) && p.endsWith('.conf') && hat(w, p)) n[p.split('/').pop()!] = p;
  return Object.keys(n).sort().map((k) => n[k]);
}
const maskiert = (w: Welt, u: string) => (w.fs[`/etc/systemd/system/${u}`] ?? w.fs[`/run/systemd/system/${u}`]) === '-> /dev/null';
function wirksam(w: Welt, u: string): string { const f = fragment(w, u); if (!f) return ''; return [f, ...dropins(w, u)].map((p) => `#${p}\n${w.fs[p]}`).join('\n'); }
function wert(t: string, k: string): string | undefined { let v: string | undefined; for (const z of t.split('\n')) { const m = z.match(new RegExp(`^${k}=(.*)$`)); if (m) v = m[1]; } return v; }
function wants(w: Welt, u: string): string[] { return Object.keys(w.fs).filter((p) => /^\/etc\/systemd\/system\/[^/]+\.(wants|requires)\/[^/]+$/.test(p) && p.endsWith('/' + u)).map((p) => p.split('/')[4]); }
const aktiviert = (w: Welt, u: string) => (maskiert(w, u) ? 'masked' : wants(w, u).length ? 'enabled' : 'disabled');
function unitStarten(w: Welt, u: string): string | null {
  const st = ss(w); const t = st.units[u]?.geladen ?? wirksam(w, u);
  const exe = (wert(t, 'ExecStart') ?? '').replace(/^[-@+!]+/, '').split(/\s+/)[0];
  const user = wert(t, 'User');
  st.units[u] = { ...(st.units[u] ?? { geladen: t }), aktiv: false, fehler: undefined };
  if (user && !new RegExp(`^${user}:`, 'm').test(w.fs['/etc/passwd'] ?? '')) { st.units[u].fehler = `217/USER`; st.journal.push(`${u}: Failed to determine user credentials: No such process`, `${u}: Failed at step USER spawning ${exe}: No such process`, `${u}: Main process exited, code=exited, status=217/USER`, `${u}: Failed with result 'exit-code'.`); return st.units[u].fehler!; }
  if (!exe || !(exe in w.fs)) { st.units[u].fehler = '203/EXEC'; st.journal.push(`${u}: Failed to locate executable ${exe}: No such file or directory`, `${u}: Main process exited, code=exited, status=203/EXEC`); return st.units[u].fehler!; }
  st.units[u].aktiv = true; st.units[u].seit = w.uhr;
  return null;
}
function unitStatus(w: Welt, u: string): string {
  const st = ss(w); const s = st.units[u]; const f = fragment(w, u);
  const desc = wert(wirksam(w, u), 'Description') ?? u;
  const drin = dropins(w, u);
  const geaendert = s && s.geladen !== wirksam(w, u);
  const zeit = 'Tue 2026-11-24 08:12:41 CET';
  const z = [`${s?.aktiv ? '●' : s?.fehler ? '×' : '○'} ${u} - ${desc}`,
    `     Loaded: ${maskiert(w, u) ? 'masked (Reason: Unit ' + u + ' is masked.)' : `loaded (${f}; ${aktiviert(w, u)}; preset: enabled)`}`,
    ...(drin.length ? [`    Drop-In: ${drin[0].replace(/[^/]+$/, '')}`, `             └─${drin.map((p) => p.split('/').pop()).join(', ')}`] : []),
    `     Active: ${s?.aktiv ? `active (running) since ${zeit}; 5min ago` : s?.fehler ? `failed (Result: exit-code) since ${zeit}; 10s ago` : 'inactive (dead)'}`];
  if (s?.fehler) z.push(`    Process: 2210 ExecStart=${wert(s.geladen, 'ExecStart')} (code=exited, status=${s.fehler})`, `   Main PID: 2210 (code=exited, status=${s.fehler})`);
  if (s?.aktiv && wert(s.geladen, 'ExecStart')) z.push(`   Main PID: 2210 (${(wert(s.geladen, 'ExecStart') ?? '').split(/\s+/)[0].split('/').pop()})`);
  if (geaendert) z.push(`Warning: The unit file, source configuration file or drop-ins of ${u} changed on disk. Run 'systemctl daemon-reload' to reload units.`);
  return z.join('\n');
}
function neuLaden(w: Welt) { const st = ss(w); for (const u of Object.keys(st.units)) st.units[u].geladen = wirksam(w, u); st.fstabGeladen = w.fs['/etc/fstab'] ?? ''; (w as { fstabStand?: string }).fstabStand = w.fs['/etc/fstab'] ?? undefined; }

// ---------- Firmware, ESP, GRUB ----------

function espPfad(w: Welt): string | null {
  const m = w.platten?.mounts.find((x) => x.quelle === '/dev/nvme0n1p1'); if (!m) return null;
  const c = (w as SW).startstand?.chroot.slice(-1)[0];
  if (c) return m.ziel.startsWith(c.dir + '/') ? m.ziel.slice(c.dir.length) : null;
  return m.ziel;
}
function partFs(w: Welt, dev: string) { for (const pl of w.platten?.platten ?? []) for (const p of pl.partitionen) if (pl.name + (/\d$/.test(pl.name) ? 'p' : '') + p.nr === dev) return p.fs ?? null; return null; }
function espLesen(w: Welt, rel: string): string | null | undefined {
  const z = espPfad(w); if (z !== null) return w.fs[(z === '/' ? '' : z) + rel];
  return partFs(w, 'nvme0n1p1')?.dateien[rel];
}
const ESP_DEBIAN: Record<string, string> = {
  '/EFI/debian/shimx64.efi': '\u0007BIN:952384', '/EFI/debian/grubx64.efi': '\u0007BIN:2549304', '/EFI/debian/mmx64.efi': '\u0007BIN:849792', '/EFI/debian/fbx64.efi': '\u0007BIN:83400',
  '/EFI/debian/BOOTX64.CSV': 'shimx64.efi,debian,,This is the boot entry for debian\n', '/EFI/debian/grub.cfg': `search.fs_uuid ${ROOT_UUID} root nvmep2\nset prefix=($root)'/boot/grub'\nconfigfile $prefix/grub.cfg\n`,
};
function espSchreiben(w: Welt, dateien: Record<string, string>) {
  const z = espPfad(w);
  if (z !== null) for (const [r, c] of Object.entries(dateien)) datei(w, (z === '/' ? '' : z) + r, c, 0o700);
  else { const fs = partFs(w, 'nvme0n1p1'); if (fs) for (const [r, c] of Object.entries(dateien)) { const teile = r.split('/').filter(Boolean); for (let i = 1; i < teile.length; i++) fs.dateien['/' + teile.slice(0, i).join('/')] = null; fs.dateien[r] = c; } }
}
const efiPfad = (d: string) => d.replace(/\\/g, '/');
function efiAusgabe(w: Welt, v: boolean): string {
  const e = ss(w).efi;
  const pfadText = (x: Eintrag) => x.datei ? `HD(1,GPT,1d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e51,0x800,0x100000)/File(${x.datei})` : x.pxe ? 'PciRoot(0x0)/Pci(0x1f,0x6)/MAC(3c7c3f1a2b4d,0)/IPv4(0.0.0.0,0,DHCP,0.0.0.0,0.0.0.0,0.0.0.0)' : 'PciRoot(0x0)/Pci(0x14,0x0)/USB(2,0)/HD(1,MBR,0x4b1d2a3e,0x800,0x3947000)';
  return [`BootCurrent: ${e.current}`, ...(e.next ? [`BootNext: ${e.next}`] : []), 'Timeout: 1 seconds', `BootOrder: ${e.order.join(',')}`, ...Object.keys(e.e).sort().map((k) => `Boot${k}${e.e[k].aktiv ? '*' : ' '} ${e.e[k].name}${v ? '\t' + pfadText(e.e[k]) : ''}`)].join('\n');
}
function grubEintraege(w: Welt): { titel: string; zeilen: string[] }[] {
  const cfg = w.fs['/boot/grub/grub.cfg'] ?? '';
  return [...cfg.matchAll(/menuentry '([^']*)'[^{]*\{\n([\s\S]*?)\n\}/g)].map((m) => ({ titel: m[1], zeilen: m[2].split('\n').map((z) => z.replace(/^\t/, '')) }));
}
interface GrubLauf { root: string; kernel?: string; args?: string; initrd?: string }
function grubDatei(w: Welt, spez: string, root: string): { ok: boolean; inhalt?: string | null; liste?: string[]; dev: string; rel: string } {
  let dev = root.replace(/[()]/g, ''); let rel = spez;
  const m = spez.match(/^\(([^)]+)\)(.*)$/); if (m) { dev = m[1]; rel = m[2] || '/'; }
  if (!rel) rel = '/';
  const lesen = (r: string): { c: string | null | undefined; kinder: string[] } => {
    if (dev === 'hd0,gpt2') { const p = r === '/' ? '/' : r.replace(/\/$/, ''); const kinder = Object.keys(w.fs).filter((k) => k !== '/' && k.startsWith(p === '/' ? '/' : p + '/') && !k.slice(p === '/' ? 1 : p.length + 1).includes('/') && !/^\/(proc|sys|dev|run)\//.test(k)).map((k) => k.split('/').pop()! + (w.fs[k] === null ? '/' : '')); return { c: w.fs[p], kinder }; }
    if (dev === 'hd0,gpt1') { const p = r.replace(/\/$/, ''); const z = espPfad(w); const fs = partFs(w, 'nvme0n1p1'); const quelle: Record<string, string | null> = z !== null ? Object.fromEntries(Object.entries(w.fs).filter(([k]) => k.startsWith(z + '/')).map(([k, v]) => [k.slice(z.length), v])) : fs?.dateien ?? {}; const kinder = Object.keys(quelle).filter((k) => k.startsWith((p || '') + '/') && !k.slice((p || '').length + 1).includes('/')).map((k) => k.split('/').pop()! + (quelle[k] === null ? '/' : '')); return { c: p === '' ? null : quelle[p], kinder }; }
    return { c: undefined, kinder: [] };
  };
  const r = lesen(rel);
  if (r.c === undefined && !(rel === '/' && r.kinder.length)) return { ok: false, dev, rel };
  return { ok: true, inhalt: r.c ?? null, liste: r.kinder, dev, rel };
}
const GERAETE = ['hd0', 'hd0,gpt3', 'hd0,gpt2', 'hd0,gpt1', 'hd1', 'hd1,msdos1'];
function grubShell(w: Welt, lauf: GrubLauf, vorher: string): string {
  K.dialog(w, 'grub> ', (eingabe) => {
    const z = eingabe.trim(); const [b, ...a] = z.split(/\s+/);
    const weiter = (t: string) => grubShell(w, lauf, t);
    if (!z) return weiter('');
    if (b === 'ls') {
      if (!a.length) return weiter(GERAETE.map((g) => `(${g})`).join(' ') + ' ');
      const ziel = a[0];
      if (/^\([^)]+\)$/.test(ziel)) { const d = ziel.slice(1, -1); if (!GERAETE.includes(d)) return weiter('error: disk `' + d + "' not found."); const info: Record<string, string> = { 'hd0': 'Disk hd0: Filesystem type unknown, partition table gpt - Total size 500107608KiB', 'hd0,gpt1': `Partition hd0,gpt1: Filesystem type fat, UUID ${ESP_UUID} - Partition start at 1024KiB - Total size 524288KiB`, 'hd0,gpt2': `Partition hd0,gpt2: Filesystem type ext* - Last modification time 2026-11-23 08:12:01 Monday, UUID ${ROOT_UUID} - Partition start at 525312KiB - Total size 497582080KiB`, 'hd0,gpt3': 'Partition hd0,gpt3: No known filesystem detected - Partition start at 498107392KiB - Total size 1999199.5KiB', 'hd1': 'Disk hd1: Filesystem type unknown, partition table msdos - Total size 30031872KiB', 'hd1,msdos1': 'Partition hd1,msdos1: Filesystem type fat, UUID 4E21-9A07 - Partition start at 1024KiB - Total size 30030848KiB' }; return weiter('\t' + info[d]); }
      const f = grubDatei(w, ziel, lauf.root);
      if (!f.ok) return weiter(`error: file \`${f.rel}' not found.`);
      return weiter((f.liste ?? []).join(' ') + ' ');
    }
    if (b === 'set') {
      if (!a.length) return weiter(`cmdpath=(hd0,gpt1)/EFI/debian\nprefix=\nroot=${lauf.root.replace(/[()]/g, '')}`);
      const m = z.match(/^set\s+(\w+)=(\S+)$/); if (!m) return weiter('error: syntax error.');
      if (m[1] === 'root') { const d = m[2].replace(/[()]/g, ''); if (!GERAETE.includes(d)) return weiter(`error: disk \`${d}' not found.`); lauf.root = `(${d})`; }
      return weiter('');
    }
    if (b === 'insmod') return weiter(['part_gpt', 'part_msdos', 'ext2', 'fat', 'normal', 'linux', 'gzio', 'search', 'all_video', 'efi_gop'].includes(a[0] ?? '') ? '' : `error: file \`/boot/grub/x86_64-efi/${a[0]}.mod' not found.`);
    if (b === 'cat') { const f = grubDatei(w, a[0] ?? '', lauf.root); return weiter(f.ok && typeof f.inhalt === 'string' && !f.inhalt.startsWith('\u0007') ? f.inhalt.replace(/\n$/, '') : `error: file \`${f.rel}' not found.`); }
    if (b === 'search' || b === 'search.fs_uuid') {
      const uuid = a.find((x) => /^[0-9a-f]{8}-|^[0-9A-F]{4}-[0-9A-F]{4}$/.test(x)); const si = a.indexOf('--set'); const var_ = si >= 0 ? (a[si + 1] && !a[si + 1].startsWith('-') && !/^[0-9a-fA-F]{4,8}-/.test(a[si + 1]) ? a[si + 1] : 'root') : a.find((x) => x.startsWith('--set='))?.slice(6) ?? null;
      const d = uuid === ROOT_UUID ? 'hd0,gpt2' : uuid === ESP_UUID ? 'hd0,gpt1' : null;
      if (!d) return weiter(`error: no such device: ${uuid ?? a.join(' ')}.`);
      if (var_ === 'root' || b === 'search.fs_uuid') { lauf.root = `(${d})`; return weiter(''); }
      return weiter(d);
    }
    if (b === 'linux' || b === 'linuxefi') {
      if (!a[0]) return weiter('error: filename expected.');
      const f = grubDatei(w, a[0], lauf.root);
      if (!f.ok || f.dev !== 'hd0,gpt2' || !/vmlinuz/.test(f.rel)) return weiter(`error: file \`${f.rel}' not found.`);
      lauf.kernel = f.rel.replace(/^\/boot\/vmlinuz-|^\/vmlinuz-/, ''); lauf.args = a.slice(1).join(' ');
      return weiter('');
    }
    if (b === 'initrd' || b === 'initrdefi') {
      if (!lauf.kernel) return weiter('error: you need to load the kernel first.');
      const f = grubDatei(w, a[0] ?? '', lauf.root);
      if (!f.ok) return weiter(`error: file \`${f.rel}' not found.`);
      lauf.initrd = f.rel; return weiter('');
    }
    if (b === 'configfile' || b === 'normal') {
      const pfad = b === 'normal' ? '(hd0,gpt2)/boot/grub/grub.cfg' : a[0] ?? '';
      const f = grubDatei(w, pfad, lauf.root);
      if (!f.ok) return weiter(`error: file \`${f.rel}' not found.`);
      return grubMenue(w, '');
    }
    if (b === 'boot') {
      if (!lauf.kernel) return weiter('error: you need to load the kernel first.');
      w.dialog = null;
      return booteKernel(w, { kernel: lauf.kernel, args: lauf.args, initrd: lauf.initrd });
    }
    if (b === 'help') return weiter('boot  cat  configfile  echo  help  initrd  insmod  linux  ls  normal  reboot  search  set\n(Im Simulator gekürzt.)');
    if (b === 'echo') return weiter(a.join(' '));
    if (b === 'reboot' || b === 'halt') { w.dialog = null; w.aus = 'reboot'; return '(Mit „Neu starten“ unter dem Terminal startet der Rechner neu.)'; }
    return weiter(`error: can't find command \`${b}'.`);
  });
  return vorher;
}
const MENUE_KOPF = '                             GNU GRUB  version 2.06-13+deb12u1\n';
function grubMenue(w: Welt, vorher: string): string {
  const e = grubEintraege(w);
  const titel = [e[0]?.titel ?? 'Debian GNU/Linux', 'Advanced options for Debian GNU/Linux', 'UEFI Firmware Settings'];
  const bild = `${MENUE_KOPF}\n ┌${'─'.repeat(68)}┐\n${titel.map((t, i) => ` │${(i === 0 ? '*' : ' ') + t}`.padEnd(70) + '│').join('\n')}\n └${'─'.repeat(68)}┘\n      Use the ↑ and ↓ keys to select which entry is highlighted.\n      Press enter to boot the selected OS, \`e' to edit the commands\n      before booting or \`c' for a command-line.\n\n(Im Simulator: Enter startet den markierten Eintrag, e bearbeitet ihn, c öffnet die GRUB-Befehlszeile.)`;
  K.dialog(w, 'GRUB-Menü> ', (z) => {
    const x = z.trim().toLowerCase();
    if (x === '' ) { w.dialog = null; const ein = e[0]; if (!ein) return grubShell(w, { root: '(hd0,gpt2)' }, 'error: no such menu entry.'); const lin = ein.zeilen.find((l) => /^linux\s/.test(l)) ?? ''; const ini = ein.zeilen.find((l) => /^initrd\s/.test(l)); const [, k, ...args] = lin.split(/\s+/); return booteKernel(w, { kernel: k.replace(/^\/boot\/vmlinuz-|^\/vmlinuz-/, ''), args: args.join(' '), initrd: ini?.split(/\s+/)[1] }); }
    if (x === 'c') return grubShell(w, { root: '(hd0,gpt2)' }, '\n   Minimal BASH-like line editing is supported. For the first word, TAB\n   lists possible command completions. Anywhere else TAB lists possible\n   device or file completions. ESC at any time exits.\n');
    if (x === 'e') return grubBearbeiten(w, [...(e[0]?.zeilen ?? [])]);
    return grubMenue(w, '');
  });
  return [vorher, bild].filter(Boolean).join('\n');
}
function grubBearbeiten(w: Welt, zeilen: string[]): string {
  const bild = `${MENUE_KOPF}\n${zeilen.map((z) => '        ' + z).join('\n')}\n\n      Minimum Emacs-like screen editing is supported. TAB lists\n      completions. Press Ctrl-x or F10 to boot, Ctrl-c or F2 for\n      a command-line or ESC to discard edits and return to the GRUB menu.\n\n(Im Simulator: Tipp eine ganze Zeile neu ein, die mit linux oder initrd beginnt, um sie zu ersetzen. „boot“ startet wie Strg+X, „esc“ verwirft.)`;
  K.dialog(w, 'Bearbeiten> ', (z) => {
    const x = z.trim();
    if (/^(boot|strg\+x|ctrl-x|f10)$/i.test(x)) {
      w.dialog = null;
      const lin = zeilen.find((l) => /^linux\s/.test(l)) ?? ''; const ini = zeilen.find((l) => /^initrd\s/.test(l));
      const [, k, ...args] = lin.split(/\s+/);
      if (!k) return grubShell(w, { root: '(hd0,gpt2)' }, 'error: you need to load the kernel first.');
      return booteKernel(w, { kernel: k.replace(/^\/boot\/vmlinuz-|^\/vmlinuz-/, ''), args: args.join(' '), initrd: ini?.split(/\s+/)[1] });
    }
    if (/^esc$/i.test(x)) return grubMenue(w, '');
    const m = x.match(/^(linux|initrd)\s/);
    if (m) { const i = zeilen.findIndex((l) => l.startsWith(m[1] + ' ') || l.startsWith(m[1] + '\t')); if (i >= 0) zeilen[i] = x; else zeilen.push(x); }
    return grubBearbeiten(w, zeilen);
  });
  return bild;
}

/** Kernel mit den Angaben aus GRUB starten und den Rest des Starts durchlaufen. */
function booteKernel(w: Welt, m: { kernel: string; args?: string; initrd?: string }): string {
  const st = ss(w);
  st.manuell = m; w.aus = null;
  st.gebootet.push(`kernel ${m.kernel} ${m.args ?? ''}`.trim());
  const args = m.args ?? '';
  const rootArg = args.match(/(?:^|\s)root=(\S+)/)?.[1];
  const z: string[] = [`Loading Linux ${m.kernel} ...`, ...(m.initrd ? ['Loading initial ramdisk ...'] : [])];
  if (!(`/boot/vmlinuz-${m.kernel}` in w.fs)) { w.aus = 'kernelfehler'; (w as Welt & { kernelMeldung?: string }).kernelMeldung = `error: file \`/boot/vmlinuz-${m.kernel}' not found.`; return z.join('\n') + `\nerror: file \`/boot/vmlinuz-${m.kernel}' not found.`; }
  const rootOk = rootArg && (rootArg === `UUID=${ROOT_UUID}` || rootArg === '/dev/nvme0n1p2' || rootArg === `PARTUUID=7e8f9a0b-1c2d-4e3f-8a5b-6c7d8e9f0a12`);
  if (!rootOk) {
    w.aus = 'kernelfehler';
    const t = rootArg ? `Gave up waiting for root file system device.  Common problems:\n - Boot args (cat /proc/cmdline)\n   - Check rootdelay= (did the system wait long enough?)\n - Missing modules (cat /proc/modules; ls /dev)\nALERT!  ${rootArg} does not exist.  Dropping to a shell!\n\n(initramfs)` : `[    1.912455] Kernel panic - not syncing: VFS: Unable to mount root fs on unknown-block(0,0)`;
    (w as Welt & { kernelMeldung?: string }).kernelMeldung = t;
    return [...z, t, '\n(Der Start ist gescheitert. Mit „Neu starten“ beginnt der Start von vorn.)'].join('\n');
  }
  w.cmdline = `BOOT_IMAGE=/boot/vmlinuz-${m.kernel} ${args}`.trim();
  w.fs['/proc/cmdline'] = w.cmdline + '\n';
  (w as Welt & { startKernel?: string }).startKernel = m.kernel;
  const rest = K.weiterStarten(w);
  return [...z, rest, w.aus || w.dialog || ss(w).modus ? '' : `\nDebian GNU/Linux 12 ${w.host} tty1\n${w.host} login: lena (automatisch angemeldet)`].filter(Boolean).join('\n');
}

// ---------- Live-System und chroot ----------

const LAUFZEIT = /^\/(proc|sys|dev|run|tmp|mnt|media)(\/|$)/;
function systemAusPlatte(w: Welt) {
  const st = ss(w);
  // Was unter /mnt eingehängt ist, zuerst zurück auf die Partition schreiben
  for (const dev of ['nvme0n1p2', 'nvme0n1p1']) {
    const m = w.platten?.mounts.find((x) => x.quelle === '/dev/' + dev && x.ziel !== '/' && !x.virtuell); const fs = partFs(w, dev);
    if (m && fs) { fs.dateien = {}; fs.metas = {}; for (const k of Object.keys(w.fs).filter((k) => k.startsWith(m.ziel + '/'))) { if (dev === 'nvme0n1p2' && k.startsWith(m.ziel + '/boot/efi/')) continue; fs.dateien[k.slice(m.ziel.length)] = w.fs[k]; fs.metas[k.slice(m.ziel.length)] = { ...meta(w, k) }; } }
  }
  const root = partFs(w, 'nvme0n1p2')!; const esp = partFs(w, 'nvme0n1p1')!;
  const neu: Record<string, string | null> = {}; const nm: NonNullable<Welt['meta']> = {};
  for (const [k, v] of Object.entries(w.fs)) if (/^\/(proc|sys|dev|run|tmp)(\/|$)/.test(k) || k === '/') { neu[k] = v; if (w.meta?.[k]) nm[k] = w.meta[k]; }
  for (const [k, v] of Object.entries(root.dateien)) { neu[k] = v; if (root.metas[k]) nm[k] = root.metas[k]; }
  neu['/boot/efi'] = null;
  for (const [k, v] of Object.entries(esp.dateien)) { neu['/boot/efi' + k] = v; nm['/boot/efi' + k] = { mode: 0o700, owner: 'root', group: 'root', mtime: w.uhr }; }
  w.fs = neu; w.meta = nm;
  w.platten!.mounts = [
    { quelle: '/dev/nvme0n1p2', ziel: '/', art: 'ext4', optionen: 'rw,relatime,errors=remount-ro', virtuell: true },
    { quelle: '/dev/nvme0n1p1', ziel: '/boot/efi', art: 'vfat', optionen: 'rw,relatime,fmask=0077,dmask=0077,codepage=437,iocharset=ascii,shortname=mixed,utf8,errors=remount-ro', virtuell: true },
  ];
  w.host = (w.fs['/etc/hostname'] ?? 'messpc').trim();
  st.live = false; st.binds = []; st.chroot = [];
  w.cwd = '/home/lena';
}
function chroot(w: Welt, a: string[], root: boolean): Ergebnis {
  const st = ss(w);
  const dir = a[0] ? K.pfad(w, a[0]) : '';
  if (!dir) return fehler('chroot: Fehlender Operand\n„chroot --help“ liefert weitere Informationen.');
  if (!root) return fehler(`chroot: Es ist nicht möglich, das Wurzelverzeichnis in „${dir}“ zu ändern: Die Operation ist nicht erlaubt`, 125);
  if (w.fs[dir] !== null) return fehler(`chroot: Es ist nicht möglich, das Wurzelverzeichnis in „${dir}“ zu ändern: Datei oder Verzeichnis nicht gefunden`, 125);
  if (!(`${dir}/bin/bash` in w.fs) && !(`${dir}/usr/bin/bash` in w.fs)) return fehler(`chroot: der Befehl „/bin/bash“ konnte nicht ausgeführt werden: Datei oder Verzeichnis nicht gefunden`, 127);
  const neu: Record<string, string | null> = { '/': null }; const nm: NonNullable<Welt['meta']> = {};
  for (const [k, v] of Object.entries(w.fs)) if (k.startsWith(dir + '/')) { const r = k.slice(dir.length); neu[r] = v; if (w.meta?.[k]) nm[r] = w.meta[k]; }
  for (const b of ['/dev', '/proc', '/sys', '/run']) if (st.binds.includes(dir + b)) for (const [k, v] of Object.entries(w.fs)) if (k === b || k.startsWith(b + '/')) { neu[k] = v; if (w.meta?.[k]) nm[k] = w.meta[k]; }
  st.chroot.push({ dir, fs: w.fs, meta: w.meta ?? {}, root: w.root, cwd: w.cwd });
  w.fs = neu; w.meta = nm; w.cwd = '/'; w.root = true;
  return ok(`(Du arbeitest jetzt im System unter ${dir}. „exit“ führt zurück ins Live-System.)`);
}
export function chrootVerlassen(w: Welt): Ergebnis | null {
  if (!startAktiv(w)) return null;
  const st = ss(w); const c = st.chroot.pop();
  if (!c) return st.modus === 'emergency' || st.modus === 'rescue' ? ok(weiterStandard(w)) : null;
  const host = c.fs; const hm = c.meta;
  for (const k of Object.keys(host)) if (k.startsWith(c.dir + '/')) { delete host[k]; delete hm[k]; }
  for (const [k, v] of Object.entries(w.fs)) {
    if (k === '/') continue;
    const gebunden = ['/dev', '/proc', '/sys', '/run'].some((b) => st.binds.includes(c.dir + b) && (k === b || k.startsWith(b + '/')));
    if (gebunden) { if (k === '/dev' || k === '/proc' || k === '/sys' || k === '/run') host[c.dir + k] = null; continue; }
    host[c.dir + k] = v; if (w.meta?.[k]) hm[c.dir + k] = w.meta[k];
  }
  w.fs = host; w.meta = hm; w.cwd = c.cwd; w.root = c.root;
  return ok('exit');
}
const imChroot = (w: Welt) => startAktiv(w) && ss(w).chroot.length > 0;
function chrootHat(w: Welt, b: string): boolean { const st = ss(w); const c = st.chroot[st.chroot.length - 1]; return !c || st.binds.includes(c.dir + b); }
function espImChroot(w: Welt): boolean {
  const st = ss(w); const c = st.chroot[st.chroot.length - 1];
  if (!c) return !!espPfad(w);
  return !!w.platten?.mounts.find((m) => m.quelle === '/dev/nvme0n1p1' && m.ziel === c.dir + '/boot/efi');
}

// ---------- Start ----------

/** Vor dem Kernel: Firmware und GRUB. Liefert eine Meldung; bleibt der Start hängen, ist danach w.aus oder w.dialog gesetzt. */
export function startVorKernel(w: Welt): string | undefined {
  if (!startAktiv(w)) return;
  const st = ss(w);
  st.modus = null; st.manuell = null; st.journal = []; delete (w as Welt & { startKernel?: string }).startKernel;
  if (st.hostAlt) { w.host = st.hostAlt; st.hostAlt = ''; }
  if (st.opt.sysv === 'debian' || w.distro !== 'debian') return;
  const z: string[] = [];
  // Firmware: BootNext, dann BootOrder
  const e = st.efi; const reihe = e.next ? [e.next, ...e.order] : e.order; e.next = null;
  let gefunden: string | null = null;
  for (const id of reihe) {
    const x = e.e[id]; if (!x || !x.aktiv) continue;
    if (x.pxe) { z.push('>>Start PXE over IPv4.', '  PXE-E18: Server response timeout.'); continue; }
    if (x.usb) { if (st.live) { gefunden = id; break; } continue; }
    if (x.datei && typeof espLesen(w, efiPfad(x.datei)) === 'string') { gefunden = id; break; }
  }
  if (!gefunden && typeof espLesen(w, '/EFI/BOOT/BOOTX64.EFI') === 'string') { gefunden = 'fallback'; z.push('(Die Firmware startet den Ausweichpfad \\EFI\\BOOT\\BOOTX64.EFI.)'); }
  if (!gefunden) { w.aus = 'firmware'; (w as Welt & { kernelMeldung?: string }).kernelMeldung = 'No bootable device found.'; return [...z, 'No bootable device found.', '\n(Keine Startdatei gefunden. Im Simulator steckt der Live-Stick: Die Mission erklärt, wie du von ihm startest.)'].join('\n'); }
  if (gefunden !== 'fallback') e.current = gefunden;
  if (gefunden !== 'fallback' && e.e[gefunden].usb) return [...z, 'Live-System vom USB-Stick gestartet.'].join('\n');
  if (st.live) systemAusPlatte(w);
  // GRUB
  if (!hat(w, '/boot/grub/grub.cfg')) { w.aus = 'grub'; return grubShell(w, { root: '(hd0,gpt2)' }, [...z, '                             GNU GRUB  version 2.06-13+deb12u1\n\n   Minimal BASH-like line editing is supported. For the first word, TAB\n   lists possible command completions. Anywhere else TAB lists possible\n   device or file completions.\n\n(GRUB hat keine grub.cfg gefunden und wartet auf der Befehlszeile.)'].join('\n')); }
  if (st.grubMenue || st.opt.grub === 'menue') { st.grubMenue = false; w.aus = 'grub'; return grubMenue(w, z.join('\n')); }
  const ein = grubEintraege(w)[0];
  const lin = ein?.zeilen.find((l) => /^linux\s/.test(l)) ?? '';
  const [, k, ...args] = lin.split(/\s+/);
  if (!k) { w.aus = 'grub'; return grubShell(w, { root: '(hd0,gpt2)' }, 'error: no such menu entry.'); }
  st.gebootet.push('auto');
  const r = booteKernel(w, { kernel: k.replace(/^\/boot\/vmlinuz-|^\/vmlinuz-/, ''), args: args.join(' '), initrd: ein.zeilen.find((l) => /^initrd\s/.test(l))?.split(/\s+/)[1] });
  return ['__WEITER__', [...z, r].filter(Boolean).join('\n')].join('');
}
function fstabFehler(w: Welt, text: string): string[] {
  const f: string[] = [];
  for (const z of text.split('\n')) {
    const t = z.trim(); if (!t || t.startsWith('#')) continue;
    const [spez, ziel, art, opt = 'defaults'] = t.split(/\s+/);
    if (art === 'swap' || /noauto|nofail/.test(opt) || ziel === '/' || ziel === 'none') continue;
    const m = spez.match(/^(UUID|LABEL)=(.+)$/);
    let da = false;
    for (const pl of w.platten?.platten ?? []) for (const p of pl.partitionen) { if (!p.fs) continue; const dev = '/dev/' + pl.name + (/\d$/.test(pl.name) ? 'p' : '') + p.nr; if (m ? (m[1] === 'UUID' ? p.fs.uuid === m[2] : p.fs.label === m[2]) : spez === dev) da = true; }
    if (!da) f.push(`${spez} ${ziel}`);
  }
  return f;
}
/** Nach dem Kernel: Kernelparameter, fstab, Dienste. */
export function startNachKernel(w: Welt): string | undefined {
  if (!startAktiv(w) || (w.distro !== 'debian')) return;
  const st = ss(w); const z: string[] = [];
  const args = st.manuell?.args ?? '';
  const wurzel = w.platten?.mounts.find((m) => m.ziel === '/');
  if (st.opt.sysv === 'debian') {
    st.laeuft = []; z.push('INIT: version 3.06 booting', rcWechsel(w, (w.fs['/etc/inittab'] ?? '').match(/^\w+:(\d):initdefault:/m)?.[1] ?? '2'));
    st.rlVorher = 'N';
    return z.filter(Boolean).join('\n');
  }
  st.fstabGeladen = w.fs['/etc/fstab'] ?? ''; (w as { fstabStand?: string }).fstabStand = w.fs['/etc/fstab'] ?? undefined;
  for (const u of Object.keys(st.units)) { st.units[u] = { aktiv: false, geladen: wirksam(w, u) }; }
  if (/(^|\s)init=\/bin\/(ba)?sh(\s|$)/.test(args)) {
    st.modus = 'bash'; st.hostAlt = w.host; w.host = '(none)'; w.root = true;
    const rw = /(^|\s)rw(\s|$)/.test(args);
    if (wurzel) wurzel.optionen = rw ? wurzel.optionen.replace(/^ro/, 'rw') : wurzel.optionen.replace(/^rw/, 'ro');
    w.prozesse = w.prozesse.filter((p) => p.pid === 1).map((p) => ({ ...p, cmd: '/bin/bash' }));
    w.target = 'emergency.target';
    return '[    2.413022] Run /bin/bash as init process\nbash: cannot set terminal process group (-1): Inappropriate ioctl for device\nbash: no job control in this shell\n\n(Statt init läuft /bin/bash als Prozess 1. ' + (rw ? 'Die Wurzel ist wegen rw beschreibbar eingehängt' : 'Die Wurzel ist nur lesbar eingehängt') + ', kein Dienst läuft.)';
  }
  if (wurzel && /(^|\s)ro(\s|$)/.test(args)) wurzel.optionen = wurzel.optionen.replace(/^ro/, 'rw');
  const unit = args.match(/systemd\.unit=(\S+)/)?.[1] ?? (/(^|\s)(single|1|s|S)(\s|$)/.test(args) ? 'rescue.target' : null);
  const fehlt = fstabFehler(w, st.fstabGeladen);
  if (unit === 'emergency.target' || unit === 'rescue.target' || fehlt.length) {
    const ziel = unit ?? 'emergency.target';
    for (const f of fehlt) { const n = f.split(' ')[0]; st.journal.push(`Timed out waiting for device /dev/disk/by-uuid/${n.replace(/^UUID=/, '')}.`, `Dependency failed for ${f.split(' ')[1]}.`, 'Dependency failed for local-fs.target - Local File Systems.'); }
    w.target = ziel; st.modus = ziel === 'rescue.target' ? 'rescue' : 'emergency';
    if (ziel === 'emergency.target' && unit && wurzel) wurzel.optionen = wurzel.optionen.replace(/^rw/, 'ro');
    z.push(...fehlt.map((f) => `[ TIME ] Timed out waiting for device ${f.split(' ')[0]}.`), ...(fehlt.length ? ['[DEPEND] Dependency failed for local-fs.target - Local File Systems.'] : []));
    z.push(`You are in ${ziel === 'rescue.target' ? 'rescue' : 'emergency'} mode. After logging in, type "journalctl -xb" to view\nsystem logs, "systemctl reboot" to reboot, "systemctl default" or "exit"\nto boot into default mode.`);
    return z.join('\n') + '\n' + wartung(w);
  }
  for (const u of Object.keys(st.units)) if (aktiviert(w, u) === 'enabled') { const e = unitStarten(w, u); if (e) z.push(`[FAILED] Failed to start ${u} - ${wert(wirksam(w, u), 'Description')}.`); else z.push(`[  OK  ] Started ${u} - ${wert(wirksam(w, u), 'Description')}.`); }
  return z.join('\n');
}
function wartung(w: Welt): string {
  K.dialog(w, 'Give root password for maintenance\n(or press Control-D to continue): ', (pw) => {
    if (pw === '\u0004') { w.dialog = null; return weiterStandard(w); }
    if (pw !== ss(w).rootPw) return 'Login incorrect\n\n' + wartung(w);
    w.root = true; return '(Du bist als root angemeldet. Mit „systemctl default“ oder „exit“ geht der Start weiter.)';
  });
  return '';
}
function weiterStandard(w: Welt): string {
  const st = ss(w); const fehlt = fstabFehler(w, st.fstabGeladen);
  if (fehlt.length) { st.modus = 'emergency'; return [...fehlt.map((f) => `[ TIME ] Timed out waiting for device ${f.split(' ')[0]}.`), '[DEPEND] Dependency failed for local-fs.target - Local File Systems.', 'You are in emergency mode. After logging in, type "journalctl -xb" to view\nsystem logs, "systemctl reboot" to reboot, "systemctl default" or "exit"\nto boot into default mode.', w.root ? '(Du bleibst als root angemeldet.)' : wartung(w)].join('\n'); }
  st.modus = null; w.target = w.defaultTarget; w.root = false;
  const z = ['[  OK  ] Reached target local-fs.target - Local File Systems.'];
  for (const u of Object.keys(st.units)) if (aktiviert(w, u) === 'enabled') { const e = unitStarten(w, u); z.push(e ? `[FAILED] Failed to start ${u}.` : `[  OK  ] Started ${u}.`); }
  z.push(`[  OK  ] Reached target ${w.target}.`, '', `${w.host} login: lena (automatisch angemeldet)`);
  return z.join('\n');
}

// ---------- Befehle ----------

export function startBefehle(alt: Record<string, B>): Record<string, B> {
  const b: Record<string, B> = {};
  const mit = (n: string, f: B): B => (w, a, i, r) => (startAktiv(w) ? f(w, a, i, r) : alt[n] ? alt[n](w, a, i, r) : fehler(`bash: ${n}: Befehl nicht gefunden`, 127));
  const keinSystemd = () => fehler('System has not been booted with systemd as init system (PID 1). Can\'t operate.\nFailed to connect to bus: Der Rechner ist nicht verfügbar', 1);

  // ---- SysV ----
  // init startet respawn-Einträge neu, sobald sie enden
  b.kill = (w, a, i, r) => { const e = alt.kill(w, a, i, r); if (startAktiv(w) && ss(w).opt.sysv === 'debian' && ss(w).modus !== 'bash') respawn(w); return e; };
  b.pkill = (w, a, i, r) => { const e = alt.pkill(w, a, i, r); if (startAktiv(w) && ss(w).opt.sysv === 'debian' && ss(w).modus !== 'bash') respawn(w); return e; };
  b.killall = (w, a, i, r) => { const e = alt.killall ? alt.killall(w, a, i, r) : fehler('bash: killall: Befehl nicht gefunden', 127); if (startAktiv(w) && ss(w).opt.sysv === 'debian' && ss(w).modus !== 'bash') respawn(w); return e; };
  b.runlevel = mit('runlevel', (w, a, i, r) => (ss(w).opt.sysv === 'debian' ? ok(`${ss(w).rlVorher} ${ss(w).rl}`) : ss(w).modus === 'bash' ? fehler('Could not determine runlevel.') : alt.runlevel(w, a, i, r)));
  const telinit: B = (w, a, i, r) => {
    const st = ss(w);
    if (st.modus === 'bash') return keinSystemd();
    if (st.opt.sysv !== 'debian') return alt.telinit(w, a, i, r);
    if (!r) return fehler('init: must be superuser.');
    const z = a[0] ?? '';
    if (/^[qQ]$/.test(z)) { respawn(w); return ok(); }
    if (/^[sS]$/.test(z)) return ok(rcWechsel(w, '1'));
    if (!/^[0-6]$/.test(z)) return fehler('Usage: init 0123456SsQqAaBbCcUu');
    if (z === '0' || z === '6') { rcWechsel(w, z); w.aus = z === '6' ? 'reboot' : 'poweroff'; return ok(`INIT: Switching to runlevel: ${z}\n(Der Rechner ${z === '6' ? 'startet neu' : 'fährt herunter'}.)`); }
    return ok(`INIT: Switching to runlevel: ${z}\n${rcWechsel(w, z)}`.trim());
  };
  b.telinit = mit('telinit', telinit); b.init = mit('init', telinit);
  b['update-rc.d'] = (w, a, _i, root) => {
    if (!startAktiv(w) || ss(w).opt.sysv === 'chkconfig' || w.distro !== 'debian') return fehler('bash: update-rc.d: Befehl nicht gefunden', 127);
    const f = a.includes('-f'); const r = a.filter((x) => x !== '-f' && x !== '-n');
    const [n, akt, ...rls] = r;
    if (!n || !akt) return fehler('usage: update-rc.d [-f] <basename> remove\n       update-rc.d [-f] <basename> defaults\n       update-rc.d <basename> disable|enable [S|2|3|4|5]', 1);
    if (!root) return fehler('update-rc.d: error: you must be root to run this command', 1);
    const skript = `/etc/init.d/${n}`;
    if (akt === 'remove') {
      if (hat(w, skript) && !f) return fehler(`update-rc.d: error: /etc/init.d/${n} exists during rc.d purge (use -f to force)`, 1);
      for (const p of Object.keys(w.fs)) if (new RegExp(`^/etc/rc[0-6S]\\.d/[SK]\\d\\d${n}$`).test(p)) delete w.fs[p];
      return ok();
    }
    if (!hat(w, skript)) return fehler(`update-rc.d: error: initscript does not exist: /etc/init.d/${n}`, 1);
    const t = w.fs[skript]!;
    const start = lsbFeld(t, 'Default-Start'); const stopp = lsbFeld(t, 'Default-Stop');
    if (!/BEGIN INIT INFO/.test(t)) return { out: '', err: `insserv: warning: script '${n}' missing LSB tags\ninsserv: Default-Start undefined, assuming empty start runlevel(s) for script \`${n}'\ninsserv: Default-Stop  undefined, assuming empty stop  runlevel(s) for script \`${n}'`, code: 0 };
    if (akt === 'defaults') { rcLinks(w, '/etc', n, start, stopp, SYSV_DIENSTE[n]?.[1] ?? '02', '01'); return ok(); }
    if (akt === 'disable' || akt === 'enable') {
      const ziele = rls.length ? rls : start;
      for (const rl of ziele) for (const p of Object.keys(w.fs)) { const m = p.match(new RegExp(`^/etc/rc${rl}\\.d/([SK])(\\d\\d)${n}$`)); if (!m) continue; const neu = `/etc/rc${rl}.d/${akt === 'disable' ? 'K' : 'S'}${akt === 'disable' ? '01' : (SYSV_DIENSTE[n]?.[1] ?? '02')}${n}`; const c = w.fs[p]!; delete w.fs[p]; datei(w, neu, c, 0o777); }
      return ok();
    }
    return fehler(`update-rc.d: error: unknown action ${akt}`, 1);
  };
  b.chkconfig = (w, a, _i, root) => {
    if (!startAktiv(w) || ss(w).opt.sysv !== 'chkconfig') return fehler('bash: chkconfig: Befehl nicht gefunden', 127);
    const st = ss(w); const dir = '/etc/rc.d/init.d';
    const kopf = (n: string) => (w.fs[`${dir}/${n}`] ?? '').match(/^# chkconfig:\s*(\S+)\s+(\d+)\s+(\d+)/m);
    const zeile = (n: string) => `${n.padEnd(15)}\t${['0', '1', '2', '3', '4', '5', '6'].map((rl) => `${rl}:${hat(w, `/etc/rc.d/rc${rl}.d/S${kopf(n)?.[2] ?? '00'}${n}`) || Object.keys(w.fs).some((p) => new RegExp(`^/etc/rc\\.d/rc${rl}\\.d/S\\d\\d${n}$`).test(p)) ? 'on' : 'off'}`).join('\t')}`;
    const hinweis = '\nNote: This output shows SysV services only and does not include native\n      systemd services. SysV configuration data might be overridden by native\n      systemd configuration.\n\n      If you want to list systemd services use \'systemctl list-unit-files\'.\n      To see services enabled on particular target use\n      \'systemctl list-dependencies [target]\'.\n';
    const bekannt = (n: string) => Object.keys(w.fs).some((p) => new RegExp(`^/etc/rc\\.d/rc[0-6]\\.d/[SK]\\d\\d${n}$`).test(p));
    if (!a.length || a[0] === '--list') {
      const n = a[1];
      if (n) { if (!bekannt(n)) return fehler(`error reading information on service ${n}: No such file or directory`); return ok(hinweis + '\n' + zeile(n)); }
      return ok(hinweis + '\n' + Object.keys(w.fs).filter((p) => p.startsWith(dir + '/') && hat(w, p)).map((p) => p.split('/').pop()!).filter(bekannt).sort().map(zeile).join('\n'));
    }
    if (!root) return fehler('You do not have enough privileges to perform this operation.');
    const li = a.indexOf('--level'); const level = li >= 0 ? a[li + 1].split('') : null;
    const rest = a.filter((_, i) => li < 0 || (i !== li && i !== li + 1));
    if (rest[0] === '--add' || rest[0] === '--del') {
      const n = rest[1]; if (!hat(w, `${dir}/${n}`)) return fehler(`error reading information on service ${n}: No such file or directory`);
      if (rest[0] === '--del') { for (const p of Object.keys(w.fs)) if (new RegExp(`^/etc/rc\\.d/rc[0-6]\\.d/[SK]\\d\\d${n}$`).test(p)) delete w.fs[p]; return ok(); }
      const k = kopf(n); if (!k) return fehler(`service ${n} does not support chkconfig`);
      const start = k[1] === '-' ? [] : k[1].split('');
      rcLinks(w, '/etc/rc.d', n, start, ['0', '1', '2', '3', '4', '5', '6'].filter((x) => !start.includes(x)), k[2].padStart(2, '0'), k[3].padStart(2, '0'));
      return ok();
    }
    const [n, an] = rest;
    if (!n || !['on', 'off', 'reset'].includes(an ?? '')) return fehler('chkconfig version 1.24\nusage:   chkconfig [--list] [--type <type>] [name]\n         chkconfig --add <name>\n         chkconfig --del <name>\n         chkconfig --override <name>\n         chkconfig [--level <levels>] [--type <type>] <name> <on|off|reset|resetpriorities>', 2);
    if (!hat(w, `${dir}/${n}`)) return ok(`Note: Forwarding request to 'systemctl ${an === 'on' ? 'enable' : 'disable'} ${n}.service'.`);
    const k = kopf(n)!; const ziele = level ?? ['2', '3', '4', '5'];
    for (const rl of ziele) { for (const p of Object.keys(w.fs)) if (new RegExp(`^/etc/rc\\.d/rc${rl}\\.d/[SK]\\d\\d${n}$`).test(p)) delete w.fs[p]; datei(w, `/etc/rc.d/rc${rl}.d/${an === 'on' ? 'S' + k[2] : 'K' + k[3]}${n}`, `-> ../init.d/${n}`, 0o777); }
    void st; return ok();
  };
  b.service = mit('service', (w, a, i, r) => {
    const st = ss(w);
    if (!st.opt.sysv) return alt.service ? alt.service(w, a, i, r) : fehler('service: Befehl nicht verfügbar');
    if (a[0] === '--status-all') return ok(Object.keys(w.fs).filter((p) => p.startsWith(initd(w) + '/') && hat(w, p) && !/\/(rc|rcS|README|skeleton)$/.test(p)).map((p) => p.split('/').pop()!).sort().map((n) => ` [ ${st.laeuft.includes(n) ? '+' : '-'} ]  ${n}`).join('\n'));
    const [n, akt] = a; if (!n) return fehler('Usage: service < option > | --status-all | [ service_name [ command | --full-restart ] ]');
    return sysvSkript(w, `${initd(w)}/${n}`, akt ? [akt] : [], r);
  });
  b.systemctl = (w, a, i, r) => {
    if (!startAktiv(w)) return alt.systemctl(w, a, i, r);
    const st = ss(w);
    if (st.opt.sysv === 'debian' || st.modus === 'bash') return keinSystemd();
    const frei = a.filter((x, j) => !x.startsWith('-') && !['-p', '--property', '-t', '--type', '-n', '--lines', '-o', '--output'].includes(a[j - 1]));
    const sub = frei[0] ?? 'list-units';
    const args = frei.slice(1).map(name);
    const opts = a.filter((x) => x.startsWith('-'));
    if (opts.includes('--failed') || opts.includes('--state=failed') || sub === 'list-units' && opts.includes('--failed')) {
      const fe = [...fstabFehler(w, st.fstabGeladen).filter(() => st.modus === 'emergency').map((f) => { const z = f.split(' ')[1]; return `● ${z.slice(1).replace(/\//g, '-')}.mount loaded failed failed ${z}`; }), ...Object.entries(st.units).filter(([, x]) => x.fehler).map(([u]) => `● ${u} loaded failed failed ${wert(wirksam(w, u), 'Description') ?? u}`)];
      return ok(`  UNIT${' '.repeat(22)}LOAD   ACTIVE SUB    DESCRIPTION\n${fe.map((x) => { const [p, u, l, ac, sb, ...d] = x.split(' '); return `${p} ${u.padEnd(24)} ${l.padEnd(6)} ${ac.padEnd(6)} ${sb.padEnd(6)} ${d.join(' ')}`; }).join('\n')}\n\nLOAD   = Reflects whether the unit definition was properly loaded.\nACTIVE = The high-level unit activation state, i.e. generalization of SUB.\nSUB    = The low-level unit activation state, values depend on unit type.\n${fe.length} loaded units listed.`);
    }
    if (sub === 'default' || (sub === 'isolate' && args[0] === 'default.target')) { if (st.modus === 'emergency' || st.modus === 'rescue') return ok(weiterStandard(w)); }
    if (sub === 'daemon-reload') { if (!r) return fehler('Failed to reload daemon: Access denied'); neuLaden(w); return alt.systemctl(w, a, i, r); }
    if (sub === 'reboot' && imChroot(w)) return fehler('Running in chroot, ignoring command \'reboot\'');
    // SysV-Skripte unter AlmaLinux
    if (st.opt.sysv === 'chkconfig' && args[0] && hat(w, `/etc/rc.d/init.d/${args[0].replace(/\.service$/, '')}`)) {
      const n = args[0].replace(/\.service$/, '');
      if (sub === 'enable' || sub === 'disable') { if (!r) return fehler('Failed to enable unit: Access denied'); b.chkconfig(w, [n, sub === 'enable' ? 'on' : 'off'], '', true); return ok(`${n}.service is not a native service, redirecting to systemd-sysv-install.\nExecuting: /usr/lib/systemd/systemd-sysv-install ${sub} ${n}`); }
      if (sub === 'status') return { out: `${st.laeuft.includes(n) ? '●' : '○'} ${n}.service - SYSV: Messdienst der Labor Mess GmbH\n     Loaded: loaded (/etc/rc.d/init.d/${n}; generated)\n     Active: ${st.laeuft.includes(n) ? 'active (running) since Tue 2026-11-24 08:12:41 CET; 5min ago' : 'inactive (dead)'}\n       Docs: man:systemd-sysv-generator(8)`, code: st.laeuft.includes(n) ? 0 : 3 };
      if (sub === 'start' || sub === 'stop' || sub === 'restart') { const x = sysvSkript(w, `/etc/rc.d/init.d/${n}`, [sub], r); return x.code ? x : ok(); }
    }
    const meins = (u?: string) => !!u && u in st.units;
    if (sub === 'cat') { if (!meins(args[0])) return alt.systemctl(w, a, i, r); const u = args[0]; if (maskiert(w, u)) return ok(`# Unit ${u} is masked.`); return ok([fragment(w, u)!, ...dropins(w, u)].map((p) => `# ${p}\n${(w.fs[p] ?? '').replace(/\n$/, '')}`).join('\n\n')); }
    if (sub === 'edit') {
      const u = args[0]; if (!meins(u)) return alt.systemctl(w, a, i, r);
      if (!r) return fehler(`Failed to edit ${u}: Interactive authentication required.`);
      const voll = opts.includes('--full'); const lauf = opts.includes('--runtime');
      const ziel = voll ? `/etc/systemd/system/${u}` : `${lauf ? '/run' : '/etc'}/systemd/system/${u}.d/override.conf`;
      if (voll && !(ziel in w.fs)) datei(w, ziel, w.fs[fragment(w, u)!] ?? '');
      if (!voll) { ordner(w, ziel.replace(/\/[^/]+$/, '')); if (!(ziel in w.fs)) datei(w, ziel, ''); }
      return K.vi(w, ziel, () => { if (!voll && !(w.fs[ziel] ?? '').trim()) { delete w.fs[ziel]; return `Editing "${ziel}" canceled: temporary file is empty.`; } neuLaden(w); return ''; });
    }
    if (sub === 'revert') { const u = args[0]; if (!meins(u)) return alt.systemctl(w, a, i, r); if (!r) return fehler('Failed to revert unit: Access denied'); const z: string[] = []; for (const p of [`/etc/systemd/system/${u}`, ...dropins(w, u).filter((p) => !p.startsWith('/usr/'))]) if (p in w.fs && fragment(w, u) !== `/usr/lib/systemd/system/${u}` || p.includes('.d/')) { if (p in w.fs) { delete w.fs[p]; z.push(`Removed "${p}".`); } } weg(w, `/etc/systemd/system/${u}.d`); neuLaden(w); return ok(z.join('\n')); }
    if (sub === 'show') {
      const u = args[0]; if (!meins(u)) return alt.systemctl(w, a, i, r);
      const t = st.units[u].geladen; const pi = a.indexOf('-p'); const props = pi >= 0 ? a[pi + 1].split(',') : a.filter((x) => x.startsWith('--property=')).map((x) => x.slice(11));
      const alle: Record<string, string> = { Id: u, Description: wert(t, 'Description') ?? '', FragmentPath: fragment(w, u) ?? '', DropInPaths: dropins(w, u).join(' '), UnitFileState: aktiviert(w, u), ActiveState: st.units[u].aktiv ? 'active' : st.units[u].fehler ? 'failed' : 'inactive', User: wert(t, 'User') ?? '', Restart: wert(t, 'Restart') ?? 'no', ExecStart: `{ path=${(wert(t, 'ExecStart') ?? '').split(' ')[0]} ; argv[]=${wert(t, 'ExecStart') ?? ''} }`, Environment: wert(t, 'Environment') ?? '', WantedBy: wert(t, 'WantedBy') ?? '', After: wert(t, 'After') ?? '', NeedDaemonReload: st.units[u].geladen !== wirksam(w, u) ? 'yes' : 'no' };
      const liste = props.length ? props : Object.keys(alle);
      return ok(liste.map((k) => (a.includes('--value') ? alle[k] ?? '' : `${k}=${alle[k] ?? ''}`)).join('\n'));
    }
    if (['start', 'stop', 'restart', 'status', 'enable', 'disable', 'mask', 'unmask', 'is-enabled', 'is-active', 'is-failed', 'reenable'].includes(sub) && meins(args[0])) {
      const u = args[0]; const s = st.units[u];
      const darf = () => (r ? null : fehler(`Failed to ${sub} unit: Access denied`));
      if (sub === 'status') return { out: unitStatus(w, u), code: s.aktiv ? 0 : 3 };
      if (sub === 'is-active') return { out: s.aktiv ? 'active' : s.fehler ? 'failed' : 'inactive', code: s.aktiv ? 0 : 3 };
      if (sub === 'is-failed') return { out: s.fehler ? 'failed' : s.aktiv ? 'active' : 'inactive', code: s.fehler ? 0 : 1 };
      if (sub === 'is-enabled') { const x = aktiviert(w, u); return { out: x, code: x === 'enabled' ? 0 : 1 }; }
      const d = darf(); if (d) return d;
      if (sub === 'mask') { if (s.aktiv && !opts.includes('--now')) { /* läuft weiter */ } datei(w, `/etc/systemd/system/${u}`, '-> /dev/null', 0o777); if (opts.includes('--now')) s.aktiv = false; return ok(`Created symlink /etc/systemd/system/${u} → /dev/null.`); }
      if (sub === 'unmask') { if (!maskiert(w, u)) return ok(); delete w.fs[`/etc/systemd/system/${u}`]; return ok(`Removed "/etc/systemd/system/${u}".`); }
      if (sub === 'enable' || sub === 'reenable') {
        if (maskiert(w, u)) return fehler(`Failed to enable unit: Unit file /etc/systemd/system/${u} is masked.`);
        const wb = wert(wirksam(w, u), 'WantedBy'); if (!wb) return ok(`The unit files have no installation config (WantedBy=, RequiredBy=, Also=,\nAlias= settings in the [Install] section, and DefaultInstance= for template\nunits). This means they are not meant to be enabled or disabled using systemctl.`);
        const z: string[] = [];
        for (const t of wb.split(/\s+/)) { const p = `/etc/systemd/system/${t}.wants/${u}`; if (!(p in w.fs)) { datei(w, p, '-> ' + fragment(w, u), 0o777); z.push(`Created symlink ${p} → ${fragment(w, u)}.`); } }
        if (opts.includes('--now')) { const e = unitStarten(w, u); if (e) return { out: z.join('\n'), err: `Job for ${u} failed because the control process exited with error code.\nSee "systemctl status ${u}" and "journalctl -xeu ${u}" for details.`, code: 1 }; }
        return ok(z.join('\n'));
      }
      if (sub === 'disable') { const z: string[] = []; for (const p of Object.keys(w.fs)) if (/^\/etc\/systemd\/system\/[^/]+\.wants\//.test(p) && p.endsWith('/' + u)) { delete w.fs[p]; z.push(`Removed "${p}".`); } if (opts.includes('--now')) s.aktiv = false; return ok(z.join('\n')); }
      if (sub === 'stop') { s.aktiv = false; return ok(); }
      if (maskiert(w, u)) return fehler(`Failed to ${sub} ${u}: Unit ${u} is masked.`);
      const e = unitStarten(w, u);
      const warn = s.geladen !== wirksam(w, u) ? `Warning: The unit file, source configuration file or drop-ins of ${u} changed on disk. Run 'systemctl daemon-reload' to reload units.\n` : '';
      if (e) return { out: '', err: `${warn}Job for ${u} failed because the control process exited with error code.\nSee "systemctl status ${u}" and "journalctl -xeu ${u}" for details.`, code: 1 };
      return warn ? { out: '', err: warn.trim(), code: 0 } : ok();
    }
    if (sub === 'list-dependencies' && args[0] && name(args[0]) in st.units) { const u = name(args[0]); const t = wirksam(w, u); const d = [...(wert(t, 'Requires') ?? '').split(/\s+/), ...(wert(t, 'Wants') ?? '').split(/\s+/)].filter(Boolean); return ok(`${u}\n${[...d, 'system.slice', 'sysinit.target'].map((x, i, l) => `● ${i === l.length - 1 ? '└' : '├'}─${x}`).join('\n')}`); }
    if (sub === 'list-dependencies') { const t = args[0] ?? 'default.target'; const u = Object.keys(st.units).filter((x) => wants(w, x).includes(t.replace(/^default\.target$/, 'multi-user.target'))); return ok(`${t}\n${[...u.map((x) => `● ├─${x}`), '● ├─cron.service', '● ├─ssh.service', '● └─basic.target'].join('\n')}`); }
    return alt.systemctl(w, a, i, r);
  };
  b['systemd-delta'] = (w, a) => {
    if (!startAktiv(w)) return fehler('bash: systemd-delta: Befehl nicht gefunden', 127);
    const z: string[] = []; let n = 0;
    const typ = a.find((x) => x.startsWith('--type='))?.slice(7).split(',');
    const zeig = (t: string) => !typ || typ.includes(t.toLowerCase());
    const namen = new Set<string>();
    for (const d of UDIR) for (const p of Object.keys(w.fs)) if (p.startsWith(d + '/') && !p.slice(d.length + 1).includes('/') && /\.(service|socket|timer|target|mount)$/.test(p)) namen.add(p.split('/').pop()!);
    for (const u of [...namen].sort()) {
      const quellen = UDIR.filter((d) => `${d}/${u}` in w.fs);
      if (quellen.length > 1) {
        const oben = `${quellen[0]}/${u}`; const unten = `${quellen[quellen.length - 1]}/${u}`;
        if (w.fs[oben] === '-> /dev/null') { if (zeig('masked')) { z.push(`[MASKED]     ${oben} → ${unten}`, ''); n++; } }
        else if (zeig('overridden')) { z.push(`[OVERRIDDEN] ${oben} → ${unten}`, ''); const alt2 = (w.fs[unten] ?? '').split('\n'); const neu2 = (w.fs[oben] ?? '').split('\n'); const diff: string[] = []; alt2.forEach((x) => { if (!neu2.includes(x)) diff.push(`-${x}`); }); neu2.forEach((x) => { if (!alt2.includes(x)) diff.push(`+${x}`); }); if (diff.length) z.push(`--- ${unten}`, `+++ ${oben}`, ...diff, ''); n++; }
      }
      const di = dropins(w, u);
      if (di.length && zeig('extended')) for (const p of di) { z.push(`[EXTENDED]   ${fragment(w, u)} → ${p}`); n++; }
      if (di.length && zeig('extended')) z.push('');
    }
    z.push(`${n} overridden configuration files found.`);
    return ok(z.join('\n'));
  };

  // ---- Firmware und GRUB ----
  b.efibootmgr = (w, a, _i, root) => {
    if (!startAktiv(w) || w.distro !== 'debian' && w.distro !== 'alma') return fehler('bash: efibootmgr: Befehl nicht gefunden', 127);
    if (imChroot(w) && !chrootHat(w, '/sys')) return fehler('EFI variables are not supported on this system.');
    const e = ss(w).efi; const v = a.includes('-v') || a.includes('--verbose');
    const aendert = a.some((x) => /^-(o|n|N|b|B|c|a|A|-bootorder|-bootnext|-create|-delete-bootnum)$/.test(x) || /^-[a-zA-Z]*[oBcaAnN]/.test(x) && !/^-v+$/.test(x));
    if (!aendert) return ok(efiAusgabe(w, v));
    if (!root) return fehler('Could not set BootOrder: Permission denied');
    const wert2 = (k: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
    const nr = wert2('-b') ?? wert2('--bootnum');
    if (wert2('-o') ?? wert2('--bootorder')) { const o = (wert2('-o') ?? wert2('--bootorder'))!.split(',').map((x) => x.padStart(4, '0').toUpperCase()); const fehlt = o.find((x) => !e.e[x]); if (fehlt) return fehler(`Invalid BootOrder order entry value${fehlt}`); e.order = o; }
    if (wert2('-n') ?? wert2('--bootnext')) { const x = (wert2('-n') ?? wert2('--bootnext'))!.padStart(4, '0').toUpperCase(); if (!e.e[x]) return fehler(`Boot entry ${x} does not exist`); e.next = x; }
    if (a.includes('-N') || a.includes('--delete-bootnext')) e.next = null;
    if (a.includes('-B') || a.includes('--delete-bootnum')) { if (!nr) return fehler('--delete-bootnum requires --bootnum'); const x = nr.padStart(4, '0').toUpperCase(); if (!e.e[x]) return fehler(`Boot entry ${x} does not exist`); delete e.e[x]; e.order = e.order.filter((y) => y !== x); }
    if ((a.includes('-a') || a.includes('-A')) && nr) { const x = nr.padStart(4, '0').toUpperCase(); if (e.e[x]) e.e[x].aktiv = a.includes('-a'); }
    if (a.includes('-c') || a.includes('--create')) {
      const l = wert2('-L') ?? wert2('--label') ?? 'Linux'; const d = wert2('-l') ?? wert2('--loader') ?? '\\EFI\\BOOT\\BOOTX64.EFI';
      const frei = ['0000', '0001', '0002', '0003', '0004', '0005', '0006'].find((x) => !e.e[x])!;
      e.e[frei] = { name: l, datei: d.replace(/\//g, '\\'), aktiv: true }; e.order = [frei, ...e.order];
    }
    return ok(efiAusgabe(w, v));
  };
  b['grub-install'] = mit('grub-install', (w, a, i, r) => {
    if (!r) return fehler('grub-install: error: failed to get canonical path of `/boot/efi\'.');
    const t = (a.find((x) => x.startsWith('--target='))?.slice(9)) ?? 'x86_64-efi';
    if (t === 'i386-pc') { const dev = a.find((x) => x.startsWith('/dev/')); if (!dev) return fehler('grub-install: error: install device isn\'t specified.'); return fehler(`Installing for i386-pc platform.\ngrub-install: warning: this GPT partition label contains no BIOS Boot Partition; embedding won't be possible.\ngrub-install: error: embedding is not possible, but this is required for cross-disk install.`); }
    if (imChroot(w) && !chrootHat(w, '/dev')) return fehler('grub-install: error: cannot find a device for /boot/grub (is /dev mounted?).');
    const ed = a.find((x) => x.startsWith('--efi-directory='))?.slice(16) ?? '/boot/efi';
    if (ed !== '/boot/efi' || !espImChroot(w)) return fehler(`Installing for x86_64-efi platform.\ngrub-install: error: ${ed} doesn't look like an EFI partition.`);
    const id = a.find((x) => x.startsWith('--bootloader-id='))?.slice(16) ?? 'debian';
    const files: Record<string, string> = {}; for (const [k, v] of Object.entries(ESP_DEBIAN)) files[k.replace('/debian/', `/${id}/`)] = v;
    if (a.includes('--removable')) { espSchreiben(w, { '/EFI/BOOT/BOOTX64.EFI': '\u0007BIN:952384', '/EFI/BOOT/grubx64.efi': '\u0007BIN:2549304' }); }
    else {
      espSchreiben(w, files);
      if (!(imChroot(w) && !chrootHat(w, '/sys'))) { const e = ss(w).efi; let nr = Object.keys(e.e).find((k) => e.e[k].name === id); if (!nr) { nr = ['0000', '0001', '0002', '0003', '0004', '0005'].find((x) => !e.e[x])!; e.e[nr] = { name: id, datei: `\\EFI\\${id}\\shimx64.efi`, aktiv: true }; } e.order = [nr, ...e.order.filter((x) => x !== nr)]; }
      else return fehler(`Installing for x86_64-efi platform.\ngrub-install: warning: EFI variables cannot be set on this system.\ngrub-install: warning: You will have to complete the GRUB setup manually.\nInstallation finished. No error reported.`, 0);
    }
    for (const d of ['/boot/grub/x86_64-efi', '/boot/grub/fonts', '/boot/grub/locale']) ordner(w, d);
    datei(w, '/boot/grub/x86_64-efi/normal.mod', '\u0007BIN:31000'); datei(w, '/boot/grub/grubenv', '# GRUB Environment Block\n' + '#'.repeat(990) + '\n');
    void i;
    return ok('Installing for x86_64-efi platform.\nInstallation finished. No error reported.');
  });
  for (const n of ['update-grub', 'grub-mkconfig']) {
    b[n] = mit(n, (w, a, i, r) => {
      if (imChroot(w) && (!chrootHat(w, '/dev') || !chrootHat(w, '/proc'))) return fehler('/usr/sbin/grub-probe: error: failed to get canonical path of `/dev/nvme0n1p2\'.');
      return alt[n](w, a, i, r);
    });
  }
  b.chroot = (w, a, _i, r) => (startAktiv(w) ? chroot(w, a, r) : fehler('chroot: Im Simulator nur in den Rettungs-Missionen von LPIC-2 nachgebaut.'));
  b.mount = (w, a, i, r) => {
    if (!startAktiv(w)) return alt.mount(w, a, i, r);
    const bind = a.includes('--bind') || a.includes('--rbind') || a.includes('-B') || a.includes('-R') || (a.includes('-o') && /(^|,)r?bind(,|$)/.test(a[a.indexOf('-o') + 1] ?? ''));
    if (!bind) { const x = alt.mount(w, a, i, r); if (!x.code && ss(w).opt.sysv !== 'debian' && a.includes('remount') === false) { /* nichts */ } return x; }
    if (!r) return fehler('mount: nur root kann das tun.');
    const frei = a.filter((x, j) => !x.startsWith('-') && a[j - 1] !== '-o');
    const [q, z] = frei; if (!q || !z) return fehler('mount: Ziel fehlt');
    const zp = K.pfad(w, z); if (w.fs[zp] !== null) return fehler(`mount: ${z}: Einhängepunkt existiert nicht.`);
    const st = ss(w); if (!st.binds.includes(zp)) st.binds.push(zp);
    return ok();
  };
  b.umount = (w, a, i, r) => {
    if (!startAktiv(w)) return alt.umount(w, a, i, r);
    const st = ss(w); const ziele = a.filter((x) => !x.startsWith('-')).map((x) => K.pfad(w, x));
    const vorher = st.binds.length; st.binds = st.binds.filter((b2) => !ziele.includes(b2) && !(a.includes('-R') && ziele.some((z) => b2.startsWith(z + '/'))));
    const rest = a.filter((x) => !(x !== '-R' && !x.startsWith('-') && vorher !== st.binds.length && !w.platten?.mounts.some((m) => m.ziel === K.pfad(w, x))));
    if (a.includes('-R')) { const z = ziele[0]; for (const m of [...(w.platten?.mounts ?? [])].filter((m) => m.ziel.startsWith(z)).sort((x, y) => y.ziel.length - x.ziel.length)) alt.umount(w, [m.ziel], i, r); return ok(); }
    if (rest.filter((x) => !x.startsWith('-')).length) return alt.umount(w, rest, i, r);
    return ok();
  };
  b.passwd = (w, a, i, r) => {
    if (startAktiv(w) && (r || w.root)) { const m = w.platten?.mounts.find((x) => x.ziel === '/'); if (m && m.optionen.startsWith('ro')) return fehler('passwd: Bearbeitungssfehler des Legitimierungszeichens\npasswd: Passwort nicht geändert'); }
    return alt.passwd(w, a, i, r);
  };
  b.reboot = (w, a, i, r) => {
    if (startAktiv(w) && ss(w).modus === 'bash') { if (a.includes('-f') || a.includes('--force')) { w.aus = 'reboot'; return ok('(Neustart ohne init. Mit „Neu starten“ unter dem Terminal geht es weiter.)'); } return keinSystemd(); }
    if (startAktiv(w) && imChroot(w)) return fehler('Running in chroot, ignoring command \'reboot\'');
    return alt.reboot(w, a, i, r);
  };
  b.journalctl = (w, a, i, r) => {
    const x = alt.journalctl(w, a, i, r);
    if (!startAktiv(w) || !ss(w).journal.length || x.code) return x;
    const st = ss(w); const ui = a.findIndex((y) => y === '-u' || /^-[a-z]*u$/.test(y)); const u = ui >= 0 && a[ui + 1] ? name(a[ui + 1]) : null;
    const z = st.journal.filter((l) => !u || l.startsWith(u)).map((l, j) => `Nov 24 08:12:${String(41 + j).padStart(2, '0')} ${w.host} systemd[1]: ${l}`);
    return ok([u ? '' : x.out, ...z].filter(Boolean).join('\n'));
  };
  // ---- PXE und ISO ----
  b.tftp = (w, a) => {
    if (!hat(w, '/usr/bin/tftp')) return fehler('bash: tftp: Befehl nicht gefunden\n(tftp gehört zum Paket tftp-hpa: sudo apt install tftp-hpa)', 127);
    const ci = a.indexOf('-c'); const host = a.find((x) => !x.startsWith('-')) ?? '';
    if (ci < 0 || a[ci + 1] !== 'get' || !a[ci + 2]) return fehler('(Im Simulator: tftp HOST -c get DATEI)');
    if (!w.pakete || w.pakete.installiert['tftpd-hpa'] !== 'ii' || !/^(localhost|127\.0\.0\.1|192\.168\.50\.10|srv1)$/.test(host)) return fehler('Transfer timed out.', 1);
    const dir = ((w.fs['/etc/default/tftpd-hpa'] ?? '').match(/^TFTP_DIRECTORY="([^"]+)"/m)?.[1] ?? '/srv/tftp').replace(/\/$/, '');
    const f = a[ci + 2].replace(/^\//, ''); const q = `${dir}/${f}`;
    if (typeof w.fs[q] !== 'string') return fehler('Error code 1: File not found', 1);
    const n = f.split('/').pop()!; datei(w, K.pfad(w, n), w.fs[q] as string);
    return ok();
  };
  b.xorriso = (w, a, _i, r) => {
    if (!hat(w, '/usr/bin/xorriso')) return fehler('bash: xorriso: Befehl nicht gefunden\n(xorriso gehört zum Paket xorriso: sudo apt install xorriso)', 127);
    if (a[0] !== '-as' || a[1] !== 'mkisofs') return fehler('(Im Simulator versteht xorriso nur den Aufruf im Stil von mkisofs: xorriso -as mkisofs …)');
    const wert = (o: string) => { const i = a.indexOf(o); return i >= 0 ? a[i + 1] : undefined; };
    const quelle = a[a.length - 1]; const q = K.pfad(w, quelle ?? '');
    if (w.fs[q] !== null) return fehler(`xorriso : FAILURE : Cannot determine attributes of source file '${q}' : No such file or directory`);
    const z: string[] = ['xorriso 1.5.4 : RockRidge filesystem manipulator, libburnia project.', ''];
    const mbr = wert('-isohybrid-mbr'); if (mbr && typeof w.fs[K.pfad(w, mbr)] !== 'string') return fehler(`xorriso : FAILURE : -isohybrid-mbr: Cannot open file '${mbr}'\n(isohdpfx.bin liegt nach sudo apt install isolinux unter /usr/lib/ISOLINUX/)`);
    const b0 = wert('-b'); if (b0 && typeof w.fs[`${q}/${b0}`] !== 'string') return fehler(`xorriso : FAILURE : Cannot find in ISO image: -boot_image ... bin_path='/${b0}'`);
    const e = wert('-e'); if (e && typeof w.fs[`${q}/${e}`] !== 'string') return fehler(`xorriso : FAILURE : Cannot find in ISO image: -boot_image ... efi_path='/${e}'`);
    const o = wert('-o'); if (!o) return fehler('xorriso : FAILURE : No output drive selected. Use option -o.');
    const ziel = K.pfad(w, o); const dir = ziel.slice(0, ziel.lastIndexOf('/')) || '/';
    if (!r && !dir.startsWith('/home/') && dir !== '/tmp') return fehler(`xorriso : FAILURE : Cannot open '${o}' : Permission denied`);
    datei(w, ziel, `\u0007ISO:${mbr ? 'mbr' : ''}:${b0 ?? ''}:${e ?? ''}:${a.includes('-isohybrid-gpt-basdat') ? 'gpt' : ''}`);
    z.push(`Drive current: -outdev 'stdio:${o}'`, 'Media current: stdio file, overwriteable', 'Added to ISO image: directory \'/\'=\'' + q + '\'');
    if (b0) z.push(`xorriso : UPDATE :      12 files added in 1 seconds`, `libisofs: NOTE : Boot image (El Torito, BIOS): /${b0}`);
    if (e) z.push(`libisofs: NOTE : Boot image (El Torito, EFI): /${e}`);
    if (mbr) z.push(`libisofs: NOTE : MBR from ${mbr} (isohybrid: also bootable from USB stick)`);
    z.push('ISO image produced: 1153024 sectors', 'Written to medium : 1153024 sectors at LBA 0', 'Writing to \'stdio:' + o + '\' completed successfully.');
    return ok(z.join('\n'));
  };
  // ---- SYSLINUX ----
  b.extlinux = (w, a, _i, r) => {
    if (!hat(w, '/usr/bin/extlinux')) return fehler('bash: extlinux: Befehl nicht gefunden\n(extlinux gehört zum Paket extlinux: sudo apt install extlinux)', 127);
    const ii = a.findIndex((x) => x === '--install' || x === '-i'); if (ii < 0) return fehler('Usage: extlinux [options] directory\n  --install    -i  Install over the current bootsector\n  --update     -U  Update a previous installation');
    const d = K.pfad(w, a[ii + 1] ?? ''); if (w.fs[d] !== null) return fehler(`extlinux: cannot open path: ${a[ii + 1]}`);
    if (!r) return fehler(`extlinux: cannot open file ${d}/ldlinux.sys: Permission denied`);
    datei(w, `${d}/ldlinux.sys`, '\u0007BIN:69120', 0o444); datei(w, `${d}/ldlinux.c32`, '\u0007BIN:120312');
    return ok(`${d} is device /dev/sdb1`);
  };
  b.syslinux = (w, a, _i, r) => {
    if (!hat(w, '/usr/bin/syslinux')) return fehler('bash: syslinux: Befehl nicht gefunden\n(syslinux gehört zum Paket syslinux: sudo apt install syslinux)', 127);
    const dev = a.find((x) => x.startsWith('/dev/')); if (!dev) return fehler('Usage: syslinux [options] device\n  --install  -i  Install over the current bootsector\n  --directory -d  Directory for installation target');
    if (!r) return fehler(`syslinux: ${dev}: Permission denied`);
    return ok();
  };
  return b;
}

/** exec /sbin/init nach dem Start mit init=/bin/bash */
export function initExec(w: Welt, a: string[]): Ergebnis | null {
  if (!(startAktiv(w) && ss(w).modus === 'bash' && /^\/(s?bin|usr\/s?bin)\/init$|^\/lib\/systemd\/systemd$/.test(a[0] ?? ''))) return null;
  const st = ss(w); st.modus = null; if (st.hostAlt) { w.host = st.hostAlt; st.hostAlt = ''; }
  const m = w.platten?.mounts.find((x) => x.ziel === '/'); if (m) m.optionen = m.optionen.replace(/^ro/, 'rw');
  w.target = w.defaultTarget; w.root = false;
  return ok('[  OK  ] Reached target local-fs.target - Local File Systems.\n[  OK  ] Reached target multi-user.target - Multi-User System.\n\n(init hat übernommen, der Start läuft normal weiter.)');
}

/** Ausführbare SysV-Skripte (/etc/init.d/NAME start). */
function sysvSkript(w: Welt, p: string, a: string[], root: boolean): Ergebnis {
  const st = ss(w); const n = p.split('/').pop()!;
  if (!hat(w, p)) return fehler(`${n}: unrecognized service`);
  const t = SYSV_DIENSTE[n]?.[0] ?? n; const akt = a[0];
  if (akt === 'status') return st.laeuft.includes(n) ? ok(`${n} is running.`) : { out: `${n} is not running ... failed!`, code: 3 };
  if (!['start', 'stop', 'restart', 'force-reload'].includes(akt ?? '')) return fehler(`Usage: ${p} {start|stop|restart|force-reload|status}`);
  if (!root) return fehler(`${n}: You need root privileges to run this script`);
  const z: string[] = [];
  if (akt !== 'start' && st.laeuft.includes(n)) { st.laeuft = st.laeuft.filter((x) => x !== n); z.push(`Stopping ${t}: ${n}.`); }
  if (akt !== 'stop' && !st.laeuft.includes(n)) { st.laeuft.push(n); z.push(`Starting ${t}: ${n}.`); }
  return ok(z.join('\n'));
}
export function startProgramm(w: Welt, z: string, args: string[], root: boolean): Ergebnis | null {
  if (!startAktiv(w) || !ss(w).opt.sysv) return null;
  if (!z.startsWith(initd(w) + '/')) return null;
  return sysvSkript(w, z, args, root);
}

// ---------- Welt vorbereiten ----------

export function startStarten(w: Welt, o: StartOptionen) {
  const st: StStand = {
    opt: o, laeuft: [], rl: '2', rlVorher: 'N', units: {}, modus: null, chroot: [], binds: [], live: !!o.live, hostAlt: '', fstabGeladen: w.fs['/etc/fstab'] ?? '', journal: [], grubMenue: o.grub === 'menue', manuell: null, gebootet: [], rootPw: 'Messpc2026',
    efi: { order: ['0000', '0001', '0002'], next: null, current: '0000', e: { '0000': { name: 'debian', datei: '\\EFI\\debian\\shimx64.efi', aktiv: true }, '0001': { name: 'UEFI: PXE IPv4 Intel(R) Ethernet Connection (7) I219-V', pxe: true, aktiv: true }, '0002': { name: 'UEFI: SanDisk Ultra Fit', usb: true, aktiv: true } } },
  };
  (w as SW).startstand = st;
  // ESP
  if (w.distro === 'debian') espSchreiben(w, ESP_DEBIAN);
  if (w.distro === 'debian' && w.pakete) w.pakete.installiert['efibootmgr'] = 'ii';
  datei(w, '/usr/bin/efibootmgr', '', 0o755);
  if (w.distro === 'debian') {
    for (const v of ['Boot0000-8be4df61-93ca-11d2-aa0d-00e098032b8c', 'Boot0001-8be4df61-93ca-11d2-aa0d-00e098032b8c', 'Boot0002-8be4df61-93ca-11d2-aa0d-00e098032b8c', 'BootOrder-8be4df61-93ca-11d2-aa0d-00e098032b8c', 'BootCurrent-8be4df61-93ca-11d2-aa0d-00e098032b8c', 'SecureBoot-8be4df61-93ca-11d2-aa0d-00e098032b8c']) datei(w, `/sys/firmware/efi/efivars/${v}`, '', 0o644);
    datei(w, '/sys/firmware/efi/fw_platform_size', '64\n', 0o444);
    datei(w, '/boot/grub/grubenv', '# GRUB Environment Block\n# WARNING: Do not edit this file by tools other than grub-editenv!!!\n' + '#'.repeat(40) + '\n');
    datei(w, '/boot/grub/fonts/unicode.pf2', '\u0007BIN:2395475'); datei(w, '/boot/grub/x86_64-efi/normal.mod', '\u0007BIN:42000'); datei(w, '/boot/grub/x86_64-efi/linux.mod', '\u0007BIN:21000'); datei(w, '/boot/grub/x86_64-efi/ext2.mod', '\u0007BIN:15000'); datei(w, '/boot/grub/x86_64-efi/core.efi', '\u0007BIN:208896');
    for (const k of ['6.1.0-26-amd64', '6.1.0-27-amd64']) if (`/boot/vmlinuz-${k}` in w.fs && !(`/boot/System.map-${k}` in w.fs)) datei(w, `/boot/System.map-${k}`, '\u0007BIN:83000');
  }
  if (o.sysv === 'debian') {
    w.host = 'altserver';
    datei(w, '/etc/inittab', INITTAB);
    for (const [n, [t]] of Object.entries(SYSV_DIENSTE)) datei(w, `/etc/init.d/${n}`, lsb(n, t, '2 3 4 5', '0 1 6', n === 'messd' ? '$remote_fs $syslog $network' : '$remote_fs $syslog'), 0o755);
    datei(w, '/etc/init.d/rc', '#!/bin/sh\n# Führt beim Wechsel in einen Runlevel erst alle K-Skripte mit stop,\n# dann alle S-Skripte mit start aus.\n', 0o755);
    datei(w, '/etc/init.d/rcS', '#!/bin/sh\n# Startet beim Hochfahren die Skripte aus /etc/rcS.d\nexec /etc/init.d/rc S\n', 0o755);
    datei(w, '/etc/init.d/README', 'Skripte in diesem Ordner starten und stoppen Dienste. Die Verknüpfungen in /etc/rc?.d\nlegt update-rc.d anhand der LSB-Kopfzeilen an.\n');
    datei(w, '/usr/sbin/messd', '\u0007BIN:182000', 0o755);
    for (const n of ['rsyslog', 'cron', 'ssh']) rcLinks(w, '/etc', n, ['2', '3', '4', '5'], ['0', '1', '6'], SYSV_DIENSTE[n][1], n === 'rsyslog' ? '02' : '01');
    datei(w, '/etc/rcS.d/S01udev', '-> ../init.d/udev', 0o777); datei(w, '/etc/rcS.d/S02procps', '-> ../init.d/procps', 0o777);
    datei(w, '/etc/rc0.d/K09halt', '-> ../init.d/halt', 0o777); datei(w, '/etc/rc6.d/K09reboot', '-> ../init.d/reboot', 0o777); datei(w, '/etc/rc1.d/S01single', '-> ../init.d/single', 0o777);
    for (const n of ['halt', 'reboot', 'single', 'udev', 'procps']) if (!hat(w, `/etc/init.d/${n}`)) datei(w, `/etc/init.d/${n}`, '#!/bin/sh\n', 0o755);
    w.prozesse = w.prozesse.map((p) => (p.pid === 1 ? { ...p, cmd: 'init [2]' } : p));
    st.rl = '2'; rcWechsel(w, '2'); st.rlVorher = 'N';
  }
  if (o.sysv === 'chkconfig') {
    datei(w, '/etc/rc.d/init.d/messd', `#!/bin/bash\n#\n# messd        Messdienst der Labor Mess GmbH\n#\n# chkconfig: 2345 90 10\n# description: Liest die Messbox aus und schreibt die Werte nach /var/lib/messd.\n\n. /etc/rc.d/init.d/functions\ncase "$1" in\n  start)  echo -n "Starting messd: "; daemon /usr/sbin/messd; echo ;;\n  stop)   echo -n "Shutting down messd: "; killproc messd; echo ;;\n  status) status messd ;;\n  restart) $0 stop; $0 start ;;\n  *) echo "Usage: messd {start|stop|status|restart}"; exit 2 ;;\nesac\n`, 0o755);
    datei(w, '/etc/rc.d/init.d/functions', '# Hilfsfunktionen für SysV-Skripte (daemon, killproc, status)\n');
    datei(w, '/etc/rc.d/init.d/README', 'Native systemd-Dienste stehen nicht hier. SysV-Skripte in diesem Ordner\nverwandelt systemd-sysv-generator beim Start in Units.\n');
    for (const rl of ['0', '1', '2', '3', '4', '5', '6']) { ordner(w, `/etc/rc.d/rc${rl}.d`); datei(w, `/etc/rc${rl}.d`, `-> rc.d/rc${rl}.d`, 0o777); }
    datei(w, '/etc/init.d', '-> rc.d/init.d', 0o777);
    datei(w, '/usr/sbin/messd', '\u0007BIN:182000', 0o755); datei(w, '/usr/sbin/chkconfig', '', 0o755);
    datei(w, '/run/systemd/generator.late/messd.service', '# Automatically generated by systemd-sysv-generator\n\n[Unit]\nDocumentation=man:systemd-sysv-generator(8)\nSourcePath=/etc/rc.d/init.d/messd\nDescription=SYSV: Messdienst der Labor Mess GmbH\n\n[Service]\nType=forking\nRestart=no\nTimeoutSec=5min\nIgnoreSIGPIPE=no\nKillMode=process\nGuessMainPID=no\nRemainAfterExit=yes\nSuccessExitStatus=5 6\nExecStart=/etc/rc.d/init.d/messd start\nExecStop=/etc/rc.d/init.d/messd stop\n');
  }
  if (o.units) {
    datei(w, '/usr/lib/systemd/system/messd.service', MESSD_UNIT);
    datei(w, '/usr/lib/systemd/system/bluetooth.service', BT_UNIT);
    ordner(w, '/run/systemd/system'); ordner(w, '/run/systemd/generator.late');
    datei(w, '/run/systemd/generator/-.mount', '# Automatically generated by systemd-fstab-generator\n\n[Unit]\nDocumentation=man:fstab(5) man:systemd-fstab-generator(8)\nSourcePath=/etc/fstab\nBefore=local-fs.target\n\n[Mount]\nWhat=/dev/disk/by-uuid/5a1c2e7f-3b9d-4c0a-8e2f-6d7b1a9c0e34\nWhere=/\nType=ext4\nOptions=errors=remount-ro\n');
    datei(w, '/run/systemd/generator/boot-efi.mount', '# Automatically generated by systemd-fstab-generator\n\n[Unit]\nSourcePath=/etc/fstab\nBefore=local-fs.target\n\n[Mount]\nWhat=/dev/disk/by-uuid/7C3E-1A2B\nWhere=/boot/efi\nType=vfat\nOptions=umask=0077\n');
    datei(w, '/usr/sbin/messd', '\u0007BIN:182000', 0o755); datei(w, '/usr/libexec/bluetooth/bluetoothd', '\u0007BIN:1200000', 0o755);
    datei(w, '/etc/messd.conf', '# Einstellungen für messd\nintervall=1000\nziel=/var/lib/messd\n');
    if (!/^mess:/m.test(w.fs['/etc/passwd'] ?? '')) { w.fs['/etc/passwd'] += 'mess:x:998:998:Messdienst:/var/lib/messd:/usr/sbin/nologin\n'; w.fs['/etc/group'] += 'mess:x:998:\n'; }
    datei(w, '/etc/systemd/system/bluetooth.target.wants/bluetooth.service', '-> /usr/lib/systemd/system/bluetooth.service', 0o777);
    datei(w, '/etc/systemd/system/dbus-org.bluez.service', '-> /usr/lib/systemd/system/bluetooth.service', 0o777);
    st.units['messd.service'] = { aktiv: false, geladen: '' }; st.units['bluetooth.service'] = { aktiv: true, geladen: '' };
    if (o.dropinKaputt) { datei(w, '/etc/systemd/system/messd.service.d/kollege.conf', '# Kollege, 20.11.: eigener Benutzer für messd\n[Service]\nUser=messdienst\n'); datei(w, '/etc/systemd/system/multi-user.target.wants/messd.service', '-> /usr/lib/systemd/system/messd.service', 0o777); }
    neuLaden(w);
    if (o.dropinKaputt) unitStarten(w, 'messd.service');
  }
  if (o.fstabKaputt) w.fs['/etc/fstab'] = (w.fs['/etc/fstab'] ?? '') + '# Sicherungsplatte (Kollege)\nUUID=c4a1e9d2-7b3f-4e5a-9c8d-1f2e3a4b5c6d  /mnt/sicherung  ext4  defaults  0  2\n';
  if (o.fstabKaputt) ordner(w, '/mnt/sicherung');
  st.fstabGeladen = w.fs['/etc/fstab'] ?? ''; (w as { fstabStand?: string }).fstabStand = w.fs['/etc/fstab'] ?? undefined;
  if (o.rootVergessen && w.fs['/etc/shadow']) w.fs['/etc/shadow'] = w.fs['/etc/shadow'].replace(/^root:[^:]*:/m, 'root:$y$j9T$Hq0wIu4lFq3R1mN8$9ab8oD2uQW0zBc7XyE1kLmNpQrStUvWxYz0aBcDeFgH:');
  if (o.grub === 'cfgweg') delete w.fs['/boot/grub/grub.cfg'];
  if (o.efiWeg) { delete st.efi.e['0000']; st.efi.order = ['0001', '0002']; const fs = partFs(w, 'nvme0n1p1'); for (const k of Object.keys(w.fs)) if (k.startsWith('/boot/efi/EFI/debian')) delete w.fs[k]; if (fs) for (const k of Object.keys(fs.dateien)) if (k.startsWith('/EFI/debian')) delete fs.dateien[k]; }
  if (o.live) liveVorbereiten(w);
  if (o.pxe) {
    w.host = 'srv1';
    // Eingehängtes Installationsabbild von AlmaLinux 9 (Aufbau wie bei Red Hat)
    const iso: Record<string, string> = {
      'isolinux/isolinux.bin': '\u0007BIN:38912', 'isolinux/ldlinux.c32': '\u0007BIN:115832', 'isolinux/vesamenu.c32': '\u0007BIN:26956', 'isolinux/vmlinuz': '\u0007BIN:12582912', 'isolinux/initrd.img': '\u0007BIN:98566144',
      'isolinux/isolinux.cfg': 'default vesamenu.c32\ntimeout 600\n\nmenu title AlmaLinux 9.4\n\nlabel linux\n  menu label ^Install AlmaLinux 9.4\n  kernel vmlinuz\n  append initrd=initrd.img inst.stage2=hd:LABEL=AlmaLinux-9-4-x86_64-dvd quiet\n\nlabel rescue\n  menu label ^Rescue an AlmaLinux system\n  kernel vmlinuz\n  append initrd=initrd.img inst.stage2=hd:LABEL=AlmaLinux-9-4-x86_64-dvd inst.rescue quiet\n',
      'images/efiboot.img': '\u0007BIN:10485760', 'images/pxeboot/vmlinuz': '\u0007BIN:12582912', 'images/pxeboot/initrd.img': '\u0007BIN:98566144',
      'EFI/BOOT/BOOTX64.EFI': '\u0007BIN:946736', 'EFI/BOOT/grubx64.efi': '\u0007BIN:2541096', 'EFI/BOOT/grub.cfg': "set default=\"0\"\nset timeout=60\nsearch --no-floppy --set=root -l 'AlmaLinux-9-4-x86_64-dvd'\nmenuentry 'Install AlmaLinux 9.4' --class fedora --class gnu-linux --class gnu --class os {\n\tlinuxefi /images/pxeboot/vmlinuz inst.stage2=hd:LABEL=AlmaLinux-9-4-x86_64-dvd quiet\n\tinitrdefi /images/pxeboot/initrd.img\n}\n",
      '.discinfo': '1714484561.203735\nAlmaLinux 9.4\nx86_64\n',
    };
    for (const [k, v] of Object.entries(iso)) datei(w, `/srv/iso/${k}`, v, 0o444);
    datei(w, '/etc/dhcp/dhcpd.conf', '# /etc/dhcp/dhcpd.conf auf srv1\noption domain-name "labor.lan";\noption domain-name-servers 192.168.50.1;\ndefault-lease-time 600;\nmax-lease-time 7200;\nauthoritative;\n\n# Kennung der Rechnerart des Clients (RFC 4578)\noption arch code 93 = unsigned integer 16;\n\nsubnet 192.168.50.0 netmask 255.255.255.0 {\n  range 192.168.50.100 192.168.50.199;\n  option routers 192.168.50.1;\n  next-server 192.168.50.10;\n  # filename fehlt noch\n}\n');
    datei(w, '/usr/sbin/dhcpd', '\u0007BIN:1500000', 0o755);
    if (w.pakete) { w.pakete.installiert['isc-dhcp-server'] = 'ii'; }
  }
  if (o.aus) { w.aus = 'poweroff'; }
  if (o.pxeZuerst) st.efi.order = ['0001', '0000', '0002'];
}
function liveVorbereiten(w: Welt) {
  const st = ss(w);
  const root = partFs(w, 'nvme0n1p2')!; const esp = partFs(w, 'nvme0n1p1')!;
  root.dateien = {}; root.metas = {}; esp.dateien = {}; esp.metas = {};
  for (const [k, v] of Object.entries(w.fs)) {
    if (k === '/' || LAUFZEIT.test(k)) continue;
    if (k.startsWith('/boot/efi/')) { esp.dateien[k.slice(9)] = v; esp.metas[k.slice(9)] = { mode: 0o700, owner: 'root', group: 'root', mtime: w.uhr }; continue; }
    if (k === '/boot/efi') { root.dateien[k] = null; continue; }
    root.dateien[k] = v; root.metas[k] = { ...meta(w, k) };
  }
  for (const d of ['/proc', '/sys', '/dev', '/run', '/tmp', '/mnt', '/media']) root.dateien[d] = null;
  // Das Live-System selbst: ohne die Dateien des installierten Systems unter /boot/efi
  for (const k of Object.keys(w.fs)) if (k.startsWith('/boot/efi/')) delete w.fs[k];
  w.fs['/etc/hostname'] = 'debian\n'; w.host = 'debian';
  w.platten!.mounts = [{ quelle: '/dev/sda1', ziel: '/run/live/medium', art: 'vfat', optionen: 'ro,noatime', virtuell: true }, { quelle: 'overlay', ziel: '/', art: 'overlay', optionen: 'rw,noatime,lowerdir=/run/live/rootfs/filesystem.squashfs', virtuell: true }];
  ordner(w, '/run/live/medium');
  st.efi.current = '0002';
  for (const d of ['/sys/firmware/efi/efivars', '/dev/nvme0n1', '/proc/self']) if (!(d in w.fs)) ordner(w, d);
  w.fs['/dev/nvme0n1p1'] = ''; w.fs['/dev/nvme0n1p2'] = ''; w.fs['/dev/nvme0n1p3'] = ''; w.fs['/dev/sda1'] = '';
  if (w.fs['/dev/nvme0n1'] === null) w.fs['/dev/nvme0n1'] = '';
}

// ---------- Prüfen ----------

export function zustandStart(w: Welt, s: string): boolean | undefined {
  let m;
  if (!/^(rl|sysvlauf|unit|efi|startmodus|chroot|bind|gebootet|live|rootpw|iso)[:=~]/.test(s)) return undefined;
  if (!startAktiv(w)) return /^unit:/.test(s) ? undefined : false;
  const st = ss(w);
  if ((m = s.match(/^rl=(\w)$/))) return st.rl === m[1];
  if ((m = s.match(/^sysvlauf:(\w+)=(an|aus)$/))) return st.laeuft.includes(m[1]) === (m[2] === 'an');
  if ((m = s.match(/^unit:([\w.@-]+)=(aktiv|fehler|aus|enabled|disabled|masked|neugeladen)$/))) { const u = name(m[1]); const x = st.units[u]; if (m[2] === 'aktiv') return !!x?.aktiv; if (m[2] === 'fehler') return !!x?.fehler; if (m[2] === 'aus') return !x?.aktiv; if (m[2] === 'neugeladen') return !!x && x.geladen === wirksam(w, u); return aktiviert(w, u) === m[2]; }
  if ((m = s.match(/^efi:erster=(.+)$/))) return st.efi.e[st.efi.order[0]]?.name === m[1];
  if ((m = s.match(/^efi:next=(.+)$/))) return !!st.efi.next && st.efi.e[st.efi.next]?.name === m[1];
  if ((m = s.match(/^efi:eintrag~(.+)$/))) { const re = new RegExp(m[1]); return Object.values(st.efi.e).some((e) => re.test(`${e.name}\t${e.datei ?? ''}`)); }
  if ((m = s.match(/^efi:datei=(.+)$/))) return typeof espLesen(w, m[1]) === 'string';
  if ((m = s.match(/^startmodus=(bash|emergency|rescue|normal)$/))) return m[1] === 'normal' ? st.modus === null && !w.aus : st.modus === m[1];
  if ((m = s.match(/^iso:(.+)=(bios|uefi|hybrid)$/))) { const c = String(w.fs[K.pfad(w, m[1])] ?? ''); const p = c.match(/^\u0007ISO:(\w*):([^:]*):([^:]*):(\w*)$/); if (!p) return false; return m[2] === 'bios' ? !!p[2] : m[2] === 'uefi' ? !!p[3] : !!p[1] && !!p[2] && !!p[3] && !!p[4]; }
  if (s === 'chroot:drin') return st.chroot.length > 0;
  if ((m = s.match(/^bind:(.+)$/))) return st.binds.includes(m[1]);
  if ((m = s.match(/^gebootet~(.+)$/))) { const re = new RegExp(m[1]); return st.gebootet.some((g) => re.test(g)); }
  if (s === 'live:nein') return !st.live;
  if (s === 'rootpw:neu') return !/^root:\$y\$j9T\$Hq0wIu4lFq3R1mN8\$/m.test(w.fs['/etc/shadow'] ?? '');
  return undefined;
}

/** Nach apt: echte Konfigurationsdateien der Pakete für PXE */
export function startNachApt(w: Welt): void {
  if (!startAktiv(w) || !w.pakete) return;
  const t = w.fs['/etc/default/tftpd-hpa'];
  if (w.pakete.installiert['tftpd-hpa'] === 'ii' && (!t || t.startsWith('# /etc/default/tftpd-hpa aus'))) { datei(w, '/etc/default/tftpd-hpa', '# /etc/default/tftpd-hpa\n\nTFTP_USERNAME="tftp"\nTFTP_DIRECTORY="/srv/tftp"\nTFTP_ADDRESS=":69"\nTFTP_OPTIONS="--secure"\n'); ordner(w, '/srv/tftp'); }
  for (const p of Object.keys(w.fs)) if (/\.(0|c32|e64|bin|signed)$/.test(p) && w.fs[p] === '' && /^\/usr\/lib\/(PXELINUX|syslinux|ISOLINUX|shim|grub)\//.test(p)) w.fs[p] = '\u0007BIN:' + (40000 + p.length * 997);
}
