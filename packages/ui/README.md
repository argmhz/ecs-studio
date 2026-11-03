# `@ecs/ui`

Scene components and pure layout math for the first 2D game UI: `UiCanvas`, `UiText`, `UiImage` and `UiButton`. Canvas reference dimensions support `fit` and `stretch`. Each visible element uses normalized top-left anchors and min/max offsets in reference-resolution units. `layoutAnchoredRect` maps those values to a browser viewport without depending on DOM or rendering.

The browser-preview adapter displays components as accessible DOM overlay elements over the WebGL Game view. Button clicks emit `ui.button.clicked` with `{ entityId }`; scripts can subscribe through the common code or node event APIs. The editor generates Inspector fields directly from these schemas.

This is a first UI layer. Rotation, clipping groups, flow layout and WebGL draw-order integration are not included.
