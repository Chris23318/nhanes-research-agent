process.env.PUBMED_AUTO_SEARCH='false';
const test=require('node:test');
const assert=require('node:assert/strict');
const {server}=require('../server');

let base;
test.before(async()=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`});
test.after(()=>server.close());

test('health endpoint exposes version and browser security headers',async()=>{const response=await fetch(`${base}/api/health`);assert.equal(response.status,200);const body=await response.json();assert.equal(body.mode,'agent-orchestrated-mvp');assert.equal(body.version,'2.18.0');assert.equal(body.authEnabled,false);assert.equal(response.headers.get('x-frame-options'),'DENY');assert.match(response.headers.get('content-security-policy'),/script-src 'self'/)});
test('web app includes authentication, versioning and resumable Agent transitions',async()=>{const page=await fetch(base).then(response=>response.text()),script=await fetch(`${base}/app.js`).then(response=>response.text());assert.match(page,/id="authGate"/);assert.match(page,/id="loginForm"/);assert.match(page,/id="agentTransition"/);assert.match(page,/aria-live="polite"/);assert.match(page,/id="transitionMinimize"/);assert.match(script,/X-CSRF-Token/);assert.match(script,/forkStudy/);assert.match(script,/transitionCancel/);assert.match(script,/resilientFetch/);assert.match(script,/method:'DELETE'/);assert.match(script,/已恢复正在运行的研究任务/);assert.match(script,/服务器重启后已恢复此任务/);assert.match(script,/正在核验官方代码本/);assert.match(script,/正在验证 CDC 数据文件/);assert.match(script,/正在缓存 NHANES 数据/);assert.match(script,/正在执行 R survey 分析/)});

test('catalog endpoint returns provenance',async()=>{const response=await fetch(`${base}/api/catalog/variables?q=LBXVIDMS`);const body=await response.json();assert.equal(body.items.length,1);assert.equal(body.items[0].provenance.publisher,'CDC/NCHS')});

test('project lifecycle reaches the approval gate',async()=>{
  let response=await fetch(`${base}/api/projects`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question:'Study serum vitamin D and depressive symptoms among NHANES adults'})});
  assert.equal(response.status,201);const project=await response.json();
  response=await fetch(`${base}/api/projects/${project.id}/run`,{method:'POST'});assert.equal(response.status,202);
  await new Promise(resolve=>setTimeout(resolve,700));
  response=await fetch(`${base}/api/projects/${project.id}`);const completed=await response.json();
  assert.equal(completed.status,'awaiting_approval');assert.equal(completed.variables.length,11);assert.equal(completed.feasibility.status,'executable');assert.equal(completed.literature.mode,'disabled');assert.match(completed.literature.query,/NHANES/);
  response=await fetch(`${base}/api/projects/${project.id}/evidence`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query:'vitamin D AND depression AND NHANES',items:[{pmid:'123',title:'A study',decision:'include',methodTags:['logistic regression'],publicationTypes:['Journal Article'],relevanceScore:100}]})});
  assert.equal(response.status,200);const screened=await response.json();assert.equal(screened.evidence.summary.included,1);assert.equal(screened.protocol.evidenceIncluded,1);
  response=await fetch(`${base}/api/projects/${project.id}/data-manifest`);assert.equal(response.status,200);const dataManifest=await response.json();assert.equal(dataManifest.files.length,24);assert.ok(dataManifest.files.every(file=>file.url.startsWith('https://wwwn.cdc.gov/')));
  response=await fetch(`${base}/api/projects/${project.id}/data-cache`);assert.equal(response.status,200);assert.equal((await response.json()).status,'not_started');
  response=await fetch(`${base}/api/projects/${project.id}/analysis-run`);assert.equal(response.status,200);assert.equal((await response.json()).status,'not_started');
  response=await fetch(`${base}/api/projects/${project.id}/execute`);assert.equal(response.status,200);assert.equal((await response.json()).status,'not_started');
  response=await fetch(`${base}/api/projects/${project.id}/execute`,{method:'DELETE'});assert.equal(response.status,200);assert.equal((await response.json()).status,'not_started');
  response=await fetch(`${base}/api/projects/${project.id}/data-cache`,{method:'DELETE'});assert.equal(response.status,200);assert.equal((await response.json()).status,'not_started');
  response=await fetch(`${base}/api/projects/${project.id}/analysis-run`,{method:'DELETE'});assert.equal(response.status,200);assert.equal((await response.json()).status,'not_started');
  response=await fetch(`${base}/api/projects/${project.id}/execute`,{method:'POST'});assert.equal(response.status,409);assert.equal((await response.json()).error.code,'ANALYSIS_NOT_READY');
  response=await fetch(`${base}/api/projects/${project.id}/analysis-package-download`);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/gzip');assert.ok((await response.arrayBuffer()).byteLength>1000);
  response=await fetch(`${base}/api/projects/${project.id}/approve`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({actor:'tester',decisions:{outcome_definition:'PHQ-9 >= 10',exposure_parameterization:'per 10 nmol/L',covariate_set:'age, sex, race, PIR, BMI',missing_data:'complete case',association_only:true}})});
  assert.equal(response.status,200);assert.equal((await response.json()).status,'approved');
  response=await fetch(`${base}/api/projects/${project.id}/execute`);assert.equal(response.status,200);assert.equal((await response.json()).status,'not_started');
  response=await fetch(`${base}/api/projects?limit=10`);assert.equal(response.status,200);const listing=await response.json();assert.ok(listing.items.some(item=>item.id===project.id));
  response=await fetch(`${base}/api/projects/${project.id}/audit`);assert.equal(response.status,200);const audit=await response.json();assert.equal(audit.chainVerified,true);assert.ok(audit.events.length>=8);assert.ok(audit.events.every(event=>event.verified===true));
});
