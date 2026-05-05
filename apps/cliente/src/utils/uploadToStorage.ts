import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '../lib/supabase';

/** Path no bucket `avatars`: primeira pasta deve casar com auth.uid() (RLS usa lower()). */
export function avatarStorageObjectPath(userId: string): string {
  return `${userId.toLowerCase()}/avatar.jpg`;
}

function base64ToUint8Array(b64: string): Uint8Array {
  const binary = global.atob ? global.atob(b64) : decodeAtobFallback(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const ATOB_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function decodeAtobFallback(input: string): string {
  const str = input.replace(/=+$/, '');
  let output = '';
  if (str.length % 4 === 1) throw new Error('base64 inválido');
  let bc = 0;
  let bs = 0;
  for (let i = 0; i < str.length; i += 1) {
    const c = str[i];
    const idx = ATOB_ALPHABET.indexOf(c);
    if (idx === -1) continue;
    bs = bc % 4 ? bs * 64 + idx : idx;
    if (bc % 4) {
      output += String.fromCharCode(255 & (bs >> ((-2 * bc) & 6)));
    }
    bc += 1;
  }
  return output;
}

async function localUriToUint8Array(localUri: string): Promise<Uint8Array> {
  try {
    const res = await fetch(localUri);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    const base64 = await FileSystem.readAsStringAsync(localUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    if (!base64) throw new Error('Arquivo de imagem vazio.');
    return base64ToUint8Array(base64);
  }
}

/**
 * Upload de imagem para bucket público — mesmo padrão dos outros fluxos
 * (fetch → bytes → supabase.storage.upload).
 */
export async function uploadImageFromUriToPublicBucket(
  bucket: string,
  storagePath: string,
  localUri: string,
  options?: { pickerMimeType?: string | null },
): Promise<string> {
  const contentType = pickContentTypeForImage(localUri, options?.pickerMimeType ?? null);

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Usuário não autenticado.');
  await supabase.auth.refreshSession().catch(() => {});

  const bytes = await localUriToUint8Array(localUri);
  if (bytes.byteLength < 1) throw new Error('Arquivo de imagem vazio.');

  const { error } = await supabase.storage.from(bucket).upload(storagePath, bytes, {
    contentType,
    upsert: true,
  });

  if (error) {
    throw new Error(error.message || 'Falha no upload para o storage.');
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(storagePath);
  return `${data.publicUrl}?t=${Date.now()}`;
}

function pickContentTypeForImage(uri: string, pickerMimeType: string | null | undefined): string {
  const mime = (pickerMimeType ?? '').toLowerCase();
  if (mime.startsWith('image/')) return mime;
  const lowerUri = uri.toLowerCase();
  if (lowerUri.endsWith('.png')) return 'image/png';
  if (lowerUri.endsWith('.heic')) return 'image/heic';
  if (lowerUri.endsWith('.heif')) return 'image/heif';
  if (lowerUri.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

/**
 * Upload binário nativo via `FileSystem.uploadAsync` para arquivos não-imagem
 * (chat attachments, documentos, etc.).
 */
export async function uploadToStorage(
  bucket: string,
  storagePath: string,
  localUri: string,
  contentType: string,
): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Usuário não autenticado.');

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
  const target = `${supabaseUrl}/storage/v1/object/${bucket}/${storagePath}`;

  const result = await FileSystem.uploadAsync(target, localUri, {
    httpMethod: 'POST',
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': contentType,
      'x-upsert': 'true',
    },
  });

  if (result.status < 200 || result.status >= 300) {
    let detail = '';
    try {
      const j = JSON.parse(result.body) as { message?: string; error?: string };
      detail = [j.message, j.error].filter((x) => typeof x === 'string' && x.trim()).join(' — ') || '';
    } catch {
      detail = (result.body || '').trim().slice(0, 300);
    }
    throw new Error(detail || `Upload falhou (HTTP ${result.status}).`);
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(storagePath);
  return `${data.publicUrl}?t=${Date.now()}`;
}
