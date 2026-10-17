# Room viewer (living room + bedroom, 3D)

An interactive 3D model of the living room and the bedroom, built at true scale from `room-spec.json`,
with every product from `products.json` placed by the designer's layout. Walk through the rooms in
first person, pick pieces up and put them somewhere else, store them, swap options, see the budget
update live, switch day/night, and save layouts. Runs in any modern browser, on phones too. Built with [three.js](https://threejs.org) and [Vite](https://vite.dev), no framework.

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

The top bar switches between **Walk** (first person, the default) and **Overview** (orbit view,
floor plan and the photo views). Both show the same layout. A short tutorial (about 30 s) runs on
the first visit; skip it any time, replay it from Settings. It works on a practice copy, so it never
changes your layout.

#### Walk mode

| | Desktop | Phone |
|---|---|---|
| Walk | `W A S D` or the arrow keys (`Shift` runs) | the joystick, bottom left |
| Look around | click the view to lock the mouse, then move it (`Esc` releases); dragging also works | drag anywhere on the right |
| Pick up what the dot is on | `E` | **Pick up** |
| Drop | `E` or click | **Drop** or tap the view |
| Turn what you carry | `R` 15°, `Shift+R` the other way, hold `R` for 90° steps | **Rotate** (hold for 90° steps) |
| Put it back where it was | `Esc` | **Cancel** |
| Store it (it stays in the budget) | `F` | **Store** |
| Inventory | `I` or `Tab` | the bag |
| Item card | `Q` | **Info** |
| Undo / redo | `Ctrl+Z` / `Ctrl+Y` (Overview too) | **Undo** / **Redo** |

- You walk at 4 ft/s (run 7 ft/s) with your eyes at 68 in (6'0"); change the eye height in
  Settings. Walls, closed doors, windows and furniture stop you; rugs, curtains and things resting on
  furniture don't. The kitchen edge stops you too ("Kitchen not modeled"); the front door and the
  living-room closet don't open. The key hints panel can be hidden (X, or in Settings).
- Walk into the hallway opening (living room, "To bedroom") and you come out just inside the bedroom
  door, and back the same way.
- Aim the center dot at a piece within 8 ft: it gets an outline. Every product and every piece you
  already own can be moved; walls, fans and the closet can't. Pieces with every side under 30 in are
  held in your hands; bigger ones float ahead of you. Whatever rests on a piece comes along.
- While you carry something, its preview is **green** (fits), **yellow** (fits, with the warning's
  title) or **red** (can't go there, with the reason; the drop is refused). It snaps to the floor, to
  the wall you face (wall pieces) or to the furniture it can sit on, like the Overview does.
- **Inventory:** *Stored* lists what you put away (photo, name, brand, size with ESTIMATED marked,
  price, new/used, room it came from). Things that were on it are stored with it, as a group you can
  ungroup. *Catalog* lists the slot options that aren't in the plan, priced "+$X" (tax included for
  new items). Search, filter by room, category, new/used and price, sort by name, price or size.
  **Place** puts the piece in your hands; **Add & place** adds a Catalog item to the budget (it fills
  its slot if that is empty, otherwise it is added next to it); **Swap** changes the option;
  **Remove from plan** (with a confirm) takes it out of the budget and back to the Catalog. Pieces you
  already own can be stored but not removed. The inventory is saved, exported and reset with the
  layout.
- **Warnings** (the triangle in the top bar, and a small stack of cards on the left): each says what's
  wrong with the real numbers, why it matters, and how to fix it. **Show me** marks the spot (in
  Overview: on the floor plan). **X** dismisses it for that piece; it comes back if the piece moves
  into another area or gets more than 2 in worse. Dismissed ones are listed under "Dismissed (n)",
  where you can restore them. Warnings never block a move.
- **Goals and score** (top right): each room scores 0–100 from goals computed from the files (clear
  walkways, door swings and windows, on budget, lamps in place, nothing waiting in the inventory,
  every slot filled, no warnings). "How the score works" lists the points. Best is the highest score
  each room has reached in this browser; it starts at the designer's layout (85 in each room).
- Sounds (footsteps, softer on rugs; pick up, drop, store, refused, goal) are made in the browser,
  no sound files. The speaker button mutes them; they start muted on phones.

#### Overview

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
- **Day/Night**, **Curtains** and **Closet** (bedroom) are in the top bar (in both modes).
- **Budget chip:** new items plus 9.75% tax, used items untaxed. It turns red over $1,000. Tap it for
  the breakdown.
- **Layouts:** save and name layouts in this browser, load them, compare two, export and import a
  `.json` file, and **Reset to designer's layout**. Files saved before Walk mode still import.
- **Fit warnings:** pieces in a door swing, walkway, window or on top of each other show a warning,
  but the move is still allowed.

## Project layout

```
src/
  units.js            the only place inches become three.js units (1 unit = 1 m; z up -> y up)
  main.js             the app: renderer, camera, selection/dragging, keyboard, render loop, undo
  walk.css            Walk mode, inventory, warning, goals and tutorial styles
  core/               no three.js here; all unit-tested
    catalog.js        reads and validates room-spec.json + products.json, indexes rooms and walls
    items.js          placement: what each slot puts where, collisions, moving, rotating, swapping
    budget.js         the budget math, in whole cents
    fit.js            fit warnings from room-spec "fit_checks"
    layouts.js        saved layouts (localStorage), export/import files, Walk settings, best scores
    walk.js           Walk mode rules: body collisions, start spots, the doorway link, aiming
    carry.js          where a carried piece would land, and its green / yellow / red status
    inventory.js      store, place, remove, Catalog add; the inventory and Catalog cards
    explain.js        warning cards (title, what, why, fix) and dismissals
    goals.js          goals and the score
    history.js        undo / redo
  scene/
    room.js           walls, windows, doors (with swing arcs), closet, blinds, outlets, fans, kitchen
    existing.js       the furniture you already have (room-spec "existing_pieces")
    products.js       a 3D model for every product kind, from its size, color and photo
    glb.js            loads the stored IKEA models and fits them to the product's size
    lighting.js       day (sun + sky through the windows) and night (lamps at their K and lumens)
    roomScene.js      one room: items, lights, curtains, cut-away walls, selection outlines
    merge.js          merges static meshes (fewer draw calls for phones)
    views.js          camera presets matched to the photos
  walk/               Walk mode, three.js side: walkMode.js (camera, carrying, ghosts), hands.js,
                      input.js (keys, mouse, touch), audio.js (Web Audio sounds)
  ui/ui.js            the top bar, item card, menus, budget and layouts dialogs
  ui/                 also walkHud.js (dot, labels, joystick, buttons), inventory.js, warnings.js,
                      goals.js, tutorial.js
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

## Add a goal

Goals live in `src/core/goals.js`. Add an entry to `GOALS` (`id`, `label`, `points`, `help`; the
points must still add up to 100, so take them from another goal), then compute it in `roomGoals`:
add its `detail` line and its `done` test (or a `{ n, ok }` share in `frac` for partial credit).
Compute it only from `room-spec.json`, `products.json` and the layout. The panel, the "How the score
works" table and the toast pick it up by themselves. Update the expected score in
`tests/unit/walk.test.mjs` and `tests/e2e/walk.spec.js` (85 for the designer's layout today).

## Change or add a warning text

Warning cards are written in `src/core/explain.js`. `WHY` holds the one-sentence "why it matters"
for each type (door, window, walkway, hallway, kitchen, closet, desk chair, overlap, opening,
support). `explainWarning` builds each card's title, "what's wrong" (with the numbers from the
warning) and "how to fix it". The warnings themselves come from `fit_checks` in `room-spec.json` and
from `src/core/fit.js`; a new kind of check goes there first, then gets a branch in
`explainWarning`.

## Tests

```bash
npm run test:unit    # fast: budget math, placement, collisions, warnings, layouts (node --test)
npm run test:e2e     # Playwright, desktop 1440x900 and phone 412x892 (touch), on the built app
npm run test:perf    # frame rate in Overview and Walk mode, run alone (desktop, and phone with the CPU slowed 4x)
npm test             # all three
```

The first e2e run needs `npx playwright install chromium`. Results go to `test-results/`.
`tests/e2e/walk.spec.js` covers Walk mode on both screens: walking, the doorway, eye height,
carrying with the preview colors, the inventory and the budget, undo/redo across 20 actions,
warnings, goals, saving, the tutorial and Overview. `node tools/report.mjs` builds the local report
(`test-report/`, never uploaded) with the screenshots.

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
