#!/usr/bin/env node
'use strict';
/**
 * Stage 1b (optional) - fetch the Internet Archive's OCR side-data.
 *
 * `source/dictionaryofplan00merr.pdf` is the Internet Archive's own derivative
 * of item `dictionaryofplan00merr`, so its text layer and the IA's _djvu.txt are
 * the same Tesseract 5.3 run -- verified, 16,953 of 17,040 tokens identical,
 * with the differences confined to the cover leaves. Re-fetching the text buys
 * nothing.
 *
 * The hOCR is a different matter. It carries what the plain text throws away:
 * a confidence score and a bounding box for every word. Confidence replaces the
 * pipeline's own guesswork about which readings to trust, and the boxes are
 * what a future "show me the scanned line" feature will need.
 *
 * Network access, so this stage is separate and skippable. Everything
 * downstream degrades gracefully when the files are absent.
 *
 * Output: data/raw/ia/  (gitignored)
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const ITEM = 'dictionaryofplan00merr';
const BASE = `https://archive.org/download/${ITEM}`;
const OUT = path.join(__dirname, '..', 'data', 'raw', 'ia');

const FILES = [
  { name: `${ITEM}_hocr.html`, as: 'hocr.html', why: 'per-word confidence and bounding boxes' },
  { name: `${ITEM}_page_numbers.json`, as: 'page_numbers.json', why: 'printed page numbers, for citation' },
];

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('too many redirects'));
    https.get(url, { headers: { 'accept-encoding': 'identity' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(download(new URL(res.headers.location, url).href, dest, redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const tmp = dest + '.part';
      const out = fs.createWriteStream(tmp);
      res.pipe(out);
      out.on('finish', () => {
        out.close(() => { fs.renameSync(tmp, dest); resolve(fs.statSync(dest).size); });
      });
      out.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  console.log(`Internet Archive item: ${ITEM}`);

  for (const f of FILES) {
    const dest = path.join(OUT, f.as);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
      console.log(`  ${f.as} already present (${(fs.statSync(dest).size / 1024).toFixed(0)} KB), skipping`);
      continue;
    }
    process.stdout.write(`  ${f.as} - ${f.why} ... `);
    try {
      const size = await download(`${BASE}/${f.name}`, dest);
      console.log(`${(size / 1024).toFixed(0)} KB`);
    } catch (err) {
      console.log(`failed: ${err.message}`);
      console.log('  (the build continues without it; confidence scores will be absent)');
    }
  }
}

main();
