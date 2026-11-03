export interface UiViewport { readonly width: number; readonly height: number; readonly referenceWidth: number; readonly referenceHeight: number; readonly scaleMode: 'fit' | 'stretch'; }
export interface AnchoredRect { readonly left: number; readonly top: number; readonly width: number; readonly height: number; }

/** Resolve normalized top-left anchors and reference-resolution offsets into CSS pixels. */
export function layoutAnchoredRect(layout: { anchorMinX: number; anchorMinY: number; anchorMaxX: number; anchorMaxY: number; offsetMinX: number; offsetMinY: number; offsetMaxX: number; offsetMaxY: number }, viewport: UiViewport): AnchoredRect {
  for (const value of [layout.anchorMinX, layout.anchorMinY, layout.anchorMaxX, layout.anchorMaxY, layout.offsetMinX, layout.offsetMinY, layout.offsetMaxX, layout.offsetMaxY]) if (!Number.isFinite(value)) throw new TypeError('UI anchors and offsets must be finite numbers.');
  if (layout.anchorMinX > layout.anchorMaxX || layout.anchorMinY > layout.anchorMaxY) throw new RangeError('UI minimum anchors must not exceed maximum anchors.');
  for (const value of [viewport.width, viewport.height, viewport.referenceWidth, viewport.referenceHeight]) if (!Number.isFinite(value) || value <= 0) throw new RangeError('UI viewport and reference dimensions must be positive finite numbers.');
  const sx = viewport.scaleMode === 'stretch' ? viewport.width / viewport.referenceWidth : Math.min(viewport.width / viewport.referenceWidth, viewport.height / viewport.referenceHeight);
  const sy = viewport.scaleMode === 'stretch' ? viewport.height / viewport.referenceHeight : sx;
  const padX = viewport.scaleMode === 'fit' ? (viewport.width - viewport.referenceWidth * sx) / 2 : 0;
  const padY = viewport.scaleMode === 'fit' ? (viewport.height - viewport.referenceHeight * sy) / 2 : 0;
  const left = padX + (layout.anchorMinX * viewport.referenceWidth + layout.offsetMinX) * sx;
  const top = padY + (layout.anchorMinY * viewport.referenceHeight + layout.offsetMinY) * sy;
  const right = padX + (layout.anchorMaxX * viewport.referenceWidth + layout.offsetMaxX) * sx;
  const bottom = padY + (layout.anchorMaxY * viewport.referenceHeight + layout.offsetMaxY) * sy;
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}
