-- Financial-integrity follow-up for the client RPC boundary.
--
-- Existing expenses are frozen to the event's active roster at migration time,
-- preserving the balance users saw immediately before this migration. New
-- expenses snapshot their roster when inserted, so later joins/departures never
-- rewrite historical shares.

-- Apply this migration as one transaction. Take the final DDL lock mode up
-- front with NOWAIT so an in-flight legacy poll aborts this transaction instead
-- of creating a cross-table lock cycle. Quiesce traffic, then retry on 55P03.
lock table public.events, public.members, public.expenses, public.settlements
  in access exclusive mode nowait;

-- Never guess at an orphaned party. Without an active real identity there is no
-- safe roster to freeze and no one who can authorize a repair. Resolve every
-- row returned by the equivalent audit query before applying this migration.
do $$
declare
  v_orphan_count bigint;
begin
  select count(*) into v_orphan_count
  from public.events e
  where not exists (
    select 1 from public.members m
    where m.event_id = e.id and m.status = 'active'
      and m.device_id not like '%:guest:%'
  );

  if v_orphan_count > 0 then
    raise exception
      'Migration blocked: % event(s) have no active real member. Audit and resolve them before retrying.',
      v_orphan_count;
  end if;
end;
$$;

-- Keep direct table access closed even if grants drift later. SECURITY DEFINER
-- sp_* functions remain the only client boundary; their owner bypasses RLS.
alter table public.events enable row level security;
alter table public.members enable row level security;
alter table public.expenses enable row level security;
alter table public.settlements enable row level security;
revoke all on public.events, public.members, public.expenses, public.settlements
  from anon, authenticated;

alter table public.expenses
  add column if not exists participant_ids uuid[],
  add column if not exists request_id uuid;

alter table public.events
  add column if not exists create_request_id uuid;

alter table public.settlements
  add column if not exists request_id uuid;

-- Freeze the exact roster used by the legacy client before retiring synthetic
-- review identities. Approved synthetic guests therefore remain resolvable
-- ghosts when existing expenses implicitly gave them a share.
update public.expenses x
set participant_ids = coalesce(
  (
    select array_agg(m.id order by m.id)
    from public.members m
    where m.event_id = x.event_id and m.status = 'active'
  ),
  array[]::uuid[]
)
where x.participant_ids is null;

alter table public.expenses
  alter column participant_ids set default array[]::uuid[],
  alter column participant_ids set not null;

-- The live project may already contain this constraint when a dashboard-run
-- migration is subsequently reconciled with migration history. Recreate it so
-- that replay is safe and the history repair cannot double-apply a constraint.
alter table public.expenses
  drop constraint if exists expenses_participant_ids_nonempty;

alter table public.expenses
  add constraint expenses_participant_ids_nonempty
  check (cardinality(participant_ids) > 0);

-- Retire synthetic review guests created by the prior same-device shortcut.
-- They had no usable credential. Remove the normal no-history case; quarantine
-- referenced anomalies as removed ghosts so they cannot enter new snapshots.
delete from public.settlements s
using public.members g
where g.id in (s.from_member, s.to_member)
  and g.device_id like '%:guest:%'
  and s.status = 'pending';

delete from public.members g
where g.device_id like '%:guest:%'
  and not exists (
    select 1 from public.expenses x
    where x.paid_by = g.id or x.created_by = g.id
      or x.participant_ids @> array[g.id]
  )
  and not exists (
    select 1 from public.settlements s where s.from_member = g.id or s.to_member = g.id
  );

update public.members
set status = 'removed'
where device_id like '%:guest:%' and status in ('active', 'pending');

-- Repair the orphan-host shape the previous identity-deletion function could
-- leave behind. Only an already-active real member can inherit host authority.
update public.members old_host
set is_host = false
where old_host.is_host and old_host.status <> 'active'
  and exists (
    select 1 from public.members a
    where a.event_id = old_host.event_id and a.status = 'active'
      and a.device_id not like '%:guest:%'
  );

with host_successor as (
  select distinct on (m.event_id) m.id
  from public.members m
  where m.status = 'active' and m.device_id not like '%:guest:%'
    and not exists (
      select 1 from public.members h
      where h.event_id = m.event_id and h.status = 'active' and h.is_host
    )
  order by m.event_id, m.created_at, m.id
)
update public.members m
set is_host = true
from host_successor successor
where m.id = successor.id;

create index if not exists expenses_participant_ids_gin
  on public.expenses using gin (participant_ids);

create unique index if not exists expenses_creator_request_unique
  on public.expenses (created_by, request_id)
  where request_id is not null;

create unique index if not exists events_create_request_unique
  on public.events (create_request_id)
  where create_request_id is not null;

create unique index if not exists settlements_sender_request_unique
  on public.settlements (from_member, request_id)
  where request_id is not null;

-- A client-generated request UUID makes an uncertain timeout safe to retry.
-- The existing 3-argument function remains for older builds; this release uses
-- the idempotent overload below.
create or replace function public.sp_create_event(
  p_device_id text,
  p_event_name text,
  p_display_name text,
  p_request_id uuid
)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_name text := sp_clean_name(p_event_name, 60);
  v_display text := sp_clean_name(p_display_name, 40);
  v_event events;
begin
  perform sp_check_device(p_device_id);
  if p_request_id is null then raise exception 'Missing request identity.'; end if;
  if v_name is null then raise exception 'Give the event a name.'; end if;
  if v_display is null then raise exception 'Tell us what to call you.'; end if;

  select e.* into v_event
  from events e
  where e.create_request_id = p_request_id
    and exists (
      select 1 from members m
      where m.event_id = e.id and m.device_id = p_device_id
        and m.is_host and m.status = 'active'
    );
  if found then
    if v_event.name is distinct from v_name or not exists (
      select 1 from members m
      where m.event_id = v_event.id and m.device_id = p_device_id
        and m.is_host and m.status = 'active'
        and m.display_name = v_display
    ) then
      raise exception 'That retry has different party details. Reload and try again.';
    end if;
    return jsonb_build_object('eventId', v_event.id, 'code', v_event.code);
  end if;
  if exists (select 1 from events e where e.create_request_id = p_request_id) then
    raise exception 'Couldn''t create the event. Start a fresh request.';
  end if;

  for i in 1..6 loop
    begin
      insert into events (name, code, create_request_id)
      values (v_name, sp_new_code(), p_request_id)
      returning * into v_event;

      insert into members (event_id, device_id, display_name, is_host, status)
      values (v_event.id, p_device_id, v_display, true, 'active');

      return jsonb_build_object('eventId', v_event.id, 'code', v_event.code);
    exception when unique_violation then
      select e.* into v_event
      from events e
      where e.create_request_id = p_request_id
        and exists (
          select 1 from members m
          where m.event_id = e.id and m.device_id = p_device_id
            and m.is_host and m.status = 'active'
        );
      if found then
        if v_event.name is distinct from v_name or not exists (
          select 1 from members m
          where m.event_id = v_event.id and m.device_id = p_device_id
            and m.is_host and m.status = 'active'
            and m.display_name = v_display
        ) then
          raise exception 'That retry has different party details. Reload and try again.';
        end if;
        return jsonb_build_object('eventId', v_event.id, 'code', v_event.code);
      end if;
      if exists (select 1 from events e where e.create_request_id = p_request_id) then
        raise exception 'Couldn''t create the event. Start a fresh request.';
      end if;
      if i = 6 then raise exception 'Couldn''t create the event. Try again.'; end if;
    end;
  end loop;

  raise exception 'Couldn''t create the event. Try again.';
end;
$$;

revoke all on function public.sp_create_event(text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.sp_create_event(text, text, text, uuid) to anon;

create or replace function public.sp_create_event(
  p_device_id text,
  p_event_name text,
  p_display_name text
)
returns jsonb language sql volatile security definer set search_path = public, pg_temp as $$
  select public.sp_create_event(
    p_device_id, p_event_name, p_display_name, gen_random_uuid()
  );
$$;

revoke all on function public.sp_create_event(text, text, text)
  from public, anon, authenticated;
grant execute on function public.sp_create_event(text, text, text) to anon;

-- A second browser (for example Safari alongside the Capacitor app) naturally
-- has a distinct device identity and can exercise host approval end to end.
-- Do not synthesize an unreachable :guest: identity for an already-active host.
create or replace function public.sp_join_event(p_device_id text, p_code text, p_display_name text)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_display text := sp_clean_name(p_display_name, 40);
  v_event events;
  v_existing members;
begin
  perform sp_check_device(p_device_id);
  if char_length(v_code) < 4 then raise exception 'That code doesn''t look right.'; end if;
  if v_display is null then raise exception 'Tell us what to call you.'; end if;

  -- Every event mutation locks the parent first. This serializes joins with
  -- host identity deletion and whole-party deletion without lock inversion.
  select * into v_event from events where code = v_code for share;
  if not found then raise exception 'No party with that code. Check it and try again.'; end if;

  select * into v_existing from members
  where event_id = v_event.id and device_id = p_device_id
  for update;
  if not found then
    insert into members (event_id, device_id, display_name, status)
    values (v_event.id, p_device_id, v_display, 'pending');
    return jsonb_build_object('eventId', v_event.id, 'status', 'pending');
  end if;

  if v_existing.status = 'active' then
    return jsonb_build_object('eventId', v_event.id, 'status', 'active');
  end if;

  update members set status = 'pending', display_name = v_display where id = v_existing.id;
  return jsonb_build_object('eventId', v_event.id, 'status', 'pending');
end;
$$;

create or replace function public.sp_my_events(p_device_id text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform sp_check_device(p_device_id);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'eventId', m.event_id,
      'eventName', e.name,
      'myName', m.display_name,
      'myStatus', m.status,
      'isHost', m.is_host,
      -- A pending requester gets no room-size or financial aggregates before approval.
      'activeCount', case when m.status = 'active' then
        (select count(*) from members a where a.event_id = m.event_id
          and a.status = 'active' and a.device_id not like '%:guest:%')
        else 0 end,
      'totalSpentCents', case when m.status = 'active' then
        coalesce((select sum(x.amount_cents) from expenses x where x.event_id = m.event_id), 0)
        else 0 end,
      'pendingForMe', (select count(*) from settlements s where s.to_member = m.id and s.status = 'pending')
    ) order by m.created_at desc)
    from members m join events e on e.id = m.event_id
    where m.device_id = p_device_id and m.status in ('active', 'pending')
  ), '[]'::jsonb);
end;
$$;

create or replace function public.sp_event_state(p_device_id text, p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_me members;
  v_event events;
begin
  perform sp_check_device(p_device_id);
  select * into v_me from members where event_id = p_event_id and device_id = p_device_id;
  if not found then return jsonb_build_object('notMember', true); end if;
  select * into v_event from events where id = p_event_id;
  if not found then return jsonb_build_object('notMember', true); end if;

  if v_me.status <> 'active' then
    return jsonb_build_object(
      'restricted', true,
      'event', jsonb_build_object('id', v_event.id, 'name', v_event.name),
      'me', jsonb_build_object('memberId', v_me.id, 'name', v_me.display_name, 'isHost', v_me.is_host, 'status', v_me.status),
      'hostName', coalesce((select display_name from members where event_id = p_event_id and is_host and status = 'active' limit 1), 'the host'),
      'pendingConfirmations', coalesce((
        select jsonb_agg(jsonb_build_object('id', s.id, 'fromName', coalesce(f.display_name, 'Someone'), 'amountCents', s.amount_cents) order by s.created_at desc)
        from settlements s left join members f on f.id = s.from_member
        where s.event_id = p_event_id and s.to_member = v_me.id and s.status = 'pending'
      ), '[]'::jsonb)
    );
  end if;

  return jsonb_build_object(
    'restricted', false,
    'event', jsonb_build_object('id', v_event.id, 'name', v_event.name, 'code', v_event.code, 'currency', v_event.currency),
    'me', jsonb_build_object('memberId', v_me.id, 'name', v_me.display_name, 'isHost', v_me.is_host, 'status', v_me.status),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id,
        'name', m.display_name,
        'isHost', m.is_host,
        'status', m.status,
        'canReceivePayment', m.device_id not like 'deleted:%' and m.device_id not like '%:guest:%',
        'joinedAt', m.created_at
      ) order by m.created_at)
      from members m
      where m.event_id = p_event_id and (
        m.status = 'active'
        -- Hosts see new requests. Non-hosts see a pending identity only when
        -- immutable money history requires it to keep the ledger complete.
        or (m.status = 'pending' and (
          v_me.is_host
          or exists (select 1 from expenses x where x.event_id = p_event_id and (x.paid_by = m.id or x.created_by = m.id or x.participant_ids @> array[m.id]))
          or exists (select 1 from settlements s where s.event_id = p_event_id and (s.from_member = m.id or s.to_member = m.id))
        ))
        or (m.status in ('left', 'removed', 'denied') and (
          exists (select 1 from expenses x where x.event_id = p_event_id and (x.paid_by = m.id or x.created_by = m.id or x.participant_ids @> array[m.id]))
          or exists (select 1 from settlements s where s.event_id = p_event_id and (s.from_member = m.id or s.to_member = m.id))
        ))
      )
    ), '[]'::jsonb),
    'expenses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id,
        'label', x.label,
        'amountCents', x.amount_cents,
        'paidBy', x.paid_by,
        'createdBy', x.created_by,
        'participantIds', x.participant_ids,
        'createdAt', x.created_at
      ) order by x.created_at desc)
      from expenses x where x.event_id = p_event_id
    ), '[]'::jsonb),
    'settlements', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'from', s.from_member, 'to', s.to_member, 'amountCents', s.amount_cents, 'status', s.status, 'createdAt', s.created_at, 'resolvedAt', s.resolved_at) order by s.created_at desc)
      from settlements s where s.event_id = p_event_id
    ), '[]'::jsonb)
  );
end;
$$;

-- Revalidate authorization under a consistent event-first lock order. This
-- closes stale-host and leave/remove races with host transfer and money writes.
create or replace function public.sp_member_action(
  p_device_id text,
  p_event_id uuid,
  p_member_id uuid,
  p_action text
)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_me members;
  v_target members;
  v_count int;
begin
  perform sp_check_device(p_device_id);
  -- Membership changes take the parent exclusively; money writes take it FOR
  -- SHARE. Serialization happens before either path locks member rows.
  perform 1 from events where id = p_event_id for update;
  if not found then raise exception 'Event not found.'; end if;

  select * into v_me from members
  where event_id = p_event_id and device_id = p_device_id;
  if not found then raise exception 'You''re not in this event.'; end if;

  -- Lock actor and target in UUID order, then reload both rows. A caller that
  -- waited behind another mutation must never authorize from a stale record.
  perform m.id from members m
  where m.event_id = p_event_id and m.id in (v_me.id, p_member_id)
  order by m.id
  for update;

  select * into v_me from members
  where event_id = p_event_id and device_id = p_device_id;
  if not found then raise exception 'You''re not in this event.'; end if;

  select * into v_target from members
  where id = p_member_id and event_id = p_event_id;
  if not found then raise exception 'No such member.'; end if;

  if p_action in ('approve', 'deny') then
    if not v_me.is_host or v_me.status <> 'active' then
      raise exception 'Only the host can do that.';
    end if;
    update members
    set status = case when p_action = 'approve' then 'active' else 'denied' end
    where id = v_target.id and status = 'pending';
    get diagnostics v_count = row_count;
    if v_count = 0 then raise exception 'Already handled.'; end if;
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'remove' then
    if not v_me.is_host or v_me.status <> 'active' then
      raise exception 'Only the host can do that.';
    end if;
    if v_target.is_host then raise exception 'The host can''t be removed.'; end if;
    update members set status = 'removed'
    where id = v_target.id and status = 'active' and not is_host;
    get diagnostics v_count = row_count;
    if v_count = 0 then raise exception 'Already handled.'; end if;
    delete from settlements where event_id = p_event_id and status = 'pending'
      and (from_member = v_target.id or to_member = v_target.id);
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'leave' then
    if v_target.id <> v_me.id then raise exception 'You can only remove yourself.'; end if;
    if v_me.is_host then
      raise exception 'Hosts can''t leave their own party. Transfer or delete it first.';
    end if;
    update members set status = 'left'
    where id = v_me.id and status in ('active', 'pending') and not is_host;
    get diagnostics v_count = row_count;
    if v_count = 0 then raise exception 'You''re already out.'; end if;
    delete from settlements where event_id = p_event_id and status = 'pending'
      and (from_member = v_me.id or to_member = v_me.id);
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'rerequest' then
    if v_target.id <> v_me.id then raise exception 'Not yours.'; end if;
    if v_me.is_host then raise exception 'This party needs host recovery.'; end if;
    update members set status = 'pending'
    where id = v_me.id and status in ('left', 'removed', 'denied') and not is_host;
    get diagnostics v_count = row_count;
    if v_count = 0 then raise exception 'Nothing to re-request.'; end if;
    return jsonb_build_object('ok', true);
  end if;

  raise exception 'Unknown action.';
end;
$$;

revoke all on function public.sp_member_action(text, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.sp_member_action(text, uuid, uuid, text) to anon;

create or replace function public.sp_resolve_settlement(
  p_device_id text,
  p_event_id uuid,
  p_settlement_id uuid,
  p_action text
)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_me members;
  v_count int;
begin
  perform sp_check_device(p_device_id);
  perform 1 from events where id = p_event_id for share;
  if not found then raise exception 'Event not found.'; end if;

  select * into v_me from members
  where event_id = p_event_id and device_id = p_device_id
  for share;
  if not found then raise exception 'You''re not in this event.'; end if;

  if p_action in ('confirm', 'reject') then
    update settlements set
      status = case when p_action = 'confirm' then 'confirmed' else 'rejected' end,
      resolved_at = now()
    where id = p_settlement_id and event_id = p_event_id
      and to_member = v_me.id and status = 'pending';
    get diagnostics v_count = row_count;
    if v_count = 0 then raise exception 'Already handled, or not yours to confirm.'; end if;
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'cancel' then
    delete from settlements
    where id = p_settlement_id and event_id = p_event_id
      and from_member = v_me.id and status = 'pending';
    get diagnostics v_count = row_count;
    if v_count = 0 then raise exception 'Already handled.'; end if;
    return jsonb_build_object('ok', true);
  end if;

  raise exception 'Unknown action.';
end;
$$;

revoke all on function public.sp_resolve_settlement(text, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.sp_resolve_settlement(text, uuid, uuid, text) to anon;

create or replace function public.sp_add_expense(
  p_device_id text,
  p_event_id uuid,
  p_label text,
  p_amount_cents int,
  p_paid_by uuid,
  p_request_id uuid
)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_me members;
  v_existing expenses;
  v_label text := sp_clean_name(p_label, 80);
  v_paid_by uuid;
  v_participant_ids uuid[];
  v_id uuid;
begin
  perform sp_check_device(p_device_id);
  perform 1 from events where id = p_event_id for share;
  if not found then raise exception 'Event not found.'; end if;

  select * into v_me from members
  where event_id = p_event_id and device_id = p_device_id
  for share;
  if not found or v_me.status <> 'active' then raise exception 'You''re not active in this event.'; end if;
  if p_request_id is null then raise exception 'Missing request identity.'; end if;
  if v_label is null then raise exception 'What was it? Give it a name.'; end if;
  perform sp_check_amount(p_amount_cents);

  v_paid_by := coalesce(p_paid_by, v_me.id);

  select * into v_existing from expenses
  where created_by = v_me.id and request_id = p_request_id;
  if found then
    if v_existing.event_id is distinct from p_event_id
      or v_existing.label is distinct from v_label
      or v_existing.amount_cents is distinct from p_amount_cents
      or v_existing.paid_by is distinct from v_paid_by then
      raise exception 'That retry has different expense details. Refresh the party and try again.';
    end if;
    return jsonb_build_object('ok', true, 'id', v_existing.id);
  end if;

  select coalesce(array_agg(active_member.id order by active_member.id), array[]::uuid[])
  into v_participant_ids
  from (
    select m.id
    from members m
    where m.event_id = p_event_id and m.status = 'active'
      and m.device_id not like '%:guest:%'
    order by m.id
    for share
  ) active_member;
  if cardinality(v_participant_ids) = 0 then raise exception 'Nobody is active in this event.'; end if;
  if not (v_paid_by = any(v_participant_ids)) then
    raise exception 'That payer isn''t active in this event.';
  end if;

  insert into expenses (
    event_id, paid_by, created_by, label, amount_cents, participant_ids, request_id
  )
  values (
    p_event_id, v_paid_by, v_me.id, v_label, p_amount_cents, v_participant_ids, p_request_id
  )
  on conflict (created_by, request_id) where request_id is not null do nothing
  returning id into v_id;
  if v_id is null then
    select * into v_existing from expenses
    where created_by = v_me.id and request_id = p_request_id;
    if found then
      if v_existing.event_id is distinct from p_event_id
        or v_existing.label is distinct from v_label
        or v_existing.amount_cents is distinct from p_amount_cents
        or v_existing.paid_by is distinct from v_paid_by then
        raise exception 'That retry has different expense details. Refresh the party and try again.';
      end if;
      v_id := v_existing.id;
    end if;
  end if;
  if v_id is null then raise exception 'Couldn''t log that expense. Try again.'; end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

revoke all on function public.sp_add_expense(text, uuid, text, int, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.sp_add_expense(text, uuid, text, int, uuid, uuid) to anon;

create or replace function public.sp_add_expense(
  p_device_id text,
  p_event_id uuid,
  p_label text,
  p_amount_cents int,
  p_paid_by uuid
)
returns jsonb language sql volatile security definer set search_path = public, pg_temp as $$
  select public.sp_add_expense(
    p_device_id, p_event_id, p_label, p_amount_cents, p_paid_by, gen_random_uuid()
  );
$$;

revoke all on function public.sp_add_expense(text, uuid, text, int, uuid)
  from public, anon, authenticated;
grant execute on function public.sp_add_expense(text, uuid, text, int, uuid) to anon;

-- Serialize pending claims by pair. This preserves any historical duplicate
-- rows for auditability while preventing every new duplicate, including races.
create or replace function public.sp_guard_pending_settlement()
returns trigger language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'pending' then
    perform pg_advisory_xact_lock(hashtextextended(
      new.event_id::text || ':' || new.from_member::text || ':' || new.to_member::text,
      0
    ));
    -- A concurrent retry of the same client request is a no-op; the RPC reads
    -- and returns the row inserted by the first request.
    if new.request_id is not null and exists (
      select 1 from settlements s
      where s.from_member = new.from_member and s.request_id = new.request_id
        and (tg_op = 'INSERT' or s.id <> new.id)
    ) then
      return null;
    end if;
    if exists (
      select 1 from settlements s
      where s.event_id = new.event_id
        and s.from_member = new.from_member
        and s.to_member = new.to_member
        and s.status = 'pending'
        and (tg_op = 'INSERT' or s.id <> new.id)
    ) then
      raise exception 'A payment to this person is already waiting for confirmation.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists settlements_one_pending_per_pair on public.settlements;
create trigger settlements_one_pending_per_pair
before insert or update of event_id, from_member, to_member, status
on public.settlements
for each row execute function public.sp_guard_pending_settlement();

revoke all on function public.sp_guard_pending_settlement() from public, anon, authenticated;

create or replace function public.sp_create_settlement(
  p_device_id text,
  p_event_id uuid,
  p_to_member uuid,
  p_amount_cents int,
  p_request_id uuid
)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_me members;
  v_receiver members;
  v_existing settlements;
  v_id uuid;
begin
  perform sp_check_device(p_device_id);
  perform 1 from events where id = p_event_id for share;
  if not found then raise exception 'Event not found.'; end if;

  select * into v_me from members
  where event_id = p_event_id and device_id = p_device_id
  for share;
  if not found or v_me.status <> 'active' then raise exception 'You''re not active in this event.'; end if;
  if p_request_id is null then raise exception 'Missing request identity.'; end if;
  perform sp_check_amount(p_amount_cents);
  if p_to_member is null or p_to_member = v_me.id then raise exception 'Pick who you paid.'; end if;

  select * into v_existing from settlements
  where from_member = v_me.id and request_id = p_request_id;
  if found then
    if v_existing.event_id is distinct from p_event_id
      or v_existing.to_member is distinct from p_to_member
      or v_existing.amount_cents is distinct from p_amount_cents then
      raise exception 'That retry has different payment details. Refresh the party and try again.';
    end if;
    return jsonb_build_object('ok', true, 'id', v_existing.id);
  end if;

  select * into v_receiver from members
  where id = p_to_member and event_id = p_event_id
  for share;
  if not found or v_receiver.device_id like 'deleted:%' or v_receiver.device_id like '%:guest:%' then
    raise exception 'They''re not part of this event yet.';
  end if;
  if v_receiver.status <> 'active' and not (
    exists (
      select 1 from expenses x
      where x.event_id = p_event_id and (
        x.paid_by = v_receiver.id or x.created_by = v_receiver.id
        or x.participant_ids @> array[v_receiver.id]
      )
    )
    or exists (
      select 1 from settlements s
      where s.event_id = p_event_id
        and (s.from_member = v_receiver.id or s.to_member = v_receiver.id)
    )
  ) then
    raise exception 'They''re not part of this event yet.';
  end if;
  if exists (
    select 1 from settlements s
    where s.event_id = p_event_id and s.from_member = v_me.id
      and s.to_member = v_receiver.id and s.status = 'pending'
  ) then
    raise exception 'A payment to this person is already waiting for confirmation.';
  end if;

  insert into settlements (
    event_id, from_member, to_member, amount_cents, status, request_id
  )
  values (
    p_event_id, v_me.id, v_receiver.id, p_amount_cents, 'pending', p_request_id
  )
  on conflict (from_member, request_id) where request_id is not null do nothing
  returning id into v_id;
  if v_id is null then
    select * into v_existing from settlements
    where from_member = v_me.id and request_id = p_request_id;
    if found then
      if v_existing.event_id is distinct from p_event_id
        or v_existing.to_member is distinct from p_to_member
        or v_existing.amount_cents is distinct from p_amount_cents then
        raise exception 'That retry has different payment details. Refresh the party and try again.';
      end if;
      v_id := v_existing.id;
    end if;
  end if;
  if v_id is null then raise exception 'Couldn''t record that payment. Try again.'; end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

revoke all on function public.sp_create_settlement(text, uuid, uuid, int, uuid)
  from public, anon, authenticated;
grant execute on function public.sp_create_settlement(text, uuid, uuid, int, uuid) to anon;

create or replace function public.sp_create_settlement(
  p_device_id text,
  p_event_id uuid,
  p_to_member uuid,
  p_amount_cents int
)
returns jsonb language sql volatile security definer set search_path = public, pg_temp as $$
  select public.sp_create_settlement(
    p_device_id, p_event_id, p_to_member, p_amount_cents, gen_random_uuid()
  );
$$;

revoke all on function public.sp_create_settlement(text, uuid, uuid, int)
  from public, anon, authenticated;
grant execute on function public.sp_create_settlement(text, uuid, uuid, int) to anon;

create or replace function public.sp_delete_my_data(p_device_id text)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_member_id uuid;
  v_event_id uuid;
  v_member members;
  v_new_host members;
  v_memberships int := 0;
begin
  perform sp_check_device(p_device_id);

  for v_member_id, v_event_id in
    select id, event_id from members
    where device_id = p_device_id or device_id like p_device_id || ':guest:%'
    order by event_id, (device_id = p_device_id) asc, id
  loop
    -- Event-first locking matches every other mutation. Reload the membership
    -- after waiting so host decisions never use the cursor's stale snapshot.
    perform 1 from events where id = v_event_id for update;
    if not found then continue; end if;
    select * into v_member from members
    where id = v_member_id and event_id = v_event_id
      and (device_id = p_device_id or device_id like p_device_id || ':guest:%')
    for update;
    if not found then continue; end if;

    v_memberships := v_memberships + 1;
    delete from settlements where event_id = v_member.event_id and status = 'pending'
      and (from_member = v_member.id or to_member = v_member.id);

    if v_member.is_host then
      select * into v_new_host
      from members o
      where o.event_id = v_member.event_id and o.id <> v_member.id
        and o.status = 'active' and o.device_id not like '%:guest:%'
      order by o.created_at, o.id
      limit 1
      for update;

      if found then
        -- Clear the old flag first so a one-host partial unique index is safe.
        update members set is_host = false where id = v_member.id;
        update members set is_host = true where id = v_new_host.id;
      else
        -- Personal deletion must never erase somebody else's financial history
        -- or promote an unapproved member. The whole RPC rolls back on this
        -- exception, so the user can approve a successor or explicitly delete
        -- the party from Crew before retrying.
        raise exception 'Approve an active member to take over this party, or delete the party in Crew, then try again.';
      end if;
    end if;

    if exists (
      select 1 from expenses x
      where x.paid_by = v_member.id or x.created_by = v_member.id
        or x.participant_ids @> array[v_member.id]
    ) or exists (
      select 1 from settlements s where s.from_member = v_member.id or s.to_member = v_member.id
    ) then
      update members set
        display_name = 'Departed',
        device_id = 'deleted:' || gen_random_uuid(),
        is_host = false,
        status = case when status in ('active', 'pending') then 'left' else status end
      where id = v_member.id;
    else
      delete from members where id = v_member.id;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'memberships', v_memberships, 'eventsDeleted', 0);
end;
$$;

revoke all on function public.sp_delete_my_data(text)
  from public, anon, authenticated;
grant execute on function public.sp_delete_my_data(text) to anon;

-- Explicit host-owned whole-event deletion. This is intentionally separate
-- from identity deletion and is also the only supported E2E cleanup path.
create or replace function public.sp_delete_event(p_device_id text, p_event_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_me members;
begin
  perform sp_check_device(p_device_id);
  perform 1 from events where id = p_event_id for update;
  if not found then raise exception 'Event not found.'; end if;

  select * into v_me
  from members
  where event_id = p_event_id and device_id = p_device_id
  for update;
  if not found or not v_me.is_host or v_me.status <> 'active' then
    raise exception 'Only the active host can delete this event.';
  end if;

  delete from settlements where event_id = p_event_id;
  delete from expenses where event_id = p_event_id;
  delete from members where event_id = p_event_id;
  delete from events where id = p_event_id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.sp_delete_event(text, uuid) from public, anon, authenticated;
grant execute on function public.sp_delete_event(text, uuid) to anon;

-- Make newly added overloads visible to PostgREST before the web deploy that
-- immediately follows this transaction.
notify pgrst, 'reload schema';
