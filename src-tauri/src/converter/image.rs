//! 图片互转——image crate（png/jpg/webp/bmp/gif/tiff/ico），ico 多尺寸（ico crate）
//! 质量参数仅对 jpg 生效（1-100，默认 85）；webp 输出为无损；gif 输出取首帧静态。

use super::detect::{normalize_ext, IMAGE_INPUT_EXTS};
use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::ImageFormat;
use std::fs;
use std::path::{Path, PathBuf};

pub fn can_decode(path: &Path) -> bool {
    let ext = normalize_ext(path);
    // jpeg/tif 是 IMAGE_INPUT_EXTS 的规范化别名
    IMAGE_INPUT_EXTS.contains(&ext.as_str())
}

/// 按目标扩展名保存。quality 仅 jpg 生效。
pub fn convert(src: &Path, target: &str, quality: u8, out_path: &Path) -> Result<(), String> {
    let img = image::open(src).map_err(|e| format!("图片解码失败: {}", e))?;
    let t = target.to_ascii_lowercase();
    match t.as_str() {
        "jpg" | "jpeg" => {
            let file = fs::File::create(out_path).map_err(|e| format!("创建输出文件失败: {}", e))?;
            let q = quality.clamp(1, 100);
            let encoder = JpegEncoder::new_with_quality(&file, q);
            img.write_with_encoder(encoder)
                .map_err(|e| format!("JPEG 编码失败: {}", e))?;
        }
        "png" | "bmp" | "tiff" | "webp" => {
            let format = match t.as_str() {
                "png" => ImageFormat::Png,
                "bmp" => ImageFormat::Bmp,
                "tiff" => ImageFormat::Tiff,
                _ => ImageFormat::WebP,
            };
            img.save_with_format(out_path, format)
                .map_err(|e| format!("{} 编码失败: {}", t.to_uppercase(), e))?;
        }
        "gif" => {
            // 首帧静态化：动态图编辑不在范围
            let rgba = img.to_rgba8();
            let file = fs::File::create(out_path).map_err(|e| format!("创建输出文件失败: {}", e))?;
            let mut encoder = image::codecs::gif::GifEncoder::new(file);
            encoder
                .encode(rgba.as_raw(), rgba.width(), rgba.height(), image::ExtendedColorType::Rgba8)
                .map_err(|e| format!("GIF 编码失败: {}", e))?;
        }
        "ico" => {
            write_multi_ico(&img, out_path)?;
        }
        other => return Err(format!("不支持的图片目标格式: {}", other)),
    }
    Ok(())
}

/// ico 多尺寸：16/32/48/64/128/256（不足的跳过）
fn write_multi_ico(img: &image::DynamicImage, out_path: &Path) -> Result<(), String> {
    let mut icon_dir = ico::IconDir::new(ico::ResourceType::Icon);
    for size in [256u32, 128, 64, 48, 32, 16] {
        let resized = if img.width() >= img.height() {
            img.resize(size, u32::MAX, FilterType::Lanczos3)
        } else {
            img.resize(u32::MAX, size, FilterType::Lanczos3)
        };
        let rgba = resized.to_rgba8();
        let (w, h) = rgba.dimensions();
        let image = ico::IconImage::from_rgba_data(w, h, rgba.into_raw());
        let entry = ico::IconDirEntry::encode(&image).map_err(|e| format!("ICO 条目编码失败: {}", e))?;
        icon_dir.add_entry(entry);
    }
    let file = fs::File::create(out_path).map_err(|e| format!("创建输出文件失败: {}", e))?;
    icon_dir.write(file).map_err(|e| format!("ICO 写入失败: {}", e))
}

/// 供 mod.rs 校验目标合法性
pub fn is_valid_target(target: &str) -> bool {
    ["png", "jpg", "jpeg", "webp", "bmp", "gif", "tiff", "ico"].contains(&target.to_ascii_lowercase().as_str())
}

/// 源文件是否本身就是目标格式（jpeg↔jpg 视为同名）
pub fn same_format(src_ext: &str, target: &str) -> bool {
    fn norm(s: &str) -> String {
        match s.trim_start_matches('.') {
            "jpeg" => "jpg".to_string(),
            "tif" => "tiff".to_string(),
            other => other.to_ascii_lowercase(),
        }
    }
    norm(src_ext) == norm(target)
}

pub fn _unused(_: &PathBuf) {}
