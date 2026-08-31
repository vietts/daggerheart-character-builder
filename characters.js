import {
  renderCardArt,
  domainCardArtPath,
  subclassCardArtPath,
  communityCardArtPath,
  ancestryCardArtPath,
} from "./shared/card-render.js";
import {
  ADVANCEMENT_LABELS,
  SLOT_TIERS,
  SUBCLASS_TIER_LABELS,
  activeDomainCardIds,
  availableOptionKeys,
  ensureLevelFields,
  extraCardLevelCap,
  slotsInTier,
  slotsPerPick,
  subclassTiersUpTo,
  tierForLevel,
} from "./shared/advancement.js";
import { encodePortrait } from "./shared/portrait.js";
import {
  describeCards,
  describeLevelUp,
  recomputeCharacter,
  unresolvedProblems,
  validateLevelUps,
} from "./shared/history.js";
import { UNARMED_PROFILE, derivedStats } from "./shared/derived-stats.js";
import { statLine } from "./shared/stat-line.js";
import { ignoresBurden, unresolvedChoices } from "./shared/effects.js";
import { UNARMED, UNARMORED, armorStats, burdenWarning, featureLine, weaponStats } from "./shared/gear.js";
import { loadContent } from "./shared/content-load.js";
import { mountContentSettings } from "./shared/content-settings.js";
import { unresolvedReferences } from "./shared/content-sources.js";
import { escapeHtml } from "./shared/escape.js";
import { exportFileName, importConflicts, mergeImported, parseImport, serializeCharacters } from "./shared/transfer.js";

const signed = (n) => (n > 0 ? `+${n}` : String(n));

const CHAR_STORAGE_KEY = "dh-characters-v1";
const UNDO_STORAGE_KEY = "dh-level-edit-undo-v1";
const TRAIT_LABELS = { agility: "Agility", strength: "Strength", finesse: "Finesse", instinct: "Instinct", presence: "Presence", knowledge: "Knowledge" };
const CIRCLED = ["", "①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];

const db = {};
let characters = [];
let openId = null; // id of the character open in detail view, null = list view
let pendingDeleteId = null; // id awaiting delete confirmation (inline confirm, never window.confirm)
let pendingRemoveLevel = null; // level awaiting remove confirmation, same inline pattern
let historyOpen = false; // keeps the level history accordion open across re-renders

function titleCase(str) {
  return str.charAt(0) + str.slice(1).toLowerCase();
}

// What loadContent() reported: which sources loaded, and which of them are switched off.
let content = null;

async function loadAllData() {
  content = await loadContent();
  Object.assign(db, content.db);
}

// Ids a character stores that this browser can't resolve. Sentinels are stored values with no
// record behind them, so they aren't missing content.
const missingContent = (ch) => unresolvedReferences(ch, db, { sentinels: [UNARMED, UNARMORED] });

function loadCharacters() {
  try {
    const raw = localStorage.getItem(CHAR_STORAGE_KEY);
    characters = raw ? JSON.parse(raw).map(ensureLevelFields) : [];
  } catch {
    characters = [];
  }
}

function saveCharacters() {
  localStorage.setItem(CHAR_STORAGE_KEY, JSON.stringify(characters));
}

// Re-read, patch one character's portrait, write back — the same care play.js takes with the
// marked boxes, for the same reason: the play page may have written since this list was loaded,
// and the portrait is a new reason to come back here mid-session. Returns false when nothing was
// written, so the caller can put its own copy back instead of showing a portrait that isn't saved.
function savePortrait(id, portrait) {
  let list;
  try {
    const raw = localStorage.getItem(CHAR_STORAGE_KEY);
    list = raw ? JSON.parse(raw) : [];
  } catch {
    return false;
  }
  const target = list.find((c) => c.id === id);
  if (!target) return false;
  if (portrait) target.portrait = portrait; else delete target.portrait;
  localStorage.setItem(CHAR_STORAGE_KEY, JSON.stringify(list));
  // What's on disk is now ahead of what this page loaded; the next saveCharacters() would write
  // the stale copy back over it.
  loadCharacters();
  return true;
}

function findClass(id) { return db.classes.find((c) => c.id === id); }
function findSubclass(id) { return db.subclasses.find((s) => s.id === id); }
function findAncestry(id) { return db.ancestries.find((a) => a.id === id); }
function findCommunity(id) { return db.communities.find((c) => c.id === id); }
function findDomainCard(id) { return db.domainCards.find((c) => c.id === id); }
function findWeapon(id) { return db.weapons.find((w) => w.id === id); }
function findArmor(id) { return db.armors.find((a) => a.id === id); }
function findConsumable(id) { return db.consumables.find((c) => c.id === id); }

function isComplete(ch) {
  const cls = findClass(ch.classId);
  const hasHeritage = ch.heritage.communityId && ch.heritage.ancestryIds.length > 0;
  const hasTraits = Object.values(ch.traits).every((v) => v !== null);
  const hasEquip = ch.equipment.armorId && ch.equipment.potionChoice && ch.equipment.primaryWeaponId;
  const hasExp = ch.experiences.every((e) => e.name.trim());
  const hasCards = ch.domainCardIds.length >= 2;
  return !!(cls && ch.subclassId && hasHeritage && hasTraits && hasEquip && hasExp && hasCards);
}

function renderList() {
  const container = document.getElementById("characters-list");
  container.innerHTML = "";

  if (characters.length === 0) {
    container.innerHTML = `<p class="hint">No characters saved yet. <a href="create.html">Create one</a>.</p>`;
    return;
  }

  for (const ch of characters) {
    const cls = findClass(ch.classId);
    const sub = findSubclass(ch.subclassId);
    const complete = isComplete(ch);

    const row = document.createElement("div");
    row.className = "character-row" + (complete ? "" : " draft");

    const actionsHtml = pendingDeleteId === ch.id
      ? `
        <span class="confirm-text">Delete permanently?</span>
        <button class="btn-small btn-danger" data-action="confirm-delete">Yes, delete</button>
        <button class="btn-small" data-action="cancel-delete">Cancel</button>
      `
      : `
        <button class="btn-small" data-action="view">Sheet</button>
        <a class="btn-small" href="play.html?id=${encodeURIComponent(ch.id)}">Play</a>
        <a class="btn-small" href="sheet.html?id=${encodeURIComponent(ch.id)}">Print sheet</a>
        <button class="btn-small" data-action="edit">Edit</button>
        <button class="btn-small" data-action="export">Export</button>
        <button class="btn-small btn-danger" data-action="delete">Delete</button>
      `;

    row.innerHTML = `
      <div class="character-row-main">
        <strong>${escapeHtml(ch.name || "(unnamed)")}</strong>
        <span>Lv ${escapeHtml(ch.level)} · ${cls ? escapeHtml(titleCase(cls.name)) : "—"}${sub ? " · " + escapeHtml(sub.name["en-US"]) : ""}</span>
        ${complete ? "" : '<span class="badge-draft">draft</span>'}
      </div>
      <div class="character-row-actions">${actionsHtml}</div>
    `;
    if (pendingDeleteId === ch.id) {
      row.querySelector('[data-action="confirm-delete"]').addEventListener("click", () => {
        characters = characters.filter((c) => c.id !== ch.id);
        saveCharacters();
        pendingDeleteId = null;
        renderAll();
      });
      row.querySelector('[data-action="cancel-delete"]').addEventListener("click", () => {
        pendingDeleteId = null;
        renderAll();
      });
    } else {
      row.querySelector('[data-action="view"]').addEventListener("click", () => { openId = ch.id; renderAll(); });
      row.querySelector('[data-action="edit"]').addEventListener("click", () => { location.href = `create.html?id=${ch.id}`; });
      row.querySelector('[data-action="export"]').addEventListener("click", () => exportJson([ch]));
      row.querySelector('[data-action="delete"]').addEventListener("click", () => {
        pendingDeleteId = ch.id;
        renderAll();
      });
    }
    container.appendChild(row);
  }
}

function cardBlock(card, caption) {
  const wrap = document.createElement("div");
  wrap.className = "card-tile";
  wrap.appendChild(renderCardArt(card));
  const label = document.createElement("div");
  label.className = "card-tile-label";
  label.textContent = caption || card.name;
  wrap.appendChild(label);
  return wrap;
}

// ---------- level history ----------

// The advancement grid as a read-only summary, with the level that marked each slot
// written into it — the same layout as the level up screen and the printed sheet, so the
// whole slot economy (and what's still free) reads at a glance.
function renderHistoryGrid(ch) {
  const markedAt = {}; // key -> tier -> [levels]
  for (const entry of ch.levelUps || []) {
    for (const pick of entry.picks || []) {
      const perTier = (markedAt[pick.key] ||= {});
      const list = (perTier[pick.slotTier] ||= []);
      for (let i = 0; i < slotsPerPick(pick.key); i++) list.push(entry.level);
    }
  }

  const maxTier = tierForLevel(ch.level);
  const tiers = SLOT_TIERS.filter((t) => t <= maxTier);
  const grid = document.createElement("div");
  grid.className = "advancement-grid history-grid";

  const head = document.createElement("div");
  head.className = "adv-row adv-head";
  head.appendChild(labelSpan(""));
  for (const tier of tiers) {
    const cell = document.createElement("span");
    cell.className = "adv-tier-group";
    cell.textContent = `Tier ${tier}`;
    head.appendChild(cell);
  }
  grid.appendChild(head);

  for (const key of availableOptionKeys(ch.level)) {
    const row = document.createElement("div");
    row.className = "adv-row";
    const label = key === "domainCard"
      ? `Extra domain card (${tiers.map((t) => `≤${extraCardLevelCap(10, t)}`).join(" / ")})`
      : ADVANCEMENT_LABELS[key];
    row.appendChild(labelSpan(label));

    for (const tier of tiers) {
      const cell = document.createElement("span");
      cell.className = "adv-tier-group";
      const total = slotsInTier(key, tier);
      if (total === 0) {
        cell.textContent = "—";
        cell.classList.add("adv-tier-empty");
        row.appendChild(cell);
        continue;
      }
      // Slots marked before recording started have no level to show, so they read as a
      // plain filled box rather than pretending to a level they can't know.
      const levels = markedAt[key]?.[tier] || [];
      const unattributed = Math.max(0, (ch.baseline?.slotsUsed?.[key]?.[tier] || 0));
      for (let i = 0; i < total; i++) {
        const box = document.createElement("span");
        box.className = "slot-box";
        if (i < unattributed) {
          box.classList.add("filled");
          box.title = "Marked before level history was recorded";
        } else if (i - unattributed < levels.length) {
          const lv = levels[i - unattributed];
          box.classList.add("filled", "numbered");
          box.textContent = CIRCLED[lv] || lv;
          box.title = `Marked at level ${lv}`;
        } else {
          box.classList.add("open");
        }
        cell.appendChild(box);
      }
      row.appendChild(cell);
    }
    grid.appendChild(row);
  }
  return grid;
}

function labelSpan(text) {
  const span = document.createElement("span");
  span.className = "adv-label";
  span.textContent = text;
  return span;
}

function levelHistoryRow(ch, entry, problem, isLast) {
  const row = document.createElement("div");
  row.className = "level-row" + (problem && !problem.accepted ? " flagged" : "");

  const main = document.createElement("div");
  main.className = "level-row-main";
  const parts = describeLevelUp(ch, entry, db);
  const cards = describeCards(ch, entry, db);
  const flag = problem && !problem.accepted ? "⚠ " : "";
  const accepted = entry.acceptedAsIs ? ` <span class="level-accepted">✓ kept as is</span>` : "";
  main.innerHTML = `<strong>L${escapeHtml(entry.level)}</strong> ${escapeHtml(flag)}${escapeHtml(parts.join(" · ") || "(nothing recorded)")}${accepted}` +
    cards.map((c) => `<div class="level-row-sub">${escapeHtml(c)}</div>`).join("");
  if (problem) {
    for (const err of problem.errors) {
      main.innerHTML += `<div class="level-row-error">└ ${escapeHtml(err)}</div>`;
    }
  }
  row.appendChild(main);

  const actions = document.createElement("div");
  actions.className = "level-row-actions";

  if (pendingRemoveLevel === entry.level) {
    const text = document.createElement("span");
    text.className = "confirm-text";
    text.textContent = `Remove level ${entry.level}? Stats go back to level ${entry.level - 1}.`;
    actions.appendChild(text);
    actions.appendChild(button("Yes, remove", "btn-danger btn-small", () => removeLevel(ch, entry.level)));
    actions.appendChild(button("Cancel", "btn-ghost btn-small", () => { pendingRemoveLevel = null; renderAll(); }));
  } else {
    const edit = document.createElement("a");
    edit.className = "btn-small";
    edit.href = `level-up.html?id=${ch.id}&level=${entry.level}`;
    edit.textContent = problem && !problem.accepted ? "Fix" : "Edit";
    actions.appendChild(edit);

    if (problem && !problem.accepted) {
      actions.appendChild(button("Keep as is", "btn-ghost btn-small", () => {
        entry.acceptedAsIs = true;
        saveCharacters();
        renderAll();
      }));
    }
    if (isLast) {
      actions.appendChild(button("Remove", "btn-ghost btn-small", () => { pendingRemoveLevel = entry.level; renderAll(); }));
    }
  }
  row.appendChild(actions);
  return row;
}

function button(label, className, onClick) {
  const b = document.createElement("button");
  b.className = className;
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

function renderLevelHistory(container, ch) {
  const entries = [...(ch.levelUps || [])].sort((a, b) => a.level - b.level);
  const problems = validateLevelUps(ch, db);
  const problemFor = (level) => problems.find((p) => p.level === level);
  const unresolved = problems.filter((p) => !p.accepted).length;

  const details = document.createElement("details");
  details.className = "level-history";
  details.open = historyOpen;
  details.addEventListener("toggle", () => { historyOpen = details.open; });

  const summary = document.createElement("summary");
  const count = entries.length;
  summary.textContent = `Level history (${count} recorded level${count === 1 ? "" : "s"})` +
    (unresolved ? ` · ⚠ ${unresolved} need${unresolved === 1 ? "s" : ""} attention` : "");
  details.appendChild(summary);

  if (ch.level > 1) details.appendChild(renderHistoryGrid(ch));

  const list = document.createElement("div");
  list.className = "level-list";

  // Levels reached before choices were recorded can't be broken down, so they're one row
  // that says so rather than rows guessing at what was picked.
  if (ch.baselineLevel > 1) {
    const row = document.createElement("div");
    row.className = "level-row";
    row.innerHTML = `<div class="level-row-main"><strong>L1–${escapeHtml(ch.baselineLevel)}</strong> <span class="hint">reached before level history was recorded, so these choices can't be changed</span></div>`;
    list.appendChild(row);
  } else {
    const row = document.createElement("div");
    row.className = "level-row";
    row.innerHTML = `<div class="level-row-main"><strong>L1</strong> Character creation</div>`;
    const actions = document.createElement("div");
    actions.className = "level-row-actions";
    const edit = document.createElement("a");
    edit.className = "btn-small";
    edit.href = `create.html?id=${ch.id}`;
    edit.textContent = "Edit";
    actions.appendChild(edit);
    row.appendChild(actions);
    list.appendChild(row);
  }

  entries.forEach((entry, i) => {
    list.appendChild(levelHistoryRow(ch, entry, problemFor(entry.level), i === entries.length - 1));
  });

  if (entries.length === 0 && ch.baselineLevel > 1) {
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = "Levels gained from now on will be recorded here and can be changed afterwards.";
    list.appendChild(hint);
  }

  details.appendChild(list);

  if (loadUndo(ch.id)) {
    const undoRow = document.createElement("div");
    undoRow.className = "level-undo";
    undoRow.appendChild(button("Undo last level edit", "btn-ghost btn-small", () => undoLastEdit(ch)));
    details.appendChild(undoRow);
  }

  container.appendChild(details);
}

function removeLevel(ch, level) {
  saveUndo(ch);
  ch.levelUps = (ch.levelUps || []).filter((e) => e.level !== level);
  ch.experiences = (ch.experiences || []).filter((e) => e.sinceLevel < level);
  ch.level = level - 1;
  recomputeCharacter(ch);
  ch.updatedAt = new Date().toISOString();
  pendingRemoveLevel = null;
  saveCharacters();
  renderAll();
}

// A single undo slot, so a cascade of fixes can be walked back one step. It holds only the
// recorded truth: the derived stats come back from replaying it.
function saveUndo(ch) {
  const snapshot = {
    id: ch.id,
    at: new Date().toISOString(),
    levelUps: JSON.parse(JSON.stringify(ch.levelUps || [])),
    experiences: JSON.parse(JSON.stringify(ch.experiences || [])),
    level: ch.level,
    baseline: JSON.parse(JSON.stringify(ch.baseline)),
    baselineLevel: ch.baselineLevel,
    creationDomainCardIds: [...(ch.creationDomainCardIds || [])],
    domainVaultIds: [...(ch.domainVaultIds || [])],
  };
  try {
    localStorage.setItem(UNDO_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // storage full or unavailable: undo is a convenience, never block the edit for it
  }
}

function loadUndo(charId) {
  try {
    const raw = localStorage.getItem(UNDO_STORAGE_KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw);
    return snap && snap.id === charId ? snap : null;
  } catch {
    return null;
  }
}

function undoLastEdit(ch) {
  const snap = loadUndo(ch.id);
  if (!snap) return;
  ch.levelUps = snap.levelUps;
  ch.experiences = snap.experiences;
  ch.level = snap.level;
  ch.baseline = snap.baseline;
  ch.baselineLevel = snap.baselineLevel;
  ch.creationDomainCardIds = snap.creationDomainCardIds;
  ch.domainVaultIds = snap.domainVaultIds;
  recomputeCharacter(ch);
  ch.updatedAt = new Date().toISOString();
  localStorage.removeItem(UNDO_STORAGE_KEY);
  saveCharacters();
  renderAll();
}

function renderDetail() {
  const ch = characters.find((c) => c.id === openId);
  const container = document.getElementById("character-detail");
  if (!ch) {
    container.innerHTML = "";
    container.style.display = "none";
    return;
  }
  container.style.display = "block";
  container.innerHTML = "";

  const closeBtn = document.createElement("button");
  closeBtn.className = "btn-ghost";
  closeBtn.textContent = "← Back to list";
  closeBtn.addEventListener("click", () => { openId = null; renderAll(); });
  container.appendChild(closeBtn);

  // The app is deliberately quiet about data it can't find — derivedStats() returns null rather
  // than throwing — so without this a character built on a source folder that has since been
  // renamed prints a sheet headed "Class" with quietly wrong numbers and nothing to explain it.
  const missing = missingContent(ch);
  if (missing.length > 0) {
    const banner = document.createElement("p");
    banner.className = "warn-banner";
    const kinds = [...new Set(missing.map((m) => m.kind))].join(", ");
    banner.textContent = `⚠ ${missing.length} reference${missing.length === 1 ? "" : "s"} not in your content ` +
      `(${kinds}). A source folder this character was built with may be switched off, renamed or missing.`;
    container.appendChild(banner);
  }

  const cls = findClass(ch.classId);
  const sub = findSubclass(ch.subclassId);

  const header = document.createElement("div");
  header.className = "detail-header";
  header.innerHTML = `<h2>${escapeHtml(ch.name || "(unnamed)")}</h2><p>${escapeHtml(ch.pronouns || "")} · Level ${escapeHtml(ch.level)}</p>`;
  if (ch.portrait) {
    const face = document.createElement("img");
    face.className = "detail-portrait";
    face.src = ch.portrait;
    face.alt = "";
    header.prepend(face);
  }
  container.appendChild(header);

  // Levelling up on top of choices that no longer add up just compounds the problem, so
  // it waits until they're either fixed or explicitly kept.
  const blocking = unresolvedProblems(ch, db);
  if (blocking.length > 0) {
    const banner = document.createElement("p");
    banner.className = "warn-banner";
    const levels = blocking.map((p) => `level ${p.level}`).join(", ");
    banner.textContent = `⚠ Choices at ${levels} no longer add up. Open Level history below to fix them, or keep them as they are.`;
    container.appendChild(banner);
  }

  if (ch.level < 10) {
    const levelUpBtn = document.createElement("a");
    levelUpBtn.className = "btn-primary";
    levelUpBtn.href = `level-up.html?id=${ch.id}`;
    levelUpBtn.textContent = "Level Up";
    levelUpBtn.style.display = "inline-block";
    levelUpBtn.style.marginBottom = "0.75rem";
    if (blocking.length > 0) {
      levelUpBtn.classList.add("disabled-link");
      levelUpBtn.removeAttribute("href");
      levelUpBtn.title = "Resolve the flagged levels before gaining a new one.";
    }
    container.appendChild(levelUpBtn);
  }

  const playLink = document.createElement("a");
  playLink.className = "btn-ghost detail-print-link" + (ch.level < 10 ? " detail-print-link--spaced" : "");
  playLink.href = `play.html?id=${ch.id}`;
  playLink.textContent = "Play";
  container.appendChild(playLink);

  const printSheetLink = document.createElement("a");
  printSheetLink.className = "btn-ghost detail-print-link";
  printSheetLink.href = `sheet.html?id=${ch.id}`;
  printSheetLink.textContent = "Print sheet";
  container.appendChild(printSheetLink);

  const exportBtn = document.createElement("button");
  exportBtn.type = "button";
  exportBtn.className = "btn-ghost detail-print-link";
  exportBtn.textContent = "Export JSON";
  exportBtn.addEventListener("click", () => exportJson([ch]));
  container.appendChild(exportBtn);

  const portraitBtn = document.createElement("button");
  portraitBtn.type = "button";
  portraitBtn.className = "btn-ghost detail-print-link";
  portraitBtn.textContent = ch.portrait ? "Replace portrait" : "Add portrait";
  portraitBtn.addEventListener("click", () => pickPortrait(ch.id));
  container.appendChild(portraitBtn);

  if (ch.portrait) {
    const dropBtn = document.createElement("button");
    dropBtn.type = "button";
    dropBtn.className = "btn-ghost detail-print-link";
    dropBtn.textContent = "Remove portrait";
    dropBtn.addEventListener("click", () => {
      const before = ch.portrait;
      delete ch.portrait;
      let saved = false;
      try {
        saved = savePortrait(ch.id, null);
      } catch {
        saved = false;
      }
      if (!saved) {
        ch.portrait = before;
        portraitProblem("The portrait couldn't be removed — the character may have been removed in another tab.");
        return;
      }
      renderAll();
    });
    container.appendChild(dropBtn);
  }

  const cardsRow = document.createElement("div");
  cardsRow.className = "tile-grid";
  // Every subclass card the character has, not just the newest: a Specialization or Mastery
  // upgrade adds a card to the subclass, it doesn't replace the one below it, and the features
  // on the earlier cards are still in play.
  if (sub) {
    for (const tier of subclassTiersUpTo(ch.subclassTier)) {
      cardsRow.appendChild(cardBlock({ id: sub.id, name: `${sub.name["en-US"]} (${SUBCLASS_TIER_LABELS[tier]})`, art: subclassCardArtPath(sub, tier), type: "Subclass", features: sub[tier]?.features }));
    }
  }
  const com = findCommunity(ch.heritage.communityId);
  if (com) cardsRow.appendChild(cardBlock({ id: com.id, name: com.name["en-US"], art: communityCardArtPath(com), type: "Community", features: com.features }, `Community: ${com.name["en-US"]}`));
  for (const ancId of ch.heritage.ancestryIds) {
    const anc = findAncestry(ancId);
    if (anc) cardsRow.appendChild(cardBlock({ id: anc.id, name: anc.name["en-US"], art: ancestryCardArtPath(anc), type: "Ancestry", features: anc.features }, `Ancestry: ${anc.name["en-US"]}`));
  }
  container.appendChild(cardsRow);

  const summary = document.createElement("div");
  summary.className = "detail-summary";
  summary.innerHTML = `
    <p><strong>Class:</strong> ${cls ? escapeHtml(titleCase(cls.name)) : "—"} ${sub ? "— " + escapeHtml(sub.name["en-US"]) : ""}</p>
    <p><strong>Heritage:</strong> ${ch.heritage.ancestryMode === "mixed" ? "Mixed ancestry" : "Pure ancestry"} — features: ${escapeHtml(ch.heritage.chosenFeatures.map((f) => f.featureName).join(", ")) || "—"}</p>
  `;
  container.appendChild(summary);

  const stats = derivedStats(ch, db);

  const statsBox = document.createElement("div");
  statsBox.className = "derived-box";
  for (const [key, label] of Object.entries(TRAIT_LABELS)) {
    const t = stats.traits[key];
    statsBox.appendChild(statLine(label, t.total === null ? "—" : signed(t.total), t));
  }
  container.appendChild(statsBox);

  const statsBox2 = document.createElement("div");
  statsBox2.className = "derived-box";
  statsBox2.appendChild(statLine("Proficiency", stats.proficiency.total, stats.proficiency));
  statsBox2.appendChild(statLine("Evasion", stats.evasion ? stats.evasion.total : "—", stats.evasion));
  statsBox2.appendChild(statLine("Hit Points", stats.hitPoints ? stats.hitPoints.total : "—", stats.hitPoints));
  statsBox2.appendChild(statLine("Stress", stats.stress.total, stats.stress));
  statsBox2.appendChild(statLine("Hope", "2 / 6"));
  if (stats.armorScore) {
    statsBox2.appendChild(statLine("Armor Score", stats.armorScore.total, stats.armorScore));
  }
  if (stats.majorThreshold && stats.severeThreshold) {
    statsBox2.appendChild(statLine(
      "Damage thresholds",
      `${stats.majorThreshold.total} / ${stats.severeThreshold.total}`,
      {
        total: `${stats.majorThreshold.total} / ${stats.severeThreshold.total}`,
        parts: [
          ...stats.majorThreshold.parts.map((p) => ({ label: `Major — ${p.label}`, value: p.value })),
          ...stats.severeThreshold.parts.map((p) => ({ label: `Severe — ${p.label}`, value: p.value })),
        ],
      },
    ));
  }
  if (stats.primaryAttack) {
    // Unarmed reports two traits rather than one number, the way Spellcast does.
    statsBox2.appendChild(statLine("Primary attack",
      stats.primaryAttack.display ?? signed(stats.primaryAttack.total), stats.primaryAttack));
  }
  if (stats.secondaryAttack) {
    statsBox2.appendChild(statLine("Secondary attack", signed(stats.secondaryAttack.total), stats.secondaryAttack));
  }
  if (stats.spellcast) {
    statsBox2.appendChild(statLine("Spellcast", stats.spellcast.display, stats.spellcast));
  }
  container.appendChild(statsBox2);

  renderStatNotes(container, ch, stats);

  renderLevelHistory(container, ch);

  if (ch.domainCardIds.length > 0) {
    const dcHeader = document.createElement("h3");
    const activeIds = activeDomainCardIds(ch);
    dcHeader.textContent = `Domain Cards — Loadout (${activeIds.length}/5) · Vault (${ch.domainVaultIds.length})`;
    container.appendChild(dcHeader);
    const dcGrid = document.createElement("div");
    dcGrid.className = "tile-grid";
    for (const cardId of ch.domainCardIds) {
      const dc = findDomainCard(cardId);
      if (!dc) continue;
      const inVault = ch.domainVaultIds.includes(cardId);
      const wrap = document.createElement("div");
      wrap.className = "card-tile";
      wrap.appendChild(renderCardArt({ id: dc.id, name: dc.name["en-US"], art: domainCardArtPath(dc), level: dc.level, type: dc.type, features: dc.features }));
      const label = document.createElement("div");
      label.className = "card-tile-label";
      label.textContent = dc.name["en-US"];
      wrap.appendChild(label);
      const toggleBtn = document.createElement("button");
      toggleBtn.className = "btn-small";
      toggleBtn.textContent = inVault ? "→ Loadout" : "→ Vault";
      toggleBtn.disabled = inVault && activeIds.length >= 5;
      // renderAll() rather than swapping this one tile: what's in the loadout is an input to
      // the stats above (a *-Touched card's bonus switches on at four cards from its domain,
      // Untouchable's Evasion goes away the moment it's vaulted), so the whole sheet has to
      // be re-derived, not just this button's label.
      toggleBtn.addEventListener("click", () => {
        if (inVault) ch.domainVaultIds = ch.domainVaultIds.filter((id) => id !== cardId);
        else ch.domainVaultIds.push(cardId);
        saveCharacters();
        renderAll();
      });
      wrap.appendChild(toggleBtn);
      dcGrid.appendChild(wrap);
    }
    container.appendChild(dcGrid);
  }

  const eq = ch.equipment;
  const unarmedPrimary = eq.primaryWeaponId === UNARMED;
  const primary = unarmedPrimary ? UNARMED_PROFILE : findWeapon(eq.primaryWeaponId);
  const secondary = findWeapon(eq.secondaryWeaponId);
  // A character who chose to wear nothing says so, rather than showing the same dash as one
  // who hasn't picked yet.
  const unarmored = eq.armorId === UNARMORED;
  const armor = unarmored ? { name: { "en-US": "Unarmored" } } : findArmor(eq.armorId);
  const potion = findConsumable(eq.potionChoice);
  const eqBox = document.createElement("div");
  eqBox.className = "detail-summary";
  // A slot the sheet doesn't draw is a slot the player forgets they can fill, so an empty
  // secondary says so rather than vanishing. The stats under each name are the ones that used
  // to be visible only while picking the thing.
  const gearLine = (label, item, stats) => `
    <p><strong>${label}:</strong> ${item ? escapeHtml(item.name["en-US"]) : "—"}
    ${item && stats ? `<span class="gear-stats">${escapeHtml(stats)}</span>` : ""}
    ${item ? featureLine(item) : ""}</p>`;
  eqBox.innerHTML =
    gearLine("Primary weapon", primary, weaponStats(primary)) +
    gearLine("Secondary weapon", secondary, weaponStats(secondary)) +
    gearLine("Armor", armor, armorStats(armor)) +
    gearLine("Potion", potion, "");

  const warning = burdenWarning(primary, secondary, ignoresBurden(ch, db));
  if (warning) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = `⚠ ${warning}`;
    eqBox.appendChild(p);
  }

  // Equipment is the one part of a character the sheet sends you back to the wizard for, so
  // send you to the right step rather than to the start of it.
  const changeBtn = button("Change equipment", "btn-small", () => {
    location.href = `create.html?id=${ch.id}&step=equipment`;
  });
  eqBox.appendChild(changeBtn);
  container.appendChild(eqBox);

  const expBox = document.createElement("div");
  expBox.className = "detail-summary";
  const expHeading = document.createElement("p");
  expHeading.innerHTML = "<strong>Experience:</strong>";
  expBox.appendChild(expHeading);
  const expList = document.createElement("div");
  expList.className = "derived-box";
  for (const exp of stats.experiences) {
    expList.appendChild(statLine(exp.name || "(unnamed)", `+${exp.total}`, exp.parts.length > 1 ? exp : null));
  }
  expBox.appendChild(expList);
  container.appendChild(expBox);

  if (ch.background.description || ch.background.answers) {
    const bgBox = document.createElement("div");
    bgBox.className = "detail-summary";
    bgBox.innerHTML = `
      ${ch.background.description ? `<p><strong>Background:</strong> ${escapeHtml(ch.background.description)}</p>` : ""}
      ${ch.background.answers ? `<p><strong>Appearance:</strong> ${escapeHtml(ch.background.answers)}</p>` : ""}
    `;
    container.appendChild(bgBox);
  }

  if (ch.connectionsNotes) {
    const connBox = document.createElement("div");
    connBox.className = "detail-summary";
    connBox.innerHTML = `<p><strong>Connections:</strong> ${escapeHtml(ch.connectionsNotes)}</p>`;
    container.appendChild(connBox);
  }

  const editBtn = document.createElement("button");
  editBtn.className = "btn-primary";
  editBtn.textContent = "Edit";
  editBtn.addEventListener("click", () => { location.href = `create.html?id=${ch.id}`; });
  container.appendChild(editBtn);
}

// Two things the numbers above can't say for themselves.
//
// The first is the choices a feature asked for and never got an answer to — a character built
// before this app read those features has none of them recorded. It's a nudge, never a block.
//
// The second is the opposite: bonuses the character genuinely has but that aren't in the
// totals, because they need an action in play. Without this, someone with four Codex cards
// meets Codex-Touched's requirement, sees nothing change, and reasonably concludes it's broken.
function renderStatNotes(container, ch, stats) {
  const pending = unresolvedChoices(ch, db);
  if (pending.length > 0) {
    const box = document.createElement("div");
    box.className = "problem-box";
    box.innerHTML = `<strong>Still to choose:</strong>` +
      pending.map((p) => `<div>└ ${escapeHtml(p.prompt)}</div>`).join("") +
      `<div class="hint">Until you pick, these grant nothing. Level up screen for cards; Edit → Experience for ancestry features.</div>`;
    container.appendChild(box);
  }

  if (stats.exclusions.length > 0) {
    const note = document.createElement("details");
    note.className = "exchange-section";
    const summary = document.createElement("summary");
    summary.textContent = `${stats.exclusions.length} bonus${stats.exclusions.length === 1 ? "" : "es"} you have but that aren't counted above`;
    note.appendChild(summary);
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = "These stats only count what's true from your choices and your loadout. " +
      "Anything you have to spend, act or rest for is left out, because it isn't on at the moment you look:";
    note.appendChild(hint);
    const list = document.createElement("ul");
    for (const reason of stats.exclusions) {
      const li = document.createElement("li");
      li.textContent = reason;
      list.appendChild(li);
    }
    note.appendChild(list);
    container.appendChild(note);
  }
}

function renderAll() {
  renderList();
  renderDetail();
  document.getElementById("characters-list").style.display = openId ? "none" : "block";
}

// ---------- CSV export for the GM ----------

const CSV_COLUMNS = [
  "Name", "Pronouns", "Level", "Proficiency",
  "Class", "Subclass", "Subclass tier",
  "Ancestry", "Community",
  "Agility", "Strength", "Finesse", "Instinct", "Presence", "Knowledge",
  "Evasion", "Hit Points", "Stress", "Hope",
  "Major Threshold", "Severe Threshold", "Armor Score",
  "Primary Attack", "Secondary Attack", "Spellcast Trait",
  "Primary weapon", "Secondary weapon", "Armor", "Potion",
  "Experience", "Domain Cards (loadout)", "Domain Cards (vault)",
  "Background", "Appearance", "Connections",
];

// Standard CSV (RFC 4180): wrap every field in double quotes, doubling any
// double quotes it contains, to safely handle commas, quotes and newlines.
//
// Quoting alone does NOT stop formula injection: Excel, LibreOffice and Google
// Sheets evaluate a field as a formula when its text starts with = + - @ (or a
// leading tab/CR), even inside quotes. This export is explicitly meant to be
// handed to the GM, so a character named `=HYPERLINK("http://evil","click")` —
// or a background note starting with `=` — would run on someone else's machine.
// Prefixing with a single quote makes the spreadsheet treat it as literal text.
// Plain numbers are exempt: trait values are legitimately negative ("-1"), and a
// spreadsheet evaluating "-1" just yields the number -1. Prefixing those would
// turn every negative trait into text and break sorting/formulas for the GM.
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[+-]?\d+(\.\d+)?$/;

function csvField(value) {
  let s = String(value ?? "");
  if (FORMULA_TRIGGER.test(s) && !PLAIN_NUMBER.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

function csvRowForCharacter(ch) {
  const cls = findClass(ch.classId);
  const sub = findSubclass(ch.subclassId);
  const com = findCommunity(ch.heritage.communityId);
  const ancestries = ch.heritage.ancestryIds.map((id) => findAncestry(id)?.name["en-US"]).filter(Boolean).join(" + ");
  const stats = derivedStats(ch, db);
  const activeIds = activeDomainCardIds(ch);
  const loadoutNames = activeIds.map((id) => findDomainCard(id)?.name["en-US"]).filter(Boolean).join("; ");
  const vaultNames = ch.domainVaultIds.map((id) => findDomainCard(id)?.name["en-US"]).filter(Boolean).join("; ");
  const expText = stats.experiences.map((e) => `${e.name || "(unnamed)"} (+${e.total})`).join("; ");

  // Effective traits, matching the sheet: the GM wants the number the player rolls with, which
  // includes their armor's -1 Agility.
  const t = stats.traits;
  const row = [
    ch.name, ch.pronouns, ch.level, ch.proficiency,
    cls ? titleCase(cls.name) : "", sub ? sub.name["en-US"] : "", SUBCLASS_TIER_LABELS[ch.subclassTier] ?? ch.subclassTier,
    ancestries, com ? com.name["en-US"] : "",
    t.agility.total, t.strength.total, t.finesse.total, t.instinct.total, t.presence.total, t.knowledge.total,
    stats.evasion ? stats.evasion.total : "", stats.hitPoints ? stats.hitPoints.total : "", stats.stress.total, "2/6",
    stats.majorThreshold ? stats.majorThreshold.total : "", stats.severeThreshold ? stats.severeThreshold.total : "",
    stats.armorScore ? stats.armorScore.total : "",
    stats.primaryAttack ? (stats.primaryAttack.display ?? signed(stats.primaryAttack.total)) : "",
    stats.secondaryAttack ? signed(stats.secondaryAttack.total) : "",
    stats.spellcast ? stats.spellcast.display : "",
    ch.equipment.primaryWeaponId === UNARMED ? "Unarmed" : findWeapon(ch.equipment.primaryWeaponId)?.name["en-US"] || "",
    findWeapon(ch.equipment.secondaryWeaponId)?.name["en-US"] || "",
    ch.equipment.armorId === UNARMORED ? "Unarmored" : findArmor(ch.equipment.armorId)?.name["en-US"] || "",
    findConsumable(ch.equipment.potionChoice)?.name["en-US"] || "",
    expText, loadoutNames, vaultNames,
    ch.background.description, ch.background.answers, ch.connectionsNotes,
  ];
  return row.map(csvField).join(",");
}

function buildCsv() {
  const lines = [CSV_COLUMNS.map(csvField).join(",")];
  for (const ch of characters) lines.push(csvRowForCharacter(ch));
  return lines.join("\r\n");
}

function downloadText(text, type, filename) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function exportCsv() {
  // BOM so Excel recognizes accented characters
  downloadText("﻿" + buildCsv(), "text/csv;charset=utf-8;", `daggerheart-characters-${today()}.csv`);
}

// ---------- JSON import/export (shared/transfer.js) ----------
// The round-trip between phones: a file with one character or the whole list. Everything
// about the format and the merge lives in shared/transfer.js; this is the file dialog, the
// download and the banner.

function exportJson(list) {
  downloadText(serializeCharacters(list), "application/json", exportFileName(list, today()));
}

function showImportBanner(text, { error = false, actions = [] } = {}) {
  const banner = document.getElementById("import-banner");
  banner.replaceChildren();
  banner.className = "import-banner" + (error ? " error" : "");
  banner.hidden = false;
  const p = document.createElement("p");
  p.textContent = text;
  banner.appendChild(p);
  if (actions.length) {
    const row = document.createElement("div");
    row.className = "import-actions";
    for (const { label, onClick, danger } of actions) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn-small" + (danger ? " btn-danger" : "");
      b.textContent = label;
      b.addEventListener("click", onClick);
      row.appendChild(b);
    }
    banner.appendChild(row);
  }
}

function hideImportBanner() {
  const banner = document.getElementById("import-banner");
  banner.hidden = true;
  banner.replaceChildren();
}

function applyImport(incoming, mode) {
  // An import is the one action that can add megabytes at once, and portraits made that real.
  // If it doesn't fit, put the list back the way it was: a half-imported list that only exists
  // in memory would make every later save of this session fail too, quietly.
  const before = characters;
  characters = mergeImported(characters, incoming, mode);
  try {
    saveCharacters();
  } catch {
    characters = before;
    showImportBanner(
      "No room left in this browser's storage — nothing was imported. Export a character or two, remove them from the list, and try again.",
      { error: true, actions: [{ label: "OK", onClick: hideImportBanner }] },
    );
    return;
  }
  pendingDeleteId = null;
  renderAll();
  const n = incoming.length;
  showImportBanner(`Imported ${n} character${n === 1 ? "" : "s"}.`, {
    actions: [{ label: "OK", onClick: hideImportBanner }],
  });
}

function importText(text) {
  const { characters: incoming, errors } = parseImport(text);
  if (errors.length) {
    showImportBanner(`Nothing imported. ${errors.join(" ")}`, { error: true, actions: [{ label: "OK", onClick: hideImportBanner }] });
    return;
  }
  if (incoming.length === 0) {
    showImportBanner("That file has no characters in it.", { error: true, actions: [{ label: "OK", onClick: hideImportBanner }] });
    return;
  }
  const conflicts = importConflicts(characters, incoming);
  if (conflicts.length === 0) {
    applyImport(incoming, "replace");
    return;
  }
  const names = conflicts.map((c) => c.name || "(unnamed)").join(", ");
  showImportBanner(
    `${conflicts.length === 1 ? "This character already exists" : `${conflicts.length} of these characters already exist`} here: ${names}. Replace the saved copy, or keep both?`,
    {
      actions: [
        { label: "Replace", onClick: () => applyImport(incoming, "replace"), danger: true },
        { label: "Keep both", onClick: () => applyImport(incoming, "copy") },
        { label: "Cancel", onClick: hideImportBanner },
      ],
    },
  );
}

async function importFromFile(file) {
  if (!file) return;
  importText(await file.text());
}

// Which character the hidden file input is about to serve. The input is one, shared, and
// lives in the page rather than in the detail, so re-rendering the detail can't lose it
// mid-dialog.
let portraitTarget = null;

function pickPortrait(id) {
  portraitTarget = id;
  document.getElementById("portrait-file").click();
}

// Whether the banner currently showing is one of ours. An import conflict waiting for an answer
// is not, and a portrait going well must not throw that question away.
let portraitBannerUp = false;

function portraitProblem(text) {
  portraitBannerUp = true;
  showImportBanner(text, { error: true, actions: [{ label: "OK", onClick: () => { portraitBannerUp = false; hideImportBanner(); } }] });
}

function clearPortraitProblem() {
  if (!portraitBannerUp) return;
  portraitBannerUp = false;
  hideImportBanner();
}

async function usePortraitFile(file) {
  const ch = characters.find((c) => c.id === portraitTarget);
  if (!file || !ch) return;
  let url;
  try {
    url = await encodePortrait(file);
  } catch (err) {
    portraitProblem(err?.message === "too-big"
      ? "That picture is too detailed to store — crop it, or pick one with less going on."
      : "That picture couldn't be used. Pick a JPEG, PNG or WebP — a photo from the camera is fine.");
    return;
  }
  // localStorage is a few megabytes for every character together, so a save can fail. Put the
  // old value back rather than leaving the list and what's on disk saying different things.
  const before = ch.portrait;
  ch.portrait = url;
  let saved = false;
  try {
    saved = savePortrait(ch.id, url);
  } catch {
    saved = false;
  }
  if (!saved) {
    if (before) ch.portrait = before; else delete ch.portrait;
    portraitProblem("The portrait couldn't be saved — this browser may be out of storage, or the character may have been removed in another tab.");
    return;
  }
  clearPortraitProblem();
  renderAll();
}

async function init() {
  await loadAllData();
  mountContentSettings(content);
  loadCharacters();
  // Returning from a level edit reopens the character with the history showing, so any
  // level the edit knocked out of shape is in front of you rather than a click away.
  const params = new URLSearchParams(location.search);
  const open = params.get("id") || params.get("open");
  if (open && characters.some((c) => c.id === open)) {
    openId = open;
    historyOpen = params.get("history") === "1";
  }
  renderAll();
  document.getElementById("export-csv-btn").addEventListener("click", exportCsv);
  document.getElementById("export-json-btn").addEventListener("click", () => exportJson(characters));
  const fileInput = document.getElementById("import-json-file");
  document.getElementById("import-json-btn").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    await importFromFile(fileInput.files[0]);
    fileInput.value = ""; // so picking the same file again fires change
  });
  const portraitInput = document.getElementById("portrait-file");
  portraitInput.addEventListener("change", async () => {
    const file = portraitInput.files[0];
    portraitInput.value = ""; // so picking the same file again fires change
    await usePortraitFile(file);
  });
}

init();
