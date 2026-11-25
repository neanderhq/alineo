import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const OKR_HEADERS = 'cycle_name,objective_title,objective_description,level,team_name,owner_email,due_date,visibility,parent_objective_title,kr_title,metric_type,direction,baseline,target,current,unit';

async function expectFocus(page, element) {
  const handle = await element.elementHandle();
  await page.waitForFunction(node => document.activeElement === node, handle);
}

async function verifyGoalConflict({ page, origin, admin, workspace, cycle }) {
  const title = 'Concurrent goal edit ' + randomUUID().slice(0, 8);
  const editorUser = workspace.members.find(person => person.email === 'member@alineo.test');
  const viewerUser = workspace.members.find(person => person.email === 'manager@alineo.test');
  assert.ok(editorUser && viewerUser, 'The fixture has two colleagues with independent grants');

  const creation = await admin.post('/api/objectives', { data: { cycleId: cycle.id, title, visibility: 'restricted' } });
  assert.equal(creation.status(), 201, await creation.text());
  const { objective } = await creation.json();
  const endpoint = '/api/objectives/' + objective.id;
  await page.goto(origin + '/dashboard/goals?goal=' + objective.id);
  const goalEditor = page.getByRole('dialog', { name: 'Edit goal' });
  const description = goalEditor.getByLabel('Description', { exact: true });
  const due = goalEditor.getByLabel('Due date', { exact: true });
  const draftDescription = 'The editor must retain this unsaved planning detail.';
  await description.fill(draftDescription);
  await goalEditor.getByRole('button', { name: /Privacy/ }).click();
  await goalEditor.getByRole('combobox', { name: 'Person to add' }).click();
  await page.getByRole('option', { name: editorUser.name, exact: true }).click();
  await goalEditor.getByRole('combobox', { name: 'Access level for new person' }).click();
  await page.getByRole('option', { name: 'Editor', exact: true }).click();
  await goalEditor.getByRole('button', { name: 'Add', exact: true }).click();

  const newDate = cycle.endDate;
  const concurrent = await admin.patch(endpoint, { data: {
    version: objective.version, dueDate: newDate, viewerIds: [viewerUser.id],
  } });
  assert.equal(concurrent.status(), 200, await concurrent.text());
  const concurrentVersion = (await concurrent.json()).objective.version;
  assert.ok(concurrentVersion > objective.version);

  const save = goalEditor.getByRole('button', { name: 'Save goal', exact: true });
  const patchResponse = () => page.waitForResponse(response =>
    response.request().method() === 'PATCH' && new URL(response.url()).pathname === endpoint);
  const conflict = patchResponse();
  await save.click();
  assert.equal((await conflict).status(), 409);
  await goalEditor.getByRole('alert').getByText('Someone else changed this goal. Your edits are still here. Review the updated fields and save again.').waitFor();
  assert.equal(await description.inputValue(), draftDescription);
  assert.equal(await due.inputValue(), newDate);
  const accessFor = (person) => goalEditor.getByRole('combobox', { name: 'Access level for ' + person.name, exact: true });
  assert.equal(await accessFor(editorUser).innerText(), 'Editor');
  assert.equal(await accessFor(viewerUser).innerText(), 'Viewer');
  const savedGoal = async () => {
    const refreshed = await (await admin.get('/api/workspace')).json();
    return refreshed.cycles.flatMap(item => item.objectives).find(item => item.id === objective.id);
  };
  assert.equal((await savedGoal()).description, objective.description, 'Conflict must not auto-submit the draft');

  const retry = patchResponse();
  await save.click();
  assert.equal((await retry).status(), 200);
  await goalEditor.waitFor({ state: 'hidden' });
  const stored = await savedGoal();
  assert.equal(stored.description, draftDescription);
  assert.equal(stored.dueDate, newDate);
  assert.deepEqual(
    new Map(stored.access.map(({ userId, permission }) => [userId, permission])),
    new Map([[editorUser.id, 'editor'], [viewerUser.id, 'viewer']]),
  );
}

export async function verifyCoreQuality({ page, origin, admin, member, workspace }) {
  const cycle = workspace.cycles.find(c => c.status === 'open');
  assert.ok(cycle, 'The seeded workspace has an open cycle');

  const title = 'Quality check ' + randomUUID().slice(0, 8);
  const csv = [OKR_HEADERS,
    [cycle.name, title, '', 'company', '', 'admin@alineo.test', '', 'company', '',
      title + ' metric', 'numeric', 'increasing', 0, 100, 20, 'units'].join(','),
  ].join('\n');

  for (const dryRun of [true, false]) {
    const denied = await member.post('/api/imports/okrs', { data: { csv, dryRun } });
    assert.equal(denied.status(), 403, 'Members cannot preview or commit company-wide imports');
  }
  const preview = await admin.post('/api/imports/okrs', { data: { csv, dryRun: true } });
  const previewData = await preview.json();
  assert.equal(preview.status(), 200);
  assert.equal(previewData.plannedObjectives, 1);
  assert.equal(previewData.committed, false);
  const afterPreview = await (await admin.get('/api/workspace')).json();
  assert.ok(afterPreview.cycles.every(c => c.objectives.every(goal => goal.title !== title)));

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(origin + '/dashboard/goals');
  await page.getByRole('heading', { name: 'Goals', exact: true }).waitFor();
  const create = page.getByRole('button', { name: 'Create goal', exact: true });
  await create.press('Enter');
  const editor = page.getByRole('dialog', { name: 'Create goal' });
  const titleField = editor.getByLabel('Title', { exact: true });
  await expectFocus(page, titleField);
  await editor.getByRole('button', { name: 'Create goal', exact: true }).press('Enter');
  await editor.getByText('Give the goal a title.', { exact: true }).waitFor();
  await expectFocus(page, titleField);
  assert.equal(await titleField.getAttribute('aria-invalid'), 'true');
  assert.equal(await titleField.getAttribute('aria-describedby'), 'goal-save-error');
  await page.keyboard.press('Escape');
  await editor.waitFor({ state: 'hidden' });
  await expectFocus(page, create);

  await page.getByRole('button', { name: 'List view', exact: true }).click();
  const goalTitle = 'Improve customer onboarding';
  const rootRow = page.getByRole('row').filter({ has: page.getByRole('button', { name: goalTitle, exact: true }) });
  const show = rootRow.getByRole('button', { name: 'Show key results for ' + goalTitle });
  await show.press('Enter');
  const krTitle = 'Complete 100 onboarding conversations';
  const trigger = page.getByRole('button', { name: 'Actions for key result ' + krTitle, exact: true });
  const row = page.getByRole('row').filter({ has: trigger });
  await row.getByText(krTitle, { exact: true }).waitFor();
  const bounds = await row.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, viewport: window.innerWidth };
  });
  assert.equal(bounds.viewport, 375);
  assert.ok(bounds.left >= 0 && bounds.right <= 375, 'Phone row includes the title, progress and actions');
  for (const [item, name] of [['History', 'Check-in history'], ['Check in', 'Check in']]) {
    await trigger.press('Enter');
    await page.getByRole('menuitem', { name: item, exact: true }).press('Enter');
    const dialog = page.getByRole('dialog', { name, exact: true });
    await dialog.waitFor();
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    await expectFocus(page, trigger);
  }

  await page.getByText('Import and export CSV', { exact: true }).click();
  const csvField = page.getByLabel('OKR CSV', { exact: true });
  const importButton = page.getByRole('button', { name: 'Import goals', exact: true });
  await csvField.fill(csv);
  assert.ok(await importButton.isDisabled(), 'A CSV must be previewed before commit');
  await page.getByRole('button', { name: 'Preview import', exact: true }).click();
  await page.getByText('Preview ready: 1 goals, 1 key results.', { exact: true }).waitFor();
  assert.ok(await importButton.isEnabled());
  await csvField.fill(csv.replace(title, title + ' changed'));
  assert.ok(await importButton.isDisabled(), 'Editing invalidates the preview');

  const longName = 'Fictional planning cycle for a cross-functional customer onboarding rollout and quarterly performance review';
  const cycleResponse = await admin.post('/api/cycles', { data: { name: longName, startDate: '2041-04-01', endDate: '2041-06-30' } });
  assert.equal(cycleResponse.status(), 201);
  await page.goto(origin + '/dashboard/reports');
  await page.getByRole('heading', { name: 'Reports', exact: true }).waitFor();
  await page.locator('[data-slot="badge"]').filter({ hasText: longName }).first().waitFor();
  const report = await page.evaluate(() => ({ width: window.innerWidth, scroll: document.documentElement.scrollWidth }));
  assert.deepEqual(report, { width: 375, scroll: 375 }, 'Long cycle comparisons remain inside the phone viewport');
  await verifyGoalConflict({ page, origin, admin, workspace, cycle });
  console.log('PASS: role-scoped CSV access and preview, goal and check-in keyboard focus, 375px layouts, and goal conflict recovery with concurrent ACLs.');
}
