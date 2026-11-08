# -*- coding: utf-8 -*-
"""
Smart Filter · BOSS RPA 助手 v1.0.2

作用：替插件在 Boss 直聘网页上「真的」移动鼠标、点击、滚轮、打字、按键。
      插件负责判断「点哪里、点完对不对」，本助手只负责把鼠标键盘动作做出来。

为什么做成桌面 RPA：
  * 输入走 Windows SendInput，和人手操作鼠标键盘是同一条通道，页面收到的都是真人事件。
  * 不开浏览器调试端口、不挂调试器（GitHub 上多个 Boss 自动化项目反馈：调试端口和调试会话会被 Boss 识别并关页面）。
  * 鼠标走带弧度、先快后慢、偶尔略过头再拉回的轨迹；打字逐字、间隔随机。

安全约束：
  * 只监听 127.0.0.1，只接受插件后台发来的请求（自定义请求头 + chrome-extension 来源）。
  * 你在动鼠标键盘时自动让位（默认空闲 8 秒后才接手），屏幕锁定时不动作。
  * 点击前核对「鼠标下面是不是浏览器窗口」，打字前核对「前台是不是浏览器窗口」，不对就不做。
  * 只用 Python 自带库，不需要 pip 安装任何东西。

怎么运行（你电脑上 .py 默认用编辑器打开，所以不要双击，用资源管理器地址栏）：
  打开 rpa-helper 文件夹，点地址栏，输入下面的命令回车（前面的 cmd /k 让命令一定在黑色窗口里跑，不会被当成网址打开浏览器）：
    cmd /k py install_autostart.py   安装：设为开机后台自动运行，并马上在后台启动（推荐，只做一次）
    cmd /k py rpa_helper.py          临时开一个带黑色窗口的助手，能直接看日志（关窗口 = 停止）
    cmd /k py stop_rpa_helper.py     停掉正在运行的助手
    cmd /k py remove_autostart.py    取消开机自启
    cmd /k py diag_rpa.py            诊断：列出浏览器窗口和坐标换算依据
  没有 py 命令时把 py 换成 python。也可以在 编辑器终端 等编辑器的「终端」里直接输入 python install_autostart.py。
v1.0.1 起不用 .bat（Windows 11「智能应用控制」会拦网上下载的 .bat）。
v1.0.2 开机自启改用注册表启动项 + pythonw.exe，不依赖 .py 的打开方式。
"""
import sys
sys.dont_write_bytecode = True   # 扩展目录里不能出现 __pycache__（下划线开头的文件夹会让浏览器拒绝加载插件）
import os
import json
import time
import math
import random
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

VERSION = '1.0.2'
DEFAULT_PORT = 17861
HERE = os.path.dirname(os.path.abspath(__file__))
LOG_PATH = os.path.join(HERE, 'rpa-helper.log')
IS_WIN = sys.platform == 'win32'
MAGIC = 0x48525331   # 本助手发出的输入事件打这个标记，用来区分「我发的」和「你手动的」
BROWSER_EXE = ('chrome.exe', 'msedge.exe', 'brave.exe', 'vivaldi.exe', 'opera.exe', 'chromium.exe')

_log_lock = threading.Lock()


def log(tag, msg):
    line = time.strftime('%H:%M:%S') + ' ' + tag + ' ' + str(msg)
    with _log_lock:
        try:
            print(line, flush=True)
        except Exception:
            pass
        try:
            if os.path.exists(LOG_PATH) and os.path.getsize(LOG_PATH) > 2 * 1024 * 1024:
                os.replace(LOG_PATH, LOG_PATH + '.old')
            with open(LOG_PATH, 'a', encoding='utf-8') as f:
                f.write(time.strftime('%Y-%m-%d ') + line + '\n')
        except Exception:
            pass


def clamp(v, a, b):
    return a if v < a else (b if v > b else v)


# =====================================================================
# Windows 底层（SendInput / 窗口 / DPI / 低级钩子）
# =====================================================================
class WinBackend(object):
    def __init__(self):
        import ctypes
        from ctypes import wintypes
        self.ct = ctypes
        self.wt = wintypes
        self.user32 = ctypes.WinDLL('user32', use_last_error=True)
        self.kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
        try:
            self.dwmapi = ctypes.WinDLL('dwmapi')
        except Exception:
            self.dwmapi = None
        self.dpi_mode = self._set_dpi_aware()
        self._define()
        self.hook_ok = False
        self.last_user = 0.0          # 最近一次「不是本助手发出的」鼠标键盘输入（monotonic 秒）
        self._hook_refs = []

    # ---------- DPI：按物理像素工作，和页面的 devicePixelRatio 对得上 ----------
    def _set_dpi_aware(self):
        ct = self.ct
        try:
            self.user32.SetProcessDpiAwarenessContext.restype = ct.c_bool
            if self.user32.SetProcessDpiAwarenessContext(ct.c_void_p(-4)):
                return 'per-monitor-v2'
        except Exception:
            pass
        try:
            ct.WinDLL('shcore').SetProcessDpiAwareness(2)
            return 'per-monitor'
        except Exception:
            pass
        try:
            self.user32.SetProcessDPIAware()
            return 'system'
        except Exception:
            return 'unaware'

    def _define(self):
        ct, wt = self.ct, self.wt
        ULONG_PTR = ct.c_size_t

        class MOUSEINPUT(ct.Structure):
            _fields_ = [('dx', wt.LONG), ('dy', wt.LONG), ('mouseData', wt.DWORD), ('dwFlags', wt.DWORD),
                        ('time', wt.DWORD), ('dwExtraInfo', ULONG_PTR)]

        class KEYBDINPUT(ct.Structure):
            _fields_ = [('wVk', wt.WORD), ('wScan', wt.WORD), ('dwFlags', wt.DWORD), ('time', wt.DWORD),
                        ('dwExtraInfo', ULONG_PTR)]

        class HARDWAREINPUT(ct.Structure):
            _fields_ = [('uMsg', wt.DWORD), ('wParamL', wt.WORD), ('wParamH', wt.WORD)]

        class _U(ct.Union):
            _fields_ = [('mi', MOUSEINPUT), ('ki', KEYBDINPUT), ('hi', HARDWAREINPUT)]

        class INPUT(ct.Structure):
            _anonymous_ = ('u',)
            _fields_ = [('type', wt.DWORD), ('u', _U)]

        class MSLLHOOKSTRUCT(ct.Structure):
            _fields_ = [('pt', wt.POINT), ('mouseData', wt.DWORD), ('flags', wt.DWORD), ('time', wt.DWORD),
                        ('dwExtraInfo', ULONG_PTR)]

        class KBDLLHOOKSTRUCT(ct.Structure):
            _fields_ = [('vkCode', wt.DWORD), ('scanCode', wt.DWORD), ('flags', wt.DWORD), ('time', wt.DWORD),
                        ('dwExtraInfo', ULONG_PTR)]

        self.INPUT, self.MOUSEINPUT, self.KEYBDINPUT = INPUT, MOUSEINPUT, KEYBDINPUT
        self.MSLL, self.KBDLL = MSLLHOOKSTRUCT, KBDLLHOOKSTRUCT
        u = self.user32
        u.SendInput.argtypes = [wt.UINT, ct.POINTER(INPUT), ct.c_int]
        u.SendInput.restype = wt.UINT
        u.GetCursorPos.argtypes = [ct.POINTER(wt.POINT)]
        u.SetCursorPos.argtypes = [ct.c_int, ct.c_int]
        u.GetSystemMetrics.argtypes = [ct.c_int]
        u.WindowFromPoint.argtypes = [wt.POINT]
        u.WindowFromPoint.restype = wt.HWND
        u.GetAncestor.argtypes = [wt.HWND, wt.UINT]
        u.GetAncestor.restype = wt.HWND
        u.GetForegroundWindow.restype = wt.HWND
        u.GetWindowRect.argtypes = [wt.HWND, ct.POINTER(wt.RECT)]
        u.GetClassNameW.argtypes = [wt.HWND, wt.LPWSTR, ct.c_int]
        u.GetWindowTextW.argtypes = [wt.HWND, wt.LPWSTR, ct.c_int]
        u.GetWindowTextLengthW.argtypes = [wt.HWND]
        u.IsWindowVisible.argtypes = [wt.HWND]
        u.IsIconic.argtypes = [wt.HWND]
        u.ShowWindow.argtypes = [wt.HWND, ct.c_int]
        u.SetForegroundWindow.argtypes = [wt.HWND]
        u.BringWindowToTop.argtypes = [wt.HWND]
        u.GetWindowThreadProcessId.argtypes = [wt.HWND, ct.POINTER(wt.DWORD)]
        u.GetWindowThreadProcessId.restype = wt.DWORD
        u.AttachThreadInput.argtypes = [wt.DWORD, wt.DWORD, wt.BOOL]
        u.MapVirtualKeyW.argtypes = [wt.UINT, wt.UINT]
        u.MapVirtualKeyW.restype = wt.UINT
        u.OpenInputDesktop.argtypes = [wt.DWORD, wt.BOOL, wt.DWORD]
        u.OpenInputDesktop.restype = wt.HANDLE
        u.CloseDesktop.argtypes = [wt.HANDLE]
        try:
            u.GetDpiForWindow.argtypes = [wt.HWND]
            u.GetDpiForWindow.restype = wt.UINT
        except Exception:
            pass
        self.EnumProc = ct.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)
        u.EnumWindows.argtypes = [self.EnumProc, wt.LPARAM]
        u.EnumChildWindows.argtypes = [wt.HWND, self.EnumProc, wt.LPARAM]
        k = self.kernel32
        k.GetCurrentThreadId.restype = wt.DWORD
        k.OpenProcess.argtypes = [wt.DWORD, wt.BOOL, wt.DWORD]
        k.OpenProcess.restype = wt.HANDLE
        k.CloseHandle.argtypes = [wt.HANDLE]
        k.QueryFullProcessImageNameW.argtypes = [wt.HANDLE, wt.DWORD, wt.LPWSTR, ct.POINTER(wt.DWORD)]
        k.GetModuleHandleW.argtypes = [wt.LPCWSTR]
        k.GetModuleHandleW.restype = wt.HMODULE

    # ---------- 低级钩子：分辨「你动了鼠标键盘」还是「助手发的」 ----------
    def start_hooks(self):
        t = threading.Thread(target=self._hook_thread, name='input-hook', daemon=True)
        t.start()
        for _ in range(30):
            if self.hook_ok:
                break
            time.sleep(0.05)
        return self.hook_ok

    def _hook_thread(self):
        ct, wt, u = self.ct, self.wt, self.user32
        LRESULT = ct.c_ssize_t
        HOOKPROC = ct.WINFUNCTYPE(LRESULT, ct.c_int, wt.WPARAM, wt.LPARAM)
        u.SetWindowsHookExW.argtypes = [ct.c_int, HOOKPROC, wt.HINSTANCE, wt.DWORD]
        u.SetWindowsHookExW.restype = ct.c_void_p
        u.CallNextHookEx.argtypes = [ct.c_void_p, ct.c_int, wt.WPARAM, wt.LPARAM]
        u.CallNextHookEx.restype = LRESULT
        u.GetMessageW.argtypes = [ct.POINTER(wt.MSG), wt.HWND, wt.UINT, wt.UINT]
        me = self

        def mouse_proc(n, wp, lp):
            try:
                if n == 0 and lp:
                    s = ct.cast(lp, ct.POINTER(me.MSLL)).contents
                    if s.dwExtraInfo != MAGIC:
                        me.last_user = time.monotonic()
            except Exception:
                pass
            return u.CallNextHookEx(None, n, wp, lp)

        def kb_proc(n, wp, lp):
            try:
                if n == 0 and lp:
                    s = ct.cast(lp, ct.POINTER(me.KBDLL)).contents
                    if s.dwExtraInfo != MAGIC:
                        me.last_user = time.monotonic()
            except Exception:
                pass
            return u.CallNextHookEx(None, n, wp, lp)

        mp, kp = HOOKPROC(mouse_proc), HOOKPROC(kb_proc)
        self._hook_refs = [mp, kp]
        hmod = self.kernel32.GetModuleHandleW(None)
        h1 = u.SetWindowsHookExW(14, mp, hmod, 0)   # WH_MOUSE_LL
        h2 = u.SetWindowsHookExW(13, kp, hmod, 0)   # WH_KEYBOARD_LL
        self.hook_ok = bool(h1 and h2)
        msg = wt.MSG()
        while u.GetMessageW(ct.byref(msg), None, 0, 0) > 0:
            pass

    # ---------- 基础查询 ----------
    def cursor(self):
        p = self.wt.POINT()
        self.user32.GetCursorPos(self.ct.byref(p))
        return (p.x, p.y)

    def locked(self):
        h = self.user32.OpenInputDesktop(0, False, 0x0100)   # DESKTOP_SWITCHDESKTOP
        if not h:
            return True   # 锁屏 / UAC 安全桌面：普通程序打不开输入桌面
        self.user32.CloseDesktop(h)
        return False

    def foreground_root(self):
        h = self.user32.GetForegroundWindow()
        if not h:
            return 0
        r = self.user32.GetAncestor(h, 2)   # GA_ROOT
        return int(r or h)

    def root_at(self, x, y):
        h = self.user32.WindowFromPoint(self.wt.POINT(int(x), int(y)))
        if not h:
            return 0
        r = self.user32.GetAncestor(h, 2)
        return int(r or h)

    def cls(self, h):
        b = self.ct.create_unicode_buffer(256)
        self.user32.GetClassNameW(h, b, 256)
        return b.value

    def title(self, h):
        n = self.user32.GetWindowTextLengthW(h)
        b = self.ct.create_unicode_buffer(n + 2)
        self.user32.GetWindowTextW(h, b, n + 1)
        return b.value

    def rect(self, h):
        r = self.wt.RECT()
        self.user32.GetWindowRect(h, self.ct.byref(r))
        return (r.left, r.top, r.right, r.bottom)

    def frame_rect(self, h):
        if self.dwmapi:
            r = self.wt.RECT()
            try:
                if self.dwmapi.DwmGetWindowAttribute(self.wt.HWND(h), 9, self.ct.byref(r), self.ct.sizeof(r)) == 0:
                    return (r.left, r.top, r.right, r.bottom)
            except Exception:
                pass
        return self.rect(h)

    def exe(self, h):
        pid = self.wt.DWORD()
        self.user32.GetWindowThreadProcessId(h, self.ct.byref(pid))
        hp = self.kernel32.OpenProcess(0x1000, False, pid.value)   # PROCESS_QUERY_LIMITED_INFORMATION
        if not hp:
            return ''
        try:
            b = self.ct.create_unicode_buffer(1024)
            n = self.wt.DWORD(1024)
            if self.kernel32.QueryFullProcessImageNameW(hp, 0, b, self.ct.byref(n)):
                return os.path.basename(b.value).lower()
            return ''
        finally:
            self.kernel32.CloseHandle(hp)

    def dpi_of(self, h):
        try:
            return int(self.user32.GetDpiForWindow(h)) or 96
        except Exception:
            return 96

    def top_windows(self):
        out = []

        def cb(h, lp):
            out.append(int(h))
            return True
        self.user32.EnumWindows(self.EnumProc(cb), 0)
        return out

    def children(self, h):
        out = []

        def cb(c, lp):
            out.append(int(c))
            return True
        self.user32.EnumChildWindows(h, self.EnumProc(cb), 0)
        return out

    def visible(self, h):
        return bool(self.user32.IsWindowVisible(h))

    def iconic(self, h):
        return bool(self.user32.IsIconic(h))

    def virtual_screen(self):
        g = self.user32.GetSystemMetrics
        return (g(76), g(77), max(1, g(78)), max(1, g(79)))

    # ---------- 前台 ----------
    def bring_front(self, h):
        u, k = self.user32, self.kernel32
        if self.iconic(h):
            u.ShowWindow(h, 9)   # SW_RESTORE
            time.sleep(0.3)
        if self.foreground_root() == h:
            return True
        fg = u.GetForegroundWindow()
        t_fg = u.GetWindowThreadProcessId(fg, None) if fg else 0
        t_me = k.GetCurrentThreadId()
        attached = False
        try:
            if t_fg and t_fg != t_me:
                attached = bool(u.AttachThreadInput(t_me, t_fg, True))
            u.BringWindowToTop(h)
            u.SetForegroundWindow(h)
        finally:
            if attached:
                u.AttachThreadInput(t_me, t_fg, False)
        time.sleep(0.25)
        return self.foreground_root() == h

    # ---------- 发输入 ----------
    def _send(self, items):
        arr = (self.INPUT * len(items))(*items)
        n = self.user32.SendInput(len(items), arr, self.ct.sizeof(self.INPUT))
        if n != len(items):
            raise RuntimeError('SendInput 被系统拦下（%d/%d），可能是锁屏、UAC 弹窗或以管理员身份运行的窗口在前台' % (n, len(items)))

    def _mouse(self, flags, dx=0, dy=0, data=0):
        i = self.INPUT()
        i.type = 0
        i.mi = self.MOUSEINPUT(dx, dy, data & 0xFFFFFFFF, flags, 0, MAGIC)
        return i

    def _key(self, vk=0, scan=0, flags=0):
        i = self.INPUT()
        i.type = 1
        i.ki = self.KEYBDINPUT(vk, scan, flags, 0, MAGIC)
        return i

    def move_abs(self, x, y):
        vx, vy, vw, vh = self.virtual_screen()
        nx = int(round((x - vx) * 65535.0 / max(1, vw - 1)))
        ny = int(round((y - vy) * 65535.0 / max(1, vh - 1)))
        # MOVE | ABSOLUTE | VIRTUALDESK
        self._send([self._mouse(0x0001 | 0x8000 | 0x4000, nx, ny)])

    def fix_cursor(self, x, y):
        cx, cy = self.cursor()
        if abs(cx - x) > 1 or abs(cy - y) > 1:
            self.user32.SetCursorPos(int(x), int(y))

    def button(self, which, down):
        f = {('left', True): 0x0002, ('left', False): 0x0004, ('right', True): 0x0008, ('right', False): 0x0010}[(which, down)]
        self._send([self._mouse(f)])

    def wheel(self, delta):
        self._send([self._mouse(0x0800, 0, 0, int(delta))])

    def key(self, vk, down, extended=False):
        scan = self.user32.MapVirtualKeyW(vk, 0) & 0xFF
        f = (0 if down else 0x0002) | (0x0001 if extended else 0)
        self._send([self._key(vk, scan, f)])

    def unicode_char(self, ch):
        units = ch.encode('utf-16-le')
        codes = [int.from_bytes(units[i:i + 2], 'little') for i in range(0, len(units), 2)]
        items = []
        for c in codes:
            items.append(self._key(0, c, 0x0004))
        for c in codes:
            items.append(self._key(0, c, 0x0004 | 0x0002))
        self._send(items)


# =====================================================================
# 非 Windows：只用于离线自测（记录动作，不动任何东西）
# =====================================================================
class FakeBackend(object):
    dpi_mode = 'fake'
    hook_ok = True

    def __init__(self):
        self.last_user = 0.0
        self.pos = (500, 400)
        self.events = []
        self.win = 1001
        self.fake_locked = False
        self.fake_fg = 1001

    def start_hooks(self):
        return True

    def cursor(self):
        return self.pos

    def locked(self):
        return self.fake_locked

    def foreground_root(self):
        return self.fake_fg

    def root_at(self, x, y):
        return self.win

    def cls(self, h):
        return 'Chrome_RenderWidgetHostHWND' if h == 2002 else 'Chrome_WidgetWin_1'

    def title(self, h):
        return 'BOSS直聘 - Google Chrome' if h == self.win else ''

    def rect(self, h):
        return (100, 50, 1700, 1050) if h == self.win else (108, 180, 1692, 1042)

    def frame_rect(self, h):
        return self.rect(h)

    def exe(self, h):
        return 'chrome.exe'

    def dpi_of(self, h):
        return 120

    def top_windows(self):
        return [self.win]

    def children(self, h):
        return [2002] if h == self.win else []

    def visible(self, h):
        return True

    def iconic(self, h):
        return False

    def virtual_screen(self):
        return (0, 0, 1920, 1080)

    def bring_front(self, h):
        return self.fake_fg == h

    def move_abs(self, x, y):
        self.pos = (int(round(x)), int(round(y)))
        self.events.append(('move', self.pos))

    def fix_cursor(self, x, y):
        self.pos = (int(x), int(y))

    def button(self, which, down):
        self.events.append(('btn', which, down))

    def wheel(self, delta):
        self.events.append(('wheel', delta))

    def key(self, vk, down, extended=False):
        self.events.append(('key', vk, down))

    def unicode_char(self, ch):
        self.events.append(('char', ch))


# =====================================================================
# RPA 引擎：拟人轨迹 + 坐标换算 + 让位 / 前台 / 遮挡保护
# =====================================================================
VK = {'enter': 0x0D, 'escape': 0x1B, 'esc': 0x1B, 'backspace': 0x08, 'tab': 0x09, 'delete': 0x2E,
      'home': 0x24, 'end': 0x23, 'pageup': 0x21, 'pagedown': 0x22, 'up': 0x26, 'down': 0x28,
      'left': 0x25, 'right': 0x27, 'a': 0x41, 'space': 0x20}
EXTENDED = {0x2E, 0x24, 0x23, 0x21, 0x22, 0x26, 0x28, 0x25, 0x27}
MODS = {'ctrl': 0x11, 'shift': 0x10, 'alt': 0x12}


class Busy(Exception):
    def __init__(self, code, why, wait=0):
        Exception.__init__(self, why)
        self.code, self.why, self.wait = code, why, wait


class Engine(object):
    def __init__(self, be):
        self.be = be
        self.lock = threading.Lock()
        self.ctx = {}          # 当前目标窗口：hwnd、坐标原点、学到的偏移
        self.offsets = {}      # (hwnd, method, dpr) -> [ox, oy] 物理像素
        self.last_set = None   # 本助手最后一次把鼠标放到哪
        self.started = time.monotonic()

    # ---------- 让位：你在用鼠标键盘时不接手 ----------
    def user_wait(self, idle_need):
        now = time.monotonic()
        if self.be.hook_ok:
            idle = now - self.be.last_user
        else:
            # 钩子没装上时的兜底：鼠标不在助手上次放的位置，就当你动过
            cur = self.be.cursor()
            if self.last_set and (abs(cur[0] - self.last_set[0]) > 12 or abs(cur[1] - self.last_set[1]) > 12):
                self.be.last_user = now
                self.last_set = cur
            idle = now - self.be.last_user
        return max(0.0, idle_need - idle)

    def gate(self, a, need_window=True):
        if self.be.locked():
            raise Busy('locked', '屏幕已锁定或停在安全桌面（锁屏 / UAC 弹窗），真实鼠标没法操作，解锁后自动继续', 60)
        w = self.user_wait(float(a.get('idle', 8)))
        if w > 0:
            raise Busy('user_active', '检测到你正在用鼠标或键盘，RPA 让位，空闲 %d 秒后接手' % math.ceil(w), w)

    # ---------- 找浏览器窗口 ----------
    def find_browser(self, title_hint):
        be = self.be
        hint = (title_hint or '').strip()
        hint_short = hint[:24]
        fg = be.foreground_root()
        best, best_sc = 0, -1
        for h in be.top_windows():
            try:
                if not be.visible(h) or be.cls(h) != 'Chrome_WidgetWin_1':
                    continue
                t = be.title(h)
                if not t:
                    continue
                exe = be.exe(h)
                if exe and exe not in BROWSER_EXE:
                    continue
                sc = 0
                if hint_short and hint_short in t:
                    sc += 10
                if h == fg:
                    sc += 5
                l, tp, r, b = be.rect(h)
                if (r - l) > 300 and (b - tp) > 200:
                    sc += 1
                if hint_short and hint_short not in t and h != fg:
                    continue
                if sc > best_sc:
                    best, best_sc = h, sc
            except Exception:
                continue
        return best

    def origin(self, hwnd, a):
        """页面视口左上角在屏幕上的物理像素坐标。优先用浏览器内容区子窗口，拿不到再按窗口边框推算。"""
        be = self.be
        dpr = float(a.get('dpr') or 1)
        iw, ih = float(a.get('innerW') or 0), float(a.get('innerH') or 0)
        ew, eh = iw * dpr, ih * dpr
        best, best_err = None, 1e9
        for c in be.children(hwnd):
            try:
                if be.cls(c) != 'Chrome_RenderWidgetHostHWND' or not be.visible(c):
                    continue
                l, t, r, b = be.rect(c)
                if r - l < 50 or b - t < 50:
                    continue
                err = abs((r - l) - ew) + abs((b - t) - eh) if ew and eh else 0
                if err < best_err:
                    best, best_err = (l, t), err
            except Exception:
                continue
        tol = max(12.0, (ew + eh) * 0.02)
        if best is not None and (not ew or best_err <= tol):
            return best, 'content-window'
        l, t, r, b = be.frame_rect(hwnd)
        if eh:
            return (l, int(round(b - eh))), 'frame-estimate'
        return (l, t + int(round(100 * dpr))), 'frame-guess'

    def to_phys(self, a):
        hwnd = self.ctx.get('hwnd')
        if not hwnd:
            raise Busy('no_prepare', '内部错误：没有先 prepare', 0)
        (ox, oy), method = self.origin(hwnd, a)
        dpr = float(a.get('dpr') or 1)
        key = (hwnd, method, round(dpr, 3))
        off = self.offsets.get(key, [0.0, 0.0])
        self.ctx['key'] = key
        self.ctx['method'] = method
        x = ox + float(a['x']) * dpr + off[0]
        y = oy + float(a['y']) * dpr + off[1]
        return x, y

    def check_front(self):
        h = self.ctx.get('hwnd')
        if self.be.foreground_root() != h:
            if not self.be.bring_front(h):
                raise Busy('not_foreground', '浏览器窗口不在最前面（被别的窗口抢了前台），等它回到前台再继续', 10)

    # ---------- 拟人轨迹 ----------
    def path(self, x0, y0, x1, y1, speed):
        dx, dy = x1 - x0, y1 - y0
        dist = math.hypot(dx, dy)
        if dist < 1.5:
            return [], 0.0
        dur = (0.16 + 0.10 * math.log2(1 + dist / 35.0)) / max(0.3, speed) * random.uniform(0.85, 1.2)
        n = int(clamp(dur / 0.011, 6, 140))
        ux, uy = dx / dist, dy / dist
        px, py = -uy, ux
        bend = random.uniform(-1, 1) * min(dist * 0.2, 150)
        c1 = (x0 + dx * random.uniform(0.18, 0.4) + px * bend * random.uniform(0.6, 1.1),
              y0 + dy * random.uniform(0.18, 0.4) + py * bend * random.uniform(0.6, 1.1))
        c2 = (x0 + dx * random.uniform(0.6, 0.85) + px * bend * random.uniform(0.2, 0.7),
              y0 + dy * random.uniform(0.6, 0.85) + py * bend * random.uniform(0.2, 0.7))
        pts = []
        for i in range(1, n + 1):
            t = i / float(n)
            e = t * t * t * (10 - 15 * t + 6 * t * t)          # 先加速后减速（最小加加速度曲线）
            m = 1 - e
            bx = m * m * m * x0 + 3 * m * m * e * c1[0] + 3 * m * e * e * c2[0] + e * e * e * x1
            by = m * m * m * y0 + 3 * m * m * e * c1[1] + 3 * m * e * e * c2[1] + e * e * e * y1
            jitter = (1 - e) * 0.9
            pts.append((bx + random.uniform(-jitter, jitter), by + random.uniform(-jitter, jitter)))
        pts[-1] = (x1, y1)
        return pts, dur / n

    def glide(self, x1, y1, speed, guard_since):
        be = self.be
        x0, y0 = be.cursor()
        segs = []
        dist = math.hypot(x1 - x0, y1 - y0)
        if dist > 260 and random.random() < 0.35:
            # 偶尔略过头再拉回来，像人手一样
            ux, uy = (x1 - x0) / dist, (y1 - y0) / dist
            o = random.uniform(4, 11)
            ox, oy = x1 + ux * o + random.uniform(-3, 3), y1 + uy * o + random.uniform(-3, 3)
            segs.append((ox, oy, speed))
            segs.append((x1, y1, speed * 1.6))
        else:
            segs.append((x1, y1, speed))
        moved = False
        cx, cy = x0, y0
        for (tx, ty, sp) in segs:
            pts, step = self.path(cx, cy, tx, ty, sp)
            for (px, py) in pts:
                if be.hook_ok and be.last_user > guard_since:
                    raise Busy('user_active', '移动鼠标途中你动了鼠标或键盘，RPA 立即让位', 8)
                be.move_abs(px, py)
                moved = True
                time.sleep(max(0.004, step * random.uniform(0.7, 1.3)))
            cx, cy = tx, ty
        be.fix_cursor(int(round(x1)), int(round(y1)))
        self.last_set = be.cursor()
        return moved

    # ---------- 各个动作 ----------
    def op_ping(self, a):
        be = self.be
        return {'ok': True, 'name': 'smartfilter-rpa', 'version': VERSION, 'dpi': be.dpi_mode, 'hook': bool(be.hook_ok),
                'locked': bool(be.locked()), 'idle': round(time.monotonic() - be.last_user, 1) if be.last_user else None,
                'pid': os.getpid()}

    def op_probe(self, a):
        self.gate(a)
        h = self.find_browser(a.get('title'))
        if not h:
            raise Busy('no_window', '没找到 Boss 所在的浏览器窗口（窗口最小化到托盘或标题对不上），稍后重试', 10)
        return {'ok': True, 'hwnd': h}

    def op_prepare(self, a):
        self.gate(a)
        h = self.find_browser(a.get('title'))
        if not h:
            raise Busy('no_window', '没找到 Boss 所在的浏览器窗口（标题：%s）' % (a.get('title') or '')[:30], 10)
        self.ctx = {'hwnd': h, 'since': time.monotonic(), 'idle': float(a.get('idle', 8))}
        if self.be.foreground_root() != h and not self.be.bring_front(h):
            raise Busy('not_foreground', '浏览器窗口切不到最前面，请别让其他窗口挡在 Boss 页面前面', 10)
        (ox, oy), method = self.origin(h, a)
        self.ctx['since'] = time.monotonic()
        return {'ok': True, 'hwnd': h, 'method': method, 'origin': [ox, oy], 'dpi': self.be.dpi_of(h)}

    def op_move(self, a):
        self.check_front()
        x, y = self.to_phys(a)
        speed = float(a.get('speed') or 1)
        moved = self.glide(x, y, speed, self.ctx.get('since', 0))
        return {'ok': True, 'moved': moved, 'phys': [int(round(x)), int(round(y))], 'method': self.ctx.get('method')}

    def op_calib(self, a):
        """页面回报「鼠标实际落在哪」，按误差修正换算偏移；需要时把鼠标挪到修正后的位置。"""
        dpr = float(a.get('dpr') or 1)
        key = self.ctx.get('key')
        if key is None:
            self.to_phys(a)
            key = self.ctx.get('key')
        off = self.offsets.get(key, [0.0, 0.0])
        off = [off[0] + float(a.get('ex', 0)) * dpr, off[1] + float(a.get('ey', 0)) * dpr]
        if abs(off[0]) > 900 or abs(off[1]) > 900:
            off = [0.0, 0.0]   # 偏得离谱说明窗口变了，重新学
        self.offsets[key] = off
        if a.get('move') and 'x' in a:
            return dict(self.op_move(a), offset=off)
        return {'ok': True, 'offset': off}

    def op_click(self, a):
        self.check_front()
        be = self.be
        if be.hook_ok and be.last_user > self.ctx.get('since', 0):
            raise Busy('user_active', '点击前你动了鼠标或键盘，这一下不点了，RPA 让位', 8)
        cx, cy = be.cursor()
        if be.root_at(cx, cy) != self.ctx.get('hwnd'):
            raise Busy('covered_win', '鼠标下面不是浏览器窗口（被别的窗口挡住了），没有点击', 5)
        which = a.get('button') or 'left'
        count = int(a.get('count') or 1)
        time.sleep(random.uniform(0.05, 0.16))
        for i in range(count):
            be.button(which, True)
            time.sleep(random.uniform(0.045, 0.11))
            be.button(which, False)
            if i + 1 < count:
                time.sleep(random.uniform(0.07, 0.14))
        return {'ok': True, 'at': [cx, cy]}

    def op_wheel(self, a):
        self.check_front()
        if 'x' in a:
            x, y = self.to_phys(a)
            cx, cy = self.be.cursor()
            if math.hypot(x - cx, y - cy) > 24:
                self.glide(x, y, float(a.get('speed') or 1), self.ctx.get('since', 0))
        cx, cy = self.be.cursor()
        if self.be.root_at(cx, cy) != self.ctx.get('hwnd'):
            raise Busy('covered_win', '滚轮位置不在浏览器窗口上，没有滚动', 5)
        n = int(clamp(int(a.get('notches') or 0), -12, 12))
        sign = -1 if n > 0 else 1   # 页面往下看 = 滚轮向下 = 负值
        for i in range(abs(n)):
            if self.be.hook_ok and self.be.last_user > self.ctx.get('since', 0):
                raise Busy('user_active', '滚动途中你动了鼠标或键盘，RPA 让位', 8)
            self.be.wheel(120 * sign)
            time.sleep(random.uniform(0.035, 0.095))
            if i and i % random.randint(3, 5) == 0:
                time.sleep(random.uniform(0.12, 0.3))
        return {'ok': True, 'notches': n}

    def op_type(self, a):
        self.check_front()
        text = str(a.get('text') or '')
        speed = max(0.3, float(a.get('speed') or 1))
        if len(text) > 120:
            speed *= len(text) / 120.0   # 长话术整体控制在十几秒内
        be = self.be
        for ch in text:
            if be.hook_ok and be.last_user > self.ctx.get('since', 0):
                raise Busy('user_active', '打字途中你动了鼠标或键盘，已停止输入，RPA 让位', 8)
            if self.be.foreground_root() != self.ctx.get('hwnd'):
                raise Busy('not_foreground', '打字途中浏览器失去前台，已停止输入', 10)
            if ch == '\r':
                continue
            if ch == '\n':
                be.key(MODS['shift'], True)
                be.key(VK['enter'], True)
                be.key(VK['enter'], False)
                be.key(MODS['shift'], False)
            else:
                be.unicode_char(ch)
            d = clamp(random.lognormvariate(math.log(0.085), 0.38) / speed, 0.025, 0.4)
            if ch in '，。！？；,.!?;：:':
                d += random.uniform(0.08, 0.3) / speed
            time.sleep(d)
        return {'ok': True, 'chars': len(text)}

    def op_key(self, a):
        self.check_front()
        name = str(a.get('key') or '').lower()
        vk = VK.get(name)
        if vk is None:
            raise Busy('bad_key', '不认识的按键：%s' % name, 0)
        mods = [MODS[m] for m in ('ctrl', 'shift', 'alt') if a.get(m)]
        be = self.be
        for m in mods:
            be.key(m, True)
            time.sleep(random.uniform(0.03, 0.07))
        be.key(vk, True, vk in EXTENDED)
        time.sleep(random.uniform(0.04, 0.1))
        be.key(vk, False, vk in EXTENDED)
        for m in reversed(mods):
            time.sleep(random.uniform(0.02, 0.06))
            be.key(m, False)
        return {'ok': True}

    def dispatch(self, a):
        op = str(a.get('op') or '')
        fn = getattr(self, 'op_' + op, None)
        if not fn:
            return {'ok': False, 'code': 'bad_op', 'why': '不认识的动作：' + op}
        if op == 'ping':
            return fn(a)
        if not self.lock.acquire(timeout=40):
            return {'ok': False, 'code': 'busy', 'why': 'RPA 助手正忙（上一个动作还没做完）', 'wait': 3}
        try:
            if op not in ('probe', 'prepare', 'calib') and not self.ctx.get('hwnd'):
                return {'ok': False, 'code': 'no_prepare', 'why': '内部错误：动作前没有 prepare'}
            res = fn(a)
            if op in ('click', 'type', 'key', 'wheel'):
                log('[完成]', '%s %s' % (op, json.dumps({k: a[k] for k in a if k in ('key', 'notches', 'count')}, ensure_ascii=False) if op != 'type' else '%d 字' % len(str(a.get('text') or ''))))
            return res
        except Busy as b:
            if b.code not in ('user_active',):
                log('[提示]', '%s：%s' % (op, b.why))
            return {'ok': False, 'code': b.code, 'why': b.why, 'wait': b.wait}
        except Exception as e:
            log('[失败]', '%s：%s' % (op, e))
            log('[失败]', traceback.format_exc().strip().splitlines()[-1])
            return {'ok': False, 'code': 'error', 'why': '%s：%s' % (op, e)}
        finally:
            self.lock.release()


# =====================================================================
# 本机 HTTP 服务（只给插件后台用）
# =====================================================================
def make_handler(engine):
    class H(BaseHTTPRequestHandler):
        server_version = 'ZhiShaiRPA/' + VERSION
        protocol_version = 'HTTP/1.1'

        def log_message(self, fmt, *args):
            pass

        def _json(self, code, obj):
            body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
            self.send_response(code)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(body)

        def _allowed(self):
            if self.headers.get('X-HRS-RPA') != '1':
                return False
            origin = self.headers.get('Origin') or ''
            if origin and not origin.startswith('chrome-extension://') and not origin.startswith('extension://'):
                return False
            return True

        def do_OPTIONS(self):
            self._json(403, {'ok': False, 'why': 'forbidden'})

        def do_GET(self):
            path = self.path.split('?')[0]
            if not self._allowed() or path not in ('/ping', '/quit'):
                return self._json(403, {'ok': False, 'why': 'forbidden'})
            if path == '/quit':
                # 只接受本机不带网页来源的请求（stop_rpa_helper.py 发的），插件和网页都不会发这个
                if self.headers.get('Origin'):
                    return self._json(403, {'ok': False, 'why': 'forbidden'})
                self._json(200, {'ok': True})
                log('[信息]', '收到停止指令，RPA 助手退出')
                threading.Thread(target=self.server.shutdown, daemon=True).start()
                return
            self._json(200, engine.dispatch({'op': 'ping'}))

        def do_POST(self):
            if self.path.split('?')[0] != '/op' or not self._allowed():
                return self._json(403, {'ok': False, 'why': 'forbidden'})
            try:
                n = int(self.headers.get('Content-Length') or 0)
                if n <= 0 or n > 65536:
                    return self._json(400, {'ok': False, 'why': 'bad length'})
                a = json.loads(self.rfile.read(n).decode('utf-8'))
                if not isinstance(a, dict):
                    raise ValueError('not an object')
            except Exception as e:
                return self._json(400, {'ok': False, 'why': 'bad json: %s' % e})
            self._json(200, engine.dispatch(a))
    return H


def diag(be):
    print('=== Smart Filter RPA 助手 诊断 v%s ===' % VERSION)
    print('DPI 模式：%s' % be.dpi_mode)
    print('虚拟屏幕：%s' % (be.virtual_screen(),))
    print('鼠标位置：%s' % (be.cursor(),))
    print('屏幕锁定：%s' % be.locked())
    eng = Engine(be)
    found = 0
    for h in be.top_windows():
        try:
            if not be.visible(h) or be.cls(h) != 'Chrome_WidgetWin_1':
                continue
            t = be.title(h)
            if not t:
                continue
            exe = be.exe(h)
            if exe and exe not in BROWSER_EXE:
                continue
            found += 1
            print('-' * 60)
            print('浏览器窗口：%s  [%s]' % (t[:60], exe))
            print('  窗口外框：%s  可见边框：%s  DPI：%s' % (be.rect(h), be.frame_rect(h), be.dpi_of(h)))
            for c in be.children(h):
                if be.cls(c) == 'Chrome_RenderWidgetHostHWND':
                    print('  内容区子窗口：%s 可见=%s' % (be.rect(c), be.visible(c)))
        except Exception as e:
            print('  读取出错：%s' % e)
    if not found:
        print('没有找到 Chrome / Edge 窗口。请先打开浏览器再运行诊断。')
    print('=' * 60)


def setup_console():
    """双击 .py 打开的黑窗口：设成 UTF-8 显示中文，标题写上版本。没有窗口（后台运行）时什么也不做。"""
    if IS_WIN:
        try:
            import ctypes
            ctypes.windll.kernel32.SetConsoleOutputCP(65001)
            ctypes.windll.kernel32.SetConsoleTitleW('Smart Filter RPA Helper v' + VERSION)
        except Exception:
            pass
    for st in (sys.stdout, sys.stderr):
        try:
            if st is not None:
                st.reconfigure(encoding='utf-8', errors='replace')
        except Exception:
            pass


def interactive():
    try:
        return sys.stdin is not None and sys.stdin.isatty() and sys.stdout is not None
    except Exception:
        return False


def pause(msg):
    if interactive():
        try:
            input(msg)
        except Exception:
            pass


def main():
    setup_console()
    port = DEFAULT_PORT
    args = sys.argv[1:]
    if '--port' in args:
        try:
            port = int(args[args.index('--port') + 1])
        except Exception:
            pass
    be = WinBackend() if IS_WIN else FakeBackend()
    if '--diag' in args:
        diag(be)
        pause('诊断结束，可以截图这个窗口提交到 GitHub Issue（先脱敏）。按回车关闭')
        return 0
    log('[信息]', 'Smart Filter RPA 助手 v%s 启动  路径：%s' % (VERSION, HERE))
    if not IS_WIN:
        log('[提示]', '当前不是 Windows，只做离线自测，不会动鼠标')
    hook = be.start_hooks()
    log('[信息]', 'DPI 模式：%s  输入钩子：%s' % (be.dpi_mode, '已装上（能分辨你手动的操作）' if hook else '没装上，改用鼠标位置判断'))
    engine = Engine(be)
    try:
        srv = ThreadingHTTPServer(('127.0.0.1', port), make_handler(engine))
    except OSError as e:
        log('[失败]', '端口 %d 被占用：已经有一个 RPA 助手在运行（可能是开机自启的后台助手）。这个窗口可以关掉' % (port, e))
        pause('按回车关闭')
        return 2
    srv.daemon_threads = True
    log('[完成]', '已在 127.0.0.1:%d 等待插件指令。保持这个窗口开着，关掉窗口 = 停止 RPA' % port)
    log('[信息]', '运行时请不要动鼠标键盘；你一动，RPA 会自动让位，空闲几秒后再接手')
    try:
        srv.serve_forever(poll_interval=0.3)
    except KeyboardInterrupt:
        pass
    log('[信息]', 'RPA 助手已退出')
    return 0


def run():
    try:
        code = main()
    except SystemExit:
        raise
    except Exception:
        log('[失败]', '助手出错退出：' + traceback.format_exc().strip().splitlines()[-1])
        try:
            traceback.print_exc()
        except Exception:
            pass
        pause('出错了，截图这个窗口提交到 GitHub Issue（先脱敏）。按回车关闭')
        code = 1
    return code


if __name__ == '__main__':
    sys.exit(run())
