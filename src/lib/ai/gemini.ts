import { GoogleGenAI } from "@google/genai";
import { getGeminiEnv } from "@/lib/env";

export type AxiomModelTier = "fast" | "smart";

export function createGeminiClient() {
  return new GoogleGenAI({ apiKey: getGeminiEnv().apiKey });
}

export function getGeminiModel(tier: AxiomModelTier) {
  const env = getGeminiEnv();
  return tier === "smart" ? env.smartModel : env.fastModel;
}

