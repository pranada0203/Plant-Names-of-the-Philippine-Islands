#!/usr/bin/env node
'use strict';
/**
 * Stage 1d (optional) - fetch the text face and vendor it into the app.
 *
 * The app sets Merrill's dictionary in Libre Caslon Text. Caslon is the book
 * face of English and American printing through the nineteenth century and
 * into the twentieth, which is the tradition the 1903 printing belongs to, and
 * the Text cut is the one drawn for small sizes rather than for display -- it
 * holds up at the 16px a dictionary is actually read at, where EB Garamond and
 * Crimson Pro both go thin. It was also the smallest of the three: 76 KB for
 * roman, italic and bold against 111 and 112.
 *
 * WHY THE FILES ARE COMMITTED RATHER THAN LINKED
 *
 * Linking fonts.googleapis.com would put a third party in the critical path of
 * a page that is otherwise entirely self-contained, and would break the app
 * offline -- which is the one property the service worker exists to provide. So
 * the woff2 files live in app/assets/fonts/ and are precached with the rest of
 * the shell. Running this stage is how they get there; nothing downstream needs
 * the network.
 *
 * WHY THERE IS STILL NO BUILD STEP
 *
 * Google Fonts already serves each face cut into unicode-range subsets, and the
 * whole book fits in one of them. Every character in the payload is ASCII or
 * Latin-1 -- the accented vowels of Tagalog and Visayan orthography, plus the
 * degree sign, the section mark and a stray yen -- so the `latin` subset covers
 * it and `latin-ext` is dead weight. This stage takes the `latin` file Google
 * has already subset and writes it out. No font tooling, no build.
 *
 * The CSS is parsed rather than the URLs hardcoded: gstatic paths carry a
 * version in them, and a pinned URL would quietly rot.
 *
 * SIL Open Font License 1.1 requires the licence to travel with the font, so
 * OFL.txt is fetched alongside the files and committed with them.
 *
 * Output: app/assets/fonts/  (committed)
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const OUT = path.join(__dirname, '..', 'app', 'assets', 'fonts');

// Weights the stylesheet actually asks for. There is deliberately no bold
// italic: the only italics in the app are scientific names, which are never
// set bold in botanical writing, so nothing would use it.
const FAMILY = 'Libre Caslon Text';
const SPEC = 'Libre+Caslon+Text:ital,wght@0,400;0,700;1,400';

// The licence, from the family's own directory in the google/fonts repository.
const LICENCE = 'https://raw.githubusercontent.com/google/fonts/main/ofl/librecaslontext/OFL.txt';

// Google serves woff2 only to a browser it recognises; with Node's default
// agent it answers with the ttf stylesheet instead, which is four times the
// size and which no rule here would match.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** The `latin` subset and no other: it starts at U+0000, the others do not. */
const IS_LATIN = (range) => /U\+0+-0*[Ff][Ff]\b/.test(range);

function get(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('too many redirects'));
    https.get(url, { headers: { 'user-agent': UA, 'accept-encoding': 'identity' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(get(new URL(res.headers.location, url).href, redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

/**
 * Pull the @font-face blocks out of the Google stylesheet.
 *
 * Only the fields that matter downstream: which cut it is, where the bytes are,
 * and the unicode-range, which is carried through to our own stylesheet so the
 * browser still skips the download for a page with no Latin text on it.
 */
function parseFaces(css) {
  const faces = [];
  for (const block of css.split('@font-face').slice(1)) {
    const style = /font-style:\s*([^;]+);/.exec(block);
    const weight = /font-weight:\s*([^;]+);/.exec(block);
    const src = /src:\s*url\(([^)]+)\)/.exec(block);
    const range = /unicode-range:\s*([^;]+);/.exec(block);
    if (!style || !weight || !src || !range) continue;
    faces.push({
      style: style[1].trim(),
      weight: weight[1].trim(),
      url: src[1].trim(),
      range: range[1].trim(),
    });
  }
  return faces;
}

/** `librecaslontext-400-italic.woff2` -- readable in a directory listing. */
const fileNameFor = (f) =>
  `${FAMILY.toLowerCase().replace(/\s+/g, '')}-${f.weight}-${f.style}.woff2`;

/**
 * Write only when the bytes differ. A font that has not changed keeps its
 * modification time, so a re-run does not show up as a change to be committed
 * -- the same reason pipeline/lib/write.js holds timestamps steady.
 */
function writeIfChanged(file, buf) {
  if (fs.existsSync(file) && fs.readFileSync(file).equals(buf)) return false;
  fs.writeFileSync(file, buf);
  return true;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  const url = `https://fonts.googleapis.com/css2?family=${SPEC}&display=swap`;
  const css = (await get(url)).toString('utf8');
  const faces = parseFaces(css).filter((f) => IS_LATIN(f.range));
  if (!faces.length) throw new Error('no latin subset in the stylesheet Google returned');

  console.log(`${FAMILY} - ${faces.length} cuts, latin subset only`);

  let total = 0;
  let changed = 0;
  const written = [];
  for (const f of faces) {
    const buf = await get(f.url);
    const name = fileNameFor(f);
    const wrote = writeIfChanged(path.join(OUT, name), buf);
    total += buf.length;
    if (wrote) changed++;
    written.push({ name, style: f.style, weight: f.weight, range: f.range, bytes: buf.length });
    console.log(`  ${name.padEnd(36)} ${String(f.weight).padEnd(4)} ${f.style.padEnd(7)} ` +
      `${(buf.length / 1024).toFixed(1).padStart(6)} KB${wrote ? '' : '  (unchanged)'}`);
  }

  const licence = await get(LICENCE);
  if (writeIfChanged(path.join(OUT, 'OFL.txt'), licence)) changed++;

  // The unicode-range each file was subset to, so the stylesheet can declare
  // the same thing without this script and that file drifting apart.
  const meta = {
    family: FAMILY,
    source: url,
    licence: 'SIL Open Font License 1.1 (see OFL.txt)',
    faces: written,
  };
  const metaFile = path.join(OUT, 'fonts.json');
  if (writeIfChanged(metaFile, Buffer.from(JSON.stringify(meta, null, 2) + '\n'))) changed++;

  console.log(`\n${(total / 1024).toFixed(0)} KB of woff2, ${changed} file(s) changed`);
  console.log(`-> app/assets/fonts`);
  console.log('\nThe stylesheet declares these in app/css/app.css and app/sw.js');
  console.log('precaches them; both lists must name every file written here.');
}

main().catch((err) => {
  console.error(`fonts: ${err.message}`);
  process.exitCode = 1;
});
