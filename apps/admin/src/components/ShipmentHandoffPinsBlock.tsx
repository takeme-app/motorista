/**
 * ShipmentHandoffPinsBlock — bloco read-only de PINs de handoff de uma encomenda (shipment),
 * reutilizado em ViagemDetalheScreen (menu Viagens) e no painel de Encomendas (Editar/Detalhe).
 *
 * Com base (s.baseId) → cadeia A→B→C→D; sem base → coleta/entrega direta.
 * Uses React.createElement() calls (NOT JSX), igual ao restante do admin.
 *
 * Os helpers de PIN (chips) também são exportados para reuso (ex.: PINs de reserva).
 */
import React from 'react';
import type { TripShipmentListItem } from '../data/types';

export function fmtHandoffValidated(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '';
  }
}

/** Quatro células para exibir PIN de 4 dígitos no painel (suporte / auditoria). */
export function pinCharsForDisplay(code: string | null | undefined): string[] {
  const s = (code ?? '').trim();
  if (!s) return ['—', '—', '—', '—'];
  const chars = s.split('');
  const out: string[] = [];
  for (let i = 0; i < 4; i += 1) out.push(chars[i] ?? '—');
  return out;
}

export function adminPinChipRow(
  label: string,
  code: string | null | undefined,
  validatedAt: string | null | undefined,
  footnote?: string | null,
): React.ReactElement {
  const validated = fmtHandoffValidated(validatedAt ?? null);
  return React.createElement(
    'div',
    { key: label, style: { display: 'flex', flexDirection: 'column' as const, gap: 8 } },
    React.createElement(
      'div',
      { style: { fontSize: 12, color: '#767676', fontFamily: 'Inter, sans-serif', lineHeight: 1.4 } },
      label,
    ),
    React.createElement(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' as const } },
      React.createElement(
        'div',
        { style: { display: 'flex', gap: 6 } },
        ...pinCharsForDisplay(code).map((ch, i) =>
          React.createElement(
            'div',
            {
              key: `adm-pin-${label}-${i}`,
              style: {
                minWidth: 36,
                height: 44,
                borderRadius: 8,
                border: '1px solid #d4d4d4',
                background: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 18,
                fontWeight: 700,
                fontFamily: 'ui-monospace, Menlo, monospace',
                color: '#0d0d0d',
              },
            },
            ch,
          ),
        ),
      ),
      validated
        ? React.createElement(
            'span',
            { style: { fontSize: 12, color: '#15803d', fontWeight: 600, fontFamily: 'Inter, sans-serif' } },
            `Validado ${validated}`,
          )
        : null,
    ),
    footnote
      ? React.createElement(
          'div',
          { style: { fontSize: 11, color: '#a3a3a3', fontFamily: 'Inter, sans-serif', fontStyle: 'italic' as const } },
          footnote,
        )
      : null,
  );
}

/** Variante compacta do PIN dentro de cada card (vários passageiros, mesmo código da reserva). */
export function adminPinChipRowCompact(
  label: string,
  code: string | null | undefined,
  footnote?: string | null,
): React.ReactElement {
  return React.createElement(
    'div',
    { style: { display: 'flex', flexDirection: 'column' as const, gap: 6 } },
    React.createElement(
      'div',
      { style: { fontSize: 11, color: '#767676', fontFamily: 'Inter, sans-serif', lineHeight: 1.35 } },
      label,
    ),
    React.createElement(
      'div',
      { style: { display: 'flex', gap: 4 } },
      ...pinCharsForDisplay(code).map((ch, i) =>
        React.createElement(
          'div',
          {
            key: `adm-pc-${label}-${i}`,
            style: {
              minWidth: 28,
              height: 36,
              borderRadius: 6,
              border: '1px solid #d4d4d4',
              background: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 15,
              fontWeight: 700,
              fontFamily: 'ui-monospace, Menlo, monospace',
              color: '#0d0d0d',
            },
          },
          ch,
        ),
      ),
    ),
    footnote
      ? React.createElement(
          'div',
          { style: { fontSize: 10, color: '#a3a3a3', fontFamily: 'Inter, sans-serif', fontStyle: 'italic' as const, lineHeight: 1.35 } },
          footnote,
        )
      : null,
  );
}

/** Bloco read-only de PINs de handoff de uma encomenda. */
export function ShipmentHandoffPinsBlock(props: { shipment: TripShipmentListItem }): React.ReactElement {
  const s = props.shipment;
  return React.createElement(
    'div',
    {
      style: {
        borderTop: '1px solid #e2e2e2',
        paddingTop: 16,
        marginTop: 4,
        display: 'flex',
        flexDirection: 'column' as const,
        gap: 14,
      },
    },
    React.createElement(
      'div',
      { style: { fontSize: 14, fontWeight: 700, color: '#0d0d0d', fontFamily: 'Inter, sans-serif' } },
      s.baseId ? 'PINs de handoff (encomenda com base)' : 'PINs de handoff (sem base)',
    ),
    s.baseId
      ? React.createElement(
          React.Fragment,
          null,
          adminPinChipRow('PIN A — Passageiro → preparador', s.passengerToPreparerCode, s.pickedUpByPreparerAt),
          adminPinChipRow('PIN B — Preparador → base', s.preparerToBaseCode, s.deliveredToBaseAt),
          adminPinChipRow(
            'PIN C — Base → motorista',
            s.baseToDriverCode,
            s.baseToDriverConfirmedAt ?? s.pickedUpByDriverFromBaseAt,
          ),
          adminPinChipRow('PIN D — Motorista → destinatário', s.deliveryCode, s.deliveredAt),
          s.pickupCode?.trim()
            ? adminPinChipRow(
                'PIN coleta direta (gerado no registro)',
                s.pickupCode,
                null,
                'Com base, a cadeia validada é A→B→C→D; este código existe por compatibilidade técnica.',
              )
            : null,
        )
      : React.createElement(
          React.Fragment,
          null,
          adminPinChipRow('PIN — Coleta no remetente (motorista)', s.pickupCode, s.pickedUpAt),
          adminPinChipRow('PIN — Entrega ao destinatário', s.deliveryCode, s.deliveredAt),
        ),
  );
}
