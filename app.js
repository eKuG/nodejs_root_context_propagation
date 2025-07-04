'use strict';

const { RootSpanUtil, shutdownTracing } = require('./tracing');

const fastify = require('fastify')({ logger: true });
const { trace } = require('@opentelemetry/api');


fastify.get('/test', async (request, reply) => {
  /* Wrap everything in the same root-span context */
  return RootSpanUtil.withRootSpan(async () => {
    const tracer = trace.getTracer('demo');

    /* Child span */
    await tracer.startActiveSpan('child-work', async (span) => {
      try {
        /* Set attributes that should be propagated to the root span */
        span.setAttribute('custom_attribute', 'value-from-child');
        span.setAttribute('merchant_name', 'Acme Corp');
        span.setAttribute('error_code', 'E123');
        await new Promise((res) => setTimeout(res, 50));
      } finally {
        span.end();       
      }
    });

    /* ❸ Inspect the root span right away */
    const root = RootSpanUtil.getRootSpan();
    if (root) {
      console.log('Root-span attribute snapshot:', root.attributes);
    } else {
      console.log('No root span found');
    }

    return { ok: true, note: 'Check console for root-span attributes' };
  });
});


const PORT = 3000;
fastify.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  console.log('http://localhost:${PORT}/test`);
});


async function gracefulShutdown() {
  try {
    console.log(' Shutting down');
    await fastify.close();
    await shutdownTracing();     
    console.log('Clean exit');
    process.exit(0);
  } catch (e) {
    console.error('Error during shutdown', e);
    process.exit(1);
  }
}

process.once('SIGINT', gracefulShutdown);
process.once('SIGTERM', gracefulShutdown);
