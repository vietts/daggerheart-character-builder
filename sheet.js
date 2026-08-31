// Print-first character sheet. Read-only: it never writes to localStorage.
// All arithmetic lives in shared/derived-stats.js (by way of shared/sheet-data.js);
// this file only builds DOM.

import { ensureLevelFields } from "./shared/advancement.js";
import { loadContent } from "./shared/content-load.js";
import { remapCharacterIds } from "./shared/content-ids.js";
import { deriveSheet } from "./shared/sheet-data.js";

const CHAR_STORAGE_KEY = "dh-characters-v1";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Every source, unfiltered and unswitchable. This page has no top bar and no Content button,
// which is correct: it prints what the character IS, so a source switched off for the pickers
// must still resolve here or the sheet would print gaps for content the character really has.
async function loadAllData() {
  const { db } = await loadContent();
  return db;
}

// Read-only: getItem only, never setItem. ensureLevelFields() backfills the fields
// deriveSheet() (by way of derivedStats()) assumes are present — the same precondition
// every other page's loadCharacters() applies before touching a saved character.
function loadCharacters() {
  try {
    const raw = localStorage.getItem(CHAR_STORAGE_KEY);
    return raw ? JSON.parse(raw).map(ensureLevelFields) : [];
  } catch {
    return [];
  }
}

// A row of empty circles to fill in with a pencil. Printed empty on purpose, so the
// same sheet is reusable across sessions. count is null when the underlying value is
// unknown (e.g. HP on a draft with no class chosen yet) — that renders as a dash
// instead of a zero-length row, matching how Evasion/Armor/Thresholds show "—".
// `note` is a capped-stat caption (e.g. "Capped at the maximum Stress slots of 6."):
// it prints right under the row it explains, not as a footnote at the bottom of the
// page nobody reads at the table.
function tickRow(label, count, note) {
  const row = el("div", "tick-row");
  row.appendChild(el("span", "tick-label", label));
  if (count === null || count === undefined) {
    row.appendChild(el("span", "tick-unknown", "—"));
  } else {
    const ticks = el("div", "ticks");
    for (let i = 0; i < count; i++) ticks.appendChild(el("span", "tick"));
    row.appendChild(ticks);
  }
  if (note) row.appendChild(el("span", "tick-note", note));
  return row;
}

function renderIdentity(s) {
  const box = el("header", "sheet-identity");
  box.appendChild(el("h1", "sheet-name", s.name));
  const heritage = [s.ancestryNames.join(" + ") || "—", s.communityName].join(" · ");
  box.appendChild(el("p", "sheet-subtitle",
    `${s.className} · ${s.subclassName} (${s.subclassTierLabel}) — ${heritage}`));
  const stats = el("div", "sheet-identity-stats");
  stats.appendChild(el("span", null, `LV ${s.level}`));
  stats.appendChild(el("span", null, `PROF ${s.proficiency}`));
  if (s.pronouns) stats.appendChild(el("span", null, s.pronouns));
  box.appendChild(stats);
  return box;
}

// A card that grants a choice (Vitality's "+1 to two traits", Clank's Purposeful Design,
// Master of the Craft...) contributes nothing to any stat on this page until the player
// has answered it — see shared/effects.js's unresolvedChoices(). On screen that's a "?"
// away; on paper there's nowhere for a silently-missing bonus to explain itself. This
// banner goes right under the identity block, above every derived number on the page,
// so a player reads it before trusting those numbers rather than discovering later that
// a card "does nothing." Renders nothing at all when the list is empty.
function renderUnresolvedChoices(s) {
  if (s.unresolvedChoicePrompts.length === 0) return null;
  const box = el("div", "choice-warning");
  box.appendChild(el("strong", null, "Unresolved choices — these grant nothing until answered:"));
  const list = el("ul");
  for (const prompt of s.unresolvedChoicePrompts) list.appendChild(el("li", null, prompt));
  box.appendChild(list);
  return box;
}

// Hexagon outlines are inline SVG strokes, not clip-path borders: clip-path cuts a
// CSS border away on the diagonals, and every workaround for that relies on a
// background layer — which browsers drop when printing. An SVG stroke always prints.
function hexOutline() {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 100 115");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("class", "hex-outline");
  svg.setAttribute("aria-hidden", "true");
  const poly = document.createElementNS(NS, "polygon");
  poly.setAttribute("points", "50,2 97,30 97,85 50,113 3,85 3,30");
  poly.setAttribute("fill", "none");
  poly.setAttribute("stroke", "currentColor");
  poly.setAttribute("stroke-width", "3");
  svg.appendChild(poly);
  return svg;
}

function renderTraits(s) {
  const box = el("section", "trait-list");
  for (const trait of s.traits) {
    const item = el("div", "trait");
    item.appendChild(hexOutline());
    const inner = el("div", "trait-inner");
    inner.appendChild(el("span", "trait-label", trait.label));
    inner.appendChild(el("span", "trait-value", trait.display));
    item.appendChild(inner);
    box.appendChild(item);
  }
  return box;
}

function statBadge(label, value, className) {
  const badge = el("div", `stat-badge ${className}`);
  if (className === "badge-evasion") badge.appendChild(hexOutline());
  const inner = el("div", "stat-badge-inner");
  inner.appendChild(el("span", "stat-badge-value", String(value)));
  inner.appendChild(el("span", "stat-badge-label", label));
  badge.appendChild(inner);
  return badge;
}

// Wraps a badge with its capped-stat note underneath, when there is one — the same
// "caption near the number, not a footnote" placement tickRow() gives HP/Stress.
function badgeColumn(badge, note) {
  const wrap = el("div", "stat-badge-col");
  wrap.appendChild(badge);
  if (note) wrap.appendChild(el("span", "stat-badge-note", note));
  return wrap;
}

function renderDefenses(s) {
  const box = el("section", "defense-block");

  const top = el("div", "defense-top");
  top.appendChild(badgeColumn(statBadge("Evasion", s.evasion ?? "—", "badge-evasion")));
  top.appendChild(badgeColumn(statBadge("Armor", s.armorScore ?? "—", "badge-armor"), s.armorScoreNote));
  box.appendChild(top);

  // Absent from the old sheet entirely — it printed no Spellcast trait at all — but it's
  // exactly the kind of number a spellcasting player looks up every session, so it sits in
  // the defense block: the one place on page 1 a player's eyes go to find out what they roll
  // with. null for Guardian/Warrior, who have no Spellcast trait; nothing renders for them.
  if (s.spellcast) {
    const sc = el("div", "spellcast-row");
    sc.appendChild(el("span", "spellcast-label", "Spellcast"));
    sc.appendChild(el("strong", null, s.spellcast.display));
    box.appendChild(sc);
    // The bonus (if any) applies to Spellcast Rolls only, not to a plain roll of the trait —
    // easy to misuse at the table without this line, since the trait hexagon above shows the
    // bare trait value with no hint that a card adds more specifically to spellcasting.
    if (s.spellcast.note) box.appendChild(el("p", "tick-note", s.spellcast.note));
  }

  box.appendChild(tickRow("HP", s.hitPoints, s.hitPointsNote));
  box.appendChild(tickRow("Stress", s.stress, s.stressNote));
  box.appendChild(tickRow("Hope", s.hopeSlots, `start with ${s.hopeStart}`));

  const th = el("div", "threshold-row");
  th.appendChild(el("span", null, `Major ${s.thresholds ? s.thresholds.major : "—"}`));
  th.appendChild(el("span", null, `Severe ${s.thresholds ? s.thresholds.severe : "—"}`));
  box.appendChild(th);

  return box;
}

function renderEquipment(s) {
  const box = el("section", "equipment-block");
  box.appendChild(el("h2", null, "Weapons & Armor"));
  for (const w of s.weapons) {
    const row = el("div", "weapon-row");
    row.appendChild(el("strong", null, w.name));
    row.appendChild(el("span", null, w.range));
    // An unarmed attack carries no single trait to name in brackets — its attack string already
    // reads "Strength +2 / Finesse +0" — so the bracket is printed only when there's a trait.
    row.appendChild(el("span", null, w.traitLabel ? `${w.attack} (${w.traitLabel})` : w.attack));
    row.appendChild(el("span", null, `${w.damage} ${w.damageType}`));
    row.appendChild(el("span", "weapon-burden", w.burden));
    box.appendChild(row);
  }
  const armorRow = el("div", "weapon-row");
  armorRow.appendChild(el("strong", null, s.armorName));
  armorRow.appendChild(el("span", null, `Armor ${s.armorScore ?? "—"}`));
  box.appendChild(armorRow);
  box.appendChild(el("p", "potion-line", `Potion: ${s.potionName}`));
  return box;
}

function renderExperiences(s) {
  const box = el("section", "experience-block");
  box.appendChild(el("h2", null, "Experiences"));
  for (const exp of s.experiences) {
    const row = el("div", "experience-row");
    row.appendChild(el("span", null, exp.name));
    row.appendChild(el("strong", null, exp.display));
    box.appendChild(row);
  }
  return box;
}

function renderLoadout(s) {
  const box = el("section", "loadout-block");
  box.appendChild(el("h2", null, `Loadout (${s.loadout.length}/5)`));
  s.loadout.forEach((card, i) => {
    const row = el("div", `loadout-row domain-${card.domainClass}`);
    row.appendChild(el("span", "loadout-index", String(i + 1)));
    row.appendChild(el("strong", null, card.name));
    row.appendChild(el("span", null, `Lv ${card.level} · recall ${card.recallCost}`));
    box.appendChild(row);
  });
  return box;
}

// Names only. Full text is on page 2. Every feature category the sheet prints belongs here,
// including the class's own (classFeatures) — a Rogue's strip used to name neither Cloaked
// nor Sneak Attack, which read as though the class itself contributed nothing.
function renderFeatureStrip(s) {
  const named = [
    s.hopeFeature?.name,
    ...s.classFeatures.map((f) => f.name),
    ...s.subclassFeatures.map((f) => f.name),
    ...s.ancestryFeatures.map((f) => f.name),
    ...s.communityFeatures.map((f) => f.name),
  ].filter(Boolean);
  const box = el("section", "sheet-features");
  box.appendChild(el("h2", null, "Features"));
  box.appendChild(el("p", null, named.join(" · ") || "—"));
  return box;
}

function renderPageOne(s) {
  const page = el("article", "sheet-page sheet-page-1");
  page.appendChild(renderIdentity(s));

  const warning = renderUnresolvedChoices(s);
  if (warning) page.appendChild(warning);

  const columns = el("div", "sheet-columns");
  columns.appendChild(renderTraits(s));

  const right = el("div", "sheet-right");
  right.appendChild(renderDefenses(s));
  right.appendChild(renderEquipment(s));
  columns.appendChild(right);
  page.appendChild(columns);

  const lower = el("div", "sheet-lower");
  lower.appendChild(renderExperiences(s));
  lower.appendChild(renderLoadout(s));
  page.appendChild(lower);

  page.appendChild(renderFeatureStrip(s));
  return page;
}

// feature.description is an ordered list of { type: "paragraph", text } and
// { type: "list", items } blocks, in the same order the source prose has them — see
// shared/sheet-data.js's features(). Rendering them one element per block, in that order,
// is what keeps e.g. Champion's Edge's closing restriction ("You can't choose the same
// option more than once") printing AFTER the bullet options it restricts, and keeps a
// multi-paragraph feature (Beastbound's Companion) from running its paragraphs into one
// block with no break. shared/card-render.js's descriptionHtml() does the same thing for
// the card browser's fallback, for the same reason.
function featureBlock(feature, sourceLabel) {
  const box = el("div", "feature-entry");
  const heading = [feature.name, sourceLabel].filter(Boolean).join(" — ");
  if (heading) box.appendChild(el("h3", null, heading));
  for (const block of feature.description || []) {
    if (block.type === "paragraph") {
      if (block.text) box.appendChild(el("p", null, block.text));
    } else if (block.type === "list") {
      const list = el("ul");
      for (const item of block.items) list.appendChild(el("li", null, item));
      box.appendChild(list);
    }
  }
  return box;
}

function renderCardEntry(card) {
  const box = el("div", `card-entry domain-${card.domainClass}`);
  const head = el("div", "card-entry-head");
  head.appendChild(el("strong", null, card.name));
  head.appendChild(el("span", null, `Lv ${card.level} · ${card.domain} · ${card.type} · recall ${card.recallCost}`));
  box.appendChild(head);
  for (const f of card.features) box.appendChild(featureBlock(f));
  return box;
}

function renderPageTwo(s) {
  const page = el("article", "sheet-page sheet-page-2");
  page.appendChild(el("h2", "page-title", "Loadout — card text"));

  const cards = el("div", "card-entries");
  if (s.loadout.length === 0) cards.appendChild(el("p", null, "No cards in loadout."));
  for (const card of s.loadout) cards.appendChild(renderCardEntry(card));
  page.appendChild(cards);

  page.appendChild(el("h2", "page-title", "Features"));
  const feats = el("div", "feature-entries");
  if (s.hopeFeature) feats.appendChild(featureBlock(s.hopeFeature, `${s.className} — Hope feature`));
  for (const f of s.classFeatures) feats.appendChild(featureBlock(f, s.className));
  // Each feature's own tier (f.source — Foundation/Specialization/Mastery), not the
  // character's current tier: a Mastery character prints Foundation and Specialization
  // features labelled as such, not all three relabelled "Mastery".
  for (const f of s.subclassFeatures) feats.appendChild(featureBlock(f, `${s.subclassName} (${f.source})`));
  for (const f of s.ancestryFeatures) feats.appendChild(featureBlock(f, f.source));
  for (const f of s.communityFeatures) feats.appendChild(featureBlock(f, f.source));
  // Equipment features are prose the app never applies mechanically (e.g. Gambeson's
  // "+1 to Evasion"). Printing them is what lets the player apply them by hand.
  for (const w of s.weapons) {
    for (const f of w.features) feats.appendChild(featureBlock(f, w.name));
  }
  for (const f of s.armorFeatures) feats.appendChild(featureBlock(f, s.armorName));
  page.appendChild(feats);

  // Free-text notes, not data-driven features, so they're wrapped in a single-paragraph
  // description block by hand rather than going through features() — same shape featureBlock()
  // expects either way.
  const noteBlock = (name, text) => featureBlock({ name, description: [{ type: "paragraph", text }] });
  if (s.background || s.appearance || s.connections) {
    page.appendChild(el("h2", "page-title", "Notes"));
    const notes = el("div", "note-entries");
    if (s.background) notes.appendChild(noteBlock("Background", s.background));
    if (s.appearance) notes.appendChild(noteBlock("Appearance", s.appearance));
    if (s.connections) notes.appendChild(noteBlock("Connections", s.connections));
    page.appendChild(notes);
  }

  return page;
}

function renderNotFound(root) {
  root.appendChild(el("p", "hint", "Character not found."));
  const link = el("a", null, "Back to My Characters");
  link.href = "characters.html";
  root.appendChild(link);
}

async function init() {
  const root = document.getElementById("sheet-root");
  document.getElementById("print-btn").addEventListener("click", () => window.print());

  const db = await loadAllData();

  const id = new URLSearchParams(location.search).get("id");
  // A record's id names the edition that published it, so switching which SRD is loaded moves
  // every id a character stores. Re-point them at what IS loaded before anything reads them.
  const character = remapCharacterIds(loadCharacters().find((c) => c.id === id), db);
  if (!character) {
    renderNotFound(root);
    return;
  }

  document.title = `${character.name || "Character"} — Daggerheart Sheet`;
  const sheet = deriveSheet(character, db);
  root.appendChild(renderPageOne(sheet));
  root.appendChild(renderPageTwo(sheet));
}

init();
