"use client";

import React from "react";
import { HarnessTopologyFusion } from "@/components/harness-topology-fusion";

export function HarnessTopology({
  projectId,
  hasContext,
  openClarifications,
  activeTask,
  automationState,
}: {
  projectId?: string;
  hasContext: boolean;
  openClarifications: number;
  activeTask: { state: string; objective: string } | null;
  automationState: "running" | "frozen" | null;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[11px] font-bold tracking-widest text-cyan-400 uppercase">
            LIVE HARNESS MAP
          </p>
          <h2 className="text-xl font-bold text-slate-100">Bounded Delivery Flow Subnet</h2>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-cyan-500/40 bg-cyan-950/60 px-3 py-1 text-xs font-mono font-bold text-cyan-300">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
          <span>{activeTask ? activeTask.state.replaceAll("_", " ") : "idle"}</span>
        </div>
      </div>

      <HarnessTopologyFusion
        projectId={projectId}
        hasContext={hasContext}
        openClarifications={openClarifications}
        activeTask={activeTask}
        automationState={automationState}
        showSimulationControls={true}
      />
    </section>
  );
}
