/* What the handler judged, kept apart from what the phone measured.

   The app already records a great deal automatically: the track, the times,
   the distances, the weather, the marks. None of it can answer the two
   questions that decide whether a dog is actually any good — was there
   anything out there to find, and how much did the handler help. Those are
   judgements, and only a person can enter them.

   The fields below are not invented. They are the small set that the real
   score sheets agree on: AKC Scent Work, UKC Nosework, NACSW, FCI IGP
   tracking and Scentwork UK all turn on outcome, on whether a call was
   correct, on handler assistance, and on what the dog did at source.

   Two deliberate refusals:
   - No points, no pass mark. Trailcraft is not a sanctioning body, and a
     total invents a precision none of this has.
   - Nothing here is asked that the app already knows. Asking a handler for
     the run time when the phone timed it is a way of not being used. */

export const DEBRIEF_V = 1;

/** One tap each, in this order, all with a default. */
export const DEBRIEF = [
  {
    id: 'outcome',
    label: 'How did it end',
    why: 'The only field that adds up across runs — and the one that lets a blank search count as a success rather than a failure.',
    required: true,
    options: [
      { v: 'found', label: 'Found it' },
      { v: 'missed', label: 'Missed it' },
      { v: 'false', label: 'Called it wrong' },
      { v: 'blank', label: 'Correctly found nothing' },
      { v: 'aborted', label: 'Stopped the run' },
    ],
  },
  {
    id: 'target',
    label: 'What was out there',
    why: 'Without this every run looks productive, and a false-alert rate cannot be worked out at all.',
    required: true,
    options: [
      { v: 'real', label: 'A real trail' },
      { v: 'control', label: 'A blank — nothing to find' },
      { v: 'decoy', label: 'Someone else’s trail' },
    ],
  },
  {
    id: 'blind',
    label: 'Who knew the answer',
    why: 'Handler-blind and double-blind are different grades of evidence. A run where you knew is a training run, not a test.',
    sticky: true,
    options: [
      { v: 'open', label: 'I knew', told: 'The handler knew' },
      { v: 'handler', label: 'I did not', told: 'The handler did not' },
      { v: 'double', label: 'Nobody there knew' },
    ],
  },
  {
    id: 'help',
    label: 'Help you gave',
    told: 'Help given',
    why: 'The honest version of the thing that quietly flatters every dog.',
    options: [
      { v: 'none', label: 'None' },
      { v: 'line', label: 'Line handling only' },
      { v: 'verbal', label: 'A word at a decision' },
      { v: 'led', label: 'I chose the way', told: 'The handler chose the way' },
    ],
  },
  {
    id: 'response',
    label: 'At the source',
    why: 'What the dog actually did when it got there, which no GPS track can show.',
    options: [
      { v: 'clear', label: 'Clear, unprompted' },
      { v: 'late', label: 'Clear but late' },
      { v: 'interest', label: 'Interest only' },
      { v: 'prompted', label: 'Only when asked' },
    ],
  },
];

/** Optional, and never required to close a run. One tap, several allowed. */
export const FLAGS = [
  { v: 'fouled', label: 'Fouled' },
  { v: 'stress', label: 'Stressed' },
  { v: 'hot', label: 'Too hot' },
  { v: 'distracted', label: 'Distracted' },
  { v: 'kit', label: 'Kit problem' },
  { v: 'safety', label: 'Safety' },
];

/** What the one free line is about, so it can be counted later. */
export const NOTE_TAGS = [
  { v: 'dog', label: 'Dog' },
  { v: 'handler', label: 'Handler' },
  { v: 'trail', label: 'Trail design' },
  { v: 'conditions', label: 'Conditions' },
  { v: 'kit', label: 'Kit' },
];

const byId = new Map(DEBRIEF.map(f => [f.id, f]));
export const fieldById = (id) => byId.get(id) ?? null;
export const labelOf = (id, v) => byId.get(id)?.options.find(o => o.v === v)?.label ?? null;

/* The same answers as someone else reads them. The labels above are written
   for the handler filling the form in, so "I did not" is right on their own
   phone and wrong on the page a student's run arrives on, where the reader
   is a different person. Anything first-person carries a `told` form. */
export const toldField = (id) => { const f = byId.get(id); return f ? (f.told ?? f.label) : null; };
export const toldOf = (id, v) => {
  const o = byId.get(id)?.options.find(x => x.v === v);
  return o ? (o.told ?? o.label) : null;
};

/** A fresh debrief. `last` carries the sticky fields forward: a class runs
    handler-blind all morning and nobody wants to say so eleven times. */
export function blankDebrief(last = null) {
  const d = { v: DEBRIEF_V, flags: [], note: '', noteTag: null };
  for (const f of DEBRIEF) d[f.id] = (f.sticky && last?.[f.id]) || null;
  return d;
}

/** Is it finished enough to save? Only the required fields count. */
export const debriefDone = (d) => !!d && DEBRIEF.every(f => !f.required || d[f.id]);

/** The one-line headline for the result card. Reads as a sentence, not a row
    of codes, and says plainly when the handler knew the answer. */
export function debriefLine(d) {
  if (!d) return '';
  const bits = [];
  if (d.outcome) bits.push(labelOf('outcome', d.outcome));
  if (d.target === 'control') bits.push('on a blank');
  else if (d.target === 'decoy') bits.push('on a decoy trail');
  if (d.blind === 'double') bits.push('nobody knew');
  else if (d.blind === 'handler') bits.push('you did not know');
  else if (d.blind === 'open') bits.push('you knew');
  if (d.help && d.help !== 'none') bits.push(`help: ${labelOf('help', d.help).toLowerCase()}`);
  else if (d.help === 'none') bits.push('no help');
  if (d.response) bits.push(labelOf('response', d.response).toLowerCase());
  return bits.join(' · ');
}

/* ── What it adds up to ───────────────────────────────────────────────
   The point of asking at all. A dog that has only ever run trails it was
   always going to find, with a handler who knew where they were, has a
   perfect record and has proved nothing. */

/** Rates over a set of debriefed runs, split by how blind they were. */
export function debriefRates(sessions) {
  /* A run kept from someone else's link is their dog and their judgement.
     Counting it here would quietly blend two handlers into one record. */
  const rows = (sessions ?? []).filter(s => !s?.data?.imported)
    .map(s => s?.data?.debrief).filter(d => d && d.outcome);
  const count = (f) => rows.filter(f).length;
  const real = rows.filter(d => d.target === 'real');
  const blanks = rows.filter(d => d.target === 'control');
  const tested = rows.filter(d => d.blind === 'handler' || d.blind === 'double');
  return {
    runs: rows.length,
    /* Only a run the handler could not steer says anything about the dog. */
    tested: tested.length,
    found: count(d => d.outcome === 'found'),
    falseCalls: count(d => d.outcome === 'false'),
    findRate: real.length ? real.filter(d => d.outcome === 'found').length / real.length : null,
    blankRate: blanks.length ? blanks.filter(d => d.outcome === 'blank').length / blanks.length : null,
    unaided: count(d => d.help === 'none'),
    clearAtSource: count(d => d.response === 'clear'),
    blanksRun: blanks.length,
  };
}

/** What this dog has never been asked to do. Stated as a gap, not a score —
    it is the most useful thing a training record can tell anyone. */
export function varietyGaps(sessions) {
  const rows = (sessions ?? []).filter(s => !s?.data?.imported && s?.data?.debrief?.outcome);
  const gaps = [];
  if (!rows.length) return gaps;
  const d = rows.map(s => s.data.debrief);
  if (!d.some(x => x.blind === 'handler' || x.blind === 'double')) {
    gaps.push('Every run so far was one you knew the answer to.');
  }
  if (!d.some(x => x.target === 'control')) {
    gaps.push('No blank searches yet — nothing has tested whether the dog will call an empty field.');
  }
  if (!d.some(x => x.help === 'none')) gaps.push('No run yet without help.');
  if (d.length >= 5 && !d.some(x => x.blind === 'double')) {
    gaps.push('No double-blind run yet, so nobody present has been unable to cue.');
  }
  return gaps;
}
