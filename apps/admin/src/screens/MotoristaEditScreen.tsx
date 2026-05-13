/**
 * MotoristaEditScreen — Editar motorista conforme Figma 830-10503.
 * Uses React.createElement() calls (NOT JSX).
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { webStyles, arrowBackSvg } from '../styles/webStyles';
import { supabase } from '../lib/supabase';
import { parseVehiclePhotosUrls, resolveStorageDisplayUrl } from '../lib/storageDisplayUrl';
import {
  updateWorkerStatus,
  createWorkerRoute,
  toggleWorkerRouteActive,
  deleteWorkerRoute,
  saveProfileFields,
  saveWorkerProfileFields,
  fetchDriverPlatformFeeLedger,
  adminManualSettlePlatformFee,
} from '../data/queries';
import PlacesAddressInput from '../components/PlacesAddressInput';
import StripeConnectCard from '../components/StripeConnectCard';
import type { WorkerConnectStatus, DriverPlatformFeeLedgerRow } from '../data/types';
import { getGoogleMapsApiKey } from '../lib/expoExtra';

const font: React.CSSProperties = { fontFamily: 'Inter, sans-serif' };

function parseBRLInputToCents(s: string): number | null {
  const trimmed = s.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/\./g, '').replace(',', '.');
  const n = Number.parseFloat(normalized);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

function ledgerNotePt(note: string): string {
  const map: Record<string, string> = {
    cash_trip_completed: 'Taxa (viagem em dinheiro concluída)',
    connect_charge_abate: 'Abate Connect',
    manual_adjustment: 'Quitação manual',
    refund_revert: 'Estorno (reversão)',
  };
  return map[note] ?? note;
}

function fmtMotoristaHistWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const day = d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${time}`;
}

// Campo estilo Figma textFieldLightMode (label 14 medium #0d0d0d, valor 16 regular #3a3a3a)
const roField = (label: string, value: string) =>
  React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4, flex: '1 1 0', minWidth: 200 } },
    React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', ...font } }, label),
    React.createElement('div', {
      style: { height: 44, borderRadius: 8, background: '#f1f1f1', padding: '0 16px', display: 'flex', alignItems: 'center', fontSize: 16, color: '#3a3a3a', ...font },
    }, value || '—'));

const inputShell: React.CSSProperties = {
  height: 44,
  borderRadius: 8,
  background: '#f1f1f1',
  border: 'none',
  outline: 'none',
  padding: '0 16px',
  fontSize: 16,
  color: '#3a3a3a',
  width: '100%',
  boxSizing: 'border-box',
  ...font,
};

const rwField = (
  label: string,
  value: string,
  onChange: (v: string) => void,
  opts?: { type?: React.HTMLInputTypeAttribute; inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'] },
) =>
  React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4, flex: '1 1 0', minWidth: 200 } },
    React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', ...font } }, label),
    React.createElement('input', {
      type: opts?.type ?? 'text',
      inputMode: opts?.inputMode,
      value,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value),
      style: inputShell,
    }));

function documentDownloadHref(raw: string | undefined | null, resolved: string | null): string | null {
  const t = typeof raw === 'string' ? raw.trim() : '';
  if (!t) return null;
  if (resolved) return resolved;
  if (/^https?:\/\//i.test(t)) return t;
  return null;
}

const docRow = (name: string, showDownloadIcon = true) =>
  React.createElement('div', {
    style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #f1f1f1' },
  },
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
      React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none' },
        React.createElement('path', { d: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z', stroke: '#767676', strokeWidth: 2 }),
        React.createElement('path', { d: 'M14 2v6h6', stroke: '#767676', strokeWidth: 2 })),
      React.createElement('span', { style: { fontSize: 13, color: '#0d0d0d', ...font } }, name)),
    showDownloadIcon
      ? React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', style: { cursor: 'pointer' } },
        React.createElement('path', { d: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3', stroke: '#767676', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }))
      : React.createElement('span', { style: { width: 16, height: 16 } }));

const MAX_NEW_VEHICLE_PHOTOS = 4;
const NV_DOC_MAX_BYTES = 10 * 1024 * 1024;
const NV_PHOTO_MAX_BYTES = 20 * 1024 * 1024;

export default function MotoristaEditScreen() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const isEditMode = /\/motoristas\/[^/]+\/editar$/.test(location.pathname);

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<any>(null);
  const [worker, setWorker] = useState<any>(null);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [routes, setRoutes] = useState<any[]>([]);
  const [completedTripsCount, setCompletedTripsCount] = useState<number | null>(null);
  const [deliveredShipmentsCount, setDeliveredShipmentsCount] = useState<number | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [newRouteOpen, setNewRouteOpen] = useState(false);
  const [newRouteOrigin, setNewRouteOrigin] = useState('');
  const [newRouteDest, setNewRouteDest] = useState('');
  const [newRouteOriginCoords, setNewRouteOriginCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [newRouteDestCoords, setNewRouteDestCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [newRoutePreco, setNewRoutePreco] = useState('');
  const [routeActionLoading, setRouteActionLoading] = useState(false);
  const [newRouteGeoError, setNewRouteGeoError] = useState<string | null>(null);
  const [deleteRouteDraft, setDeleteRouteDraft] = useState<{ id: string; origin: string; destination: string } | null>(null);
  const [deleteRouteConsent, setDeleteRouteConsent] = useState(false);
  const [deleteRouteLoading, setDeleteRouteLoading] = useState(false);
  const [newVehicleOpen, setNewVehicleOpen] = useState(false);
  const [nvModel, setNvModel] = useState('');
  const [nvYear, setNvYear] = useState('');
  const [nvRenavam, setNvRenavam] = useState('');
  const [nvPlate, setNvPlate] = useState('');
  const [nvPassengerCapacity, setNvPassengerCapacity] = useState('');
  const [nvUseType, setNvUseType] = useState<'principal' | 'reserva'>('principal');
  const [nvDocFile, setNvDocFile] = useState<File | null>(null);
  const [nvPhotoFiles, setNvPhotoFiles] = useState<File[]>([]);
  const [nvSaving, setNvSaving] = useState(false);
  const [nvError, setNvError] = useState<string | null>(null);
  const nvDocInputRef = useRef<HTMLInputElement>(null);
  const nvPhotoInputRef = useRef<HTMLInputElement>(null);
  const [vehiclePhotoDisplayUrls, setVehiclePhotoDisplayUrls] = useState<string[]>([]);
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [editFullName, setEditFullName] = useState('');
  const [editCpf, setEditCpf] = useState('');
  const [editAge, setEditAge] = useState('');
  const [editCity, setEditCity] = useState('');
  const [editExperienceYears, setEditExperienceYears] = useState('');
  const [editBankCode, setEditBankCode] = useState('');
  const [editBankAgency, setEditBankAgency] = useState('');
  const [editBankAccount, setEditBankAccount] = useState('');
  const [editPix, setEditPix] = useState('');
  const [editHasOwnVehicle, setEditHasOwnVehicle] = useState(false);
  const [reviewerName, setReviewerName] = useState<string | null>(null);
  /** worker_profiles / vehicles podem guardar path do bucket ou URL pública; href cru quebra para paths. */
  const [resolvedDocHrefs, setResolvedDocHrefs] = useState<{
    cnhFront: string | null;
    cnhBack: string | null;
    background: string | null;
    vehicle: string | null;
  }>({ cnhFront: null, cnhBack: null, background: null, vehicle: null });
  const [docLinksLoading, setDocLinksLoading] = useState(false);
  const [platformFeeLedger, setPlatformFeeLedger] = useState<DriverPlatformFeeLedgerRow[]>([]);
  const [settleOpen, setSettleOpen] = useState(false);
  const [settleInput, setSettleInput] = useState('');
  const [settleBusy, setSettleBusy] = useState(false);
  const [settleErr, setSettleErr] = useState<string | null>(null);
  const [pfToast, setPfToast] = useState<string | null>(null);

  const loadPlatformFeeLedger = useCallback(async () => {
    if (!id) return;
    const rows = await fetchDriverPlatformFeeLedger(id, 100);
    setPlatformFeeLedger(rows);
  }, [id]);

  useEffect(() => {
    if (!id || loading) return;
    void loadPlatformFeeLedger();
  }, [id, loading, loadPlatformFeeLedger]);

  useEffect(() => {
    if (!pfToast) return;
    const t = setTimeout(() => setPfToast(null), 3500);
    return () => clearTimeout(t);
  }, [pfToast]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const db = supabase as any;

    (async () => {
      const [pRes, wRes, vRes, rRes, tripsCountRes, shipCountRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', id).single(),
        db.from('worker_profiles').select('*').eq('id', id).single(),
        db
          .from('vehicles')
          .select('*')
          .eq('worker_id', id)
          .order('is_active', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: true }),
        db.from('worker_routes').select('*').eq('worker_id', id).order('created_at', { ascending: false }),
        supabase
          .from('scheduled_trips')
          .select('id', { count: 'exact', head: true })
          .eq('driver_id', id)
          .eq('status', 'completed'),
        db
          .from('shipments')
          .select('id', { count: 'exact', head: true })
          .eq('driver_id', id)
          .eq('status', 'delivered'),
      ]);
      if (cancelled) return;
      setProfile(pRes.data);
      setWorker(wRes.data);
      setVehicles(vRes.data || []);
      setRoutes(rRes.data || []);
      setCompletedTripsCount(
        !tripsCountRes.error && typeof tripsCountRes.count === 'number' ? tripsCountRes.count : null,
      );
      setDeliveredShipmentsCount(
        !shipCountRes.error && typeof shipCountRes.count === 'number' ? shipCountRes.count : null,
      );
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    if (loading || !profile) return;
    const w = worker;
    setEditFullName(profile.full_name ?? '');
    setEditCpf(w?.cpf ?? '');
    setEditAge(w?.age != null ? String(w.age) : '');
    setEditCity(w?.city ?? profile.city ?? '');
    setEditExperienceYears(w?.experience_years != null ? String(w.experience_years) : '');
    setEditBankCode(w?.bank_code ?? '');
    setEditBankAgency(w?.bank_agency ?? '');
    setEditBankAccount(w?.bank_account ?? '');
    setEditPix(w?.pix_key ?? '');
    setEditHasOwnVehicle(Boolean(w?.has_own_vehicle));
  }, [loading, profile, worker]);

  const handleSaveEdits = useCallback(async () => {
    if (!id) return;
    if (!worker?.id) {
      setSaveError('Não foi possível carregar o cadastro do motorista (worker_profiles).');
      return;
    }
    if (!editFullName.trim()) {
      setSaveError('Informe o nome completo.');
      return;
    }
    setSaveError(null);
    const ageTrim = editAge.trim();
    const expTrim = editExperienceYears.trim();
    let ageNum: number | null = null;
    let expNum: number | null = null;
    if (ageTrim !== '') {
      ageNum = parseInt(ageTrim, 10);
      if (Number.isNaN(ageNum)) {
        setSaveError('Idade deve ser um número inteiro.');
        return;
      }
    }
    if (expTrim !== '') {
      expNum = parseInt(expTrim, 10);
      if (Number.isNaN(expNum)) {
        setSaveError('Anos de experiência deve ser um número inteiro.');
        return;
      }
    }
    setSaveLoading(true);
    const cityVal = editCity.trim() || null;
    const { error: pErr } = await saveProfileFields(id, {
      full_name: editFullName.trim(),
      city: cityVal,
    });
    if (pErr) {
      setSaveLoading(false);
      setSaveError(pErr);
      return;
    }
    const { error: wErr } = await saveWorkerProfileFields(id, {
      cpf: editCpf.trim() || null,
      age: ageNum,
      experience_years: expNum,
      city: cityVal,
      has_own_vehicle: editHasOwnVehicle,
      bank_code: editBankCode.trim() || null,
      bank_agency: editBankAgency.trim() || null,
      bank_account: editBankAccount.trim() || null,
      pix_key: editPix.trim() || null,
    });
    setSaveLoading(false);
    if (wErr) {
      setSaveError(wErr);
      return;
    }
    setProfile((p: any) => (p ? { ...p, full_name: editFullName.trim() || p.full_name, city: cityVal ?? p.city } : p));
    setWorker((w: any) =>
      w
        ? {
            ...w,
            cpf: editCpf.trim() || null,
            age: ageNum,
            experience_years: expNum,
            city: cityVal,
            has_own_vehicle: editHasOwnVehicle,
            bank_code: editBankCode.trim() || null,
            bank_agency: editBankAgency.trim() || null,
            bank_account: editBankAccount.trim() || null,
            pix_key: editPix.trim() || null,
          }
        : w,
    );
    navigate(-1);
  }, [
    id,
    editFullName,
    editCpf,
    editAge,
    editCity,
    editExperienceYears,
    editBankCode,
    editBankAgency,
    editBankAccount,
    editPix,
    editHasOwnVehicle,
    navigate,
    worker?.id,
  ]);

  useEffect(() => {
    let cancelled = false;
    const paths = vehicles.length > 0 ? parseVehiclePhotosUrls(vehicles[0]?.vehicle_photos_urls) : [];
    if (paths.length === 0) {
      setVehiclePhotoDisplayUrls([]);
      return;
    }
    (async () => {
      const urls = await Promise.all(paths.map((p) => resolveStorageDisplayUrl(supabase, p)));
      if (!cancelled) setVehiclePhotoDisplayUrls(urls.filter((u): u is string => Boolean(u)));
    })();
    return () => { cancelled = true; };
  }, [vehicles]);

  useEffect(() => {
    let cancelled = false;
    const cnhF = (worker?.cnh_document_url as string | undefined)?.trim();
    const cnhB = (worker?.cnh_document_back_url as string | undefined)?.trim();
    const bg = (worker?.background_check_url as string | undefined)?.trim();
    const vehDoc = (vehicles[0]?.vehicle_document_url as string | undefined)?.trim();
    if (!cnhF && !cnhB && !bg && !vehDoc) {
      setResolvedDocHrefs({ cnhFront: null, cnhBack: null, background: null, vehicle: null });
      setDocLinksLoading(false);
      return;
    }
    setDocLinksLoading(true);
    (async () => {
      const [rF, rB, rBg, rV] = await Promise.all([
        cnhF ? resolveStorageDisplayUrl(supabase, cnhF) : Promise.resolve(null),
        cnhB ? resolveStorageDisplayUrl(supabase, cnhB) : Promise.resolve(null),
        bg ? resolveStorageDisplayUrl(supabase, bg) : Promise.resolve(null),
        vehDoc ? resolveStorageDisplayUrl(supabase, vehDoc) : Promise.resolve(null),
      ]);
      if (!cancelled) {
        setResolvedDocHrefs({
          cnhFront: rF,
          cnhBack: rB,
          background: rBg,
          vehicle: rV,
        });
        setDocLinksLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [
    id,
    worker?.cnh_document_url,
    worker?.cnh_document_back_url,
    worker?.background_check_url,
    vehicles[0]?.vehicle_document_url,
  ]);

  useEffect(() => {
    const rid = worker?.reviewed_by as string | undefined;
    if (!rid) {
      setReviewerName(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('profiles').select('full_name').eq('id', rid).maybeSingle();
      if (!cancelled) setReviewerName((data as { full_name?: string } | null)?.full_name ?? null);
    })();
    return () => { cancelled = true; };
  }, [worker?.reviewed_by]);

  const nvPhotoUrls = useMemo(
    () => nvPhotoFiles.map((f) => URL.createObjectURL(f)),
    [nvPhotoFiles],
  );
  useEffect(() => {
    return () => {
      nvPhotoUrls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [nvPhotoUrls]);

  const closeNewVehicleModal = useCallback(() => {
    setNewVehicleOpen(false);
    setNvModel('');
    setNvYear('');
    setNvRenavam('');
    setNvPlate('');
    setNvPassengerCapacity('');
    setNvUseType('principal');
    setNvDocFile(null);
    setNvPhotoFiles([]);
    setNvSaving(false);
    setNvError(null);
  }, []);

  const saveNewVehicle = useCallback(async () => {
    if (!id) return;
    setNvError(null);
    if (!nvModel.trim()) {
      setNvError('Informe o modelo do veículo.');
      return;
    }
    const yearNum = parseInt(nvYear, 10);
    if (!yearNum || yearNum < 1950 || yearNum > new Date().getFullYear() + 1) {
      setNvError('Informe um ano válido.');
      return;
    }
    if (!nvPlate.trim()) {
      setNvError('Informe a placa.');
      return;
    }
    const capNum = parseInt(nvPassengerCapacity, 10);
    if (!capNum || capNum < 1 || capNum > 5) {
      setNvError('Capacidade deve ser entre 1 e 5.');
      return;
    }
    setNvSaving(true);
    let createdVehicleId: string | null = null;
    try {
      const db = supabase as any;
      // Mesmo fluxo conceitual do VehicleFormScreen (motorista): grava o veículo, obtém id, sobe arquivos em
      // `{worker_id}/{vehicle_id}/…` e atualiza URLs — evita pasta `admin-*` e coincide com paths que o app já usa.
      const baseRow = {
        worker_id: id,
        model: nvModel.trim(),
        year: yearNum,
        renavam: nvRenavam.trim() || null,
        plate: nvPlate.trim().toUpperCase(),
        passenger_capacity: capNum,
        use_type: nvUseType,
        vehicle_document_url: null as string | null,
        vehicle_photos_urls: null as string[] | null,
        status: 'pending',
        is_active: true,
        updated_at: new Date().toISOString(),
      };

      const { data: inserted, error: insErr } = await db.from('vehicles').insert(baseRow).select('id').single();
      if (insErr) throw insErr;
      const vid = inserted?.id as string | undefined;
      if (!vid) throw new Error('Veículo criado sem id.');
      createdVehicleId = vid;

      let docUrl: string | null = null;
      if (nvDocFile) {
        const ext = nvDocFile.name.split('.').pop() || 'pdf';
        const path = `${id}/${vid}/document.${ext}`;
        const { error: upErr } = await db.storage.from('vehicles').upload(path, nvDocFile, {
          contentType: nvDocFile.type || 'application/octet-stream',
          upsert: true,
        });
        if (upErr) throw upErr;
        const { data: pub } = db.storage.from('vehicles').getPublicUrl(path);
        docUrl = pub?.publicUrl ? `${pub.publicUrl}?t=${Date.now()}` : null;
      }

      const photoUrls: string[] = [];
      for (let i = 0; i < nvPhotoFiles.length; i++) {
        const f = nvPhotoFiles[i];
        // VehicleFormScreen: `photo_${idx}.jpg` + JPEG (ImagePicker). No web aceitamos png/webp com extensão e MIME coerentes.
        const ext =
          f.type === 'image/png' ? 'png' : f.type === 'image/webp' ? 'webp' : 'jpg';
        const path = `${id}/${vid}/photo_${i}.${ext}`;
        const contentType = f.type.startsWith('image/') ? f.type : 'image/jpeg';
        const { error: upErr } = await db.storage.from('vehicles').upload(path, f, {
          contentType,
          upsert: true,
        });
        if (upErr) throw upErr;
        const { data: pub } = db.storage.from('vehicles').getPublicUrl(path);
        if (pub?.publicUrl) photoUrls.push(`${pub.publicUrl}?t=${Date.now()}`);
      }

      if (docUrl != null || photoUrls.length > 0) {
        const { error: updErr } = await db
          .from('vehicles')
          .update({
            ...(docUrl != null ? { vehicle_document_url: docUrl } : {}),
            ...(photoUrls.length > 0 ? { vehicle_photos_urls: photoUrls } : {}),
            updated_at: new Date().toISOString(),
          })
          .eq('id', vid);
        if (updErr) throw updErr;
      }

      const { data: vData } = await db
        .from('vehicles')
        .select('*')
        .eq('worker_id', id)
        .order('is_active', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: true });
      setVehicles(vData || []);
      closeNewVehicleModal();
    } catch (e: unknown) {
      const msg =
        e && typeof e === 'object' && 'message' in e
          ? String((e as { message?: string }).message)
          : String(e);
      setNvError(msg || 'Não foi possível salvar o veículo.');
      if (createdVehicleId) {
        await (supabase as any).from('vehicles').delete().eq('id', createdVehicleId);
      }
    } finally {
      setNvSaving(false);
    }
  }, [
    id,
    nvModel,
    nvYear,
    nvRenavam,
    nvPlate,
    nvPassengerCapacity,
    nvUseType,
    nvDocFile,
    nvPhotoFiles,
    closeNewVehicleModal,
  ]);

  const handleApprove = useCallback(async () => {
    if (!worker?.id) return;
    setActionLoading(true);
    await updateWorkerStatus(worker.id, 'approved');
    setActionLoading(false);
    navigate(-1);
  }, [worker, navigate]);
  const handleReject = useCallback(async () => {
    if (!worker?.id) return;
    setActionLoading(true);
    await updateWorkerStatus(worker.id, 'rejected');
    setActionLoading(false);
    navigate(-1);
  }, [worker, navigate]);
  const handleSuspend = useCallback(async () => {
    if (!worker?.id) return;
    setActionLoading(true);
    await updateWorkerStatus(worker.id, 'suspended');
    setActionLoading(false);
    navigate(-1);
  }, [worker, navigate]);

  const historicoTimelineItems = useMemo(() => {
    type Row = { ts: number; iconPath: string; label: string; person: string; date: string; key: string };
    const rows: Row[] = [];
    const iconRoute = 'M2 12c0 0 4-8 10-8s10 8 10 8-4 8-10 8S2 12 2 12z';
    const iconUser = 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8z';
    const iconVehicle = 'M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.4-1.7-1.1-2.2L17 8.5M5 17H3c-.6 0-1-.4-1-1v-3c0-.9.4-1.7 1.1-2.2L7 8.5M7 8.5l1.5-3h7L17 8.5M7 8.5h10M5 17v-5M19 17v-5';
    if (worker?.created_at) {
      rows.push({
        ts: new Date(worker.created_at).getTime(),
        iconPath: iconUser,
        label: 'Cadastro do motorista',
        person: profile?.full_name || '—',
        date: fmtMotoristaHistWhen(worker.created_at),
        key: `worker-created-${worker.created_at}`,
      });
    }
    if (worker?.reviewed_at) {
      const st = worker.status as string | undefined;
      const statusWord =
        st === 'approved' ? 'Aprovado' : st === 'rejected' ? 'Rejeitado' : st === 'suspended' ? 'Suspenso' : st === 'pending' ? 'Pendente' : st || 'Atualizado';
      rows.push({
        ts: new Date(worker.reviewed_at).getTime(),
        iconPath: iconUser,
        label: `Status do cadastro: ${statusWord}`,
        person: reviewerName || 'Administrador',
        date: fmtMotoristaHistWhen(worker.reviewed_at),
        key: `worker-reviewed-${worker.reviewed_at}`,
      });
    }
    for (const r of routes) {
      const ca = r.created_at as string | undefined;
      const ua = r.updated_at as string | undefined;
      const when = ua || ca;
      if (!when) continue;
      const isUpdate = Boolean(ca && ua && ua !== ca);
      rows.push({
        ts: new Date(when).getTime(),
        iconPath: iconRoute,
        label: isUpdate ? 'Rota atualizada' : 'Rota cadastrada',
        person: `${r.origin_address || '?'} → ${r.destination_address || '?'}`,
        date: fmtMotoristaHistWhen(when),
        key: `route-${r.id}-${when}`,
      });
    }
    for (const v of vehicles) {
      const ca = v.created_at as string | undefined;
      if (!ca) continue;
      const bits = [v.model, v.plate].filter(Boolean);
      rows.push({
        ts: new Date(ca).getTime(),
        iconPath: iconVehicle,
        label: 'Veículo cadastrado',
        person: bits.length ? bits.join(' · ') : 'Veículo',
        date: fmtMotoristaHistWhen(ca),
        key: `vehicle-${v.id}-${ca}`,
      });
    }
    rows.sort((a, b) => b.ts - a.ts);
    return rows.slice(0, 40);
  }, [worker, profile, routes, vehicles, reviewerName]);

  if (loading) {
    return React.createElement('div', { style: { display: 'flex', justifyContent: 'center', padding: 64 } },
      React.createElement('span', { style: { fontSize: 16, color: '#767676', ...font } }, 'Carregando motorista...'));
  }

  const nome = profile?.full_name || 'Sem nome';
  const cpf = worker?.cpf || '—';
  const idade = worker?.age ? `${worker.age} anos` : '—';
  const cidade = worker?.city || profile?.city || '—';
  const experiencia = worker?.experience_years ? `${worker.experience_years} anos` : '—';
  const banco = worker?.bank_code || '—';
  const agencia = worker?.bank_agency || '—';
  const conta = worker?.bank_account || '—';
  const pix = worker?.pix_key || '—';
  const possuiVeiculo = worker?.has_own_vehicle;
  const workerStatus = worker?.status || 'pending';
  // ── Breadcrumb (Figma 830:10506 — 12px semibold) ───────────────────────
  const breadcrumbCurrent = isEditMode ? 'Editar dados' : 'Visualização';
  const breadcrumb = React.createElement('div', {
    style: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, ...font },
  },
    React.createElement('span', { style: { color: '#767676' } }, 'Motoristas'),
    React.createElement('span', { style: { color: '#767676' } }, '›'),
    React.createElement('span', { style: { color: '#0d0d0d' } }, breadcrumbCurrent));

  // ── Header (Figma 830:10512 — Cancelar fundo #f1f1f1) ─────────────────
  const header = React.createElement('div', {
    style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' as const, gap: 12 },
  },
    React.createElement('button', {
      type: 'button', onClick: () => navigate(-1),
      style: { display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600, color: '#0d0d0d', ...font, padding: 0, minHeight: 44 },
    }, arrowBackSvg, 'Voltar'),
    isEditMode
      ? React.createElement('button', {
          type: 'button',
          onClick: () => void handleSaveEdits(),
          disabled: saveLoading,
          style: {
            display: 'flex', alignItems: 'center', gap: 8, height: 44, padding: '0 24px',
            borderRadius: 999, border: 'none', background: '#0d0d0d',
            color: '#fff', fontSize: 14, fontWeight: 600, cursor: saveLoading ? 'wait' : 'pointer', opacity: saveLoading ? 0.65 : 1, ...font,
          },
        },
          React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none' },
            React.createElement('path', { d: 'M20 6L9 17l-5-5', stroke: '#fff', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' })),
          saveLoading ? 'Salvando…' : 'Salvar alterações')
      : React.createElement('button', {
          type: 'button', onClick: () => id && navigate(`/motoristas/${id}/editar`),
          style: {
            display: 'flex', alignItems: 'center', gap: 8, height: 44, padding: '0 24px',
            borderRadius: 999, border: 'none', background: '#0d0d0d',
            color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', ...font,
          },
        }, 'Editar dados'));

  // ── Status action bar ─────────────────────────────────────────────────
  const statusBadgeColor = workerStatus === 'approved' ? '#b0e8d1' : workerStatus === 'rejected' ? '#eeafaa' : workerStatus === 'suspended' ? '#eeafaa' : '#fee59a';
  const statusBadgeText = workerStatus === 'approved' ? '#174f38' : workerStatus === 'rejected' ? '#551611' : workerStatus === 'suspended' ? '#551611' : '#654c01';
  const statusLabel = workerStatus === 'approved' ? 'Aprovado' : workerStatus === 'rejected' ? 'Rejeitado' : workerStatus === 'suspended' ? 'Suspenso' : workerStatus === 'pending' ? 'Pendente' : workerStatus === 'inactive' ? 'Inativo' : workerStatus;
  const actionBtnStyle = (bg: string, color: string): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 6, height: 40, padding: '0 20px',
    borderRadius: 999, border: 'none', background: bg, color, fontSize: 14, fontWeight: 600,
    cursor: actionLoading ? 'wait' : 'pointer', opacity: actionLoading ? 0.6 : 1, ...font,
  });

  const statusActions = React.createElement('div', {
    style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', background: '#fff', borderRadius: 16, border: '1px solid #e2e2e2', flexWrap: 'wrap' as const, gap: 12 },
  },
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } },
      React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', ...font } }, 'Status do motorista:'),
      React.createElement('span', { style: { fontSize: 12, fontWeight: 600, padding: '4px 12px', borderRadius: 999, background: statusBadgeColor, color: statusBadgeText, ...font } }, statusLabel)),
    !isEditMode
      ? React.createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' as const } },
          workerStatus !== 'approved' ? React.createElement('button', { type: 'button', onClick: handleApprove, disabled: actionLoading, style: actionBtnStyle('#22c55e', '#fff') }, 'Aprovar') : null,
          workerStatus !== 'rejected' ? React.createElement('button', { type: 'button', onClick: handleReject, disabled: actionLoading, style: actionBtnStyle('#fff', '#b53838') }, 'Rejeitar') : null,
          workerStatus === 'approved' ? React.createElement('button', { type: 'button', onClick: handleSuspend, disabled: actionLoading, style: actionBtnStyle('#f1f1f1', '#b53838') }, 'Suspender') : null)
      : null);

  // ── Faixa informativa (Figma 830:10517 — gold-100 / gold-500) ─────────
  const toast = React.createElement('div', {
    style: {
      display: 'flex', alignItems: 'center', gap: 16, padding: '12px 16px',
      background: '#fff8e6', border: '0.5px solid #cba04b', borderRadius: 8,
      boxShadow: '0 4px 20px rgba(13,13,13,0.04)', width: '100%', boxSizing: 'border-box' as const,
    },
  },
    React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', style: { flexShrink: 0 } },
      React.createElement('circle', { cx: 12, cy: 12, r: 10, stroke: '#cba04b', strokeWidth: 2 }),
      React.createElement('path', { d: 'M12 8v4M12 16h.01', stroke: '#cba04b', strokeWidth: 2, strokeLinecap: 'round' })),
    React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', ...font, flex: 1 } },
      isEditMode ? 'Você está editando os dados do motorista' : 'Você está visualizando os dados do motorista'));

  const saveErrorBanner = saveError
    ? React.createElement('div', {
        role: 'alert',
        style: {
          padding: '12px 16px',
          borderRadius: 8,
          background: '#fee5e5',
          border: '1px solid #eeafaa',
          fontSize: 14,
          color: '#551611',
          ...font,
        },
      }, saveError)
    : null;

  // ── Dados do Motorista (Figma 1224:21501 — título 20px + card interno 12px) ──
  const dadosBasics = isEditMode
    ? React.createElement(React.Fragment, null,
        rwField('Nome completo', editFullName, setEditFullName),
        React.createElement('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap' as const } },
          rwField('CPF', editCpf, setEditCpf),
          rwField('Idade', editAge, setEditAge, { type: 'text', inputMode: 'numeric' })),
        React.createElement('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap' as const } },
          rwField('Cidade', editCity, setEditCity),
          rwField('Anos de experiência', editExperienceYears, setEditExperienceYears, { type: 'text', inputMode: 'numeric' })))
    : React.createElement(React.Fragment, null,
        roField('Nome completo', nome),
        React.createElement('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap' as const } },
          roField('CPF', cpf),
          roField('Idade', idade)),
        React.createElement('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap' as const } },
          roField('Cidade', cidade),
          roField('Anos de experiência', experiencia)));

  const dadosBancarios = isEditMode
    ? React.createElement(React.Fragment, null,
        React.createElement('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap' as const } },
          rwField('Banco', editBankCode, setEditBankCode),
          rwField('Agência', editBankAgency, setEditBankAgency)),
        React.createElement('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap' as const } },
          rwField('Conta', editBankAccount, setEditBankAccount),
          rwField('Chave Pix', editPix, setEditPix)))
    : React.createElement(React.Fragment, null,
        React.createElement('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap' as const } },
          roField('Banco', banco),
          roField('Agência', agencia)),
        React.createElement('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap' as const } },
          roField('Conta', conta),
          roField('Chave Pix', pix)));

  const veiculoProprioRow = isEditMode
    ? React.createElement('div', { style: { display: 'flex', gap: 24 } },
        React.createElement('button', {
          type: 'button',
          onClick: () => setEditHasOwnVehicle(true),
          style: { display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', padding: 0, ...font },
        },
          React.createElement('div', { style: { width: 20, height: 20, borderRadius: '50%', border: '2px solid #0d0d0d', display: 'flex', alignItems: 'center', justifyContent: 'center' } },
            editHasOwnVehicle ? React.createElement('div', { style: { width: 10, height: 10, borderRadius: '50%', background: '#0d0d0d' } }) : null),
          React.createElement('span', { style: { fontSize: 14, color: '#0d0d0d', ...font } }, 'Sim')),
        React.createElement('button', {
          type: 'button',
          onClick: () => setEditHasOwnVehicle(false),
          style: { display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', padding: 0, ...font },
        },
          React.createElement('div', { style: { width: 20, height: 20, borderRadius: '50%', border: '2px solid #0d0d0d', display: 'flex', alignItems: 'center', justifyContent: 'center' } },
            !editHasOwnVehicle ? React.createElement('div', { style: { width: 10, height: 10, borderRadius: '50%', background: '#0d0d0d' } }) : null),
          React.createElement('span', { style: { fontSize: 14, color: '#0d0d0d', ...font } }, 'Não')))
    : React.createElement('div', { style: { display: 'flex', gap: 24 } },
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          React.createElement('div', { style: { width: 20, height: 20, borderRadius: '50%', border: '2px solid #0d0d0d', display: 'flex', alignItems: 'center', justifyContent: 'center' } },
            possuiVeiculo ? React.createElement('div', { style: { width: 10, height: 10, borderRadius: '50%', background: '#0d0d0d' } }) : null),
          React.createElement('span', { style: { fontSize: 14, color: '#0d0d0d', ...font } }, 'Sim')),
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          React.createElement('div', { style: { width: 20, height: 20, borderRadius: '50%', border: '2px solid #0d0d0d', display: 'flex', alignItems: 'center', justifyContent: 'center' } },
            !possuiVeiculo ? React.createElement('div', { style: { width: 10, height: 10, borderRadius: '50%', background: '#0d0d0d' } }) : null),
          React.createElement('span', { style: { fontSize: 14, color: '#0d0d0d', ...font } }, 'Não')));

  const dadosInnerCard = React.createElement('div', {
    style: { display: 'flex', flexDirection: 'column' as const, gap: 16, padding: 24, background: '#fff', borderRadius: 12, border: '1px solid #e2e2e2', width: '100%', boxSizing: 'border-box' as const },
  },
    React.createElement('p', { style: { fontSize: 16, fontWeight: 600, color: '#767676', margin: 0, ...font } }, 'Dados básicos'),
    dadosBasics,

    // Dados bancários
    React.createElement('p', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', margin: '8px 0 0', ...font } }, 'Dados bancários'),
    dadosBancarios,

    // Veículo
    React.createElement('p', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', margin: '8px 0 0', ...font } }, 'Veículo de transporte'),
    React.createElement('span', { style: { fontSize: 13, color: '#767676', ...font } }, 'Possui veículo próprio?'),
    veiculoProprioRow,

    // Documentos
    React.createElement('p', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', margin: '8px 0 0', ...font } }, 'Documentos'),
    React.createElement('span', { style: { fontSize: 13, fontWeight: 500, color: '#0d0d0d', ...font } }, 'CNH (frente)'),
    (() => {
      const raw = worker?.cnh_document_url as string | undefined;
      const href = documentDownloadHref(raw, resolvedDocHrefs.cnhFront);
      if (!raw?.trim()) return docRow('Nenhum documento', false);
      if (docLinksLoading && !href) return docRow('Gerando link para download…', false);
      if (!href) return docRow('Arquivo indisponível (confira permissões de storage)', false);
      return React.createElement('a', { href, target: '_blank', rel: 'noopener noreferrer', style: { textDecoration: 'none', color: 'inherit' } }, docRow('documento_cnh_frente.pdf'));
    })(),
    React.createElement('span', { style: { fontSize: 13, fontWeight: 500, color: '#0d0d0d', ...font, marginTop: 8 } }, 'CNH (verso)'),
    (() => {
      const raw = worker?.cnh_document_back_url as string | undefined;
      const href = documentDownloadHref(raw, resolvedDocHrefs.cnhBack);
      if (!raw?.trim()) return docRow('Nenhum documento', false);
      if (docLinksLoading && !href) return docRow('Gerando link para download…', false);
      if (!href) return docRow('Arquivo indisponível (confira permissões de storage)', false);
      return React.createElement('a', { href, target: '_blank', rel: 'noopener noreferrer', style: { textDecoration: 'none', color: 'inherit' } }, docRow('documento_cnh_verso.pdf'));
    })(),
    React.createElement('span', { style: { fontSize: 13, fontWeight: 500, color: '#0d0d0d', ...font, marginTop: 8 } }, 'Antecedentes criminais'),
    (() => {
      const raw = worker?.background_check_url as string | undefined;
      const href = documentDownloadHref(raw, resolvedDocHrefs.background);
      if (!raw?.trim()) return docRow('Nenhum documento', false);
      if (docLinksLoading && !href) return docRow('Gerando link para download…', false);
      if (!href) return docRow('Arquivo indisponível (confira permissões de storage)', false);
      return React.createElement('a', { href, target: '_blank', rel: 'noopener noreferrer', style: { textDecoration: 'none', color: 'inherit' } }, docRow('antecedentes_criminais.pdf'));
    })(),
    React.createElement('span', { style: { fontSize: 13, fontWeight: 500, color: '#0d0d0d', ...font, marginTop: 8 } }, 'Documento do veículo'),
    (() => {
      const raw = vehicles[0]?.vehicle_document_url as string | undefined;
      const href = documentDownloadHref(raw, resolvedDocHrefs.vehicle);
      if (!raw?.trim()) return docRow('Nenhum documento', false);
      if (docLinksLoading && !href) return docRow('Gerando link para download…', false);
      if (!href) return docRow('Arquivo indisponível (confira permissões de storage)', false);
      return React.createElement('a', { href, target: '_blank', rel: 'noopener noreferrer', style: { textDecoration: 'none', color: 'inherit' } }, docRow('documento_de_veiculo.pdf'));
    })());

  // Stripe Connect status (leitura direta de worker_profiles ja carregado em .select('*')).
  const connectStatus: WorkerConnectStatus = {
    accountId: (worker as any)?.stripe_connect_account_id ?? null,
    chargesEnabled: Boolean((worker as any)?.stripe_connect_charges_enabled),
    payoutsEnabled: Boolean((worker as any)?.stripe_connect_payouts_enabled),
    detailsSubmitted: Boolean((worker as any)?.stripe_connect_details_submitted),
    notifiedApprovedAt: (worker as any)?.stripe_connect_notified_approved_at ?? null,
  };

  const stripeConnectSection = id
    ? React.createElement(StripeConnectCard, {
        workerId: id,
        connect: connectStatus,
        onSynced: (next) => {
          setWorker((prev: any) => prev ? {
            ...prev,
            stripe_connect_charges_enabled: next.chargesEnabled,
            stripe_connect_payouts_enabled: next.payoutsEnabled,
            stripe_connect_details_submitted: next.detailsSubmitted,
            stripe_connect_account_id: next.accountId ?? prev.stripe_connect_account_id,
          } : prev);
          void loadPlatformFeeLedger();
        },
      })
    : null;

  const dadosSection = React.createElement('div', {
    style: { display: 'flex', flexDirection: 'column' as const, gap: 16, paddingBottom: 32, borderBottom: '1px solid #e2e2e2', width: '100%', boxSizing: 'border-box' as const },
  },
    React.createElement('h2', { style: { fontSize: 20, fontWeight: 600, color: '#0d0d0d', margin: 0, width: '100%', ...font } }, 'Dados do Motorista'),
    dadosInnerCard,
    stripeConnectSection);

  const platformFeeOwed = Math.max(0, Math.round(Number((worker as any)?.platform_fee_owed_cents ?? 0)));
  const fmtPlatformBRL = (cents: number) =>
    `R$ ${(cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const handleConfirmSettle = useCallback(async () => {
    if (!id) return;
    setSettleErr(null);
    const cents = parseBRLInputToCents(settleInput);
    if (cents == null) {
      setSettleErr('Informe um valor válido em reais.');
      return;
    }
    const owed = Math.max(0, Math.round(Number((worker as any)?.platform_fee_owed_cents ?? 0)));
    if (cents > owed) {
      setSettleErr(`Máximo: ${fmtPlatformBRL(owed)}`);
      return;
    }
    setSettleBusy(true);
    try {
      const res = await adminManualSettlePlatformFee(id, cents);
      if (!res.ok) {
        setSettleErr(res.error ?? 'Falha ao quitar.');
        return;
      }
      setWorker((prev: any) => (prev ? { ...prev, platform_fee_owed_cents: res.owedAfter ?? 0 } : prev));
      setSettleOpen(false);
      setSettleInput('');
      setPfToast(`Quitado ${fmtPlatformBRL(res.settledCents ?? 0)}. Saldo: ${fmtPlatformBRL(res.owedAfter ?? 0)}.`);
      await loadPlatformFeeLedger();
    } finally {
      setSettleBusy(false);
    }
  }, [id, worker, settleInput, loadPlatformFeeLedger]);

  const platformFeeSection = id
    ? React.createElement('div', {
        style: {
          display: 'flex', flexDirection: 'column' as const, gap: 16,
          paddingBottom: 32, borderBottom: '1px solid #e2e2e2', width: '100%', boxSizing: 'border-box' as const,
        },
      },
        React.createElement('h2', { style: { fontSize: 20, fontWeight: 600, color: '#0d0d0d', margin: 0, ...font } }, 'Taxa da plataforma (dinheiro)'),
        React.createElement('p', { style: { fontSize: 13, color: '#78716c', margin: 0, lineHeight: 1.45, ...font } },
          'Saldo devido acumula em viagens concluídas pagas em dinheiro; é abatido em corridas com cartão ou Pix quando o Connect está ativo, ou pode ser quitado manualmente.'),
        React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' as const } },
          React.createElement('span', { style: { fontSize: 14, fontWeight: 500, ...font } }, 'Saldo atual:'),
          React.createElement('span', { style: { fontSize: 22, fontWeight: 700, color: platformFeeOwed > 0 ? '#b45309' : '#0d8344', ...font } }, fmtPlatformBRL(platformFeeOwed)),
          platformFeeOwed > 0
            ? React.createElement('button', {
                type: 'button',
                onClick: () => { setSettleErr(null); setSettleInput(''); setSettleOpen(true); },
                style: {
                  marginLeft: 8,
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: 'none',
                  background: '#0d0d0d',
                  color: '#fff',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                  ...font,
                },
              }, 'Quitar saldo')
            : null),
        React.createElement('p', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', margin: '8px 0 0', ...font } }, 'Movimentos recentes'),
        platformFeeLedger.length === 0
          ? React.createElement('p', { style: { fontSize: 13, color: '#767676', margin: 0, ...font } }, 'Sem lançamentos no ledger (ou sem permissão de leitura).')
          : React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 0, border: '1px solid #e2e2e2', borderRadius: 12, overflow: 'hidden', background: '#fff' } },
              ...platformFeeLedger.map((row, idx) =>
                React.createElement('div', {
                  key: row.id,
                  style: {
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.2fr) auto auto',
                    gap: 8,
                    padding: '12px 14px',
                    borderBottom: idx < platformFeeLedger.length - 1 ? '1px solid #f1f1f1' : undefined,
                    fontSize: 13,
                    ...font,
                    alignItems: 'center',
                  },
                },
                  React.createElement('span', { style: { color: '#57534e' } }, fmtMotoristaHistWhen(row.createdAt)),
                  React.createElement('span', { style: { fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const } }, ledgerNotePt(row.note)),
                  React.createElement('span', { style: { fontWeight: 700, color: row.kind === 'credit' ? '#b45309' : '#0d8344' } }, `${row.kind === 'credit' ? '+' : '−'}${fmtPlatformBRL(row.amountCents)}`),
                  row.bookingId
                    ? React.createElement('button', {
                        type: 'button',
                        onClick: () => navigate(`/viagens/${row.bookingId}`),
                        style: { border: 'none', background: 'none', color: '#016df9', cursor: 'pointer', fontSize: 12, fontWeight: 600, textDecoration: 'underline', justifySelf: 'end' },
                      }, 'Reserva')
                    : React.createElement('span', { style: { color: '#a3a3a3', fontSize: 12 } }, '—')))))
    : null;

  const settleModal = settleOpen && id
    ? React.createElement('div', {
        style: {
          position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 10000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        },
        onClick: () => !settleBusy && setSettleOpen(false),
        role: 'presentation',
      },
        React.createElement('div', {
          style: { background: '#fff', borderRadius: 16, padding: 24, maxWidth: 400, width: '100%', boxShadow: '0 8px 32px rgba(0,0,0,0.2)', ...font },
          onClick: (e: React.MouseEvent) => e.stopPropagation(),
        },
          React.createElement('h3', { style: { margin: '0 0 8px', fontSize: 18, fontWeight: 600 } }, 'Quitar saldo devido'),
          React.createElement('p', { style: { margin: '0 0 16px', fontSize: 14, color: '#57534e', lineHeight: 1.45 } },
            `Máximo: ${fmtPlatformBRL(platformFeeOwed)}. Será registada uma linha de débito (nota manual_adjustment).`),
          React.createElement('label', { style: { display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 } }, 'Valor (R$)'),
          React.createElement('input', {
            type: 'text',
            value: settleInput,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setSettleInput(e.target.value),
            placeholder: '0,00',
            style: { width: '100%', height: 44, borderRadius: 8, border: '1px solid #e2e2e2', padding: '0 12px', fontSize: 16, boxSizing: 'border-box' as const, marginBottom: 8 },
            disabled: settleBusy,
          }),
          settleErr ? React.createElement('p', { style: { color: '#b53838', fontSize: 13, margin: '0 0 12px' } }, settleErr) : null,
          React.createElement('div', { style: { display: 'flex', gap: 10, marginTop: 12 } },
            React.createElement('button', {
              type: 'button', onClick: () => !settleBusy && setSettleOpen(false), disabled: settleBusy,
              style: { flex: 1, height: 44, borderRadius: 8, border: '1px solid #e2e2e2', background: '#fff', cursor: 'pointer', fontWeight: 600 },
            }, 'Cancelar'),
            React.createElement('button', {
              type: 'button', onClick: () => { void handleConfirmSettle(); }, disabled: settleBusy,
              style: { flex: 1, height: 44, borderRadius: 8, border: 'none', background: '#0d0d0d', color: '#fff', cursor: 'pointer', fontWeight: 600 },
            }, settleBusy ? '…' : 'Confirmar'))))
    : null;

  const pfToastEl = pfToast
    ? React.createElement('div', {
        style: {
          position: 'fixed' as const, bottom: 28, left: '50%', transform: 'translateX(-50%)', zIndex: 10001,
          background: '#0d0d0d', color: '#fff', padding: '12px 20px', borderRadius: 10, fontSize: 14, fontWeight: 600, maxWidth: '90vw', ...font,
        },
      }, pfToast)
    : null;

  // ── Fotos do veículo: DB pode ter paths (FinalizeRegistration) ou URLs públicas (VehicleForm) ──
  const rawPhotoCount =
    vehicles.length > 0 ? parseVehiclePhotosUrls(vehicles[0]?.vehicle_photos_urls).length : 0;
  const vehiclePhotos = vehiclePhotoDisplayUrls.length > 0 ? vehiclePhotoDisplayUrls : null;

  const photosSection = React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8 } },
    React.createElement('p', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', margin: '8px 0 0', ...font } }, 'Fotos do veículo principal'),
    React.createElement('span', { style: { fontSize: 12, color: '#767676', ...font } }, 'Máx. 4 fotos. 2MB'),
    rawPhotoCount > 0 && !vehiclePhotos
      ? React.createElement('span', { style: { fontSize: 12, color: '#767676', ...font } }, 'Carregando imagens…')
      : null,
    vehiclePhotos
      ? React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 } },
          ...vehiclePhotos.map((url: string, i: number) =>
            React.createElement('div', {
              key: i,
              style: { width: '100%', height: 130, borderRadius: 12, background: '#f1f1f1', overflow: 'hidden' },
            }, React.createElement('img', { src: url, alt: `Foto ${i + 1}`, style: { width: '100%', height: '100%', objectFit: 'cover' } }))))
      : rawPhotoCount === 0
        ? React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 } },
            ...[1, 2, 3, 4].map((n) =>
              React.createElement('div', {
                key: n,
                style: { width: '100%', height: 130, borderRadius: 12, background: '#f1f1f1', display: 'flex', alignItems: 'center', justifyContent: 'center' },
              }, React.createElement('span', { style: { fontSize: 12, color: '#767676', ...font } }, 'Sem foto'))))
        : React.createElement('span', { style: { fontSize: 12, color: '#b53838', ...font } }, 'Não foi possível gerar URL das fotos (confira permissões de storage para admin).'));

  // ── Rotas e valores (Figma 1271:34183) ───────────────────────────────
  const fmtBRL = (cents: number) => `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;

  const routeCard = (r: any, i: number) =>
    React.createElement('div', {
      key: r.id || i,
      style: {
        padding: 16,
        border: '1px solid #e2e2e2',
        borderRadius: 12,
        background: '#fff',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 16,
        width: '100%',
        boxSizing: 'border-box' as const,
      },
    },
      React.createElement('div', { style: { flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column' as const, gap: 4 } },
        React.createElement('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' as const,
            fontSize: 16, lineHeight: 1.5, ...font,
          },
        },
          React.createElement('span', {
            style: { fontWeight: 600, color: '#0d0d0d', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, maxWidth: '100%' },
          }, `${r.origin_address || '?'}`),
          React.createElement('span', { style: { fontWeight: 500, color: '#7c5f29', flexShrink: 0 } }, '→'),
          React.createElement('span', {
            style: { fontWeight: 600, color: '#0d0d0d', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, maxWidth: '100%' },
          }, `${r.destination_address || '?'}`)),
        React.createElement('span', {
          style: { fontSize: 14, fontWeight: 400, color: '#767676', lineHeight: 1.5, ...font, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
        }, r.price_per_person_cents ? `${fmtBRL(r.price_per_person_cents)} por pessoa` : '—')),
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 } },
        isEditMode
          ? React.createElement('button', {
              type: 'button',
              onClick: async () => {
                await toggleWorkerRouteActive(r.id, !r.is_active);
                setRoutes((prev: any[]) => prev.map((rt: any) => rt.id === r.id ? { ...rt, is_active: !rt.is_active } : rt));
              },
              style: {
                height: 28, padding: '0 12px', borderRadius: 999, border: 'none', cursor: 'pointer',
                background: r.is_active !== false ? '#b0e8d1' : '#f1f1f1',
                color: r.is_active !== false ? '#174f38' : '#767676',
                fontSize: 12, fontWeight: 600, ...font, whiteSpace: 'nowrap' as const,
              },
            }, r.is_active !== false ? 'Ativa' : 'Inativa')
          : React.createElement('span', {
              style: {
                height: 28, padding: '0 12px', borderRadius: 999, fontSize: 12, fontWeight: 600, ...font, whiteSpace: 'nowrap' as const,
                background: r.is_active !== false ? '#b0e8d1' : '#f1f1f1',
                color: r.is_active !== false ? '#174f38' : '#767676', display: 'inline-flex', alignItems: 'center',
              },
            }, r.is_active !== false ? 'Ativa' : 'Inativa'),
        isEditMode
          ? React.createElement('button', {
              type: 'button',
              'aria-label': 'Remover rota',
              onClick: () => {
                setDeleteRouteConsent(false);
                setDeleteRouteDraft({
                  id: r.id,
                  origin: r.origin_address || '?',
                  destination: r.destination_address || '?',
                });
              },
              style: {
                width: 28, height: 28, borderRadius: '50%', border: 'none', cursor: 'pointer',
                background: '#fee5e5', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, flexShrink: 0,
              },
            }, React.createElement('svg', { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none' },
              React.createElement('path', { d: 'M18 6L6 18M6 6l12 12', stroke: '#b53838', strokeWidth: 2.5, strokeLinecap: 'round' })))
          : null));

  // ── New route modal ───────────────────────────────────────────────────
  const newRoutePlaceInputStyle: React.CSSProperties = {
    height: 44,
    borderRadius: 8,
    background: '#f1f1f1',
    border: 'none',
    outline: 'none',
    padding: '0 16px',
    fontSize: 14,
    width: '100%',
    boxSizing: 'border-box',
    ...font,
  };
  const mapsKeyConfigured = Boolean(getGoogleMapsApiKey());
  const closeNewRouteModal = () => {
    setNewRouteOpen(false);
    setNewRouteOrigin('');
    setNewRouteDest('');
    setNewRouteOriginCoords(null);
    setNewRouteDestCoords(null);
    setNewRoutePreco('');
    setNewRouteGeoError(null);
  };

  const newRouteModal = newRouteOpen
    ? React.createElement('div', {
        role: 'dialog',
        'aria-modal': true,
        style: {
          position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, boxSizing: 'border-box' as const,
        },
        onClick: closeNewRouteModal,
      },
      React.createElement('div', {
        style: {
          background: '#fff', borderRadius: 16, padding: 24, width: '100%', maxWidth: 420,
          display: 'flex', flexDirection: 'column' as const, gap: 16, boxSizing: 'border-box' as const,
        },
        onClick: (e: React.MouseEvent) => e.stopPropagation(),
      },
        React.createElement('h2', { style: { fontSize: 18, fontWeight: 700, margin: 0, color: '#0d0d0d', ...font } }, 'Nova rota'),
        mapsKeyConfigured
          ? React.createElement('p', { style: { fontSize: 12, color: '#767676', margin: 0, lineHeight: 1.45, ...font } },
            'Escolha origem e destino na lista de sugestões do Google para gravar endereço e coordenadas.')
          : null,
        // Origem
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4 } },
          React.createElement('label', { style: { fontSize: 13, fontWeight: 500, color: '#767676', ...font } }, 'Origem'),
          React.createElement(PlacesAddressInput, {
            value: newRouteOrigin,
            onChange: (v: string) => {
              setNewRouteOrigin(v);
              setNewRouteOriginCoords(null);
              setNewRouteGeoError(null);
            },
            onPlaceResolved: (p) => {
              setNewRouteOrigin(p.formattedAddress);
              setNewRouteOriginCoords({ lat: p.lat, lng: p.lng });
              setNewRouteGeoError(null);
            },
            inputStyle: newRoutePlaceInputStyle,
            placeholder: mapsKeyConfigured ? 'Buscar cidade ou endereço…' : 'ex: São Paulo, SP',
          })),
        // Destino
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4 } },
          React.createElement('label', { style: { fontSize: 13, fontWeight: 500, color: '#767676', ...font } }, 'Destino'),
          React.createElement(PlacesAddressInput, {
            value: newRouteDest,
            onChange: (v: string) => {
              setNewRouteDest(v);
              setNewRouteDestCoords(null);
              setNewRouteGeoError(null);
            },
            onPlaceResolved: (p) => {
              setNewRouteDest(p.formattedAddress);
              setNewRouteDestCoords({ lat: p.lat, lng: p.lng });
              setNewRouteGeoError(null);
            },
            inputStyle: newRoutePlaceInputStyle,
            placeholder: mapsKeyConfigured ? 'Buscar cidade ou endereço…' : 'ex: Rio de Janeiro, RJ',
          })),
        // Preço por pessoa
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4 } },
          React.createElement('label', { style: { fontSize: 13, fontWeight: 500, color: '#767676', ...font } }, 'Preço por pessoa (R$)'),
          React.createElement('input', {
            type: 'number', value: newRoutePreco,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setNewRoutePreco(e.target.value),
            placeholder: '0.00', min: '0', step: '0.01',
            style: { height: 44, borderRadius: 8, background: '#f1f1f1', border: 'none', outline: 'none', padding: '0 16px', fontSize: 14, width: '100%', boxSizing: 'border-box', ...font },
          })),
        newRouteGeoError
          ? React.createElement('div', { role: 'alert', style: { fontSize: 13, color: '#b53838', ...font } }, newRouteGeoError)
          : null,
        // Buttons
        React.createElement('div', { style: { display: 'flex', gap: 8 } },
          React.createElement('button', {
            type: 'button',
            onClick: closeNewRouteModal,
            style: { flex: 1, height: 44, borderRadius: 8, border: '1px solid #e2e2e2', background: '#fff', fontSize: 14, fontWeight: 500, cursor: 'pointer', ...font },
          }, 'Cancelar'),
          React.createElement('button', {
            type: 'button',
            disabled: routeActionLoading || !newRouteOrigin.trim() || !newRouteDest.trim(),
            onClick: async () => {
              if (!id || !newRouteOrigin.trim() || !newRouteDest.trim()) return;
              if (mapsKeyConfigured && (!newRouteOriginCoords || !newRouteDestCoords)) {
                setNewRouteGeoError('Selecione origem e destino nas sugestões do Google para salvar latitude e longitude.');
                return;
              }
              setRouteActionLoading(true);
              setNewRouteGeoError(null);
              const priceCents = Math.round(parseFloat(newRoutePreco || '0') * 100);
              const { error } = await createWorkerRoute(id, {
                origin: newRouteOrigin.trim(),
                destination: newRouteDest.trim(),
                priceCents,
                ...(newRouteOriginCoords
                  ? { originLat: newRouteOriginCoords.lat, originLng: newRouteOriginCoords.lng }
                  : {}),
                ...(newRouteDestCoords
                  ? { destinationLat: newRouteDestCoords.lat, destinationLng: newRouteDestCoords.lng }
                  : {}),
              });
              if (!error) {
                const db = supabase as any;
                const { data: rData } = await db.from('worker_routes').select('*').eq('worker_id', id).order('created_at', { ascending: false });
                setRoutes(rData || []);
                closeNewRouteModal();
              } else {
                setNewRouteGeoError(error);
              }
              setRouteActionLoading(false);
            },
            style: {
              flex: 1, height: 44, borderRadius: 8, border: 'none', background: '#0d0d0d', color: '#fff',
              fontSize: 14, fontWeight: 600, cursor: routeActionLoading ? 'wait' : 'pointer',
              opacity: (routeActionLoading || !newRouteOrigin.trim() || !newRouteDest.trim()) ? 0.5 : 1, ...font,
            },
          }, routeActionLoading ? 'Salvando...' : 'Salvar'))))
    : null;

  const closeDeleteRouteModal = () => {
    setDeleteRouteDraft(null);
    setDeleteRouteConsent(false);
    setDeleteRouteLoading(false);
  };

  const deleteRouteModal = deleteRouteDraft
    ? React.createElement('div', {
        role: 'dialog',
        'aria-modal': true,
        'aria-labelledby': 'delete-route-dialog-title',
        style: {
          position: 'fixed' as const,
          inset: 0,
          background: 'rgba(0,0,0,0.4)',
          zIndex: 1001,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
          boxSizing: 'border-box' as const,
        },
        onClick: closeDeleteRouteModal,
      },
      React.createElement('div', {
        style: {
          background: '#fff',
          borderRadius: 16,
          padding: 24,
          width: '100%',
          maxWidth: 440,
          display: 'flex',
          flexDirection: 'column' as const,
          gap: 16,
          boxSizing: 'border-box' as const,
        },
        onClick: (e: React.MouseEvent) => e.stopPropagation(),
      },
        React.createElement('h2', {
          id: 'delete-route-dialog-title',
          style: { fontSize: 18, fontWeight: 700, margin: 0, color: '#0d0d0d', ...font },
        }, 'Remover rota'),
        React.createElement('p', { style: { fontSize: 14, color: '#3a3a3a', margin: 0, lineHeight: 1.5, ...font } },
          'Esta rota será excluída permanentemente do cadastro do motorista. Passageiros não poderão mais ver nem solicitar viagens com este trecho.'),
        React.createElement('div', {
          style: {
            fontSize: 14,
            fontWeight: 600,
            color: '#0d0d0d',
            lineHeight: 1.45,
            padding: '12px 14px',
            background: '#f6f6f6',
            borderRadius: 8,
            ...font,
          },
        },
          React.createElement('span', { style: { color: '#767676', fontWeight: 500 } }, 'Trecho: '),
          `${deleteRouteDraft.origin} → ${deleteRouteDraft.destination}`),
        React.createElement('label', {
          style: {
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            cursor: 'pointer',
            fontSize: 14,
            color: '#0d0d0d',
            lineHeight: 1.45,
            ...font,
          },
        },
          React.createElement('input', {
            type: 'checkbox',
            checked: deleteRouteConsent,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDeleteRouteConsent(e.target.checked),
            style: { width: 18, height: 18, marginTop: 2, flexShrink: 0, cursor: 'pointer' },
          }),
          React.createElement('span', null, 'Li e entendo que esta ação não pode ser desfeita.')),
        React.createElement('div', { style: { display: 'flex', gap: 8 } },
          React.createElement('button', {
            type: 'button',
            onClick: closeDeleteRouteModal,
            disabled: deleteRouteLoading,
            style: {
              flex: 1,
              height: 44,
              borderRadius: 8,
              border: '1px solid #e2e2e2',
              background: '#fff',
              fontSize: 14,
              fontWeight: 500,
              cursor: deleteRouteLoading ? 'wait' : 'pointer',
              opacity: deleteRouteLoading ? 0.7 : 1,
              ...font,
            },
          }, 'Cancelar'),
          React.createElement('button', {
            type: 'button',
            disabled: !deleteRouteConsent || deleteRouteLoading,
            onClick: async () => {
              if (!deleteRouteDraft || !deleteRouteConsent) return;
              const rid = deleteRouteDraft.id;
              setDeleteRouteLoading(true);
              try {
                await deleteWorkerRoute(rid);
                setRoutes((prev: any[]) => prev.filter((rt: any) => rt.id !== rid));
                closeDeleteRouteModal();
              } catch {
                setDeleteRouteLoading(false);
              }
            },
            style: {
              flex: 1,
              height: 44,
              borderRadius: 8,
              border: 'none',
              background: '#b53838',
              color: '#fff',
              fontSize: 14,
              fontWeight: 600,
              cursor: !deleteRouteConsent || deleteRouteLoading ? 'not-allowed' : 'pointer',
              opacity: !deleteRouteConsent || deleteRouteLoading ? 0.5 : 1,
              ...font,
            },
          }, deleteRouteLoading ? 'Removendo…' : 'Remover rota'))))
    : null;

  const nvLbl: React.CSSProperties = { fontSize: 13, fontWeight: 500, color: '#767676', ...font };
  const nvModalTextField = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    opts?: { inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']; maxLength?: number },
  ) =>
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4 } },
      React.createElement('label', { style: nvLbl }, label),
      React.createElement('input', {
        type: 'text',
        inputMode: opts?.inputMode,
        maxLength: opts?.maxLength,
        value,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value),
        style: newRoutePlaceInputStyle,
      }));

  const nvUploadOuter = (onActivate: () => void, caption = 'Clique para selecionar arquivo'): React.ReactNode =>
    React.createElement('button', {
      type: 'button',
      onClick: onActivate,
      style: {
        width: '100%',
        border: '2px dashed #e2e2e2',
        borderRadius: 8,
        background: '#fafafa',
        padding: '14px 12px',
        cursor: 'pointer',
        textAlign: 'center' as const,
        boxSizing: 'border-box' as const,
      },
    },
      React.createElement('span', { style: { fontSize: 13, color: '#767676', ...font } }, caption));

  const nvRadioRow = (
    value: 'principal' | 'reserva',
    title: string,
    sub: string,
  ) =>
    React.createElement('button', {
      type: 'button',
      onClick: () => setNvUseType(value),
      style: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        padding: 0,
        marginBottom: 10,
        width: '100%',
        textAlign: 'left' as const,
      },
    },
      React.createElement('div', {
        style: {
          width: 22,
          height: 22,
          borderRadius: 11,
          border: `2px solid ${nvUseType === value ? '#0d0d0d' : '#d1d5db'}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          marginTop: 2,
        },
      },
        nvUseType === value
          ? React.createElement('div', { style: { width: 10, height: 10, borderRadius: 5, background: '#0d0d0d' } })
          : null),
      React.createElement('div', { style: { flex: 1, minWidth: 0 } },
        React.createElement('div', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', ...font } }, title),
        React.createElement('div', { style: { fontSize: 12, color: '#767676', marginTop: 2, lineHeight: 1.45, ...font } }, sub)));

  const newVehicleModal = newVehicleOpen
    ? React.createElement('div', {
        role: 'dialog',
        'aria-modal': true,
        'aria-labelledby': 'new-vehicle-dialog-title',
        style: {
          position: 'fixed' as const,
          inset: 0,
          background: 'rgba(0,0,0,0.4)',
          zIndex: 1002,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
          boxSizing: 'border-box' as const,
        },
        onClick: closeNewVehicleModal,
      },
      React.createElement('div', {
        style: {
          background: '#fff',
          borderRadius: 16,
          padding: 24,
          width: '100%',
          maxWidth: 440,
          maxHeight: 'min(90vh, 720px)',
          overflowY: 'auto' as const,
          display: 'flex',
          flexDirection: 'column' as const,
          gap: 16,
          boxSizing: 'border-box' as const,
        },
        onClick: (e: React.MouseEvent) => e.stopPropagation(),
      },
        React.createElement('h2', {
          id: 'new-vehicle-dialog-title',
          style: { fontSize: 18, fontWeight: 700, margin: 0, color: '#0d0d0d', ...font },
        }, 'Adicionar novo veículo'),

          nvModalTextField('Modelo', nvModel, setNvModel),
          nvModalTextField('Ano do veículo', nvYear, (v) => setNvYear(v.replace(/\D/g, '').slice(0, 4)), { inputMode: 'numeric' }),
          nvModalTextField('Renavam', nvRenavam, setNvRenavam),
          nvModalTextField('Placa', nvPlate, (v) => setNvPlate(v.toUpperCase())),
          nvModalTextField(
            'Capacidade de passageiros (máx. 5)',
            nvPassengerCapacity,
            (v) => setNvPassengerCapacity(v.replace(/\D/g, '').slice(0, 1)),
            { inputMode: 'numeric' },
          ),

          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 4 } },
            React.createElement('span', { style: nvLbl }, 'Definir tipo de uso do veículo'),
            nvRadioRow('principal', 'Principal', 'Veículo principal utilizado nas corridas.'),
            nvRadioRow('reserva', 'Reserva', 'Usado apenas quando o principal estiver indisponível.')),

          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8 } },
            React.createElement('span', { style: nvLbl }, 'Documento do veículo'),
            React.createElement('input', {
              ref: nvDocInputRef,
              type: 'file',
              accept: '.pdf,application/pdf,image/*',
              style: { display: 'none' },
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                if (f.size > NV_DOC_MAX_BYTES) {
                  setNvError('Documento muito grande (máx. 10 MB).');
                  return;
                }
                const ok = f.type === 'application/pdf' || f.type.startsWith('image/');
                if (!ok) {
                  setNvError('Use PDF ou imagem para o documento do veículo.');
                  return;
                }
                setNvError(null);
                setNvDocFile(f);
              },
            }),
            nvDocFile
              ? React.createElement('div', {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 0',
                    borderBottom: '1px solid #f1f1f1',
                  },
                },
                  React.createElement('span', { style: { flex: 1, fontSize: 14, color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, ...font } }, nvDocFile.name),
                  React.createElement('button', {
                    type: 'button',
                    onClick: () => setNvDocFile(null),
                    style: { background: 'none', border: 'none', color: '#b53838', fontSize: 13, fontWeight: 600, cursor: 'pointer', ...font },
                  }, 'Remover'),
                  React.createElement('button', {
                    type: 'button',
                    onClick: () => nvDocInputRef.current?.click(),
                    style: { background: 'none', border: 'none', color: '#0d0d0d', fontSize: 13, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', ...font },
                  }, 'Alterar'))
              : nvUploadOuter(() => nvDocInputRef.current?.click())),

          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8 } },
            React.createElement('span', { style: nvLbl }, 'Fotos do veículo'),
            React.createElement('span', { style: { fontSize: 12, color: '#767676', ...font } }, `Máx. ${MAX_NEW_VEHICLE_PHOTOS} fotos, 20MB`),
            React.createElement('input', {
              ref: nvPhotoInputRef,
              type: 'file',
              accept: 'image/*',
              multiple: true,
              style: { display: 'none' },
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                const list = e.target.files;
                e.target.value = '';
                if (!list?.length) return;
                const next = [...nvPhotoFiles];
                for (let i = 0; i < list.length; i++) {
                  if (next.length >= MAX_NEW_VEHICLE_PHOTOS) break;
                  const f = list[i];
                  if (!f.type.startsWith('image/')) {
                    setNvError('Envie apenas imagens nas fotos do veículo.');
                    return;
                  }
                  if (f.size > NV_PHOTO_MAX_BYTES) {
                    setNvError('Cada foto pode ter no máximo 20 MB.');
                    return;
                  }
                  next.push(f);
                }
                setNvError(null);
                setNvPhotoFiles(next);
              },
            }),
            nvPhotoFiles.length > 0
              ? React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap' as const, gap: 12 } },
                  ...nvPhotoFiles.map((f, i) =>
                    React.createElement('div', { key: `${f.name}-${i}`, style: { display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 6 } },
                      React.createElement('div', {
                        style: {
                          width: 140,
                          height: 120,
                          borderRadius: 8,
                          background: '#f1f1f1',
                          overflow: 'hidden',
                        },
                      }, React.createElement('img', {
                        src: nvPhotoUrls[i],
                        alt: '',
                        style: { width: '100%', height: '100%', objectFit: 'cover' as const },
                      })),
                      React.createElement('button', {
                        type: 'button',
                        onClick: () => setNvPhotoFiles((prev) => prev.filter((_, j) => j !== i)),
                        style: { background: 'none', border: 'none', fontSize: 13, color: '#374151', textDecoration: 'underline', cursor: 'pointer', ...font },
                      }, 'Remover foto'))),
                  nvPhotoFiles.length < MAX_NEW_VEHICLE_PHOTOS
                    ? React.createElement('button', {
                        type: 'button',
                        onClick: () => nvPhotoInputRef.current?.click(),
                        style: {
                          width: 140,
                          height: 120,
                          borderRadius: 8,
                          background: '#f1f1f1',
                          border: '1px dashed #e2e2e2',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        },
                      },
                        React.createElement('svg', { width: 28, height: 28, viewBox: '0 0 24 24', fill: 'none' },
                          React.createElement('path', { d: 'M12 5v14M5 12h14', stroke: '#767676', strokeWidth: 2, strokeLinecap: 'round' })))
                    : null)
              : nvUploadOuter(() => nvPhotoInputRef.current?.click(), 'Clique para fazer upload (múltiplas fotos)')),

          nvError
            ? React.createElement('div', { role: 'alert', style: { fontSize: 13, color: '#b53838', ...font } }, nvError)
            : null,

          React.createElement('div', { style: { display: 'flex', gap: 8 } },
            React.createElement('button', {
              type: 'button',
              onClick: closeNewVehicleModal,
              disabled: nvSaving,
              style: {
                flex: 1,
                height: 44,
                borderRadius: 8,
                border: '1px solid #e2e2e2',
                background: '#fff',
                fontSize: 14,
                fontWeight: 500,
                color: '#0d0d0d',
                cursor: nvSaving ? 'wait' : 'pointer',
                opacity: nvSaving ? 0.7 : 1,
                ...font,
              },
            }, 'Cancelar'),
            React.createElement('button', {
              type: 'button',
              onClick: () => void saveNewVehicle(),
              disabled: nvSaving,
              style: {
                flex: 1,
                height: 44,
                borderRadius: 8,
                border: 'none',
                background: '#0d0d0d',
                color: '#fff',
                fontSize: 14,
                fontWeight: 600,
                cursor: nvSaving ? 'wait' : 'pointer',
                opacity: nvSaving ? 0.65 : 1,
                ...font,
              },
            }, nvSaving ? 'Salvando…' : 'Salvar veículo'))))
    : null;

  const routesAddButton = React.createElement('div', {
    style: { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 48, width: '100%' },
  },
    React.createElement('button', {
      type: 'button',
      onClick: () => {
        setNewRouteGeoError(null);
        setNewRouteOriginCoords(null);
        setNewRouteDestCoords(null);
        setNewRouteOrigin('');
        setNewRouteDest('');
        setNewRoutePreco('');
        setNewRouteOpen(true);
      },
      style: {
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        fontSize: 12,
        fontWeight: 500,
        color: '#0d0d0d',
        textDecoration: 'underline',
        textUnderlineOffset: 3,
        padding: '8px 12px',
        borderRadius: 999,
        ...font,
      },
    }, 'Adicionar nova rota'));

  const routesSection = React.createElement('div', {
    style: {
      display: 'flex',
      flexDirection: 'column' as const,
      gap: 16,
      paddingBottom: 32,
      borderBottom: '1px solid #e2e2e2',
      width: '100%',
      boxSizing: 'border-box' as const,
    },
  },
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8, width: '100%' } },
      React.createElement('p', { style: { fontSize: 16, fontWeight: 600, color: '#767676', margin: 0, lineHeight: 'normal', ...font } }, 'Rotas e valores'),
      React.createElement('p', { style: { fontSize: 14, fontWeight: 400, color: '#767676', margin: 0, lineHeight: 1.5, ...font } }, 'Defina suas rotas e preços.')),
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 16, width: '100%' } },
      ...routes.map((r: any, i: number) => routeCard(r, i)),
      routes.length === 0
        ? React.createElement('p', { style: { fontSize: 14, color: '#767676', margin: 0, lineHeight: 1.5, ...font } }, 'Nenhuma rota cadastrada.')
        : null,
      routesAddButton));

  // ── Veículos cadastrados (Figma 1271:33917) ────────────────────────────
  const vehicleCardFigma = (v: any, i: number) =>
    React.createElement('div', {
      key: v.id ?? i,
      style: {
        background: '#f1f1f1',
        minHeight: 188,
        display: 'flex',
        flexDirection: 'column' as const,
        justifyContent: 'space-between',
        padding: 16,
        borderRadius: 8,
        width: '100%',
        boxSizing: 'border-box' as const,
      },
    },
      React.createElement('div', { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', width: '100%', gap: 12 } },
        React.createElement('div', {
          style: {
            fontSize: 20, fontWeight: 600, color: '#0d0d0d', lineHeight: 1.5, ...font,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, minWidth: 0,
          },
        }, `${v.model || 'Veículo'}${v.year != null ? ` ${v.year}` : ''}`),
        React.createElement('span', {
          style: {
            flexShrink: 0,
            padding: '4px 8px',
            borderRadius: 90,
            fontSize: 12,
            fontWeight: 600,
            color: '#0d0d0d',
            ...font,
            background: i === 0 ? '#cba04b' : '#fff',
            boxShadow: i === 0 ? 'none' : 'inset 0 0 0 1px #e2e2e2',
          },
        }, i === 0 ? 'Principal' : 'Reserva')),
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8 } },
        React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', ...font } }, v.plate || '—'),
        React.createElement('span', { style: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', ...font } },
          `${v.passenger_capacity ?? 4} passageiros`)));

  const vehiclesAddLink = isEditMode
    ? React.createElement('div', { style: { display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 48, width: '100%' } },
        React.createElement('button', {
          type: 'button',
          onClick: () => {
            setNvError(null);
            setNewVehicleOpen(true);
          },
          style: {
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 500,
            color: '#0d0d0d',
            textDecoration: 'underline',
            textUnderlineOffset: 3,
            padding: '8px 12px',
            ...font,
          },
        }, 'Adicionar novo veículo'))
    : null;

  const vehiclesInnerCard = React.createElement('div', {
    style: {
      border: '1px solid #e2e2e2',
      borderRadius: 12,
      padding: 24,
      display: 'flex',
      flexDirection: 'column' as const,
      gap: 16,
      width: '100%',
      boxSizing: 'border-box' as const,
      background: '#fff',
    },
  },
    vehicles.length === 0
      ? React.createElement('span', { style: { fontSize: 14, color: '#767676', ...font } }, 'Nenhum veículo cadastrado')
      : null,
    ...vehicles.map((v: any, i: number) => vehicleCardFigma(v, i)),
    vehiclesAddLink);

  const vehiclesSection = React.createElement('div', {
    style: {
      display: 'flex',
      flexDirection: 'column' as const,
      gap: 16,
      paddingBottom: 32,
      borderBottom: '1px solid #e2e2e2',
      width: '100%',
      boxSizing: 'border-box' as const,
    },
  },
    React.createElement('h2', { style: { fontSize: 20, fontWeight: 600, color: '#0d0d0d', margin: 0, width: '100%', ...font } }, 'Veículos cadastrados'),
    vehiclesInnerCard);

  // ── Métricas (contagens no servidor; km não há coluna no schema — placeholder) ──
  const metricsSection = React.createElement('div', {
    style: { display: 'flex', flexDirection: 'column' as const, gap: 12 },
  },
    React.createElement('h3', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', margin: 0, ...font } }, 'Métricas e histórico'),
    React.createElement('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap' as const } },
      ...[
        {
          title: 'Viagens realizadas',
          value: completedTripsCount != null ? String(completedTripsCount) : '—',
        },
        { title: 'Média de km percorridos', value: '—' },
        {
          title: 'Encomendas realizadas',
          value: deliveredShipmentsCount != null ? String(deliveredShipmentsCount) : '—',
        },
      ].map((m) =>
        React.createElement('div', {
          key: m.title,
          style: { flex: '1 1 0', minWidth: 150, background: '#f6f6f6', borderRadius: 16, padding: '16px 20px', display: 'flex', flexDirection: 'column' as const, gap: 12 },
        },
          React.createElement('span', { style: { fontSize: 12, color: '#767676', ...font } }, m.title),
          React.createElement('span', { style: { fontSize: 28, fontWeight: 700, color: '#0d0d0d', ...font } }, m.value)))));

  // ── Histórico de alterações (derivado de worker_profiles, worker_routes, vehicles;
  //     status_history no banco não inclui entidade «motorista».)
  const histIcon = (pathD: string) =>
    React.createElement('div', {
      style: { width: 36, height: 36, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
    }, React.createElement('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none' },
      React.createElement('path', { d: pathD, stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' })));

  const historicoSection = React.createElement('div', {
    style: { display: 'flex', flexDirection: 'column' as const, gap: 12 },
  },
    React.createElement('h3', { style: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', margin: 0, ...font } }, 'Histórico de alterações'),
    historicoTimelineItems.length === 0
      ? React.createElement('p', {
          style: { fontSize: 14, color: '#767676', margin: 0, lineHeight: 1.5, ...font },
        },
          'Não há eventos rastreados para este perfil. O banco não mantém auditoria específica de motorista (apenas viagens, encomendas e excursões em status_history); rotas, veículos e revisões do cadastro aparecem aqui quando existirem.')
      : null,
    historicoTimelineItems.length > 0
      ? React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8 } },
          ...historicoTimelineItems.map((item) =>
            React.createElement('div', {
              key: item.key,
              style: {
                display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px',
                background: '#f6f6f6', borderRadius: 12,
              },
            },
              histIcon(item.iconPath),
              React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 2, flex: 1 } },
                React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', ...font } },
                  `${item.label} • `, React.createElement('span', { style: { color: '#cba04b' } }, item.person)),
                React.createElement('span', { style: { fontSize: 12, color: '#767676', ...font } }, item.date)))))
      : null);

  return React.createElement('div', {
    style: { display: 'flex', flexDirection: 'column' as const, gap: 24, width: '100%', maxWidth: 1044, boxSizing: 'border-box' as const },
  },
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 24, width: '100%' } },
      breadcrumb, header, toast, saveErrorBanner),
    statusActions,
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 32, width: '100%' } },
      dadosSection, platformFeeSection, photosSection, routesSection, vehiclesSection, metricsSection, historicoSection),
    newRouteModal,
    deleteRouteModal,
    newVehicleModal,
    settleModal,
    pfToastEl);
}
