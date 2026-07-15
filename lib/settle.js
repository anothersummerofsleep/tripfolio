// Cost-splitting math: resolve every expense to home currency (SGD), split it
// across its participants, net the balances, and propose minimal transfers.
// Pure functions — the server and the mirror both call these.

const round2 = (n) => Math.round(n * 100) / 100;

// Resolve one expense to home currency. Resolution order:
//   1. actualSGD        — reconciled from the statement; the truth, fees included
//   2. cash pot         — the rate you actually got at the money changer
//   3. rate snapshot    — network daily rate (or mid-market fallback/estimate)
//   4. nothing          — pending (no rate yet)
// Returns { base, paid, forSplit, source, estimated, pending }:
//   base     = converted amount without card FX fee
//   paid     = what actually left the payer's pocket (fee included)
//   forSplit = what participants share — base or paid, per the trip's fee mode
export function resolveExpense(expense, { cards, exchanges }, feeSplitMode = 'split') {
  const card = expense.method?.cardId ? cards.find((c) => c.id === expense.method.cardId) : null;

  if (expense.actualSGD != null) {
    const v = Number(expense.actualSGD);
    return { base: v, paid: v, forSplit: v, source: 'statement', estimated: false, pending: false };
  }

  if (expense.method?.exchangeId) {
    const pot = exchanges.find((x) => x.id === expense.method.exchangeId);
    if (pot && Number(pot.toAmount) > 0) {
      const v = round2(Number(expense.amount) * (Number(pot.fromAmount) / Number(pot.toAmount)));
      return { base: v, paid: v, forSplit: v, source: 'cash', estimated: false, pending: false };
    }
  }

  if (expense.rate?.value) {
    const base = round2(Number(expense.amount) * Number(expense.rate.value));
    const feePct = card?.fxFeePct ? Number(card.fxFeePct) : 0;
    const paid = round2(base * (1 + feePct / 100));
    const estimated = Boolean(expense.rate.estimated) || (Boolean(card) && expense.rate.source === 'mid');
    return {
      base, paid,
      forSplit: feeSplitMode === 'payer' ? base : paid,
      source: expense.rate.source, estimated, pending: false
    };
  }

  return { base: null, paid: null, forSplit: null, source: null, estimated: false, pending: true };
}

// Each participant's cut of `forSplit`. participants: [{ travelerId, share?, exact? }]
// — no shares/exacts = equal; `share` = proportional weight; `exact` = amount in
// the expense's local currency (must sum to the expense amount). Falls back to
// the trip's traveler list when the expense names nobody.
export function splitShares(expense, forSplit, tripTravelerIds) {
  const participants = expense.participants?.length
    ? expense.participants
    : (tripTravelerIds || []).map((travelerId) => ({ travelerId }));
  if (!participants.length) return {};

  const hasExact = participants.some((p) => p.exact != null);
  const cuts = {};

  if (hasExact) {
    const total = participants.reduce((s, p) => s + Number(p.exact ?? 0), 0);
    if (Math.abs(total - Number(expense.amount)) > 0.01) {
      throw new Error(`exact splits (${total}) don't sum to the amount (${expense.amount})`);
    }
    for (const p of participants) cuts[p.travelerId] = forSplit * (Number(p.exact ?? 0) / Number(expense.amount));
  } else {
    const weights = participants.map((p) => Number(p.share ?? 1));
    const total = weights.reduce((s, w) => s + w, 0);
    participants.forEach((p, i) => { cuts[p.travelerId] = forSplit * (weights[i] / total); });
  }
  return cuts;
}

// Greedy netting: biggest creditor collects from biggest debtor until done.
// Produces at most (people - 1) transfers.
export function minimalTransfers(nets) {
  const creditors = [];
  const debtors = [];
  for (const [id, net] of Object.entries(nets)) {
    const cents = Math.round(net * 100);
    if (cents > 0) creditors.push({ id, cents });
    else if (cents < 0) debtors.push({ id, cents: -cents });
  }
  creditors.sort((a, b) => b.cents - a.cents);
  debtors.sort((a, b) => b.cents - a.cents);

  const transfers = [];
  let ci = 0, di = 0;
  while (ci < creditors.length && di < debtors.length) {
    const amount = Math.min(creditors[ci].cents, debtors[di].cents);
    if (amount > 0) transfers.push({ from: debtors[di].id, to: creditors[ci].id, amount: amount / 100 });
    creditors[ci].cents -= amount;
    debtors[di].cents -= amount;
    if (creditors[ci].cents === 0) ci++;
    if (debtors[di].cents === 0) di++;
  }
  return transfers;
}

// The whole picture for one trip. Pending expenses (no rate yet) and split
// errors are reported, not silently dropped — totals only cover resolved rows.
export function settleTrip(trip, expenses, { cards, exchanges, travelers }) {
  const feeSplitMode = trip.currencySettings?.feeSplitMode || 'split';
  const rows = [];
  const balances = {}; // travelerId -> { paid, share }
  const problems = [];
  const touch = (id) => (balances[id] ??= { paid: 0, share: 0 });

  for (const expense of expenses.filter((e) => e.tripId === trip.id)) {
    const resolved = resolveExpense(expense, { cards, exchanges }, feeSplitMode);
    const row = { expense, ...resolved };
    rows.push(row);
    if (resolved.pending) continue;

    let cuts;
    try {
      cuts = splitShares(expense, resolved.forSplit, trip.travelerIds);
    } catch (err) {
      problems.push(`${expense.description || expense.id}: ${err.message}`);
      continue;
    }
    touch(expense.payerId).paid += resolved.forSplit;
    for (const [travelerId, cut] of Object.entries(cuts)) touch(travelerId).share += cut;
  }

  const nets = {};
  for (const [id, b] of Object.entries(balances)) nets[id] = round2(b.paid - b.share);

  const name = (id) => travelers.find((t) => t.id === id)?.name || id;
  return {
    feeSplitMode,
    totalSpend: round2(rows.reduce((s, r) => s + (r.paid ?? 0), 0)),
    totalForSplit: round2(rows.reduce((s, r) => s + (r.forSplit ?? 0), 0)),
    pendingCount: rows.filter((r) => r.pending).length,
    estimatedCount: rows.filter((r) => r.estimated && !r.pending).length,
    rows,
    balances: Object.entries(balances).map(([id, b]) => ({
      travelerId: id, name: name(id), paid: round2(b.paid), share: round2(b.share), net: round2(b.paid - b.share)
    })).sort((a, b) => b.net - a.net),
    transfers: minimalTransfers(nets).map((t) => ({ ...t, fromName: name(t.from), toName: name(t.to) })),
    problems
  };
}
