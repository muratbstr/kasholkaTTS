#!/bin/bash
# kasholka-update-protocol: 1
# Native macOS installer.
# No sudo, downloads, system configuration changes, or recursive deletion.
set -Eeuo pipefail
export PATH=/usr/bin:/bin:/usr/sbin:/sbin

app_display_name='kasholkaTTS'
release_name='1.7.8 Release 3'
installer_language=en
log_file=''
update_mode=0
language_explicit=0
exec 3>&1 4>&2

# RU: installer messages. Keep this catalog separate from English.
message_ru() {
    case "$1" in
        check) printf '%s' 'Проверка установки…' ;;
        prepare) printf '%s' 'Подготовка приложения…' ;;
        resources) printf '%s' 'Копирование файлов…' ;;
        verify) printf '%s' 'Проверка приложения…' ;;
        install) printf '%s' 'Установка приложения…' ;;
        complete) printf '%s' 'Установка завершена' ;;
        open) printf '%s' 'Открыть' ;;
        done) printf '%s' 'Готово' ;;
        error) printf '%s' 'Ошибка:' ;;
        log) printf '%s' 'Журнал:' ;;
        failed) printf '%s' 'Установка не завершена.' ;;
        mac_only) printf '%s' 'Этот установщик предназначен только для macOS.' ;;
        mac_version) printf '%s' 'Нужна macOS Monterey 12 или новее.' ;;
        arguments) printf '%s' 'Неизвестные параметры. Язык: --lang ru или --lang eng.' ;;
        missing) printf '%s' 'Не найдены файлы установки. Распакуйте весь ZIP-архив.' ;;
        running) printf 'Сначала завершите %s через меню приложения (⌘Q).' "$app_display_name" ;;
        symlink) printf '%s' 'Путь приложения является ссылкой. Изменения не внесены.' ;;
        occupied) printf '%s' 'По пути установки находится другой объект. Он оставлен без изменений.' ;;
        changed) printf '%s' 'Путь установки изменился во время сборки.' ;;
        move) printf '%s' 'Не удалось переместить приложение. Подробности в журнале.' ;;
        log_failed) printf '%s' 'Не удалось создать журнал установки.' ;;
        language_failed) printf '%s' 'Не удалось открыть выбор языка. Повторите запуск или укажите --lang ru / --lang eng.' ;;
        *) return 1 ;;
    esac
}

# ENG: installer messages. No mixed-language progress lines.
message_en() {
    case "$1" in
        check) printf '%s' 'Checking installation…' ;;
        prepare) printf '%s' 'Preparing application…' ;;
        resources) printf '%s' 'Copying files…' ;;
        verify) printf '%s' 'Verifying application…' ;;
        install) printf '%s' 'Installing application…' ;;
        complete) printf '%s' 'Installation complete' ;;
        open) printf '%s' 'Open' ;;
        done) printf '%s' 'Done' ;;
        error) printf '%s' 'Error:' ;;
        log) printf '%s' 'Log:' ;;
        failed) printf '%s' 'Installation did not finish.' ;;
        mac_only) printf '%s' 'This installer is for macOS only.' ;;
        mac_version) printf '%s' 'macOS Monterey 12 or later is required.' ;;
        arguments) printf '%s' 'Unknown arguments. Language: --lang ru or --lang eng.' ;;
        missing) printf '%s' 'Installation files are missing. Extract the entire ZIP archive.' ;;
        running) printf 'Quit %s from its application menu first (⌘Q).' "$app_display_name" ;;
        symlink) printf '%s' 'The application path is a symbolic link. Nothing was changed.' ;;
        occupied) printf '%s' 'Another item occupies the installation path. It was left unchanged.' ;;
        changed) printf '%s' 'The installation path changed during the build.' ;;
        move) printf '%s' 'Could not move the application. See the log for details.' ;;
        log_failed) printf '%s' 'Could not create the installation log.' ;;
        language_failed) printf '%s' 'Could not open language selection. Try again or use --lang ru / --lang eng.' ;;
        *) return 1 ;;
    esac
}

message() {
    if [[ "$installer_language" == ru ]]; then message_ru "$1"; else message_en "$1"; fi
}

stage() { printf '[%s/6] %s\n' "$1" "$(message "$2")" >&3; }

fail() {
    trap - ERR
    printf '\n%s %s\n' "$(message error)" "$1" >&4
    if [[ -n "$log_file" ]]; then
        printf '%s %s\n' "$(message log)" "$log_file" >&4
        printf '%s\n' "$1" >&2
    fi
    exit 1
}

[[ "$(uname -s)" == Darwin ]] || fail "$(message mac_only)"
# Read this app's preference, then macOS preferences; never modify either.
installer_language="$(/usr/bin/osascript -l JavaScript 2>/dev/null <<'JXA'
ObjC.import('Foundation');
var domain = $.NSUserDefaults.standardUserDefaults.persistentDomainForName('com.kasholka.tts');
var selected = domain && !domain.isNil() ? domain.objectForKey('uiLanguage') : null;
var language = selected && !selected.isNil() ? ObjC.unwrap(selected) : 'system';
if (language !== 'ru' && language !== 'en') {
    var preferred = ObjC.deepUnwrap($.NSLocale.preferredLanguages);
    language = String(preferred[0] || 'en').split(/[-_]/)[0].toLowerCase();
}
language === 'ru' ? 'ru' : 'en';
JXA
)" || installer_language=en
while [[ "$#" -gt 0 ]]; do
    case "$1" in
        --update) update_mode=1; shift ;;
        --lang)
            [[ "$#" -ge 2 ]] || fail "$(message arguments)"
            case "$2" in ru) installer_language=ru ;; en|eng) installer_language=en ;; *) fail "$(message arguments)" ;; esac
            language_explicit=1
            shift 2 ;;
        *) fail "$(message arguments)" ;;
    esac
done
# Manual installation starts with a choice, before creating logs or changing files.
# Explicit CLI language and unattended updates must never open this dialog.
if [[ "$update_mode" == 0 && "$language_explicit" == 0 ]]; then
    language_choice="$(KTTS_INSTALL_LANGUAGE="$installer_language" /usr/bin/osascript -l JavaScript 2>/dev/null <<'JXA'
ObjC.import('AppKit');
$.NSApplication.sharedApplication.setActivationPolicy($.NSApplicationActivationPolicyAccessory);
$.NSApplication.sharedApplication.activateIgnoringOtherApps(true);
var preferred = ObjC.unwrap($.NSProcessInfo.processInfo.environment.objectForKey('KTTS_INSTALL_LANGUAGE'));
var choices = preferred === 'ru' ? ['ru', 'en'] : ['en', 'ru'];
var dialog = $.NSAlert.alloc.init;
dialog.messageText = 'Язык установки / Installation language';
choices.forEach(function (code) { dialog.addButtonWithTitle(code === 'ru' ? 'Русский' : 'English'); });
var cancel = dialog.addButtonWithTitle('Отмена / Cancel');
cancel.keyEquivalent = '\u001b';
var response = Number(dialog.runModal);
response === 1000 ? choices[0] : response === 1001 ? choices[1] : 'cancel';
JXA
)" || fail "$(message language_failed)"
    case "$language_choice" in
        ru|en) installer_language="$language_choice" ;;
        cancel) exit 0 ;;
        *) fail "$(message language_failed)" ;;
    esac
fi
log_file="$(mktemp "${TMPDIR:-/tmp}/kasholka-install.XXXXXX")" || fail "$(message log_failed)"
exec >>"$log_file" 2>&1
trap 'fail "$(message failed)"' ERR
stage 1 check
mac_version="$(sw_vers -productVersion)"
[[ "${mac_version%%.*}" -ge 12 ]] || fail "$(message mac_version)"
installer_dir="$(cd -- "$(dirname -- "$0")" && pwd -P)"
source_file="$installer_dir/src/kasholkaTTS.js"
[[ -f "$source_file" ]] || fail "$(message missing)"
[[ -f "$installer_dir/src/voice-host.js" ]] || fail "$(message missing)"
[[ -f "$installer_dir/src/voice-host.swift" && -f "$installer_dir/src/voice-host-swift.sh" ]] ||
    fail "$(message missing)"
[[ -f "$installer_dir/assets/kasholkaTTS.icns" && -f "$installer_dir/assets/about.mp4" ]] ||
    fail "$(message missing)"
[[ -f "$installer_dir/assets/loading.png" ]] || fail "$(message missing)"
for update_file in update-policy.js updater.js update-install.sh; do
    [[ -f "$installer_dir/src/$update_file" ]] || fail "$(message missing)"
done

# beta-extra-validation

ensure_not_running() {
local running
running="$(/usr/bin/osascript -l JavaScript <<'JXA'
ObjC.import('AppKit');
var apps = $.NSRunningApplication.runningApplicationsWithBundleIdentifier('com.kasholka.tts');
String(apps.count);
JXA
)"
[[ "$running" == 0 ]] || fail "$(message running)"
}
ensure_not_running

applications_dir="$HOME/Applications"
destination="$applications_dir/kasholkaTTS.app"
[[ ! -L "$destination" ]] || fail "$(message symlink)"
if [[ -e "$destination" ]]; then
    old_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$destination/Contents/Info.plist" 2>/dev/null || true)"
    [[ "$old_id" == com.kasholka.tts ]] || fail "$(message occupied)"
fi

mkdir -p "$applications_dir"
stage_dir="$(mktemp -d "$applications_dir/.kasholkaTTS-build.XXXXXX")"
built_app="$stage_dir/kasholkaTTS.app"
printf 'Build directory: %s\n' "$stage_dir"
stage 2 prepare
cat "$source_file" "$installer_dir/src/update-policy.js" "$installer_dir/src/updater.js" > "$stage_dir/application.js"
/usr/bin/osacompile -l JavaScript -s -o "$built_app" "$stage_dir/application.js"
rm "$stage_dir/application.js"
stage 3 resources
cp "$installer_dir/assets/kasholkaTTS.icns" "$built_app/Contents/Resources/kasholkaTTS.icns"
cp "$installer_dir/assets/about.mp4" "$built_app/Contents/Resources/about.mp4"
cp "$installer_dir/assets/loading.png" "$built_app/Contents/Resources/loading.png"
cp "$installer_dir/src/voice-host.js" "$built_app/Contents/Resources/voice-host.js"
cp "$installer_dir/src/update-install.sh" "$built_app/Contents/Resources/update-install.sh"
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
set_plist CFBundleShortVersionString string 1.7.8
set_plist CFBundleVersion string 35
set_plist KasholkaReleaseName string '1.7.8 Release 3'
set_plist LSMinimumSystemVersion string 12.0
set_plist NSHighResolutionCapable bool true
# osacompile applets may otherwise inherit a light-only appearance.
set_plist NSRequiresAquaSystemAppearance bool false
set_plist NSHumanReadableCopyright string 'kasholkaTTS 1.7.8 Release 3'
stage 4 verify
/usr/bin/plutil -lint "$plist"

# Re-sign the locally generated bundle after editing its metadata. This is a
# local ad-hoc signature, not a Developer ID signature or Apple notarization.
/usr/bin/codesign --force --sign - "$built_app"
/usr/bin/codesign --verify --deep --strict "$built_app"

backup_dir=''
stage 5 install
ensure_not_running
[[ ! -L "$destination" ]] || fail "$(message changed)"
if [[ -e "$destination" ]]; then
    old_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$destination/Contents/Info.plist" 2>/dev/null || true)"
    [[ "$old_id" == com.kasholka.tts ]] || fail "$(message occupied)"
    backup_dir="$(mktemp -d "$applications_dir/kasholkaTTS-backup.XXXXXX")"
    mv "$destination" "$backup_dir/kasholkaTTS.app"
    printf 'Backup: %s\n' "$backup_dir/kasholkaTTS.app"
fi
if ! mv "$built_app" "$destination"; then
    if [[ -n "$backup_dir" && ! -e "$destination" ]]; then
        mv "$backup_dir/kasholkaTTS.app" "$destination"
    fi
    fail "$(message move)"
fi
rmdir "$stage_dir"
trap - ERR
stage 6 complete
# Successful installs leave no technical transcript in the Terminal or temp folder.
rm "$log_file"
exec 1>&3 2>&4
log_file=''

if [[ "$update_mode" == 1 ]]; then exit 0; fi

choice="$(KTTS_INSTALL_NAME="$app_display_name $release_name" \
    KTTS_INSTALL_COMPLETE="$(message complete)" KTTS_INSTALL_OPEN="$(message open)" KTTS_INSTALL_DONE="$(message done)" \
    /usr/bin/osascript -l JavaScript <<'JXA'
ObjC.import('AppKit');
var environment = $.NSProcessInfo.processInfo.environment;
function value(key) { return ObjC.unwrap(environment.objectForKey(key)); }
$.NSApplication.sharedApplication.setActivationPolicy($.NSApplicationActivationPolicyAccessory);
$.NSApplication.sharedApplication.activateIgnoringOtherApps(true);
var dialog = $.NSAlert.alloc.init;
dialog.messageText = value('KTTS_INSTALL_NAME');
dialog.informativeText = value('KTTS_INSTALL_COMPLETE');
dialog.addButtonWithTitle(value('KTTS_INSTALL_OPEN'));
dialog.addButtonWithTitle(value('KTTS_INSTALL_DONE'));
String(dialog.runModal);
JXA
)" || choice=1001
if [[ "$choice" == 1000 ]]; then
    /usr/bin/open "$destination"
fi
