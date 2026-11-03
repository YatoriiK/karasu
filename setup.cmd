@echo off
setlocal
call "%~dp0env.cmd"
set "TORCH_INDEX=https://download.pytorch.org/whl/cpu"
where nvidia-smi >nul 2>nul && set "TORCH_INDEX=https://download.pytorch.org/whl/cu128"
if not exist "%KARASU_PY%" py -3.12 -m venv "%KARASU_ROOT%\.venv" || goto :fail
"%KARASU_PY%" -m pip install --upgrade pip || goto :fail
"%KARASU_PY%" -m pip install torch --index-url %TORCH_INDEX% || goto :fail
"%KARASU_PY%" -m pip install -r "%KARASU_ROOT%\requirements-dev.txt" || goto :fail
"%KARASU_PY%" -m karasu doctor
exit /b 0
:fail
echo Setup failed.
exit /b 1
