# Take Me — PRD Completo do Admin Web

> **Versao:** 2.4 | **Data:** 14/04/2026 | **Status:** Implementado
> **Stack:** React 19 + React Router DOM 6 + Expo Web + Supabase + Mapbox GL + Google Maps (Places/Geocoding) + Recharts
> **Repositorio:** `github.com/takeme-app/admin` (raiz = app admin + `packages/shared`)
> **Rendering:** `React.createElement()` (sem JSX)
> **Estilizacao:** React.CSSProperties inline (webStyles.ts)
> **Workspace:** `@take-me/shared` em `packages/shared`

---

## 1. Visao Geral

O Take Me Admin e o painel de gestao interna da plataforma Take Me — uma plataforma brasileira de mobilidade e logistica interurbana que conecta passageiros, motoristas (frota propria e parceiros), preparadores de excursao, preparadores de encomendas e servicos de entrega.

### 1.1 Objetivos

- Centralizar a gestao operacional de viagens, encomendas, excursoes e pagamentos
- Fornecer visibilidade em tempo real sobre metricas-chave do negocio
- Administrar usuarios (passageiros, motoristas, preparadores)
- Gerenciar precificacao, rotas, promocoes e payouts (split de pagamentos)
- Oferecer canal de atendimento ao cliente integrado com chat em tempo real
- Controlar aprovacoes de cadastros de veiculos e dependentes menores
- Processar reembolsos via Stripe

### 1.2 Usuarios-Alvo

- Administradores da plataforma com `app_metadata.role = 'admin'` no Supabase Auth
- Permissoes granulares por modulo (Inicio, Viagens, Passageiros, Motoristas, Destinos, Encomendas, Preparadores, Promocoes, Pagamentos, Atendimentos, Configuracoes)

---

## 2. Autenticacao e Autorizacao

### 2.1 Autenticacao

| Aspecto | Detalhe |
|---------|---------|
| Provider | Supabase Auth (JWT) |
| Persistencia | `localStorage` no navegador |
| Refresh | Auto-refresh via `onAuthStateChange` |
| Telas publicas | Login, Signup, Forgot Password |

### 2.2 Autorizacao

- **Guard:** `ProtectedRoute` — verifica `app_metadata.role === 'admin'` no JWT
- **Fallback:** Mensagem "Acesso restrito" se o usuario nao for admin
- **Permissoes por modulo:** Cada admin possui um mapa `permissions: Record<string, boolean>` que controla acesso a modulos individuais
- **Funcao SQL:** `is_admin()` (security definer) — retorna `true` se JWT contem `app_metadata.role = admin`

### 2.3 Telas de Autenticacao

| Rota | Tela | Descricao |
|------|------|-----------|
| `/login` | WebLoginScreen | Email + senha |
| `/signup` | WebSignupScreen | Criacao de conta admin |
| `/forgot-password` | WebForgotPasswordScreen | Recuperacao de senha |

### 2.4 Regras de Negocio

- Quando o admin cadastra um membro da equipe do backoffice, o novo membro recebe por e-mail (Resend) as credenciais de acesso com uma senha aleatoria que pode ser trocada depois.
- Edge Function: `send-admin-credentials`

---

## 3. Navegacao e Layout

### 3.1 Layout Principal (`Layout.tsx`)

- **Navbar superior** com logo, tabs de navegacao e menu do usuario
- **Tabs responsivas** — abas que nao cabem aparecem num dropdown "Mais"
- **Menu do usuario** — Avatar, nome, email com opcoes: Atualizar senha, Atendimentos, Configuracoes, Sair
- **Scroll-to-top** automatico ao mudar de rota

### 3.2 Tabs de Navegacao (9 modulos)

| # | Tab | Rota |
|---|-----|------|
| 1 | Inicio | `/` |
| 2 | Viagens | `/viagens` |
| 3 | Passageiros | `/passageiros` |
| 4 | Motoristas | `/motoristas` |
| 5 | Destinos | `/destinos` |
| 6 | Encomendas | `/encomendas` |
| 7 | Preparadores | `/preparadores` |
| 8 | Promocoes | `/promocoes` |
| 9 | Pagamentos | `/pagamentos` |

**Acessiveis via menu do usuario:**
- Atendimentos (`/atendimentos`)
- Configuracoes (`/configuracoes`)

---

## 4. Telas e Funcionalidades

### 4.1 Inicio (Dashboard)

**Rota:** `/` | **Tela:** `HomeScreen`

- Toggle Viagens / Encomendas
- Cards de metricas clicaveis: Em andamento, Agendadas, Concluidas, Canceladas
- Filtro por periodo (data inicio / data fim)
- Filtro por categoria: Take Me vs. Motorista parceiro
- Lista de itens com busca textual
- Metricas financeiras: Pagamentos previstos, pagamentos feitos, lucro
- Grafico de pizza com **Recharts** (`PieChart`, `ResponsiveContainer`, tooltips): Receita total, taxas admin, motoristas/preparadores
- **Filtro por categoria de receita:** Todos, Passageiros, Encomendas
- Despesas aprovadas pelo backoffice

### 4.2 Viagens

#### 4.2.1 Lista de Viagens (`/viagens`)

- Tabela: Passageiro, Origem, Destino, Data, Embarque, Chegada, Status
- Busca por passageiro, motorista, origem, destino
- Filtro por status, periodo, categoria (Take Me / Parceiro)
- Cards de contagem clicaveis
- **Grafico de distribuicao por status** com **Recharts** (pie chart responsivo, alinhado ao dashboard)

#### 4.2.2 Detalhe da Viagem (`/viagens/:id`)

- **Mapa Mapbox:** modo estatico (Static Images API, estilo `light-v11`) ou GL interativo; marcadores customizados (origem/destino); opcional **rota** via **Mapbox Directions API** (`connectPoints`, perfis `driving` / `driving-traffic` / `walking` / `cycling`); fallback linha reta se Directions falhar
- **Coordenadas:** lat/lng do booking e, se ausentes, `scheduled_trips`; se ainda faltar ponto, **geocoding Google** (REST) quando `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` estiver definida — hook `useTripMapCoords`
- Timeline: Embarque, Origem, Destino, Ocupacao bagageiro, Chegada
- **Passageiros expandidos:** Nome, CPF, tamanho da mala (Pequena/Media/Grande), valor unitario calculado, botao chat
- **Motorista:** Nome, badge Take Me/Parceiro, avaliacao, viagens, lugares restantes, horarios, bagageiro
- **Encomendas vinculadas:** Foto, tamanho pacote, destinatario, recolha/entrega, contato, observacoes, valor
- Resumo: ID, Preco total, Data, Duracao, Valor unitario, Total passageiros, Despesas, KM
- Ocupacao e desempenho: Bagageiro %, Tempo total, Distancia
- Acoes: Editar, Historico, Trocar motorista, Ver NF, Recibo

#### 4.2.3 Historico da Viagem (`/viagens/:id/historico`)

- Timeline de eventos com status, label e timestamp (tabela `status_history`)

#### 4.2.4 Editar Viagem (`/viagens/:id/editar`)

- **Mapa do trajeto** (MapView GL com rota/Directions quando aplicavel)
- **Origem e destino:** `PlacesAddressInput` — autocompletar **Google Places** (script `maps/api/js` + `libraries=places`); ao escolher sugestao, grava endereco formatado e coordenadas via `onPlaceResolved`
- **Ao salvar:** geocoding Google (`geocodeAddress`) para origem/destino quando necessario para persistir lat/lng
- Coordenadas em tempo real no mapa via `useTripMapCoords` (Supabase + fallback Google)
- **Secao Veiculo:** Modelo, Placa, Ano (do veiculo do motorista)
- Campos editaveis: Origem, Destino, Horarios, Valor, Status, Ocupacao
- Add/remove passageiros (slide panel)
- Add/remove encomendas (slide panel)
- Selecao de motorista disponivel com radio buttons

### 4.3 Passageiros

#### 4.3.1 Lista (`/passageiros`)

- Tabela: Nome, Cidade, Estado, Data cadastro, CPF, Status, Avatar
- Cards demograficos: Genero (donut chart), Faixas etarias (donut chart)
- Filtro por status (Ativo/Inativo), periodo

#### 4.3.2 Detalhe (`/passageiros/:id`)

- Perfil: Nome, CPF, Telefone, Cidade, Estado, Avatar, Rating, Verificado
- **Historico de viagens** com colunas extras: Preco, Qtd passageiros, % bagageiro
- **Busca** por destino/origem no historico
- **Filtro por mes** (input type="month")
- Metricas: Viagens realizadas, Envios, Excursoes
- Dependentes: Lista com status (pending/validated), botao validar
- Metodos de pagamento: Lista + modal cadastrar

### 4.4 Motoristas

#### 4.4.1 Lista (`/motoristas`)

- Tabela: Nome, Total viagens, Ativas, Agendadas, Avaliacao
- Cards: Total, Quantidade no app, Parceiros, Avaliacao media
- **Filtro por categoria** (Take Me / Parceiro) aplicado na listagem
- Filtro por status, periodo

#### 4.4.2 Editar/Detalhe (`/motoristas/:id/editar`)

- Perfil + Worker Profile (subtipo, banco, PIX)
- Veiculos com fotos, RENAVAM, tipo de uso
- Documentos (CNH, background check)
- Acoes: Aprovar, Rejeitar, Suspender worker

### 4.5 Destinos (`/destinos`)

- Tabela: Origem, Destino, Total atividades, Status
- Metricas por rota: Em andamento, Agendadas, Concluidas, Canceladas
- Comparativo Take Me vs. Parceiro por rota
- Top 10 destinos mais procurados
- Filtro temporal, estado
- CRUD de Rotas Take Me (`takeme_routes`)

### 4.6 Encomendas

#### 4.6.1 Lista (`/encomendas`)

- Tabela unificada `shipments` + `dependent_shipments`
- Cards: Total entregas, Tipos pacote (pequeno/medio/grande com %), Top 10 destinos/origens
- Medias: Entregas/dia, Preco por tipo

#### 4.6.2 Editar (`/encomendas/:id/editar`)

- **Mapa Mapbox** em modo **estatico** (`staticMode: true`) com origem/destino derivados dos dados da encomenda (coordenadas validadas; `parseCoordPair` ignora `0,0` placeholder)
- Campos editaveis por tipo (shipment vs dependent_shipment)
- Selecao de motorista disponivel
- Resumo com status badge e rota

### 4.7 Preparadores

#### 4.7.1 Lista (`/preparadores`)

- Duas abas: Preparador de encomendas / Preparador de excursoes
- Cards por aba: Total, A preparar, Avaliacao media
- Filtro por status, periodo

#### 4.7.2 Editar Excursao (`/preparadores/:id/editar`)

- Informacoes gerais, equipes necessarias, cliente, preparador
- **Passageiros com check-in/check-out:** Botoes que atualizam `excursion_passengers.status_departure/return`
- **Ordenacao por idade:** Toggle para ordenar lista de passageiros
- Orcamento: Linhas editaveis (budget_lines JSONB)
- Candidatos: Lista de preparadores disponiveis
- Status: Timeline de mudancas
- Toast de feedback para acoes

### 4.8 Promocoes

#### 4.8.1 Lista (`/promocoes`)

- Tabela: Nome, Inicio, Termino, Publico, Status, **Acoes**
- Cards: Total, Ativas, Inativas
- Filtro por status, periodo
- **Acao Duplicar:** Botao em cada linha que copia a promocao

#### 4.8.2 Criar (`/promocoes/nova`)

- Campos: Titulo, Descricao, Datas, Publico-alvo, Tipo desconto, Valor, Aplica-se a, Ativo

### 4.9 Pagamentos

#### 4.9.1 Visao Geral (`/pagamentos`)

- Cards: Pagamentos previstos, Feitos, Lucro
- Listagem de payouts com filtros

#### 4.9.2 Gestao (`/pagamentos/gestao`)

- Abas: Motoristas, Preparadores Excursoes, Preparadores Encomendas
- CRUD de pricing routes com surcharges

#### 4.9.3 Criar Trecho (`/pagamentos/gestao/criar-trecho`)

- Tipo, Titulo, Origem, Destino, Modo preco, Percentuais, Metodos pagamento

#### 4.9.4-5 Detalhes por Worker (`/pagamentos/gestao/motorista/:slug`, `.../preparador-encomendas/:slug`)

- Perfil com dados bancarios, historico payouts, rotas, sobretaxas

### 4.10 Atendimentos

#### 4.10.1 Lista (`/atendimentos`)

- Toggle Online/Offline/Ausente com horario automatico
- **3 secoes:**
  - **Visao geral:** Cards tempo real (viagens, motoristas ativos, cancelamentos, encomendas)
  - **Gestao de cadastros e pedidos:** Cards por categoria (Excursao, Encomendas, Reembolso, Cadastro transporte, Autorizar menores, Denuncia, Ouvidoria, Outros) com contagem e filtro clicavel
  - **Atendimentos:** Cards por status (Todos, Nao atendida, Em atendimento, Atrasada, Ouvidoria, Denuncia, Finalizada)
- **SLA:** Conversas sem admin atribuido = "Nao atendida"; ativas > 24h = "Atrasada"
- Filtro "Meu atendimento" vs "Atendimento geral"

#### 4.10.2 Detalhe (`/atendimentos/:id`)

- **ChatPanel com Supabase Realtime:** Mensagens em tempo real, suporte a PDF e imagem (Storage bucket `chat-attachments`)
- Action chips: Dados cadastrais, Documentos, Encomendas, Viagens, Pagamentos, Solicitacao, **Reembolso, Veiculo, Menores**
- **Reembolso:** Modal para selecionar tipo entidade + ID, processa via Edge Function `process-refund` (Stripe)
- **Autorizacao de veiculo:** Modal busca veiculo pendente, botoes Aprovar/Rejeitar (atualiza `vehicles.status`)
- **Autorizacao de menores:** Modal busca dependente pendente, botoes Autorizar/Negar (atualiza `dependents.status`)
- Historico de atendimentos anteriores
- Editar status, Finalizar atendimento com observacao

#### 4.10.3 Elaborar Orcamento (`/atendimentos/:id/orcamento`)

- Formulario: Linhas de itens (equipe, basicos, servicos, recreacao, desconto), total automatico

### 4.11 Notificacoes (`/notificacoes`)

- CRUD na tabela `notifications`
- Broadcast limitado a perfis especificos
- Campos: titulo, mensagem, categoria, usuario-alvo
- Listagem com filtros e busca

### 4.12 Avaliacoes (`/avaliacoes`)

- Listagem unificada de `booking_ratings` e `shipment_ratings`
- Moderacao: exclusao de avaliacoes inapropriadas
- Filtros por tipo (viagem/envio), periodo, nota

### 4.13 Analytics (`/analytics`)

- Dados agregados de `bookings`, `profiles`, `worker_profiles`, `shipments`, `booking_ratings`
- Metricas: total de reservas, usuarios ativos, workers ativos, envios, media de avaliacoes
- Filtros por periodo

### 4.14 Configuracoes (`/configuracoes`)

#### Tab Perfil

- Nome, Email, Nivel de acesso, Alterar senha, Avatar

#### Tab Usuarios Admin

- Listagem: Nome, Email, Permissao, Data criacao, Status
- Criar admin: Nome, Email, Permissoes por modulo + **envio de credenciais por email** (Edge Function `send-admin-credentials`)
- Editar permissoes, Excluir admin

#### Tab Plataforma

- **Preco da gasolina** (R$/litro) — editavel, salva em `platform_settings` (key: `gas_price_cents`)
- **Preco do KM rodado** (R$/km) — editavel, salva em `platform_settings` (key: `km_price_cents`)
- **Taxa administrativa padrao** — `default_admin_pct` em `platform_settings`
- Hook `usePlatformSettings` para leitura/escrita

---

## 5. Mapa Completo de Rotas

### 5.1 Rotas Publicas (3)

| # | Rota | Tela | Modulo |
|---|------|------|--------|
| 1 | `/login` | WebLoginScreen | Auth |
| 2 | `/signup` | WebSignupScreen | Auth |
| 3 | `/forgot-password` | WebForgotPasswordScreen | Auth |

### 5.2 Rotas Protegidas — Principais (28)

| # | Rota | Tela | Modulo |
|---|------|------|--------|
| 4 | `/` | HomeScreen | Dashboard |
| 5 | `/viagens` | ViagensScreen | Viagens |
| 6 | `/viagens/:id` | ViagemDetalheScreen | Viagens |
| 7 | `/viagens/:id/historico` | HistoricoViagensScreen | Viagens |
| 8 | `/viagens/:id/editar` | ViagemEditScreen | Viagens |
| 9 | `/passageiros` | PassageirosScreen | Passageiros |
| 10 | `/passageiros/:id` | PassageiroDetalheScreen | Passageiros |
| 11 | `/motoristas` | MotoristasScreen | Motoristas |
| 12 | `/motoristas/:id` | MotoristaEditScreen | Motoristas |
| 13 | `/motoristas/:id/editar` | MotoristaEditScreen | Motoristas |
| 14 | `/destinos` | DestinosScreen | Destinos |
| 15 | `/encomendas` | EncomendasScreen | Encomendas |
| 16 | `/encomendas/:id/editar` | EncomendaEditScreen | Encomendas |
| 17 | `/preparadores` | PreparadoresScreen | Preparadores |
| 18 | `/preparadores/:id` | PreparadorEditScreen | Preparadores |
| 19 | `/preparadores/:id/editar` | PreparadorEditScreen | Preparadores |
| 20 | `/promocoes` | PromocoesScreen | Promocoes |
| 21 | `/promocoes/nova` | PromocaoCreateScreen | Promocoes |
| 22 | `/promocoes/:id/editar` | PromocaoCreateScreen | Promocoes |
| 23 | `/pagamentos` | PagamentosScreen | Pagamentos |
| 24 | `/pagamentos/gestao` | PagamentosGestaoScreen | Pagamentos |
| 25 | `/pagamentos/gestao/criar-trecho` | PagamentoCriarTrechoScreen | Pagamentos |
| 26 | `/pagamentos/gestao/motorista/:slug` | PagamentoMotoristaDetailScreen | Pagamentos |
| 27 | `/pagamentos/gestao/preparador-encomendas/:slug` | PagamentoPreparadorEncomendaDetailScreen | Pagamentos |
| 28 | `/atendimentos` | AtendimentosScreen | Atendimentos |
| 29 | `/atendimentos/:id` | AtendimentoDetalheScreen | Atendimentos |
| 30 | `/atendimentos/:id/orcamento` | ElaborarOrcamentoScreen | Atendimentos |
| 31 | `/notificacoes` | NotificacoesScreen | Notificacoes |
| 32 | `/avaliacoes` | AvaliacoesScreen | Avaliacoes |
| 33 | `/analytics` | AnalyticsScreen | Analytics |
| 34 | `/configuracoes` | ConfiguracoesScreen | Configuracoes |

### 5.3 Rotas Contextuais (navegacao cruzada entre modulos)

Reutilizam telas existentes para manter contexto de origem (`location.state.from` no Layout):

| # | Rota | Tela | Contexto |
|---|------|------|----------|
| 35 | `/motoristas/:mid/viagem/:id` | ViagemDetalheScreen | Viagem via motorista |
| 36 | `/motoristas/:mid/viagem/:id/historico` | HistoricoViagensScreen | Historico via motorista |
| 37 | `/passageiros/:pid/viagem/:id` | ViagemDetalheScreen | Viagem via passageiro |
| 38 | `/passageiros/:pid/viagem/:id/editar` | ViagemEditScreen | Editar via passageiro |
| 39 | `/passageiros/:pid/viagem/:id/historico` | HistoricoViagensScreen | Historico via passageiro |
| 40 | `/encomendas/:eid/viagem/:id` | ViagemDetalheScreen | Viagem via encomenda |
| 41 | `/preparadores/:pid/viagem/:id` | ViagemDetalheScreen | Viagem via preparador |

**Total: 41 rotas (3 publicas + 31 protegidas principais + 7 contextuais)**

---

## 6. Modelo de Dados

### 6.1 Tabelas Principais

| Tabela | Descricao |
|--------|-----------|
| `profiles` | Perfis de usuario (1:1 com auth.users): full_name, cpf, city, state, rating, verified, stripe_customer_id |
| `worker_profiles` | Workers: role (driver/preparer), subtype, status (inactive/pending/under_review/approved/rejected/suspended), dados bancarios, PIX |
| `vehicles` | Veiculos: model, plate, year, capacity, renavam, use_type (principal/reserva), photos, status (pending/approved/rejected) |
| `worker_assignments` | Atribuicoes: worker_id, entity_type, entity_id, status (assigned/accepted/in_progress/completed/cancelled/rejected/expired), expires_at |
| `worker_ratings` | Avaliacoes: worker_id, rated_by, entity_type, entity_id, rating (1-5), comment |
| `scheduled_trips` | Viagens: origin/destination (endereco + lat/lng), departure_at, arrival_at, seats/bags_available, trunk_occupancy_pct, status |
| `bookings` | Reservas: user_id, scheduled_trip_id, passenger_data (JSONB), amount_cents, status, stripe_payment_intent_id |
| `shipments` | Encomendas: package_size, recipient_name/email/phone, pickup/delivery_code, status, stripe_payment_intent_id |
| `dependent_shipments` | Encomendas de dependentes: similar + dependent_id, stripe_payment_intent_id |
| `excursion_requests` | Excursoes: destination, people_count, fleet_type, budget_lines (JSONB), status, stripe_payment_intent_id |
| `excursion_passengers` | Participantes: full_name, cpf, phone, age, gender, status_departure, status_return |
| `promotions` | Promocoes: title, start/end_at, target_audiences[], discount_type/value, applies_to[], is_active |
| `pricing_routes` | Precificacao: role_type, pricing_mode, price_cents, driver_pct, admin_pct, accepted_payment_methods[] |
| `surcharge_catalog` | Adicionais globais: name, default_value_cents, surcharge_mode (automatic/manual) |
| `pricing_route_surcharges` | N:N trechos <> adicionais: pricing_route_id, surcharge_id, value_cents (override) |
| `payouts` | Pagamentos: worker_id, entity_type, gross/worker/admin_amount_cents, payout_method, status |
| `conversations` | Chat/suporte: driver_id, client_id, admin_id, category, sla_deadline_at, last_message, unread counts |
| `messages` | Mensagens: sender_id, content, attachment_url, attachment_type (pdf/image), read_at |
| `platform_settings` | Configuracoes editaveis: key (unique), value (JSONB) — gas_price_cents, km_price_cents |
| `bases` | Hubs: name, address, city, lat/lng, is_active |
| `takeme_routes` | Rotas proprias: origin/destination_address, price_per_person_cents |
| `worker_routes` | Rotas workers: origin/destination, price, surcharges |
| `status_history` | Auditoria: entity_type, entity_id, status, label, changed_by, changed_at |
| `dependents` | Dependentes: full_name, age, document_url, status (pending/validated) |
| `notifications` | Notificacoes: user_id, title, message, category, read_at |
| `trip_stops` | Paradas ordenadas de uma viagem: scheduled_trip_id, stop_type (driver_origin/passenger_pickup/shipment_pickup/base_dropoff/trip_destination), entity_id, label, address, lat/lng, sequence_order, status (pending/arrived/completed/skipped) |
| `promotion_adhesions` | Adesoes a promocoes: promotion_id, entity_type, entity_id, discount_cents, created_at |
| `worker_weekly_price_adjustments` | Ajustes semanais de preco por worker: worker_id, week_start, adjustment_pct |
| `booking_ratings` | Avaliacoes de viagem pelo passageiro: booking_id, rating (1-5), comment |
| `shipment_ratings` | Avaliacoes de envio pelo cliente: shipment_id, rating (1-5), comment |
| `trip_ratings` | Avaliacoes de viagem pelo motorista: trip_id, rating (1-5), comment |
| `shipment_driver_ratings` | Avaliacoes do remetente pelo motorista: shipment_id, rating (1-5) |

### 6.2 Views SQL

| View | Descricao |
|------|-----------|
| `admin_dashboard_stats` | Metricas agregadas do mes (bookings, shipments, revenue, workers ativos) |
| `admin_destinos_overview` | Agregacao de rotas (trip_count, avg_price, status breakdown, takeme/partner count) |
| `admin_worker_overview` | Performance workers (total_payouts, avg_rating, earned/admin cents) |
| `admin_passenger_demographics` | Dados demograficos (genero %, faixas etarias, total, verified) |
| `admin_encomenda_stats` | Estatisticas encomendas (totais por tamanho, preco medio, entregas/dia) |
| `admin_promotion_adhesion` | Uso de promocoes por entidade (bookings, shipments, excursions usando cada promo) |
| `driver_conversations` | Conversas na perspectiva do motorista |

### 6.3 Functions Paginadas (para tabelas > 5000 itens)

| Function | Descricao |
|----------|-----------|
| `admin_list_bookings(status, date_from, date_to, search, limit, offset)` | Listagem paginada de bookings com joins |
| `admin_list_encomendas(status, date_from, date_to, search, limit, offset)` | Listagem paginada shipments + dependent_shipments |
| `admin_top_encomenda_destinations(limit)` | Top destinos de encomendas |
| `admin_approved_expenses_cents()` | Soma total de despesas aprovadas (payouts pagos) sem limite |
| `nearest_active_base(lat, lng)` | Retorna base ativa mais proxima de um ponto (para encomendas via moto) |
| `generate_trip_stops(trip_id)` | Gera paradas ordenadas por distancia (motorista → passageiros → encomendas → destino) |

### 6.4 Status Flows

**Booking:** `pending -> confirmed -> paid -> (completed) / cancelled`

**Shipment:** `pending_review -> confirmed -> in_progress -> delivered / cancelled`

**Excursion:** `pending -> contacted -> quoted -> in_analysis -> approved -> scheduled -> in_progress -> completed / cancelled`

**Payout:** `pending -> processing -> paid / failed`

**Worker Assignment:** `assigned -> accepted -> in_progress -> completed / cancelled / rejected / expired`

**Vehicle:** `pending -> approved / rejected`

**Dependent:** `pending -> validated`

### 6.5 Regras de Negocio de Viagens e Rotas Multi-Ponto

**Como funciona uma viagem:**
1. O **motorista** cria e planeja sua rota: Ponto A (bairro/cidade origem) → Ponto B (bairro/cidade destino)
2. **Passageiros** compram passagem com seus proprios enderecos de embarque (diferentes do ponto A do motorista)
3. O mapa exibe TODOS os pontos (motorista + passageiros + encomendas) **ordenados por distancia** da origem
4. A rota e **recalculada automaticamente** quando o motorista e trocado

**Tabela `trip_stops`:** Armazena as paradas ordenadas de cada viagem. Gerada automaticamente pela function `generate_trip_stops()` que:
- Cria ponto 0 (driver_origin) com endereco do motorista
- Adiciona passenger_pickup para cada booking, ordenados por distancia da origem
- Adiciona shipment_pickup para cada encomenda vinculada
- Cria ponto final (trip_destination)

**Cenarios de Encomenda:**

| Cenario | Tipo Motorista | Fluxo de Paradas |
|---------|---------------|-----------------|
| 1 | Moto / Preparador encomenda | Motorista → Cliente (pickup) → Base Take Me mais proxima (dropoff) → Entrega final pela base |
| 2 | Carro Take Me / Parceiro | Motorista → Cliente (pickup) → Destino da encomenda (dropoff direto, sem base) |

**Functions de apoio:**
- `createShipmentTripViaBase(shipmentId, driverId)` — Cenario 1
- `createShipmentTripDirect(shipmentId, driverId)` — Cenario 2
- `linkShipmentToTrip(shipmentId, tripId)` — Vincula encomenda a viagem existente
- `recalculateTripStops(tripId)` — Regenera stops (ex: apos trocar motorista)
- `nearest_active_base(lat, lng)` — Retorna base mais proxima

**MapView multi-ponto:** Suporta prop `waypoints: MapWaypoint[]` com markers numerados e coloridos por tipo:
- Preto (#0d0d0d): Motorista
- Azul (#3b82f6): Passageiro
- Laranja (#f59e0b): Encomenda
- Verde (#22c55e): Base
- Vermelho (#ef4444): Destino

---

## 7. Edge Functions (Backend)

| Funcao | Descricao | Metodos |
|--------|-----------|---------|
| `manage-promotions` | CRUD de promocoes | POST, PATCH, DELETE |
| `manage-pricing-routes` | CRUD de rotas de preco com adicionais | POST, PATCH, DELETE |
| `manage-excursion-budget` | Criar/finalizar orcamento de excursao | POST |
| `manage-admin-users` | CRUD de usuarios admin com permissoes | POST, PATCH, DELETE |
| `send-admin-credentials` | Envia email com credenciais de acesso ao novo admin (Resend) | POST |
| `process-refund` | Estorno integral ou parcial via Stripe Refunds (acionado pelo admin em Atendimentos) | POST |
| `refund-shipment-no-driver` | Estorno automatico quando nenhum motorista aceita a encomenda | POST |
| `expire-assignments` | Expira assignments pendentes (cron 5 min); encadeia `process-refund` | POST |
| `charge-booking` | Cobra booking via Stripe PaymentIntent (modo draft: cobra antes de inserir); aplica split Connect via `transfer_data` quando o motorista possui `stripe_connect_account_id` | POST |
| `charge-shipments` | Cobra `shipments` ou `dependent_shipments` via PaymentIntent e grava `stripe_payment_intent_id`. Folder local em `supabase/functions/charge-shipments/`, alinhado ao slug publicado | POST |
| `stripe-webhook` | Recebe eventos Stripe (`payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `account.updated`) e reconcilia reservas/envios/Connect | POST |
| `stripe-connect-link` | Gera `account_links` para onboarding Stripe Connect Express BR (motorista/preparador) | POST |
| `process-payouts` | Processa lote de `payouts` pendentes: workers com Connect sao marcados `paid` (ja transferido no charge); demais viram `processing` para pagamento manual via PIX | POST |
| `confirm-code` | Verifica codigos de pickup/delivery | POST |
| `ensure-stripe-customer` | Cria/busca customer Stripe | POST |
| `save-payment-method` | Salva cartao no Stripe | POST |
| `geocode` | Geocoding via Nominatim (Edge; outros clientes) | POST |
| `send-email-verification-code` | OTP 4 digitos para cadastro | POST |
| `create-motorista-account` | Cadastro completo de motorista | POST |

**Nota (admin web):** autocomplete e geocoding de enderecos no painel usam as APIs Google no browser (ver secoes 9.0–9.2), nao a Edge Function `geocode`.

---

## 8. Componentes Reutilizaveis

| Componente | Descricao | Usado em |
|------------|-----------|----------|
| `MapView.tsx` | Mapbox GL (`mapbox-gl`): estatico ou interativo; Directions v5 multi-waypoint (ate 25 pontos); props `origin`, `destination`, `waypoints: MapWaypoint[]` (markers numerados coloridos por tipo), `connectPoints`, `directionsProfile`, `currentPosition` | Viagens detalhe/edit, Encomendas edit |
| `PlacesAddressInput.tsx` | Campo endereco com sugestoes **Google Places** (load async do JS API); sem chave, comporta-se como input texto simples | Viagem editar |
| `useTripMapCoords` | Resolve `origin`/`destination` para o mapa: booking → `scheduled_trips` → **Google Geocoding** se necessario | Viagem detalhe, Viagem editar |
| `googleGeocoding.ts` | `geocodeAddress()` — REST Geocoding API, `region=br` | Salvamento e hook de mapa |
| `mapCoordUtils.ts` | `parseCoordPair` — valida lat/lng e descarta `0,0` | Mapas e forms |
| `expoExtra.ts` | `getExpoExtra`, `getMapboxAccessToken`, `getGoogleMapsApiKey` — leem `Constants.expoConfig.extra` com fallback `process.env` (Metro local) | Mapas e Places |
| `ChatPanel.tsx` | Chat com Supabase Realtime, bolhas, anexos PDF/imagem, auto-scroll | Atendimentos detalhe |
| `FileUpload.tsx` | Drag & drop de PDF/imagem para Supabase Storage (bucket chat-attachments) | ChatPanel |
| `useRealtimeMessages` | Hook com subscription Realtime em `messages`, send, markAsRead | ChatPanel |
| `usePlatformSettings` | Hook para ler/salvar configs em `platform_settings` | Configuracoes, Destinos |
| `useTripStops` | Hook que busca/gera/ordena paradas de uma viagem (trip_stops). Retorna `stops`, `waypoints` (para MapView) e `regenerate()`. Gera automaticamente via `generate_trip_stops()` se nao existirem | Viagem detalhe, Viagem editar |
| `Layout.tsx` | Navbar responsiva com tabs overflow | Todas as telas |
| `ProtectedRoute.tsx` | Guard de autenticacao + verificacao admin | Router |
| `EditarTabelaTrechoModal.tsx` | Modal para editar tabela de precos | Pagamentos gestao |
| `EditarFormaPagamentoTrechoModal.tsx` | Modal para editar metodos de pagamento | Pagamentos gestao |

---

## 9. Integracoes e Infraestrutura

### 9.0 Configuracao de ambiente (Admin Web)

- **`app.config.js`:** carrega `.env` com `dotenv` no Node (local e deploy, ex.: Vercel) e injeta em `expo.extra` para o bundle web nao depender de `process.env` vazio no cliente.
- **Chaves expostas ao cliente (prefixo `EXPO_PUBLIC_`):**
  - `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`
  - `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` — mapas estaticos/GL e Directions (restringir token por URL no dashboard Mapbox)
  - `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` — **Places API** (autocomplete) e **Geocoding API** (geocode ao salvar / fallback no mapa); restringir por referrer HTTP no Google Cloud
- **Referencia:** `apps/admin/.env.example` documenta cada variavel e testes E2E (`E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD`, opcional `E2E_REQUIRE_DB_ROWS`).

### 9.1 Mapbox (uso no admin)

| Recurso | Uso |
|---------|-----|
| **mapbox-gl** (npm) | Mapa interativo, marcadores HTML custom, camadas de linha (rota) |
| **Static Images API** | Vista rapida sem WebGL (`staticMode: true`) — estilo `light-v11`, padding para atribuicao |
| **Directions API v5** | Geometria `polyline` entre origem e destino; fallback reta se `code !== Ok` ou sem token |
| **Token** | `getMapboxAccessToken()` em `expoExtra.ts` |

### 9.2 Google Maps (uso no admin)

| Recurso | Uso |
|---------|-----|
| **Places Library** (JS loader) | Sugestoes em `PlacesAddressInput`; session token; debounce |
| **Geocoding API** (JSON REST) | `googleGeocoding.geocodeAddress` — endereco → lat/lng + `formatted_address` |
| **Sem chave** | Places vira input simples; mapa de viagem ainda usa coords de BD quando existem |

### 9.3 Graficos (Recharts)

| Uso | Tela |
|-----|------|
| **recharts** v3 | `PieChart`, `Pie`, `Cell`, `Tooltip`, `ResponsiveContainer` via `require('recharts')` (compativel com bundle sem JSX) |
| Distribuicao de receita (categorias) | `HomeScreen` |
| Distribuicao por status de viagem | `ViagensScreen` |

### 9.4 Stack Tecnica

| Camada | Tecnologia |
|--------|------------|
| Frontend | React 19 + React Router DOM 6 + Expo Web |
| Estilizacao | React.CSSProperties inline (webStyles.ts) |
| Backend | Supabase (Postgres + Auth + Edge Functions + Storage + Realtime) |
| Rendering | `React.createElement()` (sem JSX) |
| Monorepo | `@take-me/shared` (Supabase client compartilhado) |
| Pagamentos | Stripe (Customers, PaymentMethods, PaymentIntents, Refunds) |
| Mapas | **Mapbox GL JS** + Static Images + Directions; **Google Maps** (Places + Geocoding) para enderecos e fallback de coordenadas |
| Graficos | **Recharts** 3.x |
| E-mails | Resend (transacionais) |
| Testes | Playwright (E2E) |

### 9.5 Supabase Storage Buckets

| Bucket | Uso |
|--------|-----|
| `avatars` | Fotos de perfil |
| `dependent-documents` | Documentos de dependentes |
| `shipment-photos` | Fotos de encomendas |
| `driver-documents` | CNH, background check, docs de veiculos |
| `excursion-passenger-docs` | Documentos de participantes de excursao |
| `chat-attachments` | PDFs e imagens enviados no chat de atendimento (max 10MB) |

### 9.6 Seguranca (RLS)

- Todas as tabelas possuem Row Level Security ativado
- Funcao `is_admin()` (security definer) verifica `app_metadata.role`
- Admins tem acesso de leitura a todas as tabelas
- Admins tem acesso de escrita a: excursion_requests, worker_profiles, profiles, vehicles, payouts, platform_settings
- Dados sensiveis (PIX, banco) visiveis apenas para admin
- Storage: authenticated upload, public read para chat-attachments

---

## 10. Testes

### 10.1 E2E (Playwright)

- `smoke.spec.ts` — Verifica que o app carrega e redireciona
- `auth.setup.ts` — Setup de autenticacao para testes
- `home-stats.spec.ts` — Valida metricas do dashboard
- `admin-lists-data-filters.spec.ts` — Valida filtros em todas as listas

---

## 11. Glossario

| Termo | Descricao |
|-------|-----------|
| **Take Me** | Frota propria da plataforma |
| **Motorista parceiro** | Motorista terceiro (worker_profiles.subtype = 'partner') |
| **Preparador** | Profissional que organiza excursoes ou encomendas |
| **Payout** | Pagamento feito ao worker (motorista ou preparador) |
| **Pricing Route** | Configuracao de preco para uma rota/trecho |
| **Surcharge** | Sobretaxa (ex: pedagio, horario noturno, feriado) |
| **Badge** | Marcador visual — "Take Me" para frota propria |
| **Trunk Occupancy** | Percentual de ocupacao do porta-malas (0-100%) |
| **Budget Lines** | Linhas de orcamento de uma excursao (JSONB) |
| **Dependent Shipment** | Transporte em nome de um dependente do usuario |
| **SLA** | Tempo maximo de 1 dia para atendimento no backoffice |
| **Check-in/Check-out** | Validacao de embarque/desembarque pelo preparador de excursao |
| **Platform Settings** | Configuracoes editaveis (preco gasolina, km/h) armazenadas na tabela `platform_settings` |
