// Jest setup provided by Grafana scaffolding
import './.config/jest-setup';

// React 19's scheduler uses a MessageChannel when one exists. In the test environment that channel
// stays open after the tests finish, so Jest never exits ("Jest did not exit one second after the
// test run has completed"). Without it, the scheduler falls back to setTimeout, which Jest cleans up.
delete global.MessageChannel;
