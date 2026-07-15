import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveExpense, splitShares, minimalTransfers, settleTrip } from '../lib/settle.js';

const CARDS = [
  { id: 'card_v', name: 'Visa card', network: 'visa', fxFeePct: 3.25 },
  { id: 'card_a', name: 'Amex card', network: 'amex', fxFeePct: 2.95 }
];
const EXCHANGES = [
  { id: 'ex_1', tripId: 't', date: '2026-07-01', fromAmount: 500, fromCurrency: 'SGD', toAmount: 55000, toCurrency: 'JPY' }
];

test('resolveExpense: statement truth beats everything', () => {
  const r = resolveExpense(
    { amount: 10000, currency: 'JPY', actualSGD: 87.7, rate: { value: 0.0086, source: 'visa' }, method: { cardId: 'card_v' } },
    { cards: CARDS, exchanges: EXCHANGES });
  assert.deepEqual([r.paid, r.forSplit, r.source, r.pending], [87.7, 87.7, 'statement', false]);
});

test('resolveExpense: cash pot uses the money-changer rate', () => {
  const r = resolveExpense(
    { amount: 11000, currency: 'JPY', method: { exchangeId: 'ex_1' } },
    { cards: CARDS, exchanges: EXCHANGES });
  assert.equal(r.paid, 100); // 500/55000 * 11000
  assert.equal(r.source, 'cash');
});

test('resolveExpense: card rate applies FX fee; fee mode picks forSplit', () => {
  const expense = { amount: 10000, currency: 'JPY', rate: { value: 0.0086, source: 'visa' }, method: { cardId: 'card_v' } };
  const split = resolveExpense(expense, { cards: CARDS, exchanges: [] }, 'split');
  assert.equal(split.base, 86);
  assert.equal(split.paid, 88.8); // 86 * 1.0325 = 88.795 → 88.8
  assert.equal(split.forSplit, 88.8);
  const payer = resolveExpense(expense, { cards: CARDS, exchanges: [] }, 'payer');
  assert.equal(payer.forSplit, 86, 'payer absorbs the fee');
  assert.equal(payer.paid, 88.8);
});

test('resolveExpense: amex on mid-market is flagged estimated; no rate is pending', () => {
  const amex = resolveExpense(
    { amount: 100, currency: 'JPY', rate: { value: 0.0086, source: 'mid' }, method: { cardId: 'card_a' } },
    { cards: CARDS, exchanges: [] });
  assert.equal(amex.estimated, true);
  const none = resolveExpense({ amount: 100, currency: 'JPY' }, { cards: CARDS, exchanges: [] });
  assert.equal(none.pending, true);
});

test('splitShares: equal by default, weights, exact local amounts', () => {
  assert.deepEqual(
    splitShares({ amount: 300, participants: [] }, 90, ['a', 'b', 'c']),
    { a: 30, b: 30, c: 30 });
  assert.deepEqual(
    splitShares({ amount: 300, participants: [{ travelerId: 'a', share: 2 }, { travelerId: 'b', share: 1 }] }, 90),
    { a: 60, b: 30 });
  assert.deepEqual(
    splitShares({ amount: 300, participants: [{ travelerId: 'a', exact: 100 }, { travelerId: 'b', exact: 200 }] }, 90),
    { a: 30, b: 60 });
  assert.throws(
    () => splitShares({ amount: 300, participants: [{ travelerId: 'a', exact: 100 }, { travelerId: 'b', exact: 100 }] }, 90),
    /don't sum/);
});

test('minimalTransfers nets to at most n-1 transfers', () => {
  const transfers = minimalTransfers({ a: 100, b: -60, c: -40 });
  assert.deepEqual(transfers, [
    { from: 'b', to: 'a', amount: 60 },
    { from: 'c', to: 'a', amount: 40 }
  ]);
  assert.deepEqual(minimalTransfers({ a: 0 }), []);
});

test('settleTrip: end-to-end with pending and estimated rows', () => {
  const trip = { id: 't', travelerIds: ['a', 'b'], currencySettings: { feeSplitMode: 'split' } };
  const travelers = [{ id: 'a', name: 'Alex' }, { id: 'b', name: 'Sam' }];
  const expenses = [
    // Alex pays 10000 JPY on visa: 86 base → 88.8 with fee, split equally
    { id: 'e1', tripId: 't', amount: 10000, currency: 'JPY', payerId: 'a',
      rate: { value: 0.0086, source: 'visa' }, method: { cardId: 'card_v' } },
    // Sam pays 11000 JPY from the cash pot: 100.00, Alex-only (exact)
    { id: 'e2', tripId: 't', amount: 11000, currency: 'JPY', payerId: 'b',
      method: { exchangeId: 'ex_1' }, participants: [{ travelerId: 'a', exact: 11000 }] },
    // Future dinner, no rate yet → pending, excluded from totals
    { id: 'e3', tripId: 't', amount: 5000, currency: 'JPY', payerId: 'a' }
  ];
  const s = settleTrip(trip, expenses, { cards: CARDS, exchanges: EXCHANGES, travelers });

  assert.equal(s.pendingCount, 1);
  assert.equal(s.totalSpend, 188.8); // 88.8 + 100
  const alex = s.balances.find((b) => b.travelerId === 'a');
  const sam = s.balances.find((b) => b.travelerId === 'b');
  assert.equal(alex.paid, 88.8);
  assert.equal(alex.share, 144.4); // 44.4 + 100
  assert.equal(sam.net, 55.6);
  assert.deepEqual(s.transfers, [{ from: 'a', to: 'b', amount: 55.6, fromName: 'Alex', toName: 'Sam' }]);
});
