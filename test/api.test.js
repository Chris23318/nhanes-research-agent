const test=require('node:test');
const assert=require('node:assert/strict');
const {server}=require('../server');

let base;
test.before(async()=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`});
test.after(()=>server.close());

test('health endpoint exposes demo mode',async()=>{const response=await fetch(`${base}/api/health`);assert.equal(response.status,200);assert.equal((await response.json()).mode,'demo')});

test('project lifecycle reaches the approval gate',async()=>{
  let response=await fetch(`${base}/api/projects`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question:'Study serum vitamin D and depressive symptoms among NHANES adults'})});
  assert.equal(response.status,201);const project=await response.json();
  response=await fetch(`${base}/api/projects/${project.id}/run`,{method:'POST'});assert.equal(response.status,202);
  await new Promise(resolve=>setTimeout(resolve,700));
  response=await fetch(`${base}/api/projects/${project.id}`);const completed=await response.json();
  assert.equal(completed.status,'awaiting_approval');assert.equal(completed.variables.length,10);
  response=await fetch(`${base}/api/projects/${project.id}/approve`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({actor:'tester'})});
  assert.equal(response.status,200);assert.equal((await response.json()).status,'approved');
});
