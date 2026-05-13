# FCM, notificações e códigos de 4 dígitos (PINs)

Este documento resume as mudanças de produto e de implementação relacionadas a:

1. **FCM (Firebase Cloud Messaging)** — envio v1, tags Android, proximidade do motorista, foreground nos apps.
2. **Códigos de 4 dígitos** — alterações de regra de negócio alinhadas ao PDF *Sequência de Solicitação de Código* e ao fluxo de encomendas com base.

Para o **catálogo completo** de títulos/corpos de push por trigger, ver [`notificacoes-apps-catalogo.md`](./notificacoes-apps-catalogo.md).

---

## 1. FCM e notificações

### 1.1 HTTP v1 e módulo partilhado

- **`supabase/functions/_shared/fcm_v1.ts`** — Obtém access token OAuth2 (Google Auth Library) com scope `firebase.messaging`, envia `POST` a `fcm.googleapis.com/v1/projects/{id}/messages:send`.
- Suporta:
  - payload clássico com `notification` + `android.notification.channel_id` e **`tag`** (substituição da mesma notificação no Android);
  - **`dataOnly`**: só payload `data` + prioridade (para ETA “sticky” sem spam de inbox — o app desenha com Notifee).

### 1.2 `dispatch-notification-fcm`

- Disparado pelo **Database Webhook** em inserts em `public.notifications`.
- Lê `notifications.data` (jsonb) e extrai:
  - **`fcm_android_tag`** — mesmo valor em disparos consecutivos = mesma notificação atualizada no tray Android;
  - **`fcm_collapse_key`** — colapso FCM;
  - **`fcm_data_only`** — envio sem bloco `notification` (modo dados para o app tratar em foreground/Notifee).
- Mantém autenticação opcional com header `x-webhook-secret` (`NOTIFICATION_FCM_WEBHOOK_SECRET`).

### 1.3 Alinhamento PDF: proximidade, chat e tags (migration `20260602110000_pdf_proximity_chat_fcm_tags.sql`)

- **Colunas de idempotência** em `bookings` e `dependent_shipments`:
  - `driver_eta_5min_notified_at`
  - `driver_arrived_pickup_notified_at`  
  Evitam reenvio dos marcos “~5 min” e “motorista chegou”.

- **`should_notify_user`**: categorias `driver_eta_5min`, `driver_arrived_pickup`, `trip_eta_live` mapeadas para a preferência **`travel_updates`**.

- **“Motorista a caminho”**: triggers passam a incluir nos dados **`fcm_android_tag`** / **`fcm_collapse_key`** no formato `passenger_eta_{booking_id}` (e variantes para dependente / encomenda), para o mesmo *slot* visual receber atualizações de ETA.

- **Chat**: títulos variam conforme `conversation_kind` (ex.: viagem vs suporte).

- **Cliente — preparador**: notificações quando o preparador **inicia deslocamento** e **chega à coleta** (alinhado ao PDF de notificações).

### 1.4 Edge Function `notify-passenger-driver-proximity`

- **Rota:** `supabase/functions/notify-passenger-driver-proximity/index.ts`
- **Invocação:** cron (recomendado 2–3 min) com **service role** (`Authorization: Bearer <SERVICE_ROLE_KEY>`).
- **Comportamento:**
  1. **Marcos** (com INSERT em `notifications` + `should_notify_user`):  
     - *Motorista está a cerca de 5 minutos* (ETA linear ~4–8 min ao ponto de embarque);  
     - *Motorista chegou a você* (distância &lt; ~120 m ao embarque).
  2. **ETA ao vivo:** envio FCM **direto** (sem nova linha na inbox por tick), reutilizando a **mesma tag** que o disparo “Motorista a caminho” (`passenger_eta_<id>`), para atualizar o texto no Android.

- **Escopo v1:** `bookings` (status pago) e `dependent_shipments` (confirmados) com coordenadas de origem.

- Registo em **`supabase/config.toml`** na secção `[functions.notify-passenger-driver-proximity]`.

### 1.5 Apps — foreground

- **Cliente** — `apps/cliente/src/lib/foregroundNotificationHandler.ts`: em foreground, o FCM não mostra automaticamente o banner; o handler usa **Notifee** (`react-native-notify-kit`) para espelhar título/corpo/canal HIGH no Android.
- **Motorista** — `apps/motorista/src/lib/foregroundNotificationHandler.ts`: mesma ideia para consistência quando o app está aberto.

### 1.6 Tokens por perfil

- Continua a valer o modelo em **`profile_fcm_tokens`** + RPC `upsert_profile_fcm_token` e **`target_app_slug`** nas notificações (`cliente` vs `motorista`) para o dispatch acertar o destino.

---

## 2. Códigos de 4 dígitos — mudanças de regra de negócio

Referência conceitual: PDF interno *Sequência de Solicitação de Código* (cenários de viagem comum, dependente e encomenda com/sem base).

### 2.1 Viagem comum (`bookings`)

| Antes (evolução do sistema) | Depois (alinhado ao PDF) |
|------------------------------|---------------------------|
| Trigger gerava **`pickup_code`** e **`delivery_code`** (dois PINs distintos). | Migration **`20260603100000_bookings_remove_delivery_code_generation.sql`**: só se gera **`pickup_code`**. |
| | **`delivery_code`** na tabela **permanece** para histórico, marcada como **deprecated** — viagem comum tem **apenas 1 PIN (embarque)**; não há PIN de desembarque. |

### 2.2 Paradas no motorista — `complete_trip_stop`

- **`20260603110000_complete_trip_stop_dependent_pin_validation.sql`** — Validação **no servidor** para dependente: **`dependent_pickup`** e **`dependent_dropoff`** exigem PIN (códigos em `dependent_shipments`), corrigindo período em que só o app validava.

- **`20260603140000_complete_trip_stop_with_base_handoff.sql`** — Para **encomenda com base** na parada `shipment_pickup` / `package_pickup`: o PIN pode ser **`base_to_driver_code` (PIN C)** quando existe base; atualiza `picked_up_by_driver_from_base_at` quando aplicável. Mantém regras de passageiro (PIN só embarque), dependente (embarque + desembarque), encomenda (coleta e entrega conforme tipo).

- **`20260603130000_ensure_shipment_trip_stops_with_base.sql`** — Materialização de `trip_stops`: com base, o código da retirada na base é **`base_to_driver_code`** (PIN C), não `pickup_code`; entrega continua alinhada a **`delivery_code`** (PIN D no PDF).

### 2.3 Encomenda **com** base operacional — quatro handoffs (PIN A–D)

Migration **`20260603120000_shipments_handoff_codes.sql`** (e comentários nas colunas). Fluxo operacional alinhado ao Admin como **operador da base** para PIN B e PIN C — ver também [`codigos-pin-referencia.md`](./codigos-pin-referencia.md) §4.3.

| PIN | Significado | Quem valida / onde |
|-----|-------------|---------------------|
| **A** | Passageiro → Preparador | `passenger_to_preparer_code` — passageiro confirma no app cliente o código que o preparador obteve na coleta. |
| **B** | Preparador → Base | `preparer_to_base_code` — o **preparador vê o PIN no app** e informa verbalmente ao **Admin**; o Admin digita no painel (`complete_shipment_preparer_to_base_by_admin`). **Fallback:** `complete_shipment_preparer_to_base` (preparador digita) se a base/admin estiver indisponível. |
| **C** | Base → Motorista | `base_to_driver_code` — o **motorista mostra o PIN no app**; o **operador da base** (admin ou preparador com `worker_profiles.base_id` da mesma base) digita no painel Admin (`base_confirm_driver_pickup`), que grava `base_to_driver_confirmed_at`. O motorista conclui a parada com `complete_trip_stop` (sem enviar PIN). **`complete_shipment_base_to_driver_by_admin`** delega para a mesma RPC (só utilizadores `is_admin()`). |
| **D** | Motorista → Destinatário | `delivery_code` (já existente) — entrega final. |

Timestamps associados: `picked_up_by_preparer_at`, `delivered_to_base_at`, `base_to_driver_confirmed_at`, `picked_up_by_driver_from_base_at`.

Geração: trigger **`generate_shipment_codes`** estendido — para `base_id` preenchido, gera A/B/C **únicos** entre si e em relação a `pickup_code`/`delivery_code`.

### 2.4 RPCs de confirmação (preparador / passageiro / admin)

**`20260603150000_shipment_preparer_handoff_rpcs.sql`** (e extensões posteriores)

- **`complete_shipment_passenger_to_preparer`** — valida **PIN A** (passageiro digita o código informado pelo preparador).
- **`complete_shipment_preparer_to_base_by_admin`** (migration `20260604100000_shipment_admin_handoff_rpcs.sql`) — valida **PIN B** com utilizador **admin** (`is_admin()`); caminho principal quando a base opera pelo painel Admin.
- **`complete_shipment_preparer_to_base`** — valida **PIN B** pelo **preparador** (RPC legada; **fallback** operacional).
- **`complete_shipment_base_to_driver_by_admin`** — utilizador **admin** (`is_admin()`); delega para **`base_confirm_driver_pickup`** (valida PIN C e grava `base_to_driver_confirmed_at`). O motorista conclui a retirada com **`complete_trip_stop`**.
- **`base_confirm_driver_pickup`** (migration `20260608153000_base_confirm_driver_pickup.sql`) — valida **PIN C** por **admin** ou **preparador de encomendas** da mesma base (`worker_profiles.subtype = 'shipments'`, `base_id` = `shipments.base_id`). Não conclui `trip_stops`.
- **`complete_trip_stop`** (ramo `package_pickup` / encomenda com base) — exige **`base_to_driver_confirmed_at`** preenchido; o motorista não envia PIN C.

Documentação inline nas migrations aponta para o PDF cenário 3 (etapas 1–3 e 6–8); o modelo Admin + verbal foi consolidado em `codigos-pin-referencia.md`.

### 2.5 Dependente

- Continua a valer: PIN **no embarque e no desembarque** (`pickup_code` / `delivery_code` em `dependent_shipments`), coerente com o cenário 2 do PDF — consolidado na validação RPC `complete_trip_stop`.

### 2.6 Passageiro (viagem agregada)

- **Embarque:** PIN obrigatório (`bookings.pickup_code`).
- **Desembarque:** **sem PIN** (só marcar parada concluída).

---

## 3. Ficheiros e migrations citados (checklist)

| Área | Local |
|------|--------|
| FCM v1 partilhado | `supabase/functions/_shared/fcm_v1.ts` |
| Webhook → push | `supabase/functions/dispatch-notification-fcm/index.ts` |
| Proximidade + ETA live | `supabase/functions/notify-passenger-driver-proximity/index.ts` |
| Tags / proximidade / chat / preferências | `supabase/migrations/20260602110000_pdf_proximity_chat_fcm_tags.sql` |
| Bookings: remover geração de `delivery_code` | `supabase/migrations/20260603100000_bookings_remove_delivery_code_generation.sql` |
| PIN dependente no RPC | `supabase/migrations/20260603110000_complete_trip_stop_dependent_pin_validation.sql` |
| Colunas handoff A/B/C + geração | `supabase/migrations/20260603120000_shipments_handoff_codes.sql` |
| `trip_stops` + base / PIN C | `supabase/migrations/20260603130000_ensure_shipment_trip_stops_with_base.sql` |
| `complete_trip_stop` + confirmação PIN C pela base | `supabase/migrations/20260608153000_base_confirm_driver_pickup.sql` |
| RPCs PIN A e B | `supabase/migrations/20260603150000_shipment_preparer_handoff_rpcs.sql` |
| Foreground cliente | `apps/cliente/src/lib/foregroundNotificationHandler.ts` |
| Foreground motorista | `apps/motorista/src/lib/foregroundNotificationHandler.ts` |
| Cron / função | `supabase/config.toml` → `[functions.notify-passenger-driver-proximity]` |

---

## 4. Operação e segurança

- **Cron:** configurar no Supabase (ou scheduler externo) chamadas periódicas a **`notify-passenger-driver-proximity`** com service role.
- **Secrets:** credenciais Google (FCM v1) nas secrets das Edge Functions (`GOOGLE_PROJECT_ID`, `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`, etc.).
- **Tokens Mapbox / `.env.example`:** não commitar tokens reais; usar placeholders. O histórico do repositório foi saneado para cumprir *push protection* do GitHub — tokens que tenham sido expostos devem ser **revogados** no dashboard Mapbox.

---

## 5. Manutenção deste documento

Ao acrescentar triggers de notificação, novos PINs ou alterações em `complete_trip_stop`, atualizar este ficheiro e, quando fizer sentido, o [`notificacoes-apps-catalogo.md`](./notificacoes-apps-catalogo.md).

---

*Documento gerado para consolidar o pacote FCM + PINs (jun/2026).*
