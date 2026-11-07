import { seed } from '../api.mjs';
import {
  test,
  expect,
  login,
  chooseRadio,
  dismissNextDialog,
} from '../test.mjs';

// The seeded finding has no analysis until a test saves one.
test.beforeEach(({ problems }) =>
  problems.allow(/^GET \/api\/v1\/analysis\?.* 404$/),
);

test.afterEach(({ page }) => page.unrouteAll({ behavior: 'ignoreErrors' }));

function seedAnalysis(decisionOrigin = 'INHERITED') {
  return {
    analysisState: 'IN_TRIAGE',
    analysisJustification: 'CODE_NOT_PRESENT',
    analysisResponse: 'NOT_SET',
    analysisDetails: '',
    isSuppressed: false,
    decisionOrigin,
    decisionVersion: 0,
    analysisComments: [
      { timestamp: 0, commenter: 'Author', comment: 'Local note' },
    ],
  };
}

async function openFinding(page) {
  const { project, vulnId, vulnUuid } = seed();
  await login(page);
  await page.goto(`projects/${project.uuid}/findings/${vulnUuid}`);
  return page.getByRole('dialog', { name: vulnId });
}

function mockAnalysis(page, analysis) {
  return page.route('**/api/v1/analysis?*', async (route) => {
    const value = typeof analysis === 'function' ? await analysis() : analysis;
    return value
      ? route.fulfill({ json: value })
      : route.fulfill({ status: 500 });
  });
}

test('show ownership and keep source text out of local history', async ({
  page,
}) => {
  const source = {
    project: {
      uuid: seed().project.uuid,
      name: 'Source Project',
      version: '1.0',
    },
    component: {
      uuid: seed().componentUuid,
      name: 'Source Component',
      version: '2.0',
    },
    sourceDetails: 'Source-only explanation',
    comments: [
      {
        timestamp: 0,
        commenter: 'Source Author',
        comment: 'Source-only history',
      },
    ],
  };
  const second = {
    ...source,
    project: {
      ...source.project,
      uuid: '00000000-0000-4000-8000-000000000002',
      name: 'Second Source',
    },
    sourceDetails: '<img src=x onerror=alert(1)>A different source explanation',
    comments: [
      {
        timestamp: 1000,
        commenter: 'Second Author',
        comment: 'Independent review',
      },
    ],
  };
  await mockAnalysis(page, {
    ...seedAnalysis('LOCAL'),
    sourceAssessments: [source, second],
  });
  const drawer = await openFinding(page);
  await expect(drawer).toContainText('Decision ownership: Local');
  const history = drawer.getByRole('tabpanel', { name: 'History' });
  await drawer.getByRole('tab', { name: 'History' }).click();
  await expect(history).toContainText('Local note');
  await expect(history).not.toContainText('Source-only history');
  await expect(history).not.toContainText('Independent review');
  await expect(drawer.getByLabel('Details')).not.toHaveValue(
    'Source-only explanation',
  );
  await drawer.getByRole('tab', { name: 'Sources' }).click();
  const sources = drawer.getByRole('tabpanel', { name: 'Sources' });
  await expect(
    sources.getByRole('link', { name: 'Source Project (1.0)' }),
  ).toHaveAttribute('href', new RegExp(`/projects/${seed().project.uuid}`));
  await expect(
    sources
      .getByRole('region', {
        name: 'Source Project / Source Component',
        exact: true,
      })
      .getByRole('link', { name: 'Source Component (2.0)' }),
  ).toHaveAttribute('href', new RegExp(`/components/${seed().componentUuid}`));
  await expect(sources).toContainText('Source-only explanation');
  await expect(sources).toContainText('Source Author');
  await expect(sources).toContainText('Source-only history');
  const secondRegion = sources.getByRole('region', {
    name: 'Second Source / Source Component',
  });
  await expect(secondRegion).toContainText(second.sourceDetails);
  await expect(secondRegion).toContainText('Second Author');
  await expect(secondRegion).toContainText('Independent review');
});

test('take ownership without submitting an unsaved decision', async ({
  page,
}) => {
  let analysis = seedAnalysis();
  await mockAnalysis(page, () => analysis);
  await page.route('**/api/v1/analysis', (route) => {
    analysis = { ...analysis, decisionOrigin: 'LOCAL', decisionVersion: 1 };
    return route.fulfill({ json: analysis });
  });
  const drawer = await openFinding(page);
  await drawer.getByLabel('Details').fill('Unsaved draft');
  const request = page.waitForRequest('**/api/v1/analysis');
  await drawer.getByRole('button', { name: 'Take local ownership' }).click();
  expect((await request).postDataJSON()).toEqual({
    project: seed().project.uuid,
    component: seed().componentUuid,
    vulnerability: seed().vulnUuid,
    decisionAction: 'TAKE_LOCAL',
    expectedDecisionVersion: 0,
  });
  await expect(drawer.getByText('Decision ownership: Local')).toBeVisible();
  await expect(drawer.getByLabel('Details')).toHaveValue('Unsaved draft');
  await expect(drawer.getByRole('radio', { name: 'In Triage' })).toBeChecked();
  await expect(drawer.getByRole('form', { name: 'Analysis' })).toBeFocused();
});

test('release only after confirmation and keep an unsaved draft', async ({
  page,
}) => {
  let analysis = seedAnalysis('LOCAL');
  await mockAnalysis(page, () => analysis);
  await page.route('**/api/v1/analysis', (route) => {
    analysis = {
      ...seedAnalysis('NEUTRAL'),
      analysisState: 'NOT_SET',
      decisionVersion: 1,
    };
    return route.fulfill({ json: analysis });
  });
  const drawer = await openFinding(page);
  await drawer.getByLabel('Details').fill('Unsaved draft');
  const request = page.waitForRequest('**/api/v1/analysis');
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Release this local decision?');
    await dialog.accept();
  });
  await drawer.getByRole('button', { name: 'Release local ownership' }).click();
  expect((await request).postDataJSON()).toEqual({
    project: seed().project.uuid,
    component: seed().componentUuid,
    vulnerability: seed().vulnUuid,
    decisionAction: 'RELEASE_LOCAL',
    expectedDecisionVersion: 0,
  });
  await expect(drawer.getByText('Decision ownership: Neutral')).toBeVisible();
  await expect(drawer.getByLabel('Details')).toHaveValue('Unsaved draft');
  await expect(drawer.getByRole('form', { name: 'Analysis' })).toBeFocused();
});

test('block writes after a 409 until the server decision is reviewed', async ({
  page,
  problems,
}) => {
  problems.allow(/^PUT \/api\/v1\/analysis 409$/);
  let analysis = seedAnalysis('LOCAL');
  let gets = 0;
  await mockAnalysis(page, () => {
    if (gets++)
      analysis = {
        ...seedAnalysis('LOCAL'),
        analysisState: 'EXPLOITABLE',
        decisionVersion: 1,
      };
    return analysis;
  });
  let conflicts = 0;
  await page.route('**/api/v1/analysis', (route) => {
    conflicts++;
    return route.fulfill({ status: 409 });
  });
  const drawer = await openFinding(page);
  await chooseRadio(drawer, 'Resolved');
  await drawer.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    drawer.getByText('The decision changed on the server'),
  ).toBeVisible();
  await expect(
    drawer.getByRole('button', { name: 'Save', exact: true }),
  ).toBeDisabled();
  await drawer.getByRole('button', { name: 'Reload for review' }).click();
  await expect(
    drawer.getByRole('heading', { name: 'Current server decision' }),
  ).toBeVisible();
  await expect(
    drawer.getByRole('region', { name: 'Current server decision' }),
  ).toContainText('Exploitable');
  await expect(drawer.getByRole('radio', { name: 'Resolved' })).toBeChecked();
  await drawer
    .getByRole('button', { name: 'Keep draft and use reviewed version' })
    .click();
  const save = drawer.getByRole('button', { name: 'Save', exact: true });
  await expect(save).toBeEnabled();
  await page.unroute('**/api/v1/analysis');
  await page.route('**/api/v1/analysis', (route) =>
    route.fulfill({ json: analysis }),
  );
  const retried = page.waitForRequest('**/api/v1/analysis');
  await save.click();
  expect((await retried).postDataJSON().expectedDecisionVersion).toBe(1);
  expect(conflicts).toBe(1);
});

test('do not duplicate a write when its refresh fails', async ({
  page,
  problems,
}) => {
  problems.allow(/^GET \/api\/v1\/analysis\?.* 500$/);
  let analysis = seedAnalysis('INHERITED');
  let failing = false;
  await mockAnalysis(page, () => (failing ? null : analysis));
  let writes = 0;
  await page.route('**/api/v1/analysis', async (route) => {
    writes++;
    analysis = {
      ...seedAnalysis('LOCAL'),
      decisionVersion: 1,
      analysisState: route.request().postDataJSON().analysisState,
    };
    await route.fulfill({ json: analysis });
    failing = true;
  });
  const drawer = await openFinding(page);
  await chooseRadio(drawer, 'Resolved');
  await drawer.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    drawer.getByText(
      'The change was saved, but the current assessment could not be loaded',
    ),
  ).toBeVisible();
  await expect(
    drawer.getByRole('button', { name: 'Save', exact: true }),
  ).toBeDisabled();
  await expect(drawer.getByRole('radio', { name: 'Resolved' })).toBeChecked();
  expect(writes).toBe(1);
  await drawer.getByLabel('Details').fill('New edit after refresh failure');
  const dismissed = dismissNextDialog(page);
  await drawer.getByRole('button', { name: 'Close', exact: true }).click();
  await dismissed;
  await expect(drawer.getByLabel('Details')).toHaveValue(
    'New edit after refresh failure',
  );
  failing = false;
  await drawer.getByRole('button', { name: 'Reload assessment' }).click();
  await expect(drawer.getByText('Decision ownership: Local')).toBeVisible();
  expect(writes).toBe(1);
});

test('save only the local decision and refresh it', async ({ page }) => {
  let analysis = seedAnalysis('INHERITED');
  await mockAnalysis(page, () => analysis);
  await page.route('**/api/v1/analysis', async (route) => {
    analysis = {
      ...seedAnalysis('LOCAL'),
      ...route.request().postDataJSON(),
      decisionVersion: 1,
    };
    await route.fulfill({ json: analysis });
  });
  const drawer = await openFinding(page);
  await chooseRadio(drawer, 'Exploitable');
  const request = page.waitForRequest('**/api/v1/analysis');
  await drawer.getByRole('button', { name: 'Save', exact: true }).click();
  const body = (await request).postDataJSON();
  expect(body).toMatchObject({
    decisionAction: 'TAKE_LOCAL',
    expectedDecisionVersion: 0,
    analysisState: 'EXPLOITABLE',
    analysisJustification: 'NOT_SET',
    analysisResponse: 'NOT_SET',
    analysisDetails: '',
    isSuppressed: false,
  });
  await expect(drawer).toContainText('Decision ownership: Local');
});

test('add a local comment without taking ownership or losing a decision draft', async ({
  page,
}) => {
  let analysis = { ...seedAnalysis(), decisionVersion: 7 };
  await mockAnalysis(page, () => analysis);
  await page.route('**/api/v1/analysis', (route) => {
    analysis = {
      ...analysis,
      analysisComments: [
        ...analysis.analysisComments,
        {
          timestamp: 1000,
          commenter: 'Reviewer',
          comment: 'Target review note',
        },
      ],
    };
    return route.fulfill({ json: analysis });
  });
  const drawer = await openFinding(page);
  await drawer.getByLabel('Details').fill('Unsaved local explanation');
  await drawer.getByRole('tab', { name: 'History', exact: true }).click();
  await drawer
    .getByLabel('Comment', { exact: true })
    .fill('Target review note');
  const posted = page.waitForRequest('**/api/v1/analysis');
  await drawer
    .getByRole('button', { name: 'Add Comment', exact: true })
    .click();
  expect((await posted).postDataJSON()).toEqual({
    project: seed().project.uuid,
    component: seed().componentUuid,
    vulnerability: seed().vulnUuid,
    decisionAction: 'COMMENT_ONLY',
    expectedDecisionVersion: 7,
    comment: 'Target review note',
  });
  await expect(drawer.getByRole('tabpanel', { name: 'History' })).toContainText(
    'Target review note',
  );
  await expect(drawer).toContainText('Decision ownership: Inherited');
  await drawer.getByRole('tab', { name: 'Analysis', exact: true }).click();
  await expect(drawer.getByLabel('Details')).toHaveValue(
    'Unsaved local explanation',
  );
});

test('keep legacy decisions editable without claiming inheritance or exposing hidden sources', async ({
  page,
}) => {
  const legacy = seedAnalysis();
  delete legacy.decisionOrigin;
  delete legacy.decisionVersion;
  await mockAnalysis(page, legacy);
  const drawer = await openFinding(page);
  await expect(drawer).toContainText('Decision ownership: Unknown');
  await expect(drawer.getByRole('radio', { name: 'In Triage' })).toBeChecked();
  await expect(
    drawer.getByRole('tab', { name: 'Sources', exact: true }),
  ).toHaveCount(0);
  await expect(
    drawer.getByRole('button', { name: 'Release local ownership' }),
  ).toHaveCount(0);
  await drawer.getByLabel('Details').fill('Local legacy draft');
  await expect(
    drawer.getByRole('button', { name: 'Save', exact: true }),
  ).toBeEnabled();
});
