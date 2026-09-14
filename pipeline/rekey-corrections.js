#!/usr/bin/env node
'use strict';
/**
 * Re-derive every correction file from its stored transcription.
 *
 * Corrections are keyed by what the scanner read (`was`). Fix a parser bug and
 * that reading changes -- "AMORES" becomes "AMORES SECOS" -- and every
 * correction keyed to the old reading goes stale at once. Rather than
 * re-transcribe the pages, re-align the transcription we already have against
 * the new parse and rewrite the keys.
 *
 * Run after any change to how Part I is parsed:
 *   npm run parse && node pipeline/rekey-corrections.js && npm run parse
 *
 * The first parse must run with corrections that may be stale; that is fine,
 * because re-keying reads `ocrHeadword` where a correction did apply and the
 * plain headword where it did not.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'data', 'corrections');

const files = fs.readdirSync(DIR).filter((f) => /^p\d+\.json$/.test(f)).sort();
if (!files.length) {
  console.log('No correction files to re-key.');
  process.exit(0);
}

let rekeyed = 0;
let skipped = 0;
for (const name of files) {
  const file = path.join(DIR, name);
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));

  // Older files predate the stored transcription. Their `entries` list is the
  // transcription for every line that differed, which is all of them on a page
  // where nothing was already correct -- good enough to re-align against.
  const lines = doc.transcription || doc.entries.map((e) => e.headword);
  if (!lines.length) { skipped++; continue; }

  try {
    const out = execFileSync(
      process.execPath,
      [path.join(__dirname, 'ingest-transcription.js'), String(doc.page)],
      { input: lines.join('\n'), encoding: 'utf8' }
    );
    const summary = out.split('\n').find((l) => l.includes('aligned')) || '';
    console.log(`${name}  ${summary.trim()}`);
    rekeyed++;
  } catch (err) {
    console.error(`${name}  FAILED: ${(err.stdout || '') + (err.stderr || err.message)}`);
    skipped++;
  }
}

console.log(`\nre-keyed ${rekeyed} page(s), skipped ${skipped}`);
