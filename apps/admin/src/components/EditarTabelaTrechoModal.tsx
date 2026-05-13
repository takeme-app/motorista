/**
 * Modal «Editar tabela» — Figma 956-23405.
 * Abre ao clicar no ícone de edição de um trecho na tabela.
 * Uses React.createElement() (no JSX).
 */
import React, { useState, useEffect, useCallback } from 'react';

const font: React.CSSProperties = { fontFamily: 'Inter, sans-serif' };

const closeModalSvg = React.createElement('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M18 6L6 18M6 6l12 12', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round' }));

const calendarSvg = React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block', flexShrink: 0 } },
  React.createElement('path', { d: 'M19 4H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2zM16 2v4M8 2v4M3 10h18', stroke: '#767676', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.4)',
  zIndex: 2100,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
  boxSizing: 'border-box',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  height: 44,
  borderRadius: 8,
  border: 'none',
  background: '#f1f1f1',
  padding: '0 16px',
  fontSize: 16,
  color: '#767676',
  outline: 'none',
  boxSizing: 'border-box',
  ...font,
};

const labelStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 500,
  color: '#0d0d0d',
  lineHeight: 1,
  minHeight: 40,
  display: 'flex',
  alignItems: 'center',
  ...font,
};

export type TrechoData = {
  origem: string;
  destino: string;
  valor: string;
  dataHoraIda: string;
  dataHoraRetorno: string;
  pctMotorista: string;
  pctAdmin: string;
};

export type EditarTabelaTrechoModalProps = {
  open: boolean;
  onClose: () => void;
  trecho?: TrechoData | null;
  onSave?: (data: TrechoData) => void;
};

export default function EditarTabelaTrechoModal({ open, onClose, trecho, onSave }: EditarTabelaTrechoModalProps) {
  const [origem, setOrigem] = useState('');
  const [destino, setDestino] = useState('');
  const [valor, setValor] = useState('');
  const [dataHoraIda, setDataHoraIda] = useState('');
  const [dataHoraRetorno, setDataHoraRetorno] = useState('');
  const [pctMotorista, setPctMotorista] = useState('');
  const [pctAdmin, setPctAdmin] = useState('');

  useEffect(() => {
    if (open && trecho) {
      setOrigem(trecho.origem);
      setDestino(trecho.destino);
      setValor(trecho.valor);
      setDataHoraIda(trecho.dataHoraIda);
      setDataHoraRetorno(trecho.dataHoraRetorno);
      setPctMotorista(trecho.pctMotorista);
      setPctAdmin(trecho.pctAdmin);
    }
  }, [open, trecho]);

  const fechar = useCallback(() => onClose(), [onClose]);

  const salvar = useCallback(() => {
    onSave?.({
      origem, destino, valor, dataHoraIda, dataHoraRetorno,
      pctMotorista, pctAdmin,
    });
    onClose();
  }, [onClose, onSave, origem, destino, valor, dataHoraIda, dataHoraRetorno, pctMotorista, pctAdmin]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') fechar(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, fechar]);

  const field = (label: string, value: string, setValue: (v: string) => void, placeholder: string, opts?: { calendar?: boolean }) =>
    React.createElement('div', {
      style: { display: 'flex', flexDirection: 'column' as const, flex: '1 1 0', minWidth: 0 },
    },
      React.createElement('div', { style: labelStyle }, label),
      opts?.calendar
        ? React.createElement('button', {
            type: 'button',
            style: {
              ...inputStyle,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              cursor: 'pointer',
              color: value ? '#0d0d0d' : '#767676',
              textAlign: 'left' as const,
              padding: '0 16px',
            },
          },
            calendarSvg,
            React.createElement('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const } }, value || placeholder))
        : React.createElement('input', {
            type: 'text',
            value,
            placeholder,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setValue(e.target.value),
            style: { ...inputStyle, color: value ? '#0d0d0d' : '#767676' },
          }));

  if (!open) return null;

  return React.createElement('div', {
    role: 'dialog',
    'aria-modal': true,
    'aria-labelledby': 'edit-tabela-trecho-titulo',
    style: overlayStyle,
    onClick: fechar,
  },
    React.createElement('div', {
      style: {
        background: '#fff',
        borderRadius: 16,
        boxShadow: '6px 6px 12px 0 rgba(0,0,0,0.15)',
        width: '100%',
        maxWidth: 560,
        maxHeight: '90vh',
        overflowY: 'auto' as const,
        display: 'flex',
        flexDirection: 'column' as const,
        gap: 24,
        padding: '24px 0',
        boxSizing: 'border-box' as const,
      },
      onClick: (e: React.MouseEvent) => e.stopPropagation(),
    },
      // Header
      React.createElement('div', { style: { borderBottom: '1px solid #e2e2e2', paddingBottom: 24, width: '100%' } },
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', width: '100%', boxSizing: 'border-box' as const } },
          React.createElement('h2', { id: 'edit-tabela-trecho-titulo', style: { fontSize: 20, fontWeight: 600, color: '#0d0d0d', margin: 0, lineHeight: 1.25, ...font } }, 'Editar tabela'),
          React.createElement('button', {
            type: 'button',
            onClick: fechar,
            'aria-label': 'Fechar',
            style: {
              width: 48, height: 48, borderRadius: '50%', border: 'none', background: '#f1f1f1', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0,
            },
          }, closeModalSvg))),

      // Form body
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 24, width: '100%' } },
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 16, padding: '0 16px', width: '100%', boxSizing: 'border-box' as const } },

          // Trecho section
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8, width: '100%' } },
            React.createElement('span', { style: { fontSize: 18, fontWeight: 600, color: '#0d0d0d', lineHeight: 1.5, ...font } }, 'Trecho'),

            // Origem + Destino
            React.createElement('div', { style: { display: 'flex', gap: 12, width: '100%' } },
              field('Origem', origem, setOrigem, 'Ex: São Paulo - SP'),
              field('Destino', destino, setDestino, 'Ex: Campinas - SP')),

            // Valor do trecho
            field('Valor do trecho (R$)', valor, setValor, 'Ex: R$ 250,00'),

            // Data e hora ida + retorno
            React.createElement('div', { style: { display: 'flex', gap: 12, width: '100%' } },
              field('Data e hora de ida', dataHoraIda, setDataHoraIda, '15/02/2025 - 08:00', { calendar: true }),
              field('Data e hora de retorno', dataHoraRetorno, setDataHoraRetorno, '15/02/2025 - 18:00', { calendar: true })),

            // % ganho motorista + admin
            React.createElement('div', { style: { display: 'flex', gap: 12, width: '100%' } },
              field('% de ganho do motorista', pctMotorista, setPctMotorista, '15 %'),
              field('% de ganho do admin', pctAdmin, setPctAdmin, '5 %')))),

        // CTA buttons
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 10, padding: '0 23px', width: '100%', boxSizing: 'border-box' as const } },
          React.createElement('button', {
            type: 'button',
            onClick: salvar,
            style: {
              width: '100%', height: 48, borderRadius: 8, border: 'none', background: '#0d0d0d', color: '#fff',
              fontSize: 16, fontWeight: 500, lineHeight: 1.5, cursor: 'pointer', ...font,
            },
          }, 'Salvar alterações'),
          React.createElement('button', {
            type: 'button',
            onClick: fechar,
            style: {
              width: '100%', height: 48, borderRadius: 8, border: 'none', background: '#f1f1f1', color: '#b53838',
              fontSize: 16, fontWeight: 500, lineHeight: 1.5, cursor: 'pointer', ...font,
            },
          }, 'Cancelar')))));
}
