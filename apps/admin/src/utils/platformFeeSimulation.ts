import {
  computeOrderPricing,
  MAX_PLATFORM_FEE_PCT,
  PLATFORM_FEE_SERVICE_TYPES,
  PricingDenominatorOverflowError,
  normalizePlatformFeePctByService,
  resolvePlatformFeePct,
  type PlatformFeePctByService,
  type PlatformFeeServiceType,
  type PricingResult,
} from '@take-me/shared';

export const PLATFORM_FEE_SIMULATION_BASE_CENTS = 10000;
export const MAX_GLOBAL_PLATFORM_FEE_PCT = MAX_PLATFORM_FEE_PCT;

export const PLATFORM_FEE_SERVICE_LABELS: Array<{
  type: PlatformFeeServiceType;
  label: string;
  description: string;
}> = [
  {
    type: 'booking',
    label: 'Viagens',
    description: 'Reservas de passageiros em viagens de motorista.',
  },
  {
    type: 'dependent_shipment',
    label: 'Dependentes',
    description: 'Transporte/envio de dependentes vinculado a uma viagem.',
  },
  {
    type: 'shipment_driver',
    label: 'Encomenda com motorista',
    description: 'Entrega direta por motorista, sem preparador/base.',
  },
  {
    type: 'shipment_preparer',
    label: 'Encomenda com preparador',
    description: 'Fluxo de encomenda com preparador ou base.',
  },
  {
    type: 'excursion',
    label: 'Excursões',
    description: 'Orçamentos e pagamentos de excursão.',
  },
];

export type PlatformFeeSimulation =
  | { ok: true; result: PricingResult }
  | { ok: false; error: string };

export function parsePercentInput(value: string): number | null {
  const normalized = value.trim().replace('%', '').replace(',', '.');
  if (!normalized) return null;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function validateGlobalPlatformFeePct(value: number | null): string | null {
  if (value == null) return 'Informe uma taxa global.';
  if (value < 0) return 'A taxa global nao pode ser negativa.';
  if (value > MAX_GLOBAL_PLATFORM_FEE_PCT) {
    return `A taxa global deve ser no maximo ${MAX_GLOBAL_PLATFORM_FEE_PCT}%.`;
  }
  return null;
}

export function normalizeServiceFeeInputs(
  rawByService: unknown,
  fallbackPct: number,
): Record<PlatformFeeServiceType, string> {
  const byService = normalizePlatformFeePctByService(rawByService);
  return PLATFORM_FEE_SERVICE_TYPES.reduce((acc, serviceType) => {
    acc[serviceType] = String(resolvePlatformFeePct(byService, serviceType, fallbackPct));
    return acc;
  }, {} as Record<PlatformFeeServiceType, string>);
}

export function serviceFeeInputsToPayload(
  inputs: Record<PlatformFeeServiceType, string>,
): { value: PlatformFeePctByService | null; error: string | null } {
  const value: PlatformFeePctByService = {};
  for (const service of PLATFORM_FEE_SERVICE_TYPES) {
    const parsed = parsePercentInput(inputs[service] ?? '');
    const validation = validateGlobalPlatformFeePct(parsed);
    if (validation) return { value: null, error: validation };
    value[service] = Math.round((parsed ?? 0) * 100) / 100;
  }
  return { value, error: null };
}

export function simulateGlobalPlatformFee(
  adminPct: number,
  baseCents = PLATFORM_FEE_SIMULATION_BASE_CENTS,
): PlatformFeeSimulation {
  try {
    return {
      ok: true,
      result: computeOrderPricing({
        baseCents,
        adminPct,
        surchargesCents: 0,
        gainPct: 0,
        discountPct: 0,
      }),
    };
  } catch (err) {
    if (err instanceof PricingDenominatorOverflowError) {
      return { ok: false, error: 'Taxa alta demais para a formula de precificacao.' };
    }
    return { ok: false, error: 'Nao foi possivel simular esta taxa.' };
  }
}

export function formatBRLCents(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

export function formatPercent(value: number): string {
  return `${value.toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}%`;
}
