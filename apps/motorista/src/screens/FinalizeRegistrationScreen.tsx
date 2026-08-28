import { useState, useEffect } from 'react';
import { View, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Text } from '../components/Text';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useRegistrationForm } from '../contexts/RegistrationFormContext';
import { getUserErrorMessage } from '../utils/errorMessage';
import { supabase } from '../lib/supabase';
import { finalizeMotoristaProfile, mapDriverTypeToSubtypeDb } from '../lib/motoristaRegistration';
import { onlyDigits } from '../utils/formatCpf';
import { parseCurrencyBRLToNumber } from '../utils/formatCurrency';
import { useDeferredDriverSignup } from '../contexts/DeferredDriverSignupContext';

const BUCKET = 'driver-documents';

function formatSupabaseErr(e: { message?: string; details?: string; hint?: string }): string {
  return [e.message, e.details, e.hint].filter(Boolean).join(' — ');
}

async function uploadImage(_userId: string, uri: string, path: string): Promise<string> {
  const base64 = uri.startsWith('data:') ? uri.split(',')[1] ?? '' : null;
  if (!base64) throw new Error('Documento inválido. Selecione a imagem novamente.');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const { data, error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
    contentType: 'image/jpeg',
    upsert: true,
  });
  if (error) {
    throw new Error(
      formatSupabaseErr(error as { message?: string }) ||
        'Falha ao enviar documento. Confira o bucket driver-documents e as políticas de storage.'
    );
  }
  return data.path;
}

type Props = NativeStackScreenProps<RootStackParamList, 'FinalizeRegistration'>;

export function FinalizeRegistrationScreen({ navigation, route }: Props) {
  const { driverType } = route.params;
  const { clearDeferred } = useDeferredDriverSignup();
  const { formData, clearFormData } = useRegistrationForm();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!formData) {
      setError('Dados do cadastro não encontrados. Volte e preencha o formulário "Complete seu perfil".');
      setLoading(false);
      return;
    }

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: userData, error: userErr } = await supabase.auth.getUser();
        if (userErr || !userData.user?.id) {
          throw new Error(
            'Sessão não encontrada. Entre novamente com seu e-mail e senha para finalizar o cadastro.'
          );
        }
        const userId = userData.user.id;

        const owns = formData.ownsVehicle;
        const ageNum = formData.age ? parseInt(formData.age, 10) : null;
        const phoneDigits = onlyDigits(formData.vehiclePhone);

        const routes = formData.routes.map((r) => {
          const reais = parseCurrencyBRLToNumber(r.suggestedPrice) ?? 0;
          return {
            origin_address: r.origin.trim(),
            destination_address: r.destination.trim(),
            price_per_person_cents: Math.max(0, Math.round(reais * 100)),
            origin_lat: r.origin_lat ?? undefined,
            origin_lng: r.origin_lng ?? undefined,
            destination_lat: r.destination_lat ?? undefined,
            destination_lng: r.destination_lng ?? undefined,
          };
        });

        const validRoutes = routes.filter(
          (r) =>
            r.origin_address.length > 0 &&
            r.destination_address.length > 0 &&
            r.price_per_person_cents > 0
        );
        // Preparador de excursões não manda rotas — motoristas sim.
        const requiresRoutes = driverType === 'take_me' || driverType === 'parceiro';
        if (requiresRoutes && validRoutes.length === 0) {
          throw new Error(
            'Informe ao menos uma rota com origem, destino e valor por passageiro maior que zero.'
          );
        }

        const cpfDigits = onlyDigits(formData.cpf) || '';
        if (!cpfDigits) {
          throw new Error('CPF é obrigatório.');
        }

        const vehicle = owns
          ? {
              year: parseInt(formData.vehicleYear, 10),
              model: formData.vehicleModel.trim(),
              plate: formData.licensePlate.trim().toUpperCase(),
              passenger_capacity: parseInt(formData.passengerCapacity, 10),
            }
          : null;

        if (owns) {
          if (
            !vehicle ||
            !Number.isFinite(vehicle.year) ||
            !vehicle.model ||
            !vehicle.plate ||
            !Number.isFinite(vehicle.passenger_capacity) ||
            vehicle.passenger_capacity < 1
          ) {
            throw new Error('Dados do veículo incompletos (ano, modelo, placa e capacidade).');
          }
        }

        await finalizeMotoristaProfile({
          userId,
          driverType,
          fullName: formData.fullName.trim(),
          phoneDigits: phoneDigits || null,
          cpfDigits,
          age: ageNum,
          city: formData.city.trim() || null,
          cityLocality: formData.cityLocality ?? null,
          cityAdminArea: formData.cityAdminArea ?? null,
          preferenceArea: formData.preferenceArea.trim() || null,
          experienceYears: formData.experienceYears ? parseInt(formData.experienceYears, 10) : null,
          ownsVehicle: owns,
          vehicle,
          routes: validRoutes,
        });

        const uploads: Promise<string>[] = [];
        if (formData.cnhFrontUri) uploads.push(uploadImage(userId, formData.cnhFrontUri, `${userId}/cnh_front.jpg`));
        if (formData.cnhBackUri) uploads.push(uploadImage(userId, formData.cnhBackUri, `${userId}/cnh_back.jpg`));
        if (formData.criminalRecordUri)
          uploads.push(uploadImage(userId, formData.criminalRecordUri, `${userId}/criminal_record.jpg`));
        if (owns && formData.vehicleDocUri)
          uploads.push(uploadImage(userId, formData.vehicleDocUri, `${userId}/vehicle_doc.jpg`));
        if (owns) {
          formData.vehiclePhotosUris.forEach((uri, i) =>
            uploads.push(uploadImage(userId, uri, `${userId}/vehicle_${i}.jpg`))
          );
        }

        let uploadedPaths: string[] = [];
        try {
          uploadedPaths = await Promise.all(uploads);
        } catch (uploadErr) {
          const msg = uploadErr instanceof Error ? uploadErr.message : String(uploadErr);
          throw new Error(
            `Falha ao enviar documentos para o storage (bucket driver-documents).\n\n${msg}\n\nSe aparecer "row-level security", rode a migration 20250325000000_finalize_registration_rls no Supabase ou confira as políticas do bucket.`
          );
        }
        let i = 0;
        const nextPath = () => (i < uploadedPaths.length ? uploadedPaths[i++] : null);

        const cnhFrontPath = formData.cnhFrontUri ? nextPath() : null;
        const cnhBackPath = formData.cnhBackUri ? nextPath() : null;
        const criminalPath = formData.criminalRecordUri ? nextPath() : null;
        const vehicleDocPath = owns && formData.vehicleDocUri ? nextPath() : null;
        const vehiclePhotoPaths = owns
          ? (formData.vehiclePhotosUris.map(() => nextPath()).filter(Boolean) as string[])
          : [];

        const workerUpdate: Record<string, unknown> = {
          cnh_document_url: cnhFrontPath,
          cnh_document_back_url: cnhBackPath,
          background_check_url: criminalPath,
        };
        // Chave Pix: destino do repasse das corridas pagas por Pix (a plataforma
        // recebe e repassa por fora — não há split como no cartão).
        if (formData.pixKey?.trim()) workerUpdate.pix_key = formData.pixKey.trim();

        const { error: workerUpErr } = await supabase
          .from('worker_profiles')
          .update(workerUpdate as never)
          .eq('id', userId);
        if (workerUpErr) {
          throw new Error(
            `Não foi possível salvar os caminhos dos documentos no perfil.\n\n${formatSupabaseErr(workerUpErr as { message?: string; details?: string; hint?: string })}`
          );
        }

        if (owns) {
          const { data: vehRow, error: vehSelErr } = await supabase
            .from('vehicles')
            .select('id')
            .eq('worker_id', userId)
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle();
          if (vehSelErr) {
            throw new Error(formatSupabaseErr(vehSelErr as { message?: string; details?: string }) || 'Erro ao buscar veículo.');
          }
          if (vehRow?.id) {
            const { error: vehUpErr } = await supabase
              .from('vehicles')
              .update({
                vehicle_document_url: vehicleDocPath,
                vehicle_photos_urls: vehiclePhotoPaths.length ? vehiclePhotoPaths : null,
              } as never)
              .eq('id', vehRow.id);
            if (vehUpErr) {
              throw new Error(
                formatSupabaseErr(vehUpErr as { message?: string; details?: string }) ||
                  'Erro ao salvar documentos do veículo.'
              );
            }
          }
        }

        if (cancelled) return;
        clearFormData();
        clearDeferred();
        const subtype = mapDriverTypeToSubtypeDb(driverType);
        navigation.reset({
          index: 0,
          routes: [{ name: 'StripeConnectSetup', params: { subtype } }],
        });
      } catch (err: unknown) {
        if (!cancelled) {
          const explicit =
            err instanceof Error && err.message.trim().length > 0 ? err.message.trim() : null;
          setError(
            explicit ?? getUserErrorMessage(err, 'Não foi possível finalizar o cadastro. Tente novamente.')
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [formData, driverType, clearDeferred, clearFormData, navigation]);

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.button} onPress={() => navigation.goBack()} activeOpacity={0.8}>
          <Text style={styles.buttonText}>Voltar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0D0D0D" />
        <Text style={styles.loadingText}>Salvando seu perfil...</Text>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#FFF',
  },
  loadingText: { marginTop: 16, fontSize: 16, color: '#6B7280' },
  errorText: { fontSize: 16, color: '#374151', textAlign: 'center', marginBottom: 24 },
  button: { backgroundColor: '#0D0D0D', paddingVertical: 14, paddingHorizontal: 24, borderRadius: 12 },
  buttonText: { fontSize: 16, fontWeight: '600', color: '#FFF' },
});
