use std::collections::HashMap;
use std::error::Error;
use std::fmt;
use std::io::{Cursor, Read};
use std::sync::Arc;

use roxmltree::{Document, Node, ParsingOptions};
use serde::Serialize;
use zip::{CompressionMethod, ZipArchive};

use super::encryption::{FontObfuscation, ADOBE_ALGORITHM, IDPF_ALGORITHM};
use super::path::{canonical_zip_name, resolve_epub_reference, EpubReference};

const CONTAINER_PATH: &str = "META-INF/container.xml";
const ENCRYPTION_PATH: &str = "META-INF/encryption.xml";
const CONTAINER_NAMESPACE: &str = "urn:oasis:names:tc:opendocument:xmlns:container";
const OPF_NAMESPACE: &str = "http://www.idpf.org/2007/opf";
const DC_NAMESPACE: &str = "http://purl.org/dc/elements/1.1/";
const MAX_XML_NODES: u32 = 250_000;
const MAX_METADATA_SIZE: u64 = 32 * 1024 * 1024;

const DEFAULT_LIMITS: ArchiveLimits = ArchiveLimits {
    entry_count: 10_000,
    total_size: 2 * 1024 * 1024 * 1024,
    entry_size: 256 * 1024 * 1024,
    metadata_size: MAX_METADATA_SIZE,
    compression_ratio: 200,
};

type ArchiveReader = Cursor<Arc<[u8]>>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PublicationError {
    InvalidZip,
    EntryCountLimit,
    TotalSizeLimit,
    EntrySizeLimit,
    MetadataSizeLimit,
    CompressionRatioLimit,
    UnsafeEntry,
    DuplicateEntry,
    SymbolicLink,
    ZipEncryption,
    UnsupportedCompression,
    UnsupportedEntryType,
    MissingContainer,
    InvalidContainer,
    MissingPackage,
    InvalidPackage,
    MissingManifest,
    MissingSpine,
    EmptySpine,
    MissingResource,
    InvalidNavigation,
    InvalidEncryption,
    UnsupportedProtection,
    SectionOutOfRange,
    ReadFailed,
}

impl fmt::Display for PublicationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::InvalidZip => "invalid EPUB archive",
            Self::EntryCountLimit => "EPUB archive has too many entries",
            Self::TotalSizeLimit => "EPUB archive expands beyond the total size limit",
            Self::EntrySizeLimit => "EPUB archive entry exceeds the size limit",
            Self::MetadataSizeLimit => "EPUB metadata document exceeds the size limit",
            Self::CompressionRatioLimit => "EPUB archive entry exceeds the compression ratio limit",
            Self::UnsafeEntry => "EPUB archive contains an unsafe entry path",
            Self::DuplicateEntry => "EPUB archive contains duplicate entry paths",
            Self::SymbolicLink => "EPUB archive contains a symbolic link",
            Self::ZipEncryption => "ZIP-encrypted EPUB entries are not supported",
            Self::UnsupportedCompression => "EPUB archive uses unsupported compression",
            Self::UnsupportedEntryType => "EPUB archive contains an unsupported entry type",
            Self::MissingContainer => "EPUB container document is missing",
            Self::InvalidContainer => "EPUB container document is invalid",
            Self::MissingPackage => "EPUB package document is missing",
            Self::InvalidPackage => "EPUB package document is invalid",
            Self::MissingManifest => "EPUB package manifest is missing",
            Self::MissingSpine => "EPUB package spine is missing",
            Self::EmptySpine => "EPUB package spine has no readable sections",
            Self::MissingResource => "EPUB resource is missing",
            Self::InvalidNavigation => "EPUB navigation document is invalid",
            Self::InvalidEncryption => "EPUB encryption metadata is invalid",
            Self::UnsupportedProtection => "EPUB resource protection is not supported",
            Self::SectionOutOfRange => "EPUB section index is out of range",
            Self::ReadFailed => "EPUB resource could not be read",
        };

        formatter.write_str(message)
    }
}

impl Error for PublicationError {}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PublicationDescription {
    pub(crate) package_path: String,
    pub(crate) package: String,
    pub(crate) sections: Vec<PublicationSection>,
    pub(crate) contents: Vec<ContentsItem>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct PublicationMetadata {
    pub(crate) title: Option<String>,
    pub(crate) author: Option<String>,
    pub(crate) language: Option<String>,
    pub(crate) description: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PublicationCover {
    pub(crate) href: String,
    pub(crate) media_type: String,
    pub(crate) bytes: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PublicationSection {
    pub(crate) id: String,
    pub(crate) href: String,
    pub(crate) media_type: String,
    pub(crate) linear: bool,
    pub(crate) spine_index: usize,
    pub(crate) size: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ContentsItem {
    pub(crate) label: String,
    pub(crate) href: String,
    pub(crate) subitems: Vec<ContentsItem>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoadedSection {
    pub(crate) index: usize,
    pub(crate) href: String,
    pub(crate) media_type: String,
    pub(crate) markup: String,
}

#[derive(Clone)]
pub(crate) struct PublicationArchive {
    _source: Arc<[u8]>,
    archive: ZipArchive<ArchiveReader>,
    entries: HashMap<String, ArchiveEntry>,
    media_types: HashMap<String, String>,
    obfuscations: HashMap<String, FontObfuscation>,
    description: PublicationDescription,
    metadata: PublicationMetadata,
    cover: Option<CoverResource>,
    limits: ArchiveLimits,
}

#[derive(Debug, Clone)]
struct ArchiveEntry {
    index: usize,
    size: u64,
    is_directory: bool,
}

#[derive(Debug, Clone)]
struct ManifestItem {
    id: String,
    path: String,
    media_type: String,
    properties: Vec<String>,
}

#[derive(Debug, Clone)]
struct CoverResource {
    href: String,
    media_type: String,
}

#[derive(Debug, Clone, Copy)]
struct ArchiveLimits {
    entry_count: usize,
    total_size: u64,
    entry_size: u64,
    metadata_size: u64,
    compression_ratio: u64,
}

impl PublicationArchive {
    pub(crate) fn parse(source: Arc<[u8]>) -> Result<Self, PublicationError> {
        Self::parse_with_limits(source, DEFAULT_LIMITS)
    }

    pub(crate) fn description(&self) -> &PublicationDescription {
        &self.description
    }

    pub(crate) fn metadata(&self) -> &PublicationMetadata {
        &self.metadata
    }

    pub(crate) fn load_cover(&self) -> Result<Option<PublicationCover>, PublicationError> {
        let Some(cover) = &self.cover else {
            return Ok(None);
        };
        Ok(Some(PublicationCover {
            href: cover.href.clone(),
            media_type: cover.media_type.clone(),
            bytes: self.read_resource(&cover.href)?,
        }))
    }

    pub(crate) fn load_section(&self, index: usize) -> Result<LoadedSection, PublicationError> {
        let section = self
            .description
            .sections
            .get(index)
            .ok_or(PublicationError::SectionOutOfRange)?;
        let bytes = self.read_resource(&section.href)?;

        Ok(LoadedSection {
            index,
            href: section.href.clone(),
            media_type: section.media_type.clone(),
            markup: blob_text(&bytes),
        })
    }

    pub(crate) fn load_resource(&self, path: &str) -> Result<Vec<u8>, PublicationError> {
        let path = canonical_zip_name(path).map_err(|_| PublicationError::UnsafeEntry)?;
        self.read_resource(&path)
    }

    pub(crate) fn resource_media_type(&self, path: &str) -> Option<&str> {
        let path = canonical_zip_name(path).ok()?;
        self.media_types.get(&path).map(String::as_str)
    }

    pub(crate) fn resource_size(&self, path: &str) -> Option<u64> {
        let path = canonical_zip_name(path).ok()?;
        self.entries
            .get(&path)
            .filter(|entry| !entry.is_directory)
            .map(|entry| entry.size)
    }

    fn parse_with_limits(
        source: Arc<[u8]>,
        limits: ArchiveLimits,
    ) -> Result<Self, PublicationError> {
        let declared_entries = declared_entry_count(&source)?;
        if declared_entries > limits.entry_count {
            return Err(PublicationError::EntryCountLimit);
        }
        let archive = ZipArchive::new(Cursor::new(source.clone()))
            .map_err(|_| PublicationError::InvalidZip)?;
        let entries = validate_archive(&archive, declared_entries, limits)?;

        let container =
            read_metadata_entry(&archive, &entries, CONTAINER_PATH, limits).map_err(|error| {
                match error {
                    PublicationError::MissingResource => PublicationError::MissingContainer,
                    other => other,
                }
            })?;
        let container = blob_text(&container);
        let package_path = parse_container(&container)?;
        if !has_file_entry(&entries, &package_path) {
            return Err(PublicationError::MissingPackage);
        }

        let package_bytes = read_metadata_entry(&archive, &entries, &package_path, limits)
            .map_err(|error| match error {
                PublicationError::MissingResource => PublicationError::MissingPackage,
                other => other,
            })?;
        let package = blob_text(&package_bytes);
        let parsed_package = parse_package(&package, &package_path, &entries)?;

        let media_types = parsed_package
            .manifest
            .iter()
            .map(|item| (item.path.clone(), item.media_type.clone()))
            .collect();
        let contents = load_contents(
            &archive,
            &entries,
            &parsed_package.manifest,
            parsed_package.ncx_id.as_deref(),
            limits,
        )?;
        let obfuscations = load_obfuscations(
            &archive,
            &entries,
            &parsed_package.unique_identifier,
            &parsed_package.identifiers,
            limits,
        )?;

        Ok(Self {
            _source: source,
            archive,
            entries,
            media_types,
            obfuscations,
            description: PublicationDescription {
                package_path,
                package,
                sections: parsed_package.sections,
                contents,
            },
            metadata: parsed_package.metadata,
            cover: parsed_package.cover,
            limits,
        })
    }

    fn read_resource(&self, path: &str) -> Result<Vec<u8>, PublicationError> {
        let mut bytes = read_zip_entry(&self.archive, &self.entries, path, self.limits)?;
        if let Some(obfuscation) = self.obfuscations.get(path) {
            obfuscation.deobfuscate(&mut bytes);
        }
        Ok(bytes)
    }
}

struct ParsedPackage {
    unique_identifier: String,
    identifiers: Vec<String>,
    manifest: Vec<ManifestItem>,
    sections: Vec<PublicationSection>,
    ncx_id: Option<String>,
    metadata: PublicationMetadata,
    cover: Option<CoverResource>,
}

fn validate_archive(
    archive: &ZipArchive<ArchiveReader>,
    declared_entries: usize,
    limits: ArchiveLimits,
) -> Result<HashMap<String, ArchiveEntry>, PublicationError> {
    if declared_entries != archive.len() {
        return Err(PublicationError::DuplicateEntry);
    }

    let mut archive = archive.clone();
    let mut entries = HashMap::with_capacity(archive.len());
    let mut total_size = 0_u64;

    for index in 0..archive.len() {
        let file = archive
            .by_index_raw(index)
            .map_err(|_| PublicationError::InvalidZip)?;
        let raw_name =
            std::str::from_utf8(file.name_raw()).map_err(|_| PublicationError::UnsafeEntry)?;
        let name = canonical_zip_name(raw_name).map_err(|_| PublicationError::UnsafeEntry)?;
        let size = file.size();
        let compressed_size = file.compressed_size();
        let is_directory = file.is_dir();

        if file.encrypted() {
            return Err(PublicationError::ZipEncryption);
        }
        if file.is_symlink() {
            return Err(PublicationError::SymbolicLink);
        }
        if let Some(mode) = file.unix_mode() {
            let kind = mode & 0o170000;
            if kind != 0 && kind != 0o040000 && kind != 0o100000 {
                return Err(PublicationError::UnsupportedEntryType);
            }
        }
        if !matches!(
            file.compression(),
            CompressionMethod::Stored | CompressionMethod::Deflated
        ) {
            return Err(PublicationError::UnsupportedCompression);
        }
        if size > limits.entry_size {
            return Err(PublicationError::EntrySizeLimit);
        }

        total_size = total_size
            .checked_add(size)
            .ok_or(PublicationError::TotalSizeLimit)?;
        if total_size > limits.total_size {
            return Err(PublicationError::TotalSizeLimit);
        }

        if size > 0
            && (compressed_size == 0
                || size > compressed_size.saturating_mul(limits.compression_ratio))
        {
            return Err(PublicationError::CompressionRatioLimit);
        }

        if entries
            .insert(
                name,
                ArchiveEntry {
                    index,
                    size,
                    is_directory,
                },
            )
            .is_some()
        {
            return Err(PublicationError::DuplicateEntry);
        }
    }

    Ok(entries)
}

fn declared_entry_count(source: &[u8]) -> Result<usize, PublicationError> {
    const SIGNATURE: &[u8; 4] = b"PK\x05\x06";
    const RECORD_SIZE: usize = 22;
    const MAX_COMMENT_SIZE: usize = u16::MAX as usize;

    let last_offset = source
        .len()
        .checked_sub(RECORD_SIZE)
        .ok_or(PublicationError::InvalidZip)?;
    let first_offset = source.len().saturating_sub(RECORD_SIZE + MAX_COMMENT_SIZE);

    for offset in (first_offset..=last_offset).rev() {
        if source.get(offset..offset + 4) != Some(SIGNATURE) {
            continue;
        }

        let comment_size = read_u16(source, offset + 20)? as usize;
        if offset + RECORD_SIZE + comment_size != source.len() {
            continue;
        }

        let disk = read_u16(source, offset + 4)?;
        let central_disk = read_u16(source, offset + 6)?;
        let entries_on_disk = read_u16(source, offset + 8)?;
        let entries = read_u16(source, offset + 10)?;
        if disk != 0 || central_disk != 0 || entries_on_disk != entries {
            return Err(PublicationError::InvalidZip);
        }
        if entries == u16::MAX {
            return Ok(usize::MAX);
        }

        return Ok(entries as usize);
    }

    Err(PublicationError::InvalidZip)
}

fn read_u16(source: &[u8], offset: usize) -> Result<u16, PublicationError> {
    let bytes: [u8; 2] = source
        .get(offset..offset + 2)
        .ok_or(PublicationError::InvalidZip)?
        .try_into()
        .map_err(|_| PublicationError::InvalidZip)?;
    Ok(u16::from_le_bytes(bytes))
}

fn read_zip_entry(
    archive: &ZipArchive<ArchiveReader>,
    entries: &HashMap<String, ArchiveEntry>,
    path: &str,
    limits: ArchiveLimits,
) -> Result<Vec<u8>, PublicationError> {
    let entry = entries
        .get(path)
        .filter(|entry| !entry.is_directory)
        .ok_or(PublicationError::MissingResource)?;
    let mut archive = archive.clone();
    let file = archive
        .by_index(entry.index)
        .map_err(|_| PublicationError::ReadFailed)?;
    let read_limit = entry
        .size
        .saturating_add(1)
        .min(limits.entry_size.saturating_add(1));
    let capacity = usize::try_from(entry.size).map_err(|_| PublicationError::EntrySizeLimit)?;
    let mut bytes = Vec::with_capacity(capacity);

    file.take(read_limit)
        .read_to_end(&mut bytes)
        .map_err(|_| PublicationError::ReadFailed)?;
    if bytes.len() as u64 != entry.size {
        return Err(PublicationError::ReadFailed);
    }

    Ok(bytes)
}

fn has_file_entry(entries: &HashMap<String, ArchiveEntry>, path: &str) -> bool {
    entries.get(path).is_some_and(|entry| !entry.is_directory)
}

fn read_metadata_entry(
    archive: &ZipArchive<ArchiveReader>,
    entries: &HashMap<String, ArchiveEntry>,
    path: &str,
    limits: ArchiveLimits,
) -> Result<Vec<u8>, PublicationError> {
    let entry = entries
        .get(path)
        .filter(|entry| !entry.is_directory)
        .ok_or(PublicationError::MissingResource)?;
    if entry.size > limits.metadata_size {
        return Err(PublicationError::MetadataSizeLimit);
    }

    read_zip_entry(archive, entries, path, limits)
}

fn parse_container(text: &str) -> Result<String, PublicationError> {
    let document = parse_xml(text).map_err(|_| PublicationError::InvalidContainer)?;
    let rootfile = document
        .descendants()
        .find(|node| {
            node.is_element()
                && node.tag_name().name() == "rootfile"
                && node.tag_name().namespace() == Some(CONTAINER_NAMESPACE)
                && node.attribute("media-type") == Some("application/oebps-package+xml")
        })
        .ok_or(PublicationError::InvalidContainer)?;
    let full_path = rootfile
        .attribute("full-path")
        .ok_or(PublicationError::InvalidContainer)?;

    resolve_root_path(full_path).map_err(|_| PublicationError::InvalidContainer)
}

fn parse_package(
    text: &str,
    package_path: &str,
    entries: &HashMap<String, ArchiveEntry>,
) -> Result<ParsedPackage, PublicationError> {
    let document = parse_xml(text).map_err(|_| PublicationError::InvalidPackage)?;
    let package = document.root_element();
    if package.tag_name().name() != "package" {
        return Err(PublicationError::InvalidPackage);
    }
    let namespace = package
        .namespaces()
        .any(|namespace| namespace.uri() == OPF_NAMESPACE)
        .then_some(OPF_NAMESPACE);
    let metadata = opf_child(package, "metadata", namespace);
    let manifest_node =
        opf_child(package, "manifest", namespace).ok_or(PublicationError::MissingManifest)?;
    let spine = opf_child(package, "spine", namespace).ok_or(PublicationError::MissingSpine)?;

    let (unique_identifier, identifiers) = package_identifiers(package, metadata);
    let publication_metadata = PublicationMetadata {
        title: metadata_value(metadata, "title"),
        author: metadata_value(metadata, "creator"),
        language: metadata_value(metadata, "language"),
        description: metadata_value(metadata, "description")
            .map(|value| clean_description(&value))
            .filter(|value| !value.is_empty()),
    };
    let legacy_cover_id = metadata.and_then(|metadata| {
        opf_children(metadata, "meta", namespace)
            .find(|node| node.attribute("name") == Some("cover"))
            .and_then(|node| node.attribute("content"))
            .map(str::to_owned)
    });
    let mut manifest = Vec::new();
    let mut manifest_ids = HashMap::new();

    for item in opf_children(manifest_node, "item", namespace) {
        let id = item
            .attribute("id")
            .ok_or(PublicationError::InvalidPackage)?;
        let href = item
            .attribute("href")
            .ok_or(PublicationError::InvalidPackage)?;
        let media_type = item
            .attribute("media-type")
            .ok_or(PublicationError::InvalidPackage)?;
        let reference = resolve_epub_reference(package_path, href)
            .map_err(|_| PublicationError::InvalidPackage)?
            .ok_or(PublicationError::InvalidPackage)?;
        if manifest_ids.contains_key(id) {
            return Err(PublicationError::InvalidPackage);
        }

        let index = manifest.len();
        manifest_ids.insert(id.to_owned(), index);
        manifest.push(ManifestItem {
            id: id.to_owned(),
            path: reference.path,
            media_type: media_type.to_owned(),
            properties: item
                .attribute("properties")
                .unwrap_or_default()
                .split_ascii_whitespace()
                .map(str::to_owned)
                .collect(),
        });
    }

    if manifest.is_empty() {
        return Err(PublicationError::MissingManifest);
    }

    let cover = manifest
        .iter()
        .find(|item| {
            item.properties
                .iter()
                .any(|property| property == "cover-image")
        })
        .or_else(|| {
            legacy_cover_id
                .as_deref()
                .and_then(|id| manifest.iter().find(|item| item.id == id))
        })
        .map(|item| CoverResource {
            href: item.path.clone(),
            media_type: item.media_type.clone(),
        });

    let mut sections = Vec::new();
    for (spine_index, itemref) in opf_children(spine, "itemref", namespace).enumerate() {
        let Some(idref) = itemref.attribute("idref") else {
            continue;
        };
        let Some(item) = manifest_ids
            .get(idref)
            .and_then(|index| manifest.get(*index))
        else {
            continue;
        };
        let Some(entry) = entries.get(&item.path).filter(|entry| !entry.is_directory) else {
            continue;
        };

        sections.push(PublicationSection {
            id: item.path.clone(),
            href: item.path.clone(),
            media_type: item.media_type.clone(),
            linear: itemref.attribute("linear") != Some("no"),
            spine_index,
            size: entry.size,
        });
    }

    if sections.is_empty() {
        return Err(PublicationError::EmptySpine);
    }

    Ok(ParsedPackage {
        unique_identifier,
        identifiers,
        manifest,
        sections,
        ncx_id: spine.attribute("toc").map(str::to_owned),
        metadata: publication_metadata,
        cover,
    })
}

fn load_contents(
    archive: &ZipArchive<ArchiveReader>,
    entries: &HashMap<String, ArchiveEntry>,
    manifest: &[ManifestItem],
    ncx_id: Option<&str>,
    limits: ArchiveLimits,
) -> Result<Vec<ContentsItem>, PublicationError> {
    let nav = manifest
        .iter()
        .find(|item| item.properties.iter().any(|property| property == "nav"));
    let ncx = ncx_id
        .and_then(|id| manifest.iter().find(|item| item.id == id))
        .or_else(|| {
            manifest
                .iter()
                .find(|item| item.media_type == "application/x-dtbncx+xml")
        });

    if let Some(nav) = nav {
        let parsed = read_metadata_entry(archive, entries, &nav.path, limits)
            .map(|bytes| blob_text(&bytes))
            .and_then(|text| parse_nav(&text, &nav.path));
        match parsed {
            Ok(contents) => return Ok(contents),
            Err(_) if ncx.is_some() => {}
            Err(_) => return Err(PublicationError::InvalidNavigation),
        }
    }

    if let Some(ncx) = ncx {
        let bytes = read_metadata_entry(archive, entries, &ncx.path, limits)
            .map_err(|_| PublicationError::InvalidNavigation)?;
        return parse_ncx(&blob_text(&bytes), &ncx.path);
    }

    Ok(Vec::new())
}

fn parse_nav(text: &str, nav_path: &str) -> Result<Vec<ContentsItem>, PublicationError> {
    let document = parse_xml(text).map_err(|_| PublicationError::InvalidNavigation)?;
    let nav = document
        .descendants()
        .find(|node| {
            node.is_element()
                && node.tag_name().name() == "nav"
                && node.attributes().any(|attribute| {
                    attribute.name() == "type"
                        && attribute
                            .value()
                            .split_ascii_whitespace()
                            .any(|value| value == "toc")
                })
        })
        .ok_or(PublicationError::InvalidNavigation)?;
    let list = child_named(nav, "ol")
        .or_else(|| {
            nav.descendants()
                .find(|node| node.is_element() && node.tag_name().name() == "ol")
        })
        .ok_or(PublicationError::InvalidNavigation)?;

    parse_nav_list(list, nav_path)
}

fn parse_nav_list(
    list: Node<'_, '_>,
    nav_path: &str,
) -> Result<Vec<ContentsItem>, PublicationError> {
    let mut items = Vec::new();

    for list_item in children_named(list, "li") {
        let target = child_named(list_item, "a").or_else(|| child_named(list_item, "span"));
        let nested = child_named(list_item, "ol");
        let subitems = nested
            .map(|list| parse_nav_list(list, nav_path))
            .transpose()?
            .unwrap_or_default();
        let label = target.map(label_text).unwrap_or_default();
        let href = match target.and_then(|node| node.attribute("href")) {
            Some(reference) => canonical_href(nav_path, reference)?,
            None => String::new(),
        };

        if label.is_empty() && href.is_empty() {
            items.extend(subitems);
        } else {
            items.push(ContentsItem {
                label,
                href,
                subitems,
            });
        }
    }

    Ok(items)
}

fn parse_ncx(text: &str, ncx_path: &str) -> Result<Vec<ContentsItem>, PublicationError> {
    let document = parse_xml(text).map_err(|_| PublicationError::InvalidNavigation)?;
    let nav_map = document
        .descendants()
        .find(|node| node.is_element() && node.tag_name().name() == "navMap")
        .ok_or(PublicationError::InvalidNavigation)?;

    parse_nav_points(nav_map, ncx_path)
}

fn parse_nav_points(
    parent: Node<'_, '_>,
    ncx_path: &str,
) -> Result<Vec<ContentsItem>, PublicationError> {
    let mut items = Vec::new();

    for point in children_named(parent, "navPoint") {
        let label = child_named(point, "navLabel")
            .and_then(|node| child_named(node, "text"))
            .map(label_text)
            .unwrap_or_default();
        let href = child_named(point, "content")
            .and_then(|node| node.attribute("src"))
            .map(|reference| canonical_href(ncx_path, reference))
            .transpose()?
            .unwrap_or_default();
        let subitems = parse_nav_points(point, ncx_path)?;

        if label.is_empty() && href.is_empty() {
            items.extend(subitems);
        } else {
            items.push(ContentsItem {
                label,
                href,
                subitems,
            });
        }
    }

    Ok(items)
}

fn load_obfuscations(
    archive: &ZipArchive<ArchiveReader>,
    entries: &HashMap<String, ArchiveEntry>,
    unique_identifier: &str,
    identifiers: &[String],
    limits: ArchiveLimits,
) -> Result<HashMap<String, FontObfuscation>, PublicationError> {
    if !has_file_entry(entries, ENCRYPTION_PATH) {
        return Ok(HashMap::new());
    }

    let bytes = read_metadata_entry(archive, entries, ENCRYPTION_PATH, limits)
        .map_err(|_| PublicationError::InvalidEncryption)?;
    let text = blob_text(&bytes);
    let document = parse_xml(&text).map_err(|_| PublicationError::InvalidEncryption)?;
    let mut obfuscations = HashMap::new();

    for encrypted_data in document
        .descendants()
        .filter(|node| node.is_element() && node.tag_name().name() == "EncryptedData")
    {
        let method = encrypted_data
            .descendants()
            .find(|node| node.is_element() && node.tag_name().name() == "EncryptionMethod")
            .and_then(|node| node.attribute("Algorithm"))
            .ok_or(PublicationError::InvalidEncryption)?;
        let reference = encrypted_data
            .descendants()
            .find(|node| node.is_element() && node.tag_name().name() == "CipherReference")
            .and_then(|node| node.attribute("URI"))
            .ok_or(PublicationError::InvalidEncryption)?;

        let obfuscation = match method {
            IDPF_ALGORITHM if !unique_identifier.is_empty() => {
                FontObfuscation::from_idpf_identifier(unique_identifier)
            }
            IDPF_ALGORITHM => return Err(PublicationError::InvalidEncryption),
            ADOBE_ALGORITHM => identifiers
                .iter()
                .find_map(|identifier| adobe_obfuscation(identifier))
                .ok_or(PublicationError::InvalidEncryption)?,
            _ => return Err(PublicationError::UnsupportedProtection),
        };
        let path = resolve_root_path(reference).map_err(|_| PublicationError::InvalidEncryption)?;
        if !has_file_entry(entries, &path) {
            return Err(PublicationError::InvalidEncryption);
        }
        if obfuscations.insert(path, obfuscation).is_some() {
            return Err(PublicationError::InvalidEncryption);
        }
    }

    Ok(obfuscations)
}

fn adobe_obfuscation(identifier: &str) -> Option<FontObfuscation> {
    FontObfuscation::from_adobe_identifier(identifier)
        .ok()
        .or_else(|| {
            identifier
                .rsplit_once(':')
                .and_then(|(_, suffix)| FontObfuscation::from_adobe_identifier(suffix).ok())
        })
}

fn parse_xml(text: &str) -> Result<Document<'_>, roxmltree::Error> {
    Document::parse_with_options(
        text,
        ParsingOptions {
            allow_dtd: true,
            nodes_limit: MAX_XML_NODES,
        },
    )
}

fn resolve_root_path(reference: &str) -> Result<String, ()> {
    let rooted = if reference.starts_with('/') {
        reference.to_owned()
    } else {
        format!("/{reference}")
    };
    resolve_epub_reference("_root", &rooted)
        .map_err(|_| ())?
        .map(|reference| reference.path)
        .ok_or(())
}

fn canonical_href(base_path: &str, reference: &str) -> Result<String, PublicationError> {
    match resolve_epub_reference(base_path, reference)
        .map_err(|_| PublicationError::InvalidNavigation)?
    {
        Some(reference) => Ok(join_reference(reference)),
        None => Ok(reference.to_owned()),
    }
}

fn join_reference(reference: EpubReference) -> String {
    match reference.fragment {
        Some(fragment) => format!("{}#{fragment}", reference.path),
        None => reference.path,
    }
}

fn package_identifiers(
    package: Node<'_, '_>,
    metadata: Option<Node<'_, '_>>,
) -> (String, Vec<String>) {
    let Some(metadata) = metadata else {
        return (String::new(), Vec::new());
    };
    let requested_id = package.attribute("unique-identifier");
    let mut identifiers: Vec<_> = metadata
        .children()
        .filter(|node| {
            node.is_element()
                && node.tag_name().name() == "identifier"
                && node.tag_name().namespace() == Some(DC_NAMESPACE)
        })
        .collect();
    if identifiers.is_empty() {
        identifiers = metadata
            .children()
            .filter(|node| {
                node.is_element()
                    && node.tag_name().name() == "identifier"
                    && node.tag_name().namespace().is_none()
            })
            .collect();
    }

    let unique_identifier = requested_id
        .and_then(|id| {
            identifiers
                .iter()
                .copied()
                .find(|node| node.attribute("id") == Some(id))
        })
        .or_else(|| identifiers.first().copied())
        .map(raw_text)
        .unwrap_or_default();
    let identifiers = identifiers.into_iter().map(raw_text).collect();

    (unique_identifier, identifiers)
}

fn metadata_value(metadata: Option<Node<'_, '_>>, name: &str) -> Option<String> {
    let metadata = metadata?;
    let node = metadata
        .children()
        .find(|node| {
            node.is_element()
                && node.tag_name().name() == name
                && node.tag_name().namespace() == Some(DC_NAMESPACE)
        })
        .or_else(|| {
            metadata.children().find(|node| {
                node.is_element()
                    && node.tag_name().name() == name
                    && node.tag_name().namespace().is_none()
            })
        })?;
    let value = normalize_whitespace(&raw_text(node));
    (!value.is_empty()).then_some(value)
}

fn clean_description(value: &str) -> String {
    let mut text = String::with_capacity(value.len());
    let mut in_tag = false;
    for character in value.chars() {
        match character {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => text.push(character),
            _ => {}
        }
    }
    normalize_whitespace(&text)
}

fn raw_text(node: Node<'_, '_>) -> String {
    node.descendants()
        .filter(|descendant| descendant.is_text())
        .filter_map(|descendant| descendant.text())
        .collect()
}

fn label_text(node: Node<'_, '_>) -> String {
    let visible = normalize_whitespace(&raw_text(node));
    if !visible.is_empty() {
        return visible;
    }

    let title = normalize_whitespace(node.attribute("title").unwrap_or_default());
    if !title.is_empty() {
        return title;
    }

    node.descendants()
        .filter(|descendant| descendant.is_element())
        .filter_map(|descendant| descendant.attribute("alt"))
        .map(normalize_whitespace)
        .find(|alternative| !alternative.is_empty())
        .unwrap_or_default()
}

fn normalize_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn opf_child<'a, 'input>(
    parent: Node<'a, 'input>,
    name: &'a str,
    namespace: Option<&'a str>,
) -> Option<Node<'a, 'input>> {
    opf_children(parent, name, namespace).next()
}

fn opf_children<'a, 'input>(
    parent: Node<'a, 'input>,
    name: &'a str,
    namespace: Option<&'a str>,
) -> impl Iterator<Item = Node<'a, 'input>> + 'a {
    parent.children().filter(move |node| {
        node.is_element()
            && node.tag_name().name() == name
            && node.tag_name().namespace() == namespace
    })
}

fn child_named<'a, 'input>(parent: Node<'a, 'input>, name: &'a str) -> Option<Node<'a, 'input>> {
    children_named(parent, name).next()
}

fn children_named<'a, 'input>(
    parent: Node<'a, 'input>,
    name: &'a str,
) -> impl Iterator<Item = Node<'a, 'input>> + 'a {
    parent
        .children()
        .filter(move |node| node.is_element() && node.tag_name().name() == name)
}

fn blob_text(bytes: &[u8]) -> String {
    let bytes = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes);
    String::from_utf8_lossy(bytes).into_owned()
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    use super::*;

    fn archive_bytes(entries: Vec<(&str, Vec<u8>, CompressionMethod)>) -> Arc<[u8]> {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        for (name, bytes, method) in entries {
            writer
                .start_file(
                    name,
                    SimpleFileOptions::default().compression_method(method),
                )
                .unwrap();
            writer.write_all(&bytes).unwrap();
        }
        Arc::from(writer.finish().unwrap().into_inner())
    }

    fn patch_header_u16(bytes: &mut [u8], signature: &[u8; 4], field_offset: usize, value: u16) {
        let offsets: Vec<_> = bytes
            .windows(signature.len())
            .enumerate()
            .filter_map(|(offset, window)| (window == signature).then_some(offset))
            .collect();
        for offset in offsets {
            bytes[offset + field_offset..offset + field_offset + 2]
                .copy_from_slice(&value.to_le_bytes());
        }
    }

    fn container(package_path: &str) -> Vec<u8> {
        format!(
            r#"<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="{package_path}" media-type="application/oebps-package+xml"/></rootfiles>
</container>"#
        )
        .into_bytes()
    }

    fn minimal_package(extra_manifest: &str, extra_spine: &str) -> Vec<u8> {
        format!(
            r#"<?xml version="1.0"?>
<package xmlns="{OPF_NAMESPACE}" unique-identifier="uid" version="3.0">
  <metadata><identifier xmlns="http://purl.org/dc/elements/1.1/" id="uid">book-id</identifier></metadata>
  <manifest>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
    {extra_manifest}
  </manifest>
  <spine><itemref idref="chapter"/>{extra_spine}</spine>
</package>"#
        )
        .into_bytes()
    }

    #[test]
    fn selects_the_first_supported_container_rootfile() {
        let text = r#"<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"
 xmlns:other="urn:example:other">
  <rootfiles>
    <other:rootfile full-path="wrong-namespace.opf" media-type="application/oebps-package+xml"/>
    <rootfile full-path="wrong-media.opf" media-type="application/xml"/>
    <rootfile full-path="OPS/book%20one.opf" media-type="application/oebps-package+xml"/>
    <rootfile full-path="later.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"#;

        assert_eq!(parse_container(text), Ok("OPS/book one.opf".to_owned()));
    }

    #[test]
    fn follows_the_prefixed_opf_namespace_switch() {
        let package = r#"<package xmlns:opf="http://www.idpf.org/2007/opf"
 xmlns:dc="http://purl.org/dc/elements/1.1/"
 xmlns:other="urn:example:other"
 unique-identifier="uid">
  <opf:metadata><dc:identifier id="uid">prefixed-book</dc:identifier></opf:metadata>
  <opf:manifest>
    <other:item id="wrong" href="wrong.xhtml" media-type="application/xhtml+xml"/>
    <opf:item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
  </opf:manifest>
  <opf:spine><opf:itemref idref="chapter"/></opf:spine>
</package>"#;
        let entries = HashMap::from([(
            "OPS/chapter.xhtml".to_owned(),
            ArchiveEntry {
                index: 0,
                size: 7,
                is_directory: false,
            },
        )]);

        let parsed = parse_package(package, "OPS/package.opf", &entries).unwrap();

        assert_eq!(parsed.unique_identifier, "prefixed-book");
        assert_eq!(parsed.manifest.len(), 1);
        assert_eq!(parsed.sections[0].spine_index, 0);
    }

    #[test]
    fn navigation_labels_prefer_visible_text_then_title_then_alt() {
        let visible =
            parse_xml(r#"<a title="Wrong"><span>Visible text</span><img alt="Wrong alt"/></a>"#)
                .unwrap();
        assert_eq!(label_text(visible.root_element()), "Visible text");

        let title = parse_xml(r#"<a title="Title fallback"><img alt="Wrong alt"/></a>"#).unwrap();
        assert_eq!(label_text(title.root_element()), "Title fallback");

        let alt = parse_xml(r#"<a><img alt="Image fallback"/></a>"#).unwrap();
        assert_eq!(label_text(alt.root_element()), "Image fallback");

        let split_word = parse_xml(r#"<a>Chap<em>ter</em></a>"#).unwrap();
        assert_eq!(label_text(split_word.root_element()), "Chapter");
    }

    #[test]
    fn caps_metadata_below_the_general_entry_limit() {
        assert_eq!(DEFAULT_LIMITS.metadata_size, 32 * 1024 * 1024);
        let source = archive_bytes(vec![
            (
                CONTAINER_PATH,
                container("OPS/package.opf"),
                CompressionMethod::Stored,
            ),
            (
                "OPS/package.opf",
                minimal_package("", ""),
                CompressionMethod::Stored,
            ),
            (
                "OPS/chapter.xhtml",
                b"<html/>".to_vec(),
                CompressionMethod::Stored,
            ),
        ]);
        let limits = ArchiveLimits {
            metadata_size: 32,
            ..DEFAULT_LIMITS
        };

        assert!(matches!(
            PublicationArchive::parse_with_limits(source, limits),
            Err(PublicationError::MetadataSizeLimit)
        ));
    }

    #[test]
    fn parses_epub3_nested_navigation_and_original_spine_ordinals() {
        let package_text = r#"<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:other="urn:example:other" unique-identifier="uid" version="3.0">
  <metadata>
    <dc:identifier id="uid">book-id</dc:identifier>
    <dc:title> The Example Book </dc:title>
    <dc:creator>Writer Name</dc:creator>
    <dc:language>en</dc:language>
    <dc:description>&lt;p&gt;A short &lt;em&gt;synopsis&lt;/em&gt;.&lt;/p&gt;</dc:description>
    <other:title>Wrong title</other:title>
  </metadata>
  <manifest>
    <item id="gone" href="Text/gone.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter" href="Text/chapter%20one.xhtml" media-type="application/xhtml+xml"/>
    <item id="cover" href="Images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
  </manifest>
  <spine>
    <itemref idref="gone"/>
    <itemref idref="chapter" linear="no"/>
  </spine>
</package>"#;
        let mut package = vec![0xef, 0xbb, 0xbf];
        package.extend_from_slice(package_text.as_bytes());
        let nav = br#"<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body><nav epub:type="landmarks toc">
    <ol>
      <li><a title="Wrong title" href="Text/chapter%20one.xhtml?cache=1#part%201">Chapter <em>One</em><img alt="Wrong alt"/></a>
        <ol><li><a href="Text/chapter%20one.xhtml#deep%20part"><img alt="Deep"/></a></li></ol>
      </li>
      <li><span>Part Two</span></li>
      <li><ol><li><a href="https://example.com/help?from=toc#topic">External</a></li></ol></li>
    </ol>
  </nav></body>
</html>"#;
        let mut chapter = vec![0xef, 0xbb, 0xbf];
        chapter.extend_from_slice(b"<html><body>hello ");
        chapter.push(0xff);
        chapter.extend_from_slice(b"</body></html>");
        let source = archive_bytes(vec![
            (
                CONTAINER_PATH,
                container("OPS/package%20file.opf"),
                CompressionMethod::Stored,
            ),
            ("OPS/package file.opf", package, CompressionMethod::Deflated),
            ("OPS/nav.xhtml", nav.to_vec(), CompressionMethod::Deflated),
            (
                "OPS/Text/chapter one.xhtml",
                chapter,
                CompressionMethod::Deflated,
            ),
            (
                "OPS/Images/cover.jpg",
                b"cover bytes".to_vec(),
                CompressionMethod::Stored,
            ),
        ]);

        let publication = PublicationArchive::parse(source).unwrap();
        let description = publication.description();

        assert_eq!(
            publication.metadata(),
            &PublicationMetadata {
                title: Some("The Example Book".to_owned()),
                author: Some("Writer Name".to_owned()),
                language: Some("en".to_owned()),
                description: Some("A short synopsis.".to_owned()),
            }
        );
        assert_eq!(
            publication.load_cover().unwrap(),
            Some(PublicationCover {
                href: "OPS/Images/cover.jpg".to_owned(),
                media_type: "image/jpeg".to_owned(),
                bytes: b"cover bytes".to_vec(),
            })
        );
        assert_eq!(description.package_path, "OPS/package file.opf");
        assert_eq!(description.package, package_text);
        assert_eq!(description.sections.len(), 1);
        assert_eq!(
            description.sections[0],
            PublicationSection {
                id: "OPS/Text/chapter one.xhtml".to_owned(),
                href: "OPS/Text/chapter one.xhtml".to_owned(),
                media_type: "application/xhtml+xml".to_owned(),
                linear: false,
                spine_index: 1,
                size: 36,
            }
        );
        assert_eq!(description.contents[0].label, "Chapter One");
        assert_eq!(
            description.contents[0].href,
            "OPS/Text/chapter one.xhtml#part 1"
        );
        assert_eq!(description.contents[0].subitems[0].label, "Deep");
        assert_eq!(
            description.contents[0].subitems[0].href,
            "OPS/Text/chapter one.xhtml#deep part"
        );
        assert_eq!(description.contents[1].label, "Part Two");
        assert!(description.contents[1].href.is_empty());
        assert_eq!(description.contents[2].label, "External");
        assert_eq!(
            description.contents[2].href,
            "https://example.com/help?from=toc#topic"
        );
        assert_eq!(
            publication.resource_media_type("OPS/Text/chapter one.xhtml"),
            Some("application/xhtml+xml")
        );
        assert_eq!(
            publication.resource_size("OPS/Text/chapter one.xhtml"),
            Some(36)
        );

        let loaded = publication.load_section(0).unwrap();
        assert_eq!(loaded.index, 0);
        assert!(!loaded.markup.starts_with('\u{feff}'));
        assert!(loaded.markup.contains('\u{fffd}'));
        assert_eq!(
            publication.load_section(1),
            Err(PublicationError::SectionOutOfRange)
        );
    }

    #[test]
    fn falls_back_to_nested_epub2_ncx() {
        let package = br#"<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uid" version="2.0">
  <metadata>
    <dc:identifier xmlns:dc="http://purl.org/dc/elements/1.1/" id="uid">legacy</dc:identifier>
    <meta name="cover" content="legacy-cover"/>
  </metadata>
  <manifest>
    <item id="chapter" href="Text/chapter.xhtml" media-type="application/xhtml+xml"/>
    <item id="legacy-cover" href="Images/cover.png" media-type="image/png"/>
    <item id="other-ncx" href="other.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="toc" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
  </manifest>
  <spine toc="toc"><itemref idref="chapter"/></spine>
</package>"#;
        let ncx = br#"<?xml version="1.0"?>
<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/">
  <navMap>
    <navPoint><navLabel><text>Start</text></navLabel><content src="Text/chapter.xhtml#start%20here"/>
      <navPoint><navLabel><text>Child</text></navLabel><content src="Text/chapter.xhtml#child"/></navPoint>
    </navPoint>
  </navMap>
</ncx>"#;
        let source = archive_bytes(vec![
            (
                CONTAINER_PATH,
                container("content.opf"),
                CompressionMethod::Stored,
            ),
            ("content.opf", package.to_vec(), CompressionMethod::Stored),
            (
                "Text/chapter.xhtml",
                b"<html/>".to_vec(),
                CompressionMethod::Stored,
            ),
            (
                "Images/cover.png",
                b"legacy cover".to_vec(),
                CompressionMethod::Stored,
            ),
            (
                "other.ncx",
                b"<ncx><navMap/></ncx>".to_vec(),
                CompressionMethod::Stored,
            ),
            ("toc.ncx", ncx.to_vec(), CompressionMethod::Deflated),
        ]);

        let publication = PublicationArchive::parse(source).unwrap();
        let contents = &publication.description().contents;

        assert_eq!(contents[0].label, "Start");
        assert_eq!(contents[0].href, "Text/chapter.xhtml#start here");
        assert_eq!(contents[0].subitems[0].label, "Child");
        assert_eq!(contents[0].subitems[0].href, "Text/chapter.xhtml#child");
        assert_eq!(
            publication.load_cover().unwrap(),
            Some(PublicationCover {
                href: "Images/cover.png".to_owned(),
                media_type: "image/png".to_owned(),
                bytes: b"legacy cover".to_vec(),
            })
        );
    }

    #[test]
    fn rejects_missing_and_unsafe_archive_entries() {
        let missing = archive_bytes(vec![(
            "mimetype",
            b"application/epub+zip".to_vec(),
            CompressionMethod::Stored,
        )]);
        assert!(matches!(
            PublicationArchive::parse(missing),
            Err(PublicationError::MissingContainer)
        ));

        let unsafe_path = archive_bytes(vec![(
            "../outside",
            b"x".to_vec(),
            CompressionMethod::Stored,
        )]);
        assert!(matches!(
            PublicationArchive::parse(unsafe_path),
            Err(PublicationError::UnsafeEntry)
        ));

        let duplicate = archive_bytes(vec![
            ("OPS/book.opf", b"a".to_vec(), CompressionMethod::Stored),
            ("OPS/./book.opf", b"b".to_vec(), CompressionMethod::Stored),
        ]);
        assert!(matches!(
            PublicationArchive::parse(duplicate),
            Err(PublicationError::DuplicateEntry)
        ));

        let exact_duplicate = archive_bytes(vec![
            ("one", b"a".to_vec(), CompressionMethod::Stored),
            ("two", b"b".to_vec(), CompressionMethod::Stored),
        ]);
        let mut exact_duplicate = exact_duplicate.to_vec();
        for offset in (0..=exact_duplicate.len() - 3)
            .filter(|offset| &exact_duplicate[*offset..*offset + 3] == b"two")
            .collect::<Vec<_>>()
        {
            exact_duplicate[offset..offset + 3].copy_from_slice(b"one");
        }
        assert!(matches!(
            PublicationArchive::parse(Arc::from(exact_duplicate)),
            Err(PublicationError::DuplicateEntry)
        ));

        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        writer
            .add_symlink("OPS/link", "target", SimpleFileOptions::default())
            .unwrap();
        let symlink: Arc<[u8]> = Arc::from(writer.finish().unwrap().into_inner());
        assert!(matches!(
            PublicationArchive::parse(symlink),
            Err(PublicationError::SymbolicLink)
        ));
    }

    #[test]
    fn rejects_zip_encryption_and_unsupported_compression() {
        let source = archive_bytes(vec![(
            "entry",
            b"content".to_vec(),
            CompressionMethod::Stored,
        )]);
        let mut encrypted = source.to_vec();
        patch_header_u16(&mut encrypted, b"PK\x03\x04", 6, 1);
        patch_header_u16(&mut encrypted, b"PK\x01\x02", 8, 1);
        assert!(matches!(
            PublicationArchive::parse(Arc::from(encrypted)),
            Err(PublicationError::ZipEncryption)
        ));

        let mut unsupported = source.to_vec();
        patch_header_u16(&mut unsupported, b"PK\x03\x04", 8, 12);
        patch_header_u16(&mut unsupported, b"PK\x01\x02", 10, 12);
        assert!(matches!(
            PublicationArchive::parse(Arc::from(unsupported)),
            Err(PublicationError::UnsupportedCompression)
        ));
    }

    #[test]
    fn enforces_count_size_and_compression_limits() {
        let one = archive_bytes(vec![("one", vec![0_u8; 32], CompressionMethod::Stored)]);
        let entry_limit = ArchiveLimits {
            entry_size: 31,
            ..DEFAULT_LIMITS
        };
        assert!(matches!(
            PublicationArchive::parse_with_limits(one, entry_limit),
            Err(PublicationError::EntrySizeLimit)
        ));

        let two = archive_bytes(vec![
            ("one", vec![0_u8; 12], CompressionMethod::Stored),
            ("two", vec![0_u8; 12], CompressionMethod::Stored),
        ]);
        let total_limit = ArchiveLimits {
            total_size: 23,
            ..DEFAULT_LIMITS
        };
        assert!(matches!(
            PublicationArchive::parse_with_limits(two.clone(), total_limit),
            Err(PublicationError::TotalSizeLimit)
        ));
        let count_limit = ArchiveLimits {
            entry_count: 1,
            ..DEFAULT_LIMITS
        };
        assert!(matches!(
            PublicationArchive::parse_with_limits(two, count_limit),
            Err(PublicationError::EntryCountLimit)
        ));

        let compressed = archive_bytes(vec![(
            "compressed",
            vec![b'a'; 4_096],
            CompressionMethod::Deflated,
        )]);
        let ratio_limit = ArchiveLimits {
            compression_ratio: 2,
            ..DEFAULT_LIMITS
        };
        assert!(matches!(
            PublicationArchive::parse_with_limits(compressed, ratio_limit),
            Err(PublicationError::CompressionRatioLimit)
        ));
    }

    #[test]
    fn deobfuscates_idpf_and_adobe_fonts() {
        let unique_identifier = "primary-book-id";
        let adobe_identifier = "uuid:00112233-4455-6677-8899-aabbccddeeff";
        let idpf_original = vec![0x31; 1_100];
        let adobe_original = vec![0x72; 1_100];
        let mut idpf_stored = idpf_original.clone();
        let mut adobe_stored = adobe_original.clone();
        FontObfuscation::from_idpf_identifier(unique_identifier).deobfuscate(&mut idpf_stored);
        FontObfuscation::from_adobe_identifier("00112233-4455-6677-8899-aabbccddeeff")
            .unwrap()
            .deobfuscate(&mut adobe_stored);
        let package = format!(
            r#"<?xml version="1.0"?>
<package xmlns="{OPF_NAMESPACE}" unique-identifier="uid" version="3.0">
  <metadata>
    <identifier xmlns="http://purl.org/dc/elements/1.1/" id="uid">{unique_identifier}</identifier>
    <identifier xmlns="http://purl.org/dc/elements/1.1/" id="adobe-id">{adobe_identifier}</identifier>
  </metadata>
  <manifest>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
    <item id="idpf" href="Fonts/idpf%20font.otf" media-type="font/otf"/>
    <item id="adobe" href="Fonts/adobe.otf" media-type="font/otf"/>
  </manifest>
  <spine><itemref idref="chapter"/></spine>
</package>"#
        );
        let encryption = format!(
            r#"<?xml version="1.0"?>
<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"
 xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
  <enc:EncryptedData>
    <enc:EncryptionMethod Algorithm="{}"/>
    <enc:CipherData><enc:CipherReference URI="OPS/Fonts/idpf%20font.otf"/></enc:CipherData>
  </enc:EncryptedData>
  <enc:EncryptedData>
    <enc:EncryptionMethod Algorithm="{}"/>
    <enc:CipherData><enc:CipherReference URI="OPS/Fonts/adobe.otf"/></enc:CipherData>
  </enc:EncryptedData>
</encryption>"#,
            super::super::encryption::IDPF_ALGORITHM,
            super::super::encryption::ADOBE_ALGORITHM,
        );
        let source = archive_bytes(vec![
            (
                CONTAINER_PATH,
                container("OPS/package.opf"),
                CompressionMethod::Stored,
            ),
            (
                "OPS/package.opf",
                package.into_bytes(),
                CompressionMethod::Stored,
            ),
            (
                "OPS/chapter.xhtml",
                b"<html/>".to_vec(),
                CompressionMethod::Stored,
            ),
            (
                "OPS/Fonts/idpf font.otf",
                idpf_stored,
                CompressionMethod::Stored,
            ),
            (
                "OPS/Fonts/adobe.otf",
                adobe_stored,
                CompressionMethod::Stored,
            ),
            (
                ENCRYPTION_PATH,
                encryption.into_bytes(),
                CompressionMethod::Stored,
            ),
        ]);

        let publication = PublicationArchive::parse(source).unwrap();

        assert_eq!(
            publication
                .load_resource("OPS/Fonts/idpf font.otf")
                .unwrap(),
            idpf_original
        );
        assert_eq!(
            publication.load_resource("OPS/Fonts/adobe.otf").unwrap(),
            adobe_original
        );
        assert_eq!(
            publication.resource_media_type("OPS/Fonts/adobe.otf"),
            Some("font/otf")
        );
    }

    #[test]
    fn rejects_unknown_resource_protection() {
        let encryption = br#"<?xml version="1.0"?>
<encryption xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
  <enc:EncryptedData>
    <enc:EncryptionMethod Algorithm="urn:example:drm"/>
    <enc:CipherData><enc:CipherReference URI="OPS/font.otf"/></enc:CipherData>
  </enc:EncryptedData>
</encryption>"#;
        let source = archive_bytes(vec![
            (
                CONTAINER_PATH,
                container("OPS/package.opf"),
                CompressionMethod::Stored,
            ),
            (
                "OPS/package.opf",
                minimal_package(
                    r#"<item id="font" href="font.otf" media-type="font/otf"/>"#,
                    "",
                ),
                CompressionMethod::Stored,
            ),
            (
                "OPS/chapter.xhtml",
                b"<html/>".to_vec(),
                CompressionMethod::Stored,
            ),
            ("OPS/font.otf", vec![0_u8; 32], CompressionMethod::Stored),
            (
                ENCRYPTION_PATH,
                encryption.to_vec(),
                CompressionMethod::Stored,
            ),
        ]);

        assert!(matches!(
            PublicationArchive::parse(source),
            Err(PublicationError::UnsupportedProtection)
        ));
    }
}
