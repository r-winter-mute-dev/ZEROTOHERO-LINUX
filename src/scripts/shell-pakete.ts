// Erweiterung des Simulators für Topic 102: Platten, GRUB, Bibliotheken, Pakete (Debian, Red Hat, SUSE), Virtualisierung.
// Bekommt die Hilfsfunktionen des Kerns übergeben, damit es keinen Import-Kreis gibt.
import type { Welt } from './shell';

export interface Ergebnis { out: string; code: number; err?: string; }
export type Befehl = (w: Welt, args: string[], stdin: string, root: boolean) => Ergebnis;
export interface Helfer {
  ok: (out?: string) => Ergebnis;
  fehler: (out: string, code?: number) => Ergebnis;
  optionen: (a: string[]) => { flags: Set<string>; rest: string[] };
  pfad: (w: Welt, p: string) => string;
  schreiben: (w: Welt, ziel: string, text: string, anh: boolean, root: boolean) => string | null;
}

// ---------------- Paketdaten ----------------

export interface Paket { name: string; version: string; arch?: string; text: string; abh: string[]; dateien: string[]; konf?: string[]; groesse: number; repo?: string; signiert?: boolean; }

const D = (name: string, version: string, text: string, abh: string[], dateien: string[], konf: string[] = [], groesse = 200): Paket => ({ name, version, text, abh, dateien, konf, groesse, arch: 'amd64' });

// Debian 12: installiert und im Repository verfügbar
export const DEB: Paket[] = [
  D('libc6', '2.36-9+deb12u9', 'GNU C Library: Shared libraries', [], ['/lib/x86_64-linux-gnu/libc.so.6', '/lib64/ld-linux-x86-64.so.2'], [], 12900),
  D('libpcre2-8-0', '10.42-1', 'New Perl Compatible Regular Expression Library- 8 bit runtime files', ['libc6'], ['/lib/x86_64-linux-gnu/libpcre2-8.so.0'], [], 640),
  D('libselinux1', '3.4-1+b6', 'SELinux runtime shared libraries', ['libc6', 'libpcre2-8-0'], ['/lib/x86_64-linux-gnu/libselinux.so.1'], [], 200),
  D('coreutils', '9.1-1', 'GNU core utilities', ['libc6', 'libselinux1'], ['/usr/bin/ls', '/usr/bin/cp', '/usr/bin/cat'], [], 18000),
  D('bash', '5.2.15-2+b7', 'GNU Bourne Again SHell', ['libc6'], ['/usr/bin/bash', '/etc/bash.bashrc'], ['/etc/bash.bashrc'], 7100),
  D('pciutils', '1:3.9.0-4', 'PCI utilities', ['libc6'], ['/usr/bin/lspci', '/usr/share/man/man8/lspci.8.gz'], [], 220),
  D('openssh-server', '1:9.2p1-2+deb12u3', 'secure shell (SSH) server, for secure access from remote machines', ['libc6', 'openssh-client'], ['/usr/sbin/sshd', '/etc/ssh/sshd_config'], ['/etc/ssh/sshd_config'], 1900),
  D('sysstat', '12.6.1-1', 'system performance tools for Linux', ['libc6'], ['/usr/bin/sar', '/usr/bin/iostat', '/usr/bin/mpstat', '/usr/bin/pidstat', '/usr/bin/sadf', '/etc/default/sysstat', '/etc/sysstat/sysstat'], ['/etc/default/sysstat', '/etc/sysstat/sysstat'], 1650),
  D('htop', '3.2.2-2', 'interactive processes viewer', ['libc6'], ['/usr/bin/htop'], [], 420),
  D('iotop', '0.6-42-ga14256a-0.1+b2', 'simple top-like I/O monitor', ['libc6'], ['/usr/sbin/iotop'], [], 90),
  D('iftop', '1.0~pre4-9', 'displays bandwidth usage information on an network interface', ['libc6'], ['/usr/sbin/iftop'], [], 110),
  D('ifstat', '1.1-8.1+b1', 'InterFace STATistics Monitoring', ['libc6'], ['/usr/bin/ifstat'], [], 60),
  D('iptraf-ng', '1:1.2.1-1.1', 'Interactive Colorful IP LAN Monitor', ['libc6'], ['/usr/sbin/iptraf-ng'], [], 410),
  D('nmap', '7.93+dfsg1-1', 'The Network Mapper', ['libc6'], ['/usr/bin/nmap'], [], 4500),
  D('openssh-client', '1:9.2p1-2+deb12u3', 'secure shell (SSH) client, for secure access to remote machines', ['libc6'], ['/usr/bin/ssh', '/usr/bin/ssh-keygen'], [], 4200),
  D('smartmontools', '7.3-pre1-1', 'control and monitor storage systems using S.M.A.R.T.', ['libc6'], ['/usr/sbin/smartctl', '/etc/smartd.conf'], ['/etc/smartd.conf'], 2200),
  D('tzdata', '2024a-0+deb12u1', 'time zone and daylight-saving time data', [], ['/usr/share/zoneinfo/Europe/Berlin'], [], 3200),
  D('grub-efi-amd64', '2.06-13+deb12u1', 'GRand Unified Bootloader, version 2 (EFI-AMD64 version)', ['libc6'], ['/usr/sbin/grub-install', '/usr/sbin/update-grub', '/usr/sbin/grub-mkconfig'], [], 300),
  D('vim-tiny', '2:9.0.1378-2', 'Vi IMproved - enhanced vi editor - compact version', ['libc6'], ['/usr/bin/vim.tiny'], [], 1700),
  D('nano', '7.2-1+deb12u1', 'small, friendly text editor inspired by Pico', ['libc6'], ['/usr/bin/nano', '/etc/nanorc'], ['/etc/nanorc'], 2700),
  // nur im Repository
  D('htop', '3.2.2-2', 'interactive processes viewer', ['libc6', 'libncursesw6'], ['/usr/bin/htop', '/usr/share/man/man1/htop.1.gz'], [], 390),
  D('libncursesw6', '6.4-4', 'shared libraries for terminal handling (wide character support)', ['libc6'], ['/lib/x86_64-linux-gnu/libncursesw.so.6'], [], 410),
  D('tree', '2.1.0-1', 'displays an indented directory tree, in color', ['libc6'], ['/usr/bin/tree', '/usr/share/man/man1/tree.1.gz'], [], 120),
  D('nginx', '1.22.1-9+deb12u1', 'small, powerful, scalable web/proxy server', ['nginx-common', 'libc6', 'libpcre2-8-0'], ['/usr/sbin/nginx'], [], 1500),
  D('nginx-common', '1.22.1-9+deb12u1', 'small, powerful, scalable web/proxy server - common files', [], ['/etc/nginx/nginx.conf', '/var/www/html/index.nginx-debian.html'], ['/etc/nginx/nginx.conf'], 300),
  D('apt-file', '3.3', 'search for files within Debian packages (command-line interface)', ['libc6'], ['/usr/bin/apt-file'], [], 100),
  D('libmess1', '1.2-1', 'Messbibliothek für die Werkstatt (Beispielpaket)', ['libc6'], ['/usr/lib/x86_64-linux-gnu/libmess.so.1'], [], 80),
  D('sl', '5.02-1+b1', 'Correct you if you type `sl\' by mistake', ['libc6', 'libncursesw6'], ['/usr/games/sl'], [], 70),
  // Kernel und Bauwerkzeuge (LPIC-2 Topic 201)
  D('kmod', '30+20221128-1', 'tools for managing Linux kernel modules', ['libc6'], ['/usr/bin/kmod'], [], 260),
  D('udev', '252.31-1~deb12u1', '/dev/ and hotplug management daemon', ['libc6', 'kmod'], ['/usr/bin/udevadm', '/etc/udev/udev.conf'], ['/etc/udev/udev.conf'], 9800),
  D('procps', '2:4.0.2-3', '/proc file system utilities', ['libc6'], ['/usr/sbin/sysctl', '/etc/sysctl.conf'], ['/etc/sysctl.conf'], 2400),
  D('initramfs-tools', '0.142+deb12u1', 'generic modular initramfs generator (automation)', ['kmod', 'udev'], ['/usr/sbin/update-initramfs', '/usr/sbin/mkinitramfs', '/usr/bin/lsinitramfs', '/etc/initramfs-tools/initramfs.conf'], ['/etc/initramfs-tools/initramfs.conf'], 120),
  D('xz-utils', '5.4.1-1', 'XZ-format compression utilities', ['libc6'], ['/usr/bin/xz'], [], 480),
  D('linux-image-6.1.0-27-amd64', '6.1.115-1', 'Linux 6.1 for 64-bit PCs (signed)', ['kmod', 'initramfs-tools'], ['/boot/vmlinuz-6.1.0-27-amd64', '/boot/config-6.1.0-27-amd64', '/boot/System.map-6.1.0-27-amd64'], [], 398000),
  D('linux-image-6.1.0-26-amd64', '6.1.112-1', 'Linux 6.1 for 64-bit PCs (signed)', ['kmod', 'initramfs-tools'], ['/boot/vmlinuz-6.1.0-26-amd64', '/boot/config-6.1.0-26-amd64', '/boot/System.map-6.1.0-26-amd64'], [], 397800),
  D('linux-image-amd64', '6.1.115-1', 'Linux for 64-bit PCs (meta-package)', ['linux-image-6.1.0-27-amd64'], [], [], 1),
  D('linux-headers-6.1.0-27-common', '6.1.115-1', 'Common header files for Linux 6.1.0-27', [], ['/usr/src/linux-headers-6.1.0-27-common/Makefile'], [], 58000),
  D('linux-kbuild-6.1', '6.1.115-1', 'Kbuild infrastructure for Linux 6.1', ['libc6'], ['/usr/lib/linux-kbuild-6.1/scripts/basic/fixdep'], [], 2900),
  D('linux-headers-6.1.0-27-amd64', '6.1.115-1', 'Header files for Linux 6.1.0-27-amd64', ['linux-headers-6.1.0-27-common', 'linux-kbuild-6.1'], ['/usr/src/linux-headers-6.1.0-27-amd64/.config'], [], 5600),
  D('linux-headers-amd64', '6.1.115-1', 'Header files for Linux amd64 configuration (meta-package)', ['linux-headers-6.1.0-27-amd64'], [], [], 1),
  D('make', '4.3-4.1', 'utility for directing compilation', ['libc6'], ['/usr/bin/make'], [], 1600),
  D('patch', '2.7.6-7', 'Apply a diff file to an original', ['libc6'], ['/usr/bin/patch'], [], 290),
  D('libc6-dev', '2.36-9+deb12u9', 'GNU C Library: Development Libraries and Header Files', ['libc6'], ['/usr/include/stdio.h'], [], 12900),
  D('gcc', '4:12.2.0-3', 'GNU C compiler', ['libc6'], ['/usr/bin/gcc', '/usr/bin/cc'], [], 52000),
  D('dpkg-dev', '1.21.22', 'Debian package development tools', ['make', 'patch', 'xz-utils'], ['/usr/bin/dpkg-buildpackage'], [], 3300),
  D('build-essential', '12.9', 'Informational list of build-essential packages', ['gcc', 'make', 'dpkg-dev', 'libc6-dev'], [], [], 20),
  D('bc', '1.07.1-3+b1', 'GNU bc arbitrary precision calculator language', ['libc6'], ['/usr/bin/bc'], [], 220),
  D('bison', '2:3.8.2+dfsg-1+b1', 'YACC-compatible parser generator', ['libc6'], ['/usr/bin/bison'], [], 2100),
  D('flex', '2.6.4-8.2', 'fast lexical analyzer generator', ['libc6'], ['/usr/bin/flex'], [], 1200),
  D('libelf-dev', '0.188-2.1', 'libelf1 development libraries and header files', ['libc6'], ['/usr/include/libelf.h', '/usr/include/gelf.h'], [], 1300),
  D('libssl-dev', '3.0.15-1~deb12u1', 'Secure Sockets Layer toolkit - development files', ['libc6'], ['/usr/include/openssl/opensslv.h'], [], 12000),
  D('libncurses-dev', '6.4-4', 'developer\'s libraries for ncurses', ['libc6', 'libncursesw6'], ['/usr/include/ncurses.h'], [], 3000),
  D('dwarves', '1.24-4.1', 'set of advanced DWARF utilities', ['libc6'], ['/usr/bin/pahole'], [], 900),
  D('dkms', '3.0.10-8+deb12u1', 'Dynamic Kernel Module System (DKMS)', ['kmod', 'gcc', 'make'], ['/usr/sbin/dkms', '/etc/dkms/framework.conf'], ['/etc/dkms/framework.conf'], 600),
  D('procinfo', '1:2.0.304-7', 'Displays system information from /proc', ['libc6'], ['/usr/bin/procinfo', '/usr/bin/lsdev', '/usr/bin/socklist'], [], 210),
  D('lshw', '02.19.git.2021.06.19.996aaad9c7-2+b1', 'information about hardware configuration', ['libc6'], ['/usr/bin/lshw'], [], 980),
];
export const DEB_START = ['libc6', 'libpcre2-8-0', 'libselinux1', 'coreutils', 'bash', 'pciutils', 'openssh-server', 'openssh-client', 'smartmontools', 'tzdata', 'grub-efi-amd64', 'vim-tiny', 'nano'];
// Lokale Paketdatei im Download-Ordner: braucht libmess1
const DEB_DATEI: Paket = D('messsoft', '1.2-1', 'Messprogramm der Werkstatt (Beispielpaket)', ['libmess1', 'libc6'], ['/usr/bin/messsoft', '/etc/messsoft.conf'], ['/etc/messsoft.conf'], 150);
const DEB_DATEI_PFAD = '/home/lena/downloads/messsoft_1.2-1_amd64.deb';

const R = (name: string, version: string, text: string, abh: string[], dateien: string[], repo = 'baseos', konf: string[] = [], groesse = 200): Paket => ({ name, version, text, abh, dateien, konf, groesse, arch: 'x86_64', repo, signiert: true });
// AlmaLinux 9
export const RPM: Paket[] = [
  R('glibc', '2.34-100.el9_4.2', 'The GNU libc libraries', [], ['/usr/lib64/libc.so.6', '/usr/lib64/ld-linux-x86-64.so.2'], 'baseos', [], 6200),
  R('bash', '5.1.8-9.el9', 'The GNU Bourne Again shell', ['glibc'], ['/usr/bin/bash'], 'baseos', [], 7700),
  R('coreutils', '8.32-35.el9', 'A set of basic GNU tools commonly used in shell scripts', ['glibc'], ['/usr/bin/ls', '/usr/bin/cp'], 'baseos', [], 5900),
  R('openssh-server', '8.7p1-38.el9', 'An open source SSH server daemon', ['glibc'], ['/usr/sbin/sshd', '/etc/ssh/sshd_config'], 'baseos', ['/etc/ssh/sshd_config'], 1000),
  R('pciutils', '3.7.0-5.el9', 'PCI bus related utilities', ['glibc'], ['/usr/sbin/lspci'], 'baseos', [], 220),
  R('vim-minimal', '8.2.2637-20.el9_1', 'A minimal version of the VIM editor', ['glibc'], ['/usr/bin/vi'], 'baseos', [], 1500),
  R('dnf', '4.14.0-9.el9', 'Package manager', ['glibc'], ['/usr/bin/dnf', '/etc/dnf/dnf.conf', '/usr/bin/yum'], 'baseos', ['/etc/dnf/dnf.conf'], 2400),
  R('rpm', '4.16.1.3-29.el9', 'The RPM package management system', ['glibc'], ['/usr/bin/rpm', '/usr/bin/rpm2cpio'], 'baseos', [], 2800),
  R('almalinux-release', '9.4-1.el9', 'AlmaLinux release files', [], ['/etc/almalinux-release', '/etc/yum.repos.d/almalinux-baseos.repo', '/etc/yum.repos.d/almalinux-appstream.repo'], 'baseos', [], 50),
  // nur im Repository
  R('tree', '1.8.0-10.el9', 'File system tree viewer', ['glibc'], ['/usr/bin/tree'], 'baseos', [], 110),
  R('wget', '1.21.1-7.el9', 'A utility for retrieving files using the HTTP or FTP protocols', ['glibc'], ['/usr/bin/wget'], 'appstream', [], 3000),
  R('httpd', '2.4.57-11.el9_4.1', 'Apache HTTP Server', ['httpd-core', 'apr', 'apr-util', 'glibc'], ['/usr/sbin/httpd'], 'appstream', [], 100),
  R('httpd-core', '2.4.57-11.el9_4.1', 'httpd minimal core', ['apr', 'apr-util', 'glibc'], ['/etc/httpd/conf/httpd.conf', '/usr/sbin/httpd-core'], 'appstream', ['/etc/httpd/conf/httpd.conf'], 4300),
  R('apr', '1.7.0-12.el9_3', 'Apache Portable Runtime library', ['glibc'], ['/usr/lib64/libapr-1.so.0'], 'appstream', [], 290),
  R('apr-util', '1.6.1-23.el9', 'Apache Portable Runtime Utility library', ['apr', 'glibc'], ['/usr/lib64/libaprutil-1.so.0'], 'appstream', [], 210),
  R('epel-release', '9-8.el9', 'Extra Packages for Enterprise Linux repository configuration', [], ['/etc/yum.repos.d/epel.repo'], 'extras', [], 25),
  R('htop', '3.3.0-1.el9', 'Interactive process viewer', ['glibc'], ['/usr/bin/htop'], 'epel', [], 450),
  R('libmess', '1.2-1.el9', 'Messbibliothek für die Werkstatt (Beispielpaket)', ['glibc'], ['/usr/lib64/libmess.so.1'], 'appstream', [], 80),
];
export const RPM_START = ['glibc', 'bash', 'coreutils', 'openssh-server', 'pciutils', 'vim-minimal', 'dnf', 'rpm', 'almalinux-release'];
const RPM_DATEI: Paket = { ...R('messsoft', '1.2-1.el9', 'Messprogramm der Werkstatt (Beispielpaket)', ['libmess', 'glibc'], ['/usr/bin/messsoft', '/etc/messsoft.conf'], '@commandline', ['/etc/messsoft.conf'], 150), signiert: false };
const RPM_DATEI_PFAD = '/home/lena/downloads/messsoft-1.2-1.el9.x86_64.rpm';

// openSUSE Leap: Paketnamen leicht anders
export const SUSE: Paket[] = [
  { ...R('glibc', '2.38-150600.14.8.2', 'Standard Shared Libraries (from the GNU C Library)', [], ['/lib64/libc.so.6'], 'repo-oss'), arch: 'x86_64' },
  R('bash', '4.4-150400.27.3.2', 'The GNU Bourne-Again Shell', ['glibc'], ['/usr/bin/bash'], 'repo-oss'),
  R('zypper', '1.14.77-150600.10.10.1', 'Command line software manager using libzypp', ['glibc'], ['/usr/bin/zypper'], 'repo-oss'),
  R('rpm', '4.14.3-150400.59.16.1', 'The RPM Package Manager', ['glibc'], ['/usr/bin/rpm'], 'repo-oss'),
  R('tree', '2.0.4-150600.1.3', 'File listing as a tree', ['glibc'], ['/usr/bin/tree'], 'repo-oss'),
  R('htop', '3.3.0-150600.3.2', 'An interactive text-mode process viewer for Linux', ['glibc', 'libncurses6'], ['/usr/bin/htop'], 'repo-oss'),
  R('libncurses6', '6.1-150000.5.27.1', 'Terminal control library', ['glibc'], ['/lib64/libncursesw.so.6'], 'repo-oss'),
  R('nginx', '1.21.5-150600.8.4', 'A HTTP server and IMAP/POP3 proxy server', ['glibc'], ['/usr/sbin/nginx', '/etc/nginx/nginx.conf'], 'repo-oss', ['/etc/nginx/nginx.conf']),
];
export const SUSE_START = ['glibc', 'bash', 'zypper', 'rpm'];

// ---------------- Zustand der Erweiterung ----------------

export interface PaketStand {
  installiert: Record<string, 'ii' | 'rc'>;   // Debian: ii = installiert, rc = entfernt, Konfiguration noch da
  aptAktuell: boolean;
  aptFileAktuell: boolean;
  repos: string[];                          // RPM: aktivierte Repositories
  geaendert: string[];                      // vom Admin veränderte Konfigurationsdateien (für -V)
  ldCache: string[];                        // Verzeichnisse, die ldconfig kennt
  maschinenId: string;
  extra?: Paket[];                          // selbst gebaute Pakete (etwa Kernel aus make bindeb-pkg)
}

export function startStand(w: Welt) {
  const st: PaketStand = {
    installiert: {}, aptAktuell: true, aptFileAktuell: false, repos: ['baseos', 'appstream', 'extras'], geaendert: [],
    ldCache: ['/lib/x86_64-linux-gnu', '/usr/lib/x86_64-linux-gnu', '/lib64', '/usr/lib64', '/usr/local/lib'], maschinenId: 'b3f1c2e4a5d64f7e8a9b0c1d2e3f4a5b',
  };
  const start = w.distro === 'alma' ? RPM_START : w.distro === 'suse' ? SUSE_START : DEB_START;
  for (const n of start) st.installiert[n] = 'ii';
  w.pakete = st;
  // Dateien installierter Pakete ins Dateisystem legen
  for (const p of db(w)) if (st.installiert[p.name]) for (const f of p.dateien) dateiAnlegen(w, f, p.konf?.includes(f) ? `# ${f} aus ${p.name}\n` : '');
  // Distributionstypische Dateien
  if (w.distro === 'debian') {
    w.fs['/etc/apt'] = null; w.fs['/etc/apt/sources.list.d'] = null;
    w.fs['/etc/apt/sources.list'] = 'deb http://deb.debian.org/debian bookworm main non-free-firmware\ndeb http://security.debian.org/debian-security bookworm-security main non-free-firmware\ndeb http://deb.debian.org/debian bookworm-updates main non-free-firmware\n';
    w.fs['/home/lena/downloads'] = null; w.fs[DEB_DATEI_PFAD] = '(Debian-Paket)';
    w.fs['/etc/ld.so.conf'] = 'include /etc/ld.so.conf.d/*.conf\n';
    w.fs['/etc/ld.so.conf.d'] = null; w.fs['/etc/ld.so.conf.d/x86_64-linux-gnu.conf'] = '# Multiarch support\n/usr/local/lib/x86_64-linux-gnu\n/lib/x86_64-linux-gnu\n/usr/lib/x86_64-linux-gnu\n';
    w.fs['/etc/ld.so.conf.d/libc.conf'] = '# libc default configuration\n/usr/local/lib\n';
    w.fs['/etc/ld.so.cache'] = '(Binärdatei, mit ldconfig -p lesbar)';
    w.fs['/opt'] = null; w.fs['/opt/messsoft'] = null; w.fs['/opt/messsoft/bin'] = null; w.fs['/opt/messsoft/lib'] = null;
    w.fs['/opt/messsoft/bin/messprog'] = '(ELF-Programm)'; w.fs['/opt/messsoft/lib/libmess.so.1'] = '(ELF-Bibliothek)';
    w.fs['/etc/grub.d'] = null;
    for (const f of ['00_header', '10_linux', '20_linux_xen', '30_os-prober', '30_uefi-firmware', '40_custom', '41_custom']) w.fs[`/etc/grub.d/${f}`] = f === '40_custom' ? '#!/bin/sh\nexec tail -n +3 $0\n# Eigene Menüeinträge hier eintragen.\n' : '#!/bin/sh\n(Skript von grub-mkconfig)\n';
    w.fs['/boot/vmlinuz-6.1.0-26-amd64'] = ''; w.fs['/boot/initrd.img-6.1.0-26-amd64'] = '';
    w.fs['/boot/efi'] = null; w.fs['/boot/efi/EFI'] = null; w.fs['/boot/efi/EFI/debian'] = null; w.fs['/boot/efi/EFI/debian/grubx64.efi'] = '';
    w.fs['/boot/grub/grub.cfg'] = grubCfg(w);
  } else {
    w.host = w.distro === 'suse' ? 'labor-suse' : 'labor-alma';
    w.fs['/etc/yum.repos.d'] = null; w.fs['/home/lena/downloads'] = null;
    if (w.distro === 'alma') {
      w.fs['/etc/dnf'] = null;
      w.fs['/etc/dnf/dnf.conf'] = '[main]\ngpgcheck=1\ninstallonly_limit=3\nclean_requirements_on_remove=True\nbest=True\nskip_if_unavailable=False\n';
      w.fs['/etc/yum.conf'] = '-> /etc/dnf/dnf.conf';
      w.fs['/etc/yum.repos.d/almalinux-baseos.repo'] = '[baseos]\nname=AlmaLinux $releasever - BaseOS\nmirrorlist=https://mirrors.almalinux.org/mirrorlist/$releasever/baseos\nenabled=1\ngpgcheck=1\ngpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-AlmaLinux-9\n';
      w.fs['/etc/yum.repos.d/almalinux-appstream.repo'] = '[appstream]\nname=AlmaLinux $releasever - AppStream\nmirrorlist=https://mirrors.almalinux.org/mirrorlist/$releasever/appstream\nenabled=1\ngpgcheck=1\ngpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-AlmaLinux-9\n';
      w.fs[RPM_DATEI_PFAD] = '(RPM-Paket)';
    } else {
      w.fs['/etc/zypp'] = null; w.fs['/etc/zypp/repos.d'] = null;
      w.fs['/etc/zypp/repos.d/repo-oss.repo'] = '[repo-oss]\nname=Main Repository\nenabled=1\nautorefresh=1\nbaseurl=http://download.opensuse.org/distribution/leap/$releasever/repo/oss/\n';
    }
  }
  // Virtualisierung und Klonen
  w.fs['/etc/machine-id'] = st.maschinenId + '\n';
  w.fs['/var/lib'] = null; w.fs['/var/lib/dbus'] = null; w.fs['/var/lib/dbus/machine-id'] = '-> /etc/machine-id';
  w.fs['/etc/ssh'] = null;
  for (const t of ['rsa', 'ecdsa', 'ed25519']) { w.fs[`/etc/ssh/ssh_host_${t}_key`] = `(privater ${t}-Schlüssel)\n`; w.fs[`/etc/ssh/ssh_host_${t}_key.pub`] = `ssh-${t} AAAA…${t.toUpperCase()}1 root@${w.host}\n`; }
}

/** Pakete samt Dateien als installiert markieren (für vorbereitete Welten). */
export function paketeSetzen(w: Welt, namen: string[]) {
  if (!w.pakete) return;
  const alle = new Set<string>();
  const besuch = (n: string) => { if (alle.has(n)) return; const p = finde(w, n); if (!p) return; alle.add(n); p.abh.forEach(besuch); };
  namen.forEach(besuch);
  for (const n of alle) { const p = finde(w, n)!; w.pakete.installiert[n] = 'ii'; for (const f of p.dateien) dateiAnlegen(w, f, p.konf?.includes(f) ? `# ${f} aus ${p.name}\n` : ''); }
}
export function paketHinzu(w: Welt, name: string, version: string, text: string, dateien: string[]) {
  if (!w.pakete) return;
  w.pakete.extra = [...(w.pakete.extra ?? []).filter((p) => p.name !== name), D(name, version, text, [], dateien)];
  w.pakete.installiert[name] = 'ii';
}

function dateiAnlegen(w: Welt, f: string, inhalt: string) {
  const teile = f.split('/').filter(Boolean);
  for (let i = 1; i < teile.length; i++) { const d = '/' + teile.slice(0, i).join('/'); if (!(d in w.fs)) w.fs[d] = null; }
  if (!(f in w.fs)) w.fs[f] = inhalt;
}

function db(w: Welt): Paket[] { const b = w.distro === 'alma' ? RPM : w.distro === 'suse' ? SUSE : DEB; return w.pakete?.extra?.length ? [...b, ...w.pakete.extra] : b; }
const finde = (w: Welt, n: string) => db(w).find((p) => p.name === n);
const st = (w: Welt) => w.pakete!;

// ---------------- GRUB ----------------

function grubWert(w: Welt, schluessel: string, standard: string) {
  const m = (w.fs['/etc/default/grub'] ?? '').match(new RegExp(`^${schluessel}=(.*)$`, 'm'));
  return m ? m[1].replace(/^"|"$/g, '') : standard;
}
function bootKernel(w: Welt): string[] {
  const teil = (v: string) => v.split(/[.-]/).map((x) => (/^\d+$/.test(x) ? x.padStart(6, '0') : x)).join('.');
  return Object.keys(w.fs).filter((p) => /^\/boot\/vmlinuz-[^/]+$/.test(p) && !p.endsWith('.old')).map((p) => p.slice('/boot/vmlinuz-'.length)).sort((a, b) => (teil(a) < teil(b) ? 1 : -1));
}
function grubCfg(w: Welt): string {
  const timeout = grubWert(w, 'GRUB_TIMEOUT', '5');
  const opts = grubWert(w, 'GRUB_CMDLINE_LINUX_DEFAULT', 'quiet');
  const extra = grubWert(w, 'GRUB_CMDLINE_LINUX', '');
  const par = [extra, opts].filter(Boolean).join(' ');
  const eintrag = (v: string, t: string, zusatz = par) => `menuentry '${t}' {\n\tlinux\t/vmlinuz-${v} root=UUID=3f1c0d6e-8a2b-4c51-9a0e-2d7b1e5c9f40 ro ${zusatz}\n${(`/boot/initrd.img-${v}` in w.fs) ? `\tinitrd\t/initrd.img-${v}\n` : ''}}`;
  const kerne = bootKernel(w);
  const erster = kerne[0] ?? '6.1.0-27-amd64';
  const unter = kerne.flatMap((v) => [eintrag(v, `Debian GNU/Linux, with Linux ${v}`), eintrag(v, `Debian GNU/Linux, with Linux ${v} (recovery mode)`, 'single ' + extra)]).join('\n');
  return `#\n# DO NOT EDIT THIS FILE\n#\n# It is automatically generated by grub-mkconfig using templates\n# from /etc/grub.d and settings from /etc/default/grub\n#\nset default="${grubWert(w, 'GRUB_DEFAULT', '0')}"\nset timeout=${timeout}\n${eintrag(erster, 'Debian GNU/Linux')}\nsubmenu 'Advanced options for Debian GNU/Linux' {\n${unter}\n}\n${(w.fs['/etc/grub.d/40_custom'] ?? '').split('\n').slice(3).join('\n')}`.trim() + '\n';
}
export function grubMeldung(w: Welt): string {
  return ['Generating grub configuration file ...', ...bootKernel(w).flatMap((v) => [`Found linux image: /boot/vmlinuz-${v}`, ...((`/boot/initrd.img-${v}` in w.fs) ? [`Found initrd image: /boot/initrd.img-${v}`] : [])]), 'Adding boot menu entry for UEFI Firmware Settings ...', 'done'].join('\n');
}
export function grubSchreiben(w: Welt): string { w.fs['/boot/grub/grub.cfg'] = grubCfg(w); return grubMeldung(w); }

// ---------------- Befehle ----------------

export function paketBefehle(h: Helfer): Record<string, Befehl> {
  const { ok, fehler, optionen, pfad } = h;
  const nurDebian = (w: Welt, b: string) => w.distro !== 'debian' ? fehler(`bash: ${b}: command not found`, 127) : null;
  const nurRpm = (w: Welt, b: string) => w.distro === 'debian' ? fehler(`bash: ${b}: Befehl nicht gefunden`, 127) : null;

  // Abhängigkeiten auflösen: alle fehlenden Pakete in Installationsreihenfolge
  function fehlend(w: Welt, namen: string[], extra: Paket[] = []): { neu: string[]; unbekannt: string[] } {
    const neu: string[] = []; const unbekannt: string[] = []; const gesehen = new Set<string>();
    const besuch = (n: string) => {
      if (gesehen.has(n)) return; gesehen.add(n);
      const p = extra.find((x) => x.name === n) ?? finde(w, n);
      if (!p || !verfuegbar(w, p)) { unbekannt.push(n); return; }
      for (const a of p.abh) besuch(a);
      if (st(w).installiert[n] !== 'ii') neu.push(n);
    };
    namen.forEach(besuch);
    return { neu, unbekannt };
  }
  const verfuegbar = (w: Welt, p: Paket) => w.distro !== 'alma' || !p.repo || p.repo === '@commandline' || st(w).repos.includes(p.repo);

  function installieren(w: Welt, namen: string[], extra: Paket[] = []) {
    for (const n of namen) {
      const p = extra.find((x) => x.name === n) ?? finde(w, n)!;
      st(w).installiert[n] = 'ii';
      for (const f of p.dateien) dateiAnlegen(w, f, p.konf?.includes(f) ? `# ${f} aus ${p.name}\n` : '');
      if (n === 'epel-release') st(w).repos.push('epel');
    }
  }
  function entfernen(w: Welt, n: string, purge: boolean) {
    const p = finde(w, n) ?? (n === 'messsoft' ? (w.distro === 'debian' ? DEB_DATEI : RPM_DATEI) : undefined);
    if (!p) return;
    for (const f of p.dateien) if (purge || !p.konf?.includes(f) || w.distro !== 'debian') delete w.fs[f];
    if (w.distro === 'debian' && !purge && p.konf?.length) st(w).installiert[n] = 'rc'; else delete st(w).installiert[n];
  }
  const wer = (w: Welt, n: string) => Object.keys(st(w).installiert).filter((x) => st(w).installiert[x] === 'ii' && (finde(w, x)?.abh ?? (x === 'messsoft' ? ['libmess1', 'libmess'] : [])).includes(n));
  const ii = (w: Welt, n: string) => st(w).installiert[n] === 'ii';
  const alleBekannt = (w: Welt) => [...db(w), ...(st(w).installiert.messsoft ? [w.distro === 'debian' ? DEB_DATEI : RPM_DATEI] : [])];
  const sortiert = (l: string[]) => [...l].sort();

  // Rückfrage wie bei apt-get und dnf: die nächste Eingabe beantwortet sie
  function nachfragen(w: Welt, frage: string, standardJa: boolean, aktion: () => Ergebnis, vorher: string): Ergebnis {
    w.wartet = { standardJa, aktion };
    return ok(`${vorher}\n${frage}`);
  }

  const aptInstall = (w: Welt, namen: string[], ja: boolean, extraDatei?: Paket): Ergebnis => {
    const { neu, unbekannt } = fehlend(w, namen, extraDatei ? [extraDatei] : []);
    if (unbekannt.length) {
      if (!st(w).aptAktuell) return fehler(`Reading package lists... Done\nBuilding dependency tree... Done\nE: Unable to locate package ${unbekannt[0]}`, 100);
      return fehler(`Reading package lists... Done\nBuilding dependency tree... Done\nReading state information... Done\nE: Unable to locate package ${unbekannt[0]}`, 100);
    }
    const kopf = 'Reading package lists... Done\nBuilding dependency tree... Done\nReading state information... Done';
    if (!neu.length) return ok(`${kopf}\n${namen.map((n) => `${n} is already the newest version (${(extraDatei?.name === n ? extraDatei : finde(w, n))?.version}).`).join('\n')}\n0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.`);
    const zusatz = neu.filter((n) => !namen.includes(n));
    const plan = `${kopf}\n${zusatz.length ? `The following additional packages will be installed:\n  ${zusatz.join(' ')}\n` : ''}The following NEW packages will be installed:\n  ${neu.join(' ')}\n0 upgraded, ${neu.length} newly installed, 0 to remove and 0 not upgraded.`;
    const tun = () => { installieren(w, neu, extraDatei ? [extraDatei] : []); return ok(neu.map((n) => `Setting up ${n} (${(extraDatei?.name === n ? extraDatei : finde(w, n))!.version}) ...`).join('\n')); };
    if (zusatz.length && !ja) return nachfragen(w, 'Do you want to continue? [Y/n]', true, tun, plan);
    return ok(`${plan}\n${tun().out}`);
  };

  const b: Record<string, Befehl> = {
    // ---------- Platten ----------
    fdisk: (w, a, _i, root) => {
      if (!a.includes('-l')) return fehler('fdisk: Im Simulator ist nur „fdisk -l“ (anzeigen) erlaubt. Partitionieren übst du in Topic 104.');
      if (!root) return fehler('fdisk: cannot open /dev/nvme0n1: Permission denied');
      return ok(`Disk /dev/nvme0n1: 476,94 GiB, 512110190592 bytes, 1000215216 sectors
Disk model: Samsung SSD 970 EVO Plus 500GB
Units: sectors of 1 * 512 = 512 bytes
Disklabel type: gpt

Device             Start        End   Sectors   Size Type
/dev/nvme0n1p1      2048    1050623   1048576   512M EFI System
/dev/nvme0n1p2   1050624  996214783 995164160 474,5G Linux filesystem
/dev/nvme0n1p3 996214784 1000215182   4000399   1,9G Linux swap

Disk /dev/sda: 28,64 GiB, 30752636928 bytes, 60063744 sectors
Disk model: Ultra Fit
Disklabel type: dos

Device     Boot Start      End  Sectors  Size Id Type
/dev/sda1        2048 60063743 60061696 28,6G  c W95 FAT32 (LBA)`);
    },
    df: (_w, a) => ok(`Filesystem      ${a.some((x) => x.includes('h')) ? ' Size  Used Avail Use%' : '1K-blocks     Used Available Use%'} Mounted on
/dev/nvme0n1p2  ${a.some((x) => x.includes('h')) ? ' 467G   38G  406G   9%' : '489700828 39012876 425674080   9%'} /
/dev/nvme0n1p1  ${a.some((x) => x.includes('h')) ? ' 511M  5,9M  506M   2%' : '   523248     6012    517236   2%'} /boot/efi
/dev/sda1       ${a.some((x) => x.includes('h')) ? '  29G  4,1G   25G  15%' : ' 30014432  4298112  25716320  15%'} /media/lena/STICK`),
    swapon: (_w, a) => a.includes('--show') || a.includes('-s') ? ok('NAME           TYPE      SIZE USED PRIO\n/dev/nvme0n1p3 partition 1,9G   0B   -2') : fehler('swapon: Im Simulator nur „swapon --show“.'),
    free: (_w, a) => ok(a.some((x) => x.includes('h'))
      ? '               total        used        free      shared  buff/cache   available\nMem:            15Gi       2,3Gi       9,4Gi       312Mi       3,6Gi        12Gi\nSwap:          1,9Gi          0B       1,9Gi'
      : '               total        used        free      shared  buff/cache   available\nMem:        16303428     2412044     9874112      319488     3690356    13502236\nSwap:        2000892           0     2000892'),
    // ---------- GRUB ----------
    'update-grub': (w, a, i, root) => b['grub-mkconfig'](w, ['-o', '/boot/grub/grub.cfg'], i, root),
    'grub-mkconfig': (w, a, _i, root) => {
      const oi = a.indexOf('-o'); const ziel = oi >= 0 ? a[oi + 1] : null;
      const meldung = grubMeldung(w);
      if (!ziel) return ok(grubCfg(w) + '\n' + meldung);
      if (!root) return fehler(`/usr/sbin/grub-mkconfig: 287: cannot create ${ziel}.new: Permission denied`);
      w.fs[pfad(w, ziel)] = grubCfg(w);
      return ok(meldung);
    },
    'grub2-mkconfig': (w) => fehler('bash: grub2-mkconfig: Befehl nicht gefunden (so heißt der Befehl auf Red-Hat-Systemen. Auf Debian: grub-mkconfig oder update-grub)', 127),
    'grub-install': (_w, a, _i, root) => {
      if (!root) return fehler('grub-install: error: failed to get canonical path of `/boot/efi\'.');
      return ok(`Installing for x86_64-efi platform.\nInstallation finished. No error reported.${a.some((x) => x.startsWith('/dev/')) ? '' : ''}`);
    },
    // ---------- Bibliotheken ----------
    ldd: (w, a) => {
      const p = a.find((x) => !x.startsWith('-')); if (!p) return fehler('ldd: missing file arguments');
      const z = pfad(w, p);
      if (!(z in w.fs)) return fehler(`ldd: ${p}: No such file or directory`);
      const lib = w.distro === 'debian' ? '/lib/x86_64-linux-gnu' : '/lib64';
      const zeile = (n: string, wo: string) => `\t${n} => ${wo}/${n} (0x00007f${Math.abs(hash(n + z)).toString(16).padStart(7, '0').slice(0, 7)}000)`;
      const basis = ['\tlinux-vdso.so.1 (0x00007ffd3b7e2000)'];
      if (z === '/opt/messsoft/bin/messprog') {
        const da = libFindbar(w);
        return ok([...basis, da ? `\tlibmess.so.1 => ${da}/libmess.so.1 (0x00007f2a1c600000)` : '\tlibmess.so.1 => not found', zeile('libc.so.6', lib), '\t/lib64/ld-linux-x86-64.so.2 (0x00007f2a1c8f1000)'].join('\n'));
      }
      if (/\/(ls|cp)$/.test(z)) return ok([...basis, zeile('libselinux.so.1', lib), zeile('libc.so.6', lib), zeile('libpcre2-8.so.0', lib), '\t/lib64/ld-linux-x86-64.so.2 (0x00007f1e0b5d1000)'].join('\n'));
      if (/htop$/.test(z)) return ok([...basis, zeile('libncursesw.so.6', lib), zeile('libtinfo.so.6', lib), zeile('libm.so.6', lib), zeile('libc.so.6', lib), '\t/lib64/ld-linux-x86-64.so.2 (0x00007f3b2a3c4000)'].join('\n'));
      if (w.fs[z] === null) return fehler(`ldd: ${p}: not regular file`);
      if (/\.(conf|txt|cfg)$/.test(z) || !/(bin|sbin|lib)/.test(z)) return fehler('\tnot a dynamic executable');
      return ok([...basis, zeile('libc.so.6', lib), '\t/lib64/ld-linux-x86-64.so.2 (0x00007f0c4a1b2000)'].join('\n'));
    },
    ldconfig: (w, a, _i, root) => {
      if (a.includes('-p') || a.includes('--print-cache')) {
        const lib = w.distro === 'debian' ? '/lib/x86_64-linux-gnu' : '/lib64';
        const l = ['libc.so.6 (libc6,x86-64, OS ABI: Linux 3.2.0)', 'libselinux.so.1 (libc6,x86-64)', 'libpcre2-8.so.0 (libc6,x86-64)', 'libncursesw.so.6 (libc6,x86-64)', 'libm.so.6 (libc6,x86-64, OS ABI: Linux 3.2.0)', 'libz.so.1 (libc6,x86-64)']
          .map((x) => `\t${x} => ${lib}/${x.split(' ')[0]}`);
        if (st(w).ldCache.includes('/opt/messsoft/lib')) l.push('\tlibmess.so.1 (libc6,x86-64) => /opt/messsoft/lib/libmess.so.1');
        return ok(`${l.length + 1210} libs found in cache \`/etc/ld.so.cache'\n${l.join('\n')}\n\t(… weitere gekürzt)`);
      }
      if (!root) return fehler('ldconfig: Can\'t create temporary cache file /etc/ld.so.cache~: Permission denied');
      // Alle Verzeichnisse aus /etc/ld.so.conf und /etc/ld.so.conf.d/*.conf übernehmen
      const dirs = new Set(['/lib', '/usr/lib', '/lib64', '/usr/lib64']);
      for (const [p, c] of Object.entries(w.fs)) {
        if (typeof c !== 'string' || !(p === '/etc/ld.so.conf' || (p.startsWith('/etc/ld.so.conf.d/') && p.endsWith('.conf')))) continue;
        for (const z of c.split('\n')) { const t = z.trim(); if (t.startsWith('/')) dirs.add(t.replace(/\/$/, '')); }
      }
      for (const x of a.filter((x) => x.startsWith('/'))) dirs.add(x.replace(/\/$/, ''));
      st(w).ldCache = [...dirs];
      return ok();
    },
    // ---------- Debian ----------
    dpkg: (w, a, _i, root) => {
      const n = nurDebian(w, 'dpkg'); if (n) return n;
      const op = a[0]; const args = a.slice(1);
      const lang = (o: string) => op === o;
      if (lang('-l') || lang('--list')) {
        const muster = args[0] ? new RegExp('^' + args[0].replace(/\*/g, '.*') + '$') : /.*/;
        const liste = sortiert(Object.keys(st(w).installiert)).filter((x) => muster.test(x));
        if (!liste.length && args[0]) return fehler(`dpkg-query: no packages found matching ${args[0]}`);
        return ok('Desired=Unknown/Install/Remove/Purge/Hold\n| Status=Not/Inst/Conf-files/Unpacked/halF-conf/Half-inst/trig-aWait/Trig-pend\n|/ Err?=(none)/Reinst-required (Status,Err: uppercase=bad)\n||/ Name            Version              Architecture Description\n+++-===============-====================-============-=========================================\n'
          + liste.map((x) => { const p = finde(w, x) ?? DEB_DATEI; return `${(w as any).dpkgKaputt && x === 'messsoft' ? 'iU' : st(w).installiert[x]}  ${x.padEnd(15)} ${p.version.padEnd(20)} amd64        ${p.text.slice(0, 41)}`; }).join('\n'));
      }
      if (lang('-L') || lang('--listfiles')) {
        const p = args[0]; if (!st(w).installiert[p]) return fehler(`dpkg-query: package '${p}' is not installed\nUse dpkg --contents (= dpkg-deb --contents) to list archive files contents.`);
        const pk = finde(w, p) ?? DEB_DATEI;
        return ok((st(w).installiert[p] === 'rc' ? pk.konf! : ['/.', ...pk.dateien]).join('\n'));
      }
      if (lang('-S') || lang('--search')) {
        const s = args[0] ?? '';
        const treffer = alleBekannt(w).filter((p) => ii(w, p.name)).flatMap((p) => p.dateien.filter((f) => f.includes(s)).map((f) => `${p.name}: ${f}`));
        return treffer.length ? ok(treffer.join('\n')) : fehler(`dpkg-query: no path found matching pattern *${s}*`);
      }
      if (lang('-s') || lang('--status')) {
        const p = args[0]; const pk = finde(w, p) ?? (p === 'messsoft' ? DEB_DATEI : undefined);
        if (!pk || !st(w).installiert[p]) return fehler(`dpkg-query: package '${p}' is not installed and no information is available\nUse dpkg --info (= dpkg-deb --info) to examine archive files.`);
        return ok(`Package: ${p}\nStatus: ${(w as any).dpkgKaputt && p === 'messsoft' ? 'install ok unpacked' : st(w).installiert[p] === 'ii' ? 'install ok installed' : 'deinstall ok config-files'}\nPriority: optional\nInstalled-Size: ${pk.groesse}\nArchitecture: amd64\nVersion: ${pk.version}\nDepends: ${pk.abh.join(', ')}\nDescription: ${pk.text}`);
      }
      if (lang('-I') || lang('--info') || lang('-c') || lang('--contents')) {
        const d = args[0] ?? ''; if (pfad(w, d) !== DEB_DATEI_PFAD) return fehler(`dpkg-deb: error: failed to read archive '${d}': No such file or directory`);
        if (lang('-c') || lang('--contents')) return ok(['drwxr-xr-x root/root         0 2026-10-01 12:00 ./', ...DEB_DATEI.dateien.map((f) => `-rwxr-xr-x root/root     ${f.endsWith('.conf') ? '  312' : '48216'} 2026-10-01 12:00 .${f}`)].join('\n'));
        return ok(` new Debian package, version 2.0.\n size 14212 bytes: control archive=612 bytes.\n Package: messsoft\n Version: 1.2-1\n Architecture: amd64\n Maintainer: Werkstatt <werkstatt@example.org>\n Installed-Size: 150\n Depends: libmess1 (>= 1.2), libc6 (>= 2.34)\n Section: misc\n Priority: optional\n Description: Messprogramm der Werkstatt (Beispielpaket)`);
      }
      if (lang('-V') || lang('--verify')) {
        const liste = args.length ? args : Object.keys(st(w).installiert);
        return ok(st(w).geaendert.filter((f) => liste.some((p) => (finde(w, p) ?? DEB_DATEI).dateien.includes(f))).map((f) => `??5?????? c ${f}`).join('\n'));
      }
      if (lang('-i') || lang('--install')) {
        if (!root) return fehler('dpkg: error: requested operation requires superuser privilege');
        const d = args[0] ?? ''; if (pfad(w, d) !== DEB_DATEI_PFAD) return fehler(`dpkg: error: cannot access archive '${d}': No such file or directory`);
        const fehlt = DEB_DATEI.abh.filter((x) => !ii(w, x));
        if (fehlt.length) {
          st(w).installiert.messsoft = 'ii'; // ausgepackt, aber nicht konfiguriert
          (w as any).dpkgKaputt = true;
          return fehler(`Selecting previously unselected package messsoft.\n(Reading database ... 38412 files and directories currently installed.)\nPreparing to unpack .../messsoft_1.2-1_amd64.deb ...\nUnpacking messsoft (1.2-1) ...\ndpkg: dependency problems prevent configuration of messsoft:\n messsoft depends on libmess1 (>= 1.2); however:\n  Package libmess1 is not installed.\n\ndpkg: error processing package messsoft (--install):\n dependency problems - leaving unconfigured\nErrors were encountered while processing:\n messsoft`);
        }
        installieren(w, ['messsoft'], [DEB_DATEI]);
        return ok('Selecting previously unselected package messsoft.\nUnpacking messsoft (1.2-1) ...\nSetting up messsoft (1.2-1) ...');
      }
      if (lang('-r') || lang('--remove') || lang('-P') || lang('--purge')) {
        if (!root) return fehler('dpkg: error: requested operation requires superuser privilege');
        const p = args[0]; if (!st(w).installiert[p]) return ok(`dpkg: warning: ignoring request to remove ${p} which isn't installed`);
        const brauchen = wer(w, p);
        if (brauchen.length && st(w).installiert[p] === 'ii') return fehler(`dpkg: dependency problems prevent removal of ${p}:\n ${brauchen[0]} depends on ${p}.\n\ndpkg: error processing package ${p} (--remove):\n dependency problems - not removing\nErrors were encountered while processing:\n ${p}`);
        const purge = lang('-P') || lang('--purge');
        entfernen(w, p, purge);
        return ok(`(Reading database ... 38412 files and directories currently installed.)\nRemoving ${p} (${(finde(w, p) ?? DEB_DATEI).version}) ...${purge ? `\nPurging configuration files for ${p} (${(finde(w, p) ?? DEB_DATEI).version}) ...` : ''}`);
      }
      if (lang('--get-selections')) return ok(sortiert(Object.keys(st(w).installiert)).map((x) => `${x.padEnd(40)}${st(w).installiert[x] === 'ii' ? 'install' : 'deinstall'}`).join('\n'));
      return fehler('dpkg: Der Simulator kennt: -i, -r, -P, -l, -L, -S, -s, -I, -c, -V, --get-selections');
    },
    'dpkg-reconfigure': (w, a, _i, root) => {
      const n = nurDebian(w, 'dpkg-reconfigure'); if (n) return n;
      if (!root) return fehler('/usr/sbin/dpkg-reconfigure must be run as root');
      const p = a.find((x) => !x.startsWith('-'));
      if (p === 'openssh-server') {
        const neu: string[] = [];
        for (const t of ['rsa', 'ecdsa', 'ed25519']) if (!(`/etc/ssh/ssh_host_${t}_key` in w.fs)) { w.fs[`/etc/ssh/ssh_host_${t}_key`] = `(neuer privater ${t}-Schlüssel)\n`; w.fs[`/etc/ssh/ssh_host_${t}_key.pub`] = `ssh-${t} AAAA…NEU root@${w.host}\n`; neu.push(t); }
        return ok(neu.length ? `Creating SSH2 ${neu.map((x) => x.toUpperCase()).join(', ')} keys ...` + '\nrescue-ssh.target is a disabled or a static unit not running, not starting it.' : 'Keine fehlenden Host-Schlüssel. Es wurde nichts neu erzeugt.');
      }
      if (p === 'tzdata') return ok('(Im echten System erscheint jetzt ein Auswahldialog.)\n\nCurrent default time zone: \'Europe/Berlin\'\nLocal time is now:      Mon Nov 23 08:41:02 CET 2026.\nUniversal Time is now:  Mon Nov 23 07:41:02 UTC 2026.');
      if (!p || !st(w).installiert[p]) return fehler(`/usr/sbin/dpkg-reconfigure: ${p ?? ''} is not installed`);
      return ok(`(Im echten System fragt ${p} jetzt seine Einstellungen erneut ab.)`);
    },
    'apt-get': (w, a, _i, root) => {
      const n = nurDebian(w, 'apt-get'); if (n) return n;
      const { flags, rest } = optionen(a);
      const [cmd, ...pk] = rest;
      const ja = flags.has('-y') || flags.has('--yes');
      const braucht = ['update', 'install', 'remove', 'purge', 'upgrade', 'dist-upgrade', 'full-upgrade', 'autoremove', 'reinstall'];
      if (braucht.includes(cmd) && !root) return fehler('E: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)\nE: Unable to acquire the dpkg frontend lock (/var/lib/dpkg/lock-frontend), are you root?', 100);
      if ((w as any).dpkgKaputt && cmd === 'install' && !(flags.has('-f') || flags.has('--fix-broken'))) {
        return fehler('Reading package lists... Done\nYou might want to run \'apt --fix-broken install\' to correct these.\nThe following packages have unmet dependencies:\n messsoft : Depends: libmess1 (>= 1.2) but it is not installed\nE: Unmet dependencies. Try \'apt-get -f install\' with no packages (or specify a solution).', 100);
      }
      switch (cmd) {
        case 'update': st(w).aptAktuell = true; return ok('Hit:1 http://deb.debian.org/debian bookworm InRelease\nGet:2 http://security.debian.org/debian-security bookworm-security InRelease [48,0 kB]\nGet:3 http://deb.debian.org/debian bookworm-updates InRelease [55,4 kB]\nFetched 103 kB in 1s (142 kB/s)\nReading package lists... Done');
        case 'install': case 'reinstall': {
          if (flags.has('-f') || flags.has('--fix-broken') || (!pk.length && (w as any).dpkgKaputt)) {
            if (!(w as any).dpkgKaputt) return ok('Reading package lists... Done\n0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.');
            delete st(w).installiert.messsoft; const r = aptInstall(w, ['messsoft'], true, DEB_DATEI); (w as any).dpkgKaputt = false;
            return ok('Reading package lists... Done\nCorrecting dependencies... Done\n' + r.out);
          }
          if (!pk.length) return fehler('E: No packages specified for installation.', 100);
          if (pk[0].startsWith('./') || pk[0].startsWith('/')) {
            if (pfad(w, pk[0]) !== DEB_DATEI_PFAD) return fehler(`E: Unsupported file ${pk[0]} given on commandline`, 100);
            return aptInstall(w, ['messsoft'], ja, DEB_DATEI);
          }
          if (cmd === 'reinstall') return ok(`Reading package lists... Done\n0 upgraded, 0 newly installed, 1 reinstalled, 0 to remove and 0 not upgraded.\nPreparing to unpack .../${pk[0]}.deb ...\nUnpacking ${pk[0]} over (${finde(w, pk[0])?.version}) ...\nSetting up ${pk[0]} ...`);
          return aptInstall(w, pk, ja);
        }
        case 'remove': case 'purge': {
          if (!pk.length) return fehler('E: No packages specified for removal.', 100);
          const p = pk[0];
          if (st(w).installiert[p] !== 'ii' && !(cmd === 'purge' && st(w).installiert[p] === 'rc')) return ok(`Reading package lists... Done\nPackage '${p}' is not installed, so not removed\n0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.`);
          const mit = [...wer(w, p), p];
          const tun = () => { mit.forEach((x) => entfernen(w, x, cmd === 'purge')); return ok(mit.map((x) => `Removing ${x} (${finde(w, x)?.version ?? ''}) ...${cmd === 'purge' ? `\nPurging configuration files for ${x} ...` : ''}`).join('\n')); };
          const plan = `Reading package lists... Done\nThe following packages will be REMOVED:\n  ${mit.map((x) => x + (cmd === 'purge' ? '*' : '')).join(' ')}\n0 upgraded, 0 newly installed, ${mit.length} to remove and 0 not upgraded.`;
          if (!ja) return nachfragen(w, 'Do you want to continue? [Y/n]', true, tun, plan);
          return ok(plan + '\n' + tun().out);
        }
        case 'autoremove': {
          const weg = Object.keys(st(w).installiert).filter((x) => ii(w, x) && !DEB_START.includes(x) && !wer(w, x).length && ['libncursesw6', 'nginx-common', 'libmess1'].includes(x));
          if (!weg.length) return ok('Reading package lists... Done\n0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.');
          weg.forEach((x) => entfernen(w, x, false));
          return ok(`Reading package lists... Done\nThe following packages will be REMOVED:\n  ${weg.join(' ')}\n0 upgraded, 0 newly installed, ${weg.length} to remove and 0 not upgraded.\n${weg.map((x) => `Removing ${x} ...`).join('\n')}`);
        }
        case 'upgrade': case 'dist-upgrade': case 'full-upgrade':
          return ok(`Reading package lists... Done\nBuilding dependency tree... Done\nCalculating upgrade... Done\n0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.\n(${cmd === 'upgrade' ? 'upgrade installiert nur neuere Versionen und entfernt nie etwas.' : `${cmd} darf für Upgrades auch Pakete neu installieren oder entfernen.`})`);
        case 'download': return ok(`Get:1 http://deb.debian.org/debian bookworm/main amd64 ${pk[0]} amd64 ${finde(w, pk[0])?.version} [${finde(w, pk[0])?.groesse} kB]\nFetched in 0s`);
        case 'clean': return root ? ok() : fehler('E: Could not open lock file /var/cache/apt/archives/lock - open (13: Permission denied)', 100);
        default: return fehler(`E: Invalid operation ${cmd ?? ''}`, 100);
      }
    },
    apt: (w, a, i, root) => {
      const n = nurDebian(w, 'apt'); if (n) return n;
      const [cmd, ...r] = a;
      if (cmd === 'search' || cmd === 'show' || cmd === 'depends' || cmd === 'rdepends' || cmd === 'policy') return b['apt-cache'](w, a, i, root);
      if (cmd === 'list') return ok('Listing... Done\n' + sortiert(Object.keys(st(w).installiert).filter((x) => ii(w, x))).map((x) => `${x}/stable,now ${finde(w, x)?.version ?? '1.2-1'} amd64 [installed]`).join('\n'));
      const out = b['apt-get'](w, [cmd, ...r], i, root);
      return { ...out, out: '\nWARNING: apt does not have a stable CLI interface. Use with caution in scripts.\n\n' + out.out };
    },
    'apt-cache': (w, a) => {
      const n = nurDebian(w, 'apt-cache'); if (n) return n;
      const [cmd, p] = a;
      switch (cmd) {
        case 'search': { if (!p) return fehler('E: You must give at least one search pattern', 100); const re = new RegExp(p, 'i'); return ok(DEB.filter((x) => re.test(x.name) || re.test(x.text)).map((x) => `${x.name} - ${x.text}`).join('\n')); }
        case 'show': { const x = finde(w, p ?? ''); if (!x) return fehler(`N: Unable to locate package ${p}\nE: No packages found`, 100); return ok(`Package: ${x.name}\nVersion: ${x.version}\nInstalled-Size: ${x.groesse}\nDepends: ${x.abh.join(', ')}\nDescription-en: ${x.text}`); }
        case 'depends': { const x = finde(w, p ?? ''); if (!x) return fehler(`E: No packages found`, 100); return ok(`${x.name}\n${x.abh.map((d) => `  Depends: ${d}`).join('\n')}`); }
        case 'rdepends': { const x = finde(w, p ?? ''); if (!x) return fehler(`E: No packages found`, 100); return ok(`${x.name}\nReverse Depends:\n${DEB.filter((y) => y.abh.includes(x.name)).map((y) => `  ${y.name}`).join('\n')}`); }
        case 'policy': { const x = finde(w, p ?? ''); if (!x) return ok(''); return ok(`${x.name}:\n  Installed: ${ii(w, x.name) ? x.version : '(none)'}\n  Candidate: ${x.version}\n  Version table:\n     ${x.version} 500\n        500 http://deb.debian.org/debian bookworm/main amd64 Packages`); }
        default: return fehler('E: Der Simulator kennt: search, show, depends, rdepends, policy', 100);
      }
    },
    'apt-file': (w, a, _i, root) => {
      if (w.distro !== 'debian' || !ii(w, 'apt-file')) return fehler('bash: apt-file: Befehl nicht gefunden', 127);
      const [cmd, s] = a;
      if (cmd === 'update') { if (!root) return fehler('E: Could not open lock file /var/lib/apt/lists/lock - open (13: Permission denied)'); st(w).aptFileAktuell = true; return ok('Hit:1 http://deb.debian.org/debian bookworm InRelease\nGet:2 http://deb.debian.org/debian bookworm/main amd64 Contents (deb) [46,7 MB]\nFetched 46,7 MB in 9s'); }
      if (cmd === 'search' || cmd === 'find') {
        if (!st(w).aptFileAktuell) return fehler('Finding relevant cache files to search ...E: The cache is empty. You need to run "apt-file update" first.');
        const t = DEB.flatMap((p) => p.dateien.filter((f) => f.includes(s ?? '')).map((f) => `${p.name}: ${f}`));
        return t.length ? ok(t.join('\n')) : fehler('', 1);
      }
      return fehler('apt-file: Der Simulator kennt: update, search');
    },
    // ---------- RPM ----------
    rpm: (w, a, _i, root) => {
      const n = nurRpm(w, 'rpm'); if (n) return n;
      const roh = a.join(' ');
      const kurz = a.filter((x) => /^-[a-zA-Z]+$/.test(x)).join('').replace(/-/g, '');
      const hat = (c: string) => kurz.includes(c);
      const ziel = a.filter((x) => !x.startsWith('-'));
      const dateiPaket = (d: string) => pfad(w, d) === RPM_DATEI_PFAD ? RPM_DATEI : (w.distro === 'alma' && pfad(w, d).endsWith('.rpm') ? null : null);
      const voll = (p: Paket) => `${p.name}-${p.version}.${p.arch}`;
      if (a.includes('--import')) return root ? ok() : fehler('error: /etc/pki/rpm-gpg/RPM-GPG-KEY: key 1 import failed.');
      if (a.includes('-K') || a.includes('--checksig') || hat('K')) {
        const p = dateiPaket(ziel[0] ?? ''); if (!p) return fehler(`error: ${ziel[0]}: open failed: No such file or directory`);
        return ok(`${ziel[0]}: digests OK`);
      }
      if (hat('q') || a.includes('--query')) {
        const alle = hat('a') || a.includes('--all');
        const istDatei = hat('p') || a.includes('--package');
        let pakete: Paket[] = [];
        if (alle) pakete = alleBekannt(w).filter((p) => ii(w, p.name));
        else if (hat('f') || a.includes('--file')) {
          const f = pfad(w, ziel[0] ?? '');
          const t = alleBekannt(w).filter((p) => ii(w, p.name) && p.dateien.includes(f));
          if (!t.length) return fehler(`file ${f} is not owned by any package`);
          pakete = t;
        } else if (istDatei) { const p = dateiPaket(ziel[0] ?? ''); if (!p) return fehler(`error: open of ${ziel[0]} failed: No such file or directory`); pakete = [p]; }
        else if (a.includes('--whatprovides')) { const t = alleBekannt(w).filter((p) => ii(w, p.name) && p.dateien.some((f) => f.includes(ziel[0] ?? ''))); if (!t.length) return fehler(`no package provides ${ziel[0]}`); pakete = t; }
        else {
          for (const z of ziel) { const p = alleBekannt(w).find((x) => x.name === z); if (!p || !ii(w, z)) return fehler(`package ${z} is not installed`); pakete.push(p); }
          if (!ziel.length) return fehler('rpm: no arguments given for query');
        }
        if (hat('i') || a.includes('--info')) return ok(pakete.map((p) => `Name        : ${p.name}\nVersion     : ${p.version.split('-')[0]}\nRelease     : ${p.version.split('-').slice(1).join('-')}\nArchitecture: ${p.arch}\nInstall Date: ${istDatei ? '(not installed)' : 'Mon 23 Nov 2026 08:12:44 AM CET'}\nGroup       : Unspecified\nSize        : ${p.groesse * 1024}\nLicense     : GPLv2+\nSignature   : ${p.signiert ? 'RSA/SHA256, Thu 01 Aug 2026 10:12:03 AM CEST, Key ID d36cb86cb86b3716' : '(none)'}\nSource RPM  : ${p.name}-${p.version}.src.rpm\nSummary     : ${p.text}`).join('\n\n'));
        if (hat('l') || a.includes('--list')) return ok(pakete.flatMap((p) => p.dateien).join('\n'));
        if (hat('c') || a.includes('--configfiles')) return ok(pakete.flatMap((p) => p.konf ?? []).join('\n'));
        if (hat('R') || a.includes('--requires')) return ok(pakete.flatMap((p) => p.abh.map((d) => d === 'glibc' ? 'libc.so.6()(64bit)' : d === 'libmess' ? 'libmess.so.1()(64bit)' : d)).concat(['rpmlib(CompressedFileNames) <= 3.0.4-1']).join('\n'));
        return ok(pakete.map(voll).join('\n'));
      }
      if (hat('V') || a.includes('--verify')) {
        const liste = hat('a') ? Object.keys(st(w).installiert) : ziel;
        return ok(st(w).geaendert.filter((f) => liste.some((p) => alleBekannt(w).find((x) => x.name === p)?.dateien.includes(f))).map((f) => `S.5....T.  c ${f}`).join('\n'));
      }
      if (hat('e') || a.includes('--erase')) {
        if (!root) return fehler('error: can\'t create transaction lock on /var/lib/rpm/.rpm.lock (Permission denied)');
        const p = ziel[0]; if (!ii(w, p)) return fehler(`error: package ${p} is not installed`);
        const brauchen = wer(w, p);
        if (brauchen.length && !a.includes('--nodeps')) return fehler(`error: Failed dependencies:\n\t${p} is needed by (installed) ${voll(alleBekannt(w).find((x) => x.name === brauchen[0])!)}`);
        entfernen(w, p, true); return ok();
      }
      if (hat('i') || hat('U') || hat('F') || a.includes('--install') || a.includes('--upgrade') || a.includes('--freshen') || a.includes('--reinstall')) {
        if (!root) return fehler('error: can\'t create transaction lock on /var/lib/rpm/.rpm.lock (Permission denied)');
        const p = dateiPaket(ziel[0] ?? '');
        if (!p) return fehler(`error: open of ${ziel[0] ?? ''} failed: No such file or directory`);
        if (hat('F') && !st(w).installiert[p.name]) return ok(); // freshen: nur, wenn schon installiert
        if (st(w).installiert[p.name] && hat('i') && !a.includes('--reinstall')) return fehler(`\tpackage ${voll(p)} is already installed`);
        const fehlt = p.abh.filter((x) => !ii(w, x));
        if (fehlt.length && !a.includes('--nodeps')) return fehler(`error: Failed dependencies:\n${fehlt.map((x) => `\t${x === 'libmess' ? 'libmess.so.1()(64bit)' : x} is needed by ${voll(p)}`).join('\n')}`);
        installieren(w, [p.name], [p]);
        return ok(hat('h') ? `Verifying...                          ################################# [100%]\nPreparing...                          ################################# [100%]\nUpdating / installing...\n   1:${voll(p)}       ################################# [100%]` : '');
      }
      void roh;
      return fehler('rpm: Der Simulator kennt: -i, -U, -F, -e, -q (mit a, i, l, f, p, R, c), -V, -K, --import');
    },
    rpm2cpio: (w, a) => {
      const n = nurRpm(w, 'rpm2cpio'); if (n) return n;
      if (pfad(w, a[0] ?? '') !== RPM_DATEI_PFAD) return fehler(`error: ${a[0] ?? ''}: open failed: No such file or directory`);
      return ok('\u0007CPIO:' + RPM_DATEI.dateien.join(','));
    },
    cpio: (w, a, stdin) => {
      if (!stdin.startsWith('\u0007CPIO:')) return fehler('cpio: premature end of archive');
      const dateien = stdin.slice(6).split(',');
      const ausp = a.some((x) => x.startsWith('-') && x.includes('i') && x.includes('d'));
      const listen = a.some((x) => x.startsWith('-') && x.includes('t'));
      if (listen) return ok(dateien.map((f) => '.' + f).join('\n') + '\n298 blocks');
      if (!ausp) return fehler('cpio: Im Simulator: rpm2cpio datei.rpm | cpio -idmv (auspacken) oder | cpio -t (auflisten)');
      for (const f of dateien) dateiAnlegen(w, `${w.cwd === '/' ? '' : w.cwd}${f}`, f.endsWith('.conf') ? '# Beispielkonfiguration\n' : '(ELF-Programm)');
      return ok((a.some((x) => x.includes('v')) ? dateien.map((f) => '.' + f).join('\n') + '\n' : '') + '298 blocks');
    },
    dnf: (w, a, _i, root) => dnfYum(w, a, root, 'dnf'),
    yum: (w, a, _i, root) => dnfYum(w, a, root, 'yum'),
    zypper: (w, a, _i, root) => {
      if (w.distro !== 'suse') return fehler('bash: zypper: command not found\n(zypper gibt es auf openSUSE und SUSE Linux Enterprise. Im Simulator: Terminal mit openSUSE.)', 127);
      const { flags, rest } = optionen(a);
      const [cmd, ...pk] = rest;
      const ja = flags.has('-y') || flags.has('-n') || flags.has('--non-interactive');
      const kopf = 'Loading repository data...\nReading installed packages...';
      switch (cmd) {
        case 'refresh': case 'ref': return root ? ok('Retrieving repository \'Main Repository\' metadata ...[done]\nBuilding repository \'Main Repository\' cache ....[done]\nAll repositories have been refreshed.') : fehler('Root privileges are required to refresh system repositories.', 5);
        case 'repos': case 'lr': return ok('# | Alias    | Name            | Enabled | GPG Check | Refresh\n--+----------+-----------------+---------+-----------+--------\n1 | repo-oss | Main Repository | Yes     | (r ) Yes  | Yes');
        case 'addrepo': case 'ar': return root ? ok(`Adding repository '${pk[1] ?? pk[0]}' ..........[done]\nRepository '${pk[1] ?? pk[0]}' successfully added`) : fehler('Root privileges are required for modifying system repositories.', 5);
        case 'search': case 'se': { const re = new RegExp(pk[0] ?? '', 'i'); const t = SUSE.filter((x) => re.test(x.name)); return t.length ? ok(`${kopf}\n\nS  | Name | Summary | Type\n---+------+---------+--------\n${t.map((x) => `${ii(w, x.name) ? 'i+' : '  '} | ${x.name} | ${x.text} | package`).join('\n')}`) : fehler(`${kopf}\nNo matching items found.`, 104); }
        case 'info': case 'if': { const x = SUSE.find((y) => y.name === pk[0]); return x ? ok(`${kopf}\n\nInformation for package ${x.name}:\n${'-'.repeat(25 + x.name.length)}\nRepository     : Main Repository\nName           : ${x.name}\nVersion        : ${x.version}\nArch           : x86_64\nInstalled      : ${ii(w, x.name) ? 'Yes' : 'No'}\nSummary        : ${x.text}`) : fehler(`package '${pk[0]}' not found.`, 104); }
        case 'what-provides': case 'wp': { const t = SUSE.filter((x) => x.dateien.some((f) => f.includes(pk[0] ?? ''))); return ok(`${kopf}\n\nS  | Name | Summary | Type\n---+------+---------+--------\n${t.map((x) => `${ii(w, x.name) ? 'i+' : '  '} | ${x.name} | ${x.text} | package`).join('\n')}`); }
        case 'install': case 'in': {
          if (!root) return fehler('Root privileges are required for installing or uninstalling packages.', 5);
          const { neu, unbekannt } = fehlend(w, pk);
          if (unbekannt.length) return fehler(`${kopf}\nPackage '${unbekannt[0]}' not found.`, 104);
          if (!neu.length) return ok(`${kopf}\n'${pk[0]}' is already installed.\nNothing to do.`);
          const plan = `${kopf}\nResolving package dependencies...\n\nThe following ${neu.length} NEW package${neu.length > 1 ? 's are' : ' is'} going to be installed:\n  ${neu.join(' ')}\n\n${neu.length} new package${neu.length > 1 ? 's' : ''} to install.`;
          const tun = () => { installieren(w, neu); return ok(neu.map((x, k) => `(${k + 1}/${neu.length}) Installing: ${x}-${finde(w, x)!.version}.x86_64 ....[done]`).join('\n')); };
          if (!ja) return nachfragen(w, 'Continue? [y/n/v/...? shows all options] (y):', true, tun, plan);
          return ok(plan + '\n' + tun().out);
        }
        case 'remove': case 'rm': {
          if (!root) return fehler('Root privileges are required for installing or uninstalling packages.', 5);
          if (!ii(w, pk[0])) return ok(`${kopf}\n'${pk[0]}' not found in package names. Trying capabilities.\nNo provider of '${pk[0]}' found.`);
          const tun = () => { entfernen(w, pk[0], true); return ok(`(1/1) Removing ${pk[0]}-${finde(w, pk[0])!.version}.x86_64 ....[done]`); };
          const plan = `${kopf}\nResolving package dependencies...\n\nThe following package is going to be REMOVED:\n  ${pk[0]}`;
          if (!ja) return nachfragen(w, 'Continue? [y/n/v/...? shows all options] (y):', true, tun, plan);
          return ok(plan + '\n' + tun().out);
        }
        case 'update': case 'up': return root ? ok(`${kopf}\nNothing to do.`) : fehler('Root privileges are required for installing or uninstalling packages.', 5);
        default: return fehler('zypper: Der Simulator kennt: refresh/ref, repos/lr, addrepo/ar, search/se, info/if, what-provides/wp, install/in, remove/rm, update/up');
      }
    },
    // ---------- Virtualisierung und Klonen ----------
    'systemd-detect-virt': (w) => w.virt === 'none' ? { out: 'none', code: 1 } : ok(w.virt),
    hostnamectl: (w, a, _i, root) => {
      if (a[0] === 'set-hostname' || a[0] === 'hostname') { if (!a[1]) return ok(w.host); if (!root) return fehler('Could not set static hostname: Access denied'); w.host = a[1]; w.fs['/etc/hostname'] = a[1] + '\n'; return ok(); }
      return ok(` Static hostname: ${w.host}\n       Icon name: ${w.virt === 'none' ? 'computer-desktop' : 'computer-vm'}\n         Chassis: ${w.virt === 'none' ? 'desktop' : 'vm'}\n      Machine ID: ${(w.fs['/etc/machine-id'] ?? '').trim() || '(leer)'}\n  Virtualization: ${w.virt}\nOperating System: ${w.distro === 'alma' ? 'AlmaLinux 9.4 (Seafoam Ocelot)' : w.distro === 'suse' ? 'openSUSE Leap 15.6' : 'Debian GNU/Linux 12 (bookworm)'}\n          Kernel: Linux ${w.kernel}`);
    },
    'ssh-keygen': (w, a, _i, root) => {
      if (!a.includes('-A')) return fehler('ssh-keygen: Im Simulator nur „ssh-keygen -A“ (fehlende Host-Schlüssel erzeugen).');
      if (!root) return fehler('ssh-keygen: generating new host keys: RSA Saving key "/etc/ssh/ssh_host_rsa_key" failed: Permission denied');
      const neu: string[] = [];
      for (const t of ['rsa', 'ecdsa', 'ed25519']) if (!(`/etc/ssh/ssh_host_${t}_key` in w.fs)) { w.fs[`/etc/ssh/ssh_host_${t}_key`] = `(neuer privater ${t}-Schlüssel)\n`; w.fs[`/etc/ssh/ssh_host_${t}_key.pub`] = `ssh-${t} AAAA…NEU root@${w.host}\n`; neu.push(t.toUpperCase()); }
      return ok(neu.length ? `ssh-keygen: generating new host keys: ${neu.join(' ')}` : '');
    },
    'systemd-machine-id-setup': (w, _a, _i, root) => {
      if (!root) return fehler('Failed to open /etc/machine-id: Permission denied');
      if ((w.fs['/etc/machine-id'] ?? '').trim()) return ok(`Initializing machine ID from existing ID.`);
      const id = neueId(); st(w).maschinenId = id; w.fs['/etc/machine-id'] = id + '\n';
      return ok(`Initializing machine ID from random generator.`);
    },
    'cloud-init': (w, a) => w.virt === 'none' ? fehler('bash: cloud-init: Befehl nicht gefunden', 127) : ok(a[0] === 'status' ? 'status: done' : 'cloud-init: Im Simulator nur „cloud-init status“.'),
  };

  function dnfYum(w: Welt, a: string[], root: boolean, name: string): Ergebnis {
    if (w.distro === 'debian') return fehler(`bash: ${name}: Befehl nicht gefunden (${name} gibt es auf Red-Hat-Systemen. Auf Debian: apt-get)`, 127);
    if (w.distro === 'suse') return fehler(`bash: ${name}: command not found`, 127);
    const { flags, rest } = optionen(a);
    const [cmd, ...pk] = rest;
    const ja = flags.has('-y') || flags.has('--assumeyes');
    const kopf = 'Last metadata expiration check: 0:12:41 ago on Mon 23 Nov 2026 08:28:02 AM CET.';
    const braucht = ['install', 'remove', 'erase', 'upgrade', 'update', 'reinstall', 'autoremove'];
    if (braucht.includes(cmd) && !root) return fehler('Error: This command has to be run with superuser privileges (under the root user on most systems).');
    const tabelle = (titel: string, liste: Paket[]) => `${'='.repeat(78)}\n Package        Architecture   Version                  Repository        Size\n${'='.repeat(78)}\n${titel}:\n${liste.map((p) => ` ${p.name.padEnd(14)} ${p.arch!.padEnd(14)} ${p.version.padEnd(24)} ${(p.repo === '@commandline' ? '@commandline' : p.repo)!.padEnd(17)} ${p.groesse} k`).join('\n')}`;
    switch (cmd) {
      case 'install': case 'reinstall': {
        if (!pk.length) return fehler('Error: Need to pass a list of pkgs to install');
        let extra: Paket[] = [];
        let namen = pk;
        if (pk[0].startsWith('./') || pk[0].startsWith('/')) { if (pfad(w, pk[0]) !== RPM_DATEI_PFAD) return fehler(`Can not load RPM file: ${pk[0]}.\nCould not open: ${pk[0]}`); extra = [RPM_DATEI]; namen = ['messsoft']; }
        if (cmd === 'reinstall') { if (!ii(w, namen[0])) return fehler(`Package ${namen[0]} available, but not installed.\nError: No packages marked for reinstall.`); return ok(`${kopf}\nDependencies resolved.\n${tabelle('Reinstalling', [finde(w, namen[0])!])}\n\nComplete!`); }
        const { neu, unbekannt } = fehlend(w, namen, extra);
        if (unbekannt.length) return fehler(`${kopf}\nNo match for argument: ${unbekannt[0]}\nError: Unable to find a match: ${unbekannt[0]}`);
        if (!neu.length) return ok(`${kopf}\nPackage ${namen[0]}-${(extra[0] ?? finde(w, namen[0]))!.version}.x86_64 is already installed.\nDependencies resolved.\nNothing to do.\nComplete!`);
        const ps = neu.map((x) => extra.find((e) => e.name === x) ?? finde(w, x)!);
        const haupt = ps.filter((p) => namen.includes(p.name)); const abh = ps.filter((p) => !namen.includes(p.name));
        const plan = `${kopf}\nDependencies resolved.\n${tabelle('Installing', haupt)}${abh.length ? `\nInstalling dependencies:\n${abh.map((p) => ` ${p.name.padEnd(14)} ${p.arch!.padEnd(14)} ${p.version.padEnd(24)} ${p.repo!.padEnd(17)} ${p.groesse} k`).join('\n')}` : ''}\n\nTransaction Summary\n${'='.repeat(78)}\nInstall  ${neu.length} Package${neu.length > 1 ? 's' : ''}\n`;
        const tun = () => { installieren(w, neu, extra); return ok(`Running transaction\n${neu.map((x, k) => `  Installing       : ${x}  ${k + 1}/${neu.length}`).join('\n')}\n\nInstalled:\n  ${ps.map((p) => `${p.name}-${p.version}.${p.arch}`).join('  ')}\n\nComplete!`); };
        if (!ja) return nachfragen(w, 'Is this ok [y/N]:', false, tun, plan);
        return ok(plan + '\n' + tun().out);
      }
      case 'remove': case 'erase': {
        const p = pk[0]; if (!ii(w, p)) return fehler(`No match for argument: ${p}\nNo packages marked for removal.\nDependencies resolved.\nNothing to do.\nComplete!`);
        const mit = [p, ...wer(w, p)];
        const plan = `Dependencies resolved.\n${tabelle('Removing', mit.map((x) => alleBekannt(w).find((y) => y.name === x)!))}\n\nTransaction Summary\n${'='.repeat(78)}\nRemove  ${mit.length} Package${mit.length > 1 ? 's' : ''}\n`;
        const tun = () => { mit.forEach((x) => entfernen(w, x, true)); return ok(`Running transaction\n${mit.map((x) => `  Erasing          : ${x}`).join('\n')}\n\nRemoved:\n  ${mit.join('  ')}\n\nComplete!`); };
        if (!ja) return nachfragen(w, 'Is this ok [y/N]:', false, tun, plan);
        return ok(plan + '\n' + tun().out);
      }
      case 'upgrade': case 'update': return ok(`${kopf}\nDependencies resolved.\nNothing to do.\nComplete!`);
      case 'search': { const re = new RegExp(pk[0] ?? '', 'i'); const t = RPM.filter((x) => verfuegbar(w, x) && (re.test(x.name) || re.test(x.text))); return t.length ? ok(`${kopf}\n${'='.repeat(20)} Name Matched: ${pk[0]} ${'='.repeat(20)}\n${t.map((x) => `${x.name}.${x.arch} : ${x.text}`).join('\n')}`) : fehler(`${kopf}\nNo matches found.`); }
      case 'info': { const x = RPM.find((y) => y.name === pk[0] && verfuegbar(w, y)); if (!x) return fehler(`${kopf}\nError: No matching Packages to list`); return ok(`${kopf}\n${ii(w, x.name) ? 'Installed' : 'Available'} Packages\nName         : ${x.name}\nVersion      : ${x.version.split('-')[0]}\nRelease      : ${x.version.split('-').slice(1).join('-')}\nArchitecture : ${x.arch}\nSize         : ${x.groesse} k\nRepository   : ${ii(w, x.name) ? '@System' : x.repo}\nSummary      : ${x.text}`); }
      case 'provides': case 'whatprovides': {
        const s = pk[0] ?? ''; const t = RPM.filter((x) => verfuegbar(w, x) && x.dateien.some((f) => f === s || f.endsWith('/' + s.replace(/^\*\//, ''))));
        if (!t.length) return fehler(`${kopf}\nError: No matches found. If searching for a file, try specifying the full path or using a wildcard prefix ("*/") at the beginning.`);
        return ok(`${kopf}\n${t.map((x) => `${x.name}-${x.version}.${x.arch} : ${x.text}\nRepo        : ${ii(w, x.name) ? '@System' : x.repo}\nMatched from:\nFilename    : ${x.dateien.find((f) => f === s || f.endsWith('/' + s.replace(/^\*\//, '')))}`).join('\n\n')}`);
      }
      case 'list': {
        const nurInst = flags.has('--installed') || pk[0] === 'installed';
        const liste = RPM.filter((x) => verfuegbar(w, x) && (nurInst ? ii(w, x.name) : true));
        return ok(`${kopf}\n${nurInst ? 'Installed Packages' : 'Installed Packages / Available Packages'}\n${liste.map((x) => `${(x.name + '.' + x.arch).padEnd(34)} ${x.version.padEnd(22)} ${ii(w, x.name) ? '@' + x.repo : x.repo}`).join('\n')}`);
      }
      case 'repolist': return ok(`repo id                       repo name\n${st(w).repos.map((r) => `${r.padEnd(29)} ${r === 'epel' ? 'Extra Packages for Enterprise Linux 9 - x86_64' : `AlmaLinux 9 - ${r === 'baseos' ? 'BaseOS' : r === 'appstream' ? 'AppStream' : 'Extras'}`}`).join('\n')}`);
      case 'autoremove': return ok(`${kopf}\nDependencies resolved.\nNothing to do.\nComplete!`);
      default: return fehler(`No such command: ${cmd ?? ''}. Please use /usr/bin/${name} --help\n(Der Simulator kennt: install, reinstall, remove, upgrade, search, info, provides, list, repolist)`);
    }
  }
  return b;
}

// Wo der dynamische Linker libmess.so.1 findet, oder null
export function libFindbar(w: Welt): string | null {
  const ld = (w.env?.LD_LIBRARY_PATH ?? '').split(':').filter(Boolean);
  if (ld.includes('/opt/messsoft/lib')) return '/opt/messsoft/lib';
  if (w.pakete?.ldCache.includes('/opt/messsoft/lib')) return '/opt/messsoft/lib';
  return null;
}

// Programme, die man mit Pfad startet
export function programmStarten(w: Welt, p: string): Ergebnis | null {
  if (p === '/opt/messsoft/bin/messprog') {
    if (!libFindbar(w)) return { out: `${p}: error while loading shared libraries: libmess.so.1: cannot open shared object file: No such file or directory`, code: 127 };
    return { out: 'Messprogramm 1.2 bereit. Kanal 1: 23,4 °C', code: 0 };
  }
  if (p === '/usr/bin/messsoft' && w.pakete?.installiert.messsoft === 'ii') return { out: 'messsoft 1.2: läuft.', code: 0 };
  return null;
}

export function neustartPakete(w: Welt) {
  if (!w.pakete) return;
  // systemd erzeugt beim Start eine neue machine-id, wenn die Datei leer ist
  if (!(w.fs['/etc/machine-id'] ?? '').trim()) { const id = neueId(); w.pakete.maschinenId = id; w.fs['/etc/machine-id'] = id + '\n'; }
  // Debian: Fehlende SSH-Host-Schlüssel erzeugt der Dienst nicht von selbst neu, das macht dpkg-reconfigure oder ssh-keygen -A.
}

function neueId() { let s = ''; for (let i = 0; i < 32; i++) s += '0123456789abcdef'[Math.floor(Math.random() * 16)]; return s; }
function hash(s: string) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }

export function zustandPakete(w: Welt, s: string): boolean | undefined {
  let m;
  if ((m = s.match(/^paket:([\w.+-]+)=(an|aus|rc)$/))) { const x = w.pakete?.installiert[m[1]]; return m[2] === 'an' ? x === 'ii' : m[2] === 'rc' ? x === 'rc' : !x; }
  if ((m = s.match(/^repo:(\w+)=an$/))) return !!w.pakete?.repos.includes(m[1]);
  if ((m = s.match(/^ldcache:(.+)$/))) return !!w.pakete?.ldCache.includes(m[1]);
  if ((m = s.match(/^env:(\w+)~(.+)$/))) return new RegExp(m[2]).test(w.env?.[m[1]] ?? '');
  if ((m = s.match(/^maschinenid=neu$/))) return !!w.pakete && w.pakete.maschinenId !== 'b3f1c2e4a5d64f7e8a9b0c1d2e3f4a5b';
  if (s === 'grubaktuell') return w.fs['/boot/grub/grub.cfg'] === grubCfg(w);
  return undefined;
}
