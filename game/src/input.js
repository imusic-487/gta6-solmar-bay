// Keyboard + mouse-drag input for Solmar Bay.
// Keys are tracked as a Set of e.code strings; mouse drag deltas are
// accumulated between consumeMouse() calls and then cleared.
export function createInput() {
  const keys = new Set();
  let dragX = 0;
  let dragY = 0;
  let dragging = false;

  window.addEventListener('keydown', (e) => {
    keys.add(e.code);
    if (e.code === 'Space') e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    keys.delete(e.code);
  });
  window.addEventListener('blur', () => {
    keys.clear();
    dragging = false;
  });

  // A drag only starts on the game canvas itself, so HUD clicks don't spin
  // the camera. movementX/Y accumulate while the button is held.
  window.addEventListener('mousedown', (e) => {
    if (e.target && e.target.tagName === 'CANVAS') dragging = true;
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    dragX += e.movementX || 0;
    dragY += e.movementY || 0;
  });
  window.addEventListener('mouseup', () => {
    dragging = false;
  });

  function consumeMouse() {
    const out = { dx: dragX, dy: dragY };
    dragX = 0;
    dragY = 0;
    return out;
  }

  return { keys, consumeMouse };
}
