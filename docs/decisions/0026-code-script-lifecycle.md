# ADR 0026: Funktionsbaseret code-script lifecycle

## Status

Accepteret — første integration under T315.

## Problem

Kodescripts blev kørt i en ny iframe og worker for hvert simulationstik. Det gav en enkel isolation- og timeoutmodel, men gjorde det umuligt at registrere en JS callback én gang og bevare den gennem Play. Brugeren skulle desuden manuelt gennemgå eventlisten i hver `update`.

## Valg

Hver code-script binding får en worker-session i den opaque sandbox gennem Play. `onStart(api)` registrerer `api.on(type, listener)`-callbacks; `onUpdate(api)` køres pr. tick, og events fra tidligere ticks leveres som callback-kørsler med eventet og et nyt API-snapshot. `api.emit` føjer stadig events til næste tick. `onStop(api)` er lifecycle-hooket for oprydning. Legacy `update(api)` og `subscribe`/`api.events` forbliver understøttet.

Hvert scriptkald har host-ejet timeout. Timeout eller AbortController fjerner iframe og terminerer worker; Stop nulstiller hele Play-sessionen. Workerens globale listener-map holder callbacks i live, mens snapshots, kommandoer og events fortsat passerer grænsen som bounded JSON. Callbackfunktioner kan ikke serialiseres til editoren eller bruges fra nodegrafer; nodegrafer bruger fortsat deklarative Subscribe-noder.

## Konsekvenser

- Event-håndtering bliver deklarativ ved opstart og adskilt fra frame-opdateringer.
- Kodescriptet bruger én worker under Play i stedet for at genoprette worker for hvert tick.
- Callbacken må bruge det andet `api`-argument for friske component snapshots; et API-objekt fanget i `onStart` er et gammelt snapshot.
- Sandboxen kan kun afbryde scriptet mellem message-invocations, men host-timeout terminerer også en uendelig synkron løkke.
- `onStop`-hook og komplet Play integration skal valideres særskilt før T315 markeres færdig.

## Alternativer

- Beholde polling af `api.events` i `update`; afvist som unødigt gentagende og mindre intuitivt.
- Gøre scripts til klasser; udskudt for ikke at påtvinge begyndere OOP og fordi navngivne lifecycle-funktioner matcher nuværende kodeform.
