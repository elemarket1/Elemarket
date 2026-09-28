-- Provider-managed money movement only. Eligibility is not settlement control.
alter table orders alter column payment_deadline set default (now()+interval '15 minutes');
update orders set payment_deadline=created_at+interval '15 minutes' where status='payment_pending' and payment_deadline is null;
alter table orders add constraint pending_order_requires_deadline check(status<>'payment_pending' or payment_deadline is not null);

-- Pin the owning driver when a payment is created; provider config edits cannot reroute refunds.
alter table payments add column driver_key text;
update payments p set driver_key=pp.driver_key from payment_providers pp where pp.provider_key=p.provider_key;
create function bind_payment_driver() returns trigger language plpgsql as $$
begin
  if TG_OP='INSERT' then
    select driver_key into new.driver_key from payment_providers where provider_key=new.provider_key;
  elsif new.driver_key is distinct from old.driver_key or new.provider_key is distinct from old.provider_key or new.order_id is distinct from old.order_id or new.user_id is distinct from old.user_id then
    raise exception 'payment ownership and driver are immutable';
  end if;
  return new;
end; $$;
create trigger payment_driver_binding before insert or update on payments for each row execute function bind_payment_driver();

-- Cancellation/expiry invalidates local attempts, retaining references for late evidence.
create function invalidate_cancelled_payment_attempts() returns trigger language plpgsql as $$
begin
  if new.status='cancelled' and old.status='payment_pending' then
    update payment_attempts set status='cancelled',updated_at=now()
    where payment_id in(select id from payments where order_id=new.id) and status in('initiated','pending','authorized');
  end if;
  return new;
end; $$;
create trigger cancelled_order_attempts after update of status on orders for each row execute function invalidate_cancelled_payment_attempts();

create or replace function create_payment_attempt(
  p_payment_id text, p_provider_key text, p_amount numeric, p_currency text,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb language plpgsql as $$
declare v_payment record; v_provider record; v_existing record; v_attempt_no integer; v_attempt_id text; v_order record;
begin
  if p_payment_id is null or p_provider_key is null or p_amount is null or p_amount <= 0 or p_currency <> 'GHS' then raise exception 'invalid payment attempt'; end if;
  select * into v_payment from payments where id=p_payment_id;
  if not found then raise exception 'payment not found'; end if;
  perform pg_advisory_xact_lock(hashtextextended('elemarket:order:'||v_payment.order_id,0));
  select * into v_order from orders where id=v_payment.order_id for update;
  if v_order.status <> 'payment_pending' or v_order.payment_deadline is null or v_order.payment_deadline <= clock_timestamp() then
    raise exception 'order is not eligible for payment';
  end if;
  select * into v_payment from payments where id=p_payment_id for update;
  if v_payment.user_id is distinct from v_order.user_id then raise exception 'payment/order owner mismatch'; end if;
  if not found then raise exception 'payment not found'; end if;
  if v_payment.provider_key <> p_provider_key then raise exception 'payment provider mismatch'; end if;
  if round(v_payment.amount,2) <> round(p_amount,2) or v_payment.currency <> p_currency then raise exception 'payment amount mismatch'; end if;
  if v_payment.status <> 'initiated' then raise exception 'payment is not startable'; end if;
  select provider_key,status into v_provider from payment_providers where provider_key=p_provider_key;
  if not found or v_provider.status <> 'active' then raise exception 'payment provider is not active'; end if;
  perform pg_advisory_xact_lock(hashtextextended('elemarket:payment-attempt:' || p_payment_id,0));
  select * into v_existing from payment_attempts where payment_id=p_payment_id and status in ('initiated','pending','authorized') order by attempt_no desc limit 1 for update;
  if found then
    return jsonb_build_object('paymentId',p_payment_id,'attemptId',v_existing.id,'attemptNo',v_existing.attempt_no,'status',v_existing.status,'existing',true,'providerReference',v_existing.provider_reference,'checkoutUrl',v_existing.checkout_url);
  end if;
  select coalesce(max(attempt_no),0)+1 into v_attempt_no from payment_attempts where payment_id=p_payment_id;
  v_attempt_id := 'pat_'||replace(gen_random_uuid()::text,'-','');
  insert into payment_attempts(id,payment_id,attempt_no,provider_key,amount,currency,status,metadata)
  values(v_attempt_id,p_payment_id,v_attempt_no,p_provider_key,p_amount,p_currency,'initiated',coalesce(p_metadata,'{}'::jsonb));
  return jsonb_build_object('paymentId',p_payment_id,'attemptId',v_attempt_id,'attemptNo',v_attempt_no,'status','initiated','existing',false);
end; $$;


create function expire_payment_order(p_order_id text) returns boolean language plpgsql as $$
declare v_order record; r record;
begin
  perform pg_advisory_xact_lock(hashtextextended('elemarket:order:'||p_order_id,0));
  select * into v_order from orders where id=p_order_id for update;
  if not found or v_order.status<>'payment_pending' or v_order.payment_deadline>clock_timestamp() then return false; end if;
  for r in select * from order_stock_reservations where order_id=p_order_id and status='reserved' order by id for update loop
    if r.variant_id is not null then
      update product_variants set stock=stock+r.quantity,updated_at=now() where id=r.variant_id;
    else
      update products set stock=stock+r.quantity where id=r.product_id;
    end if;
    if not found then raise exception 'reserved product not found'; end if;
    update order_stock_reservations set status='released',released_at=now() where id=r.id;
  end loop;
  update orders set status='cancelled',updated_at=now() where id=p_order_id;
  return true;
end; $$;
revoke all on function expire_payment_order(text) from public;
create or replace function expire_payment_pending_orders(p_limit integer default 100) returns integer language plpgsql as $$
declare r record; n integer:=0;
begin
  if p_limit is null or p_limit<1 or p_limit>1000 then raise exception 'invalid expiry batch size'; end if;
  for r in select id from orders where status='payment_pending' and payment_deadline<=now() order by payment_deadline,id limit p_limit loop
    if expire_payment_order(r.id) then n:=n+1; end if;
  end loop;
  return n;
end; $$;
create or replace function apply_payment_webhook(
  p_provider_key text, p_event_id text, p_event_type text, p_provider_reference text,
  p_status text, p_amount numeric, p_currency text, p_payload_hash text,
  p_provider_refund_id text default null
) returns jsonb
language plpgsql
as $$
declare
  v_event record;
  v_payment record;
  v_order record;
  v_provider record;
  v_new_status text;
  v_refund_status text := null;
  v_refund_event boolean := false;
  v_consumed integer;
  v_expected integer;
  v_request_id text;
begin
  if p_provider_key is null or p_event_id is null or p_event_type is null or p_payload_hash is null then
    raise exception 'invalid webhook';
  end if;
  if p_status not in ('authorized','completed','failed','refunded') then
    raise exception 'unsupported payment status';
  end if;
  if p_currency <> 'GHS' or p_amount is null or p_amount <= 0 then
    raise exception 'invalid payment amount';
  end if;

  select provider_key,status into v_provider
    from payment_providers
   where provider_key=p_provider_key;
  if not found or v_provider.status <> 'active' then
    raise exception 'payment provider is not active';
  end if;

  insert into payment_webhook_events(
    provider_key,event_id,event_type,provider_reference,payload_hash,
    signature_verified,processing_status
  ) values (
    p_provider_key,p_event_id,p_event_type,p_provider_reference,p_payload_hash,
    true,'received'
  ) on conflict(provider_key,event_id) do nothing;

  select * into v_event
    from payment_webhook_events
   where provider_key=p_provider_key and event_id=p_event_id
   for update;

  if v_event.payload_hash <> p_payload_hash then
    return reject_payment_webhook(p_provider_key,p_event_id,p_payload_hash,'event_payload_mismatch');
  end if;

  if v_event.processing_status='rejected' then
    return jsonb_build_object('rejected',true,'errorCode',v_event.error_code,'duplicate',true);
  end if;
  if v_event.processing_status in ('processed','ignored')
     and not (v_event.processing_status='ignored' and v_event.error_code='order_already_resolved' and p_status='completed') then
    return jsonb_build_object('duplicate',true,'status',v_event.processing_status);
  end if;

  select p.* into v_payment
    from payment_attempts pa
    join payments p on p.id=pa.payment_id
   where pa.provider_key=p_provider_key
     and pa.provider_reference=p_provider_reference
   order by pa.created_at desc
   limit 1;

  if not found then
    update payment_webhook_events
       set processing_status='received',error_code='payment_not_yet_bound',processed_at=null
     where id=v_event.id;
    return jsonb_build_object('retryable',true,'errorCode','payment_not_yet_bound');
  end if;

  if round(v_payment.amount,2) <> round(p_amount,2) or v_payment.currency <> p_currency then
    update payment_webhook_events
       set processing_status='rejected',error_code='amount_mismatch',processed_at=now()
     where id=v_event.id;
    return reject_payment_webhook(p_provider_key,p_event_id,p_payload_hash,'amount_mismatch');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('elemarket:order:'||v_payment.order_id,0));
  perform expire_payment_order(v_payment.order_id);
  select * into v_order from orders where id=v_payment.order_id for update;
  select * into v_payment from payments where id=v_payment.id for update;
  if not found then raise exception 'order not found'; end if;
  if v_payment.user_id<>v_order.user_id then raise exception 'payment/order owner mismatch'; end if;

  -- Refund lifecycle events describe the provider's refund operation, not a
  -- new payment state. Only refund.processed changes payments -> refunded.
  if left(p_event_type,7)='refund.' then
    if not exists(select 1 from provider_refund_requests r where r.payment_id=v_payment.id
      and r.provider_key=p_provider_key and r.provider_reference=p_provider_reference
      and r.amount=p_amount and r.currency=p_currency
      and (r.provider_refund_id is null or r.provider_refund_id=p_provider_refund_id)) then
      return reject_payment_webhook(p_provider_key,p_event_id,p_payload_hash,'refund_binding_mismatch');
    end if;
    v_refund_event := true;
    v_refund_status := case p_event_type
      when 'refund.pending' then 'processing'
      when 'refund.processing' then 'processing'
      when 'refund.needs-attention' then 'needs_attention'
      when 'refund.failed' then 'failed'
      when 'refund.processed' then 'processed'
      else null
    end;
    if v_refund_status is null then
      update payment_webhook_events
         set processing_status='ignored',error_code='unsupported_refund_event',processed_at=now()
       where id=v_event.id;
      return jsonb_build_object('duplicate',false,'ignored',true,'paymentId',v_payment.id,'orderId',v_order.id,'status',v_payment.status);
    end if;

    if v_refund_status='processed' then
      v_new_status := 'refunded';
    else
      v_new_status := v_payment.status;
    end if;
  else
    v_new_status := p_status;
  end if;

  if not v_refund_event and p_status='completed' then
    insert into payment_provider_evidence(provider_key,event_id,payment_id,provider_reference,event_type,amount,currency,payload_hash)
    values(p_provider_key,p_event_id,v_payment.id,p_provider_reference,p_event_type,p_amount,p_currency,p_payload_hash)
    on conflict do nothing;

    -- A replay of success must never regress a provider-confirmed refund.
    if v_payment.status='refunded' then
      update payment_webhook_events set processing_status='ignored',processed_at=now() where id=v_event.id;
      return jsonb_build_object('ignored',true,'status','refunded');
    end if;

    if v_order.status='cancelled' then
      -- Keep the existing state machine: failed payments require manual reconciliation,
      -- while initiated/authorized payments can accurately record completion.
      if validate_payment_transition(v_payment.status,'completed') then
        update payments set status='completed',provider_reference=coalesce(provider_reference,p_provider_reference),updated_at=now() where id=v_payment.id;
        if v_payment.status<>'completed' then
          insert into payment_state_transitions(payment_id,from_status,to_status,source,provider_event_id)
          values(v_payment.id,v_payment.status,'completed','provider_webhook',p_event_id);
        end if;
      end if;
      insert into marketplace_reconciliation_cases(id,merchant_id,order_id,external_reference,case_type,severity,dedupe_key,details)
      values('mrc_'||replace(gen_random_uuid()::text,'-',''),v_order.merchant_id,v_order.id,p_provider_reference,'payment','high',
        'late-payment:'||v_payment.id,jsonb_build_object('reason','late_successful_payment','paymentId',v_payment.id,
        'providerKey',p_provider_key,'providerReference',p_provider_reference,'amount',p_amount,'currency',p_currency,
        'resolution','provider_refund_or_operator_reconciliation','eventId',p_event_id,'payloadHash',p_payload_hash))
      on conflict(dedupe_key) where dedupe_key is not null do nothing;
      perform record_audit_event('payment.late_success_requires_reconciliation','payment',v_payment.id,null,'system',null,'success',
        jsonb_build_object('providerKey',p_provider_key,'eventId',p_event_id,'orderId',v_order.id));
      update payment_webhook_events set processing_status='processed',error_code=null,processed_at=now() where id=v_event.id;
      -- Only the installed Paystack refund contract is automatically dispatched.
      -- Other drivers remain in explicit operator reconciliation.
      if v_payment.driver_key='paystack' and coalesce(v_payment.provider_reference,p_provider_reference)=p_provider_reference then
        insert into provider_refund_requests(id,payment_id,order_id,provider_key,provider_reference,amount,currency,status,reason)
        values('prr_'||replace(gen_random_uuid()::text,'-',''),v_payment.id,v_order.id,p_provider_key,p_provider_reference,p_amount,p_currency,'requested','late_successful_payment')
        on conflict do nothing;
        select id into v_request_id from provider_refund_requests where payment_id=v_payment.id and reason='late_successful_payment';
      end if;
      return jsonb_build_object('reconciliationRequired',true,'refundRequestId',v_request_id,'paymentId',v_payment.id,'orderId',v_order.id,'orderStatus','cancelled');
    end if;
    if v_payment.status<>'completed' and v_order.status<>'payment_pending' then
      update payment_webhook_events set processing_status='rejected',error_code='order_not_payment_pending',processed_at=now() where id=v_event.id;
      return reject_payment_webhook(p_provider_key,p_event_id,p_payload_hash,'order_not_payment_pending');
    end if;
  end if;

  if not validate_payment_transition(v_payment.status,v_new_status) then
    update payment_webhook_events
       set processing_status='rejected',error_code='invalid_state_transition',processed_at=now()
     where id=v_event.id;
    return reject_payment_webhook(p_provider_key,p_event_id,p_payload_hash,'invalid_state_transition');
  end if;

  if v_new_status='completed' and v_payment.status<>'completed' then
    select count(*) into v_expected from order_items where order_id=v_order.id;
    update order_stock_reservations
       set status='consumed'
     where order_id=v_order.id and status='reserved';
    get diagnostics v_consumed=row_count;
    if v_consumed<>v_expected then raise exception 'reservation integrity failure'; end if;
  elsif v_new_status='refunded' then
    update order_stock_reservations
       set status='released',released_at=now()
     where order_id=v_order.id and status='consumed';
  end if;

  update payments
     set provider_reference=coalesce(p_provider_reference,provider_reference),status=v_new_status,updated_at=now()
   where id=v_payment.id;

  if v_payment.status<>v_new_status then
    insert into payment_state_transitions(payment_id,from_status,to_status,source,provider_event_id)
    values(v_payment.id,v_payment.status,v_new_status,'provider_webhook',p_event_id);
  end if;

  if v_refund_event then
    update provider_refund_requests
       set status=v_refund_status,
           provider_refund_id=coalesce(p_provider_refund_id,provider_refund_id),
           processed_at=case when v_refund_status='processed' then now() else processed_at end,
           updated_at=now()
     where payment_id=v_payment.id
       and status in ('requested','processing','needs_attention','failed')
       and (p_provider_refund_id is null or provider_refund_id is null or provider_refund_id=p_provider_refund_id);
  end if;

  update payment_attempts set status=case when v_new_status='refunded' then 'completed' else v_new_status end,updated_at=now()
   where provider_key=p_provider_key and provider_reference=p_provider_reference and status<>'cancelled';

  if v_new_status='completed' and v_payment.status<>'completed' then
    update orders set status='paid',updated_at=now()
     where id=v_order.id and status='payment_pending';
  elsif v_new_status='refunded' then
    update orders set status='refunded',updated_at=now()
     where id=v_order.id
       and status in ('paid','confirmed','fulfilling','shipped','delivered','completed','refund_pending');
  end if;

  update payment_webhook_events
     set processing_status='processed',error_code=null,processed_at=now()
   where id=v_event.id;

  return jsonb_build_object(
    'duplicate',false,
    'ignored',v_payment.status=v_new_status and not v_refund_event,
    'refundEvent',v_refund_event,
    'refundStatus',v_refund_status,
    'paymentId',v_payment.id,
    'orderId',v_order.id,
    'status',v_new_status
  );
end;
$$;


create or replace function prepare_provider_refund_for_payment(
  p_payment_id text,
  p_actor_id text,
  p_reason text default 'customer_order_cancellation'
) returns jsonb language plpgsql as $$
declare
  v_payment record;
  v_order record;
  v_existing record;
  v_actor_role text;
  v_request text := 'prr_'||replace(gen_random_uuid()::text,'-','');
begin
  if p_payment_id is null or length(trim(p_payment_id)) < 1 then raise exception 'payment required'; end if;
  if p_actor_id is null or length(trim(p_actor_id)) < 1 then raise exception 'actor identity required'; end if;

  select role into v_actor_role from "user" where id=p_actor_id;
  if v_actor_role is null then raise exception 'actor not found'; end if;

  select * into v_payment from payments where id=p_payment_id;
  if not found then raise exception 'payment not found'; end if;
  perform pg_advisory_xact_lock(hashtextextended('elemarket:order:'||v_payment.order_id,0));
  perform 1 from orders where id=v_payment.order_id for update;
  select * into v_payment from payments where id=p_payment_id for update;
  if not found then raise exception 'payment not found'; end if;
  if v_payment.status <> 'completed' then raise exception 'only completed payments can be refunded'; end if;
  if v_actor_role <> 'admin' and (v_actor_role <> 'customer' or v_payment.user_id is distinct from p_actor_id) then
    raise exception 'refund payment is not owned by this customer';
  end if;
  if v_payment.provider_reference is null then raise exception 'payment has no provider reference'; end if;

  select * into v_order from orders where id=v_payment.order_id and user_id=v_payment.user_id for update;
  if not found then raise exception 'payment/order binding mismatch'; end if;

  select * into v_existing
    from provider_refund_requests
   where payment_id=v_payment.id
     and status in ('requested','processing','needs_attention','failed','processed')
   order by requested_at desc
   limit 1
   for update;

  if found then
    if v_existing.requested_by is distinct from p_actor_id and v_actor_role <> 'admin' then
      raise exception 'refund request is not owned by this customer';
    end if;
    if v_existing.status = 'failed' then
      update provider_refund_requests
         set status='requested', reason=coalesce(nullif(left(trim(coalesce(p_reason,'')),200),''),reason), updated_at=now()
       where id=v_existing.id and status='failed';
      return jsonb_build_object('requestId',v_existing.id,'status','requested','existing',true,'retry',true);
    end if;
    return jsonb_build_object('requestId',v_existing.id,'status',v_existing.status,'existing',true);
  end if;

  -- New customer cancellation requests are limited to early paid states.
  if v_order.status not in ('paid','confirmed') then
    raise exception 'order is not cancellable in its current state';
  end if;

  insert into provider_refund_requests(
    id,payment_id,order_id,provider_key,provider_reference,amount,currency,status,reason,requested_by
  ) values(
    v_request,v_payment.id,v_payment.order_id,v_payment.provider_key,v_payment.provider_reference,
    v_payment.amount,v_payment.currency,'requested',left(trim(coalesce(p_reason,'')),200),p_actor_id
  );

  update orders set status='refund_pending',updated_at=now()
   where id=v_order.id and status in ('paid','confirmed');
  if not found then raise exception 'order changed before refund request'; end if;

  return jsonb_build_object('requestId',v_request,'status','requested','existing',false);
end;
$$;

revoke all on function prepare_provider_refund_for_payment(text,text,text) from public;

create or replace function prepare_provider_refund_for_dispute(p_dispute_id text,p_admin_id text,p_note text default '') returns jsonb language plpgsql as $$
declare d record; p record; o record; r record; rid text;
begin
  if not exists(select 1 from "user" where id=p_admin_id and role='admin') then raise exception 'admin required'; end if;
  if length(coalesce(p_note,''))>2000 then raise exception 'invalid resolution note'; end if;
  select * into d from customer_order_disputes where id=p_dispute_id;
  if not found then raise exception 'dispute not found'; end if;
  perform pg_advisory_xact_lock(hashtextextended('elemarket:order:'||d.order_id,0));
  select * into o from orders where id=d.order_id for update;
  select * into p from payments where id=d.payment_id for update;
  select * into d from customer_order_disputes where id=p_dispute_id for update;
  if p.order_id is distinct from o.id or p.user_id is distinct from o.user_id or d.customer_id is distinct from o.user_id then raise exception 'dispute payment/order owner mismatch'; end if;
  select * into r from provider_refund_requests where payment_id=p.id for update;
  if found then
    if r.status='failed' then update provider_refund_requests set status='requested',updated_at=now() where id=r.id; r.status:='requested'; end if;
    return jsonb_build_object('requestId',r.id,'status',r.status,'existing',true);
  end if;
  if d.status not in('open','under_review') or o.status<>'disputed' or p.status<>'completed' or p.provider_reference is null then raise exception 'dispute not refundable'; end if;
  rid:='prr_'||replace(gen_random_uuid()::text,'-','');
  insert into provider_refund_requests(id,payment_id,order_id,provider_key,provider_reference,amount,currency,status,reason,customer_note,merchant_note,requested_by)
  values(rid,p.id,o.id,p.provider_key,p.provider_reference,p.amount,p.currency,'requested','customer_dispute_refund',p_note,p_note,p_admin_id);
  update customer_order_disputes set status='under_review',resolution_note=p_note,resolved_by=p_admin_id,updated_at=now() where id=d.id;
  update orders set status='refund_pending',updated_at=now() where id=o.id;
  perform record_audit_event('dispute.provider_refund_requested','order',o.id,p_admin_id,'admin',null,'success',jsonb_build_object('disputeId',d.id,'requestId',rid));
  return jsonb_build_object('requestId',rid,'status','requested','existing',false);
end; $$;
revoke all on function prepare_provider_refund_for_dispute(text,text,text) from public;

-- Refund records must bind the exact payment, order, owner, provider, amount and reference.
create function enforce_provider_refund_binding() returns trigger language plpgsql as $$
begin
  if not exists(select 1 from payments p join orders o on o.id=p.order_id and o.user_id=p.user_id
    where p.id=new.payment_id and o.id=new.order_id and p.provider_key=new.provider_key
      and p.provider_reference=new.provider_reference and p.amount=new.amount and p.currency=new.currency) then
    raise exception 'refund payment binding mismatch';
  end if;
  if TG_OP='UPDATE' and (new.payment_id is distinct from old.payment_id or new.order_id is distinct from old.order_id or new.provider_reference is distinct from old.provider_reference or new.requested_by is distinct from old.requested_by) then
    raise exception 'refund identity is immutable';
  end if;
  return new;
end; $$;
create trigger refund_binding before insert or update on provider_refund_requests for each row execute function enforce_provider_refund_binding();

create function complete_provider_refund_state() returns trigger language plpgsql as $$
begin
  if new.status='processed' and old.status<>'processed' then
    -- Match webhook ordering, including the shared observability counter locks.
    update order_stock_reservations set status='released',released_at=now() where order_id=new.order_id and status='consumed';
    update payments set status='refunded',updated_at=now() where id=new.payment_id and status='completed';
    if found then insert into payment_state_transitions(payment_id,from_status,to_status,source) values(new.payment_id,'completed','refunded','provider_webhook'); end if;
    update orders set status='refunded',updated_at=now() where id=new.order_id and status in('paid','confirmed','fulfilling','shipped','delivered','completed','disputed','refund_pending');
    update customer_order_disputes set status='resolved_refund',resolved_at=now(),updated_at=now() where payment_id=new.payment_id and status in('open','under_review');
  end if;
  return new;
end; $$;
create trigger provider_refund_completed after update of status on provider_refund_requests for each row execute function complete_provider_refund_state();

alter function merchant_order_withdrawal_eligibility(text,text) rename to merchant_order_withdrawal_eligibility_policy;
create function merchant_order_withdrawal_eligibility(p_merchant_id text,p_order_id text) returns jsonb language sql as $$
  select merchant_order_withdrawal_eligibility_policy(p_merchant_id,p_order_id) || jsonb_build_object('eligibilityScope','elemarket_policy_only','providerSettlementControlled',false,'providerSettlementTiming','provider_contract','deliveryHoldGuaranteed',false);
$$;
comment on function merchant_order_withdrawal_eligibility(text,text) is 'ELEMARKET policy eligibility only. Does not control provider settlement or guarantee a delivery-relative hold.';

alter function merchant_provider_withdrawal_eligibility(text) rename to merchant_provider_withdrawal_eligibility_policy;
create function merchant_provider_withdrawal_eligibility(p_merchant_id text) returns jsonb language sql as $$
  select merchant_provider_withdrawal_eligibility_policy(p_merchant_id) || jsonb_build_object('eligibilityScope','elemarket_policy_only','providerSettlementControlled',false,'providerSettlementTiming','provider_contract','deliveryHoldGuaranteed',false);
$$;
comment on function merchant_provider_withdrawal_eligibility(text) is 'ELEMARKET policy eligibility only. Does not control provider settlement or guarantee a delivery-relative hold.';

-- HTTP completion and webhook completion serialize before touching refund rows.
create function persist_provider_refund_result(p_id text,p_status text,p_provider_id text,p_response jsonb)
returns setof provider_refund_requests language plpgsql as $$
declare oid text;
begin
  select order_id into oid from provider_refund_requests where id=p_id;
  if oid is null then raise exception 'refund request not found'; end if;
  perform pg_advisory_xact_lock(hashtextextended('elemarket:order:'||oid,0));
  perform 1 from orders where id=oid for update;
  return query update provider_refund_requests set status=p_status,provider_refund_id=coalesce(p_provider_id,provider_refund_id),
    provider_response=p_response,processed_at=case when p_status='processed' then now() else processed_at end,updated_at=now()
    where id=p_id and status='processing' returning *;
end; $$;
revoke all on function persist_provider_refund_result(text,text,text,jsonb) from public;

create function prevent_payment_provider_driver_change() returns trigger language plpgsql as $$
begin
  if new.driver_key is distinct from old.driver_key and exists(select 1 from payments where provider_key=old.provider_key) then
    raise exception 'provider with payments cannot change driver';
  end if;
  return new;
end; $$;
create trigger provider_driver_immutable before update of driver_key on payment_providers for each row execute function prevent_payment_provider_driver_change();
