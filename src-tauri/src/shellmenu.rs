//! Windows 资源管理器右键菜单集成（P3）
//!
//! 全部写 HKCU（当前用户），**不需要管理员权限**，卸载/关闭开关时逐键删除。
//!
//! 注册的动词（verbs）：
//!   * 所有文件 → 「转换为…（ShortCut）」      `HKCU\Software\Classes\*\shell\ShortCutConvert`
//!   * .zip    → 「解压（ShortCut）」           `HKCU\Software\Classes\SystemFileAssociations\.zip\shell\ShortCutExtract`
//!
//! 设计要点（与 docs/文件转换板块开发计划.md §5.1/§5.3 对应）：
//! - 动词表是**通用动作**（convert / extract），新增能力只改 Rust 代码，
//!   新增独立菜单项只需在 `verbs()` 里加一条，无需改前端。
//! - 用 `SystemFileAssociations\.zip` 而非 `Software\Classes\.zip`：
//!   不篡改扩展名 ProgID，卸载后不留残留接管。
//! - `MultiSelectModel=Player`：多选文件时资源管理器一次性调用，
//!   命令行里所有选中文件都会替换到 `%1` 位置，实现批量转换。

/// 右键菜单是否可用（仅 Windows 实现）
pub const fn available() -> bool {
    cfg!(windows)
}

/// 动词定义：注册表键路径、显示名、命令行模板、多选模型
struct Verb {
    /// HKCU 下的键路径
    key: &'static str,
    /// 菜单显示文字
    label: &'static str,
    /// 传给主程序的参数模板（`{exe}` 由真实路径替换）
    args: &'static str,
    /// 多选模型：Player=一次性传全部选中文件；Single=只处理单个
    multi_select: &'static str,
}

/// 动词表（新增能力只在这里加一条）
const fn verbs() -> [Verb; 2] {
    [
        Verb {
            key: r"Software\Classes\*\shell\ShortCutConvert",
            label: "转换为…（ShortCut）",
            args: "--convert \"%1\"",
            multi_select: "Player",
        },
        Verb {
            key: r"Software\Classes\SystemFileAssociations\.zip\shell\ShortCutExtract",
            label: "解压（ShortCut）",
            args: "--extract \"%1\"",
            multi_select: "Single",
        },
    ]
}

/// 当前可执行文件路径
fn exe_path() -> Result<String, String> {
    std::env::current_exe()
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| format!("获取程序路径失败: {}", e))
}

/// 查询右键菜单是否已启用（以「转换」动词为准）
pub fn is_enabled() -> bool {
    #[cfg(windows)]
    {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let v = &verbs()[0];
        if hkcu.open_subkey(v.key).is_err() {
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

/// 启用/禁用右键菜单，返回操作后的实际状态
pub fn set_enabled(enabled: bool) -> Result<bool, String> {
    #[cfg(windows)]
    {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if enabled {
            let exe = exe_path()?;
            for v in verbs() {
                let (key, _) = hkcu
                    .create_subkey(v.key)
                    .map_err(|e| format!("写入注册表失败（{}）: {}", v.key, e))?;
                key.set_value("MUIVerb", &v.label)
                    .map_err(|e| format!("写入菜单名失败: {}", e))?;
                key.set_value("Icon", &format!("{},0", exe))
                    .map_err(|e| format!("写入图标失败: {}", e))?;
                key.set_value("MultiSelectModel", &v.multi_select)
                    .map_err(|e| format!("写入多选模式失败: {}", e))?;
                let cmd_path = format!("{}\\command", v.key);
                let (cmd, _) = hkcu
                    .create_subkey(&cmd_path)
                    .map_err(|e| format!("写入命令键失败: {}", e))?;
                let line = format!("\"{}\" {}", exe, v.args);
                cmd.set_value("", &line)
                    .map_err(|e| format!("写入命令失败: {}", e))?;
            }
            // 通知资源管理器刷新关联（不依赖它，失败也无妨）
            crate::shellmenu::notify_shell();
        } else {
            for v in verbs() {
                // 整棵子树删除；键不存在时忽略
                let _ = hkcu.delete_subkey_all(v.key);
            }
            notify_shell();
        }
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
fn notify_shell() {
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
fn notify_shell() {}

/// 解析命令行参数，得到 (动作, 文件列表)
/// 支持：`--convert a.png b.png`、`--extract x.zip`
pub fn parse_cli(args: &[String]) -> Option<(String, Vec<String>)> {
    let mut action: Option<String> = None;
    let mut paths: Vec<String> = Vec::new();
    for a in args.iter().skip(1) {
        match a.as_str() {
            "--convert" => action = Some("convert".into()),
            "--extract" => action = Some("extract".into()),
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
    use super::parse_cli;

    fn args(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn parse_convert_single() {
        let (action, paths) = parse_cli(&args(&["app.exe", "--convert", "C:\\a\\b.png"])).unwrap();
        assert_eq!(action, "convert");
        assert_eq!(paths, vec!["C:\\a\\b.png".to_string()]);
    }

    #[test]
    fn parse_convert_multi() {
        let (action, paths) =
            parse_cli(&args(&["app.exe", "--convert", "a.png", "b.jpg", "c.webp"])).unwrap();
        assert_eq!(action, "convert");
        assert_eq!(paths.len(), 3);
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
    fn parse_dedup() {
        let (_, paths) = parse_cli(&args(&["app.exe", "--convert", "a.png", "a.png"])).unwrap();
        assert_eq!(paths.len(), 1);
    }
}
