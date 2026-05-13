import React, { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { webStyles } from '../styles/webStyles';
import { Logo } from './Logo';
import { chevronDownSvg, lockOutlineSvg, desktopOutlineSvg, settingsOutlineSvg, exitToAppSvg } from './icons';
import { useAuth } from '../contexts/AuthContext';
import { useAdminPermissions, PATH_TO_PERMISSION } from '../hooks/useAdminPermissions';

const font: React.CSSProperties = { fontFamily: 'Inter, sans-serif' };

const navTabsList = [
  { label: 'Início', path: '/' },
  { label: 'Viagens', path: '/viagens' },
  { label: 'Passageiros', path: '/passageiros' },
  { label: 'Motoristas', path: '/motoristas' },
  { label: 'Destinos', path: '/destinos' },
  { label: 'Encomendas', path: '/encomendas' },
  { label: 'Preparadores', path: '/preparadores' },
  { label: 'Promoções', path: '/promocoes' },
  { label: 'Pagamentos', path: '/pagamentos' },
  { label: 'Notificações', path: '/notificacoes' },
  { label: 'Avaliações', path: '/avaliacoes' },
  { label: 'Analytics', path: '/analytics' },
];

/** Largura estimada por tab (px) — inclui padding e gap */
const NAV_TAB_AVG_WIDTH = 95;
/** Dois `gap: 8` entre os três blocos (logo | nav | user) em `navbarInner` */
const NAV_INNER_GAP_TOTAL = 16;

// Chevron right (>) para "Ver mais"
const chevronRightSvg = React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
  React.createElement('path', { d: 'M9 18l6-6-6-6', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }));

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { session, signOut } = useAuth();
  const { canAccess } = useAdminPermissions();

  // Filter nav tabs by permissions
  const allowedNavTabs = navTabsList.filter((tab) => {
    const permKey = PATH_TO_PERMISSION[tab.path];
    return !permKey || canAccess(tab.path);
  });

  // Redirect if no permission for current route
  useEffect(() => {
    const basePath = '/' + (location.pathname.split('/')[1] || '');
    const permKey = PATH_TO_PERMISSION[basePath];
    if (permKey && !canAccess(basePath) && basePath !== '/') {
      navigate('/', { replace: true });
    }
  }, [location.pathname, canAccess, navigate]);

  // Scroll to top on route change
  useEffect(() => {
    const scrollContainer = document.querySelector('main')?.parentElement;
    if (scrollContainer) scrollContainer.scrollTop = 0;
  }, [location.pathname]);

  const [moreOpen, setMoreOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountMenuPos, setAccountMenuPos] = useState<{ top: number; left: number } | null>(null);

  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const accountTriggerRef = useRef<HTMLButtonElement | null>(null);
  const accountDropdownRef = useRef<HTMLDivElement | null>(null);
  const headerInnerRef = useRef<HTMLDivElement | null>(null);
  const measureLogoRef = useRef<HTMLDivElement | null>(null);
  const measureUserRef = useRef<HTMLDivElement | null>(null);

  const updateAccountMenuPosition = useCallback(() => {
    const el = accountTriggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const width = 283;
    let left = rect.right - width;
    if (left < 8) left = 8;
    if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8);
    setAccountMenuPos({ top: rect.bottom + 8, left });
  }, []);

  useLayoutEffect(() => {
    if (!accountOpen) {
      setAccountMenuPos(null);
      return;
    }
    updateAccountMenuPosition();
    window.addEventListener('scroll', updateAccountMenuPosition, true);
    window.addEventListener('resize', updateAccountMenuPosition);
    return () => {
      window.removeEventListener('scroll', updateAccountMenuPosition, true);
      window.removeEventListener('resize', updateAccountMenuPosition);
    };
  }, [accountOpen, updateAccountMenuPosition]);

  // Fecha ao clicar fora (capture + contains evita conflito com React 19 / mesmo clique de abrir)
  useEffect(() => {
    if (!moreOpen && !accountOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (moreOpen && moreMenuRef.current?.contains(t)) return;
      if (accountOpen) {
        if (accountTriggerRef.current?.contains(t)) return;
        if (accountDropdownRef.current?.contains(t)) return;
      }
      setMoreOpen(false);
      setAccountOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown, true);
    return () => document.removeEventListener('mousedown', onPointerDown, true);
  }, [moreOpen, accountOpen]);

  useEffect(() => {
    setMoreOpen(false);
    setAccountOpen(false);
  }, [location.pathname]);

  const [maxVisibleTabs, setMaxVisibleTabs] = useState(6);

  const recalcMaxVisibleTabs = useCallback(() => {
    const inner = headerInnerRef.current;
    const logoW = measureLogoRef.current?.offsetWidth ?? 100;
    const userW = measureUserRef.current?.offsetWidth ?? 260;
    const innerW = inner?.offsetWidth ?? Math.min(1233, Math.max(320, window.innerWidth - 48));
    const navSlot = innerW - logoW - userW - NAV_INNER_GAP_TOTAL;
    const fit = Math.max(2, Math.floor(Math.max(0, navSlot) / NAV_TAB_AVG_WIDTH));
    setMaxVisibleTabs(Math.min(fit, allowedNavTabs.length));
  }, [allowedNavTabs.length]);

  useLayoutEffect(() => {
    recalcMaxVisibleTabs();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', recalcMaxVisibleTabs);
      return () => window.removeEventListener('resize', recalcMaxVisibleTabs);
    }
    const ro = new ResizeObserver(() => recalcMaxVisibleTabs());
    const inner = headerInnerRef.current;
    const logoEl = measureLogoRef.current;
    const userEl = measureUserRef.current;
    if (inner) ro.observe(inner);
    if (logoEl) ro.observe(logoEl);
    if (userEl) ro.observe(userEl);
    window.addEventListener('resize', recalcMaxVisibleTabs);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', recalcMaxVisibleTabs);
    };
  }, [recalcMaxVisibleTabs]);

  // When navigating from another module (e.g. encomendas → viagem detail),
  // keep that module's nav tab active instead of matching /viagens
  const fromModule = (location.state as any)?.from as string | undefined;
  const fromPath = fromModule ? `/${fromModule}` : null;

  const activeNavIndex = allowedNavTabs.findIndex((tab) => {
    if (fromPath && location.pathname.startsWith('/viagens')) {
      return tab.path === fromPath;
    }
    if (tab.path === '/') return location.pathname === '/';
    return location.pathname.startsWith(tab.path);
  });

  const userName = session?.user?.user_metadata?.full_name || 'Pedro Henrique';
  const userEmail = session?.user?.email || 'pedro.henriq@gmail.com';
  const avatarLetter = userName.charAt(0).toUpperCase();

  const needsMore = allowedNavTabs.length > maxVisibleTabs;
  const visibleTabs = needsMore ? allowedNavTabs.slice(0, maxVisibleTabs) : allowedNavTabs;
  const overflowTabs = needsMore ? allowedNavTabs.slice(maxVisibleTabs) : [];

  const activeInOverflow = needsMore && activeNavIndex >= maxVisibleTabs;

  const navButtons = visibleTabs.map((tab, i) =>
    React.createElement('button', {
      key: tab.label,
      type: 'button',
      style: { ...webStyles.navTab, ...(i === activeNavIndex ? webStyles.navTabActive : {}) } as React.CSSProperties,
      onClick: () => navigate(tab.path),
    }, tab.label));

  // "Ver mais" com dropdown
  const moreButton = needsMore ? React.createElement('div', {
    key: '_more',
    ref: moreMenuRef,
    style: { position: 'relative' as const, display: 'inline-flex' },
  },
    React.createElement('button', {
      type: 'button',
      'aria-expanded': moreOpen,
      'aria-haspopup': 'menu',
      style: {
        ...webStyles.navTab,
        ...(activeInOverflow ? webStyles.navTabActive : {}),
        flexDirection: 'row' as const, alignItems: 'center', justifyContent: 'center', gap: 4,
      } as React.CSSProperties,
      onClick: (e: React.MouseEvent) => { e.stopPropagation(); setMoreOpen((v) => !v); },
    }, 'Ver mais', chevronRightSvg),
    // Dropdown
    moreOpen ? React.createElement('div', {
      style: {
        position: 'absolute' as const, top: '100%', right: 0, marginTop: 4,
        background: '#fff', borderRadius: 12, border: '1px solid #e2e2e2',
        boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 1000,
        minWidth: 180, padding: '8px 0', display: 'flex', flexDirection: 'column' as const,
      },
    },
      ...overflowTabs.map((tab) => {
        const idx = allowedNavTabs.indexOf(tab);
        const isActive = idx === activeNavIndex;
        return React.createElement('button', {
          key: tab.label,
          type: 'button',
          style: {
            display: 'flex', alignItems: 'center', height: 40, padding: '0 16px',
            background: isActive ? '#f1f1f1' : 'transparent', border: 'none', cursor: 'pointer',
            fontSize: 14, fontWeight: isActive ? 600 : 400,
            color: isActive ? '#a37e38' : '#0d0d0d', ...font,
            whiteSpace: 'nowrap' as const,
          },
          onClick: () => { navigate(tab.path); setMoreOpen(false); },
        }, tab.label);
      })) : null) : null;

  const header = React.createElement('header', { style: webStyles.navbar },
    React.createElement('div', { ref: headerInnerRef, style: webStyles.navbarInner },
      React.createElement('div', { ref: measureLogoRef, style: webStyles.navLogo, onClick: () => navigate('/'), role: 'button' as const },
        React.createElement(Logo, { variant: 'navbar' })),
      React.createElement('nav', { style: webStyles.navTabs },
        React.createElement('div', {
          style: { ...webStyles.navTabGroup, flexWrap: 'nowrap' as const },
        },
          ...navButtons,
          moreButton)),
      React.createElement('div', { ref: measureUserRef, style: { ...webStyles.userBlock, position: 'relative' as const } },
        React.createElement('button', {
          ref: accountTriggerRef,
          type: 'button', style: webStyles.userButton, 'aria-label': 'Menu do usuário', 'aria-expanded': accountOpen,
          onClick: () => { setAccountOpen((v) => !v); },
        },
          React.createElement('div', { style: webStyles.avatar },
            React.createElement('span', { style: webStyles.avatarLetter }, avatarLetter)),
          React.createElement('div', { style: webStyles.userDetails },
            React.createElement('span', { style: webStyles.userName }, userName),
            React.createElement('span', { style: webStyles.userEmail }, userEmail)),
          React.createElement('span', { style: webStyles.chevronDown }, chevronDownSvg)))));

  const accountDropdownPanel =
    accountOpen && accountMenuPos && typeof document !== 'undefined'
      ? createPortal(
          React.createElement('div', {
            ref: accountDropdownRef,
            role: 'menu',
            style: {
              position: 'fixed' as const,
              top: accountMenuPos.top,
              left: accountMenuPos.left,
              width: 283,
              background: '#fff',
              borderRadius: 12,
              padding: 24,
              zIndex: 10001,
              boxShadow: '6px 6px 12px 0px rgba(0,0,0,0.15)',
              boxSizing: 'border-box' as const,
            },
          },
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8, width: '100%' } },
              ...([
                { label: 'Atualizar senha', icon: lockOutlineSvg, action: () => {} },
                { label: 'Atendimentos', icon: desktopOutlineSvg, action: () => navigate('/atendimentos') },
                {
                  label: 'Configurações',
                  icon: settingsOutlineSvg,
                  action: () => { setAccountOpen(false); navigate('/configuracoes'); },
                },
              ] as const).map((item) =>
                React.createElement('button', {
                  key: item.label, type: 'button', role: 'menuitem',
                  onClick: item.action,
                  style: {
                    display: 'flex', alignItems: 'center', gap: 8, height: 37,
                    padding: '8px 16px', background: 'none', border: 'none', cursor: 'pointer',
                    borderRadius: 8, width: '100%',
                    fontSize: 14, fontWeight: 400, color: '#0d0d0d', ...font,
                    lineHeight: 1.5, whiteSpace: 'nowrap' as const,
                  },
                  onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = '#f5f5f5'; },
                  onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = 'none'; },
                }, item.icon, item.label)),
              React.createElement('button', {
                key: 'sair', type: 'button', role: 'menuitem',
                onClick: async () => { setAccountOpen(false); await signOut(); navigate('/login'); },
                style: {
                  display: 'flex', alignItems: 'center', gap: 8, height: 37,
                  padding: '8px 16px', background: 'none', cursor: 'pointer',
                  borderRadius: '0 0 8px 8px', width: '100%',
                  borderTop: '0.5px solid #d9d9d9', borderLeft: 'none', borderRight: 'none', borderBottom: 'none',
                  fontSize: 14, fontWeight: 600, color: '#0d0d0d', ...font,
                  lineHeight: 1.5, whiteSpace: 'nowrap' as const,
                },
                onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = '#f5f5f5'; },
                onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = 'none'; },
              }, exitToAppSvg, 'Sair da conta'))),
          document.body,
        )
      : null;

  return React.createElement(React.Fragment, null,
    React.createElement('div', { style: webStyles.homePage },
      header,
      React.createElement('main', { style: webStyles.homeContent },
        React.createElement(Outlet))),
    accountDropdownPanel);
}
