@echo off
setlocal
call "%~dp0env.cmd"
pushd "%CD_ROOT%"
"%CD_PY%" -m digger run >> "%CD_ROOT%\data\logs\run.log" 2>&1
popd
