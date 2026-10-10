# MyToDo 看门狗：进程不在且无「干净退出」标记时拉起应用。
# 由计划任务 MyToDoWatchdog 每 5 分钟调用（wscript 包一层避免每次闪黑框）。
# 标记语义：应用正常退出（托盘退出）时写下、启动时清除——用户主动退出不会被复活。

$exe = 'D:\software\MyToDo\mytodo.exe'
$data = Join-Path $env:APPDATA 'com.mytodo.app'

if (-not (Test-Path $exe)) { exit 0 }

if (-not (Get-Process mytodo -ErrorAction SilentlyContinue)) {
    if (-not (Test-Path (Join-Path $data '.clean_exit'))) {
        Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe)
    }
}
