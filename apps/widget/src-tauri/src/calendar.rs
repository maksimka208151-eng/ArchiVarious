use std::io::Read;
use std::time::Duration;

/// Only deployed Google Apps Script web apps are reachable, so the webview can't use this to send data anywhere else.
/// Mirrors `isAppsScriptUrl` in `@archivarious/core`.
fn is_apps_script_url(url: &str) -> bool {
    url.strip_prefix("https://script.google.com/macros/s/")
        .and_then(|rest| rest.strip_suffix("/exec"))
        .is_some_and(|id| {
            !id.is_empty()
                && id
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        })
}

/// Upper bound for the script's JSON reply.
const MAX_REPLY_BYTES: u64 = 64 * 1024;

/// Posts a calendar event (JSON built by `@archivarious/core`) to the user's Apps Script web app and returns
/// the reply text for core to interpret. Done here rather than with `fetch` in the webview because Google
/// answers through a redirect to another host, which the webview's CSP and CORS would block.
#[tauri::command]
pub async fn send_calendar_event(url: String, body: String) -> Result<String, String> {
    if !is_apps_script_url(&url) {
        return Err("адрес должен быть вида https://script.google.com/macros/s/…/exec".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let agent = ureq::AgentBuilder::new()
            .timeout(Duration::from_secs(30))
            .build();
        let response = match agent
            .post(&url)
            .set("Content-Type", "text/plain; charset=utf-8")
            .send_string(&body)
        {
            Ok(response) | Err(ureq::Error::Status(_, response)) => response,
            Err(error) => return Err(format!("нет связи с Google: {error}")),
        };
        let mut text = String::new();
        response
            .into_reader()
            .take(MAX_REPLY_BYTES)
            .read_to_string(&mut text)
            .map_err(|e| e.to_string())?;
        Ok(text)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_apps_script_urls() {
        assert!(is_apps_script_url(
            "https://script.google.com/macros/s/AKfycbx-1_a/exec"
        ));
        assert!(!is_apps_script_url(
            "https://script.google.com/macros/s//exec"
        ));
        assert!(!is_apps_script_url(
            "https://script.google.com/macros/s/x/dev"
        ));
        assert!(!is_apps_script_url(
            "https://script.google.com.evil.com/macros/s/x/exec"
        ));
        assert!(!is_apps_script_url(
            "https://script.google.com/macros/s/x/../../y/exec"
        ));
    }
}
