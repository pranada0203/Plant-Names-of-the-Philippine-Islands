#!/usr/bin/env node
'use strict';
/**
 * Stage 1d (optional) - fetch the text face and vendor it into the app.
 *
 * The app sets Merrill's dictionary in Source Serif 4: even in colour, no
 * mannerism, and an italic restrained enough to carry several thousand
 * binomials without the page sparkling. It replaced Libre Caslon Text, whose
 * high stroke contrast and calligraphic italic were too busy at the 16px a
 * dictionary is actually read at.
 *
 * Its roman is a VARIABLE font, which is why it costs less than the face it
 * replaced despite being a bigger design: one 50 KB file covers every weight
 * from body text to heading, where Caslon needed a separate cut for each. With
 * a 20 KB italic beside it that is 69 KB against Caslon's 76.
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

// Two different requests, deliberately, because the app wants two different
// things from the two styles.
//
// The roman is asked for as a RANGE, `400..700`. That is what makes Google
// serve the variable file: one 50 KB download covering every weight from the
// body text to the headings, instead of a separate cut per weight.
//
// The italic is asked for at 400 and nothing else, which gets a 20 KB static
// cut instead of the 50 KB variable italic. The only italics in this app are
// scientific names, and botanical writing never sets a binomial bold -- so the
// other 30 KB would buy weights no rule could ever use. Raising a weight on an
// italic here will get a synthetic slant, and the fix is to not do that.
const FAMILY = 'Source Serif 4';
const SPEC = 'Source+Serif+4:ital,wght@0,400..700;1,400';

// The licence, from the family's own directory in the google/fonts repository.
const LICENCE = 'https://raw.githubusercontent.com/google/fonts/main/ofl/sourceserif4/OFL.txt';

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

/**
 * `sourceserif4-roman.woff2` -- readable in a directory listing.
 *
 * Named by style rather than by weight, which is only safe because SPEC asks
 * for exactly one file per style; assertOneFilePerStyle() below enforces that.
 * Naming by weight instead would be actively dangerous with a variable face:
 * Google answers a request for two weights of one VF with two @font-face
 * blocks pointing at the SAME url, and a weight-based name would write those
 * identical bytes out twice under different names -- 50 KB of duplicate font
 * shipped, precached and preloaded, with nothing to show it.
 */
const fileNameFor = (f) =>
  `${FAMILY.toLowerCase().replace(/[^a-z0-9]+/g, '')}-` +
  `${f.style === 'italic' ? 'italic' : 'roman'}.woff2`;

/**
 * Fail loudly rather than silently overwrite. If a future SPEC asks for two
 * static cuts of one style, both would want the same filename and the second
 * would land on top of the first.
 */
function assertOneFilePerStyle(faces) {
  const seen = new Map();
  for (const f of faces) {
    const name = fileNameFor(f);
    if (seen.has(name) && seen.get(name) !== f.url) {
      throw new Error(
        `SPEC asks for more than one ${f.style} file, which this naming cannot ` +
        `express. Ask for the style as a weight range so Google serves one ` +
        `variable file, or give fileNameFor() a weight to work with.`);
    }
    seen.set(name, f.url);
  }
}

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

  assertOneFilePerStyle(faces);
  console.log(`${FAMILY} - ${faces.length} cuts, latin subset only`);

  let total = 0;
  let changed = 0;
  const written = [];
  const seenUrls = new Set();
  for (const f of faces) {
    if (seenUrls.has(f.url)) continue;   // one variable file, two declarations
    seenUrls.add(f.url);
    const buf = await get(f.url);
    const name = fileNameFor(f);
    const wrote = writeIfChanged(path.join(OUT, name), buf);
    total += buf.length;
    if (wrote) changed++;
    written.push({ name, style: f.style, weight: f.weight, range: f.range, bytes: buf.length });
    console.log(`  ${name.padEnd(36)} ${String(f.weight).padEnd(8)} ${f.style.padEnd(7)} ` +
      `${(buf.length / 1024).toFixed(1).padStart(6)} KB${wrote ? '' : '  (unchanged)'}`);
  }

  // Sweep out the previous family. Without this, changing FAMILY leaves the old
  // woff2 files sitting in the directory: committed, precached by a stale entry
  // in one of the two SHELL_FILES lists if anyone forgets to update it, and
  // served to readers for ever. Only this script's own output is touched.
  const keep = new Set(written.map((w) => w.name));
  for (const f of fs.readdirSync(OUT)) {
    if (f.endsWith('.woff2') && !keep.has(f)) {
      fs.unlinkSync(path.join(OUT, f));
      changed++;
      console.log(`  removed ${f} (not part of ${FAMILY})`);
    }
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
