const fs=require('fs');
const path=require('path');
const {DatabaseSync}=require('node:sqlite');

class ProjectStore{
  constructor(filename=process.env.DATABASE_PATH||':memory:'){
    if(filename!==':memory:')fs.mkdirSync(path.dirname(filename),{recursive:true});
    this.db=new DatabaseSync(filename);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS audit_events(id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, event_type TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL);');
    this.upsert=this.db.prepare('INSERT INTO projects(id,data,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at');
    this.selectOne=this.db.prepare('SELECT data FROM projects WHERE id=?');
    this.selectAll=this.db.prepare('SELECT data FROM projects ORDER BY updated_at DESC LIMIT ?');
    this.insertAudit=this.db.prepare('INSERT INTO audit_events(project_id,event_type,payload,created_at) VALUES(?,?,?,?)');
  }
  save(project,eventType='project.updated',payload={}){const now=new Date().toISOString();this.upsert.run(project.id,JSON.stringify(project),project.createdAt||now,now);this.insertAudit.run(project.id,eventType,JSON.stringify(payload),now);return project}
  get(id){const row=this.selectOne.get(id);return row?JSON.parse(row.data):null}
  list(limit=50){return this.selectAll.all(Math.min(Math.max(Number(limit)||50,1),100)).map(row=>JSON.parse(row.data))}
  close(){this.db.close()}
}

const defaultStore=new ProjectStore();
module.exports={ProjectStore,defaultStore};
