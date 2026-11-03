# ADR 0013: fælles API for kode- og nodescripts

## Problem

T202 og T203 skal kunne ændre komponenter, læse inspector-properties og udveksle events uden at få direkte adgang til editorens ECS-objekter. Inspectorens validering og scriptdata skal bruge samme schemas.

## Valg

`@ecs/scripting` tilbyder `defineScriptDefinition`, `validateScriptProperties` og `createScriptApi`. Scriptdefinitioner genbruger `FieldDefinition` fra `@ecs/scene`. API'et overfører JSON-kopier og returnerer strukturelle komponentkommandoer, events, subscriptions og state. Både kode-runtime og nodegraf-runtime kalder samme API; værten validerer kommandoer mod schemas og anvender dem efter invocation.

Lifecycle-faserne er `create`, `start`, `update`, `fixedUpdate`, `event` og `destroy`. `destroy` rydder subscriptions. API'et begrænser hver JSON-værdi til 256 KiB samt kommandoer, events og subscriptions til 256 pr. invocation.

## Konsekvenser

- Scriptkørsel er adskilt fra `World`, DOM og GPU-objekter; værten bevarer ejerskab og kan afvise ugyldige kommandoer.
- Kode og noder deler data- og eventkontrakten uden løfte om automatisk konvertering mellem kode og grafer.
- Eventrækkefølge, asynkron afvikling og hostens anvendelse af output kræver integration i T202/T203; T201 definerer kun kontrakten.
- JSON-kopiering giver sikker adskillelse, men begrænser værdier til serialiserbare data.

## Alternativer

- Direkte adgang til `World` ville koble scripts til ECS-implementeringen og gøre isolering vanskeligere.
- Separate API'er for kode og noder ville skabe uoverensstemmelser i properties, events og komponentadgang.
- Ad hoc propertydefinitioner ville duplikere scene-/inspector-schema og validering.
