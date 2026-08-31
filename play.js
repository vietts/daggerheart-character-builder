// The character at the table, on a phone. Header: name, level, heritage line, Hope you tap,
// the class's domains, the six traits on shields. Then tabs — Status (HP, Stress, Evasion,
// Armor, Proficiency, thresholds, experiences), Weapons, Cards (loadout text), Features.
//
// The only page that writes to a saved character during play — and only its `state`, the
// marked-box counts. All arithmetic lives in shared/derived-stats.js (through
// shared/sheet-data.js) and the tap/clamp rules in shared/table-state.js; this file builds
// DOM and saves. The look follows the Foundryborne Daggerheart system (see play.css).

import { ensureLevelFields, tierForLevel } from "./shared/advancement.js";
import { loadContent } from "./shared/content-load.js";
import { remapCharacterIds } from "./shared/content-ids.js";
import { deriveSheet } from "./shared/sheet-data.js";
import {
  CONDITIONS,
  DOWNTIME_MOVES_PER_REST,
  REST_MOVES,
  applyRestMove,
  clampState,
  findRestMove,
  maxesFromSheet,
  restClearAmount,
  scarAt,
  tapBox,
  toggleCondition,
} from "./shared/table-state.js";
import { pickLanguage, translator } from "./shared/i18n.js";

const CHAR_STORAGE_KEY = "dh-characters-v1";
const SVG = "http://www.w3.org/2000/svg";

// Labels follow <html lang> (shared/i18n.js), or ?lang= when a player wants the other one;
// game data stays in the data files' language.
const t = translator(pickLanguage(new URLSearchParams(location.search).get("lang") || document.documentElement.lang));

const TABS = [
  { id: "status", label: "tab.status" },
  { id: "weapons", label: "tab.weapons" },
  { id: "cards", label: "tab.cards" },
  { id: "features", label: "tab.features" },
];

const LONG_PRESS_MS = 600;

// A long press must not also fire the tap underneath — that would spend a Hope at the very
// moment it scars the slot. The guard can't live in the button's own closure: acting on a long
// press redraws the whole row, so the click that follows would land on a brand-new button that
// never saw the press. One module-level flag, cleared at the start of every press and consumed
// by whichever click arrives, is what actually holds.
let longPressFired = false;

// True once, right after a long press: the click the browser may still deliver is the tail of
// that gesture, not a tap of its own.
function longPressConsumed() {
  const was = longPressFired;
  longPressFired = false;
  return was;
}

function onLongPress(node, run) {
  let timer = null;
  const stop = () => { clearTimeout(timer); timer = null; };
  // Always through here: contextmenu arrives while the pointerdown timer is still armed, and
  // leaving it running would fire the whole thing a second time half a second later.
  const fire = () => { stop(); longPressFired = true; run(); };
  node.addEventListener("pointerdown", (e) => {
    longPressFired = false;
    if (!e.isPrimary) return;                                  // a second finger doesn't start a second timer
    if (e.pointerType === "mouse" && e.button !== 0) return;    // right and middle click come as contextmenu
    // Touch takes implicit pointer capture on pointerdown, which would swallow the leave event
    // that tells us the finger slid off the slot to call the gesture off. Hand it back.
    node.releasePointerCapture?.(e.pointerId);
    stop();
    timer = setTimeout(fire, LONG_PRESS_MS);
  });
  for (const type of ["pointerup", "pointerleave", "pointercancel"]) node.addEventListener(type, stop);
  node.addEventListener("contextmenu", (e) => { e.preventDefault(); fire(); });
  node.addEventListener("keydown", (e) => {
    if (!e.altKey || e.key !== "Enter") return;
    e.preventDefault();
    fire();
    // preventDefault means no click follows this one, so nothing would consume the flag —
    // and leaving it raised would swallow the next genuine Enter on any slot. The keyboard
    // route has no tap underneath to suppress in the first place.
    longPressFired = false;
  });
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svg(viewBox, paths, className) {
  const node = document.createElementNS(SVG, "svg");
  node.setAttribute("viewBox", viewBox);
  node.setAttribute("aria-hidden", "true");
  if (className) node.setAttribute("class", className);
  for (const [d, cls] of paths) {
    const p = document.createElementNS(SVG, "path");
    p.setAttribute("d", d);
    if (cls) p.setAttribute("class", cls);
    node.appendChild(p);
  }
  return node;
}

// The trait shield from Foundryborne's character header: a border shape with the face inset.
function traitShield() {
  return svg("0 0 52 46", [
    ["M 0,0 H 52 L 51.0714,18.254 48.781,24.0952 47.5745,39.9596 26,46 4.42553,39.9596 3.219,24.0952 0.928571,18.254 Z", "shield-border"],
    ["M 3.312,5.357 8.58596,0 H 43.414 l 5.274,5.357 -1.8797,28.846 c -0.2431,2.605 -2.1461,4.7522 -4.7031,5.3064 l -14.8343,3.2151 c -0.8375,0.1816 -1.7043,0.1816 -2.5418,0 L 9.89482,39.5094 C 7.33785,38.9552 5.43478,36.808 5.19169,34.203 Z", "shield-face"],
  ]);
}
// Foundryborne's experience-shield.svg: a banner with notched sides.
function experienceShield() {
  const node = svg("0 0 35 25", [[
    "M32.0195 21.126C32.6293 22.7597 31.4216 24.5 29.6777 24.5L3.32226 24.5C1.57838 24.5 0.370692 22.7597 0.980468 21.126L3.74316 13.7246C4.0379 12.9351 4.0379 12.0649 3.74316 11.2754L0.980469 3.87402C0.370692 2.24027 1.57838 0.499999 3.32227 0.499999L29.6777 0.5C31.4216 0.5 32.6293 2.24027 32.0195 3.87402L29.2568 11.2754C28.9621 12.0649 28.9621 12.9351 29.2568 13.7246L32.0195 21.126Z",
  ]]);
  node.setAttribute("fill", "#18162e55");
  node.setAttribute("stroke", "#f3c267");
  return node;
}
function armorShield() {
  return svg("0 0 24 26", [["M12 1 L22 4.5 V12 C22 18 17.5 22.5 12 25 C6.5 22.5 2 18 2 12 V4.5 Z"]]);
}

// Every source, unfiltered — same reason as sheet.js: this page shows a character mid-session,
// and what they are holding doesn't change because a picker was switched off.
async function loadAllData() {
  const { db } = await loadContent();
  return db;
}

function loadCharacters() {
  try {
    const raw = localStorage.getItem(CHAR_STORAGE_KEY);
    return raw ? JSON.parse(raw).map(ensureLevelFields) : [];
  } catch {
    return [];
  }
}

// Re-read, patch one character's state, write back: never the copy loaded at page open, so a
// change made meanwhile on another page of the same browser (an edit, a level up) survives.
// Returns false when the write didn't happen: at the table a mark that looks applied but isn't
// is worse than an error, because it only shows up as a loss on the next reload.
function saveState(id, state) {
  const characters = loadCharacters();
  const ch = characters.find((c) => c.id === id);
  if (!ch) return false;
  ch.state = state;
  try {
    localStorage.setItem(CHAR_STORAGE_KEY, JSON.stringify(characters));
    return true;
  } catch {
    return false;
  }
}

// Shown once, and never taken back: from the moment a write fails, nothing on this page is
// being kept.
function warnNotSaved() {
  if (document.getElementById("play-unsaved")) return;
  const note = el("p", "play-unsaved", t("save.failed"));
  note.id = "play-unsaved";
  note.setAttribute("role", "alert");
  document.body.prepend(note);
}

function line() { return el("span", "dh-line"); }

function sectionTitle(text) {
  const box = el("div", "dh-title");
  box.appendChild(el("span", "dh-side-line invert"));
  box.appendChild(el("h3", null, text));
  box.appendChild(el("span", "dh-side-line"));
  return box;
}

// ---------- header ----------

function renderHeader(s, character, domains, hope) {
  const head = el("header", "play-header");
  head.appendChild(line());

  // Portrait (when there is one), name and heritage line share a row: without a portrait the
  // header looks exactly as it did before — no empty circle, no placeholder silhouette.
  const identity = el("div", "play-identity");
  if (character.portrait) {
    const face = document.createElement("img");
    face.className = "play-portrait";
    face.src = character.portrait;
    face.alt = ""; // decorative: the name is right there in the h1 next to it
    identity.appendChild(face);
  }
  const idText = el("div", "play-identity-text");

  const nameRow = el("div", "play-name-row");
  nameRow.appendChild(el("h1", "play-name", s.name));
  const level = el("span", "play-level", t("level"));
  level.appendChild(el("strong", null, String(s.level)));
  nameRow.appendChild(level);
  idText.appendChild(nameRow);

  const details = el("p", "play-details");
  const parts = [s.className, s.subclassName, s.communityName, s.ancestryNames.join(" + ") || "—"];
  parts.forEach((text, i) => {
    if (i > 0) details.appendChild(el("span", "dot", "•"));
    details.appendChild(el("span", null, text));
  });
  idText.appendChild(details);

  identity.appendChild(idText);
  head.appendChild(identity);

  const pills = el("div", "play-pills");
  pills.appendChild(hope);
  if (domains.length) {
    const box = el("div", "dh-pill dh-domains");
    for (const d of domains) {
      const dom = el("span", "play-domain", d.toLowerCase());
      dom.dataset.domain = d.toLowerCase();
      box.appendChild(dom);
    }
    pills.appendChild(box);
  }
  head.appendChild(pills);

  head.appendChild(renderTraits(s, character));
  return head;
}

// The Hope row, plus what a scar puts under it: the confirmation and, at the end of the road,
// the line that says so. `pending` is the slot index waiting for a yes, or null.
function renderHope(state, max, onTap, pending) {
  const box = el("div", "dh-hope-box");
  const pill = el("div", "dh-pill dh-hope");
  pill.setAttribute("role", "group");
  pill.setAttribute("aria-label", t("hope.of", { n: state.hope, max: max - state.scars }));
  pill.appendChild(el("span", "hope-label", t("hope")));

  const firstScarred = max - state.scars;
  for (let i = 0; i < max; i++) {
    const scarred = i >= firstScarred;
    const b = el("button", "hope-slot" + (i < state.hope ? " filled" : "") + (scarred ? " scarred" : ""));
    b.type = "button";
    b.setAttribute("aria-pressed", String(i < state.hope));
    b.setAttribute("aria-label", scarred ? t("hope.scarred", { n: i + 1, max }) : t("hope.slot", { n: i + 1, max }));
    b.setAttribute("aria-keyshortcuts", "Alt+Enter");
    if (scarred) b.setAttribute("aria-disabled", "true");
    b.dataset.slot = String(i);
    onLongPress(b, () => onTap("scar", i));
    b.addEventListener("click", () => {
      if (longPressConsumed() || scarred) return;
      onTap("hope", i);
    });
    pill.appendChild(b);
  }
  box.appendChild(pill);

  if (pending !== null) {
    const ask = el("div", "hope-confirm");
    ask.setAttribute("role", "alert");
    // The gesture crosses out the slot and every one after it, so the question says which.
    const first = pending + 1;
    ask.appendChild(el("span", null, first === max
      ? t("hope.scar.confirmOne", { n: max })
      : t("hope.scar.confirmMany", { from: first, to: max })));
    const yes = el("button", "hope-confirm-yes", t("hope.scar.yes"));
    yes.type = "button";
    yes.addEventListener("click", () => onTap("scar-confirm", pending));
    const no = el("button", "hope-confirm-no", t("hope.scar.cancel"));
    no.type = "button";
    no.addEventListener("click", () => onTap("scar-cancel", null));
    ask.append(yes, no);
    box.appendChild(ask);
  }

  if (state.scars >= max && max > 0) box.appendChild(el("p", "hope-ended", t("hope.journeyEnds")));
  return box;
}

function renderTraits(s, character) {
  const box = el("section", "play-traits");
  const spellcastTrait = s.spellcast ? s.spellcast.display.split(" ")[0].toLowerCase() : null;
  for (const trait of s.traits) {
    const item = el("div", "play-trait");
    const name = el("div", "trait-name", trait.label);
    const mark = el("span", "tier-mark" + (character.traitMarks?.[trait.key] ? " marked" : ""));
    mark.title = t("trait.tierMark");
    name.prepend(mark);
    item.appendChild(name);
    const shield = el("div", "trait-shield");
    shield.appendChild(traitShield());
    shield.appendChild(el("span", "trait-value", trait.display));
    if (spellcastTrait === trait.key) {
      const sc = el("span", "spellcast-mark", "✦");
      sc.title = t("trait.spellcast");
      shield.appendChild(sc);
    }
    item.appendChild(shield);
    box.appendChild(item);
  }
  return box;
}

// ---------- tabs ----------

function renderTabs(active, onSelect) {
  const box = el("section", "play-tabs");
  box.appendChild(line());
  const nav = el("nav");
  nav.setAttribute("role", "tablist");
  for (const tab of TABS) {
    const b = el("button", null, t(tab.label));
    b.type = "button";
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(tab.id === active));
    b.setAttribute("aria-controls", `panel-${tab.id}`);
    b.addEventListener("click", () => onSelect(tab.id));
    nav.appendChild(b);
  }
  box.appendChild(nav);
  box.appendChild(line());
  return box;
}

// ---------- status panel ----------

// A pip bar with its label underneath, Foundryborne's .slot-value. `max` null → a dash.
function pipBar(key, label, marked, max, onTap, note) {
  const box = el("div", `dh-slot-value dh-${key}`);
  const bar = el("div", `dh-slot-bar ${key}`);
  bar.setAttribute("role", "group");
  bar.setAttribute("aria-label", t("bar.of", { label, n: marked, max: max ?? "?" }));
  if (max === null || max === undefined) {
    bar.appendChild(el("span", "play-empty", "—"));
  } else {
    for (let i = 0; i < max; i++) {
      const b = el("button", "dh-slot" + (i < marked ? " filled" : ""));
      b.type = "button";
      b.setAttribute("aria-pressed", String(i < marked));
      b.setAttribute("aria-label", t("bar.one", { label, n: i + 1, max }));
      if (key === "armor") b.appendChild(armorShield());
      b.addEventListener("click", () => onTap(key, i));
      bar.appendChild(b);
    }
  }
  box.appendChild(bar);
  const lab = el("div", "dh-slot-label");
  lab.appendChild(el("span", "label", label));
  lab.appendChild(el("span", "value", max === null || max === undefined ? "—" : `${marked} / ${max}`));
  box.appendChild(lab);
  if (note) box.appendChild(el("p", "dh-slot-note", note));
  return box;
}

function statusNumber(label, value) {
  const box = el("div", "dh-status-number");
  box.appendChild(el("div", "status-value", value === null || value === undefined ? "—" : String(value)));
  box.appendChild(el("div", "status-label", label));
  return box;
}

// The three SRD conditions as chips; the active ones spell out their effect underneath.
function renderConditions(active, onToggle) {
  const box = el("section", "play-conditions");
  const chips = el("div", "play-chips");
  chips.setAttribute("role", "group");
  chips.setAttribute("aria-label", t("conditions"));
  for (const c of CONDITIONS) {
    const on = active.includes(c.id);
    const b = el("button", "dh-chip" + (on ? " active" : ""), t(`condition.${c.id}.label`));
    b.type = "button";
    b.setAttribute("aria-pressed", String(on));
    b.addEventListener("click", () => onToggle(c.id));
    chips.appendChild(b);
  }
  box.appendChild(chips);
  for (const c of CONDITIONS.filter((c) => active.includes(c.id))) {
    const line = el("p", "play-condition-effect");
    line.appendChild(el("strong", null, `${t(`condition.${c.id}.label`)} — `));
    line.appendChild(document.createTextNode(t(`condition.${c.id}.effect`)));
    box.appendChild(line);
  }
  return box;
}

// Downtime (SRD p. 105): a rest is two moves, and the same move twice is allowed. Closed, it's
// two buttons; open, it's the menu for the rest you chose, with what each move did underneath.
// The short rest's "1d4 + your tier" is rolled here — the die is the only randomness on a page
// that otherwise just counts boxes, so the roll is spelled out rather than folded into a total.
//
// Prepare is offered twice, alone and with the party, because that's the only difference the
// move has (1 Hope or 2) and a toggle for one checkbox would cost more taps than a second button.
function renderRest(rest, tier, onTap) {
  const box = el("section", "play-rest");
  box.appendChild(sectionTitle(t("rest")));

  if (!rest) {
    const choices = el("div", "play-rest-choices");
    for (const kind of ["short", "long"]) {
      const b = el("button", "dh-chip", t(`rest.${kind}`));
      b.type = "button";
      b.addEventListener("click", () => onTap("rest-start", kind));
      choices.appendChild(b);
    }
    box.appendChild(choices);
    return box;
  }

  const left = DOWNTIME_MOVES_PER_REST - rest.done.length;
  box.appendChild(el("p", "play-rest-count",
    left > 0 ? t("rest.movesLeft", { n: left }) : t("rest.movesDone")));

  if (left > 0) {
    const menu = el("div", "play-chips");
    menu.setAttribute("role", "group");
    menu.setAttribute("aria-label", t(`rest.${rest.kind}`));
    for (const move of REST_MOVES[rest.kind]) {
      // Prepare is the one move with two versions; every other one is a single button.
      const variants = move.id === "prepare" ? [false, true] : [false];
      for (const together of variants) {
        const key = together ? `${move.id}:together` : move.id;
        const b = el("button", "dh-chip", t(`move.${key}`));
        b.type = "button";
        b.addEventListener("click", () => onTap("rest-move", key));
        menu.appendChild(b);
      }
    }
    box.appendChild(menu);
  }

  for (const line of rest.done) box.appendChild(el("p", "play-rest-done", line));

  const end = el("button", "dh-chip", left > 0 ? t("rest.leave") : t("rest.end"));
  end.type = "button";
  end.addEventListener("click", () => onTap("rest-end", null));
  box.appendChild(end);
  return box;
}

// Session notes: saved as you type (debounced), never cleared by the app.
function renderNotes(notes, onChange) {
  const box = el("section", "play-notes");
  box.appendChild(sectionTitle(t("notes")));
  const ta = el("textarea", "play-notes-field");
  ta.value = notes;
  ta.rows = 4;
  ta.placeholder = t("notes.placeholder");
  ta.setAttribute("aria-label", t("notes.aria"));
  let timer = null;
  ta.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => onChange(ta.value), 300);
  });
  ta.addEventListener("blur", () => { clearTimeout(timer); onChange(ta.value); });
  box.appendChild(ta);
  return box;
}

function renderStatus(s, state, maxes, onTap, rest) {
  const panel = el("div");

  const res = el("div", "play-resources");
  res.appendChild(pipBar("hp", t("hp"), state.hp, maxes.hp, onTap, s.hitPointsNote));
  res.appendChild(pipBar("stress", t("stress"), state.stress, maxes.stress, onTap, s.stressNote));
  panel.appendChild(res);

  const row = el("div", "play-status-row");
  row.appendChild(statusNumber(t("evasion"), s.evasion));
  row.appendChild(pipBar("armor", t("armor"), state.armor, maxes.armor, onTap, s.armorScoreNote));
  row.appendChild(statusNumber(t("proficiency"), s.proficiency));
  panel.appendChild(row);

  const th = el("div", "dh-pill dh-thresholds");
  th.appendChild(el("span", "th-label", t("threshold.minor")));
  th.appendChild(el("span", "th-value", s.thresholds ? String(s.thresholds.major) : "—"));
  th.appendChild(el("span", "th-label", t("threshold.major")));
  th.appendChild(el("span", "th-value", s.thresholds ? String(s.thresholds.severe) : "—"));
  th.appendChild(el("span", "th-label", t("threshold.severe")));
  panel.appendChild(th);

  panel.appendChild(renderConditions(state.conditions, (id) => onTap("condition", id)));

  if (s.spellcast) {
    const sc = el("p", "dh-slot-note", `${t("spellcast")}: ${s.spellcast.display}${s.spellcast.note ? " — " + s.spellcast.note : ""}`);
    panel.appendChild(sc);
  }

  if (s.unresolvedChoicePrompts.length) {
    const warn = el("div", "play-warning");
    warn.appendChild(el("strong", null, t("unresolved")));
    const list = el("ul");
    for (const p of s.unresolvedChoicePrompts) list.appendChild(el("li", null, p));
    warn.appendChild(list);
    panel.appendChild(warn);
  }

  panel.appendChild(sectionTitle(t("experience")));
  const exps = el("div", "play-experiences");
  for (const exp of s.experiences) {
    const row = el("div", "experience-row");
    const val = el("span", "experience-value");
    val.appendChild(experienceShield());
    val.appendChild(el("span", null, exp.display));
    row.appendChild(val);
    row.appendChild(el("span", "experience-name", exp.name));
    exps.appendChild(row);
  }
  if (!s.experiences.length) exps.appendChild(el("p", "play-empty", t("experience.none")));
  panel.appendChild(exps);

  panel.appendChild(renderRest(rest, tierForLevel(s.level), onTap));
  panel.appendChild(renderNotes(state.notes, (text) => onTap("notes", text)));
  return panel;
}

// ---------- weapons / cards / features ----------

function featureText(features, withNames) {
  const box = el("div", "item-text");
  for (const f of features) {
    if (withNames && f.name) box.appendChild(el("h4", null, f.name));
    for (const block of f.description || []) {
      if (block.type === "paragraph") {
        if (block.text) box.appendChild(el("p", null, block.text));
      } else if (block.type === "list") {
        const list = el("ul");
        for (const item of block.items) list.appendChild(el("li", null, item));
        box.appendChild(list);
      }
    }
  }
  return box;
}

function itemCard({ name, labels = [], roll, rollNote, features = [], withNames = false, className = "" }) {
  const box = el("article", `dh-item ${className}`);
  box.appendChild(el("span", "item-name", name));
  if (roll !== undefined) {
    const r = el("span", "item-roll", roll);
    if (rollNote) r.appendChild(el("small", null, rollNote));
    box.appendChild(r);
  }
  const labs = el("span", "item-labels");
  for (const l of labels.filter(Boolean)) labs.appendChild(el("span", null, l));
  box.appendChild(labs);
  if (features.length) box.appendChild(featureText(features, withNames));
  return box;
}

function renderWeapons(s) {
  const panel = el("div");
  panel.appendChild(sectionTitle(t("weapons")));
  for (const w of s.weapons) {
    panel.appendChild(itemCard({
      name: w.name,
      labels: [w.range, w.burden, w.traitLabel],
      roll: w.attack,
      rollNote: `${w.damage} ${w.damageType}`.trim(),
      features: w.features,
      withNames: true,
    }));
  }
  if (!s.weapons.length) panel.appendChild(el("p", "play-empty", t("weapons.none")));
  panel.appendChild(sectionTitle(t("armor")));
  panel.appendChild(itemCard({
    name: s.armorName,
    labels: [s.thresholds ? t("armor.thresholds", { major: s.thresholds.major, severe: s.thresholds.severe }) : ""],
    roll: s.armorScore === null ? "—" : String(s.armorScore),
    rollNote: t("armor.score"),
    features: s.armorFeatures,
    withNames: true,
  }));
  panel.appendChild(el("p", "dh-slot-note", t("potion", { name: s.potionName })));
  return panel;
}

function renderCards(s) {
  const panel = el("div");
  panel.appendChild(sectionTitle(t("loadout", { n: s.loadout.length })));
  for (const card of s.loadout) {
    panel.appendChild(itemCard({
      name: card.name,
      labels: [t("card.level", { n: card.level }), card.domain, card.type, t("card.recall", { n: card.recallCost })],
      features: card.features,
      withNames: card.features.length > 1,
      className: `domain-${card.domainClass}`,
    }));
  }
  if (!s.loadout.length) panel.appendChild(el("p", "play-empty", t("loadout.none")));
  return panel;
}

function renderFeatures(s) {
  const panel = el("div");
  const group = (title, features, source) => {
    if (!features.length) return;
    panel.appendChild(sectionTitle(title));
    for (const f of features) {
      panel.appendChild(itemCard({ name: f.name, labels: [source ? source(f) : ""], features: [f] }));
    }
  };
  group(t("features.hope", { cls: s.className }), s.hopeFeature ? [s.hopeFeature] : []);
  group(s.className, s.classFeatures);
  group(s.subclassName, s.subclassFeatures, (f) => f.source);
  group(t("features.ancestry"), s.ancestryFeatures, (f) => f.source);
  group(t("features.community"), s.communityFeatures, (f) => f.source);
  if (!panel.childNodes.length) panel.appendChild(el("p", "play-empty", t("features.none")));
  return panel;
}

// ---------- page ----------

function renderNotFound(root) {
  root.appendChild(el("p", "hint", t("notfound")));
  const link = el("a", null, t("notfound.back"));
  link.href = "characters.html";
  root.appendChild(link);
}

async function init() {
  const root = document.getElementById("play-root");
  document.getElementById("nav-characters").textContent = t("nav.characters");
  document.getElementById("print-link").textContent = t("nav.print");
  document.getElementById("undo").textContent = t("undo");
  document.title = `Daggerheart — ${t("title.play")}`;
  const db = await loadAllData();

  const id = new URLSearchParams(location.search).get("id");
  // A record's id names the edition that published it, so switching which SRD is loaded moves
  // every id a character stores. Re-point them at what IS loaded before anything reads them.
  const character = remapCharacterIds(loadCharacters().find((c) => c.id === id), db);
  if (!character) {
    renderNotFound(root);
    return;
  }
  document.getElementById("print-link").href = `sheet.html?id=${id}`;
  document.title = `${character.name || "Daggerheart"} — ${t("title.play")}`;

  const sheet = deriveSheet(character, db);
  const maxes = maxesFromSheet(sheet);
  const cls = db.classes.find((c) => c.id === character.classId);
  const domains = cls?.domains || [];

  // Clamped on every open: a lighter armor or a lost bonus since the last session must not
  // leave more boxes marked than the row has.
  let state = clampState(character.state, maxes);
  if (JSON.stringify(state) !== JSON.stringify(character.state)) {
    if (!saveState(id, state)) warnNotSaved();
  }

  const panels = {};
  let hopeBox;
  let pendingScar = null;
  let rest = null; // { kind, done: [] } while a rest is open; null the rest of the time
  // Every change goes through commit(), which keeps the state before it. A tap is one gesture
  // on a phone held in one hand across a table, and the ones that hurt are the ones that clear
  // a row: tapping the first HP box when you meant the fourth wipes three marks and there was
  // no way back. Ten deep is more than enough to walk out of a misread row without turning
  // this into a history the player has to think about.
  const UNDO_LIMIT = 10;
  const undoStack = [];
  let undoButton;

  function commit(next) {
    undoStack.push(state);
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    write(next);
  }
  // Notes are a textarea saved on every keystroke: pushing each one would fill the stack with
  // steps nobody wants, and the field has the browser's own undo already. Same for a state the
  // clamp rewrote on open — that's not something the player did.
  function write(next) {
    state = clampState(next, maxes);
    if (!saveState(id, state)) warnNotSaved();
    if (undoButton) undoButton.disabled = undoStack.length === 0;
  }
  function undo() {
    if (!undoStack.length) return;
    // A rest half-taken is a menu, not a saved thing: stepping back out of one of its moves
    // would leave the counter claiming a move that's been undone.
    rest = null;
    write(undoStack.pop());
    refreshHope();
    refreshStatus();
  }
  // Redrawing the row destroys the button that had the focus, so whoever plays from the
  // keyboard would be dropped back to the top of the page. Say where the focus should land.
  function refreshHope(focusSelector) {
    const fresh = renderHope(state, maxes.hope ?? 0, onTap, pendingScar);
    hopeBox.replaceWith(fresh);
    hopeBox = fresh;
    if (focusSelector) fresh.querySelector(focusSelector)?.focus();
  }
  function refreshStatus() {
    const fresh = renderStatus(sheet, state, maxes, onTap, rest);
    panels.status.replaceChildren(...fresh.childNodes);
  }
  // One entry point for every change at the table: a tapped box (key + index), a toggled
  // condition (key "condition" + id) or the notes (key "notes" + text). Notes don't redraw
  // the panel — the textarea being typed in would lose focus.
  function onTap(key, value) {
    if (key === "notes") {
      write({ ...state, notes: value });
      return;
    }
    // A scar is permanent, so adding one asks first; taking one back doesn't (that's the
    // correction of a mistake, not a decision).
    if (key === "scar" || key === "scar-confirm" || key === "scar-cancel") {
      const max = maxes.hope ?? 0;
      const wasPending = pendingScar;
      if (key === "scar-cancel") pendingScar = null;
      else if (key === "scar-confirm") {
        commit({ ...state, scars: scarAt(state.scars, value, max) });
        pendingScar = null;
      } else {
        const next = scarAt(state.scars, value, max);
        if (next > state.scars) pendingScar = value;
        else {
          commit({ ...state, scars: next });
          pendingScar = null;
        }
      }
      // Opening the confirmation moves the focus onto it; answering gives it back to the slot.
      refreshHope(pendingScar === null ? `.hope-slot[data-slot="${key === "scar-cancel" ? wasPending : value}"]` : ".hope-confirm-yes");
      return;
    }
    // Opening, leaving or finishing a rest changes no boxes, so none of it is worth an undo
    // step: what the moves themselves did already has one each.
    if (key === "rest-start") {
      rest = { kind: value, done: [] };
      refreshStatus();
      return;
    }
    if (key === "rest-end") {
      rest = null;
      refreshStatus();
      return;
    }
    if (key === "rest-move") {
      const [id_, variant] = value.split(":");
      const move = findRestMove(rest.kind, id_);
      const together = variant === "together";
      // The player's die, rolled here: 1d4 + tier, both halves shown so it can be checked
      // against the one on the table.
      const roll = move?.clear === "roll" ? 1 + Math.floor(Math.random() * 4) : 0;
      const tier = tierForLevel(sheet.level);
      const amount = restClearAmount(roll, tier);
      const before = state;
      commit(applyRestMove(state, maxes, move, { amount, together }));
      // The log names the move plainly: the button carries the "(1d4+tier)" reminder, and
      // repeating it in the line that reports the actual roll reads as noise.
      rest.done.push(move?.clear === "roll"
        ? t("rest.rolled", { move: t(`log.${value}`), roll, tier, total: amount, n: before[move.resource] - state[move.resource] })
        : t("rest.applied", { move: t(`log.${value}`) }));
      refreshHope();
      refreshStatus();
      return;
    }
    const next = key === "condition"
      ? { ...state, conditions: toggleCondition(state.conditions, value) }
      : { ...state, [key]: tapBox(state[key], value) };
    commit(next);
    if (key === "hope") {
      refreshHope(`.hope-slot[data-slot="${value}"]`);
      refreshStatus();
    } else {
      refreshStatus();
    }
  }

  // The toolbar's button is in play.html so it exists before this runs; it stays disabled until
  // there is something to step back from.
  undoButton = document.getElementById("undo");
  undoButton.disabled = true;
  undoButton.addEventListener("click", undo);

  hopeBox = renderHope(state, maxes.hope ?? 0, onTap, pendingScar);
  root.appendChild(renderHeader(sheet, character, domains, hopeBox));

  // The active tab lives in the URL hash so a reload (or a back-navigation) lands on it.
  let active = TABS.some((t) => t.id === location.hash.slice(1)) ? location.hash.slice(1) : "status";
  let tabs = renderTabs(active, select);
  root.appendChild(tabs);

  const content = {
    status: () => renderStatus(sheet, state, maxes, onTap),
    weapons: () => renderWeapons(sheet),
    cards: () => renderCards(sheet),
    features: () => renderFeatures(sheet),
  };
  for (const tab of TABS) {
    const panel = el("section", "play-panel");
    panel.id = `panel-${tab.id}`;
    panel.setAttribute("role", "tabpanel");
    panel.hidden = tab.id !== active;
    panel.replaceChildren(...content[tab.id]().childNodes);
    panels[tab.id] = panel;
    root.appendChild(panel);
  }

  function select(id) {
    active = id;
    history.replaceState(null, "", `#${id}`);
    for (const tab of TABS) panels[tab.id].hidden = tab.id !== id;
    const fresh = renderTabs(id, select);
    tabs.replaceWith(fresh);
    tabs = fresh;
  }
}

init();
