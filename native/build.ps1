param(
    [string]$OutputName = "ESONJson"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$outDir = Join-Path $root "build"
$dll = Join-Path $outDir ($OutputName + ".dll")
$vcvars = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2019\BuildTools\VC\Auxiliary\Build\vcvars64.bat"

if (!(Test-Path -LiteralPath $vcvars)) {
    throw "vcvars64.bat not found: $vcvars"
}

New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$cmd = """$vcvars"" && cl /nologo /O2 /MT /LD /I""$root"" ""$root\eson_json.c"" /Fe:""$dll"" /link /NOLOGO /MACHINE:X64"
cmd.exe /c $cmd
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
$dumpHeaders = """$vcvars"" && dumpbin /headers ""$dll"" | findstr /C:""machine (x64)"""
$dumpExports = """$vcvars"" && dumpbin /exports ""$dll"" | findstr /C:""ESInitialize"" /C:""stage_s"" /C:""validateStaged"" /C:""escapeStaged"" /C:""escapeDirect"""
cmd.exe /c $dumpHeaders
cmd.exe /c $dumpExports
