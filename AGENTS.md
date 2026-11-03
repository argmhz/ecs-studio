# Arbejdsregler for ECS-spilmotoren

Disse instruktioner gælder hele repositoryet. Produktbeslutninger, milepæle og tasks findes i [PLAN.md](PLAN.md).

## Produkt og scope

- Byg en browserbaseret spilmotor til både begyndere og udviklere.
- Første udgivelse er en bred 2D-motor med visuel editor. Arkitekturen skal kunne udvides til stiliseret 3D.
- Både TypeScript/JavaScript og visuelle scriptnoder indgår i første udgivelse.
- Editor bruges på computer; eksporterede spil skal understøtte computer og mobil.
- Projekter gemmes lokalt uden obligatorisk konto. Understøt både selvstændig webeksport og publicering via brugerens hosting.
- Brug eksisterende biblioteker til rendering og fysik; byg egen ECS, editor og integration. WebGL er et krav.
- Open source er målet, med MIT som foreslået licens. Dette er ikke en instruktion om at offentliggøre repositoryet.

## Editoroplevelse

- Følg Unity/Unreal-inspirerede arbejdsgange med hierarki, viewport, inspector, assets, konsol og Play/Pause/Step.
- Vis objekter, komponenter og prefabs i almindelig UI; kræv ikke ECS-kendskab af begyndere.
- Kodeeditoren skal have lokal syntax highlighting, TypeScript/JavaScript-completion og diagnostics. Projektets schemas skal være kilde til API-typer og inspector-felter.
- Sproganalyse kører adskilt fra UI og fra gameplay-scripts. Kodeændringer anvendes først ved næste Play i den første udgave.
- UI og API-navne er engelske. Prototyper skal tydeligt skelnes fra færdige produktfunktioner.

## Arkitektur

- Brug TypeScript som primært implementeringssprog. Vælg konkrete biblioteker efter en kort teknisk afprøvning og dokumentér valget.
- Hold ECS-kernen uafhængig af DOM, UI-framework, renderer og fysikbibliotek.
- Start med sparse-set storage, entity-ID'er med generationer, queries og en command buffer til strukturelle ændringer. I T101 er query-resultater snapshots, og command-buffer playback er sekventiel uden rollback; se docs/decisions/0003-ecs-core.md.
- Brug eksplicit systemrækkefølge og et fast simulationstidssteg. Rendering følger requestAnimationFrame med interpolation og begrænset indhentning efter inaktive faner.
- Del runtime mellem editorens Play mode, eksporterede spil og en server uden rendering. Browser- og serverfunktioner tilsluttes via adaptere.
- Hold editoren separat fra runtime. Editorens UI må ikke blive en afhængighed i eksporterede spil.
- Play mode bruger en kopi af scenen. Stop gendanner redigeringstilstanden.
- Komponenter indeholder data og assetreferencer; DOM- og GPU-objekter ejes af integrationerne.
- Brug fælles schemas til komponenters validering, serialisering, inspector og scriptfelter.
- Brug stabile ID'er til assets, scenes og prefabs samt eksplicitte formatversioner og migrationer.
- Understøt hierarki og lokale transforms. Del relevante transformbegreber mellem 2D og 3D, men hold 2D- og 3D-fysik adskilt.
- Kode og noder deler API, events og variabler. Lov ikke automatisk konvertering mellem vilkårlig kode og noder.
- Design scriptkørsel, så fejl og uendelige løkker kan stoppes uden at miste editorarbejde. Afprøv isoleringsmodellen tidligt.
- Multiplayer bruger en autoritativ server til private rum med 2–8 spillere. Antag ikke deterministisk fysik på tværs af platforme.
- Plugins får et defineret, versionsmærket API. Intern motoradgang er ikke en stabil offentlig kontrakt.

## Arbejdsgang

- Læs PLAN.md før større arbejde, og vælg en afgrænset task med opfyldte afhængigheder.
- Hold taskstatus opdateret. Markér først en task færdig, når dens acceptkriterier er opfyldt og relevant validering er kørt.
- Registrér væsentlige arkitekturvalg i docs/decisions/ med problem, valg, konsekvenser og alternativer. Opret mappen ved første beslutning.
- Byg et lille eksempelspil undervejs til at afprøve samspillet mellem værktøjerne. Det ændrer ikke scope for første udgivelse.
- Undgå at tilføje senere milepæles funktioner til en aktuel task uden en konkret afhængighed.
- Bevar brugerændringer, og hold ændringer fokuserede. Tilføj ingen hemmeligheder eller hostingcredentials til projektfiler eller repositoryet.
- Dokumentér opsætning og kommandoer, når de findes; skriv ikke instruktioner til værktøjer, som endnu ikke er valgt.
- Brug dansk til projektplan og dialog. Brug engelske navne i kode og API'er.

## Validering

- Test meningsfulde invariants: entity-generationer, query-resultater, strukturelle ændringer, scene-roundtrips, migrationer og undo/redo.
- Test integrationer, hvor runtime, editor, scripts og assets mødes.
- Verificér, at eksport kan køre uden editoren, og at serveren kan køre uden DOM eller GPU.
- Afprøv input og rendering i relevante desktop- og mobilbrowsere. Dokumentér den faktisk testede supportmatrix.
- Mål repræsentative scener før optimering. Indfør ikke WASM, workers eller ny ECS-storage alene ud fra antagelser om hastighed; workers kan dog være nødvendige for scriptisolering.
- Kør relevante typechecks, tests og builds for ændringen. Rapportér begrænsninger ærligt, hvis et check ikke kan køres.

## Uden for første udgivelse

Stiliseret 3D-editor, 3D-terræn og -fysik, ødelæggeligt 2D-terræn, skeletanimation, visuel animations-state-machine, samtidig redigering, egen hostingplatform og udskiftning af motorens kerne gennem plugins.
