import { useState, useEffect, useCallback } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Modal,
  Pressable,
  Image,
} from 'react-native';
import { Text } from '../../components/Text';
import { MaterialIcons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { SupportSheet } from '../../components/SupportSheet';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ActivitiesStackParamList } from '../../navigation/ActivitiesStackTypes';
import { supabase } from '../../lib/supabase';

type Props = NativeStackScreenProps<ActivitiesStackParamList, 'ExcursionDetail'>;

const COLORS = {
  background: '#FFFFFF',
  black: '#0d0d0d',
  neutral300: '#f1f1f1',
  neutral400: '#e2e2e2',
  neutral700: '#767676',
};

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';

const FLEET_LABELS: Record<string, string> = {
  carro: 'Carro',
  van: 'Van',
  micro_onibus: 'Micro-ônibus',
  onibus: 'Ônibus',
};

type AssignmentNotes = {
  driver_note?: string;
  preparer_note?: string;
  preparer_role?: string;
};

type VehicleDetails = {
  model?: string;
  license_plate?: string;
  color?: string;
  capacity?: number;
  observation?: string;
};

type BudgetLine = { label: string; amount_cents: number };

type ExcursionDetail = {
  id: string;
  user_id: string;
  destination: string;
  excursion_date: string;
  people_count: number;
  fleet_type: string;
  first_aid_team: boolean;
  recreation_team: boolean;
  children_team: boolean;
  special_needs_team: boolean;
  recreation_items: unknown[];
  observations: string | null;
  status: string;
  sub_status: string | null;
  created_at: string;
  total_amount_cents: number | null;
  confirmed_at: string | null;
  scheduled_departure_at: string | null;
  driver_id: string | null;
  preparer_id: string | null;
  assignment_notes: AssignmentNotes | null;
  vehicle_details: VehicleDetails | null;
  budget_lines: BudgetLine[] | null;
  payment_method: string | null;
};

type ProfileRow = {
  id: string;
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  rating: number | null;
  verified: boolean | null;
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  const day = d.getDate();
  const months = 'Jan Fev Mar Abr Mai Jun Jul Ago Set Out Nov Dez'.split(' ');
  const month = months[d.getMonth()];
  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');
  return `${day} ${month} • ${hours}:${minutes}`;
}

function formatDateShort(iso: string): string {
  const d = new Date(iso);
  const day = d.getDate();
  const months = 'Jan Fev Mar Abr Mai Jun Jul Ago Set Out Nov Dez'.split(' ');
  const month = months[d.getMonth()];
  return `${day} ${month}`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
}

function displayId(id: string): string {
  return id.length >= 6 ? `EX${id.slice(-6).toUpperCase()}` : id;
}

function getStatusBarLabel(status: string): string {
  switch (status) {
    case 'pending':
    case 'in_analysis':
      return 'Excursão em análise';
    case 'quoted':
      return 'Orçamento disponível';
    case 'approved':
    case 'scheduled':
      return 'Excursão confirmada';
    case 'in_progress':
      return 'Em andamento';
    case 'completed':
      return 'Excursão concluída';
    case 'cancelled':
      return 'Excursão cancelada';
    default:
      return 'Excursão';
  }
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getExcursionBudgetLines(raw: unknown): BudgetLine[] {
  if (Array.isArray(raw)) return raw as BudgetLine[];
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as Record<string, unknown>;
  if (Array.isArray(obj.display_lines)) return obj.display_lines as BudgetLine[];
  return [];
}

export function ExcursionDetailScreen({ navigation, route }: Props) {
  const excursionRequestId = route.params?.excursionRequestId ?? '';
  const [detail, setDetail] = useState<ExcursionDetail | null>(null);
  const [passengerCount, setPassengerCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showDriverSheet, setShowDriverSheet] = useState(false);
  const [showPreparerSheet, setShowPreparerSheet] = useState(false);
  const [showVehicleSheet, setShowVehicleSheet] = useState(false);
  const [supportSheetVisible, setSupportSheetVisible] = useState(false);
  const insets = useSafeAreaInsets();
  const [driverProfile, setDriverProfile] = useState<ProfileRow | null>(null);
  const [preparerProfile, setPreparerProfile] = useState<ProfileRow | null>(null);

  const loadDetail = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !excursionRequestId) {
      setLoading(false);
      return;
    }
    const { data: row, error } = await supabase
      .from('excursion_requests')
      .select('id, user_id, destination, excursion_date, people_count, fleet_type, first_aid_team, recreation_team, children_team, special_needs_team, recreation_items, observations, status, sub_status, created_at, total_amount_cents, confirmed_at, scheduled_departure_at, driver_id, preparer_id, assignment_notes, vehicle_details, budget_lines, payment_method')
      .eq('id', excursionRequestId)
      .eq('user_id', user.id)
      .single();
    if (error || !row) {
      setLoading(false);
      return;
    }
    setDetail(row as ExcursionDetail);
    const { count } = await supabase
      .from('excursion_passengers')
      .select('*', { count: 'exact', head: true })
      .eq('excursion_request_id', excursionRequestId);
    setPassengerCount(count ?? 0);
    setLoading(false);
  }, [excursionRequestId]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  const loadDriverProfile = useCallback(async (driverId: string) => {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, phone, avatar_url, rating, verified')
      .eq('id', driverId)
      .single();
    setDriverProfile(data as ProfileRow | null);
  }, []);

  const loadPreparerProfile = useCallback(async (preparerId: string) => {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, phone, avatar_url, rating, verified')
      .eq('id', preparerId)
      .single();
    setPreparerProfile(data as ProfileRow | null);
  }, []);

  useEffect(() => {
    if (showDriverSheet && detail?.driver_id) loadDriverProfile(detail.driver_id);
    else if (!showDriverSheet) setDriverProfile(null);
  }, [showDriverSheet, detail?.driver_id, loadDriverProfile]);

  useEffect(() => {
    if (showPreparerSheet && detail?.preparer_id) loadPreparerProfile(detail.preparer_id);
    else if (!showPreparerSheet) setPreparerProfile(null);
  }, [showPreparerSheet, detail?.preparer_id, loadPreparerProfile]);

  const notes = (detail?.assignment_notes ?? {}) as AssignmentNotes;
  const vehicle = detail?.vehicle_details ?? null;
  const budgetLines = getExcursionBudgetLines(detail?.budget_lines);
  const canShowBudget =
    detail?.status &&
    ['quoted', 'approved', 'scheduled', 'in_progress', 'completed'].includes(detail.status) &&
    budgetLines.length > 0;

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusBar style="dark" />
        <View style={styles.header}>
          <TouchableOpacity style={styles.closeButton} onPress={() => navigation.goBack()}>
            <MaterialIcons name="close" size={24} color={COLORS.black} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Detalhes da excursão</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.black} />
          <Text style={styles.loadingText}>Carregando...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!detail) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusBar style="dark" />
        <View style={styles.header}>
          <TouchableOpacity style={styles.closeButton} onPress={() => navigation.goBack()}>
            <MaterialIcons name="close" size={24} color={COLORS.black} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Detalhes da excursão</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.centered}>
          <Text style={styles.loadingText}>Excursão não encontrada.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const statusBarLabel = getStatusBarLabel(detail.status);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <TouchableOpacity style={styles.closeButton} onPress={() => navigation.goBack()}>
          <MaterialIcons name="close" size={24} color={COLORS.black} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Detalhes da excursão</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.statusBar}>
          <MaterialIcons name={detail.status === 'completed' ? 'check-circle' : detail.status === 'cancelled' ? 'cancel' : 'schedule'} size={20} color="#FFFFFF" />
          <Text style={styles.statusBarText}>{statusBarLabel}</Text>
        </View>

        <Text style={styles.excursionId}>Excursão - Pedido #{displayId(detail.id)}</Text>
        <Text style={styles.dateRow}>
          {detail.confirmed_at ? `Confirmada em ${formatDate(detail.confirmed_at)}` : `Solicitada em ${formatDate(detail.created_at)}`}
        </Text>
        {detail.scheduled_departure_at && (
          <Text style={styles.dateRow}>Saída prevista: {formatDateShort(detail.scheduled_departure_at)} • {formatTime(detail.scheduled_departure_at)}</Text>
        )}
        {detail.sub_status === 'awaiting_quote' && (
          <View style={styles.pill}>
            <MaterialIcons name="schedule" size={14} color={COLORS.neutral700} />
            <Text style={styles.pillText}>Aguardando orçamento</Text>
          </View>
        )}

        {detail.total_amount_cents != null && detail.total_amount_cents > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Valor total</Text>
            <Text style={styles.cardValue}>R$ {(detail.total_amount_cents / 100).toFixed(2).replace('.', ',')}</Text>
          </View>
        )}

        <View style={styles.infoRow}>
          <MaterialIcons name="place" size={20} color={COLORS.neutral700} />
          <Text style={styles.infoText}>{detail.destination}</Text>
        </View>
        <View style={styles.infoRow}>
          <MaterialIcons name="people" size={20} color={COLORS.neutral700} />
          <Text style={styles.infoText}>{detail.people_count} pessoas</Text>
        </View>
        <View style={styles.infoRow}>
          <MaterialIcons name="directions-bus" size={20} color={COLORS.neutral700} />
          <Text style={styles.infoText}>{FLEET_LABELS[detail.fleet_type] ?? detail.fleet_type}</Text>
        </View>
        {detail.recreation_team && (
          <View style={styles.infoRow}>
            <MaterialIcons name="group" size={20} color={COLORS.neutral700} />
            <Text style={styles.infoText}>Equipe de recreação</Text>
          </View>
        )}
        {detail.first_aid_team && (
          <View style={styles.infoRow}>
            <MaterialIcons name="medical-services" size={20} color={COLORS.neutral700} />
            <Text style={styles.infoText}>Equipe de primeiros socorros</Text>
          </View>
        )}

        <Text style={styles.sectionTitle}>Tracking de status</Text>
        <StatusTimeline status={detail.status} />

        <Text style={styles.sectionTitle}>Detalhes</Text>
        {detail.driver_id ? (
          <TouchableOpacity style={styles.linkRow} onPress={() => setShowDriverSheet(true)}>
            <Text style={styles.linkLabel}>Ver motorista</Text>
            <Text style={styles.linkAction}>Ver detalhes</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.linkRow}>
            <Text style={styles.linkLabelMuted}>Motorista</Text>
            <Text style={styles.linkMuted}>Ainda não designado</Text>
          </View>
        )}
        {detail.preparer_id ? (
          <TouchableOpacity style={styles.linkRow} onPress={() => setShowPreparerSheet(true)}>
            <Text style={styles.linkLabel}>Ver preparador</Text>
            <Text style={styles.linkAction}>Ver detalhes</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.linkRow}>
            <Text style={styles.linkLabelMuted}>Preparador</Text>
            <Text style={styles.linkMuted}>Ainda não designado</Text>
          </View>
        )}
        {vehicle ? (
          <TouchableOpacity style={styles.linkRow} onPress={() => setShowVehicleSheet(true)}>
            <Text style={styles.linkLabel}>Ver veículo</Text>
            <Text style={styles.linkAction}>Ver detalhes</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.linkRow}>
            <Text style={styles.linkLabelMuted}>Veículo</Text>
            <Text style={styles.linkMuted}>Ainda não designado</Text>
          </View>
        )}

        <Text style={styles.sectionTitle}>Passageiros</Text>
        <TouchableOpacity
          style={styles.linkRow}
          onPress={() => navigation.navigate('ExcursionPassengerList', { excursionRequestId })}
        >
          <Text style={styles.linkLabel}>Lista de passageiros</Text>
          <Text style={styles.linkAction}>Ver lista</Text>
        </TouchableOpacity>
        {passengerCount > 0 && (
          <Text style={styles.passengerCount}>{passengerCount} cadastrado(s)</Text>
        )}

        {canShowBudget && (
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => navigation.navigate('ExcursionBudget', { excursionRequestId })}
          >
            <Text style={styles.primaryButtonText}>Ver orçamento</Text>
          </TouchableOpacity>
        )}

        {(detail.status === 'scheduled' || detail.status === 'approved' || detail.status === 'in_progress') && (
          <TouchableOpacity style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Acompanhar detalhes</Text>
          </TouchableOpacity>
        )}

        {detail.status === 'completed' && (
          <TouchableOpacity style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Recibo</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      <DriverSheet
        visible={showDriverSheet}
        onClose={() => setShowDriverSheet(false)}
        profile={driverProfile}
        driverNote={notes.driver_note}
      />
      <PreparerSheet
        visible={showPreparerSheet}
        onClose={() => setShowPreparerSheet(false)}
        profile={preparerProfile}
        role={notes.preparer_role}
        preparerNote={notes.preparer_note}
      />
      <VehicleSheet
        visible={showVehicleSheet}
        onClose={() => setShowVehicleSheet(false)}
        vehicle={vehicle}
        driverName={driverProfile?.full_name ?? null}
      />

      <TouchableOpacity style={[styles.fab, { bottom: Math.max(24, insets.bottom + 16) }]} onPress={() => setSupportSheetVisible(true)} activeOpacity={0.8}>
        <Image source={require('../../../assets/icons/icon-chat.png')} style={styles.fabIcon} />
      </TouchableOpacity>

      <SupportSheet
        visible={supportSheetVisible}
        onClose={() => setSupportSheetVisible(false)}
        showDriverChat={detail?.status != null && !['completed', 'cancelled'].includes(detail.status)}
        onOpenDriverChat={async () => {
          if (!detail?.driver_id) {
            navigation.navigate('Chat', { contactName: 'Motorista' });
            return;
          }
          const { data: p } = await supabase
            .from('profiles')
            .select('full_name, avatar_url')
            .eq('id', detail.driver_id)
            .single();
          navigation.navigate('Chat', {
            contactName: p?.full_name ?? 'Motorista',
            driverId: detail.driver_id,
            bookingId: null,
            participantAvatarKey: p?.avatar_url ?? null,
          });
        }}
        onOpenSupportChat={() =>
          navigation.navigate('Chat', { contactName: 'Suporte Take Me', supportBackoffice: true })}
      />
    </SafeAreaView>
  );
}

function StatusTimeline({ status }: { status: string }) {
  const isAnalysis = ['pending', 'in_analysis'].includes(status);
  const stepsAnalysis = [
    { key: 'sent', label: 'Pedido enviado', done: true },
    { key: 'assessing', label: 'Avaliando disponibilidade', done: ['in_analysis', 'quoted', 'approved', 'scheduled', 'in_progress', 'completed'].includes(status) },
    { key: 'preparing', label: 'Preparando orçamento', done: ['quoted', 'approved', 'scheduled', 'in_progress', 'completed'].includes(status) },
    { key: 'approved', label: 'Excursão aprovada', done: ['approved', 'scheduled', 'in_progress', 'completed'].includes(status) },
  ];
  const stepsScheduled = [
    { key: 'confirmed', label: 'Pedido confirmado', done: ['quoted', 'approved', 'scheduled', 'in_progress', 'completed'].includes(status) },
    { key: 'budget', label: 'Orçamento aprovado', done: ['approved', 'scheduled', 'in_progress', 'completed'].includes(status) },
    { key: 'scheduled', label: 'Excursão marcada', done: ['scheduled', 'in_progress', 'completed'].includes(status) },
    { key: 'progress', label: 'Em andamento', done: ['in_progress', 'completed'].includes(status) },
    { key: 'done', label: 'Concluída', done: status === 'completed' },
  ];
  const steps = isAnalysis ? stepsAnalysis : stepsScheduled;
  return (
    <View style={styles.timeline}>
      {steps.map((step, i) => (
        <View key={step.key} style={styles.timelineRow}>
          <View style={[styles.timelineDot, step.done && styles.timelineDotDone]} />
          {i < steps.length - 1 && <View style={styles.timelineLine} />}
          <Text style={[styles.timelineLabel, step.done && styles.timelineLabelDone]}>{step.label}</Text>
        </View>
      ))}
    </View>
  );
}

function DriverSheet({
  visible,
  onClose,
  profile,
  driverNote,
}: {
  visible: boolean;
  onClose: () => void;
  profile: ProfileRow | null;
  driverNote?: string;
}) {
  const avatarUri = profile?.avatar_url
    ? (profile.avatar_url.startsWith('http') ? profile.avatar_url : `${supabaseUrl}/storage/v1/object/public/avatars/${profile.avatar_url}`)
    : null;
  return (
    <Modal visible={visible} transparent animationType="fade">
      <Pressable style={styles.sheetOverlay} onPress={onClose}>
        <View style={styles.sheet}>
          <Pressable onPress={onClose} style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Motorista responsável</Text>
            <MaterialIcons name="close" size={24} color={COLORS.black} />
          </Pressable>
          {profile && (
            <View style={styles.sheetBody}>
              {avatarUri ? (
                <Image source={{ uri: avatarUri }} style={styles.sheetAvatar} />
              ) : (
                <View style={[styles.sheetAvatar, styles.sheetAvatarFallback]}>
                  <Text style={styles.sheetAvatarText}>{getInitials(profile.full_name ?? '')}</Text>
                </View>
              )}
              <Text style={styles.sheetName}>{profile.full_name ?? 'Motorista'}</Text>
              {profile.rating != null && (
                <Text style={styles.sheetRating}>★ {Number(profile.rating).toFixed(1)}</Text>
              )}
              {profile.verified && (
                <Text style={styles.sheetDoc}>Documento: CNH verificada</Text>
              )}
              {profile.phone && (
                <Text style={styles.sheetContact}>Contato: {profile.phone}</Text>
              )}
              {driverNote ? (
                <View style={styles.sheetNote}>
                  <Text style={styles.sheetNoteLabel}>Observação:</Text>
                  <Text style={styles.sheetNoteText}>{driverNote}</Text>
                </View>
              ) : null}
            </View>
          )}
        </View>
      </Pressable>
    </Modal>
  );
}

function PreparerSheet({
  visible,
  onClose,
  profile,
  role,
  preparerNote,
}: {
  visible: boolean;
  onClose: () => void;
  profile: ProfileRow | null;
  role?: string;
  preparerNote?: string;
}) {
  const avatarUri = profile?.avatar_url
    ? (profile.avatar_url.startsWith('http') ? profile.avatar_url : `${supabaseUrl}/storage/v1/object/public/avatars/${profile.avatar_url}`)
    : null;
  return (
    <Modal visible={visible} transparent animationType="fade">
      <Pressable style={styles.sheetOverlay} onPress={onClose}>
        <View style={styles.sheet}>
          <Pressable onPress={onClose} style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Preparador designado</Text>
            <MaterialIcons name="close" size={24} color={COLORS.black} />
          </Pressable>
          {profile && (
            <View style={styles.sheetBody}>
              {avatarUri ? (
                <Image source={{ uri: avatarUri }} style={styles.sheetAvatar} />
              ) : (
                <View style={[styles.sheetAvatar, styles.sheetAvatarFallback]}>
                  <Text style={styles.sheetAvatarText}>{getInitials(profile.full_name ?? '')}</Text>
                </View>
              )}
              <Text style={styles.sheetName}>{profile.full_name ?? 'Preparador'}</Text>
              {profile.rating != null && (
                <Text style={styles.sheetRating}>★ {Number(profile.rating).toFixed(1)}</Text>
              )}
              {role && <Text style={styles.sheetRole}>Função: {role}</Text>}
              {profile.phone && (
                <Text style={styles.sheetContact}>Contato: {profile.phone}</Text>
              )}
              {preparerNote ? (
                <View style={styles.sheetNote}>
                  <Text style={styles.sheetNoteLabel}>Observação:</Text>
                  <Text style={styles.sheetNoteText}>{preparerNote}</Text>
                </View>
              ) : null}
            </View>
          )}
        </View>
      </Pressable>
    </Modal>
  );
}

function VehicleSheet({
  visible,
  onClose,
  vehicle,
  driverName,
}: {
  visible: boolean;
  onClose: () => void;
  vehicle: VehicleDetails | null;
  driverName: string | null;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <Pressable style={styles.sheetOverlay} onPress={onClose}>
        <View style={styles.sheet}>
          <Pressable onPress={onClose} style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Veículo designado</Text>
            <MaterialIcons name="close" size={24} color={COLORS.black} />
          </Pressable>
          {vehicle && (
            <View style={styles.sheetBody}>
              <View style={styles.vehicleRow}>
                <Text style={styles.vehicleLabel}>Modelo</Text>
                <Text style={styles.vehicleValue}>{vehicle.model ?? '—'}</Text>
              </View>
              <View style={styles.vehicleRow}>
                <Text style={styles.vehicleLabel}>Placa</Text>
                <Text style={styles.vehicleValue}>{vehicle.license_plate ?? '—'}</Text>
              </View>
              <View style={styles.vehicleRow}>
                <Text style={styles.vehicleLabel}>Cor</Text>
                <Text style={styles.vehicleValue}>{vehicle.color ?? '—'}</Text>
              </View>
              {vehicle.capacity != null && (
                <View style={styles.vehicleRow}>
                  <Text style={styles.vehicleLabel}>Capacidade</Text>
                  <Text style={styles.vehicleValue}>{vehicle.capacity} lugares</Text>
                </View>
              )}
              {driverName && (
                <View style={styles.vehicleRow}>
                  <Text style={styles.vehicleLabel}>Motorista responsável</Text>
                  <Text style={styles.vehicleValue}>{driverName}</Text>
                </View>
              )}
              {vehicle.observation ? (
                <View style={styles.sheetNote}>
                  <Text style={styles.sheetNoteLabel}>Observação:</Text>
                  <Text style={styles.sheetNoteText}>{vehicle.observation}</Text>
                </View>
              ) : null}
            </View>
          )}
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  fab: {
    position: 'absolute',
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FBBF24',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  fabIcon: { width: 28, height: 28 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.neutral400,
  },
  closeButton: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '600', color: COLORS.black, flex: 1, textAlign: 'center' },
  headerSpacer: { width: 32 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { fontSize: 15, color: COLORS.neutral700, marginTop: 12 },
  scroll: { flex: 1 },
  scrollContent: { padding: 24, paddingBottom: 48 },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.black,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginBottom: 16,
    gap: 8,
  },
  statusBarText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  excursionId: { fontSize: 18, fontWeight: '700', color: COLORS.black, marginBottom: 4 },
  dateRow: { fontSize: 14, color: COLORS.neutral700, marginBottom: 2 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: COLORS.neutral300,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 16,
    marginTop: 8,
    gap: 6,
  },
  pillText: { fontSize: 13, color: COLORS.neutral700 },
  card: {
    backgroundColor: COLORS.neutral300,
    padding: 16,
    borderRadius: 12,
    marginTop: 16,
  },
  cardLabel: { fontSize: 14, color: COLORS.neutral700 },
  cardValue: { fontSize: 20, fontWeight: '700', color: COLORS.black },
  infoRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 10 },
  infoText: { fontSize: 15, color: COLORS.black, flex: 1 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: COLORS.black, marginTop: 24, marginBottom: 12 },
  timeline: { marginLeft: 6 },
  timelineRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  timelineDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: COLORS.neutral400,
    marginRight: 12,
  },
  timelineDotDone: { backgroundColor: COLORS.black, borderColor: COLORS.black },
  timelineLine: {
    position: 'absolute',
    left: 5,
    top: 16,
    width: 2,
    height: 20,
    backgroundColor: COLORS.neutral400,
  },
  timelineLabel: { fontSize: 14, color: COLORS.neutral700 },
  timelineLabelDone: { color: COLORS.black, fontWeight: '500' },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.neutral400,
  },
  linkLabel: { fontSize: 15, fontWeight: '500', color: COLORS.black },
  linkAction: { fontSize: 14, color: COLORS.black, textDecorationLine: 'underline' },
  linkLabelMuted: { fontSize: 15, color: COLORS.neutral700 },
  linkMuted: { fontSize: 14, color: COLORS.neutral700 },
  passengerCount: { fontSize: 14, color: COLORS.neutral700, marginTop: 4 },
  primaryButton: {
    backgroundColor: COLORS.black,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 24,
  },
  primaryButtonText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  secondaryButton: {
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 12,
    borderWidth: 1,
    borderColor: COLORS.neutral400,
  },
  secondaryButtonText: { fontSize: 16, fontWeight: '600', color: COLORS.black },
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 24, maxHeight: '80%' },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: COLORS.black },
  sheetBody: { alignItems: 'center' },
  sheetAvatar: { width: 80, height: 80, borderRadius: 40, marginBottom: 12 },
  sheetAvatarFallback: { backgroundColor: COLORS.neutral300, justifyContent: 'center', alignItems: 'center' },
  sheetAvatarText: { fontSize: 24, fontWeight: '700', color: COLORS.black },
  sheetName: { fontSize: 18, fontWeight: '700', color: COLORS.black },
  sheetRating: { fontSize: 14, color: COLORS.neutral700, marginTop: 4 },
  sheetDoc: { fontSize: 14, color: COLORS.neutral700, marginTop: 4 },
  sheetRole: { fontSize: 14, color: COLORS.neutral700, marginTop: 4 },
  sheetContact: { fontSize: 14, color: COLORS.black, marginTop: 8 },
  sheetNote: { marginTop: 16, alignSelf: 'stretch' },
  sheetNoteLabel: { fontSize: 14, fontWeight: '600', color: COLORS.black, marginBottom: 4 },
  sheetNoteText: { fontSize: 14, color: COLORS.neutral700 },
  vehicleRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, alignSelf: 'stretch' },
  vehicleLabel: { fontSize: 14, color: COLORS.neutral700 },
  vehicleValue: { fontSize: 14, fontWeight: '500', color: COLORS.black },
});
