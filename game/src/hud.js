// Solmar Bay — the HUD: the start screen, the in-game readouts (cash, clock,
// objective, controls hint) and the 2D top-down minimap.
import { CONFIG } from './config.js';

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatClock(minutes) {
  const total = Math.floor(minutes) % (24 * 60);
  const hh = String(Math.floor(total / 60)).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function createHud(minimapData) {
  const root = document.getElementById('hud');

  // --- start screen ---------------------------------------------------------
  const startScreen = el('div', 'start-screen');
  startScreen.innerHTML =
    '<h1>SOLMAR BAY</h1>'
    + '<p class="tagline">A sun-soaked coastal city. Yours to walk.</p>'
    + '<p class="story">You just got off the bus at Marlin Plaza with $0 in your pocket '
    + 'and the whole of Solmar Bay in front of you. Walk the streets, learn the city — '
    + 'the work comes later.</p>'
    + '<div class="controls">'
    + '<div><b>W A S D</b> / arrows — walk</div>'
    + '<div><b>Shift</b> — run</div>'
    + '<div><b>Mouse drag</b> — look around</div>'
    + '</div>'
    + '<p class="start-prompt">Click or press Enter to start</p>';
  root.appendChild(startScreen);

  // --- in-game HUD ------------------------------------------------------------
  const bar = el('div', 'hud-bar hidden');
  const cash = el('div', 'cash', '$0');
  const clock = el('div', 'clock', '17:32');
  const objective = el('div', 'objective', CONFIG.hud.objective);
  bar.appendChild(cash);
  bar.appendChild(objective);
  bar.appendChild(clock);
  root.appendChild(bar);

  const mapWrap = el('div', 'minimap-wrap hidden');
  const mapCanvas = document.createElement('canvas');
  mapCanvas.width = CONFIG.hud.minimapSize;
  mapCanvas.height = CONFIG.hud.minimapSize;
  mapCanvas.className = 'minimap';
  mapWrap.appendChild(mapCanvas);
  const mapLabel = el('div', 'minimap-label', 'SOLMAR BAY');
  mapWrap.appendChild(mapLabel);
  root.appendChild(mapWrap);

  const hint = el('div', 'hint hidden', 'WASD walk · Shift run · drag mouse to look');
  root.appendChild(hint);

  const hud = {
    startScreen,
    bar,
    mapWrap,
    hint,
    cash,
    clock,
    objective,
    mapCanvas,
    mapCtx: mapCanvas.getContext('2d'),

    showTitle() {
      startScreen.classList.remove('hidden');
      bar.classList.add('hidden');
      mapWrap.classList.add('hidden');
      hint.classList.add('hidden');
    },
    showGame() {
      startScreen.classList.add('hidden');
      bar.classList.remove('hidden');
      mapWrap.classList.remove('hidden');
      hint.classList.remove('hidden');
    },
    setCash(value) {
      hud.cash.textContent = `$${value}`;
    },
    setClock(minutes) {
      hud.clock.textContent = formatClock(minutes);
    },
    setObjective(text) {
      hud.objective.textContent = text;
    },

    /** Redraw the minimap: sea, blocks, roads, palms, and the player arrow. */
    drawMinimap(playerPos, playerHeading) {
      const ctx = hud.mapCtx;
      const size = CONFIG.hud.minimapSize;
      const data = minimapData;
      const b = data.bounds;
      const worldW = b.boundX * 2;
      const worldH = b.boundZMax - b.boundZMin;
      const scale = size / Math.max(worldW, worldH);
      const ox = (size - worldW * scale) / 2;
      const oy = (size - worldH * scale) / 2;
      const px = (x) => ox + (x + b.boundX) * scale;
      const pz = (z) => oy + (z - b.boundZMin) * scale;

      ctx.clearRect(0, 0, size, size);
      ctx.fillStyle = '#20242c';
      ctx.fillRect(0, 0, size, size);
      // Sea along the south edge.
      ctx.fillStyle = '#2fa8d8';
      ctx.fillRect(0, pz(data.sea.z0), size, size - pz(data.sea.z0));
      // Sand strip.
      ctx.fillStyle = '#f0d09a';
      ctx.fillRect(0, pz(b.beachZ), size, pz(data.sea.z0) - pz(b.beachZ));
      // Blocks.
      ctx.fillStyle = '#8a7a68';
      for (const block of data.blocks) {
        ctx.fillRect(px(block.x - block.size / 2), pz(block.z - block.size / 2), block.size * scale, block.size * scale);
      }
      // Roads as pale lines.
      ctx.strokeStyle = '#c9c2b4';
      ctx.lineWidth = Math.max(1, 7 * scale);
      for (const line of data.roads) {
        ctx.beginPath();
        ctx.moveTo(px(line), 0);
        ctx.lineTo(px(line), size);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, pz(line));
        ctx.lineTo(size, pz(line));
        ctx.stroke();
      }
      // Player arrow, pointing along the heading.
      const x = px(playerPos.x);
      const y = pz(playerPos.z);
      ctx.save();
      ctx.translate(x, y);
      // The arrow is drawn pointing up (north); rotate it to the heading.
      // Map x is east, map y is south, so heading h needs rotation PI - h.
      ctx.rotate(Math.PI - playerHeading);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#111111';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(5, 6);
      ctx.lineTo(0, 3);
      ctx.lineTo(-5, 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    },
  };
  return hud;
}
