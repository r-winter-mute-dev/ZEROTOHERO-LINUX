#!/usr/bin/env python3
# Führt die Vergleichsfälle auf einem echten System aus und schreibt Rückgabecodes und Ausgaben als JSON.
# Läuft als root in einem Wegwerf-Container oder einer Wegwerf-VM, nur mit der Standardbibliothek.
#
#   python3 tests/vergleich/echt.py SYSTEMNAME ergebnis.json [faelle/sshd.json …]
#
# Die Fälle schreiben nur Dateien unter /tmp und prüfen sie mit -f, sie ändern die Konfiguration des Systems nicht.
import json, os, subprocess, sys
from pathlib import Path

HIER = Path(__file__).resolve().parent
system, ziel, *dateien = sys.argv[1:]
dateien = dateien or sorted(str(p) for p in (HIER / 'faelle').glob('*.json'))
umgebung = {**os.environ, 'LANG': os.environ.get('LTH_LANG', 'C.UTF-8'), 'LC_ALL': os.environ.get('LTH_LANG', 'C.UTF-8')}

def version(befehl):
    r = subprocess.run(befehl, shell=True, capture_output=True, text=True)
    return (r.stdout + r.stderr).strip().splitlines()[0] if (r.stdout + r.stderr).strip() else ''

ergebnis = {'system': system, 'os': Path('/etc/os-release').read_text(), 'gruppen': {}}
for d in dateien:
    gruppe = json.loads(Path(d).read_text(encoding='utf-8'))
    for v in gruppe.get('vorbereitung', []):
        subprocess.run(v, shell=True, capture_output=True, env=umgebung)
    liste = []
    for fall in gruppe['faelle']:
        for pfad, inhalt in fall['dateien'].items():
            Path(pfad).write_text(inhalt['inhalt'], encoding='utf-8')
            os.chmod(pfad, int(inhalt.get('modus', '600'), 8))
        r = subprocess.run(fall['befehl'], shell=True, capture_output=True, text=True, env=umgebung, timeout=60)
        liste.append({'name': fall['name'], 'code': r.returncode, 'ausgabe': (r.stdout + r.stderr).strip()})
        for pfad in fall['dateien']:
            Path(pfad).unlink(missing_ok=True)
    ergebnis['gruppen'][Path(d).stem] = {'version': version(gruppe.get('version', 'true')), 'faelle': liste}

Path(ziel).write_text(json.dumps(ergebnis, ensure_ascii=False, indent=1), encoding='utf-8')
print(f'{system}: {sum(len(g["faelle"]) for g in ergebnis["gruppen"].values())} Fälle nach {ziel}')
