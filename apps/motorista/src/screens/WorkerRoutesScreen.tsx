import { useState, useCallback, useRef } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Animated,
  Pressable,
  Share,
  Alert,
} from 'react-native';
import { useBottomSheetDrag } from '../hooks/useBottomSheetDrag';
import { Text } from '../components/Text';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ProfileStackParamList } from '../navigation/types';
import { supabase } from '../lib/supabase';
import { SCREEN_TOP_EXTRA_PADDING } from '../theme/screenLayout';
import { useAppAlert } from '../contexts/AppAlertContext';
import { GooglePlacesAutocomplete } from '../components/GooglePlacesAutocomplete';
import { googleForwardGeocode, type GoogleGeocodeResult } from '@take-me/shared';
import { getGoogleMapsApiKey } from '../lib/googleMapsConfig';
import { formatCurrencyBRLInput, parseCurrencyBRLToNumber } from '../utils/formatCurrency';
import { SwipeableRouteRow } from '../components/SwipeableRouteRow';

type Props = NativeStackScreenProps<ProfileStackParamList, 'WorkerRoutes'>;

type RouteRow = {
  id: string;
  origin_address: string;
  destination_address: string;
  price_per_person_cents: number;
  is_active: boolean | null;
};

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function shortAddress(full: string): string {
  const parts = full.split(',');
  return parts[0]?.trim() ?? full;
}

/** Viagens **ainda ativas** desta rota com passageiro, dependente ou encomenda já aceitos —
 *  só nesse caso barramos a exclusão. Viagens concluídas/canceladas não impedem (ficam no histórico). */
async function routeHasAcceptedServices(workerRouteId: string, workerId: string): Promise<boolean> {
  const { data: trips } = await supabase
    .from('scheduled_trips')
    .select('id')
    .eq('route_id', workerRouteId)
    .eq('driver_id', workerId)
    .in('status', ['active', 'scheduled']);
  const tripIds = (trips ?? []).map((t: { id: string }) => t.id);
  if (tripIds.length === 0) return false;

  const [b, d, s] = await Promise.all([
    supabase
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .in('scheduled_trip_id', tripIds)
      .in('status', ['confirmed', 'in_progress']),
    supabase
      .from('dependent_shipments')
      .select('id', { count: 'exact', head: true })
      .in('scheduled_trip_id', tripIds)
      .in('status', ['confirmed', 'in_progress']),
    supabase
      .from('shipments')
      .select('id', { count: 'exact', head: true })
      .in('scheduled_trip_id', tripIds)
      .in('status', ['confirmed', 'in_progress'])
      .not('driver_id', 'is', null),
  ]);
  return ((b.count ?? 0) > 0 || (d.count ?? 0) > 0 || (s.count ?? 0) > 0);
}

export function WorkerRoutesScreen({ navigation, route }: Props) {
  const { showAlert } = useAppAlert();
  const [rows, setRows] = useState<RouteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [openSwipeId, setOpenSwipeId] = useState<string | null>(null);
  type SheetMode = 'add' | 'import' | null;
  const [sheetMode, setSheetMode] = useState<SheetMode>(null);
  const [saving, setSaving] = useState(false);
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [originPlace, setOriginPlace] = useState<GoogleGeocodeResult | null>(null);
  const [destinationPlace, setDestinationPlace] = useState<GoogleGeocodeResult | null>(null);
  const [price, setPrice] = useState('');
  const slideAnim = useRef(new Animated.Value(300)).current;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) {
      setRows([]);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from('worker_routes')
      .select('id, origin_address, destination_address, price_per_person_cents, is_active')
      .eq('worker_id', user.id)
      .eq('is_active', true)
      .order('created_at', { ascending: true });
    if (error) {
      console.warn('[WorkerRoutesScreen] worker_routes', error.message);
      setLoadError(error.message ?? 'Não foi possível carregar as rotas.');
      setRows([]);
    } else {
      setRows((data ?? []) as RouteRow[]);
    }
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      setOpenSwipeId(null);
      load();
    }, [load]),
  );

  const openAddSheet = () => {
    setOrigin('');
    setDestination('');
    setOriginPlace(null);
    setDestinationPlace(null);
    setPrice('');
    resetDrag();
    slideAnim.setValue(300);
    setSheetMode('add');
    Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
  };

  const openImportSheet = () => {
    resetDrag();
    slideAnim.setValue(300);
    setSheetMode('import');
    Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
  };

  const closeSheet = () => {
    Animated.timing(slideAnim, { toValue: 300, duration: 250, useNativeDriver: true }).start(() => setSheetMode(null));
  };

  const { dragY, panHandlers, resetDrag } = useBottomSheetDrag(closeSheet);

  const runDeleteRoute = async (routeId: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) {
      showAlert('Erro', 'Não autenticado.');
      return;
    }
    if (await routeHasAcceptedServices(routeId, user.id)) {
      showAlert(
        'Não é possível excluir',
        'Esta rota possui viagens com passageiro, dependente ou encomenda já aceitos. Conclua ou cancele esses vínculos antes de excluir a rota.',
      );
      return;
    }
    setDeletingId(routeId);
    try {
      const { error: u1 } = await supabase
        .from('scheduled_trips')
        .update({
          is_active: false,
          status: 'cancelled',
          updated_at: new Date().toISOString(),
          driver_journey_started_at: null,
        } as never)
        .eq('route_id', routeId)
        .eq('driver_id', user.id)
        .in('status', ['active', 'scheduled']);
      if (u1) throw u1;

      // Soft delete: marcamos `is_active=false` em vez de DELETE.
      // `load()` filtra por `is_active=true`, então a rota some da lista do motorista,
      // mas mantemos histórico (viagens passadas referenciam route_id via FK) sem risco de constraint.
      const { error: delErr } = await supabase
        .from('worker_routes')
        .update({ is_active: false, updated_at: new Date().toISOString() } as never)
        .eq('id', routeId)
        .eq('worker_id', user.id);
      if (delErr) throw delErr;
      await load();
    } catch (e: unknown) {
      const msg =
        (e as { message?: string })?.message ??
        'Não foi possível excluir. Se existirem reservas ou vínculos ativos nesta rota, cancele-os antes.';
      showAlert('Erro', msg);
    } finally {
      setDeletingId(null);
    }
  };

  const confirmDeleteRoute = (r: RouteRow) => {
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) {
        showAlert('Erro', 'Não autenticado.');
        return;
      }
      if (await routeHasAcceptedServices(r.id, user.id)) {
        showAlert(
          'Não é possível excluir',
          'Esta rota possui viagens com passageiro, dependente ou encomenda já aceitos. Conclua ou cancele esses vínculos antes de excluir a rota.',
        );
        return;
      }
      Alert.alert(
        'Excluir rota',
        `Remover "${shortAddress(r.origin_address)} → ${shortAddress(r.destination_address)}"? As viagens planejadas desta rota serão canceladas e a rota some da lista.`,
        [
          { text: 'Voltar', style: 'cancel' },
          { text: 'Excluir', style: 'destructive', onPress: () => { void runDeleteRoute(r.id); } },
        ],
      );
    })();
  };

  const handleExportPdf = async () => {
    const now = new Date().toLocaleDateString('pt-BR');
    const separator = '─'.repeat(40);
    const lines = rows.map((r, i) =>
      `${i + 1}. ${shortAddress(r.origin_address)} → ${shortAddress(r.destination_address)}\n   ${formatCents(r.price_per_person_cents)} por pessoa`
    ).join('\n\n');
    const message = `MINHAS ROTAS\nGerado em ${now}\n${separator}\n\n${lines}`;
    try {
      await Share.share({ title: 'Minhas Rotas', message });
    } catch {
      showAlert('Erro', 'Não foi possível exportar as rotas.');
    }
  };

  const runImportAdminTemplates = async () => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) throw new Error('Não autenticado.');
      const { data: wp } = await (supabase as any).from('worker_profiles').select('subtype').eq('id', user.id).maybeSingle();
      const subtype = wp?.subtype || 'takeme';
      const roleType = subtype === 'shipments' ? 'preparer_shipments' : subtype === 'excursions' ? 'preparer_excursions' : 'driver';
      const { data: templates } = await (supabase as any)
        .from('pricing_routes')
        .select('id, origin_address, destination_address, price_cents')
        .eq('role_type', roleType)
        .eq('is_active', true);
      if (!templates?.length) {
        showAlert('Aviso', 'Nenhum template de rota disponível no momento.');
        return;
      }
      const inserts = templates.map((r: any) => ({
        worker_id: user.id,
        origin_address: r.origin_address,
        destination_address: r.destination_address,
        price_per_person_cents: r.price_cents || 0,
        is_active: true,
        pricing_route_id: r.id,
      }));
      const { error } = await supabase.from('worker_routes').insert(inserts);
      if (error) throw error;
      closeSheet();
      await load();
    } catch (e) {
      showAlert('Erro', (e as { message?: string })?.message ?? 'Erro ao importar templates.');
    } finally {
      setSaving(false);
    }
  };

  const runImportTakeMeRoutes = async () => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) throw new Error('Não autenticado.');
      const { data: tmRoutes } = await supabase
        .from('takeme_routes')
        .select(
          'origin_address, destination_address, price_per_person_cents, origin_lat, origin_lng, destination_lat, destination_lng',
        )
        .eq('is_active', true);
      if (!tmRoutes?.length) {
        showAlert('Aviso', 'Nenhuma rota TakeMe disponível no momento.');
        return;
      }
      const inserts = tmRoutes.map((r: any) => ({
        worker_id: user.id,
        origin_address: r.origin_address,
        destination_address: r.destination_address,
        price_per_person_cents: r.price_per_person_cents,
        is_active: true,
        ...(r.origin_lat != null && r.origin_lng != null
          ? { origin_lat: r.origin_lat, origin_lng: r.origin_lng }
          : {}),
        ...(r.destination_lat != null && r.destination_lng != null
          ? { destination_lat: r.destination_lat, destination_lng: r.destination_lng }
          : {}),
      }));
      const { error } = await supabase.from('worker_routes').insert(inserts);
      if (error) throw error;
      closeSheet();
      await load();
    } catch (e) {
      showAlert('Erro', (e as { message?: string })?.message ?? 'Erro ao importar rotas.');
    } finally {
      setSaving(false);
    }
  };

  const confirmImportTakeMe = () => {
    Alert.alert(
      'Importar rotas da Take Me',
      'As rotas padrão serão adicionadas à sua lista. Você pode editar depois. Deseja continuar?',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Importar', onPress: () => { void runImportTakeMeRoutes(); } },
      ],
    );
  };

  const confirmImportAdmin = () => {
    Alert.alert(
      'Importar templates do admin',
      'Os trechos configurados pelo administrador serão adicionados à sua lista. Deseja continuar?',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Importar', onPress: () => { void runImportAdminTemplates(); } },
      ],
    );
  };

  const handleSave = async () => {
    if (!origin.trim()) { showAlert('Atenção', 'Informe a origem.'); return; }
    if (!destination.trim()) { showAlert('Atenção', 'Informe o destino.'); return; }
    const reais = parseCurrencyBRLToNumber(price);
    const priceCents = reais != null ? Math.round(reais * 100) : 0;
    if (!priceCents || priceCents <= 0) { showAlert('Atenção', 'Informe um valor válido.'); return; }

    const apiKey = getGoogleMapsApiKey();
    setSaving(true);
    try {
      let oGeo = originPlace;
      let dGeo = destinationPlace;
      if (!oGeo || !dGeo) {
        if (!apiKey) {
          showAlert(
            'Mapas',
            'Escolha origem e destino na lista de sugestões ou configure EXPO_PUBLIC_GOOGLE_MAPS_API_KEY.',
          );
          return;
        }
        if (!oGeo) {
          oGeo = await googleForwardGeocode(`${origin.trim()}, Brasil`, apiKey);
          if (!oGeo) {
            showAlert('Origem', 'Não encontramos esse local. Toque em uma sugestão da lista ou refine o texto.');
            return;
          }
        }
        if (!dGeo) {
          dGeo = await googleForwardGeocode(`${destination.trim()}, Brasil`, apiKey);
          if (!dGeo) {
            showAlert('Destino', 'Não encontramos esse local. Toque em uma sugestão da lista ou refine o texto.');
            return;
          }
        }
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) throw new Error('Não autenticado.');
      const { error } = await supabase.from('worker_routes').insert({
        worker_id: user.id,
        origin_address: oGeo.placeName.trim() || origin.trim(),
        destination_address: dGeo.placeName.trim() || destination.trim(),
        origin_lat: oGeo.latitude,
        origin_lng: oGeo.longitude,
        destination_lat: dGeo.latitude,
        destination_lng: dGeo.longitude,
        price_per_person_cents: priceCents,
        is_active: true,
      });
      if (error) throw error;
      closeSheet();
      await load();
    } catch (e: unknown) {
      const msg = (e as { message?: string })?.message ?? 'Erro ao salvar rota.';
      showAlert('Erro', msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="dark" />

      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => route.params?.fromHome ? (navigation.getParent() as any)?.navigate('Home') : navigation.goBack()} activeOpacity={0.7}>
          <MaterialIcons name="arrow-back" size={22} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>Minhas rotas</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.iconBtn} onPress={openImportSheet} activeOpacity={0.7} accessibilityLabel="Importar rotas">
            <MaterialIcons name="cloud-download" size={22} color="#111827" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={handleExportPdf} activeOpacity={0.7} accessibilityLabel="Compartilhar lista de rotas">
            <MaterialIcons name="share" size={22} color="#111827" />
          </TouchableOpacity>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color="#111827" /></View>
      ) : loadError ? (
        <View style={styles.center}>
          <Text style={styles.loadErrorText}>{loadError}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => void load()} activeOpacity={0.75}>
            <Text style={styles.retryBtnText}>Tentar de novo</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {rows.length === 0 ? (
            <Text style={styles.emptyRoutesText}>
              Nenhuma rota ativa. Toque em «Adicionar nova rota» ou importe trechos pelo ícone de download.
            </Text>
          ) : null}
          {rows.map((r) => (
            <View key={r.id} style={styles.swipeRowWrap}>
              <SwipeableRouteRow
                isOpen={openSwipeId === r.id}
                onOpen={() => setOpenSwipeId(r.id)}
                onClose={() => setOpenSwipeId((cur) => (cur === r.id ? null : cur))}
                deleteAction={
                  <TouchableOpacity
                    style={[styles.deleteRouteBtn, deletingId === r.id && styles.deleteRouteBtnDisabled]}
                    onPress={() => confirmDeleteRoute(r)}
                    disabled={deletingId !== null}
                    accessibilityLabel="Excluir rota"
                    activeOpacity={0.7}
                  >
                    {deletingId === r.id ? (
                      <ActivityIndicator size="small" color="#EF4444" />
                    ) : (
                      <MaterialIcons name="delete-outline" size={24} color="#EF4444" />
                    )}
                  </TouchableOpacity>
                }
              >
                <TouchableOpacity
                  style={styles.card}
                  onPress={() => {
                    setOpenSwipeId(null);
                    navigation.navigate('RouteSchedule', {
                      routeId: r.id,
                      routeName: `${shortAddress(r.origin_address)} → ${shortAddress(r.destination_address)}`,
                    });
                  }}
                  activeOpacity={0.75}
                >
                  <View style={styles.cardInner}>
                    <View style={styles.cardText}>
                      <Text style={styles.cardRoute}>
                        {shortAddress(r.origin_address)}
                        <Text style={styles.arrow}> → </Text>
                        {shortAddress(r.destination_address)}
                      </Text>
                      <Text style={styles.cardPrice}>{formatCents(r.price_per_person_cents)} por pessoa</Text>
                    </View>
                    <MaterialIcons name="chevron-right" size={22} color="#9CA3AF" />
                  </View>
                </TouchableOpacity>
              </SwipeableRouteRow>
            </View>
          ))}

          <TouchableOpacity style={styles.addLink} onPress={openAddSheet} activeOpacity={0.7}>
            <Text style={styles.addLinkText}>Adicionar nova rota</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      <Modal visible={sheetMode !== null} transparent animationType="none" onRequestClose={closeSheet}>
        <KeyboardAvoidingView
          style={styles.modalContainer}
          behavior="padding"
        >
          <Pressable style={StyleSheet.absoluteFillObject} onPress={closeSheet} />
          <Animated.View
            style={[styles.sheet, { transform: [{ translateY: Animated.add(slideAnim, dragY) }] }]}
          >
            <View style={styles.handleArea} {...panHandlers}>
              <View style={styles.sheetHandle} />
            </View>
            <View style={styles.sheetHeader}>
              <TouchableOpacity style={styles.iconBtn} onPress={closeSheet} activeOpacity={0.7}>
                <MaterialIcons name="close" size={20} color="#111827" />
              </TouchableOpacity>
              <Text style={styles.sheetTitle}>
                {sheetMode === 'import' ? 'Importar rotas' : 'Adicionar nova rota'}
              </Text>
              <View style={{ width: 40 }} />
            </View>

            {sheetMode === 'import' ? (
              <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                <Text style={styles.importIntro}>
                  Escolha a origem dos trechos. Eles serão adicionados à sua lista e você poderá editar depois.
                </Text>

                <TouchableOpacity
                  style={[styles.importOption, saving && styles.importOptionDisabled]}
                  onPress={confirmImportTakeMe}
                  disabled={saving}
                  activeOpacity={0.75}
                >
                  <View style={styles.importOptionText}>
                    <Text style={styles.importOptionTitle}>Rotas padrão Take Me</Text>
                    <Text style={styles.importOptionSub}>
                      Trechos e preços cadastrados pela Take Me para todos os motoristas.
                    </Text>
                  </View>
                  <MaterialIcons name="chevron-right" size={22} color="#9CA3AF" />
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.importOption, saving && styles.importOptionDisabled]}
                  onPress={confirmImportAdmin}
                  disabled={saving}
                  activeOpacity={0.75}
                >
                  <View style={styles.importOptionText}>
                    <Text style={styles.importOptionTitle}>Templates do administrador</Text>
                    <Text style={styles.importOptionSub}>
                      Trechos configurados pelo admin para o seu tipo de perfil (base para suas rotas).
                    </Text>
                  </View>
                  <MaterialIcons name="chevron-right" size={22} color="#9CA3AF" />
                </TouchableOpacity>

                {saving ? (
                  <View style={styles.importLoading}>
                    <ActivityIndicator size="small" color="#111827" />
                    <Text style={styles.importLoadingText}>Importando…</Text>
                  </View>
                ) : null}

                <TouchableOpacity style={styles.cancelBtn} onPress={closeSheet} disabled={saving} activeOpacity={0.7}>
                  <Text style={styles.cancelBtnText}>Fechar</Text>
                </TouchableOpacity>
              </ScrollView>
            ) : (
              <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                <GooglePlacesAutocomplete
                  label="Origem"
                  placeholder="Digite cidade, bairro ou endereço"
                  value={origin}
                  onChangeText={(t) => {
                    setOrigin(t);
                    setOriginPlace(null);
                  }}
                  onSelectPlace={(place) => {
                    setOrigin(place.placeName);
                    setOriginPlace(place);
                  }}
                  hasResolvedCoords={originPlace != null}
                />

                <GooglePlacesAutocomplete
                  label="Destino"
                  placeholder="Digite cidade, bairro ou endereço"
                  value={destination}
                  onChangeText={(t) => {
                    setDestination(t);
                    setDestinationPlace(null);
                  }}
                  onSelectPlace={(place) => {
                    setDestination(place.placeName);
                    setDestinationPlace(place);
                  }}
                  hasResolvedCoords={destinationPlace != null}
                />

                <Text style={styles.fieldLabel}>Valor por pessoa</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Ex: R$ 25,00"
                  placeholderTextColor="#9CA3AF"
                  keyboardType="number-pad"
                  value={price ? `R$ ${price}` : ''}
                  onChangeText={(t) => {
                    const cleaned = t.replace(/R\$\s?/i, '');
                    setPrice(formatCurrencyBRLInput(cleaned));
                  }}
                />
                <Text style={styles.fieldHint}>
                  Igual ao cadastro: só números, da direita para a esquerda em centavos (ex.: 6000 = R$ 60,00).
                </Text>

                <TouchableOpacity
                  style={[styles.saveBtn, saving && { opacity: 0.6 }]}
                  onPress={handleSave}
                  disabled={saving}
                  activeOpacity={0.85}
                >
                  {saving
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={styles.saveBtnText}>Salvar rota</Text>
                  }
                </TouchableOpacity>

                <TouchableOpacity style={styles.cancelBtn} onPress={closeSheet} disabled={saving} activeOpacity={0.7}>
                  <Text style={styles.cancelBtnText}>Voltar sem salvar</Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </Animated.View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  loadErrorText: { fontSize: 14, color: '#6B7280', textAlign: 'center', marginBottom: 16 },
  retryBtn: {
    backgroundColor: '#111827',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
  },
  retryBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  emptyRoutesText: { fontSize: 14, color: '#6B7280', marginBottom: 16, lineHeight: 20 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 8 + SCREEN_TOP_EXTRA_PADDING,
    paddingBottom: 12,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '700', color: '#111827', textAlign: 'center', marginHorizontal: 4 },
  scroll: { paddingHorizontal: 20, paddingBottom: 40, paddingTop: 8 },
  swipeRowWrap: { marginBottom: 12 },
  card: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
    paddingHorizontal: 16,
    paddingVertical: 18,
  },
  deleteRouteBtn: {
    flex: 1,
    width: '100%' as const,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0,
    borderRadius: 0,
    backgroundColor: 'transparent',
  },
  deleteRouteBtnDisabled: { opacity: 0.5 },
  cardInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardText: { flex: 1 },
  cardRoute: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 4 },
  arrow: { color: '#C9A227', fontWeight: '700' },
  cardPrice: { fontSize: 14, color: '#6B7280' },
  addLink: { alignSelf: 'center', paddingVertical: 8, marginTop: 8 },
  addLinkText: { fontSize: 15, color: '#111827', textDecorationLine: 'underline', fontWeight: '500' },
  modalContainer: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 20, paddingBottom: 36, maxHeight: '90%',
  },
  handleArea: { paddingTop: 14, paddingBottom: 10, alignItems: 'center' },
  sheetHandle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: '#D1D5DB',
  },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12,
  },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: '#111827' },
  fieldLabel: { fontSize: 14, fontWeight: '600', color: '#111827', marginTop: 16, marginBottom: 8 },
  fieldHint: { fontSize: 12, color: '#9CA3AF', marginTop: 4, marginBottom: 4 },
  input: {
    backgroundColor: '#F3F4F6', borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, color: '#111827',
  },
  importIntro: {
    fontSize: 14, color: '#6B7280', lineHeight: 20, marginBottom: 16,
  },
  importOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 12,
    gap: 12,
  },
  importOptionDisabled: { opacity: 0.55 },
  importOptionText: { flex: 1 },
  importOptionTitle: { fontSize: 15, fontWeight: '600', color: '#111827', marginBottom: 4 },
  importOptionSub: { fontSize: 13, color: '#6B7280', lineHeight: 18 },
  importLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 8,
    marginBottom: 8,
  },
  importLoadingText: { fontSize: 14, color: '#6B7280' },
  saveBtn: {
    backgroundColor: '#111827', borderRadius: 14, paddingVertical: 16,
    alignItems: 'center', marginTop: 24,
  },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  cancelBtn: { alignItems: 'center', paddingVertical: 14, marginTop: 4 },
  cancelBtnText: { color: '#EF4444', fontSize: 15, fontWeight: '600' },
});
