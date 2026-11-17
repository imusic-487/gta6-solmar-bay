// Solmar Bay HUD: cash, wanted stars, objective line, and a live minimap.
// The minimap is a plain 2D canvas: city blocks as pale rectangles on a dark
// map, a gold diamond for the current mission spot, and a bright dot for the
// player, all scaled from the city's world bounds onto the 180x180 canvas.
export function createHUD() {
  const cashEl = document.getElementById('cash');
  const starsEl = document.getElementById('stars');
  const objectiveEl = document.getElementById('objective');
  const mapEl = document.getElementById('minimap');
  const mapCtx = mapEl ? mapEl.getContext('2d') : null;
  const MAP_SIZE = 180;
  let objective = 'Explore Solmar Bay';

  // Slice 2 speed display: created here (no #speed element in index.html),
  // appended to the HUD bar so it inherits the #hud span styling.
  const speedEl = document.createElement('span');
  speedEl.id = 'speed';
  speedEl.style.display = 'none';
  speedEl.textContent = '0 km/h';
  const hudBarEl = document.getElementById('hud');
  if (hudBarEl) hudBarEl.appendChild(speedEl);
  else document.body.appendChild(speedEl);

  function setObjective(text) {
    objective = text;
    if (objectiveEl) objectiveEl.textContent = text;
  }

  function drawMinimap(playerPos, city) {
    if (!mapCtx || !playerPos) return;
    mapCtx.clearRect(0, 0, MAP_SIZE, MAP_SIZE);
    mapCtx.fillStyle = '#0b1826';
    mapCtx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);

    // World -> canvas scale. Falls back to a fixed span if the city is missing.
    const bounds = city && city.bounds ? city.bounds : { minX: -162, maxX: 162, minZ: -162, maxZ: 162 };
    const spanX = bounds.maxX - bounds.minX || 1;
    const spanZ = bounds.maxZ - bounds.minZ || 1;
    const toX = (x) => ((x - bounds.minX) / spanX) * MAP_SIZE;
    const toY = (z) => ((z - bounds.minZ) / spanZ) * MAP_SIZE; // north (-z) at the top

    // City blocks as light rectangles.
    if (city && Array.isArray(city.blocks)) {
      mapCtx.fillStyle = '#b7a98f';
      for (const b of city.blocks) {
        const w = Math.max(2, (b.w / spanX) * MAP_SIZE);
        const h = Math.max(2, (b.d / spanZ) * MAP_SIZE);
        mapCtx.fillRect(toX(b.x - b.w / 2), toY(b.z - b.d / 2), w, h);
      }
      // Mission marker: a fixed central block, drawn as a gold diamond.
      const mark = city.blocks[Math.min(21, city.blocks.length - 1)];
      if (mark) {
        const mx = toX(mark.x);
        const my = toY(mark.z);
        mapCtx.fillStyle = '#ffc93f';
        mapCtx.beginPath();
        mapCtx.moveTo(mx, my - 7);
        mapCtx.lineTo(mx + 7, my);
        mapCtx.lineTo(mx, my + 7);
        mapCtx.lineTo(mx - 7, my);
        mapCtx.closePath();
        mapCtx.fill();
      }
    }

    // Player dot, bright with a dark rim so it reads on any block.
    const px = toX(playerPos.x);
    const py = toY(playerPos.z);
    mapCtx.fillStyle = '#0b1826';
    mapCtx.beginPath();
    mapCtx.arc(px, py, 6, 0, Math.PI * 2);
    mapCtx.fill();
    mapCtx.fillStyle = '#ff5a4e';
    mapCtx.beginPath();
    mapCtx.arc(px, py, 4, 0, Math.PI * 2);
    mapCtx.fill();
  }

  function update(state) {
    const cash = state && typeof state.cash === 'number' ? state.cash : 0;
    const wanted = state && typeof state.wanted === 'number'
      ? Math.max(0, Math.min(5, Math.round(state.wanted)))
      : 0;
    if (cashEl) cashEl.textContent = '$' + cash;
    if (starsEl) starsEl.textContent = '★'.repeat(wanted) + '☆'.repeat(5 - wanted);
    // Slice 2: show km/h while driving, hidden on foot.
    const isDriving = !!(state && state.driving);
    const speed = state && typeof state.speed === 'number' ? state.speed : 0;
    if (speedEl) {
      speedEl.style.display = isDriving ? '' : 'none';
      if (isDriving) speedEl.textContent = Math.round(Math.abs(speed) * 3.6) + ' km/h';
    }
    if (objectiveEl) objectiveEl.textContent = objective;
    drawMinimap(state ? state.playerPos : null, state ? state.city : null);
  }

  return { update, setObjective };
}
