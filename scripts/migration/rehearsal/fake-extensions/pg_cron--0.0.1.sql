-- REHEARSAL STUB of pg_cron: job table + schedule/unschedule only, no scheduler.
create schema if not exists cron;
create table cron.job (jobid bigserial primary key, schedule text not null, command text not null,
  nodename text default 'localhost', nodeport int default 5432, database text default current_database(),
  username text default current_user, active boolean default true, jobname text unique);
create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $$
  insert into cron.job(jobname, schedule, command) values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid $$;
create function cron.unschedule(job_name text) returns boolean language sql as $$
  with d as (delete from cron.job where jobname = job_name returning 1) select exists(select 1 from d) $$;
-- like real pg_cron, job rows are included in pg_dump output
select pg_catalog.pg_extension_config_dump('cron.job', '');
create function cron.alter_job(job_id bigint, schedule text default null, command text default null,
  database text default null, username text default null, active boolean default null) returns void language sql as $$
  update cron.job set schedule = coalesce(alter_job.schedule, job.schedule), command = coalesce(alter_job.command, job.command),
    active = coalesce(alter_job.active, job.active) where jobid = job_id $$;
