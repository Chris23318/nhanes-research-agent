const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {ProjectStore}=require('../src/store');

test('SQLite store persists projects and audit events',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nhanes-store-')),file=path.join(dir,'test.sqlite');
  let store=new ProjectStore(file);store.save({id:'prj_test',question:'test',createdAt:'2026-01-01T00:00:00Z'},'project.created');store.save({id:'prj_test',question:'updated',createdAt:'2026-01-01T00:00:00Z'},'project.updated',{field:'question'});store.saveJob('full-execution','prj_test',{projectId:'prj_test',status:'running'});store.close();
  store=new ProjectStore(file);assert.equal(store.get('prj_test').question,'updated');assert.equal(store.list().length,1);assert.equal(store.getJob('full-execution','prj_test').status,'running');assert.equal(store.listJobs('full-execution').length,1);assert.equal(store.stats().projects,1);assert.equal(store.stats().jobs['full-execution'].statuses.running,1);const audit=store.auditTrail('prj_test');assert.equal(audit.length,2);assert.ok(audit.every(event=>event.verified===true));assert.equal(audit[1].previousHash,audit[0].eventHash);store.db.prepare('UPDATE audit_events SET payload=? WHERE id=?').run('{"tampered":true}',audit[0].id);assert.equal(store.auditTrail('prj_test')[0].verified,false);store.close();
  fs.rmSync(dir,{recursive:true,force:true});
});
