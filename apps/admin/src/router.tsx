import React from 'react';
import { createBrowserRouter } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import PublicRoute from './components/PublicRoute';
import Layout from './components/Layout';
import WebLoginScreen from './screens/WebLoginScreen';
import WebForgotPasswordScreen from './screens/WebForgotPasswordScreen';
import WebSignupScreen from './screens/WebSignupScreen';
import HomeScreen from './screens/HomeScreen';
import ViagensScreen from './screens/ViagensScreen';
import ViagemDetalheScreen from './screens/ViagemDetalheScreen';
import ViagemEditScreen from './screens/ViagemEditScreen';
import PassageirosScreen from './screens/PassageirosScreen';
import PassageiroDetalheScreen from './screens/PassageiroDetalheScreen';
import MotoristasScreen from './screens/MotoristasScreen';
import MotoristaEditScreen from './screens/MotoristaEditScreen';
import DestinosScreen from './screens/DestinosScreen';
import EncomendasScreen from './screens/EncomendasScreen';
import PreparadoresScreen from './screens/PreparadoresScreen';
import PreparadorEditScreen from './screens/PreparadorEditScreen';
import PromocoesScreen from './screens/PromocoesScreen';
import PromocaoCreateScreen from './screens/PromocaoCreateScreen';
import PagamentosScreen from './screens/PagamentosScreen';
import PagamentosGestaoScreen from './screens/PagamentosGestaoScreen';
import PagamentoCriarTrechoScreen from './screens/PagamentoCriarTrechoScreen';
import PagamentoPreparadorEncomendaDetailScreen from './screens/PagamentoPreparadorEncomendaDetailScreen';
import PagamentoMotoristaDetailScreen from './screens/PagamentoMotoristaDetailScreen';
import MultasMotoristasScreen from './screens/MultasMotoristasScreen';
import EncomendaEditScreen from './screens/EncomendaEditScreen';
import EncomendaDetalheScreen from './screens/EncomendaDetalheScreen';
import PlaceholderScreen from './screens/PlaceholderScreen';
import AtendimentosScreen from './screens/AtendimentosScreen';
import AtendimentoDetalheScreen from './screens/AtendimentoDetalheScreen';
import ElaborarOrcamentoScreen from './screens/ElaborarOrcamentoScreen';
import HistoricoViagensScreen from './screens/HistoricoViagensScreen';
import ConfiguracoesScreen from './screens/ConfiguracoesScreen';
import AdicionaisScreen from './screens/AdicionaisScreen';
import NotificacoesScreen from './screens/NotificacoesScreen';
import AvaliacoesScreen from './screens/AvaliacoesScreen';
import AnalyticsScreen from './screens/AnalyticsScreen';

export const router = createBrowserRouter([
  {
    element: React.createElement(PublicRoute),
    children: [
      { path: '/login', element: React.createElement(WebLoginScreen) },
      { path: '/signup', element: React.createElement(WebSignupScreen) },
      { path: '/forgot-password', element: React.createElement(WebForgotPasswordScreen) },
    ],
  },
  {
    element: React.createElement(ProtectedRoute),
    children: [
      {
        element: React.createElement(Layout),
        children: [
          { path: '/', element: React.createElement(HomeScreen) },
          { path: '/viagens', element: React.createElement(ViagensScreen) },
          { path: '/viagens/:id', element: React.createElement(ViagemDetalheScreen) },
          { path: '/viagens/:id/historico', element: React.createElement(HistoricoViagensScreen) },
          { path: '/viagens/:id/editar', element: React.createElement(ViagemEditScreen) },
          { path: '/passageiros', element: React.createElement(PassageirosScreen) },
          { path: '/passageiros/:id', element: React.createElement(PassageiroDetalheScreen) },
          { path: '/motoristas', element: React.createElement(MotoristasScreen) },
          { path: '/motoristas/:id', element: React.createElement(MotoristaEditScreen) },
          { path: '/motoristas/:mid/viagem/:id', element: React.createElement(ViagemDetalheScreen) },
          { path: '/motoristas/:mid/viagem/:id/historico', element: React.createElement(HistoricoViagensScreen) },
          { path: '/motoristas/:id/editar', element: React.createElement(MotoristaEditScreen) },
          { path: '/destinos', element: React.createElement(DestinosScreen) },
          { path: '/encomendas', element: React.createElement(EncomendasScreen) },
          { path: '/encomendas/:id', element: React.createElement(EncomendaDetalheScreen) },
          { path: '/encomendas/:id/editar', element: React.createElement(EncomendaEditScreen) },
          { path: '/encomendas/:eid/viagem/:id', element: React.createElement(ViagemDetalheScreen) },
          { path: '/preparadores', element: React.createElement(PreparadoresScreen) },
          { path: '/preparadores/:id', element: React.createElement(PreparadorEditScreen) },
          { path: '/preparadores/:id/editar', element: React.createElement(PreparadorEditScreen) },
          { path: '/preparadores/:pid/viagem/:id', element: React.createElement(ViagemDetalheScreen) },
          { path: '/passageiros/:pid/viagem/:id', element: React.createElement(ViagemDetalheScreen) },
          { path: '/passageiros/:pid/viagem/:id/editar', element: React.createElement(ViagemEditScreen) },
          { path: '/passageiros/:pid/viagem/:id/historico', element: React.createElement(HistoricoViagensScreen) },
          { path: '/promocoes', element: React.createElement(PromocoesScreen) },
          { path: '/promocoes/nova', element: React.createElement(PromocaoCreateScreen) },
          { path: '/promocoes/:id/editar', element: React.createElement(PromocaoCreateScreen) },
          { path: '/pagamentos', element: React.createElement(PagamentosScreen) },
          { path: '/pagamentos/gestao', element: React.createElement(PagamentosGestaoScreen) },
          { path: '/pagamentos/gestao/criar-trecho', element: React.createElement(PagamentoCriarTrechoScreen) },
          { path: '/pagamentos/gestao/preparador-encomendas/:slug', element: React.createElement(PagamentoPreparadorEncomendaDetailScreen) },
          { path: '/pagamentos/gestao/motorista/:slug', element: React.createElement(PagamentoMotoristaDetailScreen) },
          { path: '/pagamentos/multas', element: React.createElement(MultasMotoristasScreen) },
          { path: '/atendimentos', element: React.createElement(AtendimentosScreen) },
          { path: '/atendimentos/:id', element: React.createElement(AtendimentoDetalheScreen) },
          { path: '/atendimentos/:id/orcamento', element: React.createElement(ElaborarOrcamentoScreen) },
          { path: '/notificacoes', element: React.createElement(NotificacoesScreen) },
          { path: '/avaliacoes', element: React.createElement(AvaliacoesScreen) },
          { path: '/analytics', element: React.createElement(AnalyticsScreen) },
          { path: '/configuracoes', element: React.createElement(ConfiguracoesScreen) },
          { path: '/adicionais', element: React.createElement(AdicionaisScreen) },
        ],
      },
    ],
  },
]);
