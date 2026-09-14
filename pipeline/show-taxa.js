#!/usr/bin/env node
'use strict';
/**
 * List the Part I lines on a page whose scientific name is still in doubt --
 * that is, whose taxon never appears in Part II and so exists only as a stub.
 *
 * Those are the lines the third transcription pass has to check against the
 * page image. Everything else on the page already agrees with the scientific
 * index and needs no attention.
 *
 *   node pipeline/show-taxa.js 24
 *   node pipeline/show-taxa.js 24 --all    # every line on the page
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const page = Number(process.argv[2]);
const showAll = process.argv.includes('--all');

if (!page) {
  console.error('usage: node pipeline/show-taxa.js <page> [--all]');
  process.exit(1);
}

const part1 = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'part1-vernacular.json'), 'utf8'));
const part2 = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'part2-scientific.json'), 'utf8'));

/** Same match key stage 3 uses: genus + epithet, case and accent folded. */
function taxonKey(name) {
  const words = String(name)
    .replace(/\b(?:var|subsp|sp|spp|f)\.?\b.*$/i, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return words.length ? words.slice(0, 2).join(' ').toLowerCase() : null;
}

// Match the way stage 3 matches -- exact key first, then one edit of tolerance
// -- or this would flag lines the build already merges and send the
// transcription after work that is already done.
const { NearIndex } = require('./lib/fuzzy');
const known = new NearIndex();
for (const e of part2) {
  const k = taxonKey(e.name);
  if (k) known.add(k.replace(/\s+/g, ''), e.name);
}
const isKnown = (k) => Boolean(k && known.find(k.replace(/\s+/g, '')));

/** Strip the trailing authority the way stage 3 does. */
function nameOf(taxonString) {
  const tokens = taxonString.replace(/\s*\.\s*$/, '').split(/\s+/).filter(Boolean);
  if (!tokens.length) return '';
  const hasEpithet = tokens.length > 1 && /^[a-zé]/.test(tokens[1]);
  return tokens.slice(0, hasEpithet ? 2 : 1).join(' ');
}

const entries = part1.filter((e) => e.page === page);
if (!entries.length) {
  console.error(`No Part I entries on page ${page}.`);
  process.exit(1);
}

console.log(`page ${page}  (printed ${entries[0].printedPage || '?'})  ${entries.length} entries`);
console.log(`image: data/raw/images/p${page}.jpg\n`);

// Lines already checked against the image are done, whether or not they needed
// correcting -- many do not, because the stub is Merrill's own spelling or a
// plant Part II simply omits. Without this they would be re-offered for ever
// and there would be no way to tell how much of the pass remains.
const checked = new Set();
const taxaFile = path.join(ROOT, 'data', 'corrections', 'taxa', `p${String(page).padStart(3, '0')}.json`);
if (fs.existsSync(taxaFile)) {
  for (const line of JSON.parse(fs.readFileSync(taxaFile, 'utf8')).transcription || []) {
    const head = line.slice(0, line.indexOf('|')).trim();
    checked.add(head.replace(/#\d+$/, '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, ''));
  }
}

// A page often repeats a headword for different plants -- page 21 carries
// AJOS-AJOS NGA MAPOTI three times. Number those, so the transcription can say
// which one it means and cannot silently correct its neighbour.
const counts = new Map();
for (const e of entries) counts.set(e.headword, (counts.get(e.headword) || 0) + 1);
const seen = new Map();

let shown = 0;
for (const e of entries) {
  const n = seen.get(e.headword) || 0;
  seen.set(e.headword, n + 1);

  const fkey = e.headword.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
  const doubtful = e.taxa.some((t) => !isKnown(taxonKey(nameOf(t))));
  if (!showAll && (!doubtful || checked.has(fkey))) continue;
  shown++;
  const label = counts.get(e.headword) > 1 ? `${e.headword}#${n + 1}` : e.headword;
  console.log(`  ${label.padEnd(24)} ${e.taxa.join(' | ')}`);
}
console.log(`\n${shown} line(s)${showAll ? '' : ' with a taxon absent from Part II'}`);
