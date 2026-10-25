"""Run dependency-free JS tests with Windows Chakra or macOS JXA."""
import ctypes
import subprocess
import sys


def evaluate(source):
    if sys.platform == "darwin":
        completed = subprocess.run(
            ["/usr/bin/osascript", "-l", "JavaScript"],
            input=source,
            text=True, capture_output=True, check=True,
        )
        return completed.stdout.strip()
    if sys.platform != "win32":
        raise NotImplementedError("The test runner requires Windows Chakra or macOS JXA")

    dll = ctypes.WinDLL("Chakra.dll")
    pointer = ctypes.c_void_p
    api = {
        "JsCreateRuntime": ([ctypes.c_uint, pointer, ctypes.POINTER(pointer)], ctypes.c_uint),
        "JsCreateContext": ([pointer, ctypes.POINTER(pointer)], ctypes.c_uint),
        "JsSetCurrentContext": ([pointer], ctypes.c_uint),
        "JsRunScript": ([ctypes.c_wchar_p, ctypes.c_size_t, ctypes.c_wchar_p, ctypes.POINTER(pointer)], ctypes.c_uint),
        "JsConvertValueToString": ([pointer, ctypes.POINTER(pointer)], ctypes.c_uint),
        "JsStringToPointer": ([pointer, ctypes.POINTER(pointer), ctypes.POINTER(ctypes.c_size_t)], ctypes.c_uint),
        "JsGetAndClearException": ([ctypes.POINTER(pointer)], ctypes.c_uint),
        "JsDisposeRuntime": ([pointer], ctypes.c_uint),
    }
    for name, (args, result) in api.items():
        function = getattr(dll, name)
        function.argtypes = args
        function.restype = result

    def check(code):
        if code:
            raise RuntimeError(f"Chakra API error: 0x{code:08x}")

    def to_string(value):
        string = pointer()
        check(dll.JsConvertValueToString(value, ctypes.byref(string)))
        data = pointer()
        length = ctypes.c_size_t()
        check(dll.JsStringToPointer(string, ctypes.byref(data), ctypes.byref(length)))
        return ctypes.wstring_at(data, length.value)

    runtime = pointer()
    check(dll.JsCreateRuntime(0, None, ctypes.byref(runtime)))
    try:
        context = pointer()
        check(dll.JsCreateContext(runtime, ctypes.byref(context)))
        check(dll.JsSetCurrentContext(context))
        result = pointer()
        code = dll.JsRunScript(source, 0, "kasholka-tests.js", ctypes.byref(result))
        if code:
            error = pointer()
            check(dll.JsGetAndClearException(ctypes.byref(error)))
            raise AssertionError(to_string(error))
        return to_string(result)
    finally:
        dll.JsSetCurrentContext(None)
        dll.JsDisposeRuntime(runtime)
