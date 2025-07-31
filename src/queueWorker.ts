import { getHealthierGateway, sendPayment } from "./client";
import { savePayment } from "./storage";
import { QueueItem } from "./models";

const MAX_PARALLELISM = parseInt(process.env.MAX_PARALLELISM || "2");
const MAX_ATTEMPTS = 5;

class AsyncQueue<T> {
  private items: T[] = [];
  private resolvers: Array<(value: T) => void> = [];
  private maxSize: number;
  private head: number = 0;

  constructor(maxSize: number = 50000) {
    this.maxSize = maxSize;
  }

  async put(item: T): Promise<void> {
    if (this.items.length - this.head >= this.maxSize) {
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
    if (this.head < this.items.length) {
      const item = this.items[this.head];
      this.head++;

      if (this.head > 10000 && this.head * 2 > this.items.length) {
        this.items = this.items.slice(this.head);
        this.head = 0;
      }

      return item;
    }

    return new Promise<T>((resolve) => {
      this.resolvers.push(resolve);
    });
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
            `[FALHA PERMANENTE] Worker ${workerId}: ${
              item.correlationId
            } após ${attempts + 1} tentativas`
          );
          continue;
        }

        const backoff = Math.min(1000 * Math.pow(2, attempts), 15000);
        await delay(backoff);
        await paymentsQueue.put({ ...item, attempts: attempts + 1 });
      }
    } catch (e) {
      console.error(`[ERRO GERAL] Worker ${workerId}: ${e}`);
      await delay(100);
    }
  }
}

export async function consumeLoop(): Promise<void> {
  const tasks = Array.from({ length: MAX_PARALLELISM }, (_, i) => worker(i));
  await Promise.all(tasks);
}
