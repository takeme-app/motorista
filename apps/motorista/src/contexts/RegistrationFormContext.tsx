import React, { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { DriverType } from '../navigation/types';

export type RouteFormEntry = {
  id: string;
  origin: string;
  destination: string;
  /** Valor mascarado pt-BR (ex.: "50,00") sem prefixo R$. */
  suggestedPrice: string;
  originResolved?: boolean;
  destinationResolved?: boolean;
  /** Preenchidos ao escolher origem/destino nas sugestões (Google). */
  origin_lat?: number | null;
  origin_lng?: number | null;
  destination_lat?: number | null;
  destination_lng?: number | null;
};

export type RegistrationFormData = {
  driverType: DriverType;
  fullName: string;
  cpf: string;
  age: string;
  city: string;
  /** Metadados da cidade (Google Geocoding) para vínculo com bases. */
  cityLocality: string | null;
  cityAdminArea: string | null;
  cityResolvedFromMaps: boolean;
  preferenceArea: string;
  experienceYears: string;
  /**
   * @deprecated Dados bancários foram movidos para o Stripe Connect (Etapa 3).
   * Mantidos como opcionais para preservar tipos antigos; novos fluxos enviam `null`.
   */
  bankCode?: string;
  /** @deprecated ver bankCode. */
  agencyNumber?: string;
  /** @deprecated ver bankCode. */
  accountNumber?: string;
  /**
   * Chave Pix do motorista — OBRIGATÓRIA desde o Pix real: corridas pagas por
   * Pix caem na conta da plataforma e o repasse é feito por fora, para esta
   * chave. (Voltou a ser exigida; ficou deprecada enquanto tudo ia pelo Stripe.)
   */
  pixKey: string;
  ownsVehicle: boolean;
  vehicleYear: string;
  vehicleModel: string;
  licensePlate: string;
  vehiclePhone: string;
  passengerCapacity: string;
  routes: RouteFormEntry[];
  acceptedTerms: boolean;
  acceptedNotifications: boolean;
  willPresentCriminalRecord: boolean;
  cnhFrontUri: string | null;
  cnhBackUri: string | null;
  criminalRecordUri: string | null;
  vehicleDocUri: string | null;
  vehiclePhotosUris: string[];
};

function newRoute(): RouteFormEntry {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    origin: '',
    destination: '',
    suggestedPrice: '',
  };
}

const defaultFormData: RegistrationFormData = {
  driverType: 'take_me',
  fullName: '',
  cpf: '',
  age: '',
  city: '',
  pixKey: '',
  cityLocality: null,
  cityAdminArea: null,
  cityResolvedFromMaps: false,
  preferenceArea: '',
  experienceYears: '',
  ownsVehicle: true,
  vehicleYear: '',
  vehicleModel: '',
  licensePlate: '',
  vehiclePhone: '',
  passengerCapacity: '',
  routes: [newRoute()],
  acceptedTerms: false,
  acceptedNotifications: false,
  willPresentCriminalRecord: false,
  cnhFrontUri: null,
  cnhBackUri: null,
  criminalRecordUri: null,
  vehicleDocUri: null,
  vehiclePhotosUris: [],
};

type ContextValue = {
  formData: RegistrationFormData | null;
  setFormData: (data: RegistrationFormData) => void;
  clearFormData: () => void;
};

const RegistrationFormContext = createContext<ContextValue | null>(null);

export function RegistrationFormProvider({ children }: { children: ReactNode }) {
  const [formData, setFormDataState] = useState<RegistrationFormData | null>(null);
  const setFormData = useCallback((data: RegistrationFormData) => {
    setFormDataState(data);
  }, []);
  const clearFormData = useCallback(() => {
    setFormDataState(null);
  }, []);
  return (
    <RegistrationFormContext.Provider value={{ formData, setFormData, clearFormData }}>
      {children}
    </RegistrationFormContext.Provider>
  );
}

export function useRegistrationForm() {
  const ctx = useContext(RegistrationFormContext);
  if (!ctx) throw new Error('useRegistrationForm must be used within RegistrationFormProvider');
  return ctx;
}

export { defaultFormData, newRoute };
