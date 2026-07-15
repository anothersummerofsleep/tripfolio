import { api } from './api.js';
import { el, toast, dateLabel, confirmDelete } from './ui.js';

let selectedTripId = null;
let editing = null; // expense being edited, 'new', or null

const fmt = (n) => n == null ? '—' : new Intl.NumberFormat('en-SG', { style: 'currency', currency: 'SGD' }).format(n);
const today = () => new Date().toISOString().slice(0, 10);

export async function renderExpenses(root, data, refresh) {
  const trips = data.trips.filter((t) => t.status !== 'dreaming' || data.expenses.some((e) => e.tripId === t.id));
  if (!trips.length) {
    root.append(el('div', { class: 'panel' }, el('p', { class: 'muted' }, 'No trips to track expenses for yet — create one under Trips.')));
    return;
  }
  if (!trips.some((t) => t.id === selectedTripId)) selectedTripId = trips[0].id;
  const trip = trips.find((t) => t.id === selectedTripId);

  root.append(el('div', { class: 'panel', style: 'display:flex; gap:0.8rem; align-items:center;' },
    el('label', { class: 'field' }, 'Trip', el('select', {
      onchange: (ev) => { selectedTripId = ev.target.value; editing = null; refresh(); }
    }, trips.map((t) => el('option', { value: t.id, selected: t.id === selectedTripId }, t.name))))));

  let settlement;
  try {
    settlement = await api.get(`trips/${trip.id}/settlement`);
  } catch (err) {
    toast(err.message, true);
    return;
  }

  root.append(summaryPanel(trip, settlement, refresh));
  root.append(ledgerPanel(trip, settlement, data, refresh));
  root.append(potsPanel(trip, data, refresh));
}

function summaryPanel(trip, s, refresh) {
  const warnings = [];
  if (s.pendingCount) warnings.push(`${s.pendingCount} expense${s.pendingCount > 1 ? 's' : ''} awaiting a rate (excluded from totals)`);
  if (s.estimatedCount) warnings.push(`${s.estimatedCount} on estimated mid-market rates — reconcile from statements for exact figures`);
  for (const p of s.problems || []) warnings.push(p);

  return el('div', { class: 'panel' },
    el('h2', {}, 'Summary'),
    el('div', { style: 'display:flex; gap:2.5rem; flex-wrap:wrap; align-items:flex-end;' },
      el('div', {},
        el('div', { class: 'muted', style: 'font-size:0.8rem;' }, 'Total spend (SGD)'),
        el('div', { style: 'font-size:1.6rem; font-weight:600;' }, fmt(s.totalSpend))),
      el('label', { class: 'field' }, 'Card FX fees',
        el('select', {
          onchange: async (ev) => {
            try {
              await api.patch(`trips/${trip.id}`, { currencySettings: { ...trip.currencySettings, feeSplitMode: ev.target.value } });
              refresh();
            } catch (err) { toast(err.message, true); }
          }
        },
          el('option', { value: 'split', selected: s.feeSplitMode === 'split' }, 'split with everyone'),
          el('option', { value: 'payer', selected: s.feeSplitMode === 'payer' }, 'payer absorbs')))),
    warnings.length ? el('p', { class: 'warn', style: 'font-size:0.85rem;' }, warnings.join(' · ')) : null,
    s.balances.length ? el('table', { style: 'margin-top:0.6rem; max-width:34rem;' },
      el('thead', {}, el('tr', {}, ['Person', 'Paid', 'Share', 'Net'].map((h) => el('th', {}, h)))),
      el('tbody', {}, s.balances.map((b) => el('tr', {},
        el('td', {}, b.name),
        el('td', {}, fmt(b.paid)),
        el('td', {}, fmt(b.share)),
        el('td', { class: b.net > 0.004 ? 'ok' : b.net < -0.004 ? 'danger' : 'muted' }, fmt(b.net)))))) : null,
    s.transfers.length ? el('div', { style: 'margin-top:0.8rem;' },
      el('h3', {}, 'Settle up'),
      s.transfers.map((t) => el('div', {}, `${t.fromName} pays ${t.toName} `, el('strong', {}, fmt(t.amount))))) : null);
}

function rateCell(row, refresh) {
  const e = row.expense;
  if (row.pending) {
    return el('td', {},
      el('span', { class: 'warn' }, 'pending '),
      el('button', {
        class: 'small',
        onclick: async () => {
          try {
            const r = await api.post(`expenses/${e.id}/refresh-rate`);
            toast(r.rate ? 'Rate fetched' : 'Still no rate — date may be in the future');
            refresh();
          } catch (err) { toast(err.message, true); }
        }
      }, 'fetch'));
  }
  const label = { statement: 'statement', cash: 'cash pot' }[row.source] || `${row.source}${e.rate?.date && e.rate.date !== e.date ? ` (${e.rate.date})` : ''}`;
  return el('td', { title: e.rate?.note || '' },
    e.rate?.value ? el('span', { class: 'mono', style: 'font-size:0.8rem;' }, Number(e.rate.value).toPrecision(5), ' ') : null,
    el('span', { class: `chip${row.estimated ? ' planning' : ''}`, style: 'font-size:0.7rem;' }, `${row.estimated ? '≈ ' : ''}${label}`));
}

function splitLabel(e, travelers) {
  if (!e.participants?.length) return 'everyone';
  const name = (id) => travelers.find((t) => t.id === id)?.name || id;
  return e.participants.map((p) =>
    p.exact != null ? `${name(p.travelerId)}: ${p.exact}` :
    p.share != null ? `${name(p.travelerId)}×${p.share}` : name(p.travelerId)).join(', ');
}

function ledgerPanel(trip, settlement, data, refresh) {
  const name = (id) => data.travelers.find((t) => t.id === id)?.name || id;
  const methodLabel = (e) => {
    if (e.method?.cardId) return data.cards.find((c) => c.id === e.method.cardId)?.name || 'card';
    if (e.method?.exchangeId) return 'cash pot';
    return 'mid-market';
  };

  const rows = settlement.rows
    .slice()
    .sort((a, b) => (a.expense.date || '').localeCompare(b.expense.date || ''))
    .map((row) => {
      const e = row.expense;
      const actual = el('input', {
        type: 'number', step: 'any', style: 'width:6.2rem;', value: e.actualSGD ?? '',
        placeholder: '—',
        onchange: async (ev) => {
          const v = ev.target.value.trim();
          try {
            await api.patch(`expenses/${e.id}`, { actualSGD: v === '' ? null : Number(v) });
            refresh();
          } catch (err) { toast(err.message, true); }
        }
      });
      return el('tr', {},
        el('td', {}, dateLabel(e.date)),
        el('td', {}, e.description || '—', e.category ? el('div', { class: 'muted', style: 'font-size:0.75rem;' }, e.category) : null),
        el('td', { style: 'white-space:nowrap;' }, `${Number(e.amount).toLocaleString('en-SG')} ${e.currency}`),
        el('td', {}, methodLabel(e)),
        rateCell(row, refresh),
        el('td', { style: 'white-space:nowrap;' }, fmt(row.paid)),
        el('td', {}, name(e.payerId)),
        el('td', { class: 'muted', style: 'font-size:0.8rem;' }, splitLabel(e, data.travelers)),
        el('td', {}, actual),
        el('td', { style: 'white-space:nowrap;' },
          el('button', { class: 'small', onclick: () => { editing = e; refresh(); } }, 'edit'), ' ',
          el('button', {
            class: 'small danger',
            onclick: async () => {
              if (!confirmDelete(e.description || 'this expense')) return;
              try { await api.del(`expenses/${e.id}`); refresh(); } catch (err) { toast(err.message, true); }
            }
          }, 'delete')));
    });

  const panel = el('div', { class: 'panel' },
    el('h2', {}, 'Ledger'),
    rows.length
      ? el('table', {},
          el('thead', {}, el('tr', {}, ['Date', 'What', 'Amount', 'Paid with', 'Rate', 'SGD', 'Payer', 'Split', 'SGD actual', ''].map((h) => el('th', {}, h)))),
          el('tbody', {}, rows))
      : el('p', { class: 'muted' }, 'No expenses yet.'),
    el('p', { class: 'muted', style: 'font-size:0.78rem;' },
      '"SGD actual" = the amount from your card statement — filling it replaces every estimate for that row.'),
    editing ? null : el('button', { class: 'primary', onclick: () => { editing = 'new'; refresh(); } }, '+ Add expense'));

  if (editing) panel.append(expenseForm(trip, data, refresh));
  return panel;
}

function expenseForm(trip, data, refresh) {
  const item = editing === 'new' ? null : editing;
  const tripTravelers = data.travelers.filter((t) => (trip.travelerIds || []).includes(t.id));
  const pots = data.exchanges.filter((x) => x.tripId === trip.id);
  const currentMethod = item?.method?.cardId ? `card:${item.method.cardId}`
    : item?.method?.exchangeId ? `pot:${item.method.exchangeId}` : 'mid';

  const initialMode = item?.participants?.some((p) => p.exact != null) ? 'exact'
    : item?.participants?.some((p) => p.share != null) ? 'shares' : 'equal';

  // Per-traveler split inputs, shown only for shares/exact modes.
  const splitInputs = new Map();
  const splitBox = el('div', { style: 'display:none; gap:0.6rem; flex-wrap:wrap;' });
  for (const t of tripTravelers) {
    const prev = item?.participants?.find((p) => p.travelerId === t.id);
    const input = el('input', { type: 'number', step: 'any', style: 'width:5.5rem;', value: prev?.exact ?? prev?.share ?? '' });
    splitInputs.set(t.id, input);
    splitBox.append(el('label', { class: 'field' }, t.name, input));
  }
  const modeSelect = el('select', { name: 'splitMode', onchange: () => { splitBox.style.display = modeSelect.value === 'equal' ? 'none' : 'flex'; } },
    ['equal', 'shares', 'exact'].map((m) => el('option', { value: m, selected: m === initialMode }, m)));
  splitBox.style.display = initialMode === 'equal' ? 'none' : 'flex';

  const included = new Map(tripTravelers.map((t) => [t.id,
    el('input', { type: 'checkbox', checked: !item?.participants?.length || item.participants.some((p) => p.travelerId === t.id) })]));

  const form = el('form', {
    class: 'stack',
    style: 'margin-top:0.8rem; padding-top:0.8rem; border-top:1px solid var(--border);',
    onsubmit: async (ev) => {
      ev.preventDefault();
      const f = new FormData(ev.target);
      const methodValue = String(f.get('method'));
      const mode = String(f.get('splitMode'));
      const chosen = tripTravelers.filter((t) => included.get(t.id).checked);
      if (!chosen.length) return toast('Pick at least one participant', true);

      let participants;
      if (mode === 'equal') {
        participants = chosen.length === tripTravelers.length ? [] : chosen.map((t) => ({ travelerId: t.id }));
      } else {
        participants = chosen.map((t) => {
          const v = splitInputs.get(t.id).value.trim();
          if (v === '') return { travelerId: t.id };
          return mode === 'exact'
            ? { travelerId: t.id, exact: Number(v) }
            : { travelerId: t.id, share: Number(v) };
        });
      }

      const body = {
        tripId: trip.id,
        date: f.get('date'),
        description: f.get('description') || undefined,
        category: f.get('category') || undefined,
        amount: Number(f.get('amount')),
        currency: String(f.get('currency')).trim().toUpperCase(),
        payerId: f.get('payerId'),
        method: methodValue.startsWith('card:') ? { cardId: methodValue.slice(5) }
          : methodValue.startsWith('pot:') ? { exchangeId: methodValue.slice(4) } : undefined,
        participants
      };
      try {
        if (item) await api.patch(`expenses/${item.id}`, body);
        else await api.post('expenses', body);
        editing = null;
        refresh();
      } catch (err) { toast(err.message, true); }
    }
  },
    el('label', { class: 'field' }, 'Date', el('input', { name: 'date', type: 'date', required: true, value: item?.date || today() })),
    el('label', { class: 'field', style: 'flex:1; min-width:10rem;' }, 'Description', el('input', { name: 'description', value: item?.description || '', placeholder: 'Dinner — ramen' })),
    el('label', { class: 'field' }, 'Category', el('input', { name: 'category', value: item?.category || '', placeholder: 'food', size: 8 })),
    el('label', { class: 'field' }, 'Amount', el('input', { name: 'amount', type: 'number', step: 'any', required: true, value: item?.amount ?? '', style: 'width:7rem;' })),
    el('label', { class: 'field' }, 'Currency', el('input', { name: 'currency', required: true, value: item?.currency || '', placeholder: 'JPY', size: 4, maxlength: 3 })),
    el('label', { class: 'field' }, 'Payer', el('select', { name: 'payerId' },
      tripTravelers.map((t) => el('option', { value: t.id, selected: t.id === item?.payerId }, t.name)))),
    el('label', { class: 'field' }, 'Paid with', el('select', { name: 'method' },
      el('option', { value: 'mid', selected: currentMethod === 'mid' }, 'other / estimate at mid-market'),
      data.cards.map((c) => el('option', { value: `card:${c.id}`, selected: currentMethod === `card:${c.id}` }, c.name)),
      pots.map((p) => el('option', { value: `pot:${p.id}`, selected: currentMethod === `pot:${p.id}` },
        `cash pot: ${p.toCurrency} (${dateLabel(p.date)})`)))),
    el('div', { class: 'field' }, el('span', { class: 'muted', style: 'font-size:0.8rem;' }, 'Participants'),
      el('div', {}, tripTravelers.map((t) =>
        el('label', { style: 'display:inline-flex; gap:0.3rem; align-items:center; margin-right:0.9rem; font-size:0.9rem;' },
          included.get(t.id), t.name)))),
    el('label', { class: 'field' }, 'Split', modeSelect),
    splitBox,
    el('button', { class: 'primary' }, item ? 'Save' : 'Add'),
    el('button', { class: 'ghost', type: 'button', onclick: () => { editing = null; refresh(); } }, 'Cancel'));

  return form;
}

function potsPanel(trip, data, refresh) {
  const pots = data.exchanges.filter((x) => x.tripId === trip.id);
  const rows = pots.map((p) => el('tr', {},
    el('td', {}, dateLabel(p.date)),
    el('td', {}, `${Number(p.fromAmount).toLocaleString('en-SG')} SGD → ${Number(p.toAmount).toLocaleString('en-SG')} ${p.toCurrency}`),
    el('td', { class: 'mono' }, (Number(p.fromAmount) / Number(p.toAmount)).toPrecision(4)),
    el('td', {}, el('button', {
      class: 'small danger',
      onclick: async () => {
        if (data.expenses.some((e) => e.method?.exchangeId === p.id)) return toast('Expenses still reference this pot', true);
        if (!confirmDelete('this cash exchange')) return;
        try { await api.del(`exchanges/${p.id}`); refresh(); } catch (err) { toast(err.message, true); }
      }
    }, 'delete'))));

  const form = el('form', {
    class: 'stack',
    onsubmit: async (ev) => {
      ev.preventDefault();
      const f = new FormData(ev.target);
      try {
        await api.post('exchanges', {
          tripId: trip.id, date: f.get('date'),
          fromAmount: Number(f.get('fromAmount')), fromCurrency: 'SGD',
          toAmount: Number(f.get('toAmount')), toCurrency: String(f.get('toCurrency')).trim().toUpperCase()
        });
        refresh();
      } catch (err) { toast(err.message, true); }
    }
  },
    el('label', { class: 'field' }, 'Date', el('input', { name: 'date', type: 'date', required: true, value: today() })),
    el('label', { class: 'field' }, 'SGD spent', el('input', { name: 'fromAmount', type: 'number', step: 'any', required: true, style: 'width:7rem;' })),
    el('label', { class: 'field' }, 'Received', el('input', { name: 'toAmount', type: 'number', step: 'any', required: true, style: 'width:8rem;' })),
    el('label', { class: 'field' }, 'Currency', el('input', { name: 'toCurrency', required: true, placeholder: 'JPY', size: 4, maxlength: 3 })),
    el('button', { class: 'primary' }, 'Add exchange'));

  return el('div', { class: 'panel' },
    el('h2', {}, 'Cash pots'),
    el('p', { class: 'muted', style: 'font-size:0.85rem;' },
      'Each money-changer exchange, once — cash expenses pick a pot and inherit the rate you actually got.'),
    pots.length
      ? el('table', { style: 'max-width:36rem;' },
          el('thead', {}, el('tr', {}, ['Date', 'Exchange', 'Rate (SGD/unit)', ''].map((h) => el('th', {}, h)))),
          el('tbody', {}, rows))
      : el('p', { class: 'muted' }, 'None yet.'),
    el('h3', {}, 'Add'),
    form);
}
