// The book's own words: the editorial intros of the category spreads, the "Where things are now"
// pages and the chapter each shared category is printed in. Every fact here comes from the designer's
// design-notes.md (concept, placement, buying order) or from the category rules in products.json;
// no product, price, size or link is written here (those always come from products.json).

export const BOOK_TITLE = 'The Organic Modern Edit';
export const BOOK_SUBTITLE = 'Living Room & Bedroom · Los Angeles · 2026';

/** Categories shared by both rooms are printed once, in this chapter (and marked "Both rooms"). */
export const SHARED_CHAPTER = {
  ROD: 'living', PILLOW: 'living', INSERT: 'living', LUMBAR: 'living', THROW: 'living', MIRROR: 'living', TRAY: 'living', VASE: 'living', STONE: 'living',
  TABLELAMP: 'bedroom', ART: 'bedroom', PLANT: 'bedroom', CANDLE: 'bedroom', BASKET: 'bedroom', BENCH: 'bedroom',
  'ART-TEXTURE': 'bedroom', 'ART-EARTHY': 'bedroom', 'ART-DESERT': 'bedroom', 'ART-WOVEN': 'bedroom',
};

/** What each piece does in the room, and what to look for (the sizing rule comes from products.json). */
export const CATEGORY_COPY = {
  'LR-RUG': {
    does: 'The rug anchors the seating and sets the palette. A soft cream 8’x10’ pulls the chocolate sectional and the coffee table into one island.',
    look: ['8’x10’ class (7’10”x10’ works); a 7’x10’ loses 12 in on one side', 'Cream, ivory or natural tones, soft or textured', 'Long side east-west, starting 2 in in front of the console'],
  },
  'LR-COFFEE': {
    does: 'The center of the room: a round table you can reach from every seat, in walnut or warm wood against the chocolate sofa.',
    look: ['Round, about 30-36 in across', 'Walnut, oak or warm wood; no cool gray or chrome', 'Room for a tray, a stone piece and a vase'],
  },
  'LR-FLOORLAMP': {
    does: 'Lifts the light into the corner so the room glows in the evening instead of relying on the ceiling light.',
    look: ['Linen, paper or rattan shade that diffuses', 'Light oak, camel or a little soft brass', 'A 2700K bulb, like every lamp in the plan'],
  },
  'LR-SCONCE': {
    does: 'Plug-in sconces give layered, low light on the TV wall without an electrician: the renter’s way to make the wall feel designed.',
    look: ['Rattan, wood or linen shades, plug-in', 'One each side of the TV, about 60-66 in high', 'Cords run down the wall inside the raceway'],
  },
  'LR-WIFI': {
    does: 'Hides the WiFi and cable gear in the TV-wall corner behind a closed, warm front.',
    look: ['Fits the corner: about 15.5 in W x 16 in D', 'Wood, cane or rattan fronts let WiFi through', 'Avoid metal'],
  },
  CURTAIN: {
    does: 'Oat-linen curtains hung high and wide soften the window and make the ceiling feel taller.',
    look: ['96-98 in panels', 'Oat linen or a linen look in warm white', 'Rod 2-4 in below the ceiling, 8-12 in past each side'],
  },
  ROD: {
    does: 'Carries the curtains in both rooms. Ink black appears only in small doses, and the rod is one of them.',
    look: ['Living room run about 114 in, bedroom about 92 in', 'The HUGAD 47-83 in rod is too short for the bedroom', 'Black or soft brass; no chrome'],
  },
  PILLOW: {
    does: 'Brings warm color onto the chocolate sectional: a cream pair and a rust pair.',
    look: ['20 in covers', 'Cream, oat or rust in linen or texture', 'Feather inserts make them look full'],
  },
  INSERT: {
    does: 'What makes a cover look full and soft instead of flat.',
    look: ['20 in, to match the covers', 'Feather preferred', 'One for each cover'],
  },
  LUMBAR: {
    does: 'A long pillow in front of the 20 in squares that finishes the sofa.',
    look: ['Oat, camel or rust', 'One lumbar in front of the squares', 'Texture rather than busy pattern'],
  },
  THROW: {
    does: 'A soft layer over the sectional’s arm or the foot of the bed, and an easy way to add rust.',
    look: ['Warm neutrals or rust; no cool gray', 'Knit, waffle or fringed texture', 'Big enough to drape'],
  },
  MIRROR: {
    does: 'A round mirror on the dining nook’s west wall catches the east light and bounces it back into the room.',
    look: ['Round', 'Centered at 57 in from the floor', 'Black or wood frame, in a small dose'],
  },
  CABLE: {
    does: 'Hides the cord run along the baseboard so the TV wall stays clean.',
    look: ['About 54 in of run from the TV console to the WiFi cabinet', 'Paintable white', 'Renter friendly: nothing to drill'],
  },
  TRAY: {
    does: 'Gathers the small things on the coffee table so they read as one styled moment.',
    look: ['Wood, brass or stone; never plastic', 'Sized for the coffee table', 'Holds a candle, a vase or a stone piece'],
  },
  VASE: {
    does: 'Ceramics in small groups add shape and texture to the table and shelves.',
    look: ['Groups of one to three', 'Warm neutral ceramic or glass', 'Matte or textured glazes'],
  },
  SIDETABLE: {
    does: 'A landing spot beside the sectional for a drink or a lamp, without blocking the way through.',
    look: ['36 in clear behind the sectional', '58 in clear to the hallway', 'Wood or rattan in warm tones'],
  },
  STONE: {
    does: 'Travertine or marble is the dressed-up note against casual linen: the push and pull that makes a room feel styled.',
    look: ['One or two pieces per room', 'Travertine or marble', 'On the tray or a shelf'],
  },
  'BR-RUG': {
    does: 'Grounds the bed and warms the floor underfoot: jute or a plaid wool under the lower two thirds of the queen bed.',
    look: ['5’x8’ class', 'About 18 in showing at the sides and the foot', 'The window side stays tucked: the bed is 6 in from that wall'],
  },
  'BR-DUVET': {
    does: 'Switching the bedding is the fastest bedroom upgrade. Natural linen-look layers make it calm and textured.',
    look: ['Full/Queen to fit the 60 x 80 in bed', 'Linen, waffle or a linen look', 'Oat, white or warm brown'],
  },
  'BR-NIGHTSTAND': {
    does: 'Wood bedside storage that still lets the door swing freely.',
    look: ['16-19 in wide at most', 'Wood; a drawer hides the clutter', 'The Walmart Lillian (22.25 in) and the cane nightstand (23.6 in) are wider than that'],
  },
  'BR-DESK': {
    does: 'A desk that actually gets used, in walnut or warm wood, makes the bedroom feel collected.',
    look: ['40-48 in wide', 'Walnut, oak or warm wood', '30 in clear behind the chair'],
  },
  'BR-CHAIR': {
    does: 'A warm leather or camel seat at the desk.',
    look: ['Leather, camel, cane or warm wood', '30 in clear behind the chair', 'A size that tucks under the desk'],
  },
  'BR-DESKLAMP': {
    does: 'Task light at the desk that stays warm enough for the evening.',
    look: ['2700K bulb', 'Linen or paper shade, wood or ceramic base', 'Black or brass only in small doses'],
  },
  'BR-HAMPER': {
    does: 'Keeps laundry out of sight in a soft, natural texture.',
    look: ['Rattan, willow, bamboo or canvas', 'Keep the 30 in in front of the closet clear', 'A lid keeps the room calm'],
  },
  'BR-CURTAIN': {
    does: 'Softens the bedroom window and filters the morning light.',
    look: ['96-98 in panels', 'Rod run about 92 in', 'Warm white, oat or linen'],
  },
  TABLELAMP: {
    does: 'Low lamps at 2700K: a table lamp in the living room and matching low lamps by the bed.',
    look: ['Linen shades on ceramic or wood bases', 'Low, so the light stays soft', '2700K bulbs'],
  },
  BEDLAMP2: {
    does: 'The second bedside lamp, so both sides of the bed match.',
    look: ['The same lamp as the first bedside lamp', '2700K bulbs', 'Same height on both sides'],
  },
  ART: {
    does: 'A statement piece is the focal point of each room.',
    look: ['Centered at 57 in from the floor', 'Warm, earthy tones', 'Oak or black frames'],
  },
  'ART-TEXTURE': {
    does: 'Used art from Facebook Marketplace in textured neutrals: plaster-look arches, rice paper and soft canvas that read calm in either room.',
    look: ['One large piece centered at 57 in, or a diptych over the sofa', 'Oat, sand and cream; texture rather than color', 'Used: it can sell any day, so each card has a backup search'],
  },
  'ART-EARTHY': {
    does: 'Rust, sand and olive prints and sets: the one warm layer, picked up second-hand.',
    look: ['Hang pairs and sets 2-3 in apart, centered at 57 in', 'Sets list the size of one piece; the price covers the whole set', 'No cool gray, chrome or busy color'],
  },
  'ART-DESERT': {
    does: 'Warm desert and forest scenes in wood frames, including signed vintage paintings and small originals.',
    look: ['Wood frames that match the oak and walnut', 'Centered at 57 in', 'Used: it can sell any day, so each card has a backup search'],
  },
  'ART-WOVEN': {
    does: 'Woven and rattan pieces put texture on the wall instead of a print.',
    look: ['Group two or three on one wall', 'Rattan, macrame and natural fibers', 'Some listings give no size: ask the seller before you buy'],
  },
  PLANT: {
    does: 'Green and life near the windows, without blocking the light.',
    look: ['Nothing taller than the sill within 24 in of a window', 'The olive tree goes beside the WiFi cabinet', 'Warm-toned pots'],
  },
  CANDLE: {
    does: 'Low, warm-toned objects that make the room feel lived in.',
    look: ['Low and grouped', 'Warm tones', 'On a tray'],
  },
  BASKET: {
    does: 'Natural-fiber storage for throws and spare pillows.',
    look: ['Rattan, seagrass or water hyacinth', 'Sized for a throw or two pillows', 'Warm, natural color'],
  },
  BENCH: {
    does: 'A seat at the foot of the bed, kept shallow so the walk to the desk stays open.',
    look: ['About 12-14 in deep: the bed foot is 37 in from the desk wall', 'The 11.8 in deep reclaimed-wood bench is the safest fit', 'Wood or warm upholstery'],
  },
};

/**
 * "Where things are now": what the room has today and what it is missing (from the designer's notes),
 * and the categories that fix each gap.
 */
export const ROOM_NOW = {
  living: {
    today: [
      'A chocolate sectional: the piece the whole room is built around.',
      'A TV console on the TV wall, with the WiFi and cable gear in the corner beside it (about 15.5 in W x 16 in D).',
      'One window, with a curtain run of about 114 in.',
      'A dining nook whose west wall catches the east light.',
    ],
    gaps: [
      { need: 'Something to anchor the sectional', fix: 'An 8’x10’ cream rug under the sofa’s front legs, and a round walnut coffee table 14-18 in from the seats.', cats: ['LR-RUG', 'LR-COFFEE'] },
      { need: 'Softness and height at the window', fix: 'Oat-linen panels, 96-98 in long, on a rod hung high and wide.', cats: ['CURTAIN', 'ROD'] },
      { need: 'Warm, layered evening light', fix: 'Plug-in sconces each side of the TV and a floor lamp, all at 2700K.', cats: ['LR-SCONCE', 'LR-FLOORLAMP'] },
      { need: 'A home for the WiFi gear and the cords', fix: 'A closed wood or rattan cabinet that lets WiFi through, and a paintable cord cover.', cats: ['LR-WIFI', 'CABLE'] },
      { need: 'Warm color against the chocolate', fix: 'Cream and rust pillows on feather inserts, a lumbar and a throw.', cats: ['PILLOW', 'INSERT', 'LUMBAR', 'THROW'] },
      { need: 'Finishing layers', fix: 'A round mirror for the nook, a tray, ceramics, stone, and a side table that keeps the walkways clear.', cats: ['MIRROR', 'TRAY', 'VASE', 'STONE', 'SIDETABLE'] },
    ],
  },
  bedroom: {
    today: [
      'A queen bed (60 x 80 in), 6 in from the window wall.',
      'A desk wall 37 in from the foot of the bed.',
      'A door whose swing leaves room for a nightstand about 16-19 in wide.',
      'A closet that needs 30 in clear in front of it, and a window with a curtain run of about 92 in.',
    ],
    gaps: [
      { need: 'A rug that grounds the bed', fix: 'A 5’x8’ jute or plaid wool rug under the lower two thirds of the bed.', cats: ['BR-RUG'] },
      { need: 'Calm, textured bedding', fix: 'A natural linen-look duvet cover set in Full/Queen.', cats: ['BR-DUVET'] },
      { need: 'A matching bedside', fix: 'A narrow wood nightstand and matching low lamps at 2700K.', cats: ['BR-NIGHTSTAND', 'TABLELAMP', 'BEDLAMP2'] },
      { need: 'A desk corner that gets used', fix: 'A 40-48 in desk, a warm leather or camel chair and a desk lamp.', cats: ['BR-DESK', 'BR-CHAIR', 'BR-DESKLAMP'] },
      { need: 'Curtains for the window', fix: '96-98 in panels on the bedroom rod.', cats: ['BR-CURTAIN'] },
      { need: 'Calm storage', fix: 'A natural-fiber hamper, baskets and a shallow bench at the foot of the bed.', cats: ['BR-HAMPER', 'BASKET', 'BENCH'] },
      { need: 'One rust or terracotta layer, and life', fix: 'Art at 57 in (new or used), a plant that stays below the sill, and low candles.', cats: ['ART', 'ART-EARTHY', 'PLANT', 'CANDLE'] },
    ],
  },
};

/** The steps of the buying order (design-notes.md) and the categories each step points to. */
export const BUYING_LINKS = [
  { re: /living room rug/i, cats: ['LR-RUG', 'CURTAIN', 'BR-CURTAIN', 'ROD'] },
  { re: /^lighting/i, cats: ['LR-SCONCE', 'LR-FLOORLAMP', 'TABLELAMP', 'BEDLAMP2'] },
  { re: /used pieces/i, cats: ['LR-COFFEE', 'LR-WIFI', 'BR-NIGHTSTAND', 'BR-DESK', 'BR-CHAIR', 'MIRROR', 'ART'] },
  { re: /bedroom rug/i, cats: ['BR-RUG', 'BR-DUVET'] },
  { re: /pillows/i, cats: ['PILLOW', 'INSERT', 'THROW'] },
  { re: /^art, plants/i, cats: ['ART', 'ART-TEXTURE', 'ART-EARTHY', 'ART-DESERT', 'ART-WOVEN', 'PLANT', 'TRAY', 'VASE', 'CANDLE', 'BASKET', 'STONE'] },
];
