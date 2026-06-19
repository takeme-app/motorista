import { useState, useCallback } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { Text } from '../../components/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ProfileStackParamList } from '../../navigation/ProfileStackTypes';
import { MaterialIcons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { useAppAlert } from '../../contexts/AppAlertContext';

const BUCKET_DOCS = 'dependent-documents';
const SIGNED_URL_EXPIRY = 3600;

function filenameFromPath(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(i + 1) : path;
}

type Props = NativeStackScreenProps<ProfileStackParamList, 'DependentDetail'>;

const COLORS = {
  background: '#FFFFFF',
  black: '#0d0d0d',
  neutral300: '#f1f1f1',
  neutral700: '#767676',
  danger: '#DC2626',
};

type Dependent = {
  id: string;
  full_name: string;
  contact_phone: string | null;
  age: string | null;
  document_url: string | null;
  representative_document_url: string | null;
  observations: string | null;
  status: string;
};

export function DependentDetailScreen({ navigation, route }: Props) {
  const { dependentId } = route.params;
  const { showAlert } = useAppAlert();
  const [dep, setDep] = useState<Dependent | null>(null);
  const [loading, setLoading] = useState(true);
  const [signedDocUrl, setSignedDocUrl] = useState<string | null>(null);
  const [signedRepUrl, setSignedRepUrl] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const { data, error } = await supabase
          .from('dependents')
          .select('id, full_name, contact_phone, age, document_url, representative_document_url, observations, status')
          .eq('id', dependentId)
          .single();
        setDep(error ? null : data);
        setSignedDocUrl(null);
        setSignedRepUrl(null);
        if (data?.document_url) {
          const { data: signed } = await supabase.storage.from(BUCKET_DOCS).createSignedUrl(data.document_url, SIGNED_URL_EXPIRY);
          if (signed?.signedUrl) setSignedDocUrl(signed.signedUrl);
        }
        if (data?.representative_document_url) {
          const { data: signed } = await supabase.storage.from(BUCKET_DOCS).createSignedUrl(data.representative_document_url, SIGNED_URL_EXPIRY);
          if (signed?.signedUrl) setSignedRepUrl(signed.signedUrl);
        }
        setLoading(false);
      })();
    }, [dependentId])
  );

  const openDoc = (url: string | null) => {
    if (!url) {
      showAlert('Documento indisponível', 'Não foi possível carregar este documento. Tente novamente mais tarde.');
      return;
    }
    Linking.openURL(url).catch(() => showAlert('Erro', 'Não foi possível abrir o documento.'));
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusBar style="dark" />
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={COLORS.black} />
        </View>
      </SafeAreaView>
    );
  }
  if (!dep) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusBar style="dark" />
      <View style={styles.navbar}>
        <TouchableOpacity style={styles.navbarButton} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <MaterialIcons name="arrow-back" size={24} color={COLORS.black} />
        </TouchableOpacity>
        <Text style={styles.navbarTitle} numberOfLines={1}>Dependente</Text>
      </View>
      <Text style={styles.title}>Dependente não encontrado</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="dark" />
      <View style={styles.navbar}>
        <TouchableOpacity style={styles.navbarButton} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <MaterialIcons name="arrow-back" size={24} color={COLORS.black} />
        </TouchableOpacity>
        <Text style={styles.navbarTitle} numberOfLines={1}>Detalhes do dependente</Text>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Text style={[styles.sectionTitle, styles.sectionTitleFirst]}>Dados gerais</Text>
        <View style={styles.row}>
          <MaterialIcons name="person-outline" size={24} color={COLORS.black} />
          <View style={styles.rowText}>
            <Text style={styles.depName}>{dep.full_name}</Text>
            {dep.age ? <Text style={styles.depAge}>{dep.age} anos</Text> : null}
          </View>
        </View>
        {dep.contact_phone ? (
          <View style={styles.row}>
            <MaterialIcons name="phone" size={24} color={COLORS.black} />
            <Text style={styles.phoneText}>
              {dep.contact_phone.replace(/(\d{2})(\d{4,5})(\d{4})/, '($1) $2-$3')}
            </Text>
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>Documentos</Text>
        {dep.document_url ? (
          <TouchableOpacity style={styles.docRow} onPress={() => openDoc(signedDocUrl)} activeOpacity={0.7}>
            <MaterialIcons name="description" size={24} color={COLORS.black} />
            <Text style={styles.docLabel} numberOfLines={1}>{filenameFromPath(dep.document_url)}</Text>
            <MaterialIcons name="open-in-new" size={22} color={COLORS.neutral700} />
          </TouchableOpacity>
        ) : null}
        {dep.representative_document_url ? (
          <TouchableOpacity style={styles.docRow} onPress={() => openDoc(signedRepUrl)} activeOpacity={0.7}>
            <MaterialIcons name="description" size={24} color={COLORS.black} />
            <Text style={styles.docLabel} numberOfLines={1}>{filenameFromPath(dep.representative_document_url)}</Text>
            <MaterialIcons name="open-in-new" size={22} color={COLORS.neutral700} />
          </TouchableOpacity>
        ) : null}
        {!dep.document_url && !dep.representative_document_url ? (
          <Text style={styles.noDocs}>Nenhum documento anexado</Text>
        ) : null}

        <Text style={styles.sectionTitle}>Observações</Text>
        {dep.observations ? (
          <View style={styles.obsRow}>
            <MaterialIcons name="notes" size={24} color={COLORS.black} />
            <Text style={styles.obsText}>{dep.observations}</Text>
          </View>
        ) : (
          <Text style={styles.noObs}>Nenhuma observação</Text>
        )}

        <TouchableOpacity
          style={styles.deleteRow}
          onPress={() => navigation.navigate('DeleteDependent', { dependentId: dep.id })}
          activeOpacity={0.7}
        >
          <MaterialIcons name="delete-outline" size={24} color={COLORS.danger} />
          <Text style={styles.deleteRowText}>Excluir dependente</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  navbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  navbarButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.neutral300,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navbarTitle: { flex: 1, fontSize: 14, fontWeight: '700', color: COLORS.black, textAlign: 'center' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 48 },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.black,
    marginTop: 28,
    marginBottom: 16,
  },
  sectionTitleFirst: { marginTop: 0 },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  rowText: { marginLeft: 14, paddingVertical: 4 },
  depName: { fontSize: 16, fontWeight: '600', color: COLORS.black },
  depAge: { fontSize: 14, color: COLORS.neutral700, marginTop: 8 },
  phoneText: { fontSize: 15, color: COLORS.black, marginLeft: 14 },
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    marginBottom: 4,
  },
  docLabel: { flex: 1, marginLeft: 14, fontSize: 15, color: COLORS.black },
  noDocs: { fontSize: 14, color: COLORS.neutral700, marginBottom: 8, paddingVertical: 8 },
  obsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    marginBottom: 8,
  },
  obsText: { flex: 1, marginLeft: 14, fontSize: 15, color: COLORS.neutral700, lineHeight: 22 },
  noObs: { fontSize: 14, color: COLORS.neutral700, marginBottom: 8, paddingVertical: 8 },
  deleteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 18,
    marginTop: 20,
  },
  deleteRowText: { fontSize: 15, fontWeight: '600', color: COLORS.danger, marginLeft: 14 },
  title: { fontSize: 22, fontWeight: '700', color: COLORS.black, marginHorizontal: 24, marginTop: 16 },
});
