const http=require('http'),fs=require('fs'),path=require('path');
const {createProject,forkProject,getProject,listProjects,runProject,approveProject,saveEvidence,subscribe}=require('./src/orchestrator');
const {searchCatalog}=require('./src/catalog');
const {searchPubMed}=require('./src/pubmed');
const {generateRProject}=require('./src/analysis-package');
const {createAnalysisArchive}=require('./src/archive');
const {buildDataManifest,validateDataManifest}=require('./src/data-manifest');
const {startDataCache,getDataCache,cancelDataCache}=require('./src/data-cache');
const {startAnalysis,getAnalysis,cancelAnalysis,getAnalysisArchive,getAnalysisReport,getAnalysisExport,getAnalysisQuality}=require('./src/analysis-runner');
const {startFullExecution,getFullExecution,cancelFullExecution}=require('./src/full-execution');
const {fetchOfficialCatalog}=require('./src/cdc-catalog');
const {parseQuestion}=require('./src/question-parser');
const {SECURITY_HEADERS,createRateLimiter}=require('./src/http-security');
const {createAuth}=require('./src/auth');
const {defaultStore}=require('./src/store');
const {exportProjectBackup,importProjectBackup}=require('./src/project-backup');
const {BackupManager}=require('./src/backup-manager');
const {OssBackupManager}=require('./src/oss-backup');
const root=__dirname,types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.md':'text/markdown; charset=utf-8'};
const limiter=createRateLimiter(),heavy=/\/(?:run|execute|codebook-review|data-manifest-validate|data-cache|analysis-run)$|^\/api\/projects\/import$|\/api\/tools\/(?:pubmed\/search|parse-question)$/;
const auth=createAuth();
const offsiteBackupManager=new OssBackupManager();
const backupManager=new BackupManager(defaultStore,{afterBackup:snapshot=>offsiteBackupManager.upload(snapshot)});
let shuttingDown=false;
function enforceRate(req,url){const key=req.socket.remoteAddress||'unknown',normal=limiter.check(key,'all',300,60000);if(!normal.allowed)return normal;const expensive=req.method==='POST'&&heavy.test(url.pathname)||req.method==='GET'&&/\/analysis-(?:report-(?:pdf|docx)|result-download)$/.test(url.pathname);if(expensive)return limiter.check(key,'heavy',20,600000);return normal}
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value))}
function publicBackupStatus(value){const safe={...value,lastError:value.lastError?'see_server_logs':null};delete safe.lastChecksum;delete safe.lastRequestId;return safe}
async function body(req,maxBytes=65536){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>maxBytes){const e=new Error('request body too large');e.status=413;throw e}chunks.push(chunk)}if(!chunks.length)return{};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{const e=new Error('invalid JSON');e.status=400;throw e}}
async function api(req,res,url){
  if(req.method==='GET'&&url.pathname==='/api/health')return json(res,200,{status:'ok',service:'nhanes-research-agent',version:'2.23.0',mode:'agent-orchestrated-mvp',authEnabled:auth.enabled,shuttingDown});
  if(req.method==='GET'&&url.pathname==='/api/health/ready'){const database=require('./src/store').defaultStore.health(),ready=database.ok&&!shuttingDown;return json(res,ready?200:503,{status:ready?'ready':'not_ready',database,shuttingDown})}
  if(req.method==='GET'&&url.pathname==='/api/health/diagnostics'){const backupState=backupManager.status(),offsiteState=offsiteBackupManager.status(),database=defaultStore.health(),runtime={uptimeSeconds:Math.floor(process.uptime()),memoryMegabytes:Math.round(process.memoryUsage().rss/1024/1024),node:process.version},status=database.ok&&backupState.ok&&offsiteState.ok&&!shuttingDown?'healthy':'degraded';return json(res,status==='healthy'?200:503,{status,database,backups:publicBackupStatus(backupState),offsiteBackups:publicBackupStatus(offsiteState),workload:defaultStore.stats(),runtime,shuttingDown})}
  if(req.method==='GET'&&url.pathname==='/api/auth/session')return json(res,200,auth.session(req));
  if(req.method==='POST'&&url.pathname==='/api/auth/login'){const rate=limiter.check(req.socket.remoteAddress||'unknown','login',10,15*60*1000);if(!rate.allowed)return json(res,429,{error:{code:'RATE_LIMITED',message:'登录尝试过多，请稍后重试'}});const input=await body(req);if(!auth.enabled||String(input.username||'')!==auth.username||!auth.verifyPassword(input.password)){return json(res,401,{error:{code:'INVALID_CREDENTIALS',message:'用户名或密码错误'}})}const token=auth.issue();res.setHeader('Set-Cookie',auth.cookie(token));return json(res,200,auth.session({headers:{cookie:`nhanes_session=${token}`}}))}
  const identity=auth.authenticate(req);
  if(auth.enabled&&!identity)return json(res,401,{error:{code:'AUTH_REQUIRED',message:'请先登录'}});
  if(auth.enabled&&!['GET','HEAD','OPTIONS'].includes(req.method)&&url.pathname!=='/api/auth/logout'&&!auth.validCsrf(req,identity))return json(res,403,{error:{code:'CSRF_REJECTED',message:'安全令牌无效，请刷新页面后重试'}});
  if(req.method==='POST'&&url.pathname==='/api/auth/logout'){if(auth.enabled&&!auth.validCsrf(req,identity))return json(res,403,{error:{code:'CSRF_REJECTED',message:'安全令牌无效'}});res.setHeader('Set-Cookie',auth.expiredCookie());return json(res,200,{authenticated:false})}
  if(url.pathname==='/api/projects/import'){
    if(!auth.enabled)return json(res,403,{error:{code:'AUTH_REQUIRED_FOR_BACKUP',message:'项目备份导入仅在 HTTPS 管理员登录启用后开放'}});
    if(req.method==='POST')return json(res,201,importProjectBackup(await body(req,5*1024*1024),defaultStore));
  }
  const weightAdviceRoute=url.pathname.match(/^\/api\/projects\/([^/]+)\/weight-advice$/);
  if(req.method==='POST'&&weightAdviceRoute)return json(res,200,require('./src/orchestrator').getWeightAdvice(weightAdviceRoute[1],await body(req)));
  const modelSpecRoute=url.pathname.match(/^\/api\/projects\/([^/]+)\/model-spec$/);
  if(req.method==='POST'&&modelSpecRoute)return json(res,200,require('./src/orchestrator').approveModelSpec(modelSpecRoute[1],await body(req)));
  const cleaningRoute=url.pathname.match(/^\/api\/projects\/([^/]+)\/cleaning-(draft|approval)$/);
  if(req.method==='GET'&&cleaningRoute&&cleaningRoute[2]==='draft')return json(res,200,require('./src/cleaning-draft').buildCleaningDraft(require('./src/orchestrator').getProject(cleaningRoute[1])));
  if(req.method==='POST'&&cleaningRoute&&cleaningRoute[2]==='approval')return json(res,200,require('./src/orchestrator').approveCleaning(cleaningRoute[1],await body(req)));
  const codebookRoute=url.pathname.match(/^\/api\/projects\/([^/]+)\/codebook-review$/);
  if(req.method==='POST'&&codebookRoute)return json(res,200,await require('./src/orchestrator').reviewCodebooks(codebookRoute[1]));
  const selectionRoute=url.pathname.match(/^\/api\/projects\/([^/]+)\/candidate-selection$/);
  if(req.method==='POST'&&selectionRoute){const input=await body(req);return json(res,200,Array.isArray(input.items)?require('./src/orchestrator').saveCandidates(selectionRoute[1],input):require('./src/orchestrator').saveCandidate(selectionRoute[1],input));}
  if(req.method==='GET'&&url.pathname==='/api/catalog/variables')return json(res,200,{items:searchCatalog(url.searchParams.get('q')||''),mode:'verified-demo-snapshot'});
  if(req.method==='GET'&&url.pathname==='/api/catalog/cdc'){return json(res,200,await fetchOfficialCatalog({component:url.searchParams.get('component')||'Demographics',cycle:url.searchParams.get('cycle')||'',query:url.searchParams.get('q')||'',limit:url.searchParams.get('limit')||100}))}
  if(req.method==='POST'&&url.pathname==='/api/tools/pubmed/search'){const input=await body(req);return json(res,200,await searchPubMed(input,{email:process.env.NCBI_EMAIL,apiKey:process.env.NCBI_API_KEY,tool:'nhanes_research_agent'}))}
  if(req.method==='POST'&&url.pathname==='/api/tools/parse-question'){const input=await body(req);return json(res,200,parseQuestion(input.question||''))}
  if(req.method==='POST'&&url.pathname==='/api/projects')return json(res,201,createProject(await body(req)));
  if(req.method==='GET'&&url.pathname==='/api/projects')return json(res,200,{items:listProjects(url.searchParams.get('limit'))});
  const match=url.pathname.match(/^\/api\/projects\/([^/]+)(?:\/(run|fork|backup|execute|approve|events|audit|analysis-package|analysis-package-download|analysis-run|analysis-quality|analysis-report|analysis-report-pdf|analysis-report-docx|analysis-tables-download|analysis-manuscript-download|analysis-result-download|data-manifest|data-manifest-validate|data-cache|evidence))?$/);if(!match)return json(res,404,{error:{code:'NOT_FOUND',message:'route not found'}});
  const [,projectId,action]=match;
  if(req.method==='GET'&&!action)return json(res,200,getProject(projectId));
  if(req.method==='POST'&&action==='fork')return json(res,201,forkProject(projectId,await body(req)))
  if(req.method==='GET'&&action==='backup'){
    if(!auth.enabled)return json(res,403,{error:{code:'AUTH_REQUIRED_FOR_BACKUP',message:'项目备份下载仅在 HTTPS 管理员登录启用后开放'}});
    const backup=exportProjectBackup(projectId,defaultStore),content=Buffer.from(JSON.stringify(backup,null,2));
    res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="nhanes-backup-${projectId}.json"`,'Content-Length':content.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(content)
  }
  if(req.method==='GET'&&action==='audit'){getProject(projectId);const events=require('./src/store').defaultStore.auditTrail(projectId);return json(res,200,{projectId,chainVerified:events.filter(item=>item.verified!==null).every(item=>item.verified),events})}
  if(req.method==='POST'&&action==='run'){runProject(projectId).catch(console.error);return json(res,202,{projectId,status:'running'})}
  if(req.method==='POST'&&action==='execute')return json(res,202,startFullExecution(getProject(projectId)))
  if(req.method==='GET'&&action==='execute')return json(res,200,getFullExecution(projectId))
  if(req.method==='DELETE'&&action==='execute')return json(res,200,cancelFullExecution(projectId))
  if(req.method==='POST'&&action==='approve')return json(res,200,approveProject(projectId,await body(req)));
  if(req.method==='POST'&&action==='evidence')return json(res,200,saveEvidence(projectId,await body(req)));
  if(req.method==='GET'&&action==='analysis-package')return json(res,200,generateRProject(getProject(projectId)));
  if(req.method==='GET'&&action==='analysis-package-download'){const archive=createAnalysisArchive(generateRProject(getProject(projectId)));res.writeHead(200,{'Content-Type':'application/gzip','Content-Disposition':`attachment; filename="nhanes-${projectId}.tar.gz"`,'Content-Length':archive.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(archive)}
  if(req.method==='GET'&&action==='data-manifest')return json(res,200,buildDataManifest(getProject(projectId)));
  if(req.method==='POST'&&action==='data-manifest-validate')return json(res,200,await validateDataManifest(buildDataManifest(getProject(projectId))));
  if(req.method==='POST'&&action==='data-cache')return json(res,202,startDataCache(getProject(projectId)));
  if(req.method==='GET'&&action==='data-cache')return json(res,200,getDataCache(projectId));
  if(req.method==='DELETE'&&action==='data-cache')return json(res,200,cancelDataCache(projectId));
  if(req.method==='POST'&&action==='analysis-run')return json(res,202,startAnalysis(getProject(projectId)));
  if(req.method==='GET'&&action==='analysis-run')return json(res,200,getAnalysis(projectId));
  if(req.method==='DELETE'&&action==='analysis-run')return json(res,200,cancelAnalysis(projectId));
  if(req.method==='GET'&&action==='analysis-quality')return json(res,200,getAnalysisQuality(projectId));
  if(req.method==='GET'&&action==='analysis-report'){const report=getAnalysisReport(getProject(projectId));res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; img-src data:"});return res.end(report)}
  if(req.method==='GET'&&['analysis-report-pdf','analysis-report-docx','analysis-tables-download','analysis-manuscript-download'].includes(action)){const format={'analysis-report-pdf':'pdf','analysis-report-docx':'docx','analysis-tables-download':'tables','analysis-manuscript-download':'manuscript'}[action],artifact=await getAnalysisExport(getProject(projectId),format),content=artifact.content;res.writeHead(200,{'Content-Type':artifact.contentType,'Content-Disposition':`attachment; filename="nhanes-${format}-${projectId}.${artifact.extension}"`,'Content-Length':content.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(content)}
  if(req.method==='GET'&&action==='analysis-result-download'){const archive=await getAnalysisArchive(getProject(projectId));res.writeHead(200,{'Content-Type':'application/gzip','Content-Disposition':`attachment; filename="nhanes-results-${projectId}.tar.gz"`,'Content-Length':archive.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(archive)}
  if(req.method==='GET'&&action==='events'){const project=getProject(projectId);res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache',Connection:'keep-alive'});for(const event of project.events)res.write(`data: ${JSON.stringify(event)}\n\n`);const off=subscribe(projectId,event=>res.write(`data: ${JSON.stringify(event)}\n\n`));req.on('close',off);return}
  return json(res,405,{error:{code:'METHOD_NOT_ALLOWED',message:'method not allowed'}})
}
function staticFile(res,url){const target=url.pathname==='/'?'index.html':url.pathname.slice(1),file=path.normalize(path.join(root,target));if(!file.startsWith(root)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);return res.end('Not found')}res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});fs.createReadStream(file).pipe(res)}
const server=http.createServer(async(req,res)=>{for(const [name,value] of Object.entries(SECURITY_HEADERS))res.setHeader(name,value);const url=new URL(req.url,'http://localhost');if(shuttingDown&&!['/api/health','/api/health/ready','/api/health/diagnostics'].includes(url.pathname)){res.setHeader('Connection','close');return json(res,503,{error:{code:'SERVER_DRAINING',message:'服务正在安全更新，请稍后重试'}})}const rate=enforceRate(req,url);if(!rate.allowed){res.setHeader('Retry-After',String(rate.retryAfter));return json(res,429,{error:{code:'RATE_LIMITED',message:'请求过于频繁，请稍后重试'}})}try{if(url.pathname.startsWith('/api/'))await api(req,res,url);else staticFile(res,url)}catch(error){if(!res.headersSent)json(res,error.status||500,{error:{code:error.code||'INTERNAL_ERROR',message:error.status?error.message:'internal server error'}})}});
if(require.main===module){const offsite=offsiteBackupManager.status();backupManager.start({forceInitial:offsite.enabled&&offsite.configured});server.listen(process.env.PORT||4173,()=>console.log('NHANES Lab: http://localhost:4173'));const shutdown=signal=>{if(shuttingDown)return;shuttingDown=true;backupManager.stop();console.log(JSON.stringify({event:'server.draining',signal,at:new Date().toISOString()}));server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),25000).unref()};process.on('SIGTERM',()=>shutdown('SIGTERM'));process.on('SIGINT',()=>shutdown('SIGINT'))}
module.exports={server,backupManager,offsiteBackupManager,publicBackupStatus};
