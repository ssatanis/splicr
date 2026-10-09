import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

test('Ferrarone completed cloud reports expose all recorded genes and export real results', async ({ page, context }) => {
  test.skip(process.env.SPLICR_FERRARONE_RESULTS !== '1', 'Requires completed real cloud receipts.');
  test.setTimeout(300_000);
  const out = path.resolve('../..', 'artifacts/ferrarone-20261007/rra-cloud');
  const receipt = JSON.parse(fs.readFileSync(path.join(out, 'cloud-verification.json'), 'utf8'));
  expect(receipt.analyses).toHaveLength(6);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const [index, analysis] of receipt.analyses.entries()) {
    const screen = analysis.receipt;
    expect(screen.run_status).toBe('complete');
    await page.goto(`/dashboard/screens/${screen.id}`);
    await expect(page.getByRole('heading', { name: screen.name, exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Screen summary' })).toContainText('Quality control');
    await expect(page.getByRole('region', { name: 'Effect and significance' })).toContainText('18,049 genes drawn');
    const response = await context.request.get(`/api/report/${screen.id}?format=json`);
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.sample_data).toBe(false);
    expect(data.data_source).toBe('workspace');
    expect(data.rows.truncated).toBe(false);
    expect(data.hits).toHaveLength(18049);
    for (const gene of ['FIG4', 'VAC14', 'PIKFYVE']) expect(data.hits.some((hit: {gene:string}) => hit.gene === gene)).toBe(true);
    fs.writeFileSync(path.join(out, `comparison-${index + 1}-frontend-export.json`), JSON.stringify(data));
    if (screen.name.endsWith('Spheroid: WT vs plasmid')) {
      await page.screenshot({path:path.join(out,'completed-spheroid-report.png'),fullPage:true});
      const download = page.waitForEvent('download');
      await page.getByRole('link', {name:/^csv export of this screen/i}).click();
      await (await download).saveAs(path.join(out, 'spheroid-wt-browser-export.csv'));
      expect(fs.readFileSync(path.join(out,'spheroid-wt-browser-export.csv'),'utf8')).toContain('FIG4');
    }
  }
  fs.writeFileSync(path.join(out,'results-browser-errors.json'),JSON.stringify(errors));
  expect(errors).toEqual([]);
});
