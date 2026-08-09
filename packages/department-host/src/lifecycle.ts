import { ApplicationError } from "@v31m4/application";

/** Lifecycle states a department moves through under host control. */
export type DepartmentLifecycleState =
  | "installed"
  | "enabled"
  | "started"
  | "stopped"
  | "disabled"
  | "removed";

/**
 * Allowed forward transitions. A started department must be stopped before it can be disabled or
 * removed, so removal never tears down a live instance out from under in-flight work.
 */
const TRANSITIONS: Readonly<Record<DepartmentLifecycleState, readonly DepartmentLifecycleState[]>> =
  {
    installed: ["enabled", "disabled", "removed"],
    enabled: ["started", "disabled", "removed"],
    started: ["stopped"],
    stopped: ["started", "disabled", "removed"],
    disabled: ["enabled", "removed"],
    removed: [],
  };

export function canTransition(
  from: DepartmentLifecycleState,
  to: DepartmentLifecycleState,
): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Throws `CONFLICT` when a lifecycle verb is invoked from a state that does not permit it. */
export function assertTransition(
  departmentId: string,
  from: DepartmentLifecycleState,
  to: DepartmentLifecycleState,
): void {
  if (!canTransition(from, to)) {
    throw new ApplicationError("CONFLICT", `Department cannot move from '${from}' to '${to}'.`, {
      details: { departmentId, from, to },
    });
  }
}
