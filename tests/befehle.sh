#!/usr/bin/env bash
# Befehle aus den Missionen, geprüft in einem frischen archlinux:latest-Container (läuft dort als root).
# Lokal: docker run --rm -v "$PWD/tests:/tests:ro" archlinux:latest bash /tests/befehle.sh
# Neue Missionen hängen ihre Befehle unten an. Interaktive Schritte (passwd, Editoren) werden ersetzt
# und das im Kommentar vermerkt.
set -euo pipefail
schritt() { printf '\n== %s ==\n' "$1"; }

schritt "0.3 Ersteinrichtung, Weg A (WSL)"
pacman -Syu --noconfirm
pacman -S --needed --noconfirm sudo nano
useradd -m -G wheel mia
echo 'mia:uebung' | chpasswd                      # ersetzt das interaktive "passwd mia"
echo '%wheel ALL=(ALL:ALL) ALL' > /etc/sudoers.d/wheel
chmod 440 /etc/sudoers.d/wheel
visudo -c
printf '[user]\ndefault=mia\n' >> /etc/wsl.conf
grep -qx '\[user\]' /etc/wsl.conf
grep -qx 'default=mia' /etc/wsl.conf

schritt "0.3 Nachweis: Arch und kein root"
ausgabe=$(su mia -c 'cat /etc/os-release; whoami')
printf '%s\n' "$ausgabe"
grep -qx 'ID=arch' <<<"$ausgabe"
grep -qx 'mia' <<<"$ausgabe"
id -nG mia | grep -qw wheel

schritt "0.3 sudo funktioniert für mia"
echo 'uebung' | su mia -c 'sudo -S -k true'

schritt "0.4 Nachweis: Prüfsumme wie im Browser"
# Der Browser rechnet SHA-256 über "<code>\n". Für den Code falke-4821 ist das:
erwartet='46c357b4da937926eab67ffe1641bc9b20a8094ca760c0819aa5c3a98343ede3'
ausgabe=$(echo falke-4821 | sha256sum)
printf '%s\n' "$ausgabe"
[[ "$ausgabe" =~ ^[0-9a-f]{64}\ \ -$ ]]
[[ "${ausgabe%% *}" == "$erwartet" ]]

schritt "Simulator: Befehle, die er anbietet, gibt es im frischen Arch wirklich"
for b in whoami ls cat pwd cd mkdir touch echo uname date history exit; do
  type "$b" >/dev/null || { echo "fehlt: $b"; exit 1; }
done

schritt "Simulator: Befehle, die er als nicht vorinstalliert meldet, fehlen wirklich"
# Gilt auch nach der Ersteinrichtung oben (sudo und nano ziehen keins von beiden nach).
for b in hostname man; do
  if type "$b" >/dev/null 2>&1; then echo "Achtung: $b ist inzwischen vorinstalliert, Simulator anpassen"; exit 1; fi
done

printf '\nAlle Befehle funktionieren auf dem aktuellen Arch.\n'
