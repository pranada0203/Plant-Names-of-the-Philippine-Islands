#!/usr/bin/env node
'use strict';
/**
 * Turn a transcription of Part I *scientific names* into a correction file.
 *
 * The first pass corrected Part I headwords, the second Part II headings. But
 * Part I also prints a scientific name on every line -- "ABACA, T., V. Musa
 * textilis Nee." -- and those were left as the scanner read them. Where one is
 * garbled it fails to match its Part II counterpart and survives as a duplicate
 * stub taxon, so the same plant appears twice under two spellings.
 *
 * Unlike the other two passes this one does not need the whole page: the lines
 * in doubt are exactly those `pipeline/show-taxa.js` lists, so the input is
 * keyed by headword rather than aligned by position.
 *
 *   node pipeline/ingest-taxa.js 24 <<'EOF'
 *   ANAHAO | Licuala spectabilis Miq.
 *   AMBOLONG | Metroxylon
 *   EOF
 *
 * Where a page repeats a headword -- page 21 carries AJOS-AJOS NGA MAPOTI three
 * times for three different plants -- the line must say which one it means:
 *
 *   ALAM#2 | Toona
 *
 * show-taxa.js prints that suffix wherever it is needed, and this script
 * refuses the whole page rather than guess, because guessing rewrites a
 * neighbouring entry's scientific name and nothing downstream would notice.
 *
 * Writes to data/corrections/taxa/pNNN.json.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const page = Number(process.argv[2]);
if (!page) {
  console.error('usage: node pipeline/ingest-taxa.js <page> < transcript.txt');
  process.exit(1);
}

const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z]/g, '');

const lines = fs.readFileSync(0, 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));

const wanted = lines.map((l) => {
  const bar = l.indexOf('|');
  if (bar < 0) return { bad: l };
  return { head: l.slice(0, bar).trim(), taxon: l.slice(bar + 1).trim() };
});

const malformed = wanted.filter((w) => w.bad);
if (malformed.length) {
  console.error('Lines without a "|" separator:');
  malformed.forEach((w) => console.error('   ' + w.bad));
  process.exit(2);
}

const all = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'part1-vernacular.json'), 'utf8'));
const entries = all.filter((e) => e.page === page);
if (!entries.length) {
  console.error(`No Part I entries on page ${page}.`);
  process.exit(1);
}

const corrections = [];
const unmatched = [];
const ambiguous = [];
const cursor = new Map();
let same = 0;

for (const w of wanted) {
  // "ALAM#2" names the second ALAM on the page. show-taxa prints the suffix
  // wherever a headword repeats.
  const hash = w.head.lastIndexOf('#');
  const explicit = hash > 0 ? Number(w.head.slice(hash + 1)) : null;
  const headText = hash > 0 ? w.head.slice(0, hash) : w.head;

  const key = fold(headText);
  const candidates = entries.filter((e) => fold(e.headword) === key);
  if (!candidates.length) { unmatched.push(w); continue; }

  // Refuse to guess. A repeated headword without an index used to consume the
  // first occurrence, which silently rewrote a neighbouring entry's taxon --
  // on page 21 it would have given AJOS-AJOS NGA MAPOTI (Hymenocallis) the
  // scientific name belonging to the next line.
  if (candidates.length > 1 && explicit === null) {
    ambiguous.push({ head: headText, options: candidates.map((e) => e.taxa.join(' | ')) });
    continue;
  }

  const n = explicit !== null ? explicit - 1 : (cursor.get(key) || 0);
  cursor.set(key, n + 1);

  const e = candidates[n];
  if (!e) { unmatched.push(w); continue; }

  // The correction is keyed by the scanner's reading of the headword, so its
  // occurrence index must be counted the same way. Counting among *corrected*
  // headwords disagrees whenever a headword correction split one OCR reading
  // into two: page 22 reads "ALING" for both ALING and ALING HOTUNGAS, and
  // indexing by the corrected name gave them both occurrence 0, so one
  // correction silently went stale.
  const ocrHead = e.ocrHeadword || e.headword;
  const occurrence = entries
    .filter((x) => (x.ocrHeadword || x.headword) === ocrHead)
    .indexOf(e);

  // A taxon of "-" marks a line that is not an entry at all: a scanning
  // artefact the parser mistook for one, like the "daeal Doe" at the head of
  // page 19. Those are dropped rather than corrected.
  if (w.taxon === '-') {
    corrections.push({
      page,
      was: e.ocrHeadword || e.headword,
      occurrence,
      drop: true,
      wasTaxa: e.taxa,
    });
    continue;
  }

  // "Vitex negundo L.--Vitex obovata Thunb." lists two species for one name;
  // the transcription may carry both, separated the same way.
  const taxa = w.taxon.split(/\s*--\s*/).map((s) => s.replace(/\s*\.\s*$/, '').trim()).filter(Boolean);
  if (JSON.stringify(taxa) === JSON.stringify(e.taxa)) { same++; continue; }

  corrections.push({
    page,
    // Key on the scanner's own reading of the headword, exactly as the
    // headword corrections do, so the two stay in step and re-keying works.
    was: e.ocrHeadword || e.headword,
    occurrence,
    taxa,
    wasTaxa: e.taxa,
  });
}

// A drop correction erases its own target: once "daeal Doe" is dropped from
// page 19 it is no longer in the parse, so re-ingesting that page cannot match
// the line and would quietly write the drop away, resurrecting the artefact.
// Carry forward any drop in the existing file whose headword the transcription
// still names.
const dir = path.join(ROOT, 'data', 'corrections', 'taxa');
const file = path.join(dir, `p${String(page).padStart(3, '0')}.json`);
let carried = 0;
if (fs.existsSync(file)) {
  const prev = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const c of prev.entries || []) {
    if (!c.drop) continue;
    const stillNamed = unmatched.some((w) => fold(w.head.replace(/#\d+$/, '')) === fold(c.was));
    const alreadyHave = corrections.some(
      (x) => x.was === c.was && (x.occurrence || 0) === (c.occurrence || 0)
    );
    if (stillNamed && !alreadyHave) { corrections.push(c); carried++; }
  }
}

console.log(`page ${page}: ${wanted.length} line(s) given, ${entries.length} entries on the page`);
console.log(`  matched ${wanted.length - unmatched.length}, unchanged ${same}, corrections ${corrections.length}`);
if (carried) console.log(`  ${carried} drop(s) carried forward from the existing file`);
if (unmatched.length) {
  console.log(`  ${unmatched.length} headword(s) not found on this page:`);
  unmatched.forEach((w) => console.log(`      ${w.head}`));
}
if (ambiguous.length) {
  console.error(`
  ${ambiguous.length} headword(s) occur more than once and need an index:`);
  for (const a of ambiguous) {
    a.options.forEach((o, i) => console.error(`      ${a.head}#${i + 1}  ${o}`));
  }
}

if (ambiguous.length) {
  console.error('\nREFUSED: index each ambiguous headword and rerun. Nothing written.');
  process.exit(2);
}
if (unmatched.length && unmatched.length === wanted.length) {
  console.error('\nREFUSED: nothing matched. Check the page number and the headword spellings.');
  process.exit(2);
}

fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(file, JSON.stringify({
  page,
  transcription: lines,
  source: `https://archive.org/download/dictionaryofplan00merr/page/n${page - 1}.jpg`,
  entries: corrections,
}, null, 1) + '\n');
console.log(`  -> ${path.relative(ROOT, file)}`);
