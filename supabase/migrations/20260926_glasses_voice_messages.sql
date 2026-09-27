alter table public.device_events add column if not exists device_id uuid references public.device_tokens(id) on delete cascade;
alter table public.device_events drop constraint if exists device_events_scan_id_key;
alter table public.device_events drop constraint if exists device_events_kind_check;
alter table public.device_events add constraint device_events_kind_check check (kind in ('connection','reply'));
update public.device_events e set device_id = s.device_id from public.scans s where e.scan_id = s.id and e.device_id is null;

create or replace function public.enqueue_glasses_connection()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.capture_source = 'glasses' and new.result->>'status' = 'matched' then
    insert into public.device_events (owner_id, device_id, scan_id, kind, payload)
    values (new.owner_id, new.device_id, new.id, 'connection', jsonb_build_object(
      'person', new.result->>'person',
      'item', new.result->>'observedEntity',
      'relation', new.result->>'relation'
    ));
  end if;
  return new;
end $$;
