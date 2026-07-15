import { api } from './api.js';
import { el, toast, confirmDelete } from './ui.js';

// Agent kinds we ship a tailored connection recipe for. `recipe(baseUrl)`
// returns the lines shown when that kind is registered.
const AGENT_KINDS = {
  'claude-code': {
    label: 'Claude Code',
    recipe: (base) => [
      'Running Claude Code inside the app repo (projects/tripfolio/app)? The three skills in .claude/skills/ auto-load — just ask, e.g. "ingest this booking".',
      `Running it elsewhere (your vault, another folder)? Tell it: "Use the tripfolio API at ${base}; fetch ${base}/api/agent-manifest for the endpoints and conventions."`
    ]
  },
  cowork: {
    label: 'Cowork',
    recipe: (base) => [
      `Paste the agent guide (button below) into your Cowork session, or point it at ${base}/api/agent-manifest?format=md.`,
      'Cowork then reads your trips/loyalty/coverage and writes bookings and expenses back through the same API.'
    ]
  },
  other: {
    label: 'Other / custom',
    recipe: (base) => [
      `Any agent that speaks HTTP can use tripfolio: base URL ${base}, capabilities at ${base}/api/agent-manifest.`,
      'Start from GET /api/health, then follow the manifest.'
    ]
  }
};

const baseUrl = () => window.location.origin;

export function renderSettings(root, data, refresh) {
  root.append(generalPanel(data, refresh));
  root.append(agentsPanel(data, refresh));
}

function generalPanel(data, refresh) {
  const s = data.settings;
  const form = el('form', {
    class: 'stack',
    onsubmit: async (ev) => {
      ev.preventDefault();
      const f = new FormData(ev.target);
      try {
        await api.put('settings', {
          ...s,
          homeCurrency: (f.get('homeCurrency') || 'SGD').toUpperCase(),
          mirrorDir: f.get('mirrorDir') || null,
          mirrorAuto: f.get('mirrorAuto') === 'on'
        });
        toast('Settings saved');
        refresh();
      } catch (err) { toast(err.message, true); }
    }
  },
    el('label', { class: 'field' }, 'Home currency', el('input', { name: 'homeCurrency', value: s.homeCurrency || 'SGD', size: 5 })),
    el('label', { class: 'field', style: 'flex:1; min-width:18rem;' }, 'Mirror folder (blank = data/mirror; MIRROR_DIR env var overrides)',
      el('input', { name: 'mirrorDir', value: s.mirrorDir || '', placeholder: 'e.g. C:\\vault\\wiki\\areas\\travel\\_private' })),
    el('label', { class: 'field' }, 'Auto-mirror on save',
      el('input', { name: 'mirrorAuto', type: 'checkbox', checked: s.mirrorAuto !== false })),
    el('button', { class: 'primary' }, 'Save'));

  const mirrorBtn = el('button', {
    class: 'ghost',
    onclick: async () => {
      try {
        const r = await api.post('mirror');
        toast(`Wrote ${r.notes} notes to ${r.dir}`);
      } catch (err) { toast(err.message, true); }
    }
  }, 'Regenerate markdown mirror now');

  return el('div', { class: 'panel' },
    el('h2', {}, 'Settings'),
    form,
    el('h3', {}, 'Markdown mirror'),
    el('p', { class: 'muted', style: 'font-size:0.85rem;' },
      'One note per trip, plus Loyalty Wallet and Travel Insurance summaries — regenerable, never hand-edited. Point the folder into an Obsidian vault to browse trips there.'),
    mirrorBtn);
}

async function copyText(text, okMsg) {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMsg);
  } catch {
    toast('Copy failed — select and copy manually', true);
  }
}

function agentsPanel(data, refresh) {
  const base = baseUrl();
  const manifestUrl = `${base}/api/agent-manifest`;

  const rows = data.agents.map((a) => {
    const kind = AGENT_KINDS[a.kind] || AGENT_KINDS.other;
    return el('div', { style: 'padding:0.6rem 0; border-bottom:1px solid var(--border);' },
      el('div', { style: 'display:flex; align-items:center; gap:0.6rem;' },
        el('strong', {}, a.name),
        el('span', { class: 'chip' }, kind.label),
        el('button', {
          class: 'small danger', style: 'margin-left:auto;',
          onclick: async () => {
            if (!confirmDelete(a.name)) return;
            try { await api.del(`agents/${a.id}`); refresh(); } catch (err) { toast(err.message, true); }
          }
        }, 'remove')),
      a.notes ? el('div', { class: 'muted', style: 'font-size:0.82rem; margin:0.2rem 0;' }, a.notes) : null,
      el('ul', { class: 'muted', style: 'font-size:0.82rem; margin:0.3rem 0 0; padding-left:1.1rem;' },
        kind.recipe(base).map((line) => el('li', {}, line))));
  });

  const addForm = el('form', {
    class: 'stack',
    onsubmit: async (ev) => {
      ev.preventDefault();
      const f = new FormData(ev.target);
      try {
        await api.post('agents', { name: f.get('name'), kind: f.get('kind'), notes: f.get('notes') || undefined });
        ev.target.reset();
        refresh();
      } catch (err) { toast(err.message, true); }
    }
  },
    el('label', { class: 'field' }, 'Agent name', el('input', { name: 'name', required: true, placeholder: 'My Claude Code' })),
    el('label', { class: 'field' }, 'Kind', el('select', { name: 'kind' },
      Object.entries(AGENT_KINDS).map(([value, k]) => el('option', { value }, k.label)))),
    el('label', { class: 'field', style: 'flex:1; min-width:12rem;' }, 'Notes', el('input', { name: 'notes', placeholder: 'optional' })),
    el('button', { class: 'primary' }, 'Add agent'));

  const connectRow = el('div', { style: 'display:flex; gap:0.6rem; flex-wrap:wrap; align-items:center; margin:0.4rem 0 0.8rem;' },
    el('code', { class: 'mono', style: 'background:var(--panel-2); padding:0.35rem 0.6rem; border-radius:6px;' }, manifestUrl),
    el('button', { class: 'small', onclick: () => copyText(manifestUrl, 'Manifest URL copied') }, 'copy URL'),
    el('button', {
      class: 'small',
      onclick: async () => {
        try {
          const md = await fetch(`/api/agent-manifest?format=md`).then((r) => r.text());
          await copyText(md, 'Agent guide copied — paste it into your agent');
        } catch (err) { toast(err.message, true); }
      }
    }, 'copy agent guide (Markdown)'),
    el('a', { href: `${manifestUrl}?format=md`, target: '_blank', class: 'muted', style: 'font-size:0.82rem;' }, 'preview'));

  return el('div', { class: 'panel' },
    el('h2', {}, 'AI agents'),
    el('p', { class: 'muted', style: 'font-size:0.85rem;' },
      'tripfolio is built to be used by AI agents. They read your trips, loyalty status, budget and coverage, and write bookings, expenses and policies back — through this local API. Register the agents you use to get each one\'s connection recipe.'),
    el('h3', {}, 'Connect any agent'),
    connectRow,
    el('h3', {}, 'Your agents'),
    rows.length ? el('div', {}, rows) : el('p', { class: 'muted' }, 'None yet — add one below.'),
    el('h3', {}, 'Add an agent'),
    addForm);
}
