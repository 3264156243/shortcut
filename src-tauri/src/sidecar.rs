//! M5 sidecar 进程：音乐桥（SMTC PowerShell 脚本）+ 硬件监控（C# exe）
//! 共用模式：spawn 常驻进程，stdout 按行 JSON → emit 事件 + 缓存 latest（对齐 Electron startMusicBridge/startHardwareMonitor）

use serde_json::{json, Value};
use std::os::windows::process::CommandExt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncBufReadExt, BufReader};

pub fn music_bridge_script_pub() -> Option<std::path::PathBuf> {
    music_bridge_script()
}

fn music_bridge_script() -> Option<std::path::PathBuf> {
    let candidates = [
        crate::sj_static_root_pub().join("../music-bridge/netmusic-bridge.ps1"),
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../resources/music-bridge/netmusic-bridge.ps1"),
    ];
    candidates.into_iter().find(|p| p.exists())
}

fn hardware_monitor_exe() -> Option<std::path::PathBuf> {
    let candidates = [
        crate::sj_static_root_pub().join("../hardware-monitor/ShortCut.HardwareMonitor.exe"),
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../resources/hardware-monitor/ShortCut.HardwareMonitor.exe"),
    ];
    candidates.into_iter().find(|p| p.exists())
}

/// 常驻进程行流状态
pub struct MusicState {
    pub child: Arc<Mutex<Option<tokio::process::Child>>>,
    pub latest: Arc<Mutex<Value>>,
}

pub struct CockpitState {
    pub child: Arc<Mutex<Option<tokio::process::Child>>>,
    pub latest: Arc<Mutex<Value>>,
    pub main_active: AtomicBool,
}

fn kill_child(child: &Arc<Mutex<Option<tokio::process::Child>>>) {
    if let Some(mut c) = child.lock().unwrap().take() {
        let _ = c.start_kill();
    }
}

// ---------- 音乐桥 ----------

pub fn start_music_bridge(app: tauri::AppHandle, st: Arc<MusicState>) -> Value {
    {
        let guard = st.child.lock().unwrap();
        if guard.is_some() {
            return json!({ "success": true });
        }
    }
    let Some(script) = music_bridge_script() else {
        return json!({ "success": false, "error": "音乐桥接脚本不存在" });
    };
    match tokio::process::Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            &script.to_string_lossy(),
        ])
        .creation_flags(0x08000000)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
    {
        Ok(mut child) => {
            let stdout = child.stdout.take().unwrap();
            let app2 = app.clone();
            let latest = st.latest.clone();
            let child_slot = st.child.clone();
            tokio::spawn(async move {
                let reader = BufReader::new(stdout);
                let mut lines = reader.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    if line.trim().is_empty() {
                        continue;
                    }
                    if let Ok(v) = serde_json::from_str::<Value>(&line) {
                        *latest.lock().unwrap() = v.clone();
                        let _ = tauri::Emitter::emit(&app2, "electron:IslandMusic", v);
                    }
                }
                // 进程退出：清理槽位
                *child_slot.lock().unwrap() = None;
                log::info!("[music] 音乐桥进程退出");
            });
            *st.child.lock().unwrap() = Some(child);
            log::info!("[music] 音乐桥已启动");
            json!({ "success": true })
        }
        Err(e) => {
            log::error!("[music] 音乐桥启动失败: {}", e);
            json!({ "success": false, "error": e.to_string() })
        }
    }
}

pub fn stop_music_bridge(st: &Arc<MusicState>) {
    kill_child(&st.child);
}

/// 一次性命令（control/seek，对齐 runMusicBridgeCommand）
pub fn run_music_command(script: &std::path::Path, extra_args: &[String]) -> Value {
    match std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(script)
        .args(extra_args)
        .creation_flags(0x08000000)
        .output()
    {
        Ok(o) => {
            let out = String::from_utf8_lossy(&o.stdout);
            let first = out.trim().lines().next().unwrap_or("");
            serde_json::from_str(first).unwrap_or_else(|_| json!({ "success": false, "error": "命令输出解析失败" }))
        }
        Err(e) => json!({ "success": false, "error": e.to_string() }),
    }
}

// ---------- 硬件监控 ----------

/// main_active 或岛配置 cockpitEnabled 任一开启则运行（对齐 syncHardwareMonitor）
pub fn sync_cockpit(app: tauri::AppHandle, st: Arc<CockpitState>) -> Value {
    let island_active = crate::config::read_config_island_cockpit_enabled();
    if st.main_active.load(Ordering::SeqCst) || island_active {
        start_cockpit(app, st)
    } else {
        kill_child(&st.child);
        json!({ "success": true, "running": false })
    }
}

fn start_cockpit(app: tauri::AppHandle, st: Arc<CockpitState>) -> Value {
    {
        let guard = st.child.lock().unwrap();
        if guard.is_some() {
            return json!({ "success": true });
        }
    }
    let Some(exe) = hardware_monitor_exe() else {
        return json!({ "success": false, "error": "硬件监控组件不存在" });
    };
    let cwd = exe.parent().map(|p| p.to_path_buf());
    match tokio::process::Command::new(&exe)
        .current_dir(cwd.unwrap_or_else(|| std::path::PathBuf::from(".")))
        .creation_flags(0x08000000)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
    {
        Ok(mut child) => {
            let stdout = child.stdout.take().unwrap();
            let app2 = app.clone();
            let latest = st.latest.clone();
            let child_slot = st.child.clone();
            tokio::spawn(async move {
                let reader = BufReader::new(stdout);
                let mut lines = reader.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    if line.trim().is_empty() {
                        continue;
                    }
                    if let Ok(v) = serde_json::from_str::<Value>(&line) {
                        *latest.lock().unwrap() = v.clone();
                        let _ = tauri::Emitter::emit(&app2, "electron:CockpitData", &v);
                        let _ = tauri::Emitter::emit(&app2, "electron:IslandCockpit", &v);
                    }
                }
                *child_slot.lock().unwrap() = None;
                log::info!("[cockpit] 硬件监控进程退出");
            });
            *st.child.lock().unwrap() = Some(child);
            log::info!("[cockpit] 硬件监控已启动");
            json!({ "success": true })
        }
        Err(e) => {
            log::error!("[cockpit] 硬件监控启动失败: {}", e);
            kill_child(&st.child);
            json!({ "success": false, "error": e.to_string() })
        }
    }
}

/// balance setKey：写 config.island.deepseekApiKey / opencodeApiKey（对齐 handleBalanceSetKey）
pub fn set_balance_key(provider: &str, key: &str) -> Value {
    let target = if provider == "opencode" { "opencodeApiKey" } else { "deepseekApiKey" };
    let raw = crate::config::read_config();
    let mut cfg: Value = if raw.is_empty() { json!({}) } else { serde_json::from_str(&raw).unwrap_or(json!({})) };
    if let Some(obj) = cfg.as_object_mut() {
        let island = obj.entry("island").or_insert_with(|| json!({}));
        if let Some(iobj) = island.as_object_mut() {
            iobj.insert(target.into(), json!(key.trim()));
        }
    }
    crate::config::write_config(&serde_json::to_string(&cfg).unwrap_or_default());
    json!({ "success": true })
}
