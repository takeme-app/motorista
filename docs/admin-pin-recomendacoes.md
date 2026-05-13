# Recomendações para o frontend Admin e UI da Base

> Documento gerado durante a adequação do fluxo de **código de 4 dígitos** ao
> PDF "Sequência de Solicitação de Código". Este arquivo descreve **o que foi
> feito no banco/apps** e **o que falta** para os times de **Admin** e de
> **Operador da Base** construírem suas interfaces — **nenhuma alteração foi
> feita no app/front Admin** nesta entrega.

---

## 1. Resumo do que foi alterado

### 1.1 Banco de dados (migrations)

| Migration | O que faz |
|---|---|
| `20260603100000_bookings_remove_delivery_code_generation.sql` | Para de gerar `bookings.delivery_code` (cenário 1 do PDF: viagem comum tem só 1 PIN). Coluna mantida nullable para histórico. |
| `20260603110000_complete_trip_stop_dependent_pin_validation.sql` | Restaura validação de PIN no servidor para `dependent_pickup` e `dependent_dropoff` (cenário 2 do PDF). |
| `20260603120000_shipments_handoff_codes.sql` | Adiciona colunas em `shipments`: `passenger_to_preparer_code` (PIN A), `preparer_to_base_code` (PIN B), `base_to_driver_code` (PIN C) e timestamps de handoff. Atualiza `generate_shipment_codes()` para gerar os 4 PINs quando há `base_id`. |
| `20260603130000_ensure_shipment_trip_stops_with_base.sql` | `ensure_shipment_trip_stops` agora popula `trip_stops.code` da retirada com `base_to_driver_code` quando há base (cenário 3). |
| `20260608153000_base_confirm_driver_pickup.sql` | Coluna `shipments.base_to_driver_confirmed_at`; RPC `base_confirm_driver_pickup` (admin ou preparador da base); `complete_trip_stop` exige confirmação da base na retirada com `base_id`; `complete_shipment_base_to_driver_by_admin` delega para a mesma RPC. |
| `20260603150000_shipment_preparer_handoff_rpcs.sql` | Cria duas RPCs novas para os handoffs do preparador: `complete_shipment_passenger_to_preparer` (PIN A) e `complete_shipment_preparer_to_base` (PIN B). |

### 1.2 App Cliente (passageiro)

| Arquivo | Mudança |
|---|---|
| `apps/cliente/src/screens/trip/TripInProgressScreen.tsx` | Removida UI/lógica de PIN no desembarque da viagem comum (cenário 1). |
| `apps/cliente/src/screens/dependentShipment/DependentShipmentDetailScreen.tsx` | Adicionada seção "PIN de desembarque do dependente" para o solicitante repassar ao responsável no destino (cenário 2). |
| `apps/cliente/src/screens/shipment/ShipmentDetailScreen.tsx` | Para encomenda **com base**: substitui exibição do `pickup_code` por um botão "Validar código do preparador" que chama `complete_shipment_passenger_to_preparer` (cenário 3, etapa 3 do PDF). |

### 1.3 App Motorista

| Arquivo | Mudança |
|---|---|
| `apps/motorista/src/screens/ActiveTripScreen.tsx` | `dependent_dropoff` agora exige PIN. Instruções atualizadas para `package_pickup` em base (cenário 3) e para `dependent_dropoff` (cenário 2). |
| `apps/motorista/src/hooks/useTripStops.ts` | Para encomendas com base: a parada `package_pickup` recebe o PIN C (`base_to_driver_code`) em vez do `pickup_code` legado. |
| `apps/motorista/src/screens/encomendas/ActiveShipmentScreen.tsx` (preparador) | Cenário 3: na coleta no cliente o preparador **informa** o PIN A (passageiro valida no app cliente); na entrega na base o preparador **valida** o PIN B chamando a RPC. |

---

## 2. Como ficou cada cenário do PDF

### Cenário 1 — Viagem comum (1 PIN)
- ✅ `bookings.pickup_code` é o único PIN gerado.
- ✅ App motorista: motorista digita PIN no embarque (`passenger_pickup`).
- ✅ App cliente: passageiro vê PIN; sem etapa de desembarque com PIN.
- ✅ Servidor valida embarque; desembarque livre.

### Cenário 2 — Envio de Dependente (2 PINs)
- ✅ `dependent_shipments.pickup_code` (embarque) e `delivery_code` (desembarque).
- ✅ App cliente: solicitante vê ambos os PINs (compartilha desembarque com responsável no destino).
- ✅ App motorista: PIN no embarque E no desembarque.
- ✅ Servidor valida ambos os handoffs.

### Cenário 3 — Encomenda com base (4 PINs)
- ✅ Banco com 4 PINs em `shipments` quando há `base_id`.
- ✅ PIN A: passageiro valida (RPC `complete_shipment_passenger_to_preparer`).
- ✅ PIN B: preparador valida (RPC `complete_shipment_preparer_to_base`).
- ✅ PIN C: o motorista **mostra** o código no app; a base confirma no Admin (`base_confirm_driver_pickup`); o motorista conclui a parada com `complete_trip_stop` (gate `base_to_driver_confirmed_at`).
- ✅ PIN D: motorista digita ao entregar (`complete_trip_stop` com `delivery_code`).
- ⚠️ Dashboards agregados da secção 3.1 (listas por base, auditoria global) permanecem como melhoria futura.

### Cenário 4 — Encomenda sem base (2 PINs)
- ✅ Sem mudanças no fluxo (mantém `pickup_code` + `delivery_code`).
- ✅ Após o motorista aceitar a encomenda, fluxo segue como já estava.

---

## 3. Admin — visualização e operação

### 3.0 Confirmação PIN C (detalhe da viagem)

- **`apps/admin/src/screens/ViagemDetalheScreen.tsx`**: bloco «Confirmar retirada do motorista» quando a encomenda tem `base_id`, já chegou à base (`delivered_to_base_at`) e ainda não tem `base_to_driver_confirmed_at`, chamando a RPC `base_confirm_driver_pickup` (admin ou preparador da mesma base).

### 3.1 Telas/dashboards recomendados

1. **Auditoria de validações de PIN**
   - Listar, por encomenda/viagem/dependente: cada handoff (com timestamps `picked_up_by_preparer_at`, `delivered_to_base_at`, `base_to_driver_confirmed_at`, `picked_up_by_driver_from_base_at`, `picked_up_at`, `delivered_at`).
   - Mostrar status: "PIN A validado em [data]", "PIN B validado em [data]", etc.
   - Filtros: por shipment, por base, por motorista, por preparador, por janela temporal.
   - **Nota**: ainda não há tabela de log dedicada. A recomendação **futura** é criar `code_validation_logs(entity_type, entity_id, step, validated_by, validated_at, success)`. Por enquanto a auditoria é indireta via timestamps + `status_history` (migration `20260522210000_log_status_change_security_definer.sql`).

2. **Visualização de PINs por encomenda**
   - Detalhe do shipment exibindo: `pickup_code`, `delivery_code`, `passenger_to_preparer_code`, `preparer_to_base_code`, `base_to_driver_code`.
   - **Cuidado de segurança**: estes PINs são sensíveis. Se o admin tem acesso de leitura aos shipments, o admin já consegue vê-los via SELECT. Considerar mascará-los na UI (`••••`) com botão "revelar" + log de quem revelou.

3. **Encomendas em base** (operacional para suporte)
   - Lista de shipments com `delivered_to_base_at` populado e `base_to_driver_confirmed_at` ainda nulo: **aguardando confirmação do PIN C pela base** (motorista já pode estar na base com o código no ecrã).
   - Lista de shipments com `base_to_driver_confirmed_at` populado e `picked_up_by_driver_from_base_at` ainda nulo: **aguardando o motorista concluir a parada** na app.
   - Lista de shipments com `picked_up_by_preparer_at` populado e `delivered_to_base_at` ainda nulo. Estas estão "em trânsito do cliente para a base".
   - Suporte usar isso para resolver casos onde o motorista demora a retirar.

4. **Estatísticas**
   - Tempo médio entre `picked_up_at` (cliente) e `delivered_to_base_at` (base) — eficiência do preparador.
   - Tempo médio entre `delivered_to_base_at` (base) e `picked_up_by_driver_from_base_at` (motorista) — tempo de espera na base.

### 3.2 Colunas adicionais já populadas (basta selecionar)

```sql
SELECT
  id,
  status,
  base_id,
  preparer_id,
  driver_id,
  -- PINs (cuidado para mascarar na UI)
  pickup_code,                     -- PIN coleta (cenário 4)
  delivery_code,                   -- PIN D (cenário 3 e 4)
  passenger_to_preparer_code,      -- PIN A (cenário 3)
  preparer_to_base_code,           -- PIN B (cenário 3)
  base_to_driver_code,             -- PIN C (cenário 3)
  -- Timestamps de handoff
  picked_up_by_preparer_at,        -- PIN A validado
  delivered_to_base_at,            -- PIN B validado
  base_to_driver_confirmed_at,      -- PIN C confirmado pela base (motorista mostrou o código)
  picked_up_by_driver_from_base_at, -- motorista concluiu retirada na app
  picked_up_at,                    -- coleta confirmada (qualquer cenário)
  delivered_at                     -- entrega final concluída
FROM public.shipments;
```

### 3.3 RLS e visibilidade

A política RLS existente para o admin já dá leitura completa sobre `shipments`. Nenhuma alteração necessária para visualizar os novos campos.

---

## 4. O que falta na **UI da Base** (dedicada)

> O **Admin** já permite confirmar o PIN C no detalhe da viagem (secção 3.0).
> Falta, se desejado, uma **UI exclusiva da base** (tablet, app próprio ou perfil «só base») para listas operacionais sem passar pelo ecrã de viagem completo.

### 4.1 Por que isso pode ser útil

Pelo PDF cenário 3:
- **Etapa 7**: "Base informa o código" (PIN B) ao preparador.
- **Etapa 11**: "Base valida o código" que o motorista informa (PIN C).

Sem UI dedicada só para a base, o operador usa o **Admin** (detalhe da viagem) ou continua a depender do preparador no fluxo verbal.

Hoje o sistema funciona porque:
- O preparador, fisicamente na base, vê o PIN B no app dele e digita (chamando `complete_shipment_preparer_to_base`).
- O motorista **mostra** o PIN C no app; o operador da base (admin ou preparador com login no Admin) confirma com `base_confirm_driver_pickup`; o motorista conclui a parada com `complete_trip_stop`.

### 4.2 Opções de UI da Base (a decidir)

| Opção | Descrição | Esforço |
|---|---|---|
| **B1** — Operador com login | Novo `worker_profiles.role = 'base_operator'` com `base_id`. Aba dedicada no app motorista (ou app próprio). Operador vê encomendas chegando/saindo da sua base, com PIN B/C visíveis. | Médio |
| **B2** — Tablet fixo sem login | Rota web identificada por `base_id` + token. Tablet permanente na base mostra encomendas e PINs. | Baixo–Médio |
| **B3** — Operador via Admin | Aproveitar o app admin com perfil restrito por `base_id`. Reusa autenticação e RLS. | Baixo (se admin já tem perfis) |

### 4.3 Backend já está preparado

Quando a UI da Base existir, ela vai consumir os mesmos dados/RPCs:
- **Listar encomendas a depositar**: `shipments` com `base_id = X`, `picked_up_by_preparer_at != null` e `delivered_to_base_at = null`.
- **Listar encomendas a entregar ao motorista**: `shipments` com `base_id = X`, `delivered_to_base_at != null` e `picked_up_by_driver_from_base_at = null` (inclui após `base_to_driver_confirmed_at` até o motorista concluir a parada).
- **Validar PIN B**: chamar `complete_shipment_preparer_to_base` (hoje só preparador chama; ajustar policy ou criar `complete_shipment_base_intake` se quiser separar atores).
- **Validar PIN C**: RPC `base_confirm_driver_pickup` (admin ou preparador da base); o motorista conclui com `complete_trip_stop`.

### 4.4 Modelagem mínima sugerida (quando construir)

```sql
-- Operador da base (se opção B1)
ALTER TABLE public.worker_profiles
  ADD COLUMN IF NOT EXISTS role text;  -- 'preparer' | 'base_operator' | …

-- Policy de SELECT em shipments para base_operator vendo só sua base
CREATE POLICY "shipments_select_base_operator" ON public.shipments
  FOR SELECT TO authenticated
  USING (
    base_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.worker_profiles wp
      WHERE wp.user_id = auth.uid()
        AND wp.role = 'base_operator'
        AND wp.base_id = shipments.base_id
    )
  );
```

---

## 5. Auditoria de PINs (próxima fase)

Não foi implementada nesta entrega (decisão do produto). Recomendação para
quando entrar:

```sql
CREATE TABLE public.code_validation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,        -- 'shipment' | 'dependent_shipment' | 'booking'
  entity_id uuid NOT NULL,
  step text NOT NULL,               -- 'passenger_to_preparer' | 'preparer_to_base' | 'base_to_driver' | 'driver_to_recipient' | 'passenger_pickup' | 'dependent_pickup' | 'dependent_dropoff'
  validated_by uuid NOT NULL,       -- auth.users
  validated_at timestamptz NOT NULL DEFAULT now(),
  success boolean NOT NULL,
  ip_address inet,
  device_info jsonb
);

CREATE INDEX idx_cvl_entity ON public.code_validation_logs (entity_type, entity_id);
CREATE INDEX idx_cvl_validated_by ON public.code_validation_logs (validated_by);
CREATE INDEX idx_cvl_validated_at ON public.code_validation_logs (validated_at DESC);
```

Cada uma das RPCs (`complete_trip_stop`, `complete_shipment_passenger_to_preparer`, `complete_shipment_preparer_to_base`) deve passar a inserir uma linha em `code_validation_logs` no fim, em sucesso e em falha. Isso permite auditoria completa para suporte e compliance (especialmente importante no cenário 2 — Dependentes).

---

## 6. Riscos conhecidos / pontos de atenção

1. **PIN A no app cliente**: o app cliente faz `select` em `shipments` que pode trazer `passenger_to_preparer_code`. Se o passageiro vir o PIN no app, o handoff fica cosmético. **Mitigação**: o `ShipmentDetailScreen.tsx` foi alterado para NÃO selecionar `passenger_to_preparer_code` — apenas o resultado da RPC valida. Manter essa disciplina ao evoluir.

2. **PIN B / PIN C visíveis no app preparador**: igualmente, o preparador vê o PIN B no app dele (porque é necessário no modo interim). Quando a base tiver UI, REMOVER essa exibição.

3. **Edge Function `confirm-code`**: continua existindo mas **não é usada** por nenhum app. Decisão recomendada: **descontinuar** (remover do deploy) ou consolidar a lógica nela. Por ora, fica órfã.

4. **Coluna `bookings.delivery_code`**: deprecada mas não removida. Manter a coluna evita migration destrutiva. Evitar selecioná-la em novos códigos.

---

## 7. Onde estão os testes

Não foram criados testes nesta entrega (decisão do produto). Cenários a cobrir
quando os testes forem feitos:

- **Banco**:
  - Insert em `shipments` com `base_id != null` gera 4 PINs distintos.
  - Insert em `shipments` com `base_id = null` gera apenas `pickup_code` e `delivery_code`.
  - Insert em `dependent_shipments` continua gerando 2 PINs.
  - `complete_trip_stop` com `dependent_pickup` rejeita PIN errado e aceita correto.
  - `complete_trip_stop` com `dependent_dropoff` idem.
  - `complete_trip_stop` com `package_pickup` em shipment com base exige `base_to_driver_confirmed_at` (PIN C confirmado pela base via `base_confirm_driver_pickup`).
  - `complete_trip_stop` com `package_pickup` em shipment sem base exige `picked_up_at` (cliente).
  - `complete_shipment_passenger_to_preparer` exige `auth.uid() = shipments.user_id`.
  - `complete_shipment_preparer_to_base` exige `auth.uid() = shipments.preparer_id` e `picked_up_by_preparer_at != null`.

- **Apps**:
  - Cliente confirma PIN A → backend marca `picked_up_by_preparer_at`.
  - Preparador detecta `picked_up_by_preparer_at` e avança para "to_base".
  - Preparador valida PIN B → backend marca `delivered_to_base_at`.
  - Base confirma PIN C (`base_confirm_driver_pickup`) → `base_to_driver_confirmed_at`; motorista conclui parada → `picked_up_by_driver_from_base_at`.
  - Motorista digita PIN D no destinatário → shipment vira `delivered`.
