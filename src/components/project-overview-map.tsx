"use client";

import { useEffect, useState, useMemo } from "react";

interface Feature {
  id: string;
  name: string;
  description: string;
  priority: number;
  status: string;
}

interface Task {
  id: string;
  feature_id: string;
  objective: string;
  state: string;
  branch_name: string | null;
  head_sha: string | null;
  developer_report: unknown;
}

interface Branch {
  name: string;
  protected: boolean;
  sha: string;
}

interface ProjectOverviewMapProps {
  projectId: string;
  projectName: string;
  features: Feature[];
  tasks: Task[];
  initialRepositoryTree: string[];
  defaultBranch: string;
}

interface FolderTreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children: Record<string, FolderTreeNode>;
}

export function ProjectOverviewMap({
  projectId,
  projectName,
  features,
  tasks,
  initialRepositoryTree,
  defaultBranch,
}: ProjectOverviewMapProps) {
  // Branch management
  const [selectedBranch, setSelectedBranch] = useState(defaultBranch);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [repositoryTree, setRepositoryTree] = useState<string[]>(initialRepositoryTree);
  const [isLoadingTree, setIsLoadingTree] = useState(false);
  const [errorTree, setErrorTree] = useState<string | null>(null);

  // Collapsible states
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {
      project_root: true,
    };
    // Default all features to expanded
    features.forEach((f) => {
      initial[`feature-${f.id}`] = true;
    });
    return initial;
  });

  // Fetch branches on mount
  useEffect(() => {
    let active = true;
    async function loadBranches() {
      try {
        const res = await fetch(`/api/projects/${projectId}/branches`);
        if (!res.ok) return;
        const data = await res.json();
        if (active && data.branches) {
          setBranches(data.branches);
        }
      } catch (err) {
        console.error("Failed to fetch branches", err);
      }
    }
    loadBranches();
    return () => {
      active = false;
    };
  }, [projectId]);

  // Handle branch change
  const handleBranchChange = async (branchName: string) => {
    setSelectedBranch(branchName);
    setIsLoadingTree(true);
    setErrorTree(null);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/tree?branch=${encodeURIComponent(branchName)}`
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to load branch tree.");
      }
      setRepositoryTree(data.tree || []);
    } catch (err: any) {
      setErrorTree(err.message || "An error occurred fetching the folder structure.");
    } finally {
      setIsLoadingTree(false);
    }
  };

  // Toggle node expand/collapse
  const toggleNode = (nodeId: string) => {
    setExpandedNodes((prev) => ({
      ...prev,
      [nodeId]: !prev[nodeId],
    }));
  };

  // Expand / Collapse All Helpers
  const expandAllEvidence = () => {
    const updated: Record<string, boolean> = { project_root: true };
    features.forEach((f) => {
      updated[`feature-${f.id}`] = true;
      const featTasks = tasks.filter((t) => t.feature_id === f.id);
      featTasks.forEach((t) => {
        updated[`task-${t.id}`] = true;
        updated[`task-files-${t.id}`] = true;
        updated[`task-val-${t.id}`] = true;
      });
    });
    setExpandedNodes((prev) => ({ ...prev, ...updated }));
  };

  const collapseAllEvidence = () => {
    const updated: Record<string, boolean> = { project_root: false };
    features.forEach((f) => {
      updated[`feature-${f.id}`] = false;
      const featTasks = tasks.filter((t) => t.feature_id === f.id);
      featTasks.forEach((t) => {
        updated[`task-${t.id}`] = false;
        updated[`task-files-${t.id}`] = false;
        updated[`task-val-${t.id}`] = false;
      });
    });
    setExpandedNodes((prev) => ({ ...prev, ...updated }));
  };

  // Parse tasks by feature ID
  const tasksByFeature = useMemo(() => {
    const map: Record<string, Task[]> = {};
    tasks.forEach((t) => {
      if (!map[t.feature_id]) {
        map[t.feature_id] = [];
      }
      map[t.feature_id].push(t);
    });
    return map;
  }, [tasks]);

  // Convert flat paths to FolderTree
  const folderTree = useMemo(() => {
    const root: FolderTreeNode = { name: "Root", path: "", type: "directory", children: {} };

    repositoryTree.forEach((path) => {
      const parts = path.split("/");
      let current = root;

      parts.forEach((part, i) => {
        const isLast = i === parts.length - 1;
        const currentPath = parts.slice(0, i + 1).join("/");

        if (!current.children[part]) {
          current.children[part] = {
            name: part,
            path: currentPath,
            type: isLast ? "file" : "directory",
            children: {},
          };
        }
        current = current.children[part];
      });
    });

    return root;
  }, [repositoryTree]);

  // Expand / Collapse Folder Tree Helpers
  const expandAllFolderTree = () => {
    const updated: Record<string, boolean> = {};
    const traverse = (node: FolderTreeNode) => {
      if (node.type === "directory" && node.path) {
        updated[`dir-${node.path}`] = true;
      }
      Object.values(node.children).forEach(traverse);
    };
    traverse(folderTree);
    setExpandedNodes((prev) => ({ ...prev, ...updated }));
  };

  const collapseAllFolderTree = () => {
    const updated: Record<string, boolean> = {};
    const traverse = (node: FolderTreeNode) => {
      if (node.type === "directory" && node.path) {
        updated[`dir-${node.path}`] = false;
      }
      Object.values(node.children).forEach(traverse);
    };
    traverse(folderTree);
    setExpandedNodes((prev) => ({ ...prev, ...updated }));
  };

  // Extract developer report contents
  const parseDeveloperReport = (reportVal: unknown) => {
    const report = (reportVal ?? {}) as Record<string, unknown>;
    const list = (key: string) =>
      Array.isArray(report[key]) ? report[key].filter((item): item is string => typeof item === "string") : [];
    return {
      summary: typeof report.summary === "string" ? report.summary : null,
      files_created: list("files_created"),
      files_modified: list("files_modified"),
      validation_results: list("validation_results"),
    };
  };

  // Recursive Directory Tree Component
  const renderDirectoryNode = (node: FolderTreeNode) => {
    const isDir = node.type === "directory";
    const nodeKey = `dir-${node.path}`;
    const isExpanded = expandedNodes[nodeKey] ?? false;
    const sortedChildren = Object.values(node.children).sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "directory" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    if (!node.path) {
      // Root level children render directly
      return (
        <div className="folder-tree-branch">
          {sortedChildren.map((child) => (
            <div key={child.path} className="tree-node-wrapper">
              {renderDirectoryNode(child)}
            </div>
          ))}
        </div>
      );
    }

    return (
      <div className="folder-tree-node">
        <div
          className={`tree-node-item ${isDir ? "directory-item" : "file-item"}`}
          onClick={() => isDir && toggleNode(nodeKey)}
        >
          {isDir ? (
            <>
              <span className="tree-toggle-icon">{isExpanded ? "▾" : "▸"}</span>
              <span className="tree-node-icon">{isExpanded ? "📂" : "📁"}</span>
              <strong className="tree-node-label">{node.name}</strong>
            </>
          ) : (
            <>
              <span className="tree-toggle-spacer" />
              <span className="tree-node-icon">📄</span>
              <span className="tree-node-label file-name">{node.name}</span>
            </>
          )}
        </div>

        {isDir && isExpanded && sortedChildren.length > 0 && (
          <div className="tree-node-children">
            {sortedChildren.map((child) => (
              <div key={child.path} className="tree-node-wrapper">
                {renderDirectoryNode(child)}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="overview-map-container">
      {/* Headings */}
      <div className="overview-section-heading">
        <div>
          <p className="eyebrow">INTELLIGENT TOPOLOGY</p>
          <h2>Project Artifact Map</h2>
        </div>
        <div className="topology-info-pill">
          <span>COLLAPSIBLE EVIDENCE TREE & CODE TREE</span>
        </div>
      </div>

      <div className="implementation-grid">
        {/* Left Column: Evidence Tree */}
        <div className="topology-card">
          <div className="topology-card-header">
            <h3>Evidence Tree</h3>
            <div className="tree-action-buttons">
              <button className="text-button" type="button" onClick={expandAllEvidence}>
                Expand All
              </button>
              <span className="separator">|</span>
              <button className="text-button" type="button" onClick={collapseAllEvidence}>
                Collapse All
              </button>
            </div>
          </div>

          <div className="tree-scroll-container">
            <div className="evidence-tree-root">
              {/* Project Root Node */}
              <div
                className="tree-node-item root-item"
                onClick={() => toggleNode("project_root")}
              >
                <span className="tree-toggle-icon">
                  {expandedNodes["project_root"] ? "▾" : "▸"}
                </span>
                <span className="tree-node-icon">🏢</span>
                <strong className="tree-node-label">{projectName}</strong>
                <small className="node-type-badge">Project</small>
              </div>

              {expandedNodes["project_root"] && (
                <div className="tree-node-children">
                  {features.length ? (
                    features.map((feature) => {
                      const featureNodeKey = `feature-${feature.id}`;
                      const isFeatureExpanded = expandedNodes[featureNodeKey] ?? false;
                      const featureTasks = tasksByFeature[feature.id] || [];

                      return (
                        <div key={feature.id} className="tree-node-wrapper">
                          <div
                            className={`tree-node-item feature-item status-${feature.status}`}
                            onClick={() => toggleNode(featureNodeKey)}
                          >
                            <span className="tree-toggle-icon">
                              {isFeatureExpanded ? "▾" : "▸"}
                            </span>
                            <span className="tree-node-icon">💡</span>
                            <strong className="tree-node-label">{feature.name}</strong>
                            <span className={`feature-status-dot ${feature.status}`} />
                            <small className="node-type-badge">Feature</small>
                          </div>

                          {isFeatureExpanded && (
                            <div className="tree-node-children">
                              {featureTasks.length ? (
                                featureTasks.map((task) => {
                                  const taskNodeKey = `task-${task.id}`;
                                  const isTaskExpanded = expandedNodes[taskNodeKey] ?? false;
                                  const report = parseDeveloperReport(task.developer_report);
                                  const hasReport = !!task.developer_report;
                                  const hasFiles =
                                    report.files_created.length > 0 ||
                                    report.files_modified.length > 0;
                                  const hasValidation = report.validation_results.length > 0;
                                  const isTaskCollapsible = hasFiles || hasValidation;

                                  return (
                                    <div key={task.id} className="tree-node-wrapper">
                                      <div
                                        className={`tree-node-item task-item state-${task.state}`}
                                        onClick={() =>
                                          isTaskCollapsible && toggleNode(taskNodeKey)
                                        }
                                      >
                                        {isTaskCollapsible ? (
                                          <span className="tree-toggle-icon">
                                            {isTaskExpanded ? "▾" : "▸"}
                                          </span>
                                        ) : (
                                          <span className="tree-toggle-spacer" />
                                        )}
                                        <span className="tree-node-icon">⚙️</span>
                                        <strong className="tree-node-label">{task.objective}</strong>
                                        <span className={`task-state-tag ${task.state}`}>
                                          {task.state.replaceAll("_", " ")}
                                        </span>
                                      </div>

                                      {isTaskExpanded && isTaskCollapsible && (
                                        <div className="tree-node-children">
                                          {/* Files Sub-node */}
                                          {hasFiles && (
                                            <div className="tree-node-wrapper">
                                              <div
                                                className="tree-node-item category-item"
                                                onClick={() =>
                                                  toggleNode(`task-files-${task.id}`)
                                                }
                                              >
                                                <span className="tree-toggle-icon">
                                                  {(expandedNodes[`task-files-${task.id}`] ??
                                                    true)
                                                    ? "▾"
                                                    : "▸"}
                                                </span>
                                                <span className="tree-node-icon">📂</span>
                                                <strong className="tree-node-label">
                                                  Changed Files
                                                </strong>
                                                <small className="change-count">
                                                  {report.files_created.length +
                                                    report.files_modified.length}
                                                </small>
                                              </div>

                                              {(expandedNodes[`task-files-${task.id}`] ??
                                                true) && (
                                                <div className="tree-node-children">
                                                  {report.files_created.map((file) => (
                                                    <div key={file} className="tree-node-item leaf-item">
                                                      <span className="tree-toggle-spacer" />
                                                      <span className="file-op-icon create">+</span>
                                                      <span className="tree-node-icon">📄</span>
                                                      <span className="tree-node-label file-path">
                                                        {file}
                                                      </span>
                                                      <span className="op-tag create">Created</span>
                                                    </div>
                                                  ))}
                                                  {report.files_modified.map((file) => (
                                                    <div key={file} className="tree-node-item leaf-item">
                                                      <span className="tree-toggle-spacer" />
                                                      <span className="file-op-icon modify">•</span>
                                                      <span className="tree-node-icon">📄</span>
                                                      <span className="tree-node-label file-path">
                                                        {file}
                                                      </span>
                                                      <span className="op-tag modify">Modified</span>
                                                    </div>
                                                  ))}
                                                </div>
                                              )}
                                            </div>
                                          )}

                                          {/* Validation Sub-node */}
                                          {hasValidation && (
                                            <div className="tree-node-wrapper">
                                              <div
                                                className="tree-node-item category-item"
                                                onClick={() =>
                                                  toggleNode(`task-val-${task.id}`)
                                                }
                                              >
                                                <span className="tree-toggle-icon">
                                                  {(expandedNodes[`task-val-${task.id}`] ??
                                                    true)
                                                    ? "▾"
                                                    : "▸"}
                                                </span>
                                                <span className="tree-node-icon">🧪</span>
                                                <strong className="tree-node-label">
                                                  Validation Evidence
                                                </strong>
                                              </div>

                                              {(expandedNodes[`task-val-${task.id}`] ??
                                                true) && (
                                                <div className="tree-node-children">
                                                  {report.validation_results.map((result, idx) => (
                                                    <div
                                                      key={idx}
                                                      className="tree-node-item leaf-item val-item"
                                                    >
                                                      <span className="tree-toggle-spacer" />
                                                      <span className="validation-status-icon">✓</span>
                                                      <span className="tree-node-label validation-result">
                                                        {result}
                                                      </span>
                                                    </div>
                                                  ))}
                                                </div>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })
                              ) : (
                                <p className="tree-empty-message">No task delivery evidence exists yet.</p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <p className="tree-empty-message">No features have been defined yet.</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Codebase Folder structure with switcher */}
        <div className="topology-card">
          <div className="topology-card-header flex-header">
            <div className="branch-selector-container">
              <span className="branch-label">Branch:</span>
              <select
                className="branch-dropdown"
                value={selectedBranch}
                onChange={(e) => handleBranchChange(e.target.value)}
                disabled={isLoadingTree}
              >
                <option value={defaultBranch}>{defaultBranch} (default)</option>
                {branches
                  .filter((b) => b.name !== defaultBranch)
                  .map((b) => (
                    <option key={b.name} value={b.name}>
                      {b.name}
                    </option>
                  ))}
              </select>
            </div>

            <div className="tree-action-buttons">
              <button className="text-button" type="button" onClick={expandAllFolderTree}>
                Expand All
              </button>
              <span className="separator">|</span>
              <button className="text-button" type="button" onClick={collapseAllFolderTree}>
                Collapse All
              </button>
            </div>
          </div>

          <div className="tree-scroll-container">
            {isLoadingTree ? (
              <div className="tree-loading-state">
                <span className="loading-spinner"></span>
                <p>Fetching repository structure from GitHub...</p>
              </div>
            ) : errorTree ? (
              <div className="tree-error-state">
                <strong>Error loading structure</strong>
                <p>{errorTree}</p>
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => handleBranchChange(selectedBranch)}
                >
                  Retry Scan
                </button>
              </div>
            ) : repositoryTree.length > 0 ? (
              <div className="evidence-tree-root">{renderDirectoryNode(folderTree)}</div>
            ) : (
              <p className="tree-empty-message">No files found on this branch.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
