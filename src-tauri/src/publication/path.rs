use std::error::Error;
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PathError {
    Empty,
    EmptySegment,
    Absolute,
    Traversal,
    Backslash,
    Nul,
    EncodedSeparator,
    InvalidEscape,
    InvalidUtf8,
}

impl fmt::Display for PathError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::Empty => "path is empty",
            Self::EmptySegment => "path contains an empty segment",
            Self::Absolute => "absolute archive paths are not allowed",
            Self::Traversal => "path escapes the publication archive",
            Self::Backslash => "backslashes are not allowed in archive paths",
            Self::Nul => "path contains a NUL byte",
            Self::EncodedSeparator => "path contains an encoded separator",
            Self::InvalidEscape => "path contains an invalid percent escape",
            Self::InvalidUtf8 => "path is not valid UTF-8",
        };

        formatter.write_str(message)
    }
}

impl Error for PathError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct EpubReference {
    pub(crate) path: String,
    pub(crate) fragment: Option<String>,
}

pub(crate) fn canonical_zip_name(name: &str) -> Result<String, PathError> {
    validate_path_text(name)?;

    if name.is_empty() {
        return Err(PathError::Empty);
    }
    if name.starts_with('/') {
        return Err(PathError::Absolute);
    }

    let mut segments = Vec::new();
    for segment in name.split('/') {
        match segment {
            "" | "." => {}
            ".." => return Err(PathError::Traversal),
            _ => segments.push(segment),
        }
    }

    if segments.is_empty() {
        return Err(PathError::Empty);
    }

    Ok(segments.join("/"))
}

pub(crate) fn resolve_epub_reference(
    base_file: &str,
    reference: &str,
) -> Result<Option<EpubReference>, PathError> {
    validate_path_text(reference)?;

    if is_external_reference(reference) {
        return Ok(None);
    }

    let base_file = canonical_zip_name(base_file)?;
    let (before_fragment, raw_fragment) = match reference.split_once('#') {
        Some((path, fragment)) => (path, Some(fragment)),
        None => (reference, None),
    };
    let raw_path = before_fragment
        .split_once('?')
        .map_or(before_fragment, |(path, _)| path);
    let fragment = raw_fragment
        .map(|value| decode_component(value, false))
        .transpose()?;

    if raw_path.is_empty() {
        return Ok(Some(EpubReference {
            path: base_file,
            fragment,
        }));
    }

    let absolute = raw_path.starts_with('/');
    let mut segments = if absolute {
        Vec::new()
    } else {
        base_file
            .rsplit_once('/')
            .map_or_else(Vec::new, |(directory, _)| {
                directory.split('/').map(str::to_owned).collect()
            })
    };

    for raw_segment in raw_path.trim_start_matches('/').split('/') {
        if raw_segment.is_empty() {
            continue;
        }

        let segment = decode_component(raw_segment, true)?;
        match segment.as_str() {
            "." => {}
            ".." => {
                if segments.pop().is_none() {
                    return Err(PathError::Traversal);
                }
            }
            _ => segments.push(segment),
        }
    }

    if segments.is_empty() {
        return Err(PathError::Empty);
    }

    Ok(Some(EpubReference {
        path: segments.join("/"),
        fragment,
    }))
}

pub(crate) fn decode_protocol_path(encoded_path: &str) -> Result<String, PathError> {
    validate_path_text(encoded_path)?;

    if encoded_path.is_empty() {
        return Err(PathError::Empty);
    }
    if encoded_path.starts_with('/') {
        return Err(PathError::Absolute);
    }

    let mut segments = Vec::new();
    for raw_segment in encoded_path.split('/') {
        if raw_segment.is_empty() {
            return Err(PathError::EmptySegment);
        }

        let segment = decode_component(raw_segment, true)?;
        if matches!(segment.as_str(), "." | "..") {
            return Err(PathError::Traversal);
        }
        segments.push(segment);
    }

    Ok(segments.join("/"))
}

fn validate_path_text(value: &str) -> Result<(), PathError> {
    if value.contains('\\') {
        return Err(PathError::Backslash);
    }
    if value.contains('\0') {
        return Err(PathError::Nul);
    }
    Ok(())
}

fn decode_component(value: &str, reject_separators: bool) -> Result<String, PathError> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;

    while index < bytes.len() {
        if bytes[index] != b'%' {
            decoded.push(bytes[index]);
            index += 1;
            continue;
        }

        if index + 2 >= bytes.len() {
            return Err(PathError::InvalidEscape);
        }

        let high = hex_value(bytes[index + 1]).ok_or(PathError::InvalidEscape)?;
        let low = hex_value(bytes[index + 2]).ok_or(PathError::InvalidEscape)?;
        let byte = (high << 4) | low;

        if reject_separators && matches!(byte, b'/' | b'\\') {
            return Err(PathError::EncodedSeparator);
        }
        if byte == 0 {
            return Err(PathError::Nul);
        }

        decoded.push(byte);
        index += 3;
    }

    String::from_utf8(decoded).map_err(|_| PathError::InvalidUtf8)
}

fn hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

fn is_external_reference(reference: &str) -> bool {
    if reference.starts_with("//") {
        return true;
    }

    let mut bytes = reference.bytes();
    if !bytes.next().is_some_and(|byte| byte.is_ascii_alphabetic()) {
        return false;
    }

    for byte in bytes {
        match byte {
            b':' => return true,
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'+' | b'-' | b'.' => {}
            _ => return false,
        }
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonicalizes_zip_names_without_decoding_them() {
        assert_eq!(
            canonical_zip_name("OPS//Text/./chapter%20one.xhtml"),
            Ok("OPS/Text/chapter%20one.xhtml".to_owned())
        );
    }

    #[test]
    fn rejects_unsafe_zip_names() {
        assert_eq!(canonical_zip_name(""), Err(PathError::Empty));
        assert_eq!(
            canonical_zip_name("/OPS/chapter.xhtml"),
            Err(PathError::Absolute)
        );
        assert_eq!(
            canonical_zip_name("OPS/../chapter.xhtml"),
            Err(PathError::Traversal)
        );
        assert_eq!(
            canonical_zip_name("OPS\\chapter.xhtml"),
            Err(PathError::Backslash)
        );
        assert_eq!(
            canonical_zip_name("OPS/\0chapter.xhtml"),
            Err(PathError::Nul)
        );
    }

    #[test]
    fn resolves_relative_references_and_preserves_decoded_fragments() {
        assert_eq!(
            resolve_epub_reference(
                "OPS/Text/chapter.xhtml",
                "../Images/cover%20one.svg?cache=1#figure%201"
            ),
            Ok(Some(EpubReference {
                path: "OPS/Images/cover one.svg".to_owned(),
                fragment: Some("figure 1".to_owned()),
            }))
        );
    }

    #[test]
    fn resolves_fragment_query_and_root_references() {
        assert_eq!(
            resolve_epub_reference("OPS/Text/chapter.xhtml", "#note%202"),
            Ok(Some(EpubReference {
                path: "OPS/Text/chapter.xhtml".to_owned(),
                fragment: Some("note 2".to_owned()),
            }))
        );
        assert_eq!(
            resolve_epub_reference("OPS/Text/chapter.xhtml", "?theme=night"),
            Ok(Some(EpubReference {
                path: "OPS/Text/chapter.xhtml".to_owned(),
                fragment: None,
            }))
        );
        assert_eq!(
            resolve_epub_reference("OPS/Text/chapter.xhtml", "/META-INF/container.xml"),
            Ok(Some(EpubReference {
                path: "META-INF/container.xml".to_owned(),
                fragment: None,
            }))
        );
    }

    #[test]
    fn leaves_external_references_to_the_caller() {
        assert_eq!(
            resolve_epub_reference("OPS/Text/chapter.xhtml", "https://example.com/book.css"),
            Ok(None)
        );
        assert_eq!(
            resolve_epub_reference("OPS/Text/chapter.xhtml", "//cdn.example.com/book.css"),
            Ok(None)
        );
        assert_eq!(
            resolve_epub_reference("OPS/Text/chapter.xhtml", "data:image/svg+xml;base64,AA"),
            Ok(None)
        );
    }

    #[test]
    fn rejects_references_that_escape_or_smuggle_separators() {
        assert_eq!(
            resolve_epub_reference("OPS/chapter.xhtml", "../../secret"),
            Err(PathError::Traversal)
        );
        assert_eq!(
            resolve_epub_reference("OPS/chapter.xhtml", "Text%2Fchapter.xhtml"),
            Err(PathError::EncodedSeparator)
        );
        assert_eq!(
            resolve_epub_reference("OPS/chapter.xhtml", "Text%5cchapter.xhtml"),
            Err(PathError::EncodedSeparator)
        );
        assert_eq!(
            resolve_epub_reference("OPS/chapter.xhtml", "Text\\chapter.xhtml"),
            Err(PathError::Backslash)
        );
    }

    #[test]
    fn decodes_protocol_segments_exactly_once() {
        assert_eq!(
            decode_protocol_path("OPS/Text/chapter%20one.xhtml"),
            Ok("OPS/Text/chapter one.xhtml".to_owned())
        );
        assert_eq!(
            decode_protocol_path("OPS/Text/chapter%2520one.xhtml"),
            Ok("OPS/Text/chapter%20one.xhtml".to_owned())
        );
        assert_eq!(
            decode_protocol_path("OPS/%E2%82%AC.xhtml"),
            Ok("OPS/€.xhtml".to_owned())
        );
    }

    #[test]
    fn rejects_unsafe_protocol_paths() {
        assert_eq!(
            decode_protocol_path("/OPS/chapter.xhtml"),
            Err(PathError::Absolute)
        );
        assert_eq!(
            decode_protocol_path("OPS//chapter.xhtml"),
            Err(PathError::EmptySegment)
        );
        assert_eq!(
            decode_protocol_path("OPS/%2e%2e/chapter.xhtml"),
            Err(PathError::Traversal)
        );
        assert_eq!(
            decode_protocol_path("OPS/chapter%2Fone.xhtml"),
            Err(PathError::EncodedSeparator)
        );
        assert_eq!(
            decode_protocol_path("OPS/chapter%00.xhtml"),
            Err(PathError::Nul)
        );
        assert_eq!(
            decode_protocol_path("OPS/chapter%ZZ.xhtml"),
            Err(PathError::InvalidEscape)
        );
        assert_eq!(
            decode_protocol_path("OPS/chapter%C3.xhtml"),
            Err(PathError::InvalidUtf8)
        );
    }
}
