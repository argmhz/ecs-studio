export interface OrthographicBounds2D {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

export interface Camera2DSettings {
  readonly x: number;
  readonly y: number;
  /** World units visible per CSS pixel. */
  readonly zoom: number;
}

export function calculateOrthographicBounds(width: number, height: number, zoom: number): OrthographicBounds2D {
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new RangeError('Viewport width and height must be finite positive numbers.');
  }
  if (!Number.isFinite(zoom) || zoom <= 0) throw new RangeError('Camera zoom must be a finite positive number.');
  const halfWidth = width / (2 * zoom);
  const halfHeight = height / (2 * zoom);
  return { left: -halfWidth, right: halfWidth, top: halfHeight, bottom: -halfHeight };
}
