import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Normaliza vehicle_photos_urls (jsonb no Postgres pode vir como array ou, em casos raros, string JSON).
 */
export function parseVehiclePhotosUrls(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((s) => s.trim());
  }
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) return [];
    try {
      const parsed = JSON.parse(t) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((s) => s.trim());
      }
    } catch {
      /* caminho único sem JSON */
    }
    return [t];
  }
  return [];
}

function inferVehiclePhotoBucket(path: string): 'driver-documents' | 'vehicles' {
  // FinalizeRegistration: `{userId}/vehicle_0.jpg` → driver-documents
  // VehicleFormScreen: `{userId}/{vehicleId}/photo_0.jpg` → vehicles
  // Também: `{userId}/photo_0.jpg` (sem pasta intermediária) — nome de arquivo contém photo_
  if (path.includes('/photo_')) return 'vehicles';
  const last = path.split('/').pop() ?? '';
  return /^photo_\d+/i.test(last) ? 'vehicles' : 'driver-documents';
}

/**
 * URLs gravadas pelo app (uploadToStorage) usam /object/public/{bucket}/...
 * Se o bucket for privado, essa URL quebra no <img>; o admin precisa de signed URL.
 */
function parseSupabasePublicStorageUrl(urlStr: string): { bucket: string; objectPath: string } | null {
  try {
    const base = urlStr.split('?')[0] ?? urlStr;
    const u = new URL(base);
    const m = u.pathname.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
    if (!m) return null;
    const objectPath = decodeURIComponent(m[2].replace(/\/$/, ''));
    return { bucket: m[1], objectPath };
  } catch {
    return null;
  }
}

/** URLs assinadas antigas expiram; reemitimos com createSignedUrl. */
function parseSupabaseSignedStorageUrl(urlStr: string): { bucket: string; objectPath: string } | null {
  try {
    const base = urlStr.split('?')[0] ?? urlStr;
    const u = new URL(base);
    const m = u.pathname.match(/\/storage\/v1\/object\/sign\/([^/]+)\/(.+)$/);
    if (!m) return null;
    const objectPath = decodeURIComponent(m[2].replace(/\/$/, ''));
    return { bucket: m[1], objectPath };
  } catch {
    return null;
  }
}

/**
 * Valor no banco pode ser URL pública (cadastro pelo app com getPublicUrl) ou apenas path no bucket
 * (FinalizeRegistration retorna data.path). Buckets costumam ser privados → signed URL para o admin.
 */
export async function resolveStorageDisplayUrl(client: SupabaseClient, pathOrUrl: string): Promise<string | null> {
  const trimmed = pathOrUrl.trim();
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed)) {
    const parsed =
      parseSupabasePublicStorageUrl(trimmed) ?? parseSupabaseSignedStorageUrl(trimmed);
    if (parsed && (parsed.bucket === 'driver-documents' || parsed.bucket === 'vehicles')) {
      const { data, error } = await client.storage
        .from(parsed.bucket)
        .createSignedUrl(parsed.objectPath, 60 * 60);
      if (!error && data?.signedUrl) return data.signedUrl;
    }
    return trimmed;
  }

  const primary = inferVehiclePhotoBucket(trimmed);
  const buckets: Array<'driver-documents' | 'vehicles'> =
    primary === 'vehicles' ? ['vehicles', 'driver-documents'] : ['driver-documents', 'vehicles'];

  for (const bucket of buckets) {
    const { data, error } = await client.storage.from(bucket).createSignedUrl(trimmed, 60 * 60);
    if (!error && data?.signedUrl) return data.signedUrl;
  }

  const { data } = client.storage.from(primary).getPublicUrl(trimmed);
  return data.publicUrl ?? null;
}

const DEPENDENT_DOCUMENTS_BUCKET = 'dependent-documents';

/**
 * Resolve a URL exibível de um documento de dependente (menor / responsável).
 * O app cliente grava apenas o PATH cru no bucket privado `dependent-documents`
 * (ex.: `{userId}/{dependentId}/documento_dependente.pdf`) → precisa de signed URL.
 * Tolera também URLs públicas/assinadas antigas do mesmo bucket.
 * Mantida separada de `resolveStorageDisplayUrl` (que só cobre driver-documents/vehicles).
 */
export async function resolveDependentDocumentUrl(
  client: SupabaseClient,
  pathOrUrl: string | null | undefined,
): Promise<string | null> {
  const trimmed = pathOrUrl?.trim();
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed)) {
    const parsed = parseSupabasePublicStorageUrl(trimmed) ?? parseSupabaseSignedStorageUrl(trimmed);
    const objectPath = parsed?.bucket === DEPENDENT_DOCUMENTS_BUCKET ? parsed.objectPath : null;
    if (objectPath) {
      const { data, error } = await client.storage
        .from(DEPENDENT_DOCUMENTS_BUCKET)
        .createSignedUrl(objectPath, 60 * 60);
      if (!error && data?.signedUrl) return data.signedUrl;
    }
    return trimmed;
  }

  const { data, error } = await client.storage
    .from(DEPENDENT_DOCUMENTS_BUCKET)
    .createSignedUrl(trimmed, 60 * 60);
  if (!error && data?.signedUrl) return data.signedUrl;
  return null;
}

const CHAT_ATTACHMENTS_BUCKET = 'chat-attachments';

/**
 * Resolve a URL exibível de um anexo de chat.
 * - Mensagens novas (motorista/cliente e admin) gravam apenas o `attachment_path`
 *   no bucket privado chat-attachments → precisa de signed URL.
 * - Mensagens antigas do admin podem ter `attachment_url` (signed URL de longa duração) → usa direto.
 */
export async function resolveChatAttachmentUrl(
  client: SupabaseClient,
  attachmentPath: string | null,
  attachmentUrl: string | null,
): Promise<string | null> {
  const path = attachmentPath?.trim();
  if (path) {
    const { data, error } = await client.storage
      .from(CHAT_ATTACHMENTS_BUCKET)
      .createSignedUrl(path, 60 * 60);
    if (!error && data?.signedUrl) return data.signedUrl;
  }

  const url = attachmentUrl?.trim();
  if (url) return url;

  return null;
}
