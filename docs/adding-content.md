# Adding a content source

`data/` holds one folder per **source**. The SRD ships as two of them — `data/srd_1_0/` and
`data/srd_2_0/`, one per edition — and anything you put beside them (playtest material, homebrew, a
single revised card you want to try at your table) is loaded and merged the same way, with no code
change anywhere.

The folder's name is its identity. Nothing in the app knows the name of any source but the SRD's;
a source exists because a folder does.

Two things are true throughout, and they are what make the rest safe:

- **Everything found on disk is always loaded and always looked up.** The on/off switches in the
  Content panel filter what the *pickers offer*, and nothing else.
- **A character stores bare ids with no record of where they came from.** So a source that stopped
  loading would leave holes in a character built with it. That's why switching one off hides it
  from the pickers rather than unloading it.

## 1. Make the folder

```
data/my-homebrew/
  source.json
  domain-cards.json
```

Only `source.json` is required. Ship as few or as many of the record files as you like.

## 2. Name it in a manifest

`data/sources.json` is the tracked list, in precedence order:

```json
["srd_1_0", "srd_2_0", "my-homebrew"]
```

Later wins. A source further down the list revises what an earlier one said.

If you'd rather not edit a tracked file — so `git status` stays clean and a `git pull` never
conflicts — opt in to a local list instead:

```json
{ "sources": ["srd_1_0", "srd_2_0"], "local": true }
```

With `"local": true`, the app also reads `data/sources.local.json`, which is gitignored and yours:

```json
["my-homebrew"]
```

The flag is opt-in on purpose. Without it the app would look for a gitignored file that almost
nobody has and log a 404 on every page load; with it, the file is there, so it doesn't 404 for you
either.

A folder name goes straight into a fetch URL, so anything that could climb out of `data/` — a
`../`, a `/` — is dropped rather than escaped.

## 3. Declare what the folder holds: `source.json`

```json
{
  "label": "My Homebrew",
  "files": ["domain-cards", "effects"]
}
```

- **`label`** is what the Content panel calls it. Without one it's called after the folder.
- **`files`** lists what to fetch. Naming only what you have means a folder with one card file
  costs one fetch and no 404s. A name the app doesn't recognise is ignored.

The nine record files are `classes`, `subclasses`, `ancestries`, `communities`,
`transformations`, `domain-cards`, `weapons`, `armors`, `consumables`, plus `effects` (see §6).

## 4. The record shapes

Each file is a JSON array. The SRD's own files under `data/srd_2_0/` are the reference — copy
the shape of the nearest record and you'll be right.

Every record needs an **`id`** that is unique across every source you load (see §5).

Most names are localized objects:

```json
{ "id": "hb_card_ironhide", "name": { "en-US": "Ironhide" }, "domain": "BLADE", "level": 1 }
```

**`transformations.json` is shaped like an ancestry** — a name, a description, and features.
A transformation is an optional, permanent change to what a character IS: it sits with the
heritage rather than in the loadout, a character can hold one or none, and the wizard grows a
Transformation step whenever any loaded source provides them. Both of its features always apply;
there is nothing to choose between them and no vault to take one out of.

**`classes.json` is the exception.** Its top-level `name` is a bare uppercase string:

```json
{ "id": "hb_class_witch", "name": "WITCH", "domains": ["MIDNIGHT", "ARCANA"] }
```

That isn't an inconsistency to fix — a class name is a *relational key*. `subclasses[].class` holds
`"BARD"` and the wizard joins on it. Because writing a class the way every other file is written is
the most natural mistake there is, the loader accepts both and coerces it, but the uppercase string
is the real shape.

### What validation does and doesn't do

A record is checked only for the fields whose absence would kill a screen — a renderer reads them
without checking, so a missing one is a dead page rather than a missing card:

| file | must have |
|---|---|
| `classes` | `id`, `name`, `domains` |
| `subclasses` | `id`, `name`, `class` |
| `domain-cards` | `id`, `name`, `domain` |
| `transformations` | `id`, `name` |
| everything else | `id`, `name` |

A record that fails is skipped, and the Content panel names it and says why. The rest of the file
still loads.

**A domain nobody has heard of is not an error.** Bringing a new domain is exactly what a source is
for; the card browser grows a filter chip for it on its own. This is deliberately not a second
definition of the data format to keep in step with the real one.

## 5. Ids, and what replaces what

A record's id begins with the name of the document that published it — `srd_2_0_weapon_broadsword`
— and ids are global across sources. That is the mechanism:

- **A new id adds a record.**
- **A repeated id replaces it**, in the position the original held, and the original is kept behind
  it — switch your source off and the earlier version comes back.
- **A repeated NAME also replaces it**, even under a different id. That is what makes the two SRD
  editions usable together: an id names the document it came from, so SRD 2.0's Vitality is a
  different string from SRD 1.0's, and only the name says they are one card. Without it, loading
  both editions would list every shared card, weapon, armor and potion twice.

A subclass is qualified by its class, since subclass names are only unique within one — a homebrew
Bard subclass called "Wayfinder" won't silently replace the Ranger's. Classes have always collided
by name, because subclasses join to classes by name rather than id.

Prefix your own ids (`hb_`, or your folder's name) unless you specifically mean to override
something. The Content panel lists what took over what, so an accidental collision is visible
rather than silent.

**Your ids survive an edition change.** A character stores bare ids, so when the loaded editions
move, `shared/content-ids.js` re-points any id that no longer resolves at the record that does —
matching on the part after the document prefix. An id that still resolves is never touched, which is
what lets someone deliberately keep the SRD 1.0 weapon that SRD 2.0 dropped.

## 6. `effects.json` — making a bonus actually count

Record files carry a card's *text*. If a card changes a *number* on the sheet, say so here.

`shared/effects.js` is the built-in catalogue for the SRD. A source's `effects.json` overlays it:
your entry wins for the keys it names, and everything else is untouched.

```json
{
  "hb_card_ironhide": { "armorScore": 1, "permanent": true },
  "domain_card_untouchable": { "evasion": 2 }
}
```

Keys are the same ones `shared/effects.js` uses — read it for the full list; the common cases are a
domain card's id, `<subclassId>:foundation`, and `armor:<Feature Name>`.

Write the id **without its document prefix**: `domain_card_vitality`, not
`srd_2_0_domain_card_vitality`. An effect belongs to the card, not to the edition that printed it, so
one entry serves every edition that prints it.

### The whole vocabulary

| key | what it means |
|---|---|
| any stat key | a plain number: `evasion`, `hitPointSlots`, `stressSlots`, `majorThreshold`, `severeThreshold`, `armorScore`, `attack`, `spellcast`, `extraDomainCards` |
| `permanent` | the bonus applies even from the vault — without it a card whose text says the change is permanent silently stops counting the moment it's vaulted |
| `feature` | which named feature of the record this encodes, for the "?" breakdown |
| `excluded` | benefits you deliberately didn't encode, so the breakdown can say why nothing changed |
| `choice` | a whole "pick N" question, rendered with no page code at all |

Anything else is refused, and the Content panel says which entry and why. That's on purpose: a key
with no code behind it would validate, ship, and quietly do nothing.

## 7. What JSON deliberately can't express

**`when`** — a condition — is refused rather than ignored. JSON can't carry a predicate, and
silently dropping the condition would make a bonus apply when it shouldn't. State the bonus
unconditionally, or leave it out and let the card's text speak for itself.

This is the honest boundary of the format: anything conditional on what's happening *at the table*
is printed as rules text and applied by the player. That's the same treatment equipment features
already get.

## 8. Card art

Art lives with the content it belongs to, under `domain/`, `subclass/`, `community/`,
`ancestry/` and `transformation/`:

```
data/my-homebrew/card-art/domain/hb_card_ironhide.png
```

`data/*/card-art/` is gitignored for every source, and card artwork is Prohibited Content under the
DPCGL — see [`../CONTRIBUTING.md`](../CONTRIBUTING.md). A card with no art file renders as the
CSS-only card, which is a complete card, just plainer.

There is deliberately **no fallback to the SRD's art** for a card you revised. Those files are whole
card faces with the rules text baked in, so showing the old picture would print superseded text
while the app applied your new numbers. Copy the file into your folder if you do want it.

## 9. Switching a source off doesn't unbuild characters

The Content panel switches sources off for the *pickers*. A character already built with one keeps
its class, its cards, its text and its stats, because the records are still loaded and still found
by id.

What does break a character is **deleting the folder**. The app is otherwise quiet about data it
can't find, so the character list says so by name when ids no longer resolve.

## 10. Checking it worked

Open **Content** in the top bar. It reports, per source: what loaded and how much of it, any record
it skipped and why, anything one source took over from another, and any effects entry it refused.

If a source isn't listed at all, it isn't in a manifest or its `source.json` couldn't be read —
which the same panel says, under "Content that couldn't be read".
