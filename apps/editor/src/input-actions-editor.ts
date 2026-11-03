import { DEFAULT_INPUT_ACTIONS, InputActionMap, type InputActionDefinition, type InputBinding } from '@ecs/runtime';

type BindingKind = InputBinding['type'];

/** Small project-settings editor for the same bindings consumed by Play and web export. */
export function renderInputActionsEditor(host: HTMLElement, source: readonly InputActionDefinition[], onChange: (actions: readonly InputActionDefinition[]) => void) {
  let actions = new InputActionMap(source).toJSON().map(action => ({ name: action.name, bindings: [...action.bindings] }));
  let captureButton: HTMLButtonElement | undefined;
  const commit = () => {
    try { actions = new InputActionMap(actions).toJSON().map(action => ({ name: action.name, bindings: [...action.bindings] })); onChange(actions); render(); }
    catch (error) { host.querySelector<HTMLElement>('[data-error]')!.textContent = String(error); }
  };
  const field = (label: string, value: string, change: (value: string) => void) => {
    const wrapper = document.createElement('label'); wrapper.className = 'input-binding-field'; wrapper.append(document.createTextNode(label));
    const input = document.createElement('input'); input.value = value; input.setAttribute('aria-label', label); input.onchange = () => change(input.value); wrapper.append(input); return wrapper;
  };
  const button = (label: string) => { const value = document.createElement('button'); value.type = 'button'; value.textContent = label; return value; };
  function render() {
    host.replaceChildren();
    const intro = document.createElement('p'); intro.className = 'muted'; intro.textContent = 'Actions are project-wide. Scripts read them from api.input.actions; changes apply on the next Play and are included in project and web exports.'; host.append(intro);
    const error = document.createElement('p'); error.dataset.error = ''; error.className = 'input-actions-error'; host.append(error);
    for (const [actionIndex, action] of actions.entries()) {
      const card = document.createElement('section'); card.className = 'input-action-card';
      const heading = document.createElement('div'); heading.className = 'input-action-heading';
      heading.append(field('Action name', action.name, value => { action.name = value.trim(); commit(); }));
      const removeAction = button('Remove Action'); removeAction.setAttribute('aria-label', `Remove ${action.name} action`); removeAction.onclick = () => { actions.splice(actionIndex, 1); commit(); }; heading.append(removeAction); card.append(heading);
      action.bindings.forEach((binding, bindingIndex) => {
        const row = document.createElement('div'); row.className = 'input-binding-row';
        const type = document.createElement('select'); type.setAttribute('aria-label', `${action.name} binding type`);
        const types: [BindingKind, string][] = [['key', 'Keyboard key'], ['gamepadButton', 'Gamepad button'], ['gamepadAxis', 'Gamepad axis'], ['pointerButton', 'Mouse button']];
        for (const [value, label] of types) { const option = document.createElement('option'); option.value = value; option.textContent = label; option.selected = value === binding.type; type.append(option); }
        type.onchange = () => { const kind = type.value as BindingKind; action.bindings[bindingIndex] = kind === 'key' ? { type: kind, code: 'KeyE', value: 1 } : kind === 'gamepadButton' ? { type: kind, button: 0, value: 1 } : kind === 'gamepadAxis' ? { type: kind, axis: 0, scale: 1 } : { type: kind, button: 0, value: 1 }; commit(); };
        row.append(type);
        if (binding.type === 'key') {
          const capture = button(binding.code); capture.textContent = captureButton === capture ? 'Press a key…' : binding.code; capture.setAttribute('aria-label', `Bind key for ${action.name}`); capture.onclick = () => { captureButton = capture; capture.textContent = 'Press a key…'; };
          capture.onkeydown = event => { if (captureButton !== capture) return; event.preventDefault(); event.stopPropagation(); action.bindings[bindingIndex] = { ...binding, code: event.code }; captureButton = undefined; commit(); };
          row.append(capture, field('Value', String(binding.value), value => { action.bindings[bindingIndex] = { ...binding, value: Number(value) }; commit(); }));
        } else if (binding.type === 'gamepadButton' || binding.type === 'pointerButton') {
          row.append(field(binding.type === 'gamepadButton' ? 'Button index' : 'Mouse button index', String(binding.button), value => { action.bindings[bindingIndex] = { ...binding, button: Number(value) }; commit(); }), field('Value', String(binding.value), value => { action.bindings[bindingIndex] = { ...binding, value: Number(value) }; commit(); }));
        } else {
          row.append(field('Axis index', String(binding.axis), value => { action.bindings[bindingIndex] = { ...binding, axis: Number(value) }; commit(); }), field('Scale', String(binding.scale), value => { action.bindings[bindingIndex] = { ...binding, scale: Number(value) }; commit(); }));
        }
        const remove = button('Remove'); remove.setAttribute('aria-label', `Remove binding ${bindingIndex + 1} from ${action.name}`); remove.onclick = () => { action.bindings.splice(bindingIndex, 1); if (!action.bindings.length) action.bindings.push({ type: 'key', code: 'KeyE', value: 1 }); commit(); }; row.append(remove); card.append(row);
      });
      const add = button('+ Add Binding'); add.onclick = () => { action.bindings.push({ type: 'key', code: 'KeyE', value: 1 }); commit(); }; card.append(add);
      host.append(card);
    }
    const footer = document.createElement('div'); footer.className = 'input-actions-footer';
    const addAction = button('+ Add Action'); addAction.onclick = () => { const name = `action${actions.length + 1}`; actions.push({ name, bindings: [{ type: 'key', code: 'KeyE', value: 1 }] }); commit(); }; footer.append(addAction);
    const reset = button('Restore Defaults'); reset.onclick = () => { actions = new InputActionMap(DEFAULT_INPUT_ACTIONS).toJSON().map(action => ({ name: action.name, bindings: [...action.bindings] })); commit(); }; footer.append(reset); host.append(footer);
  }
  render();
}
