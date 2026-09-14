#!/usr/bin/env node
/**
 * Stage 1 - PDF -> raw page text.
 *
 * Shells out to poppler's `pdftotext -layout`, which preserves the column and
 * indentation structure the parser relies on (Part II uses hanging indents to
 * mark entry continuation lines).
 *
 * Output: data/raw/pages.json  [{ page, lines: [...] }]
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PDF = path.join(ROOT, 'source', 'dictionaryofplan00merr.pdf');
const OUT_DIR = path.join(ROOT, 'data', 'raw');
const OUT = path.join(OUT_DIR, 'pages.json');
const TXT = path.join(OUT_DIR, 'full.txt');

function main() {
  if (!fs.existsSync(PDF)) {
    console.error(`Source PDF not found: ${PDF}`);
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  try {
    execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', PDF, TXT], { stdio: 'pipe' });
  } catch (err) {
    console.error('pdftotext failed. Install poppler-utils and retry.');
    console.error(err.message);
    process.exit(1);
  }

  const raw = fs.readFileSync(TXT, 'utf8');
  // pdftotext separates pages with a form feed.
  const pages = raw.split('\f').map((body, i) => ({
    page: i + 1,
    lines: body.replace(/\r/g, '').split('\n'),
  }));
  // Trailing form feed yields an empty final element.
  while (pages.length && pages[pages.length - 1].lines.every((l) => !l.trim())) pages.pop();

  fs.writeFileSync(OUT, JSON.stringify(pages));

  console.log(`Extracted ${pages.length} pages, ${raw.length.toLocaleString()} chars -> ${path.relative(ROOT, OUT)}`);

  // Two signals worth seeing at extraction time, before any parsing:
  // glyphs pdftotext could not map at all, and accented vowels the scanner
  // flattened onto `e` (which is most of them). See docs/source-quality.md.
  const unmappable = (raw.match(/\uFFFD/g) || []).length;
  const flattened = (raw.match(/\u00E9/g) || []).length;
  if (unmappable) console.log(`  glyphs with no Unicode mapping: ${unmappable}`);
  console.log(`  accented vowels flattened to "e" by the scanner: ${flattened}`);
}

main();
