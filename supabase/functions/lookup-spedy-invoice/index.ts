import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { spedyApiKey, spedyJson, unwrapSpedyPagedItems } from '../_shared/spedyHttp.ts';

type InvoiceRow = { id: string; status: string; model: 'productInvoice' | 'serviceInvoice' };

function mapItem(raw: Record<string, unknown>, model: 'productInvoice' | 'serviceInvoice'): InvoiceRow | null {
  const id = raw.id != null ? String(raw.id) : '';
  if (!id) return null;
  const status = raw.status != null ? String(raw.status) : 'unknown';
  return { id, status, model };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Não autenticado' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  if (!supabaseUrl || !anonKey) {
    return jsonResponse({ error: 'Supabase não configurado' }, 500);
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr || !user) {
    return jsonResponse({ error: 'Sessão inválida' }, 401);
  }

  if (!spedyApiKey()) {
    return jsonResponse({ error: 'Emissor fiscal (Spedy) não configurado no servidor.' }, 503);
  }

  let body: { stripe_payment_intent_id?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'JSON inválido' }, 400);
  }
  const pi = (body.stripe_payment_intent_id ?? '').trim();
  if (!pi.startsWith('pi_')) {
    return jsonResponse({ error: 'stripe_payment_intent_id inválido' }, 400);
  }

  const q = `?transactionId=${encodeURIComponent(pi)}&pageSize=10`;
  const out: InvoiceRow[] = [];

  const prod = await spedyJson<unknown>(`/product-invoices${q}`);
  if (!prod.ok && prod.status === 429) {
    return jsonResponse({ error: 'Spedy: limite de requisições (429). Tente em instantes.' }, 429);
  }
  for (const raw of unwrapSpedyPagedItems(prod.json)) {
    const row = mapItem(raw, 'productInvoice');
    if (row) out.push(row);
  }

  if (out.length === 0) {
    const srv = await spedyJson<unknown>(`/service-invoices${q}`);
    if (!srv.ok && srv.status === 429) {
      return jsonResponse({ error: 'Spedy: limite de requisições (429). Tente em instantes.' }, 429);
    }
    for (const raw of unwrapSpedyPagedItems(srv.json)) {
      const row = mapItem(raw, 'serviceInvoice');
      if (row) out.push(row);
    }
  }

  return jsonResponse({ invoices: out }, 200);
});
