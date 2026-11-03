# @ecs/core

Browser- og adapteruafhængig ECS-kerne. Importér de offentlige typer fra pakkens `index.ts`.

```ts
import { defineComponent, World } from '@ecs/core';

interface Position { x: number; y: number }
const Position = defineComponent<Position>('Position');
const world = new World();
const entity = world.createEntity();
world.addComponent(entity, Position, { x: 0, y: 0 });
for (const movingEntity of world.query(Position)) {
  const position = world.getComponent(movingEntity, Position)!;
  world.setComponent(movingEntity, Position, { x: position.x + 1, y: position.y });
}
```

Entities er handles scoped til deres World. Opbevar ikke `index` alene: et slettet index kan genbruges med en ny generation. Brug komponenttokens oprettet af `defineComponent`; navnet er til læsbarhed, mens tokenidentiteten skiller komponenttyper ad.

Queries returnerer snapshots. Et snapshot afspejler medlemskabet på query-tidspunktet, også hvis verden ændres under iteration. Component values er almindelige JavaScript-værdier; ECS'en deep-cloner eller fryser dem ikke.

`World.createCommandBuffer()` giver et køobjekt til strukturelle ændringer. `create()` returnerer en pending handle, som kan bruges til efterfølgende queued commands og først løses efter `flush()`. Flush afspiller kommandoerne i rækkefølge. Fejler en kommando, bevares den fejlede kommando og resten af køen; allerede afspillede kommandoer rulles ikke tilbage. `clear()` sletter køen og pending handles, men fortryder ikke allerede udførte ændringer.

Ressourcer registreres med `defineResource<T>(name)` og `World.setResource/getResource`. Tokens er unikke pr. kald, også når navnene matcher.

Kør invarianttests med `npm run test:core`. Denne package udfører ingen DOM, rendering, fysik, scheduler eller scene serialization.
