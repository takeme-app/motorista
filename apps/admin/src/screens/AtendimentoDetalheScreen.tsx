/**
 * AtendimentoDetalheScreen — Tela de atendimento individual conforme Figma 1425-21190 / 1429-33119 / 1430-34188.
 * Uses React.createElement() calls (NOT JSX).
 */
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { resolveStorageDisplayUrl } from '../lib/storageDisplayUrl';
import { useAuth } from '../contexts/AuthContext';
import ChatPanel from '../components/ChatPanel';
import {
  invokeEdgeFunction,
  fetchSupportConversationDetail,
  fetchSupportHistoryForClient,
  fetchProfileBasics,
  fetchBookingDetailForAdmin,
  updateWorkerStatus,
  updateShipmentStatus,
  updateDependentShipmentStatus,
} from '../data/queries';

const font: React.CSSProperties = { fontFamily: 'Inter, sans-serif' };

// ── Arrow left SVG ──────────────────────────────────────────────────────
const arrowLeftSvg = React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M19 12H5M12 19l-7-7 7-7', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));

// ── Pencil SVG ──────────────────────────────────────────────────────────
const pencilSvg = React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }),
  React.createElement('path', { d: 'M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));

// ── Refresh SVG ─────────────────────────────────────────────────────────
const refreshSvg = React.createElement('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M23 4v6h-6M1 20v-6h6', stroke: '#fff', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }),
  React.createElement('path', { d: 'M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15', stroke: '#fff', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));

// ── Toggle chat SVG (chevron up/down) ────────────────────────────────────
const chatToggleUpSvg = React.createElement('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M18 15l-6-6-6 6', stroke: '#fff', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
const chatToggleDownSvg = React.createElement('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M6 9l6 6 6-6', stroke: '#fff', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));

function supportActionChipsForCategory(raw: string | null | undefined, wSubtype?: string | null): string[] {
  const c = String(raw || '').toLowerCase();
  if (c === 'excursao') return ['Dados cadastrais', 'Documentos', 'Viagens', 'Pagamentos', 'Solicitação'];
  if (c === 'encomendas') return ['Dados cadastrais', 'Encomendas'];
  if (c === 'reembolso') return ['Pagamentos', 'Reembolso', 'Viagens', 'Solicitação'];
  if (c === 'cadastro_transporte') {
    // Preparador de excursão não tem veículo
    if (wSubtype === 'excursions') return ['Dados cadastrais', 'Documentos'];
    // Takeme, partner, shipments — têm veículo
    return ['Dados cadastrais', 'Documentos', 'Veículo'];
  }
  if (c === 'autorizar_menores') return ['Dados cadastrais', 'Menores', 'Documentos'];
  if (c === 'ouvidoria' || c === 'denuncia') return ['Dados cadastrais', 'Viagens'];
  if (c === 'outros') return ['Dados cadastrais', 'Solicitação'];
  return ['Dados cadastrais', 'Documentos', 'Encomendas', 'Viagens', 'Pagamentos', 'Solicitação'];
}

const categoryLabelPt: Record<string, string> = {
  excursao: 'Excursão',
  encomendas: 'Encomendas',
  reembolso: 'Reembolso',
  cadastro_transporte: 'Cadastro de transporte',
  autorizar_menores: 'Autorizar menores',
  denuncia: 'Denúncia',
  ouvidoria: 'Ouvidoria',
  outros: 'Outros',
};

export default function AtendimentoDetalheScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id: conversationId } = useParams<{ id: string }>();
  const ticket = (location.state as any)?.ticket || {};
  const [orcamentoCriado, setOrcamentoCriado] = useState(false);
  const [orcamentoValor] = useState('R$ 5.000,00');

  // ── Fetch real messages from Supabase ────────────────────────────────
  const [realMessages, setRealMessages] = useState<{ sender: string; content: string; time: string }[]>([]);
  const [convStatus, setConvStatus] = useState<'active' | 'closed'>('active');
  useEffect(() => {
    if (!isSupabaseConfigured || !conversationId) return;
    let cancelled = false;
    // Fetch conversation
    (supabase as any).from('conversations').select('status, participant_name').eq('id', conversationId).single()
      .then(({ data }: { data: { status: 'active' | 'closed' } | null }) => { if (!cancelled && data) setConvStatus(data.status); });
    // Fetch messages
    (supabase as any).from('messages').select('id, sender_id, content, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(50)
      .then(({ data }: { data: any[] | null }) => {
        if (cancelled || !data) return;
        setRealMessages(data.map((m: any) => ({
          sender: m.sender_id?.slice(0, 8) || 'User',
          content: m.content,
          time: new Date(m.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        })));
      });
    return () => { cancelled = true; };
  }, [conversationId]);

  const handleCloseConversation = useCallback(async () => {
    if (!isSupabaseConfigured || !conversationId) return;
    await (supabase as any).from('conversations').update({ status: 'closed', updated_at: new Date().toISOString() }).eq('id', conversationId);
    setConvStatus('closed');
  }, [conversationId]);

  const { session } = useAuth();
  const currentUserId = session?.user?.id || '';

  // ── Specialized form states ──────────────────────────────────────────
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundEntityType, setRefundEntityType] = useState('booking');
  const [refundEntityId, setRefundEntityId] = useState('');
  const [refundProcessing, setRefundProcessing] = useState(false);

  const [vehicleAuthOpen, setVehicleAuthOpen] = useState(false);
  const [vehicleData, setVehicleData] = useState<any>(null);

  const [minorAuthOpen, setMinorAuthOpen] = useState(false);
  const [minorData, setMinorData] = useState<any>(null);

  const labelToRaw = (lab: string) => {
    const e = Object.entries(categoryLabelPt).find(([, v]) => v === lab);
    return e ? e[0] : 'outros';
  };

  const [nome, setNome] = useState(ticket.nome || '—');
  const [email, setEmail] = useState(ticket.email || '—');
  const [profileCpf, setProfileCpf] = useState('—');
  const [profilePhone, setProfilePhone] = useState('—');
  const [profileCity, setProfileCity] = useState('—');
  const [profileState, setProfileState] = useState('—');
  const [categoria, setCategoria] = useState(ticket.categoria || 'Outros');
  const [rawCategory, setRawCategory] = useState<string>(ticket.rawCategory || labelToRaw(ticket.categoria || 'Outros'));
  const [trechoLinha, setTrechoLinha] = useState('—');
  const [periodoLinha, setPeriodoLinha] = useState('—');
  const [viagemRefLinha, setViagemRefLinha] = useState('—');
  const [viagemStatusLinha, setViagemStatusLinha] = useState('—');
  const [atendenteNome, setAtendenteNome] = useState('Não atribuído');
  const [solicitacaoShort, setSolicitacaoShort] = useState(conversationId ? String(conversationId).slice(0, 8).toUpperCase() : '—');
  const [subjectUserId, setSubjectUserId] = useState<string>('');
  const [ctxJson, setCtxJson] = useState<Record<string, unknown>>({});
  const [historicoReal, setHistoricoReal] = useState<Array<{ id: string; titulo: string; atendente: string; data: string; desc: string; desc2: string }>>([]);
  const [complaintBody, setComplaintBody] = useState('');

  const [encomendaShipmentStatus, setEncomendaShipmentStatus] = useState<string | null>(null);
  const [encomendaShipmentKind, setEncomendaShipmentKind] = useState<'shipment' | 'dependent_shipment'>('shipment');
  const [encomendaOrigem, setEncomendaOrigem] = useState('—');
  const [encomendaDestino, setEncomendaDestino] = useState('—');
  const [encomendaPackageSize, setEncomendaPackageSize] = useState('—');
  const [encomendaAmountCents, setEncomendaAmountCents] = useState<number | null>(null);
  const [encomendaRecipient, setEncomendaRecipient] = useState('—');
  const [encomendaSender, setEncomendaSender] = useState('—');
  const [encomendaInstructions, setEncomendaInstructions] = useState('');
  const [encomendaPhotoUrl, setEncomendaPhotoUrl] = useState<string | null>(null);
  const [workerSubtype, setWorkerSubtype] = useState<string | null>(null);

  const status = ticket.status || 'nao_atendida';
  const isEncomenda = rawCategory === 'encomendas';
  const isCadastro = rawCategory === 'cadastro_transporte';
  const isOutros = rawCategory === 'outros';
  const isAutorizarMenores = rawCategory === 'autorizar_menores';
  const hideViagemSections = isEncomenda || isCadastro || isOutros || isAutorizarMenores;
  const isExcursao = useMemo(
    () => categoria.toLowerCase().includes('excursão') || categoria.toLowerCase().includes('excursao'),
    [categoria],
  );

  /** Motorista do ticket: `context.worker_id` (cadastro) ou usuário do ticket de cadastro de transporte. */
  const motoristaDocWorkerId = useMemo(() => {
    const w = typeof ctxJson.worker_id === 'string' ? ctxJson.worker_id.trim() : '';
    if (w) return w;
    if (rawCategory === 'cadastro_transporte' && subjectUserId.trim()) return subjectUserId.trim();
    return '';
  }, [ctxJson.worker_id, rawCategory, subjectUserId]);
  const [chatOpen, setChatOpen] = useState(false);
  /** Mensagens do requerente ainda não lidas pelo operador (read_at null, sender ≠ admin). */
  const [subjectUnreadForOperator, setSubjectUnreadForOperator] = useState(0);
  const [chatMsg, setChatMsg] = useState('');

  const fetchSubjectUnreadForOperator = useCallback(async () => {
    if (!isSupabaseConfigured || !conversationId || !currentUserId) {
      setSubjectUnreadForOperator(0);
      return;
    }
    const { count, error } = await (supabase as any)
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conversationId)
      .neq('sender_id', currentUserId)
      .is('read_at', null);
    if (error) {
      setSubjectUnreadForOperator(0);
      return;
    }
    setSubjectUnreadForOperator(count ?? 0);
  }, [conversationId, currentUserId]);

  useEffect(() => {
    void fetchSubjectUnreadForOperator();
    if (!isSupabaseConfigured || !conversationId) return () => {};
    const channel = (supabase as any)
      .channel(`atendimento-operator-unread:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => { void fetchSubjectUnreadForOperator(); },
      )
      .subscribe();
    return () => {
      (supabase as any).removeChannel(channel);
    };
  }, [conversationId, fetchSubjectUnreadForOperator]);

  const hadChatOpenRef = useRef(false);
  useEffect(() => {
    if (chatOpen) {
      hadChatOpenRef.current = true;
      return undefined;
    }
    if (hadChatOpenRef.current) {
      hadChatOpenRef.current = false;
      void fetchSubjectUnreadForOperator();
    }
    return undefined;
  }, [chatOpen, fetchSubjectUnreadForOperator]);

  const [editStatusOpen, setEditStatusOpen] = useState(false);
  const [currentStatus, setCurrentStatus] = useState(status);
  const [finalizarOpen, setFinalizarOpen] = useState(false);
  const [finishNoteDraft, setFinishNoteDraft] = useState('');
  const [reprovarOpen, setReprovarOpen] = useState(false);
  const [autorizarOpen, setAutorizarOpen] = useState(false);
  const [autorizarSubmitting, setAutorizarSubmitting] = useState(false);
  const [reprovarSubmitting, setReprovarSubmitting] = useState(false);
  /** `worker_profiles.status` do motorista vinculado ao ticket de cadastro (para esconder aprovar/reprovar). */
  const [workerCadastroStatus, setWorkerCadastroStatus] = useState<string | null>(null);
  const [dadosCadastraisOpen, setDadosCadastraisOpen] = useState(false);
  const [documentosOpen, setDocumentosOpen] = useState(false);
  type SupportDocRow = { key: string; section: string; fileLabel: string; href: string | null; rawPresent: boolean; hasWarning: boolean };
  const [supportDocRows, setSupportDocRows] = useState<SupportDocRow[]>([]);
  const [supportDocsLoading, setSupportDocsLoading] = useState(false);
  const [encomendaOpen, setEncomendaOpen] = useState(false);
  const [viagemOpen, setViagemOpen] = useState(false);
  const [pagamentoOpen, setPagamentoOpen] = useState(false);
  const [solicitacaoOpen, setSolicitacaoOpen] = useState(false);
  const [cadastrarPagOpen, setCadastrarPagOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const showToast = useCallback((msg: string) => setToastMsg(msg), []);
  useEffect(() => { if (!toastMsg) return; const t = setTimeout(() => setToastMsg(null), 3000); return () => clearTimeout(t); }, [toastMsg]);
  const [tempStatus, setTempStatus] = useState(status);

  const openPerfilCompletoRelacionado = useCallback(() => {
    if (motoristaDocWorkerId) {
      setDadosCadastraisOpen(false);
      setDocumentosOpen(false);
      navigate(`/motoristas/${motoristaDocWorkerId}`);
      return;
    }
    if (subjectUserId.trim()) {
      setDadosCadastraisOpen(false);
      setDocumentosOpen(false);
      navigate(`/passageiros/${subjectUserId.trim()}`);
      return;
    }
    showToast('Não foi possível abrir o perfil.');
  }, [motoristaDocWorkerId, navigate, showToast, subjectUserId]);

  useEffect(() => {
    if (!documentosOpen || !isSupabaseConfigured) return;
    const wid = motoristaDocWorkerId;
    if (!wid) {
      setSupportDocRows([]);
      setSupportDocsLoading(false);
      return;
    }
    let cancelled = false;
    setSupportDocsLoading(true);
    setSupportDocRows([]);
    const db = supabase as any;
    void (async () => {
      const { data: wp } = await db
        .from('worker_profiles')
        .select('cnh_document_url, cnh_document_back_url, background_check_url')
        .eq('id', wid)
        .maybeSingle();
      const { data: vehList } = await db
        .from('vehicles')
        .select('vehicle_document_url')
        .eq('worker_id', wid)
        .order('is_active', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: true })
        .limit(1);
      const veh = Array.isArray(vehList) ? vehList[0] : vehList;
      if (cancelled) return;
      const w = wp as { cnh_document_url?: string | null; cnh_document_back_url?: string | null; background_check_url?: string | null } | null;
      const v = veh as { vehicle_document_url?: string | null } | undefined;
      const specs: Array<{ key: string; section: string; fileLabel: string; raw: string | null | undefined; hasWarning: boolean }> = [
        { key: 'cnh_f', section: 'CNH (frente)', fileLabel: 'documento_cnh_frente.jpg', raw: w?.cnh_document_url, hasWarning: false },
        { key: 'cnh_b', section: 'CNH (verso)', fileLabel: 'documento_cnh_verso.jpg', raw: w?.cnh_document_back_url, hasWarning: false },
        { key: 'bg', section: 'Antecedentes criminais', fileLabel: 'antecedentes_criminais.jpg', raw: w?.background_check_url, hasWarning: true },
        { key: 'veh', section: 'Documento do veículo', fileLabel: 'documento_veiculo.jpg', raw: v?.vehicle_document_url, hasWarning: false },
      ];
      const rows: SupportDocRow[] = [];
      for (const s of specs) {
        const t = typeof s.raw === 'string' ? s.raw.trim() : '';
        if (!t) {
          rows.push({ key: s.key, section: s.section, fileLabel: s.fileLabel, href: null, rawPresent: false, hasWarning: s.hasWarning });
          continue;
        }
        let href: string | null = await resolveStorageDisplayUrl(supabase, t);
        if (!href && /^https?:\/\//i.test(t)) href = t;
        rows.push({ key: s.key, section: s.section, fileLabel: s.fileLabel, href, rawPresent: true, hasWarning: s.hasWarning });
      }
      if (!cancelled) {
        setSupportDocRows(rows);
        setSupportDocsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [documentosOpen, motoristaDocWorkerId]);

  useEffect(() => {
    if (!isSupabaseConfigured || !conversationId) return;
    let cancelled = false;
    void (async () => {
      const conv = await fetchSupportConversationDetail(conversationId);
      if (cancelled || !conv) return;
      if (conv.status === 'closed') setConvStatus('closed');
      else setConvStatus('active');
      setRawCategory(conv.category || 'outros');
      setCategoria(categoryLabelPt[conv.category || ''] || conv.category || 'Outros');
      setSolicitacaoShort(conv.id.replace(/-/g, '').slice(0, 8).toUpperCase());
      setSubjectUserId(conv.client_id);
      setCtxJson(conv.context || {});
      const bid = conv.booking_id || (typeof conv.context?.booking_id === 'string' ? (conv.context.booking_id as string) : null);
      if (conv.context?.complaint && typeof conv.context.complaint === 'string') {
        setComplaintBody(conv.context.complaint as string);
      } else if (conv.context?.message && typeof conv.context.message === 'string') {
        setComplaintBody(conv.context.message as string);
      } else {
        setComplaintBody('');
      }
      const cp = await fetchProfileBasics(conv.client_id);
      if (!cancelled) setNome(cp.full_name || conv.participant_name || '—');
      // Fetch full profile for dados cadastrais
      const { data: fullProfile } = await (supabase as any).from('profiles').select('cpf, phone, city, state, email').eq('id', conv.client_id).maybeSingle();
      if (fullProfile && !cancelled) {
        setProfileCpf((fullProfile as any).cpf || '—');
        setProfilePhone((fullProfile as any).phone || '—');
        setProfileCity((fullProfile as any).city || '—');
        setProfileState((fullProfile as any).state || '—');
        if ((fullProfile as any).email) setEmail((fullProfile as any).email);
      }
      if (conv.admin_id) {
        const ap = await fetchProfileBasics(conv.admin_id);
        if (!cancelled) setAtendenteNome(ap.full_name || 'Atendente');
      } else {
        setAtendenteNome('Não atribuído');
      }
      const hist = await fetchSupportHistoryForClient(conv.client_id, conv.id);
      if (!cancelled) {
        setHistoricoReal(hist.map((h) => ({
          id: h.id,
          titulo: h.titulo,
          atendente: h.atendente,
          data: h.data,
          desc: h.desc,
          desc2: h.desc2,
        })));
      }
      const now = Date.now();
      const createdAt = new Date(conv.created_at).getTime();
      const isOverSLA = conv.sla_deadline_at
        ? now > new Date(conv.sla_deadline_at).getTime()
        : now - createdAt > 24 * 60 * 60000;
      if (conv.status !== 'active') {
        setCurrentStatus('finalizada');
      } else if (!conv.admin_id) {
        setCurrentStatus('nao_atendida');
      } else if (isOverSLA) {
        setCurrentStatus('atrasada');
      } else {
        setCurrentStatus('em_atendimento');
      }
      if (bid) {
        const det = await fetchBookingDetailForAdmin(bid);
        if (det && !cancelled) {
          setTrechoLinha(`${det.listItem.origem} → ${det.listItem.destino}`);
          setPeriodoLinha(`${det.listItem.embarque} – ${det.listItem.chegada}`);
          setViagemRefLinha(det.listItem.bookingId.slice(0, 8).toUpperCase());
          setViagemStatusLinha(det.listItem.status);
        }
      } else if (!cancelled) {
        setTrechoLinha('—');
        setPeriodoLinha('—');
        setViagemRefLinha('—');
        setViagemStatusLinha('—');
      }
      if (conv.category === 'reembolso' && bid) {
        setRefundEntityId(bid);
        setRefundEntityType('booking');
      }
      // Buscar status e detalhes da encomenda vinculada
      if (conv.category === 'encomendas') {
        const kind = (conv.context?.shipment_kind as string) || 'shipment';
        setEncomendaShipmentKind(kind === 'dependent_shipment' ? 'dependent_shipment' : 'shipment');
        const sid = conv.shipment_id || (conv.context?.shipment_id as string) || (conv.context?.dependent_shipment_id as string);
        if (sid && !cancelled) {
          const table = kind === 'dependent_shipment' ? 'dependent_shipments' : 'shipments';
          const cols = kind === 'dependent_shipment'
            ? 'status, origin_address, destination_address, amount_cents, full_name, receiver_name, instructions, photo_url'
            : 'status, origin_address, destination_address, amount_cents, package_size, recipient_name, instructions, photo_url';
          const { data: sData } = await (supabase as any).from(table).select(cols).eq('id', sid).maybeSingle();
          if (sData && !cancelled) {
            const s = sData as any;
            setEncomendaShipmentStatus(s.status);
            setEncomendaOrigem(s.origin_address || '—');
            setEncomendaDestino(s.destination_address || '—');
            setEncomendaPackageSize(s.package_size || '—');
            setEncomendaAmountCents(s.amount_cents ?? null);
            setEncomendaRecipient(s.recipient_name || s.receiver_name || '—');
            setEncomendaSender(s.full_name || nome || '—');
            setEncomendaInstructions(s.instructions || '');
            if (s.photo_url) {
              const resolved = await resolveStorageDisplayUrl(supabase, s.photo_url);
              if (!cancelled) setEncomendaPhotoUrl(resolved);
            }
          }
        }
      }
    })();
    return () => { cancelled = true; };
  }, [conversationId]);

  useEffect(() => {
    if (!isSupabaseConfigured || rawCategory !== 'cadastro_transporte' || !motoristaDocWorkerId) {
      setWorkerCadastroStatus(null);
      setWorkerSubtype(null);
      return;
    }
    let cancelled = false;
    void (supabase as any)
      .from('worker_profiles')
      .select('status, subtype')
      .eq('id', motoristaDocWorkerId)
      .maybeSingle()
      .then(({ data }: { data: { status?: string; subtype?: string } | null }) => {
        if (cancelled) return;
        setWorkerCadastroStatus(typeof data?.status === 'string' ? data.status : null);
        setWorkerSubtype(typeof data?.subtype === 'string' ? data.subtype : null);
      });
    return () => { cancelled = true; };
  }, [rawCategory, motoristaDocWorkerId]);

  const statusOpts = [
    { key: 'nao_atendida', label: 'Não atendida', dot: '#b53838', bg: '#eeafaa', color: '#551611' },
    { key: 'em_atendimento', label: 'Em atendimento', dot: '#cba04b', bg: '#fee59a', color: '#654c01' },
    { key: 'atrasada', label: 'Atrasada', dot: '#b53838', bg: '#eeafaa', color: '#551611' },
    { key: 'finalizada', label: 'Finalizada', dot: '#22c55e', bg: '#b0e8d1', color: '#174f38' },
  ];
  const curOpt = statusOpts.find((o) => o.key === currentStatus) || statusOpts[0];
  const statusLabel = curOpt.label;
  const statusDot = curOpt.dot;
  const statusBg = curOpt.bg;
  const statusColor = curOpt.color;

  const cadastroWorkerDecidido =
    workerCadastroStatus === 'approved' ||
    workerCadastroStatus === 'rejected' ||
    workerCadastroStatus === 'suspended';
  const hideCadastroAprovarReprovar =
    rawCategory === 'cadastro_transporte' && Boolean(motoristaDocWorkerId) && cadastroWorkerDecidido;

  const encomendaDecidido = encomendaShipmentStatus === 'confirmed' || encomendaShipmentStatus === 'cancelled';
  const hideEncomendaAprovarReprovar = isEncomenda && encomendaDecidido;

  const encomendaDecididoBanner = hideEncomendaAprovarReprovar
    ? (() => {
        const meta = encomendaShipmentStatus === 'confirmed'
          ? { bg: '#b0e8d1', color: '#174f38', border: '#22c55e', label: 'Encomenda aprovada' }
          : { bg: '#eeafaa', color: '#551611', border: '#b53838', label: 'Encomenda rejeitada' };
        return React.createElement('div', {
          style: { marginTop: 8, padding: '14px 18px', borderRadius: 12, background: meta.bg, border: `1px solid ${meta.border}`, display: 'flex', alignItems: 'center', gap: 10, ...font },
        },
          React.createElement('span', { style: { width: 10, height: 10, borderRadius: '50%', background: meta.border, flexShrink: 0 } }),
          React.createElement('span', { style: { fontSize: 15, fontWeight: 600, color: meta.color } }, meta.label));
      })()
    : null;

  const cadastroDecididoBanner = hideCadastroAprovarReprovar
    ? (() => {
        const s = workerCadastroStatus;
        const prep = workerSubtype === 'excursions' || workerSubtype === 'shipments';
        const meta =
          s === 'approved'
            ? { bg: '#b0e8d1', color: '#174f38', border: '#22c55e', label: prep ? 'Preparador autorizado' : 'Cadastro de motorista aprovado' }
            : s === 'rejected'
              ? { bg: '#eeafaa', color: '#551611', border: '#b53838', label: prep ? 'Preparador reprovado' : 'Cadastro de motorista reprovado' }
              : { bg: '#fee59a', color: '#654c01', border: '#cba04b', label: 'Cadastro suspenso' };
        return React.createElement(
          'div',
          {
            style: {
              marginTop: 8,
              padding: '14px 18px',
              borderRadius: 12,
              background: meta.bg,
              border: `1px solid ${meta.border}`,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              ...font,
            },
          },
          React.createElement('span', {
            style: {
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: meta.border,
              flexShrink: 0,
            },
          }),
          React.createElement('span', { style: { fontSize: 15, fontWeight: 600, color: meta.color } }, meta.label),
        );
      })()
    : null;

  // ── Left panel ────────────────────────────────────────────────────────
  const leftPanel = React.createElement('div', {
    style: {
      flex: '1 1 50%', minWidth: 320, display: 'flex', flexDirection: 'column' as const,
      borderRight: '1px solid #e2e2e2', background: '#fff', justifyContent: 'space-between',
    },
  },
    // Top content
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const } },
    // Header row: ← Atendimento + Finalizar (gray bg)
    React.createElement('div', {
      style: {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 16,
        background: '#f6f6f6', borderBottom: '1px solid #e2e2e2',
      },
    },
      React.createElement('div', { style: { display: 'flex', gap: 10, alignItems: 'center' } },
        React.createElement('button', {
          type: 'button', onClick: () => navigate(-1),
          style: { background: 'none', border: 'none', cursor: 'pointer', padding: 10, display: 'flex', borderRadius: 999 },
        }, arrowLeftSvg),
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const } },
          React.createElement('span', { style: { fontSize: 20, fontWeight: 600, color: '#0d0d0d', ...font } }, 'Atendimento'),
          React.createElement('span', { style: { fontSize: 14, color: '#767676', ...font } }, `Solicitação #${solicitacaoShort}`))),
      React.createElement('button', {
        type: 'button',
        onClick: () => setFinalizarOpen(true),
        style: {
          height: 40, padding: '8px 24px', borderRadius: 999, border: 'none',
          background: '#f2afaf', color: '#681f1f', fontSize: 14, fontWeight: 500, cursor: 'pointer', ...font,
        },
      }, 'Finalizar atendimento')),

    // Body content with padding
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 16, padding: 16 } },

    // Status badge + Editar status + User info (in one bordered block)
    React.createElement('div', {
      style: { display: 'flex', flexDirection: 'column' as const, gap: 16, paddingBottom: 24, borderBottom: '1px solid #e2e2e2' },
    },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
        React.createElement('span', {
          style: {
            display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 12px', borderRadius: 8,
            background: statusBg, color: statusColor, fontSize: 14, fontWeight: 500, ...font,
          },
        },
          React.createElement('span', { style: { width: 10, height: 10, borderRadius: '50%', background: statusDot } }),
          statusLabel),
        React.createElement('button', {
          type: 'button',
          onClick: () => setEditStatusOpen(true),
          style: {
            display: 'flex', alignItems: 'center', gap: 8, height: 36, padding: '8px 24px',
            borderRadius: 999, background: '#f1f1f1', border: 'none',
            fontSize: 14, fontWeight: 500, color: '#0d0d0d', cursor: 'pointer', ...font,
          },
        }, pencilSvg, 'Editar status')),

      // User info with border bottom
      React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: 16, paddingBottom: 24, borderBottom: '1px solid #e2e2e2' },
      },
        React.createElement('div', {
          style: {
            width: 56, height: 56, borderRadius: 1000, background: '#E8725C', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          },
        }, React.createElement('span', { style: { color: '#fff', fontSize: 22, fontWeight: 600, ...font } }, nome.charAt(0))),
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4 } },
          React.createElement('span', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', ...font } }, nome),
          React.createElement('span', { style: { fontSize: 14, color: '#767676', ...font } }, email))),

      // Categoria + Atendente
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between' } },
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4, flex: 1 } },
          React.createElement('span', { style: { fontSize: 14, color: '#767676', ...font } }, 'Categoria'),
          React.createElement('span', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', ...font } }, isExcursao ? 'Solicitação de excursão' : categoria)),
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4, flex: 1 } },
          React.createElement('span', { style: { fontSize: 14, color: '#767676', ...font } }, 'Atendente responsável'),
          React.createElement('span', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', ...font } }, atendenteNome)))),

    // Trecho + Período (hidden for encomendas — shown in modal)
    hideViagemSections ? null : React.createElement('div', {
      style: { display: 'flex', justifyContent: 'space-between', paddingBottom: 24, borderBottom: '1px solid #e2e2e2' },
    },
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4, flex: 1 } },
        React.createElement('span', { style: { fontSize: 14, color: '#767676', ...font } }, 'Trecho principal'),
        React.createElement('span', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', ...font } }, trechoLinha)),
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4, flex: 1 } },
        React.createElement('span', { style: { fontSize: 14, color: '#767676', ...font } }, isExcursao ? 'Período da excursão' : 'Período da viagem'),
        React.createElement('span', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', ...font } }, periodoLinha))),

    // Viagem/Excursão + Status (hidden for encomendas — shown in modal)
    hideViagemSections ? null : React.createElement('div', {
      style: { display: 'flex', justifyContent: 'space-between', paddingBottom: 24, borderBottom: '1px solid #e2e2e2' },
    },
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4, flex: 1 } },
        React.createElement('span', { style: { fontSize: 14, color: '#767676', ...font } }, isExcursao ? 'Excursão' : 'Viagem'),
        React.createElement('span', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', ...font } }, viagemRefLinha)),
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4, flex: 1 } },
        React.createElement('span', { style: { fontSize: 14, color: '#767676', ...font } }, 'Status'),
        React.createElement('span', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', ...font } }, viagemStatusLinha))),

    // Orçamento (only for excursão after elaborar)
    orcamentoCriado && isExcursao ? React.createElement(React.Fragment, null,
      React.createElement('div', { style: { height: 1, background: '#e2e2e2' } }),
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 16 } },
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4 } },
          React.createElement('span', { style: { fontSize: 12, color: '#767676', ...font } }, 'Orçamento'),
          React.createElement('span', { style: { fontSize: 16, fontWeight: 700, color: '#0d0d0d', ...font } }, orcamentoValor)),
        React.createElement('button', {
          type: 'button',
          style: {
            display: 'flex', alignItems: 'center', gap: 6, height: 36, padding: '0 16px',
            borderRadius: 999, background: '#767676', color: '#fff', border: 'none',
            fontSize: 13, fontWeight: 500, cursor: 'pointer', ...font,
          },
        }, pencilSvg, 'Editar orçamento'))) : null,

    complaintBody
      ? React.createElement('div', {
        style: {
          padding: 16, background: '#f6f6f6', borderRadius: 12, fontSize: 14, color: '#0d0d0d', lineHeight: 1.5, ...font,
        },
      },
        React.createElement('span', { style: { fontWeight: 600, display: 'block', marginBottom: 8, ...font } }, 'Mensagem / reclamação'),
        complaintBody)
      : null,

    // Action chips (grid of 3 per row, Figma style)
    ...(() => {
      const chips = supportActionChipsForCategory(rawCategory, workerSubtype);
      const rows: string[][] = [];
      for (let i = 0; i < chips.length; i += 3) rows.push(chips.slice(i, i + 3));
      const chipClickHandler = (label: string) =>
        label === 'Dados cadastrais' ? () => setDadosCadastraisOpen(true) : label === 'Documentos' ? () => {
          if (rawCategory === 'autorizar_menores' && !minorData) {
            const depId = ctxJson.dependent_id as string | undefined;
            const sb = supabase as any;
            if (depId) {
              void sb.from('dependents').select('*').eq('id', depId).maybeSingle()
                .then(({ data }: any) => { setMinorData(data); setDocumentosOpen(true); });
              return;
            } else if (subjectUserId) {
              void sb.from('dependents').select('*').eq('user_id', subjectUserId).eq('status', 'pending').order('created_at', { ascending: false }).limit(1).maybeSingle()
                .then(({ data }: any) => { setMinorData(data); setDocumentosOpen(true); });
              return;
            }
          }
          setDocumentosOpen(true);
        } : label === 'Encomendas' ? () => setEncomendaOpen(true) : label === 'Viagens' ? () => setViagemOpen(true) : label === 'Pagamentos' ? () => setPagamentoOpen(true) : label === 'Solicitação' ? () => setSolicitacaoOpen(true) : label === 'Reembolso' ? () => setRefundOpen(true) : label === 'Veículo' ? () => {
          const wid = (ctxJson.worker_id as string) || subjectUserId;
          if (!wid) return;
          void (supabase as any).from('vehicles').select('*').eq('worker_id', wid).eq('status', 'pending').order('created_at', { ascending: false }).limit(1).maybeSingle()
            .then(({ data }: any) => { setVehicleData(data); setVehicleAuthOpen(true); });
        } : label === 'Menores' ? () => {
          const depId = ctxJson.dependent_id as string | undefined;
          const sb = supabase as any;
          if (depId) {
            void sb.from('dependents').select('*').eq('id', depId).maybeSingle()
              .then(({ data }: any) => { setMinorData(data); setMinorAuthOpen(true); });
          } else if (subjectUserId) {
            void sb.from('dependents').select('*').eq('user_id', subjectUserId).eq('status', 'pending').order('created_at', { ascending: false }).limit(1).maybeSingle()
              .then(({ data }: any) => { setMinorData(data); setMinorAuthOpen(true); });
          }
        } : undefined;
      return rows.map((row, ri) =>
        React.createElement('div', { key: `chip-row-${ri}`, style: { display: 'flex', gap: 16, cursor: 'pointer' } },
          ...row.map((label) =>
            React.createElement('button', {
              key: label, type: 'button', onClick: chipClickHandler(label),
              style: {
                flex: 1, height: 47, minWidth: 112, borderRadius: 999, border: 'none',
                background: '#f1f1f1', fontSize: 14, fontWeight: 500, color: '#0d0d0d', cursor: 'pointer', ...font,
              },
            }, label))));
    })(),

    )), // close body padding div + top content div

    // Bottom action buttons (pinned to bottom, Figma style)
    isExcursao
      ? React.createElement('div', { style: { display: 'flex', gap: 16, padding: 16 } },
          React.createElement('button', {
            type: 'button', onClick: () => setReprovarOpen(true),
            style: {
              flex: 1, height: 47, borderRadius: 999, border: 'none',
              background: '#f2afaf', color: '#681f1f', fontSize: 14, fontWeight: 500, cursor: 'pointer', ...font,
            },
          }, 'Reprovar excursão'),
          React.createElement('button', {
            type: 'button',
            onClick: () => { if (!orcamentoCriado) navigate('/atendimentos/0/orcamento'); else { /* enviar */ } },
            style: {
              flex: 1, height: 47, borderRadius: 999, border: 'none',
              background: '#0d8344', color: '#fff8e6', fontSize: 14, fontWeight: 500, cursor: 'pointer', ...font,
            },
          }, orcamentoCriado ? 'Enviar orçamento' : 'Elaborar orçamento'))
      : isEncomenda
        ? (hideEncomendaAprovarReprovar
          ? React.createElement('div', { style: { padding: 16 } }, encomendaDecididoBanner)
          : React.createElement('div', { style: { display: 'flex', gap: 16, padding: 16 } },
              React.createElement('button', {
                type: 'button', onClick: () => setReprovarOpen(true),
                style: {
                  flex: 1, height: 47, borderRadius: 999, border: 'none',
                  background: '#f2afaf', color: '#681f1f', fontSize: 14, fontWeight: 500, cursor: 'pointer', ...font,
                },
              }, 'Rejeitar encomenda'),
              React.createElement('button', {
                type: 'button', onClick: () => setAutorizarOpen(true),
                style: {
                  flex: 1, height: 47, borderRadius: 999, border: 'none',
                  background: '#0d8344', color: '#fff8e6', fontSize: 14, fontWeight: 500, cursor: 'pointer', ...font,
                },
              }, 'Aprovar encomenda')))
      : hideCadastroAprovarReprovar
          ? React.createElement('div', { style: { padding: 16 } }, cadastroDecididoBanner)
          : React.createElement('div', { style: { display: 'flex', gap: 16, padding: 16 } },
              React.createElement('button', {
                type: 'button', onClick: () => setReprovarOpen(true),
                style: {
                  flex: 1, height: 47, borderRadius: 999, border: 'none',
                  background: '#f2afaf', color: '#681f1f', fontSize: 14, fontWeight: 500, cursor: 'pointer', ...font,
                },
              }, rawCategory === 'autorizar_menores' ? 'Negar autorização' : workerSubtype === 'excursions' || workerSubtype === 'shipments' ? 'Reprovar preparador' : 'Reprovar cadastro'),
              React.createElement('button', {
                type: 'button', onClick: () => setAutorizarOpen(true),
                style: {
                  flex: 1, height: 47, borderRadius: 999, border: 'none',
                  background: '#0d8344', color: '#fff8e6', fontSize: 14, fontWeight: 500, cursor: 'pointer', ...font,
                },
              }, rawCategory === 'autorizar_menores' ? 'Autorizar menor' : workerSubtype === 'excursions' || workerSubtype === 'shipments' ? 'Autorizar preparador' : 'Autorizar cadastro')));

  // ── Right panel: Histórico ────────────────────────────────────────────
  const rightPanel = React.createElement('div', {
    style: {
      flex: '1 1 45%', minWidth: 300, display: 'flex', flexDirection: 'column' as const,
      background: '#f6f6f6',
    },
  },
    // Header
    React.createElement('div', {
      style: {
        padding: '24px 16px', borderBottom: '1px solid #e2e2e2',
      },
    },
      React.createElement('h2', { style: { fontSize: 20, fontWeight: 600, color: '#0d0d0d', margin: 0, ...font } }, 'Histórico de atendimentos')),
    // Content
    React.createElement('div', {
      style: {
        padding: 16, display: 'flex', flexDirection: 'column' as const, gap: 0,
      },
    },
      React.createElement('div', {
        style: {
          border: '1px solid #e2e2e2', borderRadius: 8, padding: 16, display: 'flex',
          flexDirection: 'column' as const, gap: 16,
        },
      },
        React.createElement('h3', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', margin: 0, ...font } }, 'Histórico de atendimentos'),
      historicoReal.length === 0
        ? React.createElement('p', {
          style: { fontSize: 14, color: '#767676', margin: 0, lineHeight: 1.5, ...font },
        }, 'Nenhum outro atendimento deste usuário nos últimos 6 meses (exceto o ticket atual).')
        : null,
      ...historicoReal.map((item, idx) =>
        React.createElement('div', {
          key: item.id || String(idx),
          style: {
            padding: 16, background: '#f1f1f1', borderRadius: 8,
            display: 'flex', flexDirection: 'column' as const, gap: 4,
          },
        },
          React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 } },
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 6, flex: 1, minWidth: 0 } },
              React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap' as const, alignItems: 'center', gap: 8 } },
                item.desc2
                  ? React.createElement('span', {
                    style: {
                      fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 999, flexShrink: 0,
                      background: item.desc2 === 'Encerrado' ? '#e2e2e2' : '#fee59a',
                      color: item.desc2 === 'Encerrado' ? '#3a3a3a' : '#654c01',
                      ...font,
                    },
                  }, item.desc2)
                  : null,
                React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', ...font } }, item.titulo)),
              React.createElement('span', { style: { fontSize: 13, color: '#767676', ...font } }, `Atendente: ${item.atendente}`)),
            React.createElement('span', { style: { fontSize: 12, color: '#767676', flexShrink: 0, ...font } }, item.data)),
          React.createElement('p', { style: { fontSize: 13, color: '#767676', margin: 0, lineHeight: 1.5, ...font } }, item.desc))),
    )),

    // Conversa floating bar (toggles chat)
    React.createElement('div', {
      style: {
        position: 'fixed' as const, bottom: 24, right: 24,
        display: 'flex', alignItems: 'center', gap: 12,
        background: '#0d0d0d', borderRadius: 999, padding: '12px 20px', zIndex: 100,
        boxShadow: '0 4px 20px rgba(0,0,0,0.2)', cursor: 'pointer',
      },
      onClick: () => setChatOpen(!chatOpen),
    },
      React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#fff', ...font } }, 'Conversa'),
      subjectUnreadForOperator > 0 && !chatOpen
        ? React.createElement('span', {
          key: 'op-unread',
          style: {
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            minWidth: 22, height: 22, padding: '0 6px', borderRadius: '50%', background: '#b53838',
            fontSize: 12, fontWeight: 700, color: '#fff', ...font,
          },
        }, subjectUnreadForOperator > 99 ? '99+' : String(subjectUnreadForOperator))
        : null,
      React.createElement('button', {
        type: 'button',
        onClick: (e: React.MouseEvent) => { e.stopPropagation(); setChatOpen(!chatOpen); },
        style: { background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' },
      }, chatOpen ? chatToggleDownSvg : chatToggleUpSvg)));

  // ── Chat panel ────────────────────────────────────────────────────────
  const chatMessages = [
    { from: 'client', text: 'Preciso organizar uma viagem para 15 pessoas de São Paulo para Santos para um evento empresarial. Vocês conseguem me ajudar com isso?', time: '15h25' },
    { from: 'agent', text: 'Claro! Podemos sim te ajudar com isso. Você poderia confirmar as datas e se o grupo precisará\nde transporte de volta também?', time: '15h35' },
    { from: 'client', text: 'A viagem seria no dia 20, com retorno no dia 22.\nÉ possível incluir paradas no caminho?', time: '15h38' },
  ];

  // Send icon
  const sendSvg = React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
    React.createElement('path', { d: 'M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
  // Camera icon
  const cameraSvg = React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
    React.createElement('path', { d: 'M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z', stroke: '#767676', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }),
    React.createElement('circle', { cx: 12, cy: 13, r: 4, stroke: '#767676', strokeWidth: 2 }));
  // Plus icon
  const plusSvg = React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
    React.createElement('path', { d: 'M12 5v14M5 12h14', stroke: '#767676', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
  // Minimize icon
  const minimizeSvg = React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
    React.createElement('path', { d: 'M5 12h14', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round' }));
  // Check icon
  const checkSvg = React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
    React.createElement('path', { d: 'M20 6L9 17l-5-5', stroke: '#767676', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));

  // ChatPanel com Supabase Realtime (substitui chat manual)
  const chatPanel = chatOpen ? React.createElement(ChatPanel, {
    conversationId: conversationId || null,
    currentUserId,
    participantName: nome,
    onClose: () => setChatOpen(false),
    onAfterMarkRead: () => { void fetchSubjectUnreadForOperator(); },
    floating: true,
    closed: convStatus === 'closed',
  }) : null;

  // ── Reembolso modal ───────────────────────────────────────────────────
  const refundModal = refundOpen ? React.createElement('div', {
    style: {
      position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    },
    onClick: () => setRefundOpen(false),
  },
    React.createElement('div', {
      style: {
        background: '#fff', borderRadius: 16, width: '100%', maxWidth: 480, padding: '28px 32px',
        display: 'flex', flexDirection: 'column' as const, gap: 20, boxShadow: '0 20px 60px rgba(0,0,0,.15)',
      },
      onClick: (e: React.MouseEvent) => e.stopPropagation(),
    },
      React.createElement('h2', { style: { fontSize: 20, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } }, 'Processar Reembolso'),
      React.createElement('div', { style: { height: 1, background: '#e2e2e2' } }),
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 12 } },
        React.createElement('label', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', ...font } }, 'Tipo de entidade'),
        React.createElement('select', {
          value: refundEntityType,
          onChange: (e: React.ChangeEvent<HTMLSelectElement>) => setRefundEntityType(e.target.value),
          style: { height: 44, borderRadius: 8, border: '1px solid #e2e2e2', padding: '0 12px', fontSize: 14, ...font },
        },
          React.createElement('option', { value: 'booking' }, 'Viagem (booking)'),
          React.createElement('option', { value: 'shipment' }, 'Encomenda (shipment)'),
          React.createElement('option', { value: 'excursion' }, 'Excursão')),
        React.createElement('label', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', ...font } }, 'ID da entidade'),
        React.createElement('input', {
          type: 'text', value: refundEntityId, placeholder: 'UUID da reserva/encomenda',
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setRefundEntityId(e.target.value),
          style: { height: 44, borderRadius: 8, border: '1px solid #e2e2e2', padding: '0 12px', fontSize: 14, ...font },
        })),
      React.createElement('div', { style: { display: 'flex', gap: 12 } },
        React.createElement('button', {
          type: 'button',
          disabled: refundProcessing || !refundEntityId.trim(),
          onClick: async () => {
            setRefundProcessing(true);
            try {
              await invokeEdgeFunction('process-refund', 'POST', undefined, {
                entity_type: refundEntityType, entity_id: refundEntityId.trim(), reason: 'admin_refund',
              });
              showToast('Reembolso processado com sucesso');
              setRefundOpen(false);
            } catch (err: any) { showToast(`Erro: ${err.message || 'falha no reembolso'}`); }
            setRefundProcessing(false);
          },
          style: { flex: 1, height: 48, borderRadius: 999, border: 'none', background: '#0d0d0d', color: '#fff', fontSize: 16, fontWeight: 600, cursor: 'pointer', opacity: refundProcessing ? 0.6 : 1, ...font },
        }, refundProcessing ? 'Processando...' : 'Processar Reembolso'),
        React.createElement('button', {
          type: 'button', onClick: () => setRefundOpen(false),
          style: { flex: 1, height: 48, borderRadius: 999, border: '1px solid #e2e2e2', background: '#fff', color: '#b53838', fontSize: 16, fontWeight: 600, cursor: 'pointer', ...font },
        }, 'Cancelar')))) : null;

  // ── Autorização de veículo modal ──────────────────────────────────────
  const vehicleAuthModal = vehicleAuthOpen ? React.createElement('div', {
    style: {
      position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    },
    onClick: () => setVehicleAuthOpen(false),
  },
    React.createElement('div', {
      style: {
        background: '#fff', borderRadius: 16, width: '100%', maxWidth: 520, padding: '28px 32px',
        display: 'flex', flexDirection: 'column' as const, gap: 20, boxShadow: '0 20px 60px rgba(0,0,0,.15)',
      },
      onClick: (e: React.MouseEvent) => e.stopPropagation(),
    },
      React.createElement('h2', { style: { fontSize: 20, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } }, 'Autorizar Cadastro de Veículo'),
      React.createElement('div', { style: { height: 1, background: '#e2e2e2' } }),
      vehicleData
        ? React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8 } },
            React.createElement('div', { style: { fontSize: 14, ...font } }, `Modelo: ${vehicleData.model || '—'}`),
            React.createElement('div', { style: { fontSize: 14, ...font } }, `Placa: ${vehicleData.plate || '—'}`),
            React.createElement('div', { style: { fontSize: 14, ...font } }, `Ano: ${vehicleData.year || '—'}`))
        : React.createElement('p', { style: { fontSize: 14, color: '#767676', ...font } }, 'Nenhum veículo pendente.'),
      React.createElement('div', { style: { display: 'flex', gap: 12 } },
        React.createElement('button', {
          type: 'button',
          onClick: async () => {
            if (vehicleData?.id) {
              await (supabase as any).from('vehicles').update({ status: 'approved', reviewed_at: new Date().toISOString() }).eq('id', vehicleData.id);
              showToast('Veículo aprovado');
              setVehicleAuthOpen(false);
            }
          },
          style: { flex: 1, height: 48, borderRadius: 999, border: 'none', background: '#22c55e', color: '#fff', fontSize: 16, fontWeight: 600, cursor: 'pointer', ...font },
        }, 'Aprovar'),
        React.createElement('button', {
          type: 'button',
          onClick: async () => {
            if (vehicleData?.id) {
              await (supabase as any).from('vehicles').update({ status: 'rejected', reviewed_at: new Date().toISOString() }).eq('id', vehicleData.id);
              showToast('Veículo rejeitado');
              setVehicleAuthOpen(false);
            }
          },
          style: { flex: 1, height: 48, borderRadius: 999, border: '1px solid #b53838', background: '#fff', color: '#b53838', fontSize: 16, fontWeight: 600, cursor: 'pointer', ...font },
        }, 'Rejeitar')))) : null;

  const readField = (label: string, value: string, flex = '1 1 0') =>
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4, flex, minWidth: 140 } },
      React.createElement('span', { style: { fontSize: 12, fontWeight: 500, color: '#767676', ...font } }, label),
      React.createElement('div', {
        style: { height: 44, borderRadius: 8, background: '#f1f1f1', padding: '0 16px', display: 'flex', alignItems: 'center', fontSize: 14, color: '#0d0d0d', ...font },
      }, value));

  // ── Autorização de menores modal ──────────────────────────────────────
  const minorAuthModal = minorAuthOpen ? React.createElement('div', {
    style: {
      position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    },
    onClick: () => setMinorAuthOpen(false),
  },
    React.createElement('div', {
      style: {
        background: '#fff', borderRadius: 16, width: '100%', maxWidth: 520, padding: '28px 32px',
        display: 'flex', flexDirection: 'column' as const, gap: 20, boxShadow: '0 20px 60px rgba(0,0,0,.15)',
      },
      onClick: (e: React.MouseEvent) => e.stopPropagation(),
    },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
        React.createElement('h2', { style: { fontSize: 20, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } }, 'Autorizar Menor'),
        React.createElement('button', {
          type: 'button', onClick: () => setMinorAuthOpen(false),
          style: { width: 36, height: 36, borderRadius: '50%', background: '#f1f1f1', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
        }, React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none' },
          React.createElement('path', { d: 'M18 6L6 18M6 6l12 12', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round' })))),
      React.createElement('div', { style: { height: 1, background: '#e2e2e2' } }),
      minorData
        ? React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 12 } },
            readField('Nome completo', minorData.full_name || '—'),
            readField('Idade', minorData.age || '—'),
            minorData.observations ? readField('Observações', minorData.observations) : null)
        : React.createElement('p', { style: { fontSize: 14, color: '#767676', ...font } }, 'Nenhum menor pendente.'),
      React.createElement('div', { style: { display: 'flex', gap: 12 } },
        React.createElement('button', {
          type: 'button', onClick: () => setMinorAuthOpen(false),
          style: { flex: 1, height: 48, borderRadius: 999, border: '1px solid #e2e2e2', background: '#fff', color: '#0d0d0d', fontSize: 16, fontWeight: 600, cursor: 'pointer', ...font },
        }, 'Fechar')))) : null;

  // ── Dados cadastrais modal ─────────────────────────────────────────────
  const dadosCadastraisModal = dadosCadastraisOpen ? React.createElement('div', {
    style: {
      position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    },
    onClick: () => setDadosCadastraisOpen(false),
  },
    React.createElement('div', {
      style: {
        background: '#fff', borderRadius: 16, width: '100%', maxWidth: 560, padding: '28px 32px',
        display: 'flex', flexDirection: 'column' as const, gap: 24,
        boxShadow: '0 20px 60px rgba(0,0,0,.15)',
      },
      onClick: (e: React.MouseEvent) => e.stopPropagation(),
    },
      // Header
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
        React.createElement('h2', { style: { fontSize: 18, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } }, 'Dados cadastrais'),
        React.createElement('button', {
          type: 'button', onClick: () => setDadosCadastraisOpen(false),
          style: { width: 36, height: 36, borderRadius: '50%', background: '#f1f1f1', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
        }, React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none' },
          React.createElement('path', { d: 'M18 6L6 18M6 6l12 12', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round' })))),
      // Separator
      React.createElement('div', { style: { height: 1, background: '#e2e2e2' } }),
      // Fields
      readField('Nome completo', nome),
      React.createElement('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap' as const } },
        readField('CPF', profileCpf),
        readField('Telefone', profilePhone)),
      React.createElement('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap' as const } },
        readField('Cidade', profileCity),
        readField('Estado', profileState)),
      // Ver perfil completo button
      React.createElement('button', {
        type: 'button', onClick: openPerfilCompletoRelacionado,
        style: {
          width: '100%', height: 48, borderRadius: 999, border: 'none',
          background: '#0d0d0d', color: '#fff', fontSize: 16, fontWeight: 600, cursor: 'pointer', ...font,
        },
      }, 'Ver perfil completo'))) : null;

  // ── Documentos modal ───────────────────────────────────────────────────
  const docFileIcon = React.createElement('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block', flexShrink: 0 } },
    React.createElement('path', { d: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z', stroke: '#767676', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }),
    React.createElement('path', { d: 'M14 2v6h6', stroke: '#767676', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
  const downloadIcon = React.createElement('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block', flexShrink: 0 } },
    React.createElement('path', { d: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3', stroke: '#767676', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
  const infoIcon = React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block', flexShrink: 0 } },
    React.createElement('circle', { cx: 12, cy: 12, r: 10, stroke: '#cba04b', strokeWidth: 2 }),
    React.createElement('path', { d: 'M12 8v4M12 16h.01', stroke: '#cba04b', strokeWidth: 2, strokeLinecap: 'round' }));

  const documentosRowElements =
    supportDocsLoading || !motoristaDocWorkerId
      ? []
      : supportDocRows.map((doc) =>
          React.createElement(
            'div',
            { key: doc.key, style: { display: 'flex', flexDirection: 'column' as const, gap: 8, marginBottom: 16 } },
            React.createElement(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 6 } },
              doc.hasWarning ? infoIcon : null,
              React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', ...font } }, doc.section),
            ),
            React.createElement(
              'div',
              {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 0',
                  borderBottom: '1px solid #f1f1f1',
                },
              },
              React.createElement(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 } },
                docFileIcon,
                React.createElement(
                  'span',
                  {
                    style: {
                      fontSize: 14,
                      color: doc.rawPresent && !doc.href ? '#b53838' : '#0d0d0d',
                      ...font,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap' as const,
                    },
                  },
                  !doc.rawPresent
                    ? 'Nenhum arquivo enviado'
                    : !doc.href
                      ? 'Arquivo indisponível (permissões de storage)'
                      : doc.fileLabel
                )
              ),
              doc.href
                ? React.createElement(
                    'a',
                    {
                      href: doc.href,
                      target: '_blank',
                      rel: 'noopener noreferrer',
                      title: 'Abrir ou baixar',
                      onClick: (e: React.MouseEvent) => e.stopPropagation(),
                      style: {
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: 0,
                        display: 'flex',
                        flexShrink: 0,
                      },
                    },
                    downloadIcon,
                  )
                : React.createElement(
                    'span',
                    { style: { display: 'flex', opacity: doc.rawPresent ? 0.35 : 0.25, flexShrink: 0 } },
                    downloadIcon,
                  ),
            ),
          ),
        );

  const documentosModal = documentosOpen ? React.createElement('div', {
    style: {
      position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    },
    onClick: () => setDocumentosOpen(false),
  },
    React.createElement('div', {
      style: {
        background: '#fff', borderRadius: 16, width: '100%', maxWidth: 560, padding: '28px 32px',
        display: 'flex', flexDirection: 'column' as const, gap: 0,
        boxShadow: '0 20px 60px rgba(0,0,0,.15)',
      },
      onClick: (e: React.MouseEvent) => e.stopPropagation(),
    },
      // Header
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 } },
        React.createElement('h2', { style: { fontSize: 18, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } }, 'Documentos'),
        React.createElement('button', {
          type: 'button', onClick: () => setDocumentosOpen(false),
          style: { width: 36, height: 36, borderRadius: '50%', background: '#f1f1f1', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
        }, React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none' },
          React.createElement('path', { d: 'M18 6L6 18M6 6l12 12', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round' })))),
      React.createElement('div', { style: { height: 1, background: '#e2e2e2', marginBottom: 16 } }),
      // Documentos do menor (autorizar_menores) ou do motorista (cadastro_transporte)
      isAutorizarMenores
        ? React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 16 } },
            minorData?.document_url
              ? React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8 } },
                  React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', ...font } }, 'Documento do dependente'),
                  React.createElement('a', {
                    href: minorData.document_url, target: '_blank', rel: 'noopener noreferrer',
                    style: { display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0', borderBottom: '1px solid #f1f1f1' },
                  }, docFileIcon, React.createElement('span', { style: { fontSize: 14, color: '#3b82f6', ...font } }, 'Abrir documento')))
              : React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0' } },
                  docFileIcon, React.createElement('span', { style: { fontSize: 14, color: '#767676', ...font } }, 'Documento do dependente: não enviado')),
            minorData?.representative_document_url
              ? React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8 } },
                  React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', ...font } }, 'Documento do responsável'),
                  React.createElement('a', {
                    href: minorData.representative_document_url, target: '_blank', rel: 'noopener noreferrer',
                    style: { display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0', borderBottom: '1px solid #f1f1f1' },
                  }, docFileIcon, React.createElement('span', { style: { fontSize: 14, color: '#3b82f6', ...font } }, 'Abrir documento')))
              : React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0' } },
                  docFileIcon, React.createElement('span', { style: { fontSize: 14, color: '#767676', ...font } }, 'Documento do responsável: não enviado')))
        : React.createElement(React.Fragment, null,
            supportDocsLoading
              ? React.createElement('p', { style: { fontSize: 14, color: '#767676', margin: '0 0 16px', ...font } }, 'Carregando documentos…')
              : null,
            !supportDocsLoading && !motoristaDocWorkerId
              ? React.createElement('p', { style: { fontSize: 14, color: '#767676', margin: '0 0 16px', ...font } }, 'Não há motorista vinculado a este ticket para exibir documentos.')
              : null,
            ...documentosRowElements),
      // Ver perfil completo
      React.createElement('button', {
        type: 'button', onClick: openPerfilCompletoRelacionado,
        style: {
          width: '100%', height: 48, borderRadius: 999, border: 'none', marginTop: 8,
          background: '#0d0d0d', color: '#fff', fontSize: 16, fontWeight: 600, cursor: 'pointer', ...font,
        },
      }, 'Ver perfil completo'))) : null;

  // ── Viagem modal ───────────────────────────────────────────────────────
  const viagemIconField = (iconPath: string, label: string, value: string) =>
    React.createElement('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 10, flex: '1 1 45%', minWidth: 180 } },
      React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block', flexShrink: 0, marginTop: 2 } },
        React.createElement('path', { d: iconPath, stroke: '#767676', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' })),
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 2 } },
        React.createElement('span', { style: { fontSize: 12, color: '#767676', ...font } }, label),
        React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', ...font } }, value)));

  const viagemModal = viagemOpen ? React.createElement('div', {
    style: {
      position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    },
    onClick: () => setViagemOpen(false),
  },
    React.createElement('div', {
      style: {
        background: '#fff', borderRadius: 16, width: '100%', maxWidth: 560, padding: '28px 32px',
        display: 'flex', flexDirection: 'column' as const, gap: 20,
        boxShadow: '0 20px 60px rgba(0,0,0,.15)',
      },
      onClick: (e: React.MouseEvent) => e.stopPropagation(),
    },
      // Header
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
        React.createElement('h2', { style: { fontSize: 18, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } }, 'Viagem'),
        React.createElement('button', {
          type: 'button', onClick: () => setViagemOpen(false),
          style: { width: 36, height: 36, borderRadius: '50%', background: '#f1f1f1', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
        }, React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none' },
          React.createElement('path', { d: 'M18 6L6 18M6 6l12 12', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round' })))),
      React.createElement('div', { style: { height: 1, background: '#e2e2e2' } }),
      // Fields grid (real data from booking)
      React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap' as const, gap: '20px 16px' } },
        viagemIconField('M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z', 'ID da viagem', viagemRefLinha || '—'),
        viagemIconField('M17 1l4 4-4 4M3 11V9a4 4 0 014-4h14', 'Trecho', trechoLinha || '—'),
        viagemIconField('M19 4H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2zM16 2v4M8 2v4M3 10h18', 'Período', periodoLinha || '—'),
        viagemIconField('M22 11.08V12a10 10 0 11-5.93-9.14M22 4L12 14.01l-3-3', 'Status', viagemStatusLinha || '—')),
      // Buttons
      React.createElement('div', { style: { display: 'flex', gap: 12 } },
        React.createElement('button', {
          type: 'button', onClick: () => { setViagemOpen(false); navigate('/motoristas'); },
          style: {
            flex: 1, height: 48, borderRadius: 999, border: '1px solid #e2e2e2',
            background: '#fff', color: '#0d0d0d', fontSize: 14, fontWeight: 600, cursor: 'pointer', ...font,
          },
        }, 'Ver detalhes do motorista'),
        React.createElement('button', {
          type: 'button', onClick: () => { setViagemOpen(false); navigate('/viagens/0'); },
          style: {
            flex: 1, height: 48, borderRadius: 999, border: 'none',
            background: '#0d0d0d', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', ...font,
          },
        }, 'Ver detalhes completos')))) : null;

  // ── Encomenda modal ────────────────────────────────────────────────────
  const encomendaField = (label: string, value: string) =>
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 2 } },
      React.createElement('span', { style: { fontSize: 12, color: '#767676', ...font } }, label),
      React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', ...font } }, value));

  const encomendaModal = encomendaOpen ? React.createElement('div', {
    style: {
      position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    },
    onClick: () => setEncomendaOpen(false),
  },
    React.createElement('div', {
      style: {
        background: '#fff', borderRadius: 16, width: '100%', maxWidth: 560, padding: '28px 32px',
        display: 'flex', flexDirection: 'column' as const, gap: 20,
        boxShadow: '0 20px 60px rgba(0,0,0,.15)',
      },
      onClick: (e: React.MouseEvent) => e.stopPropagation(),
    },
      // Header
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
        React.createElement('h2', { style: { fontSize: 18, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } }, 'Encomenda'),
        React.createElement('button', {
          type: 'button', onClick: () => setEncomendaOpen(false),
          style: { width: 36, height: 36, borderRadius: '50%', background: '#f1f1f1', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
        }, React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none' },
          React.createElement('path', { d: 'M18 6L6 18M6 6l12 12', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round' })))),
      React.createElement('div', { style: { height: 1, background: '#e2e2e2' } }),
      // Package info row (photo + Tamanho/Valor)
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 16 } },
        encomendaPhotoUrl
          ? React.createElement('img', {
              src: encomendaPhotoUrl, alt: 'Foto da encomenda',
              style: { width: 56, height: 56, borderRadius: 8, objectFit: 'cover' as const, flexShrink: 0 },
            })
          : React.createElement('div', {
              style: { width: 56, height: 56, borderRadius: 8, background: '#f5e6d0', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' },
            }, React.createElement('span', { style: { fontSize: 24 } }, '\uD83D\uDCE6')),
        React.createElement('div', { style: { display: 'flex', gap: 32 } },
          encomendaField('Tamanho:', encomendaPackageSize),
          encomendaField('Valor:', encomendaAmountCents != null ? `R$ ${(encomendaAmountCents / 100).toFixed(2).replace('.', ',')}` : '—'))),
      encomendaField('Remetente:', encomendaSender),
      encomendaField('Destinatário:', encomendaRecipient),
      encomendaField('Recolha:', encomendaOrigem),
      encomendaField('Entrega:', encomendaDestino),
      encomendaInstructions ? encomendaField('Observações:', encomendaInstructions) : null,
      // Buttons
      React.createElement('div', { style: { display: 'flex', gap: 12 } },
        React.createElement('button', {
          type: 'button', onClick: () => { setEncomendaOpen(false); navigate(`/passageiros/${subjectUserId}`, { state: { tab: 'historico', filter: 'encomendas' } }); },
          style: {
            flex: 1, height: 48, borderRadius: 999, border: '1px solid #e2e2e2',
            background: '#fff', color: '#0d0d0d', fontSize: 14, fontWeight: 600, cursor: 'pointer', ...font,
          },
        }, 'Ver todas as encomendas'),
        React.createElement('button', {
          type: 'button', onClick: () => { setEncomendaOpen(false); navigate(`/passageiros/${subjectUserId}`); },
          style: {
            flex: 1, height: 48, borderRadius: 999, border: 'none',
            background: '#0d0d0d', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', ...font,
          },
        }, 'Ver detalhes completos')))) : null;

  // ── Solicitação modal (dynamic based on category) ──────────────────────
  const solRF = (label: string, value: string, flex = '1 1 0') =>
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4, flex, minWidth: 120 } },
      React.createElement('span', { style: { fontSize: 12, fontWeight: 500, color: '#767676', ...font } }, label),
      React.createElement('div', { style: { height: 44, borderRadius: 8, background: '#f1f1f1', padding: '0 16px', display: 'flex', alignItems: 'center', fontSize: 14, color: '#0d0d0d', ...font } }, value));

  const solCheckbox = (checked: boolean, label: string) =>
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 } },
      React.createElement('div', {
        style: { width: 22, height: 22, borderRadius: 4, border: checked ? 'none' : '2px solid #d9d9d9', background: checked ? '#0d0d0d' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxSizing: 'border-box' as const },
      }, checked ? React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none' },
        React.createElement('path', { d: 'M20 6L9 17l-5-5', stroke: '#fff', strokeWidth: 3, strokeLinecap: 'round', strokeLinejoin: 'round' })) : null),
      React.createElement('span', { style: { fontSize: 14, color: '#0d0d0d', ...font } }, label));

  const solRadio = (selected: boolean, label: string) =>
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
      React.createElement('div', { style: { width: 20, height: 20, borderRadius: '50%', border: '2px solid #0d0d0d', display: 'flex', alignItems: 'center', justifyContent: 'center' } },
        selected ? React.createElement('div', { style: { width: 10, height: 10, borderRadius: '50%', background: '#0d0d0d' } }) : null),
      React.createElement('span', { style: { fontSize: 14, color: '#0d0d0d', ...font } }, label));

  const solDocRow = (section: string, file: string, hasWarning = false) =>
    React.createElement(React.Fragment, null,
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 } },
        hasWarning ? React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block', flexShrink: 0 } },
          React.createElement('circle', { cx: 12, cy: 12, r: 10, stroke: '#cba04b', strokeWidth: 2 }),
          React.createElement('path', { d: 'M12 8v4M12 16h.01', stroke: '#cba04b', strokeWidth: 2, strokeLinecap: 'round' })) : null,
        React.createElement('span', { style: { fontSize: 13, fontWeight: 500, color: '#0d0d0d', ...font } }, section)),
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f1f1f1' } },
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block', flexShrink: 0 } },
            React.createElement('path', { d: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z', stroke: '#767676', strokeWidth: 2 }),
            React.createElement('path', { d: 'M14 2v6h6', stroke: '#767676', strokeWidth: 2 })),
          React.createElement('span', { style: { fontSize: 13, color: '#0d0d0d', ...font } }, file)),
        React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block', cursor: 'pointer' } },
          React.createElement('path', { d: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3', stroke: '#767676', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }))));

  const isPreparadorEncomendas = categoria.toLowerCase().includes('cadastro de transporte') || categoria.toLowerCase().includes('preparador de encomendas');
  const isPreparadorExcursoes = categoria.toLowerCase().includes('preparador de excursões');

  // Build modal body based on type
  const solicitacaoBody = (() => {
    if (isPreparadorEncomendas) {
      // Cadastro de preparador de encomendas
      return [
        solRF('Tipo da solicitação', 'Cadastro de preparador de encomendas', '1 1 100%'),
        solRF('Nome completo', 'Digite seu nome completo', '1 1 100%'),
        React.createElement('div', { key: 'cpf-idade', style: { display: 'flex', gap: 16 } }, solRF('CPF', 'Ex: 123.456.789-99'), solRF('Idade', 'Ex: 25 anos')),
        React.createElement('div', { key: 'cid-exp', style: { display: 'flex', gap: 16 } }, solRF('Cidade', 'Digite sua cidade'), solRF('Anos de experiência', 'Ex: 5 anos')),
        React.createElement('span', { key: 'db', style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', ...font } }, 'Dados bancários'),
        React.createElement('div', { key: 'bank', style: { display: 'flex', gap: 16 } }, solRF('Banco', 'Ex: 0001'), solRF('Agência', 'Ex: 0240')),
        React.createElement('div', { key: 'conta', style: { display: 'flex', gap: 16 } }, solRF('Conta', 'Ex: 12345678-9'), solRF('Chave Pix', 'Ex: mario@gmail.com')),
        React.createElement('span', { key: 'vt', style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', ...font } }, 'Veículo de transporte'),
        React.createElement('span', { key: 'vp', style: { fontSize: 13, color: '#767676', ...font } }, 'Possui veículo próprio?'),
        React.createElement('div', { key: 'radio-v', style: { display: 'flex', gap: 24 } }, solRadio(true, 'Sim'), solRadio(false, 'Não')),
        React.createElement('div', { key: 'ano-mod', style: { display: 'flex', gap: 16 } }, solRF('Ano do veículo', 'Ex: 2018'), solRF('Modelo', 'Ex: Honda CG 160 Start')),
        solRF('Chassi', 'Ex: 9 BR BLWHEXG0 1 07721', '1 1 100%'),
        React.createElement('div', { key: 'docs', style: { display: 'flex', flexDirection: 'column' as const } },
          solDocRow('CNH (frente e verso)', 'documento_do_carro.pdf'),
          solDocRow('Antecedentes Criminais', 'atencedentes_criminais.pdf', true),
          solDocRow('Documento do veículo', 'documentos_do_veiculo.pdf')),
        React.createElement('span', { key: 'val', style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', ...font } }, 'Valores e precificação'),
        React.createElement('span', { key: 'vs', style: { fontSize: 12, color: '#767676', ...font } }, 'Valores de serviço'),
        solRF('Valor por entrega (R$)', 'R$ 15,00', '1 1 100%'),
        React.createElement('span', { key: 'vs2', style: { fontSize: 11, color: '#767676', ...font } }, 'Valor padrão por entrega concluída.'),
        solRF('Valor por km (R$)', 'R$ 2,50', '1 1 100%'),
        React.createElement('span', { key: 'vs3', style: { fontSize: 11, color: '#767676', ...font } }, 'Cobra de acordo com a distância percorrida.'),
      ];
    } else if (isPreparadorExcursoes) {
      // Cadastro de preparador de excursões
      return [
        solRF('Tipo da solicitação', 'Cadastro de preparador de excursões', '1 1 100%'),
        React.createElement('div', { key: 'docs', style: { display: 'flex', flexDirection: 'column' as const } },
          solDocRow('CNH (frente e verso)', 'documento_do_carro.pdf'),
          solDocRow('Antecedentes Criminais', 'atencedentes_criminais.pdf', true),
          solDocRow('Documento do veículo', 'documentos_do_veiculo.pdf')),
        React.createElement('span', { key: 'val', style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', ...font } }, 'Valores e precificação'),
        React.createElement('div', { key: 'radio-p', style: { display: 'flex', gap: 24 } }, solRadio(false, 'Valor por hora'), solRadio(true, 'Valor por diária')),
        solRF('Preço por diária', 'Ex: R$ 250,00', '1 1 100%'),
        React.createElement('span', { key: 'pd', style: { fontSize: 11, color: '#767676', ...font } }, 'Valor padrão por período de trabalho.'),
        solRF('Preço noturno (18h–4:59h)', 'Ex: R$ 280,00', '1 1 100%'),
        React.createElement('span', { key: 'pn', style: { fontSize: 11, color: '#767676', ...font } }, 'Serviços realizados no período noturno.'),
        solRF('Domingos e feriados', 'Ex: R$ 300,00', '1 1 100%'),
        React.createElement('span', { key: 'df', style: { fontSize: 11, color: '#767676', ...font } }, 'Valor para dias de alta demanda.'),
      ];
    } else if (rawCategory === 'outros' || rawCategory === 'ouvidoria' || rawCategory === 'denuncia' || rawCategory === 'reembolso') {
      // Genérico — mostra mensagem/reclamação do cliente
      return [
        solRF('Tipo da solicitação', categoryLabelPt[rawCategory] || rawCategory, '1 1 100%'),
        complaintBody
          ? React.createElement('div', { key: 'complaint', style: { display: 'flex', flexDirection: 'column' as const, gap: 4 } },
              React.createElement('span', { style: { fontSize: 12, fontWeight: 500, color: '#767676', ...font } }, 'Mensagem do cliente'),
              React.createElement('div', {
                style: { padding: 16, background: '#f1f1f1', borderRadius: 8, fontSize: 14, color: '#0d0d0d', lineHeight: 1.5, whiteSpace: 'pre-wrap' as const, ...font },
              }, complaintBody))
          : React.createElement('p', { key: 'nc', style: { fontSize: 14, color: '#767676', ...font } }, 'Nenhuma mensagem registrada.'),
      ];
    } else {
      // Solicitação de excursão (default)
      const solServicos = [
        { label: 'Equipe de primeiros socorros', checked: true },
        { label: 'Equipe de recreação', checked: true },
        { label: 'Equipe especializada em crianças', checked: false },
        { label: 'Equipe para pessoas com necessidades especiais', checked: false },
      ];
      const solItens = [{ obj: 'Bolas de futebol', qty: '8' }, { obj: 'Bóias', qty: '5' }, { obj: 'Bolas de basquete', qty: '3' }];
      return [
        solRF('Tipo da solicitação', 'Solicitação de excursão', '1 1 100%'),
        React.createElement('div', { key: 'dest', style: { display: 'flex', gap: 16 } }, solRF('Destino da excursão', 'Viana - MA'), solRF('Data da excursão', '10/11/2025')),
        React.createElement('div', { key: 'qty', style: { display: 'flex', gap: 16 } }, solRF('Quantidade de pessoas', '25'), solRF('Tipo de frota', 'Micro-ônibus')),
        React.createElement('span', { key: 'sa', style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', ...font } }, 'Serviços adicionais'),
        React.createElement('div', { key: 'sac' }, ...solServicos.map((s) => solCheckbox(s.checked, s.label))),
        React.createElement('span', { key: 'ir', style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', ...font } }, 'Itens de Recreação'),
        React.createElement('div', { key: 'irt', style: { border: '1px solid #e2e2e2', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column' as const, gap: 8 } },
          React.createElement('div', { style: { display: 'flex', gap: 16 } },
            React.createElement('span', { style: { flex: 1, fontSize: 12, fontWeight: 500, color: '#767676', ...font } }, 'Objetos de recreação'),
            React.createElement('span', { style: { flex: '0 0 80px', fontSize: 12, fontWeight: 500, color: '#767676', ...font } }, 'Quantidade')),
          ...solItens.map((item, i) =>
            React.createElement('div', { key: i, style: { display: 'flex', gap: 16 } },
              React.createElement('div', { style: { flex: 1, height: 40, borderRadius: 8, background: '#f1f1f1', padding: '0 12px', display: 'flex', alignItems: 'center', fontSize: 14, color: '#0d0d0d', ...font } }, item.obj),
              React.createElement('div', { style: { flex: '0 0 80px', height: 40, borderRadius: 8, background: '#f1f1f1', padding: '0 12px', display: 'flex', alignItems: 'center', fontSize: 14, color: '#0d0d0d', ...font } }, item.qty)))),
        React.createElement('span', { key: 'da', style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', ...font } }, 'Detalhes adicionais'),
        React.createElement('div', { key: 'obs', style: { display: 'flex', flexDirection: 'column' as const, gap: 4 } },
          React.createElement('span', { style: { fontSize: 12, fontWeight: 500, color: '#767676', ...font } }, 'Observações'),
          React.createElement('textarea', {
            readOnly: true, defaultValue: 'Inclua detalhes adicionais sobre a excursão.',
            style: { width: '100%', minHeight: 80, borderRadius: 8, border: '1px solid #e2e2e2', padding: 12, fontSize: 14, color: '#767676', resize: 'vertical' as const, outline: 'none', boxSizing: 'border-box' as const, ...font },
          })),
      ];
    }
  })();

  const solicitacaoModal = solicitacaoOpen ? React.createElement('div', {
    style: {
      position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    },
    onClick: () => setSolicitacaoOpen(false),
  },
    React.createElement('div', {
      style: {
        background: '#fff', borderRadius: 16, width: '100%', maxWidth: 520, padding: '28px 32px',
        display: 'flex', flexDirection: 'column' as const, gap: 16,
        boxShadow: '0 20px 60px rgba(0,0,0,.15)', maxHeight: '90vh', overflowY: 'auto' as const,
      },
      onClick: (e: React.MouseEvent) => e.stopPropagation(),
    },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
        React.createElement('h2', { style: { fontSize: 18, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } }, 'Solicitação'),
        React.createElement('button', {
          type: 'button', onClick: () => setSolicitacaoOpen(false),
          style: { width: 36, height: 36, borderRadius: '50%', background: '#f1f1f1', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
        }, React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none' },
          React.createElement('path', { d: 'M18 6L6 18M6 6l12 12', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round' })))),
      React.createElement('div', { style: { height: 1, background: '#e2e2e2' } }),
      ...solicitacaoBody)) : null;

  // ── Pagamento modal ────────────────────────────────────────────────────
  const pagField = (label: string, value: string, flex = '1 1 0') =>
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4, flex, minWidth: 140 } },
      React.createElement('span', { style: { fontSize: 12, fontWeight: 500, color: '#767676', ...font } }, label),
      React.createElement('div', {
        style: { height: 44, borderRadius: 8, background: '#f1f1f1', padding: '0 16px', display: 'flex', alignItems: 'center', fontSize: 14, color: '#0d0d0d', ...font },
      }, value));

  const pagamentoModal = pagamentoOpen ? React.createElement('div', {
    style: {
      position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    },
    onClick: () => setPagamentoOpen(false),
  },
    React.createElement('div', {
      style: {
        background: '#fff', borderRadius: 16, width: '100%', maxWidth: 560, padding: '28px 32px',
        display: 'flex', flexDirection: 'column' as const, gap: 20,
        boxShadow: '0 20px 60px rgba(0,0,0,.15)',
      },
      onClick: (e: React.MouseEvent) => e.stopPropagation(),
    },
      // Header
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
        React.createElement('h2', { style: { fontSize: 18, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } }, 'Pagamento'),
        React.createElement('button', {
          type: 'button', onClick: () => setPagamentoOpen(false),
          style: { width: 36, height: 36, borderRadius: '50%', background: '#f1f1f1', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
        }, React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none' },
          React.createElement('path', { d: 'M18 6L6 18M6 6l12 12', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round' })))),
      React.createElement('div', { style: { height: 1, background: '#e2e2e2' } }),
      // Fields
      React.createElement('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap' as const } },
        pagField('Valor total', 'R$ 154,00'),
        pagField('Método de pagamento', 'Cartão de crédito')),
      pagField('Nome do cartão', 'Matheus Rodrigues Silva', '1 1 100%'),
      React.createElement('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap' as const } },
        pagField('Número do cartão', '0110 1624 2432 6472'),
        pagField('Validade', '06/28')),
      React.createElement('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap' as const } },
        pagField('Validade', '06/28'),
        pagField('CVV', '465')),
      // Buttons
      React.createElement('div', { style: { display: 'flex', gap: 12 } },
        React.createElement('button', {
          type: 'button', onClick: () => { setPagamentoOpen(false); setCadastrarPagOpen(true); },
          style: {
            flex: 1, height: 48, borderRadius: 999, border: '1px solid #e2e2e2',
            background: '#fff', color: '#0d0d0d', fontSize: 14, fontWeight: 600, cursor: 'pointer', ...font,
          },
        }, 'Cadastrar pagamento'),
        React.createElement('button', {
          type: 'button', onClick: () => { setPagamentoOpen(false); navigate('/pagamentos'); },
          style: {
            flex: 1, height: 48, borderRadius: 999, border: 'none',
            background: '#0d0d0d', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', ...font,
          },
        }, 'Ver detalhes completos')))) : null;

  // ── Cadastrar Pagamento modal ──────────────────────────────────────────
  const cadastrarPagModal = cadastrarPagOpen ? React.createElement('div', {
    style: {
      position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    },
    onClick: () => setCadastrarPagOpen(false),
  },
    React.createElement('div', {
      style: {
        background: '#fff', borderRadius: 16, width: '100%', maxWidth: 560, padding: '28px 32px',
        display: 'flex', flexDirection: 'column' as const, gap: 20,
        boxShadow: '0 20px 60px rgba(0,0,0,.15)',
      },
      onClick: (e: React.MouseEvent) => e.stopPropagation(),
    },
      // Header
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
        React.createElement('h2', { style: { fontSize: 18, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } }, 'Cadastrar pagamento'),
        React.createElement('button', {
          type: 'button', onClick: () => setCadastrarPagOpen(false),
          style: { width: 36, height: 36, borderRadius: '50%', background: '#f1f1f1', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
        }, React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none' },
          React.createElement('path', { d: 'M18 6L6 18M6 6l12 12', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round' })))),
      React.createElement('div', { style: { height: 1, background: '#e2e2e2' } }),
      // Valor total + Método
      React.createElement('div', { style: { display: 'flex', gap: 16 } },
        React.createElement('div', { style: { flex: 1, display: 'flex', flexDirection: 'column' as const, gap: 4 } },
          React.createElement('span', { style: { fontSize: 12, fontWeight: 500, color: '#767676', ...font } }, 'Valor total'),
          React.createElement('input', { type: 'text', placeholder: 'Insira o valor total', style: { height: 44, borderRadius: 8, border: '1px solid #e2e2e2', padding: '0 16px', fontSize: 14, color: '#0d0d0d', outline: 'none', background: '#f1f1f1', ...font } })),
        React.createElement('div', { style: { flex: 1, display: 'flex', flexDirection: 'column' as const, gap: 4 } },
          React.createElement('span', { style: { fontSize: 12, fontWeight: 500, color: '#767676', ...font } }, 'Método de pagamento'),
          React.createElement('input', { type: 'text', placeholder: 'Selecione o método', style: { height: 44, borderRadius: 8, border: '1px solid #e2e2e2', padding: '0 16px', fontSize: 14, color: '#0d0d0d', outline: 'none', background: '#f1f1f1', ...font } }))),
      // Nome do cartão
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4 } },
        React.createElement('span', { style: { fontSize: 12, fontWeight: 500, color: '#767676', ...font } }, 'Nome do cartão'),
        React.createElement('input', { type: 'text', defaultValue: 'Matheus Rodrigues Silva', style: { height: 44, borderRadius: 8, border: '1px solid #e2e2e2', padding: '0 16px', fontSize: 14, color: '#0d0d0d', outline: 'none', width: '100%', boxSizing: 'border-box' as const, ...font } })),
      // Número do cartão
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4 } },
        React.createElement('span', { style: { fontSize: 12, fontWeight: 500, color: '#767676', ...font } }, 'Número do cartão'),
        React.createElement('input', { type: 'text', defaultValue: '0110 1624 2432 6472', style: { height: 44, borderRadius: 8, border: '1px solid #e2e2e2', padding: '0 16px', fontSize: 14, color: '#0d0d0d', outline: 'none', width: '100%', boxSizing: 'border-box' as const, ...font } })),
      // Validade full width
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4 } },
        React.createElement('span', { style: { fontSize: 12, fontWeight: 500, color: '#767676', ...font } }, 'Validade'),
        React.createElement('input', { type: 'text', defaultValue: '06/28', style: { height: 44, borderRadius: 8, border: '1px solid #e2e2e2', padding: '0 16px', fontSize: 14, color: '#0d0d0d', outline: 'none', width: '100%', boxSizing: 'border-box' as const, ...font } })),
      // Validade + CVV
      React.createElement('div', { style: { display: 'flex', gap: 16 } },
        React.createElement('div', { style: { flex: 1, display: 'flex', flexDirection: 'column' as const, gap: 4 } },
          React.createElement('span', { style: { fontSize: 12, fontWeight: 500, color: '#767676', ...font } }, 'Validade'),
          React.createElement('input', { type: 'text', defaultValue: '06/28', style: { height: 44, borderRadius: 8, border: '1px solid #e2e2e2', padding: '0 16px', fontSize: 14, color: '#0d0d0d', outline: 'none', ...font } })),
        React.createElement('div', { style: { flex: 1, display: 'flex', flexDirection: 'column' as const, gap: 4 } },
          React.createElement('span', { style: { fontSize: 12, fontWeight: 500, color: '#767676', ...font } }, 'CVV'),
          React.createElement('input', { type: 'text', defaultValue: '465', style: { height: 44, borderRadius: 8, border: '1px solid #e2e2e2', padding: '0 16px', fontSize: 14, color: '#0d0d0d', outline: 'none', ...font } }))),
      // Buttons
      React.createElement('button', {
        type: 'button', onClick: () => { setCadastrarPagOpen(false); showToast('Pagamento cadastrado'); },
        style: {
          width: '100%', height: 48, borderRadius: 999, border: 'none',
          background: '#0d0d0d', color: '#fff', fontSize: 16, fontWeight: 600, cursor: 'pointer', ...font,
        },
      }, 'Salvar'),
      React.createElement('button', {
        type: 'button', onClick: () => setCadastrarPagOpen(false),
        style: {
          width: '100%', height: 48, borderRadius: 999, border: 'none',
          background: 'transparent', color: '#b53838', fontSize: 16, fontWeight: 600, cursor: 'pointer', ...font, textAlign: 'center' as const,
        },
      }, 'Cancelar'))) : null;

  // ── Alterar status modal ───────────────────────────────────────────────
  const statusChipOpts = [
    { key: 'todos', label: 'Todos' },
    { key: 'nao_atendida', label: 'Não atendida' },
    { key: 'em_atendimento', label: 'Em atendimento' },
    { key: 'atrasada', label: 'Atrasada' },
  ];

  const editStatusModal = editStatusOpen ? React.createElement('div', {
    style: {
      position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    },
    onClick: () => setEditStatusOpen(false),
  },
    React.createElement('div', {
      style: {
        background: '#fff', borderRadius: 16, width: '100%', maxWidth: 480, padding: '28px 32px',
        display: 'flex', flexDirection: 'column' as const, gap: 24,
        boxShadow: '0 20px 60px rgba(0,0,0,.15)',
      },
      onClick: (e: React.MouseEvent) => e.stopPropagation(),
    },
      // Header
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
        React.createElement('h2', { style: { fontSize: 18, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } }, 'Alterar status'),
        React.createElement('button', {
          type: 'button', onClick: () => setEditStatusOpen(false),
          style: { width: 36, height: 36, borderRadius: '50%', background: '#f1f1f1', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
        }, React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none' },
          React.createElement('path', { d: 'M18 6L6 18M6 6l12 12', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round' })))),
      // Separator
      React.createElement('div', { style: { height: 1, background: '#e2e2e2' } }),
      // Status label + chips
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 12 } },
        React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', ...font } }, 'Status'),
        React.createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' as const } },
          ...statusChipOpts.map((opt) =>
            React.createElement('button', {
              key: opt.key, type: 'button',
              onClick: () => setTempStatus(opt.key),
              style: {
                height: 36, padding: '0 16px', borderRadius: 999,
                border: tempStatus === opt.key ? 'none' : '1px solid #e2e2e2',
                background: tempStatus === opt.key ? '#0d0d0d' : '#fff',
                color: tempStatus === opt.key ? '#fff' : '#0d0d0d',
                fontSize: 14, fontWeight: 500, cursor: 'pointer', ...font,
              },
            }, opt.label)))),
      // Buttons
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 12 } },
        React.createElement('button', {
          type: 'button',
          onClick: () => { if (tempStatus !== 'todos') setCurrentStatus(tempStatus); setEditStatusOpen(false); },
          style: {
            width: '100%', height: 48, borderRadius: 999, border: 'none',
            background: '#0d0d0d', color: '#fff', fontSize: 16, fontWeight: 600, cursor: 'pointer', ...font,
          },
        }, 'Salvar alterações'),
        React.createElement('button', {
          type: 'button', onClick: () => setEditStatusOpen(false),
          style: {
            width: '100%', height: 48, borderRadius: 999, border: '1px solid #e2e2e2',
            background: '#fff', color: '#b53838', fontSize: 16, fontWeight: 600, cursor: 'pointer', ...font,
          },
        }, 'Cancelar')))) : null;

  // ── Reprovar modal ─────────────────────────────────────────────────────
  const isPreparador = workerSubtype === 'excursions' || workerSubtype === 'shipments';
  const reprovarTitle = isExcursao ? 'Deseja realmente reprovar esta excursão?' : isEncomenda ? 'Deseja realmente rejeitar esta encomenda?' : isAutorizarMenores ? 'Deseja realmente negar esta autorização?' : isPreparador ? 'Deseja realmente reprovar este preparador?' : 'Deseja realmente reprovar este cadastro?';
  const reprovarModal = reprovarOpen ? React.createElement('div', {
    style: {
      position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    },
    onClick: () => setReprovarOpen(false),
  },
    React.createElement('div', {
      style: {
        background: '#fff', borderRadius: 16, width: '100%', maxWidth: 440, padding: '28px 32px',
        display: 'flex', flexDirection: 'column' as const, gap: 24,
        boxShadow: '0 20px 60px rgba(0,0,0,.15)',
      },
      onClick: (e: React.MouseEvent) => e.stopPropagation(),
    },
      // Header
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
        React.createElement('h2', { style: { fontSize: 18, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } }, reprovarTitle),
        React.createElement('button', {
          type: 'button', onClick: () => setReprovarOpen(false),
          style: { width: 36, height: 36, borderRadius: '50%', background: '#f1f1f1', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
        }, React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none' },
          React.createElement('path', { d: 'M18 6L6 18M6 6l12 12', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round' })))),
      // Separator
      React.createElement('div', { style: { height: 1, background: '#e2e2e2' } }),
      // Buttons
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 12 } },
        React.createElement('button', {
          type: 'button',
          disabled: reprovarSubmitting,
          onClick: async () => {
            if (rawCategory === 'encomendas') {
              const sid = (ctxJson.shipment_id as string) || (ctxJson.dependent_shipment_id as string);
              if (!sid) { showToast('Encomenda não encontrada.'); return; }
              setReprovarSubmitting(true);
              const { error } = encomendaShipmentKind === 'dependent_shipment'
                ? await updateDependentShipmentStatus(String(sid), 'cancelled')
                : await updateShipmentStatus(String(sid), 'cancelled');
              setReprovarSubmitting(false);
              if (error) { showToast(`Erro ao rejeitar: ${error}`); return; }
              setEncomendaShipmentStatus('cancelled');
              if (conversationId) {
                await (supabase as any).rpc('close_support_conversation', { p_conversation_id: conversationId, p_finish_note: 'Encomenda rejeitada' });
              }
              setReprovarOpen(false);
              showToast('Encomenda rejeitada');
              setTimeout(() => navigate('/atendimentos'), 1500);
              return;
            }
            if (rawCategory === 'autorizar_menores') {
              const depId = (ctxJson.dependent_id as string) || minorData?.id;
              if (!depId) { showToast('Dependente não encontrado.'); return; }
              setReprovarSubmitting(true);
              const { error } = await (supabase as any).from('dependents').update({ status: 'rejected' }).eq('id', depId);
              setReprovarSubmitting(false);
              if (error) { showToast(`Erro ao negar: ${error.message || error}`); return; }
              if (conversationId) {
                await (supabase as any).rpc('close_support_conversation', { p_conversation_id: conversationId, p_finish_note: 'Autorização de menor negada' });
              }
              setReprovarOpen(false);
              showToast('Autorização negada');
              setTimeout(() => navigate('/atendimentos'), 1500);
              return;
            }
            if (rawCategory === 'cadastro_transporte') {
              const wid = (typeof ctxJson.worker_id === 'string' && ctxJson.worker_id.trim()) || subjectUserId;
              if (!wid) {
                showToast('Não foi possível identificar o motorista.');
                return;
              }
              setReprovarSubmitting(true);
              const { error } = await updateWorkerStatus(wid, 'rejected');
              setReprovarSubmitting(false);
              if (error) {
                showToast(`Erro ao reprovar: ${error}`);
                return;
              }
              setWorkerCadastroStatus('rejected');
            }
            setReprovarOpen(false);
            showToast(isPreparador ? 'Preparador reprovado' : 'Cadastro reprovado');
            setTimeout(() => navigate('/atendimentos'), 1500);
          },
          style: {
            width: '100%', height: 48, borderRadius: 999, border: 'none',
            background: '#0d0d0d', color: '#fff', fontSize: 16, fontWeight: 600, cursor: reprovarSubmitting ? 'wait' : 'pointer', opacity: reprovarSubmitting ? 0.65 : 1, ...font,
          },
        }, reprovarSubmitting ? 'Reprovando…' : 'Sim, reprovar'),
        React.createElement('button', {
          type: 'button', onClick: () => setReprovarOpen(false),
          style: {
            width: '100%', height: 48, borderRadius: 999, border: '1px solid #e2e2e2',
            background: '#fff', color: '#b53838', fontSize: 16, fontWeight: 600, cursor: 'pointer', ...font,
          },
        }, 'Cancelar')))) : null;

  // ── Autorizar modal ────────────────────────────────────────────────────
  const autorizarModal = autorizarOpen ? React.createElement('div', {
    style: {
      position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    },
    onClick: () => setAutorizarOpen(false),
  },
    React.createElement('div', {
      style: {
        background: '#fff', borderRadius: 16, width: '100%', maxWidth: 440, padding: '28px 32px',
        display: 'flex', flexDirection: 'column' as const, gap: 24,
        boxShadow: '0 20px 60px rgba(0,0,0,.15)',
      },
      onClick: (e: React.MouseEvent) => e.stopPropagation(),
    },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
        React.createElement('h2', { style: { fontSize: 18, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } }, isEncomenda ? 'Deseja realmente aprovar esta encomenda?' : isAutorizarMenores ? 'Deseja realmente autorizar este menor?' : isPreparador ? 'Deseja realmente autorizar este preparador?' : 'Deseja realmente aprovar este cadastro?'),
        React.createElement('button', {
          type: 'button', onClick: () => setAutorizarOpen(false),
          style: { width: 36, height: 36, borderRadius: '50%', background: '#f1f1f1', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
        }, React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none' },
          React.createElement('path', { d: 'M18 6L6 18M6 6l12 12', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round' })))),
      React.createElement('div', { style: { height: 1, background: '#e2e2e2' } }),
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 12 } },
        React.createElement('button', {
          type: 'button',
          disabled: autorizarSubmitting,
          onClick: async () => {
            if (rawCategory === 'encomendas') {
              const sid = (ctxJson.shipment_id as string) || (ctxJson.dependent_shipment_id as string);
              if (!sid) { showToast('Encomenda não encontrada.'); return; }
              setAutorizarSubmitting(true);
              const { error } = encomendaShipmentKind === 'dependent_shipment'
                ? await updateDependentShipmentStatus(String(sid), 'confirmed')
                : await updateShipmentStatus(String(sid), 'confirmed');
              setAutorizarSubmitting(false);
              if (error) { showToast(`Erro ao aprovar: ${error}`); return; }
              setEncomendaShipmentStatus('confirmed');
              if (conversationId) {
                await (supabase as any).rpc('close_support_conversation', { p_conversation_id: conversationId, p_finish_note: 'Encomenda aprovada' });
              }
              setAutorizarOpen(false);
              showToast('Encomenda aprovada');
              setTimeout(() => navigate('/atendimentos'), 1500);
              return;
            }
            if (rawCategory === 'autorizar_menores') {
              const depId = (ctxJson.dependent_id as string) || minorData?.id;
              if (!depId) { showToast('Dependente não encontrado.'); return; }
              setAutorizarSubmitting(true);
              const { error } = await (supabase as any).from('dependents').update({ status: 'validated' }).eq('id', depId);
              setAutorizarSubmitting(false);
              if (error) { showToast(`Erro ao autorizar: ${error.message || error}`); return; }
              if (conversationId) {
                await (supabase as any).rpc('close_support_conversation', { p_conversation_id: conversationId, p_finish_note: 'Menor autorizado' });
              }
              setAutorizarOpen(false);
              showToast('Menor autorizado');
              setTimeout(() => navigate('/atendimentos'), 1500);
              return;
            }
            if (rawCategory === 'cadastro_transporte') {
              const wid = (typeof ctxJson.worker_id === 'string' && ctxJson.worker_id.trim()) || subjectUserId;
              if (!wid) {
                showToast('Não foi possível identificar o motorista.');
                return;
              }
              setAutorizarSubmitting(true);
              const { error } = await updateWorkerStatus(wid, 'approved');
              setAutorizarSubmitting(false);
              if (error) {
                showToast(`Erro ao aprovar: ${error}`);
                return;
              }
              setWorkerCadastroStatus('approved');
            }
            setAutorizarOpen(false);
            showToast(isPreparador ? 'Preparador autorizado' : 'Cadastro aprovado');
            setTimeout(() => navigate('/atendimentos'), 1500);
          },
          style: {
            width: '100%', height: 48, borderRadius: 999, border: 'none',
            background: '#0d0d0d', color: '#fff', fontSize: 16, fontWeight: 600, cursor: autorizarSubmitting ? 'wait' : 'pointer', opacity: autorizarSubmitting ? 0.65 : 1, ...font,
          },
        }, autorizarSubmitting ? 'Aprovando…' : 'Sim, aprovar'),
        React.createElement('button', {
          type: 'button', onClick: () => setAutorizarOpen(false),
          style: {
            width: '100%', height: 48, borderRadius: 999, border: '1px solid #e2e2e2',
            background: '#fff', color: '#b53838', fontSize: 16, fontWeight: 600, cursor: 'pointer', ...font,
          },
        }, 'Cancelar')))) : null;

  // ── Finalizar modal ────────────────────────────────────────────────────
  const finalizarModal = finalizarOpen ? React.createElement('div', {
    style: {
      position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    },
    onClick: () => setFinalizarOpen(false),
  },
    React.createElement('div', {
      style: {
        background: '#fff', borderRadius: 16, width: '100%', maxWidth: 440, padding: '28px 32px',
        display: 'flex', flexDirection: 'column' as const, gap: 24,
        boxShadow: '0 20px 60px rgba(0,0,0,.15)',
      },
      onClick: (e: React.MouseEvent) => e.stopPropagation(),
    },
      // Header
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
        React.createElement('h2', { style: { fontSize: 18, fontWeight: 700, color: '#0d0d0d', margin: 0, ...font } }, 'Deseja finalizar este atendimento?'),
        React.createElement('button', {
          type: 'button', onClick: () => setFinalizarOpen(false),
          style: { width: 36, height: 36, borderRadius: '50%', background: '#f1f1f1', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
        }, React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none' },
          React.createElement('path', { d: 'M18 6L6 18M6 6l12 12', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round' })))),
      // Separator
      React.createElement('div', { style: { height: 1, background: '#e2e2e2' } }),
      React.createElement('label', { style: { fontSize: 13, fontWeight: 500, color: '#767676', ...font } }, 'Observação de finalização (opcional)'),
      React.createElement('textarea', {
        value: finishNoteDraft,
        onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setFinishNoteDraft(e.target.value),
        rows: 3,
        placeholder: 'Ex.: reembolso autorizado, cadastro aprovado…',
        style: {
          width: '100%', boxSizing: 'border-box' as const, borderRadius: 8, border: '1px solid #e2e2e2',
          padding: 12, fontSize: 14, fontFamily: 'Inter, sans-serif', resize: 'vertical' as const,
        },
      }),
      // Buttons
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 12 } },
        React.createElement('button', {
          type: 'button',
          onClick: async () => {
            if (isSupabaseConfigured && conversationId) {
              const note = finishNoteDraft.trim();
              const { error } = await (supabase as any).rpc('close_support_conversation', {
                p_conversation_id: conversationId,
                p_finish_note: note.length ? note : null,
              });
              if (error) {
                const msg = String(error.message || '');
                if (/forbidden/i.test(msg)) {
                  showToast('Sem permissão para finalizar este atendimento.');
                } else if (/not_found/i.test(msg)) {
                  showToast('Atendimento não encontrado.');
                } else if (/not_authenticated/i.test(msg)) {
                  showToast('Sessão expirada. Entre novamente.');
                } else {
                  showToast(`Não foi possível finalizar: ${msg}`);
                }
                return;
              }
            }
            setCurrentStatus('finalizada');
            setConvStatus('closed');
            setFinalizarOpen(false);
            setFinishNoteDraft('');
            showToast('Atendimento finalizado');
            setTimeout(() => navigate('/atendimentos'), 1500);
          },
          style: {
            width: '100%', height: 48, borderRadius: 999, border: 'none',
            background: '#0d0d0d', color: '#fff', fontSize: 16, fontWeight: 600, cursor: 'pointer', ...font,
          },
        }, 'Finalizar'),
        React.createElement('button', {
          type: 'button', onClick: () => setFinalizarOpen(false),
          style: {
            width: '100%', height: 48, borderRadius: 999, border: '1px solid #e2e2e2',
            background: '#fff', color: '#b53838', fontSize: 16, fontWeight: 600, cursor: 'pointer', ...font,
          },
        }, 'Cancelar')))) : null;

  // ── Main layout ───────────────────────────────────────────────────────
  return React.createElement(React.Fragment, null,
    React.createElement('div', {
      style: {
        display: 'flex', alignItems: 'stretch',
        width: '100vw', minHeight: 'calc(100vh - 97px)',
        marginLeft: 'calc(-50vw + 50%)', marginTop: -24, marginBottom: -64,
        background: '#fff',
      },
    }, leftPanel, rightPanel),
    chatPanel,
    refundModal,
    vehicleAuthModal,
    minorAuthModal,
    dadosCadastraisModal,
    documentosModal,
    encomendaModal,
    viagemModal,
    pagamentoModal,
    solicitacaoModal,
    cadastrarPagModal,
    editStatusModal,
    reprovarModal,
    autorizarModal,
    finalizarModal,
    // Toast
    toastMsg ? React.createElement('div', {
      style: {
        position: 'fixed' as const, bottom: 80, left: '50%', transform: 'translateX(-50%)',
        display: 'flex', alignItems: 'center', gap: 12, padding: '14px 24px',
        background: '#1a1a1a', borderRadius: 12, zIndex: 1100,
        boxShadow: '0 8px 24px rgba(0,0,0,0.3)', minWidth: 280,
      },
    },
      React.createElement('svg', { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block', flexShrink: 0 } },
        React.createElement('circle', { cx: 12, cy: 12, r: 10, stroke: '#fff', strokeWidth: 2 }),
        React.createElement('path', { d: 'M9 12l2 2 4-4', stroke: '#fff', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' })),
      React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#fff', ...font } }, toastMsg)) : null);
}
