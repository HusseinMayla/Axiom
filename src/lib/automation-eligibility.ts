export type PlanningScope =
  | { category: "general" }
  | { category: "feature"; featureId: string };

export type PlanningTask = {
  category: string;
  feature_id: string | null;
};

export type OpenClarification = {
  feature_id: string | null;
};

export type ScopeBlocker = "task" | "clarification" | null;

/**
 * Counts live planning obligations for one scope. Historical completed or
 * archived tasks are intentionally absent from `tasks` before this function is
 * called, so they never prevent a future improvement from being proposed.
 */
export function planningScopeCounter(
  scope: PlanningScope,
  tasks: PlanningTask[],
  questions: OpenClarification[],
) {
  if (scope.category === "general") {
    return tasks.filter((task) => task.category === "general").length
      + questions.filter((question) => question.feature_id === null).length;
  }
  return tasks.filter((task) => task.feature_id === scope.featureId).length
    + questions.filter((question) => question.feature_id === scope.featureId).length;
}

/**
 * A proposal may only be blocked by work or a clarification for its own scope.
 * A null feature_id denotes a project-wide (general) clarification.
 */
export function planningScopeBlocker(
  scope: PlanningScope,
  tasks: PlanningTask[],
  questions: OpenClarification[],
): ScopeBlocker {
  if (planningScopeCounter(scope, tasks, questions) === 0) return null;
  if (scope.category === "general") {
    if (questions.some((question) => question.feature_id === null)) return "clarification";
    return "task";
  }

  if (questions.some((question) => question.feature_id === scope.featureId)) return "clarification";
  return "task";
}

export function isPlanningScopeEligible(
  scope: PlanningScope,
  tasks: PlanningTask[],
  questions: OpenClarification[],
) {
  return planningScopeBlocker(scope, tasks, questions) === null;
}
