#!/usr/bin/env node
'use strict';
/**
 * Draw the app's icons.
 *
 *   npm run icons
 *
 * The mark is a single leaf, because the book is a botanical dictionary and a
 * leaf is the one shape that reads at 32 pixels as well as at 512. Its outline
 * is the lens between two overlapping circles, which gives the pointed tips a
 * leaf has and an ellipse does not, and which is two arcs in SVG as well.
 *
 * The art sits inside the central 66% of the canvas, so the same file serves as
 * a `maskable` icon: Android crops installed icons to whatever shape the launcher
 * uses, and anything outside a circle of 80% of the width can be cut away. The
 * indigo runs to all four edges, which is what a maskable icon wants -- crop it
 * to a circle, a squircle or a teardrop and the ground simply continues.
 *
 * Colours are the masthead's, not the page's: the tile is the dye and the leaf
 * is what is reversed out of it, so the installed icon and the bar at the top of
 * the app are recognisably the same object. It is also the higher-contrast way
 * round -- cream on indigo is 9.9:1, where the old red leaf on cream was 6.6:1,
 * and at 32 pixels a favicon is mostly asking to be told apart from its
 * neighbours in a row of tabs.
 */
const fs = require('fs');
const path = require('path');
const { encodePng } = require('./lib/png');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'app', 'assets');

// The names are the roles, not the hues: GROUND is the tile, MARK is the leaf
// drawn on it, and RIB is knocked back out of the leaf. RIB is the ground's own
// colour, so a vein reads as a gap in the leaf rather than a line painted over
// it -- the same trick as before, with the light and dark ends swapped.
const GROUND = [0x24, 0x39, 0x5c];  // --tayum, the indigo tile
const MARK = [0xf3, 0xed, 0xe0];    // --on-dye, the leaf
const RIB = [0x24, 0x39, 0x5c];     // --tayum again, knocked out of the leaf

// Leaf geometry, as fractions of the canvas. The lens between two circles of
// radius R centred at (0, +/-C) in the leaf's own frame: half-length is
// sqrt(R^2 - C^2) and half-width is R - C.
const R = 0.438;
const C = 0.288;
const TILT = 35 * Math.PI / 180;    // pointing up and to the right
const HALF_LEN = Math.sqrt(R * R - C * C);

const RIB_W = 0.011;      // midrib half-thickness
const VEIN_W = 0.008;
const VEIN_REACH = 0.62;  // of the leaf's half-width where the vein ends
const MIDRIB_END = 0.80;  // of the half-length; the rest of the tip stays solid
const STEM_W = 0.013;
const STEM_LEN = 0.12;

/** Distance from p to the segment ab. */
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  const qx = ax + t * dx;
  const qy = ay + t * dy;
  return Math.hypot(px - qx, py - qy);
}

/**
 * Colour of the drawing at (x, y), both in [-0.5, 0.5] with y downward.
 * Returns null for "background".
 */
function sample(x, y) {
  // Into the leaf's own frame: u along the leaf, v across it.
  const cos = Math.cos(TILT);
  const sin = Math.sin(TILT);
  const u = x * cos - y * sin;
  const v = x * sin + y * cos;

  const inLeaf = (u * u + (v - C) * (v - C) <= R * R) &&
                 (u * u + (v + C) * (v + C) <= R * R);

  // The stem runs on past the lower tip, so it is drawn whether or not the
  // point is inside the outline.
  const base = -HALF_LEN;
  if (!inLeaf) {
    const d = distToSegment(u, v, base, 0, base - STEM_LEN, 0);
    return d <= STEM_W ? MARK : null;
  }

  // Midrib. It stops short of the tip: the leaf is narrower than the rib there,
  // so running it all the way dissolves the point into the background and the
  // silhouette loses the one feature that makes it a leaf rather than an eye.
  if (distToSegment(u, v, -HALF_LEN, 0, HALF_LEN * MIDRIB_END, 0) <= RIB_W) return RIB;

  // Four pairs of veins, leaving the midrib towards the tip. Each one ends at
  // a fixed fraction of the leaf's half-width *where it ends*, not where it
  // starts, which is what keeps it inside: the outline is a lens and so convex,
  // so a segment between two interior points is wholly interior.
  //
  // That is necessary but not sufficient, and the difference used to be
  // invisible. A vein is a stroke, so it reaches VEIN_W beyond its own
  // endpoint, and near the tip the lens narrows faster than the veins shorten:
  // at the old spacing the fourth pair ended where the leaf was thinner than
  // the stroke, and cut clean across the point. It went unnoticed for as long
  // as the knockout was near enough to the background to be lost against it --
  // once the tile became indigo, the same overrun read as a notch out of the
  // leaf with a detached speck beyond it. The spacing below gives every pair
  // room; the guard makes a future one that does not fail visibly instead of
  // silently.
  const step = (2 * HALF_LEN) / 6.5;
  for (let i = 1; i <= 4; i++) {
    const from = -HALF_LEN + i * step;
    // Leaning well forward, about 28 degrees off the midrib. At 45 degrees the
    // veins read as a herringbone rather than a leaf: the lateral component
    // maps almost entirely to screen-vertical once the leaf is tilted, and the
    // eye stops seeing which end is the tip.
    const tx = from + step * 1.5;
    const halfW = Math.sqrt(Math.max(0, R * R - tx * tx)) - C;
    if (halfW * VEIN_REACH + VEIN_W > halfW) continue;   // no room: skip the pair
    for (const side of [1, -1]) {
      if (distToSegment(u, v, from, 0, tx, side * halfW * VEIN_REACH) <= VEIN_W) return RIB;
    }
  }
  return MARK;
}

/** Render at `scale` times the size and box-filter down, for clean edges. */
function render(size, scale = 4) {
  const big = size * scale;
  const rgb = Buffer.alloc(size * size * 3);
  const acc = new Float64Array(size * size * 3);

  for (let by = 0; by < big; by++) {
    const y = (by + 0.5) / big - 0.5;
    for (let bx = 0; bx < big; bx++) {
      const x = (bx + 0.5) / big - 0.5;
      const c = sample(x, y) || GROUND;
      const i = (Math.floor(by / scale) * size + Math.floor(bx / scale)) * 3;
      acc[i] += c[0];
      acc[i + 1] += c[1];
      acc[i + 2] += c[2];
    }
  }
  const n = scale * scale;
  for (let i = 0; i < acc.length; i++) rgb[i] = Math.round(acc[i] / n);
  return encodePng(rgb, size, size);
}

/** The same leaf as vector, for the favicon: two arcs, a midrib and a stem. */
function svg() {
  const cos = Math.cos(TILT);
  const sin = Math.sin(TILT);
  // Into canvas coordinates, 0..64, y down.
  const P = (u, v) => {
    const x = u * cos + v * sin;
    const y = -(u * -sin + v * cos);
    return [(x + 0.5) * 64, (y + 0.5) * 64].map((n) => n.toFixed(2)).join(' ');
  };
  const r = (R * 64).toFixed(2);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Leaf">
  <rect width="64" height="64" fill="#24395c"/>
  <path d="M ${P(-HALF_LEN, 0)} A ${r} ${r} 0 0 1 ${P(HALF_LEN, 0)} A ${r} ${r} 0 0 1 ${P(-HALF_LEN, 0)} Z"
        fill="#f3ede0"/>
  <path d="M ${P(-HALF_LEN - STEM_LEN, 0)} L ${P(HALF_LEN, 0)}"
        stroke="#f3ede0" stroke-width="${(STEM_W * 2 * 64).toFixed(2)}" stroke-linecap="round"/>
  <path d="M ${P(-HALF_LEN, 0)} L ${P(HALF_LEN * MIDRIB_END, 0)}"
        stroke="#24395c" stroke-width="${(RIB_W * 2 * 64).toFixed(2)}" stroke-linecap="round"/>
</svg>
`;
}

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const files = [
    ['icon-192.png', render(192)],
    ['icon-512.png', render(512)],
    // iOS uses this one and rounds it itself, so it must not be transparent.
    ['apple-touch-icon.png', render(180)],
    ['favicon-32.png', render(32, 8)],
    ['favicon.svg', Buffer.from(svg(), 'utf8')],
  ];
  for (const [name, buf] of files) {
    fs.writeFileSync(path.join(OUT, name), buf);
    console.log(`${name.padEnd(22)} ${(buf.length / 1024).toFixed(1)} KB`);
  }
  console.log(`-> ${path.relative(ROOT, OUT)}`);
}

main();
