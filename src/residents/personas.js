// ─── Resident personas ──────────────────────────────────────────────────────
// Each persona is a real household mapped to one of the project's actual
// unit typologies (ROOMS_META in RoomConfigurator.jsx), with a furniture
// layout built from the real catalogue/GLTF models — not a mockup. The
// `unit` field is the ROOMS_META id; `furniture` follows the exact shape
// RoomHeroView/FurniturePiece3D expects (uid, id, x, z, w, d, h, label),
// positioned in room-space (room is recentred so x:0,z:0 is the room centre,
// floor is y=0 — see BaseRoom in RoomConfigurator.jsx).

export const PERSONAS = [
  {
    id: 'amara',
    name: 'Amara Osei',
    age: 29,
    occupation: 'ICU Nurse',
    household: 'Lives alone',
    unit: 'ROOM1', // 1-BHK
    tagline: 'Home has to work on no sleep.',
    routine: [
      '06:40 — Off a 12-hour night shift, blackout curtains drawn, asleep within minutes.',
      '14:00 — Wakes, eats standing at the counter, calls her mother before the next shift.',
      '21:00 — Back out the door. The flat exists in the gaps between shifts, not evenings.',
    ],
    needs: [
      'A bedroom that can go fully dark and quiet at any hour — shift work doesn\'t respect day/night.',
      'Everything within a few steps: no wasted motion when you\'re running on four hours of sleep.',
      'One door, one lock, nothing to manage. Low-maintenance by necessity, not preference.',
    ],
    whyThisUnit: 'The 1-BHK\'s compact footprint means nothing is more than a few steps from the bed — exactly what a body running on shift-work sleep actually needs. The deep-set window keeps the room dark enough to sleep through a London afternoon.',
    furniture: [
      { uid: 'amara-1', id: 'bed-double',  x: -1.3, z: -0.6, w: 1.4, d: 2.0,  h: 0.55, label: 'Bed' },
      { uid: 'amara-2', id: 'nightstand',  x: -2.3, z: -0.6, w: 0.5, d: 0.5,  h: 0.6,  label: 'Nightstand' },
      { uid: 'amara-3', id: 'wardrobe-2d', x: -1.3, z: 1.6,  w: 1.2, d: 0.6,  h: 2.1,  label: 'Wardrobe' },
      { uid: 'amara-4', id: 'armchair',    x: 1.6,  z: 0.8,  w: 0.82, d: 0.82, h: 0.85, label: 'Armchair' },
      { uid: 'amara-5', id: 'tbl-side',    x: 1.6,  z: -0.2, w: 0.5,  d: 0.5,  h: 0.56, label: 'Side Table' },
    ],
  },
  {
    id: 'the-okafors',
    name: 'The Okafor Family',
    age: null,
    occupation: 'Two working parents, two children (6 and 9)',
    household: 'Family of four',
    unit: 'ROOM4', // 3-BHK
    tagline: 'A home that absorbs the chaos of school mornings.',
    routine: [
      '07:00 — Two kids, two school runs, one bathroom. Mornings are a logistics exercise.',
      '16:00 — Homework at the kitchen table while dinner starts; the living space has to do double duty.',
      '20:30 — Kids in bed, parents finally get the living room to themselves.',
    ],
    needs: [
      'Separate bedrooms for the kids — at 6 and 9, shared space stops working.',
      'A living/dining area that can host chaos: homework, play, dinner, all in the same hour.',
      'Storage that swallows the volume of stuff a family of four actually generates.',
    ],
    whyThisUnit: 'The 3-BHK gives each child their own room — the single biggest factor in a family\'s quality of life at this stage — while keeping the living/dining space open enough to referee homework and dinner prep simultaneously.',
    furniture: [
      { uid: 'okafor-1', id: 'bed-king',     x: -2.6, z: -1.2, w: 1.8, d: 2.1, h: 0.55, label: 'Bed (parents)' },
      { uid: 'okafor-2', id: 'bed-single',   x: 2.2,  z: -1.6, w: 0.9, d: 2.0, h: 0.55, label: 'Bed (age 9)' },
      { uid: 'okafor-3', id: 'bed-bunk',     x: 2.2,  z: 1.4,  w: 0.9, d: 2.0, h: 1.6,  label: 'Bunk (age 6)' },
      { uid: 'okafor-4', id: 'sofa-l',       x: -0.4, z: 1.6,  w: 2.4, d: 1.6, h: 0.8,  label: 'Sofa' },
      { uid: 'okafor-5', id: 'tbl-d6',       x: -2.6, z: 1.3,  w: 1.6, d: 0.9, h: 0.75, label: 'Dining Table' },
      { uid: 'okafor-6', id: 'tv-unit',      x: -2.6, z: 2.4,  w: 1.0, d: 0.42, h: 0.52, label: 'TV Unit' },
    ],
  },
  {
    id: 'margaret',
    name: 'Margaret Hale',
    age: 74,
    occupation: 'Retired teacher, widowed',
    household: 'Lives alone',
    unit: 'ROOM2', // 2-BHK
    tagline: 'Independent, not isolated.',
    routine: [
      '08:00 — Tea by the window, watching the street wake up. The view matters more than people expect.',
      '11:00 — Her daughter visits twice a week; the spare room means she can stay over.',
      '19:00 — Reading in the armchair, lamp on, no rush to anywhere.',
    ],
    needs: [
      'No steps, wide turning circles — the flat has to work as mobility changes, not just today.',
      'A spare room for family to stay, so visiting doesn\'t mean a hotel.',
      'Natural light and a window seat — after 74 years, daylight is non-negotiable.',
    ],
    whyThisUnit: 'The 2-BHK\'s second room is what actually keeps Margaret connected — it turns "visiting Mum" into "staying with Mum," which is the difference between a flat that supports independence and one that quietly enforces isolation.',
    furniture: [
      { uid: 'margaret-1', id: 'bed-queen',   x: -1.8, z: -0.8, w: 1.6, d: 2.0,  h: 0.55, label: 'Bed' },
      { uid: 'margaret-2', id: 'nightstand',  x: -2.95, z: -0.8, w: 0.5, d: 0.5,  h: 0.6,  label: 'Nightstand' },
      { uid: 'margaret-3', id: 'bed-single',  x: 2.0,  z: -1.4, w: 0.9, d: 2.0,  h: 0.55, label: 'Spare bed' },
      { uid: 'margaret-4', id: 'armchair-wing', x: 1.4, z: 1.4, w: 0.9, d: 0.9,  h: 1.1,  label: 'Armchair' },
      { uid: 'margaret-5', id: 'tbl-side',    x: 2.1,  z: 1.4,  w: 0.5, d: 0.5,  h: 0.56, label: 'Side Table' },
      { uid: 'margaret-6', id: 'bookshelf',   x: -1.0, z: 1.8,  w: 1.0, d: 0.35, h: 1.8,  label: 'Bookshelf' },
    ],
  },
  {
    id: 'theo',
    name: 'Theo Marsh',
    age: 24,
    occupation: 'Freelance motion designer',
    household: 'Lives alone',
    unit: 'ROOM1', // 1-BHK
    tagline: 'The flat is the studio.',
    routine: [
      '10:00 — Starts late, works from the desk that\'s visible the moment he wakes up.',
      '15:00 — Client calls happen wherever the light is best for the camera.',
      '23:00 — Still working. The line between home and studio doesn\'t really exist.',
    ],
    needs: [
      'A proper desk setup that doesn\'t feel like an afterthought crammed into a bedroom.',
      'Good, even daylight for video calls — the window orientation actually matters to his income.',
      'No commute, no overhead beyond rent — the flat has to make the freelance math work.',
    ],
    whyThisUnit: 'The 1-BHK is small, but the deep window bay gives Theo the one thing a generic studio wouldn\'t: consistent daylight on his desk, angled so video calls don\'t look like they\'re happening in a cave.',
    furniture: [
      { uid: 'theo-1', id: 'bed-double', x: -1.8, z: 1.2,  w: 1.4, d: 2.0, h: 0.55, label: 'Bed' },
      { uid: 'theo-2', id: 'desk-lg',    x: 1.6,  z: -1.0, w: 1.6, d: 0.7, h: 0.75, label: 'Desk' },
      { uid: 'theo-3', id: 'shelf-float', x: 2.2, z: 0.4,  w: 0.8, d: 0.25, h: 1.4, label: 'Shelf' },
      { uid: 'theo-4', id: 'ottoman',    x: -1.0, z: -1.2, w: 0.7, d: 0.7,  h: 0.42, label: 'Ottoman' },
    ],
  },
];

export function getPersonaUnit(persona, roomsMeta) {
  return roomsMeta.find(r => r.id === persona.unit) || null;
}
