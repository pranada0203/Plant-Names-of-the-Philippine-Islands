/**
 * Search over the dictionary payload.
 *
 * Four things make this not-quite-ordinary substring search:
 *
 * 1. Wildcards in the data, not the query. Where the scan produced a glyph that
 *    could not be decoded, the key holds U+0001, which matches any one
 *    character. A user typing "lopo" should still find a name the scanner only
 *    half read.
 *
 * 2. Tolerance for the scan's mistakes. An exact hit ranks first, a prefix hit
 *    next, then substring, then a single-letter difference -- because the
 *    headword the reader wants may simply be misspelled in the source.
 *
 * 3. Merrill's own spelling variation, below.
 *
 * 4. Merrill's descriptive notes, searched last, so that "gutta-percha" or
 *    "valuable timber" finds the plants he says that about.
 *
 * Every match also reports *where* it matched, so the interface can show the
 * reader which part of the word it thinks they meant.
 */

const WILDCARD = '\u0001';

/** Fold a query the same way the build folded the keys. */
const OCR_DIGITS = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 6: 'o', 8: 'b', 9: 'g' };

/**
 * Fold one character towards a search key. Returns '' for anything that is not
 * a letter. Nothing here is contextual, which is what lets `foldMap` fold a
 * string character by character and still agree with `fold`.
 */
function foldChar(ch) {
  const c = ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (c >= '0' && c <= '9') return OCR_DIGITS[c] || '';
  return c.replace(/[^a-z]+/g, '');
}

export function fold(s) {
  let out = '';
  for (const ch of String(s)) out += foldChar(ch);
  return out;
}

/**
 * Fold, and record where each folded character came from.
 * `map[i]` is the index in `s` of the character that produced `key[i]`, which
 * is what lets a match found in the key be underlined in the original text.
 */
export function foldMap(s) {
  const str = String(s);
  let key = '';
  const map = [];
  for (let i = 0; i < str.length; i++) {
    const folded = foldChar(str[i]);
    for (let k = 0; k < folded.length; k++) map.push(i);
    key += folded;
  }
  return { key, map };
}

/**
 * The letter a name files under in an A-Z index.
 *
 * Accents are stripped, so ABAR and ABAR-with-an-acute file together -- 107
 * headwords begin with an accented letter, and comparing the printed initial
 * directly left every one of them unreachable from the A-Z filter. N-tilde
 * files under N, which is not a simplification but what Merrill does: his own
 * index runs NENENU, NGALUY, NGANGAITA, NIGUI, NILAD.
 */
export const initialOf = (name) =>
  String(name).normalize('NFD').replace(/[̀-ͯ]/g, '').charAt(0).toUpperCase();

/**
 * Merrill's own spelling variation, collapsed.
 *
 * He says so himself, on page 9: "there is a great variation in the spelling of
 * the same word, e and i, o and u, and frequently i and y have the same values
 * and are interchangeable." That makes {e, i, y} one class and {o, u} another,
 * and it is why the book prints ARÓRO and ARÚRU, DÓSOL and DÚSUL, TENÁAN and
 * TINÁAN for the same plants. 191 groups of headwords collapse under it.
 *
 * Nothing more is folded. The Spanish orthography Merrill kept is otherwise
 * consistent -- two headwords in the whole book contain a `k` -- so a c/k rule
 * would earn nothing and cost precision. `ñ` needs no rule either: stripping
 * the tilde already turns his `ñg` into the `ng` a reader would type.
 *
 * The substitution is one character for one, which matters: it keeps the
 * phonetic key the same length as the plain one, so a match found in either
 * lands at the same place in the word being displayed.
 */
export const phonetic = (key) => key.replace(/[iy]/g, 'e').replace(/u/g, 'o');

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

/**
 * Where a query sits in a key, and how good a match that is.
 *
 * The three grades are two apart so that the phonetic pass can slot in between
 * them at +1: a word spelled the other way round beats a word that merely
 * starts with what was typed, but loses to one spelled exactly so.
 */
const EXACT = 0;
const PREFIX = 2;
const CONTAINS = 4;
const NEAR = 7;
const TAXON = 8;
const NOTE = 9;
const NOTE_WORDS = 10;

function matchRank(key, q) {
  const at = indexOfWild(key, q);
  if (at < 0) return null;
  if (at > 0) return { rank: CONTAINS, at };
  return { rank: key.length === q.length ? EXACT : PREFIX, at: 0 };
}

export class Search {
  constructor(data) {
    this.data = data;
    // Precompute every folded key once; search then touches only strings.
    this.nameKeys = data.names.map((n) => n.key || fold(n.name));
    this.taxonKeys = data.taxa.map((t) => fold(t.name));
    this.namePhon = this.nameKeys.map(phonetic);
    this.taxonPhon = this.taxonKeys.map(phonetic);
    // The notes are a megabyte of prose and most sessions never search them,
    // so they are folded on first use rather than at startup.
    this.noteKeys = null;
  }

  foldNotes() {
    if (!this.noteKeys) this.noteKeys = this.data.taxa.map((t) => (t.notes ? fold(t.notes) : ''));
    return this.noteKeys;
  }

  /**
   * `at` and `len` locate the match inside the *folded* key, which `foldMap`
   * turns back into a position in the word as printed. `via` says why a result
   * is here when that is not self-evident: a reader who typed DUNGON and is
   * shown DUNGUN deserves to be told which of the two things happened.
   *
   * @returns {{kind:'name'|'taxon', id:number, rank:number, at:number, len:number,
   *            via?:'phonetic'|'near'|'note'}[]}
   */
  query(raw, { limit = 200, dialect = null, family = null, letter = null,
               minConfidence = null, notes = true } = {}) {
    const q = fold(raw);
    // Below three letters the phonetic classes stop discriminating: a single
    // "i" would pull in every name containing an e or a y, which is most of
    // the book, and inflate the match count for no gain.
    const qp = q.length >= 3 ? phonetic(q) : null;
    const out = [];

    if (q) {
      for (let i = 0; i < this.nameKeys.length; i++) {
        let hit = matchRank(this.nameKeys[i], q);
        if (hit) hit = { ...hit, len: q.length };
        else {
          const ph = qp && matchRank(this.namePhon[i], qp);
          if (ph) hit = { rank: ph.rank + 1, at: ph.at, len: q.length, via: 'phonetic' };
          else if (q.length >= 4 && withinOneEdit(this.nameKeys[i], q)) {
            hit = { rank: NEAR, at: 0, len: this.nameKeys[i].length, via: 'near' };
          }
        }
        if (hit) out.push({ kind: 'name', id: i, ...hit });
      }

      for (let i = 0; i < this.taxonKeys.length; i++) {
        let hit = matchRank(this.taxonKeys[i], q);
        if (hit) hit = { ...hit, len: q.length };
        else {
          const ph = qp && matchRank(this.taxonPhon[i], qp);
          if (ph) hit = { rank: ph.rank + 1, at: ph.at, len: q.length, via: 'phonetic' };
        }
        // A scientific name matched in the middle is a weaker signal than a
        // native name matched in the middle: "indica" is half the index.
        if (hit && hit.rank >= CONTAINS) hit.rank = TAXON;
        if (hit) out.push({ kind: 'taxon', id: i, ...hit });
      }

      // Merrill's notes, last and only for queries long enough to mean
      // something: two letters would match half the book.
      //
      // Prose is matched by words as well as by phrase. Folding "used in
      // medicine" into one string finds nothing, because what Merrill actually
      // writes is "used in the practice of medicine" -- and that is exactly the
      // sort of thing someone searching the descriptions means to find. A
      // phrase still ranks above scattered words.
      if (notes && q.length >= 3) {
        const keys = this.foldNotes();
        const terms = String(raw).split(/\s+/).map(fold).filter(Boolean);
        // The longest word is the one worth showing in the snippet: it is the
        // most specific, and "in" would put the mark somewhere meaningless.
        const lead = terms.reduce((a, b) => (b.length > a.length ? b : a), '');
        const seen = new Set(out.filter((r) => r.kind === 'taxon').map((r) => r.id));

        for (let i = 0; i < keys.length; i++) {
          if (seen.has(i) || !keys[i]) continue;
          const phrase = keys[i].indexOf(q);
          if (phrase >= 0) {
            out.push({ kind: 'taxon', id: i, rank: NOTE, at: phrase, len: q.length, via: 'note' });
          } else if (terms.length > 1 && terms.every((t) => keys[i].includes(t))) {
            out.push({ kind: 'taxon', id: i, rank: NOTE_WORDS,
                       at: keys[i].indexOf(lead), len: lead.length, via: 'note' });
          }
        }
      }
    } else {
      // No query: the filters alone define the result set.
      for (let i = 0; i < this.data.names.length; i++) {
        out.push({ kind: 'name', id: i, rank: CONTAINS, at: -1, len: 0 });
      }
    }

    const filtered = out.filter((r) => this.passes(r, { dialect, family, letter, minConfidence }));
    filtered.sort((a, b) => a.rank - b.rank || this.label(a).localeCompare(this.label(b), 'en'));
    return { total: filtered.length, results: filtered.slice(0, limit) };
  }

  passes(r, { dialect, family, letter, minConfidence }) {
    if (r.kind === 'name') {
      const n = this.data.names[r.id];
      // A headword with no score was never located in the hOCR. Treat unknown
      // as doubtful when the reader asks to see only confident readings --
      // silently passing it would defeat the point of the filter.
      if (minConfidence !== null && !(n.confidence >= minConfidence)) return false;
      if (dialect && !n.dialects.includes(dialect)) return false;
      if (letter && initialOf(n.name) !== letter) return false;
      if (family && !n.taxa.some((t) => this.data.taxa[t.id].family === family)) return false;
      return true;
    }
    const t = this.data.taxa[r.id];
    if (family && t.family !== family) return false;
    if (letter && initialOf(t.name) !== letter) return false;
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
