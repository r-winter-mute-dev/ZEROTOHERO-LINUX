// Grafische Oberfläche für den Simulator (Topic 106): X11 und Wayland, xhost, xauth, xdpyinfo,
// xwininfo, X -configure, gsettings für die Barrierefreiheit unter GNOME.
import type { Welt } from './shell';

type Ergebnis = { out: string; err?: string; code: number };
type B = (w: Welt, a: string[], stdin: string, root: boolean) => Ergebnis;
const ok = (out = ''): Ergebnis => ({ out, code: 0 });
const fehler = (err: string, code = 1): Ergebnis => ({ out: '', err, code });

export interface X11Stand { sitzung: 'x11' | 'wayland' | 'keine'; offen: boolean; hosts: string[]; gs: Record<string, string>; fenster: string[] }

// Voreinstellungen von GNOME 43 (Debian 12) für die Schlüssel, die der Kurs benutzt
const GS_START: Record<string, string> = {
  'org.gnome.desktop.a11y.keyboard enable': 'false',
  'org.gnome.desktop.a11y.keyboard stickykeys-enable': 'false',
  'org.gnome.desktop.a11y.keyboard stickykeys-two-key-off': 'true',
  'org.gnome.desktop.a11y.keyboard slowkeys-enable': 'false',
  'org.gnome.desktop.a11y.keyboard slowkeys-delay': '300',
  'org.gnome.desktop.a11y.keyboard bouncekeys-enable': 'false',
  'org.gnome.desktop.a11y.keyboard bouncekeys-delay': '300',
  'org.gnome.desktop.a11y.keyboard togglekeys-enable': 'false',
  'org.gnome.desktop.a11y.keyboard mousekeys-enable': 'false',
  'org.gnome.desktop.a11y.applications screen-reader-enabled': 'false',
  'org.gnome.desktop.a11y.applications screen-magnifier-enabled': 'false',
  'org.gnome.desktop.a11y.applications screen-keyboard-enabled': 'false',
  'org.gnome.desktop.a11y.interface high-contrast': 'false',
  'org.gnome.desktop.interface text-scaling-factor': '1.0',
  'org.gnome.desktop.interface cursor-size': '24',
  'org.gnome.desktop.peripherals.keyboard repeat': 'true',
  'org.gnome.desktop.peripherals.keyboard delay': 'uint32 500',
  'org.gnome.desktop.peripherals.keyboard repeat-interval': 'uint32 30',
  'org.gnome.desktop.a11y.magnifier mag-factor': '2.0',
};

export function x11(w: Welt): X11Stand {
  const x = w as Welt & { x11?: X11Stand };
  if (!x.x11) x.x11 = { sitzung: 'keine', offen: false, hosts: [], gs: { ...GS_START }, fenster: [] };
  return x.x11;
}

/** Eine grafische Sitzung einrichten (Welt-Option grafik). */
export function grafikStarten(w: Welt, art: 'x11' | 'wayland') {
  const x = x11(w); x.sitzung = art;
  w.env.DISPLAY = ':0';
  w.env.XDG_SESSION_TYPE = art;
  w.env.XDG_CURRENT_DESKTOP = 'GNOME';
  w.env.DESKTOP_SESSION = art === 'x11' ? 'gnome-xorg' : 'gnome';
  if (art === 'wayland') { w.env.WAYLAND_DISPLAY = 'wayland-0'; w.env.XAUTHORITY = '/run/user/1000/.mutter-Xwaylandauth.4KXQ32'; w.fs['/run/user'] = null; w.fs['/run/user/1000'] = null; w.fs['/run/user/1000/.mutter-Xwaylandauth.4KXQ32'] = '\u0007BIN:52'; }
  else {
    w.env.XAUTHORITY = '/home/lena/.Xauthority'; w.fs['/home/lena/.Xauthority'] = '\u0007BIN:52';
    w.fs['/home/lena/.xsession-errors'] = 'gnome-session-binary[1544]: WARNING: Could not parse desktop file orca-autostart.desktop or it references a not found TryExec binary\n(gnome-shell:1601): GLib-GIO-CRITICAL **: 08:12:31.004: g_settings_schema_source_lookup: assertion \'source != NULL\' failed\nxclock: Warning: Missing charsets in String to FontSet conversion\n';
    w.fs['/var/log/Xorg.0.log'] = '[    12.112] \nX.Org X Server 1.21.1.7\nX Protocol Version 11, Revision 0\n[    12.113] Current Operating System: Linux werkstatt 6.1.0-27-amd64 #1 SMP PREEMPT_DYNAMIC Debian 6.1.115-1 x86_64\n[    12.114] (==) Log file: "/var/log/Xorg.0.log", Time: Mon Nov 23 08:12:12 2026\n[    12.115] (==) Using config directory: "/etc/X11/xorg.conf.d"\n[    12.116] (==) Using system config directory "/usr/share/X11/xorg.conf.d"\n[    12.201] (II) LoadModule: "modesetting"\n[    12.202] (II) Loading /usr/lib/xorg/modules/drivers/modesetting_drv.so\n[    12.340] (II) modeset(0): Output HDMI-1 connected\n[    12.341] (II) modeset(0): Using exact sizes for initial modes\n[    12.342] (II) modeset(0): Output HDMI-1 using initial mode 1920x1080 +0+0\n[    12.512] (II) config/udev: Adding input device Logitech USB Receiver (/dev/input/event3)\n[    12.513] (**) Option "XkbLayout" "de"\n[    12.514] (WW) Option "XkbVariant" "nodeadkys" is not supported, using default\n';
  }
}

export function x11Dateien(fs: Record<string, string | null>) {
  Object.assign(fs, {
    '/etc/X11': null, '/etc/X11/xorg.conf.d': null, '/usr/share/X11': null, '/usr/share/X11/xorg.conf.d': null,
    '/etc/X11/xorg.conf.d/00-keyboard.conf': '# Written by systemd-localed(8), read by systemd-localed and Xorg. It\'s\n# probably wise not to edit this file manually. Use localectl(1) to\n# instruct systemd-localed to update it.\nSection "InputClass"\n        Identifier "system-keyboard"\n        MatchIsKeyboard "on"\n        Option "XkbLayout" "de"\n        Option "XkbVariant" "nodeadkeys"\nEndSection\n',
    '/usr/share/X11/xorg.conf.d/40-libinput.conf': '# Match on all types of devices but joysticks\nSection "InputClass"\n        Identifier "libinput pointer catchall"\n        MatchIsPointer "on"\n        MatchDevicePath "/dev/input/event*"\n        Driver "libinput"\nEndSection\n',
    '/etc/X11/default-display-manager': '/usr/sbin/gdm3\n',
    '/usr/share/xsessions': null, '/usr/share/wayland-sessions': null,
    '/usr/share/xsessions/gnome-xorg.desktop': '[Desktop Entry]\nName=GNOME on Xorg\nComment=This session logs you into GNOME\nExec=/usr/bin/gnome-session\nType=Application\nDesktopNames=GNOME\n',
    '/usr/share/wayland-sessions/gnome.desktop': '[Desktop Entry]\nName=GNOME\nComment=This session logs you into GNOME\nExec=/usr/bin/gnome-session\nType=Application\nDesktopNames=GNOME\n',
    '/etc/gdm3': null, '/etc/gdm3/daemon.conf': '# GDM configuration storage\n\n[daemon]\n# Uncomment the line below to force the login screen to use Xorg\n#WaylandEnable=false\n\n[security]\n\n[xdmcp]\n\n[chooser]\n\n[debug]\n',
  });
}

const XPROGRAMME: Record<string, string> = { xclock: 'xclock', xeyes: 'xeyes', xterm: 'xterm', xcalc: 'xcalc', 'gnome-calculator': 'Rechner', orca: 'Orca', onboard: 'Onboard' };

function anzeige(w: Welt, a: string[]): { name: string; fehler?: string } {
  const i = a.indexOf('-display'); const d = i >= 0 ? a[i + 1] ?? '' : (w.env.DISPLAY ?? '');
  if (d === '') return { name: '', fehler: 'leer' };
  if (d === ':0' && x11(w).sitzung !== 'keine') return { name: d };
  return { name: d, fehler: 'zu' };
}

export function x11Befehle(): Record<string, B> {
  const b: Record<string, B> = {};
  for (const [n, titel] of Object.entries(XPROGRAMME)) {
    b[n] = (w, a) => {
      const d = anzeige(w, a);
      if (d.fehler) return fehler(n === 'orca' || n === 'onboard' ? `${n}: Kann keine Verbindung zur Anzeige „${d.name}“ herstellen.` : `Error: Can't open display: ${d.name}`);
      x11(w).fenster.push(n);
      // Das Programm läuft weiter, bis sein Fenster zugeht: Vordergrund oder mit & im Hintergrund
      (w as Welt & { langlaeufer: string | null }).langlaeufer = n;
      return ok(`(${titel} zeigt ein Fenster auf der Anzeige ${d.name}${x11(w).sitzung === 'wayland' && !n.startsWith('gnome') ? ', über XWayland' : ''}.)`);
    };
  }
  b.xdpyinfo = (w, a) => {
    const d = anzeige(w, a);
    if (d.fehler) return fehler(`xdpyinfo:  unable to open display "${d.name}".`);
    return ok(`name of display:    ${d.name}\nversion number:    11.0\nvendor string:    The X.Org Foundation\nvendor release number:    12101007\nX.Org version: 21.1.7\nmaximum request size:  16777212 bytes\nmotion buffer size:  256\nbitmap unit, bit order, padding:    32, LSBFirst, 32\nimage byte order:    LSBFirst\nnumber of supported pixmap formats:    7\nkeycode range:    minimum 8, maximum 255\nfocus:  window 0x1e00006, revert to PointerRoot\nnumber of extensions:    26\ndefault screen number:    0\nnumber of screens:    1\n\nscreen #0:\n  dimensions:    1920x1080 pixels (508x285 millimeters)\n  resolution:    96x96 dots per inch\n  depths (7):    24, 1, 4, 8, 15, 16, 32\n  root window id:    0x3d5\n  depth of root window:    24 planes\n  number of colormaps:    minimum 1, maximum 1\n  default colormap:    0x22\n  default number of colormap cells:    256`);
  };
  b.xwininfo = (w, a) => {
    const d = anzeige(w, a);
    if (d.fehler) return fehler(`xwininfo: error: unable to open display "${d.name}"`);
    if (!a.includes('-root')) return ok('xwininfo: Please select the window about which you\n          would like information by clicking the\n          mouse in that window.\n(Im Simulator gibt es keine Maus. Nimm xwininfo -root für das Hauptfenster.)');
    return ok(`\nxwininfo: Window id: 0x3d5 (the root window) (has no name)\n\n  Absolute upper-left X:  0\n  Absolute upper-left Y:  0\n  Relative upper-left X:  0\n  Relative upper-left Y:  0\n  Width: 1920\n  Height: 1080\n  Depth: 24\n  Visual: 0x21\n  Visual Class: TrueColor\n  Border width: 0\n  Class: InputOutput\n  Colormap: 0x22 (installed)\n  Bit Gravity State: ForgetGravity\n  Window Gravity State: NorthWestGravity\n  Backing Store State: NotUseful\n  Save Under State: no\n  Map State: IsViewable\n  Override Redirect State: no\n  Corners:  +0+0  -0+0  -0-0  +0-0\n  -geometry 1920x1080+0+0\n`);
  };
  b.xhost = (w, a) => {
    const x = x11(w); const d = anzeige(w, []);
    if (d.fehler) return fehler(`xhost:  unable to open display "${d.name}"`);
    if (!a.length) return ok(`access control ${x.offen ? 'disabled, clients can connect from any host' : 'enabled, only authorized clients can connect'}\n${['SI:localuser:lena', ...x.hosts.map((h) => 'INET:' + h)].join('\n')}`);
    const out: string[] = [];
    for (const arg of a) {
      if (arg === '+') { x.offen = true; out.push('access control disabled, clients can connect from any host'); }
      else if (arg === '-') { x.offen = false; out.push('access control enabled, only authorized clients can connect'); }
      else if (arg.startsWith('-')) { const h = arg.slice(1); x.hosts = x.hosts.filter((y) => y !== h); out.push(`${h} being removed from access control list`); }
      else { const h = arg.replace(/^\+/, ''); if (!x.hosts.includes(h)) x.hosts.push(h); out.push(`${h} being added to access control list`); }
    }
    return ok(out.join('\n'));
  };
  b.xauth = (w, a) => {
    const x = x11(w); const datei = w.env.XAUTHORITY ?? '/home/lena/.Xauthority';
    if (x.sitzung === 'keine' || !(datei in w.fs)) return fehler(`xauth:  file ${datei} does not exist`);
    const eintrag = `werkstatt/unix:0  MIT-MAGIC-COOKIE-1  5f3c9a1e7b2d4c608e91a3f2b7c4d5e6`;
    const cmd = a[0] ?? 'list';
    if (cmd === 'list') return ok(eintrag);
    if (cmd === 'info') return ok(`Authority file:       ${datei}\nFile new:             no\nFile locked:          no\nNumber of entries:    1\nChanges honored:      yes\nChanges made:         no\nCurrent input:        (argv):1`);
    if (cmd === 'extract') return ok('(xauth extract schreibt den Eintrag binär in eine Datei. Auf dem anderen Rechner liest xauth merge ihn ein. ssh -X erledigt beides selbst.)');
    if (cmd === 'merge' || cmd === 'add') return ok();
    return fehler(`xauth: (argv):1:  unknown command "${cmd}"`);
  };
  const xserver: B = (w, a, _i, root) => {
    if (a.includes('-version')) return { out: '', err: '\nX.Org X Server 1.21.1.7\nX Protocol Version 11, Revision 0\nCurrent Operating System: Linux werkstatt 6.1.0-27-amd64 x86_64\nBuild Date: 25 October 2024  07:23:01AM\nxorg-server 2:21.1.7-3+deb12u8 (https://www.debian.org/support)', code: 0 };
    if (a.includes('-configure')) {
      if (!root) return fehler('(EE) \nFatal server error:\n(EE) Server is already active for display 0\n(EE) X -configure läuft nur als root und ohne laufenden X-Server, etwa im multi-user.target.', 1);
      w.fs['/root/xorg.conf.new'] = 'Section "ServerLayout"\n\tIdentifier     "X.org Configured"\n\tScreen      0  "Screen0" 0 0\n\tInputDevice    "Mouse0" "CorePointer"\n\tInputDevice    "Keyboard0" "CoreKeyboard"\nEndSection\n\nSection "Files"\n\tModulePath   "/usr/lib/xorg/modules"\n\tFontPath     "/usr/share/fonts/X11/misc"\nEndSection\n\nSection "Module"\n\tLoad  "glx"\nEndSection\n\nSection "InputDevice"\n\tIdentifier  "Keyboard0"\n\tDriver      "kbd"\nEndSection\n\nSection "InputDevice"\n\tIdentifier  "Mouse0"\n\tDriver      "mouse"\n\tOption\t    "Device" "/dev/input/mice"\nEndSection\n\nSection "Monitor"\n\tIdentifier   "Monitor0"\n\tVendorName   "Monitor Vendor"\nEndSection\n\nSection "Device"\n\tIdentifier  "Card0"\n\tDriver      "modesetting"\n\tBusID       "PCI:0:2:0"\nEndSection\n\nSection "Screen"\n\tIdentifier "Screen0"\n\tDevice     "Card0"\n\tMonitor    "Monitor0"\n\tSubSection "Display"\n\t\tDepth     24\n\tEndSubSection\nEndSection\n';
      return { out: '', err: '\nX.Org X Server 1.21.1.7\n(++) Using config file: "/root/xorg.conf.new"\n\nYour xorg.conf file is /root/xorg.conf.new\n\nTo test the server, run \'X -config /root/xorg.conf.new\'', code: 0 };
    }
    return fehler('(EE) \nFatal server error:\n(EE) Server is already active for display 0\n\tIf this server is no longer running, remove /tmp/.X0-lock\n\tand start again.');
  };
  b.X = xserver; b.Xorg = xserver;
  b.setxkbmap = (w, a) => {
    if (anzeige(w, []).fehler) return fehler('Cannot open display "default display"');
    if (a.includes('-query')) return ok(`rules:      evdev\nmodel:      pc105\nlayout:     ${(x11(w).gs['xkb layout'] ?? 'de')}\nvariant:    nodeadkeys`);
    const l = a.find((y) => !y.startsWith('-')); if (l) x11(w).gs['xkb layout'] = l;
    return ok(x11(w).sitzung === 'wayland' ? '(Unter Wayland wirkt setxkbmap nur auf X-Programme in XWayland. GNOME stellt das Layout in den Einstellungen ein.)' : '');
  };
  b.gsettings = (w, a) => {
    const x = x11(w);
    if (x.sitzung === 'keine') return fehler('(gsettings braucht eine laufende GNOME-Sitzung. Dieses System hat keine grafische Oberfläche.)');
    const [cmd, schema, key, ...rest] = a;
    const schemas = [...new Set(Object.keys(x.gs).filter((k) => k.startsWith('org.')).map((k) => k.split(' ')[0]))];
    if (cmd === 'list-schemas') return ok(schemas.sort().join('\n'));
    if (!schema) return fehler('Aufruf:\n  gsettings [--schemadir SCHEMADIR] BEFEHL [ARGUMENTE …]\n\nBefehle:\n  list-schemas, list-keys, list-recursively, get, set, reset', 1);
    if (!schemas.includes(schema)) return fehler(`Kein solches Schema »${schema}«`);
    if (cmd === 'list-keys') return ok(Object.keys(x.gs).filter((k) => k.startsWith(schema + ' ')).map((k) => k.split(' ')[1]).sort().join('\n'));
    if (cmd === 'list-recursively') return ok(Object.entries(x.gs).filter(([k]) => k.startsWith(schema + ' ')).sort().map(([k, v]) => `${k} ${v}`).join('\n'));
    const voll = `${schema} ${key}`;
    if (!key) return fehler('Schlüssel fehlt');
    if (!(voll in x.gs)) return fehler(`Kein solcher Schlüssel »${key}«`);
    if (cmd === 'get') return ok(x.gs[voll]);
    if (cmd === 'reset') { x.gs[voll] = GS_START[voll]; return ok(); }
    if (cmd === 'set') {
      const v = rest.join(' '); const alt = GS_START[voll];
      if (alt === 'true' || alt === 'false') { if (v !== 'true' && v !== 'false') return fehler(`0-${v.length}:Unbekanntes Schlüsselwort ${v}`); x.gs[voll] = v; return ok(); }
      if (alt.startsWith('uint32')) { if (!/^\d+$/.test(v)) return fehler('0-1:Ungültige Zahl'); x.gs[voll] = 'uint32 ' + v; return ok(); }
      if (!/^\d+(\.\d+)?$/.test(v)) return fehler('0-1:Ungültige Zahl');
      x.gs[voll] = alt.includes('.') && !v.includes('.') ? v + '.0' : v; return ok();
    }
    return fehler(`Unbekannter Befehl ${cmd}`);
  };
  return b;
}

export function zustandX11(w: Welt, s: string): boolean | undefined {
  const x = x11(w); let m;
  if (s === 'xhost:offen') return x.offen;
  if (s === 'xhost:zu') return !x.offen;
  if ((m = s.match(/^xhost:\+(\S+)$/))) return x.hosts.includes(m[1]);
  if ((m = s.match(/^gsetting:(\S+) (\S+)=(.+)$/))) return x.gs[`${m[1]} ${m[2]}`] === m[3];
  if ((m = s.match(/^fenster:(\S+)$/))) return x.fenster.includes(m[1]);
  return undefined;
}
