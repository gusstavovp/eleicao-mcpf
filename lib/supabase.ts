import {createClient} from '@supabase/supabase-js';
export const supabase=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
export async function apiFetch(url:string,options:RequestInit={}){
 const {data:{session}}=await supabase.auth.getSession();
 const headers=new Headers(options.headers);
 if(session)headers.set('Authorization','Bearer '+session.access_token);
 return fetch(url,{...options,headers,cache:'no-store'});
}
