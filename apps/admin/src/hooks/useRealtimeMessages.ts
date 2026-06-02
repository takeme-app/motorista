import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';

// ── Types ────────────────────────────────────────────────────────────
export interface RealtimeMessage {
  id: string;
  sender_id: string;
  content: string;
  attachment_url: string | null;
  attachment_type: string | null;
  /** text | image | audio | file (esquema novo usado por motorista/cliente) */
  message_kind: string | null;
  /** Caminho no bucket privado chat-attachments (conversation_id/arquivo) */
  attachment_path: string | null;
  created_at: string;
  read_at: string | null;
}

interface UseRealtimeMessagesOptions {
  conversationId: string | null;
  /** Limite inicial de mensagens (default 50) */
  initialLimit?: number;
}

interface UseRealtimeMessagesReturn {
  messages: RealtimeMessage[];
  loading: boolean;
  error: string | null;
  /** Envia uma mensagem de texto ou com anexo (path no bucket chat-attachments + kind) */
  sendMessage: (content: string, attachment?: { path: string; kind: string }) => Promise<void>;
  /** Marca mensagens como lidas */
  markAsRead: () => Promise<void>;
  /** Recarrega mensagens */
  refresh: () => void;
}

// ── Hook ─────────────────────────────────────────────────────────────
export function useRealtimeMessages(opts: UseRealtimeMessagesOptions): UseRealtimeMessagesReturn {
  const { conversationId, initialLimit = 50 } = opts;
  const [messages, setMessages] = useState<RealtimeMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<any>(null);

  // Buscar mensagens iniciais
  const fetchMessages = useCallback(() => {
    if (!conversationId) {
      setMessages([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    (supabase as any)
      .from('messages')
      .select('id, sender_id, content, attachment_url, attachment_type, message_kind, attachment_path, created_at, read_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(initialLimit)
      .then(({ data, error: err }: any) => {
        if (err) {
          setError(err.message);
        } else {
          setMessages(data || []);
          setError(null);
        }
        setLoading(false);
      });
  }, [conversationId, initialLimit]);

  // Fetch inicial
  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  // Supabase Realtime subscription
  useEffect(() => {
    if (!conversationId) return;

    const channel = (supabase as any)
      .channel(`messages:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload: any) => {
          const newMsg: RealtimeMessage = payload.new;
          setMessages((prev) => {
            // Evitar duplicatas
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
        },
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        (supabase as any).removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [conversationId]);

  // Enviar mensagem
  const sendMessage = useCallback(
    async (content: string, attachment?: { path: string; kind: string }) => {
      if (!conversationId) return;

      const { data: session } = await (supabase as any).auth.getSession();
      const userId = session?.session?.user?.id;
      if (!userId) return;

      // message_kind aceita apenas text|image|audio|file (constraint). Vídeo é gravado como
      // 'file' e identificado pela extensão na hora de exibir.
      const kind = attachment?.kind ?? 'text';
      const placeholder = kind === 'image' ? '📷 Foto' : kind === 'audio' ? '🎤 Áudio' : '📎 Arquivo';
      const finalContent = content || (attachment ? placeholder : '');

      const insertData: any = {
        conversation_id: conversationId,
        sender_id: userId,
        content: finalContent,
        message_kind: kind,
      };
      if (attachment?.path) insertData.attachment_path = attachment.path;

      const { error: err } = await (supabase as any).from('messages').insert(insertData);
      if (err) setError(err.message);

      // Atualizar last_message na conversa (o trigger handle_new_message também atualiza,
      // mas mantemos para feedback imediato quando o trigger não estiver presente).
      await (supabase as any)
        .from('conversations')
        .update({
          last_message: finalContent,
          last_message_at: new Date().toISOString(),
        })
        .eq('id', conversationId);
    },
    [conversationId],
  );

  // Marcar como lidas
  const markAsRead = useCallback(async () => {
    if (!conversationId) return;

    const { data: session } = await (supabase as any).auth.getSession();
    const userId = session?.session?.user?.id;
    if (!userId) return;

    await (supabase as any)
      .from('messages')
      .update({ read_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .neq('sender_id', userId)
      .is('read_at', null);
  }, [conversationId]);

  return {
    messages,
    loading,
    error,
    sendMessage,
    markAsRead,
    refresh: fetchMessages,
  };
}
