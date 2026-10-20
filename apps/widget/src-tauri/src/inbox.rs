use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Read, Write};
use std::path::{Component, Path, PathBuf};

use serde::Serialize;

/// Notes are read only up to this many bytes when indexing the vault: enough for frontmatter and headings.
const SNIPPET_BYTES: u64 = 4096;
/// Safety valve for huge vaults; the placement index is built from this many notes at most.
const MAX_SCANNED_NOTES: usize = 20_000;
/// Upper bound for the plugin's `data.json` (it holds settings and learned folder preferences).
const MAX_PLUGIN_DATA_BYTES: u64 = 2 * 1024 * 1024;
const PLUGIN_DATA_PATH: &str = ".obsidian/plugins/archivarious/data.json";
/// The user's section list, shared with the plugin. Same path as `SECTIONS_FILE` in `@archivarious/core`.
const SECTIONS_PATH: &str = "ArchiVarious/Разделы.md";
/// The section list is a short note; anything larger is not ours to rewrite.
const MAX_SECTIONS_BYTES: u64 = 256 * 1024;

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
    create_new_file(&target, contents.as_bytes()).map_err(|e| e.to_string())?;
    Ok(target.to_string_lossy().into_owned())
}

/// Writes a sorted note into `<vault>/<folder>/`, picking `Name.md`, `Name 1.md`, … so an existing
/// note is never overwritten. Returns the file name that was used.
#[tauri::command]
pub fn write_note_unique(
    vault_path: String,
    folder: String,
    file_name: String,
    contents: String,
) -> Result<String, String> {
    let vault = Path::new(&vault_path);
    resolve_target(vault, &folder, &file_name)?;
    let stem = file_name.strip_suffix(".md").unwrap_or(&file_name);
    for n in 0..1000 {
        let candidate = if n == 0 {
            file_name.clone()
        } else {
            format!("{stem} {n}.md")
        };
        let target = resolve_target(vault, &folder, &candidate)?;
        match create_new_file(&target, contents.as_bytes()) {
            Ok(()) => return Ok(candidate),
            Err(e) if e.kind() == ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("too many notes with the same name".into())
}

/// Adds an entry to the end of an existing note. `block` is the entry as Markdown (`entryBlock` in core);
/// the separator before it is chosen from how the note already ends, so nothing above it changes.
#[tauri::command]
pub fn append_to_note(vault_path: String, path: String, block: String) -> Result<(), String> {
    let (folder, file_name) = path.rsplit_once('/').unwrap_or(("", path.as_str()));
    let target = resolve_target(Path::new(&vault_path), folder, file_name)?;
    let existing = fs::read_to_string(&target).map_err(|e| e.to_string())?;
    let separator = if existing.trim().is_empty() || existing.ends_with("\n\n") {
        ""
    } else if existing.ends_with('\n') {
        "\n"
    } else {
        "\n\n"
    };
    let mut file = OpenOptions::new()
        .append(true)
        .open(&target)
        .map_err(|e| e.to_string())?;
    file.write_all(format!("{separator}{block}").as_bytes())
        .map_err(|e| e.to_string())
}

/// Creates the note only if it does not exist yet (folder hub notes). Returns whether it was created.
#[tauri::command]
pub fn ensure_note(
    vault_path: String,
    folder: String,
    file_name: String,
    contents: String,
) -> Result<bool, String> {
    let target = resolve_target(Path::new(&vault_path), &folder, &file_name)?;
    match create_new_file(&target, contents.as_bytes()) {
        Ok(()) => Ok(true),
        Err(e) if e.kind() == ErrorKind::AlreadyExists => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}

#[derive(Serialize, Debug, PartialEq)]
pub struct NoteSnippet {
    /// Vault-relative, forward slashes.
    pub path: String,
    pub text: String,
}

/// Reads the beginning of every Markdown note (outside dot-folders and the inbox) so the widget can
/// suggest folders without Obsidian running. Symlinks are not followed.
#[tauri::command]
pub fn scan_vault(vault_path: String, inbox_folder: String) -> Result<Vec<NoteSnippet>, String> {
    let vault = Path::new(&vault_path);
    check_vault(vault)?;
    let inbox = inbox_folder.trim_matches('/').to_string();
    let mut notes = Vec::new();
    scan_dir(vault, "", &inbox, &mut notes);
    Ok(notes)
}

/// Raw contents of the plugin's `data.json`, if the plugin is installed in this vault.
#[tauri::command]
pub fn read_plugin_data(vault_path: String) -> Result<Option<String>, String> {
    let vault = Path::new(&vault_path);
    check_vault(vault)?;
    let file = match fs::File::open(vault.join(PLUGIN_DATA_PATH)) {
        Ok(file) => file,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    let mut text = String::new();
    file.take(MAX_PLUGIN_DATA_BYTES)
        .read_to_string(&mut text)
        .map_err(|e| e.to_string())?;
    Ok(Some(text))
}

/// The section list note, if it exists.
#[tauri::command]
pub fn read_sections(vault_path: String) -> Result<Option<String>, String> {
    let vault = Path::new(&vault_path);
    check_vault(vault)?;
    let file = match fs::File::open(vault.join(SECTIONS_PATH)) {
        Ok(file) => file,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    let mut text = String::new();
    file.take(MAX_SECTIONS_BYTES)
        .read_to_string(&mut text)
        .map_err(|e| e.to_string())?;
    Ok(Some(text))
}

/// Rewrites the section list note and creates the folders of the given sections. This is the only command
/// that overwrites a file, and only this one fixed file; section folders go through the usual path guard.
#[tauri::command]
pub fn write_sections(
    vault_path: String,
    contents: String,
    folders: Vec<String>,
) -> Result<(), String> {
    let vault = Path::new(&vault_path);
    let mut dirs = Vec::new();
    for folder in &folders {
        // Validated as `<folder>/x.md`, then only the folder is created.
        let probe = resolve_target(vault, folder, "x.md")?;
        dirs.extend(probe.parent().map(Path::to_path_buf));
    }
    let target = vault.join(SECTIONS_PATH);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&target, contents).map_err(|e| e.to_string())?;
    for dir in dirs {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn scan_dir(dir: &Path, relative: &str, inbox: &str, notes: &mut Vec<NoteSnippet>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        if notes.len() >= MAX_SCANNED_NOTES {
            return;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let path = if relative.is_empty() {
            name.clone()
        } else {
            format!("{relative}/{name}")
        };
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_dir() {
            if !inbox.is_empty() && path == inbox {
                continue;
            }
            scan_dir(&entry.path(), &path, inbox, notes);
        } else if kind.is_file() && name.to_lowercase().ends_with(".md") {
            if let Some(text) = read_head(&entry.path()) {
                notes.push(NoteSnippet { path, text });
            }
        }
    }
}

pub(crate) fn read_head(path: &Path) -> Option<String> {
    let file = fs::File::open(path).ok()?;
    let mut bytes = Vec::new();
    file.take(SNIPPET_BYTES).read_to_end(&mut bytes).ok()?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

pub(crate) fn create_new_file(target: &Path, contents: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    // `create_new` never overwrites an existing note.
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(target)?;
    file.write_all(contents)
}

pub(crate) fn check_vault(vault: &Path) -> Result<(), String> {
    if !vault.is_absolute() || !vault.is_dir() {
        return Err(format!("vault folder not found: {}", vault.display()));
    }
    Ok(())
}

pub(crate) fn resolve_target(
    vault: &Path,
    folder: &str,
    file_name: &str,
) -> Result<PathBuf, String> {
    resolve_file(vault, folder, file_name, &["md"])
}

/// `<vault>/<folder>/<file_name>` after checking that it stays inside the vault, outside hidden folders,
/// and that the file name is a single name with one of the allowed extensions.
pub(crate) fn resolve_file(
    vault: &Path,
    folder: &str,
    file_name: &str,
    extensions: &[&str],
) -> Result<PathBuf, String> {
    check_vault(vault)?;
    let folder = Path::new(folder);
    if !folder
        .components()
        .all(|c| matches!(c, Component::Normal(_)))
    {
        return Err("folder must be a relative path inside the vault".into());
    }
    // The vault's own settings folder is off limits, whatever the caller asks for.
    if folder
        .components()
        .next()
        .is_some_and(|c| c.as_os_str().to_string_lossy().starts_with('.'))
    {
        return Err("folder must not be a hidden folder".into());
    }
    let name = Path::new(file_name);
    let extension = name
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_lowercase);
    if name.components().count() != 1
        || !matches!(name.components().next(), Some(Component::Normal(_)))
        || !extension.is_some_and(|e| extensions.contains(&e.as_str()))
    {
        return Err(format!(
            "file name must be a single file name ending in .{}",
            extensions.join(" / .")
        ));
    }
    Ok(vault.join(folder).join(name))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_vault(tag: &str) -> PathBuf {
        let vault =
            std::env::temp_dir().join(format!("archivarious-test-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&vault);
        fs::create_dir_all(&vault).unwrap();
        vault
    }

    fn s(v: &Path) -> String {
        v.to_string_lossy().into_owned()
    }

    #[test]
    fn rejects_paths_escaping_the_vault() {
        let vault = std::env::temp_dir();
        assert!(resolve_target(&vault, "../outside", "a.md").is_err());
        assert!(resolve_target(&vault, "/abs", "a.md").is_err());
        assert!(resolve_target(&vault, ".obsidian", "a.md").is_err());
        assert!(resolve_target(&vault, "Inbox", "../a.md").is_err());
        assert!(resolve_target(&vault, "Inbox", "a.txt").is_err());
        assert!(resolve_target(Path::new("relative"), "Inbox", "a.md").is_err());
    }

    #[test]
    fn writes_into_the_inbox_without_overwriting() {
        let vault = temp_vault("inbox");
        let args = || {
            (
                s(&vault),
                "ArchiVarious/Inbox".to_string(),
                "x.md".to_string(),
                "hi".to_string(),
            )
        };

        let (v, i, f, c) = args();
        let written = write_capture(v, i, f, c).unwrap();
        assert_eq!(fs::read_to_string(&written).unwrap(), "hi");

        let (v, i, f, c) = args();
        assert!(write_capture(v, i, f, c).is_err());
        fs::remove_dir_all(&vault).unwrap();
    }

    #[test]
    fn appends_an_entry_after_the_existing_text() {
        let vault = temp_vault("append");
        fs::create_dir_all(vault.join("Learning")).unwrap();
        fs::write(vault.join("Learning/Ideas.md"), "# Ideas\n").unwrap();
        append_to_note(s(&vault), "Learning/Ideas.md".into(), "### one\n".into()).unwrap();
        append_to_note(s(&vault), "Learning/Ideas.md".into(), "### two\n".into()).unwrap();
        assert_eq!(
            fs::read_to_string(vault.join("Learning/Ideas.md")).unwrap(),
            "# Ideas\n\n### one\n\n### two\n"
        );
        assert!(append_to_note(s(&vault), "Learning/Missing.md".into(), "x".into()).is_err());
        assert!(append_to_note(s(&vault), "../Ideas.md".into(), "x".into()).is_err());
        fs::remove_dir_all(&vault).unwrap();
    }

    #[test]
    fn picks_a_free_name_for_sorted_notes() {
        let vault = temp_vault("unique");
        let write = |text: &str| {
            write_note_unique(s(&vault), "Learning".into(), "Idea.md".into(), text.into()).unwrap()
        };
        assert_eq!(write("one"), "Idea.md");
        assert_eq!(write("two"), "Idea 1.md");
        assert_eq!(write("three"), "Idea 2.md");
        assert_eq!(
            fs::read_to_string(vault.join("Learning/Idea.md")).unwrap(),
            "one"
        );
        fs::remove_dir_all(&vault).unwrap();
    }

    #[test]
    fn creates_hub_notes_only_once() {
        let vault = temp_vault("hub");
        let ensure = |text: &str| {
            ensure_note(
                s(&vault),
                "Learning".into(),
                "Learning.md".into(),
                text.into(),
            )
            .unwrap()
        };
        assert!(ensure("# Learning\n"));
        assert!(!ensure("overwritten?"));
        assert_eq!(
            fs::read_to_string(vault.join("Learning/Learning.md")).unwrap(),
            "# Learning\n"
        );
        fs::remove_dir_all(&vault).unwrap();
    }

    #[test]
    fn scans_notes_but_not_hidden_folders_the_inbox_or_other_files() {
        let vault = temp_vault("scan");
        for (path, text) in [
            ("Learning/Memory.md", "# Memory #study"),
            ("Learning/Deep/Loci.md", "loci"),
            ("Learning/image.png", "not a note"),
            ("Root.MD", "root"),
            (".obsidian/plugins/x/readme.md", "hidden"),
            (".trash/old.md", "trash"),
            ("ArchiVarious/Inbox/capture.md", "inbox"),
            ("ArchiVarious/Notes/kept.md", "kept"),
        ] {
            let file = vault.join(path);
            fs::create_dir_all(file.parent().unwrap()).unwrap();
            fs::write(file, text).unwrap();
        }
        let notes = scan_vault(s(&vault), "ArchiVarious/Inbox/".into()).unwrap();
        let paths: Vec<_> = notes.iter().map(|n| n.path.as_str()).collect();
        assert_eq!(
            paths,
            [
                "ArchiVarious/Notes/kept.md",
                "Learning/Deep/Loci.md",
                "Learning/Memory.md",
                "Root.MD"
            ]
        );
        assert_eq!(notes[2].text, "# Memory #study");
        fs::remove_dir_all(&vault).unwrap();
    }

    #[test]
    fn cuts_long_notes_on_a_character_boundary() {
        let vault = temp_vault("long");
        fs::write(vault.join("Long.md"), "я".repeat(5000)).unwrap();
        let notes = scan_vault(s(&vault), "Inbox".into()).unwrap();
        assert!(notes[0].text.starts_with('я'));
        assert!(notes[0].text.len() <= SNIPPET_BYTES as usize + 3);
        fs::remove_dir_all(&vault).unwrap();
    }

    #[test]
    fn writes_the_section_list_and_section_folders() {
        let vault = temp_vault("sections");
        assert_eq!(read_sections(s(&vault)).unwrap(), None);
        write_sections(
            s(&vault),
            "- Учеба\n  - Математика\n".into(),
            vec!["Учеба/Математика".into()],
        )
        .unwrap();
        assert_eq!(
            read_sections(s(&vault)).unwrap().as_deref(),
            Some("- Учеба\n  - Математика\n")
        );
        assert!(vault.join("Учеба/Математика").is_dir());
        assert!(write_sections(s(&vault), String::new(), vec!["../x".into()]).is_err());
        assert!(write_sections(s(&vault), String::new(), vec![".obsidian".into()]).is_err());
        fs::remove_dir_all(&vault).unwrap();
    }

    #[test]
    fn reads_the_plugin_data_when_present() {
        let vault = temp_vault("data");
        assert_eq!(read_plugin_data(s(&vault)).unwrap(), None);
        let file = vault.join(PLUGIN_DATA_PATH);
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(&file, r#"{"reviewDays":3}"#).unwrap();
        assert_eq!(
            read_plugin_data(s(&vault)).unwrap().as_deref(),
            Some(r#"{"reviewDays":3}"#)
        );
        assert!(read_plugin_data("relative/path".into()).is_err());
        fs::remove_dir_all(&vault).unwrap();
    }
}
