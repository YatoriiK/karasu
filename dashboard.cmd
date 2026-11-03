@echo off
setlocal
call "%~dp0env.cmd"
pushd "%KARASU_ROOT%"
start "" http://127.0.0.1:8765/
"%KARASU_PY%" -m karasu serve
popd
