//! 命令行"直接执行"入口：在进 Tauri（建窗口/WebView2/托盘）之前把活干完。
//!
//! 为什么要在这里做，而不是在运行中的应用里做：
//! - 资源管理器/脚本发起的进程是**普通权限**，而已运行实例可能是**管理员**。
//!   UIPI 会拦住"普通 → 管理员"的进程间转发（实测：管理员实例收不到第二实例的参数，
//!   右键菜单点了没反应）。在本进程里直接干，就不受权限与实例状态影响。
//! - 不建界面、不起 WebView2：压缩/解压更快，也真正做到"不走软件"。
//!
//! 处理的动作（其余参数返回 false，交回正常启动流程）：
//!   --compress <路径...>      按当前默认格式直接压缩，产物在同目录
//!   --extract <压缩包...>     直接解压到各自同名文件夹
//!   --shellmenu-on [格式]     注册右键菜单后退出（脚本/安装包可用）
//!   --shellmenu-off           卸载右键菜单后退出
//!
//! 成功：静默（产物落盘 + 通知资源管理器刷新）；失败：弹一个错误框 + 写日志。

use std::path::{Path, PathBuf};

use crate::converter::{archive, history};
use crate::shellmenu;

/// 追加一行到应用日志（不依赖 tauri 日志插件）
fn log_line(msg: &str) {
    use std::io::Write;
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    let dir = base.join("com.wanan.shortcut").join("logs");
    let _ = std::fs::create_dir_all(&dir);
    let file = dir.join("tauri.log");
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&file) {
        let now = chrono::Local::now().format("%Y-%m-%d][%H:%M:%S");
        let _ = writeln!(f, "[{}][app_lib::direct][INFO] {}", now, msg);
    }
}

/// 失败提示（无界面进程里唯一可靠的反馈）
#[cfg(windows)]
fn show_error(title: &str, body: &str) {
    const MB_OK: u32 = 0x0000;
    const MB_ICONERROR: u32 = 0x0010;
    #[link(name = "user32")]
    unsafe extern "system" {
        fn MessageBoxW(hwnd: *mut std::ffi::c_void, text: *const u16, caption: *const u16, utype: u32) -> i32;
    }
    let wide = |s: &str| -> Vec<u16> {
        use std::os::windows::ffi::OsStrExt;
        std::ffi::OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
    };
    let (t, c) = (wide(body), wide(title));
    unsafe {
        MessageBoxW(std::ptr::null_mut(), t.as_ptr(), c.as_ptr(), MB_OK | MB_ICONERROR);
    }
}

#[cfg(not(windows))]
fn show_error(_title: &str, _body: &str) {}

/// 同步执行压缩/解压，返回 (产物路径, 一句说明, 条目数)
pub fn run_archive_action(action: &str, paths: &[String], flavor: &str) -> Result<(String, String, usize), String> {
    if paths.is_empty() {
        return Err("没有选中要处理的文件".to_string());
    }
    if action == "extract" {
        let mut last = String::new();
        let mut total = 0usize;
        for p in paths {
            let src = PathBuf::from(p);
            if !src.exists() {
                return Err(format!("文件不存在：{}", p));
            }
            let mut noop = |_: usize| {};
            let (count, dir) = archive::extract(&src, None, None, &mut noop)?;
            total += count;
            last = dir.to_string_lossy().into_owned();
        }
        let note = format!("已解压 {} 个压缩包（共 {} 项）", paths.len(), total);
        Ok((last, note, total))
    } else {
        let first = PathBuf::from(&paths[0]);
        if !first.exists() {
            return Err(format!("路径不存在：{}", paths[0]));
        }
        let dir = first.parent().unwrap_or(Path::new(".")).to_path_buf();
        // 单个文件 → 用文件名；多选/文件夹 → 用所在文件夹名（与常见压缩工具一致）
        let base = if paths.len() == 1 && first.is_file() {
            first.file_stem().and_then(|s| s.to_str()).unwrap_or("archive").to_string()
        } else if first.is_dir() {
            first.file_name().and_then(|s| s.to_str()).unwrap_or("archive").to_string()
        } else {
            dir.file_name().and_then(|s| s.to_str()).unwrap_or("archive").to_string()
        };
        let out = archive::resolve_conflict(&dir.join(format!("{}.{}", base, flavor)));
        let mut noop = |_: usize| {};
        archive::compress(paths, flavor, &out, None, 6, &mut noop)?;
        let note = format!("已压缩为 {}", flavor.to_uppercase());
        Ok((out.to_string_lossy().into_owned(), note, 0))
    }
}

/// 尝试按"直接执行"处理当前命令行；返回 true 表示已处理（调用方应直接结束进程）
pub fn try_run() -> bool {
    let args: Vec<String> = std::env::args().collect();
    let Some((action, paths)) = shellmenu::parse_cli(&args) else {
        return false;
    };
    match action.as_str() {
        "compress" | "extract" => {
            let flavor = shellmenu::default_format();
            log_line(&format!(
                "[shell] 直接执行 action={} 文件数={} 格式={}",
                action,
                paths.len(),
                flavor
            ));
            let src_summary = if paths.len() > 1 {
                format!("{} 等 {} 项", paths.first().cloned().unwrap_or_default(), paths.len())
            } else {
                paths.first().cloned().unwrap_or_default()
            };
            let id = crate::converter::uuid_like::new_id();
            match run_archive_action(&action, &paths, &flavor) {
                Ok((out, note, items)) => {
                    log_line(&format!("[shell] 直接执行完成 {} → {}", action, out));
                    history::push(history::HistoryItem {
                        id,
                        time: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
                        action: action.clone(),
                        src: src_summary,
                        out: out.clone(),
                        status: "ok".into(),
                        note: format!("右键直接执行：{}", note),
                    });
                    // 让资源管理器立刻显示新产物
                    let parent = Path::new(&out).parent().unwrap_or(Path::new(".")).to_path_buf();
                    shellmenu::refresh_dir(&parent);
                    let _ = items;
                }
                Err(e) => {
                    log_line(&format!("[shell] 直接执行失败 {}: {}", action, e));
                    history::push(history::HistoryItem {
                        id,
                        time: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
                        action: action.clone(),
                        src: src_summary,
                        out: String::new(),
                        status: "fail".into(),
                        note: e.clone(),
                    });
                    show_error("ShortCut 操作失败", &e);
                }
            }
            true
        }
        "shellmenu-on" | "shellmenu-off" => {
            let enabled = action == "shellmenu-on";
            let format = paths.first().cloned().unwrap_or_else(shellmenu::default_format);
            match shellmenu::set_enabled_with_format(enabled, &format) {
                Ok(state) => log_line(&format!(
                    "[shell] 右键菜单 enabled={} format={}",
                    state, format
                )),
                Err(e) => {
                    log_line(&format!("[shell] 写入右键菜单失败: {}", e));
                    show_error("ShortCut 设置失败", &e);
                }
            }
            true
        }
        _ => false,
    }
}
