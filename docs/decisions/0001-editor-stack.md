# 0001 — Kandidater til editorens første integration

Status: valg af editorstack afprøvet; React vælges til editorens UI-paneler. Typecheck, produktionsbuild og fokuserede Chromium-checks bestået via Docker.
Dato: 2026-11-01.

## Problem

Vi skal kombinere WebGL, 2D-fysik og en kodeeditor med lokal TypeScript-completion i en Unity/Unreal-inspireret arbejdsgang. ECS og runtime skal forblive uafhængige af editoren. Vi skal også kunne udvide til 3D senere.

## Kandidater og foreløbigt valg

| Område | Kandidater | Foreløbigt valg og konsekvens |
| --- | --- | --- |
| Rendering | Three.js, PixiJS, Babylon.js | Three.js: ortografisk 2D og senere 3D i samme renderer. PixiJS er målrettet 2D og har relevant batching, men ville kræve en særskilt 3D-integration. Babylon.js tilbyder flere engine-funktioner, som overlapper vores egen runtime. Three.js kræver, at vi selv bygger sprite-batching og spilværktøjer. |
| Fysik | Rapier 2D, Matter.js | Rapier 2D: særskilt 2D-pakke og en beslægtet 3D-integration senere. Matter.js er et enklere JavaScript-alternativ til ren 2D. Rapiers WASM-init og bundleomkostning skal måles. |
| Kode | Monaco, CodeMirror | Monaco: TypeScript-sprogservice, completion, diagnostics og hover. CodeMirror er modulær, men projektomfattende TypeScript-hjælp kræver yderligere integration. Monaco indlæses først, når kodefanen åbnes. |
| Editor-UI | React, direkte DOM | React vælges til editorens paneler og tilstandsfulde værktøjer. En isoleret schema-drevet inspector-pilot afprøver typed controls, dynamisk tilføj/fjern og vedvarende foldetilstand. Den eksisterende renderer, canvas og game loop forbliver imperative integrationsflader; UI-frameworket indgår ikke i ECS/runtime eller eksportspil. Plugin-UI kræver fortsat en adapter, så eksisterende DOM-paneler kan monteres. |
| Build | Vite + TypeScript | Lokal bundling af editor, sprogworkers og biblioteker. Ingen runtime-CDN eller ekstern completiontjeneste. |

Three.js, Monaco, React, CodeMirror, PixiJS og Matter.js angiver MIT; Rapier og Babylon.js angiver Apache-2.0. Kontrollér de faktisk installerede pakkers licenser og transitive notices før distribution. Projektets egen MIT-licens er fortsat kun foreslået.

## Afprøvning

`prototypes/editor` er et selvstændigt integrationseksperiment, ikke en implementering af T101 eller T107. Det indeholder:

- Ortografisk WebGL 2-viewport med objekter og udvælgelse.
- Rapier-gravitation og kollision; Play, Pause, Step og Stop.
- Hierarki og inspector med numeriske positionsfelter; Play bruger separate fysikdata, Stop viser redigeringstilstanden igen.
- Monaco indlæst på efterspørgsel, med lokale workers og et håndskrevet eksempel på motorens typedefinitioner.
- Knapper til normal afslutning, fejl og fastlåst worker.

Kodefanen kører ikke gameplaykode. Completion er et API-eksperiment; schemas og generering af projekttyper implementeres senere. Der er ingen projektlagring, ECS, docking, undo/redo eller nodeeditor endnu. Panelets størrelsesændring er kun et layoutforsøg.

## UI-frameworkpilot

`apps/editor/framework-pilot.html` er et isoleret React-eksperiment, som kan åbnes via `/framework-pilot.html`. Det afprøver en inspector med en lokal schema-fixture for number/color/boolean/enum/asset/script-felter, add/remove og collapse-state. Piloten er endnu ikke koblet til editorens `SchemaRegistry` eller ECS-World. En Chromium-test ændrer et felt mens en anden gruppe er foldet, og afprøver tilføjelse/fjernelse af komponent. Typecheck, produktionsbuild og testen består via Docker.

React blev valgt til editorens paneler, fordi pilotens reducer og komponenter lader UI-tilstand følge dataændringer uden manuel DOM-genopbygning og genbinding af events. Pilotens chunk er 227.41 kB rå / 71.04 kB gzip inkl. React, demo-logik og CSS; det er ikke en isoleret måling af Reacts marginale størrelse i den fulde editor. React bør kun eje UI-paneler; WebGL viewport, simulation og Monaco beholder deres eksisterende livscyklus og API'er. Den nuværende editor kører fortsat direkte DOM, så en fuld integration er et efterfølgende migreringsarbejde, og denne pilot ændrer ikke produktionseditorens runtime.

## Bundle og validering

Docker-adgang er nu godkendt. Installation og produktionsbuild er kørt med Node 22. Monacos editor-contributions og TypeScript-tokenizer er indlæst eksplicit, efter en browsercheck afslørede manglende completion-UI. Monaco-target er rettet til ES2020, som den installerede Monaco-version understøtter. Vite er opdateret til 7.3.7 efter npm audit; installationen rapporterer nu 0 kendte sårbarheder. package-lock.json er genereret.

Første buildmåling (decimal kB, ikke loadtid):

| Chunk | Raw kB | Gzip kB |
| --- | ---: | ---: |
| Start-JavaScript inkl. rendering/fysik | 2129.45 | 732.92 |
| Lazy-loaded kodeeditor | 3245.49 | 832.26 |
| TypeScript-worker | 6013.44 | Ikke målt |
| Editor-worker | 231.31 | Ikke målt |

Vite advarer om store chunks. Det er en kendt begrænsning ved prototypen; loadtid, sprite-batching og yderligere opdeling er ikke målt eller optimeret. Valget af endeligt UI-framework udestår.

## Primære kilder

- [Three.js WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer)
- [Three.js repository og licens](https://github.com/mrdoob/three.js)
- [PixiJS renderers](https://pixijs.com/guides/components/renderers/)
- [Babylon.js specifications](https://www.babylonjs.com/specifications/)
- [Rapier: JavaScript-opstart](https://rapier.rs/docs/user_guides/javascript/getting_started_js/)
- [Rapier og licens](https://rapier.rs/docs/)
- [Matter.js](https://github.com/liabru/matter-js)
- [Monaco repository](https://github.com/microsoft/monaco-editor)
- [Monaco ESM/worker-integration](https://github.com/microsoft/monaco-editor/blob/main/docs/integrate-esm.md)
- [CodeMirror completion](https://codemirror.net/examples/autocompletion/)
- [React-komponentmodellen](https://react.dev/learn)
