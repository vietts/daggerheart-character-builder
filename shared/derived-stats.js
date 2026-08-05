// The one place a character's derived stats are worked out.
//
// Before this existed, Evasion / Hit Points / Stress were re-derived inline in five separate
// places (the sheet, the CSV export, the creation wizard's derived step, the level up screen's
// slot gating, and the level history validation), which meant five chances to disagree.
//
// Every stat comes back as { total, parts }: the total to show, and the parts it was built
// from so the "?" popover can explain it. They're produced together on purpose — a breakdown
// computed separately from the number it explains is a breakdown that will eventually lie.
//
// The parts beyond the class baseline and the level up advancements come from shared/effects.js,
// which maps the SRD's prose ("Gain an additional Hit Point slot") onto numbers.

import {
  BASE_STRESS_SLOTS,
  MAX_ARMOR_SCORE,
  MAX_HIT_POINT_SLOTS,
  MAX_STRESS_SLOTS,
  damageThresholds,
} from "./advancement.js";
import { EFFECT_STAT_KEYS, collectEffects, effectValue, loadoutDomainCounts } from "./effects.js";

export const TRAIT_KEYS = ["agility", "strength", "finesse", "instinct", "presence", "knowledge"];
export const TRAIT_LABELS = {
  agility: "Agility", strength: "Strength", finesse: "Finesse",
  instinct: "Instinct", presence: "Presence", knowledge: "Knowledge",
};

// ---------- primitives ----------
//
// The level up screen and the history validation ask "what would this be if the player also
// took these picks?", which is a hypothetical the character object doesn't hold. They call
// these directly rather than derivedStats() below, so the arithmetic is still stated once.
// `extra` is the character's effect bonuses, from effectBonuses() — a Giant starts one Hit
// Point slot closer to the cap, so their advancement gating has to know about it.

export function hitPointTotal(cls, bonus, extra = 0) {
  return (cls?.startingHitPoints || 0) + bonus + extra;
}

export function stressTotal(bonus, extra = 0) {
  return BASE_STRESS_SLOTS + bonus + extra;
}

export function evasionTotal(cls, bonus, extra = 0) {
  return (cls?.startingEvasion || 0) + bonus + extra;
}

// ---------- effect plumbing ----------

function stat(parts) {
  return { total: parts.reduce((sum, p) => sum + p.value, 0), parts };
}

function capped(s, max, what) {
  if (s.total <= max) return s;
  return { ...s, total: max, note: `Capped at the maximum ${what} of ${max}.` };
}

function find(list, id) {
  return id ? (list || []).find((x) => x.id === id) || null : null;
}

function baseTraitTotals(ch) {
  const out = {};
  for (const key of TRAIT_KEYS) out[key] = ch.traits?.[key] ?? 0;
  return out;
}

// A choice ("permanently gain two of the following benefits") only becomes a number once the
// player has answered it, so it's turned into ordinary contributions here. Anything unanswered
// simply contributes nothing — see unresolvedChoices() for the nudge that goes on the sheet.
function resolveChoice(entry, ch) {
  const { choice } = entry.effect;
  const answer = ch.effectChoices?.[entry.key];
  if (!answer) return [];
  const chosen = choice.options.filter((o) => (answer.optionIds || [answer.optionId]).includes(o.id));
  return chosen.map((o) => ({ ...entry, label: `${entry.label} — ${o.label}`, effect: o }));
}

/**
 * Everything shared/effects.js currently grants this character, flattened and evaluated.
 * Returns { contributions, exclusions, experienceBonus }.
 */
function gather(ch, db) {
  const domainCounts = loadoutDomainCounts(ch, db);
  const armor = find(db?.armors, ch.equipment?.armorId);
  const ctx = {
    character: ch,
    level: ch.level,
    proficiency: ch.proficiency,
    armor,
    domainCounts,
    traits: baseTraitTotals(ch),
  };

  // `when` and the trait modifiers are settled first, against base traits. Nothing in the
  // catalogue gates on a trait, and no trait modifier is a function of another trait, so this
  // can't be circular — but it does mean everything else gets to read effective traits below.
  const active = collectEffects(ch, db).filter((e) => !e.effect.when || e.effect.when(ctx));

  const contributions = [];
  const exclusions = [];
  for (const entry of active) {
    for (const reason of entry.effect.excluded || []) exclusions.push(reason);
    if (entry.effect.choice) contributions.push(...resolveChoice(entry, ch));
    else contributions.push(entry);
  }

  const experienceBonus = {};
  for (const entry of active) {
    const answer = ch.effectChoices?.[entry.key];
    if (!entry.effect.choice || entry.effect.choice.kind !== "experience" || !answer) continue;
    const option = entry.effect.choice.options.find((o) => o.id === answer.optionId);
    if (!option) continue;
    for (const expId of (answer.experienceIds || []).slice(0, option.pick)) {
      experienceBonus[expId] = (experienceBonus[expId] || 0) + option.bonus;
    }
  }

  return { contributions, exclusions, experienceBonus, ctx };
}

// Contributions to one stat, as breakdown parts. Weapon features that boost attack rolls are
// scoped to the weapon that has them; every other contribution applies to the character.
function partsFor(contributions, key, ctx, scope) {
  const parts = [];
  for (const entry of contributions) {
    if (scope && entry.scope !== "character" && entry.scope !== scope) continue;
    const raw = entry.effect[key];
    if (raw === undefined) continue;
    const value = effectValue(raw, ctx);
    if (value) parts.push({ label: entry.label, value });
  }
  return parts;
}

/**
 * The stat bonuses a character has from effects, for callers doing their own arithmetic —
 * the level up screen's slot gating, the history validation, the extra domain card count.
 * Every key in EFFECT_STAT_KEYS is present, so a new one in effects.js turns up here with
 * no change needed at either end.
 */
export function effectBonuses(ch, db) {
  const { contributions, ctx } = gather(ch, db);
  const totals = {};
  for (const key of EFFECT_STAT_KEYS) {
    totals[key] = partsFor(contributions, key, ctx).reduce((sum, p) => sum + p.value, 0);
  }
  return totals;
}

/**
 * The permanent per-Experience bonuses a character has from effects (Clank's Purposeful
 * Design, Vitality's kin), keyed by Experience id. These sit outside effectBonuses because
 * they don't land on a stat: they land on one named Experience the player chose.
 *
 * The level up screen's Experience picker needs them for the same reason the sheet does —
 * it shows each Experience's current modifier, and an Experience carrying one of these is
 * higher than the replay alone believes.
 */
export function effectExperienceBonuses(ch, db) {
  return gather(ch, db).experienceBonus;
}

// ---------- the full picture ----------

/**
 * @param {object} ch a character (already through ensureLevelFields)
 * @param {object} db whatever data the calling page loaded; stats whose data is missing come
 *   back as null rather than throwing, because the level up screen only loads classes,
 *   subclasses and domain cards.
 */
export function derivedStats(ch, db) {
  const cls = find(db?.classes, ch.classId);
  const sub = find(db?.subclasses, ch.subclassId);
  const armor = find(db?.armors, ch.equipment?.armorId);
  const primaryWeapon = find(db?.weapons, ch.equipment?.primaryWeaponId);
  const secondaryWeapon = ch.equipment?.weaponMode === "one-handed"
    ? find(db?.weapons, ch.equipment?.secondaryWeaponId)
    : null;

  const { contributions, exclusions, experienceBonus, ctx } = gather(ch, db);
  const className = cls ? titleCase(cls.name) : "Class";

  const traits = effectiveTraits(ch, contributions, ctx);
  ctx.traits = {};
  for (const key of TRAIT_KEYS) ctx.traits[key] = traits[key].total ?? 0;

  return {
    traits,
    exclusions,
    experiences: experienceStats(ch, experienceBonus),
    // Evasion has no cap in the rules, unlike Hit Points, Stress and Armor Score.
    evasion: cls ? stat([
      { label: `${className} (class)`, value: cls.startingEvasion },
      ...advancementPart(ch.evasionBonus),
      ...partsFor(contributions, "evasion", ctx),
    ]) : null,
    hitPoints: cls ? capped(stat([
      { label: `${className} (class)`, value: cls.startingHitPoints },
      ...advancementPart(ch.hitPointSlotsBonus),
      ...partsFor(contributions, "hitPointSlots", ctx),
    ]), MAX_HIT_POINT_SLOTS, "Hit Point slots") : null,
    stress: capped(stat([
      { label: "Base", value: BASE_STRESS_SLOTS },
      ...advancementPart(ch.stressSlotsBonus),
      ...partsFor(contributions, "stressSlots", ctx),
    ]), MAX_STRESS_SLOTS, "Stress slots"),
    proficiency: stat([{ label: "Level achievements and advancements", value: ch.proficiency }]),
    armorScore: armorScoreStat(armor, db, contributions, ctx),
    ...thresholdStats(ch, armor, contributions, ctx),
    primaryAttack: attackStat(primaryWeapon, traits, contributions, ctx, "primary"),
    secondaryAttack: attackStat(secondaryWeapon, traits, contributions, ctx, "secondary"),
    spellcast: spellcastStat(sub, traits, contributions, ctx),
  };
}

// A zero bonus is left out entirely: "Advancements +0" is noise in a breakdown.
function advancementPart(bonus) {
  return bonus ? [{ label: "Level up advancements", value: bonus }] : [];
}

// Base assignment plus advancement picks, plus whatever equipment and cards modify. Armor and
// weapons are the usual source (Full Plate's -1 Agility, a Halberd's -1 Finesse).
function effectiveTraits(ch, contributions, ctx) {
  const out = {};
  for (const key of TRAIT_KEYS) {
    const base = ch.traits?.[key];
    if (base === null || base === undefined) {
      out[key] = { total: null, parts: [] };
      continue;
    }
    const parts = [{ label: "Assigned at creation, plus advancements", value: base }];
    for (const entry of contributions) {
      const traitMods = effectValue(entry.effect.traits, ctx);
      const value = traitMods?.[key];
      if (value) parts.push({ label: entry.label, value });
    }
    out[key] = stat(parts);
  }
  return out;
}

// Experiences get their modifier from the level up replay; a couple of features add a permanent
// bonus on top of that, so the sheet shows the sum and the breakdown says where it came from.
function experienceStats(ch, experienceBonus) {
  return (ch.experiences || []).map((exp) => {
    const parts = [{ label: "Experience", value: exp.modifier ?? exp.baseModifier ?? 2 }];
    if (experienceBonus[exp.id]) {
      parts.push({ label: "Permanent bonus", value: experienceBonus[exp.id] });
    }
    return { id: exp.id, name: exp.name, ...stat(parts) };
  });
}

function armorScoreStat(armor, db, contributions, ctx) {
  if (!db?.armors) return null;
  // Unarmored is 0 by the SRD. Unreachable today (the wizard requires armor) but the rule is
  // stated here rather than assumed, so it's already right when equipping becomes optional.
  const parts = armor
    ? [{ label: armor.name["en-US"], value: armor.baseScore }]
    : [{ label: "No armor", value: 0 }];
  parts.push(...partsFor(contributions, "armorScore", ctx));
  return capped(stat(parts), MAX_ARMOR_SCORE, "Armor Score");
}

function thresholdStats(ch, armor, contributions, ctx) {
  if (!ch.equipment) return { majorThreshold: null, severeThreshold: null };
  const majorParts = partsFor(contributions, "majorThreshold", ctx);
  const severeParts = partsFor(contributions, "severeThreshold", ctx);
  if (armor) {
    // "always add your current level" — the same rule damageThresholds() states, spelled out
    // as parts here so the breakdown can show the level separately from the armor.
    const th = damageThresholds(armor.baseMajorThreshold, armor.baseSevereThreshold, ch.level);
    return {
      majorThreshold: stat([
        { label: armor.name["en-US"], value: armor.baseMajorThreshold },
        { label: "Your level", value: th.major - armor.baseMajorThreshold },
        ...majorParts,
      ]),
      severeThreshold: stat([
        { label: armor.name["en-US"], value: armor.baseSevereThreshold },
        { label: "Your level", value: th.severe - armor.baseSevereThreshold },
        ...severeParts,
      ]),
    };
  }
  // SRD: unarmored, Major equals your level and Severe twice your level.
  return {
    majorThreshold: stat([{ label: "No armor — your level", value: ch.level }, ...majorParts]),
    severeThreshold: stat([{ label: "No armor — twice your level", value: ch.level * 2 }, ...severeParts]),
  };
}

// An attack roll uses the trait the weapon specifies (SRD). Proficiency is not part of it —
// that scales damage dice, not the roll to hit.
function attackStat(weapon, traits, contributions, ctx, scope) {
  if (!weapon) return null;
  const key = String(weapon.trait || "").toLowerCase();
  const trait = traits[key];
  if (!trait || trait.total === null) return null;
  return {
    weaponName: weapon.name["en-US"],
    traitKey: key,
    ...stat([
      { label: `${TRAIT_LABELS[key]} (${weapon.name["en-US"]})`, value: trait.total },
      ...partsFor(contributions, "attack", ctx, scope),
    ]),
  };
}

// Deliberately NOT a number: the modifier is already on show in the trait box, so this answers
// "which trait do I roll?". A bonus that applies to Spellcast Rolls specifically is appended
// rather than folded into the trait, because a plain roll of that trait doesn't get it.
function spellcastStat(sub, traits, contributions, ctx) {
  const key = String(sub?.spellcastTrait || "").toLowerCase();
  if (!key || !TRAIT_LABELS[key]) return null; // Guardian and Warrior have no Spellcast trait
  const trait = traits[key];
  const bonusParts = partsFor(contributions, "spellcast", ctx);
  const bonus = bonusParts.reduce((sum, p) => sum + p.value, 0);
  return {
    traitKey: key,
    traitLabel: TRAIT_LABELS[key],
    bonus,
    display: bonus ? `${TRAIT_LABELS[key]} ${bonus > 0 ? "+" : ""}${bonus}` : TRAIT_LABELS[key],
    parts: [
      { label: `Spellcast trait: ${TRAIT_LABELS[key]}`, value: trait?.total ?? 0 },
      ...bonusParts,
    ],
    note: bonus
      ? "This bonus applies to Spellcast Rolls only — a plain roll of that trait doesn't get it."
      : undefined,
  };
}

function titleCase(str) {
  return str ? str.charAt(0) + str.slice(1).toLowerCase() : "";
}
