import { createClient, RedisClientType } from "redis";
import { PaymentSummary } from "./models";
import fastJson from "fast-json-stringify";

const redisClient: RedisClientType = createClient({
  socket: {
    path: "/var/run/redis/redis.sock",
    tls: false,
  },
});

redisClient.connect().catch(console.error);

const ZSET_KEY = "payments_by_date";

const stringify = fastJson({
  title: "Payment",
  type: "object",
  properties: {
    correlation_id: {
      type: "string",
    },
    amount: {
      type: "number",
    },
    processor: {
      type: "string",
    },
    requested_at: {
      type: "number",
    },
  },
});

export function savePayment(
  cid: string,
  amount: number,
  processor: string,
  requestedAt: Date
): void {
  const timestamp = requestedAt.getTime() / 1000;

  const paymentJson = stringify({
    correlation_id: cid,
    amount: amount,
    processor: processor,
    requested_at: timestamp,
  });

  redisClient
    .zAdd(ZSET_KEY, {
      score: timestamp,
      value: paymentJson,
    })
    .catch(console.error);
}

export async function getSummary(
  tsFrom?: Date,
  tsTo?: Date
): Promise<PaymentSummary> {
  const minScore = tsFrom ? (tsFrom.getTime() / 1000).toString() : "-inf";
  const maxScore = tsTo ? (tsTo.getTime() / 1000).toString() : "+inf";

  const payments = await redisClient.zRangeByScore(
    ZSET_KEY,
    minScore,
    maxScore
  );

  const summary: PaymentSummary = {
    default: { totalRequests: 0, totalAmount: 0.0 },
    fallback: { totalRequests: 0, totalAmount: 0.0 },
  };

  for (const paymentJson of payments) {
    const processorMatch = paymentJson.match(/"processor":"([^"]+)"/);
    const amountMatch = paymentJson.match(/"amount":([0-9]+(?:\.[0-9]+)?)/);

    if (processorMatch && amountMatch) {
      const processor = processorMatch[1] as keyof PaymentSummary;
      const amount = parseFloat(amountMatch[1]);

      if (summary[processor]) {
        summary[processor].totalRequests += 1;
        summary[processor].totalAmount += amount;
      }
    }
  }

  summary.default.totalAmount =
    Math.round(summary.default.totalAmount * 10) / 10;
  summary.fallback.totalAmount =
    Math.round(summary.fallback.totalAmount * 10) / 10;

  return summary;
}

export async function purgePayments(): Promise<void> {
  await redisClient.del(ZSET_KEY);
}

export { redisClient };
