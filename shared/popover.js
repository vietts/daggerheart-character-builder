// The shared centered modal, plus the "where does this number come from?" breakdown that
// opens in it from the ? next to a stat.
// Same shape as lightbox.js: one overlay created lazily and reused by every page, closed by
// its button, by clicking outside it, or by Escape.
//
// Everything is wired with addEventListener and class names — the pages ship a strict CSP
// (script-src 'self'), so no inline handlers and no style attributes.

import { escapeHtml } from "./escape.js";

let overlay = null;
let titleEl = null;
let bodyEl = null;

function ensureOverlay() {
  if (overlay) return;
  overlay = document.createElement("div");
  overlay.className = "popover-overlay";
  overlay.innerHTML = `
    <div class="popover-panel" role="dialog" aria-modal="true">
      <button class="popover-close" aria-label="Close">×</button>
      <h4 class="popover-title"></h4>
      <div class="popover-body"></div>
    </div>
  `;
  titleEl = overlay.querySelector(".popover-title");
  bodyEl = overlay.querySelector(".popover-body");

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closePopover();
  });
  overlay.querySelector(".popover-close").addEventListener("click", closePopover);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("open")) closePopover();
  });

  document.body.appendChild(overlay);
}

const signed = (n) => (n > 0 ? `+${n}` : String(n));

/**
 * Opens the modal with a title and whatever body the caller wants in it.
 * @param {string} title
 * @param {Node|string} body a node to append, or HTML the caller has already escaped
 */
export function openModal(title, body) {
  ensureOverlay();
  titleEl.textContent = title;
  bodyEl.innerHTML = "";
  if (body instanceof Node) bodyEl.appendChild(body);
  else bodyEl.innerHTML = body;
  overlay.classList.add("open");
}

/**
 * @param {string} title the stat's name
 * @param {{ total: number|string, parts: Array<{label: string, value: number}>, note?: string }} breakdown
 */
export function openPopover(title, breakdown) {
  const rows = (breakdown.parts || [])
    .map((p) => `<div class="popover-row"><span>${escapeHtml(p.label)}</span><strong>${escapeHtml(signed(p.value))}</strong></div>`)
    .join("");
  // A single-source stat still answers a real question ("why is my Evasion 12?"), but a
  // total line under one row is just the same number twice.
  const total = (breakdown.parts || []).length > 1
    ? `<div class="popover-row popover-total"><span>Total</span><strong>${escapeHtml(breakdown.total)}</strong></div>`
    : "";
  const note = breakdown.note ? `<p class="popover-note">${escapeHtml(breakdown.note)}</p>` : "";

  openModal(title, rows + total + note);
}

export function closePopover() {
  if (overlay) overlay.classList.remove("open");
}
