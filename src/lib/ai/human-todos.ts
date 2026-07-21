import { z } from "zod";
import { createGeminiClient, resolveConfiguredGeminiModel, withGeminiRateLimitRetry } from "@/lib/ai/gemini";

const humanTodoSchema = z.object({
  title: z.string().trim().min(5).max(280),
  rationale: z.string().trim().min(5).max(900),
  suggested_action: z.string().trim().min(5).max(900),
});

const responseSchema = z.object({
  todos: z.array(humanTodoSchema).max(6),
});

function stripCodeFence(value: string) {
  return value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
}

export async function generateHumanTodos(input: {
  projectContext: unknown;
  features: unknown;
  tasks: unknown;
  clarifications: unknown;
  priorHumanComments: unknown;
  model?: string;
}) {
  const client = createGeminiClient();
  const prompt = [
    "Create a short human worklist for an engineering project managed by Axiom.",
    "The list is for the project owner, not for the coding agent. Include only meaningful human decisions, comments, or checks. Never duplicate a task approval, completed-branch review, clarification, or explicit prerequisite: those already appear in Axiom's decision inbox.",
    "Use zero to six items. Return zero items when the human should genuinely do nothing.",
    "Each item must be concrete, short, and safe. Do not ask for secrets, credentials, or vague status checks.",
    "Treat prior human comments as new direction. Turn a comment into a todo only when it still needs a human action; otherwise use it as context and omit it.",
    "Return JSON only matching this schema:",
    JSON.stringify({ todos: [{ title: "string", rationale: "Why the owner should care.", suggested_action: "A short suggested action." }] }),
    "Approved project context:", JSON.stringify(input.projectContext),
    "Features:", JSON.stringify(input.features),
    "Tasks:", JSON.stringify(input.tasks),
    "Open clarifications:", JSON.stringify(input.clarifications),
    "Prior human comments:", JSON.stringify(input.priorHumanComments),
  ].join("\n\n");

  const interaction = await withGeminiRateLimitRetry(() => client.interactions.create({
    model: resolveConfiguredGeminiModel(input.model),
    store: false,
    response_format: { type: "text", mime_type: "application/json" },
    system_instruction: "You are Axiom's human-control assistant. Be concise, evidence-based, and never invent project facts.",
    input: prompt,
  }));
  if (!interaction.output_text) throw new Error("Axiom returned no human worklist.");
  const parsed = responseSchema.safeParse(JSON.parse(stripCodeFence(interaction.output_text)));
  if (!parsed.success) throw new Error("Axiom returned an invalid human worklist.");
  return parsed.data.todos;
}
