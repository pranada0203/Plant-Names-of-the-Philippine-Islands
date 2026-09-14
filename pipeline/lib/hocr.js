'use strict';
/**
 * Reading the Internet Archive's hOCR.
 *
 * The IA's text is the same Tesseract run that is embedded in the PDF, so it
 * adds no new words. What it does add is what the engine thought of each one:
 * a per-word confidence (`x_wconf`) and a bounding box on the scanned page.
 *
 * That turns quality from something the pipeline guesses at into something the
 * OCR engine reported. It knew "fprz" was a bad reading -- it scored it 9 out
 * of 100, against 92 for "Afzelia" on the same line.
 *
 * The boxes are what lets the app show the reader the scanned line itself. They
 * are in the pixel space of the JP2 Tesseract ran on, and the JPEG the Internet
 * Archive serves for a leaf has exactly those dimensions -- leaf n18 is 1945 by
 * 3205, and so is hOCR page 19 -- but the IA also serves downscaled variants, so
 * boxes are normalised to fractions of the page before they leave the pipeline.
 */

const WORD_RE =
  /class="ocrx_word"[^>]*title="bbox (\d+) (\d+) (\d+) (\d+); x_wconf (\d+)[^"]*"[^>]*>([^<]*)</g;

// Tesseract sets a line's text on four different classes; a page's running head
// is an ocr_header and a plate caption an ocr_caption, and both are lines a
// reader might want to see.
const LINE_SPLIT = /class="ocr_(?:line|header|caption|textfloat)"/;
const PAGE_BOX_RE = /title="[^"]*\bbbox (\d+) (\d+) (\d+) (\d+)/;

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
const decode = (s) => s.replace(/&(?:amp|lt|gt|quot|#39);/g, (e) => ENTITIES[e]);

/** Every ocrx_word in a chunk of markup, in document order. */
function wordsIn(chunk) {
  const words = [];
  WORD_RE.lastIndex = 0;
  let m;
  while ((m = WORD_RE.exec(chunk)) !== null) {
    const text = decode(m[6]).trim();
    if (!text) continue;
    words.push({
      text,
      conf: Number(m[5]),
      bbox: [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])],
    });
  }
  return words;
}

/** Smallest box containing all of `boxes`. */
function union(boxes) {
  return boxes.reduce((a, b) => [
    Math.min(a[0], b[0]), Math.min(a[1], b[1]),
    Math.max(a[2], b[2]), Math.max(a[3], b[3]),
  ]);
}

/**
 * Parse hOCR into one record per page.
 *
 * `lines` are sorted into reading order, top to bottom, which is *not* always
 * the order the markup lists them in: Tesseract emits its blocks in the order
 * it segmented them, and a stray mark can arrive last while sitting near the
 * top of the page. Page 145 has a two-character speck at 46% down the leaf
 * listed after the final line, and taking the markup's order at face value
 * stretched the last entry's box back up the page to swallow it.
 *
 * A line's box is computed from its words rather than read from its own title:
 * Tesseract sometimes stretches a line box around a stray mark it then assigns
 * to no word, and a box drawn round nothing is worse than no box. Word spans
 * occur only inside line spans, so splitting the page on the line classes
 * partitions the words exactly.
 *
 * @returns {{box:number[], words:object[], lines:{text:string,box:number[],words:object[]}[]}[]}
 */
function parseHocr(html) {
  return html.split('class="ocr_page"').slice(1).map((chunk) => {
    const pageBox = PAGE_BOX_RE.exec(chunk);
    const lines = [];
    for (const part of chunk.split(LINE_SPLIT).slice(1)) {
      const words = wordsIn(part);
      if (!words.length) continue;
      lines.push({
        text: words.map((w) => w.text).join(' '),
        box: union(words.map((w) => w.bbox)),
        words,
      });
    }
    lines.sort((a, b) => (a.box[1] - b.box[1]) || (a.box[0] - b.box[0]));
    return {
      box: pageBox ? pageBox.slice(1, 5).map(Number) : null,
      words: wordsIn(chunk),
      lines,
    };
  });
}

/** Word-set similarity, used to line hOCR pages up with our own extraction. */
function similarity(a, b) {
  const A = new Set((a.toLowerCase().match(/[a-zà-ÿ]{4,}/g) || []));
  const B = new Set((b.toLowerCase().match(/[a-zà-ÿ]{4,}/g) || []));
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const x of A) if (B.has(x)) shared++;
  return shared / (A.size + B.size - shared);
}

/**
 * Line hOCR's pages up with ours.
 *
 * They do not have the same length -- the hOCR covers 218 scanned leaves, the
 * PDF 209 -- so the mapping is found rather than assumed. A constant offset is
 * tried first (it is the usual case) and each page is verified individually;
 * any page that does not agree is searched for in a small window.
 *
 * @returns {number[]} for each of our page indices, the hOCR page index or -1
 */
function alignPages(hocrPages, ourPages, { window = 12, floor = 0.25 } = {}) {
  const ourText = ourPages.map((p) => p.lines.join(' '));
  const hocrText = hocrPages.map((p) => p.words.map((w) => w.text).join(' '));

  // Find the offset that works best across a sample of content-bearing pages.
  const probes = ourText
    .map((t, i) => ({ i, len: t.length }))
    .filter((p) => p.len > 400)
    .filter((_, k) => k % 7 === 0);

  let bestOffset = 0;
  let bestScore = -1;
  for (let off = -window; off <= window; off++) {
    let total = 0;
    let n = 0;
    for (const p of probes) {
      const j = p.i + off;
      if (j < 0 || j >= hocrText.length) continue;
      total += similarity(ourText[p.i], hocrText[j]);
      n++;
    }
    if (n && total / n > bestScore) { bestScore = total / n; bestOffset = off; }
  }

  // Verify every page against that offset, searching nearby where it fails.
  const map = new Array(ourPages.length).fill(-1);
  for (let i = 0; i < ourPages.length; i++) {
    if (!ourText[i].trim()) continue;
    let best = -1;
    let bestSim = floor;
    for (let d = 0; d <= window; d++) {
      for (const j of d === 0 ? [i + bestOffset] : [i + bestOffset - d, i + bestOffset + d]) {
        if (j < 0 || j >= hocrText.length) continue;
        const s = similarity(ourText[i], hocrText[j]);
        if (s > bestSim) { bestSim = s; best = j; }
      }
      if (best >= 0 && d === 0 && bestSim > 0.5) break;   // clean hit, stop early
    }
    map[i] = best;
  }
  return { map, offset: bestOffset, offsetScore: bestScore };
}

/**
 * Confidence lookup for one page: token -> lowest confidence seen for it.
 * Lowest, not mean: if the same string was read twice on a page and the engine
 * doubted one of them, that doubt is the honest answer.
 */
function pageConfidence(page) {
  const byToken = new Map();
  for (const w of page.words) {
    const key = w.text.replace(/[^A-Za-zÀ-ÿ]/g, '').toLowerCase();
    if (!key) continue;
    const prev = byToken.get(key);
    if (!prev || w.conf < prev.conf) byToken.set(key, { conf: w.conf, bbox: w.bbox });
  }
  return byToken;
}

module.exports = { parseHocr, alignPages, pageConfidence, similarity };

