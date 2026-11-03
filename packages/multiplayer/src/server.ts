import { randomBytes, randomUUID } from 'node:crypto';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { HeadlessRuntime, type FixedStepLoopOptions } from '@ecs/runtime';
import type { AuthoritativeInput, MultiplayerClientMessage, MultiplayerJson, MultiplayerServerMessage, RoomSnapshotMessage } from './protocol.ts';
import { MULTIPLAYER_PROTOCOL_VERSION } from './protocol.ts';

const ROOM_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const MAX_ROOM_INPUTS = 512;
const MAX_ACTIONS = 32;
const DEFAULT_SNAPSHOT_INTERVAL_TICKS = 3;
const DEFAULT_MAX_SNAPSHOT_BYTES = 64 * 1024;
const ACTION_NAME = /^[a-zA-Z][a-zA-Z0-9_.-]{0,47}$/;

interface Peer {
  readonly id: string;
  readonly socket: WebSocket;
  playerId?: string;
  roomCode?: string;
  lastSequence: number;
  alive: boolean;
}

interface Room {
  readonly code: string;
  readonly runtime: HeadlessRuntime;
  readonly peers: Map<string, Peer>;
  readonly inputs: AuthoritativeInput[];
  readonly lastProcessedInputSequences: Map<string, number>;
  lastSnapshotTick: number;
  ownerId: string;
}

export interface MultiplayerServerOptions {
  readonly protocolVersion?: number;
  readonly maxPlayers?: number;
  readonly maxRooms?: number;
  readonly fixedStep?: FixedStepLoopOptions;
  readonly createRuntime?: (roomCode: string) => HeadlessRuntime;
  readonly configureRoom?: (roomCode: string, runtime: HeadlessRuntime) => void;
  readonly applyInputs?: (roomCode: string, runtime: HeadlessRuntime, inputs: readonly AuthoritativeInput[]) => void;
  /** Return a JSON-safe, server-authoritative room state for clients to render. */
  readonly createSnapshot?: (roomCode: string, runtime: HeadlessRuntime) => MultiplayerJson;
  /** Publish at most one snapshot after this many fixed simulation ticks. Defaults to 3. */
  readonly snapshotIntervalTicks?: number;
  /** Maximum serialized snapshot envelope size. Defaults to 64 KiB. */
  readonly maxSnapshotBytes?: number;
  /** Test hook; production defaults use cryptographically random room codes. */
  readonly createRoomCode?: () => string;
  readonly heartbeatIntervalMs?: number;
}

/** Node WebSocket host for private rooms and server-owned simulations. */
export class MultiplayerServer {
  readonly httpServer: HttpServer;
  readonly websocketServer: WebSocketServer;
  private readonly protocolVersion: number;
  private readonly maxPlayers: number;
  private readonly maxRooms: number;
  private readonly snapshotIntervalTicks: number;
  private readonly maxSnapshotBytes: number;
  private readonly options: MultiplayerServerOptions;
  private readonly peers = new Map<string, Peer>();
  private readonly rooms = new Map<string, Room>();
  private readonly heartbeat: ReturnType<typeof setInterval>;
  private closed = false;

  constructor(options: MultiplayerServerOptions = {}) {
    this.options = options;
    this.protocolVersion = options.protocolVersion ?? MULTIPLAYER_PROTOCOL_VERSION;
    this.maxPlayers = options.maxPlayers ?? 8;
    this.maxRooms = options.maxRooms ?? 500;
    this.snapshotIntervalTicks = options.snapshotIntervalTicks ?? DEFAULT_SNAPSHOT_INTERVAL_TICKS;
    this.maxSnapshotBytes = options.maxSnapshotBytes ?? DEFAULT_MAX_SNAPSHOT_BYTES;
    const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 30_000;
    if (!Number.isInteger(this.protocolVersion) || this.protocolVersion < 1) throw new RangeError('protocolVersion must be a positive integer.');
    if (!Number.isInteger(this.maxPlayers) || this.maxPlayers < 2 || this.maxPlayers > 8) throw new RangeError('maxPlayers must be between 2 and 8.');
    if (!Number.isInteger(this.maxRooms) || this.maxRooms < 1 || this.maxRooms > 10_000) throw new RangeError('maxRooms must be between 1 and 10000.');
    if (!Number.isInteger(this.snapshotIntervalTicks) || this.snapshotIntervalTicks < 1) throw new RangeError('snapshotIntervalTicks must be a positive integer.');
    if (!Number.isInteger(this.maxSnapshotBytes) || this.maxSnapshotBytes < 256 || this.maxSnapshotBytes > 1024 * 1024) throw new RangeError('maxSnapshotBytes must be between 256 bytes and 1 MiB.');
    if (!Number.isFinite(heartbeatIntervalMs) || heartbeatIntervalMs < 100) throw new RangeError('heartbeatIntervalMs must be at least 100 milliseconds.');
    this.httpServer = createHttpServer((request, response) => {
      if (request.method === 'GET' && request.url === '/healthz') {
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        response.end(JSON.stringify({ status: this.closed ? 'closed' : 'ok', rooms: this.rooms.size }));
      } else {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); response.end('Not found');
      }
    });
    this.websocketServer = new WebSocketServer({ server: this.httpServer, path: '/multiplayer', maxPayload: 16 * 1024, perMessageDeflate: false });
    this.websocketServer.on('connection', socket => this.accept(socket));
    this.websocketServer.on('error', () => undefined);
    this.heartbeat = setInterval(() => {
      for (const peer of this.peers.values()) {
        if (peer.socket.readyState !== WebSocket.OPEN) continue;
        if (!peer.alive) { peer.socket.terminate(); continue; }
        peer.alive = false;
        peer.socket.ping();
      }
    }, heartbeatIntervalMs);
    this.heartbeat.unref();
  }

  get roomCount(): number { return this.rooms.size; }
  /** Snapshot of active room codes for an application-owned host clock. */
  get roomCodes(): readonly string[] { return [...this.rooms.keys()]; }

  listen(port = 0, host = '127.0.0.1'): Promise<AddressInfo> {
    this.assertOpen();
    return new Promise((resolve, reject) => {
      const onError = (error: Error) => { this.httpServer.off('listening', onListening); reject(error); };
      const onListening = () => { this.httpServer.off('error', onError); const address = this.httpServer.address(); if (address && typeof address !== 'string') resolve(address); else reject(new Error('Multiplayer server did not bind a TCP address.')); };
      this.httpServer.once('error', onError); this.httpServer.once('listening', onListening); this.httpServer.listen(port, host);
    });
  }

  /** Advance one room using only server-validated input queued by its peers. */
  advanceRoom(roomCode: string, elapsedSeconds: number) {
    const room = this.rooms.get(normalizeRoomCode(roomCode));
    if (!room) throw new Error('Unknown room.');
    const inputs = room.inputs.splice(0);
    try {
      this.options.applyInputs?.(room.code, room.runtime, inputs);
      if (this.options.applyInputs) for (const input of inputs) room.lastProcessedInputSequences.set(input.playerId, input.sequence);
      const result = room.runtime.advance(elapsedSeconds);
      const tick = room.runtime.scheduler.tick;
      if (this.options.createSnapshot && result.steps > 0 && tick - room.lastSnapshotTick >= this.snapshotIntervalTicks) this.publishSnapshot(room);
      return result;
    } catch (error) {
      room.runtime.pause();
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.heartbeat);
    for (const room of this.rooms.values()) room.runtime.dispose();
    this.rooms.clear();
    const peers = [...this.peers.values()];
    for (const peer of peers) if (peer.socket.readyState === WebSocket.OPEN) peer.socket.close(1001, 'Server shutting down');
    this.peers.clear();
    const forceClose = setTimeout(() => { for (const peer of peers) peer.socket.terminate(); }, 1_000);
    try {
      await new Promise<void>(resolve => this.websocketServer.close(() => {
        if (!this.httpServer.listening) { resolve(); return; }
        this.httpServer.close(() => resolve());
      }));
    } finally { clearTimeout(forceClose); }
  }

  private accept(socket: WebSocket): void {
    const peer: Peer = { id: randomUUID(), socket, lastSequence: -1, alive: true };
    this.peers.set(peer.id, peer);
    socket.on('message', data => this.onMessage(peer, data));
    socket.on('pong', () => { peer.alive = true; });
    socket.on('close', () => this.disconnect(peer));
    socket.on('error', () => this.disconnect(peer));
  }

  private onMessage(peer: Peer, raw: RawData): void {
    let message: unknown;
    try { message = JSON.parse(raw.toString()); }
    catch { this.reject(peer, 'INVALID_JSON', 'Message must be valid JSON.'); return; }
    if (!isRecord(message) || typeof message.type !== 'string') { this.reject(peer, 'INVALID_MESSAGE', 'Message must be an object with a type.'); return; }
    if (!peer.playerId) { this.handleJoin(peer, message); return; }
    if (message.type === 'input') { this.handleInput(peer, message); return; }
    if (message.type === 'leave-room') { this.leaveRoom(peer); return; }
    this.reject(peer, 'INVALID_STATE', 'Create or join a room before sending this message.');
  }

  private handleJoin(peer: Peer, message: Record<string, unknown>): void {
    if (message.protocolVersion !== this.protocolVersion) {
      this.send(peer, { type: 'error', code: 'VERSION_MISMATCH', message: `Protocol version ${String(message.protocolVersion)} is incompatible with server version ${this.protocolVersion}.` });
      peer.socket.close(4001, 'Protocol version mismatch'); return;
    }
    if (message.type === 'create-room') { this.createRoom(peer); return; }
    if (message.type === 'join-room' && typeof message.roomCode === 'string') { this.joinRoom(peer, message.roomCode); return; }
    this.reject(peer, 'INVALID_MESSAGE', 'Expected create-room or join-room with a protocol version.');
  }

  private createRoom(peer: Peer): void {
    if (peer.playerId) { this.reject(peer, 'ALREADY_IN_ROOM', 'This connection already belongs to a room.'); return; }
    if (this.rooms.size >= this.maxRooms) { this.reject(peer, 'ROOM_LIMIT', 'The server has reached its active room limit. Try again later.'); return; }
    let code = '';
    for (let attempt = 0; attempt < 8; attempt++) {
      code = normalizeRoomCode((this.options.createRoomCode ?? createPrivateRoomCode)());
      if (/^[A-Z2-9]{10}$/.test(code) && !this.rooms.has(code)) break;
      code = '';
    }
    if (!code) { this.reject(peer, 'ROOM_CODE_UNAVAILABLE', 'Could not allocate a unique private room code.'); return; }
    const runtime = this.options.createRuntime?.(code) ?? new HeadlessRuntime(undefined, this.options.fixedStep);
    try { this.options.configureRoom?.(code, runtime); }
    catch (error) { runtime.dispose(); this.reject(peer, 'ROOM_SETUP_FAILED', `Room setup failed: ${errorMessage(error)}`); return; }
    const room: Room = { code, runtime, peers: new Map(), inputs: [], lastProcessedInputSequences: new Map(), lastSnapshotTick: 0, ownerId: '' };
    this.rooms.set(code, room);
    this.addPeer(room, peer);
    this.send(peer, this.roomMessage('room-created', room, peer.playerId!));
    if (this.options.createSnapshot) this.sendSnapshot(room, peer);
  }

  private joinRoom(peer: Peer, rawCode: string): void {
    const code = normalizeRoomCode(rawCode);
    const room = this.rooms.get(code);
    if (!room) { this.reject(peer, 'ROOM_NOT_FOUND', 'No private room matches that code.'); return; }
    if (room.peers.size >= this.maxPlayers) { this.reject(peer, 'ROOM_FULL', `This room is full (maximum ${this.maxPlayers} players).`); return; }
    this.addPeer(room, peer);
    this.send(peer, this.roomMessage('room-joined', room, peer.playerId!));
    if (this.options.createSnapshot) this.sendSnapshot(room, peer);
    this.broadcast(room, { type: 'player-joined', playerId: peer.playerId!, ownerId: room.ownerId, players: this.playerIds(room) }, peer);
  }

  private addPeer(room: Room, peer: Peer): void {
    peer.playerId = randomUUID(); peer.roomCode = room.code; peer.lastSequence = -1;
    room.peers.set(peer.playerId, peer);
    if (!room.ownerId) room.ownerId = peer.playerId;
  }

  private handleInput(peer: Peer, message: Record<string, unknown>): void {
    const room = peer.roomCode ? this.rooms.get(peer.roomCode) : undefined;
    if (!room || !peer.playerId) { this.reject(peer, 'NOT_IN_ROOM', 'Join a room before sending input.'); return; }
    if (!Number.isSafeInteger(message.sequence) || (message.sequence as number) <= peer.lastSequence) { this.reject(peer, 'INVALID_SEQUENCE', 'Input sequence must be a new, increasing integer.'); return; }
    const actions = validateActions(message.actions);
    if (!actions) { this.reject(peer, 'INVALID_INPUT', 'Actions must contain at most 32 named, finite values between -1 and 1.'); return; }
    if (room.inputs.length >= MAX_ROOM_INPUTS) { this.reject(peer, 'INPUT_QUEUE_FULL', 'The room input queue is full; retry after the next server tick.'); return; }
    peer.lastSequence = message.sequence as number;
    room.inputs.push({ playerId: peer.playerId, sequence: peer.lastSequence, actions });
    this.send(peer, { type: 'input-accepted', sequence: peer.lastSequence, tick: room.runtime.scheduler.tick });
  }

  private disconnect(peer: Peer): void {
    this.peers.delete(peer.id);
    this.leaveRoom(peer);
  }

  private leaveRoom(peer: Peer): void {
    if (!peer.playerId || !peer.roomCode) return;
    const room = this.rooms.get(peer.roomCode);
    if (!room || !room.peers.delete(peer.playerId)) return;
    room.lastProcessedInputSequences.delete(peer.playerId);
    room.inputs.splice(0, room.inputs.length, ...room.inputs.filter(input => input.playerId !== peer.playerId));
    const wasOwner = room.ownerId === peer.playerId;
    if (room.peers.size === 0) {
      room.runtime.dispose(); this.rooms.delete(room.code); return;
    }
    if (wasOwner) room.ownerId = room.peers.keys().next().value!;
    this.broadcast(room, { type: 'player-left', playerId: peer.playerId, ownerId: room.ownerId, players: this.playerIds(room) });
    if (wasOwner) this.broadcast(room, { type: 'owner-changed', ownerId: room.ownerId });
    peer.playerId = undefined; peer.roomCode = undefined;
  }

  private roomMessage(type: 'room-created' | 'room-joined', room: Room, playerId: string): MultiplayerServerMessage {
    return { type, roomCode: room.code, playerId, ownerId: room.ownerId, players: this.playerIds(room), maxPlayers: this.maxPlayers, tick: room.runtime.scheduler.tick };
  }

  private publishSnapshot(room: Room): void {
    const message = this.createSnapshotMessage(room);
    const serialized = JSON.stringify(message);
    if (Buffer.byteLength(serialized, 'utf8') > this.maxSnapshotBytes) throw new RangeError(`Room snapshot exceeds the ${this.maxSnapshotBytes}-byte limit.`);
    for (const peer of room.peers.values()) this.sendSerialized(peer, serialized);
    room.lastSnapshotTick = message.tick;
  }

  private sendSnapshot(room: Room, peer: Peer): void {
    try {
      const serialized = JSON.stringify(this.createSnapshotMessage(room));
      if (Buffer.byteLength(serialized, 'utf8') > this.maxSnapshotBytes) throw new RangeError(`Room snapshot exceeds the ${this.maxSnapshotBytes}-byte limit.`);
      this.sendSerialized(peer, serialized);
    } catch (error) { this.reject(peer, 'SNAPSHOT_FAILED', errorMessage(error)); }
  }

  private createSnapshotMessage(room: Room): RoomSnapshotMessage {
    const state = this.options.createSnapshot!(room.code, room.runtime);
    const encodedState = JSON.stringify(state);
    if (encodedState === undefined) throw new TypeError('Room snapshots must return JSON-serializable data.');
    const safeState = JSON.parse(encodedState) as MultiplayerJson;
    const acknowledgements = Object.fromEntries(room.lastProcessedInputSequences);
    return { type: 'snapshot', tick: room.runtime.scheduler.tick, state: safeState, lastProcessedInputSequences: acknowledgements };
  }

  private playerIds(room: Room): string[] { return [...room.peers.keys()]; }
  private broadcast(room: Room, message: MultiplayerServerMessage, except?: Peer): void { for (const peer of room.peers.values()) if (peer !== except) this.send(peer, message); }
  private send(peer: Peer, message: MultiplayerServerMessage): void { if (peer.socket.readyState === WebSocket.OPEN) peer.socket.send(JSON.stringify(message)); }
  private sendSerialized(peer: Peer, message: string): void { if (peer.socket.readyState === WebSocket.OPEN) peer.socket.send(message); }
  private reject(peer: Peer, code: string, message: string): void { this.send(peer, { type: 'error', code, message }); }
  private assertOpen(): void { if (this.closed) throw new Error('MultiplayerServer has been closed.'); }
}

export function createMultiplayerServer(options: MultiplayerServerOptions = {}): MultiplayerServer { return new MultiplayerServer(options); }

function validateActions(value: unknown): Readonly<Record<string, number>> | undefined {
  if (!isRecord(value) || Object.keys(value).length > MAX_ACTIONS) return undefined;
  const actions: Record<string, number> = {};
  for (const [name, amount] of Object.entries(value)) {
    if (!ACTION_NAME.test(name) || !Number.isFinite(amount) || typeof amount !== 'number' || amount < -1 || amount > 1) return undefined;
    actions[name] = amount;
  }
  return Object.freeze(actions);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function createPrivateRoomCode(): string {
  const bytes = randomBytes(10);
  return [...bytes].slice(0, 10).map(byte => ROOM_ALPHABET[byte & 31]!).join('');
}

function normalizeRoomCode(code: string): string { return code.replace(/\s+/g, '').toUpperCase(); }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
