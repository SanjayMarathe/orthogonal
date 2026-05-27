export const DEFAULT_MODEL_ID = "groq:llama-3.3-70b-versatile";

export type LlmModel = {
  id: string;
  name: string;
  description?: string;
  contextLength?: number;
};

export function shortModelName(name: string): string {
  return name.length > 22 ? `${name.slice(0, 20)}…` : name;
}
