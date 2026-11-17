// Solmar Bay — keyboard and mouse-drag input. The game reads this one object;
// nothing else touches key or pointer events directly.
export function createInput(canvas) {
  const keys = new Set();
  const input = {
    keys,
    // Accumulated mouse-drag deltas, consumed by the camera each frame.
    dragYaw: 0,
    dragPitch: 0,
    dragging: false,
    // True while any of the given codes is held.
    any(...codes) {
      return codes.some((code) => keys.has(code));
    },
    // Forward/back/strafe as -1, 0 or 1, from WASD or the arrow keys.
    moveAxes() {
      const forward = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0)
        - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
      const strafe = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0)
        - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
      return { forward, strafe };
    },
    running() {
      return keys.has('ShiftLeft') || keys.has('ShiftRight');
    },
    consumeDrag() {
      const out = { yaw: input.dragYaw, pitch: input.dragPitch };
      input.dragYaw = 0;
      input.dragPitch = 0;
      return out;
    },
  };

  window.addEventListener('keydown', (event) => {
    keys.add(event.code);
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) {
      event.preventDefault();
    }
  });
  window.addEventListener('keyup', (event) => keys.delete(event.code));
  window.addEventListener('blur', () => keys.clear());

  let lastX = 0;
  let lastY = 0;
  canvas.addEventListener('pointerdown', (event) => {
    input.dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!input.dragging) return;
    input.dragYaw -= (event.clientX - lastX) * 0.005;
    input.dragPitch += (event.clientY - lastY) * 0.004;
    lastX = event.clientX;
    lastY = event.clientY;
  });
  const endDrag = () => {
    input.dragging = false;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  return input;
}
