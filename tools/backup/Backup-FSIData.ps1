<#
.SYNOPSIS
  Backs up the FSI Projects app's data to this computer.

.DESCRIPTION
  Signs in to Microsoft 365 as you and copies every "FSI ..." SharePoint list on the FSI Task
  Tracker site, plus the Relationship Tracker workbook, into a dated .zip file. Each list is
  saved twice: as JSON (every field, for restoring) and as CSV (opens in Excel). Old backups
  beyond -Keep are removed.

  It reads the site address and tracker link from the live app's config.json, so nothing
  needs to be filled in. It only reads; it never changes anything in SharePoint.

  Run it as an admin to include the admin-only FSI Deletion Log.

.EXAMPLE
  .\Backup-FSIData.ps1
  .\Backup-FSIData.ps1 -BackupFolder "D:\FSI Backups" -Keep 26
#>
[CmdletBinding()]
param(
  # Where the .zip files go.
  [string]$BackupFolder = (Join-Path ([Environment]::GetFolderPath("MyDocuments")) "FSI Backups"),
  # How many backups to keep (one a week: 12 is about three months).
  [int]$Keep = 12,
  # The live app; its config.json names the SharePoint site and the tracker workbook.
  [string]$AppUrl = "https://isaacah-source.github.io/Task-Tracking-Application-/",
  # Set these to skip reading config.json.
  [string]$SiteUrl = "",
  [string]$TrackerLink = "",
  [string]$TrackerWorkbook = "",
  # Leave out the Relationship Tracker workbook.
  [switch]$SkipTracker
)

$ErrorActionPreference = "Stop"
$Graph = "https://graph.microsoft.com/v1.0"
$Scopes = @("Sites.Read.All", "Files.Read.All")

function Write-Log([string]$Message) {
  $line = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Write-Host $line
  if ($script:LogFile) { Add-Content -Path $script:LogFile -Value $line -Encoding UTF8 }
}

# One Graph GET. Kept in its own function so the tests can stand in for Microsoft Graph.
function Invoke-Graph([string]$Uri, [string]$OutFile = "") {
  if ($OutFile) { return Invoke-MgGraphRequest -Method GET -Uri $Uri -OutputFilePath $OutFile }
  return Invoke-MgGraphRequest -Method GET -Uri $Uri -OutputType PSObject
}

# Every page of a Graph collection.
function Get-GraphAll([string]$Uri) {
  $out = New-Object System.Collections.Generic.List[object]
  $next = $Uri
  while ($next) {
    $page = Invoke-Graph $next
    foreach ($v in @($page.value)) { $out.Add($v) }
    $next = $page.'@odata.nextLink'
  }
  return , $out.ToArray()
}

# "https://host/sites/Name" -> "/sites/host:/sites/Name"
function Get-SitePath([string]$Url) {
  $u = [Uri]$Url
  $path = $u.AbsolutePath.TrimEnd("/")
  if ($path) { return "/sites/$($u.Host):$path" }
  return "/sites/$($u.Host)"
}

# A sharing link as the /shares endpoint takes it: "u!" + base64url.
function ConvertTo-ShareId([string]$Link) {
  $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Link.Trim()))
  return "u!" + $b64.TrimEnd("=").Replace("/", "_").Replace("+", "-")
}

# CSV-friendly copy of a list item: the app's columns (without the "fsi" prefix) plus
# SharePoint's id, Title, Created, and Modified. Lists and objects become JSON text.
function ConvertTo-CsvRow($Item) {
  $f = $Item.fields
  $row = [ordered]@{ id = $Item.id; Title = $f.Title }
  foreach ($p in $f.PSObject.Properties) {
    if ($p.Name -like "fsi*") {
      $name = $p.Name.Substring(3)
      $v = $p.Value
      if ($null -ne $v -and -not ($v -is [string]) -and -not ($v -is [ValueType])) { $v = ($v | ConvertTo-Json -Compress -Depth 10) }
      $row[$name] = $v
    }
  }
  $row["Created"] = $f.Created
  $row["Modified"] = $f.Modified
  return [pscustomobject]$row
}

function Save-Lists([string]$SiteId, [string]$Dir) {
  $all = Get-GraphAll "$Graph/sites/$SiteId/lists?`$select=id,displayName&`$top=500"
  $lists = @($all | Where-Object { $_.displayName -like "FSI *" })
  if (-not $lists.Count) { throw "No FSI lists found on the site. Check the site address, and that your account can open it." }
  $counts = [ordered]@{}
  foreach ($l in $lists | Sort-Object displayName) {
    try {
      $items = Get-GraphAll "$Graph/sites/$SiteId/lists/$($l.id)/items?expand=fields&`$top=500"
    } catch {
      # The deletion log is admin-only; anyone else is refused, and the rest still backs up.
      Write-Log "  Skipped $($l.displayName): $($_.Exception.Message)"
      $counts[$l.displayName] = "skipped"
      continue
    }
    $safe = $l.displayName -replace '[\\/:*?"<>|]', "_"
    ConvertTo-Json -InputObject @($items) -Depth 20 | Set-Content -Path (Join-Path $Dir "$safe.json") -Encoding UTF8
    if ($items.Count) {
      $items | ForEach-Object { ConvertTo-CsvRow $_ } | Export-Csv -Path (Join-Path $Dir "$safe.csv") -NoTypeInformation -Encoding UTF8
    }
    $counts[$l.displayName] = $items.Count
    Write-Log ("  {0}: {1} item(s)" -f $l.displayName, $items.Count)
  }
  return $counts
}

function Save-Tracker([string]$Link, [string]$WorkbookName, [string]$Dir) {
  $item = Invoke-Graph "$Graph/shares/$(ConvertTo-ShareId $Link)/driveItem"
  $driveId = $item.parentReference.driveId
  if (-not $item.file) {
    $children = Get-GraphAll "$Graph/drives/$driveId/items/$($item.id)/children?`$top=200"
    $books = @($children | Where-Object { $_.file -and $_.name -like "*.xlsx" -and $_.name -notlike '~$*' })
    if ($WorkbookName) { $item = $books | Where-Object { $_.name -eq $WorkbookName } | Select-Object -First 1 }
    elseif ($books.Count -eq 1) { $item = $books[0] }
    else { $item = $books | Where-Object { $_.name -like "*relationship*" } | Select-Object -First 1 }
    if (-not $item) { throw "Could not tell which workbook in the tracker folder to back up." }
  }
  $target = Join-Path $Dir $item.name
  Invoke-Graph "$Graph/drives/$driveId/items/$($item.id)/content" $target | Out-Null
  Write-Log "  Relationship Tracker workbook: $($item.name)"
  return $item.name
}

function Remove-OldBackups([string]$Folder, [int]$KeepCount) {
  $old = Get-ChildItem -Path $Folder -Filter "FSI Backup *.zip" | Sort-Object Name -Descending | Select-Object -Skip $KeepCount
  foreach ($f in $old) {
    Remove-Item $f.FullName
    Write-Log "Removed old backup $($f.Name)"
  }
}

function Invoke-Backup {
  New-Item -ItemType Directory -Force -Path $BackupFolder | Out-Null
  $script:LogFile = Join-Path $BackupFolder "backup.log"
  Write-Log "Backup starting."

  if (-not $SiteUrl -or (-not $SkipTracker -and -not $TrackerLink)) {
    $cfg = Invoke-RestMethod -Uri ($AppUrl.TrimEnd("/") + "/config.json")
    if (-not $SiteUrl) { $script:SiteUrl = $cfg.siteUrl }
    if (-not $TrackerLink) { $script:TrackerLink = $cfg.trackerFolderUrl }
    if (-not $TrackerWorkbook) { $script:TrackerWorkbook = $cfg.trackerWorkbookName }
  }
  if (-not $SiteUrl) { throw "No SharePoint site address. Pass -SiteUrl." }

  if (-not (Get-Module -ListAvailable Microsoft.Graph.Authentication)) {
    throw "The Microsoft.Graph.Authentication module is missing. Run Register-WeeklyBackup.ps1, or: Install-Module Microsoft.Graph.Authentication -Scope CurrentUser"
  }
  Import-Module Microsoft.Graph.Authentication
  # Reuses the saved sign-in when there is one; otherwise opens a Microsoft sign-in window.
  Connect-MgGraph -Scopes $Scopes -NoWelcome | Out-Null

  $stamp = Get-Date -Format "yyyy-MM-dd_HHmm"
  $work = Join-Path $BackupFolder "FSI Backup $stamp"
  New-Item -ItemType Directory -Force -Path $work | Out-Null
  try {
    $site = Invoke-Graph "$Graph$(Get-SitePath $SiteUrl)?`$select=id,webUrl"
    Write-Log "Site: $($site.webUrl)"
    $counts = Save-Lists $site.id $work
    $tracker = $null
    if (-not $SkipTracker -and $TrackerLink) {
      try { $tracker = Save-Tracker $TrackerLink $TrackerWorkbook $work }
      catch { Write-Log "  Relationship Tracker workbook skipped: $($_.Exception.Message)" }
    }
    $who = (Get-MgContext).Account
    [ordered]@{ takenAt = (Get-Date).ToString("o"); takenBy = $who; site = $site.webUrl; lists = $counts; trackerWorkbook = $tracker } |
      ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $work "manifest.json") -Encoding UTF8
    $zip = "$work.zip"
    Compress-Archive -Path (Join-Path $work "*") -DestinationPath $zip -Force
    Write-Log "Saved $zip"
  } finally {
    Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
  }
  Remove-OldBackups $BackupFolder $Keep
  Write-Log "Backup finished."
}

# Tests load the functions above without running a backup.
if ($env:FSI_BACKUP_NO_RUN -ne "1") {
  try { Invoke-Backup }
  catch { Write-Log "Backup FAILED: $($_.Exception.Message)"; exit 1 }
}
