/**
 * FRYBIRD's menu, transcribed from the printed menu boards.
 *
 * Source: `Fast Food Menu Board (7)/Artboard 8, 8(1), 9, 10.pdf` — Burgers,
 * Wraps & Fries, Chicken & Mac, and Smash Burger.
 *
 * Prices are written as rupee strings exactly as printed, not as paise, so
 * this file can be checked against the board by eye. `seed.ts` converts them
 * through `fromRupees`, which is the only thing that turns a written amount
 * into money.
 *
 * Nothing here is estimated. Where the board does not state a figure — drink
 * prices, ingredient costs — the field is absent and the gap is tracked in the
 * README rather than filled with a guess.
 */

export type VegClass = "VEG" | "NON_VEG";

export interface MenuProduct {
  slug: string;
  name: string;
  /** Rupees, as printed on the board. */
  price: string;
  veg: VegClass;
  description?: string;
  /** 0 is not spicy. Read from the board's naming, not invented nutrition. */
  spice?: number;
  modifierGroups?: string[];
}

export interface MenuCategory {
  slug: string;
  name: string;
  products: MenuProduct[];
}

/**
 * GST rates.
 *
 * Restaurant service is 5% without input tax credit under SAC 996331 — the
 * rate that applies to everything FRYBIRD cooks and serves. Packaged aerated
 * drinks are not restaurant service and are taxed separately, which is why
 * they need their own rate rather than inheriting the default.
 */
export const TAX_RATES = [
  { slug: "restaurant-5", name: "Restaurant service 5%", rateBps: 500, hsnCode: "996331", isDefault: true },
  { slug: "aerated-28", name: "Aerated beverage 28%", rateBps: 2800, hsnCode: "2202", isDefault: false },
] as const;

/**
 * Chicken is sold in three cuts, each in three heat levels and two sizes.
 *
 * Modelled as three products with two required modifier groups rather than
 * eighteen separate products. §12: "Do not hard-code modifiers into each
 * product component. Model them."
 *
 * The deltas are uniform across the board — every heat level is +₹20 over
 * Classic at both sizes — which is what makes this collapse cleanly. If a
 * future price list breaks that pattern, the deltas stop working and
 * `menu-data.test.ts` fails rather than quietly charging the wrong price.
 */
export const CHICKEN_HEAT = [
  { slug: "classic", name: "Classic", delta: "0", spice: 1 },
  // Printed as "GRAZY BIRD" on the board. Kept as printed — it reads as
  // deliberate brand spelling, not a typo to correct silently.
  { slug: "grazy-bird", name: "Grazy Bird", delta: "20", spice: 3 },
  { slug: "nashville", name: "Nashville", delta: "20", spice: 4 },
] as const;

export const CHICKEN_CUTS = [
  {
    slug: "popcorn-chicken",
    name: "Popcorn Chicken",
    basePrice: "179",
    sizes: [
      { slug: "small", name: "Small", delta: "0" },
      { slug: "large", name: "Large", delta: "140" },
    ],
  },
  {
    slug: "chicken-wings",
    name: "Chicken Wings",
    basePrice: "159",
    sizes: [
      { slug: "4pc", name: "4 pc", delta: "0" },
      { slug: "8pc", name: "8 pc", delta: "120" },
    ],
  },
  {
    slug: "chicken-tenders",
    name: "Chicken Tenders",
    basePrice: "189",
    sizes: [
      { slug: "4pc", name: "4 pc", delta: "0" },
      { slug: "6pc", name: "6 pc", delta: "90" },
    ],
  },
] as const;

/**
 * The printed price matrix, kept verbatim.
 *
 * This is the check on the deltas above: `menu-data.test.ts` reconstructs
 * every cell from base + size + heat and asserts it equals what the board
 * says. A modifier model that does not reproduce the printed menu is a
 * modifier model that overcharges a customer.
 */
export const CHICKEN_PRINTED_PRICES: Record<string, Record<string, Record<string, string>>> = {
  "popcorn-chicken": {
    classic: { small: "179", large: "319" },
    "grazy-bird": { small: "199", large: "339" },
    nashville: { small: "199", large: "339" },
  },
  "chicken-wings": {
    classic: { "4pc": "159", "8pc": "279" },
    "grazy-bird": { "4pc": "179", "8pc": "299" },
    nashville: { "4pc": "179", "8pc": "299" },
  },
  "chicken-tenders": {
    classic: { "4pc": "189", "6pc": "279" },
    "grazy-bird": { "4pc": "209", "6pc": "299" },
    nashville: { "4pc": "209", "6pc": "299" },
  },
};

/** Dips, sold as add-ons and on their own. */
export const SAUCES = [
  { slug: "signature-mayo", name: "Signature Mayo", price: "20", veg: "VEG" as const },
  { slug: "green-sauce", name: "Green Sauce", price: "20", veg: "VEG" as const },
  { slug: "garlic-sauce", name: "Garlic Sauce", price: "20", veg: "VEG" as const },
  { slug: "garlic-parmesan", name: "Garlic Parmesan", price: "25", veg: "VEG" as const },
  { slug: "peri-peri-mayo", name: "Peri Peri Mayo", price: "25", veg: "VEG" as const },
  { slug: "chipotle-sauce", name: "Chipotle Sauce", price: "25", veg: "VEG" as const },
  { slug: "cheese-sauce", name: "Cheese Sauce", price: "25", veg: "VEG" as const },
];

export const CATEGORIES: MenuCategory[] = [
  {
    slug: "burgers",
    name: "Burgers",
    products: [
      { slug: "og-frybird-classic", name: "OG Frybird Classic", price: "99", veg: "NON_VEG", spice: 1, description: "Crispy chicken, signature mayo, fresh veggies, brioche bun." },
      { slug: "thunder-burger", name: "Thunder Burger", price: "109", veg: "NON_VEG", spice: 2, description: "Crispy chicken, triple garlic, garlic sauce, cheese." },
      { slug: "the-chipotle-burger", name: "The Chipotle Burger", price: "129", veg: "NON_VEG", spice: 3, description: "Smoky chipotle chicken, fire sauce, slaw, cheese." },
      { slug: "nashville-bomb", name: "Nashville Bomb", price: "139", veg: "NON_VEG", spice: 4, description: "Nashville hot chicken, honey, fire sauce, coleslaw." },
      { slug: "peri-inferno", name: "Peri Inferno", price: "109", veg: "NON_VEG", spice: 4, description: "Peri-peri chicken, fire sauce, peri mayo, cheese." },
      { slug: "paneer-champ", name: "Paneer Champ", price: "89", veg: "VEG", spice: 2, description: "Crispy tandoori paneer, garlic sauce, cheese." },
      { slug: "aloo-tikki-maharaja", name: "Aloo Tikki Maharaja", price: "59", veg: "VEG", spice: 1, description: "Crispy aloo tikki, sev and sauces." },
      { slug: "cheese-volcano", name: "Cheese Volcano", price: "109", veg: "VEG", spice: 1, description: "Cheese-stuffed potato patty, double cheese, cheese pull moment." },
    ],
  },
  {
    slug: "smash-burgers",
    name: "Smash Burgers",
    products: [
      { slug: "og-smash", name: "OG Smash", price: "149", veg: "NON_VEG", spice: 1, description: "Crispy. Juicy. Perfectly smashed." },
      { slug: "nashville-smash", name: "Nashville Smash", price: "159", veg: "NON_VEG", spice: 4 },
      { slug: "chipotle-smash", name: "Chipotle Smash", price: "159", veg: "NON_VEG", spice: 3 },
      { slug: "double-smash", name: "Double Smash", price: "179", veg: "NON_VEG", spice: 1 },
    ],
  },
  {
    slug: "wraps",
    name: "Wraps",
    products: [
      { slug: "the-og-wrap", name: "The OG Wrap", price: "119", veg: "NON_VEG", spice: 1, description: "Crispy chicken, signature mayo, fresh veggies, tortilla." },
      { slug: "the-thunder-wrap", name: "The Thunder Wrap", price: "129", veg: "NON_VEG", spice: 2, description: "Crispy chicken, triple garlic, garlic sauce, cheese." },
      { slug: "chipotle-crunch-wrap", name: "Chipotle Crunch Wrap", price: "139", veg: "NON_VEG", spice: 3, description: "Smoky chipotle chicken, fire sauce, coleslaw." },
      { slug: "nashville-fire-wrap", name: "Nashville Fire Wrap", price: "149", veg: "NON_VEG", spice: 4, description: "Nashville hot chicken, honey, fire sauce, coleslaw." },
      { slug: "crispy-paneer-wrap", name: "Crispy Paneer Wrap", price: "109", veg: "VEG", spice: 2, description: "Crispy paneer, garlic sauce, cheese sauce." },
      { slug: "aloo-chatpata-wrap", name: "Aloo Chatpata Wrap", price: "79", veg: "VEG", spice: 1, description: "Crispy aloo tikki, sev and green chutney." },
    ],
  },
  {
    slug: "fries",
    name: "Fries",
    products: [
      { slug: "og-salt-fries", name: "OG Salt Fries", price: "99", veg: "VEG", spice: 0, description: "Crispy golden fries, sea salt." },
      { slug: "peri-peri-fries", name: "Peri Peri Fries", price: "119", veg: "VEG", spice: 3, description: "Crispy fries, bold peri-peri spice." },
      { slug: "garlic-parmesan-fries", name: "Garlic Parmesan Fries", price: "139", veg: "VEG", spice: 0, description: "Crispy fries, garlic, parmesan." },
      { slug: "chilli-cheese-fries", name: "Chilli Cheese Fries", price: "149", veg: "VEG", spice: 3, description: "Cheesy fries, fresh green chilli, melted goodness." },
      { slug: "nachos-loaded-fries", name: "Nachos Loaded Fries", price: "179", veg: "VEG", spice: 2, description: "Loaded fries, paneer, cheese, peppers, jalapeños." },
      { slug: "frybird-loaded-fries", name: "Frybird Loaded Fries", price: "199", veg: "NON_VEG", spice: 2, description: "Loaded fries, crispy chicken, cheese, jalapeños." },
    ],
  },
  {
    slug: "mac-and-cheese",
    name: "Mac & Cheese",
    products: [
      { slug: "classic-mac-and-cheese", name: "Classic Mac & Cheese", price: "199", veg: "VEG", spice: 0 },
      { slug: "paneer-mac-and-cheese", name: "Paneer Mac & Cheese", price: "239", veg: "VEG", spice: 1 },
      { slug: "chicken-mac-and-cheese", name: "Chicken Mac & Cheese", price: "259", veg: "NON_VEG", spice: 1 },
      { slug: "nashville-chicken-mac-and-cheese", name: "Nashville Chicken Mac & Cheese", price: "279", veg: "NON_VEG", spice: 4 },
      { slug: "chicken-loaded-mac-and-fries", name: "Chicken Loaded Mac & Fries", price: "289", veg: "NON_VEG", spice: 2 },
      { slug: "og-mac-smash", name: "OG Mac Smash", price: "319", veg: "NON_VEG", spice: 2 },
    ],
  },
  {
    slug: "rice-bowls",
    name: "Rice Bowls",
    products: [
      { slug: "classic-rice-bowl", name: "Classic Rice Bowl", price: "129", veg: "VEG", spice: 1 },
      { slug: "paneer-rice-bowl", name: "Paneer Rice Bowl", price: "169", veg: "VEG", spice: 1 },
      { slug: "frybird-rice-bowl", name: "Frybird Rice Bowl", price: "199", veg: "NON_VEG", spice: 2 },
    ],
  },
];

/**
 * Combos and party boxes.
 *
 * `components` names the products a combo contains, so the kitchen ticket
 * shows real items and food cost resolves through their recipes rather than
 * treating the combo as an opaque SKU.
 *
 * Cola is listed as a component but has no product to point at — see the gaps
 * below.
 */
export const COMBOS = [
  {
    slug: "solo-combo",
    name: "Solo Combo",
    price: "149",
    veg: "VEG" as const,
    description: "Aloo Tikki Burger, salt fries and a cola.",
    components: ["aloo-tikki-maharaja", "og-salt-fries"],
    unresolved: ["cola"],
  },
  {
    slug: "frybird-combo",
    name: "Frybird Combo",
    price: "199",
    veg: "NON_VEG" as const,
    description: "OG Classic Burger, peri fries and a cola.",
    components: ["og-frybird-classic", "peri-peri-fries"],
    unresolved: ["cola"],
  },
  {
    slug: "boss-combo",
    name: "Boss Combo",
    price: "269",
    veg: "NON_VEG" as const,
    description: "Nashville Bomb, chilli cheese fries and a cola.",
    components: ["nashville-bomb", "chilli-cheese-fries"],
    unresolved: ["cola"],
  },
  {
    slug: "wings-party-box",
    name: "Wings Party Box",
    price: "299",
    veg: "NON_VEG" as const,
    description: "4 chicken wings, regular fries, 2 dips of your choice and 2 drinks.",
    components: ["chicken-wings", "og-salt-fries"],
    unresolved: ["2 dips (choice)", "2 drinks"],
  },
  {
    slug: "tenders-boss-box",
    name: "Tenders Boss Box",
    price: "329",
    veg: "NON_VEG" as const,
    description: "4 chicken tenders, regular fries, 2 dips of your choice and 2 drinks.",
    components: ["chicken-tenders", "og-salt-fries"],
    unresolved: ["2 dips (choice)", "2 drinks"],
  },
  {
    slug: "popcorn-party-box",
    name: "Popcorn Party Box",
    price: "399",
    veg: "NON_VEG" as const,
    description: "Large popcorn chicken, regular fries, 2 dips of your choice and 2 drinks.",
    components: ["popcorn-chicken", "og-salt-fries"],
    unresolved: ["2 dips (choice)", "2 drinks"],
  },
];

/**
 * What the boards do not say is tracked as an open checklist in README.md,
 * under "Open questions".
 *
 * Deliberately not a constant in this file. A list of unresolved decisions
 * belongs where someone opening the repo will read it, not buried in a data
 * module that only gets opened when the menu changes.
 *
 * The rule it follows: where the boards do not state a figure, the field above
 * is absent. Nothing here is estimated. §33 forbids the AI inventing a price,
 * and the same applies to seed data — a plausible number in the database is
 * indistinguishable from a real one three months later.
 */
