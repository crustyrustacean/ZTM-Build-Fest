// src/database/sqlite.rs

use crate::configuration::DatabaseSettings;
use crate::database::{DatabaseBackend, DatabaseError};
use crate::domain::{NewRotationEntry, RotationEntry};
use anyhow::Context;
use async_trait::async_trait;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::{FromRow, SqlitePool};
use std::str::FromStr;

/// What a row looks like coming out of SQLite. Mirrors the migration exactly:
/// `id` INTEGER, dates ISO-8601 TEXT (sqlx chrono feature), optional columns
/// NULLable — the same NULL-for-`Option` translation metallian-photos uses.
#[derive(Debug, FromRow)]
struct RotationEntryRow {
    id: i64,
    listened_date: chrono::NaiveDate,
    artist: String,
    album: String,
    cover: Option<String>,
    year: Option<i32>,
    note: Option<String>,
}

impl From<RotationEntryRow> for RotationEntry {
    fn from(row: RotationEntryRow) -> Self {
        // Ids are rowids: small, positive, monotonic. A value that does not
        // fit in u64 is corruption rather than a corner case, so it fails
        // loudly instead of wrapping.
        let id = u64::try_from(row.id).expect("rotation entry id overflowed u64");
        RotationEntry {
            id,
            listened_date: row.listened_date,
            artist: row.artist,
            album: row.album,
            cover: row.cover,
            year: row.year,
            note: row.note,
        }
    }
}

#[derive(Debug, Clone)]
pub struct SqliteRepository {
    pool: SqlitePool,
}

impl SqliteRepository {
    pub async fn new(db_configuration: &DatabaseSettings) -> Result<Self, anyhow::Error> {
        let db_path = format!("sqlite:{}", db_configuration.path);
        let mut pool_opts = SqlitePoolOptions::new();
        if let Some(max) = db_configuration.max_connections {
            pool_opts = pool_opts.max_connections(max);
        }
        let options = SqliteConnectOptions::from_str(&db_path)?
            .create_if_missing(true)
            // WAL: readers (the blog island's GETs) do not block the writer (a
            // form POST), and a crash between commit and checkpoint loses
            // nothing that was acknowledged.
            .journal_mode(SqliteJournalMode::Wal);
        let pool = pool_opts.connect_with(options).await?;

        // Embedded at compile time: a fresh database is migrated to head on
        // first contact, and an existing one is verified against it.
        sqlx::migrate!("./migrations").run(&pool).await?;

        Ok(Self { pool })
    }
}

#[async_trait]
impl DatabaseBackend for SqliteRepository {
    async fn insert(&self, entry: NewRotationEntry) -> Result<RotationEntry, DatabaseError> {
        let result = sqlx::query(
            "INSERT INTO rotation_entries (listened_date, artist, album, cover, year, note) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )
        .bind(entry.listened_date)
        .bind(&entry.artist)
        .bind(&entry.album)
        .bind(&entry.cover)
        .bind(entry.year)
        .bind(&entry.note)
        .execute(&self.pool)
        .await
        .context("failed to insert rotation entry")?;

        let id = u64::try_from(result.last_insert_rowid())
            .context("inserted rotation entry id overflowed u64")?;

        Ok(RotationEntry {
            id,
            listened_date: entry.listened_date,
            artist: entry.artist,
            album: entry.album,
            cover: entry.cover,
            year: entry.year,
            note: entry.note,
        })
    }

    async fn list(&self) -> Result<Vec<RotationEntry>, DatabaseError> {
        let rows = sqlx::query_as::<_, RotationEntryRow>(
            "SELECT id, listened_date, artist, album, cover, year, note \
             FROM rotation_entries ORDER BY id",
        )
        .fetch_all(&self.pool)
        .await
        .context("failed to list rotation entries")?;

        Ok(rows.into_iter().map(Into::into).collect())
    }

    async fn random(&self) -> Result<RotationEntry, DatabaseError> {
        let row = sqlx::query_as::<_, RotationEntryRow>(
            "SELECT id, listened_date, artist, album, cover, year, note \
             FROM rotation_entries ORDER BY RANDOM() LIMIT 1",
        )
        .fetch_optional(&self.pool)
        .await
        .context("failed to draw a random rotation entry")?
        .ok_or(DatabaseError::NotFound)?;

        Ok(row.into())
    }
}
