import React, { useEffect, useRef, useState } from 'react';
import type { FieldDefinition } from '@ecs/scene';

export interface InspectorOption { readonly value: string; readonly label: string; }
export interface InspectorViewField {
  readonly key: string;
  readonly label: string;
  readonly type: FieldDefinition['type'];
  readonly value: unknown;
  readonly min?: number;
  readonly max?: number;
  readonly options?: readonly InspectorOption[];
  readonly actionLabel?: string;
}
export interface InspectorViewGroup { readonly key: string; readonly title: string; readonly removable: boolean; readonly fields: readonly InspectorViewField[]; }
export interface InspectorViewProps {
  readonly prefabStatus?: string;
  readonly groups: readonly InspectorViewGroup[];
  readonly addable: readonly InspectorOption[];
  readonly collapsed: ReadonlySet<string>;
  readonly disabled: boolean;
  readonly onToggle: (key: string) => void;
  readonly onRemove: (key: string) => void;
  readonly onChange: (groupKey: string, fieldKey: string, value: unknown) => void;
  readonly onEditBegin?: (label: string) => void;
  readonly onPreview?: (groupKey: string, fieldKey: string, value: unknown) => boolean;
  readonly onEditEnd?: (cancel: boolean) => void;
  readonly onAdd: (typeId: string) => void;
  readonly onFieldAction: (groupKey: string, fieldKey: string) => void;
}

function InspectorField({ groupKey, field, disabled, onChange, onAction, onEditBegin, onPreview, onEditEnd }: { groupKey: string; field: InspectorViewField; disabled: boolean; onChange: InspectorViewProps['onChange']; onAction: InspectorViewProps['onFieldAction']; onEditBegin: InspectorViewProps['onEditBegin']; onPreview: InspectorViewProps['onPreview']; onEditEnd: InspectorViewProps['onEditEnd'] }) {
  const [draft, setDraft] = useState(String(field.value ?? ''));
  const editing = useRef(false), original = useRef(draft), lastValid = useRef(draft);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { if (!editing.current) { const value = String(field.value ?? ''); setDraft(value); original.current = value; lastValid.current = value; setInvalid(false); } }, [field.value]);
  const begin = () => { if (!editing.current && !disabled) { editing.current = true; original.current = lastValid.current; onEditBegin?.(field.label); } };
  const end = (cancel: boolean) => {
    if (!editing.current) return;
    editing.current = false; const value = cancel ? original.current : lastValid.current;
    setDraft(value); setInvalid(false); lastValid.current = value;
    if (onPreview) onEditEnd?.(cancel);
    else if (!cancel) onChange(groupKey, field.key, field.type === 'number' ? Number(value) : value);
  };
  const common = { 'aria-label': field.label, disabled };
  let control: React.ReactNode;
  if (field.options) {
    control = <select {...common} value={String(field.value ?? '')} onChange={event => onChange(groupKey, field.key, event.currentTarget.value)}>
      {field.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>;
  } else if (field.type === 'boolean') {
    control = <input {...common} type="checkbox" checked={Boolean(field.value)} onChange={event => onChange(groupKey, field.key, event.currentTarget.checked)} />;
  } else {
    const type = field.type === 'number' ? 'number' : field.type === 'color' ? 'color' : 'text';
    control = <input {...common} type={type} min={field.min} max={field.max} step={field.type === 'number' ? '0.1' : undefined} value={draft} aria-invalid={invalid || undefined} onFocus={begin} onChange={event => {
      begin(); const text = event.currentTarget.value; setDraft(text);
      const value = field.type === 'number' ? Number(text) : text;
      const complete = field.type !== 'number' || (/^[+-]?(?:\d+|\d*\.\d+)(?:e[+-]?\d+)?$/i.test(text) && Number.isFinite(value) && (field.min === undefined || Number(value) >= field.min) && (field.max === undefined || Number(value) <= field.max));
      const accepted = complete && (onPreview?.(groupKey, field.key, value) ?? true);
      if (accepted) lastValid.current = text;
      setInvalid(!accepted);
    }} onBlur={() => end(false)} onKeyDown={event => {
      if (event.key === 'Enter' || event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); end(event.key === 'Escape'); }
    }} />;
  }
  return <label className="inspector-field" key={field.key}>{field.label}{control}{field.actionLabel && <button type="button" className="field-action" aria-label={field.actionLabel} title={field.actionLabel} disabled={disabled} onClick={() => onAction(groupKey, field.key)}>＋</button>}</label>;
}

export function InspectorView(props: InspectorViewProps) {
  return <>
    {props.prefabStatus && <p className="prefab-instance-status">{props.prefabStatus}</p>}
    {props.groups.map(group => {
      const expanded = !props.collapsed.has(group.key);
      return <fieldset key={group.key}>
        <legend className="component-legend">
          <button type="button" className="component-toggle" aria-label={`${expanded ? 'Collapse' : 'Expand'} ${group.title}`} aria-expanded={expanded} onClick={() => props.onToggle(group.key)}>{expanded ? '⌄' : '›'} &nbsp; {group.title}</button>
          {group.removable && <button type="button" className="component-remove" aria-label="Remove component" title={`Remove ${group.title}`} disabled={props.disabled} onClick={() => props.onRemove(group.key)}>Remove</button>}
        </legend>
        <div className="component-fields" hidden={!expanded}>{group.fields.map(field => <InspectorField key={field.key} groupKey={group.key} field={field} disabled={props.disabled} onChange={props.onChange} onAction={props.onFieldAction} onEditBegin={props.onEditBegin} onPreview={props.onPreview} onEditEnd={props.onEditEnd} />)}</div>
      </fieldset>;
    })}
    {props.addable.length > 0 && <div className="component-actions"><select aria-label="Component to add" value="" disabled={props.disabled} onChange={event => { if (event.currentTarget.value) props.onAdd(event.currentTarget.value); }}>
      <option value="">＋ Add Component…</option>{props.addable.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
    </select></div>}
  </>;
}
