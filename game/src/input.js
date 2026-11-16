// Keyboard and mouse, and the pointer lock that turns the mouse into look.
// Plain browser APIs only. The game asks the canvas for pointer lock and reads
// movementX/Y while it holds it. Number keys, B, G, E and Q are game actions
// the simulation reads through the same key set; this module never decides
// what a key does.
export function createInput(canvas, onLockChange) {
  const keys = new Set();
  const state = {
    keys,
    locked: false,
    firing: false,
    aiming: false,
    lookX: 0,
    lookY: 0,
    // Edge-triggered presses: set on keydown, consumed by whoever reads them.
    pressed: new Set(),
  };

  function setKey(event, down) {
    if (down) {
      if (!keys.has(event.code)) state.pressed.add(event.code);
      keys.add(event.code);
    } else {
      keys.delete(event.code);
    }
    if (event.code === 'Space' || event.code === 'Tab') event.preventDefault();
  }

  window.addEventListener('keydown', (event) => setKey(event, true));
  window.addEventListener('keyup', (event) => setKey(event, false));
  window.addEventListener('blur', () => {
    keys.clear();
    state.firing = false;
    state.aiming = false;
  });
  window.addEventListener('mousemove', (event) => {
    if (!state.locked) return;
    state.lookX += event.movementX;
    state.lookY += event.movementY;
  });
  window.addEventListener('mousedown', (event) => {
    if (!state.locked) return;
    if (event.button === 0) state.firing = true;
    if (event.button === 2) state.aiming = true;
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) state.firing = false;
    if (event.button === 2) state.aiming = false;
  });
  window.addEventListener('contextmenu', (event) => event.preventDefault());
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) {
      keys.clear();
      state.firing = false;
      state.aiming = false;
    }
    onLockChange(state.locked);
  });

  return {
    state,
    requestLock() {
      canvas.requestPointerLock();
    },
    exitLock() {
      if (document.pointerLockElement) document.exitPointerLock();
    },
    takeLook() {
      const x = state.lookX;
      const y = state.lookY;
      state.lookX = 0;
      state.lookY = 0;
      return { x, y };
    },
    // True once for a key pressed since the last call, then cleared.
    consumePress(code) {
      if (state.pressed.has(code)) {
        state.pressed.delete(code);
        return true;
      }
      return false;
    },
    clearPresses() {
      state.pressed.clear();
    },
  };
}
