# 0002 — Scriptkørsel og isoleringsgrænse

Status: T002 afprøvet i Chromium. Modellen er et forsvarslag til lokale projekt-scripts, ikke en certificeret sandbox mod fjendtlig kode.
Dato: 2026-10-31.

## Problem

En uendelig løkke må ikke fryse editorens UI. Scripts må ikke arve editorens origin, DOM, lokale projektdata eller åbne netværksforbindelser. Data til og fra scripts skal kopieres og begrænses. Visuelle nodegrafer skal have et eksekveringsbudget, der stopper cykler.

## Valg

- Projektkode kører i en ny `iframe` med `sandbox="allow-scripts"`; `allow-same-origin` gives ikke. Dokumentet får dermed en opaque origin. Iframen har en restriktiv CSP: `default-src 'none'`, `connect-src 'none'`, `worker-src blob:` og `script-src` begrænset til bootstrap-koden, blob-worker og `unsafe-eval` i den isolerede frame.
- Iframen starter én Blob Worker. Blob-workerens script arver frame-CSP. Projektkoden udføres som JavaScript function-body i workerens globale scope; UI-tråden ejer deadline og abortsignal. Timeout, cancellation, workerfejl og svar fjerner iframen, så dens nested workers også lukkes.
- Beskeder accepterer kun JSON-data. Standardgrænsen er 256 KiB for kildekode, input og resultat. Input serialiseres før afsendelse og bliver en kopi; resultater serialiseres før de sendes tilbage. TypeScript, imports, vilkårlige module loads og direkte DOM-adgang er ikke del af denne prototype.
- `runNodeGraph` går kun gennem deklarative control-flow-links og har højst 10.000 nodebesøg pr. kørsel. Nodeadfærd evalueres endnu ikke af denne helper; den giver T203 en testet budgetgrænse at bygge den kommende nodefortolker på.
- Plugins med editorpaneler er kode med editorens tillid og kører ikke i denne projekt-script-sandbox.

## Afprøvning

Chromium via Docker har afprøvet returneret værdi, exceptions, gentagne kørsler, ikke-JSON-resultat, input/resultatlofter, cancellation, host-ejet timeout og fortsat UI-respons. En security probe afprøver `origin === "null"`, fravær af `document`, IndexedDB `SecurityError` og at `fetch` afvises. Node-unit-tests afprøver lineær graf, cyklusbudget, manglende links, dubletter og cancellation.

Resultatet understøtter de valgte browsermekanismer, ikke en garanti mod alle angreb. Web Workers kan bruge CPU og hukommelse; der findes intet generelt web-API til at håndhæve en hård worker-memorygrænse. Et stort objekt kan allerede bruge værtsmemory før JSON-loftet kontrolleres, og et browser-/engine-sikkerhedshul kan bryde isoleringen. Derfor skal kode fra fremmede projekter stadig betragtes som potentielt farlig. Brugeren skal kunne afbryde Play uden at miste editorarbejde.

## Data- og eksekveringsprotokol

Én besked indeholder kilde og JSON-input; ét JSON-resultat returneres ved færdiggørelse. Ingen direkte adgang gives til `World`, DOM, assetstore eller credentials. API-kald til spiltilstand skal senere være eksplicitte, validerede capabilities med stabile ID'er og begrænset request/response-størrelse. Batch komponentdata pr. tick frem for at sende enkeltkomponenter over grænsen. T201 fastlægger lifecycle og fælles API; T202 skal føje typed requests til samme protokol. Nodegrafer fortolkes lokalt med budget pr. tick og kalder kun engine-ejede operationer.

## Alternativer

| Model | Fordel | Begrænsning |
| --- | --- | --- |
| Same-origin Worker alene | Enkel host-ejet timeout og termination | Kan dele originens netværks-/storage-rettigheder; ikke den valgte grænse |
| Sandboxed opaque-origin iframe + Worker + CSP | UI kan afbryde arbejdet; origin, storage, netværk og DOM begrænses med separate mekanismer | Browser-memory kan ikke hårdt begrænses; nested worker-CSP og lifecycle skal fortsat testes i supportmatrix |
| Nodegraf med fortolker | Engine kan tælle nodebesøg og tillade kun registrerede operationer | Den færdige node-DSL, ports og variabler hører til T203 |
| Separat host-origin | Stærkere origin-isolation for fejl i sandbox-hostsiden | Kræver deployment, CSP og dev-serveropsætning; vurderes igen før eksterne projekter eller publiceret editor |

## Kilder

- [MDN: iframe sandbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe#sandbox)
- [MDN: Content Security Policy, inklusive worker inheritance](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy)
- [MDN: CSP `worker-src`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/worker-src)
- [MDN: opaque origins](https://developer.mozilla.org/en-US/docs/Glossary/Origin)
