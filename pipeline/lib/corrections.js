'use strict';
/**
 * Hand-verified corrections, applied on top of the parse.
 *
 * The OCR misreads a large share of both halves of the book, and no amount of
 * cleverness downstream recovers a word the scanner never saw: "fprz" cannot be
 * turned into "ÍPIL" by rule, nor "Prerocarpus rnpicus" into "Pterocarpus
 * indicus". They have to be read off the page image by eye.
 *
 * Those readings live in `data/corrections/part1/` (native headwords) and
 * `data/corrections/part2/` (scientific names), which are committed, and are
 * applied here rather than edited into the generated files -- `npm run build`
 * regenerates those, and would erase them.
 *
 * A correction is keyed by the page and the OCR's own reading, both of which are
 * stable for a given source PDF. If the key stops matching -- because the parser
 * changed what it reads for a line, say -- the correction is reported as stale
 * rather than silently dropped, so the list can be re-derived instead of quietly
 * rotting. `pipeline/rekey-corrections.js` does that re-derivation.
 */

/** Key a correction to the exact thing it corrects. */
const keyOf = (page, was) => `${page} ${String(was).toUpperCase()}`;

/**
 * Load every correction file in `dir`, one per page (`p076.json`).
 * Per-page files rather than one big list: the transcription is done a page at
 * a time, and a page's work should land on disk without rewriting -- or risking
 * clobbering -- everything read so far.
 */
function load(fs, path, dir) {
  if (!fs.existsSync(dir)) return null;
  const byKey = new Map();
  let files = 0;
  let count = 0;

  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue;
    const doc = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    files++;
    for (const c of doc.entries || []) {
      // A page can carry the same OCR reading more than once -- page 76 has
      // INATA four times, page 21 has ALAGAO twice meaning two different names.
      // Keep a queue per key and consume it in document order, or the last
      // correction would overwrite the others and be applied to all of them.
      const k = keyOf(c.page, c.was);
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(c);
      count++;
    }
  }
  return { byKey, files, count, applied: new Set() };
}

/**
 * Walk entries in document order, consuming each key's queue as it goes.
 * `read` returns the OCR's reading of an entry; `write` installs the correction.
 */
function applyWith(corrections, entries, read, write) {
  if (!corrections) return { applied: 0, stale: [] };

  let applied = 0;
  const cursor = new Map();          // key -> how many of its queue are used

  for (const e of entries) {
    const key = keyOf(e.page, read(e));
    const queue = corrections.byKey.get(key);
    if (!queue) continue;

    const n = cursor.get(key) || 0;
    if (n >= queue.length) continue;  // more occurrences than corrections
    const c = queue[n];
    cursor.set(key, n + 1);

    corrections.applied.add(key + '#' + n);
    applied++;
    write(e, c);
  }

  const stale = [];
  for (const [key, queue] of corrections.byKey) {
    queue.forEach((c, i) => {
      if (!corrections.applied.has(key + '#' + i)) stale.push(c);
    });
  }
  return { applied, stale };
}

/** Part I: correct the native headword. */
function applyPartI(corrections, entries) {
  return applyWith(
    corrections,
    entries,
    (e) => e.ocrHeadword || e.headword,
    (e, c) => {
      e.ocrHeadword = e.headword;        // keep what the scan said, for the UI
      e.headword = c.headword.toUpperCase();
      e.headRaw = c.headword;
      e.corrected = true;
      // A hand-read headword is no longer subject to the scan's doubts about it.
      e.confidence = 100;
      e.flags = e.flags.filter((f) => f !== 'accent-lost' && f !== 'glyph-damage');
      if (c.dialects) e.dialects = c.dialects;
      if (c.taxa) e.taxa = c.taxa;
    }
  );
}

/**
 * Part I taxon strings: correct the scientific name printed on a native-name
 * line. Keyed by page plus the scanner's reading of the *headword*, with an
 * occurrence index for a headword the page repeats, so it stays in step with
 * the headword corrections rather than depending on the taxon itself -- which
 * is the very thing being replaced.
 *
 * Must run after applyPartI, which is what sets `ocrHeadword`.
 */
function applyPartITaxa(corrections, entries) {
  if (!corrections) return { applied: 0, stale: [] };

  const seen = new Map();          // key -> occurrences walked so far
  let applied = 0;

  for (const e of entries) {
    const key = keyOf(e.page, e.ocrHeadword || e.headword);
    const n = seen.get(key) || 0;
    seen.set(key, n + 1);

    const queue = corrections.byKey.get(key);
    if (!queue) continue;
    const c = queue.find((x) => (x.occurrence || 0) === n);
    if (!c) continue;

    corrections.applied.add(key + '#' + queue.indexOf(c));
    applied++;
    if (c.drop) { e.drop = true; continue; }
    e.ocrTaxa = e.taxa;
    e.taxa = c.taxa;
    e.taxaCorrected = true;
    e.flags = e.flags.filter((f) => f !== 'taxon-suspect');
  }

  const stale = [];
  for (const [key, queue] of corrections.byKey) {
    queue.forEach((c, i) => {
      if (!corrections.applied.has(key + '#' + i)) stale.push(c);
    });
  }
  return { applied, stale };
}

/** Part II: correct the scientific name, and the family where one was read. */
function applyPartII(corrections, entries) {
  return applyWith(
    corrections,
    entries,
    (e) => e.ocrName || e.name,
    (e, c) => {
      e.ocrName = e.name;
      e.name = c.name;
      e.corrected = true;
      e.confidence = 100;
      if (c.authority) e.authority = c.authority;
      if (c.family) {
        // Keep what the matcher made of the scan, for the same reason ocrName
        // is kept: re-deriving this correction must compare against the
        // original reading, or it would compare against its own output and
        // drop itself as "unchanged".
        e.ocrFamily = e.family;
        e.family = c.family;
        e.familySource = 'transcribed';
        e.unresolvedFamily = null;
      }
    }
  );
}

module.exports = { load, applyPartI, applyPartITaxa, applyPartII, keyOf };
