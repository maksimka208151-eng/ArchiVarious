# Установщик плагина для Windows

`ArchiVarious-installer.exe` — один exe без зависимостей: окно на чистом Win32 (через `syscall`), файлы плагина встроены через `go:embed`.

- Читает список хранилищ из `%APPDATA%\obsidian\obsidian.json`, копирует плагин в `<хранилище>/.obsidian/plugins/archivarious` и добавляет `archivarious` в `community-plugins.json`. `data.json` (настройки плагина) и другие плагины не трогаются, поэтому тот же exe обновляет плагин.
- Go собирает exe для Windows на любой ОС, без NSIS/Inno Setup. Сборка воспроизводима (`-trimpath`, без VCS-штампа, закреплённая версия `go-winres`).
- Манифест (`winres/winres.json`) просит запуск без прав администратора, поэтому окна UAC нет.
- Не часть `packages/core`: установщик знает только о раскладке файлов Obsidian, не о заметках.

Сборка из корня репозитория: `pnpm build:plugin && pnpm build:installer`. Проверки: `go vet ./... && GOOS=windows go vet ./... && go test ./...`.
