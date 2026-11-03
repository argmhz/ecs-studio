import assert from 'node:assert/strict';
import test from 'node:test';
import { World, defineComponent } from '@ecs/core';
import { FixedStepLoop, HeadlessRuntime, InputActionMap, Scheduler } from '../src/index.ts';

function createLoop(options: ConstructorParameters<typeof FixedStepLoop>[1] = {}) {
  const scheduler = new Scheduler(new World());
  return { scheduler, loop: new FixedStepLoop(scheduler, options) };
}

test('scheduler uses ascending order and stable registration order', () => {
  const { scheduler } = createLoop();
  const calls: string[] = [];
  scheduler.addSystem(() => calls.push('late'), { order: 5 });
  scheduler.addSystem(() => calls.push('first'), { order: -1 });
  scheduler.addSystem(() => calls.push('same order'), { order: 5 });

  scheduler.step(0.25);

  assert.deepEqual(calls, ['first', 'late', 'same order']);
  assert.equal(scheduler.tick, 1);
  assert.equal(scheduler.elapsedTime, 0.25);
});

test('scheduler reports per-system last and average execution timings', () => {
  const { scheduler } = createLoop();
  scheduler.addSystem(() => {}, { order: 4, name: 'Measured system' });
  const before = scheduler.getSystemTimings()[0]!;
  assert.equal(before.name, 'Measured system');
  assert.equal(before.runs, 0);
  scheduler.step(1 / 60);
  const after = scheduler.getSystemTimings()[0]!;
  assert.equal(after.runs, 1);
  assert.ok(after.lastDurationMs >= 0);
  assert.equal(after.averageDurationMs, after.lastDurationMs);
});

test('systems receive a shared fixed-step context and registration changes apply next tick', () => {
  const { scheduler, loop } = createLoop({ fixedDeltaTime: 0.1 });
  const calls: string[] = [];
  let removeSecond = () => false;
  scheduler.addSystem(({ tick, elapsedTime }) => {
    calls.push(`first:${tick}:${elapsedTime.toFixed(1)}`);
    if (tick === 1) removeSecond();
  }, { order: 0 });
  removeSecond = scheduler.addSystem(({ tick }) => calls.push(`second:${tick}`), { order: 1 });

  loop.advance(0.2);

  assert.deepEqual(calls, ['first:1:0.1', 'second:1', 'first:2:0.2']);
});

test('fixed step returns interpolation alpha for a partial tick', () => {
  const { scheduler, loop } = createLoop({ fixedDeltaTime: 0.1 });
  let steps = 0;
  scheduler.addSystem(() => steps++);

  const result = loop.advance(0.25);

  assert.equal(result.steps, 2);
  assert.ok(Math.abs(result.alpha - 0.5) < 1e-10);
  assert.equal(steps, 2);
  assert.equal(result.droppedTime, 0);
});

test('long frames have bounded catch-up and report dropped time', () => {
  const { scheduler, loop } = createLoop({
    fixedDeltaTime: 0.1,
    maxStepsPerFrame: 2,
    maxFrameDeltaTime: 1,
  });
  let steps = 0;
  scheduler.addSystem(() => steps++);

  const result = loop.advance(60);

  assert.equal(result.steps, 2);
  assert.equal(steps, 2);
  assert.ok(Math.abs(result.droppedTime - 59.8) < 1e-10);
  assert.ok(result.alpha >= 0 && result.alpha < 1);
});

test('pause discards a partial tick and stepOnce advances only while paused', () => {
  const { scheduler, loop } = createLoop({ fixedDeltaTime: 0.1 });
  let steps = 0;
  scheduler.addSystem(() => steps++);

  assert.throws(() => loop.stepOnce(), /Pause the simulation/);
  assert.equal(loop.advance(0.05).alpha, 0.5);
  loop.pause();
  assert.equal(loop.advance(10).steps, 0);
  loop.stepOnce();
  assert.equal(steps, 1);
  assert.equal(scheduler.tick, 1);
  loop.resume();
  assert.equal(loop.advance(0.05).steps, 0);
  assert.equal(steps, 1);
});

test('a system error pauses the loop and does not retry the partial tick', () => {
  const { scheduler, loop } = createLoop({ fixedDeltaTime: 0.1 });
  let attempts = 0;
  scheduler.addSystem(() => {
    attempts++;
    throw new Error('system failed');
  });

  assert.throws(() => loop.advance(0.2), /system failed/);
  assert.equal(loop.isPaused, true);
  assert.equal(scheduler.tick, 0);
  assert.equal(loop.advance(1).steps, 0);
  assert.equal(attempts, 1);
});

test('invalid timing values are rejected', () => {
  const { loop, scheduler } = createLoop();
  assert.throws(() => loop.advance(Number.NaN), /frameDeltaTime/);
  assert.throws(() => scheduler.step(0), /deltaTime/);
  assert.throws(() => createLoop({ maxStepsPerFrame: 0 }), /maxStepsPerFrame/);
});

test('input actions combine keyboard and gamepad bindings and report edges', () => {
  const map = new InputActionMap();
  const raw = { keys: new Set(['KeyD', 'Space']), pointerButtons: new Set<number>(), pointer: { x: 0.25, y: -0.5, inside: true, primary: false, secondary: false }, gamepads: [] };
  const first = map.sample(raw);
  assert.deepEqual(first.actions.moveX, { value: 1, pressed: true, justPressed: true, justReleased: false });
  assert.deepEqual(first.actions.jump, { value: 1, pressed: true, justPressed: true, justReleased: false });
  assert.deepEqual(first.pointer, raw.pointer);
  const held = map.sample(raw);
  assert.equal(held.actions.jump?.justPressed, false);
  const released = map.sample({ ...raw, keys: new Set(), gamepads: [{ index: 0, buttons: [], axes: [0.8, 0] }] });
  assert.deepEqual(released.actions.jump, { value: 0, pressed: false, justPressed: false, justReleased: true });
  assert.equal(released.actions.moveX?.value, 0.8);
  assert.deepEqual(released.connectedGamepads, [0]);
});

test('input actions cancel opposing keys, apply deadzones and validate custom maps', () => {
  const map = new InputActionMap();
  const pointerButtons = new Set([0]);
  const input = map.sample({ keys: new Set(['KeyA', 'KeyD']), pointerButtons, pointer: { x: 1, y: 1, inside: true, primary: true, secondary: false }, gamepads: [{ index: 1, buttons: [1], axes: [0.1, -0.75] }] });
  assert.equal(input.actions.moveX?.value, 0);
  assert.equal(input.actions.moveX?.pressed, false);
  assert.equal(input.actions.moveY?.value, 0.75);
  assert.equal(input.actions.jump?.pressed, true);
  assert.equal(input.actions.interact?.pressed, true);
  const disconnected = map.sample({ keys: new Set(), pointerButtons: new Set(), pointer: { x: 1, y: 1, inside: false, primary: false, secondary: false }, gamepads: [] });
  assert.deepEqual(disconnected.actions.jump, { value: 0, pressed: false, justPressed: false, justReleased: true });
  assert.deepEqual(disconnected.connectedGamepads, []);
  assert.throws(() => new InputActionMap([{ name: 'bad/name', bindings: [{ type: 'key', code: 'KeyA', value: 1 }] }]), /unique identifiers/);
  assert.throws(() => new InputActionMap([{ name: 'empty', bindings: [] }]), /needs at least one binding/);
});

test('custom project action maps produce named states from their configured key and gamepad bindings', () => {
  const map = new InputActionMap([{ name: 'dash', bindings: [{ type: 'key', code: 'KeyK', value: 1 }, { type: 'gamepadButton', button: 7, value: 1 }] }]);
  const pointer = { x: 0, y: 0, inside: false, primary: false, secondary: false };
  assert.equal(map.sample({ keys: new Set(['KeyK']), pointerButtons: new Set(), pointer, gamepads: [] }).actions.dash?.justPressed, true);
  assert.equal(map.sample({ keys: new Set(), pointerButtons: new Set(), pointer, gamepads: [{ index: 0, buttons: [0, 0, 0, 0, 0, 0, 0, 1], axes: [] }] }).actions.dash?.pressed, true);
  assert.deepEqual(map.toJSON(), [{ name: 'dash', bindings: [{ type: 'key', code: 'KeyK', value: 1 }, { type: 'gamepadButton', button: 7, value: 1 }] }]);
});

test('headless runtime advances ordinary ECS systems without browser globals', () => {
  assert.equal('document' in globalThis, false);
  assert.equal('window' in globalThis, false);
  const Position = defineComponent<{ x: number }>('HeadlessPosition');
  const world = new World();
  const entity = world.createEntity();
  world.addComponent(entity, Position, { x: 0 });
  const runtime = new HeadlessRuntime(world, { fixedDeltaTime: 0.1 });
  runtime.addSystem(({ world: currentWorld, deltaTime }) => {
    const position = currentWorld.getComponent(entity, Position)!;
    currentWorld.setComponent(entity, Position, { x: position.x + deltaTime });
  }, { name: 'Move entity' });

  assert.equal(runtime.advance(0.2).steps, 2);
  assert.equal(world.getComponent(entity, Position)?.x, 0.2);
  assert.equal(runtime.scheduler.tick, 2);
  runtime.dispose();
  assert.throws(() => runtime.advance(0.1), /disposed/);
  assert.throws(() => runtime.addSystem(() => {}), /disposed/);
});
