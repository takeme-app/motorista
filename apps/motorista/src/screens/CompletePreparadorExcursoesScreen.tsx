import { useEffect, useState, type ReactNode } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Linking,
  Platform,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Text } from '../components/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomSafeInset } from '@take-me/shared';
import { StatusBar } from 'expo-status-bar';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useAppAlert } from '../contexts/AppAlertContext';
import { supabase } from '../lib/supabase';
import { resolveWorkerBaseId } from '../lib/resolveWorkerBaseId';
import { getGoogleMapsApiKey } from '../lib/googleMapsConfig';
import { GoogleCityAutocomplete } from '../components/GoogleCityAutocomplete';
import type { GoogleGeocodeResult } from '@take-me/shared';
import { formatCpf, onlyDigits, validateCpf } from '../utils/formatCpf';
import { currencyInputToCents, formatCurrencyBRLInput } from '../utils/formatCurrency';

type Props = NativeStackScreenProps<RootStackParamList, 'CompletePreparadorExcursoes'>;

const BUCKET = 'driver-documents';
const PF_CERTIDAO_URL =
  'https://www.gov.br/pf/pt-br/assuntos/atendimento-ao-cidadao/certidoes';

type PayType = 'hourly' | 'daily';

function FieldBlock({
  label,
  supporting,
  children,
}: {
  label: string;
  supporting?: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.fieldBlock}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
      {supporting ? <Text style={styles.fieldSupporting}>{supporting}</Text> : null}
    </View>
  );
}

function UploadBox({
  title,
  subtitle,
  selected,
  onPress,
}: {
  title: string;
  subtitle: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.uploadBox} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.uploadIconCircle}>
        <MaterialIcons name="cloud-upload" size={26} color="#0D0D0D" />
      </View>
      <Text style={styles.uploadTitle}>{title}</Text>
      <Text style={styles.uploadSub}>{subtitle}</Text>
      {selected ? <Text style={styles.uploadOk}>✓ Documento adicionado</Text> : null}
    </TouchableOpacity>
  );
}

function RadioOption({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.radioRow} activeOpacity={0.7} onPress={onPress}>
      <View style={[styles.radioOuter, selected && styles.radioOuterActive]}>
        {selected ? <View style={styles.radioInner} /> : null}
      </View>
      <Text style={styles.radioLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

export function CompletePreparadorExcursoesScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const bottomInset = useBottomSafeInset();
  const { showAlert } = useAppAlert();

  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);

  const [fullName, setFullName] = useState('');
  const [cpf, setCpf] = useState('');
  const [age, setAge] = useState('');
  const [city, setCity] = useState('');
  const [cityResolved, setCityResolved] = useState(false);
  const [cityMeta, setCityMeta] = useState<{ locality: string | null; adminArea: string | null }>({
    locality: null,
    adminArea: null,
  });
  const [experienceYears, setExperienceYears] = useState('');

  const [cnhFrontUri, setCnhFrontUri] = useState<string | null>(null);
  const [cnhBackUri, setCnhBackUri] = useState<string | null>(null);
  const [criminalRecordUri, setCriminalRecordUri] = useState<string | null>(null);

  const [payType, setPayType] = useState<PayType>('hourly');
  const [baseRate, setBaseRate] = useState('');
  const [nightRate, setNightRate] = useState('');
  const [holidayRate, setHolidayRate] = useState('');

  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedNotifications, setAcceptedNotifications] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!active) return;
      setSessionUserId(data.user?.id ?? null);
      setSessionReady(true);
    })();
    return () => {
      active = false;
    };
  }, []);

  const credentialsReady = Boolean(sessionUserId);

  const pickImage = async (callback: (uri: string) => void) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      showAlert('Permissão', 'É necessário permitir acesso às fotos para enviar documentos.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.8,
      base64: true,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      callback(asset.base64 ? `data:image/jpeg;base64,${asset.base64}` : asset.uri);
    }
  };

  const openPfCertidao = async () => {
    try {
      await Linking.openURL(PF_CERTIDAO_URL);
    } catch {
      showAlert('Erro', 'Não foi possível abrir o link. Acesse gov.br/pf manualmente.');
    }
  };

  const validateAndSubmit = async () => {
    if (!sessionUserId) {
      showAlert('Sessão expirada', 'Faça login novamente para concluir o cadastro.');
      return;
    }
    if (!fullName.trim()) { showAlert('Atenção', 'Preencha o nome completo.'); return; }
    const cpfDigits = onlyDigits(cpf);
    if (cpfDigits.length !== 11 || !validateCpf(cpf)) { showAlert('CPF inválido', 'Informe um CPF válido.'); return; }
    const ageNum = parseInt(onlyDigits(age), 10);
    if (!ageNum || ageNum < 18 || ageNum > 100) { showAlert('Atenção', 'Informe uma idade válida (18–100).'); return; }
    if (!city.trim()) { showAlert('Atenção', 'Preencha a cidade.'); return; }
    const mapsKeyCity = getGoogleMapsApiKey()?.trim();
    if (mapsKeyCity) {
      if (!cityResolved) {
        showAlert(
          'Atenção',
          'Cidade: toque numa opção da lista até aparecer o ícone verde de confirmação ao lado do campo.',
        );
        return;
      }
    } else if (!cityResolved) {
      showAlert(
        'Atenção',
        'Cidade: informe ao menos 2 caracteres ou configure EXPO_PUBLIC_GOOGLE_MAPS_API_KEY para buscar e confirmar na lista.',
      );
      return;
    }
    const expNum = parseInt(onlyDigits(experienceYears), 10);
    if (!expNum || expNum < 1 || expNum > 60) { showAlert('Atenção', 'Informe os anos de experiência (1–60).'); return; }
    if (!cnhFrontUri) { showAlert('Atenção', 'Envie a frente da CNH.'); return; }
    if (!cnhBackUri) { showAlert('Atenção', 'Envie o verso da CNH.'); return; }

    const baseCents = currencyInputToCents(baseRate);
    if (!baseCents || baseCents <= 0) {
      showAlert(
        'Atenção',
        payType === 'hourly' ? 'Informe o preço por hora.' : 'Informe o preço por diária.',
      );
      return;
    }
    const nightCents = currencyInputToCents(nightRate);
    if (!nightCents || nightCents <= 0) {
      showAlert('Atenção', 'Informe o preço noturno (18h–4:59h).');
      return;
    }
    const holidayCents = currencyInputToCents(holidayRate);
    if (!holidayCents || holidayCents <= 0) {
      showAlert('Atenção', 'Informe o preço para domingos e feriados.');
      return;
    }

    if (!acceptedTerms) { showAlert('Atenção', 'Aceite os Termos de Uso e a Política de Privacidade.'); return; }

    setLoading(true);
    try {
      const userId = sessionUserId;
      const nowIso = new Date().toISOString();

      const uploadDoc = async (uri: string, path: string): Promise<string> => {
        const base64 = uri.startsWith('data:') ? uri.split(',')[1] ?? '' : null;
        if (!base64) throw new Error('Documento inválido. Selecione a imagem novamente.');
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const { data, error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
          contentType: 'image/jpeg',
          upsert: true,
        });
        if (error) throw new Error(error.message || 'Falha ao enviar documento.');
        return data.path;
      };

      const cnhFrontPath = await uploadDoc(cnhFrontUri, `${userId}/cnh_front.jpg`);
      const cnhBackPath = await uploadDoc(cnhBackUri, `${userId}/cnh_back.jpg`);
      let criminalPath: string | null = null;
      if (criminalRecordUri) {
        criminalPath = await uploadDoc(criminalRecordUri, `${userId}/criminal_record.jpg`);
      }

      await supabase.from('profiles').update({
        full_name: fullName.trim(),
        cpf: cpfDigits,
        city: city.trim(),
        updated_at: nowIso,
      }).eq('id', userId);

      const baseId = await resolveWorkerBaseId(cityMeta.locality, cityMeta.adminArea, city.trim());

      const { data: existing } = await supabase
        .from('worker_profiles')
        .select('id, status')
        .eq('id', userId)
        .maybeSingle();

      // Finaliza etapa 4: promove draft 'inactive' para 'pending' (aguarda aprovação admin).
      // Preserva estados posteriores (under_review/approved/rejected/suspended).
      const nextStatus =
        !existing || existing.status === 'inactive' ? 'pending' : existing.status;

      const workerPayload = {
        role: 'preparer' as const,
        subtype: 'excursions' as const,
        status: nextStatus,
        cpf: cpfDigits,
        age: ageNum,
        city: city.trim(),
        experience_years: expNum,
        has_own_vehicle: false,
        cnh_document_url: cnhFrontPath,
        cnh_document_back_url: cnhBackPath,
        background_check_url: criminalPath,
        base_id: baseId,
        pay_type: payType,
        hourly_rate_cents: payType === 'hourly' ? baseCents : null,
        daily_rate_cents: payType === 'daily' ? baseCents : null,
        night_rate_cents: nightCents,
        holiday_rate_cents: holidayCents,
        updated_at: nowIso,
      };

      if (existing?.id) {
        const { error: upErr } = await supabase
          .from('worker_profiles')
          .update(workerPayload)
          .eq('id', userId);
        if (upErr) throw new Error(upErr.message || 'Falha ao atualizar perfil.');
      } else {
        const { error: insErr } = await supabase
          .from('worker_profiles')
          .insert({ id: userId, ...workerPayload, created_at: nowIso });
        if (insErr) throw new Error(insErr.message || 'Falha ao salvar perfil.');
      }

      try {
        const { tryOpenSupportTicket } = await import('../lib/supportTickets');
        void tryOpenSupportTicket('cadastro_transporte', { worker_id: userId });
      } catch {
        /* ignore */
      }

      navigation.reset({
        index: 0,
        routes: [{ name: 'StripeConnectSetup', params: { subtype: 'excursions' } }],
      });
    } catch (err: unknown) {
      showAlert('Erro', err instanceof Error ? err.message : 'Erro ao enviar cadastro.');
    } finally {
      setLoading(false);
    }
  };

  const baseRateLabel = payType === 'hourly' ? 'Preço por hora' : 'Preço por diária';
  const baseRatePlaceholder = payType === 'hourly' ? 'Ex: R$ 80,00' : 'Ex: R$ 250,00';
  const baseRateSupporting =
    payType === 'hourly'
      ? 'Valor padrão por hora trabalhada.'
      : 'Valor padrão por período de trabalho.';

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior="height"
      // No Android o app já pana a janela inteira (SOFT_INPUT_ADJUST_PAN global,
      // App.tsx). Deixar o KAV TAMBÉM encolher a view desconta a altura do
      // teclado duas vezes e sobra um vão cinza do tamanho do teclado no rodapé
      // — a tela "cortada ao meio". O ChatScreen já tinha chegado nessa mesma
      // conclusão e por isso não usa KAV. No iOS não há pan, então o KAV
      // continua sendo o que levanta o conteúdo.
      enabled={Platform.OS !== 'android'}
    >
      <StatusBar style="dark" />
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => {
            if (navigation.canGoBack()) {
              navigation.goBack();
              return;
            }
            Alert.alert(
              'Sair do cadastro?',
              'Você perderá o progresso desta etapa e voltará para a tela inicial. Você poderá retomar depois entrando com a sua conta.',
              [
                { text: 'Continuar cadastro', style: 'cancel' },
                {
                  text: 'Sair',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      await supabase.auth.signOut();
                    } catch (err) {
                      console.warn('[CompletePreparadorExcursoes] signOut:', err);
                    }
                    navigation.reset({ index: 0, routes: [{ name: 'Welcome' }] });
                  },
                },
              ],
            );
          }}
          activeOpacity={0.7}
        >
          <MaterialIcons name="arrow-back" size={24} color="#0D0D0D" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Complete seu cadastro</Text>
        <View style={styles.headerRight} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomInset + 32 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.pageHeader}>
          <Text style={styles.pageTitle}>Complete seu cadastro</Text>
          <Text style={styles.pageSubtitle}>
            Preencha as informações para validar seu perfil como preparador de excursões.
          </Text>
        </View>

        <Text style={styles.sectionTitle}>Dados básicos</Text>
        <FieldBlock label="Nome completo">
          <TextInput
            style={styles.input}
            placeholder="Digite seu nome completo"
            placeholderTextColor="#767676"
            value={fullName}
            onChangeText={setFullName}
          />
        </FieldBlock>
        <FieldBlock label="CPF">
          <TextInput
            style={styles.input}
            placeholder="Ex: 123.456.789-99"
            placeholderTextColor="#767676"
            value={cpf}
            onChangeText={(t) => setCpf(formatCpf(t))}
            keyboardType="number-pad"
            maxLength={14}
          />
        </FieldBlock>
        <FieldBlock label="Idade">
          <TextInput
            style={styles.input}
            placeholder="Ex: 25 anos"
            placeholderTextColor="#767676"
            value={age}
            onChangeText={(t) => setAge(onlyDigits(t).slice(0, 3))}
            keyboardType="number-pad"
            maxLength={3}
          />
        </FieldBlock>
        <FieldBlock label="Cidade">
          <GoogleCityAutocomplete
            placeholder="Digite sua cidade"
            value={city}
            onChangeText={setCity}
            onSelectPlace={(p: GoogleGeocodeResult) => {
              setCityMeta({ locality: p.locality, adminArea: p.adminAreaLevel1 });
            }}
            onResolutionChange={(resolved) => {
              setCityResolved(resolved);
              if (!resolved) setCityMeta({ locality: null, adminArea: null });
            }}
            cityConfirmed={cityResolved}
            inputStyle={styles.input}
          />
        </FieldBlock>
        <FieldBlock label="Anos de experiência">
          <TextInput
            style={styles.input}
            placeholder="Ex: 5 anos"
            placeholderTextColor="#767676"
            value={experienceYears}
            onChangeText={(t) => setExperienceYears(onlyDigits(t).slice(0, 2))}
            keyboardType="number-pad"
            maxLength={2}
          />
        </FieldBlock>

        <Text style={styles.sectionTitle}>Documentos</Text>

        <Text style={styles.fieldLabel}>CNH (frente e verso)</Text>
        <View style={styles.uploadStack}>
          <UploadBox
            title="Frente"
            subtitle="Envie a frente da CNH, RG ou documento de identificação válido."
            selected={!!cnhFrontUri}
            onPress={() => pickImage(setCnhFrontUri)}
          />
          <UploadBox
            title="Verso"
            subtitle="Envie o verso da CNH, RG ou documento de identificação válido."
            selected={!!cnhBackUri}
            onPress={() => pickImage(setCnhBackUri)}
          />
        </View>

        <View style={styles.criminalLabelRow}>
          <TouchableOpacity onPress={openPfCertidao} activeOpacity={0.6} style={styles.infoIconBtn}>
            <MaterialIcons name="info-outline" size={16} color="#0D0D0D" />
          </TouchableOpacity>
          <Text style={styles.fieldLabelInline}>Antecedentes Criminais</Text>
        </View>
        <UploadBox
          title="Emitir documento no site da Polícia Federal"
          subtitle="O arquivo deve ter sido emitido nos últimos 90 dias."
          selected={!!criminalRecordUri}
          onPress={() => pickImage(setCriminalRecordUri)}
        />

        <Text style={styles.sectionTitle}>Valores e precificação</Text>

        <Text style={styles.fieldLabel}>Selecione o tipo de remuneração</Text>
        <View style={styles.radioGroup}>
          <RadioOption
            label="Valor por hora"
            selected={payType === 'hourly'}
            onPress={() => setPayType('hourly')}
          />
          <RadioOption
            label="Valor por diária"
            selected={payType === 'daily'}
            onPress={() => setPayType('daily')}
          />
        </View>

        <FieldBlock label={baseRateLabel} supporting={baseRateSupporting}>
          <TextInput
            style={styles.input}
            placeholder={baseRatePlaceholder}
            placeholderTextColor="#767676"
            value={baseRate ? `R$ ${baseRate}` : ''}
            onChangeText={(t) => setBaseRate(formatCurrencyBRLInput(t))}
            keyboardType="number-pad"
          />
        </FieldBlock>

        <FieldBlock
          label="Preço noturno (18h–4:59h)"
          supporting="Serviços realizados no período noturno."
        >
          <TextInput
            style={styles.input}
            placeholder="Ex: R$ 280,00"
            placeholderTextColor="#767676"
            value={nightRate ? `R$ ${nightRate}` : ''}
            onChangeText={(t) => setNightRate(formatCurrencyBRLInput(t))}
            keyboardType="number-pad"
          />
        </FieldBlock>

        <FieldBlock
          label="Domingos e feriados"
          supporting="Defina o valor para dias de alta demanda."
        >
          <TextInput
            style={styles.input}
            placeholder="Ex: R$ 300,00"
            placeholderTextColor="#767676"
            value={holidayRate ? `R$ ${holidayRate}` : ''}
            onChangeText={(t) => setHolidayRate(formatCurrencyBRLInput(t))}
            keyboardType="number-pad"
          />
        </FieldBlock>

        <View style={styles.checksSection}>
          <View style={styles.checkboxRow}>
            <TouchableOpacity onPress={() => setAcceptedTerms((v) => !v)} activeOpacity={0.7} style={styles.checkboxHitArea}>
              <View style={[styles.checkbox, acceptedTerms && styles.checkboxChecked]}>
                {acceptedTerms ? <Text style={styles.checkmark}>✓</Text> : null}
              </View>
            </TouchableOpacity>
            <View style={styles.checkboxLabelWrap}>
              <Text style={styles.termsText}>
                Concordo com os{' '}
                <Text style={styles.linkInline} onPress={() => navigation.navigate('TermsOfUse')}>Termos de Uso</Text>
                {' '}e a{' '}
                <Text style={styles.linkInline} onPress={() => navigation.navigate('PrivacyPolicy')}>Política de Privacidade</Text>.
              </Text>
            </View>
          </View>
          <View style={styles.checkboxRow}>
            <TouchableOpacity onPress={() => setAcceptedNotifications((v) => !v)} activeOpacity={0.7} style={styles.checkboxHitArea}>
              <View style={[styles.checkbox, acceptedNotifications && styles.checkboxChecked]}>
                {acceptedNotifications ? <Text style={styles.checkmark}>✓</Text> : null}
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.checkboxLabelWrap} onPress={() => setAcceptedNotifications((v) => !v)} activeOpacity={0.7}>
              <Text style={styles.checkLabelStandalone}>Aceito receber ofertas e comunicações do Take Me.</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={[styles.footerInScroll, { paddingBottom: bottomInset }]}>
          <TouchableOpacity
            style={[styles.submitBtn, (!credentialsReady || !sessionReady || loading) && styles.submitBtnDisabled]}
            onPress={validateAndSubmit}
            activeOpacity={0.8}
            disabled={!credentialsReady || !sessionReady || loading}
          >
            <Text style={styles.submitBtnText}>{loading ? 'Salvando...' : 'Enviar cadastro'}</Text>
          </TouchableOpacity>
          {sessionReady && !credentialsReady ? (
            <Text style={styles.credentialsHint}>Sessão expirada. Faça login para continuar.</Text>
          ) : null}
          <TouchableOpacity onPress={() => navigation.navigate('Login')} style={styles.backToLogin}>
            <Text style={styles.backToLoginText}>Voltar para o login</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12 },
  backBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#F1F1F1', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 14, fontWeight: '700', color: '#0D0D0D' },
  headerRight: { width: 48 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 8 },
  pageHeader: { marginBottom: 24, alignItems: 'flex-start' },
  pageTitle: { fontSize: 24, fontWeight: '600', color: '#0D0D0D', marginBottom: 4 },
  pageSubtitle: { fontSize: 14, color: '#767676', lineHeight: 21 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#767676', marginBottom: 8, marginTop: 24 },
  fieldBlock: { marginBottom: 8 },
  fieldLabel: { fontSize: 14, fontWeight: '500', color: '#0D0D0D', marginBottom: 8, marginTop: 8 },
  fieldLabelInline: { fontSize: 14, fontWeight: '500', color: '#0D0D0D' },
  fieldSupporting: { fontSize: 12, fontWeight: '500', color: '#767676', marginTop: 8 },
  input: {
    backgroundColor: '#F1F1F1',
    borderWidth: 0,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: '#0D0D0D',
  },
  uploadStack: { gap: 8 },
  uploadBox: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#767676',
    borderRadius: 12,
    paddingVertical: 24,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  uploadIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#FFF8E6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadTitle: { fontSize: 16, fontWeight: '500', color: '#767676', textAlign: 'center' },
  uploadSub: { fontSize: 12, fontWeight: '600', color: '#767676', textAlign: 'center', lineHeight: 18 },
  uploadOk: { fontSize: 13, color: '#059669', marginTop: 6, fontWeight: '600' },
  criminalLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16, marginBottom: 8 },
  infoIconBtn: { padding: 2 },
  radioGroup: { marginBottom: 8 },
  radioRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, gap: 12 },
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#767676',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterActive: { borderColor: '#0D0D0D' },
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#0D0D0D' },
  radioLabel: { fontSize: 14, fontWeight: '500', color: '#0D0D0D' },
  checksSection: { marginTop: 24, marginBottom: 8 },
  checkboxRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12, minHeight: 28 },
  checkboxHitArea: { paddingVertical: 4, paddingRight: 12, justifyContent: 'flex-start' },
  checkboxLabelWrap: { flex: 1, paddingTop: 2, paddingLeft: 2, justifyContent: 'center' },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: '#767676', alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: '#0D0D0D', borderColor: '#0D0D0D' },
  checkmark: { fontSize: 14, color: '#FFF', fontWeight: '700' },
  checkLabelStandalone: { fontSize: 12, color: '#767676', lineHeight: 18, fontWeight: '600' },
  termsText: { fontSize: 12, color: '#767676', lineHeight: 18, fontWeight: '600' },
  linkInline: { color: '#016DF9', fontWeight: '600', fontSize: 12, lineHeight: 18 },
  footerInScroll: { marginTop: 28 },
  submitBtn: { backgroundColor: '#0D0D0D', paddingVertical: 14, borderRadius: 8, alignItems: 'center', height: 48, justifyContent: 'center' },
  submitBtnDisabled: { opacity: 0.45 },
  submitBtnText: { fontSize: 16, fontWeight: '500', color: '#FFFFFF' },
  credentialsHint: { fontSize: 13, color: '#767676', textAlign: 'center', marginTop: 10 },
  backToLogin: { alignItems: 'center', marginTop: 12, paddingBottom: 8, height: 48, justifyContent: 'center' },
  backToLoginText: { fontSize: 16, color: '#0D0D0D', fontWeight: '500' },
});
