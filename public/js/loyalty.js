import { api } from './api.js';
import { el, toast, dateLabel, daysUntil, confirmDelete } from './ui.js';

const ALLIANCES = ['', 'Star Alliance', 'oneworld', 'SkyTeam'];

let editing = null; // program id being edited, or 'new'

export function renderLoyalty(root, data, refresh) {
  root.append(group('Airlines', 'airline', data, refresh));
  root.append(group('Hotels', 'hotel', data, refresh));
  if (editing) root.append(programForm(data, refresh));
  else {
    root.append(el('div', { class: 'panel' },
      el('button', { class: 'primary', onclick: () => { editing = 'new'; refresh(); } }, '+ Add program')));
  }
}

function group(title, kind, data, refresh) {
  const programs = data.programs.filter((p) => p.kind === kind);
  const panel = el('div', { class: 'panel' }, el('h2', {}, title));
  if (!programs.length) {
    panel.append(el('p', { class: 'muted' }, `No ${kind} programs yet.`));
    return panel;
  }

  const rows = programs.map((p) => {
    const latest = (p.snapshots || []).slice().sort((a, b) => a.date.localeCompare(b.date)).at(-1);
    const left = daysUntil(p.tierExpiry);
    return el('tr', {},
      el('td', {}, el('strong', {}, p.program), p.alliance ? el('div', { class: 'muted', style: 'font-size:0.8rem;' }, p.alliance) : null),
      el('td', { class: 'mono' }, p.memberNumber),
      el('td', {}, p.tier || '—'),
      el('td', { class: left != null && left < 60 ? 'warn' : '' },
        p.tierExpiry ? `${dateLabel(p.tierExpiry)}${left != null && left < 60 ? ` (${left}d)` : ''}` : '—'),
      el('td', {}, latest ? `${Number(latest.points).toLocaleString('en-SG')} ` : '—',
        latest ? el('span', { class: 'muted', style: 'font-size:0.8rem;' }, `as of ${dateLabel(latest.date)}`) : null),
      el('td', { style: 'white-space:nowrap;' },
        el('button', {
          class: 'small',
          onclick: () => {
            const points = window.prompt(`Points balance for ${p.program} today?`, latest ? latest.points : '');
            if (points === null || points.trim() === '' || Number.isNaN(Number(points))) return;
            const snapshots = [...(p.snapshots || []), { date: new Date().toISOString().slice(0, 10), points: Number(points) }];
            api.patch(`programs/${p.id}`, { snapshots }).then(refresh).catch((e) => toast(e.message, true));
          }
        }, 'snapshot'),
        ' ',
        el('button', { class: 'small', onclick: () => { editing = p.id; refresh(); } }, 'edit'),
        ' ',
        el('button', {
          class: 'small danger',
          onclick: async () => {
            if (!confirmDelete(`${p.program} (${p.memberNumber})`)) return;
            try { await api.del(`programs/${p.id}`); refresh(); } catch (err) { toast(err.message, true); }
          }
        }, 'delete')));
  });

  panel.append(el('table', {},
    el('thead', {}, el('tr', {}, ['Program', 'Member no.', 'Tier', 'Tier expiry', 'Points', ''].map((h) => el('th', {}, h)))),
    el('tbody', {}, rows)));
  return panel;
}

function programForm(data, refresh) {
  const item = editing === 'new' ? null : data.programs.find((p) => p.id === editing);
  const form = el('form', {
    class: 'stack',
    onsubmit: async (ev) => {
      ev.preventDefault();
      const f = new FormData(ev.target);
      const body = {
        kind: f.get('kind'), program: f.get('program'), alliance: f.get('alliance') || undefined,
        memberNumber: f.get('memberNumber'), tier: f.get('tier') || undefined,
        tierExpiry: f.get('tierExpiry') || undefined, notes: f.get('notes') || undefined
      };
      try {
        if (item) await api.patch(`programs/${item.id}`, body);
        else await api.post('programs', { ...body, snapshots: [] });
        editing = null;
        toast('Program saved');
        refresh();
      } catch (err) { toast(err.message, true); }
    }
  },
    el('label', { class: 'field' }, 'Kind', el('select', { name: 'kind' },
      ['airline', 'hotel'].map((k) => el('option', { value: k, selected: item?.kind === k }, k)))),
    el('label', { class: 'field' }, 'Program', el('input', { name: 'program', required: true, value: item?.program || '', placeholder: 'KrisFlyer' })),
    el('label', { class: 'field' }, 'Alliance', el('select', { name: 'alliance' },
      ALLIANCES.map((a) => el('option', { value: a, selected: (item?.alliance || '') === a }, a || '—')))),
    el('label', { class: 'field' }, 'Member no.', el('input', { name: 'memberNumber', required: true, value: item?.memberNumber || '' })),
    el('label', { class: 'field' }, 'Tier', el('input', { name: 'tier', value: item?.tier || '', placeholder: 'Gold' })),
    el('label', { class: 'field' }, 'Tier expiry', el('input', { name: 'tierExpiry', type: 'date', value: item?.tierExpiry || '' })),
    el('label', { class: 'field', style: 'flex:1; min-width:12rem;' }, 'Notes', el('input', { name: 'notes', value: item?.notes || '' })),
    el('button', { class: 'primary' }, item ? 'Save' : 'Add'),
    el('button', { class: 'ghost', type: 'button', onclick: () => { editing = null; refresh(); } }, 'Cancel'));

  return el('div', { class: 'panel' }, el('h2', {}, item ? `Edit ${item.program}` : 'Add program'), form);
}
