// Replay of recorded level up choices.
//
// Advancement effects used to be applied straight onto the character and the choices thrown
// away, which made a past level up impossible to revisit: a trait raised at level 3 is
// indistinguishable from one assigned at creation, and the marks that would have told you
// are wiped by the tier achievements at 5 and 8. So the choices are the stored truth now,
// and every level-dependent stat is derived by replaying them from the character's baseline.
//
// Everything here is a pure function over plain objects: no DOM, no storage.

import {
  ADVANCEMENT_LABELS,
  MAX_HIT_POINT_SLOTS,
  MAX_STRESS_SLOTS,
  extraCardLevelCap,
  isLevelAchievement,
  nextSubclassTier,
  optionCost,
  slotsInTier,
  slotsPerPick,
  tierForLevel,
  totalSlotsForOption,
} from "./advancement.js";
import { effectBonuses, hitPointTotal, stressTotal } from "./derived-stats.js";

// The character as it stood at some level, for the purpose of asking shared/effects.js what
// it was granting then. Rewinding the subclass tier and the card collection matters: a cap
// check on level 4 must not count a Vitality card the character only picked up at level 7.
// Everything else an effect can key on — ancestry, equipment — can't change on a level up.
export function characterAtLevel(ch, state) {
  return { ...ch, subclassTier: state.subclassTier, domainCardIds: state.cardIds, domainVaultIds: [] };
}

const TRAIT_KEYS = ["agility", "strength", "finesse", "instinct", "presence", "knowledge"];

// Cards owned at the baseline. At level 1 that's whatever the creation wizard currently
// holds, so editing the starting cards flows straight through the replay.
function baselineCardIds(ch) {
  if (ch.baselineLevel <= 1) return [...(ch.creationDomainCardIds || [])];
  return [...(ch.baseline.domainCardIds || [])];
}

function entriesFor(ch) {
  return [...(ch.levelUps || [])].sort((a, b) => a.level - b.level);
}

function blankState(ch) {
  const b = ch.baseline;
  return {
    traits: { ...b.traits },
    traitMarks: { ...b.traitMarks },
    proficiency: b.proficiency,
    hitPointSlotsBonus: b.hitPointSlotsBonus,
    stressSlotsBonus: b.stressSlotsBonus,
    evasionBonus: b.evasionBonus,
    subclassTier: b.subclassTier,
    slotsUsed: JSON.parse(JSON.stringify(b.slotsUsed)),
    cardIds: baselineCardIds(ch),
    expBonus: {}, // experience id -> how many +1s it has picked up
  };
}

// Step One on the sheet: the tier achievement, which happens BEFORE advancements are
// chosen — so a trait freed by the level 5 or 8 clear can be raised again that same level,
// and the Experience gained at 2/5/8 can be boosted by an advancement at that same level.
function applyAchievement(state, level) {
  if (!isLevelAchievement(level)) return;
  state.proficiency += 1;
  if (level >= 5) {
    for (const key of TRAIT_KEYS) state.traitMarks[key] = false;
  }
}

function applyEntry(state, entry) {
  if (!entry) return;
  const extraCardIds = [];

  for (const pick of entry.picks || []) {
    const perTier = (state.slotsUsed[pick.key] ||= { 2: 0, 3: 0, 4: 0 });
    perTier[pick.slotTier] = (perTier[pick.slotTier] || 0) + slotsPerPick(pick.key);

    switch (pick.key) {
      case "traits":
        for (const key of pick.traits || []) {
          state.traits[key] = (state.traits[key] || 0) + 1;
          state.traitMarks[key] = true;
        }
        break;
      case "hitPoint": state.hitPointSlotsBonus += 1; break;
      case "stress": state.stressSlotsBonus += 1; break;
      case "evasion": state.evasionBonus += 1; break;
      case "experience":
        for (const id of pick.experienceIds || []) state.expBonus[id] = (state.expBonus[id] || 0) + 1;
        break;
      case "subclass":
        if (state.subclassTier !== "mastery") state.subclassTier = nextSubclassTier(state.subclassTier);
        break;
      case "proficiency": state.proficiency += 1; break;
      case "domainCard":
        if (pick.cardId) extraCardIds.push(pick.cardId);
        break;
    }
  }

  if (entry.mandatoryCardId) state.cardIds.push(entry.mandatoryCardId);
  for (const id of extraCardIds) state.cardIds.push(id);
  // Cards a feature gained at this level handed over outright, rather than ones bought with an
  // advancement slot — the School of Knowledge's "take an additional domain card" at each tier.
  for (const id of entry.grantedCardIds || []) state.cardIds.push(id);

  // The optional swap allowed on every level up. Replacing in place keeps the collection's
  // order stable, so the loadout/vault split doesn't shuffle when an early level is edited.
  const swap = entry.exchange;
  if (swap?.outCardId && swap.inCardId) {
    const at = state.cardIds.indexOf(swap.outCardId);
    if (at >= 0) state.cardIds[at] = swap.inCardId;
  }
}

// The character's state as it stood at the START of `upToLevel`, i.e. with every level
// below it applied. Used both to derive current stats and to give the editor the context a
// past level was actually chosen in.
export function stateAtLevel(ch, upToLevel) {
  const state = blankState(ch);
  const byLevel = new Map(entriesFor(ch).map((e) => [e.level, e]));
  for (let level = ch.baselineLevel + 1; level < upToLevel; level++) {
    applyAchievement(state, level);
    applyEntry(state, byLevel.get(level));
  }
  return state;
}

// Experiences the character has at a given level, with the modifier they had then.
export function experiencesAtLevel(ch, level, expBonus) {
  return (ch.experiences || [])
    .filter((exp) => exp.sinceLevel <= level)
    .map((exp) => ({ ...exp, modifier: exp.baseModifier + (expBonus?.[exp.id] || 0) }));
}

// Writes the replayed values back onto the character. Everything it touches is derived:
// the stored truth is baseline + levelUps, so a bad result is always recoverable by fixing
// the replay and running this again.
export function recomputeCharacter(ch) {
  const state = stateAtLevel(ch, ch.level + 1);

  ch.traits = state.traits;
  ch.traitMarks = state.traitMarks;
  ch.proficiency = state.proficiency;
  ch.hitPointSlotsBonus = state.hitPointSlotsBonus;
  ch.stressSlotsBonus = state.stressSlotsBonus;
  ch.evasionBonus = state.evasionBonus;
  ch.subclassTier = state.subclassTier;
  ch.advancementSlotsUsed = state.slotsUsed;
  ch.domainCardIds = state.cardIds;

  for (const exp of ch.experiences || []) {
    exp.modifier = exp.baseModifier + (state.expBonus[exp.id] || 0);
  }

  // Cards can leave the collection through an exchange, so the vault has to drop anything
  // no longer owned; then the >5 loadout spill applies as it does after a level up.
  ch.domainVaultIds = (ch.domainVaultIds || []).filter((id) => ch.domainCardIds.includes(id));
  const active = ch.domainCardIds.filter((id) => !ch.domainVaultIds.includes(id));
  while (active.length > 5) ch.domainVaultIds.push(active.shift());

  return ch;
}

// Records one level's choices — replacing that level's entry if it already has one — and
// re-derives everything from the result. The level up screen writes every entry through here
// so that what an edit does to a character is defined in the same file as the replay that
// reads it back.
//
// Note what it does NOT touch: the baseline. An exchange is applied by applyEntry above and
// nowhere else. Writing the swapped-in card into creationDomainCardIds as well used to look
// harmless — the replay produced the same collection either way — but it made the baseline
// claim the character had started with a card they only swapped in later, and validateEntry
// reads that baseline as "what you owned before this level". The result was a legal swap
// reported as illegal, with no edit that could clear it. See the repair in ensureLevelFields.
export function writeLevelEntry(ch, entry) {
  if (!Array.isArray(ch.levelUps)) ch.levelUps = [];
  const at = ch.levelUps.findIndex((e) => e.level === entry.level);
  if (at >= 0) ch.levelUps[at] = entry; else ch.levelUps.push(entry);
  return recomputeCharacter(ch);
}

// Levels whose choices are recorded, oldest first.
export function recordedLevels(ch) {
  return entriesFor(ch).map((e) => e.level);
}

export function levelUpAt(ch, level) {
  return (ch.levelUps || []).find((e) => e.level === level) || null;
}

// ---------- validation ----------

// The character as the choices for `level` were made against: everything below it applied,
// plus that level's own tier achievement, which happens first (Step One on the sheet) and
// is why a trait freed at 5 or 8 can be raised the very same level.
export function contextForLevel(ch, level) {
  const state = stateAtLevel(ch, level);
  applyAchievement(state, level);
  return state;
}

function cardsById(db) {
  const map = new Map();
  for (const c of db?.domainCards || []) map.set(c.id, c);
  return map;
}

function cardName(card) {
  return card?.name?.["en-US"] || "that card";
}

// Everything wrong with one level's choices, as sentences a player can act on. Shared by
// the level up screen and the history list so the two can't disagree about what's legal.
export function validateEntry(ch, entry, db) {
  const level = entry.level;
  const errors = [];
  const state = contextForLevel(ch, level);
  const cls = (db?.classes || []).find((c) => c.id === ch.classId);
  const byId = cardsById(db);
  const tier = tierForLevel(level);

  const picks = entry.picks || [];
  const spent = picks.reduce((sum, p) => sum + optionCost(p.key), 0);
  if (spent !== 2) errors.push(`${spent} of the 2 choice points for this level are spent.`);

  // Slots: what this level marks, on top of what every other level already marked.
  const marked = {};
  for (const pick of picks) {
    (marked[pick.key] ||= {})[pick.slotTier] = (marked[pick.key]?.[pick.slotTier] || 0) + slotsPerPick(pick.key);
  }
  for (const [key, perTier] of Object.entries(marked)) {
    for (const [slotTier, count] of Object.entries(perTier)) {
      const t = Number(slotTier);
      if (t > tier) {
        errors.push(`${ADVANCEMENT_LABELS[key]}: a tier ${t} slot isn't available at level ${level}.`);
        continue;
      }
      const already = state.slotsUsed?.[key]?.[t] || 0;
      if (already + count > slotsInTier(key, t)) {
        errors.push(`${ADVANCEMENT_LABELS[key]}: no tier ${t} slot left to mark.`);
      }
    }
    if ((state.slotsUsed?.[key] ? Object.values(state.slotsUsed[key]).reduce((a, b) => a + b, 0) : 0)
      + Object.values(perTier).reduce((a, b) => a + b, 0) > totalSlotsForOption(key, tier)) {
      errors.push(`${ADVANCEMENT_LABELS[key]}: more slots marked than this tier allows.`);
    }
  }

  // Traits: two distinct unmarked ones per pick, and all distinct across the level.
  const traitsThisLevel = [];
  for (const pick of picks.filter((p) => p.key === "traits")) {
    const keys = pick.traits || [];
    if (new Set(keys).size !== 2) errors.push("Trait increase: pick exactly 2 different traits.");
    for (const key of keys) {
      if (state.traitMarks[key]) errors.push(`${titleCase(key)} is already marked this tier and can't be raised again yet.`);
      if (traitsThisLevel.includes(key)) errors.push(`${titleCase(key)} is picked twice at this level.`);
      traitsThisLevel.push(key);
    }
  }

  for (const pick of picks.filter((p) => p.key === "experience")) {
    const ids = pick.experienceIds || [];
    if (new Set(ids).size !== 2) errors.push("Experience increase: pick exactly 2 different Experiences.");
    for (const id of ids) {
      const exp = (ch.experiences || []).find((e) => e.id === id);
      if (!exp) errors.push("An Experience picked at this level no longer exists.");
      else if (exp.sinceLevel > level) errors.push(`"${exp.name || "(unnamed)"}" wasn't gained until level ${exp.sinceLevel}.`);
    }
  }

  // Slots granted by ancestry, subclass or a card count towards the cap: a Giant reaches 12
  // Hit Points one advancement sooner than everyone else, so this must see them too.
  const cls_ = cls;
  const granted = effectBonuses(characterAtLevel(ch, state), db);
  const hp = hitPointTotal(cls_, state.hitPointSlotsBonus + picks.filter((p) => p.key === "hitPoint").length, granted.hitPointSlots);
  if (cls_ && hp > MAX_HIT_POINT_SLOTS) errors.push(`This would take Hit Points past the maximum of ${MAX_HIT_POINT_SLOTS}.`);
  const stress = stressTotal(state.stressSlotsBonus + picks.filter((p) => p.key === "stress").length, granted.stressSlots);
  if (stress > MAX_STRESS_SLOTS) errors.push(`This would take Stress past the maximum of ${MAX_STRESS_SLOTS}.`);

  let tierAfterPicks = state.subclassTier;
  for (const _ of picks.filter((p) => p.key === "subclass")) {
    if (state.subclassTier === "mastery") errors.push("The subclass is already at Mastery.");
    tierAfterPicks = nextSubclassTier(tierAfterPicks);
  }

  // Cards: owned so far, plus everything this level adds, so duplicates surface wherever
  // they come from.
  const owned = new Set(state.cardIds);
  const check = (id, cap, what) => {
    if (!id) { errors.push(`${what}: no card chosen.`); return; }
    const card = byId.get(id);
    if (!card) { errors.push(`${what}: that card no longer exists.`); return; }
    if (owned.has(id)) errors.push(`${what}: ${cardName(card)} is already in the collection.`);
    if (card.level > cap) errors.push(`${what}: ${cardName(card)} is level ${card.level}, above the limit of ${cap}.`);
    if (cls_ && !cls_.domains.includes(card.domain)) errors.push(`${what}: ${cardName(card)} isn't in a domain this class has access to.`);
    owned.add(id);
  };

  if (db) {
    check(entry.mandatoryCardId, level, "New domain card");
    for (const pick of picks.filter((p) => p.key === "domainCard")) {
      check(pick.cardId, extraCardLevelCap(level, pick.slotTier), `Extra domain card (tier ${pick.slotTier} slot)`);
    }

    // Cards granted by a feature gained at this level. How many is the difference between what
    // the character's effects grant before this level's picks and after them, so the rule lives
    // in effects.js rather than here; only your level caps these, since they aren't slots.
    const before = granted.extraDomainCards;
    const after = effectBonuses({ ...characterAtLevel(ch, state), subclassTier: tierAfterPicks }, db).extraDomainCards;
    const expected = Math.max(0, after - before);
    const grantedCards = entry.grantedCardIds || [];
    if (grantedCards.length !== expected) {
      errors.push(`Extra domain card from a subclass upgrade: ${grantedCards.length} chosen, ${expected} granted at this level.`);
    }
    for (const id of grantedCards) check(id, level, "Extra domain card from a subclass upgrade");

    const swap = entry.exchange;
    if (swap?.outCardId || swap?.inCardId) {
      const out = byId.get(swap.outCardId);
      if (!out || !owned.has(swap.outCardId)) errors.push("Exchange: the card being given up isn't in the collection at this level.");
      else {
        owned.delete(swap.outCardId);
        check(swap.inCardId, out.level, "Exchange");
      }
    }
  }

  return errors;
}

function titleCase(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// Every recorded level that no longer adds up, with the reasons. Levels the player has
// explicitly accepted are reported but not counted as needing attention.
export function validateLevelUps(ch, db) {
  return entriesFor(ch)
    .map((entry) => ({ level: entry.level, accepted: !!entry.acceptedAsIs, errors: validateEntry(ch, entry, db) }))
    .filter((r) => r.errors.length > 0);
}

export function unresolvedProblems(ch, db) {
  return validateLevelUps(ch, db).filter((r) => !r.accepted);
}

// ---------- description ----------

const SHORT_LABELS = {
  traits: "+1 to two traits",
  hitPoint: "+1 Hit Point slot",
  stress: "+1 Stress slot",
  experience: "+1 to two Experiences",
  domainCard: "Extra domain card",
  evasion: "+1 Evasion",
  subclass: "Subclass upgrade",
  proficiency: "+1 Proficiency",
};

// A one-line summary of what was chosen at a level, for the history list.
export function describeLevelUp(ch, entry, db) {
  const byId = cardsById(db);
  const parts = [];
  for (const pick of entry.picks || []) {
    if (pick.key === "traits") {
      parts.push((pick.traits || []).map((k) => `+1 ${titleCase(k)}`).join(", "));
    } else if (pick.key === "experience") {
      const names = (pick.experienceIds || []).map((id) => (ch.experiences || []).find((e) => e.id === id)?.name || "(unnamed)");
      parts.push(`+1 to ${names.join(" & ")}`);
    } else if (pick.key === "domainCard") {
      parts.push(`${SHORT_LABELS.domainCard}: ${cardName(byId.get(pick.cardId))}`);
    } else {
      parts.push(SHORT_LABELS[pick.key] || pick.key);
    }
  }
  return parts;
}

export function describeCards(ch, entry, db) {
  const byId = cardsById(db);
  const lines = [];
  if (entry.mandatoryCardId) lines.push(`Card: ${cardName(byId.get(entry.mandatoryCardId))}`);
  for (const id of entry.grantedCardIds || []) {
    lines.push(`Card from your subclass: ${cardName(byId.get(id))}`);
  }
  if (entry.exchange?.outCardId && entry.exchange.inCardId) {
    lines.push(`Exchanged ${cardName(byId.get(entry.exchange.outCardId))} → ${cardName(byId.get(entry.exchange.inCardId))}`);
  }
  return lines;
}
