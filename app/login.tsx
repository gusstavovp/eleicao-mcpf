'use client';
import {useState,useEffect,useRef} from 'react';
import {supabase} from '../lib/supabase';
import {verifyEmailLogin,authErrorMessage} from '../lib/login-auth';
export default function Login({onLogin,title='Acesso',signedIn=false}:{onLogin:()=>void|Promise<void>,title?:string,signedIn?:boolean}){
 const [email,setEmail]=useState(''),[code,setCode]=useState(''),[sent,setSent]=useState(false),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[cooldown,setCooldown]=useState(0),[verified,setVerified]=useState(false);
 const lock=useRef(false),completed=useRef(false),onLoginRef=useRef(onLogin);onLoginRef.current=onLogin;
 useEffect(()=>{const {data}=supabase.auth.onAuthStateChange((event)=>{if(event==='SIGNED_IN'||event==='SIGNED_OUT'||event==='TOKEN_REFRESHED')setTimeout(()=>void onLoginRef.current(),0)});return()=>data.subscription.unsubscribe();},[]);
 useEffect(()=>{if(!cooldown)return;const t=setTimeout(()=>setCooldown(c=>Math.max(0,c-1)),1000);return()=>clearTimeout(t)},[cooldown]);
 async function send(){
 if(lock.current||completed.current||signedIn||cooldown>0)return;
 lock.current=true;setBusy(true);setMessage('');
 try{const {error}=await supabase.auth.signInWithOtp({email:email.trim().toLowerCase()});if(error)throw error;setCode('');setSent(true);setCooldown(60);setMessage('Código enviado. Use o código do e-mail mais recente; o anterior deixa de valer após o reenvio. Confira também o spam.');}
 catch(error){setMessage(authErrorMessage(error,'send'));}finally{lock.current=false;setBusy(false)}
 }
 async function verify(e:React.FormEvent){
 e.preventDefault();if(lock.current||completed.current||signedIn)return;
 lock.current=true;setBusy(true);setMessage('');
 try{await verifyEmailLogin(supabase,email,code);completed.current=true;setVerified(true);setCode('');setMessage('E-mail verificado. Carregando seu acesso…');await onLoginRef.current();}
 catch(error){setMessage(authErrorMessage(error,'verify'));}finally{lock.current=false;setBusy(false)}
 }
 if(signedIn||verified)return <section className="panel login"><h2>E-mail verificado</h2><p>Sua autenticação foi concluída. Não é necessário digitar o código novamente.</p><button className="primary full" disabled={busy} onClick={()=>void onLoginRef.current()}>Atualizar acesso</button></section>;
 return <section className="panel login"><span className="lock">⌑</span><h2>{title}</h2><p>Entre com o código enviado ao seu e-mail. Não é necessário criar senha.</p><form onSubmit={sent?verify:e=>{e.preventDefault();void send()}}><label>E-mail autorizado<input type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} required readOnly={sent||busy} placeholder="Seu e-mail"/></label>{sent&&<label>Código de verificação<input type="text" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,''))} required pattern="[0-9]{6,10}" minLength={6} maxLength={10} disabled={busy} autoFocus/></label>}<button className="primary full" disabled={busy}>{busy?'Aguarde…':sent?'Entrar →':'Receber código →'}</button></form>{sent&&<div className="actions"><button disabled={busy||cooldown>0} onClick={send}>{cooldown?`Reenviar em ${cooldown}s`:'Reenviar código'}</button><button disabled={busy} onClick={()=>{setSent(false);setCode('');setMessage('')}}>Trocar e-mail</button></div>}{message&&<p role="status">{message}</p>}<small className="muted">Cada código pode ser usado uma vez. Para entrar em outro dispositivo, solicite um novo código.</small></section>
}
