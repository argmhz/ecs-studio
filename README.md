# ECS Studio

Browserbaseret ECS-spilmotor under opbygning. Vi sigter mod en Unity/Unreal-inspireret editor, 2D først, kode og visuelle scriptnoder samt senere stiliseret 3D.

**Aktuel status:** T001–T004, T101–T111, T201–T212, T301–T304, T306–T310 og T312–T319 er gennemført; se [PLAN.md](PLAN.md). Browser- og ydelsesmål står i [ADR 0034](docs/decisions/0034-browser-support-and-performance-budgets.md). Prefabs kan gemmes fra et scenehierarki, instansieres, opdateres fra kilden og bevarer lokale komponent-overrides. Scene- og Game-viewet deler kameraopsætning; Game viser sprites, tilemaps og animation uden editor-grid. Scene viser UI-komponenterne som ikke-interaktivt overlay; Game UI forbliver interaktivt. Script Binding vælger projektfiler; Animation- og Tilemap-panelerne redigerer klip, frames, keyframes og tile-varianter visuelt. Play starter kode og nodegraf med fælles action-input for keyboard, mus/touch og gamepad. **Export Web Game** pakker en editorfri player til statisk hosting; se [eksportguiden](docs/web-export.md). Multiplayer-hostens Docker-opskrift står i [multiplayer-guiden](packages/multiplayer/README.md#deployable-host-skeleton); den er separat fra statisk spilhosting. [ECS Studio Showcase](apps/editor/public/showcase.ecsproj) samler komponenter, kode- og nodeeksempler, fysik, tilemap, prefab, atlas, animation, UI og lyd; åbn editoren og tryk **Load Showcase**. Se [komponent-, script- og prefabmanualen](apps/editor/public/manual.html) samt [projektfildeling og migration](docs/project-sharing.md).

## Start med Docker (foretrukket)

Kræver Docker Engine med Compose, Make og adgang til daemonen. Node kører i containeren; værten behøver ikke Node/npm.

```sh
make install

export HOST_UID=$(id -u)
export HOST_GID=$(id -g)
docker compose up node
```

`make install` kører `npm ci` i Node-containeren med din UID/GID og installerer alle workspaces fra lockfilen. Kommandoen starter ikke udviklingsserveren.

Åbn http://localhost:5173. Porten publiceres kun på værtens localhost. Stop med Ctrl+C eller `docker compose down`.

Showcase-projektarkivet er versionsstyret i `apps/editor/public/`. Genopbyg det efter ændringer i scenegeneratoren med `docker compose run --rm node npm run generate:showcase`.

Projektmappen er bind-mounted, så kodeændringer, `node_modules`, lockfil og build-output bevares på værten. Containerne bruger din UID/GID, så filer ikke bliver root-ejede. Første installation kræver netværk. `npm ci` bruger projektets package-lock.json til reproducerbare installationer.

Kør checks efter installationen:

```sh
docker compose run --rm node npm run typecheck
docker compose run --rm node npm run build
docker compose run --rm test
```

ECS-kernens unit tests køres også med Node's indbyggede test runner:

```sh
docker compose run --rm node npm run test:core
docker compose run --rm node npm run test:runtime
docker compose run --rm node npm run test:scene
docker compose run --rm node npm run test:assets
docker compose run --rm node npm run test:rendering
docker compose run --rm node npm run test:scripting
docker compose run --rm node npm run test:editor-unit
docker compose run --rm test npm test
docker compose run --rm test npm run test:renderer-browser
docker compose run --rm test npm run test:browser-matrix
```

Testcontaineren indeholder Chromium, Firefox, WebKit og deres systemafhængigheder. Dens Playwright-version matcher `@playwright/test` i package.json; opdatér begge sammen. Tests bygger først prototypen og starter selv en separat preview-server inde i testcontaineren. Dermed afprøves produktionsbundlet, og Vites udviklingsoptimering kan ikke genindlæse en testside. Browsermatrix og dens kendte WebGL-begrænsning er beskrevet i [ADR 0034](docs/decisions/0034-browser-support-and-performance-budgets.md).

Compose-konfigurationen er valideret, og Node-containeren er kørt med godkendt adgang uden for Codex-sandboxen. Udviklingsserveren svarer med HTTP 200 på port 5173.

## Multiplayer-backend

Deployment sker separat fra statisk spilhosting. Se [multiplayer-hostguiden](packages/multiplayer/README.md#deployable-host-skeleton) for Docker-build, `HOST`/`PORT`-konfiguration, `wss://`-endpoint, health check, single-instance-grænsen og krav om at tilslutte spillets egne autoritative callbacks. Den nuværende host er et deploybart tick/snapshot-skelet; den forbinder ikke automatisk en webeksport til multiplayer.

## Start uden Docker

Kræver Node.js 22.12+ og npm samt en desktopbrowser med WebGL 2.

```sh
npm install
npm run dev
```

Åbn adressen, Vite udskriver. Installationen kræver netværk. Editorens kode, biblioteker og sprogworkers serveres derefter lokalt; ingen CDN eller login bruges.

Afhængighederne er fastlåst i package-lock.json. Vite er opdateret til 7.3.7; seneste installation rapporterede 0 kendte sårbarheder.

## Afprøvning

1. Vælg Player i hierarkiet, og redigér Transform i inspector. Vælg Move/Rotate/Scale eller brug Q/W/E/R; Snap og Local/Global ændrer viewportværktøjerne.
2. Ctrl-/Cmd-klik vælger flere objekter. Højreklik i hierarkiet for at oprette, duplikere, slette eller reparent objekter. Ctrl/Cmd+D duplikerer, Delete sletter, Ctrl/Cmd+Z fortryder og Ctrl/Cmd+Shift+Z gentager.
3. Tryk Play: figurerne skal falde og ramme gulvet i Game-viewet. Pause fryser ticks; Step kører ét fast simulationstrin. Stop frigiver Play-sessionen og bevarer redigeringspositionerne.
4. Åbn Code. Prøv `api.getComponent('engine.` og Ctrl+Space for schema-genereret completion. Opret `.ts` eller `.js`-filer med New File; Find søger på tværs af projektfiler. Filer deler globale declarations og symboler.
5. Vælg Player, sæt Speed i Code-panelets script-properties, og tryk Play. `player.ts` og nodegrafen kører sammen mod Play-kopien; koden kører i en disposable worker, og schema-validerede komponentkommandoer anvendes dér. Pause/Step styrer simulationen, Stop genskaber redigeringsscenen. Fejl og fastlåste scripts stopper Play og åbner kildefilen.
6. Projektet gemmes automatisk lokalt, inklusive scripts og script-properties. Brug Save eller Export øverst; Open Project indlæser `.ecsproj` med scene, assets og kode. New Project opretter et separat lokalt projekt.

Scripting er stadig en prototype: kun `update(api)` er koblet til Play, og globale scripts understøtter endnu ikke import/export-moduler. Sandboxen er forsvar i flere lag, ikke en garanti mod browserfejl eller hukommelsesudtømning. Plugins med editoradgang er betroet kode.

## Checks

```sh
npm run typecheck
npm run build
npx playwright install chromium
npm test
```

Browserchecks dækker Play/pause/enkelttrin, schema- og projekt-wide completion, script autosave/arkiv/migration, TypeScript- og JavaScript-kørsel, fejllokation, timeout/cancellation, sandboxgrænser og Physics Playground-workflowen. Kør `npm test` via Docker for aktuel teststatus. Det er ikke en komplet sikkerhedsgaranti eller visuel, fysisk eller mobil kompatibilitetstest; andre browsere er endnu ikke afprøvet.

Node og browserchecks køres via Docker. Codex skal have godkendt adgang til Docker-daemonen uden for sin sandbox. Buildet advarer om store chunks; de målte størrelser findes i ADR 0001.

## Struktur

- `apps/editor/`: browsereditorens UI, kodeeditor og Vite-app.
- `packages/core/`: renderer-uafhængig ECS-kerne: generationshandles, sparse sets, queries, resources og command buffer.
- `packages/runtime/`: simulation og scheduler; bygges efter ECS-kernen.
- `packages/scene/`: komponentschemas, stabile scene-ID’er, validering og versionsstyret sceneformat.
- `packages/assets/`: billed-/lydimport, stable asset-ID’er, manifest og storage-adapter.
- `packages/rendering/`: Three.js WebGL 2 renderer til 2D-sprites uden editor-UI-afhængigheder.
- `packages/browser-preview/`: browseradapters til rendering, fysik og input, brugt af editorens Game-fane og den separate statiske player-entry.
- `packages/scripting/`: fælles script-API og binding-schema, sandbox/worker-wrapper, command buffer og begrænset deklarativ visual-graph runtime.
- `examples/physics-playground/`: første editor-eksempel. Følg [eksempelguiden](examples/physics-playground/README.md) for at redigere, køre, gemme og genåbne Physics Playground.
- `examples/showcase/`: generator for det redigerbare ECS Studio Showcase-projekt.
- `tests/`: Playwright-browserchecks.
- `docs/decisions/`: valg, alternativer og kendte begrænsninger.

Pakkerne er lokale npm-workspaces. Runtime-schedulerens frame-loop kaldes via `advance(elapsedSeconds)`; en browserintegration kan senere koble den til `requestAnimationFrame`. `@ecs/scene` indeholder ikke editor-UI eller browserafhængigheder.
