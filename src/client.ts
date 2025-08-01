import { request } from "undici";
import { getSettings } from "./config";
import { redisClient } from "./storage";
import { GatewayHealth, CacheData } from "./models";
import fastJson from "fast-json-stringify";

const settings = getSettings();
const CACHE_KEY = "gateway_status";

const localCache: { cache: CacheData | null } = {
  cache: null,
};

const stringify = fastJson({
  title: "Payment",
  type: "object",
  properties: {
    correlationId: {
      type: "string",
    },
    amount: {
      type: "number",
    },
    requestedAt: {
      type: "string",
    },
  },
});

export async function getHealth(url: string): Promise<GatewayHealth> {
  try {
    const resp = await request(`${url}/payments/service-health`, {
      method: "GET",
      bodyTimeout: 1_000,
      headersTimeout: 1_000,
      headers: {
        Connection: "keep-alive",
      },
    });

    if (resp.statusCode !== 200) {
      return { failing: true, minResponseTime: 10_000 };
    }

    const data = (await resp.body.json()) as GatewayHealth;
    return data;
  } catch (error) {
    if (error instanceof Error && error.name === "HeadersTimeoutError") {
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
    const r = await request(`${dest}/payments`, {
      method: "POST",
      bodyTimeout: 10_000,
      headersTimeout: 10_000,
      headers: {
        "Content-Type": "application/json",
        Connection: "keep-alive",
      },
      body: stringify(payload),
    });
    return r.statusCode === 200;
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
