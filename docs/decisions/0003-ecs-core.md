# 0003 — Første ECS-core-kontrakt

Status: implementeret og valideret sammen med T101.
Dato: 2026-10-31.

## Beslutning

- Entities er uforanderlige handles med `index`, `generation` og en intern world-identitet. Et index kan genbruges efter destroy; generationen øges, så gamle handles forbliver ugyldige. Handles fra en anden World afvises.
- Components registreres med `defineComponent<T>(name)`. Hvert kald giver et unikt symboltoken; navnene er kun labels. Komponentværdier er typed data uden engine-owned mutation hooks.
- Hvert component token får et sparse-set-lager: sparse index → dense index; dense entity/value-arrays; O(1) lookup, set og swap-delete. Tomme sparse slots er markeret med nul.
- `World.query(...types)` itererer det mindste lager, filtrerer de øvrige tokens og returnerer et snapshot. Ingen typer returnerer alle levende entities.
- Resources bruger tilsvarende unikke tokens og en typed map.
- CommandBuffer køer create/add/remove/destroy i rækkefølge. Create returnerer en bufferbundet pending handle, som kan bruges i efterfølgende kommandoer og opløses efter flush.
- Flush er sekventiel, ikke transaktionel: ved fejl bevares den fejlede kommando og resten af køen; tidligere afspillede kommandoer forbliver gennemført. Queue clearing fortryder ikke world-ændringer.

## Konsekvenser

Kernen har ingen DOM-, renderer-, fysik- eller UI-afhængigheder og kan importeres i browser og server. TypeScript-komponenttyper følger værdierne gennem add/get/query. Snapshotqueries er nemmere at bruge sikkert, men kopierer entity-referencer og afspejler ikke ændringer under iteration. Sparse sets er et enkelt startvalg; målinger afgør senere om queries eller storage skal ændres.

CommandBuffer håndterer strukturelle ændringer, mens systemer arbejder. Fejl kan efterlade en delvist afspillet batch, så systemer skal validere deres operationer, og fejl skal stoppe tick'et. Det næste schedulerarbejde definerer denne fejlsti.

Handles er runtimeidentiteter, ikke serialiseringsformater. Scene-/projektfiler får stabile egne ID'er i T103.

## Afprøvning

`packages/core/test/world.test.ts` dækker generationsgenbrug, cross-world-håndtag, query-intersection og snapshots, komponentreplacering, swap-delete, resources, deferred entities, command order, clear og fejl i playback.
