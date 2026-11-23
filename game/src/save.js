// Solmar Bay — save game (slice 8). One small module, one job:
// persist the run's progress in localStorage so a player can pick
// the route back up later. It never touches the live game — no
// events, no listeners, no DOM — the wiring session calls save()
// after a mission completes, after a knockout, and after a respawn,
// and reads the save back on the title screen.
//
//   const save = createSave();            // uses window.localStorage
//   const save = createSave(storage);     // any { getItem, setItem, removeItem }
//   save.save({ completed, cash, knockouts });
//   save.load();      // { completed, cash, knockouts } | null
//   save.hasSave();   // true when a readable save exists
//   save.clearSave(); // wipe the save (e.g. "New Game" over an old run)
//
// What is stored (and what is not):
//   - completed: deliveries finished so far (0..3, from
//     missions.getCompleted()). Wanted is NOT stored: respawn
//     already clears it to 0, so a fresh load starts clean.
//   - cash: the cash total (missions + knockout rewards).
//   - knockouts: opponents knocked out so far (0..3, from
//     combat.getKnockouts()). Opponent positions are NOT stored:
//     a loaded run re-rolls them fresh, the same as a respawn does.
//   - version + savedAt ride along so a future format can be told
//     apart from this one; they are not game state.
//
// Load semantics (for the wiring session):
//   - load() returns the saved object, or null when there is no
//     save, the JSON is damaged, or a field is missing / out of
//     range. It never throws.
//   - On the title screen, hasSave() decides whether to show a
//     Continue button. A damaged save reads as "no save", so the
//     player is never offered a Continue that cannot load.
//   - After a load, the player goes back to the city spawn with
//     health 100, and missions resume from the first unfinished
//     delivery: completed restores as-is, so getCurrent() points at
//     mission index `completed` (null when completed is 3, i.e.
//     the route is done and the player is in free roam).
//
// Zero network: localStorage only, no fetch, no imports, no
// external resources. All names and copy are original fiction
// for Solmar Bay.

export const SAVE_KEY = 'solmar-bay-save-v1';
const SAVE_VERSION = 1;
const TOTAL_MISSIONS = 3;
const TOTAL_OPPONENTS = 3;

// A whole, non-negative integer inside [0, max], or null.
function cleanCount(value, max) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const n = Math.floor(value);
  if (n < 0 || n > max) return null;
  return n;
}

// Resolve the storage backend: the injected one in tests, otherwise
// the browser's localStorage. Anything unusable becomes null, and
// every public method then degrades to a safe no-op / null.
function resolveStorage(storage) {
  if (storage && typeof storage.getItem === 'function' &&
      typeof storage.setItem === 'function' &&
      typeof storage.removeItem === 'function') {
    return storage;
  }
  try {
    const ls = typeof globalThis !== 'undefined' ? globalThis.localStorage : null;
    if (ls && typeof ls.getItem === 'function' &&
        typeof ls.setItem === 'function' &&
        typeof ls.removeItem === 'function') {
      return ls;
    }
  } catch (err) {
    // localStorage can throw on access (private mode, disabled
    // cookies): treat it as absent rather than crashing the game.
  }
  return null;
}

export function createSave(storage) {
  const store = resolveStorage(storage);

  // Write one save. Accepts the live numbers straight from the
  // game ({ completed, cash, knockouts }); anything else is
  // rejected and the previous save is left untouched. Returns
  // true when the save landed, false otherwise (bad input, no
  // storage, or the browser refused the write). Never throws.
  function save(state) {
    if (!store) return false;
    if (!state || typeof state !== 'object') return false;
    const completed = cleanCount(state.completed, TOTAL_MISSIONS);
    const knockouts = cleanCount(state.knockouts, TOTAL_OPPONENTS);
    if (completed === null || knockouts === null) return false;
    if (typeof state.cash !== 'number' || !Number.isFinite(state.cash)) return false;
    const cash = Math.floor(state.cash);
    if (cash < 0) return false;
    const record = {
      version: SAVE_VERSION,
      completed,
      cash,
      knockouts,
      savedAt: Date.now(),
    };
    try {
      store.setItem(SAVE_KEY, JSON.stringify(record));
      return true;
    } catch (err) {
      return false;
    }
  }

  // Read the save back: { completed, cash, knockouts } (savedAt
  // is not returned — it is bookkeeping, not game state), or null
  // when there is nothing to read or the stored text is damaged.
  // Damaged means: not JSON, not an object, wrong version, or a
  // field missing / not a number / out of range. Never throws.
  function load() {
    if (!store) return null;
    let raw;
    try {
      raw = store.getItem(SAVE_KEY);
    } catch (err) {
      return null;
    }
    if (typeof raw !== 'string' || raw.length === 0) return null;
    let record;
    try {
      record = JSON.parse(raw);
    } catch (err) {
      return null;
    }
    if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
    if (record.version !== SAVE_VERSION) return null;
    const completed = cleanCount(record.completed, TOTAL_MISSIONS);
    const knockouts = cleanCount(record.knockouts, TOTAL_OPPONENTS);
    if (completed === null || knockouts === null) return null;
    if (typeof record.cash !== 'number' || !Number.isFinite(record.cash)) return null;
    const cash = Math.floor(record.cash);
    if (cash < 0) return null;
    return { completed, cash, knockouts };
  }

  // True only when load() would hand back a save — a damaged
  // entry counts as no save, so the title screen never offers a
  // Continue that cannot load.
  function hasSave() {
    return load() !== null;
  }

  // Remove the save entirely. Returns true when the entry is gone
  // afterwards (including when there was nothing there), false
  // only when storage itself is unusable. Never throws.
  function clearSave() {
    if (!store) return false;
    try {
      store.removeItem(SAVE_KEY);
      return true;
    } catch (err) {
      return false;
    }
  }

  return { save, load, hasSave, clearSave, key: SAVE_KEY };
}
