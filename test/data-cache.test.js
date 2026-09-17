const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { assertOfficialFile, downloadFile, startDataCache, getDataCache, cancelDataCache } = require('../src/data-cache');

test('cache rejects URLs outside the fixed CDC XPT allowlist', () => {
  assert.throws(() => assertOfficialFile({ url: 'https://example.com/DEMO_J.XPT' }), /approved CDC/);
  assert.doesNotThrow(() => assertOfficialFile({ url: 'https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2017/DataFiles/DEMO_J.XPT' }));
  assert.doesNotThrow(() => assertOfficialFile({ url: 'https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2017/DataFiles/PBCD_J.XPT' }));
  assert.throws(() => assertOfficialFile({ url: 'https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2017/DataFiles/../secret_J.XPT' }), /approved CDC/);
  assert.throws(() => assertOfficialFile({ url: 'https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2017/DataFiles/PBCD_J.XPT?redirect=1' }), /approved CDC/);
});

test('cache streams a valid XPT file and records its digest', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nhanes-cache-test-'));
  const payload = Buffer.concat([Buffer.from('HEADER RECORD*******LIBRARY HEADER RECORD'), Buffer.alloc(200)]);
  const file = { code: 'VID_J', url: 'https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2017/DataFiles/VID_J.XPT' };
  try {
    const result = await downloadFile(file, directory, async () => new Response(payload, { status: 200, headers: { 'content-length': String(payload.length) } }));
    assert.equal(result.bytes, payload.length); assert.match(result.sha256, /^[a-f0-9]{64}$/); assert.ok(fs.existsSync(result.path));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('cache jobs expose bounded progress and deduplicate active work', async () => {
  const project = { id: 'prj_1234567890abcdef', intent: { cycles: ['2017-2018'] }, variables: [{ source: 'VID' }] };
  const payload = Buffer.concat([Buffer.from('HEADER RECORD*******LIBRARY HEADER RECORD'), Buffer.alloc(200)]);
  const first = startDataCache(project, { fetchImpl: async () => new Response(payload) });
  const second = startDataCache(project, { fetchImpl: async () => new Response(payload) }); assert.equal(second.id, first.id);
  await new Promise(resolve => setTimeout(resolve, 100)); const completed = getDataCache(project.id); assert.equal(completed.status, 'completed'); assert.equal(completed.completedFiles, 1);
});

test('queued cache jobs can be cancelled safely', async () => {
  const project = { id: 'prj_9999999999999999', intent: { cycles: ['2017-2018'] }, variables: [{ source: 'VID' }] };
  const started = startDataCache(project, { fetchImpl: async () => { throw new Error('cancelled job must not fetch'); } });
  const cancelled = cancelDataCache(project.id);
  assert.equal(cancelled.id, started.id);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.error, null);
  await new Promise(resolve => setImmediate(resolve));
});

test('active downloads receive an abort signal', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nhanes-cache-cancel-'));
  const file = { code: 'VID_J', url: 'https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2017/DataFiles/VID_J.XPT' };
  const controller = new AbortController();
  try {
    const pending = downloadFile(file, directory, (url, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })), controller.signal);
    controller.abort(new Error('test cancellation'));
    await assert.rejects(pending, /test cancellation/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
