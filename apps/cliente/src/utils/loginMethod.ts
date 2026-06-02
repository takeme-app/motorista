/**
 * Distingue contas que logam por TELEFONE de contas que logam por E-MAIL.
 *
 * Contas criadas por telefone usam um e-mail SINTÉTICO `{digits}@takeme.com`
 * em `auth.users.email` (ver `phoneToFakeEmail` em
 * supabase/functions/verify-phone-code). Para essas contas o e-mail é apenas um
 * registro (guardado em `user_metadata.email`), não uma forma de login — e o
 * sintético nunca deve ser exibido ao usuário.
 */

type MinimalUser =
  | {
      email?: string | null;
      user_metadata?: Record<string, unknown> | null;
    }
  | null
  | undefined;

/** E-mail sintético gerado a partir do telefone (`{digits}@takeme.com`). */
export function isSyntheticEmail(email?: string | null): boolean {
  return /^\d{6,}@takeme\.com$/i.test((email ?? '').trim());
}

/** Conta cujo login é o telefone (e-mail é só registro). */
export function isPhoneLoginAccount(user: MinimalUser): boolean {
  if (!user) return false;
  if ((user.user_metadata?.login_method as string | undefined) === 'phone') return true;
  return isSyntheticEmail(user.email);
}

/** E-mail-registro guardado em `user_metadata.email` (contas por telefone). */
export function getRecordEmail(user: MinimalUser): string {
  return ((user?.user_metadata?.email as string | undefined) ?? '').trim();
}

/**
 * E-mail a exibir no perfil. Nunca mostra o sintético: conta por telefone
 * mostra o e-mail-registro se houver, senão "Nenhum e-mail cadastrado".
 */
export function displayEmail(user: MinimalUser): string {
  if (isPhoneLoginAccount(user)) {
    return getRecordEmail(user) || 'Nenhum e-mail cadastrado';
  }
  return (user?.email ?? '').trim() || '—';
}
