import { addSection, parseSections, SECTIONS_FILE, serializeSections } from "@archivarious/core";
import { type App, TFile } from "obsidian";
import { ensureFolder } from "./filing";

/** The user's own sections, from the shared list note (`SECTIONS_FILE`); empty when it doesn't exist yet. */
export async function loadSections(app: App): Promise<string[]> {
  const file = app.vault.getAbstractFileByPath(SECTIONS_FILE);
  return file instanceof TFile ? parseSections(await app.vault.read(file)) : [];
}

/** Adds sections to the list note (creating it if needed) and creates their folders, so they show up in the vault right away. */
export async function addSections(app: App, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const file = app.vault.getAbstractFileByPath(SECTIONS_FILE);
  if (file instanceof TFile) {
    await app.vault.process(file, (text) => {
      const current = parseSections(text);
      const next = paths.reduce(addSection, current);
      return next === current ? text : serializeSections(next);
    });
  } else {
    await ensureFolder(app, SECTIONS_FILE.slice(0, SECTIONS_FILE.lastIndexOf("/")));
    await app.vault.create(SECTIONS_FILE, serializeSections(paths.reduce(addSection, [] as string[])));
  }
  for (const path of paths) await ensureFolders(app, path);
}

/** Opens the list note for editing, creating an empty one first if needed. */
export async function openSectionList(app: App): Promise<void> {
  let file = app.vault.getAbstractFileByPath(SECTIONS_FILE);
  if (!(file instanceof TFile)) {
    await ensureFolder(app, SECTIONS_FILE.slice(0, SECTIONS_FILE.lastIndexOf("/")));
    file = await app.vault.create(SECTIONS_FILE, serializeSections([]));
  }
  if (file instanceof TFile) await app.workspace.getLeaf(false).openFile(file);
}

/** `createFolder` does not create parents, so `Учеба/Математика` is created one level at a time. */
async function ensureFolders(app: App, path: string): Promise<void> {
  const parts = path.split("/");
  for (let i = 1; i <= parts.length; i++) await ensureFolder(app, parts.slice(0, i).join("/"));
}
