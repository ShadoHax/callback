param([Parameter(Mandatory = $true)][string]$KotlinRoot)
$ErrorActionPreference = 'Stop'
$compiler = Join-Path $KotlinRoot 'bin\kotlinc.bat'
$stdlib = Join-Path $KotlinRoot 'lib\kotlin-stdlib.jar'
$jdk8 = Join-Path $KotlinRoot 'lib\kotlin-stdlib-jdk8.jar'
$coroutines = Join-Path $KotlinRoot 'lib\kotlinx-coroutines-core-jvm.jar'
$classpath = '"' + (($stdlib, $jdk8, $coroutines) -join ';') + '"'
$output = Join-Path $env:TEMP 'callback-android-bridge-test.jar'
& $compiler -classpath $classpath -d $output `
  'tests\native\MetaStub.kt' 'tests\native\JsonStub.kt' 'tests\native\AndroidAutoScanHarness.kt' `
  'adapters\glasses-android\CallbackDeviceClient.kt' 'adapters\glasses-android\CallbackAutoScan.kt' 'adapters\glasses-android\CallbackDatDiscovery.kt' 'adapters\glasses-android\CallbackVoiceConversation.kt'
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& java -cp ($output + ';' + $stdlib + ';' + $jdk8 + ';' + $coroutines) app.callback.bridge.AndroidAutoScanHarnessKt
exit $LASTEXITCODE
