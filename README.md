# Room viewer (living room + bedroom, 3D)

An interactive 3D model of the living room and the bedroom, built at true scale from `room-spec.json`,
with every product from `products.json` placed by the designer's layout. Swap options, move/rotate/remove
pieces, see the budget update live, switch day/night, and save layouts. Runs in any modern browser, on
phones too. Built with [three.js](https://threejs.org) and [Vite](https://vite.dev), no framework.

> **Privacy.** The deployed app is public. It never includes `../photos/` or `../plans/` (they show the
> home and its address). The build script refuses to run if a file from those folders ends up in
> `public/`, and a test checks the built `dist/` folder. `test-report/` puts the photos next to the app
> for comparison, so it is **local only**: it is git-ignored and must never be uploaded.

## Run it

Needs [Node.js](https://nodejs.org) 20 or newer.

```bash
cd room-viewer
npm install
npm run dev          # http://localhost:5173 (also on your Wi-Fi: open the "Network" address on a phone)
```

`npm run build` makes the static site in `dist/` and `npm run preview` serves that build.

The input files stay where they are, in the folder above (`../room-spec.json`, `../products.json`,
`../product-images/`). `npm run dev` and `npm run build` first run `scripts/build-assets.mjs`, which:

- copies the two JSON files into `public/data/`;
- resizes the product photos into `public/product-images/` (same file names);
- compresses the IKEA 3D models from `assets-src/models/` into `public/models/` (Draco, WebP textures).

### Using it

| | Desktop | Phone |
|---|---|---|
| Look around | drag | one finger |
| Zoom | mouse wheel | pinch |
| Pan | right-drag | two fingers |
| Select a piece | click it | tap it |
| Move the selected piece | drag it, or arrow keys | drag it with one finger |
| Rotate | `R` / `Shift+R`, or the card's buttons | the card's buttons |
| Remove | `Delete`, or the card's Remove | the card's Remove |

- **Item card:** photo, price (with the old price when on sale), new/used, today's status, **Buy**
  (opens the store in a new tab), **Backup search** for used items, and the slot's options A/B/C with
  ★ on the designer's pick.
- **Views:** an orbit overview, a floor plan, and one view per photo, matched to where each photo was
  taken.
- **Day/Night**, **Curtains** and **Closet** (bedroom) are in the top bar.
- **Budget chip:** new items plus 9.75% tax, used items untaxed. It turns red over $1,000. Tap it for
  the breakdown.
- **Layouts:** save and name layouts in this browser, load them, compare two, export and import a
  `.json` file, and **Reset to designer's layout**.
- **Fit warnings:** pieces in a door swing, walkway, window or on top of each other show a warning,
  but the move is still allowed.

## Project layout

```
src/
  units.js            the only place inches become three.js units (1 unit = 1 m; z up -> y up)
  main.js             the app: renderer, camera, selection/dragging, keyboard, render loop
  core/               no three.js here; all unit-tested
    catalog.js        reads and validates room-spec.json + products.json, indexes rooms and walls
    items.js          placement: what each slot puts where, collisions, moving, rotating, swapping
    budget.js         the budget math, in whole cents
    fit.js            fit warnings from room-spec "fit_checks"
    layouts.js        saved layouts (localStorage), export/import files
  scene/
    room.js           walls, windows, doors (with swing arcs), closet, blinds, outlets, fans, kitchen
    existing.js       the furniture you already have (room-spec "existing_pieces")
    products.js       a 3D model for every product kind, from its size, color and photo
    glb.js            loads the stored IKEA models and fits them to the product's size
    lighting.js       day (sun + sky through the windows) and night (lamps at their K and lumens)
    roomScene.js      one room: items, lights, curtains, cut-away walls, selection outlines
    merge.js          merges static meshes (fewer draw calls for phones)
    views.js          camera presets matched to the photos
  ui/ui.js            the top bar, item card, menus, budget and layouts dialogs
scripts/
  fetch-models.mjs    downloads each IKEA model once into assets-src/models/ (only run when adding one)
  build-assets.mjs    prepares public/ (see above) and guards against private files
tests/
  unit/               node --test: catalog, budget math, placement, collisions, warnings, layouts
  e2e/                Playwright, desktop and phone (see "Tests")
  camera/             the points marked on each photo to find its camera (tools/camera-solve.mjs)
tools/                development helpers (screenshots, photo comparisons, link check, profiling)
```

## Add a product

1. Add it to `../products.json` with a new unique `id` (for example `LR-LAMP-C`). Fill in at least
   `room`, `category`, `name`, `price`, `qty`, `taxed`, `condition` (`new` or `used`), `buy_url`,
   `dimensions_in` (`w`, `d`, `h` in inches), `main_color_hex` and `status_today`. If a size is a
   guess, list it in `dimensions_estimated` (e.g. `["d"]`). Used items can have `backup_search_url`.
2. Put its photo in `../product-images/<id>.jpg` (exactly the id, `.jpg`).
3. Add the id to a slot's `options` in `products.json` (see "Add a slot").
4. Its 3D shape comes from its name and category (`productKind` in `src/core/items.js`). For example,
   names with "floor lamp", "sconce", "rug", "mirror", "pillow", "coffee table", "nightstand", "desk",
   "hamper" or "vase" get that kind of model, built to the product's size and color. Anything
   unrecognized becomes a box of the right size and color. For a new kind of thing, add a keyword
   there and a builder in `BUILDERS` in `src/scene/products.js`.
5. Optional: for rugs, pillows and art, the texture is cut from the product photo. Add a crop in
   `PHOTO_CROPS` (`src/scene/products.js`) as `[left, top, right, bottom]` fractions of the photo.
6. Optional: if the store offers a 3D model (`.glb`), put its address in `model_3d_url` and run
   `npm run fetch-models` once. It is downloaded into `assets-src/models/` and served from the app,
   never hot-linked.
7. `npm run dev` and check it. Then run `npm test`: the product tests cover every product
   automatically.

## Add a slot

Add an entry to `slots` in `../products.json`:

```jsonc
{
  "slot_id": "LR-LAMP2",  "room": "living",  "label": "Reading lamp",
  "options": ["LR-LAMP2-A", "LR-LAMP2-B"],  "default_option": "LR-LAMP2-A",
  "anchor": "floor",           // "floor", "wall", or "on top of" (then set on_top_of)
  "mount": "floor",            // "floor" or "wall"
  "wall": null,                // the wall id for wall pieces, e.g. "LR-W-NORTH"
  "on_top_of": null,           // what it rests on: an existing piece ("EX-LR-SECTIONAL") or a slot ("BR-DESK")
  "notes": "",                 // shown in the card; "not visible" here hides an "on top of" piece (like pillow inserts)
  "placements": [{ "position_center": { "x": 40, "y": 30, "z": 0 }, "rotation_deg_z": 0,
                   "bbox": { "min": { "x": 32, "y": 22, "z": 0 }, "max": { "x": 48, "y": 38, "z": 58 } } }]
}
```

Positions use the room-spec coordinates:
- **Living room:** origin at the NE corner, +x west, +y south.
- **Bedroom:** origin at the NW corner, +x south, +y east.
- **Both:** inches, `z` = height above the floor. `rotation_deg_z` is counter-clockwise; 0 means the
  front faces +y.

Use one placement per piece; a pair of sconces gets two. The slot's label and its "rule_applied" and
"notes" show in the item card.

## Tests

```bash
npm run test:unit    # fast: budget math, placement, collisions, warnings, layouts (node --test)
npm run test:e2e     # Playwright, desktop 1440x900 and phone 412x892 (touch), on the built app
npm run test:perf    # frame rate, run alone (desktop, and phone with the CPU slowed 4x)
npm test             # all three
```

The first e2e run needs `npx playwright install chromium`. Results go to `test-results/`.

Development helpers:
- `node tools/compare.mjs <dir> [day|night]` puts each photo next to its matching app view. Run it
  while `npm run dev` serves on port 5199 (`npx vite --port 5199`).
- `node tools/check-links.mjs` opens every Buy link in a real browser.

## Redeploy

**Live:** <https://deividsancheez.github.io/house_vision/>. It is served from the `gh-pages`
branch of <https://github.com/deividsancheez/house_vision> (the code is on `main`). To publish
changes:

```bash
npm run build
npx playwright test tests/e2e/privacy.spec.js --project=desktop   # no photos/plans/address in dist/
npx gh-pages -d dist --nojekyll                                    # pushes dist/ to the gh-pages branch
node tools/smoke-live.mjs https://deividsancheez.github.io/house_vision/ .   # after about a minute
```

The privacy test looks for words from the home address listed in `tests/e2e/private-words.txt`.
That file is git-ignored on purpose; keep it only on this computer.


The app is a static site: `npm run build` and upload the **contents of `dist/`** anywhere that serves
files. All paths are relative, so it works at a domain root or in a sub-folder.

- **Netlify (no git):** sign in at <https://app.netlify.com/drop>, then drag the `dist` folder onto
  the page. Later updates go through Deploys → drag the new `dist`.
- **GitHub Pages:** `npx gh-pages -d dist` pushes `dist/` to the `gh-pages` branch of your repo. Then
  in the repo, Settings → Pages → Source: `gh-pages` branch.
- **Vercel:** `npx vercel deploy dist --prod`.

Before uploading, `npm run test:e2e -- --grep "no photos"` re-checks that the build holds no photos,
plans or address. Never upload `test-report/`, `../photos/` or `../plans/`. If you put this folder in
a git repository, the `.gitignore` already keeps `test-report/` out. Keep the photos and plans folders
out of any repository.
