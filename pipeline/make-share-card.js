#!/usr/bin/env node
'use strict';
/**
 * Draw the share card: one PowerPoint slide, sized for a Facebook post.
 *
 *   npm run share-card
 *
 * The right-hand third is left empty, with a dashed guide, for a phone mockup
 * to be dropped in afterwards -- both the guide and its label are meant to be
 * deleted.
 *
 * A .pptx is a ZIP of XML parts and nothing else, so this needs no library:
 * lib/zip.js does the container and the parts are template strings. Same
 * reasoning as make-icons.js drawing the icons in code -- an asset nobody can
 * regenerate goes stale the first time the palette moves, and this palette has
 * moved twice.
 *
 * The figures are read from the built payload rather than typed in here. A
 * number written into copy goes out of date silently: the browse page claimed
 * "4,391 native names for 1,669 plants" for several builds after both had
 * changed.
 *
 * Colours are the app's own tokens. Georgia rather than Source Serif 4, because
 * the file has to look right on a machine that has not installed the site's
 * font -- it is the nearest old-style face that is already everywhere, and the
 * fallback the stylesheet itself names.
 *
 * Output: docs/merrill1903-facebook.pptx, plus a pixel-accurate HTML twin in
 * .tmp/ (gitignored) emitted from the same coordinates, for checking that
 * nothing overflows without opening PowerPoint.
 */
const fs = require('fs');
const path = require('path');
const { entry, zip } = require('./lib/zip');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'merrill1903-facebook.pptx');
const PREVIEW = path.join(ROOT, '.tmp', 'merrill1903-facebook-preview.html');

const PAYLOAD = path.join(ROOT, 'app', 'data', 'dictionary.json');
const ADDRESS = 'merrill1903.vercel.app';

/* -------------------------------------------------------------- geometry */

// Facebook's shared-image size. PowerPoint measures in EMU: 914400 to the inch,
// and the web's 96 pixels to the inch makes exactly 9525 EMU per pixel, so the
// whole layout can be written in pixels and converted once.
const W = 1200;
const H = 630;
const px = (n) => Math.round(n * 9525);

// DrawingML sizes text in hundredths of a point. 96px/in over 72pt/in.
const pt = (cssPx) => Math.round(cssPx * 0.75 * 100);

/* --------------------------------------------------------------- palette */

const INDIGO = '24395C';   // --tayum
const CREAM = 'F3EDE0';    // --on-dye
const MUTED = 'A9B6CA';    // --on-dye-soft, a step further into the indigo
const GOLD = 'D9A93C';     // --apiapi
const SAPANG = '9B2D36';   // --sapang
const GREEN = '8FB08B';    // --botanic, lifted to carry on a dark ground

const FONT = 'Georgia';
const SANS = 'Segoe UI';

/* ----------------------------------------------------------------- parts */

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

let uid = 1;
const nextId = () => ++uid;

const shapes = [];

/* Every shape is emitted twice: once as DrawingML, once as HTML for the
   preview. Emitting both from the same call is what keeps them honest -- a
   preview built separately would drift from the file it claims to show. It is
   a proof that the text fits, not a pixel-exact rendering: PowerPoint and a
   browser break lines slightly differently. */
const preview = [];

/** A text box. `runs` is [{ text, size, color, bold, italic, spc, font }]. */
function textBox({ x, y, w, h, runs, align = 'l', lineSpacing = 100 }) {
  const id = nextId();
  const body = runs.map((r) => {
    const attrs = [
      'lang="en-US"',
      `sz="${pt(r.size)}"`,
      r.bold ? 'b="1"' : '',
      r.italic ? 'i="1"' : '',
      r.spc ? `spc="${r.spc}"` : '',
      'dirty="0"',
    ].filter(Boolean).join(' ');
    return `<a:r><a:rPr ${attrs}>` +
      `<a:solidFill><a:srgbClr val="${r.color}"/></a:solidFill>` +
      `<a:latin typeface="${r.font || FONT}"/><a:cs typeface="${r.font || FONT}"/>` +
      `</a:rPr><a:t>${esc(r.text)}</a:t></a:r>`;
  }).join('');

  preview.push(
    `<div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;` +
    `text-align:${align === 'ctr' ? 'center' : 'left'};line-height:${lineSpacing / 100};` +
    (process.env.BOXES ? 'outline:1px dashed rgba(255,0,0,.35)' : '') + '">' +
    runs.map((r) =>
      `<span style="font-size:${r.size}px;color:#${r.color};` +
      `font-family:${r.font || FONT},serif;font-weight:${r.bold ? 700 : 400};` +
      `font-style:${r.italic ? 'italic' : 'normal'};` +
      `letter-spacing:${((r.spc || 0) / 100) * (96 / 72)}px">${esc(r.text)}</span>`).join('') +
    '</div>');

  shapes.push(
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/>` +
    `<p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>` +
    `<a:xfrm><a:off x="${px(x)}" y="${px(y)}"/><a:ext cx="${px(w)}" cy="${px(h)}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>` +
    `<p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="t">` +
    `<a:noAutofit/></a:bodyPr><a:lstStyle/><a:p><a:pPr algn="${align}">` +
    `<a:lnSpc><a:spcPct val="${lineSpacing * 1000}"/></a:lnSpc></a:pPr>${body}</a:p></p:txBody></p:sp>`);
}

/** A rectangle: filled, outlined, or both. */
function rect({ x, y, w, h, fill, lineColor, lineWidth = 1, dash, alpha }) {
  const id = nextId();
  const a = alpha ? `<a:alpha val="${alpha * 1000}"/>` : '';
  const fillXml = fill
    ? `<a:solidFill><a:srgbClr val="${fill}">${a}</a:srgbClr></a:solidFill>`
    : '<a:noFill/>';
  const lineXml = lineColor
    ? `<a:ln w="${Math.round(lineWidth * 12700)}"><a:solidFill>` +
      `<a:srgbClr val="${lineColor}">${a}</a:srgbClr></a:solidFill>` +
      `${dash ? `<a:prstDash val="${dash}"/>` : ''}</a:ln>`
    : '<a:ln><a:noFill/></a:ln>';

  preview.push(
    `<div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;` +
    `background:${fill ? '#' + fill : 'transparent'};` +
    (lineColor ? `border:${lineWidth}px ${dash ? 'dashed' : 'solid'} #${lineColor};` +
      `opacity:${alpha ? alpha / 100 : 1};` : '') + '"></div>');

  shapes.push(
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Shape ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${px(x)}" y="${px(y)}"/><a:ext cx="${px(w)}" cy="${px(h)}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fillXml}${lineXml}</p:spPr>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>`);
}

/* ----------------------------------------------------------------- slide */

function build(counts) {
  const PAD = 68;
  const PHONE_X = 772;
  const PHONE_W = W - PHONE_X - 56;
  const n = (v) => v.toLocaleString('en-US');

  // The sappan selvedge, along the top edge, as the masthead wears it.
  rect({ x: 0, y: 0, w: W, h: 7, fill: SAPANG });

  textBox({
    x: PAD, y: 62, w: 640, h: 20,
    runs: [{ text: 'A SEARCHABLE EDITION OF', size: 12.5, color: GOLD, spc: 300, font: SANS }],
  });

  // The box is taller than three lines need, so a fourth has somewhere to go if
  // PowerPoint breaks the line a word earlier than the browser does.
  textBox({
    x: PAD, y: 96, w: 650, h: 210, lineSpacing: 106,
    runs: [{ text: 'A Dictionary of the Plant Names of the Philippine Islands', size: 47, color: CREAM, bold: true }],
  });

  // One entry, carrying the two strands the app colours apart: the native name
  // in ink on the dye, the binomial in herbarium green.
  textBox({
    x: PAD, y: 300, w: 650, h: 26,
    runs: [
      { text: 'ABACÁ', size: 15, color: CREAM, spc: 90 },
      { text: '   Musa textilis', size: 15, color: GREEN, italic: true },
    ],
  });

  rect({ x: PAD, y: 330, w: 108, h: 2, fill: SAPANG });

  textBox({
    x: PAD, y: 356, w: 640, h: 30,
    runs: [{ text: 'Elmer D. Merrill, Botanist', size: 21, color: CREAM }],
  });
  textBox({
    x: PAD, y: 390, w: 640, h: 22,
    runs: [{
      text: 'BUREAU OF GOVERNMENT LABORATORIES  ·  MANILA  ·  1903',
      size: 11.5, color: MUTED, spc: 180, font: SANS,
    }],
  });

  [[n(counts.names), 'NATIVE NAMES'], [n(counts.taxa), 'PLANTS'], [n(counts.families), 'FAMILIES']]
    .forEach(([value, label], i) => {
      const x = PAD + i * 176;
      textBox({ x, y: 452, w: 170, h: 40, runs: [{ text: value, size: 32, color: CREAM }] });
      textBox({ x, y: 494, w: 170, h: 20, runs: [{ text: label, size: 10.5, color: MUTED, spc: 160, font: SANS }] });
    });

  textBox({
    x: PAD, y: 548, w: 640, h: 26,
    runs: [
      { text: 'Every entry shows the scanned line it was read from  ·  ', size: 12.5, color: MUTED, font: SANS },
      { text: ADDRESS, size: 12.5, color: GOLD, bold: true, font: SANS },
    ],
  });

  // The reserved area. Both of these are guides, to be deleted.
  rect({
    x: PHONE_X, y: 54, w: PHONE_W, h: H - 108,
    lineColor: CREAM, lineWidth: 1.25, dash: 'dash', alpha: 38,
  });
  textBox({
    x: PHONE_X, y: H / 2 - 10, w: PHONE_W, h: 24, align: 'ctr',
    runs: [{ text: 'PHONE MOCKUP — DELETE THIS GUIDE', size: 10, color: CREAM, spc: 140, font: SANS }],
  });
}

/* ------------------------------------------------------------ the package */

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const emptyTree =
  '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
  '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>' +
  '<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree>';

const rels = (list) => XML +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  list.map(([id, type, target]) =>
    `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`).join('') +
  '</Relationships>';

function parts() {
  const slide = XML + `<p:sld ${NS}><p:cSld>` +
    `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${INDIGO}"/></a:solidFill>` +
    '<a:effectLst/></p:bgPr></p:bg>' +
    '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
    '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>' +
    '<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
    shapes.join('') + '</p:spTree></p:cSld>' +
    '<p:clrMapOvr><a:overrideClrMapping bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" ' +
    'accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" ' +
    'accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
    '</p:clrMapOvr></p:sld>';

  const master = XML + `<p:sldMaster ${NS}><p:cSld><p:bg><p:bgPr>` +
    `<a:solidFill><a:srgbClr val="${INDIGO}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>` +
    emptyTree + '</p:cSld>' +
    '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" ' +
    'accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" ' +
    'hlink="hlink" folHlink="folHlink"/>' +
    '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>' +
    '</p:sldMaster>';

  const layout = XML + `<p:sldLayout ${NS} type="blank" preserve="1">` +
    `<p:cSld name="Blank">${emptyTree}</p:cSld>` +
    '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>';

  const presentation = XML + `<p:presentation ${NS} saveSubsetFonts="1">` +
    '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
    '<p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>' +
    `<p:sldSz cx="${px(W)}" cy="${px(H)}"/><p:notesSz cx="6858000" cy="9144000"/>` +
    '</p:presentation>';

  // Required, and almost entirely boilerplate. The colour scheme is the app's
  // so that anything added in PowerPoint picks the right palette by default.
  const theme = XML +
    '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Merrill">' +
    '<a:themeElements><a:clrScheme name="Merrill">' +
    '<a:dk1><a:srgbClr val="1F1D19"/></a:dk1><a:lt1><a:srgbClr val="F6F1E6"/></a:lt1>' +
    `<a:dk2><a:srgbClr val="${INDIGO}"/></a:dk2><a:lt2><a:srgbClr val="${CREAM}"/></a:lt2>` +
    `<a:accent1><a:srgbClr val="${SAPANG}"/></a:accent1>` +
    `<a:accent2><a:srgbClr val="${GOLD}"/></a:accent2>` +
    '<a:accent3><a:srgbClr val="3D5A41"/></a:accent3>' +
    '<a:accent4><a:srgbClr val="DBD0BB"/></a:accent4>' +
    `<a:accent5><a:srgbClr val="${MUTED}"/></a:accent5>` +
    '<a:accent6><a:srgbClr val="7A4E18"/></a:accent6>' +
    `<a:hlink><a:srgbClr val="${GOLD}"/></a:hlink>` +
    `<a:folHlink><a:srgbClr val="${MUTED}"/></a:folHlink></a:clrScheme>` +
    '<a:fontScheme name="Merrill">' +
    `<a:majorFont><a:latin typeface="${FONT}"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>` +
    `<a:minorFont><a:latin typeface="${FONT}"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>` +
    '</a:fontScheme><a:fmtScheme name="Merrill">' +
    '<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
    '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
    '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>' +
    '<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>' +
    '<a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>' +
    '<a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>' +
    '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle>' +
    '<a:effectStyle><a:effectLst/></a:effectStyle>' +
    '<a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>' +
    '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
    '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
    '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>' +
    '</a:fmtScheme></a:themeElements></a:theme>';

  const contentTypes = XML +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
    '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>' +
    '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>' +
    '<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>' +
    '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
    '</Types>';

  return [
    entry('[Content_Types].xml', contentTypes),
    entry('_rels/.rels', rels([['rId1', 'officeDocument', 'ppt/presentation.xml']])),
    entry('ppt/presentation.xml', presentation),
    entry('ppt/_rels/presentation.xml.rels', rels([
      ['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'],
      ['rId2', 'slide', 'slides/slide1.xml'],
      ['rId3', 'theme', 'theme/theme1.xml'],
    ])),
    entry('ppt/slideMasters/slideMaster1.xml', master),
    entry('ppt/slideMasters/_rels/slideMaster1.xml.rels', rels([
      ['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'],
      ['rId2', 'theme', '../theme/theme1.xml'],
    ])),
    entry('ppt/slideLayouts/slideLayout1.xml', layout),
    entry('ppt/slideLayouts/_rels/slideLayout1.xml.rels', rels([
      ['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml'],
    ])),
    entry('ppt/slides/slide1.xml', slide),
    entry('ppt/slides/_rels/slide1.xml.rels', rels([
      ['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'],
    ])),
    entry('ppt/theme/theme1.xml', theme),
  ];
}

function main() {
  if (!fs.existsSync(PAYLOAD)) {
    console.error('share-card: app/data/dictionary.json is missing - run `npm run index` first');
    process.exitCode = 1;
    return;
  }
  const { counts } = JSON.parse(fs.readFileSync(PAYLOAD, 'utf8')).meta;

  build(counts);
  const files = parts();

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, zip(files));

  fs.mkdirSync(path.dirname(PREVIEW), { recursive: true });
  fs.writeFileSync(PREVIEW,
    '<!doctype html><meta charset="utf-8"><title>share card preview</title>' +
    `<body style="margin:0;background:#555"><div style="position:relative;width:${W}px;` +
    `height:${H}px;background:#${INDIGO};overflow:hidden">${preview.join('')}</div>`);

  console.log(`${W}x${H}px  (${(W / 96).toFixed(3)} x ${(H / 96).toFixed(4)} in)`);
  console.log(`${n(counts.names)} names, ${n(counts.taxa)} plants, ${counts.families} families`);
  console.log(`${files.length} parts, ${shapes.length} shapes`);
  console.log(`-> ${path.relative(ROOT, OUT)}  ${(fs.statSync(OUT).size / 1024).toFixed(1)} KB`);
  console.log(`-> ${path.relative(ROOT, PREVIEW)}  (gitignored; BOXES=1 outlines every box)`);
}

const n = (v) => v.toLocaleString('en-US');

main();
