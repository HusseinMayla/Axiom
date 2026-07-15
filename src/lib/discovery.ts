export type DiscoveryField =
  | "problem"
  | "targetUsers"
  | "workflows"
  | "mvpScope"
  | "features"
  | "integrations"
  | "technicalConstraints"
  | "brandDirection"
  | "approvalBoundaries"
  | "successAndFuture";

export type DiscoveryAnswers = Partial<Record<DiscoveryField, string>>;

export const discoverySections: Array<{
  key: DiscoveryField;
  title: string;
  prompt: string;
  hint: string;
}> = [
  {
    key: "problem",
    title: "Problem and business context",
    prompt: "What problem is this project solving, for whom, and why does it matter now?",
    hint: "Describe the customer pain, business opportunity, or process being improved.",
  },
  {
    key: "targetUsers",
    title: "Target users and roles",
    prompt: "Who will use this product? What roles, permissions, or responsibilities do they have?",
    hint: "Include primary users first, then anyone who reviews, manages, or administers work.",
  },
  {
    key: "workflows",
    title: "Main workflows",
    prompt: "Describe the three most important actions users should be able to complete.",
    hint: "Write them as outcomes: “A project manager can…”",
  },
  {
    key: "mvpScope",
    title: "MVP scope and non-goals",
    prompt: "What must be in the first usable version, and what is deliberately excluded?",
    hint: "A clear non-goal is as useful as a requirement.",
  },
  {
    key: "features",
    title: "Features and priorities",
    prompt: "List the features you expect and order them by importance.",
    hint: "Focus on outcomes and workflows rather than pages or technical details.",
  },
  {
    key: "integrations",
    title: "Data and integrations",
    prompt: "Which repositories, APIs, accounts, or data sources are required?",
    hint: "Name what is needed and what information each integration provides.",
  },
  {
    key: "technicalConstraints",
    title: "Technical constraints",
    prompt: "Are there required technologies, libraries, platforms, performance needs, or existing systems?",
    hint: "Include constraints the AI must not override.",
  },
  {
    key: "brandDirection",
    title: "Brand and UI direction",
    prompt: "What should the product feel like visually and verbally?",
    hint: "Reference products, colors, tone, accessibility, and interface preferences.",
  },
  {
    key: "approvalBoundaries",
    title: "Security and approval boundaries",
    prompt: "What requires human approval? What actions, credentials, or data must agents never access?",
    hint: "This becomes Axiom’s operating policy.",
  },
  {
    key: "successAndFuture",
    title: "Success, deadlines, and future plans",
    prompt: "How will you judge the MVP, when is it needed, and what comes after it?",
    hint: "Include demo success criteria, delivery deadline, and later-stage ambitions.",
  },
];

