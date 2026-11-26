// Systemwartung (LPIC-2 Topic 206): ein Programm aus dem Quellcode bauen (configure, make, make install,
// make check, make uninstall, DESTDIR, install), Datensicherung mit tar (inkrementell mit -g, Vergleich mit -d,
// --exclude), Bandlaufwerke /dev/st0 und /dev/nst0 mit mt, rsync lokal und zu srv1, Anmeldemeldungen
// (/etc/issue mit agetty --show-issue, /etc/issue.net, /etc/motd, /etc/update-motd.d) und /run/nologin.
// Ohne Welt-Option `wartung` bleibt alles wie bisher. Nur install gibt es immer, wie auf jedem Debian (coreutils).
import type { Welt } from './shell';
import { BIN, KOMP, TAR, darf, darfImOrdner, groesse, meta, neuMeta, sha256 } from './shell-dateien';

type Ergebnis = { out: string; err?: string; code: number; errNach?: boolean };
type B = (w: Welt, a: string[], stdin: string, root: boolean) => Ergebnis;
const ok = (out = ''): Ergebnis => ({ out, code: 0 });
const fehler = (err: string, code = 1): Ergebnis => ({ out: '', err, code });

export interface WartungOptionen {
  quelle?: 'download' | 'entpackt';   // download: Tarball in ~/downloads, entpackt: Baum in ~/quellen/lagerist-2.4.1
  werkzeuge?: boolean;                // build-essential, patch und libncurses-dev sind installiert (sonst fehlen gcc, make und patch wie auf einem frischen Debian)
  patch?: boolean;                    // ~/quellen/lagerist-2.4.1-csv.patch liegt bereit
  sicherung?: boolean;                // /srv/lager mit Daten, /mnt/backup als Sicherungsplatte
  band?: 'leer' | 'nacht';            // Bandlaufwerk mit Kassette; nacht: das Skript der letzten Nacht hat nur /srv übrig gelassen
  fern?: boolean;                     // srv1 mit /sicherung/lager, per rsync über SSH erreichbar
}
interface Bau { konf: null | { args: string }; objekte: Record<string, string>; tests?: 'ok' | 'fehler' }
interface Band { geladen: boolean; dateien: string[]; pos: number; amEnde: boolean; gelesen?: number }
interface WtStand {
  opt: WartungOptionen;
  bauten: Record<string, Bau>;
  installiert: Record<string, { dateien: string[]; csv: boolean; tui: boolean }>;   // Schlüssel: DESTDIR + prefix
  staging: string[];
  band: Band | null;
  archive: Record<string, { inkrementell: boolean }>;
  fern: Record<string, string | null>;
  fernMeta: Record<string, number>;
}
type WT = Welt & { wartung?: WtStand };
const wt = (w: Welt) => (w as WT).wartung!;
export const wartungAktiv = (w: Welt) => !!(w as WT).wartung;

let K: { pfad: (w: Welt, p: string) => string; installieren: (w: Welt, namen: string[]) => void; zeile: (w: Welt, z: string, stdin: string, root: boolean) => { out: string; err?: string; code: number } };
export function wartungKern(k: typeof K) { K = k; }

const hat = (w: Welt, p: string) => typeof w.fs[p] === 'string';
function ordner(w: Welt, p: string, owner = 'root') {
  const teile = p.split('/').filter(Boolean);
  for (let i = 1; i <= teile.length; i++) { const d = '/' + teile.slice(0, i).join('/'); if (!(d in w.fs)) { w.fs[d] = null; const m = meta(w, d); m.mode = 0o755; m.owner = owner; m.group = owner; m.mtime = w.uhr; } }
}
function datei(w: Welt, p: string, c: string, mode = 0o644, owner = 'root', group = owner) {
  ordner(w, p.slice(0, p.lastIndexOf('/')) || '/', owner === 'lena' && p.startsWith('/home/lena') ? 'lena' : 'root');
  w.fs[p] = c; const m = meta(w, p); m.mode = mode; m.owner = owner; m.group = group; m.mtime = w.uhr;
}
const eltern = (p: string) => p.slice(0, p.lastIndexOf('/')) || '/';
const name = (p: string) => p.slice(p.lastIndexOf('/') + 1);

// ======================= Das Programm lagerist =======================

const VERSION = '2.4.1';
const QDIR = 'lagerist-' + VERSION;
const EXPORT_ALT = `/* export.c - Bestand als CSV ausgeben */
#include <stdio.h>
#include "lagerist.h"

/* Ein Feld der CSV-Datei schreiben */
static void feld(FILE *out, const char *text)
{
\tfputs(text, out);
}

void export_csv(FILE *out, const struct artikel *liste, size_t n)
{
\tfputs("nummer,bezeichnung,menge\\n", out);
\tfor (size_t i = 0; i < n; i++) {
\t\tfprintf(out, "%s,", liste[i].nummer);
\t\tfeld(out, liste[i].bezeichnung);
\t\tfprintf(out, ",%d\\n", liste[i].menge);
\t}
}
`;
export const CSV_PATCH = `From 3e1f0a94c2d7 Mon Sep 17 00:00:00 2001
From: Jana Weber <jana@lagerist.example.org>
Date: Thu, 19 Nov 2026 14:02:11 +0100
Subject: [PATCH] export: Felder mit Komma in Anfuehrungszeichen setzen

Bezeichnungen wie "Unterlegscheibe 6,4 mm" zerlegen die CSV-Datei in
zu viele Spalten. Felder werden jetzt nach RFC 4180 maskiert.

---
 src/export.c | 16 ++++++++++++++--
 1 file changed, 14 insertions(+), 2 deletions(-)

diff --git a/src/export.c b/src/export.c
index 5b1c2e7..9a0f3d4 100644
--- a/src/export.c
+++ b/src/export.c
@@ -1,11 +1,23 @@
 /* export.c - Bestand als CSV ausgeben */
 #include <stdio.h>
+#include <string.h>
 #include "lagerist.h"
 
-/* Ein Feld der CSV-Datei schreiben */
+/* Ein Feld der CSV-Datei schreiben, nach RFC 4180 in Anführungszeichen,
+   wenn es ein Komma, ein Anführungszeichen oder einen Zeilenumbruch enthält */
 static void feld(FILE *out, const char *text)
 {
-\tfputs(text, out);
+\tif (!strpbrk(text, ",\\"\\n")) {
+\t\tfputs(text, out);
+\t\treturn;
+\t}
+\tputc('"', out);
+\tfor (const char *p = text; *p; p++) {
+\t\tif (*p == '"')
+\t\t\tputc('"', out);
+\t\tputc(*p, out);
+\t}
+\tputc('"', out);
 }
 
 void export_csv(FILE *out, const struct artikel *liste, size_t n)
--
2.39.5
 `;
const csvRepariert = (quelltext: string) => quelltext.includes('strpbrk');

const CONFIGURE = `#! /bin/sh
# Guess values for system-dependent variables and create Makefiles.
# Generated by GNU Autoconf 2.71 for lagerist ${VERSION}.
#
# Report bugs to <bugs@lagerist.example.org>.
#
# Copyright (C) 1992-1996, 1998-2017, 2020-2021 Free Software Foundation,
# Inc.
#
# This configure script is free software; the Free Software Foundation
# gives unlimited permission to copy, distribute and modify it.
## -------------------- ##
## M4sh Initialization. ##
## -------------------- ##
# (… etwa 6000 weitere Zeilen, erzeugt von autoconf aus configure.ac …)
`;
const MARKE_CONFIGURE = `Generated by GNU Autoconf 2.71 for lagerist ${VERSION}.`;
const MARKE_MAKEFILE = '# Makefile.  Generated from Makefile.in by configure.';
const MARKE_PROGRAMM = '\u0000LAGERIST:';

const README = `lagerist ${VERSION}
==============

lagerist verwaltet den Bestand eines kleinen Lagers: Artikel, Mengen,
Lieferanten. Er läuft im Terminal (ncurses) und exportiert den Bestand
als CSV.

Bauen und installieren: siehe INSTALL. Kurz:

    ./configure
    make
    make check
    sudo make install

Ohne Terminal-Oberfläche (keine ncurses nötig):

    ./configure --without-tui

Fehler bitte an bugs@lagerist.example.org.
`;
const INSTALL = `Installation von lagerist
=========================

Voraussetzungen: ein C-Compiler (gcc), make und für die Terminal-
Oberfläche die Entwicklerdateien von ncursesw (Debian: libncurses-dev,
Red Hat: ncurses-devel).

Die übliche Reihenfolge der GNU-Werkzeuge:

  1. ./configure          prüft das System und schreibt das Makefile
  2. make                 übersetzt die Quellen
  3. make check           führt die Tests aus
  4. make install         kopiert Programm, Handbuchseite und
                          Konfiguration nach PREFIX (Standard /usr/local)

Wichtige Optionen von configure (alle: ./configure --help):

  --prefix=PREFIX         Installationsziel, Standard /usr/local
  --sysconfdir=DIR        Ort der Konfiguration, Standard PREFIX/etc
  --without-tui           ohne Terminal-Oberfläche bauen

Wieder entfernen: make uninstall (im selben, konfigurierten Baum).
Für Pakete: make DESTDIR=/tmp/stage install installiert in einen
Zwischenordner.
`;
const NEWS = `Neu in 2.4.1
------------
* Export als CSV: lagerist export --csv
* Bekannt: Bezeichnungen mit Komma werden im CSV nicht maskiert.

Neu in 2.4.0
------------
* Terminal-Oberfläche mit ncursesw
`;
const MAKEFILE_IN = `# Makefile.in generated by automake 1.16.5 from Makefile.am.
# @configure_input@

PACKAGE = @PACKAGE@
VERSION = @VERSION@
prefix = @prefix@
exec_prefix = @exec_prefix@
bindir = @bindir@
sysconfdir = @sysconfdir@
datarootdir = @datarootdir@
mandir = @mandir@
CC = @CC@
CFLAGS = @CFLAGS@
LIBS = @LIBS@
ENABLE_TUI = @ENABLE_TUI@
# (… gekürzt …)
`;
const DATEN = [
  { nummer: '10017', bez: 'Unterlegscheibe 6,4 mm', menge: 1200 },
  { nummer: '10023', bez: 'Schraube M6x20', menge: 500 },
  { nummer: '10031', bez: 'Mutter M6', menge: 800 },
  { nummer: '10044', bez: 'Dübel 8x40 "grau"', menge: 150 },
];
function csvZeilen(fix: boolean): string[] {
  const feld = (t: string) => (!fix || !/[,"\n]/.test(t) ? t : '"' + t.replace(/"/g, '""') + '"');
  return ['nummer,bezeichnung,menge', ...DATEN.map((d) => `${d.nummer},${feld(d.bez)},${d.menge}`)];
}

function quellbaum(): { p: string; c: string | null; m: number }[] {
  const d = (p: string) => ({ p: `${QDIR}/${p}`.replace(/\/$/, '') + '/', c: null, m: 0o755 });
  const f = (p: string, c: string, m = 0o644) => ({ p: `${QDIR}/${p}`, c, m });
  return [
    { p: QDIR + '/', c: null, m: 0o755 },
    f('AUTHORS', 'Jana Weber <jana@lagerist.example.org>\nTom Krüger <tom@lagerist.example.org>\n'),
    f('COPYING', '                    GNU GENERAL PUBLIC LICENSE\n                       Version 3, 29 June 2007\n\n (… vollständiger Text der GPL-3.0 …)\n'),
    f('ChangeLog', '2026-10-30  Jana Weber  <jana@lagerist.example.org>\n\n\t* Version 2.4.1.\n\t* src/export.c: Neuer CSV-Export.\n'),
    f('INSTALL', INSTALL), f('NEWS', NEWS), f('README', README),
    f('Makefile.am', 'bin_PROGRAMS = src/lagerist\nsrc_lagerist_SOURCES = src/main.c src/export.c src/tui.c src/lagerist.h\ndist_man1_MANS = doc/lagerist.1\nsysconf_DATA = lagerist.conf\nTESTS = tests/lager.sh tests/export.sh tests/csv.sh\n'),
    f('Makefile.in', MAKEFILE_IN),
    f('aclocal.m4', '# generated automatically by aclocal 1.16.5 -*- Autoconf -*-\n'),
    f('config.h.in', '/* config.h.in.  Generated from configure.ac by autoheader.  */\n#undef HAVE_NCURSESW\n#undef PACKAGE_VERSION\n'),
    f('configure', CONFIGURE, 0o755),
    f('configure.ac', `AC_INIT([lagerist], [${VERSION}], [bugs@lagerist.example.org])\nAM_INIT_AUTOMAKE([foreign subdir-objects silent-rules])\nAM_SILENT_RULES([yes])\nAC_PROG_CC\nAC_ARG_WITH([tui], [AS_HELP_STRING([--without-tui], [ohne Terminal-Oberfläche bauen])], [], [with_tui=yes])\nAS_IF([test "x$with_tui" != xno], [AC_CHECK_LIB([ncursesw], [initscr], [], [AC_MSG_ERROR([libncursesw not found. ...])])])\nAC_CONFIG_HEADERS([config.h])\nAC_CONFIG_FILES([Makefile lagerist.conf])\nAC_OUTPUT\n`),
    f('lagerist.conf.in', '# Konfiguration von lagerist\ndatenbank = /var/lib/lagerist/lager.db\nwaehrung = EUR\n'),
    d('doc/'), f('doc/lagerist.1', '.TH LAGERIST 1 "Oktober 2026" "lagerist 2.4.1"\n.SH NAME\nlagerist \\- Lagerbestand im Terminal verwalten\n.SH SYNOPSIS\n.B lagerist\n[\\fBlist\\fR | \\fBexport --csv\\fR]\n'),
    d('src/'),
    f('src/lagerist.h', '#ifndef LAGERIST_H\n#define LAGERIST_H\n#include <stddef.h>\n#include <stdio.h>\n\nstruct artikel {\n\tconst char *nummer;\n\tconst char *bezeichnung;\n\tint menge;\n};\n\nvoid export_csv(FILE *out, const struct artikel *liste, size_t n);\nint tui_start(void);\n\n#endif\n'),
    f('src/main.c', '/* main.c - lagerist */\n#include "config.h"\n#include <stdio.h>\n#include <string.h>\n#include "lagerist.h"\n\nint main(int argc, char **argv)\n{\n\t/* (gekürzt) */\n\treturn 0;\n}\n'),
    f('src/export.c', EXPORT_ALT),
    f('src/tui.c', '/* tui.c - Terminal-Oberfläche mit ncursesw */\n#include "config.h"\n#include <ncurses.h>\n#include "lagerist.h"\n\nint tui_start(void)\n{\n\tinitscr();\n\t/* (gekürzt) */\n\tendwin();\n\treturn 0;\n}\n'),
    d('tests/'),
    f('tests/lager.sh', '#!/bin/sh\n# Bestand lässt sich auflisten\n./src/lagerist list >/dev/null\n', 0o755),
    f('tests/export.sh', '#!/bin/sh\n# Export beginnt mit der Kopfzeile\n./src/lagerist export --csv | head -1 | grep -qx "nummer,bezeichnung,menge"\n', 0o755),
    f('tests/csv.sh', '#!/bin/sh\n# Jede Zeile des CSV hat genau drei Felder (Felder mit Komma stehen in Anführungszeichen)\n./src/lagerist export --csv | python3 -c \'import csv,sys; sys.exit(any(len(r) != 3 for r in csv.reader(sys.stdin)))\'\n', 0o755),
  ];
}
const tarball = () => `${KOMP}gz:${TAR}${JSON.stringify(quellbaum())}`;

// ---------- Makefile-Variablen ----------
interface Konf { prefix: string; exec_prefix: string; bindir: string; sysconfdir: string; datarootdir: string; mandir: string; CC: string; CFLAGS: string; LIBS: string; ENABLE_TUI: string; DESTDIR: string; V: string }
function makefileText(k: Record<string, string>, args: string): string {
  return `${MARKE_MAKEFILE}
# Makefile.in generated by automake 1.16.5 from Makefile.am.
# ${args ? `configure wurde aufgerufen mit: ${args}` : 'configure wurde ohne Optionen aufgerufen'}

PACKAGE = lagerist
VERSION = ${VERSION}
prefix = ${k.prefix}
exec_prefix = ${k.exec_prefix}
bindir = ${k.bindir}
sysconfdir = ${k.sysconfdir}
datarootdir = ${k.datarootdir}
mandir = ${k.mandir}
CC = ${k.CC}
CFLAGS = ${k.CFLAGS}
LIBS = ${k.LIBS}
ENABLE_TUI = ${k.ENABLE_TUI}
DESTDIR =

bin_PROGRAMS = src/lagerist
TESTS = tests/lager.sh tests/export.sh tests/csv.sh

all: all-am
install: install-am
uninstall: uninstall-am
check: check-am
clean: clean-am
distclean: distclean-am
# (… etwa 1200 weitere Zeilen, erzeugt von automake …)
`;
}
function makefileLesen(text: string, extra: Record<string, string>): Konf {
  const roh: Record<string, string> = {};
  for (const z of text.split('\n')) { const m = z.match(/^([A-Za-z_]\w*)\s*=\s*(.*)$/); if (m) roh[m[1]] = m[2].trim(); }
  Object.assign(roh, extra);
  const aufl = (v: string, tiefe = 0): string => tiefe > 10 ? v : v.replace(/\$[{(](\w+)[})]/g, (_, n) => aufl(roh[n] ?? '', tiefe + 1));
  const g = (n: string, std = '') => aufl(roh[n] ?? std);
  return { prefix: g('prefix', '/usr/local'), exec_prefix: g('exec_prefix'), bindir: g('bindir'), sysconfdir: g('sysconfdir'), datarootdir: g('datarootdir'), mandir: g('mandir'), CC: g('CC', 'gcc'), CFLAGS: g('CFLAGS'), LIBS: g('LIBS'), ENABLE_TUI: g('ENABLE_TUI'), DESTDIR: g('DESTDIR'), V: g('V', '0') };
}

// ---------- configure ----------
const CONFIGURE_HILFE = `\`configure' configures lagerist ${VERSION} to adapt to many kinds of systems.

Usage: ./configure [OPTION]... [VAR=VALUE]...

To assign environment variables (e.g., CC, CFLAGS...), specify them as
VAR=VALUE.  See below for descriptions of some of the useful variables.

Defaults for the options are specified in brackets.

Configuration:
  -h, --help              display this help and exit
  -V, --version           display version information and exit
  -q, --quiet, --silent   do not print \`checking ...' messages
  -C, --config-cache      alias for \`--cache-file=config.cache'
  -n, --no-create         do not create output files

Installation directories:
  --prefix=PREFIX         install architecture-independent files in PREFIX
                          [/usr/local]
  --exec-prefix=EPREFIX   install architecture-dependent files in EPREFIX
                          [PREFIX]

By default, \`make install' will install all the files in
\`/usr/local/bin', \`/usr/local/lib' etc.  You can specify
an installation prefix other than \`/usr/local' using \`--prefix',
for instance \`--prefix=$HOME'.

For better control, use the options below.

Fine tuning of the installation directories:
  --bindir=DIR            user executables [EPREFIX/bin]
  --sbindir=DIR           system admin executables [EPREFIX/sbin]
  --sysconfdir=DIR        read-only single-machine data [PREFIX/etc]
  --localstatedir=DIR     modifiable single-machine data [PREFIX/var]
  --libdir=DIR            object code libraries [EPREFIX/lib]
  --includedir=DIR        C header files [PREFIX/include]
  --datarootdir=DIR       read-only arch.-independent data root [PREFIX/share]
  --mandir=DIR            man documentation [DATAROOTDIR/man]
  --docdir=DIR            documentation root [DATAROOTDIR/doc/lagerist]

Program names:
  --program-prefix=PREFIX            prepend PREFIX to installed program names
  --program-suffix=SUFFIX            append SUFFIX to installed program names

Optional Features:
  --disable-option-checking  ignore unrecognized --enable/--with options
  --enable-silent-rules   less verbose build output (undo: "make V=1")
  --disable-silent-rules  verbose build output (undo: "make V=0")

Optional Packages:
  --with-PACKAGE[=ARG]    use PACKAGE [ARG=yes]
  --without-PACKAGE       do not use PACKAGE (same as --with-PACKAGE=no)
  --without-tui           ohne Terminal-Oberfläche bauen (keine ncurses nötig)

Some influential environment variables:
  CC          C compiler command
  CFLAGS      C compiler flags
  LDFLAGS     linker flags, e.g. -L<lib dir> if you have libraries in a
              nonstandard directory <lib dir>
  LIBS        libraries to pass to the linker, e.g. -l<library>
  CPPFLAGS    (Objective) C/C++ preprocessor flags, e.g. -I<include dir> if
              you have headers in a nonstandard directory <include dir>

Use these variables to override the choices made by \`configure' or to help
it to find libraries and programs with nonstandard names/locations.

Report bugs to <bugs@lagerist.example.org>.`;

const PRUEF_ANFANG = [
  'checking for a BSD-compatible install... /usr/bin/install -c',
  'checking whether build environment is sane... yes',
  'checking for a race-free mkdir -p... /usr/bin/mkdir -p',
  'checking for gawk... no',
  'checking for mawk... mawk',
  'checking whether make sets $(MAKE)... yes',
  'checking whether make supports nested variables... yes',
  'checking whether make supports nested variables... (cached) yes',
  'checking whether make supports the include directive... yes (GNU style)',
];
const PRUEF_CC = [
  'checking whether the C compiler works... yes',
  'checking for C compiler default output file name... a.out',
  'checking for suffix of executables... ',
  'checking whether we are cross compiling... no',
  'checking for suffix of object files... o',
  'checking whether the compiler supports GNU C... yes',
  'checking whether gcc accepts -g... yes',
  'checking for gcc option to enable C11 features... none needed',
  'checking whether gcc understands -c and -o together... yes',
  'checking dependency style of gcc... gcc3',
];

function konfigurieren(w: Welt, dir: string, name0: string, args: string[], root: boolean): Ergebnis {
  if (args.some((x) => x === '--help' || x === '-h' || x === '--help=short')) return ok(CONFIGURE_HILFE);
  if (args.some((x) => x === '--version' || x === '-V')) return ok(`lagerist configure ${VERSION}\ngenerated by GNU Autoconf 2.71\n\nCopyright (C) 2021 Free Software Foundation, Inc.\nThis configure script is free software; the Free Software Foundation\ngives unlimited permission to copy, distribute and modify it.`);
  const v: Record<string, string> = { prefix: '/usr/local', exec_prefix: '${prefix}', bindir: '${exec_prefix}/bin', sysconfdir: '${prefix}/etc', datarootdir: '${prefix}/share', mandir: '${datarootdir}/man', CC: 'gcc', CFLAGS: '-g -O2', LIBS: '' };
  let tui = true; const unbekannt: string[] = []; let leise = false;
  const DIRS = ['prefix', 'exec-prefix', 'bindir', 'sbindir', 'sysconfdir', 'localstatedir', 'libdir', 'includedir', 'datarootdir', 'datadir', 'mandir', 'docdir', 'program-prefix', 'program-suffix', 'cache-file', 'build', 'host', 'target'];
  for (let i = 0; i < args.length; i++) {
    const x = args[i]; let m;
    if ((m = x.match(/^--([a-z-]+)=(.*)$/)) && DIRS.includes(m[1])) { v[m[1].replace('-', '_')] = m[2]; continue; }
    if ((m = x.match(/^--([a-z-]+)$/)) && DIRS.includes(m[1])) { const n = args[++i]; if (n === undefined) return fehler(`configure: error: missing argument to --${m[1]}`); v[m[1].replace('-', '_')] = n; continue; }
    if (x === '--without-tui' || x === '--with-tui=no' || x === '--disable-tui') { tui = false; continue; }
    if (x === '--with-tui' || x === '--with-tui=yes' || x === '--enable-tui') { tui = true; continue; }
    if (x === '-q' || x === '--quiet' || x === '--silent') { leise = true; continue; }
    if (/^--(enable|disable)-(silent-rules|dependency-tracking|option-checking)$/.test(x) || x === '-C' || x === '--config-cache') continue;
    if (/^--(enable|disable|with|without)-[\w-]+(=.*)?$/.test(x)) { unbekannt.push(x.replace(/=.*$/, '')); continue; }
    if ((m = x.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/))) { v[m[1]] = m[2]; continue; }
    if (x.startsWith('-')) return fehler(`configure: error: unrecognized option: \`${x}'\nTry \`${name0} --help' for more information`);
    return fehler(`configure: error: invalid variable name: \`${x}'`);
  }
  for (const n of ['prefix', 'exec_prefix', 'bindir', 'sysconfdir', 'mandir', 'datarootdir']) {
    const val = v[n]; if (!val.startsWith('/') && !val.startsWith('$')) return fehler(`configure: error: expected an absolute directory name for --${n.replace('_', '-')}: ${val}`);
  }
  if (!darf(w, dir, 'w', root)) return fehler(`${name0}: Zeile 1628: config.log: Keine Berechtigung`);
  const kurz = (s: string) => (leise ? [] : [s]);
  const out: string[] = []; for (const z of PRUEF_ANFANG) out.push(...kurz(z));
  const cc = v.CC; const ccDa = cc === 'gcc' ? hat(w, '/usr/bin/gcc') : cc === 'cc' ? hat(w, '/usr/bin/cc') : hat(w, K.pfad(w, cc));
  const cmdline = args.map((x) => (/^[\w./=+:,@-]+$/.test(x) ? x : `'${x}'`)).join(' ');
  const logKopf = `This file contains any messages produced by compilers while\nrunning configure, to aid debugging if configure makes a mistake.\n\nIt was created by lagerist configure ${VERSION}, which was\ngenerated by GNU Autoconf 2.71.  Invocation command line was\n\n  $ ${name0}${cmdline ? ' ' + cmdline : ''}\n\n## --------- ##\n## Platform. ##\n## --------- ##\n\nhostname = ${w.host}\nuname -m = x86_64\nuname -r = ${w.kernel}\nuname -s = Linux\n\n`;
  const log = (rest: string) => { w.fs[`${dir}/config.log`] = logKopf + rest; neuMeta(w, `${dir}/config.log`, root, false); };
  if (!ccDa) {
    out.push(...kurz(`checking for ${cc}... no`), ...(cc === 'gcc' ? kurz('checking for cc... no').concat(kurz('checking for cl.exe... no'), kurz('checking for clang... no')) : []));
    const e = `configure: error: in \`${dir}':\nconfigure: error: no acceptable C compiler found in $PATH\nSee \`config.log' for more details`;
    log(`configure:3612: checking for gcc\nconfigure:3645: result: no\nconfigure:3964: error: in \`${dir}':\nconfigure:3966: error: no acceptable C compiler found in $PATH\n`);
    return { out: out.join('\n'), err: e, code: 1, errNach: true };
  }
  out.push(...kurz(`checking for ${cc}... ${cc}`), ...PRUEF_CC.flatMap((z) => kurz(z.replace(/gcc/g, cc.split('/').pop()!))));
  if (tui) {
    const da = hat(w, '/usr/include/ncurses.h');
    out.push(...kurz(`checking for initscr in -lncursesw... ${da ? 'yes' : 'no'}`));
    if (!da) {
      log(`configure:4410: checking for initscr in -lncursesw\nconfigure:4433: gcc -o conftest -g -O2   conftest.c -lncursesw   >&5\n/usr/bin/ld: cannot find -lncursesw: No such file or directory\ncollect2: error: ld returned 1 exit status\nconfigure:4433: $? = 1\nconfigure:4443: result: no\nconfigure:4452: error: libncursesw not found. Install the ncurses development files (Debian: libncurses-dev, Red Hat: ncurses-devel) or run configure with --without-tui.\n`);
      return { out: out.join('\n'), err: 'configure: error: libncursesw not found. Install the ncurses development files (Debian: libncurses-dev, Red Hat: ncurses-devel) or run configure with --without-tui.', code: 1, errNach: true };
    }
    v.LIBS = '-lncursesw';
  }
  out.push(...kurz('checking that generated files are newer than configure... done'), ...kurz('configure: creating ./config.status'), ...kurz('config.status: creating Makefile'), ...kurz('config.status: creating lagerist.conf'), ...kurz('config.status: creating config.h'), ...kurz('config.status: executing depfiles commands'));
  if (unbekannt.length) out.push(`configure: WARNING: unrecognized options: ${unbekannt.join(', ')}`);
  const k: Record<string, string> = { ...v, ENABLE_TUI: tui ? '1' : '0' };
  const echt = makefileLesen(makefileText(k, cmdline), {});
  if (!leise) out.push('', `  lagerist ${VERSION}`, `  prefix ........... ${echt.prefix}`, `  bindir ........... ${echt.bindir}`, `  sysconfdir ....... ${echt.sysconfdir}`, `  Terminal-UI ...... ${tui ? 'yes (ncursesw)' : 'no'}`, '', "  Now type 'make' to build lagerist.");
  const schreib = (p: string, c: string, mode = 0o644) => { w.fs[`${dir}/${p}`] = c; neuMeta(w, `${dir}/${p}`, root, false); meta(w, `${dir}/${p}`).mode = mode; };
  log(`configure:3612: checking for gcc\nconfigure:3645: result: gcc\n${tui ? 'configure:4443: result: yes\n' : ''}configure:5120: creating ./config.status\n\n## ---------------- ##\n## Output variables. ##\n## ---------------- ##\n\nprefix='${v.prefix}'\nsysconfdir='${v.sysconfdir}'\nLIBS='${v.LIBS}'\n\nconfigure: exit 0\n`);
  schreib('config.status', `#! /bin/sh\n# Generated by configure.\n# Run this file to recreate the current configuration.\n# Compiler output produced by configure, useful for debugging\n# configure, is in config.log if it exists.\n\nac_cs_config="${cmdline.replace(/"/g, '\\"')}"\n`, 0o755);
  schreib('config.h', `/* config.h.  Generated from config.h.in by configure.  */\n${tui ? '#define HAVE_NCURSESW 1' : '/* #undef HAVE_NCURSESW */'}\n#define PACKAGE_VERSION "${VERSION}"\n#define SYSCONFDIR "${echt.sysconfdir}"\n`);
  schreib('Makefile', makefileText(k, cmdline));
  schreib('lagerist.conf', `# Konfiguration von lagerist (erzeugt von configure)\ndatenbank = /var/lib/lagerist/lager.db\nwaehrung = EUR\n`);
  const b = (wt(w).bauten[dir] ??= { konf: null, objekte: {} }); b.konf = { args: cmdline }; b.objekte = {}; b.tests = undefined;
  return ok(out.join('\n'));
}

// ---------- make ----------
const QUELLEN = ['src/main.c', 'src/export.c', 'src/tui.c'];
function istLagerMakefile(t: string | null | undefined) { return typeof t === 'string' && t.startsWith(MARKE_MAKEFILE) && /^PACKAGE = lagerist$/m.test(t); }
function programmInhalt(fix: boolean, tui: boolean, sysconfdir: string) { return `${BIN}${tui ? 188416 : 96512}${MARKE_PROGRAMM}${JSON.stringify({ v: VERSION, csv: fix, tui, conf: sysconfdir })}`; }
function programmInfo(c: string | null | undefined): { v: string; csv: boolean; tui: boolean; conf: string } | null {
  if (typeof c !== 'string' || !c.startsWith(BIN)) return null;
  const i = c.indexOf(MARKE_PROGRAMM); if (i < 0) return null;
  try { return JSON.parse(c.slice(i + MARKE_PROGRAMM.length)); } catch { return null; }
}

interface MakeLauf { out: string[]; err: string[]; code: number }
function makeAusfuehren(w: Welt, dir: string, ziele: string[], vars: Record<string, string>, root: boolean, kopf: boolean): Ergebnis {
  const mf = w.fs[`${dir}/Makefile`] as string;
  const k = makefileLesen(mf, vars);
  const bau = (wt(w).bauten[dir] ??= { konf: { args: '' }, objekte: {} });
  const r: MakeLauf = { out: [], err: [], code: 0 };
  const rein = () => r.out.push(`make[1]: Verzeichnis „${dir}“ wird betreten`);
  const raus = () => r.out.push(`make[1]: Verzeichnis „${dir}“ wird verlassen`);
  if (kopf) r.out.push(`make: Verzeichnis „${dir}“ wird betreten`);
  const tui = k.ENABLE_TUI === '1';
  const quellen = QUELLEN.filter((q) => tui || q !== 'src/tui.c');
  const darfHier = darf(w, dir, 'w', root) && darf(w, `${dir}/src`, 'w', root);
  // Übersetzen und Binden, wenn sich Quellen geändert haben
  const bauen = (zielName: string): boolean => {
    const alt = quellen.filter((q) => bau.objekte[q] !== w.fs[`${dir}/${q}`] || !hat(w, `${dir}/${q.replace(/\.c$/, '.o')}`));
    const ohneProgramm = !hat(w, `${dir}/src/lagerist`);
    if (!alt.length && !ohneProgramm) { if (zielName === 'all') { r.out.push('make  all-am'); rein(); r.out.push('make[1]: Für das Ziel „all-am“ ist nichts zu tun.'); raus(); } return true; }
    if (!darfHier) { r.err.push(`  CC       ${alt[0]?.replace(/\.c$/, '.o') ?? 'src/main.o'}\nAssembler messages:\nFatal error: can't create ${alt[0]?.replace(/\.c$/, '.o') ?? 'src/main.o'}: Keine Berechtigung\nmake[1]: *** [Makefile:503: src/main.o] Fehler 1`); r.code = 2; return false; }
    if (!hat(w, '/usr/bin/gcc') && k.CC === 'gcc') { r.err.push(`make[1]: gcc: Datei oder Verzeichnis nicht gefunden\nmake[1]: *** [Makefile:503: ${alt[0].replace(/\.c$/, '.o')}] Fehler 127`); r.code = 2; return false; }
    if (zielName === 'all') { r.out.push('make  all-am'); }
    rein();
    for (const q of alt) {
      const o = q.replace(/\.c$/, '.o');
      r.out.push(k.V === '1' ? `${k.CC} -DHAVE_CONFIG_H -I.     ${k.CFLAGS} -MT ${o} -MD -MP -MF src/.deps/${name(o).replace(/\.o$/, '.Tpo')} -c -o ${o} ${q}` : `  CC       ${o}`);
      w.fs[`${dir}/${o}`] = `${BIN}${8000 + (w.fs[`${dir}/${q}`] ?? '').length * 3}`; neuMeta(w, `${dir}/${o}`, root, false);
      bau.objekte[q] = w.fs[`${dir}/${q}`] as string;
    }
    r.out.push(k.V === '1' ? `${k.CC}  ${k.CFLAGS}   -o src/lagerist ${quellen.map((q) => q.replace(/\.c$/, '.o')).join(' ')}  ${k.LIBS}` : '  CCLD     src/lagerist');
    const fix = csvRepariert(w.fs[`${dir}/src/export.c`] ?? '');
    w.fs[`${dir}/src/lagerist`] = programmInhalt(fix, tui, k.sysconfdir); neuMeta(w, `${dir}/src/lagerist`, root, false); meta(w, `${dir}/src/lagerist`).mode = 0o777 & ~w.umask;
    raus();
    return true;
  };
  const ziel = (z: string) => {
    if (r.code) return;
    switch (z) {
      case 'all': bauen('all'); return;
      case 'install': case 'install-strip': {
        if (!bauen('install')) return;
        const d = k.DESTDIR;
        const bin = d + k.bindir; const etc = d + k.sysconfdir; const man = d + k.mandir + '/man1';
        const schritte: [string, string, string, number][] = [[bin, 'src/lagerist', 'lagerist', 0o755], [etc, 'lagerist.conf', 'lagerist.conf', 0o644], [man, 'doc/lagerist.1', 'lagerist.1', 0o644]];
        rein();
        const inst: string[] = [];
        for (const [ziel, quelle, n, mode] of schritte) {
          r.out.push(` /usr/bin/mkdir -p '${ziel}'`);
          const regel = `make[1]: *** [Makefile:${mode === 0o755 ? 466 : 618}: install-${mode === 0o755 ? 'binPROGRAMS' : n.endsWith('.1') ? 'man1' : 'sysconfDATA'}] Fehler 1`;
          const abbruch = (zeile: string) => { r.err.push(zeile, regel, `make[1]: Verzeichnis „${dir}“ wird verlassen`, 'make: *** [Makefile:1212: install-am] Fehler 2'); r.code = 2; };
          const e = mkdirP(w, ziel, root); if (e) { abbruch(`/usr/bin/mkdir: ${e}`); return; }
          r.out.push(`  /usr/bin/install -c${mode === 0o755 ? (z === 'install-strip' ? ' -s' : '') : ' -m 644'} ${quelle} '${ziel}'`);
          const zp = `${ziel}/${n}`;
          if ((zp in w.fs && !darf(w, zp, 'w', root)) || !darf(w, ziel, 'w', root)) { abbruch(`/usr/bin/install: reguläre Datei '${zp}' kann nicht angelegt werden: Keine Berechtigung`); return; }
          w.fs[zp] = w.fs[`${dir}/${quelle}`] ?? ''; neuMeta(w, zp, root, false); meta(w, zp).mode = mode; inst.push(zp);
        }
        raus();
        const info = programmInfo(w.fs[`${dir}/src/lagerist`])!;
        wt(w).installiert[d + k.prefix] = { dateien: inst, csv: info.csv, tui: info.tui };
        if (d && !wt(w).staging.includes(d)) wt(w).staging.push(d);
        return;
      }
      case 'uninstall': {
        const d = k.DESTDIR;
        for (const [ziel, n] of [[d + k.bindir, 'lagerist'], [d + k.sysconfdir, 'lagerist.conf'], [d + k.mandir + '/man1', 'lagerist.1']]) {
          r.out.push(` ( cd '${ziel}' && rm -f ${n} )`);
          const zp = `${ziel}/${n}`;
          if (zp in w.fs) { if (!darfImOrdner(w, zp, root, true)) { r.err.push(`rm: das Entfernen von '${n}' ist nicht möglich: Keine Berechtigung`); r.err.push('make: *** [Makefile:592: uninstall-binPROGRAMS] Fehler 1'); r.code = 2; return; } delete w.fs[zp]; }
        }
        delete wt(w).installiert[d + k.prefix];
        return;
      }
      case 'check': {
        if (!bauen('check')) return;
        r.out.push('make  check-TESTS'); rein();
        r.out.push(`make[2]: Verzeichnis „${dir}“ wird betreten`);
        const fix = programmInfo(w.fs[`${dir}/src/lagerist`])?.csv;
        const tests: [string, boolean][] = [['tests/lager.sh', true], ['tests/export.sh', true], ['tests/csv.sh', !!fix]];
        for (const [t, gut] of tests) r.out.push(`${gut ? 'PASS' : 'FAIL'}: ${t}`);
        const fail = tests.filter((t) => !t[1]).length;
        const linie = '============================================================================';
        r.out.push(linie, `Testsuite summary for lagerist ${VERSION}`, linie, '# TOTAL: 3', `# PASS:  ${3 - fail}`, '# SKIP:  0', '# XFAIL: 0', `# FAIL:  ${fail}`, '# XPASS: 0', '# ERROR: 0', linie);
        w.fs[`${dir}/test-suite.log`] = `============================================\n   lagerist ${VERSION}: ./test-suite.log\n============================================\n\n# TOTAL: 3\n# PASS:  ${3 - fail}\n# FAIL:  ${fail}\n\n${fail ? `.. contents:: :depth: 2\n\nFAIL: tests/csv\n===============\n\nZeile 2 hat 4 statt 3 Felder: 10017,Unterlegscheibe 6,4 mm,1200\nZeile 5 hat 4 statt 3 Felder: 10044,Dübel 8x40 "grau",150\nFAIL tests/csv.sh (exit status: 1)\n` : ''}`;
        neuMeta(w, `${dir}/test-suite.log`, root, false);
        bau.tests = fail ? 'fehler' : 'ok';
        if (fail) {
          r.out.push('See ./test-suite.log', 'Please report to bugs@lagerist.example.org', linie);
          r.err.push('make[2]: *** [Makefile:812: test-suite.log] Fehler 1', `make[2]: Verzeichnis „${dir}“ wird verlassen`, 'make[1]: *** [Makefile:920: check-TESTS] Fehler 2', `make[1]: Verzeichnis „${dir}“ wird verlassen`, 'make: *** [Makefile:1188: check-am] Fehler 2');
          r.code = 2; return;
        }
        r.out.push(`make[2]: Verzeichnis „${dir}“ wird verlassen`); raus();
        return;
      }
      case 'clean': case 'distclean': case 'mostlyclean': {
        r.out.push(' rm -f src/lagerist', 'rm -f src/*.o', 'rm -f src/*.$(OBJEXT) src/.deps/.dirstamp'.replace('$(OBJEXT)', 'o'));
        for (const p of ['src/lagerist', 'src/main.o', 'src/export.o', 'src/tui.o', 'test-suite.log']) delete w.fs[`${dir}/${p}`];
        bau.objekte = {};
        if (z === 'distclean') { r.out.push('rm -f config.status config.cache config.log configure.lineno config.status.lineno', 'rm -f Makefile config.h lagerist.conf'); for (const p of ['config.status', 'config.log', 'config.h', 'Makefile', 'lagerist.conf']) delete w.fs[`${dir}/${p}`]; bau.konf = null; }
        return;
      }
      default: r.err.push(`make: *** Keine Regel, um „${z}“ zu erstellen.  Schluss.`); r.code = 2;
    }
  };
  for (const z of ziele.length ? ziele : ['all']) { ziel(z); if (r.code) break; if (z === 'distclean') break; }
  if (kopf) r.out.push(`make: Verzeichnis „${dir}“ wird verlassen`);
  return { out: r.out.join('\n'), err: r.err.length ? r.err.join('\n') : undefined, code: r.code, errNach: true };
}
function mkdirP(w: Welt, ziel: string, root: boolean): string | null {
  const teile = ziel.split('/').filter(Boolean);
  for (let i = 1; i <= teile.length; i++) {
    const d = '/' + teile.slice(0, i).join('/');
    if (d in w.fs) { if (w.fs[d] !== null) return `das Verzeichnis »${d}“ kann nicht angelegt werden: Die Datei existiert bereits`; continue; }
    if (!darf(w, eltern(d), 'w', root)) return `das Verzeichnis »${d}“ kann nicht angelegt werden: Keine Berechtigung`;
    w.fs[d] = null; neuMeta(w, d, root, true); meta(w, d).mode = 0o755;
  }
  return null;
}

/** Programme, die über ihren Pfad gestartet werden: ./configure und lagerist. */
export function wartungProgramm(w: Welt, z: string, args: string[], root: boolean, aufruf: string): Ergebnis | null {
  const c = w.fs[z];
  if (typeof c !== 'string') return null;
  if (name(z) === 'configure' && c.includes(MARKE_CONFIGURE)) {
    if (!wartungAktiv(w)) (w as WT).wartung = leererStand({});
    return konfigurieren(w, eltern(z), aufruf, args, root);
  }
  const info = programmInfo(c);
  if (!info) return null;
  const sub = args.find((x) => !x.startsWith('-'));
  if (args.includes('--version') || args.includes('-V')) return ok(`lagerist ${info.v}\nKonfiguration: ${info.conf}/lagerist.conf\nTerminal-Oberfläche: ${info.tui ? 'ncursesw' : 'nein (gebaut mit --without-tui)'}`);
  if (args.includes('--help') || args.includes('-h')) return ok(`Aufruf: lagerist [BEFEHL]\n\nOhne Befehl startet die Terminal-Oberfläche.\n\nBefehle:\n  list           Bestand anzeigen\n  export --csv   Bestand als CSV auf die Standardausgabe\n\n  --version      Version und Konfigurationsdatei zeigen\n  --help         diese Hilfe`);
  if (sub === 'list') return ok(['NUMMER  MENGE  BEZEICHNUNG', ...DATEN.map((d) => `${d.nummer}  ${String(d.menge).padStart(5)}  ${d.bez}`)].join('\n'));
  if (sub === 'export') return args.includes('--csv') ? ok(csvZeilen(info.csv).join('\n')) : fehler('lagerist: export braucht ein Format, zum Beispiel --csv', 2);
  if (sub) return fehler(`lagerist: unbekannter Befehl „${sub}“. Siehe lagerist --help.`, 2);
  return info.tui ? fehler('(Im Simulator startet die Terminal-Oberfläche von lagerist nicht. Probier lagerist list oder lagerist export --csv.)', 1) : fehler('lagerist: ohne Terminal-Oberfläche gebaut (--without-tui). Befehle: list, export --csv', 1);
}

// ======================= Datensicherung =======================

const BAND_GERAETE = ['/dev/st0', '/dev/nst0', '/dev/tape'];
const zurueckspulend = (p: string) => p === '/dev/st0' || p === '/dev/tape';
interface Eintrag { p: string; c: string | null; m: number; t?: number }
function archivLesen(c: string | null | undefined): Eintrag[] | null {
  if (typeof c !== 'string') return null;
  let x = c; if (x.startsWith(KOMP)) x = x.slice(KOMP.length).split(':').slice(1).join(':');
  if (!x.startsWith(TAR)) return null;
  try { return JSON.parse(x.slice(TAR.length)); } catch { return null; }
}
function archivBauen(e: Eintrag[], komp: string | null) { const t = TAR + JSON.stringify(e); return komp ? `${KOMP}${komp}:${t}` : t; }
const SNAR = '\u0007SNAR:';
const kennung = (w: Welt, p: string) => `${meta(w, p).mtime}:${groesse(w.fs[p])}:${sha256(String(w.fs[p] ?? '')).slice(0, 16)}`;

/** Muster wie bei tar --exclude und rsync --exclude: ohne Anker, trifft auch Teilpfade nach einem „/“. */
function ausgeschlossen(pfad: string, muster: string[]): boolean {
  if (!muster.length) return false;
  const re = (m: string) => new RegExp('^' + m.replace(/\/$/, '').replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*\*/g, '\u0001').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0001/g, '.*') + '(/.*)?$');
  const teile = pfad.replace(/\/$/, '').split('/');
  return muster.some((m) => { const r = re(m.replace(/^\.\//, '')); for (let i = 0; i < teile.length; i++) if (r.test(teile.slice(i).join('/'))) return true; return false; });
}

interface TarAufruf { modus: string; datei?: string; ordner?: string; snar?: string; exclude: string[]; buchstaben: string; operanden: string[]; lang: string[] }
function tarZerlegen(a: string[]): TarAufruf | string {
  const t: TarAufruf = { modus: '', exclude: [], buchstaben: '', operanden: [], lang: [] };
  const liste = [...a];
  if (liste[0] && !liste[0].startsWith('-') && /^[cxtdvfzjJCpagW]+$/.test(liste[0])) liste[0] = '-' + liste[0];
  const LANG: Record<string, string> = { '--create': 'c', '--extract': 'x', '--get': 'x', '--list': 't', '--diff': 'd', '--compare': 'd', '--gzip': 'z', '--bzip2': 'j', '--xz': 'J', '--verbose': 'v', '--preserve-permissions': 'p', '--same-permissions': 'p' };
  for (let i = 0; i < liste.length; i++) {
    const x = liste[i]; let m;
    if (LANG[x]) { t.buchstaben += LANG[x]; continue; }
    if ((m = x.match(/^--file=(.*)$/))) { t.datei = m[1]; continue; }
    if (x === '--file') { t.datei = liste[++i]; continue; }
    if ((m = x.match(/^--directory=(.*)$/))) { t.ordner = m[1]; continue; }
    if (x === '--directory') { t.ordner = liste[++i]; continue; }
    if ((m = x.match(/^--listed-incremental=(.*)$/))) { t.snar = m[1]; continue; }
    if (x === '--listed-incremental') { t.snar = liste[++i]; continue; }
    if ((m = x.match(/^--exclude=(.*)$/))) { t.exclude.push(m[1]); continue; }
    if (x === '--exclude') { t.exclude.push(liste[++i] ?? ''); continue; }
    if (['--one-file-system', '--numeric-owner', '--totals', '--sparse', '-S', '--acls', '--xattrs', '--selinux', '--same-owner', '--atime-preserve', '--absolute-names', '-P'].includes(x)) continue;
    if (x.startsWith('--')) return `tar: Unbekannte Option „${x}“\n„tar --help“ oder „tar --usage“ liefert weitere Informationen.`;
    if (/^-[a-zA-Z]+$/.test(x)) {
      for (let k = 1; k < x.length; k++) {
        const ch = x[k];
        if ('fCg'.includes(ch)) { const val = x.slice(k + 1) || liste[++i]; if (ch === 'f') t.datei = val; else if (ch === 'C') t.ordner = val; else t.snar = val; break; }
        t.buchstaben += ch;
      }
      continue;
    }
    t.operanden.push(x);
  }
  const modi = ['c', 'x', 't', 'd'].filter((c) => t.buchstaben.includes(c));
  t.modus = modi.length === 1 ? modi[0] : '';
  return t;
}
function tarZusammen(t: TarAufruf, datei: string, ohne = ''): string[] {
  const b = [...new Set(t.buchstaben.split(''))].filter((c) => !ohne.includes(c)).join('');
  return [...(b ? ['-' + b] : []), '-f', datei, ...(t.ordner ? ['-C', t.ordner] : []), ...t.operanden];
}

function tarWrapper(alt: B): B {
  return (w, a, stdin, root) => {
    const t = tarZerlegen(a);
    // Was der Simulator hier nicht kennt (--version, --help, seltene Optionen), bleibt beim einfachen tar
    if (typeof t === 'string') return alt(w, a, stdin, root);
    // Ohne -f nimmt GNU tar die Umgebungsvariable TAPE
    if (!t.datei && w.env.TAPE) t.datei = w.env.TAPE;
    if (!t.modus || !t.datei) return alt(w, a, stdin, root);
    if (!wartungAktiv(w)) (w as WT).wartung = leererStand({});
    const st = wt(w);
    const p = K.pfad(w, t.datei);
    const band = BAND_GERAETE.includes(p) && st.band ? st.band : null;
    const TMP = '/tmp/.tar-' + w.naechstePid;
    const ersetze = (r: Ergebnis): Ergebnis => ({ ...r, out: r.out.split(TMP).join(t.datei!), err: r.err?.split(TMP).join(t.datei!) });
    if (band) {
      if (!(p in w.fs)) return fehler(`tar: ${t.datei}: Funktion open fehlgeschlagen: Datei oder Verzeichnis nicht gefunden\ntar: Error is not recoverable: exiting now`, 2);
      if (!darf(w, p, t.modus === 'c' ? 'w' : 'r', root)) return fehler(`tar: ${t.datei}: Funktion open fehlgeschlagen: Keine Berechtigung\ntar: Error is not recoverable: exiting now`, 2);
      if (!band.geladen) return fehler(`tar: ${t.datei}: Funktion open fehlgeschlagen: Kein Medium gefunden\ntar: Error is not recoverable: exiting now`, 2);
    }
    // ---- Vergleich mit dem Dateisystem ----
    if (t.modus === 'd') {
      let inhalt: string | null | undefined;
      if (band) { inhalt = band.amEnde ? '' : band.dateien[band.pos] ?? ''; if (inhalt && !band.amEnde) band.gelesen = band.pos; bandWeiter(band, p, true); }
      else { if (!(p in w.fs)) return fehler(`tar: ${t.datei}: Funktion open fehlgeschlagen: Datei oder Verzeichnis nicht gefunden\ntar: Error is not recoverable: exiting now`, 2); if (!darf(w, p, 'r', root)) return fehler(`tar: ${t.datei}: Funktion open fehlgeschlagen: Keine Berechtigung\ntar: Error is not recoverable: exiting now`, 2); inhalt = w.fs[p]; }
      const e = archivLesen(inhalt);
      if (!e) return fehler('tar: Das sieht nicht wie ein „tar“-Archiv aus.\ntar: Beende mit Fehlerstatus aufgrund vorheriger Fehler', 2);
      const basis = t.ordner ? K.pfad(w, t.ordner) : w.cwd;
      const out: string[] = []; const err: string[] = []; let anders = false;
      const auswahl = t.operanden.length ? e.filter((x) => t.operanden.some((o) => x.p === o || x.p.startsWith(o.replace(/\/$/, '') + '/'))) : e;
      for (const x of auswahl) {
        const ziel = (basis === '/' ? '' : basis) + '/' + x.p.replace(/\/$/, '');
        if (t.buchstaben.includes('v')) out.push(x.p);
        if (!(ziel in w.fs)) { err.push(`tar: ${x.p.replace(/\/$/, '')}: Warnung: Funktion stat fehlgeschlagen: Datei oder Verzeichnis nicht gefunden`); anders = true; continue; }
        if (x.c === null) continue;
        if (!darf(w, ziel, 'r', root)) { err.push(`tar: ${x.p}: Funktion open fehlgeschlagen: Keine Berechtigung`); anders = true; continue; }
        const m = meta(w, ziel);
        if ((m.mode & 0o7777) !== (x.m & 0o7777)) { out.push(`${x.p}: Modus ist unterschiedlich`); anders = true; }
        if (x.t !== undefined && Math.floor(m.mtime / 1000) !== Math.floor(x.t / 1000)) { out.push(`${x.p}: Änderungszeit ist unterschiedlich`); anders = true; }
        if (groesse(w.fs[ziel]) !== groesse(x.c)) { out.push(`${x.p}: Größe ist unterschiedlich`); anders = true; }
        else if (w.fs[ziel] !== x.c) { out.push(`${x.p}: Unterschiedliche Inhalte`); anders = true; }
      }
      return { out: out.join('\n'), err: err.length ? err.join('\n') : undefined, code: anders ? 1 : 0 };
    }
    // ---- Anlegen ----
    if (t.modus === 'c') {
      const ziel = band ? TMP : t.datei;
      const zp = K.pfad(w, ziel);
      const vorher = w.fs[zp];
      const r = alt(w, tarZusammen(t, ziel, 'zjJ'), stdin, root);
      if (r.code === 2 && (!(zp in w.fs) || w.fs[zp] === vorher)) return ersetze(r);
      const gelesen = archivLesen(w.fs[zp]);
      // Kein gewöhnliches Archiv (etwa von einem anderen Modul): unverändert lassen
      if (!gelesen && !band) return r;
      let eintraege = gelesen ?? [];
      // Änderungszeiten mitschreiben, damit tar -d sie vergleichen und tar -x sie wiederherstellen kann
      const basis = t.ordner ? K.pfad(w, t.ordner) : w.cwd;
      const absolut = t.operanden.filter((o) => o.startsWith('/')).map((o) => K.pfad(w, o));
      const quelle = (x: Eintrag) => { const a2 = '/' + x.p.replace(/\/$/, ''); if (absolut.some((o) => a2 === o || a2.startsWith(o + '/'))) return a2; return (basis === '/' ? '' : basis) + '/' + x.p.replace(/\/$/, ''); };
      eintraege = eintraege.map((x) => { const q = quelle(x); return { ...x, t: q in w.fs ? meta(w, q).mtime : undefined }; });
      if (t.exclude.length) eintraege = eintraege.filter((x) => !ausgeschlossen(x.p, t.exclude));
      let inkrementell = false;
      if (t.snar) {
        const sp = K.pfad(w, t.snar);
        const alt2 = w.fs[sp];
        let vorher: Record<string, string> | null = null;
        if (typeof alt2 === 'string' && alt2.includes(SNAR)) { try { vorher = JSON.parse(alt2.slice(alt2.indexOf(SNAR) + SNAR.length)); } catch { vorher = null; } }
        const jetzt: Record<string, string> = {};
        for (const x of eintraege) if (x.c !== null) jetzt[x.p] = kennung(w, quelle(x));
        if (vorher) { const v = vorher; eintraege = eintraege.filter((x) => x.c === null || v[x.p] !== jetzt[x.p]); inkrementell = true; }
        if (!(sp in w.fs) && !darfImOrdner(w, sp, root)) return fehler(`tar: ${t.snar}: Funktion open fehlgeschlagen: Keine Berechtigung\ntar: Error is not recoverable: exiting now`, 2);
        w.fs[sp] = `GNU tar-1.34-2\n${Math.floor(w.uhr / 1000)}\u00000\u0000${SNAR}${JSON.stringify(jetzt)}`; neuMeta(w, sp, root, false);
      }
      const komp = t.buchstaben.includes('z') ? 'gz' : t.buchstaben.includes('j') ? 'bz2' : t.buchstaben.includes('J') ? 'xz' : null;
      const inhalt = archivBauen(eintraege, komp);
      const v = t.buchstaben.includes('v') ? eintraege.map((x) => x.p).join('\n') : '';
      if (band) {
        delete w.fs[TMP]; if (w.meta) delete w.meta[TMP];
        band.dateien = [...band.dateien.slice(0, band.amEnde ? band.pos + 1 : band.pos), inhalt]; band.pos = band.dateien.length - 1; band.amEnde = false;
        bandWeiter(band, p, false);
      } else { w.fs[zp] = inhalt; st.archive[zp] = { inkrementell }; }
      if (band) st.archive[`${p}#${band.dateien.length - 1}`] = { inkrementell };
      return ersetze({ ...r, out: v });
    }
    // ---- Auflisten und Auspacken ----
    // tar -x stellt die Änderungszeiten aus dem Archiv wieder her
    const zeitenZurueck = (inhalt: string | null | undefined, r: Ergebnis) => {
      if (t.modus !== 'x' || r.code === 2) return;
      const basis = t.ordner ? K.pfad(w, t.ordner) : w.cwd;
      for (const x of archivLesen(inhalt) ?? []) { if (x.t === undefined) continue; const z = (basis === '/' ? '' : basis) + '/' + x.p.replace(/\/$/, ''); if (z in w.fs && w.fs[z] === x.c) meta(w, z).mtime = x.t; }
    };
    const fehlende = (inhalt: string | null | undefined, r: Ergebnis): Ergebnis => {
      const e = archivLesen(inhalt); if (!e || r.code === 2 || !t.operanden.length) return r;
      const weg = t.operanden.filter((o) => !e.some((x) => x.p.replace(/\/$/, '') === o.replace(/\/$/, '') || x.p.startsWith(o.replace(/\/$/, '') + '/')));
      if (!weg.length) return r;
      return { ...r, err: [r.err, ...weg.map((o) => `tar: ${o}: Nicht im Archiv gefunden.`), 'tar: Beende mit Fehlerstatus aufgrund vorheriger Fehler'].filter(Boolean).join('\n'), code: 2 };
    };
    if (!band) { const inhalt = w.fs[p]; const r = alt(w, tarZusammen(t, t.datei), stdin, root); zeitenZurueck(inhalt, r); return fehlende(inhalt, r); }
    const inhalt = band.amEnde ? '' : band.dateien[band.pos] ?? '';
    w.fs[TMP] = inhalt; meta(w, TMP).mode = 0o644;
    let r: Ergebnis;
    try { r = alt(w, tarZusammen(t, TMP), stdin, root); } finally { delete w.fs[TMP]; if (w.meta) delete w.meta[TMP]; }
    zeitenZurueck(inhalt, r);
    if (!r.code && !band.amEnde) band.gelesen = band.pos;
    bandWeiter(band, p, true);
    return ersetze(fehlende(inhalt, r));
  };
}
/** Nach dem Schließen: /dev/st0 spult zurück, /dev/nst0 bleibt hinter der Dateimarke stehen. */
function bandWeiter(b: Band, geraet: string, gelesen: boolean) {
  if (zurueckspulend(geraet)) { b.pos = 0; b.amEnde = false; return; }
  if (gelesen) { if (b.amEnde) { b.pos += 1; b.amEnde = false; } else if (b.pos < b.dateien.length) b.pos += 1; }
  else b.pos += 1;
}

// ---------- mt ----------
function mt(w: Welt, a: string[], root: boolean): Ergebnis {
  const st = wt(w);
  let geraet = w.env.TAPE ?? '/dev/tape'; const rest: string[] = [];
  for (let i = 0; i < a.length; i++) { if (a[i] === '-f' || a[i] === '-t') geraet = a[++i] ?? ''; else if (a[i] === '-v') continue; else if (a[i] === '--version') return ok('mt-st v. 1.4\ndefault tape device: /dev/tape'); else if (a[i] === '-h') return ok('usage: mt [-v] [--version] [-h] [ -f device ] command [ count ]\ndefault tape device: /dev/tape\ncommands: weof, wset, eof, fsf, fsfm, bsf, bsfm, fsr, bsr, fss, bss, rewind,\n          offline, rewoffl, eject, retension, eod, seod, seek, tell, status,\n          erase, setblk, lock, unlock, load, compression, setdensity, …'); else rest.push(a[i]); }
  const p = K.pfad(w, geraet);
  if (!rest.length) return fehler('usage: mt [-v] [--version] [-h] [ -f device ] command [ count ]', 1);
  if (!(p in w.fs) || !BAND_GERAETE.includes(p) || !st.band) return fehler(`${geraet}: No such file or directory`, 1);
  if (!darf(w, p, 'r', root)) return fehler(`${geraet}: Permission denied`, 1);
  const b = st.band; const cmd = rest[0]; const n = Number(rest[1] ?? 1);
  if (!b.geladen && !['status', 'load', 'offline', 'eject', 'rewoffl'].includes(cmd)) return fehler(`${geraet}: No medium found`, 2);
  const io = () => fehler(`${geraet}: Input/output error`, 2);
  const ende = (r: Ergebnis) => { if (zurueckspulend(p) && b.geladen && cmd !== 'status') { b.pos = 0; b.amEnde = false; } return r; };
  switch (cmd) {
    case 'status': {
      if (!b.geladen) return ok('SCSI 2 tape drive:\nFile number=-1, block number=-1, partition=0.\nTape block size 0 bytes. Density code 0x0 (default).\nSoft error count since last status=0\nGeneral status bits on (50000):\n DR_OPEN IM_REP_EN');
      const bot = b.pos === 0 && !b.amEnde;
      return ok(`SCSI 2 tape drive:\nFile number=${b.pos}, block number=${b.amEnde ? 1 : 0}, partition=0.\nTape block size 0 bytes. Density code 0x58 (LTO-5).\nSoft error count since last status=0\nGeneral status bits on (${bot ? '41010000' : b.pos >= b.dateien.length ? '89010000' : '81010000'}):\n ${bot ? 'BOT' : b.pos >= b.dateien.length ? 'EOF EOD' : 'EOF'} ONLINE IM_REP_EN`);
    }
    case 'rewind': case 'retension': b.pos = 0; b.amEnde = false; return ende(ok());
    // fsf N: über N Dateimarken vorwärts, danach am Anfang einer Datei
    case 'fsf': if (b.pos + n > b.dateien.length) { b.pos = b.dateien.length; b.amEnde = false; return ende(io()); } b.pos += n; b.amEnde = false; return ende(ok());
    case 'asf': if (n > b.dateien.length) return ende(io()); b.pos = n; b.amEnde = false; return ende(ok());
    // bsf N: über N Dateimarken rückwärts, danach vor der Marke, also am Ende der vorigen Datei
    case 'bsf': if (b.pos - n < 0) { b.pos = 0; b.amEnde = false; return ende(io()); } b.pos -= n; b.amEnde = true; return ende(ok());
    case 'eod': case 'seod': b.pos = b.dateien.length; b.amEnde = false; return ende(ok());
    case 'weof': case 'eof': { if (!darf(w, p, 'w', root)) return fehler(`${geraet}: Permission denied`, 1); const basis = b.dateien.slice(0, b.amEnde ? b.pos + 1 : b.pos); for (let i = 0; i < n; i++) basis.push(''); b.dateien = basis; b.pos = basis.length; b.amEnde = false; return ende(ok()); }
    case 'erase': b.dateien = []; b.pos = 0; b.amEnde = false; return ok();
    case 'offline': case 'rewoffl': case 'eject': b.geladen = false; b.pos = 0; b.amEnde = false; return ok();
    case 'load': b.geladen = true; b.pos = 0; b.amEnde = false; return ok();
    case 'tell': return ok(`At block ${b.amEnde ? 1 : 0}.`);
    case 'lock': case 'unlock': case 'compression': case 'setblk': return ok();
    default: return fehler(`mt: unknown command "${cmd}"`, 1);
  }
}

// ---------- rsync ----------
const FERN_HOSTS = ['srv1', 'srv1.lab.example.org', '192.168.1.10'];
interface Ort { host: string | null; pfad: string; roh: string }
function ortLesen(w: Welt, x: string): Ort {
  const m = x.match(/^(?:([\w.-]+)@)?([\w.-]+):(.*)$/);
  if (m && !x.startsWith('/') && !x.startsWith('.')) return { host: m[2], pfad: m[3].startsWith('/') ? m[3] : '/home/' + (m[1] ?? 'lena') + '/' + m[3], roh: x };
  return { host: null, pfad: x, roh: x };
}
function rsync(w: Welt, a: string[], root: boolean): Ergebnis {
  const st = wt(w);
  const f = new Set<string>(); const ex: string[] = []; const orte: string[] = [];
  for (let i = 0; i < a.length; i++) {
    const x = a[i]; let m;
    if ((m = x.match(/^--exclude=(.*)$/))) { ex.push(m[1]); continue; }
    if (x === '--exclude') { ex.push(a[++i] ?? ''); continue; }
    if (x === '-e' || x === '--rsh') { i++; continue; }
    if (/^--rsh=/.test(x)) continue;
    if (x.startsWith('--')) { const lang: Record<string, string> = { '--archive': 'a', '--verbose': 'v', '--dry-run': 'n', '--recursive': 'r', '--compress': 'z', '--human-readable': 'h', '--itemize-changes': 'i', '--progress': 'P', '--times': 't', '--perms': 'p' }; if (lang[x]) f.add(lang[x]); else if (['--delete', '--delete-excluded', '--stats', '--list-only', '--numeric-ids', '--partial'].includes(x)) f.add(x); else if (x === '--version') return ok('rsync  version 3.2.7  protocol version 31\nCopyright (C) 1996-2022 by Andrew Tridgell, Wayne Davison, and others.'); else return fehler(`rsync: ${x}: unknown option\nrsync error: syntax or usage error (code 1) at main.c(1817) [client=3.2.7]`, 1); continue; }
    if (/^-[a-zA-Z]+$/.test(x)) { for (const c of x.slice(1)) { if (c === 'e') { i++; break; } f.add(c); } continue; }
    orte.push(x);
  }
  if (!orte.length) return fehler('rsync  version 3.2.7  protocol version 31\n(… Hilfe gekürzt …)\nrsync error: syntax or usage error (code 1) at main.c(1795) [client=3.2.7]', 1);
  const rek = f.has('a') || f.has('r'); const v = f.has('v'); const trocken = f.has('n'); const item = f.has('i');
  const loeschen = f.has('--delete') || f.has('--delete-excluded');
  const fs = (o: Ort): Record<string, string | null> => (o.host ? st.fern : w.fs);
  const hostPruefen = (o: Ort) => (o.host && !FERN_HOSTS.includes(o.host) ? `ssh: Could not resolve hostname ${o.host}: Name or service not known\nrsync: connection unexpectedly closed (0 bytes received so far) [${'sender'}]\nrsync error: unexplained error (code 255) at io.c(231) [sender=3.2.7]` : null);
  for (const o of orte.map((x) => ortLesen(w, x))) { const e = hostPruefen(o); if (e) return fehler(e, 255); }
  // Nur eine Quelle: Inhalt auflisten wie ls -l
  if (orte.length === 1 || f.has('--list-only')) {
    const o = ortLesen(w, orte[0]); const dfs = fs(o); const p = o.host ? o.pfad.replace(/\/+$/, '') || '/' : K.pfad(w, o.pfad);
    if (!(p in dfs)) return fehler(`rsync: [sender] change_dir "${p}" failed: No such file or directory (2)\nrsync error: some files/attrs were not transferred (see previous errors) (code 23) at main.c(1338) [Receiver=3.2.7]`, 23);
    const kids = Object.keys(dfs).filter((k) => k.startsWith(p + '/') && (rek || !k.slice(p.length + 1).includes('/'))).sort();
    const zeile = (k: string, rel: string) => `${dfs[k] === null ? 'drwxr-xr-x' : '-rw-r--r--'} ${String(dfs[k] === null ? 4096 : groesse(dfs[k])).replace(/\B(?=(\d{3})+(?!\d))/g, ',').padStart(14)} 2026/11/23 08:40:00 ${rel}`;
    return ok([zeile(p, '.'), ...kids.map((k) => zeile(k, k.slice(p.length + 1)))].join('\n'));
  }
  const ziel = ortLesen(w, orte[orte.length - 1]); const quellen = orte.slice(0, -1).map((x) => ortLesen(w, x));
  if (quellen.some((q) => q.host) && ziel.host) return fehler('The source and destination cannot both be remote.\nrsync error: syntax or usage error (code 1) at main.c(1428) [Receiver=3.2.7]', 1);
  const zfs = fs(ziel);
  const zp = ziel.host ? ziel.pfad.replace(/\/+$/, '') || '/' : K.pfad(w, ziel.pfad);
  const out: string[] = []; const err: string[] = []; let fehlerhaft = false; let bytes = 0; let anzahl = 0;
  const loeschListe: { rel: string; voll: string }[] = []; const kopierListe: string[] = [];
  const darfZiel = (p: string) => ziel.host ? true : (p in w.fs ? darf(w, p, 'w', root) : darfImOrdner(w, p, root));
  let zielNeu = false;
  if (!(zp in zfs)) {
    const e = eltern(zp);
    if (!(e in zfs)) return fehler(`rsync: [Receiver] mkdir "${zp}" failed: No such file or directory (2)\nrsync error: error in file IO (code 11) at main.c(784) [Receiver=3.2.7]`, 11);
    if (!darfZiel(zp)) return fehler(`rsync: [Receiver] mkdir "${zp}" failed: Permission denied (13)\nrsync error: error in file IO (code 11) at main.c(784) [Receiver=3.2.7]`, 11);
    zielNeu = true;
  }
  const schreiben: [string, string | null, number][] = []; let gueltig = 0;
  for (const q of quellen) {
    const qfs = fs(q); const roh = q.host ? q.pfad : K.pfad(w, q.pfad);
    const qp = roh.replace(/\/+$/, '') || '/'; const inhalt = q.pfad.endsWith('/') || q.pfad === '.';
    if (!(qp in qfs)) { err.push(`rsync: [sender] change_dir "${qp}" failed: No such file or directory (2)`); fehlerhaft = true; continue; }
    gueltig++;
    if (qfs[qp] === null && !rek) { out.push(`skipping directory ${inhalt ? '.' : name(qp)}`); continue; }
    const basisZiel = qfs[qp] === null ? (inhalt ? zp : `${zp}/${name(qp)}`) : (zfs[zp] === null ? `${zp}/${name(qp)}` : zp);
    const relPrefix = qfs[qp] === null && !inhalt ? name(qp) + '/' : '';
    const alle = qfs[qp] === null ? Object.keys(qfs).filter((k) => k.startsWith(qp + '/')).sort() : [qp];
    if (zielNeu && qfs[qp] === null) kopierListe.push(inhalt ? './' : '');
    if (qfs[qp] === null && !inhalt && !(basisZiel in zfs)) { kopierListe.push(relPrefix); schreiben.push([basisZiel, null, q.host ? 0o755 : meta(w, qp).mode]); }
    for (const k of alle) {
      const rel = qfs[qp] === null ? k.slice(qp.length + 1) : name(qp);
      if (ausgeschlossen(rel, ex)) continue;
      if (!q.host && !darf(w, k, 'r', root)) { err.push(`rsync: [sender] send_files failed to open "${k}": Permission denied (13)`); fehlerhaft = true; continue; }
      const zk = qfs[qp] === null ? `${basisZiel}/${rel}` : basisZiel;
      const istDir = qfs[k] === null;
      if (istDir) { if (!(zk in zfs)) { kopierListe.push(relPrefix + rel + '/'); schreiben.push([zk, null, 0o755]); } continue; }
      bytes += groesse(qfs[k]); anzahl++;
      if (zfs[zk] === qfs[k]) continue;
      kopierListe.push((item ? (zk in zfs ? '>f.st...... ' : '>f+++++++++ ') : '') + relPrefix + rel);
      schreiben.push([zk, qfs[k], q.host ? 0o644 : meta(w, k).mode]);
    }
    if (loeschen && qfs[qp] === null && basisZiel in zfs) {
      for (const k of Object.keys(zfs).filter((x) => x.startsWith(basisZiel + '/')).sort().reverse()) {
        const rel = k.slice(basisZiel.length + 1);
        if (!f.has('--delete-excluded') && ausgeschlossen(rel, ex)) continue;
        if (!(`${qp}/${rel}` in qfs) || ausgeschlossen(rel, ex)) loeschListe.push({ rel: relPrefix + rel + (zfs[k] === null ? '/' : ''), voll: k });
      }
    }
  }
  if (gueltig === 0) zielNeu = false;
  if (zielNeu) out.push(`created directory ${ziel.pfad.replace(/\/+$/, '')}`);
  if (v || item) out.unshift(quellen.some((q) => q.host) ? 'receiving incremental file list' : 'sending incremental file list');
  if (v || item) for (const d of loeschListe) out.push(item ? `*deleting   ${d.rel}` : `deleting ${d.rel}`);
  if (v || item) for (const k of kopierListe.filter(Boolean)) out.push(item && k.endsWith('/') ? `cd+++++++++ ${k}` : k);
  if (!trocken) {
    if (zielNeu) { zfs[zp] = null; if (!ziel.host) { neuMeta(w, zp, root, true); } }
    for (const d of loeschListe) { if (!ziel.host && !darfImOrdner(w, d.voll, root, true)) { err.push(`rsync: [generator] delete_file: unlink(${d.rel}) failed: Permission denied (13)`); fehlerhaft = true; continue; } delete zfs[d.voll]; }
    const gescheitert: string[] = [];
    for (const [k, c, mode] of schreiben) {
      if (gescheitert.some((g) => k.startsWith(g + '/'))) continue;
      if (!(eltern(k) in zfs)) zfs[eltern(k)] = null;
      if (!ziel.host && !darfZiel(k)) {
        if (c === null) { err.push(`rsync: [generator] recv_generator: mkdir "${k}" failed: Permission denied (13)`, '*** Skipping any contents from this failed directory ***'); gescheitert.push(k); }
        else err.push(`rsync: [receiver] mkstemp "${k}" failed: Permission denied (13)`);
        fehlerhaft = true; continue;
      }
      zfs[k] = c;
      if (!ziel.host) { neuMeta(w, k, root, c === null); meta(w, k).mode = f.has('a') || f.has('p') ? mode : (c === null ? 0o755 : 0o644); }
      else st.fernMeta[k] = w.uhr;
    }
  }
  if (v || item || f.has('--stats')) {
    const gesendet = bytes + 60 * (anzahl + 1) + 42; const empfangen = 19 * (anzahl + 1) + 27;
    out.push('', `sent ${gesendet.toLocaleString('en-US')} bytes  received ${empfangen.toLocaleString('en-US')} bytes  ${((gesendet + empfangen) * 2).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} bytes/sec`, `total size is ${bytes.toLocaleString('en-US')}  speedup is ${(bytes / (gesendet + empfangen)).toFixed(2)}${trocken ? ' (DRY RUN)' : ''}`);
  }
  if (fehlerhaft) err.push('rsync error: some files/attrs were not transferred (see previous errors) (code 23) at main.c(1338) [sender=3.2.7]');
  return { out: out.join('\n'), err: err.length ? err.join('\n') : undefined, code: fehlerhaft ? 23 : 0, errNach: true };
}

// ======================= Benutzer informieren =======================

const WOCHENTAG = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONAT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function issueAusgeben(w: Welt, text: string): string {
  // Ortszeit Berlin im November: UTC+1
  const d = new Date(w.uhr + 3600000);
  const zwei = (n: number) => String(n).padStart(2, '0');
  const sitzungen = 3;
  const map: Record<string, string> = {
    n: w.host, l: 'tty1', r: w.kernel, m: 'x86_64', s: 'Linux', o: '(none)', O: 'lab.example.org',
    v: '#1 SMP PREEMPT_DYNAMIC Debian 6.1.115-1 (2024-11-01)', d: `${WOCHENTAG[d.getUTCDay()]} ${MONAT[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2)}  ${d.getUTCFullYear()}`,
    t: `${zwei(d.getUTCHours())}:${zwei(d.getUTCMinutes())}:${zwei(d.getUTCSeconds())}`, U: `${sitzungen} users`, u: String(sitzungen), '4': '192.168.1.23', '6': 'fe80::3e7c:3fff:fe1a:2b17', S: 'Debian GNU/Linux 12 (bookworm)', '\\': '\\', e: '\u001b',
  };
  return text.replace(/\\(S|4|6|.)(\{[^}]*\})?/g, (all, c: string) => (c in map ? map[c] : all.slice(1)));
}

// ======================= Start =======================

function leererStand(o: WartungOptionen): WtStand { return { opt: o, bauten: {}, installiert: {}, staging: [], band: null, archive: {}, fern: {}, fernMeta: {} }; }

export function wartungStarten(w: Welt, o: WartungOptionen) {
  const s = leererStand(o);
  (w as WT).wartung = s;
  // Was jedes Debian hat: /etc/issue, /etc/issue.net, update-motd.d, /usr/src, /usr/local/src
  if (!hat(w, '/etc/issue')) datei(w, '/etc/issue', 'Debian GNU/Linux 12 \\n \\l\n\n');
  if (!hat(w, '/etc/issue.net')) datei(w, '/etc/issue.net', 'Debian GNU/Linux 12\n');
  ordner(w, '/etc/issue.d');
  datei(w, '/etc/update-motd.d/10-uname', '#!/bin/sh\nuname -snrvm\n', 0o755);
  datei(w, '/usr/sbin/agetty', BIN + 63480, 0o755);
  ordner(w, '/usr/src'); ordner(w, '/usr/local/src'); meta(w, '/usr/local/src').mode = 0o2775; meta(w, '/usr/local/src').group = 'staff';
  if (w.fs['/etc/group'] && !/^tape:/m.test(w.fs['/etc/group']!)) w.fs['/etc/group'] += 'tape:x:26:\nstaff:x:50:\n';
  const L = '/home/lena';
  const lena = (p: string, c: string | null, mode = c === null ? 0o755 : 0o644) => { if (c === null) { ordner(w, p, 'lena'); meta(w, p).owner = 'lena'; meta(w, p).group = 'lena'; } else datei(w, p, c, mode, 'lena'); };
  if (o.werkzeuge) K.installieren(w, ['build-essential', 'patch', 'libncurses-dev']);
  if (o.quelle === 'download') {
    lena(`${L}/downloads`, null); lena(`${L}/quellen`, null);
    lena(`${L}/downloads/${QDIR}.tar.gz`, tarball());
    lena(`${L}/downloads/${QDIR}.tar.gz.sha256`, `${sha256(tarball())}  ${QDIR}.tar.gz\n`);
  }
  if (o.quelle === 'entpackt') {
    lena(`${L}/quellen`, null);
    lena(`${L}/quellen/${QDIR}.tar.gz`, tarball());
    for (const e of quellbaum()) { const p = `${L}/quellen/${e.p.replace(/\/$/, '')}`; if (e.c === null) lena(p, null); else lena(p, e.c, e.m); }
  }
  if (o.patch) lena(`${L}/quellen/${QDIR}-csv.patch`, CSV_PATCH);
  if (o.sicherung) {
    datei(w, '/srv/lager/bestand.csv', 'nummer,bezeichnung,menge\n10017,"Unterlegscheibe 6,4 mm",1200\n10023,Schraube M6x20,500\n10031,Mutter M6,800\n', 0o664, 'lena');
    datei(w, '/srv/lager/preise.csv', 'nummer,preis\n10017,0.04\n10023,0.12\n10031,0.06\n', 0o664, 'lena');
    datei(w, '/srv/lager/lieferanten.txt', 'Schrauben-Schmidt GmbH, Kassel\nBefestigungstechnik Nord, Kiel\n', 0o664, 'lena');
    for (const d of ['/srv/lager']) { meta(w, d).owner = 'lena'; meta(w, d).group = 'lena'; meta(w, d).mode = 0o775; }
    ordner(w, '/mnt/backup');
    datei(w, '/mnt/backup/LIESMICH', 'Sicherungsplatte (2 TB, USB). Wird per fstab unter /mnt/backup eingehängt.\n', 0o644);
    if (w.pakete) w.pakete.installiert.rsync = 'ii';
    datei(w, '/usr/bin/rsync', BIN + 773624, 0o755);
  }
  if (o.band) {
    s.band = { geladen: true, dateien: [], pos: 0, amEnde: false };
    for (const g of ['/dev/st0', '/dev/nst0']) { datei(w, g, '', 0o660, 'root', 'tape'); }
    datei(w, '/usr/bin/mt-st', BIN + 33000, 0o755); w.fs['/usr/bin/mt'] = '-> /etc/alternatives/mt'; meta(w, '/usr/bin/mt').mode = 0o777;
    datei(w, '/etc/alternatives/mt', '-> /usr/bin/mt-st'); meta(w, '/etc/alternatives/mt').mode = 0o777;
    if (w.pakete) w.pakete.installiert['mt-st'] = 'ii';
    if (o.band === 'nacht') {
      datei(w, '/usr/local/sbin/band-sicherung', '#!/bin/sh\n# Nächtliche Sicherung auf Band, gestartet von cron um 01:30.\n# Jedes Verzeichnis kommt als eigenes Archiv auf die Kassette.\nfor d in /etc /home /srv; do\n    tar czf /dev/st0 $d\ndone\nmt -f /dev/st0 offline\n', 0o755);
      datei(w, '/etc/cron.d/band-sicherung', '# Bandsicherung jede Nacht\n30 1 * * * root /usr/local/sbin/band-sicherung\n');
      // Nur das letzte Archiv hat überlebt, jedes tar auf /dev/st0 hat vorn wieder angefangen
      const srv = Object.keys(w.fs).filter((k) => k === '/srv' || k.startsWith('/srv/')).sort().map((k) => ({ p: k.slice(1) + (w.fs[k] === null ? '/' : ''), c: w.fs[k], m: meta(w, k).mode, t: meta(w, k).mtime }));
      s.band.dateien = [archivBauen(srv, 'gz')]; s.band.geladen = false;
    }
  }
  if (o.fern) {
    s.fern = {
      '/': null, '/sicherung': null, '/sicherung/lager': null,
      '/sicherung/lager/bestand.csv': 'nummer,bezeichnung,menge\n10017,"Unterlegscheibe 6,4 mm",1100\n10023,Schraube M6x20,500\n',
      '/sicherung/lager/lieferanten.txt': 'Schrauben-Schmidt GmbH, Kassel\nBefestigungstechnik Nord, Kiel\n',
      '/sicherung/lager/alt-inventur-2024.csv': 'nummer,menge\n10017,900\n',
    };
  }
}

// ======================= Befehle =======================

export function wartungBefehle(alt: Record<string, B>): Record<string, B> {
  const b: Record<string, B> = {};
  const mit = (n: string, f: B): B => (w, a, i, r) => (wartungAktiv(w) ? f(w, a, i, r) : alt[n] ? alt[n](w, a, i, r) : fehler(`bash: ${n}: Befehl nicht gefunden`, 127));
  const nichtDa = (n: string, paket: string) => fehler(`bash: ${n}: Befehl nicht gefunden\n(${n} gehört zum Paket ${paket}: sudo apt install ${paket})`, 127);

  // tar kann -d, -g, --exclude und stellt Zeiten wieder her, in jeder Welt (wie GNU tar auf Debian)
  b.tar = tarWrapper(alt.tar);
  b.make = (w, a, i, r) => {
    let dir = w.cwd; const ziele: string[] = []; const vars: Record<string, string> = {}; let kopf = false;
    for (let k = 0; k < a.length; k++) {
      const x = a[k]; let m;
      if (x === '-C') { dir = K.pfad(w, a[++k] ?? '.'); kopf = true; }
      else if ((m = x.match(/^-C(.+)$/))) { dir = K.pfad(w, m[1]); kopf = true; }
      else if ((m = x.match(/^-j(\d*)$/))) { if (!m[1] && /^\d+$/.test(a[k + 1] ?? '')) k++; }
      else if (/^--jobs(=\d+)?$/.test(x) || x === '-s' || x === '--silent' || x === '-k') continue;
      else if ((m = x.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/))) vars[m[1]] = m[2];
      else if (!x.startsWith('-')) ziele.push(x);
    }
    if (!hat(w, '/usr/bin/make')) return alt.make(w, a, i, r);
    if (!istLagerMakefile(w.fs[`${dir}/Makefile`])) return alt.make(w, a, i, r);
    if (!wartungAktiv(w)) (w as WT).wartung = leererStand({});
    return makeAusfuehren(w, dir, ziele, vars, r, kopf);
  };
  b.mt = (w, a, _i, r) => { if (!hat(w, '/usr/bin/mt-st')) return nichtDa('mt', 'mt-st'); return mt(w, a, r); };
  b['mt-st'] = b.mt;
  b.rsync = (w, a, _i, r) => { if (!hat(w, '/usr/bin/rsync')) return nichtDa('rsync', 'rsync'); if (!wartungAktiv(w)) (w as WT).wartung = leererStand({}); return rsync(w, a, r); };
  b.agetty = mit('agetty', (w, a) => {
    if (a.includes('--version') || a.includes('-V')) return ok('agetty from util-linux 2.38.1');
    if (!a.includes('--show-issue')) return fehler('(Im Simulator: agetty läuft als Dienst getty@tty1.service und zeigt /etc/issue vor der Anmeldung. Zum Ausprobieren: agetty --show-issue)', 1);
    const fi = a.indexOf('--issue-file'); const p = fi >= 0 ? K.pfad(w, a[fi + 1] ?? '') : '/etc/issue';
    const teile: string[] = [];
    if (typeof w.fs[p] === 'string') teile.push(w.fs[p] as string);
    if (fi < 0) for (const k of Object.keys(w.fs).filter((x) => /^\/etc\/issue\.d\/[^/]+\.issue$/.test(x)).sort()) teile.push(w.fs[k] as string);
    return ok(issueAusgeben(w, teile.join('')).replace(/\n+$/, ''));
  });
  // shutdown legt fünf Minuten vor dem Termin /run/nologin an und entfernt es bei -c
  b.shutdown = mit('shutdown', (w, a, i, r) => {
    const x = alt.shutdown(w, a, i, r);
    if (x.code) return x;
    if (a.includes('-c')) { delete w.fs['/run/nologin']; return x; }
    if (a.includes('-k') || a.includes('--show')) return x;
    const zeit = a.find((y) => /^(now|\+\d+|\d{1,2}:\d{2})$/.test(y));
    const min = zeit === undefined ? 1 : zeit === 'now' ? 0 : zeit.startsWith('+') ? Number(zeit.slice(1)) : 999;
    if (w.shutdown && min <= 5) datei(w, '/run/nologin', 'System is going down.\n\nUnprivileged users are not permitted to log in anymore. For technical details, see pam_nologin(8).\n');
    return x;
  });
  // run-parts führt die Skripte in /etc/update-motd.d aus, wie pam_motd bei der Anmeldung
  b['run-parts'] = mit('run-parts', (w, a, i, r) => {
    const d = a.find((x) => !x.startsWith('-'));
    if (!d || a.includes('--test') || a.includes('--list')) return alt['run-parts'](w, a, i, r);
    const p = K.pfad(w, d);
    const namen = Object.keys(w.fs).filter((k) => k.startsWith(p + '/') && !k.slice(p.length + 1).includes('/') && typeof w.fs[k] === 'string' && /^[A-Za-z0-9_-]+$/.test(name(k)) && (meta(w, k).mode & 0o111)).sort();
    const out: string[] = []; const err: string[] = [];
    for (const k of namen) { const x = K.zeile(w, k, '', r); if (x.out) out.push(x.out.replace(/\n$/, '')); if (x.err) err.push(x.err); }
    return { out: out.join('\n'), err: err.length ? err.join('\n') : undefined, code: 0 };
  });
  // wall DATEI liest die Nachricht aus der Datei
  b.wall = mit('wall', (w, a, stdin, r) => {
    const rest = a.filter((x) => x !== '-n' && x !== '--nobanner');
    if (rest.length === 1 && typeof w.fs[K.pfad(w, rest[0])] === 'string') {
      const p = K.pfad(w, rest[0]);
      if (!darf(w, p, 'r', r || w.root)) return fehler(`wall: ${rest[0]}: Keine Berechtigung`);
      return alt.wall(w, [], w.fs[p] as string, r);
    }
    return alt.wall(w, rest, stdin, r);
  });
  return b;
}

// ---------- install (coreutils), auf jedem System ----------
export function installBefehl(): B {
  return (w, a, _stdin, root) => {
    let mode: number | null = null; let owner: string | null = null; let group: string | null = null; let ziel: string | null = null;
    let dirs = false; let D = false; let v = false; const ops: string[] = [];
    for (let i = 0; i < a.length; i++) {
      const x = a[i]; let m;
      if (x === '-m' || x === '--mode') { const s = a[++i] ?? ''; const n = modusLesen(s); if (n === null) return fehler(`install: Ungültiger Modus »${s}“`); mode = n; }
      else if ((m = x.match(/^--mode=(.*)$/))) { const n = modusLesen(m[1]); if (n === null) return fehler(`install: Ungültiger Modus »${m[1]}“`); mode = n; }
      else if (x === '-o' || x === '--owner') owner = a[++i] ?? '';
      else if (x === '-g' || x === '--group') group = a[++i] ?? '';
      else if (x === '-t' || x === '--target-directory') ziel = a[++i] ?? '';
      else if ((m = x.match(/^--target-directory=(.*)$/))) ziel = m[1];
      else if (x === '--help') return ok('Aufruf: install [OPTION]… [-T] QUELLE ZIEL\n  oder:  install [OPTION]… QUELLE… VERZEICHNIS\n  oder:  install [OPTION]… -t VERZEICHNIS QUELLE…\n  oder:  install [OPTION]… -d VERZEICHNIS…\n\n  -d  alle Argumente als Verzeichnisse anlegen\n  -D  alle führenden Verzeichnisse von ZIEL anlegen\n  -m  Rechte setzen (wie chmod) statt rwxr-xr-x\n  -o  Eigentümer setzen (nur root)\n  -g  Gruppe setzen\n  -s  Symboltabellen entfernen (strip)\n  -t  alle QUELLEN in VERZEICHNIS kopieren\n  -v  jedes angelegte Verzeichnis und jede Datei nennen');
      else if (/^-[cdDpsvC]+$/.test(x)) { if (x.includes('d')) dirs = true; if (x.includes('D')) D = true; if (x.includes('v')) v = true; }
      else if (x === '--directory') dirs = true; else if (x === '--verbose') v = true; else if (x === '--strip' || x === '--preserve-timestamps' || x === '--compare') continue;
      else if (x.startsWith('-') && x !== '-') return fehler(`install: Ungültige Option -- '${x.replace(/^-+/, '')}'\n„install --help“ liefert weitere Informationen.`);
      else ops.push(x);
    }
    // Nur root darf den Eigentümer ändern, eine fremde Gruppe nur, wer selbst Mitglied ist
    const mitglied = (g: string) => g === 'lena' || new RegExp(`^${g}:[^:]*:[^:]*:(.*,)?lena(,|$)`, 'm').test(w.fs['/etc/group'] ?? '');
    if (!root && ((owner && owner !== 'lena') || (group && !mitglied(group)))) {
      const t = ops[ops.length - 1] ?? '';
      return fehler(`install: der Eigentümer von '${t}' konnte nicht geändert werden: Vorgang nicht zulässig`);
    }
    const err: string[] = []; const out: string[] = [];
    const neu = (p: string, dir: boolean, m: number) => { neuMeta(w, p, root, dir); const mm = meta(w, p); mm.mode = m; if (owner) mm.owner = owner; if (group) mm.group = group; };
    const anlegen = (d: string): boolean => {
      const teile = d.split('/').filter(Boolean);
      for (let i = 1; i <= teile.length; i++) {
        const q = '/' + teile.slice(0, i).join('/');
        if (q in w.fs) continue;
        if (!darf(w, eltern(q), 'w', root)) { err.push(`install: Verzeichnis '${q}' kann nicht angelegt werden: Keine Berechtigung`); return false; }
        w.fs[q] = null; neu(q, true, i === teile.length && dirs && mode !== null ? mode : 0o755);
        if (v) out.push(`install: Verzeichnis '${q}' wird angelegt`);
      }
      return true;
    };
    if (dirs) {
      if (!ops.length) return fehler('install: Fehlender Dateioperand\n„install --help“ liefert weitere Informationen.');
      for (const d of ops) { const p = K.pfad(w, d); if (anlegen(p) && mode !== null) meta(w, p).mode = mode; }
      return { out: out.join('\n'), err: err.length ? err.join('\n') : undefined, code: err.length ? 1 : 0 };
    }
    if (!ops.length) return fehler('install: Fehlender Dateioperand\n„install --help“ liefert weitere Informationen.');
    let quellen: string[]; let zielDir: string | null = null; let zielDatei: string | null = null;
    if (ziel) { quellen = ops; zielDir = K.pfad(w, ziel); }
    else {
      if (ops.length < 2) return fehler(`install: Fehlender Zieldatei‐Operand hinter '${ops[0]}'\n„install --help“ liefert weitere Informationen.`);
      quellen = ops.slice(0, -1); const z = K.pfad(w, ops[ops.length - 1]);
      if (w.fs[z] === null) zielDir = z; else if (quellen.length > 1) return fehler(`install: Ziel '${ops[ops.length - 1]}' ist kein Verzeichnis`); else zielDatei = z;
    }
    if (D) { const d = zielDir ?? eltern(zielDatei!); if (!anlegen(d)) return { out: out.join('\n'), err: err.join('\n'), code: 1 }; }
    for (const q of quellen) {
      const qp = K.pfad(w, q);
      if (!(qp in w.fs)) { err.push(`install: Aufruf von stat für '${q}' nicht möglich: Datei oder Verzeichnis nicht gefunden`); continue; }
      if (w.fs[qp] === null) { err.push(`install: Verzeichnis '${q}' wird ausgelassen`); continue; }
      if (!darf(w, qp, 'r', root)) { err.push(`install: '${q}' kann nicht zum Lesen geöffnet werden: Keine Berechtigung`); continue; }
      const zp = zielDatei ?? `${zielDir}/${name(qp)}`;
      if (!(eltern(zp) in w.fs)) { err.push(`install: reguläre Datei '${zp}' kann nicht angelegt werden: Datei oder Verzeichnis nicht gefunden`); continue; }
      if ((zp in w.fs && !darf(w, zp, 'w', root) && !darfImOrdner(w, zp, root, true)) || (!(zp in w.fs) && !darfImOrdner(w, zp, root))) { err.push(`install: reguläre Datei '${zp}' kann nicht angelegt werden: Keine Berechtigung`); continue; }
      w.fs[zp] = w.fs[qp]; neu(zp, false, mode ?? 0o755);
      if (v) out.push(`'${q}' -> '${zp}'`);
    }
    return { out: out.join('\n'), err: err.length ? err.join('\n') : undefined, code: err.length ? 1 : 0 };
  };
}
function modusLesen(s: string): number | null {
  if (/^[0-7]{1,4}$/.test(s)) return parseInt(s, 8);
  let m = 0;
  for (const teil of s.split(',')) {
    const x = teil.match(/^([ugoa]*)([=+])([rwxXst]*)$/); if (!x) return null;
    const wer = x[1] || 'a'; let bits = 0;
    for (const c of x[3]) { if (c === 'r') bits |= 4; if (c === 'w') bits |= 2; if (c === 'x' || c === 'X') bits |= 1; }
    for (const c of wer === 'a' ? 'ugo' : wer) { const sh = c === 'u' ? 6 : c === 'g' ? 3 : 0; if (x[2] === '=') m &= ~(7 << sh); m |= bits << sh; }
  }
  return m;
}

// ======================= Zustand =======================

export function zustandWartung(w: Welt, s: string): boolean | undefined {
  let m;
  if (!/^(lager|archiv|inkrementell|band|srv1)[:=~]/.test(s)) return undefined;
  if (!wartungAktiv(w)) return false;
  const st = wt(w);
  const baum = Object.keys(st.bauten).find((d) => d.endsWith('/' + QDIR)) ?? `/home/lena/quellen/${QDIR}`;
  if (s === 'lager:entpackt') return Object.keys(w.fs).some((p) => p.endsWith(`/${QDIR}/configure`) && (w.fs[p] ?? '').includes(MARKE_CONFIGURE));
  if ((m = s.match(/^lager:konfiguriert(?:=(.+))?$/))) { const mf = Object.keys(w.fs).filter((p) => p.endsWith(`/${QDIR}/Makefile`) && istLagerMakefile(w.fs[p])); return mf.some((p) => !m![1] || makefileLesen(w.fs[p] as string, {}).prefix === m![1]); }
  if ((m = s.match(/^lager:tui=(an|aus)$/))) { const mf = w.fs[`${baum}/Makefile`]; return istLagerMakefile(mf) && makefileLesen(mf as string, {}).ENABLE_TUI === (m[1] === 'an' ? '1' : '0'); }
  if (s === 'lager:gebaut') return Object.keys(w.fs).some((p) => p.endsWith(`/${QDIR}/src/lagerist`) && !!programmInfo(w.fs[p]));
  if ((m = s.match(/^lager:installiert=(.+)$/))) { const e = st.installiert[m[1]]; return !!e && e.dateien.every((p) => p in w.fs); }
  if ((m = s.match(/^lager:csv=(ok|kaputt)$/))) { const e = Object.entries(st.installiert).filter(([k, x]) => !st.staging.some((d) => k.startsWith(d)) && x.dateien.every((p) => p in w.fs)); return e.some(([, x]) => x.csv === (m![1] === 'ok')); }
  if ((m = s.match(/^lager:tests=(ok|fehler)$/))) return Object.values(st.bauten).some((x) => x.tests === m![1]);
  if ((m = s.match(/^lager:staging=(.+)$/))) return st.staging.includes(m[1]) && Object.keys(w.fs).some((p) => p.startsWith(m![1] + '/') && /\/bin\/lagerist$/.test(p));
  if ((m = s.match(/^lager:weg=(.+)$/))) return !Object.keys(w.fs).some((p) => p.startsWith(m![1] + '/') && /\/(bin\/lagerist|etc\/lagerist\.conf|man1\/lagerist\.1)$/.test(p)) && !st.installiert[m[1]];
  if ((m = s.match(/^archiv:(.+?)=(\d+)$/))) { const e = archivLesen(w.fs[K.pfad(w, m[1])]); return !!e && e.filter((x) => x.c !== null).length === Number(m[2]); }
  if ((m = s.match(/^archiv:(.+?)~(.+)$/))) { const e = archivLesen(w.fs[K.pfad(w, m[1])]); const re = new RegExp(m[2]); return !!e && e.some((x) => re.test(x.p)); }
  if ((m = s.match(/^inkrementell:(.+)$/))) return !!st.archive[K.pfad(w, m[1])]?.inkrementell;
  if (!st.band && s.startsWith('band')) return false;
  if ((m = s.match(/^band:dateien=(\d+)$/))) return st.band!.dateien.filter(Boolean).length === Number(m[1]);
  if ((m = s.match(/^band:pos=(\d+)$/))) return st.band!.pos === Number(m[1]);
  if ((m = s.match(/^band:gelesen=(\d+)$/))) return st.band!.gelesen === Number(m[1]);
  if (s === 'band:aus') return !st.band!.geladen;
  if (s === 'band:drin') return st.band!.geladen;
  if ((m = s.match(/^band:(\d+)~(.+)$/))) { const e = archivLesen(st.band!.dateien[Number(m[1])]); const re = new RegExp(m[2]); return !!e && e.some((x) => re.test(x.p)); }
  if ((m = s.match(/^srv1:([^~]+)~(.+)$/))) { const c = st.fern[m[1]]; return typeof c === 'string' && new RegExp(m[2], 'm').test(c); }
  if ((m = s.match(/^srv1:(.+)$/))) return m[1] in st.fern;
  return undefined;
}
