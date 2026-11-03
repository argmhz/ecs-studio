# ADR 0005: Komponentschemas og sceneformat

- Status: Accepteret
- Dato: 2026-10-31

## Problem

Editor, scene persistence og senere scripting skal dele komponenternes felter og validering. ECS-kernen skal fortsat være uafhængig af serialisering og editor-UI, og scene-/assetidentiteter må ikke afhænge af genbrugelige runtime entity-indexes.

## Valg

En separat `@ecs/scene`-pakke afhænger af `@ecs/core`. Den registrerer `ComponentSchema` med stabilt `typeId`, display name, version, component-token og feltmetadata. Første feltformer er tal, tekst, boolean og assetreference; metadata kan bruges direkte af inspector-UI. Schemas validerer både scene-load og scene-save.

Sceneformatet er JSON med `format: "ecs-scene"`, heltals `version`, stabilt `sceneId` og entities med stabile ID-strenge. Komponentdata gemmes med schema-version. `SceneCodec` modtager et eksplicit map fra stable scene-ID til runtime-entity; save fejler, hvis en levende entity mangler stabilt ID eller er fra en anden verden. Assetfelter refererer til `assetId`, ikke filsti eller runtime-handle.

Sceneformatmigrationer registreres versionsvis på codec'en. Komponentmigrationer registreres på schemaet og transformerer data fra version N til N+1 før validering. Ukendt format, schema, felt, dublet-ID, manglende migration og ugyldige værdier afvises med sti og forklaring. Load validerer hele dokumentet før en ny World oprettes.

## Konsekvenser

- ECS-kernen beholder kun runtimeidentiteter og lagring; schema- og persistensafhængigheder bliver i en adapterpakke.
- Inspector og scenevalidator kan læse de samme feltdefinitioner.
- Stable scene-ID'er overlever reloads selv om runtime handles ændrer generation eller index.
- Assets kan flyttes uden at ændre scene, når asset pipeline senere bevarer `assetId`.
- Ukendte plugin-komponenter stopper load med en præcis fejl; tolerant bevaring af ukendte payloads er ikke del af første format.
- Første schemafeltformer er bevidst små. Arrays, nested schemas og entity references tilføjes, når konkrete komponenter kræver dem.

## Overvejede alternativer

- Lægge schemas og JSON i `@ecs/core`: afvist, fordi core dermed får serialisering/editoransvar.
- Gemme runtime index/generation som scene-ID: afvist, fordi handles er World-lokale og genbrugelige.
- Acceptere ukendte felter og komponenter stiltiende: afvist, fordi data ellers kan gå tabt ved gemning uden at brugeren ser det.
