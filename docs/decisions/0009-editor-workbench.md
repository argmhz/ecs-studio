# ADR 0009: ECS-backed editor workbench

- Status: accepted
- Date: 2026-10-31

## Context

T107 requires the editor hierarchy, scene viewport, schema inspector and asset browser to work on the same scene. The initial editor prototype rendered a separate `SceneObject[]` through a temporary Three.js/Rapier integration, while the ECS, scene schemas, asset pipeline and WebGL renderer had since been implemented as separate packages.

## Decision

The Scene workspace creates a `World` and stable scene-ID map, adds the registered name, transform, sprite and 2D physics components, and uses `SceneHierarchy` for transforms. Inspector fields are generated from each component schema and validated before being written to the selected entity. The viewport collects sprite render items from that same world and renders them through `WebGLRenderer2D`. The in-memory asset database backs the initial texture, image imports and sprite asset references. The bottom workbench switches between Assets and Console; the center switches between Scene, Game and Code.

The existing browser physics preview remains behind the Game tab as a temporary integration experiment. Scene editing updates its starter objects so the Play controls continue to exercise the edited transforms. Project persistence and restoring assets after reload remain in T109.

## Consequences

- Scene selection, schema-generated inspector edits, sprite asset assignment and the 2D viewport share ECS component state.
- Audio assets can be imported and listed but cannot be assigned as sprite textures.
- Assets and scene data are currently in memory; refresh loses edits until T109 adds local project storage.
- Game simulation still uses the temporary browser-preview integration and is not the shared runtime planned for T110.

## Alternatives considered

- Keep the custom `SceneObject[]` as the authoritative model: rejected because it would duplicate the ECS scene state and bypass component schemas.
- Move the physics preview into T107: rejected because it belongs to the shared Play-mode runtime work in T110.
