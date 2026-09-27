alter table public.messages add column if not exists delivery_channel text not null default 'in_app';
alter table public.messages add column if not exists delivery_status text;
alter table public.messages add column if not exists provider_message_id text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'messages_delivery_channel_check' and conrelid = 'public.messages'::regclass) then
    alter table public.messages add constraint messages_delivery_channel_check check (delivery_channel in ('in_app','sms'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'messages_delivery_status_check' and conrelid = 'public.messages'::regclass) then
    alter table public.messages add constraint messages_delivery_status_check check (delivery_status is null or delivery_status in ('pending','sent','failed'));
  end if;
end $$;
