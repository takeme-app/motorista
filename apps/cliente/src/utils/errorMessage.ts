/**
 * Converte mensagens de erro (Supabase, rede, etc.) para português do Brasil
 * para exibição ao usuário. Evita mostrar mensagens técnicas em inglês.
 */
const ERROR_PT: Array<[RegExp, string]> = [
  // ── Supabase / Auth ──
  [/invalid login credentials|invalid_credentials/i, 'E-mail ou senha incorretos. Tente novamente.'],
  [/email not confirmed/i, 'E-mail ainda não confirmado. Verifique sua caixa de entrada.'],
  [/user already registered|already exists|already registered/i, 'Este e-mail já está cadastrado. Faça login ou use outro e-mail.'],
  [/password should be at least|password.*at least \d/i, 'A senha deve ter no mínimo 6 caracteres.'],
  [/unable to validate email|invalid email/i, 'E-mail inválido. Verifique e tente novamente.'],
  [/token has expired|expired/i, 'Link ou código expirado. Solicite um novo.'],
  [/network request failed|failed to fetch|network error/i, 'Sem conexão. Verifique a internet e tente novamente.'],
  [/rate limit|rate_limit|too many requests|429|email.*hour|password reset.*period/i, 'Aguarde alguns minutos para solicitar um novo e-mail de recuperação.'],
  [/session.*expired|refresh token/i, 'Sessão expirada. Faça login novamente.'],
  // Índice parcial bookings_one_active_per_user_trip: uma reserva ativa por
  // usuário por viagem. Precisa vir ANTES da regra genérica de 23505, que
  // diria só "este dado já está em uso" e não ajudaria em nada aqui.
  [/bookings_one_active_per_user_trip/i, 'Você já tem uma reserva nesta viagem. Para mudar a quantidade de lugares, cancele a reserva atual e faça uma nova.'],
  [/duplicate key|unique constraint|23505/i, 'Este dado já está em uso. Use outro valor.'],
  [/foreign key|violates foreign key/i, 'Não foi possível concluir. Verifique os dados.'],
  [/bucket.*not found|storage.*not found/i, 'Serviço de armazenamento indisponível. Tente mais tarde.'],
  [/row-level security|policy/i, 'Você não tem permissão para esta ação.'],
  [/jwt expired/i, 'Sessão expirada. Faça login novamente.'],
  [/invalid jwt|jwt could not be verified|jwt.*not.*valid/i, 'Sessão inválida ou expirada. Faça login novamente.'],
  [/edge function|non-2xx/i, 'Serviço temporariamente indisponível. Tente novamente.'],
  [
    /\[NOT_FOUND\]|requested function was not found|function was not found/i,
    'A função no servidor não foi encontrada neste projeto Supabase (edge function sem deploy ou slug diferente). Publique a função no painel Edge Functions ou ajuste o nome no app.',
  ],

  // ── Stripe ──
  [/card was declined|card_declined/i, 'Cartão recusado. Verifique os dados ou use outro cartão.'],
  [/card number is incorrect|incorrect_number/i, 'Número do cartão incorreto. Verifique e tente novamente.'],
  [/card.?s? security code is incorrect|incorrect_cvc|invalid_cvc/i, 'Código de segurança (CVV) incorreto.'],
  [/card has expired|expired_card/i, 'Cartão expirado. Use um cartão válido.'],
  [/expiration month is invalid|invalid_expiry_month/i, 'Mês de validade inválido.'],
  [/expiration year is invalid|invalid_expiry_year/i, 'Ano de validade inválido.'],
  [/card.?s? expiration|expiry/i, 'Data de validade inválida. Verifique e tente novamente.'],
  [/insufficient.?funds/i, 'Saldo insuficiente. Use outro cartão ou método de pagamento.'],
  [/processing error|processing_error/i, 'Erro ao processar o cartão. Tente novamente em alguns instantes.'],
  [/lost.?card/i, 'Cartão reportado como perdido. Use outro cartão.'],
  [/stolen.?card/i, 'Cartão reportado como roubado. Use outro cartão.'],
  [/card not supported|card_not_supported/i, 'Este tipo de cartão não é aceito. Use outro cartão.'],
  [/currency not supported/i, 'Moeda não suportada por este cartão. Use outro cartão.'],
  [/do_not_honor/i, 'Transação não autorizada pelo banco. Entre em contato com o emissor do cartão.'],
  [/try again|try_again_later/i, 'Erro temporário. Tente novamente em alguns instantes.'],
  [/exceeds.*balance|withdrawal_count_limit/i, 'Limite do cartão excedido. Use outro cartão.'],
  [/test mode.*non.?test|live mode.*test/i, 'Cartão de teste inválido para este ambiente.'],
  [
    // Stripe: "No such PaymentMethod" — sem [^a-z_] com /i no mesmo regex (em JS, /i afeta [^a-z_] e bloqueia letras maiúsculas).
    /could not find payment|no such payment_method|no such paymentmethod|resource_missing.*payment_method/i,
    'O servidor não encontrou este cartão no Stripe. Confira se EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY (app) e STRIPE_SECRET_KEY (secrets da edge function save-payment-method no Supabase) são do mesmo modo (teste ou live) e da mesma conta Stripe.',
  ],
  [/authentication.*required|authentication_required/i, 'Autenticação adicional necessária. Tente novamente.'],
  [/setup_intent_unexpected_state/i, 'Erro na configuração do pagamento. Tente novamente.'],
  [/zip code failed|incorrect_zip|postal_code/i, 'CEP do cartão inválido.'],
];

const DEFAULT_MESSAGE = 'Algo deu errado. Tente novamente.';

function getMessageFromError(error: unknown): string {
  if (error == null) return '';
  if (typeof error === 'string') return error.trim();
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const msg = String((error as { message: unknown }).message).trim();
    if (msg) return msg;
  }
  return '';
}

/**
 * Retorna uma mensagem em português (BR) adequada para exibir ao usuário.
 * @param error - Erro capturado (try/catch) ou objeto com .message
 * @param fallback - Mensagem padrão quando não houver mapeamento (opcional)
 */
export function getUserErrorMessage(error: unknown, fallback: string = DEFAULT_MESSAGE): string {
  const raw = getMessageFromError(error);
  if (!raw) return fallback;

  const lower = raw.toLowerCase();
  for (const [pattern, message] of ERROR_PT) {
    if (pattern.test(raw) || pattern.test(lower)) {
      return message;
    }
  }

  return fallback;
}
