/**
 * Showing the reader the scanned line an entry was read from.
 *
 * Everything in this app is a transcription of a hundred-year-old scan, and
 * some of it is wrong. The honest answer to "is that really what the book
 * says?" is not a confidence score — it is the line itself, and this is what
 * puts it on screen.
 *
 * The crop is done with CSS rather than a canvas: the whole leaf is loaded as
 * one `<img>` inside a clipping box, scaled so that the entry's slice of the
 * page fills the width. That means no canvas, no CORS request, no second
 * fetch when the reader asks for the whole page, and no decoding work — and
 * two entries from the same leaf share one cached image.
 *
 * Boxes arrive as `[x, y, w, h]` fractions of the leaf (stage 2 normalises
 * them, because the Internet Archive serves several sizes of each leaf).
 */

let scan = null;

export function initScan(meta) {
  scan = meta || null;
}

/** The IA's URL for a leaf. `width` is one of the sizes it generates, or 0. */
function leafUrl(page, width) {
  if (!scan || !scan.imageUrl) return null;
  return scan.imageUrl
    .replace('{leaf}', String(page - 1))
    .replace('{width}', width ? `_w${width}` : '');
}

function viewerUrl(page) {
  if (!scan || !scan.viewer) return null;
  return scan.viewer.replace('{leaf}', String(page - 1));
}

/** Height / width of a leaf, needed to turn a fractional box into a shape. */
function aspectOf(page) {
  const dims = scan && scan.pages && scan.pages[page];
  return dims && dims[0] ? dims[1] / dims[0] : null;
}

/**
 * Position the image inside its clipping box.
 *
 * The box shows the slice `[x, y, w, h]` of the leaf. Scale the image so that
 * slice is exactly the box's width, then offset it so the slice's top-left
 * lands at the box's. Both offsets are percentages of the box, which is how
 * they stay right at every screen size:
 *
 *   image width  = box width / w
 *   image height = image width * aspect
 *   box height   = image height * h
 *   left         = -x * image width  =  -x/w  of the box's width
 *   top          = -y * image height =  -y/h  of the box's height
 *
 * Written out as numbers rather than CSS `calc()` on custom properties, which
 * needs division by a variable and is newer than it needs to be here.
 */
function placeCrop(frame, img, [x, y, w, h], aspect) {
  frame.style.aspectRatio = String(w / (h * aspect));
  img.style.width = (100 / w) + '%';
  img.style.left = (-100 * x / w) + '%';
  img.style.top = (-100 * y / h) + '%';
}

/**
 * Whole-leaf view: drop the crop entirely rather than treating the page as a
 * box of [0, 0, 1, 1].
 *
 * Cropping to the whole page would size the frame from its *width*, which on a
 * desktop gives a leaf eleven hundred pixels tall that the reader has to scroll
 * past to reach the rest of the entry. Clearing these lets the stylesheet size
 * the image by height instead, so the page arrives whole and in view.
 */
function placeWhole(frame, img) {
  frame.style.aspectRatio = '';
  img.style.width = '';
  img.style.left = '';
  img.style.top = '';
}

/**
 * A figure showing one line (or block) of the scan, with a control to pull
 * back to the whole leaf.
 *
 * Returns null when the entry could not be located on the scan — about one
 * Part I line in a thousand and one Part II block in twenty. Stage 2 would
 * rather say nothing than box the wrong line, so this says nothing too.
 *
 * @param {{page:number, printedPage?:string, box?:number[]}} sighting
 * @param {string} alt  what the line says, for anyone not looking at it
 */
export function scanFigure(sighting, alt) {
  if (!sighting || !sighting.box || !scan) return null;
  const aspect = aspectOf(sighting.page);
  const src = leafUrl(sighting.page, (scan.widths && scan.widths[0]) || 0);
  if (!aspect || !src) return null;

  const fig = document.createElement('figure');
  fig.className = 'scan';

  const frame = document.createElement('div');
  // The leaf is a few hundred kilobytes from another continent; say something
  // while it travels rather than showing an empty rectangle that reads as
  // "this line is missing".
  frame.className = 'scan-frame loading';

  const img = document.createElement('img');
  img.alt = alt ? `Scan of the line reading: ${alt}` : 'The line as printed';
  img.loading = 'lazy';
  img.decoding = 'async';
  img.src = src;
  img.addEventListener('load', () => frame.classList.remove('loading'));
  // The Archive may be unreachable, or blocked. Say so rather than leaving a
  // silent empty rectangle that looks like the line is missing from the book.
  img.addEventListener('error', () => {
    frame.classList.remove('loading');
    frame.classList.add('failed');
    frame.style.aspectRatio = 'auto';
    frame.textContent = 'The page image could not be loaded from the Internet Archive.';
  }, { once: true });

  placeCrop(frame, img, sighting.box, aspect);
  frame.append(img);
  fig.append(frame);

  const cap = document.createElement('figcaption');
  let whole = false;
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'scan-toggle';
  toggle.textContent = 'Whole page';
  toggle.addEventListener('click', () => {
    whole = !whole;
    toggle.textContent = whole ? 'Just this line' : 'Whole page';
    fig.classList.toggle('scan-whole', whole);
    // The master scan, only once the reader has asked to read the whole leaf;
    // the line crop never needs that much of it.
    if (whole && img.dataset.full !== '1') {
      img.dataset.full = '1';
      const full = leafUrl(sighting.page, 0);
      if (full) img.src = full;
    }
    if (whole) placeWhole(frame, img);
    else placeCrop(frame, img, sighting.box, aspect);
  });
  cap.append(toggle);

  const where = document.createElement('span');
  where.className = 'scan-where';
  where.textContent = sighting.printedPage
    ? `page ${sighting.printedPage}, leaf ${sighting.page}`
    : `leaf ${sighting.page}`;
  cap.append(where);

  const href = viewerUrl(sighting.page);
  if (href) {
    const a = document.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = 'Internet Archive';
    cap.append(a);
  }

  fig.append(cap);
  return fig;
}

/** True when anything can be shown at all — the payload may predate stage 2's boxes. */
export const scanAvailable = () => Boolean(scan && scan.imageUrl && scan.pages);
