/**
 * WebLoginScreen — Login screen extracted from App.tsx (lines 1124-1182).
 * Uses React.createElement() calls (NOT JSX).
 */
import { useState } from 'react';
import React from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { webStyles, eyeSvg, getLogoSrc, logoArrowSvg } from '../styles/webStyles';

export default function WebLoginScreen() {
  const [phoneOrEmail, setPhoneOrEmail] = useState('');
  const [password, setPassword] = useState('');
  const [hidePassword, setHidePassword] = useState(true);
  const [loading, setLoading] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');

  const handleLogin = async () => {
    const input = phoneOrEmail.trim();
    setEmailError('');
    setPasswordError('');
    if (!input) { setEmailError('Digite seu e-mail ou telefone.'); return; }
    if (!password) { setPasswordError('Digite sua senha.'); return; }
    if (!isSupabaseConfigured) { setEmailError('Configure EXPO_PUBLIC_SUPABASE_URL e EXPO_PUBLIC_SUPABASE_ANON_KEY.'); return; }
    setLoading(true);
    try {
      if (input.includes('@')) {
        const emailNorm = input.trim().toLowerCase();
        const { data, error: fnErr } = await supabase.functions.invoke('login-with-email', {
          body: { email: emailNorm, password },
        });
        if (fnErr || data?.error || !data?.session) {
          setEmailError('E-mail incorreto');
          setPasswordError('Senha incorreta');
          setLoading(false);
          return;
        }
        await supabase.auth.setSession(data.session);
      } else {
        const phone = input.replace(/\D/g, '');
        const { data, error: fnErr } = await supabase.functions.invoke('login-with-phone', { body: { phone, password } });
        if (fnErr || data?.error || !data?.session) { setEmailError('E-mail incorreto'); setPasswordError('Senha incorreta'); setLoading(false); return; }
        await supabase.auth.setSession(data.session);
      }
      // AuthContext handles redirect automatically
    } catch {
      setEmailError('E-mail incorreto');
      setPasswordError('Senha incorreta');
    } finally {
      setLoading(false);
    }
  };

  // Login — estrutura e estilos do export Figma (autohtml-project)
  const logoSrc = getLogoSrc();
  const logoEl = logoSrc
    ? React.createElement('img', { src: logoSrc, alt: 'Take Me', style: webStyles.logoImgWide })
    : React.createElement('div', { style: webStyles.logoPlaceholder },
        React.createElement('div', { style: webStyles.logoPlaceholderIcon }, logoArrowSvg),
        React.createElement('div', { style: webStyles.logoPlaceholderText },
          React.createElement('span', { style: webStyles.logoPlaceholderTake }, 'Take '),
          React.createElement('span', { style: webStyles.logoPlaceholderMe }, 'Me')));
  return React.createElement('div', { style: webStyles._25login, className: 'figma-login', 'data-testid': 'web-login-screen' },
    React.createElement('div', { style: webStyles.login },
      React.createElement('style', { dangerouslySetInnerHTML: { __html: 'html, body, #root { margin: 0; padding: 0; width: 100%; min-height: 100vh; height: 100%; box-sizing: border-box; }.figma-login { width: 100% !important; min-height: 100vh !important; }.figma-login input::placeholder { color: #767676; }.figma-login .admin-cta { width: 100%; min-width: 0; max-width: 100%; align-items: center; align-self: center; }.figma-login .admin-cta button,.figma-login button { min-height: 44px; box-sizing: border-box; }.figma-login .admin-cta button { width: 100%; } @media (max-width: 480px) { .figma-login .admin-cta { max-width: none; padding: 0 4px; }.figma-login .admin-cta button,.figma-login button { padding: 14px 12px; font-size: 15px; } }' } }),
      React.createElement('div', { style: webStyles.content },
        React.createElement('div', { style: webStyles.frame427321193 },
          React.createElement('div', { style: webStyles.logo }, logoEl),
          React.createElement('div', { style: webStyles.frame9 },
            React.createElement('div', { style: webStyles.frame7 },
              React.createElement('div', { style: webStyles.frame5 },
                React.createElement('div', { style: webStyles.frame3 },
                  React.createElement('div', { style: webStyles.title }, 'Digite seu número de telefone ou email')),
                React.createElement('div', { style: webStyles.frame4 },
                  React.createElement('div', { style: { ...webStyles.textField, ...(emailError ? webStyles.inputError : {}) } },
                    React.createElement('div', { style: webStyles.inputInner },
                      React.createElement('input', {
                        type: 'text',
                        placeholder: 'Telefone ou email',
                        value: phoneOrEmail,
                        onChange: (e: React.ChangeEvent<HTMLInputElement>) => { setPhoneOrEmail(e.target.value); setEmailError(''); },
                        disabled: loading,
                        style: webStyles.input,
                      }))),
                  emailError ? React.createElement('p', { style: webStyles.errorText }, '▲ ', emailError) : null,
                  React.createElement('div', { style: { ...webStyles.passwordRow, ...(passwordError ? webStyles.inputError : {}) } },
                    React.createElement('div', { style: webStyles.passwordInputWrap },
                      React.createElement('input', {
                        type: hidePassword ? 'password' : 'text',
                        placeholder: 'Senha de acesso',
                        value: password,
                        onChange: (e: React.ChangeEvent<HTMLInputElement>) => { setPassword(e.target.value); setPasswordError(''); },
                        disabled: loading,
                        style: { ...webStyles.input, paddingRight: 48 } as React.CSSProperties,
                      }),
                      React.createElement('div', { style: webStyles.actionContainer },
                        React.createElement('button', { type: 'button', style: webStyles.iconButton, onClick: () => setHidePassword((v) => !v), 'aria-label': hidePassword ? 'Mostrar senha' : 'Ocultar senha' }, eyeSvg(hidePassword))))),
                  passwordError ? React.createElement('p', { style: webStyles.errorText }, '▲ ', passwordError) : null,
              React.createElement('div', { style: webStyles.cta, className: 'admin-cta' },
                React.createElement('button', {
                  type: 'button',
                  style: { ...webStyles.primaryBtn, opacity: loading ? 0.7 : 1 },
                  disabled: loading,
                  onClick: handleLogin,
                }, loading ? 'Entrando...' : 'Continuar'))))))))));
}
