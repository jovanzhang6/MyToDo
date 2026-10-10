//! 极简应用日志：追加写 %APPDATA%/com.mytodo.app/mytodo.log。
//! 目的：窗口程序的 stderr 不可见，进程消失时这里必须有黑匣子可查。

use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

static LOG_PATH: Mutex<Option<PathBuf>> = Mutex::new(None);

/// 初始化日志路径并写下启动标记（Data 目录与 data.json 同层）
pub fn init(path: PathBuf) {
    *LOG_PATH.lock().unwrap() = Some(path);
    log_line("── 应用启动 ──");
}

/// 追加一行带时间戳的日志；写失败静默（日志永远不能反过来伤害应用）。
pub fn log_line(msg: &str) {
    let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
    if let Some(path) = LOG_PATH.lock().unwrap().as_ref() {
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(f, "[{ts}] {msg}");
        }
    }
}

/// panic 黑匣子：任何线程崩溃都落盘（release 配置 panic=abort，这是唯一的死亡记录）。
pub fn install_panic_hook() {
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let loc = info.location().map(|l| l.to_string()).unwrap_or_default();
        let payload = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| s.to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "unknown panic".to_string());
        let thread = std::thread::current().name().unwrap_or("<unnamed>").to_string();
        log_line(&format!("PANIC thread={thread} at {loc}: {payload}"));
        default(info);
    }));
}
