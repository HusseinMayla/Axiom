"use client";

import React, { useState } from "react";

type NodeId = "human" | "engineer" | "context" | "developer" | "validator";

interface NodeDetail {
  title: string;
  type: string;
  status: "active" | "idle" | "waiting" | "success" | "error";
  description: string;
  metrics: Record<string, string>;
  recentEvent: string;
}

const NODE_DETAILS: Record<NodeId, NodeDetail> = {
  human: {
    title: "Human Operator / UI Console",
    type: "Control Deck",
    status: "waiting",
    description: "Decision authority & final merge approval gate for completed work.",
    metrics: { "Pending Actions": "1 Decision Required", "Last Active": "2m ago" },
    recentEvent: "Awaiting approval for Task #104: Add route verification middleware",
  },
  engineer: {
    title: "Engineer (AI Router)",
    type: "Orchestrator",
    status: "active",
    description: "Central AI brain coordinating task decomposition, context injection, and sandbox worker dispatch.",
    metrics: { "Model": "Gemini 3.1 Pro", "Latency": "180ms", "Active Task": "Refactoring Auth Pipeline" },
    recentEvent: "Dispatched implementation instructions to Docker Sandbox",
  },
  context: {
    title: "Context Engine",
    type: "Knowledge Repository",
    status: "idle",
    description: "Indexed repository knowledge base, architecture constraints, and canonical project brief.",
    metrics: { "Files Indexed": "48 files", "Embeddings": "Up to date", "Freshness": "Synced 1m ago" },
    recentEvent: "Synthesized updated brief from git commit diffs",
  },
  developer: {
    title: "Developer Agent (AI Worker)",
    type: "Execution Node (Docker)",
    status: "active",
    description: "Isolated code modification worker executing step-by-step changes inside the container.",
    metrics: { "Active File": "src/routes.ts", "Changes": "+42 / -12 lines", "Model": "Gemini 3.1 Pro" },
    recentEvent: "Modified src/routes.ts & updated type signatures",
  },
  validator: {
    title: "Validate Checker (AI QA)",
    type: "Verification Sentinel (Docker)",
    status: "success",
    description: "Deterministic test runner & AI code reviewer validating syntax, types, and unit test suites.",
    metrics: { "Vitest Suite": "14/14 PASSING", "TypeScript": "0 ERRORS", "Coverage": "94.2%" },
    recentEvent: "Executed vitest run -- 100% deterministic pass",
  },
};

export function HarnessTopologyDemo() {
  const [selectedNode, setSelectedNode] = useState<NodeId | null>("engineer");
  const [simulatedState, setSimulatedState] = useState<"running" | "waiting_approval" | "validated">("running");

  return (
    <div className="w-full space-y-6">
      {/* Simulation Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-900/80 p-4 backdrop-blur-md">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">Interactive Harness Simulator</h3>
          <p className="text-xs text-slate-400">Click nodes or toggle execution states to observe telemetry packet flow.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setSimulatedState("running")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
              simulatedState === "running"
                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 shadow-lg shadow-cyan-500/20"
                : "bg-slate-800 text-slate-400 hover:text-slate-200"
            }`}
          >
            ● Active Code Execution
          </button>
          <button
            onClick={() => setSimulatedState("validated")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
              simulatedState === "validated"
                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/50 shadow-lg shadow-emerald-500/20"
                : "bg-slate-800 text-slate-400 hover:text-slate-200"
            }`}
          >
            ✓ QA Verification Passed
          </button>
          <button
            onClick={() => setSimulatedState("waiting_approval")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
              simulatedState === "waiting_approval"
                ? "bg-amber-500/20 text-amber-300 border border-amber-500/50 shadow-lg shadow-amber-500/20"
                : "bg-slate-800 text-slate-400 hover:text-slate-200"
            }`}
          >
            ! Human Decision Required
          </button>
        </div>
      </div>

      {/* Main Canvas Frame */}
      <div className="relative min-h-[580px] w-full rounded-2xl border border-cyan-900/30 bg-slate-950 p-6 shadow-2xl overflow-hidden select-none">
        {/* Cyber Grid Background */}
        <div className="absolute inset-0 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:24px_24px] opacity-40 pointer-events-none" />
        <div className="absolute inset-0 bg-gradient-to-tr from-cyan-950/10 via-transparent to-emerald-950/10 pointer-events-none" />

        {/* Legend Header */}
        <div className="relative z-10 flex items-center justify-between mb-4 border-b border-slate-800/80 pb-3">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
            <span className="font-mono text-xs font-bold uppercase tracking-wider text-cyan-400">
              AXIOM HARNESS TOPOLOGY v1.0
            </span>
          </div>
          <div className="flex items-center gap-6 text-[11px] font-mono text-slate-400">
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-6 rounded-full bg-cyan-400 shadow-[0_0_8px_#22d3ee]" /> Live Dataflow
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-6 rounded-full bg-amber-400 shadow-[0_0_8px_#fbbf24]" /> Human Gate
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full border border-emerald-400 bg-emerald-500/20" /> Docker Scope
            </span>
          </div>
        </div>

        {/* SVG Bezier Cables Layer */}
        <svg className="absolute inset-0 h-full w-full pointer-events-none z-0">
          <defs>
            <filter id="glow-cyan" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>

            <filter id="glow-amber" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>

            <linearGradient id="cyan-blue-cable" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.8" />
            </linearGradient>

            <linearGradient id="amber-cable" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#fbbf24" stopOpacity="0.9" />
            </linearGradient>
          </defs>

          {/* Path 1: Engineer -> Context Engine */}
          <path
            d="M 450 160 Q 300 160 220 160"
            fill="none"
            stroke="url(#cyan-blue-cable)"
            strokeWidth="2.5"
            strokeDasharray="6 4"
            className="animate-[dash_20s_linear_infinite]"
          />

          {/* Path 2: Human UI -> Engineer AI */}
          <path
            d="M 750 160 C 630 160, 600 160, 530 160"
            fill="none"
            stroke={simulatedState === "waiting_approval" ? "url(#amber-cable)" : "#334155"}
            strokeWidth={simulatedState === "waiting_approval" ? "3" : "2"}
            filter={simulatedState === "waiting_approval" ? "url(#glow-amber)" : undefined}
          />
          {simulatedState === "waiting_approval" && (
            <circle r="5" fill="#f59e0b" filter="url(#glow-amber)">
              <animateMotion d="M 530 160 L 750 160" dur="1.5s" repeatCount="indefinite" />
            </circle>
          )}

          {/* Path 3: Engineer AI -> Developer Agent (into Docker Sandbox) */}
          <path
            d="M 450 200 C 450 280, 260 280, 260 360"
            fill="none"
            stroke="url(#cyan-blue-cable)"
            strokeWidth="2.5"
            filter="url(#glow-cyan)"
          />
          <circle r="4" fill="#38bdf8" filter="url(#glow-cyan)">
            <animateMotion d="M 450 200 C 450 280, 260 280, 260 360" dur="2.2s" repeatCount="indefinite" />
          </circle>

          {/* Path 4: Developer Agent -> Validate Checker (Inside Docker Sandbox) */}
          <path
            d="M 330 420 L 520 420"
            fill="none"
            stroke="#10b981"
            strokeWidth="2.5"
            strokeDasharray="4 3"
          />
          <circle r="4" fill="#34d399">
            <animateMotion d="M 330 420 L 520 420" dur="1.2s" repeatCount="indefinite" />
          </circle>

          {/* Path 5: Validate Checker -> Engineer AI (Feedback Loop) */}
          <path
            d="M 600 360 C 600 280, 480 280, 480 200"
            fill="none"
            stroke="#10b981"
            strokeWidth="2"
          />
        </svg>

        {/* TOP LAYER: Nodes & Docker Sandbox Container */}
        <div className="relative z-10 grid grid-cols-12 gap-6">

          {/* Node 1: Context Engine (Top Left) */}
          <div className="col-span-4 col-start-1 pt-4">
            <div
              onClick={() => setSelectedNode("context")}
              className={`group cursor-pointer rounded-xl border p-4 backdrop-blur-md transition-all duration-300 ${
                selectedNode === "context"
                  ? "border-cyan-400 bg-slate-900/90 shadow-[0_0_20px_rgba(34,211,238,0.25)]"
                  : "border-slate-800 bg-slate-900/60 hover:border-slate-700"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] font-bold text-cyan-400 uppercase tracking-widest">Repository Base</span>
                <span className="h-2 w-2 rounded-full bg-slate-500" />
              </div>
              <h4 className="mt-1 font-sans text-base font-bold text-slate-100">Context Engine</h4>
              <p className="mt-1 text-xs text-slate-400">Indexed brief & code rules</p>
              <div className="mt-3 flex items-center gap-2 font-mono text-[11px] text-cyan-300 bg-cyan-950/40 border border-cyan-800/30 rounded-md px-2 py-1">
                <span>📁 48 files indexed</span>
              </div>
            </div>
          </div>

          {/* Node 2: Engineer (AI Brain) (Top Center) */}
          <div className="col-span-4 col-start-5 pt-4">
            <div
              onClick={() => setSelectedNode("engineer")}
              className={`group cursor-pointer rounded-xl border p-4 backdrop-blur-md transition-all duration-300 ${
                selectedNode === "engineer"
                  ? "border-blue-400 bg-slate-900/90 shadow-[0_0_25px_rgba(59,130,246,0.3)]"
                  : "border-blue-900/50 bg-slate-900/70 hover:border-blue-700"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] font-bold text-blue-400 uppercase tracking-widest">Orchestrator</span>
                <span className="h-2.5 w-2.5 rounded-full bg-blue-400 animate-ping" />
              </div>
              <h4 className="mt-1 font-sans text-lg font-bold text-slate-100 flex items-center gap-2">
                Engineer (AI)
              </h4>
              <p className="mt-1 text-xs text-slate-300">Gemini 3.1 Pro Coordinator</p>
              <div className="mt-3 flex items-center justify-between font-mono text-[11px] text-blue-300 bg-blue-950/50 border border-blue-800/40 rounded-md px-2.5 py-1">
                <span>Routing Dataflows</span>
                <span className="text-[10px] text-blue-400">180ms</span>
              </div>
            </div>
          </div>

          {/* Node 3: Human / UI Gate (Top Right) */}
          <div className="col-span-4 col-start-9 pt-4">
            <div
              onClick={() => setSelectedNode("human")}
              className={`group cursor-pointer rounded-xl border p-4 backdrop-blur-md transition-all duration-300 ${
                selectedNode === "human"
                  ? "border-amber-400 bg-slate-900/90 shadow-[0_0_25px_rgba(245,158,11,0.3)]"
                  : simulatedState === "waiting_approval"
                  ? "border-amber-500/80 bg-amber-950/20 shadow-[0_0_15px_rgba(245,158,11,0.2)] animate-pulse"
                  : "border-slate-800 bg-slate-900/60 hover:border-slate-700"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] font-bold text-amber-400 uppercase tracking-widest">Operator Gate</span>
                <span className={`h-2 w-2 rounded-full ${simulatedState === "waiting_approval" ? "bg-amber-400" : "bg-slate-500"}`} />
              </div>
              <h4 className="mt-1 font-sans text-base font-bold text-slate-100">Human / UI Console</h4>
              <p className="mt-1 text-xs text-slate-400">Final task approval authority</p>
              <div className="mt-3 flex items-center gap-2 font-mono text-[11px] text-amber-300 bg-amber-950/40 border border-amber-800/40 rounded-md px-2 py-1">
                <span>{simulatedState === "waiting_approval" ? "⚠️ 1 Decision Needed" : "✓ System Unblocked"}</span>
              </div>
            </div>
          </div>

          {/* DOCKER SANDBOX ISOLATED BOUNDARY (Bottom 2/3) */}
          <div className="col-span-12 mt-10 rounded-2xl border-2 border-dashed border-emerald-500/40 bg-emerald-950/10 p-5 backdrop-blur-sm">
            {/* Docker Header Badge */}
            <div className="flex items-center justify-between mb-4 border-b border-emerald-900/40 pb-2.5">
              <div className="flex items-center gap-2 font-mono text-xs font-bold text-emerald-400">
                <span className="rounded bg-emerald-500/20 px-2 py-0.5 border border-emerald-500/40">DOCKER CONTAINER</span>
                <span className="text-slate-400">Isolation Scope: Safe Sandbox Environment</span>
              </div>
              <span className="font-mono text-[11px] text-emerald-400/80">Container ID: ax-runner-7a91</span>
            </div>

            {/* Nodes inside Docker */}
            <div className="grid grid-cols-12 gap-6 items-center">

              {/* Developer AI (Worker) */}
              <div className="col-span-5 col-start-2">
                <div
                  onClick={() => setSelectedNode("developer")}
                  className={`group cursor-pointer rounded-xl border p-4 backdrop-blur-md transition-all duration-300 ${
                    selectedNode === "developer"
                      ? "border-emerald-400 bg-slate-900/90 shadow-[0_0_20px_rgba(16,185,129,0.3)]"
                      : "border-emerald-900/50 bg-slate-900/80 hover:border-emerald-700"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] font-bold text-emerald-400 uppercase tracking-widest">Active Worker</span>
                    <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  </div>
                  <h4 className="mt-1 font-sans text-base font-bold text-slate-100">Developer (AI)</h4>
                  <p className="mt-1 text-xs text-slate-400">Generates code & modifies AST</p>
                  
                  {/* Real-time Telemetry Chip */}
                  <div className="mt-3 space-y-1 font-mono text-[11px]">
                    <div className="flex items-center justify-between rounded bg-slate-950 px-2 py-1 text-emerald-300 border border-slate-800">
                      <span>edited routes.ts</span>
                      <span className="text-[10px] text-slate-400">+42 lines</span>
                    </div>
                    <div className="text-[10px] text-slate-400 px-1">analysed auth parameters</div>
                  </div>
                </div>
              </div>

              {/* Data Flow Indicator Pill between Developer & Validator */}
              <div className="col-span-2 text-center">
                <div className="inline-block rounded-full bg-slate-900 px-3 py-1 border border-emerald-500/40 text-[10px] font-mono text-emerald-400 shadow-lg">
                  ast diff ➔
                </div>
              </div>

              {/* Validate Checker AI (QA Sentinel) */}
              <div className="col-span-5 col-start-8">
                <div
                  onClick={() => setSelectedNode("validator")}
                  className={`group cursor-pointer rounded-xl border p-4 backdrop-blur-md transition-all duration-300 ${
                    selectedNode === "validator"
                      ? "border-teal-400 bg-slate-900/90 shadow-[0_0_20px_rgba(20,184,166,0.3)]"
                      : "border-teal-900/50 bg-slate-900/80 hover:border-teal-700"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] font-bold text-teal-400 uppercase tracking-widest">QA Sentinel</span>
                    <span className="h-2 w-2 rounded-full bg-teal-400" />
                  </div>
                  <h4 className="mt-1 font-sans text-base font-bold text-slate-100">Validate Checker (AI)</h4>
                  <p className="mt-1 text-xs text-slate-400">Deterministic verification</p>

                  <div className="mt-3 flex items-center justify-between font-mono text-[11px] text-teal-300 bg-teal-950/40 border border-teal-800/40 rounded-md px-2.5 py-1">
                    <span>vitest: 14 PASSING</span>
                    <span className="text-emerald-400 font-bold">100%</span>
                  </div>
                </div>
              </div>

            </div>
          </div>

        </div>
      </div>

      {/* Selected Node Inspection Drawer Panel */}
      {selectedNode && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-5 backdrop-blur-md shadow-xl transition-all">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <span className="font-mono text-xs font-semibold uppercase tracking-wider text-cyan-400">
                {NODE_DETAILS[selectedNode].type} Inspection
              </span>
              <h3 className="text-lg font-bold text-slate-100">{NODE_DETAILS[selectedNode].title}</h3>
            </div>
            <button
              onClick={() => setSelectedNode(null)}
              className="text-xs text-slate-400 hover:text-slate-200"
            >
              ✕ Close
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="col-span-2 space-y-3">
              <p className="text-sm text-slate-300">{NODE_DETAILS[selectedNode].description}</p>
              <div className="rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-xs text-slate-300">
                <span className="text-slate-500">Latest Packet Event: </span>
                <span className="text-cyan-300">{NODE_DETAILS[selectedNode].recentEvent}</span>
              </div>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-2">
              <h5 className="font-mono text-xs font-bold text-slate-400 uppercase">Live Telemetry</h5>
              {Object.entries(NODE_DETAILS[selectedNode].metrics).map(([key, val]) => (
                <div key={key} className="flex justify-between text-xs font-mono">
                  <span className="text-slate-500">{key}:</span>
                  <span className="text-slate-200 font-semibold">{val}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
