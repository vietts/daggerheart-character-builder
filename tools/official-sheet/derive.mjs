// Step one of filling the official PDF sheets: turn the app's "Export JSON" file into the
// flat display objects shared/sheet-data.js already builds for sheet.html, one per character,
// printed to stdout as JSON. No arithmetic here — deriveSheet() is the one place the numbers
// come from, so the official sheet can't disagree with the app's own printable sheet.
//
//   node tools/official-sheet/derive.mjs characters.json > sheets.json

import { readFile } from "node:fs/promises";
import { parseImport } from "../../shared/transfer.js";
import { deriveSheet } from "../../shared/sheet-data.js";

const root = new URL("../../data/", import.meta.url);
const load = async (name) => JSON.parse(await readFile(new URL(`${name}.json`, root), "utf8"));

const [file] = process.argv.slice(2);
if (!file) {
  console.error("usage: node tools/official-sheet/derive.mjs <export.json>");
  process.exit(2);
}

const { characters, errors } = parseImport(await readFile(file, "utf8"));
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

const [classes, subclasses, ancestries, communities, domainCards, weapons, armors, consumables] = await Promise.all(
  ["classes", "subclasses", "ancestries", "communities", "domain-cards", "weapons", "armors", "consumables"].map(load),
);
const db = { classes, subclasses, ancestries, communities, domainCards, weapons, armors, consumables };

// classId travels along: the official sheets are one PDF per class, so the filler needs it
// to pick the template, and deriveSheet() only exposes the display name. The armor's base
// numbers too: the official sheet has a "base thresholds / base score" slot on the armor line,
// separate from the level-adjusted thresholds deriveSheet() reports.
const sheets = characters.map((ch) => {
  const armor = armors.find((a) => a.id === ch.equipment?.armorId);
  return {
    id: ch.id,
    classId: ch.classId,
    armorBase: armor
      ? { major: armor.baseMajorThreshold, severe: armor.baseSevereThreshold, score: armor.baseScore }
      : null,
    ...deriveSheet(ch, db),
  };
});
console.log(JSON.stringify(sheets, null, 2));
