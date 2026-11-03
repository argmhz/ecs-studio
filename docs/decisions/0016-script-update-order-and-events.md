# ADR 0016: rækkefølge og eventlevering mellem scripts

## Problem

Play skal køre kode og nodegrafer sammen, uden at eventresultater afhænger af hvilken scriptform der afvikles først. Begge former skal kunne udveksle JSON-data, beholde hver sin tilstand og bruge fælles komponent-API.

## Valg

Ved hvert script-update kører TypeScript/JavaScript først og nodegrafen derefter. Begge får samme snapshot af komponenter fra update-start og de events, der blev sat i kø ved forrige update. Scriptstate og subscriptions er separate pr. script. Hosten schema-validerer output og anvender komponentkommandoer efter hver invokation; derfor vinder grafens kommando ved samtidige skrivninger til samme komponent.

Events fra begge scripts samles efter afviklingen og kan først leveres ved næste update. Hvert script modtager eventtyper, det abonnerede på ved sin seneste invokation. Eventkøen har et loft på 512 events pr. update; hver API-invokation har fortsat loft på 256 udsendte events. Kode og graf deler dermed navngivne JSON-events som dataformat, men ikke intern state.

Eksempelprojektets `player.ts` udsender sin position som `game.code.position`. Nodegrafen abonnerer på eventet og videresender payloaden som `game.graph.position`; kodescriptet abonnerer på dette svar. Det demonstrerer data i begge retninger med én tick forsinkelse pr. eventoverførsel.

## Konsekvenser

- Samme input og snapshot giver samme rækkefølge for komponentændringer og eventlevering.
- Kode- og grafkommandoer, der skriver samme komponent, har en defineret prioritet: grafen anvendes sidst.
- Events er asynkrone mellem scripts og kan ikke ændre en igangværende invokation.
- Andre hosts, herunder eksport og server, skal implementere eller dokumentere deres egen scheduler-kontrakt.

## Alternativer

- At levere events straks ville gøre resultatet afhængigt af eksekveringsrækkefølgen.
- At dele én `state` mellem scriptformer ville koble deres interne data og gøre genbrug vanskeligere.
- At parallelisere scripts ville kræve konfliktløsning for komponentkommandoer og er ikke valgt til første udgave.
