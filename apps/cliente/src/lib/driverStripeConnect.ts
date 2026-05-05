import { supabase } from './supabase';

/**
 * Indica se o motorista pode receber split no Stripe Connect (`charges_enabled`).
 * Usa RPC `driver_stripe_charges_enabled` (SECURITY DEFINER) porque RLS em `worker_profiles`
 * não permite ao passageiro ler a linha do motorista.
 */
export async function fetchDriverStripeChargesEnabled(workerId: string): Promise<boolean> {
  const id = workerId?.trim();
  if (!id) return false;
  const { data, error } = await supabase.rpc('driver_stripe_charges_enabled', { p_worker_id: id });
  if (error) {
    console.warn('[fetchDriverStripeChargesEnabled]', error.message);
    return false;
  }
  return data === true;
}
