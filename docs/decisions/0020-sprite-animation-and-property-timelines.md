# ADR 0020: Spriteanimation og property-tidslinjer

## Status

Accepteret til T208.

## Problem

Spriteframes og tidsbaserede property-ændringer skal kunne gemmes i scener, redigeres i editoren og afspilles på Play-kopien. Scripts og fysik kan samtidig skrive til de samme komponenter.

## Valg

- `SpriteAnimation2D` gemmer klip og tracks som validerede, versionsmærkede scene-komponentdata. Klip indeholder varighed, loopvalg, assetreferencer med framevarighed og property-tracks med sorterede keyframes.
- Tracks adresserer et felt via schemaets stabile component type ID og feltets navn. Numeriske værdier interpoleres lineært; farver, enums, tekst og boolean-værdier skifter trinvist mellem keys.
- Editorens Animation-panel opretter/fjerner klip, tilføjer spriteframes og keyframes, redigerer varighed/loop/autoplay og gemmer ændringer gennem scenehistorik og projektlagring.
- Play holder playhead-state uden for ECS-data og afspiller den kopierede scene. Scripts kører først, animation skriver bagefter til sine keyede felter, og fysik skriver transforms efterfølgende. Derfor vinder animation over script for keyede felter, mens Rapier fortsat ejer transforms på aktive fysikobjekter.
- Browser-preview opdaterer tekstur på mesh, når script eller animation ændrer sprite-assetreferencen. Rendererressourcer bliver i preview-adapteren.

## Konsekvenser

- Ingen afspilningsposition eller GPU-reference skrives til projektfilen; Stop kasserer playhead og sceneændringer.
- Tracks er schema-validerede ved anvendelse. En ugyldig værdi stopper Play med en konkret component-/field-fejl frem for at lække ugyldige data videre.
- Kun direkte felter i registrerede schemas kan tracks; vilkårlige nested object paths er ikke en del af første format.

## Overvejede alternativer

- At lade scripts og animation konkurrere efter rækkefølgen af tilfældige writes ville gøre resultatet ustabilt; rækkefølgen er derfor eksplicit.
- At gemme runtime-playhead i sceneformatet ville gøre redigeringstilstanden afhængig af tidspunktet for seneste Play.
