#!/usr/bin/env node
'use strict';
/**
 * Turn a page transcription into a correction file.
 *
 * Transcribing from the page image and *diffing by eye* against the OCR is two
 * jobs, and the second one invites mistakes. So the transcription is written
 * straight -- every headword on the page, in printed order, one per line -- and
 * this script does the comparison.
 *
 *   node pipeline/ingest-transcription.js 76 < transcript.txt
 *
 * It aligns the transcription to the parsed entries for that page in order,
 * tolerating the occasional line the parser dropped, and writes only the
 * headwords that actually differ to data/corrections/p076.json.
 *
 * Alignment is reported, never assumed: if the two sequences cannot be lined up
 * confidently the script refuses rather than writing corrections against the
 * wrong entries.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const page = Number(process.argv[2]);
if (!page) {
  console.error('usage: node pipeline/ingest-transcription.js <page> < transcript.txt');
  process.exit(1);
}

/** Compare headwords ignoring case, accents and punctuation. */
const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z]/g, '');

/** Cheap similarity for alignment: shared-character ratio, order-sensitive. */
function score(a, b) {
  const A = fold(a);
  const B = fold(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  let i = 0;
  let j = 0;
  let shared = 0;
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) { shared++; i++; j++; }
    else if (A.length - i > B.length - j) i++;
    else j++;
  }
  return (2 * shared) / (A.length + B.length);
}

const lines = fs.readFileSync(0, 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));

const all = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'part1-vernacular.json'), 'utf8'));
const entries = all.filter((e) => e.page === page);
if (!entries.length) {
  console.error(`No Part I entries on page ${page}.`);
  process.exit(1);
}

// Needleman-Wunsch over the two sequences, so a line the parser dropped shifts
// nothing downstream.
const GAP = -0.4;
const n = entries.length;
const m = lines.length;
const dp = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
const bt = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1));
for (let i = 1; i <= n; i++) { dp[i][0] = dp[i - 1][0] + GAP; bt[i][0] = 1; }
for (let j = 1; j <= m; j++) { dp[0][j] = dp[0][j - 1] + GAP; bt[0][j] = 2; }
for (let i = 1; i <= n; i++) {
  for (let j = 1; j <= m; j++) {
    const diag = dp[i - 1][j - 1] + score(entries[i - 1].headword, lines[j - 1]);
    const up = dp[i - 1][j] + GAP;
    const left = dp[i][j - 1] + GAP;
    const best = Math.max(diag, up, left);
    dp[i][j] = best;
    bt[i][j] = best === diag ? 0 : best === up ? 1 : 2;
  }
}

const pairs = [];
let i = n;
let j = m;
while (i > 0 || j > 0) {
  const b = i === 0 ? 2 : j === 0 ? 1 : bt[i][j];
  if (b === 0) { pairs.push([entries[i - 1], lines[j - 1]]); i--; j--; }
  else if (b === 1) { pairs.push([entries[i - 1], null]); i--; }
  else { pairs.push([null, lines[j - 1]]); j--; }
}
pairs.reverse();

const matched = pairs.filter(([e, l]) => e && l);
const unmatchedEntries = pairs.filter(([e, l]) => e && !l);
const unmatchedLines = pairs.filter(([e, l]) => !e && l);

const corrections = [];
let same = 0;
for (const [e, line] of matched) {
  // Key on what the *scanner* read, never on what a previous correction already
  // replaced it with. `part1-vernacular.json` is post-correction, so re-ingesting
  // a page would otherwise key the new corrections to their own output -- and
  // the next clean parse, having nothing keyed to the OCR reading, would silently
  // drop every one of them.
  const wasRead = e.ocrHeadword || e.headword;

  // Accent-only differences still count: the accents are exactly what the scan
  // destroyed, and Merrill went to trouble over them.
  if (line.toUpperCase() === wasRead.toUpperCase()) { same++; continue; }

  corrections.push({
    page,
    was: wasRead,
    headword: line,
    ...(e.confidence !== null && e.confidence !== undefined && !e.corrected
      ? { ocrConfidence: e.confidence } : {}),
  });
}

console.log(`page ${page}: ${entries.length} parsed entries, ${lines.length} transcribed lines`);
console.log(`  aligned ${matched.length}, unchanged ${same}, corrections ${corrections.length}`);

// Where the scanner was confident and the transcription disagrees by more than
// accents, one of the two is a slip -- and on a 90-plus reading it is more
// often the transcription. Worth a second look before trusting it.
const suspicious = corrections.filter((c) =>
  c.ocrConfidence >= 85 && score(c.was, c.headword) < 0.85);
if (suspicious.length) {
  console.log(`  ${suspicious.length} correction(s) override a confident OCR reading -- check these:`);
  for (const c of suspicious) {
    console.log(`      "${c.was}" (conf ${c.ocrConfidence})  ->  "${c.headword}"`);
  }
}
if (unmatchedEntries.length) {
  console.log(`  ${unmatchedEntries.length} parsed entries with no transcribed line:`);
  unmatchedEntries.slice(0, 8).forEach(([e]) => console.log(`      ${e.headword}`));
}
if (unmatchedLines.length) {
  console.log(`  ${unmatchedLines.length} transcribed lines with no parsed entry:`);
  unmatchedLines.slice(0, 8).forEach(([, l]) => console.log(`      ${l}`));
}

// Refuse to write against an alignment that clearly went wrong.
const alignRatio = matched.length / Math.max(entries.length, lines.length);
if (alignRatio < 0.6) {
  console.error(`\nREFUSED: only ${(alignRatio * 100).toFixed(0)}% of lines aligned. ` +
    'Check that the transcription covers the whole page, in printed order.');
  process.exit(2);
}

const dir = path.join(ROOT, 'data', 'corrections');
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `p${String(page).padStart(3, '0')}.json`);
fs.writeFileSync(file, JSON.stringify({
  page,
  // The full transcription is kept, not just the diff, so the corrections can
  // be re-derived if the parser changes what it reads for a line.
  transcription: lines,
  source: `https://archive.org/download/dictionaryofplan00merr/page/n${page - 1}.jpg`,
  transcribed: lines.length,
  entries: corrections,
}, null, 1) + '\n');
console.log(`  -> ${path.relative(ROOT, file)}`);
