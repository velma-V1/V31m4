import { assertDomain } from "../domain-errors.js";
import { isCanonicalDurableId } from "../value-objects/ids.js";
import { fail, TASK_CAPSULE_LIMITS, text } from "./task-capsule-fields.js";

/**
 * The task DAG: the capsule's plan structure, and the one field with a shape of its own.
 *
 * Split out of `task-capsule.ts` to stay under the mandatory source-size limit. Validating a graph
 * is a different job from validating a record of scalars and id lists — it is the only field whose
 * admissibility depends on the relationships *between* its entries — so it is the natural seam.
 * The nodes this returns are frozen and canonical, exactly as before, and the fingerprint covers
 * them unchanged.
 */

export interface TaskDagNode {
  readonly id: string;
  readonly title: string;
  readonly dependsOn: readonly string[];
  readonly blocked: boolean;
}

export interface TaskDagNodeInput {
  readonly id: string;
  readonly title: string;
  readonly dependsOn?: readonly string[];
  readonly blocked?: boolean;
}

export /** Validates the DAG: canonical unique nodes, real dependencies, no self-edge, and acyclic. */
function buildDag(inputs: readonly TaskDagNodeInput[]): readonly TaskDagNode[] {
  assertDomain(
    Array.isArray(inputs) && inputs.length <= TASK_CAPSULE_LIMITS.maxDagNodes,
    "INVALID_TASK_CAPSULE",
    `A task DAG may hold at most ${TASK_CAPSULE_LIMITS.maxDagNodes} nodes.`,
    { count: Array.isArray(inputs) ? inputs.length : -1 },
  );

  const nodes = inputs.map((node) => {
    assertDomain(
      isCanonicalDurableId(node.id),
      "INVALID_TASK_CAPSULE",
      "A task DAG node identifier must use canonical durable-ID syntax.",
      { id: String(node.id) },
    );
    const dependsOn = node.dependsOn ?? [];
    assertDomain(
      Array.isArray(dependsOn) && dependsOn.length <= TASK_CAPSULE_LIMITS.maxDependenciesPerNode,
      "INVALID_TASK_CAPSULE",
      `A task DAG node may declare at most ${TASK_CAPSULE_LIMITS.maxDependenciesPerNode} dependencies.`,
      { id: node.id, count: Array.isArray(dependsOn) ? dependsOn.length : -1 },
    );
    assertDomain(
      new Set(dependsOn).size === dependsOn.length,
      "INVALID_TASK_CAPSULE",
      "Task DAG dependencies must be unique within a node.",
      { id: node.id },
    );
    assertDomain(
      !dependsOn.includes(node.id),
      "INVALID_TASK_CAPSULE",
      "A task DAG node cannot depend on itself.",
      { id: node.id },
    );
    return Object.freeze({
      id: node.id,
      title: text(node.title, "task DAG node title"),
      dependsOn: Object.freeze([...dependsOn]),
      blocked: node.blocked === true,
    });
  });

  const ids = nodes.map((node) => node.id);
  assertDomain(
    new Set(ids).size === ids.length,
    "INVALID_TASK_CAPSULE",
    "Task DAG node identifiers must be unique.",
  );
  const known = new Set(ids);
  let totalDependencies = 0;
  for (const node of nodes) {
    totalDependencies += node.dependsOn.length;
    for (const dependency of node.dependsOn) {
      assertDomain(
        known.has(dependency),
        "INVALID_TASK_CAPSULE",
        "A task DAG dependency must reference a node that exists.",
        { id: node.id, dependency },
      );
    }
  }
  assertDomain(
    totalDependencies <= TASK_CAPSULE_LIMITS.maxTotalDependencies,
    "INVALID_TASK_CAPSULE",
    `A task DAG may hold at most ${TASK_CAPSULE_LIMITS.maxTotalDependencies} dependencies.`,
    { totalDependencies },
  );
  assertAcyclic(nodes);
  return Object.freeze(nodes);
}

/** Iterative depth-first cycle detection; recursion would make a deep DAG a stack hazard. */
function assertAcyclic(nodes: readonly TaskDagNode[]): void {
  const edges = new Map(nodes.map((node) => [node.id, node.dependsOn]));
  const state = new Map<string, "visiting" | "done">();
  for (const start of edges.keys()) {
    if (state.get(start) === "done") continue;
    const stack: { readonly id: string; index: number }[] = [{ id: start, index: 0 }];
    state.set(start, "visiting");
    while (stack.length > 0) {
      const frame = stack[stack.length - 1] as { readonly id: string; index: number };
      const dependencies = edges.get(frame.id) ?? [];
      if (frame.index >= dependencies.length) {
        state.set(frame.id, "done");
        stack.pop();
        continue;
      }
      const next = dependencies[frame.index] as string;
      frame.index += 1;
      const seen = state.get(next);
      if (seen === "visiting") {
        fail("The task DAG contains a cycle.", { node: frame.id, dependency: next });
      }
      if (seen !== "done") {
        state.set(next, "visiting");
        stack.push({ id: next, index: 0 });
      }
    }
  }
}
