-- Amplia allowed_mime_types do bucket chat-attachments para cobrir áudio,
-- imagens HEIC/GIF, vídeos e documentos do Office. A lista antiga só permitia
-- PDF/JPEG/PNG/WebP, então áudios e demais formatos faziam o upload retornar
-- "formato de arquivo não aceito" no Supabase Storage.
UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  -- Imagens
  'image/jpeg','image/png','image/webp','image/heic','image/heif','image/gif',
  -- Áudio
  'audio/m4a','audio/mp4','audio/aac','audio/mpeg','audio/mp3','audio/wav','audio/x-wav',
  'audio/ogg','audio/webm','audio/3gpp','audio/amr',
  -- Vídeo (pode ser anexo no chat)
  'video/mp4','video/quicktime','video/3gpp','video/webm',
  -- Documentos
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain','text/csv',
  'application/zip','application/x-zip-compressed',
  -- Fallback para mimes não detectados pelo picker (raro, mas possível)
  'application/octet-stream'
]
WHERE id = 'chat-attachments';
