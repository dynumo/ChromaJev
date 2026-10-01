import { hexToOklch, type Oklch } from './oklch.js';

/**
 * The bounded colour vocabulary Jev evaluates. Jev judges *named* colours far
 * more reliably than hex values, so the name and descriptor are what it sees;
 * hex and OKLCH stay in code.
 *
 * IDs are stable. Changing the set, the names or the descriptors changes what
 * Jev was asked, so bump CATALOGUE_VERSION — that invalidates cached
 * evaluations made against the old vocabulary.
 */
export const CATALOGUE_VERSION = 'cat-2';

export const HUE_FAMILIES = [
  'red',
  'orange',
  'yellow',
  'green',
  'teal',
  'cyan',
  'blue',
  'purple',
  'pink',
  'brown',
] as const;
export const NEUTRAL_FAMILIES = ['warm-grey', 'cool-grey', 'neutral-grey', 'near-black', 'near-white'] as const;

export type HueFamily = (typeof HUE_FAMILIES)[number];
export type NeutralFamily = (typeof NEUTRAL_FAMILIES)[number];
export type Family = HueFamily | NeutralFamily;

export interface CatalogueColour {
  id: string;
  name: string;
  hex: string;
  family: Family;
  /** One-line description shown to Jev alongside the name. */
  descriptor: string;
  oklch: Oklch;
  /** True for colours with enough chroma to carry a brand role. */
  chromatic: boolean;
}

type Entry = [id: string, name: string, hex: string, descriptor: string];

const RAW: Record<Family, Entry[]> = {
  red: [
    ['red-blush', 'Blush red', '#f3b6b0', 'a pale, soft red'],
    ['red-coral', 'Coral red', '#ef6f5e', 'a light, warm red with a coral tint'],
    ['red-scarlet', 'Scarlet', '#e3242b', 'a bright, vivid red'],
    ['red-crimson', 'Crimson', '#b5162b', 'a deep, slightly bluish red'],
    ['red-brick', 'Brick red', '#a1402f', 'an earthy, muted red like fired brick'],
    ['red-oxblood', 'Oxblood', '#5c1a1b', 'a very dark, brownish red'],
  ],
  orange: [
    ['orange-peach', 'Peach', '#f9c9a5', 'a pale, soft orange'],
    ['orange-apricot', 'Apricot', '#f6a15b', 'a light, warm orange'],
    ['orange-tangerine', 'Tangerine', '#f57c1f', 'a bright, vivid orange'],
    ['orange-burnt', 'Burnt orange', '#c4561b', 'a deep, earthy orange'],
    ['orange-terracotta', 'Terracotta', '#c0674a', 'a muted, clay-coloured orange'],
    ['orange-rust', 'Rust', '#8b3a14', 'a dark, reddish-brown orange'],
  ],
  yellow: [
    ['yellow-butter', 'Butter yellow', '#f8e9a1', 'a pale, creamy yellow'],
    ['yellow-lemon', 'Lemon', '#f7e34b', 'a light, fresh, sharp yellow'],
    ['yellow-sunflower', 'Sunflower', '#f5c518', 'a bright, saturated golden yellow'],
    ['yellow-gold', 'Gold', '#d4a72c', 'a warm, rich, gold-like yellow'],
    ['yellow-amber', 'Amber', '#e09b0d', 'a deep orange-yellow'],
    ['yellow-mustard', 'Mustard', '#b8961f', 'a muted, earthy yellow'],
  ],
  green: [
    ['green-mint', 'Mint', '#b8e6c9', 'a pale, fresh green'],
    ['green-lime', 'Lime', '#a4d233', 'a bright, zesty yellow-green'],
    ['green-sage', 'Sage', '#9caf88', 'a muted, soft grey-green'],
    ['green-leaf', 'Leaf green', '#4caf50', 'a bright, natural green'],
    ['green-emerald', 'Emerald', '#0f9d58', 'a vivid, jewel-like green'],
    ['green-forest', 'Forest green', '#2e5d34', 'a deep, dark woodland green'],
    ['green-olive', 'Olive', '#6b6b2a', 'a dark, yellowish green'],
  ],
  teal: [
    ['teal-seafoam', 'Seafoam', '#a8dfd2', 'a pale, soft blue-green'],
    ['teal-aqua', 'Aqua', '#3fc1b0', 'a bright, clear blue-green'],
    ['teal-verdigris', 'Verdigris', '#4d9a8b', 'a muted, weathered blue-green'],
    ['teal-teal', 'Teal', '#0f8b8d', 'a mid, balanced blue-green'],
    ['teal-deep', 'Deep teal', '#0b5e63', 'a dark, rich blue-green'],
  ],
  cyan: [
    ['cyan-ice', 'Ice blue', '#cdeef5', 'a very pale, cold cyan'],
    ['cyan-glacier', 'Glacier', '#8ecae6', 'a light, cool, airy blue-cyan'],
    ['cyan-cyan', 'Cyan', '#00b4d8', 'a bright, electric blue-green'],
    ['cyan-cerulean', 'Cerulean', '#0089b8', 'a clear, mid sky blue with a hint of green'],
    ['cyan-petrol', 'Petrol', '#1f4e5f', 'a dark, greyish blue-green'],
  ],
  blue: [
    ['blue-powder', 'Powder blue', '#c6d8f0', 'a pale, soft blue'],
    ['blue-cornflower', 'Cornflower', '#6495ed', 'a light, friendly mid blue'],
    ['blue-azure', 'Azure', '#1e88e5', 'a bright, clear blue'],
    ['blue-electric', 'Electric blue', '#2f6bff', 'a vivid, glowing blue'],
    ['blue-cobalt', 'Cobalt', '#0047ab', 'a deep, saturated blue'],
    ['blue-steel', 'Steel blue', '#4a6b8a', 'a muted, greyish blue'],
    ['blue-navy', 'Navy', '#1b2a4a', 'a very dark blue'],
  ],
  purple: [
    ['purple-lavender', 'Lavender', '#d8c8ee', 'a pale, soft purple'],
    ['purple-lilac', 'Lilac', '#b294d6', 'a light, gentle purple'],
    ['purple-amethyst', 'Amethyst', '#9966cc', 'a mid, jewel-like purple'],
    ['purple-violet', 'Violet', '#7c3aed', 'a bright, vivid purple'],
    ['purple-mauve', 'Mauve', '#9d7f9a', 'a muted, greyish purple'],
    ['purple-indigo', 'Indigo', '#3f2b96', 'a deep blue-purple'],
    ['purple-plum', 'Plum', '#6e2a5c', 'a dark, reddish purple'],
  ],
  pink: [
    ['pink-petal', 'Petal pink', '#f9d3e0', 'a pale, delicate pink'],
    ['pink-bubblegum', 'Bubblegum', '#ff8fc4', 'a light, playful pink'],
    ['pink-hot', 'Hot pink', '#ff2d87', 'a bright, vivid pink'],
    ['pink-magenta', 'Magenta', '#d0158f', 'a deep, purplish pink'],
    ['pink-dusty', 'Dusty rose', '#c48b93', 'a muted, greyish pink'],
    ['pink-raspberry', 'Raspberry', '#a3154f', 'a dark, red-pink'],
  ],
  brown: [
    ['brown-sand', 'Sand', '#e0c9a6', 'a pale, warm beige'],
    ['brown-caramel', 'Caramel', '#c68a4a', 'a light, golden brown'],
    ['brown-tan', 'Tan', '#b08d63', 'a muted, light brown'],
    ['brown-copper', 'Copper', '#b8733a', 'a reddish, copper-like brown'],
    ['brown-ochre', 'Ochre', '#a9781c', 'an earthy yellow-brown'],
    ['brown-walnut', 'Walnut', '#6f4a2e', 'a mid-dark wood brown'],
    ['brown-chocolate', 'Chocolate', '#4a2c1d', 'a very dark brown'],
  ],
  'warm-grey': [
    ['warmgrey-stone', 'Stone', '#d1c9bd', 'a light, warm grey'],
    ['warmgrey-pebble', 'Pebble', '#a8a097', 'a soft, mid warm grey'],
    ['warmgrey-taupe', 'Taupe', '#857869', 'a brownish mid grey'],
    ['warmgrey-umber', 'Umber grey', '#4f4840', 'a dark, warm brown-grey'],
  ],
  'cool-grey': [
    ['coolgrey-mist', 'Mist', '#dfe4ea', 'a light, cool grey'],
    ['coolgrey-silver', 'Silver', '#b8c0c8', 'a light, metallic-looking grey'],
    ['coolgrey-slate', 'Slate', '#708090', 'a mid, bluish grey'],
    ['coolgrey-pewter', 'Pewter', '#5b6770', 'a dark-mid, blue-grey metal tone'],
    ['coolgrey-gunmetal', 'Gunmetal', '#2f3a42', 'a dark, bluish grey'],
  ],
  'neutral-grey': [
    ['grey-ash', 'Ash', '#c4c4c2', 'a light, neutral grey'],
    ['grey-concrete', 'Concrete', '#8f8f8c', 'a flat, mid neutral grey like poured concrete'],
    ['grey-charcoal', 'Charcoal', '#36383a', 'a dark, neutral grey'],
  ],
  'near-black': [
    ['black-ink', 'Ink', '#12141a', 'a near-black with a hint of blue'],
    ['black-espresso', 'Espresso', '#1d1612', 'a near-black with a warm brown tint'],
    ['black-jet', 'Jet black', '#0b0b0b', 'a pure, deep black'],
  ],
  'near-white': [
    ['white-paper', 'Paper white', '#fbfaf7', 'a clean, neutral off-white'],
    ['white-ivory', 'Ivory', '#f8f3e6', 'a warm, soft off-white'],
    ['white-cream', 'Cream', '#f3ead3', 'a rich, yellowish off-white'],
    ['white-frost', 'Frost', '#f1f5fa', 'a cool, bluish off-white'],
  ],
};

export const CATALOGUE: readonly CatalogueColour[] = Object.freeze(
  (Object.entries(RAW) as [Family, Entry[]][]).flatMap(([family, entries]) =>
    entries.map(([id, name, hex, descriptor]) => {
      const oklch = hexToOklch(hex);
      return Object.freeze({
        id,
        name,
        hex,
        family,
        descriptor,
        oklch,
        chromatic: (HUE_FAMILIES as readonly string[]).includes(family) && oklch.c >= 0.045,
      });
    }),
  ),
);

const BY_ID = new Map(CATALOGUE.map((c) => [c.id, c]));

export function getCatalogueColour(id: string): CatalogueColour | undefined {
  return BY_ID.get(id);
}

export function isHueFamily(f: string): f is HueFamily {
  return (HUE_FAMILIES as readonly string[]).includes(f);
}

/** A stable fingerprint of the catalogue contents (used in tests to force version bumps). */
export function catalogueFingerprint(): string {
  return CATALOGUE.map((c) => `${c.id}|${c.name}|${c.hex}|${c.descriptor}`).join('\n');
}
