import type { EventStrategy, LotPlan } from './registry.js';
import type { PipelineCtx } from '../pipeline/context.js';
import type { JeLine, Measurement, DisclosureFact, RuleException } from '../domain/types.js';
import { allocateFifo } from '../core/fifo.js';
import { subMinor, addMinor, mulDivFloor, ltMinor, negMinor, isZeroMinor } from '../core/decimal.js';
import { balanceCheck } from './receiptRules.js';

// §4.5（CPA B1）：處分腿吃重估後 carrying = cost + 該 lot 累計 valuationDelta − valuationImpair，
// 按處分量占該 lot 剩餘量的比例攤（全量消耗直接取全額，避免無謂 floor 誤差；部分消耗才走 mulDivFloor）。
// 回傳 { carryingMinor, reclassDeltaMinor }。
//
// external review fix：reclassDeltaMinor 吃的是 valuationPnlDeltaMinor（P&L 認列的期間重估份額），
// **不是** valuationDeltaMinor（carrying 用的總 delta，含 ASU 過渡記進 RetainedEarnings 的權益分量）。
// 過渡分量從未入 P&L，若拿它去重分類進 UnrealizedGainCryptoPnL/DisposalGain，會把從未認列過的
// P&L 金額灌進這兩個帳戶，且處分若晚於重估所在期間，會在錯的當期虛增 P&L 波動。carrying 仍用
// 總 delta（正確——carrying 反映完整 FV，與哪個帳戶吸收了 delta 無關）；兩者各自按同一 take/orig
// 比例攤（同一 lot 用同一分母），無 valuation 欄的 lot 兩者皆按 0 計，行為與現狀 byte-identical（回歸鎖）。
function revaluedCarrying(lots: PipelineCtx['input']['lots'], consumed: { lotId: string; qtyMinor: string; costMinor: string }[]) {
  let carrying = '0';
  let reclassDelta = '0';
  for (const c of consumed) {
    const lot = lots.find((l) => l.lotId === c.lotId);
    const origQty = lot?.remainingQtyMinor ?? c.qtyMinor;
    const full = c.qtyMinor === origQty;
    const lotDelta = lot?.valuationDeltaMinor;
    const lotImpair = lot?.valuationImpairMinor;
    const lotPnlDelta = lot?.valuationPnlDeltaMinor;
    const takenDelta = lotDelta === undefined ? '0' : full ? lotDelta : mulDivFloor(lotDelta, c.qtyMinor, origQty);
    const takenImpair = lotImpair === undefined ? '0' : full ? lotImpair : mulDivFloor(lotImpair, c.qtyMinor, origQty);
    const takenPnlDelta = lotPnlDelta === undefined ? '0' : full ? lotPnlDelta : mulDivFloor(lotPnlDelta, c.qtyMinor, origQty);
    const lotCarrying = addMinor(addMinor(c.costMinor, takenDelta), negMinor(takenImpair));
    carrying = addMinor(carrying, lotCarrying);
    reclassDelta = addMinor(reclassDelta, takenPnlDelta);
  }
  return { carryingMinor: carrying, reclassDeltaMinor: reclassDelta };
}

export const swapStrategy: EventStrategy = {
  ruleIds: ['swap-disposal-acquisition-v1'],
  requiresValuation: true,
  classify: (ctx) => {
    const { event } = ctx.input;
    if (!event.considerationAsset || !event.considerationQtyMinor || event.considerationDecimals === null)
      return { phase: 5, code: 'NOT_IMPLEMENTED_IN_SLICE', detail: { reason: 'swap 需 considerationAsset/Qty/Decimals' } };
    ctx.carry.valuationCoinType = event.considerationAsset;
    ctx.carry.valuationQtyMinor = event.considerationQtyMinor;
    ctx.carry.valuationDecimals = event.considerationDecimals;
    return null;
  },
  buildLotPlan: (ctx): LotPlan | RuleException => {
    const { event } = ctx.input;
    const r = allocateFifo(ctx.input.lots, event.coinType, event.wallet, event.quantityMinor);
    if (!r.ok) return { phase: 7, code: 'INSUFFICIENT_LOT', detail: { available: r.availableQtyMinor } };
    const { carryingMinor, reclassDeltaMinor } = revaluedCarrying(ctx.input.lots, r.consumed);
    ctx.carry.carryingMinor = carryingMinor;
    ctx.carry.reclassDeltaMinor = reclassDeltaMinor;
    const disposed = r.consumed.map((c) => ({
      lotId: c.lotId,
      coinType: event.coinType,
      wallet: event.wallet,
      deltaQtyMinor: negMinor(c.qtyMinor),
      deltaCostMinor: negMinor(c.costMinor),
    }));
    const fv = ctx.carry.fvFunctionalMinor as string;
    const acquired = {
      lotId: `R-${event.txDigest}-${event.eventIndex}`,
      coinType: event.considerationAsset!,
      wallet: event.wallet,
      deltaQtyMinor: event.considerationQtyMinor!,
      deltaCostMinor: fv,
    };
    return { movements: [...disposed, acquired], consumed: r.consumed };
  },
  buildMeasurements: (ctx): Measurement[] => {
    const fv = ctx.carry.fvFunctionalMinor as string;
    const carrying = ctx.carry.carryingMinor as string;
    const cur = ctx.input.policySet.functionalCurrency;
    return [
      { name: 'consideration_fv', amountMinor: fv, currency: cur, track: 'FV' },
      { name: 'disposal_carrying', amountMinor: carrying, currency: cur, track: 'CARRYING' },
      { name: 'realized_gain', amountMinor: subMinor(fv, carrying), currency: cur, track: 'GAIN' },
    ];
  },
  buildJeLines: (ctx): JeLine[] | RuleException => {
    const { event, coaMapping } = ctx.input;
    const fv = ctx.carry.fvFunctionalMinor as string;
    const carrying = ctx.carry.carryingMinor as string;
    const gain = subMinor(fv, carrying);
    const acqAcct = coaMapping.resolve({ eventType: 'SPOT_TRADE_SWAP', leg: 'ACQUISITION', coinType: event.considerationAsset! });
    const dispAcct = coaMapping.resolve({ eventType: 'SPOT_TRADE_SWAP', leg: 'DISPOSAL', coinType: event.coinType });
    if (!acqAcct || !dispAcct) return { phase: 9, code: 'MAPPING_MISSING', detail: {} };
    const lines: JeLine[] = [
      { account: acqAcct, side: 'DEBIT', amountMinor: fv, origCoinType: event.considerationAsset, origQtyMinor: event.considerationQtyMinor, priceRef: ctx.carry.priceRef as string, fxRef: ctx.carry.fxRef as string, leg: 'ACQUISITION' },
      { account: dispAcct, side: 'CREDIT', amountMinor: carrying, origCoinType: event.coinType, origQtyMinor: event.quantityMinor, priceRef: null, fxRef: null, leg: 'DISPOSAL' },
    ];
    if (!isZeroMinor(gain)) {
      const gainLeg = ltMinor(gain, '0') ? 'DISPOSAL_LOSS' : 'DISPOSAL_GAIN';
      const gainAcct = coaMapping.resolve({ eventType: 'SPOT_TRADE_SWAP', leg: gainLeg, coinType: event.coinType });
      if (!gainAcct) return { phase: 9, code: 'MAPPING_MISSING', detail: { gainLeg } };
      if (ltMinor(gain, '0')) {
        lines.push({ account: gainAcct, side: 'DEBIT', amountMinor: negMinor(gain), origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'DISPOSAL_LOSS' });
      } else {
        lines.push({ account: gainAcct, side: 'CREDIT', amountMinor: gain, origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'DISPOSAL_GAIN' });
      }
    }
    // §4.5（CPA B1）：GAAP_FV lot 的先前未實現損益隨處分比例重分類為已實現。無 valuation（reclassDelta='0'）
    // → 現狀行為 byte-identical（回歸鎖）。IFRS/GAAP_COST 的減損已在 P&L 認列，不重分類（無此區塊）。
    const reclassDelta = (ctx.carry.reclassDeltaMinor as string | undefined) ?? '0';
    if (!isZeroMinor(reclassDelta)) {
      if (ltMinor(reclassDelta, '0')) {
        // 先前未實現損失轉已實現：Dr DisposalLoss / Cr UnrealizedLossCryptoPnL
        const dispLossAcct = coaMapping.resolve({ eventType: 'SPOT_TRADE_SWAP', leg: 'DISPOSAL_LOSS', coinType: event.coinType });
        const unrealLossAcct = coaMapping.resolve({ eventType: 'SPOT_TRADE_SWAP', leg: 'UNREALIZED_LOSS_RECLASS', coinType: event.coinType });
        if (!dispLossAcct || !unrealLossAcct) return { phase: 9, code: 'MAPPING_MISSING', detail: { dispLossAcct, unrealLossAcct } };
        const amt = negMinor(reclassDelta);
        lines.push(
          { account: dispLossAcct, side: 'DEBIT', amountMinor: amt, origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'DISPOSAL_LOSS_RECLASS' },
          { account: unrealLossAcct, side: 'CREDIT', amountMinor: amt, origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'UNREALIZED_LOSS_RECLASS' },
        );
      } else {
        // 先前未實現利得轉已實現：Dr UnrealizedGainCryptoPnL / Cr DisposalGain
        const unrealGainAcct = coaMapping.resolve({ eventType: 'SPOT_TRADE_SWAP', leg: 'UNREALIZED_GAIN_RECLASS', coinType: event.coinType });
        const dispGainAcct = coaMapping.resolve({ eventType: 'SPOT_TRADE_SWAP', leg: 'DISPOSAL_GAIN', coinType: event.coinType });
        if (!unrealGainAcct || !dispGainAcct) return { phase: 9, code: 'MAPPING_MISSING', detail: { unrealGainAcct, dispGainAcct } };
        lines.push(
          { account: unrealGainAcct, side: 'DEBIT', amountMinor: reclassDelta, origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'UNREALIZED_GAIN_RECLASS' },
          { account: dispGainAcct, side: 'CREDIT', amountMinor: reclassDelta, origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'DISPOSAL_GAIN_RECLASS' },
        );
      }
    }
    return balanceCheck(lines);
  },
  buildDisclosure: (ctx): DisclosureFact[] => {
    const fv = ctx.carry.fvFunctionalMinor as string;
    const carrying = ctx.carry.carryingMinor as string;
    return [{ kind: 'swap', detail: { acquiredCost: fv, disposedCost: carrying, gain: subMinor(fv, carrying) } }];
  },
};
