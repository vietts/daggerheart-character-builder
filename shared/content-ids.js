// Where a stored character's ids go when the loaded editions change.
//
// A record's id names the document that published it, so the same card is
// `srd_1_0_domain_card_vitality` in one edition and `srd_2_0_domain_card_vitality` in the next.
// A character saved while only SRD 1.0 was selected therefore names ids that aren't loaded once
// the player adds SRD 2.0 and it takes precedence: the class resolves to nothing, the sheet
// prints dashes, the stat breakdown loses its rows — even though every one of those records is
// still right there under a different prefix.
//
// So before a character is used, ids that no longer resolve are re-pointed at the records that
// ARE loaded, matching on the part of the id after the document prefix.
//
// WHAT IT REFUSES TO DO
// ---------------------
// An id that still resolves is never touched — if both editions are loaded and the character
// names the SRD 1.0 weapon that SRD 2.0 dropped, that is a deliberate, valid choice and the
// whole reason a player would select both. Only a MISS is rewritten.
//
// A bare form claimed by more than one loaded record is left alone rather than guessed at, because
// picking one at random would silently change a character's gear.
//
// A record another source SUPERSEDED doesn't count as a rival claimant. Two editions of one
// document share a bare form for every record they both print — 532 of them — and treating those
// as ambiguous would refuse to move a single id, which is exactly the case this file exists for: a
// character saved under an older spelling (`core_weapon_broadsword`) when both editions are loaded.
// The merge has already decided which of the two a picker offers; this follows that decision rather
// than inventing a second one. Two UNRELATED sources claiming one bare form still collide, and are
// still left alone.
//
// The walk is by value rather than by field name: a character carries ids in a dozen places
// (equipment, loadout, vault, level-up picks) and an allowlist would go stale the first time a
// field was added. The guard is what makes that safe — a string is only
// rewritten when it fails to resolve AND exactly one loaded record claims its bare form, which no
// experience name or free-text field is going to do by accident.

/** `srd_2_0_weapon_longsword` -> `weapon_longsword`, given the loaded source names. */
export function bareId(id, sourceNames) {
  for (const name of sourceNames || []) {
    if (typeof id === "string" && id.startsWith(`${name}_`)) return id.slice(name.length + 1);
  }
  return id;
}

// Ids stored before a folder was renamed carry a prefix no loaded source answers to — every
// character saved while the data shipped as `core_weapon_longsword` names one. Those can't be
// stripped by source name, so the leading underscore-delimited tokens are peeled off one at a
// time instead and each result offered to the same uniqueness guard. Four is enough for the
// longest prefix anyone has shipped (`srd_1_0_`, `the_void_`) and stops well short of the token
// that carries the meaning.
const MAX_PREFIX_TOKENS = 4;

export function* bareForms(id, sourceNames) {
  const bare = bareId(id, sourceNames);
  yield bare;
  if (bare !== id) return; // a loaded source claimed it; don't go guessing further
  const parts = id.split("_");
  for (let n = 1; n <= Math.min(MAX_PREFIX_TOKENS, parts.length - 1); n += 1) {
    yield parts.slice(n).join("_");
  }
}

const COLLECTIONS = ["classes", "subclasses", "ancestries", "communities",
  "domainCards", "weapons", "armors", "consumables"];

/**
 * An index of what's loaded: every id, and the bare form -> the single id that claims it.
 * @returns {{ids: Set<string>, byBare: Map<string, string|null>}} null marks an ambiguous bare form.
 */
export function indexRecordIds(db) {
  const ids = new Set();
  const byBare = new Map();
  const names = db?.sourceNames || [];
  for (const key of COLLECTIONS) {
    for (const record of db?.[key] || []) {
      const id = record?.id;
      if (typeof id !== "string" || !id) continue;
      ids.add(id);
      // Every id is resolvable; only the winners get to claim a bare form.
      if (record.supersededBy) continue;
      const bare = bareId(id, names);
      byBare.set(bare, byBare.has(bare) && byBare.get(bare) !== id ? null : id);
    }
  }
  return { ids, byBare };
}

/**
 * A character with its unresolvable ids re-pointed at the loaded records. Returns the character
 * unchanged (the same object) when nothing needed moving, so a caller can skip a rewrite.
 */
export function remapCharacterIds(character, db) {
  const index = indexRecordIds(db);
  if (!index.ids.size) return character;
  const names = db?.sourceNames || [];
  let moved = 0;

  const walk = (value) => {
    if (typeof value === "string") {
      if (index.ids.has(value)) return value;
      for (const form of bareForms(value, names)) {
        const to = index.byBare.get(form);
        if (to) { moved += 1; return to; }
      }
      return value;
    }
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === "object") {
      const out = {};
      // Keys as well as values: a character's answers to the cards that ask something are stored
      // as `effectChoices[<card id>]`, so an id can be the name of a field rather than its
      // contents. Same guard either way, so a key that isn't an id is left exactly as it is.
      for (const [k, v] of Object.entries(value)) out[walk(k)] = walk(v);
      return out;
    }
    return value;
  };

  const next = walk(character);
  return moved ? next : character;
}

/** The same, for a roster. */
export function remapCharacterListIds(characters, db) {
  return (characters || []).map((ch) => remapCharacterIds(ch, db));
}

/**
 * The loaded id for a bare form — `consumable_minor_health_potion` -> whichever edition supplied
 * it. For the two starting potions, which the app names itself rather than reading from a record.
 */
export function resolveRecordId(bare, db) {
  return indexRecordIds(db).byBare.get(bare) || null;
}
