' MyToDo 看门狗的隐形包装：计划任务调它，避免每 5 分钟闪一个 PowerShell 黑框
CreateObject("WScript.Shell").Run "powershell -NoProfile -ExecutionPolicy Bypass -File ""D:\software\MyToDo\watchdog.ps1""", 0, False
