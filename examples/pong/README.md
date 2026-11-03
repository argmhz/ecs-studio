# Pong — redigerbart editorprojekt

Åbn editoren med `docker compose up node`, og vælg **Load Pong** i topbjælken. Det opretter et nyt lokalt projekt uden at overskrive dine andre projekter. Brug **W/S** til venstre bat og **A/D** til højre bat. Start og stop spillet med editorens Play/Stop.

Vælg **Game Controller** i Hierarchy. Projektet indeholder en lille hvid PNG, som sprites farves med deres Tint; Sprite Renderer kræver et billedasset, også når formen er et enkelt farvet rektangel. Midterlinjen er ét sceneobjekt med en stiplet PNG-tekstur, ikke ni separate dash-objekter. Dets Script Binding peger på `scripts/pong.ts` og `scripts/score.graph.json`:

```text
scripts/pong.ts  ── pong.point ──▶  score.graph.json
      ▲                                  │
      └──────────── pong.scored ─────────┘
```

Kodescriptet læser input og flytter de to bat og bolden gennem stabile scene-ID'er. Når en spiller misser, udsender det `pong.point`. Nodegrafen registrerer sit abonnement i **On Start** og videresender payloaden fra den matchende **On Event**-indgang som `pong.scored`; koden opdaterer score-UI'et. Events bliver leveret ved næste simulationstik.

Projektarkivet, som **Load Pong** indlæser, genereres fra scenen og scriptfilerne i `generate-project.ts`:

```sh
docker compose run --rm node npm run build:project --workspace @ecs/example-pong
```

`/pong.html` er fortsat en mindre, selvstændig scripting-runtime-demo, men den anbefalede Pong-arbejdsgang er nu projektet i editoren.
