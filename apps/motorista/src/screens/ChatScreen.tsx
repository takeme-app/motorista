import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  FlatList,
  Platform,
  ActivityIndicator,
  Image,
  Alert,
} from 'react-native';
import { Text } from '../components/Text';
import { MaterialIcons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useBottomSafeInset } from '@take-me/shared';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import type {
  ProfileStackParamList,
  ChatExcStackParamList,
  ChatEncomendasStackParamList,
  RootStackParamList,
} from '../navigation/types';
import { supabase } from '../lib/supabase';
import { storageUrl } from '../utils/storageUrl';
import { uploadChatLocalFile } from '../utils/chatAttachments';
import { fetchChatMessages, insertChatMessage } from '../utils/chatMessagesDb';
import { useAppAlert } from '../contexts/AppAlertContext';
import { getUserErrorMessage } from '../utils/errorMessage';
import { loadExpoAv } from '../utils/expoAvOptional';
import {
  ChatAttachmentImage,
  ChatAttachmentAudio,
  ChatAttachmentFile,
} from '../components/chat/ChatAttachmentViews';

const sb = supabase as { from: (table: string) => any };

type Props =
  | NativeStackScreenProps<ProfileStackParamList, 'Chat'>
  | NativeStackScreenProps<ChatExcStackParamList, 'ChatExcThread'>
  | NativeStackScreenProps<ChatEncomendasStackParamList, 'ChatEncThread'>
  | NativeStackScreenProps<RootStackParamList, 'DriverClientChat'>;

const GOLD = '#C9A227';

const COLORS = {
  background: '#FFFFFF',
  black: '#0d0d0d',
  neutral100: '#F3F4F6',
  neutral300: '#f1f1f1',
  neutral700: '#767676',
  bubbleOut: GOLD,
  bubbleIn: '#F3F4F6',
};

type Message = {
  id: string;
  sender_id: string;
  content: string;
  created_at: string;
  read_at: string | null;
  message_kind?: string;
  attachment_path?: string | null;
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatDateLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Evita enviar HEIC/PNG como image/jpeg (iOS costuma usar HEIC na câmera). */
function mimeAndExtFromImageAsset(asset: ImagePicker.ImagePickerAsset): { mime: string; ext: string } {
  const mime = (asset.mimeType ?? '').toLowerCase() || 'image/jpeg';
  if (mime.includes('png')) return { mime: 'image/png', ext: 'png' };
  if (mime.includes('webp')) return { mime: 'image/webp', ext: 'webp' };
  if (mime.includes('heic')) return { mime: 'image/heic', ext: 'heic' };
  if (mime.includes('heif')) return { mime: 'image/heif', ext: 'heif' };
  if (mime.includes('gif')) return { mime: 'image/gif', ext: 'gif' };
  const name = (asset.fileName ?? '').toLowerCase();
  const dot = name.lastIndexOf('.');
  if (dot >= 0) {
    const e = name.slice(dot + 1);
    if (e === 'png') return { mime: 'image/png', ext: 'png' };
    if (e === 'webp') return { mime: 'image/webp', ext: 'webp' };
    if (e === 'heic' || e === 'heif') return { mime: e === 'heif' ? 'image/heif' : 'image/heic', ext: e };
    if (e === 'gif') return { mime: 'image/gif', ext: 'gif' };
  }
  return { mime: 'image/jpeg', ext: 'jpg' };
}

function groupByDate(messages: Message[]): Array<Message | { type: 'separator'; date: string; id: string }> {
  const result: Array<Message | { type: 'separator'; date: string; id: string }> = [];
  let lastDate = '';
  for (const msg of messages) {
    const dateLabel = formatDateLabel(msg.created_at);
    if (dateLabel !== lastDate) {
      result.push({ type: 'separator', date: dateLabel, id: `sep-${msg.id}` });
      lastDate = dateLabel;
    }
    result.push(msg);
  }
  return result;
}

/** Android pode destruir a Activity ao fechar o picker — recupera o resultado pendente. */
async function mergePendingAndroidGalleryResult(
  result: ImagePicker.ImagePickerResult,
): Promise<ImagePicker.ImagePickerResult> {
  if (Platform.OS !== 'android' || !result.canceled) return result;
  try {
    const pending = await ImagePicker.getPendingResultAsync();
    if (pending == null) return result;
    if ('code' in pending && typeof (pending as { code?: string }).code === 'string') return result;
    if ('assets' in pending && pending.assets && pending.assets.length > 0) {
      return { canceled: false, assets: pending.assets };
    }
  } catch {
    /* ignore */
  }
  return result;
}

const galleryPickerOptions: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  quality: 0.85,
  ...(Platform.OS === 'ios'
    ? { preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible }
    : {}),
};

const cameraPickerOptions: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  quality: 0.85,
  ...(Platform.OS === 'ios'
    ? { preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible }
    : {}),
};

export function ChatScreen({ navigation, route }: Props) {
  const { conversationId, participantName, participantAvatar } = route.params;
  const composerBottom = useBottomSafeInset({ extra: 6 });
  const { showAlert } = useAppAlert();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [conversationStatus, setConversationStatus] = useState<'active' | 'closed'>('active');
  const [myId, setMyId] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const recordingRef = useRef<{ stopAndUnloadAsync: () => Promise<void>; getURI: () => string | null } | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setMyId(user.id);
    });
  }, []);

  useEffect(() => {
    return () => {
      const r = recordingRef.current;
      if (r) {
        void r.stopAndUnloadAsync().catch(() => {});
        recordingRef.current = null;
      }
    };
  }, []);

  const loadMessages = useCallback(async () => {
    const { data, error } = await fetchChatMessages(sb, conversationId);
    setMessages(data as Message[]);
    if (error) {
      showAlert('Chat', error);
    }
    setLoading(false);
  }, [conversationId, showAlert]);

  const loadConversation = useCallback(async () => {
    const { data } = await sb
      .from('conversations')
      .select('status')
      .eq('id', conversationId)
      .single();
    if (data?.status) setConversationStatus(data.status as 'active' | 'closed');
  }, [conversationId]);

  useEffect(() => {
    void supabase.from('conversations').update({ unread_driver: 0 }).eq('id', conversationId);
    loadMessages();
    loadConversation();

    const channel = supabase
      .channel(`chat:${conversationId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const newMsg = payload.new as Message;
          setMessages((prev) => {
            if (prev.find((m) => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
          setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [conversationId, loadMessages, loadConversation]);

  const insertMessage = async (row: {
    content: string;
    message_kind: string;
    attachment_path?: string | null;
  }) => {
    if (!myId) return { ok: false as const, error: 'Sessão inválida. Faça login novamente.' };
    return insertChatMessage(sb, {
      conversationId,
      senderId: myId,
      content: row.content,
      messageKind: row.message_kind,
      attachmentPath: row.attachment_path,
    });
  };

  const sendMessage = async () => {
    const text = inputText.trim();
    if (!text || sending || !myId) return;
    setSending(true);
    const previousDraft = inputText;
    setInputText('');
    try {
      const r = await insertMessage({ content: text, message_kind: 'text' });
      if (!r.ok) {
        setInputText(previousDraft);
        showAlert('Erro', r.error);
      }
    } finally {
      setSending(false);
    }
  };

  const sendWithAttachment = async (
    localUri: string,
    contentType: string,
    ext: string,
    messageKind: 'image' | 'audio' | 'file',
    label: string,
    restoreInputIfFail?: string,
  ) => {
    if (!myId || uploadingAttachment) return;
    setUploadingAttachment(true);
    try {
      const path = await uploadChatLocalFile(conversationId, localUri, contentType, ext);
      const r = await insertMessage({
        content: label,
        message_kind: messageKind,
        attachment_path: path,
      });
      if (!r.ok) {
        if (restoreInputIfFail != null && restoreInputIfFail !== '') setInputText(restoreInputIfFail);
        showAlert('Erro', r.error);
      }
    } catch (e: unknown) {
      if (restoreInputIfFail != null && restoreInputIfFail !== '') setInputText(restoreInputIfFail);
      showAlert('Erro', getUserErrorMessage(e));
    } finally {
      setUploadingAttachment(false);
    }
  };

  const openAttachmentMenu = () => {
    Alert.alert('Enviar anexo', 'Escolha uma opção', [
      {
        text: 'Galeria de fotos',
        onPress: () => { void pickFromGallery(); },
      },
      {
        text: 'Tirar foto',
        onPress: () => { void openCamera(); },
      },
      {
        text: 'Arquivo',
        onPress: () => { void pickDocument(); },
      },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  };

  const pickFromGallery = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        showAlert(
          'Permissão',
          'Precisamos de acesso às fotos para enviar imagens. Ative em Ajustes > Take Me Motorista > Fotos.',
        );
        return;
      }
      let result = await ImagePicker.launchImageLibraryAsync(galleryPickerOptions);
      result = await mergePendingAndroidGalleryResult(result);
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      const { mime, ext } = mimeAndExtFromImageAsset(asset);
      const caption = inputText.trim();
      if (caption) setInputText('');
      await sendWithAttachment(
        asset.uri,
        mime,
        ext,
        'image',
        caption || '📷 Foto',
        caption,
      );
    } catch (e: unknown) {
      showAlert('Erro', getUserErrorMessage(e));
    }
  };

  const openCamera = async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        showAlert(
          'Permissão',
          'Precisamos da câmera para tirar uma foto. Ative em Ajustes > Take Me Motorista > Câmera.',
        );
        return;
      }
      let result = await ImagePicker.launchCameraAsync(cameraPickerOptions);
      result = await mergePendingAndroidGalleryResult(result);
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      const { mime, ext } = mimeAndExtFromImageAsset(asset);
      const caption = inputText.trim();
      if (caption) setInputText('');
      await sendWithAttachment(
        asset.uri,
        mime,
        ext,
        'image',
        caption || '📷 Foto',
        caption,
      );
    } catch (e: unknown) {
      showAlert('Erro', getUserErrorMessage(e));
    }
  };

  const pickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const name = asset.name ?? 'arquivo';
      const ext = name.includes('.') ? (name.split('.').pop() ?? 'bin') : 'bin';
      const mime = asset.mimeType ?? 'application/octet-stream';
      const previousDraft = inputText;
      const caption = inputText.trim() || name;
      if (inputText.trim()) setInputText('');
      await sendWithAttachment(asset.uri, mime, ext, 'file', caption, previousDraft);
    } catch (e: unknown) {
      showAlert('Erro', getUserErrorMessage(e));
    }
  };

  const toggleRecording = async () => {
    if (!myId || uploadingAttachment) return;
    if (isRecording) {
      const rec = recordingRef.current;
      recordingRef.current = null;
      setIsRecording(false);
      if (!rec) return;
      try {
        await rec.stopAndUnloadAsync();
        const uri = rec.getURI();
        if (uri) {
          const caption = inputText.trim();
          if (caption) setInputText('');
          await sendWithAttachment(
            uri,
            Platform.OS === 'ios' ? 'audio/m4a' : 'audio/mp4',
            'm4a',
            'audio',
            caption || '🎤 Áudio',
            caption,
          );
        }
      } catch (e: unknown) {
        showAlert('Erro', getUserErrorMessage(e));
      }
      return;
    }

    try {
      const av = await loadExpoAv();
      if (!av) {
        showAlert(
          'Gravação de voz indisponível',
          'Neste dispositivo o áudio do chat não está disponível (falta o módulo nativo no app instalado). Peça uma versão nova do app ao time ou reinstale com build que inclua expo-av. Por enquanto, use o botão + para enviar foto ou arquivo.',
        );
        return;
      }
      const { Audio } = av;
      const perm = await Audio.requestPermissionsAsync();
      if (perm.status !== 'granted') {
        showAlert('Permissão', 'Precisamos do microfone para gravar áudio.');
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
      });
      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await recording.startAsync();
      recordingRef.current = recording;
      setIsRecording(true);
    } catch (e: unknown) {
      showAlert('Erro', getUserErrorMessage(e));
    }
  };

  const items = groupByDate(messages);

  const renderBubbleBody = (msg: Message, isOutgoing: boolean) => {
    const kind = msg.message_kind ?? 'text';
    const path = msg.attachment_path ?? null;

    if (kind === 'image' && path) {
      return (
        <View>
          <ChatAttachmentImage attachmentPath={path} isOutgoing={isOutgoing} />
          {msg.content && msg.content !== '📷 Foto' ? (
            <Text style={[styles.bubbleText, isOutgoing && styles.bubbleTextOut, styles.captionBelow]}>
              {msg.content}
            </Text>
          ) : null}
        </View>
      );
    }
    if (kind === 'audio' && path) {
      return (
        <View>
          <ChatAttachmentAudio attachmentPath={path} isOutgoing={isOutgoing} />
          {msg.content && msg.content !== '🎤 Áudio' ? (
            <Text style={[styles.bubbleText, isOutgoing && styles.bubbleTextOut, styles.captionBelow]}>
              {msg.content}
            </Text>
          ) : null}
        </View>
      );
    }
    if (kind === 'file' && path) {
      return (
        <View>
          <ChatAttachmentFile
            attachmentPath={path}
            contentLabel={msg.content}
            isOutgoing={isOutgoing}
          />
        </View>
      );
    }
    return <Text style={[styles.bubbleText, isOutgoing && styles.bubbleTextOut]}>{msg.content}</Text>;
  };

  const renderItem = ({ item }: { item: typeof items[number] }) => {
    if ('type' in item && item.type === 'separator') {
      return (
        <View style={styles.separatorRow}>
          <View style={styles.separatorPill}>
            <Text style={styles.separatorText}>{item.date}</Text>
          </View>
        </View>
      );
    }
    const msg = item as Message;
    const isOutgoing = msg.sender_id === myId;
    return (
      <View style={[styles.messageRow, isOutgoing ? styles.messageRowOut : styles.messageRowIn]}>
        <View style={[styles.bubble, isOutgoing ? styles.bubbleOut : styles.bubbleIn]}>
          {renderBubbleBody(msg, isOutgoing)}
          <View style={styles.bubbleFooter}>
            <Text style={[styles.bubbleTime, isOutgoing && styles.bubbleTimeOut]}>
              {formatTime(msg.created_at)}
            </Text>
            {isOutgoing && (
              <MaterialIcons
                name={msg.read_at ? 'done-all' : 'done'}
                size={14}
                color={msg.read_at ? '#1D4ED8' : 'rgba(0,0,0,0.45)'}
              />
            )}
          </View>
        </View>
      </View>
    );
  };

  const inputDisabled = sending || uploadingAttachment || !myId || isRecording;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="dark" />

      <View style={styles.header}>
        <TouchableOpacity style={styles.headerBack} onPress={() => navigation.goBack()} hitSlop={12}>
          <MaterialIcons name="arrow-back" size={24} color={COLORS.black} />
        </TouchableOpacity>
        {participantAvatar ? (
          <Image source={{ uri: storageUrl('avatars', participantAvatar) ?? '' }} style={styles.headerAvatar} />
        ) : (
          <View style={styles.headerAvatarPlaceholder}>
            <Text style={styles.headerAvatarText}>
              {(participantName ?? '?')[0].toUpperCase()}
            </Text>
          </View>
        )}
        <Text style={styles.headerName} numberOfLines={1}>{participantName ?? 'Usuário'}</Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* Sem KeyboardAvoidingView: o app usa ADJUST_PAN global (App.tsx) para
          trazer o composer acima do teclado. Um KAV aqui conflitava com o pan
          e escondia o campo de texto. */}
      <View style={styles.flex}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={GOLD} />
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={items}
            keyExtractor={(item) => ('id' in item ? item.id : (item as { id: string }).id)}
            renderItem={renderItem}
            contentContainerStyle={styles.messagesContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
            ListFooterComponent={
              conversationStatus === 'closed' ? (
                <Text style={styles.closedText}>Conversa encerrada</Text>
              ) : null
            }
          />
        )}

        {conversationStatus === 'active' && (
          <View
            style={[
              styles.composer,
              { paddingBottom: composerBottom },
            ]}
          >
            {isRecording ? (
              <Text style={styles.recordingLabel}>Gravando… toque no microfone para enviar</Text>
            ) : null}
            <View style={styles.inputRow}>
              <TouchableOpacity
                style={[styles.iconButton, inputDisabled && styles.iconButtonDisabled]}
                onPress={openAttachmentMenu}
                disabled={inputDisabled}
                activeOpacity={0.7}
              >
                <MaterialIcons name="add" size={22} color={COLORS.neutral700} />
              </TouchableOpacity>
              <TextInput
                style={styles.input}
                placeholder="Mensagem"
                placeholderTextColor={COLORS.neutral700}
                value={inputText}
                onChangeText={setInputText}
                multiline
                maxLength={500}
                onSubmitEditing={sendMessage}
                editable={!inputDisabled}
                textAlignVertical={Platform.OS === 'android' ? 'top' : 'center'}
              />
              <View style={styles.inputTrailing}>
                <TouchableOpacity
                  style={[
                    styles.sendButton,
                    (!inputText.trim() || inputDisabled) && styles.sendButtonDisabled,
                  ]}
                  onPress={sendMessage}
                  disabled={!inputText.trim() || inputDisabled}
                  activeOpacity={0.8}
                >
                  {sending ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <MaterialIcons name="send" size={20} color="#FFFFFF" />
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.iconButton, inputDisabled && styles.iconButtonDisabled]}
                  onPress={() => { void openCamera(); }}
                  disabled={inputDisabled}
                  activeOpacity={0.7}
                >
                  <MaterialIcons name="camera-alt" size={22} color={COLORS.neutral700} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.iconButton,
                    (uploadingAttachment || !myId) && styles.iconButtonDisabled,
                  ]}
                  onPress={() => { void toggleRecording(); }}
                  disabled={uploadingAttachment || !myId}
                  activeOpacity={0.7}
                >
                  <MaterialIcons
                    name="mic"
                    size={22}
                    color={isRecording ? '#DC2626' : COLORS.neutral700}
                  />
                </TouchableOpacity>
                {uploadingAttachment ? (
                  <ActivityIndicator size="small" color={GOLD} style={styles.uploadSpinner} />
                ) : null}
              </View>
            </View>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  flex: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.neutral300,
  },
  headerBack: { padding: 8 },
  headerAvatar: { width: 40, height: 40, borderRadius: 20, marginLeft: 4 },
  headerAvatarPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: GOLD,
    marginLeft: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAvatarText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  headerName: { flex: 1, fontSize: 17, fontWeight: '600', color: COLORS.black, marginLeft: 10 },
  headerSpacer: { width: 40 },

  messagesContent: { padding: 16, paddingBottom: 8 },

  separatorRow: { alignItems: 'center', marginVertical: 12 },
  separatorPill: {
    backgroundColor: COLORS.neutral100,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  separatorText: { fontSize: 12, color: COLORS.neutral700 },

  messageRow: { marginBottom: 10 },
  messageRowOut: { alignItems: 'flex-end' },
  messageRowIn: { alignItems: 'flex-start' },

  bubble: {
    maxWidth: '80%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
  },
  bubbleOut: {
    backgroundColor: COLORS.bubbleOut,
    borderBottomRightRadius: 4,
  },
  bubbleIn: {
    backgroundColor: COLORS.bubbleIn,
    borderBottomLeftRadius: 4,
  },
  bubbleText: { fontSize: 15, color: COLORS.black, lineHeight: 20 },
  bubbleTextOut: { color: COLORS.black },
  captionBelow: { marginTop: 8 },
  bubbleFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    marginTop: 4,
  },
  bubbleTime: { fontSize: 11, color: COLORS.neutral700 },
  bubbleTimeOut: { color: 'rgba(0,0,0,0.55)' },

  closedText: {
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.black,
    paddingVertical: 24,
  },

  composer: {
    borderTopWidth: 1,
    borderTopColor: COLORS.neutral300,
    backgroundColor: COLORS.background,
    paddingTop: 10,
    paddingHorizontal: 12,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  recordingLabel: {
    fontSize: 13,
    color: '#DC2626',
    fontWeight: '600',
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.neutral100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonDisabled: { opacity: 0.35 },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 40,
    maxHeight: 120,
    backgroundColor: COLORS.neutral300,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    lineHeight: 20,
    color: COLORS.black,
  },
  inputTrailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.black,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: { opacity: 0.4 },
  uploadSpinner: { marginLeft: -2 },
});
