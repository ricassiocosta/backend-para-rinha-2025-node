import axios, { AxiosInstance } from "axios";
import { getSettings } from "./config";
import { redisClient } from "./storage";
import { GatewayHealth, CacheData } from "./models";

const settings = getSettings();
const CACHE_KEY = "gateway_status";

const localCache: { cache: CacheData | null } = {
  cache: null,
};

const client: AxiosInstance = axios.create({
  timeout: 5000,
  headers: {
    Connection: "keep-alive",
  },
});

export async function getHealth(url: string): Promise<GatewayHealth> {
  try {
    const resp = await client.get(`${url}/payments/service-health`, {
      timeout: 5000,
    });

    if (resp.status !== 200) {
      return { failing: true, minResponseTime: 10_000 };
    }

    return resp.data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.code === "ECONNABORTED") {
      console.log(`[WARN] Timeout while checking health for ${url}`);
    }
    return { failing: true, minResponseTime: 10_000 };
  }
}

export async function sendPayment(
  dest: string,
  cid: string,
  amount: number,
  requestedAt: Date
): Promise<boolean> {
  const payload = {
    correlationId: cid,
    amount: amount,
    requestedAt: requestedAt.toISOString(),
  };

  try {
    const r = await client.post(`${dest}/payments`, payload);
    return r.status === 200;
  } catch (error) {
    return false;
  }
}

export async function getHealthierGateway(): Promise<[string, string]> {
  if (localCache.cache && Date.now() / 1000 - localCache.cache.ts < 5) {
    return localCache.cache.data;
  }

  try {
    const cached = await redisClient.get(CACHE_KEY);
    if (cached) {
      const cachedObj: CacheData = JSON.parse(cached);
      localCache.cache = cachedObj;
      return cachedObj.data;
    }
  } catch (error) {
    // If cache is empty or invalid, default to the primary gateway
  }

  return [settings.ppDefault, "default"];
}
