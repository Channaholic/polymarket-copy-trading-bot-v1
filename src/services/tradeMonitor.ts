import moment from 'moment';
import { ENV } from '../config/env';
import { UserActivityInterface, UserPositionInterface } from '../interfaces/User';
import { getUserActivityModel, getUserPositionModel } from '../models/userHistory';
import fetchData from '../utils/fetchData';

const USER_ADDRESS = ENV.USER_ADDRESS;
const TOO_OLD_TIMESTAMP = ENV.TOO_OLD_TIMESTAMP;
const FETCH_INTERVAL = ENV.FETCH_INTERVAL;

if (!USER_ADDRESS) {
    throw new Error('USER_ADDRESS is not defined');
}

const UserActivity = getUserActivityModel(USER_ADDRESS);
const UserPosition = getUserPositionModel(USER_ADDRESS);

let temp_trades: UserActivityInterface[] = [];

const init = async () => {
    // Load existing trades from the DB to prevent processing duplicates on restart
    temp_trades = (await UserActivity.find().exec()).map(
        (trade) => trade.toObject() as UserActivityInterface
    );
    console.log(`Initialized with ${temp_trades.length} existing trades from the database.`);
};

const fetchTradeData = async () => {
    try {
        const url = `https://data-api.polymarket.com/activity?user=${USER_ADDRESS}`;
        const fetchedActivities: UserActivityInterface[] = await fetchData(url);

        if (!fetchedActivities || !Array.isArray(fetchedActivities)) {
            // console.log('No new activities found or bad response.');
            return;
        }

        // Process trades from oldest to newest
        const reversedActivities = fetchedActivities.reverse();

        for (const activity of reversedActivities) {
            // We only care about actual trades
            if (activity.type !== 'TRADE') {
                continue;
            }

            const isTooOld =
                moment().diff(moment.unix(activity.timestamp), 'hours') > TOO_OLD_TIMESTAMP;
            const isDuplicate = temp_trades.some(
                (t) => t.transactionHash === activity.transactionHash
            );

            if (!isTooOld && !isDuplicate) {
                console.log(
                    `New trade found: ${activity.title}, Side: ${activity.side}, Size: ${activity.size}`
                );

                const new_trade_to_copy: Partial<UserActivityInterface> = {
                    ...activity,
                    bot: false, // Mark as not yet copied
                    botExcutedTime: 0, // Initialize retry counter
                };

                // Save the new trade to the database and our temporary list
                await UserActivity.create(new_trade_to_copy);
                temp_trades.push(activity);
            }
        }
    } catch (error) {
        console.error('Error fetching trade data:', error);
    }
};

const tradeMonitor = async () => {
    console.log('Trade Monitor is running every', FETCH_INTERVAL, 'seconds');
    await init(); //Load my orders before server downs
    while (true) {
        await fetchTradeData(); //Fetch all user activities
        await new Promise((resolve) => setTimeout(resolve, FETCH_INTERVAL * 1000)); //Fetch user activities every second
    }
};

export default tradeMonitor;
