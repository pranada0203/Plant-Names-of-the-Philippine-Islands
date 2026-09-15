'use strict';
/** Shared text normalisation helpers for the Merrill 1903 pipeline. */

/** Dialect abbreviations Merrill defines on p. 9 of the introduction. */
const DIALECTS = {
  'B': 'Bicol',
  'Bis': 'Visayan',
  'Cag': 'Cagayan',
  'Ig': 'Igorrote',
  'Il': 'Ilocano',
  'Mang': 'Mangyan',
  'Neg': 'Negrito',
  'Pamp': 'Pampangan',
  'Pang': 'Pangasinan',
  'Sp': 'Spanish',
  'Sp.-Fil': 'Spanish-Filipino',
  'T': 'Tagalog',
  'V': 'Visayan',
  'Z': 'Zambales',
};

/** Regex alternation matching any dialect abbreviation, longest first. */
const DIALECT_RE = 'Sp\.\s*-?\s*Fil|Sp|Pamp|Pang|Mang|Cag|Bis|Bic|Neg|Il|Ig|[BTVZ]';

/**
 * The scan's readings of Merrill's abbreviations.
 *
 * These are not guesses. Each is a glyph confusion with one possible target,
 * checked against the page: "I]." is Il. with the l read as a bracket, "VY." is
 * V. with the serif read as a second letter, "IT." and "TI." are both T. (page
 * 110 prints TAÑGÍSAN, T. three times where the scan gives IT. and TI.).
 * "Zamb." is not damage at all -- Merrill writes Z. on page 9 and Zamb. on
 * page 110.
 *
 * `l` is the letter this scan loses most often, which is why most of the list
 * lands on Il.
 */
const DIALECT_MISREADINGS = {
  I: 'Il', 'I]': 'Il', '1]': 'Il', Ll: 'Il', Dl: 'Il', Ul: 'Il', It: 'Il',
  ll: 'Il', II: 'Il', I1: 'Il', 11: 'Il', 1: 'Il', '[Il]': 'Il',
  IT: 'T', TI: 'T', FT: 'T',
  VY: 'V', Vis: 'V',
  Zamb: 'Z',
  lg: 'Ig',
};

/**
 * Abbreviations the book prints but never defines.
 *
 * Merrill lists his twelve on page 9. These four are not among them and are
 * nonetheless printed: "DUÑGURÚÑGUT, C. Citrus hystrix DC." (page 60),
 * "ALIBÁNBAN, P., T. Bauhinia blancoi Baker." (page 14), "TAHÍT-LABÚYOC, F."
 * (page 107), "LÍPIP, A. Bauhinia." (page 75).
 *
 * They are left unresolved on purpose. C. is most likely Cagayan, which he
 * abbreviates Cag. everywhere else -- but "most likely" is not a reading, and
 * the point of separating these from the scan's damage is so that nobody later
 * mistakes a silent guess for something the book said.
 */
const UNDOCUMENTED_DIALECTS = new Set(['C', 'F', 'P', 'A']);

/** Strip the punctuation a dialect slot collects, without touching its letters. */
const bareDialect = (token) => String(token)
  .replace(/\s+/g, '')
  .replace(/^[,;.'‘’]+/, '')
  .replace(/[.:?'‘’]+$/, '');

function canonicalDialect(token) {
  const t = bareDialect(token);
  if (!t) return null;
  if (/^Sp\.?-?Fil$/i.test(t)) return 'Sp.-Fil';
  const known = Object.keys(DIALECTS).find((k) => k.toLowerCase() === t.toLowerCase());
  if (known) return known;
  return DIALECT_MISREADINGS[t] || null;
}

/** True for an abbreviation the book uses but never defines. */
const isUndocumentedDialect = (token) => UNDOCUMENTED_DIALECTS.has(bareDialect(token));

/** Collapse runs of whitespace and trim. */
const squash = (s) => s.replace(/\s+/g, ' ').trim();

/**
 * Digits never occur in these plant names, so a digit is always the scan
 * misreading a letter -- and it misreads the same ones consistently, because
 * accented vowels are what it stumbles on ("l6po-l6po" for "lopo-lopo",
 * "c4gon" for "cagon"). Folding them back makes those entries both
 * searchable and joinable across the books two halves.
 */
const OCR_DIGITS = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 6: 'o', 8: 'b', 9: 'g' };

/**
 * Fold to a search key: lowercase, strip diacritics and punctuation, and undo
 * the scan's digit-for-letter substitutions. U+FFFD (a glyph pdftotext could
 * not map) becomes \u0001, a wildcard the client matcher lets stand for any
 * single character.
 */
function searchKey(s) {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\uFFFD/g, '\u0001')
    .toLowerCase()
    .replace(/[0-9]/g, (d) => OCR_DIGITS[d] || '')
    .replace(/[^a-z\u0001]+/g, '');
}

/** URL-safe id. */
function slug(s) {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Repair the systematic typographic damage in the scan's text layer. */
function repairOcr(s) {
  return s
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2014/g, '--')
    .replace(/\s+([,.;])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The scan's OCR collapsed most accented vowels onto `é` (1,268 occurrences)
 * or onto a wrong ASCII letter. `é` inside a native name is therefore a marker
 * that an accent was present but its vowel is lost. Flag, never guess.
 */
const ACCENT_SUSPECT = /é/;

module.exports = {
  DIALECTS, DIALECT_RE, canonicalDialect, isUndocumentedDialect,
  squash, searchKey, slug, repairOcr, ACCENT_SUSPECT,
};
