# 0038 — Live forhåndsvisning i Inspector

## Problem

Felter blev først anvendt ved blur, og hver opdatering kunne genopbygge Game-preview. Brugeren kunne ikke se f.eks. placering, størrelse eller farve under indtastning.

## Valg

React-felter holder en lokal tekst-draft og senest gyldige værdi. Input-events (også paste og pileknapper) afprøver fuldstændige værdier mod komponentens fælles schema. Gyldige værdier går straks til editorverdenen; ufærdige tal og schemafejl bliver lokale. Gyldige ændringer samles til højst én visuel opdatering pr. animation frame. Scene og Game opdaterer eksisterende meshes; felternes DOM, fokus og caret bevares.

Et felt får et snapshot ved redigeringens start. Enter eller blur registrerer hele forskellen som én undo-handling. Escape gendanner snapshottet uden et historiktrin. Ugyldig draft ved blur/Enter erstattes med den senest accepterede værdi. Objektskift og sceneskift afslutter en igangværende transaktion. Autosave debounces og serialiserer kun den validerede editorverden. Play låser fortsat Inspector.

Select- og checkboxfelter bevarer deres umiddelbare, atomare ændringer. De separate animations-, atlas- og projektindstillingspaneler er ikke omfattet af denne task.

## Konsekvenser og alternativer

Et `keyup`-event alene ville overse paste og talfelters pileknapper. En fuld Inspector-/Game-genopbygning pr. tastetryk ville ødelægge fokus og koste unødvendige ressourcer. Input-events kombineret med lokale drafts og transaktioner understøtter begge behov. Preview er bevidst editorens data, ikke en separat gameplayverden; ugyldig tekst sendes aldrig til runtime eller lagring.
