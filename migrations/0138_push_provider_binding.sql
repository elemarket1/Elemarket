-- Bind existing tokens to their historical transport, then require explicit provider on every new registration.
alter table push_devices add column provider_key text;
update push_devices set provider_key='fcm' where provider_key is null;
alter table push_devices alter column provider_key set not null;
alter table push_devices add constraint push_devices_provider_key_check check(provider_key ~ '^[a-z0-9_-]{2,64}$');
create index push_devices_provider_user_idx on push_devices(provider_key,user_id) where disabled_at is null;
