import { useCallback, useEffect, useState } from "react";
import type { Conversation } from "@/lib/supabase";
import { supabase } from "@/lib/supabase";

export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchConversations = useCallback(async () => {
    const { data, error } = await supabase
      .from("conversations")
      .select("*")
      .order("updated_at", { ascending: false });

    if (!error && data) {
      setConversations(data as Conversation[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  const createConversation = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from("conversations")
      .insert({ user_id: user.id, title: "New chat" })
      .select("*")
      .single();

    if (error || !data) return null;
    const conv = data as Conversation;
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
