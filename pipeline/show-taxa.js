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

let shown = 0;
for (const e of entries) {
  const doubtful = e.taxa.some((t) => !isKnown(taxonKey(nameOf(t))));
  if (!showAll && !doubtful) continue;
  shown++;
  console.log(`  ${e.headword.padEnd(22)} ${e.taxa.join(' | ')}`);
}
console.log(`\n${shown} line(s)${showAll ? '' : ' with a taxon absent from Part II'}`);
