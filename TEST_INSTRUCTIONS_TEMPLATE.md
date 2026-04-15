# AzkarV1 Test Instructions (For Reviewers)

This item does not require account login.

## Basic verification
1. Install extension and open any https page.
2. Confirm floating widget appears in top-right area.
3. Open extension popup settings and confirm controls apply immediately.

## Location flow
1. On first run, allow location permission.
2. Confirm prayer times load and countdown updates every second.
3. Re-test by denying GPS permission: manual city/country form should appear.

## Azkar popup
1. Ensure popup is enabled.
2. Set interval to 1 minute.
3. Wait for popup; it should appear top-right, be draggable, and auto-hide.
4. Popup should not overlap with another active popup.

## Prayer reminder alert
1. Adjust system time near 15 minutes before next prayer (or wait naturally).
2. Confirm widget color changes to warning red.
3. Confirm sound plays once only for that prayer window.
