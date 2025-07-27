import Fastify from "fastify";
import { Type } from "@sinclair/typebox";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { consumeLoop, paymentsQueue } from "./queueWorker";
import { getSummary, purgePayments } from "./storage";
import { gatewayHealthCheckService } from "./healthCheck";

const VERSION = "v0.10.1";

const app = Fastify({
  logger: false,
}).withTypeProvider<TypeBoxTypeProvider>();

const PaymentRequestSchema = Type.Object({
  correlationId: Type.String(),
  amount: Type.Number(),
});

app.post(
  "/payments",
  {
    schema: {
      body: PaymentRequestSchema,
      response: {
        202: Type.Object({
          correlationId: Type.String(),
          amount: Type.Number(),
        }),
      },
    },
  },
  async (request, reply) => {
    const payment = request.body;
    const result = await paymentsQueue.put({
      correlationId: payment.correlationId,
      amount: payment.amount,
    });

    reply.status(202);
    return result;
  }
);

app.get(
  "/payments-summary",
  {
    schema: {
      querystring: Type.Object({
        from: Type.Optional(Type.String()),
        to: Type.Optional(Type.String()),
      }),
    },
  },
  async (request, reply) => {
    const { from, to } = request.query;

    let fromDate: Date | undefined;
    let toDate: Date | undefined;

    if (from) {
      fromDate = new Date(from);
    }
    if (to) {
      toDate = new Date(to);
    }

    return await getSummary(fromDate, toDate);
  }
);

app.post(
  "/purge-payments",
  {
    schema: {
      response: {
        200: Type.Object({
          status: Type.String(),
        }),
      },
    },
  },
  async (request, reply) => {
    await purgePayments();
    return { status: "payments purged" };
  }
);

async function main(): Promise<void> {
  console.log(`API version ${VERSION} started`);

  try {
    const serverPromise = app.listen({
      port: 9999,
      host: "0.0.0.0",
    });

    const consumePromise = consumeLoop();
    const healthCheckPromise = gatewayHealthCheckService();
    await Promise.all([serverPromise, consumePromise, healthCheckPromise]);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
