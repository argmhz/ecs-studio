# ADR 0011: Lokal projektlagring

## Problem

T109 skal lade brugeren oprette, gemme og genåbne projekter uden konto. Scener skal kunne gendannes efter en afbrudt editor-session, og et projekt skal kunne flyttes mellem browsere eller computere sammen med sine assets.

## Valg

- Gem hver scenes versionsmærkede `SceneDocument` i IndexedDB under et stabilt lokalt projekt-ID.
- Genbrug `AssetStore`-abstraktionen fra `@ecs/assets`; IndexedDB-adapteren gemmer manifest og bytes separat og nøglede pr. projekt.
- Autosave scenen efter redigering og tilbyd eksplicit Save. Status vises som `Unsaved changes`, `Saving…` eller `Saved`.
- Eksportér et versionsmærket `.ecsproj` JSON-arkiv med scene, assetmanifestmetadata og base64-kodede assetbytes. Import validerer arkiv, scene og manifest, før projektet åbnes.
- Brug browserens download-upload-flow som overførbar fallback; afhængighed af File System Access API eller en hostingkonto undgås.

## Konsekvenser

- Projekter er private for browserprofilen, indtil brugeren eksporterer en arkivfil.
- IndexedDB-skrivning og assetbytes deles ikke i én tværgående transaktion; arkivimport opretter et nyt projekt-ID, så en ufuldstændig import ikke overskriver det aktive projekt.
- Arkivformatet har eksplicit formatversion og kan senere få migrationer. Første version bruger JSON/base64, som er enkel at inspicere, men større end binære arkiver.
- Autosave debouncer korte redigeringsserier. For at minimere tab ved lukning udføres den almindelige autosave hurtigt efter en sceneændring; brugeren kan også gemme manuelt.

## Alternativer

- Kun `localStorage`: afvist, fordi scene- og assetbytes er større end egnet til denne key-value-lagring.
- Direkte File System Access API som primær lagring: afvist, fordi browserstøtte og tilladelser varierer; download/import virker bredere.
- Gem hele projektet i én stor IndexedDB-post: afvist, fordi assetpipeline allerede bruger en adapter med manifest og separate assetbytes.
