import { z } from "zod";

export const developerReportSchema = z.object({
  summary: z.string().trim().min(5).max(4000),
  dashboard_summary: z.string().trim().min(5).max(280).default(""),
  files_created: z.array(z.string().trim()).default([]),
  files_modified: z.array(z.string().trim()).default([]),
  modules_or_interfaces: z.array(z.string().trim()).default([]),
  schema_or_configuration: z.array(z.string().trim()).default([]),
  behavior_delivered: z.array(z.string().trim()).default([]),
  validation_results: z.array(z.string().trim()).default([]),
  known_limitations: z.array(z.string().trim()).default([]),
  handoff: z.string().trim().default("Ready for review."),
});

export type DeveloperReport = z.infer<typeof developerReportSchema>;
