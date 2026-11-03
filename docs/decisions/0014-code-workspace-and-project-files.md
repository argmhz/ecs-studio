# ADR 0014: kodeworkspace og projektfiler

## Problem

Kodefanens typer skal følge komponentschemas, og kodearbejde skal overleve autosave, projektexport og genåbning. Ældre `.ecsproj`-arkiver indeholder ikke scripts.

## Valg

Monaco får lokale TypeScript- og JavaScript-workers. Editorens engine-deklarationer genereres fra `SchemaRegistry`, som også driver Inspectoren. Projektformatet går fra version 1 til 3 og gemmer scripts som relative stier til kildekode samt schema-validerede script-properties i samme projektpost og eksportarkiv. Arkivversion 1 migreres med et tomt scriptkort; version 2 bevarer scripts og får tomme properties.

## Konsekvenser

- Inspector- og scriptforslag bruger samme komponent-ID'er og felter.
- Kodefiler og script-properties autosaves sammen med scene og eksporteres/importeres med projektet.
- TypeScript diagnostics og Monaco-editorfunktioner kører lokalt; ingen ekstern completiontjeneste bruges.
- Filerne er globale scripts, ikke ES-moduler; imports/exports er endnu ikke understøttet. Monaco-modeller deler symboler, og Find søger i alle projektfiler. Den aktive `.ts` eller `.js`-fil er entrypoint.
- TypeScript transpileres i Monacos lokale sprogarbejder ved Play. `update(api)` kører i den afprøvede disposable worker-sandbox med 500 ms loft pr. opdatering. Output gennemgår schema-validering og anvendes på Play-kopien; Stop afbryder aktive workers.
- `update` er den eneste tilsluttede lifecycle callback i denne prototype. `create`, `start`, `fixedUpdate`, `event` og `destroy` samt tværscript-eventrækkefølge tilsluttes senere.

## Alternativer

- At gemme kode i `localStorage` ville adskille den fra projektarkiver og gøre projektflytning ufuldstændig.
- At kopiere typer manuelt ville lade engine-API'et drive væk fra schemas og Inspector.
