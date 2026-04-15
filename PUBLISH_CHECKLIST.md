# AzkarV1 Chrome Web Store Publish Checklist

## 1) Account & Dashboard
- [ ] Register as a Chrome Web Store developer (one-time registration fee).
- [ ] Open Developer Dashboard: https://chrome.google.com/webstore/devconsole
- [ ] Confirm publisher email is active and monitored.

## 2) Package Readiness
- [ ] Zip contains only extension runtime files (already prepared).
- [ ] Manifest is MV3 (`manifest_version: 3`).
- [ ] Version is incremented for each upload.
- [ ] No remote code execution.
- [ ] Permissions are minimal and justified in privacy tab.

## 3) Required Store Assets
- [ ] Store icon: 128x128 PNG.
- [ ] Small promo tile: 440x280 PNG/JPEG.
- [ ] At least 1 screenshot (up to 5 recommended): 1280x800 preferred (or 640x400).
- [ ] Screenshot style: full bleed, square corners, no padding.

## 4) Store Listing (Store listing tab)
- [ ] Clear long description (single purpose first line).
- [ ] Primary category selected.
- [ ] Language selected.
- [ ] Optional: homepage URL / support URL / official URL (verified publisher).

## 5) Privacy Tab (Critical)
- [ ] Single purpose statement is clear.
- [ ] Every permission has justification.
- [ ] Data usage declared accurately.
- [ ] Privacy policy URL added and publicly reachable.
- [ ] Remote code section set correctly (No for this extension).

## 6) Distribution Tab
- [ ] Visibility set (`Public` for launch, or `Unlisted/Private` for testing).
- [ ] Regions selected.

## 7) Test Instructions Tab
- [ ] Optional unless reviewer needs credentials or non-obvious steps.
- [ ] Include reproducible steps for GPS allow/deny flow and prayer alert behavior.

## 8) Final QA Before Submit
- [ ] Load unpacked locally and verify no runtime errors.
- [ ] Verify popup interval, drag behavior, and no popup overlap.
- [ ] Verify prayer widget countdown and 15-min alert (red + beep once).
- [ ] Verify location fallback (deny GPS -> city input).
- [ ] Verify API method=3 and daily caching behavior.

## 9) Submit
- [ ] Upload ZIP file.
- [ ] Complete Listing + Privacy + Distribution.
- [ ] Submit for review.
- [ ] Choose immediate publish or deferred publish.

---

## AzkarV1 Pre-Submission Notes
- Your current package includes a placeholder `sounds/beep.mp3`. Replace with a real short beep mp3 to avoid quality/review concerns.
- Add a real `128x128` icon and reference it in `manifest.json` under `icons` for best compatibility.
- Broad host coverage (`http://*/*`, `https://*/*`) may increase review scrutiny. Keep justification clear in privacy fields.
