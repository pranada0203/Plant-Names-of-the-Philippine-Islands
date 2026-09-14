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
 */

const WORD_RE =
  /class="ocrx_word"[^>]*title="bbox (\d+) (\d+) (\d+) (\d+); x_wconf (\d+)[^"]*"[^>]*>([^<]*)</g;

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
const decode = (s) => s.replace(/&(?:amp|lt|gt|quot|#39);/g, (e) => ENTITIES[e]);

/**
 * Parse hOCR into one record per page.
 * @returns {{words: {text:string, conf:number, bbox:number[]}[]}[]}
 */
function parseHocr(html) {
  return html.split('class="ocr_page"').slice(1).map((chunk) => {
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
    return { words };
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
