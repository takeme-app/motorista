import { test, expect } from '@playwright/test';
import { hasAdminE2ECredentials } from './helpers/loginAdmin';

test.describe.configure({ timeout: 120_000 });

/**
 * Flags opcionais (CI / staging):
 * - E2E_REQUIRE_DB_ROWS=1 — falha se listas estiverem vazias onde aplicável.
 * - E2E_REQUIRE_CONVERSATIONS=1 — Atendimentos deve ter linhas de tickets (BD real).
 * - E2E_ALLOW_MUTATIONS=1 — ativa testes que navegam para criar/editar (não usar em produção).
 */

test.describe('listas, dados da API e filtros', () => {
  test.beforeEach(async () => {
    test.skip(!hasAdminE2ECredentials(), 'Defina E2E_ADMIN_EMAIL e E2E_ADMIN_PASSWORD.');
  });

  /** Com E2E_REQUIRE_DB_ROWS=1 falha se a lista estiver vazia (útil contra BD de staging com dados). */
  const requireRows = process.env.E2E_REQUIRE_DB_ROWS === '1';

  function assertHasRows(count: number, context: string) {
    if (requireRows) expect(count, context).toBeGreaterThan(0);
  }

  test('Viagens — após load, tabela e filtro por nome', async ({ page }) => {
    await page.goto('/viagens');
    await expect(page.getByRole('heading', { name: 'Viagens', exact: true })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText('Carregando viagens...')).toBeHidden({ timeout: 60_000 });
    const rows = page.getByTestId('viagem-table-row');
    const initial = await rows.count();
    assertHasRows(initial, 'viagens');
    await page.getByTestId('viagens-open-table-filter').click();
    const dialog = page.getByRole('dialog', { name: 'Filtro da tabela' });
    await expect(dialog).toBeVisible();
    await dialog.getByPlaceholder('Ex: Carlos Silva').fill('__e2e_no_match__');
    await dialog.getByRole('button', { name: 'Aplicar filtro' }).click();
    await expect(dialog).toBeHidden();
    await expect(rows).toHaveCount(0);
    await page.getByTestId('viagens-open-table-filter').click();
    const d2 = page.getByRole('dialog', { name: 'Filtro da tabela' });
    await d2.getByPlaceholder('Ex: Carlos Silva').fill('');
    await d2.getByRole('button', { name: 'Aplicar filtro' }).click();
    await expect(rows).toHaveCount(initial);
  });

  test('Passageiros — filtro da página abre e fecha', async ({ page }) => {
    await page.goto('/passageiros');
    await expect(page.getByRole('heading', { name: 'Passageiros', exact: true }).first()).toBeVisible({ timeout: 25_000 });
    await page.getByTestId('passageiros-open-page-filter').click();
    const d = page.getByRole('dialog', { name: 'Filtro' });
    await expect(d).toBeVisible();
    await expect(d.getByRole('button', { name: 'Aplicar filtro' })).toBeVisible();
    await d.getByRole('button', { name: 'Voltar' }).click();
    await expect(d).toBeHidden();
  });

  test('Passageiros — tabela e filtro (nome)', async ({ page }) => {
    await page.goto('/passageiros');
    await expect(page.getByRole('heading', { name: 'Passageiros', exact: true }).first()).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText('Carregando passageiros...')).toBeHidden({ timeout: 60_000 });
    const rows = page.getByTestId('passageiro-table-row');
    const initial = await rows.count();
    assertHasRows(initial, 'passageiros');
    await page.getByTestId('passageiros-open-table-filter').click();
    const dialog = page.getByRole('dialog', { name: 'Filtro da tabela' });
    await expect(dialog).toBeVisible();
    await dialog.getByPlaceholder('Ex: Carlos Silva').fill('__e2e_no_match__');
    await dialog.getByRole('button', { name: 'Aplicar filtro' }).click();
    await expect(dialog).toBeHidden();
    await expect(rows).toHaveCount(0);
    await page.getByTestId('passageiros-open-table-filter').click();
    const d2 = page.getByRole('dialog', { name: 'Filtro da tabela' });
    await d2.getByPlaceholder('Ex: Carlos Silva').fill('');
    await d2.getByRole('button', { name: 'Aplicar filtro' }).click();
    await expect(rows).toHaveCount(initial);
  });

  test('Motoristas — filtro da página abre e fecha', async ({ page }) => {
    await page.goto('/motoristas');
    await expect(page.getByRole('heading', { name: 'Motoristas', exact: true })).toBeVisible({ timeout: 25_000 });
    await page.getByTestId('motoristas-open-page-filter').click();
    const d = page.getByRole('dialog', { name: 'Filtro' });
    await expect(d).toBeVisible();
    await d.getByRole('button', { name: 'Voltar' }).click();
    await expect(d).toBeHidden();
  });

  test('Motoristas — lista e filtro (nome/telefone)', async ({ page }) => {
    await page.goto('/motoristas');
    await expect(page.getByRole('heading', { name: 'Motoristas', exact: true })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText('Carregando motoristas...')).toBeHidden({ timeout: 60_000 });
    await expect(page.getByText('Carregando cadastros...')).toBeHidden({ timeout: 60_000 });
    const rows = page.getByTestId('motorista-cadastro-row');
    const initial = await rows.count();
    assertHasRows(initial, 'motoristas');
    await page.getByTestId('motoristas-open-cadastro-filter').click();
    const dialog = page.getByRole('dialog', { name: 'Filtro da lista' });
    await expect(dialog).toBeVisible();
    await dialog.getByPlaceholder('Ex: João ou 11999...').fill('__e2e_no_match__');
    await dialog.getByRole('button', { name: 'Aplicar' }).click();
    await expect(dialog).toBeHidden();
    await expect(rows).toHaveCount(0);
    await page.getByTestId('motoristas-open-cadastro-filter').click();
    const d2 = page.getByRole('dialog', { name: 'Filtro da lista' });
    await d2.getByPlaceholder('Ex: João ou 11999...').fill('');
    await d2.getByRole('button', { name: 'Aplicar' }).click();
    await expect(rows).toHaveCount(initial);
  });

  test('Destinos — filtro da página abre e fecha', async ({ page }) => {
    await page.goto('/destinos');
    await expect(page.getByRole('heading', { name: 'Destinos', exact: true })).toBeVisible({ timeout: 25_000 });
    await page.getByTestId('destinos-open-page-filter').click();
    const d = page.getByRole('dialog', { name: 'Filtro' });
    await expect(d).toBeVisible();
    await d.getByRole('button', { name: 'Voltar' }).click();
    await expect(d).toBeHidden();
  });

  test('Destinos — tabela e filtro (origem)', async ({ page }) => {
    await page.goto('/destinos');
    await expect(page.getByRole('heading', { name: 'Destinos', exact: true })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText('Carregando destinos...')).toBeHidden({ timeout: 60_000 });
    const rows = page.getByTestId('destino-table-row');
    const initial = await rows.count();
    assertHasRows(initial, 'destinos');
    await page.getByTestId('destinos-open-table-filter').click();
    const dialog = page.getByRole('dialog', { name: 'Filtro da tabela' });
    await expect(dialog).toBeVisible();
    await dialog.getByPlaceholder('Ex: São Paulo, SP').fill('__no_such_origin_e2e__');
    await dialog.getByRole('button', { name: 'Aplicar filtro' }).click();
    await expect(dialog).toBeHidden();
    await expect(rows).toHaveCount(0);
    await page.getByTestId('destinos-open-table-filter').click();
    const d2 = page.getByRole('dialog', { name: 'Filtro da tabela' });
    await d2.getByPlaceholder('Ex: São Paulo, SP').fill('');
    await d2.getByRole('button', { name: 'Aplicar filtro' }).click();
    await expect(rows).toHaveCount(initial);
  });

  test('Encomendas — busca global e filtro da tabela (origem)', async ({ page }) => {
    await page.goto('/encomendas');
    await expect(page.getByRole('heading', { name: 'Encomendas', exact: true })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText('Carregando encomendas...')).toBeHidden({ timeout: 60_000 });
    const rows = page.getByTestId('encomenda-table-row');
    const initial = await rows.count();
    assertHasRows(initial, 'encomendas');
    await page.getByRole('searchbox', { name: 'Buscar encomendas' }).fill('__e2e_no_match_xyz__');
    await expect(rows).toHaveCount(0);
    await page.getByRole('searchbox', { name: 'Buscar encomendas' }).fill('');
    await expect(rows).toHaveCount(initial);
    await page.getByTestId('encomendas-open-table-filter').click();
    const dialog = page.getByRole('dialog', { name: 'Filtro da tabela' });
    await expect(dialog).toBeVisible();
    await dialog.getByPlaceholder('Ex: São Paulo, SP').fill('__origin_impossible__');
    await dialog.getByRole('button', { name: 'Aplicar filtro' }).click();
    await expect(dialog).toBeHidden();
    await expect(rows).toHaveCount(0);
    await page.getByTestId('encomendas-open-table-filter').click();
    const d2 = page.getByRole('dialog', { name: 'Filtro da tabela' });
    await d2.getByPlaceholder('Ex: São Paulo, SP').fill('');
    await d2.getByRole('button', { name: 'Aplicar filtro' }).click();
    await expect(rows).toHaveCount(initial);
  });

  test('Encomendas — filtro da tabela (status) altera e restaura linhas', async ({ page }) => {
    await page.goto('/encomendas');
    await expect(page.getByRole('heading', { name: 'Encomendas', exact: true })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText('Carregando encomendas...')).toBeHidden({ timeout: 60_000 });
    const rows = page.getByTestId('encomenda-table-row');
    const initial = await rows.count();
    await page.getByTestId('encomendas-open-table-filter').click();
    const dialog = page.getByRole('dialog', { name: 'Filtro da tabela' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Concluídas' }).click();
    await dialog.getByRole('button', { name: 'Aplicar filtro' }).click();
    await expect(dialog).toBeHidden();
    const afterConcluidas = await rows.count();
    expect(afterConcluidas).toBeLessThanOrEqual(initial);
    await page.getByTestId('encomendas-open-table-filter').click();
    const d2 = page.getByRole('dialog', { name: 'Filtro da tabela' });
    await d2.getByRole('button', { name: 'Em andamento' }).click();
    await d2.getByRole('button', { name: 'Aplicar filtro' }).click();
    await expect(rows).toHaveCount(initial);
  });

  test('Encomendas — filtro da tabela (código impossível) esvazia e restaura', async ({ page }) => {
    await page.goto('/encomendas');
    await expect(page.getByRole('heading', { name: 'Encomendas', exact: true })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText('Carregando encomendas...')).toBeHidden({ timeout: 60_000 });
    const rows = page.getByTestId('encomenda-table-row');
    const initial = await rows.count();
    await page.getByTestId('encomendas-open-table-filter').click();
    const dialog = page.getByRole('dialog', { name: 'Filtro da tabela' });
    await expect(dialog).toBeVisible();
    await dialog.getByPlaceholder('Ex: #3421341342').fill('00000000-dead-beef-0000-000000000000');
    await dialog.getByRole('button', { name: 'Aplicar filtro' }).click();
    await expect(dialog).toBeHidden();
    await expect(rows).toHaveCount(0);
    await page.getByTestId('encomendas-open-table-filter').click();
    const d2 = page.getByRole('dialog', { name: 'Filtro da tabela' });
    await d2.getByPlaceholder('Ex: #3421341342').fill('');
    await d2.getByRole('button', { name: 'Aplicar filtro' }).click();
    await expect(rows).toHaveCount(initial);
  });

  test('Encomendas — filtro da tabela (data futura impossível) esvazia e restaura', async ({ page }) => {
    await page.goto('/encomendas');
    await expect(page.getByRole('heading', { name: 'Encomendas', exact: true })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText('Carregando encomendas...')).toBeHidden({ timeout: 60_000 });
    const rows = page.getByTestId('encomenda-table-row');
    const initial = await rows.count();
    if (initial === 0) return;
    await page.getByTestId('encomendas-open-table-filter').click();
    const dialog = page.getByRole('dialog', { name: 'Filtro da tabela' });
    await dialog.getByTestId('encomendas-tbl-filter-data-inicial').fill('2099-12-31');
    await dialog.getByRole('button', { name: 'Aplicar filtro' }).click();
    await expect(dialog).toBeHidden();
    await expect(rows).toHaveCount(0);
    await page.getByTestId('encomendas-open-table-filter').click();
    const d2 = page.getByRole('dialog', { name: 'Filtro da tabela' });
    await d2.getByTestId('encomendas-tbl-filter-data-inicial').fill('');
    await d2.getByRole('button', { name: 'Aplicar filtro' }).click();
    await expect(rows).toHaveCount(initial);
  });

  test('Encomendas — filtro da tabela (tipo Pequeno) altera e restaura', async ({ page }) => {
    await page.goto('/encomendas');
    await expect(page.getByRole('heading', { name: 'Encomendas', exact: true })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText('Carregando encomendas...')).toBeHidden({ timeout: 60_000 });
    const rows = page.getByTestId('encomenda-table-row');
    const initial = await rows.count();
    await page.getByTestId('encomendas-open-table-filter').click();
    const dialog = page.getByRole('dialog', { name: 'Filtro da tabela' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Pequeno' }).click();
    await dialog.getByRole('button', { name: 'Aplicar filtro' }).click();
    await expect(dialog).toBeHidden();
    expect(await rows.count()).toBeLessThanOrEqual(initial);
    await page.getByTestId('encomendas-open-table-filter').click();
    const d2 = page.getByRole('dialog', { name: 'Filtro da tabela' });
    await d2.getByRole('button', { name: 'Todos' }).click();
    await d2.getByRole('button', { name: 'Aplicar filtro' }).click();
    await expect(rows).toHaveCount(initial);
  });

  test('Preparadores — filtro da página (título distinto da tabela)', async ({ page }) => {
    await page.goto('/preparadores');
    await expect(page.getByRole('heading', { name: /Preparador de encomendas/ })).toBeVisible({ timeout: 25_000 });
    await page.getByTestId('preparadores-open-page-filter').click();
    const d = page.getByRole('dialog', { name: 'Filtro' });
    await expect(d).toBeVisible();
    await expect(d.getByText(/Contexto: preparadores/)).toBeVisible();
    await d.getByRole('button', { name: 'Voltar' }).click();
    await expect(d).toBeHidden();
  });

  test('Preparadores — filtro da tabela (nome)', async ({ page }) => {
    await page.goto('/preparadores');
    await expect(page.getByRole('heading', { name: /Preparador de encomendas/ })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText('Carregando preparadores...')).toBeHidden({ timeout: 60_000 });
    const rows = page.getByTestId('preparador-table-row');
    const initial = await rows.count();
    assertHasRows(initial, 'preparadores');
    await page.getByTestId('preparadores-open-table-filter').click();
    const dialog = page.getByRole('dialog', { name: 'Filtro da tabela' });
    await expect(dialog).toBeVisible();
    await dialog.getByPlaceholder('Ex: Carlos').fill('__e2e_nomatch__');
    await dialog.getByRole('button', { name: 'Aplicar filtro' }).click();
    await expect(dialog).toBeHidden();
    await expect(rows).toHaveCount(0);
    await page.getByTestId('preparadores-open-table-filter').click();
    const d2 = page.getByRole('dialog', { name: 'Filtro da tabela' });
    await d2.getByPlaceholder('Ex: Carlos').fill('');
    await d2.getByRole('button', { name: 'Aplicar filtro' }).click();
    await expect(rows).toHaveCount(initial);
  });

  test('Promoções — busca restringe linhas', async ({ page }) => {
    await page.goto('/promocoes');
    await expect(page.getByRole('heading', { name: 'Promoções', exact: true })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText('Carregando promoções...')).toBeHidden({ timeout: 60_000 });
    const rows = page.getByTestId('promocao-table-row');
    const initial = await rows.count();
    assertHasRows(initial, 'promoções');
    await page.getByPlaceholder('Buscar por nome ou título da promoção...').fill('__no_promo_e2e__');
    await expect(rows).toHaveCount(0);
    await page.getByPlaceholder('Buscar por nome ou título da promoção...').fill('');
    await expect(rows).toHaveCount(initial);
  });

  test('Promoções — modal Filtro da tabela (status Inativo) restringe lista', async ({ page }) => {
    await page.goto('/promocoes');
    await expect(page.getByRole('heading', { name: 'Promoções', exact: true })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText('Carregando promoções...')).toBeHidden({ timeout: 60_000 });
    const rows = page.getByTestId('promocao-table-row');
    const initial = await rows.count();
    await page.getByTestId('promocoes-open-table-filter').click();
    const dialog = page.getByRole('dialog', { name: 'Filtro da tabela' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Inativo' }).click();
    await dialog.getByRole('button', { name: 'Aplicar filtro' }).click();
    await expect(dialog).toBeHidden();
    expect(await rows.count()).toBeLessThanOrEqual(initial);
    await page.reload();
    await expect(page.getByText('Carregando promoções...')).toBeHidden({ timeout: 60_000 });
    await expect(rows).toHaveCount(initial);
  });

  test('Pagamentos — busca restringe linhas', async ({ page }) => {
    await page.goto('/pagamentos');
    await expect(page.getByRole('heading', { name: 'Pagamentos', exact: true })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText('Carregando pagamentos...')).toBeHidden({ timeout: 60_000 });
    const rows = page.getByTestId('pagamento-table-row');
    const initial = await rows.count();
    assertHasRows(initial, 'pagamentos');
    await page.getByPlaceholder('Buscar por preparador, destino ou origem...').fill('__e2e_nopay__');
    await expect(rows).toHaveCount(0);
    await page.getByPlaceholder('Buscar por preparador, destino ou origem...').fill('');
    await expect(rows).toHaveCount(initial);
  });

  test('Pagamentos — modal Filtro da tabela (status Cancelada) restringe lista', async ({ page }) => {
    await page.goto('/pagamentos');
    await expect(page.getByRole('heading', { name: 'Pagamentos', exact: true })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText('Carregando pagamentos...')).toBeHidden({ timeout: 60_000 });
    const rows = page.getByTestId('pagamento-table-row');
    const initial = await rows.count();
    await page.getByTestId('pagamentos-open-table-filter').click();
    const dialog = page.getByRole('dialog', { name: 'Filtro da tabela' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancelada' }).click();
    await dialog.getByRole('button', { name: 'Aplicar filtro' }).click();
    await expect(dialog).toBeHidden();
    expect(await rows.count()).toBeLessThanOrEqual(initial);
    await page.reload();
    await expect(page.getByText('Carregando pagamentos...')).toBeHidden({ timeout: 60_000 });
    await expect(rows).toHaveCount(initial);
  });

  test('Atendimentos — métricas e lista de tickets', async ({ page }) => {
    await page.goto('/atendimentos');
    await expect(page.getByRole('heading', { name: /Visão geral/ })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText('Viagens no momento')).toBeVisible();
    await expect(page.getByText('SLA de 1 dia para marcar como atrasada')).toBeVisible();
    const tickets = page.getByTestId('atendimento-ticket-row');
    const n = await tickets.count();
    if (process.env.E2E_REQUIRE_CONVERSATIONS === '1') {
      expect(n, 'E2E_REQUIRE_CONVERSATIONS=1: esperava conversas/tickets na BD.').toBeGreaterThan(0);
      await expect(tickets.first()).toBeVisible();
    } else if (n > 0) {
      await expect(tickets.first()).toBeVisible();
    }
    const meuDropdown = page.getByRole('button', { name: /Meu atendimento/ });
    await meuDropdown.click();
    await page.getByRole('button', { name: 'Atendimento geral', exact: true }).click();
    await expect(meuDropdown).toContainText('Atendimento geral');
  });

  test('Configurações — página carrega', async ({ page }) => {
    await page.goto('/configuracoes');
    await expect(page.getByRole('heading', { name: 'Configurações', exact: true })).toBeVisible({ timeout: 25_000 });
  });

  test('Configurações — aba Pix visível e option Bradesco desabilitada', async ({ page }) => {
    await page.goto('/configuracoes');
    await expect(page.getByRole('heading', { name: 'Configurações', exact: true })).toBeVisible({ timeout: 25_000 });
    const pixTab = page.getByRole('button', { name: 'Pix', exact: true });
    await expect(pixTab).toBeVisible();
    // Trocar de aba é só estado de UI (nenhuma mutação) — seguro fora de E2E_ALLOW_MUTATIONS.
    await pixTab.click();
    await expect(page.getByTestId('pix-config-tab')).toBeVisible({ timeout: 25_000 });
    await expect(
      page.getByTestId('pix-provider-select').locator('option[value="bradesco"]'),
    ).toBeDisabled();
  });

  test('Pagamentos — /pagamentos/pix renderiza (somente leitura)', async ({ page }) => {
    await page.goto('/pagamentos/pix');
    await expect(page.getByRole('heading', { name: 'Gestão Pix', exact: true })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByRole('button', { name: 'Cobranças', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Devoluções/ })).toBeVisible();
  });

  test('CRUD leve — criar promoção (rota) e editar encomenda', async ({ page }) => {
    test.skip(process.env.E2E_ALLOW_MUTATIONS !== '1', 'Defina E2E_ALLOW_MUTATIONS=1 para navegar em criar/editar (evitar produção).');
    await page.goto('/promocoes/nova');
    await expect(page.getByRole('heading', { name: 'Criar nova promoção', exact: true })).toBeVisible({ timeout: 25_000 });
    await page.goto('/encomendas');
    await expect(page.getByText('Carregando encomendas...')).toBeHidden({ timeout: 60_000 });
    const firstRow = page.getByTestId('encomenda-table-row').first();
    if ((await page.getByTestId('encomenda-table-row').count()) === 0) return;
    await firstRow.getByRole('button', { name: 'Editar' }).click();
    await expect(page).toHaveURL(/\/encomendas\/[0-9a-f-]+\/editar/i, { timeout: 15_000 });
  });

  test('CRUD leve — Destinos: Nova rota abre e fecha', async ({ page }) => {
    await page.goto('/destinos');
    await expect(page.getByText('Carregando destinos...')).toBeHidden({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Nova rota' }).click();
    await expect(page.getByRole('heading', { name: 'Criar rota', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.getByRole('heading', { name: 'Criar rota', exact: true })).toBeHidden();
  });
});
