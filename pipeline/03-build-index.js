#!/usr/bin/env node
'use strict';
/**
 * Stage 3 - structured entries -> the single payload the web app loads.
 *
 * The book is two indexes over the same facts. This stage welds them into one
 * graph: every native name points at the taxa it denotes, every taxon points
 * back at the names recorded for it, and the family and descriptive notes that
 * live only in Part II become reachable from a Part I lookup.
 *
 * Output: app/data/dictionary.json
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const N = require('./lib/normalize');
const { NearIndex } = require('./lib/fuzzy');
const WRITE = require('./lib/write');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const OUT_DIR = path.join(ROOT, 'app', 'data');

/**
 * Where the page images come from.
 *
 * The Internet Archive serves every leaf of this scan, in several widths, from
 * the same item the hOCR came from. They are not committed here: 183 leaves is
 * 82 MB, and the IA is both the authority for them and already cited as this
 * edition's source. `{leaf}` is the zero-based leaf, which is our page minus
 * one; `{width}` is one of the sizes the IA generates, or empty for the master.
 */
const IMAGE_BASE = 'https://archive.org/download/dictionaryofplan00merr/page/n{leaf}{width}.jpg';

/**
 * The app's own files, whose contents go into the service worker's version.
 * Keep in step with SHELL_FILES in app/sw.js: a file the worker precaches but
 * this list omits would be served stale for ever after it changed. The check in
 * stampServiceWorker() compares the two lists and says so when they drift.
 *
 * Everything the worker precaches belongs here, the icons and the font files
 * included. They are committed files that change when the pipeline regenerates
 * them or a new font is vendored, and a precached file outside the hash is
 * exactly the stale-for-ever case this list exists to prevent.
 */
const SHELL_FILES = [
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/search.js',
  'js/scan.js',
  'js/offline.js',
  'js/browse.js',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'assets/apple-touch-icon.png',
  'assets/favicon.svg',
  'assets/favicon-32.png',
  'assets/fonts/sourceserif4-roman.woff2',
  'assets/fonts/sourceserif4-italic.woff2',
];

/**
 * The genus as it should be shown and grouped by: one initial capital.
 * Botanical convention, and the only form that groups reliably.
 */
function displayGenus(name) {
  const word = String(name || '').trim().split(/\s+/)[0] || '';
  return word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : '';
}

/** Match key for a scientific name: genus + epithet, case and accent folded. */
function taxonKey(name) {
  const cleaned = name
    .replace(/\b(?:var|subsp|sp|spp|f)\.?\b.*$/i, '')
    .replace(/\?/g, '')
    .trim();
  const words = cleaned
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return null;
  return words.slice(0, 2).join(' ').toLowerCase();
}

/**
 * Strip the trailing authority from a Part I taxon string.
 * "Licuala spectabilis Miq." -> { name: "Licuala spectabilis", authority: "Miq." }
 * Part I prints the authority in roman after a small-caps binomial, so the
 * first two words are the name and the remainder is the authority.
 */
function splitTaxonString(s) {
  const tokens = s.replace(/\s*\.\s*$/, '').split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  // A comma after the genus means what follows is not an epithet but prose:
  // Merrill writes "Goniothalamus, and other arborescent species of Anonaceae"
  // where he means the genus and no more. Taking two words gives a plant called
  // "Goniothalamus, and".
  if (/,$/.test(tokens[0])) {
    return { name: tokens[0].replace(/,$/, ''), authority: null };
  }
  // A lone genus ("Metroxylon") has no epithet to take.
  const hasEpithet = tokens.length > 1 && /^[a-zé]/.test(tokens[1]);
  const take = hasEpithet ? 2 : 1;
  return {
    name: tokens.slice(0, take).join(' '),
    authority: tokens.slice(take).join(' ').replace(/[.,]+$/, '') || null,
  };
}

/**
 * Write a version into the service worker.
 *
 * A browser only notices a new service worker when the bytes of `sw.js` change,
 * so the version has to be in that file rather than in anything it imports. It
 * is a hash rather than a timestamp so that a stale cache cannot be held while
 * new data is served.
 *
 * It hashes two things: what a reader would notice in the payload -- the
 * entries, the facets and where the scan is -- and the bytes of the app's own
 * files. Both matter. Hashing only the payload leaves the service worker
 * serving yesterday's JavaScript out of its cache after an app change, which
 * is a bug you find by fixing something and watching the fix not arrive.
 *
 * What is deliberately left out is `meta.built` and the parse report's
 * `generated`: they differ on every run, and hashing them would expire every
 * reader's offline copy each time the pipeline was run, however little had
 * changed. `sw.js` is left out too, for the obvious reason that the version is
 * written into it.
 */
function stampServiceWorker(payload) {
  const file = path.join(ROOT, 'app', 'sw.js');
  if (!fs.existsSync(file)) return;
  const src = fs.readFileSync(file, 'utf8');
  // The worker precaches its own list. If this one drifts from it, a file the
  // worker serves from cache would never be invalidated when it changed --
  // silently, and only for readers who had already visited.
  const declared = [...src.matchAll(/'\.\/([^']+)'/g)].map((m) => m[1])
    .filter((f) => f !== '');   // './' is the start URL, not a file on disk
  const missing = declared.filter((f) => !SHELL_FILES.includes(f));
  if (missing.length) {
    console.log(`!  app/sw.js precaches ${missing.join(', ')}, which the version ` +
      'hash does not cover - add them to SHELL_FILES in this file');
  }

  const hash = crypto.createHash('sha256');
  hash.update(JSON.stringify([
    payload.names, payload.taxa, payload.families,
    payload.dialects, payload.dialectCounts, payload.meta.scan,
  ]));
  for (const rel of SHELL_FILES) {
    const f = path.join(ROOT, 'app', rel);
    if (fs.existsSync(f)) hash.update(rel).update(fs.readFileSync(f));
  }
  const version = hash.digest('hex').slice(0, 12);
  const line = /^const VERSION = '[^']*';/m;
  if (!line.test(src)) {
    console.log('!  app/sw.js has no VERSION line to stamp - readers will not see updates');
    return;
  }
  // An unchanged version is the normal case, not a failure: the hash covers
  // what a reader sees, so rebuilding after a documentation edit leaves it be.
  const next = src.replace(line, `const VERSION = '${version}';`);
  if (next !== src) fs.writeFileSync(file, next);
  console.log(`service worker version ${version}${next === src ? ' (unchanged)' : ''}`);
}

function main() {
  const part1 = JSON.parse(fs.readFileSync(path.join(DATA, 'part1-vernacular.json'), 'utf8'));
  const part2 = JSON.parse(fs.readFileSync(path.join(DATA, 'part2-scientific.json'), 'utf8'));
  const report = JSON.parse(fs.readFileSync(path.join(DATA, 'parse-report.json'), 'utf8'));
  // Leaf dimensions, written by stage 2 when the hOCR was available. Without
  // them a box is a rectangle with no aspect ratio, so the app shows no image.
  const scanFile = path.join(DATA, 'scan-pages.json');
  const scanned = fs.existsSync(scanFile) ? JSON.parse(fs.readFileSync(scanFile, 'utf8')) : {};

  // ---- taxa ---------------------------------------------------------------
  // Part II is authoritative for taxa: it supplies family and notes. Part I
  // taxa that Part II never mentions are added as bare stubs so no scientific
  // name recorded in the book is unreachable.
  const taxa = [];
  const byKey = new Map();

  for (const e of part2) {
    const key = taxonKey(e.name);
    if (!key) continue;
    if (byKey.has(key)) {
      // Duplicate heading (the book repeats a few); keep the richer record.
      const existing = taxa[byKey.get(key)];
      if (!existing.notes && e.notes) existing.notes = e.notes;
      if (!existing.family && e.family) existing.family = e.family;
      continue;
    }
    byKey.set(key, taxa.length);
    taxa.push({
      id: taxa.length,
      name: e.nameDisplay,
      printed: e.name,
      authority: e.authority,
      // From the display binomial, not from the parse's own `genus`. That one
      // carries whatever case the page was set in -- ARENGA beside Calamus
      // beside CorypHa -- which is invisible until something tries to group by
      // it, and then Palmae has nineteen genera holding no species each.
      genus: displayGenus(e.nameDisplay),
      family: e.family,
      familySource: e.familySource,
      notes: e.notes,
      page: e.page,
      printedPage: e.printedPage || null,
      box: e.box || null,
      fromPartII: true,
      names: [],          // filled below
      partIINames: e.vernaculars,
    });
  }

  // Part II's taxa, indexed for near matching. Part I spells the same binomial
  // slightly differently often enough that exact keys alone would mint hundreds
  // of duplicate stub taxa.
  const taxonIndex = new NearIndex();
  for (const [key, id] of byKey) taxonIndex.add(key.replace(/\s+/g, ''), id);

  let taxaJoinedFuzzy = 0;
  const stubFor = (name, page) => {
    const key = taxonKey(name);
    if (!key) return null;
    if (byKey.has(key)) return byKey.get(key);

    const near = taxonIndex.find(key.replace(/\s+/g, ''));
    if (near) {
      if (!near.exact) taxaJoinedFuzzy++;
      byKey.set(key, near.value);      // remember, so the next spelling is cheap
      return near.value;
    }

    const words = name.split(/\s+/);
    byKey.set(key, taxa.length);
    taxonIndex.add(key.replace(/\s+/g, ''), taxa.length);
    taxa.push({
      id: taxa.length,
      name: words[0].charAt(0).toUpperCase() + words[0].slice(1).toLowerCase() +
        (words[1] ? ' ' + words[1].toLowerCase() : ''),
      printed: name,
      authority: null,
      genus: displayGenus(words[0]),
      family: null,
      familySource: null,
      notes: null,
      page,
      printedPage: null,
      // A stub was never printed in the scientific index, so it has no line
      // there to show. The reader is sent to the Part I line instead.
      box: null,
      fromPartII: false,
      names: [],
      partIINames: [],
    });
    return byKey.get(key);
  };

  // ---- names --------------------------------------------------------------
  // One record per headword occurrence. The book lists the same headword on
  // several lines when it denotes several plants; those are merged here.
  const names = [];
  const byHead = new Map();

  for (const e of part1) {
    const headKey = N.searchKey(e.headword);
    if (!headKey) continue;

    let rec = byHead.get(headKey);
    if (!rec) {
      rec = {
        id: names.length,
        name: e.headword,
        printed: e.headRaw,
        key: headKey,
        dialects: [],
        places: [],
        taxa: [],
        // One per line the book prints this headword on: which leaf, how that
        // leaf is paginated in the printing, and where on it the line sits.
        // The same headword appears on several lines when it names several
        // plants, and each of those is a separate thing to go and look at.
        sightings: [],
        confidence: null,   // lowest the OCR engine gave this headword
        flags: [],
      };
      byHead.set(headKey, rec);
      names.push(rec);
    }

    for (const d of e.dialects) if (!rec.dialects.includes(d)) rec.dialects.push(d);
    if (e.place && !rec.places.includes(e.place)) rec.places.push(e.place);
    rec.sightings.push({
      page: e.page,
      ...(e.printedPage ? { printedPage: e.printedPage } : {}),
      ...(e.box ? { box: e.box } : {}),
    });
    // Merged headwords take the worst reading, not the flattering one.
    if (e.confidence !== null && e.confidence !== undefined) {
      rec.confidence = rec.confidence === null ? e.confidence : Math.min(rec.confidence, e.confidence);
    }
    for (const f of e.flags) if (!rec.flags.includes(f)) rec.flags.push(f);

    for (const raw of e.taxa) {
      const split = splitTaxonString(raw);
      if (!split) continue;
      const tid = stubFor(split.name, e.page);
      if (tid === null) continue;
      if (!rec.taxa.some((t) => t.id === tid)) {
        rec.taxa.push({ id: tid, authority: split.authority, printed: raw });
      }
      if (!taxa[tid].names.includes(rec.id)) taxa[tid].names.push(rec.id);
    }
  }

  // ---- fold Part II's own name lists into the graph ------------------------
  // Part II repeats the native names under each species. Where one matches a
  // Part I headword we link it; where it does not, it is a name the native
  // index missed, so it is kept on the taxon as an extra.
  // Both halves were OCR'd independently, so the same name often differs by a
  // letter between them. Exact keys first, then a single edit of tolerance.
  const nameIndex = new NearIndex();
  for (const [key, rec] of byHead) nameIndex.add(key, rec);

  let linkedFromII = 0;
  let linkedFuzzy = 0;
  let extraFromII = 0;
  for (const t of taxa) {
    const extras = [];
    for (const v of t.partIINames) {
      const hit = nameIndex.find(N.searchKey(v.name));
      const rec = hit ? hit.value : null;
      if (rec) {
        linkedFromII++;
        if (!hit.exact) linkedFuzzy++;
        if (!rec.taxa.some((x) => x.id === t.id)) {
          rec.taxa.push({
            id: t.id,
            authority: null,
            printed: t.printed,
            via: hit.exact ? 'partII' : 'partII-near',
          });
        }
        if (!t.names.includes(rec.id)) t.names.push(rec.id);
        for (const d of v.dialects) if (!rec.dialects.includes(d)) rec.dialects.push(d);
      } else {
        extraFromII++;
        extras.push(v);
      }
    }
    t.extraNames = extras;
    delete t.partIINames;
  }

  names.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  names.forEach((n, i) => { n.sortIndex = i; });

  // ---- facets -------------------------------------------------------------
  const families = {};
  for (const t of taxa) if (t.family) families[t.family] = (families[t.family] || 0) + 1;
  const dialectCounts = {};
  for (const n of names) for (const d of n.dialects) dialectCounts[d] = (dialectCounts[d] || 0) + 1;

  const payload = {
    meta: {
      title: 'A Dictionary of the Plant Names of the Philippine Islands',
      author: 'Elmer D. Merrill',
      published: 1903,
      publisher: 'Bureau of Government Laboratories, Department of the Interior, Manila',
      series: '1903, No. 8',
      source: 'dictionaryofplan00merr.pdf',
      rights: 'Published 1903; in the public domain.',
      scan: {
        item: 'dictionaryofplan00merr',
        // Our page number is the leaf number plus one.
        imageUrl: IMAGE_BASE,
        // The IA generates downscales below the master's width and serves the
        // master for anything larger, so only ask for sizes that exist.
        widths: [800],
        viewer: 'https://archive.org/details/dictionaryofplan00merr/page/n{leaf}',
        // Pixel size of each leaf, so a box expressed as fractions of the page
        // can be turned back into an aspect ratio. Leaves differ.
        pages: scanned,
      },
      built: new Date().toISOString(),
      counts: {
        names: names.length,
        taxa: taxa.length,
        taxaWithNotes: taxa.filter((t) => t.notes).length,
        taxaWithFamily: taxa.filter((t) => t.family).length,
        families: Object.keys(families).length,
        links: names.reduce((a, n) => a + n.taxa.length, 0),
      },
      provenance: {
        parse: report,
        namesFlagged: names.filter((n) => n.flags.length).length,
        ocrConfidence: (() => {
          const scored = names.filter((n) => n.confidence !== null).map((n) => n.confidence);
          if (!scored.length) return null;
          const sorted = [...scored].sort((a, b) => a - b);
          return {
            source: "Internet Archive hOCR, Tesseract 5.3 x_wconf",
            scored: scored.length,
            unscored: names.length - scored.length,
            median: sorted[Math.floor(sorted.length / 2)],
            under40: scored.filter((c) => c < 40).length,
            under70: scored.filter((c) => c < 70).length,
          };
        })(),
        linkedFromPartII: linkedFromII,
        linkedByNearMatch: linkedFuzzy,
        taxaJoinedByNearMatch: taxaJoinedFuzzy,
        namesOnlyInPartII: extraFromII,
      },
    },
    dialects: N.DIALECTS,
    dialectCounts,
    families,
    names,
    taxa,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, 'dictionary.json');
  // `built` keeps its previous value when nothing else changed, so a rebuild
  // that alters no data leaves these files -- and `git status` -- untouched.
  const body = WRITE.writeJson(fs, out, payload, { stamp: 'meta.built' });
  stampServiceWorker(payload);
  WRITE.writeJson(fs, path.join(DATA, 'build-report.json'), payload.meta, { stamp: 'built', space: 2 });

  const kb = (fs.statSync(out).size / 1024).toFixed(0);
  const c = payload.meta.counts;
  console.log(`${c.names} names, ${c.taxa} taxa (${c.taxaWithFamily} with family, ${c.taxaWithNotes} with notes)`);
  console.log(`${c.links} name->taxon links across ${c.families} families`);
  console.log(`Part II contributed ${linkedFromII} extra links and ${extraFromII} names absent from Part I`);
  console.log(`-> app/data/dictionary.json (${kb} KB)`);
}

main();
