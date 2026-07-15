import { api } from './api.js';
import { el, toast, dateLabel, dtLabel, confirmDelete } from './ui.js';

const STATUSES = ['booked', 'planning', 'dreaming', 'done'];

// Field specs shared by the booking and candidate forms. Kind: text | date |
// datetime-local | number | program (a select over loyalty programs) |
// mode (transport mode select).
const FIELDS = {
  flight: [
    ['airline', 'Airline'], ['flightNo', 'Flight no.'], ['pnr', 'PNR'],
    ['from', 'From'], ['to', 'To'],
    ['depLocal', 'Departs (local)', 'datetime-local'], ['arrLocal', 'Arrives (local)', 'datetime-local'],
    ['cabin', 'Cabin'], ['seat', 'Seat'], ['programId', 'Credit to', 'program'], ['notes', 'Notes']
  ],
  stay: [
    ['property', 'Property'], ['confirmationNo', 'Confirmation no.'],
    ['checkIn', 'Check-in', 'date'], ['checkOut', 'Check-out', 'date'],
    ['address', 'Address'], ['programId', 'Credit to', 'program'], ['notes', 'Notes']
  ],
  transport: [
    ['mode', 'Mode', 'mode'], ['operator', 'Operator'], ['ref', 'Booking ref'],
    ['from', 'From'], ['to', 'To'],
    ['depLocal', 'Departs (local)', 'datetime-local'], ['arrLocal', 'Arrives (local)', 'datetime-local'],
    ['notes', 'Notes']
  ],
  activity: [
    ['name', 'Name'], ['ref', 'Booking ref'], ['date', 'Date', 'date'],
    ['location', 'Location'], ['notes', 'Notes']
  ]
};
const CANDIDATE_EXTRAS = [['price', 'Price', 'number'], ['currency', 'Currency'], ['sourceUrl', 'Source URL']];
const MODES = ['train', 'ferry', 'bus', 'car rental', 'taxi', 'other'];

const sortKey = (s) => s.depLocal || s.checkIn || s.date || '9999-12-31';

export function segSummary(s) {
  switch (s.type) {
    case 'flight':
      return `${[s.airline, s.flightNo].filter(Boolean).join(' ') || 'Flight'} · ${s.from || '?'} → ${s.to || '?'}` +
        `${s.cabin ? ` · ${s.cabin}` : ''}${s.seat ? ` · ${s.seat}` : ''}${s.pnr ? ` · PNR ${s.pnr}` : ''}`;
    case 'stay':
      return `${s.property || 'Stay'} · ${dateLabel(s.checkIn)} → ${dateLabel(s.checkOut)}` +
        `${s.confirmationNo ? ` · conf ${s.confirmationNo}` : ''}`;
    case 'transport':
      return `${s.mode || 'Transport'}${s.operator ? ` (${s.operator})` : ''} · ${s.from || '?'} → ${s.to || '?'}` +
        `${s.ref ? ` · ref ${s.ref}` : ''}`;
    default:
      return `${s.name || 'Activity'}${s.location ? ` · ${s.location}` : ''}${s.ref ? ` · ref ${s.ref}` : ''}`;
  }
}

const segWhen = (s) => s.type === 'stay'
  ? ''
  : (s.depLocal ? `${dtLabel(s.depLocal)}${s.arrLocal ? ` → ${dtLabel(s.arrLocal)}` : ''}` : (s.date ? dateLabel(s.date) : ''));

let selectedTripId = null;
let editor = null; // { collection: 'segments'|'candidates', type, item? } — an open add/edit form

export function renderTrips(root, data, refresh) {
  if (selectedTripId && !data.trips.some((t) => t.id === selectedTripId)) selectedTripId = null;
  const trip = data.trips.find((t) => t.id === selectedTripId);
  root.append(trip ? tripDetail(trip, data, refresh) : tripList(data, refresh));
}

function tripList(data, refresh) {
  const wrap = el('div');

  const form = el('form', {
    class: 'stack',
    onsubmit: async (ev) => {
      ev.preventDefault();
      const f = new FormData(ev.target);
      try {
        const trip = await api.post('trips', {
          name: f.get('name'), status: f.get('status'),
          startDate: f.get('startDate') || undefined, endDate: f.get('endDate') || undefined,
          destinations: [], travelerIds: [], days: []
        });
        selectedTripId = trip.id;
        refresh();
      } catch (err) { toast(err.message, true); }
    }
  },
    el('label', { class: 'field' }, 'Trip name', el('input', { name: 'name', required: true, placeholder: 'Tokyo, March' })),
    el('label', { class: 'field' }, 'Status', el('select', { name: 'status' },
      ['dreaming', 'planning', 'booked'].map((s) => el('option', { value: s }, s)))),
    el('label', { class: 'field' }, 'Start', el('input', { name: 'startDate', type: 'date' })),
    el('label', { class: 'field' }, 'End', el('input', { name: 'endDate', type: 'date' })),
    el('button', { class: 'primary' }, 'New trip')
  );
  wrap.append(el('div', { class: 'panel' }, el('h2', {}, 'New trip'), form));

  for (const status of STATUSES) {
    const trips = data.trips
      .filter((t) => t.status === status)
      .sort((a, b) => (a.startDate || '9999').localeCompare(b.startDate || '9999'));
    if (!trips.length) continue;
    const panel = el('div', { class: 'panel' }, el('h2', {}, status[0].toUpperCase() + status.slice(1)));
    for (const t of trips) {
      const segs = data.segments.filter((s) => s.tripId === t.id).length;
      panel.append(el('div', { class: 'trip-card', onclick: () => { selectedTripId = t.id; editor = null; refresh(); } },
        el('div', {},
          el('div', { class: 'name' }, t.name),
          el('div', { class: 'muted' },
            [t.startDate && `${dateLabel(t.startDate)} → ${dateLabel(t.endDate)}`,
             (t.destinations || []).join(', ') || null,
             `${segs} booking${segs === 1 ? '' : 's'}`].filter(Boolean).join(' · '))),
        el('span', { class: `chip ${t.status}` }, t.status)));
    }
    wrap.append(panel);
  }
  if (!data.trips.length) wrap.append(el('p', { class: 'muted' }, 'No trips yet — create one above.'));
  return wrap;
}

function tripDetail(trip, data, refresh) {
  const wrap = el('div');
  const spend = el('span', { class: 'muted', style: 'margin-left:auto;' });
  api.get(`trips/${trip.id}/settlement`).then((s) => {
    if (!s.rows.length) return;
    spend.textContent = `spend: ${new Intl.NumberFormat('en-SG', { style: 'currency', currency: 'SGD' }).format(s.totalSpend)}` +
      (s.pendingCount ? ` (+${s.pendingCount} pending)` : '');
  }).catch(() => {});
  const cover = el('span');
  api.get(`trips/${trip.id}/coverage`).then((c) => {
    if (c.status === 'unknown') return;
    const chipClass = { covered: 'done', partial: 'planning', uncovered: 'uncovered', none: 'uncovered' }[c.status];
    cover.append(el('span', { class: `chip ${chipClass}`, title: 'insurance — see the Insurance tab' }, `insurance: ${c.status}`));
  }).catch(() => {});
  wrap.append(el('div', { style: 'margin-bottom:1rem; display:flex; align-items:center; gap:1rem;' },
    el('button', { class: 'ghost', onclick: () => { selectedTripId = null; editor = null; refresh(); } }, '← Trips'),
    el('h2', { style: 'margin:0;' }, trip.name),
    el('span', { class: `chip ${trip.status}` }, trip.status),
    cover,
    spend));

  wrap.append(overviewPanel(trip, data, refresh));
  wrap.append(bookingsPanel(trip, data, refresh));
  wrap.append(candidatesPanel(trip, data, refresh));
  wrap.append(itineraryPanel(trip, refresh));
  return wrap;
}

function overviewPanel(trip, data, refresh) {
  const travelerBoxes = data.travelers.map((t) =>
    el('label', { style: 'display:inline-flex; gap:0.3rem; align-items:center; margin-right:1rem; font-size:0.9rem;' },
      el('input', { type: 'checkbox', name: 'traveler', value: t.id, checked: (trip.travelerIds || []).includes(t.id) }),
      t.name));

  const form = el('form', {
    class: 'stack',
    onsubmit: async (ev) => {
      ev.preventDefault();
      const f = new FormData(ev.target);
      try {
        await api.patch(`trips/${trip.id}`, {
          name: f.get('name'),
          status: f.get('status'),
          startDate: f.get('startDate') || undefined,
          endDate: f.get('endDate') || undefined,
          destinations: String(f.get('destinations') || '').split(',').map((s) => s.trim()).filter(Boolean),
          travelerIds: f.getAll('traveler')
        });
        toast('Trip saved');
        refresh();
      } catch (err) { toast(err.message, true); }
    }
  },
    el('label', { class: 'field' }, 'Name', el('input', { name: 'name', value: trip.name, required: true })),
    el('label', { class: 'field' }, 'Status', el('select', { name: 'status' },
      ['dreaming', 'planning', 'booked', 'done'].map((s) => el('option', { value: s, selected: s === trip.status }, s)))),
    el('label', { class: 'field' }, 'Start', el('input', { name: 'startDate', type: 'date', value: trip.startDate || '' })),
    el('label', { class: 'field' }, 'End', el('input', { name: 'endDate', type: 'date', value: trip.endDate || '' })),
    el('label', { class: 'field', style: 'flex:1; min-width:14rem;' }, 'Destinations (comma-separated)',
      el('input', { name: 'destinations', value: (trip.destinations || []).join(', ') })),
    el('button', { class: 'primary' }, 'Save')
  );

  return el('div', { class: 'panel' },
    el('h2', {}, 'Overview'),
    form,
    el('h3', {}, 'Travelers'),
    data.travelers.length
      ? el('div', {}, travelerBoxes, el('p', { class: 'muted', style: 'font-size:0.8rem;' }, 'Tick, then Save above.'))
      : el('p', { class: 'muted' }, 'No travelers yet — add them under Registries.'),
    el('div', { style: 'margin-top:0.8rem;' },
      el('button', {
        class: 'small danger',
        onclick: async () => {
          if (!confirmDelete(`trip "${trip.name}" and its bookings/candidates`)) return;
          try {
            await api.put('segments', data.segments.filter((s) => s.tripId !== trip.id));
            await api.put('candidates', data.candidates.filter((c) => c.tripId !== trip.id));
            await api.del(`trips/${trip.id}`);
            selectedTripId = null;
            refresh();
          } catch (err) { toast(err.message, true); }
        }
      }, 'Delete trip')));
}

// Shared add/edit form for bookings and candidates.
function editorForm(trip, data, refresh) {
  const { collection, type, item } = editor;
  const fields = [...FIELDS[type], ...(collection === 'candidates' ? CANDIDATE_EXTRAS : [])];

  const control = ([name, label, kind = 'text']) => {
    const value = item?.[name] ?? '';
    let input;
    if (kind === 'program') {
      input = el('select', { name },
        el('option', { value: '' }, '—'),
        data.programs.map((p) => el('option', { value: p.id, selected: p.id === value }, `${p.program} (${p.kind})`)));
    } else if (kind === 'mode') {
      input = el('select', { name }, MODES.map((m) => el('option', { value: m, selected: m === value }, m)));
    } else {
      input = el('input', { name, type: kind, value, step: kind === 'number' ? 'any' : undefined });
    }
    return el('label', { class: 'field' }, label, input);
  };

  return el('form', {
    class: 'stack',
    style: 'margin-top:0.8rem; padding-top:0.8rem; border-top:1px solid var(--border);',
    onsubmit: async (ev) => {
      ev.preventDefault();
      const f = new FormData(ev.target);
      const body = { tripId: trip.id, type };
      for (const [name, , kind = 'text'] of fields.map((x) => [x[0], x[1], x[2]])) {
        const raw = String(f.get(name) ?? '').trim();
        if (raw === '') continue;
        body[name] = kind === 'number' ? Number(raw) : raw;
      }
      try {
        if (item) await api.patch(`${collection}/${item.id}`, body);
        else await api.post(collection, body);
        editor = null;
        toast(item ? 'Saved' : 'Added');
        refresh();
      } catch (err) { toast(err.message, true); }
    }
  },
    fields.map(control),
    el('button', { class: 'primary' }, item ? 'Save changes' : `Add ${type}`),
    el('button', { class: 'ghost', type: 'button', onclick: () => { editor = null; refresh(); } }, 'Cancel')
  );
}

function addButtons(collection, refresh) {
  return el('div', { style: 'display:flex; gap:0.5rem; flex-wrap:wrap;' },
    Object.keys(FIELDS).map((type) =>
      el('button', { class: 'small', onclick: () => { editor = { collection, type }; refresh(); } }, `+ ${type}`)));
}

function bookingsPanel(trip, data, refresh) {
  const segs = data.segments
    .filter((s) => s.tripId === trip.id)
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

  const rows = segs.map((s) => el('div', { class: 'seg' },
    el('span', { class: 'type' }, s.type),
    el('div', { class: 'body' },
      el('div', {}, segSummary(s)),
      el('div', { class: 'when' }, [segWhen(s), s.notes].filter(Boolean).join(' · '))),
    el('button', { class: 'small', onclick: () => { editor = { collection: 'segments', type: s.type, item: s }; refresh(); } }, 'edit'),
    el('button', {
      class: 'small danger',
      onclick: async () => {
        if (!confirmDelete(segSummary(s))) return;
        try { await api.del(`segments/${s.id}`); refresh(); } catch (err) { toast(err.message, true); }
      }
    }, 'delete')));

  const panel = el('div', { class: 'panel' },
    el('h2', {}, 'Bookings'),
    rows.length ? rows : el('p', { class: 'muted' }, 'Nothing booked yet.'),
    el('h3', {}, 'Add booking'),
    addButtons('segments', refresh));
  if (editor?.collection === 'segments') panel.append(editorForm(trip, data, refresh));
  return panel;
}

function candidatesPanel(trip, data, refresh) {
  const candidates = data.candidates.filter((c) => c.tripId === trip.id);

  const row = (c) => el('tr', {},
    el('td', {}, c.type),
    el('td', {},
      el('div', {}, segSummary(c)),
      c.sourceUrl ? el('a', { href: c.sourceUrl, target: '_blank', class: 'muted', style: 'font-size:0.8rem;' }, 'source') : null),
    el('td', {}, c.price != null ? `${c.price} ${c.currency || ''}` : '—'),
    el('td', {}, c.verdict
      ? el('span', { class: c.verdict === 'promoted' ? 'ok' : c.verdict === 'rejected' ? 'danger' : 'warn' }, c.verdict)
      : el('span', { class: 'muted' }, 'open')),
    el('td', { style: 'white-space:nowrap;' },
      c.verdict !== 'promoted' && el('button', {
        class: 'small',
        onclick: async () => {
          try { await api.post(`candidates/${c.id}/promote`); toast('Promoted to booking'); refresh(); }
          catch (err) { toast(err.message, true); }
        }
      }, 'promote'),
      ' ',
      c.verdict !== 'promoted' && el('button', {
        class: 'small',
        onclick: async () => {
          try { await api.patch(`candidates/${c.id}`, { verdict: c.verdict === 'rejected' ? null : 'rejected' }); refresh(); }
          catch (err) { toast(err.message, true); }
        }
      }, c.verdict === 'rejected' ? 'reopen' : 'reject'),
      ' ',
      el('button', {
        class: 'small danger',
        onclick: async () => {
          if (!confirmDelete(segSummary(c))) return;
          try { await api.del(`candidates/${c.id}`); refresh(); } catch (err) { toast(err.message, true); }
        }
      }, 'delete')));

  const panel = el('div', { class: 'panel' },
    el('h2', {}, 'Candidates'),
    candidates.length
      ? el('table', {},
          el('thead', {}, el('tr', {}, ['Type', 'Option', 'Price', 'Verdict', ''].map((h) => el('th', {}, h)))),
          el('tbody', {}, candidates.map(row)))
      : el('p', { class: 'muted' }, 'No candidates — add options you\'re comparing, promote the winner.'),
    el('h3', {}, 'Add candidate'),
    addButtons('candidates', refresh));
  if (editor?.collection === 'candidates') panel.append(editorForm(trip, data, refresh));
  return panel;
}

function itineraryPanel(trip, refresh) {
  const days = [];
  if (trip.startDate && trip.endDate) {
    let d = new Date(`${trip.startDate}T00:00:00Z`);
    const end = new Date(`${trip.endDate}T00:00:00Z`);
    while (d <= end && days.length < 120) {
      days.push(d.toISOString().slice(0, 10));
      d = new Date(d.getTime() + 86400000);
    }
  }
  if (!days.length) {
    return el('div', { class: 'panel' }, el('h2', {}, 'Itinerary'),
      el('p', { class: 'muted' }, 'Set start and end dates to plan day by day.'));
  }

  const areas = new Map();
  const dayBlocks = days.map((date) => {
    const existing = (trip.days || []).find((x) => x.date === date);
    const ta = el('textarea', { placeholder: 'Markdown — plans, links, notes…' });
    ta.value = existing?.md || '';
    areas.set(date, ta);
    return el('div', { class: 'day' }, el('div', { class: 'date' }, dateLabel(date)), ta);
  });

  return el('div', { class: 'panel' },
    el('h2', {}, 'Itinerary'),
    dayBlocks,
    el('button', {
      class: 'primary',
      onclick: async () => {
        const daysOut = [...areas.entries()]
          .map(([date, ta]) => ({ date, md: ta.value.trim() }))
          .filter((x) => x.md);
        try { await api.patch(`trips/${trip.id}`, { days: daysOut }); toast('Itinerary saved'); refresh(); }
        catch (err) { toast(err.message, true); }
      }
    }, 'Save itinerary'));
}
