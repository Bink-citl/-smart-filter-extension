# -*- coding: utf-8 -*-
"""
Smart Filter RPA 助手 · 安装（设为开机自动启动，并马上在后台启动）

怎么运行（只做一次）：
  在资源管理器里打开 rpa-helper 文件夹，点上方地址栏，输入  cmd /k py install_autostart.py  回车（没有 py 就换成 python）。
  （不要直接双击 .py：你电脑上 .py 默认用代码编辑器打开，不会运行。）

做了什么：
  1. 在「当前用户」的开机启动项（注册表 HKCU\\...\\Run）里写一条：用 pythonw.exe 在后台运行 rpa_helper.py。
     不依赖 .py 的打开方式，不用 .bat / 快捷方式（Windows 11「智能应用控制」会拦网上下载的 .bat / .lnk）。
  2. 马上在后台启动一个助手（没有黑色窗口，日志在 rpa-helper.log）。
  3. 清掉 v1.9.1 放在「启动」文件夹里的 smartfilter-rpa.pyw（它在你电脑上会被编辑器打开）。
插件文件夹挪了位置后要重新运行一次。
"""
import sys
sys.dont_write_bytecode = True
import os
import time
import subprocess
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
HELPER = os.path.join(HERE, 'rpa_helper.py')
RUN_KEY = r'Software\Microsoft\Windows\CurrentVersion\Run'
VALUE = 'smartfilter-rpa'


def pythonw():
    exe = sys.executable or ''
    cand = os.path.join(os.path.dirname(exe), 'pythonw.exe')
    return cand if os.path.exists(cand) else exe


def old_startup_file():
    appdata = os.environ.get('APPDATA') or os.path.expanduser('~\\AppData\\Roaming')
    return os.path.join(appdata, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'smartfilter-rpa.pyw')


def ping():
    try:
        req = urllib.request.Request('http://127.0.0.1:17861/ping', headers={'X-HRS-RPA': '1'})
        return urllib.request.urlopen(req, timeout=2).read().decode('utf-8')
    except Exception:
        return ''


def main():
    if sys.platform != 'win32':
        print('[失败] 只能在 Windows 上安装')
        return 1
    if not os.path.exists(HELPER):
        print('[失败] 找不到 rpa_helper.py：' + HELPER)
        return 1
    import winreg
    pw = pythonw()
    cmd = '"%s" "%s"' % (pw, HELPER)
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as k:
        winreg.SetValueEx(k, VALUE, 0, winreg.REG_SZ, cmd)
    print('[完成] 已设为开机自动启动（后台运行，没有窗口）')
    print('       启动命令：' + cmd)
    old = old_startup_file()
    if os.path.exists(old):
        try:
            os.remove(old)
            print('[完成] 已清掉旧版放在「启动」文件夹里的 smartfilter-rpa.pyw')
        except Exception as e:
            print('[提示] 旧文件没删掉，请手动删除：%s（%s）' % (old, e))
    if ping():
        print('[信息] RPA 助手已经在运行，不用再启动')
    else:
        try:
            flags = 0x00000008 | 0x00000200   # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
            subprocess.Popen([pw, HELPER], cwd=HERE, creationflags=flags, close_fds=True)
        except Exception as e:
            print('[失败] 后台启动没成功：%s' % e)
            return 1
        for _ in range(20):
            time.sleep(0.5)
            if ping():
                break
        if ping():
            print('[完成] RPA 助手已在后台运行。到插件设置页点「检测连接」确认')
        else:
            print('[失败] 助手没起来。请看本文件夹里的 rpa-helper.log，或在地址栏输入 cmd /k py rpa_helper.py 回车，看黑色窗口里的报错')
            return 1
    return 0


if __name__ == '__main__':
    try:
        code = main()
    except Exception as e:
        print('[失败] %s' % e)
        code = 1
    try:
        input('按回车关闭')
    except Exception:
        pass
    sys.exit(code)
