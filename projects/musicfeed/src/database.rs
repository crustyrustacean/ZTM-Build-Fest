// src/database.rs
//
// Persistence boundary for the rotation, borrowed in shape from the
// metallian-photos database layer: a backend trait the app codes against, and
// a SQLite implementation behind it. This module knows nothing about HTTP —
// errors map onto axum responses at the route layer; here a miss is just a
// `NotFound` and everything else is an `Operation`.

use crate::domain::{NewRotationEntry, RotationEntry};
use crate::utils::error_chain_fmt;
use async_trait::async_trait;

pub mod sqlite;

pub use sqlite::*;

#[derive(thiserror::Error)]
pub enum DatabaseError {
    #[error("record not found")]
    NotFound,
    #[error(transparent)]
    Operation(#[from] anyhow::Error),
}

impl std::fmt::Debug for DatabaseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        error_chain_fmt(self, f)
    }
}

/// The storage boundary. Routes depend on this trait, never on SQLite
/// directly, so the backend can change without touching the HTTP layer — and
/// so tests can stand up a real store against a throwaway file.
///
/// Expansion seam: tracking listening habits later means adding methods here
/// (`record_play`, `top_artists`, ...) and one migration for an events table.
/// Nothing below needs to change shape for that.
#[async_trait]
pub trait DatabaseBackend: Send + Sync {
    /// Store a new entry. The id is assigned here — the database is the
    /// counter — and the stored entry, id included, is returned.
    async fn insert(&self, entry: NewRotationEntry) -> Result<RotationEntry, DatabaseError>;

    /// Every entry, oldest first (id order). Backs the index page.
    async fn list(&self) -> Result<Vec<RotationEntry>, DatabaseError>;

    /// One uniformly-random entry. `NotFound` when the store is empty: the
    /// empty-rotation 404 contract lives here now, not in the route.
    async fn random(&self) -> Result<RotationEntry, DatabaseError>;
}
