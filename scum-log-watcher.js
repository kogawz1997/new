const runtime = require('./src/services/scumLogWatcherRuntime');

if (require.main === module) {
  runtime.startWatcher();
}

module.exports = runtime;
