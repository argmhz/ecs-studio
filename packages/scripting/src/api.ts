import type { FieldDefinition } from '@ecs/scene';

export const SCRIPT_LIFECYCLE_PHASES = ['create', 'start', 'update', 'fixedUpdate', 'event', 'destroy'] as const;
export type ScriptLifecyclePhase = typeof SCRIPT_LIFECYCLE_PHASES[number];

export type ScriptJson = null | boolean | number | string | ScriptJson[] | { [key: string]: ScriptJson };
export interface ScriptInputSnapshot {
  readonly actions: Readonly<Record<string, { readonly value: number; readonly pressed: boolean; readonly justPressed: boolean; readonly justReleased: boolean }>>;
  readonly pointer: { readonly x: number; readonly y: number; readonly inside: boolean; readonly primary: boolean; readonly secondary: boolean };
  readonly connectedGamepads: readonly number[];
}

export interface ScriptDefinition {
  readonly scriptId: string;
  readonly version: number;
  readonly properties: Readonly<Record<string, FieldDefinition>>;
}

export interface ScriptEvent {
  readonly type: string;
  readonly payload: ScriptJson;
}

export type ScriptComponentCommand =
  | { readonly operation: 'set'; readonly entityId: string; readonly componentTypeId: string; readonly data: ScriptJson }
  | { readonly operation: 'add'; readonly entityId: string; readonly componentTypeId: string; readonly data: ScriptJson }
  | { readonly operation: 'remove'; readonly entityId: string; readonly componentTypeId: string };

export interface ScriptApiInput {
  readonly entityId: string;
  readonly phase: ScriptLifecyclePhase;
  readonly deltaTime: number;
  readonly state?: ScriptJson;
  readonly properties?: Readonly<Record<string, ScriptJson>>;
  /** Current action and pointer snapshot, copied from the host for this invocation. */
  readonly input?: ScriptInputSnapshot;
  /** A snapshot of the owner's current components. Reads never expose host-owned objects. */
  readonly components?: Readonly<Record<string, ScriptJson>>;
  /** Additional entities explicitly available to this invocation by stable scene ID. */
  readonly entityComponents?: Readonly<Record<string, Readonly<Record<string, ScriptJson>>>>;
  /** Schema IDs available to this script, including components it may add. */
  readonly availableComponentTypeIds: readonly string[];
  readonly events?: readonly ScriptEvent[];
  readonly subscriptions?: readonly string[];
}

export interface ScriptApiOutput {
  readonly state: ScriptJson;
  readonly componentCommands: readonly ScriptComponentCommand[];
  readonly emittedEvents: readonly ScriptEvent[];
  readonly subscriptions: readonly string[];
}

export interface ScriptApi {
  readonly entityId: string;
  readonly phase: ScriptLifecyclePhase;
  readonly deltaTime: number;
  readonly properties: Readonly<Record<string, ScriptJson>>;
  readonly input: ScriptInputSnapshot;
  readonly events: readonly ScriptEvent[];
  state: ScriptJson;
  getComponent(componentTypeId: string): ScriptJson | undefined;
  getEntityComponent(entityId: string, componentTypeId: string): ScriptJson | undefined;
  setComponent(componentTypeId: string, data: ScriptJson): void;
  setEntityComponent(entityId: string, componentTypeId: string, data: ScriptJson): void;
  addComponent(componentTypeId: string, data: ScriptJson): void;
  addEntityComponent(entityId: string, componentTypeId: string, data: ScriptJson): void;
  removeComponent(componentTypeId: string): void;
  removeEntityComponent(entityId: string, componentTypeId: string): void;
  subscribe(eventType: string): void;
  unsubscribe(eventType: string): void;
  emit(eventType: string, payload?: ScriptJson): void;
  finish(): ScriptApiOutput;
}

export interface PropertyValidationIssue {
  readonly path: string;
  readonly message: string;
}

export interface PropertyValidationResult {
  readonly values: Readonly<Record<string, ScriptJson>>;
  readonly issues: readonly PropertyValidationIssue[];
}

export class ScriptApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScriptApiError';
  }
}

const MAX_SCRIPT_JSON_BYTES = 256 * 1024;
const MAX_COMPONENT_COMMANDS = 256;
const MAX_EMITTED_EVENTS = 256;
const MAX_SUBSCRIPTIONS = 256;
const EMPTY_INPUT: ScriptInputSnapshot = Object.freeze({
  actions: Object.freeze({}),
  pointer: Object.freeze({ x: 0, y: 0, inside: false, primary: false, secondary: false }),
  connectedGamepads: Object.freeze([]),
});

/** Stable definition and inspector metadata shared by both script forms. */
export function defineScriptDefinition(input: ScriptDefinition): ScriptDefinition {
  assertIdentifier(input.scriptId, 'scriptId');
  if (!Number.isSafeInteger(input.version) || input.version < 1) throw new RangeError('Script definition version must be a positive safe integer.');
  const properties: Record<string, FieldDefinition> = {};
  for (const [name, definition] of Object.entries(input.properties)) {
    assertIdentifier(name, 'property name');
    if (!definition || typeof definition.label !== 'string' || !definition.label.trim()) throw new TypeError(`Script property "${name}" needs a label.`);
    const defaultIssue = validateProperty(definition, definition.default);
    if (defaultIssue) throw new TypeError(`Default for script property "${name}" is invalid: ${defaultIssue}`);
    properties[name] = deepFreeze(cloneJson(definition, `property schema "${name}"`) as unknown as FieldDefinition);
  }
  return Object.freeze({ scriptId: input.scriptId, version: input.version, properties: Object.freeze(properties) });
}

/** Apply defaults and validate inspector values against a script definition. */
export function validateScriptProperties(definition: ScriptDefinition, input: unknown): PropertyValidationResult {
  const issues: PropertyValidationIssue[] = [];
  if (!isRecord(input)) return { values: Object.freeze({}), issues: [{ path: 'properties', message: 'Expected a property object.' }] };
  for (const key of Object.keys(input)) if (!Object.hasOwn(definition.properties, key)) issues.push({ path: `properties.${key}`, message: 'Unknown property.' });
  const values: Record<string, ScriptJson> = {};
  for (const [key, field] of Object.entries(definition.properties)) {
    const value = Object.hasOwn(input, key) ? input[key] : field.default;
    const issue = validateProperty(field, value);
    if (issue) issues.push({ path: `properties.${key}`, message: issue });
    else values[key] = cloneJson(value, `properties.${key}`) as ScriptJson;
  }
  return { values: deepFreeze(values), issues: Object.freeze(issues) };
}

/**
 * Build the same host-independent API object for a code callback or a node-graph invocation.
 * Returned commands are data; the host validates schemas and applies them after execution.
 */
export function createScriptApi(input: ScriptApiInput): ScriptApi {
  assertIdentifier(input.entityId, 'entityId');
  if (!SCRIPT_LIFECYCLE_PHASES.includes(input.phase)) throw new ScriptApiError(`Unknown lifecycle phase "${String(input.phase)}".`);
  if (!Number.isFinite(input.deltaTime) || input.deltaTime < 0) throw new ScriptApiError('deltaTime must be finite and non-negative.');
  const available = new Set(input.availableComponentTypeIds);
  for (const typeId of available) assertIdentifier(typeId, 'component type ID');
  const currentComponents: Record<string, ScriptJson> = {};
  for (const [typeId, data] of Object.entries(input.components ?? {})) {
    if (!available.has(typeId)) throw new ScriptApiError(`Component "${typeId}" is not available to this script.`);
    currentComponents[typeId] = cloneJson(data, `component "${typeId}"`);
  }
  const entityComponents = new Map<string, Record<string, ScriptJson>>([[input.entityId, currentComponents]]);
  for (const [entityId, components] of Object.entries(input.entityComponents ?? {})) {
    assertIdentifier(entityId, 'entity ID');
    if (entityComponents.has(entityId)) throw new ScriptApiError(`Entity "${entityId}" is duplicated in the component snapshot.`);
    const cloned: Record<string, ScriptJson> = {};
    for (const [typeId, data] of Object.entries(components)) {
      if (!available.has(typeId)) throw new ScriptApiError(`Component "${typeId}" is not available to this script.`);
      cloned[typeId] = cloneJson(data, `entity "${entityId}" component "${typeId}"`);
    }
    entityComponents.set(entityId, cloned);
  }
  const properties = deepFreeze(cloneJson(input.properties ?? {}, 'script properties'));
  const scriptInput = deepFreeze(cloneJson(input.input ?? EMPTY_INPUT, 'script input')) as unknown as ScriptInputSnapshot;
  const events = deepFreeze(cloneJson(input.events ?? [], 'script events') as unknown as readonly ScriptEvent[]);
  if (!Array.isArray(events) || events.length > MAX_EMITTED_EVENTS) throw new ScriptApiError(`A script invocation may receive at most ${MAX_EMITTED_EVENTS} events.`);
  for (const event of events) {
    if (!event || typeof event !== 'object') throw new ScriptApiError('Script events must be objects.');
    assertEventType(event.type);
    cloneJson(event.payload, `event "${event.type}" payload`);
  }
  const subscriptions = new Set(input.subscriptions ?? []);
  if (subscriptions.size > MAX_SUBSCRIPTIONS) throw new ScriptApiError(`A script may have at most ${MAX_SUBSCRIPTIONS} event subscriptions.`);
  for (const eventType of subscriptions) assertEventType(eventType);
  let currentState = cloneJson(input.state ?? null, 'script state');
  const componentCommands: ScriptComponentCommand[] = [];
  const emittedEvents: ScriptEvent[] = [];
  let finished = false;
  const ensureOpen = () => { if (finished) throw new ScriptApiError('This script invocation has already finished.'); };
  const ensureKnownComponent = (componentTypeId: string) => {
    ensureOpen(); assertIdentifier(componentTypeId, 'component type ID');
    if (!available.has(componentTypeId)) throw new ScriptApiError(`Component "${componentTypeId}" is not available to this script.`);
  };
  const entityComponentData = (entityId: string, componentTypeId: string) => {
    ensureOpen(); assertIdentifier(entityId, 'entity ID'); ensureKnownComponent(componentTypeId);
    const target = entityComponents.get(entityId);
    if (!target) throw new ScriptApiError(`Entity "${entityId}" is not available in this script snapshot.`);
    return target;
  };
  const addCommand = (command: ScriptComponentCommand) => {
    ensureOpen();
    if (componentCommands.length >= MAX_COMPONENT_COMMANDS) throw new ScriptApiError(`A script invocation may emit at most ${MAX_COMPONENT_COMMANDS} component commands.`);
    componentCommands.push(command);
  };

  const api: ScriptApi = {
    entityId: input.entityId,
    phase: input.phase,
    deltaTime: input.deltaTime,
    properties,
    input: scriptInput,
    events,
    get state() { ensureOpen(); return currentState; },
    set state(value: ScriptJson) { ensureOpen(); currentState = cloneJson(value, 'script state'); },
    getComponent(componentTypeId) {
      ensureKnownComponent(componentTypeId);
      const value = currentComponents[componentTypeId];
      return value === undefined ? undefined : cloneJson(value, `component "${componentTypeId}"`);
    },
    getEntityComponent(entityId, componentTypeId) {
      const target = entityComponentData(entityId, componentTypeId);
      const value = target[componentTypeId];
      return value === undefined ? undefined : cloneJson(value, `entity "${entityId}" component "${componentTypeId}"`);
    },
    setComponent(componentTypeId, data) {
      ensureKnownComponent(componentTypeId);
      if (!Object.hasOwn(currentComponents, componentTypeId)) throw new ScriptApiError(`Cannot set missing component "${componentTypeId}"; add it first.`);
      const safeData = cloneJson(data, `component "${componentTypeId}"`);
      addCommand({ operation: 'set', entityId: input.entityId, componentTypeId, data: safeData });
      currentComponents[componentTypeId] = cloneJson(safeData, `component "${componentTypeId}"`);
    },
    setEntityComponent(entityId, componentTypeId, data) {
      const target = entityComponentData(entityId, componentTypeId);
      if (!Object.hasOwn(target, componentTypeId)) throw new ScriptApiError(`Cannot set missing component "${componentTypeId}" on entity "${entityId}".`);
      const safeData = cloneJson(data, `entity "${entityId}" component "${componentTypeId}"`);
      addCommand({ operation: 'set', entityId, componentTypeId, data: safeData });
      target[componentTypeId] = cloneJson(safeData, `entity "${entityId}" component "${componentTypeId}"`);
    },
    addComponent(componentTypeId, data) {
      ensureKnownComponent(componentTypeId);
      if (Object.hasOwn(currentComponents, componentTypeId)) throw new ScriptApiError(`Component "${componentTypeId}" already exists; set it instead.`);
      const safeData = cloneJson(data, `component "${componentTypeId}"`);
      addCommand({ operation: 'add', entityId: input.entityId, componentTypeId, data: safeData });
      currentComponents[componentTypeId] = cloneJson(safeData, `component "${componentTypeId}"`);
    },
    addEntityComponent(entityId, componentTypeId, data) {
      const target = entityComponentData(entityId, componentTypeId);
      if (Object.hasOwn(target, componentTypeId)) throw new ScriptApiError(`Component "${componentTypeId}" already exists on entity "${entityId}".`);
      const safeData = cloneJson(data, `entity "${entityId}" component "${componentTypeId}"`);
      addCommand({ operation: 'add', entityId, componentTypeId, data: safeData });
      target[componentTypeId] = cloneJson(safeData, `entity "${entityId}" component "${componentTypeId}"`);
    },
    removeComponent(componentTypeId) {
      ensureKnownComponent(componentTypeId);
      if (!Object.hasOwn(currentComponents, componentTypeId)) return;
      addCommand({ operation: 'remove', entityId: input.entityId, componentTypeId });
      delete currentComponents[componentTypeId];
    },
    removeEntityComponent(entityId, componentTypeId) {
      const target = entityComponentData(entityId, componentTypeId);
      if (!Object.hasOwn(target, componentTypeId)) return;
      addCommand({ operation: 'remove', entityId, componentTypeId });
      delete target[componentTypeId];
    },
    subscribe(eventType) {
      ensureOpen(); assertEventType(eventType);
      if (input.phase === 'destroy') throw new ScriptApiError('A destroying script cannot add event subscriptions.');
      if (!subscriptions.has(eventType) && subscriptions.size >= MAX_SUBSCRIPTIONS) throw new ScriptApiError(`A script may have at most ${MAX_SUBSCRIPTIONS} event subscriptions.`);
      subscriptions.add(eventType);
    },
    unsubscribe(eventType) { ensureOpen(); assertEventType(eventType); subscriptions.delete(eventType); },
    emit(eventType, payload = null) {
      ensureOpen(); assertEventType(eventType);
      if (emittedEvents.length >= MAX_EMITTED_EVENTS) throw new ScriptApiError(`A script invocation may emit at most ${MAX_EMITTED_EVENTS} events.`);
      emittedEvents.push({ type: eventType, payload: cloneJson(payload, `event "${eventType}" payload`) });
    },
    finish() {
      ensureOpen(); finished = true;
      if (input.phase === 'destroy') subscriptions.clear();
      return Object.freeze({
        state: cloneJson(currentState, 'script state'),
        componentCommands: Object.freeze(componentCommands.map(command => cloneJson(command, 'component command'))),
        emittedEvents: Object.freeze(emittedEvents.map(event => cloneJson(event, 'emitted event') as unknown as ScriptEvent)),
        subscriptions: Object.freeze([...subscriptions]),
      });
    },
  };
  return api;
}

function validateProperty(field: FieldDefinition, value: unknown): string | undefined {
  switch (field.type) {
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'Expected a finite number.';
      if (field.min !== undefined && value < field.min) return `Must be at least ${field.min}.`;
      if (field.max !== undefined && value > field.max) return `Must be at most ${field.max}.`;
      return undefined;
    case 'string': return typeof value === 'string' ? undefined : 'Expected a string.';
    case 'color': return typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? undefined : 'Expected a #RRGGBB color.';
    case 'enum': return typeof value === 'string' && field.options.includes(value) ? undefined : `Expected one of: ${field.options.join(', ')}.`;
    case 'boolean': return typeof value === 'boolean' ? undefined : 'Expected a boolean.';
    case 'asset': return value === null || (isRecord(value) && typeof value.assetId === 'string' && Boolean(value.assetId.trim()) && Object.keys(value).every(key => key === 'assetId')) ? undefined : 'Expected null or an asset reference.';
    case 'entity': return value === null || (typeof value === 'string' && Boolean(value.trim())) ? undefined : 'Expected null or a stable entity ID.';
  }
}

function assertIdentifier(value: string, label: string): void {
  if (typeof value !== 'string' || !value.trim() || value.length > 256) throw new ScriptApiError(`${label} must be a non-empty string of at most 256 characters.`);
}

function assertEventType(value: string): void {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9:._/-]{0,127}$/.test(value)) throw new ScriptApiError('Event type must be a stable name of at most 128 characters.');
}

function cloneJson<T>(value: T, label: string): T {
  let serialized: string | undefined;
  try { serialized = JSON.stringify(value); }
  catch (error) { throw new ScriptApiError(`${label} must be JSON serializable: ${String(error)}`); }
  if (serialized === undefined) throw new ScriptApiError(`${label} must be JSON serializable.`);
  if (new TextEncoder().encode(serialized).byteLength > MAX_SCRIPT_JSON_BYTES) throw new ScriptApiError(`${label} exceeds ${MAX_SCRIPT_JSON_BYTES} bytes.`);
  return JSON.parse(serialized) as T;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
