use serde_json::{json, Map, Value};
use std::{collections::HashMap, fs, path::PathBuf, process::Command};

const CONFIG_DIR: &str = ".feishu-claude-code";
const CONFIG_FILE: &str = "config.json";

pub fn open_setup_guide(url: &str) -> Result<(), String> {
    if !is_allowed_setup_url(url) {
        return Err("Unsupported setup guide URL".into());
    }

    Command::new("/usr/bin/open")
        .arg(url)
        .status()
        .map_err(|error| format!("Failed to open setup guide: {error}"))?;
    Ok(())
}

pub fn save_setup_config(config: HashMap<String, String>) -> Result<String, String> {
    let channel = config
        .get("channel")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Missing IM channel".to_string())?;

    let config_path = config_path()?;
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create config directory: {error}"))?;
    }

    let mut root = read_existing_config(&config_path)?;
    ensure_defaults(&mut root);

    match channel {
        "feishu" => save_feishu_config(&mut root, &config)?,
        "wechat" | "wecom" => save_future_channel_config(&mut root, channel, &config)?,
        _ => return Err("Unsupported IM channel".into()),
    }

    fs::write(
        &config_path,
        serde_json::to_vec_pretty(&root)
            .map_err(|error| format!("Failed to encode config: {error}"))?,
    )
    .map_err(|error| format!("Failed to write config: {error}"))?;

    Ok(format!(
        "Saved {channel} Claude Code bridge config to {}",
        config_path.display()
    ))
}

fn save_feishu_config(root: &mut Value, config: &HashMap<String, String>) -> Result<(), String> {
    set_string(root, "appId", required(config, "appId")?);
    set_string(root, "appSecret", required(config, "appSecret")?);
    set_optional_string(root, "verificationToken", config.get("verificationToken"));
    set_optional_string(root, "encryptKey", config.get("encryptKey"));
    set_optional_string(root, "publicBaseUrl", config.get("publicBaseUrl"));
    set_string(root, "webhookPath", "/feishu/webhook");
    set_string(root, "activeChannel", "feishu");
    Ok(())
}

fn save_future_channel_config(
    root: &mut Value,
    channel: &str,
    config: &HashMap<String, String>,
) -> Result<(), String> {
    let mut channel_config = Map::new();
    channel_config.insert("status".into(), json!("planned"));
    channel_config.insert("bridge".into(), json!("claude-code"));
    channel_config.insert("login".into(), json!("qr"));
    channel_config.insert(
        "displayName".into(),
        json!(required(config, "displayName")?),
    );
    if let Some(value) = optional(config.get("callbackUrl")) {
        channel_config.insert("callbackUrl".into(), json!(value));
    }

    if !root.get("channels").is_some_and(Value::is_object) {
        root["channels"] = Value::Object(Map::new());
    }
    root["channels"][channel] = Value::Object(channel_config);
    set_string(root, "activeChannel", channel);
    Ok(())
}

fn ensure_defaults(root: &mut Value) {
    if !root.is_object() {
        *root = Value::Object(Map::new());
    }
    if root.get("port").is_none() {
        root["port"] = json!(8787);
    }
    if root.get("webhookPath").is_none() {
        root["webhookPath"] = json!("/feishu/webhook");
    }
    if root.get("workingDirectory").is_none() {
        root["workingDirectory"] = json!(std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .display()
            .to_string());
    }
    if root.get("permissionMode").is_none() {
        root["permissionMode"] = json!("default");
    }
}

fn read_existing_config(path: &PathBuf) -> Result<Value, String> {
    if !path.exists() {
        return Ok(Value::Object(Map::new()));
    }
    let contents =
        fs::read_to_string(path).map_err(|error| format!("Failed to read config: {error}"))?;
    serde_json::from_str(&contents)
        .map_err(|error| format!("Failed to parse existing config: {error}"))
}

fn config_path() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME is unavailable".to_string())?;
    Ok(PathBuf::from(home).join(CONFIG_DIR).join(CONFIG_FILE))
}

fn required<'a>(config: &'a HashMap<String, String>, key: &str) -> Result<&'a str, String> {
    optional(config.get(key)).ok_or_else(|| format!("Missing required field: {key}"))
}

fn optional(value: Option<&String>) -> Option<&str> {
    value
        .map(String::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn set_string(root: &mut Value, key: &str, value: &str) {
    root[key] = json!(value);
}

fn set_optional_string(root: &mut Value, key: &str, value: Option<&String>) {
    if let Some(value) = optional(value) {
        set_string(root, key, value);
    }
}

fn is_allowed_setup_url(url: &str) -> bool {
    [
        "https://open.feishu.cn/",
        "https://open.larksuite.com/",
        "https://github.com/picspin/feishu-claude-code",
        "https://github.com/Tencent/openclaw-weixin",
        "https://github.com/WecomTeam/wecom-openclaw-plugin",
    ]
    .iter()
    .any(|prefix| url.starts_with(prefix))
}

#[cfg(test)]
mod tests {
    use super::is_allowed_setup_url;

    #[test]
    fn allows_only_known_setup_urls() {
        assert!(is_allowed_setup_url("https://open.feishu.cn/app"));
        assert!(is_allowed_setup_url(
            "https://github.com/picspin/feishu-claude-code"
        ));
        assert!(!is_allowed_setup_url("https://example.com"));
    }
}
