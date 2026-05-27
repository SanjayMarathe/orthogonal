import { useCallback, useEffect, useState } from "react";
import type { Conversation } from "@/lib/supabase";
import {
  ensureValidAccessToken,
  getAppUser,
  subscribeAuthChange,
} from "@/lib/appAuth";

export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchConversations = useCallback(async () => {
    const user = getAppUser();
    if (!user) {
      setConversations([]);
      setLoading(false);
      return;
    }
    const token = await ensureValidAccessToken();
    if (!token) {
      setConversations([]);
      setLoading(false);
      return;
    }
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
    const res = await fetch(`${supabaseUrl}/functions/v1/conversations`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const json = (await res.json()) as { conversations?: Conversation[] };
      setConversations(json.conversations ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchConversations();
    const unsub = subscribeAuthChange(() => {
      setLoading(true);
      void fetchConversations();
    });
    return unsub;
  }, [fetchConversations]);

  const createConversation = useCallback(async () => {
    const user = getAppUser();
    if (!user) return null;
    const token = await ensureValidAccessToken();
    if (!token) return null;
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
    const res = await fetch(`${supabaseUrl}/functions/v1/conversations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: "New chat" }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { conversation?: Conversation };
    if (!json.conversation) return null;
    const conv = json.conversation;
    setConversations((prev) => [conv, ...prev]);
    return conv;
  }, []);

  return {
    conversations,
    loading,
    refresh: fetchConversations,
    createConversation,
    setConversations,
  };
}
