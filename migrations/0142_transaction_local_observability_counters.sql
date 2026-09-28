-- Telemetry must not serialize otherwise unrelated financial transactions.
-- Keep every committed increment, but group updates by transaction. Consumers
-- aggregate SUM(value) for a metric/minute; legacy rows use transaction_id=0.
alter table observability_counters add column transaction_id bigint not null default 0;
alter table observability_counters drop constraint observability_counters_pkey;
alter table observability_counters add primary key(metric_key,bucket_start,transaction_id);
comment on column observability_counters.transaction_id is
  'Transaction-local telemetry shard; sum(value) by metric_key,bucket_start for exact totals. Retention remains bucket-based.';

create or replace function increment_observability_counter(p_metric_key text,p_delta bigint default 1)
returns void language plpgsql as $$
declare
  v_bucket timestamptz := date_trunc('minute',now());
  v_transaction bigint := txid_current();
begin
  insert into observability_counters(metric_key,bucket_start,transaction_id,value)
  values(p_metric_key,v_bucket,v_transaction,p_delta)
  on conflict(metric_key,bucket_start,transaction_id) do update
    set value=observability_counters.value+excluded.value,updated_at=now();
end; $$;
