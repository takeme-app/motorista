import React, { useState, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';

// ── Types ────────────────────────────────────────────────────────────
export interface FileUploadProps {
  /** Storage bucket (default: chat-attachments) */
  bucket?: string;
  /**
   * Prefixo obrigatório do caminho no bucket (ex.: conversationId).
   * Garante compatibilidade com as policies RLS do storage, que exigem
   * `${conversationId}/...` como primeira pasta.
   */
  pathPrefix: string;
  /**
   * Callback ao completar upload. Retorna o `path` no bucket e o `kind`
   * compatível com message_kind (image|audio|file). Vídeo é gravado como
   * 'file' e identificado pela extensão na exibição.
   */
  onUploaded: (path: string, kind: 'image' | 'audio' | 'file') => void;
  /** Cancela o upload / fecha o componente */
  onCancel?: () => void;
  /** Aceita apenas certos tipos (default: pdf + imagens + áudio + vídeo) */
  accept?: string;
  style?: React.CSSProperties;
}

// ── Styles ───────────────────────────────────────────────────────────
const font: React.CSSProperties = { fontFamily: 'Inter, sans-serif' };

const containerStyle: React.CSSProperties = {
  ...font,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const dropzoneStyle: React.CSSProperties = {
  border: '2px dashed #e2e2e2',
  borderRadius: 8,
  padding: '16px 12px',
  textAlign: 'center' as const,
  cursor: 'pointer',
  fontSize: 13,
  color: '#767676',
  transition: 'border-color 0.2s, background 0.2s',
};

const dropzoneHoverStyle: React.CSSProperties = {
  ...dropzoneStyle,
  borderColor: '#F59E0B',
  background: '#fffbeb',
};

const previewStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 12px',
  background: '#f9f9f9',
  borderRadius: 8,
  fontSize: 13,
};

const btnStyle: React.CSSProperties = {
  ...font,
  padding: '6px 14px',
  borderRadius: 6,
  border: 'none',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};

// ── Helpers ──────────────────────────────────────────────────────────
// kind compatível com message_kind (image|audio|file). Vídeo/PDF/documentos => 'file'.
function getFileKind(file: File): 'image' | 'audio' | 'file' | null {
  const type = file.type || '';
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('audio/')) return 'audio';
  if (type.startsWith('video/')) return 'file';
  if (type === 'application/pdf') return 'file';
  // Documentos do Office / texto / zip também são aceitos como arquivo genérico.
  if (
    type.startsWith('application/') ||
    type.startsWith('text/')
  ) return 'file';
  return null;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Component ────────────────────────────────────────────────────────
export default function FileUpload(props: FileUploadProps) {
  const {
    bucket = 'chat-attachments',
    pathPrefix,
    onUploaded,
    onCancel,
    accept = '.pdf,.png,.jpg,.jpeg,.webp,.gif,.heic,.mp3,.m4a,.aac,.wav,.ogg,.mp4,.mov,.webm,.3gp,.doc,.docx,.xls,.xlsx,.txt,.csv',
    style,
  } = props;
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    const f = files[0];
    const kind = getFileKind(f);
    if (!kind) {
      setError('Formato não suportado.');
      return;
    }
    if (f.size > 25 * 1024 * 1024) {
      setError('Arquivo muito grande. Máximo 25 MB.');
      return;
    }
    setFile(f);
    setError(null);
  }, []);

  const handleUpload = useCallback(async () => {
    if (!file) return;
    const kind = getFileKind(file);
    if (!kind) return;
    const safePrefix = (pathPrefix || '').trim();
    if (!safePrefix) {
      setError('Contexto inválido para upload.');
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const rawExt = file.name.split('.').pop() || 'bin';
      const ext = rawExt.replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin';
      const id = (globalThis.crypto?.randomUUID?.() as string | undefined)
        || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const path = `${safePrefix}/${id}.${ext}`;

      const { error: uploadError } = await (supabase as any).storage
        .from(bucket)
        .upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });

      if (uploadError) throw uploadError;

      // Grava apenas o path; a exibição gera signed URL sob demanda (bucket privado).
      onUploaded(path, kind);
      setFile(null);
    } catch (err: any) {
      setError(err.message || 'Erro ao enviar arquivo');
    } finally {
      setUploading(false);
    }
  }, [file, bucket, pathPrefix, onUploaded]);

  const handleDrop = useCallback((e: any) => {
    e.preventDefault();
    setDragOver(false);
    handleFileSelect(e.dataTransfer?.files);
  }, [handleFileSelect]);

  return React.createElement('div', { style: { ...containerStyle, ...style } },
    // File input (hidden)
    React.createElement('input', {
      ref: inputRef,
      type: 'file',
      accept,
      style: { display: 'none' },
      onChange: (e: any) => handleFileSelect(e.target.files),
    }),

    // Dropzone ou preview
    file
      ? React.createElement('div', { style: previewStyle },
          React.createElement('span', { style: { fontSize: 18 } },
            getFileKind(file) === 'image' ? '\u{1F5BC}'
              : getFileKind(file) === 'audio' ? '\u{1F3A4}'
                : (file.type || '').startsWith('video/') ? '\u{1F3A5}'
                  : '\u{1F4C4}'),
          React.createElement('div', { style: { flex: 1, overflow: 'hidden' } },
            React.createElement('div', { style: { fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' } }, file.name),
            React.createElement('div', { style: { fontSize: 12, color: '#767676' } }, formatSize(file.size)),
          ),
          React.createElement('button', {
            onClick: () => { setFile(null); setError(null); },
            style: { ...btnStyle, background: '#f1f1f1', color: '#767676' },
          }, 'Remover'),
        )
      : React.createElement('div', {
          style: dragOver ? dropzoneHoverStyle : dropzoneStyle,
          onClick: () => inputRef.current?.click(),
          onDragOver: (e: any) => { e.preventDefault(); setDragOver(true); },
          onDragLeave: () => setDragOver(false),
          onDrop: handleDrop,
        },
          'Arraste um arquivo ou clique para selecionar',
          React.createElement('div', { style: { fontSize: 11, color: '#999', marginTop: 4 } }, 'Imagem, áudio, vídeo, PDF e documentos (max 25 MB)'),
        ),

    // Error
    error
      ? React.createElement('div', { style: { color: '#b53838', fontSize: 12 } }, error)
      : null,

    // Actions
    React.createElement('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end' } },
      onCancel
        ? React.createElement('button', {
            onClick: onCancel,
            style: { ...btnStyle, background: '#f1f1f1', color: '#0d0d0d' },
          }, 'Cancelar')
        : null,
      file
        ? React.createElement('button', {
            onClick: handleUpload,
            disabled: uploading,
            style: { ...btnStyle, background: '#F59E0B', color: '#fff', opacity: uploading ? 0.6 : 1 },
          }, uploading ? 'Enviando...' : 'Enviar')
        : null,
    ),
  );
}
