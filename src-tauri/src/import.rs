use std::io::{Cursor, Read};
use std::path::Path;

use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::db::{now_seconds, Book};
use crate::error::{AppError, AppResult};
use crate::Novus;

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub imported: Vec<Book>,
    pub skipped: usize,
    pub failed: Vec<ImportFailure>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportFailure {
    pub path: String,
    pub error: String,
}

/// Import a batch of files into the managed library
pub fn import_paths(novus: &Novus, paths: Vec<String>) -> ImportSummary {
    let mut summary = ImportSummary::default();
    for path in paths {
        match import_one(novus, &path) {
            Ok(Some(book)) => summary.imported.push(book),
            Ok(None) => summary.skipped += 1,
            Err(e) => summary.failed.push(ImportFailure {
                path,
                error: e.to_string(),
            }),
        }
    }
    summary
}

fn import_one(novus: &Novus, path: &str) -> AppResult<Option<Book>> {
    let src = Path::new(path);
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    if ext != "epub" {
        return Err(AppError::Other(format!("unsupported format: .{ext}")));
    }

    let bytes = std::fs::read(src)?;
    let id = sha256_hex(&bytes);

    if novus.db.book_exists(&id)? {
        return Ok(None);
    }

    let shard = &id[0..2];
    let books_sub = novus.storage.books_dir().join(shard);
    std::fs::create_dir_all(&books_sub)?;
    let rel_path = format!("books/{shard}/{id}.{ext}");
    std::fs::write(novus.storage.resolve(&rel_path), &bytes)?;

    let meta = read_epub_meta(&bytes);
    let title = meta
        .title
        .filter(|t| !t.trim().is_empty())
        .unwrap_or_else(|| filename_title(src));
    let author = meta
        .author
        .filter(|a| !a.trim().is_empty())
        .unwrap_or_else(|| "Unknown".to_string());

    let cover_path = match meta.cover {
        Some((data, cover_ext)) => {
            let rel = format!("covers/{id}.{cover_ext}");
            std::fs::write(novus.storage.resolve(&rel), data)?;
            Some(rel)
        }
        None => None,
    };

    let book = Book {
        id: id.clone(),
        title,
        author,
        format: ext,
        rel_path,
        cover_path,
        page_count: None,
        language: meta.language,
        description: meta.description,
        file_size: bytes.len() as i64,
        added_at: now_seconds(),
        progress: 0.0,
    };
    novus.db.insert_book(&book)?;
    Ok(Some(book))
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

fn filename_title(src: &Path) -> String {
    src.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Untitled")
        .replace(['_', '-'], " ")
}

// epub parsing

#[derive(Default)]
struct EpubMeta {
    title: Option<String>,
    author: Option<String>,
    language: Option<String>,
    description: Option<String>,
    cover: Option<(Vec<u8>, String)>,
}

fn read_epub_meta(bytes: &[u8]) -> EpubMeta {
    parse_epub(bytes).unwrap_or_default()
}

fn parse_xml(text: &str) -> Option<roxmltree::Document<'_>> {
    let opts = roxmltree::ParsingOptions {
        allow_dtd: true,
        ..Default::default()
    };
    roxmltree::Document::parse_with_options(text, opts).ok()
}

fn find_opf_path(zip: &mut zip::ZipArchive<Cursor<&[u8]>>) -> Option<String> {
    let container = read_zip_text(zip, "META-INF/container.xml")?;
    let doc = parse_xml(&container)?;
    doc.descendants()
        .find(|n| n.has_tag_name("rootfile"))
        .and_then(|n| n.attribute("full-path"))
        .map(|s| s.to_string())
}

fn parse_epub(bytes: &[u8]) -> Option<EpubMeta> {
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).ok()?;

    let opf_path = find_opf_path(&mut zip)?;
    let opf = read_zip_text(&mut zip, &opf_path)?;
    let doc = parse_xml(&opf)?;

    let title = first_meta_text(&doc, "title");
    let author = first_meta_text(&doc, "creator");
    let language = first_meta_text(&doc, "language");
    let description = first_meta_description(&doc);

    let cover = if let Some(href) = find_cover_href(&doc) {
        let full = resolve_relative(&opf_path, &href);
        read_zip_bytes(&mut zip, &full).map(|data| {
            let cover_ext = Path::new(&href)
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("jpg")
                .to_lowercase();
            (data, cover_ext)
        })
    } else {
        None
    };

    Some(EpubMeta {
        title,
        author,
        language,
        description,
        cover,
    })
}

fn first_meta_text(doc: &roxmltree::Document, local: &str) -> Option<String> {
    doc.descendants()
        .find(|n| n.is_element() && n.tag_name().name() == local)
        .and_then(|n| n.text())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn first_meta_description(doc: &roxmltree::Document) -> Option<String> {
    let node = doc
        .descendants()
        .find(|n| n.is_element() && n.tag_name().name() == "description")?;
    let raw = collect_text(node);
    let cleaned = clean_synopsis(&raw);
    Some(cleaned).filter(|s| !s.trim().is_empty())
}

fn clean_synopsis(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut in_tag = false;
    for ch in raw.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn find_cover_href(doc: &roxmltree::Document) -> Option<String> {
    let items: Vec<roxmltree::Node> = doc
        .descendants()
        .filter(|n| n.has_tag_name("item"))
        .collect();

    if let Some(href) = items
        .iter()
        .find(|n| {
            n.attribute("properties")
                .map(|p| p.split_whitespace().any(|t| t == "cover-image"))
                .unwrap_or(false)
        })
        .and_then(|n| n.attribute("href"))
    {
        return Some(href.to_string());
    }

    let cover_id = doc
        .descendants()
        .find(|n| n.has_tag_name("meta") && n.attribute("name") == Some("cover"))
        .and_then(|n| n.attribute("content"))?;
    items
        .iter()
        .find(|n| n.attribute("id") == Some(cover_id))
        .and_then(|n| n.attribute("href"))
        .map(|s| s.to_string())
}

// toc

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TocEntry {
    pub label: String,
    pub depth: u32,
    pub href: String,
}

pub fn read_epub_toc(bytes: &[u8]) -> Vec<TocEntry> {
    parse_epub_toc(bytes).unwrap_or_default()
}

fn parse_epub_toc(bytes: &[u8]) -> Option<Vec<TocEntry>> {
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).ok()?;
    let opf_path = find_opf_path(&mut zip)?;
    let opf = read_zip_text(&mut zip, &opf_path)?;
    let doc = parse_xml(&opf)?;

    if let Some(href) = find_nav_href(&doc) {
        let full = resolve_relative(&opf_path, &href);
        if let Some(nav) = read_zip_text(&mut zip, &full) {
            let entries = parse_nav(&nav);
            if !entries.is_empty() {
                return Some(entries);
            }
        }
    }

    if let Some(href) = find_ncx_href(&doc) {
        let full = resolve_relative(&opf_path, &href);
        if let Some(ncx) = read_zip_text(&mut zip, &full) {
            let entries = parse_ncx(&ncx);
            if !entries.is_empty() {
                return Some(entries);
            }
        }
    }

    None
}

fn find_nav_href(doc: &roxmltree::Document) -> Option<String> {
    doc.descendants()
        .filter(|n| n.has_tag_name("item"))
        .find(|n| {
            n.attribute("properties")
                .map(|p| p.split_whitespace().any(|t| t == "nav"))
                .unwrap_or(false)
        })
        .and_then(|n| n.attribute("href"))
        .map(|s| s.to_string())
}

fn find_ncx_href(doc: &roxmltree::Document) -> Option<String> {
    let items: Vec<roxmltree::Node> = doc
        .descendants()
        .filter(|n| n.has_tag_name("item"))
        .collect();

    if let Some(toc_id) = doc
        .descendants()
        .find(|n| n.has_tag_name("spine"))
        .and_then(|n| n.attribute("toc"))
    {
        if let Some(href) = items
            .iter()
            .find(|n| n.attribute("id") == Some(toc_id))
            .and_then(|n| n.attribute("href"))
        {
            return Some(href.to_string());
        }
    }

    items
        .iter()
        .find(|n| n.attribute("media-type") == Some("application/x-dtbncx+xml"))
        .and_then(|n| n.attribute("href"))
        .map(|s| s.to_string())
}

fn parse_nav(xhtml: &str) -> Vec<TocEntry> {
    let Some(doc) = parse_xml(xhtml) else {
        return Vec::new();
    };
    let nav = doc
        .descendants()
        .filter(|n| n.has_tag_name("nav"))
        .find(|n| {
            n.attributes()
                .any(|a| a.name() == "type" && a.value() == "toc")
        })
        .or_else(|| doc.descendants().find(|n| n.has_tag_name("nav")));

    let mut out = Vec::new();
    if let Some(ol) = nav.and_then(|n| n.descendants().find(|d| d.has_tag_name("ol"))) {
        walk_ol(ol, 0, &mut out);
    }
    out
}

fn walk_ol(ol: roxmltree::Node, depth: u32, out: &mut Vec<TocEntry>) {
    for li in ol.children().filter(|n| n.has_tag_name("li")) {
        if let Some(node) = li
            .children()
            .find(|n| n.has_tag_name("a") || n.has_tag_name("span"))
        {
            let label = collect_text(node);
            if !label.is_empty() {
                let href = node.attribute("href").unwrap_or_default().to_string();
                out.push(TocEntry { label, depth, href });
            }
        }
        if let Some(child) = li.children().find(|n| n.has_tag_name("ol")) {
            walk_ol(child, depth + 1, out);
        }
    }
}

fn parse_ncx(ncx: &str) -> Vec<TocEntry> {
    let Some(doc) = parse_xml(ncx) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    if let Some(map) = doc.descendants().find(|n| n.has_tag_name("navMap")) {
        for point in map.children().filter(|n| n.has_tag_name("navPoint")) {
            walk_navpoint(point, 0, &mut out);
        }
    }
    out
}

fn walk_navpoint(point: roxmltree::Node, depth: u32, out: &mut Vec<TocEntry>) {
    let label = point
        .children()
        .find(|n| n.has_tag_name("navLabel"))
        .and_then(|n| n.children().find(|c| c.has_tag_name("text")))
        .map(collect_text)
        .filter(|s| !s.is_empty());
    if let Some(label) = label {
        let href = point
            .children()
            .find(|n| n.has_tag_name("content"))
            .and_then(|n| n.attribute("src"))
            .unwrap_or_default()
            .to_string();
        out.push(TocEntry { label, depth, href });
    }
    for child in point.children().filter(|n| n.has_tag_name("navPoint")) {
        walk_navpoint(child, depth + 1, out);
    }
}

fn collect_text(node: roxmltree::Node) -> String {
    let text: String = node
        .descendants()
        .filter(|n| n.is_text())
        .filter_map(|n| n.text())
        .collect();
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn read_zip_text(zip: &mut zip::ZipArchive<Cursor<&[u8]>>, name: &str) -> Option<String> {
    read_zip_bytes(zip, name).and_then(|b| String::from_utf8(b).ok())
}

fn read_zip_bytes(zip: &mut zip::ZipArchive<Cursor<&[u8]>>, name: &str) -> Option<Vec<u8>> {
    let mut file = zip.by_name(name).ok()?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf).ok()?;
    Some(buf)
}

fn resolve_relative(base: &str, href: &str) -> String {
    let mut parts: Vec<&str> = Vec::new();
    let base_dir = base.rsplit_once('/').map(|(d, _)| d).unwrap_or("");
    for seg in base_dir.split('/').chain(href.split('/')) {
        match seg {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            other => parts.push(other),
        }
    }
    parts.join("/")
}

#[cfg(test)]
mod tests {
    use super::*;

    const NAV: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="pr01.xhtml">Preface</a></li><li><a href="ch01.xhtml">I</a></li></ol></nav></body></html>"#;

    const NCX: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap><navPoint><navLabel><text>Preface</text></navLabel><content src="pr01.xhtml"/></navPoint></navMap></ncx>"#;

    #[test]
    fn nav_parses_namespaced_xhtml() {
        let entries = parse_nav(NAV);
        assert_eq!(
            entries.iter().map(|e| e.label.as_str()).collect::<Vec<_>>(),
            ["Preface", "I"]
        );
    }

    #[test]
    fn nav_captures_chapter_href() {
        let entries = parse_nav(NAV);
        assert_eq!(entries.first().map(|e| e.href.as_str()), Some("pr01.xhtml"));
    }

    #[test]
    fn ncx_label_is_not_doubled() {
        let entries = parse_ncx(NCX);
        assert_eq!(entries.first().map(|e| e.label.as_str()), Some("Preface"));
    }

    #[test]
    fn ncx_captures_content_src() {
        let entries = parse_ncx(NCX);
        assert_eq!(entries.first().map(|e| e.href.as_str()), Some("pr01.xhtml"));
    }
}
