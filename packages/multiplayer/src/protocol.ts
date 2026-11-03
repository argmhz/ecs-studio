export const MULTIPLAYER_PROTOCOL_VERSION = 2;

export type MultiplayerJson = null | boolean | number | string | readonly MultiplayerJson[] | { readonly [key: string]: MultiplayerJson };

export interface RoomSnapshotMessage {
  readonly type: 'snapshot';
  readonly tick: number;
  readonly state: MultiplayerJson;
  /** Highest input sequence included in the authoritative state for each player. */
  readonly lastProcessedInputSequences: Readonly<Record<string, number>>;
}

export interface MultiplayerInputMessage {
  readonly type: 'input';
  readonly sequence: number;
  readonly actions: Readonly<Record<string, number>>;
}

export type MultiplayerClientMessage =
  | { readonly type: 'create-room'; readonly protocolVersion: number }
  | { readonly type: 'join-room'; readonly protocolVersion: number; readonly roomCode: string }
  | MultiplayerInputMessage
  | { readonly type: 'leave-room' };

export type MultiplayerServerMessage =
  | { readonly type: 'room-created' | 'room-joined'; readonly roomCode: string; readonly playerId: string; readonly ownerId: string; readonly players: readonly string[]; readonly maxPlayers: number; readonly tick: number }
  | { readonly type: 'player-joined' | 'player-left'; readonly playerId: string; readonly ownerId: string; readonly players: readonly string[] }
  | { readonly type: 'owner-changed'; readonly ownerId: string }
  | { readonly type: 'input-accepted'; readonly sequence: number; readonly tick: number }
  | RoomSnapshotMessage
  | { readonly type: 'error'; readonly code: string; readonly message: string };

export interface AuthoritativeInput {
  readonly playerId: string;
  readonly sequence: number;
  readonly actions: Readonly<Record<string, number>>;
}
