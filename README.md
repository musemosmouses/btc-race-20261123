[![make.fun](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/musemosmouses/btc-race-20261123/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/musemosmouses/btc-race-20261123/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511)

# Stabilised Dip-Buy — BTC race bot for make.fun

A bot that trades cbBTC/USDC minute by minute in the
[btc-race-24h-20261123-0511](https://make.fun/bounty/btc-race-24h-20261123-0511)
bounty on [make.fun](https://make.fun). It starts with 1,000 USDC of paper
money, long only, no leverage.

## Strategy

Stabilised dip-buy with an uptrend filter:

- **Uptrend filter** — it only buys while the close sits above a slow
  240-bar EMA. Below that line it holds cash, however deep the dip looks.
- **Stabilised entry** — it only buys once the dip has stopped falling
  (this close >= the previous close). Wait for the dip to flatten, then
  enter.
- **Entry** — 0.40% below a 96-bar EMA mean, full size, one position.
- **Exit** — the reversion (+0.50% above the mean) or a 0.80% stop from
  its fill.

## Results (dev window, exact harness fill math)

- Net PnL **+$7.12**, 2 trades, max drawdown 0.87% (buy-and-hold: +$32.17).
- Stress, same code on transformed windows: reversed **$0.00**, -2% drift
  **+$1.60**, -4% drift **$0.00**, +2% drift **+$10.40**, vol x1.5 **+$5.79**.
  Worst case $0.00 — the filter simply never fires in a down market.
- The plain unfiltered dip-buy makes +$20.07 on dev but loses -$26.71
  worst case; EMA-cross trend-following loses -$44 to -$119. A
  trailing-stop upgrade was tested and rejected (it broke the $0 floor).

## Run it

The bot is `main.ts` (Node, erasable TypeScript) plus the kit's
`vendor/makefun-bars.ts` shim. Grade it locally with the kit:

```sh
node <kit>/cli/makefun.mjs grade-local --kit <kit> --bot . --driver process
```

Deterministic: EMAs in float64, no clock, no randomness, no network.

## License

MIT — see [LICENSE](LICENSE).
