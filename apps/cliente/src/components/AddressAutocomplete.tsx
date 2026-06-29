import { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Text } from './Text';
import { MaterialIcons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import {
  searchAddress,
  retrieveAddressCoords,
  type AddressSuggestion,
  type AddressSearchResult,
} from '../lib/location';
import { useCurrentLocation } from '../contexts/CurrentLocationContext';

function newSessionToken(): string {
  try {
    return Crypto.randomUUID();
  } catch {
    return `takeme-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  }
}

const DEBOUNCE_MS = 400;

const COLORS = {
  black: '#0d0d0d',
  neutral300: '#f1f1f1',
  neutral400: '#e2e2e2',
  neutral700: '#767676',
};

type Props = {
  value: string;
  onChangeText: (text: string) => void;
  onSelectPlace: (place: AddressSuggestion) => void;
  placeholder?: string;
  editable?: boolean;
  autoFocus?: boolean;
  style?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
};

export function AddressAutocomplete({
  value,
  onChangeText,
  onSelectPlace,
  placeholder = 'Digite o endereço...',
  editable = true,
  autoFocus = false,
  style,
  inputStyle,
}: Props) {
  const [suggestions, setSuggestions] = useState<AddressSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [showList, setShowList] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionTokenRef = useRef<string>(newSessionToken());
  const { currentPlace } = useCurrentLocation();

  const fetchSuggestions = useCallback(async (query: string) => {
    if (query.trim().length < 2) {
      setSuggestions([]);
      setShowList(false);
      return;
    }
    setLoading(true);
    try {
      const list = await searchAddress(query, {
        proximity: currentPlace,
        sessionToken: sessionTokenRef.current,
      });
      setSuggestions(list);
      setShowList(list.length > 0);
    } catch {
      setSuggestions([]);
      setShowList(false);
    } finally {
      setLoading(false);
    }
  }, [currentPlace]);

  const handleChangeText = useCallback(
    (text: string) => {
      onChangeText(text);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        fetchSuggestions(text);
        debounceRef.current = null;
      }, DEBOUNCE_MS);
    },
    [onChangeText, fetchSuggestions]
  );

  const handleSelect = useCallback(
    async (item: AddressSearchResult) => {
      onChangeText(item.address);
      setSuggestions([]);
      setShowList(false);

      // Nominatim (fallback) já traz coords; Search Box resolve via /retrieve.
      if (item.latitude != null && item.longitude != null) {
        onSelectPlace({
          address: item.address,
          latitude: item.latitude,
          longitude: item.longitude,
          ...(item.city ? { city: item.city } : {}),
        });
        return;
      }
      if (!item.mapboxId) return;
      setLoading(true);
      try {
        const coords = await retrieveAddressCoords(item.mapboxId, {
          sessionToken: sessionTokenRef.current,
        });
        if (coords) {
          onSelectPlace({
            address: item.address,
            latitude: coords.latitude,
            longitude: coords.longitude,
            ...((item.city ?? coords.city) ? { city: item.city ?? coords.city } : {}),
          });
        }
      } finally {
        setLoading(false);
        // Encerra a sessão de billing; próxima busca usa novo token.
        sessionTokenRef.current = newSessionToken();
      }
    },
    [onChangeText, onSelectPlace]
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <View style={[styles.wrap, showList && styles.wrapActive, style]}>
      <View style={styles.inputRow}>
        <TextInput
          style={[styles.input, inputStyle]}
          value={value}
          onChangeText={handleChangeText}
          placeholder={placeholder}
          placeholderTextColor={COLORS.neutral700}
          editable={editable}
          autoFocus={autoFocus}
          onFocus={() => value.trim().length >= 2 && suggestions.length > 0 && setShowList(true)}
          onBlur={() => setTimeout(() => setShowList(false), 200)}
        />
        {loading && (
          <View style={styles.loaderWrap}>
            <ActivityIndicator size="small" color={COLORS.black} />
          </View>
        )}
      </View>
      {showList && suggestions.length > 0 && (
        <View style={styles.listWrap}>
          <ScrollView
            style={styles.listScroll}
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
            bounces={false}
            showsVerticalScrollIndicator={true}
          >
            {suggestions.slice(0, 15).map((item, index) => (
              <TouchableOpacity
                key={`${index}-${item.id}`}
                style={styles.suggestionRow}
                onPress={() => { void handleSelect(item); }}
                activeOpacity={0.7}
              >
                <MaterialIcons name="place" size={20} color={COLORS.neutral700} />
                <Text style={styles.suggestionText} numberOfLines={2}>{item.address}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative', zIndex: 1 },
  /** Enquanto a lista está aberta, flutua acima dos campos seguintes (evita bleed-through no Android). */
  wrapActive: { zIndex: 1000, elevation: 24 },
  inputRow: { position: 'relative' },
  input: {
    borderWidth: 1,
    borderColor: COLORS.neutral400,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    paddingRight: 44,
    fontSize: 16,
    color: COLORS.black,
  },
  loaderWrap: {
    position: 'absolute',
    right: 12,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  listWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '100%',
    marginTop: 4,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.neutral400,
    maxHeight: 260,
    overflow: 'hidden',
    zIndex: 1000,
    elevation: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
  },
  listScroll: { maxHeight: 256 },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.neutral300,
  },
  suggestionText: { flex: 1, fontSize: 14, color: COLORS.black },
});
