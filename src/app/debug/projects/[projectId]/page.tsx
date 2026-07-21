import type { Metadata } from "next";
import { ProjectDebugWorkspace } from "@/app/projects/[projectId]/page";

export const metadata: Metadata = {
  title: "Axiom debug workspace",
  robots: { index: false, follow: false },
};

/**
 * Internal transition workspace. It is intentionally not linked from the product
 * UI and retains the existing authenticated project checks in ProjectDebugWorkspace.
 */
export default ProjectDebugWorkspace;
