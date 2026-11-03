# 0037 — Kamera, spilflade og projektscener

## Problem

Game-view brugte en fast pixelskala uden et redigerbart kamera. Projektet havde én scene, så startmenuer og separate baner kunne ikke gemmes eller afvikles som selvstændige scener.

## Valg

`engine.camera2d` er en datakomponent med Enabled, Priority, Visible Height, Follow Target og offsets. Det aktive kamera vælges efter højeste prioritet; stabile ID'er afgør lighed. Kameraet ser altid langs Z-aksen. Follow bruger målets globale position uden at ændre kamerakomponentens Transform. Et manglende mål falder tilbage til kameraets egen position.

Game View er projektdata: Free følger panelstørrelsen; Fit bruger en fast renderopløsning og bevarer dens billedforhold med sorte kanter. Canvas, UI og input deler den indre spilflade. Visible Height fastholder verdensudsnittet ved panelresize. Scene-view har fortsat sit eget navigationskamera og viser en Game Camera-ramme. Parallax refererer til spilkameraet, så editorzoom ikke flytter baggrundslagene i forhold til banen. Projekter uden Camera 2D bevarer den tidligere kameraskala.

Projektformat v9 tilføjer en scenesamling med stabile scene-ID'er, navne, activeSceneId og startSceneId; v8 tilføjede Game View. Ældre projekter migreres til én Main scene og Free aspect. Feltet `scene` bevares som den aktive scenes dokument af hensyn til eksisterende projektlæsere. Assets, scripts, grafer, prefabs, input og Game View deles på projektniveau; entity-ID'er har scene-lokal betydning.

Play og webeksport starter startscenen. `api.emit('scene.load', { sceneId: '...' })` bestiller en overgang efter den aktuelle scriptframe. Nodegrafer bruger Emit Event med samme payload. Den første anmodning i en frame vinder. Ukendte scene-ID'er fejler synligt. Overgangen stopper simulationen, afventer igangværende scriptarbejde, kalder onStop, lukker workers, stopper lyd og frigiver den gamle fysikverden. Den næste scene deserialiseres på ny. Der overføres foreløbig ingen globale gameplayvariabler eller entities mellem scener.

Editorens aktive verden holdes adskilt fra alle Play-verdener; Stop gendanner den aktive editorscene. Sceneskift i editoren afslutter den tidligere scenes historik og starter en tom undo-historik. Sletning af startscenen vælger den næste tilbageværende scene. Mindst én scene beholdes. Import validerer alle scene- og prefab-dokumenter før projektet ændres. Assetreferencer i inaktive scener beskytter også mod fjernelse.

## Konsekvenser og alternativer

Kamerarotation, smoothing, additive scener og persistente gameplayobjekter er ikke med i denne ændring. Alternativet var kun at indføre billedforhold i editoren eller at bruge ét stort scenedokument; det ville ikke give ensartet eksport eller selvstændige baner. En særskilt Load Scene-node kan senere lægges oven på samme eventkontrakt.

DOM-fri kameraberegninger og scenesamlingens validering er fælles for editor og player; viewport/layout ejes af browserintegrationen.
