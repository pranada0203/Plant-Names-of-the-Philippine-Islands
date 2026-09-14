#!/usr/bin/env node
'use strict';
/**
 * Check that every scan box really sits on its own line.
 *
 * The app crops the scanned leaf to an entry's box and shows it as proof of
 * what the book says. A box on the wrong line is therefore worse than no box
 * at all: the reader is shown a line that does not say what the entry says,
 * and has nothing to tell them which of the two is wrong. That failure is also
 * silent -- the crop looks perfectly convincing.
 *
 * So it is checked rather than trusted. This re-derives the hOCR lines from
 * scratch, finds which of them fall inside each stored box, and confirms that
 * at least one of those lines is the line the entry was read from. Two real
 * defects were found this way and would have shipped without it: hOCR line
 * order is not reading order, and a symmetric similarity is the wrong question
 * for a multi-line block.
 *
 *   npm run verify-boxes
 *
 * Exits non-zero if any box fails.
 */
const fs = require('fs');
const path = require('path');
const HOCR = require('./lib/hocr');
const ALIGN = require('./lib/align');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');

/** Below this, the line inside the box is not the entry's line. */
const FLOOR = 0.5;

function main() {
  const hocrFile = path.join(DATA, 'raw', 'ia', 'hocr.html');
  if (!fs.existsSync(hocrFile)) {
    console.log('No hOCR fetched - run `npm run fetch-ia`. Nothing to verify.');
    return;
  }
  const pages = JSON.parse(fs.readFileSync(path.join(DATA, 'raw', 'pages.json'), 'utf8'));
  const hocr = HOCR.parseHocr(fs.readFileSync(hocrFile, 'utf8'));
  const { map } = HOCR.alignPages(hocr, pages);

  let boxes = 0;
  let missing = 0;
  const failures = [];

  for (const file of ['part1-vernacular.json', 'part2-scientific.json']) {
    const entries = JSON.parse(fs.readFileSync(path.join(DATA, file), 'utf8'));
    for (const e of entries) {
      if (!e.box) { missing++; continue; }
      const page = hocr[map[e.page - 1]];
      if (!page) continue;
      boxes++;

      const [x, y, w, h] = e.box;
      const inside = page.lines.filter((l) => {
        const cy = (l.box[1] + l.box[3]) / 2 / page.box[3];
        const cx = (l.box[0] + l.box[2]) / 2 / page.box[2];
        return cy >= y && cy <= y + h && cx >= x - 0.02 && cx <= x + w + 0.02;
      });
      const best = inside.length
        ? Math.max(...inside.map((l) => ALIGN.prefixSimilarity(e.raw, l.text)))
        : 0;
      if (best < FLOOR) {
        failures.push({ page: e.page, raw: e.raw.slice(0, 50), best,
          inside: inside.map((l) => l.text.slice(0, 50)) });
      }
    }
  }

  console.log(`${boxes} boxes checked, ${missing} entries unlocated`);
  if (!failures.length) {
    console.log('Every box sits on the line its entry was read from.');
    return;
  }
  console.log(`${failures.length} box(es) do not:`);
  for (const f of failures.slice(0, 20)) {
    console.log(`  p.${f.page} ${JSON.stringify(f.raw)}`);
    console.log(`      best ${f.best.toFixed(2)} against ${JSON.stringify(f.inside.join(' / '))}`);
  }
  process.exitCode = 1;
}

main();
