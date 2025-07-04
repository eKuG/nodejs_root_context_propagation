// tracing.ts  –  OpenTelemetry bootstrap & root-span util  (TypeScript)
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

import {
  BatchSpanProcessor,
  ReadableSpan,
  SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

import { resourceFromAttributes } from '@opentelemetry/resources';
import { AttributeValue } from '@opentelemetry/api';

import {
  propagation,
  trace,
  context as otelContext,
  Span,
  Context,
} from '@opentelemetry/api';
import {
  CompositePropagator,
  W3CTraceContextPropagator,
  W3CBaggagePropagator,
} from '@opentelemetry/core';

export class RootSpanUtil {
  /** Map<traceId, Span> */
  private static roots = new Map<string, Span>();

  static withRootSpan<T>(fn: () => Promise<T> | T): Promise<T> | T {
    const active = trace.getActiveSpan();
    if (active) {
      RootSpanUtil.roots.set(active.spanContext().traceId, active);
    }
    return fn();
  }

  static setRootAttribute(key: string, value: AttributeValue): void {
    const active = trace.getActiveSpan();
    if (!active) return;
    const root = RootSpanUtil.roots.get(active.spanContext().traceId) ?? active;
    root.setAttribute(key, value);
  }

  static getRootSpan(): Span | undefined {
    const active = trace.getActiveSpan();
    return active ? RootSpanUtil.roots.get(active.spanContext().traceId) : undefined;
  }
}

class RootSpanContextProcessor implements SpanProcessor {
  private roots = new Map<string, Span>();

  onStart(span: Span, parentContext: Context): void {
    // True root = no parent span
    if (!trace.getSpan(parentContext)) {
      const id = span.spanContext().traceId;
      if (!this.roots.has(id)) this.roots.set(id, span);
    }

    propagation
      .getBaggage(parentContext ?? otelContext.active())
      ?.getAllEntries()
      .forEach(([k, v]) => span.setAttribute(`baggage.${k}`, v.value));
  }

  onEnd(span: ReadableSpan): void {
    const { traceId } = span.spanContext();
    const root = this.roots.get(traceId);

    if (root && root !== (span as unknown as Span)) {
      for (const [k, v] of Object.entries(span.attributes)) {
        if (
          k.startsWith('error_') ||
          k === 'custom_attribute' ||
          k === 'merchant_name'
        ) {
          root.setAttribute(k, v as AttributeValue);
        }
      }
    }

    if (root === (span as unknown as Span)) this.roots.delete(traceId);
  }

  shutdown(): Promise<void> {
    this.roots.clear();
    return Promise.resolve();
  }
  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

propagation.setGlobalPropagator(
  new CompositePropagator({
    propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
  })
);


const exporter = new OTLPTraceExporter({
  url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318/v1/traces',
});

const spanProcessors: SpanProcessor[] = [
  new RootSpanContextProcessor(),
  new BatchSpanProcessor(exporter),
];


const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    'service.name': process.env.NEW_RELIC_APP_NAME ?? 'nodejs-app',
  }),
  spanProcessors, 
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-http': {},
      '@opentelemetry/instrumentation-fastify': {},
    }),
  ],
});

sdk.start(); 
console.log('🔹 OpenTelemetry tracing initialised');

export async function shutdownTracing(): Promise<void> {
  await sdk.shutdown();
}
