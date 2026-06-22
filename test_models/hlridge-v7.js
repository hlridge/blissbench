// hlridge-v7 — Blissymbolics decode prompt template.
//
// A test_models template object: { name, systemPrompt, build(context) }.
//   • build(context) returns the per-target user-prompt string.
//   • systemPrompt is the constant system message.
//   • Expects the same context object buildContext() provides (spelling, charCount,
//     subwords[].helpers[], indicators[], modifiers[], neighbours{sharedStart,sharedEnd},
//     legend[]). The non-destructive normalizeContext() below fills a few field aliases
//     (e.g. baseSpelling from notation/spelling) so it tolerates minor field-name
//     differences; it never overwrites a field you provide. If a rendered prompt shows the
//     literal "undefined", ping hlridge — a field name drifted and it's a one-line fix.
//
// Registered in prompt_templates.js:  import hlridgeV7 from "./hlridge-v7.js";

const header = (context) =>
  `Spelling: ${context.spelling}  (${context.charCount} character${context.charCount === 1 ? '' : 's'})`;

const glossesOf = (helpers, max = 6) =>
  helpers.map((h) => h.gloss).filter(Boolean).slice(0, max).join(' | ');

const subwordLines = (context) =>
  [...context.subwords]
    .sort((a, b) => b.length - a.length)
    .map((s) => ({ baseSpelling: s.baseSpelling, glosses: glossesOf(s.helpers) }))
    .filter((s) => s.glosses)
    .map((s) => `  ${s.baseSpelling}: ${s.glosses}`);

const POS_LABEL = { noun: 'noun', description: 'adjective', action: 'verb', expression: 'marker' };
const IND_LABEL = {
  'INDICATOR THING': 'concrete',
  'INDICATOR DESCRIPTION': 'adjective',
  'INDICATOR DESCRIPTION AFTER THE FACT': 'adjective',
  'INDICATOR ACTION': 'verb',
};
const senseLabel = (helper) => {
  const ind = (helper.indicators || [])[0];
  return (ind && IND_LABEL[ind.name]) || POS_LABEL[helper.pos] || helper.pos || '';
};

const helperMatchesTarget = (helper, subword, targetIndicators) => {
  const hInds = new Set((helper.indicators || []).map((i) => i.spelling));
  if (!hInds.size) return false;
  const [start, end] = subword.span || [0, 0];
  return (targetIndicators || []).some(
    (ti) => ti.characterIndex >= start && ti.characterIndex < end && hInds.has(ti.spelling)
  );
};

const subwordSenseLines = (context) => {
  const targetIndicators = context.indicators || [];
  const lines = [];
  for (const s of [...context.subwords].sort((a, b) => b.length - a.length)) {
    const helpers = (s.helpers || []).filter((h) => h.gloss);
    if (!helpers.length) continue;
    const w = Math.max(...helpers.map((h) => (h.spelling || '').length));
    lines.push(`  ${s.baseSpelling}:`);
    for (const h of helpers) {
      const flag = helperMatchesTarget(h, s, targetIndicators) ? "   ← matches this word's indicator" : '';
      lines.push(`    ${(h.spelling || '').padEnd(w)}  ${senseLabel(h).padEnd(9)} — ${h.gloss}${flag}`);
    }
  }
  return lines;
};

const GROUP_READS_AS = { Adjectival: 'an adjective/adverb', Verbal: 'a verb', Nominal: 'a concrete noun' };
const grammarSummary = (context) => {
  const inds = context.indicators || [];
  if (!inds.length) return null;
  const reads = [...new Set(inds.map((i) => GROUP_READS_AS[i.group] || i.purpose || i.name))];
  return `This word is marked as ${reads.join(' + ')} — read the answer in that grammatical form.`;
};

const modifierLines = (context) => {
  const mods = context.modifiers || [];
  const w = mods.length ? Math.max(...mods.map((m) => (m.spelling || '').length)) : 0;
  return mods.map((m) => {
    const name = (m.asPrefix || []).join(' / ') || m.gloss || m.spelling;
    const effect = m.gloss && m.gloss !== name ? ` — ${m.gloss}` : '';
    return `  ${(m.spelling || '').padEnd(w)}  ${name}${effect}`;
  });
};

const indicatorLines = (context) => {
  const inds = context.indicators || [];
  const glyphs = (context.baseSpelling || context.spelling || '').split('/');
  const w = inds.length ? Math.max(...inds.map((i) => (i.spelling || '').length)) : 0;
  return inds.map((i) => {
    const glyph = glyphs[i.characterIndex];
    const where = glyph ? `on ${glyph}` : 'whole word';
    const effect = i.purpose ? i.purpose.charAt(0).toLowerCase() + i.purpose.slice(1) : i.name || '';
    return `  ${(i.spelling || '').padEnd(w)}  ${where} — ${effect}`;
  });
};

const allIndicators = (context) => {
  const seen = new Map();
  const add = (list) => (list || []).forEach((i) => {
    const code = i.spelling || i.code;
    if (code && !seen.has(code)) seen.set(code, i);
  });
  add(context.indicators);
  (context.subwords || []).forEach((s) => (s.helpers || []).forEach((h) => add(h.indicators)));
  add(context.siblings && context.siblings.flatMap((h) => h.indicators || []));
  const nb = context.neighbours || {};
  [...(nb.sharedStart || []), ...(nb.sharedEnd || [])].forEach((n) => add(n.indicators));
  return [...seen.values()].sort(
    (a, b) => parseInt((a.spelling || a.code).slice(1), 10) - parseInt((b.spelling || b.code).slice(1), 10)
  );
};

const indicatorKeyLines = (context) => {
  const inds = allIndicators(context);
  const w = inds.length ? Math.max(...inds.map((i) => (i.spelling || i.code).length)) : 0;
  return inds.map((i) => {
    const code = i.spelling || i.code;
    const effect = i.purpose ? i.purpose.charAt(0).toLowerCase() + i.purpose.slice(1) : i.name || '';
    return `  ${code.padEnd(w)} — ${effect}`;
  });
};

const siblingLines = (context) =>
  context.siblings.filter((h) => h.gloss).map((h) => `  (${h.pos || '-'}) ${h.gloss}`);

const neighbourLines = (context, max = 5) => {
  const ns = context.neighbours || {};
  const lines = [];
  for (const n of (ns.sharedStart || []).slice(0, max)) {
    if (n.gloss) lines.push(`  ${n.baseSpelling} = ${n.gloss} (shares start)`);
  }
  for (const n of (ns.sharedEnd || []).slice(0, max)) {
    if (n.gloss) lines.push(`  ${n.baseSpelling} = ${n.gloss} (shares end)`);
  }
  return lines;
};

const block = (lines, title, body) => {
  if (body && body.length) {
    lines.push('', `${title}:`, ...body);
  }
};

const OUTPUT_FORM = {
  Adjectival: 'All 5 guesses must be adjectives or adverbs.',
  Verbal: 'All 5 guesses must be verbs in the "to …" form.',
  Nominal: 'All 5 guesses must be singular nouns.',
};
const outputFormLine = (context) => {
  const groups = [...new Set((context.indicators || []).map((i) => i.group).filter(Boolean))];
  for (const g of groups) if (OUTPUT_FORM[g]) return OUTPUT_FORM[g];
  return 'All 5 guesses must be singular nouns (unless the concept is one English only writes in the plural).';
};

const SYSTEM_PROMPT = `You are decoding a Blissymbolics word into English.

How a Blissymbolics word is built — read the spelling with this in mind:

• Characters & concepts. A spelling is B-codes joined by "/", e.g. B001/B002. Each
  character names one concept, and the characters combine into a single new concept.

• Read the spelling as a structure, not a list of meanings to add up. For each glyph
  decide its ROLE — does it NAME a thing, or OPERATE on the rest? Getting the roles
  right is the load-bearing step.

• Classifier + specifier — narrowing from the RIGHT. The classifier (the left member
  of a pair) is the broad head; the specifier to its right narrows it, so B001/B002 is
  a specific kind of B001, the B002 sort. A specifier can pull the head all the way to
  a restricted or opposite form, not just a sub-type of it.

• Modifier / operator — acting from the LEFT. A leading glyph can instead operate on
  what follows rather than name a thing. The evidence flags which glyphs act this way
  and gives each one's effect — treat a flagged glyph as an instruction to apply, and
  read its meaning off that list rather than guessing.

• Apply operators fully — a glyph can transform what it combines with, even reverse or
  restrict it, and that is the easiest thing to lose. Whether it acts from the left or
  narrows from the right, if its effect inverts or limits the other concept, the answer
  is that inverted or restricted concept — not the base concept. Setting the glyphs'
  plain meanings side by side, and giving the un-transformed word, is the classic error.

• Nesting is hierarchical and often ambiguous. In B001/B002/B003 either:
    (a) B002 specifies B001, then B003 specifies that whole unit → ((B001/B002)/B003), or
    (b) B003 specifies B002 first, then B002/B003 specifies B001 → (B001/(B002/B003)).
  Operators nest the same way — one can apply to a single glyph or to a whole group.
  Weigh both readings and pick the most plausible.

• Indicators are grammar, not concepts. A code after ";" (e.g. B001;Bxx) is an
  indicator. Almost all indicators apply to the WHOLE word and fix its part of speech
  (sometimes a variant of it). The exceptions are two character-scoped sense markers
  that affect only their own glyph: B97 (concrete) and B6436 (abstract) — and in
  practice the abstract sense is just the indicatorless default form, so B97 is the
  one you'll normally see. A word with NO part-of-speech indicator is a noun: answer
  with a noun, not the bare adjective or verb of one of its glyphs. Give it in the
  singular — one of the thing — unless a plural indicator is present; the exception is
  concepts English only ever writes in the plural, where the ordinary form is natural.

The evidence below may list each glyph's senses, concepts that can act as modifiers,
sibling and neighbour words, and an indicator key.

Then work in two steps:

STEP 1 — find the MEANING. Use the roles above (classifier, specifier, operator) to settle
what single concept the whole spelling points to, applying any operator that inverts or
restricts. This step decides the meaning, not the wording.

STEP 2 — NAME it. Ask: what is the ordinary English word a fluent speaker uses for that exact
concept? A Bliss-word stands for ONE established concept, so the answer is its conventional
name — usually a single word, sometimes a fixed term English treats as one lexical item. The
glyph meanings were only clues for finding it; do not hand them back as a description. If your
best guess is one concept modifying another (an ad-hoc "X-ish Y"), take that as a sign you have
stopped at the description and not yet recalled the word — push past it to the real term.

Also: a Bliss-word for a broad category often means the most common or most fitting MEMBER of
that category, not the bare category. So when your reading lands on a general class rather than
one specific thing, include the most familiar specific example of it among your guesses too —
the one the context points to if it hints, otherwise the most common one — while still also
offering the general term. Use a phrase only when English genuinely has no single name. Answer
in the part of speech the indicators mark.

Do both steps in your head, then output ONLY the 5 best names as a JSON array of 5 strings,
best first.`;

const userContent = (context) => {
  const lines = [header(context)];
  const grammar = grammarSummary(context);
  if (grammar) lines.push(grammar);
  block(lines, "Building-block glyphs (each glyph's meaning shifts with its grammar indicator)", subwordSenseLines(context));
  block(lines, 'Concepts that can act as modifiers', modifierLines(context));
  block(lines, 'Sibling words (other entries written with the same glyphs)', siblingLines(context));
  block(lines, "Neighbour words (share this word's opening or ending glyphs)", neighbourLines(context, Infinity));
  block(lines, 'Indicator key (same code = same grammatical effect wherever it appears)', indicatorKeyLines(context));
  return lines.join('\n');
};

const buildMessages = (context) => [
  { role: 'system', content: SYSTEM_PROMPT },
  { role: 'user', content: userContent(context) },
];

// ────────────────────────────────────────────────────────────────────────────────────────────
// Adapter — maps the inlined buildMessages(context) -> [{system},{user}] onto the
// { name, systemPrompt, build } shape, and shields against minor context field-name drift.
// ────────────────────────────────────────────────────────────────────────────────────────────
const __fill = (o, k, v) => {
  if (o && (o[k] === undefined || o[k] === null) && v !== undefined && v !== null) o[k] = v;
};
const __nz = (v) => (v === undefined || v === null ? undefined : v);

// Non-destructive: only FILLS missing fields from plausible aliases; never overwrites yours.
const normalizeContext = (ctx) => {
  if (!ctx || typeof ctx !== 'object') return ctx;
  const c = { ...ctx };
  __fill(c, 'baseSpelling', __nz(c.notation) ?? c.spelling);
  __fill(c, 'spelling', c.notation);
  __fill(c, 'charCount', typeof c.spelling === 'string' && c.spelling ? c.spelling.split('/').length : undefined);
  c.indicators = (c.indicators || []).map((i) => {
    const x = { ...i };
    __fill(x, 'spelling', __nz(x.notation) ?? x.code);
    return x;
  });
  c.modifiers = (c.modifiers || []).map((m) => {
    const x = { ...m };
    __fill(x, 'spelling', __nz(x.notation) ?? (Array.isArray(x.codes) ? x.codes.join('/') : undefined));
    return x;
  });
  c.subwords = (c.subwords || []).map((s) => {
    const x = { ...s };
    __fill(x, 'baseSpelling', __nz(x.notation) ?? x.spelling);
    __fill(x, 'spelling', x.notation);
    __fill(x, 'length', (x.baseSpelling || x.spelling || '').split('/').filter(Boolean).length || undefined);
    x.helpers = (x.helpers || []).map((h) => {
      const y = { ...h };
      __fill(y, 'baseSpelling', __nz(y.notation) ?? y.spelling);
      __fill(y, 'spelling', y.notation);
      return y;
    });
    return x;
  });
  c.siblings = (c.siblings || []).map((h) => ({ ...h }));
  const nb = c.neighbours || {};
  const fixN = (n) => {
    const x = { ...n };
    __fill(x, 'baseSpelling', __nz(x.notation) ?? x.spelling);
    __fill(x, 'spelling', x.notation);
    return x;
  };
  c.neighbours = { ...nb, sharedStart: (nb.sharedStart || []).map(fixN), sharedEnd: (nb.sharedEnd || []).map(fixN) };
  c.legend = (c.legend || []).map((e) => {
    const x = { ...e };
    __fill(x, 'spelling', x.notation);
    return x;
  });
  return c;
};

// A minimal stub context just to read the constant system message at load time (it does not
// depend on per-target data). The user message it would produce is discarded.
const __STUB = {
  spelling: '', baseSpelling: '', charCount: 0,
  modifiers: [], indicators: [], subwords: [], siblings: [],
  neighbours: { sharedStart: [], sharedEnd: [], omitted: 0 }, legend: [],
};
const __system = (buildMessages(__STUB).find((m) => m.role === 'system') || {}).content;

export default {
  name: "hlridge-v7",
  systemPrompt: __system,
  build: (context) => {
    const msgs = buildMessages(normalizeContext(context));
    const user = msgs.find((m) => m.role === 'user');
    return user ? user.content : '';
  },
};

