#!/bin/bash
# Read-only toolchain discovery. Never invoke Apple's install-on-demand shims.
set -euo pipefail
[[ $# == 3 ]] || exit 2
script_path="$1"
mode="$2"
session_dir="$3"
[[ "$mode" == list || "$mode" == speak || "$mode" == export ]] || exit 2
[[ -f "$script_path" && -d "$session_dir" ]] || exit 2

developer_path="$(/usr/bin/xcode-select --print-path 2>/dev/null)" || developer_path=''
frontend=''
sdk_path=''
if [[ -n "$developer_path" ]]; then
    if [[ -x "$developer_path/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift-frontend" ]]; then
        frontend="$developer_path/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift-frontend"
        sdk_path="$developer_path/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk"
    elif [[ -x "$developer_path/usr/bin/swift-frontend" ]]; then
        frontend="$developer_path/usr/bin/swift-frontend"
        sdk_path="$developer_path/SDKs/MacOSX.sdk"
    fi
fi
if [[ -z "$frontend" || ! -d "$sdk_path" ]]; then
    printf '%s\n' 'Swift недоступен: не найдены выбранные Command Line Tools/Xcode с macOS SDK. Для этого способа нужны инструменты Apple. Автоматическая установка не запускалась.' >&2
    exit 3
fi

# exec keeps the interpreter as the exact NSTask owned by the app. Compiling
# a standalone helper would lose the Apple-signed interpreter hosting Siri.
architecture="$(/usr/bin/uname -m)"
exec "$frontend" -interpret "$script_path" -sdk "$sdk_path" -target "$architecture-apple-macosx12.0" -module-name KasholkaVoiceHost -- "$mode" "$session_dir"
