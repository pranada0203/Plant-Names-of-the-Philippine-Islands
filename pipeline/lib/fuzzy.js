'use strict';
/**
 * Near-match lookup for joining the book's two halves.
 *
 * The same plant name was OCR'd twice -- once in the native index, once in the
 * scientific index -- and the two readings often disagree by a letter or two
 * ("Angud" / "Angupb", "Lopo-lopo" / "L6po-l6po"). Exact keys join only about
 * a fifth of them. One edit of tolerance, bucketed so it stays cheap, joins
 * most of the rest without inventing matches between genuinely distinct names.
 */

/** True if a and b differ by at most one insertion, deletion or substitution. */
function withinOneEdit(a, b) {
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  if (a === b) return true;

  if (la === lb) {
    let diffs = 0;
    for (let i = 0; i < la; i++) {
      if (a[i] !== b[i] && ++diffs > 1) return false;
    }
    return diffs === 1;
  }

  // One string is shorter: check it is the other with a single character removed.
  const [short, long] = la < lb ? [a, b] : [b, a];
  let i = 0;
  let j = 0;
  let skipped = false;
  while (i < short.length && j < long.length) {
    if (short[i] === long[j]) { i++; j++; continue; }
    if (skipped) return false;
    skipped = true;
    j++;
  }
  return true;
}

/**
 * Index of keys supporting exact and one-edit lookup.
 * Buckets by first character and length so a query touches only a handful of
 * candidates instead of the whole vocabulary.
 */
class NearIndex {
  constructor() {
    this.exact = new Map();
    this.buckets = new Map();
  }

  static bucketKeys(key) {
    const head = key.charAt(0);
    const n = key.length;
    // A one-edit neighbour may differ in length by one, and -- if the edit is
    // at the front -- in first character too. Register under both spellings.
    return [`${head}:${n}`, `${head}:${n - 1}`, `${head}:${n + 1}`, `*:${n}`, `*:${n - 1}`];
  }

  add(key, value) {
    if (!key) return;
    if (!this.exact.has(key)) this.exact.set(key, value);
    for (const b of NearIndex.bucketKeys(key)) {
      if (!this.buckets.has(b)) this.buckets.set(b, []);
      this.buckets.get(b).push({ key, value });
    }
  }

  /** Exact hit if there is one, else a unique one-edit hit, else null. */
  find(key) {
    if (!key) return null;
    if (this.exact.has(key)) return { value: this.exact.get(key), exact: true };

    const seen = new Set();
    const hits = [];
    for (const b of NearIndex.bucketKeys(key)) {
      for (const cand of this.buckets.get(b) || []) {
        if (seen.has(cand.key)) continue;
        seen.add(cand.key);
        if (withinOneEdit(key, cand.key)) hits.push(cand);
      }
    }
    // Ambiguity means we cannot tell which plant was meant; refuse to guess.
    if (hits.length !== 1) return null;
    return { value: hits[0].value, exact: false };
  }
}

module.exports = { NearIndex, withinOneEdit };
