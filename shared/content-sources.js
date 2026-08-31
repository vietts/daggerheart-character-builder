// Merging several bodies of content into the one `db` the pages read.
//
// `data/` used to hold exactly one body of content: the SRD re-export. It now holds a folder per
// SOURCE — `data/srd_1_0/` and `data/srd_2_0/` plus whatever else exists — and the folder's name IS
// its category. Nothing here knows the name of any source but the SRD's; a category exists because
// a folder does.
//
// Everything found on disk is always loaded and always looked up, so an id never dangles. The
// enabled/disabled toggles filter the PICKER LISTS only (visibleRecords below). That split is the
// whole design: a character stores bare ids with no provenance, so if a switched-off source
// stopped loading, a character built on it would come back full of holes.
//
// This file is pure — no fetch, no DOM, no storage. It takes payloads that have already been
// read and returns the merged result, which is what makes the merge rules testable in
// tests/tests.js the same way every other rule in this app is.

import { EFFECT_STAT_KEYS } from "./effects.js";

// Filename under a source folder -> the key it lands on in `db`. The single statement of that
// mapping; pages that want fewer files pass a subset of these keys.
//
// items.json is deliberately absent: it ships in the SRD folders, is fetched by nothing, and the
// SRD's own source.json doesn't list it either.
//
// transformations.json is absent for a different reason. SRD 2.0 publishes six transformations and
// data/srd_2_0/ carries them, so its source.json names the file — but a name this map doesn't know
// is ignored (parseSourceInfo), and no screen reads one yet, so they sit unread rather than
// half-wired. A file becomes readable by gaining an entry here, at the same time as the code that
// knows what to do with it.
export const CONTENT_FILES = {
  classes: "classes",
  subclasses: "subclasses",
  ancestries: "ancestries",
  communities: "communities",
  "domain-cards": "domainCards",
  weapons: "weapons",
  armors: "armors",
  consumables: "consumables",
};

// The edition loaded when the manifest can't be read at all. The newest SRD, so a broken manifest
// leaves the app on current rules rather than a superseded printing.
export const SRD_SOURCE = "srd_2_0";

// Each folder name is interpolated straight into a fetch URL, so anything that could climb out of
// data/ is dropped rather than escaped.
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

// A manifest is either the plain list of folders, or that list plus a flag:
//
//   ["srd"]                                just the folders
//   { "sources": ["srd"], "local": true }  the folders, and "also read sources.local.json"
//
// Both shapes are accepted everywhere, because the plain list is the one anybody would write and
// the object only exists to carry the flag.
function manifestList(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object" && Array.isArray(parsed.sources)) return parsed.sources;
  return null;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * A manifest file's contents -> the folder names it names.
 * Absent, empty or malformed input is not an error: it yields no names, and the caller decides
 * what to do about that (content-load.js falls back to [SRD_SOURCE], so a broken manifest can
 * never leave the app with nothing).
 */
export function parseManifest(text) {
  const list = manifestList(parseJson(text));
  if (!list) return [];
  return list.filter((name) => typeof name === "string" && SAFE_NAME.test(name));
}

/**
 * Does the tracked manifest ask for data/sources.local.json to be read as well?
 *
 * OPT-IN, and that is the whole point. Looking for that file unconditionally meant a 404 on every
 * page for everyone who had never made one — which is nearly everyone, since it is gitignored and
 * exists only if you went out of your way to create it. Off by default, the file costs a fetch
 * only for the people who have one, and they have one, so it never 404s for them either.
 */
export function readsLocalManifest(text) {
  const value = parseJson(text);
  return !Array.isArray(value) && value?.local === true;
}

/** Manifests in precedence order, flattened. First occurrence of a name fixes its position. */
export function combineManifests(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const name of list || []) {
      if (seen.has(name)) continue;
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

// ---------- what a source folder says about itself ----------

/**
 * A source.json -> { label, files }. Returns null if the file is unusable, which the caller
 * reports and treats as "skip this source" rather than guessing at what the folder holds.
 */
export function parseSourceInfo(text, name) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  if (!Array.isArray(parsed.files)) return null;
  const files = parsed.files.filter((f) => typeof f === "string" && (f === "effects" || f in CONTENT_FILES));
  const label = typeof parsed.label === "string" && parsed.label.trim() ? parsed.label.trim() : name;
  return { name, label, files };
}

// ---------- normalization ----------
//
// classes.json is the only file whose top-level `name` is a bare uppercase string ("BARD"); every
// other file uses {"en-US": ...}, and classes.json itself uses the localized shape for
// hopeFeature.name and classItems. That isn't an oversight upstream: a class name is a RELATIONAL
// KEY — subclasses[].class holds "BARD" and create.js joins on it — not a label.
//
// So the most natural authoring mistake is writing a class in the shape of its neighbours. Rather
// than diverge from the data re-export or push the shape onto every consumer, the loader accepts
// both and coerces each to the shape that file's readers expect.

function localizedName(value) {
  if (typeof value === "string") return { "en-US": value };
  return value;
}

function classNameString(value) {
  if (typeof value === "string") return value.toUpperCase();
  const text = value?.["en-US"];
  return typeof text === "string" ? text.toUpperCase() : value;
}

/** A record as the rest of the app expects it. Never mutates its input. */
export function normalizeRecord(kind, record) {
  if (!record || typeof record !== "object") return record;
  if (kind === "classes") return { ...record, name: classNameString(record.name) };
  return { ...record, name: localizedName(record.name) };
}

// ---------- validation ----------
//
// Only the fields whose absence makes a record UNUSABLE — the ones a renderer reads without
// checking, so a missing one is a dead page rather than a missing card. Everything else is left
// alone: this is a guard against a hand-written file killing a screen, not a second definition of
// the data format to keep in step with the real one.
//
// Note what is NOT checked: a domain nobody has heard of is fine. A source may well add one, and
// rejecting unknown ones would block the very case this feature exists to anticipate.

const REQUIRED = {
  classes: (r) => {
    if (typeof r.name !== "string" || !r.name) return "missing: name";
    if (!Array.isArray(r.domains)) return "missing: domains";
    return null;
  },
  subclasses: (r) => {
    if (!r.name?.["en-US"]) return "missing: name";
    if (typeof r.class !== "string" || !r.class) return "missing: class (the class name, uppercase)";
    return null;
  },
  "domain-cards": (r) => {
    if (!r.name?.["en-US"]) return "missing: name";
    if (typeof r.domain !== "string" || !r.domain) return "missing: domain";
    return null;
  },
};

const NAME_ONLY = (r) => (r.name?.["en-US"] ? null : "missing: name");

/** null if the record is usable, else a short sentence naming what's wrong with it. */
export function validateRecord(kind, record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return "not a record";
  if (typeof record.id !== "string" || !record.id) return "missing: id";
  return (REQUIRED[kind] || NAME_ONLY)(record);
}

// ---------- effects declared by a source ----------
//
// shared/effects.js is hand-maintained and can hold functions and predicates. A source's
// effects.json is JSON, so it holds the declarative subset — the stat numbers, `permanent`
// (without which a card whose text says the bonus is permanent silently stops applying the moment
// it goes to the vault), `feature`, `excluded`, and a whole `choice` block, which
// shared/effect-choice.js renders with no page code at all.
//
// `when` is rejected rather than ignored: JSON cannot carry a predicate, and silently dropping a
// condition would make a bonus apply when it shouldn't.
//
// The whitelist is deliberately no wider than what shared/effects.js already understands. A key
// this app has no code for would validate, ship, and do nothing — which is worse than a source
// being told plainly that the mechanic doesn't exist yet.

const CHOICE_KINDS = new Set(["benefit", "experience"]);
const STAT_KEYS = new Set(EFFECT_STAT_KEYS);
const ALLOWED_EFFECT_KEYS = new Set([...EFFECT_STAT_KEYS, "permanent", "feature", "excluded", "choice"]);

function statEntries(obj, where) {
  for (const [key, value] of Object.entries(obj)) {
    if (!STAT_KEYS.has(key)) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) return `${where}: ${key} must be a number`;
  }
  return null;
}

function validateChoice(choice) {
  if (!choice || typeof choice !== "object" || Array.isArray(choice)) return "choice must be an object";
  if (typeof choice.prompt !== "string" || !choice.prompt) return "choice: missing prompt";
  // effect-choice.js renders anything that isn't "benefit" as an Experience picker rather than
  // failing, so an unrecognised kind would silently ask the wrong question.
  if (!CHOICE_KINDS.has(choice.kind)) return `choice: kind must be "benefit" or "experience"`;
  if (!Array.isArray(choice.options) || choice.options.length === 0) return "choice: missing options";
  if (choice.kind === "benefit" && (typeof choice.pick !== "number" || choice.pick < 1)) {
    return "choice: benefit needs a numeric pick";
  }
  for (const option of choice.options) {
    if (!option || typeof option !== "object") return "choice: an option isn't an object";
    if (typeof option.id !== "string" || !option.id) return "choice: an option has no id";
    if (typeof option.label !== "string" || !option.label) return "choice: an option has no label";
    if (choice.kind === "benefit") {
      const bad = statEntries(option, `choice option "${option.id}"`);
      if (bad) return bad;
    } else if (typeof option.pick !== "number" || typeof option.bonus !== "number") {
      return `choice option "${option.id}": experience options need numeric pick and bonus`;
    }
  }
  return null;
}

/** null if the entry is usable, else a short sentence naming what's wrong with it. */
export function validateEffectEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return "not an effect";
  for (const key of Object.keys(entry)) {
    if (!ALLOWED_EFFECT_KEYS.has(key)) {
      return key === "when"
        ? "`when` needs a function, which JSON can't carry — leave it out or state the bonus unconditionally"
        : `unknown key: ${key}`;
    }
  }
  const bad = statEntries(entry, "value");
  if (bad) return bad;
  if ("permanent" in entry && typeof entry.permanent !== "boolean") return "permanent must be true or false";
  if ("feature" in entry && typeof entry.feature !== "string") return "feature must be a string";
  if ("excluded" in entry && !(Array.isArray(entry.excluded) && entry.excluded.every((x) => typeof x === "string"))) {
    return "excluded must be a list of sentences";
  }
  if ("choice" in entry) return validateChoice(entry.choice);
  return null;
}

// ---------- the merge ----------

// What makes two records from different sources the SAME record.
//
// A source that comes later in the manifest revises what an earlier one said, and it does that by
// id when it reprints a record verbatim and by NAME when it doesn't share the earlier one's ids.
//
// Name mattered only for classes while the sources sharing content shared their ids too — a class's
// real key is its uppercase name rather than its id, because create.js joins subclasses to classes
// with `s.class === cls.name.toUpperCase()`, the one relational join in this app that isn't by id.
// It matters for every kind now that the SRD ships one folder per edition: an id names the document
// it came from, so SRD 2.0's Vitality is a different STRING from SRD 1.0's Vitality and only the
// name says they are one card. Without this, selecting both editions lists every shared card,
// weapon, armor and potion twice — 420 domain cards where there are 231.
//
// A subclass is qualified by its class: subclass names are only unique within a class, and a
// homebrew Bard subclass called "Wayfinder" must not silently replace the Ranger's.
const nameKeyFor = (kind, record) => {
  if (kind === "classes") return String(record.name).toUpperCase();
  const name = record?.name?.["en-US"];
  if (typeof name !== "string" || !name) return null;
  const key = name.trim().toLowerCase();
  return kind === "subclasses" ? `${String(record.class || "").toUpperCase()}\u0000${key}` : key;
};

/**
 * @param {Array<{name, label, records, effects}>} sources in precedence order — srd first, then
 *   whatever the manifest names. Later wins.
 * @returns {{db, effects, report}}
 */
export function mergeSources(sources) {
  const db = {};
  const effects = {};
  const report = { sources: [], collisions: [], effectIssues: [] };

  for (const key of Object.values(CONTENT_FILES)) db[key] = [];

  for (const source of sources) {
    const entry = { name: source.name, label: source.label || source.name, counts: {}, skipped: [] };
    report.sources.push(entry);

    for (const [file, dbKey] of Object.entries(CONTENT_FILES)) {
      const incoming = source.records?.[file];
      if (!Array.isArray(incoming)) continue;

      const list = db[dbKey];
      const byId = new Map(list.map((r, i) => [r.id, i]));
      const byName = new Map(list.map((r, i) => [nameKeyFor(file, r), i]).filter(([k]) => k !== null));
      // What this source CONTRIBUTED, whether it added a record or revised one: the panel's
      // "my-homebrew — 11 cards" should say what the folder holds, not how much happened to be new.
      let merged = 0;

      for (const raw of incoming) {
        const record = normalizeRecord(file, raw);
        const problem = validateRecord(file, record);
        if (problem) {
          entry.skipped.push({ file, id: raw?.id || "(no id)", reason: problem });
          continue;
        }
        const tagged = { ...record, contentSource: source.name };
        const nameKey = nameKeyFor(file, tagged);
        // Replace IN PLACE so a revision keeps the position the original held.
        const at = byId.has(tagged.id) ? byId.get(tagged.id)
          : (nameKey !== null && byName.has(nameKey) ? byName.get(nameKey) : -1);
        if (at >= 0) {
          const over = list[at];
          if (over.contentSource !== source.name) {
            report.collisions.push({
              file, id: tagged.id, from: source.name, over: over.contentSource,
              byName: !byId.has(tagged.id),
            });
            // KEEP the record that was taken over, marked with what took it, so switching the
            // superseding source off leaves the earlier one to fall back to rather than an empty
            // picker. It also keeps a character built on either id resolving. visibleRecords()
            // decides which one a picker offers.
            byId.set(over.id, list.length);
            list.push({ ...over, supersededBy: tagged.id });
          }
          list[at] = tagged;
          byId.set(tagged.id, at);
        } else {
          byId.set(tagged.id, list.length);
          if (nameKey !== null) byName.set(nameKey, list.length);
          list.push(tagged);
        }
        merged += 1;
      }
      entry.counts[dbKey] = (entry.counts[dbKey] || 0) + merged;
    }

    for (const [key, value] of Object.entries(source.effects || {})) {
      const problem = validateEffectEntry(value);
      if (problem) {
        report.effectIssues.push({ source: source.name, key, reason: problem });
        continue;
      }
      effects[key] = value;
    }
  }

  // Every record's id begins with the name of the document that published it
  // (srd_1_0_domain_card_vitality). An effect belongs to the CARD, not to the edition that printed
  // it, so effects.js is keyed without that prefix and a card found in either edition reaches the
  // same entry. Collected here because this is the only place that knows every source name;
  // shared/content-ids.js does the stripping.
  db.sourceNames = sources.map((s) => s.name);

  return { db, effects, report };
}

// ---------- what the pickers show ----------

/**
 * The subset of a collection a picker may offer. Records tagged with a switched-off source are
 * dropped; UNTAGGED RECORDS ARE ALWAYS KEPT, so every hand-written fixture in tests/tests.js and
 * every db assembled by something that doesn't know about sources keeps working unchanged.
 */
export function visibleRecords(list, disabled) {
  const kept = !disabled || disabled.size === 0
    ? (list || [])
    : (list || []).filter((r) => !r.contentSource || !disabled.has(r.contentSource));
  // A record that another source took over is in the list so it can come BACK: with the source
  // that superseded it switched off, it is once again the only version there is. So it's hidden
  // only while the record that beat it is itself visible — which is also why this runs even when
  // nothing is switched off.
  //
  // "Another record with that id", not "that id is present": a source that reprints a record
  // under the SAME id leaves two entries sharing one id, and asking only whether the id is there
  // would have every superseded record answer yes about itself and vanish. Identity is the test.
  if (!kept.some((r) => r.supersededBy)) return kept;
  const byId = new Map();
  for (const r of kept) {
    const bucket = byId.get(r.id);
    if (bucket) bucket.push(r); else byId.set(r.id, [r]);
  }
  return kept.filter((r) =>
    !r.supersededBy || !(byId.get(r.supersededBy) || []).some((other) => other !== r));
}

// ---------- content a character refers to but this browser doesn't have ----------
//
// Renaming a source folder, editing a manifest, or opening a character saved in a browser with
// different content all produce the same state: stored ids that resolve to nothing. The app is
// deliberately quiet about missing data — derivedStats() returns null rather than throwing — so
// without this a character built on a folder you renamed prints a sheet headed "Class" with
// quietly wrong numbers.
//
// Cards taken at a level up are already reported by validateLevelUps() in shared/history.js
// ("that card no longer exists"), so they're left out here rather than counted twice.

const has = (list, id) => (list || []).some((r) => r.id === id);

/**
 * @param {object} opts.sentinels stored values with no record behind them (unarmed, unarmored).
 */
export function unresolvedReferences(ch, db, { sentinels = [] } = {}) {
  const out = [];
  const check = (kind, id, list) => {
    if (!id || sentinels.includes(id)) return;
    if (!has(list, id)) out.push({ kind, id });
  };

  check("class", ch?.classId, db?.classes);
  check("subclass", ch?.subclassId, db?.subclasses);
  for (const id of ch?.heritage?.ancestryIds || []) check("ancestry", id, db?.ancestries);
  check("community", ch?.heritage?.communityId, db?.communities);
  check("weapon", ch?.equipment?.primaryWeaponId, db?.weapons);
  check("weapon", ch?.equipment?.secondaryWeaponId, db?.weapons);
  check("armor", ch?.equipment?.armorId, db?.armors);
  for (const id of ch?.creationDomainCardIds || []) check("domain card", id, db?.domainCards);

  return out;
}
