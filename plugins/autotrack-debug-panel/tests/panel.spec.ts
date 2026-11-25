import { test, expect } from '@grafana/plugin-e2e';

// Panel 1 shows the real stop-sign clip (provisioning/data/04_dur_levhasi.csv), panel 2 has no data.

test('should display "No data" in case panel data is empty', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '2' });
  await expect(panelEditPage.panel.locator).toContainText('No data');
});

test('should show state, reason, detection and the developer for the stop-sign clip', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  await gotoPanelEditPage({ dashboard, id: '1' });
  const panel = page.getByTestId('debug-panel');
  await expect(panel.getByTestId('debug-state')).toContainText('DRIVE');
  await expect(panel.getByTestId('debug-detection')).toContainText('Stop sign');
  await expect(panel.getByTestId('debug-timeline')).toContainText('dur levhasi');
  await expect(panel).toContainText('Developed by Meryem Betül Abdulrahman');
});

test('should hide the alerts when "Show alerts" is switched off', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '1' });
  const options = panelEditPage.getCustomOptions('Debug');
  await options.getSwitch('Show alerts').uncheck();
  await expect(page.getByTestId('debug-alerts')).toHaveCount(0);
});
