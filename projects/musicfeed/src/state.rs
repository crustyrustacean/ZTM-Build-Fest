// src/state.rs

use crate::configuration::MetadataSettings;
use crate::domain::RotationEntry;
use crate::metadata::MetadataClient;
use std::sync::Arc;
use tera::Tera;
use tokio::sync::Mutex;

#[derive(Clone, Debug)]
pub struct AppState {
    pub templates: Tera,
    pub rotation_entries: Arc<Mutex<Vec<RotationEntry>>>,
    pub next_id: Arc<Mutex<u64>>,
    /// Held here rather than constructed per request so the underlying
    /// connection pool is reused. Cheap to clone, no global state.
    pub metadata: MetadataClient,
}

impl AppState {
    pub fn new(metadata_settings: &MetadataSettings) -> Self {
        let mut tera = Tera::default();
        tera.load_from_glob("templates/**/*.html")
            .expect("Unable to load the Tera templates.");

        Self {
            templates: tera,
            rotation_entries: Arc::new(Mutex::new(Vec::new())),
            next_id: Arc::new(Mutex::new(0)),
            metadata: MetadataClient::with_base_urls(
                metadata_settings.musicbrainz_base_url.clone(),
                metadata_settings.cover_art_base_url.clone(),
            ),
        }
    }
}
