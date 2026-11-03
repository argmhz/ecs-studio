# ADR 0019: Tilemap-format, rendering og kollisioner

## Status

Accepteret til T207.

## Problem

Tilemaps skal kunne gemmes i den eksisterende versionsmærkede scene, tegnes gennem WebGL-rendereren og omsættes til fysik uden at placere GPU- eller Rapier-objekter i ECS-data.

## Valg

- `Tilemap2D` gemmer gridstørrelse, tile-størrelse, lag og tiledefinitioner som validerede JSON-data. Lag har stabile ID'er, navn, synlighed, kollisionsflag og en celle pr. gridposition. Tiledefinitioner refererer til eksisterende billedassets.
- Første tileset-model bruger ét asset pr. tile. Nabovalg bruger en fire-retningers bitmaske og eksplicitte variant-ID'er pr. tiledefinition. Det giver plads til forskellige hjørne-/kantfliser uden at indføre atlas-UV'er i sprite-rendereren.
- Renderer-integrationen udvider synlige celler til almindelige sprite-items og cacher afkodede tilemapdata mellem ændringer.
- Tile-collisioner bygges som faste Rapier box-colliders for besatte celler i lag markeret som collidable. De syntetiske fysikobjekter findes kun i Play-adapterens sceneobjektliste.
- Pensel, udfyldning, lag og lagindstillinger bruger den eksisterende scene-snapshot undo/redo og projektlagring.

## Konsekvenser

- Tilemaps kan round-trippes gennem sceneformatet og bruge standard asset pipeline og WebGL batcher.
- Første udgave kræver separate billedassets og eksplicit variantmapping; atlasimport og deduplikering af store colliderflader er senere optimeringer.
- Store tætte colliderlag kan oprette mange Rapier-colliders. Mål repræsentative baner, før større maps anbefales.

## Overvejede alternativer

- Atlasregioner ville kræve UV-regioner i render-item-formatet og texture-kilden; den integration er større end T207's første lodrette skive.
- GPU- eller Rapier-handles i ECS-komponenterne ville gøre scener browser-/biblioteksafhængige og bryde sceneformatets serialisering.
