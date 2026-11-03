# ADR 0027: Versionsmærket editor-plugin-API

## Problem

Plugins skal kunne udvide editoren med komponenter, scriptdefinitioner, asset-importere og egne paneler. Registreringer skal kunne fjernes samlet, så genindlæsning ikke efterlader dobbelte schemas eller UI-elementer. Plugins kan påvirke projektdata, så deres tillidsgrænse skal være tydelig.

## Valg

Første udgave bruger en versionsmærket TypeScript-API (`1.0.0`) med eksplicitte registreringsfunktioner. Plugin-modulet leverer et manifest og en `setup(api)`-funktion. Host registrerer hvert bidrag og beholder en disposer; fejl under setup ruller allerede registrerede bidrag tilbage. Plugin-version og engine-API-version er separate.

Editoren kører plugins som betroet kode i samme browser-origin som projektet. API-versionen og registreringsfladen giver kompatibilitet, ikke sikkerhedsisolering. Gameplay-scripts bruger fortsat deres separate sandbox. Et plugin kan ikke aflades, hvis dets komponenter stadig findes på scene-entities, så sceneformatet ikke mister schemaet til data, der er i brug.

Den første demo-plugin er bundlet med editoren og indlæses eksplicit via `Load Example Plugin`. Den afprøver alle fire registreringstyper og unload. Eksterne plugin-pakker, tilladelsesdialoger, sandboxing og installation fra netværk er ikke del af denne task.

## Konsekvenser

- Plugin-manifester afviser inkompatibel API-version og dublerede ID'er.
- Components bruger det eksisterende schema-registry og kan derfor vises og redigeres i Inspector.
- Importere får kun den eksplicitte `importFile`-funktion gennem importer-konteksten.
- Editorpaneler monteres i egne workbench-tabs og afmonteres ved unload.
- Plugin-kode har stadig samme privilegier som editoren; brugeren må kun indlæse plugins, de stoler på.
- Eksterne plugins kræver senere et distribueret format, permissions/consent-flow og kompatibilitetspolitik.

## Alternativer

- **Kør plugins i samme sandbox som gameplay scripts:** afvist, fordi DOM-baserede editorpaneler og asset-import har brug for UI-integration; det ville heller ikke give en robust sikkerhedsgrænse for UI-adgang.
- **Tillad vilkårlige editorinterne imports:** afvist, fordi intern struktur så bliver uofficiel, men nødvendig API.
- **Lad registreringer blive hængende efter unload:** afvist, fordi det forvirrer lifecycle og gør genindlæsning skrøbelig.
