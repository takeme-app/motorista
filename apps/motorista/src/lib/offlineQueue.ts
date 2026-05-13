/**
 * Fila persistente de mutações para replay quando voltar a internet.
 *
 * Usada para ações idempotentes ou monotônicas onde a UX pode tolerar latência:
 *  - `complete_trip_stop`: motorista confirma parada offline → enfileira → flush online.
 *  - `start_journey`: registrar timestamp de início de jornada.
 *
 * Não é usada para ações com efeitos colaterais críticos no servidor (ex.: cobrança).
 *
 * Persistência: AsyncStorage como JSON serializado. Falha de gravação
 * silenciosa (cache é otimização). Flush em ordem FIFO.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

export type QueuedMutation =
  | {
      kind: 'complete_trip_stop';
      payload: { trip_stop_id: string; confirmation_code: string | null };
      enqueuedAt: number;
    }
  | {
      kind: 'start_journey';
      payload: { trip_id: string; started_at: string };
      enqueuedAt: number;
    };

const QUEUE_KEY = 'offlineQueue:v1';
const MAX_QUEUE_SIZE = 200;

let flushInFlight: Promise<{ ok: number; failed: number }> | null = null;

async function readQueue(): Promise<QueuedMutation[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueuedMutation[]) : [];
  } catch {
    return [];
  }
}

async function writeQueue(queue: QueuedMutation[]): Promise<void> {
  try {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // ignore — falha de write não pode quebrar a tela.
  }
}

export async function enqueueMutation(m: QueuedMutation): Promise<void> {
  const queue = await readQueue();
  if (queue.length >= MAX_QUEUE_SIZE) {
    // Drop o mais antigo — sinal de que algo está muito errado, mas não bloqueia.
    queue.shift();
  }
  queue.push(m);
  await writeQueue(queue);
}

export async function getQueueSize(): Promise<number> {
  const queue = await readQueue();
  return queue.length;
}

export async function clearQueue(): Promise<void> {
  try {
    await AsyncStorage.removeItem(QUEUE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Tenta executar cada mutação da fila contra o backend. Cada mutação é
 * executada em ordem; se uma falhar, paramos para preservar a ordem (a
 * próxima tentativa vai reprocessar a partir desse ponto).
 *
 * Idempotência:
 *  - `complete_trip_stop`: o RPC já é idempotente (rejeita se a parada já está
 *    completa retornando `ok: false / error: 'already_completed'` — tratamos
 *    como sucesso para limpar da fila).
 *  - `start_journey`: o trigger só atualiza `driver_journey_started_at` se for
 *    null; reexecutar é seguro.
 */
export async function flushQueue(): Promise<{ ok: number; failed: number }> {
  if (flushInFlight) return flushInFlight;
  flushInFlight = (async () => {
    let ok = 0;
    let failed = 0;
    const queue = await readQueue();
    if (queue.length === 0) return { ok, failed };

    const remaining: QueuedMutation[] = [];
    let networkBroken = false;

    for (let i = 0; i < queue.length; i++) {
      const m = queue[i]!;
      if (networkBroken) {
        remaining.push(m);
        continue;
      }
      const success = await applyMutation(m);
      if (success === 'ok') {
        ok += 1;
      } else if (success === 'permanent') {
        // Erro de validação: descarta para não travar a fila.
        failed += 1;
      } else {
        // Falha de rede: para o flush e re-enfileira tudo daqui pra frente.
        networkBroken = true;
        remaining.push(m);
      }
    }

    await writeQueue(remaining);
    return { ok, failed };
  })();

  try {
    return await flushInFlight;
  } finally {
    flushInFlight = null;
  }
}

type ApplyResult = 'ok' | 'permanent' | 'transient';

async function applyMutation(m: QueuedMutation): Promise<ApplyResult> {
  try {
    if (m.kind === 'complete_trip_stop') {
      const { data, error } = await supabase.rpc(
        'complete_trip_stop' as never,
        {
          p_trip_stop_id: m.payload.trip_stop_id,
          p_confirmation_code: m.payload.confirmation_code,
        } as never,
      );
      if (error) return isTransientError(error) ? 'transient' : 'permanent';
      const payload = data as { ok?: boolean; error?: string } | null;
      if (!payload || payload.ok === true) return 'ok';
      // Erros de servidor já avaliados (já completa, código errado, etc.):
      // descartamos para não bloquear a fila — UI já mostrou erro na hora.
      if (payload.error === 'already_completed') return 'ok';
      return 'permanent';
    }
    if (m.kind === 'start_journey') {
      // Cast `as never` para colunas ausentes na tipagem gerada do Supabase
      // (mesmo padrão usado em outros pontos do app, ex.: ActiveTripScreen).
      const { error } = await supabase
        .from('scheduled_trips')
        .update({ driver_journey_started_at: m.payload.started_at } as never)
        .eq('id', m.payload.trip_id)
        .is('driver_journey_started_at', null);
      if (error) return isTransientError(error) ? 'transient' : 'permanent';
      return 'ok';
    }
    return 'permanent';
  } catch (e) {
    return isTransientError(e) ? 'transient' : 'permanent';
  }
}

function isTransientError(e: unknown): boolean {
  const msg = (e as { message?: string } | null)?.message?.toLowerCase() ?? '';
  return (
    msg.includes('network') ||
    msg.includes('fetch') ||
    msg.includes('timeout') ||
    msg.includes('failed to fetch') ||
    msg.includes('connection')
  );
}
