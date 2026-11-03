export interface EditCommand<T> {
  readonly label: string;
  readonly before: T;
  readonly after: T;
}

/** Bounded, linear undo/redo history for atomic editor changes. */
export class EditHistory<T> {
  private readonly undoCommands: EditCommand<T>[] = [];
  private readonly redoCommands: EditCommand<T>[] = [];
  private readonly limit: number;

  constructor(limit = 100) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('History limit must be a positive integer.');
    this.limit = limit;
  }

  get canUndo(): boolean { return this.undoCommands.length > 0; }
  get canRedo(): boolean { return this.redoCommands.length > 0; }
  get undoLabel(): string | undefined { return this.undoCommands.at(-1)?.label; }
  get redoLabel(): string | undefined { return this.redoCommands.at(-1)?.label; }

  record(label: string, before: T, after: T): void {
    if (!label.trim()) throw new TypeError('Edit command label must not be empty.');
    this.undoCommands.push({ label, before, after });
    if (this.undoCommands.length > this.limit) this.undoCommands.shift();
    this.redoCommands.length = 0;
  }

  undo(): EditCommand<T> | undefined {
    const command = this.undoCommands.pop();
    if (command) this.redoCommands.push(command);
    return command;
  }

  redo(): EditCommand<T> | undefined {
    const command = this.redoCommands.pop();
    if (command) this.undoCommands.push(command);
    return command;
  }

  clear(): void { this.undoCommands.length = 0; this.redoCommands.length = 0; }
}
