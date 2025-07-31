import { createClient, RedisClientType } from "redis";
import { PaymentSummary } from "./models";

const redisClient: RedisClientType = createClient({
  socket: {
    path: "/var/run/redis/redis.sock",
    tls: false,
  },
});

redisClient.connect().catch(console.error);

const ZSET_KEY = "payments_by_date";

export function savePayment(
  cid: string,
  amount: number,
  processor: string,
  requestedAt: Date
): void {
  const timestamp = requestedAt.getTime() / 1000;

  const paymentJson = JSON.stringify({
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

  const summary = payments.reduce(
    (acc, json) => {
      const { processor, amount } = JSON.parse(json) as {
        processor: keyof PaymentSummary;
        amount: number;
      };

      if (acc[processor]) {
        acc[processor].totalRequests++;
        acc[processor].totalAmount += amount;
      }

      return acc;
    },
    {
      default: { totalRequests: 0, totalAmount: 0 },
      fallback: { totalRequests: 0, totalAmount: 0 },
    } as PaymentSummary
  );

  (["default", "fallback"] as const).forEach((key) => {
    summary[key].totalAmount = Math.round(summary[key].totalAmount * 10) / 10;
  });

  return summary;
}

export async function purgePayments(): Promise<void> {
  await redisClient.del(ZSET_KEY);
}

export { redisClient };
