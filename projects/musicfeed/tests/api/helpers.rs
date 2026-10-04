// tests/api/helpers.rs

use musicfeed::AppState;
use musicfeed::Application;
use musicfeed::configuration::{MetadataSettings, get_configuration};
use musicfeed::telemetry::{get_subscriber, init_subscriber};
use std::sync::LazyLock;

// Ensure that the `tracing` stack is only initialised once using `once_cell`
static TRACING: LazyLock<()> = LazyLock::new(|| {
    let default_filter_level = "info".to_string();
    let subscriber_name = "test".to_string();
    if std::env::var("TEST_LOG").is_ok() {
        let subscriber = get_subscriber(subscriber_name, default_filter_level, std::io::stdout);
        init_subscriber(subscriber);
    } else {
        let subscriber = get_subscriber(subscriber_name, default_filter_level, std::io::sink);
        init_subscriber(subscriber);
    };
});

#[allow(dead_code)]
pub struct TestApp {
    pub address: String,
    pub port: u16,
    pub api_client: reqwest::Client,
    /// The metadata stubs, kept alive for as long as the app under test.
    /// Dropping a `MockServer` shuts it down, so these must outlive every request.
    pub metadata_stub: crate::metadata_stub::MetadataStubs,
}

/// Spin up the app with the metadata services stubbed.
///
/// **Default for every test.** Pointing at a local stub keeps the suite fast and
/// hermetic: no network, no rate limits, and no failing tests because
/// MusicBrainz is briefly unhappy. The stub defaults to a plain miss, so a
/// lookup yields no cover or year — which most tests do not care about.
///
/// To register a specific response, start a `MockServer`, mount your mocks on it,
/// and call [`spawn_app_against`] with it.
pub async fn spawn_app() -> TestApp {
    let stub = crate::metadata_stub::MetadataStubs::miss().await;
    spawn_app_against(stub).await
}

/// Spin up the app pointed at an already-configured metadata stub.
///
/// Takes the stub by value so it can be stored on the returned [`TestApp`],
/// which keeps it alive for the duration of the test.
pub async fn spawn_app_against(metadata_stub: crate::metadata_stub::MetadataStubs) -> TestApp {
    LazyLock::force(&TRACING);

    let app_state = AppState::new(&MetadataSettings {
        musicbrainz_base_url: metadata_stub.musicbrainz.uri(),
        cover_art_base_url: metadata_stub.cover_art.uri(),
    });

    let configuration = get_configuration().expect("Failed to read configuration");
    let app_address = format!("{}:{}", configuration.application.host, 0);

    let application = Application::build(&app_address, app_state)
        .await
        .expect("Unable to build the application");

    let application_port = application
        .port()
        .expect("Unable to obtain the application port");
    let _ = tokio::spawn(application.run_until_stopped());

    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap();

    TestApp {
        address: format!("http://localhost:{}", application_port),
        port: application_port,
        api_client: client,
        metadata_stub,
    }
}
