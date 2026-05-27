import { GROQ_MODEL_CATALOG, isGroqConfigured } from "./groq.ts";
import { orthogonalRun } from "./orthogonal.ts";

export type LlmModel = {
  id: string;
  name: string;
  description?: string;
  contextLength?: number;
};

export async function fetchBasetenModels(): Promise<LlmModel[]> {
  const result = await orthogonalRun("baseten", "/v1/models");
  if (!result.ok) {
    throw new Error(
      (result as { error?: string }).error ?? "Failed to fetch models",
    );
  }

  const wrapper = result.data as Record<string, unknown>;
  const inner = (wrapper.data ?? wrapper) as unknown;
  const list = Array.isArray(inner) ? inner : [];

  return list
    .filter((m: Record<string, unknown>) => {
      const features = m.supported_features as string[] | undefined;
      return features?.includes("tools");
    })
    .map((m: Record<string, unknown>) => ({
      id: `baseten:${String(m.id)}`,
      name: `Baseten · ${String(m.name ?? m.id)}`,
      description: m.description as string | undefined,
      contextLength: m.context_length as number | undefined,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchAllModels(): Promise<LlmModel[]> {
  const groqModels = isGroqConfigured() ? GROQ_MODEL_CATALOG : [];
  try {
    const baseten = await fetchBasetenModels();
    return [...groqModels, ...baseten];
  } catch {
    return groqModels;
  }
}

export function getDefaultModelId(): string {
  if (isGroqConfigured()) return "groq:llama-3.3-70b-versatile";
  return "baseten:moonshotai/Kimi-K2.5";
}

/** @deprecated use getDefaultModelId() */
export const DEFAULT_MODEL_ID = "groq:llama-3.3-70b-versatile";
