# ADR 0017: platformuafhængige input actions

## Problem

Scripts skal bruge ens input, uanset om det kommer fra keyboard, mus, touch eller gamepad. ECS-kernen og scripting-API'et må ikke modtage DOM-events eller browserobjekter. Fokus og pointermål skal samtidig følge Game-viewets canvas.

## Valg

`@ecs/runtime` ejer DOM-uafhængig `InputActionMap`, actiondefinitioner og input snapshots. Browser-preview adapteren oversætter browserhændelser og `navigator.getGamepads()` til rå samples. Play leverer et JSON-kopieret snapshot til både kode og nodegraf ved hvert script-update.

Standardhandlingerne er `moveX`, `moveY`, `jump` og `interact`. Tastatur, pointerknapper, gamepadknapper og gamepadaxes kan bindes til brugerdefinerede actions via samme action-map. Flere bindings summeres og clampes til `[-1, 1]`; axis deadzone er som standard `0.15`. Hvert action angiver også `pressed`, `justPressed` og `justReleased`.

Game-viewets canvas tager tastaturfokus ved Play og ved pointerinteraktion. Keyboard og gamepad læses kun mens canvas har fokus; blur og skjult browserfane rydder holdte knapper. Gamepad forbindelsesstatus poll'es under input sampling, så frakoblede enheder frigiver actions ved næste sample. Mus og touch bruger Pointer Events. Pointerposition sendes i canvas-normaliserede koordinater fra `-1` til `1`, med Y opad og en separat `inside`-markering.

## Konsekvenser

- Kodescript og nodegraf får samme input snapshot uden direkte browseradgang.
- Renderingens CSS-størrelse skaleres korrekt til pointerkoordinater.
- Input læses kun i Game-view, så tastaturgenveje i editoren ikke aktiverer spillets actions.
- Standardbindings er fastlagt i prototypen; en visuel bindingseditor og projektbaseret input-map-konfiguration er senere arbejde.
- Input samples følger script-update-rytmen. Tastetryk, der både starter og slutter mellem to samples, kan ikke repræsenteres som en separat edge.

## Alternativer

- At sende DOM-events ind i scripts ville binde spilindhold til browseren og lække mutable host-objekter.
- At læse rå `KeyboardEvent.code` og gamepad-indices direkte i scripts ville tvinge gameplaykode til at implementere bindinger og platformforskelle.
- At bruge rå CSS-pixels til pointerposition ville gøre gameplay afhængigt af vinduesstørrelse og device scale.
