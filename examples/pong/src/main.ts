import { initialPongState, runPongTick, type PongState } from './pong-script.ts';
import type { ScriptJson } from '@ecs/scripting';
import './style.css';

const app = document.querySelector<HTMLDivElement>('#pong-app');
if (!app) throw new Error('Pong app root is missing.');
app.innerHTML = `
  <main class="pong-shell">
    <header class="pong-header">
      <a href="/" aria-label="Back to ECS Studio">← ECS Studio</a>
      <div><span class="eyebrow">SCRIPT + VISUAL NODES</span><h1>Browser Pong</h1></div>
      <span class="status-pill">PLAYING</span>
    </header>
    <section class="pong-board" aria-label="Pong game">
      <canvas aria-label="Pong game canvas"></canvas>
      <div class="score"><span data-score="left">0</span><span>:</span><span data-score="right">0</span></div>
      <div class="center-hint">W / S <i>·</i> ↑ / ↓</div>
    </section>
    <footer class="pong-footer">
      <p><b>Code</b> moves both paddles, simulates the ball, and emits <code>pong.point</code>.</p>
      <p><b>Nodes</b> listens for that event and forwards it as <code>pong.scored</code>. Code then updates the score.</p>
    </footer>
  </main>`;

const canvas = app.querySelector('canvas')!;
const context = canvas.getContext('2d')!;
const leftScore = app.querySelector<HTMLElement>('[data-score="left"]')!;
const rightScore = app.querySelector<HTMLElement>('[data-score="right"]')!;
const held = new Set<string>();
let state: PongState = initialPongState();
let codeSubscriptions: readonly string[] = [];
let graphSubscriptions: readonly string[] = [];
let graphStarted = false;
let graphState: ScriptJson = null;
let pendingEvents: ReturnType<typeof runPongTick>['pendingEvents'] = [];
let lastTime = performance.now();

window.addEventListener('keydown', event => { held.add(event.key.toLowerCase()); if ([' ', 'arrowup', 'arrowdown'].includes(event.key.toLowerCase())) event.preventDefault(); });
window.addEventListener('keyup', event => held.delete(event.key.toLowerCase()));
window.addEventListener('blur', () => held.clear());

function frame(now: number) {
  const deltaTime = Math.min((now - lastTime) / 1000, 1 / 30);
  lastTime = now;
  const action = (positive: boolean, negative: boolean) => ({ value: Number(positive) - Number(negative), pressed: positive || negative, justPressed: false, justReleased: false });
  const result = runPongTick({
    input: { actions: { leftPaddle: action(held.has('s'), held.has('w')), rightPaddle: action(held.has('arrowdown'), held.has('arrowup')) }, pointer: { x: 0, y: 0, inside: false, primary: false, secondary: false }, connectedGamepads: [] },
    deltaTime, state, codeSubscriptions, graphState, graphSubscriptions, graphStarted, pendingEvents,
  });
  state = result.state;
  codeSubscriptions = result.codeSubscriptions;
  graphState = result.graphState;
  graphSubscriptions = result.graphSubscriptions;
  graphStarted = result.graphStarted;
  pendingEvents = result.pendingEvents;
  leftScore.textContent = String(state.leftScore);
  rightScore.textContent = String(state.rightScore);
  canvas.dataset.leftY = String(state.leftY);
  draw();
  requestAnimationFrame(frame);
}

function draw() {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const { width, height } = canvas.getBoundingClientRect();
  if (!width || !height) return;
  const pixelWidth = Math.round(width * ratio), pixelHeight = Math.round(height * ratio);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) { canvas.width = pixelWidth; canvas.height = pixelHeight; }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#10151b'; context.fillRect(0, 0, width, height);
  context.strokeStyle = 'rgba(177, 199, 211, .25)'; context.setLineDash([8, 10]); context.beginPath(); context.moveTo(width / 2, 20); context.lineTo(width / 2, height - 20); context.stroke(); context.setLineDash([]);
  context.fillStyle = '#83e0c1';
  context.fillRect(width * .065, normalizedY(state.leftY, height), 9, height * .23);
  context.fillRect(width * .935 - 9, normalizedY(state.rightY, height), 9, height * .23);
  context.beginPath(); context.arc((state.ballX + 1) * width / 2, (state.ballY + 1) * height / 2, 7, 0, Math.PI * 2); context.fill();
}
function normalizedY(y: number, height: number) { return (y + 1) * height / 2 - height * .115; }
window.addEventListener('resize', draw);
requestAnimationFrame(frame);
