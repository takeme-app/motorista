import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  FlatList,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  ActivityIndicator,
  Image,
  Alert,
  Modal,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Text } from '../components/Text';
import { MaterialIcons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ClientChatRouteParams } from '../navigation/ActivitiesStackTypes';
import { getMainTabBarStyleFromInsets } from '../navigation/mainTabBarStyle';
import { getOrCreateActiveSupportConversationId, useBottomSafeInset } from '@take-me/shared';
import { supabase } from '../lib/supabase';
import { ensureDriverClientConversation, markConversationReadByClient } from '../lib/chatConversations';
import { storageUrl } from '../utils/storageUrl';
import { uploadChatLocalFile } from '../utils/chatAttachments';
import { useAppAlert } from '../contexts/AppAlertContext';
import { getUserErrorMessage } from '../utils/errorMessage';
import { loadExpoAv, configureAudioForPlayback } from '../utils/expoAvOptional';
import {
  ChatAttachmentImage,
  ChatAttachmentAudio,
  ChatAttachmentFile,
} from '../components/chat/ChatAttachmentViews';

const sb = supabase as { from: (table: string) => any };

type Props = NativeStackScreenProps<{ Chat: ClientChatRouteParams }, 'Chat'>;

const COLORS = {
  background: '#FFFFFF',
  black: '#0d0d0d',
  neutral300: '#f1f1f1',
  neutral100: '#F3F4F6',
  neutral700: '#767676',
  bubbleOut: '#0d0d0d',
  bubbleIn: '#e2e2e2',
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

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function ChatScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const composerBottom = useBottomSafeInset({ extra: 6 });
  const { showAlert } = useAppAlert();

  // No Android (Expo edge-to-edge) o softwareKeyboardLayoutMode 'pan' NÃO reposiciona o
  // composer ancorado no rodapé, e o KeyboardAvoidingView 'padding' ficava preso ao fechar
  // (o campo subia e não voltava). Controlamos a altura manualmente: empurra o composer pra
  // cima ao abrir o teclado e reseta a 0 ao fechar. iOS continua no KAV 'padding'.
  const [androidKbHeight, setAndroidKbHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => {
      setAndroidKbHeight(e.endCoordinates?.height ?? 0);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setAndroidKbHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Esconde a bottom tab bar enquanto o chat está focado e restaura ao sair.
  // O Chat aparece via ActivitiesStack/ProfileStack — o tab bar pertence ao
  // navigator pai (MainTabs), por isso o `getParent()`. Ao desfocar, restauramos
  // o estilo COM safe-area (getMainTabBarStyleFromInsets); usar `undefined` aqui
  // fazia o navigator voltar ao tab bar padrão (sem paddingBottom), quebrando a
  // barra na aba de Perfil/Atividades.
  useFocusEffect(
    useCallback(() => {
      const parent = navigation.getParent();
      parent?.setOptions({ tabBarStyle: { display: 'none' } });
      return () => {
        parent?.setOptions({ tabBarStyle: getMainTabBarStyleFromInsets(insets) });
      };
    }, [navigation, insets.bottom]),
  );
  const contactName = route.params?.contactName ?? 'Suporte Take Me';
  const routeConversationId = route.params?.conversationId;
  const driverId = route.params?.driverId;
  const bookingId = route.params?.bookingId ?? null;
  const participantAvatarKey = route.params?.participantAvatarKey ?? null;
  const supportBackoffice = route.params?.supportBackoffice === true;

  const [resolvedConversationId, setResolvedConversationId] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(
    () => !!(routeConversationId || driverId || supportBackoffice)
  );
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [conversationStatus, setConversationStatus] = useState<'active' | 'closed'>('active');
  const [myId, setMyId] = useState<string | null>(null);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [attachSheetVisible, setAttachSheetVisible] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const attachSheetBottom = useBottomSafeInset({ extra: 16 });
  const flatListRef = useRef<FlatList>(null);
  const recordingRef = useRef<{ stopAndUnloadAsync: () => Promise<void>; getURI: () => string | null } | null>(null);

  const conversationId = routeConversationId ?? resolvedConversationId;

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

  useEffect(() => {
    if (routeConversationId) {
      markConversationReadByClient(routeConversationId);
    }
  }, [routeConversationId]);

  useEffect(() => {
    if (routeConversationId || !driverId) return;
    let cancelled = false;
    (async () => {
      setResolveError(null);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) {
        setLoading(false);
        return;
      }
      const { conversationId: cid, error } = await ensureDriverClientConversation({
        clientId: user.id,
        driverId,
        bookingId,
      });
      if (cancelled) return;
      if (error || !cid) {
        setResolveError(error?.message ?? 'Não foi possível abrir a conversa.');
        setLoading(false);
        return;
      }
      setResolvedConversationId(cid);
      await markConversationReadByClient(cid);
    })();
    return () => { cancelled = true; };
  }, [routeConversationId, driverId, bookingId]);

  useEffect(() => {
    if (routeConversationId || driverId || !supportBackoffice) return;
    let cancelled = false;
    (async () => {
      setResolveError(null);
      setLoading(true);
      const { conversationId: cid, error } = await getOrCreateActiveSupportConversationId(supabase);
      if (cancelled) return;
      if (error || !cid) {
        setResolveError(error ?? 'Não foi possível abrir o atendimento.');
        setLoading(false);
        return;
      }
      setResolvedConversationId(cid);
      await markConversationReadByClient(cid);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [routeConversationId, driverId, supportBackoffice]);

  const loadMessages = useCallback(async () => {
    if (!conversationId) return;
    const { data } = await sb
      .from('messages')
      .select('id, sender_id, content, created_at, read_at, message_kind, attachment_path')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    setMessages((data ?? []) as Message[]);
    setLoading(false);
  }, [conversationId]);

  const loadConversation = useCallback(async () => {
    if (!conversationId) return;
    const { data } = await sb
      .from('conversations')
      .select('status')
      .eq('id', conversationId)
      .single();
    if (data?.status) setConversationStatus(data.status as 'active' | 'closed');
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) {
      if (!driverId && !routeConversationId && !supportBackoffice) setLoading(false);
      return;
    }
    setLoading(true);
    loadMessages();
    loadConversation();
    // Marca as mensagens recebidas como lidas → o remetente vê "visualizado" (✓✓).
    void supabase.rpc('mark_messages_read' as never, { p_conversation_id: conversationId } as never);

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
          // Chat aberto → marca a mensagem que acabou de chegar como lida.
          void supabase.rpc('mark_messages_read' as never, { p_conversation_id: conversationId } as never);
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const upd = payload.new as Message;
          setMessages((prev) => prev.map((m) => (m.id === upd.id ? { ...m, read_at: upd.read_at } : m)));
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [conversationId, driverId, routeConversationId, supportBackoffice, loadMessages, loadConversation]);

  const sendMessage = async () => {
    const text = inputText.trim();
    if (!text || sending || !myId) return;
    if (!conversationId) return;
    setSending(true);
    setInputText('');
    try {
      await sb.from('messages').insert({
        conversation_id: conversationId,
        sender_id: myId,
        content: text,
        message_kind: 'text',
      });
    } finally {
      setSending(false);
    }
  };

  const insertMessage = async (row: {
    content: string;
    message_kind: string;
    attachment_path?: string | null;
  }) => {
    if (!myId || !conversationId) return;
    await sb.from('messages').insert({
      conversation_id: conversationId,
      sender_id: myId,
      content: row.content,
      message_kind: row.message_kind,
      attachment_path: row.attachment_path ?? null,
    });
  };

  const sendWithAttachment = async (
    localUri: string,
    contentType: string,
    ext: string,
    messageKind: 'image' | 'audio' | 'file',
    label: string,
  ) => {
    if (!myId || !conversationId || uploadingAttachment) return;
    setUploadingAttachment(true);
    try {
      const path = await uploadChatLocalFile(conversationId, localUri, contentType, ext);
      await insertMessage({
        content: label,
        message_kind: messageKind,
        attachment_path: path,
      });
    } catch (e: unknown) {
      showAlert('Erro', getUserErrorMessage(e));
    } finally {
      setUploadingAttachment(false);
    }
  };

  const openAttachmentMenu = () => {
    if (!conversationId) {
      showAlert('Conversa', 'Aguarde a conversa carregar.');
      return;
    }
    setAttachSheetVisible(true);
  };

  const pickFromGallery = async () => {
    if (!conversationId) return;
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== 'granted') {
        showAlert('Permissão', 'Precisamos de acesso à galeria para enviar fotos.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.85,
      });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      const caption = inputText.trim();
      if (caption) setInputText('');
      await sendWithAttachment(asset.uri, 'image/jpeg', 'jpg', 'image', caption || '📷 Foto');
    } catch (e: unknown) {
      showAlert('Erro', getUserErrorMessage(e));
    }
  };

  const openCamera = async () => {
    if (!conversationId) return;
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (perm.status !== 'granted') {
        showAlert('Permissão', 'Precisamos da câmera para tirar uma foto.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.85,
      });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      const caption = inputText.trim();
      if (caption) setInputText('');
      await sendWithAttachment(asset.uri, 'image/jpeg', 'jpg', 'image', caption || '📷 Foto');
    } catch (e: unknown) {
      showAlert('Erro', getUserErrorMessage(e));
    }
  };

  const pickDocument = async () => {
    if (!conversationId) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const name = asset.name ?? 'arquivo';
      const ext = name.includes('.') ? (name.split('.').pop() ?? 'bin') : 'bin';
      const mime = asset.mimeType ?? 'application/octet-stream';
      const caption = inputText.trim() || name;
      if (inputText.trim()) setInputText('');
      await sendWithAttachment(asset.uri, mime, ext, 'file', caption);
    } catch (e: unknown) {
      showAlert('Erro', getUserErrorMessage(e));
    }
  };

  const toggleRecording = async () => {
    if (!myId || !conversationId || uploadingAttachment) return;
    if (isRecording) {
      const rec = recordingRef.current;
      recordingRef.current = null;
      setIsRecording(false);
      if (!rec) return;
      try {
        await rec.stopAndUnloadAsync();
        // iOS: encerra o modo gravação. Sem isto a sessão continua em
        // PlayAndRecord e os áudios do chat tocam pelo alto-falante do ouvido.
        void configureAudioForPlayback();
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
          'Gravação indisponível',
          'Este build do app ainda não inclui o suporte nativo a áudio. Rode um build novo do iOS (ex.: npx expo run:ios após pod install) ou envie um arquivo de áudio pelo botão de anexo.',
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
  const headerAvatarUri = storageUrl('avatars', participantAvatarKey);

  const renderBubbleBody = (msg: Message, isOutgoing: boolean) => {
    const kind = msg.message_kind ?? 'text';
    const path = msg.attachment_path ?? null;
    const pal = isOutgoing ? ('dark' as const) : ('gold' as const);

    if (kind === 'image' && path) {
      return (
        <View>
          <ChatAttachmentImage attachmentPath={path} isOutgoing={isOutgoing} outgoingPalette={pal} />
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
          <ChatAttachmentAudio attachmentPath={path} isOutgoing={isOutgoing} outgoingPalette={pal} />
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
        <ChatAttachmentFile
          attachmentPath={path}
          contentLabel={msg.content}
          isOutgoing={isOutgoing}
          outgoingPalette={pal}
        />
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
                color={msg.read_at ? '#2563EB' : 'rgba(255,255,255,0.7)'}
              />
            )}
          </View>
        </View>
      </View>
    );
  };

  const inputDisabled =
    sending || uploadingAttachment || !myId || isRecording || !conversationId;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerBack} onPress={() => navigation.goBack()} hitSlop={12}>
          <MaterialIcons name="arrow-back" size={24} color={COLORS.black} />
        </TouchableOpacity>
        {headerAvatarUri ? (
          <Image source={{ uri: headerAvatarUri }} style={styles.headerAvatar} />
        ) : (
          <View style={styles.headerAvatarPlaceholder}>
            <Text style={styles.headerAvatarText}>{getInitials(contactName)}</Text>
          </View>
        )}
        <Text style={styles.headerName} numberOfLines={1}>{contactName}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAvoidingView
        // iOS: KAV 'padding' com offset do header. Android: KAV inativo e empurramos o
        // composer via paddingBottom controlado por listeners (reseta a 0 ao fechar o teclado).
        style={[styles.flex, Platform.OS === 'android' ? { paddingBottom: androidKbHeight } : null]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 56 : 0}
      >
        {resolveError ? (
          <View style={styles.center}>
            <Text style={styles.errorText}>{resolveError}</Text>
          </View>
        ) : loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={COLORS.black} />
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
            ListEmptyComponent={
              !conversationId ? (
                <Text style={styles.hintText}>
                  {driverId
                    ? 'Abrindo conversa…'
                    : supportBackoffice
                      ? 'Abrindo atendimento…'
                      : 'Selecione uma conversa ou fale com o motorista a partir de uma viagem com motorista atribuído.'}
                </Text>
              ) : undefined
            }
            ListFooterComponent={
              conversationStatus === 'closed' ? (
                <Text style={styles.closedText}>Conversa encerrada</Text>
              ) : null
            }
          />
        )}

        {!resolveError && conversationStatus === 'active' && (
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
                <MaterialIcons name="attach-file" size={22} color={COLORS.neutral700} />
              </TouchableOpacity>
              <TextInput
                style={styles.input}
                placeholder="Mensagem"
                placeholderTextColor={COLORS.neutral700}
                value={inputText}
                onChangeText={setInputText}
                multiline
                maxLength={500}
                editable={!inputDisabled}
                onSubmitEditing={() => { void sendMessage(); }}
                textAlignVertical={Platform.OS === 'android' ? 'top' : 'center'}
              />
              <View style={styles.inputTrailing}>
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
                    (uploadingAttachment || !myId || !conversationId) && styles.iconButtonDisabled,
                  ]}
                  onPress={() => { void toggleRecording(); }}
                  disabled={uploadingAttachment || !myId || !conversationId}
                  activeOpacity={0.7}
                >
                  <MaterialIcons
                    name="mic"
                    size={22}
                    color={isRecording ? '#DC2626' : COLORS.neutral700}
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.sendButton,
                    (!inputText.trim() || inputDisabled) && styles.sendButtonDisabled,
                  ]}
                  onPress={() => { void sendMessage(); }}
                  disabled={!inputText.trim() || inputDisabled}
                  activeOpacity={0.8}
                >
                  {sending ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <MaterialIcons name="send" size={20} color="#FFFFFF" />
                  )}
                </TouchableOpacity>
                {uploadingAttachment ? (
                  <ActivityIndicator size="small" color={COLORS.black} style={styles.uploadSpinner} />
                ) : null}
              </View>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>

      {/* Sheet de anexo (padrão do app, no lugar do Alert nativo) */}
      <Modal
        visible={attachSheetVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setAttachSheetVisible(false)}
      >
        <View style={styles.attachOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setAttachSheetVisible(false)} />
          <View style={[styles.attachSheet, { paddingBottom: attachSheetBottom }]}>
            <View style={styles.attachHandle} />
            <Text style={styles.attachTitle}>Enviar anexo</Text>
            <TouchableOpacity
              style={styles.attachRow}
              activeOpacity={0.8}
              onPress={() => { setAttachSheetVisible(false); void pickFromGallery(); }}
            >
              <View style={styles.attachIcon}><MaterialIcons name="photo-library" size={22} color={COLORS.black} /></View>
              <Text style={styles.attachRowText}>Galeria de fotos</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.attachRow}
              activeOpacity={0.8}
              onPress={() => { setAttachSheetVisible(false); void pickDocument(); }}
            >
              <View style={styles.attachIcon}><MaterialIcons name="insert-drive-file" size={22} color={COLORS.black} /></View>
              <Text style={styles.attachRowText}>Arquivo</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.attachCancel} activeOpacity={0.8} onPress={() => setAttachSheetVisible(false)}>
              <Text style={styles.attachCancelText}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  flex: { flex: 1 },
  attachOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  attachSheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingTop: 10 },
  attachHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#E5E7EB', marginBottom: 14 },
  attachTitle: { fontSize: 16, fontWeight: '700', color: COLORS.black, marginBottom: 8 },
  attachRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 },
  attachIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
  attachRowText: { fontSize: 16, color: COLORS.black, fontWeight: '500' },
  attachCancel: { marginTop: 6, paddingVertical: 14, alignItems: 'center' },
  attachCancelText: { fontSize: 16, fontWeight: '600', color: COLORS.neutral700 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  errorText: { color: '#B91C1C', fontSize: 15, textAlign: 'center' },
  hintText: { color: COLORS.neutral700, fontSize: 14, textAlign: 'center', paddingVertical: 32, paddingHorizontal: 16 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.neutral300,
  },
  headerBack: { padding: 8 },
  headerAvatar: { width: 40, height: 40, borderRadius: 20, marginLeft: 4, backgroundColor: COLORS.neutral300 },
  headerAvatarPlaceholder: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: COLORS.neutral300, marginLeft: 4,
    alignItems: 'center', justifyContent: 'center',
  },
  headerAvatarText: { color: COLORS.black, fontSize: 15, fontWeight: '700' },
  headerName: { flex: 1, fontSize: 18, fontWeight: '600', color: COLORS.black, marginLeft: 12 },
  headerSpacer: { width: 40 },

  messagesContent: { padding: 16, paddingBottom: 8, flexGrow: 1 },

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
  bubbleOut: { backgroundColor: COLORS.bubbleOut, borderBottomRightRadius: 4 },
  bubbleIn: { backgroundColor: COLORS.bubbleIn, borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 15, color: COLORS.black, lineHeight: 20 },
  bubbleTextOut: { color: '#FFFFFF' },
  captionBelow: { marginTop: 8 },
  bubbleFooter: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'flex-end', gap: 4, marginTop: 4,
  },
  bubbleTime: { fontSize: 11, color: COLORS.neutral700 },
  bubbleTimeOut: { color: 'rgba(255,255,255,0.8)' },

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
  sendButtonDisabled: { opacity: 0.5 },
  uploadSpinner: { marginLeft: -2 },
});
