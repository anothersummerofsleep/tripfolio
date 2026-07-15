import { api } from './api.js';
import { el, toast, dateLabel, confirmDelete } from './ui.js';

let editing = null; // policy being edited, 'new', or null

const COVERAGE_CHIP = { covered: 'done', partial: 'planning', uncovered: 'uncovered', none: 'uncovered', unknown: 'dreaming' };

export function coverageChip(status) {
  return el('span', { class: `chip ${COVERAGE_CHIP[status] || 'dreaming'}` }, status);
}

// Client-side mirror of lib/coverage.js policyStatus — presentation only.
function policyStatusLabel(p) {
  const today = new Date().toISOString().slice(0, 10);
  if (p.coverageEnd && p.coverageEnd < today) return ['expired', 'danger'];
  if (p.coverageStart && p.coverageStart > today) return ['not yet active', 'muted'];
  if (p.coverageEnd) {
    const left = Math.round((new Date(`${p.coverageEnd}T00:00:00`) - new Date(`${today}T00:00:00`)) / 86400000);
    if (left <= 60) return [`expiring in ${left}d`, 'warn'];
  }
  return ['active', 'ok'];
}

export async function renderInsurance(root, data, refresh) {
  root.append(policiesPanel(data, refresh));
  if (editing) root.append(policyForm(data, refresh));
  root.append(await coveragePanel(data));
}

function policiesPanel(data, refresh) {
  const name = (id) => data.travelers.find((t) => t.id === id)?.name || id;

  const uploadInput = (p) => {
    const input = el('input', {
      type: 'file', accept: '.pdf,application/pdf', style: 'display:none;',
      onchange: async (ev) => {
        const file = ev.target.files[0];
        if (!file) return;
        const buf = await file.arrayBuffer();
        let binary = '';
        const bytes = new Uint8Array(buf);
        for (let i = 0; i < bytes.length; i += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        }
        try {
          await api.post(`policies/${p.id}/pdf`, { filename: file.name, content: btoa(binary) });
          toast('Policy document filed');
          refresh();
        } catch (err) { toast(err.message, true); }
      }
    });
    return input;
  };

  const rows = data.policies.map((p) => {
    const [statusLabel, statusClass] = policyStatusLabel(p);
    const file = uploadInput(p);
    return el('tr', {},
      el('td', {}, el('strong', {}, p.insurer), el('div', { class: 'mono muted', style: 'font-size:0.78rem;' }, p.policyNumber)),
      el('td', {}, p.type),
      el('td', {},
        p.coverageStart ? `${dateLabel(p.coverageStart)} → ${dateLabel(p.coverageEnd)}` : '—',
        el('div', { class: statusClass, style: 'font-size:0.78rem;' }, statusLabel)),
      el('td', {}, p.maxTripDays ? `${p.maxTripDays}d` : '—'),
      el('td', {}, [].concat(p.regions || []).join(', ') || '—'),
      el('td', {}, (p.coveredTravelerIds || []).map(name).join(', ') || 'anyone'),
      el('td', {}, file,
        p.pdfPath
          ? el('a', { href: `/api/policies/${p.id}/pdf`, target: '_blank' }, 'view')
          : el('span', { class: 'muted' }, 'none'),
        ' ',
        el('button', { class: 'small', onclick: () => file.click() }, p.pdfPath ? 'replace' : 'upload')),
      el('td', { style: 'white-space:nowrap;' },
        el('button', { class: 'small', onclick: () => { editing = p; refresh(); } }, 'edit'), ' ',
        el('button', {
          class: 'small danger',
          onclick: async () => {
            if (!confirmDelete(`${p.insurer} ${p.policyNumber}`)) return;
            try { await api.del(`policies/${p.id}`); refresh(); } catch (err) { toast(err.message, true); }
          }
        }, 'delete')));
  });

  return el('div', { class: 'panel' },
    el('h2', {}, 'Policies'),
    data.policies.length
      ? el('table', {},
          el('thead', {}, el('tr', {}, ['Policy', 'Type', 'Coverage', 'Max trip', 'Regions', 'Covers', 'Document', ''].map((h) => el('th', {}, h)))),
          el('tbody', {}, rows))
      : el('p', { class: 'muted' }, 'No policies on file.'),
    editing ? null : el('button', { class: 'primary', style: 'margin-top:0.6rem;', onclick: () => { editing = 'new'; refresh(); } }, '+ Add policy'));
}

function policyForm(data, refresh) {
  const item = editing === 'new' ? null : editing;
  const boxes = data.travelers.map((t) =>
    el('label', { style: 'display:inline-flex; gap:0.3rem; align-items:center; margin-right:0.9rem; font-size:0.9rem;' },
      el('input', { type: 'checkbox', name: 'covers', value: t.id, checked: (item?.coveredTravelerIds || []).includes(t.id) }),
      t.name));

  const form = el('form', {
    class: 'stack',
    onsubmit: async (ev) => {
      ev.preventDefault();
      const f = new FormData(ev.target);
      const num = (k) => (String(f.get(k) || '').trim() === '' ? undefined : Number(f.get(k)));
      const body = {
        insurer: f.get('insurer'),
        policyNumber: f.get('policyNumber'),
        type: f.get('type'),
        coverageStart: f.get('coverageStart') || undefined,
        coverageEnd: f.get('coverageEnd') || undefined,
        maxTripDays: num('maxTripDays'),
        regions: String(f.get('regions') || '').split(',').map((s) => s.trim()).filter(Boolean),
        coveredTravelerIds: f.getAll('covers'),
        limits: { medical: num('medical'), cancellation: num('cancellation'), baggage: num('baggage') },
        notes: f.get('notes') || undefined
      };
      try {
        if (item) await api.patch(`policies/${item.id}`, body);
        else await api.post('policies', body);
        editing = null;
        toast('Policy saved');
        refresh();
      } catch (err) { toast(err.message, true); }
    }
  },
    el('label', { class: 'field' }, 'Insurer', el('input', { name: 'insurer', required: true, value: item?.insurer || '' })),
    el('label', { class: 'field' }, 'Policy number', el('input', { name: 'policyNumber', required: true, value: item?.policyNumber || '' })),
    el('label', { class: 'field' }, 'Type', el('select', { name: 'type' },
      ['annual', 'single'].map((t) => el('option', { value: t, selected: item?.type === t }, t)))),
    el('label', { class: 'field' }, 'Coverage start', el('input', { name: 'coverageStart', type: 'date', value: item?.coverageStart || '' })),
    el('label', { class: 'field' }, 'Coverage end', el('input', { name: 'coverageEnd', type: 'date', value: item?.coverageEnd || '' })),
    el('label', { class: 'field' }, 'Max trip days', el('input', { name: 'maxTripDays', type: 'number', min: 1, value: item?.maxTripDays ?? '', style: 'width:6rem;' })),
    el('label', { class: 'field', style: 'min-width:14rem;' }, 'Regions (comma-separated)',
      el('input', { name: 'regions', value: [].concat(item?.regions || []).join(', '), placeholder: 'Worldwide excl. USA' })),
    el('div', { class: 'field' }, el('span', { class: 'muted', style: 'font-size:0.8rem;' }, 'Covers (nobody ticked = anyone)'), el('div', {}, boxes)),
    el('label', { class: 'field' }, 'Medical limit', el('input', { name: 'medical', type: 'number', value: item?.limits?.medical ?? '', style: 'width:8rem;' })),
    el('label', { class: 'field' }, 'Cancellation', el('input', { name: 'cancellation', type: 'number', value: item?.limits?.cancellation ?? '', style: 'width:7rem;' })),
    el('label', { class: 'field' }, 'Baggage', el('input', { name: 'baggage', type: 'number', value: item?.limits?.baggage ?? '', style: 'width:6rem;' })),
    el('label', { class: 'field', style: 'flex:1; min-width:12rem;' }, 'Notes', el('input', { name: 'notes', value: item?.notes || '' })),
    el('button', { class: 'primary' }, item ? 'Save' : 'Add'),
    el('button', { class: 'ghost', type: 'button', onclick: () => { editing = null; refresh(); } }, 'Cancel'));

  return el('div', { class: 'panel' }, el('h2', {}, item ? `Edit ${item.insurer} ${item.policyNumber}` : 'Add policy'), form);
}

async function coveragePanel(data) {
  const trips = data.trips.filter((t) => t.status !== 'done');
  const rows = [];
  for (const trip of trips) {
    let c;
    try { c = await api.get(`trips/${trip.id}/coverage`); }
    catch { continue; }
    const best = c.policies.find((p) => p.policyId === c.best);
    const detail = [];
    if (c.reason) detail.push(c.reason);
    if (best) {
      detail.push(best.label);
      if (best.uncoveredTravelers.length) detail.push(`NOT covered: ${best.uncoveredTravelers.join(', ')}`);
      detail.push(...best.notes);
    } else if (c.status === 'uncovered') {
      detail.push(...c.policies.flatMap((p) => p.problems.map((x) => `${p.label}: ${x}`)));
    }
    rows.push(el('tr', {},
      el('td', {}, trip.name),
      el('td', {}, trip.startDate ? `${dateLabel(trip.startDate)} → ${dateLabel(trip.endDate)}` : '—'),
      el('td', {}, coverageChip(c.status)),
      el('td', { class: 'muted', style: 'font-size:0.82rem;' }, detail.join(' · ') || '—')));
  }

  return el('div', { class: 'panel' },
    el('h2', {}, 'Coverage by trip'),
    rows.length
      ? el('table', {},
          el('thead', {}, el('tr', {}, ['Trip', 'Dates', 'Coverage', 'Detail'].map((h) => el('th', {}, h)))),
          el('tbody', {}, rows))
      : el('p', { class: 'muted' }, 'No upcoming trips.'),
    el('p', { class: 'muted', style: 'font-size:0.78rem;' },
      'Dates, trip length and travelers are checked strictly; regions and fine print (activities, gear, pre-existing conditions) need the policy document — ask your agent to read the PDF on file.'));
}
