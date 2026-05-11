# B2 WASAPI + VB-Cable Checklist

Run preflight:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\test-b2-wasapi-vbcable.ps1
Get-Content .\harness\wasapi_vbcable_result.json
```

Manual validation (required):

1. Install VB-Cable and reboot if prompted.
2. Set Slack output to `CABLE Input (VB-Audio Virtual Cable)`.
3. Keep browser output on default speakers.
4. Start Slack huddle + play YouTube at the same time.
5. Record from `CABLE Output` device in your capture tool.
6. Verify capture contains Slack voice and excludes YouTube.

Pass criteria:

- Slack voice captured clearly.
- YouTube audio leakage is not present in captured stream.
- Capture stream is stable for 5+ minutes.

Result template:

```json
{
  "b2_result": "PASS | FAIL",
  "slack_isolated": true,
  "youtube_leakage": false,
  "notes": "..."
}
```
