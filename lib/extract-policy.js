// Heuristic extraction of the structured fields tripfolio stores for a travel
// insurance policy, from a policy schedule / certificate of insurance —
// pasted text, a saved .html/.eml, or the text pulled out of a PDF
// (lib/pdf-text.js). The insurance counterpart of lib/extract.js.
//
// Same philosophy as the booking extractor: assistive, not autonomous. The
// result prefills the Add-policy form for a human to check; every field we
// couldn't find is reported in `warnings` rather than guessed, and we never
// invent a value we didn't read. An AI agent reading the document via the
// ingest-policy skill is still the higher-accuracy path — this one needs no
// agent and works offline.

import { emailToText, findDates } from './extract.js';

// Recognisable insurer names, most-specific first so "NTUC Income" wins over a
// bare "Income". Not exhaustive and not the only signal — an "Insurer:" /
// "Underwritten by" label is tried too, so an unlisted carrier still resolves.
const INSURERS = [
  [/\bNTUC\s+Income\b|\bIncome\s+Insurance\b/i, 'NTUC Income'],
  [/\bAIG\b/i, 'AIG'],
  [/\bAllianz\b/i, 'Allianz'],
  [/\bAXA\b/i, 'AXA'],
  [/\bChubb\b/i, 'Chubb'],
  [/\bMSIG\b/i, 'MSIG'],
  [/\bGreat\s+Eastern\b/i, 'Great Eastern'],
  [/\bFWD\b/i, 'FWD'],
  [/\bSinglife\b|\bSingapore\s+Life\b/i, 'Singlife'],
  [/\bTokio\s+Marine\b/i, 'Tokio Marine'],
  [/\bZurich\b/i, 'Zurich'],
  [/\bEtiqa\b/i, 'Etiqa'],
  [/\bSompo\b/i, 'Sompo'],
  [/\bHL\s+Assurance\b/i, 'HL Assurance'],
  [/\bDirect\s+Asia\b/i, 'Direct Asia'],
  [/\bStarr\b/i, 'Starr'],
  [/\bWorld\s+Nomads\b/i, 'World Nomads'],
  [/\bTravel\s+Guard\b/i, 'Travel Guard'],
  [/\bCigna\b/i, 'Cigna'],
  [/\bBupa\b/i, 'Bupa'],
  [/\bIncome\b/i, 'Income']
];

function findInsurer(text) {
  const label = text.match(/(?:insurer|underwrit(?:ten|er)(?:\s+by)?|insured\s+by|insurance\s+company)\s*[:\-]\s*([^\n]{3,60})/i);
  if (label) {
    const name = label[1].trim().replace(/[.,;]+$/, '');
    // Prefer a known short name if one appears inside the labelled value.
    for (const [re, name2] of INSURERS) if (re.test(name)) return name2;
    if (name.length >= 3) return name;
  }
  for (const [re, name] of INSURERS) if (re.test(text)) return name;
  return null;
}

function findPolicyNumber(text) {
  const m = text.match(
    /(?:policy|certificate)\s*(?:\/\s*certificate)?\s*(?:number|no\.?|#|ref(?:erence)?)\s*[:#]?\s*([A-Z0-9][A-Z0-9/\-]{3,24})/i
  );
  if (!m) return null;
  const value = m[1].toUpperCase().replace(/[/\-]+$/, '');
  // A bare year is a false positive (e.g. "Policy year: 2026").
  return /^\d{4}$/.test(value) ? null : value;
}

function findType(text) {
  const single = /\bsingle[-\s]?trip\b/i.test(text);
  const annual = /\bannual\s+multi[-\s]?trip\b|\bmulti[-\s]?trip\b|\bannual\s+(?:travel\s+)?(?:insurance|plan|policy|cover)\b/i.test(text);
  if (annual && !single) return 'annual';
  if (single) return 'single';
  return null;
}

// The coverage window. A "Period of Insurance"-style label with two nearby
// dates is the strong signal; otherwise fall back to explicit start/end labels.
function findCoverage(text) {
  const dates = findDates(text);
  if (!dates.length) return {};

  const period = text.match(/period of (?:insurance|cover(?:age)?)|policy period|coverage period|insurance period/i);
  if (period) {
    const near = dates.filter((d) => d.index >= period.index && d.index < period.index + 200).slice(0, 2);
    if (near.length >= 2) return { coverageStart: near[0].value, coverageEnd: near[1].value };
    if (near.length === 1) return { coverageStart: near[0].value };
  }

  const out = {};
  const startLbl = text.match(/(?:effective|commencement|inception|start|valid\s+from|period\s+from)\s*(?:date)?\s*[:\-]?/i);
  const endLbl = text.match(/(?:expiry|expiration|end|valid\s+(?:to|until)|period\s+to|expires?\s+on)\s*(?:date)?\s*[:\-]?/i);
  const nearest = (idx) => {
    let best = null;
    for (const d of dates) {
      const dist = d.index - idx;
      if (dist >= 0 && dist <= 120 && (!best || dist < best.index - idx)) best = d;
    }
    return best?.value;
  };
  if (startLbl) out.coverageStart = nearest(startLbl.index);
  if (endLbl) out.coverageEnd = nearest(endLbl.index);
  return out;
}

// Parse the first currency amount within ~100 chars of a benefit label.
// Requires a currency marker or a thousands-grouped number, so "24 hours" or
// "up to 90 days" nearby doesn't masquerade as a dollar limit.
function amountNear(text, labelRe) {
  const m = text.match(labelRe);
  if (!m) return null;
  const window = text.slice(m.index, m.index + 100);
  const a = window.match(/(?:SGD|S\$|US\$|USD|A\$|AUD|£|€|\$)\s?(\d[\d,]*)(?:\.\d{2})?|\b(\d{1,3}(?:,\d{3})+)(?:\.\d{2})?\b/i);
  if (!a) return null;
  const val = Number((a[1] || a[2] || '').replace(/,/g, ''));
  return Number.isFinite(val) && val > 0 ? val : null;
}

function findLimits(text) {
  const limits = {};
  const medical = amountNear(text, /(?:overseas\s+|emergency\s+)?medical\s+(?:expenses?|cover(?:age)?|benefits?|&\s*(?:dental|evacuation))/i);
  const cancellation = amountNear(text, /trip cancellation|cancellation(?:\s*&\s*curtailment)?|cancelling your trip/i);
  const baggage = amountNear(text, /baggage(?:\s*&\s*personal\s*effects)?|loss of baggage|personal baggage|luggage/i);
  if (medical) limits.medical = medical;
  if (cancellation) limits.cancellation = cancellation;
  if (baggage) limits.baggage = baggage;
  return Object.keys(limits).length ? limits : null;
}

function findRegions(text) {
  const label = text.match(/(?:area of cover(?:age)?|geographical\s+(?:area|scope|limit|cover)|region of cover|area\s+of\s+travel)\s*[:#\-]?\s*([^\n]{2,45})/i);
  if (label) return [label[1].trim().replace(/[.;]+$/, '')];
  if (/worldwide\s+(?:excluding|excl\.?|except)\s+(?:the\s+)?(?:usa|us\b|united states|america|canada)/i.test(text)) return ['Worldwide excl. USA'];
  if (/\bworldwide\b/i.test(text)) return ['Worldwide'];
  if (/\basia[-\s]?pacific\b/i.test(text)) return ['Asia Pacific'];
  if (/\basia\b/i.test(text)) return ['Asia'];
  return null;
}

function findMaxTripDays(text) {
  const m = text.match(/(?:up to|maximum(?:\s+of)?|each trip[^.\n]{0,30}?|per trip[^.\n]{0,30}?)\s(\d{1,3})\s*days?\b/i)
    || text.match(/\b(\d{1,3})\s*days?\b[^.\n]{0,30}?(?:per trip|each trip|any one trip)/i);
  return m ? Number(m[1]) : null;
}

// The named plan/tier (e.g. "Travel Plus", "Prestige") — worth keeping in
// notes because per-benefit sums insured are defined by the plan, not the
// schedule.
function findPlan(text) {
  const m = text.match(/plan\s*(?:type|name)?\s*[:\-]\s*([^\n]{2,40})/i);
  return m ? m[1].trim().replace(/[.;]+$/, '') : null;
}

// Optional riders bought on top of the base plan — real coverage the user
// added (e.g. Winter Sports, Cancel For Any Reason). Each rider sits on its own
// line under the label; collect them until the next all-caps section heading.
const isHeading = (line) => /[A-Z]{3}/.test(line) && !/[a-z]/.test(line);
function findOptionalCovers(text) {
  const lines = text.split('\n');
  const idx = lines.findIndex((l) => /optional\s+cover/i.test(l));
  if (idx < 0) return [];
  const out = [];
  const sameLine = lines[idx].split(/optional\s+cover(?:\(s\)|s)?\s*[:\-]\s*/i)[1];
  if (sameLine?.trim()) out.push(sameLine.trim());
  for (let j = idx + 1; j < lines.length && out.length < 6; j++) {
    const l = lines[j].trim();
    if (!l) continue;
    if (isHeading(l) || l.length > 45) break;
    out.push(l);
  }
  return [...new Set(out.map((s) => s.replace(/[.;,]+$/, '').trim()).filter((s) => s.length > 2 && /[a-z]/i.test(s)))];
}

// Benefit table rows: a benefit name followed by a sum insured on the same
// line. Requires the amount, so a schedule that lists no figures yields none
// (rather than inventing them). Premium/GST/total lines are not benefits.
export function findBenefits(text) {
  const benefits = [];
  const seen = new Set();
  for (const line of text.split('\n')) {
    const m = line.match(/^(.{3,70}?)[\s.\-–:]*(?:S?\$|SGD|USD|A\$|AUD|£|€)\s?(\d[\d,]*)(?:\.\d{2})?\b/i);
    if (!m) continue;
    const name = m[1].replace(/[\s.\-–:]+$/, '').trim();
    const limit = Number(m[2].replace(/,/g, ''));
    if (!name || !/[a-z]/i.test(name) || !Number.isFinite(limit) || limit <= 0) continue;
    if (/\b(premium|total(?:\s+due)?|gst|tax|discount|excess|deductible|refund)\b/i.test(name)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    benefits.push({ name, limit });
  }
  return benefits;
}

// Load-bearing fine print that doesn't have its own field, folded into `notes`.
function buildNotes(text) {
  const parts = [];
  const plan = findPlan(text);
  if (plan) parts.push(`Plan: ${plan}`);
  const optional = findOptionalCovers(text);
  if (optional.length) parts.push(`Optional cover: ${optional.join(', ')}`);
  if (/does not cover[^.\n]*pre[\s-]?existing|pre[\s-]?existing[^.\n]*(?:not covered|excluded)/i.test(text)) {
    parts.push('Excludes pre-existing medical conditions');
  }
  return parts.join('. ') || null;
}

// Public entry point: raw document text (or .html/.eml) in, prefill fields +
// warnings out. Never throws; never invents a value it didn't read.
export function extractPolicy(raw) {
  const warnings = [];
  const text = emailToText(raw);
  if (!text.trim()) return { policy: {}, warnings: ['nothing readable in the document'] };

  const policy = {};
  const set = (k, v) => { if (v != null && v !== '' && !(Array.isArray(v) && !v.length)) policy[k] = v; };

  set('insurer', findInsurer(text));
  set('policyNumber', findPolicyNumber(text));
  set('type', findType(text));
  const coverage = findCoverage(text);
  set('coverageStart', coverage.coverageStart);
  set('coverageEnd', coverage.coverageEnd);
  set('regions', findRegions(text));
  const benefits = findBenefits(text);
  set('benefits', benefits);
  // Headline three: prefer a labelled amount, else pull from the benefit table.
  const byBenefit = (re) => benefits.find((b) => re.test(b.name))?.limit;
  const limits = findLimits(text) || {};
  if (limits.medical == null) limits.medical = byBenefit(/medical/i);
  if (limits.cancellation == null) limits.cancellation = byBenefit(/cancellation/i);
  if (limits.baggage == null) limits.baggage = byBenefit(/baggage|luggage/i);
  set('limits', Object.fromEntries(Object.entries(limits).filter(([, v]) => v != null)));
  if (!Object.keys(policy.limits || {}).length) delete policy.limits;
  set('notes', buildNotes(text));
  if (policy.type !== 'single') set('maxTripDays', findMaxTripDays(text));

  const missing = [];
  for (const [k, label] of [
    ['insurer', 'insurer'], ['policyNumber', 'policy number'], ['type', 'policy type'],
    ['coverageStart', 'coverage start'], ['coverageEnd', 'coverage end']
  ]) if (!policy[k]) missing.push(label);
  if (missing.length) warnings.push(`could not find ${missing.join(', ')} — fill in manually`);
  if (!policy.benefits && !policy.limits) {
    warnings.push('no benefit amounts in this document — the sums insured are set by the plan, so add them from the policy wording (or let your AI agent read it via the ingest-policy skill)');
  }

  return { policy, warnings };
}
