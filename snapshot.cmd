@echo off
setlocal
call "%~dp0env.cmd"
pushd "%CD_ROOT%"
"%CD_PY%" -m digger snapshot >> "%CD_ROOT%\data\logs\snapshot.log" 2>&1
popd
