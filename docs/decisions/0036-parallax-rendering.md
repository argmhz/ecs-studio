# 0036: Kamerarelativ parallax og gentagelse af sprites

## Problem

Baggrundslag skal bevæge sig forskelligt fra spilverdenen og kunne gentages uden at forfatteren opretter mange entities. Scene-rendereren og den midlertidige Game-/eksport-adapter har forskellige integrationsflader. Parallax må ikke ændre gemte transforms, hierarki eller fysik.

## Valg

Et valgfrit versionsmærket `engine.parallax2d`-schema med `factorX/Y`, `repeatX/Y` og `originX/Y` er kilde til validering, Inspector, serialisering og script-completion. Komponenten gælder objektets egen Sprite Renderer. Gamle projekter er uændrede og kræver ingen formatmigration.

Fælles DOM-/Three.js-uafhængige funktioner i `@ecs/rendering` beregner en renderposition pr. akse: `world + (camera - origin) * (1 - factor)`. Origin er et eksplicit referencepunkt i verdenskoordinater; der gemmes ikke en skjult startkameraposition. Faktor 0 holder laget fast relativt til kameraets translation, faktor 1 bevarer almindelige verdenskoordinater. Zoom ændrer synligt område og er ikke en del af faktoren.

Gentagelser beregnes ved at projicere viewportens hjørner ind i spritens transformerede gitterbasis. Dermed understøttes skala, rotation og spejling i Scene-rendereren. Kun potentielt synlige kopier tegnes; gentagelser deler entity-ID og materiale/atlasregion. Scene bruger instanced batches; Game bruger genbrugte meshes. Game bruger eksisterende, dekomponerede SceneObjects og bevarer dermed sin hidtidige begrænsning omkring shear/spejling. Atlasregioner samples mellem deres yderste texel-centre uden whole-sheet mipmaps, så gentagelser ikke lækker farver fra naboregioner. Picking følger renderkopierne. Renderkopier har ingen colliders. Der er et sikkerhedsloft på 4096 kopier pr. lag for at undgå at bittesmå sprites blokerer editoren; ved overskridelse vises et begrænset område omkring viewportens centrum.

Game-adapterens `setCamera` opdaterer dens viewkamera. Editorens Scene-kamera og Game-kamera forbliver separate. Scene-rendereren bruger spillets preview-kamera som parallax-reference, mens navigationskameraet alene styrer projektion og synlige gentagelser; zoom omkring musemarkøren flytter derfor ikke baggrunde i forhold til scenens øvrige objekter. Markeringen fastholder den valgte gentagelses gitterindeks. En gameplay-kamera-/follow-komponent og et scriptkamera-API er ikke del af denne ændring.

## Konsekvenser og alternativer

Gemning, undo/redo, prefabs og scripts bruger almindelige komponentdata. Stop gendanner scenen uden at nulstille parallax-transformer, fordi simulationens transforms aldrig ændres. Gentagelse arves ikke gennem hierarkiet og ændrer ikke tilemaps eller UI.

Alternativet var at flytte baggrunden fra scripts hvert update; det ville blande visning med simulation, kræve kameraadgang og kunne give drift. UV-wrapping alene blev fravalgt, fordi atlasregioner ellers kan sample naboregioner. En fuld udskiftning af Game-rendereren med ECS-rendereren er en større separat task.

## Validering

Unit-tests dækker faktorer, origin, store positive/negative kamerapositioner, gentagelsesbasis, refleksion, loft og schema-roundtrip. Browser-pixeltest sammenligner begge renderere med atlasbaserede gentagelser under kamerabevægelse. Editorflow afprøver Inspector, undo/redo, pan, picking, Play/Stop og reload. Showcase- og webeksportflows kontrollerer den delte integration.

Afprøvet via Docker: typecheck og produktionsbuild; 20 rendering-unit-tests; 5/5 WebGL-browserflows og 53/53 Chromium-editorflows. Tilemap-rotationens billedcheck bruger canvas-relative koordinater, så vandret sidescroll ved Stop ikke forveksles med ændrede world-transforms. Game-klicks sorteres efter renderlag, og brush-picking ignorerer parallax-baggrunde.

T335 præciserer adskillelsen af editorens navigationskamera og spillets kamerareference: zoom/pan i Scene bevarer kompositionen. En særskilt unit-test og WebGL-pixeltest afprøver off-center zoom fra 30–140 % ved faktorerne 0, 0,15 og 0,5. Editorflowet kontrollerer, at den valgte gentagelses markering følger zoomankeret uden at skifte kopi. 21 unit-tests, 6 WebGL-flows og 4 fokuserede editorflows består. Showcase-himlen er ensfarvet, så lodret gentagelse ikke skaber gradient-samlinger.
