type CodeSnapshot = {
  files_created: string[];
  files_modified: string[];
  modules_or_interfaces: string[];
  schema_or_configuration: string[];
  available_behavior: string[];
  validation_results: string[];
};

type Status = {
  implementation_state?: string;
  summary?: string;
  confirmed_by?: string;
  confirmed_at?: string;
  active_task?: {
    objective?: string;
    task_state?: string;
    planned_files?: string[];
    expected_changes?: string[];
    completed_changes?: string[];
    remaining_work?: string[];
    latest_report?: string | null;
  } | null;
  code_snapshot?: Partial<CodeSnapshot>;
  completed_work?: Array<{ task_id?: string; summary?: string; evidence_paths?: string[]; completed_at?: string }>;
  evidence_paths?: string[];
  known_gaps?: string[];
  blockers?: string[];
};

type FeatureStatus = { id: string; name: string; status: Status };

export function ImplementationStatusPanel({ projectStatus, featureStatuses }: { projectStatus: Status; featureStatuses: FeatureStatus[] }) {
  return (
    <section className="synthesis-panel implementation-panel">
      <div className="synthesis-heading">
        <div>
          <p className="eyebrow">IMPLEMENTATION SNAPSHOT</p>
          <h2>What Axiom believes exists</h2>
          <p className="panel-copy">This is the human-approved, report-backed implementation record. It is designed to explain the current code shape without forcing the planner to infer it from source files.</p>
        </div>
      </div>
      <StatusCard title="Project" status={projectStatus} />
      {featureStatuses.length > 0 && <div className="status-feature-grid">
        {featureStatuses.map((feature) => <StatusCard key={feature.id} title={feature.name} status={feature.status} compact />)}
      </div>}
    </section>
  );
}

function StatusCard({ title, status, compact = false }: { title: string; status: Status; compact?: boolean }) {
  const snapshot = status.code_snapshot ?? {};
  const state = status.implementation_state?.replaceAll("_", " ") ?? "unknown";
  return (
    <article className={compact ? "status-card compact" : "status-card"}>
      <p className="eyebrow">{title} · {state}</p>
      <h3>{status.summary ?? "No implementation status has been recorded."}</h3>
      <p className="status-confirmation">Confirmed by {status.confirmed_by ?? "unknown"}{status.confirmed_at ? " · " + new Date(status.confirmed_at).toLocaleString() : ""}</p>
      {status.active_task && <details className="use-case-details" open={!compact}>
        <summary>Active work: {status.active_task.objective ?? "unnamed task"}</summary>
        <StatusList title="Planned files" items={status.active_task.planned_files ?? []} />
        <StatusList title="Expected changes" items={status.active_task.expected_changes ?? []} />
        <StatusList title="Completed changes" items={status.active_task.completed_changes ?? []} />
        <StatusList title="Remaining work" items={status.active_task.remaining_work ?? []} />
        {status.active_task.latest_report && <article><strong>Latest report</strong><p>{status.active_task.latest_report}</p></article>}
      </details>}
      <details className="use-case-details" open={!compact}>
        <summary>Code snapshot</summary>
        <StatusList title="Files created" items={snapshot.files_created ?? []} />
        <StatusList title="Files modified" items={snapshot.files_modified ?? []} />
        <StatusList title="Modules and interfaces" items={snapshot.modules_or_interfaces ?? []} />
        <StatusList title="Schema and configuration" items={snapshot.schema_or_configuration ?? []} />
        <StatusList title="Available behavior" items={snapshot.available_behavior ?? []} />
        <StatusList title="Validation results" items={snapshot.validation_results ?? []} />
      </details>
      <StatusList title="Known gaps" items={status.known_gaps ?? []} />
      <StatusList title="Blockers" items={status.blockers ?? []} />
    </article>
  );
}

function StatusList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return <article className="status-list-block"><strong>{title}</strong><ul>{items.map((item) => <li key={item}>{item}</li>)}</ul></article>;
}
