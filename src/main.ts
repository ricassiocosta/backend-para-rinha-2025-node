import Fastify from "fastify";
import { Type } from "@sinclair/typebox";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { consumeLoop, paymentsQueue } from "./queueWorker";
import { getSummary, purgePayments } from "./storage";
import { gatewayHealthCheckService } from "./healthCheck";

const VERSION = "v0.1.6";

const app = Fastify({
  logger: false,
  disableRequestLogging: true,
  ignoreTrailingSlash: true,
  maxParamLength: 100,
  bodyLimit: 1048576, // 1MB
  keepAliveTimeout: 50000,
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
    },
  },
  (request, reply) => {
    paymentsQueue.put(request.body);
    reply.status(202).send();
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

    const summary = await getSummary(fromDate, toDate);
    reply.status(200).send(summary);
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
  async (_, reply) => {
    await purgePayments();
    reply.status(200).send();
  }
);

async function main(): Promise<void> {
  console.log(`API version ${VERSION} started`);

  try {
    await app.listen({
      port: 9999,
      host: "0.0.0.0",
    });

    const consumePromise = consumeLoop();
    const healthCheckPromise = gatewayHealthCheckService();
    await Promise.all([consumePromise, healthCheckPromise]);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
