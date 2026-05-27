import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { OrthogonalIntegration } from "@/lib/integrations";
import { ensureValidAccessToken, subscribeAuthChange } from "@/lib/appAuth";

type IntegrationsContextValue = {
  integrations: OrthogonalIntegration[];
  count: number;
  totalEndpoints: number;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

const IntegrationsContext = createContext<IntegrationsContextValue | null>(
  null,
);

export function IntegrationsProvider({ children }: { children: ReactNode }) {
  const [integrations, setIntegrations] = useState<OrthogonalIntegration[]>([]);
  const [count, setCount] = useState(0);
  const [totalEndpoints, setTotalEndpoints] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await ensureValidAccessToken();
      if (!token) {
        setError("Not authenticated");
        return;
      }

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const response = await fetch(
        `${supabaseUrl}/functions/v1/integrations`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(
          (err as { error?: string }).error ?? "Failed to load integrations",
        );
      }

      const data = (await response.json()) as {
        integrations: OrthogonalIntegration[];
        count?: number;
        totalEndpoints?: number;
      };
      setIntegrations(data.integrations ?? []);
      setCount(data.count ?? data.integrations?.length ?? 0);
      setTotalEndpoints(
        data.totalEndpoints ??
          data.integrations?.reduce((n, i) => n + i.endpoints.length, 0) ??
          0,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load integrations");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    return subscribeAuthChange(() => void refresh());
  }, [refresh]);

  return (
    <IntegrationsContext.Provider
      value={{ integrations, count, totalEndpoints, loading, error, refresh }}
    >
      {children}
    </IntegrationsContext.Provider>
  );
}

export function useIntegrations() {
  const ctx = useContext(IntegrationsContext);
  if (!ctx) {
    throw new Error("useIntegrations must be used within IntegrationsProvider");
  }
  return ctx;
}
