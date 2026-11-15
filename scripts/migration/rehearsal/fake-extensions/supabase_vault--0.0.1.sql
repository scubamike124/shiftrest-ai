-- REHEARSAL STUB of supabase_vault: stores PLAIN TEXT. Rehearsal data only.
create schema if not exists vault;
create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, description text default '',
  secret text not null, created_at timestamptz default now(), updated_at timestamptz default now());
create view vault.decrypted_secrets as select id, name, description, secret, secret as decrypted_secret, created_at, updated_at from vault.secrets;
create function vault.create_secret(new_secret text, new_name text default null, new_description text default '') returns uuid language sql as $$
  insert into vault.secrets(secret, name, description) values (new_secret, new_name, new_description) returning id $$;
create function vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null, new_description text default null) returns void language sql as $$
  update vault.secrets set secret = coalesce(new_secret, secret), name = coalesce(new_name, name),
    description = coalesce(new_description, description), updated_at = now() where id = secret_id $$;
-- like real supabase_vault, secret rows (encrypted there) are included in pg_dump output
select pg_catalog.pg_extension_config_dump('vault.secrets', '');
