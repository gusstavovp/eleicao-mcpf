create schema if not exists election_private;
revoke all on schema election_private from public;
grant usage on schema election_private to authenticated;
create table public.class_memberships(email text primary key check(email=lower(email)), role text not null check(role in ('student','teacher')), class_id text not null references public.elections(id));
alter table public.class_memberships enable row level security;
grant select on public.class_memberships to authenticated;
create policy own_membership on public.class_memberships for select to authenticated using (email=lower((select auth.jwt()->>'email')) and (select auth.uid()) is not null);
create table public.vote_receipts(election_id text not null, email text not null, class_id text not null, primary key(election_id,email));
alter table public.vote_receipts enable row level security;
grant select on public.vote_receipts to authenticated;
create policy own_receipt on public.vote_receipts for select to authenticated using(email=lower((select auth.jwt()->>'email')));
create policy teacher_update on public.elections for update to authenticated using(exists(select 1 from public.class_memberships m where m.class_id=elections.id and m.role='teacher')) with check(exists(select 1 from public.class_memberships m where m.class_id=elections.id and m.role='teacher'));
create policy teacher_photo_insert on storage.objects for insert to authenticated with check(bucket_id='candidate-photos' and (storage.foldername(name))[1]='candidates' and exists(select 1 from public.class_memberships m where m.role='teacher' and m.class_id=(storage.foldername(name))[2]));
create function election_private.cast_vote(p_class text,p_election text,p_leader text,p_vice text) returns void language plpgsql security definer set search_path='' as $$
declare c jsonb; mail text; role_name text; choice text; candidates jsonb; item jsonb; n int;
begin
 mail:=lower(auth.jwt()->>'email');
 if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,true) or not exists(select 1 from public.class_memberships m where m.email=mail and m.role='student' and m.class_id=p_class) then raise exception 'Você não pode votar nesta turma.'; end if;
 select data into c from public.elections where id=p_class for update;
 if c is null or c->>'electionId'<>p_election then raise exception 'Eleição inválida. Atualize a página.'; end if;
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
revoke all on function election_private.cast_vote(text,text,text,text) from public,anon;
grant execute on function election_private.cast_vote(text,text,text,text) to authenticated;
create function public.cast_student_vote(p_class text,p_election text,p_leader text,p_vice text) returns void language sql security invoker set search_path='' as $$ select election_private.cast_vote(p_class,p_election,p_leader,p_vice); $$;
revoke all on function public.cast_student_vote(text,text,text,text) from public,anon;
grant execute on function public.cast_student_vote(text,text,text,text) to authenticated;
