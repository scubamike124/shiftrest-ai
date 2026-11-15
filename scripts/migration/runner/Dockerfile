# One-off migration runner for Railway (or any Docker host with outbound
# PostgreSQL access). PostgreSQL 17 client tools read Lovable's zstd exports.
# Build context: repository root.  Railway: set this service's config file to
# scripts/migration/runner/railway.json. It runs once and exits.
FROM postgres:17-bookworm
RUN apt-get update \
 && apt-get install -y --no-install-recommends nodejs ca-certificates curl unzip \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /kit
COPY scripts/migration/ /kit/scripts/migration/
COPY supabase/migrations/ /kit/supabase/migrations/
USER postgres
ENTRYPOINT ["bash", "/kit/scripts/migration/runner/run-job.sh"]
