import { useEffect, useState, type ReactNode } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Linking,
  Alert,
  Platform,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Text } from '../components/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomSafeInset } from '@take-me/shared';
import { StatusBar } from 'expo-status-bar';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList, RegistrationType } from '../navigation/types';
import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useAppAlert } from '../contexts/AppAlertContext';
import { useRegistrationForm, newRoute, type RouteFormEntry } from '../contexts/RegistrationFormContext';
import { formatCpf, onlyDigits, validateCpf } from '../utils/formatCpf';
import { formatPhoneBR } from '../utils/formatPhone';
import { formatCurrencyBRLInput } from '../utils/formatCurrency';
import { GooglePlacesAutocomplete } from '../components/GooglePlacesAutocomplete';
import { GoogleCityAutocomplete } from '../components/GoogleCityAutocomplete';
import { UploadField } from '../components/UploadField';
import type { GoogleGeocodeResult } from '@take-me/shared';
import { getGoogleMapsApiKey } from '../lib/googleMapsConfig';
import { supabase } from '../lib/supabase';

const CRIMINAL_RECORD_URL = 'https://www.gov.br/pf/pt-br/assuntos/atendimento-ao-cidadao/certidoes';

type Props = NativeStackScreenProps<RootStackParamList, 'CompleteDriverRegistration'>;

function FieldBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.fieldBlock}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

export function CompleteDriverRegistrationScreen({ navigation, route }: Props) {
  const { driverType } = route.params;
  const insets = useSafeAreaInsets();
  const bottomInset = useBottomSafeInset();
  const { showAlert } = useAppAlert();
  const { setFormData } = useRegistrationForm();

  // A conta no Auth foi criada na Etapa 1 (VerifyEmail). Aqui só habilitamos o envio
  // quando há sessão ativa — se a sessão caiu (app fechado), o Splash devolve pro Login.
  const [credentialsReady, setCredentialsReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!cancelled) setCredentialsReady(Boolean(data.user?.id));
    })();
    return () => { cancelled = true; };
  }, []);

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

  const isParceiro = driverType !== 'take_me';
  const isExcursoes = driverType === 'preparador_excursões';

  const subtitleLabel: Record<RegistrationType, string> = {
    take_me: 'como motorista TakeMe.',
    parceiro: 'como motorista parceiro.',
    preparador_excursões: 'como preparador de excursões.',
    preparador_encomendas: 'como preparador de encomendas.',
  };
  const [ownsVehicle, setOwnsVehicle] = useState(true);
  const [vehicleYear, setVehicleYear] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');
  const [licensePlate, setLicensePlate] = useState('');
  const [vehiclePhone, setVehiclePhone] = useState('');
  const [passengerCapacity, setPassengerCapacity] = useState('');

  const [cnhFrontUri, setCnhFrontUri] = useState<string | null>(null);
  const [cnhBackUri, setCnhBackUri] = useState<string | null>(null);
  const [criminalRecordUri, setCriminalRecordUri] = useState<string | null>(null);
  const [vehicleDocUri, setVehicleDocUri] = useState<string | null>(null);
  const [vehiclePhotosUris, setVehiclePhotosUris] = useState<string[]>([]);

  const [routes, setRoutes] = useState<RouteFormEntry[]>(() => [newRoute()]);

  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedNotifications, setAcceptedNotifications] = useState(false);

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

  const pickMultipleImages = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      showAlert('Permissão', 'É necessário permitir acesso às fotos.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 0.8,
      base64: true,
    });
    if (!result.canceled && result.assets.length)
      setVehiclePhotosUris((prev) => [...prev, ...result.assets.map((a) => a.base64 ? `data:image/jpeg;base64,${a.base64}` : a.uri)]);
  };

  const updateRoute = (id: string, patch: Partial<RouteFormEntry>) => {
    setRoutes((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const addRouteRow = () => setRoutes((prev) => [...prev, newRoute()]);

  const removeRouteRow = (id: string) => {
    setRoutes((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.id !== id)));
  };

  const validateAndSubmit = () => {
    if (!credentialsReady) {
      showAlert('Atenção', 'Sessão não encontrada. Entre novamente para continuar o cadastro.');
      return;
    }
    if (!fullName.trim()) {
      showAlert('Atenção', 'Preencha o nome completo.');
      return;
    }
    const cpfDigits = onlyDigits(cpf);
    if (cpfDigits.length !== 11 || !validateCpf(cpf)) {
      showAlert('CPF inválido', 'Informe um CPF válido com 11 dígitos.');
      return;
    }
    const ageNum = parseInt(onlyDigits(age), 10);
    if (!ageNum || ageNum < 18 || ageNum > 100) {
      showAlert('Atenção', 'Informe uma idade válida (entre 18 e 100 anos).');
      return;
    }
    if (!city.trim()) {
      showAlert('Atenção', 'Preencha a cidade.');
      return;
    }
    const mapsKey = getGoogleMapsApiKey()?.trim();
    if (mapsKey) {
      if (!cityResolved) {
        showAlert(
          'Atenção',
          'Cidade: toque numa opção da lista de sugestões até aparecer o ícone verde de confirmação ao lado do campo.',
        );
        return;
      }
    } else if (!cityResolved) {
      showAlert(
        'Atenção',
        'Cidade: informe ao menos 2 caracteres no nome ou configure EXPO_PUBLIC_GOOGLE_MAPS_API_KEY para buscar e confirmar na lista.',
      );
      return;
    }
    if (isParceiro) {
      const expNum = parseInt(onlyDigits(experienceYears), 10);
      if (!expNum || expNum < 1 || expNum > 60) {
        showAlert('Atenção', 'Informe os anos de experiência (entre 1 e 60).');
        return;
      }
    }

    const requiresVehicle = !isExcursoes && (isParceiro || ownsVehicle);
    if (requiresVehicle) {
      if (!vehicleYear.trim() || onlyDigits(vehicleYear).length !== 4) {
        showAlert('Atenção', 'Informe o ano do veículo com 4 dígitos.');
        return;
      }
      const y = parseInt(onlyDigits(vehicleYear), 10);
      const current = new Date().getFullYear();
      if (y < 1980 || y > current + 1) {
        showAlert('Atenção', 'Ano do veículo inválido.');
        return;
      }
      if (!vehicleModel.trim()) {
        showAlert('Atenção', 'Preencha o modelo do veículo.');
        return;
      }
      if (!licensePlate.trim()) {
        showAlert('Atenção', 'Preencha a placa do veículo.');
        return;
      }
      const phoneDigits = onlyDigits(vehiclePhone);
      if (phoneDigits.length < 10 || phoneDigits.length > 11) {
        showAlert('Atenção', 'Informe um telefone válido com DDD.');
        return;
      }
      const maxCap = isParceiro ? 50 : 5;
      const cap = parseInt(onlyDigits(passengerCapacity), 10);
      if (!cap || cap < 1 || cap > maxCap) {
        showAlert('Atenção', `Capacidade de passageiros deve ser entre 1 e ${maxCap}.`);
        return;
      }
      if (!vehicleDocUri) {
        showAlert('Atenção', 'Envie o documento do veículo.');
        return;
      }
      if (vehiclePhotosUris.length < 4) {
        showAlert('Atenção', 'Envie ao menos 4 fotos do veículo.');
        return;
      }
    }

    if (!cnhFrontUri) {
      showAlert('Atenção', 'Envie a foto da CNH (frente).');
      return;
    }
    if (!cnhBackUri) {
      showAlert('Atenção', 'Envie a foto da CNH (verso).');
      return;
    }

    if (!mapsKey) {
      showAlert(
        'Atenção',
        'Configure EXPO_PUBLIC_GOOGLE_MAPS_API_KEY para confirmar origem e destino de cada rota na lista (ícone verde). É obrigatório para validar o trajeto no cadastro.',
      );
      return;
    }
    for (let i = 0; i < routes.length; i++) {
      const r = routes[i];
      if (!r.origin.trim() || !r.destination.trim()) {
        showAlert('Atenção', `Preencha origem e destino da rota ${i + 1}.`);
        return;
      }
      if (!r.originResolved || !r.destinationResolved) {
        showAlert(
          'Atenção',
          `Rota ${i + 1}: escolha origem e destino na lista de sugestões até aparecer o ícone verde ao lado de cada campo.`,
        );
        return;
      }
      const cents = onlyDigits(r.suggestedPrice);
      if (!cents || parseInt(cents, 10) === 0) {
        showAlert('Atenção', `Informe o valor sugerido por passageiro na rota ${i + 1}.`);
        return;
      }
    }

    if (!acceptedTerms) {
      showAlert('Atenção', 'Aceite os Termos de Uso e a Política de Privacidade.');
      return;
    }

    setFormData({
      driverType,
      fullName: fullName.trim(),
      cpf: formatCpf(cpfDigits),
      age: onlyDigits(age),
      city: city.trim(),
      cityLocality: cityMeta.locality,
      cityAdminArea: cityMeta.adminArea,
      cityResolvedFromMaps: cityResolved,
      preferenceArea: '',
      experienceYears: isParceiro ? onlyDigits(experienceYears) : '',
      ownsVehicle: requiresVehicle,
      vehicleYear: onlyDigits(vehicleYear),
      vehicleModel: vehicleModel.trim(),
      licensePlate: licensePlate.trim().toUpperCase(),
      vehiclePhone: formatPhoneBR(vehiclePhone),
      passengerCapacity: onlyDigits(passengerCapacity),
      routes: routes.map((r) => ({
        ...r,
        origin: r.origin.trim(),
        destination: r.destination.trim(),
        suggestedPrice: r.suggestedPrice,
      })),
      acceptedTerms,
      acceptedNotifications,
      willPresentCriminalRecord: Boolean(criminalRecordUri),
      cnhFrontUri,
      cnhBackUri,
      criminalRecordUri,
      vehicleDocUri,
      vehiclePhotosUris,
    });
    navigation.navigate('FinalizeRegistration', { driverType });
  };

  const sectionTitle = (title: string) => <Text style={styles.sectionTitle}>{title}</Text>;

  return (
    <KeyboardAvoidingView style={styles.container} behavior="height">
      <StatusBar style="dark" />
      <View style={[styles.navbar, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => {
            if (navigation.canGoBack()) {
              navigation.goBack();
              return;
            }
            // Retomada via reset: não há como voltar no stack. Pede confirmação para sair
            // do cadastro e leva o usuário de volta ao Welcome (deslogado).
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
                      console.warn('[CompleteDriverRegistration] signOut:', err);
                    }
                    navigation.reset({ index: 0, routes: [{ name: 'Welcome' }] });
                  },
                },
              ],
            );
          }}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Voltar"
        >
          <MaterialIcons name="arrow-back" size={22} color="#0D0D0D" />
        </TouchableOpacity>
        <Text style={styles.navbarTitle}>Complete seu cadastro</Text>
        <View style={styles.navbarRight} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomInset + 32 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>Complete seu cadastro</Text>
          <Text style={styles.heroSubtitle}>
            Preencha suas informações para que possamos validar seu perfil {subtitleLabel[driverType]}
          </Text>
        </View>

        {sectionTitle('Dados básicos')}
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
        {isParceiro ? (
          <FieldBlock label="Anos de experiência">
            <TextInput
              style={styles.input}
              placeholder="Ex: 5"
              placeholderTextColor="#767676"
              value={experienceYears}
              onChangeText={(t) => setExperienceYears(onlyDigits(t).slice(0, 2))}
              keyboardType="number-pad"
              maxLength={2}
            />
          </FieldBlock>
        ) : null}

        {!isExcursoes ? sectionTitle('Veículo de transporte') : null}
        {(!isExcursoes && !isParceiro) ? (
          <>
            <Text style={styles.questionLabel}>Possui veículo próprio?</Text>
            <View style={styles.radioRow}>
              <TouchableOpacity
                style={[styles.radioOption, ownsVehicle && styles.radioOptionSelected]}
                onPress={() => setOwnsVehicle(true)}
                activeOpacity={0.7}
              >
                <View style={[styles.radio, ownsVehicle && styles.radioSelected]}>
                  {ownsVehicle ? <View style={styles.radioInner} /> : null}
                </View>
                <Text style={styles.radioLabel}>Sim</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.radioOption, !ownsVehicle && styles.radioOptionSelected]}
                onPress={() => setOwnsVehicle(false)}
                activeOpacity={0.7}
              >
                <View style={[styles.radio, !ownsVehicle && styles.radioSelected]}>
                  {!ownsVehicle ? <View style={styles.radioInner} /> : null}
                </View>
                <Text style={styles.radioLabel}>Não</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : null}
        {(!isExcursoes && (isParceiro || ownsVehicle)) ? (
          <>
            <FieldBlock label="Ano do veículo">
              <TextInput
                style={styles.input}
                placeholder="Ex: 2020"
                placeholderTextColor="#767676"
                value={vehicleYear}
                onChangeText={(t) => setVehicleYear(onlyDigits(t).slice(0, 4))}
                keyboardType="number-pad"
                maxLength={4}
              />
            </FieldBlock>
            <FieldBlock label="Modelo">
              <TextInput
                style={styles.input}
                placeholder="Ex: Honda Civic"
                placeholderTextColor="#767676"
                value={vehicleModel}
                onChangeText={setVehicleModel}
              />
            </FieldBlock>
            <FieldBlock label="Placa">
              <TextInput
                style={styles.input}
                placeholder="Ex: ABC1D23"
                placeholderTextColor="#767676"
                value={licensePlate}
                onChangeText={(t) => setLicensePlate(t.toUpperCase())}
                autoCapitalize="characters"
                maxLength={10}
              />
            </FieldBlock>
            <FieldBlock label="Telefone">
              <TextInput
                style={styles.input}
                placeholder="Ex: (11) 98765-4321"
                placeholderTextColor="#767676"
                value={vehiclePhone}
                onChangeText={(t) => setVehiclePhone(formatPhoneBR(t))}
                keyboardType="phone-pad"
                maxLength={16}
              />
            </FieldBlock>
            <FieldBlock label={isParceiro ? 'Capacidade de passageiros (máx. 50)' : 'Capacidade de passageiros (máx. 5)'}>
              <TextInput
                style={styles.input}
                placeholder={isParceiro ? 'Ex: 15' : 'Ex: 4'}
                placeholderTextColor="#767676"
                value={passengerCapacity}
                onChangeText={(t) => setPassengerCapacity(onlyDigits(t).slice(0, isParceiro ? 2 : 1))}
                keyboardType="number-pad"
                maxLength={isParceiro ? 2 : 1}
              />
            </FieldBlock>
          </>
        ) : null}

        {sectionTitle('Documentos')}

        <UploadField
          label="CNH (frente)"
          title="Upload da frente"
          caption={`Aceitamos RG, CNH ou documento\nde identificação válido com foto.`}
          selected={Boolean(cnhFrontUri)}
          selectedLabel={cnhFrontUri ? 'Frente adicionada' : null}
          onPress={() => pickImage(setCnhFrontUri)}
        />

        <UploadField
          label="CNH (verso)"
          title="Upload do verso"
          caption={`Aceitamos RG, CNH ou documento\nde identificação válido com foto.`}
          selected={Boolean(cnhBackUri)}
          selectedLabel={cnhBackUri ? 'Verso adicionado' : null}
          onPress={() => pickImage(setCnhBackUri)}
        />

        <UploadField
          label="Antecedentes Criminais"
          labelIcon={
            <TouchableOpacity
              onPress={() => Linking.openURL(CRIMINAL_RECORD_URL)}
              hitSlop={8}
              accessibilityRole="link"
              accessibilityLabel="Abrir site da Polícia Federal"
            >
              <MaterialIcons name="info-outline" size={16} color="#0D0D0D" />
            </TouchableOpacity>
          }
          title={`Emitir documento no site\nda Polícia Federal`}
          caption={`O arquivo deve ter sido emitido\nnos últimos 90 dias.`}
          selected={Boolean(criminalRecordUri)}
          selectedLabel={criminalRecordUri ? 'Documento adicionado' : null}
          onPress={() => pickImage(setCriminalRecordUri)}
        />

        {(!isExcursoes && (isParceiro || ownsVehicle)) ? (
          <>
            <UploadField
              label="Documento do veículo"
              title="Clique pra fazer o upload"
              selected={Boolean(vehicleDocUri)}
              selectedLabel={vehicleDocUri ? 'Documento adicionado' : null}
              onPress={() => pickImage(setVehicleDocUri)}
            />
            <UploadField
              label="Fotos do veículo"
              labelHint="Máx. 4 fotos, 20MB"
              title="Clique para fazer upload (múltiplas fotos)"
              selected={vehiclePhotosUris.length > 0}
              selectedLabel={vehiclePhotosUris.length > 0 ? `${vehiclePhotosUris.length} foto(s) adicionadas` : null}
              onPress={pickMultipleImages}
            />
          </>
        ) : null}

        <View style={styles.routesHeader}>
          <Text style={styles.sectionTitle}>Rotas e valores</Text>
          <Text style={styles.routesSubtitle}>Defina suas rotas e preços.</Text>
        </View>
        {routes.map((r, index) => (
          <View key={r.id} style={styles.routeCard}>
            <View style={styles.routeCardHeader}>
              <Text style={styles.routeCardTitle}>Rota {index + 1}</Text>
              {routes.length > 1 ? (
                <TouchableOpacity onPress={() => removeRouteRow(r.id)} activeOpacity={0.7}>
                  <Text style={styles.routeRemove}>Remover</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            <GooglePlacesAutocomplete
              label="Origem"
              placeholder="Ex: São Paulo"
              value={r.origin}
              onChangeText={(t) =>
                updateRoute(r.id, {
                  origin: t,
                  originResolved: false,
                  origin_lat: null,
                  origin_lng: null,
                })
              }
              onSelectPlace={(place: GoogleGeocodeResult) =>
                updateRoute(r.id, {
                  origin: place.placeName,
                  originResolved: true,
                  origin_lat: place.latitude,
                  origin_lng: place.longitude,
                })
              }
              hasResolvedCoords={r.originResolved ?? false}
            />
            <GooglePlacesAutocomplete
              label="Destino"
              placeholder="Ex: Interior"
              value={r.destination}
              onChangeText={(t) =>
                updateRoute(r.id, {
                  destination: t,
                  destinationResolved: false,
                  destination_lat: null,
                  destination_lng: null,
                })
              }
              onSelectPlace={(place: GoogleGeocodeResult) =>
                updateRoute(r.id, {
                  destination: place.placeName,
                  destinationResolved: true,
                  destination_lat: place.latitude,
                  destination_lng: place.longitude,
                })
              }
              hasResolvedCoords={r.destinationResolved ?? false}
            />
            <FieldBlock label="Valor sugerido por pessoa">
              <TextInput
                style={styles.input}
                placeholder="Ex: R$ 50,00"
                placeholderTextColor="#767676"
                value={r.suggestedPrice ? `R$ ${r.suggestedPrice}` : ''}
                onChangeText={(t) => {
                  const cleaned = t.replace(/R\$\s?/i, '');
                  updateRoute(r.id, { suggestedPrice: formatCurrencyBRLInput(cleaned) });
                }}
                keyboardType="number-pad"
              />
            </FieldBlock>
            {index === 0 ? (
              <Text style={styles.helperBelowField}>Informe o valor que deseja receber pelo serviço.</Text>
            ) : null}
          </View>
        ))}
        <TouchableOpacity style={styles.pillButton} onPress={addRouteRow} activeOpacity={0.7}>
          <Text style={styles.pillButtonText}>Adicionar nova rota</Text>
        </TouchableOpacity>

        <View style={styles.checksSection}>
          <View style={styles.checkboxRow}>
            <TouchableOpacity
              onPress={() => setAcceptedTerms((v) => !v)}
              activeOpacity={0.7}
              style={styles.checkboxHitArea}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: acceptedTerms }}
            >
              <View style={[styles.checkbox, acceptedTerms && styles.checkboxChecked]}>
                {acceptedTerms ? <Text style={styles.checkmark}>✓</Text> : null}
              </View>
            </TouchableOpacity>
            <View style={styles.checkboxLabelWrap}>
              <Text style={styles.termsText}>
                Concordo com os{' '}
                <Text style={styles.linkInline} onPress={() => navigation.navigate('TermsOfUse')}>
                  Termos de Uso
                </Text>
                {' '}e a{' '}
                <Text style={styles.linkInline} onPress={() => navigation.navigate('PrivacyPolicy')}>
                  Política de Privacidade
                </Text>
                .
              </Text>
            </View>
          </View>

          <View style={styles.checkboxRow}>
            <TouchableOpacity
              onPress={() => setAcceptedNotifications((v) => !v)}
              activeOpacity={0.7}
              style={styles.checkboxHitArea}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: acceptedNotifications }}
            >
              <View style={[styles.checkbox, acceptedNotifications && styles.checkboxChecked]}>
                {acceptedNotifications ? <Text style={styles.checkmark}>✓</Text> : null}
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.checkboxLabelWrap}
              onPress={() => setAcceptedNotifications((v) => !v)}
              activeOpacity={0.7}
            >
              <Text style={styles.checkLabelStandalone}>
                Aceito receber ofertas e comunicações do Take Me.
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={[styles.footerInScroll, { paddingBottom: bottomInset }]}>
          <TouchableOpacity
            style={[styles.submitBtn, !credentialsReady && styles.submitBtnDisabled]}
            onPress={validateAndSubmit}
            activeOpacity={0.8}
          >
            <Text style={styles.submitBtnText}>Enviar cadastro</Text>
          </TouchableOpacity>
          {!credentialsReady ? (
            <Text style={styles.credentialsHint}>Conclua a verificação do e-mail para habilitar o envio.</Text>
          ) : null}
          <TouchableOpacity onPress={() => navigation.navigate('Login')} style={styles.backToLogin} activeOpacity={0.7}>
            <Text style={styles.backToLoginText}>Voltar para o login</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },

  navbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
    backgroundColor: '#FFFFFF',
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F1F1F1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navbarTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0D0D0D',
    textAlign: 'center',
    flex: 1,
  },
  navbarRight: { width: 40 },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 16 },

  hero: {
    marginBottom: 24,
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: '600',
    color: '#0D0D0D',
    marginBottom: 4,
  },
  heroSubtitle: {
    fontSize: 14,
    color: '#767676',
    lineHeight: 21,
  },

  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#767676',
    marginBottom: 12,
    marginTop: 16,
  },
  routesHeader: {
    marginBottom: 8,
    marginTop: 16,
  },
  routesSubtitle: {
    fontSize: 14,
    color: '#767676',
    marginTop: -4,
    marginBottom: 4,
    lineHeight: 21,
  },

  fieldBlock: { marginBottom: 8 },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0D0D0D',
    marginBottom: 8,
  },
  questionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0D0D0D',
    marginBottom: 8,
    marginTop: 4,
  },
  helperBelowField: {
    fontSize: 12,
    color: '#767676',
    marginTop: -4,
    marginBottom: 8,
    lineHeight: 18,
  },

  input: {
    backgroundColor: '#F1F1F1',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 0,
    height: 44,
    fontSize: 16,
    color: '#0D0D0D',
  },

  radioRow: { flexDirection: 'column', gap: 4, marginBottom: 12 },
  radioOption: { flexDirection: 'row', alignItems: 'center', minHeight: 40 },
  radioOptionSelected: {},
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#767676',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    marginLeft: 10,
  },
  radioSelected: { borderColor: '#0D0D0D' },
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#0D0D0D' },
  radioLabel: { fontSize: 14, fontWeight: '600', color: '#0D0D0D' },

  pillButton: {
    height: 48,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  pillButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0D0D0D',
  },

  routeCard: {
    borderWidth: 1,
    borderColor: '#F1F1F1',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    backgroundColor: '#FFFFFF',
    gap: 4,
  },
  routeCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  routeCardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0D0D0D',
  },
  routeRemove: {
    fontSize: 12,
    color: '#DC2626',
    fontWeight: '600',
  },

  checksSection: { marginTop: 8, marginBottom: 8 },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
    minHeight: 40,
  },
  checkboxHitArea: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxLabelWrap: {
    flex: 1,
    paddingVertical: 11,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#767676',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: '#0D0D0D',
    borderColor: '#0D0D0D',
  },
  checkmark: { fontSize: 12, color: '#FFF', fontWeight: '700' },
  checkLabelStandalone: {
    fontSize: 12,
    fontWeight: '600',
    color: '#767676',
    lineHeight: 18,
  },
  termsText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#767676',
    lineHeight: 18,
  },
  linkInline: {
    color: '#016DF9',
    fontWeight: '600',
    fontSize: 12,
    lineHeight: 18,
  },

  footerInScroll: {
    marginTop: 24,
    gap: 8,
  },
  submitBtn: {
    backgroundColor: '#0D0D0D',
    height: 48,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnDisabled: { opacity: 0.45 },
  submitBtnText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  credentialsHint: {
    fontSize: 12,
    color: '#767676',
    textAlign: 'center',
    marginTop: 4,
  },
  backToLogin: {
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backToLoginText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0D0D0D',
  },
});
