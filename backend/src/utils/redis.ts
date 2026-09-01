import Redis from 'ioredis';
import logger from './logger';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Initialize with maxRedirections and a forgiving connection strategy
// This ensures that if Redis is offline (e.g. locally), the application DOES NOT crash,
// but gracefully degrades to fetching data from the database directly.
const redis = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 1,
    retryStrategy(times) {
        if (times > 3) {
            logger.error('Redis connection failed after 3 attempts. Bypassing cache.');
            return null; // Stop retrying
        }
        const delay = Math.min(times * 50, 2000);
        return delay;
    },
    enableOfflineQueue: false // Do not queue commands if connection is down
});

redis.on('error', (err) => {
    logger.error(`Redis Error: ${err.message}`);
});

redis.on('connect', () => {
    logger.info('Connected to Redis caching layer.');
});

/**
 * Cache Wrapper function to seamlessly cache Prisma or DB queries
 * @param key The unique cache key
 * @param ttl Time to live in seconds
 * @param dbQuery Function that returns a Promise with the DB queried data
 * @returns Cached data or fresh DB data
 */
export async function withCache<T>(key: string, ttl: number, dbQuery: () => Promise<T>): Promise<T> {
    try {
        if (redis.status === 'ready') {
            const cached = await redis.get(key);
            if (cached) {
                // Tracking stats for the System Monitor (Mock increment)
                redis.incr('stats:redis:hits').catch(() => { });
                return JSON.parse(cached) as T;
            }
        }
    } catch (e) {
        logger.error(`Cache read failed for key ${key}: ${e}`);
    }

    // Fallback to actual database query
    const data = await dbQuery();

    try {
        if (redis.status === 'ready' && data) {
            await redis.set(key, JSON.stringify(data), 'EX', ttl);
            redis.incr('stats:redis:misses').catch(() => { });
        }
    } catch (e) {
        logger.error(`Cache write failed for key ${key}`);
    }

    return data;
}

/**
 * Invalidate a family of cache keys
 * @param pattern The pattern e.g. "ledger:*"
 */
export async function invalidateCache(pattern: string) {
    if (redis.status !== 'ready') return;
    try {
        const keys = await redis.keys(pattern);
        if (keys.length > 0) {
            await redis.del(keys);
            logger.info(`Invalidated ${keys.length} keys matching ${pattern}`);
        }
    } catch (e) {
        logger.error(`Failed to invalidate cache pattern ${pattern}`);
    }
}

export default redis;
