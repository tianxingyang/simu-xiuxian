# Redesign Name Generator with Corpus Data

## Goal

Redesign the 修仙 name generator in `server/identity.ts`, replacing the "random independent character" approach with a corpus-trained bigram model. Names will sound natural because character pairings are validated by real-world name data.

## Requirements

- Replace current independent random char selection with bigram transition model
- Expand single surnames from 60 → ~100 (based on corpus frequency)
- Expand compound surnames from 14 → ~20
- Given name generation: bigram model (first char → weighted successor) from merged 120W modern + 25W ancient corpus
- Maintain PRNG determinism (same seed → same name sequence)
- Preserve existing IdentityManager API unchanged
- 修仙 aesthetic: char pool curated to classical/fantasy style

## Acceptance Criteria

- [ ] Generated names use bigram transitions (no independent random char selection)
- [ ] Bigram table derived from corpus data (~4900+ validated pairs)
- [ ] ~610K+ unique full name combinations available
- [ ] Same seed produces identical name sequence
- [ ] Existing tests pass (if any)
- [ ] No multi-MB data files — bigram table inlined as TS constant

## Decision (ADR-lite)

**Context**: Current name generator picks given-name chars independently, producing unnatural combinations. User wants to leverage Chinese-Names-Corpus for better quality.

**Decision**: Bigram (1st-order Markov chain) model. Pre-compute P(char2|char1) from corpus, filter to 修仙 char set, embed as compact TS lookup table. Neural models rejected due to PRNG determinism constraint and sequence length (1-2 chars makes neural approaches overkill).

**Consequences**: Names are corpus-validated combinations. Pool size (~610K) matches current capacity. Data is static — if char set changes, need to re-run extraction script.

## Out of Scope

- Gender-differentiated names
- Name generation based on cultivation attributes
- Neural/ML model approach
- Weighted surname selection by real-world frequency

## Technical Approach

### Data structure
```typescript
// Bigram: first char → string of valid second chars
const BIGRAM: Record<string, string> = {
  '云': '龙峰霞华清风松辉兰...',
  '天': '龙华星云辉峰瑞...',
};
const FIRST_CHARS = Object.keys(BIGRAM);
```

### Generation flow (rawName)
1. Pick surname (85% single / 15% compound) — unchanged
2. Decide 1-char (30%) or 2-char (70%) given name
3. For 1-char: uniform pick from full char pool
4. For 2-char: pick first char from FIRST_CHARS, then pick second char uniformly from BIGRAM[first]

### Data files
- Offline Python script generates bigram data from corpus
- Output written directly into `server/identity.ts` constants
- No runtime data files needed

## Technical Notes

- Source file: `server/identity.ts`
- Corpus: https://github.com/wainshine/Chinese-Names-Corpus (cloned to /tmp)
- Merged corpus yields 4,921 bigram transitions across 164 修仙-flavored chars
- 6 isolated chars (琉/璃/谧/阴/魂/魄) kept in single-char pool only
