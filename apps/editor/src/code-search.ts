export interface CodeSearchHit { readonly path: string; readonly line: number; readonly column: number; readonly snippet: string; }

export function findInProjectScripts(files: Readonly<Record<string, string>>, query: string): CodeSearchHit[] {
  const needle = query.trim().toLocaleLowerCase(); if (!needle) return [];
  const hits: CodeSearchHit[] = [];
  for (const [path, source] of Object.entries(files)) source.split('\n').forEach((text, index) => {
    const column = text.toLocaleLowerCase().indexOf(needle);
    if (column >= 0) hits.push({ path, line: index + 1, column: column + 1, snippet: text.trim().slice(0, 120) });
  });
  return hits;
}
