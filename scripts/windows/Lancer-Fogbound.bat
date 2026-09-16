@echo off
setlocal

rem Double-click launcher for start-fogbound.ps1. Self-elevates to
rem Administrator first: the session that just fixed the "no kernel image"
rem investigation confirmed a real, otherwise-permanent trap on this PC --
rem a process started from a normal (non-elevated) window can never be
rem stopped or even fully inspected by a later normal-privilege script run,
rem only by an elevated one. Always launching elevated means every future
rem run of this script can manage anything a previous run started,
rem regardless of which mode that previous run happened to use.

net session >nul 2>&1
if %errorLevel% == 0 goto :run

echo Demande d'elevation (fenetre UAC)...
powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
exit /b

:run
cd /d "%~dp0"
powershell -NoExit -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-fogbound.ps1"
