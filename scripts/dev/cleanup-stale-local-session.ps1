[CmdletBinding()]
param(
  [string]$ProjectRoot = '',
  [int[]]$Ports = @(4000, 4200, 4400, 4500, 5001, 8080, 9099, 9199),
  [int]$WaitSeconds = 15
)

$ErrorActionPreference = 'Stop'

if (-not $ProjectRoot) {
  $ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
} else {
  $ProjectRoot = (Resolve-Path $ProjectRoot).Path
}

function Write-Step {
  param([Parameter(Mandatory = $true)][string]$Message)
  Write-Host "[dev:cleanup] $Message"
}

function Get-ListeningProcessIds {
  param([Parameter(Mandatory = $true)][int[]]$TargetPorts)

  $result = [System.Collections.Generic.HashSet[int]]::new()
  $getNetTcpConnection = Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue

  if ($getNetTcpConnection) {
    foreach ($port in $TargetPorts) {
      $connections = @(
        Get-NetTCPConnection `
          -State Listen `
          -LocalPort $port `
          -ErrorAction SilentlyContinue
      )

      foreach ($connection in $connections) {
        if ($connection.OwningProcess -gt 0) {
          [void]$result.Add([int]$connection.OwningProcess)
        }
      }
    }

    return @($result)
  }

  $targetPortSet = [System.Collections.Generic.HashSet[int]]::new()
  foreach ($port in $TargetPorts) {
    [void]$targetPortSet.Add($port)
  }

  $netstatLines = @(netstat -ano -p tcp 2>$null)

  foreach ($line in $netstatLines) {
    if ($line -notmatch '^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$') {
      continue
    }

    $port = [int]$Matches[1]
    $processId = [int]$Matches[2]

    if ($targetPortSet.Contains($port) -and $processId -gt 0) {
      [void]$result.Add($processId)
    }
  }

  return @($result)
}

function Get-ProcessDescriptor {
  param([Parameter(Mandatory = $true)][int]$ProcessId)

  try {
    $process = Get-CimInstance `
      -ClassName Win32_Process `
      -Filter "ProcessId = $ProcessId" `
      -ErrorAction Stop

    if (-not $process) {
      return $null
    }

    return [PSCustomObject]@{
      ProcessId = [int]$process.ProcessId
      ParentProcessId = [int]$process.ParentProcessId
      Name = [string]$process.Name
      CommandLine = [string]$process.CommandLine
      ExecutablePath = [string]$process.ExecutablePath
    }
  } catch {
    return $null
  }
}

function Test-RecognizedLocalProcess {
  param(
    [Parameter(Mandatory = $true)]$Descriptor,
    [Parameter(Mandatory = $true)][string]$Root
  )

  $name = ([string]$Descriptor.Name).ToLowerInvariant()
  $commandLine = [string]$Descriptor.CommandLine
  $normalizedRoot = $Root.Replace('/', '\')
  $rootPattern = [regex]::Escape($normalizedRoot)

  if ($commandLine -match $rootPattern) {
    return $true
  }

  if ($name -eq 'java.exe' -and $commandLine -match 'cloud-firestore-emulator') {
    return $true
  }

  if ($name -in @('node.exe', 'npx.exe', 'npm.exe', 'npm.cmd', 'cmd.exe')) {
    return $commandLine -match '(?i)(firebase-tools|firebase\s+emulators:start|start-emulator-with-data\.mjs|start-emu-media-full\.cmd|ng(?:\.cmd)?\s+serve|@angular[\\/]cli)'
  }

  return $false
}

function Test-PortOpen {
  param([Parameter(Mandatory = $true)][int]$Port)

  $client = [System.Net.Sockets.TcpClient]::new()

  try {
    $task = $client.ConnectAsync('127.0.0.1', $Port)
    $completed = $task.Wait(500)
    return $completed -and $client.Connected
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

$processIds = @(Get-ListeningProcessIds -TargetPorts $Ports)

if ($processIds.Count -eq 0) {
  Write-Step 'Nenhum processo local residual foi encontrado.'
  exit 0
}

$unknownProcesses = [System.Collections.Generic.List[object]]::new()
$recognizedProcesses = [System.Collections.Generic.List[object]]::new()

foreach ($processId in $processIds) {
  $descriptor = Get-ProcessDescriptor -ProcessId $processId

  if (-not $descriptor) {
    $unknownProcesses.Add([PSCustomObject]@{
      ProcessId = $processId
      Name = 'desconhecido'
      CommandLine = ''
    })
    continue
  }

  if (Test-RecognizedLocalProcess -Descriptor $descriptor -Root $ProjectRoot) {
    $recognizedProcesses.Add($descriptor)
  } else {
    $unknownProcesses.Add($descriptor)
  }
}

if ($unknownProcesses.Count -gt 0) {
  Write-Host '[dev:cleanup] Processos desconhecidos ocupam portas do ambiente. Nada foi encerrado.' -ForegroundColor Yellow

  foreach ($process in $unknownProcesses) {
    $summary = if ($process.CommandLine) {
      $process.CommandLine
    } else {
      $process.Name
    }

    Write-Host "[dev:cleanup] PID $($process.ProcessId): $summary" -ForegroundColor Yellow
  }

  exit 2
}

foreach ($process in $recognizedProcesses) {
  Write-Step "Encerrando processo residual reconhecido: PID $($process.ProcessId) $($process.Name)"

  try {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
  } catch {
    throw "Nao foi possivel encerrar o PID $($process.ProcessId): $($_.Exception.Message)"
  }
}

$deadline = (Get-Date).AddSeconds($WaitSeconds)

while ((Get-Date) -lt $deadline) {
  $occupiedPorts = @($Ports | Where-Object { Test-PortOpen -Port $_ })

  if ($occupiedPorts.Count -eq 0) {
    Write-Step 'Portas do ambiente liberadas com seguranca.'
    exit 0
  }

  Start-Sleep -Milliseconds 500
}

$remainingPorts = @($Ports | Where-Object { Test-PortOpen -Port $_ })
Write-Host "[dev:cleanup] Portas ainda ocupadas: $($remainingPorts -join ', ')." -ForegroundColor Yellow
exit 3
