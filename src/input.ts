// Keyboard, mouse and touch input, collapsed into a small intent struct the game reads each frame.

export interface Pointer {
  active: boolean;
  x: number; // CSS pixels relative to the canvas
  y: number;
}

export class Input {
  /** -1 left, +1 right, 0 none; consumed per press. */
  turn = 0;
  straight = false;
  jump = false;
  fastToggle = false;
  pause = false;
  restart = false;
  any = false;

  /** Mouse steering: last known position; disabled until the mouse moves again after a key press. */
  mouse: Pointer = { active: false, x: 0, y: 0 };
  /** Touch steering: finger held on the slope. */
  touch: Pointer = { active: false, x: 0, y: 0 };

  private readonly canvas: HTMLCanvasElement;
  private touchId: number | null = null;

  constructor(canvas: HTMLCanvasElement, touchRoot: HTMLElement) {
    this.canvas = canvas;

    window.addEventListener('keydown', (e) => {
      if (e.repeat && e.code !== 'ArrowLeft' && e.code !== 'ArrowRight' && e.code !== 'KeyA' && e.code !== 'KeyD') return;
      this.any = true;
      switch (e.code) {
        case 'ArrowLeft': case 'KeyA': this.turn = -1; this.mouse.active = false; break;
        case 'ArrowRight': case 'KeyD': this.turn = 1; this.mouse.active = false; break;
        case 'ArrowDown': case 'KeyS': this.straight = true; this.mouse.active = false; break;
        case 'ArrowUp': case 'KeyW': case 'Space': this.jump = true; break;
        case 'KeyF': case 'ShiftLeft': case 'ShiftRight': this.fastToggle = true; break;
        case 'KeyP': case 'Escape': this.pause = true; break;
        case 'KeyR': this.restart = true; break;
        default: return;
      }
      e.preventDefault();
    });

    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') {
        const r = canvas.getBoundingClientRect();
        this.mouse = { active: true, x: e.clientX - r.left, y: e.clientY - r.top };
      } else if (e.pointerId === this.touchId) {
        const r = canvas.getBoundingClientRect();
        this.touch = { active: true, x: e.clientX - r.left, y: e.clientY - r.top };
      }
    });

    canvas.addEventListener('pointerdown', (e) => {
      this.any = true;
      if (e.pointerType === 'mouse') {
        if (e.button === 0) this.jump = true;
        return;
      }
      if (this.touchId !== null) return;
      this.touchId = e.pointerId;
      const r = canvas.getBoundingClientRect();
      this.touch = { active: true, x: e.clientX - r.left, y: e.clientY - r.top };
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    const endTouch = (e: PointerEvent) => {
      if (e.pointerId === this.touchId) {
        this.touchId = null;
        this.touch.active = false;
      }
    };
    canvas.addEventListener('pointerup', endTouch);
    canvas.addEventListener('pointercancel', endTouch);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // On-screen buttons.
    touchRoot.querySelectorAll<HTMLButtonElement>('button[data-act]').forEach((btn) => {
      const act = btn.dataset.act!;
      const press = (e: Event) => {
        e.preventDefault();
        this.any = true;
        switch (act) {
          case 'left': this.turn = -1; break;
          case 'right': this.turn = 1; break;
          case 'down': this.straight = true; break;
          case 'jump': this.jump = true; break;
          case 'fast': this.fastToggle = true; break;
        }
      };
      btn.addEventListener('pointerdown', press);
    });
  }

  /** Clear one-shot intents after the game has read them. */
  flush(): void {
    this.turn = 0;
    this.straight = false;
    this.jump = false;
    this.fastToggle = false;
    this.pause = false;
    this.restart = false;
    this.any = false;
  }

  /** Convert a CSS-pixel canvas position to logical game pixels. */
  toLogical(p: Pointer, scale: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    const sx = this.canvas.width / r.width;
    const sy = this.canvas.height / r.height;
    void scale;
    return { x: p.x * sx, y: p.y * sy };
  }
}
