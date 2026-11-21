/**
 * pigments.js — the single source of truth for every pigment on the page.
 * Sections, the fluid dish, the labs and the shop all read from here.
 *
 * Colours are display colours for the dry masstone (`hex`) and for a thin
 * wash / tint (`tint`). `ink` is the text colour that reads on a full field
 * of the pigment. Facts are conservative; keep them that way.
 *
 * `sold: false` pigments are toxic historic colours: shown in the library,
 * never offered for sale ("Archive only").
 */

export const PIGMENTS = [
  {
    id: 'yellow-ochre',
    name: 'Yellow ochre',
    source: 'earth',
    material: 'Iron-rich clay',
    origin: 'Roussillon, France',
    formula: 'FeO(OH)·<i>n</i>H<sub>2</sub>O',
    chemistry: 'Goethite, an iron oxyhydroxide, in clay',
    era: 'At least 100,000 years ago',
    year: -100000,
    hex: '#c8922e',
    tint: '#e8c98a',
    ink: '#1d1307',
    fact:
      'The oldest colour people used. A paint workshop about 100,000 years old, with ochre mixed and stored in abalone shells, was found in Blombos Cave, South Africa.',
    price: 14,
    unit: '50 g',
    sold: true,
  },
  {
    id: 'red-ochre',
    name: 'Red ochre',
    source: 'earth',
    material: 'Iron-rich clay, burnt',
    origin: 'Cyprus',
    formula: 'Fe<sub>2</sub>O<sub>3</sub>',
    chemistry: 'Hematite, an iron oxide',
    era: 'Prehistoric',
    year: -90000,
    hex: '#9e3b22',
    tint: '#d9937d',
    ink: '#fbeee8',
    fact:
      'Heat yellow ochre and it turns red: the water leaves the goethite and hematite forms. Painters have been burning earth for colour since prehistory.',
    price: 14,
    unit: '50 g',
    sold: true,
  },
  {
    id: 'egyptian-blue',
    name: 'Egyptian blue',
    source: 'kiln',
    material: 'Sand, copper and lime, fired together',
    origin: 'Egypt',
    formula: 'CaCuSi<sub>4</sub>O<sub>10</sub>',
    chemistry: 'Calcium copper silicate',
    era: 'More than 4,500 years ago',
    year: -2600,
    hex: '#1f6aa8',
    tint: '#8db8db',
    ink: '#f2f7fb',
    fact:
      'The first colour anyone made rather than found. Lit by ordinary light, it gives off infrared that a camera can see, which is how conservators find its traces on ancient statues.',
    price: 38,
    unit: '20 g',
    sold: true,
  },
  {
    id: 'tyrian-purple',
    name: 'Tyrian purple',
    source: 'shell',
    material: 'Glands of murex sea snails',
    origin: 'Tyre, on the coast of Lebanon',
    formula: 'C<sub>16</sub>H<sub>8</sub>Br<sub>2</sub>N<sub>2</sub>O<sub>2</sub>',
    chemistry: '6,6′-dibromoindigo',
    era: 'Phoenician, from about 1500 BCE',
    year: -1500,
    hex: '#6a1e55',
    tint: '#b98aa8',
    ink: '#fbeff6',
    fact:
      'Thousands of snails give a single gram. In late imperial Rome, the law reserved the finest purple for the emperor.',
    price: 2600,
    unit: '1 g',
    sold: true,
    rare: 'Two grams a year',
  },
  {
    id: 'malachite',
    name: 'Malachite',
    source: 'stone',
    material: 'Banded green copper ore',
    origin: 'Katanga, Democratic Republic of the Congo',
    formula: 'Cu<sub>2</sub>CO<sub>3</sub>(OH)<sub>2</sub>',
    chemistry: 'Basic copper carbonate',
    era: 'Ancient Egypt',
    year: -3000,
    hex: '#2e8b62',
    tint: '#9fd1b8',
    ink: '#f0fbf5',
    fact: 'Ground malachite was worn as green eye paint in ancient Egypt, long before it reached a painter’s palette.',
    price: 26,
    unit: '20 g',
    sold: true,
  },
  {
    id: 'orpiment',
    name: 'Orpiment',
    source: 'stone',
    material: 'A soft golden mineral',
    origin: 'Anatolia',
    formula: 'As<sub>2</sub>S<sub>3</sub>',
    chemistry: 'Arsenic sulfide',
    era: 'Ancient Egypt to the 19th century',
    year: -1300,
    hex: '#f0b22b',
    tint: '#f8dc93',
    ink: '#231803',
    fact: 'Its name comes from the Latin auripigmentum, “gold paint”. It is also arsenic, and it was used anyway for three thousand years.',
    price: null,
    unit: null,
    sold: false,
  },
  {
    id: 'ultramarine',
    name: 'Ultramarine',
    source: 'stone',
    material: 'Lapis lazuli',
    origin: 'Sar-e-Sang, Badakhshan, Afghanistan',
    formula: '(Na,Ca)<sub>8</sub>(AlSiO<sub>4</sub>)<sub>6</sub>(S,SO<sub>4</sub>,Cl)<sub>2</sub>',
    chemistry: 'Lazurite, a sodium aluminium silicate holding sulfur',
    era: 'Afghan cave paintings, 6th century; Renaissance Italy',
    year: 600,
    hex: '#1e3a9e',
    tint: '#8798d4',
    ink: '#f1f3fc',
    fact:
      'Its name means “beyond the sea”. In Renaissance Italy the best grade could cost more than gold, so contracts stated how much of it a painter had to use.',
    price: 180,
    unit: '5 g',
    sold: true,
  },
  {
    id: 'vermilion',
    name: 'Vermilion',
    source: 'stone',
    material: 'Cinnabar, or mercury and sulfur heated together',
    origin: 'Almadén, Spain',
    formula: 'HgS',
    chemistry: 'Mercury sulfide',
    era: 'Roman, then medieval Europe',
    year: -100,
    hex: '#e03a27',
    tint: '#f2a497',
    ink: '#fff2ef',
    fact: 'Medieval alchemists made it from mercury and sulfur, which seemed close to magic. It is toxic, and it can darken in sunlight.',
    price: null,
    unit: null,
    sold: false,
  },
  {
    id: 'lead-white',
    name: 'Lead white',
    source: 'metal',
    material: 'Lead, vinegar and heat',
    origin: 'Venice and the Low Countries',
    formula: '2PbCO<sub>3</sub>·Pb(OH)<sub>2</sub>',
    chemistry: 'Basic lead carbonate',
    era: 'Antiquity to the 20th century',
    year: -400,
    hex: '#eeebe3',
    tint: '#f7f5ef',
    ink: '#1c1a17',
    fact:
      'Made by the stack process: strips of lead over pots of vinegar, buried in dung for weeks. Nearly every Old Master painting is built on it. It is poisonous.',
    price: null,
    unit: null,
    sold: false,
  },
  {
    id: 'carmine',
    name: 'Carmine',
    source: 'insect',
    material: 'Cochineal insects from prickly pear cactus',
    origin: 'Oaxaca, Mexico',
    formula: 'C<sub>22</sub>H<sub>20</sub>O<sub>13</sub>',
    chemistry: 'Carminic acid',
    era: 'Mixtec and Aztec Mexico; in Europe from the 16th century',
    year: 1520,
    hex: '#a3123a',
    tint: '#df8aa1',
    ink: '#fff0f4',
    fact:
      'About 70,000 dried insects make a pound of dye. Under Spanish rule it became one of Mexico’s most valuable exports, second only to silver.',
    price: 34,
    unit: '10 g',
    sold: true,
  },
  {
    id: 'indigo',
    name: 'Indigo',
    source: 'plant',
    material: 'Leaves of Indigofera tinctoria',
    origin: 'Bengal, India',
    formula: 'C<sub>16</sub>H<sub>10</sub>N<sub>2</sub>O<sub>2</sub>',
    chemistry: 'Indigotin',
    era: 'At least 6,000 years ago',
    year: -4000,
    hex: '#27306b',
    tint: '#8d93c2',
    ink: '#eef0fb',
    fact: 'The leaves are fermented in water and the dye that forms is a pale yellow-green. It only turns blue when the air reaches it.',
    price: 18,
    unit: '20 g',
    sold: true,
  },
  {
    id: 'bone-black',
    name: 'Bone black',
    source: 'bone',
    material: 'Bone, charred without air',
    origin: 'Everywhere',
    formula: 'C + Ca<sub>3</sub>(PO<sub>4</sub>)<sub>2</sub>',
    chemistry: 'Carbon and calcium phosphate',
    era: 'Prehistoric to today',
    year: -30000,
    hex: '#1c1a19',
    tint: '#8a8784',
    ink: '#f3f1ee',
    fact: 'Burn bone without air and what is left is a warm, deep black. The finest version, ivory black, is no longer made.',
    price: 12,
    unit: '50 g',
    sold: true,
  },
]

export const BY_ID = Object.fromEntries(PIGMENTS.map((p) => [p.id, p]))

/** The six pigments that get a full chapter, oldest to newest (by `year`). */
export const CHAPTERS = ['yellow-ochre', 'bone-black', 'egyptian-blue', 'tyrian-purple', 'ultramarine', 'carmine'] // oldest to newest

/** The paper the dish starts on and returns to between fields. */
export const PAPER = { id: 'paper', name: 'Paper', hex: '#f3f2ee', tint: '#f3f2ee', ink: '#151413' }

export const SOURCES = {
  earth: 'Earth',
  kiln: 'Kiln',
  shell: 'Shell',
  stone: 'Stone',
  metal: 'Metal',
  insect: 'Insect',
  plant: 'Plant',
  bone: 'Bone',
}

export const formatPrice = (p) => (p == null ? null : '£' + p.toLocaleString('en-GB'))

/**
 * The field colours as CSS: one rule per pigment (and paper), keyed by
 * [data-field], setting --field, --tint, --ink, --ink-2, --ink-3 and --line.
 * vite.config.js inlines this into index.html at build time, so every field
 * has its colours before any script runs (and without JavaScript at all);
 * palette.js injects it only if that inline copy is missing.
 */
export function fieldCSS() {
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(' ')
  return [PAPER, ...PIGMENTS]
    .map(
      (p) =>
        `[data-field="${p.id}"]{--field:${p.hex};--tint:${p.tint};--ink:${p.ink};` +
        `--ink-2:rgb(${rgb(p.ink)} / 0.84);--ink-3:rgb(${rgb(p.ink)} / 0.68);--line:rgb(${rgb(p.ink)} / 0.24);}`
    )
    .join('\n')
}
