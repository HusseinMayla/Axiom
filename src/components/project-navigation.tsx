"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

type ProjectNavigationProps = {
  projectId: string;
  projectName: string;
  projects?: Array<{ id: string; name: string }>;
  automationState?: "running" | "frozen" | null;
  attentionCount?: number;
};

const navigation = [
  { slug: "dashboard", label: "Dashboard", icon: "◈" },
  { slug: "overview", label: "Overview", icon: "◎" },
  { slug: "configuration", label: "Configuration", icon: "◌" },
];

export function ProjectNavigation({ projectId, projectName, projects = [], automationState = "running", attentionCount = 0 }: ProjectNavigationProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [automation, setAutomation] = useState(automationState ?? "running");
  const [automationPending, setAutomationPending] = useState(false);
  const frozen = automation === "frozen";

  async function toggleAutomation() {
    setAutomationPending(true);
    const next = frozen ? "running" : "frozen";
    const response = await fetch(`/api/projects/${projectId}/automation`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: next }) });
    setAutomationPending(false);
    if (!response.ok) return;
    setAutomation(next);
    router.refresh();
  }

  return (
    <>
      <aside className={frozen ? "project-sidebar is-frozen" : "project-sidebar"} aria-label="Project navigation">
        <Link className="project-brand" href="/projects" aria-label="Axiom projects">
          <span className="brand-mark">A</span>
          <span>AXIOM</span>
        </Link>
        <div className="sidebar-project-select" title={projectName}>
          <button className="project-chip-button" type="button" onClick={() => setProjectMenuOpen((open) => !open)} aria-expanded={projectMenuOpen}>
            <svg className="chip-icon" viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
              <path d="M5 3.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm0 2.122a2.25 2.25 0 10-1.5 0v5.256a2.251 2.251 0 101.5 0V5.372zM4.25 12a.75.75 0 110 1.5.75.75 0 010-1.5zm8-7a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm-1.5-1.372a2.25 2.25 0 101.5 0v1.75a2.25 2.25 0 01-2.25 2.25h-1.5a.75.75 0 010-1.5h1.5a.75.75 0 00.75-.75V3.628z" />
            </svg>
            <span className="chip-name">{projectName}</span>
            <svg className="chip-chevron" viewBox="0 0 12 12" width="10" height="10" fill="currentColor">
              <path d="M2.22 4.47a.75.75 0 011.06 0L6 7.19l2.72-2.72a.75.75 0 111.06 1.06l-3.25 3.25a.75.75 0 01-1.06 0L2.22 5.53a.75.75 0 010-1.06z" />
            </svg>
          </button>
          {projectMenuOpen && (
            <div className="project-switcher-menu">
              {projects.map((project) => (
                <Link className={project.id === projectId ? "active" : ""} href={`/projects/${project.id}/dashboard`} key={project.id} onClick={() => setProjectMenuOpen(false)}>
                  {project.name}
                  {project.id === projectId ? <span>Current</span> : null}
                </Link>
              ))}
            </div>
          )}
        </div>
        <div className={frozen ? "sidebar-freeze-toggle frozen" : "sidebar-freeze-toggle"}>
          <span className="freeze-label">Freeze automation</span>
          <button
            type="button"
            className={`toggle-switch ${frozen ? "active" : ""}`}
            onClick={toggleAutomation}
            disabled={automationPending}
            role="switch"
            aria-checked={frozen}
            aria-label="Freeze automation"
          >
            <span className="toggle-slider" />
          </button>
        </div>
        <nav className="project-nav-list">
          {navigation.map((item) => {
            const href = `/projects/${projectId}/${item.slug}`;
            const active = pathname === href;
            return (
              <Link className={active ? "project-nav-link active" : "project-nav-link"} href={href} key={item.slug}>
                <span aria-hidden="true">{item.icon}</span>
                {item.label}
                {item.slug === "dashboard" && attentionCount > 0 ? <b className="nav-attention-count" aria-label={`${attentionCount} items need your attention`}>{attentionCount > 99 ? "99+" : attentionCount}</b> : null}
              </Link>
            );
          })}
        </nav>
      </aside>

      <header className="mobile-project-header">
        <Link className="brand-mark" href="/projects" aria-label="Axiom projects">A</Link>
        <div>
          <span>CURRENT PROJECT</span>
          <strong>{projectName}</strong>
        </div>
        <span className={frozen ? "mobile-status frozen" : "mobile-status"} title={frozen ? "Automatic flow frozen" : "Automatic flow enabled"} />
      </header>

      <nav className="mobile-project-nav" aria-label="Project navigation">
        {navigation.map((item) => {
          const href = `/projects/${projectId}/${item.slug}`;
          const active = pathname === href;
          return (
            <Link className={active ? "mobile-nav-link active" : "mobile-nav-link"} href={href} key={item.slug}>
              <span aria-hidden="true">{item.icon}</span>
              {item.label}
              {item.slug === "dashboard" && attentionCount > 0 ? <b className="mobile-nav-attention-count" aria-label={`${attentionCount} items need your attention`}>{attentionCount > 99 ? "99+" : attentionCount}</b> : null}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
