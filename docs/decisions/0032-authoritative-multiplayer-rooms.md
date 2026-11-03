# ADR 0032: Autoritative multiplayer-rum

## Status

Accepteret.

## Problem

T307 skal give 2–8 spillere adgang til private rum og sikre, at klienter sender input i stedet for autoritativ world-state. Room-laget skal kunne drive den DOM-uafhængige simulation fra T306 og opdage mistede forbindelser og protokolmismatch.

## Valg

`@ecs/multiplayer` er en Node-only WebSocket-vært bygget med `ws`. Hvert rum ejer sin `HeadlessRuntime`; applikationen registrerer systems og ejer uret, som kalder `advanceRoom`. Klienter opretter private rum eller tilslutter med en tilfældig 10-tegns kode. Første besked skal matche serverens protokolversion. Klienters input beskæres til navngivne numeriske action-værdier i intervallet `[-1, 1]`, har monotont stigende sekvensnumre, maksimal frame-størrelse og bounded room-kø. Input overdrages til serverens callback umiddelbart før næste simulation advance.

Rum tillader konfigurerbar kapacitet 2–8, som standard 8. Ejeren er første spiller; ved disconnect overgår ejerskabet til næste tilsluttede spiller. Tomme rum disponeres. WebSocket heartbeats fjerner halvåbne forbindelser. Protokolversionen er i beskederne; klienter skal afvise inkompatible serverversioner.

## Konsekvenser

- Node-serveren afhænger af `ws` (`MIT`) til WebSocket-servertransport; browserklienter bruger native WebSocket.
- Serveren ejer hele World og simulationen; klientbeskeder kan ikke skrive state direkte. T308 tilføjer snapshots og klient-synkronisering.
- Private koder er join-capabilities, ikke brugeridentitet eller kontobaseret adgangskontrol. Public deployment kræver TLS og eventuelt et separat auth-/originlag.
- Headless runtime har endnu ikke serveradapter til Rapier; game-applicationen skal kun registrere serverkompatible systems.
- Det transportuafhængige HTTP endpoint `/healthz` afslører kun status og antal rum.

## Alternativer

- Node 22 har klientens WebSocket API, men ingen indbygget WebSocket-server; `ws` leverer den servertransport og har HTTP-serverintegration.
- At lade klienter eje eller sende transform-/world-snapshots ville give klienterne autoritet og gøre validering vanskeligere.
- Account/login er udeladt; private kodebaserede rum opfylder den første tekniske prototype uden at knytte multiplayer til projektkonto.
