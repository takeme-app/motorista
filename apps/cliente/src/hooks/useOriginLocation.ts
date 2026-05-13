import { useState, useEffect, useCallback } from 'react';
import { useCurrentLocation } from '../contexts/CurrentLocationContext';
import { resolveCurrentPlace, type AddressSuggestion } from '../lib/location';
import { useAppAlert } from '../contexts/AppAlertContext';
import { guessCityFromPtAddress } from '../lib/shipmentOriginCity';

/**
 * Coordenada-placeholder usada SÓ enquanto a localização real não chegou.
 * O `originReady` (false) sinaliza que esse valor é placeholder — o consumidor
 * deve esconder o mapa com um overlay até `originReady` virar true, evitando
 * o flash que partia de Campina Grande/PB e "saltava" para a posição real.
 */
const DEFAULT_COORDS = { latitude: -7.3289, longitude: -35.3328 };

type Options = {
  /** Quando true, extrai originCityTag da origem via guessCityFromPtAddress. */
  extractCity?: boolean;
};

export function useOriginLocation(options: Options = {}) {
  const { extractCity = false } = options;
  const { currentPlace, refreshLocation } = useCurrentLocation();
  const { showAlert } = useAppAlert();

  const [originAddress, setOriginAddress] = useState('Obtendo sua localização...');
  const [originLat, setOriginLat] = useState(DEFAULT_COORDS.latitude);
  const [originLng, setOriginLng] = useState(DEFAULT_COORDS.longitude);
  const [originCityTag, setOriginCityTag] = useState('');
  const [locationLoading, setLocationLoading] = useState(false);
  /**
   * `true` somente após coords reais (do GPS / cache) terem sido aplicadas.
   * Consumidores devem usar isso para decidir se já podem renderizar o mapa.
   */
  const [originReady, setOriginReady] = useState(false);
  /**
   * `true` apenas quando ainda estamos resolvendo a localização inicial
   * (boot do app, sem cache). Permite exibir um chip "Obtendo sua localização".
   * Depois que resolveu uma vez (com sucesso ou falha), fica false.
   */
  const [initialResolving, setInitialResolving] = useState(true);

  const applyPlace = useCallback(
    (address: string, lat: number, lng: number) => {
      setOriginAddress(address);
      setOriginLat(lat);
      setOriginLng(lng);
      setOriginReady(true);
      if (extractCity) setOriginCityTag(guessCityFromPtAddress(address));
    },
    [extractCity],
  );

  useEffect(() => {
    if (currentPlace) {
      applyPlace(currentPlace.address, currentPlace.latitude, currentPlace.longitude);
      setInitialResolving(false);
      return;
    }
    let cancelled = false;
    resolveCurrentPlace().then((r) => {
      if (cancelled) return;
      if (r.kind === 'place') {
        applyPlace(r.address, r.latitude, r.longitude);
      } else if (r.kind === 'permission_denied') {
        setOriginAddress('Permita acesso à localização');
      } else {
        setOriginAddress('GPS indisponível — toque em "Minha localização"');
      }
      setInitialResolving(false);
    });
    return () => {
      cancelled = true;
    };
  }, [currentPlace?.latitude, currentPlace?.longitude, currentPlace?.address, applyPlace]);

  const useMyLocationForOrigin = useCallback(async () => {
    setLocationLoading(true);
    try {
      const place = await refreshLocation();
      if (place) {
        applyPlace(place.address, place.latitude, place.longitude);
      } else {
        showAlert('Localização', 'Não foi possível usar sua localização. Verifique as permissões.');
      }
    } catch {
      showAlert('Localização', 'Não foi possível obter seu endereço. Tente novamente.');
    } finally {
      setLocationLoading(false);
    }
  }, [refreshLocation, showAlert, applyPlace]);

  const setOriginFromAutocomplete = useCallback(
    (place: AddressSuggestion) => {
      applyPlace(place.address, place.latitude, place.longitude);
      if (extractCity && place.city) setOriginCityTag(place.city);
    },
    [applyPlace, extractCity],
  );

  return {
    originAddress,
    originLat,
    originLng,
    originCityTag,
    locationLoading,
    /** Coordenadas reais já aplicadas (não é mais o placeholder de PB). */
    originReady,
    /** Estamos no primeiro fetch (boot do app, sem cache do contexto). */
    initialResolving,
    useMyLocationForOrigin,
    setOriginFromAutocomplete,
  };
}
