import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { resolveCurrentPlace } from '../lib/location';
import { supabase } from '../lib/supabase';

export type CurrentPlace = {
  latitude: number;
  longitude: number;
  address: string;
};

type CurrentLocationContextValue = {
  currentPlace: CurrentPlace | null;
  refreshLocation: () => Promise<CurrentPlace | null>;
};

const CurrentLocationContext = createContext<CurrentLocationContextValue | null>(null);

export function useCurrentLocation(): CurrentLocationContextValue {
  const ctx = useContext(CurrentLocationContext);
  if (!ctx) {
    throw new Error('useCurrentLocation must be used within CurrentLocationProvider');
  }
  return ctx;
}

type CurrentLocationProviderProps = {
  children: React.ReactNode;
};

export function CurrentLocationProvider({ children }: CurrentLocationProviderProps) {
  const [currentPlace, setCurrentPlace] = useState<CurrentPlace | null>(null);

  const refreshLocation = useCallback(async (): Promise<CurrentPlace | null> => {
    const r = await resolveCurrentPlace();
    if (r.kind === 'place') {
      const place = { latitude: r.latitude, longitude: r.longitude, address: r.address };
      setCurrentPlace(place);
      return place;
    }
    setCurrentPlace(null);
    return null;
  }, []);

  // Só resolve a localização (o que dispara o pedido de permissão do sistema)
  // quando há sessão autenticada. Evita solicitar localização na tela inicial/
  // login, antes de qualquer contexto de uso — motivo comum de rejeição na
  // análise da Apple (App Store Review Guideline 5.1.1).
  useEffect(() => {
    let alive = true;

    const resolve = () => {
      resolveCurrentPlace().then((r) => {
        if (!alive) return;
        if (r.kind === 'place') {
          setCurrentPlace({ latitude: r.latitude, longitude: r.longitude, address: r.address });
        } else {
          setCurrentPlace(null);
        }
      });
    };

    // Sessão já existente ao abrir o app (usuário logado): resolve na largada.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (alive && session?.user) resolve();
    });

    // Ao logar, resolve; ao sair, limpa (e não pede permissão de novo).
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!alive) return;
      if (event === 'SIGNED_IN' && session?.user) {
        resolve();
      } else if (event === 'SIGNED_OUT') {
        setCurrentPlace(null);
      }
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value: CurrentLocationContextValue = {
    currentPlace,
    refreshLocation,
  };

  return (
    <CurrentLocationContext.Provider value={value}>
      {children}
    </CurrentLocationContext.Provider>
  );
}
