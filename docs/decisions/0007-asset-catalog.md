# ADR 0007: Asset catalog and stable references

- Status: Accepteret
- Dato: 2026-10-31

## Problem

Images and audio need to be imported, reloaded and referenced by scenes. Renaming or moving an asset in the project should not break scene references, and a missing file must be distinguishable from an unknown ID. The pipeline must remain independent of browser APIs and renderer objects.

## Valg

`@ecs/assets` stores metadata in a versioned JSON manifest and delegates persistence to `AssetStore`. Binary data is addressed by stable `assetId`; project-relative `path` and display name are catalog metadata. `moveAsset` updates the path while preserving the ID and binary key. Reimport at the same path preserves the ID and increments its revision.

The importer accepts PNG, JPEG, WebP, GIF, MP3, WAV, Ogg, M4A, AAC and WebM. It checks relative paths, extension/MIME agreement, non-empty bytes and recognizable media signatures. It does not transcode or decode media. `resolveAsset` distinguishes an available file, a manifest record with missing bytes, and an unknown reference.

The package includes `MemoryAssetStore` for tests and temporary previews. A persistent project-storage adapter is connected with local project storage; the asset API does not assume IndexedDB or direct directory access.

## Konsekvenser

- Scene asset references remain stable across path changes because they store only `assetId`.
- The editor can present missing catalog files and unknown references as separate errors.
- Asset records are reloadable from a manifest and any adapter that implements `AssetStore`.
- Decoding, thumbnails, texture/audio conversion, dependency collection and browser resource lifetime belong to later renderer/editor integrations.
- The test memory adapter proves catalog reload semantics but does not persist across page or process reloads.

## Overvejede alternativer

- Store project paths directly in scenes: afvist, fordi flytning så bryder referencer.
- Putte browser File, ImageBitmap eller AudioBuffer objects i ECS-komponenter: afvist, fordi de ikke er stabile serialiserbare værdier.
- Vælge IndexedDB eller File System Access API før projektlagring er afprøvet: afvist, fordi den lokale projektadapter skal fastlægges i T109.
