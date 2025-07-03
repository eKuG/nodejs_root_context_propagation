// tracing.js

const { NodeSDK } = require('@opentelemetry/sdk-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { BatchSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { propagation, context, trace } = require('@opentelemetry/api');
const {
  CompositePropagator,
  W3CTraceContextPropagator,
  W3CBaggagePropagator,
} = require('@opentelemetry/core');

// Root Span Context Propagation Processor
class RootSpanContextProcessor {
  constructor() {
    // Map to store root spans by trace ID
    this.rootSpans = new Map();
  }

  onStart(span, parentContext) {
    try {
      const traceId = span.spanContext().traceId;
      
      // If this is a root span (no parent), store it
      if (!span.parentSpanId) {
        this.rootSpans.set(traceId, span);
        console.log(`🌟 Root span started: "${span.name}" (trace: ${traceId.slice(0, 8)}...)`);
      }

      // Annotate span with baggage (keep existing functionality)
      const bag = propagation.getBaggage(parentContext || context.active());
      if (bag) {
        for (const [key, entry] of bag.getAllEntries()) {
          span.setAttribute(`baggage.${key}`, entry.value);
        }
      }
    } catch (err) {
      console.error('Error in RootSpanContextProcessor onStart:', err);
    }
  }

  onEnd(span) {
    try {
      const traceId = span.spanContext().traceId;
      const spanName = span.name || 'unknown';
      
      console.log(`🔍 Span ending: "${spanName}" (trace: ${traceId.slice(0, 8)}..., parent: ${span.parentSpanId ? 'yes' : 'no'})`);
      
      // Check if this span has error attributes that need to be propagated to root
      const attributes = span.attributes || {};
      const errorAttributes = {};
      
      console.log(`🔍 Span attributes:`, Object.keys(attributes));
      
      for (const [key, value] of Object.entries(attributes)) {
        if (key.startsWith('error_') || key === 'custom_attribute') {
          errorAttributes[key] = value;
          console.log(`🔍 Found propagatable attribute: ${key} = ${value}`);
        }
      }
      
      // If we found error attributes, propagate them to the root span
      if (Object.keys(errorAttributes).length > 0) {
        const rootSpan = this.rootSpans.get(traceId);
        if (rootSpan && rootSpan !== span) {
          rootSpan.setAttributes(errorAttributes);
          console.log(`🔴 Propagated to root span (${traceId.slice(0, 8)}...):`, errorAttributes);
        } else if (rootSpan === span) {
          console.log(`🔍 This is the root span, no propagation needed`);
        } else {
          console.log(`🔍 No root span found for trace ${traceId.slice(0, 8)}...`);
        }
      }
      
      // Clean up root span reference when it ends
      if (!span.parentSpanId) {
        console.log(`🏁 Root span ended: "${span.name}" (trace: ${traceId.slice(0, 8)}...)`);
        this.rootSpans.delete(traceId);
      }
    } catch (err) {
      console.error('Error in RootSpanContextProcessor onEnd:', err);
    }
  }

  shutdown() {
    this.rootSpans.clear();
    return Promise.resolve();
  }

  forceFlush() {
    return Promise.resolve();
  }
}

// Simple utility to get root span from current context
class RootSpanUtil {
  static rootSpanMap = new Map(); // Store root spans by trace ID
  
  /**
   * Store the root span in context for later access
   */
  static withRootSpan(fn) {
    const activeSpan = trace.getActiveSpan();
    if (activeSpan) {
      const traceId = activeSpan.spanContext().traceId;
      console.log(`🎯 WithRootSpan: activeSpan="${activeSpan.name}", traceId=${traceId.slice(0, 8)}..., parentSpanId=${activeSpan.parentSpanId ? activeSpan.parentSpanId.slice(0, 8) + '...' : 'none'}`);
      
      // Only store this as root if it doesn't have a parent
      if (!activeSpan.parentSpanId) {
        this.rootSpanMap.set(traceId, activeSpan);
        console.log(`🎯 Stored as root span for trace ${traceId.slice(0, 8)}...`);
      }
      
      try {
        return fn();
      } finally {
        // Clean up when done (optional, processor will also clean up)
        // this.rootSpanMap.delete(traceId);
      }
    }
    return fn();
  }
  
  /**
   * Set attribute on root span for current trace
   */
  static setRootAttribute(key, value) {
    const activeSpan = trace.getActiveSpan();
    if (activeSpan) {
      const traceId = activeSpan.spanContext().traceId;
      const rootSpan = this.rootSpanMap.get(traceId);
      if (rootSpan) {
        rootSpan.setAttribute(key, value);
        console.log(`🎯 Set root attribute: ${key} = ${value}`);
      } else {
        console.log(`🎯 No root span found for trace ${traceId.slice(0, 8)}..., current span: ${activeSpan.name}`);
      }
    }
  }
}

let sdk;

async function initTracing() {
  // Configure global propagator to extract both tracecontext & baggage
  propagation.setGlobalPropagator(
    new CompositePropagator({
      propagators: [
        new W3CTraceContextPropagator(),
        new W3CBaggagePropagator(),
      ],
    })
  );

  const exporter = new OTLPTraceExporter({
    url: 'https://ingest.us.staging.signoz.cloud:443/v1/traces',
  });

  sdk = new NodeSDK({
    spanProcessors: [
      new RootSpanContextProcessor(),
      new BatchSpanProcessor(exporter),
    ],
    instrumentations: [
      getNodeAutoInstrumentations({
        // HTTP instrumentation will extract incoming headers & baggage automatically
        '@opentelemetry/instrumentation-http': {
          propagateBaggage: true,
        },
        // Fastify instrumentation for your routes
        '@opentelemetry/instrumentation-fastify': {},
      }),
    ],
  });

  await sdk.start();
  console.log('✅ Tracing initialized with root span context propagation');
}

function shutdownTracing() {
  return sdk ? sdk.shutdown() : Promise.resolve();
}

module.exports = {
  initTracing,
  shutdownTracing,
  RootSpanUtil,
};