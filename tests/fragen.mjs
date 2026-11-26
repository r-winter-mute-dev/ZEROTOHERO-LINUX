// Prüft die Fragen für Probeprüfungen: doppelte IDs und Fragen, kaputte Indizes, Leerzeichen,
// und ob die richtige Antwort auffällig länger ist als alle falschen (verrät die Lösung).
// node tests/fragen.mjs [--lang-streng]   Mit --lang-streng zählen lange richtige Antworten als Fehler.
import { laden } from './lib/bauen.mjs';
const M = await laden('src/data/fragen.ts', 'fragen');
const F = Object.values(M).find(Array.isArray);
const fehler = []; const hinweise = [];
const ids = new Set(); const texte = new Map(); const proZiel = {};
for (const f of F) {
  if (ids.has(f.id)) fehler.push(`doppelte ID ${f.id}`); ids.add(f.id);
  if (texte.has(f.frage)) fehler.push(`doppelte Frage ${f.id} = ${texte.get(f.frage)}`); texte.set(f.frage, f.id);
  proZiel[f.ziel] = (proZiel[f.ziel] ?? 0) + 1;
  if (!f.erklaerung) fehler.push(`ohne Erklärung ${f.id}`);
  if (f.typ === 'eingabe') { if (!f.richtig?.length) fehler.push(`Eingabe ohne Lösung ${f.id}`); continue; }
  if (new Set(f.optionen).size !== f.optionen.length) fehler.push(`doppelte Option ${f.id}`);
  for (const r of f.richtig) if (r >= f.optionen.length) fehler.push(`Index außerhalb ${f.id}`);
  if (f.typ === 'einfach' && f.richtig.length !== 1) fehler.push(`einfach mit ${f.richtig.length} Lösungen ${f.id}`);
  if (f.typ === 'mehrfach' && f.richtig.length < 2) fehler.push(`mehrfach mit einer Lösung ${f.id}`);
  for (const o of f.optionen) if (o !== o.trim() || /  /.test(o)) fehler.push(`Leerzeichen in Option ${f.id}`);
  if (f.typ === 'einfach') {
    const r = f.optionen[f.richtig[0]].length; const max = Math.max(...f.optionen.filter((_, i) => i !== f.richtig[0]).map((o) => o.length));
    if (r > max * 1.6) hinweise.push(`richtige Antwort auffällig lang: ${f.id} (${r} gegen höchstens ${max} Zeichen)`);
  }
}
const streng = process.argv.includes('--lang-streng');
console.log(`${F.length} Fragen in ${Object.keys(proZiel).length} Lernzielen`);
for (const h of hinweise) console.log((streng ? 'FEHLER ' : 'Hinweis ') + h);
for (const e of fehler) console.log('FEHLER ' + e);
process.exit(fehler.length || (streng && hinweise.length) ? 1 : 0);
