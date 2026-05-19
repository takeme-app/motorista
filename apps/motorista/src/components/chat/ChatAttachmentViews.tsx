import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  TouchableOpacity,
  Image,
  StyleSheet,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Text } from '../Text';
import { chatAttachmentSignedUrl } from '../../utils/storageUrl';
import { loadExpoAv } from '../../utils/expoAvOptional';

function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0:00';
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

type SoundLike = {
  playAsync: () => Promise<unknown>;
  pauseAsync: () => Promise<unknown>;
  unloadAsync: () => Promise<unknown>;
  setPositionAsync: (pos: number) => Promise<unknown>;
  getStatusAsync: () => Promise<{ isLoaded?: boolean; isPlaying?: boolean }>;
};

const GOLD = '#C9A227';

type Props = {
  attachmentPath: string;
  isOutgoing: boolean;
  /** Cliente: bolha escura com texto claro; motorista: dourado. */
  outgoingPalette?: 'gold' | 'dark';
};

export function ChatAttachmentImage({ attachmentPath, isOutgoing, outgoingPalette = 'gold' }: Props) {
  const [uri, setUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const darkOut = isOutgoing && outgoingPalette === 'dark';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    chatAttachmentSignedUrl(attachmentPath).then((u) => {
      if (!cancelled) {
        setUri(u);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [attachmentPath]);

  if (loading) {
    return (
      <View style={[styles.mediaBox, isOutgoing && styles.mediaBoxOut]}>
        <ActivityIndicator color={darkOut ? '#FFFFFF' : isOutgoing ? '#111827' : GOLD} />
      </View>
    );
  }
  if (!uri) {
    return (
      <Text style={[styles.fallbackText, isOutgoing && styles.fallbackTextOut, darkOut && styles.fallbackTextDarkOut]}>
        Não foi possível carregar a imagem.
      </Text>
    );
  }
  return (
    <Image source={{ uri }} style={styles.chatImage} resizeMode="cover" />
  );
}

/** Sem expo-av no bundle: abre URL assinada no player do sistema. */
export function ChatAttachmentAudio({ attachmentPath, isOutgoing, outgoingPalette = 'gold' }: Props) {
  const [uri, setUri] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState(false);
  const soundRef = useRef<SoundLike | null>(null);
  const darkOut = isOutgoing && outgoingPalette === 'dark';
  const accent = darkOut ? '#FFFFFF' : isOutgoing ? '#111827' : GOLD;
  const trackBg = darkOut ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.12)';

  useEffect(() => {
    let cancelled = false;
    chatAttachmentSignedUrl(attachmentPath).then((u) => {
      if (!cancelled) setUri(u);
    });
    return () => {
      cancelled = true;
      const s = soundRef.current;
      soundRef.current = null;
      if (s) void s.unloadAsync().catch(() => {});
    };
  }, [attachmentPath]);

  const togglePlay = useCallback(async () => {
    if (!uri || loading) return;
    try {
      const existing = soundRef.current;
      if (existing) {
        const st = await existing.getStatusAsync();
        if (st.isLoaded && st.isPlaying) {
          await existing.pauseAsync();
        } else {
          await existing.playAsync();
        }
        return;
      }
      setLoading(true);
      const av = await loadExpoAv();
      if (!av) {
        await Linking.openURL(uri);
        return;
      }
      const { sound } = await av.Audio.Sound.createAsync(
        { uri },
        { shouldPlay: true },
        (status: unknown) => {
          const s = status as {
            isLoaded?: boolean;
            isPlaying?: boolean;
            positionMillis?: number;
            durationMillis?: number;
            didJustFinish?: boolean;
          };
          if (!s?.isLoaded) return;
          setIsPlaying(Boolean(s.isPlaying));
          if (typeof s.positionMillis === 'number') setPosition(s.positionMillis);
          if (typeof s.durationMillis === 'number' && s.durationMillis > 0) setDuration(s.durationMillis);
          if (s.didJustFinish) {
            void soundRef.current?.setPositionAsync(0).catch(() => {});
            setIsPlaying(false);
          }
        },
      );
      soundRef.current = sound as SoundLike;
    } catch (err) {
      console.warn('[chat-audio-player] falhou', err);
    } finally {
      setLoading(false);
    }
  }, [uri, loading]);

  const progressPct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;
  const timeLabel = duration > 0
    ? formatMs(isPlaying ? duration - position : (position > 0 ? position : duration))
    : (uri ? '—' : '…');
  const iconName = loading ? null : isPlaying ? 'pause' : 'play-arrow';

  return (
    <View style={styles.audioRow}>
      <TouchableOpacity
        onPress={togglePlay}
        disabled={!uri || loading}
        activeOpacity={0.75}
        style={[styles.audioPlayBtn, { borderColor: accent }]}
      >
        {loading ? (
          <ActivityIndicator size="small" color={accent} />
        ) : (
          <MaterialIcons name={iconName as 'play-arrow' | 'pause'} size={22} color={accent} />
        )}
      </TouchableOpacity>
      <View style={[styles.audioProgressTrack, { backgroundColor: trackBg }]}>
        <View style={[styles.audioProgressFill, { width: `${progressPct}%`, backgroundColor: accent }]} />
      </View>
      <Text style={[styles.audioTimeLabel, { color: accent }]}>{timeLabel}</Text>
    </View>
  );
}

export function ChatAttachmentFile({
  attachmentPath,
  contentLabel,
  isOutgoing,
  outgoingPalette = 'gold',
}: Props & { contentLabel: string }) {
  const darkOut = isOutgoing && outgoingPalette === 'dark';
  const open = useCallback(async () => {
    const url = await chatAttachmentSignedUrl(attachmentPath);
    if (url) await Linking.openURL(url);
  }, [attachmentPath]);

  return (
    <TouchableOpacity
      style={[styles.fileRow, isOutgoing && styles.fileRowOut]}
      onPress={open}
      activeOpacity={0.8}
    >
      <MaterialIcons
        name="insert-drive-file"
        size={28}
        color={darkOut ? '#FFFFFF' : isOutgoing ? '#111827' : '#374151'}
      />
      <Text style={[styles.fileLabel, isOutgoing && styles.fileLabelOut, darkOut && styles.fileLabelDarkOut]} numberOfLines={2}>
        {contentLabel}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  mediaBox: {
    minWidth: 160,
    minHeight: 100,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  mediaBoxOut: { backgroundColor: 'rgba(0,0,0,0.08)' },
  chatImage: {
    width: 220,
    maxWidth: '100%',
    height: 200,
    borderRadius: 12,
    backgroundColor: '#E5E7EB',
  },
  fallbackText: { fontSize: 14, color: '#6B7280' },
  fallbackTextOut: { color: 'rgba(0,0,0,0.65)' },
  fallbackTextDarkOut: { color: 'rgba(255,255,255,0.85)' },
  audioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
    minWidth: 200,
  },
  audioRowOut: {},
  audioLabel: { fontSize: 15, fontWeight: '600', color: '#374151' },
  audioLabelOut: { color: '#111827' },
  audioLabelDarkOut: { color: '#FFFFFF' },
  audioPlayBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  audioProgressTrack: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  audioProgressFill: {
    height: '100%',
  },
  audioTimeLabel: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    minWidth: 36,
    textAlign: 'right',
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    maxWidth: 220,
    paddingVertical: 4,
  },
  fileRowOut: {},
  fileLabel: { fontSize: 14, color: '#374151', flex: 1 },
  fileLabelOut: { color: '#111827' },
  fileLabelDarkOut: { color: '#FFFFFF' },
});
