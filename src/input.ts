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
  /** Raw key codes pressed this frame (menus read these directly). */
  codes: string[] = [];
  /** Pointer press this frame, CSS pixels relative to the canvas. */
  tap: { x: number; y: number } | null = null;

  /** Steering keys / buttons currently held down; used to spin in the air. */
  private held = { left: false, right: false };

  /** Mouse steering: last known position; disabled until the mouse moves again after a key press. */
  mouse: Pointer = { active: false, x: 0, y: 0 };
  /** Touch steering: finger held on the slope. */
  touch: Pointer = { active: false, x: 0, y: 0 };

  private readonly canvas: HTMLCanvasElement;
  private touchId: number | null = null;

  constructor(canvas: HTMLCanvasElement, touchRoot: HTMLElement) {
    this.canvas = canvas;

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;   // typing a name or room code
      if (e.repeat && e.code !== 'ArrowLeft' && e.code !== 'ArrowRight' && e.code !== 'KeyA' && e.code !== 'KeyD') return;
      this.any = true;
      this.codes.push(e.code);
      switch (e.code) {
        case 'ArrowLeft': case 'KeyA': this.turn = -1; this.held.left = true; this.mouse.active = false; break;
        case 'ArrowRight': case 'KeyD': this.turn = 1; this.held.right = true; this.mouse.active = false; break;
        case 'ArrowDown': case 'KeyS': this.straight = true; this.mouse.active = false; break;
        case 'ArrowUp': case 'KeyW': case 'Space': this.jump = true; break;
        case 'KeyF': case 'ShiftLeft': case 'ShiftRight': this.fastToggle = true; break;
        case 'KeyP': case 'Escape': this.pause = true; break;
        case 'KeyR': this.restart = true; break;
        case 'Enter': case 'Backspace': break;
        default: return;
      }
      e.preventDefault();
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.held.left = false;
      if (e.code === 'ArrowRight' || e.code === 'KeyD') this.held.right = false;
    });
    window.addEventListener('blur', () => { this.held.left = this.held.right = false; });

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
      const tr = canvas.getBoundingClientRect();
      this.tap = { x: e.clientX - tr.left, y: e.clientY - tr.top };
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

    // On-screen buttons. They also report key codes so menus work with them.
    touchRoot.querySelectorAll<HTMLButtonElement>('button[data-act]').forEach((btn) => {
      const act = btn.dataset.act!;
      const press = (e: Event) => {
        e.preventDefault();
        this.any = true;
        switch (act) {
          case 'left': this.turn = -1; this.held.left = true; this.codes.push('ArrowLeft'); break;
          case 'right': this.turn = 1; this.held.right = true; this.codes.push('ArrowRight'); break;
          case 'down': this.straight = true; this.codes.push('ArrowDown'); break;
          case 'jump': this.jump = true; this.codes.push('Space'); break;
          case 'fast': this.fastToggle = true; break;
        }
      };
      const release = () => {
        if (act === 'left') this.held.left = false;
        if (act === 'right') this.held.right = false;
      };
      btn.addEventListener('pointerdown', press);
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('pointerleave', release);
    });
  }

  /** -1 / +1 while a left / right steering key or button is held, else 0. */
  spinDir(): number {
    return (this.held.right ? 1 : 0) - (this.held.left ? 1 : 0);
  }

  /** Clear one-shot intents after the game has read them. */
  flush(): void {
    this.codes = [];
    this.tap = null;
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
