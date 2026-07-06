-- Applied to the live project on 2026-07-06 (as `client_rpcs_and_rls_lockdown`
-- + `delete_my_data_guest_order`). Kept in-repo as the source of record.
--
-- Moves all app logic into SECURITY DEFINER RPCs so the Capacitor/static
-- client talks to Postgres directly without ever seeing other members'
-- device_ids. Tables become inaccessible to the anon role; the RPCs are the
-- only door.

drop policy if exists server_all_events on events;
drop policy if exists server_all_members on members;
drop policy if exists server_all_expenses on expenses;
drop policy if exists server_all_settlements on settlements;
revoke all on all tables in schema public from anon, authenticated;

create or replace function sp_clean_name(p_input text, p_max int)
returns text language sql immutable as $$
  select case
    when p_input is null then null
    when char_length(btrim(regexp_replace(p_input, '\s+', ' ', 'g'))) between 1 and p_max
      then btrim(regexp_replace(p_input, '\s+', ' ', 'g'))
    else null
  end;
$$;

create or replace function sp_check_device(p_device_id text)
returns void language plpgsql immutable as $$
begin
  if p_device_id is null or p_device_id !~ '^[A-Za-z0-9-]{10,64}$' then
    raise exception 'Missing device identity.';
  end if;
end;
$$;

create or replace function sp_check_amount(p_cents int)
returns void language plpgsql immutable as $$
begin
  if p_cents is null or p_cents <= 0 or p_cents > 100000000 then
    raise exception 'Enter a real amount.';
  end if;
end;
$$;

create or replace function sp_member_for(p_event_id uuid, p_device_id text)
returns members language sql stable security definer set search_path = public, pg_temp as $$
  select * from members where event_id = p_event_id and device_id = p_device_id;
$$;

-- No 0/O, 1/I/L: codes get read out loud across a noisy room.
create or replace function sp_new_code()
returns text language sql volatile as $$
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', (floor(random()*31))::int + 1, 1), '')
  from generate_series(1, 5);
$$;

create or replace function sp_create_event(p_device_id text, p_event_name text, p_display_name text)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_name text := sp_clean_name(p_event_name, 60);
  v_display text := sp_clean_name(p_display_name, 40);
  v_event events;
begin
  perform sp_check_device(p_device_id);
  if v_name is null then raise exception 'Give the event a name.'; end if;
  if v_display is null then raise exception 'Tell us what to call you.'; end if;

  for i in 1..6 loop
    begin
      insert into events (name, code) values (v_name, sp_new_code()) returning * into v_event;
      exit;
    exception when unique_violation then
      if i = 6 then raise exception 'Couldn''t create the event. Try again.'; end if;
    end;
  end loop;

  insert into members (event_id, device_id, display_name, is_host, status)
  values (v_event.id, p_device_id, v_display, true, 'active');

  return jsonb_build_object('eventId', v_event.id, 'code', v_event.code);
end;
$$;

-- Solo-review path: an active HOST who joins their own event under a different
-- name spawns a separate pending "guest" member (device_id gets a suffix so the
-- unique constraint holds). Lets one person exercise the whole approval flow.
create or replace function sp_join_event(p_device_id text, p_code text, p_display_name text)
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

  select * into v_event from events where code = v_code;
  if not found then raise exception 'No party with that code. Check it and try again.'; end if;

  select * into v_existing from members where event_id = v_event.id and device_id = p_device_id;

  if not found then
    insert into members (event_id, device_id, display_name, status)
    values (v_event.id, p_device_id, v_display, 'pending');
    return jsonb_build_object('eventId', v_event.id, 'status', 'pending');
  end if;

  if v_existing.status = 'active' then
    if v_existing.is_host and lower(v_display) <> lower(v_existing.display_name) then
      insert into members (event_id, device_id, display_name, status)
      values (v_event.id, p_device_id || ':guest:' || substr(md5(random()::text), 1, 8), v_display, 'pending');
      return jsonb_build_object('eventId', v_event.id, 'status', 'pending', 'guest', true);
    end if;
    return jsonb_build_object('eventId', v_event.id, 'status', 'active');
  end if;

  -- Pending, left, removed, or denied: (re)ask the host on the same member row
  -- so any confirmed history reconnects to the same person.
  update members set status = 'pending', display_name = v_display where id = v_existing.id;
  return jsonb_build_object('eventId', v_event.id, 'status', 'pending');
end;
$$;

create or replace function sp_my_events(p_device_id text)
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
      'activeCount', (select count(*) from members a where a.event_id = m.event_id and a.status = 'active'),
      'totalSpentCents', coalesce((select sum(x.amount_cents) from expenses x where x.event_id = m.event_id), 0),
      'pendingForMe', (select count(*) from settlements s where s.to_member = m.id and s.status = 'pending')
    ) order by m.created_at desc)
    from members m join events e on e.id = m.event_id
    where m.device_id = p_device_id and m.status in ('active', 'pending')
  ), '[]'::jsonb);
end;
$$;

-- Returns {notMember:true} instead of raising so the client can show the
-- "you're not in this one" screen without string-matching errors.
create or replace function sp_event_state(p_device_id text, p_event_id uuid)
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
    -- Outside the room you see nothing financial, except payments waiting on
    -- YOUR confirmation, so someone who left can still close out their ledger.
    return jsonb_build_object(
      'restricted', true,
      'event', jsonb_build_object('id', v_event.id, 'name', v_event.name),
      'me', jsonb_build_object('memberId', v_me.id, 'name', v_me.display_name, 'isHost', v_me.is_host, 'status', v_me.status),
      'hostName', coalesce((select display_name from members where event_id = p_event_id and is_host limit 1), 'the host'),
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
      select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.display_name, 'isHost', m.is_host, 'status', m.status, 'joinedAt', m.created_at) order by m.created_at)
      from members m where m.event_id = p_event_id
    ), '[]'::jsonb),
    'expenses', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'label', x.label, 'amountCents', x.amount_cents, 'paidBy', x.paid_by, 'createdBy', x.created_by, 'createdAt', x.created_at) order by x.created_at desc)
      from expenses x where x.event_id = p_event_id
    ), '[]'::jsonb),
    'settlements', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'from', s.from_member, 'to', s.to_member, 'amountCents', s.amount_cents, 'status', s.status, 'createdAt', s.created_at, 'resolvedAt', s.resolved_at) order by s.created_at desc)
      from settlements s where s.event_id = p_event_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function sp_add_expense(p_device_id text, p_event_id uuid, p_label text, p_amount_cents int, p_paid_by uuid)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_me members;
  v_label text := sp_clean_name(p_label, 80);
  v_paid_by uuid;
  v_id uuid;
begin
  perform sp_check_device(p_device_id);
  select * into v_me from members where event_id = p_event_id and device_id = p_device_id;
  if not found or v_me.status <> 'active' then raise exception 'You''re not active in this event.'; end if;
  if v_label is null then raise exception 'What was it? Give it a name.'; end if;
  perform sp_check_amount(p_amount_cents);

  v_paid_by := coalesce(p_paid_by, v_me.id);
  if v_paid_by <> v_me.id and not exists (
    select 1 from members where id = v_paid_by and event_id = p_event_id and status = 'active'
  ) then
    raise exception 'That payer isn''t active in this event.';
  end if;

  insert into expenses (event_id, paid_by, created_by, label, amount_cents)
  values (p_event_id, v_paid_by, v_me.id, v_label, p_amount_cents)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function sp_create_settlement(p_device_id text, p_event_id uuid, p_to_member uuid, p_amount_cents int)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_me members;
  v_receiver members;
  v_id uuid;
begin
  perform sp_check_device(p_device_id);
  select * into v_me from members where event_id = p_event_id and device_id = p_device_id;
  if not found or v_me.status <> 'active' then raise exception 'You''re not active in this event.'; end if;
  perform sp_check_amount(p_amount_cents);
  if p_to_member is null or p_to_member = v_me.id then raise exception 'Pick who you paid.'; end if;

  select * into v_receiver from members where id = p_to_member and event_id = p_event_id;
  -- You can pay back someone who already left; their ledger line survives
  -- until it's square. Only never-approved members are off the table.
  if not found or v_receiver.status in ('pending', 'denied') then
    raise exception 'They''re not part of this event yet.';
  end if;

  insert into settlements (event_id, from_member, to_member, amount_cents, status)
  values (p_event_id, v_me.id, v_receiver.id, p_amount_cents, 'pending')
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function sp_resolve_settlement(p_device_id text, p_event_id uuid, p_settlement_id uuid, p_action text)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_me members;
  v_count int;
begin
  perform sp_check_device(p_device_id);
  select * into v_me from members where event_id = p_event_id and device_id = p_device_id;
  if not found then raise exception 'You''re not in this event.'; end if;

  -- Every branch guards on status='pending' so a double-tap or a race between
  -- two phones resolves to exactly one outcome.
  if p_action in ('confirm', 'reject') then
    update settlements set
      status = case when p_action = 'confirm' then 'confirmed' else 'rejected' end,
      resolved_at = now()
    where id = p_settlement_id and event_id = p_event_id and to_member = v_me.id and status = 'pending';
    get diagnostics v_count = row_count;
    if v_count = 0 then raise exception 'Already handled, or not yours to confirm.'; end if;
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'cancel' then
    delete from settlements
    where id = p_settlement_id and event_id = p_event_id and from_member = v_me.id and status = 'pending';
    get diagnostics v_count = row_count;
    if v_count = 0 then raise exception 'Already handled.'; end if;
    return jsonb_build_object('ok', true);
  end if;

  raise exception 'Unknown action.';
end;
$$;

create or replace function sp_member_action(p_device_id text, p_event_id uuid, p_member_id uuid, p_action text)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_me members;
  v_target members;
  v_count int;
begin
  perform sp_check_device(p_device_id);
  select * into v_me from members where event_id = p_event_id and device_id = p_device_id;
  if not found then raise exception 'You''re not in this event.'; end if;

  select * into v_target from members where id = p_member_id and event_id = p_event_id;
  if not found then raise exception 'No such member.'; end if;

  if p_action in ('approve', 'deny') then
    if not v_me.is_host or v_me.status <> 'active' then raise exception 'Only the host can do that.'; end if;
    update members set status = case when p_action = 'approve' then 'active' else 'denied' end
    where id = v_target.id and status = 'pending';
    get diagnostics v_count = row_count;
    if v_count = 0 then raise exception 'Already handled.'; end if;
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'remove' then
    if not v_me.is_host or v_me.status <> 'active' then raise exception 'Only the host can do that.'; end if;
    if v_target.is_host then raise exception 'The host can''t be removed.'; end if;
    update members set status = 'removed' where id = v_target.id and status = 'active';
    get diagnostics v_count = row_count;
    if v_count = 0 then raise exception 'Already handled.'; end if;
    -- Their unconfirmed claims go; their paid expenses and confirmed history stay.
    delete from settlements where event_id = p_event_id and status = 'pending'
      and (from_member = v_target.id or to_member = v_target.id);
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'leave' then
    if v_target.id <> v_me.id then raise exception 'You can only remove yourself.'; end if;
    if v_me.is_host then raise exception 'Hosts can''t leave their own party, it would strand everyone.'; end if;
    if v_me.status not in ('active', 'pending') then raise exception 'You''re already out.'; end if;
    update members set status = 'left' where id = v_me.id;
    delete from settlements where event_id = p_event_id and status = 'pending'
      and (from_member = v_me.id or to_member = v_me.id);
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'rerequest' then
    if v_target.id <> v_me.id then raise exception 'Not yours.'; end if;
    if v_me.status not in ('left', 'removed', 'denied') then raise exception 'Nothing to re-request.'; end if;
    update members set status = 'pending' where id = v_me.id;
    return jsonb_build_object('ok', true);
  end if;

  raise exception 'Unknown action.';
end;
$$;

-- App Store data-deletion path. Wipes this device's identity server-side:
-- solo events it hosts disappear entirely; memberships that other people's
-- ledgers still reference are anonymized (name + device id scrubbed), the
-- rest are deleted outright. Pending claims involving the device vanish.
-- Spawned guest identities are processed before the primary identity so a
-- solo reviewer party deletes completely instead of leaving a husk.
create or replace function sp_delete_my_data(p_device_id text)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_member record;
  v_events_deleted int := 0;
  v_memberships int := 0;
begin
  perform sp_check_device(p_device_id);

  for v_member in
    select * from members
    where device_id = p_device_id or device_id like p_device_id || ':guest:%'
    order by (device_id = p_device_id) asc
  loop
    v_memberships := v_memberships + 1;

    delete from settlements where event_id = v_member.event_id and status = 'pending'
      and (from_member = v_member.id or to_member = v_member.id);

    if v_member.is_host and not exists (
      select 1 from members o
      where o.event_id = v_member.event_id and o.id <> v_member.id
        and (o.status in ('active', 'pending')
          or exists (select 1 from expenses x where x.event_id = o.event_id and (x.paid_by = o.id or x.created_by = o.id))
          or exists (select 1 from settlements s where s.event_id = o.event_id and (s.from_member = o.id or s.to_member = o.id)))
    ) then
      delete from settlements where event_id = v_member.event_id;
      delete from expenses where event_id = v_member.event_id;
      delete from members where event_id = v_member.event_id;
      delete from events where id = v_member.event_id;
      v_events_deleted := v_events_deleted + 1;
      continue;
    end if;

    if exists (select 1 from expenses x where x.paid_by = v_member.id or x.created_by = v_member.id)
       or exists (select 1 from settlements s where s.from_member = v_member.id or s.to_member = v_member.id) then
      update members set
        display_name = 'Departed',
        device_id = 'deleted:' || gen_random_uuid(),
        status = case when status in ('active', 'pending') then 'left' else status end
      where id = v_member.id;
    else
      delete from members where id = v_member.id;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'memberships', v_memberships, 'eventsDeleted', v_events_deleted);
end;
$$;

revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function
  sp_create_event(text, text, text),
  sp_join_event(text, text, text),
  sp_my_events(text),
  sp_event_state(text, uuid),
  sp_add_expense(text, uuid, text, int, uuid),
  sp_create_settlement(text, uuid, uuid, int),
  sp_resolve_settlement(text, uuid, uuid, text),
  sp_member_action(text, uuid, uuid, text),
  sp_delete_my_data(text)
to anon;
