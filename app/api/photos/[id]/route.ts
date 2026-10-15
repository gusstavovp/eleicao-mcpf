export async function GET(request:Request){
 const id=new URL(request.url).pathname.split('/').pop()||'';
 if(!/^[a-f0-9-]{36}$/.test(id))return new Response('Não encontrado',{status:404});
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL+'/storage/v1/object/public/candidate-photos/candidates/'+id;
 return Response.redirect(url,302);
}
