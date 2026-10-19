# ArchiVarious

Быстро запишите то, что нужно запомнить. ArchiVarious слегка отформатирует запись, а спустя какое-то время задаст короткий опрос из трёх вопросов и с помощью своего алгоритма разложит заметку по вашему «второму мозгу» в Obsidian.

Проект состоит из двух продуктов:

- **Плагин Obsidian** (`apps/obsidian-plugin`) для десктопа и мобильных.
- **Виджет-приложение** (`apps/widget`) на Tauri 2 для Windows, macOS, Linux, Android и iOS: на рабочем столе Windows 11 это постоянная строка ввода, в которой запись можно сразу разложить (`Ctrl+Enter`). Вызов: `Ctrl/⌘+Shift+Space` или значок в трее.

Архитектура и обоснование каждого решения описаны в [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Структура

```
packages/core            логика без зависимостей: формат, планировщик опроса, алгоритм размещения, протокол «Входящих»
packages/ui              общий Svelte-компонент быстрого ввода
apps/obsidian-plugin     плагин Obsidian (esbuild)
apps/widget              виджет-приложение (Vite + Svelte + Tauri 2 / Rust)
docs/                    архитектура и решения
```

## Быстрый старт

Нужны Node 22+, pnpm 10 (`corepack enable`) и, для виджет-приложения, Rust stable и [системные зависимости Tauri](https://tauri.app/start/prerequisites/).

```bash
pnpm install
pnpm check                 # линт + типы + тесты

# Плагин: пересборка на лету с копированием в тестовое хранилище
OBSIDIAN_VAULT=~/Obsidian/Dev pnpm dev:plugin
# затем в Obsidian: Настройки → Сторонние плагины → включить ArchiVarious

# Виджет-приложение (десктоп)
pnpm dev:widget

# Мобильные (нужны Android SDK / Xcode)
pnpm --filter @archivarious/widget tauri android init
pnpm --filter @archivarious/widget tauri android dev
```

## Релизы

- **Плагин.** `cd apps/obsidian-plugin && pnpm version X.Y.Z --no-git-tag-version` обновит `manifest.json` и `versions.json` (здесь и в корне). После коммита поставьте тег `X.Y.Z`: CI соберёт черновик релиза.
- **Виджет-приложение.** Тег `widget-vX.Y.Z` запускает сборку установщиков для macOS, Windows и Linux.
