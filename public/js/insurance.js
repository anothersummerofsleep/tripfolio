import { api } from './api.js';
import { el, toast, dateLabel, confirmDelete } from './ui.js';

let editing = null; // policy being edited, 'new', a prefill object, or null
let importing = false; // the "import from document" panel is open
let expandedId = null; // policy whose "what's covered" detail is open

const money = (n) => new Intl.NumberFormat('en-SG', { style: 'currency', currency: 'SGD', maximumFractionDigits: 0 }).format(n);

// The benefits list <-> the textarea a human edits: one benefit per line, an
// optional amount after a colon/dash. A line with no amount is a covered item
// whose sum insured isn't known yet (still "what", just not "how much").
function benefitsToText(benefits) {
  return (benefits || []).map((b) => (b.limit != null ? `${b.name}: ${b.limit}` : b.name)).join('\n');
}
function textToBenefits(str) {
  const out = [];
  for (const line of String(str || '').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const m = t.match(/^(.*?)[\s:—–-]*(?:S?\$|SGD|USD|A\$|AUD|£|€)?\s?(\d[\d,]*)(?:\.\d{2})?\s*$/i);
    if (m && m[1].trim()) out.push({ name: m[1].replace(/[\s:—–-]+$/, '').trim(), limit: Number(m[2].replace(/,/g, '')) });
    else out.push({ name: t });
  }
  return out;
}

const COVERAGE_CHIP = { covered: 'done', partial: 'planning', uncovered: 'uncovered', none: 'uncovered', unknown: 'dreaming' };

// A File's bytes → base64, chunked so a big PDF doesn't blow the call stack.
async function fileToBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

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
  if (expandedId) {
    const p = data.policies.find((x) => x.id === expandedId);
    if (p) root.append(coverageDetailPanel(p, data));
  }
  if (importing) root.append(importPanel(refresh));
  if (editing) root.append(policyForm(data, refresh));
  root.append(await coveragePanel(data));
}

// "What's covered and how much" for one policy: the benefit schedule with sums
// insured, the headline limits, region, plan/optional riders, and who's on it.
function coverageDetailPanel(p, data) {
  const name = (id) => data.travelers.find((t) => t.id === id)?.name || id;
  const rows = [];
  const limitRow = (label, v) => v != null && rows.push(el('tr', {}, el('td', {}, label), el('td', { style: 'text-align:right;' }, money(v))));

  // Prefer the full benefit list; fall back to the three headline limits.
  if (p.benefits?.length) {
    for (const b of p.benefits) {
      rows.push(el('tr', {},
        el('td', {}, b.name),
        el('td', { class: b.limit == null ? 'muted' : '', style: 'text-align:right;' }, b.limit != null ? money(b.limit) : 'covered')));
    }
  } else {
    limitRow('Overseas medical', p.limits?.medical);
    limitRow('Trip cancellation', p.limits?.cancellation);
    limitRow('Baggage', p.limits?.baggage);
  }

  const meta = [];
  const push = (label, val) => val && meta.push(el('div', {}, el('span', { class: 'muted' }, `${label}: `), val));
  push('Region', [].concat(p.regions || []).join(', '));
  push('Trip length cap', p.maxTripDays ? `${p.maxTripDays} days per trip` : '');
  push('Coverage', p.coverageStart ? `${dateLabel(p.coverageStart)} → ${dateLabel(p.coverageEnd)}` : '');
  push('Covers', (p.coveredTravelerIds || []).map(name).join(', ') || 'anyone travelling');
  if (p.notes) push('Notes', p.notes);

  return el('div', { class: 'panel' },
    el('h2', {}, `What ${p.insurer} ${p.policyNumber} covers`),
    el('div', { class: 'stack', style: 'gap:0.2rem; margin-bottom:0.8rem;' }, meta),
    rows.length
      ? el('table', {},
          el('thead', {}, el('tr', {}, el('th', {}, 'Benefit'), el('th', { style: 'text-align:right;' }, 'Sum insured'))),
          el('tbody', {}, rows))
      : el('p', { class: 'muted', style: 'font-size:0.85rem;' },
          'No benefit amounts on file yet. The schedule usually doesn\'t list them — the sums insured are set by the plan. Add them under edit → “Covered benefits”, or ask your AI agent (ingest-policy skill) to read them from the policy wording.'),
    p.pdfPath ? el('p', { style: 'margin-top:0.6rem;' }, el('a', { href: `/api/policies/${p.id}/pdf`, target: '_blank' }, 'Open the policy document →')) : null);
}

function policiesPanel(data, refresh) {
  const name = (id) => data.travelers.find((t) => t.id === id)?.name || id;

  const uploadInput = (p) => {
    const input = el('input', {
      type: 'file', accept: '.pdf,application/pdf', style: 'display:none;',
      onchange: async (ev) => {
        const file = ev.target.files[0];
        if (!file) return;
        try {
          await api.post(`policies/${p.id}/pdf`, { filename: file.name, content: await fileToBase64(file) });
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
        el('button', { class: 'small', onclick: () => { expandedId = expandedId === p.id ? null : p.id; refresh(); } },
          expandedId === p.id ? 'hide' : 'covered'), ' ',
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
    editing ? null : el('div', { style: 'display:flex; gap:0.5rem; flex-wrap:wrap; margin-top:0.6rem;' },
      el('button', { class: 'primary', onclick: () => { importing = false; editing = 'new'; refresh(); } }, '+ Add policy'),
      el('button', { class: importing ? 'small' : 'ghost', onclick: () => { editing = null; importing = !importing; refresh(); } }, '⬆ Import from document')));
}

// Paste a policy schedule / certificate, or upload one (text-based PDF, .txt,
// .html, .eml) → heuristic extraction on the server → the recognized fields
// offered as a prefill for review. Nothing is saved until the user confirms in
// the Add-policy form; an uploaded PDF rides along and is filed on save.
function importPanel(refresh) {
  let pickedFile = null; // a chosen PDF to carry into the form and attach on save
  const ta = el('textarea', {
    placeholder: 'Paste the policy schedule / certificate of insurance here (plain text or HTML)…',
    style: 'width:100%; min-height:9rem;'
  });
  const fileLabel = el('span', { class: 'muted', style: 'font-size:0.82rem;' });
  const results = el('div');

  const fileInput = el('input', {
    type: 'file', accept: '.pdf,.txt,.html,.htm,.eml,application/pdf', style: 'display:none;',
    onchange: (ev) => {
      const file = ev.target.files[0];
      if (!file) return;
      results.replaceChildren();
      if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
        pickedFile = file;
        ta.value = '';
        fileLabel.textContent = `PDF ready: ${file.name} — it'll be filed with the policy on save.`;
      } else {
        pickedFile = null;
        fileLabel.textContent = '';
        const reader = new FileReader();
        reader.onload = () => { ta.value = reader.result; };
        reader.readAsText(file);
      }
    }
  });

  const renderResult = ({ policy, warnings, textFound }) => {
    results.replaceChildren();
    if (warnings?.length) results.append(el('p', { class: 'warn', style: 'font-size:0.82rem;' }, warnings.join(' · ')));
    if (!policy || !Object.keys(policy).length) {
      if (textFound !== false) results.append(el('p', { class: 'muted', style: 'font-size:0.82rem;' }, 'No policy fields recognized — add the policy manually, or ask your AI agent to ingest it.'));
      return;
    }
    const summary = [
      policy.insurer, policy.policyNumber, policy.type,
      policy.coverageStart ? `${policy.coverageStart} → ${policy.coverageEnd || '?'}` : null,
      [].concat(policy.regions || []).join(', ') || null
    ].filter(Boolean).join(' · ');
    results.append(el('div', { class: 'seg' },
      el('span', { class: 'type' }, 'policy'),
      el('div', { class: 'body' }, el('div', {}, summary || 'some fields found')),
      el('button', {
        class: 'small',
        onclick: () => { editing = { ...policy, _file: pickedFile }; importing = false; refresh(); }
      }, 'review & add')));
  };

  return el('div', { class: 'panel' },
    el('h2', {}, 'Import a policy'),
    el('p', { class: 'muted', style: 'font-size:0.85rem; margin-top:0;' },
      'Works offline with generic schedule patterns — it prefills, you check. ',
      'A text-based PDF is read here; a scanned one needs pasted text or your AI agent (ingest-policy skill).'),
    ta,
    el('div', { style: 'display:flex; gap:0.6rem; align-items:center; flex-wrap:wrap; margin-top:0.6rem;' },
      fileInput,
      el('button', { class: 'ghost', onclick: () => fileInput.click() }, 'Choose PDF / .txt / .html / .eml'),
      el('button', {
        class: 'primary',
        onclick: async (ev) => {
          const payload = pickedFile
            ? { filename: pickedFile.name, pdf: await fileToBase64(pickedFile) }
            : ta.value.trim() ? { content: ta.value } : null;
          if (!payload) return toast('Paste policy text or choose a file first', true);
          ev.target.disabled = true;
          try { renderResult(await api.post('extract-policy', payload)); }
          catch (err) { toast(err.message, true); }
          finally { ev.target.disabled = false; }
        }
      }, 'Extract fields'),
      el('button', { class: 'ghost', onclick: () => { importing = false; refresh(); } }, 'Close')),
    el('div', { style: 'margin-top:0.4rem;' }, fileLabel),
    results);
}

function policyForm(data, refresh) {
  const item = editing === 'new' ? null : editing;
  const isEdit = Boolean(item?.id); // a prefill has fields but no id → create
  const boxes = data.travelers.map((t) =>
    el('label', { style: 'display:inline-flex; gap:0.3rem; align-items:center; margin-right:0.9rem; font-size:0.9rem;' },
      el('input', { type: 'checkbox', name: 'covers', value: t.id, checked: (item?.coveredTravelerIds || []).includes(t.id) }),
      t.name));

  const benefitsTa = el('textarea', {
    name: 'benefits', rows: 6, style: 'width:100%; min-width:16rem;',
    placeholder: 'One per line — "benefit: amount"\nOverseas Medical Expenses: 1000000\nTrip Cancellation: 15000\nPersonal Liability: 1000000'
  });
  benefitsTa.value = benefitsToText(item?.benefits);

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
        benefits: textToBenefits(f.get('benefits')),
        notes: f.get('notes') || undefined
      };
      try {
        if (isEdit) {
          await api.patch(`policies/${item.id}`, body);
        } else {
          const created = await api.post('policies', body);
          if (item?._file) {
            try { await api.post(`policies/${created.id}/pdf`, { filename: item._file.name, content: await fileToBase64(item._file) }); }
            catch (err) { toast(`Policy saved, but the document didn't attach: ${err.message}`, true); }
          }
        }
        editing = null;
        toast('Policy saved');
        refresh();
      } catch (err) { toast(err.message, true); }
    }
  },
    item && !isEdit ? el('p', { class: 'warn', style: 'font-size:0.82rem; margin:0;' },
      'Prefilled from the imported document — check every field before saving.') : null,
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
    el('label', { class: 'field', style: 'flex:1 1 100%;' },
      'Covered benefits — what\'s covered and how much',
      benefitsTa,
      el('span', { class: 'muted', style: 'font-size:0.76rem;' },
        'One per line. Amount optional — a name alone records that it\'s covered when you don\'t have the sum. The schedule rarely lists these; your AI agent (ingest-policy) can read them from the policy wording.')),
    el('label', { class: 'field', style: 'flex:1; min-width:12rem;' }, 'Notes', el('input', { name: 'notes', value: item?.notes || '' })),
    el('button', { class: 'primary' }, isEdit ? 'Save' : 'Add'),
    el('button', { class: 'ghost', type: 'button', onclick: () => { editing = null; refresh(); } }, 'Cancel'));

  return el('div', { class: 'panel' }, el('h2', {}, isEdit ? `Edit ${item.insurer} ${item.policyNumber}` : 'Add policy'), form);
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
