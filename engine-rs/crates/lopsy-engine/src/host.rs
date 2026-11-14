//! What the engine asks of the program it runs inside: somewhere to send
//! log lines, and the time. A host installs both once, before it creates an
//! engine; until then log lines are dropped and the clock reads zero.

use std::sync::OnceLock;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LogLevel {
    Info,
    Warn,
    Error,
}

/// The services a host provides.
#[derive(Clone, Copy)]
pub struct Host {
    pub log: fn(LogLevel, &str),
    /// Milliseconds since some fixed moment. Only differences and the low
    /// bits (as a seed) are used.
    pub now_ms: fn() -> f64,
}

static HOST: OnceLock<Host> = OnceLock::new();

/// Install the host's services. The first call wins; later calls are
/// ignored, so creating a second engine does not replace them.
pub fn install(host: Host) {
    let _ = HOST.set(host);
}

pub fn log(level: LogLevel, message: &str) {
    if let Some(host) = HOST.get() {
        (host.log)(level, message);
    }
}

pub fn now_ms() -> f64 {
    HOST.get().map_or(0.0, |host| (host.now_ms)())
}
