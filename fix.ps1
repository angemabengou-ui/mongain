$files = Get-ChildItem -Path "d:\Users\om0886\Desktop\mongain\src\app" -Recurse -Include *.tsx, *.ts
foreach ($f in $files) {
    if ($f.FullName -match "node_modules") { continue }
    
    # Read the file as raw bytes to avoid any PS parsing bugs
    $bytes = [System.IO.File]::ReadAllBytes($f.FullName)
    
    # The file has a UTF-8 BOM, or is plain UTF-8 encoded text that contains Mojibake like Ã©.
    $text = [System.Text.Encoding]::UTF8.GetString($bytes)
    
    if ($text -match "Ã©" -or $text -match "Ã¨" -or $text -match "Ã " -or $text -match "Ãª" -or $text -match "Ã" -or $text -match "Ã§") {
        Write-Host "Repairing $($f.FullName)..."
        
        # Turn it back into the bytes that Get-Content assumed (Windows-1252)
        $recoveredBytes = [System.Text.Encoding]::GetEncoding(1252).GetBytes($text)
        
        # Those bytes are actually the original UTF-8 bytes! Read them as such.
        $cleanText = [System.Text.Encoding]::UTF8.GetString($recoveredBytes)
        
        # Remove original BOM if it exists at the start of $cleanText
        if ($cleanText.Length -gt 0 -and $cleanText[0] -eq 65279) {
            # 65279 = 0xFEFF
            $cleanText = $cleanText.Substring(1)
        }
        
        # Write back as standard UTF-8 (we use UTF8Encoding with BOM=false)
        $utf8NoBom = New-Object System.Text.UTF8Encoding $false
        [System.IO.File]::WriteAllText($f.FullName, $cleanText, $utf8NoBom)
    }
}
Write-Host "Done!"
