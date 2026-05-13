import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '../lib/supabase';

/** Path no bucket `avatars`: primeira pasta deve casar com auth.uid() (RLS usa lower()). */
export function avatarStorageObjectPath(userId: string): string {
  return `${userId.toLowerCase()}/avatar.jpg`;
}

/**
 * Upload de imagem local para bucket público.
 *
 * Implementação via `FileSystem.uploadAsync` (igual `uploadToStorage`) em vez
 * do caminho `supabase.storage.from(...).upload(bytes)`. Motivo: em RN/Expo,
 * o caminho via `supabase-js` ocasionalmente enviava as requests de Storage
 * com o `apikey` anon em vez do JWT do usuário (race entre `refreshSession`
 * e a chamada interna). Isso fazia `auth.role()` cair em `'anon'` e a policy
 * `Profile avatars upload` (que exige `'authenticated'`) rejeitava com
 * "new row violates row-level security policy". Anexar o `Authorization`
 * explicitamente elimina essa janela de erro.
 */
export async function uploadImageFromUriToPublicBucket(
  bucket: string,
  storagePath: string,
  localUri: string,
  options?: { pickerMimeType?: string | null },
): Promise<string> {
  const contentType = pickContentTypeForImage(localUri, options?.pickerMimeType ?? null);

  // Renova a sessão antes de capturar o token — se o refresh falhar, a sessão
  // existente é tentada do mesmo jeito (servidor retornará 401 e a UI mostrará
  // erro claro de autenticação).
  await supabase.auth.refreshSession().catch(() => {});
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Usuário não autenticado.');

  // Validação dura: confirma que o JWT identifica um usuário real (não anon)
  // antes de subir bytes. Se a sessão estiver corrompida, falhar aqui é mais
  // claro que o erro RLS subsequente do Storage.
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user?.id) {
    throw new Error('Sessão inválida. Faça login de novo e tente outra vez.');
  }

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Configuração do Supabase ausente (URL ou anon key).');
  }
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
