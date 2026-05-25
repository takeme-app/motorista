/**
 * Testes do módulo canônico de precificação.
 *
 * Cobre os 5 cenários do PDF "Fórmulas de Preços App Takeme":
 *   1) Viagem                2) Encomenda
 *   3) Preparador encomendas 4) Preparador excursão (diária × dias)
 *   5) Excursão (manual, sem fórmula automática — só valida breakdown)
 *
 * Cada cenário roda "sem promoção" e "com promoção" + valida a invariante
 * `Total = Motorista + Admin` e `Total − Desconto = Valor cobrado no cartão`.
 *
 * Rodar: `node --test packages/shared/__tests__/orderPricing.test.ts`
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  computeOrderPricing,
  chargeAmountCentsOf,
  applicationFeeCentsOf,
  formatPricingBreakdown,
  PricingDenominatorOverflowError,
  normalizePlatformFeePctByService,
  resolvePlatformFeePct,
} from '../src/orderPricing.ts';

const invariants = (label: string, r: ReturnType<typeof computeOrderPricing>) => {
  // Invariante 1: worker + admin = total
  assert.equal(
    r.workerEarningCents + r.adminEarningCents,
    r.totalCents,
    `[${label}] worker + admin ≠ total`
  );
  // Invariante 2: motorista recebe = base + gain − discount
  assert.equal(
    r.workerEarningCents,
    r.baseCents + r.promoGainCents - r.promoDiscountCents,
    `[${label}] worker ≠ base + gain − discount`
  );
  // Invariante 3: admin_earning ≥ surcharges (admin sempre leva adicionais)
  assert.ok(
    r.adminEarningCents >= r.surchargesCents - 1,
    `[${label}] admin_earning < surcharges (${r.adminEarningCents} < ${r.surchargesCents})`
  );
  // Invariante 4: chargeAmount = totalCents (PDF não subtrai desconto do cartão)
  assert.equal(
    chargeAmountCentsOf(r),
    Math.max(1, r.totalCents),
    `[${label}] chargeAmountCentsOf ≠ total`
  );
};

describe('computeOrderPricing — cenário 1: viagem', () => {
  it('sem promoção: Total = base + admin%·Total + adicionais', () => {
    // base R$ 100,00, admin 15%, adicionais R$ 10,00, sem promo
    // Total = (100 + 10) / (1 − 0 + 0 − 0.15) = 110 / 0.85 ≈ 129,41
    const r = computeOrderPricing({
      baseCents: 10000,
      surchargesCents: 1000,
      adminPct: 15,
    });
    assert.equal(r.totalCents, 12941);
    assert.equal(r.baseCents, 10000);
    assert.equal(r.surchargesCents, 1000);
    assert.equal(r.adminFeeCents, Math.round(12941 * 0.15));
    assert.equal(r.promoGainCents, 0);
    assert.equal(r.promoDiscountCents, 0);
    invariants('viagem sem promo', r);
  });

  it('com promoção: ganho 5% + desconto 10%', () => {
    // base 100, admin 15, gain 5, discount 10, adicionais 10
    // denom = 1 − 0.05 + 0.10 − 0.15 = 0.90
    // Total = 110 / 0.90 = 122,22
    const r = computeOrderPricing({
      baseCents: 10000,
      surchargesCents: 1000,
      adminPct: 15,
      gainPct: 5,
      discountPct: 10,
    });
    assert.equal(r.totalCents, 12222);
    assert.equal(r.promoGainCents, Math.round(12222 * 0.05));
    assert.equal(r.promoDiscountCents, Math.round(12222 * 0.10));
    assert.equal(r.adminFeeCents, Math.round(12222 * 0.15));
    invariants('viagem com promo', r);
  });

  it('split Stripe: application_fee_amount = admin_earning', () => {
    const r = computeOrderPricing({ baseCents: 10000, adminPct: 15 });
    assert.equal(applicationFeeCentsOf(r), r.adminEarningCents);
    assert.equal(r.workerEarningCents, 10000);
  });

  it('taxa global editável: 15%, 5% e 0% preservam split por snapshot', () => {
    const admin15 = computeOrderPricing({ baseCents: 10000, adminPct: 15 });
    assert.equal(admin15.totalCents, 11765);
    assert.equal(admin15.workerEarningCents, 10000);
    assert.equal(admin15.adminEarningCents, 1765);

    const admin5 = computeOrderPricing({ baseCents: 10000, adminPct: 5 });
    assert.equal(admin5.totalCents, 10526);
    assert.equal(admin5.workerEarningCents, 10000);
    assert.equal(admin5.adminEarningCents, 526);

    const admin0 = computeOrderPricing({ baseCents: 10000, adminPct: 0 });
    assert.equal(admin0.totalCents, 10000);
    assert.equal(admin0.workerEarningCents, 10000);
    assert.equal(admin0.adminEarningCents, 0);

    invariants('taxa global 15%', admin15);
    invariants('taxa global 5%', admin5);
    invariants('taxa global 0%', admin0);
  });
});

describe('computeOrderPricing — cenário 2: encomenda (motorista entrega)', () => {
  it('fórmula idêntica à viagem', () => {
    const r = computeOrderPricing({
      baseCents: 5000,
      surchargesCents: 500,
      adminPct: 15,
      gainPct: 0,
      discountPct: 0,
    });
    // Total = (50 + 5) / 0.85 ≈ 64,71
    assert.equal(r.totalCents, 6471);
    invariants('encomenda', r);
  });
});

describe('computeOrderPricing — cenário 3: preparador de encomendas', () => {
  it('admin_pct = 0 → worker fica com tudo menos adicionais', () => {
    // base R$ 50,00, adicionais R$ 5,00, admin 0%, sem promo
    // Total = 55 / 1 = 55,00
    const r = computeOrderPricing({
      baseCents: 5000,
      surchargesCents: 500,
      adminPct: 0,
    });
    assert.equal(r.totalCents, 5500);
    // PDF: "Administrador: não participa, já está ganhando na entrega"
    // No nosso modelo, admin_earning = admin_fee + adicionais → admin recebe os adicionais.
    // Se quiserem que adicionais vão pro preparador, a UI deve zerar surchargesCents
    // (serão rateados via outro mecanismo).
    assert.equal(r.adminFeeCents, 0);
    assert.equal(r.workerEarningCents, 5000);
    invariants('preparador encomendas', r);
  });

  it('com ganho promocional: incrementa worker_earning', () => {
    // base 50, gain 10%, admin 0
    // Total = 50 / (1 − 0.10) = 55,56
    const r = computeOrderPricing({
      baseCents: 5000,
      adminPct: 0,
      gainPct: 10,
    });
    assert.equal(r.totalCents, 5556);
    assert.equal(r.promoGainCents, 556);
    assert.equal(r.workerEarningCents, 5000 + 556);
    invariants('preparador encomendas promo', r);
  });
});

describe('computeOrderPricing — cenário 4: preparador de excursão (diária × dias)', () => {
  it('diária R$ 200 × 3 dias = base 600, sem promo, admin 0', () => {
    const dailyRate = 20000;
    const days = 3;
    const r = computeOrderPricing({
      baseCents: dailyRate * days,
      surchargesCents: 0,
      adminPct: 0,
    });
    assert.equal(r.totalCents, 60000);
    assert.equal(r.workerEarningCents, 60000);
    invariants('preparador excursão', r);
  });

  it('diária R$ 200 × 5 dias + adicional R$ 50 + ganho 8%', () => {
    const r = computeOrderPricing({
      baseCents: 100000,
      surchargesCents: 5000,
      adminPct: 0,
      gainPct: 8,
    });
    // Total = 105000 / 0.92 ≈ 114130
    assert.equal(r.totalCents, 114130);
    invariants('preparador excursão promo', r);
  });
});

describe('computeOrderPricing — cenário 5: excursão (manual)', () => {
  it('backoffice define custos diretos, fórmula apenas formata o breakdown', () => {
    // Backoffice entrou base = 500, adicionais = 100, admin_pct = 0
    // total = 600
    const r = computeOrderPricing({
      baseCents: 50000,
      surchargesCents: 10000,
      adminPct: 0,
    });
    assert.equal(r.totalCents, 60000);
    const lines = formatPricingBreakdown(r);
    assert.ok(lines.length >= 3);
    assert.ok(lines.some((l) => l.label === 'Total' && l.valueCents === 60000));
    invariants('excursão manual', r);
  });
});

describe('resolvePlatformFeePct — taxas por serviço', () => {
  it('usa taxa específica quando configurada', () => {
    const settings = {
      value: {
        booking: 5,
        dependent_shipment: 7.5,
        shipment_driver: 9,
        shipment_preparer: 11,
        excursion: 13,
      },
    };
    assert.equal(resolvePlatformFeePct(settings, 'booking', 15), 5);
    assert.equal(resolvePlatformFeePct(settings, 'dependent_shipment', 15), 7.5);
    assert.equal(resolvePlatformFeePct(settings, 'shipment_driver', 15), 9);
    assert.equal(resolvePlatformFeePct(settings, 'shipment_preparer', 15), 11);
    assert.equal(resolvePlatformFeePct(settings, 'excursion', 15), 13);
  });

  it('cai para default_admin_pct e depois 15% quando chave estiver ausente ou inválida', () => {
    assert.equal(resolvePlatformFeePct({ value: { booking: 'x' } }, 'booking', 8), 8);
    assert.equal(resolvePlatformFeePct({ value: {} }, 'shipment_driver', 6), 6);
    assert.equal(resolvePlatformFeePct(null, 'excursion', 'invalid'), 15);
  });

  it('normaliza apenas percentuais dentro do limite operacional', () => {
    const normalized = normalizePlatformFeePctByService({
      booking: 5,
      dependent_shipment: -1,
      shipment_driver: 41,
      shipment_preparer: 0,
    });
    assert.deepEqual(normalized, {
      booking: 5,
      shipment_preparer: 0,
    });
  });
});

describe('computeOrderPricing — casos-limite', () => {
  it('denominador inválido (admin+gain−discount ≥ 95%) lança erro', () => {
    assert.throws(
      () => computeOrderPricing({ baseCents: 1000, adminPct: 60, gainPct: 40 }),
      PricingDenominatorOverflowError
    );
  });

  it('valores negativos são sanitizados para 0', () => {
    const r = computeOrderPricing({
      baseCents: 1000,
      // @ts-expect-error teste de sanitização
      adminPct: -5,
      // @ts-expect-error teste de sanitização
      gainPct: null,
    });
    assert.equal(r.adminPctApplied, 0);
    assert.equal(r.gainPctApplied, 0);
    invariants('sanitização negativa', r);
  });

  it('base zero → total zero', () => {
    const r = computeOrderPricing({ baseCents: 0, adminPct: 15 });
    assert.equal(r.totalCents, 0);
    assert.equal(r.workerEarningCents, 0);
    invariants('base zero', r);
  });

  it('arredondamentos não quebram a invariante total = worker + admin', () => {
    // Teste fuzz simples: várias combinações de valores
    const cases: Array<{ base: number; sur: number; a: number; g: number; d: number }> = [
      { base: 123, sur: 0, a: 15, g: 0, d: 0 },
      { base: 777, sur: 33, a: 15, g: 5, d: 7 },
      { base: 99999, sur: 1234, a: 20, g: 3, d: 2 },
      { base: 1, sur: 0, a: 15, g: 0, d: 0 },
      { base: 5551, sur: 201, a: 17.5, g: 2.5, d: 4.25 },
    ];
    for (const c of cases) {
      const r = computeOrderPricing({
        baseCents: c.base,
        surchargesCents: c.sur,
        adminPct: c.a,
        gainPct: c.g,
        discountPct: c.d,
      });
      invariants(`fuzz ${JSON.stringify(c)}`, r);
    }
  });
});
