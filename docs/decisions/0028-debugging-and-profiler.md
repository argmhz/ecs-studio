# ADR 0028: Debugging og profiler

## Problem

Når et spil kører i Play, skal fejl kunne spores til scriptkilde, og udvikleren skal kunne undersøge den simulerede entity samt se om simulationen og renderingen arbejder. Editorens eksisterende Console viste logtekst, mens pause og enkelttrin fandtes uden en samlet debugvisning.

## Valg

Console-panelet samler log, kildehenvisninger og tre debugkort. Scriptstier med linjenumre vises som knapper, der åbner den relevante fil og linje i kodeeditoren. Klik på et sprite-entity i Game-viewet vælger den tilsvarende entity i en read-only Play-inspector; tilemapceller peger tilbage på tilemap-entity.

Runtime-Scheduler måler hver systems seneste udførelse med `performance.now()` når den findes, ellers `Date.now()`. Det returnerer snapshots med seneste og gennemsnitlige tid samt antal kørsler. Editorens `Code & nodes`-måling omfatter script- og nodeinvokationer, command-buffer anvendelse, eventbehandling og spriteanimation i ét simulationstik. De eksisterende pause-, resume- og step-kontroller forbliver simulationens styring.

Game-viewet viser Three.js rendererens draw calls, trekanter, geometrier og teksturer samt entityantal. Debug-inspectoren læser Play-kopien, så den afspejler runtimeændringer uden at ændre redigeringsscenen. Målingerne er diagnostiske snapshots; de er ikke deterministiske performance-assertions og omfatter ikke særskilt GPU-tid.

## Konsekvenser

- Fejl i eksempelspillets scripts kan spores med et klik fra Console.
- Runtime-data undersøges direkte uden at ændre Play-kopien.
- Systemmålinger kan læses af andre hosts uden browserafhængighed.
- Renderer-statistik gælder Game-viewets Three.js-rendering; Scene-viewets 2D-renderer profileres ikke i denne task.
- Tidsmåling medfører en lille måleomkostning og beskriver CPU-tid omkring systemfunktionen, ikke GPU-eksekvering.

## Alternativer

- **Mål kun gennemsnit over en hel session:** afvist, fordi seneste tick er mere nyttigt ved at finde enkeltstående hak; gennemsnittet bevares som supplerende runtime-data.
- **Flyt profiler til et separat panel eller vindue:** afvist i første udgave, fordi Console allerede er det samlede fejlsøgningsområde og giver plads til de nødvendige oversigter.
- **Vis redigeringsscenens entity-inspector under Play:** afvist, fordi den ikke ville afspejle runtimeændringer og kunne forveksles med data, der bliver gemt.
