alter table estoque.members
  add column can_close boolean not null default false,
  add column display_name text not null default 'Cozinha';

create table estoque.catalog (
  id text primary key,
  name text not null,
  item_group text not null,
  unit text not null,
  fractional boolean not null,
  position smallint unique not null
);

insert into estoque.catalog values
  ('arroz-branco', 'Arroz branco', 'Despensa', 'kg', true, 1),
  ('arroz-integral', 'Arroz integral', 'Despensa', 'kg', true, 2),
  ('seleta', 'Seleta', 'Hortifruti', 'kg', true, 3),
  ('carne-de-panela', 'Carne de panela', 'Proteínas', 'kg', true, 4),
  ('carne-de-tiras', 'Carne de tiras', 'Proteínas', 'kg', true, 5),
  ('carne-moida', 'Carne moída', 'Proteínas', 'kg', true, 6),
  ('frango', 'Frango', 'Proteínas', 'kg', true, 7),
  ('ovo', 'Ovo', 'Proteínas', 'unidades', false, 8),
  ('camarao', 'Camarão', 'Proteínas', 'kg', true, 9),
  ('cuscuz', 'Cuscuz', 'Despensa', 'kg', true, 10),
  ('creme-de-leite', 'Creme de leite', 'Laticínios', 'caixas', false, 11),
  ('manteiga', 'Manteiga', 'Laticínios', 'kg', true, 12);

create table estoque.activity (
  id uuid primary key,
  revision bigint generated always as identity unique,
  item_id text not null references estoque.catalog(id),
  author_id uuid not null,
  author_name text not null,
  recorded_at timestamptz not null default clock_timestamp(),
  payload jsonb not null
);
create index activity_item_revision on estoque.activity (item_id, revision desc);
alter table estoque.catalog enable row level security;
alter table estoque.activity enable row level security;
revoke all on estoque.catalog, estoque.activity from public, anon, authenticated;

create function estoque.operacao(change jsonb, request_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  member estoque.members%rowtype;
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
  select * into member from estoque.members where user_id = auth.uid();
  if not found then
    raise exception using errcode = '42501', message = 'Conta sem acesso ao Estoque.';
  end if;

  if change is not null then
    if request_id is null or action is null or action not in ('count','correct','open','details','close','undo') then
      raise exception using errcode = '22023', message = 'Envio inválido.';
    end if;
    if action = 'close' and not member.can_close then
      raise exception using errcode = '42501', message = 'Somente Gabriel pode concluir compras.';
    end if;

    -- Um único fluxo de gravação mantém a ordem das revisões do catálogo durante a prévia.
    perform pg_catalog.pg_advisory_xact_lock('estoque.activity'::pg_catalog.regclass::oid::bigint);
    select * into strict product from estoque.catalog where id = change->>'itemId';
    select * into old from estoque.activity where id = request_id;
    if found then
      if old.author_id <> member.user_id or old.payload <> change then
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
          where id = target and item_id = product.id and author_id = member.user_id;
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
      values (request_id,product.id,member.user_id,member.display_name,canonical_payload);
    end if;
  end if;

  return jsonb_build_object('name',member.display_name,'canClose',member.can_close,'items',(
    select jsonb_agg(jsonb_build_object('id',id,'name',name,'group',item_group,'unit',unit,'fractional',fractional) order by position)
    from estoque.catalog
  )) || (
    select jsonb_build_object('revision',coalesce(max(revision),0),'entries',coalesce(jsonb_agg(
      payload || jsonb_build_object('id',id,'at',recorded_at,'author',author_name) order by revision
    ),'[]'::jsonb)) from estoque.activity
  );
end;
$$;

revoke all on function estoque.operacao(jsonb,uuid) from public, anon, authenticated;
grant execute on function estoque.operacao(jsonb,uuid) to authenticated;

create function public.rn_estoque_operacao(change jsonb, request_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select estoque.operacao(change, request_id); $$;

revoke all on function public.rn_estoque_operacao(jsonb,uuid) from public, anon, authenticated;
grant execute on function public.rn_estoque_operacao(jsonb,uuid) to authenticated;
