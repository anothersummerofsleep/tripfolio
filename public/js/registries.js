import { api } from './api.js';
import { el, toast, confirmDelete } from './ui.js';

const NETWORKS = ['mastercard', 'visa', 'amex'];

export function renderRegistries(root, data, refresh) {
  root.append(travelersPanel(data, refresh));
  root.append(cardsPanel(data, refresh));
}

function travelersPanel(data, refresh) {
  const rows = data.travelers.map((t) => el('tr', {},
    el('td', {}, t.name),
    el('td', { class: 'muted' }, t.notes || ''),
    el('td', {}, el('button', {
      class: 'small danger',
      onclick: async () => {
        if (!confirmDelete(t.name)) return;
        try { await api.del(`travelers/${t.id}`); refresh(); } catch (err) { toast(err.message, true); }
      }
    }, 'delete'))));

  const form = el('form', {
    class: 'stack',
    onsubmit: async (ev) => {
      ev.preventDefault();
      const f = new FormData(ev.target);
      try {
        await api.post('travelers', { name: f.get('name'), notes: f.get('notes') || undefined });
        refresh();
      } catch (err) { toast(err.message, true); }
    }
  },
    el('label', { class: 'field' }, 'Name', el('input', { name: 'name', required: true })),
    el('label', { class: 'field', style: 'flex:1; min-width:12rem;' }, 'Notes', el('input', { name: 'notes' })),
    el('button', { class: 'primary' }, 'Add traveler'));

  return el('div', { class: 'panel' },
    el('h2', {}, 'Travelers'),
    el('p', { class: 'muted', style: 'font-size:0.85rem;' }, 'Everyone you travel with — drives trip membership and, later, cost splitting.'),
    data.travelers.length
      ? el('table', {}, el('thead', {}, el('tr', {}, ['Name', 'Notes', ''].map((h) => el('th', {}, h)))), el('tbody', {}, rows))
      : el('p', { class: 'muted' }, 'None yet.'),
    el('h3', {}, 'Add'),
    form);
}

function cardsPanel(data, refresh) {
  const rows = data.cards.map((c) => el('tr', {},
    el('td', {}, c.name),
    el('td', {}, c.network),
    el('td', {}, c.fxFeePct != null ? `${c.fxFeePct}%` : '—'),
    el('td', { class: 'muted' }, c.notes || ''),
    el('td', {}, el('button', {
      class: 'small danger',
      onclick: async () => {
        if (!confirmDelete(c.name)) return;
        try { await api.del(`cards/${c.id}`); refresh(); } catch (err) { toast(err.message, true); }
      }
    }, 'delete'))));

  const form = el('form', {
    class: 'stack',
    onsubmit: async (ev) => {
      ev.preventDefault();
      const f = new FormData(ev.target);
      try {
        await api.post('cards', {
          name: f.get('name'), network: f.get('network'),
          fxFeePct: f.get('fxFeePct') === '' ? undefined : Number(f.get('fxFeePct')),
          notes: f.get('notes') || undefined
        });
        refresh();
      } catch (err) { toast(err.message, true); }
    }
  },
    el('label', { class: 'field' }, 'Card name', el('input', { name: 'name', required: true, placeholder: 'Amaze (Mastercard)' })),
    el('label', { class: 'field' }, 'Network', el('select', { name: 'network' }, NETWORKS.map((n) => el('option', { value: n }, n)))),
    el('label', { class: 'field' }, 'FX fee %', el('input', { name: 'fxFeePct', type: 'number', step: 'any', min: 0, placeholder: '3.25' })),
    el('label', { class: 'field', style: 'flex:1; min-width:12rem;' }, 'Notes', el('input', { name: 'notes' })),
    el('button', { class: 'primary' }, 'Add card'));

  return el('div', { class: 'panel' },
    el('h2', {}, 'Payment cards'),
    el('p', { class: 'muted', style: 'font-size:0.85rem;' }, 'No card numbers — just name, network, and FX fee, so expenses (phase C) can pick the right daily rate.'),
    data.cards.length
      ? el('table', {}, el('thead', {}, el('tr', {}, ['Name', 'Network', 'FX fee', 'Notes', ''].map((h) => el('th', {}, h)))), el('tbody', {}, rows))
      : el('p', { class: 'muted' }, 'None yet.'),
    el('h3', {}, 'Add'),
    form);
}
