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
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
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
    /// 当前硬件监控的数据通道："off"（未运行）/ "task"（提权计划任务 + 命名管道，有温度）
    /// / "stdout"（普通权限直接 spawn，无 CPU/内存温度）。前端据此提示"要不要授权"。
    pub mode: Arc<Mutex<String>>,
    /// 代数守卫：每次停止 +1。读取循环只在自己的代数仍然有效时才回写 child/mode/starting，
    /// 否则"旧通道退出"会踩掉刚起来的新通道（授权切换提权通道时背靠背重启，必然撞上）。
    pub epoch: Arc<AtomicU64>,
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

/// 提权侧车：计划任务名 + 命名管道名（必须与 C# 侧车 `--pipe` 参数一致）
const HW_TASK_NAME: &str = "ShortCutHardwareMonitor";
const HW_PIPE_NAME: &str = r"\\.\pipe\shortcut-hardware-monitor";

/// 为什么需要"只提权子进程"：CPU 温度要读 MSR、内存温度要读 SMBus，都必须 ring0 驱动 → 管理员；
/// 而主进程一旦提权，Windows 的 UIPI 会掐掉资源管理器拖进来的拖放（详见文档 §15.2/§15.3）。
/// 所以主进程永远普通权限，只让**读传感器的子进程**以 Highest 跑，两边用命名管道通信
/// （ShellExecuteEx(runas) 无法重定向 stdout，故不能沿用 stdout 行 JSON；UIPI 也不拦命名管道）。
mod hw {
    #[cfg(windows)]
    use std::ffi::OsStr;
    #[cfg(windows)]
    use std::os::windows::ffi::OsStrExt;

    pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    #[cfg(not(windows))]
    pub fn is_elevated() -> bool { false }
    #[cfg(not(windows))]
    pub fn schtasks(_args: &[&str]) -> bool { false }
    #[cfg(not(windows))]
    pub fn task_info(_name: &str) -> Option<(String, String, String)> { None }
    #[cfg(not(windows))]
    pub fn run_elevated(_script: &std::path::Path) -> Result<(), String> { Err("仅支持 Windows".into()) }

    /// 本进程是否以管理员运行（提权 = 拖放会被 UIPI 掐掉，只用于启动自检告警）
    #[cfg(windows)]
    pub fn is_elevated() -> bool {
        #[link(name = "kernel32")]
        unsafe extern "system" {
            fn GetCurrentProcess() -> *mut core::ffi::c_void;
            fn CloseHandle(h: *mut core::ffi::c_void) -> i32;
        }
        #[link(name = "advapi32")]
        unsafe extern "system" {
            fn OpenProcessToken(proc: *mut core::ffi::c_void, access: u32, token: *mut *mut core::ffi::c_void) -> i32;
            fn GetTokenInformation(token: *mut core::ffi::c_void, class: i32, info: *mut core::ffi::c_void, len: u32, ret: *mut u32) -> i32;
        }
        const TOKEN_QUERY: u32 = 0x0008;
        const TOKEN_ELEVATION: i32 = 20;
        unsafe {
            let mut token: *mut core::ffi::c_void = std::ptr::null_mut();
            if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
                return false;
            }
            let mut elevated: u32 = 0;
            let mut ret: u32 = 0;
            let ok = GetTokenInformation(token, TOKEN_ELEVATION, &mut elevated as *mut u32 as *mut core::ffi::c_void, 4, &mut ret);
            CloseHandle(token);
            ok != 0 && elevated != 0
        }
    }

    /// 跑 schtasks（启动/结束计划任务），只要退出码。
    #[cfg(windows)]
    pub fn schtasks(args: &[&str]) -> bool {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("schtasks")
            .args(args)
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }

    /// 读取计划任务的 (可执行文件, 参数, 运行级别)；任务不存在返回 None。
    /// 用 Get-ScheduledTask 而不是解析 schtasks 文本 —— 后者输出是本地化的，不可靠。
    /// 注意：脚本里**不要出现双引号**（`"` 在多层传参中会被吞掉，导致 PowerShell 把插值当成管道元素），
    /// 所以这里用 `+ '|' +` 拼接而不是 `"$()|$()"`。
    #[cfg(windows)]
    pub fn task_info(name: &str) -> Option<(String, String, String)> {
        use std::os::windows::process::CommandExt;
        let script = format!(
            "$t = Get-ScheduledTask -TaskName '{}' -ErrorAction SilentlyContinue; \
             if ($null -eq $t) {{ '' }} else {{ $t.Actions[0].Execute + '|' + $t.Actions[0].Arguments + '|' + $t.Principal.RunLevel }}",
            name
        );
        let out = std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", &script])
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(std::process::Stdio::null())
            .output()
            .ok()?;
        let text = String::from_utf8_lossy(&out.stdout);
        let line = text.lines().map(str::trim).find(|l| !l.is_empty());
        let Some(line) = line else {
            // 空输出 + 非 0 退出码 = 查询本身失败（而不是"任务不存在"），必须留痕
            if !out.status.success() {
                log::warn!("[cockpit] 查询计划任务失败（powershell 退出码 {:?}）", out.status.code());
            }
            return None;
        };
        let mut parts = line.split('|');
        let exe = parts.next().unwrap_or("").trim().to_string();
        let args = parts.next().unwrap_or("").trim().to_string();
        let level = parts.next().unwrap_or("").trim().to_string();
        if exe.is_empty() { None } else { Some((exe, args, level)) }
    }

    /// 以管理员身份跑一个 .ps1（ShellExecuteEx Verb=runas）——**会弹一次 UAC**。
    /// 用户点"取消"返回 Err，调用方据此提示"已取消授权"。
    #[cfg(windows)]
    pub fn run_elevated(script: &std::path::Path) -> Result<(), String> {
        #[repr(C)]
        struct ShellExecuteInfoW {
            cb_size: u32,
            f_mask: u32,
            hwnd: *mut core::ffi::c_void,
            lp_verb: *const u16,
            lp_file: *const u16,
            lp_parameters: *const u16,
            lp_directory: *const u16,
            n_show: i32,
            h_inst_app: *mut core::ffi::c_void,
            lp_id_list: *mut core::ffi::c_void,
            lp_class: *const u16,
            hkey_class: *mut core::ffi::c_void,
            dw_hot_key: u32,
            h_icon: *mut core::ffi::c_void,
            h_process: *mut core::ffi::c_void,
        }
        #[link(name = "shell32")]
        unsafe extern "system" {
            fn ShellExecuteExW(info: *mut ShellExecuteInfoW) -> i32;
        }
        #[link(name = "kernel32")]
        unsafe extern "system" {
            fn WaitForSingleObject(h: *mut core::ffi::c_void, ms: u32) -> u32;
            fn GetExitCodeProcess(h: *mut core::ffi::c_void, code: *mut u32) -> i32;
            fn CloseHandle(h: *mut core::ffi::c_void) -> i32;
            fn GetLastError() -> u32;
        }
        const SEE_MASK_NOCLOSEPROCESS: u32 = 0x0000_0040;
        const SEE_MASK_FLAG_NO_UI: u32 = 0x0000_0400;
        const SW_SHOWNORMAL: i32 = 1;
        const ERROR_CANCELLED: u32 = 1223;

        let wide = |s: &str| -> Vec<u16> { OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect() };
        let verb = wide("runas");
        let file = wide("powershell.exe");
        let params = wide(&format!(
            "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"{}\"",
            script.display()
        ));
        let mut info = ShellExecuteInfoW {
            cb_size: std::mem::size_of::<ShellExecuteInfoW>() as u32,
            f_mask: SEE_MASK_NOCLOSEPROCESS | SEE_MASK_FLAG_NO_UI,
            hwnd: std::ptr::null_mut(),
            lp_verb: verb.as_ptr(),
            lp_file: file.as_ptr(),
            lp_parameters: params.as_ptr(),
            lp_directory: std::ptr::null(),
            n_show: SW_SHOWNORMAL,
            h_inst_app: std::ptr::null_mut(),
            lp_id_list: std::ptr::null_mut(),
            lp_class: std::ptr::null(),
            hkey_class: std::ptr::null_mut(),
            dw_hot_key: 0,
            h_icon: std::ptr::null_mut(),
            h_process: std::ptr::null_mut(),
        };
        let ok = unsafe { ShellExecuteExW(&mut info) };
        if ok == 0 {
            let err = unsafe { GetLastError() };
            return Err(if err == ERROR_CANCELLED {
                "已取消授权".to_string()
            } else {
                format!("无法发起提权：错误码 {}", err)
            });
        }
        if info.h_process.is_null() {
            return Err("提权进程句柄为空".to_string());
        }
        unsafe { WaitForSingleObject(info.h_process, 60_000) };
        let mut code: u32 = 1;
        unsafe { GetExitCodeProcess(info.h_process, &mut code) };
        unsafe { CloseHandle(info.h_process) };
        if code == 0 { Ok(()) } else { Err(format!("计划任务创建失败（退出码 {}）", code)) }
    }
}

/// 计划任务是否"就是我们要的那个"：指向当前侧车、带 --pipe、且 Highest。
fn hw_task_ready(exe: &std::path::Path) -> bool {
    match hw::task_info(HW_TASK_NAME) {
        Some((task_exe, args, level)) => {
            let same = same_path(&task_exe, exe);
            let piped = args.contains("--pipe");
            let highest = level.eq_ignore_ascii_case("highest");
            if !(same && piped && highest) {
                log::warn!("[cockpit] 计划任务与当前侧车不匹配（exe={} args={} level={}），本次走普通权限通道", task_exe, args, level);
            }
            same && piped && highest
        }
        None => false,
    }
}

/// 路径比较（大小写不敏感 + 尽量规范化；计划任务里存的可能是短路径/不同分隔符）
fn same_path(a: &str, b: &std::path::Path) -> bool {
    let norm = |p: &std::path::Path| -> String {
        p.canonicalize()
            .unwrap_or_else(|_| p.to_path_buf())
            .to_string_lossy()
            .replace('/', "\\")
            .trim_end_matches('\\')
            .to_lowercase()
    };
    norm(std::path::Path::new(a)) == norm(b)
}

fn emit_cockpit_line(app: &tauri::AppHandle, st: &Arc<CockpitState>, line: &str) {
    if line.trim().is_empty() {
        return;
    }
    if let Ok(v) = serde_json::from_str::<Value>(line) {
        *st.latest.lock().unwrap() = v.clone();
        let _ = tauri::Emitter::emit(app, "electron:CockpitData", &v);
        let _ = tauri::Emitter::emit(app, "electron:IslandCockpit", &v);
    }
}

/// main_active 或岛配置 cockpitEnabled 任一开启则运行（对齐 syncHardwareMonitor）
pub fn sync_cockpit(app: tauri::AppHandle, st: Arc<CockpitState>) -> Value {
    // 游戏模式（冻结后台）期间硬件监控侧车必须保持关闭：配置变更等触发点也不能把它拉起来
    if crate::freeze::is_frozen() {
        stop_cockpit_sidecar(&st);
        return json!({ "success": true, "running": false, "frozen": true });
    }
    let island_active = crate::config::read_config_island_cockpit_enabled();
    if st.main_active.load(Ordering::SeqCst) || island_active {
        start_cockpit(app, st)
    } else {
        stop_cockpit_sidecar(&st);
        json!({ "success": true, "running": false })
    }
}

/// 停止硬件监控（含提权计划任务实例；提权进程拿不到句柄，只能靠任务结束 + 管道断开自退）
pub fn stop_cockpit_sidecar(st: &Arc<CockpitState>) {
    // 先代数 +1：让仍在运行的读取循环失效，避免它退出时回写踩掉接下来的新通道
    st.epoch.fetch_add(1, Ordering::SeqCst);
    kill_child(&st.child);
    let was_task = st.mode.lock().map(|m| m.as_str() == "task").unwrap_or(false);
    if was_task || hw::task_info(HW_TASK_NAME).is_some() {
        hw::schtasks(&["/end", "/tn", HW_TASK_NAME]);
    }
    if let Ok(mut mode) = st.mode.lock() {
        *mode = "off".to_string();
    }
}

/// 创建提权计划任务（一次 UAC），成功后把正在跑的数据通道切到提权侧车
pub fn cockpit_setup_elevation(app: tauri::AppHandle, st: Arc<CockpitState>) -> Value {
    let Some(exe) = hardware_monitor_exe() else {
        return json!({ "success": false, "error": "硬件监控组件不存在" });
    };
    let script = format!(
        "$ErrorActionPreference = 'Stop'\r\n\
         $action = New-ScheduledTaskAction -Execute '{exe}' -Argument '--pipe {pipe}'\r\n\
         $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances Parallel -StartWhenAvailable\r\n\
         $principal = New-ScheduledTaskPrincipal -UserId \"$env:USERDOMAIN\\$env:USERNAME\" -LogonType Interactive -RunLevel Highest\r\n\
         Register-ScheduledTask -TaskName '{task}' -Action $action -Settings $settings -Principal $principal -Force | Out-Null\r\n\
         exit 0\r\n",
        exe = exe.display().to_string().replace('\'', "''"),
        pipe = HW_PIPE_NAME,
        task = HW_TASK_NAME
    );
    let path = std::env::temp_dir().join("shortcut-hw-task-setup.ps1");
    if let Err(e) = std::fs::write(&path, script.as_bytes()) {
        return json!({ "success": false, "error": format!("写入授权脚本失败: {}", e) });
    }
    let launched = hw::run_elevated(&path);
    let _ = std::fs::remove_file(&path);
    if let Err(e) = launched {
        log::warn!("[cockpit] 提权授权未完成: {}", e);
        return json!({ "success": false, "error": e });
    }
    if !hw_task_ready(&exe) {
        return json!({ "success": false, "error": "计划任务创建后校验未通过，请重试" });
    }
    log::info!("[cockpit] 提权计划任务已就绪: {}", HW_TASK_NAME);
    // 若当前不是提权通道（普通权限通道没有温度 / 干脆没在跑），切到提权通道。
    // 背靠背 stop → start：必须先等一下让旧读取循环退出并让出 starting，否则 start_cockpit
    // 会被 starting 防抖直接吞掉（这里跑在 spawn_blocking 里，阻塞式等待是安全的）。
    if st.mode.lock().map(|m| m.as_str() != "task").unwrap_or(true) {
        stop_cockpit_sidecar(&st);
        std::thread::sleep(std::time::Duration::from_millis(400));
        st.starting.store(false, Ordering::SeqCst);
        sync_cockpit(app, st);
    }
    json!({ "success": true })
}

/// 前端用来决定"要不要提示授权"的状态
pub fn cockpit_elevation_status(st: &Arc<CockpitState>) -> Value {
    let exe = hardware_monitor_exe();
    let info = hw::task_info(HW_TASK_NAME);
    let task_exists = info.is_some();
    let task_matches = match (&info, &exe) {
        (Some((task_exe, args, level)), Some(exe)) => {
            same_path(task_exe, exe) && args.contains("--pipe") && level.eq_ignore_ascii_case("highest")
        }
        _ => false,
    };
    let temps = st
        .latest
        .lock()
        .unwrap()
        .get("cpu")
        .and_then(|cpu| cpu.get("temperature"))
        .map(|t| !t.is_null())
        .unwrap_or(false);
    json!({
        "success": true,
        "selfElevated": hw::is_elevated(),
        "taskName": HW_TASK_NAME,
        "taskExists": task_exists,
        "taskExeMatches": task_matches,
        "taskExe": info.as_ref().map(|i| i.0.clone()).unwrap_or_default(),
        "sidecarPath": exe.as_ref().map(|p| p.display().to_string()).unwrap_or_default(),
        "mode": st.mode.lock().map(|m| m.clone()).unwrap_or_else(|_| "off".into()),
        "tempsAvailable": temps,
    })
}

/// 启动自检：以管理员运行时，外部拖进窗口的拖放会被 UIPI 掐掉（文档 §15.2）
pub fn log_elevation_warning() {
    if hw::is_elevated() {
        log::warn!("[app] 当前以管理员权限运行：资源管理器拖入的拖放（SC 球 / 转换面板）会被 Windows UIPI 拦掉，建议以普通权限启动");
    }
}

fn start_cockpit(app: tauri::AppHandle, st: Arc<CockpitState>) -> Value {
    {
        let guard = st.child.lock().unwrap();
        // mode == "task" 表示提权侧车正连着管道（它不是 tokio Child，没有 child 可判）
        let already_task = st.mode.lock().map(|m| m.as_str() == "task").unwrap_or(false);
        if guard.is_some() || already_task || st.starting.swap(true, Ordering::SeqCst) {
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
    let st2 = st.clone();
    // 本次启动的代数：读取循环退出时只有代数没变才允许回写状态（见 CockpitState.epoch）
    let my_epoch = st.epoch.load(Ordering::SeqCst);
    // 命令是同步函数（跑在主线程，无 Tokio reactor）——必须走 tauri::async_runtime::spawn
    tauri::async_runtime::spawn(async move {
        // ① 优先"提权计划任务 + 命名管道"：主进程保持普通权限（拖放不受影响），
        //    只有读传感器的子进程是管理员 → 能拿到 CPU/内存温度。
        if hw_task_ready(&exe) {
            #[cfg(windows)]
            {
                use tokio::io::AsyncBufReadExt;
                match tokio::net::windows::named_pipe::ServerOptions::new().create(HW_PIPE_NAME) {
                    Ok(server) => {
                        // 先建好管道再拉任务：侧车第一次连接就成功
                        hw::schtasks(&["/end", "/tn", HW_TASK_NAME]);
                        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                        if hw::schtasks(&["/run", "/tn", HW_TASK_NAME]) {
                            match tokio::time::timeout(std::time::Duration::from_secs(8), server.connect()).await {
                                Ok(Ok(())) => {
                                    if st2.epoch.load(Ordering::SeqCst) == my_epoch {
                                        if let Ok(mut mode) = st2.mode.lock() {
                                            *mode = "task".to_string();
                                        }
                                    }
                                    log::info!("[cockpit] 硬件监控已启动（提权计划任务 + 命名管道，含 CPU/内存温度）");
                                    let mut lines = tokio::io::BufReader::new(server).lines();
                                    while let Ok(Some(line)) = lines.next_line().await {
                                        emit_cockpit_line(&app, &st2, &line);
                                    }
                                    // 管道断开 = 侧车退出（被停用/被结束/自己写失败）
                                    if st2.epoch.load(Ordering::SeqCst) == my_epoch {
                                        log::info!("[cockpit] 提权侧车已退出（管道断开）");
                                        if let Ok(mut mode) = st2.mode.lock() {
                                            *mode = "off".to_string();
                                        }
                                        st2.starting.store(false, Ordering::SeqCst);
                                    } else {
                                        log::info!("[cockpit] 旧提权通道已退出（代数已变，忽略）");
                                    }
                                    return;
                                }
                                _ => log::warn!("[cockpit] 提权侧车 8s 内未连上命名管道"),
                            }
                        } else {
                            log::warn!("[cockpit] 计划任务启动失败");
                        }
                    }
                    Err(e) => log::error!("[cockpit] 命名管道创建失败: {}", e),
                }
            }
        }
        // ② 兜底：普通权限直接 spawn（stdout 行 JSON）。功能可用但**没有 CPU/内存温度**。
        let cwd = exe.parent().map(|p| p.to_path_buf());
        match tokio::process::Command::new(&exe)
            .current_dir(cwd.unwrap_or_else(|| std::path::PathBuf::from(".")))
            .creation_flags(0x08000000)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .spawn()
        {
            Ok(mut child) => {
                // 同样加入 Job Object（见 start_music_bridge 的说明）
                let my_pid = child.id();
                if let Some(pid) = my_pid {
                    job::assign(pid);
                }
                let stdout = child.stdout.take().unwrap();
                let child_slot = st2.child.clone();
                *child_slot.lock().unwrap() = Some(child);
                if st2.epoch.load(Ordering::SeqCst) == my_epoch {
                    if let Ok(mut mode) = st2.mode.lock() {
                        *mode = "stdout".to_string();
                    }
                }
                log::info!("[cockpit] 硬件监控已启动（普通权限通道：无 CPU/内存温度）");
                let mut lines = tokio::io::BufReader::new(stdout).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    emit_cockpit_line(&app, &st2, &line);
                }
                // 只有"这一段循环自己放进去的那个 child"才允许被清掉，否则会踩掉重启后的新 child
                {
                    let mut slot = child_slot.lock().unwrap();
                    if slot.as_ref().and_then(|c| c.id()) == my_pid {
                        *slot = None;
                    }
                }
                if st2.epoch.load(Ordering::SeqCst) == my_epoch {
                    if let Ok(mut mode) = st2.mode.lock() {
                        *mode = "off".to_string();
                    }
                    st2.starting.store(false, Ordering::SeqCst);
                    log::info!("[cockpit] 硬件监控进程退出");
                } else {
                    log::info!("[cockpit] 旧普通权限通道已退出（代数已变，忽略）");
                }
            }
            Err(e) => {
                log::error!("[cockpit] 硬件监控启动失败: {}", e);
                if st2.epoch.load(Ordering::SeqCst) == my_epoch {
                    st2.starting.store(false, Ordering::SeqCst);
                    if let Ok(mut mode) = st2.mode.lock() {
                        *mode = "off".to_string();
                    }
                }
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