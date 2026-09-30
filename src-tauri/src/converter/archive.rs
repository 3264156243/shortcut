//! 解压缩——zip（含 ZipCrypto/AES 密码、GBK 中文名）+ tar 系（.tar/.gz/.bz2/.xz/.zst 及单文件变体）
//! 冲突处理：自动重命名 name(1).ext（resolve_conflict）

use std::fs::{self, File};
use std::io::{self, BufReader, Read};
use std::path::{Path, PathBuf};

use super::detect::archive_flavor;

/// 同名冲突自动重命名：file.txt → file(1).txt → file(2).txt ...
pub fn resolve_conflict(path: &Path) -> PathBuf {
    if !path.exists() {
        return path.to_path_buf();
    }
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let ext = path.extension().and_then(|s| s.to_str());
    let parent = path.parent().unwrap_or(Path::new("."));
    for i in 1..10000u32 {
        let name = match ext {
            Some(e) => format!("{}({}).{}", stem, i, e),
            None => format!("{}({})", stem, i),
        };
        let candidate = parent.join(name);
        if !candidate.exists() {
            return candidate;
        }
    }
    path.to_path_buf()
}

/// 解压。out_dir 缺省=包旁同名文件夹；on_entry 回调已完成条目数（进度用）
pub fn extract(
    src: &Path,
    password: Option<&str>,
    out_dir: Option<&Path>,
    on_entry: &mut dyn FnMut(usize),
) -> Result<(usize, PathBuf), String> {
    let flavor = archive_flavor(src).ok_or("不支持的压缩格式")?;
    let stem = src
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("archive")
        .strip_suffix(".tar")
        .unwrap_or_else(|| {
            src.file_stem().and_then(|s| s.to_str()).unwrap_or("archive")
        })
        .to_string();
    let dir = out_dir
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| src.with_file_name(stem));
    fs::create_dir_all(&dir).map_err(|e| format!("创建输出目录失败: {}", e))?;
    // 缺省目录已非空 → 自动改名，避免与旧文件混杂
    let dir = if out_dir.is_none()
        && fs::read_dir(&dir).map(|d| d.count()).unwrap_or(0) > 0
    {
        let renamed = resolve_conflict(&dir);
        fs::create_dir_all(&renamed).map_err(|e| format!("创建输出目录失败: {}", e))?;
        renamed
    } else {
        dir
    };

    let count = match flavor {
        "zip" => extract_zip(src, password, &dir, on_entry)?,
        "tar" => extract_tar(BufReader::new(File::open(src).map_err(io_err)?), &dir, on_entry)?,
        "tar.gz" => extract_tar(flate2::read::GzDecoder::new(File::open(src).map_err(io_err)?), &dir, on_entry)?,
        "gz" => single_file(flate2::read::GzDecoder::new(File::open(src).map_err(io_err)?), src, &dir, ".gz")?,
        "tar.bz2" => extract_tar(bzip2::read::BzDecoder::new(File::open(src).map_err(io_err)?), &dir, on_entry)?,
        "bz2" => single_file(bzip2::read::BzDecoder::new(File::open(src).map_err(io_err)?), src, &dir, ".bz2")?,
        "tar.xz" => extract_tar(xz2::read::XzDecoder::new(File::open(src).map_err(io_err)?), &dir, on_entry)?,
        "xz" => single_file(xz2::read::XzDecoder::new(File::open(src).map_err(io_err)?), src, &dir, ".xz")?,
        "tar.zst" => extract_tar(zstd_decoder(src)?, &dir, on_entry)?,
        "zst" => single_file(zstd_decoder(src)?, src, &dir, ".zst")?,
        other => return Err(format!("不支持的压缩格式: {}", other)),
    };
    Ok((count, dir))
}

fn io_err(e: io::Error) -> String {
    format!("读取压缩包失败: {}", e)
}

fn zstd_decoder(src: &Path) -> Result<impl Read, String> {
    zstd::stream::Decoder::new(File::open(src).map_err(io_err)?).map_err(|e| format!("zstd 解码初始化失败: {}", e))
}

/// 防路径穿越：拒绝绝对路径与 .. 逃逸
fn safe_join(dir: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel_path = Path::new(rel);
    if rel_path.is_absolute() || rel.split(['/', '\\']).any(|seg| seg == "..") {
        return Err(format!("压缩包内存在不安全路径: {}", rel));
    }
    Ok(dir.join(rel_path))
}

/// zip 条目名解码：UTF-8 优先，否则按 GBK（Windows 中文 zip 常见）
fn decode_zip_name(raw: &[u8]) -> String {
    match std::str::from_utf8(raw) {
        Ok(s) => s.to_string(),
        Err(_) => {
            let (decoded, _, _) = encoding_rs::GBK.decode(raw);
            decoded.into_owned()
        }
    }
}

fn extract_zip(
    src: &Path,
    password: Option<&str>,
    dir: &Path,
    on_entry: &mut dyn FnMut(usize),
) -> Result<usize, String> {
    let file = File::open(src).map_err(io_err)?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("打开 zip 失败: {}", e))?;
    let pwd = password.map(|p| p.as_bytes().to_vec());
    let mut count = 0usize;
    for i in 0..archive.len() {
        // 有密码走解密读取（密码错=Err）；无密码普通读取（加密项会报错并提示）
        let mut entry = match &pwd {
            Some(p) => archive
                .by_index_decrypt(i, p)
                .map_err(|e| format!("zip 解密失败（密码错误或文件损坏）: {}", e))?,
            None => archive
                .by_index(i)
                .map_err(|e| format!("zip 读取失败（加密包请提供密码）: {}", e))?,
        };
        let raw = entry.name_raw().to_vec();
        let name = decode_zip_name(&raw);
        let target = safe_join(dir, &name)?;
        if entry.is_dir() {
            fs::create_dir_all(&target).map_err(|e| format!("创建目录失败: {}", e))?;
        } else {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
            }
            let out = resolve_conflict(&target);
            let mut out_file = File::create(&out).map_err(|e| format!("创建文件失败: {}", e))?;
            io::copy(&mut entry, &mut out_file).map_err(|e| format!("解压写入失败: {}", e))?;
        }
        count += 1;
        on_entry(count);
    }
    Ok(count)
}

fn extract_tar<R: Read>(
    reader: R,
    dir: &Path,
    on_entry: &mut dyn FnMut(usize),
) -> Result<usize, String> {
    // tar 0.4 默认不保留权限/xattr，直接解包
    let mut archive = tar::Archive::new(reader);
    let entries = archive
        .entries()
        .map_err(|e| format!("tar 读取失败: {}", e))?;
    let mut count = 0usize;
    for entry in entries {
        let mut entry = entry.map_err(|e| format!("tar 条目读取失败: {}", e))?;
        let name = entry
            .path()
            .map_err(|e| format!("tar 路径读取失败: {}", e))?
            .to_string_lossy()
            .into_owned();
        let target = safe_join(dir, &name)?;
        if entry.header().entry_type().is_dir() {
            fs::create_dir_all(&target).map_err(|e| format!("创建目录失败: {}", e))?;
        } else {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
            }
            let out = resolve_conflict(&target);
            let mut out_file = File::create(&out).map_err(|e| format!("创建文件失败: {}", e))?;
            io::copy(&mut entry, &mut out_file).map_err(|e| format!("解压写入失败: {}", e))?;
        }
        count += 1;
        on_entry(count);
    }
    Ok(count)
}

/// 单文件压缩流（.gz/.xz/.bz2/.zst）：还原为去掉压缩后缀的原始文件
fn single_file<R: Read>(
    mut reader: R,
    src: &Path,
    dir: &Path,
    suffix: &str,
) -> Result<usize, String> {
    let stem = src
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file")
        .strip_suffix(suffix)
        .unwrap_or("file")
        .to_string();
    let out = resolve_conflict(&dir.join(&stem));
    let mut out_file = File::create(&out).map_err(|e| format!("创建文件失败: {}", e))?;
    io::copy(&mut reader, &mut out_file).map_err(|e| format!("解压写入失败: {}", e))?;
    Ok(1)
}

/// 压缩文件/文件夹（递归）为 zip 或 tar 系。level 仅 zip 生效（1-9）。
pub fn compress(
    paths: &[String],
    flavor: &str,
    out_path: &Path,
    password: Option<&str>,
    level: i64,
    on_entry: &mut dyn FnMut(usize),
) -> Result<PathBuf, String> {
    let files = collect_inputs(paths)?;
    let mut count = 0usize;
    let mut track = |count: &mut usize| {
        *count += 1;
        on_entry(*count);
    };
    match flavor {
        "zip" => compress_zip(&files, out_path, password, level, &mut count, &mut track),
        "tar" => compress_tar_plain(&files, out_path, &mut count, &mut track),
        "tar.gz" => compress_tar_wrap(&files, out_path, "tar.gz", &mut count, &mut track),
        "tar.bz2" => compress_tar_wrap(&files, out_path, "tar.bz2", &mut count, &mut track),
        "tar.xz" => compress_tar_wrap(&files, out_path, "tar.xz", &mut count, &mut track),
        "tar.zst" => compress_tar_wrap(&files, out_path, "tar.zst", &mut count, &mut track),
        other => Err(format!("不支持的压缩目标格式: {}", other)),
    }
}

/// 收集所有要打包的普通文件（文件夹递归），返回 (绝对路径, 包内相对名)
fn collect_inputs(paths: &[String]) -> Result<Vec<(PathBuf, String)>, String> {
    let mut files = Vec::new();
    for p in paths {
        let path = PathBuf::from(p);
        if !path.exists() {
            return Err(format!("路径不存在: {}", p));
        }
        if path.is_file() {
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("file")
                .to_string();
            files.push((path, name));
        } else {
            // 文件夹：包内保留 <folder>/ 前缀；解压端按需创建目录
            let root = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("folder")
                .to_string();
            for entry in walkdir::WalkDir::new(&path).into_iter().filter_map(|e| e.ok()) {
                if entry.file_type().is_file() {
                    let rel = entry
                        .path()
                        .strip_prefix(path.parent().unwrap_or(Path::new(".")))
                        .unwrap_or(entry.path())
                        .to_string_lossy()
                        .replace('\\', "/");
                    files.push((entry.path().to_path_buf(), rel));
                }
            }
            let _ = &root;
        }
    }
    if files.is_empty() {
        return Err("没有可压缩的文件".into());
    }
    Ok(files)
}

fn compress_zip(
    files: &[(PathBuf, String)],
    out_path: &Path,
    password: Option<&str>,
    level: i64,
    count: &mut usize,
    track: &mut dyn FnMut(&mut usize),
) -> Result<PathBuf, String> {
    let file = File::create(out_path).map_err(|e| format!("创建压缩包失败: {}", e))?;
    let mut zip = zip::ZipWriter::new(file);
    for (path, rel) in files {
        // zip 2.4：with_aes_encryption(AesMode, password) 在 start_file 时生效
        let mut options = zip::write::FileOptions::<()>::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .compression_level(Some(level.clamp(1, 9)))
            .large_file(true);
        let options = match password {
            Some(p) if !p.is_empty() => options.with_aes_encryption(zip::AesMode::Aes256, p),
            _ => options,
        };
        let data = fs::read(path).map_err(|e| format!("读取 {} 失败: {}", path.display(), e))?;
        zip.start_file(rel.as_str(), options)
            .map_err(|e| format!("写入条目 {} 失败: {}", rel, e))?;
        io::copy(&mut data.as_slice(), &mut zip).map_err(|e| format!("压缩写入失败: {}", e))?;
        track(count);
    }
    zip.finish().map_err(|e| format!("收尾压缩包失败: {}", e))?;
    Ok(out_path.to_path_buf())
}

fn compress_tar_plain(
    files: &[(PathBuf, String)],
    out_path: &Path,
    count: &mut usize,
    track: &mut dyn FnMut(&mut usize),
) -> Result<PathBuf, String> {
    let file = File::create(out_path).map_err(|e| format!("创建压缩包失败: {}", e))?;
    let mut builder = tar::Builder::new(file);
    for (path, rel) in files {
        builder
            .append_path_with_name(path, rel)
            .map_err(|e| format!("压缩 {} 失败: {}", rel, e))?;
        track(count);
    }
    builder.finish().map_err(|e| format!("收尾 tar 失败: {}", e))?;
    Ok(out_path.to_path_buf())
}

fn compress_tar_wrap(
    files: &[(PathBuf, String)],
    out_path: &Path,
    flavor: &str,
    count: &mut usize,
    track: &mut dyn FnMut(&mut usize),
) -> Result<PathBuf, String> {
    let file = File::create(out_path).map_err(|e| format!("创建压缩包失败: {}", e))?;

    macro_rules! run {
        ($enc:expr, $finish:expr) => {{
            {
                // 独立作用域：builder 先于 finish 释放对编码器的借用
                let mut builder = tar::Builder::new(&mut $enc);
                for (path, rel) in files {
                    builder
                        .append_path_with_name(path, rel)
                        .map_err(|e| format!("压缩 {} 失败: {}", rel, e))?;
                    track(count);
                }
                builder.finish().map_err(|e| format!("收尾 tar 失败: {}", e))?;
            }
            ($finish)($enc).map_err(|e| format!("收尾压缩流失败: {}", e))?;
        }};
    }

    match flavor {
        "tar.gz" => {
            let enc = flate2::write::GzEncoder::new(file, flate2::Compression::default());
            let mut e = enc;
            run!(e, |w: flate2::write::GzEncoder<File>| w.finish());
        }
        "tar.bz2" => {
            let mut e = bzip2::write::BzEncoder::new(file, bzip2::Compression::default());
            run!(e, |w: bzip2::write::BzEncoder<File>| w.finish());
        }
        "tar.xz" => {
            let mut e = xz2::write::XzEncoder::new(file, 6);
            run!(e, |w: xz2::write::XzEncoder<File>| w.finish());
        }
        "tar.zst" => {
            let mut e = zstd::stream::write::Encoder::new(file, 0)
                .map_err(|err| format!("zstd 初始化失败: {}", err))?;
            run!(e, |w: zstd::stream::write::Encoder<'_, File>| w.finish());
        }
        _ => return Err(format!("不支持的压缩目标格式: {}", flavor)),
    }
    Ok(out_path.to_path_buf())
}
