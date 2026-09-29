-- v1.62: Manual administrator approval for merchant applications.
--
-- Automated verification (KYB/business/document/etc.) is evidence for the review
-- queue, not a hard prerequisite for an administrator's final decision. ELEMARKET
-- administrators may manually verify submitted information and approve/reject an
-- application even when automated checks remain pending, unavailable, or failed.
--
-- Authentication, admin authorization, fresh-session assurance, row locking and
-- immutable audit logging remain enforced by the application/workflow.

create or replace function review_merchant_application(
  p_application_id text,
  p_admin_id text,
  p_action text,
  p_reason text default null
) returns jsonb language plpgsql as $$
declare
  v_app record;
  v_new_status text;
  v_merchant_id text;
  v_email_status text;
  v_phone_status text;
  v_business_status text;
  v_identity_status text;
  v_document_status text;
  v_payout_status text;
begin
  if p_admin_id is null or length(trim(p_admin_id)) < 1 then
    raise exception 'admin identity required';
  end if;
  if p_action not in ('start_review','approve','reject') then
    raise exception 'invalid merchant review action';
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

  if p_action='start_review' then
    if v_app.status <> 'pending' then
      raise exception 'application is not pending';
    end if;
    v_new_status := 'reviewing';

  elsif p_action='approve' then
    if v_app.status <> 'reviewing' then
      raise exception 'application must be under review';
    end if;

    -- Deliberately do NOT require automated verification checks to be verified.
    -- An authorized administrator is the final manual verification authority.
    v_new_status := 'approved';

  else
    if v_app.status <> 'reviewing' then
      raise exception 'application must be under review';
    end if;
    if p_reason is null or length(trim(p_reason)) < 3 then
      raise exception 'rejection reason required';
    end if;
    v_new_status := 'rejected';
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
     set status=v_new_status,
         updated_at=now()
   where id=v_app.id;

  v_merchant_id := null;

  perform record_audit_event(
    'merchant.application.'||v_new_status,
    'merchant_application',
    v_app.id,
    p_admin_id,
    'admin',
    null,
    'success',
    jsonb_build_object(
      'action', p_action,
      'reason', nullif(trim(coalesce(p_reason,'')),''),
      'manualApproval', p_action='approve',
      'verificationChecksAtDecision', jsonb_build_object(
        'email', coalesce(v_email_status,'missing'),
        'phone', coalesce(v_phone_status,'missing'),
        'business', coalesce(v_business_status,'missing'),
        'identity', coalesce(v_identity_status,'missing'),
        'document', coalesce(v_document_status,'missing'),
        'payout', coalesce(v_payout_status,'missing')
      )
    )
  );

  return jsonb_build_object(
    'applicationId',v_app.id,
    'status',v_new_status,
    'merchantId',v_merchant_id,
    'manualDecision',p_action in ('approve','reject')
  );
end;
$$;

comment on function review_merchant_application(text,text,text,text) is
  'Admin-controlled merchant application review. Automated verification checks are evidence only; authorized administrators may manually approve or reject after their own review. Every decision is audited.';
