@echo off
setlocal
call "%~dp0env.cmd"
pushd "%KARASU_ROOT%"
"%KARASU_PY%" -m karasu %*
set "CODE=%ERRORLEVEL%"
popd
exit /b %CODE%
