// app.js

// Initialize tracing BEFORE importing other modules
const { initTracing, shutdownTracing, RootSpanUtil } = require('./tracing');

// Initialize tracing
initTracing().catch(console.error);

const fastify = require('fastify')({ logger: true });
const { trace, context } = require('@opentelemetry/api');

// Simulate external service calls
async function callExternalService() {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      // Simulate random failures
      if (Math.random() < 0.3) {
        reject(new Error('External service timeout'));
      } else {
        resolve({ data: 'success' });
      }
    }, 100);
  });
}

// Simulate database operations
async function queryDatabase(query) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (query.includes('invalid')) {
        reject(new Error('Invalid SQL query'));
      } else {
        resolve({ rows: [{ id: 1, name: 'test' }] });
      }
    }, 50);
  });
}

// Downstream function that might fail
async function downstreamProcessing(data) {
  const span = trace.getActiveSpan();
  if (span) {
    span.setAttributes({
      'processing.data_size': data.length,
      'processing.started': new Date().toISOString(),
    });
  }

  try {
    // This might fail
    await callExternalService();
    
    // This might also fail
    await queryDatabase(data);
    
    return { processed: true };
  } catch (error) {
    // Set error attributes - these will be automatically propagated to root span
    if (span) {
      span.setAttributes({
        'custom_attribute': error.message,
        'error_occurred': 'true',
        'error_service': 'downstream_processing',
      });
    }
    
    throw error;
  }
}

// Another downstream function
async function anotherDownstreamFunction(userId) {
  const span = trace.getActiveSpan();
  if (span) {
    span.setAttributes({
      'user.id': userId,
      'operation': 'user_processing',
    });
  }

  try {
    // Simulate some processing
    await new Promise(resolve => setTimeout(resolve, 200));
    
    if (userId === 'invalid_user') {
      throw new Error('User not found');
    }
    
    return { userId, status: 'processed' };
  } catch (error) {
    // Set error attributes - these will be automatically propagated to root span
    if (span) {
      span.setAttributes({
        'error_type': 'user_error',
        'error_user_id': userId,
        'custom_attribute': `User processing failed: ${error.message}`,
      });
    }
    
    throw error;
  }
}

// Routes
fastify.get('/health', async (request, reply) => {
  return { status: 'healthy', timestamp: new Date().toISOString() };
});

fastify.get('/api/process/:data', async (request, reply) => {
  const { data } = request.params;
  
  // Wrap with root span context
  return RootSpanUtil.withRootSpan(async () => {
    try {
      const result = await downstreamProcessing(data);
      return { success: true, result };
    } catch (error) {
      // Set additional error attributes at route level
      RootSpanUtil.setRootAttribute('route.path', '/api/process');
      RootSpanUtil.setRootAttribute('route.error', 'processing_failed');
      
      reply.code(500);
      return { 
        success: false, 
        error: 'Processing failed',
        timestamp: new Date().toISOString()
      };
    }
  });
});

fastify.get('/api/user/:userId', async (request, reply) => {
  const { userId } = request.params;
  
  return RootSpanUtil.withRootSpan(async () => {
    try {
      const result = await anotherDownstreamFunction(userId);
      return { success: true, result };
    } catch (error) {
      RootSpanUtil.setRootAttribute('route.path', '/api/user');
      RootSpanUtil.setRootAttribute('route.user_id', userId);
      
      reply.code(404);
      return { 
        success: false, 
        error: 'User not found',
        timestamp: new Date().toISOString()
      };
    }
  });
});

// Complex route with multiple downstream calls
fastify.get('/api/complex/:id', async (request, reply) => {
  const { id } = request.params;
  
  return RootSpanUtil.withRootSpan(async () => {
    try {
      // Multiple downstream calls
      const [result1, result2] = await Promise.all([
        downstreamProcessing(id),
        anotherDownstreamFunction(id),
      ]);
      
      return { 
        success: true, 
        results: { result1, result2 },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      RootSpanUtil.setRootAttribute('route.path', '/api/complex');
      RootSpanUtil.setRootAttribute('route.id', id);
      RootSpanUtil.setRootAttribute('operation', 'complex_processing');
      
      reply.code(500);
      return { 
        success: false, 
        error: 'Complex operation failed',
        timestamp: new Date().toISOString()
      };
    }
  });
});

// Route that demonstrates root span context propagation
fastify.get('/api/root-context-test', async (request, reply) => {
  return RootSpanUtil.withRootSpan(async () => {
    try {
      console.log('🧪 Starting root context test...');
      
      // Set a custom attribute directly on root span
      RootSpanUtil.setRootAttribute('test_attribute', 'set_from_route_handler');
      
      // This will maintain root span context across async calls
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Simulate an error deep in the call stack
      await downstreamProcessing('test_data');
      
      return { success: true, message: 'Root context test completed' };
    } catch (error) {
      console.log('🔴 Error caught in route handler, setting root attribute...');
      RootSpanUtil.setRootAttribute('custom_attribute', 'Root context test failed');
      RootSpanUtil.setRootAttribute('error_from_route', 'true');
      
      reply.code(500);
      return { 
        success: false, 
        error: 'Root context test failed',
        timestamp: new Date().toISOString()
      };
    }
  });
});

// Simple test endpoint that always works
fastify.get('/api/simple-test', async (request, reply) => {
  return RootSpanUtil.withRootSpan(async () => {
    console.log('🧪 Simple test - setting root attribute...');
    
    // Set attribute on root span
    RootSpanUtil.setRootAttribute('simple_test', 'completed');
    RootSpanUtil.setRootAttribute('custom_attribute', 'simple_test_value');
    
    // Create a child operation that will set attributes
    const childResult = await simulateChildOperation();
    
    return { 
      success: true, 
      message: 'Simple test completed',
      childResult
    };
  });
});

// Simulate a child operation that sets attributes
async function simulateChildOperation() {
  // Get the current active span (should be the HTTP request span)
  const activeSpan = trace.getActiveSpan();
  console.log('🔧 Current active span:', activeSpan ? activeSpan.name : 'none');
  
  const tracer = trace.getTracer('test-tracer');
  
  return tracer.startActiveSpan('child-operation', async (span) => {
    try {
      console.log('🔧 Child operation started, setting attributes...');
      console.log('🔧 Child span context:', {
        traceId: span.spanContext().traceId.slice(0, 8) + '...',
        spanId: span.spanContext().spanId.slice(0, 8) + '...',
        parentSpanId: span.parentSpanId ? span.parentSpanId.slice(0, 8) + '...' : 'none'
      });
      
      // Set attributes that should propagate to root
      span.setAttributes({
        'child_span_attr': 'this should propagate to root',
        'error_test': 'this should also propagate',
        'custom_attribute': 'this should override the root value',
      });
      
      // Simulate some work
      await new Promise(resolve => setTimeout(resolve, 50));
      
      console.log('🔧 Child operation completed');
      return { childWork: 'completed' };
    } finally {
      span.end();
    }
  });
}

// Error handling middleware
fastify.setErrorHandler((error, request, reply) => {
  // Log the error
  fastify.log.error(error);
  
  // Set error attributes on current span (will be propagated to root)
  const span = trace.getActiveSpan();
  if (span) {
    span.setAttributes({
      'error_global': 'true',
      'error_message': error.message,
      'custom_attribute': 'Global error handler triggered',
    });
  }
  
  reply.code(500).send({
    success: false,
    error: 'Internal server error',
    timestamp: new Date().toISOString()
  });
});

// Graceful shutdown
const gracefulShutdown = async () => {
  console.log('🛑 Shutting down gracefully...');
  
  try {
    await fastify.close();
    await shutdownTracing();
    console.log('✅ Shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

// Start server
const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
    console.log('🚀 Server running on http://localhost:3000');
    
    // Test endpoints
    console.log('\n📡 Test endpoints:');
    console.log('  GET /health - Health check');
    console.log('  GET /api/simple-test - Simple root span test (always works)');
    console.log('  GET /api/process/test - Process data (may fail)');
    console.log('  GET /api/user/123 - Get user (try "invalid_user" for error)');
    console.log('  GET /api/complex/test - Complex operation');
    console.log('  GET /api/root-context-test - Test root context propagation');
  } catch (error) {
    console.error('❌ Error starting server:', error);
    process.exit(1);
  }
};

start();