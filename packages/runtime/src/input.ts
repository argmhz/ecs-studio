export type InputBinding =
  | { readonly type: 'key'; readonly code: string; readonly value: number }
  | { readonly type: 'pointerButton'; readonly button: number; readonly value: number }
  | { readonly type: 'gamepadButton'; readonly button: number; readonly value: number; readonly gamepadIndex?: number }
  | { readonly type: 'gamepadAxis'; readonly axis: number; readonly scale: number; readonly gamepadIndex?: number; readonly deadzone?: number };

export interface InputActionDefinition {
  readonly name: string;
  readonly bindings: readonly InputBinding[];
}

export interface InputActionState {
  readonly value: number;
  readonly pressed: boolean;
  readonly justPressed: boolean;
  readonly justReleased: boolean;
}

export interface InputPointerState {
  /** Pointer position in normalized canvas coordinates: -1..1 on each axis. */
  readonly x: number;
  readonly y: number;
  readonly inside: boolean;
  readonly primary: boolean;
  readonly secondary: boolean;
}

export interface InputSnapshot {
  readonly actions: Readonly<Record<string, InputActionState>>;
  readonly pointer: InputPointerState;
  readonly connectedGamepads: readonly number[];
}

export interface RawInputSample {
  readonly keys: ReadonlySet<string>;
  readonly pointerButtons: ReadonlySet<number>;
  readonly pointer: InputPointerState;
  readonly gamepads: readonly {
    readonly index: number;
    readonly buttons: readonly number[];
    readonly axes: readonly number[];
  }[];
}

export const DEFAULT_INPUT_ACTIONS: readonly InputActionDefinition[] = Object.freeze([
  { name: 'moveX', bindings: [
    { type: 'key', code: 'KeyA', value: -1 }, { type: 'key', code: 'ArrowLeft', value: -1 },
    { type: 'key', code: 'KeyD', value: 1 }, { type: 'key', code: 'ArrowRight', value: 1 },
    { type: 'gamepadAxis', axis: 0, scale: 1 },
  ] },
  { name: 'moveY', bindings: [
    { type: 'key', code: 'KeyS', value: -1 }, { type: 'key', code: 'ArrowDown', value: -1 },
    { type: 'key', code: 'KeyW', value: 1 }, { type: 'key', code: 'ArrowUp', value: 1 },
    { type: 'gamepadAxis', axis: 1, scale: -1 },
  ] },
  { name: 'jump', bindings: [
    { type: 'key', code: 'Space', value: 1 }, { type: 'gamepadButton', button: 0, value: 1 },
  ] },
  { name: 'interact', bindings: [
    { type: 'pointerButton', button: 0, value: 1 }, { type: 'gamepadButton', button: 1, value: 1 },
  ] },
]);

/** Platform-independent action aggregation with edge states for each sampled frame. */
export class InputActionMap {
  private readonly definitions: readonly InputActionDefinition[];
  private readonly previous = new Map<string, boolean>();

  constructor(definitions: readonly InputActionDefinition[] = DEFAULT_INPUT_ACTIONS) {
    const names = new Set<string>();
    this.definitions = Object.freeze(definitions.map(definition => {
      if (!definition || !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(definition.name) || names.has(definition.name)) throw new TypeError('Input action names must be unique identifiers.');
      names.add(definition.name);
      if (!Array.isArray(definition.bindings) || !definition.bindings.length) throw new TypeError(`Input action "${definition.name}" needs at least one binding.`);
      const bindings = definition.bindings.map(binding => {
        if (!binding || !['key', 'pointerButton', 'gamepadButton', 'gamepadAxis'].includes(binding.type)) throw new TypeError(`Input action "${definition.name}" has an unknown binding.`);
        if ('value' in binding && (!Number.isFinite(binding.value) || binding.value < -1 || binding.value > 1 || binding.value === 0)) throw new RangeError(`Input action "${definition.name}" binding values must be between -1 and 1, excluding zero.`);
        if (binding.type === 'key' && (typeof binding.code !== 'string' || !binding.code.trim())) throw new TypeError('Key bindings need a KeyboardEvent.code.');
        if ((binding.type === 'pointerButton' || binding.type === 'gamepadButton') && (!Number.isSafeInteger(binding.button) || binding.button < 0)) throw new RangeError('Button indices must be non-negative integers.');
        if (binding.type === 'gamepadAxis' && (!Number.isSafeInteger(binding.axis) || binding.axis < 0 || !Number.isFinite(binding.scale) || binding.scale === 0 || binding.deadzone !== undefined && (!Number.isFinite(binding.deadzone) || binding.deadzone < 0 || binding.deadzone >= 1))) throw new RangeError('Gamepad axis bindings need a valid axis, scale and deadzone.');
        if ('gamepadIndex' in binding && binding.gamepadIndex !== undefined && (!Number.isSafeInteger(binding.gamepadIndex) || binding.gamepadIndex < 0)) throw new RangeError('Gamepad index must be a non-negative integer.');
        return Object.freeze({ ...binding });
      });
      return Object.freeze({ name: definition.name, bindings: Object.freeze(bindings) });
    }));
  }

  /** Returns a detached, validated copy suitable for saving in a project. */
  toJSON(): readonly InputActionDefinition[] {
    return this.definitions.map(definition => ({ ...definition, bindings: definition.bindings.map(binding => ({ ...binding })) }));
  }

  sample(raw: RawInputSample): InputSnapshot {
    const actions: Record<string, InputActionState> = {};
    for (const definition of this.definitions) {
      const values = definition.bindings.map(binding => this.readBinding(binding, raw));
      const value = Math.max(-1, Math.min(1, values.reduce((sum, item) => sum + (Number.isFinite(item) ? item : 0), 0)));
      const pressed = Math.abs(value) > 0.0001;
      const wasPressed = this.previous.get(definition.name) ?? false;
      actions[definition.name] = Object.freeze({ value, pressed, justPressed: pressed && !wasPressed, justReleased: !pressed && wasPressed });
      this.previous.set(definition.name, pressed);
    }
    return Object.freeze({
      actions: Object.freeze(actions),
      pointer: Object.freeze({ ...raw.pointer }),
      connectedGamepads: Object.freeze(raw.gamepads.map(gamepad => gamepad.index).sort((a, b) => a - b)),
    });
  }

  reset(): void { this.previous.clear(); }

  private readBinding(binding: InputBinding, raw: RawInputSample): number {
    if (binding.type === 'key') return raw.keys.has(binding.code) ? binding.value : 0;
    if (binding.type === 'pointerButton') return raw.pointerButtons.has(binding.button) ? binding.value : 0;
    const gamepads = raw.gamepads.filter(gamepad => binding.gamepadIndex === undefined || gamepad.index === binding.gamepadIndex);
    if (binding.type === 'gamepadButton') return gamepads.some(gamepad => (gamepad.buttons[binding.button] ?? 0) > 0.5) ? binding.value : 0;
    let value = 0;
    const deadzone = binding.deadzone ?? 0.15;
    for (const gamepad of gamepads) {
      const rawAxis = gamepad.axes[binding.axis] ?? 0;
      const axis = Number.isFinite(rawAxis) ? Math.max(-1, Math.min(1, rawAxis)) : 0;
      if (Math.abs(axis) > deadzone) value += axis * binding.scale;
    }
    return Math.max(-1, Math.min(1, value));
  }
}
