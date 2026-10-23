// Lists the ids a hand-written character file needs, with their display names.
//
//   node tools/official-sheet/ids.mjs weapons          every weapon
//   node tools/official-sheet/ids.mjs weapons sword    only those whose name or id matches

import { readFile } from "node:fs/promises";

const FILES = ["classes", "subclasses", "ancestries", "communities", "domain-cards", "weapons", "armors", "consumables"];
const [file, filter = ""] = process.argv.slice(2);
if (!FILES.includes(file)) {
  console.error(`usage: node tools/official-sheet/ids.mjs <${FILES.join("|")}> [filter]`);
  process.exit(2);
}

const list = JSON.parse(await readFile(new URL(`../../data/${file}.json`, import.meta.url), "utf8"));
const needle = filter.toLowerCase();
for (const item of list) {
  const name = typeof item.name === "string" ? item.name : item.name["en-US"];
  // The extra column is what you'd otherwise have to look up to pick the right one.
  // An ancestry's features are what heritage.chosenFeatures names, so they're the extra column.
  const extra = file === "ancestries" ? item.features.map((f) => f.name["en-US"]).join(" / ")
    : item.class ? item.class : item.tier ? `tier ${item.tier}` : item.level ? `${item.domain} ${item.level}` : "";
  if (`${item.id} ${name}`.toLowerCase().includes(needle)) console.log(`${item.id.padEnd(48)} ${name}${extra ? `  (${extra})` : ""}`);
}
