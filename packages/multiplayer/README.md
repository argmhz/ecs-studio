# `@ecs/multiplayer`

Node-only authoritative room host for 2–8 players. It exposes `ws://<host>:<port>/multiplayer` and a `/healthz` endpoint. The transport uses `ws`; browser clients use the platform's native `WebSocket`.

The first client message is `{"type":"create-room","protocolVersion":2}` or `{"type":"join-room","protocolVersion":2,"roomCode":"…"}`. Room codes are private, randomly generated 10-character capabilities and are never listed. Each connection can occupy one room. The configured capacity must be from 2 to 8; the default is 8. If the room owner disconnects, ownership transfers to the next connected player. Empty rooms and their runtimes are removed.

Clients can submit `{"type":"input","sequence":1,"actions":{"moveX":0.5,"jump":1}}`. The server validates action names, finite values in `[-1, 1]`, strictly increasing per-connection sequence numbers, frame size and a bounded room input queue. Inputs are queued and only passed to the server's `applyInputs` callback when the host advances that room. Clients cannot submit or overwrite world state. `configureRoom` registers server-owned systems on the room's `HeadlessRuntime`; the application owns the host clock and calls `advanceRoom(roomCode, elapsedSeconds)`.

Provide `createSnapshot(roomCode, runtime)` to send an initial authoritative state to new players and then snapshots every three simulation ticks by default (20 snapshots/second at 60 Hz). A snapshot is `{ type: 'snapshot', tick, state, lastProcessedInputSequences }`; `state` is application-defined JSON, limited to 64 KiB by default. `snapshotIntervalTicks` and `maxSnapshotBytes` can be configured. Acknowledgements advance only after `applyInputs` has received the input batch and are included in the next snapshot. Protocol version 2 is required by both peers.

Browser-safe helpers are available from `@ecs/multiplayer/client`, without importing the Node server. `SnapshotBuffer` retains a bounded, monotonic history, drops duplicate/late packets and samples two ticks behind the newest server tick by default. Its default interpolation blends numeric JSON fields and switches discrete fields at the newer frame; provide a custom interpolator for angles, entity lifetimes or game-specific data. `InputReconciler` drops inputs acknowledged by the server and replays the unacknowledged tail through an application-supplied prediction step. Applications own local prediction rules and must extract their local player state from the snapshot.

```ts
import { InputReconciler, SnapshotBuffer } from '@ecs/multiplayer/client';

const remoteStates = new SnapshotBuffer({ interpolationDelayTicks: 2 });
const localInputs = new InputReconciler<InputActions, PlayerState>();
// On each snapshot: push it for remote rendering, then reconcile local state
// using snapshot.lastProcessedInputSequences[playerId] and the app's step function.
// Each render frame: remoteStates.sample(estimatedServerTick).
```

```ts
import { createMultiplayerServer } from '@ecs/multiplayer';

const multiplayer = createMultiplayerServer({
  configureRoom(_roomCode, runtime) {
    runtime.addSystem(({ world, deltaTime }) => {
      // Advance authoritative game state here.
    }, { name: 'Game simulation' });
  },
  applyInputs(_roomCode, runtime, inputs) {
    // Apply validated inputs to server-owned world/resources before its next step.
  },
});
await multiplayer.listen(8080, '0.0.0.0');
```

The server sends room membership and owner changes, input-queue acknowledgements and periodic authoritative snapshots. Snapshot contents and prediction rules remain application-owned; the engine does not serialize arbitrary ECS worlds or assume cross-platform deterministic physics. This initial host has no account or identity provider; possession of a room code grants join access. Put it behind TLS for public use. The server rejects incompatible protocol versions before room membership, and a heartbeat terminates stale connections.

## Deployable host skeleton

`examples/multiplayer-host` is a Node host entry point and `Dockerfile.multiplayer` builds it as a container. The host reads `HOST` (default `0.0.0.0`), `PORT` (default `8080`), `TICK_RATE` (default `60`, range 1–60), `MAX_PLAYERS` (default 8, range 2–8) and `MAX_ROOMS` (default 500, range 1–10,000). It advances every active room on the host clock, exposes `GET /healthz`, and closes room runtimes and WebSocket peers on `SIGTERM`/`SIGINT`. The active-room limit prevents unbounded room creation in this process; size it through load tests and gateway rate limits before public use.

Build and run locally:

```sh
docker build -f Dockerfile.multiplayer -t ecs-multiplayer .
docker run --rm -p 8080:8080 -e HOST=0.0.0.0 -e PORT=8080 ecs-multiplayer
curl http://127.0.0.1:8080/healthz
```

The public client URL is `wss://<your-host>/multiplayer`; the health endpoint is `https://<your-host>/healthz`. Terminate TLS at the hosting platform or a reverse proxy and preserve WebSocket `Upgrade` connections. Configure the proxy idle timeout above the 30-second server heartbeat (75 seconds or more is recommended). Set the host's `PORT` to the platform-assigned port and bind `HOST=0.0.0.0`.

This example is a deployment skeleton, not a complete multiplayer game: it consumes validated inputs and publishes `{ tick }` snapshots. Replace `configureRoom`, `applyInputs` and `createSnapshot` in `examples/multiplayer-host/src/main.ts` with the game's authoritative systems and state before connecting a game client. The browser editor and static web export do not automatically discover or connect to this endpoint; a game must be configured with its public WebSocket URL.

Rooms and simulation state live in process memory. Empty rooms are disposed when their last peer leaves; heartbeat closes dead peers so their rooms can be cleaned up. A process restart ends all active rooms. Run a single host instance for this version; multi-instance routing, shared room state, authentication and durable sessions are not implemented. The project served by static hosting remains separate from this WebSocket backend.

Run the WebSocket integration tests with `npm run test:multiplayer`.
