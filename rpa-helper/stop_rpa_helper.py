# -*- coding: utf-8 -*-
"""Smart Filter RPA 助手 · 停止正在运行的助手（包括开机自启的后台助手）。
运行：rpa-helper 文件夹地址栏输入  cmd /k py stop_rpa_helper.py  回车。
"""
import sys
sys.dont_write_bytecode = True
import urllib.request

try:
    req = urllib.request.Request('http://127.0.0.1:17861/quit', headers={'X-HRS-RPA': '1'})
    urllib.request.urlopen(req, timeout=5).read()
    print('[完成] 已停止 RPA 助手')
except Exception as e:
    print('[信息] 没有正在运行的 RPA 助手（%s）' % e)
try:
    input('按回车关闭')
except Exception:
    pass
