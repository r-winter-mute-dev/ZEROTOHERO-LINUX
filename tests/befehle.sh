#!/usr/bin/env bash
# Befehle aus den Missionen, geprüft in einem frischen Debian-Container (läuft dort als root).
# Lokal: docker run --rm -v "$PWD/tests:/tests:ro" debian:13 bash /tests/befehle.sh
# Neue Missionen hängen ihre Befehle unten an. Interaktive Schritte (passwd, Installer, Editoren)
# werden ersetzt und das im Kommentar vermerkt.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
schritt() { printf '\n== %s ==\n' "$1"; }

schritt "Zum Vergleich mit dem Simulator (src/scripts/shell.ts)"
cat /etc/os-release
cat /etc/debian_version
uname -r

schritt "0.3 Benutzer wie nach WSL-Ersteinrichtung oder Installer (root-Passwort leer)"
# Ersetzt die Abfrage von Benutzername und Passwort beim ersten Start bzw. im Installer.
apt-get update
apt-get install -y sudo
useradd -m -s /bin/bash mia
usermod -aG sudo mia
echo 'mia:uebung' | chpasswd

schritt "0.3 Aktualisieren, wie in der Mission (als mia mit sudo)"
echo 'uebung' | su mia -c 'sudo -S -k apt update'
echo 'uebung' | su mia -c 'sudo -S -k apt full-upgrade -y'

schritt "0.3 Nachweis: Debian und kein root"
ausgabe=$(su mia -c 'cat /etc/os-release; whoami')
printf '%s\n' "$ausgabe"
grep -qx 'ID=debian' <<<"$ausgabe"
grep -qx 'mia' <<<"$ausgabe"
id -nG mia | grep -qw sudo

schritt "0.4 Nachweis: Prüfsumme wie im Browser"
# Der Browser rechnet SHA-256 über "<code>\n". Für den Code falke-4821 ist das:
erwartet='46c357b4da937926eab67ffe1641bc9b20a8094ca760c0819aa5c3a98343ede3'
ausgabe=$(su mia -c 'echo falke-4821 | sha256sum')
printf '%s\n' "$ausgabe"
[[ "$ausgabe" =~ ^[0-9a-f]{64}\ \ -$ ]]
[[ "${ausgabe%% *}" == "$erwartet" ]]

schritt "Simulator: Befehle, die er anbietet, gibt es im frischen Debian wirklich"
# man fehlt im schlanken Container-Abbild, gehört aber zu den Standard-Systemwerkzeugen einer
# echten Installation. Deshalb wird es hier nachinstalliert und mitgeprüft.
apt-get install -y man-db
for b in whoami ls cat pwd cd mkdir touch echo uname date history exit hostname man; do
  type "$b" >/dev/null || { echo "fehlt: $b"; exit 1; }
done

schritt "Simulator: Prompt wie im Standard-.bashrc"
grep -F "PS1='\${debian_chroot:+(\$debian_chroot)}\\u@\\h:\\w\\\$ '" /etc/skel/.bashrc

printf '\nAlle Befehle funktionieren auf diesem Debian.\n'
