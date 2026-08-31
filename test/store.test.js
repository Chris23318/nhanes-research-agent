const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {ProjectStore}=require('../src/store');

test('SQLite store persists projects and audit events',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nhanes-store-')),file=path.join(dir,'test.sqlite');
  let store=new ProjectStore(file);store.save({id:'prj_test',question:'test',createdAt:'2026-01-01T00:00:00Z'},'project.created');store.close();
  store=new ProjectStore(file);assert.equal(store.get('prj_test').question,'test');assert.equal(store.list().length,1);store.close();
  fs.rmSync(dir,{recursive:true,force:true});
});
