const Database = require('better-sqlite3');
const path = require('path');

// In production (Fly.io), use /data for persistent storage
// In development, use ./database directory
const dbDir = process.env.NODE_ENV === 'production' ? '/data' : __dirname;
const dbPath = path.join(dbDir, 'tge.db');
const db = new Database(dbPath);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  -- Users table
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'player' CHECK(role IN ('admin', 'player', 'viewer')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Player profiles
  CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE,
    summoner_name TEXT NOT NULL,
    role TEXT CHECK(role IN ('Top', 'Jungle', 'Mid', 'ADC', 'Support')),
    champion_pool TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  -- Match stats from CSV imports
  CREATE TABLE IF NOT EXISTS match_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player TEXT NOT NULL,
    match_date DATE NOT NULL,
    champion TEXT NOT NULL,
    kills INTEGER DEFAULT 0,
    deaths INTEGER DEFAULT 0,
    assists INTEGER DEFAULT 0,
    cs INTEGER DEFAULT 0,
    vision_score INTEGER DEFAULT 0,
    damage INTEGER DEFAULT 0,
    gold INTEGER DEFAULT 0,
    result TEXT CHECK(result IN ('Win', 'Loss', 'win', 'loss'))
  );

  -- Champion notes (per user)
  CREATE TABLE IF NOT EXISTS champion_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    champion_id TEXT NOT NULL,
    notes TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, champion_id)
  );

  -- General notes
  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT,
    category TEXT DEFAULT 'General',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- Team announcements
  CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    author_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- Enemy teams for scouting
  CREATE TABLE IF NOT EXISTS enemy_teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Scouting notes for enemy teams
  CREATE TABLE IF NOT EXISTS scouting_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT,
    category TEXT DEFAULT 'General',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (team_id) REFERENCES enemy_teams(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- Draft images for scouting
  CREATE TABLE IF NOT EXISTS scouting_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    original_name TEXT,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (team_id) REFERENCES enemy_teams(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- Enemy players for scouting (imported from op.gg)
  CREATE TABLE IF NOT EXISTS enemy_players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER NOT NULL,
    game_name TEXT NOT NULL,
    tag_line TEXT NOT NULL,
    region TEXT DEFAULT 'na',
    puuid TEXT,
    role TEXT,
    rank_tier TEXT,
    rank_division TEXT,
    rank_lp INTEGER,
    profile_icon_id INTEGER,
    top_champions TEXT,
    detected_role TEXT,
    last_fetched DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (team_id) REFERENCES enemy_teams(id) ON DELETE CASCADE
  );

  -- Saved drafts linked to enemy teams
  CREATE TABLE IF NOT EXISTS saved_drafts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    blue_picks TEXT NOT NULL,
    red_picks TEXT NOT NULL,
    blue_bans TEXT NOT NULL,
    red_bans TEXT NOT NULL,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (team_id) REFERENCES enemy_teams(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- Team compositions for our team
  CREATE TABLE IF NOT EXISTS team_compositions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    top_champion TEXT,
    jungle_champion TEXT,
    mid_champion TEXT,
    adc_champion TEXT,
    support_champion TEXT,
    tags TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// Add opgg columns to players table if they don't exist
try {
  db.exec(`ALTER TABLE players ADD COLUMN opgg_username TEXT`);
} catch (e) {
  // Column already exists
}
try {
  db.exec(`ALTER TABLE players ADD COLUMN opgg_region TEXT DEFAULT 'na'`);
} catch (e) {
  // Column already exists
}
try {
  db.exec(`ALTER TABLE players ADD COLUMN profile_icon_id INTEGER`);
} catch (e) {
  // Column already exists
}
try {
  db.exec(`ALTER TABLE players ADD COLUMN summoner_level INTEGER`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE players ADD COLUMN rank_tier TEXT`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE players ADD COLUMN rank_division TEXT`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE players ADD COLUMN rank_lp INTEGER`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE players ADD COLUMN rank_wins INTEGER`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE players ADD COLUMN rank_losses INTEGER`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE players ADD COLUMN riot_puuid TEXT`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE players ADD COLUMN riot_data_updated_at DATETIME`);
} catch (e) {}

// Add columns for match history and champion stats (stored as JSON)
try {
  db.exec(`ALTER TABLE players ADD COLUMN recent_matches TEXT`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE players ADD COLUMN champion_stats TEXT`);
} catch (e) {}

// Practice matches tables
db.exec(`
  -- Practice matches (games where 2+ roster members played together)
  CREATE TABLE IF NOT EXISTS practice_matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id TEXT UNIQUE NOT NULL,
    game_creation INTEGER NOT NULL,
    game_duration INTEGER NOT NULL,
    game_mode TEXT,
    winning_team INTEGER,
    roster_player_count INTEGER NOT NULL,
    participants TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Practice player stats (aggregated per-player, per-champion)
  CREATE TABLE IF NOT EXISTS practice_player_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    champion TEXT NOT NULL,
    games INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    kills INTEGER DEFAULT 0,
    deaths INTEGER DEFAULT 0,
    assists INTEGER DEFAULT 0,
    cs INTEGER DEFAULT 0,
    total_damage INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
    UNIQUE(player_id, champion)
  );

  -- Practice settings
  CREATE TABLE IF NOT EXISTS practice_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    auto_pool_threshold INTEGER DEFAULT 3,
    last_scan_at DATETIME,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Initialize practice settings if not exists
try {
  db.prepare('INSERT OR IGNORE INTO practice_settings (id) VALUES (1)').run();
} catch (e) {}

// Add damage taken column to practice_player_stats
try {
  db.exec(`ALTER TABLE practice_player_stats ADD COLUMN total_damage_taken INTEGER DEFAULT 0`);
} catch (e) {}

// Add riot_match_id and source columns to match_stats for auto-import deduplication
try {
  db.exec(`ALTER TABLE match_stats ADD COLUMN riot_match_id TEXT`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE match_stats ADD COLUMN source TEXT DEFAULT 'csv'`);
} catch (e) {}

// Add champion_pool_data column for tiered champion pools (JSON)
try {
  db.exec(`ALTER TABLE players ADD COLUMN champion_pool_data TEXT`);
} catch (e) {}

// Draft flowcharts table
db.exec(`
  CREATE TABLE IF NOT EXISTS draft_flowcharts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (team_id) REFERENCES enemy_teams(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// Add logo column to enemy_teams
try {
  db.exec(`ALTER TABLE enemy_teams ADD COLUMN logo_filename TEXT`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE enemy_teams ADD COLUMN sort_order INTEGER DEFAULT 0`);
} catch (e) {}

console.log('Database initialized successfully');

module.exports = db;
