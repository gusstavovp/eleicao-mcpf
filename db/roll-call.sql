alter table public.class_memberships add column display_name text, add column call_number integer;
with ordered as(select email,initcap(regexp_replace(replace(split_part(email,'@',1),'.',' '),'[0-9]','','g')) as name,row_number() over(order by regexp_replace(split_part(email,'@',1),'[0-9]','','g') collate "C") as num from public.class_memberships where class_id='class-2-d' and role='student') update public.class_memberships m set display_name=o.name,call_number=o.num from ordered o where m.email=o.email;
create unique index class_call_number on public.class_memberships(class_id,call_number) where call_number is not null;
create policy admin_roster on public.class_memberships for select to authenticated using ((select auth.jwt()->>'email')='delta4006@gmail.com');
create policy admin_receipts on public.vote_receipts for select to authenticated using ((select auth.jwt()->>'email')='delta4006@gmail.com');
create function election_private.cast_roll_vote(p_class text,p_election text,p_leader text,p_vice text,p_voter text) returns void language plpgsql security definer set search_path='' as $$
declare c jsonb; mail text; role_name text; choice text; candidates jsonb; item jsonb; n int; next_mail text;
begin
 mail:=lower(auth.jwt()->>'email');
 if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,true) then raise exception 'Faça login.'; end if;
 if p_voter is not null then
 if mail<>'delta4006@gmail.com' then raise exception 'Apenas o administrador pode conduzir a chamada.';end if;
 else
 if not exists(select 1 from public.class_memberships m where m.email=mail and m.role='student' and m.class_id=p_class) then raise exception 'Você não pode votar nesta turma.';end if;
 end if;
 select data into c from public.elections where id=p_class for update;
 if c is null or c->>'electionId'<>p_election then raise exception 'Eleição inválida. Atualize a página.'; end if;
 if p_voter is not null then
 select m.email into next_mail from public.class_memberships m where m.class_id=p_class and m.role='student' and m.call_number is not null and not exists(select 1 from public.vote_receipts v where v.election_id=p_election and v.email=m.email) order by m.call_number,m.email limit 1;
 if next_mail is null then raise exception 'Todos os alunos da chamada já votaram.';end if;
 if next_mail<>p_voter then raise exception 'A chamada mudou. Atualize e abra a urna novamente.';end if;
 mail:=p_voter;
 end if;
 if exists(select 1 from public.vote_receipts where election_id=p_election and email=mail) then raise exception 'Você já votou nesta eleição.'; end if;
 if c->>'status'<>'active' or (c->>'cast')::int >= (c->>'total')::int then raise exception 'A eleição não está aberta.'; end if;
 foreach role_name in array array['leader','vice'] loop
 if coalesce((c->'autoRoles'->>role_name)::boolean,false) then continue; end if;
 choice:=case when role_name='leader' then p_leader else p_vice end;
 if choice is null then
 c:=jsonb_set(c,array['blank',role_name],to_jsonb(coalesce((c->'blank'->>role_name)::int,0)+1));
 elsif choice !~ '^[0-9]{2}$' then raise exception 'Digite dois números ou escolha BRANCO.';
 else
 candidates:='[]'::jsonb;n:=0;
 for item in select value from jsonb_array_elements(c->'candidates'->role_name) loop
 if item->>'id'=choice then item:=jsonb_set(item,'{votes}',to_jsonb((item->>'votes')::int+1));n:=n+1;end if;
 candidates:=candidates||jsonb_build_array(item);
 end loop;
 c:=jsonb_set(c,array['candidates',role_name],candidates);
 if n=0 then c:=jsonb_set(c,array['nulls',role_name],to_jsonb(coalesce((c->'nulls'->>role_name)::int,0)+1));end if;
 end if;
 end loop;
 c:=jsonb_set(c,'{cast}',to_jsonb((c->>'cast')::int+1));
 if (c->>'cast')::int=(c->>'total')::int then c:=c||jsonb_build_object('status','finished','finishedAt',now());end if;
 insert into public.vote_receipts(election_id,email,class_id) values(p_election,mail,p_class);
 update public.elections set data=c,revision=revision+1 where id=p_class;
end $$;
revoke all on function election_private.cast_roll_vote(text,text,text,text,text) from public,anon;
grant execute on function election_private.cast_roll_vote(text,text,text,text,text) to authenticated;
create or replace function election_private.cast_vote(p_class text,p_election text,p_leader text,p_vice text) returns void language sql security invoker set search_path='' as $$select election_private.cast_roll_vote(p_class,p_election,p_leader,p_vice,null);$$;
create function public.cast_roll_vote(p_class text,p_election text,p_leader text,p_vice text,p_voter text) returns void language sql security invoker set search_path='' as $$select election_private.cast_roll_vote(p_class,p_election,p_leader,p_vice,p_voter);$$;
revoke all on function public.cast_roll_vote(text,text,text,text,text) from public,anon;
grant execute on function public.cast_roll_vote(text,text,text,text,text) to authenticated;
