// How a weapon or a piece of armor reads on screen, in one place.
//
// The creation wizard and the character sheet describe the same gear and have to describe it
// identically. Before this, only the wizard described it at all — and it printed the values
// straight out of data/ ("AGILITY · MELEE"), never mentioned burden, and dropped the damage
// modifier, so a Longsword read as d10 when it hits for d10+3.
//
// Deliberately free of DOM. The two screens wrap a row differently, so what's shared is the
// text and the rules, not the elements — which also means all of this is reachable from tests/.
//
// Nothing here reads a character: a caller passes in the records and the one rule flag
// (burden-ignoring) that lives in effects.js. Formatting stays formatting.

import { escapeHtml } from "./escape.js";

// Choosing to wear nothing is a choice, and not the same as not having chosen yet: the SRD says
// "when you choose not to equip armor", and Bare Bones keys off exactly that. So it's a stored
// value rather than a null — but a marker, not a record. There is no such armor in data/, and
// nothing ever looks one up for it.
//
// It lives here because this is the equipment vocabulary both the rules and the pages share;
// putting it in either of them would have the two importing each other.
export const UNARMORED = "unarmored";

// The same idea for weapons. There's a class on the way whose whole point is fighting with
// nothing in your hands, and the SRD already gives unarmed attacks rules of their own, so
// carrying no weapon has to be something a character can say rather than something they've
// failed to fill in.
export const UNARMED = "unarmed";

// enumLabel would turn TWO_HANDED into "Two Handed"; the book hyphenates, and so does the
// wizard's own prose.
const BURDEN_LABELS = { ONE_HANDED: "One-handed", TWO_HANDED: "Two-handed" };

// "phy"/"mag" is the shorthand the wizard already used. The third value exists on exactly one
// weapon (the Ghostblade) and used to be printed as "mag", which is half wrong.
const DAMAGE_TYPE_LABELS = { PHYSICAL: "phy", MAGICAL: "mag", PHYSICAL_OR_MAGICAL: "phy/mag" };

// data/ ships traits, ranges and burdens as SCREAMING_SNAKE. Everything a player sees is
// sentence case. (Not the titleCase() the pages keep for class names — that one is single-word
// and this has to split on the underscore.)
export function enumLabel(value) {
  return String(value ?? "")
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function burdenLabel(weapon) {
  return BURDEN_LABELS[weapon?.burden] || "";
}

// The modifier is part of the weapon's damage, not a footnote to it: 20 of the 32 tier 1
// weapons have one. Proficiency multiplies the dice at the table, but this prints the rating as
// the book states it, so two weapons can be compared without doing arithmetic first.
export function damageText(weapon) {
  const d = weapon?.damage;
  if (!d?.dice) return "";
  const mod = d.modifier ? (d.modifier > 0 ? `+${d.modifier}` : String(d.modifier)) : "";
  const type = DAMAGE_TYPE_LABELS[d.type] || "";
  return `${String(d.dice).toLowerCase()}${mod}${type ? ` ${type}` : ""}`;
}

// Every part is optional. The test fixtures carry only the fields the check under test needs,
// and an unarmed profile has no burden at all, so a missing field is left out rather than
// printed as "undefined".
export function weaponStats(weapon) {
  return [
    // An unarmed profile offers a choice of two traits rather than naming one, because the SRD
    // hands that pick to the GM per roll.
    (weapon?.traits || []).map(enumLabel).join(" or ") || enumLabel(weapon?.trait),
    enumLabel(weapon?.range),
    damageText(weapon),
    burdenLabel(weapon),
  ].filter(Boolean).join(" · ");
}

export function armorStats(armor) {
  if (!armor) return "";
  const parts = [];
  if (armor.baseMajorThreshold != null && armor.baseSevereThreshold != null) {
    parts.push(`thresholds ${armor.baseMajorThreshold}/${armor.baseSevereThreshold}`);
  }
  if (armor.baseScore != null) parts.push(`score ${armor.baseScore}`);
  return parts.join(" · ");
}

export function featureText(feature) {
  return (feature.description || []).map((d) => d.paragraph?.["en-US"] || "").join(" ");
}

// Weapons and armor carry named features, several of which change a stat ("Flexible: +1 to
// Evasion"). Without them the list reads as though the only difference between two pieces of
// armor is its thresholds, which is how a player ends up surprised by their own Evasion.
export function featureLine(item) {
  const features = (item?.features || []).map((f) => {
    const name = f.name?.["en-US"] || "";
    const text = featureText(f);
    // Consumables carry a feature with no name at all ("Clear 1d4 HP."), so the colon only
    // belongs here when there's something in front of it.
    if (!name) return escapeHtml(text);
    return `<em>${escapeHtml(name)}</em>${text ? `: ${escapeHtml(text)}` : ""}`;
  });
  return features.length ? `<span class="option-feature">${features.join(" · ")}</span>` : "";
}

export function spellcastBadge() {
  return `<span class="badge-spellcast" title="Spellcasting trait">★ spellcasting</span>`;
}

export function matchesSpellcast(weapon, spellcastTrait) {
  return !!spellcastTrait && weapon?.trait === spellcastTrait;
}

// The innards of one row, without the element around it: the wizard puts a radio in front of
// this, the sheet doesn't.
export function weaponRowContent(weapon, { spellcastTrait } = {}) {
  const stats = weaponStats(weapon);
  // The badge stays on the name line; featureLine() wraps to its own line below it.
  const badge = matchesSpellcast(weapon, spellcastTrait) ? ` ${spellcastBadge()}` : "";
  return `<strong>${escapeHtml(weapon.name["en-US"])}</strong>${stats ? ` — ${escapeHtml(stats)}` : ""}` +
    `${badge}${featureLine(weapon)}`;
}

export function armorRowContent(armor) {
  const stats = armorStats(armor);
  return `<strong>${escapeHtml(armor.name["en-US"])}</strong>${stats ? ` — ${escapeHtml(stats)}` : ""}` +
    featureLine(armor);
}

// The SRD's burden rule: a two-handed primary uses both hands, so there's no hand left for a
// secondary. Said as advice rather than enforced — the table decides, and the Warrior's Combat
// Training says outright that they ignore it, so `ignoresBurden` comes in from effects.js.
export function burdenWarning(primary, secondary, ignoresBurden) {
  if (ignoresBurden || !secondary || primary?.burden !== "TWO_HANDED") return null;
  return `${primary.name["en-US"]} is two-handed, which normally leaves no hand for a secondary ` +
    `weapon. Nothing here stops you — it's your GM's call.`;
}

// Gear grouped for a picker: every tier in the book, ascending, with the groups worth reading
// already open. That's the character's own tier, plus whichever group holds what they're
// carrying — a shield handed out at level 1 is still theirs at level 8, and a picker that hides
// it is a picker that lies. Higher tiers stay closed rather than absent: your level doesn't cap
// what a GM can hand you, it just says where to look first.
export function groupByTier(items, { tier, equippedId } = {}) {
  const byTier = new Map();
  for (const item of items) {
    if (!byTier.has(item.tier)) byTier.set(item.tier, []);
    byTier.get(item.tier).push(item);
  }
  return [...byTier.keys()].sort((a, b) => a - b).map((t) => {
    const group = byTier.get(t);
    return {
      tier: t,
      items: group,
      open: t === tier || group.some((item) => item.id === equippedId),
    };
  });
}
