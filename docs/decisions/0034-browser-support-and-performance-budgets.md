# ADR 0034: Browsermatrix og ydelsesmål

Status: mål fastlagt; matrix-smoketest og renderer-stressprofil bestået med dokumenterede runnerbegrænsninger.
Dato: 2026-11-01.

## Problem

Editoren kræver WebGL 2, lokal projektlagring og en stabil desktop-workflow. Eksporterede spil skal også kunne køre på mobil. Der mangler en afgrænset supportmatrix, repræsentative testscener og budgetter, som kan måles før udgivelse. Browserens WebGL-muligheder afhænger både af browser og GPU, så browsernavn alene garanterer ikke en fungerende kontekst ([MDN: WebGL](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API)).

## Valg: supportmatrix

| Produkt | Målplatforme | Første udgivelsespolitik |
| --- | --- | --- |
| Editor | Desktop Chrome, Edge, Firefox og Safari | Seneste stabile hovedversion samt den foregående stabile hovedversion. Minimum 1280×720, mus/keyboard, WebGL 2 og IndexedDB. Mobil-editor understøttes ikke. |
| Eksporteret spil | Desktop Chrome, Edge, Firefox og Safari; Chrome på Android; Safari på iOS | Seneste stabile og foregående stabile browser-/OS-hovedversion. Spillet kræver WebGL 2; Web Audio låses op efter brugerinput. Touch-input er en del af mobilmålet. |
| Udenfor matrixen | Internet Explorer, forældede browserudgaver og indlejrede WebViews | Ingen supportgaranti i første udgivelse. |

CI bruger Playwrights Chromium, Firefox og WebKit-projekter. Playwrights WebKit-build følger WebKit-kildekode og er ikke Apple Safari; branded Chrome/Edge og faktiske Safari-versioner kræver separate release-checks ([Playwright: browsers](https://playwright.dev/docs/browsers)). Den lokale Chromium, Firefox- og WebKit-matrix tester IndexedDB-redigering/gendannelse. WebGL 2 og Play testes i Chromium og WebKit på Linux. Firefox’ Linux-headless runner kan ikke oprette WebGL 2 selv med `webgl.force-enabled`; den renderingstest er derfor eksplicit sprunget over. En GPU-backed Firefox-runner skal bestå før release. Eksportens gameplayflow er fortsat kun testet i Chromium; matrixdækning af eksporterede spil hører til T311. Resultaterne her beskriver faktisk afprøvet support, ikke fuld hardwarecertificering.

Før release valideres desuden faktisk Chrome og Edge på desktop, Firefox med GPU-backed WebGL, Safari på macOS samt Chrome på Android og Safari på iOS. Mobiltest i Playwright-emulering erstatter ikke en fysisk telefon.

## Valg: scener og ydelsesbudgetter

| Måling | Mål | Fast testprofil |
| --- | --- | --- |
| Editorens første brugbare visning | Median ≤5 s, p95 ≤8 s fra navigation til aktiv Play-knap og første viewport-frame | Desktop-referenceprofil, kold cache, 10 Mbit/s og 40 ms RTT, 10 gentagelser |
| Editorens indledende JS | ≤850 KiB gzip; CSS ≤25 KiB gzip | Produktionsbuild, initiale editor-chunks |
| Kodeeditorens lazy-load | ≤900 KiB gzip for editor-JS og -CSS | Åbn Code-fanen efter editorens første visning |
| Webspil-runtime | ≤800 KiB gzip for `game.js` | Produktionsbuild uden project data/assets, som indlejres separat |
| Desktop frame time | p95 ≤16,7 ms ved 60 Hz | Reference desktop: 4 CPU-kerner, 16 GiB RAM, integreret GPU, 1920×1080, DPR 1–2 |
| Mobil frame time | p95 ≤33,3 ms ved mindst 30 Hz | Fysisk mellemklasse-Android og iPhone-generation fra ca. 2022 eller nyere; rapportér enheder og OS-version |
| Projektarkiv | Typisk projekt ≤50 MiB; ingen kunstig hard cap i første udgave | Showcase og assettunge projekter før release. Browserens IndexedDB-kvote er styrende for lokal autosave. |
| Autosave | Status `Saved` ≤2 s efter en almindelig scene-/scriptændring | Projekt på højst 50 MiB, varm app, 10 gentagelser |

Ydelsesmålinger køres efter 10 sekunders opvarmning i 60 sekunder, fem gange; rapportér p50/p95 og browser, OS, hardware, viewport, DPR og strømprofil. Desktop-budgettet bruger en fast referencecomputer, ikke vilkårlige CI-hosts. Mobilbudgettet kræver fysiske enheder.

De eksisterende funktionelle referenceprojekter er Physics Playground (scene, fysik, Play/Stop og projektlagring) og ECS Studio Showcase (scripts, noder, tilemap, animation, lyd og spil-UI). `renderer-smoke.html?sprites=1000` er den syntetiske renderer-stressprofil: 1.000 sprite-items med samme tekstur, én batch, 5 opvarmningsrenders og 30 CPU-submit-tidsprøver. Den registrerer median/p95, men hævder ikke GPU-tid eller fuld ECS-/fysik-frame time. Scenen bruges til regressionsmålinger; frame-time-budgettet på fulde spilscener skal også måles på desktop og telefon før release.

## Aktuel baseline og begrænsninger

Den aktuelle produktionsbuild fra Docker måler editorens hoved-JavaScript til 797,13 kB gzip og hoved-CSS til 5,69 kB. Kodeeditorens lazy JS/CSS er 833,63 + 19,87 kB gzip. Player-runtime er 752,86 kB gzip. Disse holder sig inden for de fastsatte bundlebudgetter. Tallene er bundlemålinger, ikke netværks- eller opstartstider.

Indledende loadtid og frame-time-budgetter er fastsat, men endnu ikke benchmarkmålt på referencehardware. Stressprofilens browsercheck bekræfter 1.000 sprite-items og én draw batch, men dens timing bruges ikke som en absolut CI-gate, fordi software-WebGL og delte CI-værter giver ustabile tider. Fuld frame time inkluderer CPU, browser/compositor og GPU og skal måles på referenceenheder.

Editoren bruger IndexedDB og kræver ikke direkte mappeadgang. **Export** downloader et `.ecsproj`-arkiv, og **Open Project** kan importere det igen som manuel backup/flyttevej. Ved IndexedDB-fejl viser editoren `Save failed` og anbefaler eksport; arkivvejen er ikke en automatisk adapter-switch og kræver plads til download. Den aktuelle Chromium-suite tester arkiv-roundtrip; matrix-smoketesten tester IndexedDB autosave/reload i Chromium, Firefox og WebKit.

## Konsekvenser

- Playwright-browsermatrix køres med `npm run test:browser-matrix` i Docker.
- Rendererens smoke- og stressprofil køres med `npm run test:renderer-browser` i Docker.
- Faktiske browser- og enhedschecks hører til T311; CI-smoke er ikke en erstatning for fysisk mobil eller GPU-backed Safari/Firefox.
- Projektstørrelse er et anbefalet brugsmål, ikke en håndhævet importgrænse; quota- og eksportfejl skal forblive synlige.

## Alternativer

- **Kun Chromium:** afvist, fordi Gecko- og WebKit-forskelle ellers opdages sent.
- **Alle OS/GPU-kombinationer i CI:** afvist som urealistisk; fast CI-matrix suppleres af målrettede release-enheder.
- **Hårdt 50 MiB projektloft:** afvist, fordi assets og IndexedDB-kvoter varierer; 50 MiB er et testet brugsmål, og appen skal fejlmelde tydeligt ved browserkvote.
