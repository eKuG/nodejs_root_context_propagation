'use strict';

const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { BatchSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { resourceFromAttributes } = require('@opentelemetry/resources');
const { ATTR_SERVICE_NAME } = require('@opentelemetry/semantic-conventions');
const { propagation, trace, context: otelContext } = require('@opentelemetry/api');
const { CompositePropagator, W3CTraceContextPropagator, W3CBaggagePropagator } =
  require('@opentelemetry/core');

class RootSpanUtil {
  static roots = new Map();
  static withRootSpan(fn) {
    const active = trace.getActiveSpan();
    if (active) RootSpanUtil.roots.set(active.spanContext().traceId, active);
    return fn();
  }
  static setRootAttribute(key, value) {
    const active = trace.getActiveSpan();
    if (!active) return;
    (RootSpanUtil.roots.get(active.spanContext().traceId) ?? active).setAttribute(key, value);
  }
  static getRootSpan() {
    const active = trace.getActiveSpan();
    return active ? RootSpanUtil.roots.get(active.spanContext().traceId) : undefined;
  }
}

class RootSpanContextProcessor {
  roots = new Map();
  onStart(span, parentContext) {
    if (!trace.getSpan(parentContext)) {
      const id = span.spanContext().traceId;
      if (!this.roots.has(id)) this.roots.set(id, span);
    }
    propagation.getBaggage(parentContext ?? otelContext.active())
      ?.getAllEntries()
      .forEach(([k, v]) => span.setAttribute(`baggage.${k}`, v.value));
  }
  onEnd(span) {
    const { traceId } = span.spanContext();
    const root = this.roots.get(traceId);
    if (root && root !== span) {
      Object.entries(span.attributes ?? {}).forEach(([k, v]) => {
        if (k.startsWith('error_') || k === 'custom_attribute' || k === 'merchant_name') {
          root.setAttribute(k, v);
        }
      });
    }
    if (root === span) this.roots.delete(traceId);
  }
  shutdown() { this.roots.clear(); return Promise.resolve(); }
  forceFlush() { return Promise.resolve(); }
}

propagation.setGlobalPropagator(
  new CompositePropagator({
    propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
  })
);

const exporter = new OTLPTraceExporter({
  url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318/v1/traces',
});
const processors = [new RootSpanContextProcessor(), new BatchSpanProcessor(exporter)];

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: process.env.NEW_RELIC_APP_NAME ?? 'nodejs-app',
  }),
  spanProcessors: processors,
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-http': {},
      '@opentelemetry/instrumentation-fastify': {},
    }),
  ],
});
sdk.start();
console.log('🔹 OpenTelemetry tracing initialised');

async function shutdownTracing() {
  await sdk.shutdown();
}

module.exports = { RootSpanUtil, shutdownTracing };