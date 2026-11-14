-- REHEARSAL STUB of pgmq: real-shaped queue tables, no visibility-timeout semantics.
create schema if not exists pgmq;
create function pgmq.create(queue_name text) returns void language plpgsql as $$
begin
  execute format('create table if not exists pgmq.%I (msg_id bigserial primary key, read_ct int not null default 0,
    enqueued_at timestamptz not null default now(), vt timestamptz not null default now(), message jsonb)', 'q_' || queue_name);
end $$;
create function pgmq.send(queue_name text, msg jsonb) returns bigint language plpgsql as $$
declare id bigint;
begin
  execute format('insert into pgmq.%I(message) values ($1) returning msg_id', 'q_' || queue_name) using msg into id;
  return id;
end $$;
create function pgmq.read(queue_name text, vt integer, qty integer)
returns table(msg_id bigint, read_ct integer, enqueued_at timestamptz, vt timestamptz, message jsonb) language plpgsql as $$
begin
  return query execute format('select msg_id, read_ct, enqueued_at, vt, message from pgmq.%I order by msg_id limit $1', 'q_' || queue_name) using qty;
end $$;
create function pgmq.delete(queue_name text, msg_id bigint) returns boolean language plpgsql as $$
declare n int;
begin
  execute format('delete from pgmq.%I where msg_id = $1', 'q_' || queue_name) using msg_id;
  get diagnostics n = row_count; return n > 0;
end $$;
