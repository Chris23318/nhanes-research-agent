const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDataManifest, validateDataManifest } = require('../src/data-manifest');

test('vitamin D project maps six cycles to 24 fixed CDC XPT files', () => {
  const project = { intent: { cycles: ['2007-2008','2009-2010','2011-2012','2013-2014','2015-2016','2017-2018'] }, variables: ['DEMO','VID','DPQ','BMX'].map(source => ({ source })) };
  const manifest = buildDataManifest(project);
  assert.equal(manifest.files.length, 24);
  assert.equal(new URL(manifest.files[0].url).hostname, 'wwwn.cdc.gov');
  assert.ok(manifest.files.some(item => item.code === 'VID_J'));
  assert.match(manifest.analyticNotes[0].rule, /LBXVIDMS/);
});

test('data validation checks XPT signature and reported size', async () => {
  const manifest = { files: [{ cycle:'2017-2018', code:'VID_J', url:'https://wwwn.cdc.gov/test/VID_J.XPT' }] };
  const body = Buffer.alloc(80); body.write('HEADER RECORD');
  const fetchImpl = async () => new Response(body, { status: 206, headers: { 'content-range': 'bytes 0-79/604400' } });
  const result = await validateDataManifest(manifest, { fetchImpl, timeoutMs: 100 });
  assert.equal(result.summary.valid, 1); assert.equal(result.summary.totalBytes, 604400);
});
