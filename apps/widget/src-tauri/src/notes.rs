//! Commands for working through the inbox and the review queue in the widget app: reading whole notes,
//! updating one, moving it to its section, sending a capture to the vault's trash, and saving pasted
//! pictures. Every path goes through the same guard as the other vault writes (`resolve_file`).

use std::fs;
use std::io::{ErrorKind, Read};
use std::path::{Path, PathBuf};

use crate::inbox::{check_vault, create_new_file, resolve_file, resolve_target, NoteSnippet};

/// Whole notes are read up to this size; inbox captures and notes under review are far smaller.
const MAX_NOTE_BYTES: u64 = 1024 * 1024;
/// Pasted pictures larger than this are refused (a full-screen PNG screenshot is a few MB).
const MAX_ATTACHMENT_BYTES: usize = 25 * 1024 * 1024;
const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp"];
/// Obsidian's own "move to Obsidian trash" folder.
const TRASH_FOLDER: &str = ".trash";

/// Every capture in the inbox folder (not its subfolders), in full.
#[tauri::command]
pub fn list_inbox(vault_path: String, inbox_folder: String) -> Result<Vec<NoteSnippet>, String> {
    let vault = Path::new(&vault_path);
    let folder = inbox_folder.trim_matches('/');
    let dir = resolve_target(vault, folder, "x.md")?
        .parent()
        .map(Path::to_path_buf)
        .ok_or("bad inbox folder")?;
    let entries = match fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.to_string()),
    };
    let mut notes = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let is_file = entry.file_type().is_ok_and(|t| t.is_file());
        if !is_file || name.starts_with('.') || !name.to_lowercase().ends_with(".md") {
            continue;
        }
        if let Ok(text) = read_whole(&entry.path()) {
            notes.push(NoteSnippet {
                path: format!("{folder}/{name}"),
                text,
            });
        }
    }
    notes.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(notes)
}

/// One note in full.
#[tauri::command]
pub fn read_note(vault_path: String, path: String) -> Result<String, String> {
    read_whole(&note_path(&vault_path, &path)?).map_err(|e| e.to_string())
}

/// Replaces the text of an existing note (a capture's survey time, a note's review fields). Never creates one.
#[tauri::command]
pub fn write_note(vault_path: String, path: String, contents: String) -> Result<(), String> {
    let target = note_path(&vault_path, &path)?;
    if !target.is_file() {
        return Err(format!("note not found: {path}"));
    }
    fs::write(&target, contents).map_err(|e| e.to_string())
}

/// Moves a note into `folder` (created if needed), picking `Name 1.md`, … if the name is taken.
/// Returns the new vault-relative path.
#[tauri::command]
pub fn move_note(vault_path: String, path: String, folder: String) -> Result<String, String> {
    let vault = Path::new(&vault_path);
    let source = note_path(&vault_path, &path)?;
    if !source.is_file() {
        return Err(format!("note not found: {path}"));
    }
    let folder = folder.trim_matches('/').to_string();
    let (_, name) = split(&path);
    let target = free_name(vault, &folder, name, &["md"])?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::rename(&source, &target).map_err(|e| e.to_string())?;
    let file = target
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    Ok(if folder.is_empty() {
        file
    } else {
        format!("{folder}/{file}")
    })
}

/// Moves a note into the vault's `.trash` folder, where Obsidian keeps deleted files, instead of deleting it.
#[tauri::command]
pub fn trash_note(vault_path: String, path: String) -> Result<(), String> {
    let vault = Path::new(&vault_path);
    let source = note_path(&vault_path, &path)?;
    let (_, name) = split(&path);
    let trash = vault.join(TRASH_FOLDER);
    fs::create_dir_all(&trash).map_err(|e| e.to_string())?;
    let stem = name.strip_suffix(".md").unwrap_or(name);
    for n in 0..1000 {
        let candidate = if n == 0 {
            name.to_string()
        } else {
            format!("{stem} {n}.md")
        };
        let target = trash.join(&candidate);
        if !target.exists() {
            return fs::rename(&source, &target).map_err(|e| e.to_string());
        }
    }
    Err("too many deleted notes with the same name".into())
}

/// Saves a pasted picture into `folder`. Returns the vault-relative path that was used.
#[tauri::command]
pub fn write_attachment(
    vault_path: String,
    folder: String,
    file_name: String,
    data: Vec<u8>,
) -> Result<String, String> {
    if data.len() > MAX_ATTACHMENT_BYTES {
        return Err("picture is too large".into());
    }
    let vault = Path::new(&vault_path);
    let folder = folder.trim_matches('/').to_string();
    for _ in 0..3 {
        let target = free_name(vault, &folder, &file_name, IMAGE_EXTENSIONS)?;
        match create_new_file(&target, &data) {
            Ok(()) => {
                let file = target
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default();
                return Ok(format!("{folder}/{file}"));
            }
            // Someone took the name between the check and the write: pick again.
            Err(e) if e.kind() == ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("could not pick a free file name".into())
}

fn note_path(vault_path: &str, path: &str) -> Result<PathBuf, String> {
    let (folder, name) = split(path);
    resolve_target(Path::new(vault_path), folder, name)
}

fn split(path: &str) -> (&str, &str) {
    path.rsplit_once('/').unwrap_or(("", path))
}

/// `<folder>/<name>`, or `<folder>/<stem> N.<ext>` with the first N that is free.
fn free_name(
    vault: &Path,
    folder: &str,
    name: &str,
    extensions: &[&str],
) -> Result<PathBuf, String> {
    check_vault(vault)?;
    let (stem, ext) = name.rsplit_once('.').unwrap_or((name, ""));
    for n in 0..1000 {
        let candidate = if n == 0 {
            name.to_string()
        } else {
            format!("{stem} {n}.{ext}")
        };
        let target = resolve_file(vault, folder, &candidate, extensions)?;
        if !target.exists() {
            return Ok(target);
        }
    }
    Err("too many files with the same name".into())
}

fn read_whole(path: &Path) -> std::io::Result<String> {
    let file = fs::File::open(path)?;
    let mut text = String::new();
    file.take(MAX_NOTE_BYTES).read_to_string(&mut text)?;
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_vault(tag: &str) -> PathBuf {
        let vault =
            std::env::temp_dir().join(format!("archivarious-notes-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&vault);
        fs::create_dir_all(&vault).unwrap();
        vault
    }

    fn s(v: &Path) -> String {
        v.to_string_lossy().into_owned()
    }

    #[test]
    fn lists_reads_moves_and_trashes_notes() {
        let vault = temp_vault("flow");
        fs::create_dir_all(vault.join("Inbox/sub")).unwrap();
        fs::write(vault.join("Inbox/b.md"), "two").unwrap();
        fs::write(vault.join("Inbox/a.md"), "one").unwrap();
        fs::write(vault.join("Inbox/sub/c.md"), "nested").unwrap();
        fs::create_dir_all(vault.join("Учеба")).unwrap();
        fs::write(vault.join("Учеба/a.md"), "taken").unwrap();

        let inbox = list_inbox(s(&vault), "Inbox".into()).unwrap();
        let paths: Vec<_> = inbox.iter().map(|n| n.path.as_str()).collect();
        assert_eq!(paths, ["Inbox/a.md", "Inbox/b.md"]);
        assert_eq!(read_note(s(&vault), "Inbox/a.md".into()).unwrap(), "one");

        write_note(s(&vault), "Inbox/a.md".into(), "uno".into()).unwrap();
        assert!(write_note(s(&vault), "Inbox/new.md".into(), "x".into()).is_err());

        let moved = move_note(s(&vault), "Inbox/a.md".into(), "Учеба".into()).unwrap();
        assert_eq!(moved, "Учеба/a 1.md");
        assert_eq!(
            fs::read_to_string(vault.join("Учеба/a 1.md")).unwrap(),
            "uno"
        );

        trash_note(s(&vault), "Inbox/b.md".into()).unwrap();
        assert!(!vault.join("Inbox/b.md").exists());
        assert_eq!(
            fs::read_to_string(vault.join(".trash/b.md")).unwrap(),
            "two"
        );

        assert!(move_note(s(&vault), "Учеба/a.md".into(), "../out".into()).is_err());
        assert!(read_note(s(&vault), ".obsidian/app.md".into()).is_err());
        fs::remove_dir_all(&vault).unwrap();
    }

    #[test]
    fn saves_pictures_without_overwriting() {
        let vault = temp_vault("pictures");
        let save = || {
            write_attachment(
                s(&vault),
                "Вложения".into(),
                "shot.png".into(),
                vec![1, 2, 3],
            )
        };
        assert_eq!(save().unwrap(), "Вложения/shot.png");
        assert_eq!(save().unwrap(), "Вложения/shot 1.png");
        assert!(write_attachment(s(&vault), "Вложения".into(), "x.exe".into(), vec![1]).is_err());
        fs::remove_dir_all(&vault).unwrap();
    }
}
