import type { SupabaseClient } from '@supabase/supabase-js';

export type DriverPlatformFeeLedgerKind = 'credit' | 'debit';

export type DriverPlatformFeeLedgerEntry = {
  id: string;
  bookingId: string | null;
  kind: DriverPlatformFeeLedgerKind;
  amountCents: number;
  note: string;
  createdAt: string;
};

export type DriverPlatformFeeSummary = {
  owedCents: number;
  entries: DriverPlatformFeeLedgerEntry[];
  unavailable: boolean;
};

const EMPTY_SUMMARY: DriverPlatformFeeSummary = {
  owedCents: 0,
  entries: [],
  unavailable: false,
};

function asPositiveCents(value: unknown): number {
  const cents = Math.floor(Number(value));
  return Number.isFinite(cents) && cents > 0 ? cents : 0;
}

function isRpcUnavailable(error: unknown): boolean {
  const msg = String((error as { message?: unknown } | null)?.message ?? '');
  return /could not find the function|schema cache|404|PGRST202/i.test(msg);
}

function normalizeLedgerKind(value: unknown): DriverPlatformFeeLedgerKind {
  return value === 'debit' ? 'debit' : 'credit';
}

function normalizeEntry(row: unknown): DriverPlatformFeeLedgerEntry | null {
  if (!row || typeof row !== 'object') return null;
  const raw = row as Record<string, unknown>;
  const id = typeof raw.id === 'string' ? raw.id : '';
  const createdAt = typeof raw.created_at === 'string' ? raw.created_at : '';
  const amountCents = asPositiveCents(raw.amount_cents);
  if (!id || !createdAt || amountCents <= 0) return null;
  return {
    id,
    bookingId: typeof raw.booking_id === 'string' ? raw.booking_id : null,
    kind: normalizeLedgerKind(raw.kind),
    amountCents,
    note: typeof raw.note === 'string' ? raw.note : '',
    createdAt,
  };
}

export async function fetchDriverPlatformFeeSummary(
  supabase: SupabaseClient,
  limit = 5,
): Promise<DriverPlatformFeeSummary> {
  const { data, error } = await supabase.rpc('driver_platform_fee_summary' as never, {
    p_limit: limit,
  } as never);

  if (error) {
    if (isRpcUnavailable(error)) return { ...EMPTY_SUMMARY, unavailable: true };
    throw error;
  }

  const payload = data as {
    ok?: boolean;
    error?: string;
    platform_fee_owed_cents?: unknown;
    entries?: unknown;
  } | null;

  if (!payload?.ok) {
    if (payload?.error === 'missing_worker_profile') return EMPTY_SUMMARY;
    throw new Error(payload?.error || 'Não foi possível carregar o saldo da plataforma.');
  }

  const entries = Array.isArray(payload.entries)
    ? payload.entries.map(normalizeEntry).filter((entry): entry is DriverPlatformFeeLedgerEntry => Boolean(entry))
    : [];

  return {
    owedCents: asPositiveCents(payload.platform_fee_owed_cents),
    entries,
    unavailable: false,
  };
}

export function platformFeeLedgerTitle(entry: DriverPlatformFeeLedgerEntry): string {
  if (entry.kind === 'credit') {
    if (entry.note === 'cash_trip_completed') return 'Taxa de corrida em dinheiro';
    if (entry.note === 'refund_revert') return 'Abate revertido por estorno';
    return 'Saldo registrado';
  }

  if (entry.note === 'connect_charge_abate') return 'Abatido via cartão/Pix';
  if (entry.note === 'manual_adjustment') return 'Ajuste manual';
  return 'Saldo abatido';
}

export function platformFeeLedgerAmountLabel(entry: DriverPlatformFeeLedgerEntry): string {
  const prefix = entry.kind === 'credit' ? '+' : '-';
  const amount = (entry.amountCents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
  return `${prefix}${amount}`;
}
