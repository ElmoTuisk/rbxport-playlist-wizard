@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-Playlist-Wizard.ps1" -StartWithRbxport %*
if errorlevel 1 pause
