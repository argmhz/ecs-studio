# Physics Playground

Første lille eksempelprojekt til ECS Studio. Scenen indeholder Player, Crate og Ground, så man kan prøve den samlede editorarbejdsgang med hierarki, inspector, 2D-transforms, fysik, Play og lokal projektlagring.

## Prøv det i editoren

1. Start editoren med `docker compose up node`, og åbn http://localhost:5173.
2. Vælg Player eller Crate i Hierarchy. Ændr position eller størrelse i Inspector, eller brug Move/Rotate/Scale i Scene-viewet.
3. Tryk Play og brug A/D eller venstre/højre pil for at flytte Player. W/S og op/ned flytter lodret; Space svarer til gamepad-knap 0, og venstre stick styrer bevægelsen. Klik eller touch i Game-view giver `interact`. Game-view tager tastaturfokus ved Play; klik i Game-view igen, hvis du har fokuseret editoren. Pause og Step afprøver simulationens faste tidsstep; Stop går tilbage til redigeringsscenen.
4. Opret et objekt med `＋` ved scenenavnet, og redigér det i Inspector. Ændringer autosaves lokalt; Save gemmer straks.
5. Åbn `player.ts` og Nodes-fanen for at se eksemplet på scriptsamspil: kodescriptet udsender Player-positionen, og nodegrafen sender den tilbage som et event med JSON-payload. Begge scripts kører automatisk i Play; events bliver leveret ved næste script-update.
6. Genindlæs siden for at åbne den senest gemte scene igen. Export/ Open Project overfører projektet som `.ecsproj` med assets.

Eksemplet demonstrerer redigering, fysik, input actions og grundlæggende dataudveksling mellem TypeScript og nodegrafer.
