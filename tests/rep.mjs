// Spielt Befehle im Simulator ab und zeigt Ausgabe und Rückgabecode.
// node tests/rep.mjs 'BEFEHL\nBEFEHL' '{"weltoption":…}' [kurz]
// Zeilen mit "#z ZUSTAND" prüfen einen Zustand, "#neustart" startet die Welt neu.
import { simulator } from './lib/bauen.mjs';
const { neueWelt, ausfuehren, neuStarten, zustandStimmt } = await simulator();
const w = neueWelt(JSON.parse(process.argv[3] ?? '{}'));
const kurz = process.argv[4] === 'kurz';
for (const z of (process.argv[2] ?? '').split('\n')) {
  if (z.startsWith('#z ')) { console.log(`ZUSTAND ${z.slice(3)} => ${zustandStimmt(w, z.slice(3))}`); continue; }
  if (z === '#neustart') { const m = neuStarten(w); w.verlauf.push({ zeile: '#neustart', code: 0, ausgabe: '' }); console.log(`--- Neustart --- ${m ?? ''}`); continue; }
  const r = ausfuehren(w, z); let a = r.ausgabe;
  if (kurz && a.split('\n').length > 12) a = a.split('\n').slice(0, 12).join('\n') + '\n…';
  console.log(`$ ${z}\n${a}${a ? '\n' : ''}[${r.code}]`);
}
