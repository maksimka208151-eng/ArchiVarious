import { type App, FileSystemAdapter, normalizePath, Platform, TFile } from "obsidian";
import type { ArchiVariousSettings } from "./settings";

export const DOCUMENTS_FOLDER = "ArchiVarious/Документы";
const MAX_BYTES = 30 * 1024 * 1024;
const MAX_LOG = 16_384;

export function isDocumentName(name: string): boolean {
  return /\.(pdf|txt|md)$/i.test(name);
}

export interface DocumentResult {
  status: "complete" | "partial" | "failed";
  message?: string;
  notePath?: string;
  directory?: string;
}

function parseResult(stdout: string): Record<string, unknown> {
  const lines = stdout.trim().split(/\r?\n/);
  try {
    const value: unknown = JSON.parse(lines.at(-1) ?? "");
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // A startup error can exit before the CLI emits its result.
  }
  throw new Error("Обработчик не вернул результат. Проверьте установку Node.js и зависимостей ArchiVarious.");
}

export async function processDocument(
  app: App,
  settings: ArchiVariousSettings,
  file: File | TFile,
  allowPartial: boolean,
): Promise<DocumentResult> {
  const adapter = app.vault.adapter;
  if (!Platform.isDesktopApp || !(adapter instanceof FileSystemAdapter)) {
    throw new Error("Обработка документов доступна в настольном Obsidian с локальным хранилищем.");
  }

  // Load these only on desktop. The rest of the plugin is also used on mobile.
  const { spawn } = require("node:child_process") as typeof import("node:child_process");
  const { access, mkdtemp, writeFile, unlink, rmdir } =
    require("node:fs/promises") as typeof import("node:fs/promises");
  const { tmpdir } = require("node:os") as typeof import("node:os");
  const { basename, dirname, isAbsolute, join, relative } = require("node:path") as typeof import("node:path");
  const { env } = require("node:process") as typeof import("node:process");

  if (!isDocumentName(file.name) || basename(file.name) !== file.name) {
    throw new Error("Выберите PDF или текстовый файл в формате TXT или Markdown.");
  }
  if ((file instanceof TFile ? file.stat.size : file.size) > MAX_BYTES) {
    throw new Error("Размер документа превышает 30 МБ.");
  }
  if (!settings.documentRepository || !isAbsolute(settings.documentRepository)) {
    throw new Error("Укажите абсолютный путь к папке проекта ArchiVarious в настройках плагина.");
  }
  const cwd = join(settings.documentRepository, "apps", "etl");
  try {
    await access(join(cwd, "src", "cli.ts"));
  } catch {
    throw new Error("В указанной папке не найден обработчик apps/etl/src/cli.ts.");
  }
  const python = settings.documentPython;
  if (python && !isAbsolute(python)) throw new Error("Укажите абсолютный путь к исполняемому файлу Python.");
  const node = settings.documentNode || "node";
  if (node !== "node" && !isAbsolute(node)) throw new Error("Укажите абсолютный путь к исполняемому файлу Node.js.");

  const output = adapter.getFullPath(DOCUMENTS_FOLDER);
  let temporaryFile: string | undefined;
  try {
    let input: string;
    if (file instanceof TFile) {
      input = adapter.getFullPath(file.path);
    } else {
      const directory = await mkdtemp(join(tmpdir(), "archivarious-"));
      temporaryFile = join(directory, file.name);
      await writeFile(temporaryFile, new Uint8Array(await file.arrayBuffer()), { flag: "wx" });
      input = temporaryFile;
    }
    const args = [
      "--import",
      "tsx",
      "src/cli.ts",
      "--input",
      input,
      "--output",
      output,
      "--provider",
      "local",
      "--model",
      settings.documentModel,
      "--endpoint",
      settings.documentEndpoint,
      "--batch-chars",
      "2000",
      "--llm-timeout",
      "1200",
      "--ocr-timeout",
      "900",
      "--json-result",
    ];
    if (allowPartial) args.push("--allow-partial");

    const { stdout, stderr, code } = await new Promise<{ stdout: string; stderr: string; code: number | null }>(
      (resolve, reject) => {
        const child = spawn(node, args, {
          cwd,
          env: python ? { ...env, ARCHIVARIOUS_PYTHON: python } : env,
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
          stdout = (stdout + chunk).slice(-MAX_LOG);
        });
        child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
          stderr = (stderr + chunk).slice(-MAX_LOG);
        });
        child.once("error", () =>
          reject(new Error("Не удалось запустить Node.js. Проверьте путь в настройках плагина.")),
        );
        child.once("close", (code) => resolve({ stdout, stderr, code }));
      },
    );

    let result: Record<string, unknown>;
    try {
      result = parseResult(stdout);
    } catch (error) {
      if (stderr.trim()) throw new Error(`Ошибка запуска обработки. ${stderr.trim().slice(-900)}`);
      throw error;
    }
    const { status, directory, note, message } = result;
    if ((status !== "complete" && status !== "partial" && status !== "failed") || (code !== 0 && status !== "failed")) {
      throw new Error("Обработчик вернул недопустимый статус.");
    }
    if (status !== "failed" && note !== "summary.md") {
      throw new Error("Обработчик завершился без конспекта.");
    }
    const folder = typeof directory === "string" && isAbsolute(directory) ? relative(output, directory) : "";
    if (folder && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(folder)) {
      const vaultDirectory = normalizePath(`${DOCUMENTS_FOLDER}/${folder}`);
      const noteName =
        status === "failed" && note === "extracted.md" ? note : status !== "failed" ? "summary.md" : undefined;
      const notePath = noteName ? `${vaultDirectory}/${noteName}` : undefined;
      const noteExists = notePath && (await adapter.exists(notePath));
      if (status !== "failed" && !noteExists) throw new Error(`Файл конспекта отсутствует в ${vaultDirectory}.`);
      return {
        status,
        message: typeof message === "string" ? message : undefined,
        directory: vaultDirectory,
        notePath: noteExists ? notePath : undefined,
      };
    }
    if (status !== "failed") throw new Error("Папка результата недоступна в хранилище Obsidian.");
    return { status, message: typeof message === "string" ? message : undefined };
  } finally {
    if (temporaryFile) {
      await unlink(temporaryFile).catch(() => {});
      await rmdir(dirname(temporaryFile)).catch(() => {});
    }
  }
}

export async function openDocumentNote(app: App, path: string): Promise<void> {
  const existing = app.vault.getAbstractFileByPath(path);
  const note =
    existing instanceof TFile
      ? existing
      : await new Promise<TFile | null>((resolve) => {
          const ref = app.vault.on("create", (file) => {
            if (file instanceof TFile && file.path === path) finish(file);
          });
          const timeout = window.setTimeout(() => finish(null), 2500);
          function finish(file: TFile | null) {
            window.clearTimeout(timeout);
            app.vault.offref(ref);
            resolve(file);
          }
        });
  if (!note) throw new Error(`Заметка появится в проводнике хранилища после индексации: ${path}`);
  await app.workspace.getLeaf("tab").openFile(note);
}
