# Build ESONJson.dll (ExtendScript ExternalObject case)
# Finds the MSVC toolchain (VS2019/VS2022 BuildTools) + Windows SDK
# automatically (the standard ExternalObject prototype build pattern).
# Usage: powershell -ExecutionPolicy Bypass -File build.ps1 [-OutputName ESONJson]
# /Brepro on the link: deterministic PE timestamp (COFF header + export
# directory), so rebuilds are byte-identical - the accel bundle embeds the
# DLL as base64 and the parity contract compares bytes.

param(
    [string]$OutputName = "ESONJson"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$outDir = Join-Path $root "build"

function Find-VsDevCmd {
    $candidates = @(
        "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat",
        "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat",
        "C:\Program Files\Microsoft Visual Studio\2019\BuildTools\Common7\Tools\VsDevCmd.bat",
        "C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\Common7\Tools\VsDevCmd.bat"
    )
    foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
    throw "VsDevCmd.bat not found - install 'Desktop development with C++' (Build Tools)"
}

$devcmd = Find-VsDevCmd
$vswhere = "C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe"
if (Test-Path $vswhere) {
    $install = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
    if ($install) {
        $c = Join-Path $install "Common7\Tools\VsDevCmd.bat"
        if (Test-Path $c) { $devcmd = $c }
    }
}

# Capture the environment VsDevCmd sets, then build inside it.
$envBlock = cmd /c "`"$devcmd`" -arch=x64 -host_arch=x64 >nul 2>&1 && set"
$envBlock | ForEach-Object {
    if ($_ -match "^(.*?)=(.*)$") {
        [Environment]::SetEnvironmentVariable($matches[1], $matches[2], "Process")
    }
}

New-Item -ItemType Directory -Force -Path $outDir | Out-Null

# Numbered output name: a loaded DLL stays locked until the host app exits
# (LNK1104). Pass -OutputName ESONJsonV2 to build an iteration without
# closing Illustrator. Default keeps the canonical name.
$dll = Join-Path $outDir ($OutputName + ".dll")
$src = Join-Path $root "eson_json.c"

& cl /nologo /O2 /MT /LD /W3 /I"$root" "$src" /Fe:"$dll" /link /NOLOGO /MACHINE:X64 /SUBSYSTEM:WINDOWS /Brepro
if ($LASTEXITCODE -ne 0) { throw "cl failed with exit $LASTEXITCODE" }

Write-Output ""
Write-Output "Built: $dll"
& dumpbin /headers "$dll" | findstr /C:"machine (x64)"
& dumpbin /exports "$dll" | findstr /C:"ESInitialize" /C:"ESGetVersion" /C:"ESFreeMem" /C:"ESTerminate" /C:"validateText" /C:"packBytes" /C:"unpackBytes" /C:"escapeDirect" /C:"evalJson"
