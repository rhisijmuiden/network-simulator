/** Forward-only database migrations. Never change a released migration: add a new one. */
export const migrations: { version: number; name: string; up: string }[] = [
  {
    version: 1,
    name: "foundation",
    up: `
      CREATE TABLE users (
        id serial PRIMARY KEY,
        username text NOT NULL UNIQUE,
        display_name text NOT NULL DEFAULT '',
        email text NOT NULL DEFAULT '',
        password_hash text NOT NULL,
        role text NOT NULL CHECK (role IN ('admin', 'instructor', 'student')),
        language text NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'nl')),
        must_change_password boolean NOT NULL DEFAULT false,
        disabled boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        last_login_at timestamptz
      );

      CREATE TABLE sessions (
        id text PRIMARY KEY,
        user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL,
        ip text NOT NULL DEFAULT '',
        user_agent text NOT NULL DEFAULT ''
      );
      CREATE INDEX sessions_user_idx ON sessions(user_id);

      CREATE TABLE settings (
        key text PRIMARY KEY,
        value jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE audit_log (
        id bigserial PRIMARY KEY,
        at timestamptz NOT NULL DEFAULT now(),
        user_id integer REFERENCES users(id) ON DELETE SET NULL,
        username text NOT NULL DEFAULT '',
        action text NOT NULL,
        detail jsonb NOT NULL DEFAULT '{}',
        ip text NOT NULL DEFAULT ''
      );
      CREATE INDEX audit_log_at_idx ON audit_log(at DESC);

      CREATE TABLE backup_locations (
        id serial PRIMARY KEY,
        name text NOT NULL,
        type text NOT NULL CHECK (type IN ('ftp', 'ftps', 'scp')),
        host text NOT NULL,
        port integer NOT NULL,
        username text NOT NULL DEFAULT '',
        secret text NOT NULL DEFAULT '',
        path text NOT NULL DEFAULT '',
        options jsonb NOT NULL DEFAULT '{}',
        enabled boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE backup_runs (
        id bigserial PRIMARY KEY,
        location_id integer REFERENCES backup_locations(id) ON DELETE SET NULL,
        location_name text NOT NULL DEFAULT '',
        kind text NOT NULL CHECK (kind IN ('full', 'incremental')),
        trigger text NOT NULL DEFAULT 'manual',
        status text NOT NULL CHECK (status IN ('running', 'success', 'failed')),
        backup_id text NOT NULL DEFAULT '',
        chain_id text NOT NULL DEFAULT '',
        bytes_total bigint NOT NULL DEFAULT 0,
        bytes_uploaded bigint NOT NULL DEFAULT 0,
        message text NOT NULL DEFAULT '',
        started_at timestamptz NOT NULL DEFAULT now(),
        finished_at timestamptz
      );
      CREATE INDEX backup_runs_started_idx ON backup_runs(started_at DESC);
    `,
  },
];
