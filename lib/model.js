import crypto from 'node:crypto';

export const SEGMENT_TYPES = ['flight', 'stay', 'transport', 'activity'];
export const TRIP_STATUSES = ['dreaming', 'planning', 'booked', 'done'];

export function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(5).toString('hex')}`;
}

// The chronological sort key for a segment or candidate: flights/transport
// order by departure, stays by check-in, activities by their date.
export function segmentSortKey(seg) {
  return seg.depLocal || seg.checkIn || seg.date || '9999-12-31';
}

// Light shape checks — enough to keep agent-POSTed items from corrupting a
// collection, not a full schema. Returns an error string or null.
export function validateItem(name, item) {
  if (typeof item !== 'object' || item === null || Array.isArray(item)) return 'expected an object';
  const need = (fields) => {
    for (const f of fields) {
      if (item[f] === undefined || item[f] === null || item[f] === '') return `missing field: ${f}`;
    }
    return null;
  };
  switch (name) {
    case 'travelers': return need(['name']);
    case 'cards': return need(['name', 'network']);
    case 'programs': return need(['kind', 'program', 'memberNumber']);
    case 'trips': {
      const err = need(['name', 'status']);
      if (err) return err;
      return TRIP_STATUSES.includes(item.status) ? null : `invalid status: ${item.status}`;
    }
    case 'segments':
    case 'candidates': {
      const err = need(['tripId', 'type']);
      if (err) return err;
      return SEGMENT_TYPES.includes(item.type) ? null : `invalid type: ${item.type}`;
    }
    case 'expenses': return need(['tripId', 'date', 'amount', 'currency', 'payerId']);
    case 'exchanges': return need(['tripId', 'date', 'fromAmount', 'toAmount', 'toCurrency']);
    case 'policies': return need(['insurer', 'policyNumber', 'type']);
    default: return null;
  }
}

// Copy a candidate into segments (dropping candidate-only fields) and mark it
// promoted. Returns { candidates, segments, segment } with new arrays.
export function promoteCandidate(candidates, segments, candidateId) {
  const candidate = candidates.find((c) => c.id === candidateId);
  if (!candidate) throw new Error(`No candidate with id ${candidateId}`);
  if (candidate.verdict === 'promoted') throw new Error('Candidate was already promoted');
  const { id, price, currency, sourceUrl, verdict, ...rest } = candidate;
  const segment = { id: newId('seg'), ...rest, fromCandidateId: id };
  return {
    segments: [...segments, segment],
    candidates: candidates.map((c) => (c.id === candidateId ? { ...c, verdict: 'promoted' } : c)),
    segment
  };
}

// Every date a trip spans, for the day-by-day itinerary. Empty when dates are
// missing/invalid; capped so a typo ("2062" for "2026") can't render 13,000 rows.
export function tripDays(trip, cap = 120) {
  if (!trip.startDate || !trip.endDate) return [];
  const days = [];
  const end = new Date(`${trip.endDate}T00:00:00Z`);
  let d = new Date(`${trip.startDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || Number.isNaN(end.getTime())) return [];
  while (d <= end && days.length < cap) {
    days.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 86400000);
  }
  return days;
}
