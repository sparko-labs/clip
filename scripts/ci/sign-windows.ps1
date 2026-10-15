[CmdletBinding()]
param(
	[Parameter(Mandatory = $true)]
	[string[]] $Path
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$timestampUrl = if ([string]::IsNullOrWhiteSpace($env:WINDOWS_TIMESTAMP_URL)) {
	"http://timestamp.digicert.com"
} else {
	$env:WINDOWS_TIMESTAMP_URL
}

$files = foreach ($item in $Path) {
	if (Test-Path -LiteralPath $item -PathType Container) {
		Get-ChildItem -LiteralPath $item -Filter *.exe -File -Recurse
	} else {
		Get-Item -LiteralPath $item
	}
}
if (-not $files) {
	throw "No files to sign under: $($Path -join ', ')"
}

$pfxPath = $null
try {
	if (-not [string]::IsNullOrWhiteSpace($env:WINDOWS_SIGN_COMMAND)) {
		foreach ($file in $files) {
			$command = $env:WINDOWS_SIGN_COMMAND.Replace("{file}", $file.FullName)
			Write-Host "Signing $($file.Name) with the configured sign command"
			Invoke-Expression $command
			if ($LASTEXITCODE -ne 0) {
				throw "Sign command failed for $($file.FullName)"
			}
		}
	}
	elseif (-not [string]::IsNullOrWhiteSpace($env:WINDOWS_CERTIFICATE)) {
		$signtool = Get-Command signtool.exe -ErrorAction SilentlyContinue
		if (-not $signtool) {
			$kit = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" -ErrorAction SilentlyContinue |
				Sort-Object FullName -Descending | Select-Object -First 1
			if (-not $kit) { throw "signtool.exe was not found; install the Windows SDK." }
			$signtool = $kit
		}
		$pfxPath = Join-Path ([System.IO.Path]::GetTempPath()) "cap-codesign-$([guid]::NewGuid()).pfx"
		[System.IO.File]::WriteAllBytes($pfxPath, [Convert]::FromBase64String($env:WINDOWS_CERTIFICATE))
		foreach ($file in $files) {
			Write-Host "Signing $($file.Name) with signtool"
			& $signtool.Source sign /f $pfxPath /p $env:WINDOWS_CERTIFICATE_PASSWORD `
				/fd SHA256 /tr $timestampUrl /td SHA256 $file.FullName
			if ($LASTEXITCODE -ne 0) {
				throw "signtool failed for $($file.FullName)"
			}
		}
	}
	else {
		throw "Set WINDOWS_SIGN_COMMAND or WINDOWS_CERTIFICATE to sign Windows builds."
	}
}
finally {
	if ($pfxPath -and (Test-Path -LiteralPath $pfxPath)) {
		Remove-Item -LiteralPath $pfxPath -Force
	}
}

foreach ($file in $files) {
	$signature = Get-AuthenticodeSignature -FilePath $file.FullName
	if ($signature.Status -ne "Valid") {
		throw "$($file.Name) has Authenticode status $($signature.Status) after signing."
	}
}
