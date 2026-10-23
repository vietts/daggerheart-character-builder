# Official sheet filler

Writes characters from the app onto the official Daggerheart character sheets, for pregens.

1. In the app, Characters → **Export JSON** (all characters).
2. Download *Character Sheets and Guides* from daggerheart.com (the Aug 2025 edition — the
   page numbers in `fill.py` are that edition's). Keep it out of the repository: its art is
   Prohibited Content under the DPCGL (see `NOTICE.md`).
3. Run:

   ```sh
   python3 tools/official-sheet/fill.py --template Character-Sheets-and-Guides.pdf \
       --characters daggerheart-characters.json --out pregens/
   ```

Needs Node (for `derive.mjs`, which reuses `shared/sheet-data.js`) and Python with `pypdf`
and `reportlab`.

Out comes one PDF per character, plus `all-pregens.pdf` when there are several:

- the class's own sheet, filled in; a Druid also gets the Beastform pages, a Beastbound Ranger
  the companion page. Classes without their own sheet (Witch, Assassin, Warlock, Brawler) use
  the blank generic sheet, with the Hope and class features written in;
- a plain page with the text the sheet has no room for: subclass, heritage and domain card
  features, background. `--no-reference` leaves it out.

Hope, armor slots and gold beyond the starting handful are left for the players to mark.
