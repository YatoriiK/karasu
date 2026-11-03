#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod engine;

use std::fs::OpenOptions;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use engine::CREATE_NO_WINDOW;
use tauri::{Emitter, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use windows_sys::Win32::Foundation::{CloseHandle, HWND, INVALID_HANDLE_VALUE, LPARAM};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetClassNameW, GetWindowTextLengthW, GetWindowThreadProcessId, IsIconic, IsWindowVisible, ShowWindow,
    SW_HIDE, SW_SHOWMINNOACTIVE,
};

const PORT: u16 = 8765;

struct Backend {
    child: Mutex<Option<Child>>,
    job: Mutex<Option<usize>>,
}

struct Engine {
    home: Mutex<Option<PathBuf>>,
    installing: Mutex<bool>,
    error: Mutex<Option<String>>,
}

#[derive(serde::Serialize)]
struct EngineInfo {
    home: Option<String>,
    default_home: String,
    dev: bool,
    ready: bool,
    installing: bool,
    error: Option<String>,
    gpu: bool,
    free_bytes: Option<u64>,
    needs_bytes: u64,
    log: Option<String>,
}

struct Tuck {
    on: bool,
    since: Option<Instant>,
    hidden: Vec<usize>,
}

static TUCK: Mutex<Tuck> = Mutex::new(Tuck { on: false, since: None, hidden: Vec::new() });

// A source checkout runs the engine straight from its own karasu folder. Handy when you're hacking on it.
fn code_dir(app: &tauri::AppHandle, home: &Path) -> PathBuf {
    if engine::is_dev(home) {
        return home.to_path_buf();
    }
    app.path().resource_dir().map(|dir| dir.join("engine")).unwrap_or_else(|_| home.to_path_buf())
}

fn addr() -> SocketAddr {
    SocketAddr::from(([127, 0, 0, 1], PORT))
}

fn port_open() -> bool {
    TcpStream::connect_timeout(&addr(), Duration::from_millis(250)).is_ok()
}

fn log_line(home: &Path, message: &str) {
    let dir = home.join("data").join("logs");
    let _ = std::fs::create_dir_all(&dir);
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(dir.join("desktop.log")) {
        let _ = writeln!(file, "{message}");
    }
}

fn spawn_backend(home: &Path, code: &Path) -> std::io::Result<Child> {
    let python = engine::python(home);
    if !python.exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("Python environment not found at {}", python.display()),
        ));
    }
    let logs = home.join("data").join("logs");
    std::fs::create_dir_all(&logs)?;
    let out = OpenOptions::new().create(true).append(true).open(logs.join("backend.log"))?;
    let err = out.try_clone()?;
    let cache = home.join("cache");
    Command::new(python)
        .args(["-m", "karasu", "serve", "--parent-pid", &std::process::id().to_string()])
        .current_dir(home)
        .env("KARASU_HOME", home)
        .env("PYTHONPATH", code)
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .env("HF_HOME", cache.join("hf"))
        .env("TORCH_HOME", cache.join("torch"))
        .env("TEMP", cache.join("tmp"))
        .env("TMP", cache.join("tmp"))
        .env("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::from(out))
        .stderr(Stdio::from(err))
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
}

fn kill_on_close_job(child: &Child) -> Option<usize> {
    let job = engine::kill_on_close_job()?;
    if engine::assign(job, child) {
        Some(job)
    } else {
        engine::close_job(job);
        None
    }
}

fn start_backend(app: &tauri::AppHandle, home: &Path) {
    if port_open() {
        log_line(home, "backend already running, reusing it");
        return;
    }
    let code = code_dir(app, home);
    match spawn_backend(home, &code) {
        Ok(child) => {
            let job = kill_on_close_job(&child);
            log_line(home, &format!("started backend pid {} from {} (job: {})", child.id(), code.display(), job.is_some()));
            let state = app.state::<Backend>();
            *state.job.lock().unwrap() = job;
            *state.child.lock().unwrap() = Some(child);
        }
        Err(error) => log_line(home, &format!("could not start backend: {error}")),
    }
}

fn engine_snapshot(app: &tauri::AppHandle) -> EngineInfo {
    let state = app.state::<Engine>();
    let home = state.home.lock().unwrap().clone();
    let installing = *state.installing.lock().unwrap();
    let error = state.error.lock().unwrap().clone();
    let gpu = engine::gpu();
    let target = home.clone().unwrap_or_else(engine::default_home);
    EngineInfo {
        ready: home.as_ref().is_some_and(|h| engine::ready(h, &code_dir(app, h))),
        dev: home.as_ref().is_some_and(|h| engine::is_dev(h)),
        log: home.as_ref().map(|h| h.join("data").join("logs").to_string_lossy().to_string()),
        home: home.map(|h| h.to_string_lossy().to_string()),
        default_home: engine::default_home().to_string_lossy().to_string(),
        installing,
        error,
        gpu,
        free_bytes: engine::free_bytes(&target),
        needs_bytes: if gpu { engine::NEEDS_GPU } else { engine::NEEDS_CPU },
    }
}

#[tauri::command]
fn engine_info(app: tauri::AppHandle) -> EngineInfo {
    engine_snapshot(&app)
}

#[tauri::command]
fn set_engine_home(app: tauri::AppHandle, path: String) -> Result<EngineInfo, String> {
    let state = app.state::<Engine>();
    if *state.installing.lock().unwrap() {
        return Err("The engine is installing right now".into());
    }
    let path = PathBuf::from(path.trim());
    if !path.is_absolute() {
        return Err("Pick a full folder path, like C:\\Users\\you\\Karasu".into());
    }
    engine::save_home(&path)?;
    *state.home.lock().unwrap() = Some(path);
    *state.error.lock().unwrap() = None;
    Ok(engine_snapshot(&app))
}

#[tauri::command]
fn install_engine(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<Engine>();
    let home = state.home.lock().unwrap().clone().ok_or("Choose a folder first")?;
    {
        let mut installing = state.installing.lock().unwrap();
        if *installing {
            return Ok(());
        }
        *installing = true;
    }
    *state.error.lock().unwrap() = None;
    let code = code_dir(&app, &home);
    std::thread::spawn(move || {
        let emitter = app.clone();
        let result = engine::install(&home, &code, &|progress| {
            if progress.stage == "step" || progress.stage == "line" {
                let _ = emitter.emit("engine-install", progress);
            }
        });
        let state = app.state::<Engine>();
        let finished = |stage, detail: String| engine::Progress { stage, step: 0, steps: 0, label: String::new(), detail };
        match result {
            Ok(()) => {
                start_backend(&app, &home);
                *state.installing.lock().unwrap() = false;
                let _ = app.emit("engine-install", finished("done", String::new()));
            }
            Err(error) => {
                *state.error.lock().unwrap() = Some(error.clone());
                *state.installing.lock().unwrap() = false;
                let _ = app.emit("engine-install", finished("error", error));
            }
        }
    });
    Ok(())
}

fn request_shutdown() {
    if let Ok(mut stream) = TcpStream::connect_timeout(&addr(), Duration::from_millis(400)) {
        let _ = stream.set_read_timeout(Some(Duration::from_millis(800)));
        let _ = stream.write_all(
            b"POST /api/admin/shutdown HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}",
        );
        let mut buf = [0u8; 256];
        let _ = stream.read(&mut buf);
    }
}

fn stop_backend(state: &Backend) {
    let owned = state.child.lock().map(|c| c.is_some()).unwrap_or(false);
    if !owned {
        return;
    }
    request_shutdown();
    let deadline = Instant::now() + Duration::from_millis(2500);
    while Instant::now() < deadline && port_open() {
        std::thread::sleep(Duration::from_millis(100));
    }
    if let Ok(mut child) = state.child.lock() {
        if let Some(mut c) = child.take() {
            let _ = c.kill();
        }
    }
    if let Ok(mut job) = state.job.lock() {
        if let Some(handle) = job.take() {
            engine::close_job(handle);
        }
    }
}

fn spotify_exe() -> Option<PathBuf> {
    let exe = PathBuf::from(std::env::var_os("APPDATA")?).join("Spotify").join("Spotify.exe");
    exe.exists().then_some(exe)
}

fn spotify_pids() -> Vec<u32> {
    let mut pids = Vec::new();
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == INVALID_HANDLE_VALUE {
            return pids;
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut more = Process32FirstW(snap, &mut entry);
        while more != 0 {
            let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
            if String::from_utf16_lossy(&entry.szExeFile[..len]).eq_ignore_ascii_case("spotify.exe") {
                pids.push(entry.th32ProcessID);
            }
            more = Process32NextW(snap, &mut entry);
        }
        CloseHandle(snap);
    }
    pids
}

unsafe extern "system" fn collect_window(hwnd: HWND, lparam: LPARAM) -> i32 {
    let (pids, found) = &mut *(lparam as *mut (Vec<u32>, Vec<usize>));
    let mut pid = 0u32;
    GetWindowThreadProcessId(hwnd, &mut pid);
    if pids.contains(&pid) && GetWindowTextLengthW(hwnd) > 0 {
        let mut class = [0u16; 32];
        let len = GetClassNameW(hwnd, class.as_mut_ptr(), class.len() as i32).max(0) as usize;
        if String::from_utf16_lossy(&class[..len]) == "Chrome_WidgetWin_1" {
            found.push(hwnd as usize);
        }
    }
    1
}

fn spotify_windows() -> Vec<usize> {
    let pids = spotify_pids();
    if pids.is_empty() {
        return Vec::new();
    }
    let mut scan = (pids, Vec::new());
    unsafe {
        EnumWindows(Some(collect_window), &mut scan as *mut (Vec<u32>, Vec<usize>) as LPARAM);
    }
    scan.1
}

fn tuck_spotify() {
    let start = {
        let mut tuck = TUCK.lock().unwrap();
        tuck.since = Some(Instant::now());
        !std::mem::replace(&mut tuck.on, true)
    };
    if start {
        std::thread::spawn(watch_spotify);
    }
}

fn watch_spotify() {
    let mut missing = 0;
    loop {
        std::thread::sleep(Duration::from_millis(200));
        let windows = spotify_windows();
        let mut tuck = TUCK.lock().unwrap();
        if !tuck.on {
            return;
        }
        if windows.is_empty() {
            missing += 1;
            // 150 checks, 200 ms apart: 30 seconds with no Spotify window. It probably closed, so give up.
            if missing > 150 {
                tuck.on = false;
                tuck.hidden.clear();
                return;
            }
            continue;
        }
        missing = 0;
        // Spotify really wants to be seen. Right after launch it keeps popping its window back up, so for
        // 30 seconds we keep hiding it. After that, a visible window means you opened it yourself, and we back off.
        let fresh = tuck.since.is_some_and(|since| since.elapsed() < Duration::from_secs(30));
        for window in windows {
            let hwnd = window as HWND;
            unsafe {
                if IsWindowVisible(hwnd) == 0 {
                    continue;
                }
                if IsIconic(hwnd) == 0 && !fresh {
                    tuck.on = false;
                    tuck.hidden.clear();
                    return;
                }
                ShowWindow(hwnd, SW_HIDE);
            }
            if !tuck.hidden.contains(&window) {
                tuck.hidden.push(window);
            }
        }
    }
}

fn untuck_spotify() {
    let hidden = {
        let mut tuck = TUCK.lock().unwrap();
        tuck.on = false;
        std::mem::take(&mut tuck.hidden)
    };
    if hidden.is_empty() {
        return;
    }
    let live = spotify_windows();
    for window in hidden.into_iter().filter(|w| live.contains(w)) {
        unsafe {
            if IsWindowVisible(window as HWND) == 0 {
                ShowWindow(window as HWND, SW_SHOWMINNOACTIVE);
            }
        }
    }
}

#[tauri::command]
fn launch_spotify() -> bool {
    let Some(exe) = spotify_exe() else {
        return false;
    };
    if spotify_pids().is_empty() && Command::new(exe).args(["--autostart", "--minimized"]).spawn().is_err() {
        return false;
    }
    tuck_spotify();
    true
}

#[tauri::command]
fn show_spotify() -> bool {
    {
        let mut tuck = TUCK.lock().unwrap();
        tuck.on = false;
        tuck.hidden.clear();
    }
    spotify_exe().is_some_and(|exe| Command::new(exe).spawn().is_ok())
}

#[tauri::command]
fn hide_spotify() -> bool {
    if spotify_pids().is_empty() {
        return false;
    }
    tuck_spotify();
    true
}

#[derive(serde::Deserialize)]
struct Binding {
    action: String,
    keys: String,
}

#[derive(serde::Serialize)]
struct Bound {
    action: String,
    ok: bool,
    error: Option<String>,
}

#[tauri::command]
fn set_global_shortcuts(app: tauri::AppHandle, bindings: Vec<Binding>) -> Vec<Bound> {
    use tauri::Emitter;
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
    let shortcuts = app.global_shortcut();
    let _ = shortcuts.unregister_all();
    bindings
        .into_iter()
        .map(|b| {
            let action = b.action.clone();
            let result = shortcuts.on_shortcut(b.keys.as_str(), move |app, _shortcut, event| {
                if event.state() == ShortcutState::Pressed {
                    let _ = app.emit("global-shortcut", action.clone());
                }
            });
            Bound { action: b.action, ok: result.is_ok(), error: result.err().map(|e| e.to_string()) }
        })
        .collect()
}

#[tauri::command]
fn spotify_window() -> &'static str {
    let windows = spotify_windows();
    if windows.is_empty() {
        "closed"
    } else if windows.iter().any(|&w| unsafe { IsWindowVisible(w as HWND) } != 0) {
        "shown"
    } else {
        "hidden"
    }
}

fn install_from_command_line(args: &[String]) -> ! {
    let home = PathBuf::from(args.get(2).cloned().unwrap_or_else(|| engine::default_home().to_string_lossy().to_string()));
    let code = args.get(3).map(PathBuf::from).unwrap_or_else(|| {
        let exe = std::env::current_exe().unwrap_or_default();
        exe.parent().map(|dir| dir.join("engine")).unwrap_or_default()
    });
    let result = engine::install(&home, &code, &|_| {});
    std::process::exit(if result.is_ok() { 0 } else { 1 });
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("--install-engine") {
        install_from_command_line(&args);
    }
    let app = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            launch_spotify,
            show_spotify,
            hide_spotify,
            spotify_window,
            set_global_shortcuts,
            engine_info,
            set_engine_home,
            install_engine
        ])
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let home = engine::saved_home();
            app.manage(Backend { child: Mutex::new(None), job: Mutex::new(None) });
            app.manage(Engine { home: Mutex::new(home.clone()), installing: Mutex::new(false), error: Mutex::new(None) });
            let handle = app.handle().clone();
            if let Some(home) = home.as_ref().filter(|h| engine::ready(h, &code_dir(&handle, h))) {
                start_backend(&handle, home);
            }
            let mut window = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Karasu")
                .inner_size(1440.0, 900.0)
                .min_inner_size(960.0, 620.0)
                .center()
                .decorations(false)
                .shadow(true)
                .visible(false)
                .disable_drag_drop_handler();
            if let Some(home) = home.as_ref().filter(|h| engine::is_dev(h)) {
                window = window.data_directory(home.join("data").join("webview2"));
            }
            window.build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build Karasu");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            untuck_spotify();
            if let Some(state) = handle.try_state::<Backend>() {
                stop_backend(&state);
            }
        }
    });
}
