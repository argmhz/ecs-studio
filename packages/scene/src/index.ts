export { SceneCodec, SceneValidationError, SCENE_FORMAT, SCENE_FORMAT_VERSION } from './codec.ts';
export type { LoadedScene, SceneDocument, SceneMigration, SerializedComponent, SerializedSceneEntity } from './codec.ts';
export { SchemaRegistry } from './registry.ts';
export { defineComponentSchema } from './schema.ts';
export type {
  AssetReference,
  ComponentMigration,
  ComponentSchema,
  DefineComponentSchemaOptions,
  FieldDefinition,
  ValidationIssue,
} from './schema.ts';
export {
  composeAffineTransforms,
  identityAffineTransform,
  identityLocalTransform,
  Parent,
  parentSchema,
  registerBuiltInSceneSchemas,
  SceneHierarchy,
  SceneHierarchyError,
  toAffineTransform,
  Transform2D,
  transform2DSchema,
} from './hierarchy.ts';
export type { AffineTransform2D, ParentData, Transform2DData } from './hierarchy.ts';

export { validateProjectScenes, sceneLoadTarget } from './project-scenes.ts';
export type { ProjectScene, ProjectScenes } from './project-scenes.ts';
