// tests/api/database.rs
//
// CRUD suite for the SQLite store, mirroring the metallian-photos
// tests/api/database/ shape. These ran RED first: the module they exercise did
// not exist when they were written, and every assertion below was chosen to
// encode a behaviour the in-memory state could not guarantee (persistence
// across reopen, monotonic ids assigned by the store).

use musicfeed::database::{DatabaseBackend, DatabaseError, SqliteRepository};
use musicfeed::domain::NewRotationEntry;

/// A minimal valid entry. Optional fields stay `None` unless a test needs them,
/// so each assertion shows exactly which field it is exercising.
fn entry(artist: &str, album: &str) -> NewRotationEntry {
    NewRotationEntry {
        listened_date: chrono::NaiveDate::from_ymd_opt(2026, 10, 7).expect("valid date"),
        artist: artist.to_string(),
        album: album.to_string(),
        cover: None,
        year: None,
        note: None,
    }
}

/// Fresh store in a directory that outlives the test (auto-removed at the end).
/// Returns the directory so a test may reopen the same file through a second
/// repository — the persistence guarantee under test.
async fn store() -> (tempfile::TempDir, SqliteRepository) {
    let dir = tempfile::tempdir().expect("temp dir");
    let settings = musicfeed::configuration::DatabaseSettings {
        path: dir.path().join("test.db").display().to_string(),
        max_connections: Some(1),
    };
    let repo = SqliteRepository::new(&settings)
        .await
        .expect("store connects and migrates");
    (dir, repo)
}

#[tokio::test]
async fn insert_assigns_monotonically_increasing_ids() {
    let (_dir, repo) = store().await;

    let first = repo
        .insert(entry("Judas Priest", "Invincible Shield"))
        .await
        .expect("insert");
    let second = repo
        .insert(entry("Judas Priest", "Painkiller"))
        .await
        .expect("insert");

    assert_eq!(first.id, 1, "first insert takes id 1");
    assert_eq!(second.id, first.id + 1, "ids are sequential");
    assert_eq!(first.artist, "Judas Priest");
    assert_eq!(first.album, "Invincible Shield");
    assert_eq!(first.listened_date.to_string(), "2026-10-07");
}

#[tokio::test]
async fn insert_round_trips_optional_fields() {
    let (_dir, repo) = store().await;

    let full = repo
        .insert(NewRotationEntry {
            listened_date: chrono::NaiveDate::from_ymd_opt(2026, 10, 7).expect("valid date"),
            artist: "Judas Priest".to_string(),
            album: "Invincible Shield".to_string(),
            cover: Some("https://coverart.example/shield.jpg".to_string()),
            year: Some(2024),
            note: Some("Crossover thrash revival".to_string()),
        })
        .await
        .expect("insert");

    assert_eq!(
        full.cover.as_deref(),
        Some("https://coverart.example/shield.jpg")
    );
    assert_eq!(full.year, Some(2024));
    assert_eq!(full.note.as_deref(), Some("Crossover thrash revival"));

    let bare = repo
        .insert(entry("Celtic Frost", "To Mega Therion"))
        .await
        .expect("insert");
    assert!(bare.cover.is_none(), "absent cover stays absent");
    assert!(bare.year.is_none(), "absent year stays absent");
    assert!(bare.note.is_none(), "absent note stays absent");
}

#[tokio::test]
async fn list_returns_entries_in_insertion_order() {
    let (_dir, repo) = store().await;

    repo.insert(entry("Judas Priest", "Invincible Shield"))
        .await
        .expect("insert");
    repo.insert(entry("Celtic Frost", "To Mega Therion"))
        .await
        .expect("insert");
    repo.insert(entry("Motörhead", "Ace of Spades"))
        .await
        .expect("insert");

    let listed = repo.list().await.expect("list");

    let albums: Vec<&str> = listed.iter().map(|e| e.album.as_str()).collect();
    assert_eq!(
        albums,
        ["Invincible Shield", "To Mega Therion", "Ace of Spades"]
    );
}

#[tokio::test]
async fn random_returns_one_of_the_stored_entries() {
    let (_dir, repo) = store().await;

    repo.insert(entry("Judas Priest", "Invincible Shield"))
        .await
        .expect("insert");
    repo.insert(entry("Celtic Frost", "To Mega Therion"))
        .await
        .expect("insert");

    let drawn = repo.random().await.expect("random on a non-empty store");
    let albums = ["Invincible Shield", "To Mega Therion"];
    assert!(
        albums.contains(&drawn.album.as_str()),
        "random drew {drawn:?}, which was never inserted"
    );
}

#[tokio::test]
async fn random_on_an_empty_store_is_not_found() {
    let (_dir, repo) = store().await;

    let outcome = repo.random().await;

    match outcome {
        Err(DatabaseError::NotFound) => {} // the contract
        other => panic!("expected NotFound, got {other:?}"),
    }
}

#[tokio::test]
async fn entries_survive_closing_and_reopening_the_database() {
    let (dir, repo) = store().await;

    repo.insert(entry("Judas Priest", "Invincible Shield"))
        .await
        .expect("insert");
    repo.insert(entry("Celtic Frost", "To Mega Therion"))
        .await
        .expect("insert");
    drop(repo);

    // A brand-new repository over the same file — what happens after a
    // redeploy or a wake from a Railway sleep cycle.
    let settings = musicfeed::configuration::DatabaseSettings {
        path: dir.path().join("test.db").display().to_string(),
        max_connections: Some(1),
    };
    let reopened = SqliteRepository::new(&settings).await.expect("reopen");

    let listed = reopened.list().await.expect("list after reopen");
    let albums: Vec<&str> = listed.iter().map(|e| e.album.as_str()).collect();
    assert_eq!(albums, ["Invincible Shield", "To Mega Therion"]);
}
