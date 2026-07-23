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
 * A proposal may only be blocked by work or a clarification for its own scope.
 * A null feature_id denotes a project-wide (general) clarification.
 */
export function planningScopeBlocker(
  scope: PlanningScope,
  tasks: PlanningTask[],
  questions: OpenClarification[],
): ScopeBlocker {
  if (scope.category === "general") {
    if (questions.some((question) => question.feature_id === null)) return "clarification";
    return tasks.some((task) => task.category === "general") ? "task" : null;
  }

  if (questions.some((question) => question.feature_id === scope.featureId)) return "clarification";
  return tasks.some((task) => task.feature_id === scope.featureId) ? "task" : null;
}

export function isPlanningScopeEligible(
  scope: PlanningScope,
  tasks: PlanningTask[],
  questions: OpenClarification[],
) {
  return planningScopeBlocker(scope, tasks, questions) === null;
}
