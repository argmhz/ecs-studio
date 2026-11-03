/** Build a worker function body with the shared, JSON-only code-script contract. */
/** @param {string} compiledSource */
export function createCodeScriptSource(compiledSource) {
  return `
let state = structuredClone(input.state ?? null);
const components = structuredClone(input.components ?? {});
const entities = structuredClone(input.entityComponents ?? {});
entities[input.entityId] = components;
const available = new Set(input.availableComponentTypeIds);
const componentCommands = [];
const emittedEvents = [];
const subscriptions = new Set(input.subscriptions ?? []);
const listeners = globalThis.__ecsScriptListeners ?? (globalThis.__ecsScriptListeners = new Map());
const checkType = type => { if (!available.has(type)) throw new Error('Unknown component type: ' + type); };
const targetComponents = (entityId, type) => { if (typeof entityId !== 'string' || !Object.hasOwn(entities, entityId)) throw new Error('Entity is not available in this script snapshot: ' + entityId); checkType(type); return entities[entityId]; };
const checkEvent = type => { if (typeof type !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9:._/-]{0,127}$/.test(type)) throw new Error('Invalid event type.'); };
const addCommand = command => { if (componentCommands.length >= 256) throw new Error('Script command limit exceeded.'); componentCommands.push(command); };
const api = {
  entityId: input.entityId, phase: input.phase, deltaTime: input.deltaTime,
  properties: Object.freeze(structuredClone(input.properties ?? {})),
  input: Object.freeze(structuredClone(input.input ?? { actions: {}, pointer: { x: 0, y: 0, inside: false, primary: false, secondary: false }, connectedGamepads: [] })),
  events: Object.freeze(structuredClone(input.events ?? [])),
  get state() { return state; }, set state(value) { state = structuredClone(value); },
  getComponent(type) { checkType(type); return components[type] === undefined ? undefined : structuredClone(components[type]); },
  getEntityComponent(entityId, type) { const target = targetComponents(entityId, type); return target[type] === undefined ? undefined : structuredClone(target[type]); },
  setComponent(type, data) { checkType(type); if (!Object.hasOwn(components, type)) throw new Error('Cannot set missing component: ' + type); const safe = structuredClone(data); addCommand({ operation: 'set', entityId: input.entityId, componentTypeId: type, data: safe }); components[type] = safe; },
  setEntityComponent(entityId, type, data) { const target = targetComponents(entityId, type); if (!Object.hasOwn(target, type)) throw new Error('Cannot set missing component: ' + type); const safe = structuredClone(data); addCommand({ operation: 'set', entityId, componentTypeId: type, data: safe }); target[type] = safe; },
  addComponent(type, data) { checkType(type); if (Object.hasOwn(components, type)) throw new Error('Component already exists: ' + type); const safe = structuredClone(data); addCommand({ operation: 'add', entityId: input.entityId, componentTypeId: type, data: safe }); components[type] = safe; },
  addEntityComponent(entityId, type, data) { const target = targetComponents(entityId, type); if (Object.hasOwn(target, type)) throw new Error('Component already exists: ' + type); const safe = structuredClone(data); addCommand({ operation: 'add', entityId, componentTypeId: type, data: safe }); target[type] = safe; },
  removeComponent(type) { checkType(type); if (!Object.hasOwn(components, type)) return; addCommand({ operation: 'remove', entityId: input.entityId, componentTypeId: type }); delete components[type]; },
  removeEntityComponent(entityId, type) { const target = targetComponents(entityId, type); if (!Object.hasOwn(target, type)) return; addCommand({ operation: 'remove', entityId, componentTypeId: type }); delete target[type]; },
  subscribe(type) { checkEvent(type); if (input.phase === 'destroy') throw new Error('A destroying script cannot subscribe.'); if (!subscriptions.has(type) && subscriptions.size >= 256) throw new Error('Script subscription limit exceeded.'); subscriptions.add(type); },
  unsubscribe(type) { checkEvent(type); subscriptions.delete(type); },
  on(type, callback) { checkEvent(type); if (typeof callback !== 'function') throw new TypeError('Event listener must be a function.'); if (input.phase === 'destroy') throw new Error('A destroying script cannot register listeners.'); let bucket = listeners.get(type); if (!bucket) listeners.set(type, bucket = new Set()); if (!bucket.has(callback) && bucket.size >= 256) throw new Error('Script listener limit exceeded.'); bucket.add(callback); subscriptions.add(type); },
  off(type, callback) { checkEvent(type); listeners.get(type)?.delete(callback); if (!listeners.get(type)?.size) { listeners.delete(type); subscriptions.delete(type); } },
  emit(type, payload = null) { checkEvent(type); if (emittedEvents.length >= 256) throw new Error('Script event limit exceeded.'); emittedEvents.push({ type, payload: structuredClone(payload) }); },
};
${compiledSource}
const run = async () => {
  if (input.phase === 'event') {
    for (const event of input.events ?? []) for (const listener of [...(listeners.get(event.type) ?? [])]) await listener(structuredClone(event), api);
  } else {
    const lifecycle = input.phase === 'start' ? (typeof onStart === 'function' ? onStart : undefined) : input.phase === 'destroy' ? (typeof onStop === 'function' ? onStop : undefined) : (typeof onUpdate === 'function' ? onUpdate : undefined);
    const legacy = typeof update === 'function' ? update : undefined;
    const callback = lifecycle ?? (input.phase === 'update' ? legacy : undefined);
    if (typeof callback === 'function') await callback(api);
    else if (input.phase === 'update' && typeof onStart !== 'function' && typeof onStop !== 'function') throw new Error('Script must declare onUpdate(api) or update(api).');
  }
};
return Promise.resolve(run()).then(() => ({ state: api.state, componentCommands, emittedEvents, subscriptions: [...subscriptions] }));
//# sourceURL=ecs://scripts/player.ts
`;
}

// new Function and Monaco's TypeScript emit add wrapper lines before player.ts.
export const CODE_SCRIPT_ERROR_LINE_OFFSET = 37;
