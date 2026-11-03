# ADR 0006: Hierarki og 2D transforms

- Status: Accepteret
- Dato: 2026-10-31

## Problem

Scener skal have parent/child-struktur, lokale transforms og beregnede globale transforms. Hierarkiet skal kunne gemmes uden runtime entity-handles, kunne bruges i editor og server-runtime og afvise cykler. Transformbegreberne skal kunne udvides til en senere 3D-model.

## Valg

`@ecs/scene` tilbyder indbyggede `Parent` og `Transform2D` komponenter med schemas. Parent gemmer stable scene entity-ID, og roden har ingen Parent-komponent. `SceneHierarchy` modtager en World og et stable-ID-map; samme map bruges ved scene load/save. Reparenting validerer begge entities og hele den nye forældrelinje før ændring. Den beholder barnets lokale transform; world-space-preservation ligger uden for denne API.

`Transform2D` består af position (x/y), rotation i radianer og skala (x/y). Global transform beregnes som en 2D affine matrix og bevarer shear ved kombinationer af rotation og ikke-uniform skala. Manglende local transform betyder identitetstransform. Hierarkiet beregnes ved opslag og caches ikke i komponentdata.

Parent-relationer deklareres i schemafeltmetadata. Scene codec validerer, at alle refererede entities findes, og at parent-grafen er acyklisk, både ved load og save. Dette lader fremtidige entity-referencefelter få samme dangling-referencekontrol.

Hierarkiets stabile-ID-graf og lokale position/rotation/skala begreber genbruges ved senere 3D-udvidelse; 3D får sin egen transformkomponent og 4x4 matrixberegning.

## Konsekvenser

- Hierarki og transforms kan bruges uden DOM, renderer eller editor.
- Persistente parent-links overlever ændringer i runtime entity-index/generation.
- Transformberegning er O(depth) pr. opslag og har ingen invalidation/cache-protokol endnu.
- Reparenting beholder lokal transform, så global position kan ændre sig.
- Matricer er renderer-neutrale; rendering oversætter dem til sin GPU-repræsentation.

## Overvejede alternativer

- Gemme runtime handles i Parent: afvist, fordi handles kun er gyldige i én World.
- Blande parent/child-arrays i både parent og child: afvist, fordi redundante links kan blive inkonsistente.
- Cache globale transforms allerede nu: afvist, indtil sceneprofiler viser, at gentagne beregninger er en flaskehals.
- Flattene global transform til position/rotation/skala: afvist, fordi komposition med ikke-uniform skala og rotation kan skabe shear.
