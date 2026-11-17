// Solmar Bay — shared tuning for slice 1: city layout, player feel, camera, light.
// One place for every number the other modules read, so a later slice can retune
// the whole game without hunting through the code.
export const CONFIG = {
  seed: 1,

  // The playable city is a grid of blocks. South of the last street is sand,
  // then the sea. All distances are metres, Y is up.
  city: {
    blocksX: 4,
    blocksZ: 4,
    blockSize: 44,
    roadWidth: 14,
    sidewalk: 3,
    // Half-extent of the walkable area, including the beach.
    boundX: 132,
    boundZMin: -132,
    boundZMax: 196,
    beachZ: 132, // sand starts here
    seaZ: 168, // water starts here
    seaSize: 320,
  },

  player: {
    walkSpeed: 4.2,
    runSpeed: 8.5,
    turnSpeed: 9.0,
    height: 1.8,
    radius: 0.45,
  },

  camera: {
    distance: 7.5,
    height: 3.1,
    minPitch: -0.12,
    maxPitch: 0.62,
    followLerp: 7.0,
  },

  // Fixed golden hour: late afternoon sun low in the west, warm sky, soft haze.
  light: {
    sunColor: 0xffb168,
    sunIntensity: 2.3,
    sunPosition: [-140, 90, 60],
    skyColor: 0xffd9a8,
    groundColor: 0x8a6f5c,
    hemisphereIntensity: 1.15,
    skyBackground: 0xffc98f,
    fogColor: 0xf7b878,
    fogNear: 150,
    fogFar: 600,
    clockStartMinutes: 17 * 60 + 32, // 17:32
    minutesPerSecond: 0.5,
  },

  hud: {
    minimapSize: 176,
    cash: 0,
    objective: 'Explore Solmar Bay',
  },
};

// Named places the camera and the screenshot scenes use.
export const PLACES = {
  plaza: { x: 0, z: 0 },
  mainStreet: { x: 0, z: -29 },
  beach: { x: 24, z: 150 },
  overlook: { x: -58, z: -116 },
};
