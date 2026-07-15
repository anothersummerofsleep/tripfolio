// Daily FX rates from the card networks' own published data, with a free
// ECB mid-market baseline. All sources are historical, so expenses entered
// days later still get the right day's rate.
//
// Reality check (probed 2026-07): Visa's public calculator endpoint returns
// clean JSON; frankfurter.dev (ECB) is rock solid; Mastercard's settlement
// endpoint sits behind Akamai bot protection and usually rejects non-browser
// clients — we try it anyway and fall back to mid-market, flagged as an
// estimate. Amex publishes no rates at all: always mid-market + estimate,
// trued up from the statement via the expense's actualSGD field.

const TIMEOUT_MS = 10000;

async function getJson(url, headers = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', Accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

// Each fetcher answers: how much HOME currency for 1 unit of FOREIGN, on `date`.
const FETCHERS = {
  async mid(date, foreign, home) {
    const body = await getJson(`https://api.frankfurter.dev/v1/${date}?base=${foreign}&symbols=${home}`);
    const value = body?.rates?.[home];
    if (!value) throw new Error(`no ${home} rate in response`);
    // ECB skips weekends/holidays; frankfurter serves the prior banking day
    // and says which one in body.date.
    return { value, rateDate: body.date };
  },

  async visa(date, foreign, home) {
    const [y, m, d] = date.split('-');
    const url = 'https://www.visa.com.sg/cmsapi/fx/rates?amount=1&fee=0' +
      `&exchangedate=${m}%2F${d}%2F${y}&fromCurr=${home}&toCurr=${foreign}`;
    const body = await getJson(url);
    const value = Number(body?.originalValues?.fxRateVisa);
    if (!Number.isFinite(value) || value <= 0) throw new Error('no fxRateVisa in response');
    return { value, rateDate: date };
  },

  async mastercard(date, foreign, home) {
    const url = 'https://www.mastercard.us/settlement/currencyrate/conversion-rate' +
      `?fxDate=${date}&transCurr=${foreign}&crdhldBillCurr=${home}&bankFee=0&transAmt=1`;
    const body = await getJson(url, {
      Referer: 'https://www.mastercard.us/en-us/personal/get-support/convert-currency.html'
    });
    const value = Number(body?.data?.conversionRate);
    if (!Number.isFinite(value) || value <= 0) throw new Error('no conversionRate in response');
    return { value, rateDate: date };
  }
};

export const RATE_SOURCES = Object.keys(FETCHERS);

// The rate source an expense wants, from how it was paid.
export function sourceForNetwork(network) {
  if (network === 'visa' || network === 'mastercard') return network;
  return 'mid'; // amex (no public rates) and cash both estimate at mid-market
}

// Cache-first rate lookup. Only successful fetches are cached, so a source
// that's blocked today (Mastercard, usually) is retried next time. Returns
// { value, source, date, estimated } — `source` is what actually answered,
// `estimated` is true when the wanted network's own rate wasn't available.
// Returns null for future dates (no rate exists yet — expense stays pending).
export async function getRate(store, { source, date, from, to }, fetchers = FETCHERS) {
  if (!RATE_SOURCES.includes(source)) throw new Error(`unknown rate source: ${source}`);
  if (from === to) return { value: 1, source, date, estimated: false };
  if (date > new Date().toISOString().slice(0, 10)) return null;

  const cache = store.read('rates-cache', {});
  const attempt = async (src) => {
    const key = `${src}|${date}|${from}|${to}`;
    if (cache[key]) return { ...cache[key], source: src, estimated: src !== source };
    const { value, rateDate } = await fetchers[src](date, from, to);
    cache[key] = { value, date: rateDate };
    store.write('rates-cache', cache);
    return { value, date: rateDate, source: src, estimated: src !== source };
  };

  try {
    return await attempt(source);
  } catch (err) {
    if (source === 'mid') throw err;
    const fallback = await attempt('mid');
    return { ...fallback, note: `${source} unavailable (${err.message})` };
  }
}
