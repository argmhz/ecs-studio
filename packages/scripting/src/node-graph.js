/** Raised when a declarative control-flow graph exceeds its visit budget. */
export const MAX_NODE_VISITS_PER_RUN = 10_000;

export class GraphExecutionBudgetError extends Error {
  /** @param {number} maxNodeVisits */
  constructor(maxNodeVisits) {
    super(`Node graph exceeded its budget of ${maxNodeVisits} node visits.`);
    this.name = 'GraphExecutionBudgetError';
    this.maxNodeVisits = maxNodeVisits;
  }
}

/**
 * Walk a declarative control-flow graph with a per-run visit budget.
 * Node behavior remains engine-owned; user source is never invoked by this helper.
 * @param {string} entryNodeId
 * @param {readonly { id: string, next?: string | null }[]} nodes
 * @param {{ maxNodeVisits?: number, signal?: AbortSignal }} [options]
 */
export function runNodeGraph(entryNodeId, nodes, { maxNodeVisits = MAX_NODE_VISITS_PER_RUN, signal } = {}) {
  if (!Number.isSafeInteger(maxNodeVisits) || maxNodeVisits < 1 || maxNodeVisits > MAX_NODE_VISITS_PER_RUN) throw new RangeError(`maxNodeVisits must be between 1 and ${MAX_NODE_VISITS_PER_RUN}.`);
  const byId = new Map();
  for (const node of nodes) {
    if (!node || typeof node.id !== 'string' || !node.id) throw new TypeError('Every graph node must have a non-empty ID.');
    if (byId.has(node.id)) throw new Error(`Duplicate graph node ID "${node.id}".`);
    byId.set(node.id, node);
  }
  if (!byId.has(entryNodeId)) throw new Error(`Unknown entry node "${entryNodeId}".`);

  let currentId = entryNodeId;
  const visitedNodeIds = [];
  while (currentId !== null && currentId !== undefined) {
    if (signal?.aborted) throw new Error('Node graph cancelled.');
    if (visitedNodeIds.length >= maxNodeVisits) throw new GraphExecutionBudgetError(maxNodeVisits);
    const node = byId.get(currentId);
    if (!node) throw new Error(`Graph node "${currentId}" references a missing next node.`);
    visitedNodeIds.push(node.id);
    currentId = node.next ?? null;
  }
  return { visits: visitedNodeIds.length, visitedNodeIds };
}
