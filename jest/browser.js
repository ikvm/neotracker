const base = require('./base');

module.exports = {
  ...base({ path: 'browser' }),
  snapshotSerializers: ['enzyme-to-json/serializer'],
  testEnvironment:
    './packages/neotracker-server-test/src/jest/BrowserEnvironment.js',
  setupTestFrameworkScriptFile:
    './packages/neotracker-server-test/src/jest/setupBrowser.js',
};
