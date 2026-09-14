#!/usr/bin/env node
'use strict';
/**
 * Turn a Part II page transcription into a correction file.
 *
 * The Part I counterpart of this script transcribes native headwords; this one
 * transcribes the scientific names that head each Part II entry. Same method:
 * the transcription is written straight, in printed order, and the script does
 * the comparison against the parse rather than asking the reader to diff by eye.
 *
 *   node pipeline/ingest-part2.js 128 < transcript.txt
 *
 * One line per entry. The name as printed, including the book's abbreviated
 * genus ("A. aspera"); the parser expands those afterwards. An optional family
 * may follow after a pipe, for the handful the family matcher cannot resolve:
 *
 *   Achras sapota | Sapotaceae
 *   Achyranthes aquatica
 *   A. aspera
 *
 * Writes only what differs, to data/corrections/part2/pNNN.json.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const page = Number(process.argv[2]);
if (!page) {
  console.error('usage: node pipeline/ingest-part2.js <page> < transcript.txt');
  process.exit(1);
}

/** Compare names ignoring case, accents and punctuation. */
const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z]/g, '');

/** Order-sensitive shared-character ratio, for alignment. */
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

/** The name as it stands before correction and before genus expansion. */
const printedName = (e) => e.ocrName || e.abbreviated || e.name;

const lines = fs.readFileSync(0, 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));

// "Name | Family" -> { name, family }
const parsed = lines.map((l) => {
  const [name, family] = l.split('|').map((s) => s.trim());
  return { name, family: family || null };
});

const all = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'part2-scientific.json'), 'utf8'));
const entries = all.filter((e) => e.page === page);
if (!entries.length) {
  console.error(`No Part II entries on page ${page}.`);
  process.exit(1);
}

// Needleman-Wunsch, so an entry the parser missed shifts nothing downstream.
const GAP = -0.4;
const n = entries.length;
const m = parsed.length;
const dp = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
const bt = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1));
for (let i = 1; i <= n; i++) { dp[i][0] = dp[i - 1][0] + GAP; bt[i][0] = 1; }
for (let j = 1; j <= m; j++) { dp[0][j] = dp[0][j - 1] + GAP; bt[0][j] = 2; }
for (let i = 1; i <= n; i++) {
  for (let j = 1; j <= m; j++) {
    // Compare against the name as the scanner read it: before any correction
    // (ocrName) and before the genus expansion that turns "A. fastuosa" into
    // "ABROMA FASTUOSA" (abbreviated). Comparing against the expanded form
    // would manufacture a "correction" that un-expands every abbreviated entry.
    const printed = printedName(entries[i - 1]);
    const diag = dp[i - 1][j - 1] + score(printed, parsed[j - 1].name);
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
  if (b === 0) { pairs.push([entries[i - 1], parsed[j - 1]]); i--; j--; }
  else if (b === 1) { pairs.push([entries[i - 1], null]); i--; }
  else { pairs.push([null, parsed[j - 1]]); j--; }
}
pairs.reverse();

const matched = pairs.filter(([e, l]) => e && l);
const unmatchedEntries = pairs.filter(([e, l]) => e && !l);
const unmatchedLines = pairs.filter(([e, l]) => !e && l);

const corrections = [];
let same = 0;
for (const [e, line] of matched) {
  // Key on what the scanner read, never on what a previous correction produced.
  const wasRead = printedName(e);
  const needsName = line.name.toUpperCase() !== wasRead.toUpperCase();
  // Compare against the family as the matcher read it from the scan, not
  // against a family a previous run of this script already installed.
  const familyAsRead = e.ocrFamily !== undefined ? e.ocrFamily : e.family;
  const needsFamily = line.family && line.family !== familyAsRead;
  if (!needsName && !needsFamily) { same++; continue; }

  corrections.push({
    page,
    was: wasRead,
    name: line.name,
    ...(line.family ? { family: line.family } : {}),
    ...(e.confidence !== null && e.confidence !== undefined && !e.corrected
      ? { ocrConfidence: e.confidence } : {}),
  });
}

console.log(`page ${page}: ${entries.length} parsed entries, ${parsed.length} transcribed lines`);
console.log(`  aligned ${matched.length}, unchanged ${same}, corrections ${corrections.length}`);

// A confident OCR reading overridden by a very different transcription is more
// often a slip in the transcription than in the scan. Worth a second look.
const suspicious = corrections.filter((c) =>
  c.ocrConfidence >= 85 && score(c.was, c.name) < 0.85);
if (suspicious.length) {
  console.log(`  ${suspicious.length} correction(s) override a confident OCR reading -- check these:`);
  for (const c of suspicious) {
    console.log(`      "${c.was}" (conf ${c.ocrConfidence})  ->  "${c.name}"`);
  }
}
if (unmatchedEntries.length) {
  console.log(`  ${unmatchedEntries.length} parsed entries with no transcribed line:`);
  unmatchedEntries.slice(0, 8).forEach(([e]) => console.log(`      ${e.name}`));
}
if (unmatchedLines.length) {
  console.log(`  ${unmatchedLines.length} transcribed lines with no parsed entry:`);
  unmatchedLines.slice(0, 8).forEach(([, l]) => console.log(`      ${l.name}`));
}

const alignRatio = matched.length / Math.max(entries.length, parsed.length);
if (alignRatio < 0.6) {
  console.error(`\nREFUSED: only ${(alignRatio * 100).toFixed(0)}% of lines aligned. ` +
    'Check that the transcription covers the whole page, in printed order.');
  process.exit(2);
}

const dir = path.join(ROOT, 'data', 'corrections', 'part2');
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `p${String(page).padStart(3, '0')}.json`);
fs.writeFileSync(file, JSON.stringify({
  page,
  // The full transcription is kept, not just the diff, so the corrections can
  // be re-derived if the parser changes what it reads for a line.
  transcription: lines,
  source: `https://archive.org/download/dictionaryofplan00merr/page/n${page - 1}.jpg`,
  transcribed: parsed.length,
  entries: corrections,
}, null, 1) + '\n');
console.log(`  -> ${path.relative(ROOT, file)}`);
