import type {SupabaseClient} from '@supabase/supabase-js';
export async function verifyEmailLogin(client:Pick<SupabaseClient,'auth'>,email:string,code:string){
 const address=email.trim().toLowerCase();
 // Validate an existing session with Auth, rather than consuming the same OTP twice.
 async function alreadySignedIn(){const {data:{session}}=await client.auth.getSession();if(!session||session.user.email?.toLowerCase()!==address)return false;const {data,error}=await client.auth.getUser();return !error&&!!data.user?.email_confirmed_at&&!data.user.is_anonymous&&data.user.email?.toLowerCase()===address;}
 if(await alreadySignedIn())return;
 const {data,error}=await client.auth.verifyOtp({email:address,token:code.replace(/\s/g,''),type:'email'});
 if(error){if(await alreadySignedIn())return;throw error;}
 if(!data.session)throw new Error('missing_session');
}
export function authErrorMessage(error:unknown,action:'send'|'verify'){
 const e=error as {code?:string,status?:number,name?:string,message?:string};
 if(e.status===429||e.code==='over_request_rate_limit'||e.code==='over_email_send_rate_limit')return 'Muitas tentativas em pouco tempo. Aguarde alguns minutos antes de tentar novamente; isso não significa que o código esteja errado.';
 if(e.code==='otp_expired')return 'Este código já foi usado, expirou ou foi substituído. Use o código do e-mail mais recente ou solicite outro. Não reutilize o mesmo código em dois dispositivos.';
 if(e.name==='AuthRetryableFetchError'||e instanceof TypeError)return 'Falha de conexão. Confira sua internet e tente novamente. Não é necessário solicitar outro código agora.';
 if(e.status&&e.status>=500)return 'O serviço de acesso está temporariamente indisponível. Aguarde um pouco e tente novamente.';
 return action==='send'?'Não foi possível enviar o código. Confira o e-mail e tente novamente em um minuto.':'Não foi possível concluir o acesso. Confira o e-mail e o código mais recente e tente novamente.';
}
