"use client";

import React, { useState, useEffect } from "react";

interface PacketLog {
  id: string;
  timestamp: string;
  source: string;
  destination: string;
  protocol: "TCP" | "UDP" | "HTTP/2" | "IPC";
  type: string;
  status: "OK" | "PENDING" | "ERROR" | "BLOCKED";
  payload: string;
}

export function HarnessTopologyCisco() {
  const [activePackets, setActivePackets] = useState<number[]>([1, 2, 3]);
  const [selectedPacket, setSelectedPacket] = useState<PacketLog | null>(null);
  const [packetLogs, setPacketLogs] = useState<PacketLog[]>([
    {
      id: "pkt-901",
      timestamp: "12:54:02.104",
      source: "Human_UI (10.0.0.1:443)",
      destination: "Engineer_AI (10.0.0.2:8080)",
      protocol: "HTTP/2",
      type: "TASK_PROPOSAL",
      status: "OK",
      payload: `{\n  "taskId": "task-881",\n  "intent": "Refactor auth middleware to use Zod schemas",\n  "priority": 1\n}`,
    },
    {
      id: "pkt-902",
      timestamp: "12:54:02.310",
      source: "Engineer_AI (10.0.0.2:8080)",
      destination: "Context_Engine (10.0.0.3:50051)",
      protocol: "IPC",
      type: "CONTEXT_QUERY",
      status: "OK",
      payload: `{\n  "query": "find auth routes and tsconfig limits",\n  "scope": ["src/routes.ts", "tsconfig.json"]\n}`,
    },
    {
      id: "pkt-903",
      timestamp: "12:54:02.620",
      source: "Engineer_AI (10.0.0.2:8080)",
      destination: "Developer_Worker (172.17.0.2:9000)",
      protocol: "TCP",
      type: "DISPATCH_INSTRUCTION",
      status: "OK",
      payload: `{\n  "action": "MODIFY_FILE",\n  "file": "src/routes.ts",\n  "prompt": "Apply Zod validation to POST /api/login"\n}`,
    },
    {
      id: "pkt-904",
      timestamp: "12:54:03.110",
      source: "Developer_Worker (172.17.0.2:9000)",
      destination: "Validate_Checker (172.17.0.3:9001)",
      protocol: "UDP",
      type: "STREAM_AST_DIFF",
      status: "PENDING",
      payload: `{\n  "diff": "+ import { z } from 'zod';\\n+ const schema = z.object({ email: z.string().email() });",\n  "filesChanged": 1\n}`,
    },
  ]);

  // Auto-add simulated packet events
  useEffect(() => {
    const timer = setInterval(() => {
      const newPkt: PacketLog = {
        id: `pkt-${Math.floor(100 + Math.random() * 900)}`,
        timestamp: new Date().toISOString().split("T")[1].slice(0, 12),
        source: "Developer_Worker (172.17.0.2)",
        destination: "Validate_Checker (172.17.0.3)",
        protocol: "UDP",
        type: "TELEMETRY_HEARTBEAT",
        status: "OK",
        payload: `{\n  "cpu": "14%",\n  "memory": "240MB",\n  "status": "Running Vitest test suite"\n}`,
      };
      setPacketLogs((prev) => [newPkt, ...prev.slice(0, 7)]);
    }, 4000);

    return () => clearInterval(timer);
  }, []);

  const injectPacket = (type: "PROPOSAL" | "DROP" | "PASS") => {
    const injected: PacketLog = {
      id: `pkt-${Math.floor(100 + Math.random() * 900)}`,
      timestamp: new Date().toISOString().split("T")[1].slice(0, 12),
      source: type === "PROPOSAL" ? "Human_UI" : "Validate_Checker",
      destination: type === "PROPOSAL" ? "Engineer_AI" : "Human_UI",
      protocol: type === "PROPOSAL" ? "HTTP/2" : "TCP",
      type: type === "PROPOSAL" ? "INJECT_TASK" : type === "DROP" ? "NETWORK_DROP_ERR" : "VERIFICATION_SUCCESS",
      status: type === "DROP" ? "ERROR" : type === "PROPOSAL" ? "PENDING" : "OK",
      payload: `{\n  "event": "${type}",\n  "simulated": true,\n  "timestamp": "${new Date().toISOString()}"\n}`,
    };
    setPacketLogs((prev) => [injected, ...prev.slice(0, 7)]);
    setSelectedPacket(injected);
  };

  return (
    <div className="w-full space-y-6 font-mono">
      {/* Simulation Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-emerald-900/40 bg-slate-900/90 p-4 backdrop-blur-md">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
            <h3 className="text-sm font-bold text-emerald-300">Cisco Packet Tracer Network Simulator</h3>
          </div>
          <p className="text-xs text-slate-400 font-sans mt-0.5">Real-time packet routing, hex payloads, and sub-network interface telemetry.</p>
        </div>
        <div className="flex gap-2 text-xs">
          <button
            onClick={() => injectPacket("PROPOSAL")}
            className="rounded border border-cyan-500/50 bg-cyan-950/60 px-3 py-1.5 text-cyan-300 hover:bg-cyan-900/60 font-semibold"
          >
            + Inject Task Packet
          </button>
          <button
            onClick={() => injectPacket("PASS")}
            className="rounded border border-emerald-500/50 bg-emerald-950/60 px-3 py-1.5 text-emerald-300 hover:bg-emerald-900/60 font-semibold"
          >
            ✓ Inject ACK Packet
          </button>
          <button
            onClick={() => injectPacket("DROP")}
            className="rounded border border-red-500/50 bg-red-950/60 px-3 py-1.5 text-red-300 hover:bg-red-900/60 font-semibold"
          >
            ! Inject RST Error
          </button>
        </div>
      </div>

      {/* Main Network Telemetry Grid */}
      <div className="relative min-h-[580px] w-full rounded-2xl border border-emerald-900/40 bg-slate-950 p-6 shadow-2xl overflow-hidden select-none">
        {/* Tactical Dark Grid Background */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#0f172a_1px,transparent_1px),linear-gradient(to_bottom,#0f172a_1px,transparent_1px)] bg-[size:32px_32px] opacity-60 pointer-events-none" />

        {/* Top Network Status Strip */}
        <div className="relative z-10 flex items-center justify-between border-b border-slate-800 pb-3 mb-6">
          <div className="flex items-center gap-3">
            <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-500/30">
              NETWORK TOPOLOGY: SUBNET 10.0.0.0/24
            </span>
            <span className="text-xs text-slate-400">STATUS: ROUTING ACTIVE</span>
          </div>
          <div className="text-xs text-slate-400">THROUGHPUT: 4.8 KB/s</div>
        </div>

        {/* SVG Network Cables & Moving Packets */}
        <svg className="absolute inset-0 h-full w-full pointer-events-none z-0">
          <defs>
            <filter id="cisco-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Cable 1: Human (10.0.0.1) -> Engineer (10.0.0.2) */}
          <line x1="180" y1="140" x2="480" y2="140" stroke="#1e293b" strokeWidth="4" />
          <line x1="180" y1="140" x2="480" y2="140" stroke="#06b6d4" strokeWidth="1.5" strokeDasharray="6 4" />
          <g filter="url(#cisco-glow)">
            <circle r="6" fill="#22d3ee">
              <animateMotion path="M 180 140 L 480 140" dur="2s" repeatCount="indefinite" />
            </circle>
          </g>

          {/* Cable 2: Engineer (10.0.0.2) -> Context (10.0.0.3) */}
          <line x1="480" y1="140" x2="780" y2="140" stroke="#1e293b" strokeWidth="4" />
          <line x1="480" y1="140" x2="780" y2="140" stroke="#3b82f6" strokeWidth="1.5" strokeDasharray="6 4" />
          <g filter="url(#cisco-glow)">
            <circle r="6" fill="#60a5fa">
              <animateMotion path="M 780 140 L 480 140" dur="3s" repeatCount="indefinite" />
            </circle>
          </g>

          {/* Cable 3: Engineer (10.0.0.2) -> Docker Bridge (172.17.0.1) */}
          <path d="M 480 180 C 480 260, 240 260, 240 340" fill="none" stroke="#1e293b" strokeWidth="4" />
          <path d="M 480 180 C 480 260, 240 260, 240 340" fill="none" stroke="#10b981" strokeWidth="2" />
          <g filter="url(#cisco-glow)">
            <circle r="6" fill="#34d399">
              <animateMotion path="M 480 180 C 480 260, 240 260, 240 340" dur="2.5s" repeatCount="indefinite" />
            </circle>
          </g>

          {/* Cable 4: Developer (172.17.0.2) -> Validator (172.17.0.3) */}
          <line x1="310" y1="410" x2="680" y2="410" stroke="#065f46" strokeWidth="3" />
          <line x1="310" y1="410" x2="680" y2="410" stroke="#34d399" strokeWidth="1.5" strokeDasharray="8 4" />
          <g filter="url(#cisco-glow)">
            <circle r="6" fill="#a7f3d0">
              <animateMotion path="M 310 410 L 680 410" dur="1.4s" repeatCount="indefinite" />
            </circle>
          </g>
        </svg>

        {/* NODES & ROUTERS LAYER */}
        <div className="relative z-10 grid grid-cols-12 gap-6">

          {/* Node 1: Operator UI (10.0.0.1) */}
          <div className="col-span-4">
            <div className="rounded-xl border border-cyan-800/60 bg-slate-900/90 p-4 shadow-lg backdrop-blur-md">
              <div className="flex justify-between items-center text-[10px] text-cyan-400">
                <span>[NODE: OPERATOR_UI]</span>
                <span className="font-bold">10.0.0.1</span>
              </div>
              <h4 className="text-sm font-bold text-slate-100 mt-1">Human Control Deck</h4>
              <div className="mt-2 space-y-1 text-[11px] text-slate-400">
                <div>IFACE: <span className="text-cyan-300">eth0 (PROMISCUOUS)</span></div>
                <div>LISTEN: <span className="text-slate-200">port 443 [HTTPS]</span></div>
              </div>
              <div className="mt-3 flex items-center justify-between rounded bg-slate-950 px-2 py-1 text-[10px] text-emerald-400 border border-slate-800">
                <span>PACKET PKT-901</span>
                <span>SENT (4.2KB)</span>
              </div>
            </div>
          </div>

          {/* Node 2: Engineer AI Router (10.0.0.2) */}
          <div className="col-span-4">
            <div className="rounded-xl border-2 border-blue-500/60 bg-slate-900/95 p-4 shadow-xl shadow-blue-500/10 backdrop-blur-md">
              <div className="flex justify-between items-center text-[10px] text-blue-400">
                <span>[CORE ROUTER: AI_ENGINEER]</span>
                <span className="font-bold">10.0.0.2</span>
              </div>
              <h4 className="text-base font-bold text-slate-100 mt-1 flex items-center gap-2">
                📡 Engineer (AI Hub)
              </h4>
              <div className="mt-2 space-y-1 text-[11px] text-slate-400">
                <div>GATEWAY: <span className="text-blue-300">10.0.0.254</span></div>
                <div>PACKET QUEUE: <span className="text-emerald-400">0 dropped / 142 routed</span></div>
              </div>
              <div className="mt-3 rounded bg-blue-950/60 p-2 border border-blue-800/40 text-[10px] text-blue-200">
                LAST ROUTED: <span className="text-white font-bold">DISPATCH_INSTRUCTION ➔ 172.17.0.2</span>
              </div>
            </div>
          </div>

          {/* Node 3: Context Engine (10.0.0.3) */}
          <div className="col-span-4">
            <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-4 shadow-lg backdrop-blur-md">
              <div className="flex justify-between items-center text-[10px] text-slate-400">
                <span>[NODE: CONTEXT_DB]</span>
                <span className="font-bold">10.0.0.3</span>
              </div>
              <h4 className="text-sm font-bold text-slate-100 mt-1">Context Database</h4>
              <div className="mt-2 space-y-1 text-[11px] text-slate-400">
                <div>IFACE: <span className="text-slate-300">gRPC (port 50051)</span></div>
                <div>EMBEDDINGS: <span className="text-cyan-300">48 vectors</span></div>
              </div>
              <div className="mt-3 rounded bg-slate-950 px-2 py-1 text-[10px] text-slate-400 border border-slate-800">
                QUERY STATE: IDLE
              </div>
            </div>
          </div>

          {/* DOCKER SUBNET CONTAINER BOUNDARY (172.17.0.0/16) */}
          <div className="col-span-12 mt-6 rounded-2xl border-2 border-dashed border-emerald-500/50 bg-emerald-950/20 p-5 backdrop-blur-md">
            <div className="flex items-center justify-between border-b border-emerald-900/60 pb-2 mb-4">
              <div className="flex items-center gap-2 text-xs font-bold text-emerald-400">
                <span className="rounded bg-emerald-500/30 px-2 py-0.5 border border-emerald-500/50">
                  DOCKER SUBNET: 172.17.0.0/16
                </span>
                <span>VIRTUAL ETHERNET BRIDGE (docker0)</span>
              </div>
              <span className="text-[10px] text-emerald-400">NAT ENCAPSULATION ACTIVE</span>
            </div>

            <div className="grid grid-cols-12 gap-6 items-center">

              {/* Developer Worker (172.17.0.2) */}
              <div className="col-span-5">
                <div className="rounded-xl border border-emerald-600/60 bg-slate-900/90 p-4 shadow-lg">
                  <div className="flex justify-between items-center text-[10px] text-emerald-400">
                    <span>[CONTAINER: DEV_WORKER]</span>
                    <span className="font-bold">172.17.0.2</span>
                  </div>
                  <h4 className="text-sm font-bold text-slate-100 mt-1">Developer Agent</h4>
                  <div className="mt-2 text-[11px] text-slate-300 space-y-1">
                    <div>PAYLOAD EXECUTING: <span className="text-emerald-400">routes.ts AST</span></div>
                    <div>IPC PIPE: <span className="text-slate-400">/var/run/docker.sock</span></div>
                  </div>
                  <div className="mt-3 rounded bg-slate-950 p-2 text-[10px] font-mono text-emerald-300 border border-slate-800">
                    PACKET #402 ➔ STREAMING AST DIFF
                  </div>
                </div>
              </div>

              {/* Cisco Packet Callout Badge on Cable */}
              <div className="col-span-2 text-center">
                <div className="inline-block rounded-md bg-emerald-950 border border-emerald-500/50 px-2.5 py-1 text-[10px] text-emerald-300 font-bold shadow-lg">
                  [UDP] PKT-904
                </div>
              </div>

              {/* Validate Sentinel (172.17.0.3) */}
              <div className="col-span-5">
                <div className="rounded-xl border border-teal-600/60 bg-slate-900/90 p-4 shadow-lg">
                  <div className="flex justify-between items-center text-[10px] text-teal-400">
                    <span>[CONTAINER: QA_SENTINEL]</span>
                    <span className="font-bold">172.17.0.3</span>
                  </div>
                  <h4 className="text-sm font-bold text-slate-100 mt-1">Validate Checker</h4>
                  <div className="mt-2 text-[11px] text-slate-300 space-y-1">
                    <div>VALIDATION SUITE: <span className="text-teal-300">Vitest Deterministic</span></div>
                    <div>STATUS: <span className="text-emerald-400 font-bold">14/14 PASS</span></div>
                  </div>
                  <div className="mt-3 rounded bg-slate-950 p-2 text-[10px] font-mono text-teal-300 border border-slate-800">
                    ACK SENT ➔ Engineer_AI
                  </div>
                </div>
              </div>

            </div>
          </div>

        </div>
      </div>

      {/* REAL-TIME PACKET TELEMETRY CONSOLE & PAYLOAD INSPECTOR */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Packet Stream Feed */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-4 backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-3">
            <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
              📡 Real-Time Packet Sniffer Log (tcpdump)
            </h4>
            <span className="text-[10px] text-cyan-400">{packetLogs.length} Packets Captured</span>
          </div>

          <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1 text-xs">
            {packetLogs.map((pkt) => (
              <div
                key={pkt.id}
                onClick={() => setSelectedPacket(pkt)}
                className={`cursor-pointer rounded p-2 transition-all flex items-center justify-between ${
                  selectedPacket?.id === pkt.id
                    ? "bg-cyan-950/80 border border-cyan-500/50 text-cyan-200"
                    : "bg-slate-950/70 hover:bg-slate-800/80 text-slate-300"
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
                </div>
                <div className="flex items-center gap-3 text-[10px] text-slate-400">
                  <span>{pkt.timestamp}</span>
                  <span className={`font-bold ${pkt.status === "OK" ? "text-emerald-400" : pkt.status === "ERROR" ? "text-red-400" : "text-amber-400"}`}>
                    [{pkt.status}]
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Packet Hex/JSON Payload Inspector */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-4 backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-3">
            <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
              🔍 Wireshark Payload Inspector
            </h4>
            <span className="text-[10px] text-slate-400">{selectedPacket ? selectedPacket.id : "No Packet Selected"}</span>
          </div>

          {selectedPacket ? (
            <div className="space-y-2 text-xs">
              <div className="grid grid-cols-2 gap-2 text-[11px] bg-slate-950 p-2 rounded border border-slate-800 text-slate-300">
                <div><span className="text-slate-500">SRC:</span> {selectedPacket.source}</div>
                <div><span className="text-slate-500">DST:</span> {selectedPacket.destination}</div>
              </div>
              <div className="space-y-1">
                <div className="text-[10px] text-slate-400">PAYLOAD DECODED (JSON):</div>
                <pre className="rounded bg-slate-950 p-3 text-[11px] text-emerald-300 border border-slate-800 overflow-x-auto">
                  {selectedPacket.payload}
                </pre>
              </div>
            </div>
          ) : (
            <div className="flex h-40 items-center justify-center text-xs text-slate-500">
              Click any packet in the sniffer log to inspect raw header payload.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
