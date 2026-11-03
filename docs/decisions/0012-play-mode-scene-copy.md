# ADR 0012: Play mode bruger en separat scene-kopi

## Problem

Play mode skal simulere uden at ændre editorens scene. Simulationen skal følge runtime-systemets faste tidssteg, understøtte pause og præcis enkelttrin samt frigive fysikressourcer ved Stop.

## Valg

- Serialisér redigeringsscenen gennem `SceneCodec` og deserialisér den til en separat ECS-World, når Play startes.
- Byg Game-viewets fysikobjekter fra denne kopi. Rapier-stepping registreres som et navngivet system i `Scheduler` og drives af `FixedStepLoop` med 1/60 s, højst seks catch-up-trin pr. animation frame og højst 100 ms accepteret frame-delta.
- Pause kalder runtime-loopens pause; Step kører ét `stepOnce`; Resume fortsætter loopet.
- Stop frigiver Rapier-World, fjerner scheduler/loop-referencer og synkroniserer preview-meshes tilbage til editorens objekter. Editorens World og autosave ændres ikke af Play.
- Den nuværende Game-view bruger fortsat midlertidig Three.js/Rapier-integration. Den er ikke den færdige runtime-renderer- eller fysikadapter.

## Konsekvenser

- Inspectorens sceneværdier og undo/redo-historik er stabile under simulation; simulerede transforms findes kun i Play-kopien.
- Pause, enkelttrin, frame-loft og simulationens tick styres af samme runtime-loop, der kan genbruges af senere browser- og serveradaptere.
- Kopiering gennem sceneformatet validerer komponentdata ved Play-start, men serialiserer hele scenen og har derfor en omkostning, der bør måles på større projekter.
- Rapier-systemet er stadig en preview-integration og endnu ikke den endelige ECS-ejede 2D-fysikmodel i T206.

## Alternativer

- Simulér direkte på editorens World og gem/gendan et snapshot ved Stop: afvist, fordi fejl eller Stop-problemer kunne efterlade redigeringsdata ændret.
- Fortsæt med en løs kopi af et UI-objekt-array: afvist, fordi den ikke validerer eller bevarer ECS-komponentmodellen.
- Byg fysik ind i ECS-kernen: afvist, fordi fysik er en adapter og skal være adskilt fra den renderer- og fysikuafhængige kerne.
