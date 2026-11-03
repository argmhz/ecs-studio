# ADR 0035: Deployment af multiplayer-host

Status: accepteret for første serverdeployment.
Dato: 2026-11-01.

## Problem

T307/T308 leverer WebSocket-rum og synkroniseringsprimitiver, men ingen kørende host, clock eller deploymentopskrift. Statiske webspil skal forblive uafhængige af den server, der ejer multiplayer-rum.

## Valg

- `examples/multiplayer-host` er en Node 22-workspace med platformstyret `HOST`, `PORT`, `TICK_RATE`, `MAX_PLAYERS` og `MAX_ROOMS`.
- Serverens host-clock kalder `advanceRoom` for hvert aktivt rum. Runtime capper selv stort elapsed-time/catch-up, og simuleringsfejl pauser kun det rum.
- `GET /healthz` eksponerer status og antal aktive rum. Containerens health check bruger dette endpoint.
- `Dockerfile.multiplayer` installerer kun hostens workspace og produktionsafhængigheder. Node kører direkte som containerens PID 1 og håndterer `SIGTERM`/`SIGINT`; lukning disposer rum og giver peer-forbindelser en kort graceperiode før terminering.
- En proces må højst have 500 aktive rum som standard, konfigurerbart mellem 1 og 10.000. Tomme rum fjernes ved sidste disconnect; heartbeat fjerner døde peers.
- Start med én host-instans. TLS termineres på hostplatform eller reverse proxy, som videresender WebSocket `Upgrade` på `/multiplayer`. Deployment og endpointinstruktioner står i [multiplayer-README](../../packages/multiplayer/README.md).
- Host-eksemplet konsumerer validerede inputs og udsender `{ tick }`. Spillets `configureRoom`, `applyInputs`, `createSnapshot` og klientens WebSocket-URL er appens ansvar.

## Konsekvenser

- Backend kan bygges og køres som en selvstændig Docker-container; static `index.html`/`game.js` hosting kræver ikke denne service.
- Rumtilstand ligger i proceshukommelse. Restart lukker alle rum; flere replikaer, shared state, rooms affinity, login, global connection rate-limit og spilklientintegration er ikke implementeret.
- `MAX_ROOMS` begrænser rumoprettelse, men er ikke en komplet DoS-beskyttelse. Før offentlig trafik bør platformen begrænse forbindelser/oprettelser og hosten gennemgås med et load test.
- Hostens eget tick interval drives hvert aktive rum sekventielt. Ydelses-/kapacitetsmål for flere rum skal fastlægges ved deploymentprofilering.

## Validering

`docker build -f Dockerfile.multiplayer -t ecs-multiplayer:t309 .` bygger et produktionsimage med fem installerede produktionspakker og 0 npm-auditfund. Containeren er startet lokalt; `/healthz` returnerede `status: ok`, en WebSocket-klient oprettede et rum og modtog snapshot ved tick 3, og `docker stop` udløste hostens `SIGTERM`-shutdown. Typecheck og 11 multiplayer-integrationstests består via Docker.

## Alternativer

- **Platformsspecifik deploy-fil til én cloududbyder:** udsat, indtil en konkret udbyder vælges. Standard Docker-image kan køres på kompatible containerplatforme.
- **Kør simulation i editorens Vite-server eller statiske webhost:** afvist, fordi statisk hosting ikke ejer en langlivet autoritativ WebSocket-proces.
- **Flere instanser fra start:** afvist, fordi rum og runtime er proceslokale og uden shared state.
