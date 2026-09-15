/**
 * WebForgotPasswordScreen — pede o e-mail e dispara o link de redefinição.
 *
 * Primeira metade do fluxo de recuperação; a segunda é WebResetPasswordScreen.
 * As duas telas compartilham o mesmo desenho de propósito — quem clica no link
 * do e-mail cai na outra, e uma mudança de cara no meio do caminho passa a
 * impressão de ter ido parar no lugar errado.
 *
 * Uses React.createElement() calls (NOT JSX).
 */
import { useState } from 'react';
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { getLogoSrc } from '../styles/webStyles';

const s = {
  outer: {
    minHeight: '100vh', width: '100%', boxSizing: 'border-box' as const,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#f6f6f6', padding: 24, fontFamily: 'Inter, sans-serif',
  } as React.CSSProperties,
  card: {
    background: '#fff', borderRadius: 16, padding: 32, width: '100%', maxWidth: 400,
    boxSizing: 'border-box' as const, display: 'flex', flexDirection: 'column' as const, gap: 16,
    boxShadow: '0 10px 40px rgba(0,0,0,0.08)',
  } as React.CSSProperties,
  logoWrap: { display: 'flex', justifyContent: 'center', marginBottom: 4 } as React.CSSProperties,
  logo: { height: 40, objectFit: 'contain' as const } as React.CSSProperties,
  title: { fontSize: 22, fontWeight: 700, color: '#0d0d0d', textAlign: 'center' as const, margin: 0 } as React.CSSProperties,
  subtitle: { fontSize: 14, color: '#767676', textAlign: 'center' as const, margin: 0, lineHeight: 1.5 } as React.CSSProperties,
  field: { display: 'flex', flexDirection: 'column' as const, gap: 6 } as React.CSSProperties,
  label: { fontSize: 13, fontWeight: 500, color: '#0d0d0d' } as React.CSSProperties,
  input: {
    height: 48, borderRadius: 8, border: '1px solid #e2e2e2', background: '#f6f6f6',
    padding: '0 16px', fontSize: 15, color: '#0d0d0d', outline: 'none', width: '100%',
    boxSizing: 'border-box' as const, fontFamily: 'Inter, sans-serif',
  } as React.CSSProperties,
  inputError: { border: '1px solid #e57373', background: '#fef2f2' } as React.CSSProperties,
  errorText: { fontSize: 13, color: '#b53838', margin: 0 } as React.CSSProperties,
  primaryBtn: {
    height: 48, borderRadius: 8, border: 'none', background: '#0d0d0d', color: '#fff',
    fontSize: 16, fontWeight: 600, cursor: 'pointer', width: '100%', marginTop: 4,
    fontFamily: 'Inter, sans-serif',
  } as React.CSSProperties,
  successBox: {
    background: '#eef6f1', border: '1px solid #cfe3d8', borderRadius: 8,
    padding: '14px 16px', display: 'flex', flexDirection: 'column' as const, gap: 4,
  } as React.CSSProperties,
  successTitle: { fontSize: 15, fontWeight: 600, color: '#174f38', margin: 0 } as React.CSSProperties,
  successText: { fontSize: 13, color: '#3d6b55', margin: 0, lineHeight: 1.5 } as React.CSSProperties,
  linkBtn: {
    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
    fontSize: 14, fontWeight: 500, color: '#767676', textDecoration: 'underline',
    fontFamily: 'Inter, sans-serif', alignSelf: 'center' as const,
  } as React.CSSProperties,
};

export default function WebForgotPasswordScreen() {
  const navigate = useNavigate();
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotError, setForgotError] = useState('');

  const handleForgotSubmit = async () => {
    const email = forgotEmail.trim();
    setForgotError('');
    if (!email) { setForgotError('Digite seu e-mail.'); return; }
    if (!isSupabaseConfigured) { setForgotError('Supabase não configurado.'); return; }
    setForgotLoading(true);
    try {
      // Aponta para a URL PÚBLICA de produção do admin (env EXPO_PUBLIC_ADMIN_URL),
      // não para window.location.origin — que pode ser o deploy de preview da Vercel
      // protegido por SSO (fazendo o link do e-mail cair na tela de login da Vercel).
      const adminBase = (
        (typeof process !== 'undefined' && process.env.EXPO_PUBLIC_ADMIN_URL
          ? String(process.env.EXPO_PUBLIC_ADMIN_URL).trim().replace(/\/$/, '')
          : '') ||
        (typeof window !== 'undefined' ? window.location.origin : '')
      );
      const redirectTo = adminBase ? `${adminBase}/reset-password` : undefined;
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
      setForgotSent(true);
    } catch {
      setForgotError('Não foi possível enviar o e-mail. Tente novamente.');
    } finally {
      setForgotLoading(false);
    }
  };

  const logoSrc = getLogoSrc();

  return React.createElement('div', { style: s.outer },
    React.createElement('style', { dangerouslySetInnerHTML: { __html: 'html,body,#root{margin:0;padding:0;width:100%;min-height:100vh;background:#f6f6f6;}' } }),
    React.createElement('div', { style: s.card },
      logoSrc ? React.createElement('div', { style: s.logoWrap }, React.createElement('img', { src: logoSrc, alt: 'Take Me', style: s.logo })) : null,
      React.createElement('h2', { style: s.title }, 'Recuperação de senha'),

      forgotSent
        // Mostra para qual endereço foi, senão quem erra o e-mail fica esperando
        // uma mensagem que nunca chega.
        ? React.createElement(React.Fragment, null,
            React.createElement('div', { style: s.successBox },
              React.createElement('p', { style: s.successTitle }, 'Link enviado'),
              React.createElement('p', { style: s.successText },
                `Enviamos um link de redefinição para ${forgotEmail.trim()}. Verifique também a caixa de spam.`)),
            React.createElement('button', {
              type: 'button', style: s.primaryBtn, onClick: () => navigate('/login'),
            }, 'Voltar para o login'),
            React.createElement('button', {
              type: 'button', style: s.linkBtn,
              onClick: () => { setForgotSent(false); setForgotError(''); },
            }, 'Enviar para outro e-mail'))

        : React.createElement(React.Fragment, null,
            React.createElement('p', { style: s.subtitle }, 'Digite seu e-mail e enviaremos um link para redefinir sua senha.'),
            React.createElement('div', { style: s.field },
              React.createElement('label', { style: s.label, htmlFor: 'forgot-email' }, 'E-mail'),
              React.createElement('input', {
                id: 'forgot-email',
                type: 'email',
                autoComplete: 'email',
                placeholder: 'voce@empresa.com.br',
                value: forgotEmail,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => { setForgotEmail(e.target.value); setForgotError(''); },
                onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' && !forgotLoading) void handleForgotSubmit(); },
                disabled: forgotLoading,
                style: { ...s.input, ...(forgotError ? s.inputError : {}) },
              })),
            forgotError ? React.createElement('p', { style: s.errorText }, forgotError) : null,
            React.createElement('button', {
              type: 'button',
              style: { ...s.primaryBtn, opacity: forgotLoading ? 0.7 : 1, cursor: forgotLoading ? 'wait' : 'pointer' },
              disabled: forgotLoading,
              onClick: handleForgotSubmit,
            }, forgotLoading ? 'Enviando...' : 'Enviar link'),
            React.createElement('button', {
              type: 'button', style: s.linkBtn, onClick: () => navigate('/login'),
            }, 'Voltar para o login'))));
}
