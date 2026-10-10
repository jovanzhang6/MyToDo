//! 极简应用日志：追加写 %APPDATA%/com.mytodo.app/mytodo.log。
//! 目的：窗口程序的 stderr 不可见，进程消失时这里必须有黑匣子可查。

use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

static LOG_PATH: Mutex<Option<PathBuf>> = Mutex::new(None);

/// 初始化日志路径并写下启动标记（Data 目录与 data.json 同层）；同时清除干净退出标记
/// （标记只在「用户主动退出」后存在，看门狗据此决定是否拉起）。
pub fn init(path: PathBuf) {
    *LOG_PATH.lock().unwrap() = Some(path);
    log_line("── 应用启动 ──");
    let _ = std::fs::remove_file(clean_exit_marker());
}

/// 干净退出：写标记 + 记日志。异常死亡（强杀/panic/断电）都不会走到这里，
/// 看门狗看到「进程不在 + 无标记」就会把应用拉起来。
pub fn write_clean_exit_marker() {
    if let Some(path) = LOG_PATH.lock().unwrap().as_ref() {
        let stamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        let _ = std::fs::write(clean_exit_marker(), stamp);
    }
    log_line("正常退出");
}

fn clean_exit_marker() -> PathBuf {
    LOG_PATH
        .lock()
        .unwrap()
        .as_ref()
        .map(|p| p.with_file_name(".clean_exit"))
        .unwrap_or_default()
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
