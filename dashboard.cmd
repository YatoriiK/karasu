@echo off
setlocal
call "%~dp0env.cmd"
pushd "%CD_ROOT%"
start "" http://127.0.0.1:8765/
"%CD_PY%" -m digger serve
popd
