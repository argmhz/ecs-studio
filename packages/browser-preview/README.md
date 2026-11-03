# @ecs/browser-preview

Midlertidig integration af Three.js/WebGL og Rapier 2D til editorens Game-view. Play modtager en afkodet kopi af ECS-scenen; Rapier-systemet kører gennem `@ecs/runtime`'s faste tidsloop og skriver simulerede transforms tilbage til kopien. Stop frigiver Rapier-verdenen og nulstiller preview-meshes fra redigeringsscenen. UI-komponenter vises i et responsivt DOM-overlay over WebGL-canvas; knaptryk sendes tilbage som sceneevents. Renderer- og fysikintegrationen er stadig en teknisk afprøvning og kan senere udskiftes bag runtime-adaptere.
