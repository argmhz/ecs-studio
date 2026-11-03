import { layoutAnchoredRect, type UiViewport } from '@ecs/ui';

export type UiOverlayItem =
  | { readonly id: string; readonly entityId: string; readonly kind: 'text'; readonly layout: AnchoredLayout; readonly text: string; readonly color: string; readonly fontSize: number; readonly align: string }
  | { readonly id: string; readonly entityId: string; readonly kind: 'image'; readonly layout: AnchoredLayout; readonly assetId: string | null; readonly fit: string }
  | { readonly id: string; readonly entityId: string; readonly kind: 'button'; readonly layout: AnchoredLayout; readonly text: string; readonly color: string; readonly background: string; readonly fontSize: number; readonly disabled: boolean };
export interface AnchoredLayout { readonly anchorMinX: number; readonly anchorMinY: number; readonly anchorMaxX: number; readonly anchorMaxY: number; readonly offsetMinX: number; readonly offsetMinY: number; readonly offsetMaxX: number; readonly offsetMaxY: number; }
export interface UiCanvasSettings { readonly referenceWidth: number; readonly referenceHeight: number; readonly scaleMode: 'fit' | 'stretch'; }

export function createUiOverlay(host: HTMLElement, resolveImage: (assetId: string) => Promise<string | undefined>, onButtonClick: (entityId: string) => void, interactive = true, className = 'game-ui-overlay') {
  const root = document.createElement('div'); root.className = className; root.setAttribute('aria-label', interactive ? 'Game UI' : 'Scene UI preview'); host.append(root);
  const nodes = new Map<string, HTMLElement>();
  let revision = 0;
  function update(items: readonly UiOverlayItem[], canvas: UiCanvasSettings) {
    const width = host.clientWidth, height = host.clientHeight;
    if (!width || !height) return;
    const viewport: UiViewport = { width, height, ...canvas };
    const ids = new Set(items.map(item => item.id));
    for (const [id, node] of nodes) if (!ids.has(id)) { node.remove(); nodes.delete(id); }
    for (const item of items) {
      let node = nodes.get(item.id);
      if (!node) {
        node = item.kind === 'button' ? document.createElement('button') : document.createElement(item.kind === 'image' ? 'img' : 'div');
        node.dataset.entityId = item.entityId; node.dataset.uiId = item.id; node.style.position = 'absolute';
        if (item.kind === 'button') { const button = node as HTMLButtonElement; button.type = 'button'; button.addEventListener('click', () => onButtonClick(item.entityId)); }
        nodes.set(item.id, node); root.append(node);
      }
      if (item.kind === 'button' && node.tagName !== 'BUTTON' || item.kind === 'image' && node.tagName !== 'IMG' || item.kind === 'text' && node.tagName !== 'DIV') { node.remove(); nodes.delete(item.id); update([item, ...items.filter(other => other.id !== item.id)], canvas); return; }
      const rect = layoutAnchoredRect(item.layout, viewport);
      Object.assign(node.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, boxSizing: 'border-box', overflow: 'hidden' });
      const scale = canvas.scaleMode === 'stretch' ? width / canvas.referenceWidth : Math.min(width / canvas.referenceWidth, height / canvas.referenceHeight);
      if (item.kind === 'text') { node.textContent = item.text; Object.assign(node.style, { color: item.color, fontSize: `${item.fontSize * scale}px`, textAlign: item.align, display: 'flex', alignItems: 'center', justifyContent: item.align === 'center' ? 'center' : item.align === 'right' ? 'flex-end' : 'flex-start', pointerEvents: 'none', whiteSpace: 'pre-wrap' }); }
      else if (item.kind === 'image') {
        const image = node as HTMLImageElement; image.alt = ''; image.style.objectFit = item.fit; image.style.pointerEvents = 'none';
        const key = `${item.id}:${item.assetId ?? ''}`;
        if (item.assetId && image.dataset.assetKey !== key) { image.dataset.assetKey = key; const current = ++revision; void resolveImage(item.assetId).then(url => { if (url && current <= revision && image.dataset.assetKey === key) image.src = url; }); }
        if (!item.assetId) { image.removeAttribute('src'); image.dataset.assetKey = ''; }
      } else { const button = node as HTMLButtonElement; button.textContent = item.text; button.disabled = item.disabled; Object.assign(button.style, { color: item.color, background: item.background, fontSize: `${item.fontSize * scale}px`, border: '1px solid #ffffff55', borderRadius: '4px', cursor: item.disabled ? 'default' : 'pointer', pointerEvents: interactive ? 'auto' : 'none' }); }
    }
  }
  return { update, setButtonHandler(handler: (entityId: string) => void) { onButtonClick = handler; }, dispose() { root.remove(); nodes.clear(); } };
}
