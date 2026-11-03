# ADR 0023: DOM-overlay til spillets 2D-UI

Status: Accepteret til T210

## Problem

Spil har brug for skalerbar tekst, billeder og trykbare knapper, som kan redigeres med samme schema-/scene-workflow som andre komponenter. Den eksisterende WebGL-renderer er spriteorienteret, og UI-knapper skal også fungere med tastatur, pointer og touch.

## Valg

UI-data og ankerlayout ligger i det DOM-uafhængige workspace-package `@ecs/ui`: `UiCanvas`, `UiText`, `UiImage` og `UiButton`. Browser-preview ejer et DOM-overlay over Game-viewets WebGL-canvas. Canvasens referenceopløsning skaleres med `fit` eller `stretch`; hvert element har normaliserede min/max-ankre og referenceopløsnings-offsets. Knapper udsender det fælles script-event `ui.button.clicked` med `{ entityId }`.

## Konsekvenser

- DOM-knapper får browserens keyboard-, touch- og accessibility-adfærd; UI-data bliver fortsat serialiserede ECS-komponenter og scripts ser ingen DOM-objekter.
- Layout kan testes uden browser og genbruges af editor-preview og runtime.
- Første udgave har ikke UI-rotation, clipping-grupper, layout-flow eller rendererens draw-order integration. Fit giver letterboxing, mens stretch kan ændre elementernes proportioner.

## Alternativer

- Tegne alle UI-elementer i WebGL ville kræve tekstatlas/font- og input-hit-test-systemer.
- HTML som projektformat ville koble sceneindhold til browsermarkup og gøre schema-baseret Inspector-redigering sværere.
