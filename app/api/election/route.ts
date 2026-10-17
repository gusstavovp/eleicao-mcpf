import {database,bucket,isAdmin as auth,getUser,access,client} from '../../../lib/server';
export const dynamic='force-dynamic';

const json=(x:any,status=200,headers:any={})=>Response.json(x,{status,headers:{'Cache-Control':'no-store',...headers}});
export async function GET(r:Request){
 const rows=await database(r).prepare('SELECT * FROM elections ORDER BY rowid DESC').all();
 const profile=await access(r);let voted:string[]=[];
 if(profile?.role==='student'){const {data,error}=await client(r).from('vote_receipts').select('election_id');if(error)throw error;voted=(data||[]).map(x=>x.election_id);}
 return json({admin:profile?.role==='admin',profile,signedIn:!!await getUser(r),voted,classes:rows.results.map((x:any)=>({...JSON.parse(x.data),revision:x.revision}))});
}
export async function POST(r:Request){
 try{
 if(r.headers.get('origin')!==new URL(r.url).origin)return json({error:'Origem inválida'},403);
 const profile=await access(r);
 if(r.headers.get('content-type')?.includes('multipart/form-data')){
 if(!profile||!['admin','teacher'].includes(profile.role))return json({error:'Acesso restrito.'},403);
 const form=await r.formData(),file=form.get('photo');
 if(profile.role==='teacher'&&form.get('classId')!==profile.class_id)return json({error:'Turma não autorizada.'},403);
 if(!(file instanceof File)||file.size<12||file.size>2*1024*1024)return json({error:'Envie uma imagem de até 2 MB.'},400);
 const bytes=new Uint8Array(await file.arrayBuffer());
 const png=bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71;
 const jpg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 const webp=String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';
 if(!png&&!jpg&&!webp)return json({error:'Use uma foto JPG, PNG ou WebP.'},400);
 const id=crypto.randomUUID();await bucket(r).put('candidates/'+(profile.role==='teacher'?profile.class_id+'/':'')+id,bytes,{httpMetadata:{contentType:png?'image/png':jpg?'image/jpeg':'image/webp'}});
 return json({url:profile.role==='teacher'?process.env.NEXT_PUBLIC_SUPABASE_URL+'/storage/v1/object/public/candidate-photos/candidates/'+profile.class_id+'/'+id:'/api/photos/'+id});
 }
 const b=await r.json();
 if(b.action==='login')return json({error:'O login com senha foi removido. Entre pelo link de verificação enviado ao seu e-mail.'},410);
 if(!profile)return json({error:'E-mail sem acesso autorizado.'},403);
 if(b.action==='studentVote'){
 if(profile.role!=='student'||profile.class_id!==b.id)return json({error:'Você só pode votar na sua turma.'},403);
 const {error}=await client(r).rpc('cast_student_vote',{p_class:b.id,p_election:b.electionId,p_leader:b.leader??null,p_vice:b.vice??null});
 if(error)return json({error:error.message},409);return json({ok:true});
 }
 if(profile.role==='student')return json({error:'Alunos não podem administrar eleições.'},403);
 if(profile.role==='teacher'&&(!['configure','start'].includes(b.action)||b.id!==profile.class_id))return json({error:'Você só pode administrar sua turma.'},403);
 if(b.action==='seedClasses'){
 const rows=await database(r).prepare('SELECT data FROM elections').all();
 const existing=new Set(rows.results.map((x:any)=>JSON.parse(x.data).name.replace(/[°º]/g,'').replace(/\s/g,'').toUpperCase()));
 let created=0;
 for(const grade of [1,2,3])for(const letter of ['A','B','C','D']){
 if(existing.has(String(grade)+letter))continue;
 const c={id:'class-'+grade+'-'+letter.toLowerCase(),name:grade+'° '+letter,total:0,cast:0,status:'setup',round:1,electionId:crypto.randomUUID(),history:[],candidates:{leader:[],vice:[]},blank:{leader:0,vice:0},nulls:{leader:0,vice:0}};
 const result=await database(r).prepare('INSERT OR IGNORE INTO elections (id,data,revision) VALUES (?,?,0)').bind(c.id,JSON.stringify(c)).run();created+=result.meta.changes;
 }return json({ok:true,created});
 }
 if(b.action==='purgeAll'){
 if(b.confirmation!=='EXCLUIR TODOS OS DADOS')return json({error:'Confirmação inválida.'},403);
 const storage=bucket(r);
 let removedPhotos=0;
 while(true){const page=await storage.list({limit:1000});if(!page.objects.length)break;await storage.delete(page.objects.map((x:any)=>x.key));removedPhotos+=page.objects.length;}
 await database(r).prepare('DELETE FROM elections').run();
 const elections=await database(r).prepare('SELECT COUNT(*) AS count FROM elections').first();

 const remainingPhotos=await storage.list({limit:1});
 return json({ok:true,removedPhotos,remaining:{elections:elections.count,sessions:0,photos:remainingPhotos.objects.length}},200,{'Set-Cookie':'mcpf_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'});
 }

 function config(){
 const name=String(b.name||'').trim(),total=Number(b.total);
 if(!name||name.length>60||!Number.isInteger(total)||total<1||total>1000)throw Error('Informe turma e quantidade entre 1 e 1000.');
 const candidates:any={};
 for(const role of ['leader','vice']){
 const list=b.candidates?.[role];
 if(!Array.isArray(list)||!list.length||list.length>100)throw Error('Cadastre de 1 a 100 candidatos por cargo.');
 candidates[role]=list.map((x:any)=>({id:String(x.id||'').trim(),name:String(x.name||'').trim(),photo:String(x.photo||''),votes:0}));
 if(candidates[role].some((x:any)=>x.photo&&!/^\/api\/photos\/[a-f0-9-]{36}$/.test(x.photo)&&!x.photo.startsWith(process.env.NEXT_PUBLIC_SUPABASE_URL+'/storage/v1/object/public/candidate-photos/candidates/'+b.id+'/')))throw Error('Foto inválida. Envie novamente pelo cadastro.');
 if(candidates[role].some((x:any)=>!/^\d{2}$/.test(x.id)||!x.name||x.name.length>80))throw Error('Cada candidato precisa de nome e número com exatamente 2 dígitos.');
 if(new Set(candidates[role].map((x:any)=>x.id)).size!==list.length)throw Error('Não repita números dentro do mesmo cargo.');
 if(new Set(candidates[role].map((x:any)=>x.name.toLowerCase())).size!==list.length)throw Error('Não repita nomes dentro do mesmo cargo.');
 }return {name,total,candidates};
 }
 if(b.action==='create'){
 let settings;try{settings=config()}catch(e:any){return json({error:e.message},400)}
 const c={id:crypto.randomUUID(),...settings,cast:0,status:'draft',round:1,electionId:crypto.randomUUID(),history:[],nulls:{leader:0,vice:0},blank:{leader:0,vice:0}};
 await database(r).prepare('INSERT INTO elections (id,data,revision) VALUES (?,?,0)').bind(c.id,JSON.stringify(c)).run();return json({ok:true,id:c.id});}
 const row=await database(r).prepare('SELECT * FROM elections WHERE id=?').bind(String(b.id)).first();if(!row)return json({error:'Turma não encontrada.'},404);const c=JSON.parse(row.data);
 if(b.action==='configure'){
 if(c.status==='active')return json({error:'Não é possível alterar a turma durante uma eleição.'},409);
 if(b.revision!==row.revision)return json({error:'A turma mudou. Reabra o cadastro antes de salvar.'},409);
 let settings;try{settings=config()}catch(e:any){return json({error:e.message},400)}
 if(c.status==='finished'){
 const {history,...snapshot}=c;c.history=[...(history||[]),snapshot];c.round=(c.round||1)+1;c.electionId=crypto.randomUUID();
 }
 delete c.autoRoles;delete c.automatic;delete c.approval;delete c.finishedAt;delete c.startedAt;
 Object.assign(c,settings,{status:'draft',cast:0,nulls:{leader:0,vice:0},blank:{leader:0,vice:0}});
 }
 else if(b.action==='start'){if(c.status!=='draft')return json({error:'Prepare uma nova eleição antes de iniciar.'},409);if(b.revision!==row.revision)return json({error:'O cadastro mudou. Confira e tente novamente.'},409);if(c.total<1||!c.candidates.leader.length||!c.candidates.vice.length)return json({error:'Configure alunos e candidatos antes de iniciar.'},400);c.status='active';c.electionId=c.electionId||crypto.randomUUID();c.startedAt=new Date().toISOString();
 c.autoRoles={leader:c.candidates.leader.length===1,vice:c.candidates.vice.length===1};
 if(c.autoRoles.leader&&c.autoRoles.vice){c.status='finished';c.automatic=true;c.approval=100;c.finishedAt=c.startedAt;}
 }
 else if(b.action==='vote'){
 if(c.status!=='active'||c.cast>=c.total)return json({error:'A votação foi encerrada.'},409);
 if(b.electionId!==c.electionId||b.session!==c.cast+1)return json({error:'Esta sessão já foi registrada. Atualize a urna.'},409);
 c.nulls=c.nulls||{leader:0,vice:0};
 for(const role of ['leader','vice']){
 if(c.autoRoles?.[role])continue;
 if(b[role]===null)c.blank[role]++;
 else{
 if(typeof b[role]!=='string'||!/^\d{2}$/.test(b[role]))return json({error:'Digite exatamente dois números ou escolha BRANCO.'},400);
 const candidate=c.candidates[role].find((x:any)=>x.id===b[role]);
 if(candidate)candidate.votes++;else c.nulls[role]++;
 }}
 c.cast++;if(c.cast===c.total){c.status='finished';c.finishedAt=new Date().toISOString();}
 }else return json({error:'Ação inválida.'},400);
 const result=await database(r).prepare('UPDATE elections SET data=?,revision=revision+1 WHERE id=? AND revision=?').bind(JSON.stringify(c),c.id,row.revision).run();if(!result.meta.changes)return json({error:'A urna foi atualizada em outro dispositivo. Atualize e tente novamente.'},409);return json({ok:true});
 }catch{return json({error:'Não foi possível concluir. Tente novamente.'},500);}
}
