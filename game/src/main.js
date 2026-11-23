// Solmar Bay — bootstrap: renderer, city, player, camera, HUD, game loop.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { mulberry32 } from './random.js';
import { buildCity } from './city.js';
import { createCars, updateCar, nearestCar } from './cars.js';
import { createTraffic } from './traffic.js';
import { createPedestrians } from './pedestrians.js';
import { knockDownPed } from './pedestrians.js';
import { createPolice } from './police.js';
import { createMissions } from './missions.js';
import { createCombat } from './combat.js';
import { createDeath } from './death.js';
import { createSave } from './save.js';
import { createInput } from './input.js';
import { createPlayer, createPlayerMesh } from './player.js';
import { createCamera } from './camera.js';
import { createHUD } from './hud.js';
import { createAudio } from './audio.js';
import { setupShot } from './shots.js';

const container = document.getElementById('game-container');
const titleEl = document.getElementById('title');

// Slice 8: the save lives in localStorage (solmar-bay-save-v1);
// hasSave() decides whether the title screen offers Continue.
const save = createSave();
const continueBtn = document.getElementById('continue-btn');
const newGameBtn = document.getElementById('newgame-btn');
if (save.hasSave() && continueBtn) {
  const s = save.load();
  if (s) continueBtn.textContent = 'Continue — $' + s.cash + ' · ' + s.completed + '/3 · KO ' + s.knockouts;
  continueBtn.style.display = '';
}

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(CONFIG.colors.sky);
scene.fog = new THREE.Fog(CONFIG.colors.fog, 280, 640);

const rng = mulberry32(CONFIG.seed);
const city = buildCity(scene, rng);
const { cars } = createCars(scene, city, rng);
const traffic = createTraffic(scene, city, rng);
const { peds, update: updatePeds } = createPedestrians(scene, city, rng);
const police = createPolice(scene, city, rng);
// Slice 9b: procedural sound — AudioContext is created only by
// audio.init() from a user gesture (see startFromTitle); before
// that every play() is a counted silent no-op.
const audio = createAudio();
// Slice 5: Bayline courier missions — payout lands here, once per mission.
const missions = createMissions(scene, city, { onComplete: (m) => { cash += m.reward; persistSave(); audio.playMissionComplete(); } });
// Slice 6: street melee — first punch on an opponent costs a wanted star
// (via police), a knockout pays $20 into cash, once per opponent.
const combat = createCombat(scene, city, rng, {
  addWanted: (n) => police.addWanted(n),
  onKnockout: (r) => { cash += r.reward; persistSave(); audio.playKnockout(); },
  onPunch: () => audio.playPunch(),
});

const player = createPlayer(city.spawn, city.colliders, city.bounds);
scene.add(player.mesh);

const input = createInput();
const cameraRig = createCamera();
const hud = createHUD();

let cash = 0;
let wanted = 0;
let health = 100;

// Slice 7: fail + death screens — created after combat / missions /
// police so every callback has something to call. Cash, knockouts
// and finished deliveries are never touched by the respawn path.
const death = createDeath({
  getHealth: () => combat.getHealth(),
  getMissionState: () => ({
    current: missions.getCurrent(),
    isComplete: missions.isComplete(),
    completed: missions.getCompleted(),
  }),
  respawnPlayer: () => {
    player.pos.set(city.spawn.x, 0, city.spawn.z);
    player.mesh.position.copy(player.pos);
    player.mesh.visible = true;
    if (driving && currentCar) {
      currentCar.speed = 0;
      driving = false;
      currentCar = null;
    }
  },
  clearWanted: () => police.clearWanted(),
  resetHealth: () => combat.resetHealth(),
  resetOpponents: () => combat.resetOpponents(),
  resetMission: () => missions.resetCurrent(),
  getStats: () => ({ cash, knockouts: combat.getKnockouts(), completed: missions.getCompleted() }),
  // Slice 9b: death screen sound — 'failed' for DELIVERY FAILED,
  // 'dead' for OUT COLD.
  onDeath: (kind) => { audio.play(kind === 'dead' ? 'dead' : 'failed'); },
});

// Slice 2 driving state: on foot until E enters a nearby car.
let driving = false;
let currentCar = null;
let prevE = false;
let saveAfterRespawn = false; // Slice 8: set while a death screen is up, saved once the respawn lands.

const game = {
  state: 'title',
  player,
  camera: cameraRig,
  city,
  cars,
  traffic,
  peds,
  police,
  missions,
  combat,
  death,
  audio,
  get driving() { return driving; },
  get currentCar() { return currentCar; },
  hud,
  setState,
};
window.__game = game;

function setState(s) {
  game.state = s;
  if (s === 'play') titleEl.style.display = 'none';
  else titleEl.style.display = 'flex';
}

// Slice 8: persist the run after a mission, a knockout, or a respawn.
function persistSave() {
  save.save({ completed: missions.getCompleted(), cash, knockouts: combat.getKnockouts() });
}

// Slice 8: Continue restores cash, knockouts and the finished count,
// puts the player back at spawn with full health and no wanted heat,
// and resumes the route from the first unfinished delivery (free
// roam when the save holds 3/3). A missing or damaged save just
// starts a fresh run — load() returns null and nothing is applied.
function continueGame() {
  audio.init();
  const s = save.load();
  if (s) {
    cash = s.cash;
    missions.setCompleted(s.completed);
    combat.setKnockouts(s.knockouts);
    combat.resetHealth();
    health = 100;
    player.pos.set(city.spawn.x, 0, city.spawn.z);
    player.mesh.position.copy(player.pos);
    player.mesh.visible = true;
    police.clearWanted();
    hud.setObjective(missions.getObjectiveText());
  }
  setState('play');
}

function newGame() {
  audio.init();
  save.clearSave();
  setState('play');
}

// Slice 8: starting from the title (Enter, or a click outside the
// buttons) continues a saved run when one exists, else starts fresh.
function startFromTitle() {
  if (game.state !== 'title') return;
  audio.init();
  if (save.hasSave()) continueGame();
  else newGame();
}

if (continueBtn) continueBtn.addEventListener('click', (e) => { e.stopPropagation(); continueGame(); });
if (newGameBtn) newGameBtn.addEventListener('click', (e) => { e.stopPropagation(); newGame(); });

hud.setObjective('Explore Solmar Bay');

window.addEventListener('keydown', (e) => {
  if (e.code === 'Enter' && game.state === 'title') startFromTitle();
  if (e.code === 'KeyM') { audio.toggleMute(); }
});
titleEl.addEventListener('click', () => {
  if (game.state === 'title') startFromTitle();
});

window.addEventListener('resize', () => {
  cameraRig.camera.aspect = window.innerWidth / window.innerHeight;
  cameraRig.camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();
const params = new URLSearchParams(window.location.search);
const shotName = params.get('shot');
let shotFired = false;

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  const mouse = input.consumeMouse();

  // Slice 7: the death screens watch health every frame, with the
  // same real dt the other updates get (never a fixed 1/60 — the
  // headless frame rate is far below 60 fps, and a fixed dt would
  // drain the respawn protection in slow motion).
  death.update(dt);

  // Slice 8: save once when a respawn lands (death protection starts).
  if (death.isDead()) saveAfterRespawn = true;
  else if (death.isProtected() && saveAfterRespawn) { saveAfterRespawn = false; persistSave(); }

  // Slice 7: while a fail/death screen is up the whole gameplay
  // block is skipped — player, traffic, peds, police, combat and
  // missions all stay put. HUD + render keep running below.
  if (game.state === 'play' && !death.isDead()) {
    // E is edge-triggered: enter the nearest car on foot, exit while driving.
    const eDown = input.keys.has('KeyE');
    if (eDown && !prevE) {
      if (!driving) {
        const car = nearestCar(cars, player.pos.x, player.pos.z, 4);
        if (car) {
          driving = true;
          police.addWanted(1); // Slice 4: stealing a car is a crime (+1 star).
          currentCar = car;
          car.speed = 0;
          player.mesh.visible = false;
          hud.setObjective('Drive — WASD to drive, E to get out');
        }
      } else {
        const car = currentCar;
        driving = false;
        currentCar = null;
        car.speed = 0;
        // Place the player beside the car (right side, perpendicular to heading).
        player.pos.set(car.x + Math.cos(car.heading) * 2.5, 0, car.z - Math.sin(car.heading) * 2.5);
        player.mesh.position.copy(player.pos);
        player.mesh.visible = true;
        hud.setObjective('Explore Solmar Bay');
      }
    }
    prevE = eDown;
    // Slice 3: traffic + pedestrians run every play frame. While driving
    // the car is the obstacle other road users react to, not the player.
    const roadUser = driving && currentCar ? currentCar : player;
    traffic.update(dt, roadUser, cars);
    updatePeds(dt, roadUser, [...cars, ...traffic.cars]);
    // Slice 4: police pursuit + wanted stars, synced to the HUD. The
    // driven car is the pursuit target, not an obstacle: police keep a
    // gap from every other car so they can close in and ram it.
    police.update(dt, roadUser, [...cars.filter((c) => c !== currentCar), ...traffic.cars]);
    wanted = police.getWanted();
    // Slice 5: courier missions — reach the gold marker; the HUD
    // objective is pushed every frame, so it overwrites the one-off
    // steal/exit objective strings set above on the same frame.
    missions.update(dt, roadUser);
    hud.setObjective(missions.getObjectiveText());
    // Slice 4: hitting a pedestrian with the driven car is a crime
    // (+1 star). A ped already down does not trigger again.
    if (driving && currentCar && Math.abs(currentCar.speed) > 3) {
      for (const ped of peds) {
        const dx = currentCar.x - ped.x, dz = currentCar.z - ped.z;
        if (dx * dx + dz * dz < 2.2 * 2.2 && !(ped.knockedDown > 0)) {
          police.addWanted(1);
          wanted = police.getWanted();
          knockDownPed(ped, 4);
        }
      }
    }
    if (driving && currentCar) {
      updateCar(currentCar, input, dt, city.colliders, city.bounds, [...cars, ...traffic.cars]);
      cameraRig.updateDriving(dt, currentCar);
    } else {
      player.update(dt, input, cameraRig.yaw);
      cameraRig.update(dt, player, mouse.dx, mouse.dy);
    }
    // Slice 6: combat steps after the player/car move so player.yaw is
    // fresh for the punch cone; driving skips punches inside update().
    // Player health lives in combat — sync it here for the HUD.
    // Slice 7: no punches or brawling while respawn protection runs,
    // so a street opponent next to the spawn cannot land a hit
    // before the player can move.
    if (!death.isProtected()) combat.update(dt, player, input, driving);
    health = combat.getHealth();
  } else {
    cameraRig.update(dt, player, 0, 0);
  }

  hud.update({ cash, wanted, health, playerPos: driving && currentCar ? currentCar : player.pos, yaw: player.yaw, city, driving, speed: driving && currentCar ? currentCar.speed : 0, target: missions.getCurrentTarget() });

  renderer.render(scene, cameraRig.camera);

  if (shotName && !shotFired) {
    shotFired = true;
    setupShot(shotName, { camera: cameraRig, player, city, scene, THREE, setState });
    window.__shotReady = true;
  }
}

frame();
