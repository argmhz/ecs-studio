# @ecs/assets

Browser- and renderer-independent asset catalog for PNG, JPEG, WebP, GIF, MP3, WAV, Ogg, M4A, AAC and WebM files. Imports check the declared media type against the file extension and recognizable file signature. Assets have stable IDs that are independent of their project path. `AssetStore` provides the persistence adapter; the included `MemoryAssetStore` is for previews, tests and temporary projects. Project-backed persistence is connected by the project storage task.

Import a `File` or byte buffer with a project-relative path. Reimporting at the same path keeps its ID; `moveAsset` changes the path without changing the ID. `resolveAsset` reports unknown references separately from catalog entries whose file data is missing. File bytes are stored under asset ID, so project path changes do not move the underlying payload or break scene references.

Audio records can be previewed from the editor's Assets panel and assigned to an `AudioSource2D` component. The editor's Audio Mixer exposes Master, Music and Effects gain groups. Browser playback is unlocked from the user's Play click or asset-preview click; exported-game wiring is part of T304.
