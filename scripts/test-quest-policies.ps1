$ErrorActionPreference = 'Stop'
$editor = 'C:\Program Files\Unity\Hub\Editor\6000.0.38f1\Editor\Data\MonoBleedingEdge'
$mono = Join-Path $editor 'bin\mono.exe'
$compiler = Join-Path $editor 'lib\mono\4.5\csc.exe'
if (!(Test-Path $mono) -or !(Test-Path $compiler)) { throw 'Unity Mono compiler is unavailable.' }
$output = Join-Path $env:TEMP 'callback-quest-policies.exe'
& $mono $compiler /nologo /out:$output 'adapters\quest-unity\CallbackQuestPolicies.cs' 'tests\native\QuestPoliciesHarness.cs'
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $mono $output
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$unity = 'C:\Program Files\Unity\Hub\Editor\6000.0.38f1\Editor\Data\Managed\UnityEngine'
$refs = @('UnityEngine.dll', 'UnityEngine.CoreModule.dll', 'UnityEngine.UnityWebRequestModule.dll', 'UnityEngine.UnityWebRequestWWWModule.dll', 'UnityEngine.IMGUIModule.dll', 'UnityEngine.ImageConversionModule.dll', 'UnityEngine.TextRenderingModule.dll', 'UnityEngine.JSONSerializeModule.dll')
$referenceArgs = @('/r:' + (Join-Path $editor 'lib\mono\4.5\Facades\netstandard.dll')) + ($refs | ForEach-Object { '/r:' + (Join-Path $unity $_) })
& $mono $compiler /nologo /nowarn:0649 /target:library ('/out:' + (Join-Path $env:TEMP 'callback-quest-bridge.dll')) $referenceArgs 'adapters\quest-unity\CallbackQuestBridge.cs' 'adapters\quest-unity\CallbackQuestPolicies.cs'
exit $LASTEXITCODE
