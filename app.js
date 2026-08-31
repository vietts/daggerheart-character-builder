import { renderCardArt, domainCardArtPath } from "./shared/card-render.js";
import { escapeHtml } from "./shared/escape.js";
import { loadContent } from "./shared/content-load.js";
import { mountContentSettings } from "./shared/content-settings.js";
import { visibleRecords } from "./shared/content-sources.js";

// The domains we already know a chip's worth of order for. NOT the whole list: a content source
// may bring its own, so the chips are these plus whatever else turns up in the cards actually
// loaded. A domain with no CSS rule of its own gets the default card border, which is fine; a
// domain with no CHIP would be unfilterable, and worse, ticking any other chip would hide its
// cards with no way to bring them back — which is why this list stopped being the limit.
const KNOWN_DOMAINS = ["ARCANA", "BLADE", "BONE", "CODEX", "DREAD", "GRACE", "MIDNIGHT", "SAGE", "SPLENDOR", "VALOR"];
const TYPES = ["ABILITY", "SPELL", "GRIMOIRE"];
const MAX_LOADOUT = 5;
const STORAGE_KEY = "dh-card-builder-state-v1";

// What loadContent() reported: which sources loaded, and which are switched off.
let content = null;

const state = {
  cards: [],
  filters: {
    domains: new Set(),
    types: new Set(),
    levelMin: 1,
    levelMax: 10,
    search: "",
  },
  loadout: [], // array of card ids, max 5
  vault: [], // array of card ids
};

function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    state.loadout = Array.isArray(parsed.loadout) ? parsed.loadout : [];
    state.vault = Array.isArray(parsed.vault) ? parsed.vault : [];
  } catch (err) {
    console.warn("Could not read saved state", err);
  }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ loadout: state.loadout, vault: state.vault }));
}

async function loadCards() {
  content = await loadContent({ files: ["domain-cards"] });
  // The loadout and vault look cards up in this list by id, so it holds everything loaded. Only
  // the grid is filtered (renderGrid), which is what keeps a saved loadout intact when the source
  // one of its cards came from is switched off.
  state.cards = content.db.domainCards.map((c) => ({
    id: c.id,
    name: c.name["en-US"],
    domain: c.domain,
    type: c.type,
    level: c.level,
    recallCost: c.recallCost,
    features: c.features,
    contentSource: c.contentSource,
    art: domainCardArtPath(c),
  }));
}

/** The known ones, plus any domain a loaded card brought with it. */
function domainsInPlay() {
  const extra = [...new Set(visibleCards().map((c) => c.domain))].filter((d) => !KNOWN_DOMAINS.includes(d));
  return [...KNOWN_DOMAINS, ...extra.sort()];
}

const visibleCards = () => visibleRecords(state.cards, content.disabled);

function cardMatchesFilters(card) {
  const f = state.filters;
  if (f.domains.size > 0 && !f.domains.has(card.domain)) return false;
  if (f.types.size > 0 && !f.types.has(card.type)) return false;
  if (card.level < f.levelMin || card.level > f.levelMax) return false;
  if (f.search) {
    const haystack = (card.name + " " + card.feature).toLowerCase();
    if (!haystack.includes(f.search)) return false;
  }
  return true;
}

function buildChipGroup(container, values, activeSet, onToggle) {
  container.innerHTML = "";
  for (const value of values) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = value.charAt(0) + value.slice(1).toLowerCase();
    chip.dataset.domain = value;
    chip.classList.toggle("active", activeSet.has(value));
    chip.addEventListener("click", () => {
      if (activeSet.has(value)) activeSet.delete(value);
      else activeSet.add(value);
      chip.classList.toggle("active");
      renderGrid();
    });
    container.appendChild(chip);
  }
}

function renderGrid() {
  const grid = document.getElementById("card-grid");
  const resultCount = document.getElementById("result-count");
  grid.innerHTML = "";

  const filtered = visibleCards().filter(cardMatchesFilters);
  resultCount.textContent = `${filtered.length} cards`;

  for (const card of filtered) {
    const el = document.createElement("article");
    el.className = "card";
    el.appendChild(renderCardArt({ ...card, domainClass: card.domain.toLowerCase() }));

    const meta = document.createElement("div");
    meta.className = "card-meta";
    meta.innerHTML = `<strong>${escapeHtml(card.name)}</strong><span>Lv ${escapeHtml(card.level)} · ${escapeHtml(card.domain)} · ${escapeHtml(card.type)}</span>`;
    el.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "card-actions";

    const inLoadout = state.loadout.includes(card.id);
    const inVault = state.vault.includes(card.id);

    const loadoutBtn = document.createElement("button");
    loadoutBtn.className = "btn-small";
    loadoutBtn.dataset.role = "loadout-btn";
    loadoutBtn.dataset.cardId = card.id;
    loadoutBtn.textContent = inLoadout ? "− Loadout" : "+ Loadout";
    loadoutBtn.disabled = !inLoadout && state.loadout.length >= MAX_LOADOUT;
    loadoutBtn.addEventListener("click", () => toggleLoadout(card.id));

    const vaultBtn = document.createElement("button");
    vaultBtn.className = "btn-small";
    vaultBtn.dataset.role = "vault-btn";
    vaultBtn.dataset.cardId = card.id;
    vaultBtn.textContent = inVault ? "− Vault" : "+ Vault";
    vaultBtn.addEventListener("click", () => toggleVault(card.id));

    actions.appendChild(loadoutBtn);
    actions.appendChild(vaultBtn);
    el.appendChild(actions);

    grid.appendChild(el);
  }
}

function toggleLoadout(id) {
  const idx = state.loadout.indexOf(id);
  if (idx >= 0) {
    state.loadout.splice(idx, 1);
  } else {
    if (state.loadout.length >= MAX_LOADOUT) return;
    state.loadout.push(id);
    const vIdx = state.vault.indexOf(id);
    if (vIdx >= 0) state.vault.splice(vIdx, 1);
  }
  persist();
  updateButtonStates();
  renderPanel();
}

function toggleVault(id) {
  const idx = state.vault.indexOf(id);
  if (idx >= 0) {
    state.vault.splice(idx, 1);
  } else {
    state.vault.push(id);
    const lIdx = state.loadout.indexOf(id);
    if (lIdx >= 0) state.loadout.splice(lIdx, 1);
  }
  persist();
  updateButtonStates();
  renderPanel();
}

function updateButtonStates() {
  const loadoutFull = state.loadout.length >= MAX_LOADOUT;
  document.querySelectorAll('[data-role="loadout-btn"]').forEach((btn) => {
    const id = btn.dataset.cardId;
    const inLoadout = state.loadout.includes(id);
    btn.textContent = inLoadout ? "− Loadout" : "+ Loadout";
    btn.disabled = !inLoadout && loadoutFull;
  });
  document.querySelectorAll('[data-role="vault-btn"]').forEach((btn) => {
    const id = btn.dataset.cardId;
    btn.textContent = state.vault.includes(id) ? "− Vault" : "+ Vault";
  });
}

function cardById(id) {
  return state.cards.find((c) => c.id === id);
}

function renderPanel() {
  const loadoutList = document.getElementById("loadout-slots");
  const vaultList = document.getElementById("vault-list");
  document.getElementById("loadout-count").textContent = `(${state.loadout.length}/${MAX_LOADOUT})`;
  document.getElementById("vault-count").textContent = `(${state.vault.length})`;

  loadoutList.innerHTML = "";
  for (let i = 0; i < MAX_LOADOUT; i++) {
    const li = document.createElement("li");
    const id = state.loadout[i];
    if (id) {
      const card = cardById(id);
      li.textContent = card ? card.name : id;
      li.className = "slot-filled";
      li.addEventListener("click", () => toggleLoadout(id));
    } else {
      li.textContent = "— empty —";
      li.className = "slot-empty";
    }
    loadoutList.appendChild(li);
  }

  vaultList.innerHTML = "";
  for (const id of state.vault) {
    const card = cardById(id);
    const li = document.createElement("li");
    li.className = "slot-filled";
    li.textContent = card ? card.name : id;
    li.addEventListener("click", () => toggleVault(id));
    vaultList.appendChild(li);
  }
}

function renderAll() {
  renderGrid();
  renderPanel();
}

function setupFilters() {
  buildChipGroup(document.getElementById("domain-filters"), domainsInPlay(), state.filters.domains);
  buildChipGroup(document.getElementById("type-filters"), TYPES, state.filters.types);

  document.getElementById("level-min").addEventListener("input", (e) => {
    state.filters.levelMin = Number(e.target.value) || 1;
    renderGrid();
  });
  document.getElementById("level-max").addEventListener("input", (e) => {
    state.filters.levelMax = Number(e.target.value) || 10;
    renderGrid();
  });
  document.getElementById("search").addEventListener("input", (e) => {
    state.filters.search = e.target.value.trim().toLowerCase();
    renderGrid();
  });
  document.getElementById("reset-filters").addEventListener("click", () => {
    state.filters.domains.clear();
    state.filters.types.clear();
    state.filters.levelMin = 1;
    state.filters.levelMax = 10;
    state.filters.search = "";
    document.getElementById("level-min").value = 1;
    document.getElementById("level-max").value = 10;
    document.getElementById("search").value = "";
    setupFilters();
    renderGrid();
  });
  document.getElementById("clear-loadout").addEventListener("click", () => {
    state.loadout = [];
    state.vault = [];
    persist();
    renderAll();
  });
}

async function init() {
  loadPersisted();
  await loadCards();
  mountContentSettings(content);
  setupFilters();
  renderAll();
}

init();
