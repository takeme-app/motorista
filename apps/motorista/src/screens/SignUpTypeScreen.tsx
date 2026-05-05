import { useEffect, useState } from 'react';
import { ActivityIndicator, View, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Text } from '../components/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList, RegistrationType } from '../navigation/types';
import { MaterialIcons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { useAppAlert } from '../contexts/AppAlertContext';
import { useDeferredDriverSignup } from '../contexts/DeferredDriverSignupContext';

type Props = NativeStackScreenProps<RootStackParamList, 'SignUpType'>;

/**
 * Mapeia `RegistrationType` → (role, subtype) usados em `worker_profiles`.
 * Precisa casar com a lógica usada em `verify-email-code`/`verify-phone-code`.
 */
function registrationTypeToWorker(t: RegistrationType): {
  role: 'driver' | 'preparer';
  subtype: 'takeme' | 'partner' | 'excursions' | 'shipments';
} {
  if (t === 'take_me') return { role: 'driver', subtype: 'takeme' };
  if (t === 'parceiro') return { role: 'driver', subtype: 'partner' };
  if (t === 'preparador_excursões') return { role: 'preparer', subtype: 'excursions' };
  return { role: 'preparer', subtype: 'shipments' };
}

export function SignUpTypeScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { showAlert } = useAppAlert();
  const { setDriverType } = useDeferredDriverSignup();
  const [selected, setSelected] = useState<RegistrationType | null>(null);
  const [submitting, setSubmitting] = useState(false);
  /**
   * Modo "retomar cadastro": usuário já está autenticado (Auth existe) mas sem
   * worker_profile (ex.: insert falhou na verify-email-code, ou o PIN foi verificado
   * mas a etapa 2 nunca chegou a ser iniciada). Ao escolher o tipo, criamos a linha
   * draft aqui e navegamos direto para a etapa 2 — sem passar por SignUp/VerifyEmail.
   */
  const [authUserId, setAuthUserId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      setAuthUserId(data.session?.user?.id ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const goBackToWelcome = async () => {
    if (authUserId) {
      await supabase.auth.signOut();
    }
    navigation.reset({ index: 0, routes: [{ name: 'Welcome' }] });
  };

  const handleNext = async () => {
    if (!selected) return;

    // Fluxo normal (sem sessão): email + senha antes do PIN.
    if (!authUserId) {
      navigation.navigate('SignUp', { registrationType: selected });
      return;
    }

    // Modo retomada: garante a linha draft em worker_profiles e salta para a etapa 2.
    setSubmitting(true);
    try {
      const { role, subtype } = registrationTypeToWorker(selected);
      const { error } = await supabase
        .from('worker_profiles')
        .upsert({ id: authUserId, role, subtype, status: 'inactive' }, { onConflict: 'id' });
      if (error) {
        showAlert(
          'Não foi possível criar seu perfil',
          error.message ?? 'Tente novamente em instantes.'
        );
        setSubmitting(false);
        return;
      }
      setDriverType(selected);
      if (selected === 'preparador_excursões') {
        navigation.reset({ index: 0, routes: [{ name: 'CompletePreparadorExcursoes' }] });
        return;
      }
      if (selected === 'preparador_encomendas') {
        navigation.reset({ index: 0, routes: [{ name: 'CompletePreparadorEncomendas' }] });
        return;
      }
      navigation.reset({
        index: 0,
        routes: [{ name: 'CompleteDriverRegistration', params: { driverType: selected } }],
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Tente novamente em instantes.';
      showAlert('Não foi possível continuar', msg);
      setSubmitting(false);
    }
  };

  const FOOTER_HEIGHT = 88;
  const footerBottomPadding = Math.max(insets.bottom, 12);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={goBackToWelcome} activeOpacity={0.7}>
          <MaterialIcons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: FOOTER_HEIGHT + footerBottomPadding },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>{authUserId ? 'Finalize seu cadastro' : 'Crie sua conta'}</Text>
        <Text style={styles.subtitle}>
          {authUserId
            ? 'Escolha o tipo de cadastro para continuar de onde você parou.'
            : 'Escolha seu tipo de cadastro para começar.'}
        </Text>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={[styles.iconWrap, styles.iconWrapMotorista]}>
              <MaterialIcons name="directions-car" size={24} color="#6B7280" />
            </View>
            <Text style={styles.sectionTitle}>Motorista</Text>
          </View>
          <Text style={styles.sectionDesc}>Dirija com a Take Me e receba corridas diretamente pelo app.</Text>

          <TouchableOpacity
            style={[styles.optionCard, selected === 'take_me' && styles.optionCardSelected]}
            onPress={() => setSelected('take_me')}
            activeOpacity={0.8}
          >
            <View style={[styles.radio, selected === 'take_me' && styles.radioSelected]}>
              {selected === 'take_me' && <View style={styles.radioInner} />}
            </View>
            <View style={styles.optionTextWrap}>
              <Text style={styles.optionTitle}>Motorista Take Me</Text>
              <Text style={styles.optionDesc}>Motorista vinculado diretamente à Take Me.</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.optionCard, selected === 'parceiro' && styles.optionCardSelected]}
            onPress={() => setSelected('parceiro')}
            activeOpacity={0.8}
          >
            <View style={[styles.radio, selected === 'parceiro' && styles.radioSelected]}>
              {selected === 'parceiro' && <View style={styles.radioInner} />}
            </View>
            <View style={styles.optionTextWrap}>
              <Text style={styles.optionTitle}>Motorista Parceiro</Text>
              <Text style={styles.optionDesc}>Trabalha com frota ou empresa parceira.</Text>
            </View>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={[styles.iconWrap, styles.iconWrapPreparador]}>
              <MaterialIcons name="inventory-2" size={24} color="#92400E" />
            </View>
            <Text style={styles.sectionTitle}>Preparador</Text>
          </View>
          <Text style={styles.sectionDesc}>Gerencie excursões ou entregas vinculadas à plataforma.</Text>

          <TouchableOpacity
            style={[styles.optionCard, selected === 'preparador_excursões' && styles.optionCardSelected]}
            onPress={() => setSelected('preparador_excursões')}
            activeOpacity={0.8}
          >
            <View style={[styles.radio, selected === 'preparador_excursões' && styles.radioSelected]}>
              {selected === 'preparador_excursões' && <View style={styles.radioInner} />}
            </View>
            <View style={styles.optionTextWrap}>
              <Text style={styles.optionTitle}>Preparador de excursões</Text>
              <Text style={styles.optionDesc}>Organiza viagens e excursões vinculadas à Take Me.</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.optionCard, selected === 'preparador_encomendas' && styles.optionCardSelected]}
            onPress={() => setSelected('preparador_encomendas')}
            activeOpacity={0.8}
          >
            <View style={[styles.radio, selected === 'preparador_encomendas' && styles.radioSelected]}>
              {selected === 'preparador_encomendas' && <View style={styles.radioInner} />}
            </View>
            <View style={styles.optionTextWrap}>
              <Text style={styles.optionTitle}>Preparador de encomendas</Text>
              <Text style={styles.optionDesc}>Gerencia coletas e entregas realizadas por motoristas.</Text>
            </View>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: footerBottomPadding }]} pointerEvents="box-none">
        <TouchableOpacity
          style={[styles.nextButton, (!selected || submitting) && styles.nextButtonDisabled]}
          onPress={handleNext}
          disabled={!selected || submitting}
          activeOpacity={0.8}
        >
          {submitting ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.nextButtonText}>{authUserId ? 'Continuar' : 'Próximo'}</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { paddingHorizontal: 20, paddingBottom: 16 },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 24, paddingBottom: 24 },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 24,
    paddingTop: 12,
    backgroundColor: '#FFFFFF',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 8,
  },
  title: { fontSize: 24, fontWeight: '700', color: '#111827', marginBottom: 8 },
  subtitle: { fontSize: 15, color: '#6B7280', marginBottom: 24 },
  section: { marginBottom: 24 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  iconWrap: { width: 40, height: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  iconWrapMotorista: { backgroundColor: '#F3F4F6' },
  iconWrapPreparador: { backgroundColor: '#FEF3C7' },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#111827' },
  sectionDesc: { fontSize: 14, color: '#6B7280', marginBottom: 16 },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  optionCardSelected: { borderColor: '#000000', backgroundColor: '#F3F4F6' },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#9CA3AF', alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  radioSelected: { borderColor: '#000000' },
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#000000' },
  optionTextWrap: { flex: 1 },
  optionTitle: { fontSize: 16, fontWeight: '600', color: '#111827', marginBottom: 2 },
  optionDesc: { fontSize: 13, color: '#6B7280' },
  nextButton: { backgroundColor: '#000000', paddingVertical: 16, borderRadius: 12, alignItems: 'center' },
  nextButtonDisabled: { backgroundColor: '#9CA3AF', opacity: 0.8 },
  nextButtonText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
});
