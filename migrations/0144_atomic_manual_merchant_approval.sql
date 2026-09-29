-- v1.63: Atomic manual merchant approval + activation.
-- An authorized administrator is the final manual verification authority. Automated
-- verification checks are recorded as evidence but are not approval prerequisites.
-- Approval and merchant activation must commit or roll back together.

create or replace function approve_and_activate_merchant_application(
  p_application_id text,
  p_admin_id text,
  p_lat double precision,
  p_lon double precision,
  p_city text,
  p_neighborhood text
) returns jsonb language plpgsql as $$
declare
  v_app record;
  v_email_status text;
  v_phone_status text;
  v_business_status text;
  v_identity_status text;
  v_document_status text;
  v_payout_status text;
  v_activation jsonb;
begin
  if p_admin_id is null or length(trim(p_admin_id)) < 1 then
    raise exception 'admin identity required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('elemarket:merchant-application:'||p_application_id, 0)
  );

  select * into v_app
    from merchant_applications
   where id=p_application_id
   for update;

  if not found then
    raise exception 'merchant application not found';
  end if;
  if v_app.status <> 'reviewing' then
    raise exception 'application must be under review';
  end if;

  select
    max(status) filter (where check_type='email'),
    max(status) filter (where check_type='phone'),
    max(status) filter (where check_type='business'),
    max(status) filter (where check_type='identity'),
    max(status) filter (where check_type='document'),
    max(status) filter (where check_type='payout')
  into
    v_email_status,
    v_phone_status,
    v_business_status,
    v_identity_status,
    v_document_status,
    v_payout_status
  from merchant_verification_checks
  where application_id=v_app.id;

  update merchant_applications
     set status='approved', updated_at=now()
   where id=v_app.id;

  perform record_audit_event(
    'merchant.application.approved',
    'merchant_application',
    v_app.id,
    p_admin_id,
    'admin',
    null,
    'success',
    jsonb_build_object(
      'action','approve',
      'manualApproval',true,
      'verificationChecksAtDecision',jsonb_build_object(
        'email',coalesce(v_email_status,'missing'),
        'phone',coalesce(v_phone_status,'missing'),
        'business',coalesce(v_business_status,'missing'),
        'identity',coalesce(v_identity_status,'missing'),
        'document',coalesce(v_document_status,'missing'),
        'payout',coalesce(v_payout_status,'missing')
      )
    )
  );

  select activate_approved_merchant_application(
    p_application_id,
    p_admin_id,
    p_lat,
    p_lon,
    p_city,
    p_neighborhood
  ) into v_activation;

  return jsonb_build_object(
    'applicationId',v_app.id,
    'status','approved',
    'manualDecision',true,
    'activation',coalesce(v_activation,'{}'::jsonb)
  );
end;
$$;

comment on function approve_and_activate_merchant_application(text,text,double precision,double precision,text,text) is
  'Atomically approves and activates a merchant application after an authorized administrator manually reviews it. Automated verification checks are evidence only.';
