# OpenTelemetry Root Span Attribute Propagation

This project demonstrates how to implement root span attribute propagation in OpenTelemetry, similar to New Relic's setCustomAttribute() behavior. When errors occur in downstream functions, their attributes are automatically propagated to the root span, making them available for alerting and monitoring.
🎯 Problem Solved

Issue: In OpenTelemetry, span.setAttribute() only affects the current span, unlike New Relic's setCustomAttribute() which sets attributes on the root transaction. This makes it difficult to create alerts based on errors that occur deep in your application's call stack.

Solution: Custom span processor + utility class that automatically propagates error attributes from any child span to the root span of the trace.

### Files Overview

tracing.js: OpenTelemetry configuration with custom root span propagation
app.js: Fastify application demonstrating the propagation in action

### How It Works

Root Span Tracking: Custom span processor tracks root spans by trace ID
Automatic Propagation: Attributes starting with error_ or named custom_attribute are automatically copied to root spans

Direct Root Access: Utility class allows direct attribute setting on root spans

