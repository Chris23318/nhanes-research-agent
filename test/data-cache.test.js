const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { assertOfficialFile, downloadFile, startDataCache, getDataCache } = require('../src/data-cache');

test('cache rejects URLs outside the fixed CDC XPT allowlist', () => {
  assert.throws(() => assertOfficialFile({ url: 'https://example.com/DEMO_J.XPT' }), /approved CDC/);
  assert.doesNotThrow(() => assertOfficialFile({ url: 'https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2017/DataFiles/DEMO_J.XPT' }));
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
