# How good is the source text?

Short answer: good enough to build the whole system against, not good enough to
publish as a reference work. This document records the measurements, because the
decision about what to do next depends on them.

Reproduce everything here with `npm run audit` (writes `data/audit.json`).

## What we are working from

`source/dictionaryofplan00merr.pdf` — 209 pages, a photographic scan of the 1903
printing, with an OCR text layer produced by **Tesseract 5.3**.

## The Internet Archive question, settled

The PDF is the Internet Archive's own derivative of item
`dictionaryofplan00merr`, so the obvious first move was to fetch the IA's
`_djvu.txt` on the theory that the PDF's embedded text layer had been degraded
in packaging. **It had not.** The two are the same OCR run:

| | |
|---|---:|
| Distinct tokens in IA `_djvu.txt` | 17,040 |
| Distinct tokens in the PDF text layer | 17,034 |
| Shared | 16,953 |
| Accented characters in each | 1,268 / 1,268 |

The ~85 tokens either side are all on the cover and endpaper leaves, not in the
dictionary. `fprz` — the bad reading discussed below — is byte-identical in
both. Re-fetching the *text* buys nothing, and that avenue is closed.

The IA's **hOCR** was a different matter, and is now part of the pipeline.

## What the hOCR added: the engine's own confidence

Plain text throws away what hOCR keeps — an `x_wconf` score and a bounding box
for every word. `npm run fetch-ia` downloads it; stage 2 aligns it to our pages
and stamps each headword with the lowest confidence the engine gave it.

This replaces guesswork with measurement. The pipeline's heuristics could not
tell that `fprz` was wrong — it is all letters, no odd characters, no lost
accent. The engine could: **it scored it 9 out of 100.**

| Reading | What it should be | Confidence |
|---|---|---:|
| `BapBdrop` | *(unrecoverable)* | **1** |
| `Aagnocdsto` | AGNOCASTO | **4** |
| `fprz` | ÍPIL | **9** |
| `Cdégon-tocd` | CÓGON-TOCÓ | **25** |
| `Batucstc` | *(unrecoverable)* | **29** |
| `ANGupb` | ANGUD | **46** |
| `Afzelia` (roman, same line as `fprz`) | — | **92** |

## The problem, measured three ways

Merrill printed headwords in **small capitals**, and printed the scientific
names beside them in **roman**. Same scan, same page, same engine — so the two
are a controlled comparison of what the typeface costs.

### 1. Confidence by typeface

| Set on the page as | n | Median confidence | Scoring under 50 |
|---|---:|---:|---:|
| Native headwords — small caps | 4,157 | **45** | **54.1%** |
| Scientific names — roman | 1,383 | **86** | 27.2% |

The damage is concentrated almost entirely in the small-caps native names —
which is to say, in the half of the dictionary that is the point of the book.
Only **1,117 of 4,740 headwords (23.6%)** reach a confidence of 70.

### 2. The two halves against each other

The book prints most native names twice, once in each index, and the two were
OCR'd independently. If the readings disagree, at least one is wrong.

Of **2,908** names printed in both halves:

| Result | Count | Share |
|---|---:|---:|
| The two halves agree exactly | 613 | 21.1% |
| They differ by one letter | 786 | 27.0% |
| No match at all | 1,509 | **51.9%** |

Not all of that 51.9% is OCR error — Merrill warns that spelling genuinely
varies, "e and i, o and u, and frequently i and y have the same values and are
interchangeable" — but one-letter tolerance already absorbs most variation of
that kind.

Two independent methods, 54.1% and 51.9%. They agree.

### 3. Words no language would produce

**175 headwords (3.5%)** contain no vowel at all or an impossible consonant run:
`BAPBDROP`, `BATUCSTC`, `BANCCTPO`. This is only the share obvious enough to
detect by rule, and it is a floor, not an estimate.

## Damage that is visible but recoverable

Every accented vowel was read as one of a few wrong glyphs, most often `é`:
`Baca-bacáhan` → `Baca-bacéhan`, `Alúsang` → `Altsang`, `lópo-lópo` →
`l6po-l6po`. **1,268** occurrences. Entries are flagged `accent-lost` and the
app warns on them; the pipeline does not guess the vowel.

Merrill considered this accentuation a contribution of the work — he had every
name checked with native speakers on his staff because earlier Spanish authors
had accented them carelessly or not at all. Losing it is a real loss.

Case scrambling (`ANIBIONG` → `AniBionG`) is harmless and normalised away.

## What this means

The pipeline, the data model and the app are built and working, and they now
report per-entry confidence honestly rather than presenting every reading as
equally sound. They will produce a much better dictionary the moment they are
fed better text — nothing downstream needs to change.

But the text itself has not improved, and cannot be improved from anything the
IA distributes as text. A reader searching "ipil" still finds nothing.

## Options for better text, best first

1. **Vision-model pass over the page images.** Now clearly the right tool: the
   two things that are broken are small caps and accented vowels, which is
   exactly where a vision model beats a classical engine, and it can use the
   surrounding entry as context. The confidence scores make it targetable —
   the ~2,250 headwords under 50 could be re-read rather than all 209 pages.
   Needs `..._jp2.zip` (63 MB) or `..._orig_jp2.tar` (117 MB) from the IA.

2. **Re-OCR with Tesseract tuned for small caps.** Same images, plus a Spanish +
   English model and `--psm` settings suited to the layout. Cheaper than 1 and
   may recover a good share; small caps remain the weak spot of the approach
   that produced the current text, so expectations should be modest.

3. **Correct by hand, worst-first.** `data/audit.json` now ranks every headword
   by confidence, so this is no longer guesswork about where to look. Viable as
   a finishing pass over a few hundred entries; not viable as the strategy.

4. **Find a different edition.** Other scans of the 1903 printing may exist with
   better plates or better OCR. Unverified.

Whichever route: only `data/raw/` changes, then `npm run build`, and the numbers
in this document move.
