// Gibt die IDs aller spielbaren Missionen in Kampagnenreihenfolge aus, durch Kommas getrennt.
import fs from 'node:fs';
import path from 'node:path';
import { laden, WURZEL } from './lib/bauen.mjs';
const { ALLE_MISSIONEN } = await laden('src/data/kampagne.ts', 'kampagne');
const ids = ALLE_MISSIONEN.filter((m) => m.bereit && fs.existsSync(path.join(WURZEL, 'src/missionen', `${m.id}.mdx`))).map((m) => m.id);
console.log(ids.join(','));
