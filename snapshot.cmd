@echo off
setlocal
call "%~dp0env.cmd"
pushd "%KARASU_ROOT%"
"%KARASU_PY%" -m karasu snapshot >> "%KARASU_ROOT%\data\logs\snapshot.log" 2>&1
popd
