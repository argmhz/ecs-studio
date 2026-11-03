# ADR 0024: Prefab sources and scene instances

## Problem

T301 requires reusable objects with hierarchy, components and scripts, per-instance local overrides, source updates and explicit handling of broken references.

## Decision

Store prefab documents in the project prefab library, with their own stable prefab ID and a versioned scene snapshot rooted at one stable source entity ID. Creating a prefab captures the selected scene object and its descendants. The original scene hierarchy remains editable as the prefab source. Instances receive fresh scene entity IDs and an internal `engine.prefab-instance` link per copied entity; entity references inside component fields are remapped to the instance.

An explicit Update Source action snapshots the original source hierarchy. Update Instances compares each linked component with the instance's saved baseline. Unchanged components follow the source. Changed, added or locally removed components remain local overrides. Overrides are currently component-granular, which is conservative for fields such as transforms and avoids silently discarding local edits. Inspector shows the component-level override list. Removing a prefab source leaves its scene instances intact and Inspector reports a broken reference; restoring the project archive that contains the source repairs the link.

Project archive format 5 stores the prefab library. Older project archives migrate with an empty library. Prefab IDs and referenced scene roots are validated during project import.

## Consequences

- Prefabs preserve nested hierarchy, registered components and script bindings.
- Instantiation and applying source updates to instances are undoable scene edits. Updating the prefab library itself is autosaved but not part of scene undo history.
- A source update does not currently add or remove linked child entities, nor does it expose field-level override revert controls. Overrides cover whole components.
- Prefab sources are snapshots of a selected scene hierarchy rather than separate prefab-editing scenes.
- Project removal/reimport makes missing sources visible without deleting instances.

## Alternatives considered

- Store prefab files as ordinary asset records: rejected because project archives currently treat assets as imported binary data and prefab JSON needs schema validation.
- Apply source changes blindly: rejected because a prefab update could erase instance edits.
- Track per-field diffs immediately: deferred; component-level overrides are simpler and make preservation behavior explicit.
