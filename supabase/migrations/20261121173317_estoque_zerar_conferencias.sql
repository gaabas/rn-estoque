create table estoque.count_resets (
  id uuid primary key,
  revision bigint unique not null,
  author_id uuid not null,
  recorded_at timestamptz not null default clock_timestamp()
);
alter table estoque.count_resets enable row level security;
revoke all on estoque.count_resets from public, anon, authenticated;

create or replace function estoque.registrar_operacao(change jsonb, request_id uuid, actor uuid, actor_name text, actor_can_close boolean)
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
  reset_revision bigint;
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
    select coalesce(max(revision), 0) into reset_revision from estoque.count_resets;
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
          from active counting where counting.payload->>'type' = 'count' and counting.revision > reset_revision
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
          or (original.payload->>'type' in ('count','correct') and original.revision <= reset_revision)
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
    select jsonb_build_object(
      'revision', greatest(coalesce(max(activity.revision),0), latest_reset.revision),
      'countReset', latest_reset.revision,
      'entries', coalesce(jsonb_agg(
        payload || jsonb_build_object('id',id,'at',recorded_at,'author',author_name,'revision',activity.revision)
        order by activity.revision
      ) filter (where activity.id is not null),'[]'::jsonb)
    )
    from (select coalesce(max(revision),0) as revision from estoque.count_resets) latest_reset
    left join estoque.activity on true
    group by latest_reset.revision
  );
end;
$$;

create function estoque.zerar_conferencias(request_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  member estoque.members%rowtype;
begin
  select * into member from estoque.members where user_id=auth.uid() and can_close;
  if not found then
    raise exception using errcode = '42501', message = 'Somente o administrador pode zerar conferências.';
  end if;
  if request_id is null then
    raise exception using errcode = '22023', message = 'Identificador do envio ausente.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock('estoque.activity'::pg_catalog.regclass::oid::bigint);
  if not exists (select 1 from estoque.count_resets where id=request_id) then
    insert into estoque.count_resets (id,revision,author_id)
      values (request_id,nextval(pg_get_serial_sequence('estoque.activity','revision')),member.user_id);
  end if;
  return estoque.registrar_operacao(null,null,member.user_id,member.display_name,member.can_close);
end;
$$;

revoke all on function estoque.zerar_conferencias(uuid) from public, anon, authenticated;
grant execute on function estoque.zerar_conferencias(uuid) to authenticated;

create function public.rn_estoque_zerar_conferencias(request_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select estoque.zerar_conferencias(request_id); $$;

revoke all on function public.rn_estoque_zerar_conferencias(uuid) from public, anon, authenticated;
grant execute on function public.rn_estoque_zerar_conferencias(uuid) to authenticated;
