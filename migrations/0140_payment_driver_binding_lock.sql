-- Serialize first-payment binding with provider reconfiguration. No vendor branches.
create or replace function bind_payment_driver() returns trigger language plpgsql as $$
begin
  if TG_OP='INSERT' then
    select driver_key into new.driver_key from payment_providers
      where provider_key=new.provider_key for share;
    if not found or new.driver_key is null then
      raise exception 'payment provider driver is not configured';
    end if;
  elsif new.driver_key is distinct from old.driver_key or new.provider_key is distinct from old.provider_key or new.order_id is distinct from old.order_id or new.user_id is distinct from old.user_id then
    raise exception 'payment ownership and driver are immutable';
  end if;
  return new;
end; $$;
