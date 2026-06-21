import type { Phase } from '../context.js';
import { mulUnitPrice, applyFx } from '../../core/decimal.js';
import { getStrategy } from '../../rules/registry.js';

export const phasePriceFx: Phase = (ctx) => {
  if (!getStrategy(ctx.input.event.eventType).requiresValuation) return null;  // valuation-independent（INTERNAL_TRANSFER）

  const { event, prices, fxRates, policySet } = ctx.input;
  const vCoin = (ctx.carry.valuationCoinType as string) ?? event.coinType;
  const vQty = (ctx.carry.valuationQtyMinor as string) ?? event.quantityMinor;
  const vDec = (ctx.carry.valuationDecimals as number) ?? event.assetDecimals;
  const eventDate = event.eventTime.slice(0, 10);
  const price = prices.find((p) => p.coinType === vCoin && p.asOfDate === eventDate);
  if (!price) return { phase: 6, code: 'PRICE_MISSING', detail: { coinType: vCoin, date: eventDate } };

  const priceCcyFv = mulUnitPrice(vQty, vDec, price.unitPriceMinor);

  let fvFunctionalMinor: string;
  let fxRef: string;
  if (price.priceCurrency === policySet.functionalCurrency) {
    fvFunctionalMinor = priceCcyFv;
    fxRef = `identity:${price.priceCurrency}`;
  } else {
    const fx = fxRates.find(
      (f) => f.fromCurrency === price.priceCurrency && f.toCurrency === policySet.functionalCurrency && f.asOfDate === eventDate,
    );
    if (!fx) return { phase: 6, code: 'FX_MISSING', detail: { from: price.priceCurrency, to: policySet.functionalCurrency } };
    fvFunctionalMinor = applyFx(priceCcyFv, fx.rateMinor, fx.scale);
    fxRef = fx.id;
  }
  ctx.carry.priceRef = price.id;
  ctx.carry.fxRef = fxRef;
  ctx.carry.fvFunctionalMinor = fvFunctionalMinor;
  return null;
};
