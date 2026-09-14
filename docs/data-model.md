# Data model

`app/data/dictionary.json` is the single file the app loads. Everything else in
`data/` is intermediate or diagnostic.

Hand-read corrections live in `data/corrections/part1/` (Part I native
headwords), `data/corrections/part2/` (Part II scientific names) and
`data/corrections/taxa/` (the scientific name printed on each Part I line), one
file per page, applied during stage 2. See
[source-quality.md](source-quality.md).

## Shape

```jsonc
{
  "meta":          { /* title, counts, provenance — see below */ },
  "dialects":      { "T": "Tagalog", "V": "Visayan", ... },
  "dialectCounts": { "T": 2411, ... },
  "families":      { "Leguminosae": 148, ... },
  "names":         [ /* native names */ ],
  "taxa":          [ /* plants */ ]
}
```

`names` and `taxa` are arrays; **an entry's array index is its id**, and links
between them are those indices. That keeps the payload small and lookups O(1).

## `names[]` — a native plant name

```jsonc
{
  "id": 191,
  "name": "ANAHAO",           // normalised for display and sorting
  "printed": "ANAHAO",        // as the scan read it, shown under "as the scan reads it"
  "key": "anahao",            // folded for search;  = an undecodable glyph
  "dialects": ["T", "V"],     // keys into `dialects`
  "places": ["Cagayan"],      // where Merrill gave a province instead of a language
  "taxa": [                   // the plants this name denotes
    { "id": 812, "authority": "Miq.", "printed": "Licuala spectabilis Miq.", "via": "partII-near" }
  ],
  "sightings": [              // one per line the book prints this headword on
    { "page": 24,             //   scan leaf, for checking against the PDF
      "printedPage": "16",    //   page number as the book itself paginates
      "box": [0.094, 0.865, 0.46, 0.024] }   // where on the leaf; see below
  ],
  "confidence": 68,           // lowest x_wconf the OCR engine gave this headword
  "flags": ["accent-lost"]    // see below
}
```

One record per *distinct* headword. Merrill lists the same headword on several
lines when it denotes several plants; those lines are merged, and `taxa`,
`dialects` and `places` accumulate across them.

`sightings` does not merge, deliberately: ANÁHAO is printed on six lines naming
six different palms, and the point of recording each one is that a reader can
look at all six. `printedPage` and `box` are each absent when unknown.

`taxa[].via` records how the link was made, so a doubtful join can be traced:

| `via` | Meaning |
|---|---|
| *(absent)* | Printed directly in Part I under this headword |
| `partII` | Part II lists this name under that species, spelled identically |
| `partII-near` | Same, but the two halves differ by one letter |

## Boxes on the scan

A `box` is `[x, y, width, height]` as **fractions of the leaf**, not pixels:
the Internet Archive serves several sizes of each leaf and the app is free to
pick one. `meta.scan.pages` gives each leaf's pixel dimensions, which is all
that is needed to turn a fractional box back into a shape.

```jsonc
"meta": { "scan": {
  "item": "dictionaryofplan00merr",
  "imageUrl": "https://archive.org/download/dictionaryofplan00merr/page/n{leaf}{width}.jpg",
  "widths": [800],              // sizes the IA generates; anything larger is the master
  "viewer": "https://archive.org/details/dictionaryofplan00merr/page/n{leaf}",
  "pages": { "19": [1945, 3205] }   // leaf -> [width, height] in pixels
}}
```

`{leaf}` is **the page number minus one** — the Archive numbers leaves from
zero. `{width}` is `_w800` or empty.

Stage 2 finds these by aligning each page's parsed entries against the lines in
the Internet Archive's hOCR, which carries a bounding box for every word. Where
the match is poor the box is simply absent: a box drawn round the wrong line is
worse than no box, because the reader is shown a line that does not say what
the entry says and has no way to tell which of the two is wrong.

## `taxa[]` — a plant

```jsonc
{
  "id": 812,
  "name": "Licuala spectabilis",   // botanical convention: Genus species
  "printed": "LICUALA SPECTABILIS",// as the book sets it
  "authority": "Miq.",
  "genus": "LICUALA",
  "family": "Palmae",
  "familySource": "fuzzy",         // how the family was determined
  "notes": "A low stemless palm...",
  "page": 171,
  "printedPage": "163",
  "box": [0.088, 0.77, 0.83, 0.14], // the whole block on the leaf; null if unlocated
  "fromPartII": true,              // false = only ever mentioned in Part I
  "names": [191, 402, 1130],       // indices into `names`
  "extraNames": [                  // printed in Part II, no match in Part I
    { "name": "Silag", "dialects": ["Il"], "place": null }
  ]
}
```

`familySource`:

| Value | Meaning |
|---|---|
| `exact` | The printed family name matched Merrill's list as-is |
| `fuzzy` | Repaired from a mangled ligature — `Legwminosew` → `Leguminosae` |
| `inherited` | The species line gave none; taken from its genus heading |
| `null` | No family recorded |

The ligature repair matters: the 1903 printer's `-aceae` ligature is read by the
scanner as `-acee`, `-acew`, `-aceew` and more. Without repair a single family
shatters into several and the family filter is useless. See
`pipeline/lib/taxonomy.js`.

## Quality flags on `names[]`

| Flag | Meaning |
|---|---|
| `accent-lost` | An accented vowel was flattened; the vowel's identity is gone |
| `glyph-damage` | The headword contains characters that are not letters |
| `dialect-unrecognised` | The language abbreviation did not match Merrill's list |
| `taxon-suspect` | The scientific name on this line does not look like a binomial |

These are **under-inclusive by design**: they catch damage the pipeline can see.
They do not catch a word misread as a different plausible word.

## `confidence` — the signal that supersedes the flags

`names[].confidence` is the lowest `x_wconf` Tesseract gave any word of the
headword, read from the Internet Archive hOCR (stage 1b). It is a measurement,
where the flags above are a guess, and the app prefers it: `fprz` carries no
flag at all but scores **9**.

| Range | The app says |
|---|---|
| 70–100 | nothing — the reading stands |
| 40–69 | "the scanner was unsure of this reading" |
| 0–39 | "the scanner was guessing here"; marked *misread?* in results |
| `null` | the word was not located in the hOCR — unknown, not fine |

`null` is treated as doubtful by the "Hide doubtful readings" filter, because
passing an unverified reading silently would defeat the filter.

See [source-quality.md](source-quality.md) for what the distribution looks like
and why it is concentrated in the small-caps headwords.

## `meta.provenance`

Carries the parse report, the audit counts, and how many links came from where —
so a future reader can tell how the numbers in the app were arrived at without
re-running the pipeline.

## Search keys

`key` is folded: lowercased, diacritics stripped, punctuation removed, and the
scan's digit-for-letter substitutions undone (`l6po` → `lopo`, `c4gon` →
`cagon`; digits never occur in these names, so a digit is always a misread
letter). An undecodable glyph becomes ``, which the client matcher treats
as a wildcard so a half-read name is still findable.

`app/js/search.js` applies the same folding to the query, then ranks: exact,
prefix, substring, one-letter-different, scientific-name match.
