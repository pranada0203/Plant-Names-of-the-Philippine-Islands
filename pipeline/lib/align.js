'use strict';
/**
 * Lining two sequences of text up with each other.
 *
 * The pipeline does this twice for different reasons: a hand transcription has
 * to be matched to the entries the parser found on the same page, and those
 * entries have to be matched to the lines the OCR engine found on the scan. In
 * both cases the two sequences are in the same order but neither is complete --
 * the parser drops lines the scan mangled, the transcription includes lines the
 * parser never produced -- so matching them by position is wrong, and matching
 * each item to its best partner independently lets one bad pair swap two
 * neighbours.
 *
 * Needleman-Wunsch gives the best *monotonic* pairing instead: a gap on either
 * side costs something, but it shifts nothing downstream.
 */

/** Fold to bare letters: case, accents and punctuation are all scan noise. */
const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Order-sensitive shared-character ratio, 0..1.
 * Cheap, and good enough: it is scoring "is this the same line of text", not
 * measuring an edit distance.
 */
function similarity(a, b) {
  const A = fold(a);
  const B = fold(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  let i = 0;
  let j = 0;
  let shared = 0;
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) { shared++; i++; j++; }
    else if (A.length - i > B.length - j) i++;
    else j++;
  }
  return (2 * shared) / (A.length + B.length);
}

/**
 * Align two sequences, returning `[a, b]` pairs in order with `null` for a gap.
 *
 * @param {Array} as
 * @param {Array} bs
 * @param {(a, b) => number} score  0..1, higher is a better match
 * @param {number} gap  cost of skipping one item; must be negative
 */
function align(as, bs, score, gap = -0.4) {
  const n = as.length;
  const m = bs.length;
  const dp = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  const bt = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1));
  for (let i = 1; i <= n; i++) { dp[i][0] = dp[i - 1][0] + gap; bt[i][0] = 1; }
  for (let j = 1; j <= m; j++) { dp[0][j] = dp[0][j - 1] + gap; bt[0][j] = 2; }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const diag = dp[i - 1][j - 1] + score(as[i - 1], bs[j - 1]);
      const up = dp[i - 1][j] + gap;
      const left = dp[i][j - 1] + gap;
      const best = Math.max(diag, up, left);
      dp[i][j] = best;
      bt[i][j] = best === diag ? 0 : best === up ? 1 : 2;
    }
  }

  const pairs = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const b = i === 0 ? 2 : j === 0 ? 1 : bt[i][j];
    if (b === 0) { pairs.push([as[i - 1], bs[j - 1]]); i--; j--; }
    else if (b === 1) { pairs.push([as[i - 1], null]); i--; }
    else { pairs.push([null, bs[j - 1]]); j--; }
  }
  return pairs.reverse();
}

/**
 * How well `text` *begins with* `line`, 0..1.
 *
 * The symmetric ratio is the wrong question when one side is known to be a
 * prefix of the other. A Part II block's text runs on past its own heading
 * into the names printed beneath it, so comparing the whole block against a
 * heading line as short as "A. PAVONINA Linn." scores 0.35 on length alone and
 * throws away a match that is plainly right. Comparing only as much of the
 * text as the line is long asks what we actually want to know.
 *
 * A line of fewer than six letters carries too little evidence to anchor
 * anything -- the single letter that opens an alphabet section would match
 * whatever followed it -- so those fall back to the symmetric ratio, which for
 * a long entry is correctly near zero.
 */
function prefixSimilarity(text, line) {
  const A = fold(text);
  const B = fold(line);
  if (!A || !B) return 0;
  if (B.length < 6) return similarity(A, B);
  return similarity(A.slice(0, B.length), B);
}

module.exports = { align, similarity, prefixSimilarity, fold };
