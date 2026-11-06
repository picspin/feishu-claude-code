use serde::Serialize;
use std::process::Command;

/// Status for the system Music.app (Apple Music / local library player).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MusicStatus {
    pub installed: bool,
    pub running: bool,
    pub playing: bool,
    pub track: Option<String>,
    pub artist: Option<String>,
    pub message: String,
}

fn run_osascript(source: &str) -> Result<String, String> {
    let output = Command::new("/usr/bin/osascript")
        .args(["-e", source])
        .output()
        .map_err(|error| format!("Failed to run osascript: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "Music AppleScript failed".into()
        } else {
            stderr
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn is_music_installed() -> bool {
    // Music.app ships with modern macOS; cover both system and legacy locations.
    [
        "/System/Applications/Music.app",
        "/Applications/Music.app",
        "/System/Applications/iTunes.app",
        "/Applications/iTunes.app",
    ]
    .iter()
    .any(|path| std::path::Path::new(path).exists())
}

fn music_app_name() -> &'static str {
    if std::path::Path::new("/System/Applications/Music.app").exists()
        || std::path::Path::new("/Applications/Music.app").exists()
    {
        "Music"
    } else {
        "iTunes"
    }
}

pub fn status() -> Result<MusicStatus, String> {
    if !is_music_installed() {
        return Ok(MusicStatus {
            installed: false,
            running: false,
            playing: false,
            track: None,
            artist: None,
            message: "Music.app is not available on this Mac".into(),
        });
    }

    let app = music_app_name();
    let script = format!(
        r#"
tell application "System Events"
  set isRunning to (name of processes) contains "{app}"
end tell
if isRunning is false then
  return "running=0|playing=0|track=|artist="
end if
tell application "{app}"
  set isPlaying to (player state is playing)
  set trackName to ""
  set artistName to ""
  try
    set trackName to name of current track
    set artistName to artist of current track
  end try
  set playingFlag to "0"
  if isPlaying then set playingFlag to "1"
  return "running=1|playing=" & playingFlag & "|track=" & trackName & "|artist=" & artistName
end tell
"#
    );

    match run_osascript(&script) {
        Ok(raw) => Ok(parse_status_line(&raw, true)),
        Err(error) => Ok(MusicStatus {
            installed: true,
            running: false,
            playing: false,
            track: None,
            artist: None,
            message: error,
        }),
    }
}

fn parse_status_line(raw: &str, installed: bool) -> MusicStatus {
    let mut running = false;
    let mut playing = false;
    let mut track = None;
    let mut artist = None;
    for part in raw.split('|') {
        if let Some((key, value)) = part.split_once('=') {
            match key {
                "running" => running = value == "1",
                "playing" => playing = value == "1",
                "track" if !value.is_empty() => track = Some(value.to_string()),
                "artist" if !value.is_empty() => artist = Some(value.to_string()),
                _ => {}
            }
        }
    }
    let message = match (running, playing, track.as_deref(), artist.as_deref()) {
        (false, _, _, _) => "Music is ready (not running)".into(),
        (true, true, Some(track), Some(artist)) => format!("Playing: {artist} — {track}"),
        (true, true, Some(track), None) => format!("Playing: {track}"),
        (true, false, Some(track), Some(artist)) => format!("Paused: {artist} — {track}"),
        (true, false, _, _) => "Music is paused".into(),
        _ => "Music is ready".into(),
    };
    MusicStatus {
        installed,
        running,
        playing,
        track,
        artist,
        message,
    }
}

pub fn playpause() -> Result<MusicStatus, String> {
    ensure_installed()?;
    let app = music_app_name();
    let script = format!(
        r#"
tell application "{app}"
  if it is not running then
    launch
    delay 0.8
    play
  else
    playpause
  end if
end tell
"#
    );
    run_osascript(&script)?;
    status()
}

pub fn play() -> Result<MusicStatus, String> {
    ensure_installed()?;
    let app = music_app_name();
    let script = format!(
        r#"
tell application "{app}"
  if it is not running then
    launch
    delay 0.8
  end if
  play
end tell
"#
    );
    run_osascript(&script)?;
    status()
}

pub fn next_track() -> Result<MusicStatus, String> {
    ensure_installed()?;
    let app = music_app_name();
    let script = format!(
        r#"
tell application "{app}"
  if it is not running then error "Music is not running"
  next track
end tell
"#
    );
    run_osascript(&script)?;
    status()
}

fn ensure_installed() -> Result<(), String> {
    if is_music_installed() {
        Ok(())
    } else {
        Err("Music.app is not available on this Mac".into())
    }
}

#[cfg(test)]
mod tests {
    use super::parse_status_line;

    #[test]
    fn parses_playing_status_line() {
        let status = parse_status_line(
            "running=1|playing=1|track=Seafoam|artist=Harbor Crabs",
            true,
        );
        assert!(status.playing);
        assert_eq!(status.track.as_deref(), Some("Seafoam"));
        assert_eq!(status.artist.as_deref(), Some("Harbor Crabs"));
        assert!(status.message.contains("Playing"));
    }

    #[test]
    fn parses_idle_status_line() {
        let status = parse_status_line("running=0|playing=0|track=|artist=", true);
        assert!(!status.running);
        assert!(!status.playing);
        assert!(status.message.contains("ready"));
    }
}
