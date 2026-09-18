const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {DatabaseSync}=require('node:sqlite');

class ProjectStore{
  constructor(filename=process.env.DATABASE_PATH||':memory:'){
    if(filename!==':memory:')fs.mkdirSync(path.dirname(filename),{recursive:true});
    this.db=new DatabaseSync(filename);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS audit_events(id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, event_type TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, prev_hash TEXT, event_hash TEXT); CREATE TABLE IF NOT EXISTS jobs(scope TEXT NOT NULL, project_id TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(scope,project_id));');
    const auditColumns=new Set(this.db.prepare('PRAGMA table_info(audit_events)').all().map(row=>row.name));
    if(!auditColumns.has('prev_hash'))this.db.exec('ALTER TABLE audit_events ADD COLUMN prev_hash TEXT');
    if(!auditColumns.has('event_hash'))this.db.exec('ALTER TABLE audit_events ADD COLUMN event_hash TEXT');
    this.upsert=this.db.prepare('INSERT INTO projects(id,data,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at');
    this.selectOne=this.db.prepare('SELECT data FROM projects WHERE id=?');
    this.selectAll=this.db.prepare('SELECT data FROM projects ORDER BY updated_at DESC LIMIT ?');
    this.insertAudit=this.db.prepare('INSERT INTO audit_events(project_id,event_type,payload,created_at,prev_hash,event_hash) VALUES(?,?,?,?,?,?)');
    this.lastAudit=this.db.prepare('SELECT event_hash FROM audit_events WHERE project_id=? AND event_hash IS NOT NULL ORDER BY id DESC LIMIT 1');
    this.selectAudit=this.db.prepare('SELECT id,project_id,event_type,payload,created_at,prev_hash,event_hash FROM audit_events WHERE project_id=? ORDER BY id ASC LIMIT ?');
    this.upsertJob=this.db.prepare('INSERT INTO jobs(scope,project_id,data,updated_at) VALUES(?,?,?,?) ON CONFLICT(scope,project_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at');
    this.selectJob=this.db.prepare('SELECT data FROM jobs WHERE scope=? AND project_id=?');
    this.selectJobs=this.db.prepare('SELECT data FROM jobs WHERE scope=? ORDER BY updated_at ASC');
  }
  save(project,eventType='project.updated',payload={}){const now=new Date().toISOString(),payloadJson=JSON.stringify(payload),prevHash=this.lastAudit.get(project.id)?.event_hash||'',eventHash=ProjectStore.auditHash(project.id,eventType,payloadJson,now,prevHash);this.db.exec('BEGIN IMMEDIATE');try{this.upsert.run(project.id,JSON.stringify(project),project.createdAt||now,now);this.insertAudit.run(project.id,eventType,payloadJson,now,prevHash,eventHash);this.db.exec('COMMIT')}catch(error){this.db.exec('ROLLBACK');throw error}return project}
  get(id){const row=this.selectOne.get(id);return row?JSON.parse(row.data):null}
  list(limit=50){return this.selectAll.all(Math.min(Math.max(Number(limit)||50,1),100)).map(row=>JSON.parse(row.data))}
  saveJob(scope,projectId,data){this.upsertJob.run(scope,projectId,JSON.stringify(data),new Date().toISOString());return data}
  getJob(scope,projectId){const row=this.selectJob.get(scope,projectId);return row?JSON.parse(row.data):null}
  listJobs(scope){return this.selectJobs.all(scope).map(row=>JSON.parse(row.data))}
  health(){try{const quick=this.db.prepare('PRAGMA quick_check(1)').get();return{ok:quick?.quick_check==='ok',database:'sqlite',checkedAt:new Date().toISOString()}}catch(error){return{ok:false,database:'sqlite',checkedAt:new Date().toISOString(),error:String(error.message||error).slice(0,200)}}}
  auditTrail(projectId,limit=1000){let previous='';return this.selectAudit.all(projectId,Math.min(Math.max(Number(limit)||1000,1),5000)).map(row=>{const legacy=!row.event_hash,expected=legacy?null:ProjectStore.auditHash(row.project_id,row.event_type,row.payload,row.created_at,row.prev_hash||''),verified=legacy?null:row.prev_hash===previous&&expected===row.event_hash;if(!legacy)previous=row.event_hash;return{id:row.id,projectId:row.project_id,eventType:row.event_type,payload:JSON.parse(row.payload),createdAt:row.created_at,previousHash:row.prev_hash||null,eventHash:row.event_hash||null,verified}})}
  static auditHash(projectId,eventType,payloadJson,createdAt,previousHash=''){return crypto.createHash('sha256').update([projectId,eventType,payloadJson,createdAt,previousHash].join('\n')).digest('hex')}
  close(){this.db.close()}
}

const defaultStore=new ProjectStore();
module.exports={ProjectStore,defaultStore};
