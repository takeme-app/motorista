/** Texto para “passageiros totais” = quantidade cadastrada na lista de embarque. */
export function passengerTotalLabel(count: number): string {
  if (count <= 0) return 'Nenhum passageiro';
  if (count === 1) return '1 passageiro';
  return `${count} passageiros`;
}
