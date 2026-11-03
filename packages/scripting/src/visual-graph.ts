import { createScriptApi, type ScriptApi, type ScriptJson } from './api.ts';

/** Serializable, editor-independent graph primitives shared by the visual editor and runtime. */
export type GraphValueType = 'exec' | 'number' | 'boolean' | 'string' | 'json';
export interface GraphPort { readonly id: string; readonly type: GraphValueType; }
export interface VisualGraphNode {
  readonly id: string;
  readonly kind: 'event.start' | 'event.onStart' | 'event.onUpdate' | 'event.onEvent' | 'value.number' | 'value.json' | 'variable.get' | 'variable.set' | 'compare.greater' | 'flow.branch' | 'flow.repeat' | 'flow.loop.end' | 'component.read' | 'component.write' | 'event.received' | 'event.payload' | 'event.emit' | 'event.subscribe' | 'input.action' | 'flow.end';
  readonly x: number;
  readonly y: number;
  readonly data: Readonly<Record<string, unknown>>;
}
export interface VisualGraphLink { readonly id: string; readonly from: { readonly nodeId: string; readonly portId: string }; readonly to: { readonly nodeId: string; readonly portId: string }; }
export interface VisualGraph { readonly version: 1; readonly nodes: readonly VisualGraphNode[]; readonly links: readonly VisualGraphLink[]; }
interface NodeDefinition { inputs: readonly GraphPort[]; outputs: readonly GraphPort[]; }
const definitions: Record<VisualGraphNode['kind'], NodeDefinition> = {
  'event.start': { inputs: [], outputs: [{ id: 'then', type: 'exec' }] },
  'event.onStart': { inputs: [], outputs: [{ id: 'then', type: 'exec' }] },
  'event.onUpdate': { inputs: [], outputs: [{ id: 'then', type: 'exec' }] },
  'event.onEvent': { inputs: [], outputs: [{ id: 'then', type: 'exec' }] },
  'value.number': { inputs: [], outputs: [{ id: 'value', type: 'number' }] },
  'value.json': { inputs: [], outputs: [{ id: 'value', type: 'json' }] },
  'variable.get': { inputs: [], outputs: [{ id: 'value', type: 'number' }] },
  'variable.set': { inputs: [{ id: 'exec', type: 'exec' }, { id: 'value', type: 'number' }], outputs: [{ id: 'then', type: 'exec' }] },
  'compare.greater': { inputs: [{ id: 'a', type: 'number' }, { id: 'b', type: 'number' }], outputs: [{ id: 'value', type: 'boolean' }] },
  'flow.branch': { inputs: [{ id: 'exec', type: 'exec' }, { id: 'condition', type: 'boolean' }], outputs: [{ id: 'true', type: 'exec' }, { id: 'false', type: 'exec' }] },
  'flow.repeat': { inputs: [{ id: 'exec', type: 'exec' }, { id: 'count', type: 'number' }], outputs: [{ id: 'body', type: 'exec' }, { id: 'done', type: 'exec' }] },
  'flow.loop.end': { inputs: [{ id: 'exec', type: 'exec' }], outputs: [] },
  'component.read': { inputs: [], outputs: [{ id: 'value', type: 'json' }] },
  'component.write': { inputs: [{ id: 'exec', type: 'exec' }, { id: 'value', type: 'json' }], outputs: [{ id: 'then', type: 'exec' }] },
  'event.received': { inputs: [], outputs: [{ id: 'value', type: 'boolean' }] },
  'event.payload': { inputs: [], outputs: [{ id: 'value', type: 'json' }] },
  'event.emit': { inputs: [{ id: 'exec', type: 'exec' }, { id: 'payload', type: 'json' }], outputs: [{ id: 'then', type: 'exec' }] },
  'event.subscribe': { inputs: [{ id: 'exec', type: 'exec' }], outputs: [{ id: 'then', type: 'exec' }] },
  'input.action': { inputs: [], outputs: [{ id: 'value', type: 'json' }] },
  'flow.end': { inputs: [{ id: 'exec', type: 'exec' }], outputs: [] },
};
export const VISUAL_NODE_KINDS = Object.freeze(Object.keys(definitions) as VisualGraphNode['kind'][]);
export function graphPorts(kind: VisualGraphNode['kind']) { return definitions[kind]; }

/** Validate endpoints and exact port types before accepting a connection. */
export function validateVisualGraph(graph: VisualGraph): void {
  if (!graph || graph.version !== 1 || !Array.isArray(graph.nodes) || !Array.isArray(graph.links)) throw new TypeError('Unsupported or invalid visual graph.');
  const nodes = new Map<string, VisualGraphNode>();
  for (const node of graph.nodes) {
    if (!node || typeof node.id !== 'string' || !node.id || nodes.has(node.id) || !Object.hasOwn(definitions, node.kind)) throw new TypeError('Graph nodes need unique IDs and known kinds.');
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y) || !node.data || typeof node.data !== 'object' || Array.isArray(node.data)) throw new TypeError(`Graph node "${node.id}" has invalid layout or data.`);
    nodes.set(node.id, node);
  }
  const links = new Set<string>();
  const occupiedInputs = new Set<string>();
  for (const link of graph.links) {
    if (!link || typeof link.id !== 'string' || !link.id || links.has(link.id)) throw new TypeError('Graph links need unique IDs.');
    links.add(link.id);
    const from = nodes.get(link.from?.nodeId); const to = nodes.get(link.to?.nodeId);
    if (!from || !to) throw new TypeError(`Link "${link.id}" references a missing node.`);
    const output = definitions[from.kind].outputs.find(port => port.id === link.from.portId);
    const input = definitions[to.kind].inputs.find(port => port.id === link.to.portId);
    if (!output || !input) throw new TypeError(`Link "${link.id}" references a missing port.`);
    if (output.type !== input.type) throw new TypeError(`Cannot connect ${output.type} to ${input.type}.`);
    const inputKey = `${to.id}:${input.id}`;
    if (occupiedInputs.has(inputKey)) throw new TypeError(`Input "${inputKey}" already has a connection.`);
    occupiedInputs.add(inputKey);
  }
}

/** Bounded declarative execution for the first built-in visual node set. */
export function evaluateVisualGraph(graph: VisualGraph, { maxNodeVisits = 10_000, signal, api, entryNodeId }: { maxNodeVisits?: number; signal?: AbortSignal; api?: ScriptApi; entryNodeId?: string } = {}) {
  validateVisualGraph(graph);
  const scriptApi = api ?? createScriptApi({ entityId: 'graph:preview', phase: 'update', deltaTime: 0, availableComponentTypeIds: [...new Set(graph.nodes.map(node => node.data.componentTypeId).filter((id): id is string => typeof id === 'string'))] });
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  const sourceByInput = new Map(graph.links.map(link => [`${link.to.nodeId}:${link.to.portId}`, link.from]));
  const outputCache = new Map<string, number | boolean | ScriptJson>();
  const state = scriptApi.state;
  const variables: Record<string, number> = Object.assign(Object.create(null) as Record<string, number>, state && typeof state === 'object' && !Array.isArray(state) ? state as Record<string, number> : {});
  const entry = entryNodeId ? byId.get(entryNodeId) : graph.nodes.find(node => node.kind === 'event.onUpdate' || node.kind === 'event.start');
  const visits: string[] = []; let current = entry;
  if (entry?.kind === 'event.onEvent' && !scriptApi.events.some(event => event.type === String(entry.data.eventType ?? ''))) current = undefined;
  const loops: { readonly body: VisualGraphNode; readonly done?: VisualGraphNode; remaining: number }[] = [];
  const inputValue = (node: VisualGraphNode, portId: string, fallback?: number | boolean | ScriptJson): number | boolean | ScriptJson => {
    const source = sourceByInput.get(`${node.id}:${portId}`); if (!source) { if (fallback !== undefined) return fallback; throw new Error(`Input "${portId}" on "${node.id}" is not connected.`); }
    const sourceNode = byId.get(source.nodeId)!;
    return value(sourceNode, source.portId);
  };
  const value = (node: VisualGraphNode, portId: string): number | boolean | ScriptJson => {
    const key = `${node.id}:${portId}`; if (outputCache.has(key)) return outputCache.get(key)!;
    let result: number | boolean | ScriptJson;
    if (node.kind === 'value.number') result = Number(node.data.value ?? 0);
    else if (node.kind === 'value.json') {
      try { result = JSON.parse(String(node.data.value ?? 'null')) as ScriptJson; }
      catch { throw new Error(`JSON value on node "${node.id}" is invalid.`); }
    }
    else if (node.kind === 'variable.get') {
      result = variables[String(node.data.name ?? 'value')] ?? 0;
      if (typeof result !== 'number' || !Number.isFinite(result)) throw new Error(`Variable "${String(node.data.name ?? 'value')}" is not a finite number.`);
    }
    else if (node.kind === 'compare.greater') result = Number(inputValue(node, 'a', 0)) > Number(inputValue(node, 'b', 0));
    else if (node.kind === 'component.read') result = scriptApi.getComponent(String(node.data.componentTypeId ?? '')) ?? null;
    else if (node.kind === 'event.received') result = scriptApi.events.some(event => event.type === String(node.data.eventType ?? ''));
    else if (node.kind === 'event.payload') result = scriptApi.events.find(event => event.type === String(node.data.eventType ?? ''))?.payload ?? null;
    else if (node.kind === 'input.action') result = scriptApi.input.actions[String(node.data.action ?? '')] ?? { value: 0, pressed: false, justPressed: false, justReleased: false };
    else throw new Error(`Node "${node.id}" has no data output.`);
    if (typeof result === 'number' && !Number.isFinite(result)) throw new Error(`Node "${node.id}" produced a non-finite number.`);
    outputCache.set(key, result); return result;
  };
  const next = (node: VisualGraphNode, portId: string) => { const link = graph.links.find(item => item.from.nodeId === node.id && item.from.portId === portId); return link ? byId.get(link.to.nodeId) : undefined; };
  while (current) {
    if (signal?.aborted) throw new Error('Visual graph execution cancelled.');
    if (visits.length >= maxNodeVisits) throw new Error(`Visual graph exceeded its ${maxNodeVisits} node visit budget.`);
    visits.push(current.id);
    if (current.kind === 'event.start' || current.kind === 'event.onStart' || current.kind === 'event.onUpdate' || current.kind === 'event.onEvent') current = next(current, 'then');
    else if (current.kind === 'variable.set') {
      variables[String(current.data.name ?? 'value')] = Number(inputValue(current, 'value', 0)); outputCache.clear(); current = next(current, 'then');
    } else if (current.kind === 'component.write') {
      const typeId = String(current.data.componentTypeId ?? '');
      if (scriptApi.getComponent(typeId) === undefined) throw new Error(`Cannot set missing component "${typeId}".`);
      scriptApi.setComponent(typeId, inputValue(current, 'value', null) as ScriptJson); outputCache.clear(); current = next(current, 'then');
    } else if (current.kind === 'event.emit') {
      scriptApi.emit(String(current.data.eventType ?? ''), inputValue(current, 'payload', null) as ScriptJson); current = next(current, 'then');
    } else if (current.kind === 'event.subscribe') {
      scriptApi.subscribe(String(current.data.eventType ?? '')); current = next(current, 'then');
    } else if (current.kind === 'flow.repeat') {
      const count = Number(inputValue(current, 'count', 0));
      if (!Number.isSafeInteger(count) || count < 0 || count > 1000) throw new RangeError('Repeat count must be an integer between 0 and 1000.');
      const body = next(current, 'body'); const done = next(current, 'done');
      if (count > 0 && body) { loops.push({ body, done, remaining: count }); current = body; } else current = done;
    } else if (current.kind === 'flow.loop.end') {
      const loop = loops.at(-1); if (!loop) throw new Error('Loop End was reached outside a Repeat node.');
      loop.remaining--;
      if (loop.remaining > 0) current = loop.body;
      else { loops.pop(); current = loop.done; }
    } else if (current.kind === 'flow.branch') current = next(current, inputValue(current, 'condition', false) ? 'true' : 'false');
    else if (current.kind === 'flow.end') current = undefined;
    else throw new Error(`Data node "${current.id}" cannot be used as an execution node.`);
  }
  scriptApi.state = variables;
  return { variables: Object.freeze({ ...variables }), visitedNodeIds: Object.freeze(visits), output: scriptApi.finish() };
}
