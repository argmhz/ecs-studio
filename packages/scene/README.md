# @ecs/scene

Scene-format, stable entity IDs, component schemas and validation. Component schemas pair an ECS component token with field metadata for the inspector and validation rules for scene data. Scene files use explicit scene and per-component versions; migrations run one version at a time.

Field types drive inspector controls and validation: `number`, `string`, `boolean`, `color` (`#RRGGBB`), `enum` (a default and allowed `options`), `asset`, and `entity`. For example, a color field gets a native color picker and an enum gets a select control; invalid values are rejected by the same schema used to persist the scene.

The package depends on `@ecs/core`, but the ECS core does not depend on scenes, schemas, the editor or browser APIs.

```ts
import { defineComponent, World } from '@ecs/core';
import { defineComponentSchema, SceneCodec, SchemaRegistry } from '@ecs/scene';

const Position = defineComponent<{ x: number; y: number }>('Position');
const positionSchema = defineComponentSchema({
  typeId: 'engine.position',
  displayName: 'Position',
  version: 1,
  component: Position,
  fields: {
    x: { type: 'number', label: 'X', default: 0 },
    y: { type: 'number', label: 'Y', default: 0 },
  },
});
const schemas = new SchemaRegistry();
schemas.register(positionSchema);
const codec = new SceneCodec(schemas);
const world = new World();
const entity = world.createEntity();
world.addComponent(entity, Position, { x: 10, y: 20 });

const saved = codec.stringify(world, new Map([['entity:player', entity]]), 'scene:main');
const loaded = codec.deserialize(saved);
```

Stable IDs are owned by the project/editor layer and must be supplied on save. This keeps runtime entity indexes out of persisted files.

Register the built-in transform and parent schemas to expose them to scene validation and inspector UI. `SceneHierarchy` operates on the same `World` and stable ID map used by `SceneCodec`:

```ts
import { registerBuiltInSceneSchemas, SceneHierarchy, SchemaRegistry } from '@ecs/scene';

const schemas = new SchemaRegistry();
registerBuiltInSceneSchemas(schemas);
const hierarchy = new SceneHierarchy(world, entityIds);
hierarchy.setLocalTransform('entity:player', {
  x: 20, y: 12, rotation: 0, scaleX: 1, scaleY: 1,
});
hierarchy.setParent('entity:player', 'entity:root');
const worldTransform = hierarchy.getGlobalTransform('entity:player');
```

Reparenting keeps the local transform, and parent links are saved as stable entity IDs. Global 2D transforms are affine matrices, so rotated non-uniform scales compose without losing shear.
