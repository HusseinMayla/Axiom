"use client";

import React, { useState } from "react";
import { HarnessTopologyFusion } from "@/components/harness-topology-fusion";
import { HarnessTopologyCisco } from "@/components/harness-topology-cisco";
import { HarnessTopologyDemo } from "@/components/harness-topology-demo";
import Link from "next/link";

export default function TopologyDemoPage() {
  const [activeTab, setActiveTab] = useState<"fusion" | "cisco" | "isoglass">("fusion");

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 md:p-12 font-sans select-none">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Navigation & Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
              <span className="font-mono text-xs uppercase tracking-widest text-cyan-400">
                AXIOM HARNESS TOPOLOGY SUITE
              </span>
            </div>
            <h1 className="text-3xl font-extrabold text-white mt-1">Harness Topology Architecture Showcase</h1>
          </div>
          <Link
            href="/projects"
            className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800 transition"
          >
            ← Back to Projects
          </Link>
        </div>

        {/* Tab Selection Bar */}
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-800 pb-4">
          <button
            onClick={() => setActiveTab("fusion")}
            className={`rounded-xl px-5 py-3 text-xs font-bold transition-all flex items-center gap-2 ${
              activeTab === "fusion"
                ? "bg-emerald-500/20 text-emerald-300 border-2 border-emerald-500 shadow-lg shadow-emerald-500/20 scale-105"
                : "bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-200"
            }`}
          >
            <span>🏆 RECOMMENDED: Cisco Command Matrix (Option B Layout + Option A Cisco Styling)</span>
            <span className="rounded bg-emerald-500/30 px-2 py-0.5 text-[10px] text-emerald-300 font-mono">FUSION</span>
          </button>

          <button
            onClick={() => setActiveTab("cisco")}
            className={`rounded-xl px-5 py-3 text-xs font-bold transition-all flex items-center gap-2 ${
              activeTab === "cisco"
                ? "bg-cyan-500/20 text-cyan-300 border-2 border-cyan-500 shadow-lg shadow-cyan-500/20 scale-105"
                : "bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-200"
            }`}
          >
            <span>📡 Option A: Cisco Packet Tracer Grid</span>
          </button>

          <button
            onClick={() => setActiveTab("isoglass")}
            className={`rounded-xl px-5 py-3 text-xs font-bold transition-all flex items-center gap-2 ${
              activeTab === "isoglass"
                ? "bg-blue-500/20 text-blue-300 border-2 border-blue-500 shadow-lg shadow-blue-500/20 scale-105"
                : "bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-200"
            }`}
          >
            <span>💎 Option B: Iso-Glass Holographic HUD</span>
          </button>
        </div>

        {/* Evaluation Banner */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-xs leading-relaxed text-slate-300">
          {activeTab === "fusion" && (
            <p>
              <strong className="text-emerald-400">Cisco Command Matrix (Ultimate Fusion):</strong> Combines Option B's superior curved SVG Bezier spatial layout (large Docker sandbox container enclosure & top orchestration row) with Option A's high-contrast Cisco Packet Tracer dark color system, live packet sniffer log, Wireshark payload inspector, and packet injection controls!
            </p>
          )}
          {activeTab === "cisco" && (
            <p>
              <strong className="text-cyan-400">Option A (Cisco Packet Tracer Grid):</strong> Grid-based Cisco network telemetry view.
            </p>
          )}
          {activeTab === "isoglass" && (
            <p>
              <strong className="text-blue-400">Option B (Iso-Glass Holographic HUD):</strong> Spatial node visualizer layout.
            </p>
          )}
        </div>

        {/* Render Selected Visualizer */}
        <div className="transition-all duration-300">
          {activeTab === "fusion" && <HarnessTopologyFusion showSimulationControls={true} />}
          {activeTab === "cisco" && <HarnessTopologyCisco />}
          {activeTab === "isoglass" && <HarnessTopologyDemo />}
        </div>
      </div>
    </div>
  );
}
