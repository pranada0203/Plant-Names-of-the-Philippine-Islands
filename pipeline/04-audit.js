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
const WRITE = require('./lib/write');

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
  // Accented vowels are vowels. Counting only A-E-I-O-U would flag every
  // correctly transcribed name -- ACLÉNG-PÁRANG has four vowels, all accented.
  // Multi-word headwords are judged word by word for the same reason.
  const VOWEL = /[AEIOUÁÉÍÓÚÀÈÌÒÙÄËÏÖÜÑ]/g;
  const CONSONANT_RUN = /[BCDFGHJKLMNPQRSTVWXZ]{4}/;
  const implausible = part1.filter((e) => {
    if (e.corrected) return false;   // measuring the scan, not the transcription
    const words = e.headword.split(/[^A-ZÀ-Þ]+/).filter((w) => w.length >= 3);
    if (!words.length) return false;
    return words.some((w) => {
      const vowels = (w.match(VOWEL) || []).length;
      return vowels === 0 || vowels / w.length < 0.2 || CONSONANT_RUN.test(w);
    });
  });

  // The decisive comparison, when hOCR confidence is available: the native
  // headwords and the scientific names sit on the same pages of the same scan,
  // but the headwords are set in small caps and the scientific names in roman.
  // If small caps are the problem, the two should score very differently.
  // Only entries still as the scanner read them. A corrected headword carries a
  // confidence of 100 by fiat, and including those would turn this measurement
  // of the OCR into a measurement of the transcription.
  const scored = part1.filter(
    (e) => !e.corrected && e.confidence !== null && e.confidence !== undefined
  );
  let typeface = null;
  if (scored.length) {
    const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
    const headwords = scored.map((e) => e.confidence);
    // Part II's scientific headings are set in caps/roman; Part I's are not.
    const roman = part2.map((e) => e.confidence).filter((c) => c !== null && c !== undefined);
    typeface = {
      description: 'OCR confidence by how the word is set on the page (uncorrected entries only)',
      corrected: part1.filter((e) => e.corrected).length,
      stillAsScanned: scored.length,
      smallCapsHeadwords: {
        n: headwords.length,
        median: median(headwords),
        underFifty: headwords.filter((c) => c < 50).length,
        underFiftyPercent: +((headwords.filter((c) => c < 50).length / headwords.length) * 100).toFixed(1),
      },
      romanScientificNames: roman.length ? {
        n: roman.length,
        median: median(roman),
        underFifty: roman.filter((c) => c < 50).length,
      } : null,
      worstReadings: [...scored]
        .sort((a, b) => a.confidence - b.confidence)
        .slice(0, 25)
        .map((e) => ({ read_as: e.headRaw, confidence: e.confidence, page: e.page, line: e.raw })),
    };
  }

  const audit = {
    generated: new Date().toISOString(),
    ocrConfidence: typeface,
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

  WRITE.writeJson(fs, path.join(ROOT, 'data', 'audit.json'), audit, { stamp: 'generated', space: 2 });

  if (typeface) {
    const sc = typeface.smallCapsHeadwords;
    console.log('OCR confidence (Tesseract x_wconf, via IA hOCR)');
    console.log('  native headwords, small caps: n=' + sc.n + '  median ' + sc.median +
      '  under 50: ' + sc.underFiftyPercent + '%');
    if (typeface.romanScientificNames) {
      const r = typeface.romanScientificNames;
      console.log('  scientific names, roman    : n=' + r.n + '  median ' + r.median +
        '  under 50: ' + ((r.underFifty / r.n) * 100).toFixed(1) + '%');
    }
  }

  const c = audit.crossHalfCheck;
  console.log('Cross-half check  ' + c.total + ' names printed in both halves');
  console.log('  matched exactly        ' + exact + '  (' + ((exact / total) * 100).toFixed(1) + '%)');
  console.log('  matched within 1 letter ' + near + '  (' + ((near / total) * 100).toFixed(1) + '%)');
  console.log('  no match at all        ' + orphans.length + '  (' + c.unmatchedPercent + '%)  <- at least one reading is wrong');
  console.log('Implausible headwords   ' + implausible.length + '  (' + audit.implausibleHeadwords.percentOfPartI + '% of Part I)');
  console.log('  e.g. ' + implausible.slice(0, 6).map((e) => e.headword).join(', '));
}

main();
