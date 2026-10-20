// Keyboard, mouse and touch input, collapsed into a small intent struct the game reads each frame.

export interface Pointer {
  active: boolean;
  x: number; // CSS pixels relative to the canvas
  y: number;
}

/** How far (CSS px) the knob travels from the stick's base. */
const STICK_RADIUS = 40;

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

  /** Steering keys currently held down; used to spin in the air. */
  private held = { left: false, right: false };

  /** Mouse steering: last known position; disabled until the mouse moves again after a key press. */
  mouse: Pointer = { active: false, x: 0, y: 0 };
  /**
   * Touch steering: a floating stick that appears wherever a finger lands.
   * dx / dy are the knob offset from the base, normalised to -1..1 (dy positive = downhill).
   */
  stick = { active: false, dx: 0, dy: 0 };

  private readonly canvas: HTMLCanvasElement;
  private touchId: number | null = null;
  private stickBase = { x: 0, y: 0 };
  private readonly stickEl: HTMLElement;
  private readonly knobEl: HTMLElement;

  constructor(canvas: HTMLCanvasElement, touchRoot: HTMLElement) {
    this.canvas = canvas;
    this.stickEl = document.createElement('div');
    this.stickEl.className = 'stick hidden';
    this.knobEl = document.createElement('div');
    this.knobEl.className = 'knob';
    this.stickEl.appendChild(this.knobEl);
    document.body.appendChild(this.stickEl);

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
        this.moveStick(e.clientX, e.clientY);
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
      this.stickBase = { x: e.clientX, y: e.clientY };
      this.stick = { active: true, dx: 0, dy: 0 };
      this.moveStick(e.clientX, e.clientY);
      this.stickEl.classList.remove('hidden');
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    const endTouch = (e: PointerEvent) => {
      if (e.pointerId === this.touchId) {
        this.touchId = null;
        this.stick = { active: false, dx: 0, dy: 0 };
        this.stickEl.classList.add('hidden');
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
          case 'jump': this.jump = true; this.codes.push('Space'); break;
          case 'fast': this.fastToggle = true; break;
        }
      };
      btn.addEventListener('pointerdown', press);
    });
  }

  /** Place the knob under the finger; past the rim the base is dragged along so the stick follows. */
  private moveStick(cx: number, cy: number): void {
    let dx = cx - this.stickBase.x, dy = cy - this.stickBase.y;
    const len = Math.hypot(dx, dy);
    if (len > STICK_RADIUS) {
      const k = (len - STICK_RADIUS) / len;
      this.stickBase.x += dx * k;
      this.stickBase.y += dy * k;
      dx -= dx * k;
      dy -= dy * k;
    }
    this.stick.dx = dx / STICK_RADIUS;
    this.stick.dy = dy / STICK_RADIUS;
    this.stickEl.style.transform = `translate(${this.stickBase.x}px, ${this.stickBase.y}px)`;
    this.knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  /** -1 / +1 while a left / right steering key is held, else 0. */
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
