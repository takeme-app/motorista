/**
 * WebResetPasswordScreen — Define nova senha após o link de recuperação.
 * O supabase client (detectSessionInUrl: true) consome o token de recuperação
 * da URL e cria a sessão; aqui o usuário digita a nova senha (updateUser).
 * Uses React.createElement() calls (NOT JSX).
 */
import { useState, useEffect } from 'react';
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
  successText: { fontSize: 15, color: '#174f38', textAlign: 'center' as const, margin: 0, lineHeight: 1.5 } as React.CSSProperties,
};

export default function WebResetPasswordScreen() {
  const navigate = useNavigate();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    let mounted = true;
    // A sessão de recuperação é criada a partir do token na URL (detectSessionInUrl).
    supabase.auth.getSession().then(({ data }) => {
      if (mounted && data.session) setReady(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === 'PASSWORD_RECOVERY' || session) setReady(true);
    });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

  const handleSubmit = async () => {
    setError('');
    if (pw.length < 6) { setError('A senha deve ter ao menos 6 caracteres.'); return; }
    if (pw !== pw2) { setError('As senhas não coincidem.'); return; }
    if (!isSupabaseConfigured) { setError('Supabase não configurado.'); return; }
    setLoading(true);
    try {
      const { error: err } = await supabase.auth.updateUser({ password: pw });
      if (err) throw err;
      setDone(true);
      await supabase.auth.signOut();
      setTimeout(() => navigate('/login'), 1800);
    } catch {
      setError('Não foi possível redefinir a senha. O link pode ter expirado — solicite um novo.');
    } finally {
      setLoading(false);
    }
  };

  const logoSrc = getLogoSrc();

  return React.createElement('div', { style: s.outer },
    // Garante que html/body/#root ocupem a tela toda (evita faixa de fundo diferente).
    React.createElement('style', { dangerouslySetInnerHTML: { __html: 'html,body,#root{margin:0;padding:0;width:100%;min-height:100vh;background:#f6f6f6;}' } }),
    React.createElement('div', { style: s.card },
      logoSrc ? React.createElement('div', { style: s.logoWrap }, React.createElement('img', { src: logoSrc, alt: 'Take Me', style: s.logo })) : null,
      React.createElement('h2', { style: s.title }, 'Definir nova senha'),
      done
        ? React.createElement('p', { style: s.successText }, 'Senha alterada com sucesso. Redirecionando para o login...')
        : !ready
          ? React.createElement('p', { style: s.subtitle }, 'Validando o link de redefinição...')
          : React.createElement(React.Fragment, null,
              React.createElement('p', { style: s.subtitle }, 'Digite sua nova senha abaixo.'),
              React.createElement('div', { style: s.field },
                React.createElement('label', { style: s.label }, 'Nova senha'),
                React.createElement('input', {
                  type: 'password', placeholder: 'Mínimo 6 caracteres', value: pw,
                  onChange: (e: React.ChangeEvent<HTMLInputElement>) => { setPw(e.target.value); setError(''); },
                  disabled: loading, style: { ...s.input, ...(error ? s.inputError : {}) },
                })),
              React.createElement('div', { style: s.field },
                React.createElement('label', { style: s.label }, 'Confirmar nova senha'),
                React.createElement('input', {
                  type: 'password', placeholder: 'Repita a nova senha', value: pw2,
                  onChange: (e: React.ChangeEvent<HTMLInputElement>) => { setPw2(e.target.value); setError(''); },
                  disabled: loading, style: { ...s.input, ...(error ? s.inputError : {}) },
                  onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' && !loading) void handleSubmit(); },
                })),
              error ? React.createElement('p', { style: s.errorText }, error) : null,
              React.createElement('button', {
                type: 'button', style: { ...s.primaryBtn, opacity: loading ? 0.7 : 1 },
                disabled: loading, onClick: handleSubmit,
              }, loading ? 'Salvando...' : 'Redefinir senha'))));
}
