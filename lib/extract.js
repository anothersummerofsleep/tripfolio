// Heuristic extraction of bookings from confirmation emails — the no-agent
// import path. Generic aviation/hotel patterns (flight numbers, IATA codes,
// PNRs, check-in/check-out) rather than per-airline templates, so a carrier
// we've never seen still mostly works. Deliberately assistive, not autonomous:
// the result prefills the booking form for human review, and every field we
// couldn't find is reported in `warnings` instead of guessed.
// (An AI agent reading the email via the ingest-booking skill is still the
// higher-accuracy path — this one needs no agent and works offline.)

// ---------------------------------------------------------------------------
// Email body → readable text

// Common carriers, so a bare "SQ 638" both validates as a flight number and
// names the airline. Unknown two-char codes still match when the word
// "flight" appears nearby — new airlines degrade, they don't break.
export const AIRLINES = {
  SQ: 'Singapore Airlines', TR: 'Scoot', MI: 'SilkAir', QF: 'Qantas', JQ: 'Jetstar',
  '3K': 'Jetstar Asia', GK: 'Jetstar Japan', VA: 'Virgin Australia', NZ: 'Air New Zealand',
  CX: 'Cathay Pacific', UO: 'HK Express', JL: 'Japan Airlines', NH: 'ANA',
  MH: 'Malaysia Airlines', AK: 'AirAsia', D7: 'AirAsia X', FD: 'Thai AirAsia',
  GA: 'Garuda Indonesia', QG: 'Citilink', ID: 'Batik Air', QZ: 'Indonesia AirAsia',
  TG: 'Thai Airways', VN: 'Vietnam Airlines', VJ: 'VietJet Air', PR: 'Philippine Airlines',
  '5J': 'Cebu Pacific', BR: 'EVA Air', CI: 'China Airlines', KE: 'Korean Air',
  OZ: 'Asiana Airlines', LJ: 'Jin Air', TW: "T'way Air", MU: 'China Eastern',
  CZ: 'China Southern', CA: 'Air China', HU: 'Hainan Airlines', HX: 'Hong Kong Airlines',
  EK: 'Emirates', QR: 'Qatar Airways', EY: 'Etihad Airways', SV: 'Saudia', WY: 'Oman Air',
  GF: 'Gulf Air', TK: 'Turkish Airlines', BA: 'British Airways', LH: 'Lufthansa',
  AF: 'Air France', KL: 'KLM', IB: 'Iberia', AY: 'Finnair', LX: 'Swiss', OS: 'Austrian',
  SK: 'SAS', AZ: 'ITA Airways', LO: 'LOT', UA: 'United', AA: 'American Airlines',
  DL: 'Delta', AC: 'Air Canada', WS: 'WestJet', B6: 'JetBlue', AS: 'Alaska Airlines',
  WN: 'Southwest', AI: 'Air India', '6E': 'IndiGo', UK: 'Vistara', UL: 'SriLankan',
  BI: 'Royal Brunei', PG: 'Bangkok Airways', SL: 'Thai Lion Air', VZ: 'Thai Vietjet',
  OD: 'Batik Air Malaysia', FJ: 'Fiji Airways', LA: 'LATAM', ET: 'Ethiopian', KQ: 'Kenya Airways'
};

// Quoted-printable → UTF-8. Bytes are collected first and decoded together,
// because a multi-byte character arrives as =E2=80=94 — decoding each escape
// on its own would mangle it.
function decodeQP(s) {
  const joined = s.replace(/=\r?\n/g, '');
  const bytes = [];
  for (let i = 0; i < joined.length; i++) {
    if (joined[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(joined.slice(i + 1, i + 3))) {
      bytes.push(parseInt(joined.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(joined.charCodeAt(i) & 0xff);
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

const ENTITIES = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  rarr: '→', ndash: '–', mdash: '—', bull: '·', middot: '·'
};
function stripHtml(html) {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/tr|\/li|\/h[1-6]|\/table)[^>]*>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '  ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

// Best-effort .eml handling: pick the text/plain MIME part (else text/html),
// honouring quoted-printable / base64 transfer encodings. Falls through to
// treating the input as plain pasted text, which is the common case.
export function emailToText(raw) {
  let text = String(raw).replace(/\r\n/g, '\n');
  const looksLikeEmail = /^(from|to|subject|date|mime-version|received|return-path):/im.test(text.slice(0, 2000));

  if (looksLikeEmail) {
    const boundaryMatch = text.match(/boundary="?([^"\s;]+)"?/i);
    if (boundaryMatch) {
      const parts = text.split(new RegExp(`--${boundaryMatch[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:--)?`, 'g'));
      const scored = parts
        .map((part) => {
          const headerEnd = part.indexOf('\n\n');
          if (headerEnd < 0) return null;
          const headers = part.slice(0, headerEnd).toLowerCase();
          let body = part.slice(headerEnd + 2);
          if (/content-transfer-encoding:\s*quoted-printable/.test(headers)) body = decodeQP(body);
          else if (/content-transfer-encoding:\s*base64/.test(headers)) {
            try { body = Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8'); } catch { /* keep raw */ }
          }
          if (/content-type:\s*text\/plain/.test(headers)) return { score: 2, body };
          if (/content-type:\s*text\/html/.test(headers)) return { score: 1, body: stripHtml(body) };
          return null;
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score);
      if (scored.length) text = scored[0].body;
    } else {
      const headerEnd = text.indexOf('\n\n');
      let body = headerEnd > 0 ? text.slice(headerEnd + 2) : text;
      if (/content-transfer-encoding:\s*quoted-printable/i.test(text.slice(0, headerEnd))) body = decodeQP(body);
      text = /<html|<body|<table/i.test(body) ? stripHtml(body) : body;
    }
  } else if (/<html|<body|<table/i.test(text)) {
    text = stripHtml(text);
  }

  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

// ---------------------------------------------------------------------------
// Field parsers

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const iso = (y, m, d) => {
  y = Number(y); m = Number(m); d = Number(d);
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

// Every unambiguous date in the text, with its position (for proximity
// matching). Numeric dd/mm/yyyy is skipped on purpose — 04/09 is a coin flip.
export function findDates(text) {
  const out = [];
  const push = (index, value) => { if (value) out.push({ index, value }); };
  for (const m of text.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) push(m.index, iso(m[1], m[2], m[3]));
  for (const m of text.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?,?\s+(\d{4})\b/gi)) {
    push(m.index, iso(m[3], MONTHS[m[2].toLowerCase().slice(0, 4)] ?? MONTHS[m[2].toLowerCase().slice(0, 3)], m[1]));
  }
  for (const m of text.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/gi)) {
    push(m.index, iso(m[3], MONTHS[m[1].toLowerCase().slice(0, 4)] ?? MONTHS[m[1].toLowerCase().slice(0, 3)], m[2]));
  }
  // Airline e-ticket style: 14SEP26 / 14SEP2026
  for (const m of text.matchAll(/\b(\d{1,2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2,4})\b/g)) {
    push(m.index, iso(m[3], MONTHS[m[2].toLowerCase()], m[1]));
  }
  return out.sort((a, b) => a.index - b.index);
}

// Every time-of-day, normalized to 24h "HH:mm", with its position.
export function findTimes(text) {
  const out = [];
  for (const m of text.matchAll(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\s*(am|pm|hrs?|h)?\b/gi)) {
    let h = Number(m[1]);
    const suffix = (m[3] || '').toLowerCase();
    if (suffix === 'pm' && h < 12) h += 12;
    if (suffix === 'am' && h === 12) h = 0;
    // "9.25" with no am/pm and no hrs marker is too often a price — require
    // a colon, a suffix, or a leading zero to count.
    if (m[0].includes('.') && !suffix && m[1].length < 2) continue;
    out.push({ index: m.index, value: `${String(h).padStart(2, '0')}:${m[2]}` });
  }
  return out.sort((a, b) => a.index - b.index);
}

const nearest = (items, index, maxDistance) => {
  let best = null;
  for (const item of items) {
    const d = Math.abs(item.index - index);
    if (d <= maxDistance && (!best || d < Math.abs(best.index - index))) best = item;
  }
  return best;
};

// ---------------------------------------------------------------------------
// Flights

const IATA_NOT_AIRPORTS = new Set([
  'THE', 'AND', 'FOR', 'YOU', 'ALL', 'NEW', 'GST', 'SGD', 'USD', 'AUD', 'JPY', 'EUR', 'IDR', 'MYR', 'THB',
  'PDF', 'SMS', 'APP', 'WEB', 'VIA', 'ETA', 'ETD', 'REF', 'SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT',
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC', 'PNR', 'TAX', 'FEE',
  'ROW', 'KRW', 'CNY', 'HKD', 'TWD', 'PHP', 'VND', 'INR', 'NZD', 'GBP', 'CHF', 'CAD', 'QTY', 'TBA', 'TBD'
]);

// Route in the flight's neighbourhood: "SIN → NRT", "SIN to NRT",
// "Singapore (SIN) … Tokyo Narita (NRT)".
function findRoute(window) {
  const arrow = window.match(/\b([A-Z]{3})\s*(?:→|->|–|—|-|to)\s*([A-Z]{3})\b/);
  if (arrow && !IATA_NOT_AIRPORTS.has(arrow[1]) && !IATA_NOT_AIRPORTS.has(arrow[2])) {
    return { from: arrow[1], to: arrow[2] };
  }
  const parens = [...window.matchAll(/\(([A-Z]{3})\)/g)]
    .map((m) => m[1])
    .filter((code) => !IATA_NOT_AIRPORTS.has(code));
  if (parens.length >= 2) return { from: parens[0], to: parens[1] };
  return null;
}

function findPnr(text) {
  const m = text.match(
    /(?:booking\s+(?:reference|ref\.?|code)|confirmation\s+(?:number|no\.?|code)|reference\s+(?:number|no\.?)|record\s+locator|PNR|airline\s+reference)\s*[:#]?\s*([A-Z0-9]{5,8})\b/i
  );
  return m ? m[1].toUpperCase() : null;
}

function extractFlights(text, warnings) {
  const dates = findDates(text);
  const times = findTimes(text);
  const pnr = findPnr(text);
  const cabinMatch = text.match(/\b(economy|premium economy|business|first)(?:\s+class)?\b/i);
  const cabin = cabinMatch ? cabinMatch[1].replace(/^\w/, (c) => c.toUpperCase()) : undefined;

  const seen = new Set();
  const segments = [];
  const codes = Object.keys(AIRLINES).map((c) => c.replace(/(\d)/g, '\\$1')).join('|');
  const flightRe = new RegExp(`\\b(${codes}|[A-Z]{2})\\s?(\\d{1,4})\\b`, 'g');

  // Collect matches first so each flight's search window can be capped at the
  // NEXT flight number — otherwise leg 1 reads leg 2's "(+1)" marker, and
  // leg 2 steals leg 1's date. Details nearly always FOLLOW the flight number
  // in confirmations, so matching is forward-only with a small backward
  // fallback.
  const matches = [...text.matchAll(flightRe)].filter((m) => {
    const code = m[1];
    if (IATA_NOT_AIRPORTS.has(code)) return false;
    if (Object.hasOwn(AIRLINES, code)) return true;
    // Unknown 2-letter prefixes only count when the word "flight" is nearby —
    // otherwise "NO 1234" in a footer becomes an airline.
    return /flight/i.test(text.slice(Math.max(0, m.index - 80), m.index + 80));
  });

  matches.forEach((m, i) => {
    const code = m[1];
    const flightNo = `${code}${m[2]}`;
    const windowEnd = Math.min(m.index + 400, matches[i + 1]?.index ?? Infinity);
    const inWindow = ({ index }) => index >= m.index && index < windowEnd;

    const date = dates.find(inWindow)?.value || nearest(dates, m.index, 60)?.value;
    const key = `${flightNo}|${date || ''}`;
    if (seen.has(key)) return;
    seen.add(key);

    const window = text.slice(Math.max(0, m.index - 60), windowEnd);
    const route = findRoute(window);
    const windowTimes = times.filter(inWindow).slice(0, 2);
    const overnight = /\+\s?1|next day/i.test(window);
    let arrDate = date;
    if (date && overnight) {
      const d = new Date(`${date}T00:00:00Z`);
      arrDate = new Date(d.getTime() + 86400000).toISOString().slice(0, 10);
    }

    const segment = {
      type: 'flight',
      airline: AIRLINES[code] || undefined,
      flightNo,
      pnr: pnr || undefined,
      from: route?.from,
      to: route?.to,
      depLocal: date && windowTimes[0] ? `${date}T${windowTimes[0].value}` : undefined,
      arrLocal: arrDate && windowTimes[1] ? `${arrDate}T${windowTimes[1].value}` : undefined,
      cabin
    };
    segments.push(segment);

    const missing = ['from', 'to', 'depLocal'].filter((k) => !segment[k]);
    if (missing.length) warnings.push(`${flightNo}: could not find ${missing.join(', ')} — fill in manually`);
  });

  if (segments.length && !pnr) warnings.push('no booking reference (PNR) found');
  return segments;
}

// ---------------------------------------------------------------------------
// Hotel stays

const PROPERTY_WORDS = /\b(hotel|resort|inn|suites?|hostel|ryokan|villa|lodge|residence|apartments?|bnb|marriott|hilton|hyatt|fairmont|shangri-la|sheraton|westin|accor|ibis|novotel|sofitel|mercure|intercontinental|holiday inn|crowne plaza|four seasons|mandarin oriental|raffles|conrad|doubletree|regis)\b/i;

function extractStay(text, warnings) {
  const checkInLabel = text.match(/check[\s-]?in\b/i);
  const checkOutLabel = text.match(/check[\s-]?out\b/i);
  if (!checkInLabel && !checkOutLabel && !PROPERTY_WORDS.test(text)) return null;

  const dates = findDates(text);
  const stay = { type: 'stay' };

  if (checkInLabel) stay.checkIn = nearest(dates, checkInLabel.index, 200)?.value;
  if (checkOutLabel) stay.checkOut = nearest(dates, checkOutLabel.index, 200)?.value;
  // Fallback: exactly two distinct dates in the whole email → in/out.
  if (!stay.checkIn && !stay.checkOut) {
    const unique = [...new Set(dates.map((d) => d.value))];
    if (unique.length === 2) [stay.checkIn, stay.checkOut] = unique.sort();
  }

  const lines = text.split('\n');
  const afterPhrase = text.match(/(?:your (?:booking|reservation|stay) (?:at|in)|reservation confirmed[:\s-]*(?:at)?|thanks[^\n]*booking at)\s+([^\n.,]{3,80})/i);
  if (afterPhrase) stay.property = afterPhrase[1].trim();
  if (!stay.property) {
    const line = lines.find((l) => PROPERTY_WORDS.test(l) && l.length > 3 && l.length < 90 && !/check[\s-]?(in|out)|cancell|polic|email|@/i.test(l));
    if (line) stay.property = line.replace(/^(your stay at|welcome to)\s*/i, '').trim();
  }

  const conf = text.match(/(?:confirmation|booking|reservation|itinerary)\s*(?:number|no\.?|code|id|#|reference)\s*[:#]?\s*([A-Z0-9-]{5,16})\b/i);
  if (conf) stay.confirmationNo = conf[1];

  const addr = text.match(/address\s*[:\s]\s*([^\n]{8,120})/i);
  if (addr) stay.address = addr[1].trim();

  if (!stay.property && !stay.checkIn) return null; // not actually a hotel email
  const missing = ['property', 'checkIn', 'checkOut', 'confirmationNo'].filter((k) => !stay[k]);
  if (missing.length) warnings.push(`stay: could not find ${missing.join(', ')} — fill in manually`);
  return stay;
}

// ---------------------------------------------------------------------------

// The public entry point: raw email/text in, candidate segments out.
// Never throws on messy input; never invents a value it didn't read.
export function extractBooking(raw) {
  const warnings = [];
  const text = emailToText(raw);
  if (!text.trim()) return { segments: [], warnings: ['nothing readable in the input'] };

  const flights = extractFlights(text, warnings);
  const segments = [...flights];

  // Hotel details often ride along in flight+hotel packages; look for a stay
  // either way, but only flag "nothing found" when both came up empty.
  const stay = extractStay(text, warnings);
  if (stay) segments.push(stay);

  if (!segments.length) {
    warnings.push('no flight or hotel details recognized — add the booking manually, or ask your AI agent to ingest it');
  }
  return { segments, warnings };
}
