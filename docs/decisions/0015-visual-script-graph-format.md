# ADR 0015: serialiseret format til visuelle scripts

## Problem

Nodeeditor, gemte projekter og runtime skal bruge samme grafdata uden DOM- eller editorafhængigheder. Forbindelser skal kunne afvises, før grafen køres, hvis portene mangler eller har forskellige typer.

## Valg

Grafer gemmes som version 1 JSON med stabile node-/link-ID'er, nodeplaceringer, node-data samt eksplicitte kilde- og målporte. Nodekinds beskriver portenes typer. Runtime validerer grafen og afvikler deklarativ flow med et nodebesøgsbudget og cancellation. Komponent- og eventnoder kalder samme `ScriptApi` som kodescripts; hosten schema-validerer komponentkommandoerne, før de anvendes. Repeat-noder begrænses til 1.000 gentagelser og alle grafer til 10.000 nodebesøg pr. invocation. Editorens canvas er en DOM-integration, der kun producerer denne model.

Projektformatet går til version 4 med et `visualGraphs`-kort af relative `.graph.json`-stier. Version 1–3 migreres med et tomt kort. Projektimport validerer grafernes portstruktur før brug.

## Konsekvenser

- Grafmodellen kan testes og afvikles uden browser-UI.
- Grafen kan flyttes mellem editor, eksport og runtime uden at serialisere DOM-objekter.
- Komponenttype-ID'er angives som node-data i prototypen; schema-baseret dropdown og felttypeforslag er fortsat en editorforbedring.
- Undo/redo for grafcanvas er afgrænset til nodeeditoren i prototypen.

## Alternativer

- At gemme canvas-DOM eller et editorframeworks interne objekter ville binde projektformatet til UI-implementeringen.
- At gemme kun forbindelser uden nodeporttyper ville gøre ugyldige links svære at opdage før kørsel.
