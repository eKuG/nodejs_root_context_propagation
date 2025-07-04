'use strict';

const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');

const { BatchSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');

const { resourceFromAttributes } = require('@opentelemetry/resources');
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');

const { propagation, trace, context: otelContext } = require('@opentelemetry/api');
const {
  CompositePropagator,
  W3CTraceContextPropagator,
  W3CBaggagePropagator,
} = require('@opentelemetry/core');


class RootSpanUtil {
  static _rootMap = new Map();           

  static withRootSpan(fn) {
    const active = trace.getActiveSpan();
    if (active) {
      this._rootMap.set(active.spanContext().traceId, active);
    }
    return fn();
  }

  static setRootAttribute(key, value) {
    const active = trace.getActiveSpan();
    if (!active) return;
    const root = this._rootMap.get(active.spanContext().traceId);
    (root ?? active).setAttribute(key, value);
  }

  static getRootSpan() {
    const active = trace.getActiveSpan();
    return active ? this._rootMap.get(active.spanContext().traceId) : undefined;
  }
}


class RootSpanContextProcessor {
  constructor() {
    this._rootSpans = new Map();
  }

  onStart(span, parentContext) {
    if (!trace.getSpan(parentContext)) {
      const id = span.spanContext().traceId;
      if (!this._rootSpans.has(id)) this._rootSpans.set(id, span);
    }

    const bag = propagation.getBaggage(parentContext ?? otelContext.active());
    bag?.getAllEntries().forEach(([k, v]) =>
      span.setAttribute(`baggage.${k}`, v.value)
    );
  }

  onEnd(span) {
    const { traceId } = span.spanContext();
    const root = this._rootSpans.get(traceId);

    if (root && root !== span) {
      for (const [k, v] of Object.entries(span.attributes ?? {})) {
        if (
          k.startsWith('error_') ||
          k === 'custom_attribute' ||
          k === 'merchant_name'
        ) {
          root.setAttribute(k, v);
        }
      }
    }

    if (root === span) this._rootSpans.delete(traceId); 
  }

  shutdown() { this._rootSpans.clear(); return Promise.resolve(); }
  forceFlush() { return Promise.resolve(); }
}


class CompositeSpanProcessor {
  constructor(processors) {
    this._ps = processors;
  }
  onStart(s, c) { this._ps.forEach((p) => p.onStart(s, c)); }
  onEnd(s)      { this._ps.forEach((p) => p.onEnd(s)); }
  shutdown()    { return Promise.all(this._ps.map((p) => p.shutdown())); }
  forceFlush()  { return Promise.all(this._ps.map((p) => p.forceFlush())); }
}


propagation.setGlobalPropagator(
  new CompositePropagator({
    propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
  })
);

const exporter = new OTLPTraceExporter({
  url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces',
});


const spanProcessor = new CompositeSpanProcessor([
  new RootSpanContextProcessor(),           
  new BatchSpanProcessor(exporter),         
]);

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [SemanticResourceAttributes.SERVICE_NAME]:
      process.env.NEW_RELIC_APP_NAME || 'nodejs-app',
  }),

  spanProcessor,  
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-http': {},
      '@opentelemetry/instrumentation-fastify': {},
    }),
  ],
});

try {
  sdk.start();                                 
  console.log('OpenTelemetry tracing initialised');
} catch (err) {
  console.error('Failed to start OpenTelemetry SDK', err);
  process.exit(1);
}


async function shutdownTracing() {
  await sdk.shutdown();
}

module.exports = { RootSpanUtil, shutdownTracing };