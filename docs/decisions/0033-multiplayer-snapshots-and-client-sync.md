# ADR 0033: Multiplayer-snapshots og klient-synkronisering

## Status

Accepteret.

## Problem

T308 skal give browserklienter autoritativ state fra T307-rummene og hjælpe med at vise fjernspillere jævnt, også når snapshots kommer sent, mangler eller ankommer i forkert rækkefølge. Lokale input skal kunne genafspilles efter en serverbekræftelse uden at antage deterministisk fysik eller serialisere enhver ECS-World ens.

## Valg

Serverapplikationen leverer `createSnapshot(roomCode, runtime)`, som returnerer JSON-state. Rummet sender en start-snapshot ved oprettelse/tilslutning og derefter højst én snapshot pr. konfigureret tick-interval; standarden er hvert tredje faste tick. Snapshotbeskeden indeholder serverens tick og højeste behandlede inputsekvens pr. spiller. Payloadens serialiserede størrelse begrænses som standard til 64 KiB og kan konfigureres op til 1 MiB. Protokolversionen øges til 2.

Browser-safe helpers eksporteres separat fra `@ecs/multiplayer/client`, så browseren ikke importerer Node-serveren. `SnapshotBuffer` afviser dubletter og sene snapshots, holder en afgrænset historik og sampler med to ticks interpolation delay som standard. Numeriske JSON-felter interpoleres lineært; applikationer kan levere egen interpolator for rotation, entity-livscyklus og andre domænesemantikker. `InputReconciler` fjerner input op til snapshottes bekræftede sekvens og genafspiller den ventende hale via applikationens egen step-funktion.

## Konsekvenser

- Game-applikationen ejer snapshotformat, lokal spillerstate og prediction-step; motoren lover ikke identiske physics-resultater på tværs af platforme.
- Ved 60 Hz simulation er standard snapshotfrekvensen 20 Hz. Mellemliggende ticks sammenfattes i nyeste snapshot, så langsomme klienter ikke får en ubegrænset kø.
- Hjælperne har bounded memory og ignorerer sene eller duplikerede statepakker; integrationen skal selv estimere serverens aktuelle tick.
- Forudsigelse og reconciliation er generiske byggesten, ikke et komplet klient-runtime eller automatisk ECS-serialisering.

## Alternativer

- Automatisk at serialisere hele ECS-World ville kræve schema-, asset- og private-state-politik, og kunne eksponere state som ikke skal sendes til klienter.
- At lade klienter sende transform-state ville svække serverens autoritet.
- At antage deterministisk fysik for rollback blev afvist; applikationer kan vælge prediction ud fra deres egne systems.
