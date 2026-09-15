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
const HOCR = require('./lib/hocr');
const CORR = require('./lib/corrections');
const ALIGN = require('./lib/align');
const WRITE = require('./lib/write');

const ROOT = path.join(__dirname, '..');
const IN = path.join(ROOT, 'data', 'raw', 'pages.json');
const OUT_DIR = path.join(ROOT, 'data');
const IA_DIR = path.join(ROOT, 'data', 'raw', 'ia');

/**
 * Per-page word confidence from the Internet Archive's hOCR, when stage 1b has
 * fetched it. Absent is fine -- entries simply carry no confidence and the
 * pipeline falls back on its own heuristic flags.
 */
function loadConfidence(pages) {
  const file = path.join(IA_DIR, 'hocr.html');
  if (!fs.existsSync(file)) return null;

  const hocrPages = HOCR.parseHocr(fs.readFileSync(file, 'utf8'));
  const { map, offset, offsetScore } = HOCR.alignPages(hocrPages, pages);
  const aligned = map.filter((j) => j >= 0).length;

  const byPage = new Map();
  const scan = new Map();
  for (let i = 0; i < map.length; i++) {
    if (map[i] < 0) continue;
    byPage.set(i + 1, HOCR.pageConfidence(hocrPages[map[i]]));
    // The same hOCR page, kept whole: its line boxes are what let the app show
    // a reader the scanned line an entry came from.
    const hp = hocrPages[map[i]];
    if (hp.box && hp.lines.length) scan.set(i + 1, hp);
  }

  // Printed page numbers, so entries can be cited as the book paginates them.
  let printed = null;
  const pnFile = path.join(IA_DIR, 'page_numbers.json');
  if (fs.existsSync(pnFile)) {
    printed = new Map();
    for (const p of (JSON.parse(fs.readFileSync(pnFile, 'utf8')).pages || [])) {
      if (p.pageNumber != null) printed.set(p.leafNum, String(p.pageNumber));
    }
  }

  return { byPage, scan, printed,
    stats: { hocrPages: hocrPages.length, aligned, offset, offsetScore } };
}

// ------------------------------------------------- locating entries on the scan

/**
 * How much of the page to leave around a box, as a fraction of the page.
 *
 * Enough to clear the ascenders and descenders the engine's own box sometimes
 * clips, and no more: on a 3,205-pixel leaf a line is about 40 pixels tall, so
 * a larger vertical pad starts showing slices of the neighbouring entries.
 */
const PAD_X = 0.008;
const PAD_Y = 0.003;

/**
 * A pixel box on the scan, as fractions of the page.
 *
 * Fractions rather than pixels because the Internet Archive serves several
 * sizes of each leaf and the app should be free to pick one; the hOCR happens
 * to be in the full-size leaf's own pixels, but nothing downstream should
 * depend on that.
 */
function normalise(box, page) {
  const W = page.box[2];
  const H = page.box[3];
  // Three places is about two pixels on a 1945-pixel leaf -- far finer than the
  // padding either side, and it keeps thousands of these out of the payload.
  const r = (n) => Math.round(n * 1e3) / 1e3;
  const clamp = (n) => Math.min(1, Math.max(0, n));
  const x0 = clamp(box[0] / W - PAD_X);
  const y0 = clamp(box[1] / H - PAD_Y);
  const x1 = clamp(box[2] / W + PAD_X);
  const y1 = clamp(box[3] / H + PAD_Y);
  return [r(x0), r(y0), r(x1 - x0), r(y1 - y0)];
}

/** A box that is obviously not one entry of an index page. */
const implausible = (b) => b[2] < 0.05 || b[3] < 0.004 || b[3] > 0.6;

/**
 * Page furniture: the folio at the head of the page, the printer's signature
 * ("8956——4") at the foot, the single letter that opens an alphabet section.
 * A spanning entry must not absorb one into its box.
 */
const furniture = (line) => {
  const t = line.text.replace(/\s+/g, '');
  return t.length <= 8 && /^[^A-Za-z]*[A-Za-z]?[^A-Za-z]*$/.test(t);
};

/**
 * Find the scanned line each entry was printed on.
 *
 * Both sequences are in reading order -- the parser reads the same text layer
 * the engine produced -- so they are aligned rather than matched one by one,
 * and the running head and section letter simply fall out as gaps.
 *
 * A match below `floor` is left unlocated. A box drawn round the wrong line is
 * worse than no box: the reader would be shown a line that does not say what
 * the entry says and would have no way to tell which of the two was wrong.
 *
 * @param toText  the entry text to match against a scanned line
 * @param span    true for Part II, whose entries run over several lines and so
 *                stretch from their own line to just before the next entry's
 */
function locate(conf, entries, toText, { span = false, floor = 0.5 } = {}) {
  const stats = { located: 0, unlocated: 0, noPage: 0 };
  if (!conf || !conf.scan) { stats.noPage = entries.length; return stats; }

  const byPage = new Map();
  for (const e of entries) {
    if (!byPage.has(e.page)) byPage.set(e.page, []);
    byPage.get(e.page).push(e);
  }

  for (const [page, group] of byPage) {
    const sp = conf.scan.get(page);
    if (!sp) { stats.noPage += group.length; continue; }

    const score = (e, l) => ALIGN.prefixSimilarity(toText(e), l.text);
    const pairs = ALIGN.align(group, sp.lines, score);
    const index = new Map(sp.lines.map((l, i) => [l, i]));

    // Where each entry starts, so a spanning entry knows where the next begins.
    const starts = pairs
      .filter(([e, l]) => e && l && score(e, l) >= floor)
      .map(([e, l]) => [e, index.get(l)]);

    for (let k = 0; k < starts.length; k++) {
      const [e, i] = starts[k];
      let last = i;
      if (span) {
        const limit = k + 1 < starts.length ? starts[k + 1][1] - 1 : sp.lines.length - 1;
        while (last < limit && !furniture(sp.lines[last + 1])) last++;
      }
      const box = normalise(sp.lines.slice(i, last + 1).map((l) => l.box).reduce((a, b) => [
        Math.min(a[0], b[0]), Math.min(a[1], b[1]),
        Math.max(a[2], b[2]), Math.max(a[3], b[3]),
      ]), sp);
      if (implausible(box)) continue;
      e.box = box;
      stats.located++;
    }
  }
  stats.unlocated = entries.length - stats.located - stats.noPage;
  return stats;
}

/** Page pixel dimensions, so the app knows each leaf's aspect ratio. */
function scanPages(conf) {
  const out = {};
  if (!conf || !conf.scan) return out;
  for (const [page, sp] of conf.scan) out[page] = [sp.box[2], sp.box[3]];
  return out;
}

/**
 * Confidence for a headword: the lowest the engine gave any of its words.
 * Returns null when the word cannot be located on the page, so "unknown" is
 * never silently reported as "fine".
 */
function lookupConfidence(conf, page, text) {
  if (!conf) return null;
  const table = conf.byPage.get(page);
  if (!table) return null;
  const tokens = text.split(/[\s-]+/)
    .map((t) => t.replace(/[^A-Za-zÀ-ÿ]/g, '').toLowerCase())
    .filter(Boolean);
  if (!tokens.length) return null;

  let worst = null;
  for (const t of tokens) {
    const hit = table.get(t);
    if (!hit) return null;                       // unmatched: do not pretend
    if (worst === null || hit.conf < worst) worst = hit.conf;
  }
  return worst;
}

// ---------------------------------------------------------------- boundaries

/** Locate the two halves by their known first entries rather than page numbers. */
function findSections(pages) {
  const findPage = (re) => pages.findIndex((p) => p.lines.some((l) => re.test(l)));
  const partIStart = findPage(/^\s*AAGAO,/);
  // Part II opens with ABROMA ALATA, not with ACHRAS SAPOTA -- the latter is
  // merely the first entry on the *second* page of Part II. Anchoring on it
  // left Part II's opening page inside Part I, where its multi-line entries
  // parsed into nonsense ("ABROMA ALATA" with the taxon "Blanco.
  // (Sterculiaceae.) Shrubs, the roots and bark some-"). The "PART II" heading
  // itself is unusable: the scan renders it as "easn)ceBaiabe".
  let partIIStart = findPage(/^\s*ABROMA\s+ALATA/i);
  if (partIIStart < 0) partIIStart = findPage(/^\s*ACHRAS\s+SAPOTA/i);
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
const LOC_SLOT = '(?:Sp\\.\\s*-?\\s*Fil|[A-Za-z0-9\\[\\]|\'][A-Za-z0-9\\[\\]|\']{0,4})';

/**
 * What sits between the dialect and the genus.
 *
 * Normally one space. But the scan leaves debris there -- the printer's rule, a
 * stray asterisk, a hyphen from a broken line: "T.- Cynomorium", "T.* Boletus",
 * "Pamp.~ Urena", "V..Parameria", "(Tayabas) ?%. Calamus".
 *
 * That tolerance is allowed *only* after a dialect or a place, which is what
 * the lookbehind enforces. Granted unconditionally it is destructive: with no
 * dialect on the line, "AGAS-As. Scolopia" splits at the hyphen into a headword
 * AGAS and a dialect "As.", and 58 hyphenated headwords come apart that way.
 * A hyphen in a bare headword is part of the word; a hyphen after "T." is dirt.
 */
const BRIDGE =
  '(?:(?<=[.:)])\\s*[.:]?[\\s\\-*~%?=+.,;\']+' +   // after a dialect or place
  '|\\s*[.:]*\\s+)';                   // otherwise: a space, after any full stops

/** One dialect slot, for pulling `locs` apart again after the match. */
const LOC_TOKEN = new RegExp(LOC_SLOT + '\\s*[.:]\\??', 'g');

const PART_I_ENTRY = new RegExp(
  // A period inside the headword is allowed only when a letter follows it. The
  // scan drops one into the middle of a word ("Ma.arsis", "Mo.dvin",
  // "Comimpe.t"), but a period followed by a space is the one that *ends* the
  // headword, and that distinction is what stops this swallowing the name.
  '^(?<head>(?:[^.;()]|\\.(?=[A-Za-zÀ-ÿ])){2,60}?)' +      // headword (small caps in print)
  // The separator before a dialect is a comma in print; the scan also produces
  // a semicolon or a period -- "Dam6-Hia; T.", "MaracArios. Z."
  '(?<locs>(?:\\s*[,;.]\\s*' + LOC_SLOT + '\\s*[.:]\\??)+)?' + // ", T., V."
  '(?:\\s*[.:]?\\s*\\((?<place>[^)]{1,40})\\)\\s*\\.?)?' +  // " (Cagayan)."
  BRIDGE +
  // The scientific name must LOOK like one: a Titlecase genus. Without this the
  // lazy headword stops at the first space and the rest of a multi-word name is
  // swallowed into the taxon -- "AMORES SECOS, Sp.-Fil. Chrysopogon aciculatus"
  // parsed as headword "AMORES", taxon "SECOS, Sp.-Fil. Chrysopogon aciculatus".
  // Headword continuation words are set in small caps and OCR as caps (DAGAT,
  // SECOS, BABAE), so case separates the two cleanly.
  // A stray mark often clings to the front of the genus -- "'Trianthema",
  // "HEugenia", "lLeea", "-Hlaeocarpus". One such character is allowed and
  // dropped. It cannot reopen the bug above: "DAGAT" would need D-A-g, and
  // "SECOS" S-E-c, neither of which is capital-then-lowercase.
  '(?<scinoise>[A-Za-z\'‘’-]?)' +
  // ...but a word followed by a dialect marker is still part of the headword,
  // not the genus: "MApoTi, V. Habranthus" is MAPOTÍ (small caps) with dialect
  // V., not a genus "ApoTi". Without this the tolerance above would re-split
  // "AJOS-AJOS NGA MAPOTÍ" and "ANIS CÁNOT".
  '(?<sci>(?![A-Za-zÀ-ÿ\'-]+,\\s*(?:' + LOC_SLOT + ')\\s*[.:])' +
  '[A-ZÁÉÍÓÚ][a-zé][^]*)$'
);

/** Unparsed leftovers that are page furniture, not lost data. */
const FURNITURE = /^\s*(\d{1,3}|[A-Z]\.|[IVXL]+|\d+\s+\d+|8956.*)\s*$/;

function parsePartI(pages, range, conf) {
  const entries = [];
  const issues = [];
  for (let p = range[0]; p <= range[1]; p++) {
    for (const rawLine of pages[p].lines) {
      // Rule fragments and stray marks collect at the head of a line. They are
      // no part of the first headword, and left in place they stop the line
      // parsing at all: ".ManaBanaBA, T. Duabanga moluccana Blume."
      const line = N.repairOcr(rawLine).replace(/^[\s.,;:'"*~-]+/, '');
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
      // A period inside the word is always the scan's, never Merrill's: no
      // plant name in the book contains one. The grammar has to tolerate it to
      // read the line at all ("Ma.arsis"); the headword should not keep it.
      const head = N.squash(g.head)
        .replace(/\.(?=[A-Za-zÀ-ÿ])/g, '')
        .replace(/^[^A-Za-zÀ-ÿ]+/, '').replace(/[^A-Za-zÀ-ÿ]+$/, '');
      if (!head) {
        issues.push({ part: 1, page: p + 1, text: line });
        continue;
      }

      // Matched, not split. The separator is now any of ", ; ." and "Sp.-Fil."
      // contains two of those itself, so splitting on them tears it in half --
      // and leaves the separator glued to the next token, which then matches
      // nothing. Pulling each slot out by the same pattern that accepted it
      // cannot disagree with the grammar.
      const locTokens = (g.locs || '').match(LOC_TOKEN) || [];
      const dialects = locTokens.map(N.canonicalDialect).filter(Boolean);
      const unresolved = locTokens.filter((t) => !N.canonicalDialect(t));
      // Two different problems, kept apart: a marker the scan destroyed, and a
      // marker the book prints but never defines. Only the first is ours.
      const dialectsUndocumented = unresolved.filter(N.isUndocumentedDialect);
      const dialectsUnknown = unresolved.filter((t) => !N.isUndocumentedDialect(t));

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
        dialectsUndocumented: dialectsUndocumented.length ? dialectsUndocumented : undefined,
        place: g.place ? N.squash(g.place) : null,
        taxa,
        page: p + 1,
        printedPage: conf && conf.printed ? conf.printed.get(p + 1) || null : null,
        confidence: lookupConfidence(conf, p + 1, head),
        raw: line,
        flags: qualityFlags(head, taxa, dialectsUnknown, dialectsUndocumented)
          .concat(g.scinoise ? ['taxon-noise'] : []),
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
function qualityFlags(head, taxa, unknownDialects, undocumentedDialects) {
  const f = [];
  if (N.ACCENT_SUSPECT.test(head)) f.push('accent-lost');
  if (/[^A-Za-zÀ-ÿ\-' ]/.test(head)) f.push('glyph-damage');
  if (unknownDialects && unknownDialects.length) f.push('dialect-unrecognised');
  // Not a defect in the reading: the book itself never says what this means.
  if (undocumentedDialects && undocumentedDialects.length) f.push('dialect-undocumented');
  if (!taxa.length || taxa.some((t) => !/^[A-Z][a-zé]/.test(t))) f.push('taxon-suspect');
  return f;
}

// ------------------------------------------------------------------ Part II

/**
 * A trailing native-name line: "Alam, T." / "Langil; Malatero." / "Lopo-lopo,
 * V.; Hangot, T." Never a head, even when the page has lost its indentation.
 */
const VERN_LINE = new RegExp(
  '^[A-Za-zé][A-Za-zé\'\\- ]{1,40}' +
  // Merrill gives a province in parentheses where he has no dialect:
  // "Arbon (Paragua); Baraybay, T." Without this the line reads as a heading
  // and becomes a junk taxon named after a native word.
  '(?:\\s*\\([^)]{2,30}\\))?\\s*' +
  '(?:,\\s*(?:' + LOC + ')\\.|;)',
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
/**
 * The scan sometimes loses the initial of an abbreviated genus, leaving the
 * line as ". ARGENTEA Blume." or ">>. MINUTIFLORA Bedd." -- which also shifts
 * it a few columns right, where it reads as a continuation line. Normalise the
 * wreckage to "?." so the rest of the parser can treat it as what it is: a
 * species under whatever genus is currently open.
 */
// The epithet after a lost initial is set in small caps, so OCR may give it a
// lowercase head ("opoRATA" for ODORATA). Allow a short lowercase run before
// the first capital; prose following a period never looks like that.
const LOST_INITIAL = /^[\s>«»'"|]*\.\s+(?=[A-ZÉ]|[a-zé]{1,3}[A-ZÉ])/;

/**
 * Sometimes the initial is not lost but destroyed -- "Pp>p>. ROLFEI Vidal.",
 * "&EES. RICINOIDES Muell. Arg." A first token carrying a non-letter, followed
 * by something epithet-shaped (two or more capitals), is the same case. Without
 * this the wreckage becomes a junk genus and the real species is orphaned under
 * it. A sound initial ("A.") and a sound genus ("ALBIZZIA.") are all letters,
 * so neither is touched.
 */
const DAMAGED_INITIAL =
  /^\s*[A-Za-z&>«»|]{0,6}[^A-Za-z\s.][A-Za-z&>«»|]{0,6}\.\s+(?=[A-Za-zé]*[A-ZÉ][A-Za-zé]*[A-ZÉ])/;

/**
 * An epithet as the scan renders it: set in small caps, so four letters or more
 * carrying at least two capitals ("SYLVESTRIS", "NuciFERA", "MACROSTEGIUM").
 * An authority never looks like this -- "Gray", "Br", "Salisb" have one capital.
 */
// Hyphens included: "LACHRYMA-JoBI" is one epithet, and without them Coix
// lachryma-jobi is not recognised as a heading at all.
const EPITHET_SHAPED = '(?=[A-Za-zé-]*[A-ZÉ][A-Za-zé-]*[A-ZÉ])[A-Za-zé-]{4,}';

/**
 * The initial can also survive as one or two *letters* -- "KE." for E.,
 * "Qa." for C. -- which DAMAGED_INITIAL misses because it looks for a
 * non-letter. A real genus is never one or two letters, so a short all-letter
 * token before the period, followed by something epithet-shaped, is the same
 * case. Kept separate from DAMAGED_INITIAL so the length bound stays explicit.
 */
const SHORT_INITIAL = new RegExp('^\\s*[A-Za-z]{1,2}\\.\\s+(?=' + EPITHET_SHAPED + ')');

/**
 * And sometimes the initial vanishes entirely, leaving the epithet indented a
 * few columns where the "I." used to be:
 *
 *     I. BATATAS L. The sweet potato.
 *         MARIANENSIS Chois. Tugui-tuguian, T.      <- was "I. MARIANENSIS"
 *
 * A genus heading is set flush left and carries either a second capitalised
 * word ("ISCHAEMUM CILIARE") or a parenthesised family ("INDIGOFERA.
 * (Leguminosae.)"). A *shifted* line with one all-caps word followed by a
 * Titlecase authority is therefore a species that lost its initial. Requiring
 * the indent keeps genuine flush-left headings out of this.
 */
const SHIFTED_EPITHET = /^\s{1,4}(?=[A-ZÉ]{4,}\s+[A-ZÉ][a-zé.])/;

const normaliseLostInitial = (line) => {
  if (LOST_INITIAL.test(line)) return line.replace(LOST_INITIAL, '?. ');
  if (DAMAGED_INITIAL.test(line)) return line.replace(DAMAGED_INITIAL, '?. ');
  if (SHORT_INITIAL.test(line)) return line.replace(SHORT_INITIAL, '?. ');
  if (SHIFTED_EPITHET.test(line)) return line.replace(SHIFTED_EPITHET, '?. ');
  return line;
};

function isPartIIHead(line) {
  // Continuations sit at six columns or more; a head knocked three columns
  // right by a lost initial must not be mistaken for one.
  if (/^\s{5,}/.test(line)) return false;
  const t = normaliseLostInitial(line).trim();
  if (!t || FURNITURE.test(t)) return false;
  if (/^[a-zé]/.test(t)) return false;                    // wrapped prose
  if (VERN_LINE.test(t)) return false;                    // native-name list

  const tokens = t.split(/\s+/);
  const first = tokens[0];
  if (/^[A-Z?]\.$/.test(first)) return true;              // "A. ASPERA Linn."

  const letters = first.replace(/[^A-Za-z]/g, '');
  if (letters.length < 3) return false;
  const upper = (letters.match(/[A-Z]/g) || []).length;
  if (upper >= 2) return true;                            // caps or mangled small caps
  if (!/^[A-Z][a-zé]/.test(first)) return false;

  // Titlecase genus standing alone ("Cyperus.", "Agaricus.", "Berrya.").
  // The period matters: a heading's first token ends in one, while a wrapped
  // native-name list ends its first token with a comma or semicolon
  // ("Mobóti, V.;", "Cachtimba, Il.;", "Pamp.; Ligos;"). Without that test
  // those lines become headings, and -- worse -- the genus for every
  // abbreviated species beneath them, giving taxa like "Mobóti bunius"
  // where the book says Antidesma bunius.
  if (/\.$/.test(first) && /^[(A-Z]/.test(tokens[1] || '')) return true;

  // A Titlecase genus carries no period when the epithet follows it directly:
  // "Cocos NuciFERA Linn." That is still a heading, and the epithet is what
  // says so -- small caps, so two or more capitals. "Mobóti, V.;" fails it,
  // because "V.;" is one capital in two characters.
  return new RegExp('^' + EPITHET_SHAPED + '$').test((tokens[1] || '').replace(/[.,;]+$/, ''));
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

/**
 * Two entries sometimes land on one OCR line -- "A. LUCIDA Benth. Tinaqui, V.
 * A. ODORATISSIMA Benth." -- and the second is then swallowed as part of the
 * first. Split on an interior abbreviated genus.
 *
 * The trap is the authority: "AFZELIA BIJUGA A. Gray." has the same shape. What
 * separates them is that an epithet is set in small caps, so OCR gives it two or
 * more capitals ("ODORATISSIMA", "LucipA"), while an author is Titlecase with
 * exactly one ("Gray", "Br", "DC").
 */
const RUN_TOGETHER = /\s([A-Z?])\.\s+(?=[A-Za-zé]*[A-ZÉ][A-Za-zé]*[A-ZÉ])([A-Za-zé]{4,})(?=[\s.,;])/;

function splitRunTogether(block) {
  const out = [];
  let text = block.lines.join('\n');

  // Repeat: three or four short entries can share one OCR line.
  for (;;) {
    const m = RUN_TOGETHER.exec(text);
    // Only split well past the start, or the entry's own heading would be cut.
    if (!m || m.index < 15) break;
    out.push({ page: block.page, lines: [text.slice(0, m.index)] });
    text = text.slice(m.index).trim();
  }

  out.push({ page: block.page, lines: [text] });
  return out;
}

/**
 * Where a page's left margin actually is.
 *
 * Some pages come out of the scan uniformly indented -- page 127 sits sixteen
 * columns in, page 149 six -- and indentation is what marks a continuation
 * line, so the margin has to be measured rather than assumed to be zero.
 *
 * Not the plain minimum: one stray fragment at column 0 (page 149 has
 * "i ia  Atimon, V.; ...") would put the margin there and dedent nothing,
 * swallowing the whole page into the previous entry. Take instead the smallest
 * indent that recurs, which an isolated artefact never does.
 */
function pageMargin(indents) {
  if (!indents.length) return 0;
  const counts = new Map();
  for (const i of indents) counts.set(i, (counts.get(i) || 0) + 1);
  const threshold = Math.max(2, Math.ceil(indents.length * 0.1));
  const recurring = [...counts.entries()]
    .filter(([, n]) => n >= threshold)
    .map(([i]) => i);
  return recurring.length ? Math.min(...recurring) : Math.min(...indents);
}

function parsePartII(pages, range) {
  const entries = [];
  const issues = [];
  let block = null;

  const flush = () => {
    if (!block) return;
    for (const piece of splitRunTogether(block)) {
      const parsed = parsePartIIBlock(piece);
      if (parsed) entries.push(parsed);
      else issues.push({ part: 2, page: piece.page, text: piece.lines.join(' ').slice(0, 300) });
    }
    block = null;
  };

  for (let p = range[0]; p <= range[1]; p++) {
    // Some pages come out of the scan uniformly indented -- Part II's opening
    // page sits about sixteen columns in. Indentation only means "continuation"
    // relative to the page's own left margin, so measure it and dedent first,
    // or every line on such a page reads as a continuation and the entries are
    // swallowed by whatever preceded them.
    const indents = pages[p].lines
      .filter((l) => l.trim().length >= 20)
      .map((l) => l.match(/^\s*/)[0].length);
    const margin = pageMargin(indents);

    for (const rawLine of pages[p].lines) {
      if (!rawLine.trim()) continue;
      const dedented = normaliseLostInitial(rawLine.slice(margin));
      const t = N.repairOcr(dedented);
      if (FURNITURE.test(t)) continue;
      if (isPartIIHead(dedented)) {
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

  const abbreviated = /^[A-Z?]\.$/.test(tokens[0]);
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
  const abbr = /^([A-Z?])\.\s+/.exec(text);

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

  const conf = loadConfidence(pages);
  if (conf) {
    console.log('hOCR    ' + conf.stats.hocrPages + ' scanned leaves, ' + conf.stats.aligned +
      ' aligned to our pages (offset ' + conf.stats.offset + ')');
  } else {
    console.log('hOCR    not fetched - run `npm run fetch-ia` for per-word confidence');
  }

  const I = parsePartI(pages, sections.partI, conf);

  // Hand-read headwords, from the page images. These override the scan.
  const corrI = CORR.load(fs, path, path.join(OUT_DIR, 'corrections', 'part1'));
  const resI = CORR.applyPartI(corrI, I.entries);
  if (corrI) {
    console.log('Fixes I ' + resI.applied + ' headwords corrected, ' +
      corrI.files + ' pages transcribed' +
      (resI.stale.length ? '  (' + resI.stale.length + ' stale)' : ''));
    for (const s of resI.stale.slice(0, 5)) {
      console.log('          stale: p.' + s.page + ' "' + s.was + '" -> "' + s.headword + '"');
    }
  }

  // Third pass: the scientific names printed on Part I lines. Keyed off the
  // headword corrections above, so it runs after them.
  const corrT = CORR.load(fs, path, path.join(OUT_DIR, "corrections", "taxa"));
  const resT = CORR.applyPartITaxa(corrT, I.entries);
  if (corrT) {
    console.log("Fixes T " + resT.applied + " Part I taxon strings corrected, " +
      corrT.files + " pages transcribed" +
      (resT.stale.length ? "  (" + resT.stale.length + " stale)" : ""));
  }

  // Drop the handful of scanning artefacts a transcription marked as non-entries.
  const dropped = I.entries.filter((e) => e.drop).length;
  if (dropped) {
    I.entries = I.entries.filter((e) => !e.drop);
    console.log("        " + dropped + " non-entry line(s) dropped as scanning artefacts");
  }

  const II = parsePartII(pages, sections.partII);

  // Score Part II's headings too. They are set in roman rather than small caps,
  // which makes them the control group for how much the typeface costs us.
  for (const e of II.entries) {
    e.confidence = lookupConfidence(conf, e.page, e.name.replace(/^[A-Z]\.\s+/, ''));
    e.printedPage = conf && conf.printed ? conf.printed.get(e.page) || null : null;
  }

  // Hand-read scientific names, before the genus expansion below -- a correction
  // may repair the very genus that later lines abbreviate to an initial.
  const corrII = CORR.load(fs, path, path.join(OUT_DIR, 'corrections', 'part2'));
  const resII = CORR.applyPartII(corrII, II.entries);
  if (corrII) {
    console.log('Fixes II ' + resII.applied + ' scientific names corrected, ' +
      corrII.files + ' pages transcribed' +
      (resII.stale.length ? '  (' + resII.stale.length + ' stale)' : ''));
    for (const s of resII.stale.slice(0, 5)) {
      console.log('          stale: p.' + s.page + ' "' + s.was + '" -> "' + s.name + '"');
    }
  }

  // Scan fragments that became entries: a block that is one word and nothing
  // else -- no family, no note, no native names. A real Part II entry always
  // carries something after its name, because that is what the entry is for.
  //
  // This runs *after* the corrections, which is the whole point. The same shape
  // occurs legitimately where the scan destroyed a real line and a transcription
  // rescued it: page 136 reads "San-Antonio." and is really "B. tomentosa".
  // Dropped before corrections, that entry goes too; dropped after, a claimed
  // line has already been repaired and only the unclaimed ones fall away.
  //
  // They are not merely noise in the index. A lone token has two capitals in
  // its first word often enough to read as a genus heading, and a genus heading
  // resets the open genus below -- so "PipaV:" sat between SEMECARPUS and its
  // own "?. PERROTTETII", and eight native names ended up pointing at a plant
  // called "Pipav: perrottetii".
  const fragment = (e) => !/\s/.test(e.raw.trim()) && !e.corrected &&
    !e.family && !e.notes && !(e.vernaculars && e.vernaculars.length);
  const fragments = II.entries.filter(fragment);
  if (fragments.length) {
    II.entries = II.entries.filter((e) => !fragment(e));
    console.log('        ' + fragments.length + ' Part II fragment(s) dropped: ' +
      fragments.map((e) => 'p.' + e.page + ' "' + e.name + '"').join(', '));
  }

  // The book abbreviates repeated genera ("A. ASPERA" under ACHYRANTHES) and
  // states the family once, on the genus line. Carry both down to the species.
  let genus = null;
  let genusFamily = null;
  for (const e of II.entries) {
    const abbr = /^([A-Z?])\.\s+(.*)$/.exec(e.name);
    // An abbreviated name is a continuation by definition, so its initial need
    // not match the open genus. Requiring a match was worse than useless: where
    // the genus heading itself was misread ("TrpoMoEA" for IPOMOEA) every "I."
    // species under it failed the check and reset the genus to its own epithet,
    // giving "Hederacea marianensis". Corrections repair the heading, and are
    // applied before this runs, so the expansion then names them correctly.
    const continuesGenus = Boolean(abbr && genus);

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

  // Where each entry sits on the scanned leaf. Last, so that a Part II entry is
  // located by the name a correction gave it rather than the scan's reading --
  // the alignment is against the scan either way, and the corrected name is the
  // better query when the scan's own reading was nonsense.
  const locI = locate(conf, I.entries, (e) => e.raw);
  const locII = locate(conf, II.entries, (e) => e.raw, { span: true });
  const scanned = scanPages(conf);
  if (conf) {
    const pct = (n, of) => of ? (100 * n / of).toFixed(1) + '%' : '0%';
    console.log('Scan    ' + (locI.located + locII.located) + ' entries located on the page images (' +
      pct(locI.located, I.entries.length) + ' of Part I, ' +
      pct(locII.located, II.entries.length) + ' of Part II)');
  }

  const issues = [...I.issues, ...II.issues];
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'scan-pages.json'), JSON.stringify(scanned, null, 1));
  fs.writeFileSync(path.join(OUT_DIR, 'part1-vernacular.json'), JSON.stringify(I.entries, null, 1));
  fs.writeFileSync(path.join(OUT_DIR, 'part2-scientific.json'), JSON.stringify(II.entries, null, 1));
  fs.writeFileSync(path.join(OUT_DIR, 'issues.json'), JSON.stringify(issues, null, 1));

  const flagged = I.entries.filter((e) => e.flags.length).length;
  const families = [...new Set(II.entries.map((e) => e.family).filter(Boolean))];
  const report = {
    generated: new Date().toISOString(),
    pages: pages.length,
    corrections: {
      partI: { applied: resI.applied, stale: resI.stale.length, pages: corrI ? corrI.files : 0 },
      partII: { applied: resII.applied, stale: resII.stale.length, pages: corrII ? corrII.files : 0 },
    },
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
    scan: {
      pages: Object.keys(scanned).length,
      partI: locI,
      partII: locII,
    },
    flagCounts: I.entries.reduce((acc, e) => {
      e.flags.forEach((f) => { acc[f] = (acc[f] || 0) + 1; });
      return acc;
    }, {}),
  };
  WRITE.writeJson(fs, path.join(OUT_DIR, 'parse-report.json'), report, { stamp: 'generated', space: 2 });

  console.log('Part I  pp.' + report.partI.pdfPages.join('-') + '  ' +
    I.entries.length + ' entries, ' + I.issues.length + ' unparsed lines, ' + flagged + ' flagged');
  console.log('Part II pp.' + report.partII.pdfPages.join('-') + '  ' +
    II.entries.length + ' entries, ' + II.issues.length + ' unparsed blocks, ' +
    report.partII.withFamily + ' with family, ' + families.length + ' families');
}

// Run as a stage, or require as a library. The second is what lets the entry
// grammar be tested against real failing lines instead of reasoned about.
if (require.main === module) main();

module.exports = { PART_I_ENTRY, LOC_SLOT, FURNITURE, parsePartI, findSections };
