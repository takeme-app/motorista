/**
 * WebForgotPasswordScreen — Forgot password screen extracted from App.tsx (lines 1027-1053).
 * Uses React.createElement() calls (NOT JSX).
 */
import { useState } from 'react';
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { webStyles } from '../styles/webStyles';

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

  return React.createElement('div', { style: webStyles.outer },
    React.createElement('div', { style: webStyles.card },
      React.createElement('div', { style: webStyles.backBtn, onClick: () => navigate('/login'), role: 'button' }, '← Voltar'),
      React.createElement('h2', { style: webStyles.title }, 'Recuperação de senha'),
      React.createElement('p', { style: webStyles.subtitle }, 'Digite seu e-mail e enviaremos um link para redefinir sua senha.'),
      forgotSent
        ? React.createElement('p', { style: webStyles.sentText }, 'Verifique seu e-mail.')
        : [
            React.createElement('input', {
              key: 'email',
              type: 'email',
              placeholder: 'E-mail',
              value: forgotEmail,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => { setForgotEmail(e.target.value); setForgotError(''); },
              disabled: forgotLoading,
              style: { ...webStyles.input, ...(forgotError ? webStyles.inputError : {}) },
            }),
            forgotError ? React.createElement('p', { key: 'err', style: webStyles.errorText }, forgotError) : null,
            React.createElement('button', {
              key: 'btn',
              type: 'button',
              style: webStyles.primaryBtn,
              disabled: forgotLoading,
              onClick: handleForgotSubmit,
            }, forgotLoading ? 'Enviando...' : 'Enviar link'),
          ]));
}
