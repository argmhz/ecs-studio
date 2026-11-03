import { createMultiplayerServer } from '@ecs/multiplayer';

function integerSetting(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`${name} must be an integer from ${min} to ${max}.`);
  return value;
}

const port = integerSetting('PORT', 8080, 1, 65_535);
const tickRate = integerSetting('TICK_RATE', 60, 1, 60);
const maxPlayers = integerSetting('MAX_PLAYERS', 8, 2, 8);
const maxRooms = integerSetting('MAX_ROOMS', 500, 1, 10_000);
const host = process.env.HOST?.trim() || '0.0.0.0';
const server = createMultiplayerServer({
  maxPlayers,
  maxRooms,
  // This deployable skeleton consumes validated inputs and emits tick snapshots.
  // Replace these callbacks with the game's authoritative state and rules.
  applyInputs() {},
  createSnapshot(_roomCode, runtime) { return { tick: runtime.scheduler.tick }; },
});

const address = await server.listen(port, host);
console.info(`Multiplayer host listening on ${address.address}:${address.port}; WebSocket path /multiplayer.`);

let previousTime = performance.now();
const tickTimer = setInterval(() => {
  const now = performance.now();
  const elapsedSeconds = Math.min(0.25, Math.max(0, (now - previousTime) / 1000));
  previousTime = now;
  for (const roomCode of server.roomCodes) {
    try { server.advanceRoom(roomCode, elapsedSeconds); }
    catch (error) { console.error('A room simulation was paused after an error:', error); }
  }
}, 1000 / tickRate);

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`Received ${signal}; closing multiplayer rooms.`);
  clearInterval(tickTimer);
  await server.close();
}
process.once('SIGINT', () => { void shutdown('SIGINT').catch(error => { console.error(error); process.exitCode = 1; }); });
process.once('SIGTERM', () => { void shutdown('SIGTERM').catch(error => { console.error(error); process.exitCode = 1; }); });
