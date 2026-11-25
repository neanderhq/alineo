// Exercises the selected OKR workflows against the production image and disposable fixtures.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const api = {
  cycles: '/api/cycles',
  queue: '/api/check-in-queue',
  views: '/api/report-views',
  batch: '/api/check-in-batches',
};
const memberId = 'alineo-demo-member';
const managerId = 'alineo-demo-manager';
const adminId = 'alineo-demo-admin';
const title = {
  cycle: 'Launch readiness',
  goal: 'Prepare the launch handoff',
  first: 'Complete partner onboarding',
  binary: 'Approve the rollout checklist',
  healthy: 'Review launch analytics',
  restricted: 'Private staffing plan',
};

async function json(response, status = 200) {
  assert.equal(response.status(), status, await response.text());
  return response.json();
}

function dateFromToday(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function createCycle(admin, name) {
  const { cycle } = await json(await admin.post(api.cycles, {
    data: { name, startDate: dateFromToday(-20), endDate: dateFromToday(20), checkInCadence: 'weekly' },
  }), 201);
  return (await json(await admin.patch(api.cycles, { data: { id: cycle.id, version: cycle.version } }))).cycle;
}

async function createGoal(actor, cycleId, title, extra = {}) {
  const { objective } = await json(await actor.post('/api/objectives', { data: { cycleId, title, ...extra } }), 201);
  return objective;
}

async function createResult(actor, objectiveId, title, extra = {}) {
  return (await json(await actor.post('/api/key-results', {
    data: { objectiveId, title, metricType: 'numeric', direction: 'increasing', baseline: 0, target: 100, ...extra },
  }), 201)).keyResult;
}

const historyPath = id => '/api/key-results/' + id + '/check-ins';
const queuePath = cycle => api.queue + '?cycleId=' + cycle.id;
const editView = view => api.views + '/' + view.id;

async function history(actor, result) {
  return (await json(await actor.get(historyPath(result.id)))).checkIns;
}

async function checkIn(actor, result, value, confidence, effectiveDate = dateFromToday(0)) {
  return json(await actor.post(historyPath(result.id), {
    data: { version: result.version, value, confidence, effectiveDate },
  }), 201);
}

function queueAction(cycle, result, action, checkInId) {
  return { cycleId: cycle.id, resultId: result.id, action, checkInId };
}

function batchRow(row, value, confidence = 'on_track') {
  return { id: row.id, version: row.version, value, confidence };
}

function batchData(cycle, rows, effectiveDate = dateFromToday(0)) {
  return { cycleId: cycle.id, effectiveDate, rows };
}

async function preview(actor, data, status = 200) {
  return json(await actor.post(api.batch, { data: { ...data, action: 'preview' } }), status);
}

async function commit(actor, data, requestId = randomUUID()) {
  return actor.post(api.batch, { data: { ...data, action: 'commit', requestId } });
}

async function liveResult(actor, cycleId, id) {
  const workspace = await json(await actor.get('/api/workspace'));
  return workspace.cycles.find(cycle => cycle.id === cycleId).objectives
    .flatMap(goal => goal.keyResults).find(result => result.id === id);
}

async function select(page, label, name) {
  await page.getByRole('combobox', { name: label, exact: true }).press('Enter');
  await page.getByRole('option', { name, exact: true }).press('Enter');
}

async function phoneFits(page) {
  const dimensions = await page.evaluate(() => [innerWidth, document.documentElement.scrollWidth]);
  assert.equal(dimensions[0], 375);
  assert.ok(dimensions[1] <= 375, 'Page overflow at 375px: ' + dimensions.join('/'));
  for (const dialog of await page.getByRole('dialog').all()) {
    const box = await dialog.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= 375, 'Dialog should fit inside the phone viewport');
  }
}

async function capture(page, name) {
  const directory = process.env.ALINEO_WORKFLOW_CAPTURE_DIRECTORY;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(directory, name + '.png'), animations: 'disabled' });
}

async function verifyBrowser({ browser, origin, manager, member, cycle, first, binary }) {
  for (const width of [1440, 375]) {
    const phone = width === 375;
    const prefix = phone ? 'phone-' : 'desktop-';
    const viewport = { width, height: phone ? 812 : 960 };

    const managerContext = await browser.newContext({ storageState: await manager.storageState(), viewport });
    try {
      const page = await managerContext.newPage();
      await page.goto(origin + '/dashboard/check-in-queue');
      await select(page, 'Queue cycle', cycle.name);
      const review = page.getByRole('button', { name: 'Review ' + first.title, exact: true });
      await review.waitFor();
      await capture(page, prefix + 'queue');
      await review.press('Enter');
      const dialog = page.getByRole('dialog', { name: first.title, exact: true });
      const requestCheckIn = dialog.getByRole('button', { name: 'Request check-in', exact: true });
      await requestCheckIn.press('Enter');
      await dialog.getByRole('status').getByText('In-app request sent.', { exact: true })
        .or(dialog.getByRole('status').getByText('You already requested a check-in today.', { exact: true })).waitFor();
      if (phone) {
        await phoneFits(page);
        await capture(page, 'phone-queue-details');
      }
      await dialog.getByRole('button', { name: 'Mark reviewed', exact: true }).press('Enter');
      await dialog.getByText('Check-in reviewed.', { exact: true }).waitFor();
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      assert.ok(await review.evaluate(element => element === document.activeElement), 'Queue Escape returns focus to the reviewed row');
    } finally {
      await managerContext.close();
    }

    const memberContext = await browser.newContext({ storageState: await member.storageState(), viewport });
    try {
      const page = await memberContext.newPage();
      await page.goto(origin + '/dashboard/reports');
      await select(page, 'Report cycle', cycle.name);
      const save = page.getByRole('button', { name: 'Save as new view', exact: true });
      await save.press('Enter');
      const saveDialog = page.getByRole('dialog', { name: 'Save report view', exact: true });
      const viewName = phone ? 'Launch progress on mobile' : 'Weekly launch progress';
      await saveDialog.getByRole('button', { name: 'Save view', exact: true }).press('Enter');
      await saveDialog.getByRole('alert').getByText('Enter a view name.', { exact: true }).waitFor();
      await saveDialog.getByLabel('View name', { exact: true }).fill(viewName);
      if (phone) await phoneFits(page);
      await capture(page, prefix + 'saved-view');
      await page.keyboard.press('Escape');
      await saveDialog.waitFor({ state: 'hidden' });
      assert.ok(await save.evaluate(element => element === document.activeElement), 'Report Escape restores the save trigger');
      await save.press('Enter');
      await saveDialog.getByLabel('View name', { exact: true }).fill(viewName);
      await saveDialog.getByRole('button', { name: 'Save view', exact: true }).press('Enter');
      await page.getByRole('status').getByText('Report view saved.', { exact: true }).waitFor();
      await page.reload();
      await select(page, 'Saved report views', viewName);
      await page.getByRole('combobox', { name: 'Report cycle' }).getByText(cycle.name, { exact: true }).waitFor();
      const csv = await page.getByRole('link', { name: 'Export OKRs', exact: true }).getAttribute('href');
      assert.equal(new URL(csv, origin).searchParams.get('cycleId'), cycle.id);
      if (phone) {
        await phoneFits(page);
        await select(page, 'Saved report views', 'Archived readiness period');
        await page.getByRole('alert').getByText('This period is unavailable. Choose another report cycle.', { exact: true }).waitFor();
        assert.equal(await page.getByRole('link', { name: 'Export OKRs', exact: true }).count(), 0);
        await select(page, 'Report cycle', cycle.name);
        await page.getByRole('link', { name: 'Export OKRs', exact: true }).waitFor();
      }

      await page.goto(origin + '/dashboard/goals');
      const entryPoint = page.getByRole('link', { name: 'Batch check-ins', exact: true });
      if (phone) await phoneFits(page);
      await entryPoint.press('Enter');
      await select(page, 'Batch cycle', cycle.name);
      assert.equal(await page.getByRole('checkbox', { name: 'Include Validate central controls', exact: true }).count(), 0);
      await page.getByRole('checkbox', { name: 'Include ' + first.title, exact: true }).press('Space');
      await page.getByRole('checkbox', { name: 'Include ' + binary.title, exact: true }).press('Space');
      const value = page.getByRole('spinbutton', { name: 'Value for ' + first.title, exact: true });
      await value.fill(phone ? '74' : '70');
      await select(page, 'Confidence for ' + first.title, 'At risk');
      await select(page, 'Value for ' + binary.title, 'Yes');
      const previewButton = page.getByRole('button', { name: 'Preview batch', exact: true });
      if (phone) await phoneFits(page);
      await page.evaluate(() => scrollTo(0, 0));
      await capture(page, prefix + 'batch');
      await previewButton.press('Enter');
      const batchDialog = page.getByRole('dialog', { name: 'Preview batch check-ins', exact: true });
      await batchDialog.getByText(first.title, { exact: true }).waitFor();
      if (phone) {
        await phoneFits(page);
        await capture(page, 'phone-batch-preview');
      }
      await page.keyboard.press('Escape');
      await batchDialog.waitFor({ state: 'hidden' });
      assert.ok(await previewButton.evaluate(element => element === document.activeElement), 'Cancel returns to the preview trigger');

      const beforeBinary = await history(member, binary);
      const confirm = batchDialog.getByRole('button', { name: 'Confirm check-ins', exact: true });
      await previewButton.press('Enter');
      await confirm.waitFor();
      const current = await liveResult(member, cycle.id, first.id);
      await checkIn(member, current, 73, 'at_risk');
      await confirm.press('Enter');
      await batchDialog.waitFor({ state: 'hidden' });
      await page.getByText('Someone else updated this key result — refresh and try again.', { exact: true }).waitFor();
      assert.equal(await value.inputValue(), phone ? '74' : '70');
      assert.equal((await history(member, binary)).length, beforeBinary.length, 'A stale row prevented the other row writing');
      await page.getByRole('button', { name: 'Use current versions', exact: true }).press('Enter');
      await previewButton.press('Enter');

      if (phone) {
        // The server commits before the network drops. The UI must retry the same request ID.
        const loseResponse = async route => {
          const request = route.request();
          if (request.postDataJSON().action !== 'commit') return route.continue();
          const response = await route.fetch();
          assert.equal(response.status(), 201);
          await route.abort('connectionreset');
        };
        await page.route('**/api/check-in-batches', loseResponse);
        await confirm.press('Enter');
        await batchDialog.getByRole('alert').getByText('Could not confirm the result. Retry this same submission.', { exact: true }).waitFor();
        await page.unroute('**/api/check-in-batches', loseResponse);
        await batchDialog.getByRole('button', { name: 'Retry confirmation', exact: true }).press('Enter');
      } else {
        await confirm.press('Enter');
      }
      await page.getByRole('status').getByText('Saved 2 check-ins.', { exact: true }).waitFor();
      await page.reload();
      await select(page, 'Batch cycle', cycle.name);
      const recorded = await history(member, binary);
      assert.equal(recorded.length, beforeBinary.length + 1);
      assert.equal(Number(recorded.find(item => item.isCurrentEffective).value), 1);
    } finally {
      await memberContext.close();
    }
  }
}

export async function verifyWorkflows({ browser, origin, admin, manager, member, stranger, login, db, anonymous, inactive }) {
  const cycle = await createCycle(admin, title.cycle);
  const secondCycle = await createCycle(admin, 'Operational readiness');
  const goal = await createGoal(member, cycle.id, title.goal);
  const first = await createResult(member, goal.id, title.first);
  const binary = await createResult(member, goal.id, title.binary, { metricType: 'binary', target: 1, ownerId: null });
  const healthy = await createResult(member, goal.id, title.healthy);
  const hidden = await createGoal(admin, cycle.id, title.restricted, { visibility: 'restricted' });
  await createResult(admin, hidden.id, 'Prepare coverage proposal');
  const adminGoal = await createGoal(admin, cycle.id, 'Check central controls');
  const unwritable = await createResult(admin, adminGoal.id, 'Validate central controls');
  const siblingGoal = await createGoal(member, secondCycle.id, 'Prepare launch communications');
  const siblingResult = await createResult(member, siblingGoal.id, 'Draft the launch email');
  await createResult(member, goal.id, 'Complete launch practice', { current: 100 });

  const current = await checkIn(member, first, 42, 'at_risk');
  await db.query("UPDATE kr_check_ins SET created_at = now() - interval '10 days' WHERE key_result_id=$1", [first.id]);
  await db.query("UPDATE kr_check_ins SET created_at = now() - interval '9 days' WHERE id=$1", [current.checkIn.id]);
  await db.query("UPDATE key_results SET last_check_in_at = now() - interval '9 days' WHERE id=ANY($1)", [[first.id, binary.id]]);
  await db.query("UPDATE kr_check_ins SET created_at = now() - interval '9 days' WHERE key_result_id=$1", [binary.id]);
  const item = async actor => (await json(await actor.get(queuePath(cycle)))).items.find(row => row.id === first.id);
  const queue = (await json(await manager.get(queuePath(cycle)))).items;
  assert.deepEqual(queue.map(row => row.id).sort(), [first.id, binary.id].sort());
  assert.equal(queue.find(row => row.id === binary.id).ownerId, memberId, 'Unassigned key results use the goal owner');
  assert.equal(queue.find(row => row.id === binary.id).checkInId, null, 'Overdue alone does not create an acknowledgment');
  assert.equal((await item(manager)).stale, true);
  assert.equal((await item(manager)).risk, 'at_risk');
  assert.equal(await item(admin), undefined, 'Admin is outside this direct-report relationship');
  assert.equal((await json(await stranger.get(queuePath(cycle)))).items.length, 0);
  assert.equal((await member.get(queuePath(cycle))).status(), 403);
  assert.equal((await inactive.get(queuePath(cycle))).status(), 403);
  assert.equal((await anonymous.get(queuePath(cycle))).status(), 401);
  const request = queueAction(cycle, first, 'request');
  assert.equal((await manager.post(api.queue, { data: { ...request, resultId: unwritable.id } })).status(), 404);
  const clicks = await Promise.all([manager.post(api.queue, { data: request }), manager.post(api.queue, { data: request })]);
  assert.deepEqual((await Promise.all(clicks.map(response => json(response)))).map(row => row.created).sort(), [false, true]);
  const nudges = (await json(await member.get('/api/notifications'))).notifications.filter(note => note.type === 'check_in_request' && note.title.includes(first.title));
  assert.equal(nudges.length, 1);
  assert.equal(nudges[0].emailStatus, 'in_app_only');
  assert.match(nudges[0].linkPath, new RegExp(goal.id));
  const review = queueAction(cycle, first, 'review', current.checkIn.id);
  assert.equal((await json(await manager.post(api.queue, { data: review }))).reviewed, true);
  assert.equal((await json(await manager.post(api.queue, { data: review }))).reviewed, true);
  assert.equal((await item(await login('manager'))).reviewed, true);
  await checkIn(member, current.keyResult, 45, 'on_track', dateFromToday(-3));
  assert.equal((await item(manager)).checkInId, current.checkIn.id);
  assert.equal((await item(manager)).stale, true, 'Backdating history does not reset the effective freshness clock');
  const fresh = await checkIn(member, await liveResult(member, cycle.id, first.id), 46, 'at_risk');
  assert.equal((await item(manager)).stale, false);
  assert.equal((await item(manager)).reviewed, false);
  assert.equal((await manager.post(api.queue, { data: review })).status(), 409);
  const members = (await json(await admin.get('/api/members'))).members;
  const membership = members.find(row => row.userId === memberId);
  await json(await admin.patch('/api/members/' + membership.id, { data: { managerId: adminId } }));
  assert.equal((await item(admin)).reviewed, false, 'A second reviewer cannot inherit acknowledgment');
  assert.equal(await item(manager), undefined);
  assert.equal((await manager.post(api.queue, { data: request })).status(), 404);
  await json(await admin.patch('/api/members/' + membership.id, { data: { managerId } }));

  const filters = { view: 'company', cycleId: cycle.id, q: 'Prepare the launch', status: 'active' };
  const { view } = await json(await member.post(api.views, { data: { name: 'Launch dashboard', filters } }), 201);
  assert.equal((await member.post(api.views, { data: { name: ' launch DASHBOARD ', filters } })).status(), 409);
  assert.equal((await member.post(api.views, { data: { name: 'Bad', filters: { ...filters, status: 'bad-filter' } } })).status(), 400);
  assert.equal((await member.post(api.views, { data: { name: ' ', filters } })).status(), 400);
  const newLogin = await login('member');
  assert.deepEqual((await json(await newLogin.get(editView(view)))).view.filters, view.filters);
  assert.deepEqual((await json(await admin.get(api.views))).views, []);
  for (const actor of [admin, stranger]) {
    assert.equal((await actor.get(editView(view))).status(), 404);
    assert.equal((await actor.patch(editView(view), { data: { name: 'Unauthorized rename' } })).status(), 404);
    assert.equal((await actor.delete(editView(view))).status(), 404);
  }
  assert.equal((await json(await member.patch(editView(view), { data: { name: 'Handoff dashboard' } }))).view.name, 'Handoff dashboard');
  const replaced = (await json(await member.patch(editView(view), { data: { filters: { ...filters, q: '' } } }))).view;
  assert.equal(replaced.filters.q, '');
  assert.equal(replaced.filters.cycleId, cycle.id);
  const staleView = (await json(await member.post(api.views, { data: {
    name: 'Archived readiness period', filters: { ...filters, cycleId: secondCycle.id, q: '' },
  } }), 201)).view;

  const pre = batchData(cycle, [batchRow(fresh.keyResult, 61, 'at_risk'), batchRow(binary, 1)]);
  const historyBefore = { first: (await history(member, first)).length, binary: (await history(member, binary)).length };
  assert.equal((await preview(member, pre)).rows.length, 2);
  assert.equal((await history(member, first)).length, historyBefore.first, 'Preview writes no history');
  assert.equal((await preview(member, { ...pre, rows: [pre.rows[0], pre.rows[0]] }, 400)).rows[0].id, first.id);
  const overflow = { ...pre, rows: Array.from({ length: 21 }, (_, index) => ({ ...pre.rows[0], id: index === 0 ? first.id : randomUUID() })) };
  assert.equal((await commit(member, overflow)).status(), 400);
  const invalid = batchData(cycle, [pre.rows[0], batchRow(binary, 2)]);
  assert.equal((await json(await commit(member, invalid), 400)).rows[0].id, binary.id);
  const otherCycle = batchData(cycle, [pre.rows[0], batchRow(siblingResult, 5)]);
  assert.equal((await json(await commit(member, otherCycle), 404)).rows[0].id, siblingResult.id);
  const unauthorized = batchData(cycle, [pre.rows[0], batchRow(unwritable, 8)]);
  assert.equal((await json(await commit(member, unauthorized), 403)).rows[0].id, unwritable.id);
  assert.equal((await commit(stranger, pre)).status(), 409);
  assert.equal((await commit(inactive, pre)).status(), 403);
  assert.equal((await commit(anonymous, pre)).status(), 401);
  assert.equal((await history(member, first)).length, historyBefore.first);
  assert.equal((await history(member, binary)).length, historyBefore.binary);
  const requestId = randomUUID();
  const submitted = await Promise.all([commit(member, pre, requestId), commit(member, pre, requestId)]);
  assert.deepEqual(submitted.map(response => response.status()).sort(), [200, 201]);
  assert.deepEqual((await Promise.all(submitted.map(response => response.json()))).map(result => result.receipt.replayed).sort(), [false, true]);
  assert.equal((await commit(member, { ...pre, rows: [{ ...pre.rows[0], value: 62 }, pre.rows[1]] }, requestId)).status(), 409);
  assert.equal((await commit(await login('member'), { ...pre, rows: [...pre.rows].reverse() }, requestId)).status(), 200);
  assert.equal((await commit(admin, pre, requestId)).status(), 409, 'Another actor does not receive the original receipt');
  assert.equal((await history(member, first)).length, historyBefore.first + 1);
  assert.equal((await history(member, binary)).length, historyBefore.binary + 1);
  const updated = await liveResult(member, cycle.id, first.id);
  assert.equal(Number(updated.current), 61);
  const older = batchData(cycle, [batchRow(updated, 11)], dateFromToday(-10));
  assert.equal((await preview(member, older)).rows[0].wouldBeCurrent, false);
  assert.equal((await commit(member, older)).status(), 201);
  assert.equal(Number((await liveResult(member, cycle.id, first.id)).current), 61);
  assert.ok((await history(member, first)).some(row => Number(row.value) === 11 && !row.isCurrentEffective));

  // Two ordinary writes on different results must leave the same shared rollup as the ledger.
  const [nowFirst, nowHealthy] = await Promise.all([liveResult(member, cycle.id, first.id), liveResult(member, cycle.id, healthy.id)]);
  await Promise.all([checkIn(member, nowFirst, 65, 'at_risk'), checkIn(member, nowHealthy, 20, 'on_track')]);
  const workspace = await json(await member.get('/api/workspace'));
  const savedGoal = workspace.cycles.find(item => item.id === cycle.id).objectives.find(item => item.id === goal.id);
  assert.equal(Number(savedGoal.progress), 71.25);

  await db.query("UPDATE key_results SET last_check_in_at = now() - interval '16 days' WHERE id=$1", [healthy.id]);
  const query = new URLSearchParams({ ...replaced.filters, report: 'true' });
  const staleQuery = new URLSearchParams({ ...replaced.filters, staleOnly: 'true', report: 'true' });
  assert.deepEqual((await json(await member.get('/api/reports?' + staleQuery))).goals.map(row => row.id), [goal.id]);
  async function csv(path, options = query) {
    const response = await member.get(path + '?' + options);
    assert.equal(response.status(), 200, await response.text());
    const text = await response.text();
    assert.ok(text.includes(goal.title) && !text.includes(hidden.title), 'CSV uses current visibility');
    return text;
  }
  const report = await json(await member.get('/api/reports?' + query));
  assert.ok(report.goals.some(row => row.id === goal.id && row.progress === 71.25));
  assert.ok(!report.goals.some(row => row.id === hidden.id || row.id === siblingGoal.id));
  assert.match(await csv('/api/exports/okrs'), /Complete partner onboarding,.*65\.00/);
  assert.match(await csv('/api/exports/check-ins'), /Complete partner onboarding,.*65\.00/);
  assert.ok((await csv('/api/exports/okrs', new URLSearchParams({ ...filters, cycleId: 'all', q: '', report: 'true' }))).includes(siblingGoal.title));
  assert.equal((await member.delete(editView(view))).status(), 204);
  assert.equal((await newLogin.get(editView(view))).status(), 404);

  const closed = await json(await admin.post(api.cycles + '/' + secondCycle.id + '/close', { data: { version: secondCycle.version } }));
  assert.equal(closed.cycle.status, 'closed');
  const closedBatch = batchData(secondCycle, [batchRow(siblingResult, 5)]);
  assert.equal((await commit(member, closedBatch)).status(), 409);
  assert.equal((await preview(member, closedBatch, 403)).rows[0].id, siblingResult.id);
  assert.deepEqual((await json(await manager.get(queuePath(secondCycle)))).items, []);
  assert.equal((await json(await admin.post(api.cycles + '/' + secondCycle.id + '/archive'))).archived, true);
  const archivedQuery = new URLSearchParams({ ...staleView.filters, report: 'true' });
  for (const path of ['/api/reports', '/api/exports/okrs', '/api/exports/check-ins']) {
    assert.equal((await member.get(path + '?' + archivedQuery)).status(), 409);
  }
  assert.equal((await json(await member.get(editView(staleView)))).view.filters.cycleId, secondCycle.id);
  const all = new URLSearchParams({ ...replaced.filters, cycleId: 'all', report: 'true' });
  assert.ok(!(await csv('/api/exports/okrs', all)).includes(siblingGoal.title));
  all.set('includeArchived', 'true');
  assert.ok((await csv('/api/exports/okrs', all)).includes(siblingGoal.title));

  await verifyBrowser({ browser, origin, manager, member, cycle, first, binary });
  console.log('PASS: selected OKR workflows; direct-report queue and in-app deduplication; private report views and scoped CSV; atomic, replay-safe batch check-ins; measured desktop/mobile and keyboard recovery.');
}
