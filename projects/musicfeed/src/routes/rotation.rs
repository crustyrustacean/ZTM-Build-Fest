// src/routes/rotation.rs

use crate::domain::RotationEntry;
use crate::state::AppState;
use crate::utils::{compact_html, error_chain_fmt};
use axum::response::{
    IntoResponse, Response,
    sse::{Event, Sse},
};
use axum::{extract::State, http::StatusCode};
use axum_macros::debug_handler;
use chrono::Local;
use datastar::{axum::ReadSignals, prelude::*};
use serde::{Deserialize, Serialize};
use std::convert::Infallible;
use tera::Context;

#[derive(thiserror::Error)]
pub enum RotationEntryError {
    #[error("rotation entry not found")]
    NotFound,
    #[error("template rendering failed")]
    Template(#[from] tera::Error),
}

impl std::fmt::Debug for RotationEntryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        error_chain_fmt(self, f)
    }
}

impl IntoResponse for RotationEntryError {
    fn into_response(self) -> Response {
        tracing::error!(error = ?self, "request failed");
        let status = match self {
            RotationEntryError::NotFound => StatusCode::NOT_FOUND,
            RotationEntryError::Template(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (status, "Something went wrong.").into_response()
    }
}

#[derive(Clone, Deserialize, Serialize)]
pub struct RawRotationEntry {
    artist: String,
    album: String,
    cover: String,
    year: i32,
    note: String,
}

/// Render a single rotation entry fragment via Tera.
///
/// This is the single source of truth for the `<li>` markup: `index.html` includes
/// the same partial for the server-rendered page, so the initial render and the SSE
/// patch can never disagree. Routing both through Tera also means user input is
/// escaped by the same rules on both paths - do not hand-build this HTML.
fn render_rotation(state: &AppState, entry: &RotationEntry) -> Result<String, RotationEntryError> {
    let mut context = Context::new();
    context.insert("rotation_entry", entry);
    Ok(compact_html(
        &state.templates.render("rotation.html", &context)?,
    ))
}

#[debug_handler]
pub async fn post_rotation_entry_ds(
    State(state): State<AppState>,
    ReadSignals(raw_rotation_entry): ReadSignals<RawRotationEntry>,
) -> Result<Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>>, RotationEntryError> {
    // Claim an id before touching the entries, so the counter lock is released
    // before we hold the longer-lived entries lock.
    let id = {
        let mut next = state.next_id.lock().await;
        let id = *next;
        *next += 1;
        id
    };

    // Build the entry from the raw form input. `id` and `listened_date` are
    // app-controlled and deliberately absent from `RawRotationEntry`, so a client
    // cannot forge either. `note` and `cover` treat an empty string as "absent".
    let entry = RotationEntry {
        id,
        listened_date: Local::now().date_naive(),
        artist: raw_rotation_entry.artist,
        album: raw_rotation_entry.album,
        cover: (!raw_rotation_entry.cover.is_empty()).then_some(raw_rotation_entry.cover),
        year: raw_rotation_entry.year,
        note: (!raw_rotation_entry.note.is_empty()).then_some(raw_rotation_entry.note),
    };

    // Render before pushing: a template failure should not leave a half-added entry.
    let rendered = render_rotation(&state, &entry)?;

    state.rotation_entries.lock().await.push(entry);

    let patch = PatchElements::new(rendered)
        .selector("#rotation-list")
        .mode(ElementPatchMode::Append)
        .write_as_axum_sse_event();

    // The empty-state message is rendered inside `#rotation-list`, so the append
    // above would otherwise leave it sitting below the new entry. Remove it now that
    // there is something to show. Removing an element that is already gone is a no-op,
    // so this is safe on every subsequent post as well as the first.
    let clear_empty = PatchElements::new_remove("#rotation-empty").write_as_axum_sse_event();

    // Reset the bound signals so the form is ready for the next entry.
    //
    // `year` is deliberately NOT cleared. It is an `i32`, so pushing an empty
    // string into that signal would leave it as `""` in the browser, and the NEXT
    // submission would then fail to deserialize (serde rejects `""` for a number),
    // be answered with a 400, and silently add nothing. The field is `required`,
    // so leaving the signal alone is safe - the input just keeps its value.
    //
    // Any value pushed back into the form must be something the next request can
    // actually deserialize. `cleared_signals_must_be_deserializable` guards that.
    let clear = PatchSignals::new(r#"{"artist":"","album":"","cover":"","note":""}"#)
        .write_as_axum_sse_event();

    let sse_event = Sse::new(tokio_stream::iter(vec![
        Ok(patch),
        Ok(clear_empty),
        Ok(clear),
    ]));

    Ok(sse_event)
}

#[debug_handler]
pub async fn get_rotation_entry(
    State(state): State<AppState>,
) -> Result<Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>>, RotationEntryError> {
    // Pick a random entry to hand back.
    //
    // The emptiness check MUST come before the index is drawn: `rand::random_range`
    // panics on an empty range, so asking for a random entry from nothing would take the
    // request down instead of returning a 404. `entries.get(..)` returning `None` is
    // therefore not sufficient on its own - `.ok_or(NotFound)` never gets the chance.
    let entry = {
        let entries = state.rotation_entries.lock().await;

        if entries.is_empty() {
            return Err(RotationEntryError::NotFound);
        }

        let index = rand::random_range(0..entries.len());
        entries.get(index).cloned()
    }
    .ok_or(RotationEntryError::NotFound)?;

    let rendered = render_rotation(&state, &entry)?;

    let patch = PatchElements::new(rendered)
        .selector("#rotation-list")
        .mode(ElementPatchMode::Append)
        .write_as_axum_sse_event();

    let sse_event = Sse::new(tokio_stream::iter(vec![Ok(patch)]));

    Ok(sse_event)
}
