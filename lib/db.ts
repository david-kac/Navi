import * as SQLite from 'expo-sqlite';

let _db: SQLite.SQLiteDatabase | null = null;

export function getDb(): SQLite.SQLiteDatabase {
  if (!_db) _db = SQLite.openDatabaseSync('dot.db');
  return _db;
}

export async function initDb(): Promise<void> {
  const db = getDb();

  db.execSync(`
    CREATE TABLE IF NOT EXISTS categories (
      id   TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon TEXT NOT NULL,
      color TEXT
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id               TEXT PRIMARY KEY,
      title            TEXT NOT NULL,
      category_id      TEXT NOT NULL,
      date             TEXT NOT NULL,
      scheduled_time   TEXT,
      duration_minutes INTEGER,
      is_recurring     INTEGER NOT NULL DEFAULT 0,
      recurrence_rule  TEXT,
      is_completed     INTEGER NOT NULL DEFAULT 0,
      time_period      TEXT NOT NULL DEFAULT 'unscheduled',
      is_ttfo          INTEGER NOT NULL DEFAULT 0,
      created_at       TEXT NOT NULL,
      FOREIGN KEY (category_id) REFERENCES categories(id)
    );

    CREATE TABLE IF NOT EXISTS daily_plans (
      date                TEXT PRIMARY KEY,
      locked_at           TEXT,
      dot_greeting_shown  INTEGER NOT NULL DEFAULT 0,
      day_ended_at        TEXT
    );

    CREATE TABLE IF NOT EXISTS training_plan (
      id            TEXT PRIMARY KEY,
      week_number   INTEGER NOT NULL,
      day_of_week   INTEGER NOT NULL,
      workout_type  TEXT NOT NULL,
      target_distance_miles REAL,
      target_duration_mins  INTEGER,
      notes         TEXT
    );

    CREATE TABLE IF NOT EXISTS user_context (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}
