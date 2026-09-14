#!/usr/bin/env node
'use strict';
/**
 * Stage 4 - how much can we actually trust this text?
 *
 * The pipeline's own flags only catch damage it can see (odd characters, lost
 * accents). They miss the worst kind: a headword the scanner read as a
 * plausible but wrong word -- "IPIL", one of the best known Philippine timbers,
 * is in the text layer as "fprz".
 *
 * This script estimates the true damage rate using a signal the flags cannot
 * fake: the book prints most native names twice, once in each half, and the two
 * halves were OCR'd independently. A name that appears in the scientific index
 * but cannot be found in the native index -- even allowing one letter of
 * difference -- means at least one of the two readings is wrong.
 *
 * Output: data/audit.json  (and a summary on stdout)
 */
const fs = require('fs');
const path = require('path');
const N = require('./lib/normalize');
const { NearIndex } = require('./lib/fuzzy');

const ROOT = path.join(__dirname, '..');

function main() {
  const part1 = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'part1-vernacular.json'), 'utf8'));
  const part2 = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'part2-scientific.json'), 'utf8'));

  const index = new NearIndex();
  for (const e of part1) index.add(N.searchKey(e.headword), e.headword);

  let total = 0;
  let exact = 0;
  let near = 0;
  const orphans = [];
  for (const t of part2) {
    for (const v of t.vernaculars) {
      total++;
      const hit = index.find(N.searchKey(v.name));
      if (!hit) orphans.push({ name: v.name, under: t.nameDisplay, page: t.page });
      else if (hit.exact) exact++;
      else near++;
    }
  }

  // A second, independent signal: vowel-less or consonant-cluster headwords
  // that no Philippine language would produce.
  const implausible = part1.filter((e) => {
    const w = e.headword.replace(/[^A-Z]/g, '');
    if (w.length < 3) return false;
    const vowels = (w.match(/[AEIOU]/g) || []).length;
    return vowels === 0 || vowels / w.length < 0.2 || /[BCDFGHJKLMNPQRSTVWXZ]{4}/.test(w);
  });

  const audit = {
    generated: new Date().toISOString(),
    crossHalfCheck: {
      description: 'Native names printed in Part II, looked up in Part I',
      total,
      matchedExactly: exact,
      matchedWithinOneLetter: near,
      unmatched: orphans.length,
      unmatchedPercent: +((orphans.length / total) * 100).toFixed(1),
    },
    implausibleHeadwords: {
      description: 'Part I headwords with no vowels or impossible consonant runs',
      count: implausible.length,
      percentOfPartI: +((implausible.length / part1.length) * 100).toFixed(1),
      examples: implausible.slice(0, 40).map((e) => ({ read_as: e.headword, line: e.raw })),
    },
    accentsLost: {
      description: 'Occurrences where an accented vowel was flattened to "e"',
      partI: part1.filter((e) => /é/.test(e.headRaw)).length,
    },
    sampleOrphans: orphans.slice(0, 40),
  };

  fs.writeFileSync(path.join(ROOT, 'data', 'audit.json'), JSON.stringify(audit, null, 2));

  const c = audit.crossHalfCheck;
  console.log('Cross-half check  ' + c.total + ' names printed in both halves');
  console.log('  matched exactly        ' + exact + '  (' + ((exact / total) * 100).toFixed(1) + '%)');
  console.log('  matched within 1 letter ' + near + '  (' + ((near / total) * 100).toFixed(1) + '%)');
  console.log('  no match at all        ' + orphans.length + '  (' + c.unmatchedPercent + '%)  <- at least one reading is wrong');
  console.log('Implausible headwords   ' + implausible.length + '  (' + audit.implausibleHeadwords.percentOfPartI + '% of Part I)');
  console.log('  e.g. ' + implausible.slice(0, 6).map((e) => e.headword).join(', '));
}

main();
