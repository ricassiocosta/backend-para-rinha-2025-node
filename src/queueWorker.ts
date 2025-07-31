import { getHealthierGateway, sendPayment } from "./client";
import { savePayment } from "./storage";
import { QueueItem } from "./models";

const MAX_PARALLELISM = parseInt(process.env.MAX_PARALLELISM || "2");
const MAX_ATTEMPTS = 5;

class AsyncQueue<T> {
  private items: T[] = [];
  private resolvers: Array<(value: T) => void> = [];
  private maxSize: number;

  constructor(maxSize: number = 50000) {
    this.maxSize = maxSize;
  }

  async put(item: T): Promise<void> {
    if (this.items.length >= this.maxSize) {
      throw new Error("Queue is full");
    }

    if (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift()!;
      resolve(item);
    } else {
      this.items.push(item);
    }
  }

  async get(): Promise<T> {
    const item = this.items.shift();
    if (item !== undefined) {
      return item;
    }

    return new Promise<T>((resolve) => {
      this.resolvers.push(resolve);
    });
  }

  size(): number {
    return this.items.length;
  }
}

export const paymentsQueue = new AsyncQueue<QueueItem & { attempts?: number }>(
  50000
);

export async function addToQueue(cid: string, amount: number): Promise<void> {
  await paymentsQueue.put({ correlationId: cid, amount, attempts: 0 });
}

function delay(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

async function worker(workerId: number): Promise<void> {
  while (true) {
    try {
      const item = await paymentsQueue.get();
      const requestedAt = new Date();
      const attempts = item.attempts ?? 0;

      processPaymentAsync(item, requestedAt, attempts, workerId).catch((e) =>
        console.error(`Worker ${workerId} async error:`, e)
      );
    } catch (e) {
      console.error(`[ERRO GERAL] Worker ${workerId}: ${e}`);
      await delay(100);
    }
  }
}

async function processPaymentAsync(
  item: QueueItem & { attempts?: number },
  requestedAt: Date,
  attempts: number,
  workerId: number
): Promise<void> {
  try {
    const [healthierGateway, gatewayName] = await getHealthierGateway();

    const success = await sendPayment(
      healthierGateway,
      item.correlationId,
      item.amount,
      requestedAt
    );

    if (!success) throw new Error("Payment failed");

    savePayment(item.correlationId, item.amount, gatewayName, requestedAt);
  } catch (e) {
    if (attempts + 1 >= MAX_ATTEMPTS) {
      console.error(
        `[FALHA PERMANENTE] Worker ${workerId}: ${item.correlationId} após ${
          attempts + 1
        } tentativas`
      );
      return;
    }

    const backoff = Math.min(1000 * Math.pow(2, attempts), 15000);
    setTimeout(async () => {
      try {
        await paymentsQueue.put({ ...item, attempts: attempts + 1 });
      } catch (queueError) {
        console.error(`[ERRO QUEUE] Worker ${workerId}: ${queueError}`);
      }
    }, backoff);
  }
}

export async function consumeLoop(): Promise<void> {
  const tasks = Array.from({ length: MAX_PARALLELISM }, (_, i) => worker(i));
  await Promise.all(tasks);
}
