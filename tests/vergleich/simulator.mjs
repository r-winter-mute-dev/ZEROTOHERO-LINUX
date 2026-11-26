// Führt die Vergleichsfälle im Simulator aus, jeden in einer frischen Welt als root.
//   node tests/vergleich/simulator.mjs SYSTEMNAME ergebnis.json [faelle/…json]
// SYSTEMNAME debian oder alma wählt die Distribution der Welt.
import fs from 'node:fs';
import path from 'node:path';
import { simulator, laden, WURZEL } from '../lib/bauen.mjs';
const { neueWelt, ausfuehren } = await simulator();
const { meta } = await laden('src/scripts/shell-dateien.ts', 'dateien');
const [system = 'debian', ziel = '/dev/stdout', ...dateien0] = process.argv.slice(2);
const ordner = path.join(WURZEL, 'tests/vergleich/faelle');
const dateien = dateien0.length ? dateien0 : fs.readdirSync(ordner).filter((d) => d.endsWith('.json')).sort().map((d) => path.join(ordner, d));
const ergebnis = { system: `simulator-${system}`, gruppen: {} };
for (const d of dateien) {
  const gruppe = JSON.parse(fs.readFileSync(d, 'utf8'));
  const liste = [];
  for (const fall of gruppe.faelle) {
    const w = neueWelt({ ...(gruppe.welt ?? {}), root: true, distro: system === 'alma' ? 'alma' : 'debian' });
    for (const [p, x] of Object.entries(fall.dateien)) { w.fs[p] = x.inhalt; const m = meta(w, p); m.mode = parseInt(x.modus ?? '600', 8); m.owner = 'root'; m.group = 'root'; }
    for (const v of fall.vorher ?? []) ausfuehren(w, v);
    const r = ausfuehren(w, fall.befehl);
    liste.push({ name: fall.name, code: r.code, ausgabe: r.ausgabe.trim(), ...(fall.ausgabe ? { vergleicheAusgabe: true } : {}) });
  }
  ergebnis.gruppen[path.basename(d, '.json')] = { faelle: liste };
}
fs.writeFileSync(ziel, JSON.stringify(ergebnis, null, 1));
