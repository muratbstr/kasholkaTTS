#!/bin/bash
# Detached handoff. All arguments are passed as NSTask argv, never shell code.
set -euo pipefail
export PATH=/usr/bin:/bin:/usr/sbin:/sbin
[[ "$(uname -s)" == Darwin && "$#" == 5 ]] || exit 2
job_dir="$1"
parent_pid="$2"
app_name="$3"
bundle_id="$4"
expected_version="$5"
[[ "$parent_pid" =~ ^[0-9]+$ ]] || exit 2
case "$app_name:$bundle_id" in
    'kasholkaTTS:com.kasholka.tts'|'kasholkaTTS Beta:com.kasholka.tts.beta') ;;
    *) exit 2 ;;
esac
destination="$HOME/Applications/$app_name.app"
installer="$job_dir/package/Install $app_name.command"
[[ -f "$installer" && ! -L "$installer" ]] || exit 2
printf 'ready\n' > "$job_dir/handoff-ready"
# Give the UI time to save its temporary editor snapshot and exit normally.
for ((attempt=0; attempt<60; attempt++)); do
    if ! kill -0 "$parent_pid" 2>/dev/null; then break; fi
    sleep 1
done
if kill -0 "$parent_pid" 2>/dev/null; then
    printf 'Приложение не завершилось. Обновление отменено.\n' > "$job_dir/install-error.txt"
    exit 1
fi
if /bin/bash "$installer" --update; then
    installed_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$destination/Contents/Info.plist" 2>/dev/null || true)"
    installed_version="$(/usr/libexec/PlistBuddy -c 'Print :KasholkaReleaseName' "$destination/Contents/Info.plist" 2>/dev/null || true)"
    if [[ "$installed_id" == "$bundle_id" && "$installed_version" == "$expected_version" ]]; then
        printf 'ok\n' > "$job_dir/install-result.txt"
    else
        printf 'Установленная версия не совпала с ожидаемой.\n' > "$job_dir/install-error.txt"
    fi
else
    printf 'Не удалось установить обновление. Прежняя сборка или её резервная копия сохранена в ~/Applications. Журнал: %s/install.log\n' "$job_dir" > "$job_dir/install-error.txt"
fi
# On ordinary installation failure the installer keeps/restores the old app.
open_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$destination/Contents/Info.plist" 2>/dev/null || true)"
if [[ "$open_id" == "$bundle_id" && ! -L "$destination" ]]; then /usr/bin/open "$destination"; fi
