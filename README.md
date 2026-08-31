# Daggerheart Character Builder

[![tests](https://github.com/vietts/daggerheart-character-builder/actions/workflows/tests.yml/badge.svg)](https://github.com/vietts/daggerheart-character-builder/actions/workflows/tests.yml)

A small, framework-free web app for browsing Daggerheart domain cards and building/leveling up characters — a companion tool for players and GMs running the *Daggerheart* tabletop RPG.

Built out of a personal need: converting a tabletop party from D&D 5e to Daggerheart. Sharing it in case it's useful to anyone else going through the same switch.

## What it does

- **Card browser** (`index.html`) — filter the 189 domain cards by domain, type, and level; build a 5-card loadout plus a vault, saved locally.
- **Character creator** (`create.html`) — a 9-step wizard following the Core Rulebook's character creation steps exactly (class → subclass, ancestry/community, traits, derived stats, equipment, background, experience, domain cards, connections), with the same validations the book describes (fixed trait array, mixed-ancestry rule, etc.). The equipment step is also where you upgrade gear later: it offers every tier, with your own already open, and each weapon states its trait, range, damage and burden. Weapon burden is shown and warned about rather than enforced — a Warrior's Combat Training ignores it, and what your character can carry is your GM's call. Going unarmored or fighting unarmed are both choices you can make, with the rules that come with them (including `Bare Bones`).
- **Character list & sheet** (`characters.html`) — save multiple characters locally, view a read-only sheet showing what each piece of your gear does, export a CSV summary for your GM, and **move characters between browsers as JSON** (Export JSON for one or all, Import JSON to load them back — a character that already exists here can be replaced or kept alongside the import). From here you can also set, replace or remove a character's portrait — a photo picked from the device, shrunk to fit and kept with the character; Export JSON takes it along. The sheet shows every subclass card you've earned, since an upgrade adds a card rather than replacing the one below it. Every stat that a card can modify has a **?** next to it that shows the modifications that have been applied. The numbers include what your ancestry, subclass, equipment and domain card loadout do to them.
- **Printable sheet** (`sheet.html?id=<character>`, linked as "Print sheet") — a print-first, two-page A4 character sheet with no art: identity, traits, defenses, weapons, experiences and loadout names on page one, with empty pen-fillable circles for HP/Stress/Hope; the full rules text of your loadout cards and features on page two, so the table doesn't need the app open to look anything up.
- **At the table** (`play.html?id=<character>`, linked as "Play") — the character on a phone during a session, styled after the [Foundryborne](https://github.com/Foundryborne/daggerheart) Daggerheart sheet (MIT; fonts under the OFL in `assets/fonts/`): name, level and heritage, the portrait if the character has one (set from the character list), Hope diamonds you tap, the class domains, the six traits on shields (with the tier mark), then tabs — **Status** (HP and Stress pips, Evasion, Armor shields, Proficiency, thresholds, the SRD conditions — Vulnerable, Hidden, Restrained — as toggles with their effect spelled out, experiences, a **Rest** you can take, and free-text session notes saved as you type), **Weapons**, **Cards** (the loadout's full text) and **Features**. Tap a pip to mark up to it, tap a marked one to clear it and the ones after. Long-press a Hope diamond (right-click, or Alt+Enter from the keyboard) to scar it: the slot is crossed out for good, as Avoid Death does in the SRD — it asks before it marks one, and frees one without asking. The page's own labels come in English and Italian (`shared/i18n.js`): it follows `<html lang>`, or `?lang=it` / `?lang=en` on the URL; game data stays in the language of the data files. A rest is the SRD's downtime (p. 105): pick a short or a long rest, then take two moves from its menu — the same move twice is allowed. The long rest's are flat (clear all Hit Points, all Stress, all Armor Slots), the short rest's clear *1d4 + your tier*, and that die is the one thing the page rolls: it prints the roll and the tier next to what it actually cleared, so it can be checked against the die on the table. Prepare is offered alone (+1 Hope) and with the party (+2). Work on a Project is listed for completeness — the countdown it ticks is the GM's, so the sheet doesn't change. Nothing about a rest clears a condition: the SRD's downtime moves don't, and the app doesn't invent rules.

**Undo** in the toolbar steps back the last ten changes — a tap on the wrong box clears every mark after it, and that used to be unrecoverable. It covers taps, conditions, scars and rest moves; the notes field is left to the browser's own undo, since saving on every keystroke would fill the history with steps nobody wants.

The marks are saved with the character; the maxima always come from the current sheet, so a level up or an armor change resizes the rows.
- **Level up** (`level-up.html`) — levels 1–10 following the official advancement rules (tiers, level achievements at 2/5/8, the generic per-tier advancement options with their slot limits). Advancements are marked on a grid laid out like the one printed on the character sheet. A collapsible **Level history** on the character sheet shows which level marked each advancement slot and lets you go back and change any past level up decision. Multiclassing is intentionally not implemented — it's rare in play and would add a lot of complexity for little benefit in a tool this size.

Everything is static HTML/CSS/vanilla JS (ES modules), no build step, no backend. All data lives in `localStorage` in your own browser — nothing is sent anywhere.

## Running it

```
python3 -m http.server 8080
```

then open `http://localhost:8080`. Any static file server works.

If a page ever looks broken after you pull an update — buttons that render but do
nothing — your browser is mixing cached files with fresh ones. A hard reload
(Ctrl+Shift+R) fixes it, or run this instead, which tells the browser not to cache
at all:

```
python3 serve.py 8080
```

## Contributing

Pull requests welcome. [`CONTRIBUTING.md`](CONTRIBUTING.md) has how to run it, where code goes, and the one house rule that will look unusual (comments say *why*, not *what*).

## Tests

Open `tests/index.html` in the browser — that's all (or run `node tests/node-runner.mjs` from a terminal, `npm test` for short: same suite, text report, exit code 1 on failure). GitHub Actions runs that same command on every push and pull request. It checks the advancement rules, the level history replay, the derived stats and the effects catalogue in `shared/advancement.js`, `shared/history.js`, `shared/derived-stats.js`, `shared/effects.js`, `shared/table-state.js` and `shared/transfer.js` against hand-written fixtures. No dependencies, no build step, nothing to install, and nothing the app itself loads — `package.json` exists only to give those two commands a short name, and has no dependency section to install. If you delete the `tests/` directory, the app is completely unaffected.

## Security notes

The app has no backend and no accounts: every character lives in the `localStorage`
of the browser that created it. There is no server-side data to breach, and hosting
it does **not** give the group a shared character store — each player sees only their
own browser's characters.

### If you expose it beyond localhost

`python3 -m http.server` is a development server — single-threaded, no TLS, no access
control. For a group, put a real static server in front (nginx, Caddy, Apache) and
serve over HTTPS. Send the headers a `<meta>` tag cannot, for example in nginx:

```nginx
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "no-referrer" always;
add_header Strict-Transport-Security "max-age=31536000" always;
```

`frame-ancestors` only works as a real header (it is ignored in a `<meta>` tag), so
this is what actually stops the app being framed by another site.

There is no authentication: anyone who can reach the URL can use the builder. Since
nothing is stored server-side that is mostly a non-issue, but put it behind your LAN,
a VPN, or HTTP basic auth if you would rather it not be public.

`style.css` pulls a font from Google Fonts, which means every page load reveals each
player's IP and user agent to Google. Self-host the font (or drop the `@import` and
fall back to the system stack) if that matters to you — and tighten `style-src` and
`font-src` to `'self'` if you do.

## About the card art

This repository does **not** include card artwork. Under the [Darrington Press Community Gaming License](https://darringtonpress.com/license/), artwork, illustrations and imagery are explicitly listed as Prohibited Content — they cannot be redistributed, even in fan projects. Only the text/mechanics of the SRD (names, stats, rules text) may be reused, which is what the `data/srd_*/` files contain.

Without art, cards render with a clean CSS-only fallback (domain-colored border, name, level, and rules text) — the app is fully usable this way.

If you own the official Core Rulebook PDF, you could write your own script to crop the card art out of it for **strictly personal, local use** — the book's "full art cards" gallery pages use a fixed grid layout, so it's a fairly mechanical image-cropping job (e.g. with `pdftoppm` + `Pillow`). That's outside the scope of what's shared here.

## Data source

The SRD ships as **one folder per edition**: `data/srd_1_0/` (601 records) and `data/srd_2_0/` (858). They're built from the community-maintained [`daggersearch/daggerheart-data`](https://github.com/daggersearch/daggerheart-data) dataset — full credit to that project for structuring the SRD as clean JSON in the first place — and a record's id names the document it came from, so `srd_2_0_domain_card_vitality` is SRD 2.0's printing of a card SRD 1.0 also has.

Both are on by default, and SRD 2.0 wins wherever they overlap, so you get current rules without losing anything: SRD 2.0 dropped nine Tier 3 magic weapons that SRD 1.0 has, and leaving both on keeps them selectable. Switch SRD 1.0 off in the **Content** panel for the current rules alone.

The **Hope & Fear** content — Witch, Assassin, Warlock and Brawler with their subclasses, the Dread domain's 21 cards, six ancestries and six communities — is part of `data/srd_2_0/`, because SRD 2.0 is the document that publishes it.

It used to come from the `the_void` release of the same dataset, and that mattered: **The Void is Darrington Press's playtest imprint**, so its text is the pre-publication version. Three of those records differ in the published SRD, and one of them changes play — the Brawler's Hope feature was *Staggering Strike* (3 Hope on a successful attack, Stagger and Stress) and is *Square Up* in SRD 2.0 (3 Hope to intimidate at Close range, target becomes Vulnerable). The Assassin's *Grim Resolve* is *Deadly Determination*; the Warlock's *Warlock Patron* is *Patron's Pact*. These records are now transcribed from SRD 2.0, and `tests/tests.js` checks the published wording so a playtest reprint can't come back unnoticed.

The one thing that doesn't pick the new classes up automatically is `shared/effects.js`, the catalogue of features that change a number on the sheet: their features are printed as rules text and applied by hand, like equipment features already are. Transformations (a Hope & Fear concept) aren't modelled yet.

One deliberate divergence from the dataset, in each edition's `classes.json`: the Guardian's *Unstoppable* was split across two `classFeatures` entries, the second of which carried the lead-in sentence "While Unstoppable, you gain the following benefits:" in its `name` field rather than its description. Anywhere feature names are listed on their own — the printable sheet's summary strip, for one — that sentence turned up as if it were the name of a second feature. The two entries are merged here into one, with the lead-in as a paragraph before the list it introduces. It's the only feature in the whole dataset whose name is a sentence, so re-exporting from upstream means re-applying this.

## Adding your own content

`data/` holds one folder per **source**. The two SRD editions are two of them; any folder you put
beside them and name in `data/sources.json` is loaded and merged the same way — homebrew, playtest material, or a
single revised card you want to try at your table. No code change anywhere, and the app knows the
name of no source but the SRD's.

A later source revises what an earlier one said, so you can correct or replace a record without
touching the SRD files. The **Content** button in the top bar lists what loaded, what one source
took over from another, and anything that couldn't be read — and switches a source off, which
changes what the pickers offer and nothing else. Characters already built with it keep their cards,
their text and their stats.

Full instructions, including the record shapes and how to make a homebrew card change a number on
the sheet, are in [`docs/adding-content.md`](docs/adding-content.md).

## License

The code in this repository is MIT-licensed (see `LICENSE`). The SRD content in `data/srd_1_0/` and `data/srd_2_0/` is © Critical Role, LLC., used under the Darrington Press Community Gaming License — the notice that licence asks for, along with what this project changed and what it deliberately leaves out, is in [`NOTICE.md`](NOTICE.md). This is an unofficial, fan-made tool, neither affiliated with nor endorsed by Darrington Press or Critical Role.
