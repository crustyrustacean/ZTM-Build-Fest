// src/state.rs

use crate::domain::RotationEntry;
use std::sync::Arc;
use tera::Tera;
use tokio::sync::Mutex;

#[derive(Clone, Debug)]
pub struct AppState {
    pub templates: Tera,
    pub rotation_entries: Arc<Mutex<Vec<RotationEntry>>>,
    pub next_id: Arc<Mutex<u64>>,
}

impl AppState {
    pub fn new() -> Self {
        let mut tera = Tera::default();
        tera.load_from_glob("templates/**/*.html")
            .expect("Unable to load the Tera templates.");

        Self {
            templates: tera,
            rotation_entries: Arc::new(Mutex::new(Vec::new())),
            next_id: Arc::new(Mutex::new(0)),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
