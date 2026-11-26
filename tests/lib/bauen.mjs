// Bündelt TypeScript-Module des Projekts für Node, damit Tests den echten Simulator und die echten Daten benutzen.
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

export const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Baut <eingang> (relativ zur Projektwurzel) nach tests/.build/<name>.mjs und lädt es. */
export async function laden(eingang, name) {
  const aus = path.join(WURZEL, 'tests/.build', `${name}.mjs`);
  await build({ entryPoints: [path.join(WURZEL, eingang)], bundle: true, format: 'esm', platform: 'node', outfile: aus, logLevel: 'error' });
  return import(pathToFileURL(aus).href + `?t=${Date.now()}`);
}
export const simulator = () => laden('src/scripts/shell.ts', 'shell');
