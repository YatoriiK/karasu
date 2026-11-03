@echo off
setlocal
call "%~dp0env.cmd"
pushd "%CD_ROOT%"
"%CD_PY%" -m digger %*
set "CODE=%ERRORLEVEL%"
popd
exit /b %CODE%
