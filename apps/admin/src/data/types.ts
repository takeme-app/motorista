export type TripStatus = 'active' | 'cancelled' | 'completed';
export type BookingStatus = 'pending' | 'confirmed' | 'paid' | 'cancelled';
export type ShipmentStatus = 'pending_review' | 'confirmed' | 'in_progress' | 'delivered' | 'cancelled';
export type ExcursionStatus = 'pending' | 'contacted' | 'quoted' | 'cancelled' | 'in_analysis' | 'approved' | 'scheduled' | 'in_progress' | 'completed';

export interface ProfileRow {
  id: string;
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  cpf: string | null;
  city: string | null;
  state: string | null;
  rating: number | null;
  verified: boolean;
  created_at: string;
}

export interface ScheduledTripRow {
  id: string;
  driver_id: string;
  origin_address: string;
  destination_address: string;
  departure_at: string;
  arrival_at: string;
  seats_available: number;
  bags_available: number;
  badge: string | null;
  amount_cents: number | null;
  status: TripStatus;
  created_at: string;
}

export interface BookingRow {
  id: string;
  user_id: string;
  scheduled_trip_id: string;
  origin_address: string;
  destination_address: string;
  passenger_count: number;
  bags_count: number;
  passenger_data: Array<{ name?: string; cpf?: string; bags?: number }>;
  amount_cents: number;
  status: BookingStatus;
  created_at: string;
}

export interface ShipmentRow {
  id: string;
  user_id: string;
  origin_address: string;
  destination_address: string;
  package_size: 'pequeno' | 'medio' | 'grande';
  recipient_name: string;
  status: ShipmentStatus;
  amount_cents: number;
  created_at: string;
}

export interface DependentShipmentRow {
  id: string;
  user_id: string;
  full_name: string;
  origin_address: string;
  destination_address: string;
  status: ShipmentStatus;
  amount_cents: number;
  created_at: string;
}

export interface ExcursionRequestRow {
  id: string;
  user_id: string;
  destination: string;
  excursion_date: string;
  people_count: number;
  fleet_type: string;
  status: ExcursionStatus;
  total_amount_cents: number | null;
  driver_id: string | null;
  preparer_id: string | null;
  created_at: string;
}

/** Método de pagamento da reserva (`bookings.payment_method`: cartão / Pix / dinheiro). */
export type BookingPaymentMethod = 'card' | 'pix' | 'cash';

export interface ViagemListItem {
  bookingId: string;
  passageiro: string;
  origem: string;
  destino: string;
  data: string;
  embarque: string;
  chegada: string;
  status: 'concluído' | 'cancelado' | 'agendado' | 'em_andamento';
  tripId: string;
  driverId: string;
  /** ISO 8601 — filtro por data / período */
  departureAtIso: string;
  /** Nome do motorista (profiles) */
  motoristaNome: string;
  /** take_me = frota; motorista = parceiro (worker_profiles.subtype === partner) */
  motoristaCategoria: 'take_me' | 'motorista';
  /** Status bruto em `bookings.status` (ações admin) */
  bookingDbStatus: string;
  passengerCount: number;
  amountCents: number;
  /** De `scheduled_trips.trunk_occupancy_pct`; 0 se ausente */
  trunkOccupancyPct: number;
  /** `bookings.payment_method` quando a coluna existir; senão `card`. */
  paymentMethod: BookingPaymentMethod;
  /** Abate extra na corrida Connect (`bookings.platform_fee_extra_debit_cents`). */
  platformFeeExtraDebitCents: number;
  /** Preenchido em algumas listagens quando o perfil do cliente expõe foto. */
  passageiroAvatarUrl?: string | null;
}

/** Item retornado pela Edge `lookup-spedy-invoice` (NF-e ou NFS-e na Spedy). */
export type SpedyInvoiceLookupItem = {
  id: string;
  status: string;
  model: 'productInvoice' | 'serviceInvoice';
};

/** Detalhe admin de uma reserva (viagem) — origem/destino completos e metadados. */
export interface BookingDetailForAdmin {
  listItem: ViagemListItem;
  originFull: string;
  destinationFull: string;
  /** Coordenadas salvas na reserva (`bookings`), quando existirem. */
  originLat: number | null;
  originLng: number | null;
  destinationLat: number | null;
  destinationLng: number | null;
  amountCents: number;
  passengerCount: number;
  bagsCount: number;
  passengerData: Array<{ name?: string; cpf?: string; bags?: number }>;
  userId: string;
  /** `profiles.avatar_url` do cliente da reserva (`user_id`). */
  clientAvatarUrl: string | null;
  /** `avatar_url` por CPF só dígitos — passageiros extras em `passenger_data` com CPF cadastrado. */
  avatarUrlByPassengerCpfDigits: Record<string, string | null>;
  clientPhone: string | null;
  trunkOccupancyPct: number;
  /** `scheduled_trips.departure_at` em ISO (duração no resumo). */
  tripDepartureAtIso: string | null;
  /** `scheduled_trips.arrival_at` em ISO (duração no resumo). */
  tripArrivalAtIso: string | null;
  /** Lugares disponíveis na viagem agendada (`scheduled_trips.seats_available`). */
  seatsAvailable: number | null;
  /** Bagagens disponíveis na viagem (`scheduled_trips.bags_available`). */
  bagsAvailable: number | null;
  /** `bookings.created_at` em ISO (histórico mínimo no painel). */
  bookingCreatedAtIso: string | null;
  /** Conversa de atendimento ativa (`support_backoffice`) ligada a esta reserva, se existir. */
  supportConversationId: string | null;
  /** `bookings.pickup_code` — PIN de embarque passageiro → motorista (viagem comum). */
  pickupCode: string | null;
  /** `bookings.stripe_payment_intent_id` — usado para localizar NF na Spedy (integração Stripe). */
  stripePaymentIntentId: string | null;
  /** `bookings.payment_method`. */
  paymentMethod: BookingPaymentMethod;
  /** Abate de dívida de taxa nesta corrida Connect. */
  platformFeeExtraDebitCents: number;
  /** Taxa admin da viagem (snapshot em `bookings.admin_earning_cents`). */
  adminEarningCents: number;
}

/** Linha de `driver_platform_fee_ledger` (taxa plataforma em dinheiro / abates). */
export interface DriverPlatformFeeLedgerRow {
  id: string;
  workerId: string;
  bookingId: string | null;
  kind: 'credit' | 'debit';
  amountCents: number;
  note: string;
  createdAt: string;
}

/** Motorista com saldo devido à plataforma (`worker_profiles.platform_fee_owed_cents > 0`). */
export interface MotoristaPlatformFeeDebtItem {
  id: string;
  nome: string;
  platformFeeOwedCents: number;
}

/** Estado Stripe Connect exibido no painel do motorista. */
export type WorkerConnectStatus = {
  accountId: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  notifiedApprovedAt: string | null;
};

/** Shipment ligado à viagem (`scheduled_trip_id`) — lista no detalhe da viagem. */
export interface TripShipmentListItem {
  id: string;
  packageSize: string | null;
  amountCents: number;
  recipientName: string;
  /** `shipments.recipient_phone` */
  recipientPhone: string | null;
  /** Remetente: `profiles.full_name` do `shipments.user_id`. */
  senderName: string;
  originAddress: string;
  destinationAddress: string;
  originLat: number | null;
  originLng: number | null;
  destinationLat: number | null;
  destinationLng: number | null;
  instructions: string | null;
  photoUrl: string | null;
  status: string;
  /** Conversa de atendimento ativa ligada a este envio, se existir. */
  supportConversationId: string | null;
  /** `shipments.base_id` — se preenchido, fluxo com base (PINs A–D). */
  baseId: string | null;
  pickupCode: string | null;
  passengerToPreparerCode: string | null;
  preparerToBaseCode: string | null;
  baseToDriverCode: string | null;
  deliveryCode: string | null;
  pickedUpByPreparerAt: string | null;
  deliveredToBaseAt: string | null;
  pickedUpByDriverFromBaseAt: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
}

/** Encomenda para ecrã de edição admin (shipment ou envio de dependente). */
export type EncomendaEditDetail =
  | {
      kind: 'shipment';
      id: string;
      originAddress: string;
      destinationAddress: string;
      originLat: number | null;
      originLng: number | null;
      destinationLat: number | null;
      destinationLng: number | null;
      /** Viagem agendada à qual o envio está associado (mapa / roteiro). */
      scheduledTripId: string | null;
      /** Motorista atual da viagem agendada (`scheduled_trips.driver_id`). */
      tripDriverId: string | null;
      tripDepartureAt: string | null;
      tripArrivalAt: string | null;
      senderName: string;
      photoUrl: string | null;
      recipientName: string;
      recipientPhone: string;
      recipientEmail: string;
      packageSize: string;
      amountCents: number;
      status: string;
      instructions: string | null;
      whenOption: string;
      createdAt: string;
      scheduledAt: string | null;
    }
  | {
      kind: 'dependent_shipment';
      id: string;
      originAddress: string;
      destinationAddress: string;
      originLat: number | null;
      originLng: number | null;
      destinationLat: number | null;
      destinationLng: number | null;
      fullName: string;
      contactPhone: string;
      receiverName: string | null;
      amountCents: number;
      status: string;
      instructions: string | null;
      whenOption: string;
      createdAt: string;
      bagsCount: number;
      scheduledAt: string | null;
    };

export interface PassageiroListItem {
  id: string;
  nome: string;
  cidade: string;
  estado: string;
  dataCriacao: string;
  /** ISO 8601 — filtros de período no admin */
  createdAtIso: string;
  cpf: string;
  status: 'Ativo' | 'Inativo';
  avatarUrl: string | null;
}

export interface EncomendaListItem {
  id: string;
  tipo: 'shipment' | 'dependent_shipment';
  destino: string;
  origem: string;
  remetente: string;
  data: string;
  status: 'Cancelado' | 'Concluído' | 'Agendado' | 'Em andamento';
  amountCents: number;
  packageSize?: string;
  /** ISO 8601 — filtros no Início */
  createdAtIso: string;
  /** Horários da viagem agendada vinculada (lista admin Figma 849-37274), ou "—" */
  embarque: string;
  chegada: string;
  /** Status bruto no banco (ex.: pending_review) */
  rawStatus: string;
  /** Viagem agendada vinculada (`shipments.scheduled_trip_id`) — detalhe em `/viagens/:id` */
  scheduledTripId: string | null;
  /** Conversa de atendimento ativa vinculada (para encomendas pending_review) */
  supportConversationId: string | null;
  /** Estado de payout / cobrança na UI (lista admin). */
  paymentStatus?: 'paid' | 'pending' | 'held' | null;
}

export interface MotoristaListItem {
  id: string;
  nome: string;
  totalViagens: number;
  viagensAtivas: number;
  viagensAgendadas: number;
  avatarUrl: string | null;
  rating: number | null;
}

export type WorkerApprovalStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

/** Row for the motorista approval/registration management view. */
export interface WorkerApprovalRow {
  id: string;
  nome: string;
  phone: string | null;
  avatarUrl: string | null;
  rating: number | null;
  subtype: 'take_me' | 'parceiro';
  approvalStatus: WorkerApprovalStatus;
  rejectionReason: string | null;
  createdAt: string;
  reviewedAt: string | null;
  connect?: {
    accountId: string | null;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
  } | null;
}

/** Contagens por bucket de UI (derivadas de `scheduled_trips.status` por viagem da rota). */
export type DestinoTripStatusCounts = {
  em_andamento: number;
  agendadas: number;
  concluidas: number;
  canceladas: number;
};

export interface DestinoListItem {
  origem: string;
  destino: string;
  totalAtividades: number;
  primeiraData: string;
  /** `YYYY-MM-DD` da primeira `created_at` da rota (filtros de data). */
  primeiraDataIso: string;
  ativo: boolean;
  tripStatusCounts: DestinoTripStatusCounts;
  takeMeCount: number;
  partnerCount: number;
  hasPastDeparture: boolean;
  hasFutureDeparture: boolean;
  /** Linha vem só de `takeme_routes` (sem viagens agregadas com esta chave shortAddr). */
  sourceTakemeOnly?: boolean;
}

export interface PreparadorListItem {
  id: string;
  nome: string;
  origem: string;
  destino: string;
  dataInicio: string;
  rawDate: string; // ISO YYYY-MM-DD for date filtering
  previsao: string;
  avaliacao: number | null;
  status: 'Em andamento' | 'Agendado' | 'Cancelado' | 'Concluído';
}

/** Detalhe completo para a tela Editar preparador (admin). */
export interface PreparadorEditPassenger {
  id: string;
  fullName: string;
  cpf: string | null;
  phone: string | null;
  observations: string | null;
  /** Boarding/departure status from excursion_passengers.status_departure */
  statusDeparture: 'not_started' | 'embarked' | 'absent' | null;
  /** Return status from excursion_passengers.status_return */
  statusReturn: string | null;
  /** Whether absence was justified */
  absenceJustified: boolean;
  /** Age from excursion_passengers.age */
  age: number | null;
}

export interface PreparadorEditDetail {
  id: string;
  userId: string;
  destination: string;
  excursionDate: string;
  scheduledDepartureAt: string | null;
  scheduledReturnAt: string | null;
  peopleCount: number;
  fleetType: string;
  observations: string | null;
  statusRaw: string;
  statusLabel: PreparadorListItem['status'];
  totalAmountCents: number | null;
  preparerId: string | null;
  vehicleDetails: Record<string, unknown> | null;
  budgetLines: unknown[];
  assignmentNotes: Record<string, unknown>;
  clientNome: string | null;
  clientCity: string | null;
  clientState: string | null;
  clientCpf: string | null;
  clientPhone: string | null;
  passengers: PreparadorEditPassenger[];
  preparerProfile: {
    fullName: string | null;
    phone: string | null;
    cpf: string | null;
    city: string | null;
    state: string | null;
    avatarUrl: string | null;
    rating: number | null;
  } | null;
  preparerWorker: {
    cpf: string | null;
    age: number | null;
    experienceYears: number | null;
    bankCode: string | null;
    bankAgency: string | null;
    bankAccount: string | null;
    pixKey: string | null;
    subtype: string | null;
  } | null;
  vehicles: Array<{
    id: string;
    year: number | null;
    model: string | null;
    plate: string | null;
    passengerCapacity: number | null;
  }>;
  driverId?: string | null;
  stripePaymentIntentId?: string | null;
  preparerPayoutCents?: number | null;
  driverPayoutCents?: number | null;
  workerPayoutCents?: number | null;
  platformFeeCents?: number | null;
}

/** Estado local na aba encomendas/excursoes do PreparadorEditScreen (hidratação manual). */
export interface PreparadorEncomendaDetail {
  id: string;
  kind: string;
  originAddress: string;
  destinationAddress: string;
  status: string;
  statusLabel: string;
  amountCents: number;
  packageSize: string | null;
  photoUrl: string | null;
  recipientName: string | null;
  recipientPhone: string | null;
  recipientEmail: string | null;
  senderName: string | null;
  instructions: string | null;
  createdAt: string;
  preparerProfile: {
    id: string;
    fullName: string | null;
    phone: string | null;
    avatarUrl: string | null;
    status: string | null;
    subtype: string | null;
  };
  _workerData?: Record<string, unknown>;
  _profileData?: Record<string, unknown>;
  _vehicles?: unknown[];
  _shipments?: unknown[];
  _ratings?: unknown[];
  _excursions?: unknown[];
}

export interface PreparadorCandidate {
  id: string;
  nome: string;
  rating: number | null;
  avatarUrl: string | null;
  subtype: string;
  badge: 'takeme' | 'parceiro';
  valorKm: string;
  valorFixo: string;
}

export interface ExcursionStatusHistoryRow {
  status: string;
  changedAt: string;
}

// ── Promotions ──────────────────────────────────────────────────────
export interface PromotionRow {
  id: string;
  title: string;
  description: string | null;
  start_at: string;
  end_at: string;
  target_audiences: string[];
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
  applies_to: string[];
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PromocaoListItem {
  id: string;
  nome: string;
  descricao: string;
  dataInicio: string;
  dataTermino: string;
  /** ISO timestamps para filtros de período no admin */
  startAtIso: string;
  endAtIso: string;
  tipoPublico: string;
  tipoDesconto: string;
  valorDesconto: number;
  aplicaA: string;
  status: 'Ativo' | 'Inativo';
  /** Raw para reuso em ações (ex.: duplicar) sem perder os códigos técnicos. */
  rawTargetAudiences: string[];
  rawAppliesTo: string[];
  rawDiscountType: 'percentage' | 'fixed';
  rawDiscountPctToPassenger: number;
  rawGainPctToWorker: number;
  rawWorkerRouteId: string | null;
  rawPricingRouteId: string | null;
  rawOriginCity: string | null;
}

// ── Pagamentos / Payouts ────────────────────────────────────────────
export type PayoutStatus = 'pending' | 'processing' | 'paid' | 'failed';

export interface PayoutRow {
  id: string;
  worker_id: string;
  entity_type: 'booking' | 'shipment' | 'dependent_shipment' | 'excursion';
  entity_id: string;
  gross_amount_cents: number;
  worker_amount_cents: number;
  admin_amount_cents: number;
  surcharges_cents: number;
  promotion_discount_cents: number;
  payout_method: 'pix' | 'fixed_monthly' | 'fixed_weekly';
  status: PayoutStatus;
  paid_at: string | null;
  created_at: string;
}

export interface PagamentoListItem {
  id: string;
  workerId: string;
  /** Mesma ideia que MotoristasScreen «Connect OK»: conta + charges + payouts. */
  workerHasConnect: boolean;
  workerName: string;
  entityType: string;
  /** Valor bruto de `payouts.entity_type` (ex.: booking, shipment). */
  entityTypeRaw: string;
  /** Valor bruto de `payouts.status` (ex.: pending, paid). */
  statusRaw: string;
  /** Transfer Stripe explícita (shipment/excursion); booking costuma ficar null. */
  stripeTransferId: string | null;
  stripeTransferAt: string | null;
  stripeTransferError: string | null;
  dataFinalizacao: string;
  /** ISO (paid_at ou created_at) para filtros de período no admin */
  dateAtIso: string;
  status: 'Em andamento' | 'Agendado' | 'Cancelado' | 'Concluído';
  grossAmountCents: number;
  workerAmountCents: number;
  adminAmountCents: number;
}

export interface PagamentoCounts {
  pagamentosPrevistos: number;
  pagamentosFeitos: number;
  lucro: number;
}

// ── Pricing Routes ──────────────────────────────────────────────────
export interface PricingRouteRow {
  id: string;
  role_type: 'driver' | 'preparer_excursions' | 'preparer_shipments';
  title: string | null;
  origin_address: string | null;
  destination_address: string;
  pricing_mode: 'daily_rate' | 'per_km' | 'fixed';
  price_cents: number;
  driver_pct: number;
  admin_pct: number;
  accepted_payment_methods: string[];
  is_active: boolean;
  created_at: string;
}

export type SurchargeType =
  | 'viagem'
  | 'encomenda'
  | 'preparador_encomendas'
  | 'preparador_excursoes';

export interface SurchargeCatalogRow {
  id: string;
  name: string;
  description: string | null;
  default_value_cents: number;
  surcharge_mode: 'automatic' | 'manual';
  surcharge_type: SurchargeType;
  is_active: boolean;
}

export interface PricingRouteSurchargeRow {
  id: string;
  pricing_route_id: string;
  surcharge_id: string;
  value_cents: number | null;
  created_at: string;
}

// ── Payment Methods (admin pode inserir via insertPassengerPaymentMethodAdmin + RLS) ──
export interface PaymentMethodRow {
  id: string;
  user_id: string;
  type: 'credit' | 'debit';
  last_four: string | null;
  brand: string | null;
  holder_name: string | null;
  created_at: string;
}

// ── Admin Users ─────────────────────────────────────────────────────
export interface AdminUserListItem {
  id: string;
  nome: string;
  email: string;
  nivel: string;
  dataCriacao: string;
  status: 'Ativo' | 'Inativo';
  permissions: Record<string, boolean>;
  /** worker_profiles.subtype para staff (admin | suporte | financeiro) */
  subtype?: string;
}
