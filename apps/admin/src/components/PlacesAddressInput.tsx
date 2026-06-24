import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getGoogleMapsApiKey } from '../lib/expoExtra';
import { supabase } from '../lib/supabase';

export type PlaceAddressComponent = { longName: string; shortName: string; types: string[] };

export type PlaceResolved = {
  formattedAddress: string;
  lat: number;
  lng: number;
  placeId: string;
  addressComponents?: PlaceAddressComponent[];
};

export interface PlacesAddressInputProps {
  value: string;
  onChange: (v: string) => void;
  /** Chamado ao escolher uma sugestão (endereço oficial + coordenadas). */
  onPlaceResolved: (p: PlaceResolved) => void;
  inputStyle: React.CSSProperties;
  placeholder?: string;
  /** Quando true, exibe o endereço sem busca nem edição (viagem encerrada no painel). */
  readOnly?: boolean;
  /**
   * Só aceita endereço escolhido na lista do Places (não mantém texto livre ao sair do campo).
   * `committedFormattedAddress` deve refletir o último endereço confirmado pelo Places (ou vazio).
   */
  requireSelectionFromPlaces?: boolean;
  committedFormattedAddress?: string;
}

let scriptPromise: Promise<void> | null = null;

function loadGooglePlacesScript(): Promise<void> {
  const key = getGoogleMapsApiKey();
  if (!key) return Promise.reject(new Error('Google Maps API key ausente'));
  if (typeof window === 'undefined') return Promise.resolve();
  const w = window as Window & { google?: { maps?: { places?: unknown } } };
  if (w.google?.maps?.places) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    if (document.querySelector('script[data-takeme-admin-google-places]')) {
      const t0 = Date.now();
      const iv = setInterval(() => {
        const ww = window as Window & { google?: { maps?: { places?: unknown } } };
        if (ww.google?.maps?.places) {
          clearInterval(iv);
          resolve();
        } else if (Date.now() - t0 > 12000) {
          clearInterval(iv);
          reject(new Error('timeout Google Maps'));
        }
      }, 40);
      return;
    }
    const s = document.createElement('script');
    s.setAttribute('data-takeme-admin-google-places', '1');
    s.async = true;
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places&loading=async`;
    s.onload = () => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        const ww = window as Window & { google?: { maps?: { places?: unknown } } };
        if (ww.google?.maps?.places) {
          clearInterval(iv);
          resolve();
        } else if (Date.now() - t0 > 12000) {
          clearInterval(iv);
          reject(new Error('timeout Google Places'));
        }
      }, 40);
    };
    s.onerror = () => reject(new Error('Falha ao carregar Google Maps'));
    document.head.appendChild(s);
  });

  return scriptPromise;
}

/**
 * Campo de endereço com sugestões Google Places (ou input simples se não houver chave).
 */
function mapAddressComponents(raw: Array<{ long_name?: string; short_name?: string; types?: string[] }> | undefined): PlaceAddressComponent[] | undefined {
  if (!raw?.length) return undefined;
  return raw.map((c) => ({
    longName: c.long_name ?? '',
    shortName: c.short_name ?? '',
    types: Array.isArray(c.types) ? c.types : [],
  }));
}

export default function PlacesAddressInput(props: PlacesAddressInputProps) {
  const {
    value,
    onChange,
    onPlaceResolved,
    inputStyle,
    placeholder,
    readOnly,
    requireSelectionFromPlaces,
    committedFormattedAddress = '',
  } = props;
  const [open, setOpen] = useState(false);
  const [preds, setPreds] = useState<Array<{ description: string; place_id: string }>>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sessionTokenRef = useRef<any>(null);
  // Cache dos pontos nomeados (custom_places) para resolver coords ao escolher.
  const customCacheRef = useRef<Record<string, { name: string; lat: number; lng: number }>>({});

  const hasKey = Boolean(getGoogleMapsApiKey());

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  /** Pontos nomeados globais (custom_places) que casam com o texto — aparecem no topo. */
  const fetchCustomPreds = useCallback(async (q: string): Promise<Array<{ description: string; place_id: string }>> => {
    try {
      const { data } = await (supabase as unknown as { from: (t: string) => any })
        .from('custom_places')
        .select('id, name, city, latitude, longitude')
        .eq('is_active', true)
        .ilike('name', `%${q}%`)
        .limit(6);
      if (!Array.isArray(data)) return [];
      const out: Array<{ description: string; place_id: string }> = [];
      for (const p of data as any[]) {
        const lat = Number(p.latitude);
        const lng = Number(p.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        const key = `custom:${p.id}`;
        customCacheRef.current[key] = { name: String(p.name ?? ''), lat, lng };
        out.push({ description: p.city ? `${p.name} — ${p.city}` : String(p.name ?? ''), place_id: key });
      }
      return out;
    } catch {
      return [];
    }
  }, []);

  const runPredictions = useCallback((input: string) => {
    if (!hasKey || input.trim().length < 3) {
      setPreds([]);
      return;
    }
    const q = input.trim();
    void fetchCustomPreds(q).then((customPreds) => {
      loadGooglePlacesScript()
        .then(() => {
          const g = (window as any).google;
          if (!g?.maps?.places) {
            if (customPreds.length) { setPreds(customPreds); setOpen(true); }
            return;
          }
          if (!sessionTokenRef.current) {
            sessionTokenRef.current = new g.maps.places.AutocompleteSessionToken();
          }
          const svc = new g.maps.places.AutocompleteService();
          svc.getPlacePredictions(
            {
              input: q,
              componentRestrictions: { country: 'br' },
              sessionToken: sessionTokenRef.current,
            },
            (list: Array<{ description: string; place_id: string }> | null, status: string) => {
              const googlePreds = (status === g.maps.places.PlacesServiceStatus.OK && list?.length)
                ? list.map((p) => ({ description: p.description, place_id: p.place_id }))
                : [];
              const merged = [...customPreds, ...googlePreds];
              setPreds(merged);
              if (merged.length) setOpen(true);
            },
          );
        })
        .catch(() => {
          if (customPreds.length) { setPreds(customPreds); setOpen(true); }
          else setLoadErr('Não foi possível carregar o Google Places.');
        });
    });
  }, [hasKey, fetchCustomPreds]);

  const onInputChange = useCallback((v: string) => {
    onChange(v);
    setLoadErr(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runPredictions(v), 320);
  }, [onChange, runPredictions]);

  const pickPrediction = useCallback((placeId: string, description: string) => {
    // Ponto nomeado (custom_places): coords já em cache; não chama o Google.
    if (placeId.startsWith('custom:')) {
      const c = customCacheRef.current[placeId];
      if (c) {
        onChange(c.name);
        onPlaceResolved({ formattedAddress: c.name, lat: c.lat, lng: c.lng, placeId });
      }
      setOpen(false);
      setPreds([]);
      return;
    }
    const g = (window as any).google;
    if (!g?.maps?.places) return;
    const div = document.createElement('div');
    const svc = new g.maps.places.PlacesService(div);
    svc.getDetails(
      {
        placeId,
        fields: ['geometry', 'formatted_address', 'place_id', 'address_components'],
        sessionToken: sessionTokenRef.current,
      },
      (
        place: {
          place_id?: string;
          geometry?: { location?: { lat(): number; lng(): number } };
          formatted_address?: string;
          address_components?: Array<{ long_name?: string; short_name?: string; types?: string[] }>;
        } | null,
        status: string,
      ) => {
        sessionTokenRef.current = new g.maps.places.AutocompleteSessionToken();
        if (status !== g.maps.places.PlacesServiceStatus.OK || !place?.geometry?.location) return;
        const lat = place.geometry.location.lat();
        const lng = place.geometry.location.lng();
        const addr = place.formatted_address || description;
        const pid = place.place_id || placeId;
        onChange(addr);
        onPlaceResolved({
          formattedAddress: addr,
          lat,
          lng,
          placeId: pid,
          addressComponents: mapAddressComponents(place.address_components),
        });
        setOpen(false);
        setPreds([]);
      },
    );
  }, [onChange, onPlaceResolved]);

  const enforceCommittedOnBlur = useCallback(() => {
    if (!requireSelectionFromPlaces) return;
    const committed = committedFormattedAddress ?? '';
    if (value !== committed) onChange(committed);
  }, [requireSelectionFromPlaces, committedFormattedAddress, value, onChange]);

  const readOnlyStyle: React.CSSProperties = readOnly
    ? { ...inputStyle, opacity: 0.92, cursor: 'default' }
    : inputStyle;

  if (readOnly) {
    return React.createElement('input', {
      type: 'text',
      value,
      readOnly: true,
      title: 'Esta viagem não pode ser editada',
      placeholder: placeholder || '',
      style: readOnlyStyle,
    });
  }

  if (!hasKey) {
    if (requireSelectionFromPlaces) {
      return React.createElement('div', { style: { width: '100%' } },
        React.createElement('input', {
          type: 'text',
          value: '',
          readOnly: true,
          disabled: true,
          placeholder: placeholder || 'Buscar endereço…',
          style: { ...inputStyle, opacity: 0.75, cursor: 'not-allowed' },
        }),
        React.createElement('div', {
          style: { fontSize: 12, color: '#b53838', marginTop: 4, fontFamily: 'Inter, sans-serif' },
        }, 'Configure EXPO_PUBLIC_GOOGLE_MAPS_API_KEY (Places) para selecionar endereços.'));
    }
    return React.createElement('input', {
      type: 'text',
      value,
      placeholder: placeholder || 'Endereço (configure EXPO_PUBLIC_GOOGLE_MAPS_API_KEY para sugestões)',
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value),
      style: inputStyle,
    });
  }

  return React.createElement('div', { ref: wrapRef, style: { position: 'relative' as const, width: '100%' } },
    React.createElement('input', {
      type: 'text',
      value,
      placeholder: placeholder || 'Buscar endereço…',
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => onInputChange(e.target.value),
      onFocus: () => { if (preds.length) setOpen(true); },
      onBlur: () => { enforceCommittedOnBlur(); },
      style: inputStyle,
      autoComplete: 'off',
    }),
    loadErr
      ? React.createElement('div', { style: { fontSize: 12, color: '#b53838', marginTop: 4, fontFamily: 'Inter, sans-serif' } }, loadErr)
      : null,
    open && preds.length > 0
      ? React.createElement('div', {
          style: {
            position: 'absolute' as const,
            left: 0,
            right: 0,
            top: '100%',
            marginTop: 4,
            maxHeight: 220,
            overflowY: 'auto' as const,
            background: '#fff',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            border: '1px solid #e2e2e2',
            zIndex: 50,
          },
        },
          ...preds.map((p) =>
            React.createElement('button', {
              key: p.place_id,
              type: 'button',
              onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
              onClick: () => pickPrediction(p.place_id, p.description),
              style: {
                display: 'block',
                width: '100%',
                textAlign: 'left' as const,
                padding: '10px 14px',
                border: 'none',
                borderBottom: '1px solid #f1f1f1',
                background: '#fff',
                cursor: 'pointer',
                fontSize: 14,
                color: '#0d0d0d',
                fontFamily: 'Inter, sans-serif',
              },
            }, p.description)))
      : null,
  );
}
