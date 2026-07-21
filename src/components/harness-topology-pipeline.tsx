"use client";

import React, { useState } from "react";

interface PipelineStep {
  id: number;
  phase: string;
  agent: string;
  action: string;
  codeSnippet: string;
  status: "completed" | "active" | "queued";
}

export function HarnessTopologyPipeline() {
  const [activeStep, setActiveStep] = useState<number>(2);

  const steps: PipelineStep[] = [
    {
      id: 1,
      phase: "01. CONTEXT SYNTHESIS",
      agent: "Context Engine",
      action: "Scanned 48 repo files & parsed tsconfig.json constraints",
      codeSnippet: `// Canonical Constraints Injected\ntarget: "ES2022", strict: true\nexports: ["app/api/auth"]`,
      status: "completed",
    },
    {
      id: 2,
      phase: "02. WORKER DISPATCH",
      agent: "Developer Agent (Docker)",
      action: "Generating AST diff for src/routes.ts",
      codeSnippet: `+ import { validateSchema } from "@/lib/validator";\n+ export const POST = validateSchema(authHandler);`,
      status: "active",
    },
    {
      id: 3,
      phase: "03. SENTINEL QA",
      agent: "Validate Checker (Docker)",
      action: "Running vitest suite & TypeScript typecheck",
      codeSnippet: `PASS src/routes.test.ts (14 tests passed in 1.4s)\n0 Type Errors found in build target.`,
      status: "queued",
    },
    {
      id: 4,
      phase: "04. HUMAN APPROVAL GATE",
      agent: "Human Console",
      action: "Awaiting human decision to merge PR branch",
      codeSnippet: `Branch: feature/auth-zod (Head: 7a91bf2)\nDiff summary: +42 / -12 lines across 2 files`,
      status: "queued",
    },
  ];

  return (
    <div className="w-full space-y-6 font-mono">
      {/* Visual Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-blue-900/40 bg-slate-900/90 p-4 backdrop-blur-md">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-blue-400 animate-pulse" />
            <h3 className="text-sm font-bold text-blue-300">Cyber Matrix Execution Pipeline</h3>
          </div>
          <p className="text-xs text-slate-400 font-sans mt-0.5">High-density visual telemetry of active AST code modifications & harness stages.</p>
        </div>
        <div className="flex gap-2">
          {steps.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveStep(s.id)}
              className={`rounded px-3 py-1 text-xs font-bold transition-all ${
                activeStep === s.id
                  ? "bg-blue-500/20 text-blue-300 border border-blue-500/50 shadow-lg"
                  : "bg-slate-800 text-slate-400 hover:text-slate-200"
              }`}
            >
              Step 0{s.id}
            </button>
          ))}
        </div>
      </div>

      {/* Main Flow Canvas */}
      <div className="relative min-h-[520px] w-full rounded-2xl border border-blue-900/40 bg-slate-950 p-6 shadow-2xl overflow-hidden select-none">
        {/* Hologram Grid */}
        <div className="absolute inset-0 bg-[radial-gradient(#1e3a8a_1.5px,transparent_1.5px)] [background-size:20px_20px] opacity-30 pointer-events-none" />

        {/* Matrix Flow Line */}
        <div className="relative z-10 grid grid-cols-1 md:grid-cols-4 gap-4 pt-4">
          {steps.map((step) => {
            const isCurrent = step.id === activeStep;
            return (
              <div
                key={step.id}
                onClick={() => setActiveStep(step.id)}
                className={`cursor-pointer rounded-xl border p-4 backdrop-blur-md transition-all duration-300 ${
                  isCurrent
                    ? "border-blue-400 bg-slate-900/95 shadow-[0_0_25px_rgba(59,130,246,0.35)] scale-105"
                    : step.status === "completed"
                    ? "border-emerald-800/60 bg-slate-900/60"
                    : "border-slate-800/80 bg-slate-900/40 opacity-70"
                }`}
              >
                <div className="flex justify-between items-center text-[10px]">
                  <span className="font-bold text-blue-400">{step.phase}</span>
                  <span className={`h-2 w-2 rounded-full ${
                    step.status === "completed" ? "bg-emerald-400" : isCurrent ? "bg-blue-400 animate-ping" : "bg-slate-600"
                  }`} />
                </div>
                <h4 className="text-sm font-bold text-slate-100 mt-2">{step.agent}</h4>
                <p className="text-[11px] text-slate-400 mt-1 line-clamp-2">{step.action}</p>

                <div className="mt-4 rounded bg-slate-950 p-2 font-mono text-[10px] text-emerald-300 border border-slate-800">
                  <pre className="overflow-x-auto whitespace-pre-wrap">{step.codeSnippet}</pre>
                </div>
              </div>
            );
          })}
        </div>

        {/* Interactive Deep Inspection Stream */}
        <div className="relative z-10 mt-8 rounded-xl border border-slate-800 bg-slate-900/90 p-5 backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-3">
            <h4 className="text-xs font-bold text-blue-300 uppercase tracking-widest">
              Live Pipeline Stream: Stage 0{activeStep} Details
            </h4>
            <span className="text-[10px] text-emerald-400">STATE: ACTIVE EXECUTION</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
            <div className="space-y-2">
              <div className="text-slate-400">Agent Identifier: <span className="text-white font-bold">{steps[activeStep - 1].agent}</span></div>
              <div className="text-slate-400">Action Telemetry: <span className="text-cyan-300">{steps[activeStep - 1].action}</span></div>
            </div>
            <div className="rounded bg-slate-950 p-3 text-emerald-300 border border-slate-800">
              <div className="text-[10px] text-slate-500 mb-1">// AST / CODE TRANSFORM OUTPUT:</div>
              <pre>{steps[activeStep - 1].codeSnippet}</pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
