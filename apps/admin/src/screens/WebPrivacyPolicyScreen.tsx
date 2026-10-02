/**
 * WebPrivacyPolicyScreen — Política de Privacidade pública.
 *
 * O Google Play exige que a Política de Privacidade e a declaração de Segurança
 * dos Dados digam a mesma coisa; quando divergem, a atualização é reprovada. Foi
 * exatamente o que aconteceu: a declaração passou a listar 17 tipos de dados e a
 * política publicada em takeme-politicas.vercel.app citava quatro — "nome,
 * telefone, endereço e dados de pagamento".
 *
 * Por isso a seção "Dados que coletamos" abaixo espelha, tipo a tipo, o que está
 * declarado no Play Console, com a mesma divisão entre obrigatório e opcional e as
 * mesmas finalidades. Ao mexer na declaração, mexa aqui junto — divergir de novo
 * reprova a atualização.
 *
 * Fica FORA de PublicRoute pelo mesmo motivo de [[WebDeleteAccountScreen]]: aquele
 * componente manda quem tem sessão para "/", e esta página precisa abrir para
 * qualquer visitante, inclusive o revisor da loja.
 *
 * Uses React.createElement() calls (NOT JSX).
 */
import React from 'react';
import { getLogoSrc } from '../styles/webStyles';

const CONTACT_EMAIL = 'atendimento@takeme.app.br';
const PRIVACY_EMAIL = 'privacidade@takeme.app.br';
const DELETE_URL = '/excluir-conta';

/** Espelha a declaração de Segurança dos Dados do Play Console, tipo a tipo. */
const REQUIRED: { what: string; why: string }[] = [
  { what: 'Nome, e-mail e telefone', why: 'criar e manter sua conta, identificar você no serviço e entrar em contato sobre a viagem ou a encomenda' },
  { what: 'CPF', why: 'identificação do titular e prevenção a fraudes' },
  { what: 'Endereço', why: 'origem e destino de viagens e encomendas, incluindo o endereço de entrega' },
  { what: 'Dados de pagamento e histórico de compras', why: 'cobrar pelo serviço, emitir recibos e prevenir fraudes' },
  { what: 'Identificadores do dispositivo', why: 'entregar notificações e permitir que os serviços de mapa e de pagamento funcionem' },
];

const OPTIONAL: { what: string; why: string }[] = [
  { what: 'Localização aproximada e precisa', why: 'definir o ponto de partida, acompanhar a viagem e mostrar motoristas por perto' },
  { what: 'Mensagens trocadas no chat do app', why: 'comunicação entre passageiro, motorista e suporte' },
  { what: 'Fotos', why: 'foto de perfil, registro de encomendas e anexos no chat' },
  { what: 'Gravações de voz', why: 'mensagens de áudio no chat' },
  { what: 'Arquivos e documentos', why: 'documentos de dependentes e de passageiros de excursão, quando você os envia' },
  { what: 'Histórico de busca no app e avaliações que você escreve', why: 'sugerir destinos recentes e exibir avaliações' },
];

/** Operadores que tratam dados em nome da Take Me. */
const PROCESSORS: { name: string; role: string }[] = [
  { name: 'Google (Firebase Cloud Messaging)', role: 'entrega das notificações push' },
  { name: 'Stripe', role: 'processamento de pagamentos por cartão' },
  { name: 'Mapbox', role: 'mapas, rotas e navegação' },
  { name: 'Supabase', role: 'banco de dados e armazenamento dos arquivos enviados' },
];

const s = {
  outer: {
    minHeight: '100vh', width: '100%', boxSizing: 'border-box' as const,
    display: 'flex', justifyContent: 'center',
    background: '#f6f6f6', padding: 24, fontFamily: 'Inter, sans-serif',
  } as React.CSSProperties,
  card: {
    background: '#fff', borderRadius: 16, padding: 32, width: '100%', maxWidth: 720,
    boxSizing: 'border-box' as const, display: 'flex', flexDirection: 'column' as const, gap: 18,
    boxShadow: '0 10px 40px rgba(0,0,0,0.08)', height: 'fit-content',
  } as React.CSSProperties,
  logoWrap: { display: 'flex', justifyContent: 'center', marginBottom: 4 } as React.CSSProperties,
  logo: { height: 40, objectFit: 'contain' as const } as React.CSSProperties,
  title: { fontSize: 24, fontWeight: 700, color: '#0d0d0d', textAlign: 'center' as const, margin: 0 } as React.CSSProperties,
  updated: { fontSize: 13, color: '#767676', textAlign: 'center' as const, margin: 0 } as React.CSSProperties,
  h2: { fontSize: 17, fontWeight: 600, color: '#0d0d0d', margin: '10px 0 0' } as React.CSSProperties,
  h3: { fontSize: 15, fontWeight: 600, color: '#0d0d0d', margin: '4px 0 0' } as React.CSSProperties,
  p: { fontSize: 14, color: '#525252', margin: 0, lineHeight: 1.65 } as React.CSSProperties,
  ul: { margin: 0, paddingLeft: 22, display: 'flex', flexDirection: 'column' as const, gap: 6 } as React.CSSProperties,
  li: { fontSize: 14, color: '#525252', lineHeight: 1.65 } as React.CSSProperties,
  strong: { color: '#0d0d0d', fontWeight: 600 } as React.CSSProperties,
  link: { color: '#0d0d0d', fontWeight: 600 } as React.CSSProperties,
  footer: {
    fontSize: 13, color: '#767676', margin: 0, lineHeight: 1.65,
    borderTop: '1px solid #e2e2e2', paddingTop: 16,
  } as React.CSSProperties,
};

function list(items: { what: string; why: string }[], prefix: string) {
  return React.createElement('ul', { style: s.ul },
    ...items.map((item, i) =>
      React.createElement('li', { key: `${prefix}-${i}`, style: s.li },
        React.createElement('strong', { style: s.strong }, item.what),
        ' — ', item.why)));
}

export default function WebPrivacyPolicyScreen() {
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

      React.createElement('h1', { style: s.title }, 'Política de Privacidade'),
      React.createElement('p', { style: s.updated }, 'Última atualização: outubro de 2026'),

      React.createElement('p', { style: s.p },
        'Esta política vale para os aplicativos ',
        React.createElement('strong', { style: s.strong }, 'Take Me - Cliente'),
        ' e ',
        React.createElement('strong', { style: s.strong }, 'Take Me - Motorista'),
        '. A Take Me trata dados pessoais em conformidade com a Lei Geral de Proteção de '
        + 'Dados (LGPD — Lei nº 13.709/2018).'),

      React.createElement('h2', { style: s.h2 }, '1. Dados que coletamos'),

      React.createElement('h3', { style: s.h3 }, 'Necessários para usar o serviço'),
      React.createElement('p', { style: s.p },
        'Sem estes dados não é possível criar conta nem contratar uma viagem ou encomenda:'),
      list(REQUIRED, 'req'),

      React.createElement('h3', { style: s.h3 }, 'Opcionais'),
      React.createElement('p', { style: s.p },
        'Coletados apenas se você autorizar a permissão no aparelho ou usar o recurso. '
        + 'Você pode recusar, e o app continua funcionando com menos comodidade:'),
      list(OPTIONAL, 'opt'),

      React.createElement('h2', { style: s.h2 }, '2. Como usamos'),
      React.createElement('p', { style: s.p },
        'Os dados são usados para operar o serviço contratado, gerenciar sua conta, '
        + 'comunicar você sobre viagens e encomendas, processar pagamentos, prevenir fraudes '
        + 'e cumprir obrigações legais. '),
      React.createElement('p', { style: s.p },
        React.createElement('strong', { style: s.strong },
          'Não usamos seus dados para publicidade, marketing ou perfilamento, '
          + 'e não fazemos análise de comportamento no app.')),

      React.createElement('h2', { style: s.h2 }, '3. Compartilhamento'),
      React.createElement('p', { style: s.p },
        'A Take Me ', React.createElement('strong', { style: s.strong }, 'não vende'),
        ' dados pessoais e não os entrega a ninguém para uso comercial próprio. Os dados '
        + 'necessários para a viagem são mostrados à outra parte envolvida — o motorista vê o '
        + 'ponto de embarque e o contato do passageiro, e vice-versa.'),
      React.createElement('p', { style: s.p },
        'Para o app funcionar, ',
        React.createElement('strong', { style: s.strong },
          'identificadores do seu dispositivo são transmitidos aos provedores abaixo'),
        ', que tratam esses dados em nosso nome, sob contrato e apenas para executar o serviço '
        + 'contratado:'),
      React.createElement('ul', { style: s.ul },
        ...PROCESSORS.map((proc, i) =>
          React.createElement('li', { key: `proc-${i}`, style: s.li },
            React.createElement('strong', { style: s.strong }, proc.name), ' — ', proc.role))),
      React.createElement('p', { style: s.p },
        'Também podemos divulgar dados quando a lei exigir ou por ordem de autoridade competente.'),

      React.createElement('h2', { style: s.h2 }, '4. Segurança'),
      React.createElement('p', { style: s.p },
        'Todo tráfego entre o app e nossos servidores é criptografado em trânsito (HTTPS). '
        + 'Os dados de cartão são tratados diretamente pelo Stripe: a Take Me não armazena o '
        + 'número completo do seu cartão.'),

      React.createElement('h2', { style: s.h2 }, '5. Retenção e exclusão'),
      React.createElement('p', { style: s.p },
        'Mantemos os dados enquanto sua conta existir. Você pode excluir a conta a qualquer '
        + 'momento pelo próprio app, em Perfil → Excluir conta, ou pela página ',
        React.createElement('a', { href: DELETE_URL, style: s.link }, 'de exclusão de conta'),
        '. A exclusão é definitiva.'),
      React.createElement('p', { style: s.p },
        'Após a exclusão, continuam existindo apenas devoluções de Pix ainda em aberto, até o '
        + 'estorno ser concluído, e registros de auditoria de mudança de status — ambos sem '
        + 'qualquer vínculo com a sua identidade.'),

      React.createElement('h2', { style: s.h2 }, '6. Seus direitos'),
      React.createElement('p', { style: s.p },
        'Pela LGPD você pode acessar seus dados, pedir correção, exclusão ou portabilidade, '
        + 'e revogar consentimentos. Para exercer esses direitos, escreva para ',
        React.createElement('a', { href: `mailto:${PRIVACY_EMAIL}`, style: s.link }, PRIVACY_EMAIL),
        '. Respondemos em até 30 dias.'),

      React.createElement('h2', { style: s.h2 }, '7. Crianças'),
      React.createElement('p', { style: s.p },
        'Os aplicativos não se destinam a menores de 18 anos desacompanhados. O cadastro de '
        + 'dependentes é feito pelo responsável, que responde pelos dados informados.'),

      React.createElement('h2', { style: s.h2 }, '8. Alterações'),
      React.createElement('p', { style: s.p },
        'Esta política pode ser atualizada. A versão vigente estará sempre nesta página, com a '
        + 'data de atualização no topo.'),

      React.createElement('p', { style: s.footer },
        'Take Me · ',
        React.createElement('a', { href: `mailto:${CONTACT_EMAIL}`, style: s.link }, CONTACT_EMAIL),
        ' · WhatsApp (98) 3023-8383')));
}
