use std::{
    env,
    io::{Read, Write},
    net::{SocketAddr, TcpStream},
    path::PathBuf,
    process::{Command, Stdio},
    time::Duration,
};

pub fn ensure_daemon() -> Result<String, String> {
    if bridge_health_is_ok() {
        return Ok("Bridge already healthy".to_string());
    }

    run_daemon("start")
}

pub fn start_daemon() -> Result<String, String> {
    run_daemon("start")
}

pub fn stop_daemon() -> Result<String, String> {
    run_daemon("stop")
}

pub fn daemon_status() -> Result<String, String> {
    run_daemon("status")
}

fn bridge_dir() -> PathBuf {
    let override_dir = env::var("FEISHU_CLAUDE_CODE_DIR").ok().map(PathBuf::from);
    bridge_dir_from(PathBuf::from(env!("CARGO_MANIFEST_DIR")).as_path(), override_dir)
}

fn bridge_dir_from(manifest_dir: &std::path::Path, override_dir: Option<PathBuf>) -> PathBuf {
    if let Some(path) = override_dir {
        return path;
    }

    for candidate in manifest_dir.ancestors() {
        if candidate.join("scripts").join("daemon.sh").exists() {
            return candidate.to_path_buf();
        }
    }

    manifest_dir
        .parent()
        .and_then(|path| path.parent())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

#[cfg(test)]
mod tests {
    use super::bridge_dir_from;
    use std::path::PathBuf;

    #[test]
    fn uses_explicit_bridge_dir_override() {
        let manifest_dir = PathBuf::from("/workspace/crab-pet/src-tauri");

        assert_eq!(
            bridge_dir_from(&manifest_dir, Some(PathBuf::from("/tmp/bridge"))),
            PathBuf::from("/tmp/bridge")
        );
    }

    #[test]
    fn discovers_bridge_dir_above_crab_pet() {
        let manifest_dir = PathBuf::from("/Users/hilbert/.claude/skills/feishu-claude-code/crab-pet/src-tauri");

        assert_eq!(
            bridge_dir_from(&manifest_dir, None),
            PathBuf::from("/Users/hilbert/.claude/skills/feishu-claude-code")
        );
    }
}

fn run_daemon(action: &str) -> Result<String, String> {
    let project_dir = bridge_dir();
    let daemon_script = project_dir.join("scripts").join("daemon.sh");
    let output = Command::new("bash")
        .arg(&daemon_script)
        .arg(action)
        .current_dir(&project_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|error| format!("failed to run daemon: {error}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if output.status.success() {
        Ok(if stdout.is_empty() { stderr } else { stdout })
    } else {
        Err(if stderr.is_empty() { stdout } else { stderr })
    }
}

fn bridge_health_is_ok() -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], 8787));
    let timeout = Duration::from_millis(350);
    let Ok(mut stream) = TcpStream::connect_timeout(&address, timeout) else {
        return false;
    };

    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));
    if stream
        .write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .is_err()
    {
        return false;
    }

    let mut response = String::new();
    stream.read_to_string(&mut response).is_ok() && response.starts_with("HTTP/1.1 200")
}
