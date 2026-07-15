// "Am I covered for this trip?" — the structured half of the answer.
// Dates, trip duration, and covered travelers are computed strictly; regions
// are surfaced for a human (or an agent reading the policy PDF) to judge,
// because matching "Worldwide excl. USA" against destination strings reliably
// is a fiction. Fine-print questions belong to the PDF, not this file.

import { tripDays } from './model.js';

const EXPIRING_SOON_DAYS = 60;

// Evaluate one policy against one trip. Returns { ok, problems, warnings }.
export function evaluatePolicy(policy, trip) {
  const problems = [];
  const warnings = [];
  const days = tripDays(trip, 1000);

  if (!days.length) return { ok: false, problems: ['trip has no dates'], warnings };

  if (policy.coverageStart && trip.startDate < policy.coverageStart) {
    problems.push(`trip starts before coverage begins (${policy.coverageStart})`);
  }
  if (policy.coverageEnd) {
    if (trip.startDate > policy.coverageEnd) {
      problems.push(`coverage ends ${policy.coverageEnd}, before the trip`);
    } else if (trip.endDate > policy.coverageEnd) {
      // Annual policies usually cover the whole trip if it STARTS inside the
      // window — but that's per-policy fine print, so it's a warning, not a pass.
      warnings.push(`coverage window ends ${policy.coverageEnd}, during the trip — check the policy's wording on trips in progress`);
    }
  }

  if (policy.type === 'annual' && policy.maxTripDays && days.length > Number(policy.maxTripDays)) {
    problems.push(`trip is ${days.length} days; policy covers trips up to ${policy.maxTripDays} days`);
  }

  const covered = policy.coveredTravelerIds || [];
  if (covered.length) {
    const missing = (trip.travelerIds || []).filter((id) => !covered.includes(id));
    if (missing.length) {
      if (missing.length === (trip.travelerIds || []).length) {
        problems.push('none of the trip travelers are on this policy');
      } else {
        warnings.push({ uncoveredTravelerIds: missing });
      }
    }
  }

  if (policy.regions?.length) {
    warnings.push(`regions: ${[].concat(policy.regions).join(', ')} — verify the destination is included`);
  }

  return { ok: problems.length === 0, problems, warnings };
}

// The badge for one trip across all policies:
//   covered   — at least one policy passes with no traveler gaps
//   partial   — best policy passes but leaves someone (or trip tail) uncovered
//   uncovered — policies exist but none passes
//   none      — no policies on file
//   unknown   — trip has no dates yet
export function tripCoverage(trip, policies, travelers = []) {
  if (!trip.startDate || !trip.endDate) {
    return { status: 'unknown', reason: 'trip has no dates yet', policies: [] };
  }
  if (!policies.length) {
    return { status: 'none', reason: 'no policies on file', policies: [] };
  }

  const name = (id) => travelers.find((t) => t.id === id)?.name || id;
  const evaluated = policies.map((policy) => {
    const result = evaluatePolicy(policy, trip);
    const gap = result.warnings.find((w) => w.uncoveredTravelerIds);
    return {
      policyId: policy.id,
      label: `${policy.insurer} ${policy.policyNumber} (${policy.type})`,
      ok: result.ok,
      problems: result.problems,
      uncoveredTravelers: gap ? gap.uncoveredTravelerIds.map(name) : [],
      notes: result.warnings.filter((w) => typeof w === 'string'),
      pdfOnFile: Boolean(policy.pdfPath)
    };
  });

  const clean = evaluated.filter((e) => e.ok && !e.uncoveredTravelers.length && !e.notes.some((n) => n.startsWith('coverage window ends')));
  const passing = evaluated.filter((e) => e.ok);
  const status = clean.length ? 'covered' : passing.length ? 'partial' : 'uncovered';
  return { status, policies: evaluated, best: (clean[0] || passing[0] || null)?.policyId || null };
}

// Policy-list annotations for the insurance screen: active / expiring / expired.
export function policyStatus(policy, today = new Date().toISOString().slice(0, 10)) {
  if (policy.coverageEnd && policy.coverageEnd < today) return 'expired';
  if (policy.coverageStart && policy.coverageStart > today) return 'not yet active';
  if (policy.coverageEnd) {
    const daysLeft = Math.round((new Date(`${policy.coverageEnd}T00:00:00`) - new Date(`${today}T00:00:00`)) / 86400000);
    if (daysLeft <= EXPIRING_SOON_DAYS) return `expiring in ${daysLeft}d`;
  }
  return 'active';
}
