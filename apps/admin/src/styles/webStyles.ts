import React from 'react';

// ── Types ──────────────────────────────────────────────────────────────
export type ViagemRow = { passageiro: string; origem: string; destino: string; data: string; embarque: string; chegada: string; status: 'concluído' | 'cancelado' | 'agendado' | 'em_andamento' | 'pendente' };
export type DetailTimelineIconType = 'clock' | 'origin' | 'destination' | 'inventory';
export type DetailTimelineItem = { id: string; icon: DetailTimelineIconType; label: string; value: string; showConnectorAfter?: boolean };

/** Altura do mapa na faixa detalhe/editar viagem (alinha com a coluna da timeline). */
export const DETAIL_TRIP_MAP_HEIGHT = 392;

// ── Logo helpers ───────────────────────────────────────────────────────
const logoAdminAsset = require('../../assets/logo-admin.png');
const logoAsset = require('../../assets/logo.png');
const logoFigmaAsset = require('../../assets/logo1.png');

export function getLogoWebSrc(asset: unknown): string | null {
  if (typeof asset === 'string') return asset;
  if (asset && typeof asset === 'object') {
    const u = (asset as { uri?: string; default?: string }).uri ?? (asset as { default?: string }).default;
    if (typeof u === 'string') return u;
  }
  return null;
}

export function getLogoSrc(): string | null {
  return getLogoWebSrc(logoAdminAsset) ?? getLogoWebSrc(logoFigmaAsset) ?? getLogoWebSrc(logoAsset);
}

// ── SVG Icons ──────────────────────────────────────────────────────────
export const logoArrowSvg = React.createElement('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } }, React.createElement('path', { d: 'M7 17L17 7M17 7h-8M17 7v8', stroke: '#F59E0B', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));

/** Ícone my_location (Material) — Figma 844:17526, branco 20×20 */
export const liveFollowMyLocationSvg = React.createElement(
  'svg',
  {
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: '#ffffff',
    style: { display: 'block', flexShrink: 0 },
    'aria-hidden': true,
  },
  React.createElement('path', {
    d: 'M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3A8.001 8.001 0 0013 3.06V1h-2v2.06A8.001 8.001 0 003.06 11H1v2h2.06A8.001 8.001 0 0011 20.94V23h2v-2.06A8.001 8.001 0 0020.94 13H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z',
  }),
);
export const logoArrowSmallSvg = React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block', flexShrink: 0 } }, React.createElement('path', { d: 'M7 17L17 7M17 7h-8M17 7v8', stroke: '#F59E0B', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
export const searchIconSvg = React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 20 20', fill: 'none', style: { display: 'block' } }, React.createElement('path', { d: 'M9 17A8 8 0 1 0 9 1a8 8 0 0 0 0 16zm0-2a6 6 0 1 1 0-12 6 6 0 0 1 0 12z', fill: '#767676' }), React.createElement('path', { d: 'M19 19l-4.35-4.35', stroke: '#767676', strokeWidth: 2, strokeLinecap: 'round' }));
export const chevronDownSvg = React.createElement('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } }, React.createElement('path', { d: 'M8 10l4 4 4-4', stroke: '#545454', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
export const filterIconSvg = React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } }, React.createElement('path', { d: 'M3 6h18M7 12h10M11 18h2', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round' }));
export const infoIconSvg = React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } }, React.createElement('circle', { cx: 12, cy: 12, r: 10, stroke: '#cba04b', strokeWidth: 2 }), React.createElement('path', { d: 'M12 16v-4M12 8h.01', stroke: '#cba04b', strokeWidth: 2, strokeLinecap: 'round' }));
export const arrowForwardSvg = React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } }, React.createElement('path', { d: 'M5 12h14M12 5l7 7-7 7', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
export const calendarIconSvg = React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } }, React.createElement('path', { d: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z', stroke: '#767676', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
export const editIconSvg = React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } }, React.createElement('path', { d: 'M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }), React.createElement('path', { d: 'M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
export const listBulletedSvg = React.createElement('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } }, React.createElement('path', { d: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
export const checkCircleSvg = React.createElement('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } }, React.createElement('path', { d: 'M22 11.08V12a10 10 0 11-5.93-9.14', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }), React.createElement('path', { d: 'M22 4L12 14.01l-3-3', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
export const calendarTodaySvg = React.createElement('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } }, React.createElement('path', { d: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
export const nearMeSvg = React.createElement('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } }, React.createElement('path', { d: 'M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71L12 2z', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
export const cancelSvg = React.createElement('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } }, React.createElement('circle', { cx: 12, cy: 12, r: 10, stroke: '#0d0d0d', strokeWidth: 2 }), React.createElement('path', { d: 'M15 9l-6 6M9 9l6 6', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
export const visibilitySvg = React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } }, React.createElement('path', { d: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }), React.createElement('circle', { cx: 12, cy: 12, r: 3, stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
export const closeIconSvg = React.createElement('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } }, React.createElement('path', { d: 'M18 6L6 18M6 6l12 12', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
export const arrowBackSvg = React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } }, React.createElement('path', { d: 'M19 12H5M12 19l-7-7 7-7', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
export const receiptSvg = React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } }, React.createElement('path', { d: 'M9 14l6-6M15 14l-6-6', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }), React.createElement('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2, stroke: '#0d0d0d', strokeWidth: 2 }));
export const starSvg = React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } }, React.createElement('path', { d: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
export const chartLineSvg = React.createElement('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } }, React.createElement('path', { d: 'M3 17l6-6-6-6', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }), React.createElement('path', { d: 'M12 19h9', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round' }));

// Timeline icons (Figma 792-1597)
const iconColor = '#767676';
export const detailTimelineIcons: Record<DetailTimelineIconType, React.ReactNode> = {
  clock: React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
    React.createElement('circle', { cx: 12, cy: 12, r: 10, stroke: iconColor, strokeWidth: 1.5 }),
    React.createElement('path', { d: 'M12 6v6l4 2', stroke: iconColor, strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' })),
  origin: React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
    React.createElement('circle', { cx: 12, cy: 12, r: 10, stroke: iconColor, strokeWidth: 1.5 }),
    React.createElement('circle', { cx: 12, cy: 12, r: 3, fill: iconColor })),
  destination: React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
    React.createElement('rect', { x: 6, y: 6, width: 12, height: 12, rx: 2, stroke: iconColor, strokeWidth: 1.5 })),
  inventory: React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
    React.createElement('path', { d: 'M20 8H4V6h16v2zM4 20h16v-2H4v2zm0-6h16v-2H4v2z', stroke: iconColor, strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' })),
};
export const timeSvg = detailTimelineIcons.clock;
export const inventorySvgLight = React.createElement('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } }, React.createElement('path', { d: 'M20 8H4V6h16v2zM4 20h16v-2H4v2zm0-6h16v-2H4v2z', stroke: '#0d0d0d', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));

// Outline gray icons for Motorista card (Figma 792-15711)
const iconGray = '#767676';
export const peopleOutlineSvg = React.createElement('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } }, React.createElement('path', { d: 'M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z', stroke: iconGray, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
export const locationOnOutlineSvg = React.createElement('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } }, React.createElement('path', { d: 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z', stroke: iconGray, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }), React.createElement('circle', { cx: 12, cy: 10, r: 3, stroke: iconGray, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
export const accessTimeOutlineSvg = React.createElement('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } }, React.createElement('circle', { cx: 12, cy: 12, r: 10, stroke: iconGray, strokeWidth: 2 }), React.createElement('path', { d: 'M12 6v6l4 2', stroke: iconGray, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
export const inventoryOutlineSvg = React.createElement('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } }, React.createElement('path', { d: 'M20 8H4V6h16v2zM4 20h16v-2H4v2zm0-6h16v-2H4v2z', stroke: iconGray, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));

// Eye / visibility icons for password fields
export const visibilityOffSvg = React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 20 20', fill: 'none', style: { display: 'block', flex: 1 } }, React.createElement('g', { clipPath: 'url(#clip0_visibility)' }, React.createElement('path', { d: 'M9.99992 5C13.1583 5 15.9749 6.77501 17.3499 9.58334C16.8583 10.6 16.1666 11.475 15.3416 12.1833L16.5166 13.3583C17.6749 12.3333 18.5916 11.05 19.1666 9.58334C17.7249 5.92501 14.1666 3.33334 9.99992 3.33334C8.94159 3.33334 7.92492 3.50001 6.96659 3.80834L8.34159 5.18334C8.88325 5.075 9.43325 5 9.99992 5ZM9.10825 5.95L10.8333 7.67501C11.3083 7.88334 11.6916 8.26667 11.8999 8.74167L13.6249 10.4667C13.6916 10.1833 13.7416 9.88334 13.7416 9.575C13.7499 7.50834 12.0666 5.83334 9.99992 5.83334C9.69159 5.83334 9.39992 5.875 9.10825 5.95ZM1.67492 3.225L3.90825 5.45834C2.54992 6.52501 1.47492 7.94167 0.833252 9.58334C2.27492 13.2417 5.83325 15.8333 9.99992 15.8333C11.2666 15.8333 12.4833 15.5917 13.5999 15.15L16.4499 18L17.6249 16.825L2.84992 2.04167L1.67492 3.225ZM7.92492 9.475L10.0999 11.65C10.0666 11.6583 10.0333 11.6667 9.99992 11.6667C8.84992 11.6667 7.91659 10.7333 7.91659 9.58334C7.91659 9.54167 7.92492 9.51667 7.92492 9.475V9.475ZM5.09159 6.64167L6.54992 8.10001C6.35825 8.55834 6.24992 9.05834 6.24992 9.58334C6.24992 11.65 7.93325 13.3333 9.99992 13.3333C10.5249 13.3333 11.0249 13.225 11.4749 13.0333L12.2916 13.85C11.5583 14.05 10.7916 14.1667 9.99992 14.1667C6.84159 14.1667 4.02492 12.3917 2.64992 9.58334C3.23325 8.39167 4.08325 7.40834 5.09159 6.64167Z', fill: '#767676' })), React.createElement('defs', null, React.createElement('clipPath', { id: 'clip0_visibility' }, React.createElement('rect', { width: 20, height: 20, fill: 'white' }))));
export const eyeOpenSvg = React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } }, React.createElement('path', { d: 'M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17a5 5 0 110-10 5 5 0 010 10zm0-8a3 3 0 100 6 3 3 0 000-6z', fill: '#767676' }));
export const eyeSvg = (hidden: boolean) => (hidden ? visibilityOffSvg : eyeOpenSvg);

// ── Logo element builder ───────────────────────────────────────────────
export function Logo({ style }: { style?: React.CSSProperties } = {}) {
  const logoSrc = getLogoSrc();
  return logoSrc
    ? React.createElement('img', { src: logoSrc, alt: 'Take Me', style: style ?? webStyles.logoImgWide })
    : React.createElement('div', { style: webStyles.logoPlaceholder },
        React.createElement('div', { style: webStyles.logoPlaceholderIcon }, logoArrowSvg),
        React.createElement('div', { style: webStyles.logoPlaceholderText },
          React.createElement('span', { style: webStyles.logoPlaceholderTake }, 'Take '),
          React.createElement('span', { style: webStyles.logoPlaceholderMe }, 'Me')));
}

// ── Status helpers ─────────────────────────────────────────────────────
export const statusStyles: Record<string, { bg: string; color: string }> = {
  'concluído': { bg: '#b0e8d1', color: '#174f38' },
  cancelado: { bg: '#eeafaa', color: '#551611' },
  agendado: { bg: '#a8c6ef', color: '#102d57' },
  em_andamento: { bg: '#fee59a', color: '#654c01' },
  pendente: { bg: '#ffd9b3', color: '#7a3e00' },
};
export const statusLabels: Record<string, string> = { 'concluído': 'Concluído', cancelado: 'Cancelado', agendado: 'Agendado', em_andamento: 'Em andamento', pendente: 'Pendente' };
export const statusPill = (label: string, bg: string, color: string) =>
  React.createElement('span', { style: { ...webStyles.viagensStatusPill, background: bg, color } }, label);

// Estilos alinhados ao Figma: Take Me - Partiu (node 652-30788)
export const webStyles = {
  _25login: { width: '100%', minHeight: '100vh', height: '100%', backgroundColor: 'var(--brand-light-neutral-100, #ffffff)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' as const },
  login: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', minHeight: '100%', flex: '1 1 0%', boxSizing: 'border-box' as const },
  content: { display: 'flex', flexDirection: 'column', gap: 32, alignItems: 'center', justifyContent: 'center', width: '100%', flex: '1 0 0', minWidth: 0, minHeight: 0, boxSizing: 'border-box' as const },
  frame427321193: { display: 'flex', flexDirection: 'column', gap: 32, alignItems: 'center', width: '100%', maxWidth: 580, boxSizing: 'border-box' as const },
  logo: { display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 0, height: 67, boxSizing: 'border-box' as const },
  logoImg: { width: 69, height: 67, objectFit: 'cover' as const, flexShrink: 0 },
  logoImgWide: { height: 67, width: 'auto', maxWidth: 200, objectFit: 'contain' as const, flexShrink: 0 },
  frame9: { display: 'flex', flexDirection: 'column', gap: 32, alignItems: 'center', width: '100%', maxWidth: 580, boxSizing: 'border-box' as const },
  frame7: { display: 'flex', flexDirection: 'column', gap: 32, alignItems: 'center', width: '100%', boxSizing: 'border-box' as const },
  frame5: { display: 'flex', flexDirection: 'column', gap: 40, alignItems: 'center', justifyContent: 'center', width: '100%', boxSizing: 'border-box' as const },
  frame3: { display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', width: '100%', boxSizing: 'border-box' as const },
  title: { color: 'var(--brand-black-black-500, #0d0d0d)', textAlign: 'center' as const, fontFamily: 'Inter, sans-serif', fontSize: 24, fontWeight: 600, lineHeight: 'normal', width: '100%' },
  frame4: { display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start', width: '100%', maxWidth: 580, boxSizing: 'border-box' as const },
  textField: { display: 'flex', flexDirection: 'column', width: '100%', height: 48, borderRadius: 8, background: 'var(--brand-light-neutral-300, #f1f1f1)', overflow: 'hidden' as const, boxSizing: 'border-box' as const },
  inputInner: { flex: '1 0 0', display: 'flex', flexDirection: 'row', alignItems: 'center', padding: '2px 4px 0 16px', minHeight: 40, minWidth: 0, boxSizing: 'border-box' as const },
  input: {
    flex: '1 0 0',
    border: 'none',
    outline: 'none',
    background: 'transparent',
    color: '#333',
    fontSize: 16,
    lineHeight: 1.5,
    fontWeight: 400,
    fontFamily: 'Inter, sans-serif',
    minWidth: 0,
  } as React.CSSProperties,
  inputPlaceholder: { color: 'var(--brand-light-neutral-700, #767676)' },
  actionContainer: { padding: '0 4px 0 0', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' },
  iconButton: { padding: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, cursor: 'pointer', background: 'none', border: 'none' },
  link: { borderRadius: 8, padding: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 40, cursor: 'pointer', background: 'none', border: 'none', color: 'var(--brand-black-black-500, #0d0d0d)', fontSize: 14, lineHeight: 1.5, fontWeight: 500, fontFamily: 'Inter, sans-serif' },
  cta: { display: 'flex', flexDirection: 'column', alignItems: 'center', alignSelf: 'center', width: '100%', maxWidth: 358, boxSizing: 'border-box' as const },
  primaryBtn: {
    width: '100%',
    background: 'var(--brand-black-black-500, #0d0d0d)',
    borderRadius: 8,
    padding: '12px 16px',
    height: 48,
    minWidth: 104,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    border: 'none',
    cursor: 'pointer',
    color: 'var(--brand-light-neutral-100, #ffffff)',
    fontSize: 16,
    lineHeight: 1.5,
    fontWeight: 500,
    fontFamily: 'Inter, sans-serif',
    boxSizing: 'border-box' as const,
  },
  secondaryBtn: {
    width: '100%',
    background: 'transparent',
    borderRadius: 8,
    padding: '12px 16px',
    height: 48,
    marginTop: 12,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '2px solid var(--brand-black-black-500, #0d0d0d)',
    cursor: 'pointer',
    color: 'var(--brand-black-black-500, #0d0d0d)',
    fontSize: 16,
    lineHeight: 1.5,
    fontWeight: 500,
    fontFamily: 'Inter, sans-serif',
    boxSizing: 'border-box' as const,
  },
  inputError: { outline: '2px solid #DC2626', outlineOffset: -2 },
  errorText: { fontSize: 12, color: '#DC2626', marginTop: 4 },
  passwordRow: { position: 'relative' as const, display: 'flex', flexDirection: 'column', width: '100%', height: 48, borderRadius: 8, background: 'var(--brand-light-neutral-300, #f1f1f1)', overflow: 'hidden', boxSizing: 'border-box' as const },
  passwordInputWrap: { flex: '1 0 0', display: 'flex', flexDirection: 'row', alignItems: 'center', padding: '2px 4px 0 16px', minHeight: 40, minWidth: 0 },
  loading: { minHeight: '100vh', backgroundColor: '#ffffff', display: 'flex', justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#767676', fontSize: 16, fontFamily: 'Inter, sans-serif' },
  home: { minHeight: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' },
  homeText: { fontSize: 20, fontWeight: 600, color: '#000' },
  backBtn: { marginBottom: 20, cursor: 'pointer', background: 'none', border: 'none', padding: 0 },
  backArrow: { fontSize: 18, fontWeight: 600, color: '#000' },
  subtitle: { fontSize: 15, color: '#6B7280', marginBottom: 24 },
  sentText: { fontSize: 15, color: '#059669' },
  logoPlaceholder: { display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 0, height: 67 } as React.CSSProperties,
  logoPlaceholderIcon: { width: 69, height: 67, borderRadius: 8, background: 'var(--brand-light-neutral-300, #f1f1f1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 } as React.CSSProperties,
  logoPlaceholderText: { fontSize: 20, color: 'var(--brand-black-black-500, #0d0d0d)', lineHeight: 1.2, fontFamily: 'Inter, sans-serif', display: 'flex', alignItems: 'center' } as React.CSSProperties,
  logoPlaceholderTake: { fontWeight: 700 },
  logoPlaceholderMe: { fontWeight: 400 },
  outer: { minHeight: '100vh', backgroundColor: '#ffffff', display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 24, boxSizing: 'border-box' as const },
  card: { backgroundColor: '#FFFFFF', padding: 40, width: '100%', maxWidth: 400, boxSizing: 'border-box' as const },
  // Home + Header (Figma 675-18609, 849-30354)
  homePage: { width: '100%', height: '100vh', minHeight: '100vh', overflowY: 'auto' as const, overflowX: 'hidden' as const, backgroundColor: '#ffffff', position: 'relative' as const, boxSizing: 'border-box' as const, WebkitOverflowScrolling: 'touch' as const },
  navbar: {
    position: 'sticky' as const, top: 0, zIndex: 10,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: '100%', padding: '32px 24px 16px',
    backgroundColor: '#ffffff', borderBottom: '1px solid #e2e2e2', boxShadow: '0px 2px 5px 0px rgba(0,0,0,0.05)',
    boxSizing: 'border-box' as const,
  },
  navbarInner: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', maxWidth: 1233, gap: 8 },
  navLogo: { display: 'flex', alignItems: 'center', gap: 0, flexShrink: 0, position: 'relative' as const, zIndex: 0 },
  /** Centralizado na faixa entre logo e user; quantidade de abas vem do Layout (ResizeObserver). */
  navTabs: { display: 'flex', flex: '1 1 0', alignItems: 'center', justifyContent: 'center', minWidth: 0, gap: 0, overflow: 'visible' as const, position: 'relative' as const, zIndex: 1 },
  navTabGroup: { display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'nowrap' as const, gap: 0, minWidth: 0 },
  navTab: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end',
    height: 48, padding: '14px 8px', cursor: 'pointer', background: 'none', border: 'none',
    fontFamily: 'Inter, sans-serif', fontSize: 13, lineHeight: 1.5, color: '#767676',
    boxSizing: 'border-box' as const, whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,
  navTabActive: { fontWeight: 600, color: '#a37e38' } as React.CSSProperties,
  userBlock: { display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 },
  userButton: { display: 'flex', alignItems: 'center', gap: 10, height: 40, cursor: 'pointer', background: 'none', border: 'none', padding: 0 },
  avatar: { width: 40, height: 40, borderRadius: '50%', backgroundColor: '#e2e2e2', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' as const },
  avatarLetter: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', fontFamily: 'Inter, sans-serif' },
  userDetails: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'space-between', minWidth: 0 },
  userName: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', lineHeight: 1.5, fontFamily: 'Inter, sans-serif' },
  userEmail: { fontSize: 14, fontWeight: 400, color: '#545454', lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis' as const, whiteSpace: 'nowrap' as const, maxWidth: 165, fontFamily: 'Inter, sans-serif' },
  chevronDown: { width: 24, height: 24, transform: 'rotate(90deg)', flexShrink: 0 },
  homeContent: { maxWidth: 1044, margin: '0 auto', padding: '24px 24px 64px', display: 'flex', flexDirection: 'column', gap: 24, alignItems: 'stretch', boxSizing: 'border-box' as const },
  homeTitle: { fontSize: 24, fontWeight: 600, color: '#0d0d0d', lineHeight: 'normal', margin: 0, fontFamily: 'Inter, sans-serif' },
  subTabsWrap: { display: 'flex', flexDirection: 'column', width: '100%' },
  subTabs: { display: 'flex', alignItems: 'flex-start', width: '100%', borderBottom: '1px solid #e2e2e2' },
  subTab: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', flex: '1 0 0',
    height: 48, padding: '14px 16px', cursor: 'pointer', background: 'none', border: 'none',
    fontFamily: 'Inter, sans-serif', fontSize: 16, lineHeight: 1.5, color: '#767676', position: 'relative' as const,
    boxSizing: 'border-box' as const,
  } as React.CSSProperties,
  subTabActive: { fontWeight: 600, color: '#0d0d0d' },
  subTabIndicator: { position: 'absolute' as const, bottom: 0, left: 0, right: 0, height: 2, backgroundColor: '#0d0d0d', borderRadius: 100 },
  searchRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 16, flexWrap: 'wrap' as const },
  searchInputWrap: { flex: '1 1 200px', minWidth: 200, maxWidth: 358 },
  searchInput: {
    width: '100%', height: 44, padding: '10px 16px 10px 40px', borderRadius: 99, border: 'none', outline: 'none',
    background: '#f1f1f1', fontSize: 16, color: '#333', fontFamily: 'Inter, sans-serif',
    boxSizing: 'border-box' as const,
  } as React.CSSProperties,
  searchInputInner: { position: 'relative' as const, width: '100%' },
  searchIcon: { position: 'absolute' as const, left: 16, top: '50%', transform: 'translateY(-50%)', width: 20, height: 20, pointerEvents: 'none' as const },
  filterGroup: { display: 'flex', alignItems: 'center', gap: 16 },
  filterBtn: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 44, minWidth: 104, padding: '8px 24px',
    background: '#f1f1f1', border: 'none', borderRadius: 999, cursor: 'pointer',
    fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: 500, color: '#0d0d0d',
    boxSizing: 'border-box' as const,
  } as React.CSSProperties,
  expenseCard: {
    display: 'flex', gap: 16, alignItems: 'flex-start', padding: '12px 8px 12px 16px', borderRadius: 8,
    background: '#fff8e6', border: '0.5px solid #cba04b', boxShadow: '0px 4px 20px 0px rgba(13,13,13,0.04)',
    width: '100%', boxSizing: 'border-box' as const,
  },
  expenseCardIcon: { width: 16, height: 16, flexShrink: 0 },
  expenseCardBody: { flex: '1 0 0', minWidth: 0 },
  expenseCardTitle: { fontSize: 14, fontWeight: 600, color: '#0d0d0d', marginBottom: 4, fontFamily: 'Inter, sans-serif' },
  expenseCardDesc: { fontSize: 14, fontWeight: 400, color: '#767676', lineHeight: 1.5, marginBottom: 12, fontFamily: 'Inter, sans-serif' },
  expenseCardLabel: { fontSize: 14, fontWeight: 400, color: '#767676', marginBottom: 4, fontFamily: 'Inter, sans-serif' },
  expenseCardValue: { fontSize: 20, fontWeight: 600, color: '#0d0d0d', fontFamily: 'Inter, sans-serif' },
  expenseCardLink: {
    display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 8, padding: '8px 24px 8px 8px',
    background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: 600, color: '#0d0d0d',
  },
  statCardsRow: { display: 'flex', gap: 24, width: '100%', flexWrap: 'wrap' as const, justifyContent: 'flex-start' },
  statCard: {
    flex: '1 1 180px', minWidth: 180, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-start',
    padding: '16px 24px', borderRadius: 16, background: '#f6f6f6', boxSizing: 'border-box' as const,
  },
  statCardHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', paddingBottom: 16 },
  statCardTitle: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', fontFamily: 'Inter, sans-serif' },
  statCardChange: { fontSize: 14, fontWeight: 600, fontFamily: 'Inter, sans-serif' },
  statCardChangePos: { color: '#0b6d39' },
  statCardChangeNeg: { color: '#b53838' },
  statCardValue: { fontSize: 32, fontWeight: 700, color: '#0d0d0d', fontFamily: 'Inter, sans-serif', alignSelf: 'flex-start' },
  chartCard: {
    display: 'flex', flexDirection: 'column', gap: 40, padding: 24, borderRadius: 16, background: '#f6f6f6', width: '100%', boxSizing: 'border-box' as const,
  },
  chartCardTitle: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', margin: 0, fontFamily: 'Inter, sans-serif' },
  chartCardDesc: { fontSize: 14, fontWeight: 400, color: '#767676', lineHeight: 1.5, marginTop: 4, fontFamily: 'Inter, sans-serif' },
  chartRow: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 56, flexWrap: 'wrap' as const },
  chartLegend: { display: 'flex', flexDirection: 'column', gap: 24 },
  chartLegendItem: { display: 'flex', alignItems: 'center', gap: 8 },
  chartLegendDot: { width: 20, height: 20, borderRadius: '50%', flexShrink: 0 },
  chartLegendText: { fontSize: 16, fontWeight: 400, color: '#0d0d0d', fontFamily: 'Inter, sans-serif' },
  chartTotal: { fontSize: 20, fontWeight: 600, color: '#0d0d0d', fontFamily: 'Inter, sans-serif' },
  // Modal Filtro (Figma 756-19720)
  modalOverlay: {
    position: 'fixed' as const, inset: 0, zIndex: 100,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)', padding: 24, boxSizing: 'border-box' as const,
  },
  modalBox: {
    display: 'flex', flexDirection: 'column', gap: 24, alignItems: 'stretch', justifyContent: 'flex-start',
    backgroundColor: '#ffffff', borderRadius: 16, boxShadow: '6px 6px 12px 0 rgba(0,0,0,0.15)',
    padding: '24px 0', width: '100%', minWidth: 0, maxWidth: 400, maxHeight: '90vh', overflowY: 'auto' as const, boxSizing: 'border-box' as const,
  },
  modalHeader: {
    borderBottom: '1px solid #e2e2e2', paddingBottom: 24, paddingLeft: 16, paddingRight: 16,
    width: '100%', boxSizing: 'border-box' as const,
  },
  modalHeaderRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', paddingLeft: 16, paddingRight: 16, boxSizing: 'border-box' as const,
  },
  // Header do Filtro Início (756-19720): título centralizado, X à direita
  modalHeaderRowInicio: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' as const, width: '100%', paddingLeft: 16, paddingRight: 16, boxSizing: 'border-box' as const,
  },
  modalTitle: { fontSize: 20, fontWeight: 600, color: '#0d0d0d', margin: 0, fontFamily: 'Inter, sans-serif' },
  modalTitleCentered: { fontSize: 20, fontWeight: 600, color: '#0d0d0d', margin: 0, fontFamily: 'Inter, sans-serif', textAlign: 'center' as const },
  modalCloseBtnAbsolute: { position: 'absolute' as const, right: 16, top: '50%', transform: 'translateY(-50%)', width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f1f1', border: 'none', borderRadius: '50%', cursor: 'pointer', padding: 0 } as React.CSSProperties,
  modalCloseBtn: {
    width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#f1f1f1', border: 'none', borderRadius: '50%', cursor: 'pointer', padding: 0,
  } as React.CSSProperties,
  modalRadioRow: { display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '11px 12px 9px 0', borderRadius: 6, cursor: 'pointer', border: 'none', background: 'none' as const },
  modalRadioCircle: { width: 20, height: 20, borderRadius: '50%', border: '2px solid #0d0d0d', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' as const },
  modalRadioCircleChecked: { borderColor: '#0d0d0d', background: '#0d0d0d' },
  modalRadioCircleDot: { width: 8, height: 8, borderRadius: '50%', background: '#ffffff' },
  modalRadioLabel: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', fontFamily: 'Inter, sans-serif' },
  modalSecondaryBtn: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', height: 48, width: '100%',
    background: 'none', border: 'none', borderRadius: 8, cursor: 'pointer',
    fontFamily: 'Inter, sans-serif', fontSize: 16, fontWeight: 500, color: '#0d0d0d',
    boxSizing: 'border-box' as const,
  } as React.CSSProperties,
  // —— Sistema unificado de modais (QA design) ——
  // Padding horizontal só no box do modal; seções sem padding lateral = alinhamento idêntico
  modalSection: { display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'stretch', width: '100%', minWidth: 0, boxSizing: 'border-box' as const },
  modalSectionGap12: { display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'stretch', width: '100%', minWidth: 0, boxSizing: 'border-box' as const },
  modalSectionTitle: { fontSize: 18, fontWeight: 600, color: '#0d0d0d', margin: 0, fontFamily: 'Inter, sans-serif', width: '100%' },
  modalDateField: { display: 'flex', flexDirection: 'column', gap: 4, width: '100%' },
  modalDateLabel: { fontSize: 14, fontWeight: 500, color: '#0d0d0d', fontFamily: 'Inter, sans-serif' },
  modalDateInput: {
    display: 'flex', alignItems: 'center', height: 44, paddingLeft: 40, paddingRight: 16,
    background: '#f1f1f1', border: 'none', borderRadius: 8, fontSize: 16, color: '#333', fontFamily: 'Inter, sans-serif',
    boxSizing: 'border-box' as const, width: '100%',
  } as React.CSSProperties,
  modalDateInputWrap: { position: 'relative' as const, width: '100%' },
  modalDateIcon: { position: 'absolute' as const, left: 16, top: '50%', transform: 'translateY(-50%)', width: 20, height: 20, pointerEvents: 'none' as const },
  modalChips: { display: 'flex', flexWrap: 'wrap' as const, gap: 16, width: '100%' },
  modalChip: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', height: 40, paddingLeft: 16, paddingRight: 16,
    border: 'none', borderRadius: 90, cursor: 'pointer', fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: 500,
    boxSizing: 'border-box' as const,
  } as React.CSSProperties,
  modalChipActive: { background: '#0d0d0d', color: '#ffffff' },
  modalChipInactive: { background: '#f1f1f1', color: '#0d0d0d' },
  modalApplyBtn: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', height: 48, width: '100%',
    background: '#0d0d0d', border: 'none', borderRadius: 8, cursor: 'pointer',
    fontFamily: 'Inter, sans-serif', fontSize: 16, fontWeight: 500, color: '#ffffff',
    boxSizing: 'border-box' as const,
  } as React.CSSProperties,
  modalButtonWrap: { width: '100%', display: 'flex', flexDirection: 'column', gap: 10, boxSizing: 'border-box' as const },
  modalBoxInicio: {
    display: 'flex', flexDirection: 'column', gap: 24, alignItems: 'stretch', justifyContent: 'flex-start',
    backgroundColor: '#ffffff', borderRadius: 16, boxShadow: '6px 6px 12px 0 rgba(0,0,0,0.15)',
    padding: 24, width: '100%', minWidth: 0, maxWidth: 400, maxHeight: '90vh', overflowY: 'auto' as const, boxSizing: 'border-box' as const,
  } as React.CSSProperties,
  modalBoxViagens: {
    display: 'flex', flexDirection: 'column', gap: 24, alignItems: 'stretch', justifyContent: 'flex-start',
    backgroundColor: '#ffffff', borderRadius: 16, boxShadow: '6px 6px 12px 0 rgba(0,0,0,0.15)',
    padding: 24, width: '100%', minWidth: 0, maxWidth: 560, maxHeight: '90vh', overflowY: 'auto' as const, boxSizing: 'border-box' as const,
  } as React.CSSProperties,
  // Dropdown Take Me (Figma 1117-44610)
  dropdownWrap: { position: 'relative' as const, display: 'inline-block' },
  dropdownOverlay: { position: 'fixed' as const, inset: 0, zIndex: 98 },
  dropdownPopover: {
    position: 'absolute' as const, top: '100%', left: 0, marginTop: 4, zIndex: 99,
    display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0',
    backgroundColor: '#ffffff', borderRadius: 8, boxShadow: '6px 6px 12px 0 rgba(0,0,0,0.15)',
    minWidth: 200, boxSizing: 'border-box' as const,
  },
  dropdownOption: {
    display: 'flex', alignItems: 'center', padding: '10px 16px', width: '100%',
    border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left' as const,
    fontFamily: 'Inter, sans-serif', fontSize: 16, fontWeight: 400, lineHeight: 1.5, color: '#0d0d0d',
    boxSizing: 'border-box' as const,
  } as React.CSSProperties,
  // Página Viagens (Figma 763-21618)
  viagensMetricCard: {
    flex: '1 1 180px', minWidth: 180, display: 'flex', flexDirection: 'column', alignItems: 'stretch', justifyContent: 'flex-start',
    padding: '16px 24px', borderRadius: 16, background: '#f6f6f6', boxSizing: 'border-box' as const,
  },
  viagensMetricCardHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', paddingTop: 16 },
  viagensMetricCardTitle: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', fontFamily: 'Inter, sans-serif' },
  viagensMetricCardIcon: { width: 44, height: 44, borderRadius: '50%', background: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  viagensMetricCardValue: { fontSize: 40, fontWeight: 700, color: '#0d0d0d', fontFamily: 'Inter, sans-serif', paddingBottom: 16, alignSelf: 'flex-start', textAlign: 'left' as const },
  viagensChartCard: {
    display: 'flex', flexDirection: 'column', gap: 40, padding: 24, borderRadius: 16, background: '#f6f6f6', width: '100%', boxSizing: 'border-box' as const,
  },
  viagensChartLegendItem: { display: 'flex', alignItems: 'center', gap: 8 },
  viagensChartLegendDot: { width: 20, height: 20, borderRadius: '50%', flexShrink: 0 },
  viagensChartLegendText: { fontSize: 16, fontWeight: 400, color: '#0d0d0d', fontFamily: 'Inter, sans-serif' },
  // overflow hidden (não auto): quem rola é só o miolo da tabela — com o card
  // inteiro rolando, o título/Filtro e a paginação saíam da tela junto.
  viagensTableSection: { display: 'flex', flexDirection: 'column', gap: 0, width: '100%', borderRadius: 16, overflow: 'hidden' as const, background: '#ffffff', boxSizing: 'border-box' as const },
  viagensTableSectionHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 28px',
    background: '#f6f6f6', fontFamily: 'Inter, sans-serif', boxSizing: 'border-box' as const, height: 80,
  },
  // A largura mínima da tabela é DEFINIDA no screen (soma das colunas), igual
  // para cabeçalho e linhas: max-content deixava a linha mais larga que o
  // cabeçalho quando um nome longo não encolhia (min-width:auto de flex).
  viagensTableHeader: {
    display: 'flex', alignItems: 'center', height: 53, padding: '0 16px', background: '#e2e2e2', borderBottom: '1px solid #d9d9d9',
    fontSize: 12, fontWeight: 400, color: '#0d0d0d', fontFamily: 'Inter, sans-serif', boxSizing: 'border-box' as const,
  },
  viagensTableRow: {
    display: 'flex', alignItems: 'center', height: 64, padding: '0 16px', background: '#f6f6f6', borderBottom: '1px solid #d9d9d9',
    fontSize: 14, color: '#0d0d0d', fontFamily: 'Inter, sans-serif', boxSizing: 'border-box' as const,
  },
  viagensTableRowAlt: { background: '#ffffff' },
  viagensStatusPill: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '4px 12px', borderRadius: 999,
    fontSize: 13, fontWeight: 700, fontFamily: 'Inter, sans-serif', boxSizing: 'border-box' as const,
  },
  viagensPassengerCell: { display: 'flex', alignItems: 'center', gap: 12, minWidth: 193, padding: '0 8px', boxSizing: 'border-box' as const },
  viagensAvatar: { width: 40, height: 40, borderRadius: '50%', background: '#e2e2e2', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' as const },
  viagensActionIcons: { display: 'flex', alignItems: 'center', gap: 8 },
  viagensActionBtn: { width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', background: 'none', border: 'none', padding: 0 },
  // —— Detalhes da viagem (Figma 783-11090) ——
  detailPage: { display: 'flex', flexDirection: 'column', gap: 32, paddingBottom: 64, width: '100%', maxWidth: 1044, margin: '0 auto', boxSizing: 'border-box' as const },
  detailBreadcrumb: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, fontFamily: 'Inter, sans-serif', color: '#767676' },
  detailBreadcrumbCurrent: { color: '#0d0d0d' },
  detailToolbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', flexWrap: 'wrap' as const, gap: 16 },
  detailBackBtn: { display: 'flex', alignItems: 'center', gap: 8, height: 44, padding: '8px 24px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600, color: '#0d0d0d', fontFamily: 'Inter, sans-serif', borderRadius: 8 },
  detailDocBtns: { display: 'flex', alignItems: 'center', gap: 16 },
  detailDocBtn: { display: 'flex', alignItems: 'center', gap: 8, height: 44, minWidth: 104, padding: '8px 24px', background: '#f1f1f1', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600, color: '#0d0d0d', fontFamily: 'Inter, sans-serif', borderRadius: 999 },
  /** “Acompanhar em tempo real” — Figma 844:17525 (action container + my_location 20px) */
  detailLiveFollowBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 44,
    padding: '10px 16px',
    background: '#0d0d0d',
    border: 'none',
    borderRadius: 90,
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 500,
    color: '#ffffff',
    fontFamily: 'Inter, sans-serif',
    lineHeight: 1.5,
    boxSizing: 'border-box' as const,
  },
  detailMapTimelineRow: { display: 'flex', alignItems: 'stretch', gap: 24, width: '100%', flexWrap: 'wrap' as const },
  detailMapWrap: {
    flex: '1 1 400px',
    minWidth: 0,
    height: DETAIL_TRIP_MAP_HEIGHT,
    minHeight: DETAIL_TRIP_MAP_HEIGHT,
    borderRadius: 12,
    overflow: 'hidden',
    background: '#e8e8e8',
  },
  detailTimeline: { display: 'flex', flexDirection: 'column', gap: 16, width: '100%', maxWidth: 308, alignItems: 'flex-start' },
  detailTimelineBadgeWrap: { alignSelf: 'flex-start' },
  detailTimelineRows: { display: 'flex', flexDirection: 'column', gap: 8, width: '100%' },
  detailTimelineItem: { display: 'flex', alignItems: 'center', gap: 16, minHeight: 47 },
  detailTimelineIconCol: { display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: 24 },
  detailTimelineIcon: { width: 24, height: 24, borderRadius: '50%', background: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' as const },
  detailTimelineConnector: { width: 1.5, height: 32, backgroundColor: '#767676', flexShrink: 0 },
  detailTimelineTextBlock: { display: 'flex', flexDirection: 'column', gap: 2, minHeight: 47, justifyContent: 'center', flex: '1 1 0', minWidth: 0 },
  detailTimelineLabel: { fontSize: 14, fontWeight: 400, color: '#767676', fontFamily: 'Inter, sans-serif', margin: 0, lineHeight: 1.5 },
  detailTimelineValue: { fontSize: 16, fontWeight: 700, color: '#0d0d0d', fontFamily: 'Inter, sans-serif', margin: 0, lineHeight: 1.5 },
  detailSection: { borderBottom: '1px solid #e2e2e2', paddingBottom: 32, display: 'flex', flexDirection: 'column', gap: 16, width: '100%' },
  detailSectionTitle: { fontSize: 20, fontWeight: 600, color: '#0d0d0d', fontFamily: 'Inter, sans-serif', margin: 0 },
  detailResumoGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, width: '100%' },
  detailResumoItem: { display: 'flex', alignItems: 'center', gap: 16, minWidth: 0 },
  detailResumoIcon: { width: 40, height: 40, borderRadius: '50%', background: '#0d0d0d', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  detailResumoLabel: { fontSize: 14, color: '#767676', fontFamily: 'Inter, sans-serif' },
  detailResumoValue: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', fontFamily: 'Inter, sans-serif' },
  detailPerfCards: { display: 'flex', gap: 24, flexWrap: 'wrap' as const },
  detailPerfCard: { flex: '1 1 200px', minWidth: 0, background: '#f6f6f6', borderRadius: 16, padding: 24, display: 'flex', flexDirection: 'column', gap: 16 },
  detailPerfCardTitle: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', fontFamily: 'Inter, sans-serif' },
  detailPerfCardValue: { fontSize: 32, fontWeight: 700, color: '#0d0d0d', fontFamily: "'Open Sans', Inter, sans-serif", lineHeight: 1.5 },
  detailMotoristaCard: { background: '#f6f6f6', borderRadius: 12, padding: '24px 16px', display: 'flex', flexWrap: 'wrap' as const, alignItems: 'center', gap: 16 },
  detailMotoristaAvatar: { width: 56, height: 56, borderRadius: '50%', background: '#e2e2e2', flexShrink: 0 },
  detailMotoristaBadge: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', background: '#f1f1f1', borderRadius: 90, fontSize: 14, fontWeight: 600, color: '#0d0d0d', fontFamily: 'Inter, sans-serif' },
  detailMotoristaName: { fontSize: 16, fontWeight: 600, color: '#0d0d0d', fontFamily: 'Inter, sans-serif', width: '100%' },
  detailMotoristaRating: { fontSize: 14, color: '#545454', fontFamily: 'Inter, sans-serif' },
  detailMotoristaRatingMuted: { fontSize: 14, color: '#767676', fontFamily: 'Inter, sans-serif', fontWeight: 400 },
  detailMotoristaCardInner: { display: 'flex', flexDirection: 'column' as const, gap: 16, width: '100%' },
  detailMotoristaRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', width: '100%' },
  detailMotoristaDriverBlock: { display: 'flex', gap: 16, flexShrink: 0, width: 308, maxWidth: '100%' },
  detailMotoristaDriverInfo: { display: 'flex', flexDirection: 'column' as const, gap: 16, flex: '1 1 0', minWidth: 0 },
  detailMotoristaInfoGroup: { display: 'flex', gap: 16, alignItems: 'center', flexShrink: 0 },
  detailMotoristaInfoBlock: { display: 'flex', gap: 16, alignItems: 'center', flexShrink: 0 },
  detailMotoristaInfoIconWrap: { width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  detailMotoristaInfoText: { display: 'flex', flexDirection: 'column' as const, gap: 2, minWidth: 0 },
  detailMotoristaSpacer: { width: 308, flexShrink: 0, visibility: 'hidden' as const },
  detailPassageirosSection: { borderBottom: '1px solid #e2e2e2', paddingBottom: 32, width: '100%' },
  detailPassageiroCard: { background: '#f6f6f6', borderRadius: 12, padding: 16, display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 },
  detailPassageiroAvatar: { width: 48, height: 48, borderRadius: '50%', background: '#e2e2e2', flexShrink: 0 },
};
