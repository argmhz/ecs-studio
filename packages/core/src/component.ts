/** Identity token for a component value stored in a World. */
export interface ComponentType<T = unknown> {
  readonly id: symbol;
  readonly name: string;
  /** Type-only field that keeps the value type attached to the token. */
  readonly __valueType?: T;
}

export function defineComponent<T>(name: string): ComponentType<T> {
  if (!name.trim()) throw new TypeError('Component name must not be empty.');
  return Object.freeze({ id: Symbol(name), name });
}
