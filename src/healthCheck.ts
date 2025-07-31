import { v4 as uuidv4 } from "uuid";
import { redisClient } from "./storage";
import { getSettings } from "./config";
import { getHealth } from "./client";
import { CacheData } from "./models";

const settings = getSettings();

const CACHE_KEY = "gateway_status";
const REDIS_KEY = "leader_lock";
const LOCK_TTL = 5000; // 5 seconds
const RENEW_INTERVAL = 3; // 3 seconds

class PaymentGatewayHealthService {
  private redis = redisClient;
  private lockKey: string;
  private lockTtl: number;
  private instanceId: string;
  private isLeader: boolean = false;

  constructor(lockKey: string, lockTtl: number) {
    this.lockKey = lockKey;
    this.lockTtl = lockTtl;
    this.instanceId = uuidv4();
  }

  async tryAcquireLock(): Promise<boolean> {
    try {
      const result = await this.redis.set(this.lockKey, this.instanceId, {
        NX: true,
        PX: this.lockTtl,
      });
      return result === "OK";
    } catch (error) {
      return false;
    }
  }

  async isStillLeader(): Promise<boolean> {
    try {
      const val = await this.redis.get(this.lockKey);
      return val === this.instanceId;
    } catch (error) {
      return false;
    }
  }

  async renewLock(): Promise<void> {
    if (await this.isStillLeader()) {
      await this.redis.pExpire(this.lockKey, this.lockTtl);
    }
  }

  async start(): Promise<void> {
    while (true) {
      if (!this.isLeader) {
        const acquired = await this.tryAcquireLock();
        if (acquired) {
          this.isLeader = true;
          // Start health check loop without awaiting (similar to Python's asyncio.create_task)
          this.healthCheckLoop().catch(() => {
            this.isLeader = false;
          });
        }
      } else {
        await this.renewLock();
      }
      await this.sleep(RENEW_INTERVAL * 1000);
    }
  }

  async healthCheckLoop(): Promise<void> {
    while (this.isLeader) {
      try {
        const [defaultHealth, fallbackHealth] = await Promise.all([
          getHealth(settings.ppDefault),
          getHealth(settings.ppFallback),
        ]);

        const checkedAt = Date.now() / 1000;
        let cacheObj: CacheData;

        if (defaultHealth.failing) {
          cacheObj = { data: [settings.ppFallback, "fallback"], ts: checkedAt };
          await redisClient.set(CACHE_KEY, JSON.stringify(cacheObj));
        } else if (defaultHealth.minResponseTime < 120) {
          cacheObj = { data: [settings.ppDefault, "default"], ts: checkedAt };
          await redisClient.set(CACHE_KEY, JSON.stringify(cacheObj));
        } else if (
          !fallbackHealth.failing &&
          fallbackHealth.minResponseTime < defaultHealth.minResponseTime * 3
        ) {
          cacheObj = { data: [settings.ppFallback, "fallback"], ts: checkedAt };
          await redisClient.set(CACHE_KEY, JSON.stringify(cacheObj));
        } else {
          cacheObj = { data: [settings.ppDefault, "default"], ts: checkedAt };
          await redisClient.set(CACHE_KEY, JSON.stringify(cacheObj));
        }

        await this.sleep(5000);

        if (!(await this.isStillLeader())) {
          this.isLeader = false;
          break;
        }
      } catch (error) {
        console.error("Error in health check loop:", error);
        await this.sleep(5000);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export async function gatewayHealthCheckService(): Promise<void> {
  const ps = new PaymentGatewayHealthService(REDIS_KEY, LOCK_TTL);
  await ps.start();
}
