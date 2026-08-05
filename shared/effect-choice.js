// The picker for a feature that says "choose" rather than granting something outright.
//
// Shared by the creation wizard and the level up screen so that a new entry in effects.js with
// a `choice` needs no page code at all: whichever screen owns that kind of source renders it.
// Only a genuinely new SHAPE of choice — one that isn't "pick N of these benefits" or "pick N
// of your Experiences" — would need a new branch here.
//
// Everything is wired with addEventListener; the pages ship script-src 'self'.

import { escapeHtml } from "./escape.js";

/**
 * @param {HTMLElement} container
 * @param {object} opts
 * @param {string} opts.key         the effects.js key the answer is stored under
 * @param {object} opts.choice      the `choice` block from the effect
 * @param {object} opts.answer      mutated in place; pass one from blankAnswer()
 * @param {Array}  opts.experiences [{ id, name, modifier, pending }] — only used by the
 *                                  "experience" kind, and supplied by the caller because the
 *                                  level up screen offers the Experience that level grants
 *                                  while the wizard offers the two you start with.
 * @param {Function} opts.onChange  called after every edit, to re-render and persist
 */
export function renderEffectChoice(container, { key, choice, answer, experiences = [], onChange }) {
  const prompt = document.createElement("p");
  prompt.className = "hint sub-pick-heading";
  prompt.textContent = choice.prompt;
  container.appendChild(prompt);

  if (choice.kind === "benefit") renderBenefits(container, choice, answer, onChange);
  else renderExperiences(container, key, choice, answer, experiences, onChange);
}

// "Permanently gain two of the following benefits": tick `choice.pick` of them.
function renderBenefits(container, choice, answer, onChange) {
  const list = document.createElement("div");
  list.className = "option-list";
  for (const opt of choice.options) {
    const picked = answer.optionIds.includes(opt.id);
    const disabled = !picked && answer.optionIds.length >= choice.pick;
    list.appendChild(checkboxRow(opt.label, picked, disabled, (on) => {
      if (on) answer.optionIds.push(opt.id);
      else answer.optionIds = answer.optionIds.filter((x) => x !== opt.id);
      onChange();
    }));
  }
  container.appendChild(list);
}

// "+2 to two Experiences or +3 to one": pick the shape first when there's more than one, then
// name that many Experiences. A single-shape choice (Clank's +1) skips straight to the list.
function renderExperiences(container, key, choice, answer, experiences, onChange) {
  if (choice.options.length > 1) {
    const row = document.createElement("div");
    row.className = "field-row";
    row.innerHTML = choice.options.map((o) =>
      `<label><input type="radio" name="choice-${escapeHtml(key)}" value="${escapeHtml(o.id)}" ${answer.optionId === o.id ? "checked" : ""}/> ${escapeHtml(o.label)}</label>`).join("");
    row.querySelectorAll("input").forEach((r) => r.addEventListener("change", (e) => {
      answer.optionId = e.target.value;
      answer.experienceIds = [];
      onChange();
    }));
    container.appendChild(row);
  } else if (answer.optionId !== choice.options[0].id) {
    answer.optionId = choice.options[0].id;
  }

  const option = choice.options.find((o) => o.id === answer.optionId);
  if (!option) return;

  const list = document.createElement("div");
  list.className = "option-list";
  for (const exp of experiences) {
    const picked = answer.experienceIds.includes(exp.id);
    const name = exp.name?.trim() || (exp.pending ? "(the new Experience from this level)" : "(unnamed)");
    const label = `${name}  +${exp.modifier ?? 2}`;
    // Picking exactly one is a radio: with checkboxes, changing your mind means unticking
    // first, because the other rows go disabled as soon as the quota is full.
    if (option.pick === 1) {
      list.appendChild(pickRow("radio", `exp-${key}`, label, picked, false, () => {
        answer.experienceIds = [exp.id];
        onChange();
      }));
    } else {
      const disabled = !picked && answer.experienceIds.length >= option.pick;
      list.appendChild(pickRow("checkbox", null, label, picked, disabled, (on) => {
        if (on) answer.experienceIds.push(exp.id);
        else answer.experienceIds = answer.experienceIds.filter((x) => x !== exp.id);
        onChange();
      }));
    }
  }
  container.appendChild(list);
}

function checkboxRow(label, checked, disabled, onToggle) {
  return pickRow("checkbox", null, label, checked, disabled, onToggle);
}

function pickRow(type, name, label, checked, disabled, onToggle) {
  const row = document.createElement("label");
  row.className = "option-row";
  const nameAttr = name ? ` name="${escapeHtml(name)}"` : "";
  row.innerHTML = `<input type="${type}"${nameAttr} ${checked ? "checked" : ""} ${disabled ? "disabled" : ""}/> ${escapeHtml(label)}`;
  row.querySelector("input").addEventListener("change", (e) => onToggle(e.target.checked));
  return row;
}
