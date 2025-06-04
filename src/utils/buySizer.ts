import { BuyPositionSizer } from './postOrder';

/* ------------------------------------------------------------------ */
/* 1)  Floor $1 → scale by leader ratio → cap at 5 % of my balance   */
/* ------------------------------------------------------------------ */
export const min1Cap5Pct: BuyPositionSizer = (trade, myBal, leaderBal) => {
    const raw = (myBal / (leaderBal + trade.usdcSize)) * trade.usdcSize;
    return Math.max(1, Math.min(raw, 0.05 * myBal));
};

/* ------------------------------ */
/* 2)  Fixed notional (with caps) */
/* ------------------------------ */
export const fixedNotional =
    (usd: number): BuyPositionSizer =>
    (_trade, myBal, _leaderBal) =>
        Math.min(Math.max(1, usd), 0.05 * myBal);

/* --------------------------------------- */
/* 3)  Simple % of my balance (e.g. 2 %)   */
/* --------------------------------------- */
export const pctOfBalance =
    (pct: number): BuyPositionSizer =>
    (_trade, myBal, _leaderBal) =>
        Math.max(1, pct * myBal);

/* -------------------------------------------------------------------- */
/* 4)  Scale vs. leader’s historical-max trade (default 1 300 USD)      */
/*     → 0 USD → $1,  maxTradeUSD → 5 % of my balance                   */
/* -------------------------------------------------------------------- */
export const sizeByHistoricalMax =
    (maxTradeUSD = 1300, capPct = 0.05): BuyPositionSizer =>
    (trade, myBal, _leaderBal) => {
        const cap = capPct * myBal; // 5 % ceiling
        const factor = Math.min(trade.usdcSize, maxTradeUSD) / maxTradeUSD;
        const rawSize = factor * cap;
        return Math.max(1, rawSize); // $1 floor
    };
