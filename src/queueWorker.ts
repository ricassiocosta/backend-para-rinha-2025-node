import { getHealthierGateway, sendPayment } from "./client";
import { savePayment } from "./storage";
import { QueueItem } from "./models";

const MAX_PARALLELISM = parseInt(process.env.MAX_PARALLELISM || "2");

class AsyncQueue<T> {
  private items: T[] = [];
  private resolvers: Array<(value: T) => void> = [];
  private maxSize: number;
  private head: number = 0;

  constructor(maxSize: number = 50000) {
    this.maxSize = maxSize;
  }

  async put(item: T): Promise<{ correlationId: string; amount: number }> {
    if (this.items.length - this.head >= this.maxSize) {
      throw new Error("Queue is full");
    }

    if (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift()!;
      resolve(item);
    } else {
      this.items.push(item);
    }

    return item as { correlationId: string; amount: number };
  }

  async get(): Promise<T> {
    if (this.head < this.items.length) {
      const item = this.items[this.head];
      this.head++;
      // Reset array to avoid memory leak when it gets too big
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

export const paymentsQueue = new AsyncQueue<QueueItem>(50000);

export async function addToQueue(cid: string, amount: number): Promise<void> {
  const data = { correlationId: cid, amount: amount };
  await paymentsQueue.put(data);
}

async function worker(workerId: number): Promise<void> {
  while (true) {
    const requestedAt = new Date();
    try {
      const item = await paymentsQueue.get();

      try {
        const [healthierGateway, gatewayName] = await getHealthierGateway();

        const success = await sendPayment(
          healthierGateway,
          item.correlationId,
          item.amount,
          requestedAt
        );
        if (!success) {
          throw new Error(
            `Failed to send payment for ${item.correlationId} to ${healthierGateway}`
          );
        }

        savePayment(item.correlationId, item.amount, gatewayName, requestedAt);
      } catch (e) {
        console.log(`[ERRO] Worker ${workerId}: ${e}. Sending back to queue.`);
        await paymentsQueue.put(item);
      }
    } catch (e) {
      console.log(`[ERRO] Worker ${workerId} ${e}`);
    }
  }
}

export async function consumeLoop(): Promise<void> {
  const tasks = Array.from({ length: MAX_PARALLELISM }, (_, i) => worker(i));
  await Promise.all(tasks);
}
