// Everything the printable character sheet needs, in one place. Pure: no DOM, no fetch,
// no localStorage — sheet.js turns the result into markup and nothing else, the same split
// derived-stats.js and its callers use.
//
// This file used to compute Evasion, Hit Points, Stress, Armor Score, damage thresholds and
// attack modifiers by hand. It doesn't anymore: shared/derived-stats.js is now the one place
// that arithmetic happens (see its header comment), and re-deriving any of it here would put
// this file right back in the position it was fixed out of — a sixth place that could disagree
// with the other five. Everything below either calls derivedStats() and reads its `.total` (and
// `.note`, where the rules can cap a stat), or is presentation logic derivedStats() has no
// reason to know about: flattening feature prose, building the damage-die string, filtering
// heritage features down to what was actually chosen.
//
// SHAPE: a flat display object, not the { total, parts } shape derivedStats() returns. The
// sheet is printed paper — there's no "?" popover to open, so the parts breakdown that exists
// to explain a number on screen has nowhere to go here. What DOES survive onto the page is the
// `note` a capped stat carries (e.g. "Capped at the maximum Armor Score of 12"): a player at
// the table has no app to tell them their Armor Score got clamped, so that note is exposed
// alongside the total as `<field>Note`, printed as a small caption rather than folded away.
//
// derivedStats() needs `character` already run through ensureLevelFields() (baseline, per-tier
// slot usage, experience ids, effectChoices, etc. all present) — the same precondition every
// other caller of derivedStats() has. Whoever loads the character for the sheet page is
// responsible for that, same as characters.js's loadCharacters() is.

import { activeDomainCardIds, SUBCLASS_TIER_LABELS, subclassTiersUpTo } from "./advancement.js";
import { UNARMED_PROFILE, derivedStats, TRAIT_KEYS, TRAIT_LABELS } from "./derived-stats.js";
import { unresolvedChoices } from "./effects.js";
import { UNARMED, UNARMORED } from "./gear.js";

function find(list, id) {
  return id ? (list || []).find((x) => x.id === id) || null : null;
}

function titleCase(str) {
  return str ? str.charAt(0) + str.slice(1).toLowerCase() : "";
}

function signed(value) {
  if (value === null || value === undefined) return "—";
  return value > 0 ? `+${value}` : String(value);
}

function prettyEnum(value) {
  // "TWO_HANDED" -> "Two handed", "PHYSICAL" -> "Physical"
  return value ? titleCase(value.replace(/_/g, " ")) : "";
}

// Feature list flattened to plain strings, so the render layer never walks the
// nested { name: {"en-US"}, description: [{ paragraph: {"en-US"} } | { list: [{"en-US"}] }] }
// shape. description blocks come in two shapes: `paragraph` (most of them) and
// `list` (bulleted benefits, e.g. Guardian's Unstoppable) — and a feature can mix
// several of each, in either order (Champion's Edge is paragraph → list → paragraph:
// the lead-in, the three Hope options, then "You can't choose the same option more
// than once", which is a restriction on the options and has to print after them).
// `description` keeps every block, tagged and in source order, the same principle
// shared/card-render.js's descriptionHtml() already applies to this exact data —
// collapsing paragraphs into one joined string (the old shape) or hoisting every
// list to the end would both scramble that order.
//
// Nothing in derived-stats.js does this: it turns feature prose into stat contributions,
// it never needs the prose itself, so flattening it stays entirely a sheet concern.
function features(list) {
  return (list || []).map((f) => ({
    name: f.name?.["en-US"] || "",
    description: (f.description || [])
      .map((d) => {
        if (d.paragraph) return { type: "paragraph", text: d.paragraph["en-US"] || "" };
        if (Array.isArray(d.list)) return { type: "list", items: d.list.map((item) => item["en-US"] || "") };
        return null;
      })
      .filter(Boolean),
  }));
}

// Daggerheart damage is Proficiency copies of the weapon die, plus a flat modifier when the
// weapon has one: a D10 weapon with modifier 3 at Proficiency 2 is 2d10+3. That die-string
// isn't a stat derived-stats.js produces — it has no reason to format dice notation — so it's
// still built here. The attack modifier, though, comes straight from derivedStats()'s
// primary/secondaryAttack: it already knows the weapon's trait, the effective (post-armor,
// post-feature) value of that trait, and any per-weapon `attack` bonus (Reliable, Blade-Touched
// when it's scoped to this weapon), so recomputing it from `character.traits` here would be
// exactly the bug this rewrite exists to remove.
function weaponEntry(weapon, attackStat, proficiencyTotal) {
  if (!weapon) return null;
  const dice = weapon.damage.dice.toLowerCase();
  const modifier = weapon.damage.modifier || 0;
  // No "+0" for a weapon with no modifier; a negative one (none exist in data/ today, but the
  // rule doesn't promise that stays true) prints its own sign rather than a doubled one.
  const modifierText = modifier > 0 ? `+${modifier}` : modifier < 0 ? `${modifier}` : "";
  const traitKey = String(weapon.trait || "").toLowerCase();
  return {
    name: weapon.name["en-US"],
    range: prettyEnum(weapon.range),
    burden: prettyEnum(weapon.burden),
    // Empty for an unarmed profile, which names two traits rather than one — see `attack`.
    traitLabel: TRAIT_LABELS[traitKey] || "",
    // attackStat is null when derivedStats() has nothing to report: no trait assigned yet on a
    // draft, armed or not. "—" then, rather than a number that isn't real.
    //
    // An unarmed attack has no single total to sign. The SRD hands the GM the choice of Strength
    // or Finesse per roll, so derivedStats() reports both as a `display` ("Strength +2 / Finesse
    // 0") and no total. That string already names its traits, so it prints alone and traitLabel
    // stays empty — the same reason the Spellcast box below drops its own traitLabel.
    attack: !attackStat ? "—" : attackStat.unarmed ? attackStat.display : signed(attackStat.total),
    damage: `${proficiencyTotal}${dice}${modifierText}`,
    damageType: prettyEnum(weapon.damage.type),
    features: features(weapon.features),
  };
}

export function deriveSheet(character, db) {
  const stats = derivedStats(character, db);
  // stats.exclusions (bonuses the character has that DON'T count towards a total — Rise Up,
  // a *-Touched card below its threshold, Armorer while unarmored) isn't surfaced below. On
  // screen it sits next to the total so a player can see why a bonus they own isn't in the
  // number; on paper there's no number-adjacent spot for it either, and every bonus it could
  // name is a card or feature whose full text is already printed on page 2 — a player reading
  // that text already has the "why", so there's nothing this field would add.

  const cls = find(db?.classes, character.classId);
  const sub = find(db?.subclasses, character.subclassId);
  // Choosing to wear nothing is a choice, and not the same as not having chosen yet: it prints
  // as "Unarmored" where an unfilled slot prints a dash. There is no such armor in data/ — the
  // sentinel is asked for by name, because find() would only ever return null for it.
  const unarmored = character.equipment?.armorId === UNARMORED;
  const armor = unarmored ? null : find(db?.armors, character.equipment?.armorId);
  const community = find(db?.communities, character.heritage.communityId);
  // Optional, and null for most characters. Read off a top-level field rather than out of
  // `heritage`, though it prints beside it: heritage's shape is ancestry-specific.
  const transformation = find(db?.transformations, character.transformationId);
  const ancestries = character.heritage.ancestryIds.map((id) => find(db?.ancestries, id)).filter(Boolean);

  // Fighting unarmed is a choice with rules of its own — [Proficiency]d4, Strength or Finesse —
  // so the sheet prints them rather than leaving the weapon block empty. The profile is a core
  // rule rather than a data/ record, which is why it comes from derived-stats.js and not db.
  const primaryWeapon = character.equipment?.primaryWeaponId === UNARMED
    ? UNARMED_PROFILE
    : find(db?.weapons, character.equipment?.primaryWeaponId);
  // Whether a secondary counts is whether one is equipped — the same question derivedStats()
  // asks. This used to be gated on a stored "weaponMode" string; nothing writes that field any
  // more, so gating on it here printed no off-hand weapon at all, and for a Warrior carrying a
  // shield behind a two-handed primary — the case the burden rule exists to allow — it dropped
  // the very weapon whose Barrier was already in their Armor Score.
  const secondaryWeapon = find(db?.weapons, character.equipment?.secondaryWeaponId);

  const loadout = activeDomainCardIds(character)
    .map((id) => find(db?.domainCards, id))
    .filter(Boolean)
    .map((card) => ({
      id: card.id,
      name: card.name["en-US"],
      domain: card.domain,
      domainClass: card.domain.toLowerCase(),
      level: card.level,
      type: titleCase(card.type),
      recallCost: card.recallCost,
      features: features(card.features),
    }));

  return {
    name: character.name || "(unnamed)",
    pronouns: character.pronouns || "",
    level: character.level,
    proficiency: stats.proficiency.total,

    className: cls ? titleCase(cls.name) : "—",
    subclassName: sub ? sub.name["en-US"] : "—",
    subclassTierLabel: SUBCLASS_TIER_LABELS[character.subclassTier] || "",
    ancestryNames: ancestries.map((a) => a.name["en-US"]),
    communityName: community ? community.name["en-US"] : "—",
    // null rather than "—": a character without one has nothing missing, so the sheet leaves it
    // out entirely instead of printing a dash for a slot that was never theirs to fill.
    transformationName: transformation ? transformation.name["en-US"] : null,

    // Effective traits — assigned value plus whatever armor, weapons, ancestry and cards add —
    // because that's the number rolled at the table. Printing the raw assignment (the old bug)
    // would silently drop Full Plate's -1 Agility and every other trait-moving feature.
    traits: TRAIT_KEYS.map((key) => ({
      key,
      label: TRAIT_LABELS[key],
      display: stats.traits[key].total === null ? "—" : signed(stats.traits[key].total),
    })),

    evasion: stats.evasion ? stats.evasion.total : null,
    armorScore: stats.armorScore ? stats.armorScore.total : null,
    armorScoreNote: stats.armorScore?.note,
    hitPoints: stats.hitPoints ? stats.hitPoints.total : null,
    hitPointsNote: stats.hitPoints?.note,
    stress: stats.stress.total,
    stressNote: stats.stress.note,
    // Hope isn't in derivedStats() at all: every character starts with 6 slots and 2 filled,
    // with no bonus in the SRD that moves either number, so there's nothing to derive.
    hopeSlots: 6,
    hopeStart: 2,
    thresholds: stats.majorThreshold
      ? { major: stats.majorThreshold.total, severe: stats.severeThreshold.total }
      : null,

    weapons: [
      weaponEntry(primaryWeapon, stats.primaryAttack, stats.proficiency.total),
      weaponEntry(secondaryWeapon, stats.secondaryAttack, stats.proficiency.total),
    ].filter(Boolean),
    armorName: armor ? armor.name["en-US"] : unarmored ? "Unarmored" : "—",
    armorFeatures: features(armor?.features),
    potionName: find(db?.consumables, character.equipment?.potionChoice)?.name["en-US"] || "—",

    // Experience modifiers come from derivedStats() too: a couple of features (Clank's
    // Purposeful Design, Master of the Craft) add a permanent bonus on top of the level-up
    // value, and the old file's `character.experiences[i].modifier` never saw that bonus.
    experiences: stats.experiences.map((e) => ({
      name: e.name || "(unnamed)",
      display: signed(e.total),
    })),

    // Absent from the old sheet entirely — it printed no Spellcast trait at all — but it's
    // exactly the kind of thing a player looks up every session, and the sheet is meant to
    // stand in for the app at the table. `note` explains that a bonus here (e.g. Channeling
    // armor's +1) applies to Spellcast Rolls only, not to a plain roll of the trait.
    // (stats.spellcast.traitLabel is dropped: `display` already reads e.g. "Knowledge +1",
    // so nothing on the sheet has a reason to print the bare trait name a second time.)
    spellcast: stats.spellcast
      ? { display: stats.spellcast.display, note: stats.spellcast.note }
      : null,

    loadout,
    hopeFeature: cls ? features([cls.hopeFeature])[0] : null,
    classFeatures: features(cls?.classFeatures),
    // Every tier up to the character's current one, not just the current tier: upgrading a
    // subclass card ADDS a tier, it doesn't replace the one below it (characters.js's detail
    // view renders all of them for exactly this reason — subclassTiersUpTo() is the same
    // helper it uses, not a second implementation of the same idea). A Mastery character still
    // has their Foundation and Specialization features in play, so the sheet has to print all
    // three. Each feature carries `source` (the tier's label) the same way ancestryFeatures
    // carries the ancestry's name, so the render layer can label which tier granted it.
    subclassFeatures: subclassTiersUpTo(character.subclassTier).flatMap((tier) =>
      features(sub?.[tier]?.features).map((f) => ({ ...f, source: SUBCLASS_TIER_LABELS[tier] })),
    ),
    // Only the features actually picked in heritage.chosenFeatures print — not every
    // feature of every ancestry in ancestryIds. For a pure-ancestry character
    // create.js seeds chosenFeatures with all of that ancestry's features (see
    // create.js's ancestry-mode "pure" branch), so this filter is a no-op there and
    // only bites for mixed ancestry, where chosenFeatures holds one pick per ancestry.
    ancestryFeatures: ancestries.flatMap((a) => {
      const chosenNames = new Set(
        character.heritage.chosenFeatures
          .filter((f) => f.ancestryId === a.id)
          .map((f) => f.featureName),
      );
      return features(a.features)
        .filter((f) => chosenNames.has(f.name))
        .map((f) => ({ ...f, source: a.name["en-US"] }));
    }),
    communityFeatures: features(community?.features).map((f) => ({
      ...f, source: community ? community.name["en-US"] : "",
    })),
    // Both features, always — a transformation's drawback is not optional, and one the player
    // forgets is one that never happens at the table. Nothing is chosen between them, so unlike
    // ancestryFeatures above there's no filter here.
    transformationFeatures: features(transformation?.features).map((f) => ({
      ...f, source: transformation ? transformation.name["en-US"] : "",
    })),

    // A card like Vitality grants nothing until its choice is answered (see effects.js). A
    // sheet that silently shows the un-boosted total, with no hint why, would send a player to
    // the table thinking their card does nothing. This is that hint.
    unresolvedChoicePrompts: unresolvedChoices(character, db).map((c) => c.prompt),

    background: character.background.description || "",
    appearance: character.background.answers || "",
    connections: character.connectionsNotes || "",
  };
}
