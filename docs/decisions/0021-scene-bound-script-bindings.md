# ADR 0021: Scene-bundne scripts og Play-scheduler

## Status

Accepteret til T212.

## Problem

Play kører i dag ét projekt-globalt code script og én nodegraf på det valgte sceneobjekt. Det gør det umuligt at gemme scriptadfærd på flere objekter eller lade et objekt påvirke et andet gennem det fælles script-API.

## Valg

- Et sceneobjekt kan have én versionsmærket `ScriptBinding`-komponent med code path, graph path, enabled-flag og schema-validerede properties. Paths refererer til projektets script-/grafkort; kildetekst og grafer forbliver projektfiler.
- Play opretter en separat instans for hver aktiv binding og scriptform. State og subscriptions tilhører instansen og nulstilles ved ny Play. Objekter planlægges i stabil scene-ID-rækkefølge; code kører før grafen for samme binding.
- Alle instanser på et tick modtager samme komponent- og inputsnapshot. Events fra forrige tick leveres kun til instanser, der abonnerede ved deres forrige invocation. Nye events køes til næste tick.
- Script-API'ens eksisterende component-metoder forbliver ejer-lokale. Nye eksplicitte entity-metoder tager stabilt scene-ID og kan kun læse eller afgive kommandoer til entities i snapshot'et. Hosten validerer alle mål, schemas og komponentværdier.
- Hosten samler komponentkommandoer for hele script-tick'et, validerer strukturelle ændringer i rækkefølge og anvender dem først, når alle scripts er færdige. Scene- og runtime-integrationsobjekter gives aldrig til scriptet.
- Play bruger fortsat en scene-kopi; Stop kasserer script-state, events og sceneændringer.

## Konsekvenser

- Scriptadfærd følger objekter ved scene-redigering, kopiering og projekt-roundtrip. Inspector viser bindings og properties på objektet.
- Flere scriptinvokationer kan øge worker-overhead. T212 måler ikke performance; senere optimering kræver måling og ændrer ikke den observerbare rækkefølge.
- Stabil ID-rækkefølge kan påvirke konflikter, men gør dem reproducerbare. Ved samtidige writes vinder den sidst anvendte kommando i den dokumenterede rækkefølge.
- `ScriptApi` får eksplicit entity-adgang, men scripts får ikke generel adgang til ECS-World eller enumeration uden for det leverede snapshot.

## Overvejede alternativer

- At køre ét controller-script på det valgte objekt gentager den nuværende begrænsning og kræver skjulte globale paths.
- At give scripts en direkte `World`-reference bryder isoleringen og lader scriptet omgå schema-validering og command-bufferen.
- At lade hvert script se writes fra tidligere scripts på samme tick gør resultatet afhængigt af scheduler-rækkefølgen; alle invocationer bruger derfor samme snapshot.
