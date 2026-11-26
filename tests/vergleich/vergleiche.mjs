// Vergleicht die Ergebnisse eines echten Systems mit denen des Simulators.
// Maßgeblich ist der Rückgabecode, also ob ein Programm eine Konfiguration annimmt oder ablehnt.
//   node tests/vergleich/vergleiche.mjs echt.json simulator.json [--markdown bericht.md]
// Rückgabecode 1, wenn sich etwas unterscheidet.
import fs from 'node:fs';
const [echtDatei, simDatei] = process.argv.slice(2);
const mi = process.argv.indexOf('--markdown'); const md = mi > 0 ? process.argv[mi + 1] : null;
const echt = JSON.parse(fs.readFileSync(echtDatei, 'utf8')); const sim = JSON.parse(fs.readFileSync(simDatei, 'utf8'));
const zeilen = [`## ${echt.system} gegen ${sim.system}`, ''];
let gesamt = 0; let abw = 0;
const kurz = (s) => (s || '–').split('\n').slice(0, 2).join(' / ').replace(/\|/g, '\\|').slice(0, 140);
for (const [g, e] of Object.entries(echt.gruppen)) {
  const s = sim.gruppen[g]; if (!s) { zeilen.push(`Gruppe ${g} fehlt im Simulator.`); abw++; continue; }
  const unterschiede = [];
  for (const f of e.faelle) {
    gesamt++;
    const t = s.faelle.find((x) => x.name === f.name);
    if (!t) { unterschiede.push(`| ${f.name} | ${f.code} | fehlt | ${kurz(f.ausgabe)} | |`); continue; }
    if (t.code !== f.code) unterschiede.push(`| ${f.name} | ${f.code} | ${t.code} | ${kurz(f.ausgabe)} | ${kurz(t.ausgabe)} |`);
  }
  abw += unterschiede.length;
  zeilen.push(`### ${g} (${e.version ?? ''}): ${e.faelle.length - unterschiede.length} von ${e.faelle.length} gleich`, '');
  if (unterschiede.length) zeilen.push('| Fall | echt | Simulator | Ausgabe echt | Ausgabe Simulator |', '|---|---|---|---|---|', ...unterschiede, '');
}
zeilen.push(`**${gesamt - abw} von ${gesamt} Fällen gleich.**`);
const text = zeilen.join('\n');
console.log(text);
if (md) fs.appendFileSync(md, text + '\n\n');
process.exit(abw ? 1 : 0);
