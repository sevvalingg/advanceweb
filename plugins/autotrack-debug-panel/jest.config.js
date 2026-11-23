// force timezone to UTC to allow tests to work regardless of local timezone
// generally used by snapshots, but can affect specific tests
process.env.TZ = 'UTC';

// Jest configuration provided by Grafana scaffolding
const base = require('./.config/jest.config');

module.exports = {
  ...base,
  transform: {
    ...base.transform,
    // @grafana/data loads d3 packages that ship only .mjs files. Node 24 can require them directly;
    // on Node 20 and 22 Jest has to transform them, so .mjs uses the same transformer as .js/.ts.
    '^.+\\.mjs$': base.transform['^.+\\.(t|j)sx?$'],
  },
};
