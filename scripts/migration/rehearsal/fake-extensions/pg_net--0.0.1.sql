-- REHEARSAL STUB of pg_net: records requests, never sends them.
create schema if not exists net;
create table net.http_request_queue (id bigserial primary key, url text, headers jsonb, body jsonb, created_at timestamptz default now());
create function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
  headers jsonb default '{}'::jsonb, timeout_milliseconds int default 5000) returns bigint language sql as $$
  insert into net.http_request_queue(url, headers, body) values (url, headers, body) returning id $$;
