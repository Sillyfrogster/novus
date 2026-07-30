use std::error::Error;
use std::fmt;

use sha1::{Digest, Sha1};
use uuid::Uuid;

pub(crate) const IDPF_ALGORITHM: &str = "http://www.idpf.org/2008/embedding";
pub(crate) const ADOBE_ALGORITHM: &str = "http://ns.adobe.com/pdf/enc#RC";

const IDPF_PREFIX_LENGTH: usize = 1_040;
const ADOBE_PREFIX_LENGTH: usize = 1_024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum FontObfuscation {
    Idpf([u8; 20]),
    Adobe([u8; 16]),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FontKeyError {
    InvalidAdobeIdentifier,
}

impl fmt::Display for FontKeyError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidAdobeIdentifier => {
                formatter.write_str("Adobe font obfuscation requires a UUID identifier")
            }
        }
    }
}

impl Error for FontKeyError {}

impl FontObfuscation {
    pub(crate) fn from_algorithm(
        algorithm: &str,
        package_identifier: &str,
    ) -> Result<Option<Self>, FontKeyError> {
        match algorithm {
            IDPF_ALGORITHM => Ok(Some(Self::from_idpf_identifier(package_identifier))),
            ADOBE_ALGORITHM => Self::from_adobe_identifier(package_identifier).map(Some),
            _ => Ok(None),
        }
    }

    pub(crate) fn from_idpf_identifier(identifier: &str) -> Self {
        let normalized: String = identifier
            .chars()
            .filter(|character| !matches!(character, ' ' | '\t' | '\r' | '\n'))
            .collect();
        let digest = Sha1::digest(normalized.as_bytes());
        let mut key = [0_u8; 20];
        key.copy_from_slice(&digest);
        Self::Idpf(key)
    }

    pub(crate) fn from_adobe_identifier(identifier: &str) -> Result<Self, FontKeyError> {
        let identifier = identifier.trim();
        let uuid_prefix = "urn:uuid:";
        let identifier = identifier
            .get(..uuid_prefix.len())
            .filter(|prefix| prefix.eq_ignore_ascii_case(uuid_prefix))
            .map_or(identifier, |_| &identifier[uuid_prefix.len()..]);
        let uuid = Uuid::parse_str(identifier).map_err(|_| FontKeyError::InvalidAdobeIdentifier)?;

        Ok(Self::Adobe(*uuid.as_bytes()))
    }

    pub(crate) fn deobfuscate(&self, bytes: &mut [u8]) {
        let (key, prefix_length): (&[u8], usize) = match self {
            Self::Idpf(key) => (key, IDPF_PREFIX_LENGTH),
            Self::Adobe(key) => (key, ADOBE_PREFIX_LENGTH),
        };

        for (byte, key_byte) in bytes.iter_mut().take(prefix_length).zip(key.iter().cycle()) {
            *byte ^= key_byte;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derives_the_idpf_key_from_the_whitespace_free_identifier() {
        let obfuscation = FontObfuscation::from_idpf_identifier("a b\tc\r\n");
        let FontObfuscation::Idpf(key) = obfuscation else {
            panic!("expected an IDPF key");
        };

        assert_eq!(
            key,
            [
                0xa9, 0x99, 0x3e, 0x36, 0x47, 0x06, 0x81, 0x6a, 0xba, 0x3e, 0x25, 0x71, 0x78, 0x50,
                0xc2, 0x6c, 0x9c, 0xd0, 0xd8, 0x9d,
            ]
        );
    }

    #[test]
    fn preserves_non_xml_whitespace_in_idpf_identifiers() {
        assert_ne!(
            FontObfuscation::from_idpf_identifier("a\u{a0}b"),
            FontObfuscation::from_idpf_identifier("ab")
        );
    }

    #[test]
    fn derives_the_adobe_key_from_a_urn_uuid() {
        let obfuscation =
            FontObfuscation::from_adobe_identifier("URN:UUID:00112233-4455-6677-8899-aabbccddeeff")
                .unwrap();
        let FontObfuscation::Adobe(key) = obfuscation else {
            panic!("expected an Adobe key");
        };

        assert_eq!(
            key,
            [
                0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd,
                0xee, 0xff,
            ]
        );
    }

    #[test]
    fn rejects_invalid_adobe_identifiers() {
        assert_eq!(
            FontObfuscation::from_adobe_identifier("not-a-uuid"),
            Err(FontKeyError::InvalidAdobeIdentifier)
        );
    }

    #[test]
    fn maps_supported_algorithms() {
        assert!(matches!(
            FontObfuscation::from_algorithm(IDPF_ALGORITHM, "book-id"),
            Ok(Some(FontObfuscation::Idpf(_)))
        ));
        assert!(matches!(
            FontObfuscation::from_algorithm(
                ADOBE_ALGORITHM,
                "00112233-4455-6677-8899-aabbccddeeff"
            ),
            Ok(Some(FontObfuscation::Adobe(_)))
        ));
        assert_eq!(
            FontObfuscation::from_algorithm("urn:example:encryption", "book-id"),
            Ok(None)
        );
    }

    #[test]
    fn deobfuscates_only_the_idpf_prefix() {
        let obfuscation = FontObfuscation::Idpf([0xaa; 20]);
        let mut bytes = vec![0_u8; IDPF_PREFIX_LENGTH + 2];

        obfuscation.deobfuscate(&mut bytes);

        assert!(bytes[..IDPF_PREFIX_LENGTH].iter().all(|byte| *byte == 0xaa));
        assert_eq!(&bytes[IDPF_PREFIX_LENGTH..], &[0, 0]);
    }

    #[test]
    fn deobfuscates_only_the_adobe_prefix() {
        let obfuscation = FontObfuscation::Adobe([0x55; 16]);
        let mut bytes = vec![0_u8; ADOBE_PREFIX_LENGTH + 2];

        obfuscation.deobfuscate(&mut bytes);

        assert!(bytes[..ADOBE_PREFIX_LENGTH]
            .iter()
            .all(|byte| *byte == 0x55));
        assert_eq!(&bytes[ADOBE_PREFIX_LENGTH..], &[0, 0]);
    }

    #[test]
    fn deobfuscation_is_symmetric_for_short_resources() {
        let obfuscation = FontObfuscation::Adobe([0x5a; 16]);
        let original = vec![1_u8, 2, 3, 4, 5];
        let mut bytes = original.clone();

        obfuscation.deobfuscate(&mut bytes);
        assert_ne!(bytes, original);
        obfuscation.deobfuscate(&mut bytes);

        assert_eq!(bytes, original);
    }
}
