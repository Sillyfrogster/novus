use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, RwLock};

use serde::Serialize;
use tauri::http::header::{
    ACCEPT_RANGES, ACCESS_CONTROL_ALLOW_HEADERS, ACCESS_CONTROL_ALLOW_METHODS,
    ACCESS_CONTROL_ALLOW_ORIGIN, ALLOW, CACHE_CONTROL, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE,
};
use tauri::http::{Method, Request, Response, StatusCode};
use tauri::{State, UriSchemeResponder, WebviewWindow};
use uuid::Uuid;

use super::archive::{LoadedSection, PublicationArchive, PublicationDescription, PublicationError};
use super::path::decode_protocol_path;
use crate::error::{AppError, AppResult};
use crate::Novus;

const MAX_OPEN_PUBLICATIONS: usize = 8;
const OPEN_ERROR: &str = "Novus could not open this book";
const SECTION_ERROR: &str = "Novus could not load this part of the book";

#[derive(Clone, Default)]
pub(crate) struct PublicationRegistry {
    shared: Arc<RwLock<RegistryState>>,
}

#[derive(Default)]
struct RegistryState {
    sessions: HashMap<Uuid, PublicationSession>,
    order: VecDeque<Uuid>,
}

struct PublicationSession {
    owner: String,
    archive: Arc<PublicationArchive>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenedPublication {
    session: String,
    saved_locator: Option<String>,
    #[serde(flatten)]
    publication: PublicationDescription,
}

impl PublicationRegistry {
    fn insert(
        &self,
        owner: String,
        archive: Arc<PublicationArchive>,
        saved_locator: Option<String>,
    ) -> OpenedPublication {
        let publication = archive.description().clone();
        let mut state = self.shared.write().expect("publication registry poisoned");
        let session = loop {
            let candidate = Uuid::new_v4();
            if !state.sessions.contains_key(&candidate) {
                break candidate;
            }
        };

        state.order.push_back(session);
        state
            .sessions
            .insert(session, PublicationSession { owner, archive });
        while state.order.len() > MAX_OPEN_PUBLICATIONS {
            if let Some(expired) = state.order.pop_front() {
                state.sessions.remove(&expired);
            }
        }

        OpenedPublication {
            session: session.to_string(),
            saved_locator,
            publication,
        }
    }

    fn get(&self, owner: &str, session: Uuid) -> Option<Arc<PublicationArchive>> {
        let state = self.shared.read().ok()?;
        let publication = state.sessions.get(&session)?;
        (publication.owner == owner).then(|| publication.archive.clone())
    }

    fn close(&self, owner: &str, session: &str) {
        let Ok(session) = canonical_session(session) else {
            return;
        };
        let Ok(mut state) = self.shared.write() else {
            return;
        };
        if state
            .sessions
            .get(&session)
            .is_none_or(|publication| publication.owner != owner)
        {
            return;
        }

        state.sessions.remove(&session);
        state.order.retain(|candidate| *candidate != session);
    }

    pub(crate) fn close_owner(&self, owner: &str) {
        let Ok(mut state) = self.shared.write() else {
            return;
        };
        state
            .sessions
            .retain(|_, publication| publication.owner != owner);
        let retained: std::collections::HashSet<_> = state.sessions.keys().copied().collect();
        state.order.retain(|session| retained.contains(session));
    }
}

#[tauri::command]
pub(crate) async fn publication_open(
    book_id: String,
    window: WebviewWindow,
    state: State<'_, Novus>,
    registry: State<'_, PublicationRegistry>,
) -> AppResult<OpenedPublication> {
    let storage = state.storage.clone();
    let db = state.db.clone();
    let content_gate = state.content_gate.clone();
    let owner = window.label().to_owned();
    let registry = registry.inner().clone();

    let (archive, saved_locator) = tauri::async_runtime::spawn_blocking(move || {
        let book = db
            .get_book(&book_id)
            .map_err(|_| public_error(OPEN_ERROR))?
            .ok_or_else(|| public_error(OPEN_ERROR))?;
        if !book.format.eq_ignore_ascii_case("epub") {
            return Err(public_error(OPEN_ERROR));
        }
        let bytes = {
            let _content = content_gate.read().map_err(|_| public_error(OPEN_ERROR))?;
            let path = storage
                .resolve_checked(&book.rel_path)
                .map_err(|_| public_error(OPEN_ERROR))?;
            std::fs::read(path).map_err(|_| public_error(OPEN_ERROR))?
        };
        let archive =
            PublicationArchive::parse(Arc::from(bytes)).map_err(|_| public_error(OPEN_ERROR))?;
        let saved_locator = db
            .reading_locator(&book_id)
            .map_err(|_| public_error(OPEN_ERROR))?;
        Ok((archive, saved_locator))
    })
    .await
    .map_err(|_| public_error(OPEN_ERROR))??;

    Ok(registry.insert(owner, Arc::new(archive), saved_locator))
}

#[tauri::command]
pub(crate) async fn publication_section(
    session: String,
    index: usize,
    window: WebviewWindow,
    registry: State<'_, PublicationRegistry>,
) -> AppResult<LoadedSection> {
    let session = canonical_session(&session).map_err(|_| public_error(SECTION_ERROR))?;
    let archive = registry
        .get(window.label(), session)
        .ok_or_else(|| public_error(SECTION_ERROR))?;

    tauri::async_runtime::spawn_blocking(move || {
        archive
            .load_section(index)
            .map_err(|_| public_error(SECTION_ERROR))
    })
    .await
    .map_err(|_| public_error(SECTION_ERROR))?
}

#[tauri::command]
pub(crate) fn publication_close(
    session: String,
    window: WebviewWindow,
    registry: State<'_, PublicationRegistry>,
) {
    registry.close(window.label(), &session);
}

pub(crate) fn serve_publication_request(
    registry: PublicationRegistry,
    owner: String,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    tauri::async_runtime::spawn(async move {
        let response = tauri::async_runtime::spawn_blocking(move || {
            publication_response(&registry, &owner, &request)
        })
        .await
        .unwrap_or_else(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR));
        responder.respond(response);
    });
}

fn publication_response(
    registry: &PublicationRegistry,
    owner: &str,
    request: &Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    if request.method() == Method::OPTIONS {
        return response_builder(StatusCode::NO_CONTENT)
            .header(ACCESS_CONTROL_ALLOW_METHODS, "GET, HEAD, OPTIONS")
            .header(ACCESS_CONTROL_ALLOW_HEADERS, "Range")
            .header(CONTENT_LENGTH, "0")
            .body(Vec::new())
            .expect("static response headers are valid");
    }
    if request.method() != Method::GET && request.method() != Method::HEAD {
        return response_builder(StatusCode::METHOD_NOT_ALLOWED)
            .header(ALLOW, "GET, HEAD, OPTIONS")
            .header(CONTENT_TYPE, "text/plain; charset=utf-8")
            .body(b"Method not allowed".to_vec())
            .expect("static response headers are valid");
    }

    let Some((session, path)) = parse_resource_route(request.uri().path()) else {
        return error_response(StatusCode::NOT_FOUND);
    };
    let Some(archive) = registry.get(owner, session) else {
        return error_response(StatusCode::NOT_FOUND);
    };
    let Some(size) = archive.resource_size(&path) else {
        return error_response(StatusCode::NOT_FOUND);
    };
    let range = match requested_range(request, size) {
        Ok(range) => range,
        Err(()) => return range_error_response(size),
    };
    let media_type = resource_media_type(archive.resource_media_type(&path), &path);
    let (status, start, end, content_length) = match range {
        Some((start, end)) => (StatusCode::PARTIAL_CONTENT, start, end, end - start + 1),
        None => (StatusCode::OK, 0, size.saturating_sub(1), size),
    };

    let mut builder = response_builder(status)
        .header(CONTENT_TYPE, media_type)
        .header(CACHE_CONTROL, "private, max-age=31536000, immutable")
        .header(ACCEPT_RANGES, "bytes")
        .header(CONTENT_LENGTH, content_length.to_string());
    if status == StatusCode::PARTIAL_CONTENT {
        builder = builder.header(CONTENT_RANGE, format!("bytes {start}-{end}/{size}"));
    }
    if request.method() == Method::HEAD {
        return builder
            .body(Vec::new())
            .expect("publication response headers are valid");
    }

    let bytes = match archive.load_resource(&path) {
        Ok(bytes) => bytes,
        Err(PublicationError::MissingResource) => return error_response(StatusCode::NOT_FOUND),
        Err(_) => return error_response(StatusCode::INTERNAL_SERVER_ERROR),
    };
    let body = match range {
        Some((start, end)) => bytes
            .get(start as usize..=end as usize)
            .map(ToOwned::to_owned)
            .unwrap_or_default(),
        None => bytes,
    };

    builder
        .body(body)
        .expect("publication response headers are valid")
}

fn parse_resource_route(path: &str) -> Option<(Uuid, String)> {
    let path = path.strip_prefix('/')?;
    let (session, encoded_resource) = path.split_once('/')?;
    let session = canonical_session(session).ok()?;
    let resource = decode_protocol_path(encoded_resource).ok()?;
    Some((session, resource))
}

fn canonical_session(value: &str) -> Result<Uuid, ()> {
    let session = Uuid::parse_str(value).map_err(|_| ())?;
    (session.to_string() == value).then_some(session).ok_or(())
}

fn requested_range(request: &Request<Vec<u8>>, size: u64) -> Result<Option<(u64, u64)>, ()> {
    let Some(value) = request.headers().get("range") else {
        return Ok(None);
    };
    let value = value.to_str().map_err(|_| ())?.trim();
    let value = value.strip_prefix("bytes=").ok_or(())?;
    if value.contains(',') {
        return Err(());
    }
    let (start, end) = value.split_once('-').ok_or(())?;
    if size == 0 {
        return Err(());
    }

    if start.is_empty() {
        let suffix = end.parse::<u64>().map_err(|_| ())?;
        if suffix == 0 {
            return Err(());
        }
        let start = size.saturating_sub(suffix);
        return Ok(Some((start, size - 1)));
    }

    let start = start.parse::<u64>().map_err(|_| ())?;
    if start >= size {
        return Err(());
    }
    let end = if end.is_empty() {
        size - 1
    } else {
        end.parse::<u64>()
            .map_err(|_| ())?
            .min(size.saturating_sub(1))
    };
    if end < start {
        return Err(());
    }

    Ok(Some((start, end)))
}

fn resource_media_type<'a>(declared: Option<&'a str>, path: &str) -> &'a str {
    if let Some(declared) = declared {
        if tauri::http::HeaderValue::from_str(declared).is_ok() {
            return declared;
        }
    }

    match path
        .rsplit_once('.')
        .map(|(_, extension)| extension)
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "xhtml" => "application/xhtml+xml",
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "svg" => "image/svg+xml",
        "xml" | "opf" => "application/xml",
        "ncx" => "application/x-dtbncx+xml",
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "wav" => "audio/wav",
        "flac" => "audio/flac",
        "aac" => "audio/aac",
        "ogg" | "oga" => "audio/ogg",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "ogv" => "video/ogg",
        "smil" => "application/smil+xml",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}

fn response_builder(status: StatusCode) -> tauri::http::response::Builder {
    Response::builder()
        .status(status)
        .header(ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(
            "access-control-expose-headers",
            "Accept-Ranges, Content-Length, Content-Range",
        )
        .header("cross-origin-resource-policy", "cross-origin")
        .header("x-content-type-options", "nosniff")
}

fn error_response(status: StatusCode) -> Response<Vec<u8>> {
    let message = match status {
        StatusCode::NOT_FOUND => "Resource not found",
        _ => "Resource could not be loaded",
    };
    response_builder(status)
        .header(CACHE_CONTROL, "no-store")
        .header(CONTENT_TYPE, "text/plain; charset=utf-8")
        .header(CONTENT_LENGTH, message.len().to_string())
        .body(message.as_bytes().to_vec())
        .expect("static response headers are valid")
}

fn range_error_response(size: u64) -> Response<Vec<u8>> {
    response_builder(StatusCode::RANGE_NOT_SATISFIABLE)
        .header(CACHE_CONTROL, "no-store")
        .header(CONTENT_RANGE, format!("bytes */{size}"))
        .header(CONTENT_LENGTH, "0")
        .body(Vec::new())
        .expect("range response headers are valid")
}

fn public_error(message: &'static str) -> AppError {
    AppError::Other(message.to_owned())
}

#[cfg(test)]
mod tests {
    use std::io::{Cursor, Write};

    use tauri::http::header::{CONTENT_RANGE, CONTENT_TYPE};
    use zip::write::{SimpleFileOptions, ZipWriter};
    use zip::CompressionMethod;

    use super::*;

    fn publication() -> Arc<PublicationArchive> {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        let entries: [(&str, &[u8]); 4] = [
            (
                "META-INF/container.xml",
                br#"<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>"#,
            ),
            (
                "OPS/book.opf",
                br#"<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
<manifest>
<item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
<item id="image" href="image.png" media-type="image/png"/>
</manifest>
<spine><itemref idref="chapter"/></spine>
</package>"#,
            ),
            ("OPS/chapter.xhtml", b"<html><body>Chapter</body></html>"),
            ("OPS/image.png", b"0123456789"),
        ];
        for (path, body) in entries {
            writer.start_file(path, options).unwrap();
            writer.write_all(body).unwrap();
        }
        let bytes: Arc<[u8]> = Arc::from(writer.finish().unwrap().into_inner());
        Arc::new(PublicationArchive::parse(bytes).unwrap())
    }

    #[test]
    fn resource_routes_decode_each_segment_once() {
        let session = Uuid::new_v4();
        assert_eq!(
            parse_resource_route(&format!("/{session}/OPS/image%20one.png")),
            Some((session, "OPS/image one.png".to_owned()))
        );
        assert_eq!(
            parse_resource_route(&format!("/{session}/OPS/image%2520one.png")),
            Some((session, "OPS/image%20one.png".to_owned()))
        );
        assert!(parse_resource_route(&format!("/{session}/OPS/%2e%2e/private")).is_none());
        assert!(parse_resource_route(&format!("/{session}/OPS/image%2Fone.png")).is_none());
    }

    #[test]
    fn ranges_cover_prefix_suffix_and_open_ended_requests() {
        let request = |value: &str| {
            Request::builder()
                .header("range", value)
                .body(Vec::new())
                .unwrap()
        };

        assert_eq!(requested_range(&request("bytes=2-5"), 10), Ok(Some((2, 5))));
        assert_eq!(requested_range(&request("bytes=6-"), 10), Ok(Some((6, 9))));
        assert_eq!(requested_range(&request("bytes=-3"), 10), Ok(Some((7, 9))));
        assert_eq!(
            requested_range(&request("bytes=8-20"), 10),
            Ok(Some((8, 9)))
        );
        assert_eq!(requested_range(&request("bytes=10-"), 10), Err(()));
        assert_eq!(requested_range(&request("bytes=2-1"), 10), Err(()));
        assert_eq!(requested_range(&request("bytes=1-2,4-5"), 10), Err(()));
    }

    #[test]
    fn the_registry_keeps_the_eight_newest_owner_bound_sessions() {
        let registry = PublicationRegistry::default();
        let archive = publication();
        let mut sessions = Vec::new();

        for _ in 0..=MAX_OPEN_PUBLICATIONS {
            let opened = registry.insert("reader".to_owned(), archive.clone(), None);
            sessions.push(Uuid::parse_str(&opened.session).unwrap());
        }

        assert!(registry.get("reader", sessions[0]).is_none());
        assert!(registry.get("reader", sessions[1]).is_some());
        assert!(registry.get("other", sessions[1]).is_none());
        registry.close("other", &sessions[1].to_string());
        assert!(registry.get("reader", sessions[1]).is_some());
        registry.close("reader", &sessions[1].to_string());
        assert!(registry.get("reader", sessions[1]).is_none());
        registry.close("reader", &sessions[1].to_string());
    }

    #[test]
    fn protocol_responses_support_ranges_head_and_options() {
        let registry = PublicationRegistry::default();
        let opened = registry.insert("reader".to_owned(), publication(), None);
        let uri = format!("novus-epub://localhost/{}/OPS/image.png", opened.session);
        let request = Request::builder()
            .uri(&uri)
            .header("range", "bytes=2-5")
            .body(Vec::new())
            .unwrap();

        let response = publication_response(&registry, "reader", &request);
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(response.headers()[CONTENT_RANGE], "bytes 2-5/10");
        assert_eq!(response.headers()[CONTENT_TYPE], "image/png");
        assert_eq!(
            response.headers()[CACHE_CONTROL],
            "private, max-age=31536000, immutable"
        );
        assert_eq!(response.headers()["x-content-type-options"], "nosniff");
        assert_eq!(response.body(), b"2345");

        let head = Request::builder()
            .method(Method::HEAD)
            .uri(&uri)
            .body(Vec::new())
            .unwrap();
        let response = publication_response(&registry, "reader", &head);
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[CONTENT_LENGTH], "10");
        assert!(response.body().is_empty());

        let options = Request::builder()
            .method(Method::OPTIONS)
            .uri("novus-epub://localhost/")
            .body(Vec::new())
            .unwrap();
        let response = publication_response(&registry, "reader", &options);
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        assert_eq!(
            response.headers()[ACCESS_CONTROL_ALLOW_METHODS],
            "GET, HEAD, OPTIONS"
        );
    }
}
