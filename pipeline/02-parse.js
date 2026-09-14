#!/usr/bin/env node
'use strict';
/**
 * Stage 2 - raw page text -> structured entries.
 *
 * The book has two halves and they need different parsers:
 *
 *   Part I  (native name index)  "ANAHAO, T., V. Licuala spectabilis Miq."
 *           one entry per line: headword, dialect list, scientific name.
 *
 *   Part II (scientific index)   "ADENANTHERA. (Leguminosae.) Trees without
 *           spines... / Adambaguen, Il.; Ipil, Z."
 *           multi-line, hanging indent, carries the family and the
 *           descriptive notes that Part I lacks.
 *
 * Anything that does not parse is kept verbatim in data/issues.json rather
 * than dropped, so coverage is measurable and the gaps are reviewable.
 */
const fs = require('fs');
const path = require('path');
const N = require('./lib/normalize');
const TAX = require('./lib/taxonomy');

const ROOT = path.join(__dirname, '..');
const IN = path.join(ROOT, 'data', 'raw', 'pages.json');
const OUT_DIR = path.join(ROOT, 'data');

// ---------------------------------------------------------------- boundaries

/** Locate the two halves by their known first entries rather than page numbers. */
function findSections(pages) {
  const findPage = (re) => pages.findIndex((p) => p.lines.some((l) => re.test(l)));
  const partIStart = findPage(/^\s*AAGAO,/);
  const partIIStart = findPage(/^\s*ACHRAS\s+SAPOTA/i);
  if (partIStart < 0 || partIIStart < 0) throw new Error('Could not locate section boundaries');
  // Part II runs to the last page carrying a recognisable scientific entry.
  let partIIEnd = pages.length - 1;
  while (partIIEnd > partIIStart &&
         !pages[partIIEnd].lines.some((l) => /^[A-Z]{3,}[A-Z\s]*\.|^[A-Z]\.\s+[A-Z]/.test(l))) {
    partIIEnd--;
  }
  return { partI: [partIStart, partIIStart - 1], partII: [partIIStart, partIIEnd] };
}

// ------------------------------------------------------------------- Part I

const LOC = N.DIALECT_RE;

/**
 * A dialect slot as it actually appears on the page. Deliberately looser than
 * the canonical abbreviation list: the scan turns "Il." into "I]." / "ll." /
 * "l.", "T." into "FT." / "T:", "V." into "VY.". Matching the *shape* and
 * canonicalising afterwards recovers those lines instead of discarding them.
 * Capped at five letters so it can never swallow the genus that follows.
 */
const LOC_SLOT = '(?:Sp\\.\\s*-?\\s*Fil|[A-Za-z\\[\\]|][A-Za-z\\[\\]|]{0,4})';

const PART_I_ENTRY = new RegExp(
  '^(?<head>[^.;()]{2,60}?)' +                             // headword (small caps in print)
  '(?<locs>(?:\\s*,\\s*' + LOC_SLOT + '\\s*[.:]\\??)+)?' + // ", T., V."
  '(?:\\s*\\((?<place>[^)]{1,40})\\)\\s*\\.?)?' +          // " (Cagayan)."
  '\\s*[.:]?\\s+' +
  '(?<sci>[A-Z][^]{2,})$'
);

/** Unparsed leftovers that are page furniture, not lost data. */
const FURNITURE = /^\s*(\d{1,3}|[A-Z]\.|[IVXL]+|\d+\s+\d+|8956.*)\s*$/;

function parsePartI(pages, range) {
  const entries = [];
  const issues = [];
  for (let p = range[0]; p <= range[1]; p++) {
    for (const rawLine of pages[p].lines) {
      const line = N.repairOcr(rawLine);
      if (!line || FURNITURE.test(line)) continue;

      const m = PART_I_ENTRY.exec(line);
      if (!m || !m.groups.head.trim()) {
        issues.push({ part: 1, page: p + 1, text: line });
        continue;
      }
      const g = m.groups;
      // Scan marks -- rule fragments, stray quotes, the printer's hanging
      // hyphen -- cling to the front and back of headwords. They are not part
      // of the name, and left alone they sort ahead of the whole alphabet.
      const head = N.squash(g.head).replace(/^[^A-Za-zÀ-ÿ]+/, '').replace(/[^A-Za-zÀ-ÿ]+$/, '');
      if (!head) {
        issues.push({ part: 1, page: p + 1, text: line });
        continue;
      }

      const locTokens = (g.locs || '').split(',').map((s) => s.trim()).filter(Boolean);
      const dialects = locTokens.map(N.canonicalDialect).filter(Boolean);
      const dialectsUnknown = locTokens.filter((t) => !N.canonicalDialect(t));

      // "Vitex negundo L.--Vitex obovata Thunb." lists two species for one name.
      const taxa = N.squash(g.sci)
        .split(/\s*--\s*/)
        .map((s) => s.replace(/\s*[.;]\s*$/, '').trim())
        .filter(Boolean);

      entries.push({
        headword: head.toUpperCase(),
        headRaw: head,
        dialects,
        dialectsUnknown: dialectsUnknown.length ? dialectsUnknown : undefined,
        place: g.place ? N.squash(g.place) : null,
        taxa,
        page: p + 1,
        raw: line,
        flags: qualityFlags(head, taxa, dialectsUnknown),
      });
    }
  }
  return { entries, issues };
}

/**
 * Per-entry confidence markers, so the UI can be honest about the scan.
 * Mixed case in a headword is NOT a flag: the original sets headwords in small
 * caps, which OCRs as arbitrary case ("AniBionG") while the letters stay right.
 */
function qualityFlags(head, taxa, unknownDialects) {
  const f = [];
  if (N.ACCENT_SUSPECT.test(head)) f.push('accent-lost');
  if (/[^A-Za-zÀ-ÿ\-' ]/.test(head)) f.push('glyph-damage');
  if (unknownDialects && unknownDialects.length) f.push('dialect-unrecognised');
  if (!taxa.length || taxa.some((t) => !/^[A-Z][a-zé]/.test(t))) f.push('taxon-suspect');
  return f;
}

// ------------------------------------------------------------------ Part II

/**
 * A trailing native-name line: "Alam, T." / "Langil; Malatero." / "Lopo-lopo,
 * V.; Hangot, T." Never a head, even when the page has lost its indentation.
 */
const VERN_LINE = new RegExp(
  '^[A-Za-zé][A-Za-zé\'\\- ]{1,40}(?:,\\s*(?:' + LOC + ')\\.|;)',
  'i'
);

/**
 * Does this line open a new scientific-name entry?
 *
 * Indentation is the primary signal -- entries hang, continuations are indented
 * -- but a handful of pages lose their indentation in the text layer, so the
 * shape of the line has to back it up. Case alone is not usable: genus-only
 * headings are set in small caps and OCR as "AcrosticHum", "Cyperus", "Berrya".
 */
function isPartIIHead(line) {
  if (/^\s{3,}/.test(line)) return false;                 // indented = continuation
  const t = line.trim();
  if (!t || FURNITURE.test(t)) return false;
  if (/^[a-zé]/.test(t)) return false;                    // wrapped prose
  if (VERN_LINE.test(t)) return false;                    // native-name list

  const tokens = t.split(/\s+/);
  const first = tokens[0];
  if (/^[A-Z]\.$/.test(first)) return true;               // "A. ASPERA Linn."

  const letters = first.replace(/[^A-Za-z]/g, '');
  if (letters.length < 3) return false;
  const upper = (letters.match(/[A-Z]/g) || []).length;
  if (upper >= 2) return true;                            // caps or mangled small caps
  // Titlecase genus standing alone: accept only if what follows looks like an
  // entry body -- a parenthesised family, or another capitalised word.
  return /^[A-Z][a-zé]/.test(first) && /^[(A-Z]/.test(tokens[1] || '');
}

/**
 * Any parenthesised single word is a *candidate* family. We do not try to
 * recognise the ending with a regex -- the scan mangles "-aceae" into at least
 * six shapes -- we hand each candidate to the family matcher and accept the
 * first one it can resolve. Place names like "(Tayabas)" resolve to nothing
 * and are correctly left alone.
 */
const FAMILY_CANDIDATE = /\(\s*([A-Za-zé/\\.]{4,26})\s*\)/g;

function findFamily(text) {
  FAMILY_CANDIDATE.lastIndex = 0;
  let m;
  while ((m = FAMILY_CANDIDATE.exec(text)) !== null) {
    const canon = TAX.canonicalFamily(m[1]);
    if (canon.family) return { index: m.index, length: m[0].length, raw: m[1], canon };
  }
  return null;
}

function parsePartII(pages, range) {
  const entries = [];
  const issues = [];
  let block = null;

  const flush = () => {
    if (!block) return;
    const parsed = parsePartIIBlock(block);
    if (parsed) entries.push(parsed);
    else issues.push({ part: 2, page: block.page, text: block.lines.join(' ').slice(0, 300) });
    block = null;
  };

  for (let p = range[0]; p <= range[1]; p++) {
    for (const rawLine of pages[p].lines) {
      if (!rawLine.trim()) continue;
      const t = N.repairOcr(rawLine);
      if (FURNITURE.test(t)) continue;
      if (isPartIIHead(rawLine)) {
        flush();
        block = { page: p + 1, lines: [t] };
      } else if (block) {
        block.lines.push(t);
      }
    }
  }
  flush();
  return { entries, issues };
}

/**
 * One item of a native-name list: "Bihay, T., V." / "Cuyao-yio (Masbate)" /
 * "Alalangat". Anchored end-to-end, because the point is to decide whether a
 * whole semicolon-separated segment is a name or a sentence of prose.
 */
const VERN_SEGMENT = new RegExp(
  '^([A-Za-zé][A-Za-zé\'\\- ]{0,40}?)' +                     // the name
  '(?:\\s*,\\s*((?:' + LOC + ')\\.?(?:\\s*,\\s*(?:' + LOC + ')\\.?)*))?' +  // ", T., V."
  '(?:\\s*\\(([^)]{2,30})\\))?' +                            // " (Masbate)"
  '\\s*[.,]?$'
);

/**
 * Is this segment a native name rather than a sentence? Names are short, at
 * most a few words, and carry no internal punctuation.
 */
function asVernacular(segment) {
  const s = segment.trim();
  if (s.length < 2 || s.length > 60) return null;
  const m = VERN_SEGMENT.exec(s);
  if (!m) return null;
  const label = N.squash(m[1]);
  if (!label || label.length < 2) return null;
  if (label.split(/\s+/).length > 4) return null;            // prose, not a name
  // A bare word with no dialect and no place is only a name if it is not an
  // obvious sentence fragment.
  if (!m[2] && !m[3] && /^(?:The|A|An|In|Of|This|These|Used|Cultivated)$/i.test(label)) return null;
  return {
    name: label,
    dialects: (m[2] || '').split(/[.,]/).map(N.canonicalDialect).filter(Boolean),
    place: m[3] ? N.squash(m[3]) : null,
  };
}

/**
 * Split an entry body into prose notes and the trailing native-name list.
 * The list is the longest run of name-shaped segments at the end; the segment
 * before it may hold both ("A shrub with yellow flowers. Balatong, T.").
 */
function splitNotesAndVernaculars(rest) {
  const segs = rest.split(';').map((s) => s.trim()).filter(Boolean);

  let start = segs.length;
  while (start > 0 && asVernacular(segs[start - 1])) start--;

  const vernaculars = segs.slice(start).map(asVernacular).filter(Boolean);
  let notesSegs = segs.slice(0, start);

  // Recover a first name that shares its segment with the closing prose.
  if (start > 0) {
    const s = segs[start - 1];
    const cut = s.lastIndexOf('. ');
    if (cut > 0) {
      const candidate = asVernacular(s.slice(cut + 2));
      if (candidate) {
        vernaculars.unshift(candidate);
        notesSegs = segs.slice(0, start - 1).concat(s.slice(0, cut + 1));
      }
    }
  }

  return {
    notes: N.squash(notesSegs.join('; ').replace(/^[\s.;]+/, '')) || null,
    vernaculars,
  };
}

/**
 * "ACHRAS SAPOTA Linn."  -> { name: "ACHRAS SAPOTA", authority: "Linn" }
 * "A. PAVONINA Linn."    -> { name: "A. PAVONINA",   authority: "Linn" }
 * "ALSTONIA"             -> { name: "ALSTONIA",      authority: null   }
 */
function splitName(namePart) {
  const tokens = N.squash(namePart).split(/\s+/).filter(Boolean);
  if (!tokens.length) return { name: namePart, authority: null };

  const abbreviated = /^[A-Z]\.$/.test(tokens[0]);
  // Abbreviated genus: initial + epithet. Otherwise: genus + optional epithet.
  const take = abbreviated ? 2 : Math.min(2, tokens.length);
  const name = tokens.slice(0, take).join(' ');
  const rest = tokens.slice(take).join(' ').replace(/[.,\s]+$/, '');
  return { name, authority: rest || null };
}

/**
 * The book sets scientific names in caps/small caps. Botanical convention is
 * "Genus species", so render that for display while keeping the printed form.
 */
function displayBinomial(name) {
  const parts = name.split(/\s+/);
  return parts
    .map((w, i) => {
      if (/^[A-Z]\.$/.test(w)) return w;
      const lower = w.toLowerCase();
      return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(' ');
}

/** Rejoin a block's lines, healing words the printer broke across the line. */
function joinBlock(lines) {
  let out = '';
  for (const line of lines) {
    const l = line.replace(/\\/g, '').trim();
    if (!l) continue;
    if (/[A-Za-zé]-$/.test(out) && /^[a-zé]/.test(l)) out = out.slice(0, -1) + l;
    else out = out ? out + ' ' + l : l;
  }
  return N.squash(out);
}

function parsePartIIBlock(block) {
  const text = joinBlock(block.lines);
  const fam = findFamily(text);

  // "A. ASPERA L." - an abbreviated genus. Consume it before any sentence split,
  // otherwise the period after the initial looks like the end of the name.
  const abbr = /^([A-Z])\.\s+/.exec(text);

  // Scientific name is everything before the family, else before the first sentence.
  let namePart = fam ? text.slice(0, fam.index) : text;
  let rest = fam ? text.slice(fam.index + fam.length) : '';
  if (!fam) {
    const from = abbr ? abbr[0].length : 0;
    const dot = text.slice(from).search(/\.\s+[A-Z]/);
    if (dot > 0) {
      namePart = text.slice(0, from + dot + 1);
      rest = text.slice(from + dot + 1);
    }
  }
  namePart = namePart.replace(/[\s.]+$/, '').trim();
  if (!namePart) return null;

  // Split "GENUS SPECIES Author" into taxon and authority. The species epithet
  // is printed in small caps, so OCR returns it in any case ("viscosum",
  // "opTusIFoLIA"); case cannot mark the boundary. Position can: a name is at
  // most genus + epithet, and everything after that is the authority.
  const { name, authority } = splitName(namePart);

  const { notes, vernaculars } = splitNotesAndVernaculars(rest);

  // A parenthesised word we could not resolve: surfaced so the family list can
  // be extended rather than the entry quietly losing its family.
  let unresolvedFamily = null;
  if (!fam) {
    const c = /\(\s*([A-Za-zé/\\.]{4,26})\s*\)/.exec(namePart + ' ' + rest.slice(0, 60));
    if (c && /ce|ae|se|re/i.test(c[1])) unresolvedFamily = c[1].replace(/\.$/, '');
  }

  return {
    name,
    authority,
    family: fam ? fam.canon.family : null,
    familyRaw: fam ? fam.raw.replace(/\.$/, '') : null,
    familySource: fam ? fam.canon.confidence : null,
    unresolvedFamily,
    notes: notes || null,
    vernaculars,
    page: block.page,
    raw: text,
  };
}

// ---------------------------------------------------------------------- main

function main() {
  const pages = JSON.parse(fs.readFileSync(IN, 'utf8'));
  const sections = findSections(pages);

  const I = parsePartI(pages, sections.partI);
  const II = parsePartII(pages, sections.partII);

  // The book abbreviates repeated genera ("A. ASPERA" under ACHYRANTHES) and
  // states the family once, on the genus line. Carry both down to the species.
  let genus = null;
  let genusFamily = null;
  for (const e of II.entries) {
    const abbr = /^([A-Z])\.\s+(.*)$/.exec(e.name);
    const continuesGenus = abbr && genus && genus[0].toUpperCase() === abbr[1];

    if (continuesGenus) {
      e.abbreviated = e.name;
      e.name = genus + ' ' + abbr[2];
    } else {
      // A new genus resets the inherited family, so a familyless species line
      // never picks up the previous genus's family by accident.
      genus = e.name.replace(/^[A-Z]\.\s+/, '').split(/\s+/)[0];
      genusFamily = e.family || null;
    }
    e.genus = genus;
    e.nameDisplay = displayBinomial(e.name);
    if (!e.family && genusFamily) {
      e.family = genusFamily;
      e.familySource = 'inherited';
    }
  }

  const issues = [...I.issues, ...II.issues];
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'part1-vernacular.json'), JSON.stringify(I.entries, null, 1));
  fs.writeFileSync(path.join(OUT_DIR, 'part2-scientific.json'), JSON.stringify(II.entries, null, 1));
  fs.writeFileSync(path.join(OUT_DIR, 'issues.json'), JSON.stringify(issues, null, 1));

  const flagged = I.entries.filter((e) => e.flags.length).length;
  const families = [...new Set(II.entries.map((e) => e.family).filter(Boolean))];
  const report = {
    generated: new Date().toISOString(),
    pages: pages.length,
    partI: {
      pdfPages: [sections.partI[0] + 1, sections.partI[1] + 1],
      entries: I.entries.length,
      unparsedLines: I.issues.length,
      flagged,
    },
    partII: {
      pdfPages: [sections.partII[0] + 1, sections.partII[1] + 1],
      entries: II.entries.length,
      unparsedBlocks: II.issues.length,
      withFamily: II.entries.filter((e) => e.family).length,
      withNotes: II.entries.filter((e) => e.notes).length,
      families: families.length,
      unmatchedFamilies: [...new Set(
        II.entries.filter((e) => e.unresolvedFamily).map((e) => e.unresolvedFamily)
      )],
    },
    flagCounts: I.entries.reduce((acc, e) => {
      e.flags.forEach((f) => { acc[f] = (acc[f] || 0) + 1; });
      return acc;
    }, {}),
  };
  fs.writeFileSync(path.join(OUT_DIR, 'parse-report.json'), JSON.stringify(report, null, 2));

  console.log('Part I  pp.' + report.partI.pdfPages.join('-') + '  ' +
    I.entries.length + ' entries, ' + I.issues.length + ' unparsed lines, ' + flagged + ' flagged');
  console.log('Part II pp.' + report.partII.pdfPages.join('-') + '  ' +
    II.entries.length + ' entries, ' + II.issues.length + ' unparsed blocks, ' +
    report.partII.withFamily + ' with family, ' + families.length + ' families');
}

main();
