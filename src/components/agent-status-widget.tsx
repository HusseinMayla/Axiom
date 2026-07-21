"use client";

import { useEffect, useState } from "react";

type ExecutionEvent = {
  id: string;
  step: number;
  tool_name: string;
  tool_args: unknown;
  tool_result: unknown;
  status: "completed" | "failed";
  created_at: string;
  finished_at?: string;
};

type TaskRun = {
  id: string;
  objective: string;
  state: string;
  step: number;
  maxSteps: number;
  branchName: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  events: ExecutionEvent[];
};

type ActiveExecutionPayload = {
  active: boolean;
  taskRun: TaskRun | null;
};

export function formatAgentAction(toolName: string, toolArgs: unknown): string {
  if (!toolName) return "ready";
  const args = (toolArgs ?? {}) as Record<string, unknown>;
  switch (toolName) {
    case "inspect_files": {
      const paths = Array.isArray(args.paths) ? (args.paths as string[]) : [];
      if (paths.length === 0) return "reading files";
      const file = shortenPath(paths[0]);
      if (paths.length === 1) return `reading ${file}`;
      return `reading ${file} (+${paths.length - 1} more)`;
    }
    case "write_files": {
      const paths = Array.isArray(args.paths) ? (args.paths as string[]) : [];
      if (paths.length === 0) return "editing files";
      const file = shortenPath(paths[0]);
      if (paths.length === 1) return `editing ${file}`;
      return `editing ${file} (+${paths.length - 1} more)`;
    }
    case "run_command": {
      const cmd = typeof args.command === "string" ? args.command : "";
      return cmd ? `running ${cmd}` : "executing command";
    }
    case "run_validation": {
      const cmds = Array.isArray(args.commands) ? (args.commands as string[]) : [];
      if (cmds.length === 0) return "running validation";
      return `validating ${cmds.map(shortenPath).join(", ")}`;
    }
    case "finish_task":
      return "finishing task";
    case "prepare_dependencies":
      return "preparing workspace dependencies";
    case "invalid_tool_call":
      return "re-evaluating agent step";
    default:
      return toolName.replaceAll("_", " ");
  }
}

export function formatAgentStepSummary(
  step: number,
  toolName: string,
  toolArgs: unknown,
  toolResult: unknown,
  createdAt?: string,
  finishedAt?: string
): { turnLabel: string; thinkingText: string; actionText: string; fullSummary: string } {
  const result = (toolResult ?? {}) as Record<string, unknown>;
  const turnLabel = toolName === "final_validation" ? "final validation" : `turn ${step}/30`;

  const thinkingSec: number | null = typeof result.thinking_ms === "number" ? Math.round(result.thinking_ms / 1000) : null;
  let actionSec: number | null = typeof result.action_ms === "number" ? Math.round(result.action_ms / 1000) : null;

  if (actionSec === null && createdAt && finishedAt) {
    const start = new Date(createdAt).getTime();
    const end = new Date(finishedAt).getTime();
    if (!isNaN(start) && !isNaN(end) && end >= start) {
      actionSec = Math.round((end - start) / 1000);
    }
  }

  const thinkingText = thinkingSec !== null ? `thinking for ${thinkingSec}s` : "thinking";
  const rawActionText = formatAgentAction(toolName, toolArgs);
  const actionText = actionSec !== null ? `${rawActionText} for ${actionSec}s` : rawActionText;

  return {
    turnLabel,
    thinkingText,
    actionText,
    fullSummary: `${thinkingText}, ${actionText}`,
  };
}

export function getAgentObservation(toolName: string, toolResult: unknown): string | null {
  if (!toolResult || typeof toolResult !== "object") return null;
  const result = toolResult as Record<string, unknown>;

  if (typeof result.output === "string" && result.output.trim().length > 0) {
    return result.output.trim();
  }

  if (typeof result.stdout === "string" || typeof result.stderr === "string") {
    const stdout = typeof result.stdout === "string" ? result.stdout : "";
    const stderr = typeof result.stderr === "string" ? result.stderr : "";
    const combined = (stdout + "\n" + stderr).trim();
    if (combined.length > 0) return combined;
  }

  if (Array.isArray(result.results)) {
    const formatted = result.results
      .map((item) => {
        const res = item as Record<string, unknown>;
        const cmd = typeof res.command === "string" ? res.command : "command";
        const code = typeof res.exitCode === "number" ? res.exitCode : 0;
        const out = typeof res.output === "string" ? res.output : "";
        return `$ ${cmd} (exit ${code})\n${out}`;
      })
      .join("\n\n")
      .trim();
    if (formatted.length > 0) return formatted;
  }

  if (Array.isArray(result.files)) {
    const formatted = result.files
      .map((file) => {
        const item = file as Record<string, unknown>;
        const path = typeof item.path === "string" ? item.path : "file";
        const content = typeof item.content === "string" ? item.content : "";
        return `--- ${path} ---\n${content}`;
      })
      .join("\n\n")
      .trim();
    if (formatted.length > 0) return formatted;
  }

  if (typeof result.message === "string" && result.message.trim().length > 0) {
    return result.message.trim();
  }

  if (typeof result.error === "string" && result.error.trim().length > 0) {
    return result.error.trim();
  }

  if (result.report && typeof result.report === "object") {
    return JSON.stringify(result.report, null, 2);
  }

  return null;
}

function shortenPath(pathStr: string): string {
  if (!pathStr) return "";
  const parts = pathStr.split("/");
  if (parts.length > 2) {
    return parts.slice(-2).join("/");
  }
  return pathStr;
}

export function AgentStatusWidget({ projectId }: { projectId: string }) {
  const [data, setData] = useState<ActiveExecutionPayload | null>(null);
  const [isMinimized, setIsMinimized] = useState(false);
  const [userToggled, setUserToggled] = useState(false);
  const [expandedEvents, setExpandedEvents] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/active-execution`, { cache: "no-store" });
        if (!res.ok) throw new Error("Failed to fetch active execution");
        const payload = (await res.json()) as ActiveExecutionPayload;
        if (cancelled) return;
        setData(payload);

        if (payload.active && !userToggled) {
          setIsMinimized(false);
        }

        timer = setTimeout(poll, payload.active ? 1500 : 3500);
      } catch {
        if (!cancelled) timer = setTimeout(poll, 4000);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [projectId, userToggled]);

  const toggleEventExpand = (eventId: string) => {
    setExpandedEvents((prev) => ({ ...prev, [eventId]: !prev[eventId] }));
  };

  const isActive = Boolean(data?.active);
  const taskRun = data?.taskRun;
  const step = taskRun?.step ?? 0;
  const maxSteps = taskRun?.maxSteps ?? 30;
  const events = taskRun?.events ?? [];
  const latestEvent = events.length > 0 ? events[events.length - 1] : null;

  const latestSummary = latestEvent
    ? formatAgentStepSummary(latestEvent.step, latestEvent.tool_name, latestEvent.tool_args, latestEvent.tool_result, latestEvent.created_at, latestEvent.finished_at)
    : null;

  const currentActionText = isActive
    ? latestSummary
      ? latestSummary.fullSummary
      : "starting step..."
    : taskRun
      ? `last run: ${taskRun.state.replaceAll("_", " ")} (${events.length} steps)`
      : "idle";

  const turnLabel = isActive ? `turn ${step}/${maxSteps}` : taskRun ? `last run (step 1-${step})` : "idle";

  return (
    <div className={`agent-fixed-widget-container ${isMinimized ? "minimized" : ""}`} aria-live="polite">
      <div className="agent-fixed-widget">
        <div
          className="agent-widget-header"
          onClick={() => {
            setIsMinimized(!isMinimized);
            setUserToggled(true);
          }}
          title="Click to toggle agent status widget"
        >
          <div className="agent-widget-header-left">
            <span className={`agent-status-pulse ${isActive ? "" : "idle"}`} />
            <span className="agent-widget-badge">{turnLabel}</span>
            <span className="agent-widget-summary">{currentActionText}</span>
          </div>
          <div className="agent-widget-controls">
            <button
              className="agent-widget-toggle"
              onClick={(e) => {
                e.stopPropagation();
                setIsMinimized(!isMinimized);
                setUserToggled(true);
              }}
              aria-label={isMinimized ? "Expand agent status widget" : "Minimize agent status widget"}
            >
              {isMinimized ? "▲" : "▼"}
            </button>
          </div>
        </div>

        {!isMinimized && (
          <div className="agent-widget-body">
            <div className="agent-widget-task-info">
              <span>{isActive ? "ACTIVE TASK OBJECTIVE" : "LAST COMPLETED TASK RUN"}</span>
              <strong>{taskRun ? taskRun.objective : "No task execution recorded"}</strong>
            </div>

            {isActive && (
              <div className="agent-widget-progress-track" title={`Step ${step} of ${maxSteps}`}>
                <div
                  className="agent-widget-progress-fill"
                  style={{ width: `${Math.min(100, Math.max(5, (step / maxSteps) * 100))}%` }}
                />
              </div>
            )}

            <div className="agent-widget-action-now">
              <span>Status:</span>
              <code>{isActive ? `${turnLabel} (${currentActionText})` : `Run ${taskRun ? taskRun.state.replaceAll("_", " ") : "idle"} · ${events.length} steps`}</code>
            </div>

            {events.length > 0 && (
              <div className="agent-widget-history">
                <span className="agent-widget-history-title">
                  {isActive ? `RUNNING TASK STEPS (1 TO ${step})` : `LAST TASK RUN STEPS (1 TO ${events.length})`}
                </span>
                {events.map((ev) => {
                  const summary = formatAgentStepSummary(ev.step, ev.tool_name, ev.tool_args, ev.tool_result, ev.created_at, ev.finished_at);
                  const observation = getAgentObservation(ev.tool_name, ev.tool_result);
                  const isExpanded = Boolean(expandedEvents[ev.id]);

                  return (
                    <div key={ev.id} className={`agent-widget-history-item ${ev.status === "failed" ? "failed" : ""} ${isExpanded ? "expanded" : ""}`}>
                      <div
                        className="agent-widget-history-row"
                        onClick={() => observation && toggleEventExpand(ev.id)}
                        style={{ cursor: observation ? "pointer" : "default" }}
                      >
                        <span className="agent-widget-history-step">{summary.turnLabel}</span>
                        <div className="agent-widget-history-detail">
                          <span className="agent-widget-thinking">{summary.thinkingText}</span>
                          <span className="agent-widget-action-bullet"> · </span>
                          <span className="agent-widget-action">{summary.actionText}</span>
                        </div>
                        {observation && (
                          <button
                            className="agent-widget-arrow-button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleEventExpand(ev.id);
                            }}
                            title={isExpanded ? "Hide output" : "Show AI output observation"}
                            aria-label={isExpanded ? "Hide output" : "Show output"}
                          >
                            {isExpanded ? "▼" : "▶"}
                          </button>
                        )}
                      </div>

                      {isExpanded && observation && (
                        <div className="agent-widget-output-container">
                          <div className="agent-widget-output-header">
                            <span>OBSERVATION RECEIVED BY AGENT</span>
                          </div>
                          <pre className="agent-widget-output-pre">{observation}</pre>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
