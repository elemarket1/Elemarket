-- Extend existing customer support and audit records. No money movement or custody.
create index if not exists orders_admin_created_idx on orders(created_at desc,id desc);
create index if not exists orders_admin_status_created_idx on orders(status,created_at desc,id desc);
create index if not exists orders_admin_merchant_created_idx on orders(merchant_id,created_at desc,id desc);
create index if not exists payment_attempts_admin_reference_idx on payment_attempts(provider_reference,payment_id);
create index if not exists payments_admin_reference_idx on payments(provider_reference,order_id);

alter table support_conversations add column if not exists subject text not null default 'Order support' check(length(subject) between 1 and 160);
alter table support_conversations add column if not exists category text not null default 'general' check(category in ('order','payment','delivery','product','merchant','refund','dispute','account','general'));
alter table support_conversations add column if not exists assigned_to text references "user"(id) on delete restrict;
alter table support_conversations add column if not exists escalated_at timestamptz;
alter table support_conversations add column if not exists resolved_at timestamptz;
create index if not exists support_conversations_assignment_idx on support_conversations(assigned_to,status,updated_at desc);

-- Staff notes deliberately never enter support_messages or customer queries.
create table if not exists support_staff_notes (
  id text primary key,
  conversation_id text not null references support_conversations(id) on delete restrict,
  author_id text not null references "user"(id) on delete restrict,
  body text not null check(length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists support_staff_notes_thread_idx on support_staff_notes(conversation_id,created_at,id);
revoke all on support_staff_notes from public;

create or replace function validate_support_order_binding() returns trigger language plpgsql as $$
begin
  if tg_op='UPDATE' and (new.customer_id is distinct from old.customer_id or (old.order_id is not null and new.order_id is distinct from old.order_id)) then
    raise exception 'support participant/order binding is immutable';
  end if;
  if new.order_id is not null and not exists(select 1 from orders where id=new.order_id and user_id=new.customer_id) then raise exception 'support order customer mismatch'; end if;
  if new.assigned_to is not null and not exists(select 1 from "user" where id=new.assigned_to and role='admin') then raise exception 'support assignee must be an administrator'; end if;
  return new;
end; $$;
drop trigger if exists support_order_binding on support_conversations;
create trigger support_order_binding before insert or update on support_conversations for each row execute function validate_support_order_binding();

-- The existing append-only audit ledger is also the idempotent operation receipt.
create unique index if not exists support_operation_receipt_idx on audit_events(actor_user_id,request_id) where event_type='support.operation';
create or replace function manage_admin_support(p_actor text,p_order text,p_conversation text,p_action text,p_values jsonb,p_key text)
returns jsonb language plpgsql as $$
declare c support_conversations%rowtype; v_hash text; receipt record; result jsonb; v_id text; v_customer text; v_status text;
begin
  if current_setting('app.user_id',true) is distinct from p_actor or not exists(select 1 from "user" where id=p_actor and role='admin') then raise exception 'administrator required'; end if;
  if p_key is null or length(p_key) not between 16 and 128 then raise exception 'invalid idempotency key'; end if;
  if p_action not in ('open','reply','note','assign','status','escalate','classify','link') or p_values is null or jsonb_typeof(p_values)<>'object' then raise exception 'invalid support operation'; end if;
  v_hash:=encode(digest(jsonb_build_object('order',p_order,'conversation',p_conversation,'action',p_action,'values',p_values)::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended('support-operation:'||p_actor||':'||p_key,0));
  select metadata into receipt from audit_events where actor_user_id=p_actor and request_id=p_key and event_type='support.operation';
  if found then
    if receipt.metadata->>'fingerprint'<>v_hash then raise exception 'idempotency key reuse mismatch'; end if;
    return receipt.metadata->'result';
  end if;
  if p_action='open' then
    select user_id into v_customer from orders where id=p_order;
    if not found then raise exception 'order unavailable'; end if;
    v_id:=create_support_conversation(v_customer,p_order);
  else v_id:=p_conversation; end if;
  select * into c from support_conversations where id=v_id for update;
  if not found then raise exception 'conversation unavailable'; end if;
  if p_action='link' then
    if p_order is null or (c.order_id is not null and c.order_id<>p_order) or not exists(select 1 from orders where id=p_order and user_id=c.customer_id) then raise exception 'support order mismatch'; end if;
    update support_conversations set order_id=p_order,updated_at=now() where id=c.id;
  elsif c.order_id is distinct from p_order then raise exception 'support order mismatch'; end if;
  if p_action='reply' then
    if c.status in ('closed','resolved') then raise exception 'reopen the conversation before replying'; end if;
    result:=append_support_agent_message(p_actor,c.id,p_values->>'body',p_key);
  elsif p_action='note' then
    if p_values->>'body' is null or length(trim(p_values->>'body')) not between 1 and 4000 then raise exception 'invalid internal note'; end if;
    v_id:='sn_'||replace(gen_random_uuid()::text,'-','');
    insert into support_staff_notes(id,conversation_id,author_id,body) values(v_id,c.id,p_actor,trim(p_values->>'body'));
    result:=jsonb_build_object('noteId',v_id);
  elsif p_action='assign' then
    update support_conversations set assigned_to=nullif(p_values->>'assigneeId',''),updated_at=now() where id=c.id;
  elsif p_action='status' then
    v_status:=p_values->>'status';
    if v_status is null or v_status not in ('open','waiting_customer','waiting_support','resolved','closed') then raise exception 'invalid support status'; end if;
    update support_conversations set status=v_status,resolved_at=case when v_status in ('resolved','closed') then now() else null end,updated_at=now() where id=c.id;
  elsif p_action='escalate' then
    update support_conversations set escalated_at=now(),updated_at=now() where id=c.id;
  elsif p_action='classify' then
    if p_values->>'category' is null or p_values->>'subject' is null then raise exception 'support category and subject required'; end if;
    update support_conversations set category=p_values->>'category',subject=trim(p_values->>'subject'),updated_at=now() where id=c.id;
  end if;
  result:=coalesce(result,'{}'::jsonb)||jsonb_build_object('conversationId',c.id,'orderId',p_order,'action',p_action);
  perform record_audit_event('support.operation','support_conversation',c.id,p_actor,'admin',p_key,'success',jsonb_build_object('orderId',p_order,'action',p_action,'fingerprint',v_hash,'result',result));
  return result;
end; $$;
revoke all on function manage_admin_support(text,text,text,text,jsonb,text) from public;

-- Capture future transitions in the existing authoritative append-only ledger.
-- Historical timelines use their original persisted timestamps, never a made-up backfill.
create or replace function audit_order_operations_transition() returns trigger language plpgsql as $$
declare oid text; actor text; actor_role text;
begin
  if new.status is not distinct from old.status then return new; end if;
  if tg_table_name='orders' then oid:=new.id; else oid:=new.order_id; end if;
  actor:=nullif(current_setting('app.user_id',true),'');
  select role into actor_role from "user" where id=actor;
  perform record_audit_event(tg_table_name||'.status.changed',case when tg_table_name='orders' then 'order' else tg_table_name end,new.id,actor,coalesce(actor_role,'system'),null,'success',jsonb_build_object('orderId',oid,'from',old.status,'to',new.status));
  return new;
end; $$;
drop trigger if exists orders_operations_audit on orders;
create trigger orders_operations_audit after update of status on orders for each row execute function audit_order_operations_transition();
drop trigger if exists refunds_operations_audit on provider_refund_requests;
create trigger refunds_operations_audit after update of status on provider_refund_requests for each row execute function audit_order_operations_transition();
drop trigger if exists disputes_operations_audit on customer_order_disputes;
create trigger disputes_operations_audit after update of status on customer_order_disputes for each row execute function audit_order_operations_transition();
create index if not exists audit_events_order_context_idx on audit_events((metadata->>'orderId'),created_at,id);

create or replace function append_customer_support_message(
  p_customer_id text,
  p_conversation_id text,
  p_body text,
  p_idempotency_key text
) returns jsonb
language plpgsql
as $$
declare
  v_conversation record;
  v_id text;
  v_existing record;
  v_hash text;
begin
  if p_customer_id is null then raise exception 'customer identity required'; end if;
  if p_body is null or length(trim(p_body)) < 1 or length(trim(p_body)) > 4000 then raise exception 'message must be 1-4000 characters'; end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 16 or length(trim(p_idempotency_key)) > 128 then raise exception 'invalid idempotency key'; end if;
  v_hash := encode(digest(trim(p_body), 'sha256'), 'hex');

  select * into v_conversation
    from support_conversations
   where id=p_conversation_id
   for update;
  if not found then raise exception 'conversation not found'; end if;
  if v_conversation.customer_id <> p_customer_id then raise exception 'conversation access denied'; end if;
  if v_conversation.status in ('resolved','closed') then raise exception 'conversation is closed'; end if;

  select id,conversation_id,request_hash into v_existing
    from support_messages
   where sender_id=p_customer_id and idempotency_key=p_idempotency_key
   limit 1;
  if found then
    if v_existing.conversation_id is distinct from p_conversation_id or v_existing.request_hash <> v_hash then raise exception 'idempotency key reuse with different message'; end if;
    return jsonb_build_object('messageId',v_existing.id,'conversationId',v_existing.conversation_id,'existing',true);
  end if;

  v_id := 'msg_'||replace(gen_random_uuid()::text,'-','');
  insert into support_messages(id,conversation_id,sender_id,sender_type,body,idempotency_key,request_hash)
  values(v_id,p_conversation_id,p_customer_id,'customer',left(trim(p_body),4000),p_idempotency_key,v_hash);
  update support_conversations set status='waiting_support',updated_at=now() where id=p_conversation_id;
  return jsonb_build_object('messageId',v_id,'conversationId',p_conversation_id,'existing',false);
end;
$$;

create or replace function append_support_agent_message(
  p_support_id text,
  p_conversation_id text,
  p_body text,
  p_idempotency_key text
) returns jsonb
language plpgsql
as $$
declare
  v_conversation record;
  v_id text;
  v_existing record;
  v_hash text;
  v_role text;
begin
  if p_support_id is null then raise exception 'support identity required'; end if;
  select role into v_role from "user" where id=p_support_id;
  if v_role <> 'admin' then raise exception 'support agent role required'; end if;
  if p_body is null or length(trim(p_body)) < 1 or length(trim(p_body)) > 4000 then raise exception 'message must be 1-4000 characters'; end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 16 or length(trim(p_idempotency_key)) > 128 then raise exception 'invalid idempotency key'; end if;
  v_hash := encode(digest(trim(p_body), 'sha256'), 'hex');

  select * into v_conversation
    from support_conversations
   where id=p_conversation_id
   for update;
  if not found then raise exception 'conversation not found'; end if;
  if v_conversation.status='closed' then raise exception 'conversation is closed'; end if;

  select id,conversation_id,request_hash into v_existing
    from support_messages
   where sender_id=p_support_id and idempotency_key=p_idempotency_key
   limit 1;
  if found then
    if v_existing.conversation_id is distinct from p_conversation_id or v_existing.request_hash <> v_hash then raise exception 'idempotency key reuse with different message'; end if;
    return jsonb_build_object('messageId',v_existing.id,'conversationId',v_existing.conversation_id,'existing',true);
  end if;

  v_id := 'msg_'||replace(gen_random_uuid()::text,'-','');
  insert into support_messages(id,conversation_id,sender_id,sender_type,body,idempotency_key,request_hash)
  values(v_id,p_conversation_id,p_support_id,'support',left(trim(p_body),4000),p_idempotency_key,v_hash);
  update support_conversations set status='waiting_customer',updated_at=now() where id=p_conversation_id;

  perform record_audit_event(
    'support.agent_message.sent','support_conversation',p_conversation_id,p_support_id,'admin',null,'success',
    jsonb_build_object('messageId',v_id,'orderId',v_conversation.order_id)
  );

  return jsonb_build_object('messageId',v_id,'conversationId',p_conversation_id,'existing',false);
end;
$$;

create or replace view admin_order_timeline as
select o.id as order_id,'order:'||o.id as event_key,o.created_at as occurred_at,'order.created'::text as event_type,'unknown'::text as actor_type,null::text as actor_id,'orders'::text as source,null::text as event_id,null::text as provider_reference,null::text as from_status,null::text as to_status from orders o
union all
select p.order_id,'attempt:'||a.id,a.created_at,'payment.attempt_created','system',null,'payment_attempts',a.id,a.provider_reference,null,'initiated' from payment_attempts a join payments p on p.id=a.payment_id
union all
select p.order_id,'payment:'||t.id,t.created_at,'payment.state_changed','system',null,t.source,t.provider_event_id,(select w.provider_reference from payment_webhook_events w where w.provider_key=p.provider_key and w.event_id=t.provider_event_id limit 1),t.from_status,t.to_status from payment_state_transitions t join payments p on p.id=t.payment_id
union all
select p.order_id,'evidence:'||e.provider_key||':'||e.event_id,e.recorded_at,'payment.provider_verified','provider',null,'payment_provider_evidence',e.event_id,e.provider_reference,null,null from payment_provider_evidence e join payments p on p.id=e.payment_id
union all
select p.order_id,'webhook:'||w.id,w.received_at,w.event_type,'provider',null,'payment_webhook_events',w.event_id,w.provider_reference,null,w.processing_status from payment_webhook_events w join payment_attempts a on a.provider_key=w.provider_key and a.provider_reference=w.provider_reference join payments p on p.id=a.payment_id
union all
select o.id,'merchant:'||h.id,h.created_at,'fulfilment.state_changed',coalesce(u.role,'merchant'),h.actor_user_id,'merchant_order_status_history',h.id::text,null,h.from_status,h.to_status from merchant_order_status_history h join orders o on o.id=h.order_id and o.merchant_id=h.merchant_id left join "user" u on u.id=h.actor_user_id
union all
select s.order_id,'shipment:'||e.id,e.event_at,e.event_type,'provider',null,'shipment_events',e.carrier_event_id,s.external_shipment_id,null,null from shipment_events e join shipments s on s.id=e.shipment_id join orders o on o.id=s.order_id and o.merchant_id=s.merchant_id
union all
select d.order_id,'dispute:'||d.id,d.created_at,'dispute.opened','customer',d.customer_id,'customer_order_disputes',d.id,null,null,'open' from customer_order_disputes d
union all
select r.order_id,'refund:'||r.id,r.requested_at,'refund.requested',case when r.requested_by is null then 'system' else 'user' end,r.requested_by,'provider_refund_requests',r.id,r.provider_reference,null,'requested' from provider_refund_requests r
union all
select r.order_id,'refund-complete:'||r.id,r.processed_at,'refund.processed','provider',null,'provider_refund_requests',r.id,r.provider_refund_id,null,'processed' from provider_refund_requests r where r.processed_at is not null
union all
select c.order_id,'support:'||c.id,c.created_at,'support.opened','unknown',null,'support_conversations',c.id,null,null,null from support_conversations c where c.order_id is not null
union all
select c.order_id,'message:'||m.id,m.created_at,'support.message',m.sender_type,m.sender_id,'support_messages',m.id,null,null,null from support_messages m join support_conversations c on c.id=m.conversation_id where c.order_id is not null
union all
select o.id,'audit:'||a.id,a.created_at,a.event_type,coalesce(a.actor_role,'system'),a.actor_user_id,'audit_events',coalesce(a.request_id,a.id::text),null,a.metadata->>'from',a.metadata->>'to' from audit_events a join orders o on (a.resource_type='order' and a.resource_id=o.id) or a.metadata->>'orderId'=o.id where a.event_type<>'admin.order.read';
revoke all on admin_order_timeline from public;
