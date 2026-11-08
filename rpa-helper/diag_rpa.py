# -*- coding: utf-8 -*-
"""Smart Filter RPA 诊断：列出浏览器窗口和坐标换算依据，脱敏后附到 GitHub Issue 即可。
运行：rpa-helper 文件夹地址栏输入  cmd /k py diag_rpa.py  回车。
"""
import sys
sys.dont_write_bytecode = True   # 插件目录里不能出现 __pycache__（下划线开头的文件夹会让浏览器拒绝加载插件）
import os
import runpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.argv = [os.path.join(HERE, 'rpa_helper.py'), '--diag']
runpy.run_path(sys.argv[0], run_name='__main__')
