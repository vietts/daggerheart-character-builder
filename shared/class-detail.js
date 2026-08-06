// A class's full details, opened from the ⓘ on the creation wizard's class tiles so a player
// can compare classes before committing to one. Read-only: it renders a class record and never
// touches the character.
//
// It's the first thing in the app to show description, classItems, hopeFeature and
// classFeatures — until now only startingEvasion and startingHitPoints were ever read.

import { escapeHtml } from "./escape.js";
import { descriptionHtml, featuresHtml } from "./card-render.js";
import { statLine } from "./stat-line.js";
import { openModal } from "./popover.js";

// classes.json ships names and domains as plain uppercase strings ("BARD", ["GRACE"]), where
// every other data file uses localized objects — hence the same one-liner create.js and
// characters.js each keep.
function titleCase(str) {
  return str.charAt(0) + str.slice(1).toLowerCase();
}

function section(heading, bodyHtml) {
  const el = document.createElement("section");
  el.className = "class-detail-section";
  el.innerHTML = `<h5 class="class-detail-heading">${escapeHtml(heading)}</h5>${bodyHtml}`;
  return el;
}

function classDetailCard(cls) {
  const card = document.createElement("div");
  card.className = "class-detail";

  const blurb = document.createElement("div");
  blurb.className = "class-detail-blurb";
  blurb.innerHTML = descriptionHtml(cls.description);
  card.appendChild(blurb);

  // The same tiles the sheet and the wizard's derived step use, so a starting number reads the
  // same way wherever it appears. No breakdown: these are the class's printed values, with
  // nothing yet to explain.
  const stats = document.createElement("div");
  stats.className = "derived-box class-detail-stats";
  stats.appendChild(statLine("Domains", cls.domains.map(titleCase).join(" · ")));
  stats.appendChild(statLine("Starting Evasion", cls.startingEvasion));
  stats.appendChild(statLine("Starting Hit Points", cls.startingHitPoints));
  card.appendChild(stats);

  const items = (cls.classItems || [])
    .map((item) => `<li>${escapeHtml(item?.["en-US"] || "")}</li>`)
    .join("");
  if (items) card.appendChild(section("Class Items", `<ul class="class-detail-items">${items}</ul>`));

  if (cls.hopeFeature) {
    card.appendChild(section("Hope Feature", `<div class="fallback-features">${featuresHtml([cls.hopeFeature])}</div>`));
  }
  if ((cls.classFeatures || []).length > 0) {
    card.appendChild(section("Class Features", `<div class="fallback-features">${featuresHtml(cls.classFeatures)}</div>`));
  }

  return card;
}

/**
 * @param {object} cls a record from data/classes.json
 */
export function openClassDetail(cls) {
  openModal(titleCase(cls.name), classDetailCard(cls));
}
