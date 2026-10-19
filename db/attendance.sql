alter table public.vote_receipts add column attendance text not null default 'voted' check(attendance in ('voted','absent'));

create or replace function election_private.can_manage_class(p_class text) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and not coalesce((auth.jwt()->>'is_anonymous')::boolean,true) and
 (lower(auth.jwt()->>'email')='delta4006@gmail.com' or exists(select 1 from public.class_memberships where email=lower(auth.jwt()->>'email') and role='teacher' and class_id=p_class));
$$;
revoke all on function election_private.can_manage_class(text) from public,anon,authenticated;
grant execute on function election_private.can_manage_class(text) to authenticated;

create or replace function election_private.get_roll_call() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('roster',coalesce((select jsonb_agg(jsonb_build_object('email',m.email,'class_id',m.class_id,'display_name',m.display_name,'call_number',m.call_number) order by m.call_number,m.email) from public.class_memberships m where m.role='student' and m.call_number is not null and election_private.can_manage_class(m.class_id)),'[]'::jsonb),
 'receipts',coalesce((select jsonb_agg(to_jsonb(v)) from public.vote_receipts v where election_private.can_manage_class(v.class_id)),'[]'::jsonb));
$$;
create or replace function public.get_roll_call() returns jsonb language sql set search_path='' as $$select election_private.get_roll_call();$$;
revoke all on function election_private.get_roll_call(),public.get_roll_call() from public,anon,authenticated;
grant execute on function election_private.get_roll_call(),public.get_roll_call() to authenticated;

create or replace function election_private.manage_attendance(p_class text,p_election text,p_action text,p_voter text) returns void language plpgsql security definer set search_path='' as $$
declare c jsonb; next_mail text; tally jsonb; absent_count integer; remaining integer;
begin
 if not election_private.can_manage_class(p_class) then raise exception 'Você não pode administrar esta turma.';end if;
 select data into c from public.elections where id=p_class for update;
 if c is null or c->>'electionId'<>p_election or c->>'status'<>'active' then raise exception 'A eleição não está aberta. Atualize a página.';end if;
 absent_count:=coalesce((c->>'abstentions')::integer,0);
 remaining:=(c->>'total')::integer-(c->>'cast')::integer-absent_count;
 if remaining<=0 then raise exception 'A chamada já foi concluída.';end if;
 if p_action='abstain' then
   if exists(select 1 from public.class_memberships where class_id=p_class and role='student' and call_number is not null) then
     select m.email into next_mail from public.class_memberships m where m.class_id=p_class and m.role='student' and m.call_number is not null and not exists(select 1 from public.vote_receipts v where v.election_id=p_election and v.email=m.email) order by m.call_number,m.email limit 1;
     if next_mail is null or p_voter is distinct from next_mail then raise exception 'A chamada mudou. Atualize a página.';end if;
     insert into public.vote_receipts(election_id,email,class_id,attendance) values(p_election,next_mail,p_class,'absent');
   elsif p_voter is distinct from 'session:'||((c->>'cast')::integer+absent_count+1)::text then raise exception 'Esta sessão já foi registrada.';
   end if;
   absent_count:=absent_count+1;
 elsif p_action='close' then
   insert into public.vote_receipts(election_id,email,class_id,attendance)
   select p_election,m.email,p_class,'absent' from public.class_memberships m where m.class_id=p_class and m.role='student' and m.call_number is not null and not exists(select 1 from public.vote_receipts v where v.election_id=p_election and v.email=m.email);
   absent_count:=(c->>'total')::integer-(c->>'cast')::integer;
 else raise exception 'Ação inválida.';
 end if;
 c:=jsonb_set(c,'{abstentions}',to_jsonb(absent_count));
 if (c->>'cast')::integer+absent_count >= (c->>'total')::integer then
   select totals into tally from election_private.vote_totals where election_id=p_election;
   c:=c||coalesce(tally,'{}'::jsonb)||jsonb_build_object('status','finished','finishedAt',now());
 end if;
 update public.elections set data=c,revision=revision+1 where id=p_class;
end $$;
create or replace function public.manage_attendance(p_class text,p_election text,p_action text,p_voter text default null) returns void language sql set search_path='' as $$select election_private.manage_attendance(p_class,p_election,p_action,p_voter);$$;
revoke all on function election_private.manage_attendance(text,text,text,text),public.manage_attendance(text,text,text,text) from public,anon,authenticated;
grant execute on function election_private.manage_attendance(text,text,text,text),public.manage_attendance(text,text,text,text) to authenticated;

create or replace function election_private.cast_roll_vote(p_class text,p_election text,p_leader text,p_vice text,p_voter text) returns void language plpgsql security definer set search_path='' as $$
declare c jsonb; mail text; role_name text; choice text; candidates jsonb; item jsonb; n int; next_mail text; tally jsonb; kiosk boolean:=false;
begin
 mail:=lower(auth.jwt()->>'email');
 if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,true) then raise exception 'Faça login.'; end if;
 if p_voter is not null then
 if not election_private.can_manage_class(p_class) then raise exception 'Você não pode conduzir a chamada desta turma.';end if;
 else
 if not exists(select 1 from public.class_memberships m where m.email=mail and m.role='student' and m.class_id=p_class) then raise exception 'Você não pode votar nesta turma.';end if;
 end if;
 select data into c from public.elections where id=p_class for update;
 if c is null or c->>'electionId'<>p_election then raise exception 'Eleição inválida. Atualize a página.'; end if;
 if p_voter like 'session:%' then
 if exists(select 1 from public.class_memberships where class_id=p_class and role='student' and call_number is not null) then raise exception 'Use a chamada da turma.';end if;
 if p_voter<>'session:'||((c->>'cast')::int+coalesce((c->>'abstentions')::int,0)+1)::text then raise exception 'Esta sessão já foi registrada.';end if;
 kiosk:=true;
 elsif p_voter is not null then
 select m.email into next_mail from public.class_memberships m where m.class_id=p_class and m.role='student' and m.call_number is not null and not exists(select 1 from public.vote_receipts v where v.election_id=p_election and v.email=m.email) order by m.call_number,m.email limit 1;
 if next_mail is null then raise exception 'Todos os alunos da chamada já votaram.';end if;
 if next_mail<>p_voter then raise exception 'A chamada mudou. Atualize e abra a urna novamente.';end if;
 mail:=p_voter;
 end if;
 if not kiosk and exists(select 1 from public.vote_receipts where election_id=p_election and email=mail) then raise exception 'Sua participação nesta eleição já foi registrada (voto ou ausência).'; end if;
 if c->>'status'<>'active' or (c->>'cast')::int+coalesce((c->>'abstentions')::int,0) >= (c->>'total')::int then raise exception 'A eleição não está aberta.'; end if;
 select totals into tally from election_private.vote_totals where election_id=p_election;
 if tally is not null then c:=c||tally;end if;
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
 if (c->>'cast')::int+coalesce((c->>'abstentions')::int,0) >= (c->>'total')::int then c:=c||jsonb_build_object('status','finished','finishedAt',now());end if;
 if not kiosk then insert into public.vote_receipts(election_id,email,class_id) values(p_election,mail,p_class);end if;
 tally:=jsonb_build_object('candidates',c->'candidates','blank',c->'blank','nulls',c->'nulls');
 insert into election_private.vote_totals(election_id,totals) values(p_election,tally) on conflict(election_id) do update set totals=excluded.totals;
 if c->>'status'='active' then
 foreach role_name in array array['leader','vice'] loop
 select coalesce(jsonb_agg(jsonb_set(value,'{votes}','0'::jsonb)),'[]'::jsonb) into candidates from jsonb_array_elements(c->'candidates'->role_name);
 c:=jsonb_set(c,array['candidates',role_name],candidates);
 end loop;
 c:=c||jsonb_build_object('blank',jsonb_build_object('leader',0,'vice',0),'nulls',jsonb_build_object('leader',0,'vice',0));
 end if;
 update public.elections set data=c,revision=revision+1 where id=p_class;
end $$;
