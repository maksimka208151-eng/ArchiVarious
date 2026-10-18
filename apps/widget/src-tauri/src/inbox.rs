use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Component, Path, PathBuf};

/// Writes one capture file into `<vault>/<inbox_folder>/<file_name>`.
/// The contents are produced by `@archivarious/core` (inbox protocol); Rust only guards the path.
#[tauri::command]
pub fn write_capture(
    vault_path: String,
    inbox_folder: String,
    file_name: String,
    contents: String,
) -> Result<String, String> {
    let target = resolve_target(Path::new(&vault_path), &inbox_folder, &file_name)?;
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    // `create_new` never overwrites an existing note.
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&target)
        .map_err(|e| e.to_string())?;
    file.write_all(contents.as_bytes())
        .map_err(|e| e.to_string())?;
    Ok(target.to_string_lossy().into_owned())
}

fn resolve_target(vault: &Path, inbox_folder: &str, file_name: &str) -> Result<PathBuf, String> {
    if !vault.is_absolute() || !vault.is_dir() {
        return Err(format!("vault folder not found: {}", vault.display()));
    }
    let inbox = Path::new(inbox_folder);
    if !inbox
        .components()
        .all(|c| matches!(c, Component::Normal(_)))
    {
        return Err("inbox folder must be a relative path inside the vault".into());
    }
    let name = Path::new(file_name);
    if name.components().count() != 1 || name.extension().and_then(|e| e.to_str()) != Some("md") {
        return Err("file name must be a single .md file name".into());
    }
    Ok(vault.join(inbox).join(name))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_paths_escaping_the_vault() {
        let vault = std::env::temp_dir();
        assert!(resolve_target(&vault, "../outside", "a.md").is_err());
        assert!(resolve_target(&vault, "/abs", "a.md").is_err());
        assert!(resolve_target(&vault, "Inbox", "../a.md").is_err());
        assert!(resolve_target(&vault, "Inbox", "a.txt").is_err());
        assert!(resolve_target(Path::new("relative"), "Inbox", "a.md").is_err());
    }

    #[test]
    fn writes_into_the_inbox_without_overwriting() {
        let vault = std::env::temp_dir().join(format!("archivarious-test-{}", std::process::id()));
        std::fs::create_dir_all(&vault).unwrap();
        let vault_str = vault.to_string_lossy().into_owned();
        let args = || {
            (
                vault_str.clone(),
                "ArchiVarious/Inbox".to_string(),
                "x.md".to_string(),
                "hi".to_string(),
            )
        };

        let (v, i, f, c) = args();
        let written = write_capture(v, i, f, c).unwrap();
        assert_eq!(std::fs::read_to_string(&written).unwrap(), "hi");

        let (v, i, f, c) = args();
        assert!(write_capture(v, i, f, c).is_err());
        std::fs::remove_dir_all(&vault).unwrap();
    }
}
