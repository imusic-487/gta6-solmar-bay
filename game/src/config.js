// Solmar Bay — tuning and palette in one place.
export const CONFIG = {
  seed: 1,
  grid: {
    blocks: 6,
    blockSize: 40,
    roadWidth: 12,
  },
  colors: {
    sky: 0xffc98a,
    fog: 0xf2b878,
    ground: 0x9a938a,
    road: 0x3c3f45,
    sidewalk: 0xb8b0a4,
    sand: 0xe8cf9e,
    sea: 0x2e7f9e,
    buildings: [0xe8b48c, 0xd9a06a, 0xc98d7a, 0xa8b8c8, 0xe0cfa8, 0x8fb8a8, 0xd08a8a, 0x7a9cc0],
    windowLit: '#ffd98a',
    windowDark: '#2c3a4a',
    lamp: 0xffe6b0,
  },
  player: {
    walkSpeed: 6,
    runSpeed: 11,
    jumpSpeed: 8,
    gravity: 22,
  },
  camera: {
    distance: 9,
    height: 4.5,
    minPitch: 0.08,
    maxPitch: 1.1,
  },
};
