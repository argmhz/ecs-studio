# ADR 0022: Web Audio runtime og lydgrupper

## Status

Accepteret til T209.

## Problem

Lydassets kan allerede importeres og pakkes med projekter, men scenekomponenter og Play-runtime kan ikke afspille dem. Browserens autoplay-regler kræver desuden en eksplicit brugerhandling, før lyd kan starte.

## Valg

- Lydkomponent og mixer placeres i det UI-uafhængige `@ecs/audio`-workspace. Browserens Web Audio API er adapteren; mixerens context kan injiceres i tests.
- `AudioSource2D` refererer til et lydasset-ID og gemmer autoplay, loop, volume og `music`/`effects`-gruppe. Master, music og effects har separate gain-noder.
- Kode og noder afspiller/stopper en scene-source via de fælles events `audio.play` og `audio.stop` med scene-entity-ID som payload. Hosten finder source-komponenten; scripts får ingen lyd- eller DOM-objekter.
- Play genoptager AudioContext direkte under brugerens Play-klik. Eksporterede spil skal bruge samme mixer og eventkontrakt, når eksport-runtime implementeres i T304.

## Konsekvenser

- Audio-API'et kan genbruges af editorpreview og senere eksport uden afhængighed af editorens UI.
- Browsere kan stadig kræve brugerinteraktion; afspilning før unlock fejler tydeligt i hosten.
- T209 leverer simple gruppevolumener og kildeafspilning; spatial 2D-lyd, streaming og avanceret routing er ude af scope.

## Overvejede alternativer

- `HTMLAudioElement` gør samtidige effekter, gruppegain og testbar mixer vanskeligere.
- Direkte AudioContext-adgang fra scripts bryder sandboxkontrakten og giver scriptkode adgang til browserressourcer.
