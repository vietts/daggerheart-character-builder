// What a character's choices do to their stats.
//
// The SRD states these as prose ("Gain an additional Hit Point slot"), and data/ is a
// re-export of daggersearch/daggerheart-data that we want to keep refreshing from upstream.
// So the prose -> numbers mapping lives here instead of in the JSON: this file is the one
// hand-maintained thing, and a data refresh can't silently overwrite it.
//
// Every entry carries the sentence it encodes as a comment. That comment IS the audit trail —
// if you can't point at the sentence, the entry shouldn't exist.
//
// WHAT GETS AN ENTRY
// ------------------
// A bonus is catalogued when it is in effect right now given only what we store — permanent
// choices, what's in the loadout, how the character is configured — and needs no action during
// play. Concretely:
//
//   1. Permanent changes (Giant's Endurance, Vitality).
//   2. A card in the loadout whose bonus applies the whole time it's there (Untouchable).
//   3. A *-Touched card whose 4-cards-in-domain requirement is met — judged per benefit.
//   4. A card in the loadout whose only other requirement is character *configuration*
//      rather than an action ("while you are wearing armor").
//
// Excluded: anything costing Stress or Hope, anything "once per rest", anything gated on
// volatile play state (Vulnerable, Hope >= 2, all Stress marked) or on fiction ("in a natural
// environment"). We track what was chosen and what's in the loadout, not the comings and
// goings of play.
//
// Where we skip one benefit of a card we otherwise count, `excluded` names it, so the "?"
// breakdown can say why a player who met the requirement sees nothing change.
//
// SHAPE
// -----
// Keys are `<entityId>:<discriminator>` — the tier for subclasses, the feature name for
// ancestries, armor and weapons. Domain cards have a single feature block, so they're keyed by
// id alone. Armor and weapon features that mean the same thing everywhere they appear are
// keyed `armor:<feature>` / `weapon:<feature>`; the handful whose numbers differ per item
// (Barrier, Protective) are keyed by item id, which takes precedence.
//
// Values are numbers, or functions of a context object:
//   { level, proficiency, traits, armor, domainCounts, character }
// `traits` holds effective trait totals. `when` is an optional predicate on the same context.
//
// ADDING A CARD
// -------------
// When new cards come out, a stat change should be one entry here and nothing else. A new
// shield with the existing `Protective` wording needs not even that — it's already covered by
// the feature-name key.
//
// Nothing outside this file names a card, a subclass or an ancestry. The pages work entirely
// from what an entry declares:
//
//   - WHICH STAT IT MOVES     any key in EFFECT_STAT_KEYS below.
//   - WHERE IT COMES FROM     collectEffects() tags every effect ancestry / subclass / armor /
//                             weapon / domainCard, and that tag is what decides where a
//                             `choice` gets asked: ancestry choices in the creation wizard,
//                             card choices on the level up screen.
//   - WHAT SHAPE OF CHOICE    shared/effect-choice.js renders "pick N of these benefits" and
//                             "pick N of your Experiences" for both screens.
//   - HOW MANY CARDS IT       the level up screen diffs extraDomainCards before this level's
//     GRANTS                  picks against after, so anything that starts granting cards
//                             partway through a career is picked up by being catalogued.
//
// New code is needed only for a genuinely new KIND of thing: a stat the app doesn't compute
// yet, or a choice that isn't one of the two shapes above.
//
// TWO KINDS OF EFFECT
// -------------------
// Most entries are ADDITIVE: a key from EFFECT_STAT_KEYS naming a number to add to whatever the
// stat would otherwise be. A few are BASE OVERRIDES, declared under `base`, which stand in for
// the value a stat starts from rather than adding to it — what a piece of equipment would have
// contributed, when you have no such equipment. Additive effects then stack on top of the
// override exactly as they would on top of armor, so a shield still works.
//
// `base` is a sibling of the additive keys, not a different kind of entry, so one entry can do
// both if a card ever needs to. Its values are functions of the same context.

import { SUBCLASS_TIER_ORDER, tierForLevel } from "./advancement.js";
import { UNARMED, UNARMORED } from "./gear.js";

// Requirement shared by the *-Touched cards: "When 4 or more of the domain cards in your
// loadout are from the X domain". The card is itself an X card, so it counts toward its own 4.
const touched = (domain) => (c) => (c.domainCounts[domain] || 0) >= 4;

const ONCE_PER_REST = "needs an action or a rest, so it isn't counted here";

// Bare Bones' base thresholds, by tier, straight off the card.
const BARE_BONES_THRESHOLDS = {
  1: { major: 9, severe: 19 },
  2: { major: 11, severe: 24 },
  3: { major: 13, severe: 31 },
  4: { major: 15, severe: 38 },
};

export const EFFECTS = {
  // ===================== Ancestries =====================
  // Keyed by feature name, not ancestry id alone: with a mixed ancestry the player picks ONE
  // feature per ancestry, and it isn't always the first one. A mixed-ancestry Giant who took
  // Reach does not get the extra Hit Point slot.

  // Giant, Endurance — "Gain an additional Hit Point slot at character creation."
  "core_ancestry_giant:Endurance": { hitPointSlots: 1 },

  // Human, High Stamina — "Gain an additional Stress slot at character creation."
  "core_ancestry_human:High Stamina": { stressSlots: 1 },

  // Simiah, Nimble — "Gain a permanent +1 bonus to your Evasion at character creation."
  // Nimble is Simiah's SECOND feature; the other four stat features are their ancestry's first.
  "core_ancestry_simiah:Nimble": { evasion: 1 },

  // Galapa, Shell — "Gain a bonus to your damage thresholds equal to your Proficiency."
  "core_ancestry_galapa:Shell": {
    majorThreshold: (c) => c.proficiency,
    severeThreshold: (c) => c.proficiency,
  },

  // Clank, Purposeful Design — "At character creation, choose one of your Experiences that best
  // aligns with this purpose and gain a permanent +1 bonus to it."
  "core_ancestry_clank:Purposeful Design": {
    choice: {
      prompt: "Purposeful Design: choose the Experience that best aligns with what you were made for.",
      kind: "experience",
      options: [{ id: "one", label: "+1 to one Experience", pick: 1, bonus: 1 }],
    },
  },

  // ===================== Subclasses =====================
  // Keyed by tier. A tier implies every tier below it, so Stalwart at Mastery collects all
  // three of these and ends up at +6 thresholds.

  // School of War — "Gain an additional Hit Point slot."
  "core_subclass_school_of_war:foundation": { feature: "Battlemage", hitPointSlots: 1 },

  // Vengeance — "Gain an additional Stress slot."
  "core_subclass_vengeance:foundation": { feature: "At Ease", stressSlots: 1 },

  // Stalwart — "Gain a permanent +1 bonus to your damage thresholds." (Iron Will, the other
  // Foundation feature, spends an Armor Slot, so it isn't here.)
  "core_subclass_stalwart:foundation": { feature: "Unwavering", majorThreshold: 1, severeThreshold: 1 },
  // Stalwart — "Gain a permanent +2 bonus to your damage thresholds."
  "core_subclass_stalwart:specialization": { feature: "Unrelenting", majorThreshold: 2, severeThreshold: 2 },
  // Stalwart — "Gain a permanent +3 bonus to your damage thresholds."
  "core_subclass_stalwart:mastery": { feature: "Undaunted", majorThreshold: 3, severeThreshold: 3 },

  // Nightwalker — "Gain a permanent +1 bonus to your Evasion."
  "core_subclass_nightwalker:mastery": { feature: "Fleeting Shadow", evasion: 1 },

  // Winged Sentinel — "Gain a permanent +4 bonus to your Severe damage threshold."
  "core_subclass_winged_sentinel:mastery": { feature: "Ascendant", severeThreshold: 4 },

  // School of Knowledge — "Take an additional domain card of your level or lower from a domain
  // you have access to." Not a stat, but it changes how many cards you get to pick.
  "core_subclass_school_of_knowledge:foundation": { feature: "Prepared", extraDomainCards: 1 },
  "core_subclass_school_of_knowledge:specialization": { feature: "Accomplished", extraDomainCards: 1 },
  "core_subclass_school_of_knowledge:mastery": { feature: "Brilliant", extraDomainCards: 1 },

  // ===================== Armor features =====================

  // "+1 to Evasion"
  "armor:Flexible": { evasion: 1 },
  // "-1 to Evasion"
  "armor:Heavy": { evasion: -1 },
  // "-2 to Evasion; -1 to Agility"
  "armor:Very Heavy": { evasion: -2, traits: { agility: -1 } },
  // "+1 to Presence"
  "armor:Gilded": { traits: { presence: 1 } },
  // "+1 to Spellcast Rolls" — a Spellcast Roll bonus, NOT a bonus to the underlying trait: a
  // plain Knowledge roll doesn't get it, so this must never reach effective traits.
  "armor:Channeling": { spellcast: 1 },
  // "-1 to all character traits and Evasion"
  "armor:Difficult": {
    evasion: -1,
    traits: { agility: -1, strength: -1, finesse: -1, instinct: -1, presence: -1, knowledge: -1 },
  },

  // ===================== Weapon features =====================
  // A weapon's `attack` bonus applies to attacks with THAT weapon only. Everything else a
  // weapon grants (Evasion, Armor Score, traits, thresholds) applies to the character.

  // "+1 to attack rolls"
  "weapon:Reliable": { attack: 1 },
  // "-1 to Evasion"
  "weapon:Heavy": { evasion: -1 },
  // "-1 to Evasion; on a successful attack, roll an additional damage die..."
  "weapon:Massive": { evasion: -1 },
  // "-1 to Finesse"
  "weapon:Cumbersome": { traits: { finesse: -1 } },
  // "-1 to Agility; on a successful attack, all adversaries within Very Close range..."
  "weapon:Destructive": { traits: { agility: -1 } },
  // "-1 to Evasion; +3 to Severe damage threshold"
  "weapon:Brave": { evasion: -1, severeThreshold: 3 },
  // "+1 to Armor Score; +1 to primary weapon damage within Melee range"
  "weapon:Double Duty": { armorScore: 1 },

  // Barrier and Protective mean a different number on each shield, so these are keyed per item
  // and override the generic feature-name entries above.
  // "+N to Armor Score; -1 to Evasion"
  "core_weapon_tower_shield:Barrier": { armorScore: 2, evasion: -1 },
  "core_weapon_improved_tower_shield:Barrier": { armorScore: 3, evasion: -1 },
  "core_weapon_advanced_tower_shield:Barrier": { armorScore: 4, evasion: -1 },
  "core_weapon_legendary_tower_shield:Barrier": { armorScore: 5, evasion: -1 },
  // "+N to Armor Score"
  "core_weapon_round_shield:Protective": { armorScore: 1 },
  "core_weapon_labrys_axe:Protective": { armorScore: 1 },
  "core_weapon_improved_round_shield:Protective": { armorScore: 2 },
  "core_weapon_advanced_round_shield:Protective": { armorScore: 3 },
  "core_weapon_legendary_round_shield:Protective": { armorScore: 4 },

  // ===================== Domain cards =====================

  // Untouchable — "Gain a bonus to your Evasion equal to half your Agility."
  // The SRD's general rule: "if you need to round to a whole number, round up unless otherwise
  // specified", so Agility +1 gives +1, not 0.
  "core_domain_card_untouchable": { evasion: (c) => Math.ceil(c.traits.agility / 2) },

  // Bare Bones — "When you choose not to equip armor, you have a base Armor Score of 3 + your
  // Strength and use the following as your base damage thresholds: Tier 1: 9/19, Tier 2: 11/24,
  // Tier 3: 13/31, Tier 4: 15/38."
  //
  // Base, not bonus: it stands in for the armor you're not wearing, so your level is added on
  // top of those thresholds exactly as it would be on top of a breastplate's. Choosing not to
  // equip armor is a configuration rather than an action, so it counts.
  "core_domain_card_bare_bones": {
    when: (c) => !c.armor,
    base: {
      armorScore: (c) => 3 + c.traits.strength,
      majorThreshold: (c) => BARE_BONES_THRESHOLDS[tierForLevel(c.level)].major,
      severeThreshold: (c) => BARE_BONES_THRESHOLDS[tierForLevel(c.level)].severe,
    },
  },

  // Fortified Armor — "While you are wearing armor, gain a +2 bonus to your damage thresholds."
  // Wearing armor is a configuration, not an action, so this counts.
  "core_domain_card_fortified_armor": {
    when: (c) => !!c.armor,
    majorThreshold: 2,
    severeThreshold: 2,
  },

  // Armorer — "While you're wearing armor, gain a +1 bonus to your Armor Score."
  "core_domain_card_armorer": {
    when: (c) => !!c.armor,
    armorScore: 1,
    excluded: [`Armorer's downtime armor repair for your allies ${ONCE_PER_REST}`],
  },

  // Rise Up — "Gain a bonus to your Severe threshold equal to your Proficiency."
  "core_domain_card_rise_up": {
    severeThreshold: (c) => c.proficiency,
    excluded: [`Rise Up's "clear a Stress when you mark Hit Points" happens in play, so it isn't counted here`],
  },

  // Arcana-Touched — "+1 bonus to your Spellcast Rolls".
  "core_domain_card_arcana_touched": {
    when: touched("ARCANA"),
    spellcast: 1,
    excluded: [`Arcana-Touched's Hope/Fear Die switch ${ONCE_PER_REST}`],
  },

  // Blade-Touched — "+2 bonus to your attack rolls" and "+4 bonus to your Severe damage
  // threshold". Both are passive, so nothing is excluded.
  "core_domain_card_blade_touched": { when: touched("BLADE"), attack: 2, severeThreshold: 4 },

  // Bone-Touched — "+1 bonus to Agility".
  "core_domain_card_bone_touched": {
    when: touched("BONE"),
    traits: { agility: 1 },
    excluded: [`Bone-Touched's attack negation costs 3 Hope, so it isn't counted here`],
  },

  // Splendor-Touched — "+3 bonus to your Severe damage threshold".
  "core_domain_card_splendor_touched": {
    when: touched("SPLENDOR"),
    severeThreshold: 3,
    excluded: [`Splendor-Touched's damage substitution ${ONCE_PER_REST}`],
  },

  // Valor-Touched — "+1 bonus to your Armor Score".
  "core_domain_card_valor_touched": {
    when: touched("VALOR"),
    armorScore: 1,
    excluded: [`Valor-Touched's Armor Slot recovery happens in play, so it isn't counted here`],
  },

  // Codex-Touched — catalogued so a player who met the requirement is told why nothing moved.
  // Adding Proficiency to a Spellcast Roll costs a Stress; the card swap is once per rest.
  "core_domain_card_codex_touched": {
    when: touched("CODEX"),
    excluded: [
      `Codex-Touched's Proficiency on Spellcast Rolls costs a Stress each time, so it isn't counted here`,
      `Codex-Touched's free card swap ${ONCE_PER_REST}`,
    ],
  },

  // Sage-Touched — the Spellcast bonus depends on where the scene is set, which we don't track.
  "core_domain_card_sage_touched": {
    when: touched("SAGE"),
    excluded: [
      `Sage-Touched's +2 to Spellcast Rolls only applies in a natural environment, so it isn't counted here`,
      `Sage-Touched's doubled Agility or Instinct ${ONCE_PER_REST}`,
    ],
  },

  // Vitality — "When you choose this card, permanently gain two of the following benefits...
  // Then place this card in your vault permanently." Permanent, so it keeps applying from the
  // vault — which is exactly where the card tells you to put it.
  "core_domain_card_vitality": {
    permanent: true,
    choice: {
      prompt: "Vitality: choose two benefits. They're permanent, and stay even though the card lives in your vault.",
      kind: "benefit",
      pick: 2,
      options: [
        { id: "stress", label: "One Stress slot", stressSlots: 1 },
        { id: "hitPoint", label: "One Hit Point slot", hitPointSlots: 1 },
        { id: "thresholds", label: "+2 bonus to your damage thresholds", majorThreshold: 2, severeThreshold: 2 },
      ],
    },
  },

  // Master of the Craft — "Gain a permanent +2 bonus to two of your Experiences or a permanent
  // +3 bonus to one of your Experiences. Then place this card in your vault permanently."
  "core_domain_card_master_of_the_craft": {
    permanent: true,
    choice: {
      prompt: "Master of the Craft: choose how to spend the bonus. It's permanent, and stays even though the card lives in your vault.",
      kind: "experience",
      options: [
        { id: "two", label: "+2 to two Experiences", pick: 2, bonus: 2 },
        { id: "one", label: "+3 to one Experience", pick: 1, bonus: 3 },
      ],
    },
  },
};

// Every stat an effect can move. Adding a new one is the only change that needs code outside
// this file; adding a new card, ancestry feature or piece of equipment that moves an existing
// one is a new entry above and nothing else.
export const EFFECT_STAT_KEYS = [
  "evasion", "hitPointSlots", "stressSlots", "majorThreshold", "severeThreshold",
  "armorScore", "attack", "spellcast", "extraDomainCards",
];

// A content source may declare its own effects, and they arrive on `db.effects` — never merged
// into EFFECTS above, which stays exactly the hand-audited catalogue this file documents.
//
// A source's entry WINS over one here, because a source that revises a record is revising what
// that record does: a reprint of a card is the new version of it. An override that declares
// nothing INHERITS the entry here — including the functions and choices JSON can't express — and
// the "?" breakdown labels it with the overriding record's own name, so the attribution stays
// honest either way.
function lookup(db, ...keys) {
  const source = db?.effects;
  for (const key of keys) {
    if (source && Object.prototype.hasOwnProperty.call(source, key)) return { key, effect: source[key] };
    if (Object.prototype.hasOwnProperty.call(EFFECTS, key)) return { key, effect: EFFECTS[key] };
  }
  return null;
}

/** The effect behind a key, source overlay included. For the two places that read one directly. */
export function effectFor(db, ...keys) {
  return lookup(db, ...keys)?.effect || null;
}

function featureNames(entity) {
  return (entity?.features || []).map((f) => f.name?.["en-US"]).filter(Boolean);
}

function displayName(entity, fallback) {
  return entity?.name?.["en-US"] || fallback;
}

// A tier implies every tier below it — the same ladder the subclass cards use.
function tiersUpTo(tier) {
  const idx = SUBCLASS_TIER_ORDER.indexOf(tier);
  return SUBCLASS_TIER_ORDER.slice(0, idx < 0 ? 1 : idx + 1);
}

/**
 * Every effect a character currently has, in the order they'd read down their sheet.
 *
 * Each entry is { key, label, effect, source, scope }:
 *  - `label` is what the "?" breakdown shows, so it names the thing the player chose rather
 *    than the rule id.
 *  - `source` is where it came from: "ancestry", "subclass", "armor", "weapon" or "domainCard".
 *    Pages use it to decide WHERE a choice gets asked, so that a new card with a choice lands
 *    on the level up screen and a new ancestry feature with one lands in the wizard, both
 *    without either page learning its name.
 *  - `scope` is "primary"/"secondary" for a weapon's own attack bonus, "character" otherwise.
 *
 * @param {object} ch a character (already through ensureLevelFields)
 * @param {object} db whatever data the calling page loaded; sources whose data is missing are
 *   skipped rather than throwing, because the level up screen loads only classes, subclasses
 *   and domain cards.
 */
export function collectEffects(ch, db) {
  const found = [];
  const add = (hit, source, label, scope = "character") => {
    if (hit) found.push({ key: hit.key, label, effect: hit.effect, source, scope });
  };

  for (const chosen of ch.heritage?.chosenFeatures || []) {
    const anc = (db?.ancestries || []).find((a) => a.id === chosen.ancestryId);
    add(lookup(db, `${chosen.ancestryId}:${chosen.featureName}`), "ancestry",
      `${displayName(anc, "Ancestry")} — ${chosen.featureName}`);
  }

  const sub = (db?.subclasses || []).find((s) => s.id === ch.subclassId);
  if (sub) {
    for (const tier of tiersUpTo(ch.subclassTier)) {
      const hit = lookup(db, `${sub.id}:${tier}`);
      // The feature name comes from the entry, not from data/: a tier can hold two features
      // and only one of them is the one being encoded (Stalwart's Foundation is Unwavering
      // AND Iron Will; only Unwavering moves a stat).
      add(hit, "subclass", `${displayName(sub, "Subclass")}${hit?.effect.feature ? ` — ${hit.effect.feature}` : ""}`);
    }
  }

  // A character who chose to wear nothing has no armor features; the sentinel matches no id,
  // and asking for it explicitly beats relying on the lookup to miss.
  const armor = ch.equipment?.armorId === UNARMORED
    ? undefined
    : (db?.armors || []).find((a) => a.id === ch.equipment?.armorId);
  for (const name of featureNames(armor)) {
    add(lookup(db, `${armor.id}:${name}`, `armor:${name}`), "armor", `${displayName(armor, "Armor")} (${name})`);
  }

  // Both slots, always: what's equipped is what applies. See derived-stats.js for why the old
  // weaponMode gate had to go.
  // Bare hands carry no features, and the sentinel matches no id — asked outright rather than
  // left to the lookup to miss, same as the armor above.
  const weaponSlots = [
    ["primary", ch.equipment?.primaryWeaponId === UNARMED ? null : ch.equipment?.primaryWeaponId],
    ["secondary", ch.equipment?.secondaryWeaponId],
  ];
  for (const [scope, weaponId] of weaponSlots) {
    const weapon = (db?.weapons || []).find((w) => w.id === weaponId);
    for (const name of featureNames(weapon)) {
      add(lookup(db, `${weapon.id}:${name}`, `weapon:${name}`), "weapon", `${displayName(weapon, "Weapon")} (${name})`, scope);
    }
  }

  // Loadout cards apply while they're in the loadout; a card whose text says the bonus is
  // permanent keeps applying from the vault, which is where those cards tell you to put them.
  const vaulted = ch.domainVaultIds || [];
  for (const cardId of ch.domainCardIds || []) {
    const hit = lookup(db, cardId);
    if (!hit) continue;
    if (vaulted.includes(cardId) && !hit.effect.permanent) continue;
    const card = (db?.domainCards || []).find((c) => c.id === cardId);
    add(hit, "domainCard", displayName(card, cardId));
  }

  return found;
}

/** The choice a source asks for, if it asks for one at all. */
export function choiceFor(key, db) {
  return effectFor(db, key)?.choice || null;
}

// How many of each domain are in the loadout — the requirement the *-Touched cards check.
export function loadoutDomainCounts(ch, db) {
  const counts = {};
  const vaulted = ch.domainVaultIds || [];
  for (const cardId of ch.domainCardIds || []) {
    if (vaulted.includes(cardId)) continue;
    const card = (db?.domainCards || []).find((c) => c.id === cardId);
    if (card?.domain) counts[card.domain] = (counts[card.domain] || 0) + 1;
  }
  return counts;
}

export function effectValue(value, ctx) {
  return typeof value === "function" ? value(ctx) : value;
}

/** A blank answer, or a copy of one already recorded so re-opening a screen shows it. */
export function blankAnswer(saved) {
  return {
    optionId: saved?.optionId ?? null,
    optionIds: [...(saved?.optionIds || [])],
    experienceIds: [...(saved?.experienceIds || [])],
  };
}

/** True once an answer picks as many things as the choice asks for. */
export function isAnswered(choice, answer) {
  if (!choice || !answer) return false;
  if (choice.kind === "benefit") return answer.optionIds.length === choice.pick;
  const option = choice.options.find((o) => o.id === answer.optionId);
  return !!option && answer.experienceIds.length === option.pick;
}

// The choices a character still owes an answer for. Half-answered counts as owing: an empty
// answer object gets written the moment a picker renders, so mere presence proves nothing.
// Shown as a nudge, never as a block — a character saved before this existed stays editable.
export function unresolvedChoices(ch, db) {
  return collectEffects(ch, db)
    .filter((e) => e.effect.choice && !isAnswered(e.effect.choice, ch.effectChoices?.[e.key]))
    .map((e) => ({ key: e.key, label: e.label, prompt: e.effect.choice.prompt }));
}

// "You ignore burden when equipping weapons." — the Warrior's Combat Training.
//
// Not an EFFECTS entry: it moves no stat, so there's nothing for EFFECT_STAT_KEYS to carry. It
// lives here anyway because this is the file allowed to know a feature by name, and the answer
// is a rule, not a presentation detail. The burden advice in the wizard asks this before it
// says anything.
export function ignoresBurden(ch, db) {
  const cls = (db?.classes || []).find((c) => c.id === ch?.classId);
  return (cls?.classFeatures || []).some((f) => f.name?.["en-US"] === "Combat Training");
}
