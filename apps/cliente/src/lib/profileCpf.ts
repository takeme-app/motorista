import { supabase } from './supabase';
import { onlyDigits, validateCpf } from '../utils/formatCpf';

/**
 * O perfil já tem um CPF válido salvo?
 *
 * O Pix real exige CPF (o provedor cria o customer com ele), mas o servidor
 * PREFERE o CPF do perfil e só persiste um novo quando não há um válido. Então
 * pedir o CPF na tela quando o perfil já tem um é pedir dado repetido — que foi
 * exatamente o que aconteceu em encomenda, dependente e excursão enquanto a
 * viagem, que checa o passageiro, não pedia.
 *
 * `null` = não deu para saber (sem sessão, rede fora, erro). Quem chama deve
 * tratar `null` como "pede o CPF": perguntar à toa é chato, mas esconder o
 * campo de quem não tem CPF trava a pessoa num 422 sem saída.
 */
export async function profileHasValidCpf(): Promise<boolean | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data, error } = await supabase
      .from('profiles')
      .select('cpf')
      .eq('id', user.id)
      .maybeSingle();
    if (error || !data) return null;
    return validateCpf(onlyDigits((data as { cpf?: string | null }).cpf ?? ''));
  } catch {
    return null;
  }
}
