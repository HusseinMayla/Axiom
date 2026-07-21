import { z } from "zod";

export const implementationStateSchema = z.enum([
  "not_started",
  "in_progress",
  "awaiting_review",
  "implemented",
  "blocked",
  "unknown",
]);

export const currentStatusSchema = z.object({
  implementation_state: implementationStateSchema,
  summary: z.string(),
  confirmed_by: z.enum(["human", "scanner", "task_outcome", "system"]),
  confirmed_at: z.string(),
  active_task: z.object({
    task_id: z.string(),
    category: z.enum(["general", "feature"]),
    objective: z.string(),
    task_state: z.string(),
    planned_files: z.array(z.string()),
    expected_changes: z.array(z.string()),
    completed_changes: z.array(z.string()),
    remaining_work: z.array(z.string()),
    latest_report: z.string().nullable(),
  }).nullable(),
  code_snapshot: z.object({
    files_created: z.array(z.string()),
    files_modified: z.array(z.string()),
    modules_or_interfaces: z.array(z.string()),
    schema_or_configuration: z.array(z.string()),
    available_behavior: z.array(z.string()),
    validation_results: z.array(z.string()),
  }),
  completed_work: z.array(z.object({
    task_id: z.string(),
    summary: z.string(),
    evidence_paths: z.array(z.string()),
    completed_at: z.string(),
  })),
  evidence_paths: z.array(z.string()),
  known_gaps: z.array(z.string()),
  blockers: z.array(z.string()),
});

export type CurrentStatus = z.infer<typeof currentStatusSchema>;

function emptyCodeSnapshot() {
  return {
    files_created: [],
    files_modified: [],
    modules_or_interfaces: [],
    schema_or_configuration: [],
    available_behavior: [],
    validation_results: [],
  };
}

export function initialProjectCurrentStatus(hasEmptyRepositoryEvidence: boolean): CurrentStatus {
  const now = new Date().toISOString();
  return {
    implementation_state: hasEmptyRepositoryEvidence ? "not_started" : "unknown",
    summary: hasEmptyRepositoryEvidence
      ? "The repository scan found no application source files; no project foundation is implemented."
      : "No implementation state has been confirmed by a task outcome or human review.",
    confirmed_by: hasEmptyRepositoryEvidence ? "scanner" : "system",
    confirmed_at: now,
    active_task: null,
    code_snapshot: emptyCodeSnapshot(),
    completed_work: [],
    evidence_paths: [],
    known_gaps: hasEmptyRepositoryEvidence
      ? ["Project structure, approved technology stack, and runtime configuration have not been implemented."]
      : ["Confirm the implemented project foundation before planning feature work."],
    blockers: [],
  };
}

export function initialFeatureCurrentStatus(): CurrentStatus {
  return {
    implementation_state: "not_started",
    summary: "No implementation has been confirmed for this feature.",
    confirmed_by: "system",
    confirmed_at: new Date().toISOString(),
    active_task: null,
    code_snapshot: emptyCodeSnapshot(),
    completed_work: [],
    evidence_paths: [],
    known_gaps: ["Feature implementation has not started."],
    blockers: [],
  };
}
