import type { NavigatorScreenParams } from '@react-navigation/native';

export type DriverType = 'take_me' | 'parceiro';

/** Chat na aba Excursões (preparador): mesmas telas do motorista, rotas próprias no stack. */
export type ChatExcStackParamList = {
  ChatExcList: { hideBack?: boolean; chatScreenName?: string } | undefined;
  ChatExcThread: { conversationId: string; participantName?: string; participantAvatar?: string };
};

/** Chat na aba Encomendas (preparador): lista + thread (conversations/messages). */
export type ChatEncomendasStackParamList = {
  ChatEncList: { hideBack?: boolean; chatScreenName?: string } | undefined;
  ChatEncThread: { conversationId: string; participantName?: string; participantAvatar?: string };
};

/** Aba Pagamentos — preparador de encomendas (resumo + histórico mensal). */
export type PagamentosEncStackParamList = {
  PagamentosMain: undefined;
  PagamentosHistorico: undefined;
};

export type ProfileStackParamList = {
  /** Grid Configurações (aba Perfil). */
  Settings: undefined;
  /** Resumo + sair (card Perfil). */
  ProfileOverview: undefined;
  PersonalInfo: undefined;
  WorkerRoutes: { fromHome?: boolean } | undefined;
  WorkerVehicles: { successMessage?: string } | undefined;
  VehicleDetail: { vehicleId: string };
  VehicleForm: { vehicleId?: string };
  Notifications: undefined;
  Conversations: undefined;
  Chat: { conversationId: string; participantName?: string; participantAvatar?: string };
  TripSchedule: { fromHome?: boolean } | undefined;
  /** Cronograma do preparador de excursões (aba Perfil). */
  ExcursionSchedule: undefined;
  RouteSchedule: { routeId: string; routeName: string };
  /** Tela genérica de placeholder. */
  Placeholder: { title: string; subtitle?: string };
  About: undefined;
  CancellationPolicy: undefined;
  ConsentTerm: undefined;
  DataRequest: undefined;
};

/** Abas principais (navbar inferior). */
export type MainTabParamList = {
  Home: undefined;
  Payments: undefined;
  Activities: undefined;
  Profile: NavigatorScreenParams<ProfileStackParamList>;
};

/** Tipo de cadastro na tela "Crie sua conta" (igual ao layout: Motorista + Preparador). */
export type RegistrationType = DriverType | 'preparador_excursões' | 'preparador_encomendas';

export type RootStackParamList = {
  Splash: undefined;
  Welcome: undefined;
  /** Ambiente preparador de excursões */
  MainExcursoes: undefined;
  /** Ambiente preparador de encomendas */
  MainEncomendas: undefined;
  SignUpType: undefined;
  Login: undefined;
  SignUp: { registrationType?: RegistrationType };
  VerifyEmail: {
    email: string;
    password: string;
    fullName?: string;
    phone?: string;
    registrationType?: RegistrationType;
    /** Canal usado no envio do OTP. `phone` ainda é arquitetural (stub WhatsApp). */
    channel?: 'email' | 'phone';
  };
  /** Cadastro completo — motorista (take_me / parceiro). */
  CompleteDriverRegistration: { driverType: RegistrationType };
  /** Cadastro completo — preparador de excursões. */
  CompletePreparadorExcursoes: undefined;
  /** Cadastro completo — preparador de encomendas. */
  CompletePreparadorEncomendas: undefined;
  /** Cria auth + worker_profiles + vehicles + routes (último passo do cadastro). */
  FinalizeRegistration: { driverType: RegistrationType };
  RegistrationSuccess: undefined;
  /** Sessão ativa mas worker_profiles.status !== approved (ex.: inactive). */
  MotoristaPendingApproval: undefined;
  /** Stripe Connect obrigatório antes de acessar o app. */
  StripeConnectSetup: { subtype?: string };
  Main: undefined;
  PendingRequests: undefined;
  TripHistory: undefined;
  TripDetail: { tripId: string };
  ActiveTrip: { tripId: string };
  /** Chat com cliente após aceitar solicitação (pilha raiz: volta para a tela anterior). */
  DriverClientChat: {
    conversationId: string;
    participantName?: string;
    participantAvatar?: string;
  };
  PaymentHistory: undefined;
  ForgotPassword: undefined;
  ForgotPasswordEmailSent: { email: string };
  /** Recuperação de senha: código de 4 dígitos após envio por e-mail ou telefone. */
  ForgotPasswordVerifyCode: { email?: string; phone?: string };
  /** Com `passwordResetToken` (fluxo código); sem params (link recovery do e-mail com sessão). */
  ResetPassword: { passwordResetToken?: string };
  ResetPasswordSuccess: undefined;
  TermsOfUse: undefined;
  PrivacyPolicy: undefined;
};
