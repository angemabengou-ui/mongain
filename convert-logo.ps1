Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile('C:\Users\om0886\.gemini\antigravity\brain\60e58aba-4ade-46d1-9415-c0ac40b40a24\media__1788483519048.jpg')
$img.Save('d:\Users\om0886\Desktop\mongain\assets\images\logo-glow.png', [System.Drawing.Imaging.ImageFormat]::Png)
$img.Save('d:\Users\om0886\Desktop\mongain\assets\images\icon.png', [System.Drawing.Imaging.ImageFormat]::Png)
$img.Save('d:\Users\om0886\Desktop\mongain\assets\images\splash.png', [System.Drawing.Imaging.ImageFormat]::Png)
$img.Dispose()
Write-Host "Logo setup completed."
