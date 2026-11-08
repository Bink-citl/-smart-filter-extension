# -*- coding: utf-8 -*-
"""
Smart Filter RPA 助手 · 取消开机自动启动
运行：rpa-helper 文件夹地址栏输入  cmd /k py remove_autostart.py  回车。
不会停掉正在运行的助手，停掉用  cmd /k py stop_rpa_helper.py
"""
import sys
sys.dont_write_bytecode = True
import os

done = False
if sys.platform == 'win32':
    import winreg
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r'Software\Microsoft\Windows\CurrentVersion\Run', 0, winreg.KEY_SET_VALUE) as k:
            winreg.DeleteValue(k, 'smartfilter-rpa')
            done = True
    except FileNotFoundError:
        pass
    appdata = os.environ.get('APPDATA') or os.path.expanduser('~\\AppData\\Roaming')
    old = os.path.join(appdata, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'smartfilter-rpa.pyw')
    if os.path.exists(old):
        os.remove(old)
        done = True
print('[完成] 已取消开机自动启动' if done else '[信息] 本来就没有设置开机自动启动')
try:
    input('按回车关闭')
except Exception:
    pass
