# How good is the source text?

Short answer: good enough to build the whole system against, not good enough to
publish as a reference work. This document records the measurements, because the
decision about what to do next depends on them.

Reproduce everything here with `npm run audit` (writes `data/audit.json`).

## What we are working from

`source/dictionaryofplan00merr.pdf` — 209 pages, a photographic scan of the 1903
printing with an OCR text layer produced by someone else, years ago. There are
no page images we can re-process locally: the PDF carries only the scan and the
text layer, and this machine has `pdftotext` but no `pdftoppm`, no Tesseract.

The text layer is real and mostly usable. Extracting it with `-layout` preserves
the hanging indents that Part II's structure depends on, and the parser reads
about 98% of lines.

## The problem

Merrill printed headwords in **small capitals**. OCR engines of the era this
scan was processed in handled small caps poorly, and they handled the **accented
vowels** — which Merrill went out of his way to get right — worse.

Three kinds of damage, in increasing order of seriousness:

### 1. Case scrambling — harmless

`ANIBIONG` comes through as `AniBionG`. The letters are correct; only the case
is wrong. The parser normalises this away and it costs nothing.

### 2. Accents flattened — visible, recoverable in principle

Every accented vowel was read as one of a small set of wrong glyphs, most often
`é`. `Baca-bacáhan` is in the text layer as `Baca-bacéhan`; `Alúsang` as
`Altsang`; `lópo-lópo` as `l6po-l6po`.

There are **1,268** such occurrences. The pipeline treats `é` inside a native
name as a marker that an accent was present but its vowel is lost, flags the
entry `accent-lost`, and the app shows a warning on it. It does not guess.

Merrill considered the accentuation one of the contributions of the work — he
says in the introduction that he had every name checked with native speakers on
his staff, because earlier Spanish authors had accented them carelessly or not
at all. Losing it is a real loss, not a cosmetic one.

### 3. Words misread as different words — the blocking problem

This is the one that matters. Some headwords were read as plausible-looking but
wrong strings, so nothing in the data marks them as suspect.

The clearest example: **ÍPIL**, one of the best-known Philippine timber trees
(*Afzelia bijuga*), appears in the text layer as:

```
fprz, T., V. Afzelia bijuga A. Gray.
```

Nothing about `fprz` can be repaired automatically, and nothing flags it. A user
searching "ipil" — which is what a user would search — finds nothing.

### Measuring it

The book prints most native names twice, once in each half, and the two halves
were OCR'd independently. So: take every native name printed in the scientific
index and look it up in the native index. If the two readings disagree, at least
one of them is wrong.

Of **2,908** names printed in both halves:

| Result | Count | Share |
|---|---:|---:|
| The two halves agree exactly | 612 | 21.0% |
| They differ by one letter | 789 | 27.1% |
| No match at all | 1,507 | **51.8%** |

A caveat, stated plainly: **not all of that 51.8% is OCR error.** Merrill warns
in the introduction that spelling genuinely varies — "e and i, o and u, and
frequently i and y have the same values and are interchangeable" — so some of
these are real variants the book itself records differently in its two halves.
But one-letter tolerance already absorbs most legitimate variation of that kind,
and 1,507 total failures is far more than variant spelling explains.

A second, independent check: **175 Part I headwords (3.5%)** contain no vowel at
all or an impossible consonant run — `BAPBDROP`, `BATUCSTC`, `BANCCTPO`. No
Philippine language produces these. They are pure scanner noise, and 3.5% is
only the share obvious enough to detect this way.

## What this means

The pipeline, the data model and the app are all built and working. They will
produce a much better dictionary the moment they are fed better text — nothing
downstream needs to change.

## Options for better text, best first

1. **Fetch the Internet Archive's own OCR.** The file name
   `dictionaryofplan00merr` is an Internet Archive identifier. IA publishes a
   `_djvu.txt` and an ABBYY XML for its scans, usually better than what is
   embedded in a redistributed PDF, and the XML carries per-word coordinates —
   which would also let the app show the reader the original line on the page.
   Cheapest thing to try, and it may resolve most of this. *Needs your go-ahead
   before fetching anything external.*

2. **Re-OCR the page images.** Requires the images (IA serves them, or a
   different source PDF) plus Tesseract with a Spanish + English model. Small
   caps remain the weak spot, but a modern engine with the right model is a long
   way ahead of whatever produced this layer.

3. **Vision-model pass over the page images.** Best quality for exactly the two
   things that are broken here — small caps and accented vowels — and it can use
   the surrounding entry as context. 200 pages is a tractable amount of work.
   Most expensive option; worth reserving for the pages that still fail after 1
   or 2.

4. **Correct by hand against the flagged list.** `data/issues.json` and the
   `accent-lost` / `glyph-damage` flags already localise much of the damage. This
   does not find category-3 errors like `fprz`, so it is a finishing pass, not a
   strategy.

Whichever route: keep `data/raw/` as the only thing that changes, re-run
`npm run build`, and the numbers in this document will move.
