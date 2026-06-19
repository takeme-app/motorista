import { supabase } from './supabase';

const sb = supabase as { from: (table: string) => any };

/**
 * Garante uma linha em `conversations` entre o preparador (driver_id) e o cliente da excursão.
 * Reutiliza a mesma tabela do chat do motorista; booking_id fica nulo para excursões.
 */
export async function ensureExcursionClientConversation(input: {
  excursionRequestId: string;
  clientUserId: string;
  participantName: string;
  participantAvatar: string | null | undefined;
}): Promise<{ conversationId: string } | { error: string }> {
  const { excursionRequestId, clientUserId, participantName, participantAvatar } = input;
  if (!clientUserId?.trim()) {
    return { error: 'Cliente sem identificação para abrir o chat.' };
  }
  if (!excursionRequestId?.trim()) {
    return { error: 'Excursão sem identificação para abrir o chat.' };
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) {
    return { error: 'Sessão inválida. Faça login novamente.' };
  }

  // Escopo por excursão (mesma lógica de booking_id/shipment_id): cada excursão tem sua
  // própria conversa ativa, então uma excursão concluída não "encerra" a próxima.
  const { data: existing, error: selErr } = await sb
    .from('conversations')
    .select('id')
    .eq('excursion_request_id', excursionRequestId)
    .eq('status', 'active')
    .maybeSingle();

  if (selErr) {
    return { error: selErr.message || 'Não foi possível verificar conversas.' };
  }

  if (existing?.id) {
    return { conversationId: existing.id as string };
  }

  const avatar =
    participantAvatar != null && String(participantAvatar).trim() !== ''
      ? String(participantAvatar).trim()
      : null;

  const { data: inserted, error: insErr } = await sb
    .from('conversations')
    .insert({
      driver_id: user.id,
      client_id: clientUserId,
      booking_id: null,
      excursion_request_id: excursionRequestId,
      participant_name: participantName.trim() || 'Cliente',
      participant_avatar: avatar,
    })
    .select('id')
    .single();

  if (insErr || !inserted?.id) {
    return { error: insErr?.message || 'Não foi possível criar a conversa.' };
  }

  return { conversationId: inserted.id as string };
}
