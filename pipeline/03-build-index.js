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
const N = require('./lib/normalize');
const { NearIndex } = require('./lib/fuzzy');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const OUT_DIR = path.join(ROOT, 'app', 'data');

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
  // A lone genus ("Metroxylon") has no epithet to take.
  const hasEpithet = tokens.length > 1 && /^[a-zé]/.test(tokens[1]);
  const take = hasEpithet ? 2 : 1;
  return {
    name: tokens.slice(0, take).join(' '),
    authority: tokens.slice(take).join(' ').replace(/[.,]+$/, '') || null,
  };
}

function main() {
  const part1 = JSON.parse(fs.readFileSync(path.join(DATA, 'part1-vernacular.json'), 'utf8'));
  const part2 = JSON.parse(fs.readFileSync(path.join(DATA, 'part2-scientific.json'), 'utf8'));
  const report = JSON.parse(fs.readFileSync(path.join(DATA, 'parse-report.json'), 'utf8'));

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
      genus: e.genus,
      family: e.family,
      familySource: e.familySource,
      notes: e.notes,
      page: e.page,
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
      genus: words[0].toUpperCase(),
      family: null,
      familySource: null,
      notes: null,
      page,
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
        pages: [],
        printedPages: [],
        confidence: null,   // lowest the OCR engine gave this headword
        flags: [],
      };
      byHead.set(headKey, rec);
      names.push(rec);
    }

    for (const d of e.dialects) if (!rec.dialects.includes(d)) rec.dialects.push(d);
    if (e.place && !rec.places.includes(e.place)) rec.places.push(e.place);
    if (!rec.pages.includes(e.page)) rec.pages.push(e.page);
    if (e.printedPage && !rec.printedPages.includes(e.printedPage)) rec.printedPages.push(e.printedPage);
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
  fs.writeFileSync(out, JSON.stringify(payload));
  fs.writeFileSync(path.join(DATA, 'build-report.json'), JSON.stringify(payload.meta, null, 2));

  const kb = (fs.statSync(out).size / 1024).toFixed(0);
  const c = payload.meta.counts;
  console.log(`${c.names} names, ${c.taxa} taxa (${c.taxaWithFamily} with family, ${c.taxaWithNotes} with notes)`);
  console.log(`${c.links} name->taxon links across ${c.families} families`);
  console.log(`Part II contributed ${linkedFromII} extra links and ${extraFromII} names absent from Part I`);
  console.log(`-> app/data/dictionary.json (${kb} KB)`);
}

main();
