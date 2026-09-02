import type { NavigatorScreenParams } from '@react-navigation/native';
import type { MainTabParamList } from './MainTabs';

export type RootStackParamList = {
  Splash: undefined;
  Welcome: undefined;
  Login: undefined;
  SignUp: undefined;
  VerifyEmail: {
    email: string;
    password: string;
    fullName: string;
    phone: string;
    /** Cadastro por WhatsApp (OTP) vs e-mail. */
    channel?: 'email' | 'phone';
    /** Dados opcionais coletados no cadastro, persistidos no perfil após verificação. */
    cpf?: string;
    city?: string;
    state?: string;
  };
  AddPaymentPrompt: undefined;
  AddPaymentMethod: undefined;
  AddCard: { paymentType: 'credit' | 'debit' };
  CardRegisteredSuccess: undefined;
  Main: NavigatorScreenParams<MainTabParamList> | undefined;
  ForgotPassword: undefined;
  ForgotPasswordEmailSent: { email: string };
  /** Verificação do código de redefinição de senha por e-mail OU telefone (BR, só dígitos). */
  ForgotPasswordVerifyCode: { email?: string; phone?: string };
  ResetPassword: { passwordResetToken?: string } | undefined;
  ResetPasswordSuccess: undefined;
  TermsOfUse: undefined;
  PrivacyPolicy: undefined;
  // Fluxo de viagens (stack dedicado); aceita tela inicial ao abrir a partir do bottom sheet
  TripStack: NavigatorScreenParams<TripStackParamList>;
  // Fluxo de envios (guia Serviços)
  ShipmentStack: NavigatorScreenParams<ShipmentStackParamList>;
  // Fluxo de envio de dependentes (Serviços / Início)
  DependentShipmentStack: NavigatorScreenParams<DependentShipmentStackParamList>;
  // Fluxo de excursões (Serviços / Início)
  ExcursionStack: NavigatorScreenParams<ExcursionStackParamList>;
};

export type ExcursionStackParamList = {
  ExcursionRequestForm: undefined;
  ExcursionSuccess: { requestId?: string };
};

/** Origem ou destino de um envio */
export type ShipmentPlaceParam = {
  address: string;
  latitude: number;
  longitude: number;
  city?: string;
};

/** Destinatário do envio */
export type ShipmentRecipientParam = {
  name: string;
  email: string;
  phone: string;
  instructions?: string;
  photoUri?: string;
  photoUris?: string[];
};

export type ShipmentStackParamList = {
  PixPaliativo: { requestId: string };
  /** Pix real da encomenda — a tela é a mesma da viagem, registrada nas duas stacks. */
  PixPayment: PixPaymentScreenParams;
  SelectShipmentAddress: undefined;
  SelectShipmentDriver: {
    origin: ShipmentPlaceParam;
    destination: ShipmentPlaceParam;
    whenOption: 'now' | 'later';
    whenLabel?: string;
    /** YYYY-MM-DD no fuso local; usado para filtrar viagens dos motoristas (alinhado ao fluxo de passageiro). */
    scheduledDateId?: string;
    /** Janela horária opcional quando o UI passar a enviar (ex.: slot string). */
    scheduledTimeSlot?: string;
    packageSize: 'pequeno' | 'medio' | 'grande';
    packageSizeLabel: string;
  };
  Recipient: {
    origin: ShipmentPlaceParam;
    destination: ShipmentPlaceParam;
    whenOption: 'now' | 'later';
    whenLabel?: string;
    scheduledDateId?: string;
    scheduledTimeSlot?: string;
    packageSize: 'pequeno' | 'medio' | 'grande';
    packageSizeLabel: string;
    /** FK do trecho do catálogo (ou null quando veio de override do preparador). */
    pricingRouteId?: string | null;
    priceRouteBaseCents?: number;
    pricingSubtotalCents?: number;
    platformFeeCents?: number;
    amountCents?: number;
    adminPctApplied?: number;
    /** Perna Origem→Base (repasse do preparador); 0 quando não há base. */
    preparerPayoutCents?: number;
    clientPreferredDriverId?: string;
    resolvedBaseId?: string | null;
    scheduledTripDepartureAt?: string | null;
    scheduledTripId?: string;
  };
  ConfirmShipment: {
    origin: ShipmentPlaceParam;
    destination: ShipmentPlaceParam;
    whenOption: 'now' | 'later';
    whenLabel?: string;
    scheduledDateId?: string;
    scheduledTimeSlot?: string;
    packageSize: 'pequeno' | 'medio' | 'grande';
    packageSizeLabel: string;
    recipient: ShipmentRecipientParam;
    /** Valor total final (já com taxa administrativa quando vier do backend). */
    amountCents: number;
    /** Subtotal (pre gross-up) vindo do quote. */
    pricingSubtotalCents: number;
    /** Taxa administrativa no gross-up. */
    platformFeeCents: number;
    /** Base da rota (após multiplicador de tamanho). */
    priceRouteBaseCents: number;
    /** FK do trecho do catálogo quando aplicável. */
    pricingRouteId: string | null;
    /** % admin aplicada (snapshot). */
    adminPctApplied: number;
    /** Perna Origem→Base (repasse do preparador); 0 quando não há base. */
    preparerPayoutCents?: number;
    /** Motorista/preparador escolhido pelo cliente (opcional). */
    clientPreferredDriverId?: string;
    /** Base operacional resolvida pelo hub (ou `null` quando não existe). */
    resolvedBaseId?: string | null;
    /** ISO da partida da viagem associada, quando coleta for on-demand. */
    scheduledTripDepartureAt?: string | null;
    /** ID do `scheduled_trips` quando o envio for acoplado a uma viagem. */
    scheduledTripId?: string;
    /** Compat: campos antigos ainda aceitos até migração completa. */
    subtotalCents?: number;
    feeCents?: number;
    orderId?: string;
    shipmentId?: string;
  };
  ShipmentSuccess: {
    orderId: string;
    shipmentId?: string;
    isLargePackage: boolean;
    paymentProcessed: boolean;
  };
};

/** Params do formulário de envio de dependente (nome, contato, bagagens, instruções) */
export type DependentShipmentFormParams = {
  fullName: string;
  contactPhone: string;
  bagsCount: number;
  /** Outras pessoas que embarcam na mesma corrida **com** o dependente (quem solicita não viaja). */
  extraPassengers?: number;
  instructions?: string;
  dependentId?: string;
  photoUri?: string;
  photoUris?: string[];
};

export type DependentShipmentStackParamList = {
  PixPaliativo: { requestId: string };
  DependentShipmentForm: undefined;
  AddDependent: undefined;
  DependentSuccess: undefined;
  DefineDependentTrip: DependentShipmentFormParams;
  SelectDependentTripDriver: {
    origin: ShipmentPlaceParam;
    destination: ShipmentPlaceParam;
    whenOption: 'now' | 'later';
    whenLabel?: string;
    scheduledDateId?: string;
    scheduledTimeSlot?: string;
    fullName: string;
    contactPhone: string;
    bagsCount: number;
    extraPassengers?: number;
    instructions?: string;
    dependentId?: string;
    photoUri?: string;
    photoUris?: string[];
  };
  ConfirmDependentShipment: {
    origin: ShipmentPlaceParam;
    destination: ShipmentPlaceParam;
    whenOption: 'now' | 'later';
    whenLabel?: string;
    fullName: string;
    contactPhone: string;
    bagsCount: number;
    extraPassengers?: number;
    instructions?: string;
    dependentId?: string;
    amountCents: number;
    photoUri?: string;
    photoUris?: string[];
    driver?: TripDriverParam;
    scheduledTripDepartureAt?: string | null;
  };
  DependentShipmentSuccess: {
    orderId: string;
    shipmentId?: string;
  };
};

/** Dados do motorista/viagem selecionada (Procurando viagem → Confirmação → Checkout) */
export type TripDriverParam = {
  /** ID da linha em `scheduled_trips` (histórico: também estava em `id`) */
  id: string;
  driver_id: string;
  name: string;
  rating: number;
  badge: string;
  departure: string;
  arrival: string;
  seats: number;
  bags: number;
  /** Valor em centavos (ex.: 6400 = R$ 64,00) */
  amount_cents?: number;
  vehicle_model?: string | null;
  vehicle_year?: number | null;
  vehicle_plate?: string | null;
  avatar_url?: string | null;
};

/** Ponto de partida ou destino para exibir no mapa (Checkout) */
export type TripPlaceParam = {
  address: string;
  latitude: number;
  longitude: number;
};

/** Passageiro para exibir no Checkout (vem de ConfirmDetails) */
export type TripPassengerParam = { name: string; cpf: string; bags: string };

/** Dados da reserva para exibir em PaymentConfirmed */
export type PaymentConfirmedBookingParam = {
  booking_id: string;
  origin_address: string;
  destination_address: string;
  departure: string;
  arrival: string;
  amount_cents: number;
  driver_name: string;
};

/** Dados exibidos no acompanhamento da viagem após o pagamento */
export type TripLiveDriverDisplay = {
  scheduledTripId?: string;
  origin?: { latitude: number; longitude: number; address: string };
  destination?: { latitude: number; longitude: number; address: string };
  driverName: string;
  rating: number;
  vehicleLabel: string;
  amountCents: number;
  bookingId?: string;
};

/**
 * Draft serializável da reserva enviado ao `create-pix-charge` (Pix real).
 * Mesma forma do `draft_booking` do charge-booking — o servidor recalcula o
 * preço e insere o booking `pending` (a vaga é segurada pelo trigger).
 */
export type PixBookingDraftParam = {
  scheduled_trip_id: string;
  origin_address: string;
  origin_lat: number;
  origin_lng: number;
  destination_address: string;
  destination_lat: number;
  destination_lng: number;
  passenger_count: number;
  bags_count: number;
  passenger_data: { name: string; cpf: string; bags: string }[];
  promotion_id?: string;
};

/**
 * Dados serializáveis para montar a tela de sucesso (PaymentConfirmed) quando o
 * Pix real for pago — nada de callbacks/Map em memória: sobrevive a cold start.
 */
export type TripPixSuccessNavParam = {
  originAddress: string;
  destinationAddress: string;
  departure: string;
  arrival: string;
  driverName: string;
  driverRating: number;
  vehicleLabel: string;
  scheduledTripId?: string;
  immediateTrip?: boolean;
  origin?: { latitude: number; longitude: number; address: string };
  destination?: { latitude: number; longitude: number; address: string };
};

/**
 * Cobrança Pix pendente persistida em AsyncStorage (1 por vez) para retomada
 * após cold start/foreground (usePendingPixChargeResume). 100% serializável.
 */
export type PendingPixChargeParam = {
  /** Dono da cobrança — guard anti-vazamento entre contas no mesmo device. */
  userId: string;
  service: 'booking';
  pixChargeId: string;
  /** Id do pedido criado pelo servidor (booking, na fase viagem). */
  entityId: string;
  /** Valor recalculado NO SERVIDOR (o que aparece na tela e no sucesso). */
  amountCents: number;
  qrPayload: string;
  qrImageBase64: string | null;
  expiresAt: string;
  createdAt: string;
  successNav: TripPixSuccessNavParam;
};

/** Params da PixPaymentScreen: criação (draft) OU retomada de cobrança pendente. */
export type PixPaymentScreenParams =
  | {
      service: 'booking';
      draft: PixBookingDraftParam;
      /** CPF (11 dígitos) coletado no checkout quando o perfil não tem um válido. */
      cpf?: string;
      /** Valor estimado no app — exibido só enquanto o servidor não responde. */
      estimatedAmountCents: number;
      successNav: TripPixSuccessNavParam;
      shipmentSuccess?: undefined;
      resume?: undefined;
    }
  | {
      // Encomenda: o payload de insert vai inteiro para o servidor, que cria a
      // encomenda já ancorada na cobrança (o app não insere, diferente do
      // paliativo). successNav não se aplica — a tela de sucesso é outra.
      service: 'shipment';
      shipmentDraft: Record<string, unknown>;
      cpf?: string;
      estimatedAmountCents: number;
      shipmentSuccess: { isLargePackage: boolean };
      successNav?: undefined;
      draft?: undefined;
      resume?: undefined;
    }
  | { resume: true; stored: PendingPixChargeParam };

export type TripStackParamList = {
  PixPaliativo: { requestId: string };
  PixPayment: PixPaymentScreenParams;
  WhenNeeded: undefined;
  PlanTrip: undefined;
  PlanRide: { origin?: TripPlaceParam; destination?: TripPlaceParam; scheduledDateId?: string; scheduledTimeSlot?: string };
  ChooseTime: undefined;
  SearchTrip: { destination?: { address: string; city?: string; latitude?: number; longitude?: number }; immediateTrip?: boolean };
  ConfirmDetails: { driver?: TripDriverParam; origin?: TripPlaceParam; destination?: TripPlaceParam; scheduled_trip_id?: string; immediateTrip?: boolean };
  Checkout: {
    driver?: TripDriverParam;
    origin?: TripPlaceParam;
    destination?: TripPlaceParam;
    scheduled_trip_id?: string;
    scheduledTripDepartureAt?: string | null;
    passengers?: TripPassengerParam[];
    bags_count?: number;
    immediateTrip?: boolean;
  };
  PaymentConfirmed: {
    booking?: PaymentConfirmedBookingParam;
    immediateTrip?: boolean;
    tripLive?: TripLiveDriverDisplay;
    paymentMethod?: string | null;
  };
  DriverOnTheWay: TripLiveDriverDisplay | undefined;
  TripInProgress: TripLiveDriverDisplay | undefined;
  RateTrip: { bookingId?: string };
};
