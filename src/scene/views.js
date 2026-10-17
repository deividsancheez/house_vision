// Camera presets, one per photo in photos/ (matched to each photo's position, direction and lens),
// plus an overview. Positions are room coordinates in inches; vfov is the vertical field of view of
// the photo (4:3 frame). The photos themselves are NOT shipped with the app; only their names are.
// How these were found: tools/camera-solve.mjs fits each camera to known points marked on the photo
// (tests/camera/points.json); fitPx is the average error of that fit in a 1024x768 frame.

export const PRESETS = [
  { id: 'living-01-dining-nook-facing-south', room: 'living', label: 'Dining nook', facing: 'south', pos: { x: 176.4, y: 108.8, z: 61.1 }, target: { x: 173.3, y: 208.3, z: 51.5 }, vfov: 49.3, fitPx: 6.9 },
  { id: 'living-02-pass-through-wall-facing-south', room: 'living', label: 'Pass-through wall', facing: 'south', pos: { x: 52.1, y: 34.9, z: 62.1 }, target: { x: 57.5, y: 134.5, z: 54.7 }, vfov: 49.5, fitPx: 28.7 },
  { id: 'living-03-long-view-facing-west', room: 'living', label: 'Long view', facing: 'west', pos: { x: 66.9, y: 78.8, z: 55 }, target: { x: 164, y: 102.5, z: 56.5 }, vfov: 88.7, fitPx: 16.7 },
  { id: 'living-04-tv-wall-facing-north', room: 'living', label: 'TV wall', facing: 'north', pos: { x: 105.8, y: 193.9, z: 79.7 }, target: { x: 105.1, y: 94.5, z: 68.6 }, vfov: 49.5, fitPx: 17.2 },
  { id: 'living-05-window-wall-facing-east', room: 'living', label: 'Window wall', facing: 'east', pos: { x: 194.8, y: 77.6, z: 61.4 }, target: { x: 94.9, y: 82.4, z: 58.7 }, vfov: 48.7, fitPx: 4.8 },
  { id: 'living-06-overview-facing-east', room: 'living', label: 'Overview from the hall', facing: 'east', pos: { x: 195, y: 155.2, z: 52.3 }, target: { x: 138.3, y: 74.4, z: 36.5 }, vfov: 88, fitPx: 13.3 },
  { id: 'living-07-overview-facing-west', room: 'living', label: 'Overview from the door', facing: 'west', pos: { x: 2, y: 142.7, z: 66.3 }, target: { x: 56.8, y: 77.4, z: 30.8 }, vfov: 84.1, fitPx: 14.6 }, // taken from the open front doorway (x=-10); moved just inside the closed door
  { id: 'living-08-overview-facing-southeast', room: 'living', label: 'Overview to the window and kitchen', facing: 'southeast', pos: { x: 218.6, y: 2.7, z: 66.4 }, target: { x: 138.9, y: 52.4, z: 32.1 }, vfov: 78.3, fitPx: 15.8 },
  { id: 'bedroom-01-closet-wall-facing-east', room: 'bedroom', label: 'Closet wall', facing: 'east', pos: { x: 65.4, y: 28.7, z: 60.6 }, target: { x: 67.7, y: 128.6, z: 56.2 }, vfov: 90.3, fitPx: 5.2 },
  { id: 'bedroom-02-headboard-wall-facing-north', room: 'bedroom', label: 'Headboard wall', facing: 'north', pos: { x: 100.3, y: 55.3, z: 54.6 }, target: { x: 0.5, y: 61.7, z: 55.2 }, vfov: 88.8, fitPx: 7.6 },
  { id: 'bedroom-03-desk-wall-facing-south', room: 'bedroom', label: 'Desk wall', facing: 'south', pos: { x: 48.8, y: 72.4, z: 54.7 }, target: { x: 148.5, y: 67.9, z: 48.8 }, vfov: 98.7, fitPx: 10 },
  { id: 'bedroom-04-window-wall-facing-west', room: 'bedroom', label: 'Window wall', facing: 'west', pos: { x: 49.6, y: 119.3, z: 61.4 }, target: { x: 51.3, y: 19.5, z: 55.3 }, vfov: 52.5, fitPx: 14.2 },
  { id: 'bedroom-05-overview-facing-northwest', room: 'bedroom', label: 'Overview to the window', facing: 'northwest', pos: { x: 116.3, y: 137.1, z: 61.9 }, target: { x: 49.6, y: 74.7, z: 21.1 }, vfov: 79.3, fitPx: 8.3 },
  { id: 'bedroom-06-overview-facing-northeast', room: 'bedroom', label: 'Overview to the closet', facing: 'northeast', pos: { x: 99, y: 20.8, z: 74.3 }, target: { x: 48.2, y: 88.4, z: 20.9 }, vfov: 89.5, fitPx: 4 },
];

/** Default orbit view: from above, looking down into the room through the cut-away walls. */
export function overview(room, aspect = 1.6) {
  const b = room.bounds;
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  const span = Math.max(b.x1 - b.x0, (b.y1 - b.y0) * Math.min(1.4, Math.max(0.8, aspect)));
  // look from the side opposite the room's window wall, slightly from the corner
  const dir = room.id === 'living' ? { x: 0.55, y: 0.85 } : { x: 0.85, y: 0.55 };
  const dist = span * 1.25;
  return { pos: { x: cx + dir.x * dist * 0.55, y: cy + dir.y * dist * 0.55, z: dist * 0.95 }, target: { x: cx, y: cy, z: 10 }, vfov: 50 };
}

export function topView(room) {
  const b = room.bounds;
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  return { pos: { x: cx, y: cy + 1, z: Math.max(b.x1 - b.x0, b.y1 - b.y0) * 1.9 }, target: { x: cx, y: cy, z: 0 }, vfov: 45 };
}

export function presetLabel(p) {
  return `${p.label} · facing ${p.facing}`;
}
