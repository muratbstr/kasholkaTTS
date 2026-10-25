#!/bin/bash
# Builds a native stay-open applet using tools included with macOS.
# No sudo, downloads, system configuration changes, or recursive deletion.
set -euo pipefail
export PATH=/usr/bin:/bin:/usr/sbin:/sbin

fail() {
    printf '\nОшибка: %s\n' "$1" >&2
    printf 'Установка не завершена. Это окно можно закрыть.\n' >&2
    exit 1
}

[[ "$(uname -s)" == Darwin ]] || fail 'Этот установщик предназначен только для macOS.'
mac_version="$(sw_vers -productVersion)"
[[ "${mac_version%%.*}" -ge 12 ]] || fail 'Нужна macOS Monterey 12 или новее.'
installer_dir="$(cd -- "$(dirname -- "$0")" && pwd -P)"
source_file="$installer_dir/src/kasholkaTTS.js"
[[ -f "$source_file" ]] || fail 'Не найден src/kasholkaTTS.js. Распакуйте весь ZIP-архив.'
[[ -f "$installer_dir/src/voice-host.js" ]] || fail 'Не найден src/voice-host.js. Распакуйте весь ZIP-архив.'
[[ -f "$installer_dir/src/voice-host.swift" && -f "$installer_dir/src/voice-host-swift.sh" ]] ||
    fail 'Не найден помощник Swift. Распакуйте весь ZIP-архив.'
[[ -f "$installer_dir/assets/kasholkaTTS.icns" && -f "$installer_dir/assets/about.mp4" ]] ||
    fail 'Не найдены иконка или видео. Распакуйте весь ZIP-архив.'
[[ -f "$installer_dir/assets/loading.png" ]] || fail 'Не найден фон загрузки. Распакуйте весь ZIP-архив.'

printf '\nkasholkaTTS 1.5.0 Release 1 — установка для текущего пользователя\n'
printf 'Используются только встроенные инструменты macOS.\n\n'

running="$(/usr/bin/osascript -l JavaScript <<'JXA'
ObjC.import('AppKit');
var apps = $.NSRunningApplication.runningApplicationsWithBundleIdentifier('com.kasholka.tts');
String(apps.count);
JXA
)"
[[ "$running" == 0 ]] || fail 'Сначала завершите kasholkaTTS через меню приложения (⌘Q).'

applications_dir="$HOME/Applications"
destination="$applications_dir/kasholkaTTS.app"
[[ ! -L "$destination" ]] || fail 'Путь kasholkaTTS.app является ссылкой. Изменения не внесены.'
if [[ -e "$destination" ]]; then
    old_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$destination/Contents/Info.plist" 2>/dev/null || true)"
    [[ "$old_id" == com.kasholka.tts ]] || fail 'По пути установки уже находится другой объект. Он оставлен без изменений.'
fi

mkdir -p "$applications_dir"
stage_dir="$(mktemp -d "$applications_dir/.kasholkaTTS-build.XXXXXX")"
built_app="$stage_dir/kasholkaTTS.app"
trap 'printf "\nСбой установки. Файлы сборки сохранены в: %s\n" "$stage_dir" >&2' ERR
printf 'Подготовка приложения…\n'
/usr/bin/osacompile -l JavaScript -s -o "$built_app" "$source_file"
cp "$installer_dir/assets/kasholkaTTS.icns" "$built_app/Contents/Resources/kasholkaTTS.icns"
cp "$installer_dir/assets/about.mp4" "$built_app/Contents/Resources/about.mp4"
cp "$installer_dir/assets/loading.png" "$built_app/Contents/Resources/loading.png"
cp "$installer_dir/src/voice-host.js" "$built_app/Contents/Resources/voice-host.js"
cp "$installer_dir/src/voice-host.swift" "$built_app/Contents/Resources/voice-host.swift"
cp "$installer_dir/src/voice-host-swift.sh" "$built_app/Contents/Resources/voice-host-swift.sh"
plist="$built_app/Contents/Info.plist"
set_plist() {
    /usr/libexec/PlistBuddy -c "Set :$1 $3" "$plist" 2>/dev/null ||
        /usr/libexec/PlistBuddy -c "Add :$1 $2 $3" "$plist"
}
set_plist CFBundleIdentifier string com.kasholka.tts
set_plist CFBundleName string kasholkaTTS
set_plist CFBundleDisplayName string kasholkaTTS
set_plist CFBundleIconFile string kasholkaTTS.icns
set_plist CFBundleShortVersionString string 1.5.0
set_plist CFBundleVersion string 18
set_plist KasholkaReleaseName string '1.5.0 Release 1'
set_plist LSMinimumSystemVersion string 12.0
set_plist NSHighResolutionCapable bool true
set_plist NSHumanReadableCopyright string 'kasholkaTTS 1.5.0 Release 1'
/usr/bin/plutil -lint "$plist"

# Re-sign the locally generated bundle after editing its metadata. This is a
# local ad-hoc signature, not a Developer ID signature or Apple notarization.
/usr/bin/codesign --force --sign - "$built_app"
/usr/bin/codesign --verify --deep --strict "$built_app"

backup_dir=''
if [[ -e "$destination" ]]; then
    backup_dir="$(mktemp -d "$applications_dir/kasholkaTTS-backup.XXXXXX")"
    mv "$destination" "$backup_dir/kasholkaTTS.app"
    printf 'Предыдущая версия сохранена: %s\n' "$backup_dir/kasholkaTTS.app"
fi
if ! mv "$built_app" "$destination"; then
    if [[ -n "$backup_dir" && ! -e "$destination" ]]; then
        mv "$backup_dir/kasholkaTTS.app" "$destination"
    fi
    fail "Не удалось переместить приложение. Файлы сборки: $stage_dir"
fi
rmdir "$stage_dir"
trap - ERR
printf '\nУстановлено: %s\n' "$destination"
printf 'Для удаления перенесите kasholkaTTS.app в Корзину.\n'

choice="$(/usr/bin/osascript -l JavaScript <<'JXA'
ObjC.import('AppKit');
$.NSApplication.sharedApplication.setActivationPolicy($.NSApplicationActivationPolicyAccessory);
$.NSApplication.sharedApplication.activateIgnoringOtherApps(true);
var dialog = $.NSAlert.alloc.init;
dialog.messageText = 'kasholkaTTS 1.5.0 Release 1 установлена';
dialog.informativeText = 'Приложение находится в папке «Программы» вашего пользователя (~/Applications).';
dialog.addButtonWithTitle('Открыть');
dialog.addButtonWithTitle('Готово');
String(dialog.runModal);
JXA
)" || choice=1001
if [[ "$choice" == 1000 ]]; then
    /usr/bin/open "$destination"
fi
printf '\nГотово. Окно Терминала можно закрыть.\n'
