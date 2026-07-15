// First-run defaults. Everything here is editable in the app afterwards —
// these just make an empty DATA_DIR usable immediately. Collections for
// later build phases (expenses, exchanges, rates-cache, policies) are seeded
// now so the schema is stable from day one.

export const SEEDS = {
  travelers: [],
  cards: [],
  programs: [],
  trips: [],
  segments: [],
  candidates: [],
  expenses: [],
  exchanges: [],
  'rates-cache': {},
  policies: [],
  settings: {
    homeCurrency: 'SGD',
    // Markdown mirror: written under DATA_DIR/mirror by default; point
    // mirrorDir (or the MIRROR_DIR env var, which wins) anywhere you like —
    // e.g. a private folder inside an Obsidian vault.
    mirrorDir: null,
    mirrorAuto: true
  }
};

export function ensureSeed(store) {
  for (const [name, value] of Object.entries(SEEDS)) {
    if (!store.exists(name)) store.write(name, value);
  }
}
