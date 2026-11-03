# @ecs/rendering

Three.js-backed WebGL 2 renderer for 2D sprites, separate from editor UI and the ECS core. `WebGLRenderer2D` consumes renderer-neutral sprite draw items, uses an orthographic camera, sorts back-to-front by order, and batches contiguous sprites that share a texture. `collectSpriteRenderItems` adapts scene entities and global transforms to draw items.

`createAssetTextureSource` adapts `@ecs/assets` image records into GPU textures. Audio references are reported as unsupported by the image renderer and remain available to the later audio runtime. Missing and unknown asset IDs are returned in render stats for inspector/console display.

The renderer caps device pixel ratio, handles canvas resize, pauses draws while the WebGL context is lost, and redraws the latest scene after restoration. Call `dispose()` to release observer, buffers, materials, textures and the WebGL renderer.

Run pure renderer invariants with `npm run test:rendering`. The temporary viewport/physics prototype remains in `@ecs/browser-preview` until the editor task wires the product renderer into its viewport.
