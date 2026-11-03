# ADR 0010: Scene editing and undo history

- Status: accepted
- Date: 2026-10-31

## Context

T108 needs editor actions to operate on stable scene entities and remain reversible across both component edits and structural operations. The editor already has an ECS `World`, scene schemas, stable scene IDs and `SceneCodec`, but no editor command model.

## Decision

The editor records each completed edit as a bounded command containing the serialized scene before and after the action, plus the selection to restore. The history holds up to 100 commands; a new edit after undo clears the redo branch. Inspector changes and each viewport drag are one command. Scene snapshots are restored through `SceneCodec`, rebuilding the runtime `World`, stable-ID map and `SceneHierarchy` together.

The workbench provides Select, Move, Rotate and Scale tools; grid snapping for position, 15-degree rotation and quarter-unit scale increments; Local and Global move orientation; Ctrl/Meta-click and Shift-range hierarchy selection; context actions to create, duplicate, delete and reparent objects; and keyboard shortcuts for tools, duplication, deletion and undo/redo. Structural edits keep the temporary Game preview in sync by rebuilding its browser integration when the stable entity set changes.

## Consequences

- Component changes, viewport drags, duplication, deletion and parent changes can be undone/redone as atomic scene edits.
- History uses JSON scene snapshots, which is simple and reliable for the current editor scale but copies the scene for every recorded edit.
- Selection state is restored with each command; asset bytes remain outside scene history.
- History is in memory and resets on reload; project recovery and persistence remain in T109.
- The browser physics preview tolerates scene entity removal during rebuild and remains a temporary integration until T110.

## Alternatives considered

- Per-component inverse patches: rejected for the first editor version because entity creation, destruction and relationship changes make rollback more error-prone.
- Store every pointer movement as a command: rejected; a complete pointer drag is one user action and should undo in one step.
