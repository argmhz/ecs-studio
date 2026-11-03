import { graphPorts, validateVisualGraph } from '@ecs/scripting';
import type { GraphValueType, VisualGraph, VisualGraphNode, VisualGraphLink } from '../../../packages/scripting/src/visual-graph.ts';

const titles: Record<VisualGraphNode['kind'], string> = {
  'event.start': 'On Update (legacy)', 'event.onStart': 'On Start', 'event.onUpdate': 'On Update', 'event.onEvent': 'On Event', 'value.number': 'Number', 'value.json': 'JSON Value', 'variable.get': 'Get Variable',
  'variable.set': 'Set Variable', 'compare.greater': 'Greater Than', 'flow.branch': 'Branch', 'flow.repeat': 'Repeat', 'flow.loop.end': 'Loop End', 'component.read': 'Read Component',
  'component.write': 'Write Component', 'event.received': 'Event Received?', 'event.payload': 'Event Payload', 'event.emit': 'Emit Event', 'event.subscribe': 'Subscribe Event', 'input.action': 'Input Action', 'flow.end': 'End',
};
const descriptions: Record<VisualGraphNode['kind'], string> = {
  'event.start': 'Legacy entrypoint. Runs once per frame in existing projects.',
  'event.onStart': 'Runs once when Play starts. Register event listeners here.',
  'event.onUpdate': 'Runs once each frame while playing.',
  'event.onEvent': 'Runs only when the selected event arrives.',
  'value.number': 'Provides a fixed number to a number input.',
  'value.json': 'Provides structured data to a data input.',
  'variable.get': 'Reads a saved number from this graph run.',
  'variable.set': 'Stores a number, then continues the flow.',
  'compare.greater': 'Checks whether the first number is greater.',
  'flow.branch': 'Continues through True or False based on a condition.',
  'flow.repeat': 'Runs the Body flow a set number of times.',
  'flow.loop.end': 'Returns to Repeat for the next iteration.',
  'component.read': 'Reads the selected component from this entity.',
  'component.write': 'Writes component data, then continues the flow.',
  'event.received': 'Legacy check: true when this event arrived during this update.',
  'event.payload': 'Reads this event’s payload in an On Event flow or matching update.',
  'event.emit': 'Sends an event; other scripts receive it next update.',
  'event.subscribe': 'Registers interest in an event. Flow continues immediately.',
  'input.action': 'Reads the current value and button state of an action.',
  'flow.end': 'Stops this graph run.',
};
const portTypeLabels: Record<GraphValueType, string> = { exec: 'flow', number: 'number', boolean: 'true / false', string: 'text', json: 'data' };

/** A small DOM-based visual graph canvas; graph data stays serializable and engine-independent. */
export function createVisualGraphEditor(host: HTMLElement, initial: VisualGraph, onChange: (graph: VisualGraph) => void) {
  let graph = structuredClone(initial);
  const undoStack: VisualGraph[] = []; const redoStack: VisualGraph[] = [];
  const toolbar = document.createElement('div'); toolbar.className = 'graph-toolbar';
  const triggerLabel = document.createElement('label'); triggerLabel.className = 'graph-trigger-label'; triggerLabel.textContent = 'Choose node';
  const addSelect = document.createElement('select'); addSelect.setAttribute('aria-label', 'Node type');
  for (const [label, kinds] of [
    ['Events', ['event.onStart', 'event.onUpdate', 'event.onEvent', 'event.received', 'event.payload', 'event.emit', 'event.subscribe']],
    ['Flow', ['flow.branch', 'flow.repeat', 'flow.loop.end', 'flow.end']],
    ['Values', ['value.number', 'value.json', 'variable.get', 'variable.set', 'compare.greater']],
    ['Entity and input', ['component.read', 'component.write', 'input.action']],
  ] as const) {
    const group = document.createElement('optgroup'); group.label = label;
    for (const kind of kinds) { const option = document.createElement('option'); option.value = kind; option.textContent = titles[kind]; group.append(option); }
    addSelect.append(group);
  }
  triggerLabel.append(addSelect);
  const addButton = document.createElement('button'); addButton.textContent = '＋ Add Node';
  const undoButton = document.createElement('button'); undoButton.textContent = '↶ Undo';
  const redoButton = document.createElement('button'); redoButton.textContent = '↷ Redo';
  const status = document.createElement('span'); status.className = 'graph-status'; status.setAttribute('role', 'status');
  status.textContent = 'Connect matching ports · Click a wire to remove it.';
  status.title = 'Purple ports and wires carry execution flow. Colored ports and wires carry typed values: number, true / false, text, or data. Click an output, then a matching input.';
  const legend = document.createElement('span'); legend.className = 'graph-wire-legend'; legend.innerHTML = '<span><i class="graph-legend-flow"></i> Flow</span><span><i class="graph-legend-values"></i> Values are type-colored</span>';
  toolbar.append(triggerLabel, addButton, undoButton, redoButton, legend, status);
  const canvas = document.createElement('div'); canvas.className = 'graph-canvas'; canvas.setAttribute('aria-label', 'Visual script graph');
  const wires = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); wires.classList.add('graph-wires'); wires.setAttribute('aria-hidden', 'true');
  canvas.append(wires); host.replaceChildren(toolbar, canvas);
  let pendingOutput: { nodeId: string; portId: string; type: GraphValueType } | undefined;
  let wireFrame: number | undefined;
  const drawWires = () => {
    wires.replaceChildren();
    for (const link of graph.links) {
      const fromNode = canvas.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(link.from.nodeId)}"]`); const toNode = canvas.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(link.to.nodeId)}"]`);
      if (!fromNode || !toNode) continue;
      const from = fromNode.querySelector<HTMLElement>(`.graph-port-output [data-port="${CSS.escape(link.from.portId)}"]`); const to = toNode.querySelector<HTMLElement>(`.graph-port-column [data-port="${CSS.escape(link.to.portId)}"]`);
      if (!from || !to) continue;
      const a = from.getBoundingClientRect(); const b = to.getBoundingClientRect(); const c = canvas.getBoundingClientRect();
      const x1 = a.left + a.width / 2 - c.left + canvas.scrollLeft; const y1 = a.top + a.height / 2 - c.top + canvas.scrollTop;
      const x2 = b.left + b.width / 2 - c.left + canvas.scrollLeft; const y2 = b.top + b.height / 2 - c.top + canvas.scrollTop;
      const bend = Math.max(40, Math.abs(x2 - x1) * .45); const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`);
      const source = graph.nodes.find(node => node.id === link.from.nodeId)!; const port = graphPorts(source.kind).outputs.find(item => item.id === link.from.portId)!;
      path.classList.add('graph-link', `graph-link-${port.type}`); path.setAttribute('aria-label', `Remove ${port.type} connection`);
      path.addEventListener('click', () => { update({ ...graph, links: graph.links.filter(item => item.id !== link.id) }); status.textContent = 'Connection removed.'; });
      wires.append(path);
    }
  };
  const scheduleWireRender = () => {
    if (wireFrame !== undefined) cancelAnimationFrame(wireFrame);
    wireFrame = requestAnimationFrame(() => { wireFrame = undefined; drawWires(); });
  };
  const connectPorts = (from: { nodeId: string; portId: string }, to: { nodeId: string; portId: string }) => {
    const link: VisualGraphLink = { id: crypto.randomUUID(), from, to };
    try {
      const next = { ...graph, links: [...graph.links, link] };
      validateVisualGraph(next); pendingOutput = undefined; update(next); status.textContent = 'Connection added.';
    } catch (error) { status.textContent = error instanceof Error ? error.message : String(error); }
  };
  const update = (next: VisualGraph, record = true) => {
    if (record) { undoStack.push(structuredClone(graph)); if (undoStack.length > 100) undoStack.shift(); redoStack.length = 0; }
    pendingOutput = undefined; graph = structuredClone(next); onChange(structuredClone(graph)); render();
  };
  const render = () => {
    canvas.querySelectorAll('.graph-node').forEach(node => node.remove()); wires.replaceChildren();
    for (const node of graph.nodes) {
      const definition = graphPorts(node.kind);
      const card = document.createElement('article'); card.className = `graph-node graph-node-${node.kind.replaceAll('.', '-')}`; card.dataset.nodeId = node.id; card.style.left = `${node.x}px`; card.style.top = `${node.y}px`;
      const header = document.createElement('header'); header.className = 'graph-node-title';
      const heading = document.createElement('strong'); heading.textContent = titles[node.kind]; header.append(heading);
      const close = document.createElement('button'); close.className = 'graph-node-delete'; close.textContent = '×'; close.setAttribute('aria-label', `Delete ${titles[node.kind]}`); close.onclick = () => update({ ...graph, nodes: graph.nodes.filter(item => item.id !== node.id), links: graph.links.filter(link => link.from.nodeId !== node.id && link.to.nodeId !== node.id) }); header.append(close);
      card.append(header);
      const description = document.createElement('p'); description.className = 'graph-node-description'; description.textContent = descriptions[node.kind]; card.append(description);
      const ports = document.createElement('div'); ports.className = 'graph-node-ports';
      const inputs = document.createElement('div'); inputs.className = 'graph-port-column';
      for (const port of definition.inputs) {
        const row = document.createElement('button'); row.type = 'button'; row.className = `graph-port graph-port-${port.type}`; row.dataset.port = port.id;
        const inputLabel = document.createElement('span'); inputLabel.textContent = port.id; const inputType = document.createElement('small'); inputType.textContent = portTypeLabels[port.type]; row.append(inputLabel, inputType);
        row.setAttribute('aria-label', `${portTypeLabels[port.type]} input ${port.id} on ${titles[node.kind]}`); row.title = pendingOutput ? `Connect ${portTypeLabels[pendingOutput.type]} output to this ${portTypeLabels[port.type]} input` : `${portTypeLabels[port.type]} input: ${port.id}`;
        if (pendingOutput && pendingOutput.type === port.type) row.classList.add('graph-port-compatible');
        row.onclick = () => {
          if (!pendingOutput) { status.textContent = 'Choose an output port first.'; return; }
          connectPorts({ nodeId: pendingOutput.nodeId, portId: pendingOutput.portId }, { nodeId: node.id, portId: port.id });
        };
        inputs.append(row);
      }
      const outputs = document.createElement('div'); outputs.className = 'graph-port-column graph-port-output';
      for (const port of definition.outputs) {
        const row = document.createElement('button'); row.type = 'button'; row.className = `graph-port graph-port-${port.type}`; row.dataset.port = port.id;
        const outputLabel = document.createElement('span'); outputLabel.textContent = port.id; const outputType = document.createElement('small'); outputType.textContent = portTypeLabels[port.type]; row.append(outputType, outputLabel);
        row.setAttribute('aria-label', `${portTypeLabels[port.type]} output ${port.id} on ${titles[node.kind]}`); row.title = `${portTypeLabels[port.type]} output: ${port.id}`;
        row.onclick = () => {
          if (pendingOutput?.nodeId === node.id && pendingOutput.portId === port.id) { pendingOutput = undefined; status.textContent = 'Connection cancelled.'; render(); return; }
          pendingOutput = { nodeId: node.id, portId: port.id, type: port.type };
          status.textContent = `${titles[node.kind]} · ${port.id} selected. Choose a ${portTypeLabels[port.type]} input.`;
          canvas.querySelectorAll('.graph-port-output .graph-port').forEach(item => item.classList.remove('graph-port-selected'));
          row.classList.add('graph-port-selected');
          canvas.querySelectorAll('.graph-port-column:not(.graph-port-output) .graph-port').forEach(item => item.classList.toggle('graph-port-compatible', item.classList.contains(`graph-port-${port.type}`)));
        };
        outputs.append(row);
      }
      ports.append(inputs, outputs); card.append(ports);
      if (node.kind === 'value.number') {
        const input = document.createElement('input'); input.type = 'number'; input.value = String(node.data.value ?? 0); input.setAttribute('aria-label', 'Number value'); input.onchange = () => update({ ...graph, nodes: graph.nodes.map(item => item.id === node.id ? { ...item, data: { ...item.data, value: Number(input.value) } } : item) }); card.append(input);
      }
      if (node.kind === 'value.json') {
        const input = document.createElement('textarea'); input.value = String(node.data.value ?? '{"value": 1}'); input.setAttribute('aria-label', 'JSON value'); input.onchange = () => update({ ...graph, nodes: graph.nodes.map(item => item.id === node.id ? { ...item, data: { ...item.data, value: input.value } } : item) }); card.append(input);
      }
      if (node.kind === 'variable.get' || node.kind === 'variable.set') {
        const input = document.createElement('input'); input.value = String(node.data.name ?? 'value'); input.setAttribute('aria-label', 'Variable name'); input.onchange = () => update({ ...graph, nodes: graph.nodes.map(item => item.id === node.id ? { ...item, data: { ...item.data, name: input.value.trim() || 'value' } } : item) }); card.append(input);
      }
      if (node.kind === 'component.read' || node.kind === 'component.write') {
        const input = document.createElement('input'); input.value = String(node.data.componentTypeId ?? 'engine.transform2d'); input.setAttribute('aria-label', 'Component type ID'); input.onchange = () => update({ ...graph, nodes: graph.nodes.map(item => item.id === node.id ? { ...item, data: { ...item.data, componentTypeId: input.value.trim() } } : item) }); card.append(input);
      }
      if (node.kind === 'event.emit' || node.kind === 'event.subscribe' || node.kind === 'event.onEvent') {
        const input = document.createElement('input'); input.value = String(node.data.eventType ?? 'game.started'); input.setAttribute('aria-label', 'Event type'); input.onchange = () => update({ ...graph, nodes: graph.nodes.map(item => item.id === node.id ? { ...item, data: { ...item.data, eventType: input.value.trim() } } : item) }); card.append(input);
      }
      if (node.kind === 'input.action') {
        const input = document.createElement('input'); input.value = String(node.data.action ?? 'jump'); input.setAttribute('aria-label', 'Input action'); input.onchange = () => update({ ...graph, nodes: graph.nodes.map(item => item.id === node.id ? { ...item, data: { ...item.data, action: input.value.trim() } } : item) }); card.append(input);
      }
      header.onpointerdown = event => {
        if ((event.target as HTMLElement).closest('button')) return;
        event.preventDefault(); const startX = event.clientX; const startY = event.clientY; const originX = node.x; const originY = node.y; header.setPointerCapture(event.pointerId);
        const move = (moveEvent: PointerEvent) => { card.style.left = `${Math.max(0, originX + moveEvent.clientX - startX)}px`; card.style.top = `${Math.max(0, originY + moveEvent.clientY - startY)}px`; scheduleWireRender(); };
        const up = (upEvent: PointerEvent) => { header.removeEventListener('pointermove', move); header.removeEventListener('pointerup', up); const x = Math.max(0, originX + upEvent.clientX - startX); const y = Math.max(0, originY + upEvent.clientY - startY); if (x !== originX || y !== originY) update({ ...graph, nodes: graph.nodes.map(item => item.id === node.id ? { ...item, x, y } : item) }); };
        header.addEventListener('pointermove', move); header.addEventListener('pointerup', up, { once: true });
      };
      canvas.append(card);
    }
    const nodeCards = [...canvas.querySelectorAll<HTMLElement>('.graph-node')];
    const contentWidth = Math.max(canvas.clientWidth, ...nodeCards.map(card => card.offsetLeft + card.offsetWidth + 80), 1600);
    const contentHeight = Math.max(canvas.clientHeight, ...nodeCards.map(card => card.offsetTop + card.offsetHeight + 80), 1100);
    wires.style.width = `${contentWidth}px`; wires.style.height = `${contentHeight}px`;
    scheduleWireRender();
    undoButton.disabled = !undoStack.length; redoButton.disabled = !redoStack.length;
  };
  addButton.onclick = () => { const kind = addSelect.value as VisualGraphNode['kind']; const data = kind === 'value.number' ? { value: 1 } : kind === 'value.json' ? { value: '{"value": 1}' } : kind.startsWith('variable.') ? { name: 'score' } : kind.startsWith('component.') ? { componentTypeId: 'engine.transform2d' } : kind.startsWith('event.') ? { eventType: 'game.started' } : kind === 'input.action' ? { action: 'jump' } : {}; const node: VisualGraphNode = { id: crypto.randomUUID(), kind, x: 35 + graph.nodes.length % 4 * 230, y: 40 + Math.floor(graph.nodes.length / 4) * 210, data }; update({ ...graph, nodes: [...graph.nodes, node] }); };
  undoButton.onclick = () => { const previous = undoStack.pop(); if (!previous) return; redoStack.push(structuredClone(graph)); update(previous, false); };
  redoButton.onclick = () => { const next = redoStack.pop(); if (!next) return; undoStack.push(structuredClone(graph)); update(next, false); };
  render();
  return { getGraph: () => structuredClone(graph), setGraph(next: VisualGraph) { graph = structuredClone(next); undoStack.length = 0; redoStack.length = 0; render(); }, refresh: render, dispose: () => { if (wireFrame !== undefined) cancelAnimationFrame(wireFrame); host.replaceChildren(); } };
}
