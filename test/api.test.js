const test=require('node:test');
const assert=require('node:assert/strict');
const {server}=require('../server');

let base;
test.before(async()=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`});
test.after(()=>server.close());

test('health endpoint exposes demo mode',async()=>{const response=await fetch(`${base}/api/health`);assert.equal(response.status,200);assert.equal((await response.json()).mode,'demo')});

test('catalog endpoint returns provenance',async()=>{const response=await fetch(`${base}/api/catalog/variables?q=LBXVIDMS`);const body=await response.json();assert.equal(body.items.length,1);assert.equal(body.items[0].provenance.publisher,'CDC/NCHS')});

test('project lifecycle reaches the approval gate',async()=>{
  let response=await fetch(`${base}/api/projects`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question:'Study serum vitamin D and depressive symptoms among NHANES adults'})});
  assert.equal(response.status,201);const project=await response.json();
  response=await fetch(`${base}/api/projects/${project.id}/run`,{method:'POST'});assert.equal(response.status,202);
  await new Promise(resolve=>setTimeout(resolve,700));
  response=await fetch(`${base}/api/projects/${project.id}`);const completed=await response.json();
  assert.equal(completed.status,'awaiting_approval');assert.equal(completed.variables.length,10);
  response=await fetch(`${base}/api/projects/${project.id}/evidence`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query:'vitamin D AND depression AND NHANES',items:[{pmid:'123',title:'A study',decision:'include',methodTags:['logistic regression'],publicationTypes:['Journal Article'],relevanceScore:100}]})});
  assert.equal(response.status,200);const screened=await response.json();assert.equal(screened.evidence.summary.included,1);assert.equal(screened.protocol.evidenceIncluded,1);
  response=await fetch(`${base}/api/projects/${project.id}/data-manifest`);assert.equal(response.status,200);const dataManifest=await response.json();assert.equal(dataManifest.files.length,24);assert.ok(dataManifest.files.every(file=>file.url.startsWith('https://wwwn.cdc.gov/')));
  response=await fetch(`${base}/api/projects/${project.id}/data-cache`);assert.equal(response.status,200);assert.equal((await response.json()).status,'not_started');
  response=await fetch(`${base}/api/projects/${project.id}/analysis-package-download`);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/gzip');assert.ok((await response.arrayBuffer()).byteLength>1000);
  response=await fetch(`${base}/api/projects/${project.id}/approve`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({actor:'tester'})});
  assert.equal(response.status,200);assert.equal((await response.json()).status,'approved');
});
