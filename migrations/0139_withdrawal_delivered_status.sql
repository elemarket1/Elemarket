-- Require the current order state to remain delivered/completed as well as immutable delivery history.
create or replace function merchant_order_withdrawal_eligibility_policy(
  p_merchant_id text,
  p_order_id text
) returns jsonb
language plpgsql
as $$
declare
  v_order record;
  v_delivered_at timestamptz;
  v_eligible_at timestamptz;
  v_dispute_at timestamptz;
  v_active_dispute boolean := false;
  v_reason text := null;
begin
  if p_merchant_id is null or length(trim(p_merchant_id)) < 1 then
    raise exception 'merchant required';
  end if;
  if p_order_id is null or length(trim(p_order_id)) < 1 then
    raise exception 'order required';
  end if;

  -- Serialize eligibility evaluation against customer dispute creation.
  select o.id,o.merchant_id,o.status,o.merchant_net,o.currency,o.updated_at
    into v_order
    from orders o
   where o.id=p_order_id and o.merchant_id=p_merchant_id
   for update;

  if not found then
    raise exception 'order not found';
  end if;

  v_delivered_at := elemarket_order_delivered_at(v_order.id);
  if v_delivered_at is null then
    return jsonb_build_object(
      'eligible',false,
      'reason','order_not_delivered',
      'orderId',v_order.id,
      'merchantNet',v_order.merchant_net,
      'currency',v_order.currency
    );
  end if;

  v_eligible_at := v_delivered_at + interval '24 hours';

  select exists(
    select 1 from escrow_disputes d
     where d.order_id=v_order.id
       and d.status in ('open','under_review')
  ) into v_active_dispute;

  select min(d.created_at) into v_dispute_at
    from escrow_disputes d
   where d.order_id=v_order.id
     and d.created_at <= v_eligible_at;

  if v_order.status not in ('delivered','completed') then
    v_reason := 'order_not_withdrawable';
  elsif v_active_dispute then
    v_reason := 'active_customer_dispute';
  elsif v_dispute_at is not null then
    v_reason := 'customer_dispute_filed_within_24_hours';
  elsif now() < v_eligible_at then
    v_reason := '24_hour_customer_dispute_window';
  else
    v_reason := 'eligible';
  end if;

  return jsonb_build_object(
    'eligible', v_reason='eligible',
    'reason', v_reason,
    'orderId', v_order.id,
    'merchantNet', v_order.merchant_net,
    'currency', v_order.currency,
    'deliveredAt', v_delivered_at,
    'eligibleAt', v_eligible_at,
    'disputeFiledAt', v_dispute_at
  );
end;
$$;
