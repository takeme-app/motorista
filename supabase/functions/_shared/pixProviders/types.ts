// Tipos da camada de provedores Pix (Asaas hoje; Bradesco futuro).
// A escolha do provedor (platform_settings.pix_provider) governa SÓ a criação
// de cobranças novas — webhook, polling, expiração e reconciliação operam pelo
// pix_charges.provider gravado na própria linha.

export type PixProviderName = "asaas" | "bradesco";

export type PixProviderEnv = "sandbox" | "production";

/** Modo efetivo do gestor: paliativo (QR estático, sem verificação) ou provedor real. */
export type PixMode = "palliative" | PixProviderName;

/** Shape FLAT de platform_settings.pix_provider (contrato compartilhado do plano). */
export type PixProviderSetting = {
  mode: PixMode;
  test_provider: PixProviderName | null;
  allowlist_user_ids: string[];
  charge_ttl_minutes: number;
};

export type CreatePixChargeInput = {
  /** pix_charges.id — vai como externalReference no provedor (reconciliação). */
  internalId: string;
  userId: string;
  amountCents: number;
  /** CPF só dígitos (11). Asaas exige para criar o customer. */
  cpfDigits: string;
  customerName: string;
  description?: string;
};

export type CreatePixChargeResult = {
  providerChargeId: string;
  qrPayload: string;
  qrImageBase64: string;
};

/** Status normalizado de uma cobrança consultada no provedor. */
export type ProviderChargeStatus =
  | "pending"
  | "paid"
  | "expired"
  | "refunded"
  | "cancelled"
  | "unknown";

export type ProviderChargeSnapshot = {
  providerChargeId: string;
  status: ProviderChargeStatus;
  /** Valor pago em centavos (quando o provedor informa). */
  paidAmountCents: number | null;
  /** ISO do pagamento (quando o provedor informa). */
  paidAt: string | null;
  /** externalReference devolvido pelo provedor (= pix_charges.id nosso). */
  externalReference: string | null;
  raw: unknown;
};

export interface PixProvider {
  name: PixProviderName;
  env: PixProviderEnv;
  createCharge(input: CreatePixChargeInput): Promise<CreatePixChargeResult>;
  getChargeStatus(providerChargeId: string): Promise<ProviderChargeSnapshot>;
  /** Best-effort — quem chama decide se a falha importa. */
  cancelCharge(providerChargeId: string): Promise<void>;
}

/** Provedor escolhido mas sem secrets configurados (ou não implementado). */
export class PixProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PixProviderUnavailableError";
  }
}
