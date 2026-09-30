-- Private application schema; the restricted application role owns its tables.
GRANT petezah_app TO postgres;
SET LOCAL ROLE petezah_app;
SET LOCAL search_path TO petezah, pg_catalog;

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    username TEXT,
    bio TEXT,
    avatar_url TEXT,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
  );

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BIGINT DEFAULT 0;

ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_token TEXT;

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BIGINT DEFAULT 0;

ALTER TABLE users ADD COLUMN IF NOT EXISTS school TEXT;

ALTER TABLE users ADD COLUMN IF NOT EXISTS age BIGINT;

ALTER TABLE users ADD COLUMN IF NOT EXISTS ip TEXT;

ALTER TABLE users ADD COLUMN IF NOT EXISTS banned BIGINT DEFAULT 0;

ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT;

ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT;

ALTER TABLE users ADD COLUMN IF NOT EXISTS location TEXT;

ALTER TABLE users ADD COLUMN IF NOT EXISTS website TEXT;

ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_color TEXT DEFAULT '#4d8dff';

ALTER TABLE users ADD COLUMN IF NOT EXISTS banner_url TEXT;

ALTER TABLE users ADD COLUMN IF NOT EXISTS favorite_music TEXT DEFAULT '[]';

ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_public BIGINT DEFAULT 1;

ALTER TABLE users ADD COLUMN IF NOT EXISTS show_activity BIGINT DEFAULT 1;

ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_expires BIGINT;

ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT;

ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BIGINT DEFAULT 0;

ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_pending_secret TEXT;

ALTER TABLE users ADD COLUMN IF NOT EXISTS showcase_badges TEXT DEFAULT NULL;

CREATE TABLE IF NOT EXISTS changelog (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    author_id TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    FOREIGN KEY (author_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS user_settings (
    user_id TEXT PRIMARY KEY,
    localstorage_data TEXT,
    theme TEXT DEFAULT 'dark',
    updated_at BIGINT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS user_sessions (
    session_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS likes (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    UNIQUE(type, target_id, user_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS uploaded_files (
    id TEXT PRIMARY KEY,
    content_type TEXT NOT NULL,
    content_base64 TEXT NOT NULL,
    created_at BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS banned_ips (
    ip TEXT PRIMARY KEY,
    banned_at BIGINT NOT NULL,
    banned_by TEXT
  );

  CREATE TABLE IF NOT EXISTS announcements (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    active BIGINT DEFAULT 1,
    created_by TEXT,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cap_nonces (
    sig TEXT PRIMARY KEY,
    expires_at BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cap_tokens (
    token_key TEXT PRIMARY KEY,
    expires_at BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS firefox_vm_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    username TEXT,
    day TEXT NOT NULL,
    started_at BIGINT NOT NULL,
    last_seen BIGINT NOT NULL,
    ended_at BIGINT
  );

  CREATE INDEX IF NOT EXISTS idx_ffvm_day ON firefox_vm_sessions(day);
  CREATE INDEX IF NOT EXISTS idx_ffvm_started ON firefox_vm_sessions(started_at);
  CREATE INDEX IF NOT EXISTS idx_ffvm_user ON firefox_vm_sessions(user_id);

  CREATE TABLE IF NOT EXISTS link_claims (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    blocker TEXT NOT NULL,
    link TEXT NOT NULL,
    claimed_at BIGINT NOT NULL,
    week_start BIGINT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_link_claims_user_week ON link_claims(user_id, week_start);
  CREATE INDEX IF NOT EXISTS idx_link_claims_claimed ON link_claims(claimed_at);
  CREATE INDEX IF NOT EXISTS idx_link_claims_blocker ON link_claims(blocker, claimed_at);

  CREATE TABLE IF NOT EXISTS game_plays (
    game_id TEXT PRIMARY KEY,
    label TEXT,
    image_url TEXT,
    plays BIGINT NOT NULL DEFAULT 0,
    last_played_at BIGINT
  );

  CREATE INDEX IF NOT EXISTS idx_game_plays_plays ON game_plays(plays DESC);

  CREATE TABLE IF NOT EXISTS user_game_plays (
    user_id TEXT NOT NULL,
    game_id TEXT NOT NULL,
    plays BIGINT NOT NULL DEFAULT 0,
    last_played_at BIGINT,
    PRIMARY KEY (user_id, game_id)
  );

  CREATE TABLE IF NOT EXISTS user_stats (
    user_id TEXT PRIMARY KEY,
    time_ms BIGINT NOT NULL DEFAULT 0,
    games_played BIGINT NOT NULL DEFAULT 0,
    unique_games BIGINT NOT NULL DEFAULT 0,
    vm_sessions BIGINT NOT NULL DEFAULT 0,
    last_heartbeat BIGINT,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_achievements (
    user_id TEXT NOT NULL,
    achievement_id TEXT NOT NULL,
    unlocked_at BIGINT NOT NULL,
    PRIMARY KEY (user_id, achievement_id)
  );

  CREATE TABLE IF NOT EXISTS user_proxy_hosts (
    user_id TEXT NOT NULL,
    host TEXT NOT NULL,
    PRIMARY KEY (user_id, host)
  );

  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  CREATE INDEX IF NOT EXISTS idx_users_ip ON users(ip);
  CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
  CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at);
  CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON user_sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON user_sessions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_cap_nonces_exp ON cap_nonces(expires_at);
  CREATE INDEX IF NOT EXISTS idx_cap_tokens_exp ON cap_tokens(expires_at);

ALTER TABLE user_stats ADD COLUMN IF NOT EXISTS ai_messages BIGINT NOT NULL DEFAULT 0;

ALTER TABLE user_stats ADD COLUMN IF NOT EXISTS chat_messages BIGINT NOT NULL DEFAULT 0;

ALTER TABLE user_stats ADD COLUMN IF NOT EXISTS proxy_hosts BIGINT NOT NULL DEFAULT 0;

ALTER TABLE user_stats ADD COLUMN IF NOT EXISTS bookmarks BIGINT NOT NULL DEFAULT 0;

ALTER TABLE user_stats ADD COLUMN IF NOT EXISTS playlists BIGINT NOT NULL DEFAULT 0;

ALTER TABLE user_stats ADD COLUMN IF NOT EXISTS profile_views BIGINT NOT NULL DEFAULT 0;

ALTER TABLE user_stats ADD COLUMN IF NOT EXISTS streak_days BIGINT NOT NULL DEFAULT 0;

ALTER TABLE user_stats ADD COLUMN IF NOT EXISTS last_active_day TEXT;

ALTER TABLE announcements ADD COLUMN IF NOT EXISTS target_user_id TEXT;

ALTER TABLE announcements ADD COLUMN IF NOT EXISTS target_ips TEXT;

ALTER TABLE announcements ADD COLUMN IF NOT EXISTS important BIGINT DEFAULT 0;

CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      actor_id TEXT,
      ref_type TEXT NOT NULL,
      ref_id TEXT NOT NULL,
      body TEXT,
      created_at BIGINT NOT NULL,
      read BIGINT NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, read);

CREATE TABLE IF NOT EXISTS ad_events (
      id BIGSERIAL PRIMARY KEY ,
      ts BIGINT NOT NULL,
      day TEXT NOT NULL,
      hour BIGINT NOT NULL,
      kind TEXT NOT NULL,
      context TEXT NOT NULL,
      visitor TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ad_events_day_kind ON ad_events(day, kind);
    CREATE INDEX IF NOT EXISTS idx_ad_events_ts ON ad_events(ts);
    CREATE INDEX IF NOT EXISTS idx_ad_events_visitor_day ON ad_events(visitor, day);

CREATE TABLE IF NOT EXISTS ai_conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      preview TEXT NOT NULL,
      messages_json TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_ai_convos_user_updated ON ai_conversations(user_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS ai_prompt_samples (
      id TEXT PRIMARY KEY,
      preview TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ai_prompts_created ON ai_prompt_samples(created_at DESC);

    CREATE TABLE IF NOT EXISTS ai_conversation_shares (
      token TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      revoked BIGINT NOT NULL DEFAULT 0,
      FOREIGN KEY (conversation_id) REFERENCES ai_conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_ai_shares_convo ON ai_conversation_shares(conversation_id);

CREATE TABLE IF NOT EXISTS game_exclusions (
      game_id TEXT PRIMARY KEY,
      label TEXT,
      image_url TEXT,
      excluded_at BIGINT NOT NULL,
      excluded_by TEXT
    );

    CREATE TABLE IF NOT EXISTS game_global_adds (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      url TEXT NOT NULL,
      image_url TEXT,
      categories TEXT NOT NULL DEFAULT '[]',
      created_at BIGINT NOT NULL,
      created_by TEXT
    );

    CREATE TABLE IF NOT EXISTS game_overrides (
      game_id TEXT PRIMARY KEY,
      label TEXT,
      url TEXT,
      image_url TEXT,
      categories TEXT,
      updated_at BIGINT NOT NULL,
      updated_by TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_game_exclusions_at ON game_exclusions(excluded_at DESC);
    CREATE INDEX IF NOT EXISTS idx_game_global_adds_at ON game_global_adds(created_at DESC);

ALTER TABLE game_global_adds ADD COLUMN IF NOT EXISTS via TEXT NOT NULL DEFAULT 've';

ALTER TABLE game_overrides ADD COLUMN IF NOT EXISTS via TEXT;

CREATE TABLE IF NOT EXISTS usage_daily (
      day TEXT NOT NULL,
      metric TEXT NOT NULL,
      count BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY (day, metric)
    );

CREATE TABLE IF NOT EXISTS sessions (sid TEXT NOT NULL PRIMARY KEY, sess TEXT NOT NULL, expire TEXT NOT NULL);

RESET ROLE;
REVOKE petezah_app FROM postgres;
