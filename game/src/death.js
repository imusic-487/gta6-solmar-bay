// Solmar Bay — death + mission-failure screens and respawn (slice 7).
//
//   const death = createDeath({
//     getHealth, getMissionState, respawnPlayer,
//     clearWanted, resetHealth, resetOpponents, resetMission,
//     getStats, graceSeconds, container, onDeath, onRespawn,
//   });
//   Returns { update, isDead, getState, getKind, getGraceRemaining,
//             isProtected, respawn, destroy, element }.
//
//   What it does: watches player health every frame. When health hits
//   zero it shows one of two full-screen overlays and freezes play:
//     - a mission is active (getMissionState().current is not null)
//       -> the DELIVERY FAILED screen: the run ends, finished drops
//       still count, the current delivery restarts from the depot.
//     - the route is done (isComplete() is true, free roam)
//       -> the OUT COLD screen: the day is over but the streets
//       still bite; cash and knockouts are kept.
//   "In a mission" means getCurrent() is non-null; "free roam" means
//   isComplete() is true. Those two cover every state: current is
//   null exactly when all three deliveries are done.
//
//   Freezing: this module never touches the game loop itself. It only
//   reports state — main.js must skip the gameplay updates while
//   death.isDead() is true (player / traffic / police / combat /
//   missions all stay put) and keep rendering + HUD refreshing, the
//   same way the title screen already renders without updating play.
//   While respawn protection is up (isProtected()), main.js must also
//   skip combat.update, so a street opponent standing next to the
//   spawn cannot land a hit before the player can move.
//   Call death.update(dt) once per frame with the SAME dt the other
//   updates get (never a fixed 1/60 from a timer): grace and the
//   re-trigger guard are measured in that dt.
//
//   Respawn (R key or the on-screen button) runs, in order:
//     1. hide the overlay, state back to 'alive';
//     2. resetHealth() — combat restores health to 100;
//     3. respawnPlayer() — main puts the player back on city.spawn
//        (and out of any car, mesh visible again);
//     4. clearWanted() — wanted back to 0, patrol cars stand down;
//     5. resetOpponents() — living opponents go back to fresh spots
//        away from the spawn, knocked-out ones stay down;
//     6. resetMission() — only on the failed screen: the marker goes
//        back to the current delivery's target;
//     7. respawn protection starts (graceSeconds, default 5 s).
//   Cash, knockouts and finished deliveries are never touched here,
//   so they survive respawn by construction.
//
//   All copy is original fiction for Solmar Bay. No borrowed names,
//   lines, art or music from any other game.

const RESPAWN_KEY = 'KeyR'; // R: get back up / back on the route
const DEFAULT_GRACE_SECONDS = 5;

// Original copy — written fresh for Solmar Bay.
const COPY = {
  failed: {
    title: 'DELIVERY FAILED',
    reason: 'The run ends here — the parcel never reached its stop.',
    body: 'Bayline Couriers pulls the parcel back to the depot. Your finished drops still count — pick the route back up from the start.',
    button: 'Back on the route',
    hint: 'Press R or tap the button to get back on the route.',
  },
  dead: {
    title: 'OUT COLD',
    reason: 'Solmar Bay keeps moving while you catch your breath.',
    body: 'The route is done and the day is yours — but the streets still bite. Your cash and knockouts stay where you left them.',
    button: 'Get back up',
    hint: 'Press R or tap the button to get back up.',
  },
};

export function createDeath(options) {
  const opts = options || {};
  const getHealth = typeof opts.getHealth === 'function' ? opts.getHealth : null;
  const getMissionState = typeof opts.getMissionState === 'function'
    ? opts.getMissionState
    : null;
  const respawnPlayer = typeof opts.respawnPlayer === 'function'
    ? opts.respawnPlayer
    : null;
  const clearWanted = typeof opts.clearWanted === 'function' ? opts.clearWanted : null;
  const resetHealth = typeof opts.resetHealth === 'function' ? opts.resetHealth : null;
  const resetOpponents = typeof opts.resetOpponents === 'function'
    ? opts.resetOpponents
    : null;
  const resetMission = typeof opts.resetMission === 'function' ? opts.resetMission : null;
  const getStats = typeof opts.getStats === 'function' ? opts.getStats : null;
  const onDeath = typeof opts.onDeath === 'function' ? opts.onDeath : null;
  const onRespawn = typeof opts.onRespawn === 'function' ? opts.onRespawn : null;
  const graceSeconds = typeof opts.graceSeconds === 'number' && opts.graceSeconds > 0
    ? opts.graceSeconds
    : DEFAULT_GRACE_SECONDS;
  const container = opts.container || document.body;

  // 'alive' | 'failed' (mission screen) | 'dead' (free-roam screen).
  let state = 'alive';
  let kind = null; // null | 'failed' | 'dead' — which screen is showing
  let graceLeft = 0; // seconds of respawn protection still running
  let missionName = '';

  // --- Overlay DOM (built here; hud.js and index.html are untouched). ---
  const el = document.createElement('div');
  el.id = 'death-overlay';
  el.dataset.kind = '';
  el.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:30',
    'display:none', 'flex-direction:column',
    'align-items:center', 'justify-content:center',
    'background:rgba(8,12,20,0.82)', 'color:#fff',
    'font-family:system-ui,sans-serif', 'text-align:center',
    'overflow:hidden',
  ].join(';');
  // The card scrolls internally when the window is short: without
  // this, a centred flex column taller than the viewport clips its
  // top and pushes the button below the fold (seen at 480x300).
  el.innerHTML =
    '<div data-death-card style="margin:auto;max-width:640px;max-height:100%;overflow-y:auto;padding:12px 20px;">' +
    '<div data-death-title style="font-size:56px;font-weight:800;letter-spacing:6px;color:#ffd27a;text-shadow:0 2px 18px rgba(255,170,60,.5);"></div>' +
    '<div data-death-reason style="font-size:20px;margin:14px 0 6px;color:#e8ecf1;"></div>' +
    '<div data-death-detail style="font-size:16px;margin:0 0 6px;color:#9fb0c3;"></div>' +
    '<div data-death-body style="font-size:17px;line-height:1.6;margin:8px 0 28px;color:#dfe6ee;"></div>' +
    '<button id="death-respawn-btn" type="button" style="font-size:20px;font-weight:700;padding:12px 32px;border-radius:8px;border:0;background:#ffd27a;color:#1a2836;cursor:pointer;"></button>' +
    '<div data-death-hint style="font-size:15px;margin-top:18px;color:#9fb0c3;"></div>' +
    '</div>';
  container.appendChild(el);

  const titleEl = el.querySelector('[data-death-title]');
  const reasonEl = el.querySelector('[data-death-reason]');
  const detailEl = el.querySelector('[data-death-detail]');
  const bodyEl = el.querySelector('[data-death-body]');
  const buttonEl = el.querySelector('#death-respawn-btn');
  const hintEl = el.querySelector('[data-death-hint]');

  function readMissionState() {
    if (!getMissionState) return { current: null, isComplete: true, completed: 0 };
    try {
      const s = getMissionState() || {};
      return {
        current: s.current || null,
        isComplete: !!s.isComplete,
        completed: typeof s.completed === 'number' ? s.completed : 0,
      };
    } catch (err) {
      console.warn('[death] getMissionState failed, treating as free roam:', err);
      return { current: null, isComplete: true, completed: 0 };
    }
  }

  function readHealth() {
    if (!getHealth) return 100;
    try {
      const h = getHealth();
      return typeof h === 'number' && Number.isFinite(h) ? h : 100;
    } catch (err) {
      console.warn('[death] getHealth failed:', err);
      return 100;
    }
  }

  function show(nextKind, mission) {
    kind = nextKind;
    state = nextKind; // 'failed' or 'dead'
    const copy = COPY[nextKind];
    missionName = mission && mission.name ? mission.name : '';
    titleEl.textContent = copy.title;
    reasonEl.textContent = copy.reason;
    detailEl.textContent = nextKind === 'failed' && missionName
      ? 'Interrupted delivery: ' + missionName + '.'
      : '';
    detailEl.style.display = detailEl.textContent ? '' : 'none';
    let body = copy.body;
    if (getStats) {
      try {
        const st = getStats() || {};
        const bits = [];
        if (typeof st.completed === 'number') bits.push('Deliveries done: ' + st.completed + '/3');
        if (typeof st.cash === 'number') bits.push('Cash kept: $' + st.cash);
        if (typeof st.knockouts === 'number') bits.push('Knockouts kept: ' + st.knockouts);
        if (bits.length > 0) body += ' ' + bits.join(' · ') + '.';
      } catch (err) {
        console.warn('[death] getStats failed:', err);
      }
    }
    bodyEl.textContent = body;
    buttonEl.textContent = copy.button + '  (R)';
    hintEl.textContent = copy.hint;
    el.dataset.kind = nextKind;
    el.style.display = 'flex';
    if (onDeath) {
      try { onDeath(nextKind, { mission: missionName }); } catch (err) {
        console.warn('[death] onDeath failed:', err);
      }
    }
  }

  function hide() {
    el.style.display = 'none';
    el.dataset.kind = '';
  }

  // Step every frame from main.js, with the frame dt. While the screen
  // is up nothing here advances — the freeze itself is main.js not
  // calling the gameplay updates (see the header). While respawn
  // protection runs, a zero health reading cannot re-trigger the
  // screen: that covers the one frame where resetHealth has not
  // landed yet, and if resetHealth is missing entirely the screen
  // correctly comes back once protection expires instead of looping
  // instantly.
  function update(dt) {
    if (state !== 'alive') return;
    const step = typeof dt === 'number' && dt > 0 ? Math.min(dt, 0.05) : 1 / 60;
    if (graceLeft > 0) {
      graceLeft = Math.max(0, graceLeft - step);
      return;
    }
    if (readHealth() <= 0) {
      const mission = readMissionState();
      show(mission.current ? 'failed' : 'dead', mission.current);
    }
  }

  // Respawn: R key or the button. Returns false when there is nothing
  // to respawn from (already alive); otherwise runs the steps in the
  // header order and starts respawn protection.
  function respawn() {
    if (state === 'alive') return false;
    const shownKind = kind;
    hide();
    state = 'alive';
    kind = null;
    graceLeft = graceSeconds;
    if (resetHealth) {
      resetHealth();
    } else {
      console.warn('[death] resetHealth is not wired: health stays at 0 until combat adds a reset entry point.');
    }
    if (respawnPlayer) respawnPlayer();
    else console.warn('[death] respawnPlayer is not wired: player stays where they fell.');
    if (clearWanted) clearWanted();
    if (resetOpponents) resetOpponents();
    else console.warn('[death] resetOpponents is not wired: street opponents stay where they were.');
    if (shownKind === 'failed' && resetMission) resetMission();
    if (onRespawn) {
      try { onRespawn(shownKind); } catch (err) {
        console.warn('[death] onRespawn failed:', err);
      }
    }
    return true;
  }

  function onKeyDown(e) {
    if (e && e.code === RESPAWN_KEY && state !== 'alive') respawn();
  }
  window.addEventListener('keydown', onKeyDown);
  buttonEl.addEventListener('click', respawn);

  function isDead() { return state !== 'alive'; }
  function getState() { return state; }
  function getKind() { return kind; }
  function getGraceRemaining() { return graceLeft; }
  function isProtected() { return state === 'alive' && graceLeft > 0; }

  function destroy() {
    window.removeEventListener('keydown', onKeyDown);
    buttonEl.removeEventListener('click', respawn);
    if (el.parentNode) el.parentNode.removeChild(el);
  }

  return {
    update, isDead, getState, getKind,
    getGraceRemaining, isProtected, respawn, destroy,
    element: el,
  };
}
