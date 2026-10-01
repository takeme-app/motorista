/**
 * WebDeleteAccountScreen — página pública de solicitação de exclusão de conta.
 *
 * Exigida pelo Google Play: todo app que permite criar conta precisa publicar uma
 * URL acessível na web (não só o fluxo dentro do app) explicando como pedir a
 * exclusão. Sem ela a declaração de Segurança dos Dados não pode ser enviada.
 *
 * O Google exige três coisas nesta página, e as três estão abaixo:
 *   1. o nome do app ou do desenvolvedor como aparece na loja;
 *   2. os passos para solicitar a exclusão;
 *   3. quais dados são excluídos e quais são retidos, com o prazo de retenção.
 *
 * A lista de dados abaixo descreve o que a edge function `delete-account` de fato
 * faz, e o que o banco retém por chave estrangeira — não é texto genérico. Ao
 * mudar aquela função ou as FKs, esta página precisa mudar junto.
 *
 * Fica FORA de PublicRoute de propósito: aquele componente manda quem tem sessão
 * para "/", e esta página precisa abrir para qualquer pessoa, logada ou não,
 * inclusive para o revisor do Google.
 *
 * Uses React.createElement() calls (NOT JSX).
 */
import React from 'react';
import { getLogoSrc } from '../styles/webStyles';

const PRIVACY_EMAIL = 'privacidade@takeme.app.br';

/** Apagados de forma permanente — cascata de `auth.users` + limpeza da function. */
const DELETED: string[] = [
  'Dados do perfil: nome, e-mail, telefone, CPF, cidade, estado e foto',
  'Credenciais de acesso e sessões ativas',
  'Histórico de viagens, encomendas, excursões e dependentes cadastrados',
  'Conversas e mensagens trocadas no chat do app',
  'Avaliações que você registrou',
  'Meios de pagamento salvos, incluindo o cadastro de cliente no Stripe',
  'Cobranças Pix vinculadas à conta',
  'Notificações e os tokens de notificação dos seus aparelhos',
  'Documentos e imagens enviados: foto de perfil, documentos de dependentes, fotos de encomendas e documentos de excursão',
  'Preferências do app e destinos recentes',
];

/** Mantidos, sempre desvinculados da sua identidade. */
const RETAINED: { what: string; why: string }[] = [
  {
    what: 'Devoluções de Pix ainda em aberto',
    why: 'mantidas até o estorno ser concluído, para que o dinheiro chegue até você',
  },
  {
    what: 'Registros de auditoria de mudança de status de pedidos',
    why: 'mantidos sem qualquer identificador seu, apenas como histórico operacional',
  },
];

const s = {
  outer: {
    minHeight: '100vh', width: '100%', boxSizing: 'border-box' as const,
    display: 'flex', justifyContent: 'center',
    background: '#f6f6f6', padding: 24, fontFamily: 'Inter, sans-serif',
  } as React.CSSProperties,
  card: {
    background: '#fff', borderRadius: 16, padding: 32, width: '100%', maxWidth: 680,
    boxSizing: 'border-box' as const, display: 'flex', flexDirection: 'column' as const, gap: 20,
    boxShadow: '0 10px 40px rgba(0,0,0,0.08)', height: 'fit-content',
  } as React.CSSProperties,
  logoWrap: { display: 'flex', justifyContent: 'center', marginBottom: 4 } as React.CSSProperties,
  logo: { height: 40, objectFit: 'contain' as const } as React.CSSProperties,
  title: { fontSize: 24, fontWeight: 700, color: '#0d0d0d', textAlign: 'center' as const, margin: 0 } as React.CSSProperties,
  lead: { fontSize: 15, color: '#525252', margin: 0, lineHeight: 1.6 } as React.CSSProperties,
  h2: { fontSize: 17, fontWeight: 600, color: '#0d0d0d', margin: '8px 0 0' } as React.CSSProperties,
  p: { fontSize: 14, color: '#525252', margin: 0, lineHeight: 1.6 } as React.CSSProperties,
  ol: { margin: 0, paddingLeft: 22, display: 'flex', flexDirection: 'column' as const, gap: 8 } as React.CSSProperties,
  ul: { margin: 0, paddingLeft: 22, display: 'flex', flexDirection: 'column' as const, gap: 6 } as React.CSSProperties,
  li: { fontSize: 14, color: '#525252', lineHeight: 1.6 } as React.CSSProperties,
  strong: { color: '#0d0d0d', fontWeight: 600 } as React.CSSProperties,
  box: {
    background: '#f6f6f6', border: '1px solid #e2e2e2', borderRadius: 10,
    padding: '16px 18px', display: 'flex', flexDirection: 'column' as const, gap: 8,
  } as React.CSSProperties,
  warnBox: {
    background: '#fdf3f3', border: '1px solid #f0d4d4', borderRadius: 10,
    padding: '16px 18px', display: 'flex', flexDirection: 'column' as const, gap: 6,
  } as React.CSSProperties,
  warnTitle: { fontSize: 15, fontWeight: 600, color: '#8c2f2f', margin: 0 } as React.CSSProperties,
  warnText: { fontSize: 14, color: '#8c2f2f', margin: 0, lineHeight: 1.6 } as React.CSSProperties,
  link: { color: '#0d0d0d', fontWeight: 600 } as React.CSSProperties,
  footer: {
    fontSize: 13, color: '#767676', margin: 0, lineHeight: 1.6,
    borderTop: '1px solid #e2e2e2', paddingTop: 16,
  } as React.CSSProperties,
};

export default function WebDeleteAccountScreen() {
  const logoSrc = getLogoSrc();

  return React.createElement('div', { style: s.outer },
    React.createElement('style', {
      dangerouslySetInnerHTML: {
        __html: 'html,body,#root{margin:0;padding:0;width:100%;min-height:100vh;background:#f6f6f6;}',
      },
    }),
    React.createElement('div', { style: s.card },

      logoSrc
        ? React.createElement('div', { style: s.logoWrap },
            React.createElement('img', { src: logoSrc, alt: 'Take Me', style: s.logo }))
        : null,

      React.createElement('h1', { style: s.title }, 'Exclusão da conta Take Me'),

      React.createElement('p', { style: s.lead },
        'Esta página explica como solicitar a exclusão da sua conta e dos seus dados nos aplicativos ',
        React.createElement('strong', { style: s.strong }, 'Take Me - Cliente'),
        ' e ',
        React.createElement('strong', { style: s.strong }, 'Take Me - Motorista'),
        ', publicados pela Take Me.'),

      React.createElement('h2', { style: s.h2 }, 'Como excluir pelo aplicativo'),
      React.createElement('ol', { style: s.ol },
        React.createElement('li', { style: s.li }, 'Abra o aplicativo e entre na sua conta.'),
        React.createElement('li', { style: s.li },
          'Acesse a aba ', React.createElement('strong', { style: s.strong }, 'Perfil'), '.'),
        React.createElement('li', { style: s.li },
          'Toque em ', React.createElement('strong', { style: s.strong }, 'Excluir conta'), '.'),
        React.createElement('li', { style: s.li },
          'Para confirmar, digite a palavra ',
          React.createElement('strong', { style: s.strong }, 'EXCLUIR'),
          ' e conclua.')),

      React.createElement('h2', { style: s.h2 }, 'Como excluir sem o aplicativo'),
      React.createElement('div', { style: s.box },
        React.createElement('p', { style: s.p },
          'Se você já desinstalou o app ou não consegue entrar na conta, envie um e-mail para ',
          React.createElement('a', { href: `mailto:${PRIVACY_EMAIL}`, style: s.link }, PRIVACY_EMAIL),
          ' com o assunto “Exclusão de conta”, informando o e-mail ou o telefone cadastrado.'),
        React.createElement('p', { style: s.p },
          'Confirmamos a titularidade antes de excluir e concluímos o pedido em até 30 dias.')),

      React.createElement('div', { style: s.warnBox },
        React.createElement('p', { style: s.warnTitle }, 'A exclusão é definitiva'),
        React.createElement('p', { style: s.warnText },
          'Não é possível desfazer nem recuperar os dados depois. Se tiver uma viagem, '
          + 'encomenda ou pagamento em andamento, conclua antes de excluir a conta.')),

      React.createElement('h2', { style: s.h2 }, 'Quais dados são excluídos'),
      React.createElement('p', { style: s.p }, 'Removemos de forma permanente:'),
      React.createElement('ul', { style: s.ul },
        ...DELETED.map((item, i) =>
          React.createElement('li', { key: `del-${i}`, style: s.li }, item))),

      React.createElement('h2', { style: s.h2 }, 'Quais dados são mantidos'),
      React.createElement('p', { style: s.p },
        'Os itens abaixo continuam existindo, mas deixam de ter qualquer vínculo com você: '
        + 'seu identificador é removido do registro.'),
      React.createElement('ul', { style: s.ul },
        ...RETAINED.map((item, i) =>
          React.createElement('li', { key: `keep-${i}`, style: s.li },
            React.createElement('strong', { style: s.strong }, item.what),
            ' — ', item.why))),

      React.createElement('p', { style: s.footer },
        'Dúvidas sobre privacidade: ',
        React.createElement('a', { href: `mailto:${PRIVACY_EMAIL}`, style: s.link }, PRIVACY_EMAIL),
        '.')));
}
