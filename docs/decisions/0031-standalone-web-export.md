# ADR 0031: Selvstændig webeksport

## Status

Accepteret.

## Problem

Et redigerbart `.ecsproj`-arkiv afhænger af editoren og kan ikke uploades direkte som et spil. Første webeksport skal kunne hostes som statiske filer ved både roden og en vilkårlig undermappe.

## Valg

Eksporten downloades som en ZIP med `index.html` og `game.js`. Player-runtime bygges separat i en klassisk IIFE-bundle, så den kan indlæses uden ES-modul-CORS fra `file://`. HTML-filen indeholder versionsmærkede spildata, kompileret kode, grafer, atlasser og assetbytes som data-URL'er; eksporten behøver derfor ikke hente scene- eller assetfiler. Editorens UI og Monaco indgår ikke. TypeScript-kode kompileres ved eksport med projektets lokale TypeScript-worker; nodegrafer serialiseres som data og evalueres af den fælles graph-runtime.

Player-runtime registrerer de indbyggede scenekomponenter, sceneformatet, fysik, sprites/atlasser, tilemaps, animation, kode/noder, lyd og spil-UI. Prefab-linkkomponenten er editor-metadata og fjernes fra den eksporterede scene; instansens almindelige sceneobjekter bevares. Scener med runtime-komponenter fra plugins afvises, indtil plugins har et defineret eksportformat.

## Konsekvenser

- ZIP-indholdet kan uploades som to statiske filer eller åbnes direkte lokalt. Eksporten kræver WebGL 2 og Web Audio.
- Indlejrede spildata har formatet `ecs-web-game` version 1. Assetbytes i HTML øger filstørrelsen, men fjerner afhængigheden af server og relative assetstier.
- Webexporten genbruger player-rendering, fysik- og inputadaptere, mens dens browser-bootstrap er en separat player-entry. Plugin-systemer og editor-only data bliver ikke pakket med.
- Browserens supportmatrix fastlægges fortsat i T004; dette valg er afprøvet i desktop Chromium.

## Alternativer

- At pakke `.ecsproj` og bede modtageren åbne det i editoren opfylder ikke kravet om selvstændig hosting.
- At kræve Node/Vite i deployment ville ikke give et uploadklart statisk output.
- At inkludere editorens bundle ville medtage Monaco og hele workbenchens afhængigheder i spillene.
