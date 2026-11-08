// Zentrale Einstellungen. Hier Name und Texte der Seite ändern.
export const SEITE = {
  name: '0 to Hero: Linux',
  kurzname: 'to Hero: Linux',   // neben dem Logo im Seitenkopf
  untertitel: 'Linux von null an, Befehl für Befehl',
  mission: 'Diese Website wurde gebaut, um jedem Menschen die Möglichkeit zu geben, das System zu verstehen, auf dem Webserver, Router und Supercomputer laufen: vom ersten Befehl bis zum eigenen, abgesicherten Server.',
  repo: 'https://github.com/r-winter-mute-dev/ZEROTOHERO-LINUX', // Link zum GitHub-Repository
  schwester: { name: '0 to Hero', url: 'https://r-winter-mute-dev.github.io/ZEROTOHERO/' }, // Elektronik-Kurs
};

/** Pfad relativ zur Basis der Seite (wichtig für GitHub Pages unter /repo-name/). */
export function url(pfad = ''): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const p = pfad.replace(/^\//, '');
  return `${base}/${p}`;
}
