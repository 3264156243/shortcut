//! M5 sidecar 进程：音乐桥（SMTC PowerShell 脚本）+ 硬件监控（C# exe）
//! 共用模式：spawn 常驻进程，stdout 按行 JSON → emit 事件 + 缓存 latest（对齐 Electron startMusicBridge/startHardwareMonitor）

/// 侧车进程的生命周期保障：统一挂到一个带 `KILL_ON_JOB_CLOSE` 的 Job Object 上。
///
/// 为什么需要它：Windows 不会因为父进程退出就杀掉子进程。原来的做法是在退出事件里
/// `kill_child()`（异步 `start_kill()`，不等确认）—— 正常退出时可能还没投递完我们就退出了，
/// 崩溃 / 任务管理器强杀更是完全不走这条路，于是留下孤儿 powershell 常驻吃内存
/// （实测残留 89MB、91MB 的音乐桥）。挂进 Job 后：**我们无论怎么死，整棵侧车进程树都会被系统收掉**。
#[cfg(windows)]
mod job {
    use std::sync::OnceLock;

    static JOB: OnceLock<isize> = OnceLock::new();

    fn job_handle() -> isize {
        *JOB.get_or_init(|| unsafe {
            #[link(name = "kernel32")]
            unsafe extern "system" {
                fn CreateJobObjectW(attr: *mut core::ffi::c_void, name: *const u16) -> *mut core::ffi::c_void;
                fn SetInformationJobObject(job: *mut core::ffi::c_void, class: u32, info: *mut core::ffi::c_void, len: u32) -> i32;
            }
            #[repr(C)]
            struct IoCounters { read_ops: u64, write_ops: u64, other_ops: u64, read_bytes: u64, write_bytes: u64, other_bytes: u64 }
            #[repr(C)]
            struct BasicLimitInfo {
                per_process_user_time: i64,
                per_job_user_time: i64,
                limit_flags: u32,
                minimum_working_set: usize,
                maximum_working_set: usize,
                active_process_limit: u32,
                affinity: usize,
                priority_class: u32,
                scheduling_class: u32,
            }
            #[repr(C)]
            struct ExtendedLimitInfo {
                basic: BasicLimitInfo,
                io: IoCounters,
                process_memory_limit: usize,
                job_memory_limit: usize,
                peak_process_memory: usize,
                peak_job_memory: usize,
            }
            const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: u32 = 0x0000_2000;
            const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS: u32 = 9;

            let job = CreateJobObjectW(std::ptr::null_mut(), std::ptr::null());
            if job.is_null() {
                log::error!("[sidecar] CreateJobObject 失败，侧车孤儿防护不可用");
                return 0;
            }
            let mut info: ExtendedLimitInfo = std::mem::zeroed();
            info.basic.limit_flags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let ok = SetInformationJobObject(
                job,
                JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS,
                &mut info as *mut _ as *mut core::ffi::c_void,
                std::mem::size_of::<ExtendedLimitInfo>() as u32,
            );
            log::info!("[sidecar] 侧车 Job Object 已建立（KILL_ON_JOB_CLOSE 设置={}）", ok);
            job as isize
        })
    }

    /// 把刚 spawn 出来的子进程挂进 Job。失败只记日志（某些宿主环境禁止嵌套 Job）。
    pub fn assign(pid: u32) {
        if pid == 0 {
            return;
        }
        let job = job_handle();
        if job == 0 {
            return;
        }
        unsafe {
            #[link(name = "kernel32")]
            unsafe extern "system" {
                fn OpenProcess(access: u32, inherit: i32, pid: u32) -> *mut core::ffi::c_void;
                fn AssignProcessToJobObject(job: *mut core::ffi::c_void, process: *mut core::ffi::c_void) -> i32;
                fn CloseHandle(h: *mut core::ffi::c_void) -> i32;
            }
            const PROCESS_SET_QUOTA: u32 = 0x0100;
            const PROCESS_TERMINATE: u32 = 0x0001;
            let h = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
            if h.is_null() {
                log::warn!("[sidecar] 子进程 {} 打开失败，未加入 Job", pid);
                return;
            }
            let ok = AssignProcessToJobObject(job as *mut core::ffi::c_void, h);
            CloseHandle(h);
            if ok == 0 {
                log::warn!("[sidecar] 子进程 {} 加入 Job 失败（可能处于不可嵌套 Job 中）", pid);
            } else {
                log::info!("[sidecar] 子进程 {} 已纳入 Job（随本进程一起回收）", pid);
            }
        }
    }
}

#[cfg(not(windows))]
mod job {
    pub fn assign(_pid: u32) {}
}


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
    /// 启动中防抖（async spawn 到 child 落位之间有窗口）
    pub starting: AtomicBool,
}

pub struct CockpitState {
    pub child: Arc<Mutex<Option<tokio::process::Child>>>,
    pub latest: Arc<Mutex<Value>>,
    pub main_active: AtomicBool,
    pub starting: AtomicBool,
}

pub fn kill_child(child: &Arc<Mutex<Option<tokio::process::Child>>>) {
    if let Some(mut c) = child.lock().unwrap().take() {
        let _ = c.start_kill();
    }
}

// ---------- 音乐桥 ----------

pub fn start_music_bridge(app: tauri::AppHandle, st: Arc<MusicState>) -> Value {
    // 游戏模式（冻结后台）期间不允许起常驻侧车：解冻时 freeze::unfreeze 会主动重启
    if crate::freeze::is_frozen() {
        return json!({ "success": false, "frozen": true });
    }
    {
        let guard = st.child.lock().unwrap();
        if guard.is_some() || st.starting.swap(true, Ordering::SeqCst) {
            if guard.is_some() {
                st.starting.store(false, Ordering::SeqCst);
            }
            return json!({ "success": true });
        }
    }
    let Some(script) = music_bridge_script() else {
        st.starting.store(false, Ordering::SeqCst);
        return json!({ "success": false, "error": "音乐桥接脚本不存在" });
    };
    let st2 = st.clone();
    // 命令是同步函数（跑在主线程，无 Tokio reactor）——必须走 tauri::async_runtime::spawn
    tauri::async_runtime::spawn(async move {
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
                // 加入 Job Object：我们一退出（含崩溃/被强杀），侧车进程树必然跟着结束，
                // 不再留下孤儿 powershell（实测残留过 89MB/91MB 的音乐桥）
                if let Some(pid) = child.id() {
                    job::assign(pid);
                }
                let stdout = child.stdout.take().unwrap();
                let app2 = app.clone();
                let latest = st2.latest.clone();
                let child_slot = st2.child.clone();
                *child_slot.lock().unwrap() = Some(child);
                log::info!("[music] 音乐桥已启动");
                let reader = BufReader::new(stdout);
                let mut lines = reader.lines();
                let mut last_avail: Option<bool> = None;
                while let Ok(Some(line)) = lines.next_line().await {
                    if line.trim().is_empty() {
                        continue;
                    }
                    if let Ok(v) = serde_json::from_str::<Value>(&line) {
                        // 状态变化诊断（含歌词字段存在性——排查封面/歌词不显示）
                        let avail = v.get("available").and_then(|x| x.as_bool());
                        if avail != last_avail {
                            log::info!(
                                "[music] 桥状态: available={:?} title={:?} has_lyrics={} cover={:?}",
                                avail,
                                v.get("title").and_then(|t| t.as_str()).unwrap_or(""),
                                v.get("lyrics").map(|l| l.as_str().map(|s| !s.is_empty()).unwrap_or(false)).unwrap_or(false),
                                v.get("coverUrl").and_then(|c| c.as_str()).map(|s| !s.is_empty()).unwrap_or(false),
                            );
                            last_avail = avail;
                        }
                        *latest.lock().unwrap() = v.clone();
                        let _ = tauri::Emitter::emit(&app2, "electron:IslandMusic", v);
                    }
                }
                // 进程退出：清理槽位
                *child_slot.lock().unwrap() = None;
                st2.starting.store(false, Ordering::SeqCst);
                log::info!("[music] 音乐桥进程退出");
            }
            Err(e) => {
                log::error!("[music] 音乐桥启动失败: {}", e);
                st2.starting.store(false, Ordering::SeqCst);
            }
        }
    });
    json!({ "success": true })
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
    // 游戏模式（冻结后台）期间硬件监控侧车必须保持关闭：配置变更等触发点也不能把它拉起来
    if crate::freeze::is_frozen() {
        kill_child(&st.child);
        return json!({ "success": true, "running": false, "frozen": true });
    }
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
        if guard.is_some() || st.starting.swap(true, Ordering::SeqCst) {
            if guard.is_some() {
                st.starting.store(false, Ordering::SeqCst);
            }
            return json!({ "success": true });
        }
    }
    let Some(exe) = hardware_monitor_exe() else {
        st.starting.store(false, Ordering::SeqCst);
        return json!({ "success": false, "error": "硬件监控组件不存在" });
    };
    let cwd = exe.parent().map(|p| p.to_path_buf());
    let st2 = st.clone();
    // 命令是同步函数（跑在主线程，无 Tokio reactor）——必须走 tauri::async_runtime::spawn
    tauri::async_runtime::spawn(async move {
        match tokio::process::Command::new(&exe)
            .current_dir(cwd.unwrap_or_else(|| std::path::PathBuf::from(".")))
            .creation_flags(0x08000000)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .spawn()
        {
            Ok(mut child) => {
                // 同样加入 Job Object（见 start_music_bridge 的说明）
                if let Some(pid) = child.id() {
                    job::assign(pid);
                }
                let stdout = child.stdout.take().unwrap();
                let app2 = app.clone();
                let latest = st2.latest.clone();
                let child_slot = st2.child.clone();
                *child_slot.lock().unwrap() = Some(child);
                log::info!("[cockpit] 硬件监控已启动");
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
                st2.starting.store(false, Ordering::SeqCst);
                log::info!("[cockpit] 硬件监控进程退出");
            }
            Err(e) => {
                log::error!("[cockpit] 硬件监控启动失败: {}", e);
                st2.starting.store(false, Ordering::SeqCst);
                kill_child(&st2.child);
            }
        }
    });
    json!({ "success": true })
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

// ---------- 余额查询（对齐 getDeepseekBalance/getOpenCodeUsage）----------

const DEEPSEEK_BALANCE_API: &str = "https://api.deepseek.com/user/balance";
const OPENCODE_USAGE_API: &str = "https://opencode.ai/zen/go/v1/usage";

static LATEST_BALANCE: Mutex<Option<(Value, i64)>> = Mutex::new(None);

fn current_balance_provider() -> &'static str {
    let raw = crate::config::read_config();
    let cfg: Value = if raw.is_empty() { json!({}) } else { serde_json::from_str(&raw).unwrap_or(json!({})) };
    let island = cfg.get("island").cloned().unwrap_or(json!({}));
    let provider = island.get("balanceProvider").and_then(|v| v.as_str()).unwrap_or("");
    if provider == "deepseek" || provider == "opencode" {
        match provider {
            "opencode" => return "opencode",
            _ => return "deepseek",
        }
    }
    if island.get("deepseekEnabled").and_then(|v| v.as_bool()).unwrap_or(false) {
        "deepseek"
    } else {
        "none"
    }
}

fn island_api_key(field: &str) -> Option<String> {
    let raw = crate::config::read_config();
    let cfg: Value = if raw.is_empty() { json!({}) } else { serde_json::from_str(&raw).unwrap_or(json!({})) };
    cfg.get("island").and_then(|i| i.get(field)).and_then(|v| v.as_str()).map(|s| s.to_string()).filter(|s| !s.is_empty())
}

fn deepseek_balance(force: bool) -> Value {
    let Some(api_key) = island_api_key("deepseekApiKey") else {
        return json!({ "provider": "deepseek", "configured": false, "error": "未配置 API Key" });
    };
    {
        let guard = LATEST_BALANCE.lock().unwrap();
        if let Some((v, at)) = guard.as_ref() {
            if !force && v.get("provider").and_then(|x| x.as_str()) == Some("deepseek") && chrono::Utc::now().timestamp_millis() - *at < 60_000 {
                return v.clone();
            }
        }
    }
    let result = ureq::get(DEEPSEEK_BALANCE_API)
        .timeout(std::time::Duration::from_millis(10_000))
        .set("Authorization", &format!("Bearer {}", api_key))
        .set("Accept", "application/json")
        .call();
    let out = match result {
        Ok(resp) => match resp.into_json::<Value>() {
            Ok(data) => {
                let info = data.get("balance_infos").and_then(|v| v.as_array()).and_then(|a| a.first()).cloned().unwrap_or(json!({}));
                json!({
                    "provider": "deepseek",
                    "configured": true,
                    "currency": info.get("currency").and_then(|v| v.as_str()).unwrap_or("CNY"),
                    "balance": info.get("total_balance").and_then(|v| v.as_str()).and_then(|s| s.parse::<f64>().ok()),
                    "granted": info.get("granted_balance").and_then(|v| v.as_str()).and_then(|s| s.parse::<f64>().ok()),
                    "toppedUp": info.get("topped_up_balance").and_then(|v| v.as_str()).and_then(|s| s.parse::<f64>().ok()),
                    "available": data.get("is_available").and_then(|v| v.as_bool()).unwrap_or(true),
                })
            }
            Err(_) => json!({ "provider": "deepseek", "configured": true, "error": "余额获取失败" }),
        },
        Err(_) => json!({ "provider": "deepseek", "configured": true, "error": "余额获取失败" }),
    };
    *LATEST_BALANCE.lock().unwrap() = Some((out.clone(), chrono::Utc::now().timestamp_millis()));
    out
}

fn opencode_usage(force: bool) -> Value {
    let Some(api_key) = island_api_key("opencodeApiKey") else {
        return json!({ "provider": "opencode", "configured": false, "error": "未配置 API Key" });
    };
    {
        let guard = LATEST_BALANCE.lock().unwrap();
        if let Some((v, at)) = guard.as_ref() {
            if !force && v.get("provider").and_then(|x| x.as_str()) == Some("opencode") && chrono::Utc::now().timestamp_millis() - *at < 60_000 {
                return v.clone();
            }
        }
    }
    let out = match ureq::get(OPENCODE_USAGE_API)
        .timeout(std::time::Duration::from_millis(10_000))
        .set("Authorization", &format!("Bearer {}", api_key))
        .set("Accept", "application/json")
        .call()
    {
        Ok(resp) => {
            if resp.status() >= 400 {
                let status = resp.status();
                json!({ "provider": "opencode", "configured": true, "error": if status == 401 { "API Key 无效" } else { "请求失败" } })
            } else {
                match resp.into_json::<Value>() {
                    Ok(data) => {
                        let usage = data.get("usage").cloned().unwrap_or(json!({}));
                        let pick = |w: Value| -> Value {
                            if !w.is_object() {
                                return Value::Null;
                            }
                            let percent = w.get("percent").and_then(|v| v.as_f64());
                            json!({
                                "status": w.get("status").and_then(|v| v.as_str()).unwrap_or("ok"),
                                "percent": percent.map(|p| p.clamp(0.0, 100.0)),
                                "resetsAt": w.get("resetsAt").cloned().unwrap_or(Value::Null),
                            })
                        };
                        json!({
                            "provider": "opencode",
                            "configured": true,
                            "rolling": pick(usage.get("rolling").cloned().unwrap_or(Value::Null)),
                            "weekly": pick(usage.get("weekly").cloned().unwrap_or(Value::Null)),
                            "monthly": pick(usage.get("monthly").cloned().unwrap_or(Value::Null)),
                        })
                    }
                    Err(_) => json!({ "provider": "opencode", "configured": true, "error": "用量获取失败" }),
                }
            }
        }
        Err(_) => json!({ "provider": "opencode", "configured": true, "error": "用量获取失败" }),
    };
    *LATEST_BALANCE.lock().unwrap() = Some((out.clone(), chrono::Utc::now().timestamp_millis()));
    out
}

pub fn get_balance_data(force: bool) -> Value {
    match current_balance_provider() {
        "deepseek" => deepseek_balance(force),
        "opencode" => opencode_usage(force),
        _ => json!({ "provider": "none", "configured": false }),
    }
}