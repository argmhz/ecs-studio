# @ecs/audio

`AudioSource2D` stores a stable audio-asset reference, playback settings and one of the `music` or `effects` volume groups. `WebAudioMixer` is the browser adapter: it decodes asset bytes lazily, caches decoded buffers, routes sources through group gain nodes and stops sources by scene entity ID. The context is created/resumed from a user gesture, such as Play or clicking an audio asset in the Assets panel.

Scripts and visual graphs can control a source through the shared event API:

```ts
api.emit('audio.play', { entityId: 'paddle-hit' });
api.emit('audio.stop', { entityId: 'background-music' });
```

These events are consumed by the host on the following simulation tick. Scripts receive no AudioContext, AudioNode, DOM or asset bytes. T304 will reuse this runtime/event contract for exported web games.
