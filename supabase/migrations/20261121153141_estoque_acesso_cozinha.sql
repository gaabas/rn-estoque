grant usage on schema estoque to anon;

create function estoque.registrar_operacao(change jsonb, request_id uuid, actor uuid, actor_name text, actor_can_close boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  product estoque.catalog%rowtype;
  old estoque.activity%rowtype;
  original estoque.activity%rowtype;
  action text := change->>'type';
  target uuid;
  pending uuid;
  last_count uuid;
  quantity numeric;
  last_quantity numeric;
  canonical_payload jsonb;
begin
  if change is not null then
    if request_id is null or action is null or action not in ('count','correct','open','details','close','undo') then
      raise exception using errcode = '22023', message = 'Envio inválido.';
    end if;
    if action = 'close' and not actor_can_close then
      raise exception using errcode = '42501', message = 'Somente Gabriel pode concluir compras.';
    end if;

    -- Um único fluxo de gravação mantém a ordem das revisões do catálogo durante a prévia.
    perform pg_catalog.pg_advisory_xact_lock('estoque.activity'::pg_catalog.regclass::oid::bigint);
    select * into strict product from estoque.catalog where id = change->>'itemId';
    select * into old from estoque.activity where id = request_id;
    if found then
      if old.author_id <> actor or old.payload <> change then
        raise exception using errcode = '22023', message = 'Identificador de envio já utilizado.';
      end if;
    else
      if action in ('count','correct','details') then
        if (action <> 'details' or change->>'quantity' is not null)
          and jsonb_typeof(change->'quantity') is distinct from 'number' then
          raise exception using errcode = '22023', message = 'Quantidade inválida.';
        end if;
        quantity := (change->>'quantity')::numeric;
        if quantity < 0 or quantity > 9007199254740991
          or (not product.fractional and quantity <> trunc(quantity))
          or length(coalesce(change->>'note', '')) > 400 then
          raise exception using errcode = '22023', message = 'Quantidade ou observação inválida.';
        end if;
      end if;
      if action = 'count' and change->>'unit' is distinct from product.unit then
        raise exception using errcode = '22023', message = 'A unidade do insumo mudou.';
      end if;
      target := (change->>'target')::uuid;
      select event.id into pending
        from estoque.activity event
        where event.item_id = product.id and event.payload->>'type' = 'open'
          and not exists (
            select 1 from estoque.activity ending
            where ending.item_id = product.id and ending.payload->>'target' = event.id::text
              and ending.payload->>'type' in ('close','undo')
          )
        order by event.revision desc limit 1;

      if (action = 'open' and pending is not null)
        or (action in ('details','close') and (pending is null or pending is distinct from target)) then
        raise exception using errcode = '55000', message = 'A situação do pedido mudou.';
      end if;

      if action = 'correct' then
        with active as (
          select event.* from estoque.activity event
          where event.item_id = product.id and not exists (
            select 1 from estoque.activity reversal
            where reversal.item_id = product.id and reversal.payload->>'type' = 'undo'
              and reversal.payload->>'target' = event.id::text
          )
        )
        select counting.id, coalesce((
          select (payload->>'quantity')::numeric from active
          where payload->>'type' = 'correct' and payload->>'target' = counting.id::text
          order by revision desc limit 1
        ), (counting.payload->>'quantity')::numeric)
          into last_count, last_quantity
          from active counting where counting.payload->>'type' = 'count'
          order by counting.revision desc limit 1;
        if last_count is null or last_count is distinct from target
          or last_quantity is distinct from (change->>'previous')::numeric then
          raise exception using errcode = '55000', message = 'A última contagem mudou.';
        end if;
      end if;

      if action = 'undo' then
        select * into original from estoque.activity
          where id = target and item_id = product.id and author_id = actor;
        if not found or original.payload->>'type' not in ('count','correct','open')
          or (original.payload->>'type' = 'open' and pending is distinct from target)
          or exists (select 1 from estoque.activity where item_id = product.id
            and payload->>'type' = 'undo' and payload->>'target' = target::text) then
          raise exception using errcode = '55000', message = 'O registro não pode mais ser desfeito.';
        end if;
      end if;

      -- O servidor fornece ID, autoria e horário. Campos extras do cliente não entram na resposta.
      canonical_payload := jsonb_build_object('itemId',product.id,'type',action);
      case action
        when 'count' then canonical_payload := canonical_payload || jsonb_build_object('quantity',quantity,'unit',product.unit,'note',coalesce(change->>'note',''));
        when 'correct' then canonical_payload := canonical_payload || jsonb_build_object('target',target,'previous',last_quantity,'quantity',quantity,'note',coalesce(change->>'note',''));
        when 'details' then canonical_payload := canonical_payload || jsonb_build_object('target',target,'quantity',quantity,'note',coalesce(change->>'note',''));
        when 'close' then canonical_payload := canonical_payload || jsonb_build_object('target',target);
        when 'undo' then canonical_payload := canonical_payload || jsonb_build_object('target',target,'label',case original.payload->>'type'
          when 'count' then 'Contagem desfeita' when 'correct' then 'Correção desfeita' else 'Pedido desfeito' end);
        else null;
      end case;
      if change <> canonical_payload then
        raise exception using errcode = '22023', message = 'Dados do envio inválidos.';
      end if;
      insert into estoque.activity (id,item_id,author_id,author_name,payload)
      values (request_id,product.id,actor,actor_name,canonical_payload);
    end if;
  end if;

  return jsonb_build_object('name',actor_name,'canClose',actor_can_close,'items',(
    select jsonb_agg(jsonb_build_object('id',id,'name',name,'group',item_group,'unit',unit,'fractional',fractional) order by position)
    from estoque.catalog
  )) || (
    select jsonb_build_object('revision',coalesce(max(revision),0),'entries',coalesce(jsonb_agg(
      payload || jsonb_build_object('id',id,'at',recorded_at,'author',author_name) order by revision
    ),'[]'::jsonb)) from estoque.activity
  );
end;
$$;

revoke all on function estoque.registrar_operacao(jsonb,uuid,uuid,text,boolean) from public, anon, authenticated;

create or replace function estoque.operacao(change jsonb, request_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  member estoque.members%rowtype;
begin
  select * into member from estoque.members where user_id = auth.uid();
  if not found then
    raise exception using errcode = '42501', message = 'Conta sem acesso ao Estoque.';
  end if;
  return estoque.registrar_operacao(change, request_id, member.user_id, member.display_name, member.can_close);
end;
$$;

create table estoque.kitchen_profiles (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  display_name text not null,
  pin_hash text,
  invite_hash bytea unique,
  invite_expires timestamptz,
  failed_attempts integer not null default 0,
  retry_after timestamptz
);

create table estoque.kitchen_sessions (
  token_hash bytea primary key,
  profile_id uuid not null references estoque.kitchen_profiles(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '90 days'
);
create index kitchen_sessions_profile on estoque.kitchen_sessions (profile_id);

alter table estoque.kitchen_profiles enable row level security;
alter table estoque.kitchen_sessions enable row level security;
revoke all on estoque.kitchen_profiles, estoque.kitchen_sessions from public, anon, authenticated;

create function estoque.kitchen_new_session(profile uuid)
returns jsonb language plpgsql set search_path = ''
as $$
declare
  secret text := encode(extensions.gen_random_bytes(32),'hex');
begin
  delete from estoque.kitchen_sessions where profile_id = profile and expires_at <= now();
  insert into estoque.kitchen_sessions (token_hash,profile_id) values (extensions.digest(secret,'sha256'),profile);
  return jsonb_build_object('id',profile,'token',secret);
end;
$$;
revoke all on function estoque.kitchen_new_session(uuid) from public, anon, authenticated;

create function estoque.cozinha_gerar_convite(name text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  clean_name text := regexp_replace(btrim(name),'[[:space:]]+',' ','g');
  secret text := encode(extensions.gen_random_bytes(32),'hex');
begin
  if not exists (select 1 from estoque.members where user_id = auth.uid() and can_close) then
    raise exception using errcode = '42501', message = 'Conta sem permissão para criar convites.';
  end if;
  if clean_name is null or length(clean_name) not between 2 and 50 or clean_name !~ '^[[:alpha:]][[:alpha:] .-]*$' then
    raise exception using errcode = '22023', message = 'Informe um nome válido.';
  end if;
  insert into estoque.kitchen_profiles (username,display_name,invite_hash,invite_expires)
  values (lower(clean_name),clean_name,extensions.digest(secret,'sha256'),now()+interval '48 hours')
  on conflict (username) do update set
    invite_hash=excluded.invite_hash,invite_expires=excluded.invite_expires;
  return jsonb_build_object('token',secret);
end;
$$;

create function estoque.cozinha_convite(token text)
returns jsonb language sql security definer set search_path = ''
as $$
  select jsonb_build_object('name',display_name) from estoque.kitchen_profiles
  where token ~ '^[0-9a-f]{64}$' and invite_hash=extensions.digest(token,'sha256') and invite_expires>now();
$$;

create function estoque.cozinha_ativar(token text, pin text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare profile uuid;
begin
  if token is null or token !~ '^[0-9a-f]{64}$' or pin is null or pin !~ '^[0-9]{6}$' then return null; end if;
  update estoque.kitchen_profiles
    set pin_hash=extensions.crypt(pin,extensions.gen_salt('bf',10)),
      invite_hash=null,invite_expires=null,failed_attempts=0,retry_after=null
    where invite_hash=extensions.digest(token,'sha256') and invite_expires>now()
    returning id into profile;
  if not found then return null; end if;
  delete from estoque.kitchen_sessions where profile_id=profile;
  return estoque.kitchen_new_session(profile);
end;
$$;

create function estoque.cozinha_entrar(username text, pin text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  profile estoque.kitchen_profiles%rowtype;
  attempts integer;
begin
  if username is null or length(username)>80 or pin is null or pin !~ '^[0-9]{6}$' then return null; end if;
  select * into profile from estoque.kitchen_profiles p
    where p.username=lower(regexp_replace(btrim(cozinha_entrar.username),'[[:space:]]+',' ','g'))
    for update;
  if not found or profile.pin_hash is null then return null; end if;
  if profile.retry_after > now() then return jsonb_build_object('limited',true); end if;
  if extensions.crypt(pin,profile.pin_hash) <> profile.pin_hash then
    attempts := case when profile.retry_after is not null then 1 else profile.failed_attempts+1 end;
    update estoque.kitchen_profiles set failed_attempts=attempts,
      retry_after=case when attempts >= 5 then now()+interval '10 minutes' end
      where id=profile.id;
    return null;
  end if;
  update estoque.kitchen_profiles set failed_attempts=0,retry_after=null where id=profile.id;
  return estoque.kitchen_new_session(profile.id);
end;
$$;

create function estoque.cozinha_sair(session_token text)
returns void language sql security definer set search_path = ''
as $$
  delete from estoque.kitchen_sessions
  where session_token ~ '^[0-9a-f]{64}$' and token_hash=extensions.digest(session_token,'sha256');
$$;

create function estoque.cozinha_operacao(session_token text, change jsonb, request_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare profile estoque.kitchen_profiles%rowtype;
begin
  if session_token is null or session_token !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '28000', message = 'Entre novamente.';
  end if;
  select p.* into profile from estoque.kitchen_profiles p
  join estoque.kitchen_sessions s on s.profile_id=p.id
  where s.token_hash=extensions.digest(session_token,'sha256') and s.expires_at>now();
  if not found then raise exception using errcode = '28000', message = 'Entre novamente.'; end if;
  return estoque.registrar_operacao(change,request_id,profile.id,profile.display_name,false);
end;
$$;

revoke all on function estoque.cozinha_gerar_convite(text) from public, anon, authenticated;
grant execute on function estoque.cozinha_gerar_convite(text) to authenticated;

create function public.rn_estoque_cozinha_gerar_convite(name text)
returns jsonb language sql security invoker set search_path = ''
as $$ select estoque.cozinha_gerar_convite(name); $$;

revoke all on function public.rn_estoque_cozinha_gerar_convite(text) from public, anon, authenticated;
grant execute on function public.rn_estoque_cozinha_gerar_convite(text) to authenticated;

revoke all on function estoque.cozinha_convite(text) from public, anon, authenticated;
grant execute on function estoque.cozinha_convite(text) to anon, authenticated;

create function public.rn_estoque_cozinha_convite(token text)
returns jsonb language sql security invoker set search_path = ''
as $$ select estoque.cozinha_convite(token); $$;

revoke all on function public.rn_estoque_cozinha_convite(text) from public, anon, authenticated;
grant execute on function public.rn_estoque_cozinha_convite(text) to anon, authenticated;

revoke all on function estoque.cozinha_ativar(text, text) from public, anon, authenticated;
grant execute on function estoque.cozinha_ativar(text, text) to anon, authenticated;

create function public.rn_estoque_cozinha_ativar(token text, pin text)
returns jsonb language sql security invoker set search_path = ''
as $$ select estoque.cozinha_ativar(token, pin); $$;

revoke all on function public.rn_estoque_cozinha_ativar(text, text) from public, anon, authenticated;
grant execute on function public.rn_estoque_cozinha_ativar(text, text) to anon, authenticated;

revoke all on function estoque.cozinha_entrar(text, text) from public, anon, authenticated;
grant execute on function estoque.cozinha_entrar(text, text) to anon, authenticated;

create function public.rn_estoque_cozinha_entrar(username text, pin text)
returns jsonb language sql security invoker set search_path = ''
as $$ select estoque.cozinha_entrar(username, pin); $$;

revoke all on function public.rn_estoque_cozinha_entrar(text, text) from public, anon, authenticated;
grant execute on function public.rn_estoque_cozinha_entrar(text, text) to anon, authenticated;

revoke all on function estoque.cozinha_sair(text) from public, anon, authenticated;
grant execute on function estoque.cozinha_sair(text) to anon, authenticated;

create function public.rn_estoque_cozinha_sair(session_token text)
returns void language sql security invoker set search_path = ''
as $$ select estoque.cozinha_sair(session_token); $$;

revoke all on function public.rn_estoque_cozinha_sair(text) from public, anon, authenticated;
grant execute on function public.rn_estoque_cozinha_sair(text) to anon, authenticated;

revoke all on function estoque.cozinha_operacao(text, jsonb, uuid) from public, anon, authenticated;
grant execute on function estoque.cozinha_operacao(text, jsonb, uuid) to anon, authenticated;

create function public.rn_estoque_cozinha_operacao(session_token text, change jsonb, request_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select estoque.cozinha_operacao(session_token, change, request_id); $$;

revoke all on function public.rn_estoque_cozinha_operacao(text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.rn_estoque_cozinha_operacao(text, jsonb, uuid) to anon, authenticated;
