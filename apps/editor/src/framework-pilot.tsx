import React, { useReducer } from 'react';
import { createRoot } from 'react-dom/client';
import './framework-pilot.css';

type Field = { label: string; type: 'number' | 'color' | 'boolean' | 'enum' | 'asset' | 'script'; options?: string[]; min?: number; max?: number };
type ComponentSchema = { id: string; label: string; removable: boolean; fields: Record<string, Field> };
type ComponentState = { schemaId: string; data: Record<string, string | number | boolean> };
type State = { components: ComponentState[]; collapsed: string[]; nextId: number };
type Action = { type: 'set'; componentId: string; field: string; value: string | number | boolean } | { type: 'toggle'; componentId: string } | { type: 'add'; schemaId: string } | { type: 'remove'; componentId: string };

const schemas: ComponentSchema[] = [
  { id: 'transform', label: 'Transform 2D', removable: false, fields: { x: { label: 'Position X', type: 'number' }, y: { label: 'Position Y', type: 'number' }, rotation: { label: 'Rotation', type: 'number' }, scale: { label: 'Scale', type: 'number', min: 0 } } },
  { id: 'sprite', label: 'Sprite Renderer 2D', removable: true, fields: { image: { label: 'Image', type: 'asset' }, tint: { label: 'Tint', type: 'color' }, order: { label: 'Sorting Order', type: 'number' }, visible: { label: 'Visible', type: 'boolean' } } },
  { id: 'script', label: 'Script Binding', removable: true, fields: { enabled: { label: 'Enabled', type: 'boolean' }, code: { label: 'Code File', type: 'script' }, lifecycle: { label: 'Lifecycle', type: 'enum', options: ['onStart / onUpdate / onStop'] } } },
  { id: 'physics', label: 'Physics 2D', removable: true, fields: { bodyType: { label: 'Body Type', type: 'enum', options: ['dynamic', 'fixed', 'kinematic'] }, gravityScale: { label: 'Gravity Scale', type: 'number' } } },
];
const initial: State = { components: [
  { schemaId: 'transform', data: { x: 2, y: 1, rotation: 0, scale: 1 } },
  { schemaId: 'sprite', data: { image: 'Textures/Player.png', tint: '#c5bbff', order: 0, visible: true } },
  { schemaId: 'script', data: { enabled: true, code: 'scripts/player.ts', lifecycle: 'onStart / onUpdate / onStop' } },
], collapsed: [], nextId: 1 };
function reducer(state: State, action: Action): State {
  if (action.type === 'set') return { ...state, components: state.components.map(component => component.schemaId === action.componentId ? { ...component, data: { ...component.data, [action.field]: action.value } } : component) };
  if (action.type === 'toggle') return { ...state, collapsed: state.collapsed.includes(action.componentId) ? state.collapsed.filter(id => id !== action.componentId) : [...state.collapsed, action.componentId] };
  if (action.type === 'remove') return { ...state, components: state.components.filter(component => component.schemaId !== action.componentId) };
  const schema = schemas.find(item => item.id === action.schemaId);
  if (!schema) return state;
  const data = Object.fromEntries(Object.entries(schema.fields).map(([key, field]) => [key, field.type === 'boolean' ? true : field.type === 'number' ? 0 : field.type === 'color' ? '#ffffff' : field.options?.[0] ?? ''])) as ComponentState['data'];
  return { ...state, components: [...state.components, { schemaId: `${schema.id}-${state.nextId}`, data }], nextId: state.nextId + 1 };
}
function InspectorField({ name, field, value, onChange }: { name: string; field: Field; value: string | number | boolean; onChange: (value: string | number | boolean) => void }) {
  const common = { 'aria-label': field.label };
  if (field.type === 'boolean') return <label>{field.label}<input {...common} type="checkbox" checked={Boolean(value)} onChange={event => onChange(event.currentTarget.checked)} /></label>;
  if (field.type === 'number') return <label>{field.label}<input {...common} type="number" min={field.min} max={field.max} step="0.1" value={Number(value)} onChange={event => onChange(Number(event.currentTarget.value))} /></label>;
  if (field.type === 'color') return <label>{field.label}<input {...common} type="color" value={String(value)} onChange={event => onChange(event.currentTarget.value)} /></label>;
  const options = field.type === 'asset' ? ['Textures/Player.png', 'Textures/Crate.png', 'Textures/Ground.png'] : field.type === 'script' ? ['scripts/player.ts', 'scripts/enemy.ts', 'scripts/mover.ts'] : field.options ?? [];
  return <label>{field.label}<select {...common} value={String(value)} onChange={event => onChange(event.currentTarget.value)}>{options.map(option => <option key={option}>{option}</option>)}</select></label>;
}
function Inspector() {
  const [state, dispatch] = useReducer(reducer, initial);
  const present = new Set(state.components.map(component => component.schemaId.replace(/-\d+$/, '')));
  const addable = schemas.filter(schema => schema.removable && !present.has(schema.id));
  return <main>
    <header><div><span className="eyebrow">TECHNICAL SPIKE · T001</span><h1>React Inspector Pilot</h1><p>Schema-driven component fields, dynamic add/remove, and persistent fold state.</p></div><a href="./">← Back to editor</a></header>
    <div className="layout"><aside className="panel"><h2>Inspector</h2><div className="object-title">◇ &nbsp; Player <small>Scene object</small></div>
      {state.components.map(component => {
        const schema = schemas.find(item => component.schemaId === item.id || component.schemaId.startsWith(`${item.id}-`));
        if (!schema) return null;
        const collapsed = state.collapsed.includes(component.schemaId);
        return <section className="component" key={component.schemaId}>
          <div className="component-head"><button className="toggle" aria-expanded={!collapsed} onClick={() => dispatch({ type: 'toggle', componentId: component.schemaId })}>{collapsed ? '›' : '⌄'} &nbsp; {schema.label}</button>{schema.removable && <button className="remove" onClick={() => dispatch({ type: 'remove', componentId: component.schemaId })}>Remove</button>}</div>
          {!collapsed && <div className="fields">{Object.entries(schema.fields).map(([name, field]) => <InspectorField key={name} name={name} field={field} value={component.data[name] ?? ''} onChange={value => dispatch({ type: 'set', componentId: component.schemaId, field: name, value })} />)}</div>}
        </section>;
      })}
      {addable.length > 0 && <select aria-label="Component to add" value="" onChange={event => { if (event.currentTarget.value) dispatch({ type: 'add', schemaId: event.currentTarget.value }); }}><option value="">＋ Add Component…</option>{addable.map(schema => <option key={schema.id} value={schema.id}>{schema.label}</option>)}</select>}
    </aside><section className="notes"><h2>What this tests</h2><ul><li>Field controls come from component schema metadata.</li><li>Updating one value leaves other component groups and collapse state intact.</li><li>Adding/removing components is a small state transition.</li><li>Renderer, canvas, and game loop remain outside React.</li></ul><div className="state"><strong>Live inspector state</strong><pre>{JSON.stringify({ components: state.components.map(({ schemaId, data }) => ({ schemaId, data })), collapsed: state.collapsed }, null, 2)}</pre></div></section></div>
    <footer>Isolated experiment. This page does not alter the production editor.</footer>
  </main>;
}

createRoot(document.getElementById('react-pilot')!).render(<React.StrictMode><Inspector /></React.StrictMode>);
