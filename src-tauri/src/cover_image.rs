use std::io::{Cursor, Write};
use std::path::Path;

use image::codecs::jpeg::JpegEncoder;
use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader};

const MAX_COVER_WIDTH: u32 = 512;
const MAX_COVER_HEIGHT: u32 = 768;
const JPEG_QUALITY: u8 = 84;

pub fn optimize_imported_cover(data: Vec<u8>) -> Vec<u8> {
    resize_cover(&data).ok().flatten().unwrap_or(data)
}

pub fn optimize_managed_covers(directory: &Path) -> usize {
    let Ok(entries) = std::fs::read_dir(directory) else {
        return 0;
    };
    let mut optimized = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            continue;
        }
        match optimize_managed_cover(&path) {
            Ok(true) => optimized += 1,
            Ok(false) => {}
            Err(error) => eprintln!("Could not optimize cover {}: {error}", path.display()),
        }
    }
    optimized
}

fn optimize_managed_cover(path: &Path) -> Result<bool, Box<dyn std::error::Error>> {
    let reader = ImageReader::open(path)?.with_guessed_format()?;
    let Some(
        format @ (ImageFormat::Gif | ImageFormat::Jpeg | ImageFormat::Png | ImageFormat::WebP),
    ) = reader.format()
    else {
        return Ok(false);
    };
    let (width, height) = reader.into_dimensions()?;
    if fits_cover_bounds(width, height) {
        return Ok(false);
    }

    let data = std::fs::read(path)?;
    let Some(resized) = resize_cover_with_format(&data, format)? else {
        return Ok(false);
    };
    let parent = path.parent().ok_or("cover has no parent directory")?;
    let mut staged = tempfile::NamedTempFile::new_in(parent)?;
    staged.write_all(&resized)?;
    staged.as_file().sync_all()?;
    staged.persist(path)?;
    Ok(true)
}

fn resize_cover(data: &[u8]) -> image::ImageResult<Option<Vec<u8>>> {
    let format = image::guess_format(data)?;
    resize_cover_with_format(data, format)
}

fn resize_cover_with_format(
    data: &[u8],
    format: ImageFormat,
) -> image::ImageResult<Option<Vec<u8>>> {
    if !matches!(
        format,
        ImageFormat::Gif | ImageFormat::Jpeg | ImageFormat::Png | ImageFormat::WebP
    ) {
        return Ok(None);
    }
    let reader = ImageReader::with_format(Cursor::new(data), format);
    let (width, height) = reader.into_dimensions()?;
    if fits_cover_bounds(width, height) {
        return Ok(None);
    }

    let mut decoder = ImageReader::with_format(Cursor::new(data), format).into_decoder()?;
    let orientation = decoder.orientation()?;
    let mut image = DynamicImage::from_decoder(decoder)?;
    image.apply_orientation(orientation);
    let resized = image.thumbnail(MAX_COVER_WIDTH, MAX_COVER_HEIGHT);
    encode_cover(&resized, format).map(Some)
}

fn encode_cover(image: &DynamicImage, format: ImageFormat) -> image::ImageResult<Vec<u8>> {
    let mut output = Vec::new();
    match format {
        ImageFormat::Jpeg => {
            JpegEncoder::new_with_quality(&mut output, JPEG_QUALITY).encode_image(image)?;
        }
        ImageFormat::Gif | ImageFormat::Png | ImageFormat::WebP => {
            image.write_to(&mut Cursor::new(&mut output), format)?;
        }
        _ => unreachable!(),
    }
    Ok(output)
}

fn fits_cover_bounds(width: u32, height: u32) -> bool {
    width <= MAX_COVER_WIDTH && height <= MAX_COVER_HEIGHT
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{GenericImageView, Rgb, RgbImage};

    fn jpeg(width: u32, height: u32) -> Vec<u8> {
        let image = RgbImage::from_pixel(width, height, Rgb([32, 46, 68]));
        let mut data = Vec::new();
        JpegEncoder::new_with_quality(&mut data, 90)
            .encode_image(&image)
            .unwrap();
        data
    }

    #[test]
    fn shrinks_oversized_covers_to_display_bounds() {
        let resized = resize_cover(&jpeg(1600, 2400)).unwrap().unwrap();
        let image = image::load_from_memory(&resized).unwrap();

        assert_eq!(image.dimensions(), (512, 768));
    }

    #[test]
    fn keeps_small_covers_unchanged() {
        assert!(resize_cover(&jpeg(320, 480)).unwrap().is_none());
    }

    #[test]
    fn shrinks_common_web_cover_formats() {
        for format in [ImageFormat::Gif, ImageFormat::Png, ImageFormat::WebP] {
            let image =
                DynamicImage::ImageRgb8(RgbImage::from_pixel(1200, 1800, Rgb([32, 46, 68])));
            let mut data = Vec::new();
            image.write_to(&mut Cursor::new(&mut data), format).unwrap();

            let resized = resize_cover(&data).unwrap().unwrap();
            let image = image::load_from_memory_with_format(&resized, format).unwrap();
            assert_eq!(image.dimensions(), (512, 768));
        }
    }
}
