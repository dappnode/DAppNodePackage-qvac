export default {
  cacheDirectory: '/data/models',
  loggerConsoleOutput: true,
  loggerLevel: 'info',
  serve: {
    cors: {
      origins: []
    },
    load: {
      lazy: true,
      concurrency: 1,
      timeoutMs: null,
      cancelOnDisconnect: true
    },
    models: {
      'qwen3-600m': {
        model: 'QWEN3_600M_INST_Q4',
        default: true,
        preload: true,
        config: {
          ctx_size: 4096
        }
      }
    }
  }
}
