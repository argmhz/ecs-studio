import { validateGameView, type GameViewSettings } from '@ecs/rendering';

export function renderGameViewEditor(host: HTMLElement, settings: GameViewSettings, onChange: (settings: GameViewSettings) => void, onCreateCamera: () => void, disabled: boolean) {
  host.replaceChildren();
  const mode = document.createElement('select'); mode.setAttribute('aria-label', 'Game View mode');
  for (const [value, label] of [['Free', 'Free aspect (panel size)'], ['Fit', 'Fixed resolution (Fit)']]) { const option = document.createElement('option'); option.value = value!; option.textContent = label!; mode.append(option); }
  mode.value = settings.mode; mode.disabled = disabled;
  const width = number('Game View width', settings.width), height = number('Game View height', settings.height);
  function number(label: string, value: number) { const input = document.createElement('input'); input.type = 'number'; input.min = '1'; input.max = '8192'; input.step = '1'; input.value = String(value); input.setAttribute('aria-label', label); input.disabled = disabled; return input; }
  const error = document.createElement('p'); error.setAttribute('role', 'status'); error.className = 'input-actions-error';
  const commit = () => { try { onChange(validateGameView({ mode: mode.value, width: Number(width.value), height: Number(height.value) })); error.textContent = ''; } catch (cause) { error.textContent = String(cause); } };
  for (const [label, control] of [['Mode', mode], ['Width', width], ['Height', height]] as const) { const field = document.createElement('label'); field.textContent = label; field.append(control); host.append(field); control.addEventListener('change', commit); }
  const create = document.createElement('button'); create.type = 'button'; create.textContent = 'Add Camera to Scene'; create.disabled = disabled; create.onclick = onCreateCamera;
  const help = document.createElement('p'); help.textContent = 'Fixed resolution preserves the aspect ratio with black bars. Camera 2D controls the visible world height and can follow an entity. Existing scenes without a camera keep their legacy view.';
  host.append(create, error, help);
}
