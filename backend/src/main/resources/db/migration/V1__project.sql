CREATE TABLE project (
    id         UUID PRIMARY KEY,
    owner_sub  VARCHAR(255) NOT NULL,
    name       VARCHAR(255) NOT NULL,
    home       JSONB        NOT NULL,
    thumbnail  BYTEA,
    created_at TIMESTAMPTZ  NOT NULL,
    updated_at TIMESTAMPTZ  NOT NULL,
    version    BIGINT       NOT NULL
);

CREATE INDEX project_owner_idx ON project (owner_sub, updated_at DESC);
