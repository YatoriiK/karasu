@echo off
setlocal
call "%~dp0env.cmd"
set "TORCH_INDEX=https://download.pytorch.org/whl/cpu"
where nvidia-smi >nul 2>nul && set "TORCH_INDEX=https://download.pytorch.org/whl/cu128"
if not exist "%CD_PY%" py -3.12 -m venv "%CD_ROOT%\.venv" || goto :fail
"%CD_PY%" -m pip install --upgrade pip || goto :fail
"%CD_PY%" -m pip install torch --index-url %TORCH_INDEX% || goto :fail
"%CD_PY%" -m pip install -r "%CD_ROOT%\requirements-dev.txt" || goto :fail
"%CD_PY%" -m digger doctor
exit /b 0
:fail
echo Setup failed.
exit /b 1
