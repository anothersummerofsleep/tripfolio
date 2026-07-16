import fs from 'node:fs';
import path from 'node:path';

// A self-describing capability manifest so an AI agent (Claude Code, Cowork,
// or anything that speaks HTTP) can orient itself against a running tripfolio
// without prior knowledge: what it is, how to read and write data, the
// conventions to follow, and which ready-made skills ship with the repo.
// Served at /api/agent-manifest — point an agent here and it can self-configure.

// Curated on purpose (not auto-derived from the route table) so every entry
// carries a plain-English purpose an agent can reason about.
const ENDPOINTS = [
  { method: 'GET', path: '/api/health', purpose: 'Confirm tripfolio is running and list its collections.' },
  { method: 'GET', path: '/api/agent-manifest', purpose: 'This document. Add ?format=md for a Markdown version to paste into an agent.' },
  { method: 'GET', path: '/api/{collection}', purpose: 'List every item in a collection (see collections below).' },
  { method: 'POST', path: '/api/{collection}', purpose: 'Append one item; the server assigns its id. The agent-write path for bookings, expenses, policies, etc.' },
  { method: 'PATCH', path: '/api/{collection}/{id}', purpose: 'Update fields on one item.' },
  { method: 'DELETE', path: '/api/{collection}/{id}', purpose: 'Remove one item.' },
  { method: 'POST', path: '/api/extract-booking', purpose: 'Body { content }: heuristically extract flight/hotel segments from a confirmation email (read-only preview).' },
  { method: 'POST', path: '/api/extract-policy', purpose: 'Body { content } or { pdf, filename }: heuristically extract insurance policy fields from pasted text or a text-based PDF (read-only preview).' },
  { method: 'POST', path: '/api/candidates/{id}/promote', purpose: 'Turn a candidate option into a confirmed booking segment.' },
  { method: 'GET', path: '/api/trips/{id}/settlement', purpose: 'Per-trip spend total, per-person balances, and minimal settle-up transfers in the home currency.' },
  { method: 'GET', path: '/api/trips/{id}/coverage', purpose: 'Insurance coverage badge for a trip (covered / partial / uncovered) with reasons.' },
  { method: 'POST', path: '/api/expenses/{id}/refresh-rate', purpose: 'Re-fetch the FX rate for an expense left pending or on an estimate.' },
  { method: 'GET', path: '/api/rates', purpose: 'Query params source,date,from,to: a cached daily FX rate.' },
  { method: 'POST', path: '/api/policies/{id}/pdf', purpose: 'Attach a policy document (body { filename, content } with content base64).' },
  { method: 'GET', path: '/api/policies/{id}/pdf', purpose: 'Read a stored policy document — answer fine-print coverage questions from the wording.' },
  { method: 'POST', path: '/api/mirror', purpose: 'Regenerate the Obsidian-browsable Markdown mirror of all data.' }
];

const CONVENTIONS = {
  dates: 'Calendar dates are YYYY-MM-DD.',
  datetimes: 'Times are local wall-clock, YYYY-MM-DDTHH:mm (no timezone maths — the departure city\'s clock).',
  currency: 'Currencies are ISO-4217 codes; the home/settlement currency is in settings.homeCurrency.',
  ids: 'Never invent ids — POST without one and the server assigns it. Reference other records by their id.',
  writes: 'One item per POST. Show the user what you parsed before writing side-effectful data.'
};

const HOW_TO_USE = [
  'tripfolio is a local-first travel database with a JSON HTTP API. Read a running instance to',
  'inform trip planning (bookings, loyalty status, budget, insurance coverage), and write back to',
  'it when the user hands you a booking confirmation, trip expenses, or an insurance policy.',
  'Prefer the shipped skills below when running inside the app repo; otherwise use the endpoints',
  'directly. Never guess a value you were not given, and confirm before writing.'
].join(' ');

// Skills are read from disk so the manifest always reflects what actually
// ships — no second list to keep in sync.
function readSkills(appDir) {
  const dir = path.join(appDir, '.claude', 'skills');
  if (!fs.existsSync(dir)) return [];
  const skills = [];
  for (const entry of fs.readdirSync(dir).sort()) {
    const file = path.join(dir, entry, 'SKILL.md');
    if (!fs.existsSync(file)) continue;
    const fm = fs.readFileSync(file, 'utf8').match(/^---\n([\s\S]*?)\n---/);
    if (!fm) continue;
    const name = (fm[1].match(/^name:\s*(.+)$/m)?.[1] || entry).trim();
    const description = (fm[1].match(/^description:\s*(.+)$/m)?.[1] || '').trim();
    skills.push({ name, description, path: `.claude/skills/${entry}/SKILL.md` });
  }
  return skills;
}

export function buildManifest({ baseUrl, appDir, collections, version }) {
  return {
    app: 'tripfolio',
    version,
    baseUrl,
    description: 'Local-first travel database — trips, loyalty programs, FX expense splitting, and insurance coverage in plain JSON.',
    howToUse: HOW_TO_USE,
    collections,
    endpoints: ENDPOINTS,
    skills: readSkills(appDir),
    conventions: CONVENTIONS
  };
}

// The same thing as a Markdown brief — what you paste into an agent that is
// not running inside the repo (a Cowork session, Claude Code in another folder).
export function manifestMarkdown(m) {
  const lines = [
    `# ${m.app} — AI agent guide`,
    '',
    m.description,
    '',
    `**Base URL:** \`${m.baseUrl}\`  ·  **Version:** ${m.version}`,
    '',
    '## How to use',
    m.howToUse,
    '',
    '## Endpoints',
    ...m.endpoints.map((e) => `- \`${e.method} ${e.path}\` — ${e.purpose}`),
    '',
    '## Collections',
    m.collections.map((c) => `\`${c}\``).join(', '),
    '',
    '## Conventions',
    ...Object.values(m.conventions).map((c) => `- ${c}`)
  ];
  if (m.skills.length) {
    lines.push('', '## Ready-made skills (this repo)',
      ...m.skills.map((s) => `- **${s.name}** (\`${s.path}\`) — ${s.description}`));
  }
  return lines.join('\n') + '\n';
}
