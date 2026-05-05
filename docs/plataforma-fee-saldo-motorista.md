# Taxa da plataforma em viagens com dinheiro (sem Stripe Connect) + abate no Connect

Este documento alinha **app cliente** (já implementado em parte), **Supabase** (migrations + edges), **app motorista** e **admin/backoffice** para a regra de negócio:

- Se o motorista **não** tem `worker_profiles.stripe_connect_charges_enabled = true`, o passageiro no checkout só vê **Dinheiro**; o valor a pagar em mãos ao motorista é o **total com taxa da plataforma** (mesmo gross-up que cartão/Pix).
- Quando o motorista **ativa** o Connect, nas próximas corridas com cartão/Pix a plataforma pode **abater** até `min(saldo_devido, taxa_admin_da_corrida)` por viagem (cap por corrida), aumentando o `application_fee_amount` no Stripe.

**Fonte de verdade do “Connect pronto”:** `worker_profiles.stripe_connect_charges_enabled` (atualizado pelo webhook `account.updated` e por `stripe-connect-sync` no repo `takeme-project`).

**Leitura no app cliente (passageiro):** RPC `driver_stripe_charges_enabled(p_worker_id uuid)` — `SECURITY DEFINER`, porque RLS de `worker_profiles` não permite ao passageiro `SELECT` na linha do motorista.

---

## 1. Migrations já adicionadas (`takeme-project`)

Ficheiro: `supabase/migrations/20260607120000_bookings_payment_method_and_driver_connect_rpc.sql`

- Coluna `bookings.payment_method` — `text NOT NULL DEFAULT 'card'` com `CHECK (payment_method IN ('card','pix','cash'))`.
- Coluna `bookings.platform_fee_extra_debit_cents` — `integer NOT NULL DEFAULT 0` (auditoria do abate na corrida Connect).
- Função `public.driver_stripe_charges_enabled(uuid) RETURNS boolean` + `GRANT EXECUTE TO authenticated`.

**Deploy:** aplicar migration no projeto Supabase ligado ao app; publicar edge `charge-booking` se o insert passar a enviar `payment_method` / `platform_fee_extra_debit_cents`.

---

## 2. App cliente (`cliente`)

| Ficheiro | Comportamento |
|----------|----------------|
| `src/lib/driverStripeConnect.ts` | Chama `supabase.rpc('driver_stripe_charges_enabled', { p_worker_id })`. |
| `src/components/PaymentMethodSection.tsx` | Prop `allowedMethods`; aviso quando só dinheiro; texto dinheiro alinhado a “pagar no destino final”. |
| `src/screens/trip/CheckoutScreen.tsx` | Busca Connect ao montar; `allowedPaymentMethods`; bloqueia método fora da lista; **Pix**: insert `payment_method='pix'`, `status='pending'`; **Dinheiro**: `payment_method='cash'`, `status='confirmed'`, `amount_cents = total` (snapshot). |

**Cartão:** continua a ir só pela edge `charge-booking` (insert já inclui `payment_method: 'card'` no `takeme-project`).

---

## 3. Motorista: dívida da taxa (ledger) — a implementar no backend

### 3.1 Princípio de cobrança em dinheiro

O cliente **só paga em dinheiro ao motorista ao chegar ao destino final**. Enquanto `bookings.status <> 'completed'`, **não** há crédito de taxa no ledger (cancelamentos / no-show não geram dívida nem refund de dinheiro).

### 3.2 Schema sugerido (próxima migration)

**Tabela `driver_platform_fee_ledger`**

| Coluna | Tipo | Notas |
|--------|------|--------|
| `id` | uuid PK | `gen_random_uuid()` |
| `worker_id` | uuid FK `worker_profiles.id` | |
| `booking_id` | uuid FK `bookings.id` nullable | |
| `kind` | text | `'credit'` = motorista deve à plataforma; `'debit'` = abate em corrida Connect |
| `amount_cents` | int ≥ 0 | |
| `balance_after_cents` | int | opcional; ou view `sum(credit) - sum(debit)` |
| `note` | text | ex.: `cash_trip_completed`, `connect_charge_abate`, `refund_revert` |
| `created_at` | timestamptz | default `now()` |

**UNIQUE** parcial ou composto para idempotência, ex.: `(booking_id, kind, note)` onde `note = 'cash_trip_completed'` para não duplicar ao regravar `completed`.

**Coluna agregada (opcional):** `worker_profiles.platform_fee_owed_cents int default 0` atualizada por trigger no ledger.

### 3.3 Trigger em `bookings`

`AFTER UPDATE` quando `OLD.status IS DISTINCT FROM 'completed'` e `NEW.status = 'completed'` e `NEW.payment_method = 'cash'`:

- Inserir `credit` com `amount_cents = NEW.admin_earning_cents` (taxa da plataforma daquela viagem).
- Atualizar `platform_fee_owed_cents` do motorista (resolver `worker_id` via `scheduled_trips.driver_id` ou coluna já existente na booking).

### 3.4 Edge `charge-booking` (cartão, com Connect)

Antes de `application_fee_amount`:

1. `owed := worker_profiles.platform_fee_owed_cents` (lock `FOR UPDATE` numa RPC `consume_platform_fee_owed(worker_id, max_cents)`).
2. `extra := min(owed, admin_earning_cents)` (cap por corrida — decisão de produto).
3. `application_fee_amount := admin_earning_cents + extra`.
4. Persistir `bookings.platform_fee_extra_debit_cents = extra`.
5. Inserir no ledger `debit` com `amount_cents = extra`, `booking_id` = nova reserva.

Ajustar `worker_payout_cents` / metadados Stripe para refletir o que efetivamente vai ao Connect.

### 3.5 Cancelamentos e refunds

| Cenário | Ledger |
|---------|--------|
| `cash`, cancelado antes de `completed` | Nada (dinheiro não foi trocado). |
| `card`/`pix`, refund **dentro** da janela (`booking_cancellation_free_window_hours`) | Se `platform_fee_extra_debit_cents > 0`, RPC `revert_platform_fee_debit(booking_id)` insere `credit` no ledger igual ao extra (devolve saldo ao motorista). |
| `card`/`pix`, cancelado fora da janela | Sem refund; ledger inalterado. |

Integrar em `cancel-booking` após `process-refund` bem-sucedido.

### 3.6 Concorrência

Toda leitura+consumo de `owed` na cobrança Connect deve ser **transacional** (uma RPC com `SELECT ... FOR UPDATE` em `worker_profiles` ou linha de “wallet”).

---

## 4. App motorista (`takeme-project/apps/motorista`)

- `PaymentsScreen`: secção “Saldo devido à plataforma” (`platform_fee_owed_cents` + últimas linhas do ledger).
- `StripeConnectSetupScreen`: aviso de que, sem Connect aprovado, as viagens são só em dinheiro e a taxa acumula dívida.
- Ao concluir viagem em dinheiro (`completed`): toast “Taxa X registada; será abatida nas próximas corridas com cartão/Pix.”

---

## 5. Admin / backoffice (projeto externo)

- Lista de motoristas com `platform_fee_owed_cents > 0`.
- Drill-down no `driver_platform_fee_ledger`.
- Filtro de reservas `payment_method = 'cash'`.
- Ação manual “quitar saldo” → linha `debit` com `note = 'manual_adjustment'` (ou política interna).

---

## 6. Testes manuais (checklist)

1. Migration aplicada + RPC responde `true`/`false` coerente com `worker_profiles`.
2. Motorista sem Connect: checkout só dinheiro; confirma; `bookings.payment_method = 'cash'`, `status = 'confirmed'`, `amount_cents` = total UI.
3. Cancelar essa reserva antes de `completed`: sem linhas no ledger.
4. Completar viagem: trigger cria `credit` (após implementação §3).
5. Motorista com Connect: checkout mostra todos os métodos; cartão cria `payment_method = 'card'`; após ledger, `extra_debit` reflete abate.
6. Refund dentro da janela com `extra_debit > 0`: ledger reverte (após implementação §3.5).

---

## 7. Riscos / follow-ups

- Motorista pode atrasar marcar `completed` em cash para postergar o `credit` — mitigar com lembrete, relatório de viagens `in_progress` antigas, ou auto-complete por geofence (fora deste escopo).
- `no_show` / multas: alinhar com `driver_penalties` quando existir política de cobrança em dinheiro.
