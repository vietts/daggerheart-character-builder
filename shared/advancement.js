// Generic advancement rules (Core Rulebook p.109-111): the same options and slots
// apply to every class, so a single table is enough instead of per-class data.
// Multiclassing is NOT implemented (deliberate scope cut: rare in practice, adds
// disproportionate data/UI complexity for a personal-scale tool).

// NEW slots that unlock starting at each tier (cumulative, not replaced: at tier 3
// you have tier 2's slots plus the new tier 3 ones, and so on).
export const TIER_SLOT_TABLE = {
  traits: { 2: 3, 3: 3, 4: 3 },
  hitPoint: { 2: 2, 3: 2, 4: 2 },
  stress: { 2: 2, 3: 2, 4: 2 },
  experience: { 2: 1, 3: 1, 4: 1 },
  domainCard: { 2: 1, 3: 1, 4: 1 },
  evasion: { 2: 1, 3: 1, 4: 1 },
  subclass: { 3: 1, 4: 1 },
  proficiency: { 3: 2, 4: 2 }, // requires marking both slots together: costs the entire level up's 2 "points"
};

// Tiers that have advancement slots at all (tier 1 is level 1: no level ups yet).
export const SLOT_TIERS = [2, 3, 4];

export const ADVANCEMENT_LABELS = {
  traits: "+1 to two unmarked traits",
  hitPoint: "+1 permanent Hit Point slot",
  stress: "+1 permanent Stress slot",
  experience: "+1 to two existing Experiences",
  domainCard: "Extra domain card (in addition to the one guaranteed every level)",
  evasion: "+1 permanent Evasion",
  subclass: "Upgrade subclass card (Foundation → Specialization → Mastery)",
  proficiency: "+1 Proficiency — uses both picks for this level",
};

// Cost in "choice points": every level up grants 2 points; a normal option costs 1,
// Proficiency (and Multiclass, not implemented) costs 2 together.
export function optionCost(key) {
  return key === "proficiency" ? 2 : 1;
}

export function tierForLevel(level) {
  if (level <= 1) return 1;
  if (level <= 4) return 2;
  if (level <= 7) return 3;
  return 4;
}

// Highest domain card level the "extra domain card" option allows, per the tier of the
// slot being marked. The character sheet spells this out on the option itself: the tier 2
// slot reads "...of your level or lower ... (up to level 4)", tier 3 "(up to level 7)",
// tier 4 has no parenthetical. So two limits apply at once — your current level, and the
// cap of the slot you mark — which differ whenever a lower tier's slot is left unused and
// spent later. The guaranteed card gained every level has no tier cap, only your level.
export const TIER_CARD_CAP = { 2: 4, 3: 7, 4: 10 };

export function extraCardLevelCap(level, slotTier) {
  return Math.min(level, TIER_CARD_CAP[slotTier] ?? level);
}

// Hit Point and Stress slots are both capped at 12. In practice only Hit Points can reach
// it (Stress starts at 6, and the 6 slots available across all tiers land exactly on 12).
export const MAX_HIT_POINT_SLOTS = 12;
export const MAX_STRESS_SLOTS = 12;

// Every character starts with 6 Stress slots regardless of class, unlike Hit Points and
// Evasion which come from classes.json.
export const BASE_STRESS_SLOTS = 6;

// "A PC's Armor Score can't exceed 12." (SRD, Armor)
export const MAX_ARMOR_SCORE = 12;

export function slotsInTier(key, tier) {
  return TIER_SLOT_TABLE[key]?.[tier] || 0;
}

// Proficiency is the one option that marks both of its tier's slots at once.
export function slotsPerPick(key) {
  return key === "proficiency" ? 2 : 1;
}

export function totalSlotsForOption(key, tier) {
  let total = 0;
  for (let t = 2; t <= tier; t++) total += slotsInTier(key, t);
  return total;
}

// Slot usage is tracked per option AND per tier, because which slot you mark can matter:
// see extraCardLevelCap. Shape: { traits: { 2: 3, 3: 1, 4: 0 }, ... }
export function blankSlotsUsed() {
  const state = {};
  for (const key of Object.keys(TIER_SLOT_TABLE)) {
    state[key] = { 2: 0, 3: 0, 4: 0 };
  }
  return state;
}

export function usedSlotsForOption(slotsUsed, key) {
  const perTier = slotsUsed?.[key];
  if (!perTier) return 0;
  return SLOT_TIERS.reduce((sum, tier) => sum + (perTier[tier] || 0), 0);
}

export function remainingSlots(slotsUsed, key, level) {
  return totalSlotsForOption(key, tierForLevel(level)) - usedSlotsForOption(slotsUsed, key);
}

// Tiers whose slot for this option is still unmarked and reachable at this level: the
// choices offered when marking a box ("your tier or below").
export function openSlotTiers(slotsUsed, key, level) {
  const maxTier = tierForLevel(level);
  const open = [];
  for (const tier of SLOT_TIERS) {
    if (tier > maxTier) break;
    if ((slotsUsed?.[key]?.[tier] || 0) < slotsInTier(key, tier)) open.push(tier);
  }
  return open;
}

// Options unlocked at this level's tier.
export function availableOptionKeys(level) {
  const tier = tierForLevel(level);
  if (tier === 1) return [];
  return Object.keys(TIER_SLOT_TABLE).filter((key) => totalSlotsForOption(key, tier) > 0);
}

export function isLevelAchievement(level) {
  return level === 2 || level === 5 || level === 8;
}

// Current damage thresholds: armor base + level (per the "always add your current level" rule).
export function damageThresholds(baseMajor, baseSevere, level) {
  return { major: baseMajor + level, severe: baseSevere + level };
}

// Characters saved before slots were tracked per tier hold a single total per option.
// Split it across the tiers lowest-first: it's deterministic, and it's what playing well
// does anyway, since spending the cheap slots first keeps the higher domain card caps free.
function splitFlatSlotTotals(flat) {
  const state = blankSlotsUsed();
  for (const key of Object.keys(TIER_SLOT_TABLE)) {
    let left = flat?.[key] || 0;
    for (const tier of SLOT_TIERS) {
      const take = Math.min(left, slotsInTier(key, tier));
      state[key][tier] = take;
      left -= take;
    }
    // More marked than the rules allow: keep the count rather than silently drop it, so the
    // character sheet shows the discrepancy instead of quietly handing back free slots.
    if (left > 0) state[key][4] += left;
  }
  return state;
}

function hasPerTierSlots(value) {
  return !!value && typeof value.traits === "object" && value.traits !== null;
}

let experienceSeq = 0;
function newExperienceId() {
  return `exp_${Date.now().toString(36)}${(experienceSeq++).toString(36)}`;
}

// Every character carries a BASELINE — its stats at some level — and the level up choices
// made since, replayed on top. A character built here baselines at level 1 on its creation
// stats; one that already existed baselines at whatever level it had reached, on the stats
// it already had. Same mechanism either way, so nothing needs a "before/after" special case
// and no stat is ever recomputed from choices that were never recorded.
function captureBaseline(ch) {
  return {
    traits: { ...ch.traits },
    traitMarks: { ...ch.traitMarks },
    proficiency: ch.proficiency,
    hitPointSlotsBonus: ch.hitPointSlotsBonus,
    stressSlotsBonus: ch.stressSlotsBonus,
    evasionBonus: ch.evasionBonus,
    subclassTier: ch.subclassTier,
    slotsUsed: JSON.parse(JSON.stringify(ch.advancementSlotsUsed)),
    domainCardIds: [...(ch.domainCardIds || [])],
  };
}

// A one-off repair, for characters saved while the level up screen wrote an exchange into the
// starting cards as well as into the level entry. The collection came out right either way —
// the replay applies the swap to whichever list it finds it in — but the baseline was left
// claiming the character had started with a card they swapped in later, and validateEntry
// reads the baseline as "what you owned before this level". So a legal swap of a STARTING card
// reported "the card being given up isn't in the collection at this level" on every load, and
// no edit could clear it: re-saving the level wrote the same baked list back.
//
// Newest level first, so a card swapped more than once unwinds in the reverse of the order it
// was applied. Only a swap that looks baked is touched — the taken card sitting in the starting
// list where the given-up card is absent — which makes this a no-op on repaired characters and
// on every exchange written since.
function unbakeExchanges(ch) {
  if (ch.creationCardsUnbaked) return;
  for (const entry of [...ch.levelUps].sort((a, b) => b.level - a.level)) {
    const swap = entry.exchange;
    if (!swap?.outCardId || !swap.inCardId) continue;
    const at = ch.creationDomainCardIds.indexOf(swap.inCardId);
    if (at >= 0 && !ch.creationDomainCardIds.includes(swap.outCardId)) {
      ch.creationDomainCardIds[at] = swap.outCardId;
    }
  }
  ch.creationCardsUnbaked = true;
}

// Which level granted each point of a level-dependent stat, so a "?" breakdown can say
// "Level 3 advancement +1" rather than lumping an entire career into "Level up advancements".
//
// This walks the recorded entries the same way the replay in shared/history.js does, but it
// only attributes: it derives no stat of its own, so the two can't disagree about a number.
// (The suite pins that down — every credit here has to sum to the bonus the replay produced.)
// It lives here rather than beside the replay because the breakdowns are built in
// derived-stats.js, which the replay imports: the attribution has to sit below both.
//
// Only recorded levels can be credited. A character baselined above level 1 carries bonuses
// from levels nobody wrote down, and those stay unattributed on purpose — the breakdown
// reports the remainder as one generic part rather than inventing a level for it.
export function advancementCredits(ch) {
  const credits = { hitPoint: [], stress: [], evasion: [], proficiency: [], traits: {}, experiences: {} };
  const bump = (list, level, source) => {
    const at = list.find((c) => c.level === level && c.source === source);
    if (at) at.value += 1; else list.push({ level, source, value: 1 });
  };
  const into = (map, key) => (map[key] ||= []);

  const byLevel = new Map((ch.levelUps || []).map((e) => [e.level, e]));
  for (let level = (ch.baselineLevel ?? 1) + 1; level <= ch.level; level++) {
    // Step One on the sheet, before any advancement is chosen: the tier achievement.
    if (isLevelAchievement(level)) bump(credits.proficiency, level, "achievement");
    for (const pick of byLevel.get(level)?.picks || []) {
      switch (pick.key) {
        case "traits":
          for (const key of pick.traits || []) bump(into(credits.traits, key), level, "advancement");
          break;
        case "experience":
          for (const id of pick.experienceIds || []) bump(into(credits.experiences, id), level, "advancement");
          break;
        case "hitPoint": bump(credits.hitPoint, level, "advancement"); break;
        case "stress": bump(credits.stress, level, "advancement"); break;
        case "evasion": bump(credits.evasion, level, "advancement"); break;
        case "proficiency": bump(credits.proficiency, level, "advancement"); break;
      }
    }
  }
  return credits;
}

// Characters saved before levels were introduced don't have these fields: this adds
// them without touching the rest, so they stay valid as "level 1" the moment they're opened.
export function ensureLevelFields(ch) {
  if (ch.level === undefined) ch.level = 1;
  if (ch.proficiency === undefined) ch.proficiency = 1;
  if (!ch.traitMarks) ch.traitMarks = { agility: false, strength: false, finesse: false, instinct: false, presence: false, knowledge: false };
  if (ch.hitPointSlotsBonus === undefined) ch.hitPointSlotsBonus = 0;
  if (ch.stressSlotsBonus === undefined) ch.stressSlotsBonus = 0;
  if (ch.evasionBonus === undefined) ch.evasionBonus = 0;
  if (!ch.subclassTier) ch.subclassTier = "foundation";
  if (!hasPerTierSlots(ch.advancementSlotsUsed)) ch.advancementSlotsUsed = splitFlatSlotTotals(ch.advancementSlotsUsed);
  if (!ch.domainVaultIds) ch.domainVaultIds = [];
  // Answers to the few features that say "choose": Clank's Purposeful Design, Vitality, Master
  // of the Craft. Keyed by the shared/effects.js key that asked. Missing answers are shown as a
  // nudge on the sheet, never enforced — characters saved before this existed must stay editable.
  if (!ch.effectChoices) ch.effectChoices = {};
  // The cards picked during character creation, kept apart from the ones gained on level up so
  // the creation wizard can edit them without touching the rest of the collection.
  //
  // The 2 is a guess, made once, for characters saved before this field existed: it's the usual
  // number, but a School of Knowledge wizard starts with 3. This function has no data files to
  // consult, so it can't do better — re-picking the starting cards in the wizard corrects it,
  // and everything written since records the real list.
  if (!ch.creationDomainCardIds) ch.creationDomainCardIds = (ch.domainCardIds || []).slice(0, 2);

  if (!Array.isArray(ch.levelUps)) ch.levelUps = [];
  if (ch.baselineLevel === undefined) ch.baselineLevel = ch.level;
  if (!ch.baseline) ch.baseline = captureBaseline(ch);
  unbakeExchanges(ch);

  // Experiences need stable ids: the level 2/5/8 achievements append new ones, which shifts
  // every index after them. sinceLevel records when each became available, so a level up
  // can't be edited to raise an Experience the character didn't have yet.
  for (const exp of ch.experiences || []) {
    if (!exp.id) exp.id = newExperienceId();
    if (exp.baseModifier === undefined) exp.baseModifier = exp.modifier ?? 2;
    if (exp.sinceLevel === undefined) exp.sinceLevel = ch.baselineLevel;
  }
  return ch;
}

// Domain cards currently "in loadout" (max 5, same as the card browser): every
// domainCardIds entry that hasn't been set aside in the vault.
export function activeDomainCardIds(character) {
  return character.domainCardIds.filter((id) => !character.domainVaultIds.includes(id));
}

export const SUBCLASS_TIER_ORDER = ["foundation", "specialization", "mastery"];

export function nextSubclassTier(current) {
  const idx = SUBCLASS_TIER_ORDER.indexOf(current);
  return SUBCLASS_TIER_ORDER[Math.min(idx + 1, SUBCLASS_TIER_ORDER.length - 1)];
}

export const SUBCLASS_TIER_LABELS = {
  foundation: "Foundation",
  specialization: "Specialization",
  mastery: "Mastery",
};

// A subclass tier implies every tier below it: upgrading *adds* a card rather than replacing
// the previous one, so a character at Specialization still has their Foundation features.
// An unrecognised tier falls back to foundation, like ensureLevelFields does.
export function subclassTiersUpTo(tier) {
  const idx = SUBCLASS_TIER_ORDER.indexOf(tier);
  return SUBCLASS_TIER_ORDER.slice(0, idx < 0 ? 1 : idx + 1);
}
