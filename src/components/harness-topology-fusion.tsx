"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";

type NodeId = "human" | "engineer" | "context" | "developer" | "validator";
type AgentStatus = "idle" | "active" | "working" | "waiting";

export interface PacketLog {
  id: string;
  timestamp: string;
  source: string;
  destination: string;
  protocol: "TCP" | "UDP" | "HTTP/2" | "IPC";
  type: string;
  status: "OK" | "PENDING" | "ERROR" | "BLOCKED";
  payload: string;
}

export interface ActivePacketAnimation {
  id: string;
  packet: PacketLog;
  pathKey: string;
  pathD: string;
  color: string;
  durationMs: number;
  instanceId: string;
}

export interface HarnessTopologyFusionProps {
  projectId?: string;
  hasContext?: boolean;
  openClarifications?: number;
  activeTask?: { state: string; objective: string } | null;
  automationState?: "running" | "frozen" | null;
  showSimulationControls?: boolean;
  developerModel?: string;
  engineerModel?: string;
  maxSteps?: 30 | 60 | 90;
  onDeveloperModelChange?: (model: string) => void;
  onEngineerModelChange?: (model: string) => void;
  onMaxStepsChange?: (steps: 30 | 60 | 90) => void;
}

export interface QueuedItem {
  packet: PacketLog;
  pathKey: string;
  color: string;
  durationMs?: number;
}

export function HarnessTopologyFusion({
  projectId,
  hasContext = true,
  openClarifications = 0,
  activeTask = null,
  automationState = "running",
  showSimulationControls = false,
  developerModel,
  engineerModel,
  maxSteps,
  onDeveloperModelChange,
  onEngineerModelChange,
  onMaxStepsChange,
}: HarnessTopologyFusionProps) {
  const [selectedNode, setSelectedNode] = useState<NodeId | null>("engineer");
  const simulatedState = openClarifications > 0 || activeTask?.state === "waiting_for_human_approval" ? "waiting_approval" : "running";
  const [selectedPacket, setSelectedPacket] = useState<PacketLog | null>(null);
  const [hoveredPacketId, setHoveredPacketId] = useState<string | null>(null);
  const [mounted, setMounted] = useState<boolean>(false);
  const [showTelemetry, setShowTelemetry] = useState<boolean>(false);

  // Dynamic Agent Activity States
  const [agentStatuses, setAgentStatuses] = useState<Record<NodeId, AgentStatus>>({
    context: "idle",
    engineer: "active",
    human: openClarifications > 0 ? "waiting" : "idle",
    developer: "working",
    validator: "idle",
  });

  // Dynamic Developer AI Worker Activity Text & Progress
  const [developerActivity, setDeveloperActivity] = useState<string>("Waiting for a live developer event.");
  const [developerProgress, setDeveloperProgress] = useState<number>(0);
  const [modelLabels, setModelLabels] = useState({ developer: "Gemini 3.1 Flash-Lite", engineer: "Gemini 3.1 Flash-Lite" });
  const [repositoryTree, setRepositoryTree] = useState<string[]>([]);

  // Synchronize dynamic model settings from props
  useEffect(() => {
    if (developerModel || engineerModel) {
      setModelLabels({
        developer: developerModel === "gemini-3.5-flash" ? "Gemini 3.5 Flash" : "Gemini 3.1 Flash-Lite",
        engineer: engineerModel === "gemini-3.5-flash" ? "Gemini 3.5 Flash" : "Gemini 3.1 Flash-Lite",
      });
    }
  }, [developerModel, engineerModel]);

  // Dynamic DOM Refs for precise SVG Path Calculation
  const containerRef = useRef<HTMLDivElement>(null);
  const contextRef = useRef<HTMLDivElement>(null);
  const engineerRef = useRef<HTMLDivElement>(null);
  const humanRef = useRef<HTMLDivElement>(null);
  const dockerRef = useRef<HTMLDivElement>(null);
  const devRef = useRef<HTMLDivElement>(null);
  const valRef = useRef<HTMLDivElement>(null);

  // Dynamic Path Coordinates State
  const [paths, setPaths] = useState<Record<string, string>>({
    humanToEngineer: "M 0 0",
    engineerToHuman: "M 0 0",
    engineerToContext: "M 0 0",
    contextToEngineer: "M 0 0",
    engineerToDocker: "M 0 0",
    dockerToDeveloper: "M 0 0",
    developerToValidator: "M 0 0",
    validatorToEngineer: "M 0 0",
  });

  const pathsRef = useRef<Record<string, string>>(paths);
  pathsRef.current = paths;

  const [activeAnimations, setActiveAnimations] = useState<ActivePacketAnimation[]>([]);
  const processedEventIds = useRef<Set<string>>(new Set());
  const pktCounter = useRef<number>(100);
  const isFirstPoll = useRef<boolean>(true);

  // Synchronized FIFO Animation Queue Engine
  const animationQueue = useRef<QueuedItem[]>([]);
  const isProcessingQueue = useRef<boolean>(false);


  // Dynamic calculation of start/end points using getBoundingClientRect
  const updatePaths = useCallback(() => {
    if (!containerRef.current) return;
    const cRect = containerRef.current.getBoundingClientRect();

    const getPos = (ref: React.RefObject<HTMLDivElement | null>) => {
      if (!ref.current) return { left: 0, right: 0, top: 0, bottom: 0, centerX: 0, centerY: 0, width: 0, height: 0 };
      const r = ref.current.getBoundingClientRect();
      const left = r.left - cRect.left;
      const right = r.right - cRect.left;
      const top = r.top - cRect.top;
      const bottom = r.bottom - cRect.top;
      return {
        left,
        right,
        top,
        bottom,
        centerX: left + r.width / 2,
        centerY: top + r.height / 2,
        width: r.width,
        height: r.height,
      };
    };

    const ctx = getPos(contextRef);
    const eng = getPos(engineerRef);
    const hum = getPos(humanRef);
    const doc = getPos(dockerRef);
    const dev = getPos(devRef);
    const val = getPos(valRef);

    if (eng.width === 0) return;

    const calculated: Record<string, string> = {
      // Human UI <-> Engineer AI
      humanToEngineer: `M ${hum.left} ${hum.centerY} L ${eng.right} ${eng.centerY}`,
      engineerToHuman: `M ${eng.right} ${eng.centerY} L ${hum.left} ${hum.centerY}`,

      // Context Engine <-> Engineer AI
      engineerToContext: `M ${eng.left} ${eng.centerY} L ${ctx.right} ${ctx.centerY}`,
      contextToEngineer: `M ${ctx.right} ${ctx.centerY} L ${eng.left} ${eng.centerY}`,

      // Line A (Engineer AI -> top edge of Docker Subnet Container)
      engineerToDocker: `M ${eng.centerX} ${eng.bottom} C ${eng.centerX} ${eng.bottom + 35}, ${doc.centerX} ${doc.top - 35}, ${doc.centerX} ${doc.top}`,

      // Line B (Docker Subnet Container -> Developer AI Worker)
      dockerToDeveloper: `M ${doc.centerX} ${doc.top} C ${doc.centerX} ${doc.top + 25}, ${dev.centerX} ${dev.top - 25}, ${dev.centerX} ${dev.top}`,

      // Line C (Developer AI Worker -> Validate Checker)
      developerToValidator: `M ${dev.right} ${dev.centerY} L ${val.left} ${val.centerY}`,

      // Return ACK Path (Validator -> Engineer AI Hub)
      validatorToEngineer: `M ${val.centerX} ${val.top} C ${val.centerX} ${val.top - 45}, ${eng.centerX + 40} ${eng.bottom + 45}, ${eng.centerX + 40} ${eng.bottom}`,
    };

    setPaths(calculated);
    pathsRef.current = calculated;
  }, []);

  useEffect(() => {
    setMounted(true);
    updatePaths();

    window.addEventListener("resize", updatePaths);
    const ro = new ResizeObserver(updatePaths);
    if (containerRef.current) ro.observe(containerRef.current);

    return () => {
      window.removeEventListener("resize", updatePaths);
      ro.disconnect();
    };
  }, [updatePaths]);

  const makeUniquePktId = (prefix = "pkt") => {
    pktCounter.current += 1;
    const randHex = Math.random().toString(36).slice(2, 6);
    return `${prefix}-${pktCounter.current}-${randHex}`;
  };

  // Fixed initial timestamps for SSR
  const [packetLogs, setPacketLogs] = useState<PacketLog[]>([]);

  // Synchronized FIFO Queue Processor using direct path strings
  const processNextInQueue = useCallback(() => {
    if (isProcessingQueue.current || animationQueue.current.length === 0) {
      return;
    }

    isProcessingQueue.current = true;
    const item = animationQueue.current.shift()!;
    const duration = item.durationMs ?? 3000;
    const uniqueInstanceId = `inst-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    // Read current exact path string from ref
    const currentPathD = pathsRef.current[item.pathKey] ?? "M 0 0";

    const animObject: ActivePacketAnimation = {
      id: `anim-${Math.random().toString(36).substring(2, 9)}`,
      packet: item.packet,
      pathKey: item.pathKey,
      pathD: currentPathD,
      color: item.color,
      durationMs: duration,
      instanceId: uniqueInstanceId,
    };

    // Update target agent status to working
    if (item.pathKey === "engineerToDeveloper" || item.pathKey === "dockerToDeveloper") {
      setAgentStatuses((prev) => ({ ...prev, developer: "working", engineer: "active" }));
    } else if (item.pathKey === "developerToValidator") {
      setAgentStatuses((prev) => ({ ...prev, developer: "working", validator: "working" }));
    } else if (item.pathKey === "validatorToEngineer") {
      setAgentStatuses((prev) => ({ ...prev, validator: "active", engineer: "active" }));
    } else if (item.pathKey === "engineerToContext") {
      setAgentStatuses((prev) => ({ ...prev, context: "working", engineer: "active" }));
    } else if (item.pathKey === "engineerToHuman") {
      setAgentStatuses((prev) => ({ ...prev, engineer: "active", human: "waiting" }));
    }

    // Reset active animations for a 50ms tick to force DOM unmount/remount
    setActiveAnimations([]);

    setTimeout(() => {
      setActiveAnimations([animObject]);
      setPacketLogs((prev) => [item.packet, ...prev.filter((p) => p.id !== item.packet.id).slice(0, 25)]);
      setSelectedPacket(item.packet);

      // Schedule cleanup & play next queued item
      setTimeout(() => {
        setActiveAnimations([]);
        isProcessingQueue.current = false;
        processNextInQueue();
      }, duration + 100);
    }, 50);
  }, []);

  // Enqueue packet animation requests
  const spawnAnimations = useCallback(
    (items: QueuedItem[]) => {
      animationQueue.current.push(...items);
      processNextInQueue();
    },
    [processNextInQueue]
  );

  // Poll real project events if projectId is provided (ONLY real backend events from last 10s)
  useEffect(() => {
    if (!projectId || !mounted) return;

    let isMounted = true;

    const pollProjectEvents = async () => {
      try {
        const [autoRes, execRes] = await Promise.all([
          fetch(`/api/projects/${projectId}/automation`),
          fetch(`/api/projects/${projectId}/active-execution`),
        ]);

        if (!isMounted) return;

        const itemsToSpawn: QueuedItem[] = [];
        const recentLogs: PacketLog[] = [];
        const now = Date.now();

        if (autoRes.ok) {
          const autoData = await autoRes.json();
          const events = (autoData.events as { id: string; event_type: string; payload: unknown; created_at: string }[]) ?? [];

          for (const ev of events) {
            const eventAgeMs = now - new Date(ev.created_at).getTime();
            // ONLY process events created within the last 10 seconds (10,000 ms)
            if (eventAgeMs > 10000) continue;

            if (!processedEventIds.current.has(ev.id)) {
              processedEventIds.current.add(ev.id);
              const timeStr = new Date(ev.created_at).toISOString().split("T")[1].slice(0, 12);

              let pathKey = "humanToEngineer";
              let color = "#38bdf8";
              let protocol: "HTTP/2" | "TCP" | "UDP" | "IPC" = "HTTP/2";
              let src = "Human_UI (10.0.0.1:443)";
              let dst = "Engineer_AI (10.0.0.2:8080)";
              let typeStr = "TASK_PROPOSAL";

              if (ev.event_type === "task_proposed") {
                pathKey = "humanToEngineer";
                color = "#38bdf8";
                protocol = "HTTP/2";
                typeStr = "TASK_PROPOSAL";
                src = "Human_UI (10.0.0.1:443)";
                dst = "Engineer_AI (10.0.0.2:8080)";
              } else if (ev.event_type === "planning_clarification" || ev.event_type === "human_todo_created") {
                pathKey = "engineerToHuman";
                color = "#fbbf24";
                protocol = "HTTP/2";
                typeStr = "CLARIFICATION_GATE";
                src = "Engineer_AI (10.0.0.2:8080)";
                dst = "Human_UI (10.0.0.1:443)";
              } else if (["context_updated", "context_approved", "repository_scanned", "synthesize_completed"].includes(ev.event_type)) {
                pathKey = "engineerToContext";
                color = "#00ffcc";
                protocol = "IPC";
                typeStr = "CONTEXT_UPDATE";
                src = "Engineer_AI (10.0.0.2:8080)";
                dst = "Context_Engine (10.0.0.3:50051)";
              } else if (ev.event_type === "planning_triggered") {
                pathKey = "contextToEngineer";
                color = "#00ffcc";
                protocol = "IPC";
                typeStr = "CONTEXT_LOAD";
                src = "Context_Engine (10.0.0.3:50051)";
                dst = "Engineer_AI (10.0.0.2:8080)";
              } else if (ev.event_type === "automation_execution_started") {
                pathKey = "engineerToDocker";
                color = "#34d399";
                protocol = "TCP";
                typeStr = "DISPATCH_EXECUTION";
                src = "Engineer_AI (10.0.0.2:8080)";
                dst = "Developer_Worker (172.17.0.2:9000)";
              } else if (ev.event_type === "task_completed" || ev.event_type === "task_approved") {
                const pktAck: PacketLog = {
                  id: makeUniquePktId("pkt-ack"),
                  timestamp: timeStr,
                  source: "Validate_Checker (172.17.0.3:9001)",
                  destination: "Engineer_AI (10.0.0.2:8080)",
                  protocol: "TCP",
                  type: "VERIFICATION_SUCCESS",
                  status: "OK",
                  payload: JSON.stringify(ev.payload, null, 2),
                };
                const pktReview: PacketLog = {
                  id: makeUniquePktId("pkt-rev"),
                  timestamp: timeStr,
                  source: "Engineer_AI (10.0.0.2:8080)",
                  destination: "Human_UI (10.0.0.1:443)",
                  protocol: "HTTP/2",
                  type: "APPROVAL_REQUIRED",
                  status: "PENDING",
                  payload: JSON.stringify(ev.payload, null, 2),
                };
                recentLogs.push(pktAck, pktReview);
                itemsToSpawn.push(
                  { packet: pktAck, pathKey: "validatorToEngineer", color: "#10b981" },
                  { packet: pktReview, pathKey: "engineerToHuman", color: "#f59e0b" }
                );
                continue;
              }

              const pkt: PacketLog = {
                id: makeUniquePktId("pkt-ev"),
                timestamp: timeStr,
                source: src,
                destination: dst,
                protocol,
                type: typeStr,
                status: ev.event_type === "planning_clarification" ? "PENDING" : "OK",
                payload: JSON.stringify(ev.payload, null, 2),
              };

              recentLogs.push(pkt);
              itemsToSpawn.push({ packet: pkt, pathKey, color });
            }
          }
        }

        if (execRes.ok) {
          const execData = await execRes.json();
          const models = execData.models as { developer?: string; engineer?: string } | undefined;
          if (Array.isArray(execData.repositoryTree)) setRepositoryTree(execData.repositoryTree.filter((path: unknown): path is string => typeof path === "string"));
          if (models) setModelLabels({ developer: models.developer === "gemini-3.5-flash" ? "Gemini 3.5 Flash" : "Gemini 3.1 Flash-Lite", engineer: models.engineer === "gemini-3.5-flash" ? "Gemini 3.5 Flash" : "Gemini 3.1 Flash-Lite" });
          setAgentStatuses((previous) => ({ ...previous, developer: execData.active ? "working" : "idle", engineer: execData.active ? "working" : openClarifications > 0 ? "waiting" : "idle" }));
          const execEvents = (execData.taskRun?.events as { id: string; step: number; tool_name: string; tool_args: unknown; status: string; finished_at: string; created_at?: string }[]) ?? [];

          for (const ev of execEvents) {
            const eventAgeMs = now - new Date(ev.finished_at || ev.created_at || Date.now()).getTime();
            if (eventAgeMs > 10000 && !execData.active) continue;

            if (!processedEventIds.current.has(ev.id)) {
              processedEventIds.current.add(ev.id);
              const timeStr = ev.finished_at ? new Date(ev.finished_at).toISOString().split("T")[1].slice(0, 12) : new Date().toISOString().split("T")[1].slice(0, 12);
              const pkt: PacketLog = {
                id: makeUniquePktId("pkt-tool"),
                timestamp: timeStr,
                source: "Developer_Worker (172.17.0.2:9000)",
                destination: "Validate_Checker (172.17.0.3:9001)",
                protocol: "UDP",
                type: `TOOL_${ev.tool_name.toUpperCase()}`,
                status: ev.status === "completed" ? "OK" : "ERROR",
                payload: JSON.stringify({ step: ev.step, tool: ev.tool_name, args: ev.tool_args }, null, 2),
              };
              recentLogs.push(pkt);
              itemsToSpawn.push({ packet: pkt, pathKey: "developerToValidator", color: "#00ffcc" });
              setDeveloperActivity(`${ev.tool_name.replaceAll("_", " ")} · step ${ev.step}`);
              setDeveloperProgress(Math.min(100, Math.round((ev.step / Math.max(execData.taskRun?.maxSteps ?? 1, 1)) * 100)));
            }
          }
        }

        if (recentLogs.length > 0) {
          setPacketLogs((prev) => [...recentLogs, ...prev].slice(0, 15));
        }

        if (itemsToSpawn.length > 0) {
          spawnAnimations(itemsToSpawn);
        }
      } catch (err) {
        console.error("Telemetry polling error:", err);
      }
    };

    void pollProjectEvents();
    const interval = setInterval(pollProjectEvents, 3000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [projectId, mounted, spawnAnimations]);

  // Trigger animations for any specific cable path on button click
  const triggerCableAnimation = (target: "PROPOSAL" | "CONTEXT" | "DISPATCH" | "DIFF" | "ACK" | "GATE" | "MULTI") => {
    const timeStr = new Date().toISOString().split("T")[1].slice(0, 12);

    if (target === "MULTI") {
      const pkt1: PacketLog = {
        id: makeUniquePktId("pkt-m1"),
        timestamp: timeStr,
        source: "Human_UI (10.0.0.1:443)",
        destination: "Engineer_AI (10.0.0.2:8080)",
        protocol: "HTTP/2",
        type: "TASK_PROPOSAL_DISPATCH",
        status: "OK",
        payload: `{\n  "stream": 1,\n  "intent": "Task proposal dispatch",\n  "timestamp": "${timeStr}"\n}`,
      };
      const pkt2: PacketLog = {
        id: makeUniquePktId("pkt-m2"),
        timestamp: timeStr,
        source: "Engineer_AI (10.0.0.2:8080)",
        destination: "Developer_Worker (172.17.0.2:9000)",
        protocol: "TCP",
        type: "DOCKER_WORKER_INGRESS",
        status: "OK",
        payload: `{\n  "stream": 2,\n  "action": "MODIFY_AST_ROUTES",\n  "timestamp": "${timeStr}"\n}`,
      };
      const pkt3: PacketLog = {
        id: makeUniquePktId("pkt-m3"),
        timestamp: timeStr,
        source: "Developer_Worker (172.17.0.2:9000)",
        destination: "Validate_Checker (172.17.0.3:9001)",
        protocol: "UDP",
        type: "STREAM_AST_DIFF",
        status: "OK",
        payload: `{\n  "stream": 3,\n  "diff": "+ import { z } from 'zod';",\n  "timestamp": "${timeStr}"\n}`,
      };

      spawnAnimations([
        { packet: pkt1, pathKey: "humanToEngineer", color: "#38bdf8", durationMs: 3000 },
        { packet: pkt2, pathKey: "engineerToDocker", color: "#34d399", durationMs: 3000 },
        { packet: pkt3, pathKey: "developerToValidator", color: "#00ffcc", durationMs: 3000 },
      ]);
      return;
    }

    let pathKey = "humanToEngineer";
    let color = "#38bdf8";
    let protocol: "HTTP/2" | "TCP" | "UDP" | "IPC" = "HTTP/2";
    let src = "Human_UI (10.0.0.1:443)";
    let dst = "Engineer_AI (10.0.0.2:8080)";
    let typeStr = "TASK_PROPOSAL";

    if (target === "PROPOSAL") {
      pathKey = "humanToEngineer";
      color = "#38bdf8";
      protocol = "HTTP/2";
      typeStr = "TASK_PROPOSAL";
      src = "Human_UI (10.0.0.1:443)";
      dst = "Engineer_AI (10.0.0.2:8080)";
    } else if (target === "CONTEXT") {
      pathKey = "engineerToContext";
      color = "#00ffcc";
      protocol = "IPC";
      typeStr = "CONTEXT_QUERY";
      src = "Engineer_AI (10.0.0.2:8080)";
      dst = "Context_Engine (10.0.0.3:50051)";
    } else if (target === "DISPATCH") {
      pathKey = "engineerToDocker";
      color = "#34d399";
      protocol = "TCP";
      typeStr = "DISPATCH_INSTRUCTION";
      src = "Engineer_AI (10.0.0.2:8080)";
      dst = "Developer_Worker (172.17.0.2:9000)";
    } else if (target === "DIFF") {
      pathKey = "developerToValidator";
      color = "#00ffcc";
      protocol = "UDP";
      typeStr = "STREAM_AST_DIFF";
      src = "Developer_Worker (172.17.0.2:9000)";
      dst = "Validate_Checker (172.17.0.3:9001)";
    } else if (target === "ACK") {
      pathKey = "validatorToEngineer";
      color = "#10b981";
      protocol = "TCP";
      typeStr = "VERIFICATION_SUCCESS";
      src = "Validate_Checker (172.17.0.3:9001)";
      dst = "Engineer_AI (10.0.0.2:8080)";
    } else if (target === "GATE") {
      pathKey = "engineerToHuman";
      color = "#f59e0b";
      protocol = "HTTP/2";
      typeStr = "CLARIFICATION_GATE";
      src = "Engineer_AI (10.0.0.2:8080)";
      dst = "Human_UI (10.0.0.1:443)";
    }

    const pktId = makeUniquePktId(`pkt-${target.toLowerCase()}`);
    const newPkt: PacketLog = {
      id: pktId,
      timestamp: timeStr,
      source: src,
      destination: dst,
      protocol,
      type: typeStr,
      status: target === "GATE" ? "PENDING" : "OK",
      payload: `{\n  "event": "${typeStr}",\n  "packetId": "${pktId}",\n  "timestamp": "${new Date().toISOString()}"\n}`,
    };

    spawnAnimations([{ packet: newPkt, pathKey, color, durationMs: 3000 }]);
  };

  const isPacketInFlight = (pktId: string) => {
    return activeAnimations.some((a) => a.packet.id === pktId);
  };

  return (
    <div className="w-full space-y-6 font-mono" suppressHydrationWarning>
      {/* Pure CSS Keyframe style for 100% deterministic SVG laser stroke filling */}
      <style>{`
        @keyframes fusionLaserBeam {
          0% {
            stroke-dashoffset: 100;
            opacity: 0.3;
          }
          12% {
            opacity: 1;
          }
          88% {
            opacity: 1;
          }
          100% {
            stroke-dashoffset: 0;
            opacity: 0.4;
          }
        }
      `}</style>

      {/* Test Control Bar */}
      {showSimulationControls && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-emerald-900/50 bg-slate-900/90 p-4 backdrop-blur-md">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
              <h3 className="text-sm font-bold text-emerald-300">Synchronized Telemetry FIFO Queue Test Bench</h3>
            </div>
            <p className="text-xs text-slate-400 font-sans mt-0.5">
              Click any button to queue packet animations sequentially without overlap or override.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => triggerCableAnimation("PROPOSAL")}
              className="rounded border border-cyan-500/50 bg-cyan-950/60 px-2.5 py-1 text-xs text-cyan-300 hover:bg-cyan-900/60 font-semibold transition cursor-pointer"
            >
              + Proposal
            </button>
            <button
              onClick={() => triggerCableAnimation("CONTEXT")}
              className="rounded border border-cyan-500/50 bg-cyan-950/60 px-2.5 py-1 text-xs text-cyan-300 hover:bg-cyan-900/60 font-semibold transition cursor-pointer"
            >
              ⚙ Context
            </button>
            <button
              onClick={() => triggerCableAnimation("DISPATCH")}
              className="rounded border border-emerald-500/50 bg-emerald-950/60 px-2.5 py-1 text-xs text-emerald-300 hover:bg-emerald-900/60 font-semibold transition cursor-pointer"
            >
              🚀 Line A (Engineer➔Docker)
            </button>
            <button
              onClick={() => triggerCableAnimation("DIFF")}
              className="rounded border border-teal-500/50 bg-teal-950/60 px-2.5 py-1 text-xs text-teal-300 hover:bg-teal-900/60 font-semibold transition cursor-pointer"
            >
              ⚡ Line C (Dev➔QA)
            </button>
            <button
              onClick={() => triggerCableAnimation("ACK")}
              className="rounded border border-emerald-500/50 bg-emerald-950/60 px-2.5 py-1 text-xs text-emerald-300 hover:bg-emerald-900/60 font-semibold transition cursor-pointer"
            >
              ✓ QA ACK
            </button>
            <button
              onClick={() => triggerCableAnimation("GATE")}
              className="rounded border border-amber-500/50 bg-amber-950/60 px-2.5 py-1 text-xs text-amber-300 hover:bg-amber-900/60 font-semibold transition cursor-pointer"
            >
              ! Human Gate
            </button>
            <button
              onClick={() => triggerCableAnimation("MULTI")}
              className="rounded border border-purple-500/60 bg-purple-950/70 px-3 py-1 text-xs text-purple-300 hover:bg-purple-900/70 font-bold transition shadow-lg shadow-purple-500/20 cursor-pointer"
            >
              💥 Sequential Multi-Stream (3 Packets Queue)
            </button>
          </div>
        </div>
      )}

      {/* Main Canvas Relative Container */}
      <div ref={containerRef} className="relative min-h-[620px] w-full rounded-2xl border border-emerald-900/40 bg-slate-950 p-6 shadow-2xl overflow-hidden select-none">
        {/* Tactical Dark Grid Background (z-0) */}
        <div className="absolute inset-0 bg-[radial-gradient(#10b981_1px,transparent_1px)] [background-size:24px_24px] opacity-10 pointer-events-none z-0" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#0f172a_1px,transparent_1px),linear-gradient(to_bottom,#0f172a_1px,transparent_1px)] bg-[size:32px_32px] opacity-40 pointer-events-none z-0" />

        {/* Cisco Header Strip (z-30) */}
        <div className="relative z-30 flex items-center justify-between border-b border-slate-800/80 pb-3 mb-6 bg-slate-950/90 backdrop-blur-md rounded-t-xl px-2">
          <div className="flex items-center gap-3">
            <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-500/40">
              AXIOM TOPOLOGY SUBNET 10.0.0.0/24
            </span>
            <span className="text-xs text-slate-400">STATE: HARNESS ACTIVE</span>
          </div>
          <div className="flex items-center gap-6 text-[11px] text-slate-400">
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-6 rounded-full bg-cyan-400 shadow-[0_0_8px_#22d3ee]" /> Telemetry Stream
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-6 rounded-full bg-amber-400 shadow-[0_0_8px_#fbbf24]" /> Human Gate
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full border border-emerald-400 bg-emerald-500/20" /> Docker Bridge
            </span>
          </div>
        </div>

        {/* UNIFIED SVG CONNECTORS LAYER (z-10: Style 2 - High-Contrast Dashed Sandbox Bus) */}
        <svg className="absolute inset-0 h-full w-full pointer-events-none z-10">
          <defs>
            <filter id="fusion-glow-dot" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* DYNAMIC TOP NEON CONNECTORS */}
          <path id="path-engineerToContext" d={paths.engineerToContext} fill="none" stroke="#00ffcc" strokeWidth="2" strokeDasharray="5 4" opacity="0.9" />
          <path id="path-contextToEngineer" d={paths.contextToEngineer} fill="none" stroke="#00ffcc" strokeWidth="2" strokeDasharray="5 4" opacity="0.9" />
          <path
            id="path-humanToEngineer"
            d={paths.humanToEngineer}
            fill="none"
            stroke={simulatedState === "waiting_approval" ? "#f59e0b" : "#38bdf8"}
            strokeWidth={simulatedState === "waiting_approval" ? "2.5" : "2"}
            strokeDasharray={simulatedState === "waiting_approval" ? "none" : "5 4"}
            opacity="0.95"
          />
          <path id="path-engineerToHuman" d={paths.engineerToHuman} fill="none" stroke="#fbbf24" strokeWidth="2" strokeDasharray="5 4" opacity="0.95" />

          {/* STYLE 2 DASHED SANDBOX BUS CONNECTORS */}
          <path id="path-engineerToDocker" d={paths.engineerToDocker} fill="none" stroke="#34d399" strokeWidth="2" strokeDasharray="6 4" opacity="0.95" />
          <path id="path-dockerToDeveloper" d={paths.dockerToDeveloper} fill="none" stroke="#34d399" strokeWidth="2" strokeDasharray="6 4" opacity="0.95" />
          <path id="path-developerToValidator" d={paths.developerToValidator} fill="none" stroke="#00ffcc" strokeWidth="2" strokeDasharray="5 4" opacity="0.95" />
          <path id="path-validatorToEngineer" d={paths.validatorToEngineer} fill="none" stroke="#10b981" strokeWidth="2" strokeDasharray="6 4" opacity="0.95" />

          {/* DYNAMIC SYNCHRONIZED SEQUENTIAL LINE GLOW (0% -> 100%) + PULSING NEON TELEMETRY DOT OVERLAY */}
          {activeAnimations.map((anim) => {
            const isSelected = selectedPacket?.id === anim.packet.id;
            const animKey = `instance-${anim.instanceId}`;
            return (
              <g key={animKey} className="pointer-events-auto cursor-pointer" onClick={() => setSelectedPacket(anim.packet)}>
                {/* 0% to 100% Crisp Laser Fill using Pure CSS Keyframes */}
                <path
                  key={`path-${animKey}`}
                  d={anim.pathD}
                  fill="none"
                  stroke={isSelected ? "#38bdf8" : anim.color}
                  strokeWidth="4"
                  pathLength="100"
                  strokeDasharray="100"
                  strokeDashoffset="100"
                  strokeLinecap="round"
                  style={{
                    animation: `fusionLaserBeam ${anim.durationMs}ms cubic-bezier(0.4, 0, 0.2, 1) forwards`,
                    filter: "url(#fusion-glow-dot)",
                  }}
                />

                {/* Pulsing Neon Telemetry Dot traveling directly along anim.pathD */}
                <circle key={`dot-${animKey}`} r="6" fill="#ffffff" stroke={anim.color} strokeWidth="2" filter="url(#fusion-glow-dot)">
                  <animateMotion
                    path={anim.pathD}
                    dur={`${anim.durationMs}ms`}
                    begin="0s"
                    fill="freeze"
                    calcMode="spline"
                    keySplines="0.4 0 0.2 1"
                  />
                  <animate
                    attributeName="opacity"
                    values="0;1;1;0"
                    keyTimes="0;0.1;0.88;1"
                    dur={`${anim.durationMs}ms`}
                    begin="0s"
                    fill="freeze"
                  />
                </circle>
              </g>
            );
          })}
        </svg>

        {/* MAIN LAYOUT GRID (z-20) */}
        <div className="relative z-20 grid grid-cols-12 gap-6 pointer-events-auto items-start">

          {/* TOP ROW CONTAINER: Col 1-12 Flex Row for Top Cards */}
          <div className="col-span-12 flex items-start justify-between gap-8 pt-2">

            {/* Node 1: Context Engine (Top Left - Compact Fixed Width 220px) */}
            <div ref={contextRef} className="w-[220px] shrink-0">
              <div
                onClick={() => setSelectedNode("context")}
                className={`group cursor-pointer rounded-xl border p-4 backdrop-blur-md transition-all duration-300 ${
                  selectedNode === "context"
                    ? "border-cyan-400 bg-slate-900/95 shadow-[0_0_20px_rgba(34,211,238,0.25)]"
                    : "border-cyan-900/40 bg-slate-900/90 hover:border-cyan-700"
                }`}
              >
                <div className="flex items-center justify-between text-[10px]">
                  <span className="font-bold text-cyan-400 uppercase tracking-widest truncate">[NODE: CONTEXT]</span>
                  <span className="font-mono text-slate-400 font-bold shrink-0 ml-1">10.0.0.3</span>
                </div>
                <h4 className="mt-1 font-sans text-base font-bold text-slate-100 flex items-center justify-between">
                  <span>Context Engine</span>
                  <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
                </h4>
                <p className="mt-0.5 text-xs text-slate-400">Indexed brief & rules base</p>
                <div className="mt-3 flex items-center justify-between text-[11px] text-cyan-300 bg-cyan-950/60 border border-cyan-800/40 rounded px-2.5 py-1">
                  <span>Scanned repository</span>
                  <span className="font-bold shrink-0 ml-1">{repositoryTree.length ? `${repositoryTree.length} FILES` : hasContext ? "PENDING" : "NO CONTEXT"}</span>
                </div>
                {repositoryTree.length > 0 ? <p className="mt-2 max-h-12 overflow-auto text-[9px] leading-4 text-slate-500">{repositoryTree.slice(0, 6).join(" · ")}</p> : null}
              </div>
            </div>

            {/* Node 2: Engineer (AI Brain) (Top Center - Central AI Router Hub 380px) */}
            <div ref={engineerRef} className="w-[380px] shrink-0">
              <div
                onClick={() => setSelectedNode("engineer")}
                className={`group cursor-pointer rounded-xl border-2 p-4 backdrop-blur-md transition-all duration-300 ${
                  selectedNode === "engineer"
                    ? "border-blue-400 bg-slate-900/95 shadow-[0_0_25px_rgba(59,130,246,0.35)]"
                    : agentStatuses.engineer === "idle" ? "border-slate-700 bg-slate-900/55 opacity-70" : "border-blue-600/60 bg-slate-900/90 hover:border-blue-500"
                }`}
              >
                <div className="flex items-center justify-between text-[10px]">
                  <span className="font-bold text-blue-400 uppercase tracking-widest truncate">[CORE ROUTER: ENGINEER_AI]</span>
                  <span className="font-mono text-blue-300 font-bold shrink-0 ml-1">10.0.0.2</span>
                </div>
                <h4 className="mt-1 font-sans text-lg font-bold text-slate-100 flex items-center justify-between">
                  <span className="flex items-center gap-2">📡 Engineer (AI Hub)</span>
                  <span className="rounded bg-blue-500/20 px-2 py-0.5 text-[9px] font-bold text-blue-300 border border-blue-500/40 uppercase">
                    {agentStatuses.engineer}
                  </span>
                </h4>
                <div className="mt-1.5 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                  <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Model:</span>
                  {onEngineerModelChange && engineerModel ? (
                    <select
                      value={engineerModel}
                      onChange={(e) => onEngineerModelChange(e.target.value)}
                      className="border border-blue-500/30 bg-blue-950/60 text-blue-200 px-2 py-0.5 rounded text-[11px] outline-none cursor-pointer hover:border-blue-400 transition-all font-mono font-bold"
                    >
                      <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash-Lite</option>
                      <option value="gemini-3.5-flash">Gemini 3.5 Flash</option>
                    </select>
                  ) : (
                    <span className="text-xs text-slate-300 font-mono font-bold">{modelLabels.engineer}</span>
                  )}
                </div>
                <div className="mt-3 flex items-center justify-between text-[11px] text-blue-200 bg-blue-950/70 border border-blue-800/50 rounded px-2.5 py-1">
                  <span>LISTEN: port 8080</span>
                  <span className={`font-bold shrink-0 ml-1 ${automationState === "frozen" ? "text-amber-400" : "text-emerald-400"}`}>
                    {automationState === "frozen" ? "FROZEN" : "180ms"}
                  </span>
                </div>
              </div>
            </div>

            {/* Node 3: Human / UI Gate (Top Right - Approval Gate 280px) */}
            <div ref={humanRef} className="w-[280px] shrink-0">
              <div
                onClick={() => setSelectedNode("human")}
                className={`group cursor-pointer rounded-xl border p-4 backdrop-blur-md transition-all duration-300 ${
                  selectedNode === "human"
                    ? "border-amber-400 bg-slate-900/95 shadow-[0_0_25px_rgba(245,158,11,0.35)]"
                    : simulatedState === "waiting_approval" || openClarifications > 0
                    ? "border-amber-500/80 bg-amber-950/40 shadow-[0_0_20px_rgba(245,158,11,0.25)] animate-pulse"
                    : "border-amber-900/40 bg-slate-900/90 hover:border-amber-700"
                }`}
              >
                <div className="flex items-center justify-between text-[10px]">
                  <span className="font-bold text-amber-400 uppercase tracking-widest truncate">[GATE: OPERATOR_UI]</span>
                  <span className="font-mono text-amber-300 font-bold shrink-0 ml-1">10.0.0.1</span>
                </div>
                <h4 className="mt-1 font-sans text-base font-bold text-slate-100">Human UI Deck</h4>
                <p className="mt-0.5 text-xs text-slate-400">Final task approval gate</p>
                <div className="mt-3 flex items-center justify-between text-[11px] text-amber-300 bg-amber-950/60 border border-amber-800/40 rounded px-2.5 py-1">
                  <span className="truncate">eth0 (443)</span>
                  <span className="font-bold shrink-0 ml-1">
                    {openClarifications > 0
                      ? `${openClarifications} DECISION${openClarifications > 1 ? "S" : ""} NEEDED`
                      : simulatedState === "waiting_approval"
                      ? "1 DECISION NEEDED"
                      : "UNBLOCKED"}
                  </span>
                </div>
              </div>
            </div>

          </div>

          {/* DOCKER SANDBOX ISOLATED BOUNDARY (Spans All 12 Columns, mt-14 Gap) */}
          <div ref={dockerRef} className="col-span-12 mt-14 rounded-2xl border-2 border-dashed border-emerald-500/50 bg-slate-950/60 p-5 backdrop-blur-sm relative z-20">
            {/* Floating Docker Header Badges (Style 2: Hovering Directly on Top Border) */}
            <div className="absolute -top-3.5 left-6 right-6 z-30 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold text-emerald-400 bg-slate-950 px-2.5 py-0.5 rounded-md border border-emerald-500/40 shadow-md">
                <span className="rounded bg-emerald-500/20 px-2 py-0.5 border border-emerald-500/40">
                  DOCKER SUBNET: 172.17.0.0/16
                </span>
                <span>VIRTUAL ETHERNET BRIDGE (docker0)</span>
              </div>
              <span className="text-[11px] text-emerald-400 font-mono bg-slate-950 px-2.5 py-0.5 rounded-md border border-emerald-500/40 shadow-md">
                CONTAINER ID: ax-runner-7a91
              </span>
            </div>


            {/* Nodes inside Docker Container */}
            <div className="grid grid-cols-12 gap-6 items-center relative z-20 pt-3">

              {/* Developer AI (Worker) with Dynamic Live Loading Activity Status HUD */}
              <div ref={devRef} className="col-span-5 col-start-2">
                <div
                  onClick={() => setSelectedNode("developer")}
                  className={`group cursor-pointer rounded-xl border p-4 backdrop-blur-md transition-all duration-300 ${
                    selectedNode === "developer"
                      ? "border-emerald-400 bg-slate-900/95 shadow-[0_0_20px_rgba(16,185,129,0.35)]"
                      : agentStatuses.developer === "idle" ? "border-slate-700 bg-slate-900/55 opacity-70" : "border-emerald-900/60 bg-slate-900/90 hover:border-emerald-700"
                  }`}
                >
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="font-bold text-emerald-400 uppercase tracking-widest truncate">[WORKER: DEV_AGENT]</span>
                    <span className="font-mono text-emerald-300 font-bold shrink-0 ml-1">172.17.0.2</span>
                  </div>

                  <div className="mt-1 flex items-center justify-between">
                    <h4 className="font-sans text-base font-bold text-slate-100">Developer (AI Worker)</h4>
                    <span className={`rounded px-2 py-0.5 text-[9px] font-bold border uppercase flex items-center gap-1 ${agentStatuses.developer === "working" ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40 animate-pulse" : "bg-slate-700/40 text-slate-400 border-slate-600"}`}>
                      {agentStatuses.developer === "working" ? <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" /> : null}
                      {agentStatuses.developer}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] text-slate-400 uppercase font-bold tracking-wider">Model:</span>
                      {onDeveloperModelChange && developerModel ? (
                        <select
                          value={developerModel}
                          onChange={(e) => onDeveloperModelChange(e.target.value)}
                          className="border border-emerald-500/30 bg-emerald-950/60 text-emerald-200 px-2 py-0.5 rounded text-[11px] outline-none cursor-pointer hover:border-emerald-400 transition-all font-mono font-bold"
                        >
                          <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash-Lite</option>
                          <option value="gemini-3.5-flash">Gemini 3.5 Flash</option>
                        </select>
                      ) : (
                        <span className="text-[10px] text-emerald-300 font-mono font-bold">{modelLabels.developer}</span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] text-slate-400 uppercase font-bold tracking-wider">Effort:</span>
                      {onMaxStepsChange && maxSteps ? (
                        <select
                          value={maxSteps}
                          onChange={(e) => onMaxStepsChange(Number(e.target.value) as 30 | 60 | 90)}
                          className="border border-emerald-500/30 bg-emerald-950/60 text-emerald-200 px-2 py-0.5 rounded text-[11px] outline-none cursor-pointer hover:border-emerald-400 transition-all font-mono font-bold"
                        >
                          <option value={30}>Low</option>
                          <option value={60}>Medium</option>
                          <option value={90}>High</option>
                        </select>
                      ) : (
                        <span className="text-[10px] text-emerald-300 font-mono font-bold">{maxSteps} steps</span>
                      )}
                    </div>
                  </div>

                  {/* DYNAMIC LIVE ACTIVITY HUD (Loading animation for editing/analyzing) */}
                  <div className="mt-3 space-y-2 rounded-lg bg-slate-950 p-2.5 border border-emerald-900/50">
                    <div className="flex items-center justify-between text-[11px] text-emerald-300">
                      <span className="truncate max-w-[210px] font-mono font-bold animate-pulse">
                        {developerActivity}
                      </span>
                      <span className="text-[10px] text-slate-400 shrink-0 ml-1 font-mono">{developerProgress}%</span>
                    </div>

                    {/* Dynamic Smooth Animated Progress Loading Bar */}
                    <div className="h-1.5 w-full rounded-full bg-slate-900 overflow-hidden border border-emerald-900/40">
                      <div
                        className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-700 ease-out shadow-[0_0_10px_#10b981]"
                        style={{ width: `${developerProgress}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="col-span-2" aria-hidden="true" />

              {/* Validate Checker AI (QA Sentinel) */}
              <div ref={valRef} className="col-span-5 col-start-8">
                <div
                  onClick={() => setSelectedNode("validator")}
                  className={`group cursor-pointer rounded-xl border p-4 backdrop-blur-md transition-all duration-300 ${
                    selectedNode === "validator"
                      ? "border-teal-400 bg-slate-900/95 shadow-[0_0_20px_rgba(20,184,166,0.35)]"
                      : "border-teal-900/60 bg-slate-900/90 hover:border-teal-700"
                  }`}
                >
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="font-bold text-teal-400 uppercase tracking-widest truncate">[QA: VALIDATOR]</span>
                    <span className="font-mono text-teal-300 font-bold shrink-0 ml-1">172.17.0.3</span>
                  </div>
                  <h4 className="mt-1 font-sans text-base font-bold text-slate-100 flex items-center justify-between">
                    <span>Validate Checker (AI)</span>
                    <span className="rounded bg-teal-500/20 px-2 py-0.5 text-[9px] font-bold text-teal-300 border border-teal-500/40 uppercase">
                      {agentStatuses.validator}
                    </span>
                  </h4>
                  <p className="mt-0.5 text-xs text-slate-400">Deterministic verification</p>

                  <div className="mt-3 flex items-center justify-between text-[11px] text-teal-300 bg-teal-950/60 border border-teal-800/40 rounded px-2 py-1">
                    <span>vitest: 14 PASSING</span>
                    <span className="text-emerald-400 font-bold shrink-0 ml-1">100%</span>
                  </div>
                </div>
              </div>

            </div>
          </div>

        </div>
      </div>

      {/* Telemetry Expander Bar */}
      <div className="flex justify-center mt-4">
        <button
          type="button"
          onClick={() => setShowTelemetry(!showTelemetry)}
          className={`px-4 py-2 rounded-lg text-xs font-mono font-bold tracking-wider uppercase border transition-all duration-300 flex items-center gap-2 ${
            showTelemetry
              ? "bg-purple-950/40 border-purple-500/40 text-purple-300 shadow-[0_0_15px_rgba(168,85,247,0.15)]"
              : "bg-slate-900/60 border-slate-800 text-slate-400 hover:border-purple-500/40 hover:text-purple-300"
          }`}
        >
          <span>{showTelemetry ? "Hide" : "Show"} Telemetry Stream</span>
          <span className={`h-1.5 w-1.5 rounded-full ${showTelemetry ? "bg-purple-400 animate-pulse" : "bg-slate-600"}`} />
        </button>
      </div>

      {showTelemetry && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
          {/* Packet Stream Feed */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-4 backdrop-blur-md">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-3">
              <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                <span>📡 Real-Time Packet Sniffer Log (tcpdump)</span>
                {activeAnimations.length > 0 && (
                  <span className="rounded-full bg-purple-500/30 px-2 py-0.5 text-[9px] font-bold text-purple-300 border border-purple-500/50 animate-pulse">
                    PLAYING QUEUED PACKET
                  </span>
                )}
              </h4>
              <span className="text-[10px] text-emerald-400">{packetLogs.length} Packets Captured</span>
            </div>

            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1 text-xs">
              {packetLogs.map((pkt, idx) => {
                const inFlight = isPacketInFlight(pkt.id);
                const isSelected = selectedPacket?.id === pkt.id;
                return (
                  <div
                    key={`${pkt.id}-${idx}`}
                    onClick={() => setSelectedPacket(pkt)}
                    onMouseEnter={() => setHoveredPacketId(pkt.id)}
                    onMouseLeave={() => setHoveredPacketId(null)}
                    className={`cursor-pointer rounded p-2 transition-all flex items-center justify-between ${
                      isSelected
                        ? "bg-cyan-950/90 border border-cyan-400 text-cyan-200 shadow-md shadow-cyan-500/10"
                        : "bg-slate-950/70 hover:bg-slate-800/80 text-slate-300 border border-transparent"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`px-1.5 py-0.5 text-[9px] font-bold rounded ${
                        pkt.protocol === "HTTP/2" ? "bg-cyan-500/20 text-cyan-300" :
                        pkt.protocol === "IPC" ? "bg-blue-500/20 text-blue-300" :
                        pkt.protocol === "UDP" ? "bg-emerald-500/20 text-emerald-300" : "bg-purple-500/20 text-purple-300"
                      }`}>
                        {pkt.protocol}
                      </span>
                      <span className="font-bold text-slate-100">{pkt.type}</span>
                      {inFlight && (
                        <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-ping" title="Packet currently moving on canvas" />
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-slate-400 font-mono">
                      <span suppressHydrationWarning>{pkt.timestamp}</span>
                      <span className={`font-bold ${pkt.status === "OK" ? "text-emerald-400" : pkt.status === "ERROR" ? "text-red-400" : "text-amber-400"}`}>
                        [{pkt.status}]
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Packet Hex/JSON Payload Inspector */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-4 backdrop-blur-md">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-3">
              <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                <span>🔍 Wireshark Payload Inspector</span>
                {selectedPacket && isPacketInFlight(selectedPacket.id) && (
                  <span className="rounded bg-cyan-500/20 px-2 py-0.5 text-[9px] font-bold text-cyan-300 border border-cyan-500/40 animate-pulse">
                    ⚡ STREAMING LIVE
                  </span>
                )}
              </h4>
              <span className="text-[10px] font-mono text-cyan-400">{selectedPacket ? selectedPacket.id : "Click packet or line to inspect"}</span>
            </div>

            {selectedPacket ? (
              <div className="space-y-2 text-xs font-mono">
                <div className="grid grid-cols-2 gap-2 text-[11px] bg-slate-950 p-2.5 rounded border border-slate-800 text-slate-300">
                  <div><span className="text-slate-500">SRC:</span> <span className="text-cyan-300">{selectedPacket.source}</span></div>
                  <div><span className="text-slate-500">DST:</span> <span className="text-blue-300">{selectedPacket.destination}</span></div>
                  <div><span className="text-slate-500">TYPE:</span> <span className="text-emerald-300">{selectedPacket.type}</span></div>
                  <div><span className="text-slate-500">STATUS:</span> <span className="text-emerald-400">{selectedPacket.status}</span></div>
                </div>
                <div className="space-y-1">
                  <div className="text-[10px] text-slate-400 flex items-center justify-between">
                    <span>PAYLOAD DECODED (JSON):</span>
                    <span suppressHydrationWarning>{selectedPacket.timestamp}</span>
                  </div>
                  <pre className="rounded bg-slate-950 p-3 text-[11px] text-emerald-300 border border-slate-800 overflow-x-auto max-h-36">
                    {selectedPacket.payload}
                  </pre>
                </div>
              </div>
            ) : (
              <div className="flex h-36 items-center justify-center text-xs text-slate-500 font-sans">
                Click any line glow or entry in tcpdump to inspect payload.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
