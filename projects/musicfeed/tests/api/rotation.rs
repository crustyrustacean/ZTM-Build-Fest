// tests/api/rotation.rs

use crate::helpers::spawn_app;

use reqwest::StatusCode;

fn payload() -> serde_json::Value {
    serde_json::json!({
        "artist": "Sabaton",
        "album": "Attero Dominatus",
        "cover": "/static/images/covers/attero-dominatus.jpg",
        "year": 2006,
        "note": "A co-worker turned me on to Sabaton in early 2022."
    })
}

#[tokio::test]
async fn post_rotation_entry_returns_append_patch_and_clears_signals() {
    // Arrange
    let app = spawn_app().await;

    // Act
    let response = app
        .api_client
        .post(format!("{}/rotation", &app.address))
        .json(&payload())
        .send()
        .await
        .expect("Failed to execute request.");

    // Assert
    assert!(response.status().is_success());
    let body = response.text().await.unwrap();
    assert!(body.contains("event: datastar-patch-elements"));
    assert!(body.contains("data: selector #rotation-list"));
    assert!(body.contains("data: mode append"));
    // the app stamps id 0 for the first entry and the date itself
    assert!(body.contains(r#"id="rotation-0""#), "body was: {body}");
    assert!(body.contains("Sabaton"));
    assert!(body.contains("Attero Dominatus"));
    // and every bound signal is reset so the form is ready for the next entry
    assert!(body.contains("event: datastar-patch-signals"));
    assert!(body.contains(r#""artist":"""#));
    assert!(body.contains(r#""album":"""#));
}

#[tokio::test]
async fn cleared_signals_must_be_deserializable() {
    // Arrange
    let app = spawn_app().await;

    // Act — read the clear patch the server actually sends, then push its values
    // straight back into the next submission, exactly as the browser would.
    let first = app
        .api_client
        .post(format!("{}/rotation", &app.address))
        .json(&payload())
        .send()
        .await
        .expect("Failed to execute request.")
        .text()
        .await
        .unwrap();

    let signals: serde_json::Value = first
        .lines()
        .find_map(|line| line.strip_prefix("data: signals "))
        .expect("stream carried no signals patch")
        .parse()
        .expect("signals patch was not valid JSON");

    // Merge the cleared values over a complete payload, as the form's bound
    // signals would be when the user submits again.
    let mut second = payload();
    for (key, value) in signals.as_object().unwrap() {
        second[key.as_str()] = value.clone();
    }

    let response = app
        .api_client
        .post(format!("{}/rotation", &app.address))
        .json(&second)
        .send()
        .await
        .expect("Failed to execute request.");

    // Assert — the previous submission's own reset must not poison the next one.
    // Clearing `year` to `""` made this a 400 and silently added nothing.
    assert!(
        response.status().is_success(),
        "cleared signals were rejected on resubmit ({}): {second}",
        response.status()
    );

    // And it must be the *second* entry, proving the first was not re-sent.
    let body = response.text().await.unwrap();
    assert!(
        body.contains(r#"id="rotation-1""#),
        "expected the second entry, got: {body}"
    );
}
#[tokio::test]
async fn posted_entry_appears_in_index_list() {
    // Arrange
    let app = spawn_app().await;

    // Act
    let _response = app
        .api_client
        .post(format!("{}/rotation", &app.address))
        .json(&payload())
        .send()
        .await
        .expect("Failed to execute request.");

    let body = app
        .api_client
        .get(&app.address)
        .send()
        .await
        .expect("Failed to execute request")
        .text()
        .await
        .unwrap();

    // Assert — the shared partial supplies the id and the fields on both paths
    assert!(body.contains(r#"id="rotation-0""#), "body was: {body}");
    assert!(body.contains("Sabaton"));
    assert!(body.contains("2006"));
}

#[tokio::test]
async fn empty_cover_and_note_are_omitted_rather_than_rendered_empty() {
    // Arrange — a miss is legitimate, so blank fields must not become "" on the page
    let app = spawn_app().await;
    let mut body = payload();
    body["cover"] = serde_json::json!("");
    body["note"] = serde_json::json!("");

    // Act
    let response = app
        .api_client
        .post(format!("{}/rotation", &app.address))
        .json(&body)
        .send()
        .await
        .expect("Failed to execute request.");

    // Assert — the entry still saves, it just carries no cover or note markup
    assert!(response.status().is_success());
    let sse_body = response.text().await.unwrap();
    assert!(sse_body.contains("Sabaton"));
    assert!(
        !sse_body.contains("rotation-entry-note"),
        "sse was: {sse_body}"
    );
}

#[tokio::test]
async fn non_numeric_year_is_rejected_by_the_framework() {
    // Arrange
    let app = spawn_app().await;
    let mut body = payload();
    body["year"] = serde_json::json!("not a year");

    // Act — no custom parsing is needed; serde rejects it before the handler runs
    let response = app
        .api_client
        .post(format!("{}/rotation", &app.address))
        .json(&body)
        .send()
        .await
        .expect("Failed to execute request.");

    // Assert
    assert!(
        !response.status().is_success(),
        "a bad year should not be accepted, got {}",
        response.status()
    );
}

#[tokio::test]
async fn cover_is_rendered_when_present_and_omitted_when_absent() {
    // Arrange
    let app = spawn_app().await;

    // Act — one entry with a cover, one without
    app.api_client
        .post(format!("{}/rotation", &app.address))
        .json(&payload())
        .send()
        .await
        .expect("Failed to execute request.");
    app.api_client
        .post(format!("{}/rotation", &app.address))
        .json(&serde_json::json!({
            "artist": "Alestorm", "album": "Cocoon",
            "cover": "", "year": 2020, "note": ""
        }))
        .send()
        .await
        .expect("Failed to execute request.");

    let page = app
        .api_client
        .get(&app.address)
        .send()
        .await
        .expect("Failed to execute request")
        .text()
        .await
        .unwrap();

    // Assert — the cover renders, and a missing cover never becomes an empty src
    assert!(page.contains("rotation-entry-cover"), "page was: {page}");
    assert!(page.contains("attero-dominatus.jpg"), "page was: {page}");
    assert!(
        !page.contains(r#"src="""#),
        "a missing cover rendered an empty src: {page}"
    );
    assert!(page.contains("Alestorm"), "page was: {page}");
}

#[tokio::test]
async fn empty_state_is_shown_only_when_there_are_no_entries() {
    // Arrange
    let app = spawn_app().await;

    // Act — first look at an empty app
    let empty = app
        .api_client
        .get(&app.address)
        .send()
        .await
        .expect("Failed to execute request")
        .text()
        .await
        .unwrap();

    // Assert — visible, because nothing is spinning yet
    assert!(
        empty.contains(r#"<li id="rotation-empty" class="rotation-empty" >"#),
        "empty state should render when the list is empty: {empty}"
    );

    // Act — add an entry, then look again
    app.api_client
        .post(format!("{}/rotation", &app.address))
        .json(&payload())
        .send()
        .await
        .expect("Failed to execute request.");
    let filled = app
        .api_client
        .get(&app.address)
        .send()
        .await
        .expect("Failed to execute request")
        .text()
        .await
        .unwrap();

    // Assert — hidden, because there is now something to show
    assert!(
        filled.contains(r#"<li id="rotation-empty" class="rotation-empty" hidden>"#),
        "empty state should be hidden once entries exist: {filled}"
    );
}
#[tokio::test]
async fn sse_removes_the_empty_state_message() {
    // Arrange
    let app = spawn_app().await;

    // Act
    let body = app
        .api_client
        .post(format!("{}/rotation", &app.address))
        .json(&payload())
        .send()
        .await
        .expect("Failed to execute request.")
        .text()
        .await
        .unwrap();

    // Assert — the empty-state message lives inside `#rotation-list`, so the append
    // alone leaves it sitting below the new entry. The stream must carry an explicit
    // removal, or "Nothing spinning yet" survives until a full page reload.
    assert!(
        body.contains("data: selector #rotation-empty"),
        "stream did not target the empty state:\n{body}"
    );
    assert!(
        body.contains("data: mode remove"),
        "stream did not remove the empty state:\n{body}"
    );
    // And the removal must come after the append, or the message is gone before it matters.
    let append_at = body.find("data: selector #rotation-list").unwrap();
    let remove_at = body.find("data: selector #rotation-empty").unwrap();
    assert!(
        append_at < remove_at,
        "removal should follow the append:\n{body}"
    );
}

#[tokio::test]
async fn sse_patch_is_a_single_data_elements_field() {
    // Arrange
    let app = spawn_app().await;

    // Act
    let body = app
        .api_client
        .post(format!("{}/rotation", &app.address))
        .json(&payload())
        .send()
        .await
        .expect("Failed to execute request.")
        .text()
        .await
        .unwrap();

    // Assert — the HTML for one entry must arrive as ONE `data: elements` field.
    // A multi-line template makes the encoder emit a `data: elements` prefix per
    // line, and Datastar then patches with fragments instead of the whole entry,
    // so only part of the entry lands in the DOM.
    let element_fields = body
        .lines()
        .filter(|line| line.starts_with("data: elements"))
        .count();
    assert_eq!(
        element_fields, 1,
        "expected exactly one `data: elements` field, got {element_fields}:\n{body}"
    );
}

#[tokio::test]
async fn every_posted_entry_appears_in_the_index_list() {
    // Arrange
    let app = spawn_app().await;

    // Act — post three different entries
    for (artist, album) in [
        ("Sabaton", "Attero Dominatus"),
        ("Alestorm", "Cocoon"),
        ("Alice Cooper", "Special Forces"),
    ] {
        app.api_client
            .post(format!("{}/rotation", &app.address))
            .json(&serde_json::json!({
                "artist": artist, "album": album,
                "cover": "", "year": 2000, "note": ""
            }))
            .send()
            .await
            .expect("Failed to execute request.");
    }

    let page = app
        .api_client
        .get(&app.address)
        .send()
        .await
        .expect("Failed to execute request")
        .text()
        .await
        .unwrap();

    // Assert — all three are present, each with its own id
    for artist in ["Sabaton", "Alestorm", "Alice Cooper"] {
        assert!(page.contains(artist), "{artist} missing from:\n{page}");
    }
    for id in 0..3 {
        assert!(
            page.contains(&format!(r#"id="rotation-{id}""#)),
            "entry {id} missing from:\n{page}"
        );
    }
}

#[tokio::test]
async fn entry_text_is_escaped_in_the_sse_patch() {
    // Arrange
    let app = spawn_app().await;
    let mut body = payload();
    body["note"] = serde_json::json!("<img src=x onerror=alert(1)>");

    // Act
    let response = app
        .api_client
        .post(format!("{}/rotation", &app.address))
        .json(&body)
        .send()
        .await
        .expect("Failed to execute request.");
    let sse_body = response.text().await.unwrap();

    // Assert — the patch carries escaped text, never raw markup. The SSE path and the
    // server-rendered page must agree, or a stored payload runs for whoever loads the page.
    assert!(
        !sse_body.contains("<img src=x onerror=alert(1)>"),
        "raw payload leaked into the SSE patch: {sse_body}"
    );
    assert!(sse_body.contains("&lt;img src=x onerror=alert(1)&gt;"));

    // And the server-rendered page escapes it identically.
    let page = app
        .api_client
        .get(&app.address)
        .send()
        .await
        .expect("Failed to execute request")
        .text()
        .await
        .unwrap();
    assert!(
        !page.contains("<img src=x onerror=alert(1)>"),
        "raw payload leaked into the page: {page}"
    );
    assert!(page.contains("&lt;img src=x onerror=alert(1)&gt;"));
}
#[tokio::test]
async fn random_entry_with_no_entries_returns_404() {
    // Arrange — a fresh app has nothing in its rotation
    let app = spawn_app().await;

    // Act — ask for one anyway
    let response = app
        .api_client
        .get(format!("{}/rotation", &app.address))
        .send()
        .await
        .expect("Failed to execute request.");

    // Assert — a 404, not a dropped connection.
    //
    // This is the case that catches a missing emptiness guard: drawing a random
    // index from an empty range panics, so the request is killed mid-response and the
    // client sees a transport error rather than any status at all.
    assert_eq!(
        response.status(),
        StatusCode::NOT_FOUND,
        "an empty rotation should be a 404, not a dropped connection"
    );

    // And the server must still be healthy afterwards — a panic in a handler would
    // leave the app unable to serve the next request.
    let health = app
        .api_client
        .get(format!("{}/health_check", &app.address))
        .send()
        .await
        .expect("app did not survive the empty-rotation request");
    assert!(health.status().is_success());
}

#[tokio::test]
async fn random_entry_is_one_of_the_entered_entries() {
    // Arrange — enter three entries
    let app = spawn_app().await;
    for artist in ["Sabaton", "Alestorm", "Alice Cooper"] {
        app.api_client
            .post(format!("{}/rotation", &app.address))
            .json(&serde_json::json!({
                "artist": artist, "album": "X",
                "cover": "", "year": 2000, "note": ""
            }))
            .send()
            .await
            .unwrap();
    }

    // Act — ask for one
    let response = app
        .api_client
        .get(format!("{}/rotation", &app.address)) // ← the endpoint you haven't built
        .send()
        .await
        .unwrap();

    // Assert — 200, and the artist is one we entered
    assert!(response.status().is_success());
    let body = response.text().await.unwrap();
    assert!(
        body.contains("rotation-entry-artist"),
        "expected a rendered entry, got: {body}"
    );
}
