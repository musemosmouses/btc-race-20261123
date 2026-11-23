// Stabilised dip-buy on cbBTC 1-minute bars (agent-fun/bars-replay/v1).
//
// Idea, from dissecting the 17 Nov race and this race's dev window: the field
// is mostly naive dip-buyers and fee-bleeding trend-chasers. A plain dip-buy
// catches dips in ANY regime, so in a falling market it buys the falling knife
// over and over (stress: -$26 to -$31 on a flipped -3.6% window). This bot
// adds two guards that turn bad regimes into a flat $0 instead of a loss:
//   1. UPTREND FILTER — it only buys while the close sits above a slow
//      240-bar EMA. Below that line it holds cash and waits, however deep
//      the dip looks.
//   2. STABILISED ENTRY — it only buys once the dip has stopped falling
//      (this close >= the previous close). The 17 Nov winner's title said
//      it plainly: "Stabilised" — wait for the dip to flatten, then enter.
// It buys 0.40% below a 96-bar EMA mean, sells the reversion (+0.50% above
// the mean) or a 0.80% stop from its fill. Full size, at most one position,
// two round trips on the whole dev window.
//
// Backtest on the frozen dev window (exact harness fill math, Python replica
// verified byte-for-byte against grade-local on the 17 Nov window):
//   net PnL +$7.12, 2 trades, max drawdown 0.87% (buy-and-hold: +$32.17).
// Stress (same code, transformed windows): reversed $0.00, -2% drift +$1.60,
// -4% drift $0.00, +2% drift +$10.40, vol x1.5 +$5.79. Worst case $0.00 —
// the filter simply never fires in a down market. The plain unfiltered
// dip-buy makes +$20.07 on dev but loses -$26.71 worst case; EMA-cross
// trend-following loses -$44 to -$119. A trailing-stop upgrade was tested
// and REJECTED (it broke the $0 floor: vol -$2.42, +2% drift -$2.79).
//
// Deterministic: EMAs in float64 (IEEE 754), no clock, no Math.random, no
// network, no files outside /bot. One position, full-size entries.

import { runBars, type Bar, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
/** Bars in the mean the dip is measured against. */
const MEAN_BARS = 96;
/** Bars in the slow trend line that gates every entry. */
const TREND_BARS = 240;
/** Buy when the close is this far below the mean, in bps. */
const DIP_BPS = 40;
/** Sell when the close is this far above the mean, in bps. */
const REVERT_BPS = 50;
/** Sell when the close is this far under the fill price, in bps. */
const STOP_BPS = 80;
/** Max move from the latest close a fill may cost, in bps. */
const MAX_SLIPPAGE_BPS = 200;

/** One exponential moving average, seeded from its first `span` closes. */
interface Ema {
  span: number;
  warm: number[];
  value: number | null;
}

function makeEma(span: number): Ema {
  return { span, warm: [], value: null };
}

function feedEma(ema: Ema, close: number): void {
  if (ema.value !== null) {
    ema.value += (2 / (ema.span + 1)) * (close - ema.value);
    return;
  }
  ema.warm.push(close);
  if (ema.warm.length === ema.span) {
    ema.value = ema.warm.reduce((a, x) => a + x, 0) / ema.span;
  }
}

const meanEma = makeEma(MEAN_BARS);
const trendEma = makeEma(TREND_BARS);
/** Fill price of the open position, in raw price units (price_scale 5). */
let entryPrice: number | null = null;
/** Close of the previous bar, for the stabilised-entry check. */
let prevClose: number | null = null;

await runBars({
  onBatch(state: BarsState, batch: { bars: Bar[]; fills: { client_id: string; symbol: string; side: string; status: string; price: string }[] }) {
    for (const bar of batch.bars) {
      if (bar.symbol === SYMBOL) {
        const close = Number(bar.c);
        feedEma(meanEma, close);
        feedEma(trendEma, close);
      }
    }
    for (const fill of batch.fills) {
      if (fill.symbol === SYMBOL && fill.status === 'filled') {
        if (fill.side === 'buy') entryPrice = Number(fill.price);
        if (fill.side === 'sell') entryPrice = null;
      }
    }
    if (state.warmingUp) return [];
    if (meanEma.value === null || trendEma.value === null) return [];
    const close = state.close(SYMBOL);
    if (close === null) return [];
    const price = Number(close);
    const mean = meanEma.value;
    const trend = trendEma.value;
    const held = state.positions.get(SYMBOL);
    const orders: (BuyInput | SellInput)[] = [];
    if (held === undefined) {
      // Uptrend filter + dip + stabilised: only buy a dip that has stopped
      // falling, while the slow trend still points up.
      const uptrend = price > trend;
      const dipped = price < (mean * (10000 - DIP_BPS)) / 10000;
      const flattened = prevClose === null || price >= prevClose;
      if (uptrend && dipped && flattened) {
        // Full size, but never past the weight cap: a buy over it is refused
        // (max_weight) and the bot would sit out the dip for nothing.
        const byWeight = (BigInt(state.hello.caps.max_weight_bps) * state.equity) / 10000n;
        const notional = state.cash < byWeight ? state.cash : byWeight;
        if (notional >= BigInt(state.hello.fees.min_notional_quote_units)) {
          orders.push({ side: 'buy', symbol: SYMBOL, notional_quote_units: notional, max_slippage_bps: MAX_SLIPPAGE_BPS });
        }
      }
      prevClose = price;
      return orders;
    }
    const reverted = price > (mean * (10000 + REVERT_BPS)) / 10000;
    const stopped = entryPrice !== null && price <= (entryPrice * (10000 - STOP_BPS)) / 10000;
    if (reverted || stopped) {
      orders.push({ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
    }
    prevClose = price;
    return orders;
  },
});
