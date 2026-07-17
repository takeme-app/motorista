import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { webStyles } from '../styles/webStyles';

export default function PublicRoute() {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return React.createElement('div', { style: webStyles.loading },
      React.createElement('span', { style: webStyles.loadingText }, 'Carregando...'));
  }
  // /reset-password precisa renderizar mesmo com sessão (a de recuperação criada
  // pelo token do e-mail), senão o usuário seria redirecionado antes de trocar a senha.
  if (session && location.pathname !== '/forgot-password' && location.pathname !== '/reset-password') {
    return React.createElement(Navigate, { to: '/', replace: true });
  }
  return React.createElement(Outlet);
}
