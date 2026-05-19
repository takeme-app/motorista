/**
 * Regras compartilhadas entre corrida comum e envio de dependente:
 * — máximo de malas: a capacidade restante do bagageiro da viagem (`bags_available`).
 *   Sem cap por passageiro: o cliente pode levar quantas malas quiser desde que caibam.
 *   Sem info de capacidade da viagem, cai num fallback de 1 mala por passageiro.
 * — contagens de passageiros diferem entre corrida titular (`bookingTotalPassengers`) e envio de dependente (`dependentShipmentTotalPassengers`: só embarcados).
 */

/** Corrida normal: titular + passageiros extras informados na confirmação. */
export function bookingTotalPassengers(extraPassengers: number): number {
  return 1 + Math.max(0, Math.floor(extraPassengers));
}

/**
 * Envio de dependente: só conta quem **embarca** na corrida — o dependente e,
 * opcionalmente, outras pessoas na mesma viagem **com ele**. Quem solicita o envio não viaja e não ocupa lugar.
 */
export function dependentShipmentTotalPassengers(extraCompanionsOnTrip: number): number {
  return 1 + Math.max(0, Math.floor(extraCompanionsOnTrip));
}

/** Limite default de malas quando o motorista não preencheu `bags_available` ao criar a viagem.
 * Mantemos generoso porque o filtro real é o bagageiro físico do veículo — o motorista valida no embarque. */
const FALLBACK_BAG_LIMIT = 10;

/**
 * Teto de malas: a capacidade restante do bagageiro da viagem (`scheduled_trips.bags_available`).
 * Sem cap por passageiro — o cliente pode levar quantas malas quiser desde que caibam no bagageiro.
 * Quando a viagem não tem `bags_available` setado (motoristas costumam deixar 0), usamos um teto
 * generoso (10); o limite real é confirmado pelo motorista no embarque.
 */
export function maxBagsForTrip(totalPassengers: number, tripBagLimit: number | null | undefined): number {
  const raw = tripBagLimit == null ? null : Math.floor(Number(tripBagLimit));
  if (raw != null && Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  return Math.max(FALLBACK_BAG_LIMIT, Math.floor(totalPassengers));
}
