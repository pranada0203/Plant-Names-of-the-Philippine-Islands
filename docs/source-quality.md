# How good is the source text?

Both halves of the book have now been transcribed by eye from the page images.
This document records how the damage was measured, what the two passes fixed,
and what is still wrong.

Reproduce the numbers with `npm run audit` (writes `data/audit.json`).

## What we are working from

`source/dictionaryofplan00merr.pdf` — 209 pages, a photographic scan of the 1903
printing, with an OCR text layer produced by **Tesseract 5.3**.

## Three things the Internet Archive settled

The PDF is the Internet Archive's own derivative of item
`dictionaryofplan00merr`.

**Its `_djvu.txt` is the same OCR run**, so there was no better text to fetch:
17,040 vs 17,034 distinct tokens, 16,953 shared, identical accent counts, the
differences confined to the cover leaves. That avenue is closed.

**Its hOCR was worth having.** Plain text discards what hOCR keeps — an
`x_wconf` confidence and a bounding box per word. `npm run fetch-ia` downloads
it and stage 2 stamps each headword with the lowest confidence the engine gave
it. That turned quality from a guess into a measurement, and it is what made the
scale of the problem legible:

| Reading | Should be | Confidence |
|---|---|---:|
| `BapBdrop` | *(unrecoverable)* | **1** |
| `Aagnocdsto` | AGNOCÁSTO | **4** |
| `fprz` | ÍPIL | **9** |
| `Cdégon-tocd` | CÓGON-TOCÓ | **25** |
| `Afzelia` (roman, same line as `fprz`) | — | **92** |

**And its page images are served per leaf as JPEG** —
`archive.org/download/<item>/page/n<leaf>.jpg` — so the vision pass needed
neither the 63 MB JP2 archive nor a JPEG 2000 decoder. IA leaf `nX` is our page
`X + 1`.

## Why the damage was where it was

Merrill printed headwords in **small capitals** and the scientific names beside
them in **roman**. Same scan, same page, same engine — a controlled comparison
of what the typeface cost. Before any correction:

| Set on the page as | n | Median confidence | Under 50 |
|---|---:|---:|---:|
| Native headwords — small caps | 4,157 | **45** | **54.1%** |
| Scientific names — roman | 1,383 | **86** | 27.2% |

Two further measurements agreed. Of the 2,908 names the book prints in **both**
halves (OCR'd independently, so a disagreement means one reading is wrong), only
**21.1%** matched exactly and **51.9%** could not be reconciled at all. And
**175 headwords (3.5%)** contained no vowel or an impossible consonant run —
`BAPBDROP`, `BATUCSTC` — words no Philippine language produces.

## The method

Transcribing from the image and *diffing by eye* against the OCR are two jobs,
and the second invites mistakes. So each page is transcribed straight — every
entry, in printed order — and a script does the comparison, aligning the two
sequences with Needleman-Wunsch so a line the parser dropped shifts nothing.

Corrections live in `data/corrections/part1/` and `part2/`, one file per page,
keyed by page plus the scanner's own reading, and are applied during stage 2 —
never edited into generated files, which `npm run build` regenerates.

Each file keeps the **full transcription**, not just the diff, so
`pipeline/rekey-corrections.js` can re-derive every correction after a parser
change. That was used repeatedly, re-keying all 181 pages without re-reading a
single image.

## Pass one: Part I, the native-name index

All **107 pages**, **5,000 headwords corrected** — essentially every one, since
almost all carried at least a lost accent.

It exposed three silent bugs. Multi-word headwords were being split, with the
remainder swallowed into the *scientific name* ("AMORES SECOS, Sp.-Fil.
Chrysopogon aciculatus" parsed as headword AMORES, taxon "SECOS, Sp.-Fil.
Chrysopogon aciculatus"). Correction keys collided where a page reads the same
headword twice meaning two different plants — page 76 has INATA four times.
And re-ingesting a page keyed its corrections to their own output, so the next
clean parse dropped every one.

## Pass two: Part II, the scientific index

All **75 pages**, **911 scientific names corrected** (511 when the pass was
first run; re-keying after a later parser fix, which recovered 29 entries the
parser had been dropping, changed what many lines read and so produced more
corrections). A genus heading only has
to be corrected once: the parser expands abbreviated species ("A. aspera") from
whichever genus is open, so repairing "Aeiata" to *Aglaia* fixes the six species
beneath it too.

This is what collapsed the duplicate taxa. *Pterocarpus indicus* had also
existed as "Prerocarpus rnpicus", *Hopea plagata* as both "Hopea palagata" and
"H. pragata", *Musa textilis* as "Meco, texttilis". The taxon count fell from
2,102 to **1,709** as those merged, and the survivors carry the family and notes
that had been split across the duplicates.

Four more silent defects surfaced:

- **Part II opened a page earlier than the parser thought.** The boundary was
  anchored on ACHRAS SAPOTA, the first entry of Part II's *second* page; the
  section actually opens with ABROMA ALATA. Twelve scientific entries were lost.
- **Abbreviated initials get destroyed.** "A. ARGENTEA" reaches the text layer
  as ". ARGENTEA", ">>. MINUTIFLORA", "Pp>p>. ROLFEI", or — shifted three
  columns into where the initial used to be — "    MARIANENSIS Chois." Each form
  is now recognised as a species continuing the open genus.
- **Two entries sometimes share one OCR line**, the second swallowed by the
  first. They are split on an interior abbreviated genus; an authority
  ("A. Gray") is told from an epithet ("ODORATISSIMA") by counting capitals,
  since epithets are set in small caps.
- **Wrapped native-name lines were read as headings** — and then became the genus
  for every abbreviated species under them, producing taxa like "Mobóti bunius"
  where the book says *Antidesma bunius*. A heading's first token ends in a
  period; a wrapped name list ends its first token with a comma or semicolon.

## Pass three: Part I's taxon strings

Part I also prints a scientific name on every line — "ABACÁ, T., V. Musa
textilis Neé." — and the first two passes left those as the scanner read them.
Where one was garbled badly enough not to match its Part II counterpart it
survived as a stub taxon, so the same plant appeared twice under two spellings.

The pass did not need every line. `pipeline/show-taxa.js` lists exactly the
lines whose scientific name has no Part II counterpart — the only ones that can
be wrong in a way that matters — and those were checked against the page image
one page at a time, **105 pages, 73 corrections**. The low hit rate is the
finding, not a shortfall: most flagged lines are faithful readings.

What the pass actually repaired falls into four kinds:

- **The dialect marker bled into the scientific name.** "CUCUBÍTAN, T., V.,
  Pamp. Trichosanthes anguina L." reached the parser with "Pamp." at the head of
  the taxon; likewise GÁBI, IS-ÍS, LAOCPÁO, MANUNGÁL, TÚNAS.
- **The headword bled into it.** HIÉRBA DE SAN PÉDRO carried "San PépRo, Sp.
  Phyllanthus niruri", ÍLANG-ÍLANG DE CHÍNA carried "Hina. Artabotrys".
- **A line's epithet was taken from its neighbour.** On page 63 the epithets
  shifted up one line, giving CUYANYÁN "Alstonia. ternatensis Valeton" — a name
  belonging to CÚYON-CÚYON, whose own line then read *Lepiniopsis ilicifolia*
  instead of *L. ternatensis*.
- **Single letters misread inside an otherwise sound binomial**: "Ipomoea
  quamocht", "Lllipe betis", "Sapindus turezaninowil", "Euphorbia puleherrima",
  "Melia can dollei", "Bombax malabsz arieum".

Two non-entries the parser had mistaken for lines were dropped: a scan artefact
on page 19 and the "O." section heading on page 96, which had also swallowed the
authority "Vidal" from the ODAÓDEG line above it.

## Result

| | Before | After Part I | After Part II | After Part I taxa |
|---|---:|---:|---:|---:|
| Cross-half agreement, exact | 21.1% | 46.9% | 47.4% | **47.0%** |
| Cross-half, unreconcilable | 51.9% | 24.5% | 23.3% | **23.7%** |
| Implausible headwords | 175 | 0 | 0 | **0** |
| Distinct native names | 4,740 | 4,395 | 4,395 | **4,391** |
| Distinct taxa | 2,149 | 2,102 | 1,709 | **1,669** |
| Taxa with a family | 1,184 | 1,196 | 1,437 | **1,464** |
| Taxa with Merrill's notes | 937 | 947 | 1,001 | **1,009** |
| Plant families | 137 | 137 | 147 | **147** |
| Stub taxa (Part I only) | — | — | 283 | **188** |

The name count *fell* in pass one because it had been inflated: the same name
misread two ways counted twice. The taxon count fell in pass two, and again in
pass three, for the same reason.

The cross-half figures are 0.4 points worse in the last column than in the one
before it, which is not the third pass's doing — it does not touch headwords.
The Part II column was measured before a parser fix recovered 29 Part II entries;
the last column is a fresh measurement over that larger comparison set.

The audit now measures only the entries still as the scanner left them, and
there are few: 9 native headwords (median confidence 66) and 1,479 scientific
names in Part II's notes (median 100, 3.5% under 50). The roman type was never
the problem.

## What is still wrong

**188 of 1,669 taxa exist only because Part I names them.** The third pass cut
that from 283, but what remains is mostly not OCR damage at all — it is the book
disagreeing with itself, and the transcription is faithful to the page:

- ANÁHAO's palm is printed *Livinstonia rotundifolia* in Part I, *Livistonia* on
  another Part I line, and *Livistona* in Part II.
- SAMPAGUÍTA's *Jasminum sambac* and "Jasseminum sambac" are both Merrill's, on
  adjacent lines.
- *Caesalpena*, *Panceratum*, *Cinnamonum*, *Maranta dichtoma*,
  *Koordersiodendron* / *Koordersoidendron*, *Glircida maculata*, "Ficus
  ameplas", "Cissampelos pariera" — all printed that way.
- Some plants Part II simply never lists.

Merging what is left automatically is still not safe: matching on the species
epithet alone would join *Eurycles sylvestris* to *Pandanus sylvestris*, and
*Maranta arundinacea* to *Imperata arundinacea*, which are different plants.
*Toona* and *Unona*, *Ryparosa* and *Aporosa*, *Sesuvium indicum* and *Sesamum
indicum* are each within two or three edits of one another and each a different
plant. What is needed now is a hand-checked list of Merrill's own variant
spellings, not a rule.

Smaller residues: 70 Part I lines still fail to parse (`data/issues.json`), and
12 headwords could not be located in the hOCR so carry no confidence score; the
app treats those as doubtful rather than as fine.
