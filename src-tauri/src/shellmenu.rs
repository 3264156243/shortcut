//! Windows 资源管理器右键菜单集成（P3，2026-10 改为"直接执行"）
//!
//! 全部写 HKCU（当前用户），**不需要管理员权限**，卸载/关闭开关时逐键删除。
//!
//! 注册的动词（verbs）——**点一下就直接干活，不打开主面板**：
//!   * 所有非压缩包文件 → 「压缩为 ZIP（ShortCut）」 `Software\Classes\*\shell\ShortCutCompress`
//!                                    （`AppliesTo` 排除压缩包扩展名，压缩包上不出现）
//!   * 文件夹           → 「压缩为 ZIP（ShortCut）」 `Software\Classes\Directory\shell\ShortCutCompress`
//!   * 压缩包           → 「解压（ShortCut）」        `Software\Classes\SystemFileAssociations\<ext>\shell\ShortCutExtract`
//!                                    （zip/tar/gz/bz2/xz/zst/tgz/tbz/txz/tzst 等逐扩展名注册）
//!
//! 压缩格式（zip / tar / tar.gz / tar.bz2 / tar.xz / tar.zst）由设置决定，
//! 菜单文字随格式变化（「压缩为 TAR.GZ（ShortCut）」），设置在 `shellmenu.json`：
//!   `%LOCALAPPDATA%\com.wanan.shortcut\shellmenu.json` → `{ "enabled": true, "format": "zip" }`
//!
//! 设计要点：
//! - 动词表是**通用动作**（compress / extract），新增能力只改 Rust 代码。
//! - 用 `SystemFileAssociations\<ext>` 而非 `Software\Classes\.zip`：
//!   不篡改扩展名 ProgID，卸载后不留残留接管。
//! - `MultiSelectModel=Player`：多选时资源管理器一次性把全部选中项替换进 `%1` 位置。
//! - 压缩包上用 `AppliesTo` 的 AQS 排除（`NOT` 必须大写，不等用 `<>`），
//!   否则 `*` 上的"压缩"会同时出现在 .zip 上。

use std::path::PathBuf;

/// 支持的压缩目标格式（与 converter::archive::compress 的 flavor 一致）
pub const COMPRESS_FORMATS: &[&str] = &["zip", "tar", "tar.gz", "tar.bz2", "tar.xz", "tar.zst"];

/// 默认可解压的压缩包扩展名（逐扩展名注册"解压"）
const ARCHIVE_EXTS: &[&str] = &[
    "zip", "tar", "gz", "tgz", "bz2", "tbz", "tbz2", "xz", "txz", "zst", "tzst",
];

/// 右键菜单是否可用（仅 Windows 实现）
pub const fn available() -> bool {
    cfg!(windows)
}

/// 一个动词的注册描述
struct Verb {
    /// HKCU 下的键路径
    key: String,
    /// 菜单显示文字
    label: String,
    /// 传给主程序的参数模板（`{exe}` 由真实路径替换）
    args: &'static str,
    /// 多选模型：Player=一次性传全部选中项；Single=只处理单个
    multi_select: &'static str,
    /// AQS 过滤（None=不过滤）
    applies_to: Option<String>,
}

/// 压缩格式的显示名（zip → ZIP，tar.gz → TAR.GZ）
pub fn format_display(format: &str) -> String {
    format.to_uppercase()
}

/// 归一化压缩格式（非法值回退 zip）
pub fn normalize_format(format: &str) -> &'static str {
    COMPRESS_FORMATS
        .iter()
        .find(|f| **f == format)
        .copied()
        .unwrap_or("zip")
}

/// 旧版遗留的动词键（改为直接执行后要清理，避免残留「转换为…」）
const LEGACY_KEYS: &[&str] = &[
    r"Software\Classes\*\shell\ShortCutConvert",
    r"Software\Classes\SystemFileAssociations\.zip\shell\ShortCutExtract",
];

/// 当前动作应注册的动词表
fn verbs(format: &str) -> Vec<Verb> {
    let fmt = normalize_format(format);
    let label = format!("压缩为 {}（ShortCut）", format_display(fmt));
    // 压缩包上不显示"压缩"：用 AQS 排除全部压缩包扩展名
    let exclude: Vec<String> = ARCHIVE_EXTS
        .iter()
        .map(|e| format!("System.FileExtension:<>\"{}\"", ext_dot(e)))
        .collect();
    let applies_to = Some(exclude.join(" AND "));

    let mut list = vec![
        Verb {
            key: r"Software\Classes\*\shell\ShortCutCompress".to_string(),
            label: label.clone(),
            args: "--compress \"%1\"",
            multi_select: "Player",
            applies_to,
        },
        Verb {
            key: r"Software\Classes\Directory\shell\ShortCutCompress".to_string(),
            label,
            args: "--compress \"%1\"",
            multi_select: "Player",
            applies_to: None,
        },
    ];
    for ext in ARCHIVE_EXTS {
        list.push(Verb {
            key: format!(r"Software\Classes\SystemFileAssociations\{}\shell\ShortCutExtract", ext_dot(ext)),
            label: "解压（ShortCut）".to_string(),
            args: "--extract \"%1\"",
            multi_select: "Player",
            applies_to: None,
        });
    }
    list
}

/// 扩展名 → 带点形式（.zip / .tar.gz 用最后一段扩展名即可，Windows 按最后一段关联）
fn ext_dot(ext: &str) -> String {
    format!(".{}", ext)
}

/// 当前可执行文件路径
fn exe_path() -> Result<String, String> {
    std::env::current_exe()
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| format!("获取程序路径失败: {}", e))
}

// ─────────────────────── 设置持久化（Rust 侧要能在启动时直接读）───────────────────────

/// 设置文件路径：%LOCALAPPDATA%\com.wanan.shortcut\shellmenu.json
fn settings_path() -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    base.join("com.wanan.shortcut").join("shellmenu.json")
}

/// 读取设置 (enabled, format)；文件缺失/损坏回退 (false, "zip")
pub fn load_settings() -> (bool, String) {
    let path = settings_path();
    let Ok(text) = std::fs::read_to_string(&path) else {
        return (false, "zip".to_string());
    };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else {
        return (false, "zip".to_string());
    };
    let enabled = v.get("enabled").and_then(|b| b.as_bool()).unwrap_or(false);
    let format = v
        .get("format")
        .and_then(|s| s.as_str())
        .map(|s| normalize_format(s).to_string())
        .unwrap_or_else(|| "zip".to_string());
    (enabled, format)
}

/// 写入设置
pub fn save_settings(enabled: bool, format: &str) -> Result<(), String> {
    let path = settings_path();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("创建配置目录失败: {}", e))?;
    }
    let body = serde_json::json!({ "enabled": enabled, "format": normalize_format(format) });
    std::fs::write(&path, serde_json::to_string_pretty(&body).unwrap_or_default())
        .map_err(|e| format!("写入设置失败: {}", e))
}

/// 当前默认压缩格式（Rust 侧直接执行时用）
pub fn default_format() -> String {
    load_settings().1
}

/// 查询右键菜单是否已启用（以压缩动词为准）
pub fn is_enabled() -> bool {
    #[cfg(windows)]
    {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let v = &verbs(&default_format())[0];
        if hkcu.open_subkey(&v.key).is_err() {
            return false;
        }
        // 命令存在且指向当前 exe 才算有效（换路径安装后视为需要重装）
        let cmd_path = format!("{}\\command", v.key);
        match hkcu.open_subkey(&cmd_path) {
            Ok(cmd) => match cmd.get_value::<String, _>("") {
                Ok(line) => exe_path().map(|exe| line.contains(&exe)).unwrap_or(false),
                Err(_) => false,
            },
            Err(_) => false,
        }
    }
    #[cfg(not(windows))]
    {
        false
    }
}

/// 启用/禁用右键菜单（用当前保存的格式），返回操作后的实际状态
pub fn set_enabled(enabled: bool) -> Result<bool, String> {
    let (_, format) = load_settings();
    set_enabled_with_format(enabled, &format)
}

/// 启用/禁用右键菜单并指定压缩格式（写注册表 + 落盘设置）
pub fn set_enabled_with_format(enabled: bool, format: &str) -> Result<bool, String> {
    let format = normalize_format(format).to_string();
    save_settings(enabled, &format)?;
    #[cfg(windows)]
    {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        // 先清掉旧版遗留键（改版后不应残留「转换为…」）
        for k in LEGACY_KEYS {
            let _ = hkcu.delete_subkey_all(k);
        }
        let list = verbs(&format);
        if enabled {
            let exe = exe_path()?;
            for v in &list {
                let (key, _) = hkcu
                    .create_subkey(&v.key)
                    .map_err(|e| format!("写入注册表失败（{}）: {}", v.key, e))?;
                key.set_value("MUIVerb", &v.label)
                    .map_err(|e| format!("写入菜单名失败: {}", e))?;
                key.set_value("Icon", &format!("{},0", exe))
                    .map_err(|e| format!("写入图标失败: {}", e))?;
                key.set_value("MultiSelectModel", &v.multi_select.to_string())
                    .map_err(|e| format!("写入多选模式失败: {}", e))?;
                match &v.applies_to {
                    Some(q) => {
                        key.set_value("AppliesTo", q)
                            .map_err(|e| format!("写入适用条件失败: {}", e))?;
                    }
                    None => {
                        // 格式切换后要保证旧条件被清掉
                        let _ = key.delete_value("AppliesTo");
                    }
                }
                let cmd_path = format!("{}\\command", v.key);
                let (cmd, _) = hkcu
                    .create_subkey(&cmd_path)
                    .map_err(|e| format!("写入命令键失败: {}", e))?;
                let line = format!("\"{}\" {}", exe, v.args);
                cmd.set_value("", &line)
                    .map_err(|e| format!("写入命令失败: {}", e))?;
            }
        } else {
            for v in &list {
                let _ = hkcu.delete_subkey_all(&v.key);
            }
        }
        notify_shell();
        Ok(is_enabled())
    }
    #[cfg(not(windows))]
    {
        let _ = enabled;
        Err("仅 Windows 支持资源管理器右键菜单".into())
    }
}

/// 广播 SHChangeNotify，让资源管理器立即刷新右键菜单
#[cfg(windows)]
pub fn notify_shell() {
    // SHCNE_ASSOCCHANGED = 0x08000000, SHCNF_IDLIST = 0x0000
    const SHCNE_ASSOCCHANGED: i32 = 0x0800_0000;
    const SHCNF_IDLIST: u32 = 0x0000;
    #[link(name = "shell32")]
    unsafe extern "system" {
        fn SHChangeNotify(
            w_event_id: i32,
            u_flags: u32,
            dw_item1: *const std::ffi::c_void,
            dw_item2: *const std::ffi::c_void,
        );
    }
    unsafe {
        SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, std::ptr::null(), std::ptr::null());
    }
}

#[cfg(not(windows))]
pub fn notify_shell() {}

/// 让资源管理器立即刷新某个目录（直接压缩/解压后新文件马上显示出来）
#[cfg(windows)]
pub fn refresh_dir(dir: &std::path::Path) {
    // SHCNE_UPDATEDIR = 0x00001000, SHCNF_PATHW = 0x0005
    const SHCNE_UPDATEDIR: i32 = 0x0000_1000;
    const SHCNF_PATHW: u32 = 0x0005;
    #[link(name = "shell32")]
    unsafe extern "system" {
        fn SHChangeNotify(
            w_event_id: i32,
            u_flags: u32,
            dw_item1: *const std::ffi::c_void,
            dw_item2: *const std::ffi::c_void,
        );
    }
    let mut wide: Vec<u16> = dir.as_os_str().encode_wide().collect();
    wide.push(0);
    unsafe {
        SHChangeNotify(
            SHCNE_UPDATEDIR,
            SHCNF_PATHW,
            wide.as_ptr() as *const std::ffi::c_void,
            std::ptr::null(),
        );
    }
}

#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;

#[cfg(not(windows))]
pub fn refresh_dir(_dir: &std::path::Path) {}

/// 解析命令行参数，得到 (动作, 文件列表)
/// 支持：`--compress a.png b.png`、`--extract x.zip y.tar.gz`、`--convert a.png`（旧流程）、
///       `--shellmenu-on [格式]` / `--shellmenu-off`（脚本/安装包用，直接写注册表）
pub fn parse_cli(args: &[String]) -> Option<(String, Vec<String>)> {
    let mut action: Option<String> = None;
    let mut paths: Vec<String> = Vec::new();
    for a in args.iter().skip(1) {
        match a.as_str() {
            "--compress" => action = Some("compress".into()),
            "--extract" => action = Some("extract".into()),
            "--convert" => action = Some("convert".into()),
            "--shellmenu-on" => action = Some("shellmenu-on".into()),
            "--shellmenu-off" => action = Some("shellmenu-off".into()),
            other => {
                if other.starts_with("--") {
                    continue;
                }
                if action.is_some() {
                    paths.push(other.to_string());
                }
            }
        }
    }
    let action = action?;
    // 去掉资源管理器可能带来的占位符（%1 未被替换时）
    paths.retain(|p| p != "%1" && !p.trim().is_empty());
    paths.dedup();
    Some((action, paths))
}

#[cfg(test)]
mod tests {
    use super::{normalize_format, parse_cli};

    fn args(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn parse_compress_single() {
        let (action, paths) = parse_cli(&args(&["app.exe", "--compress", "C:\\a\\b.png"])).unwrap();
        assert_eq!(action, "compress");
        assert_eq!(paths, vec!["C:\\a\\b.png".to_string()]);
    }

    #[test]
    fn parse_compress_multi() {
        let (action, paths) =
            parse_cli(&args(&["app.exe", "--compress", "a.png", "b.jpg", "c.webp"])).unwrap();
        assert_eq!(action, "compress");
        assert_eq!(paths.len(), 3);
    }

    #[test]
    fn parse_extract_multi() {
        let (action, paths) = parse_cli(&args(&["app.exe", "--extract", "a.zip", "b.tar.gz"])).unwrap();
        assert_eq!(action, "extract");
        assert_eq!(paths.len(), 2);
    }

    #[test]
    fn parse_convert_still_supported() {
        let (action, paths) = parse_cli(&args(&["app.exe", "--convert", "a.png"])).unwrap();
        assert_eq!(action, "convert");
        assert_eq!(paths.len(), 1);
    }

    #[test]
    fn parse_extract_drops_placeholder() {
        let (action, paths) = parse_cli(&args(&["app.exe", "--extract", "%1"])).unwrap();
        assert_eq!(action, "extract");
        assert!(paths.is_empty());
    }

    #[test]
    fn parse_without_flag_is_none() {
        assert!(parse_cli(&args(&["app.exe"])).is_none());
        // 普通启动参数（无动作）不误判为拖放
        assert!(parse_cli(&args(&["app.exe", "--autostart"])).is_none());
    }

    #[test]
    fn format_normalization() {
        assert_eq!(normalize_format("zip"), "zip");
        assert_eq!(normalize_format("tar.gz"), "tar.gz");
        assert_eq!(normalize_format("7z"), "zip"); // 不支持 → 回退
    }
}
