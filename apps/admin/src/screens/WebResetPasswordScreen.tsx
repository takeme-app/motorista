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
import { webStyles } from '../styles/webStyles';

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

  return React.createElement('div', { style: webStyles.outer },
    React.createElement('div', { style: webStyles.card },
      React.createElement('h2', { style: webStyles.title }, 'Definir nova senha'),
      done
        ? React.createElement('p', { style: webStyles.sentText }, 'Senha alterada com sucesso. Redirecionando para o login...')
        : !ready
          ? React.createElement('p', { style: webStyles.subtitle }, 'Validando o link de redefinição...')
          : [
              React.createElement('p', { key: 'sub', style: webStyles.subtitle }, 'Digite sua nova senha.'),
              React.createElement('input', {
                key: 'p1', type: 'password', placeholder: 'Nova senha', value: pw,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => { setPw(e.target.value); setError(''); },
                disabled: loading, style: { ...webStyles.input, ...(error ? webStyles.inputError : {}) },
              }),
              React.createElement('input', {
                key: 'p2', type: 'password', placeholder: 'Confirmar nova senha', value: pw2,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => { setPw2(e.target.value); setError(''); },
                disabled: loading, style: { ...webStyles.input, ...(error ? webStyles.inputError : {}) },
              }),
              error ? React.createElement('p', { key: 'err', style: webStyles.errorText }, error) : null,
              React.createElement('button', {
                key: 'btn', type: 'button', style: webStyles.primaryBtn, disabled: loading, onClick: handleSubmit,
              }, loading ? 'Salvando...' : 'Redefinir senha'),
            ]));
}
