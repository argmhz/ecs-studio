import { defineComponent } from '@ecs/core';
import { defineComponentSchema, type ComponentSchema } from '@ecs/scene';

export type UiScaleMode = 'fit' | 'stretch';
export interface UiCanvasData { referenceWidth: number; referenceHeight: number; scaleMode: UiScaleMode; }
export interface UiLayoutData { anchorMinX: number; anchorMinY: number; anchorMaxX: number; anchorMaxY: number; offsetMinX: number; offsetMinY: number; offsetMaxX: number; offsetMaxY: number; }
export interface UiTextData extends UiLayoutData { text: string; color: string; fontSize: number; align: 'left' | 'center' | 'right'; }
export interface UiImageData extends UiLayoutData { asset: { assetId: string } | null; fit: 'contain' | 'cover' | 'fill'; }
export interface UiButtonData extends UiLayoutData { text: string; color: string; background: string; fontSize: number; disabled: boolean; }

export const UiCanvas = defineComponent<UiCanvasData>('UiCanvas');
export const UiText = defineComponent<UiTextData>('UiText');
export const UiImage = defineComponent<UiImageData>('UiImage');
export const UiButton = defineComponent<UiButtonData>('UiButton');

const layoutFields = {
  anchorMinX: { type: 'number', label: 'Anchor Min X', default: 0, min: 0, max: 1 },
  anchorMinY: { type: 'number', label: 'Anchor Min Y', default: 0, min: 0, max: 1 },
  anchorMaxX: { type: 'number', label: 'Anchor Max X', default: 0, min: 0, max: 1 },
  anchorMaxY: { type: 'number', label: 'Anchor Max Y', default: 0, min: 0, max: 1 },
  offsetMinX: { type: 'number', label: 'Offset Min X', default: 32 }, offsetMinY: { type: 'number', label: 'Offset Min Y', default: 32 },
  offsetMaxX: { type: 'number', label: 'Offset Max X', default: 192 }, offsetMaxY: { type: 'number', label: 'Offset Max Y', default: 80 },
} as const;

export const uiCanvasSchema = defineComponentSchema({ typeId: 'engine.uiCanvas', displayName: 'UI Canvas', version: 1, component: UiCanvas,
  fields: { referenceWidth: { type: 'number', label: 'Reference Width', default: 800, min: 1 }, referenceHeight: { type: 'number', label: 'Reference Height', default: 600, min: 1 }, scaleMode: { type: 'enum', label: 'Scale Mode', default: 'fit', options: ['fit', 'stretch'] } },
});
export const uiTextSchema = defineComponentSchema({ typeId: 'engine.uiText', displayName: 'UI Text', version: 1, component: UiText,
  fields: { ...layoutFields, text: { type: 'string', label: 'Text', default: 'Text' }, color: { type: 'color', label: 'Color', default: '#ffffff' }, fontSize: { type: 'number', label: 'Font Size', default: 24, min: 1, max: 256 }, align: { type: 'enum', label: 'Alignment', default: 'left', options: ['left', 'center', 'right'] } },
});
export const uiImageSchema = defineComponentSchema({ typeId: 'engine.uiImage', displayName: 'UI Image', version: 1, component: UiImage,
  fields: { ...layoutFields, asset: { type: 'asset', label: 'Image', default: null, kind: 'image' }, fit: { type: 'enum', label: 'Fit', default: 'contain', options: ['contain', 'cover', 'fill'] } },
});
export const uiButtonSchema = defineComponentSchema({ typeId: 'engine.uiButton', displayName: 'UI Button', version: 1, component: UiButton,
  fields: { ...layoutFields, text: { type: 'string', label: 'Label', default: 'Button' }, color: { type: 'color', label: 'Text Color', default: '#ffffff' }, background: { type: 'color', label: 'Background', default: '#51458a' }, fontSize: { type: 'number', label: 'Font Size', default: 18, min: 1, max: 256 }, disabled: { type: 'boolean', label: 'Disabled', default: false } },
});
export const uiSchemas: readonly ComponentSchema[] = [uiCanvasSchema, uiTextSchema, uiImageSchema, uiButtonSchema];
