begin;

create schema if not exists rcb_private;
create table if not exists rcb_private.records (
  collection text not null,
  id text not null,
  value jsonb not null,
  primary key (collection, id)
);
alter table rcb_private.records enable row level security;
revoke all on schema rcb_private from public, anon, authenticated;
revoke all on rcb_private.records from public, anon, authenticated;

create or replace function public.rcb_storage(operation text, data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  record_id text := data->>'id';
  group_name text := data->>'group';
  result jsonb;
begin
  case operation
    when 'list' then
      select coalesce(jsonb_object_agg(r.id, r.value), '{}'::jsonb)
        into result from rcb_private.records r where collection = group_name;
      return result;
    when 'last_sync' then
      select value into result from rcb_private.records where collection = 'sync' and id = 'last';
      return coalesce(result, 'null'::jsonb);
    when 'write' then
      insert into rcb_private.records values (group_name, record_id, data->'value')
        on conflict (collection, id) do update set value = excluded.value;
    when 'remove' then
      delete from rcb_private.records where collection = group_name and id = record_id;
    when 'save_alert' then
      if jsonb_typeof(data->'alert') = 'object' then
        insert into rcb_private.records values ('alerts', record_id, data->'alert')
          on conflict (collection, id) do nothing;
        if found and jsonb_typeof(data->'pending') = 'object' then
          insert into rcb_private.records values ('pending', record_id, data->'pending')
            on conflict (collection, id) do nothing;
        end if;
        update rcb_private.records set value = data->'alert'
          where collection = 'alerts' and id = record_id and value <> data->'alert';
      end if;
      insert into rcb_private.records values ('checked', record_id, data->'now')
        on conflict (collection, id) do update set value = excluded.value;
    when 'finish_alert' then
      delete from rcb_private.records
        where (collection = 'pending' and id = record_id) or collection = 'sent:' || record_id;
    when 'lock' then
      insert into rcb_private.records as r values (
        'sync', 'lock',
        jsonb_build_object('token', data->>'token', 'expires', now() + interval '65 seconds')
      )
        on conflict (collection, id) do update set value = excluded.value
        where (r.value->>'expires')::timestamptz <= now();
      return to_jsonb(found);
    when 'unlock' then
      delete from rcb_private.records
        where collection = 'sync' and id = 'lock' and value->>'token' = data->>'token';
    else
      raise exception 'Unknown storage operation';
  end case;
  return 'true'::jsonb;
end;
$$;

revoke all on function public.rcb_storage(text, jsonb) from public, anon, authenticated;
grant execute on function public.rcb_storage(text, jsonb) to service_role;
notify pgrst, 'reload schema';

commit;
