import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders } from '../_shared/cors.ts';
import { spedyApiKey, spedyBaseUrl } from '../_shared/spedyHttp.ts';

function pdfPath(invoiceId: string, model: string): string | null {
  const id = encodeURIComponent(invoiceId);
  if (model === 'productInvoice') return `/product-invoices/${id}/pdf`;
  if (model === 'serviceInvoice') return `/service-invoices/${id}/pdf`;
  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Não autenticado' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  if (!supabaseUrl || !anonKey) {
    return new Response(JSON.stringify({ error: 'Supabase não configurado' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr || !user) {
    return new Response(JSON.stringify({ error: 'Sessão inválida' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const key = spedyApiKey();
  if (!key) {
    return new Response(JSON.stringify({ error: 'SPEDY_API_KEY não configurada' }), {
      status: 503,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let body: { invoice_id?: string; model?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'JSON inválido' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const invoiceId = (body.invoice_id ?? '').trim();
  const model = (body.model ?? '').trim();
  const path = pdfPath(invoiceId, model);
  if (!path) {
    return new Response(JSON.stringify({ error: 'model deve ser productInvoice ou serviceInvoice' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const url = `${spedyBaseUrl()}${path}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'X-Api-Key': key,
      Accept: 'application/pdf',
    },
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    return new Response(
      JSON.stringify({ error: `Spedy PDF: HTTP ${res.status}`, detail: errText.slice(0, 500) }),
      { status: res.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const buf = new Uint8Array(await res.arrayBuffer());
  return new Response(buf, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="nf-${invoiceId}.pdf"`,
    },
  });
});
