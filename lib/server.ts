import {createClient} from '@supabase/supabase-js';
export const ADMIN_EMAIL=(process.env.ADMIN_EMAIL||'').trim().toLowerCase();
export function client(r:Request){
 const token=r.headers.get('authorization');
 return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{
  auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
  global:{headers:token?{Authorization:token}:{}}
 });
}
export async function getUser(r:Request){
 const token=r.headers.get('authorization')?.replace(/^Bearer /,'');
 if(!token)return null;
 const {data,error}=await client(r).auth.getUser(token);
 return error?null:data.user;
}
export async function isAdmin(r:Request){const u=await getUser(r);return !!(u?.email_confirmed_at&&!u.is_anonymous&&u.email?.toLowerCase()===ADMIN_EMAIL);}
export function database(r:Request){
 const sb=client(r);
 const result=(x:any)=>{if(x.error)throw x.error;return x.data||[];};
 const row=(x:any)=>x?{...x,data:JSON.stringify(x.data)}:null;
 return {prepare(sql:string){let args:any[]=[];
 const statement={
  bind(...values:any[]){args=values;return statement;},
  async all(){const q=sb.from('elections').select('*').order('id',{ascending:false});return {results:result(await q).map(row)};},
  async first(){
   if(sql.includes('COUNT')){const x=await sb.from('elections').select('*',{count:'exact',head:true});if(x.error)throw x.error;return {count:x.count};}
   const x=await sb.from('elections').select('*').eq('id',args[0]).maybeSingle();if(x.error)throw x.error;return row(x.data);
  },
  async run(){
   let x;
   if(sql.startsWith('INSERT')){
    const entry={id:args[0],data:JSON.parse(args[1]),revision:0};
    x=sql.includes('OR IGNORE')?await sb.from('elections').upsert(entry,{onConflict:'id',ignoreDuplicates:true}).select('id'):await sb.from('elections').insert(entry).select('id');
   }else if(sql.startsWith('UPDATE')){
    x=await sb.from('elections').update({data:JSON.parse(args[0]),revision:args[2]+1}).eq('id',args[1]).eq('revision',args[2]).select('id');
   }else if(sql==='DELETE FROM elections')x=await sb.from('elections').delete().neq('id','').select('id');
   else throw Error('Unsupported query');
   return {meta:{changes:result(x).length}};
  }
 };return statement;}};
}
export function bucket(r:Request){
 const b=client(r).storage.from('candidate-photos');
 return {
 async put(key:string,bytes:Uint8Array,opts:any){const {error}=await b.upload(key,bytes,{contentType:opts.httpMetadata.contentType,upsert:false});if(error)throw error;},
 async list(opts:any){const {data,error}=await b.list('candidates',{limit:opts.limit});if(error)throw error;return {objects:(data||[]).map(x=>({key:'candidates/'+x.name}))};},
 async delete(keys:string[]){const {error}=await b.remove(keys);if(error)throw error;}
 };
}

export async function access(r:Request){
 const u=await getUser(r);
 if(!u?.email_confirmed_at||u.is_anonymous)return null;
 if(u.email?.toLowerCase()===ADMIN_EMAIL)return {role:'admin',class_id:null};
 const {data,error}=await client(r).from('class_memberships').select('role,class_id').eq('email',u.email!.toLowerCase()).maybeSingle();
 if(error)throw error;return data;
}
