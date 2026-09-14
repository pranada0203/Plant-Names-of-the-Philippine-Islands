'use strict';
/**
 * Family-name repair.
 *
 * The 1903 printer set family names with an "ae" ligature that the scan's OCR
 * reads as `e`, `w` or `ew` -- "Apocinacee", "Amarantacew", "Legwminosew".
 * Left alone this shatters a single family into four spellings, which makes
 * family a useless facet. We repair the ligature mechanically, then snap the
 * result to the closest name in Merrill's own family list.
 */

/**
 * Families as they appear in the 1903 text. Several are Merrill-era names that
 * no modern list carries (Cupuliferae, Ilicineae, Ficoideae); they are kept as
 * printed rather than silently modernised.
 */
const FAMILIES = [
  'Alismaceae', 'Ampelidaceae', 'Araceae', 'Bromeliaceae', 'Chailletiaceae',
  'Cornaceae', 'Cupuliferae', 'Datiscaceae', 'Elaeagnaceae', 'Eriocaulonaceae',
  'Ficoideae', 'Geraniaceae', 'Gymnosporiaceae', 'Ilicineae', 'Juncaceae',
  'Lemnaceae', 'Olacineae', 'Samydaceae', 'Selaginellaceae',
  'Acanthaceae', 'Amarantaceae', 'Amaryllidaceae', 'Anacardiaceae', 'Anonaceae',
  'Apocinaceae', 'Aquifoliaceae', 'Araliaceae', 'Aristolochiaceae', 'Aroideae',
  'Asclepiadaceae', 'Balsaminaceae', 'Begoniaceae', 'Bignoniaceae', 'Bixaceae',
  'Bombacaceae', 'Boraginaceae', 'Burseraceae', 'Cactaceae', 'Caesalpiniaceae',
  'Campanulaceae', 'Cannaceae', 'Capparidaceae', 'Caprifoliaceae', 'Caricaceae',
  'Caryophyllaceae', 'Casuarinaceae', 'Celastraceae', 'Chenopodiaceae',
  'Combretaceae', 'Commelinaceae', 'Compositae', 'Coniferae', 'Connaraceae',
  'Convolvulaceae', 'Crassulaceae', 'Cruciferae', 'Cucurbitaceae', 'Cyatheaceae',
  'Cycadaceae', 'Cyperaceae', 'Dilleniaceae', 'Dioscoreaceae', 'Dipterocarpaceae',
  'Droseraceae', 'Ebenaceae', 'Elaeocarpaceae', 'Ericaceae', 'Erythroxylaceae',
  'Euphorbiaceae', 'Filices', 'Flacourtiaceae', 'Gentianaceae', 'Gesneraceae',
  'Gnetaceae', 'Goodeniaceae', 'Gramineae', 'Guttiferae', 'Hamamelidaceae',
  'Hernandiaceae', 'Hippocrateaceae', 'Hydrocharitaceae', 'Hypericaceae',
  'Icacinaceae', 'Iridaceae', 'Juglandaceae', 'Labiatae', 'Lauraceae',
  'Lecythidaceae', 'Leguminosae', 'Lentibulariaceae', 'Liliaceae', 'Linaceae',
  'Loganiaceae', 'Loranthaceae', 'Lycopodiaceae', 'Lythraceae', 'Magnoliaceae',
  'Malpighiaceae', 'Malvaceae', 'Marantaceae', 'Melastomaceae', 'Meliaceae',
  'Menispermaceae', 'Monimiaceae', 'Moraceae', 'Moringaceae', 'Musaceae',
  'Myristicaceae', 'Myrsinaceae', 'Myrtaceae', 'Najadaceae', 'Nepenthaceae',
  'Nyctaginaceae', 'Nymphaeaceae', 'Ochnaceae', 'Olacaceae', 'Oleaceae',
  'Onagraceae', 'Orchidaceae', 'Oxalidaceae', 'Palmae', 'Pandanaceae',
  'Papaveraceae', 'Passifloraceae', 'Pedaliaceae', 'Piperaceae', 'Pittosporaceae',
  'Plantaginaceae', 'Plumbaginaceae', 'Podostemaceae', 'Polygalaceae',
  'Polygonaceae', 'Polypodiaceae', 'Pontederiaceae', 'Portulacaceae',
  'Proteaceae', 'Ranunculaceae', 'Rhamnaceae', 'Rhizophoraceae', 'Rosaceae',
  'Rubiaceae', 'Rutaceae', 'Salvadoraceae', 'Santalaceae', 'Sapindaceae',
  'Sapotaceae', 'Saxifragaceae', 'Scitamineae', 'Scrophulariaceae',
  'Simarubaceae', 'Solanaceae', 'Sterculiaceae', 'Styracaceae', 'Styraceae',
  'Symplocaceae',
  'Taccaceae', 'Ternstroemiaceae', 'Theaceae', 'Thymelaeaceae', 'Tiliaceae',
  'Turneraceae', 'Typhaceae', 'Ulmaceae', 'Umbelliferae', 'Urticaceae',
  'Verbenaceae', 'Violaceae', 'Vitaceae', 'Zingiberaceae', 'Zygophyllaceae',
];

/** Strip the scan's ligature damage so the name can be matched. */
function deligature(s) {
  return s
    .replace(/\.$/, '')
    .replace(/[éw]/g, 'e')          // ae-ligature read as e or w
    .replace(/[0O]/g, 'o')
    .replace(/1/g, 'l')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

/** Levenshtein, capped: we only care about near matches. */
function distance(a, b, cap) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      if (cur[j] < best) best = cur[j];
    }
    if (best > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length];
}

const INDEX = FAMILIES.map((f) => ({ name: f, key: deligature(f) }));

/**
 * Snap an OCR'd family name to its canonical form.
 * Returns { family, confidence } - confidence 'exact' | 'fuzzy' | null.
 */
function canonicalFamily(raw) {
  if (!raw) return { family: null, confidence: null };
  const key = deligature(raw);
  if (!key) return { family: null, confidence: null };

  const exact = INDEX.find((f) => f.key === key);
  if (exact) return { family: exact.name, confidence: 'exact' };

  // Allow roughly one error per six characters - enough for "Legwminosew".
  const cap = Math.max(2, Math.round(key.length / 6) + 1);
  let best = null;
  let bestD = cap + 1;
  for (const f of INDEX) {
    const d = distance(key, f.key, cap);
    if (d < bestD) { bestD = d; best = f; }
  }
  if (best && bestD <= cap) return { family: best.name, confidence: 'fuzzy' };
  return { family: null, confidence: null, unmatched: raw };
}

module.exports = { FAMILIES, canonicalFamily, deligature };
