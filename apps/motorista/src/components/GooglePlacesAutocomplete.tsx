import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { Text } from './Text';
import * as Crypto from 'expo-crypto';
import {
  mapboxSearchBoxSuggest,
  mapboxSearchBoxRetrieve,
  type MapboxGeocodeResult,
  type MapboxSuggestItem,
} from '@take-me/shared';
import { getMapboxAccessToken } from '../lib/googleMapsConfig';
import { MaterialIcons } from '@expo/vector-icons';

const DEBOUNCE_MS = 380;

function newSessionToken(): string {
  try {
    return Crypto.randomUUID();
  } catch {
    return `takeme-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  }
}

type Props = {
  label: string;
  placeholder: string;
  value: string;
  onChangeText: (text: string) => void;
  onSelectPlace: (place: MapboxGeocodeResult) => void;
  hasResolvedCoords: boolean;
};

/** Autocomplete de endereço via Mapbox Search Box (POIs: Shopping, Hospital...). */
export function GooglePlacesAutocomplete({
  label,
  placeholder,
  value,
  onChangeText,
  onSelectPlace,
  hasResolvedCoords,
}: Props) {
  const [suggestions, setSuggestions] = useState<MapboxSuggestItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionTokenRef = useRef<string>(newSessionToken());

  const apiKey = getMapboxAccessToken();

  const runSuggest = useCallback(
    async (q: string) => {
      if (!apiKey || q.trim().length < 2) {
        setSuggestions([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      const list = await mapboxSearchBoxSuggest(q, apiKey, {
        sessionToken: sessionTokenRef.current,
      });
      setSuggestions(list);
      setLoading(false);
    },
    [apiKey],
  );

  useEffect(() => {
    if (hasResolvedCoords) {
      if (timerRef.current) clearTimeout(timerRef.current);
      setSuggestions([]);
      setOpen(false);
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    if (value.trim().length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    timerRef.current = setTimeout(() => {
      void runSuggest(value);
      setOpen(true);
    }, DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [value, runSuggest, hasResolvedCoords]);

  const handlePick = async (item: MapboxSuggestItem) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setSuggestions([]);
    setOpen(false);
    // Search Box não traz coords na lista; resolve via /retrieve antes de avisar o pai.
    setLoading(true);
    try {
      const coords = await mapboxSearchBoxRetrieve(item.mapboxId, apiKey, {
        sessionToken: sessionTokenRef.current,
      });
      if (coords) {
        /** Só o pai define texto + resolved; evita onChangeText resetar antes do select. */
        onSelectPlace({
          latitude: coords.latitude,
          longitude: coords.longitude,
          placeName: item.address,
        });
      }
    } finally {
      setLoading(false);
      // Encerra a sessão de billing; próxima busca usa novo token.
      sessionTokenRef.current = newSessionToken();
    }
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.inputRow}>
        <TextInput
          style={[styles.input, styles.inputFlex]}
          placeholder={placeholder}
          placeholderTextColor="#9CA3AF"
          value={value}
          onChangeText={(t) => {
            onChangeText(t);
            if (!hasResolvedCoords && t.trim().length >= 2) setOpen(true);
          }}
          onFocus={() => {
            if (!hasResolvedCoords && value.trim().length >= 2) setOpen(true);
          }}
        />
        {hasResolvedCoords ? (
          <View style={styles.checkWrap} accessibilityLabel="Endereço confirmado no mapa">
            <MaterialIcons name="check-circle" size={22} color="#059669" />
          </View>
        ) : null}
      </View>
      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color="#111827" />
          <Text style={styles.loadingText}>Buscando endereços…</Text>
        </View>
      ) : null}
      {open && suggestions.length > 0 ? (
        <ScrollView
          style={styles.list}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
        >
          {suggestions.map((item, index) => (
            <TouchableOpacity
              key={`${item.mapboxId}-${index}`}
              style={styles.suggestionRow}
              onPress={() => { void handlePick(item); }}
              activeOpacity={0.7}
            >
              <MaterialIcons name="place" size={18} color="#6B7280" style={styles.suggestionIcon} />
              <Text style={styles.suggestionText} numberOfLines={3}>
                {item.address}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      ) : null}
      {!apiKey ? (
        <Text style={styles.warn}>Configure EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN para buscar endereços.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 4 },
  fieldLabel: { fontSize: 14, fontWeight: '600', color: '#111827', marginTop: 16, marginBottom: 8 },
  inputRow: { flexDirection: 'row', alignItems: 'center' },
  input: {
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    color: '#111827',
  },
  inputFlex: { flex: 1 },
  checkWrap: { marginLeft: 8, width: 28, alignItems: 'center' },
  loadingRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  loadingText: { fontSize: 13, color: '#6B7280', marginLeft: 8 },
  list: {
    maxHeight: 200,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    backgroundColor: '#FAFAFA',
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  suggestionIcon: { marginTop: 2, marginRight: 8 },
  suggestionText: { flex: 1, fontSize: 14, color: '#111827', lineHeight: 20 },
  warn: { fontSize: 12, color: '#B45309', marginTop: 6 },
});
