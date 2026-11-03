# `@ecs/runtime`

The runtime package contains the DOM-independent ECS scheduler, fixed-step loop, input action model, and `HeadlessRuntime` host. `HeadlessRuntime` lets a Node process own a `World`, register ordinary ECS systems, and advance the same ordered fixed-step scheduler used by the browser preview. The host does not create timers or assume ownership of process lifetime: the application supplies elapsed seconds to `advance()`.

```ts
import { World, defineComponent } from '@ecs/core';
import { HeadlessRuntime } from '@ecs/runtime';

const Position = defineComponent<{ x: number }>('Position');
const world = new World();
const entity = world.createEntity();
world.addComponent(entity, Position, { x: 0 });

const runtime = new HeadlessRuntime(world);
runtime.addSystem(({ world, deltaTime }) => {
  const position = world.getComponent(entity, Position)!;
  world.setComponent(entity, Position, { x: position.x + deltaTime });
}, { name: 'Move entity' });

runtime.advance(1 / 60);
runtime.dispose();
```

## Headless support boundary

The host has no dependency on `window`, `document`, canvas, WebGL, or the editor. It runs the ECS systems the application registers and provides the same fixed-step ordering and pause/step behavior as the browser loop. It does not automatically load editor projects or choose game systems.

The current browser integrations remain browser-only and must be omitted or replaced by the application: WebGL rendering and interpolation, keyboard/pointer/gamepad sampling, DOM game UI, Web Audio playback, and iframe/worker-based gameplay-script execution. A server application may provide its own input/network adapter and register server-compatible systems. Rapier physics is currently owned by the browser preview integration and is not included by this host. These exclusions are explicit; this package does not claim full browser-game parity on the server.
