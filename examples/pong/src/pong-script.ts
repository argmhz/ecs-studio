import { createScriptApi, evaluateVisualGraph, type ScriptApi, type ScriptEvent, type ScriptInputSnapshot, type ScriptJson } from '@ecs/scripting';
import { pongScoreGraph } from './score-graph.ts';

export interface PongState extends Record<string, ScriptJson> {
  leftY: number; rightY: number; ballX: number; ballY: number; velocityX: number; velocityY: number;
  leftScore: number; rightScore: number; lastScorer: 'left' | 'right' | '';
}

export function initialPongState(): PongState {
  return { leftY: 0, rightY: 0, ballX: 0, ballY: 0, velocityX: 0.72, velocityY: 0.36, leftScore: 0, rightScore: 0, lastScorer: '' };
}

/** Code owns paddle input and ball rules; score events come back from the node graph. */
export function updatePong(api: ScriptApi): void {
  api.subscribe('pong.scored');
  const state = { ...initialPongState(), ...(api.state && typeof api.state === 'object' && !Array.isArray(api.state) ? api.state : {}) } as PongState;
  for (const event of api.events) {
    if (event.type === 'pong.scored' && event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)) {
      const scorer = event.payload.scorer;
      if (scorer === 'left') state.leftScore++;
      if (scorer === 'right') state.rightScore++;
      if (scorer === 'left' || scorer === 'right') state.lastScorer = scorer;
    }
  }

  const dt = Math.min(api.deltaTime, 1 / 30);
  const leftInput = api.input.actions.leftPaddle?.value ?? 0;
  const rightInput = api.input.actions.rightPaddle?.value ?? 0;
  state.leftY = clamp(state.leftY + leftInput * 1.1 * dt, -0.78, 0.78);
  state.rightY = clamp(state.rightY + rightInput * 1.1 * dt, -0.78, 0.78);

  state.ballX += state.velocityX * dt;
  state.ballY += state.velocityY * dt;
  if (state.ballY > 0.94 || state.ballY < -0.94) { state.ballY = clamp(state.ballY, -0.94, 0.94); state.velocityY *= -1; }
  if (state.velocityX < 0 && state.ballX < -0.86 && state.ballX > -0.93 && Math.abs(state.ballY - state.leftY) < 0.19) bounceOffPaddle(state, -1);
  if (state.velocityX > 0 && state.ballX > 0.86 && state.ballX < 0.93 && Math.abs(state.ballY - state.rightY) < 0.19) bounceOffPaddle(state, 1);
  if (state.ballX > 1.04 || state.ballX < -1.04) {
    const scorer = state.ballX > 0 ? 'left' : 'right';
    api.emit('pong.point', { scorer });
    state.ballX = 0; state.ballY = 0; state.velocityX = scorer === 'left' ? 0.72 : -0.72; state.velocityY = Math.random() < 0.5 ? 0.34 : -0.34;
  }
  api.state = state;
}

export interface PongTickInput {
  readonly input: ScriptInputSnapshot;
  readonly deltaTime: number;
  readonly state: PongState;
  readonly codeSubscriptions: readonly string[];
  readonly graphState: ScriptJson;
  readonly graphSubscriptions: readonly string[];
  readonly graphStarted: boolean;
  readonly pendingEvents: readonly ScriptEvent[];
}

/** Small example host with the same code-then-graph, queued-event order as editor Play. */
export function runPongTick(input: PongTickInput) {
  const availableComponentTypeIds: string[] = [];
  const codeApi = createScriptApi({ entityId: 'pong:game', phase: 'update', deltaTime: input.deltaTime, state: input.state, input: input.input, availableComponentTypeIds, subscriptions: input.codeSubscriptions, events: input.pendingEvents.filter(event => input.codeSubscriptions.includes(event.type)) });
  updatePong(codeApi);
  const codeResult = codeApi.finish();
  let graphState = input.graphState;
  let graphSubscriptions = input.graphSubscriptions;
  let graphStarted = input.graphStarted;
  const graphOutputs = [];
  if (!graphStarted) {
    const startApi = createScriptApi({ entityId: 'pong:game', phase: 'start', deltaTime: input.deltaTime, state: graphState, input: input.input, availableComponentTypeIds, subscriptions: graphSubscriptions });
    const start = evaluateVisualGraph(pongScoreGraph, { api: startApi, entryNodeId: 'start' }).output;
    graphState = start.state; graphSubscriptions = start.subscriptions; graphOutputs.push(start); graphStarted = true;
  }
  // The host dispatches only subscribed events and invokes the matching event entrypoint.
  for (const event of input.pendingEvents.filter(item => graphSubscriptions.includes(item.type))) {
    const entry = pongScoreGraph.nodes.find(node => node.kind === 'event.onEvent' && node.data.eventType === event.type);
    if (!entry) continue;
    const eventApi = createScriptApi({ entityId: 'pong:game', phase: 'event', deltaTime: input.deltaTime, state: graphState, input: input.input, availableComponentTypeIds, subscriptions: graphSubscriptions, events: [event] });
    const output = evaluateVisualGraph(pongScoreGraph, { api: eventApi, entryNodeId: entry.id }).output;
    graphState = output.state; graphSubscriptions = output.subscriptions; graphOutputs.push(output);
  }
  const graphResult = graphOutputs.reduce((result, output) => ({
    state: output.state, subscriptions: output.subscriptions,
    emittedEvents: [...result.emittedEvents, ...output.emittedEvents],
  }), { state: graphState, subscriptions: graphSubscriptions, emittedEvents: [] as ReturnType<ReturnType<typeof createScriptApi>['finish']>['emittedEvents'] });
  return {
    state: codeResult.state as PongState,
    codeSubscriptions: codeResult.subscriptions,
    graphState: graphResult.state,
    graphSubscriptions: graphResult.subscriptions,
    graphStarted,
    pendingEvents: [...codeResult.emittedEvents, ...graphResult.emittedEvents],
  };
}

function bounceOffPaddle(state: PongState, direction: -1 | 1) {
  state.velocityX = direction * Math.min(1.25, Math.abs(state.velocityX) * 1.04);
  state.velocityY += (state.ballY - (direction < 0 ? state.leftY : state.rightY)) * 0.9;
  state.ballX = direction * 0.86;
}
function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }
