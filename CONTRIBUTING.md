# Contributing

Thanks for looking. This is a small, deliberately old-fashioned app: static pages, no
framework, no build step, no backend. Most of what follows is just the shape the code
already has, written down so you don't have to infer it from reading.

## Running it

```sh
npm run serve     # or: python3 serve.py
```

then `http://localhost:8080`. It has to be served over http — the pages are ES modules, and
`file://` won't load them. Any static server works; `serve.py` is the one in this repo because
it also sends no-cache headers, which saves you the half hour where a page half-works because
the browser mixed a fresh module with a cached one. There is nothing to install: `package.json`
has no dependencies and exists only to give two commands a short name.

## Tests

```sh
npm test          # or: node tests/node-runner.mjs
```

Same suite runs in a browser at `tests/index.html`. GitHub Actions runs it on every pull
request, so a red check means the suite, not a flake.

The suite is hand-written fixtures in one file, `tests/tests.js`, in `group()` blocks of
`check()` and `eq()` calls. **New rules or arithmetic come with a group.** Its label is a
sentence a player would recognise ("Hope can't be prepared past the six slots"), not a
function name — when one fails, the label is the whole error message.

## Where code goes

The split that matters: **the rules and the arithmetic live in a module that never touches
the DOM; the page file builds the DOM.** That's what makes the suite possible at all — it
runs in Node against a document stub barely a dozen lines long (`tests/node-runner.mjs`).

- `shared/advancement.js`, `history.js`, `derived-stats.js`, `effects.js`, `sheet-data.js`,
  `table-state.js`, `transfer.js`, `portrait.js`, `gear.js`, `i18n.js` — no DOM. Tested.
- `create.js`, `characters.js`, `level-up.js`, `sheet.js`, `play.js` — one page each, DOM and
  storage.
- `shared/card-render.js`, `popover.js`, `lightbox.js`, `stat-line.js`, … — DOM that more than
  one page needs.

If you find yourself reaching for `document` inside a rules module, the rule and the drawing
want separating.

## House style

**Comments say why, not what.** This is the one thing that will look unusual. The code is
full of comments naming the SRD page a rule comes from, or the bug that made a line
necessary — because in six months the *what* is readable and the *why* is gone. Follow it:

```js
// Armor Score can't exceed 12 (SRD) — printing armor.baseScore directly, as the old file did,
// would show 40.
```

Other things the code already does, worth keeping:

- **Escape everything you interpolate.** `shared/escape.js` exports `escapeHtml`; every page
  that builds an HTML string uses it.
- **No inline scripts or styles.** Every page ships its own Content-Security-Policy meta tag
  with no `unsafe-inline`. An inline `onclick` or `style=""` will be silently dropped by the
  browser, not flagged — add listeners in JS and rules in a stylesheet.
- **New field on a character? Backfill it.** Saved characters live in `localStorage` under
  `dh-characters-v1` and predate whatever you're adding. `ensureLevelFields()` is where every
  field added after the fact gets its default, for both stored and imported characters.
- **Don't invent rules.** If the SRD doesn't say a rest clears a condition, the app doesn't
  either. Where the book is genuinely silent, say so in a comment rather than picking quietly.
- **English in the UI, except the play page.** `shared/i18n.js` covers `play.html` (the one a
  player holds during a session) in English and Italian. Game data stays in the language of
  the data files.

## Game data and art

`data/srd_1_0/*.json` and `data/srd_2_0/*.json` are the Daggerheart SRD under the DPCGL — see [`NOTICE.md`](NOTICE.md). It is a
re-export of [`daggersearch/daggerheart-data`](https://github.com/daggersearch/daggerheart-data),
so **fix data upstream, not here**, unless the change is one of the deliberate divergences the
README's "Data source" section lists.

That keeps the SRD folders a clean re-export. Content that isn't the SRD — homebrew, playtest material,
a revised card — belongs in a source folder of its own beside it rather than appended to these
files; see [`docs/adding-content.md`](docs/adding-content.md).

**Card artwork, illustrations and logos are Prohibited Content under the DPCGL and never go in
this repository.** `data/*/card-art/` is git-ignored, for every source, and the renderer falls back to a CSS-only
card without it. A pull request carrying art can't be merged, whatever else is in it.

## Pull requests

- Branch from `main`. **Merge `main` back into your branch before asking for review**, and
  again if it moves while you wait — two branches appending to the end of `tests/tests.js`
  conflict even when they have nothing to do with each other, and it's much easier to resolve
  while the change is fresh in your head.
- Keep one theme per branch.
- Say what you did and why in the description. Commit messages here are prose, not
  `fix: stuff` — matching them is welcome but not required.
