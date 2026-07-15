import { api } from './api.js';
import { el, toast } from './ui.js';

export function renderSettings(root, data, refresh) {
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

  root.append(el('div', { class: 'panel' },
    el('h2', {}, 'Settings'),
    form,
    el('h3', {}, 'Markdown mirror'),
    el('p', { class: 'muted', style: 'font-size:0.85rem;' },
      'One note per trip, plus Loyalty Wallet and Travel Insurance summaries — regenerable, never hand-edited. Point the folder into an Obsidian vault to browse trips there.'),
    mirrorBtn));
}
