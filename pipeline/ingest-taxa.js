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
 * A headword repeated on one page is matched in printed order, so listing it
 * twice corrects the first and second occurrence respectively.
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

// Consume repeated headwords in printed order.
const cursor = new Map();
const corrections = [];
const unmatched = [];
let same = 0;

for (const w of wanted) {
  const key = fold(w.head);
  const candidates = entries.filter((e) => fold(e.headword) === key);
  const n = cursor.get(key) || 0;
  cursor.set(key, n + 1);

  const e = candidates[n];
  if (!e) { unmatched.push(w); continue; }

  // A taxon of "-" marks a line that is not an entry at all: a scanning
  // artefact the parser mistook for one, like the "daeal Doe" at the head of
  // page 19. Those are dropped rather than corrected.
  if (w.taxon === '-') {
    corrections.push({
      page,
      was: e.ocrHeadword || e.headword,
      occurrence: n,
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
    occurrence: n,
    taxa,
    wasTaxa: e.taxa,
  });
}

console.log(`page ${page}: ${wanted.length} line(s) given, ${entries.length} entries on the page`);
console.log(`  matched ${wanted.length - unmatched.length}, unchanged ${same}, corrections ${corrections.length}`);
if (unmatched.length) {
  console.log(`  ${unmatched.length} headword(s) not found on this page:`);
  unmatched.forEach((w) => console.log(`      ${w.head}`));
}

if (unmatched.length && unmatched.length === wanted.length) {
  console.error('\nREFUSED: nothing matched. Check the page number and the headword spellings.');
  process.exit(2);
}

const dir = path.join(ROOT, 'data', 'corrections', 'taxa');
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `p${String(page).padStart(3, '0')}.json`);
fs.writeFileSync(file, JSON.stringify({
  page,
  transcription: lines,
  source: `https://archive.org/download/dictionaryofplan00merr/page/n${page - 1}.jpg`,
  entries: corrections,
}, null, 1) + '\n');
console.log(`  -> ${path.relative(ROOT, file)}`);
