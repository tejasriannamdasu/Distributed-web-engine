CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS crawl_jobs (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name          TEXT NOT NULL,
    seed_urls     TEXT[] NOT NULL,
    max_depth     INT  NOT NULL DEFAULT 3,
    max_pages     INT  NOT NULL DEFAULT 10000,
    priority      INT  NOT NULL DEFAULT 5,
    config        JSONB NOT NULL DEFAULT '{}',
    status        TEXT NOT NULL DEFAULT 'pending',
    pages_crawled INT  NOT NULL DEFAULT 0,
    pages_failed  INT  NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at    TIMESTAMPTZ,
    completed_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS pages (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id          UUID REFERENCES crawl_jobs(id) ON DELETE CASCADE,
    url             TEXT NOT NULL,
    canonical_url   TEXT,
    domain          TEXT NOT NULL,
    depth           INT  NOT NULL DEFAULT 0,
    status_code     INT,
    content_type    TEXT,
    content_length  BIGINT,
    title           TEXT,
    description     TEXT,
    body_text       TEXT,
    links_out       TEXT[],
    crawled_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    crawl_duration_ms INT,
    worker_id       TEXT
);

CREATE TABLE IF NOT EXISTS workers (
    id              TEXT PRIMARY KEY,
    hostname        TEXT NOT NULL,
    pid             INT,
    status          TEXT NOT NULL DEFAULT 'idle',
    urls_crawled    BIGINT NOT NULL DEFAULT 0,
    errors          BIGINT NOT NULL DEFAULT 0,
    last_heartbeat  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS crawl_errors (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id      UUID REFERENCES crawl_jobs(id) ON DELETE CASCADE,
    url         TEXT NOT NULL,
    error_type  TEXT NOT NULL,
    error_msg   TEXT,
    worker_id   TEXT,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE VIEW job_progress AS
SELECT
    j.id, j.name, j.status, j.priority,
    j.pages_crawled, j.pages_failed, j.max_pages,
    j.created_at, j.started_at, j.completed_at
FROM crawl_jobs j;
