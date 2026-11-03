# ADR 0004: Fast simulationstidssteg og systemrækkefølge

- Status: Accepteret
- Dato: 2026-10-31

## Problem

Simulationen skal give ensartet tidsdelta til gameplay og fysik, lade editoren styre Play/Pause/Step og begrænse arbejde efter lange frames eller inaktive faner. Runtime skal også kunne bruges uden browser, DOM eller renderer.

## Valg

`@ecs/runtime` ejer en `Scheduler`, som kører registrerede systemer i stigende `order`; systemer med samme order følger registreringsrækkefølgen. Hvert step får en delt, skrivebeskyttet kontekst med World, fast delta, ticknummer og simulationstid. Registreringer ændret under et step gælder fra næste step.

`FixedStepLoop` akkumulerer frame-tid, kører højst fem trin per frame som standard og accepterer højst 250 ms fra én frame. Overskydende tid droppes og rapporteres. Resterende brøk af et trin gives som `alpha` til renderingens interpolation. `pause()` rydder den delvise akkumulator; `stepOnce()` kræver pause. En systemfejl pauser løkken og rydder akkumulatoren, så et delvist udført tick ikke automatisk forsøges igen.

Frame-loopet eksponerer `advance(elapsedSeconds)` og kender ikke `requestAnimationFrame`; en senere browseradapter ejer RAF-livscyklus og tab-synlighed. Generiske komponentværdier interpoleres ikke af runtime; rendererens transformintegration bruger alpha.

## Konsekvenser

- Gameplay- og fysiksystemer får et fast tidsdelta uanset frame rate.
- Et langt faneskift kan ikke skabe en ubegrænset kø af simulationstrin.
- Kaldende integrationer kan observere droppet tid og selv vælge, hvordan den præsenteres i editoren.
- Pause kasserer et ufuldstændigt deltrin; enkelttrin udfører præcis ét normalt scheduler-step.
- En fejl kan efterlade World delvist ændret, fordi ECS-systemers mutationer ikke er transaktionelle. Løkken stopper og gentager ikke fejlen automatisk.

## Overvejede alternativer

- Variabelt tidsdelta: afvist, fordi fysik og gameplay så afhænger af renderfrekvens.
- Ubegrænset catch-up: afvist, fordi en inaktiv fane eller langsom frame kunne låse simulationen i en catch-up spiral.
- RAF indbygget i runtime: afvist, fordi det kobler server-runtime og tests til browserens globale API.
