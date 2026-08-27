// Adapter Bradesco — STUB que prova a abstração (implementar quando o cliente
// fornecer credenciais/certificados mTLS; ver plano do gestor de provedores).
// A escolha no admin já lista "Bradesco (em breve)" desabilitado; se algum dia
// a flag apontar para cá sem implementação, a criação falha com 502 controlado.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type {
  CreatePixChargeInput,
  CreatePixChargeResult,
  PixProvider,
  PixProviderEnv,
  ProviderChargeSnapshot,
} from "./types.ts";
import { PixProviderUnavailableError } from "./types.ts";

export class BradescoProvider implements PixProvider {
  readonly name = "bradesco" as const;
  readonly env: PixProviderEnv = "production";

  constructor(_admin: SupabaseClient) {
    throw new PixProviderUnavailableError(
      "Provedor Bradesco ainda não implementado (stub da abstração).",
    );
  }

  createCharge(_input: CreatePixChargeInput): Promise<CreatePixChargeResult> {
    return Promise.reject(
      new PixProviderUnavailableError("Provedor Bradesco ainda não implementado."),
    );
  }

  getChargeStatus(_providerChargeId: string): Promise<ProviderChargeSnapshot> {
    return Promise.reject(
      new PixProviderUnavailableError("Provedor Bradesco ainda não implementado."),
    );
  }

  cancelCharge(_providerChargeId: string): Promise<void> {
    return Promise.reject(
      new PixProviderUnavailableError("Provedor Bradesco ainda não implementado."),
    );
  }
}
