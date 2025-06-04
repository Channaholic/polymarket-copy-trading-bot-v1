import { ClobClient, OrderType, Side } from '@polymarket/clob-client';
import { UserActivityInterface, UserPositionInterface } from '../interfaces/User';
import { getUserActivityModel } from '../models/userHistory';
import { ENV } from '../config/env';
import { sizeByHistoricalMax, pctOfBalance } from './buySizer';   // pick any sizer


const RETRY_LIMIT = ENV.RETRY_LIMIT;
const USER_ADDRESS = ENV.USER_ADDRESS;
const UserActivity = getUserActivityModel(USER_ADDRESS);

/** Allow plug-in buy sizing */
export type BuyPositionSizer = (
    trade: UserActivityInterface,
    myBalance: number,
    userBalance: number
) => number;

/** Default (old) buy sizing */
const defaultBuySizer: BuyPositionSizer = (trade, myBalance, userBalance) => {
    const ratio = myBalance / (userBalance + trade.usdcSize);
    return trade.usdcSize * ratio;
};

const buySizer = pctOfBalance(0.01);


const postOrder = async (
    clobClient: ClobClient,
    condition: string,
    my_position: UserPositionInterface | undefined,
    user_position: UserPositionInterface | undefined,
    trade: UserActivityInterface,
    my_balance: number,
    user_balance: number,
    buySizer: BuyPositionSizer = defaultBuySizer // default stays; you override it
) => {
    /* ─────────────────────────── MERGE ─────────────────────────── */
    if (condition === 'merge') {
        console.log('Merging Strategy...');
        if (!my_position) {
            console.log('my_position is undefined');
            await UserActivity.updateOne({ _id: trade._id }, { bot: true });
            return;
        }

        let remaining = my_position.size;
        let retry = 0;

        while (remaining > 0 && retry < RETRY_LIMIT) {
            const orderBook = await clobClient.getOrderBook(trade.asset);
            if (!orderBook.bids?.length) {
                console.log('No bids found');
                await UserActivity.updateOne({ _id: trade._id }, { bot: true });
                break;
            }

            const maxPriceBid = orderBook.bids.reduce(
                (max, bid) => (+bid.price > +max.price ? bid : max),
                orderBook.bids[0]
            );

            const orderArgs = {
                side: Side.SELL,
                tokenID: my_position.asset,
                amount: Math.min(remaining, +maxPriceBid.size),
                price: +maxPriceBid.price,
            };

            console.log('Order args:', orderArgs);
            const signed = await clobClient.createMarketOrder(orderArgs);
            const resp = await clobClient.postOrder(signed, OrderType.FOK);

            if (resp.success) {
                retry = 0;
                remaining -= orderArgs.amount;
            } else {
                retry++;
                console.log('Error posting order: retrying...', resp);
            }
        }

        await UserActivity.updateOne(
            { _id: trade._id },
            retry >= RETRY_LIMIT ? { bot: true, botExcutedTime: retry } : { bot: true }
        );
    } else if (condition === 'buy') {
        /* ─────────────────────────── BUY ─────────────────────────── */
        console.log('Buy Strategy...');
        let remaining = buySizer(trade, my_balance, user_balance); // ← custom sizing
        console.log('remaining', remaining);

        let retry = 0;

        while (remaining > 0 && retry < RETRY_LIMIT) {
            const orderBook = await clobClient.getOrderBook(trade.asset);
            if (!orderBook.asks?.length) {
                console.log('No asks found');
                await UserActivity.updateOne({ _id: trade._id }, { bot: true });
                break;
            }

            const minPriceAsk = orderBook.asks.reduce(
                (min, ask) => (+ask.price < +min.price ? ask : min),
                orderBook.asks[0]
            );

            if (+minPriceAsk.price - 0.05 > trade.price) {
                console.log('Too big different price - do not copy');
                await UserActivity.updateOne({ _id: trade._id }, { bot: true });
                break;
            }

            const affordable = +minPriceAsk.size * +minPriceAsk.price;
            const orderArgs = {
                side: Side.BUY,
                tokenID: trade.asset,
                amount: Math.min(remaining, affordable),
                price: +minPriceAsk.price,
            };

            console.log('Order args:', orderArgs);
            const signed = await clobClient.createMarketOrder(orderArgs);
            const resp = await clobClient.postOrder(signed, OrderType.FOK);

            if (resp.success) {
                retry = 0;
                remaining -= orderArgs.amount;
            } else {
                retry++;
                console.log('Error posting order: retrying...', resp);
            }
        }

        await UserActivity.updateOne(
            { _id: trade._id },
            retry >= RETRY_LIMIT ? { bot: true, botExcutedTime: retry } : { bot: true }
        );
    } else if (condition === 'sell') {
        /* ─────────────────────────── SELL ─────────────────────────── */
        console.log('Sell Strategy...');
        let remaining = 0;

        if (!my_position) {
            console.log('No position to sell');
            await UserActivity.updateOne({ _id: trade._id }, { bot: true });
            return;
        }

        if (!user_position) {
            remaining = my_position.size;
        } else {
            const ratio = trade.size / (user_position.size + trade.size);
            remaining = my_position.size * ratio;
        }

        let retry = 0;

        while (remaining > 0 && retry < RETRY_LIMIT) {
            const orderBook = await clobClient.getOrderBook(trade.asset);
            if (!orderBook.bids?.length) {
                console.log('No bids found');
                await UserActivity.updateOne({ _id: trade._id }, { bot: true });
                break;
            }

            const maxPriceBid = orderBook.bids.reduce(
                (max, bid) => (+bid.price > +max.price ? bid : max),
                orderBook.bids[0]
            );

            const orderArgs = {
                side: Side.SELL,
                tokenID: trade.asset,
                amount: Math.min(remaining, +maxPriceBid.size),
                price: +maxPriceBid.price,
            };

            console.log('Order args:', orderArgs);
            const signed = await clobClient.createMarketOrder(orderArgs);
            const resp = await clobClient.postOrder(signed, OrderType.FOK);

            if (resp.success) {
                retry = 0;
                remaining -= orderArgs.amount;
            } else {
                retry++;
                console.log('Error posting order: retrying...', resp);
            }
        }

        await UserActivity.updateOne(
            { _id: trade._id },
            retry >= RETRY_LIMIT ? { bot: true, botExcutedTime: retry } : { bot: true }
        );
    } else {
        /* ─────────────────────────── OTHER ─────────────────────────── */
        console.log('Condition not supported');
    }
};

export default postOrder;
