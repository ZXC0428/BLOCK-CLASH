const http=require('node:http');
const {readFile}=require('node:fs/promises');
const {join,extname}=require('node:path');
const {DatabaseSync}=require('node:sqlite');

const root=__dirname,db=new DatabaseSync(join(root,'block-clash.sqlite'));
db.exec(`CREATE TABLE IF NOT EXISTS level_progress (level_id INTEGER PRIMARY KEY, stars INTEGER NOT NULL, best_score INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS mode_scores (name TEXT PRIMARY KEY, best_score INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS leaderboard (mode TEXT NOT NULL, player_name TEXT NOT NULL, score INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(mode,player_name));
CREATE TABLE IF NOT EXISTS player_level_progress (player_name TEXT NOT NULL, level_id INTEGER NOT NULL, stars INTEGER NOT NULL, best_score INTEGER NOT NULL, PRIMARY KEY(player_name,level_id));
CREATE TABLE IF NOT EXISTS player_mode_scores (player_name TEXT NOT NULL, name TEXT NOT NULL, best_score INTEGER NOT NULL, PRIMARY KEY(player_name,name));`);

const reply=(response,status,payload)=>{response.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});response.end(JSON.stringify(payload))};
const body=request=>new Promise((resolve,reject)=>{let raw='';request.on('data',chunk=>raw+=chunk);request.on('end',()=>{try{resolve(JSON.parse(raw||'{}'))}catch(error){reject(error)}})});
const validName=value=>typeof value==='string'&&value.trim().length>=1&&Array.from(value.trim()).length<=16;
const cleanName=value=>validName(value)?value.trim():'';
const profile=()=>({name:db.prepare("SELECT value FROM settings WHERE key='player_name'").get()?.value||''});
const state=name=>({levels:Object.fromEntries(db.prepare('SELECT level_id,stars,best_score FROM player_level_progress WHERE player_name=?').all(name).map(row=>[row.level_id,{stars:row.stars,bestScore:row.best_score}])),modes:Object.fromEntries(db.prepare('SELECT name,best_score FROM player_mode_scores WHERE player_name=?').all(name).map(row=>[row.name,row.best_score]))});
const rankings=()=>({campaign:db.prepare('SELECT player_name AS name,MAX(level_id) AS level,SUM(stars) AS stars FROM player_level_progress GROUP BY player_name ORDER BY level DESC,stars DESC,player_name ASC LIMIT 10').all(),...Object.fromEntries(['sprint','score','endless'].map(mode=>[mode,db.prepare('SELECT player_name AS name,score FROM leaderboard WHERE mode=? ORDER BY score DESC,updated_at ASC LIMIT 10').all(mode)]))});
const queryName=request=>cleanName(new URL(request.url,'http://localhost').searchParams.get('playerName'));
const seedLegacyProgress=name=>{if(db.prepare('SELECT 1 FROM player_level_progress LIMIT 1').get()||db.prepare('SELECT 1 FROM player_mode_scores LIMIT 1').get())return;db.prepare('INSERT OR IGNORE INTO player_level_progress(player_name,level_id,stars,best_score) SELECT ?,level_id,stars,best_score FROM level_progress').run(name);db.prepare('INSERT OR IGNORE INTO player_mode_scores(player_name,name,best_score) SELECT ?,name,best_score FROM mode_scores').run(name)};

http.createServer(async(request,response)=>{try{
  const url=new URL(request.url,'http://localhost'),queryPlayer=queryName(request);
  if(request.method==='GET'&&url.pathname==='/api/progress')return queryPlayer?reply(response,200,state(queryPlayer)):reply(response,400,{error:'Player name required'});
  if(request.method==='GET'&&url.pathname==='/api/profile')return reply(response,200,profile());
  if(request.method==='GET'&&url.pathname==='/api/leaderboard')return reply(response,200,rankings());
  if(request.method==='POST'&&url.pathname==='/api/profile'){
    let{name}=await body(request);name=cleanName(name);if(!name)return reply(response,400,{error:'Name must contain 1 to 16 characters'});
    db.prepare("INSERT INTO settings(key,value) VALUES('player_name',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(name);
    seedLegacyProgress(name);
    return reply(response,200,{name});
  }
  if(request.method==='POST'&&url.pathname==='/api/progress/level'){
    let{levelId,stars,score,playerName}=await body(request),name=cleanName(playerName);
    if(!name||!Number.isInteger(levelId)||levelId<1||levelId>15||!Number.isInteger(stars)||stars<1||stars>3||!Number.isFinite(score))return reply(response,400,{error:'Invalid progress'});
    db.prepare('INSERT INTO player_level_progress VALUES (?,?,?,?) ON CONFLICT(player_name,level_id) DO UPDATE SET stars=MAX(stars,excluded.stars),best_score=MAX(best_score,excluded.best_score)').run(name,levelId,stars,score);
    return reply(response,200,state(name));
  }
  if(request.method==='POST'&&url.pathname==='/api/progress/mode'){
    let{name,score,playerName}=await body(request),player=cleanName(playerName);
    if(!player||!['sprint','score','endless'].includes(name)||!Number.isFinite(score))return reply(response,400,{error:'Invalid score'});
    db.prepare('INSERT INTO player_mode_scores VALUES (?,?,?) ON CONFLICT(player_name,name) DO UPDATE SET best_score=MAX(best_score,excluded.best_score)').run(player,name,score);
    db.prepare('INSERT INTO leaderboard VALUES (?,?,?,?) ON CONFLICT(mode,player_name) DO UPDATE SET score=MAX(score,excluded.score),updated_at=CASE WHEN excluded.score>score THEN excluded.updated_at ELSE updated_at END').run(name,player,Math.floor(score),Date.now());
    return reply(response,200,state(player));
  }
  let file=url.pathname==='/'?'index.html':url.pathname.slice(1);
  if(!/^[\w.-]+$/.test(file))return reply(response,404,{error:'Not found'});
  let data=await readFile(join(root,file)),type={'.html':'text/html','.js':'text/javascript','.css':'text/css'}[extname(file)]||'application/octet-stream';
  response.writeHead(200,{'Content-Type':type+'; charset=utf-8'});response.end(data);
}catch(error){reply(response,error.code==='ENOENT'?404:500,{error:'Server error'})}}).listen(3000,()=>console.log('BLOCK CLASH: http://localhost:3000'));
