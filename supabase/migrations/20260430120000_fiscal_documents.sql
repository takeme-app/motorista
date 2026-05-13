-- Documentos fiscais Spedy vinculados a cobranças Stripe (bookings, shipments, etc.)
-- Matriz fiscal padrão (confirmar com contador antes de produção):
--   - Emissão via API de Vendas Spedy (POST /v1/orders + issue) com spedy_document_kind = order.
--   - entity_type booking | shipment | dependent_shipment | excursion_request.
--   - NFS-e vs NF-e completa: ajustar spedy_document_kind e payloads na Edge issue-fiscal-document após decisão fiscal.

create table if not exists public.fiscal_documents (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null
    check (entity_type in ('booking', 'shipment', 'dependent_shipment', 'excursion_request')),
  entity_id uuid not null,
  stripe_payment_intent_id text not null,
  spedy_document_kind text not null default 'order'
    check (spedy_document_kind in ('order', 'product_invoice', 'service_invoice')),
  spedy_order_id uuid,
  spedy_invoice_id uuid,
  integration_id varchar(36) not null,
  status text not null default 'pending'
    check (status in (
      'pending',
      'submitted',
      'authorized',
      'rejected',
      'canceled',
      'failed',
      'failed_validation'
    )),
  processing_code text,
  processing_message text,
  last_spedy_event_id text,
  authorized_at timestamptz,
  spedy_invoice_model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_type, entity_id),
  unique (stripe_payment_intent_id),
  unique (integration_id)
);

create index if not exists fiscal_documents_status_updated_idx
  on public.fiscal_documents (status, updated_at);

create index if not exists fiscal_documents_stripe_pi_idx
  on public.fiscal_documents (stripe_payment_intent_id);

comment on table public.fiscal_documents is 'Rastreamento de NF-e/NFS-e emitidas via Spedy; integration_id = md5 hex 32 de entity_type+entity_id.';

-- integration_id determinístico (≤ 32 chars) para idempotência com Spedy
create or replace function public.fiscal_integration_id(p_entity_type text, p_entity_id uuid)
returns text
language sql
immutable
as $$
  select md5(p_entity_type || ':' || p_entity_id::text);
$$;

create or replace function public.set_fiscal_documents_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists fiscal_documents_set_updated_at on public.fiscal_documents;
create trigger fiscal_documents_set_updated_at
  before update on public.fiscal_documents
  for each row execute function public.set_fiscal_documents_updated_at();

alter table public.fiscal_documents enable row level security;

-- Sem políticas SELECT/INSERT para authenticated: acesso via service_role (Edge) ou RPC abaixo.

grant usage on schema public to postgres, anon, authenticated, service_role;

grant select, insert, update, delete on table public.fiscal_documents to service_role;

-- Leitura para o painel admin (JWT). Restringir no futuro a perfis admin se existir tabela de permissões.
create or replace function public.fiscal_document_for_entity(
  p_entity_type text,
  p_entity_id uuid
)
returns public.fiscal_documents
language sql
stable
security definer
set search_path = public
as $$
  select fd.*
  from public.fiscal_documents fd
  where fd.entity_type = p_entity_type
    and fd.entity_id = p_entity_id
  limit 1;
$$;

revoke all on function public.fiscal_document_for_entity(text, uuid) from public;
grant execute on function public.fiscal_document_for_entity(text, uuid) to authenticated;
grant execute on function public.fiscal_document_for_entity(text, uuid) to service_role;

-- Enfileirar emissão fiscal após pagamento (chamada pela Edge stripe-webhook com service_role)
create or replace function public.enqueue_fiscal_document(
  p_entity_type text,
  p_entity_id uuid,
  p_stripe_payment_intent_id text
)
returns public.fiscal_documents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.fiscal_documents;
  v_int_id text;
begin
  if p_entity_type not in ('booking', 'shipment', 'dependent_shipment', 'excursion_request') then
    raise exception 'invalid entity_type';
  end if;
  v_int_id := public.fiscal_integration_id(p_entity_type, p_entity_id);
  insert into public.fiscal_documents (
    entity_type,
    entity_id,
    stripe_payment_intent_id,
    integration_id,
    status
  ) values (
    p_entity_type,
    p_entity_id,
    p_stripe_payment_intent_id,
    v_int_id,
    'pending'
  )
  on conflict (stripe_payment_intent_id) do nothing
  returning * into v_row;

  if v_row is null then
    select * into v_row
    from public.fiscal_documents
    where stripe_payment_intent_id = p_stripe_payment_intent_id
    limit 1;
  end if;
  if v_row is null then
    raise exception 'enqueue_fiscal_document: insert skipped and row not found';
  end if;

  return v_row;
end;
$$;

revoke all on function public.enqueue_fiscal_document(text, uuid, text) from public;
grant execute on function public.enqueue_fiscal_document(text, uuid, text) to service_role;

-- Idempotência de webhooks Spedy (event id único)
create table if not exists public.fiscal_spedy_webhook_events (
  spedy_event_id text primary key,
  received_at timestamptz not null default now()
);

alter table public.fiscal_spedy_webhook_events enable row level security;

grant select, insert on table public.fiscal_spedy_webhook_events to service_role;
