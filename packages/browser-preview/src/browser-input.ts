import { InputActionMap, type InputActionDefinition, type InputPointerState, type InputSnapshot, type RawInputSample } from '@ecs/runtime';

/** DOM adapter for Play input. Keyboard input is accepted only while the game canvas owns focus. */
export class BrowserInputAdapter {
  private readonly keys = new Set<string>();
  private readonly pointers = new Map<number, number>();
  private pointerX = 0;
  private pointerY = 0;
  private pointerInside = false;
  private enabled = false;
  private actions: InputActionMap;

  constructor(private readonly canvas: HTMLCanvasElement, actions = new InputActionMap()) {
    this.actions = actions;
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', 'Game view. Click to focus and use game input.');
    canvas.addEventListener('keydown', this.onKeyDown);
    canvas.addEventListener('keyup', this.onKeyUp);
    canvas.addEventListener('blur', this.onBlur);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  setActive(active: boolean): void {
    if (this.enabled === active) return;
    this.enabled = active;
    this.clear();
    this.actions.reset();
  }

  setActions(definitions: readonly InputActionDefinition[]): void {
    this.actions = new InputActionMap(definitions);
    this.clear();
  }

  sample(): InputSnapshot {
    const focused = this.enabled && document.activeElement === this.canvas && document.visibilityState !== 'hidden';
    const gamepads: RawInputSample['gamepads'][number][] = [];
    if (focused && typeof navigator.getGamepads === 'function') {
      for (const gamepad of navigator.getGamepads()) {
        if (!gamepad?.connected) continue;
        gamepads.push({ index: gamepad.index, buttons: gamepad.buttons.map(button => button.value), axes: [...gamepad.axes] });
      }
    }
    const pointerButtons = focused ? new Set(this.pointers.values()) : new Set<number>();
    const pointer: InputPointerState = {
      x: this.pointerX, y: this.pointerY, inside: focused && this.pointerInside,
      primary: pointerButtons.has(0), secondary: pointerButtons.has(2),
    };
    return this.actions.sample({ keys: focused ? this.keys : new Set(), pointerButtons, pointer, gamepads });
  }

  dispose(): void {
    this.setActive(false);
    this.canvas.removeEventListener('keydown', this.onKeyDown);
    this.canvas.removeEventListener('keyup', this.onKeyUp);
    this.canvas.removeEventListener('blur', this.onBlur);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (!this.enabled || document.activeElement !== this.canvas) return;
    this.keys.add(event.code);
    if (/^(Arrow(Up|Down|Left|Right)|Space)$/.test(event.code)) event.preventDefault();
  };
  private readonly onKeyUp = (event: KeyboardEvent) => { this.keys.delete(event.code); };
  private readonly onBlur = () => this.clear();
  private readonly onVisibilityChange = () => { if (document.visibilityState === 'hidden') this.clear(); };
  private readonly onPointerDown = (event: PointerEvent) => {
    if (!this.enabled) return;
    this.canvas.focus({ preventScroll: true });
    this.pointers.set(event.pointerId, event.button);
    try { this.canvas.setPointerCapture(event.pointerId); } catch { /* The pointer may already have ended. */ }
    this.updatePointer(event);
  };
  private readonly onPointerMove = (event: PointerEvent) => this.updatePointer(event);
  private readonly onPointerUp = (event: PointerEvent) => { this.pointers.delete(event.pointerId); this.updatePointer(event); };
  private readonly onPointerLeave = () => { this.pointerInside = false; };

  private updatePointer(event: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.pointerX = Math.max(-1, Math.min(1, (event.clientX - rect.left) / rect.width * 2 - 1));
    this.pointerY = Math.max(-1, Math.min(1, 1 - (event.clientY - rect.top) / rect.height * 2));
    this.pointerInside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
  }

  private clear(): void {
    this.keys.clear();
    this.pointers.clear();
    this.pointerInside = false;
  }
}
