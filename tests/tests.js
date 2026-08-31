// Tests for the advancement rules and the level history replay.
//
// They run in the browser, against the same ES modules the app loads, so there's nothing
// to install and no build step. Fixtures are written by hand rather than fetched from
// data/, because everything under test is a pure function over plain objects.
//
// Nothing in the app imports this file.

// Every module is loaded with a per-run token so a reload always tests the code as it is on
// disk. Without it the browser will happily re-run the whole suite against a cached copy of a
// module you just edited and report green, which is worse than not running it at all.
//
// The token is the one boot.js put on this file's own URL, so the whole run — this file
// included — is busted by a single value. Opened without one (importing tests.js directly),
// it falls back to a fresh token so the modules under test are still read from disk.
const RUN = new URL(import.meta.url).search || `?run=${Date.now()}`;

const {
  BASE_STRESS_SLOTS,
  MAX_ARMOR_SCORE,
  MAX_HIT_POINT_SLOTS,
  MAX_STRESS_SLOTS,
  SUBCLASS_TIER_LABELS,
  SUBCLASS_TIER_ORDER,
  TIER_CARD_CAP,
  advancementCredits,
  availableOptionKeys,
  blankSlotsUsed,
  ensureLevelFields,
  extraCardLevelCap,
  isLevelAchievement,
  nextSubclassTier,
  openSlotTiers,
  remainingSlots,
  slotsInTier,
  slotsPerPick,
  subclassTiersUpTo,
  tierForLevel,
  totalSlotsForOption,
  usedSlotsForOption,
} = await import(`../shared/advancement.js${RUN}`);
const {
  experiencesAtLevel,
  recomputeCharacter,
  stateAtLevel,
  unresolvedProblems,
  validateEntry,
  validateLevelUps,
  writeLevelEntry,
} = await import(`../shared/history.js${RUN}`);
const {
  TRAIT_KEYS,
  UNARMED_PROFILE,
  derivedStats,
  effectBonuses,
  effectExperienceBonuses,
  evasionTotal,
  hitPointTotal,
  stressTotal,
} = await import(`../shared/derived-stats.js${RUN}`);
const {
  EFFECTS,
  blankAnswer,
  ignoresBurden,
  isAnswered,
  unresolvedChoices,
} = await import(`../shared/effects.js${RUN}`);
const {
  deriveSheet,
} = await import(`../shared/sheet-data.js${RUN}`);
const {
  CONDITIONS,
  DOWNTIME_MOVES_PER_REST,
  HOPE_MAX,
  HOPE_START,
  REST_MOVES,
  applyRestMove,
  clampState,
  defaultState,
  findRestMove,
  maxesFromSheet,
  restClearAmount,
  scarAt,
  tapBox,
  toggleCondition,
} = await import(`../shared/table-state.js${RUN}`);
const {
  LANGUAGES,
  pickLanguage,
  translator,
} = await import(`../shared/i18n.js${RUN}`);
const {
  EXPORT_FORMAT,
  exportFileName,
  importConflicts,
  mergeImported,
  parseImport,
  serializeCharacters,
} = await import(`../shared/transfer.js${RUN}`);
const {
  MAX_BYTES,
  MAX_DECODED_EDGE,
  MAX_EDGE,
  decodedSize,
  fitWithin,
  isPortrait,
  sanitizePortrait,
} = await import(`../shared/portrait.js${RUN}`);
const {
  UNARMED,
  UNARMORED,
  burdenWarning,
  damageText,
  featureLine,
  enumLabel,
  groupByTier,
  weaponStats,
} = await import(`../shared/gear.js${RUN}`);
const {
  CARD_ART_EXT,
} = await import(`../shared/card-art-config.js${RUN}`);
const {
  ancestryCardArtPath,
  communityCardArtPath,
  domainCardArtPath,
  subclassCardArtPath,
} = await import(`../shared/card-render.js${RUN}`);

const {
  CHOOSE_KEYS,
  nextIndex,
  tabStopIndex,
} = await import(`../shared/choice-keys.js${RUN}`);

const { collectEffects } = await import(`../shared/effects.js${RUN}`);

const {
  bareForms,
  bareId,
  indexRecordIds,
  remapCharacterIds,
  resolveRecordId,
} = await import(`../shared/content-ids.js${RUN}`);

// ---------- tiny runner ----------

const groups = [];
let current = null;

function group(name) {
  current = { name, checks: [] };
  groups.push(current);
}
function check(label, ok, detail) {
  current.checks.push({ label, ok: !!ok, detail });
}
function eq(label, got, want) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  check(label, g === w, g === w ? undefined : `got  ${g}\nwant ${w}`);
}
function has(label, errors, snippet) {
  const found = errors.some((e) => e.toLowerCase().includes(snippet.toLowerCase()));
  check(label, found, found ? undefined : `no error mentioning "${snippet}" in:\n${errors.join("\n") || "(no errors)"}`);
}

// ---------- fixtures ----------

const DB = {
  classes: [{ id: "cls", domains: ["VALOR", "BLADE"], startingHitPoints: 7, startingEvasion: 9 }],
  domainCards: [
    { id: "c1", level: 1, domain: "VALOR", name: { "en-US": "One" } },
    // Two more level 1 cards, so a starting card has something legal to be exchanged for.
    { id: "c1b", level: 1, domain: "BLADE", name: { "en-US": "One again" } },
    { id: "c1c", level: 1, domain: "BLADE", name: { "en-US": "One once more" } },
    { id: "c2", level: 2, domain: "VALOR", name: { "en-US": "Two" } },
    { id: "c3", level: 3, domain: "BLADE", name: { "en-US": "Three" } },
    { id: "c4", level: 4, domain: "VALOR", name: { "en-US": "Four" } },
    { id: "c5", level: 5, domain: "VALOR", name: { "en-US": "Five" } },
    { id: "c7", level: 7, domain: "BLADE", name: { "en-US": "Seven" } },
    { id: "off", level: 1, domain: "ARCANA", name: { "en-US": "Offdomain" } },
  ],
};

function newCharacter() {
  return ensureLevelFields({
    id: "t", classId: "cls", subclassId: "sub",
    traits: { agility: 1, strength: 2, finesse: 0, instinct: 1, presence: 0, knowledge: -1 },
    experiences: [
      { id: "e1", name: "A", modifier: 2, baseModifier: 2, sinceLevel: 1 },
      { id: "e2", name: "B", modifier: 2, baseModifier: 2, sinceLevel: 1 },
    ],
    domainCardIds: ["c1"], creationDomainCardIds: ["c1"], domainVaultIds: [],
    level: 1, proficiency: 1,
    traitMarks: { agility: false, strength: false, finesse: false, instinct: false, presence: false, knowledge: false },
    hitPointSlotsBonus: 0, stressSlotsBonus: 0, evasionBonus: 0, subclassTier: "foundation",
  });
}

const entry = (level, picks, card, exchange) => ({ level, picks, mandatoryCardId: card, exchange: exchange || null });

// Records a level up the way the level up screen does, then derives the stats.
function record(ch, level, picks, card, exchange) {
  if (isLevelAchievement(level)) {
    ch.experiences.push({ id: `exp_lv${level}`, name: "", baseModifier: 2, modifier: 2, sinceLevel: level });
  }
  ch.levelUps.push(entry(level, picks, card, exchange));
  ch.level = level;
  return recomputeCharacter(ch);
}

function buildTo(levelUps, level) {
  const ch = newCharacter();
  for (const e of levelUps) record(ch, e.level, e.picks, e.mandatoryCardId, e.exchange);
  ch.level = level;
  return recomputeCharacter(ch);
}

// ---------- staleness ----------

// The token above can't reach the import INSIDE history.js, so history.js could still be
// holding a cached advancement.js. This asks it, indirectly, what card cap it believes in
// and compares that with the copy loaded here. If they disagree, something is stale and
// every result below is untrustworthy — so say so rather than report a confident green.
group("The modules under test are the ones on disk");
{
  // boot.js is what puts the token on this file's URL. Without it the browser can serve a
  // cached tests.js, and the suite reports green against a file you've already changed.
  check(
    "this file was loaded through boot.js, so it isn't a cached copy either",
    new URL(import.meta.url).searchParams.has("run"),
    "tests.js was loaded directly, without a cache-busting token. tests/index.html should\n" +
    "point at boot.js. Hard-reload (Ctrl+Shift+R) before trusting anything below.",
  );
}
{
  const probe = newCharacter();
  probe.level = 2;
  recomputeCharacter(probe);
  const errors = validateEntry(probe, entry(2, [
    { key: "domainCard", slotTier: 2, cardId: "c4" },
    { key: "stress", slotTier: 2 },
  ], "c2"), DB);
  const reported = Number(errors.map((e) => e.match(/above the limit of (\d+)/)?.[1]).find(Boolean));
  const direct = extraCardLevelCap(2, 2);
  check(
    "history.js and advancement.js agree on the card cap",
    reported === direct,
    reported === direct ? undefined
      : `history.js is using a cap of ${reported}, this page loaded ${direct}.\n` +
        "One of them is a cached copy — hard-reload (Ctrl+Shift+R) before trusting anything below.",
  );
}

// ---------- the rules, against the printed character sheet ----------

group("Advancement slots match the printed character guide (p.2)");
eq("+1 to two unmarked traits: 3 per tier", [2, 3, 4].map((t) => slotsInTier("traits", t)), [3, 3, 3]);
eq("Hit Point slot: 2 per tier", [2, 3, 4].map((t) => slotsInTier("hitPoint", t)), [2, 2, 2]);
eq("Stress slot: 2 per tier", [2, 3, 4].map((t) => slotsInTier("stress", t)), [2, 2, 2]);
eq("Experiences: 1 per tier", [2, 3, 4].map((t) => slotsInTier("experience", t)), [1, 1, 1]);
eq("Extra domain card: 1 per tier", [2, 3, 4].map((t) => slotsInTier("domainCard", t)), [1, 1, 1]);
eq("Evasion: 1 per tier", [2, 3, 4].map((t) => slotsInTier("evasion", t)), [1, 1, 1]);
eq("Subclass upgrade: tiers 3 and 4 only", [2, 3, 4].map((t) => slotsInTier("subclass", t)), [0, 1, 1]);
eq("Proficiency: 2 joined slots, tiers 3 and 4 only", [2, 3, 4].map((t) => slotsInTier("proficiency", t)), [0, 2, 2]);
eq("tier 2 offers exactly the six options printed there", availableOptionKeys(3).sort(),
  ["domainCard", "evasion", "experience", "hitPoint", "stress", "traits"]);
eq("tier 3 adds subclass and proficiency", availableOptionKeys(5).sort(),
  ["domainCard", "evasion", "experience", "hitPoint", "proficiency", "stress", "subclass", "traits"]);
eq("proficiency costs both of a level's picks", slotsPerPick("proficiency"), 2);

group("Tiers and achievements");
eq("1 / 2-4 / 5-7 / 8-10", [1, 2, 4, 5, 7, 8, 10].map(tierForLevel), [1, 2, 2, 3, 3, 4, 4]);
eq("achievements at 2, 5 and 8 only", [2, 3, 4, 5, 6, 7, 8, 9].map(isLevelAchievement),
  [true, false, false, true, false, false, true, false]);
eq("subclass ladder stops at mastery", ["foundation", "specialization", "mastery"].map(nextSubclassTier),
  ["specialization", "mastery", "mastery"]);

group("A subclass upgrade adds a card, it doesn't replace the one below");
eq("foundation only, at the start", subclassTiersUpTo("foundation"), ["foundation"]);
eq("specialization keeps the foundation card", subclassTiersUpTo("specialization"), ["foundation", "specialization"]);
eq("mastery keeps both of the earlier cards", subclassTiersUpTo("mastery"), ["foundation", "specialization", "mastery"]);
eq("an unset tier falls back to foundation, like ensureLevelFields", subclassTiersUpTo(undefined), ["foundation"]);
eq("so does a tier name we don't recognise", subclassTiersUpTo("legendary"), ["foundation"]);
eq("the ladder and the labels agree on which tiers exist",
  SUBCLASS_TIER_ORDER.map((t) => SUBCLASS_TIER_LABELS[t]), ["Foundation", "Specialization", "Mastery"]);
// The sheet renders these in array order, so the order here is the left-to-right order of the
// cards. It comes from the constant ladder, never from the character, so it can't drift.
eq("always foundation → specialization → mastery, whatever tier you're at",
  ["mastery", "foundation", "specialization"].map((t) => subclassTiersUpTo(t).join(" → ")),
  ["foundation → specialization → mastery", "foundation", "foundation → specialization"]);

group("Extra domain card: capped by your level AND by the slot's tier");
eq("tier caps as printed on the sheet", TIER_CARD_CAP, { 2: 4, 3: 7, 4: 10 });
eq("level 2, tier-2 slot — your level binds", extraCardLevelCap(2, 2), 2);
eq("level 4, tier-2 slot — they agree", extraCardLevelCap(4, 2), 4);
eq("level 6, tier-2 slot — the slot binds, not your level", extraCardLevelCap(6, 2), 4);
eq("level 8, tier-2 slot — still 4", extraCardLevelCap(8, 2), 4);
eq("level 6, tier-3 slot — your level binds", extraCardLevelCap(6, 3), 6);
eq("level 9, tier-3 slot — the slot binds", extraCardLevelCap(9, 3), 7);
eq("level 9, tier-4 slot — your level binds", extraCardLevelCap(9, 4), 9);

group("Slots accumulate across tiers ('from your tier or below')");
eq("traits at tier 2", totalSlotsForOption("traits", 2), 3);
eq("traits at tier 3 includes tier 2's", totalSlotsForOption("traits", 3), 6);
eq("traits at tier 4 includes both", totalSlotsForOption("traits", 4), 9);
{
  const used = blankSlotsUsed();
  used.traits[2] = 3;
  used.traits[3] = 1;
  eq("used counts every tier", usedSlotsForOption(used, "traits"), 4);
  eq("remaining at level 6", remainingSlots(used, "traits", 6), 2);
  eq("an exhausted tier is no longer offered", openSlotTiers(used, "traits", 6), [3]);
  eq("tiers above your own are never offered", openSlotTiers(blankSlotsUsed(), "traits", 3), [2]);
}

group("Hit Point and Stress cap at 12");
eq("hit point cap", MAX_HIT_POINT_SLOTS, 12);
eq("stress cap", MAX_STRESS_SLOTS, 12);
check("a guardian would pass 12 without the cap", 7 + 6 > MAX_HIT_POINT_SLOTS);
check("stress lands exactly on 12, so it can't breach", 6 + 6 === MAX_STRESS_SLOTS);

// ---------- migration ----------

// The creation wizard hands over a character with none of these fields and traits still
// unassigned, which is a different starting point from anything loaded out of storage.
group("A character straight out of the creation wizard");
{
  const fresh = ensureLevelFields({
    id: "new", classId: null, subclassId: null,
    traits: { agility: null, strength: null, finesse: null, instinct: null, presence: null, knowledge: null },
    experiences: [
      { id: "exp_start1", name: "", modifier: 2, baseModifier: 2, sinceLevel: 1 },
      { id: "exp_start2", name: "", modifier: 2, baseModifier: 2, sinceLevel: 1 },
    ],
    domainCardIds: [], creationDomainCardIds: [], domainVaultIds: [],
    level: 1, proficiency: 1,
    traitMarks: { agility: false, strength: false, finesse: false, instinct: false, presence: false, knowledge: false },
    hitPointSlotsBonus: 0, stressSlotsBonus: 0, evasionBonus: 0, subclassTier: "foundation",
    advancementSlotsUsed: blankSlotsUsed(),
  });
  eq("it baselines at level 1", fresh.baselineLevel, 1);
  check("it has somewhere to record levels", Array.isArray(fresh.levelUps));
  check("it has a baseline to replay from", !!fresh.baseline);
  eq("unassigned traits survive normalisation", fresh.baseline.traits.agility, null);

  // The traits step writes to the baseline and re-derives; that must not throw on nulls.
  fresh.baseline.traits.agility = 2;
  recomputeCharacter(fresh);
  eq("assigning a starting trait shows up on the character", fresh.traits.agility, 2);
  eq("the ones still unassigned stay null", fresh.traits.strength, null);

  // Then the cards, which the wizard sets the same way.
  fresh.creationDomainCardIds = ["c1", "c2"];
  recomputeCharacter(fresh);
  eq("starting cards become the collection", fresh.domainCardIds, ["c1", "c2"]);

  record(fresh, 2, [{ key: "evasion", slotTier: 2 }, { key: "stress", slotTier: 2 }], "c3");
  eq("and it levels up from there", fresh.level, 2);
  eq("the level 2 achievement grants proficiency", fresh.proficiency, 2);
  eq("the new Experience is tagged with the level that granted it",
    fresh.experiences.map((e) => e.sinceLevel), [1, 1, 2]);
  eq("the collection keeps the starting cards", fresh.domainCardIds, ["c1", "c2", "c3"]);
}

group("A character saved before any of this still opens");
{
  const legacy = {
    level: 6, proficiency: 3,
    traits: { agility: 2, strength: 3, finesse: 0, instinct: 1, presence: 0, knowledge: -1 },
    experiences: [{ name: "A", modifier: 3 }, { name: "B", modifier: 2 }],
    domainCardIds: ["a", "b", "c", "d", "e", "f"], domainVaultIds: ["a"],
    traitMarks: { agility: true, strength: false, finesse: false, instinct: false, presence: false, knowledge: false },
    hitPointSlotsBonus: 3, stressSlotsBonus: 1, evasionBonus: 1, subclassTier: "specialization",
    advancementSlotsUsed: { traits: 4, hitPoint: 3, stress: 1, experience: 1, domainCard: 0, evasion: 1, subclass: 1, proficiency: 0 },
  };
  const before = JSON.parse(JSON.stringify(legacy));
  ensureLevelFields(legacy);

  eq("flat slot totals split lowest tier first", legacy.advancementSlotsUsed.traits, { 2: 3, 3: 1, 4: 0 });
  eq("an option with no tier-2 slot lands in tier 3", legacy.advancementSlotsUsed.subclass, { 2: 0, 3: 1, 4: 0 });
  eq("the totals survive the split", usedSlotsForOption(legacy.advancementSlotsUsed, "traits"), 4);
  eq("it baselines at the level it had reached", legacy.baselineLevel, 6);
  eq("starting cards are taken from the front of the collection", legacy.creationDomainCardIds, ["a", "b"]);
  eq("experiences gain ids", legacy.experiences.every((e) => !!e.id), true);
  eq("stats are left exactly as they were", [legacy.level, legacy.proficiency, legacy.traits.agility],
    [before.level, before.proficiency, before.traits.agility]);

  const snapshot = JSON.parse(JSON.stringify(legacy));
  recomputeCharacter(legacy);
  eq("replaying it changes nothing", {
    traits: legacy.traits, proficiency: legacy.proficiency, hp: legacy.hitPointSlotsBonus,
    stress: legacy.stressSlotsBonus, evasion: legacy.evasionBonus, tier: legacy.subclassTier,
    cards: legacy.domainCardIds, vault: legacy.domainVaultIds,
  }, {
    traits: snapshot.traits, proficiency: snapshot.proficiency, hp: snapshot.hitPointSlotsBonus,
    stress: snapshot.stressSlotsBonus, evasion: snapshot.evasionBonus, tier: snapshot.subclassTier,
    cards: snapshot.domainCardIds, vault: snapshot.domainVaultIds,
  });

  const again = JSON.parse(JSON.stringify(legacy.advancementSlotsUsed));
  ensureLevelFields(legacy);
  eq("opening it twice is harmless", legacy.advancementSlotsUsed, again);

  record(legacy, 7, [{ key: "evasion", slotTier: 3 }, { key: "hitPoint", slotTier: 3 }], null);
  eq("it levels up normally from there, recorded", legacy.levelUps.map((e) => e.level), [7]);
  eq("the new level builds on its old stats", legacy.evasionBonus, snapshot.evasionBonus + 1);
  eq("its earlier slot usage is untouched", legacy.advancementSlotsUsed.traits, { 2: 3, 3: 1, 4: 0 });
}

// ---------- the replay ----------

// A faithful copy of the pre-history applyLevelUp, kept as a reference: the replay has to
// land on exactly the same numbers it did.
function legacyApply(ch, level, picks, card, exchange) {
  if (isLevelAchievement(level)) {
    ch.experiences.push({ name: "", modifier: 2 });
    ch.proficiency += 1;
    if (level >= 5) for (const k of Object.keys(ch.traitMarks)) ch.traitMarks[k] = false;
  }
  const extra = [];
  for (const pick of picks) {
    ch.advancementSlotsUsed[pick.key][pick.slotTier] += slotsPerPick(pick.key);
    if (pick.key === "traits") for (const k of pick.traits) { ch.traits[k] += 1; ch.traitMarks[k] = true; }
    if (pick.key === "hitPoint") ch.hitPointSlotsBonus += 1;
    if (pick.key === "stress") ch.stressSlotsBonus += 1;
    if (pick.key === "evasion") ch.evasionBonus += 1;
    if (pick.key === "experience") for (const i of pick.experienceIdx) ch.experiences[i].modifier += 1;
    if (pick.key === "subclass" && ch.subclassTier !== "mastery") ch.subclassTier = nextSubclassTier(ch.subclassTier);
    if (pick.key === "proficiency") ch.proficiency += 1;
    if (pick.key === "domainCard" && pick.cardId) extra.push(pick.cardId);
  }
  if (card) ch.domainCardIds.push(card);
  for (const id of extra) ch.domainCardIds.push(id);
  if (exchange) {
    const at = ch.domainCardIds.indexOf(exchange.outCardId);
    if (at >= 0) ch.domainCardIds[at] = exchange.inCardId;
    ch.domainVaultIds = ch.domainVaultIds.filter((id) => id !== exchange.outCardId);
  }
  const active = ch.domainCardIds.filter((id) => !ch.domainVaultIds.includes(id));
  while (active.length > 5) ch.domainVaultIds.push(active.shift());
  ch.level = level;
  return ch;
}

// Experience picks carry both forms: indices for the old code, ids for the new one. By
// level 7 the array is [A, B, lv2, lv5], so index 2 is the level 2 Experience — which is
// exactly why the recorded form uses ids.
const SCRIPT = [
  { level: 2, picks: [{ key: "traits", slotTier: 2, traits: ["agility", "finesse"] }, { key: "hitPoint", slotTier: 2 }], card: "c2" },
  { level: 3, picks: [{ key: "hitPoint", slotTier: 2 }, { key: "stress", slotTier: 2 }], card: "c3" },
  { level: 4, picks: [{ key: "evasion", slotTier: 2 }, { key: "domainCard", slotTier: 2, cardId: "c4" }], card: "c1x" },
  { level: 5, picks: [{ key: "traits", slotTier: 3, traits: ["agility", "strength"] }, { key: "subclass", slotTier: 3 }], card: "c5" },
  { level: 6, picks: [{ key: "proficiency", slotTier: 3 }], card: "c6x" },
  { level: 7, picks: [{ key: "experience", slotTier: 3, experienceIdx: [0, 2], experienceIds: ["e1", "exp_lv2"] }, { key: "stress", slotTier: 3 }], card: "c7" },
];

group("Replay reproduces the old incremental behaviour (level 1 → 7)");
{
  const legacy = newCharacter();
  const modern = newCharacter();
  for (const step of SCRIPT) {
    legacyApply(legacy, step.level, step.picks, step.card, step.exchange);
    record(modern, step.level, step.picks, step.card, step.exchange);
  }
  eq("traits", modern.traits, legacy.traits);
  eq("trait marks", modern.traitMarks, legacy.traitMarks);
  eq("proficiency", modern.proficiency, legacy.proficiency);
  eq("hit point slots", modern.hitPointSlotsBonus, legacy.hitPointSlotsBonus);
  eq("stress slots", modern.stressSlotsBonus, legacy.stressSlotsBonus);
  eq("evasion", modern.evasionBonus, legacy.evasionBonus);
  eq("subclass tier", modern.subclassTier, legacy.subclassTier);
  eq("slots used", modern.advancementSlotsUsed, legacy.advancementSlotsUsed);
  eq("domain cards, in order", modern.domainCardIds, legacy.domainCardIds);
  eq("vault", modern.domainVaultIds, legacy.domainVaultIds);
  eq("experience modifiers", modern.experiences.map((e) => e.modifier), legacy.experiences.map((e) => e.modifier));
  eq("level", modern.level, legacy.level);
}

group("An exchange replays in place");
{
  const legacy = newCharacter();
  const modern = newCharacter();
  const picks = [{ key: "hitPoint", slotTier: 2 }, { key: "stress", slotTier: 2 }];
  const swap = { outCardId: "c1", inCardId: "off" };
  legacyApply(legacy, 2, picks, "c2", swap);
  record(modern, 2, picks, "c2", swap);
  eq("the collection keeps its order", modern.domainCardIds, legacy.domainCardIds);
  check("the card given up is gone", !modern.domainCardIds.includes("c1"));
  check("the card taken is there", modern.domainCardIds.includes("off"));
}

// The exchange is the least-exercised part of a level up — it's optional, it's the only choice
// that REMOVES something, and the card it takes away can be one the character started with,
// which is the one card the replay doesn't own. These go through writeLevelEntry, the same
// function the level up screen writes every entry with, rather than reaching into levelUps.

group("Exchanging a card the character STARTED with");
{
  const twoPicks = [{ key: "evasion", slotTier: 2 }, { key: "stress", slotTier: 2 }];
  const ch = newCharacter();
  ch.level = 2;
  writeLevelEntry(ch, entry(2, twoPicks, "c2", { outCardId: "c1", inCardId: "c1b" }));

  eq("the collection has the swap applied", ch.domainCardIds, ["c1b", "c2"]);
  eq("the starting cards still say what was started with", ch.creationDomainCardIds, ["c1"]);
  // The bug this pins down: the swap used to be written into the starting cards as well, and
  // the validation reads those as "what you owned before this level" — so a legal swap was
  // reported as "the card being given up isn't in the collection at this level" on every load,
  // and no edit could clear it, because re-saving the level wrote the same list back.
  eq("and the level is not flagged", validateLevelUps(ch, DB), []);

  writeLevelEntry(ch, entry(2, twoPicks, "c2", { outCardId: "c1", inCardId: "c1c" }));
  eq("editing the level to swap for something else re-runs from the original card", ch.domainCardIds, ["c1c", "c2"]);
  eq("still nothing flagged", validateLevelUps(ch, DB), []);

  writeLevelEntry(ch, entry(2, twoPicks, "c2", null));
  eq("dropping the swap altogether gives the starting card back", ch.domainCardIds, ["c1", "c2"]);
  eq("and the starting cards never moved", ch.creationDomainCardIds, ["c1"]);
}

group("Exchanging a card gained on an earlier level");
{
  const ch = buildTo([
    entry(2, [{ key: "evasion", slotTier: 2 }, { key: "stress", slotTier: 2 }], "c2"),
    entry(3, [{ key: "hitPoint", slotTier: 2 }, { key: "stress", slotTier: 2 }], "c3", { outCardId: "c2", inCardId: "c1b" }),
  ], 3);
  eq("the card taken at level 2 is the one that leaves", ch.domainCardIds, ["c1", "c1b", "c3"]);
  eq("nothing is flagged", validateLevelUps(ch, DB), []);

  // Giving up a card the character no longer has by then IS an error, and has to stay one.
  const errors = validateEntry(ch, entry(3, [{ key: "hitPoint", slotTier: 2 }, { key: "stress", slotTier: 2 }], "c3", { outCardId: "c7", inCardId: "c1b" }), DB);
  has("a card that was never owned still can't be given up", errors, "isn't in the collection");
}

group("An exchange leaves the vault holding only cards still owned");
{
  const ch = buildTo([entry(2, [{ key: "evasion", slotTier: 2 }, { key: "stress", slotTier: 2 }], "c2")], 2);
  ch.domainVaultIds = ["c1"];
  recomputeCharacter(ch);
  eq("the vaulted card is there to begin with", ch.domainVaultIds, ["c1"]);

  writeLevelEntry(ch, entry(2, [{ key: "evasion", slotTier: 2 }, { key: "stress", slotTier: 2 }], "c2", { outCardId: "c1", inCardId: "c1b" }));
  eq("swapping it away empties the vault rather than leaving a card nobody owns", ch.domainVaultIds, []);
  eq("and the card taken is in the collection", ch.domainCardIds, ["c1b", "c2"]);
}

group("Repairing a character saved while exchanges were baked into the baseline");
{
  const twoPicks = [{ key: "evasion", slotTier: 2 }, { key: "stress", slotTier: 2 }];
  const stale = newCharacter();
  stale.level = 3;
  stale.levelUps.push(entry(2, twoPicks, "c2", { outCardId: "c1", inCardId: "c1b" }));
  stale.levelUps.push(entry(3, [{ key: "hitPoint", slotTier: 2 }, { key: "stress", slotTier: 2 }], "c3", { outCardId: "c1b", inCardId: "c1c" }));
  // What the old code left on disk: the same card swapped twice, written into the starting
  // cards both times, so the baseline ended up naming a card taken two levels later.
  stale.creationDomainCardIds = ["c1c"];
  delete stale.creationCardsUnbaked;

  ensureLevelFields(stale);
  recomputeCharacter(stale);
  eq("the chain unwinds to the card actually started with", stale.creationDomainCardIds, ["c1"]);
  eq("the collection is what it always was", stale.domainCardIds, ["c1c", "c2", "c3"]);
  eq("and the flags clear with no edit from the player", validateLevelUps(stale, DB), []);

  // Repairing a character whose baseline is already honest must not un-swap it a second time.
  delete stale.creationCardsUnbaked;
  ensureLevelFields(stale);
  eq("running the repair again changes nothing", stale.creationDomainCardIds, ["c1"]);
}

group("Writing a level entry replaces that level rather than adding another");
{
  const ch = buildTo([entry(2, [{ key: "evasion", slotTier: 2 }, { key: "stress", slotTier: 2 }], "c2")], 2);
  ch.levelUps[0].acceptedAsIs = true;

  writeLevelEntry(ch, entry(2, [{ key: "hitPoint", slotTier: 2 }, { key: "stress", slotTier: 2 }], "c2"));
  eq("the level appears once", ch.levelUps.map((e) => e.level), [2]);
  eq("the new choices are the ones that count", [ch.evasionBonus, ch.hitPointSlotsBonus], [0, 1]);
  check("and redeclaring a level withdraws 'keep as is'", !ch.levelUps[0].acceptedAsIs);
}

group("The same option marked twice in one level applies twice");
{
  const ch = newCharacter();
  record(ch, 2, [{ key: "hitPoint", slotTier: 2 }, { key: "hitPoint", slotTier: 2 }], "c2");
  eq("+2 Hit Point slots", ch.hitPointSlotsBonus, 2);
  eq("both tier-2 slots are marked", ch.advancementSlotsUsed.hitPoint, { 2: 2, 3: 0, 4: 0 });
  eq("the row is now full", remainingSlots(ch.advancementSlotsUsed, "hitPoint", 2), 0);
}

group("Editing a past level re-derives everything");
{
  const ch = newCharacter();
  for (const step of SCRIPT) record(ch, step.level, step.picks, step.card, step.exchange);
  const before = { traits: { ...ch.traits }, hp: ch.hitPointSlotsBonus, evasion: ch.evasionBonus };

  const lv3 = ch.levelUps.find((e) => e.level === 3);
  const original = lv3.picks;
  lv3.picks = [{ key: "stress", slotTier: 2 }, { key: "evasion", slotTier: 2 }];
  recomputeCharacter(ch);
  eq("the hit point slot it used to take is gone", ch.hitPointSlotsBonus, before.hp - 1);
  eq("evasion picked up the change", ch.evasionBonus, before.evasion + 1);
  eq("an unrelated stat is untouched", ch.traits, before.traits);
  eq("slot usage follows the edit", ch.advancementSlotsUsed.hitPoint, { 2: 1, 3: 0, 4: 0 });

  lv3.picks = original;
  recomputeCharacter(ch);
  eq("putting it back restores the original numbers exactly",
    { traits: ch.traits, hp: ch.hitPointSlotsBonus, evasion: ch.evasionBonus }, before);
}

group("The character as it stood at a past level");
{
  const ch = newCharacter();
  for (const step of SCRIPT) record(ch, step.level, step.picks, step.card, step.exchange);

  const at4 = stateAtLevel(ch, 4);
  eq("proficiency at the start of level 4", at4.proficiency, 2); // 1 + the level 2 achievement
  check("a trait raised at level 2 is still marked at level 4", at4.traitMarks.agility === true);
  eq("cards owned by then", at4.cardIds, ["c1", "c2", "c3"]);

  const at6 = stateAtLevel(ch, 6);
  check("the level 5 achievement cleared the marks", at6.traitMarks.finesse === false);
  check("but a trait raised AT level 5 is marked again", at6.traitMarks.strength === true);

  const exps4 = experiencesAtLevel(ch, 4, at4.expBonus);
  eq("only the Experiences that existed by level 4", exps4.length, 3);
  check("the level 5 Experience exists by level 7",
    experiencesAtLevel(ch, 7, stateAtLevel(ch, 8).expBonus).some((e) => e.sinceLevel === 5));
}

group("Removing the most recent level");
{
  const ch = newCharacter();
  for (const step of SCRIPT.slice(0, 3)) record(ch, step.level, step.picks, step.card, step.exchange);
  const at4 = { traits: { ...ch.traits }, ev: ch.evasionBonus, cards: [...ch.domainCardIds], level: ch.level };

  record(ch, 5, [{ key: "evasion", slotTier: 3 }, { key: "stress", slotTier: 3 }], "c5");
  ch.levelUps.pop();
  ch.level = 4;
  ch.experiences = ch.experiences.filter((e) => e.sinceLevel <= 4);
  recomputeCharacter(ch);
  eq("every stat goes back to where it was", { traits: ch.traits, ev: ch.evasionBonus, cards: ch.domainCardIds, level: ch.level }, at4);
}

// ---------- validation ----------

group("A chain that adds up is silent");
{
  const ch = buildTo([
    entry(2, [{ key: "traits", slotTier: 2, traits: ["agility", "finesse"] }, { key: "hitPoint", slotTier: 2 }], "c2"),
    entry(3, [{ key: "evasion", slotTier: 2 }, { key: "stress", slotTier: 2 }], "c3"),
  ], 3);
  eq("no problems", validateLevelUps(ch, DB), []);
}

group("Editing an early level can invalidate a later one");
{
  const ch = buildTo([
    entry(2, [{ key: "traits", slotTier: 2, traits: ["agility", "finesse"] }, { key: "hitPoint", slotTier: 2 }], "c2"),
    entry(3, [{ key: "traits", slotTier: 2, traits: ["strength", "presence"] }, { key: "evasion", slotTier: 2 }], "c3"),
  ], 3);
  check("legal to start with", validateLevelUps(ch, DB).length === 0);

  ch.levelUps[0].picks[0].traits = ["agility", "strength"]; // now level 3 also raises strength
  recomputeCharacter(ch);
  const problems = validateLevelUps(ch, DB);
  eq("exactly the later level is flagged", problems.map((p) => p.level), [3]);
  has("the reason names the trait", problems[0].errors, "Strength is already marked");

  ch.levelUps[1].acceptedAsIs = true;
  eq("'keep as is' leaves it reported", validateLevelUps(ch, DB).length, 1);
  eq("but it no longer needs attention", unresolvedProblems(ch, DB).length, 0);
}

group("Each way a level can stop adding up");
{
  const ch = buildTo([entry(2, [{ key: "evasion", slotTier: 2 }, { key: "stress", slotTier: 2 }], "c2")], 2);
  const at2 = (picks, card, exchange) => validateEntry(ch, entry(2, picks, card, exchange), DB);
  const two = [{ key: "evasion", slotTier: 2 }, { key: "stress", slotTier: 2 }];

  has("too few choice points spent", at2([{ key: "evasion", slotTier: 2 }], "c2"), "1 of the 2 choice points");
  has("too many spent", at2([...two, { key: "hitPoint", slotTier: 2 }], "c2"), "3 of the 2 choice points");
  has("a slot from a tier you haven't reached", at2([{ key: "evasion", slotTier: 3 }, { key: "stress", slotTier: 2 }], "c2"), "tier 3 slot isn't available");
  has("more slots than the row has", at2([{ key: "evasion", slotTier: 2 }, { key: "evasion", slotTier: 2 }], "c2"), "no tier 2 slot left");
  has("the same trait twice", at2([{ key: "traits", slotTier: 2, traits: ["agility", "agility"] }, { key: "stress", slotTier: 2 }], "c2"), "exactly 2 different traits");
  has("an Experience that isn't there", at2([{ key: "experience", slotTier: 2, experienceIds: ["e1", "nope"] }, { key: "stress", slotTier: 2 }], "c2"), "no longer exists");
  has("a card above your level", at2(two, "c5"), "above the limit of 2");
  has("a card outside your domains", at2(two, "off"), "isn't in a domain");
  has("a card already owned", at2(two, "c1"), "already in the collection");
  has("no card chosen", at2(two, null), "no card chosen");
  has("giving up a card you don't have", at2(two, "c2", { outCardId: "c7", inCardId: "c1" }), "isn't in the collection");
  has("taking a higher card than you gave", at2(two, "c2", { outCardId: "c1", inCardId: "c3" }), "above the limit of 1");
}

group("The extra card's cap, as a validation");
{
  const ch = buildTo([
    entry(2, [{ key: "evasion", slotTier: 2 }, { key: "stress", slotTier: 2 }], "c2"),
    entry(3, [{ key: "hitPoint", slotTier: 2 }, { key: "hitPoint", slotTier: 2 }], "c3"),
    entry(4, [{ key: "stress", slotTier: 2 }, { key: "traits", slotTier: 2, traits: ["agility", "finesse"] }], "c4"),
    entry(5, [{ key: "traits", slotTier: 3, traits: ["strength", "presence"] }, { key: "evasion", slotTier: 3 }], "c7"),
  ], 5);
  const lv6 = (slotTier) => validateEntry(ch, entry(6, [{ key: "domainCard", slotTier, cardId: "c5" }, { key: "stress", slotTier: 3 }], "c1"), DB);
  has("a level 5 card in a tier-2 slot is refused at level 6", lv6(2), "above the limit of 4");
  check("the same card in a tier-3 slot is fine", !lv6(3).some((e) => e.includes("above the limit")));
}

group("The Hit Point cap, as a validation");
{
  const ch = buildTo([
    entry(2, [{ key: "hitPoint", slotTier: 2 }, { key: "hitPoint", slotTier: 2 }], "c2"),
    entry(3, [{ key: "hitPoint", slotTier: 3 }, { key: "hitPoint", slotTier: 3 }], "c3"),
  ], 5);
  has("7 + 4 + 2 more would pass 12",
    validateEntry(ch, entry(6, [{ key: "hitPoint", slotTier: 4 }, { key: "hitPoint", slotTier: 4 }], "c5"), DB),
    "past the maximum of 12");
}

// ---------- derived stats ----------

// The db a page hands to derivedStats: only what these checks need, in the shape data/ uses.
const STAT_DB = {
  classes: [{ id: "cls", name: "GUARDIAN", domains: ["VALOR", "BLADE"], startingHitPoints: 7, startingEvasion: 9 }],
  subclasses: [
    { id: "sub", spellcastTrait: "KNOWLEDGE" },
    { id: "nocast" }, // Guardian and Warrior subclasses have no Spellcast trait
  ],
  armors: [
    { id: "gambeson", name: { "en-US": "Gambeson" }, baseScore: 3, baseMajorThreshold: 5, baseSevereThreshold: 11 },
    { id: "absurd", name: { "en-US": "Absurd Plate" }, baseScore: 40, baseMajorThreshold: 5, baseSevereThreshold: 11 },
  ],
  weapons: [
    { id: "staff", name: { "en-US": "Greatstaff" }, trait: "KNOWLEDGE", burden: "TWO_HANDED" },
    { id: "dagger", name: { "en-US": "Dagger" }, trait: "FINESSE", burden: "ONE_HANDED" },
  ],
};

function statChar(over = {}) {
  const ch = newCharacter();
  ch.equipment = { weaponMode: "two-handed", primaryWeaponId: null, secondaryWeaponId: null, armorId: null, potionChoice: null };
  return Object.assign(ch, over);
}

group("Derived stats are worked out in one place");
{
  const ch = statChar({ equipment: { weaponMode: "two-handed", primaryWeaponId: "staff", armorId: "gambeson" } });
  const s = derivedStats(ch, STAT_DB);
  eq("Evasion is the class value", s.evasion.total, 9);
  eq("Hit Points are the class value", s.hitPoints.total, 7);
  eq("Stress starts at 6 for every class", s.stress.total, 6);
  eq("a stat with no modifiers has one part", s.evasion.parts.length, 1);
  eq("the parts add up to the total", s.hitPoints.parts.reduce((n, p) => n + p.value, 0), s.hitPoints.total);
}
{
  const ch = statChar({ hitPointSlotsBonus: 3, stressSlotsBonus: 2, evasionBonus: 1 });
  const s = derivedStats(ch, STAT_DB);
  eq("advancements are added on top", [s.evasion.total, s.hitPoints.total, s.stress.total], [10, 10, 8]);
  eq("and are named separately in the breakdown", s.hitPoints.parts.length, 2);
  eq("a zero bonus isn't listed at all", derivedStats(statChar(), STAT_DB).evasion.parts.length, 1);
}

group("A breakdown names the level that granted each point");
{
  // "Level up advancements +3" is true and useless: it can't be checked against anything the
  // player remembers doing. The levels come from the recorded entries, so a breakdown can name
  // them — and a character built above level 1 keeps the generic part for the levels that were
  // never recorded, rather than having one invented for it.
  const ch = statChar();
  record(ch, 2, [{ key: "evasion", slotTier: 2 }, { key: "experience", slotTier: 2, experienceIds: ["e1", "e2"] }], "c2");
  record(ch, 3, [{ key: "traits", slotTier: 2, traits: ["agility", "strength"] }, { key: "hitPoint", slotTier: 2 }], "c3");
  const s = derivedStats(ch, STAT_DB);
  const labels = (stat) => stat.parts.map((p) => p.label);

  eq("Evasion", labels(s.evasion), ["Guardian (class)", "Level 2 advancement"]);
  eq("Hit Points", labels(s.hitPoints), ["Guardian (class)", "Level 3 advancement"]);
  eq("a trait separates what was assigned from what was earned", labels(s.traits.agility), ["Assigned at creation", "Level 3 advancement"]);
  eq("a trait nothing has touched still explains itself", labels(s.traits.finesse), ["Assigned at creation"]);
  // Proficiency comes from the tier achievement at 2, 5 and 8 as well as from the advancement
  // option, and the breakdown has to tell the two apart.
  eq("Proficiency", labels(s.proficiency), ["Base", "Level 2 achievement"]);
  eq("the parts still add up to the total", s.proficiency.parts.reduce((n, p) => n + p.value, 0), s.proficiency.total);

  const raised = s.experiences.find((e) => e.id === "e1");
  eq("an Experience raised by an advancement says which level did it", labels(raised), ["Base", "Level 2 advancement"]);
  // It used to report the modifier itself as a part, which left exactly one part — and the
  // sheet only offers the "?" from two up, so nothing explained why the Experience wasn't +2.
  check("so it has the two parts the sheet needs to offer its '?'", raised.parts.length > 1);
  eq("an Experience nothing has raised keeps a single part", labels(s.experiences.find((e) => e.id === "exp_lv2")), ["Base"]);
}

group("Advancement credits reconcile with the replay");
{
  // The credits are attributed by a second walk over the recorded entries, so the risk is that
  // it drifts from the replay that produces the numbers. Nothing here checks a label: it checks
  // that every credit sums to exactly the bonus the replay arrived at.
  const ch = newCharacter();
  for (const step of SCRIPT) record(ch, step.level, step.picks, step.card, step.exchange);
  const credits = advancementCredits(ch);
  const sum = (list) => (list || []).reduce((n, c) => n + c.value, 0);

  eq("hit point slots", sum(credits.hitPoint), ch.hitPointSlotsBonus - ch.baseline.hitPointSlotsBonus);
  eq("stress slots", sum(credits.stress), ch.stressSlotsBonus - ch.baseline.stressSlotsBonus);
  eq("evasion", sum(credits.evasion), ch.evasionBonus - ch.baseline.evasionBonus);
  eq("proficiency, tier achievements included", sum(credits.proficiency), ch.proficiency - ch.baseline.proficiency);
  eq("every trait", TRAIT_KEYS.map((k) => sum(credits.traits[k])),
    TRAIT_KEYS.map((k) => ch.traits[k] - ch.baseline.traits[k]));
  eq("every Experience", ch.experiences.map((e) => sum(credits.experiences[e.id])),
    ch.experiences.map((e) => e.modifier - e.baseModifier));
}

group("Armor Score, thresholds, and the unarmored rule");
{
  const armored = derivedStats(statChar({ level: 3, equipment: { armorId: "gambeson" } }), STAT_DB);
  eq("Armor Score comes from the armor", armored.armorScore.total, 3);
  eq("thresholds are the armor's base plus your level", [armored.majorThreshold.total, armored.severeThreshold.total], [8, 14]);

  // SRD: unarmored is Armor Score 0, Major = level, Severe = twice level. Unreachable in the
  // wizard today (armor is required), so this is the only thing holding the rule honest.
  const bare = derivedStats(statChar({ level: 3, equipment: { armorId: null } }), STAT_DB);
  eq("unarmored Armor Score is 0", bare.armorScore.total, 0);
  eq("unarmored thresholds are level and twice level", [bare.majorThreshold.total, bare.severeThreshold.total], [3, 6]);

  const capped = derivedStats(statChar({ equipment: { armorId: "absurd" } }), STAT_DB);
  eq("Armor Score can't exceed 12", capped.armorScore.total, MAX_ARMOR_SCORE);
  check("and says so when it clamps", !!capped.armorScore.note);
}

group("Attack uses the weapon's trait, and a secondary counts because it's equipped");
{
  // This used to assert that a "two-handed" weaponMode meant no secondary attack. That stopped
  // being true the moment a Warrior — who ignores burden — could carry a shield behind a
  // greatsword: their secondary attack came back null and the shield's Barrier went missing
  // from their Armor Score. What's equipped is now the only question asked.
  const both = derivedStats(statChar({
    equipment: { primaryWeaponId: "staff", secondaryWeaponId: "dagger" },
  }), STAT_DB);
  // knowledge is -1 in the fixture, finesse is 0
  eq("primary attack is the weapon's trait, not Proficiency", both.primaryAttack.total, -1);
  eq("the off-hand weapon uses its own trait, whatever the primary's burden",
    both.secondaryAttack.total, 0);

  check("with no secondary equipped there is no secondary attack",
    derivedStats(statChar({ equipment: { primaryWeaponId: "staff" } }), STAT_DB).secondaryAttack === null);

  // Characters saved before this change still carry the field. It has to mean nothing.
  check("a leftover weaponMode from an older save changes nothing",
    derivedStats(statChar({
      equipment: { weaponMode: "two-handed", primaryWeaponId: "staff", secondaryWeaponId: "dagger" },
    }), STAT_DB).secondaryAttack !== null);

  eq("Spellcast shows the trait, not a number", derivedStats(statChar(), STAT_DB).spellcast.display, "Knowledge");
  check("subclasses without one get no Spellcast box",
    derivedStats(statChar({ subclassId: "nocast" }), STAT_DB).spellcast === null);
}

group("A page that didn't load every data file still gets what it asked for");
{
  // The level up screen loads classes, subclasses and domain cards only.
  const partial = derivedStats(statChar({ equipment: { armorId: "gambeson" } }), { classes: STAT_DB.classes });
  eq("class-based stats still work", partial.hitPoints.total, 7);
  check("equipment-based ones come back null rather than throwing", partial.armorScore === null);
  check("and so do the attacks", partial.primaryAttack === null);
}

group("A weapon reads as prose, not as the JSON it came from");
{
  const longsword = {
    id: "core_weapon_longsword", name: { "en-US": "Longsword" }, type: "PRIMARY_PHYSICAL",
    tier: 1, trait: "AGILITY", range: "MELEE",
    damage: { dice: "D10", modifier: 3, type: "PHYSICAL" }, burden: "TWO_HANDED",
  };
  eq("the SCREAMING_SNAKE values are read out in English", enumLabel("VERY_CLOSE"), "Very Close");
  // The picker used to print "D10 phy" for this: the +3 was simply dropped, on 20 of the 32
  // weapons a starting character can pick between.
  eq("the damage modifier is part of the damage", damageText(longsword), "d10+3 phy");
  eq("a weapon with no modifier just names the die",
    damageText({ damage: { dice: "D8", type: "MAGICAL" } }), "d8 mag");
  // One weapon in the book (the Ghostblade) deals either kind; it used to be labelled "mag".
  eq("and the both-kinds weapon says both",
    damageText({ damage: { dice: "D10", modifier: 7, type: "PHYSICAL_OR_MAGICAL" } }), "d10+7 phy/mag");
  eq("the whole line", weaponStats(longsword), "Agility · Melee · d10+3 phy · Two-handed");

  // Fixtures here carry only the fields the check under test needs, and an unarmed profile has
  // no burden at all. A formatter that dereferenced damage.dice would make every other check in
  // this file depend on data it doesn't use.
  eq("fields a record doesn't carry are left out, not printed as undefined",
    weaponStats({ trait: "FINESSE", burden: "ONE_HANDED" }), "Finesse · One-handed");
  eq("and no weapon at all is not a crash", weaponStats(null), "");

  // Consumables carry a feature with no name, and the sheet puts potions through the same
  // renderer as weapons — without this it read "Minor Health Potion : Clear 1d4 HP."
  eq("a nameless feature is just its text",
    featureLine({ features: [{ description: [{ paragraph: { "en-US": "Clear 1d4 HP." } }] }] }),
    `<span class="option-feature">Clear 1d4 HP.</span>`);
  eq("a named one still reads name-then-text",
    featureLine({ features: [{ name: { "en-US": "Reliable" }, description: [{ paragraph: { "en-US": "+1 to attack rolls" } }] }] }),
    `<span class="option-feature"><em>Reliable</em>: +1 to attack rolls</span>`);
}

group("Burden is advice, and the Warrior doesn't even get the advice");
{
  const greatsword = { name: { "en-US": "Greatsword" }, burden: "TWO_HANDED" };
  const broadsword = { name: { "en-US": "Broadsword" }, burden: "ONE_HANDED" };
  const shield = { name: { "en-US": "Tower Shield" }, burden: "ONE_HANDED" };

  check("a secondary behind a two-handed primary is flagged", !!burdenWarning(greatsword, shield, false));
  check("a one-handed primary never is", burdenWarning(broadsword, shield, false) === null);
  check("nor is a two-handed primary carried on its own", burdenWarning(greatsword, null, false) === null);
  // "You ignore burden when equipping weapons." — Combat Training, in full.
  check("and a Warrior isn't warned at all", burdenWarning(greatsword, shield, true) === null);

  const WARRIOR = {
    id: "core_class_warrior", name: "WARRIOR",
    classFeatures: [{ name: { "en-US": "Combat Training" } }, { name: { "en-US": "Attack of Opportunity" } }],
  };
  const GUARDIAN = { id: "cls", name: "GUARDIAN", classFeatures: [{ name: { "en-US": "Unstoppable" } }] };
  check("Combat Training is what says so",
    ignoresBurden({ classId: "core_class_warrior" }, { classes: [WARRIOR, GUARDIAN] }));
  check("and no other class does", !ignoresBurden({ classId: "cls" }, { classes: [WARRIOR, GUARDIAN] }));
  check("a page that didn't load classes doesn't throw", !ignoresBurden({ classId: "cls" }, {}));
}

group("A picker opens the tiers worth reading");
{
  const gear = [
    { id: "t1a", tier: 1 }, { id: "t1b", tier: 1 },
    { id: "t2a", tier: 2 }, { id: "t3a", tier: 3 }, { id: "t4a", tier: 4 },
  ];
  const tiersOf = (groups) => groups.map((g) => g.tier);
  const openOf = (groups) => groups.filter((g) => g.open).map((g) => g.tier);

  eq("every tier in the book, lowest first", tiersOf(groupByTier(gear, { tier: 3 })), [1, 2, 3, 4]);
  eq("the character's own tier is open", openOf(groupByTier(gear, { tier: 3 })), [3]);
  // A shield handed out at level 1 is still yours at level 8, and a picker that hides what
  // you're carrying is a picker that lies.
  eq("so is whichever tier holds what they're carrying",
    openOf(groupByTier(gear, { tier: 4, equippedId: "t1b" })), [1, 4]);
  eq("and that's one group, not two, when they coincide",
    openOf(groupByTier(gear, { tier: 2, equippedId: "t2a" })), [2]);
  eq("carrying nothing opens only your tier",
    openOf(groupByTier(gear, { tier: 1, equippedId: null })), [1]);
}

group("The level up screen and the sheet share the same arithmetic");
eq("hit points", hitPointTotal(STAT_DB.classes[0], 2), 9);
eq("stress no longer hardcodes 6 in four places", stressTotal(0), BASE_STRESS_SLOTS);
eq("evasion", evasionTotal(STAT_DB.classes[0], 1), 10);
eq("slots granted by an ancestry count towards the maximum too", hitPointTotal(STAT_DB.classes[0], 2, 1), 10);

// ---------- effects: choices that change a stat ----------
//
// These use the real ids from data/, because an entry in effects.js keyed to an id that
// doesn't exist grants nothing at all, silently — the exact failure the last group guards.

// The pieces of data/ these checks name, in the shape the real files use.
const FX_DB = {
  classes: STAT_DB.classes,
  subclasses: [
    { id: "core_subclass_school_of_war", spellcastTrait: "KNOWLEDGE", foundation: { features: [{ name: { "en-US": "Battlemage" } }] } },
    { id: "core_subclass_stalwart", foundation: { features: [{ name: { "en-US": "Unwavering" } }] }, specialization: { features: [{ name: { "en-US": "Unrelenting" } }] }, mastery: { features: [{ name: { "en-US": "Undaunted" } }] } },
    { id: "sub", spellcastTrait: "KNOWLEDGE" },
  ],
  ancestries: [
    { id: "core_ancestry_clank", name: { "en-US": "Clank" }, features: [{ name: { "en-US": "Purposeful Design" } }] },
    { id: "core_ancestry_giant", name: { "en-US": "Giant" }, features: [{ name: { "en-US": "Endurance" } }, { name: { "en-US": "Reach" } }] },
    { id: "core_ancestry_simiah", name: { "en-US": "Simiah" }, features: [{ name: { "en-US": "Natural Climber" } }, { name: { "en-US": "Nimble" } }] },
  ],
  armors: [
    ...STAT_DB.armors,
    { id: "core_armor_full_plate_armor", name: { "en-US": "Full Plate Armor" }, baseScore: 4, baseMajorThreshold: 8, baseSevereThreshold: 17, features: [{ name: { "en-US": "Very Heavy" } }] },
    { id: "core_armor_channeling_armor", name: { "en-US": "Channeling Armor" }, baseScore: 5, baseMajorThreshold: 13, baseSevereThreshold: 36, features: [{ name: { "en-US": "Channeling" } }] },
  ],
  weapons: [
    ...STAT_DB.weapons,
    { id: "core_weapon_broadsword", name: { "en-US": "Broadsword" }, trait: "AGILITY", burden: "ONE_HANDED", features: [{ name: { "en-US": "Reliable" } }] },
    { id: "core_weapon_tower_shield", name: { "en-US": "Tower Shield" }, trait: "AGILITY", burden: "ONE_HANDED", features: [{ name: { "en-US": "Barrier" } }] },
  ],
  domainCards: [
    { id: "core_domain_card_untouchable", name: { "en-US": "Untouchable" }, domain: "BONE", level: 1 },
    { id: "core_domain_card_bare_bones", name: { "en-US": "Bare Bones" }, domain: "VALOR", level: 1 },
    { id: "core_domain_card_vitality", name: { "en-US": "Vitality" }, domain: "BLADE", level: 5 },
    { id: "core_domain_card_codex_touched", name: { "en-US": "Codex-Touched" }, domain: "CODEX", level: 7 },
    ...["a", "b", "c"].map((s) => ({ id: `codex_${s}`, name: { "en-US": `Codex ${s}` }, domain: "CODEX", level: 1 })),
  ],
};

const heritage = (ancestryId, featureName) => ({
  heritage: { ancestryMode: "pure", ancestryIds: [ancestryId], chosenFeatures: [{ ancestryId, featureName }], communityId: null },
});

group("An ancestry feature that grants a stat actually grants it");
{
  const giant = derivedStats(statChar(heritage("core_ancestry_giant", "Endurance")), FX_DB);
  eq("a Giant's Endurance is one more Hit Point slot", giant.hitPoints.total, 8);
  eq("and the breakdown says where it came from", giant.hitPoints.parts[1].label, "Giant — Endurance");

  // With a mixed ancestry the player takes ONE feature per ancestry, so a Giant who took Reach
  // instead of Endurance gets nothing. Keying on the ancestry id alone would get this wrong.
  const reach = derivedStats(statChar(heritage("core_ancestry_giant", "Reach")), FX_DB);
  eq("a Giant who took Reach instead gets no extra slot", reach.hitPoints.total, 7);

  // Nimble is Simiah's SECOND feature, unlike every other stat feature in the book.
  const simiah = derivedStats(statChar(heritage("core_ancestry_simiah", "Nimble")), FX_DB);
  eq("Simiah's Nimble is +1 Evasion", simiah.evasion.total, 10);
}

group("A permanent Experience bonus reaches the level up picker, not just the sheet");
{
  // Purposeful Design is the one effect that raises a named Experience rather than a stat, so
  // it's the one the replay can't know about: expBonus only counts the +1s taken as
  // advancements. The picker used to build its numbers from the replay alone, which offered a
  // Clank an Experience at +2 while the sheet showed it at +3.
  const clank = (answer) => statChar({
    ...heritage("core_ancestry_clank", "Purposeful Design"),
    ...(answer ? { effectChoices: { "core_ancestry_clank:Purposeful Design": answer } } : {}),
  });

  eq("unanswered, it grants nothing", effectExperienceBonuses(clank(null), FX_DB), {});

  const answered = clank({ optionId: "one", experienceIds: ["e1"] });
  eq("answered, the chosen Experience carries +1", effectExperienceBonuses(answered, FX_DB), { e1: 1 });
  eq("and the one it didn't choose carries nothing",
    effectExperienceBonuses(clank({ optionId: "one", experienceIds: ["e2"] }), FX_DB).e1 || 0, 0);

  // The arithmetic the picker does, against the number the sheet shows for the same Experience.
  const bonuses = effectExperienceBonuses(answered, FX_DB);
  const asPicker = (id) => experiencesAtLevel(answered, answered.level, stateAtLevel(answered, answered.level + 1).expBonus)
    .map((exp) => ({ ...exp, modifier: exp.modifier + (bonuses[exp.id] || 0) }))
    .find((e) => e.id === id).modifier;
  const asSheet = (id) => derivedStats(answered, FX_DB).experiences.find((e) => e.id === id).total;
  eq("the picker and the sheet agree on the boosted Experience", asPicker("e1"), asSheet("e1"));
  eq("and on the one that wasn't boosted", asPicker("e2"), asSheet("e2"));
}

group("An Experience breakdown names every source, and no subtotal");
{
  // The reported case: a Clank whose Purposeful Design bonus and a level 2 advancement both
  // landed on the same Experience saw +4 explained as "Experience +3, Permanent bonus +1" —
  // where the +3 was the very thing being asked about, and the feature that granted the other
  // +1 went unnamed.
  const clank = statChar({
    ...heritage("core_ancestry_clank", "Purposeful Design"),
    effectChoices: { "core_ancestry_clank:Purposeful Design": { optionId: "one", experienceIds: ["e1"] } },
  });
  record(clank, 2, [{ key: "experience", slotTier: 2, experienceIds: ["e1", "e2"] }, { key: "evasion", slotTier: 2 }], "c2");

  const e1 = derivedStats(clank, FX_DB).experiences.find((e) => e.id === "e1");
  eq("the total is unchanged", e1.total, 4);
  eq("and every part of it is a real source",
    e1.parts.map((p) => `${p.label} ${p.value}`),
    ["Base 2", "Level 2 advancement 1", "Clank — Purposeful Design 1"]);
}

group("A subclass tier implies the tiers below it, and their bonuses stack");
{
  const war = derivedStats(statChar({ subclassId: "core_subclass_school_of_war" }), FX_DB);
  eq("School of War's Battlemage is one more Hit Point slot", war.hitPoints.total, 8);

  const at = (tier) => derivedStats(statChar({
    subclassId: "core_subclass_stalwart", subclassTier: tier, level: 1,
    equipment: { armorId: "gambeson" },
  }), FX_DB).majorThreshold.total;
  // Gambeson's Major is 5, plus level 1 = 6 before any subclass bonus.
  eq("Stalwart at Foundation is +1", at("foundation"), 7);
  eq("at Specialization it's +1 and +2", at("specialization"), 9);
  eq("at Mastery it's +1, +2 and +3", at("mastery"), 12);
}

group("Equipment changes traits, Evasion, Armor Score and attacks");
{
  const plate = derivedStats(statChar({ equipment: { weaponMode: "two-handed", primaryWeaponId: "staff", armorId: "core_armor_full_plate_armor" } }), FX_DB);
  eq("Full Plate is -2 Evasion", plate.evasion.total, 7);
  eq("and -1 Agility", plate.traits.agility.total, 0);

  // The -1 Agility has to reach the attack roll, since attack uses the effective trait.
  const sword = derivedStats(statChar({ equipment: { weaponMode: "one-handed", primaryWeaponId: "core_weapon_broadsword", secondaryWeaponId: "core_weapon_tower_shield", armorId: "core_armor_full_plate_armor" } }), FX_DB);
  eq("an Agility weapon's attack uses the reduced Agility, plus Reliable's +1", sword.primaryAttack.total, 1);
  eq("Reliable applies to its own weapon only", sword.secondaryAttack.total, 0);
  eq("Tower Shield's Barrier is +2 Armor Score", sword.armorScore.total, 6);
  eq("Barrier's -1 Evasion lands too", sword.evasion.total, 6);

  // The same shield behind a two-handed primary — a Warrior's Combat Training says they can.
  // This is the case the old weaponMode gate got wrong: the shield was equipped and did nothing.
  const shielded = derivedStats(statChar({
    equipment: { primaryWeaponId: "staff", secondaryWeaponId: "core_weapon_tower_shield" },
  }), FX_DB);
  // No armor, so Armor Score is Barrier's +2 alone; Evasion is the class's 9 less Barrier's 1.
  eq("a shield's Barrier applies behind a two-handed primary too", shielded.armorScore.total, 2);
  eq("and so does its -1 Evasion", shielded.evasion.total, 8);

  // "+1 to Spellcast Rolls" is not "+1 to Knowledge": a plain Knowledge roll doesn't get it.
  const chan = derivedStats(statChar({ equipment: { armorId: "core_armor_channeling_armor" } }), FX_DB);
  eq("Channeling armor shows on the Spellcast box", chan.spellcast.display, "Knowledge +1");
  eq("but never on the trait itself", chan.traits.knowledge.total, -1);
}

group("Choosing to wear nothing");
{
  // The SRD's plain unarmored rule, reachable at last: Armor Score 0, Major threshold equal to
  // your level and Severe twice your level.
  const bare = derivedStats(statChar({ level: 3, equipment: { armorId: UNARMORED } }), FX_DB);
  eq("no armor means an Armor Score of 0", bare.armorScore.total, 0);
  eq("Major threshold is your level", bare.majorThreshold.total, 3);
  eq("and Severe is twice it", bare.severeThreshold.total, 6);

  // Not the same state as never having chosen — but the arithmetic can't tell them apart, and
  // shouldn't: a character mid-creation has no armor either.
  const unset = derivedStats(statChar({ level: 3, equipment: {} }), FX_DB);
  eq("having chosen nothing yet works out the same", unset.armorScore.total, bare.armorScore.total);

  // The sentinel is a marker, not an id: nothing must go looking for armor by that name.
  check("it matches no armor in the data", !FX_DB.armors.some((a) => a.id === UNARMORED));

  // A shield is still a shield with no body armor under it.
  const shielded = derivedStats(statChar({
    equipment: { armorId: UNARMORED, secondaryWeaponId: "core_weapon_tower_shield" },
  }), FX_DB);
  eq("a shield's Armor Score still applies", shielded.armorScore.total, 2);
}

group("Fighting with nothing in your hands");
{
  // "Unarmed attack rolls use either Strength or Finesse (GM's choice)." The sheet reports both
  // rather than quietly picking the better one — that choice belongs to the table.
  // strength is +2 in the fixture, finesse 0.
  const bare = derivedStats(statChar({ equipment: { primaryWeaponId: UNARMED } }), FX_DB);
  // signed() writes zero as "0", the same as every other stat box on the sheet.
  eq("both traits are offered, neither is chosen", bare.primaryAttack.display, "Strength +2 / Finesse 0");
  eq("and the breakdown shows each of them",
    bare.primaryAttack.parts.map((p) => p.label), ["Strength (unarmed)", "Finesse (unarmed)"]);
  check("with a note saying whose choice it is", /GM/.test(bare.primaryAttack.note));

  // "Successful unarmed attacks inflict [Proficiency]d4 damage" — d4 is the rating, in the same
  // sense d10+3 is a Longsword's.
  eq("bare hands hit for d4", weaponStats(UNARMED_PROFILE), "Strength or Finesse · Melee · d4 phy");

  // The sentinel is a marker, not an id.
  check("it matches no weapon in the data", !FX_DB.weapons.some((w) => w.id === UNARMED));
  eq("and carries no weapon features into the effects", 
    derivedStats(statChar({ equipment: { primaryWeaponId: UNARMED } }), FX_DB).evasion.total, 9);

  // Same rule as a weapon: no attack line until the traits are assigned.
  const noTraits = statChar({ equipment: { primaryWeaponId: UNARMED } });
  noTraits.traits = { agility: null, strength: null, finesse: null, instinct: null, presence: null, knowledge: null };
  check("unassigned traits mean no attack yet, just as with a weapon",
    derivedStats(noTraits, FX_DB).primaryAttack === null);

  // A secondary is still a secondary when the other hand is empty.
  const withShield = derivedStats(statChar({
    equipment: { primaryWeaponId: UNARMED, secondaryWeaponId: "core_weapon_tower_shield" },
  }), FX_DB);
  eq("an off-hand weapon still applies", withShield.armorScore.total, 2);
  check("and still gets its own attack", withShield.secondaryAttack !== null);
}

group("Bare Bones stands in for the armor you didn't wear");
{
  // strength is +2 in the fixture. Tier 1 base thresholds are 9/19, and your level goes on top
  // of those exactly as it would on top of a breastplate's.
  const bones = (over) => derivedStats(statChar({
    equipment: { armorId: UNARMORED }, domainCardIds: ["core_domain_card_bare_bones"], ...over,
  }), FX_DB);

  const lv1 = bones({ level: 1 });
  eq("base Armor Score is 3 + your Strength", lv1.armorScore.total, 5);
  eq("Major is the card's 9 plus your level", lv1.majorThreshold.total, 10);
  eq("Severe is the card's 19 plus your level", lv1.severeThreshold.total, 20);
  eq("and the breakdown names the card, where armor would have named itself",
    lv1.armorScore.parts[0].label, "Bare Bones");

  // Tier 3 is levels 5-7, so the base moves to 13/31.
  const lv6 = bones({ level: 6 });
  eq("the thresholds follow your tier", [lv6.majorThreshold.total, lv6.severeThreshold.total], [19, 37]);

  // A shield is still a shield: additive effects stack on the override as they would on armor.
  const shielded = bones({ equipment: { armorId: UNARMORED, secondaryWeaponId: "core_weapon_tower_shield" } });
  eq("Barrier adds to Bare Bones' base", shielded.armorScore.total, 7);

  // "When you choose NOT to equip armor" — wearing any means the card does nothing.
  const armored = bones({ equipment: { armorId: "gambeson" } });
  eq("wearing armor, the card is silent", armored.armorScore.total, 3);

  // It's a loadout card, so it stops applying the moment it's vaulted.
  const vaulted = bones({ domainVaultIds: ["core_domain_card_bare_bones"] });
  eq("vaulting it gives the plain unarmored rule back", vaulted.armorScore.total, 0);
  eq("thresholds too", vaulted.majorThreshold.total, 1);
}

group("Loadout cards apply, vaulted ones don't");
{
  const withCard = (over) => statChar({ domainCardIds: ["core_domain_card_untouchable"], ...over });
  // Agility is +1 in the fixture; half of 1 rounds UP to 1, per the SRD's rounding rule.
  eq("Untouchable is half your Agility, rounded up", derivedStats(withCard(), FX_DB).evasion.total, 10);
  eq("vaulting it takes the bonus away",
    derivedStats(withCard({ domainVaultIds: ["core_domain_card_untouchable"] }), FX_DB).evasion.total, 9);

  // Codex-Touched needs 4 Codex cards in the loadout, and even then both its benefits cost
  // something. It's catalogued so the sheet can say so rather than looking broken.
  const codex = (ids) => derivedStats(statChar({ domainCardIds: ids }), FX_DB);
  eq("under 4 Codex cards, nothing is even mentioned", codex(["core_domain_card_codex_touched", "codex_a"]).exclusions.length, 0);
  eq("at 4, the sheet explains why nothing changed",
    codex(["core_domain_card_codex_touched", "codex_a", "codex_b", "codex_c"]).exclusions.length, 2);
}

group("A card that says 'choose' grants nothing until it's answered");
{
  const owned = { domainCardIds: ["core_domain_card_vitality"], domainVaultIds: ["core_domain_card_vitality"] };
  const unanswered = derivedStats(statChar(owned), FX_DB);
  eq("Vitality with no answer recorded adds nothing", [unanswered.hitPoints.total, unanswered.stress.total], [7, 6]);
  eq("and the sheet is told to ask", unresolvedChoices(statChar(owned), FX_DB).length, 1);

  const answered = statChar({ ...owned, effectChoices: { core_domain_card_vitality: { optionIds: ["stress", "hitPoint"] } } });
  const s = derivedStats(answered, FX_DB);
  // The card tells you to vault it, so a permanent choice has to survive being vaulted.
  eq("answered, it grants both chosen benefits even from the vault", [s.hitPoints.total, s.stress.total], [8, 7]);
  eq("and nothing is left to ask", unresolvedChoices(answered, FX_DB).length, 0);
}

group("The 12-point caps are hard: effects reach them sooner, never past");
{
  const ch = statChar({
    subclassId: "core_subclass_school_of_war",
    ...heritage("core_ancestry_giant", "Endurance"),
    hitPointSlotsBonus: 6,
  });
  const s = derivedStats(ch, FX_DB);
  eq("7 + 6 advancements + 2 granted would be 15, but stops at 12", s.hitPoints.total, MAX_HIT_POINT_SLOTS);
  check("and the breakdown says it clamped", !!s.hitPoints.note);
  eq("effectBonuses reports the grant so the slot gating can see it", effectBonuses(ch, FX_DB).hitPointSlots, 2);
}

group("A subclass upgrade that grants a domain card actually hands one over");
{
  // The School of Knowledge takes an extra card at every tier. The level up screen works out
  // how many by asking what the character's effects grant before this level's picks and after
  // them, so nothing outside effects.js names the subclass.
  const KNOW_DB = {
    classes: [{ id: "cls", name: "WIZARD", domains: ["VALOR", "BLADE"], startingHitPoints: 5, startingEvasion: 11 }],
    subclasses: [
      { id: "core_subclass_school_of_knowledge", foundation: {}, specialization: {}, mastery: {} },
      { id: "sub" },
    ],
    domainCards: ["k1", "k2", "k3", "k4"].map((id, i) => ({ id, name: { "en-US": id }, domain: "BLADE", level: i + 1 })),
  };
  const know = (over) => {
    const ch = newCharacter();
    ch.subclassId = "core_subclass_school_of_knowledge";
    ch.baseline.subclassTier = "foundation";
    return Object.assign(ch, over);
  };

  // Level 5 with a subclass upgrade: Foundation -> Specialization, and Accomplished grants one.
  const upgrade = entry(5, [{ key: "subclass", slotTier: 3 }, { key: "evasion", slotTier: 3 }], "k1");
  has("taking the upgrade without the granted card is flagged",
    validateEntry(know({ level: 5 }), upgrade, KNOW_DB), "1 granted at this level");

  const withCard = { ...upgrade, grantedCardIds: ["k2"] };
  eq("with the card chosen it adds up", validateEntry(know({ level: 5 }), withCard, KNOW_DB), []);

  has("a second granted card is one too many",
    validateEntry(know({ level: 5 }), { ...upgrade, grantedCardIds: ["k2", "k3"] }, KNOW_DB),
    "2 chosen, 1 granted");

  // Not an advancement slot, so only your level caps it — no tier cap.
  has("and it still has to be a card you could take",
    validateEntry(know({ level: 5 }), { ...upgrade, grantedCardIds: ["k1"] }, KNOW_DB),
    "already in the collection");

  // A level with no subclass upgrade grants nothing, even for this subclass.
  const noUpgrade = entry(4, [{ key: "evasion", slotTier: 2 }, { key: "stress", slotTier: 2 }], "k1");
  eq("a level without the upgrade grants no card", validateEntry(know({ level: 4 }), noUpgrade, KNOW_DB), []);
  has("so recording one there is wrong",
    validateEntry(know({ level: 4 }), { ...noUpgrade, grantedCardIds: ["k2"] }, KNOW_DB),
    "1 chosen, 0 granted");

  // The replay has to put it in the collection alongside the guaranteed card.
  const ch = know({ level: 4 });
  ch.level = 5;
  ch.levelUps.push(withCard);
  recomputeCharacter(ch);
  eq("and the replay adds it to the collection", ch.domainCardIds.includes("k2"), true);
  eq("alongside the guaranteed one", ch.domainCardIds.includes("k1"), true);
}

group("Answers are only complete when they pick everything asked for");
{
  const vitality = EFFECTS["domain_card_vitality"].choice;
  eq("a blank answer isn't an answer", isAnswered(vitality, blankAnswer()), false);
  eq("one of two isn't either", isAnswered(vitality, { optionIds: ["stress"] }), false);
  eq("two of two is", isAnswered(vitality, { optionIds: ["stress", "hitPoint"] }), true);

  const motc = EFFECTS["domain_card_master_of_the_craft"].choice;
  eq("+3 to one needs one Experience named",
    isAnswered(motc, { optionId: "one", experienceIds: ["e1"] }), true);
  eq("+2 to two needs two", isAnswered(motc, { optionId: "two", experienceIds: ["e1"] }), false);
}

group("Every id in effects.js still exists in data/");
{
  // The one group that reads data/ for real. An upstream refresh that renames an id would
  // otherwise drop an effect silently: no error, just a number that quietly stops being right.
  // Both editions, because an entry here is keyed WITHOUT a document prefix precisely so that one
  // entry serves whichever edition printed the card. A key only has to resolve in one of them —
  // SRD 2.0 dropped records SRD 1.0 has, and vice versa.
  const EDITIONS = ["srd_1_0", "srd_2_0"];
  const load = async (edition, name) => (await fetch(`../data/${edition}/${name}.json${RUN}`)).json();
  const files = ["ancestries", "subclasses", "armors", "weapons", "domain-cards", "classes"];
  // Only SRD 2.0 publishes transformations, so this one is loaded on its own rather than per
  // edition — asking SRD 1.0 for a file it doesn't have would 404.
  const loaded = await Promise.all(EDITIONS.map(async (e) =>
    Object.fromEntries(await Promise.all(files.map(async (f) => [f, await load(e, f)])))));
  const all = (f) => loaded.flatMap((d) => d[f]);
  const classes = all("classes");

  // ignoresBurden() matches a class feature by name rather than by an EFFECTS key, so the check
  // below can't cover it. Renamed upstream, the Warrior would silently start getting a burden
  // warning the book says they're exempt from.
  const warrior = classes.find((c) => c.name === "WARRIOR");
  check("the Warrior still has Combat Training to ignore burden with",
    ignoresBurden({ classId: warrior?.id }, { classes }));

  // The same stripping lookup() does, so this group asks the question the app asks.
  const known = new Set();
  const add = (key) => {
    known.add(key);
    for (const form of bareForms(key, EDITIONS)) known.add(form);
  };
  const featureKeys = (list, prefix) => {
    for (const item of list) {
      for (const f of item.features || []) {
        add(`${item.id}:${f.name["en-US"]}`);
        add(`${prefix}:${f.name["en-US"]}`);
      }
    }
  };
  featureKeys(await load("srd_2_0", "transformations"), "transformation");
  featureKeys(all("ancestries"), "ancestry");
  featureKeys(all("armors"), "armor");
  featureKeys(all("weapons"), "weapon");
  for (const sub of all("subclasses")) for (const tier of ["foundation", "specialization", "mastery"]) {
    if (sub[tier]) add(`${sub.id}:${tier}`);
  }
  for (const c of all("domain-cards")) add(c.id);

  const missing = Object.keys(EFFECTS).filter((k) => !known.has(k));
  check(`all ${Object.keys(EFFECTS).length} effect keys resolve`, missing.length === 0,
    missing.length ? `not found in data/:\n${missing.join("\n")}` : undefined);
}

// ---------- sheet-data.js ----------
//
// sheet-data.js delegates every number it used to compute by hand to derivedStats(), so most
// of what would need testing here is already covered by the "derived stats" groups above — a
// bug in that arithmetic would show up there, not here. What's left to check is genuinely
// sheet-specific: the damage-die string (not a derivedStats() concern at all), the heritage
// feature filter (a correctness fix the old branch made and this rewrite must not lose), the
// list-block flattening, and that a draft with no class chosen yet still produces a sheet
// instead of throwing.

// A small fixture db with just enough of each entity's shape for deriveSheet() to walk: named
// fields, feature arrays with both `paragraph` and `list` description blocks, weapons with and
// without a damage modifier.
const SHEET_DB = {
  transformations: [{
    id: "tf", name: { "en-US": "Werewolf" },
    features: [
      { name: { "en-US": "Wolf Form" }, description: [{ paragraph: { "en-US": "A 1d10 bonus to attack and damage." } }] },
      { name: { "en-US": "Howling Rampage" }, description: [{ paragraph: { "en-US": "Roll d20s equal to your tier." } }] },
    ],
  }],
  classes: [{
    id: "cls", name: "GUARDIAN", domains: ["VALOR", "BLADE"], startingHitPoints: 7, startingEvasion: 9,
    hopeFeature: { name: { "en-US": "Unstoppable" }, description: [{ paragraph: { "en-US": "Reduce incoming damage by one threshold." } }] },
    classFeatures: [{ name: { "en-US": "Frontline Tank" }, description: [{ paragraph: { "en-US": "You mark 1 fewer Stress." } }] }],
  }],
  subclasses: [{
    id: "sub", name: { "en-US": "Stalwart" }, spellcastTrait: "KNOWLEDGE",
    foundation: { features: [{ name: { "en-US": "Unwavering" }, description: [{ paragraph: { "en-US": "+1 to your damage thresholds." } }] }] },
    specialization: { features: [{ name: { "en-US": "Unrelenting" }, description: [{ paragraph: { "en-US": "+2 to your damage thresholds." } }] }] },
    mastery: { features: [{ name: { "en-US": "Undaunted" }, description: [{ paragraph: { "en-US": "+3 to your damage thresholds." } }] }] },
  }],
  ancestries: [
    {
      id: "anc_a", name: { "en-US": "Giant" },
      features: [
        { name: { "en-US": "Endurance" }, description: [{ paragraph: { "en-US": "Gain an additional Hit Point slot." } }] },
        { name: { "en-US": "Reach" }, description: [{ paragraph: { "en-US": "Extend your reach by one range band." } }] },
      ],
    },
    {
      id: "anc_b", name: { "en-US": "Simiah" },
      features: [
        { name: { "en-US": "Natural Climber" }, description: [{ paragraph: { "en-US": "You always succeed on Agility Rolls to climb." } }] },
        { name: { "en-US": "Nimble" }, description: [{ paragraph: { "en-US": "+1 to Evasion." } }] },
      ],
    },
  ],
  communities: [{ id: "com", name: { "en-US": "Wanderborne" }, features: [{ name: { "en-US": "Nomadic Pack" }, description: [{ paragraph: { "en-US": "Extra inventory slot." } }] }] }],
  domainCards: [{ id: "card1", name: { "en-US": "Rise Up" }, domain: "VALOR", level: 1, type: "ABILITY", recallCost: 0, features: [] }],
  armors: [{ id: "gambeson", name: { "en-US": "Gambeson" }, baseScore: 3, baseMajorThreshold: 5, baseSevereThreshold: 11, features: [] }],
  weapons: [
    { id: "modified", name: { "en-US": "Heavy Warhammer" }, trait: "STRENGTH", range: "MELEE", burden: "TWO_HANDED", damage: { dice: "D10", modifier: 3, type: "PHYSICAL" }, features: [] },
    { id: "plain", name: { "en-US": "Shortsword" }, trait: "AGILITY", range: "MELEE", burden: "ONE_HANDED", damage: { dice: "D6", type: "PHYSICAL" }, features: [] },
    // A feature whose only description block is a `list`, the way Guardian's Unstoppable is in
    // the real data — no `paragraph` at all, so `text` must come back empty and `items` must
    // carry the bullets, or the render layer prints a heading over nothing.
    { id: "listed", name: { "en-US": "Listed Blade" }, trait: "AGILITY", range: "MELEE", burden: "ONE_HANDED", damage: { dice: "D6", type: "PHYSICAL" }, features: [{ name: { "en-US": "Options" }, description: [{ list: [{ "en-US": "Choose fire." }, { "en-US": "Choose frost." }] }] }] },
  ],
  consumables: [],
};

function sheetChar(over = {}) {
  const ch = newCharacter();
  ch.classId = "cls";
  ch.subclassId = "sub";
  ch.heritage = { ancestryMode: "pure", ancestryIds: ["anc_a"], chosenFeatures: [{ ancestryId: "anc_a", featureName: "Endurance" }, { ancestryId: "anc_a", featureName: "Reach" }], communityId: "com" };
  // No weaponMode, the same shape create.js now saves. Tests that need the legacy field say so.
  ch.equipment = { primaryWeaponId: null, secondaryWeaponId: null, armorId: "gambeson", potionChoice: null };
  ch.background = { description: "", answers: "" };
  ch.connectionsNotes = "";
  return Object.assign(ch, over);
}

group("Sheet damage strings: Proficiency copies of the die, plus an optional modifier");
{
  const withMod = deriveSheet(sheetChar({ proficiency: 2, equipment: { weaponMode: "two-handed", primaryWeaponId: "modified", armorId: "gambeson" } }), SHEET_DB);
  eq("a D10 with +3 at Proficiency 2 prints 2d10+3", withMod.weapons[0].damage, "2d10+3");

  const noMod = deriveSheet(sheetChar({ proficiency: 1, equipment: { weaponMode: "two-handed", primaryWeaponId: "plain", armorId: "gambeson" } }), SHEET_DB);
  eq("a weapon with no modifier never prints a trailing +0", noMod.weapons[0].damage, "1d6");
}

group("Sheet weapons: a secondary prints because it's equipped, not because of a mode string");
{
  // This used to assert that a "two-handed" weaponMode printed only the primary. The sheet was
  // the last reader of that field, and it outlived the truth: nothing writes weaponMode any
  // more, so the gate was never satisfied and every off-hand weapon quietly went missing from
  // the printed page — including the shield a Warrior is allowed to carry behind a two-handed
  // primary, whose Barrier was already counted in the Armor Score printed alongside it.
  const both = deriveSheet(sheetChar({ equipment: { primaryWeaponId: "plain", secondaryWeaponId: "modified", armorId: "gambeson" } }), SHEET_DB);
  eq("both weapons print", both.weapons.length, 2);
  eq("and the off-hand is the one that was equipped", both.weapons[1].name, "Heavy Warhammer");

  // A two-handed primary with a secondary still equipped is the Warrior case, not a stale slot.
  const twoHandedPrimary = deriveSheet(sheetChar({ equipment: { primaryWeaponId: "modified", secondaryWeaponId: "plain", armorId: "gambeson" } }), SHEET_DB);
  eq("a two-handed primary doesn't hide what's in the other hand", twoHandedPrimary.weapons.length, 2);

  // Characters saved before the change still carry the field. It has to mean nothing.
  const legacy = deriveSheet(sheetChar({ equipment: { weaponMode: "two-handed", primaryWeaponId: "plain", secondaryWeaponId: "modified", armorId: "gambeson" } }), SHEET_DB);
  eq("a leftover weaponMode from an older save changes nothing", legacy.weapons.length, 2);

  const alone = deriveSheet(sheetChar({ equipment: { primaryWeaponId: "plain", armorId: "gambeson" } }), SHEET_DB);
  eq("with nothing in the off hand, only the primary prints", alone.weapons.length, 1);
}

group("Sheet heritage: mixed ancestry prints only the chosen feature, pure prints them all");
{
  // Mirrors create.js's ancestry-mode "pure" branch, where chosenFeatures is seeded with every
  // feature of the ancestry — so filtering by it is a no-op there.
  const pure = deriveSheet(sheetChar(), SHEET_DB); // sheetChar()'s default heritage is pure, both Giant features chosen
  eq("pure ancestry: filtering by chosenFeatures is a no-op", pure.ancestryFeatures.map((f) => f.name).sort(), ["Endurance", "Reach"]);

  // Mixed ancestry: create.js records exactly one feature per ancestry. A Giant whose ONE pick
  // was Reach must not also print Endurance just because it belongs to the same ancestry.
  const mixed = deriveSheet(sheetChar({
    heritage: {
      ancestryMode: "mixed",
      ancestryIds: ["anc_a", "anc_b"],
      chosenFeatures: [{ ancestryId: "anc_a", featureName: "Reach" }, { ancestryId: "anc_b", featureName: "Nimble" }],
      communityId: "com",
    },
  }), SHEET_DB);
  eq("mixed ancestry: only the picked feature per ancestry prints", mixed.ancestryFeatures.map((f) => f.name).sort(), ["Nimble", "Reach"]);
  check("the unpicked sibling features are gone", !mixed.ancestryFeatures.some((f) => f.name === "Endurance" || f.name === "Natural Climber"));
}

group("Sheet features: list-block description without a paragraph still prints");
{
  const s = deriveSheet(sheetChar({ equipment: { weaponMode: "two-handed", primaryWeaponId: "listed", armorId: "gambeson" } }), SHEET_DB);
  const f = s.weapons[0].features[0];
  eq("a single list block survives, tagged and in order", f.description,
    [{ type: "list", items: ["Choose fire.", "Choose frost."] }]);
}

group("Sheet features: paragraph -> list -> paragraph keeps its blocks in source order");
{
  // Shaped exactly like the real Champion's Edge (10 of the 189 domain cards share this
  // paragraph -> list -> paragraph shape): a lead-in, the Hope options it introduces, then a
  // paragraph restricting them. Before this fix, features() joined every paragraph into one
  // string and every list into another, which welded the restriction onto the lead-in and
  // printed it BEFORE the options it restricts — this is the fixture that would have caught it.
  const EDGE_DB = {
    ...SHEET_DB,
    domainCards: [...SHEET_DB.domainCards, {
      id: "card_edge", name: { "en-US": "Champion's Edge" }, domain: "BLADE", level: 5,
      type: "ABILITY", recallCost: 1,
      features: [{
        description: [
          { paragraph: { "en-US": "Choose one of the following options for each Hope spent:" } },
          {
            list: [
              { "en-US": "Clear a Hit Point." },
              { "en-US": "Clear an Armor Slot." },
              { "en-US": "The target marks an additional Hit Point." },
            ],
          },
          { paragraph: { "en-US": "You can't choose the same option more than once." } },
        ],
      }],
    }],
  };
  const s = deriveSheet(sheetChar({ domainCardIds: ["card_edge"], creationDomainCardIds: ["card_edge"] }), EDGE_DB);
  const blocks = s.loadout[0].features[0].description;
  eq("all three blocks survive, in source order", blocks.map((b) => b.type), ["paragraph", "list", "paragraph"]);
  eq("the lead-in prints first", blocks[0].text, "Choose one of the following options for each Hope spent:");
  eq("the three Hope options are untouched", blocks[1].items.length, 3);
  eq("the restriction prints LAST, after its options — the bug this fixes",
    blocks[2].text, "You can't choose the same option more than once.");
}

group("Sheet features: multiple paragraphs stay separate blocks, not a run-on string");
{
  // Shaped like Beastbound's Companion: two paragraphs, no list. 65 of 354 features have more
  // than one paragraph; the old `text: (description).map(...).join(" ")` printed them as one
  // block with no break, which is what this equality check on the block array rules out.
  const db = {
    ...SHEET_DB,
    classes: [{
      ...SHEET_DB.classes[0],
      classFeatures: [{
        name: { "en-US": "Companion" },
        description: [
          { paragraph: { "en-US": "You have an animal companion of your choice." } },
          { paragraph: { "en-US": "Take the Ranger Companion sheet." } },
        ],
      }],
    }],
  };
  const s = deriveSheet(sheetChar(), db);
  eq("two paragraph blocks, not one joined string", s.classFeatures[0].description, [
    { type: "paragraph", text: "You have an animal companion of your choice." },
    { type: "paragraph", text: "Take the Ranger Companion sheet." },
  ]);
}

group("Sheet spellcast: trait name, a bonus applied, and no box for non-casters");
{
  const plain = deriveSheet(sheetChar(), SHEET_DB); // "sub"'s spellcastTrait is KNOWLEDGE
  eq("shows the trait name, not a bare number", plain.spellcast.display, "Knowledge");
  check("traitLabel doesn't ride along onto the sheet (finding 6: display already names the trait)",
    !("traitLabel" in plain.spellcast));

  // The armor's feature is named "Channeling", the same generic `armor:Channeling` key
  // effects.js resolves for any armor with that feature — the trick the "Sheet stats agree
  // with derivedStats()" group above already uses for Very Heavy.
  const BONUS_DB = {
    ...SHEET_DB,
    armors: [...SHEET_DB.armors, {
      id: "chan", name: { "en-US": "Channeling Armor" }, baseScore: 5,
      baseMajorThreshold: 13, baseSevereThreshold: 36,
      features: [{ name: { "en-US": "Channeling" }, description: [{ paragraph: { "en-US": "+1 to Spellcast Rolls." } }] }],
    }],
  };
  const boosted = deriveSheet(sheetChar({
    equipment: { weaponMode: "two-handed", primaryWeaponId: null, secondaryWeaponId: null, armorId: "chan", potionChoice: null },
  }), BONUS_DB);
  eq("a bonus shows on the Spellcast box, not folded into the trait", boosted.spellcast.display, "Knowledge +1");

  const NOCAST_DB = { ...SHEET_DB, subclasses: [...SHEET_DB.subclasses, { id: "nocast", name: { "en-US": "Stonewall" } }] };
  const guardian = deriveSheet(sheetChar({ subclassId: "nocast" }), NOCAST_DB);
  check("Guardian/Warrior subclasses with no Spellcast trait get no box at all", guardian.spellcast === null);
}

group("Sheet hitPointsNote and stressNote: the same clamp caption armorScoreNote already gets");
{
  const capped = deriveSheet(sheetChar({ hitPointSlotsBonus: 20, stressSlotsBonus: 20 }), SHEET_DB);
  eq("Hit Points clamp at the rules maximum", capped.hitPoints, MAX_HIT_POINT_SLOTS);
  check("and the sheet is told why", !!capped.hitPointsNote);
  eq("Stress clamps too", capped.stress, MAX_STRESS_SLOTS);
  check("with its own note", !!capped.stressNote);

  const uncapped = deriveSheet(sheetChar(), SHEET_DB);
  check("no note printed when nothing clamped", !uncapped.hitPointsNote && !uncapped.stressNote);
}

group("Sheet loadout: a vaulted card is filtered out, an active one isn't");
{
  const DB2 = {
    ...SHEET_DB,
    domainCards: [...SHEET_DB.domainCards,
      { id: "card2", name: { "en-US": "Two" }, domain: "VALOR", level: 1, type: "ABILITY", recallCost: 0, features: [] }],
  };
  const s = deriveSheet(sheetChar({
    domainCardIds: ["card1", "card2"], creationDomainCardIds: ["card1", "card2"], domainVaultIds: ["card2"],
  }), DB2);
  eq("only the active card prints in the loadout", s.loadout.map((c) => c.id), ["card1"]);
}

group("Sheet experiences: a resolved permanent-bonus choice reaches the printed total");
{
  // Clank's Purposeful Design, the fix sheet-data.js's own comment claims: "a couple of
  // features ... add a permanent bonus on top of the level-up value, and the old file's
  // `character.experiences[i].modifier` never saw that bonus." Real id, because effects.js is
  // keyed by real ids (`core_ancestry_clank:Purposeful Design`) and an entry keyed to an id
  // that doesn't exist grants nothing at all, silently.
  const CLANK_DB = {
    ...SHEET_DB,
    ancestries: [...SHEET_DB.ancestries, {
      id: "core_ancestry_clank", name: { "en-US": "Clank" },
      features: [{ name: { "en-US": "Purposeful Design" }, description: [{ paragraph: { "en-US": "..." } }] }],
    }],
  };
  const s = deriveSheet(sheetChar({
    heritage: {
      ancestryMode: "pure", ancestryIds: ["core_ancestry_clank"],
      chosenFeatures: [{ ancestryId: "core_ancestry_clank", featureName: "Purposeful Design" }],
      communityId: null,
    },
    effectChoices: { "core_ancestry_clank:Purposeful Design": { optionId: "one", experienceIds: ["e1"] } },
  }), CLANK_DB);
  eq("the chosen Experience shows the base value plus the permanent bonus",
    s.experiences.find((e) => e.name === "A").display, "+3"); // base 2 + Purposeful Design's +1
  eq("the Experience not chosen is untouched", s.experiences.find((e) => e.name === "B").display, "+2");
}

group("Sheet subclassFeatures: every tier earned prints, not just the current one");
{
  // Upgrading a subclass card ADDS a tier, it doesn't replace the one below it — the same
  // rule subclassTiersUpTo() encodes for characters.js's detail view (see "A subclass upgrade
  // adds a card, it doesn't replace the one below" above). A Mastery character still has their
  // Foundation and Specialization features; printing only sub[subclassTier] silently dropped
  // them.
  const mastery = deriveSheet(sheetChar({ subclassTier: "mastery" }), SHEET_DB);
  eq("Foundation, Specialization and Mastery all print, in that order",
    mastery.subclassFeatures.map((f) => f.name), ["Unwavering", "Unrelenting", "Undaunted"]);
  eq("each feature is labelled with ITS OWN tier, not the character's current one",
    mastery.subclassFeatures.map((f) => f.source), ["Foundation", "Specialization", "Mastery"]);

  const foundation = deriveSheet(sheetChar(), SHEET_DB); // sheetChar()'s default tier is foundation
  eq("a Foundation character only gets the Foundation feature",
    foundation.subclassFeatures.map((f) => f.name), ["Unwavering"]);
}

group("Sheet: a draft with no class chosen is still printable");
{
  const draft = deriveSheet(sheetChar({ classId: null, subclassId: null }), SHEET_DB);
  eq("class name falls back to a dash", draft.className, "—");
  eq("subclass name falls back to a dash", draft.subclassName, "—");
  check("Evasion has nothing to show", draft.evasion === null);
  check("Hit Points has nothing to show", draft.hitPoints === null);
  check("there's no Hope feature to print", draft.hopeFeature === null);
  eq("no class features either", draft.classFeatures, []);
  check("Spellcast has nothing to show without a subclass", draft.spellcast === null);
  // Thresholds and Armor Score don't depend on class at all — they're still there.
  check("Armor Score doesn't need a class", draft.armorScore === 3);
}

group("Sheet stats agree with derivedStats() rather than re-deriving anything");
{
  // "Very Heavy" is keyed generically in effects.js as `armor:Very Heavy` — it resolves off the
  // FEATURE NAME, not the armor's id, so a fixture armor picks up the real, unmodified
  // effects.js entry (-2 Evasion, -1 Agility) the same way a real "Full Plate Armor" would.
  // That makes this a genuine check that the sheet reads EFFECTIVE traits/Evasion (through
  // derivedStats()), not `character.traits` / `startingEvasion + evasionBonus` directly.
  const EFFECT_DB = {
    ...SHEET_DB,
    weapons: [...SHEET_DB.weapons, { id: "sword", name: { "en-US": "Broadsword" }, trait: "AGILITY", range: "MELEE", burden: "ONE_HANDED", damage: { dice: "D8", type: "PHYSICAL" }, features: [] }],
    armors: [
      ...SHEET_DB.armors,
      { id: "heavy", name: { "en-US": "Full Plate" }, baseScore: 4, baseMajorThreshold: 8, baseSevereThreshold: 17, features: [{ name: { "en-US": "Very Heavy" }, description: [{ paragraph: { "en-US": "-2 to Evasion; -1 to Agility" } }] }] },
      { id: "absurd", name: { "en-US": "Absurd Plate" }, baseScore: 40, baseMajorThreshold: 5, baseSevereThreshold: 11, features: [] },
    ],
  };
  const heavy = deriveSheet(sheetChar({
    level: 3, traits: { agility: 1, strength: 2, finesse: 0, instinct: 1, presence: 0, knowledge: -1 },
    equipment: { weaponMode: "one-handed", primaryWeaponId: "sword", armorId: "heavy" },
  }), EFFECT_DB);
  eq("Evasion picks up Very Heavy's -2, not just the class baseline", heavy.evasion, 7); // 9 - 2
  eq("the trait row shows the reduced Agility", heavy.traits.find((t) => t.key === "agility").display, "0"); // 1 - 1
  eq("the weapon's own attack roll uses the same reduced Agility", heavy.weapons[0].attack, "0");
  eq("thresholds are armor base plus level, same as derivedStats()", heavy.thresholds, { major: 11, severe: 20 }); // 8+3, 17+3

  // Armor Score can't exceed 12 (SRD) — printing armor.baseScore directly, as the old file did,
  // would show 40. The note is the one thing worth carrying onto a printed page even without a
  // popover to put it in, since nothing else at the table would tell a player their number capped.
  const capped = deriveSheet(sheetChar({ equipment: { weaponMode: "two-handed", armorId: "absurd" } }), EFFECT_DB);
  eq("Armor Score is capped at 12, not printed as the raw baseScore of 40", capped.armorScore, 12);
  check("and the cap is explained in a note the printed page can show", !!capped.armorScoreNote);
}

group("Table state: boxes marked at the table (HP, Stress, Hope, Armor)");
{
  eq("a new character starts with nothing marked but the two starting Hope, no conditions, no notes",
    defaultState(), { hp: 0, stress: 0, hope: HOPE_START, armor: 0, scars: 0, conditions: [], notes: "" });
  eq("Hope starts at 2 and caps at 6, per the SRD", [HOPE_START, HOPE_MAX], [2, 6]);

  // Tapping is "fill up to here / clear from here on": one tap reaches any value.
  eq("tapping an empty box marks every box up to and including it", tapBox(0, 2), 3);
  eq("tapping the box right after the marked ones marks one more", tapBox(2, 2), 3);
  eq("tapping the last marked box clears just that one", tapBox(3, 2), 2);
  eq("tapping an earlier marked box clears it and everything after", tapBox(5, 1), 1);
  eq("tapping the first box when it's the only one marked clears everything", tapBox(1, 0), 0);

  const maxes = { hp: 6, stress: 6, hope: HOPE_MAX, armor: 3 };
  eq("values within the maxima pass through untouched",
    clampState({ hp: 2, stress: 1, hope: 4, armor: 3 }, maxes), { hp: 2, stress: 1, hope: 4, armor: 3, scars: 0, conditions: [], notes: "" });
  eq("a value above its maximum (e.g. armor swapped for a lighter one) is pulled down to it",
    clampState({ hp: 9, stress: 0, hope: 7, armor: 5 }, maxes), { hp: 6, stress: 0, hope: 6, armor: 3, scars: 0, conditions: [], notes: "" });

  // Conditions and notes ride along in the same state object: a clamp must keep them, or the
  // first tap on an HP box would silently drop every condition marked.
  eq("conditions and notes survive a clamp",
    clampState({ hp: 1, stress: 0, hope: 2, armor: 0, conditions: ["hidden", "restrained"], notes: "owes Rya 2 gold" }, maxes),
    { hp: 1, stress: 0, hope: 2, armor: 0, scars: 0, conditions: ["hidden", "restrained"], notes: "owes Rya 2 gold" });
  eq("unknown condition ids and non-string entries are dropped, duplicates collapsed",
    clampState({ conditions: ["vulnerable", "stunned", 3, "vulnerable"] }, maxes).conditions, ["vulnerable"]);
  eq("non-string notes fall back to empty", clampState({ notes: 42 }, maxes).notes, "");

  eq("the SRD's three conditions, each with the one line a player needs at the table",
    CONDITIONS.map((c) => c.id), ["vulnerable", "hidden", "restrained"]);
  check("every condition has a label and an effect", CONDITIONS.every((c) => c.label && c.effect));
  eq("toggling a condition on adds it in catalogue order", toggleCondition(["restrained"], "vulnerable"), ["vulnerable", "restrained"]);
  eq("toggling it again removes it", toggleCondition(["vulnerable", "restrained"], "vulnerable"), ["restrained"]);
  eq("toggling an unknown id changes nothing", toggleCondition(["hidden"], "stunned"), ["hidden"]);
  eq("negative and non-numeric values fall back to the defaults",
    clampState({ hp: -1, stress: "x", hope: undefined, armor: null }, maxes), defaultState());
  eq("an unknown maximum (draft with no class yet) means nothing can be marked",
    clampState({ hp: 3, stress: 2, hope: 2, armor: 1 }, { hp: null, stress: 6, hope: 6, armor: null }),
    { hp: 0, stress: 2, hope: 2, armor: 0, scars: 0, conditions: [], notes: "" });
  eq("a missing state altogether clamps to the defaults", clampState(undefined, maxes), defaultState());
  check("clampState returns a new object rather than mutating its input", (() => {
    const input = { hp: 9, stress: 0, hope: 2, armor: 0 };
    clampState(input, maxes);
    return input.hp === 9;
  })());

  eq("the maxima come from the derived sheet: HP, Stress, Hope slots and Armor Score (= armor slots)",
    maxesFromSheet({ hitPoints: 7, stress: 6, hopeSlots: 6, armorScore: 3 }),
    { hp: 7, stress: 6, hope: 6, armor: 3 });
  eq("unknown sheet values stay null so the UI can show a dash",
    maxesFromSheet({ hitPoints: null, stress: 6, hopeSlots: 6, armorScore: null }),
    { hp: null, stress: 6, hope: 6, armor: null });

  eq("ensureLevelFields backfills the table state on characters saved before it existed",
    ensureLevelFields(newCharacter()).state, defaultState());
  const kept = newCharacter();
  kept.state = { hp: 3, stress: 1, hope: 5, armor: 2 };
  // A character saved between the play page and scars existing has a state with no `scars`
  // field at all — not zero, absent. ensureLevelFields backfills it without touching anything
  // else already there.
  eq("and backfills scars onto an existing state that predates it, leaving the rest untouched",
    ensureLevelFields(kept).state, { hp: 3, stress: 1, hope: 5, armor: 2, scars: 0 });

  // An imported file can say `"state": "x"` (or a number, or an array): not just missing, but
  // the wrong shape entirely. Writing a field onto a primitive throws in strict mode, which
  // would take the whole page down rather than just this one character's state.
  for (const bad of ["rotto", 42, [], null]) {
    const broken = newCharacter();
    broken.state = bad;
    check(`a primitive or array state (${JSON.stringify(bad)}) resets to defaultState() instead of throwing`, (() => {
      try {
        return JSON.stringify(ensureLevelFields(broken).state) === JSON.stringify(defaultState());
      } catch {
        return false;
      }
    })());
  }

  // A scar crosses out a Hope slot for good (SRD, Avoid Death). They're always the slots at
  // the right-hand end, so scarring is tapBox seen from that end.
  eq("no scars to start with", defaultState().scars, 0);
  eq("long-pressing the last slot crosses out just that one", scarAt(0, 5, 6), 1);
  eq("long-pressing an earlier one crosses out it and everything after", scarAt(0, 3, 6), 3);
  eq("long-pressing the leftmost crosses out the lot", scarAt(0, 0, 6), 6);
  eq("long-pressing the only crossed slot frees it", scarAt(1, 5, 6), 0);
  eq("long-pressing a crossed slot frees it and the crossed ones before it", scarAt(3, 4, 6), 1);
  eq("long-pressing the leftmost crossed slot frees just that one, the ones after it stay", scarAt(3, 3, 6), 2);
  eq("long-pressing the rightmost (last) crossed slot frees them all", scarAt(3, 5, 6), 0);

  eq("scars ride along in the state", clampState({ scars: 2 }, maxes).scars, 2);
  eq("more scars than there are slots is impossible", clampState({ scars: 9 }, maxes).scars, HOPE_MAX);
  eq("a negative or non-numeric scar count falls back to none",
    [clampState({ scars: -1 }, maxes).scars, clampState({ scars: "x" }, maxes).scars], [0, 0]);
  eq("a scar gained with Hope full pushes the Hope down with it",
    clampState({ hope: 6, scars: 2 }, maxes).hope, 4);
  eq("Hope below the reduced maximum is left where it is", clampState({ hope: 1, scars: 2 }, maxes).hope, 1);
  eq("with no Hope slots at all (a draft with no class) nothing can be scarred",
    clampState({ scars: 3 }, { hp: 6, stress: 6, hope: null, armor: 3 }).scars, 0);
  eq("a character saved before scars existed opens with none",
    ensureLevelFields(newCharacter()).state.scars, 0);
}

group("JSON transfer: one file format for one character or the whole list");
{
  const a = newCharacter(); a.id = "a"; a.name = "Aster";
  const b = newCharacter(); b.id = "b"; b.name = "Brann Ferro";
  const when = new Date("2026-08-26T10:00:00Z");

  const text = serializeCharacters([a, b], when);
  const parsed = JSON.parse(text);
  eq("the envelope names the format, a version and the export time",
    [parsed.format, parsed.version, parsed.exportedAt], [EXPORT_FORMAT, 1, "2026-08-26T10:00:00.000Z"]);
  eq("and carries the characters as saved", parsed.characters.map((c) => c.id), ["a", "b"]);
  check("the text is pretty-printed so a file is readable and diffable", text.includes("\n  "));

  eq("parsing what serialize wrote gives the characters back", parseImport(text).characters.map((c) => c.name), ["Aster", "Brann Ferro"]);
  eq("and no errors", parseImport(text).errors, []);

  const old = JSON.stringify({ format: EXPORT_FORMAT, version: 1, characters: [{ id: "x", name: "Old", classId: "cls" }] });
  check("an older character is backfilled on import (ensureLevelFields), not rejected",
    parseImport(old).characters[0].levelUps !== undefined && parseImport(old).characters[0].state !== undefined);

  has("not JSON at all is an error", parseImport("nope {").errors, "not valid JSON");
  has("JSON that isn't one of these files is an error", parseImport(JSON.stringify({ hello: 1 })).errors, "not a Daggerheart character file");
  has("a bare character object (no envelope) is refused too", parseImport(JSON.stringify(a)).errors, "not a Daggerheart character file");
  has("an entry without an id is an error", parseImport(JSON.stringify({ format: EXPORT_FORMAT, version: 1, characters: [{ name: "No id" }] })).errors, "missing an id");
  has("an entry that isn't an object is an error", parseImport(JSON.stringify({ format: EXPORT_FORMAT, version: 1, characters: [42] })).errors, "not a character");
  eq("an empty list is fine (nothing to import, no error)", parseImport(JSON.stringify({ format: EXPORT_FORMAT, version: 1, characters: [] })), { characters: [], errors: [] });
  has("a newer version than this app knows is refused, naming the version", parseImport(JSON.stringify({ format: EXPORT_FORMAT, version: 99, characters: [] })).errors, "version 99");
}

group("JSON transfer: merging an import into the saved list, by id");
{
  const a = newCharacter(); a.id = "a"; a.name = "Aster"; a.level = 1;
  const b = newCharacter(); b.id = "b"; b.name = "Brann";
  const a2 = newCharacter(); a2.id = "a"; a2.name = "Aster"; a2.level = 3;
  const c = newCharacter(); c.id = "c"; c.name = "Cato";
  const existing = [a, b];
  const incoming = [a2, c];

  eq("conflicts are the incoming characters whose id is already saved", importConflicts(existing, incoming).map((x) => x.id), ["a"]);
  eq("no conflicts when every id is new", importConflicts(existing, [c]), []);

  const replaced = mergeImported(existing, incoming, "replace");
  eq("replace: the saved copy is overwritten in place, new ones appended",
    replaced.map((x) => `${x.id}:${x.name}:${x.level}`), ["a:Aster:3", "b:Brann:1", "c:Cato:1"]);

  let n = 0;
  const copied = mergeImported(existing, incoming, "copy", () => `new${++n}`);
  eq("copy: the saved copy stays, the incoming one gets a fresh id and a marker in its name",
    copied.map((x) => `${x.id}:${x.name}:${x.level}`), ["a:Aster:1", "b:Brann:1", "new1:Aster (imported):3", "c:Cato:1"]);

  check("merging never mutates the saved list", existing.length === 2 && existing[0].level === 1);
  eq("importing the same file twice with replace is idempotent",
    mergeImported(replaced, incoming, "replace").map((x) => x.id), ["a", "b", "c"]);

  const stamp = "2026-08-26";
  eq("one character is named after itself", exportFileName([b], stamp), "brann.json");
  eq("odd characters in the name become dashes", exportFileName([{ name: "Ser Aëlwyn / the Bold!" }], stamp), "ser-aelwyn-the-bold.json");
  eq("a nameless character still gets a file name", exportFileName([{ name: "" }], stamp), "character.json");
  eq("the whole list is named by date, like the CSV", exportFileName([a, b], stamp), `daggerheart-characters-${stamp}.json`);
}

group("The Hope & Fear content is the published SRD 2.0, not the playtest it was tested as");
{
  // The Void is Darrington Press's PLAYTEST imprint, and playtest text is revised before it
  // reaches a book. The four classes below were shipped from that release, so their features were
  // the pre-publication ones. These checks are what stops that happening again: each names a
  // string that exists in SRD 2.0 and does NOT exist in the playtest.
  const load = async (edition, name) => (await fetch(`../data/${edition}/${name}.json${RUN}`)).json();
  const [classes, subclasses, ancestries, communities, cards] = await Promise.all(
    ["classes", "subclasses", "ancestries", "communities", "domain-cards"].map((f) => load("srd_2_0", f)));
  const byName = (n) => classes.find((c) => c.name === n);
  const hope = (n) => byName(n)?.hopeFeature?.name?.["en-US"];
  const features = (n) => (byName(n)?.classFeatures || []).map((f) => f.name["en-US"]);

  eq("the four classes are here", ["ASSASSIN", "BRAWLER", "WARLOCK", "WITCH"].filter(byName).length, 4);
  // The Brawler's is a mechanical change, not a rename: the playtest spent 3 Hope on a successful
  // attack to Stagger; SRD 2.0 spends it to intimidate at Close range and make a target Vulnerable.
  eq("the Brawler's Hope feature is Square Up, not the playtest's Staggering Strike",
    hope("BRAWLER"), "Square Up");
  eq("the Assassin's is Deadly Determination, not Grim Resolve",
    hope("ASSASSIN"), "Deadly Determination");
  check("the Warlock's class feature is Patron\u2019s Pact, not Warlock Patron",
    features("WARLOCK").some((f) => f.includes("Pact")) && !features("WARLOCK").includes("Warlock Patron"));

  check("each of the four has two subclasses keyed by class name, the way the wizard looks them up",
    ["ASSASSIN", "BRAWLER", "WARLOCK", "WITCH"].every((n) => subclasses.filter((s) => s.class === n).length === 2));
  check("the 21 Dread domain cards", cards.filter((c) => c.domain === "DREAD").length === 21);
  eq("SRD 2.0 is one document: 13 classes, 210 cards", [classes.length, cards.length], [13, 210]);
  check("and every id in it names the document it came from",
    classes.every((c) => c.id.startsWith("srd_2_0_")) && cards.every((c) => c.id.startsWith("srd_2_0_")));
  check("six more ancestries and six more communities than SRD 1.0",
    ancestries.length === 24 && communities.length === 15);

  // SRD 1.0 stays exactly what it was published as. Its value is that it doesn't move.
  const [c1, d1, w1] = await Promise.all(["classes", "domain-cards", "weapons"].map((f) => load("srd_1_0", f)));
  eq("SRD 1.0 is complete and unmixed: 9 classes, 189 cards", [c1.length, d1.length], [9, 189]);
  check("with no Dread cards, because that domain wasn't published yet",
    d1.every((c) => c.domain !== "DREAD"));
  // The reason both editions are worth keeping on: 2.0 dropped weapons 1.0 has.
  const bare = (id) => id.replace(/^srd_[12]_0_/, "");
  const w2 = await load("srd_2_0", "weapons");
  const onlyIn1 = w1.filter((w) => !new Set(w2.map((x) => bare(x.id))).has(bare(w.id)));
  check(`SRD 2.0 dropped ${onlyIn1.length} weapons SRD 1.0 has, which is why both stay selectable`,
    onlyIn1.length > 0);
}

group("Play page labels: English by default, Italian when the page says lang=\"it\"");
{
  eq("the languages on offer", LANGUAGES, ["en", "it"]);
  eq("a plain tag picks its dictionary", [pickLanguage("it"), pickLanguage("en")], ["it", "en"]);
  eq("a regional tag picks the base language", pickLanguage("it-IT"), "it");
  eq("anything unknown, empty or missing falls back to English", [pickLanguage("de"), pickLanguage(""), pickLanguage(undefined)], ["en", "en", "en"]);

  const en = translator("en");
  const it = translator("it");
  eq("a key resolves in each language", [en("tab.status"), it("tab.status")], ["Status", "Stato"]);
  eq("placeholders are filled", it("hope.of", { n: 2, max: 6 }), "Speranza: 2 su 6");
  eq("an unknown key comes back as the key itself, never blank", it("nope.missing"), "nope.missing");
  check("every English key has an Italian one — no half-translated page",
    (() => { const missing = en.keys().filter((k) => it(k) === k && en(k) !== k); return missing.length === 0; })());
  check("the three conditions are translated, label and effect",
    ["vulnerable", "hidden", "restrained"].every((id) => it(`condition.${id}.label`) !== en(`condition.${id}.label`) && it(`condition.${id}.effect`) !== `condition.${id}.effect`));

  eq("an unscarred slot's label names it as a box, not a bare number",
    it("hope.slot", { n: 3, max: 6 }), "Casella di Speranza 3 di 6");
  eq("the crossed-out slot says so, counting the same way as the unscarred one",
    it("hope.scarred", { n: 6, max: 6 }), "Casella di Speranza 6 di 6, cicatrizzata");
  eq("the confirmation names the slot it's about to cross out for good",
    it("hope.scar.confirmOne", { n: 6 }), "Barrare per sempre la Speranza 6?");
  eq("or the whole range, when the gesture crosses out more than one",
    it("hope.scar.confirmMany", { from: 4, to: 6 }), "Barrare per sempre la Speranza da 4 a 6?");
  eq("the end of the road is spelled out, not implied",
    it("hope.journeyEnds"), "Il viaggio di questo personaggio finisce qui.");
}

group("Portrait: a picture small enough to live in localStorage");
{
  eq("the limits, in one place", [MAX_EDGE, MAX_BYTES], [512, 120_000]);

  eq("a wide picture is shrunk by its width", fitWithin(1600, 900, 512), { width: 512, height: 288 });
  eq("a tall one by its height", fitWithin(900, 1600, 512), { width: 288, height: 512 });
  eq("a square one hits the box on both sides", fitWithin(2000, 2000, 512), { width: 512, height: 512 });
  eq("one already inside the box is left alone — never enlarged", fitWithin(120, 90, 512), { width: 120, height: 90 });
  eq("a degenerate size doesn't divide by zero", fitWithin(0, 0, 512), { width: 0, height: 0 });

  const webp = "data:image/webp;base64,AAAA";
  eq("a small WebP data URL is a portrait", isPortrait(webp), true);
  eq("JPEG and PNG too", [isPortrait("data:image/jpeg;base64,AA"), isPortrait("data:image/png;base64,AA")], [true, true]);
  eq("a remote URL is not", isPortrait("https://example.com/face.png"), false);
  eq("nor is a script URL", isPortrait("javascript:alert(1)"), false);
  eq("nor is an HTML data URL dressed up as an image", isPortrait("data:text/html;base64,PHNjcmlwdD4="), false);
  eq("nor an SVG, which can carry script", isPortrait("data:image/svg+xml;base64,AA"), false);
  eq("nor an empty string, a number or an object", [isPortrait(""), isPortrait(42), isPortrait({})], [false, false, false]);
  eq("anything past the byte cap is refused", isPortrait("data:image/webp;base64," + "A".repeat(MAX_BYTES)), false);

  eq("sanitizePortrait passes a good one through", sanitizePortrait(webp), webp);
  eq("and turns anything else into null", [sanitizePortrait("javascript:alert(1)"), sanitizePortrait(undefined)], [null, null]);

  // Everything that gets read back — localStorage and imported files alike — goes through
  // ensureLevelFields, so that's where a portrait is checked before an <img> ever sees it.
  const clean = newCharacter();
  clean.portrait = webp;
  eq("a good portrait survives ensureLevelFields", ensureLevelFields(clean).portrait, webp);

  const nasty = newCharacter();
  nasty.name = "Aster";
  nasty.portrait = "javascript:alert(1)";
  const fixed = ensureLevelFields(nasty);
  eq("a portrait that isn't a picture is dropped", "portrait" in fixed, false);
  eq("and the rest of the character is untouched", fixed.name, "Aster");

  eq("a character with no portrait at all stays without one", "portrait" in ensureLevelFields(newCharacter()), false);

  const shipped = newCharacter();
  shipped.id = "p1";
  shipped.portrait = webp;
  eq("a portrait makes the round trip through an export file",
    parseImport(serializeCharacters([shipped])).characters[0].portrait, webp);
}

group("Portrait: a decompression bomb is caught by its header, before it ever decodes");
{
  // Bytes built by hand, one format at a time — no files on disk, no real image encoder.
  // decodedSize only needs enough of the header to read the declared width and height; the
  // rest of each format (pixel data, CRCs, Huffman tables) is never touched.
  const u8 = (arr) => Uint8Array.from(arr);
  const ascii = (s) => Array.from(s, (c) => c.charCodeAt(0));
  const toDataUrl = (mime, bytes) => {
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    return `data:${mime};base64,${btoa(binary)}`;
  };
  const u32be = (bytes, offset, value) => {
    bytes[offset] = (value >>> 24) & 0xff;
    bytes[offset + 1] = (value >>> 16) & 0xff;
    bytes[offset + 2] = (value >>> 8) & 0xff;
    bytes[offset + 3] = value & 0xff;
  };
  const u24le = (bytes, offset, value) => {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = (value >> 8) & 0xff;
    bytes[offset + 2] = (value >> 16) & 0xff;
  };

  // PNG: signature, then the IHDR chunk with width at byte 16 and height at byte 20
  // (big-endian, 4 bytes each). Nothing past byte 24 is read.
  function pngHeader(width, height) {
    const bytes = new Uint8Array(24);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    bytes.set([0, 0, 0, 13], 8); // IHDR data length, unread by decodedSize
    bytes.set(ascii("IHDR"), 12);
    u32be(bytes, 16, width);
    u32be(bytes, 20, height);
    return bytes;
  }

  // JPEG: SOI, then an SOF0 marker directly (real files have DQT/APP0 segments first, but the
  // scanner has to walk past those to find it — this fixture just puts SOF0 first). The segment
  // length that follows the marker is never used by decodedSize when the marker IS a SOF, so it
  //'s left as zeroes.
  function jpegHeader(width, height) {
    return u8([
      0xff, 0xd8,
      0xff, 0xc0, 0x00, 0x00,
      0x08, // precision
      (height >> 8) & 0xff, height & 0xff,
      (width >> 8) & 0xff, width & 0xff,
    ]);
  }

  // WebP VP8X (the "extended" chunk): RIFF/WEBP/VP8X headers, a flags byte, 3 reserved bytes,
  // then the canvas width and height as 24-bit little-endian values, each one less than the
  // real size.
  function webpVp8xHeader(width, height) {
    const bytes = new Uint8Array(30);
    bytes.set(ascii("RIFF"), 0);
    bytes.set(ascii("WEBP"), 8);
    bytes.set(ascii("VP8X"), 12);
    bytes[20] = 0; // flags
    u24le(bytes, 24, width - 1);
    u24le(bytes, 27, height - 1);
    return bytes;
  }

  eq("the cap", MAX_DECODED_EDGE, 2048);

  const pngSmall = toDataUrl("image/png", pngHeader(100, 100));
  const pngHuge = toDataUrl("image/png", pngHeader(24000, 24000));
  eq("PNG: a 100x100 header reads back its size", decodedSize(pngSmall), { width: 100, height: 100 });
  eq("PNG: a 24000x24000 header reads back its size too", decodedSize(pngHuge), { width: 24000, height: 24000 });
  eq("PNG: the small one is accepted", sanitizePortrait(pngSmall), pngSmall);
  eq("PNG: the huge one is refused before it ever decodes", sanitizePortrait(pngHuge), null);

  const jpegSmall = toDataUrl("image/jpeg", jpegHeader(100, 100));
  const jpegHuge = toDataUrl("image/jpeg", jpegHeader(24000, 24000));
  eq("JPEG: an SOF0 header reads back its size", decodedSize(jpegSmall), { width: 100, height: 100 });
  eq("JPEG: a huge SOF0 header reads back its size too", decodedSize(jpegHuge), { width: 24000, height: 24000 });
  eq("JPEG: the small one is accepted", sanitizePortrait(jpegSmall), jpegSmall);
  eq("JPEG: the huge one is refused", sanitizePortrait(jpegHuge), null);

  // A real photo's EXIF (plus a thumbnail) routinely pushes the SOF marker tens of kilobytes
  // in — an APP1 segment, walked past the same way any other segment is. A short scan budget
  // would give up on exactly these files and let the huge one through unread.
  function jpegHeaderWithApp1(width, height, app1Size) {
    const app1 = new Uint8Array(2 + app1Size); // marker (2) + length field, which counts itself
    app1[0] = 0xff; app1[1] = 0xe1;
    app1[2] = (app1Size >> 8) & 0xff;
    app1[3] = app1Size & 0xff;
    // app1[4..] stands in for the EXIF/thumbnail payload — content is never read, only skipped.
    const sof0 = jpegHeader(width, height).slice(2); // drop jpegHeader's own leading SOI
    const bytes = new Uint8Array(2 + app1.length + sof0.length);
    bytes[0] = 0xff; bytes[1] = 0xd8; // SOI
    bytes.set(app1, 2);
    bytes.set(sof0, 2 + app1.length);
    return bytes;
  }
  const jpegHugeWithExif = toDataUrl("image/jpeg", jpegHeaderWithApp1(24000, 24000, 8000));
  const jpegSmallWithExif = toDataUrl("image/jpeg", jpegHeaderWithApp1(100, 100, 8000));
  eq("JPEG: an 8KB APP1 segment ahead of SOF0 is walked past, size read correctly (huge)",
    decodedSize(jpegHugeWithExif), { width: 24000, height: 24000 });
  eq("JPEG: same APP1 size, a real photo's proportions", decodedSize(jpegSmallWithExif), { width: 100, height: 100 });
  eq("JPEG: the huge one is refused even behind 8KB of EXIF", sanitizePortrait(jpegHugeWithExif), null);
  eq("JPEG: the small one still passes with the same EXIF", sanitizePortrait(jpegSmallWithExif), jpegSmallWithExif);

  const webpSmall = toDataUrl("image/webp", webpVp8xHeader(100, 100));
  const webpHuge = toDataUrl("image/webp", webpVp8xHeader(24000, 24000));
  eq("WebP VP8X: a small canvas reads back its size", decodedSize(webpSmall), { width: 100, height: 100 });
  eq("WebP VP8X: a huge canvas reads back its size too", decodedSize(webpHuge), { width: 24000, height: 24000 });
  eq("WebP: the small one is accepted", sanitizePortrait(webpSmall), webpSmall);
  eq("WebP: the huge one is refused", sanitizePortrait(webpHuge), null);

  // A header that doesn't parse (too short, wrong signature) can't say it's oversized, so it's
  // let through rather than dropping an honest file the decoder would have handled anyway.
  eq("an unreadable header comes back null, not a false size", decodedSize("data:image/webp;base64,AAAA"), null);
  eq("and sanitizePortrait accepts it rather than guessing", sanitizePortrait("data:image/webp;base64,AAAA"), "data:image/webp;base64,AAAA");
  eq("a non-string is null, not a throw", decodedSize(42), null);
}

group("Sheet: fighting unarmed and going unarmored print as the choices they are");
{
  // Both sentinels are stored values with no record behind them in data/, so a sheet that looks
  // them up the ordinary way finds nothing: an empty weapon block and a bare dash, exactly what
  // a character who never finished the wizard would print. The whole point of choosing them is
  // that they ARE choices, and the table needs the rules that come with them.
  const barehanded = deriveSheet(sheetChar({ equipment: { primaryWeaponId: UNARMED, secondaryWeaponId: null, armorId: UNARMORED } }), SHEET_DB);

  eq("an unarmed character still gets a weapon row", barehanded.weapons.length, 1);
  eq("named for what it is", barehanded.weapons[0].name, "Unarmed");
  // SRD: successful unarmed attacks inflict [Proficiency]d4 — the same Proficiency-multiplies-
  // the-dice rule as any weapon. Proficiency is 1 in the fixture.
  eq("with the SRD's [Proficiency]d4 damage", barehanded.weapons[0].damage, "1d4");
  eq("at melee range", barehanded.weapons[0].range, "Melee");
  // Strength 2, Finesse 0 in the fixture. The GM calls which one per roll, so both print — and
  // a zero prints bare, the same as everywhere else a modifier is signed.
  eq("and both traits the GM can call for", barehanded.weapons[0].attack, "Strength +2 / Finesse 0");
  // That string names its own traits, so sheet.js must not print a bracketed trait after it.
  eq("with no single trait to name in brackets", barehanded.weapons[0].traitLabel, "");

  eq("choosing to wear nothing says so", barehanded.armorName, "Unarmored");
  eq("and scores 0, per the unarmored rule", barehanded.armorScore, 0);

  // The dash is what an unfinished character gets — the two have to stay distinguishable.
  const undecided = deriveSheet(sheetChar({ equipment: { primaryWeaponId: null, secondaryWeaponId: null, armorId: null } }), SHEET_DB);
  eq("a slot nobody has filled in yet still prints a dash", undecided.armorName, "—");
  eq("and an empty pair of hands prints no weapon row", undecided.weapons.length, 0);
}

group("Every class carries what the detail card shows");
{
  // The card is page code this suite can't render, but it reads eight fields straight out of
  // classes.json — most of which nothing else in the app has ever touched. Renamed or dropped
  // upstream, they'd surface as a blank section rather than as an error.
  const classes = await (await fetch(`../data/srd_2_0/classes.json${RUN}`)).json();
  const text = (loc) => typeof loc?.["en-US"] === "string" && loc["en-US"] !== "";
  const body = (desc) => Array.isArray(desc) && desc.length > 0 &&
    desc.every((d) => text(d.paragraph) || (Array.isArray(d.list) && d.list.every(text)));
  const feature = (f) => !!f && text(f.name) && body(f.description);

  const incomplete = classes.filter((c) => !(
    typeof c.name === "string" && c.name !== "" &&
    Array.isArray(c.domains) && c.domains.length > 0 &&
    Number.isFinite(c.startingEvasion) && Number.isFinite(c.startingHitPoints) &&
    body(c.description) &&
    Array.isArray(c.classItems) && c.classItems.length > 0 && c.classItems.every(text) &&
    feature(c.hopeFeature) &&
    Array.isArray(c.classFeatures) && c.classFeatures.length > 0 && c.classFeatures.every(feature)
  )).map((c) => c.name);

  check(`all ${classes.length} classes carry every field the card reads`, incomplete.length === 0,
    incomplete.length ? `incomplete: ${incomplete.join(", ")}` : undefined);
}

group("Downtime: the two moves a rest gives you (SRD p. 105)");
{
  const maxes = { hp: 6, stress: 6, hope: HOPE_MAX, armor: 3 };
  const beaten = { hp: 5, stress: 4, hope: 1, armor: 3, scars: 0, conditions: [], notes: "" };
  const move = (kind, id) => findRestMove(kind, id);

  eq("a rest is two moves, and the same move twice is allowed", DOWNTIME_MOVES_PER_REST, 2);
  eq("the short rest's menu", REST_MOVES.short.map((m) => m.id),
    ["tendToWounds", "clearStress", "repairArmor", "prepare"]);
  eq("the long rest's, which adds Work on a Project", REST_MOVES.long.map((m) => m.id),
    ["tendToAllWounds", "clearAllStress", "repairAllArmor", "prepare", "workOnProject"]);
  eq("an id that isn't on the menu comes back null, not undefined", findRestMove("short", "nope"), null);
  eq("and neither is a rest that doesn't exist", findRestMove("epic", "prepare"), null);

  // "clear a number of Hit Points equal to 1d4 + your tier"
  eq("the short rest's amount is the die plus the tier", restClearAmount(3, 2), 5);
  eq("a tier 1 character adds 1", restClearAmount(4, 1), 5);
  eq("a missing or nonsense roll clears nothing rather than throwing",
    [restClearAmount(0, 2), restClearAmount("x", 2), restClearAmount(undefined, undefined)], [2, 2, 0]);

  // HP, Stress and Armor count what's been spent or taken, so a rest counts them DOWN.
  eq("Tend to Wounds clears the rolled amount of HP",
    applyRestMove(beaten, maxes, move("short", "tendToWounds"), { amount: 3 }).hp, 2);
  eq("Clear Stress does the same to Stress",
    applyRestMove(beaten, maxes, move("short", "clearStress"), { amount: 2 }).stress, 2);
  eq("Repair Armor does the same to Armor Slots",
    applyRestMove(beaten, maxes, move("short", "repairArmor"), { amount: 1 }).armor, 2);
  eq("clearing more than was marked stops at nothing marked, it doesn't go negative",
    applyRestMove(beaten, maxes, move("short", "tendToWounds"), { amount: 99 }).hp, 0);
  eq("and a move with no amount passed clears nothing",
    applyRestMove(beaten, maxes, move("short", "tendToWounds")).hp, 5);

  eq("Tend to All Wounds clears the lot, no die involved",
    applyRestMove(beaten, maxes, move("long", "tendToAllWounds")).hp, 0);
  eq("so does Clear All Stress", applyRestMove(beaten, maxes, move("long", "clearAllStress")).stress, 0);
  eq("so does Repair All Armor", applyRestMove(beaten, maxes, move("long", "repairAllArmor")).armor, 0);

  // Hope is the one row that counts what you HOLD, so Prepare counts up.
  eq("Prepare gains a Hope", applyRestMove(beaten, maxes, move("short", "prepare")).hope, 2);
  eq("and two when you prepare with the party",
    applyRestMove(beaten, maxes, move("long", "prepare"), { together: true }).hope, 3);
  eq("Hope can't be prepared past the six slots",
    applyRestMove({ ...beaten, hope: 6 }, maxes, move("short", "prepare"), { together: true }).hope, 6);
  eq("nor past the slots a scar has taken away",
    applyRestMove({ ...beaten, hope: 4, scars: 2 }, maxes, move("short", "prepare"), { together: true }).hope, 4);

  eq("Work on a Project ticks a countdown the GM keeps, so the sheet is unchanged",
    applyRestMove(beaten, maxes, move("long", "workOnProject")), beaten);
  eq("an unknown move leaves the state alone rather than throwing",
    applyRestMove(beaten, maxes, null, { amount: 3 }), beaten);

  // A rest goes through the same clamp as a tap: an armor swap since the last session must not
  // survive as an impossible count just because a rest touched a different row.
  eq("a rest clamps the rest of the state too, like every other change",
    applyRestMove({ hp: 9, stress: 0, hope: 2, armor: 5 }, maxes, move("long", "clearAllStress")),
    { hp: 6, stress: 0, hope: 2, armor: 3, scars: 0, conditions: [], notes: "" });
  check("applyRestMove returns a new object rather than mutating its input", (() => {
    const input = { hp: 5, stress: 0, hope: 2, armor: 0, scars: 0, conditions: [], notes: "" };
    applyRestMove(input, maxes, move("long", "tendToAllWounds"));
    return input.hp === 5;
  })());

  // Conditions and notes are not what a rest is for: nothing in the SRD's downtime moves ends
  // one, so a rest that quietly cleared them would be the app inventing a rule.
  eq("a rest leaves conditions and notes exactly where they are",
    applyRestMove({ ...beaten, conditions: ["hidden"], notes: "owes Rya 2 gold" }, maxes,
      move("long", "tendToAllWounds")),
    { hp: 0, stress: 4, hope: 1, armor: 3, scars: 0, conditions: ["hidden"], notes: "owes Rya 2 gold" });
}

// ---------- card-render.js ----------

group("card art paths use the configured extension");
{
  eq("CARD_ART_EXT", CARD_ART_EXT, "png");
  // Art lives with its source, so these take a record. An UNTAGGED record — every fixture in this
  // file, and any db built by something that never saw a source — falls back to the newest SRD
  // edition, which is the same folder SRD_SOURCE names when a manifest can't be read.
  eq("domainCardArtPath", domainCardArtPath({ id: "core_x" }), `data/srd_2_0/card-art/domain/core_x.${CARD_ART_EXT}`);
  eq("subclassCardArtPath", subclassCardArtPath({ id: "core_y" }, "foundation"),
    `data/srd_2_0/card-art/subclass/core_y-foundation.${CARD_ART_EXT}`);
  eq("ancestryCardArtPath", ancestryCardArtPath({ id: "core_z" }), `data/srd_2_0/card-art/ancestry/core_z.${CARD_ART_EXT}`);
  eq("communityCardArtPath", communityCardArtPath({ id: "core_w" }), `data/srd_2_0/card-art/community/core_w.${CARD_ART_EXT}`);
  eq("a record from another source keeps its own art",
    domainCardArtPath({ id: "hb_x", contentSource: "my-homebrew" }),
    `data/my-homebrew/card-art/domain/hb_x.${CARD_ART_EXT}`);
}

group("Every choice in the wizard can be reached from the keyboard");
{
  // A grid of 13 classes, four to a row. Right walks along the row; Down lands under your
  // finger, not on the next option.
  eq("Right moves to the next option", nextIndex("ArrowRight", 0, 13, 4), 1);
  eq("Down moves a whole row", nextIndex("ArrowDown", 0, 13, 4), 4);
  eq("Up moves back a row", nextIndex("ArrowUp", 5, 13, 4), 1);
  eq("Left moves back one", nextIndex("ArrowLeft", 5, 13, 4), 4);

  // Wrapping: you can never be stuck at an end wondering which way turns back.
  eq("Right at the last option wraps to the first", nextIndex("ArrowRight", 12, 13, 4), 0);
  eq("Left at the first option wraps to the last", nextIndex("ArrowLeft", 0, 13, 4), 12);
  eq("Down past the end wraps round", nextIndex("ArrowDown", 11, 13, 4), 2);
  eq("Up before the start wraps round", nextIndex("ArrowUp", 1, 13, 4), 10);

  eq("Home goes to the first", nextIndex("Home", 7, 13, 4), 0);
  eq("End goes to the last", nextIndex("End", 2, 13, 4), 12);

  // -1 means "not ours": the caller must leave the event alone. Swallowing unknown keys is
  // how a widget eats Tab and traps the person inside it.
  eq("Tab is not ours", nextIndex("Tab", 3, 13, 4), -1);
  eq("a letter is not ours", nextIndex("a", 3, 13, 4), -1);
  eq("an empty grid has nowhere to go", nextIndex("ArrowRight", 0, 0, 4), -1);

  // A single column is the honest fallback when the caller cannot measure the grid: Down
  // behaves like Right rather than jumping somewhere the eye is not.
  eq("without a column count Down is just Right", nextIndex("ArrowDown", 0, 13, 1), 1);
  eq("a nonsense column count still moves by one", nextIndex("ArrowDown", 0, 13, 0), 1);

  // The group holds ONE tab stop, so Tab crosses it instead of visiting all 13.
  eq("Tab lands on the chosen option", tabStopIndex(6, 13), 6);
  eq("with nothing chosen Tab lands on the first", tabStopIndex(-1, 13), 0);
  eq("a stale index falls back to the first", tabStopIndex(99, 13), 0);

  check("Space and Enter both choose", CHOOSE_KEYS.includes(" ") && CHOOSE_KEYS.includes("Enter"));
}

// ---------- content sources ----------

const {
  combineManifests,
  mergeSources,
  normalizeRecord,
  parseManifest,
  parseSourceInfo,
  readsLocalManifest,
  unresolvedReferences,
  validateEffectEntry,
  validateRecord,
  visibleRecords,
} = await import(`../shared/content-sources.js${RUN}`);

const srcClass = (id, name, extra = {}) => ({ id, name, domains: ["BLADE"], ...extra });
const srcCard = (id, name, extra = {}) => ({ id, name: { "en-US": name }, domain: "BLADE", level: 1, ...extra });
const source = (name, records, effects) => ({ name, label: name, records, effects });

group("The list of content folders survives a bad manifest");
{
  eq("a plain list is read as written", parseManifest('["srd","homebrew"]'), ["srd", "homebrew"]);
  eq("junk names nothing rather than throwing", parseManifest("{oh no"), []);
  eq("a JSON object isn't a list of folders", parseManifest('{"srd":true}'), []);
  // The name goes straight into a fetch URL, so anything that could climb out of data/ is dropped.
  eq("a name that could escape data/ is dropped", parseManifest('["srd","../../etc","a/b"]'), ["srd"]);
  eq("the tracked list comes first, and repeats don't move it",
    combineManifests(["srd"], ["homebrew", "srd"]), ["srd", "homebrew"]);

  // The manifest may carry a flag as well as a list, and both shapes name the same folders.
  eq("the object shape names the same folders", parseManifest('{"sources":["srd"],"local":true}'), ["srd"]);
  eq("an object with no sources list names nothing", parseManifest('{"local":true}'), []);
  // Opt-in, so a clean checkout never fetches a gitignored file that almost nobody has.
  eq("a plain list does NOT ask for the local one", readsLocalManifest('["srd"]'), false);
  eq("the flag is what asks for it", readsLocalManifest('{"sources":["srd"],"local":true}'), true);
  eq("and it has to actually say true", readsLocalManifest('{"sources":["srd"],"local":"yes"}'), false);
  eq("junk asks for nothing", readsLocalManifest("{oh no"), false);

  const info = parseSourceInfo('{"label":"My Homebrew","files":["domain-cards","effects","nope"]}', "my-homebrew");
  eq("a source says what it holds", info.files, ["domain-cards", "effects"]);
  eq("and what to call it", info.label, "My Homebrew");
  eq("a folder with no label is called after itself", parseSourceInfo('{"files":[]}', "homebrew").label, "homebrew");
  eq("an unusable source.json is skipped, not guessed at", parseSourceInfo("{", "my-homebrew"), null);
}

group("A class written in the shape of its neighbours still works");
{
  // classes.json is the one file whose name is a bare uppercase string, because that name is a
  // relational key: subclasses[].class holds "BARD" and create.js joins on it. Writing a class the
  // way every other file is written is therefore the most natural homebrew mistake there is.
  eq("a localized class name becomes the key it has to be",
    normalizeRecord("classes", { id: "c", name: { "en-US": "Witch" } }).name, "WITCH");
  eq("a bare one is left as the key it already is",
    normalizeRecord("classes", { id: "c", name: "WITCH" }).name, "WITCH");
  eq("and a card written bare gets the localized shape its readers expect",
    normalizeRecord("domain-cards", { id: "x", name: "Ironhide" }).name, { "en-US": "Ironhide" });
  eq("normalizing never touches the record it was given",
    (() => { const r = { id: "c", name: "WITCH" }; normalizeRecord("classes", r); return r.name; })(), "WITCH");
}

group("A record that would kill a screen never reaches db");
{
  eq("a class with no domains is refused", validateRecord("classes", { id: "c", name: "WITCH" }), "missing: domains");
  eq("a card with no domain is refused", validateRecord("domain-cards", { id: "x", name: { "en-US": "A" } }), "missing: domain");
  eq("a record with no id is refused", validateRecord("domain-cards", { name: { "en-US": "A" } }), "missing: id");
  eq("a subclass that names no class is refused, because nothing could ever show it",
    validateRecord("subclasses", { id: "s", name: { "en-US": "A" } }), "missing: class (the class name, uppercase)");
  // A source may bring a domain of its own. Rejecting one nobody has heard of would block the
  // case this whole feature exists to be ready for.
  eq("a domain nobody has heard of is not an error",
    validateRecord("domain-cards", srcCard("x", "A", { domain: "DREAD" })), null);

  const { db, report } = mergeSources([source("homebrew", { classes: [srcClass("hb_a", "WITCH"), { id: "hb_b", name: "SEER" }] })]);
  eq("the usable record still lands", db.classes.map((c) => c.id), ["hb_a"]);
  eq("and the panel can say which one didn't, and why",
    report.sources[0].skipped, [{ file: "classes", id: "hb_b", reason: "missing: domains" }]);
}

group("A later source revises what an earlier one said");
{
  const { db, report } = mergeSources([
    source("srd", { "domain-cards": [srcCard("core_a", "Untouchable"), srcCard("core_b", "Whirlwind")] }),
    source("homebrew", { "domain-cards": [srcCard("core_a", "Untouchable (revised)")] }),
  ]);
  const visible = (dis) => visibleRecords(db.domainCards, dis).map((c) => c.name["en-US"]);
  eq("the revision wins", visible(new Set()), ["Untouchable (revised)", "Whirlwind"]);
  eq("in the position the original held", db.domainCards[0].id, "core_a");
  eq("and every visible record knows where it came from",
    visibleRecords(db.domainCards, new Set()).map((c) => c.contentSource), ["homebrew", "srd"]);
  eq("the panel reports it, so an accidental duplicate is visible",
    report.collisions, [{ file: "domain-cards", id: "core_a", from: "homebrew", over: "srd", byName: false }]);

  // The record that lost is KEPT, not dropped — switching the source that beat it off has to give
  // it back, or a folder that reprints a lot would empty the pickers the moment it went away.
  eq("the superseded record is still in the db, marked with what took it",
    db.domainCards.filter((c) => c.supersededBy).map((c) => [c.id, c.contentSource, c.supersededBy]),
    [["core_a", "srd", "core_a"]]);
  eq("switch the reviser off and the original is offered again",
    visible(new Set(["homebrew"])), ["Whirlwind", "Untouchable"]);
  eq("switch both off and nothing is offered", visible(new Set(["homebrew", "srd"])), []);

  // A class's real key is its uppercase name, not its id: create.js joins subclasses on it. Two
  // Bards under different ids would put two identical tiles in the picker with every Bard
  // subclass appearing under both.
  const byName = mergeSources([
    source("srd", { classes: [srcClass("core_class_bard", "BARD")] }),
    source("homebrew", { classes: [srcClass("homebrew_class_bard", "BARD")] }),
  ]);
  eq("a class with the same name collapses even under a new id",
    visibleRecords(byName.db.classes, new Set()).length, 1);
  eq("the later one being the survivor", byName.db.classes[0].id, "homebrew_class_bard");
  eq("and the shadowed one comes back if the homebrew is switched off",
    visibleRecords(byName.db.classes, new Set(["homebrew"])).map((c) => c.id), ["core_class_bard"]);
  eq("and it's reported as the name clash it is", byName.report.collisions[0].byName, true);
}

group("What the panel says about records one source took over from another");
{
  const { takeoverSummary } = await import(`../shared/content-settings.js${RUN}`);
  const src = (name, label, counts) => ({ name, label, counts, skipped: [] });
  const hit = (from, over, id, file = "domain-cards") => ({ file, id, from, over, byName: false });

  // A pair that collides a little is worth reading record by record: that is a homebrew folder
  // quietly sitting on top of something, which is the whole reason this list exists.
  const small = {
    sources: [src("srd", "Daggerheart SRD", { domainCards: 210 }), src("mine", "My homebrew", { domainCards: 3 })],
    collisions: [hit("mine", "srd", "a"), hit("mine", "srd", "b")],
  };
  eq("a small takeover is listed record by record", takeoverSummary(small, new Set()).lines.length, 2);
  check("and it lights the nav badge", takeoverSummary(small, new Set()).unexpected === 2);

  // A pair that collides wholesale is one fact repeated, and it buries the homebrew line above.
  const big = {
    sources: [src("srd", "Daggerheart SRD", { domainCards: 189 }), src("revised", "Revised", { domainCards: 210 })],
    collisions: Array.from({ length: 189 }, (_, i) => hit("revised", "srd", `c${i}`)),
  };
  eq("a wholesale takeover collapses to one line", takeoverSummary(big, new Set()).lines,
    ["Revised supersedes every record Daggerheart SRD has (189)"]);
  check("and it does NOT light the nav badge, because it is what anyone would expect",
    takeoverSummary(big, new Set()).unexpected === 0);

  // With the later source switched off the takeover never happened, so saying it did sends a
  // player looking for a change that isn't in front of them.
  eq("nothing is claimed when the source that would take over is switched off",
    takeoverSummary(big, new Set(["revised"])).lines, []);
  eq("nor when the source being taken over from is switched off",
    takeoverSummary(big, new Set(["srd"])).lines, []);

  // Partial, because the reviser didn't reprint everything — so the count says something.
  const partial = {
    sources: [src("srd", "Daggerheart SRD", { weapons: 20 }), src("revised", "Revised", { weapons: 15 })],
    collisions: Array.from({ length: 15 }, (_, i) => hit("revised", "srd", `w${i}`, "weapons")),
  };
  eq("a partial takeover says how many, so the survivors are implied",
    takeoverSummary(partial, new Set()).lines, ["Revised supersedes 15 of Daggerheart SRD's records"]);
}

group("What a source may say its content does");
{
  eq("flat numbers are the ordinary case", validateEffectEntry({ evasion: 1 }), null);
  eq("so is a permanent bonus, which is what keeps a vaulted card applying",
    validateEffectEntry({ armorScore: 1, permanent: true }), null);
  eq("and a whole choice, which needs no page code at all", validateEffectEntry({
    choice: { prompt: "Pick two", kind: "benefit", pick: 2, options: [{ id: "a", label: "A", stressSlots: 1 }] },
  }), null);
  eq("an entry may name the feature it encodes, for the \"?\" breakdown",
    validateEffectEntry({ evasion: 1, feature: "Unwavering" }), null);
  eq("and say which benefit of a card it deliberately skipped",
    validateEffectEntry({ evasion: 1, excluded: ["costs a Stress"] }), null);
  check("a stat that isn't a number is refused",
    validateEffectEntry({ evasion: "lots" }) !== null);
  check("a stat this app doesn't compute is refused",
    validateEffectEntry({ luck: 1 }) !== null);
  // effect-choice.js renders anything that isn't "benefit" as an Experience picker rather than
  // failing, so an unrecognised kind would silently ask the wrong question.
  check("a choice of an unknown kind is refused rather than rendered as the wrong picker",
    validateEffectEntry({ choice: { prompt: "?", kind: "vibes", options: [{ id: "a", label: "A" }] } }) !== null);
  check("`when` is refused, because JSON can't carry the function it needs",
    validateEffectEntry({ evasion: 1, when: true }) !== null);
  // The whitelist is no wider than what shared/effects.js understands: a key with no code behind
  // it would validate, ship, and quietly do nothing.
  check("a mechanic this app hasn't got yet is refused rather than silently ignored",
    validateEffectEntry({ evasion: 1, unarmedProfile: {} }) !== null);
}

group("A source's effects overlay the built-in table without replacing it");
{
  const { effects } = mergeSources([
    source("srd", {}, { "core_card_a": { evasion: 1 } }),
    source("homebrew", {}, { "core_card_a": { evasion: 3 }, "hb_card_b": { armorScore: 2 } }),
  ]);
  eq("a later source revises what a card does", effects["core_card_a"], { evasion: 3 });
  eq("and may declare one of its own", effects["hb_card_b"], { armorScore: 2 });

  const bad = mergeSources([source("homebrew", {}, { "hb_x": { evasion: 1, when: true } })]);
  eq("an entry the app can't use is dropped, not applied", bad.effects["hb_x"], undefined);
  eq("and the panel says which one, and why", bad.report.effectIssues.length, 1);
}

group("Switching a source off changes the pickers and nothing else");
{
  const { db } = mergeSources([
    source("srd", { "domain-cards": [srcCard("core_a", "A")] }),
    source("homebrew", { "domain-cards": [srcCard("homebrew_a", "B")] }),
  ]);
  eq("with nothing switched off, everything is offered",
    visibleRecords(db.domainCards, new Set()).map((c) => c.id), ["core_a", "homebrew_a"]);
  eq("a switched-off source leaves the pickers",
    visibleRecords(db.domainCards, new Set(["homebrew"])).map((c) => c.id), ["core_a"]);
  eq("the srd is a source like any other and can go too",
    visibleRecords(db.domainCards, new Set(["srd", "homebrew"])).map((c) => c.id), []);
  // Every fixture in this file, and every db built by something that predates content sources,
  // is untagged. Dropping those would break far more than it protected.
  eq("a record with no source is always offered",
    visibleRecords([{ id: "plain" }], new Set(["homebrew"])).map((c) => c.id), ["plain"]);
  // The point of the split: the record is still THERE, so a character built on it still resolves.
  eq("but the record is still findable by id, which is what keeps a character whole",
    db.domainCards.some((c) => c.id === "homebrew_a"), true);
}

group("A character says so when it refers to content this browser hasn't got");
{
  const db = {
    classes: [{ id: "core_class_bard" }],
    subclasses: [{ id: "core_subclass_troubadour" }],
    ancestries: [{ id: "core_ancestry_human" }],
    communities: [{ id: "core_community_loreborne" }],
    weapons: [{ id: "core_weapon_shortsword" }],
    armors: [{ id: "core_armor_leather" }],
    domainCards: [{ id: "core_card_a" }],
  };
  const whole = {
    classId: "core_class_bard", subclassId: "core_subclass_troubadour",
    heritage: { communityId: "core_community_loreborne", ancestryIds: ["core_ancestry_human"] },
    equipment: { primaryWeaponId: "core_weapon_shortsword", armorId: "core_armor_leather" },
    creationDomainCardIds: ["core_card_a"],
  };
  eq("a character whose content is all here says nothing", unresolvedReferences(whole, db), []);

  const orphan = { ...whole, classId: "myhomebrew_class_witch", equipment: { armorId: "hb_armor_ironhide" } };
  eq("one built on a folder you no longer have names what's missing",
    unresolvedReferences(orphan, db), [{ kind: "class", id: "myhomebrew_class_witch" }, { kind: "armor", id: "hb_armor_ironhide" }]);
  // Unarmed and Unarmored are stored values with no record behind them. Reporting those as
  // missing content would put a warning on the sheet of every barehanded character.
  eq("a sentinel is not missing content",
    unresolvedReferences({ equipment: { primaryWeaponId: "UNARMED" } }, db, { sentinels: ["UNARMED"] }), []);
}

group("A character's ids follow the editions that are loaded");
{
  // Two editions of one document print the same card under different ids. A character stores bare
  // ids with no record of which edition it was built against, so changing what's loaded has to
  // move them or the character loses its class and its gear.
  const ed = (name, records) => source(name, records);
  const both = mergeSources([
    ed("srd_1_0", { classes: [srcClass("srd_1_0_class_bard", "BARD")],
      weapons: [srcCard("srd_1_0_weapon_broadsword", "Broadsword"), srcCard("srd_1_0_weapon_gone", "Retired Blade")] }),
    ed("srd_2_0", { classes: [srcClass("srd_2_0_class_bard", "BARD")],
      weapons: [srcCard("srd_2_0_weapon_broadsword", "Broadsword")] }),
  ]).db;
  both.sourceNames = ["srd_1_0", "srd_2_0"];

  eq("a bare form names the record, whichever edition printed it",
    bareId("srd_2_0_weapon_broadsword", both.sourceNames), "weapon_broadsword");

  // THE REGRESSION THIS GUARDS. Both editions claim `weapon_broadsword`, so treating every shared
  // bare form as ambiguous refused to move ANY id — which is every id a character saved before the
  // rename has. A superseded record is not a rival claimant: the merge already picked the winner.
  const idx = indexRecordIds(both);
  eq("a shared bare form resolves to the edition that won the merge",
    idx.byBare.get("weapon_broadsword"), "srd_2_0_weapon_broadsword");
  eq("nothing is left ambiguous just because two editions print it",
    [...idx.byBare.values()].filter((v) => v === null).length, 0);

  const old = { classId: "core_class_bard", equipment: { primaryWeaponId: "core_weapon_broadsword" } };
  const moved = remapCharacterIds(old, both);
  eq("an id saved under a spelling no source uses any more is re-pointed",
    [moved.classId, moved.equipment.primaryWeaponId], ["srd_2_0_class_bard", "srd_2_0_weapon_broadsword"]);

  // The other half: an id that still resolves is a deliberate choice and is never touched. Picking
  // the SRD 1.0 weapon that SRD 2.0 dropped is the whole reason to have both editions on.
  const kept = remapCharacterIds({ equipment: { primaryWeaponId: "srd_1_0_weapon_gone" } }, both);
  eq("an id that still resolves is left exactly as it is",
    kept.equipment.primaryWeaponId, "srd_1_0_weapon_gone");
  const none = { classId: "srd_2_0_class_bard" };
  check("and a character needing no changes comes back as the same object",
    remapCharacterIds(none, both) === none);

  // Two UNRELATED sources claiming one bare form is still a genuine ambiguity, and still refused.
  const rival = mergeSources([
    ed("alpha", { weapons: [srcCard("alpha_weapon_x", "Alpha Blade")] }),
    ed("beta", { weapons: [srcCard("beta_weapon_x", "Beta Blade")] }),
  ]).db;
  rival.sourceNames = ["alpha", "beta"];
  eq("two unrelated sources claiming one bare form is left alone rather than guessed at",
    remapCharacterIds({ equipment: { armorId: "old_weapon_x" } }, rival).equipment.armorId, "old_weapon_x");

  // A player's answers are stored keyed BY id, so the keys have to move with the values.
  const answered = remapCharacterIds({ effectChoices: { "core_class_bard": { optionId: "a" } } }, both);
  eq("an id used as a field name moves too", Object.keys(answered.effectChoices), ["srd_2_0_class_bard"]);

  eq("and a bare form can be looked up directly, for the records the app names itself",
    resolveRecordId("weapon_broadsword", both), "srd_2_0_weapon_broadsword");
}

group("A transformation sits with the heritage, and both its halves print");
{
  // The SRD publishes six, and one is optional per character: the field is a single id or null,
  // not a list, and a character without one has nothing missing rather than something blank.
  const plain = deriveSheet(sheetChar(), SHEET_DB);
  eq("a character without one says nothing about it", plain.transformationName, null);
  eq("and contributes no features", plain.transformationFeatures, []);

  const changed = deriveSheet(sheetChar({ transformationId: "tf" }), SHEET_DB);
  eq("one with a transformation names it", changed.transformationName, "Werewolf");
  // Both, always: the drawback is not optional, and one the player forgets never happens at the
  // table. Unlike a mixed ancestry there is nothing to choose between them.
  eq("and prints BOTH features, benefit and drawback",
    changed.transformationFeatures.map((f) => f.name), ["Wolf Form", "Howling Rampage"]);
  eq("each attributed to the transformation that brought it",
    [...new Set(changed.transformationFeatures.map((f) => f.source))], ["Werewolf"]);
  eq("an id naming nothing loaded is simply absent, not a crash",
    deriveSheet(sheetChar({ transformationId: "gone" }), SHEET_DB).transformationName, null);
}

group("What a transformation does to the numbers, and what it deliberately doesn't");
{
  // Eleven of SRD 2.0's twelve transformation features are in-play actions, rest-and-fiction
  // rules, a death move, or a mechanic with no stat here — so they are read and left out, on the
  // same line every other entry in effects.js is drawn on. Demigod's Gifted is the exception.
  const TF_DB = {
    transformations: [
      { id: "srd_2_0_transformation_demigod", name: { "en-US": "Demigod" },
        features: [{ name: { "en-US": "Gifted" } }, { name: { "en-US": "Weight of Divinity" } }] },
      { id: "srd_2_0_transformation_werewolf", name: { "en-US": "Werewolf" },
        features: [{ name: { "en-US": "Wolf Form" } }, { name: { "en-US": "Howling Rampage" } }] },
    ],
    sourceNames: ["srd_2_0"],
  };
  const collect = (id) => collectEffects({ ...newCharacter(), transformationId: id }, TF_DB);

  const demigod = collect("srd_2_0_transformation_demigod");
  eq("Gifted is catalogued once, tagged as a transformation",
    demigod.map((e) => e.source), ["transformation"]);
  eq("a +1 to action rolls is the attack and Spellcast numbers the sheet prints",
    [demigod[0].effect.attack, demigod[0].effect.spellcast], [1, 1]);
  has("and the breakdown names the transformation it came from", [demigod[0].label], "Demigod");
  check("the damage half is excluded out loud rather than silently dropped",
    demigod[0].effect.excluded.some((x) => /damage/.test(x)));
  // Weight of Divinity costs a Stress when you fail a roll. That's play, not a total.
  eq("its drawback moves no number, so it gets no entry", demigod.length, 1);

  // Wolf Form's 1d10 is real, but you spend a Stress to enter it — the catalogue's line is
  // exactly "in effect right now given only what we store".
  eq("a transformation whose features are all in-play actions contributes nothing",
    collect("srd_2_0_transformation_werewolf"), []);
  eq("and no transformation at all contributes nothing", collect(null), []);
}

// ---------- report ----------

const results = document.getElementById("results");
let passed = 0;
let failed = 0;

for (const g of groups) {
  const section = document.createElement("div");
  section.className = "group";
  const h = document.createElement("h2");
  h.textContent = g.name;
  section.appendChild(h);

  for (const c of g.checks) {
    if (c.ok) passed++; else failed++;
    const row = document.createElement("div");
    row.className = "check " + (c.ok ? "pass" : "fail");
    const mark = document.createElement("span");
    mark.className = "mark";
    mark.textContent = c.ok ? "✓" : "✗";
    const label = document.createElement("span");
    label.textContent = c.label;
    row.append(mark, label);
    if (!c.ok && c.detail) {
      const detail = document.createElement("div");
      detail.className = "detail";
      detail.textContent = c.detail;
      row.appendChild(detail);
    }
    section.appendChild(row);
  }
  results.appendChild(section);
}

const summary = document.getElementById("summary");
summary.className = "summary " + (failed ? "bad" : "ok");
summary.textContent = failed
  ? `${failed} failed, ${passed} passed`
  : `All ${passed} checks passed`;
