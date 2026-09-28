-- Provider-neutral merchant withdrawal snapshot.
-- The aggregate eligibility read-model must use the live marketplace dispute
-- table, just like the authoritative per-order gate. It never controls or
-- represents provider settlement and never reads historical escrow disputes.
create or replace function merchant_provider_withdrawal_eligibility_policy(
  p_merchant_id text
) returns jsonb
language plpgsql
as $$
declare
  v_eligible numeric(12,2) := 0;
  v_count integer := 0;
  v_pending_disputes integer := 0;
begin
  if p_merchant_id is null or length(trim(p_merchant_id)) < 1 then
    raise exception 'merchant required';
  end if;

  -- Serialize each candidate order against dispute creation and other order
  -- state transitions. The per-order authoritative gate remains the final
  -- decision for any actual withdrawal operation.
  with candidate as (
    select o.id
      from orders o
     where o.merchant_id=p_merchant_id
       and o.status in ('delivered','completed')
       and elemarket_order_delivered_at(o.id) is not null
       and now() >= elemarket_order_delivered_at(o.id) + interval '24 hours'
     for update
  )
  select
    coalesce(sum(o.merchant_net) filter (
      where not exists (
        select 1 from customer_order_disputes d
         where d.order_id=o.id
           and d.status in ('open','under_review')
      )
      and not exists (
        select 1 from customer_order_disputes d
         where d.order_id=o.id
           and d.created_at <= elemarket_order_delivered_at(o.id) + interval '24 hours'
      )
    ),0)::numeric(12,2),
    count(*) filter (
      where not exists (
        select 1 from customer_order_disputes d
         where d.order_id=o.id
           and d.status in ('open','under_review')
      )
      and not exists (
        select 1 from customer_order_disputes d
         where d.order_id=o.id
           and d.created_at <= elemarket_order_delivered_at(o.id) + interval '24 hours'
      )
    )::int
  into v_eligible,v_count
  from candidate c
  join orders o on o.id=c.id;

  select count(*)::int into v_pending_disputes
    from customer_order_disputes d
    join orders o on o.id=d.order_id
   where o.merchant_id=p_merchant_id
     and d.status in ('open','under_review');

  return jsonb_build_object(
    'eligibleAmount',v_eligible,
    'eligibleOrders',v_count,
    'activeDisputes',v_pending_disputes,
    'currency','GHS',
    'custodyBoundary','external_provider',
    'withdrawalAction','provider_managed'
  );
end;
$$;

comment on function merchant_provider_withdrawal_eligibility_policy(text) is
  'ELEMARKET policy snapshot only. Uses customer_order_disputes; never reads legacy escrow tables and never controls provider settlement.';
