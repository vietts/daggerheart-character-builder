# Official sheet filler

Writes characters onto the official Daggerheart character sheets, for pregens.

```sh
python3 tools/official-sheet/fill.py --template Character-Sheets-and-Guides.pdf \
    --characters pregens.json --out pregens/
```

- `--template`: *Character Sheets and Guides* from daggerheart.com, the Aug 2025 edition (the
  page numbers in `fill.py` are that edition's). Keep it out of the repository: its art is
  Prohibited Content under the DPCGL (see `NOTICE.md`).
- `--characters`: a JSON file of characters, described below.
- `--out`: where the PDFs go, one per character plus `all-pregens.pdf` when there are several.
- `--no-reference`: leave out the extra text page (see *What comes out*).

Needs Node (for `derive.mjs`, which reuses `shared/sheet-data.js`, so the numbers match the
app's own sheet) and Python with `pypdf` and `reportlab`.

## The characters file

There are two ways to get one.

### A. Build them in the app, then export (easiest)

Create each pregen with the character creator (and level them up, if the one-shot isn't at
level 1), then press **Export JSON** at the top of the character list: it exports them all
(the **Export** on a single row exports just that one). That file goes straight to
`--characters`.

This is the safer route: the wizard applies the creation rules (trait array, mixed ancestry,
starting cards, what each level up allows), and it asks for the few choices some features
need, such as the Clank's *Purposeful Design*.

### B. Write the file by hand

Handy while you're still thinking the pregens through: a text file is quick to edit and
regenerate. Start from [`example-pregens.json`](example-pregens.json), which has a level 1 Bard
and a level 3 Warrior, and change it.

The file is the same format the app exports, so you can also go back and forth: press
**Import JSON** in the app to load a hand-written file, check or fix the characters there,
export again.

#### The file

```json
{
  "format": "dh-characters",
  "version": 1,
  "characters": [ { ...one character... }, { ...another... } ]
}
```

Leave `format` and `version` exactly as they are.

#### One character

```json
{
  "id": "lyra",
  "name": "Lyra Vantis",
  "pronouns": "she/her",
  "level": 1,
  "classId": "core_class_bard",
  "subclassId": "core_subclass_troubadour",
  "traits": { "agility": 0, "strength": -1, "finesse": 1, "instinct": 0, "presence": 2, "knowledge": 1 },
  "heritage": {
    "ancestryIds": ["core_ancestry_elf"],
    "chosenFeatures": [
      { "ancestryId": "core_ancestry_elf", "featureName": "Quick Reactions" },
      { "ancestryId": "core_ancestry_elf", "featureName": "Celestial Trance" }
    ],
    "communityId": "core_community_highborne"
  },
  "equipment": {
    "primaryWeaponId": "core_weapon_rapier",
    "secondaryWeaponId": "core_weapon_small_dagger",
    "armorId": "core_armor_gambeson_armor",
    "potionChoice": "core_consumable_minor_health_potion"
  },
  "experiences": [
    { "name": "Smuggler", "modifier": 2 },
    { "name": "Silver Tongue", "modifier": 2 }
  ],
  "domainCardIds": ["core_domain_card_inspirational_words", "core_domain_card_book_of_ava"],
  "background": { "description": "Grew up on the docks; owes a debt to a smuggler queen.", "answers": "" },
  "connectionsNotes": ""
}
```

| Field | What goes in it |
| --- | --- |
| `id` | Any short text, different for each character. Only used to tell them apart. |
| `name`, `pronouns` | Printed as written. |
| `level` | 1 to 10. Damage thresholds are the armor's plus this. |
| `classId`, `subclassId` | Ids, see *Finding ids*. The subclass has to belong to the class. |
| `traits` | The six traits. At level 1 the book's array: +2, +1, +1, 0, 0, −1, in any order. Don't include bonuses from armor, ancestry or cards: those are added for you. |
| `heritage.ancestryIds` | One ancestry, or two for a mixed ancestry. |
| `heritage.chosenFeatures` | The ancestry features the character has, by name as `ids.mjs ancestries` prints them. One ancestry: both of its features. Mixed: one from each (the book says the first feature of one and the second of the other). |
| `heritage.communityId` | One community. |
| `equipment.primaryWeaponId` | A weapon id, or `"unarmed"`. |
| `equipment.secondaryWeaponId` | A weapon id, or `null` for none. |
| `equipment.armorId` | An armor id, or `"unarmored"`. |
| `equipment.potionChoice` | `core_consumable_minor_health_potion` or `core_consumable_minor_stamina_potion` (the starting choice), or `null`. |
| `experiences` | Name and modifier of each. +2 each at creation. |
| `domainCardIds` | The cards in the loadout. Two at level 1, from the class's two domains. |
| `background.description`, `background.answers`, `connectionsNotes` | Free text, printed on the extra page. Use `""` for nothing. |

Every name and number on the sheet is worked out from these: Evasion, Hit Points, Stress,
Armor Score, thresholds, attack bonuses and damage dice. Never type them in.

#### Finding ids

```sh
node tools/official-sheet/ids.mjs classes
node tools/official-sheet/ids.mjs subclasses            # with the class each belongs to
node tools/official-sheet/ids.mjs ancestries            # with their two features
node tools/official-sheet/ids.mjs communities
node tools/official-sheet/ids.mjs weapons dagger        # a second word filters the list
node tools/official-sheet/ids.mjs armors
node tools/official-sheet/ids.mjs domain-cards blade    # with domain and level
node tools/official-sheet/ids.mjs consumables potion
```

Weapons and armor show their tier: at level 1 pick tier 1.

#### Pregens above level 1

Add the level up results directly instead of a level up history:

| Field | What goes in it |
| --- | --- |
| `level` | The level. |
| `proficiency` | 1 at level 1, plus 1 at levels 2, 5 and 8, plus any level up option that raised it. |
| `traits` | Include the +1s from level ups. |
| `hitPointSlotsBonus`, `stressSlotsBonus`, `evasionBonus` | How many times a level up raised each one. Leave out what stays at 0. |
| `subclassTier` | `"foundation"`, `"specialization"` or `"mastery"`, if the subclass card was upgraded. |
| `experiences` | Add the new Experience from levels 2, 5 and 8, and the +1s on the ones that were raised. |
| `domainCardIds` | One more card per level, from the class's domains and of that level or lower. |
| `domainVaultIds` | Past 5 cards, the ones in the vault: list them in `domainCardIds` too, and here. Only the loadout prints. |

The script doesn't check that these follow the level up rules: it prints what it's given. For
a high-level pregen, route A is the reliable one.

#### Features that ask for a choice

A few features need an answer before they do anything: the Clank's *Purposeful Design*, the
*Vitality* and *Master of the Craft* cards. A hand-written file has no answer for them, so the
extra page starts with a "Still to choose" line naming them. Answer them in the app (import,
edit, export) or tell the player at the table.

#### Mistakes

A wrong id or a misspelt feature name doesn't stop the script: the PDF still comes out, with
an empty spot where it should be. The script says which one it was, before the list of files:

```
Lyra Vantis: unknown equipment.primaryWeaponId "core_weapon_rapierz"
Brann: Orc has no feature "Tusk"
```

Invalid JSON (a missing comma, a trailing comma) stops it with *This file is not valid JSON*.

## What comes out

- The class's own sheet, filled in. A Druid also gets the Beastform pages; a Beastbound Ranger
  the companion page. Classes without their own sheet (Witch, Assassin, Warlock, Brawler) use
  the blank generic sheet, with the Hope and class features written in.
- A plain page with the text the sheet has no room for: subclass, heritage and domain card
  features, background, connections. `--no-reference` leaves it out.

Hope, armor slots and gold beyond the starting handful are left for the players to mark.
