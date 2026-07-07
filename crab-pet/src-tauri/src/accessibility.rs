use serde::Serialize;
use std::process::Command;

#[derive(Debug, Clone, Serialize)]
pub struct WindowBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

pub fn frontmost_window_bounds() -> Result<Option<WindowBounds>, String> {
    let script = r#"
tell application "System Events"
  set candidates to application processes whose visible is true and name is not "Dardanus" and name is not "feishu-crab-pet"
  repeat with candidate in candidates
    try
      if (count of windows of candidate) > 0 then
        set targetWindow to first window of candidate
        set windowPosition to position of targetWindow
        set windowSize to size of targetWindow
        return ((item 1 of windowPosition) as text) & "," & ((item 2 of windowPosition) as text) & "," & ((item 1 of windowSize) as text) & "," & ((item 2 of windowSize) as text)
      end if
    end try
  end repeat
end tell
return ""
"#;

    let output = Command::new("/usr/bin/osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|error| format!("Failed to query macOS window bounds: {error}"))?;

    if !output.status.success() {
        return Ok(None);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_window_bounds(stdout.trim())
}

fn parse_window_bounds(value: &str) -> Result<Option<WindowBounds>, String> {
    if value.is_empty() {
        return Ok(None);
    }

    let parts = value
        .split(',')
        .map(str::trim)
        .map(str::parse::<f64>)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to parse macOS window bounds: {error}"))?;
    if parts.len() != 4 || parts[2] <= 0.0 || parts[3] <= 0.0 {
        return Ok(None);
    }

    Ok(Some(WindowBounds {
        x: parts[0],
        y: parts[1],
        width: parts[2],
        height: parts[3],
    }))
}

#[cfg(test)]
mod tests {
    use super::parse_window_bounds;

    #[test]
    fn parses_window_bounds() {
        let bounds = parse_window_bounds("120, 80, 1440, 900").unwrap().unwrap();
        assert_eq!(bounds.x, 120.0);
        assert_eq!(bounds.y, 80.0);
        assert_eq!(bounds.width, 1440.0);
        assert_eq!(bounds.height, 900.0);
    }

    #[test]
    fn ignores_empty_or_invalid_bounds() {
        assert!(parse_window_bounds("").unwrap().is_none());
        assert!(parse_window_bounds("1,2,0,4").unwrap().is_none());
    }
}
