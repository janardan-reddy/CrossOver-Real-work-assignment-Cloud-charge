"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const redis = require("redis");
const memcached = require("memcached");
const util = require("util");
const KEY = `account1/balance`;
const DEFAULT_BALANCE = 100;
const MAX_EXPIRATION = 60 * 60 * 24 * 30;
const memcachedClient = new memcached(`${process.env.ENDPOINT}:${process.env.PORT}`);

let redisClient = null;


async function getCachedRedisClient() {
    if (redisClient == null) {
        redisClient = await getRedisClient();
    }
    try {
        // Even ping can be avoided, but then we need to have proper retry mechanism.
        await redisClient.ping();
    } catch (error) {
        console.warn("failed to re-use existing redis client");
        redisClient = await getRedisClient();
    }
    return redisClient;
}



exports.chargeRequestRedis = async function (input) {
    if (!isValidRequest(input)) {
        return {
            statusCode: 400,
            body: "invalid request",
        };
    }

    const redisClient = await getCachedRedisClient();
    var remainingBalance = await getBalanceRedis(redisClient, KEY);
    var charges = getCharges(input);
    const isAuthorized = authorizeRequest(remainingBalance, charges);
    if (!isAuthorized) {
        return {
            remainingBalance,
            isAuthorized,
            charges: 0,
        };
    }
    remainingBalance = await chargeRedis(redisClient, KEY, charges);
    // await disconnectRedis(redisClient);
    return {
        remainingBalance,
        charges,
        isAuthorized,
    };
};

exports.resetRedis = async function () {
    const redisClient = await getCachedRedisClient();
    const ret = new Promise((resolve, reject) => {
        redisClient.set(KEY, String(DEFAULT_BALANCE), (err, res) => {
            if (err) {
                reject(err);
            }
            else {
                resolve(DEFAULT_BALANCE);
            }
        });
    });
    // await disconnectRedis(redisClient);
    return ret;
};

exports.resetMemcached = async function () {
    var ret = new Promise((resolve, reject) => {
        memcachedClient.set(KEY, DEFAULT_BALANCE, MAX_EXPIRATION, (res, error) => {
            if (error)
                resolve(res);
            else
                reject(DEFAULT_BALANCE);
        });
    });
    return ret;
};

exports.chargeRequestMemcached = async function (input) {
    const charges = getCharges(input);
    var remainingBalance = await getBalanceMemcached(KEY);
    const isAuthorized = authorizeRequest(remainingBalance, charges);
    if (!authorizeRequest(remainingBalance, charges)) {
        return {
            remainingBalance,
            isAuthorized,
            charges: 0,
        };
    }
    remainingBalance = await chargeMemcached(KEY, charges);
    return {
        remainingBalance,
        charges,
        isAuthorized,
    };
};

async function getRedisClient() {
    return new Promise((resolve, reject) => {
        try {
            const client = new redis.RedisClient({
                host: process.env.ENDPOINT,
                port: parseInt(process.env.PORT || "6379"),
            });
            client.on("ready", () => {
                console.log('redis client ready');
                resolve(client);
            });
        }
        catch (error) {
            reject(error);
        }
    });
}

async function disconnectRedis(client) {
    return new Promise((resolve, reject) => {
        client.quit((error, res) => {
            if (error) {
                reject(error);
            }
            else if (res == "OK") {
                console.log('redis client disconnected');
                resolve(res);
            }
            else {
                reject("unknown error closing redis connection.");
            }
        });
    });
}


function authorizeRequest(remainingBalance, charges) {
    return remainingBalance >= charges;
}


function getCharges(input) {
    if (input.serviceType.toLowerCase() === "sms") return 1 * input.unit;
    if (input.serviceType.toLowerCase() === "voice") return 5 * input.unit;
    if (input.serviceType.toLowerCase() === "data") return 10 * input.unit;
}

function isValidRequest(input) {
    if (!input.serviceType || input.serviceType === "") {
        return false;
    }
    if (!input.unit || isNaN(input.unit) || input.unit < 0) {
        return false;
    }
    return true;
}


function createResponse(status, body) {
  return {
    statusCode: status,
    body: JSON.stringify(body)
  }
}

async function getBalanceRedis(redisClient, key) {
    const res = await util.promisify(redisClient.get).bind(redisClient).call(redisClient, key);
    return parseInt(res || "0");
}
async function chargeRedis(redisClient, key, charges) {
    return util.promisify(redisClient.decrby).bind(redisClient).call(redisClient, key, charges);
}
async function getBalanceMemcached(key) {
    return new Promise((resolve, reject) => {
        memcachedClient.get(key, (err, data) => {
            if (err) {
                reject(err);
            }
            else {
                resolve(Number(data));
            }
        });
    });
}
async function chargeMemcached(key, charges) {
    return new Promise((resolve, reject) => {
        memcachedClient.decr(key, charges, (err, result) => {
            if (err) {
                reject(err);
            }
            else {
                return resolve(Number(result));
            }
        });
    });
}
