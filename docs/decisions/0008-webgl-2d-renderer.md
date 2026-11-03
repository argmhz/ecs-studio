# ADR 0008: Three.js WebGL 2 renderer til 2D

- Status: Accepteret
- Dato: 2026-10-31

## Problem

T106 skal tegne sprites fra ECS-scener med ortografisk kamera, stabil sortering, texture batching, resize og håndtering af mistet grafikkontekst. Rendererlaget må ikke afhænge af editor-UI eller ændre ECS-kernens renderer-uafhængighed.

## Valg

`@ecs/rendering` bruger Three.js 0.180.0, som allerede indgår i viewport-afprøvningen. `WebGLRenderer2D` bygger på Three.js WebGL 2 `WebGLRenderer`, `OrthographicCamera` og `InstancedMesh`. Rendereren modtager draw items med scene-global affine transform, asset-ID, størrelse, order og tint; `collectSpriteRenderItems` adapterer scene-komponenter.

Sprites sorteres stigende efter order med stabil scene-rækkefølge ved lighed. Batching grupperer kun sammenhængende sprites med samme asset-ID, så texture-batching ikke ændrer transparent draw order. Hver batch er en instanced draw og genbruger slots, geometry og materialer mellem frames.

`createAssetTextureSource` oversætter asset-database bytes til ImageBitmap/Three texture. Rendererens public API rapporterer pending, missing, unknown og fejlede/ikke-understøttede textures. Asset loaderen lukker ImageBitmap først, når texture disponeres, så texture kan genoprettes efter context restore.

CSS-pixelstørrelse styrer ortografisk view; drawing buffer bruger capped device pixel ratio. Context loss forebygger standard browser-defaultet, pauser draw og bevarer seneste scene; restore markerer textures til upload og tegner scenen igen. `dispose()` ejer observer, GPU-resourcer og event listeners.

## Konsekvenser

- Renderer er en browseradapter i `@ecs/rendering`; core, scene-format og runtime behøver ikke WebGL eller DOM.
- Samme texture i ét sammenhængende sorteret run reducerer draw calls til én instanced draw.
- Forskellige textures eller mellemliggende sprites danner separate batches for at bevare draw order.
- Audio assets ignoreres af sprite renderer med eksplicit unsupported-status; lydkørsel hører til T209.
- Den gamle Three/Rapier viewport er fortsat en prototype indtil editor tasken kobler produkt-rendereren ind.
- 3D bruger en senere renderer-adapter; denne implementering er afgrænset til ortografisk 2D.

## Overvejede alternativer

- PixiJS: afvist til fordel for Three.js, fordi projektet også forventer stiliseret 3D, og Three.js allerede er valgt i viewport-afprøvningen.
- Gruppere alle sprites med samme texture uanset position i sorteringsrækkefølgen: afvist, fordi det kunne ændre alpha-compositing rækkefølgen.
- Oprette separate meshes for hver sprite: afvist, fordi det giver en draw call per sprite og ikke opfylder batching-kriteriet.
