// Zentrale Einstellungen. Hier Name und Texte der Seite ändern.
export const SEITE = {
  name: 'Linux to Hero',
  untertitel: 'Dein Weg zu LPIC-1, LPIC-2 und LPIC-3 Security',
  mission: 'Ein kostenloser Kurs für alle, die Linux wirklich beherrschen wollen: vom ersten Befehl bis zur Sicherheitszertifizierung, aufgebaut nach dem, was die Lernforschung über dauerhaftes Behalten weiß.',
  repo: 'https://github.com/r-winter-mute-dev/ZEROTOHERO-LINUX', // Link zum GitHub-Repository
};

/** Pfad relativ zur Basis der Seite (wichtig für GitHub Pages unter /repo-name/). */
export function url(pfad = ''): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const p = pfad.replace(/^\//, '');
  return `${base}/${p}`;
}
