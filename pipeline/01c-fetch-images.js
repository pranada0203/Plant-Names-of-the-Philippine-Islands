#!/usr/bin/env node
'use strict';
/**
 * Stage 1c (optional) - fetch page images from the Internet Archive.
 *
 * Needed for the vision pass that repairs headwords the OCR misread, and later
 * for showing a reader the scanned line beside the transcription.
 *
 * The IA serves each leaf as a JPEG, so there is no need for the 63 MB
 * `_jp2.zip` and no need for a JPEG 2000 decoder:
 *
 *     https://archive.org/download/<item>/page/n<leaf>.jpg
 *
 * Leaf numbering: IA leaf `nX` is our PDF page `X + 1`. Verified against the
 * text of pages 25 and 76. (This is *not* the same as the hOCR page index --
 * the hOCR carries 218 pages to the PDF's 209 -- so the two mappings are
 * derived separately and neither is assumed from the other.)
 *
 * Usage:
 *   node pipeline/01c-fetch-images.js             # Part I, the native-name index
 *   node pipeline/01c-fetch-images.js 19 127      # explicit page range (ours, 1-based)
 *
 * Output: data/raw/images/p<page>.jpg  (gitignored, ~400 KB each)
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const ITEM = 'dictionaryofplan00merr';
const OUT = path.join(__dirname, '..', 'data', 'raw', 'images');

/** Part I, the native-name index -- where essentially all the damage is. */
const DEFAULT_RANGE = [19, 127];

const leafUrl = (page) =>
  `https://archive.org/download/${ITEM}/page/n${page - 1}.jpg`;

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('too many redirects'));
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(download(new URL(res.headers.location, url).href, dest, redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const tmp = dest + '.part';
      const out = fs.createWriteStream(tmp);
      res.pipe(out);
      out.on('finish', () => out.close(() => {
        fs.renameSync(tmp, dest);
        resolve(fs.statSync(dest).size);
      }));
      out.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  const [from, to] = process.argv.length >= 4
    ? [Number(process.argv[2]), Number(process.argv[3])]
    : DEFAULT_RANGE;

  fs.mkdirSync(OUT, { recursive: true });
  console.log(`Fetching page images for pages ${from}-${to} (IA leaves n${from - 1}-n${to - 1})`);

  let fetched = 0;
  let skipped = 0;
  let failed = 0;
  let bytes = 0;

  for (let page = from; page <= to; page++) {
    const dest = path.join(OUT, `p${page}.jpg`);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 10000) { skipped++; continue; }
    try {
      bytes += await download(leafUrl(page), dest);
      fetched++;
      if (fetched % 10 === 0) process.stdout.write(`  ${fetched} fetched\r`);
    } catch (err) {
      console.log(`  page ${page}: ${err.message}`);
      failed++;
    }
  }

  console.log(`  ${fetched} fetched (${(bytes / 1048576).toFixed(1)} MB), ${skipped} already present, ${failed} failed`);
  console.log(`  -> ${path.relative(path.join(__dirname, '..'), OUT)}`);
}

main();
