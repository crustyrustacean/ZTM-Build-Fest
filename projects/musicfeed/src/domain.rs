// src/domain.rs

use chrono::NaiveDate;

#[derive(Clone, Debug, serde::Serialize)]
pub struct RotationEntry {
    pub id: u64,
    pub listened_date: NaiveDate,
    pub artist: String,
    pub album: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover: Option<String>,
    pub year: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}
