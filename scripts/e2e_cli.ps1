# Clean Exit CLI End-to-End Test
# Usage: .\scripts\e2e_cli.ps1 -TargetKey <ed25519:...>
# Prerequisites: Backend running (uvicorn app:app --reload) & target key exists on chain.

param(
    [Parameter(Mandatory = $true)]
    [string]$TargetKey
)

$ErrorActionPreference = "Stop"

# Configuration
if (-not $env:CLEAN_EXIT_URL) { $env:CLEAN_EXIT_URL = "http://127.0.0.1:8000" }
if (-not $env:CLEAN_EXIT_TOKEN) { $env:CLEAN_EXIT_TOKEN = "ce_dev_test_only_do_not_use" }

function Step($n, $msg) {
    Write-Host "`n[$n] $msg" -ForegroundColor Cyan
}

function RunJson([string[]]$cmdArgs) {
    $out = & python -m sdk @cmdArgs 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Command failed: python -m sdk $($cmdArgs -join ' ')" -ForegroundColor Red
        Write-Host $out -ForegroundColor Red
        throw "CLI step failed (exit $LASTEXITCODE)"
    }
    try {
        return ($out | Out-String) | ConvertFrom-Json
    } catch {
        Write-Host "Non-JSON output:" -ForegroundColor Red
        Write-Host $out -ForegroundColor Red
        throw "CLI did not emit valid JSON"
    }
}

try {
    Step 1 "Capabilities"
    $caps = RunJson @("capabilities", "--json")
    Write-Host "    Network:   $($caps.network)"
    Write-Host "    Signer:    $($caps.signer_configured)"
    Write-Host "    Publisher: $($caps.receipt_publisher_configured)"
    if (-not $caps.signer_configured -or -not $caps.receipt_publisher_configured) {
        throw "Backend not fully configured for signing/publishing."
    }

    Step 2 "Create agent"
    $agent = RunJson @("agent", "create", "cli-e2e-bot", "--near-account", "clean-exit-test-429622.testnet", "--json")
    $agentId = $agent.id
    Write-Host "    Agent ID: $agentId"
    Write-Host "    Status:   $($agent.status)"

    Step 3 "Register authority"
    $auth = RunJson @("authority", "register", $agentId, "--type", "near_function_key", "--provider", "near", "--resource", $TargetKey, "--revocable", "--json")
    $authId = $auth.id
    Write-Host "    Authority ID: $authId"
    Write-Host "    State:        $($auth.state)"

    Step 4 "Verify on chain"
    $report = RunJson @("verify", $agentId, "--json")
    Write-Host "    Keys observed: $($report.total_observed_keys)"
    $match = $report.verified | Where-Object { $_.authority_id -eq $authId }
    if (-not $match) { throw "Authority not in verified list" }
    if (-not $match.on_chain) { throw "Key not observed on chain" }
    Write-Host "    On-chain: $($match.on_chain) (State: $($match.new_state))"

    Step 5 "Termination plan"
    $plan = RunJson @("plan", $agentId, "--json")
    Write-Host "    Total:       $($plan.total_authorities)"
    Write-Host "    Supported:   $($plan.supported_count)"
    if ($plan.supported_count -eq 0) { throw "No supported authorities in plan." }

    Step 6 "Create termination job"
    $idem = "cli-e2e-" + [guid]::NewGuid().ToString()
    $job = RunJson @("terminate", $agentId, "--reason", "CLI E2E Test", "--idempotency-key", $idem, "--json")
    $jobId = $job.id
    Write-Host "    Job ID: $jobId"
    Write-Host "    Status: $($job.status)"

    Step 7 "Wait for worker"
    $final = RunJson @("wait", $jobId, "--timeout", "120", "--interval", "2", "--json")
    Write-Host "    Status:  $($final.status)"
    Write-Host "    Phase:   $($final.phase)"
    Write-Host "    Receipt: $($final.receipt_id)"
    if ($final.status -ne "succeeded") {
        throw "Job failed: $($final.error)"
    }
    $receiptId = $final.receipt_id

    Step 8 "Publish receipt"
    $pub = RunJson @("receipt", "publish", $receiptId, "--json")
    Write-Host "    Status: $($pub.verification_status)"
    Write-Host "    Tx:     $($pub.onchain_tx_hash)"
    if ($pub.verification_status -ne "published") { throw "Publish failed." }

    Step 9 "Verify receipt integrity"
    $ver = RunJson @("receipt", "verify", $receiptId, "--json")
    Write-Host "    Hash Matches:    $($ver.hash_matches)"
    Write-Host "    On-chain Status: $($ver.onchain_status)"
    Write-Host "    On-chain Match:  $($ver.onchain_matches)"
    Write-Host "    Verified:        $($ver.verified)"
    if (-not $ver.verified) { throw "Receipt verification failed." }

    Write-Host "`n==================================================" -ForegroundColor Green
    Write-Host "=== CLI E2E PASSED SUCCESSFULLY ===" -ForegroundColor Green
    Write-Host "==================================================" -ForegroundColor Green

} catch {
    Write-Host "`n[!] E2E FAILED: $_" -ForegroundColor Red
    exit 1
}