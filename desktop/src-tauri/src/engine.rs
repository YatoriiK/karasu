use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::os::windows::io::AsRawHandle;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};

pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const UV_URL: &str = "https://github.com/astral-sh/uv/releases/download/0.13.1/uv-x86_64-pc-windows-msvc.zip";
const UV_SHA256: &str = "3b2661a463a5baea7f5076ea2b25ab71d77f36a6c0d809e5350651792f80a672";
const PYTHON: &str = "3.12";
const TORCH_GPU: &str = "https://download.pytorch.org/whl/cu128";
const TORCH_CPU: &str = "https://download.pytorch.org/whl/cpu";
const MODEL: &str = "laion/larger_clap_music_and_speech";
const STAMP: &str = "karasu-engine.txt";
const STEPS: usize = 5;
pub const NEEDS_GPU: u64 = 7 * 1024 * 1024 * 1024;
pub const NEEDS_CPU: u64 = 3 * 1024 * 1024 * 1024;

#[derive(Clone, serde::Serialize)]
pub struct Progress {
    pub stage: &'static str,
    pub step: usize,
    pub steps: usize,
    pub label: String,
    pub detail: String,
}

pub fn location_file() -> Option<PathBuf> {
    Some(PathBuf::from(std::env::var_os("APPDATA")?).join("app.karasu.desktop").join("engine-home.txt"))
}

pub fn saved_home() -> Option<PathBuf> {
    for key in ["KARASU_HOME", "CRATEDIGGER_HOME"] {
        if let Ok(value) = std::env::var(key) {
            if !value.trim().is_empty() {
                return Some(PathBuf::from(value.trim()));
            }
        }
    }
    let text = fs::read_to_string(location_file()?).ok()?;
    let line = text.trim();
    (!line.is_empty()).then(|| PathBuf::from(line))
}

pub fn default_home() -> PathBuf {
    std::env::var_os("USERPROFILE").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\")).join("Karasu")
}

pub fn save_home(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| format!("Couldn't create {}: {e}", path.display()))?;
    let probe = path.join(".karasu-write-test");
    fs::write(&probe, b"ok").map_err(|e| format!("Karasu can't write to {}: {e}", path.display()))?;
    let _ = fs::remove_file(probe);
    let file = location_file().ok_or("Windows didn't say where app settings go (APPDATA is missing)")?;
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::write(file, path.to_string_lossy().as_bytes()).map_err(|e| e.to_string())
}

pub fn is_dev(home: &Path) -> bool {
    home.join("digger").join("__init__.py").exists()
}

pub fn python(home: &Path) -> PathBuf {
    home.join(".venv").join("Scripts").join("python.exe")
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn stamp(code: &Path) -> String {
    let mut hash = Sha256::new();
    hash.update(UV_URL);
    hash.update(PYTHON);
    hash.update(MODEL);
    hash.update(fs::read(code.join("requirements.txt")).unwrap_or_default());
    hex(&hash.finalize())
}

pub fn ready(home: &Path, code: &Path) -> bool {
    if !python(home).exists() {
        return false;
    }
    is_dev(home) || fs::read_to_string(home.join(".venv").join(STAMP)).is_ok_and(|s| s.trim() == stamp(code))
}

pub fn gpu() -> bool {
    static FOUND: OnceLock<bool> = OnceLock::new();
    *FOUND.get_or_init(|| {
        Command::new("nvidia-smi")
            .arg("-L")
            .stdin(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .is_ok_and(|out| out.status.success() && String::from_utf8_lossy(&out.stdout).contains("GPU"))
    })
}

pub fn free_bytes(path: &Path) -> Option<u64> {
    let mut probe = path.to_path_buf();
    while !probe.exists() {
        probe = probe.parent()?.to_path_buf();
    }
    let wide: Vec<u16> = probe.as_os_str().to_string_lossy().encode_utf16().chain(Some(0)).collect();
    let mut free = 0u64;
    let ok = unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), &mut free, std::ptr::null_mut(), std::ptr::null_mut()) };
    (ok != 0).then_some(free)
}

pub fn kill_on_close_job() -> Option<usize> {
    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return None;
        }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let ok = SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const core::ffi::c_void,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        if ok == 0 {
            CloseHandle(job);
            return None;
        }
        Some(job as usize)
    }
}

pub fn assign(job: usize, child: &Child) -> bool {
    unsafe { AssignProcessToJobObject(job as HANDLE, child.as_raw_handle() as HANDLE) != 0 }
}

pub fn close_job(job: usize) {
    unsafe {
        CloseHandle(job as HANDLE);
    }
}

fn system_tool(name: &str) -> PathBuf {
    std::env::var_os("SystemRoot")
        .map(|root| PathBuf::from(root).join("System32").join(name))
        .filter(|p| p.exists())
        .unwrap_or_else(|| PathBuf::from(name))
}

struct Installer<'a> {
    home: PathBuf,
    log: Option<File>,
    emit: &'a dyn Fn(Progress),
    job: Option<usize>,
    step: usize,
    label: String,
    sent: Instant,
    tail: Vec<String>,
}

impl Installer<'_> {
    fn note(&mut self, text: &str) {
        if let Some(log) = self.log.as_mut() {
            let _ = writeln!(log, "{text}");
        }
    }

    fn progress(&self, stage: &'static str, detail: &str) {
        (self.emit)(Progress { stage, step: self.step, steps: STEPS, label: self.label.clone(), detail: detail.to_string() });
    }

    fn begin(&mut self, step: usize, label: &str) {
        self.step = step;
        self.label = label.to_string();
        self.tail.clear();
        self.note(&format!("== {step}/{STEPS} {label}"));
        self.progress("step", "");
    }

    fn line(&mut self, text: &str) {
        let text = text.trim();
        if text.is_empty() {
            return;
        }
        self.note(text);
        self.tail.push(text.to_string());
        if self.tail.len() > 12 {
            self.tail.remove(0);
        }
        if self.sent.elapsed() >= Duration::from_millis(120) {
            self.sent = Instant::now();
            self.progress("line", text);
        }
    }

    fn command(&self, program: &Path) -> Command {
        let cache = self.home.join("cache");
        let mut cmd = Command::new(program);
        cmd.current_dir(&self.home)
            .env("UV_CACHE_DIR", cache.join("uv"))
            .env("UV_PYTHON_INSTALL_DIR", self.home.join("runtime").join("python"))
            .env("UV_NO_CONFIG", "1")
            .env("HF_HOME", cache.join("hf"))
            .env("TORCH_HOME", cache.join("torch"))
            .env("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
            .env("TEMP", cache.join("tmp"))
            .env("TMP", cache.join("tmp"))
            .env("PYTHONUTF8", "1")
            .env("PYTHONIOENCODING", "utf-8")
            .env_remove("VIRTUAL_ENV")
            .env_remove("PYTHONPATH")
            .env_remove("PYTHONHOME")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .creation_flags(CREATE_NO_WINDOW);
        cmd
    }

    fn run(&mut self, mut cmd: Command, what: &str) -> Result<(), String> {
        self.note(&format!("$ {cmd:?}"));
        let mut child = cmd.spawn().map_err(|e| format!("Couldn't start {what}: {e}"))?;
        if let Some(job) = self.job {
            assign(job, &child);
        }
        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        let readers: Vec<_> = [child.stdout.take().map(|s| Box::new(s) as Box<dyn Read + Send>), child.stderr.take().map(|s| Box::new(s) as Box<dyn Read + Send>)]
            .into_iter()
            .flatten()
            .map(|mut stream| {
                let tx = tx.clone();
                std::thread::spawn(move || {
                    let mut buf = [0u8; 4096];
                    while let Ok(n) = stream.read(&mut buf) {
                        if n == 0 || tx.send(buf[..n].to_vec()).is_err() {
                            break;
                        }
                    }
                })
            })
            .collect();
        drop(tx);
        let mut pending = Vec::new();
        for chunk in rx {
            for byte in chunk {
                if byte == b'\n' || byte == b'\r' {
                    let text = String::from_utf8_lossy(&pending).to_string();
                    self.line(&text);
                    pending.clear();
                } else {
                    pending.push(byte);
                }
            }
        }
        let text = String::from_utf8_lossy(&pending).to_string();
        self.line(&text);
        for reader in readers {
            let _ = reader.join();
        }
        let status = child.wait().map_err(|e| e.to_string())?;
        if status.success() {
            return Ok(());
        }
        let tail = self.tail.iter().rev().take(6).rev().cloned().collect::<Vec<_>>().join("\n");
        Err(format!("{what} failed ({status}).\n{tail}"))
    }

    fn uv(&mut self) -> Result<PathBuf, String> {
        let dir = self.home.join("runtime").join("uv");
        let uv = dir.join("uv.exe");
        let marker = dir.join("source.txt");
        if uv.exists() && fs::read_to_string(&marker).is_ok_and(|s| s.trim() == UV_URL) {
            return Ok(uv);
        }
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let zip = self.home.join("cache").join("tmp").join("uv.zip");
        let mut curl = self.command(&system_tool("curl.exe"));
        curl.args(["-L", "--fail", "--retry", "3", "--silent", "--show-error", "-o"]).arg(&zip).arg(UV_URL);
        self.run(curl, "Downloading uv")?;
        let mut file = File::open(&zip).map_err(|e| e.to_string())?;
        let mut hash = Sha256::new();
        std::io::copy(&mut file, &mut hash).map_err(|e| e.to_string())?;
        let got = hex(&hash.finalize());
        if got != UV_SHA256 {
            let _ = fs::remove_file(&zip);
            return Err(format!("The downloaded installer didn't match its checksum (got {got}). Try again, or check your connection."));
        }
        let mut tar = self.command(&system_tool("tar.exe"));
        tar.arg("-xf").arg(&zip).arg("-C").arg(&dir);
        self.run(tar, "Unpacking uv")?;
        let _ = fs::remove_file(&zip);
        if !uv.exists() {
            return Err("uv.exe wasn't in the download".into());
        }
        fs::write(&marker, UV_URL).map_err(|e| e.to_string())?;
        Ok(uv)
    }
}

pub fn install(home: &Path, code: &Path, emit: &dyn Fn(Progress)) -> Result<(), String> {
    let logs = home.join("data").join("logs");
    for dir in [logs.clone(), home.join("cache").join("tmp")] {
        fs::create_dir_all(&dir).map_err(|e| format!("Couldn't create {}: {e}", dir.display()))?;
    }
    let requirements = code.join("requirements.txt");
    if !requirements.exists() {
        return Err(format!("Karasu's engine files are missing ({}). Reinstall Karasu.", requirements.display()));
    }
    let job = kill_on_close_job();
    let mut run = Installer {
        home: home.to_path_buf(),
        log: OpenOptions::new().create(true).append(true).open(logs.join("install.log")).ok(),
        emit,
        job,
        step: 0,
        label: String::new(),
        sent: Instant::now(),
        tail: Vec::new(),
    };
    run.note(&format!("Karasu engine install into {} (code {})", home.display(), code.display()));
    let result = (|| -> Result<(), String> {
        run.begin(1, "Getting the installer");
        let uv = run.uv()?;

        run.begin(2, "Downloading Python");
        let py = python(home);
        if !py.exists() {
            let mut venv = run.command(&uv);
            venv.args(["venv", "--python", PYTHON, "--python-preference", "only-managed", "--no-project"]).arg(home.join(".venv"));
            run.run(venv, "Setting up Python")?;
        }

        let gpu = gpu();
        run.begin(3, if gpu { "Installing PyTorch for your NVIDIA card" } else { "Installing PyTorch" });
        let mut torch = run.command(&uv);
        torch.args(["pip", "install", "--python"]).arg(&py).args(["torch", "--index-url", if gpu { TORCH_GPU } else { TORCH_CPU }]);
        run.run(torch, "Installing PyTorch")?;

        run.begin(4, "Installing Karasu's engine");
        let mut deps = run.command(&uv);
        deps.args(["pip", "install", "--python"]).arg(&py).arg("-r").arg(&requirements);
        run.run(deps, "Installing the engine")?;

        run.begin(5, "Downloading the audio model");
        let mut model = run.command(&py);
        model.args([
            "-c",
            &format!(
                "from transformers import ClapModel, ClapProcessor\nClapProcessor.from_pretrained('{MODEL}')\nClapModel.from_pretrained('{MODEL}')\nprint('model ready')"
            ),
        ]);
        run.run(model, "Downloading the audio model")?;

        fs::write(home.join(".venv").join(STAMP), stamp(code)).map_err(|e| e.to_string())?;
        Ok(())
    })();
    match &result {
        Ok(()) => {
            run.note("== done");
            run.progress("done", "");
        }
        Err(error) => {
            run.note(&format!("== failed: {error}"));
            (run.emit)(Progress { stage: "error", step: run.step, steps: STEPS, label: run.label.clone(), detail: error.clone() });
        }
    }
    if let Some(job) = job {
        close_job(job);
    }
    result
}
