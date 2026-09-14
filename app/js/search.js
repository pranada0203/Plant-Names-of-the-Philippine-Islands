/**
 * Search over the dictionary payload.
 *
 * Two things make this not-quite-ordinary substring search:
 *
 * 1. Wildcards in the data, not the query. Where the scan produced a glyph that
 *    could not be decoded, the key holds , which matches any one
 *    character. A user typing "lopo" should still find a name the scanner only
 *    half read.
 *
 * 2. Tolerance for the scan's mistakes. An exact hit ranks first, a prefix hit
 *    next, then substring, then a single-letter difference -- because the
 *    headword the reader wants may simply be misspelled in the source.
 */

const WILDCARD = '';

/** Fold a query the same way the build folded the keys. */
const OCR_DIGITS = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 6: 'o', 8: 'b', 9: 'g' };

export function fold(s) {
  return String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[0-9]/g, (d) => OCR_DIGITS[d] || '')
    .replace(/[^a-z]+/g, '');
}

/** Does `key` contain `q`, letting key's wildcards stand for any character? */
function indexOfWild(key, q, from = 0) {
  const limit = key.length - q.length;
  outer: for (let i = from; i <= limit; i++) {
    for (let j = 0; j < q.length; j++) {
      const c = key[i + j];
      if (c !== q[j] && c !== WILDCARD) continue outer;
    }
    return i;
  }
  return -1;
}

/** True if key and q differ by at most one edit (wildcards count as equal). */
function withinOneEdit(key, q) {
  const lk = key.length;
  const lq = q.length;
  if (Math.abs(lk - lq) > 1) return false;

  if (lk === lq) {
    let diffs = 0;
    for (let i = 0; i < lk; i++) {
      if (key[i] !== q[i] && key[i] !== WILDCARD && ++diffs > 1) return false;
    }
    return true;
  }
  const [short, long] = lk < lq ? [key, q] : [q, key];
  let i = 0;
  let j = 0;
  let skipped = false;
  while (i < short.length && j < long.length) {
    if (short[i] === long[j] || short[i] === WILDCARD || long[j] === WILDCARD) { i++; j++; continue; }
    if (skipped) return false;
    skipped = true;
    j++;
  }
  return true;
}

const RANK = { exact: 0, prefix: 1, word: 2, contains: 3, near: 4, taxon: 5, note: 6 };

export class Search {
  constructor(data) {
    this.data = data;
    // Precompute every folded key once; search then touches only strings.
    this.nameKeys = data.names.map((n) => n.key || fold(n.name));
    this.taxonKeys = data.taxa.map((t) => fold(t.name));
    this.taxonWords = data.taxa.map((t) => (t.name || '').toLowerCase());
  }

  /**
   * @returns {{kind:'name'|'taxon', id:number, rank:number}[]}
   */
  query(raw, { limit = 200, dialect = null, family = null, letter = null } = {}) {
    const q = fold(raw);
    const out = [];

    if (q) {
      for (let i = 0; i < this.nameKeys.length; i++) {
        const key = this.nameKeys[i];
        let rank = -1;
        if (key.length === q.length && indexOfWild(key, q) === 0) rank = RANK.exact;
        else if (indexOfWild(key, q) === 0) rank = RANK.prefix;
        else if (indexOfWild(key, q) > 0) rank = RANK.contains;
        else if (q.length >= 4 && withinOneEdit(key, q)) rank = RANK.near;
        if (rank >= 0) out.push({ kind: 'name', id: i, rank });
      }
      for (let i = 0; i < this.taxonKeys.length; i++) {
        const key = this.taxonKeys[i];
        let rank = -1;
        if (key.startsWith(q)) rank = key.length === q.length ? RANK.exact : RANK.prefix;
        else if (key.includes(q)) rank = RANK.taxon;
        if (rank >= 0) out.push({ kind: 'taxon', id: i, rank });
      }
    } else {
      // No query: the filters alone define the result set.
      for (let i = 0; i < this.data.names.length; i++) out.push({ kind: 'name', id: i, rank: RANK.contains });
    }

    const filtered = out.filter((r) => this.passes(r, { dialect, family, letter }));
    filtered.sort((a, b) => a.rank - b.rank || this.label(a).localeCompare(this.label(b), 'en'));
    return { total: filtered.length, results: filtered.slice(0, limit) };
  }

  passes(r, { dialect, family, letter }) {
    if (r.kind === 'name') {
      const n = this.data.names[r.id];
      if (dialect && !n.dialects.includes(dialect)) return false;
      if (letter && !n.name.startsWith(letter)) return false;
      if (family && !n.taxa.some((t) => this.data.taxa[t.id].family === family)) return false;
      return true;
    }
    const t = this.data.taxa[r.id];
    if (family && t.family !== family) return false;
    if (letter && !t.name.toUpperCase().startsWith(letter)) return false;
    if (dialect) {
      const names = t.names.map((i) => this.data.names[i]);
      if (!names.some((n) => n.dialects.includes(dialect))) return false;
    }
    return true;
  }

  label(r) {
    return r.kind === 'name' ? this.data.names[r.id].name : this.data.taxa[r.id].name;
  }
}
