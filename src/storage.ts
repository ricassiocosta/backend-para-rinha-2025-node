import { createClient, RedisClientType } from "redis";
import { PaymentSummary } from "./models";

const redisClient: RedisClientType = createClient({
  socket: {
    path: "/var/run/redis/redis.sock",
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

  const summary: PaymentSummary = {
    default: { totalRequests: 0, totalAmount: 0.0 },
    fallback: { totalRequests: 0, totalAmount: 0.0 },
  };

  for (const paymentJson of payments) {
    const p = JSON.parse(paymentJson);
    const processor = p.processor as keyof PaymentSummary;
    const amount = p.amount;

    if (summary[processor]) {
      summary[processor].totalRequests += 1;
      summary[processor].totalAmount += amount;
    }
  }

  for (const key of Object.keys(summary) as Array<keyof PaymentSummary>) {
    summary[key].totalAmount = Math.round(summary[key].totalAmount * 10) / 10;
  }

  return summary;
}

export async function purgePayments(): Promise<void> {
  await redisClient.del(ZSET_KEY);
}

export { redisClient };
