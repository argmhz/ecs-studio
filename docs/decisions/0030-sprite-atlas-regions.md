# ADR 0030: Sprite- og tilesheet-atlasser

## Status

Accepteret til T318.

## Problem

Sprites og tiles bruger hele billedassets. Et sheets billede skal kunne defineres én gang og genbruges som sprites, animationsframes og tiles uden at kopiere eller transkode billedet.

## Valg

- Projektet gemmer versionsmærkede atlasdefinitioner med stabilt atlas-ID, kildeasset-ID og navngivne regioner. Regionerne gemmer pixelrektangel og pivot; regioner adresseres fra scene-data med atlas-ID og region-ID.
- Atlas-editoren kan dele billedet på et cellegrid, herunder mindre restceller ved billedets kanter, og markere eller redigere rektangler manuelt.
- Sprite Renderer, animationsframes og tiledefinitioner kan referere til en region. Eksisterende fuldbilledreferencer svarer fortsat til `region: null`.
- WebGL-render-items opløser regionreferencer til UV-rektangler. Batches med forskellig region bruger samme kildebillede, men separat texture-transform; renderer- og GPU-objekter forbliver uden for ECS-data.
- Projektformat v6 gemmer atlasmetadata. Ældre projektformater migrerer til en tom atlasliste, og Sprite Renderer schema v1 migrerer til fuldbilledtilstand.

## Konsekvenser

- Regionnavne og ID'er kan genbruges på tværs af animation, tilemap og almindelige sprites; ændres regionens rektangel, følger alle referencer automatisk med.
- Renderbatches deles ikke på tværs af forskellige regioner af samme billede i første implementering.
- Pivot gemmes i atlasdata. Første version anvender centerpivot for sprites og lader regionens eksisterende scene-transform være uændret.
- Atlasmetadata eksporteres sammen med projektet og afhænger af kildebilledassetets stabile ID.

## Overvejede alternativer

- Generere et nyt PNG-asset for hver beskæring: afvist, fordi det duplikerer billeddata og mister forbindelsen til kilden.
- Kopiere pixelrektangler ind i hver frame og tile: afvist, fordi atlasændringer så giver forældede kopier.
