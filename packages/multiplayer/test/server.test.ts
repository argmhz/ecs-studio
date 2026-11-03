import assert from 'node:assert/strict';
import test from 'node:test';
import WebSocket from 'ws';
import { MultiplayerServer, MULTIPLAYER_PROTOCOL_VERSION } from '../src/index.ts';

type Message = Record<string, unknown>;

async function connect(url: string): Promise<WebSocket> {
  const socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  return socket;
}

function receive(socket: WebSocket, predicate: (message: Message) => boolean = () => true): Promise<Message> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => { socket.off('message', onMessage); reject(error); };
    const onMessage = (data: WebSocket.RawData) => {
      let message: Message;
      try { message = JSON.parse(data.toString()) as Message; }
      catch (error) { socket.off('error', onError); reject(error); return; }
      if (!predicate(message)) return;
      socket.off('message', onMessage); socket.off('error', onError); resolve(message);
    };
    socket.on('message', onMessage); socket.once('error', onError);
  });
}

async function sendAndReceive(socket: WebSocket, message: unknown, predicate?: (message: Message) => boolean) {
  const result = receive(socket, predicate);
  socket.send(JSON.stringify(message));
  return result;
}

async function closeSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return;
  await new Promise<void>(resolve => { socket.once('close', () => resolve()); socket.close(); });
}

test('private rooms accept 2–8 players and apply validated client input only on the server tick', async () => {
  const applied: { roomCode: string; playerId: string; actions: Readonly<Record<string, number>> }[] = [];
  const server = new MultiplayerServer({
    maxPlayers: 2,
    createRoomCode: () => '23456789AB',
    applyInputs(roomCode, _runtime, inputs) { applied.push(...inputs.map(input => ({ roomCode, playerId: input.playerId, actions: input.actions }))); },
  });
  const address = await server.listen();
  const url = `ws://127.0.0.1:${address.port}/multiplayer`;
  const owner = await connect(url);
  const guest = await connect(url);
  const extra = await connect(url);
  try {
    const createdPromise = receive(owner);
    owner.send(JSON.stringify({ type: 'create-room', protocolVersion: MULTIPLAYER_PROTOCOL_VERSION }));
    const created = await createdPromise;
    assert.equal(created.type, 'room-created');
    assert.equal(created.roomCode, '23456789AB');
    assert.equal(created.maxPlayers, 2);

    const joinedPromise = receive(guest);
    const ownerNoticePromise = receive(owner, message => message.type === 'player-joined');
    guest.send(JSON.stringify({ type: 'join-room', protocolVersion: MULTIPLAYER_PROTOCOL_VERSION, roomCode: created.roomCode }));
    const joined = await joinedPromise;
    assert.equal(joined.type, 'room-joined');
    assert.equal(joined.ownerId, created.playerId);
    assert.deepEqual((await ownerNoticePromise).players, joined.players);

    assert.deepEqual(await sendAndReceive(extra, { type: 'join-room', protocolVersion: MULTIPLAYER_PROTOCOL_VERSION, roomCode: created.roomCode }), {
      type: 'error', code: 'ROOM_FULL', message: 'This room is full (maximum 2 players).',
    });

    const inputPromise = receive(guest, message => message.type === 'input-accepted');
    guest.send(JSON.stringify({ type: 'input', sequence: 1, actions: { moveX: 0.75, jump: 1 } }));
    const accepted = await inputPromise;
    assert.equal(accepted.tick, 0);
    assert.equal(applied.length, 0, 'client input waits for an explicit server simulation advance');
    assert.equal(server.advanceRoom(String(created.roomCode), 1 / 60).steps, 1);
    assert.equal(applied.length, 1);
    assert.deepEqual(applied[0]!.actions, { moveX: 0.75, jump: 1 });

    assert.equal((await sendAndReceive(guest, { type: 'input', sequence: 1, actions: { moveX: 0 } })).code, 'INVALID_SEQUENCE');
    assert.equal((await sendAndReceive(guest, { type: 'input', sequence: 2, actions: { moveX: 8 } })).code, 'INVALID_INPUT');
  } finally {
    await Promise.all([closeSocket(owner), closeSocket(guest), closeSocket(extra)]);
    await server.close();
  }
  assert.equal(server.roomCount, 0);
});

test('owner disconnect transfers ownership, empty rooms are removed, and protocol mismatches are rejected', async () => {
  const server = new MultiplayerServer({ createRoomCode: () => 'ABCDEFGHJK' });
  const address = await server.listen();
  const url = `ws://127.0.0.1:${address.port}/multiplayer`;
  const owner = await connect(url);
  const guest = await connect(url);
  const incompatible = await connect(url);
  try {
    const rejectedPromise = receive(incompatible, message => message.type === 'error');
    incompatible.send(JSON.stringify({ type: 'create-room', protocolVersion: MULTIPLAYER_PROTOCOL_VERSION + 1 }));
    assert.equal((await rejectedPromise).code, 'VERSION_MISMATCH');

    const createdPromise = receive(owner);
    owner.send(JSON.stringify({ type: 'create-room', protocolVersion: MULTIPLAYER_PROTOCOL_VERSION }));
    const created = await createdPromise;
    const joinedPromise = receive(guest);
    guest.send(JSON.stringify({ type: 'join-room', protocolVersion: MULTIPLAYER_PROTOCOL_VERSION, roomCode: created.roomCode }));
    await joinedPromise;
    const changedPromise = receive(guest, message => message.type === 'owner-changed');
    const leftPromise = receive(guest, message => message.type === 'player-left');
    await closeSocket(owner);
    const changed = await changedPromise;
    assert.equal(changed.ownerId, (await leftPromise).ownerId);
    assert.equal(server.roomCount, 1);
    await closeSocket(guest);
    assert.equal(server.roomCount, 0);
  } finally {
    await Promise.all([closeSocket(owner), closeSocket(guest), closeSocket(incompatible)]);
    await server.close();
  }
});

test('default private room capacity reaches eight players and rejects a ninth', async () => {
  const server = new MultiplayerServer({ createRoomCode: () => '23456789CD' });
  const address = await server.listen();
  const url = `ws://127.0.0.1:${address.port}/multiplayer`;
  const sockets: WebSocket[] = [];
  try {
    const owner = await connect(url); sockets.push(owner);
    const createdPromise = receive(owner);
    owner.send(JSON.stringify({ type: 'create-room', protocolVersion: MULTIPLAYER_PROTOCOL_VERSION }));
    const created = await createdPromise;
    assert.equal(created.maxPlayers, 8);
    for (let index = 1; index < 8; index++) {
      const player = await connect(url); sockets.push(player);
      const joinedPromise = receive(player);
      player.send(JSON.stringify({ type: 'join-room', protocolVersion: MULTIPLAYER_PROTOCOL_VERSION, roomCode: created.roomCode }));
      const joined = await joinedPromise;
      assert.equal(joined.type, 'room-joined');
      assert.equal((joined.players as string[]).length, index + 1);
    }
    const ninth = await connect(url); sockets.push(ninth);
    const rejected = await sendAndReceive(ninth, { type: 'join-room', protocolVersion: MULTIPLAYER_PROTOCOL_VERSION, roomCode: created.roomCode });
    assert.equal(rejected.code, 'ROOM_FULL');
  } finally {
    await Promise.all(sockets.map(closeSocket));
    await server.close();
  }
});

test('server shutdown disposes active rooms and closes connected peers', async () => {
  const server = new MultiplayerServer({ createRoomCode: () => '23456789EF' });
  const address = await server.listen();
  const socket = await connect(`ws://127.0.0.1:${address.port}/multiplayer`);
  const createdPromise = receive(socket);
  socket.send(JSON.stringify({ type: 'create-room', protocolVersion: MULTIPLAYER_PROTOCOL_VERSION }));
  await createdPromise;
  assert.equal(server.roomCount, 1);
  assert.deepEqual(server.roomCodes, ['23456789EF']);

  await server.close();
  assert.equal(server.roomCount, 0);
  assert.equal(socket.readyState, WebSocket.CLOSED);
});

test('active room limit rejects new rooms and frees capacity after the final player leaves', async () => {
  const server = new MultiplayerServer({ maxRooms: 1, createRoomCode: () => '23456789GH' });
  const address = await server.listen();
  const url = `ws://127.0.0.1:${address.port}/multiplayer`;
  const owner = await connect(url);
  const extra = await connect(url);
  try {
    const createdPromise = receive(owner);
    owner.send(JSON.stringify({ type: 'create-room', protocolVersion: MULTIPLAYER_PROTOCOL_VERSION }));
    await createdPromise;
    const limit = await sendAndReceive(extra, { type: 'create-room', protocolVersion: MULTIPLAYER_PROTOCOL_VERSION });
    assert.equal(limit.type, 'error');
    assert.equal(limit.code, 'ROOM_LIMIT');
    await closeSocket(owner);
    const secondRoomPromise = receive(extra);
    extra.send(JSON.stringify({ type: 'create-room', protocolVersion: MULTIPLAYER_PROTOCOL_VERSION }));
    assert.equal((await secondRoomPromise).type, 'room-created');
  } finally {
    await Promise.all([closeSocket(owner), closeSocket(extra)]);
    await server.close();
  }
  assert.equal(server.roomCount, 0);
});

test('rooms publish bounded authoritative snapshots and acknowledge inputs included in the state', async () => {
  let serverValue = 0;
  const server = new MultiplayerServer({
    createRoomCode: () => '23456789EF',
    snapshotIntervalTicks: 2,
    applyInputs(_roomCode, _runtime, inputs) { serverValue += inputs.reduce((sum, input) => sum + (input.actions.moveX ?? 0), 0); },
    createSnapshot() { return { value: serverValue }; },
  });
  const address = await server.listen();
  const url = `ws://127.0.0.1:${address.port}/multiplayer`;
  const owner = await connect(url);
  const guest = await connect(url);
  try {
    const createdPromise = receive(owner, message => message.type === 'room-created');
    const initialOwnerSnapshotPromise = receive(owner, message => message.type === 'snapshot');
    owner.send(JSON.stringify({ type: 'create-room', protocolVersion: MULTIPLAYER_PROTOCOL_VERSION }));
    const created = await createdPromise;
    assert.equal((await initialOwnerSnapshotPromise).tick, 0);

    const joinedPromise = receive(guest, message => message.type === 'room-joined');
    const initialGuestSnapshotPromise = receive(guest, message => message.type === 'snapshot');
    guest.send(JSON.stringify({ type: 'join-room', protocolVersion: MULTIPLAYER_PROTOCOL_VERSION, roomCode: created.roomCode }));
    const joined = await joinedPromise;
    assert.equal((await initialGuestSnapshotPromise).tick, 0);

    const acceptedPromise = receive(guest, message => message.type === 'input-accepted');
    guest.send(JSON.stringify({ type: 'input', sequence: 4, actions: { moveX: 0.5 } }));
    assert.equal((await acceptedPromise).tick, 0);
    server.advanceRoom(String(created.roomCode), 1 / 60);

    const ownerSnapshotPromise = receive(owner, message => message.type === 'snapshot');
    const guestSnapshotPromise = receive(guest, message => message.type === 'snapshot');
    server.advanceRoom(String(created.roomCode), 1 / 60);
    const [ownerSnapshot, guestSnapshot] = await Promise.all([ownerSnapshotPromise, guestSnapshotPromise]);
    assert.equal(ownerSnapshot.tick, 2);
    assert.deepEqual(guestSnapshot.state, { value: 0.5 });
    assert.equal((guestSnapshot.lastProcessedInputSequences as Record<string, number>)[String(joined.playerId)], 4);
  } finally {
    await Promise.all([closeSocket(owner), closeSocket(guest)]);
    await server.close();
  }
});

test('oversized initial snapshots are rejected instead of being sent to clients', async () => {
  const server = new MultiplayerServer({ createSnapshot: () => ({ payload: 'x'.repeat(512) }), maxSnapshotBytes: 256 });
  const address = await server.listen();
  const socket = await connect(`ws://127.0.0.1:${address.port}/multiplayer`);
  try {
    const createdPromise = receive(socket, message => message.type === 'room-created');
    const errorPromise = receive(socket, message => message.type === 'error');
    socket.send(JSON.stringify({ type: 'create-room', protocolVersion: MULTIPLAYER_PROTOCOL_VERSION }));
    await createdPromise;
    const error = await errorPromise;
    assert.equal(error.code, 'SNAPSHOT_FAILED');
    assert.match(String(error.message), /256-byte limit/);
  } finally {
    await closeSocket(socket);
    await server.close();
  }
});
