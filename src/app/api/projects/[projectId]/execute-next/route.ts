import { createSupabaseServerClient } from "@/lib/supabase/server";
import { deleteRepositoryBranch, dispatchAxiomWorker, getRepositoryInstallationToken, hasGitHubActionsWorker, type AvailableRepository } from "@/lib/github/app";
import { createDeveloperConversation, requestDeveloperToolCalls, type AgentToolCall } from "@/lib/ai/task-execution";
import type { Content } from "@google/genai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { changedPaths, commitAndPush, createExecutionSession, destroyExecutionSession, prepareWorkspaceDependencies, readTaskFiles, readWorkspaceTree, runDeveloperCommands, runValidations, WORKSPACE_TREE_IGNORES, writeTaskFiles, type ExecutionSession } from "@/lib/execution/runner";
import type { DeveloperReport } from "@/lib/task-report";
import { dockerAvailability, sanitize } from "@/lib/execution/docker";
import { hasPendingRequiredPrerequisites, normalizeHumanPrerequisites } from "@/lib/human-prerequisites";
import { assertPersistedExecutionIsCurrent, assertRunActive, finishActiveRun, hasActiveRun, isExecutionCancelled, setActiveRunContainer, startActiveRun } from "@/lib/execution/active-run";
import { commandPolicyViolation } from "@/lib/execution/command-policy";
import { isGeminiRateLimitError } from "@/lib/ai/gemini";
import { z } from "zod";

export const runtime = "nodejs";

const BRANCH_BLOCKING_STATES = ["running", "pending_review", "waiting_for_human_approval"];
const DEFAULT_MAX_AGENT_STEPS = 30;
const MAX_AUTOMATIC_RETRIES = 2;

type TaskRecord = {
  id: string;
  state: string;
  category: "general" | "feature";
  feature_id: string | null;
  objective: string;
  developer_prompt: string;
  allowed_paths: unknown;
  acceptance_criteria: unknown;
  validation_commands: unknown;
  execution_logs: unknown;
  review_feedback: string | null;
  human_actions: unknown;
  branch_name: string | null;
  automation_attempt_count: number;
  last_automation_outcome: string | null;
  automation_lease_owner: string | null;
  features: Array<{ context_node_id: string | null }> | null;
};

export async function executeNextTask(supabase: SupabaseClient, projectId: string, trigger: "human" | "automation" = "human", requestedTaskId?: string, automationLeaseOwner?: string, isWorkerContinuation = false, allowManualRetry = false) {
  const { data: project } = await supabase
    .from("projects")
    .select("id, state, settings, automation_state")
    .eq("id", projectId)
    .single();
  if (!project) return Response.json({ error: "Project not found." }, { status: 404 });
  if (project.state !== "active") return Response.json({ error: project.state === "completed" ? "Resume the completed project before running a task." : "Approve project context before running a task." }, { status: 409 });
  // The control plane checks this before dispatching a manual worker. A queued
  // GitHub runner must be allowed to finish that accepted manual job even if
  // the human resumes automation while the runner is starting.
  if (trigger === "human" && project.automation_state !== "frozen" && !isWorkerContinuation && !allowManualRetry) {
    return Response.json({ error: "Freeze automatic flow before starting a task manually." }, { status: 409 });
  }
  if (trigger === "automation" && !automationLeaseOwner) {
    return Response.json({ error: "Automated execution requires its delivery lease owner." }, { status: 409 });
  }

  const repository = repositoryFromProjectSettings(project.settings);
  if (!repository) return Response.json({ error: "Connect a GitHub repository before running a task." }, { status: 409 });
  const developerSettings = developerSettingsFromProject(project.settings);
  const maxAgentSteps = developerSettings.maxSteps;

  const { data: blockingTask } = await supabase
    .from("tasks")
    .select("id, state, branch_name")
    .eq("project_id", projectId)
    .in("state", BRANCH_BLOCKING_STATES)
    .is("archived_at", null)
    .maybeSingle();
  if (blockingTask && blockingTask.id !== requestedTaskId) {
    return Response.json({ error: "Task " + blockingTask.id + " is still " + blockingTask.state + "; merge or resolve its branch before creating another." }, { status: 409 });
  }

  let taskQuery = supabase
    .from("tasks")
    .select("id, state, category, feature_id, objective, developer_prompt, allowed_paths, acceptance_criteria, validation_commands, execution_logs, review_feedback, human_actions, branch_name, automation_attempt_count, last_automation_outcome, automation_lease_owner, features(context_node_id)")
    .eq("project_id", projectId)
    .in("state", requestedTaskId ? ["approved", "queued", "failed", "running"] : ["approved", "queued", "failed"])
    .is("archived_at", null);
  if (requestedTaskId) taskQuery = taskQuery.eq("id", requestedTaskId);
  if (automationLeaseOwner) taskQuery = taskQuery.eq("automation_lease_owner", automationLeaseOwner);
  const { data: task } = await taskQuery.order("category").order("priority").order("created_at").limit(1).maybeSingle();
  if (!task) return Response.json({ type: "idle", message: "No approved task is waiting for manual execution." });

  const typedTask = task as TaskRecord;
  if (allowManualRetry && (typedTask.state !== "approved" || !["retry", "human_recovered"].includes(typedTask.last_automation_outcome ?? ""))) {
    return Response.json({ error: "Only the current active retry can be started manually while automation is running." }, { status: 409 });
  }
  const taskLeaseOwner = trigger === "automation" ? automationLeaseOwner : undefined;
  const allowedPaths = stringList(typedTask.allowed_paths);
  const acceptanceCriteria = stringList(typedTask.acceptance_criteria);
  const validationCommands = stringList(typedTask.validation_commands);
  const prerequisites = normalizeHumanPrerequisites(typedTask.human_actions);
  if (hasPendingRequiredPrerequisites(prerequisites)) {
    return Response.json({
      error: "A required human prerequisite must be acknowledged before this task can run.",
      pendingPrerequisites: prerequisites.filter((item) => !item.optional && !item.acknowledgedAt).map((item) => item.action),
    }, { status: 409 });
  }
  const featureContextNodeId = (Array.isArray(typedTask.features) ? typedTask.features[0]?.context_node_id : null) ?? null;
  const [{ data: rootNode }, { data: featureNode }] = await Promise.all([
    supabase.from("context_nodes").select("id, content").eq("project_id", projectId).eq("kind", "project").eq("status", "approved").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    featureContextNodeId
      ? supabase.from("context_nodes").select("id, content").eq("id", featureContextNodeId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!rootNode) return Response.json({ error: "Approved project context is missing." }, { status: 409 });

  // Validate the project, task, and human prerequisites before dispatching. The
  // remote worker is an execution host, not a way around normal queue guards.
  if (process.env.VERCEL === "1" && hasGitHubActionsWorker()) {
    return dispatchNextTaskToWorker(supabase, projectId, typedTask.id, automationLeaseOwner);
  }

  const availability = await dockerAvailability();
  if (!availability.available) {
    const deployedOnVercel = process.env.VERCEL === "1";
    console.error("Axiom execution host is unavailable", {
      projectId,
      requestedTaskId,
      host: deployedOnVercel ? "vercel" : "local",
      diagnostic: availability.diagnostic,
    });
    return Response.json({
      error: availability.reason,
      code: "docker_unavailable",
      diagnostic: availability.diagnostic,
      ...(deployedOnVercel ? { next_step: "This deployment cannot run Docker locally. Configure this route to dispatch the GitHub Actions worker." } : {}),
    }, { status: 503 });
  }

  if (hasActiveRun(typedTask.id)) {
    return Response.json({ error: "This task is already running in this server process." }, { status: 409 });
  }

  let session: ExecutionSession | null = null;
  let pushedBranchName: string | null = null;
  const activeRun = startActiveRun(typedTask.id);
  const executionLogs: Array<{ attempt: number; command: string; exit_code: number; output: string }> = Array.isArray(typedTask.execution_logs)
    ? typedTask.execution_logs.filter((entry): entry is { attempt: number; command: string; exit_code: number; output: string } => {
      const value = entry as Record<string, unknown>;
      return typeof value.attempt === "number" && typeof value.command === "string" && typeof value.exit_code === "number" && typeof value.output === "string";
    })
    : [];
  try {
    assertRunActive(activeRun);
    const token = await getRepositoryInstallationToken(repository);
    assertRunActive(activeRun);
    session = await createExecutionSession({ taskId: typedTask.id, repository, installationToken: token, existingBranchName: typedTask.branch_name });
    setActiveRunContainer(typedTask.id, session.containerName);
    assertRunActive(activeRun);
    let startTaskQuery = supabase.from("tasks").update({
      state: "running",
      branch_name: session.branchName,
      base_sha: session.baseSha,
      execution_started_at: new Date().toISOString(),
      execution_attempt_count: 0,
      ...(trigger === "automation" ? { automation_attempt_count: typedTask.automation_attempt_count + 1, last_automation_outcome: "running", automation_paused_at: null } : {}),
      updated_at: new Date().toISOString(),
    }).eq("id", typedTask.id);
    if (taskLeaseOwner) startTaskQuery = startTaskQuery.eq("automation_lease_owner", taskLeaseOwner);
    const { data: startedTask, error: startTaskError } = await startTaskQuery.select("id").maybeSingle();
    if (startTaskError) throw new Error("Could not mark the task as running: " + startTaskError.message);
    if (!startedTask) throw new Error("Automation delivery lease was lost before execution could begin.");
    await supabase.from("task_execution_events").delete().eq("task_id", typedTask.id);
    await setCurrentStatus({
      supabase,
      contextNode: typedTask.category === "feature" ? featureNode : rootNode,
      task: typedTask,
      state: "in_progress",
      remainingWork: ["The Docker developer agent is iterating on the task and independent AI review will follow."],
    });

    const dependencySetup = await prepareWorkspaceDependencies(session);
    assertRunActive(activeRun);
    await assertTaskExecutionIsCurrent(supabase, typedTask.id, taskLeaseOwner);
    if (dependencySetup) {
      executionLogs.push({ attempt: 0, command: dependencySetup.command, exit_code: dependencySetup.exitCode, output: sanitize(dependencySetup.output) });
      await persistExecutionProgress(supabase, typedTask.id, 0, executionLogs, taskLeaseOwner);
      await recordExecutionEvent(supabase, projectId, typedTask.id, 0, "prepare_dependencies", { command: dependencySetup.command }, dependencySetup, dependencySetup.exitCode === 0 ? "completed" : "failed");
      if (dependencySetup.exitCode !== 0) {
        throw new Error("Workspace dependency setup failed: " + dependencySetup.output.slice(-2000));
      }
    }

    const retryContext = typedTask.review_feedback
      ? "\n\nPrevious attempt feedback (fix this in the existing task branch before finishing):\n" + typedTask.review_feedback
      : "";
    const agentTask = { objective: typedTask.objective, developerPrompt: typedTask.developer_prompt + retryContext, allowedPaths, acceptanceCriteria, validationCommands };
    const workspaceTree = await readWorkspaceTree(session);
    const conversation: Content[] = createDeveloperConversation({
      task: agentTask,
      projectStatus: contextStatus(rootNode.content),
      featureStatus: featureNode ? contextStatus(featureNode.content) : undefined,
      workspaceTree,
      workspaceIgnoreList: WORKSPACE_TREE_IGNORES,
    });
    if (!session) throw new Error("Docker execution session was not created.");
    const activeSession = session;
    let execution: DeveloperReport | null = null;
    let invalidToolResponses = 0;

    for (let step = 1; step <= maxAgentSteps; step += 1) {
      assertRunActive(activeRun);
      await assertTaskExecutionIsCurrent(supabase, typedTask.id, taskLeaseOwner);
      const stepStartMs = Date.now();
      const currentWorkspaceTree = await readWorkspaceTree(activeSession);
      const decisionStartMs = Date.now();
      const decision = await requestDeveloperToolCalls(conversation, step, maxAgentSteps, currentWorkspaceTree, activeRun.controller.signal, developerSettings.model);
      assertRunActive(activeRun);
      await assertTaskExecutionIsCurrent(supabase, typedTask.id, taskLeaseOwner);
      const thinkingMs = Date.now() - decisionStartMs;

      if (decision.modelContent) conversation.push(decision.modelContent);
      const calls = decision.calls;
      const isReadOnlyBatch = calls.length > 1 && calls.every((call) => call.name === "inspect_files");
      const inspectCalls = calls.filter((call): call is Extract<AgentToolCall, { name: "inspect_files" }> => call.name === "inspect_files");
      if (calls.length === 0 || (calls.length > 1 && !isReadOnlyBatch)) {
        // On the final step, if the agent fails to produce a valid call, force a synthetic finish
        if (step === maxAgentSteps) {
          execution = {
            summary: "Agent reached step limit. Auto-finishing with whatever work was completed.",
            changes_made: decision.text.slice(0, 2000) || "Agent did not produce a structured report.",
          } as unknown as DeveloperReport;
          executionLogs.push({ attempt: step, command: "agent.auto_finish", exit_code: 0, output: "Agent could not produce a valid finish_task on the final step. The harness auto-finished the task with available work." });
          await persistExecutionProgress(supabase, typedTask.id, step, executionLogs, taskLeaseOwner);
          await recordExecutionEvent(supabase, projectId, typedTask.id, step, "auto_finish", {}, { report: execution, thinking_ms: thinkingMs, duration_ms: Date.now() - stepStartMs }, "completed");
          break;
        }
        invalidToolResponses += 1;
        if (invalidToolResponses >= 3) {
          execution = {
            summary: "Agent produced invalid tool calls repeatedly. Auto-finishing with completed workspace changes.",
            changes_made: decision.text.slice(0, 2000) || "Agent completed work but did not invoke finish_task tool format.",
          } as unknown as DeveloperReport;
          executionLogs.push({ attempt: step, command: "agent.auto_finish", exit_code: 0, output: "Agent exhausted invalid tool-call budget. The harness auto-finished the task with completed work." });
          await persistExecutionProgress(supabase, typedTask.id, step, executionLogs, taskLeaseOwner);
          await recordExecutionEvent(supabase, projectId, typedTask.id, step, "auto_finish", {}, { report: execution, thinking_ms: thinkingMs, duration_ms: Date.now() - stepStartMs }, "completed");
          break;
        }
        const message = calls.length === 0
          ? "No valid tool call was returned. If you have completed the task and verified build/tests, call finish_task IMMEDIATELY with a report object (e.g. finish_task({ report: { summary: 'Task completed', changes_made: '...' } })). Do not return plain text prose."
          : "Only multiple inspect_files calls may share a turn. Commands, edits, validation, and finish_task must be called alone.";
        executionLogs.push({ attempt: step, command: "agent.invalid_tool_call", exit_code: 1, output: message + " " + decision.text.slice(0, 1000) });
        await persistExecutionProgress(supabase, typedTask.id, step, executionLogs, taskLeaseOwner);
        await recordExecutionEvent(supabase, projectId, typedTask.id, step, "invalid_tool_call", {}, { error: message, thinking_ms: thinkingMs, action_ms: Date.now() - stepStartMs, duration_ms: Date.now() - stepStartMs }, "failed");
        conversation.push({ role: "user", parts: [{ text: message }] });
        continue;
      }
      invalidToolResponses = 0;
      const responses: Array<{ functionResponse: { name: string; id?: string; response: Record<string, unknown> } }> = [];
      if (isReadOnlyBatch || calls[0].name === "inspect_files") {
        assertRunActive(activeRun);
        const actionStartMs = Date.now();
        const inspected = await Promise.all(inspectCalls.map(async (call) => {
          const files = await readTaskFiles(activeSession, call.args.paths);
          const actionMs = Date.now() - actionStartMs;
          const result = summarizeObservation(JSON.stringify(files));
          executionLogs.push({ attempt: step, command: "agent.inspect " + call.args.paths.join(", "), exit_code: 0, output: result });
          await recordExecutionEvent(supabase, projectId, typedTask.id, step, "inspect_files", call.args, { files, thinking_ms: thinkingMs, action_ms: actionMs, duration_ms: Date.now() - stepStartMs }, "completed");
          return { functionResponse: { name: call.name, id: call.id, response: { output: { files } } } };
        }));
        responses.push(...inspected);
      } else if (calls[0].name === "run_command") {
        assertRunActive(activeRun);
        await assertTaskExecutionIsCurrent(supabase, typedTask.id, taskLeaseOwner);
        const actionStartMs = Date.now();
        const call = calls[0];
        const policyViolation = commandPolicyViolation(call.args.command);
        if (policyViolation) {
          const error = "Command rejected: " + policyViolation + ".";
          executionLogs.push({ attempt: step, command: "agent.command_rejected " + call.args.command, exit_code: 1, output: error });
          await recordExecutionEvent(supabase, projectId, typedTask.id, step, "run_command", call.args, { error, thinking_ms: thinkingMs, action_ms: Date.now() - actionStartMs, duration_ms: Date.now() - stepStartMs }, "failed");
          responses.push({ functionResponse: { name: call.name, id: call.id, response: { error } } });
          await persistExecutionProgress(supabase, typedTask.id, step, executionLogs, taskLeaseOwner);
          conversation.push({ role: "user", parts: responses });
          continue;
        }
        const [result] = await runDeveloperCommands(session, [call.args.command]);
        const actionMs = Date.now() - actionStartMs;
        appendValidationLogs(executionLogs, step, [result]);
        await recordExecutionEvent(supabase, projectId, typedTask.id, step, "run_command", call.args, { ...result, thinking_ms: thinkingMs, action_ms: actionMs, duration_ms: Date.now() - stepStartMs }, result.exitCode === 0 ? "completed" : "failed");
        responses.push({ functionResponse: { name: call.name, id: call.id, response: { output: result } } });
      } else if (calls[0].name === "write_files") {
        assertRunActive(activeRun);
        await assertTaskExecutionIsCurrent(supabase, typedTask.id, taskLeaseOwner);
        const actionStartMs = Date.now();
        const call = calls[0];
        await writeTaskFiles(session, call.args.edits);
        const actionMs = Date.now() - actionStartMs;
        const result = "Edits were applied. Inspect or validate them before finishing.";
        const paths = call.args.edits.map((edit) => edit.path).join(", ");
        executionLogs.push({ attempt: step, command: "agent.write " + paths, exit_code: 0, output: result });
        await recordExecutionEvent(supabase, projectId, typedTask.id, step, "write_files", { paths: call.args.edits.map((edit) => edit.path) }, { message: result, thinking_ms: thinkingMs, action_ms: actionMs, duration_ms: Date.now() - stepStartMs }, "completed");
        responses.push({ functionResponse: { name: call.name, id: call.id, response: { output: { message: result } } } });
      } else if (calls[0].name === "run_validation") {
        assertRunActive(activeRun);
        await assertTaskExecutionIsCurrent(supabase, typedTask.id, taskLeaseOwner);
        const actionStartMs = Date.now();
        const call = calls[0];
        const isApproved = (cmd: string) => {
          if (validationCommands.includes(cmd)) return true;
          const parts = cmd.split("&&").map((p) => p.trim()).filter(Boolean);
          return parts.length > 0 && parts.every((p) => validationCommands.includes(p));
        };
        const unapproved = call.args.commands.filter((cmd) => !isApproved(cmd));
        if (unapproved.length > 0) {
          const error = "Unapproved validation command(s): " + unapproved.join(", ") + ". Approved validation commands for this task are: [" + validationCommands.join(", ") + "]. Use write_files to edit configuration files or run_command for shell commands.";
          executionLogs.push({ attempt: step, command: "agent.validation_rejected " + unapproved.join(", "), exit_code: 1, output: error });
          await recordExecutionEvent(supabase, projectId, typedTask.id, step, "run_validation", call.args, { error, thinking_ms: thinkingMs, action_ms: Date.now() - actionStartMs, duration_ms: Date.now() - stepStartMs }, "failed");
          responses.push({ functionResponse: { name: call.name, id: call.id, response: { error } } });
          await persistExecutionProgress(supabase, typedTask.id, step, executionLogs, taskLeaseOwner);
          conversation.push({ role: "user", parts: responses });
          continue;
        }
        const results = await runValidations(session, call.args.commands);
        const actionMs = Date.now() - actionStartMs;
        appendValidationLogs(executionLogs, step, results);
        await recordExecutionEvent(supabase, projectId, typedTask.id, step, "run_validation", call.args, { results, thinking_ms: thinkingMs, action_ms: actionMs, duration_ms: Date.now() - stepStartMs }, results.every((result) => result.exitCode === 0) ? "completed" : "failed");
        responses.push({ functionResponse: { name: call.name, id: call.id, response: { output: { results } } } });
      } else {
        const actionStartMs = Date.now();
        execution = calls[0].args.report;
        const actionMs = Date.now() - actionStartMs;
        executionLogs.push({ attempt: step, command: "agent.finish", exit_code: 0, output: "Agent returned its completion report." });
        await persistExecutionProgress(supabase, typedTask.id, step, executionLogs, taskLeaseOwner);
        await recordExecutionEvent(supabase, projectId, typedTask.id, step, "finish_task", {}, { report: execution, thinking_ms: thinkingMs, action_ms: actionMs, duration_ms: Date.now() - stepStartMs }, "completed");
        break;
      }
      await persistExecutionProgress(supabase, typedTask.id, step, executionLogs, taskLeaseOwner);
      conversation.push({ role: "user", parts: responses });
    }
    // If the agent never called finish_task, auto-generate a synthetic report from whatever work was done
    if (!execution) {
      execution = {
        summary: "Agent exhausted its " + maxAgentSteps + "-step budget without calling finish_task. Auto-finishing with whatever workspace changes exist.",
        changes_made: "See workspace diff for actual changes made by the agent.",
      } as unknown as DeveloperReport;
      executionLogs.push({ attempt: maxAgentSteps, command: "agent.auto_finish", exit_code: 0, output: "Harness auto-finished after step limit." });
      await persistExecutionProgress(supabase, typedTask.id, maxAgentSteps, executionLogs, taskLeaseOwner);
      await recordExecutionEvent(supabase, projectId, typedTask.id, maxAgentSteps, "auto_finish", {}, { report: execution }, "completed");
    }

    // A final deterministic validation prevents an agent from accidentally finishing on stale evidence.
    await assertTaskExecutionIsCurrent(supabase, typedTask.id, taskLeaseOwner);
    const dependencyRefresh = await prepareWorkspaceDependencies(session, true);
    assertRunActive(activeRun);
    await assertTaskExecutionIsCurrent(supabase, typedTask.id, taskLeaseOwner);
    if (dependencyRefresh) appendValidationLogs(executionLogs, maxAgentSteps + 1, [dependencyRefresh]);
    const validationPlan = dependencyRefresh?.exitCode === 0 || !dependencyRefresh
      ? await resolveValidationPlan(session, validationCommands)
      : { commands: validationCommands, note: null };
    if (validationPlan.note) executionLogs.push({ attempt: maxAgentSteps + 1, command: "orchestrator.validation_plan", exit_code: 0, output: validationPlan.note });
    await assertTaskExecutionIsCurrent(supabase, typedTask.id, taskLeaseOwner);
    const validations = dependencyRefresh?.exitCode === 0 || !dependencyRefresh
      ? await runValidations(session, validationPlan.commands)
      : [dependencyRefresh];
    await assertTaskExecutionIsCurrent(supabase, typedTask.id, taskLeaseOwner);
    appendValidationLogs(executionLogs, maxAgentSteps + 1, validations);
    const validationPassed = validations.every((result) => result.exitCode === 0);
    await recordExecutionEvent(
      supabase,
      projectId,
      typedTask.id,
      maxAgentSteps + 1,
      "final_validation",
      { commands: validationPlan.commands },
      { results: validations },
      validationPassed ? "completed" : "failed",
    );

    const paths = await changedPaths(session);
    const report = {
      ...execution,
      validation_results: validations.map((result) => result.command + ": " + (result.exitCode === 0 ? "passed" : "failed") + " — " + result.output.slice(-700)),
    };

    // Deterministic validation is a hard gate. An already-satisfied task is a
    // successful no-op, not a failed run: there is no branch to review because
    // the requested outcome was already present before the worker started.
    if (!validationPassed) {
      const feedback = "Deterministic validation failed. Fix the recorded command failure before retrying.";
      const retryFeedback = feedback + "\n\nValidation output:\n" + report.validation_results.join("\n");
      const { data: currentProject } = await supabase.from("projects").select("automation_state").eq("id", projectId).maybeSingle();
      // The persisted counter was incremented when this execution began. Allow
      // the initial run plus two automatic retries, then leave the failure in
      // Active Task for a human decision instead of looping indefinitely.
      const retryCapReached = trigger === "automation" && typedTask.automation_attempt_count >= MAX_AUTOMATIC_RETRIES;
      const retainForHuman = trigger === "human" || currentProject?.automation_state === "frozen" || retryCapReached;
      // Hosted workers are ephemeral. Preserve the failing workspace on the
      // task branch so both automatic and human retries continue from the
      // actual failing code rather than redoing the task from the base branch.
      let retryHeadSha: string | null = null;
      if (paths.length > 0) {
        retryHeadSha = await commitAndPush(session, typedTask.objective + " (validation retry)", paths);
        pushedBranchName = session.branchName;
      }
      await finishTask(supabase, typedTask.id, {
        state: retainForHuman ? "failed" : "approved",
        branch_name: retryHeadSha ? session.branchName : null,
        base_sha: retryHeadSha ? session.baseSha : null,
        head_sha: retryHeadSha,
        developer_report: report,
        execution_logs: executionLogs,
        last_automation_outcome: trigger === "automation" ? retryCapReached ? "retry_cap_reached" : "retry" : "manual_validation_failed",
        automation_paused_at: retainForHuman ? new Date().toISOString() : null,
        review_feedback: retryCapReached
          ? retryFeedback + " The automatic retry limit of two retries has been reached. Retry, return this task to the queue, or delete it."
          : retainForHuman
            ? retryFeedback + " Automatic flow is frozen, so this task remains in Active task until you return it to the queue or remove it."
            : retryFeedback,
      }, taskLeaseOwner);
      await setCurrentStatus({
        supabase,
        contextNode: typedTask.category === "feature" ? featureNode : rootNode,
        task: typedTask,
        state: "retry",
        remainingWork: [feedback],
        latestReport: report.dashboard_summary || report.summary,
      });
      return Response.json({ type: retainForHuman ? "failed" : "retry", taskId: typedTask.id, message: feedback });
    }

    if (paths.length === 0) {
      const feedback = "No code change was needed: the requested outcome was already implemented and validation passed.";
      await finishTask(supabase, typedTask.id, {
        state: "waiting_for_human_approval",
        branch_name: null,
        base_sha: null,
        head_sha: null,
        developer_report: report,
        execution_logs: executionLogs,
        review_feedback: feedback,
      }, taskLeaseOwner);
      await setCurrentStatus({ supabase, contextNode: typedTask.category === "feature" ? featureNode : rootNode, task: typedTask, state: "awaiting_human_confirmation", remainingWork: ["Confirm that the existing implementation and recorded validation satisfy this task."], latestReport: report.dashboard_summary || report.summary });
      return Response.json({ type: "waiting_for_human_approval", taskId: typedTask.id, message: feedback });
    }

    await assertTaskExecutionIsCurrent(supabase, typedTask.id, taskLeaseOwner);
    assertRunActive(activeRun);
    const headSha = await commitAndPush(session, typedTask.objective, paths);
    pushedBranchName = session.branchName;
    await assertTaskExecutionIsCurrent(supabase, typedTask.id, taskLeaseOwner);
    await finishTask(supabase, typedTask.id, {
      state: "pending_review",
      head_sha: headSha,
      developer_report: report,
      execution_logs: executionLogs,
      review_feedback: "Developer completed implementation successfully. Ready for AI Reviewer.",
    }, taskLeaseOwner);
    await setCurrentStatus({ supabase, contextNode: typedTask.category === "feature" ? featureNode : rootNode, task: typedTask, state: "awaiting_review", remainingWork: ["Run AI Reviewer or inspect branch " + session.branchName + "."], latestReport: report.dashboard_summary || report.summary });
    return Response.json({ type: "pending_review", taskId: typedTask.id, branchName: session.branchName, headSha });
  } catch (error) {
    console.error("Axiom task execution failed", error);
    const rateLimited = isGeminiRateLimitError(error);
    if (isExecutionCancelled(error)) {
      if (pushedBranchName) {
        await deleteRepositoryBranch(repository, pushedBranchName).catch((cleanupError) => {
          console.error("Axiom could not clean up a branch pushed during cancellation", cleanupError);
        });
      }
      if (session) {
        await recordExecutionEvent(supabase, projectId, typedTask.id, 0, "cancelled", {}, { message: error.message }, "failed").catch(() => undefined);
      }
      await finishTask(supabase, typedTask.id, {
        state: "failed",
        execution_logs: [...executionLogs, { attempt: 0, command: "orchestrator.cancelled", exit_code: 1, output: error.message }],
        review_feedback: "Execution was cancelled by a human. No branch was pushed.",
      }, taskLeaseOwner).catch(() => undefined);
      return Response.json({ type: "cancelled", taskId: typedTask.id }, { status: 409 });
    }
    if (pushedBranchName) {
      await deleteRepositoryBranch(repository, pushedBranchName).catch((cleanupError) => {
        console.error("Axiom could not clean up a failed task branch", cleanupError);
      });
    }
    await finishTask(supabase, typedTask.id, {
      state: rateLimited ? "approved" : "failed",
      execution_logs: [...executionLogs, { attempt: 0, command: "orchestrator", exit_code: 1, output: sanitize(error instanceof Error ? error.message : "Unknown execution error") }],
      review_feedback: rateLimited ? "Provider rate limit persisted after the harness retry window. Automation will resume after cooldown." : "Execution infrastructure failed before review.",
      ...(rateLimited && trigger === "automation" ? { automation_attempt_count: typedTask.automation_attempt_count, last_automation_outcome: "rate_limited" } : {}),
    }, taskLeaseOwner);
    return Response.json({ error: rateLimited ? "Developer execution is rate-limited; automation will retry after cooldown." : "Task execution failed safely. Inspect the task report and try again after resolving the issue.", rateLimited }, { status: rateLimited ? 429 : 502 });
  } finally {
    if (session) await destroyExecutionSession(session);
    finishActiveRun(typedTask.id);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  let requestedTaskId: string | undefined;
  let manualRetry = false;
  try {
    const raw = await request.text();
    if (raw) {
      const parsed = z.object({ taskId: z.string().uuid().optional(), retry: z.boolean().optional() }).safeParse(JSON.parse(raw));
      if (!parsed.success) return Response.json({ error: "Invalid task selection." }, { status: 400 });
      requestedTaskId = parsed.data.taskId;
      manualRetry = parsed.data.retry === true;
    }
  } catch { return Response.json({ error: "Invalid task selection." }, { status: 400 }); }
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Sign in before running a task." }, { status: 401 });
  return executeNextTask(supabase, projectId, "human", requestedTaskId, undefined, false, manualRetry);
}

async function dispatchNextTaskToWorker(supabase: SupabaseClient, projectId: string, requestedTaskId?: string, automationLeaseOwner?: string) {
  let taskId = requestedTaskId;
  if (!taskId) {
    const { data: nextTask } = await supabase.from("tasks").select("id").eq("project_id", projectId).in("state", ["approved", "queued", "failed"]).is("archived_at", null).order("category").order("priority").order("created_at").limit(1).maybeSingle();
    taskId = nextTask?.id;
  }
  if (!taskId) return Response.json({ type: "idle", message: "No approved task is waiting for execution." });
  let claimTaskQuery = supabase.from("tasks")
    .update({ state: "running", execution_started_at: new Date().toISOString(), review_feedback: "Task is waiting for the isolated GitHub Actions worker to start.", updated_at: new Date().toISOString() })
    .eq("id", taskId).eq("project_id", projectId).in("state", ["approved", "queued", "failed"]);
  if (automationLeaseOwner) claimTaskQuery = claimTaskQuery.eq("automation_lease_owner", automationLeaseOwner);
  const { data: claimedTask, error: claimError } = await claimTaskQuery.select("id").maybeSingle();
  if (claimError || !claimedTask) return Response.json({ error: "This task has already been claimed or is no longer ready to run.", code: "task_already_claimed" }, { status: 409 });
  try {
    const workerRepository = await dispatchAxiomWorker(taskId, automationLeaseOwner);
    return Response.json({ type: "dispatched", taskId, message: "Task dispatched to the isolated GitHub Actions worker.", workerRepository });
  } catch (error) {
    const diagnostic = error instanceof Error ? error.message : String(error);
    let resetTaskQuery = supabase.from("tasks").update({ state: "queued", execution_started_at: null, automation_lease_owner: automationLeaseOwner ? null : undefined, review_feedback: "Could not dispatch the GitHub Actions worker: " + diagnostic, updated_at: new Date().toISOString() }).eq("id", taskId).eq("project_id", projectId);
    if (automationLeaseOwner) resetTaskQuery = resetTaskQuery.eq("automation_lease_owner", automationLeaseOwner);
    await resetTaskQuery;
    console.error("Axiom could not dispatch the GitHub Actions worker", { projectId, taskId, diagnostic });
    return Response.json({ error: "Could not dispatch the GitHub Actions worker.", code: "worker_dispatch_failed", diagnostic }, { status: 502 });
  }
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

async function resolveValidationPlan(session: ExecutionSession, requested: string[]) {
  const packageScripts = await runDeveloperCommands(session, ["node -e \"const fs=require('fs'); const pkg=JSON.parse(fs.readFileSync('package.json','utf8')); console.log(JSON.stringify(pkg.scripts||{}))\""]);
  const probe = packageScripts[0];
  if (!probe || probe.exitCode !== 0) return { commands: requested, note: null };
  try {
    const scripts = JSON.parse(probe.output.trim()) as Record<string, unknown>;
    const missing = requested.flatMap((command) => {
      const match = command.match(/^npm run ([A-Za-z0-9:_-]+)$/);
      return match && typeof scripts[match[1]] !== "string" ? [match[1]] : [];
    });
    if (!missing.length || typeof scripts.build !== "string") return { commands: requested, note: null };
    const commands = requested.filter((command) => !missing.some((script) => command === "npm run " + script));
    if (!commands.includes("npm run build")) commands.push("npm run build");
    return { commands, note: "Validation plan adjusted: package.json does not define " + missing.map((script) => "npm run " + script).join(", ") + "; ran npm run build instead." };
  } catch {
    return { commands: requested, note: null };
  }
}

function appendValidationLogs(target: Array<{ attempt: number; command: string; exit_code: number; output: string }>, attempt: number, results: Array<{ command: string; exitCode: number; output: string }>) {
  target.push(...results.map((result) => ({ attempt, command: result.command, exit_code: result.exitCode, output: sanitize(result.output) })));
}

function summarizeObservation(value: string, exitCode?: number) {
  const prefix = exitCode === undefined ? "" : "exit " + exitCode + "\n";
  const clean = sanitize(value);
  if (clean.length <= 16_000) return prefix + clean;
  return prefix + clean.slice(0, 8_000) + "\n… [observation truncated] …\n" + clean.slice(-8_000);
}



function contextStatus(content: unknown) {
  return ((content ?? {}) as Record<string, unknown>).current_status ?? {};
}

async function finishTask(supabase: SupabaseClient, taskId: string, update: Record<string, unknown>, automationLeaseOwner?: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      let taskUpdateQuery = supabase.from("tasks").update({
        ...update,
        ...(automationLeaseOwner && update.state !== "pending_review" ? { automation_lease_owner: null } : {}),
        execution_finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", taskId);
      if (automationLeaseOwner) taskUpdateQuery = taskUpdateQuery.eq("automation_lease_owner", automationLeaseOwner);
      const { data, error } = await taskUpdateQuery.select("id").maybeSingle();
      if (!error && data) return;
      if (!error) throw new Error("Task transition was rejected because the automation lease is no longer current.");
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
      else throw new Error("Could not persist the task outcome: " + error.message);
    } catch (err) {
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
      else throw err;
    }
  }
}

async function persistExecutionProgress(
  supabase: SupabaseClient,
  taskId: string,
  step: number,
  logs: Array<{ attempt: number; command: string; exit_code: number; output: string }>,
  automationLeaseOwner?: string,
) {
  const boundedLogs = logs.map((log) => ({
    ...log,
    output: typeof log.output === "string" ? log.output.slice(-12_000) : "",
  }));

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      let progressQuery = supabase.from("tasks").update({
        execution_attempt_count: step,
        execution_logs: boundedLogs,
        updated_at: new Date().toISOString(),
      }).eq("id", taskId);
      if (automationLeaseOwner) progressQuery = progressQuery.eq("automation_lease_owner", automationLeaseOwner);
      const { data, error } = await progressQuery.select("id").maybeSingle();
      if (!error && data) return;
      if (!error) throw new Error("Task progress update was rejected because the automation lease is no longer current.");
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 300));
      else console.error("Could not persist execution progress:", error.message);
    } catch (err) {
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 300));
      else console.error("Network error persisting execution progress:", err);
    }
  }
}

async function recordExecutionEvent(
  supabase: SupabaseClient,
  projectId: string,
  taskId: string,
  step: number,
  toolName: string,
  toolArgs: unknown,
  toolResult: unknown,
  status: "completed" | "failed",
) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { error } = await supabase.from("task_execution_events").insert({
        project_id: projectId,
        task_id: taskId,
        step,
        tool_name: toolName,
        tool_args: toolArgs,
        tool_result: toolResult,
        status,
        finished_at: new Date().toISOString(),
      });
      if (!error) return;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 300));
      else console.error("Could not persist execution event:", error.message);
    } catch (err) {
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 300));
      else console.error("Network error persisting execution event:", err);
    }
  }
}

async function assertTaskExecutionIsCurrent(supabase: SupabaseClient, taskId: string, automationLeaseOwner?: string) {
  const { data, error } = await supabase.from("tasks").select("state, archived_at, automation_lease_owner").eq("id", taskId).maybeSingle();
  if (error) throw new Error(error.message);
  assertPersistedExecutionIsCurrent(data, automationLeaseOwner);
}

async function setCurrentStatus({
  supabase,
  contextNode,
  task,
  state,
  remainingWork,
  latestReport = null,
}: {
  supabase: SupabaseClient;
  contextNode: { id: string; content: unknown } | null;
  task: TaskRecord;
  state: string;
  remainingWork: string[];
  latestReport?: string | null;
}) {
  if (!contextNode) return;
  const content = (contextNode.content ?? {}) as Record<string, unknown>;
  const currentStatus = (content.current_status ?? {}) as Record<string, unknown>;
  const activeTask = {
    task_id: task.id,
    category: task.category,
    objective: task.objective,
    task_state: state,
    planned_files: stringList(task.allowed_paths),
    expected_changes: stringList(task.acceptance_criteria),
    completed_changes: [],
    remaining_work: remainingWork,
    latest_report: latestReport,
  };
  await supabase.from("context_nodes").update({
    content: {
      ...content,
      current_status: {
        ...currentStatus,
        implementation_state: state,
        summary: "Task " + task.id.slice(0, 8) + " is " + state.replaceAll("_", " ") + ": " + task.objective,
        confirmed_by: "task_outcome",
        confirmed_at: new Date().toISOString(),
        active_task: activeTask,
      },
    },
    updated_at: new Date().toISOString(),
  }).eq("id", contextNode.id);
}

function repositoryFromProjectSettings(settings: unknown): AvailableRepository | null {
  const github = (settings as { github?: unknown } | null)?.github as Record<string, unknown> | undefined;
  if (!github
    || typeof github.repository_id !== "number"
    || typeof github.installation_id !== "number"
    || typeof github.owner !== "string"
    || typeof github.name !== "string"
    || typeof github.full_name !== "string"
    || typeof github.default_branch !== "string"
    || typeof github.private !== "boolean") return null;
  return {
    id: github.repository_id,
    installationId: github.installation_id,
    owner: github.owner,
    name: github.name,
    fullName: github.full_name,
    defaultBranch: github.default_branch,
    private: github.private,
    htmlUrl: "",
  };
}

function developerSettingsFromProject(settings: unknown) {
  const developer = (settings as { developer?: unknown } | null)?.developer as Record<string, unknown> | undefined;
  const configuredSteps = developer?.max_steps;
  const maxSteps = configuredSteps === 60 || configuredSteps === 90 || configuredSteps === 30 ? configuredSteps : DEFAULT_MAX_AGENT_STEPS;
  const model = developer?.model === "gemini-3.5-flash" || developer?.model === "gemini-3.1-flash-lite"
    ? developer.model
    : undefined;
  return { maxSteps, model };
}
