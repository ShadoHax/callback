-- Match the coffee kind accepted by the options/quote APIs. No rows or policies change.
begin;
alter table public.orders drop constraint if exists orders_preference_check;
alter table public.orders add constraint orders_preference_check
  check (preference in ('base','standalone','expansion','accessory','camera','coffee'));
commit;
