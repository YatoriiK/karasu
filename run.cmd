@echo off
setlocal
call "%~dp0env.cmd"
pushd "%KARASU_ROOT%"
"%KARASU_PY%" -m karasu run >> "%KARASU_ROOT%\data\logs\run.log" 2>&1
popd
