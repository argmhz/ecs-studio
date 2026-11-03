# ADR 0025: Scene and Game preview parity

## Problem

The Scene viewport rendered schema-backed sprite and tilemap items with `WebGLRenderer2D`, while the Game preview still used a temporary object-only Three.js scene with its own camera framing, editor grid and selection tint. The two views could therefore show different content and scale.

## Decision

Keep the Game preview's existing adapter for Play input, Rapier physics and UI overlay, but feed it objects derived from the same ECS scene data. Convert global scene transforms, sprite order and tile render items into preview objects. Share the camera center and world-units-per-pixel settings with the Scene viewport. The Game view excludes the editor grid and selection tint; UI stays as a Game-only overlay.

## Consequences

- Static Game preview and Scene viewport use the same framing and show sprites and tilemap cells from the same scene.
- Runtime animation is visible because preview synchronization reads the Play-copy sprite components each frame.
- Scene selection, editor grid and gizmos remain Scene-only; Game UI remains Game-only.
- The temporary preview decomposes global affine transforms into position, rotation and scale. Shear from rotated parents with non-uniform scale is not preserved exactly.

## Alternative considered

Replace the Play preview renderer immediately with `WebGLRenderer2D`. Deferred because the Game preview also owns input focus, Rapier resources and the interactive UI overlay; a renderer swap should separate those responsibilities rather than remove the working Play adapter.
