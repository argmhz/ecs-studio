# ADR 0018: Runtime-komponenters livscyklus og 2D-fysik

## Status

Accepteret til T206.

## Problem

ECS og script-API'et kan allerede tilføje og fjerne registrerede komponenter under Play. Browser-preview oprettede dog sine Three.js-meshes og Rapier bodies/colliders én gang ved Play-start. Efterfølgende komponentændringer kunne derfor efterlade manglende eller forældede adapterressourcer.

## Valg

- Komponentmedlemskab er dynamisk pr. entity. Script-API'et kan tilføje, opdatere og fjerne komponenter, der har et registreret schema; vilkårlige nye komponenttyper kan ikke oprettes fra et script.
- Play-adapteren afstemmer render- og fysikressourcer med ECS-komponenterne efter scriptkommandoer og før næste faste fysikstep. Fjernelse af en komponent frigiver dens tilhørende GPU-/Rapier-ressourcer. Stop frigiver hele Play-world og bruger fortsat den uændrede redigeringsscene.
- `Physics2D` vælger rigid-body-type og gravity scale. `Collider2D` vælger box/circle-geometri, friktion, restitution, sensorstatus og 16-bit collision group/mask. En entity kan have body uden collider; collider uden `Physics2D` er ikke aktiv i fysikverdenen.
- Fysikken kører med fast tidssteg. Rapier skriver simuleret position/rotation tilbage til `Transform2D` efter hvert step. Scriptændringer til transforms overføres til body før næste step.
- Collider enter/exit sendes efter fysiksteppet som `physics.collision.enter/exit` eller `physics.trigger.enter/exit` med `{ entityId, otherEntityId }`. Scripts modtager dem i næste script-update gennem den eksisterende eventkø.
- Editorens sceneobjekter har altid `Name` og `Transform2D`. Ingen af dem kan fjernes fra Inspector eller via scripts. Ved indlæsning får ældre eller eksterne entities uden `Name` standardværdien `Object`. ECS-kernen kræver ikke disse komponenter for vilkårlige entities uden for editorens scene.
- Andre schema-registrerede komponenter kan tilføjes/fjernes i Inspector og scripts.

## Konsekvenser

- Adaptere ejer fortsat Three.js- og Rapier-objekter; ECS-komponenter ejer kun serialiserbare data.
- Ændringer på Play-kopien påvirker ikke redigeringsscenen og forsvinder ved Stop.
- Physics preview bruger lokale `Transform2D`-koordinater. Understøttelse af rigid bodies under transformerede parents kræver særskilt validering og håndtering.
- Collision-events er forsinket til næste script-update og følger dermed samme eventmodel som script-events.

## Overvejede alternativer

- At begrænse add/remove til editorens edit mode ville stride mod script-API'et og gøre runtime gameplay-adfærd vanskelig.
- At gemme Rapier handles eller Three.js-objekter i ECS-komponenter ville koble sceneformatet til browserintegrationerne.
- At genopbygge hele fysikverdenen efter hver komponentændring ville nulstille kropstilstand og kunne miste kollisionskontinuitet; adapteren afstemmer derfor ressourcer entity for entity.
