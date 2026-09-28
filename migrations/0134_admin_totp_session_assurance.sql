-- Existing sessions deliberately get no assurance backfill. A fresh TOTP is required.
create table admin_session_assurance (
  session_id text primary key references session(id) on delete cascade,
  user_id text not null references "user"(id) on delete cascade,
  method text not null check(method='totp'),
  verified_at timestamptz not null
);
revoke all on admin_session_assurance from public;
