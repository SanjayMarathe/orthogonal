import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { DEFAULT_MODEL_ID, type LlmModel } from "@/lib/models";
import { ensureValidAccessToken, subscribeAuthChange } from "@/lib/appAuth";

const STORAGE_KEY = "orthogonal-model";

type ModelsContextValue = {
  models: LlmModel[];
  modelsLoading: boolean;
  selectedModelId: string;
  setSelectedModelId: (id: string) => void;
  selectedModel: LlmModel | undefined;
};

const ModelsContext = createContext<ModelsContextValue | null>(null);

function readStoredModel(): string {
  if (typeof window === "undefined") return DEFAULT_MODEL_ID;
  return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_MODEL_ID;
}

export function ModelsProvider({ children }: { children: ReactNode }) {
  const [models, setModels] = useState<LlmModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [selectedModelId, setSelectedModelIdState] = useState(readStoredModel);

  const setSelectedModelId = useCallback((id: string) => {
    setSelectedModelIdState(id);
    localStorage.setItem(STORAGE_KEY, id);
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const token = await ensureValidAccessToken();
        if (!token) return;

        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
        const response = await fetch(`${supabaseUrl}/functions/v1/models`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) return;

        const data = (await response.json()) as { models: LlmModel[] };
        const list = data.models ?? [];
        setModels(list);
        if (list.length > 0) {
          setSelectedModelIdState((prev) => {
            if (list.some((m) => m.id === prev)) return prev;
            return (
              list.find((m) => m.id === DEFAULT_MODEL_ID)?.id ?? list[0].id
            );
          });
        }
      } finally {
        setModelsLoading(false);
      }
    }
    load();
    return subscribeAuthChange(() => {
      setModels([]);
      setModelsLoading(true);
      void load();
    });
  }, []);

  const selectedModel = models.find((m) => m.id === selectedModelId);

  return (
    <ModelsContext.Provider
      value={{
        models,
        modelsLoading,
        selectedModelId,
        setSelectedModelId,
        selectedModel,
      }}
    >
      {children}
    </ModelsContext.Provider>
  );
}

export function useModels() {
  const ctx = useContext(ModelsContext);
  if (!ctx) {
    throw new Error("useModels must be used within ModelsProvider");
  }
  return ctx;
}
