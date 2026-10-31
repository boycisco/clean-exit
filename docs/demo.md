# Clean Exit: Hackathon Demo Recording Guide

This document outlines the exact sequence for a 2-to-3-minute demonstration of Clean Exit.

## Pre-Recording Checklist
- Backend running (`uvicorn app:app --reload` with signing keys configured)
- Worker running (included in backend startup logs)
- Frontend running (`cd ui && npm run dev`)
- Have your `.env` file ready, but **do not open it on screen**.
- Have a terminal open with the testnet CLI ready: `near account view-account-summary clean-exit-test-429622.testnet network-config testnet now`

## The Script

### 0:00 – 0:25 (The Problem)
**Visual:** Clean Exit Overview Dashboard.
**Narration:** "Stopping an AI agent does not mean its permissions disappear. If a bot holds NEAR function-call keys, those keys remain active. Clean Exit solves this by providing a verifiable termination workflow."

### 0:25 – 0:45 (Registration)
**Visual:** Click "Register Agent". Fill in name "demo-agent" and account "clean-exit-test-429622.testnet". Click Register.
**Narration:** "First, we register the agent and bind it to its NEAR account."

### 0:45 – 1:10 (Authority Verification)
**Visual:** Go to the "Authority" tab. Click "Add permission". Add a real throwaway `ed25519:...` key. Click "Verify Authority".
**Narration:** "We register a specific access key. Clean Exit immediately queries the NEAR testnet RPC to verify it actually exists on-chain."
**Visual:** Show the green "Active" badge appear.

### 1:10 – 1:45 (Termination)
**Visual:** Go to the "Termination" tab. Click "Terminate Agent". Type a reason. Click Confirm.
**Narration:** "When we initiate termination, a durable background worker takes over. It signs a real NEAR transaction to delete the key, waits for the transaction to finalize, and verifies the deletion."

### 1:45 – 2:20 (Independent Verification)
**Visual:** The UI shows "Succeeded". Click "View Receipt". 
**Narration:** "The worker generates a cryptographic receipt. We can publish this hash to our deployed smart contract."
**Visual:** Click "Publish to Blockchain", then "Verify Integrity". Show the green checkmark.
**Visual:** Switch to the terminal. Run: 
`near account view-account-summary clean-exit-test-429622.testnet network-config testnet now`
**Narration:** "If we check the blockchain independently, we can see the specific key is gone. Only the full-access key remains."

### 2:20 – 2:45 (The Boundary)
**Visual:** Back to the Receipt page.
**Narration:** "Clean Exit does not claim universal permission discovery. It provides verifiable, cryptographic proof of what happened to the authorities you registered. It's infrastructure for a safer agent economy."

## What NOT to show:
- Your `.env` file.
- Private key JSON files.
- The internal database (`clean.db`).
- Any real mainnet accounts.