import type { VisualGraph } from '@ecs/scripting';

/** Registers once at Play start, then forwards each point event as the score event. */
export const pongScoreGraph: VisualGraph = {
  version: 1,
  nodes: [
    { id: 'start', kind: 'event.onStart', x: 40, y: 80, data: {} },
    { id: 'listen', kind: 'event.subscribe', x: 280, y: 80, data: { eventType: 'pong.point' } },
    { id: 'on-point', kind: 'event.onEvent', x: 280, y: 250, data: { eventType: 'pong.point' } },
    { id: 'payload', kind: 'event.payload', x: 280, y: 230, data: { eventType: 'pong.point' } },
    { id: 'forward', kind: 'event.emit', x: 570, y: 80, data: { eventType: 'pong.scored' } },
    { id: 'end', kind: 'flow.end', x: 850, y: 80, data: {} },
    { id: 'event-end', kind: 'flow.end', x: 850, y: 250, data: {} },
  ],
  links: [
    { id: 'flow-1', from: { nodeId: 'start', portId: 'then' }, to: { nodeId: 'listen', portId: 'exec' } },
    { id: 'flow-2', from: { nodeId: 'listen', portId: 'then' }, to: { nodeId: 'end', portId: 'exec' } },
    { id: 'flow-event', from: { nodeId: 'on-point', portId: 'then' }, to: { nodeId: 'forward', portId: 'exec' } },
    { id: 'data-1', from: { nodeId: 'payload', portId: 'value' }, to: { nodeId: 'forward', portId: 'payload' } },
    { id: 'flow-3', from: { nodeId: 'forward', portId: 'then' }, to: { nodeId: 'event-end', portId: 'exec' } },
  ],
};
