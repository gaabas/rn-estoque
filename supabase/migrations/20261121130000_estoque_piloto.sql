create schema estoque;
revoke all on schema estoque from public, anon, authenticated;
grant usage on schema estoque to authenticated;

create table estoque.members (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create table estoque.items (
  id uuid primary key,
  name text not null,
  unit text not null
);

create table estoque.events (
  id uuid primary key,
  event_number bigint generated always as identity,
  order_id uuid references estoque.events(id),
  item_id uuid not null references estoque.items(id),
  author_id uuid not null,
  happened_at timestamptz not null default clock_timestamp(),
  action text not null check (action in ('count', 'open', 'close')),
  quantity numeric,
  check ((action = 'close' and order_id is not null) or (action <> 'close' and order_id is null)),
  check (
    (action = 'count' and quantity is not null and quantity between 0 and 1000000 and trunc(quantity) = quantity)
    or (action in ('open', 'close') and quantity is null)
  )
);

create index events_item_latest on estoque.events (item_id, event_number desc);

alter table estoque.members enable row level security;
alter table estoque.items enable row level security;
alter table estoque.events enable row level security;
revoke all on all tables in schema estoque from public, anon, authenticated;

insert into estoque.items (id, name, unit)
values ('00000000-0000-4000-8000-000000000001', 'Creme de leite', 'caixas');

create function estoque.piloto(operation text, item uuid, request_id uuid, amount numeric, expected_order uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  product estoque.items%rowtype;
  previous estoque.events%rowtype;
  pending uuid;
begin
  if actor is null or not exists (select 1 from estoque.members where user_id = actor) then
    raise exception using errcode = '42501', message = 'Conta sem acesso ao Estoque.';
  end if;
  if operation is null or operation not in ('read', 'count', 'open', 'close') then
    raise exception using errcode = '22023', message = 'Ação inválida.';
  end if;

  if operation = 'read' then
    select * into strict product from estoque.items
    where id = '00000000-0000-4000-8000-000000000001';
  else
    if request_id is null then
      raise exception using errcode = '22023', message = 'Identificador do envio ausente.';
    end if;
    select * into strict product from estoque.items where id = item for update;
    select * into previous from estoque.events where id = request_id;
    if found and (previous.author_id <> actor or previous.item_id <> item
      or previous.action <> operation or previous.quantity is distinct from amount or previous.order_id is distinct from expected_order) then
      raise exception using errcode = '22023', message = 'Identificador de envio já utilizado.';
    end if;

    if previous.id is null then
      select case when action = 'open' then id end into pending
      from estoque.events where item_id = item and action in ('open', 'close')
      order by event_number desc limit 1;
      if (operation = 'open' and pending is not null)
        or (operation = 'close' and (pending is null or pending is distinct from expected_order)) then
        raise exception using errcode = '55000', message = 'A situação da compra mudou. Atualize a lista.';
      end if;
      insert into estoque.events (id, item_id, author_id, action, quantity, order_id)
      values (request_id, item, actor, operation, amount, expected_order);
    end if;
  end if;

  return (
    with recent as materialized (
      select * from estoque.events where item_id = product.id
    )
    select jsonb_build_object(
      'item_id', product.id, 'item_name', product.name, 'unit', product.unit,
      'pending_id', (select case when action = 'open' then id end from recent
        where action in ('open', 'close') order by event_number desc limit 1),
      'count', (
        select jsonb_build_object('quantity', quantity, 'at', happened_at) from recent
        where action = 'count' order by event_number desc limit 1
      ),
      'history', coalesce((
        select jsonb_agg(jsonb_build_object('id', id, 'action', action, 'at', happened_at, 'quantity', quantity)
          order by event_number desc) from recent
      ), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function estoque.piloto(text, uuid, uuid, numeric, uuid) from public, anon, authenticated;
grant execute on function estoque.piloto(text, uuid, uuid, numeric, uuid) to authenticated;

create function public.rn_estoque_piloto(operation text, item uuid, request_id uuid, amount numeric, expected_order uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select estoque.piloto(operation, item, request_id, amount, expected_order); $$;

revoke all on function public.rn_estoque_piloto(text, uuid, uuid, numeric, uuid) from public, anon, authenticated;
grant execute on function public.rn_estoque_piloto(text, uuid, uuid, numeric, uuid) to authenticated;
