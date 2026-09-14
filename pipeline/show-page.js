#!/usr/bin/env node
'use strict';
/**
 * Print what the pipeline currently believes is on a page, next to the OCR's
 * confidence in each headword. Used while transcribing from the page images:
 * read the image, compare against this, and write only what differs.
 *
 *   node pipeline/show-page.js 76
 *   node pipeline/show-page.js 76 --all     # include confident entries too
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const page = Number(process.argv[2]);
const showAll = process.argv.includes('--all');

if (!page) {
  console.error('usage: node pipeline/show-page.js <page> [--all]');
  process.exit(1);
}

const entries = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'part1-vernacular.json'), 'utf8'))
  .filter((e) => e.page === page);

if (!entries.length) {
  console.error(`No Part I entries on page ${page}.`);
  process.exit(1);
}

const img = path.join(ROOT, 'data', 'raw', 'images', `p${page}.jpg`);
console.log(`page ${page}  (printed ${entries[0].printedPage || '?'})  ${entries.length} entries`);
console.log(`image: ${fs.existsSync(img) ? path.relative(ROOT, img) : 'NOT FETCHED'}`);
console.log('');

let shown = 0;
for (const e of entries) {
  const c = e.confidence;
  const doubtful = c === null || c === undefined || c < 70;
  if (!showAll && !doubtful) continue;
  shown++;
  const mark = e.corrected ? 'FIXED' : c === null || c === undefined ? '  ?  ' : String(c).padStart(5);
  console.log(`${mark}  ${e.headword.padEnd(24)} ${(e.dialects.join('/') || '-').padEnd(8)} ${e.taxa.join(' | ')}`);
}
console.log(`\n${shown} shown${showAll ? '' : ' (doubtful only; pass --all for every entry)'}`);
