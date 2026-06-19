/**
 * Registro efêmero p/ o Pix paliativo. A `PixPaliativoScreen` é genérica e recebe
 * apenas um `requestId` (serializável) na navegação; a lógica específica de cada
 * fluxo (criar a reserva/encomenda/excursão e navegar para a tela de sucesso) fica
 * no caller, registrada aqui. Efêmero: se o app recarregar, perde-se (aceitável p/
 * fluxo paliativo).
 */
export type PalliativePixRequest = {
  /** Valor exibido na tela (centavos). */
  amountCents: number;
  /** Efetiva o pedido (cria reserva/encomenda/etc.). Chamado uma única vez aos 40s. */
  effectivate: () => Promise<void>;
  /** Navega para a tela de sucesso do fluxo. Chamado ao tocar "Realizei o Pagamento". */
  navigateSuccess: () => void;
};

const store = new Map<string, PalliativePixRequest>();

export function registerPalliativePix(req: PalliativePixRequest): string {
  const id = `pix_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  store.set(id, req);
  return id;
}

export function getPalliativePix(id: string): PalliativePixRequest | undefined {
  return store.get(id);
}

export function clearPalliativePix(id: string): void {
  store.delete(id);
}
