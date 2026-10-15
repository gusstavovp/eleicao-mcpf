'use client';
import {useState,useEffect} from 'react';
import {supabase} from '../lib/supabase';
export default function Login({onLogin}:{onLogin:()=>void}){
 const [email,setEmail]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{const {data}=supabase.auth.onAuthStateChange(()=>{setTimeout(onLogin,0)});return()=>data.subscription.unsubscribe();},[]);
 async function send(e:React.FormEvent){e.preventDefault();setBusy(true);setMessage('');
 try{
 const {error}=await supabase.auth.signInWithOtp({email:email.trim().toLowerCase(),options:{emailRedirectTo:window.location.origin+'/admin'}});
 if(error)throw error;
 setMessage('Verifique sua caixa de entrada e abra o link de acesso. Confira também o spam.');
 }catch(e:any){setMessage(e.message)}finally{setBusy(false)}}
 return <section className="panel login"><span className="lock">⌑</span><h2>Acesso do administrador</h2><p>Receba um link de verificação no seu e-mail. Não é necessário criar senha.</p><form onSubmit={send}><label>E-mail autorizado<input type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} required placeholder="Seu e-mail"/></label><button className="primary full" disabled={busy}>{busy?'Enviando…':'Receber link de acesso →'}</button></form>{message&&<p role="status">{message}</p>}<small className="muted">O link é pessoal e só pode ser usado uma vez.</small></section>
}
